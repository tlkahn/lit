use crate::commands::graph::GraphRegistry;
use crate::commands::workspace::{get_workspace_root, WorkspaceRegistry};
use crate::export::{run_export, run_subgraph_export, ExportProgress, ExportSummary};
use std::sync::Arc;
use tauri::{Emitter, State};

#[tauri::command]
pub async fn export_data(
    destination: String,
    window: tauri::Window,
    state: State<'_, WorkspaceRegistry>,
) -> Result<ExportSummary, String> {
    let root_path = get_workspace_root(&state, window.label())?;
    let dest = std::path::PathBuf::from(&destination);
    let win = window.clone();

    let summary = tokio::task::spawn_blocking(move || {
        run_export(&root_path, &dest, |current, total| {
            let _ = win.emit("lit:export-progress", ExportProgress { current, total });
        })
    })
    .await
    .map_err(|e| e.to_string())??;

    let _ = window.emit("lit:export-complete", &summary);
    Ok(summary)
}

#[tauri::command]
pub async fn export_subgraph(
    node_id: String,
    depth: usize,
    destination: String,
    window: tauri::Window,
    state: State<'_, WorkspaceRegistry>,
    graph_state: State<'_, Arc<GraphRegistry>>,
) -> Result<ExportSummary, String> {
    let root_path = get_workspace_root(&state, window.label())?;
    let gi = {
        let indices = graph_state.indices.lock().unwrap();
        Arc::clone(
            indices
                .get(&root_path)
                .ok_or_else(|| "No graph index for this workspace".to_string())?,
        )
    };
    let dest = std::path::PathBuf::from(&destination);
    let win = window.clone();

    let summary = tokio::task::spawn_blocking(move || {
        run_subgraph_export(&root_path, &gi, &node_id, depth, &dest, |current, total| {
            let _ = win.emit("lit:export-progress", ExportProgress { current, total });
        })
    })
    .await
    .map_err(|e| e.to_string())??;

    let _ = window.emit("lit:export-complete", &summary);
    Ok(summary)
}
