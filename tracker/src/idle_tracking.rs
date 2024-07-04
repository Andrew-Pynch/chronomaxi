use chrono::{DateTime, Utc};

use crate::log::Log;

#[derive(Clone, serde::Serialize, serde::Deserialize, Debug, PartialEq)]
pub struct IdleTracker {
    pub idle_threshold_ms: i64,
    pub last_mouse_position: Option<(i32, i32)>,
    pub last_keys_pressed_count: Option<usize>,
    pub last_activity_time: DateTime<Utc>,
}

impl IdleTracker {
    pub fn new() -> Self {
        Self {
            idle_threshold_ms: 300000,
            last_mouse_position: None,
            last_keys_pressed_count: None,
            last_activity_time: Utc::now(),
        }
    }

    pub fn is_idle(&mut self, log: &Log) -> bool {
        let current_time = Utc::now();
        let current_mouse_position = log.current_mouse_position.unwrap_or_default();
        let current_keys_pressed_count = log.keys_pressed_count.unwrap_or_default();

        let is_activity = match (self.last_mouse_position, self.last_keys_pressed_count) {
            (Some(last_mouse_position), Some(last_keys_pressed_count)) => {
                current_mouse_position != last_mouse_position
                    || current_keys_pressed_count != last_keys_pressed_count
            }
            _ => true, // Consider it as activity if we don't have previous data
        };

        if is_activity {
            self.last_mouse_position = Some(current_mouse_position);
            self.last_keys_pressed_count = Some(current_keys_pressed_count);
            self.last_activity_time = current_time;
            false // Not idle
        } else {
            let idle_duration = current_time - self.last_activity_time;
            idle_duration.num_milliseconds() >= self.idle_threshold_ms
        }
    }
}
