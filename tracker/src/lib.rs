#![warn(clippy::all, rust_2018_idioms)]

pub mod actor;
pub mod capture;
pub mod category;
pub mod config;
#[cfg(target_os = "linux")]
pub mod hypr_events;
pub mod idle_tracking;
pub mod ingest;
#[cfg(target_os = "linux")]
pub mod input_evdev;
pub mod log;
pub mod logger_v4;
pub mod spool;
pub mod tmux;
