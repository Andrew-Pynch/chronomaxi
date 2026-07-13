use std::fs;
use std::io::Write;
use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
use std::path::{Path, PathBuf};

const SCRUB_LABEL: &str = "homework";

const CONFIG_COMMENT: &str =
    "Extend allowlist_domains with browser domains whose titles are safe to log.";

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
    #[serde(default = "default_config_comment", rename = "_comment")]
    pub comment: String,
    #[serde(default)]
    pub allowlist_domains: Vec<String>,
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
        let browser_content = browser_title.is_some()
            || is_known_browser(program_process_name)
            || is_known_browser(program_name);
        let scrubbed = fields.iter().any(|value| self.should_force_scrub(value))
            || (browser_content && !fields.iter().any(|value| self.is_allowlisted(value)));
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

    fn should_force_scrub(&self, value: &str) -> bool {
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

    fn is_allowlisted(&self, value: &str) -> bool {
        let lower = value.to_lowercase();
        if lower.trim().is_empty() {
            return false;
        }
        self.config
            .allowlist_domains
            .iter()
            .any(|domain| contains_pattern(&lower, domain))
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
    let mut config: PrivacyConfig = serde_json::from_str(&text)?;
    // Old configs predate browser fail-closed allowlisting. Treat an empty
    // allowlist as "not configured yet" so loading one does not scrub all browsing.
    if config.allowlist_domains.is_empty() {
        config.allowlist_domains = default_allowlist_domains();
    }
    if config.comment.is_empty() {
        config.comment = default_config_comment();
    }
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

fn is_known_browser(program: &str) -> bool {
    let program = program.to_lowercase();
    const BROWSERS: [&str; 8] = [
        "brave",
        "chrome",
        "chromium",
        "firefox",
        "safari",
        "edge",
        "librewolf",
        "zen",
    ];
    BROWSERS.iter().any(|browser| program.contains(browser))
}

fn default_config_comment() -> String {
    CONFIG_COMMENT.to_string()
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
        comment: default_config_comment(),
        allowlist_domains: default_allowlist_domains(),
    }
}

fn default_allowlist_domains() -> Vec<String> {
    [
        "github",
        "github.com",
        "gitlab",
        "gitlab.com",
        "localhost",
        "127.0.0.1",
        "vercel",
        "vercel.com",
        "linear",
        "linear.app",
        "slack",
        "slack.com",
        "pynch-labs.slack.com",
        "notion",
        "notion.so",
        "google docs",
        "docs.google.com",
        "google drive",
        "drive.google.com",
        "google calendar",
        "calendar.google.com",
        "google meet",
        "meet.google.com",
        "stackoverflow",
        "stack overflow",
        "stackoverflow.com",
        "rust-lang",
        "rust-lang.org",
        "docs.rs",
        "crates.io",
        "npm",
        "npmjs.com",
        "anthropic",
        "anthropic.com",
        "openai",
        "openai.com",
        "x.ai",
        "claude",
        "claude.ai",
        "chatgpt",
        "chatgpt.com",
        "tailscale",
        "tailscale.com",
        "cloudflare",
        "cloudflare.com",
        "convex",
        "convex.dev",
        "youtube",
        "youtube.com",
        "wikipedia",
        "wikipedia.org",
        "hacker news",
        "news.ycombinator.com",
        "arxiv",
        "arxiv.org",
        "big-bertha.tail3f4961.ts.net",
        "my.omp.sh",
    ]
    .into_iter()
    .map(ToString::to_string)
    .collect()
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
    fn allowlisted_github_browser_title_passes() {
        let decision = scrubber().scrub_fields(
            "Brave Browser",
            "Brave",
            "pull request 123 - github.com",
            Some("pull request 123 - github.com"),
            None,
            "coding",
        );
        assert!(!decision.scrubbed);
        assert_eq!(decision.title, "pull request 123 - github.com");
        assert_eq!(decision.browser_title.as_deref(), Some("pull request 123 - github.com"));
        assert_eq!(decision.bucket, "coding");
    }

    #[test]
    fn unknown_adult_domain_in_browser_becomes_homework() {
        let decision = scrubber().scrub_fields(
            "Firefox",
            "Firefox",
            "Videos - redgifs.com",
            None,
            None,
            "other",
        );
        assert!(decision.scrubbed);
        assert_eq!(decision.title, "homework");
        assert_eq!(decision.bucket, "homework");
    }

    #[test]
    fn unknown_random_blog_in_browser_becomes_homework() {
        let decision = scrubber().scrub_fields(
            "chromium",
            "Chromium",
            "A harmless essay - randomblog.example",
            Some("A harmless essay - randomblog.example"),
            None,
            "research",
        );
        assert!(decision.scrubbed);
        assert_eq!(decision.title, "homework");
        assert_eq!(decision.browser_title.as_deref(), Some("homework"));
    }

    #[test]
    fn terminal_title_with_random_text_passes() {
        let decision = scrubber().scrub_fields(
            "Alacritty",
            "Alacritty",
            "random notes without a domain",
            None,
            Some("nvim"),
            "coding",
        );
        assert!(!decision.scrubbed);
        assert_eq!(decision.title, "random notes without a domain");
        assert_eq!(decision.bucket, "coding");
    }

    #[test]
    fn old_config_without_allowlist_gets_default_allowlist_and_stays_fail_closed() {
        let path = std::env::temp_dir().join(format!(
            "chronomaxi-old-privacy-{}-{}.json",
            std::process::id(),
            chrono::Utc::now().timestamp_nanos_opt().unwrap()
        ));
        fs::write(
            &path,
            serde_json::json!({
                "adult_domains": [],
                "flagged_terms": [],
                "search_markers": [],
                "private_window_markers": []
            })
            .to_string(),
        )
        .unwrap();

        let config = load_or_seed(&path).unwrap();
        let scrubber = PrivacyScrubber {
            config,
            audit_path: PathBuf::from("/tmp/chronomaxi-test-scrub-audit.log"),
        };
        let unknown = scrubber.scrub_fields(
            "Chrome",
            "Chrome",
            "Unknown site - randomblog.example",
            Some("Unknown site - randomblog.example"),
            None,
            "research",
        );
        let github = scrubber.scrub_fields(
            "Chrome",
            "Chrome",
            "Repo - github.com",
            Some("Repo - github.com"),
            None,
            "coding",
        );

        assert!(unknown.scrubbed);
        assert_eq!(unknown.title, "homework");
        assert!(!github.scrubbed);
        assert_eq!(github.title, "Repo - github.com");

        let _ = fs::remove_file(path);
    }

    #[test]
    fn seed_file_writes_allowlist_and_user_comment() {
        let path = std::env::temp_dir().join(format!(
            "chronomaxi-seed-privacy-{}-{}.json",
            std::process::id(),
            chrono::Utc::now().timestamp_nanos_opt().unwrap()
        ));

        seed_file(&path).unwrap();
        let text = fs::read_to_string(&path).unwrap();
        let json: serde_json::Value = serde_json::from_str(&text).unwrap();
        let allowlist = json
            .get("allowlist_domains")
            .and_then(|value| value.as_array())
            .unwrap();

        assert!(allowlist.iter().any(|value| value == "github"));
        assert_eq!(json.get("_comment").and_then(|value| value.as_str()), Some(CONFIG_COMMENT));

        let _ = fs::remove_file(path);
    }
}
