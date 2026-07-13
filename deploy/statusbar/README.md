# Chronomaxi status bars

This directory contains the bar poller and host-specific wiring for the Chronomaxi status-line item.

The shared poller reads `CHRONOMAXI_INGEST_URL` and `CHRONOMAXI_INGEST_SECRET` from `~/.config/chronomaxi/env`, calls:

```sh
GET $CHRONOMAXI_INGEST_URL/statusline?host=$(hostname -s)
Authorization: Bearer $CHRONOMAXI_INGEST_SECRET
```

and prints a compact line such as:

```text
9h23m | 4.2k ks | 38wpm (+120dw)
```

If input counts are zero or unavailable it degrades to active time only. If the endpoint or env is unavailable it prints a short unavailable message instead of blocking the bar.

## Files

- `chronomaxi-status.sh`: portable POSIX poller. Install as `~/.local/bin/chronomaxi-status`.
- `install-statusbar.sh`: host-aware installer that fleet deploy can call later.
- `waybar-module.jsonc`: Waybar custom module snippet for big-ron.
- `chronomaxi-bumblebee.py`: bumblebee-status module for big-bertha's i3bar setup.
- `chronomaxi-swiftbar.1m.sh`: SwiftBar or xbar plugin wrapper for lil-timmy when one of those apps is installed.

## Fleet-deploy hook

Do not run fleet deploy just for this. The one-line hook to add later, after sources are pulled on each host, is:

```sh
bash packages/chronomaxi/deploy/statusbar/install-statusbar.sh
```

Keep it separate from tracker restarts. The script only copies bar files into the user's home directory and does not need sudo.

## big-ron, Waybar

big-ron is running Waybar. Install the poller locally:

```sh
bash packages/chronomaxi/deploy/statusbar/install-statusbar.sh
```

Then merge `~/.config/chronomaxi/statusbar/waybar-module.jsonc` into the live Waybar `config` under the module object:

```jsonc
"custom/chronomaxi": {
    "exec": "~/.local/bin/chronomaxi-status --json",
    "return-type": "json",
    "interval": 60,
    "tooltip": true
}
```

Add `"custom/chronomaxi"` to the desired `modules-left`, `modules-center`, or `modules-right` list, then reload Waybar with the user's normal Waybar reload flow. This repo intentionally does not edit the live Waybar config.

## big-bertha, i3bar with bumblebee-status

Probe result on 2026-07-12: big-bertha was not using GNOME top-bar for the active session. It had an active i3 session (`i3` and `i3bar`) and `~/.config/i3/config` uses `~/bumblebee-status/bumblebee-status` in the `bar { status_command ... }` block.

Installed without sudo:

```text
~/.local/bin/chronomaxi-status
~/bumblebee-status/bumblebee_status/modules/contrib/chronomaxi.py
~/.config/chronomaxi/statusbar/waybar-module.jsonc
```

To show Chronomaxi in the bar, add `chronomaxi` to the bumblebee `-m` module list in `~/.config/i3/config`. The current bar command starts like:

```text
status_command /home/andrew/bumblebee-status/bumblebee-status \
                -m ping disk:root date time pasink pasource sun\
```

Change the module list to include `chronomaxi`, for example:

```text
-m chronomaxi ping disk:root date time pasink pasource sun\
```

Then reload i3 in the active seat. No sudo is required.

Fallback if bumblebee-status is removed later: run `~/.local/bin/chronomaxi-status` from any i3blocks or shell status command at a 60 second interval.

## lil-timmy, macOS

Probe result on 2026-07-12: lil-timmy was awake, but `sketchybar`, `SwiftBar`, and `xbar` were not installed according to absolute Homebrew probes under `/opt/homebrew/bin`, and neither plugin directory existed.

Installed without sudo:

```text
~/.local/bin/chronomaxi-status
```

If SketchyBar is installed later, add an item that runs the poller every 60 seconds, for example:

```sh
sketchybar --add item chronomaxi right \
  --set chronomaxi update_freq=60 script="$HOME/.local/bin/chronomaxi-status"
```

If SwiftBar is installed later, create the plugin directory and copy the wrapper:

```sh
mkdir -p "$HOME/Library/Application Support/SwiftBar/Plugins"
cp packages/chronomaxi/deploy/statusbar/chronomaxi-swiftbar.1m.sh \
  "$HOME/Library/Application Support/SwiftBar/Plugins/chronomaxi.1m.sh"
chmod 755 "$HOME/Library/Application Support/SwiftBar/Plugins/chronomaxi.1m.sh"
```

For xbar, use `$HOME/Library/Application Support/xbar/plugins/chronomaxi.1m.sh` instead.

## Verification notes

The poller was placed and executed on big-bertha and lil-timmy. Both returned `chronomaxi unavailable` because the live backend still returned HTTP 404 `No matching routes found` for `/statusline`. That is expected until `convex/statusline.ts` is deployed and `convex/http.ts` registers the route.
