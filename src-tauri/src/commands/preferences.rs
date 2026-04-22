use crate::preferences;

#[tauri::command]
pub fn get_preferences(app_handle: tauri::AppHandle) -> preferences::Preferences {
    preferences::read_preferences(&app_handle)
}

#[tauri::command]
pub fn get_preferences_path(app_handle: tauri::AppHandle) -> String {
    preferences::preferences_path(&app_handle)
        .to_string_lossy()
        .to_string()
}
