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

#[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
pub struct Configuration {
    pub log_methods: Vec<LogMethod>,
    pub api_key: String,
    pub user_id: String,
}

impl Configuration {
    pub async fn from_env() -> Result<Self, Box<dyn std::error::Error>> {
        dotenv().ok();

        let log_methods = (1..=3)
            .map(|i| env::var(format!("LOGMODE{}", i)).ok())
            .filter_map(|opt| opt.and_then(|s| LogMethod::from_str(&s)))
            .collect();

        println!("{:?}", log_methods);

        let api_key = env::var("API_KEY").ok().expect("API_KEY must be set");

        let temporary_db = crate::db::DbConnection::new().await?;
        let is_valid_api_key = temporary_db.is_api_key_valid(&api_key).await?;
        if !is_valid_api_key {
            panic!("Invalid API key");
        }

        let user_id = temporary_db.get_user_from_api_key(&api_key).await?;
        if user_id.is_empty() {
            panic!("No user found for API key");
        }

        Ok(Self {
            log_methods,
            api_key,
            user_id,
        })
    }

    pub fn set_user_id(&mut self, user_id: String) {
        self.user_id = user_id;
    }
}
