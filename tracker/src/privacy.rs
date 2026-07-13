use std::fs;
use std::io::Write;
use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
use std::path::{Path, PathBuf};

const SCRUB_LABEL: &str = "homework";

#[derive(Clone, Debug, serde::Deserialize, serde::Serialize)]
pub struct PrivacyConfig {
    #[serde(default)]
    pub adult_domains: Vec<String>,
    #[serde(default)]
    pub flagged_terms: Vec<String>,
    #[serde(default)]
    pub search_markers: Vec<String>,
    #[serde(default)]
    pub private_window_markers: Vec<String>,
}

#[derive(Clone, Debug)]
pub struct PrivacyScrubber {
    config: PrivacyConfig,
    audit_path: PathBuf,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ScrubDecision {
    pub scrubbed: bool,
    pub program_process_name: String,
    pub program_name: String,
    pub title: String,
    pub browser_title: Option<String>,
    pub sub_program: Option<String>,
    pub bucket: String,
}

impl PrivacyScrubber {
    pub fn load(config_path: &Path, audit_path: &Path) -> Self {
        let config = load_or_seed(config_path).unwrap_or_else(|e| {
            println!(
                "chronomaxi privacy: failed to load {} ({e}), using in-process denylist",
                config_path.display()
            );
            default_config()
        });
        Self { config, audit_path: audit_path.to_path_buf() }
    }

    pub fn scrub_fields(
        &self,
        program_process_name: &str,
        program_name: &str,
        title: &str,
        browser_title: Option<&str>,
        sub_program: Option<&str>,
        bucket: &str,
    ) -> ScrubDecision {
        let fields = [
            program_process_name,
            program_name,
            title,
            browser_title.unwrap_or(""),
            sub_program.unwrap_or(""),
        ];
        let scrubbed = fields.iter().any(|value| self.should_scrub(value));
        if !scrubbed {
            return ScrubDecision {
                scrubbed: false,
                program_process_name: program_process_name.to_string(),
                program_name: program_name.to_string(),
                title: title.to_string(),
                browser_title: browser_title.map(ToString::to_string),
                sub_program: sub_program.map(ToString::to_string),
                bucket: bucket.to_string(),
            };
        }

        self.audit(program_process_name, program_name, title, browser_title, sub_program, bucket);
        ScrubDecision {
            scrubbed: true,
            program_process_name: SCRUB_LABEL.to_string(),
            program_name: SCRUB_LABEL.to_string(),
            title: SCRUB_LABEL.to_string(),
            browser_title: Some(SCRUB_LABEL.to_string()),
            sub_program: None,
            bucket: SCRUB_LABEL.to_string(),
        }
    }

    fn should_scrub(&self, value: &str) -> bool {
        let lower = value.to_lowercase();
        if lower.trim().is_empty() {
            return false;
        }
        if self.config.adult_domains.iter().any(|domain| contains_pattern(&lower, domain)) {
            return true;
        }
        if self
            .config
            .private_window_markers
            .iter()
            .any(|marker| contains_pattern(&lower, marker))
        {
            return true;
        }
        let has_flagged_term = self.config.flagged_terms.iter().any(|term| contains_pattern(&lower, term));
        if has_flagged_term {
            return true;
        }
        let looks_like_search = self.config.search_markers.iter().any(|marker| contains_pattern(&lower, marker))
            || lower.contains("?q=")
            || lower.contains("&q=")
            || lower.contains(" search")
            || lower.contains(" - google search")
            || lower.contains(" - duckduckgo");
        looks_like_search && uncertain_or_personal_query(&lower)
    }

    fn audit(
        &self,
        program_process_name: &str,
        program_name: &str,
        title: &str,
        browser_title: Option<&str>,
        sub_program: Option<&str>,
        bucket: &str,
    ) {
        if let Some(parent) = self.audit_path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        let mut file = match fs::OpenOptions::new()
            .create(true)
            .append(true)
            .mode(0o600)
            .open(&self.audit_path)
        {
            Ok(file) => file,
            Err(e) => {
                println!("chronomaxi privacy: failed to write local scrub audit: {e}");
                return;
            }
        };
        let _ = file.set_permissions(fs::Permissions::from_mode(0o600));
        let line = serde_json::json!({
            "ts": chrono::Utc::now().to_rfc3339(),
            "programProcessName": program_process_name,
            "programName": program_name,
            "title": title,
            "browserTitle": browser_title,
            "subProgram": sub_program,
            "bucket": bucket,
        });
        let _ = writeln!(file, "{}", line);
    }
}

pub fn default_config_path() -> PathBuf {
    let config_home = std::env::var("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .or_else(|_| std::env::var("HOME").map(|home| PathBuf::from(home).join(".config")))
        .unwrap_or_else(|_| PathBuf::from(".config"));
    config_home.join("chronomaxi/privacy-denylist.json")
}

pub fn default_audit_path() -> PathBuf {
    let state_home = std::env::var("XDG_STATE_HOME")
        .map(PathBuf::from)
        .or_else(|_| std::env::var("HOME").map(|home| PathBuf::from(home).join(".local/state")))
        .unwrap_or_else(|_| PathBuf::from(".local/state"));
    state_home.join("chronomaxi/scrub-audit.log")
}

fn load_or_seed(path: &Path) -> Result<PrivacyConfig, Box<dyn std::error::Error>> {
    if !path.exists() {
        seed_file(path)?;
    }
    let text = fs::read_to_string(path)?;
    let config: PrivacyConfig = serde_json::from_str(&text)?;
    Ok(config)
}

fn seed_file(path: &Path) -> Result<(), Box<dyn std::error::Error>> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let mut file = fs::OpenOptions::new().write(true).create_new(true).mode(0o600).open(path)?;
    file.write_all(serde_json::to_string_pretty(&default_config())?.as_bytes())?;
    Ok(())
}

fn contains_pattern(value: &str, pattern: &str) -> bool {
    let pattern = pattern.trim().to_lowercase();
    !pattern.is_empty() && value.contains(&pattern)
}

fn uncertain_or_personal_query(value: &str) -> bool {
    const PERSONAL_MARKERS: [&str; 22] = [
        "how do i",
        "near me",
        "my ",
        "symptom",
        "doctor",
        "medical",
        "therapy",
        "therapist",
        "relationship",
        "divorce",
        "lawyer",
        "attorney",
        "salary",
        "bank",
        "password",
        "login",
        "account",
        "reddit",
        "private",
        "incognito",
        "adult",
        "porn",
    ];
    PERSONAL_MARKERS.iter().any(|marker| value.contains(marker))
}

fn default_config() -> PrivacyConfig {
    PrivacyConfig {
        adult_domains: vec![
            "pornhub".to_string(),
            "xvideos".to_string(),
            "xnxx".to_string(),
            "redtube".to_string(),
            "youporn".to_string(),
            "onlyfans".to_string(),
            "fansly".to_string(),
            "chaturbate".to_string(),
            "cam4".to_string(),
            "xhamster".to_string(),
            "spankbang".to_string(),
            "brazzers".to_string(),
            "adultfriendfinder".to_string(),
        ],
        flagged_terms: vec![
            "porn".to_string(),
            "xxx".to_string(),
            "nsfw".to_string(),
            "nude".to_string(),
            "nudes".to_string(),
            "sex".to_string(),
            "escort".to_string(),
            "cam girl".to_string(),
            "camgirl".to_string(),
        ],
        search_markers: vec![
            "google search".to_string(),
            "duckduckgo".to_string(),
            "bing".to_string(),
            "search.yahoo".to_string(),
            "kagi search".to_string(),
            "perplexity".to_string(),
        ],
        private_window_markers: vec![
            "private browsing".to_string(),
            "private window".to_string(),
            "incognito".to_string(),
            "inprivate".to_string(),
        ],
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scrubber() -> PrivacyScrubber {
        PrivacyScrubber { config: default_config(), audit_path: PathBuf::from("/tmp/chronomaxi-test-scrub-audit.log") }
    }

    #[test]
    fn flagged_title_becomes_homework() {
        let decision = scrubber().scrub_fields("Firefox", "Firefox", "pornhub", None, None, "other");
        assert!(decision.scrubbed);
        assert_eq!(decision.title, "homework");
        assert_eq!(decision.bucket, "homework");
    }

    #[test]
    fn personal_search_becomes_homework() {
        let decision = scrubber().scrub_fields(
            "Chrome",
            "Google Search",
            "my medical symptoms - Google Search",
            Some("my medical symptoms"),
            None,
            "other",
        );
        assert!(decision.scrubbed);
        assert_eq!(decision.program_name, "homework");
    }

    #[test]
    fn clean_title_passes() {
        let decision = scrubber().scrub_fields("Alacritty", "Alacritty", "nvim repo", Some("nvim repo"), Some("nvim"), "coding");
        assert!(!decision.scrubbed);
        assert_eq!(decision.title, "nvim repo");
        assert_eq!(decision.bucket, "coding");
    }
}
