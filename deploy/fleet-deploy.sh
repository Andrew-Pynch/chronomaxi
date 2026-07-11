#!/usr/bin/env bash
# deploy/fleet-deploy.sh -- push + fleet-deploy chronomaxi from big-ron.
#
# Triggered automatically by .husky/post-commit on every commit landed on
# `main` (async, backgrounded, never blocks the commit). Also safe to run
# by hand for a manual deploy: deploy/fleet-deploy.sh
#
# Ordering guarantee (load-bearing, do not reorder):
#   1. push local main to origin (abort cleanly on failure -- nothing else
#      runs, state file untouched).
#   2. diff HEAD against the last-successfully-deployed rev (state file) to
#      decide what changed. No state file / unresolvable rev -> full deploy.
#   3. IF convex/ or frontend/ changed: deploy the Convex backend + web
#      frontend on big-bertha FIRST.
#   4. ONLY THEN, if tracker/ changed: rebuild + restart trackers (ron
#      local, big-bertha over ssh, lil-timmy best-effort). This order
#      matters because Convex's validators are strict (unknown fields are
#      rejected) -- a tracker sending a new field before the backend that
#      accepts it is live would have every span it flushes rejected. Never
#      restart a tracker before its target backend is already serving the
#      schema that tracker's binary will start writing.
#   5. Health checks against the live dashboard + ingest endpoint.
#   6. Only on full success: record the new rev in the state file so the
#      next run's diff starts from here.
#
# Env vars:
#   CHRONOMAXI_DRY_RUN=1   Print the plan (what would be pushed/built/
#                          restarted) without any ssh, build, restart, git
#                          push, curl, or state-file write. Safe to run any
#                          time from any branch.
#
# Logging: this script logs to stdout/stderr only -- it does not manage
# its own log file. .husky/post-commit redirects its async invocation into
# ~/.local/state/chronomaxi/fleet-deploy.log (>>...2>&1); a manual run just
# prints to the terminal (pipe through `tee -a` yourself if you want both).
#
# Locking: a flock on /tmp/chronomaxi-fleet-deploy.lock serializes runs --
# a second commit landing while a deploy is still in flight waits for the
# first to finish (up to 30m) rather than racing it.
#
# Re-run safety: idempotent. `git push`/`git pull --ff-only` no-op when
# already in sync; restarting an already-fresh tracker/web unit is harmless;
# the state file is only advanced past a rev once everything up to it has
# been verified deployed and healthy.

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STATE_DIR="$HOME/.local/state/chronomaxi"
STATE_FILE="$STATE_DIR/fleet-last-deployed-rev"
LOG_FILE="$STATE_DIR/fleet-deploy.log"          # see "Logging" above
LOCK_FILE="/tmp/chronomaxi-fleet-deploy.lock"
LOCK_WAIT_S=1800

BERTHA_HOST="big-bertha"
TIMMY_HOST="lil-timmy"
# shellcheck disable=SC2088  # intentional: display-only (log/warn text), never
# executed/eval'd -- each remote heredoc below inlines the literal path itself
# so the tilde expands correctly in the REMOTE shell, not this local variable.
REMOTE_REPO='~/personal/chronomaxi'             # same relative layout on every host

DRY_RUN=0
[ "${CHRONOMAXI_DRY_RUN:-0}" = "1" ] && DRY_RUN=1

log() { printf '[fleet-deploy] %s\n' "$1"; }
warn() { printf '[fleet-deploy] WARN: %s\n' "$1" >&2; }
die() { printf '[fleet-deploy] ERROR: %s\n' "$1" >&2; exit 1; }

# All ssh calls: batch mode (never hang on a prompt), bounded connect
# timeout, tagged for chronomaxi session attribution (see skill://tailnet).
run_ssh() {
    local host=$1
    shift
    CMX_AGENT_NAME=FleetDeploy ssh -o BatchMode=yes -o ConnectTimeout=10 "$host" "$@"
}

# --- 1. push local main to origin -------------------------------------------

push_if_ahead() {
    log "git push origin main (no-ops cleanly if already up to date)"
    if [ "$DRY_RUN" -eq 1 ]; then
        log "DRY-RUN: git push origin main"
        return 0
    fi
    git -C "$REPO_DIR" push origin main \
        || die "git push origin main failed -- aborting fleet deploy cleanly, nothing else touched"
}

# --- 2. compute what changed since the last successful deploy --------------

BACKEND_CHANGED=0
TRACKER_CHANGED=0

compute_changed() {
    local last_rev=""
    [ -f "$STATE_FILE" ] && last_rev=$(cat "$STATE_FILE")

    if [ -n "$last_rev" ] && git -C "$REPO_DIR" cat-file -e "${last_rev}^{commit}" 2>/dev/null; then
        log "diffing $last_rev..$CURRENT_REV against state file $STATE_FILE"
        while IFS= read -r path; do
            case "$path" in
                convex/*|frontend/*) BACKEND_CHANGED=1 ;;
            esac
            case "$path" in
                tracker/*) TRACKER_CHANGED=1 ;;
            esac
        done < <(git -C "$REPO_DIR" diff --name-only "$last_rev" "$CURRENT_REV")
    else
        log "no usable state file at $STATE_FILE -- treating this as a full deploy"
        BACKEND_CHANGED=1
        TRACKER_CHANGED=1
    fi

    log "plan: backend(convex/frontend)=$BACKEND_CHANGED tracker=$TRACKER_CHANGED"
}

# --- 3. backend: convex deploy + frontend build + web restart on bertha ----

verify_convex_env_vars() {
    log "verifying CONVEX_SELF_HOSTED_* vars exist in bertha's .env.local (values redacted)"
    local remote_check result
    remote_check=$(cat <<'EOF'
set -e
ENV_FILE=~/personal/chronomaxi/.env.local
[ -f "$ENV_FILE" ] || { echo "MISSING_FILE:$ENV_FILE"; exit 1; }
missing=""
for var in CONVEX_SELF_HOSTED_URL CONVEX_SELF_HOSTED_ADMIN_KEY; do
    grep -qE "^${var}=.+" "$ENV_FILE" || missing="$missing $var"
done
FRONTEND_ENV=~/personal/chronomaxi/frontend/.env.local
# NEXT_PUBLIC_CONVEX_URL is baked into the frontend at BUILD time (mixed-content
# gotcha: must be the tailscale TLS proxy URL, not http://big-bertha:3210) --
# next build reads env from frontend/, never the repo root, so it must live in
# frontend/.env.local specifically. Absent => `bun run build` fails env
# validation, so fail fast here with a named var instead.
[ -f "$FRONTEND_ENV" ] || { echo "MISSING_FILE:$FRONTEND_ENV"; exit 1; }
grep -qE "^NEXT_PUBLIC_CONVEX_URL=.+" "$FRONTEND_ENV" || missing="$missing NEXT_PUBLIC_CONVEX_URL(frontend/.env.local)"
[ -z "$missing" ] || { echo "MISSING_VARS:$missing"; exit 1; }
echo OK
EOF
    )
    if ! result=$(run_ssh "$BERTHA_HOST" "$remote_check" 2>&1); then
        die "bertha .env.local is missing required CONVEX_SELF_HOSTED_* vars (or the file is absent): $result"
    fi
    log "bertha .env.local has the required CONVEX_SELF_HOSTED_* vars set"
}

deploy_backend() {
    log "backend: convex/ or frontend/ changed -- deploying on $BERTHA_HOST"
    if [ "$DRY_RUN" -eq 1 ]; then
        log "DRY-RUN: verify CONVEX_SELF_HOSTED_* vars present in bertha's .env.local"
        log "DRY-RUN: ssh $BERTHA_HOST git -C $REMOTE_REPO pull --ff-only"
        log "DRY-RUN: ssh $BERTHA_HOST bunx convex deploy   (in $REMOTE_REPO)"
        log "DRY-RUN: ssh $BERTHA_HOST 'cd $REMOTE_REPO/frontend && bun install --frozen-lockfile && bun run build'"
        log "DRY-RUN: ssh $BERTHA_HOST systemctl --user restart chronomaxi-web.service"
        return 0
    fi

    verify_convex_env_vars

    local remote_deploy
    remote_deploy=$(cat <<'EOF'
set -e
cd ~/personal/chronomaxi
git pull --ff-only
bunx convex deploy
cd frontend
bun install --frozen-lockfile
bun run build
EOF
    )
    run_ssh "$BERTHA_HOST" "$remote_deploy" \
        || die "backend deploy failed on $BERTHA_HOST (pull / convex deploy / frontend build) -- aborting; state file NOT updated, trackers NOT touched"
    log "convex deploy + frontend build OK on $BERTHA_HOST"

    log "restarting chronomaxi-web.service on $BERTHA_HOST (systemd --user)"
    if ! run_ssh "$BERTHA_HOST" "systemctl --user restart chronomaxi-web.service"; then
        warn "restart of chronomaxi-web.service failed on $BERTHA_HOST -- check manually: ssh $BERTHA_HOST systemctl --user status chronomaxi-web"
        return 0
    fi
    sleep 2
    if run_ssh "$BERTHA_HOST" "systemctl --user is-active --quiet chronomaxi-web.service"; then
        log "chronomaxi-web.service active on $BERTHA_HOST"
    else
        warn "chronomaxi-web.service is not active on $BERTHA_HOST after restart -- check manually: ssh $BERTHA_HOST systemctl --user status chronomaxi-web"
    fi
}

# --- 4. tracker: rebuild + restart, ron local / bertha ssh / timmy best-effort

wait_for_flush_snippet() {
    # Emitted as a remote (or local, via eval) shell snippet: assumes the
    # unit was just restarted, waits up to 90s for a fresh 'flushed' line.
    cat <<'EOF'
systemctl --user is-active --quiet chronomaxi-tracker.service
since=$(date -Is)
elapsed=0
until journalctl --user -u chronomaxi-tracker.service --since "$since" --no-pager 2>/dev/null | grep -q 'flushed'; do
    sleep 5
    elapsed=$((elapsed + 5))
    if [ "$elapsed" -ge 90 ]; then
        echo "no fresh 'flushed' journal line within 90s" >&2
        exit 1
    fi
done
EOF
}

deploy_tracker_ron() {
    log "tracker: building + restarting on ron (local)"
    if [ "$DRY_RUN" -eq 1 ]; then
        log "DRY-RUN: (local) cd tracker && cargo build --release"
        log "DRY-RUN: (local) systemctl --user restart chronomaxi-tracker.service"
        log "DRY-RUN: (local) verify is-active + fresh 'flushed' journal line within 90s"
        return 0
    fi

    ( cd "$REPO_DIR/tracker" && cargo build --release ) \
        || die "cargo build --release failed on ron (tracker/) -- aborting before touching the live tracker unit"

    systemctl --user restart chronomaxi-tracker.service

    local verify_script
    verify_script="set -e
$(wait_for_flush_snippet)"
    if ! bash -c "$verify_script"; then
        die "tracker on ron did not confirm active + flushing after restart -- check: journalctl --user -u chronomaxi-tracker -n 50"
    fi
    log "confirmed: tracker on ron is active and flushing"
}

deploy_tracker_bertha() {
    log "tracker: building + restarting on $BERTHA_HOST"
    if [ "$DRY_RUN" -eq 1 ]; then
        log "DRY-RUN: ssh $BERTHA_HOST 'git -C $REMOTE_REPO pull --ff-only && cd $REMOTE_REPO/tracker && cargo build --release && systemctl --user restart chronomaxi-tracker.service'"
        log "DRY-RUN: ssh $BERTHA_HOST verify is-active + fresh 'flushed' journal line within 90s"
        return 0
    fi

    local remote_build
    remote_build=$(cat <<'EOF'
set -e
git -C ~/personal/chronomaxi pull --ff-only
cd ~/personal/chronomaxi/tracker
cargo build --release
systemctl --user restart chronomaxi-tracker.service
EOF
    )
    run_ssh "$BERTHA_HOST" "$remote_build" \
        || die "tracker build/restart failed on $BERTHA_HOST -- aborting; state file NOT updated"

    local remote_verify
    remote_verify="set -e
$(wait_for_flush_snippet)"
    run_ssh "$BERTHA_HOST" "$remote_verify" \
        || die "tracker on $BERTHA_HOST did not confirm active + flushing after restart -- check: ssh $BERTHA_HOST journalctl --user -u chronomaxi-tracker -n 50"
    log "confirmed: tracker on $BERTHA_HOST is active and flushing"
}

deploy_tracker_timmy() {
    log "tracker: probing $TIMMY_HOST for an installed launchd agent"
    if [ "$DRY_RUN" -eq 1 ]; then
        log "DRY-RUN: ssh $TIMMY_HOST launchctl print gui/\$(id -u)/com.pynchlabs.chronomaxi-tracker  (probe only)"
        log "DRY-RUN: if installed: git pull --ff-only, \$HOME/.cargo/bin/cargo build --release, launchctl kickstart -k"
        log "DRY-RUN: if not installed / host asleep: WARN and skip gracefully"
        return 0
    fi

    local probe_out
    # shellcheck disable=SC2016  # intentional: $(id -u) must resolve on the
    # REMOTE host (lil-timmy's uid), not locally -- single quotes defer it.
    if ! probe_out=$(run_ssh "$TIMMY_HOST" 'launchctl print "gui/$(id -u)/com.pynchlabs.chronomaxi-tracker"' 2>&1); then
        warn "lil-timmy: launchd agent not installed (or host unreachable/asleep) -- skipping tracker deploy there. probe: $probe_out"
        return 0
    fi

    local remote_build
    remote_build=$(cat <<'EOF'
set -e
git -C ~/personal/chronomaxi pull --ff-only
cd ~/personal/chronomaxi/tracker
"$HOME/.cargo/bin/cargo" build --release
launchctl kickstart -k "gui/$(id -u)/com.pynchlabs.chronomaxi-tracker"
EOF
    )
    if run_ssh "$TIMMY_HOST" "$remote_build"; then
        log "kickstarted chronomaxi-tracker launchd agent on $TIMMY_HOST"
    else
        warn "tracker build/kickstart failed on $TIMMY_HOST -- check manually: ssh $TIMMY_HOST 'launchctl print gui/\$(id -u)/com.pynchlabs.chronomaxi-tracker'"
    fi
}

# --- 5. health checks --------------------------------------------------------

health_checks() {
    log "running health checks"
    if [ "$DRY_RUN" -eq 1 ]; then
        log "DRY-RUN: curl -sk -o /dev/null -w '%{http_code}' https://big-bertha.tail3f4961.ts.net:8443            (expect 200)"
        log "DRY-RUN: curl -s  -o /dev/null -w '%{http_code}' -X POST http://big-bertha:3211/ingest                (expect 401, unauthenticated probe)"
        return 0
    fi

    local dash_code
    dash_code=$(curl -sk -o /dev/null -w '%{http_code}' --max-time 15 "https://big-bertha.tail3f4961.ts.net:8443" 2>/dev/null || echo 000)
    [ "$dash_code" = "200" ] || die "dashboard health check failed: HTTP $dash_code (expected 200) -- https://big-bertha.tail3f4961.ts.net:8443"
    log "dashboard health check OK (200)"

    local ingest_code
    ingest_code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 -X POST "http://big-bertha:3211/ingest" 2>/dev/null || echo 000)
    [ "$ingest_code" = "401" ] || die "ingest health check failed: HTTP $ingest_code (expected 401 unauthenticated) -- http://big-bertha:3211/ingest"
    log "ingest health check OK (401 unauthenticated, as expected)"
}

# --- main --------------------------------------------------------------------

main() {
    mkdir -p "$STATE_DIR"
    log "fleet-deploy starting (repo: $REPO_DIR, dry-run: $DRY_RUN, log: $LOG_FILE)"

    exec 200>"$LOCK_FILE"
    if ! flock -w "$LOCK_WAIT_S" 200; then
        die "could not acquire lock $LOCK_FILE within ${LOCK_WAIT_S}s -- another fleet-deploy run appears stuck"
    fi

    push_if_ahead

    CURRENT_REV=$(git -C "$REPO_DIR" rev-parse HEAD)
    compute_changed

    if [ "$BACKEND_CHANGED" -eq 1 ]; then
        deploy_backend
    else
        log "no convex/ or frontend/ changes since last deploy -- skipping backend deploy"
    fi

    if [ "$TRACKER_CHANGED" -eq 1 ]; then
        deploy_tracker_ron
        deploy_tracker_bertha
        deploy_tracker_timmy
    else
        log "no tracker/ changes since last deploy -- skipping tracker deploy"
    fi

    health_checks

    if [ "$DRY_RUN" -eq 1 ]; then
        log "DRY-RUN: would write $CURRENT_REV to $STATE_FILE"
    else
        echo "$CURRENT_REV" > "$STATE_FILE"
        log "wrote new state: $STATE_FILE -> $CURRENT_REV"
    fi

    log "fleet-deploy complete"
}

CURRENT_REV=""
main "$@"
