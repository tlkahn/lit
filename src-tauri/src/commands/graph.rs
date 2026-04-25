use crate::graph::indexer::GraphIndex;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::State;

pub struct GraphRegistry {
    pub indices: Mutex<HashMap<PathBuf, Arc<GraphIndex>>>,
}

impl GraphRegistry {
    pub fn new() -> Self {
        Self {
            indices: Mutex::new(HashMap::new()),
        }
    }
}

#[tauri::command]
pub fn rebuild_graph_index(
    window: tauri::Window,
    workspace_state: State<crate::commands::workspace::WorkspaceRegistry>,
    graph_state: State<Arc<GraphRegistry>>,
) -> Result<String, String> {
    let root = crate::commands::workspace::get_workspace_root(&workspace_state, window.label())?;

    let indices = graph_state.indices.lock().unwrap();
    if let Some(gi) = indices.get(&root) {
        let result = gi.full_rebuild().map_err(|e| e.to_string())?;
        Ok(format!(
            "Rebuilt: {} nodes, {} edges, {} stubs",
            result.nodes_indexed, result.edges_resolved, result.stubs_created
        ))
    } else {
        Err("No graph index for this workspace".into())
    }
}

#[tauri::command]
pub fn get_pagerank(
    window: tauri::Window,
    workspace_state: State<crate::commands::workspace::WorkspaceRegistry>,
    graph_state: State<Arc<GraphRegistry>>,
    n: Option<usize>,
) -> Result<serde_json::Value, String> {
    let root = crate::commands::workspace::get_workspace_root(&workspace_state, window.label())?;

    let indices = graph_state.indices.lock().unwrap();
    let gi = indices
        .get(&root)
        .ok_or_else(|| "No graph index for this workspace".to_string())?;

    match n {
        Some(n) => {
            let top = gi.top_by_pagerank(n).map_err(|e| e.to_string())?;
            serde_json::to_value(top).map_err(|e| e.to_string())
        }
        None => {
            let scores = gi.pagerank().map_err(|e| e.to_string())?;
            serde_json::to_value(scores).map_err(|e| e.to_string())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn graph_registry_insert_and_get() {
        let registry = GraphRegistry::new();
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().to_path_buf();

        std::fs::write(dir.path().join("test.md"), "Content.").unwrap();

        let gi = Arc::new(GraphIndex::build(root.clone()).unwrap());
        registry.indices.lock().unwrap().insert(root.clone(), gi);

        let indices = registry.indices.lock().unwrap();
        assert!(indices.contains_key(&root));
        let stats = indices[&root].stats().unwrap();
        assert_eq!(stats.nodes, 1);
    }

    #[test]
    fn get_pagerank_full_scores() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("a.md"), "[[b]]").unwrap();
        std::fs::write(dir.path().join("b.md"), "Target.").unwrap();
        let gi = GraphIndex::build(dir.path().to_path_buf()).unwrap();
        let scores = gi.pagerank().unwrap();
        assert_eq!(scores.len(), 2);
        let sum: f64 = scores.values().sum();
        assert!((sum - 1.0).abs() < 1e-9);
    }

    #[test]
    fn get_pagerank_top_n() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("a.md"), "[[b]]").unwrap();
        std::fs::write(dir.path().join("b.md"), "Target.").unwrap();
        let gi = GraphIndex::build(dir.path().to_path_buf()).unwrap();
        let top = gi.top_by_pagerank(2).unwrap();
        assert_eq!(top.len(), 2);
        assert!(top[0].1 >= top[1].1);
    }
}
