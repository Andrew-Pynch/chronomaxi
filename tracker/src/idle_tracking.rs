use chrono::{DateTime, Utc};

use crate::log::Log;

#[derive(Clone, serde::Serialize, serde::Deserialize, Debug, PartialEq)]
pub struct IdleTracker {
    pub idle_threshold_ms: i64,
    pub last_mouse_position: Option<(i32, i32)>,
    pub last_keys_pressed_count: Option<usize>,
    pub last_window_id: Option<String>,
    /// A window-title change counts as activity in the fallback (no-keys)
    /// branch, alongside mouse/window-id changes -- catches e.g. tmux
    /// pane/session switching or a terminal's title updating without the
    /// compositor-level window id or mouse ever moving. `serde(default)`
    /// so any old serialized IdleTracker (there are none today, but this
    /// type derives Deserialize) still parses without this field.
    #[serde(default)]
    pub last_window_title: Option<String>,
    pub last_activity_time: DateTime<Utc>,
}

impl IdleTracker {
    pub fn new() -> Self {
        Self {
            idle_threshold_ms: 300000,
            last_mouse_position: None,
            last_keys_pressed_count: None,
            last_window_id: None,
            last_window_title: None,
            last_activity_time: Utc::now(),
        }
    }

    /// `window_title` is the currently focused window's raw title (any
    /// backend); `None` when unavailable. Only consulted in the no-keys
    /// fallback branch -- once real key-press data is available (X11,
    /// evdev-backed Hyprland, macOS) that heuristic is authoritative on
    /// its own and title changes add no signal.
    pub fn is_idle(&mut self, log: &Log, window_title: Option<&str>) -> bool {
        let current_time = Utc::now();
        let current_mouse_position = log.current_mouse_position.unwrap_or_default();
        let current_window_id = log.current_window_id.clone().unwrap_or_default();

        let is_activity = match log.keys_pressed_count {
            Some(current_keys_pressed_count) => {
                match (self.last_mouse_position, self.last_keys_pressed_count) {
                    (Some(last_mouse_position), Some(last_keys_pressed_count)) => {
                        current_mouse_position != last_mouse_position
                            || current_keys_pressed_count != last_keys_pressed_count
                    }
                    _ => true, // Consider it as activity if we don't have previous data
                }
            }
            None => match (&self.last_mouse_position, &self.last_window_id) {
                (Some(last_mouse_position), Some(last_window_id)) => {
                    current_mouse_position != *last_mouse_position
                        || current_window_id != *last_window_id
                        || window_title != self.last_window_title.as_deref()
                }
                _ => true, // Wayland fallback needs both mouse and window history
            },
        };

        if is_activity {
            self.last_mouse_position = Some(current_mouse_position);
            self.last_keys_pressed_count = log.keys_pressed_count;
            self.last_window_id = Some(current_window_id);
            self.last_window_title = window_title.map(|title| title.to_string());
            self.last_activity_time = current_time;
            false // Not idle
        } else {
            let idle_duration = current_time - self.last_activity_time;
            idle_duration.num_milliseconds() >= self.idle_threshold_ms
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn probe(mouse: (i32, i32), window_id: &str) -> Log {
        let mut log = Log::new();
        log.current_mouse_position = Some(mouse);
        log.current_window_id = Some(window_id.to_string());
        log.keys_pressed_count = None;
        log
    }

    #[test]
    fn title_change_resets_idle() {
        let mut tracker = IdleTracker::new();
        tracker.idle_threshold_ms = 0;
        let log = probe((0, 0), "win1");

        assert!(!tracker.is_idle(&log, Some("first"))); // establishes baseline
        std::thread::sleep(std::time::Duration::from_millis(5));
        assert!(tracker.is_idle(&log, Some("first"))); // no change -> idle at threshold 0

        // title changes with mouse/window-id unchanged -> counts as
        // activity, resetting idle.
        assert!(!tracker.is_idle(&log, Some("second")));
    }

    #[test]
    fn unchanged_title_and_mouse_past_threshold_is_idle() {
        let mut tracker = IdleTracker::new();
        tracker.idle_threshold_ms = 0;
        let log = probe((5, 5), "win1");

        assert!(!tracker.is_idle(&log, Some("steady"))); // establishes baseline
        std::thread::sleep(std::time::Duration::from_millis(5));
        assert!(tracker.is_idle(&log, Some("steady")));
    }
}
