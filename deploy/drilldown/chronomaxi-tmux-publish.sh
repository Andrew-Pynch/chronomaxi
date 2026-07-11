#!/bin/sh
# chronomaxi-tmux-publish.sh -- writes the shared chronomaxi foreground
# push-state file directly from a tmux hook (pane-focus-in / window- or
# session-changed events -- see install.sh's `set-hook -g` lines), for the
# "switched to an already-running pane" case shell preexec/precmd
# (chronomaxi-foreground.zsh) can't see on its own: no new command is
# executed on a plain focus change, so preexec never fires for it.
#
# Invoked by tmux itself via `run-shell`, receiving tmux's own FORMATS
# expansion as argv -- tmux expands `#{...}` placeholders in run-shell's
# shell-command argument before exec'ing it, so no extra `tmux
# display-message` subprocess is needed inside this script.
#
# Usage: chronomaxi-tmux-publish.sh <session_name> <pane_id> <pane_current_command>

set -eu

session=${1:-}
pane=${2:-}
cmd=${3:-}

# pane_current_command is always non-empty for a live pane; an empty value
# here means tmux couldn't resolve one (pane mid-teardown, etc) -- skip
# rather than publish garbage.
[ -n "$cmd" ] || exit 0

# Same opt-out sentinel chronomaxi-attribution.zsh and
# chronomaxi-foreground.zsh honor.
disable_sentinel="${CHRONOMAXI_HOME:-$HOME/.config/chronomaxi}/disable"
[ -f "$disable_sentinel" ] && exit 0

state_dir="${XDG_STATE_HOME:-$HOME/.local/state}/chronomaxi"
mkdir -p "$state_dir" 2>/dev/null || exit 0

epoch_ms=$(( $(date +%s%N) / 1000000 ))

# Atomic write: same-directory temp file + rename, matching
# chronomaxi-foreground.zsh's cmx_fg_write so the tracker never observes a
# partially-written line regardless of which publisher wrote it last.
tmp="$state_dir/.foreground.$$.tmp"
printf '%s|%s|%s|%s\n' "$epoch_ms" "${session:-*}" "${pane:-*}" "$cmd" >"$tmp" 2>/dev/null || exit 0
mv -f "$tmp" "$state_dir/foreground" 2>/dev/null
