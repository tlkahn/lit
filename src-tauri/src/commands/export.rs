use crate::commands::workspace::{get_workspace_root, WorkspaceRegistry};
use crate::export::{run_export, ExportProgress, ExportSummary};
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
