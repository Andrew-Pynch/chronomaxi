use crate::{config::Configuration, db::DbConnection, log::Log};
use chrono::Utc;
use device_query::DeviceQuery;
use std::{collections::HashMap, process::Command};

pub struct LoggerV3 {
    pub config: Configuration,
    pub db: DbConnection,
    pub device_state: device_query::DeviceState,

    pub current_log_duration_ms: Option<f64>,

    // key is window_id, value is log
    pub logs: HashMap<String, Log>,
    pub last_log_created_at_utc: chrono::DateTime<chrono::Utc>,
    pub last_log_program_process_name: Option<String>,
    pub last_activity_time: chrono::DateTime<chrono::Utc>,
    pub idle_threshold_ms: u64,
    pub idle_timer: u64,

    pub last_mouse_position: (i32, i32),
    pub keys_pressed_in_last_idle_interval: usize,
    pub mouse_moved_in_last_idle_interval: bool,
}

impl LoggerV3 {
    pub async fn new() -> Result<LoggerV3, Box<dyn std::error::Error>> {
        Ok(LoggerV3 {
            config: Configuration::from_env().await?,
            db: DbConnection::new()?,
            device_state: device_query::DeviceState::new(),
            current_log_duration_ms: None,
            logs: HashMap::new(),
            // create new utc of last log created at
            last_log_created_at_utc: chrono::Utc::now(),
            last_log_program_process_name: None,
            last_activity_time: chrono::Utc::now(),
            idle_threshold_ms: 60000,
            idle_timer: 0,
            last_mouse_position: (0, 0),
            keys_pressed_in_last_idle_interval: 0,
            mouse_moved_in_last_idle_interval: false,
        })
    }

    pub fn get_log(&self, window_id: String) -> Option<Log> {
        self.logs.get(&window_id).cloned()
    }

    pub async fn run(&mut self) -> Result<(), Box<dyn std::error::Error>> {
        println!("Starting chronomaxi logging service");
        let mut last_bulk_insert_time = Utc::now();
        loop {
            let log = self.capture_log().await?;

            if !self.is_idle() {
                if let Some(log_entry) = self.logs.get_mut(&log.current_program_process_name) {
                    let duration = Utc::now() - log_entry.created_at.unwrap_or(Utc::now());
                    log_entry.duration_ms = Some(
                        log_entry.duration_ms.unwrap_or(0.0) + duration.num_milliseconds() as f64,
                    );
                    log_entry.keys_pressed_count = Some(
                        log_entry.keys_pressed_count.unwrap_or(0)
                            + log.keys_pressed_count.unwrap_or(0),
                    );
                    log_entry.created_at = Some(Utc::now());
                } else {
                    let mut new_log = log.clone();
                    new_log.duration_ms = Some(0.0);
                    new_log.created_at = Some(Utc::now());
                    self.logs
                        .insert(log.current_program_process_name.clone(), new_log);
                }

                self.last_activity_time = Utc::now();
            } else {
                println!("Entering idle mode");

                // Reset the created_at timestamp of the log entry when exiting idle mode
                if let Some(log_entry) = self.logs.get_mut(&log.current_program_process_name) {
                    log_entry.created_at = Some(Utc::now());
                }
            }

            self.last_log_program_process_name = Some(log.current_program_process_name.clone());

            // Check if 3 minutes have passed since the last bulk insert
            let elapsed_time = Utc::now() - last_bulk_insert_time;
            if elapsed_time.num_seconds() >= 5 {
                // Bulk insert logs and flush the current log hashmap
                let logs_to_insert: Vec<Log> = self.logs.values().cloned().collect();
                if !logs_to_insert.is_empty() {
                    println!("Logs to insert:");
                    for log in &logs_to_insert {
                        println!("{}", log);
                    }
                    self.db.bulk_insert_logs(&logs_to_insert)?;
                    self.logs.clear();
                    last_bulk_insert_time = Utc::now();
                }
            }

            // Delay for 500ms before the next iteration
            tokio::time::sleep(std::time::Duration::from_millis(500)).await;
        }
    }

    pub fn get_last_log(&self) -> Option<Log> {
        self.logs.values().max_by_key(|log| log.created_at).cloned()
    }

    pub fn print_last_log(&self) {
        if let Some(last_log) = self.get_last_log() {
            println!("{}", last_log);
        }
    }

    pub fn update_idle_stats(&mut self, log: Log) {
        // check if the mouse moved
        if log.current_mouse_position != self.last_mouse_position {
            self.mouse_moved_in_last_idle_interval = true;
        } else {
            self.mouse_moved_in_last_idle_interval = false;
        }

        // check if keys were pressed
        if let Some(keys_pressed_count) = log.keys_pressed_count {
            self.keys_pressed_in_last_idle_interval += keys_pressed_count;
        } else {
            self.keys_pressed_in_last_idle_interval = 0;
        }

        // Reset keys_pressed_in_last_idle_interval when appropriate
        if self.is_idle() {
            self.keys_pressed_in_last_idle_interval = 0;
        }

        // update last to new values from log
        self.last_mouse_position = log.current_mouse_position;
        self.keys_pressed_in_last_idle_interval = log.keys_pressed_count.unwrap_or(0);
    }

    pub fn is_idle(&self) -> bool {
        let elapsed_time = Utc::now() - self.last_activity_time;
        elapsed_time.num_milliseconds() >= self.idle_threshold_ms as i64
    }

    pub async fn capture_log(&mut self) -> Result<Log, Box<dyn std::error::Error>> {
        let current_window_id = self.get_window_id();
        let current_program_name = self.get_program_process_name(current_window_id.clone());
        let current_program_title = self.get_program_name(current_window_id.clone());
        let current_browser_title =
            self.get_browser_title(current_program_name.clone(), current_window_id.clone());
        let (mouse_x, mouse_y) = self.get_mouse_position();
        let keys_pressed_count = Some(self.get_keys_pressed_count());

        let log = Log {
            current_window_id,
            current_program_process_name: current_program_name,
            current_program_name: current_program_title,
            current_browser_title,
            current_mouse_position: (mouse_x, mouse_y),
            duration_ms: None,
            keys_pressed_count,
            created_at: Some(Utc::now()),
        };

        self.update_idle_stats(log.clone());

        self.last_log_program_process_name = Some(log.current_program_process_name.clone());

        // every 100 logs, log the current log
        if self.logs.len() % 100 == 0 {
            println!("Log: {:?}", log);
        }

        Ok(log)
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

    pub fn get_browser_title(
        &self,
        current_program_name: String,
        current_window_id: String,
    ) -> String {
        if self.is_current_program_browser(current_program_name.clone()) {
            let browser_title = Command::new("xdotool")
                .arg("getwindowname")
                .arg(current_window_id)
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

    pub fn get_keys_pressed_count(&mut self) -> usize {
        let keys_pressed_count = self.device_state.get_keys().len();
        self.keys_pressed_in_last_idle_interval += keys_pressed_count;
        keys_pressed_count
    }
}
