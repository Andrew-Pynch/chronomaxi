use std::env;
use std::path::PathBuf;

use dotenv::dotenv;

/// Default actor when neither a `cmx|` title tag nor CHRONOMAXI_ACTOR is set.
pub const DEFAULT_ACTOR: &str = "human";

/// Max rows a single flusher POST will send to the ingest endpoint.
pub const SPOOL_BATCH_SIZE: usize = 500;

#[derive(Clone, serde::Deserialize, serde::Serialize)]
pub struct Configuration {
    pub log_interval_seconds: i64,
    pub stats_every_n_seconds: i64,
    pub log_iteration_pause_ms: u64,

    /// Base URL of the Convex HTTP ingest action, e.g. "http://big-bertha:3211".
    /// The flusher POSTs to `{ingest_url}/ingest`.
    pub ingest_url: String,
    /// Bearer token sent as `Authorization: Bearer <secret>` on every ingest POST.
    pub ingest_secret: String,
    /// "human" | "agent:<name>" -- fallback actor when the active window's
    /// title does not carry a `cmx|actor=...` tag.
    pub actor: String,
    /// Raw device identity stamped on every span (Convex resolves aliases).
    pub device_name: String,
    /// Local durable spool db path.
    pub spool_path: PathBuf,
}

impl Configuration {
    pub fn from_env() -> Result<Self, Box<dyn std::error::Error>> {
        dotenv().ok();

        Ok(Self {
            log_interval_seconds: 1,
            stats_every_n_seconds: 30,
            log_iteration_pause_ms: 100,
            ingest_url: env::var("CHRONOMAXI_INGEST_URL")
                .unwrap_or_else(|_| "http://127.0.0.1:3211".to_string()),
            ingest_secret: env::var("CHRONOMAXI_INGEST_SECRET").unwrap_or_default(),
            actor: env::var("CHRONOMAXI_ACTOR").unwrap_or_else(|_| DEFAULT_ACTOR.to_string()),
            device_name: env::var("CHRONOMAXI_DEVICE_NAME").unwrap_or_else(|_| whoami::devicename()),
            spool_path: env::var("CHRONOMAXI_SPOOL_PATH")
                .map(PathBuf::from)
                .unwrap_or_else(|_| default_spool_path()),
        })
    }
}

/// $XDG_STATE_HOME/chronomaxi/spool.sqlite on Linux (falling back to
/// ~/.local/state when XDG_STATE_HOME is unset), or
/// ~/Library/Application Support/chronomaxi/spool.sqlite on macOS.
fn default_spool_path() -> PathBuf {
    if cfg!(target_os = "macos") {
        return env::var("HOME")
            .map(|home| PathBuf::from(home).join("Library/Application Support/chronomaxi/spool.sqlite"))
            .unwrap_or_else(|_| PathBuf::from("chronomaxi-spool.sqlite"));
    }

    let state_home = env::var("XDG_STATE_HOME").map(PathBuf::from).unwrap_or_else(|_| {
        env::var("HOME")
            .map(|home| PathBuf::from(home).join(".local/state"))
            .unwrap_or_else(|_| PathBuf::from(".local/state"))
    });

    state_home.join("chronomaxi/spool.sqlite")
}
