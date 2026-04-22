use crate::commands::workspace::{get_workspace_root, WorkspaceRegistry};
use crate::workspace::ops;
use crate::workspace::page::{PageContent, PageMeta};
use crate::workspace::write_hash::WriteHashRegistry;
use std::collections::HashMap;
use std::sync::Arc;
use tauri::State;

#[tauri::command]
pub fn parse_raw_yaml(raw_yaml: String) -> Result<HashMap<String, serde_yaml::Value>, String> {
    crate::workspace::frontmatter::parse_raw_yaml(&raw_yaml)
}

#[tauri::command]
pub fn read_page(
    relative_path: String,
    window: tauri::Window,
    state: State<WorkspaceRegistry>,
) -> Result<PageContent, String> {
    let root = get_workspace_root(&state, window.label())?;
    ops::read_page(&root, &relative_path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn write_page(
    relative_path: String,
    body: String,
    frontmatter: HashMap<String, serde_yaml::Value>,
    window: tauri::Window,
    state: State<WorkspaceRegistry>,
    registry: State<Arc<WriteHashRegistry>>,
) -> Result<(), String> {
    let root = get_workspace_root(&state, window.label())?;
    ops::write_page(&root, &relative_path, &body, &frontmatter, &registry).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_page(
    name: String,
    parent_dir: Option<String>,
    window: tauri::Window,
    state: State<WorkspaceRegistry>,
) -> Result<PageMeta, String> {
    let root = get_workspace_root(&state, window.label())?;
    ops::create_page(&root, &name, parent_dir.as_deref()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn rename_page(
    old_path: String,
    new_name: String,
    window: tauri::Window,
    state: State<WorkspaceRegistry>,
) -> Result<String, String> {
    let root = get_workspace_root(&state, window.label())?;
    ops::rename_page(&root, &old_path, &new_name).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_page(
    relative_path: String,
    window: tauri::Window,
    state: State<WorkspaceRegistry>,
) -> Result<(), String> {
    let root = get_workspace_root(&state, window.label())?;
    ops::delete_page(&root, &relative_path).map_err(|e| e.to_string())
}
