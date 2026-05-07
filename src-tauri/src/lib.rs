pub mod annotation;
pub mod bib;
pub mod pdf;
pub mod cli;
mod commands;
pub mod external_editor;
pub mod graph;
mod menu;
pub mod preferences;
pub mod seed;
pub mod socket;
pub mod workspace;

use commands::graph::GraphRegistry;
use commands::workspace::{PendingCols, PendingFiles, PendingLines, PendingWorkspaces, WorkspaceRegistry};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tauri::{Manager, WebviewWindowBuilder};
use workspace::write_hash::WriteHashRegistry;
use bib::cache::BibCache;

pub struct InitialWorkspace(pub Mutex<Option<String>>);
pub struct InitialFile(pub Mutex<Option<String>>);
pub struct InitialLine(pub Mutex<Option<u32>>);
pub struct InitialCol(pub Mutex<Option<u32>>);

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("lit_lib=info")),
        )
        .init();
    let (cli_workspace, cli_file, cli_line, cli_col) = match std::env::args().nth(1) {
        Some(arg) => {
            let cwd = std::env::current_dir()
                .unwrap_or_default()
                .to_string_lossy()
                .to_string();
            match cli::resolve_arg(&arg, &cwd) {
                cli::CliTarget::Directory(p) => {
                    (Some(p.to_string_lossy().to_string()), None, None, None)
                }
                cli::CliTarget::File { workspace, file, line, col } => {
                    (Some(workspace.to_string_lossy().to_string()), Some(file), line, col)
                }
                cli::CliTarget::Invalid(_) => (None, None, None, None),
            }
        }
        None => (None, None, None, None),
    };

    let setup_workspace = cli_workspace.clone();
    let setup_file = cli_file.clone();
    let setup_line = cli_line;
    let setup_col = cli_col;

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            match cli::process_instance_args(&args, &cwd) {
                Some(cli::CliTarget::Directory(path)) => {
                    let path_str = path.to_string_lossy().to_string();
                    if let Ok(label) = commands::workspace::create_workspace_window(app, Some(path_str), None, None, None) {
                        if let Some(win) = app.get_webview_window(&label) {
                            let _ = win.set_focus();
                        }
                    }
                }
                Some(cli::CliTarget::File { workspace, file, line, col }) => {
                    let workspace_str = workspace.to_string_lossy().to_string();
                    if let Ok(label) = commands::workspace::create_workspace_window(
                        app,
                        Some(workspace_str),
                        Some(file),
                        line,
                        col,
                    ) {
                        if let Some(win) = app.get_webview_window(&label) {
                            let _ = win.set_focus();
                        }
                    }
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
        .manage(PendingLines(Mutex::new(HashMap::new())))
        .manage(PendingCols(Mutex::new(HashMap::new())))
        .manage(InitialWorkspace(Mutex::new(cli_workspace)))
        .manage(InitialFile(Mutex::new(cli_file)))
        .manage(InitialLine(Mutex::new(cli_line)))
        .manage(InitialCol(Mutex::new(cli_col)))
        .manage(Arc::new(WriteHashRegistry::new()))
        .manage(Arc::new(GraphRegistry::new()))
        .manage(Arc::new(commands::graph::GraphBuildState::new()))
        .manage(Arc::new(seed::SeedState::new()))
        .manage(BibCache::new())
        .manage(commands::pdf_viewer::PdfViewerState::new(&pdf::find_libpdfium_or_default()))
        .setup(move |app| {
            let seed_state: Arc<seed::SeedState> =
                app.state::<Arc<seed::SeedState>>().inner().clone();
            let seed_handle = app.handle().clone();
            tauri::async_runtime::spawn_blocking(move || {
                let _ = commands::theme::seed_bundled_themes(&seed_handle);
                commands::keymap::seed_default_keymaps(&seed_handle);
                preferences::seed_default_if_missing(&seed_handle);
                seed_state.mark_ready();
            });

            let menu = menu::build_menu(app.handle())?;
            app.set_menu(menu)?;

            if let Ok(watcher) = preferences::PreferencesWatcher::new(app.handle().clone()) {
                app.manage(watcher);
            }

            let early_workspace = setup_workspace.clone().or_else(|| {
                app.path().app_data_dir().ok().and_then(|dir| {
                    commands::workspace::read_last_workspace(&dir)
                })
            });

            if let Some(ref ws_path) = early_workspace {
                let root = std::path::PathBuf::from(ws_path);
                if root.is_dir() {
                    let build_state: Arc<commands::graph::GraphBuildState> =
                        app.state::<Arc<commands::graph::GraphBuildState>>().inner().clone();
                    let graph_reg: Arc<commands::graph::GraphRegistry> =
                        app.state::<Arc<commands::graph::GraphRegistry>>().inner().clone();
                    let handle = app.handle().clone();

                    build_state.start_build(root.clone());

                    tauri::async_runtime::spawn_blocking(move || {
                        commands::graph::initialize_graph_index(
                            root,
                            build_state,
                            graph_reg,
                            handle,
                        );
                    });
                }
            }

            let mut builder =
                WebviewWindowBuilder::new(app.handle(), "main", tauri::WebviewUrl::default())
                    .title("Lit")
                    .inner_size(1024.0, 768.0);

            if let Some(script) = cli::cli_init_script(&setup_workspace, &setup_file, &setup_line, &setup_col) {
                builder = builder.initialization_script(&script);
            }

            builder.build()?;

            let handle = app.handle().clone();
            let sock = cli::socket_path();
            tauri::async_runtime::spawn(async move {
                socket::start_listener(sock, move |target| {
                    let label = match target {
                        cli::CliTarget::Directory(path) => {
                            let path_str = path.to_string_lossy().to_string();
                            commands::workspace::create_workspace_window(
                                &handle,
                                Some(path_str),
                                None,
                                None,
                                None,
                            )
                            .map_err(|e| e.to_string())
                        }
                        cli::CliTarget::File {
                            workspace,
                            file,
                            line,
                            col,
                        } => {
                            let workspace_str = workspace.to_string_lossy().to_string();
                            commands::workspace::create_workspace_window(
                                &handle,
                                Some(workspace_str),
                                Some(file),
                                line,
                                col,
                            )
                            .map_err(|e| e.to_string())
                        }
                        cli::CliTarget::Invalid(s) => Err(format!("invalid target: {s}")),
                    }?;
                    if let Some(win) = handle.get_webview_window(&label) {
                        let _ = win.set_focus();
                    }
                    Ok(())
                })
                .await;
            });

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
                                let _ = commands::workspace::create_workspace_window(&handle, Some(p), None, None, None);
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
                "open_in_external_editor" => {
                    use tauri::Emitter;
                    let _ = app.emit("menu://open-in-external-editor", ());
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
            commands::workspace::get_pending_line,
            commands::workspace::get_pending_col,
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
            commands::preferences::set_preference,
            commands::cli::install_cli,
            commands::cli::uninstall_cli,
            commands::cli::is_cli_installed,
            commands::crossref::resolve_all_decorations,
            commands::crossref::get_definitions,
            commands::crossref::expand_template,
            commands::crossref::resolve_bib_entries,
            commands::crossref::render_bib_citations,
            commands::external_editor::open_in_external_editor,
            commands::graph::rebuild_graph_index,
            commands::graph::get_pagerank,
            commands::graph::get_backlinks,
            commands::graph::get_forward_links,
            commands::graph::search_pages,
            commands::graph::search_pages_by_title,
            commands::graph::get_graph_stats,
            commands::graph::get_graph_neighbors,
            commands::graph::get_graph_paths,
            commands::graph::get_graph_subgraph,
            commands::graph::resolve_wikilink,
            commands::graph::get_page_headings,
            commands::graph::get_unlinked_mentions,
            commands::graph::link_unlinked_mention,
            commands::graph::search_tags,
            commands::graph::list_pages_by_tag,
            commands::graph::ensure_graph_ready,
            commands::graph::get_graph_positions,
            commands::graph::reset_graph_layout,
            commands::workspace::get_startup_context,
            commands::pdf_viewer::pdf_open,
            commands::pdf_viewer::pdf_render_page,
            commands::pdf_viewer::pdf_prefetch,
            commands::pdf_viewer::pdf_close,
            commands::annotation::parse_annotations,
            commands::annotation::resolve_annotation_scope,
            commands::annotation::search_annotations,
            commands::annotation::list_annotations,
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
                if let Some(pending) = window.try_state::<PendingLines>() {
                    pending.0.lock().unwrap().remove(&label);
                }
                if let Some(pending) = window.try_state::<PendingCols>() {
                    pending.0.lock().unwrap().remove(&label);
                }
                if let Some(pdf_state) = window.try_state::<commands::pdf_viewer::PdfViewerState>() {
                    let _ = pdf_state.close_for_window(&label);
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app, event| {
            if let tauri::RunEvent::Exit = event {
                socket::cleanup_socket(&cli::socket_path());
            }
        });
}
