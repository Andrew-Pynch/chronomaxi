//! Shared capture types. Hyprland/X11 polling stays in logger_v4.rs
//! unchanged; macOS-native polling lives in capture::macos.

#[cfg(target_os = "macos")]
pub mod macos;

#[derive(Clone, Debug)]
pub struct ActiveWindow {
    pub id: String,
    pub program_process_name: String,
    pub program_name: String,
    pub title: String,
}

pub fn unknown_window() -> ActiveWindow {
    ActiveWindow {
        id: "unknown".to_string(),
        program_process_name: "unknown".to_string(),
        program_name: "unknown".to_string(),
        title: "unknown".to_string(),
    }
}
