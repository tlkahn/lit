use crate::commands::graph::GraphRegistry;
use crate::commands::workspace::{get_workspace_root, WorkspaceRegistry};
use crate::workspace::trash;
use crate::workspace::trash::TrashEntry;
use crate::workspace::write_hash::WriteHashRegistry;
use std::sync::Arc;
use tauri::State;

#[tauri::command]
pub fn trash_page(
    relative_path: String,
    window: tauri::Window,
    state: State<WorkspaceRegistry>,
    registry: State<Arc<WriteHashRegistry>>,
    graph_state: State<Arc<GraphRegistry>>,
    app_handle: tauri::AppHandle,
) -> Result<TrashEntry, String> {
    let root = get_workspace_root(&state, window.label())?;
    let entry = trash::trash_page(&root, &relative_path).map_err(|e| e.to_string())?;

    registry.record_delete(&root.join(&relative_path));

    let indices = graph_state.indices.lock().unwrap();
    if let Some(gi) = indices.get(&root) {
        let ann_enabled = crate::preferences::annotations_enabled(&app_handle);
        let result = gi.remove_file(&relative_path, ann_enabled);
        drop(indices);
        crate::commands::graph::emit_reindex_result(&app_handle, result);
    }

    Ok(entry)
}

#[tauri::command]
pub fn restore_page(
    trash_name: String,
    window: tauri::Window,
    state: State<WorkspaceRegistry>,
    registry: State<Arc<WriteHashRegistry>>,
    graph_state: State<Arc<GraphRegistry>>,
    app_handle: tauri::AppHandle,
) -> Result<String, String> {
    let root = get_workspace_root(&state, window.label())?;
    let original_path = trash::restore_page(&root, &trash_name).map_err(|e| e.to_string())?;

    let dest = root.join(&original_path);
    let content = std::fs::read_to_string(&dest).unwrap_or_default();
    registry.record(&dest, &content);

    let indices = graph_state.indices.lock().unwrap();
    if let Some(gi) = indices.get(&root) {
        let ann_enabled = crate::preferences::annotations_enabled(&app_handle);
        let result = gi.add_file(&original_path, ann_enabled);
        drop(indices);
        crate::commands::graph::emit_reindex_result(&app_handle, result);
    }

    Ok(original_path)
}

#[tauri::command]
pub fn purge_page(
    trash_name: String,
    window: tauri::Window,
    state: State<WorkspaceRegistry>,
) -> Result<(), String> {
    let root = get_workspace_root(&state, window.label())?;
    trash::purge_page(&root, &trash_name).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_trash(
    window: tauri::Window,
    state: State<WorkspaceRegistry>,
) -> Result<Vec<TrashEntry>, String> {
    let root = get_workspace_root(&state, window.label())?;
    trash::list_trash(&root).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn empty_trash(
    window: tauri::Window,
    state: State<WorkspaceRegistry>,
) -> Result<(), String> {
    let root = get_workspace_root(&state, window.label())?;
    trash::empty_trash(&root).map_err(|e| e.to_string())
}
