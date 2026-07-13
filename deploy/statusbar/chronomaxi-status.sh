#!/bin/sh
set -u

mode=text
if [ "${1:-}" = "--json" ]; then
    mode=json
elif [ "${1:-}" = "--help" ]; then
    printf '%s\n' 'usage: chronomaxi-status.sh [--json]'
    exit 0
fi

env_file=${CHRONOMAXI_ENV_FILE:-"$HOME/.config/chronomaxi/env"}
if [ -r "$env_file" ]; then
    # shellcheck source=/dev/null
    . "$env_file"
fi

if [ -z "${CHRONOMAXI_INGEST_URL:-}" ] || [ -z "${CHRONOMAXI_INGEST_SECRET:-}" ]; then
    line="chronomaxi env missing"
else
    host=${CHRONOMAXI_STATUS_HOST:-$(hostname -s 2>/dev/null || hostname 2>/dev/null || printf all)}
    base=${CHRONOMAXI_INGEST_URL%/}
    json=$(curl -fsS --max-time "${CHRONOMAXI_STATUS_TIMEOUT:-8}" \
        -H "Authorization: Bearer $CHRONOMAXI_INGEST_SECRET" \
        "$base/statusline?host=$host" 2>/dev/null) || json=""

    if [ -z "$json" ]; then
        line="chronomaxi unavailable"
    else
        if command -v jq >/dev/null 2>&1; then
            active=$(printf '%s' "$json" | jq -r '.activeMinutes // 0')
            keys=$(printf '%s' "$json" | jq -r '.keystrokes // 0')
            wpm=$(printf '%s' "$json" | jq -r '.typedWpm // 0')
            dw=$(printf '%s' "$json" | jq -r '.dictatedWords // 0')
        else
            active=$(printf '%s' "$json" | sed -n 's/.*"activeMinutes"[[:space:]]*:[[:space:]]*\([0-9][0-9]*\).*/\1/p')
            keys=$(printf '%s' "$json" | sed -n 's/.*"keystrokes"[[:space:]]*:[[:space:]]*\([0-9][0-9]*\).*/\1/p')
            wpm=$(printf '%s' "$json" | sed -n 's/.*"typedWpm"[[:space:]]*:[[:space:]]*\([0-9][0-9]*\).*/\1/p')
            dw=$(printf '%s' "$json" | sed -n 's/.*"dictatedWords"[[:space:]]*:[[:space:]]*\([0-9][0-9]*\).*/\1/p')
            active=${active:-0}
            keys=${keys:-0}
            wpm=${wpm:-0}
            dw=${dw:-0}
        fi

        active=${active%%.*}
        keys=${keys%%.*}
        wpm=${wpm%%.*}
        dw=${dw%%.*}
        case $active in ''|*[!0-9]*) active=0 ;; esac
        case $keys in ''|*[!0-9]*) keys=0 ;; esac
        case $wpm in ''|*[!0-9]*) wpm=0 ;; esac
        case $dw in ''|*[!0-9]*) dw=0 ;; esac

        hours=$((active / 60))
        minutes=$((active % 60))
        if [ "$hours" -gt 0 ]; then
            active_text="${hours}h${minutes}m"
        else
            active_text="${minutes}m"
        fi

        if [ "$keys" -gt 999 ]; then
            key_text=$(awk -v n="$keys" 'BEGIN { printf "%.1fk ks", n / 1000 }')
        else
            key_text="${keys} ks"
        fi

        line=$active_text
        if [ "$keys" -gt 0 ] || [ "$wpm" -gt 0 ] || [ "$dw" -gt 0 ]; then
            if [ "$keys" -gt 0 ] || [ "$wpm" -gt 0 ]; then
                line="$line | $key_text | ${wpm}wpm"
                if [ "$dw" -gt 0 ]; then
                    line="$line (+${dw}dw)"
                fi
            else
                line="$line | +${dw}dw"
            fi
        fi
    fi
fi

if [ "$mode" = json ]; then
    escaped=$(printf '%s' "$line" | sed 's/\\/\\\\/g; s/"/\\"/g')
    printf '{"text":"%s","tooltip":"Chronomaxi %s","class":"chronomaxi"}\n' "$escaped" "$escaped"
else
    printf '%s\n' "$line"
fi
