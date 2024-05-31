use crate::logger_v2::LoggerState;
use chrono::{DateTime, Utc};
use device_query::{DeviceQuery, DeviceState};
use std::sync::Mutex;
use std::{fmt, process::Command, sync::Arc};

#[derive(Clone)]
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
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
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

    pub fn capture(&mut self, logger_state: Arc<Mutex<LoggerState>>) -> Option<Log> {
        self.current_window_id = self.get_window_id();
        self.current_program_process_name =
            self.get_program_process_name(self.current_window_id.clone());
        self.current_program_name = self.get_program_name(self.current_window_id.clone());
        self.current_browser_title =
            self.get_browser_title(self.current_program_process_name.clone());
        self.current_mouse_position = self.get_mouse_position();
        self.keys_pressed_count = self.get_keys_pressed_count(&logger_state);

        Some(self.clone())
    }

    pub fn get_window_id(&self) -> String {
        let window_id = Command::new("xdotool")
            .arg("getactivewindow")
            .output()
            .expect("Failed to get window id")
            .stdout;
        return String::from_utf8(window_id).unwrap().trim().to_string();
    }

    pub fn get_program_process_name(&self, current_window_id: String) -> String {
        let output = Command::new("xprop")
            .arg("-id")
            .arg(current_window_id)
            .arg("WM_CLASS")
            .output()
            .expect("Failed to get program name");

        let output_str = String::from_utf8(output.stdout).unwrap();
        let parts: Vec<&str> = output_str.split('"').collect();

        if parts.len() >= 2 {
            parts[1].to_string()
        } else {
            String::from("Unknown")
        }
    }

    pub fn get_program_name(&self, current_window_id: String) -> String {
        let program_name = Command::new("xdotool")
            .arg("getwindowname")
            .arg(current_window_id)
            .output()
            .expect("Failed to get program name")
            .stdout;
        return String::from_utf8(program_name).unwrap().trim().to_string();
    }

    pub fn is_current_program_browser(&self, current_program_name: String) -> bool {
        const FIREFOX: &str = "firefox";
        const CHROME: &str = "chrome";
        const BRAVE: &str = "brave-browser";
        const EDGE: &str = "edge";
        const SAFARI: &str = "safari";

        return current_program_name == FIREFOX
            || current_program_name == CHROME
            || current_program_name == BRAVE
            || current_program_name == EDGE
            || current_program_name == SAFARI;
    }

    pub fn get_browser_title(&self, current_program_name: String) -> String {
        if self.is_current_program_browser(current_program_name.clone()) {
            let browser_title = Command::new("xdotool")
                .arg("getwindowname")
                .arg(self.current_window_id.clone())
                .output()
                .expect("Failed to get browser title")
                .stdout;

            let browser_title_str = String::from_utf8(browser_title).unwrap();
            let browser_title_parts: Vec<&str> = browser_title_str.split(" - ").collect();

            if browser_title_parts.len() >= 2 {
                return browser_title_parts[0].trim().to_string();
            } else {
                return browser_title_str.trim().to_string();
            }
        } else {
            return String::from("");
        }
    }

    pub fn get_mouse_position(&self) -> (i32, i32) {
        let mouse_position = Command::new("xdotool")
            .arg("getmouselocation")
            .output()
            .expect("Failed to get mouse position")
            .stdout;

        let mouse_position_str = String::from_utf8(mouse_position).unwrap();
        let mouse_position_str = mouse_position_str.trim();

        let mouse_position_str = mouse_position_str
            .replace("x:", "")
            .replace("y:", "")
            .replace("screen:", "")
            .replace("window:", "")
            .replace("root:", "");

        let mouse_position_str: Vec<&str> = mouse_position_str.split_whitespace().collect();

        if mouse_position_str.len() >= 2 {
            let x = mouse_position_str[0].parse::<i32>().unwrap();
            let y = mouse_position_str[1].parse::<i32>().unwrap();
            return (x, y);
        } else {
            eprintln!("Failed to parse mouse position: {:?}", mouse_position_str);
            return (0, 0);
        }
    }

    pub fn get_keys_pressed_count(
        &mut self,
        logger_state: &Arc<Mutex<LoggerState>>,
    ) -> Option<usize> {
        let logger_state = logger_state.lock().unwrap();
        let keys_pressed_count = logger_state.device_state.get_keys();

        if keys_pressed_count.is_empty() {
            return None;
        } else {
            return Some(keys_pressed_count.len());
        }
    }

    pub fn is_idle(&self) -> bool {
        return false;
    }
}
