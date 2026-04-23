pub mod cli;
mod commands;
mod menu;
pub mod preferences;
pub mod workspace;

use commands::workspace::{PendingFiles, PendingWorkspaces, WorkspaceRegistry};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tauri::{Manager, WebviewWindowBuilder};
use workspace::write_hash::WriteHashRegistry;

pub struct InitialWorkspace(pub Mutex<Option<String>>);
pub struct InitialFile(pub Mutex<Option<String>>);

#[tauri::command]
fn get_initial_workspace(state: tauri::State<InitialWorkspace>) -> Option<String> {
    state.0.lock().unwrap().take()
}

#[tauri::command]
fn get_initial_file(state: tauri::State<InitialFile>) -> Option<String> {
    state.0.lock().unwrap().take()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let (cli_workspace, cli_file) = match std::env::args().nth(1) {
        Some(arg) => {
            let cwd = std::env::current_dir()
                .unwrap_or_default()
                .to_string_lossy()
                .to_string();
            match cli::resolve_arg(&arg, &cwd) {
                cli::CliTarget::Directory(p) => {
                    (Some(p.to_string_lossy().to_string()), None)
                }
                cli::CliTarget::File { workspace, file } => {
                    (Some(workspace.to_string_lossy().to_string()), Some(file))
                }
                cli::CliTarget::Invalid(_) => (None, None),
            }
        }
        None => (None, None),
    };

    let setup_workspace = cli_workspace.clone();
    let setup_file = cli_file.clone();

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            match cli::process_instance_args(&args, &cwd) {
                Some(cli::CliTarget::Directory(path)) => {
                    let path_str = path.to_string_lossy().to_string();
                    let _ = commands::workspace::create_workspace_window(app, Some(path_str), None);
                }
                Some(cli::CliTarget::File { workspace, file }) => {
                    let workspace_str = workspace.to_string_lossy().to_string();
                    let _ = commands::workspace::create_workspace_window(
                        app,
                        Some(workspace_str),
                        Some(file),
                    );
                }
                _ => {
                    if let Some(win) = app.webview_windows().values().next() {
                        let _ = win.set_focus();
                    }
                }
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(WorkspaceRegistry {
            workspaces: Mutex::new(HashMap::new()),
        })
        .manage(PendingWorkspaces(Mutex::new(HashMap::new())))
        .manage(PendingFiles(Mutex::new(HashMap::new())))
        .manage(InitialWorkspace(Mutex::new(cli_workspace)))
        .manage(InitialFile(Mutex::new(cli_file)))
        .manage(Arc::new(WriteHashRegistry::new()))
        .setup(move |app| {
            let _ = commands::theme::seed_bundled_themes(app.handle());
            commands::keymap::seed_default_keymaps(app.handle());
            preferences::seed_default_if_missing(app.handle());

            let menu = menu::build_menu(app.handle())?;
            app.set_menu(menu)?;

            if let Ok(watcher) = preferences::PreferencesWatcher::new(app.handle().clone()) {
                app.manage(watcher);
            }

            let mut builder =
                WebviewWindowBuilder::new(app.handle(), "main", tauri::WebviewUrl::default())
                    .title("Lit")
                    .inner_size(1024.0, 768.0);

            if let Some(script) = cli::cli_init_script(&setup_workspace, &setup_file) {
                builder = builder.initialization_script(&script);
            }

            builder.build()?;

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
                                let _ = commands::workspace::create_workspace_window(&handle, Some(p), None);
                            }
                        });
                    });
                }
                "install_cli" => {
                    let handle = app.clone();
                    tauri::async_runtime::spawn(async move {
                        use tauri_plugin_dialog::DialogExt;
                        let result = commands::cli::install_cli(handle.clone());
                        let dialog = handle.dialog();
                        match result {
                            Ok(()) => {
                                dialog.message("Command line tool installed at /usr/local/bin/lit")
                                    .title("Success")
                                    .blocking_show();
                            }
                            Err(e) => {
                                dialog.message(format!("Failed to install: {e}"))
                                    .title("Error")
                                    .blocking_show();
                            }
                        }
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
            commands::workspace::get_pending_file,
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
            commands::cli::install_cli,
            commands::cli::uninstall_cli,
            commands::cli::is_cli_installed,
            get_initial_workspace,
            get_initial_file,
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
                if let Some(pending) = window.try_state::<PendingFiles>() {
                    pending.0.lock().unwrap().remove(&label);
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
