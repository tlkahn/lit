use crate::commands::graph::GraphRegistry;
use crate::commands::workspace::{get_workspace_backend, WorkspaceRegistry};
use crate::lkg::export::export_lkg_with_backend as run_export_lkg_with_backend;
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

    /// Acquire the export lock, returning a guard that auto-releases on drop.
    pub fn try_acquire(&self, path: &PathBuf) -> Result<LkgExportGuard<'_>, String> {
        let mut active = self.active.lock().unwrap();
        if active.contains(path) {
            return Err(format!(
                "An export is already in progress for {}",
                path.display()
            ));
        }
        active.insert(path.clone());
        Ok(LkgExportGuard {
            state: self,
            path: path.clone(),
        })
    }

    fn release(&self, path: &PathBuf) {
        let mut active = self.active.lock().unwrap();
        active.remove(path);
    }

    #[cfg(test)]
    pub fn is_active(&self, path: &PathBuf) -> bool {
        let active = self.active.lock().unwrap();
        active.contains(path)
    }
}

pub struct LkgExportGuard<'a> {
    state: &'a LkgExportState,
    path: PathBuf,
}

impl Drop for LkgExportGuard<'_> {
    fn drop(&mut self) {
        self.state.release(&self.path);
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
    let (root_path, backend) = get_workspace_backend(&state, window.label())?;
    let _guard = export_state.try_acquire(&root_path)?;

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
        run_export_lkg_with_backend(
            &backend,
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

    let summary = result??;

    let _ = window.emit_to(window.label(), "lit:lkg-export-complete", &summary);
    Ok(summary)
}

#[tauri::command]
pub async fn import_lkg(
    source: String,
    destination: String,
    storage_mode: String,
) -> Result<LkgImportSummary, String> {
    let src = PathBuf::from(&source);
    let dst = PathBuf::from(&destination);
    let mode = crate::commands::workspace_config::parse_mode(&storage_mode)?;

    let summary =
        tokio::task::spawn_blocking(move || crate::lkg::import::import_lkg(&src, &dst, mode))
            .await
            .map_err(|e| e.to_string())??;

    // Success is reported via this return value (consumed by the
    // menu://import-lkg handler in src/App.tsx). No completion event is emitted:
    // a redundant `lit:lkg-import-complete` event previously caused a duplicate
    // success toast for a single import.
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
        let _g = state.try_acquire(&path).unwrap();
        assert!(state.is_active(&path));
    }

    #[test]
    fn try_acquire_returns_err_when_already_active() {
        let state = LkgExportState::new();
        let path = PathBuf::from("/workspace");
        let _g = state.try_acquire(&path).unwrap();
        assert!(state.try_acquire(&path).is_err());
    }

    #[test]
    fn release_allows_re_acquisition() {
        let state = LkgExportState::new();
        let path = PathBuf::from("/workspace");
        drop(state.try_acquire(&path).unwrap());
        assert!(!state.is_active(&path));
        let _g = state.try_acquire(&path).unwrap();
        assert!(state.is_active(&path));
    }

    #[test]
    fn different_workspaces_can_export_concurrently() {
        let state = LkgExportState::new();
        let a = PathBuf::from("/workspace-a");
        let b = PathBuf::from("/workspace-b");
        let _ga = state.try_acquire(&a).unwrap();
        let _gb = state.try_acquire(&b).unwrap();
        assert!(state.is_active(&a));
        assert!(state.is_active(&b));
    }

    #[test]
    fn release_is_idempotent() {
        let state = LkgExportState::new();
        let path = PathBuf::from("/workspace");
        // Leak the guard so the entry stays inserted and Drop does not also
        // release; we want to exercise an explicit double `release`.
        std::mem::forget(state.try_acquire(&path).unwrap());
        assert!(state.is_active(&path));
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
            // Forget the guard on success so the entry persists in the active
            // set and the racing thread observes contention (the guard borrows
            // the thread-local Arc, so it cannot be returned across the join).
            match s1.try_acquire(&p1) {
                Ok(g) => {
                    std::mem::forget(g);
                    true
                }
                Err(_) => false,
            }
        });

        let s2 = Arc::clone(&state);
        let b2 = Arc::clone(&barrier);
        let p2 = path.clone();
        let t2 = std::thread::spawn(move || {
            b2.wait();
            match s2.try_acquire(&p2) {
                Ok(g) => {
                    std::mem::forget(g);
                    true
                }
                Err(_) => false,
            }
        });

        let r1 = t1.join().unwrap();
        let r2 = t2.join().unwrap();

        let successes = [r1, r2].iter().filter(|&&v| v).count();
        assert_eq!(successes, 1, "exactly one thread should acquire the lock");
    }

    #[test]
    fn guard_drop_releases_on_scope_exit() {
        let state = LkgExportState::new();
        let path = PathBuf::from("/workspace");
        {
            let _g = state.try_acquire(&path).unwrap();
            assert!(state.is_active(&path));
        }
        assert!(!state.is_active(&path), "guard drop must release the lock");
        // Re-acquisition succeeds after the guard dropped.
        assert!(state.try_acquire(&path).is_ok());
    }

    #[test]
    fn guard_drop_releases_on_early_return() {
        // Simulates the real bug path: a fallible operation acquires the guard,
        // then returns Err early (mimicking the graph-index `ok_or_else`).
        let state = LkgExportState::new();
        let path = PathBuf::from("/workspace");

        let attempt = || -> Result<(), String> {
            let _guard = state.try_acquire(&path)?;
            // Early return before any explicit release would run.
            Err("No graph index for this workspace".to_string())
        };

        assert!(attempt().is_err());
        assert!(
            !state.is_active(&path),
            "guard must release the lock on an early Err return"
        );
        // The leak is gone: a subsequent export can acquire again.
        let _g = state.try_acquire(&path).unwrap();
        assert!(state.is_active(&path));
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
        let import_summary = crate::lkg::import::import_lkg(
            &bundle,
            dst,
            crate::workspace::config::StorageMode::Files,
        )
        .unwrap();

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

    #[test]
    fn export_then_import_db_roundtrip_preserves_counts() {
        use crate::workspace::config::{read_config, StorageMode};
        use crate::workspace::notes_store::NotesStore;

        // A small Files-mode workspace, exported to a bundle.
        let src_dir = tempfile::tempdir().unwrap();
        let src = src_dir.path();
        std::fs::write(src.join("a.md"), "# A\n\n[[b]]\n\n![](img.png)").unwrap();
        std::fs::write(src.join("b.md"), "# B").unwrap();
        std::fs::write(src.join("img.png"), b"fake png").unwrap();

        let gi = GraphIndex::build(src.to_path_buf(), true).unwrap();
        let bundle = src.join("out.lkg");
        crate::lkg::export::export_lkg(src, &gi, "My Graph", Some("desc"), &bundle, |_, _| {})
            .unwrap();

        // Import into a fresh destination IN DB MODE.
        let dst_dir = tempfile::tempdir().unwrap();
        let dst = dst_dir.path().join("imported");
        let import_summary =
            crate::lkg::import::import_lkg(&bundle, &dst, StorageMode::Db).unwrap();

        assert_eq!(import_summary.node_count, 2);
        assert_eq!(import_summary.edge_count, 1);
        // 2 pages + 1 asset.
        assert_eq!(import_summary.file_count, 3);

        // Config is DB; notes.db has the two pages; markdown not on disk.
        assert_eq!(read_config(&dst).storage_mode, StorageMode::Db);
        assert!(!dst.join("a.md").exists());

        let store = NotesStore::open(&dst.join(".lit").join("notes.db")).unwrap();
        assert_eq!(store.list_pages().unwrap().len(), 2);
    }
}
