use std::env;

use dotenv::dotenv;

#[derive(Clone, serde::Deserialize, serde::Serialize)]
pub struct Configuration {
    pub log_interval_seconds: i64,
    pub stats_every_n_seconds: i64,
    pub log_iteration_pause_ms: u64,
    pub database_url: Option<String>,
}

impl Configuration {
    pub fn from_env() -> Result<Self, Box<dyn std::error::Error>> {
        dotenv().ok();

        Ok(Self {
            log_interval_seconds: 1,
            stats_every_n_seconds: 30,
            log_iteration_pause_ms: 100,
            database_url: env::var("DATABASE_URL").ok(),
        })
    }
}
