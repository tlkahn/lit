use crate::commands::workspace::{get_workspace_root, WorkspaceRegistry};
use crate::oplog::store::{OpLogStore, OperationSummary};
use crate::oplog::undo::execute_undo;
use crate::workspace::write_hash::WriteHashRegistry;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::State;

pub struct OpLogRegistry {
    pub logs: Mutex<HashMap<PathBuf, Arc<Mutex<OpLogStore>>>>,
}

impl OpLogRegistry {
    pub fn new() -> Self {
        Self {
            logs: Mutex::new(HashMap::new()),
        }
    }

    pub fn get_oplog(&self, root: &PathBuf) -> Result<Arc<Mutex<OpLogStore>>, String> {
        let mut logs = self.logs.lock().unwrap();
        if let Some(store) = logs.get(root) {
            return Ok(Arc::clone(store));
        }

        let lit_dir = root.join(".lit");
        std::fs::create_dir_all(&lit_dir).map_err(|e| e.to_string())?;
        let db_path = lit_dir.join("oplog.db");
        let store = OpLogStore::open(&db_path).map_err(|e| e.to_string())?;
        let arc = Arc::new(Mutex::new(store));
        logs.insert(root.clone(), Arc::clone(&arc));
        Ok(arc)
    }
}

#[tauri::command]
pub fn undo_last_operation(
    window: tauri::Window,
    state: State<WorkspaceRegistry>,
    oplog_state: State<Arc<OpLogRegistry>>,
    write_hash_registry: State<Arc<WriteHashRegistry>>,
) -> Result<String, String> {
    let root = get_workspace_root(&state, window.label())?;
    let oplog = oplog_state.get_oplog(&root)?;
    let store = oplog.lock().unwrap();
    let operation = store.pop_latest().map_err(|e| e.to_string())?;
    let description = operation.description.clone();
    execute_undo(&root, &operation, &write_hash_registry).map_err(|e| e.to_string())?;
    Ok(description)
}

#[tauri::command]
pub fn list_undo_history(
    limit: Option<i64>,
    window: tauri::Window,
    state: State<WorkspaceRegistry>,
    oplog_state: State<Arc<OpLogRegistry>>,
) -> Result<Vec<OperationSummary>, String> {
    let root = get_workspace_root(&state, window.label())?;
    let oplog = oplog_state.get_oplog(&root)?;
    let store = oplog.lock().unwrap();
    store
        .list_operations(limit.unwrap_or(50))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn can_undo(
    window: tauri::Window,
    state: State<WorkspaceRegistry>,
    oplog_state: State<Arc<OpLogRegistry>>,
) -> Result<bool, String> {
    let root = get_workspace_root(&state, window.label())?;
    let oplog = oplog_state.get_oplog(&root)?;
    let store = oplog.lock().unwrap();
    let has_ops = store
        .latest_operation()
        .map_err(|e| e.to_string())?
        .is_some();
    Ok(has_ops)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::oplog::store::{Action, OpLogStore};

    // --- Cycle 9: OpLogRegistry ---

    #[test]
    fn get_oplog_creates_store_on_first_access() {
        let dir = tempfile::tempdir().unwrap();
        let registry = OpLogRegistry::new();
        let root = dir.path().to_path_buf();

        let oplog = registry.get_oplog(&root).unwrap();
        let store = oplog.lock().unwrap();
        assert_eq!(store.schema_version().unwrap(), 1);
        assert!(dir.path().join(".lit/oplog.db").exists());
    }

    #[test]
    fn get_oplog_returns_same_instance() {
        let dir = tempfile::tempdir().unwrap();
        let registry = OpLogRegistry::new();
        let root = dir.path().to_path_buf();

        let a = registry.get_oplog(&root).unwrap();
        let b = registry.get_oplog(&root).unwrap();
        assert!(Arc::ptr_eq(&a, &b));
    }

    // --- Cycle 10: command logic (unit-level, no Tauri harness) ---

    #[test]
    fn undo_pops_and_reverses() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().to_path_buf();
        let write_hash = WriteHashRegistry::new();

        std::fs::write(root.join("created.md"), "").unwrap();

        let store = OpLogStore::open_memory().unwrap();
        store
            .record_operation(
                "create_page",
                "Create 'created'",
                &[Action {
                    seq: 0,
                    action_type: "create_file".into(),
                    path: "created.md".into(),
                    old_path: None,
                    before_content: None,
                    after_content: Some("".into()),
                }],
            )
            .unwrap();

        let op = store.pop_latest().unwrap();
        execute_undo(&root, &op, &write_hash).unwrap();
        assert!(!root.join("created.md").exists());
    }

    #[test]
    fn list_history_returns_summaries() {
        let store = OpLogStore::open_memory().unwrap();
        store
            .record_operation(
                "create_page",
                "Create A",
                &[Action {
                    seq: 0,
                    action_type: "create_file".into(),
                    path: "a.md".into(),
                    old_path: None,
                    before_content: None,
                    after_content: None,
                }],
            )
            .unwrap();

        let summaries = store.list_operations(50).unwrap();
        assert_eq!(summaries.len(), 1);
        assert_eq!(summaries[0].description, "Create A");
        assert_eq!(summaries[0].op_type, "create_page");
    }

    #[test]
    fn can_undo_empty_false() {
        let store = OpLogStore::open_memory().unwrap();
        assert!(store.latest_operation().unwrap().is_none());
    }

    #[test]
    fn can_undo_with_ops_true() {
        let store = OpLogStore::open_memory().unwrap();
        store
            .record_operation(
                "create_page",
                "Create A",
                &[Action {
                    seq: 0,
                    action_type: "create_file".into(),
                    path: "a.md".into(),
                    old_path: None,
                    before_content: None,
                    after_content: None,
                }],
            )
            .unwrap();
        assert!(store.latest_operation().unwrap().is_some());
    }
}
