mod commands;
pub mod workspace;

use commands::workspace::{PendingWorkspaces, WorkspaceRegistry};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::Manager;
use workspace::write_hash::WriteHashRegistry;

pub struct InitialWorkspace(pub Mutex<Option<String>>);

#[tauri::command]
fn get_initial_workspace(state: tauri::State<InitialWorkspace>) -> Option<String> {
    state.0.lock().unwrap().take()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let cli_workspace = std::env::args()
        .nth(1)
        .filter(|arg| PathBuf::from(arg).is_dir());

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(WorkspaceRegistry {
            workspaces: Mutex::new(HashMap::new()),
        })
        .manage(PendingWorkspaces(Mutex::new(HashMap::new())))
        .manage(InitialWorkspace(Mutex::new(cli_workspace)))
        .manage(Arc::new(WriteHashRegistry::new()))
        .setup(|app| {
            let _ = commands::theme::seed_bundled_themes(app.handle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::app_info::get_app_info,
            commands::workspace::open_workspace,
            commands::workspace::list_pages,
            commands::workspace::get_workspace_path,
            commands::workspace::open_workspace_window,
            commands::workspace::get_pending_workspace,
            commands::page::read_page,
            commands::page::write_page,
            commands::page::create_page,
            commands::page::rename_page,
            commands::page::delete_page,
            commands::page::parse_raw_yaml,
            commands::theme::list_themes,
            commands::theme::read_theme_css,
            commands::theme::get_themes_directory,
            get_initial_workspace,
        ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                let label = window.label().to_string();
                if let Some(registry) = window.try_state::<WorkspaceRegistry>() {
                    registry.workspaces.lock().unwrap().remove(&label);
                }
                if let Some(pending) = window.try_state::<PendingWorkspaces>() {
                    pending.0.lock().unwrap().remove(&label);
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
