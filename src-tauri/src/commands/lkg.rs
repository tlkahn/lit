use crate::commands::graph::GraphRegistry;
use crate::commands::workspace::{get_workspace_root, WorkspaceRegistry};
use crate::lkg::export::export_lkg as run_export_lkg;
use crate::lkg::types::{LkgExportSummary, LkgImportSummary};
use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::{Emitter, State};

pub struct LkgExportState {
    active: Mutex<HashSet<PathBuf>>,
}

impl LkgExportState {
    pub fn new() -> Self {
        Self {
            active: Mutex::new(HashSet::new()),
        }
    }

    pub fn is_active(&self, workspace: &PathBuf) -> bool {
        self.active.lock().unwrap().contains(workspace)
    }

    pub fn try_acquire(&self, workspace: &PathBuf) -> Result<(), String> {
        let mut set = self.active.lock().unwrap();
        if set.contains(workspace) {
            Err(format!(
                "Export already in progress for {}",
                workspace.display()
            ))
        } else {
            set.insert(workspace.clone());
            Ok(())
        }
    }

    pub fn release(&self, workspace: &PathBuf) {
        self.active.lock().unwrap().remove(workspace);
    }
}

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
    export_state: State<'_, LkgExportState>,
) -> Result<LkgExportSummary, String> {
    let root_path = get_workspace_root(&state, window.label())?;
    export_state.try_acquire(&root_path)?;
    let release_path = root_path.clone();

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

    let result = tokio::task::spawn_blocking(move || {
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
    .map_err(|e| e.to_string());

    export_state.release(&release_path);

    let summary = result??;
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

    use super::LkgExportState;
    use crate::graph::indexer::GraphIndex;
    use std::path::PathBuf;

    #[test]
    fn new_export_state_has_no_active_workspace() {
        let state = LkgExportState::new();
        assert!(!state.is_active(&PathBuf::from("/workspace/a")));
    }

    #[test]
    fn try_acquire_marks_workspace_as_active() {
        let state = LkgExportState::new();
        let path = PathBuf::from("/workspace/a");
        assert!(state.try_acquire(&path).is_ok());
        assert!(state.is_active(&path));
    }

    #[test]
    fn try_acquire_returns_err_when_already_active() {
        let state = LkgExportState::new();
        let path = PathBuf::from("/workspace/a");
        state.try_acquire(&path).unwrap();
        assert!(state.try_acquire(&path).is_err());
    }

    #[test]
    fn release_allows_re_acquisition() {
        let state = LkgExportState::new();
        let path = PathBuf::from("/workspace/a");
        state.try_acquire(&path).unwrap();
        state.release(&path);
        assert!(state.try_acquire(&path).is_ok());
    }

    #[test]
    fn different_workspaces_can_export_concurrently() {
        let state = LkgExportState::new();
        let a = PathBuf::from("/workspace/a");
        let b = PathBuf::from("/workspace/b");
        assert!(state.try_acquire(&a).is_ok());
        assert!(state.try_acquire(&b).is_ok());
    }

    #[test]
    fn release_is_idempotent() {
        let state = LkgExportState::new();
        let path = PathBuf::from("/workspace/a");
        state.try_acquire(&path).unwrap();
        state.release(&path);
        state.release(&path);
    }

    #[test]
    fn concurrent_acquire_exactly_one_succeeds() {
        use std::sync::{Arc, Barrier};

        for _round in 0..5 {
            let state = Arc::new(LkgExportState::new());
            let barrier = Arc::new(Barrier::new(2));
            let path = PathBuf::from("/workspace/race");

            let s1 = Arc::clone(&state);
            let b1 = Arc::clone(&barrier);
            let p1 = path.clone();
            let s2 = Arc::clone(&state);
            let b2 = Arc::clone(&barrier);
            let p2 = path.clone();

            let (r1, r2) = std::thread::scope(|s| {
                let h1 = s.spawn(move || {
                    b1.wait();
                    s1.try_acquire(&p1)
                });
                let h2 = s.spawn(move || {
                    b2.wait();
                    s2.try_acquire(&p2)
                });
                (h1.join().unwrap(), h2.join().unwrap())
            });

            let ok_count = [&r1, &r2].iter().filter(|r| r.is_ok()).count();
            assert_eq!(
                ok_count, 1,
                "Exactly one acquire must succeed, got {ok_count}.\n  r1={r1:?}\n  r2={r2:?}"
            );
        }
    }

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
