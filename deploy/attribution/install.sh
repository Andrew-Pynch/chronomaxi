#!/usr/bin/env bash
# install.sh -- per-machine installer for chronomaxi session attribution.
#
# Idempotent: re-running converges to the same end state (updates installed
# script copies and rewrites this tool's marker-guarded blocks to match the
# current repo checkout; never duplicates a block on repeat runs).
#
# This script is NOT executed against any real machine as part of building
# this deploy wave -- it is repo-side deliverable code, run later by Andrew
# himself. See --dry-run below.
#
# Usage:
#   install.sh [--dry-run] [--uninstall] [--ingest-url URL] [--ingest-secret SECRET] [--home DIR]
#
#   --dry-run          Print every change that would be made; touch nothing.
#   --uninstall        Reverse a previous install (strip marker blocks, remove
#                       installed script copies). Combine with --dry-run to
#                       preview removal first.
#   --ingest-url URL   Pre-fill CHRONOMAXI_INGEST_URL in the env file if it is
#                       being created fresh. Ignored if the env file already
#                       exists (never silently overwrites a configured value).
#   --ingest-secret S  Same, for CHRONOMAXI_INGEST_SECRET.
#   --home DIR         Override the real $HOME this script targets (default:
#                       $HOME). Intended for sandboxed testing, e.g.
#                       HOME=/tmp/fake-home or --home /tmp/fake-home.
#
# Files touched (all idempotent, marker-guarded, backed up before any edit):
#   ~/.config/chronomaxi/chronomaxi-attribution.zsh   (copied from this repo)
#   ~/.config/chronomaxi/chronomaxi-ssh-hook.sh       (copied from this repo, chmod +x)
#   ~/.config/chronomaxi/env                          (created once, never overwritten)
#   ~/.zshrc            (one guarded `source` line appended after oh-my-zsh's
#                        own source line if found, else at EOF)
#   ~/.ssh/config        (one guarded PermitLocalCommand+LocalCommand block,
#                        merged into an existing bare `Host *` block if one
#                        exists, else inserted as a new `Host *` block at the
#                        very top of the file so it applies to every target)

set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)

DRY_RUN=0
UNINSTALL=0
INGEST_URL=""
INGEST_SECRET=""
TARGET_HOME=${HOME:-}

ZSHRC_MARK_BEGIN="# >>> chronomaxi-attribution >>>"
ZSHRC_MARK_END="# <<< chronomaxi-attribution <<<"
SSH_MARK_BEGIN="# >>> chronomaxi-ssh-attribution >>>"
SSH_MARK_END="# <<< chronomaxi-ssh-attribution <<<"

usage() {
    sed -n '2,40p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
}

log() {
    printf '[chronomaxi-install] %s\n' "$1"
}

while [ $# -gt 0 ]; do
    case "$1" in
        --dry-run) DRY_RUN=1; shift ;;
        --uninstall) UNINSTALL=1; shift ;;
        --ingest-url) INGEST_URL=${2:?--ingest-url needs a value}; shift 2 ;;
        --ingest-secret) INGEST_SECRET=${2:?--ingest-secret needs a value}; shift 2 ;;
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
SSH_CONFIG="$TARGET_HOME/.ssh/config"
ENV_FILE="$CHRONOMAXI_HOME/env"
ZSH_LIB_DEST="$CHRONOMAXI_HOME/chronomaxi-attribution.zsh"
HOOK_DEST="$CHRONOMAXI_HOME/chronomaxi-ssh-hook.sh"

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
    backup="$file.pre-chronomaxi.$stamp.bak"
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

# --- 1. install script copies + env file -----------------------------------

install_scripts() {
    log "installing hook scripts to $CHRONOMAXI_HOME"
    run mkdir -p "$CHRONOMAXI_HOME"
    run cp "$SCRIPT_DIR/chronomaxi-attribution.zsh" "$ZSH_LIB_DEST"
    run cp "$SCRIPT_DIR/chronomaxi-ssh-hook.sh" "$HOOK_DEST"
    run chmod +x "$HOOK_DEST"
}

install_env_file() {
    if [ -f "$ENV_FILE" ]; then
        log "env file already exists at $ENV_FILE, leaving it untouched"
        return 0
    fi
    log "creating env file at $ENV_FILE"
    content=$(cat <<ENVEOF
# chronomaxi session-attribution config for this host.
# Not committed to git; edit the values below (or re-run install.sh with
# --ingest-url / --ingest-secret to pre-fill them).
CHRONOMAXI_INGEST_URL=${INGEST_URL:-http://big-bertha:3211}
CHRONOMAXI_INGEST_SECRET=${INGEST_SECRET:-REPLACE_ME}
ENVEOF
    )
    if [ "$DRY_RUN" -eq 1 ]; then
        write_or_preview "$ENV_FILE" "$content"
    else
        run mkdir -p "$CHRONOMAXI_HOME"
        printf '%s\n' "$content" >"$ENV_FILE"
        chmod 600 "$ENV_FILE"
        log "wrote $ENV_FILE (mode 600) -- fill in CHRONOMAXI_INGEST_SECRET before use"
    fi
}

# --- 2. ~/.zshrc: guarded source line ---------------------------------------

install_zshrc_hook() {
    source_line="source \"$ZSH_LIB_DEST\""
    block=$(printf '%s\n%s\n%s\n' "$ZSHRC_MARK_BEGIN" "$source_line" "$ZSHRC_MARK_END")

    if [ ! -f "$ZSHRC" ]; then
        log "$ZSHRC does not exist, creating it with just the chronomaxi block"
        write_or_preview "$ZSHRC" "$block"
        return 0
    fi

    # Matching the literal text "$ZSH" as it appears verbatim in
    # oh-my-zsh's own `source $ZSH/oh-my-zsh.sh` line inside the elif
    # below, not expanding a variable in THIS script.
    # shellcheck disable=SC2016
    if grep -qF "$ZSHRC_MARK_BEGIN" "$ZSHRC"; then
        log "existing chronomaxi block found in $ZSHRC, refreshing it in place"
        new_content=$(awk -v begin="$ZSHRC_MARK_BEGIN" -v end="$ZSHRC_MARK_END" -v block="$block" '
            $0 == begin { printf "%s", block; in_block = 1; next }
            in_block == 1 { if ($0 == end) { in_block = 0 }; next }
            { print }
        ' "$ZSHRC")
    elif grep -qE '^[[:space:]]*source[[:space:]]+\$ZSH/oh-my-zsh\.sh' "$ZSHRC"; then
        log "adding chronomaxi source line to $ZSHRC after the oh-my-zsh source line"
        new_content=$(awk -v begin="$ZSHRC_MARK_BEGIN" -v end="$ZSHRC_MARK_END" -v line="$source_line" '
            { print }
            /^[[:space:]]*source[[:space:]]+\$ZSH\/oh-my-zsh\.sh/ && !done {
                print begin; print line; print end; done = 1
            }
        ' "$ZSHRC")
    else
        log "adding chronomaxi source line to end of $ZSHRC (no oh-my-zsh source line found)"
        new_content=$(cat "$ZSHRC"; printf '\n%s\n' "$block")
    fi

    backup_file "$ZSHRC"
    write_or_preview_diff "$ZSHRC" "$new_content"
}

uninstall_zshrc_hook() {
    [ -f "$ZSHRC" ] || return 0
    grep -qF "$ZSHRC_MARK_BEGIN" "$ZSHRC" || { log "no chronomaxi block in $ZSHRC"; return 0; }
    new_content=$(awk -v begin="$ZSHRC_MARK_BEGIN" -v end="$ZSHRC_MARK_END" '
        $0 == begin { in_block = 1; next }
        in_block == 1 { if ($0 == end) { in_block = 0 }; next }
        { print }
    ' "$ZSHRC")
    backup_file "$ZSHRC"
    write_or_preview_diff "$ZSHRC" "$new_content"
    [ "$DRY_RUN" -eq 1 ] || log "removed chronomaxi block from $ZSHRC"
}

# --- 3. ~/.ssh/config: merge into or create a `Host *` block ---------------

ssh_directives() {
    printf '    PermitLocalCommand yes\n    LocalCommand %s %%n %%h %%p %%r %%L\n' "$HOOK_DEST"
}

install_ssh_config_hook() {
    if [ ! -f "$SSH_CONFIG" ]; then
        log "$SSH_CONFIG does not exist, creating it with a new Host * block"
        new_content=$(printf '%s\nHost *\n%s\n%s\n' "$SSH_MARK_BEGIN" "$(ssh_directives)" "$SSH_MARK_END")
        if [ "$DRY_RUN" -eq 1 ]; then
            echo "DRY-RUN: mkdir -p $(dirname "$SSH_CONFIG")"
            write_or_preview "$SSH_CONFIG" "$new_content"
        else
            mkdir -p "$(dirname "$SSH_CONFIG")"
            chmod 700 "$(dirname "$SSH_CONFIG")"
            printf '%s\n' "$new_content" >"$SSH_CONFIG"
            chmod 600 "$SSH_CONFIG"
        fi
        return 0
    fi

    if grep -qF "$SSH_MARK_BEGIN" "$SSH_CONFIG"; then
        log "existing chronomaxi block found in $SSH_CONFIG, refreshing it in place"
        new_content=$(awk -v begin="$SSH_MARK_BEGIN" -v end="$SSH_MARK_END" -v directives="$(ssh_directives)" '
            $0 == begin { print; print directives; in_block = 1; next }
            in_block == 1 { if ($0 == end) { print; in_block = 0 }; next }
            { print }
        ' "$SSH_CONFIG")
    elif grep -qE '^[[:space:]]*[Hh][Oo][Ss][Tt][[:space:]]+\*[[:space:]]*$' "$SSH_CONFIG"; then
        log "existing bare 'Host *' block found in $SSH_CONFIG, merging our directives into it"
        new_content=$(awk -v begin="$SSH_MARK_BEGIN" -v end="$SSH_MARK_END" -v directives="$(ssh_directives)" '
            /^[[:space:]]*[Hh][Oo][Ss][Tt][[:space:]]+\*[[:space:]]*$/ && !done {
                print; print begin; print directives; print end; done = 1; next
            }
            { print }
        ' "$SSH_CONFIG")
    else
        log "no bare 'Host *' block in $SSH_CONFIG, inserting a new one at the top (first-match-wins in ssh_config, so this must lead the file to apply to every host)"
        new_block=$(printf '%s\nHost *\n%s\n%s\n' "$SSH_MARK_BEGIN" "$(ssh_directives)" "$SSH_MARK_END")
        new_content=$(printf '%s\n\n%s' "$new_block" "$(cat "$SSH_CONFIG")")
    fi

    backup_file "$SSH_CONFIG"
    write_or_preview_diff "$SSH_CONFIG" "$new_content"
    if [ "$DRY_RUN" -ne 1 ]; then
        chmod 600 "$SSH_CONFIG"
    fi
}

uninstall_ssh_config_hook() {
    [ -f "$SSH_CONFIG" ] || return 0
    grep -qF "$SSH_MARK_BEGIN" "$SSH_CONFIG" || { log "no chronomaxi block in $SSH_CONFIG"; return 0; }
    new_content=$(awk -v begin="$SSH_MARK_BEGIN" -v end="$SSH_MARK_END" '
        $0 == begin { in_block = 1; next }
        in_block == 1 { if ($0 == end) { in_block = 0 }; next }
        { print }
    ' "$SSH_CONFIG")
    backup_file "$SSH_CONFIG"
    write_or_preview_diff "$SSH_CONFIG" "$new_content"
    [ "$DRY_RUN" -eq 1 ] || log "removed chronomaxi block from $SSH_CONFIG"
}

uninstall_scripts() {
    for f in "$ZSH_LIB_DEST" "$HOOK_DEST"; do
        [ -e "$f" ] || continue
        run rm -f "$f"
    done
    log "left $ENV_FILE and $CHRONOMAXI_HOME/disable (if any) in place -- remove $CHRONOMAXI_HOME by hand if you want a full wipe"
}

do_install() {
    log "target home: $TARGET_HOME (dry-run: $DRY_RUN)"
    install_scripts
    install_env_file
    install_zshrc_hook
    install_ssh_config_hook
    log "done. Open a new shell (or 'exec zsh') to pick up the title hook."
    log "Edit $ENV_FILE and set CHRONOMAXI_INGEST_SECRET before lifecycle events will send."
}

do_uninstall() {
    log "uninstalling from target home: $TARGET_HOME (dry-run: $DRY_RUN)"
    uninstall_zshrc_hook
    uninstall_ssh_config_hook
    uninstall_scripts
    log "done. $ENV_FILE was left in place (may contain a configured secret); remove it by hand if desired."
}

if [ "$UNINSTALL" -eq 1 ]; then
    do_uninstall
else
    do_install
fi
