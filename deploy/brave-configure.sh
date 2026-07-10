#!/usr/bin/env bash
# deploy/brave-configure.sh -- idempotent Brave homepage/bookmark setup for
# the chronomaxi rollout. Shared by every machine (invoked directly on a
# closed Brave, or from a deferred systemd timer once one closes).
#
# Sets, in the profile's Preferences file:
#   homepage                  = https://big-bertha.tail3f4961.ts.net:8443
#   homepage_is_newtabpage    = false   (so the homepage above actually
#                                        takes effect for the home button /
#                                        Alt+Home -- otherwise Brave ignores
#                                        `homepage` and always opens NTP)
#   browser.show_home_button  = true
# ...and adds a bookmarks-bar entry named "chronomaxi" pointing at the same
# URL, in the profile's Bookmarks file.
#
# Hard guard: refuses to touch either file while Brave is running --
# editing Preferences/Bookmarks under a live browser gets silently
# clobbered on its next autosave or clean exit. This is a real guard, not
# just an ordering suggestion the caller is trusted to honor.
#
# Idempotent: safe to re-run any time (cron/timer or by hand). Only backs
# up + writes a file when its current on-disk state doesn't already match
# the desired state.
#
# Usage: deploy/brave-configure.sh [--profile-dir DIR]
#   Default profile dir: ~/.config/BraveSoftware/Brave-Browser/Default
#   (override with --profile-dir or $BRAVE_PROFILE_DIR for testing)

set -euo pipefail

PROFILE_DIR="${BRAVE_PROFILE_DIR:-$HOME/.config/BraveSoftware/Brave-Browser/Default}"
while [ $# -gt 0 ]; do
    case "$1" in
        --profile-dir) PROFILE_DIR=${2:?--profile-dir needs a value}; shift 2 ;;
        -h|--help) sed -n '2,29p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
        *) echo "unknown argument: $1" >&2; exit 1 ;;
    esac
done

PREFS="$PROFILE_DIR/Preferences"
BOOKMARKS="$PROFILE_DIR/Bookmarks"
HOMEPAGE_URL="https://big-bertha.tail3f4961.ts.net:8443"
BOOKMARK_NAME="chronomaxi"

log() { printf '[brave-configure] %s\n' "$1"; }
die() { printf '[brave-configure] ERROR: %s\n' "$1" >&2; exit 1; }

if pgrep -f '(^|/)brave(-bin)?/?brave($| )' >/dev/null 2>&1 || pgrep -x brave >/dev/null 2>&1; then
    log "Brave is running -- refusing to edit Preferences/Bookmarks (a live browser silently overwrites them on its next save/exit). No-op; re-run once Brave is closed."
    exit 0
fi

[ -f "$PREFS" ] || die "$PREFS not found"
[ -f "$BOOKMARKS" ] || die "$BOOKMARKS not found"
command -v jq >/dev/null 2>&1 || die "jq is required"

backup() {
    local f=$1 stamp
    stamp=$(date +%Y%m%dT%H%M%S)
    cp -p "$f" "$f.pre-chronomaxi.$stamp.bak"
    log "backed up $f -> $f.pre-chronomaxi.$stamp.bak"
}

# --- Preferences: homepage / homepage_is_newtabpage / show_home_button ----
# NOTE: plain `// default` is unsafe for booleans here -- jq's `//`
# operator treats a `false` LHS as absent (same as `null`), so
# `false // true` silently evaluates to `true`. Using explicit
# `if .foo == null then default else .foo end` instead so an on-disk
# `false` reads back as `false`, not the fallback -- otherwise this
# idempotency check would spuriously re-back-up and rewrite Preferences
# on every single run once homepage_is_newtabpage is correctly `false`.
current_homepage=$(jq -r '.homepage // ""' "$PREFS")
current_is_ntp=$(jq -r 'if .homepage_is_newtabpage == null then true else .homepage_is_newtabpage end' "$PREFS")
current_show_btn=$(jq -r 'if .browser.show_home_button == null then false else .browser.show_home_button end' "$PREFS")

if [ "$current_homepage" != "$HOMEPAGE_URL" ] || [ "$current_is_ntp" != "false" ] || [ "$current_show_btn" != "true" ]; then
    backup "$PREFS"
    tmp=$(mktemp)
    jq --arg url "$HOMEPAGE_URL" \
       '.homepage = $url | .homepage_is_newtabpage = false | .browser.show_home_button = true' \
       "$PREFS" >"$tmp"
    mv "$tmp" "$PREFS"
    chmod 600 "$PREFS"
    log "set homepage=$HOMEPAGE_URL, homepage_is_newtabpage=false, browser.show_home_button=true"
else
    log "Preferences already match desired state, skipping"
fi

# --- Bookmarks: add a bookmarks-bar entry if missing ------------------------
already_present=$(jq --arg url "$HOMEPAGE_URL" \
    '[.roots.bookmark_bar.children[]? | select(.url == $url)] | length' "$BOOKMARKS")

if [ "$already_present" -eq 0 ]; then
    backup "$BOOKMARKS"
    next_id=$(( $(jq '[.. | objects | .id? | select(. != null) | tonumber] | max // 0' "$BOOKMARKS") + 1 ))
    guid=$(uuidgen)
    # Chromium date_added/date_last_used/date_modified are microseconds
    # since the Windows FILETIME epoch (1601-01-01); offset from the Unix
    # epoch is 11644473600s, same convention BookmarkCodec expects on every
    # platform including Linux.
    webkit_now=$(( ($(date +%s) + 11644473600) * 1000000 ))
    tmp=$(mktemp)
    jq --arg url "$HOMEPAGE_URL" --arg name "$BOOKMARK_NAME" \
       --arg id "$next_id" --arg ts "$webkit_now" --arg guid "$guid" \
       '.roots.bookmark_bar.children += [{
          "date_added": $ts,
          "date_last_used": "0",
          "guid": $guid,
          "id": $id,
          "meta_info": {},
          "name": $name,
          "type": "url",
          "url": $url
        }] | del(.checksum)' \
       "$BOOKMARKS" >"$tmp"
    mv "$tmp" "$BOOKMARKS"
    chmod 600 "$BOOKMARKS"
    log "added bookmarks-bar entry '$BOOKMARK_NAME' -> $HOMEPAGE_URL (checksum cleared; Brave recomputes it on its next save, standard behavior for out-of-process bookmark edits)"
else
    log "bookmarks-bar entry for $HOMEPAGE_URL already present, skipping"
fi

log "done"
