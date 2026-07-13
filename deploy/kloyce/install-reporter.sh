#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
home_dir="${HOME}"
bin_dir="${home_dir}/.local/bin"
mkdir -p "${bin_dir}"
install -m 755 "${repo_dir}/chronomaxi-kloyce-reporter.py" "${bin_dir}/chronomaxi-kloyce-reporter"

case "$(uname -s)" in
  Linux)
    unit_dir="${home_dir}/.config/systemd/user"
    mkdir -p "${unit_dir}"
    sed "s#__HOME__#${home_dir}#g" "${repo_dir}/chronomaxi-kloyce-reporter.service" > "${unit_dir}/chronomaxi-kloyce-reporter.service"
    systemctl --user daemon-reload
    systemctl --user enable --now chronomaxi-kloyce-reporter.service
    systemctl --user status --no-pager chronomaxi-kloyce-reporter.service || true
    ;;
  Darwin)
    agent_dir="${home_dir}/Library/LaunchAgents"
    log_dir="${home_dir}/Library/Logs/chronomaxi-kloyce-reporter"
    mkdir -p "${agent_dir}" "${log_dir}"
    sed "s#__HOME__#${home_dir}#g" "${repo_dir}/com.pynchlabs.chronomaxi-kloyce-reporter.plist" > "${agent_dir}/com.pynchlabs.chronomaxi-kloyce-reporter.plist"
    launchctl bootout "gui/$(id -u)/com.pynchlabs.chronomaxi-kloyce-reporter" 2>/dev/null || true
    launchctl bootstrap "gui/$(id -u)" "${agent_dir}/com.pynchlabs.chronomaxi-kloyce-reporter.plist"
    launchctl enable "gui/$(id -u)/com.pynchlabs.chronomaxi-kloyce-reporter"
    launchctl kickstart -k "gui/$(id -u)/com.pynchlabs.chronomaxi-kloyce-reporter"
    launchctl print "gui/$(id -u)/com.pynchlabs.chronomaxi-kloyce-reporter" | head -40 || true
    ;;
  *)
    echo "unsupported OS" >&2
    exit 1
    ;;
esac
