use crate::commands::workspace::{get_workspace_root, WorkspaceRegistry};
use crate::export::{collect_export_files, write_zip, ExportSummary};
use tauri::{Emitter, State};

#[derive(Clone, serde::Serialize)]
struct ExportProgress {
    current: usize,
    total: usize,
}

#[tauri::command]
pub async fn export_data(
    destination: String,
    window: tauri::Window,
    state: State<'_, WorkspaceRegistry>,
) -> Result<ExportSummary, String> {
    let root_path = get_workspace_root(&state, window.label())?;
    let dest = std::path::PathBuf::from(&destination);

    tokio::task::spawn_blocking(move || {
        let entries = collect_export_files(&root_path)?;
        write_zip(&entries, &dest, |current, total| {
            let _ = window.emit("lit:export-progress", ExportProgress { current, total });
        })
    })
    .await
    .map_err(|e| e.to_string())?
}
