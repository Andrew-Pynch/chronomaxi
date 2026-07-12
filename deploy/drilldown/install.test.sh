#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REAL_TMUX=$(command -v tmux) || {
    echo "tmux is required" >&2
    exit 1
}

TMP_DIR=$(mktemp -d)
TEST_HOME="$TMP_DIR/home"
TEST_BIN="$TMP_DIR/bin"
SOCKET="cmx-install-test-$$"

cleanup() {
    "$REAL_TMUX" -L "$SOCKET" kill-server >/dev/null 2>&1 || true
    rm -rf "$TMP_DIR"
}
trap cleanup EXIT

mkdir -p "$TEST_HOME" "$TEST_BIN"
# shellcheck disable=SC2016
printf 'source $ZSH/oh-my-zsh.sh\n' > "$TEST_HOME/.zshrc"
printf 'set -g status on\n' > "$TEST_HOME/.tmux.conf"

"$REAL_TMUX" -L "$SOCKET" -f /dev/null new-session -d -s cmx-test
cat > "$TEST_BIN/tmux" <<EOF
#!/bin/sh
exec "$REAL_TMUX" -L "$SOCKET" "\$@"
EOF
chmod +x "$TEST_BIN/tmux"

run_installer() {
    PATH="$TEST_BIN:$PATH" bash "$SCRIPT_DIR/install.sh" --home "$TEST_HOME" "$@"
}

run_installer
run_installer

[ "$(grep -c '^# >>> chronomaxi-drilldown >>>$' "$TEST_HOME/.tmux.conf")" -eq 1 ]
[ "$(grep -c '^# >>> chronomaxi-drilldown >>>$' "$TEST_HOME/.zshrc")" -eq 1 ]

"$REAL_TMUX" -L "$SOCKET" source-file "$TEST_HOME/.tmux.conf"
hook=$("$REAL_TMUX" -L "$SOCKET" show-hooks -g after-select-pane)
case "$hook" in
    *'\"#{session_name}\"'*'\"#{pane_id}\"'*'\"#{pane_current_command}\"'*) ;;
    *)
        echo "tmux stripped drilldown argument quotes: $hook" >&2
        exit 1
        ;;
esac

run_installer --uninstall
if grep -q '^# >>> chronomaxi-drilldown >>>$' "$TEST_HOME/.tmux.conf" ||
    grep -q '^# >>> chronomaxi-drilldown >>>$' "$TEST_HOME/.zshrc"; then
    echo "uninstall left a marker block behind" >&2
    exit 1
fi
[ ! -e "$TEST_HOME/.config/chronomaxi/chronomaxi-foreground.zsh" ]
[ ! -e "$TEST_HOME/.config/chronomaxi/chronomaxi-tmux-publish.sh" ]

echo "drilldown installer regression test passed"
