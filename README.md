# Chrono Maxi

Chrono Maxi is Andrew's cross-device activity and session-attribution system.
Rust trackers on Ron, Bertha, and Timmy spool activity to a self-hosted Convex
deployment. The Next.js dashboard visualizes per-device time, programs,
categories, input activity, SSH sessions, timers, and drill-down state.

Canonical source lives at `packages/chronomaxi/` in the private personal agent
monorepo. `Andrew-Pynch/chronomaxi` is a one-way public subtree mirror. Public
issues and pull requests remain useful as proposals, but changes land in the
canonical package and are then republished.

Chronomaxi also powers the real-time statistics on
[andrewpynch.com](https://andrewpynch.com).

## Features

- Captures active windows, program identity, idle state, and supported input counts.
- Spools tracker data locally and flushes it to central Convex ingest.
- Separates activity by device, human actor, and named agent.
- Correlates terminal title tags with SSH lifecycle sessions.
- Provides a NERV-styled dashboard with device filters and program drill-down.
- Deploys explicitly with `bun run deploy:fleet`, publishing the public mirror
  before updating backend, frontend, and trackers.

## Prerequisites

- Rust programming language
- Node.js and Bun
- SQLite
- Window detection:
  - Hyprland (Wayland): uses `hyprctl`, no extra install
  - X11: `xdotool` and `xprop` (`sudo pacman -S xdotool xorg-xprop` / `sudo apt-get install xdotool x11-utils`)

Note: on Wayland, keystroke and click counts are not captured (no global input access); window/program/category time tracking works fully.

3. **Run the tracker / web interface**
   
3.5 **Run the tracker as a service (optional)**
Optionally, if you are on linux, you can run the tracker as a system service that runs on startup
with an auto retry policy. Here is how you do it:

```sh
mkdir -p ~/.config/systemd/user
```

Copy the service template file to the user config directory: (Make sure to replace the path
to your chronomaxi installation dir / tracker binary. You might have to run cargo build --release)

```sh
cp ./chronomaxi-tracker.service ~/.config/systemd/user
```

reload systemd after adding service file

```sh
systemctl --user daemon-reload
```

enable

```sh
systemctl --user enable chronomaxi-tracker.service
```

start

```sh
systemctl --user start chronomaxi-tracker.service
```

status

```sh
systemctl --user status chronomaxi-tracker.service
```
if its working the status should look something like this
![image](https://github.com/user-attachments/assets/2363ea65-cbc7-4ba5-a86d-43535487e3f5)


linger

```sh
sudo loginctl enable-linger $USER
```

if you need to view logs

```sh
journalctl -u chronomaxi-tracker.service
```

### First Terminal (web interface)

```sh
cd frontend
cp .env.example .env
bun install
bun run local
```

Optional: seed a week of fake activity data for development with `bun run seed`.

### Second Terminal (tracker)

```sh
cd tracker
cargo run
```

# Contributing

Make a PR and if its good or cool I will merge it :-)
