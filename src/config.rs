use dotenv::dotenv;
use std::env;

#[derive(Debug, Clone)]
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

#[derive(Clone)]
pub struct Configuration {
    pub log_methods: Vec<LogMethod>,
    pub api_key: String,
    pub user_id: String,
}

impl Configuration {
    pub fn from_env() -> Self {
        dotenv().ok();

        let log_methods = (1..=3)
            .map(|i| env::var(format!("LOGMODE{}", i)).ok())
            .filter_map(|opt| opt.and_then(|s| LogMethod::from_str(&s)))
            .collect();

        println!("{:?}", log_methods);

        let api_key = env::var("API_KEY").ok().expect("API_KEY must be set");

        Configuration {
            log_methods,
            api_key,
            user_id: String::new(),
        }
    }

    pub fn set_user_id(&mut self, user_id: String) {
        self.user_id = user_id;
    }
}
