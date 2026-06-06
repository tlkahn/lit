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

    pub fn try_acquire(&self, path: &PathBuf) -> Result<(), String> {
        let mut active = self.active.lock().unwrap();
        if active.contains(path) {
            return Err(format!(
                "An export is already in progress for {}",
                path.display()
            ));
        }
        active.insert(path.clone());
        Ok(())
    }

    pub fn release(&self, path: &PathBuf) {
        let mut active = self.active.lock().unwrap();
        active.remove(path);
    }

    #[cfg(test)]
    pub fn is_active(&self, path: &PathBuf) -> bool {
        let active = self.active.lock().unwrap();
        active.contains(path)
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
                let _ = win.emit_to(win.label(), "lit:lkg-export-progress", LkgExportProgress { current, total });
            },
        )
    })
    .await
    .map_err(|e| e.to_string());

    export_state.release(&release_path);
    let summary = result??;

    let _ = window.emit_to(window.label(), "lit:lkg-export-complete", &summary);
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

    let _ = window.emit_to(window.label(), "lit:lkg-import-complete", &summary);
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
        assert!(!state.is_active(&PathBuf::from("/workspace")));
    }

    #[test]
    fn try_acquire_marks_workspace_as_active() {
        let state = LkgExportState::new();
        let path = PathBuf::from("/workspace");
        assert!(state.try_acquire(&path).is_ok());
        assert!(state.is_active(&path));
    }

    #[test]
    fn try_acquire_returns_err_when_already_active() {
        let state = LkgExportState::new();
        let path = PathBuf::from("/workspace");
        assert!(state.try_acquire(&path).is_ok());
        assert!(state.try_acquire(&path).is_err());
    }

    #[test]
    fn release_allows_re_acquisition() {
        let state = LkgExportState::new();
        let path = PathBuf::from("/workspace");
        state.try_acquire(&path).unwrap();
        state.release(&path);
        assert!(!state.is_active(&path));
        assert!(state.try_acquire(&path).is_ok());
    }

    #[test]
    fn different_workspaces_can_export_concurrently() {
        let state = LkgExportState::new();
        let a = PathBuf::from("/workspace-a");
        let b = PathBuf::from("/workspace-b");
        assert!(state.try_acquire(&a).is_ok());
        assert!(state.try_acquire(&b).is_ok());
        assert!(state.is_active(&a));
        assert!(state.is_active(&b));
    }

    #[test]
    fn release_is_idempotent() {
        let state = LkgExportState::new();
        let path = PathBuf::from("/workspace");
        state.try_acquire(&path).unwrap();
        state.release(&path);
        state.release(&path);
        assert!(!state.is_active(&path));
    }

    #[test]
    fn concurrent_acquire_exactly_one_succeeds() {
        use std::sync::{Arc, Barrier};
        let state = Arc::new(LkgExportState::new());
        let barrier = Arc::new(Barrier::new(2));
        let path = PathBuf::from("/workspace");

        let s1 = Arc::clone(&state);
        let b1 = Arc::clone(&barrier);
        let p1 = path.clone();
        let t1 = std::thread::spawn(move || {
            b1.wait();
            s1.try_acquire(&p1)
        });

        let s2 = Arc::clone(&state);
        let b2 = Arc::clone(&barrier);
        let p2 = path.clone();
        let t2 = std::thread::spawn(move || {
            b2.wait();
            s2.try_acquire(&p2)
        });

        let r1 = t1.join().unwrap();
        let r2 = t2.join().unwrap();

        let successes = [r1.is_ok(), r2.is_ok()].iter().filter(|&&v| v).count();
        assert_eq!(successes, 1, "exactly one thread should acquire the lock");
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
