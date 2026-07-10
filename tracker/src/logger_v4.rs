use chrono::{Duration, Utc};
use device_query::{DeviceQuery, MouseState};
use serde::Deserialize;
use std::env;
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use tokio::time;

use crate::{
    category::{self, Category},
    config::Configuration,
    db::DbConnection,
    idle_tracking::IdleTracker,
    log::Log,
};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum CaptureBackend {
    Hyprland,
    X11,
}

#[derive(Clone, Debug)]
struct ActiveWindow {
    id: String,
    program_process_name: String,
    program_name: String,
    title: String,
}

#[derive(Deserialize)]
struct HyprActiveWindow {
    address: Option<String>,
    class: Option<String>,
    title: Option<String>,
    #[allow(dead_code)]
    pid: Option<i64>,
}

const MAX_SPAN_SECONDS: i64 = 60;
const CHECKPOINT_SPAN_SECONDS: i64 = 40;
static SHUTDOWN_REQUESTED: AtomicBool = AtomicBool::new(false);
const SIGINT: i32 = 2;
const SIGTERM: i32 = 15;

extern "C" {
    fn signal(signum: i32, handler: extern "C" fn(i32)) -> extern "C" fn(i32);
}

extern "C" fn request_shutdown(_: i32) {
    SHUTDOWN_REQUESTED.store(true, Ordering::SeqCst);
}

fn install_shutdown_signal_handlers() {
    unsafe {
        signal(SIGINT, request_shutdown);
        signal(SIGTERM, request_shutdown);
    }
}

fn run_cmd(cmd: &str, args: &[&str]) -> Option<String> {
    let output = Command::new(cmd).args(args).output().ok()?;
    if !output.status.success() {
        return None;
    }

    Some(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn select_backend() -> CaptureBackend {
    let has_hyprland = env::var("HYPRLAND_INSTANCE_SIGNATURE")
        .map(|value| !value.trim().is_empty())
        .unwrap_or(false);
    let is_wayland = env::var("XDG_SESSION_TYPE")
        .map(|value| value.eq_ignore_ascii_case("wayland"))
        .unwrap_or(false);

    if has_hyprland || is_wayland {
        CaptureBackend::Hyprland
    } else {
        CaptureBackend::X11
    }
}

/// LoggerV4 is a struct that represents the logging functionality for chronomaxi.
/// It captures and logs user activity such as window changes, key presses, and mouse movements.
/// The logged data is periodically saved to a database.
pub struct LoggerV4 {
    pub idle_tracker: IdleTracker,
    pub config: Configuration,
    pub db: DbConnection,
    pub device_state: device_query::DeviceState,
    backend: CaptureBackend,
    pub last_mouse_position: Option<(i32, i32)>,
    pub last_mouse_state: Option<MouseState>,

    pub logs: Vec<Log>,

    pub last_bulk_insert_time: chrono::DateTime<chrono::Utc>,

    pub current_log: Option<Log>,
    pub current_window_id: Option<String>,
    pub last_window_id: Option<String>,
    last_active_window: Option<ActiveWindow>,
}

impl LoggerV4 {
    /// Creates a new instance of LoggerV4.
    /// It initializes the configuration, database connection, and device state.
    ///
    /// # Returns
    /// A `Result` containing the new `LoggerV4` instance or an error if initialization fails.
    pub async fn new() -> Result<LoggerV4, Box<dyn std::error::Error>> {
        let backend = select_backend();
        let device_state = device_query::DeviceState::new();
        let initial_mouse_position = match backend {
            CaptureBackend::X11 => Some(device_state.get_mouse().coords),
            CaptureBackend::Hyprland => parse_hypr_cursorpos().or(Some((0, 0))),
        };
        let initial_mouse_state = match backend {
            CaptureBackend::X11 => Some(device_state.get_mouse()),
            CaptureBackend::Hyprland => None,
        };

        let config = Configuration::from_env()?;
        let db = DbConnection::new(&config).await?;

        println!("Using {:?} capture backend", backend);

        Ok(LoggerV4 {
            idle_tracker: IdleTracker::new(),
            config,
            db,
            device_state,
            backend,
            last_mouse_position: initial_mouse_position,
            last_mouse_state: initial_mouse_state,

            logs: Vec::new(),

            last_bulk_insert_time: chrono::Utc::now(),

            current_log: None,
            current_window_id: None,
            last_window_id: None,
            last_active_window: None,
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

        install_shutdown_signal_handlers();

        let mut interval = time::interval(
            Duration::milliseconds(self.config.log_iteration_pause_ms as i64).to_std()?,
        );

        loop {
            interval.tick().await;

            if SHUTDOWN_REQUESTED.swap(false, Ordering::SeqCst) {
                self.flush_current_log_to_db().await;
                break;
            }

            if let Err(e) = self.tick().await {
                println!("Error during log tick: {:?}", e);
            }
        }

        Ok(())
    }

    async fn tick(&mut self) -> Result<(), Box<dyn std::error::Error>> {
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
        if self.backend == CaptureBackend::X11 {
            self.last_mouse_state = Some(self.device_state.get_mouse());
        }

        let completed_log = self.log_on_window_change()?;
        if completed_log {
            self.flush_completed_logs_to_db().await;
        }

        if let Some(log) = &self.current_log {
            self.stats_every_n_seconds(log);
        }

        self.save_to_db_every_n_seconds().await;

        Ok(())
    }

    /// Logs the current activity when a window change is detected.
    /// If the current window ID differs from the last window ID, it ends the current log
    /// and starts a new log for the new window.
    ///
    /// # Returns
    /// A `Result` indicating success or an error if ending the current log fails.
    pub fn log_on_window_change(&mut self) -> Result<bool, Box<dyn std::error::Error>> {
        let active_window = self.get_active_window();
        self.current_window_id = Some(active_window.id.clone());

        let mouse_position = self.get_mouse_position();
        let mouse_movement_mm = self.get_mouse_movement_mm();
        let now = Utc::now();

        if let Some(log) = self.current_log.as_mut() {
            log.current_mouse_position = Some(mouse_position);
            log.mouse_movement_mm = Some(log.mouse_movement_mm.unwrap_or(0.0) + mouse_movement_mm);
            log.log_end_time_utc = Some(now);
            log.duration_ms = log.get_log_duration_ms();
        }

        let mut idle_probe = self.current_log.clone().unwrap_or_else(Log::new);
        idle_probe.current_window_id = Some(active_window.id.clone());
        idle_probe.current_program_process_name = Some(active_window.program_process_name.clone());
        idle_probe.current_program_name = Some(active_window.program_name.clone());
        idle_probe.current_mouse_position = Some(mouse_position);
        let is_idle = self.idle_tracker.is_idle(&idle_probe);

        let should_end_current_log = self.current_log.as_ref().is_some_and(|log| {
            let window_changed =
                log.current_window_id.as_deref() != Some(active_window.id.as_str())
                    || log.current_program_process_name.as_deref()
                        != Some(active_window.program_process_name.as_str());
            let idle_changed = log.is_idle != is_idle;
            let span_capped = log
                .log_start_time_utc
                .is_some_and(|start_time| now - start_time >= Duration::seconds(MAX_SPAN_SECONDS));
            let span_checkpointed = log.log_start_time_utc.is_some_and(|start_time| {
                now - start_time >= Duration::seconds(CHECKPOINT_SPAN_SECONDS)
            });

            window_changed || idle_changed || span_capped || span_checkpointed
        });

        if should_end_current_log {
            self.end_current_log_at(now)?;
        } else if let Some(log) = self.current_log.as_mut() {
            log.current_window_id = Some(active_window.id);
            log.current_program_process_name = Some(active_window.program_process_name);
            log.current_program_name = Some(active_window.program_name);
            log.is_idle = is_idle;
            self.last_window_id = self.current_window_id.clone();
        }

        Ok(should_end_current_log)
    }

    /// Accumulates the count of keys pressed in the current log.
    /// It retrieves the count of newly pressed keys and adds it to the existing count
    /// in the current log.
    ///
    /// # Returns
    /// A `Result` indicating success or an error if updating the key press count fails.
    pub fn accumulate_keys_pressed(&mut self) -> Result<(), Box<dyn std::error::Error>> {
        let Some(new_keys_pressed_count) = self.get_keys_pressed_count() else {
            return Ok(());
        };

        if let Some(log) = self.current_log.as_mut() {
            if let Some(current_count) = log.keys_pressed_count {
                log.keys_pressed_count = Some(current_count + new_keys_pressed_count);
            } else {
                log.keys_pressed_count = Some(new_keys_pressed_count);
            }
        }
        Ok(())
    }

    /// Ends the current log by calculating the duration and adding the log to the collection of logs.
    /// It then starts a new log for the current activity.
    ///
    /// # Returns
    /// A `Result` indicating success or an error if capturing the new log fails.
    pub fn end_current_log(&mut self) -> Result<(), Box<dyn std::error::Error>> {
        self.end_current_log_at(Utc::now())
    }

    fn end_current_log_at(
        &mut self,
        end_time: chrono::DateTime<chrono::Utc>,
    ) -> Result<(), Box<dyn std::error::Error>> {
        if let Some(log) = self.current_log.as_mut() {
            log.log_end_time_utc = Some(end_time);
            log.duration_ms = log.get_log_duration_ms();
            self.logs.push(log.clone());
        }

        self.current_log = Some(self.capture()?);
        self.last_window_id = self.current_window_id.clone();

        Ok(())
    }

    /// Saves the collected completed logs to the database every specified number of seconds.
    /// The in-progress span is not ended by this periodic flush.
    pub async fn save_to_db_every_n_seconds(&mut self) {
        let elapsed_time = Utc::now() - self.last_bulk_insert_time;
        if elapsed_time >= Duration::seconds(self.config.stats_every_n_seconds) {
            if self.logs.is_empty() {
                self.last_bulk_insert_time = Utc::now();
                return;
            }

            self.flush_completed_logs_to_db().await;
        }
    }

    async fn flush_completed_logs_to_db(&mut self) {
        if self.logs.is_empty() {
            return;
        }

        let insert_result = self.db.bulk_insert_logs(&self.logs).await;
        if let Err(e) = insert_result {
            println!("Error inserting logs: {:?}", e);
        } else {
            println!("Inserted {} logs", self.logs.len());
            self.logs.clear();
            self.last_bulk_insert_time = Utc::now();
        }
    }

    async fn flush_current_log_to_db(&mut self) {
        if let Err(e) = self.end_current_log() {
            println!("Error ending current log before shutdown: {:?}", e);
            return;
        }

        self.flush_completed_logs_to_db().await;
    }

    /// Prints a snapshot of the current log if the number of collected logs reaches a specified threshold.
    ///
    /// # Arguments
    /// * `log` - A reference to the current log.
    pub fn stats_every_n_seconds(&self, log: &Log) {
        let elapsed_time = Utc::now() - self.last_bulk_insert_time;
        if elapsed_time >= Duration::seconds(self.config.stats_every_n_seconds) {
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
        let active_window = self.get_active_window();
        let current_window_id = active_window.id.clone();
        let current_program_process_name = active_window.program_process_name.clone();
        let current_program_name = active_window.program_name.clone();

        let (current_browser_title, current_browser_site_name) = self
            .get_browser_title_and_site_name(
                current_program_process_name.clone(),
                current_window_id.clone(),
            )
            .unwrap_or((None, None));

        let (mouse_x, mouse_y) = self.get_mouse_position();
        let keys_pressed_count = self.get_keys_pressed_count();

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
            current_browser_title,
            current_mouse_position: Some((mouse_x, mouse_y)),
            duration_ms: None,
            keys_pressed_count,
            created_at: Some(Utc::now()),
            log_start_time_utc: Some(Utc::now()),
            log_end_time_utc: None,
            is_idle: false,
            category: Some(category),
            mouse_movement_mm: Some(mouse_movement_mm),
            left_click_count: Some(0),
            right_click_count: Some(0),
            middle_click_count: Some(0),
        };
        log.is_idle = self.idle_tracker.is_idle(&log);

        Ok(log)
    }

    fn get_active_window(&mut self) -> ActiveWindow {
        let next_window = match self.backend {
            CaptureBackend::Hyprland => self.get_hyprland_active_window(),
            CaptureBackend::X11 => self.get_x11_active_window(),
        };

        match next_window {
            Some(window) => {
                self.last_active_window = Some(window.clone());
                window
            }
            None => self.last_active_window.clone().unwrap_or_else(unknown_window),
        }
    }

    fn get_hyprland_active_window(&self) -> Option<ActiveWindow> {
        let json = run_cmd("hyprctl", &["activewindow", "-j"])?;
        let window: HyprActiveWindow = serde_json::from_str(&json).ok()?;
        let class = window.class.unwrap_or_else(|| "unknown".to_string());

        Some(ActiveWindow {
            id: window.address.unwrap_or_else(|| "unknown".to_string()),
            program_process_name: class.to_lowercase(),
            program_name: class,
            title: window.title.unwrap_or_else(|| "unknown".to_string()),
        })
    }

    fn get_x11_active_window(&self) -> Option<ActiveWindow> {
        let id = run_cmd("xdotool", &["getactivewindow"])?;
        let program_process_name = parse_wm_class(
            &run_cmd("xprop", &["-id", id.as_str(), "WM_CLASS"]).unwrap_or_default(),
        )
        .unwrap_or_else(|| "unknown".to_string());
        let title = run_cmd("xdotool", &["getwindowname", id.as_str()])
            .unwrap_or_else(|| "unknown".to_string());

        Some(ActiveWindow {
            id,
            program_process_name: program_process_name.clone(),
            program_name: title.clone(),
            title,
        })
    }

    /// Retrieves the ID of the currently active window.
    ///
    /// # Returns
    /// A `String` representing the window ID.
    pub fn get_window_id(&mut self) -> String {
        self.get_active_window().id
    }

    /// Retrieves the program process name associated with the given window ID.
    ///
    /// # Arguments
    /// * `current_window_id` - A `String` representing the current window ID.
    ///
    /// # Returns
    /// A `String` representing the program process name.
    pub fn get_program_process_name(&mut self, current_window_id: String) -> String {
        match self.backend {
            CaptureBackend::Hyprland => self.get_active_window().program_process_name,
            CaptureBackend::X11 => parse_wm_class(
                &run_cmd("xprop", &["-id", current_window_id.as_str(), "WM_CLASS"])
                    .unwrap_or_default(),
            )
            .unwrap_or_else(|| "unknown".to_string()),
        }
    }

    /// Retrieves the program name associated with the given window ID.
    ///
    /// # Arguments
    /// * `current_window_id` - A `String` representing the current window ID.
    ///
    /// # Returns
    /// A `String` representing the program name.
    pub fn get_program_name(&mut self, current_window_id: String) -> String {
        match self.backend {
            CaptureBackend::Hyprland => self.get_active_window().program_name,
            CaptureBackend::X11 => run_cmd("xdotool", &["getwindowname", current_window_id.as_str()])
                .unwrap_or_else(|| "unknown".to_string()),
        }
    }

    /// Checks if the given program name corresponds to a web browser.
    ///
    /// # Arguments
    /// * `current_program_name` - A `String` representing the current program name.
    ///
    /// # Returns
    /// A `bool` indicating whether the program is a web browser.
    pub fn is_current_program_browser(&self, current_program_process_name: String) -> bool {
        let program = current_program_process_name.to_lowercase();
        const FIREFOX: &str = "firefox";
        const CHROME: &str = "chrome";
        const BRAVE: &str = "brave-browser";
        const EDGE: &str = "edge";
        const SAFARI: &str = "safari";
        const ZEN: &str = "zen";

        program == FIREFOX
            || program == CHROME
            || program == BRAVE
            || program == EDGE
            || program == SAFARI
            || program == ZEN
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
        &mut self,
        current_program_process_name: String,
        current_window_id: String,
    ) -> Option<(Option<String>, Option<String>)> {
        if !self.is_current_program_browser(current_program_process_name) {
            return None;
        }

        let browser_title_str = match self.backend {
            CaptureBackend::Hyprland => self.get_active_window().title,
            CaptureBackend::X11 => run_cmd("xdotool", &["getwindowname", current_window_id.as_str()])
                .unwrap_or_else(|| "unknown".to_string()),
        };
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
    }

    /// Retrieves the current mouse position.
    ///
    /// # Returns
    /// A tuple `(i32, i32)` representing the mouse position coordinates (x, y).
    pub fn get_mouse_position(&self) -> (i32, i32) {
        match self.backend {
            CaptureBackend::Hyprland => parse_hypr_cursorpos()
                .or(self.last_mouse_position)
                .unwrap_or((0, 0)),
            CaptureBackend::X11 => parse_x11_mouse_position()
                .or(self.last_mouse_position)
                .unwrap_or((0, 0)),
        }
    }

    /// Retrieves the count of keys currently pressed using the `device_state` on X11.
    ///
    /// # Returns
    /// A `usize` representing the count of keys pressed, or `None` when unavailable on Wayland.
    pub fn get_keys_pressed_count(&mut self) -> Option<usize> {
        match self.backend {
            CaptureBackend::X11 => Some(self.device_state.get_keys().len()),
            CaptureBackend::Hyprland => None,
        }
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
        category::get_category(
            program_name,
            program_process_name,
            browser_title,
            browser_site_name,
        )
    }

    /// Retrieves the mouse movement in millimeters.
    ///
    /// # Returns
    /// A `usize` representing the mouse movement in millimeters.
    pub fn get_mouse_movement_mm(&mut self) -> f64 {
        let current_position = self.get_mouse_position();

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
        distance_px * px_to_mm
    }

    // === these check if button is pressed and if it wasn't pressed before ===
    pub fn accumulate_left_click_count(&mut self) -> Result<(), Box<dyn std::error::Error>> {
        if self.backend == CaptureBackend::Hyprland {
            return Ok(());
        }

        let current_mouse_state = self.device_state.get_mouse();
        if let Some(last_mouse_state) = &self.last_mouse_state {
            if current_mouse_state.button_pressed[1] && !last_mouse_state.button_pressed[1] {
                if let Some(log) = self.current_log.as_mut() {
                    log.left_click_count = Some(log.left_click_count.unwrap_or(0) + 1);
                }
            }
        }
        Ok(())
    }

    pub fn accumulate_right_click_count(&mut self) -> Result<(), Box<dyn std::error::Error>> {
        if self.backend == CaptureBackend::Hyprland {
            return Ok(());
        }

        let current_mouse_state = self.device_state.get_mouse();
        if let Some(last_mouse_state) = &self.last_mouse_state {
            if current_mouse_state.button_pressed[3] && !last_mouse_state.button_pressed[3] {
                if let Some(log) = self.current_log.as_mut() {
                    log.right_click_count = Some(log.right_click_count.unwrap_or(0) + 1);
                }
            }
        }
        Ok(())
    }

    pub fn accumulate_middle_click_count(&mut self) -> Result<(), Box<dyn std::error::Error>> {
        if self.backend == CaptureBackend::Hyprland {
            return Ok(());
        }

        let current_mouse_state = self.device_state.get_mouse();
        if let Some(last_mouse_state) = &self.last_mouse_state {
            if current_mouse_state.button_pressed[2] && !last_mouse_state.button_pressed[2] {
                if let Some(log) = self.current_log.as_mut() {
                    log.middle_click_count = Some(log.middle_click_count.unwrap_or(0) + 1);
                }
            }
        }
        Ok(())
    }
    // ========================================================================
}

fn unknown_window() -> ActiveWindow {
    ActiveWindow {
        id: "unknown".to_string(),
        program_process_name: "unknown".to_string(),
        program_name: "unknown".to_string(),
        title: "unknown".to_string(),
    }
}

fn parse_wm_class(output: &str) -> Option<String> {
    output.split('"').nth(1).map(|name| name.to_string())
}

fn parse_hypr_cursorpos() -> Option<(i32, i32)> {
    let output = run_cmd("hyprctl", &["cursorpos"])?;
    let (x, y) = output.split_once(',')?;
    Some((x.trim().parse().ok()?, y.trim().parse().ok()?))
}

fn parse_x11_mouse_position() -> Option<(i32, i32)> {
    let mouse_position = run_cmd("xdotool", &["getmouselocation"])?;
    let mouse_position = mouse_position
        .replace("x:", "")
        .replace("y:", "")
        .replace("screen:", "")
        .replace("window:", "")
        .replace("root:", "");

    let parts: Vec<&str> = mouse_position.split_whitespace().collect();
    if parts.len() < 2 {
        return None;
    }

    Some((parts[0].parse().ok()?, parts[1].parse().ok()?))
}
