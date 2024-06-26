use chrono::{DateTime, Utc};
use std::fmt::{self, Formatter};

use crate::idle_tracking::IdleTracker;

#[derive(Clone, serde::Serialize, serde::Deserialize, Debug, PartialEq)]
pub struct Log {
    pub current_window_id: Option<String>,
    pub current_program_process_name: Option<String>,
    pub current_program_name: Option<String>,
    pub current_browser_title: Option<String>,
    pub current_mouse_position: Option<(i32, i32)>,

    pub duration_ms: Option<i64>,
    pub keys_pressed_count: Option<usize>,

    pub created_at: Option<DateTime<Utc>>,
    pub log_start_time_utc: Option<DateTime<Utc>>,
    pub log_end_time_utc: Option<DateTime<Utc>>,

    pub is_idle: bool,
}

impl fmt::Display for Log {
    fn fmt(&self, f: &mut Formatter) -> fmt::Result {
        let (mouse_x, mouse_y) = self.current_mouse_position.unwrap_or((0, 0));
        write!(
            f,
            "Window ID: {:?}\nProgram Process Name: {:?}\nProgram Name: {:?}\nBrowser Title: {:?}\nMouse Position: ({:?}, {:?})\nDuration MS: {:?}\nKeys Pressed: {:?}\nCreated At: {:?}\n\nStart Time: {:?}\nEndTime: {:?}\nIsIdle: {:?}",
            self.current_window_id,
            self.current_program_process_name,
            self.current_program_name,
            self.current_browser_title,
            mouse_x,
            mouse_y,
            self.duration_ms,
            self.keys_pressed_count,
            self.created_at,
            self.log_start_time_utc,
            self.log_end_time_utc,
            self.is_idle
        )
    }
}

impl Log {
    pub fn new() -> Log {
        Log {
            current_window_id: None,
            current_program_process_name: None,
            current_program_name: None,
            current_browser_title: None,
            current_mouse_position: None,
            duration_ms: None,
            keys_pressed_count: None,
            created_at: None,
            log_start_time_utc: None,
            log_end_time_utc: None,
            is_idle: false,
        }
    }

    pub fn get_log_duration_ms(&self) -> Option<i64> {
        match (self.log_end_time_utc, self.log_start_time_utc) {
            (Some(end_time), Some(start_time)) => {
                let duration_ms = end_time.timestamp_millis() - start_time.timestamp_millis();
                Some(duration_ms)
            }
            _ => None,
        }
    }
}
