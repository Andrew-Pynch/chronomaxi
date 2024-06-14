use chrono::{DateTime, Utc};
use std::fmt::{self, Formatter};

#[derive(Clone, serde::Serialize, serde::Deserialize, Debug, PartialEq)]
pub struct Log {
    pub current_window_id: String,
    pub current_program_process_name: String,
    pub current_program_name: String,
    pub current_browser_title: String,
    pub current_mouse_position: (i32, i32),
    pub duration_ms: Option<f64>,
    pub keys_pressed_count: Option<usize>,
    pub created_at: Option<DateTime<Utc>>,
}

impl fmt::Display for Log {
    fn fmt(&self, f: &mut Formatter) -> fmt::Result {
        write!(
            f,
            "Window ID: {}\nProgram Process Name: {}\nProgram Name: {}\nBrowser Title: {}\nMouse Position: ({}, {})\nDuration MS: {:?}\nKeys Pressed: {:?}\nCreated At: {:?}",
            self.current_window_id,
            self.current_program_process_name,
            self.current_program_name,
            self.current_browser_title,
            self.current_mouse_position.0,
            self.current_mouse_position.1,
            self.duration_ms,
            self.keys_pressed_count,
            self.created_at,
        )
    }
}

impl Log {
    pub fn new() -> Log {
        Log {
            current_window_id: String::from(""),
            current_program_process_name: String::from(""),
            current_program_name: String::from(""),
            current_browser_title: String::from(""),
            current_mouse_position: (0, 0),
            duration_ms: None,
            keys_pressed_count: None,
            created_at: Some(Utc::now()),
        }
    }
}
