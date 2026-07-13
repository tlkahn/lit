use std::process::Command;

#[tauri::command]
pub fn is_cli_installed() -> bool {
    Command::new("which")
        .arg("lit")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}
