use crate::category::Category;
use chrono::{DateTime, Utc};
use std::fmt::{self, Formatter};

#[derive(Clone, serde::Serialize, serde::Deserialize, Debug, PartialEq)]
pub struct Log {
    pub current_window_id: Option<String>,
    pub current_program_process_name: Option<String>,
    pub current_program_name: Option<String>,
    pub current_browser_title: Option<String>,
    pub current_mouse_position: Option<(i32, i32)>,

    pub duration_ms: Option<i64>,
    pub keys_pressed_count: Option<usize>,

    pub created_at: Option<DateTime<Utc>>,
    pub log_start_time_utc: Option<DateTime<Utc>>,
    pub log_end_time_utc: Option<DateTime<Utc>>,

    pub category: Option<Category>,
    pub mouse_movement_mm: Option<f64>,
    pub left_click_count: Option<usize>,
    pub right_click_count: Option<usize>,
    pub middle_click_count: Option<usize>,
    /// Terminal drill-down: the currently focused sub-program inside a
    /// terminal-class window (e.g. "nvim", "cargo", "zsh"), resolved via
    /// tmux (crate::tmux). `None` for non-terminal windows or when tmux
    /// drill-down can't resolve anything (bare shell, no tmux, etc).
    pub sub_program: Option<String>,

    /// "human" | "agent:<name>" -- resolved from a `cmx|actor=...` window
    /// title tag when present, else CHRONOMAXI_ACTOR, else "human".
    pub actor: String,

    pub is_idle: bool,
}

impl fmt::Display for Log {
    fn fmt(&self, f: &mut Formatter<'_>) -> fmt::Result {
        let (mouse_x, mouse_y) = self.current_mouse_position.unwrap_or((0, 0));
        write!(
            f,
            "Window ID: {:?}\nProgram Process Name: {:?}\nProgram Name: {:?}\nBrowser Title: {:?}\nMouse Position: ({:?}, {:?})\nDuration MS: {:?}\nKeys Pressed: {:?}\nCreated At: {:?}\n\nStart Time: {:?}\nEndTime: {:?}\nIsIdle: {:?}\n Category: {:?}\n Mouse Movement in (mm): {:?}\nLeft Clicks: {:?}\n Right Clicks: {:?}\n Middle Clicks: {:?}\nSubProgram: {:?}\nActor: {:?}",
            self.current_window_id,
            self.current_program_process_name,
            self.current_program_name,
            self.current_browser_title,
            mouse_x,
            mouse_y,
            self.duration_ms,
            self.keys_pressed_count,
            self.created_at,
            self.log_start_time_utc,
            self.log_end_time_utc,
            self.is_idle,
            self.category,
            self.mouse_movement_mm,
            self.left_click_count,
            self.right_click_count,
            self.middle_click_count,
            self.sub_program,
            self.actor
        )
    }
}

impl Log {
    pub fn new() -> Log {
        Log {
            current_window_id: None,
            current_program_process_name: None,
            current_program_name: None,
            current_browser_title: None,
            current_mouse_position: None,
            duration_ms: None,
            keys_pressed_count: None,
            created_at: None,
            log_start_time_utc: None,
            log_end_time_utc: None,
            is_idle: false,
            category: None,
            mouse_movement_mm: None,
            left_click_count: None,
            right_click_count: None,
            middle_click_count: None,
            sub_program: None,
            actor: crate::config::DEFAULT_ACTOR.to_string(),
        }
    }

    pub fn get_log_duration_ms(&self) -> Option<i64> {
        match (self.log_end_time_utc, self.log_start_time_utc) {
            (Some(end_time), Some(start_time)) => {
                let duration_ms = end_time.timestamp_millis() - start_time.timestamp_millis();
                Some(duration_ms)
            }
            _ => None,
        }
    }
}
