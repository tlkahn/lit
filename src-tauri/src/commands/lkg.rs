use crate::commands::graph::GraphRegistry;
use crate::commands::workspace::{get_workspace_root, WorkspaceRegistry};
use crate::lkg::export::export_lkg as run_export_lkg;
use crate::lkg::types::{LkgExportSummary, LkgImportSummary};
use std::path::PathBuf;
use std::sync::Arc;
use tauri::{Emitter, State};

#[derive(Clone, serde::Serialize)]
struct LkgExportProgress {
    current: usize,
    total: usize,
}

#[tauri::command]
pub async fn export_lkg(
    destination: String,
    title: Option<String>,
    description: Option<String>,
    window: tauri::Window,
    state: State<'_, WorkspaceRegistry>,
    graph_state: State<'_, Arc<GraphRegistry>>,
) -> Result<LkgExportSummary, String> {
    let root_path = get_workspace_root(&state, window.label())?;
    let gi = {
        let indices = graph_state.indices.lock().unwrap();
        Arc::clone(
            indices
                .get(&root_path)
                .ok_or_else(|| "No graph index for this workspace".to_string())?,
        )
    };
    let dest = PathBuf::from(&destination);
    let title = title.unwrap_or_else(|| "Knowledge Graph".to_string());
    let win = window.clone();

    let summary = tokio::task::spawn_blocking(move || {
        run_export_lkg(
            &root_path,
            &gi,
            &title,
            description.as_deref(),
            &dest,
            |current, total| {
                let _ = win.emit("lit:lkg-export-progress", LkgExportProgress { current, total });
            },
        )
    })
    .await
    .map_err(|e| e.to_string())??;

    let _ = window.emit("lit:lkg-export-complete", &summary);
    Ok(summary)
}

#[tauri::command]
pub async fn import_lkg(
    source: String,
    destination: String,
    window: tauri::Window,
) -> Result<LkgImportSummary, String> {
    let src = PathBuf::from(&source);
    let dst = PathBuf::from(&destination);

    let summary = tokio::task::spawn_blocking(move || crate::lkg::import::import_lkg(&src, &dst))
        .await
        .map_err(|e| e.to_string())??;

    let _ = window.emit("lit:lkg-import-complete", &summary);
    Ok(summary)
}

#[cfg(test)]
mod tests {
    //! The command bodies themselves require a Tauri Window/State and are not
    //! runtime-unit-tested (consistent with the rest of the codebase, which has
    //! no `tauri::test`/`mock_builder` usage). This test exercises the exact
    //! underlying flow the commands delegate to — `lkg::export::export_lkg`
    //! followed by `lkg::import::import_lkg` — to guard the integration contract.

    use crate::graph::indexer::GraphIndex;

    #[test]
    fn export_then_import_roundtrip_preserves_counts() {
        // A small workspace: a.md links to b and embeds img.png.
        let src_dir = tempfile::tempdir().unwrap();
        let src = src_dir.path();
        std::fs::write(src.join("a.md"), "# A\n\n[[b]]\n\n![](img.png)").unwrap();
        std::fs::write(src.join("b.md"), "# B").unwrap();
        std::fs::write(src.join("img.png"), b"fake png").unwrap();

        let gi = GraphIndex::build(src.to_path_buf(), true).unwrap();
        let bundle = src.join("out.lkg");
        let export_summary =
            crate::lkg::export::export_lkg(src, &gi, "My Graph", Some("desc"), &bundle, |_, _| {})
                .unwrap();

        // Import into a fresh destination.
        let dst_dir = tempfile::tempdir().unwrap();
        let dst = dst_dir.path();
        let import_summary = crate::lkg::import::import_lkg(&bundle, dst).unwrap();

        // Counts line up between the exported workspace and the import summary.
        assert_eq!(import_summary.node_count, 2, "two notes: a.md and b.md");
        assert_eq!(import_summary.edge_count, 1, "a.md links to b");
        assert_eq!(
            import_summary.file_count, export_summary.exported_count,
            "every exported content file is re-extracted on import"
        );

        // The store database lands at <dest>/.lit/graph.db.
        assert!(
            dst.join(".lit").join("graph.db").exists(),
            "import must create the graph store at .lit/graph.db"
        );
    }
}
