use crate::commands::workspace::AppState;
use crate::workspace::ops;
use crate::workspace::page::{PageContent, PageMeta};
use std::collections::HashMap;
use tauri::State;

#[tauri::command]
pub fn read_page(
    relative_path: String,
    state: State<AppState>,
) -> Result<PageContent, String> {
    let root = state.workspace_root.lock().unwrap();
    let root = root.as_ref().ok_or("No workspace is open")?;
    ops::read_page(root, &relative_path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn write_page(
    relative_path: String,
    body: String,
    frontmatter: HashMap<String, serde_yaml::Value>,
    state: State<AppState>,
) -> Result<(), String> {
    let root = state.workspace_root.lock().unwrap();
    let root = root.as_ref().ok_or("No workspace is open")?;
    ops::write_page(root, &relative_path, &body, &frontmatter).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_page(
    name: String,
    parent_dir: Option<String>,
    state: State<AppState>,
) -> Result<PageMeta, String> {
    let root = state.workspace_root.lock().unwrap();
    let root = root.as_ref().ok_or("No workspace is open")?;
    ops::create_page(root, &name, parent_dir.as_deref()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn rename_page(
    old_path: String,
    new_name: String,
    state: State<AppState>,
) -> Result<String, String> {
    let root = state.workspace_root.lock().unwrap();
    let root = root.as_ref().ok_or("No workspace is open")?;
    ops::rename_page(root, &old_path, &new_name).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_page(
    relative_path: String,
    state: State<AppState>,
) -> Result<(), String> {
    let root = state.workspace_root.lock().unwrap();
    let root = root.as_ref().ok_or("No workspace is open")?;
    ops::delete_page(root, &relative_path).map_err(|e| e.to_string())
}
