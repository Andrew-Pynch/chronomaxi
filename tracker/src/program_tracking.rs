use std::process::Command;

pub fn get_program_name(window_id: &str) -> Result<Option<String>, Box<dyn std::error::Error>> {
    let output = Command::new("xprop")
        .args(&["-id", window_id, "WM_CLASS"])
        .output()?
        .stdout;

    let output_str = String::from_utf8(output)?;
    let program_name = output_str.split('"').nth(1).map(|name| name.to_string());

    Ok(program_name)
}

pub fn get_window_title(window_id: &str) -> Result<String, Box<dyn std::error::Error>> {
    let output = Command::new("xprop")
        .args(&["-id", window_id, "WM_NAME"])
        .output()?
        .stdout;

    let output_str = String::from_utf8(output)?;
    let window_title = output_str
        .split('"')
        .nth(1)
        .ok_or("Window title not found")?
        .to_string();

    Ok(window_title)
}

pub fn get_browser_url(window_id: &str) -> Result<String, Box<dyn std::error::Error>> {
    // if the current window is a browser such as brave-browser, try to parse out the url from
    // that window
    let output = Command::new("xdotool")
        .args(&["getwindowpid", window_id])
        .output()?
        .stdout;

    let output_str = String::from_utf8(output)?;

    let pid = output_str.trim().to_string();

    let output = Command::new("ps")
        .args(&["-p", &pid, "-o", "comm="])
        .output()?
        .stdout;

    let output_str = String::from_utf8(output)?;

    let program_name = output_str.trim().to_string();

    if program_name == "brave-browser" {
        let output = Command::new("xdotool")
            .args(&["getwindowfocus", "getwindowname"])
            .output()?
            .stdout;

        let output_str = String::from_utf8(output)?;

        let window_title = output_str.trim().to_string();

        let url = window_title
            .split(" - ")
            .nth(1)
            .ok_or("URL not found")?
            .to_string();

        return Ok(url);
    }

    Ok(String::new())
}
