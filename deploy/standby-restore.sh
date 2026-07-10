#!/usr/bin/env bash
# deploy/standby-restore.sh -- nightly cold-standby sync for big-ron.
#
# Idempotent: safe to re-run any time, by hand or from the scheduled timer.
#   1. Brings up the LOCAL VALIDATION Convex compose stack if it isn't
#      already running (deploy/docker-compose.yml + deploy/.env, ports
#      13210/13211/16791 -- same stack this repo's migration smoke tests
#      and local dev already use; see migration/README.md "Stack URLs").
#      This *is* big-ron's standby target -- there is no separate
#      "standby" deployment/INSTANCE_NAME, per the rollout's explicit
#      instruction to point at the existing local validation stack
#      pattern rather than spin up a second one.
#   2. Finds the newest backup ZIP under ~/backups/chronomaxi (rsynced in
#      nightly from big-bertha's primary export per deploy/BACKUP-RUNBOOK.md)
#      and imports it with --replace-all. This wipes+restores every table
#      on every run, which is correct here specifically because this stack
#      is a read-only cold standby, never a second live-serving instance
#      (RPO ~24h by design -- no multi-master).
#   3. Pushes convex/ schema+functions in case they drifted, since backup
#      ZIPs contain table data ONLY, never code/schema (see runbook FAQ
#      note, docs.convex.dev/database/backup-restore).
#
# Manual run:    deploy/standby-restore.sh   (or: chronomaxi-ctl local-up  then
#                this script, though this script already brings the stack up)
# Scheduled via: chronomaxi-standby-restore.timer, a systemd --user timer,
#                05:30 daily. No cron(8) daemon is installed on this host;
#                systemd user timers are the equivalent primitive already in
#                use here (qmd-update.timer, gdrive-pull.timer).
#
# Exits 0 with a log line (not an error) when no backup ZIP has arrived
# yet -- expected on a freshly-provisioned standby before bertha's first
# nightly export lands.

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="$REPO_DIR/deploy/docker-compose.yml"
COMPOSE_ENV_FILE="$REPO_DIR/deploy/.env"
BACKUP_DIR="${CHRONOMAXI_BACKUP_DIR:-$HOME/backups/chronomaxi}"
HEALTH_TIMEOUT_S=60

log() { printf '[standby-restore] %s\n' "$1"; }
die() { printf '[standby-restore] ERROR: %s\n' "$1" >&2; exit 1; }

compose() {
    docker compose -f "$COMPOSE_FILE" --env-file "$COMPOSE_ENV_FILE" "$@"
}

[ -f "$COMPOSE_ENV_FILE" ] || die "$COMPOSE_ENV_FILE not found -- copy deploy/.env.example and fill it in first"

# --- 1. bring the local validation stack up if it's down -------------------
if [ -z "$(compose ps --status running -q backend 2>/dev/null)" ]; then
    log "local validation stack is down, bringing it up"
    compose up -d
else
    log "local validation stack already up"
fi

log "waiting for backend healthcheck (up to ${HEALTH_TIMEOUT_S}s)"
backend_id=$(compose ps -q backend)
[ -n "$backend_id" ] || die "backend container did not start"
elapsed=0
while :; do
    status=$(docker inspect -f '{{.State.Health.Status}}' "$backend_id" 2>/dev/null || echo "starting")
    [ "$status" = "healthy" ] && break
    elapsed=$((elapsed + 2))
    [ "$elapsed" -ge "$HEALTH_TIMEOUT_S" ] && die "backend did not become healthy within ${HEALTH_TIMEOUT_S}s (last status: $status)"
    sleep 2
done
log "backend healthy"

# --- 2. import the newest backup ZIP ----------------------------------------
mkdir -p "$BACKUP_DIR"
LATEST=$(find "$BACKUP_DIR" -maxdepth 1 -name '*.zip' -printf '%T@ %p\n' 2>/dev/null | sort -rn | head -1 | cut -d' ' -f2-)
if [ -z "$LATEST" ]; then
    log "no backup ZIP found in $BACKUP_DIR yet -- nothing to restore, exiting"
    exit 0
fi
log "restoring from $LATEST"

# CONVEX_SELF_HOSTED_URL / CONVEX_SELF_HOSTED_ADMIN_KEY are read from the
# repo root .env.local, which already points at this same local validation
# stack (http://127.0.0.1:13210) -- see migration/README.md.
cd "$REPO_DIR"
npx convex import --replace-all -y "$LATEST"

# --- 3. push schema/functions in case they drifted (no-op if unchanged) ----
log "deploying convex/ functions (no-op if unchanged)"
npx convex deploy --typecheck disable --codegen disable

log "standby restore complete ($LATEST)"
