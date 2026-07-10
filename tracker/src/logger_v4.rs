use chrono::{Duration, Utc};
#[cfg(target_os = "linux")]
use device_query::{DeviceQuery, MouseState};
#[cfg(target_os = "linux")]
use serde::Deserialize;
use std::env;
use std::sync::atomic::{AtomicBool, Ordering};
use tokio::time;

use crate::{
    actor,
    capture::{self, ActiveWindow},
    category::{self, Category},
    config::Configuration,
    idle_tracking::IdleTracker,
    log::Log,
    spool::Spool,
};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum CaptureBackend {
    #[cfg(target_os = "linux")]
    Hyprland,
    #[cfg(target_os = "linux")]
    X11,
    #[cfg(target_os = "macos")]
    MacOS,
}

#[cfg(target_os = "linux")]
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

#[cfg(target_os = "linux")]
fn run_cmd(cmd: &str, args: &[&str]) -> Option<String> {
    let output = std::process::Command::new(cmd).args(args).output().ok()?;
    if !output.status.success() {
        return None;
    }

    Some(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

#[cfg(target_os = "macos")]
fn select_backend() -> CaptureBackend {
    CaptureBackend::MacOS
}

#[cfg(target_os = "linux")]
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
/// Every completed span is written directly (local disk only) to the durable spool
/// (crate::spool); a decoupled background task (crate::ingest) flushes the spool to Convex.
pub struct LoggerV4 {
    pub idle_tracker: IdleTracker,
    pub config: Configuration,
    pub spool: Spool,
    #[cfg(target_os = "linux")]
    pub device_state: device_query::DeviceState,
    #[cfg(target_os = "macos")]
    pub macos_capture: capture::macos::MacosCapture,
    backend: CaptureBackend,
    pub last_mouse_position: Option<(i32, i32)>,
    #[cfg(target_os = "linux")]
    pub last_mouse_state: Option<MouseState>,
    #[cfg(target_os = "macos")]
    pending_click_counts: (usize, usize, usize),

    pub last_stats_time: chrono::DateTime<chrono::Utc>,

    pub current_log: Option<Log>,
    pub current_window_id: Option<String>,
    pub last_window_id: Option<String>,
    last_active_window: Option<ActiveWindow>,
}

impl LoggerV4 {
    /// Creates a new instance of LoggerV4.
    /// It initializes the configuration, local spool, and device state.
    ///
    /// # Returns
    /// A `Result` containing the new `LoggerV4` instance or an error if initialization fails.
    pub async fn new() -> Result<LoggerV4, Box<dyn std::error::Error>> {
        let backend = select_backend();
        let config = Configuration::from_env()?;
        let spool = Spool::open(&config.spool_path)?;

        #[cfg(target_os = "linux")]
        let device_state = device_query::DeviceState::new();
        #[cfg(target_os = "linux")]
        let initial_mouse_position = match backend {
            CaptureBackend::X11 => Some(device_state.get_mouse().coords),
            CaptureBackend::Hyprland => parse_hypr_cursorpos().or(Some((0, 0))),
        };
        #[cfg(target_os = "linux")]
        let initial_mouse_state = match backend {
            CaptureBackend::X11 => Some(device_state.get_mouse()),
            CaptureBackend::Hyprland => None,
        };

        #[cfg(target_os = "macos")]
        let macos_capture = capture::macos::MacosCapture::new();
        #[cfg(target_os = "macos")]
        let initial_mouse_position = Some(macos_capture.mouse_position());

        println!("Using {:?} capture backend", backend);

        Ok(LoggerV4 {
            idle_tracker: IdleTracker::new(),
            config,
            spool,
            #[cfg(target_os = "linux")]
            device_state,
            #[cfg(target_os = "macos")]
            macos_capture,
            backend,
            last_mouse_position: initial_mouse_position,
            #[cfg(target_os = "linux")]
            last_mouse_state: initial_mouse_state,
            #[cfg(target_os = "macos")]
            pending_click_counts: (0, 0, 0),

            last_stats_time: chrono::Utc::now(),

            current_log: None,
            current_window_id: None,
            last_window_id: None,
            last_active_window: None,
        })
    }

    /// Runs the logging process continuously.
    /// It captures user activity, logs window changes, accumulates key presses,
    /// and durably spools completed spans.
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
                if let Err(e) = self.end_current_log() {
                    println!("Error ending current log during shutdown: {:?}", e);
                }
                break;
            }

            if let Err(e) = self.tick().await {
                println!("Error during log tick: {:?}", e);
            }
        }

        Ok(())
    }

    async fn tick(&mut self) -> Result<(), Box<dyn std::error::Error>> {
        #[cfg(target_os = "macos")]
        if self.backend == CaptureBackend::MacOS {
            self.pending_click_counts = self.macos_capture.drain_clicks();
        }

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
        #[cfg(target_os = "linux")]
        if self.backend == CaptureBackend::X11 {
            self.last_mouse_state = Some(self.device_state.get_mouse());
        }

        self.log_on_window_change()?;

        let elapsed_since_stats = Utc::now() - self.last_stats_time;
        if elapsed_since_stats >= Duration::seconds(self.config.stats_every_n_seconds) {
            if let Some(log) = &self.current_log {
                let pending = self.spool.pending_count().unwrap_or(-1);
                println!("\nThere are currently {} pending spool rows", pending);
                println!("\nLog Snapshot: \n{}\n\n", log);
            }
            self.last_stats_time = Utc::now();
        }

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
        let is_idle = self.compute_is_idle(&idle_probe);

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

    /// Hyprland/X11 keep the existing mouse+keys+window-id heuristic
    /// (crate::idle_tracking). macOS uses the authoritative
    /// CGEventSourceSecondsSinceLastEventType signal instead, sharing only
    /// the configured threshold with the heuristic tracker.
    fn compute_is_idle(&mut self, idle_probe: &Log) -> bool {
        match self.backend {
            #[cfg(target_os = "linux")]
            CaptureBackend::Hyprland | CaptureBackend::X11 => self.idle_tracker.is_idle(idle_probe),
            #[cfg(target_os = "macos")]
            CaptureBackend::MacOS => {
                let idle_ms = (self.macos_capture.idle_seconds() * 1000.0) as i64;
                idle_ms >= self.idle_tracker.idle_threshold_ms
            }
        }
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

    /// Ends the current log by calculating the duration and durably spooling it,
    /// then starts a new log for the current activity.
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

            // Local disk write only -- never blocks on network. The
            // decoupled ingest flusher (crate::ingest) owns delivery.
            if let Err(e) = self.spool.enqueue(log, &self.config.device_name) {
                println!("Error spooling completed span: {:?}", e);
            }
        }

        self.current_log = Some(self.capture()?);
        self.last_window_id = self.current_window_id.clone();

        Ok(())
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
        let actor = actor::resolve_actor(&active_window.title, &self.config.actor);

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
            actor,
        };
        log.is_idle = self.compute_is_idle(&log);

        Ok(log)
    }

    fn get_active_window(&mut self) -> ActiveWindow {
        let next_window = match self.backend {
            #[cfg(target_os = "linux")]
            CaptureBackend::Hyprland => self.get_hyprland_active_window(),
            #[cfg(target_os = "linux")]
            CaptureBackend::X11 => self.get_x11_active_window(),
            #[cfg(target_os = "macos")]
            CaptureBackend::MacOS => self.macos_capture.active_window(),
        };

        match next_window {
            Some(window) => {
                self.last_active_window = Some(window.clone());
                window
            }
            None => self.last_active_window.clone().unwrap_or_else(capture::unknown_window),
        }
    }

    #[cfg(target_os = "linux")]
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

    #[cfg(target_os = "linux")]
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
    #[cfg(target_os = "linux")]
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

    #[cfg(target_os = "macos")]
    pub fn get_program_process_name(&mut self, _current_window_id: String) -> String {
        self.get_active_window().program_process_name
    }

    /// Retrieves the program name associated with the given window ID.
    #[cfg(target_os = "linux")]
    pub fn get_program_name(&mut self, current_window_id: String) -> String {
        match self.backend {
            CaptureBackend::Hyprland => self.get_active_window().program_name,
            CaptureBackend::X11 => run_cmd("xdotool", &["getwindowname", current_window_id.as_str()])
                .unwrap_or_else(|| "unknown".to_string()),
        }
    }

    #[cfg(target_os = "macos")]
    pub fn get_program_name(&mut self, _current_window_id: String) -> String {
        self.get_active_window().program_name
    }

    /// Checks if the given program name corresponds to a web browser. Substring
    /// match (not exact equality) so macOS's natural identity strings
    /// (localizedName, e.g. "Google Chrome", "Brave Browser", "Zen Browser")
    /// match the same constants Hyprland/X11's lowercase WM_CLASS values do.
    ///
    /// # Arguments
    /// * `current_program_process_name` - A `String` representing the current program name.
    ///
    /// # Returns
    /// A `bool` indicating whether the program is a web browser.
    pub fn is_current_program_browser(&self, current_program_process_name: String) -> bool {
        let program = current_program_process_name.to_lowercase();
        const FIREFOX: &str = "firefox";
        const CHROME: &str = "chrome";
        const BRAVE: &str = "brave";
        const EDGE: &str = "edge";
        const SAFARI: &str = "safari";
        const ZEN: &str = "zen";

        program.contains(FIREFOX)
            || program.contains(CHROME)
            || program.contains(BRAVE)
            || program.contains(EDGE)
            || program.contains(SAFARI)
            || program.contains(ZEN)
    }

    /// Retrieves the title of the web browser window associated with the given window ID.
    ///
    /// # Arguments
    /// * `current_program_process_name` - A `String` representing the current program name.
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

        let browser_title_str = self.get_active_window_title(current_window_id);
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

    fn get_active_window_title(&mut self, current_window_id: String) -> String {
        match self.backend {
            #[cfg(target_os = "linux")]
            CaptureBackend::Hyprland => self.get_active_window().title,
            #[cfg(target_os = "linux")]
            CaptureBackend::X11 => run_cmd("xdotool", &["getwindowname", current_window_id.as_str()])
                .unwrap_or_else(|| "unknown".to_string()),
            #[cfg(target_os = "macos")]
            CaptureBackend::MacOS => {
                let _ = current_window_id;
                self.get_active_window().title
            }
        }
    }

    /// Retrieves the current mouse position.
    ///
    /// # Returns
    /// A tuple `(i32, i32)` representing the mouse position coordinates (x, y).
    pub fn get_mouse_position(&self) -> (i32, i32) {
        match self.backend {
            #[cfg(target_os = "linux")]
            CaptureBackend::Hyprland => parse_hypr_cursorpos()
                .or(self.last_mouse_position)
                .unwrap_or((0, 0)),
            #[cfg(target_os = "linux")]
            CaptureBackend::X11 => parse_x11_mouse_position()
                .or(self.last_mouse_position)
                .unwrap_or((0, 0)),
            #[cfg(target_os = "macos")]
            CaptureBackend::MacOS => self.macos_capture.mouse_position(),
        }
    }

    /// Retrieves the count of keys currently pressed. `device_state` polling on X11,
    /// a drained CGEventTap counter on macOS (when Input Monitoring is granted),
    /// or `None` when unavailable (Wayland/Hyprland, or ungranted on macOS).
    ///
    /// # Returns
    /// A `usize` representing the count of keys pressed, or `None` when unavailable.
    pub fn get_keys_pressed_count(&mut self) -> Option<usize> {
        match self.backend {
            #[cfg(target_os = "linux")]
            CaptureBackend::X11 => Some(self.device_state.get_keys().len()),
            #[cfg(target_os = "linux")]
            CaptureBackend::Hyprland => None,
            #[cfg(target_os = "macos")]
            CaptureBackend::MacOS => self.macos_capture.drain_keys_pressed(),
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
        match self.backend {
            #[cfg(target_os = "linux")]
            CaptureBackend::Hyprland => {}
            #[cfg(target_os = "linux")]
            CaptureBackend::X11 => {
                let current_mouse_state = self.device_state.get_mouse();
                if let Some(last_mouse_state) = &self.last_mouse_state {
                    if current_mouse_state.button_pressed[1] && !last_mouse_state.button_pressed[1] {
                        if let Some(log) = self.current_log.as_mut() {
                            log.left_click_count = Some(log.left_click_count.unwrap_or(0) + 1);
                        }
                    }
                }
            }
            #[cfg(target_os = "macos")]
            CaptureBackend::MacOS => {
                let left = self.pending_click_counts.0;
                if left > 0 {
                    if let Some(log) = self.current_log.as_mut() {
                        log.left_click_count = Some(log.left_click_count.unwrap_or(0) + left);
                    }
                }
            }
        }
        Ok(())
    }

    pub fn accumulate_right_click_count(&mut self) -> Result<(), Box<dyn std::error::Error>> {
        match self.backend {
            #[cfg(target_os = "linux")]
            CaptureBackend::Hyprland => {}
            #[cfg(target_os = "linux")]
            CaptureBackend::X11 => {
                let current_mouse_state = self.device_state.get_mouse();
                if let Some(last_mouse_state) = &self.last_mouse_state {
                    if current_mouse_state.button_pressed[3] && !last_mouse_state.button_pressed[3] {
                        if let Some(log) = self.current_log.as_mut() {
                            log.right_click_count = Some(log.right_click_count.unwrap_or(0) + 1);
                        }
                    }
                }
            }
            #[cfg(target_os = "macos")]
            CaptureBackend::MacOS => {
                let right = self.pending_click_counts.1;
                if right > 0 {
                    if let Some(log) = self.current_log.as_mut() {
                        log.right_click_count = Some(log.right_click_count.unwrap_or(0) + right);
                    }
                }
            }
        }
        Ok(())
    }

    pub fn accumulate_middle_click_count(&mut self) -> Result<(), Box<dyn std::error::Error>> {
        match self.backend {
            #[cfg(target_os = "linux")]
            CaptureBackend::Hyprland => {}
            #[cfg(target_os = "linux")]
            CaptureBackend::X11 => {
                let current_mouse_state = self.device_state.get_mouse();
                if let Some(last_mouse_state) = &self.last_mouse_state {
                    if current_mouse_state.button_pressed[2] && !last_mouse_state.button_pressed[2] {
                        if let Some(log) = self.current_log.as_mut() {
                            log.middle_click_count = Some(log.middle_click_count.unwrap_or(0) + 1);
                        }
                    }
                }
            }
            #[cfg(target_os = "macos")]
            CaptureBackend::MacOS => {
                let middle = self.pending_click_counts.2;
                if middle > 0 {
                    if let Some(log) = self.current_log.as_mut() {
                        log.middle_click_count = Some(log.middle_click_count.unwrap_or(0) + middle);
                    }
                }
            }
        }
        Ok(())
    }
    // ========================================================================
}

#[cfg(target_os = "linux")]
fn parse_wm_class(output: &str) -> Option<String> {
    output.split('"').nth(1).map(|name| name.to_string())
}

#[cfg(target_os = "linux")]
fn parse_hypr_cursorpos() -> Option<(i32, i32)> {
    let output = run_cmd("hyprctl", &["cursorpos"])?;
    let (x, y) = output.split_once(',')?;
    Some((x.trim().parse().ok()?, y.trim().parse().ok()?))
}

#[cfg(target_os = "linux")]
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
