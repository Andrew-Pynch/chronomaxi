use chrono::Utc;
use device_query::{DeviceQuery, MouseState};
use std::process::Command;

use crate::{
    category::{self, Category},
    config::Configuration,
    db::DbConnection,
    idle_tracking::IdleTracker,
    log::Log,
};

/// LoggerV4 is a struct that represents the logging functionality for chronomaxi.
/// It captures and logs user activity such as window changes, key presses, and mouse movements.
/// The logged data is periodically saved to a database.
pub struct LoggerV4 {
    pub idle_tracker: IdleTracker,
    pub config: Configuration,
    pub db: DbConnection,

    pub device_state: device_query::DeviceState,
    pub last_mouse_position: Option<(i32, i32)>,
    pub last_mouse_state: MouseState,

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
        let device_state = device_query::DeviceState::new();
        let initial_mouse_position = device_state.get_mouse().coords;
        let initial_mouse_state = device_state.get_mouse();

        Ok(LoggerV4 {
            idle_tracker: IdleTracker::new(),
            config: Configuration::from_env().await?,
            db: DbConnection::new()?,

            device_state,
            last_mouse_position: Some(initial_mouse_position),
            last_mouse_state: initial_mouse_state,

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

            if let Err(e) = self.accumulate_left_click_count() {
                println!("Error accumulating left click count: {:?}", e);
            }

            if let Err(e) = self.accumulate_right_click_count() {
                println!("Error accumulating right click count: {:?}", e);
            }

            if let Err(e) = self.accumulate_middle_click_count() {
                println!("Error accumulating middle click count: {:?}", e);
            }

            // reset mouse state
            self.last_mouse_state = self.device_state.get_mouse();

            if let Err(e) = self.log_on_window_change() {
                println!("Error logging on window change: {:?}", e);
            }

            self.stats_every_n_logs(&self.current_log.as_ref().unwrap());
            self.save_to_db_every_n_seconds();

            // sleep for 250ms before next iteration
            tokio::time::sleep(std::time::Duration::from_millis(
                self.config.log_iteration_pause_ms,
            ))
            .await;
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
            println!("\nThere are currently {} logs", self.logs.len());
            println!("\nLog Snapshot: \n{}\n\n", log);
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

        let (current_browser_title, current_browser_site_name) = self
            .get_browser_title_and_site_name(
                current_program_process_name.clone(),
                current_window_id.clone(),
            )
            .unwrap_or((None, None));

        let (mouse_x, mouse_y) = self.get_mouse_position();
        let keys_pressed_count = Some(self.get_keys_pressed_count());

        let category = self.get_category(
            &current_program_name,
            &current_program_process_name,
            current_browser_title.as_deref(),
            current_browser_site_name.as_deref(),
        );
        let mouse_movement_mm = self.get_mouse_movement_mm();

        let mut log = Log {
            current_window_id: Some(current_window_id),
            current_program_process_name: Some(current_program_process_name),
            current_program_name: Some(current_program_name),
            current_browser_title: current_browser_title,
            current_mouse_position: Some((mouse_x, mouse_y)),
            duration_ms: None,
            keys_pressed_count,
            created_at: Some(Utc::now()),
            log_start_time_utc: Some(Utc::now()),
            log_end_time_utc: None,
            is_idle: false,
            category: Some(category),
            mouse_movement_mm: Some(mouse_movement_mm as f64),
            left_click_count: Some(0),
            right_click_count: Some(0),
            middle_click_count: Some(0),
        };
        log.is_idle = self.idle_tracker.is_idle(&log);

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
    pub fn is_current_program_browser(&self, current_program_process_name: String) -> bool {
        const FIREFOX: &str = "firefox";
        const CHROME: &str = "chrome";
        const BRAVE: &str = "brave-browser";
        const EDGE: &str = "edge";
        const SAFARI: &str = "safari";

        return current_program_process_name == FIREFOX
            || current_program_process_name == CHROME
            || current_program_process_name == BRAVE
            || current_program_process_name == EDGE
            || current_program_process_name == SAFARI;
    }

    /// Retrieves the title of the web browser window associated with the given window ID.
    ///
    /// # Arguments
    /// * `current_program_name` - A `String` representing the current program name.
    /// * `current_window_id` - A `String` representing the current window ID.
    ///
    /// # Returns
    /// A `Option<(String, Option<String>)>` representing the browser window title and site name, or `None` if the program is not a browser.
    pub fn get_browser_title_and_site_name(
        &self,
        current_program_process_name: String,
        current_window_id: String,
    ) -> Option<(Option<String>, Option<String>)> {
        if self.is_current_program_browser(current_program_process_name.clone()) {
            let browser_title = Command::new("xdotool")
                .arg("getwindowname")
                .arg(current_window_id)
                .output()
                .expect("Failed to get browser title")
                .stdout;

            let browser_title_str = String::from_utf8(browser_title).unwrap();
            let browser_title_parts: Vec<&str> = browser_title_str.trim().split(" - ").collect();

            match browser_title_parts.len() {
                3 => Some((
                    Some(browser_title_parts[0].trim().to_string()),
                    Some(browser_title_parts[1].trim().to_string()),
                )),
                2 => Some((
                    Some(browser_title_parts[0].trim().to_string()),
                    Some(browser_title_parts[1].trim().to_string()),
                )),
                _ => Some((Some(browser_title_str.trim().to_string()), None)),
            }
        } else {
            None
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

    /// Retrieves the category of the current activity.
    ///
    /// # Returns
    /// A `String` representing the category of the current activity.
    pub fn get_category(
        &self,
        program_name: &str,
        program_process_name: &str,
        browser_title: Option<&str>,
        browser_site_name: Option<&str>,
    ) -> Category {
        return category::get_category(
            program_name,
            program_process_name,
            browser_title,
            browser_site_name,
        );
    }

    /// Retrieves the mouse movement in millimeters.
    ///
    /// # Returns
    /// A `usize` representing the mouse movement in millimeters.
    pub fn get_mouse_movement_mm(&mut self) -> f64 {
        let current_position = self.device_state.get_mouse().coords;

        // why did I make this an option? too late not changing :D
        let movement = if let Some(last_position) = self.last_mouse_position {
            (
                (current_position.0 - last_position.0) as f64,
                (current_position.1 - last_position.1) as f64,
            )
        } else {
            (0.0, 0.0)
        };

        // Update last_mouse_position for the next call
        self.last_mouse_position = Some(current_position);

        // Calculate Euclidean distance
        let distance_px = (movement.0.powi(2) + movement.1.powi(2)).sqrt();

        // Convert pixels to millimeters
        // This conversion factor assumes a standard 96 DPI screen
        // You might want to make this configurable or detect it dynamically
        let px_to_mm = 25.4 / 96.0;
        let distance_mm = distance_px * px_to_mm;

        distance_mm
    }

    // === these check if button is pressed and if it wasn't pressed before ===
    pub fn accumulate_left_click_count(&mut self) -> Result<(), Box<dyn std::error::Error>> {
        let current_mouse_state = self.device_state.get_mouse();
        if current_mouse_state.button_pressed[1] && !self.last_mouse_state.button_pressed[1] {
            if let Some(log) = self.current_log.as_mut() {
                log.left_click_count = Some(log.left_click_count.unwrap_or(0) + 1);
            }
        }
        Ok(())
    }

    pub fn accumulate_right_click_count(&mut self) -> Result<(), Box<dyn std::error::Error>> {
        let current_mouse_state = self.device_state.get_mouse();
        if current_mouse_state.button_pressed[3] && !self.last_mouse_state.button_pressed[3] {
            if let Some(log) = self.current_log.as_mut() {
                log.right_click_count = Some(log.right_click_count.unwrap_or(0) + 1);
            }
        }
        Ok(())
    }

    pub fn accumulate_middle_click_count(&mut self) -> Result<(), Box<dyn std::error::Error>> {
        let current_mouse_state = self.device_state.get_mouse();
        if current_mouse_state.button_pressed[2] && !self.last_mouse_state.button_pressed[2] {
            if let Some(log) = self.current_log.as_mut() {
                log.middle_click_count = Some(log.middle_click_count.unwrap_or(0) + 1);
            }
        }
        Ok(())
    }
    // ========================================================================
}
