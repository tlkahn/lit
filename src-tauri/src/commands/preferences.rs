use crate::preferences;
use crate::seed::SeedState;
use std::sync::Arc;
use tauri::State;

#[tauri::command]
pub fn get_preferences(
    app_handle: tauri::AppHandle,
    seed_state: State<'_, Arc<SeedState>>,
) -> preferences::Preferences {
    seed_state.wait_ready();
    preferences::read_preferences(&app_handle)
}

#[tauri::command]
pub fn get_preferences_path(app_handle: tauri::AppHandle) -> String {
    preferences::preferences_path(&app_handle)
        .to_string_lossy()
        .to_string()
}
