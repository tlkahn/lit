use crate::workspace::page::PageMeta;
use crate::workspace::scan::scan_pages;
use crate::workspace::watcher::FileWatcher;
use crate::workspace::write_hash::WriteHashRegistry;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{Manager, State, WebviewWindowBuilder};

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
        app_handle,
        Arc::clone(&registry),
    )
    .ok();

    state.workspaces.lock().unwrap().insert(
        label,
        WorkspaceEntry {
            root,
            watcher,
        },
    );

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
    let mut builder = WebviewWindowBuilder::new(app_handle, &label, tauri::WebviewUrl::default())
        .title("Lit")
        .inner_size(1024.0, 768.0);

    if let Some(script) = crate::cli::cli_init_script(&path, &file) {
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
    create_workspace_window(&app_handle, path, None)
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
}
