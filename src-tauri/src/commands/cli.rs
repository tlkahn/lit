use std::path::Path;

#[tauri::command]
pub fn is_cli_installed() -> bool {
    Path::new("/usr/local/bin/lit").exists()
}
