use crate::commands::graph::GraphRegistry;
use crate::commands::oplog::OpLogRegistry;
use crate::commands::workspace::{get_workspace_root, WorkspaceRegistry};
use crate::oplog::store::Action;
use crate::workspace::ops;
use crate::workspace::page::{PageContent, PageMeta};
use crate::workspace::write_hash::WriteHashRegistry;
use indexmap::IndexMap;
use std::sync::Arc;
use tauri::State;

#[tauri::command]
pub fn parse_raw_yaml(raw_yaml: String) -> Result<IndexMap<String, serde_yaml::Value>, String> {
    crate::workspace::frontmatter::parse_raw_yaml(&raw_yaml)
}

#[tauri::command]
pub fn read_page(
    relative_path: String,
    window: tauri::Window,
    state: State<WorkspaceRegistry>,
    registry: State<Arc<WriteHashRegistry>>,
) -> Result<PageContent, String> {
    let root = get_workspace_root(&state, window.label())?;
    ops::read_page(&root, &relative_path, &registry).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn write_page(
    relative_path: String,
    body: String,
    frontmatter: IndexMap<String, serde_yaml::Value>,
    window: tauri::Window,
    state: State<WorkspaceRegistry>,
    registry: State<Arc<WriteHashRegistry>>,
    graph_state: State<Arc<GraphRegistry>>,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    let root = get_workspace_root(&state, window.label())?;
    ops::write_page(&root, &relative_path, &body, &frontmatter, &registry).map_err(|e| e.to_string())?;

    let indices = graph_state.indices.lock().unwrap();
    if let Some(gi) = indices.get(&root) {
        let ann_enabled = crate::preferences::annotations_enabled(&app_handle);
        let _ = gi.reindex_file(&relative_path, ann_enabled);
    }

    Ok(())
}

#[tauri::command]
pub fn create_page(
    name: String,
    parent_dir: Option<String>,
    window: tauri::Window,
    state: State<WorkspaceRegistry>,
    oplog_state: State<Arc<OpLogRegistry>>,
) -> Result<PageMeta, String> {
    let root = get_workspace_root(&state, window.label())?;
    let meta = ops::create_page(&root, &name, parent_dir.as_deref()).map_err(|e| e.to_string())?;

    if let Ok(oplog) = oplog_state.get_oplog(&root) {
        let store = oplog.lock().unwrap();
        let _ = store.record_operation(
            "create_page",
            &format!("Create '{name}'"),
            &[Action {
                seq: 0,
                action_type: "create_file".into(),
                path: meta.relative_path.clone(),
                old_path: None,
                before_content: None,
                after_content: Some(String::new()),
            }],
        );
    }

    Ok(meta)
}

#[tauri::command]
pub fn rename_page(
    old_path: String,
    new_name: String,
    window: tauri::Window,
    state: State<WorkspaceRegistry>,
    oplog_state: State<Arc<OpLogRegistry>>,
) -> Result<String, String> {
    let root = get_workspace_root(&state, window.label())?;
    let new_path = ops::rename_page(&root, &old_path, &new_name).map_err(|e| e.to_string())?;

    if let Ok(oplog) = oplog_state.get_oplog(&root) {
        let store = oplog.lock().unwrap();
        let _ = store.record_operation(
            "rename_page",
            &format!("Rename '{old_path}' to '{new_name}'"),
            &[Action {
                seq: 0,
                action_type: "rename_file".into(),
                path: new_path.clone(),
                old_path: Some(old_path),
                before_content: None,
                after_content: None,
            }],
        );
    }

    Ok(new_path)
}

#[tauri::command]
pub fn delete_page(
    relative_path: String,
    window: tauri::Window,
    state: State<WorkspaceRegistry>,
    oplog_state: State<Arc<OpLogRegistry>>,
) -> Result<(), String> {
    let root = get_workspace_root(&state, window.label())?;

    let before_content = std::fs::read_to_string(root.join(&relative_path)).ok();

    ops::delete_page(&root, &relative_path).map_err(|e| e.to_string())?;

    if let Ok(oplog) = oplog_state.get_oplog(&root) {
        let store = oplog.lock().unwrap();
        let _ = store.record_operation(
            "delete_page",
            &format!("Delete '{relative_path}'"),
            &[Action {
                seq: 0,
                action_type: "delete_file".into(),
                path: relative_path,
                old_path: None,
                before_content,
                after_content: None,
            }],
        );
    }

    Ok(())
}

#[tauri::command]
pub fn acknowledge_file_hash(
    relative_path: String,
    window: tauri::Window,
    state: State<WorkspaceRegistry>,
    registry: State<Arc<WriteHashRegistry>>,
) -> Result<(), String> {
    let root = get_workspace_root(&state, window.label())?;
    ops::acknowledge_file_hash(&root, &relative_path, &registry).map_err(|e| e.to_string())
}
