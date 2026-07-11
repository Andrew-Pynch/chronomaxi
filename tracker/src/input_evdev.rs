//! Linux evdev-based global key/click counters.
//!
//! Fixes the root cause of ron's undercount: Hyprland/Wayland has no
//! compositor-level "keys currently held" primitive the way X11's
//! `device_query` does, so the Hyprland backend previously reported no key
//! data at all (see `logger_v4.rs::get_keys_pressed_count`). This module
//! reads every `EV_KEY`-capable `/dev/input/event*` node directly and
//! counts real key-down (and left/right/middle click) edge events, which is
//! both more accurate than X11's poll-sampled "currently held" heuristic
//! and works under any Linux compositor.
//!
//! Requires the calling user to be able to open `/dev/input/event*`
//! (typically membership in the `input` group via a udev uaccess rule --
//! applied separately by the machine owner, not by this tracker). Until
//! that's granted every open fails with `EACCES`; this module logs that
//! once per distinct denied-device set and keeps retrying on a fixed
//! cadence so it self-heals the moment the rule lands, with no restart
//! required.

use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use evdev::{Device, EventSummary, EventType, KeyCode};

/// Hotplug rescan cadence: every tick, newly-appeared `/dev/input/event*`
/// nodes are opened and (if `EV_KEY`-capable) get their own reader thread.
const RESCAN_INTERVAL: Duration = Duration::from_secs(30);

/// Permission-denied devices are only retried every other rescan tick
/// (2 * RESCAN_INTERVAL = 60s) -- distinct from the hotplug cadence above
/// so a udev rule landing mid-session is picked up without hammering
/// `open()` on devices we already know we can't read.
const DENIED_RETRY_EVERY_N_TICKS: u64 = 2;

/// Shared, lock-free key/click counters fed by one blocking reader thread
/// per accessible input device. `LoggerV4` drains monotonic deltas each
/// tick; `has_ever_advanced()` is the signal that at least one device
/// granted read access, which is what switches the Hyprland backend from
/// "no key data" (`None`) to real evdev-derived counts.
#[derive(Default)]
pub struct InputCounters {
    pub keys_pressed: AtomicU64,
    pub left_clicks: AtomicU64,
    pub right_clicks: AtomicU64,
    pub middle_clicks: AtomicU64,
}

impl InputCounters {
    pub fn has_ever_advanced(&self) -> bool {
        self.keys_pressed.load(Ordering::Relaxed) != 0
            || self.left_clicks.load(Ordering::Relaxed) != 0
            || self.right_clicks.load(Ordering::Relaxed) != 0
            || self.middle_clicks.load(Ordering::Relaxed) != 0
    }
}

/// Spawns the background scanner thread and returns the shared counters
/// immediately -- capture never blocks on device enumeration or waits on
/// permissions.
pub fn spawn() -> Arc<InputCounters> {
    let counters = Arc::new(InputCounters::default());
    let scan_counters = Arc::clone(&counters);
    if thread::Builder::new()
        .name("cmx-evdev-scan".to_string())
        .spawn(move || scan_loop(scan_counters))
        .is_err()
    {
        println!("chronomaxi evdev: failed to spawn scanner thread, key/click counts unavailable");
    }
    counters
}

fn scan_loop(counters: Arc<InputCounters>) {
    let tracked: Arc<Mutex<HashSet<PathBuf>>> = Arc::new(Mutex::new(HashSet::new()));
    let mut denied: HashSet<PathBuf> = HashSet::new();
    let mut logged_denied: HashSet<PathBuf> = HashSet::new();
    let mut tick: u64 = 0;

    loop {
        let nodes = list_event_nodes();
        let retry_denied_this_tick = tick % DENIED_RETRY_EVERY_N_TICKS == 0;

        {
            let mut tracked_guard = tracked.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
            for path in &nodes {
                if tracked_guard.contains(path) {
                    continue;
                }
                if denied.contains(path) && !retry_denied_this_tick {
                    continue;
                }

                match open_key_capable(path) {
                    Ok(Some(device)) => {
                        tracked_guard.insert(path.clone());
                        denied.remove(path);
                        spawn_reader(path.clone(), device, Arc::clone(&counters), Arc::clone(&tracked));
                    }
                    Ok(None) => {
                        // Opened fine but not a keyboard/mouse (e.g. a
                        // lid-switch or sensor node) -- nothing to track.
                    }
                    Err(e) if e.kind() == std::io::ErrorKind::PermissionDenied => {
                        denied.insert(path.clone());
                    }
                    Err(_) => {
                        // Transient (device vanished mid-scan, etc) --
                        // next rescan retries.
                    }
                }
            }
        }

        // Devices that disappeared entirely (hot-unplug) stop being
        // "denied" once they no longer show up in /dev/input at all;
        // `tracked` self-prunes from within `spawn_reader`'s thread when
        // its device's fd errors out.
        let present: HashSet<PathBuf> = nodes.into_iter().collect();
        denied.retain(|path| present.contains(path));

        if denied != logged_denied {
            log_denied_state(&denied);
            logged_denied = denied.clone();
        }

        tick = tick.wrapping_add(1);
        thread::sleep(RESCAN_INTERVAL);
    }
}

fn list_event_nodes() -> Vec<PathBuf> {
    let Ok(entries) = std::fs::read_dir("/dev/input") else {
        return Vec::new();
    };

    entries
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.path())
        .filter(|path| {
            path.file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name.starts_with("event"))
        })
        .collect()
}

/// Opens `path` and reports whether it's `EV_KEY`-capable (keyboards, and
/// mice -- button presses arrive as `EV_KEY` too, e.g. `BTN_LEFT`).
/// Distinguishes `EACCES` from other errors so the caller can drive the
/// denied-device retry/logging cadence correctly.
fn open_key_capable(path: &std::path::Path) -> std::io::Result<Option<Device>> {
    let device = Device::open(path)?;
    if device.supported_events().contains(EventType::KEY) {
        Ok(Some(device))
    } else {
        Ok(None)
    }
}

fn spawn_reader(
    path: PathBuf,
    mut device: Device,
    counters: Arc<InputCounters>,
    tracked: Arc<Mutex<HashSet<PathBuf>>>,
) {
    let thread_name = format!("cmx-evdev-{}", path.display());
    let reader_path = path.clone();
    let reader_tracked = Arc::clone(&tracked);
    let spawned = thread::Builder::new().name(thread_name).spawn(move || {
        loop {
            match device.fetch_events() {
                Ok(events) => {
                    for event in events {
                        record_event(&counters, event.destructure());
                    }
                }
                Err(_) => break, // device removed/errored -- let the scanner retry it
            }
        }

        if let Ok(mut guard) = reader_tracked.lock() {
            guard.remove(&reader_path);
        }
    });

    if spawned.is_err() {
        // Couldn't spin up a reader thread; drop it from `tracked` so the
        // next scan retries rather than silently forgetting the device.
        if let Ok(mut guard) = tracked.lock() {
            guard.remove(&path);
        }
    }
}

/// Key-down only (value == 1) -- excludes autorepeat (2) and release (0),
/// matching the spec's "counting keystrokes (key-down only)".
fn record_event(counters: &InputCounters, summary: EventSummary) {
    match summary {
        EventSummary::Key(_, KeyCode::BTN_LEFT, 1) => {
            counters.left_clicks.fetch_add(1, Ordering::Relaxed);
        }
        EventSummary::Key(_, KeyCode::BTN_RIGHT, 1) => {
            counters.right_clicks.fetch_add(1, Ordering::Relaxed);
        }
        EventSummary::Key(_, KeyCode::BTN_MIDDLE, 1) => {
            counters.middle_clicks.fetch_add(1, Ordering::Relaxed);
        }
        EventSummary::Key(_, _, 1) => {
            counters.keys_pressed.fetch_add(1, Ordering::Relaxed);
        }
        _ => {}
    }
}

fn log_denied_state(denied: &HashSet<PathBuf>) {
    if denied.is_empty() {
        println!("chronomaxi evdev: all input devices are now accessible");
        return;
    }

    let mut paths: Vec<String> = denied.iter().map(|p| p.display().to_string()).collect();
    paths.sort();
    println!(
        "chronomaxi evdev: permission denied opening {} input device(s) ({}) -- apply the udev uaccess rule to fix; retrying every {}s",
        paths.len(),
        paths.join(", "),
        RESCAN_INTERVAL.as_secs() * DENIED_RETRY_EVERY_N_TICKS,
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn counters_start_unadvanced() {
        let counters = InputCounters::default();
        assert!(!counters.has_ever_advanced());
    }

    #[test]
    fn any_nonzero_counter_marks_advanced() {
        let counters = InputCounters::default();
        counters.left_clicks.fetch_add(1, Ordering::Relaxed);
        assert!(counters.has_ever_advanced());
    }

    #[test]
    fn key_down_only_is_counted() {
        // value 1 = down (counted), 0 = up, 2 = autorepeat (both ignored).
        let counters = InputCounters::default();
        record_event(&counters, EventSummary::Key(evdev::KeyEvent::new(KeyCode::KEY_A, 1), KeyCode::KEY_A, 1));
        record_event(&counters, EventSummary::Key(evdev::KeyEvent::new(KeyCode::KEY_A, 0), KeyCode::KEY_A, 0));
        record_event(&counters, EventSummary::Key(evdev::KeyEvent::new(KeyCode::KEY_A, 2), KeyCode::KEY_A, 2));
        assert_eq!(counters.keys_pressed.load(Ordering::Relaxed), 1);
    }

    #[test]
    fn mouse_buttons_route_to_click_counters_not_keys() {
        let counters = InputCounters::default();
        record_event(
            &counters,
            EventSummary::Key(evdev::KeyEvent::new(KeyCode::BTN_LEFT, 1), KeyCode::BTN_LEFT, 1),
        );
        record_event(
            &counters,
            EventSummary::Key(evdev::KeyEvent::new(KeyCode::BTN_RIGHT, 1), KeyCode::BTN_RIGHT, 1),
        );
        record_event(
            &counters,
            EventSummary::Key(evdev::KeyEvent::new(KeyCode::BTN_MIDDLE, 1), KeyCode::BTN_MIDDLE, 1),
        );
        assert_eq!(counters.left_clicks.load(Ordering::Relaxed), 1);
        assert_eq!(counters.right_clicks.load(Ordering::Relaxed), 1);
        assert_eq!(counters.middle_clicks.load(Ordering::Relaxed), 1);
        assert_eq!(counters.keys_pressed.load(Ordering::Relaxed), 0);
    }
}
