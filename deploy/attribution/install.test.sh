#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT

fail() {
    echo "attribution installer test: $1" >&2
    exit 1
}

assert_installed_config() {
    local home=$1
    local config="$home/.ssh/config"
    local expanded

    [ "$(grep -c '^# >>> chronomaxi-ssh-attribution >>>$' "$config")" -eq 1 ] ||
        fail "expected one SSH marker block"
    [ "$(grep -c '^[[:space:]]*Host \*[[:space:]]*$' "$config")" -eq 1 ] ||
        fail "expected one Host * block"

    expanded=$(ssh -G -F "$config" example.invalid 2>/dev/null)
    grep -q '^permitlocalcommand yes$' <<<"$expanded" ||
        fail "PermitLocalCommand was not enabled"
    grep -q "^localcommand $home/.config/chronomaxi/chronomaxi-ssh-hook.sh %n %h %p %r %L$" <<<"$expanded" ||
        fail "LocalCommand did not resolve to the installed hook"
}

run_installer() {
    local home=$1
    shift
    bash "$SCRIPT_DIR/install.sh" --home "$home" "$@"
}

standalone_home="$TMP_DIR/standalone"
mkdir -p "$standalone_home"
run_installer "$standalone_home"
run_installer "$standalone_home"
assert_installed_config "$standalone_home"
run_installer "$standalone_home" --uninstall
if grep -q '^# >>> chronomaxi-ssh-attribution >>>$' "$standalone_home/.ssh/config"; then
    fail "standalone uninstall left its marker block"
fi

merged_home="$TMP_DIR/merged"
mkdir -p "$merged_home/.ssh"
cat > "$merged_home/.zshrc" <<'EOF'
source $ZSH/oh-my-zsh.sh
# User configuration
EOF
cat > "$merged_home/.ssh/config" <<'EOF'
Host *
    ServerAliveInterval 30

Host example
    HostName example.invalid
EOF
run_installer "$merged_home"
run_installer "$merged_home"
assert_installed_config "$merged_home"
grep -q '^[[:space:]]*ServerAliveInterval 30$' "$merged_home/.ssh/config" ||
    fail "existing Host * directive was lost"
grep -q '^# User configuration$' "$merged_home/.zshrc" ||
    fail "zsh marker refresh consumed the following line"
run_installer "$merged_home" --uninstall
grep -q '^[[:space:]]*Host \*[[:space:]]*$' "$merged_home/.ssh/config" ||
    fail "merged uninstall removed the pre-existing Host * block"
grep -q '^[[:space:]]*ServerAliveInterval 30$' "$merged_home/.ssh/config" ||
    fail "merged uninstall removed an existing directive"

echo "attribution installer tests passed"
