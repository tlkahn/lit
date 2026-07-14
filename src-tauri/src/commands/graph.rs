use crate::graph::error::GraphError;
use crate::graph::indexer::GraphIndex;
use crate::graph::types::Position;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Condvar, Mutex};
use tauri::{Emitter, State};

pub(crate) fn reindex_event_name<T>(result: &Result<T, GraphError>) -> (&'static str, Option<String>) {
    match result {
        Ok(_) => ("lit:graph-updated", None),
        Err(e) => ("lit:graph-reindex-failed", Some(e.to_string())),
    }
}

pub(crate) fn emit_reindex_result<T>(handle: &tauri::AppHandle, result: &Result<T, GraphError>) {
    let (event, payload) = reindex_event_name(result);
    let _ = handle.emit(event, payload);
}

#[derive(Clone, serde::Serialize)]
pub(crate) struct AnnotationsRemovedPayload {
    pub items: Vec<AnnotationRemovedItem>,
}

#[derive(Clone, serde::Serialize)]
pub(crate) struct AnnotationRemovedItem {
    pub node_id: String,
    pub uuid: String,
}

pub(crate) fn emit_annotations_removed(handle: &tauri::AppHandle, removed: &[(String, String)]) {
    if removed.is_empty() {
        return;
    }
    let payload = AnnotationsRemovedPayload {
        items: removed.iter().map(|(node_id, uuid)| AnnotationRemovedItem {
            node_id: node_id.clone(),
            uuid: uuid.clone(),
        }).collect(),
    };
    let _ = handle.emit("lit:annotations-removed", &payload);
}

/// Combined emit for single-file reindex results (result carries removed pairs in Ok).
pub(crate) fn emit_reindex_side_effects(
    handle: &tauri::AppHandle,
    result: &Result<Vec<(String, String)>, crate::graph::error::GraphError>,
) {
    emit_reindex_result(handle, result);
    if let Ok(removed) = result {
        emit_annotations_removed(handle, removed);
    }
}

/// Combined emit for batch reindex results (removed pairs collected separately).
pub(crate) fn emit_reindex_side_effects_with_removed(
    handle: &tauri::AppHandle,
    result: &Result<(), crate::graph::error::GraphError>,
    removed: &[(String, String)],
) {
    emit_reindex_result(handle, result);
    emit_annotations_removed(handle, removed);
}

/// Refresh shadow nodes in the graph index and emit `lit:graph-updated` if changed.
pub(crate) fn refresh_graph_shadows(
    graph_state: &Arc<GraphRegistry>,
    workspace_root: &Path,
    app_handle: &tauri::AppHandle,
) {
    let graph_changed = {
        let gi = graph_state
            .indices
            .lock()
            .unwrap()
            .get(workspace_root)
            .cloned();
        if let Some(gi) = gi {
            gi.refresh_shadows().unwrap_or(false)
        } else {
            false
        }
    };
    if graph_changed {
        let _ = app_handle.emit("lit:graph-updated", ());
    }
}

/// Post-mutation protocol: refresh shadow nodes then emit the bib-items-changed event.
/// Every DB-mutating bib command must call this after a successful write.
pub(crate) fn notify_bib_changed(
    graph_state: &Arc<GraphRegistry>,
    workspace_root: &Path,
    app_handle: &tauri::AppHandle,
) {
    refresh_graph_shadows(graph_state, workspace_root, app_handle);
    let _ = app_handle.emit("lit:bib-items-changed", ());
}

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
    let result = with_graph_index(&workspace_state, &graph_state, window.label(), |gi| {
        gi.full_rebuild(ann_enabled)
    })?;
    let msg = format!(
        "Rebuilt: {} nodes, {} edges, {} stubs",
        result.nodes_indexed, result.edges_resolved, result.stubs_created
    );
    emit_annotations_removed(&app_handle, &result.removed_annotation_uuids);
    let _ = app_handle.emit("lit:graph-updated", ());
    let root = crate::commands::workspace::get_workspace_root(&workspace_state, window.label())?;
    let gi = graph_state.indices.lock().unwrap().get(&root).cloned();
    if let Some(gi) = gi {
        spawn_layout(gi, app_handle.clone());
    }
    Ok(msg)
}

#[tauri::command]
pub fn get_graph_positions(
    window: tauri::Window,
    workspace_state: State<crate::commands::workspace::WorkspaceRegistry>,
    graph_state: State<Arc<GraphRegistry>>,
) -> Result<HashMap<String, Position>, String> {
    with_graph_index(&workspace_state, &graph_state, window.label(), |gi| {
        Ok(gi.get_positions())
    })
}

pub(crate) fn load_or_build_graph_sync(
    root: PathBuf,
    build_state: &GraphBuildState,
    graph_reg: &GraphRegistry,
    annotations_enabled: bool,
    on_progress: impl Fn(crate::graph::progress::IndexProgress),
) -> Result<Arc<GraphIndex>, String> {
    // Reuse an already-registered index instead of opening a second DB
    // connection: a concurrent init (e.g. app-level early-workspace init
    // running a long background sync) may hold the write lock, and
    // Store::open would hit "database is locked" and brick this window.
    if let Some(gi) = graph_reg.indices.lock().unwrap().get(&root).cloned() {
        build_state.mark_ready(&root);
        return Ok(gi);
    }

    match GraphIndex::load_from_store(root.clone()) {
        Ok(Some(gi)) => {
            let gi = Arc::new(gi);
            graph_reg.indices.lock().unwrap().insert(root.clone(), Arc::clone(&gi));
            build_state.mark_ready(&root);
            return Ok(gi);
        }
        Ok(None) => {}
        Err(e) => tracing::warn!(error = %e, "load_from_store failed, falling back to cold start"),
    }

    match GraphIndex::build_with_progress(root.clone(), &on_progress, annotations_enabled) {
        Ok(gi) => {
            let gi = Arc::new(gi);
            graph_reg.indices.lock().unwrap().insert(root.clone(), Arc::clone(&gi));
            build_state.mark_ready(&root);
            Ok(gi)
        }
        Err(e) => {
            build_state.mark_failed(&root, e.to_string());
            Err(e.to_string())
        }
    }
}

pub(crate) fn initialize_graph_index_with_callbacks(
    root: PathBuf,
    build_state: &GraphBuildState,
    graph_reg: &GraphRegistry,
    annotations_enabled: bool,
    on_progress: impl Fn(crate::graph::progress::IndexProgress),
    on_graph_updated: impl Fn(&Arc<GraphIndex>),
    on_layout: impl FnOnce(Arc<GraphIndex>),
) {
    match load_or_build_graph_sync(root.clone(), build_state, graph_reg, annotations_enabled, on_progress) {
        Ok(gi) => {
            on_graph_updated(&gi);
            match gi.sync_with_disk(annotations_enabled) {
                Ok(true) => on_graph_updated(&gi),
                Ok(false) => {}
                Err(e) => tracing::error!(error = %e, "background graph sync failed"),
            }
            on_layout(gi);
        }
        Err(e) => tracing::error!(error = %e, "graph initialization failed"),
    }
}

pub(crate) fn initialize_graph_index(
    root: PathBuf,
    build_state: Arc<GraphBuildState>,
    graph_reg: Arc<GraphRegistry>,
    handle: tauri::AppHandle,
) {
    let ann_enabled = crate::preferences::annotations_enabled(&handle);
    let emit_handle = handle.clone();
    let layout_handle = handle.clone();
    initialize_graph_index_with_callbacks(
        root,
        &build_state,
        &graph_reg,
        ann_enabled,
        move |p| { let _ = emit_handle.emit("lit:index-progress", &p); },
        |_gi| { let _ = layout_handle.emit("lit:graph-updated", ()); },
        |gi| spawn_layout(gi, handle),
    );
}

#[tauri::command]
pub fn reset_graph_layout(
    window: tauri::Window,
    workspace_state: State<crate::commands::workspace::WorkspaceRegistry>,
    graph_state: State<Arc<GraphRegistry>>,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    with_graph_index(&workspace_state, &graph_state, window.label(), |gi| {
        gi.clear_positions()
    })?;
    let root = crate::commands::workspace::get_workspace_root(&workspace_state, window.label())?;
    let gi = graph_state.indices.lock().unwrap().get(&root).cloned();
    if let Some(gi) = gi {
        spawn_layout(gi, app_handle);
    }
    Ok(())
}

pub fn spawn_layout(gi: Arc<GraphIndex>, handle: tauri::AppHandle) {
    tauri::async_runtime::spawn_blocking(move || {
        gi.compute_layout_background(&crate::graph::layout::LayoutSettings::default());
        let _ = handle.emit("lit:layout-ready", ());
    });
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
pub fn get_citing_pages(
    window: tauri::Window,
    workspace_state: State<crate::commands::workspace::WorkspaceRegistry>,
    graph_state: State<Arc<GraphRegistry>>,
    bib_key: String,
) -> Result<serde_json::Value, String> {
    with_graph_index(&workspace_state, &graph_state, window.label(), |gi| {
        let cp = gi.citing_pages(&bib_key)?;
        serde_json::to_value(cp).map_err(|e| crate::graph::error::GraphError::Other(e.to_string()))
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
pub async fn search_content_filtered(
    window: tauri::Window,
    workspace_state: State<'_, crate::commands::workspace::WorkspaceRegistry>,
    graph_state: State<'_, Arc<GraphRegistry>>,
    query: String,
    filter: Option<crate::graph::types::SearchFilter>,
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
            .search_content_filtered(&query, &filter.unwrap_or_default(), limit.unwrap_or(100))
            .map_err(|e| e.to_string())?;
        serde_json::to_value(results).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn list_folders(
    window: tauri::Window,
    workspace_state: State<'_, crate::commands::workspace::WorkspaceRegistry>,
    graph_state: State<'_, Arc<GraphRegistry>>,
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
        let folders = gi.list_folders(limit.unwrap_or(500)).map_err(|e| e.to_string())?;
        serde_json::to_value(folders).map_err(|e| e.to_string())
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
    include_citations: Option<bool>,
    include_cardbox: Option<bool>,
) -> Result<serde_json::Value, String> {
    with_graph_index(&workspace_state, &graph_state, window.label(), |gi| {
        let seed_refs: Vec<&str> = seeds.iter().map(|s| s.as_str()).collect();
        let result = gi.subgraph_bundle(&seed_refs, depth, directed.unwrap_or(false), include_citations.unwrap_or(false), include_cardbox.unwrap_or(false))?;
        serde_json::to_value(result).map_err(|e| crate::graph::error::GraphError::Other(e.to_string()))
    })
}

#[derive(serde::Serialize)]
pub struct BibKeyState {
    pub materialization: String,
    pub page_id: Option<String>,
}

#[tauri::command]
pub fn get_bib_key_states(
    window: tauri::Window,
    workspace_state: State<crate::commands::workspace::WorkspaceRegistry>,
    graph_state: State<Arc<GraphRegistry>>,
) -> Result<HashMap<String, BibKeyState>, String> {
    with_graph_index(&workspace_state, &graph_state, window.label(), |gi| {
        let store = gi.store();
        let citekey_map: HashMap<String, String> = store
            .citekey_pages()
            .map_err(|e| crate::graph::error::GraphError::Other(e.to_string()))?
            .into_iter()
            .collect();
        let nodes = store
            .all_nodes_metadata()
            .map_err(|e| crate::graph::error::GraphError::Other(e.to_string()))?;
        let mut result = HashMap::new();
        for (id, _is_stub, materialization) in &nodes {
            if let Some(raw_key) = id.strip_prefix("bib:") {
                let page_id = citekey_map.get(raw_key).cloned();
                result.insert(
                    raw_key.to_string(),
                    BibKeyState {
                        materialization: materialization.as_str().to_string(),
                        page_id,
                    },
                );
            }
        }
        // Also include citekey-linked pages that are materialized (no shadow node)
        for (citekey, page_id) in &citekey_map {
            if !result.contains_key(citekey.as_str()) {
                result.insert(
                    citekey.clone(),
                    BibKeyState {
                        materialization: "materialized".to_string(),
                        page_id: Some(page_id.clone()),
                    },
                );
            }
        }
        Ok(result)
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
pub fn get_page_block_anchors(
    window: tauri::Window,
    workspace_state: State<crate::commands::workspace::WorkspaceRegistry>,
    graph_state: State<Arc<GraphRegistry>>,
    target: String,
) -> Result<serde_json::Value, String> {
    with_graph_index(&workspace_state, &graph_state, window.label(), |gi| {
        let anchors = gi.page_block_anchors(&target)?;
        serde_json::to_value(anchors).map_err(|e| crate::graph::error::GraphError::Other(e.to_string()))
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
    file_lock: State<Arc<crate::workspace::file_lock::FilePathLock>>,
    app_handle: tauri::AppHandle,
    source_id: String,
    source_line: u32,
    matched_text: String,
) -> Result<(), String> {
    let root =
        crate::commands::workspace::get_workspace_root(&workspace_state, window.label())?;
    let full_path = root.join(&source_id);

    file_lock.with_lock(&full_path, || {
        let page = crate::workspace::ops::read_page(&root, &source_id, &registry)
            .map_err(|e| e.to_string())?;

        let new_body =
            crate::graph::extract::replace_mention_with_wikilink(&page.body, source_line, &matched_text)
                .map_err(|e| e.to_string())?;

        let fm: indexmap::IndexMap<String, serde_yaml::Value> =
            crate::workspace::frontmatter::parse_raw_yaml(&page.raw_yaml)
                .unwrap_or_default();

        crate::workspace::ops::write_page(&root, &source_id, &new_body, &fm, &registry)
            .map_err(|e| e.to_string())
    })?;

    let gi = {
        let indices = graph_state.indices.lock().unwrap();
        indices.get(&root).cloned()
    };
    if let Some(gi) = gi {
        let ann_enabled = crate::preferences::annotations_enabled(&app_handle);
        let result = gi.reindex_file(&source_id, ann_enabled);
        emit_reindex_side_effects(&app_handle, &result);
    }

    Ok(())
}

#[tauri::command]
pub fn search_tags(
    window: tauri::Window,
    workspace_state: State<crate::commands::workspace::WorkspaceRegistry>,
    graph_state: State<Arc<GraphRegistry>>,
    query: String,
    limit: Option<i64>,
) -> Result<serde_json::Value, String> {
    with_graph_index(&workspace_state, &graph_state, window.label(), |gi| {
        let results = gi.search_tags(&query, limit.unwrap_or(20))?;
        serde_json::to_value(results).map_err(|e| crate::graph::error::GraphError::Other(e.to_string()))
    })
}

#[tauri::command]
pub fn list_pages_by_tag(
    window: tauri::Window,
    workspace_state: State<crate::commands::workspace::WorkspaceRegistry>,
    graph_state: State<Arc<GraphRegistry>>,
    tag: String,
    limit: Option<i64>,
) -> Result<serde_json::Value, String> {
    with_graph_index(&workspace_state, &graph_state, window.label(), |gi| {
        let results = gi.list_pages_by_tag(&tag, limit.unwrap_or(50))?;
        serde_json::to_value(results).map_err(|e| crate::graph::error::GraphError::Other(e.to_string()))
    })
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
    fn reindex_event_name_ok_returns_graph_updated() {
        let (event, payload) = reindex_event_name(&Ok(()));
        assert_eq!(event, "lit:graph-updated");
        assert!(payload.is_none());
    }

    #[test]
    fn reindex_event_name_err_returns_graph_reindex_failed() {
        let err = GraphError::Other("disk full".to_string());
        let (event, payload) = reindex_event_name::<()>(&Err(err));
        assert_eq!(event, "lit:graph-reindex-failed");
        assert_eq!(payload.unwrap(), "disk full");
    }

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
    fn cmd_get_citing_pages() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("a.md"), "As shown in [@smith2024].").unwrap();
        std::fs::write(dir.path().join("b.md"), "No citations here.").unwrap();
        let gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();
        let citing = gi.citing_pages("smith2024").unwrap();
        assert_eq!(citing.len(), 1);
        assert_eq!(citing[0].source_id, "a.md");
        assert!(gi.citing_pages("absent2000").unwrap().is_empty());
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
    fn cmd_get_page_block_anchors() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("a.md"), "First block. ^3141e2\n\nPlain line.").unwrap();
        let gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();
        let anchors = gi.page_block_anchors("a").unwrap();
        assert_eq!(anchors.len(), 1);
        assert_eq!(anchors[0].id, "3141e2");
        assert_eq!(anchors[0].line, 1);
    }

    #[test]
    fn cmd_get_graph_subgraph() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("a.md"), "[[b]]").unwrap();
        std::fs::write(dir.path().join("b.md"), "[[c]]").unwrap();
        std::fs::write(dir.path().join("c.md"), "Leaf.").unwrap();
        let gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();
        let result = gi.subgraph(&["a.md"], 1, true, false, false).unwrap();
        let ids: std::collections::HashSet<&str> =
            result.nodes.iter().map(|n| n.id.as_str()).collect();
        assert!(ids.contains("a.md"));
        assert!(ids.contains("b.md"));
        assert!(!ids.contains("c.md"));
    }

    #[test]
    fn cmd_get_graph_subgraph_bundle_includes_pagerank_and_positions() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("a.md"), "[[b]]").unwrap();
        std::fs::write(dir.path().join("b.md"), "Target.").unwrap();
        let gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();
        let bundle = gi.subgraph_bundle(&[], 0, false, false, false).unwrap();
        assert_eq!(bundle.subgraph.nodes.len(), 2);
        assert!(bundle.pagerank.contains_key("a.md"));
        assert!(bundle.pagerank.contains_key("b.md"));
        let sum: f64 = bundle.pagerank.values().sum();
        assert!((sum - 1.0).abs() < 1e-9);
        // JSON shape has nodes, edges, pagerank, positions at top level
        let json = serde_json::to_value(&bundle).unwrap();
        assert!(json.get("nodes").is_some());
        assert!(json.get("edges").is_some());
        assert!(json.get("pagerank").is_some());
        assert!(json.get("positions").is_some());
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
    fn cmd_search_tags() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("a.md"), "---\ntags: [rust, coding]\n---\nBody.").unwrap();
        std::fs::write(dir.path().join("b.md"), "---\ntags: [rust]\n---\nBody.").unwrap();
        std::fs::write(dir.path().join("c.md"), "---\ntags: [python]\n---\nBody.").unwrap();
        let gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();
        let results = gi.search_tags("rust", 10).unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].tag, "rust");
        assert_eq!(results[0].count, 2);
    }

    #[test]
    fn cmd_search_tags_empty_query() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("a.md"), "---\ntags: [rust]\n---\nBody.").unwrap();
        let gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();
        assert!(gi.search_tags("", 10).unwrap().is_empty());
    }

    #[test]
    fn cmd_list_pages_by_tag() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("b.md"), "---\ntitle: Beta\ntags: [rust]\n---\nBeta body.").unwrap();
        std::fs::write(dir.path().join("a.md"), "---\ntitle: Alpha\ntags: [rust, coding]\n---\nAlpha body.").unwrap();
        std::fs::write(dir.path().join("c.md"), "---\ntitle: Charlie\ntags: [python]\n---\nCharlie body.").unwrap();
        let gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();
        let results = gi.list_pages_by_tag("rust", 10).unwrap();
        assert_eq!(results.len(), 2);
        assert_eq!(results[0].title, "Alpha");
        assert_eq!(results[1].title, "Beta");
    }

    #[test]
    fn cmd_list_pages_by_tag_no_match() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("a.md"), "---\ntags: [rust]\n---\nBody.").unwrap();
        let gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();
        assert!(gi.list_pages_by_tag("nonexistent", 10).unwrap().is_empty());
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
        let registry = crate::workspace::write_hash::WriteHashRegistry::new();
        let page = crate::workspace::ops::read_page(dir.path(), "other.md", &registry).unwrap();
        let new_body =
            crate::graph::extract::replace_mention_with_wikilink(&page.body, 1, "Alice")
                .unwrap();
        assert_eq!(new_body, "I met [[Alice]] yesterday.");
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

    #[test]
    fn load_or_build_graph_sync_cold_build() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("a.md"), "[[b]]").unwrap();
        std::fs::write(dir.path().join("b.md"), "Target.").unwrap();
        let build_state = GraphBuildState::new();
        let graph_reg = GraphRegistry::new();
        build_state.start_build(dir.path().to_path_buf());
        let gi = load_or_build_graph_sync(
            dir.path().to_path_buf(),
            &build_state,
            &graph_reg,
            true,
            |_| {},
        )
        .unwrap();
        assert_eq!(gi.stats().unwrap().nodes, 2);
    }

    #[test]
    fn load_or_build_graph_sync_warm_start() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("a.md"), "[[b]]").unwrap();
        std::fs::write(dir.path().join("b.md"), "Target.").unwrap();
        // Cold build first to populate the store
        let _gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();

        let build_state = GraphBuildState::new();
        let graph_reg = GraphRegistry::new();
        build_state.start_build(dir.path().to_path_buf());
        let gi = load_or_build_graph_sync(
            dir.path().to_path_buf(),
            &build_state,
            &graph_reg,
            true,
            |_| {},
        )
        .unwrap();
        assert_eq!(gi.stats().unwrap().nodes, 2);
    }

    #[test]
    fn load_or_build_graph_sync_marks_ready() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("a.md"), "content").unwrap();
        let build_state = GraphBuildState::new();
        let graph_reg = GraphRegistry::new();
        build_state.start_build(dir.path().to_path_buf());
        assert!(build_state.is_in_progress(&dir.path().to_path_buf()));
        let _gi = load_or_build_graph_sync(
            dir.path().to_path_buf(),
            &build_state,
            &graph_reg,
            true,
            |_| {},
        )
        .unwrap();
        assert!(!build_state.is_in_progress(&dir.path().to_path_buf()));
        let indices = graph_reg.indices.lock().unwrap();
        assert!(indices.contains_key(&dir.path().to_path_buf()));
    }

    #[test]
    fn load_or_build_graph_sync_reuses_registered_index() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("a.md"), "content").unwrap();
        let root = dir.path().to_path_buf();

        let registered = Arc::new(GraphIndex::build(root.clone(), true).unwrap());
        let build_state = GraphBuildState::new();
        let graph_reg = GraphRegistry::new();
        graph_reg.indices.lock().unwrap().insert(root.clone(), Arc::clone(&registered));

        build_state.start_build(root.clone());
        let gi = load_or_build_graph_sync(root.clone(), &build_state, &graph_reg, true, |_| {}).unwrap();

        assert!(
            Arc::ptr_eq(&gi, &registered),
            "must return the registered index instead of opening a second store connection"
        );
        assert!(!build_state.is_in_progress(&root), "reuse must mark the build ready");
    }

    #[test]
    fn init_graph_with_sync_calls_layout_once() {
        use std::sync::atomic::{AtomicU32, Ordering};

        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("a.md"), "[[b]]").unwrap();
        std::fs::write(dir.path().join("b.md"), "Target.").unwrap();
        let build_state = Arc::new(GraphBuildState::new());
        let graph_reg = Arc::new(GraphRegistry::new());
        let layout_count = Arc::new(AtomicU32::new(0));
        let lc = Arc::clone(&layout_count);

        build_state.start_build(dir.path().to_path_buf());
        initialize_graph_index_with_callbacks(
            dir.path().to_path_buf(),
            &build_state,
            &graph_reg,
            true,
            |_| {},
            |_| {},
            move |_gi| {
                lc.fetch_add(1, Ordering::SeqCst);
            },
        );
        assert_eq!(layout_count.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn targeted_rewrite_pipeline_affected_plan_apply() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("target.md"), "Plain text.").unwrap();
        std::fs::write(dir.path().join("linker.md"), "See [[target]].").unwrap();
        std::fs::write(dir.path().join("bystander.md"), "See [[other]].").unwrap();

        let gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();

        let stems = vec![crate::graph::indexer::normalize_stem("target")];
        let affected = gi.affected_sources(&stems);
        assert!(
            affected.contains("linker.md"),
            "linker.md should be affected"
        );
        assert!(
            !affected.contains("bystander.md"),
            "bystander.md should not be affected"
        );

        let redirects = vec![crate::graph::rewriter::LinkRedirect {
            old_target: "target".to_string(),
            new_target: "renamed".to_string(),
        }];
        let planned =
            crate::graph::rewriter::plan_vault_rewrites_for_paths(dir.path(), &redirects, &affected)
                .unwrap();
        assert_eq!(planned.files_scanned, 1);

        let summary =
            crate::graph::rewriter::apply_planned_rewrites(dir.path(), &planned).unwrap();
        assert_eq!(summary.total_links_changed, 1);

        let linker = std::fs::read_to_string(dir.path().join("linker.md")).unwrap();
        assert!(linker.contains("[[renamed]]"), "linker.md should be rewritten: {linker}");
        assert!(!linker.contains("[[target]]"), "old link should be gone: {linker}");

        let bystander = std::fs::read_to_string(dir.path().join("bystander.md")).unwrap();
        assert!(
            bystander.contains("[[other]]"),
            "bystander.md should be unchanged: {bystander}"
        );
    }

    #[test]
    fn cmd_subgraph_default_excludes_shadows_and_citations() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join("assets/bib")).unwrap();
        std::fs::write(
            dir.path().join("a.md"),
            "---\ntitle: A\n---\nSee [@smith2024].",
        )
        .unwrap();
        std::fs::write(
            dir.path().join("assets/bib/a.bib"),
            "@article{smith2024, author={Smith}, title={Test}, year={2024}}",
        )
        .unwrap();
        let gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();
        let bundle = gi.subgraph_bundle(&[], 0, false, false, false).unwrap();
        let node_ids: std::collections::HashSet<&str> =
            bundle.subgraph.nodes.iter().map(|n| n.id.as_str()).collect();
        // With include_citations=false, shadow nodes should NOT appear
        assert!(
            !node_ids.contains("bib:smith2024"),
            "shadow node should be excluded by default"
        );
        // No citation edges
        let citation_edges: Vec<_> = bundle
            .subgraph
            .edges
            .iter()
            .filter(|(_, _, k)| *k == crate::graph::types::EdgeKind::Citation)
            .collect();
        assert!(
            citation_edges.is_empty(),
            "citation edges should be excluded by default"
        );
    }

    #[test]
    fn cmd_subgraph_include_citations_shows_shadows() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join("assets/bib")).unwrap();
        std::fs::write(
            dir.path().join("a.md"),
            "---\ntitle: A\n---\nSee [@smith2024].",
        )
        .unwrap();
        std::fs::write(
            dir.path().join("assets/bib/a.bib"),
            "@article{smith2024, author={Smith}, title={Test}, year={2024}}",
        )
        .unwrap();
        let gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();
        let bundle = gi.subgraph_bundle(&[], 0, false, true, false).unwrap();
        let node_ids: std::collections::HashSet<&str> =
            bundle.subgraph.nodes.iter().map(|n| n.id.as_str()).collect();
        // With include_citations=true, shadow nodes SHOULD appear
        assert!(
            node_ids.contains("bib:smith2024"),
            "shadow node should be included when include_citations=true"
        );
        // Citation edges should be present
        let citation_edges: Vec<_> = bundle
            .subgraph
            .edges
            .iter()
            .filter(|(_, _, k)| *k == crate::graph::types::EdgeKind::Citation)
            .collect();
        assert!(
            !citation_edges.is_empty(),
            "citation edges should be present when include_citations=true"
        );
    }

    #[test]
    fn cmd_get_bib_key_states_returns_shadow_and_citekey() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join("assets/bib")).unwrap();
        std::fs::create_dir_all(dir.path().join("notes")).unwrap();
        // a.md cites smith2024
        std::fs::write(
            dir.path().join("a.md"),
            "---\ntitle: A\n---\nSee [@smith2024].",
        )
        .unwrap();
        // notes/smith.md claims citekey doe2021
        std::fs::write(
            dir.path().join("notes/smith.md"),
            "---\ntitle: Smith Notes\ncitekey: doe2021\n---\nNotes about Doe.",
        )
        .unwrap();
        // bib file with both entries
        std::fs::write(
            dir.path().join("assets/bib/refs.bib"),
            "@article{smith2024, author={Smith}, title={Test}, year={2024}}\n\
             @article{doe2021, author={Doe}, title={Other}, year={2021}}",
        )
        .unwrap();
        let gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();
        let store = gi.store();
        // Verify shadow node bib:smith2024 exists
        let nodes = store.all_nodes_metadata().unwrap();
        let shadow = nodes.iter().find(|(id, _, _)| id == "bib:smith2024");
        assert!(
            shadow.is_some(),
            "shadow node bib:smith2024 should exist; got nodes: {:?}",
            nodes.iter().map(|(id, _, _)| id.as_str()).collect::<Vec<_>>()
        );
        // Verify citekey doe2021 maps to notes/smith.md
        let citekey_map: std::collections::HashMap<String, String> =
            store.citekey_pages().unwrap().into_iter().collect();
        assert_eq!(
            citekey_map.get("doe2021").map(|s| s.as_str()),
            Some("notes/smith.md"),
            "citekey doe2021 should map to notes/smith.md"
        );
    }

    #[test]
    fn refresh_graph_shadows_creates_shadow_after_bib_write() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().to_path_buf();

        // Create a .md file citing [@jones2024] but no .bib yet
        std::fs::write(dir.path().join("a.md"), "As shown in [@jones2024].").unwrap();

        let gi = GraphIndex::build(root.clone(), false).unwrap();

        // No shadow initially
        {
            let meta = gi.store().all_nodes_metadata().unwrap();
            assert!(
                !meta.iter().any(|(id, _, _)| id == "bib:jones2024"),
                "shadow should not exist before .bib is written"
            );
        }

        // Insert into a GraphRegistry
        let registry = Arc::new(GraphRegistry::new());
        registry
            .indices
            .lock()
            .unwrap()
            .insert(root.clone(), Arc::new(gi));

        // Write a .bib file
        std::fs::write(
            dir.path().join("refs.bib"),
            "@article{jones2024,\n  author = {Jones, Alice},\n  title = {Beta},\n  year = {2024}\n}",
        )
        .unwrap();

        // Test the core logic that refresh_graph_shadows uses:
        // lock registry, get Arc<GraphIndex>, call refresh_shadows()
        let gi = registry
            .indices
            .lock()
            .unwrap()
            .get(&root)
            .cloned()
            .unwrap();
        let changed = gi.refresh_shadows().unwrap();
        assert!(changed, "refresh_shadows should detect the new .bib entry");

        // Shadow node should now exist
        let meta = gi.store().all_nodes_metadata().unwrap();
        assert!(
            meta.iter().any(|(id, _, _)| id == "bib:jones2024"),
            "shadow must be created after refresh"
        );
    }
}

// TODO: consider deprecating in favor of rewrite_vault_links (page.rs), which records OpLog actions
#[tauri::command]
pub fn rewrite_links(
    window: tauri::Window,
    workspace_state: State<crate::commands::workspace::WorkspaceRegistry>,
    graph_state: State<Arc<GraphRegistry>>,
    registry: State<Arc<crate::workspace::write_hash::WriteHashRegistry>>,
    app_handle: tauri::AppHandle,
    redirects: Vec<crate::graph::rewriter::LinkRedirect>,
) -> Result<crate::graph::rewriter::RewriteSummary, String> {
    let root =
        crate::commands::workspace::get_workspace_root(&workspace_state, window.label())?;

    let gi = {
        let indices = graph_state.indices.lock().unwrap();
        indices.get(&root).cloned()
    };

    let planned = match &gi {
        Some(gi) => {
            let stems: Vec<String> = redirects
                .iter()
                .map(|r| crate::graph::indexer::normalize_stem(&r.old_target))
                .collect();
            let affected = gi.affected_sources(&stems);
            crate::graph::rewriter::plan_vault_rewrites_for_paths(&root, &redirects, &affected)?
        }
        None => crate::graph::rewriter::plan_vault_rewrites(&root, &redirects)?,
    };

    let summary = crate::graph::rewriter::apply_planned_rewrites(&root, &planned)?;

    let ann_enabled = crate::preferences::annotations_enabled(&app_handle);

    let mut reindex_err: Option<GraphError> = None;
    let mut all_removed: Vec<(String, String)> = Vec::new();
    for pr in &planned.rewrites {
        registry.record(&root.join(&pr.relative_path), &pr.after_content);
        if let Some(ref gi) = gi {
            match gi.reindex_file(&pr.relative_path, ann_enabled) {
                Ok(removed) => all_removed.extend(removed),
                Err(e) => { reindex_err = Some(e); }
            }
        }
    }

    if gi.is_some() {
        let result: Result<(), _> = match reindex_err {
            Some(e) => Err(e),
            None => Ok(()),
        };
        emit_reindex_side_effects_with_removed(&app_handle, &result, &all_removed);
    }

    Ok(summary)
}
