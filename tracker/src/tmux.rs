use std::process::Command;

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
    let tmux_sessions_output = Command::new("tmux")
        .arg("list-sessions")
        .arg("-F")
        .arg("#{session_name}")
        .output()
        .expect("Failed to get tmux sessions");

    let tmux_sessions_str = String::from_utf8(tmux_sessions_output.stdout).unwrap();
    tmux_sessions_str
        .trim()
        .split('\n')
        .map(|s| s.to_string())
        .collect()
}

pub fn get_tmux_session_programs(session_name: String) -> Vec<String> {
    let tmux_windows_output = Command::new("tmux")
        .arg("list-windows")
        .arg("-t")
        .arg(session_name.clone())
        .arg("-F")
        .arg("#{window_active} #{window_name}")
        .output()
        .expect("Failed to get tmux windows");

    let tmux_windows_str = String::from_utf8(tmux_windows_output.stdout).unwrap();
    let tmux_windows: Vec<&str> = tmux_windows_str.trim().split('\n').collect();

    let mut session_programs = Vec::new();

    for window in tmux_windows {
        let window_parts: Vec<&str> = window.split_whitespace().collect();
        if window_parts.len() >= 2 {
            let window_name = window_parts[1];

            let tmux_panes_output = Command::new("tmux")
                .arg("list-panes")
                .arg("-t")
                .arg(format!("{}:{}", session_name.clone(), window_name))
                .arg("-F")
                .arg("#{pane_current_command}")
                .output()
                .expect("Failed to get tmux panes");

            let tmux_panes_str = String::from_utf8(tmux_panes_output.stdout).unwrap();
            let tmux_panes: Vec<&str> = tmux_panes_str.trim().split('\n').collect();

            for pane in tmux_panes {
                let program_name = pane.trim().to_string();
                session_programs.push(program_name);
            }
        }
    }

    session_programs
}
