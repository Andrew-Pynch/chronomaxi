use std::collections::HashSet;

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum Category {
    Coding,
    Entertainment,
    Communication,
    Research,
    Other,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CategoryMatcher {
    coding: HashSet<String>,
    entertainment: HashSet<String>,
    communication: HashSet<String>,
    research: HashSet<String>,
}

impl CategoryMatcher {
    pub fn new() -> Self {
        let mut coding = HashSet::new();
        coding.insert("x-terminal-emulator".to_string());
        coding.insert("gnome-terminal".to_string());
        coding.insert("localhost".to_string());
        coding.insert("vscode".to_string());
        coding.insert("intellij".to_string());
        coding.insert("pycharm".to_string());
        coding.insert("vim".to_string());
        coding.insert("nvim".to_string());
        coding.insert("emacs".to_string());
        coding.insert("sublime_text".to_string());
        coding.insert("github.com".to_string());
        coding.insert("gitlab.com".to_string());
        coding.insert("stackoverflow.com".to_string());
        coding.insert("claude".to_string());
        coding.insert("andrewpynch.com".to_string());
        coding.insert("github desktop".to_string());
        coding.insert("github".to_string());

        let mut entertainment = HashSet::new();
        entertainment.insert("youtube.com".to_string());
        entertainment.insert("netflix.com".to_string());
        entertainment.insert("hulu.com".to_string());
        entertainment.insert("crunchyroll.com".to_string());
        entertainment.insert("twitch.tv".to_string());

        let mut communication = HashSet::new();
        communication.insert("gmail.com".to_string());
        communication.insert("outlook.com".to_string());
        communication.insert("slack".to_string());
        communication.insert("teams".to_string());
        communication.insert("discord".to_string());
        communication.insert("zoom".to_string());
        communication.insert("backlog".to_string());
        communication.insert("trello".to_string());
        communication.insert("todo".to_string());
        communication.insert("google calendar".to_string());

        let mut research = HashSet::new();
        research.insert("arxiv.org".to_string());
        research.insert("news.ycombinator.com".to_string());
        research.insert("twitter.com".to_string());
        research.insert("reddit.com".to_string());
        research.insert("scholar.google.com".to_string());
        research.insert("researchgate.net".to_string());
        research.insert("bambu-studio".to_string());

        CategoryMatcher {
            coding,
            entertainment,
            communication,
            research,
        }
    }

    pub fn categorize(
        &self,
        program_name: &str,
        program_process_name: &str,
        browser_title: Option<&str>,
        browser_site_name: Option<&str>,
    ) -> Category {
        let lower_program_name = program_name.to_lowercase();
        let lower_process_name = program_process_name.to_lowercase();

        if self.coding.contains(&lower_program_name) || self.coding.contains(&lower_process_name) {
            return Category::Coding;
        }

        if self.entertainment.contains(&lower_program_name)
            || self.entertainment.contains(&lower_process_name)
        {
            return Category::Entertainment;
        }

        if self.communication.contains(&lower_program_name)
            || self.communication.contains(&lower_process_name)
        {
            return Category::Communication;
        }

        if self.research.contains(&lower_program_name)
            || self.research.contains(&lower_process_name)
        {
            return Category::Research;
        }

        // Check browser site name if available
        if let Some(site_name) = browser_site_name {
            let lower_site_name = site_name.to_lowercase();
            if self.coding.contains(&lower_site_name) {
                return Category::Coding;
            }
            if self.entertainment.contains(&lower_site_name) {
                return Category::Entertainment;
            }
            if self.communication.contains(&lower_site_name) {
                return Category::Communication;
            }
            if self.research.contains(&lower_site_name) {
                return Category::Research;
            }
        }

        // Fall back to browser title if site name didn't match
        if let Some(title) = browser_title {
            let lower_title = title.to_lowercase();
            for domain in &self.coding {
                if lower_title.contains(domain) {
                    return Category::Coding;
                }
            }
            for domain in &self.entertainment {
                if lower_title.contains(domain) {
                    return Category::Entertainment;
                }
            }
            for domain in &self.communication {
                if lower_title.contains(domain) {
                    return Category::Communication;
                }
            }
            for domain in &self.research {
                if lower_title.contains(domain) {
                    return Category::Research;
                }
            }
        }

        Category::Other
    }
}

pub fn get_category(
    program_name: &str,
    program_process_name: &str,
    browser_title: Option<&str>,
    browser_site_name: Option<&str>,
) -> Category {
    let matcher = CategoryMatcher::new();

    let result = matcher.categorize(
        program_name,
        program_process_name,
        browser_title,
        browser_site_name,
    );

    // println!(
    //     "\n\nBrowser Title: {:?}\nBrowser Site Name: {:?}\nProgram Name: {:?}\nProgram Process Name: {:?}\nCategory: {:?}",
    //     browser_title,
    //     browser_site_name,
    //     program_name,
    //     program_process_name,
    //     result
    // );

    return result;
}
