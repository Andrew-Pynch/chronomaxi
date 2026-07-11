#!/usr/bin/env zsh
# chronomaxi-foreground.zsh
#
# Push-state half of the chronomaxi tmux sub-program drill-down (see
# tracker/src/tmux.rs). Every prompt-cycle transition (about to run a
# command / back at an idle prompt) atomically rewrites
# $XDG_STATE_HOME/chronomaxi/foreground (or ~/.local/state/chronomaxi/
# foreground) with `epochms|session|pane|cmd` -- free for the tracker to
# read (no subprocess) whenever it's fresher than 10s (tmux.rs's
# PUSH_FRESHNESS), falling back to the slower tmux-IPC pull only when this
# file is missing or stale.
#
# Source this from .zshrc (installed by install.sh, same convention as
# chronomaxi-attribution.zsh -- after oh-my-zsh's own source line):
#
#   source "$HOME/.config/chronomaxi/chronomaxi-foreground.zsh"
#
# Companion piece: chronomaxi-tmux-publish.sh, invoked directly by tmux
# hooks (see install.sh's `set-hook -g` lines) for the "switched to an
# already-running pane" case this file's preexec/precmd alone can't see --
# no new command is executed on a plain focus change, so preexec never
# fires for it.
#
# Safe no-op outside zsh (guard below), on TERM=dumb, or in a
# non-interactive shell. Never blocks the shell: forks `tmux
# display-message` at most ONCE per shell (session/pane identity, cached at
# source time below), never on every prompt/command.
#
# Opt-out: CMX_FG_DISABLE=1 (this shell only) or the same standing sentinel
# file chronomaxi-attribution.zsh honors, ~/.config/chronomaxi/disable
# (this host, until removed). Checked fresh on every hook call.

# --- guard: zsh only ---
if [ -z "$ZSH_VERSION" ]; then
    return 0 2>/dev/null || exit 0
fi

# --- guard: interactive shells with a real terminal only ---
[[ -o interactive ]] || return 0
case "$TERM" in
    dumb|"") return 0 ;;
esac

autoload -Uz add-zsh-hook 2>/dev/null || return 0
zmodload zsh/datetime 2>/dev/null

# --- config ---
: "${CHRONOMAXI_HOME:=$HOME/.config/chronomaxi}"
: "${CMX_DISABLE_SENTINEL:=$CHRONOMAXI_HOME/disable}"
: "${CMX_FG_STATE_DIR:=${XDG_STATE_HOME:-$HOME/.local/state}/chronomaxi}"
CMX_FG_FILE="$CMX_FG_STATE_DIR/foreground"

# --- opt-out gate: re-checked on every call, never cached ---
cmx_fg_enabled() {
    [ -n "$CMX_FG_DISABLE" ] && return 1
    [ -f "$CMX_DISABLE_SENTINEL" ] && return 1
    return 0
}

# Session/pane identity resolved ONCE per shell at source time, not on
# every prompt -- tmux.rs's parse_push_line discards both fields today
# (only `cmd` and freshness matter to the resolver), kept here purely for
# on-disk debuggability of the push file.
if [ -n "$TMUX" ]; then
    CMX_FG_SESSION=$(tmux display-message -p '#S' 2>/dev/null)
    CMX_FG_PANE=$(tmux display-message -p '#{pane_id}' 2>/dev/null)
fi
: "${CMX_FG_SESSION:=-}"
: "${CMX_FG_PANE:=-}"

cmx_fg_now_ms() {
    if [ -n "$EPOCHREALTIME" ]; then
        printf '%.0f' $(( EPOCHREALTIME * 1000 ))
    else
        printf '%d000' "${EPOCHSECONDS:-0}"
    fi
}

# Atomic write: same-directory temp file + rename, so the tracker (reading
# concurrently, possibly mid-tick) never observes a partially-written line.
cmx_fg_write() {
    local cmd=$1
    [ -n "$cmd" ] || return 0
    mkdir -p "$CMX_FG_STATE_DIR" 2>/dev/null || return 0
    local tmp="$CMX_FG_STATE_DIR/.foreground.$$.tmp"
    print -r -- "$(cmx_fg_now_ms)|${CMX_FG_SESSION}|${CMX_FG_PANE}|${cmd}" >|"$tmp" 2>/dev/null \
        && mv -f "$tmp" "$CMX_FG_FILE" 2>/dev/null
}

# Idle-at-prompt state: published after every command finishes, right
# before the next prompt is drawn.
cmx_fg_precmd() {
    cmx_fg_enabled || return 0
    cmx_fg_write "zsh"
}

# About-to-run state: published just before exec. Uses $3 (the full,
# alias-expanded command text) for the same reason
# chronomaxi-attribution.zsh's cmx_preexec does -- zshall(1) only populates
# $1 when the history mechanism is active. tmux.rs's `normalize()` strips
# any path prefix and trailing args on the Rust side, so publishing just
# the first whitespace-delimited word here is enough.
cmx_fg_preexec() {
    cmx_fg_enabled || return 0
    local cmdline=${3:-${2:-$1}}
    local -a words
    words=(${(z)cmdline})
    local first=${words[1]}
    [ -n "$first" ] || return 0
    cmx_fg_write "$first"
}

add-zsh-hook precmd cmx_fg_precmd
add-zsh-hook preexec cmx_fg_preexec
