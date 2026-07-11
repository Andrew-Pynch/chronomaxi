//! Terminal sub-program resolution ("chronomaxi tmux drill-down"):
//! distinguishes "editing in nvim" from "idle at a zsh prompt" inside the
//! same terminal-emulator window, which window-id/class capture alone
//! cannot see. Two independent sources, preferred in this order:
//!
//!   1. PUSH state (deploy/drilldown/{chronomaxi-foreground.zsh,
//!      chronomaxi-tmux-publish.sh, install.sh}): the shell's own
//!      preexec/precmd hooks and a handful of tmux hooks atomically write
//!      the live foreground command to
//!      `$XDG_STATE_HOME/chronomaxi/foreground` (or
//!      `~/.local/state/chronomaxi/foreground`) on every prompt/pane/
//!      window/session change. Free to read (no subprocess) and preferred
//!      whenever fresh (< `PUSH_FRESHNESS`).
//!   2. IPC PULL fallback: focused-window pid -> `/proc` walk to the
//!      youngest descendant `tmux` (client) process -> that client's
//!      controlling tty -> `tmux display-message` for the active pane's
//!      `#{pane_current_command}`. Rate-limited (`IPC_MIN_INTERVAL`) since
//!      it forks 2-3 processes; only invoked when the push file is
//!      missing or stale. Most terminal windows have nothing to drill into
//!      (no tmux, or a pane not attached to any client we can find) and
//!      resolve to `None` -- that's expected, not an error.
//!
//! Ron's tmux runs with `set-titles off`, so the window/WM title is never
//! a usable signal for pane identity -- this module never reads it.

use std::collections::{HashMap, HashSet, VecDeque};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

/// Terminal-emulator window classes that trigger sub-program drill-down.
const TERMINAL_CLASSES: [&str; 2] = ["alacritty", "kitty"];

/// Push state is preferred over the IPC fallback only while younger than
/// this.
const PUSH_FRESHNESS: Duration = Duration::from_secs(10);

/// Minimum spacing between IPC fallback attempts (each one forks up to 3
/// processes: a /proc walk is pure syscalls, but the two `tmux
/// display-message` calls are real subprocesses).
const IPC_MIN_INTERVAL: Duration = Duration::from_secs(2);

/// Whether `program_process_name` (already lower-cased by callers, but
/// this normalizes defensively) is a terminal emulator we drill into.
pub fn is_terminal_class(program_process_name: &str) -> bool {
    let lower = program_process_name.to_lowercase();
    TERMINAL_CLASSES.iter().any(|class| lower == *class)
}

/// Basename + strip args, e.g. "/usr/bin/nvim file.rs" -> "nvim",
/// "cargo build --release" -> "cargo". Returns `None` for empty input.
pub fn normalize(raw: &str) -> Option<String> {
    let first_word = raw.trim().split_whitespace().next()?;
    let base = Path::new(first_word).file_name()?.to_str()?;
    if base.is_empty() {
        None
    } else {
        Some(base.to_string())
    }
}

fn foreground_state_path() -> PathBuf {
    let state_home = std::env::var("XDG_STATE_HOME").map(PathBuf::from).unwrap_or_else(|_| {
        std::env::var("HOME")
            .map(|home| PathBuf::from(home).join(".local/state"))
            .unwrap_or_else(|_| PathBuf::from(".local/state"))
    });
    state_home.join("chronomaxi/foreground")
}

/// One line of the shared push-state format: `epochms|session|pane|cmd`.
#[derive(Debug, Clone, PartialEq, Eq)]
struct PushState {
    epoch_ms: i64,
    cmd: String,
}

fn parse_push_line(line: &str) -> Option<PushState> {
    let mut parts = line.trim().splitn(4, '|');
    let epoch_ms: i64 = parts.next()?.parse().ok()?;
    let _session = parts.next()?;
    let _pane = parts.next()?;
    let cmd = parts.next()?.trim().to_string();
    if cmd.is_empty() {
        return None;
    }
    Some(PushState { epoch_ms, cmd })
}

fn now_epoch_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn is_fresh(state: &PushState) -> bool {
    let age_ms = now_epoch_ms() - state.epoch_ms;
    (0..PUSH_FRESHNESS.as_millis() as i64).contains(&age_ms)
}

fn read_push_state() -> Option<PushState> {
    let content = fs::read_to_string(foreground_state_path()).ok()?;
    parse_push_line(content.lines().next()?)
}

/// Resolves the terminal sub-program across ticks, throttling the IPC
/// fallback so a busy capture loop never forks a `tmux` process more than
/// once per `IPC_MIN_INTERVAL`.
pub struct TmuxResolver {
    last_ipc_attempt: Option<Instant>,
    last_ipc_result: Option<String>,
}

impl TmuxResolver {
    pub fn new() -> Self {
        Self { last_ipc_attempt: None, last_ipc_result: None }
    }

    /// Resolves the sub-program for a terminal-class focused window.
    /// `focused_pid` is the terminal emulator's own pid, resolved by the
    /// caller once per focus change (see logger_v4.rs) -- never re-resolved
    /// here on every tick.
    pub fn resolve(&mut self, focused_pid: Option<i64>) -> Option<String> {
        if let Some(push) = read_push_state() {
            if is_fresh(&push) {
                return normalize(&push.cmd);
            }
        }

        self.resolve_via_ipc(focused_pid)
    }

    fn resolve_via_ipc(&mut self, focused_pid: Option<i64>) -> Option<String> {
        let now = Instant::now();
        let due = self.last_ipc_attempt.is_none_or(|last| now.duration_since(last) >= IPC_MIN_INTERVAL);
        if !due {
            return self.last_ipc_result.clone();
        }

        self.last_ipc_attempt = Some(now);
        self.last_ipc_result = focused_pid.and_then(resolve_pane_command_via_ipc);
        self.last_ipc_result.clone()
    }
}

impl Default for TmuxResolver {
    fn default() -> Self {
        Self::new()
    }
}

fn run_tmux(args: &[&str]) -> Option<String> {
    let output = Command::new("tmux").args(args).output().ok()?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if text.is_empty() {
        None
    } else {
        Some(text)
    }
}

fn resolve_pane_command_via_ipc(pid: i64) -> Option<String> {
    let tty = find_descendant_tmux_client_tty(pid)?;
    let session = run_tmux(&["display-message", "-p", "-t", &tty, "#{client_session}"])?;
    let pane_info = run_tmux(&[
        "display-message",
        "-p",
        "-t",
        &session,
        "#{session_name}:#{window_index}.#{pane_index} #{pane_current_command}",
    ])?;
    let (_, cmd) = pane_info.rsplit_once(' ')?;
    normalize(cmd)
}

/// Finds the youngest `tmux` (client) process descended from `root_pid`
/// (BFS over the live `/proc` tree) and returns its controlling tty path,
/// e.g. "/dev/pts/3". `root_pid` is the terminal emulator's own pid.
fn find_descendant_tmux_client_tty(root_pid: i64) -> Option<String> {
    let ppid_map = build_ppid_map();
    let mut children: HashMap<i32, Vec<i32>> = HashMap::new();
    for (&pid, &ppid) in &ppid_map {
        children.entry(ppid).or_default().push(pid);
    }

    let root_pid = root_pid as i32;
    let mut queue: VecDeque<i32> = children.get(&root_pid).cloned().unwrap_or_default().into();
    let mut visited: HashSet<i32> = HashSet::new();
    visited.insert(root_pid);

    while let Some(pid) = queue.pop_front() {
        if !visited.insert(pid) {
            continue;
        }
        if process_name(pid).as_deref() == Some("tmux") {
            if let Some(tty) = controlling_tty(pid) {
                return Some(tty);
            }
        }
        if let Some(kids) = children.get(&pid) {
            queue.extend(kids.iter().copied());
        }
    }

    None
}

/// Reads every process's parent pid from `/proc/*/status`. Races with
/// processes exiting mid-scan are skipped silently -- a missing entry just
/// means that pid never gets visited as anyone's child, harmless here.
fn build_ppid_map() -> HashMap<i32, i32> {
    let mut map = HashMap::new();
    let Ok(entries) = fs::read_dir("/proc") else {
        return map;
    };
    for entry in entries.filter_map(|e| e.ok()) {
        let Some(pid) = entry.file_name().to_str().and_then(|s| s.parse::<i32>().ok()) else {
            continue;
        };
        if let Some(ppid) = read_ppid(pid) {
            map.insert(pid, ppid);
        }
    }
    map
}

fn read_ppid(pid: i32) -> Option<i32> {
    let status = fs::read_to_string(format!("/proc/{pid}/status")).ok()?;
    status.lines().find_map(|line| line.strip_prefix("PPid:").and_then(|rest| rest.trim().parse::<i32>().ok()))
}

fn process_name(pid: i32) -> Option<String> {
    fs::read_to_string(format!("/proc/{pid}/comm")).ok().map(|s| s.trim().to_string())
}

/// A tmux client's stdin/stdout/stderr are its controlling pty, so reading
/// the `fd/N` symlinks is enough to identify it without decoding
/// `/proc/<pid>/stat`'s `tty_nr` major/minor pair.
fn controlling_tty(pid: i32) -> Option<String> {
    for fd in [0, 1, 2] {
        if let Ok(target) = fs::read_link(format!("/proc/{pid}/fd/{fd}")) {
            if let Some(s) = target.to_str() {
                if s.starts_with("/dev/pts/") || s.starts_with("/dev/tty") {
                    return Some(s.to_string());
                }
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn is_terminal_class_matches_known_terminals() {
        assert!(is_terminal_class("alacritty"));
        assert!(is_terminal_class("Kitty"));
        assert!(!is_terminal_class("firefox"));
    }

    #[test]
    fn normalize_strips_path_and_args() {
        assert_eq!(normalize("/usr/bin/nvim file.rs"), Some("nvim".to_string()));
        assert_eq!(normalize("cargo build --release"), Some("cargo".to_string()));
        assert_eq!(normalize("zsh"), Some("zsh".to_string()));
        assert_eq!(normalize("   "), None);
        assert_eq!(normalize(""), None);
    }

    #[test]
    fn parse_push_line_extracts_cmd() {
        let parsed = parse_push_line("1751234567890|chronomaxi|1.0|nvim").unwrap();
        assert_eq!(parsed.epoch_ms, 1751234567890);
        assert_eq!(parsed.cmd, "nvim");
    }

    #[test]
    fn parse_push_line_rejects_malformed_or_empty_cmd() {
        assert!(parse_push_line("not-a-number|s|p|cmd").is_none());
        assert!(parse_push_line("123|s|p|").is_none());
        assert!(parse_push_line("123|s|p").is_none());
    }

    #[test]
    fn freshness_window_is_respected() {
        let now = now_epoch_ms();
        let fresh = PushState { epoch_ms: now - 1000, cmd: "nvim".to_string() };
        let stale = PushState { epoch_ms: now - 20_000, cmd: "nvim".to_string() };
        let future = PushState { epoch_ms: now + 5_000, cmd: "nvim".to_string() };
        assert!(is_fresh(&fresh));
        assert!(!is_fresh(&stale));
        assert!(!is_fresh(&future));
    }
}
