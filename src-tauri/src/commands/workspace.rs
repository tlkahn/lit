use crate::commands::graph::GraphRegistry;
use crate::graph::indexer::GraphIndex;
use crate::workspace::page::PageMeta;
use crate::workspace::scan::scan_pages;
use crate::workspace::watcher::FileWatcher;
use crate::workspace::write_hash::WriteHashRegistry;
use crate::{InitialWorkspace, InitialFile, InitialLine, InitialCol};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{Emitter, Manager, State, WebviewWindowBuilder};

pub struct WorkspaceEntry {
    pub root: PathBuf,
    #[allow(dead_code)]
    pub watcher: Option<FileWatcher>,
}

pub struct WorkspaceRegistry {
    pub workspaces: Mutex<HashMap<String, WorkspaceEntry>>,
}

pub struct PendingWorkspaces(pub Mutex<HashMap<String, String>>);
pub struct PendingFiles(pub Mutex<HashMap<String, String>>);
pub struct PendingLines(pub Mutex<HashMap<String, u32>>);
pub struct PendingCols(pub Mutex<HashMap<String, u32>>);

pub fn persist_last_workspace(app_data_dir: &Path, workspace_path: &str) -> Result<(), std::io::Error> {
    std::fs::create_dir_all(app_data_dir)?;
    std::fs::write(app_data_dir.join("last-workspace"), workspace_path)
}

pub fn read_last_workspace(app_data_dir: &Path) -> Option<String> {
    std::fs::read_to_string(app_data_dir.join("last-workspace"))
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

pub fn get_workspace_root(registry: &WorkspaceRegistry, label: &str) -> Result<PathBuf, String> {
    let workspaces = registry.workspaces.lock().unwrap();
    workspaces
        .get(label)
        .map(|e| e.root.clone())
        .ok_or_else(|| format!("No workspace open in window '{label}'"))
}

#[tauri::command]
pub fn open_workspace(
    path: String,
    window: tauri::Window,
    state: State<WorkspaceRegistry>,
    app_handle: tauri::AppHandle,
    registry: State<Arc<WriteHashRegistry>>,
    graph_state: State<Arc<GraphRegistry>>,
    build_state: State<Arc<crate::commands::graph::GraphBuildState>>,
) -> Result<Vec<PageMeta>, String> {
    let root = PathBuf::from(&path);
    if !root.is_dir() {
        return Err(format!("Not a valid directory: {path}"));
    }

    let pages = scan_pages(&root).map_err(|e| e.to_string())?;

    app_handle
        .asset_protocol_scope()
        .allow_directory(&root, true)
        .map_err(|e| e.to_string())?;

    let label = window.label().to_string();
    let watcher = FileWatcher::new(
        root.clone(),
        label.clone(),
        app_handle.clone(),
        Arc::clone(&registry),
    )
    .ok();

    state.workspaces.lock().unwrap().insert(
        label,
        WorkspaceEntry {
            root: root.clone(),
            watcher,
        },
    );

    let graph_root = root.clone();
    let build_st = Arc::clone(&build_state);

    if !build_st.is_in_progress(&graph_root) {
        let graph_reg = Arc::clone(&graph_state);
        let handle = app_handle.clone();
        let build_st = Arc::clone(&build_st);
        build_st.start_build(graph_root.clone());

        tauri::async_runtime::spawn_blocking(move || {
            let emit_handle = handle.clone();
            let callback = move |p: crate::graph::progress::IndexProgress| {
                let _ = emit_handle.emit("lit:index-progress", &p);
            };

            match GraphIndex::build_with_progress(graph_root.clone(), &callback) {
                Ok(gi) => {
                    graph_reg
                        .indices
                        .lock()
                        .unwrap()
                        .insert(graph_root.clone(), Arc::new(gi));
                    build_st.mark_ready(&graph_root);
                    let _ = handle.emit("lit:graph-updated", ());
                }
                Err(e) => {
                    tracing::error!(error = %e, "failed to build graph index");
                    build_st.mark_failed(&graph_root, e.to_string());
                }
            }
        });
    }

    if let Ok(app_data_dir) = app_handle.path().app_data_dir() {
        let _ = persist_last_workspace(&app_data_dir, &path);
    }

    Ok(pages)
}

#[tauri::command]
pub fn list_pages(
    window: tauri::Window,
    state: State<WorkspaceRegistry>,
) -> Result<Vec<PageMeta>, String> {
    let root = get_workspace_root(&state, window.label())?;
    scan_pages(&root).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_workspace_path(
    window: tauri::Window,
    state: State<WorkspaceRegistry>,
) -> Result<Option<String>, String> {
    let workspaces = state.workspaces.lock().unwrap();
    Ok(workspaces
        .get(window.label())
        .map(|e| e.root.to_string_lossy().to_string()))
}

static WINDOW_COUNTER: AtomicU32 = AtomicU32::new(1);

pub fn create_workspace_window(
    app_handle: &tauri::AppHandle,
    path: Option<String>,
    file: Option<String>,
    line: Option<u32>,
    col: Option<u32>,
) -> Result<String, String> {
    let id = WINDOW_COUNTER.fetch_add(1, Ordering::Relaxed);
    let label = format!("workspace-{id}");
    if let Some(ref p) = path {
        if let Some(pending) = app_handle.try_state::<PendingWorkspaces>() {
            pending.0.lock().unwrap().insert(label.clone(), p.clone());
        }
    }
    if let Some(ref f) = file {
        if let Some(pending) = app_handle.try_state::<PendingFiles>() {
            pending.0.lock().unwrap().insert(label.clone(), f.clone());
        }
    }
    if let Some(l) = line {
        if let Some(pending) = app_handle.try_state::<PendingLines>() {
            pending.0.lock().unwrap().insert(label.clone(), l);
        }
    }
    if let Some(c) = col {
        if let Some(pending) = app_handle.try_state::<PendingCols>() {
            pending.0.lock().unwrap().insert(label.clone(), c);
        }
    }
    let mut builder = WebviewWindowBuilder::new(app_handle, &label, tauri::WebviewUrl::default())
        .title("Lit")
        .inner_size(1024.0, 768.0);

    if let Some(script) = crate::cli::cli_init_script(&path, &file, &line, &col) {
        builder = builder.initialization_script(&script);
    }

    builder
        .build()
        .map_err(|e| format!("Failed to create window: {e}"))?;
    Ok(label)
}

#[tauri::command]
pub fn open_workspace_window(
    path: Option<String>,
    app_handle: tauri::AppHandle,
    _state: State<PendingWorkspaces>,
) -> Result<String, String> {
    create_workspace_window(&app_handle, path, None, None, None)
}

#[tauri::command]
pub fn get_pending_workspace(
    window: tauri::Window,
    state: State<PendingWorkspaces>,
) -> Option<String> {
    state.0.lock().unwrap().remove(window.label())
}

#[tauri::command]
pub fn get_pending_file(
    window: tauri::Window,
    state: State<PendingFiles>,
) -> Option<String> {
    state.0.lock().unwrap().remove(window.label())
}

#[tauri::command]
pub fn get_pending_line(
    window: tauri::Window,
    state: State<PendingLines>,
) -> Option<u32> {
    state.0.lock().unwrap().remove(window.label())
}

#[tauri::command]
pub fn get_pending_col(
    window: tauri::Window,
    state: State<PendingCols>,
) -> Option<u32> {
    state.0.lock().unwrap().remove(window.label())
}

#[derive(serde::Serialize, Debug, PartialEq)]
pub struct StartupContext {
    pub workspace: Option<String>,
    pub file: Option<String>,
    pub line: Option<u32>,
    pub col: Option<u32>,
}

#[tauri::command]
pub fn get_startup_context(
    window: tauri::Window,
    pending_ws: State<PendingWorkspaces>,
    pending_files: State<PendingFiles>,
    pending_lines: State<PendingLines>,
    pending_cols: State<PendingCols>,
    initial_ws: State<InitialWorkspace>,
    initial_file: State<InitialFile>,
    initial_line: State<InitialLine>,
    initial_col: State<InitialCol>,
) -> StartupContext {
    let label = window.label();
    let workspace = pending_ws.0.lock().unwrap().remove(label);
    if workspace.is_some() {
        return StartupContext {
            workspace,
            file: pending_files.0.lock().unwrap().remove(label),
            line: pending_lines.0.lock().unwrap().remove(label),
            col: pending_cols.0.lock().unwrap().remove(label),
        };
    }
    StartupContext {
        workspace: initial_ws.0.lock().unwrap().take(),
        file: initial_file.0.lock().unwrap().take(),
        line: initial_line.0.lock().unwrap().take(),
        col: initial_col.0.lock().unwrap().take(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn registry_starts_empty() {
        let registry = WorkspaceRegistry {
            workspaces: Mutex::new(HashMap::new()),
        };
        assert!(registry.workspaces.lock().unwrap().is_empty());
    }

    #[test]
    fn get_workspace_root_returns_error_for_unknown_label() {
        let registry = WorkspaceRegistry {
            workspaces: Mutex::new(HashMap::new()),
        };
        let result = get_workspace_root(&registry, "unknown");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("unknown"));
    }

    #[test]
    fn get_workspace_root_returns_path_for_known_label() {
        let mut map = HashMap::new();
        map.insert(
            "main".to_string(),
            WorkspaceEntry {
                root: PathBuf::from("/test/workspace"),
                watcher: None,
            },
        );
        let registry = WorkspaceRegistry {
            workspaces: Mutex::new(map),
        };
        let result = get_workspace_root(&registry, "main");
        assert_eq!(result.unwrap(), PathBuf::from("/test/workspace"));
    }

    #[test]
    fn persist_and_read_last_workspace_round_trip() {
        let dir = tempfile::tempdir().unwrap();
        persist_last_workspace(dir.path(), "/my/vault").unwrap();
        assert_eq!(
            read_last_workspace(dir.path()),
            Some("/my/vault".to_string())
        );
    }

    #[test]
    fn read_last_workspace_returns_none_when_missing() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(read_last_workspace(dir.path()), None);
    }

    #[test]
    fn persist_last_workspace_overwrites_previous() {
        let dir = tempfile::tempdir().unwrap();
        persist_last_workspace(dir.path(), "/old/path").unwrap();
        persist_last_workspace(dir.path(), "/new/path").unwrap();
        assert_eq!(
            read_last_workspace(dir.path()),
            Some("/new/path".to_string())
        );
    }

    #[test]
    fn read_last_workspace_returns_none_for_empty_file() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("last-workspace"), "").unwrap();
        assert_eq!(read_last_workspace(dir.path()), None);
    }

    #[test]
    fn read_last_workspace_trims_whitespace() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("last-workspace"), "  /my/vault  \n").unwrap();
        assert_eq!(
            read_last_workspace(dir.path()),
            Some("/my/vault".to_string())
        );
    }

    fn make_startup_context(
        pending_ws: Option<&str>,
        pending_file: Option<&str>,
        pending_line: Option<u32>,
        pending_col: Option<u32>,
        initial_ws: Option<&str>,
        initial_file: Option<&str>,
        initial_line: Option<u32>,
        initial_col: Option<u32>,
        label: &str,
    ) -> StartupContext {
        let mut pw = HashMap::new();
        if let Some(v) = pending_ws {
            pw.insert(label.to_string(), v.to_string());
        }
        let mut pf = HashMap::new();
        if let Some(v) = pending_file {
            pf.insert(label.to_string(), v.to_string());
        }
        let mut pl = HashMap::new();
        if let Some(v) = pending_line {
            pl.insert(label.to_string(), v);
        }
        let mut pc = HashMap::new();
        if let Some(v) = pending_col {
            pc.insert(label.to_string(), v);
        }

        let pws = PendingWorkspaces(Mutex::new(pw));
        let pfs = PendingFiles(Mutex::new(pf));
        let pls = PendingLines(Mutex::new(pl));
        let pcs = PendingCols(Mutex::new(pc));
        let iws = InitialWorkspace(Mutex::new(initial_ws.map(|s| s.to_string())));
        let ifs = InitialFile(Mutex::new(initial_file.map(|s| s.to_string())));
        let ils = InitialLine(Mutex::new(initial_line));
        let ics = InitialCol(Mutex::new(initial_col));

        let workspace = pws.0.lock().unwrap().remove(label);
        if workspace.is_some() {
            return StartupContext {
                workspace,
                file: pfs.0.lock().unwrap().remove(label),
                line: pls.0.lock().unwrap().remove(label),
                col: pcs.0.lock().unwrap().remove(label),
            };
        }
        let workspace = iws.0.lock().unwrap().take();
        let file = ifs.0.lock().unwrap().take();
        let line = ils.0.lock().unwrap().take();
        let col = ics.0.lock().unwrap().take();
        StartupContext { workspace, file, line, col }
    }

    #[test]
    fn startup_context_pending_wins_over_initial() {
        let ctx = make_startup_context(
            Some("/pending/vault"),
            Some("pending.md"),
            Some(10),
            Some(5),
            Some("/initial/vault"),
            Some("initial.md"),
            Some(1),
            Some(1),
            "main",
        );
        assert_eq!(ctx, StartupContext {
            workspace: Some("/pending/vault".to_string()),
            file: Some("pending.md".to_string()),
            line: Some(10),
            col: Some(5),
        });
    }

    #[test]
    fn startup_context_falls_back_to_initial() {
        let ctx = make_startup_context(
            None, None, None, None,
            Some("/initial/vault"),
            Some("initial.md"),
            Some(42),
            Some(7),
            "main",
        );
        assert_eq!(ctx, StartupContext {
            workspace: Some("/initial/vault".to_string()),
            file: Some("initial.md".to_string()),
            line: Some(42),
            col: Some(7),
        });
    }

    #[test]
    fn startup_context_returns_all_none_when_empty() {
        let ctx = make_startup_context(
            None, None, None, None,
            None, None, None, None,
            "main",
        );
        assert_eq!(ctx, StartupContext {
            workspace: None,
            file: None,
            line: None,
            col: None,
        });
    }

    #[test]
    fn startup_context_pending_workspace_only() {
        let ctx = make_startup_context(
            Some("/pending/vault"),
            None, None, None,
            Some("/initial/vault"),
            Some("initial.md"),
            Some(1),
            Some(1),
            "main",
        );
        assert_eq!(ctx.workspace, Some("/pending/vault".to_string()));
        assert_eq!(ctx.file, None);
        assert_eq!(ctx.line, None);
        assert_eq!(ctx.col, None);
    }
}
