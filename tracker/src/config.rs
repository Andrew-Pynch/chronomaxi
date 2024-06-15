use dotenv::dotenv;
use std::env;

#[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
pub enum LogMethod {
    Stdout,
    File,
    Db,
}

impl LogMethod {
    fn from_str(s: &str) -> Option<LogMethod> {
        match s {
            "Stdout" => Some(LogMethod::Stdout),
            "File" => Some(LogMethod::File),
            "Db" => Some(LogMethod::Db),
            _ => None,
        }
    }
}

#[derive(Clone, serde::Deserialize, serde::Serialize)]
pub struct Configuration {
    pub log_methods: Vec<LogMethod>,
    pub log_every_n_logs: usize,
    pub stats_every_n_seconds: i64,
    pub log_iteration_pause_ms: u64,
}

impl Configuration {
    pub async fn from_env() -> Result<Self, Box<dyn std::error::Error>> {
        dotenv().ok();

        let log_methods = (1..=3)
            .map(|i| env::var(format!("LOGMODE{}", i)).ok())
            .filter_map(|opt| opt.and_then(|s| LogMethod::from_str(&s)))
            .collect();

        Ok(Self {
            log_methods,
            log_every_n_logs: 100,
            stats_every_n_seconds: 15,
            log_iteration_pause_ms: 250,
        })
    }
}
