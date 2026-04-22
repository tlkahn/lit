mod commands;
mod menu;
pub mod preferences;
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
            commands::keymap::seed_default_keymaps(app.handle());
            preferences::seed_default_if_missing(app.handle());

            let menu = menu::build_menu(app.handle())?;
            app.set_menu(menu)?;

            if let Ok(watcher) = preferences::PreferencesWatcher::new(app.handle().clone()) {
                app.manage(watcher);
            }

            Ok(())
        })
        .on_menu_event(|app, event| {
            match event.id().as_ref() {
                "open_workspace" => {
                    let handle = app.clone();
                    tauri::async_runtime::spawn(async move {
                        use tauri_plugin_dialog::DialogExt;
                        let dialog = handle.dialog().clone();
                        dialog.file().pick_folder(move |folder| {
                            if let Some(path) = folder {
                                let p = path.to_string();
                                let _ = commands::workspace::create_workspace_window(&handle, Some(p));
                            }
                        });
                    });
                }
                "open_preferences" => {
                    let handle = app.clone();
                    tauri::async_runtime::spawn(async move {
                        preferences::seed_default_if_missing(&handle);
                        let path = preferences::preferences_path(&handle);
                        if let Some(path_str) = path.to_str() {
                            use tauri_plugin_opener::OpenerExt;
                            let _ = handle.opener().open_path(path_str, None::<&str>);
                        }
                    });
                }
                _ => {}
            }
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
            commands::keymap::get_keymaps,
            commands::keymap::get_default_keymaps,
            commands::keymap::get_user_keymaps_path,
            commands::keymap::save_user_keymaps,
            commands::preferences::get_preferences,
            commands::preferences::get_preferences_path,
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
