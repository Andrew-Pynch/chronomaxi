#!/usr/bin/env sh
set -eu

script_dir=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
bin_dir=${HOME}/.local/bin
state_dir=${HOME}/.config/chronomaxi/statusbar
mkdir -p "$bin_dir" "$state_dir"
cp "$script_dir/chronomaxi-status.sh" "$bin_dir/chronomaxi-status"
chmod 755 "$bin_dir/chronomaxi-status"

os=$(uname -s 2>/dev/null || printf unknown)
case "$os" in
    Darwin)
        plugin_name=chronomaxi.1m.sh
        swiftbar_dir="${HOME}/Library/Application Support/SwiftBar/Plugins"
        xbar_dir="${HOME}/Library/Application Support/xbar/plugins"
        if [ -d "$swiftbar_dir" ]; then
            cp "$script_dir/chronomaxi-swiftbar.1m.sh" "$swiftbar_dir/$plugin_name"
            chmod 755 "$swiftbar_dir/$plugin_name"
            printf '%s\n' "installed SwiftBar plugin: $swiftbar_dir/$plugin_name"
        elif [ -d "$xbar_dir" ]; then
            cp "$script_dir/chronomaxi-swiftbar.1m.sh" "$xbar_dir/$plugin_name"
            chmod 755 "$xbar_dir/$plugin_name"
            printf '%s\n' "installed xbar plugin: $xbar_dir/$plugin_name"
        else
            printf '%s\n' "installed poller only: $bin_dir/chronomaxi-status"
            printf '%s\n' "no SwiftBar or xbar plugin directory found"
        fi
        ;;
    *)
        cp "$script_dir/waybar-module.jsonc" "$state_dir/waybar-module.jsonc"
        if [ -d "${HOME}/bumblebee-status/bumblebee_status/modules/contrib" ]; then
            cp "$script_dir/chronomaxi-bumblebee.py" \
                "${HOME}/bumblebee-status/bumblebee_status/modules/contrib/chronomaxi.py"
            printf '%s\n' "installed bumblebee-status module: ${HOME}/bumblebee-status/bumblebee_status/modules/contrib/chronomaxi.py"
        fi
        printf '%s\n' "installed poller: $bin_dir/chronomaxi-status"
        printf '%s\n' "installed Waybar snippet: $state_dir/waybar-module.jsonc"
        ;;
esac
