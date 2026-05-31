use crate::commands::graph::GraphRegistry;
use crate::commands::workspace::{get_workspace_root, WorkspaceRegistry};
use crate::workspace::trash;
use crate::workspace::trash::TrashEntry;
use crate::workspace::write_hash::WriteHashRegistry;
use std::path::Path;
use std::sync::Arc;
use tauri::State;

fn read_and_record(path: &Path, registry: &WriteHashRegistry) -> Result<(), String> {
    let content = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
    registry.record(path, &content);
    Ok(())
}

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

    super::page::reindex_and_emit(&graph_state, &app_handle, &root, |gi, ann| {
        gi.remove_file(&relative_path, ann)
    });

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
    read_and_record(&dest, &registry)?;

    super::page::reindex_and_emit(&graph_state, &app_handle, &root, |gi, ann| {
        gi.add_file(&original_path, ann)
    });

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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn read_and_record_propagates_error_for_missing_file() {
        let registry = WriteHashRegistry::new();
        let result = read_and_record(Path::new("/nonexistent/path.md"), &registry);
        assert!(result.is_err());
    }

    #[test]
    fn read_and_record_succeeds_for_existing_file() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("test.md");
        std::fs::write(&file, "hello").unwrap();
        let registry = WriteHashRegistry::new();

        let result = read_and_record(&file, &registry);
        assert!(result.is_ok());
        assert!(registry.check(&file, "hello"));
    }
}
