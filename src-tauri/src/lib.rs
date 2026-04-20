mod commands;
pub mod workspace;

use commands::workspace::AppState;
use std::path::PathBuf;
use std::sync::Mutex;

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
        .manage(AppState {
            workspace_root: Mutex::new(None),
            watcher: Mutex::new(None),
        })
        .manage(InitialWorkspace(Mutex::new(cli_workspace)))
        .invoke_handler(tauri::generate_handler![
            commands::app_info::get_app_info,
            commands::workspace::open_workspace,
            commands::workspace::list_pages,
            commands::workspace::get_workspace_path,
            commands::page::read_page,
            commands::page::write_page,
            commands::page::create_page,
            commands::page::rename_page,
            commands::page::delete_page,
            get_initial_workspace,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
