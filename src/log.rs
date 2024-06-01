use chrono::{DateTime, Utc};
use std::fmt::{self, Formatter};

#[derive(Clone, serde::Serialize, serde::Deserialize, Debug, PartialEq)]
pub struct Log {
    pub user_id: String,
    pub current_window_id: String,
    pub current_program_process_name: String,
    pub current_program_name: String,
    pub current_browser_title: String,
    pub current_mouse_position: (i32, i32),
    pub keys_pressed_count: Option<usize>,
    pub created_at: Option<DateTime<Utc>>,
}

impl fmt::Display for Log {
    fn fmt(&self, f: &mut Formatter) -> fmt::Result {
        write!(
            f,
            "User ID: {}\nWindow ID: {}\nProgram Process Name: {}\nProgram Name: {}\nBrowser Title: {}\nMouse Position: ({}, {})\nKeys Pressed: {:?}\nCreated At: {:?}",
            self.user_id,
            self.current_window_id,
            self.current_program_process_name,
            self.current_program_name,
            self.current_browser_title,
            self.current_mouse_position.0,
            self.current_mouse_position.1,
            self.keys_pressed_count,
            self.created_at,
        )
    }
}

impl Log {
    pub fn new(user_id: String) -> Log {
        Log {
            user_id,
            current_window_id: String::from(""),
            current_program_process_name: String::from(""),
            current_program_name: String::from(""),
            current_browser_title: String::from(""),
            current_mouse_position: (0, 0),
            keys_pressed_count: None,
            created_at: Some(Utc::now()),
        }
    }
}
