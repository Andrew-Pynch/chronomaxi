use std::process::Command;

fn run_cmd(cmd: &str, args: &[&str]) -> Option<String> {
    let output = Command::new(cmd).args(args).output().ok()?;
    if !output.status.success() {
        return None;
    }

    Some(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

pub fn get_all_tmux_programs() -> Vec<String> {
    let tmux_sessions = get_tmux_sessions();
    let mut all_programs = Vec::new();

    for session in tmux_sessions {
        let session_programs = get_tmux_session_programs(session);
        all_programs.extend(session_programs);
    }

    all_programs
}

pub fn get_tmux_sessions() -> Vec<String> {
    run_cmd("tmux", &["list-sessions", "-F", "#{session_name}"])
        .map(|tmux_sessions_str| {
            tmux_sessions_str
                .lines()
                .map(|s| s.to_string())
                .collect()
        })
        .unwrap_or_default()
}

pub fn get_tmux_session_programs(session_name: String) -> Vec<String> {
    let Some(tmux_windows_str) = run_cmd(
        "tmux",
        &[
            "list-windows",
            "-t",
            session_name.as_str(),
            "-F",
            "#{window_active} #{window_name}",
        ],
    ) else {
        return Vec::new();
    };
    let tmux_windows: Vec<&str> = tmux_windows_str.lines().collect();

    let mut session_programs = Vec::new();

    for window in tmux_windows {
        let window_parts: Vec<&str> = window.split_whitespace().collect();
        if window_parts.len() >= 2 {
            let window_name = window_parts[1];
            let target = format!("{}:{}", session_name, window_name);

            let Some(tmux_panes_str) = run_cmd(
                "tmux",
                &[
                    "list-panes",
                    "-t",
                    target.as_str(),
                    "-F",
                    "#{pane_current_command}",
                ],
            ) else {
                continue;
            };
            let tmux_panes: Vec<&str> = tmux_panes_str.lines().collect();

            for pane in tmux_panes {
                let program_name = pane.trim().to_string();
                session_programs.push(program_name);
            }
        }
    }

    session_programs
}
