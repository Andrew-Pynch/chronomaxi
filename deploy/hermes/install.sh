#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
HERMES_SCRIPTS_DIR="${HERMES_SCRIPTS_DIR:-$HOME/.hermes/scripts}"
STATE_DIR="${CHRONOMAXI_HERMES_STATE_DIR:-$HOME/.hermes/chronomaxi_hermes}"
DREAM_DIR="${CHRONOMAXI_DREAM_DIR:-$HOME/chronomaxi-dreams}"
PYTHON_BIN="${PYTHON_BIN:-$(command -v python3)}"

mkdir -p "$HERMES_SCRIPTS_DIR" "$STATE_DIR" "$DREAM_DIR"
install -m 0755 "$SCRIPT_DIR/chronomaxi_hermes_connector.py" "$HERMES_SCRIPTS_DIR/chronomaxi_hermes_connector.py"
install -m 0755 "$SCRIPT_DIR/chronomaxi_dream.py" "$HERMES_SCRIPTS_DIR/chronomaxi_dream.py"
install -m 0755 "$SCRIPT_DIR/chronomaxi_steering.py" "$HERMES_SCRIPTS_DIR/chronomaxi_steering.py"

TMP_CRON="$(mktemp)"
trap 'rm -f "$TMP_CRON" "$TMP_CRON.new"' EXIT
crontab -l > "$TMP_CRON" 2>/dev/null || true
awk 'BEGIN { skip=0 } /# chronomaxi-hermes begin/ { skip=1; next } /# chronomaxi-hermes end/ { skip=0; next } skip == 0 { print }' "$TMP_CRON" > "$TMP_CRON.new"
cat >> "$TMP_CRON.new" <<CRON
# chronomaxi-hermes begin
30 3 * * * $PYTHON_BIN $HERMES_SCRIPTS_DIR/chronomaxi_dream.py >> $STATE_DIR/dream.log 2>&1
*/30 8-22 * * * $PYTHON_BIN $HERMES_SCRIPTS_DIR/chronomaxi_steering.py >> $STATE_DIR/steering.log 2>&1
# chronomaxi-hermes end
CRON
crontab "$TMP_CRON.new"

echo "Installed Chronomaxi Hermes scripts to $HERMES_SCRIPTS_DIR"
echo "Installed user crontab entries for nightly dream and steering watcher"
echo "Reports: $DREAM_DIR"
echo "State: $STATE_DIR"
