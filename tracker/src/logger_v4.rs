use chrono::{Duration, Utc};
#[cfg(target_os = "linux")]
use device_query::{DeviceQuery, MouseState};
#[cfg(target_os = "linux")]
use serde::Deserialize;
use std::env;
#[cfg(target_os = "linux")]
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use tokio::time;

use crate::{
    actor,
    capture::{self, ActiveWindow},
    buckets::BucketClassifier,
    category::{self, Category},
    config::Configuration,
    idle_tracking::IdleTracker,
    log::Log,
    privacy::PrivacyScrubber,
    spool::Spool,
};
#[cfg(target_os = "linux")]
use crate::{hypr_events, input_evdev, tmux};

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
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum EvdevClickButton {
    Left,
    Right,
    Middle,
}

#[cfg(target_os = "linux")]
#[derive(Deserialize)]
struct HyprActiveWindow {
    address: Option<String>,
    class: Option<String>,
    title: Option<String>,
    pid: Option<i64>,
}

/// One entry of `hyprctl clients -j`, used only to resolve a focused
/// window's pid by address on focus change -- see
/// `LoggerV4::resolve_focus_pid`.
#[cfg(target_os = "linux")]
#[derive(Deserialize)]
struct HyprClient {
    address: Option<String>,
    pid: Option<i64>,
}

const MAX_SPAN_SECONDS: i64 = 60;
const CHECKPOINT_SPAN_SECONDS: i64 = 40;
/// How often logger_v4 reconciles the Hyprland event-socket pushed state
/// against `hyprctl activewindow -j` ground truth.
#[cfg(target_os = "linux")]
const HYPR_RECONCILE_SECONDS: i64 = 5;
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
    bucket_classifier: BucketClassifier,
    privacy_scrubber: PrivacyScrubber,
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

    // --- Linux capture extensions: evdev key/click counters, Hyprland
    // event-socket push state, and tmux sub-program drill-down. ---
    #[cfg(target_os = "linux")]
    evdev_counters: Arc<input_evdev::InputCounters>,
    #[cfg(target_os = "linux")]
    evdev_keys_baseline: u64,
    #[cfg(target_os = "linux")]
    evdev_left_baseline: u64,
    #[cfg(target_os = "linux")]
    evdev_right_baseline: u64,
    #[cfg(target_os = "linux")]
    evdev_middle_baseline: u64,
    #[cfg(target_os = "linux")]
    hypr_watcher: Option<hypr_events::HyprEventWatcher>,
    #[cfg(target_os = "linux")]
    hypr_last_reconcile: chrono::DateTime<chrono::Utc>,
    /// Address of the window `focused_window_pid` was last resolved for --
    /// pid is only re-resolved (via `hyprctl clients -j`) when this
    /// changes, never on every tick.
    #[cfg(target_os = "linux")]
    hypr_focus_address: Option<String>,
    #[cfg(target_os = "linux")]
    focused_window_pid: Option<i64>,
    /// X11 mirror of the pair above, keyed by xdotool window id instead
    /// of a Hyprland address.
    #[cfg(target_os = "linux")]
    x11_focus_window_id: Option<String>,
    #[cfg(target_os = "linux")]
    x11_focus_pid: Option<i64>,
    #[cfg(target_os = "linux")]
    tmux_resolver: tmux::TmuxResolver,
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
        let bucket_classifier = BucketClassifier::load(&config.bucket_config_path);
        let privacy_scrubber = PrivacyScrubber::load(&config.privacy_config_path, &config.scrub_audit_path);

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

        // Only the Hyprland backend consults these -- X11 keeps its
        // proven device_query path, so there's no reason to spin up
        // evdev reader threads or an event-socket subscriber on bertha.
        #[cfg(target_os = "linux")]
        let evdev_counters = if backend == CaptureBackend::Hyprland {
            input_evdev::spawn()
        } else {
            Arc::new(input_evdev::InputCounters::default())
        };
        #[cfg(target_os = "linux")]
        let hypr_watcher = if backend == CaptureBackend::Hyprland {
            hypr_events::HyprEventWatcher::spawn()
        } else {
            None
        };

        println!("Using {:?} capture backend", backend);
        #[cfg(target_os = "linux")]
        if backend == CaptureBackend::X11 && env::var("DISPLAY").unwrap_or_default().trim().is_empty() {
            println!(
                "CHRONOMAXI INPUT COUNTS MAY BE UNAVAILABLE: X11 backend has no DISPLAY. Fix user service environment with: systemctl --user import-environment DISPLAY XAUTHORITY DBUS_SESSION_BUS_ADDRESS"
            );
        }

        Ok(LoggerV4 {
            idle_tracker: IdleTracker::new(),
            config,
            spool,
            bucket_classifier,
            privacy_scrubber,
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

            #[cfg(target_os = "linux")]
            evdev_counters,
            #[cfg(target_os = "linux")]
            evdev_keys_baseline: 0,
            #[cfg(target_os = "linux")]
            evdev_left_baseline: 0,
            #[cfg(target_os = "linux")]
            evdev_right_baseline: 0,
            #[cfg(target_os = "linux")]
            evdev_middle_baseline: 0,
            #[cfg(target_os = "linux")]
            hypr_watcher,
            #[cfg(target_os = "linux")]
            hypr_last_reconcile: chrono::Utc::now(),
            #[cfg(target_os = "linux")]
            hypr_focus_address: None,
            #[cfg(target_os = "linux")]
            focused_window_pid: None,
            #[cfg(target_os = "linux")]
            x11_focus_window_id: None,
            #[cfg(target_os = "linux")]
            x11_focus_pid: None,
            #[cfg(target_os = "linux")]
            tmux_resolver: tmux::TmuxResolver::new(),
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

        #[cfg(target_os = "linux")]
        let tmux_context = self.resolve_tmux_context(&active_window);
        #[cfg(target_os = "linux")]
        let current_sub_program = tmux_context.sub_program.clone();
        #[cfg(target_os = "linux")]
        let current_tmux_session = tmux_context.session.clone();
        #[cfg(target_os = "macos")]
        let current_sub_program: Option<String> = None;
        #[cfg(target_os = "macos")]
        let current_tmux_session: Option<String> = None;
        let initial_bucket = self.classify_bucket(
            &active_window.program_process_name,
            Some(active_window.title.as_str()),
            current_sub_program.as_deref(),
            current_tmux_session.as_deref(),
        );
        let scrubbed_probe = self.privacy_scrubber.scrub_fields(
            &active_window.program_process_name,
            &active_window.program_name,
            &active_window.title,
            None,
            current_sub_program.as_deref(),
            &initial_bucket,
        );
        let current_sub_program = scrubbed_probe.sub_program;
        let current_bucket = scrubbed_probe.bucket;

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
        let is_idle = self.compute_is_idle(&idle_probe, Some(active_window.title.as_str()));

        let should_end_current_log = self.current_log.as_ref().is_some_and(|log| {
            // Effective window identity for change detection is
            // `window_id + ':' + sub_program` when the focused window is a
            // terminal, so e.g. alacritty:nvim and alacritty:zsh split into
            // separate spans even though the compositor window id and
            // program-process-name never change. `current_sub_program`
            // (and therefore `log.sub_program`) is already `None` for
            // non-terminal windows, so this comparison is a no-op there.
            let window_changed =
                log.current_window_id.as_deref() != Some(active_window.id.as_str())
                    || log.current_program_process_name.as_deref()
                        != Some(active_window.program_process_name.as_str())
                    || log.sub_program != current_sub_program
                    || log.tmux_session != current_tmux_session;
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
            log.is_idle = is_idle;
            log.sub_program = current_sub_program;
            log.tmux_session = current_tmux_session;
            log.bucket = Some(current_bucket);
            self.last_window_id = self.current_window_id.clone();
        }

        Ok(should_end_current_log)
    }

    /// Hyprland/X11 keep the existing mouse+keys+window-id heuristic
    /// (crate::idle_tracking). macOS uses the authoritative
    /// CGEventSourceSecondsSinceLastEventType signal instead, sharing only
    /// the configured threshold with the heuristic tracker.
    fn compute_is_idle(&mut self, idle_probe: &Log, window_title: Option<&str>) -> bool {
        match self.backend {
            #[cfg(target_os = "linux")]
            CaptureBackend::Hyprland | CaptureBackend::X11 => self.idle_tracker.is_idle(idle_probe, window_title),
            #[cfg(target_os = "macos")]
            CaptureBackend::MacOS => {
                let _ = window_title;
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
        let mut current_program_process_name = active_window.program_process_name.clone();
        let mut current_program_name = active_window.program_name.clone();
        let raw_title = active_window.title.clone();

        let (mut current_browser_title, mut current_browser_site_name) = self
            .get_browser_title_and_site_name_from_title(&current_program_process_name, &raw_title)
            .unwrap_or((None, None));

        let (mouse_x, mouse_y) = self.get_mouse_position();
        let keys_pressed_count = self.get_keys_pressed_count();

        #[cfg(target_os = "linux")]
        let tmux_context = self.resolve_tmux_context(&active_window);
        #[cfg(target_os = "linux")]
        let mut sub_program = tmux_context.sub_program;
        #[cfg(target_os = "linux")]
        let tmux_session = tmux_context.session;
        #[cfg(target_os = "macos")]
        let mut sub_program: Option<String> = None;
        #[cfg(target_os = "macos")]
        let tmux_session: Option<String> = None;

        let initial_bucket = self.classify_bucket(
            &current_program_process_name,
            Some(raw_title.as_str()),
            sub_program.as_deref(),
            tmux_session.as_deref(),
        );
        let scrubbed = self.privacy_scrubber.scrub_fields(
            &current_program_process_name,
            &current_program_name,
            &raw_title,
            current_browser_title.as_deref(),
            sub_program.as_deref(),
            &initial_bucket,
        );
        current_program_process_name = scrubbed.program_process_name;
        current_program_name = scrubbed.program_name;
        let was_scrubbed = scrubbed.scrubbed;
        current_browser_title = scrubbed.browser_title;
        if was_scrubbed {
            current_browser_site_name = None;
        }
        sub_program = scrubbed.sub_program;
        let bucket = scrubbed.bucket;
        let safe_title = scrubbed.title;

        let category = self.get_category(
            &current_program_name,
            &current_program_process_name,
            current_browser_title.as_deref(),
            current_browser_site_name.as_deref(),
            sub_program.as_deref(),
        );
        let mouse_movement_mm = self.get_mouse_movement_mm();
        let actor = actor::resolve_actor(&safe_title, &self.config.actor);

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
            sub_program,
            tmux_session,
            bucket: Some(bucket),
            actor,
        };
        log.is_idle = self.compute_is_idle(&log, Some(safe_title.as_str()));

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

    /// Hyprland active-window resolution: prefers the live event-socket
    /// push state (hypr_events.rs) over spawning `hyprctl activewindow -j`
    /// every tick. Falls back to direct hyprctl polling when the socket
    /// isn't connected yet or has no data (e.g. this process started
    /// before the compositor emitted a first event).
    #[cfg(target_os = "linux")]
    fn get_hyprland_active_window(&mut self) -> Option<ActiveWindow> {
        self.reconcile_hypr_state();

        let pushed = self.hypr_watcher.as_ref().map(|watcher| watcher.state());
        let Some(state) = pushed.filter(hypr_events::ActiveWindowState::has_data) else {
            return self.get_hyprland_active_window_via_hyprctl();
        };

        self.update_focus_pid_if_changed(state.address.as_deref(), None);

        let class = state.class.unwrap_or_else(|| "unknown".to_string());
        Some(ActiveWindow {
            id: state.address.unwrap_or_else(|| "unknown".to_string()),
            program_process_name: class.to_lowercase(),
            program_name: class,
            title: state.title.unwrap_or_else(|| "unknown".to_string()),
        })
    }

    /// Direct `hyprctl activewindow -j` poll -- the pre-event-socket
    /// behavior, kept as the fallback path. Also opportunistically caches
    /// the pid it gets for free from this response (no extra `hyprctl
    /// clients -j` call needed in this path).
    #[cfg(target_os = "linux")]
    fn get_hyprland_active_window_via_hyprctl(&mut self) -> Option<ActiveWindow> {
        let json = run_cmd("hyprctl", &["activewindow", "-j"])?;
        let window: HyprActiveWindow = serde_json::from_str(&json).ok()?;
        let class = window.class.clone().unwrap_or_else(|| "unknown".to_string());
        let address = window.address.as_deref().map(hypr_events::normalize_address);

        self.update_focus_pid_if_changed(address.as_deref(), window.pid);

        Some(ActiveWindow {
            id: address.unwrap_or_else(|| "unknown".to_string()),
            program_process_name: class.to_lowercase(),
            program_name: class,
            title: window.title.unwrap_or_else(|| "unknown".to_string()),
        })
    }

    /// Periodic ground-truth check: compares the event-socket pushed state
    /// against a fresh `hyprctl activewindow -j`, correcting (and logging)
    /// any divergence. Runs at most once every `HYPR_RECONCILE_SECONDS`.
    #[cfg(target_os = "linux")]
    fn reconcile_hypr_state(&mut self) {
        let Some(watcher) = self.hypr_watcher.as_ref() else { return };
        let now = Utc::now();
        if now - self.hypr_last_reconcile < Duration::seconds(HYPR_RECONCILE_SECONDS) {
            return;
        }
        self.hypr_last_reconcile = now;

        let Some(json) = run_cmd("hyprctl", &["activewindow", "-j"]) else { return };
        let Ok(ground_truth) = serde_json::from_str::<HyprActiveWindow>(&json) else { return };

        let address = ground_truth.address.as_deref().map(hypr_events::normalize_address);
        let truth_state = hypr_events::ActiveWindowState {
            class: ground_truth.class.clone(),
            title: ground_truth.title.clone(),
            address: address.clone(),
        };
        let pushed_state = watcher.state();

        if pushed_state != truth_state {
            println!(
                "chronomaxi hypr reconcile: pushed state diverged from hyprctl ground truth, correcting without logging titles"
            );
            watcher.reconcile(truth_state);
        }

        self.update_focus_pid_if_changed(address.as_deref(), ground_truth.pid);
    }

    /// Resolves and caches the focused window's pid, but only when
    /// `address` differs from the last-resolved one -- never on every
    /// tick. `known_pid` lets callers that already have the pid (from
    /// `hyprctl activewindow -j`'s own response) skip the extra `hyprctl
    /// clients -j` lookup below.
    #[cfg(target_os = "linux")]
    fn update_focus_pid_if_changed(&mut self, address: Option<&str>, known_pid: Option<i64>) {
        if self.hypr_focus_address.as_deref() == address {
            return;
        }
        self.hypr_focus_address = address.map(|s| s.to_string());
        self.focused_window_pid = known_pid.or_else(|| address.and_then(resolve_pid_via_hypr_clients));
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
        if !self.is_current_program_browser(current_program_process_name.clone()) {
            return None;
        }
        let title = self.get_active_window_title(current_window_id);
        self.get_browser_title_and_site_name_from_title(&current_program_process_name, &title)
    }

    fn get_browser_title_and_site_name_from_title(
        &self,
        current_program_process_name: &str,
        browser_title_str: &str,
    ) -> Option<(Option<String>, Option<String>)> {
        if !self.is_current_program_browser(current_program_process_name.to_string()) {
            return None;
        }

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
            CaptureBackend::Hyprland => {
                if !self.evdev_counters.has_ever_advanced() {
                    return None;
                }
                let current = self.evdev_counters.keys_pressed.load(Ordering::Relaxed);
                let delta = current.saturating_sub(self.evdev_keys_baseline);
                self.evdev_keys_baseline = current;
                Some(delta as usize)
            }
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
        sub_program: Option<&str>,
    ) -> Category {
        category::get_category(
            program_name,
            program_process_name,
            browser_title,
            browser_site_name,
            sub_program,
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
            CaptureBackend::Hyprland => self.accumulate_evdev_click_delta(EvdevClickButton::Left),
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
            CaptureBackend::Hyprland => self.accumulate_evdev_click_delta(EvdevClickButton::Right),
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
            CaptureBackend::Hyprland => self.accumulate_evdev_click_delta(EvdevClickButton::Middle),
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

    /// Drains one evdev click counter's delta into the current log, gated
    /// on the same "has evdev ever advanced" permission signal as
    /// `get_keys_pressed_count`'s Hyprland arm.
    #[cfg(target_os = "linux")]
    fn accumulate_evdev_click_delta(&mut self, button: EvdevClickButton) {
        if !self.evdev_counters.has_ever_advanced() {
            return;
        }

        let (current, baseline) = match button {
            EvdevClickButton::Left => (
                self.evdev_counters.left_clicks.load(Ordering::Relaxed),
                &mut self.evdev_left_baseline,
            ),
            EvdevClickButton::Right => (
                self.evdev_counters.right_clicks.load(Ordering::Relaxed),
                &mut self.evdev_right_baseline,
            ),
            EvdevClickButton::Middle => (
                self.evdev_counters.middle_clicks.load(Ordering::Relaxed),
                &mut self.evdev_middle_baseline,
            ),
        };
        let delta = current.saturating_sub(*baseline);
        *baseline = current;

        if delta > 0 {
            if let Some(log) = self.current_log.as_mut() {
                let field = match button {
                    EvdevClickButton::Left => &mut log.left_click_count,
                    EvdevClickButton::Right => &mut log.right_click_count,
                    EvdevClickButton::Middle => &mut log.middle_click_count,
                };
                *field = Some(field.unwrap_or(0) + delta as usize);
            }
        }

    }

    /// Terminal (alacritty/kitty) sub-program drill-down (tmux). `None`
    /// for non-terminal windows or when nothing resolvable (bare shell,
    /// no tmux, etc). See tmux.rs for the full resolution strategy.
    #[cfg(target_os = "linux")]
    fn resolve_tmux_context(&mut self, active_window: &ActiveWindow) -> tmux::TmuxContext {
        if !tmux::is_terminal_class(&active_window.program_process_name) {
            return tmux::TmuxContext { sub_program: None, session: None };
        }
        let pid = self.focused_pid_for_terminal();
        self.tmux_resolver.resolve(pid)
    }

    fn classify_bucket(
        &self,
        program_process_name: &str,
        title: Option<&str>,
        sub_program: Option<&str>,
        tmux_session: Option<&str>,
    ) -> String {
        self.bucket_classifier
            .classify(program_process_name, title, sub_program, tmux_session)
    }

    #[cfg(target_os = "linux")]
    fn focused_pid_for_terminal(&mut self) -> Option<i64> {
        match self.backend {
            CaptureBackend::Hyprland => self.focused_window_pid,
            CaptureBackend::X11 => self.resolve_x11_focused_pid(),
        }
    }

    /// X11 mirror of the Hyprland focus-pid cache: `xdotool getwindowpid`
    /// only fires when the window id actually changed, never per tick.
    #[cfg(target_os = "linux")]
    fn resolve_x11_focused_pid(&mut self) -> Option<i64> {
        let window_id = self.current_window_id.clone()?;
        if self.x11_focus_window_id.as_deref() != Some(window_id.as_str()) {
            self.x11_focus_window_id = Some(window_id.clone());
            self.x11_focus_pid =
                run_cmd("xdotool", &["getwindowpid", window_id.as_str()]).and_then(|s| s.trim().parse::<i64>().ok());
        }
        self.x11_focus_pid
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

#[cfg(target_os = "linux")]
fn resolve_pid_via_hypr_clients(address: &str) -> Option<i64> {
    let json = run_cmd("hyprctl", &["clients", "-j"])?;
    let clients: Vec<HyprClient> = serde_json::from_str(&json).ok()?;
    clients
        .into_iter()
        .find(|client| client.address.as_deref().map(hypr_events::normalize_address).as_deref() == Some(address))
        .and_then(|client| client.pid)
}
