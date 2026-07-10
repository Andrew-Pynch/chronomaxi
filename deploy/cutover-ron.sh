#!/usr/bin/env bash
# deploy/cutover-ron.sh -- big-ron cutover to central hosting.
#
# NOT executed as part of this rollout wave -- prep only. Main runs this
# AFTER the historical migration for ron-live (and ron-demo, if in scope)
# reaches checkpoint status=complete AND `bun run verify.ts` prints
# "ALL CHECKS PASSED" for that dataset -- see migration/README.md's HARD
# ORDERING GATE. Running this before that gate clears means losing every
# row written between the migration's frozen watermark and this cutover,
# with no way to reconcile the gap afterward (the source stops being
# written to `Log` the instant the tracker below restarts against central
# ingest instead) -- import.ts's own header comment enforces the same
# boundary independently.
#
# Steps:
#   1. Stop + disable chronomaxi-web.service (OLD local dashboard, port
#      3001) -- the dashboard now lives on big-bertha, served over
#      tailscale at https://big-bertha.tail3f4961.ts.net:8443.
#   2. Rewrite ~/.config/systemd/user/chronomaxi-tracker.service to the
#      EnvironmentFile-based shape (mirrors the repo-root
#      chronomaxi-tracker.service template, real paths resolved, with
#      CHRONOMAXI_INGEST_URL/SECRET/ACTOR sourced from
#      %h/.config/chronomaxi/env -- installed and live-verified by
#      deploy/attribution/install.sh already -- instead of separate
#      placeholder Environment= lines), daemon-reload, restart the
#      tracker.
#   3. Verify the restarted tracker is actually flushing to central
#      ingest by tailing its journal for "chronomaxi ingest: flushed"
#      (see tracker/src/ingest/mod.rs's run_flusher, POLL_INTERVAL 10s)
#      within a bounded timeout. A refusal to confirm this is a hard
#      failure, not a warning -- silently leaving the tracker writing
#      into a black hole is worse than a loud stop.
#
# Re-run safety: steps 1-2 are idempotent (systemctl disable/stop on an
# already-stopped unit no-ops; the unit file is regenerated from a fixed
# template every run, never patched). Step 3 always re-checks fresh
# journal state, so a re-run after a real fix will confirm cleanly.

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UNIT_DIR="$HOME/.config/systemd/user"
TRACKER_UNIT="$UNIT_DIR/chronomaxi-tracker.service"
ENV_FILE="$HOME/.config/chronomaxi/env"
FLUSH_TIMEOUT_S=120

log() { printf '[cutover-ron] %s\n' "$1"; }
die() { printf '[cutover-ron] ERROR: %s\n' "$1" >&2; exit 1; }

[ -f "$ENV_FILE" ] || die "$ENV_FILE not found -- run deploy/attribution/install.sh first (rollout step 1)"
grep -q '^CHRONOMAXI_INGEST_URL=http://big-bertha:3211$' "$ENV_FILE" \
    || die "$ENV_FILE's CHRONOMAXI_INGEST_URL isn't the expected central endpoint -- check it before cutting over"
grep -qE '^CHRONOMAXI_INGEST_SECRET=.+' "$ENV_FILE" && ! grep -q '^CHRONOMAXI_INGEST_SECRET=REPLACE_ME$' "$ENV_FILE" \
    || die "$ENV_FILE has no real CHRONOMAXI_INGEST_SECRET (still unset/REPLACE_ME) -- mirror it from big-bertha first"
[ -x "$REPO_DIR/tracker/target/release/backend" ] \
    || die "$REPO_DIR/tracker/target/release/backend not built -- cargo build --release in tracker/ first"

# --- 1. retire the old local dashboard --------------------------------------
log "stopping + disabling chronomaxi-web.service (dashboard moved to big-bertha)"
systemctl --user disable --now chronomaxi-web.service 2>&1 | sed 's/^/[cutover-ron]   /' || true

# --- 2. repoint the tracker at central ingest -------------------------------
log "rewriting $TRACKER_UNIT to the EnvironmentFile-based template"
cat >"$TRACKER_UNIT" <<UNIT
[Unit]
Description=Chrono Maxi Time Tracker
After=network.target graphical-session.target

[Service]
ExecStart=$REPO_DIR/tracker/target/release/backend
WorkingDirectory=$REPO_DIR/tracker
EnvironmentFile=%h/.config/chronomaxi/env
Environment="RUST_BACKTRACE=1"
Environment="CHRONOMAXI_DEVICE_NAME=big-ron"
Restart=always
RestartSec=10

[Install]
WantedBy=default.target
UNIT

log "daemon-reload + (re)start chronomaxi-tracker.service"
systemctl --user daemon-reload
systemctl --user enable chronomaxi-tracker.service
systemctl --user restart chronomaxi-tracker.service

sleep 2
systemctl --user is-active --quiet chronomaxi-tracker.service \
    || die "chronomaxi-tracker.service did not come up after restart -- check: journalctl --user -u chronomaxi-tracker -n 50"

# --- 3. verify the tracker is actually flushing to central ingest ----------
log "waiting up to ${FLUSH_TIMEOUT_S}s for a 'flushed' log line from the restarted tracker"
restart_ts=$(date -Is)
elapsed=0
until journalctl --user -u chronomaxi-tracker.service --since "$restart_ts" --no-pager 2>/dev/null | grep -q 'chronomaxi ingest: flushed'; do
    elapsed=$((elapsed + 5))
    if [ "$elapsed" -ge "$FLUSH_TIMEOUT_S" ]; then
        die "no 'flushed' log line from chronomaxi-tracker within ${FLUSH_TIMEOUT_S}s of restart -- central ingest is NOT confirmed. Check: journalctl --user -u chronomaxi-tracker -f, and curl connectivity to \$CHRONOMAXI_INGEST_URL"
    fi
    sleep 5
done
log "confirmed: tracker is flushing spans to central ingest ($ENV_FILE -> big-bertha:3211)"
log "cutover complete. Once satisfied, tear down the local validation stack: chronomaxi-ctl local-down (keeps volumes)"
