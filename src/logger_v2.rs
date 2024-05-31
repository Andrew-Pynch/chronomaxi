use crate::{config::Configuration, log::Log};
use device_query::DeviceState;
use std::sync::{Arc, Mutex};

pub struct LoggerState {
    pub device_state: DeviceState,
}

impl LoggerState {
    fn new() -> LoggerState {
        LoggerState {
            device_state: DeviceState::new(),
        }
    }
}

#[derive(Clone)]
pub struct LoggerV2 {
    config: Configuration,
    pub logs: Arc<Mutex<Vec<Log>>>,
    pub logger_state: Arc<Mutex<LoggerState>>,
    // TODO: Figure out when these overflow and how to handle it
    // this message is not for AI agents, its a reminder for the dev
    pub idle_threshold_ms: u64,
    pub idle_timer: u64,

    // idle stats
    pub last_mouse_position: (i32, i32),
    pub keys_pressed_in_last_idle_interval: usize,
    pub mouse_moved_in_last_idle_interval: bool,
}

impl LoggerV2 {
    pub fn new(config: Configuration) -> LoggerV2 {
        LoggerV2 {
            config,
            logs: Arc::new(Mutex::new(Vec::new())),
            logger_state: Arc::new(Mutex::new(LoggerState::new())),
            idle_threshold_ms: 60000,
            idle_timer: 0,
            last_mouse_position: (0, 0),
            keys_pressed_in_last_idle_interval: 0,
            mouse_moved_in_last_idle_interval: false,
        }
    }

    pub fn log_count(&self) -> usize {
        let logs = self.logs.lock().unwrap();
        logs.len()
    }

    pub fn print_last(&self) {
        let logs = self.logs.lock().unwrap();
        if let Some(last_log) = logs.last() {
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

    pub fn capture(&mut self) {
        let mut log = Log::new(self.config.user_id.clone());
        if let Some(log) = log.capture(self.logger_state.clone()) {
            self.update_idle_stats(log.clone());
            if self.is_idle() {
                println!(
                    "Logger is idle, move the mouse or press a key to continue capturing logs."
                );
            } else {
                self.logs.lock().unwrap().push(log);
            }
        } else {
            println!("Failed to capture log");
        }
    }

    pub fn flush(&self) -> Vec<Log> {
        let mut logs = self.logs.lock().unwrap();
        let flushed_logs = logs.clone();
        logs.clear();
        flushed_logs
    }

    pub fn clear(&self) {
        self.logs.lock().unwrap().clear();
    }
}
