use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

#[derive(Clone, Debug, serde::Deserialize, serde::Serialize)]
pub struct BucketRule {
    pub bucket: String,
    #[serde(default)]
    pub program_patterns: Vec<String>,
    #[serde(default)]
    pub title_patterns: Vec<String>,
    #[serde(default)]
    pub sub_program_patterns: Vec<String>,
    #[serde(default)]
    pub tmux_session_patterns: Vec<String>,
}

#[derive(Clone, Debug, serde::Deserialize, serde::Serialize)]
pub struct BucketConfig {
    #[serde(default)]
    pub rules: Vec<BucketRule>,
    #[serde(default = "default_bucket")]
    pub default_bucket: String,
}

#[derive(Clone, Debug)]
pub struct BucketClassifier {
    config: BucketConfig,
}

impl BucketClassifier {
    pub fn load(path: &Path) -> Self {
        let config = load_or_seed(path).unwrap_or_else(|e| {
            println!(
                "chronomaxi buckets: failed to load {} ({e}), using in-process defaults",
                path.display()
            );
            default_config()
        });
        Self { config }
    }

    pub fn classify(
        &self,
        program: &str,
        title: Option<&str>,
        sub_program: Option<&str>,
        tmux_session: Option<&str>,
    ) -> String {
        for rule in &self.config.rules {
            if matches_any(program, &rule.program_patterns)
                || title.is_some_and(|value| matches_any(value, &rule.title_patterns))
                || sub_program.is_some_and(|value| matches_any(value, &rule.sub_program_patterns))
                || tmux_session.is_some_and(|value| matches_any(value, &rule.tmux_session_patterns))
            {
                return rule.bucket.clone();
            }
        }
        self.config.default_bucket.clone()
    }
}

pub fn default_path() -> PathBuf {
    let config_home = std::env::var("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .or_else(|_| std::env::var("HOME").map(|home| PathBuf::from(home).join(".config")))
        .unwrap_or_else(|_| PathBuf::from(".config"));
    config_home.join("chronomaxi/buckets.json")
}

fn load_or_seed(path: &Path) -> Result<BucketConfig, Box<dyn std::error::Error>> {
    if !path.exists() {
        seed_file(path)?;
    }
    let text = fs::read_to_string(path)?;
    let config: BucketConfig = serde_json::from_str(&text)?;
    Ok(config)
}

fn seed_file(path: &Path) -> Result<(), Box<dyn std::error::Error>> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let mut file = fs::OpenOptions::new().write(true).create_new(true).open(path)?;
    file.write_all(serde_json::to_string_pretty(&default_config())?.as_bytes())?;
    Ok(())
}

fn matches_any(value: &str, patterns: &[String]) -> bool {
    let value = value.to_lowercase();
    patterns
        .iter()
        .map(|pattern| pattern.trim().to_lowercase())
        .filter(|pattern| !pattern.is_empty())
        .any(|pattern| value.contains(&pattern))
}

fn default_bucket() -> String {
    "other".to_string()
}

fn default_config() -> BucketConfig {
    BucketConfig {
        default_bucket: default_bucket(),
        rules: vec![
            BucketRule {
                bucket: "coding".to_string(),
                program_patterns: vec!["cursor".to_string(), "code".to_string(), "zed".to_string()],
                title_patterns: vec!["github".to_string(), "linear".to_string()],
                sub_program_patterns: vec!["nvim".to_string(), "vim".to_string(), "cargo".to_string(), "pnpm".to_string()],
                tmux_session_patterns: vec!["dev".to_string(), "code".to_string()],
            },
            BucketRule {
                bucket: "comms".to_string(),
                program_patterns: vec!["slack".to_string(), "discord".to_string(), "zoom".to_string()],
                title_patterns: vec!["gmail".to_string(), "mail".to_string()],
                sub_program_patterns: Vec::new(),
                tmux_session_patterns: vec!["comms".to_string()],
            },
            BucketRule {
                bucket: "client".to_string(),
                program_patterns: Vec::new(),
                title_patterns: vec!["shell bikes".to_string(), "starcube".to_string(), "asv".to_string()],
                sub_program_patterns: Vec::new(),
                tmux_session_patterns: vec!["client".to_string()],
            },
        ],
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_by_sub_program() {
        let classifier = BucketClassifier { config: default_config() };
        assert_eq!(classifier.classify("alacritty", None, Some("nvim"), None), "coding");
    }

    #[test]
    fn falls_back_to_default_bucket() {
        let classifier = BucketClassifier { config: default_config() };
        assert_eq!(classifier.classify("unknown", Some("plain title"), None, None), "other");
    }
}
