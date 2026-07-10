use chrono::{DateTime, Utc};

use crate::log::Log;

#[derive(Clone, serde::Serialize, serde::Deserialize, Debug, PartialEq)]
pub struct IdleTracker {
    pub idle_threshold_ms: i64,
    pub last_mouse_position: Option<(i32, i32)>,
    pub last_keys_pressed_count: Option<usize>,
    pub last_window_id: Option<String>,
    pub last_activity_time: DateTime<Utc>,
}

impl IdleTracker {
    pub fn new() -> Self {
        Self {
            idle_threshold_ms: 300000,
            last_mouse_position: None,
            last_keys_pressed_count: None,
            last_window_id: None,
            last_activity_time: Utc::now(),
        }
    }

    pub fn is_idle(&mut self, log: &Log) -> bool {
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
                    current_mouse_position != *last_mouse_position || current_window_id != *last_window_id
                }
                _ => true, // Wayland fallback needs both mouse and window history
            },
        };

        if is_activity {
            self.last_mouse_position = Some(current_mouse_position);
            self.last_keys_pressed_count = log.keys_pressed_count;
            self.last_window_id = Some(current_window_id);
            self.last_activity_time = current_time;
            false // Not idle
        } else {
            let idle_duration = current_time - self.last_activity_time;
            idle_duration.num_milliseconds() >= self.idle_threshold_ms
        }
    }
}
