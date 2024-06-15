use chrono::Utc;
use device_query::DeviceQuery;
use std::process::Command;

use crate::{config::Configuration, db::DbConnection, idle_tracking::IdleTracker, log::Log};

/// LoggerV4 is a struct that represents the logging functionality for chronomaxi.
/// It captures and logs user activity such as window changes, key presses, and mouse movements.
/// The logged data is periodically saved to a database.
pub struct LoggerV4 {
    pub idle_tracker: IdleTracker,
    pub is_idle: bool,

    pub config: Configuration,
    pub db: DbConnection,

    pub device_state: device_query::DeviceState,

    pub logs: Vec<Log>,

    pub last_bulk_insert_time: chrono::DateTime<chrono::Utc>,

    pub current_log: Option<Log>,
    pub current_window_id: Option<String>,
    pub last_window_id: Option<String>,
}

impl LoggerV4 {
    /// Creates a new instance of LoggerV4.
    /// It initializes the configuration, database connection, and device state.
    ///
    /// # Returns
    /// A `Result` containing the new `LoggerV4` instance or an error if initialization fails.
    pub async fn new() -> Result<LoggerV4, Box<dyn std::error::Error>> {
        Ok(LoggerV4 {
            idle_tracker: IdleTracker::new(),
            is_idle: false,

            config: Configuration::from_env().await?,
            db: DbConnection::new()?,
            device_state: device_query::DeviceState::new(),
            logs: Vec::new(),
            last_bulk_insert_time: chrono::Utc::now(),

            current_log: None,
            current_window_id: None,
            last_window_id: None,
        })
    }

    /// Runs the logging process continuously.
    /// It captures user activity, logs window changes, accumulates key presses,
    /// and periodically saves the logs to the database.
    ///
    /// # Returns
    /// A `Result` indicating success or an error if the logging process encounters an issue.
    pub async fn run(&mut self) -> Result<(), Box<dyn std::error::Error>> {
        println!("Starting chronomaxi logging service");

        self.current_window_id = Some(self.get_window_id());
        self.last_window_id = self.current_window_id.clone();

        self.current_log = Some(self.capture()?);

        loop {
            self.current_window_id = Some(self.get_window_id());

            if let Err(e) = self.accumulate_keys_pressed() {
                println!("Error accumulating keys pressed: {:?}", e);
            }

            if let Err(e) = self.log_on_window_change() {
                println!("Error logging on window change: {:?}", e);
            }

            self.handle_idle_and_logging();

            // sleep for 250ms before next iteration
            tokio::time::sleep(std::time::Duration::from_millis(
                self.config.log_iteration_pause_ms,
            ))
            .await;
        }
    }

    /// Handles the idle tracking functionality of the logger.
    /// It checks if the user is idle based on the current log and updates the idle state accordingly.
    /// If the user is not idle, it performs logging activities such as printing stats and saving logs to the database.
    pub fn handle_idle_and_logging(&mut self) {
        if let Some(current_log) = self.current_log.as_ref() {
            if self.is_idle {
                // If the logger is currently in idle mode
                if !self.idle_tracker.is_idle(current_log) {
                    // If the user is no longer idle based on the current log
                    self.is_idle = false; // Set the idle state to false
                    println!("User activity detected. Resuming normal logging.");
                }
            } else {
                // If the logger is not currently in idle mode
                if self.idle_tracker.is_idle(current_log) {
                    // If the user is idle based on the current log
                    let time_until_idle = self.idle_tracker.idle_threshold_ms
                        - current_log.duration_ms.unwrap_or_default();
                    println!(
                        "{} ms until program enters idle mode and stops logging",
                        time_until_idle
                    );

                    if time_until_idle <= 0 {
                        // If the time until idle is less than or equal to zero
                        self.is_idle = true; // Set the idle state to true
                        println!("Entering idle mode. Logging paused.");
                    }
                } else {
                    // If the user is not idle
                    self.stats_every_n_logs(current_log); // Print stats if the log count reaches a threshold
                    self.save_to_db_every_n_seconds(); // Save logs to the database periodically
                }
            }
        }
    }

    /// Logs the current activity when a window change is detected.
    /// If the current window ID differs from the last window ID, it ends the current log
    /// and starts a new log for the new window.
    ///
    /// # Returns
    /// A `Result` indicating success or an error if ending the current log fails.
    pub fn log_on_window_change(&mut self) -> Result<(), Box<dyn std::error::Error>> {
        if self.current_window_id != self.last_window_id {
            self.end_current_log()?;
        }
        Ok(())
    }

    /// Accumulates the count of keys pressed in the current log.
    /// It retrieves the count of newly pressed keys and adds it to the existing count
    /// in the current log.
    ///
    /// # Returns
    /// A `Result` indicating success or an error if updating the key press count fails.
    pub fn accumulate_keys_pressed(&mut self) -> Result<(), Box<dyn std::error::Error>> {
        let new_keys_pressed_count = self.get_keys_pressed_count();
        if let Some(log) = self.current_log.as_mut() {
            if let Some(current_count) = log.keys_pressed_count {
                log.keys_pressed_count = Some(current_count + new_keys_pressed_count);
            } else {
                log.keys_pressed_count = Some(new_keys_pressed_count);
            }
        }
        Ok(())
    }

    /// Ends the current log by updating the key press count, calculating the duration,
    /// and adding the log to the collection of logs.
    /// It then starts a new log for the current activity.
    ///
    /// # Returns
    /// A `Result` indicating success or an error if capturing the new log fails.
    pub fn end_current_log(&mut self) -> Result<(), Box<dyn std::error::Error>> {
        // update keys pressed with most recent count before insert
        let keys_pressed_count = self.get_keys_pressed_count();
        if let Some(log) = self.current_log.as_mut() {
            log.keys_pressed_count = Some(keys_pressed_count);
        }

        // calculate duration and end 08:24
        if let Some(log) = self.current_log.as_mut() {
            log.log_end_time_utc = Some(Utc::now());
            log.duration_ms = log.get_log_duration_ms();
        }

        // insert
        if let Some(log) = self.current_log.as_mut() {
            self.logs.push(log.clone());
        }

        // set to new log
        self.current_log = Some(self.capture()?);

        // update so that we know window changed
        self.last_window_id = self.current_window_id.clone();

        Ok(())
    }

    /// Saves the collected logs to the database every specified number of seconds.
    /// It performs pre-insertion checks, inserts the logs into the database,
    /// clears the log collection, and updates the last bulk insert time.
    pub fn save_to_db_every_n_seconds(&mut self) {
        self.end_current_log().unwrap();

        let elapsed_time = Utc::now() - self.last_bulk_insert_time;
        if elapsed_time.num_seconds() >= self.config.stats_every_n_seconds {
            let insert_result = self.db.bulk_insert_logs(&self.logs);

            if insert_result.is_err() {
                println!("Error inserting logs: {:?}", insert_result);
            } else {
                println!("Inserted {} logs", self.logs.len());
            }

            self.logs.clear();
            self.last_bulk_insert_time = Utc::now();
        }
    }

    /// Prints a snapshot of the current log if the number of collected logs reaches a specified threshold.
    ///
    /// # Arguments
    /// * `log` - A reference to the current log.
    pub fn stats_every_n_logs(&self, log: &Log) {
        if self.logs.len() >= self.config.log_every_n_logs {
            println!("\n\nLog Snapshot: \n{}", log)
        }
    }

    /// Captures the current activity and creates a new log entry.
    /// It retrieves the current window ID, program process name, program name, browser title,
    /// mouse position, and key press count to create a new `Log` instance.
    ///
    /// # Returns
    /// A `Result` containing the new `Log` instance or an error if capturing the activity fails.
    pub fn capture(&mut self) -> Result<Log, Box<dyn std::error::Error>> {
        let current_window_id = self.get_window_id();
        let current_program_process_name = self.get_program_process_name(current_window_id.clone());
        let current_program_name = self.get_program_name(current_window_id.clone());
        let current_browser_title =
            self.get_browser_title(current_program_name.clone(), current_window_id.clone());
        let (mouse_x, mouse_y) = self.get_mouse_position();
        let keys_pressed_count = Some(self.get_keys_pressed_count());

        let log = Log {
            current_window_id: Some(current_window_id),
            current_program_process_name: Some(current_program_process_name),
            current_program_name: Some(current_program_name),
            current_browser_title: Some(current_browser_title),
            current_mouse_position: Some((mouse_x, mouse_y)),
            duration_ms: None,
            keys_pressed_count,
            created_at: Some(Utc::now()),
            log_start_time_utc: Some(Utc::now()),
            log_end_time_utc: None,
        };

        Ok(log)
    }

    /// Retrieves the ID of the currently active window using the `xdotool` command.
    ///
    /// # Returns
    /// A `String` representing the window ID.
    pub fn get_window_id(&self) -> String {
        let window_id = Command::new("xdotool")
            .arg("getactivewindow")
            .output()
            .expect("Failed to get window id")
            .stdout;
        return String::from_utf8(window_id).unwrap().trim().to_string();
    }

    /// Retrieves the program process name associated with the given window ID using the `xprop` command.
    ///
    /// # Arguments
    /// * `current_window_id` - A `String` representing the current window ID.
    ///
    /// # Returns
    /// A `String` representing the program process name.
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

    /// Retrieves the program name associated with the given window ID using the `xdotool` command.
    ///
    /// # Arguments
    /// * `current_window_id` - A `String` representing the current window ID.
    ///
    /// # Returns
    /// A `String` representing the program name.
    pub fn get_program_name(&self, current_window_id: String) -> String {
        let program_name = Command::new("xdotool")
            .arg("getwindowname")
            .arg(current_window_id)
            .output()
            .expect("Failed to get program name")
            .stdout;
        return String::from_utf8(program_name).unwrap().trim().to_string();
    }

    /// Checks if the given program name corresponds to a web browser.
    ///
    /// # Arguments
    /// * `current_program_name` - A `String` representing the current program name.
    ///
    /// # Returns
    /// A `bool` indicating whether the program is a web browser.
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

    /// Retrieves the title of the web browser window associated with the given window ID.
    ///
    /// # Arguments
    /// * `current_program_name` - A `String` representing the current program name.
    /// * `current_window_id` - A `String` representing the current window ID.
    ///
    /// # Returns
    /// A `String` representing the browser window title, or an empty string if the program is not a browser.
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

    /// Retrieves the current mouse position using the `xdotool` command.
    ///
    /// # Returns
    /// A tuple `(i32, i32)` representing the mouse position coordinates (x, y).
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
            match (
                mouse_position_str[0].parse::<i32>(),
                mouse_position_str[1].parse::<i32>(),
            ) {
                (Ok(x), Ok(y)) => (x, y),
                _ => {
                    eprintln!("Failed to parse mouse position: {:?}", mouse_position_str);
                    (0, 0)
                }
            }
        } else {
            eprintln!("Failed to parse mouse position: {:?}", mouse_position_str);
            (0, 0)
        }
    }

    /// Retrieves the count of keys currently pressed using the `device_state`.
    ///
    /// # Returns
    /// A `usize` representing the count of keys pressed.
    pub fn get_keys_pressed_count(&mut self) -> usize {
        let keys_pressed_count = self.device_state.get_keys().len();

        return keys_pressed_count;
    }
}
