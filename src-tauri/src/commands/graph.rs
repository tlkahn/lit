use crate::graph::indexer::GraphIndex;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Condvar, Mutex};
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

#[derive(Debug)]
pub enum BuildStatus {
    InProgress,
    Ready,
    Failed(String),
}

pub struct BuildSignal {
    pub status: Mutex<BuildStatus>,
    pub condvar: Condvar,
}

impl BuildSignal {
    fn new() -> Self {
        Self {
            status: Mutex::new(BuildStatus::InProgress),
            condvar: Condvar::new(),
        }
    }
}

pub struct GraphBuildState {
    signals: Mutex<HashMap<PathBuf, Arc<BuildSignal>>>,
}

impl GraphBuildState {
    pub fn new() -> Self {
        Self {
            signals: Mutex::new(HashMap::new()),
        }
    }

    pub fn start_build(&self, path: PathBuf) -> Arc<BuildSignal> {
        let signal = Arc::new(BuildSignal::new());
        self.signals.lock().unwrap().insert(path, Arc::clone(&signal));
        signal
    }

    pub fn mark_ready(&self, path: &PathBuf) {
        if let Some(signal) = self.signals.lock().unwrap().get(path) {
            let mut status = signal.status.lock().unwrap();
            *status = BuildStatus::Ready;
            signal.condvar.notify_all();
        }
    }

    pub fn mark_failed(&self, path: &PathBuf, err: String) {
        if let Some(signal) = self.signals.lock().unwrap().get(path) {
            let mut status = signal.status.lock().unwrap();
            *status = BuildStatus::Failed(err);
            signal.condvar.notify_all();
        }
    }

    pub fn is_in_progress(&self, path: &PathBuf) -> bool {
        if let Some(signal) = self.signals.lock().unwrap().get(path) {
            matches!(*signal.status.lock().unwrap(), BuildStatus::InProgress)
        } else {
            false
        }
    }

    pub fn get_signal(&self, path: &PathBuf) -> Option<Arc<BuildSignal>> {
        self.signals.lock().unwrap().get(path).cloned()
    }
}

pub(super) fn with_graph_index<F, T>(
    workspace_state: &State<crate::commands::workspace::WorkspaceRegistry>,
    graph_state: &State<Arc<GraphRegistry>>,
    window_label: &str,
    f: F,
) -> Result<T, String>
where
    F: FnOnce(&GraphIndex) -> Result<T, crate::graph::error::GraphError>,
{
    let root = crate::commands::workspace::get_workspace_root(workspace_state, window_label)?;
    let gi = {
        let indices = graph_state.indices.lock().unwrap();
        Arc::clone(
            indices
                .get(&root)
                .ok_or_else(|| "No graph index for this workspace".to_string())?,
        )
    };
    f(&gi).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn rebuild_graph_index(
    window: tauri::Window,
    workspace_state: State<crate::commands::workspace::WorkspaceRegistry>,
    graph_state: State<Arc<GraphRegistry>>,
    app_handle: tauri::AppHandle,
) -> Result<String, String> {
    let ann_enabled = crate::preferences::annotations_enabled(&app_handle);
    with_graph_index(&workspace_state, &graph_state, window.label(), |gi| {
        let result = gi.full_rebuild(ann_enabled)?;
        Ok(format!(
            "Rebuilt: {} nodes, {} edges, {} stubs",
            result.nodes_indexed, result.edges_resolved, result.stubs_created
        ))
    })
}

#[tauri::command]
pub fn get_pagerank(
    window: tauri::Window,
    workspace_state: State<crate::commands::workspace::WorkspaceRegistry>,
    graph_state: State<Arc<GraphRegistry>>,
    n: Option<usize>,
) -> Result<serde_json::Value, String> {
    with_graph_index(&workspace_state, &graph_state, window.label(), |gi| {
        match n {
            Some(n) => {
                let top = gi.top_by_pagerank(n)?;
                serde_json::to_value(top).map_err(|e| crate::graph::error::GraphError::Other(e.to_string()))
            }
            None => {
                let scores = gi.pagerank()?;
                serde_json::to_value(scores).map_err(|e| crate::graph::error::GraphError::Other(e.to_string()))
            }
        }
    })
}

#[tauri::command]
pub fn get_backlinks(
    window: tauri::Window,
    workspace_state: State<crate::commands::workspace::WorkspaceRegistry>,
    graph_state: State<Arc<GraphRegistry>>,
    page_id: String,
) -> Result<serde_json::Value, String> {
    with_graph_index(&workspace_state, &graph_state, window.label(), |gi| {
        let bl = gi.backlinks(&page_id)?;
        serde_json::to_value(bl).map_err(|e| crate::graph::error::GraphError::Other(e.to_string()))
    })
}

#[tauri::command]
pub fn get_forward_links(
    window: tauri::Window,
    workspace_state: State<crate::commands::workspace::WorkspaceRegistry>,
    graph_state: State<Arc<GraphRegistry>>,
    page_id: String,
) -> Result<serde_json::Value, String> {
    with_graph_index(&workspace_state, &graph_state, window.label(), |gi| {
        let fl = gi.forward_links(&page_id)?;
        serde_json::to_value(fl).map_err(|e| crate::graph::error::GraphError::Other(e.to_string()))
    })
}

#[tauri::command]
pub async fn search_pages(
    window: tauri::Window,
    workspace_state: State<'_, crate::commands::workspace::WorkspaceRegistry>,
    graph_state: State<'_, Arc<GraphRegistry>>,
    query: String,
    limit: Option<i64>,
) -> Result<serde_json::Value, String> {
    let root = crate::commands::workspace::get_workspace_root(&workspace_state, window.label())?;
    let gi = {
        let indices = graph_state.indices.lock().unwrap();
        Arc::clone(
            indices
                .get(&root)
                .ok_or_else(|| "No graph index for this workspace".to_string())?,
        )
    };

    tauri::async_runtime::spawn_blocking(move || {
        let results = gi
            .search(&query, limit.unwrap_or(20))
            .map_err(|e| e.to_string())?;
        serde_json::to_value(results).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn search_pages_by_title(
    window: tauri::Window,
    workspace_state: State<crate::commands::workspace::WorkspaceRegistry>,
    graph_state: State<Arc<GraphRegistry>>,
    query: String,
    limit: Option<i64>,
) -> Result<serde_json::Value, String> {
    with_graph_index(&workspace_state, &graph_state, window.label(), |gi| {
        let results = gi.search_by_title(&query, limit.unwrap_or(20))?;
        serde_json::to_value(results).map_err(|e| crate::graph::error::GraphError::Other(e.to_string()))
    })
}

#[tauri::command]
pub fn get_graph_stats(
    window: tauri::Window,
    workspace_state: State<crate::commands::workspace::WorkspaceRegistry>,
    graph_state: State<Arc<GraphRegistry>>,
) -> Result<serde_json::Value, String> {
    with_graph_index(&workspace_state, &graph_state, window.label(), |gi| {
        let stats = gi.stats()?;
        serde_json::to_value(stats).map_err(|e| crate::graph::error::GraphError::Other(e.to_string()))
    })
}

#[tauri::command]
pub fn get_graph_neighbors(
    window: tauri::Window,
    workspace_state: State<crate::commands::workspace::WorkspaceRegistry>,
    graph_state: State<Arc<GraphRegistry>>,
    id: String,
    depth: usize,
    directed: Option<bool>,
) -> Result<serde_json::Value, String> {
    with_graph_index(&workspace_state, &graph_state, window.label(), |gi| {
        let result = gi.neighbors(&id, depth, directed.unwrap_or(false))?;
        serde_json::to_value(result).map_err(|e| crate::graph::error::GraphError::Other(e.to_string()))
    })
}

#[tauri::command]
pub fn get_graph_paths(
    window: tauri::Window,
    workspace_state: State<crate::commands::workspace::WorkspaceRegistry>,
    graph_state: State<Arc<GraphRegistry>>,
    from: String,
    to: String,
    max_depth: usize,
    directed: Option<bool>,
) -> Result<serde_json::Value, String> {
    with_graph_index(&workspace_state, &graph_state, window.label(), |gi| {
        let paths = gi.paths(&from, &to, max_depth, directed.unwrap_or(false))?;
        serde_json::to_value(paths).map_err(|e| crate::graph::error::GraphError::Other(e.to_string()))
    })
}

#[tauri::command]
pub fn get_graph_subgraph(
    window: tauri::Window,
    workspace_state: State<crate::commands::workspace::WorkspaceRegistry>,
    graph_state: State<Arc<GraphRegistry>>,
    seeds: Vec<String>,
    depth: usize,
    directed: Option<bool>,
) -> Result<serde_json::Value, String> {
    with_graph_index(&workspace_state, &graph_state, window.label(), |gi| {
        let seed_refs: Vec<&str> = seeds.iter().map(|s| s.as_str()).collect();
        let result = gi.subgraph(&seed_refs, depth, directed.unwrap_or(false))?;
        serde_json::to_value(result).map_err(|e| crate::graph::error::GraphError::Other(e.to_string()))
    })
}

#[tauri::command]
pub fn resolve_wikilink(
    window: tauri::Window,
    workspace_state: State<crate::commands::workspace::WorkspaceRegistry>,
    graph_state: State<Arc<GraphRegistry>>,
    target: String,
) -> Result<serde_json::Value, String> {
    with_graph_index(&workspace_state, &graph_state, window.label(), |gi| {
        let resolved = gi.resolve_wikilink(&target)?;
        serde_json::to_value(resolved).map_err(|e| crate::graph::error::GraphError::Other(e.to_string()))
    })
}

#[tauri::command]
pub fn get_page_headings(
    window: tauri::Window,
    workspace_state: State<crate::commands::workspace::WorkspaceRegistry>,
    graph_state: State<Arc<GraphRegistry>>,
    target: String,
) -> Result<serde_json::Value, String> {
    with_graph_index(&workspace_state, &graph_state, window.label(), |gi| {
        let headings = gi.page_headings(&target)?;
        serde_json::to_value(headings).map_err(|e| crate::graph::error::GraphError::Other(e.to_string()))
    })
}

#[tauri::command]
pub async fn get_unlinked_mentions(
    window: tauri::Window,
    workspace_state: State<'_, crate::commands::workspace::WorkspaceRegistry>,
    graph_state: State<'_, Arc<GraphRegistry>>,
    page_id: String,
) -> Result<serde_json::Value, String> {
    let root = crate::commands::workspace::get_workspace_root(&workspace_state, window.label())?;
    let gi = {
        let indices = graph_state.indices.lock().unwrap();
        Arc::clone(
            indices
                .get(&root)
                .ok_or_else(|| "No graph index for this workspace".to_string())?,
        )
    };

    tauri::async_runtime::spawn_blocking(move || {
        let mentions = gi
            .unlinked_mentions(&page_id)
            .map_err(|e| e.to_string())?;
        serde_json::to_value(mentions).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn link_unlinked_mention(
    window: tauri::Window,
    workspace_state: State<crate::commands::workspace::WorkspaceRegistry>,
    graph_state: State<Arc<GraphRegistry>>,
    registry: State<Arc<crate::workspace::write_hash::WriteHashRegistry>>,
    app_handle: tauri::AppHandle,
    source_id: String,
    source_line: u32,
    matched_text: String,
) -> Result<(), String> {
    let root =
        crate::commands::workspace::get_workspace_root(&workspace_state, window.label())?;

    let page = crate::workspace::ops::read_page(&root, &source_id)
        .map_err(|e| e.to_string())?;

    let new_body =
        crate::graph::extract::replace_mention_with_wikilink(&page.body, source_line, &matched_text)
            .map_err(|e| e.to_string())?;

    let fm: indexmap::IndexMap<String, serde_yaml::Value> =
        crate::workspace::frontmatter::parse_raw_yaml(&page.raw_yaml)
            .unwrap_or_default();

    crate::workspace::ops::write_page(&root, &source_id, &new_body, &fm, &registry)
        .map_err(|e| e.to_string())?;

    let gi = {
        let indices = graph_state.indices.lock().unwrap();
        indices.get(&root).cloned()
    };
    if let Some(gi) = gi {
        let ann_enabled = crate::preferences::annotations_enabled(&app_handle);
        let _ = gi.reindex_file(&source_id, ann_enabled);
    }

    Ok(())
}

#[tauri::command]
pub async fn ensure_graph_ready(
    path: String,
    build_state: State<'_, Arc<GraphBuildState>>,
) -> Result<(), String> {
    let path_buf = PathBuf::from(&path);

    let signal = match build_state.get_signal(&path_buf) {
        Some(s) => s,
        None => return Ok(()),
    };

    tauri::async_runtime::spawn_blocking(move || {
        let mut status = signal.status.lock().unwrap();
        while matches!(*status, BuildStatus::InProgress) {
            status = signal.condvar.wait(status).unwrap();
        }
        match &*status {
            BuildStatus::Ready => Ok(()),
            BuildStatus::Failed(msg) => Err(msg.clone()),
            BuildStatus::InProgress => unreachable!(),
        }
    })
    .await
    .map_err(|e| e.to_string())?
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

        let gi = Arc::new(GraphIndex::build(root.clone(), true).unwrap());
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
        let gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();
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
        let gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();
        let top = gi.top_by_pagerank(2).unwrap();
        assert_eq!(top.len(), 2);
        assert!(top[0].1 >= top[1].1);
    }

    #[test]
    fn cmd_get_backlinks() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("a.md"), "Links to [[b]].").unwrap();
        std::fs::write(dir.path().join("b.md"), "Target.").unwrap();
        let gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();
        let bl = gi.backlinks("b.md").unwrap();
        assert_eq!(bl.len(), 1);
        assert_eq!(bl[0].source_id, "a.md");
    }

    #[test]
    fn cmd_get_forward_links() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("a.md"), "Links to [[b]].").unwrap();
        std::fs::write(dir.path().join("b.md"), "Target.").unwrap();
        let gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();
        let fl = gi.forward_links("a.md").unwrap();
        assert_eq!(fl.len(), 1);
        assert_eq!(fl[0].target_id, "b.md");
    }

    #[test]
    fn cmd_search_pages() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("a.md"), "---\ntitle: Quantum\n---\nBody.").unwrap();
        let gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();
        let results = gi.search("Quantum", 20).unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].id, "a.md");
    }

    #[test]
    fn search_pages_returns_results_via_graph_index() {
        let dir = tempfile::tempdir().unwrap();
        for i in 0..10 {
            let content = if i % 2 == 0 {
                format!("This note discusses concurrency in iteration {i}.")
            } else {
                format!("Unrelated content {i}.")
            };
            std::fs::write(dir.path().join(format!("n{i}.md")), content).unwrap();
        }
        let gi = Arc::new(GraphIndex::build(dir.path().to_path_buf(), true).unwrap());
        let results = gi.search("concurrency", 100).unwrap();
        assert_eq!(results.len(), 5);
        for r in &results {
            assert!(r.score < 0.0);
        }
    }

    #[test]
    fn cmd_get_graph_stats() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("a.md"), "[[b]]").unwrap();
        std::fs::write(dir.path().join("b.md"), "Target.").unwrap();
        let gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();
        let stats = gi.stats().unwrap();
        assert_eq!(stats.nodes, 2);
        assert_eq!(stats.edges, 1);
    }

    #[test]
    fn cmd_get_graph_neighbors() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("a.md"), "[[b]]").unwrap();
        std::fs::write(dir.path().join("b.md"), "Target.").unwrap();
        let gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();
        let result = gi.neighbors("a.md", 1, true).unwrap();
        let ids: std::collections::HashSet<&str> =
            result.nodes.iter().map(|n| n.id.as_str()).collect();
        assert!(ids.contains("a.md"));
        assert!(ids.contains("b.md"));
    }

    #[test]
    fn cmd_get_graph_paths() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("a.md"), "[[b]]").unwrap();
        std::fs::write(dir.path().join("b.md"), "[[c]]").unwrap();
        std::fs::write(dir.path().join("c.md"), "Leaf.").unwrap();
        let gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();
        let paths = gi.paths("a.md", "c.md", 3, true).unwrap();
        assert_eq!(paths.len(), 1);
        assert_eq!(paths[0], vec!["a.md", "b.md", "c.md"]);
    }

    #[test]
    fn cmd_resolve_wikilink_returns_resolved_link() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("a.md"), "Content.").unwrap();
        let gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();
        let resolved = gi.resolve_wikilink("a").unwrap();
        assert_eq!(resolved.node_id, Some("a.md".to_string()));
        let json = serde_json::to_value(&resolved).unwrap();
        assert!(json.get("target").is_some());
        assert!(json.get("node_id").is_some());
        assert!(json.get("tier").is_some());
    }

    #[test]
    fn cmd_resolve_wikilink_unresolved_returns_null_node_id() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("a.md"), "Content.").unwrap();
        let gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();
        let resolved = gi.resolve_wikilink("NonExistent").unwrap();
        assert_eq!(resolved.node_id, None);
        let json = serde_json::to_value(&resolved).unwrap();
        assert!(json["node_id"].is_null());
    }

    #[test]
    fn cmd_get_page_headings() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("a.md"), "# Intro\n\n## Details").unwrap();
        let gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();
        let headings = gi.page_headings("a").unwrap();
        assert_eq!(headings.len(), 2);
        assert_eq!(headings[0].text, "Intro");
        assert_eq!(headings[1].text, "Details");
    }

    #[test]
    fn cmd_get_graph_subgraph() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("a.md"), "[[b]]").unwrap();
        std::fs::write(dir.path().join("b.md"), "[[c]]").unwrap();
        std::fs::write(dir.path().join("c.md"), "Leaf.").unwrap();
        let gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();
        let result = gi.subgraph(&["a.md"], 1, true).unwrap();
        let ids: std::collections::HashSet<&str> =
            result.nodes.iter().map(|n| n.id.as_str()).collect();
        assert!(ids.contains("a.md"));
        assert!(ids.contains("b.md"));
        assert!(!ids.contains("c.md"));
    }

    #[test]
    fn cmd_get_unlinked_mentions() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(
            dir.path().join("target.md"),
            "---\ntitle: Alice\n---\nI am Alice.",
        )
        .unwrap();
        std::fs::write(dir.path().join("other.md"), "I met Alice yesterday.")
            .unwrap();
        let gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();
        let mentions = gi.unlinked_mentions("target.md").unwrap();
        assert_eq!(mentions.len(), 1);
        assert_eq!(mentions[0].source_id, "other.md");
        assert_eq!(mentions[0].matched_text, "Alice");

        let json = serde_json::to_value(&mentions).unwrap();
        assert!(json.is_array());
        assert_eq!(json[0]["source_id"], "other.md");
    }

    #[test]
    fn cmd_search_pages_by_title() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("quantum.md"), "---\ntitle: Quantum Physics\n---\nBody.").unwrap();
        std::fs::write(dir.path().join("classic.md"), "---\ntitle: Classical Mechanics\n---\nBody.").unwrap();
        let gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();
        let results = gi.search_by_title("Quantum", 10).unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].id, "quantum.md");
        assert_eq!(results[0].title, "Quantum Physics");
        assert_eq!(results[0].score, 0.0);
        assert_eq!(results[0].excerpt, "");
    }

    #[test]
    fn cmd_link_unlinked_mention() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(
            dir.path().join("target.md"),
            "---\ntitle: Alice\n---\nI am Alice.",
        )
        .unwrap();
        std::fs::write(dir.path().join("other.md"), "I met Alice yesterday.")
            .unwrap();
        let gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();

        // Read the source page, replace, and write back
        let page = crate::workspace::ops::read_page(dir.path(), "other.md").unwrap();
        let new_body =
            crate::graph::extract::replace_mention_with_wikilink(&page.body, 1, "Alice")
                .unwrap();
        assert_eq!(new_body, "I met [[Alice]] yesterday.");

        let registry = crate::workspace::write_hash::WriteHashRegistry::new();
        let fm: indexmap::IndexMap<String, serde_yaml::Value> = indexmap::IndexMap::new();
        crate::workspace::ops::write_page(dir.path(), "other.md", &new_body, &fm, &registry)
            .unwrap();
        gi.reindex_file("other.md", true).unwrap();

        // Verify the file was updated
        let content = std::fs::read_to_string(dir.path().join("other.md")).unwrap();
        assert!(content.contains("[[Alice]]"));

        // Verify unlinked mentions is now empty (it's now a backlink)
        let mentions = gi.unlinked_mentions("target.md").unwrap();
        assert!(mentions.is_empty());
    }

    // --- GraphBuildState ---

    #[test]
    fn build_state_is_in_progress_false_for_unknown() {
        let state = GraphBuildState::new();
        assert!(!state.is_in_progress(&PathBuf::from("/unknown")));
    }

    #[test]
    fn build_state_is_in_progress_true_after_start() {
        let state = GraphBuildState::new();
        let path = PathBuf::from("/test");
        state.start_build(path.clone());
        assert!(state.is_in_progress(&path));
    }

    #[test]
    fn build_state_is_in_progress_false_after_ready() {
        let state = GraphBuildState::new();
        let path = PathBuf::from("/test");
        state.start_build(path.clone());
        state.mark_ready(&path);
        assert!(!state.is_in_progress(&path));
    }

    #[test]
    fn build_state_is_in_progress_false_after_failed() {
        let state = GraphBuildState::new();
        let path = PathBuf::from("/test");
        state.start_build(path.clone());
        state.mark_failed(&path, "error".to_string());
        assert!(!state.is_in_progress(&path));
    }

    #[test]
    fn build_state_start_and_mark_ready() {
        let state = GraphBuildState::new();
        let path = PathBuf::from("/test");
        state.start_build(path.clone());
        state.mark_ready(&path);

        let signal = state.get_signal(&path).unwrap();
        let status = signal.status.lock().unwrap();
        assert!(matches!(*status, BuildStatus::Ready));
    }

    #[test]
    fn build_state_start_and_mark_failed() {
        let state = GraphBuildState::new();
        let path = PathBuf::from("/test");
        state.start_build(path.clone());
        state.mark_failed(&path, "disk full".to_string());

        let signal = state.get_signal(&path).unwrap();
        let status = signal.status.lock().unwrap();
        match &*status {
            BuildStatus::Failed(msg) => assert_eq!(msg, "disk full"),
            other => panic!("expected Failed, got {:?}", other),
        }
    }

    #[test]
    fn build_state_get_signal_returns_none_for_unknown() {
        let state = GraphBuildState::new();
        assert!(state.get_signal(&PathBuf::from("/unknown")).is_none());
    }

    #[test]
    fn build_state_condvar_unblocks_waiter() {
        let state = Arc::new(GraphBuildState::new());
        let path = PathBuf::from("/test");
        let signal = state.start_build(path.clone());

        let state_clone = Arc::clone(&state);
        let path_clone = path.clone();
        let handle = std::thread::spawn(move || {
            let mut status = signal.status.lock().unwrap();
            while matches!(*status, BuildStatus::InProgress) {
                status = signal.condvar.wait(status).unwrap();
            }
            matches!(*status, BuildStatus::Ready)
        });

        std::thread::sleep(std::time::Duration::from_millis(10));
        state_clone.mark_ready(&path_clone);

        assert!(handle.join().unwrap());
    }
}
