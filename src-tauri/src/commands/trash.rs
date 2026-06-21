use crate::commands::graph::GraphRegistry;
use crate::commands::workspace::{get_workspace_root, WorkspaceRegistry};
use crate::workspace::trash;
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
) -> Result<(), String> {
    let root = get_workspace_root(&state, window.label())?;
    trash::trash_page(&root, &relative_path).map_err(|e| e.to_string())?;

    registry.record_delete(&root.join(&relative_path));

    super::page::reindex_and_emit(&graph_state, &app_handle, &root, |gi, ann| {
        gi.remove_file(&relative_path, ann)
    });

    Ok(())
}
