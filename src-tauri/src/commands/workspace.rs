use crate::workspace::page::PageMeta;
use crate::workspace::scan::scan_pages;
use crate::workspace::watcher::FileWatcher;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{Manager, State};

pub struct AppState {
    pub workspace_root: Mutex<Option<PathBuf>>,
    pub watcher: Mutex<Option<FileWatcher>>,
}

#[tauri::command]
pub fn open_workspace(
    path: String,
    state: State<AppState>,
    app_handle: tauri::AppHandle,
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

    let watcher = FileWatcher::new(root.clone(), app_handle).ok();

    *state.workspace_root.lock().unwrap() = Some(root);
    *state.watcher.lock().unwrap() = watcher;

    Ok(pages)
}

#[tauri::command]
pub fn list_pages(state: State<AppState>) -> Result<Vec<PageMeta>, String> {
    let root = state.workspace_root.lock().unwrap();
    let root = root.as_ref().ok_or("No workspace is open")?;
    scan_pages(root).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_workspace_path(state: State<AppState>) -> Result<Option<String>, String> {
    let root = state.workspace_root.lock().unwrap();
    Ok(root.as_ref().map(|p| p.to_string_lossy().to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn app_state_default_is_none() {
        let state = AppState {
            workspace_root: Mutex::new(None),
            watcher: Mutex::new(None),
        };
        assert!(state.workspace_root.lock().unwrap().is_none());
    }
}
