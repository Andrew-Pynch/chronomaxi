use crate::{config::Configuration, db::DbConnection, log::Log};
use chrono::{DateTime, Utc};
use device_query::{DeviceQuery, DeviceState};
use std::{fmt, process::Command, sync::Arc};
use tokio::sync::Mutex;

#[derive(Debug, Clone)]
pub struct LoggerV3 {
    pub is_running: bool,

    pub config: Configuration,
    pub db: DbConnection,
    pub device_state: Arc<Mutex<DeviceState>>,
    pub logs: Vec<Log>,

    pub last_log_created_at_utc: chrono::DateTime<chrono::Utc>,
    pub idle_threshold_ms: u64,
    pub idle_timer: u64,

    pub last_mouse_position: (i32, i32),
    pub keys_pressed_in_last_idle_interval: usize,
    pub mouse_moved_in_last_idle_interval: bool,
}

impl LoggerV3 {
    pub async fn new() -> Result<LoggerV3, Box<dyn std::error::Error>> {
        Ok(LoggerV3 {
            is_running: false,
            config: Configuration::from_env().await?,
            db: DbConnection::new().await?,
            device_state: Arc::new(Mutex::new(DeviceState::new())),
            logs: Vec::new(),
            // create new utc of last log created at
            last_log_created_at_utc: chrono::Utc::now(),
            idle_threshold_ms: 60000,
            idle_timer: 0,
            last_mouse_position: (0, 0),
            keys_pressed_in_last_idle_interval: 0,
            mouse_moved_in_last_idle_interval: false,
        })
    }

    pub async fn run(&mut self) -> Result<(), Box<dyn std::error::Error>> {
        println!("Starting chronomaxi logging service");

        while self.is_running {
            let log = self.capture_log().await?;

            if !self.is_idle() {
                self.logs.push(log.clone());
                if self.logs.len() % 100 == 0 {
                    self.print_last_log();
                    println!("Logs captured: {}", self.logs.len());
                }

                if self.logs.len() >= 1800 {
                    self.db.bulk_insert_logs(&self.logs).await?;
                    self.logs.clear();
                }
            }
        }

        Ok(())
    }

    pub fn start(&mut self) {
        if !self.is_running {
            self.is_running = true;
            let (stop_sender, stop_receiver) = oneshot::channel();
            self.stop_signal = Some(stop_sender);

            let mut logger = self.clone();
            std::thread::spawn(move || {
                let rt = tokio::runtime::Runtime::new().unwrap();
                rt.block_on(async move {
                    tokio::select! {
                        _ = logger.run() => {}
                        _ = stop_receiver => {}
                    }
                });
            });
        }
    }

    pub fn stop(&mut self) {
        if self.is_running {
            self.is_running = false;
            if let Some(stop_sender) = self.stop_signal.take() {
                let _ = stop_sender.send(());
            }
        }
    }

    pub fn print_last_log(&self) {
        if let Some(last_log) = self.logs.last() {
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

        // update last to new values from log
        self.last_mouse_position = log.current_mouse_position;
        self.keys_pressed_in_last_idle_interval = log.keys_pressed_count.unwrap_or(0);

        if self.mouse_moved_in_last_idle_interval || self.keys_pressed_in_last_idle_interval > 0 {
            if self.idle_timer > self.idle_threshold_ms {
                println!("Logger is no longer idle");
            }
            self.idle_timer = 0;
        } else {
            self.idle_timer += 100; // 100 ms per log
        }
    }

    pub fn is_idle(&self) -> bool {
        self.idle_timer >= self.idle_threshold_ms
    }

    pub async fn capture_log(&mut self) -> Result<Log, Box<dyn std::error::Error>> {
        let current_window_id = self.get_window_id();
        let current_program_name = self.get_program_process_name(current_window_id.clone());
        let current_program_title = self.get_program_name(current_window_id.clone());
        let current_browser_title =
            self.get_browser_title(current_program_name.clone(), current_window_id.clone());
        let (mouse_x, mouse_y) = self.get_mouse_position();
        let keys_pressed_count = self.get_keys_pressed_count().await;

        let log = Log {
            user_id: self.config.user_id.clone(),
            current_window_id,
            current_program_process_name: current_program_name,
            current_program_name: current_program_title,
            current_browser_title,
            current_mouse_position: (mouse_x, mouse_y),
            keys_pressed_count,
            created_at: Some(Utc::now()),
        };

        self.update_idle_stats(log.clone());

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

    pub async fn get_keys_pressed_count(&mut self) -> Option<usize> {
        let device_state = self.device_state.lock().await;
        let keys_pressed_count = device_state.get_keys();

        if keys_pressed_count.is_empty() {
            return None;
        } else {
            return Some(keys_pressed_count.len());
        }
    }
}
