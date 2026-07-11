//! Hyprland IPC event-socket subscriber.
//!
//! Hyprland exposes a streaming event socket at
//! `$XDG_RUNTIME_DIR/hypr/$HYPRLAND_INSTANCE_SIGNATURE/.socket2.sock` that
//! emits one `event>>data\n` line per compositor event. Subscribing to it
//! replaces the previous per-tick `hyprctl activewindow -j` subprocess
//! spawn (a fork+exec+JSON-parse on every ~100ms capture tick) with a live
//! push feed that only costs anything when focus actually changes.
//!
//! Falls back to hyprctl polling (see logger_v4.rs) whenever the socket is
//! unreachable, not yet connected, or the connection drops; a periodic
//! reconciliation pass in logger_v4.rs additionally corrects any drift
//! between the pushed state and `hyprctl activewindow -j` ground truth.

use std::env;
use std::io::BufRead;
use std::io::BufReader;
use std::os::unix::net::UnixStream;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

const INITIAL_BACKOFF: Duration = Duration::from_millis(500);
const MAX_BACKOFF: Duration = Duration::from_secs(30);
/// How long to wait before re-checking `socket_path()` when the Hyprland
/// env vars needed to locate it are absent (e.g. this session never had
/// Hyprland, or hasn't started it yet).
const NO_SOCKET_RETRY: Duration = Duration::from_secs(30);

/// Live active-window identity as pushed by the Hyprland event socket.
/// `class`/`title` arrive via the `activewindow>>` event, `address` via
/// the separate `activewindowv2>>` event -- Hyprland does not guarantee
/// they land in the same line, so they're tracked independently and read
/// together as of the latest state snapshot.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ActiveWindowState {
    pub class: Option<String>,
    pub title: Option<String>,
    pub address: Option<String>,
}

impl ActiveWindowState {
    /// True once at least one field has ever been populated -- used to
    /// distinguish "socket connected but genuinely no window focused" from
    /// "no data yet, caller should fall back to direct hyprctl polling".
    pub fn has_data(&self) -> bool {
        self.class.is_some() || self.title.is_some() || self.address.is_some()
    }
}

pub struct HyprEventWatcher {
    state: Arc<Mutex<ActiveWindowState>>,
    connected: Arc<AtomicBool>,
}

impl HyprEventWatcher {
    /// Spawns the background subscriber thread. Returns `None` immediately
    /// (no thread spawned) when the env vars needed to locate the socket
    /// are absent right now, so callers fall back to hyprctl polling
    /// outright instead of spinning a thread that can never connect. The
    /// background thread itself keeps retrying independently once spawned,
    /// so a session started before Hyprland finished coming up should call
    /// this again later if `spawn()` returned `None`.
    pub fn spawn() -> Option<Self> {
        socket_path()?;

        let state = Arc::new(Mutex::new(ActiveWindowState::default()));
        let connected = Arc::new(AtomicBool::new(false));
        let thread_state = Arc::clone(&state);
        let thread_connected = Arc::clone(&connected);

        thread::Builder::new()
            .name("cmx-hypr-events".to_string())
            .spawn(move || watch_loop(thread_state, thread_connected))
            .ok()?;

        Some(Self { state, connected })
    }

    pub fn state(&self) -> ActiveWindowState {
        self.state.lock().map(|guard| guard.clone()).unwrap_or_default()
    }

    /// Overwrites the pushed state -- used by logger_v4.rs's periodic
    /// reconciliation pass to correct drift against `hyprctl activewindow
    /// -j` ground truth.
    pub fn reconcile(&self, corrected: ActiveWindowState) {
        if let Ok(mut guard) = self.state.lock() {
            *guard = corrected;
        }
    }

    pub fn is_connected(&self) -> bool {
        self.connected.load(Ordering::Relaxed)
    }
}

fn socket_path() -> Option<PathBuf> {
    let runtime_dir = env::var("XDG_RUNTIME_DIR").ok()?;
    let signature = env::var("HYPRLAND_INSTANCE_SIGNATURE").ok()?;
    if signature.trim().is_empty() {
        return None;
    }
    Some(PathBuf::from(runtime_dir).join("hypr").join(signature).join(".socket2.sock"))
}

fn watch_loop(state: Arc<Mutex<ActiveWindowState>>, connected: Arc<AtomicBool>) {
    let mut backoff = INITIAL_BACKOFF;

    loop {
        let Some(path) = socket_path() else {
            thread::sleep(NO_SOCKET_RETRY);
            continue;
        };

        if let Ok(stream) = UnixStream::connect(&path) {
            connected.store(true, Ordering::Relaxed);
            backoff = INITIAL_BACKOFF;

            let reader = BufReader::new(stream);
            for line in reader.lines() {
                match line {
                    Ok(line) => {
                        if let Ok(mut guard) = state.lock() {
                            apply_event_line(&mut guard, &line);
                        }
                    }
                    Err(_) => break,
                }
            }
            connected.store(false, Ordering::Relaxed);
        }

        thread::sleep(backoff);
        backoff = (backoff * 2).min(MAX_BACKOFF);
    }
}

/// Hyprland reports window addresses in two different textual forms
/// depending on source: the event-socket's `activewindowv2>>` payload has
/// no `0x` prefix, while `hyprctl activewindow -j` / `clients -j` JSON
/// always prefixes with `0x` -- both denote the exact same window.
/// Normalizing to the unprefixed form at every entry point (here, and
/// wherever logger_v4.rs reads an address out of hyprctl JSON) means no
/// comparison downstream (window-change detection, focus-pid caching,
/// the periodic reconcile-vs-ground-truth check below) ever treats one
/// window as two just because of which source last supplied its address.
pub fn normalize_address(raw: &str) -> String {
    raw.strip_prefix("0x").or_else(|| raw.strip_prefix("0X")).unwrap_or(raw).to_string()
}

/// Parses one `event>>data` line, mutating `target` in place when it's one
/// of the two window-focus events tracked here. Any other event line
/// (workspace switches, monitor events, ...) is ignored. Returns whether
/// the line changed anything, mainly for unit testing.
fn apply_event_line(target: &mut ActiveWindowState, line: &str) -> bool {
    if let Some(rest) = line.strip_prefix("activewindow>>") {
        let mut parts = rest.splitn(2, ',');
        let class = parts.next().unwrap_or("").trim();
        let title = parts.next().unwrap_or("").trim();
        let class = if class.is_empty() { None } else { Some(class.to_string()) };
        let title = if title.is_empty() { None } else { Some(title.to_string()) };
        let changed = target.class != class || target.title != title;
        target.class = class;
        target.title = title;
        changed
    } else if let Some(rest) = line.strip_prefix("activewindowv2>>") {
        let address = rest.trim();
        let address = if address.is_empty() { None } else { Some(normalize_address(address)) };
        let changed = target.address != address;
        target.address = address;
        changed
    } else {
        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_activewindow_class_and_title() {
        let mut state = ActiveWindowState::default();
        assert!(apply_event_line(&mut state, "activewindow>>kitty,~/personal/chronomaxi"));
        assert_eq!(state.class.as_deref(), Some("kitty"));
        assert_eq!(state.title.as_deref(), Some("~/personal/chronomaxi"));
    }

    #[test]
    fn normalize_address_strips_0x_prefix() {
        assert_eq!(normalize_address("0x559f6c8370b0"), "559f6c8370b0");
        assert_eq!(normalize_address("0X559F6C8370B0"), "559F6C8370B0");
    }

    #[test]
    fn normalize_address_is_noop_without_prefix() {
        assert_eq!(normalize_address("559f6c8370b0"), "559f6c8370b0");
    }

    #[test]
    fn activewindowv2_address_is_normalized_on_parse() {
        // The event socket never sends a 0x-prefixed address in practice,
        // but normalizing on parse here too means a pushed address always
        // compares equal to hyprctl's 0x-prefixed JSON ground truth
        // (logger_v4.rs normalizes that side), regardless of source.
        let mut state = ActiveWindowState::default();
        apply_event_line(&mut state, "activewindowv2>>0x5934283adf20");
        assert_eq!(state.address.as_deref(), Some("5934283adf20"));
    }

    #[test]
    fn title_with_embedded_comma_is_preserved_whole() {
        let mut state = ActiveWindowState::default();
        apply_event_line(&mut state, "activewindow>>Alacritty,foo, bar - vim");
        assert_eq!(state.title.as_deref(), Some("foo, bar - vim"));
    }

    #[test]
    fn parses_activewindowv2_address() {
        let mut state = ActiveWindowState::default();
        assert!(apply_event_line(&mut state, "activewindowv2>>5934283adf20"));
        assert_eq!(state.address.as_deref(), Some("5934283adf20"));
    }

    #[test]
    fn empty_activewindow_clears_class_and_title() {
        let mut state = ActiveWindowState {
            class: Some("kitty".to_string()),
            title: Some("x".to_string()),
            address: None,
        };
        let changed = apply_event_line(&mut state, "activewindow>>,");
        assert!(changed);
        assert!(state.class.is_none());
        assert!(state.title.is_none());
    }

    #[test]
    fn unrelated_event_line_is_ignored() {
        let mut state = ActiveWindowState::default();
        assert!(!apply_event_line(&mut state, "workspace>>3"));
        assert_eq!(state, ActiveWindowState::default());
    }

    #[test]
    fn repeated_identical_event_reports_no_change() {
        let mut state = ActiveWindowState::default();
        assert!(apply_event_line(&mut state, "activewindow>>kitty,same title"));
        assert!(!apply_event_line(&mut state, "activewindow>>kitty,same title"));
    }

    #[test]
    fn has_data_false_until_first_event() {
        let state = ActiveWindowState::default();
        assert!(!state.has_data());
        let mut populated = state;
        apply_event_line(&mut populated, "activewindowv2>>deadbeef");
        assert!(populated.has_data());
    }
}
