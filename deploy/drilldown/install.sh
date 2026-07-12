#!/usr/bin/env bash
# install.sh -- per-machine installer for the chronomaxi tmux sub-program
# drill-down (see tracker/src/tmux.rs and the sibling scripts in this
# directory).
#
# Idempotent: re-running converges to the same end state (updates installed
# script copies and rewrites this tool's marker-guarded blocks to match the
# current repo checkout; never duplicates a block on repeat runs). Applies
# tmux hooks to a currently-running tmux server too (via `tmux set-hook`
# directly, never `source-file` / `kill-server`), so an already-attached
# session picks up drill-down without anyone's panes being disturbed or the
# server restarted.
#
# Usage:
#   install.sh [--dry-run] [--uninstall] [--home DIR]
#
#   --dry-run     Print every change that would be made; touch nothing.
#   --uninstall   Reverse a previous install (strip marker blocks, remove
#                 installed script copies, unset the live tmux hooks).
#                 Combine with --dry-run to preview removal first.
#   --home DIR    Override the real $HOME this script targets (default:
#                 $HOME). Intended for sandboxed testing, e.g.
#                 HOME=/tmp/fake-home or --home /tmp/fake-home.
#
# Files touched (all idempotent, marker-guarded, backed up before any edit):
#   ~/.config/chronomaxi/chronomaxi-foreground.zsh   (copied from this repo)
#   ~/.config/chronomaxi/chronomaxi-tmux-publish.sh  (copied from this repo, chmod +x)
#   ~/.zshrc           (one guarded `source` line appended after oh-my-zsh's
#                       own source line if found, else at EOF)
#   ~/.tmux.conf        (one guarded block: `focus-events on` + five
#                       `set-hook -g` lines, so a freshly started tmux
#                       server also gets drill-down without re-running this
#                       script)
#
# Live tmux server (skipped entirely if none is reachable):
#   `tmux set-option -g focus-events on` and five `tmux set-hook -g ...`
#   commands, applied directly against the running server -- never
#   `source-file` (would replay every other line of ~/.tmux.conf) and never
#   `kill-server` (would drop every attached client's session).

set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)

DRY_RUN=0
UNINSTALL=0
TARGET_HOME=${HOME:-}

ZSHRC_MARK_BEGIN="# >>> chronomaxi-drilldown >>>"
ZSHRC_MARK_END="# <<< chronomaxi-drilldown <<<"
TMUX_MARK_BEGIN="# >>> chronomaxi-drilldown >>>"
TMUX_MARK_END="# <<< chronomaxi-drilldown <<<"

# Fired on: focus entering a pane (needs focus-events on, set alongside
# these hooks below), and four command-completion signals that cover
# keyboard/mouse pane or window switches even when a terminal emulator
# doesn't report OSC focus events. Every hook runs the same publisher with
# tmux's own FORMATS expansion as argv -- see chronomaxi-tmux-publish.sh.
TMUX_HOOK_NAMES=(pane-focus-in after-select-pane after-select-window client-session-changed session-window-changed)

usage() {
    sed -n '2,32p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
}

log() {
    printf '[chronomaxi-drilldown-install] %s\n' "$1"
}

while [ $# -gt 0 ]; do
    case "$1" in
        --dry-run) DRY_RUN=1; shift ;;
        --uninstall) UNINSTALL=1; shift ;;
        --home) TARGET_HOME=${2:?--home needs a value}; shift 2 ;;
        -h|--help) usage; exit 0 ;;
        *) echo "unknown argument: $1" >&2; usage >&2; exit 1 ;;
    esac
done

if [ -z "$TARGET_HOME" ]; then
    echo "error: could not determine target home directory (set \$HOME or pass --home)" >&2
    exit 1
fi

CHRONOMAXI_HOME="$TARGET_HOME/.config/chronomaxi"
ZSHRC="$TARGET_HOME/.zshrc"
TMUX_CONF="$TARGET_HOME/.tmux.conf"
ZSH_LIB_DEST="$CHRONOMAXI_HOME/chronomaxi-foreground.zsh"
TMUX_PUB_DEST="$CHRONOMAXI_HOME/chronomaxi-tmux-publish.sh"

run() {
    # Execute a mutating step, or just describe it under --dry-run.
    if [ "$DRY_RUN" -eq 1 ]; then
        echo "DRY-RUN: $*"
    else
        "$@"
    fi
}

backup_file() {
    file=$1
    [ -f "$file" ] || return 0
    stamp=$(date +%Y%m%dT%H%M%S)
    backup="$file.pre-chronomaxi-drilldown.$stamp.bak"
    if [ "$DRY_RUN" -eq 1 ]; then
        echo "DRY-RUN: cp -p '$file' '$backup'"
    else
        cp -p "$file" "$backup"
        log "backed up $file -> $backup"
    fi
}

preview_lines() {
    # Print $1 (a possibly multi-line string) prefixed for a dry-run preview.
    while IFS= read -r line; do
        printf '  | %s\n' "$line"
    done <<<"$1"
}

write_or_preview() {
    # $1 = target path (may not exist yet), $2 = full content to write.
    if [ "$DRY_RUN" -eq 1 ]; then
        echo "DRY-RUN: write $1 with:"
        preview_lines "$2"
    else
        printf '%s\n' "$2" >"$1"
    fi
}

write_or_preview_diff() {
    # $1 = target path (must currently exist), $2 = new full content.
    if [ "$DRY_RUN" -eq 1 ]; then
        echo "DRY-RUN: rewrite $1 (diff vs current):"
        diff -u "$1" <(printf '%s\n' "$2") || true
    else
        printf '%s\n' "$2" >"$1"
    fi
}

# --- 1. install script copies -----------------------------------------------

install_scripts() {
    log "installing drill-down scripts to $CHRONOMAXI_HOME"
    run mkdir -p "$CHRONOMAXI_HOME"
    run cp "$SCRIPT_DIR/chronomaxi-foreground.zsh" "$ZSH_LIB_DEST"
    run cp "$SCRIPT_DIR/chronomaxi-tmux-publish.sh" "$TMUX_PUB_DEST"
    run chmod +x "$TMUX_PUB_DEST"
}

# --- 2. ~/.zshrc: guarded source line ---------------------------------------

install_zshrc_hook() {
    source_line="source \"$ZSH_LIB_DEST\""
    block=$(printf '%s\n%s\n%s\n' "$ZSHRC_MARK_BEGIN" "$source_line" "$ZSHRC_MARK_END")
    # shellcheck disable=SC2016
    oh_my_zsh_pattern='^[[:space:]]*source[[:space:]]+\$ZSH/oh-my-zsh\.sh'

    if [ ! -f "$ZSHRC" ]; then
        log "$ZSHRC does not exist, creating it with just the chronomaxi-drilldown block"
        write_or_preview "$ZSHRC" "$block"
        return 0
    fi

    if grep -qF "$ZSHRC_MARK_BEGIN" "$ZSHRC"; then
        log "existing chronomaxi-drilldown block found in $ZSHRC, refreshing it in place"
        # See chronomaxi-attribution's install.sh for why this goes through
        # ENVIRON[] rather than an awk -v assignment (macOS BWK-awk rejects
        # a literal embedded newline in -v).
        new_content=$(CHRONOMAXI_AWK_BLOCK="$block" awk -v begin="$ZSHRC_MARK_BEGIN" -v end="$ZSHRC_MARK_END" '
            $0 == begin { printf "%s", ENVIRON["CHRONOMAXI_AWK_BLOCK"]; in_block = 1; next }
            in_block == 1 { if ($0 == end) { in_block = 0 }; next }
            { print }
        ' "$ZSHRC")
    elif grep -qE "$oh_my_zsh_pattern" "$ZSHRC"; then
        log "adding chronomaxi-drilldown source line to $ZSHRC after the oh-my-zsh source line"
        new_content=$(awk -v begin="$ZSHRC_MARK_BEGIN" -v end="$ZSHRC_MARK_END" -v line="$source_line" '
            { print }
            /^[[:space:]]*source[[:space:]]+\$ZSH\/oh-my-zsh\.sh/ && !done {
                print begin; print line; print end; done = 1
            }
        ' "$ZSHRC")
    else
        log "adding chronomaxi-drilldown source line to end of $ZSHRC (no oh-my-zsh source line found)"
        new_content=$(cat "$ZSHRC"; printf '\n%s\n' "$block")
    fi

    backup_file "$ZSHRC"
    write_or_preview_diff "$ZSHRC" "$new_content"
}

uninstall_zshrc_hook() {
    [ -f "$ZSHRC" ] || return 0
    grep -qF "$ZSHRC_MARK_BEGIN" "$ZSHRC" || { log "no chronomaxi-drilldown block in $ZSHRC"; return 0; }
    new_content=$(awk -v begin="$ZSHRC_MARK_BEGIN" -v end="$ZSHRC_MARK_END" '
        $0 == begin { in_block = 1; next }
        in_block == 1 { if ($0 == end) { in_block = 0 }; next }
        { print }
    ' "$ZSHRC")
    backup_file "$ZSHRC"
    write_or_preview_diff "$ZSHRC" "$new_content"
    [ "$DRY_RUN" -eq 1 ] || log "removed chronomaxi-drilldown block from $ZSHRC"
}

# --- 3. ~/.tmux.conf: guarded block + live-server application --------------

tmux_hook_command() {
    # $1 = hook name. Prints one full `set-hook -g ...` line. Double quotes
    # around each #{...} placeholder survive tmux's own quote-stripping (see
    # the module-doc comment in chronomaxi-tmux-publish.sh) so a pane
    # command containing whitespace is still passed to the script as one
    # argument.
    printf 'set-hook -g %s "run-shell -b '\''%s \\\"#{session_name}\\\" \\\"#{pane_id}\\\" \\\"#{pane_current_command}\\\"'\''"' \
        "$1" "$TMUX_PUB_DEST"
}

tmux_block_lines() {
    printf 'set -g focus-events on\n'
    for hook in "${TMUX_HOOK_NAMES[@]}"; do
        tmux_hook_command "$hook"
        printf '\n'
    done
}

install_tmux_conf_hook() {
    block=$(printf '%s\n%s\n%s\n' "$TMUX_MARK_BEGIN" "$(tmux_block_lines)" "$TMUX_MARK_END")

    if [ ! -f "$TMUX_CONF" ]; then
        log "$TMUX_CONF does not exist, creating it with just the chronomaxi-drilldown block"
        write_or_preview "$TMUX_CONF" "$block"
        return 0
    fi

    if grep -qF "$TMUX_MARK_BEGIN" "$TMUX_CONF"; then
        log "existing chronomaxi-drilldown block found in $TMUX_CONF, refreshing it in place"
        new_content=$(CHRONOMAXI_AWK_BLOCK="$block" awk -v begin="$TMUX_MARK_BEGIN" -v end="$TMUX_MARK_END" '
            $0 == begin { printf "%s", ENVIRON["CHRONOMAXI_AWK_BLOCK"]; in_block = 1; next }
            in_block == 1 { if ($0 == end) { in_block = 0 }; next }
            { print }
        ' "$TMUX_CONF")
    else
        log "appending chronomaxi-drilldown block to end of $TMUX_CONF"
        new_content=$(cat "$TMUX_CONF"; printf '\n%s\n' "$block")
    fi

    backup_file "$TMUX_CONF"
    write_or_preview_diff "$TMUX_CONF" "$new_content"
}

uninstall_tmux_conf_hook() {
    [ -f "$TMUX_CONF" ] || return 0
    grep -qF "$TMUX_MARK_BEGIN" "$TMUX_CONF" || { log "no chronomaxi-drilldown block in $TMUX_CONF"; return 0; }
    new_content=$(awk -v begin="$TMUX_MARK_BEGIN" -v end="$TMUX_MARK_END" '
        $0 == begin { in_block = 1; next }
        in_block == 1 { if ($0 == end) { in_block = 0 }; next }
        { print }
    ' "$TMUX_CONF")
    backup_file "$TMUX_CONF"
    write_or_preview_diff "$TMUX_CONF" "$new_content"
    [ "$DRY_RUN" -eq 1 ] || log "removed chronomaxi-drilldown block from $TMUX_CONF"
}

tmux_server_reachable() {
    command -v tmux >/dev/null 2>&1 || return 1
    tmux -S "${TMUX_SOCKET:-}" info >/dev/null 2>&1 && return 0
    tmux info >/dev/null 2>&1
}

apply_tmux_live() {
    if ! tmux_server_reachable; then
        log "no live tmux server reachable, skipping live hook application (picked up on next tmux start from $TMUX_CONF)"
        return 0
    fi
    log "applying drill-down hooks to the live tmux server (no restart, no client disturbed)"
    run tmux set-option -g focus-events on
    for hook in "${TMUX_HOOK_NAMES[@]}"; do
        cmd=$(tmux_hook_command "$hook")
        if [ "$DRY_RUN" -eq 1 ]; then
            echo "DRY-RUN: tmux $cmd"
        else
            # shellcheck disable=SC2086
            eval "tmux $cmd"
        fi
    done
}

unapply_tmux_live() {
    if ! tmux_server_reachable; then
        log "no live tmux server reachable, nothing to unset"
        return 0
    fi
    log "unsetting drill-down hooks on the live tmux server"
    for hook in "${TMUX_HOOK_NAMES[@]}"; do
        run tmux set-hook -gu "$hook"
    done
}

uninstall_scripts() {
    for f in "$ZSH_LIB_DEST" "$TMUX_PUB_DEST"; do
        [ -e "$f" ] || continue
        run rm -f "$f"
    done
}

do_install() {
    log "target home: $TARGET_HOME (dry-run: $DRY_RUN)"
    install_scripts
    install_zshrc_hook
    install_tmux_conf_hook
    apply_tmux_live
    log "done. Open a new shell (or 'exec zsh') to pick up the foreground publisher; tmux hooks are already live."
}

do_uninstall() {
    log "uninstalling from target home: $TARGET_HOME (dry-run: $DRY_RUN)"
    unapply_tmux_live
    uninstall_zshrc_hook
    uninstall_tmux_conf_hook
    uninstall_scripts
    log "done."
}

if [ "$UNINSTALL" -eq 1 ]; then
    do_uninstall
else
    do_install
fi
