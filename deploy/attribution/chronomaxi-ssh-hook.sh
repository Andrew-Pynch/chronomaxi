#!/bin/sh
# chronomaxi-ssh-hook.sh -- ssh_config LocalCommand target for chronomaxi
# session-attribution mechanism 2 (lifecycle events).
#
# Fires once per real ssh(1) TCP connection establishment (not per
# ControlMaster-multiplexed reuse) via an ~/.ssh/config block installed by
# install.sh:
#
#   Host *
#       PermitLocalCommand yes
#       LocalCommand ~/.config/chronomaxi/chronomaxi-ssh-hook.sh %n %h %p %r %L
#
# Tokens (ssh_config(5)): %n=target as originally typed/aliased,
# %h=resolved target hostname, %p=port (unused here, contract has no
# remotePort field), %r=remote login user, %L=first component of the local
# hostname.
#
# This is the one hook point common to every ssh(1) caller: interactive
# shells, the omp bash tool's raw `ssh ...` calls, and the dedicated omp ssh
# tool's first connection per ControlPersist window -- unlike a shell
# function `ssh()` wrapper, which only ever fires for a real interactive
# shell (verified: the omp bash tool does not source .bashrc/.zshrc
# functions).
#
# Fail-open by design: this script must NEVER cause ssh(1) itself to fail,
# hang, or slow down. All network calls are backgrounded with a short
# timeout; failures spool to a local retry file instead of raising, and
# every early-exit path is a silent `exit 0`.
#
# Must stay POSIX sh (no bash/zsh-isms) -- ssh_config's LocalCommand runs
# the target through /bin/sh -c on every platform, including macOS's
# /bin/sh (bash 3.2 in POSIX mode) and Linux's dash.

set -u

TARGET_ALIAS=${1:-}
TARGET_HOST=${2:-}
REMOTE_USER=${4:-}
LOCAL_HOST=${5:-}
if [ -z "$LOCAL_HOST" ]; then
    LOCAL_HOST=$(hostname -s 2>/dev/null || hostname 2>/dev/null || printf 'unknown')
fi

CHRONOMAXI_HOME=${CHRONOMAXI_HOME:-${HOME:-/tmp}/.config/chronomaxi}
ENV_FILE=${CHRONOMAXI_ENV_FILE:-$CHRONOMAXI_HOME/env}
SPOOL_FILE=${CMX_SPOOL_FILE:-/tmp/cmx-events.jsonl}
DISABLE_SENTINEL=$CHRONOMAXI_HOME/disable

# shellcheck source=/dev/null
[ -r "$ENV_FILE" ] && . "$ENV_FILE"

# Opt-out: never blocks the connection either way, checked fresh on every
# invocation (never cached), matching the zsh hook's own gate.
if [ -n "${CMX_SSH_TRACK_DISABLE:-}" ] || [ -f "$DISABLE_SENTINEL" ]; then
    exit 0
fi

# No endpoint configured on this host yet, or curl unavailable -- no-op.
# Nothing to spool toward without a configured target.
if [ -z "${CHRONOMAXI_INGEST_URL:-}" ] || [ -z "${CHRONOMAXI_INGEST_SECRET:-}" ]; then
    exit 0
fi
command -v curl >/dev/null 2>&1 || exit 0

B32='0123456789ABCDEFGHJKMNPQRSTVWXYZ'

cmx_b32_char() {
    printf '%s' "$B32" | cut -c"$(($1 + 1))"
}

# Whole seconds * 1000, not true milliseconds: GNU date's %N is not
# portable to macOS/BSD date, and second-level precision is enough for a
# monotonic-ish ordering hint -- uniqueness comes from the random part.
cmx_now_ms() {
    printf '%s000' "$(date +%s)"
}

# ULID-shaped id: 10 base32 timestamp chars + 16 base32 random chars.
# Not bit-exact Crockford packing (each random char independently samples
# one /dev/urandom byte mod 32, ~5 bits each) -- adequate entropy for a
# client-generated idempotency key, not a spec-validator target.
cmx_ulid() {
    ms=$(cmx_now_ms)
    ts_part=''
    t=$ms
    i=0
    while [ "$i" -lt 10 ]; do
        idx=$((t % 32))
        ts_part="$(cmx_b32_char "$idx")$ts_part"
        t=$((t / 32))
        i=$((i + 1))
    done
    rnd_part=''
    for n in $(od -An -tu1 -N16 /dev/urandom 2>/dev/null); do
        rnd_part="$rnd_part$(cmx_b32_char $((n % 32)))"
    done
    printf '%s%s' "$ts_part" "$rnd_part"
}

# sessionId: 8 lowercase hex chars, always. If chronomaxi-attribution.zsh's
# preexec detected this as an interactive ssh invocation, it exported
# CMX_SSH_SID right before forking us -- reuse it verbatim so this event's
# sessionId is byte-identical to the title's sid= field (exact-match join,
# never a prefix relationship). Otherwise (bash-tool ssh, dedicated ssh
# tool, no preexec involved) generate a fresh one.
cmx_sid8() {
    if [ -n "${CMX_SSH_SID:-}" ]; then
        printf '%s' "$CMX_SSH_SID"
    else
        od -An -tx1 -N4 /dev/urandom 2>/dev/null | tr -d ' \n'
    fi
}

# actor: pure function of the live environment, resolved fresh on every
# invocation, identical rule to chronomaxi-attribution.zsh's cmx_actor().
cmx_actor() {
    if [ -n "${CMX_ACTOR_OVERRIDE:-}" ]; then
        printf '%s' "$CMX_ACTOR_OVERRIDE"
    elif [ -n "${OMPCODE:-}" ]; then
        if [ -n "${CMX_AGENT_NAME:-}" ]; then
            printf 'agent:%s' "$CMX_AGENT_NAME"
        else
            printf 'agent:unknown'
        fi
    else
        printf 'human'
    fi
}

json_escape() {
    printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

ACTOR=$(cmx_actor)
SESSION_ID=$(cmx_sid8)
STARTED_AT_MS=$(cmx_now_ms)
SOURCE_ID=$(cmx_ulid)

ACTOR_J=$(json_escape "$ACTOR")
AGENT_NAME_J=$(json_escape "${CMX_AGENT_NAME:-}")
LOCAL_HOST_J=$(json_escape "$LOCAL_HOST")
TARGET_HOST_J=$(json_escape "$TARGET_HOST")
TARGET_ALIAS_J=$(json_escape "$TARGET_ALIAS")
REMOTE_USER_J=$(json_escape "$REMOTE_USER")

cmx_agent_field() {
    if [ -n "${CMX_AGENT_NAME:-}" ]; then
        printf '"agentName":"%s",' "$AGENT_NAME_J"
    fi
}

build_start_json() {
    printf '{"sourceId":"%s","kind":"ssh-start","actor":"%s",%s"originHost":"%s","targetHost":"%s","targetHostAlias":"%s","remoteUser":"%s","startedAt":%s,"sessionId":"%s"}' \
        "$SOURCE_ID" "$ACTOR_J" "$(cmx_agent_field)" "$LOCAL_HOST_J" \
        "$TARGET_HOST_J" "$TARGET_ALIAS_J" "$REMOTE_USER_J" "$STARTED_AT_MS" "$SESSION_ID"
}

cmx_post() {
    curl -fsS --max-time 2 \
        -H "Authorization: Bearer $CHRONOMAXI_INGEST_SECRET" \
        -H 'Content-Type: application/json' \
        -X POST "$CHRONOMAXI_INGEST_URL/session-event" \
        -d "$1" >/dev/null 2>&1
}

cmx_spool() {
    printf '%s\n' "$1" >>"$SPOOL_FILE" 2>/dev/null
}

# Best-effort, non-blocking retry flusher: replays previously-spooled
# events before sending the new one. mkdir is an atomic lock on every
# POSIX filesystem; if another hook invocation already holds it, skip
# rather than wait (fail-open, never block this connection on I/O).
cmx_flush_spool() {
    [ -s "$SPOOL_FILE" ] || return 0
    lock=$SPOOL_FILE.lock
    mkdir "$lock" 2>/dev/null || return 0
    tmp=$SPOOL_FILE.flush.$$
    : >"$tmp"
    while IFS= read -r line; do
        [ -n "$line" ] || continue
        cmx_post "$line" || printf '%s\n' "$line" >>"$tmp"
    done <"$SPOOL_FILE"
    mv "$tmp" "$SPOOL_FILE"
    rmdir "$lock" 2>/dev/null
}

START_JSON=$(build_start_json)

# Send the start event in the background; never block the ssh connection.
(
    cmx_flush_spool
    cmx_post "$START_JSON" || cmx_spool "$START_JSON"
) >/dev/null 2>&1 &

# Background PPID-poll watcher. LocalCommand runs as a direct child of the
# ssh(1) client process, so $PPID captured here is that client's pid --
# poll its liveness and POST an end event once it exits. This is a
# sibling-of-ssh vantage point, not a wait()-able parent, so a real process
# exit CODE is unobtainable here (only "process gone" is observable) --
# exitCode is left unset rather than fabricated. When the parent `sh -c`
# invocation that spawned this subshell exits (immediately, since the
# script returns right after backgrounding both jobs), this subshell is
# reparented and keeps running detached until the watched pid disappears.
(
    while kill -0 "$PPID" 2>/dev/null; do
        sleep 5
    done
    ENDED_AT_MS=$(cmx_now_ms)
    DURATION_MS=$((ENDED_AT_MS - STARTED_AT_MS))
    END_SOURCE_ID=$(cmx_ulid)
    # startedAt is required on every /session-event POST (per Convex
    # contract confirmation), even ssh-end -- it is the out-of-order-
    # delivery fallback the backend uses if the matching ssh-start row
    # has not landed yet; when the row IS found via sessionId it is
    # accepted but not used to overwrite the stored value.
    END_JSON=$(printf '{"sourceId":"%s","kind":"ssh-end","actor":"%s","originHost":"%s","targetHost":"%s","targetHostAlias":"%s","startedAt":%s,"endedAt":%s,"durationMs":%s,"sessionId":"%s"}' \
        "$END_SOURCE_ID" "$ACTOR_J" "$LOCAL_HOST_J" "$TARGET_HOST_J" \
        "$TARGET_ALIAS_J" "$STARTED_AT_MS" "$ENDED_AT_MS" "$DURATION_MS" "$SESSION_ID")
    cmx_post "$END_JSON" || cmx_spool "$END_JSON"
) >/dev/null 2>&1 &

exit 0
