#!/usr/bin/env zsh
# chronomaxi-attribution.zsh
#
# Shared zsh hook library for chronomaxi session-attribution mechanism 1
# (terminal title tags). Source this from .zshrc AFTER oh-my-zsh (or any
# other framework's own title support) so our precmd/preexec hooks register
# last and win the final title write of each prompt cycle:
#
#   source "$HOME/.config/chronomaxi/chronomaxi-attribution.zsh"
#
# This is a DISPLAY-ONLY mechanism. It never makes a network call and never
# blocks the shell. Lifecycle events (start/end POSTs) are a separate,
# independent mechanism handled entirely by chronomaxi-ssh-hook.sh via
# ssh_config's LocalCommand -- see deploy/attribution/README.md.
#
# Safety property (see README.md threat model): actor is resolved FRESH on
# every hook invocation from the CURRENT shell's own environment, never
# cached or exported as a static default. A human's ordinary interactive
# shell is never a descendant of the omp harness process tree, so OMPCODE is
# structurally absent there and cmx_actor() always returns "human". Do not
# "fix" this by exporting a default actor anywhere in an rc file -- that is
# exactly the global-mislabel failure mode this design avoids.
#
# Opt-out: CMX_SSH_TRACK_DISABLE=1 (this shell only) or a standing sentinel
# file at ~/.config/chronomaxi/disable (this host, until removed) suppress
# every title write here. Checked fresh on every precmd/preexec, never
# cached at source time.

# --- guard: zsh only ---
# Everything below this line uses zsh-only syntax (add-zsh-hook, [[ -o ]],
# ${(z)...} word splitting). A non-zsh interpreter that sources this file
# never parses past this early return, so this guard is what makes the file
# a true no-op under bash/sh/dash/ksh, not just under a stray syntax error.
if [ -z "$ZSH_VERSION" ]; then
    return 0 2>/dev/null || exit 0
fi

# --- guard: interactive shells with a real terminal only ---
[[ -o interactive ]] || return 0
case "$TERM" in
    dumb|"") return 0 ;;
esac

autoload -Uz add-zsh-hook 2>/dev/null || return 0

# --- config ---
: "${CHRONOMAXI_HOME:=$HOME/.config/chronomaxi}"
: "${CMX_DISABLE_SENTINEL:=$CHRONOMAXI_HOME/disable}"

# --- opt-out gate: re-checked on every call, never cached ---
cmx_enabled() {
    [ -n "$CMX_SSH_TRACK_DISABLE" ] && return 1
    [ -f "$CMX_DISABLE_SENTINEL" ] && return 1
    return 0
}

# --- actor: pure function of the live environment, resolved on every call ---
# CMX_ACTOR_OVERRIDE > (OMPCODE set ? agent:<CMX_AGENT_NAME|unknown> : human)
cmx_actor() {
    if [ -n "$CMX_ACTOR_OVERRIDE" ]; then
        printf '%s' "$CMX_ACTOR_OVERRIDE"
        return 0
    fi
    if [ -n "$OMPCODE" ]; then
        if [ -n "$CMX_AGENT_NAME" ]; then
            printf 'agent:%s' "$CMX_AGENT_NAME"
        else
            printf 'agent:unknown'
        fi
    else
        printf 'human'
    fi
}

# 8 lowercase hex chars. Not cryptographic, just a short per-span
# correlator; falls back to zsh's built-in $RANDOM if /dev/urandom is
# unreadable (should not happen on any of our 3 hosts, defensive only).
cmx_gen_sid() {
    if [ -r /dev/urandom ]; then
        od -An -tx1 -N4 /dev/urandom 2>/dev/null | tr -d ' \n'
    else
        printf '%08x' $(( (RANDOM << 17) ^ (RANDOM << 3) ^ RANDOM ))
    fi
}

cmx_emit_title() {
    local actor host to
    actor=$(cmx_actor)
    host=${HOST:-$(hostname -s 2>/dev/null)}
    to=${CMX_SSH_TARGET:--}
    print -Pn "\e]2;cmx|actor=${actor}|host=${host}|to=${to}|sid=${CMX_SID}\a"
}

# Idle state: no ssh in flight. Runs after every command finishes, right
# before the next prompt is drawn. Always clears CMX_SSH_TARGET/CMX_SSH_SID
# so a later unrelated command in the same shell never inherits a stale
# correlator from a prior ssh invocation.
cmx_precmd() {
    cmx_enabled || return 0
    unset CMX_SSH_TARGET CMX_SSH_SID
    CMX_SID=$(cmx_gen_sid)
    cmx_emit_title
}

# Active state: about to exec the resolved command line. If it looks like an
# ssh/mosh/autossh invocation, extract a best-effort target for cosmetic
# display (the authoritative target comes from ssh_config's own %h/%n
# resolution in chronomaxi-ssh-hook.sh, not this parse) and export a fresh
# CMX_SSH_SID so the about-to-fork ssh child inherits it -- that inherited
# value is what lets chronomaxi-ssh-hook.sh's sessionId match this title's
# sid= exactly, for interactively-typed ssh only.
#
# Uses $3 (the full text about to execute, alias-expanded), not $1: per
# zsh's own docs (zshall(1) FUNCTIONS section) $1 is only populated when
# the history mechanism is active, empty otherwise -- verified empirically,
# $1 came back blank in a sourced-but-non-history-primed test shell while
# $3 was reliably populated. $3 also correctly reflects e.g. `alias
# b=ssh` expansion, which $1 (the literal typed text) would not.
cmx_preexec() {
    cmx_enabled || return 0
    local cmdline=${3:-${2:-$1}}
    local -a words
    words=(${(z)cmdline})
    local first=${words[1]}
    case "$first" in
        ssh|*/ssh|mosh|*/mosh|autossh|*/autossh)
            local word target
            for word in ${words[2,-1]}; do
                case "$word" in
                    -*|*=*) continue ;;
                    *) target=$word; break ;;
                esac
            done
            target=${target#*@}
            CMX_SID=$(cmx_gen_sid)
            CMX_SSH_TARGET=${target:-?}
            export CMX_SSH_SID=$CMX_SID
            ;;
        *)
            unset CMX_SSH_TARGET CMX_SSH_SID
            CMX_SID=$(cmx_gen_sid)
            ;;
    esac
    cmx_emit_title
}

add-zsh-hook precmd cmx_precmd
add-zsh-hook preexec cmx_preexec
