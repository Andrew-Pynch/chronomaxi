use dotenv::dotenv;

#[derive(Clone, serde::Deserialize, serde::Serialize)]
pub struct Configuration {
    pub log_every_n_logs: usize,
    pub stats_every_n_seconds: i64,
    pub log_iteration_pause_ms: u64,
}

impl Configuration {
    pub async fn from_env() -> Result<Self, Box<dyn std::error::Error>> {
        dotenv().ok();

        Ok(Self {
            log_every_n_logs: 1000,
            stats_every_n_seconds: 15,
            log_iteration_pause_ms: 100,
        })
    }
}
