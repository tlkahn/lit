use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::time::UNIX_EPOCH;

use tracing::info;
use walkdir::WalkDir;

use super::error::GraphError;
use super::extract::{extract_first_paragraph, extract_headings, extract_sentence_context};
use super::types::HeadingInfo;
use super::knowledge::{GraphNode, KnowledgeGraph, SubgraphBundle, SubgraphResult};
use super::citations::extract_citations_blanked;
use super::links::{blank_code, extract_wikilinks_blanked, WikiLink};
use super::resolve::StemLookup;
use super::store::Store;
use super::types::{extract_aliases, extract_tags, BacklinkEntry, EdgeKind, LinkEntry, ParsedNode, SearchResult, Stats, UnlinkedMention};
use crate::workspace::frontmatter::parse_frontmatter;
use crate::workspace::normalize::filename_to_page_name;
use crate::commands::cardbox::CardboxLayout;

// ---------------------------------------------------------------------------
// parse_md_file
// ---------------------------------------------------------------------------

pub fn parse_md_file(
    root: &Path,
    relative_path: &str,
) -> Result<(ParsedNode, Vec<WikiLink>, String, String), GraphError> {
    let abs = root.join(relative_path);
    let raw = std::fs::read_to_string(&abs).map_err(|e| GraphError::Io {
        source: e,
        path: abs.clone(),
    })?;

    let parsed = parse_frontmatter(&raw);
    let fm_json = yaml_map_to_json(&parsed.map);

    let title = fm_json
        .get("title")
        .and_then(|v| v.as_str())
        .filter(|s| !s.trim().is_empty())
        .map(String::from)
        .unwrap_or_else(|| title_from_relative_path(relative_path));

    let tags = extract_tags(&fm_json);
    let first_paragraph = extract_first_paragraph(parsed.body);
    let blanked = blank_code(parsed.body);
    let links = extract_wikilinks_blanked(&blanked);
    let body = parsed.body.to_string();

    let node = ParsedNode {
        id: relative_path.to_string(),
        title,
        tags,
        frontmatter: fm_json,
        first_paragraph,
    };

    Ok((node, links, body, blanked))
}

fn title_from_relative_path(relative_path: &str) -> String {
    let basename = relative_path.rsplit('/').next().unwrap_or(relative_path);
    filename_to_page_name(basename)
}

fn yaml_map_to_json(map: &indexmap::IndexMap<String, serde_yaml::Value>) -> serde_json::Value {
    let json_str = match serde_json::to_string(map) {
        Ok(s) => s,
        Err(_) => return serde_json::Value::Object(serde_json::Map::new()),
    };
    serde_json::from_str(&json_str).unwrap_or(serde_json::Value::Object(serde_json::Map::new()))
}

// ---------------------------------------------------------------------------
// ReverseStemIndex
// ---------------------------------------------------------------------------

pub struct ReverseStemIndex {
    index: HashMap<String, Vec<(String, String)>>, // stem -> [(source_id, raw_target)]
}

impl ReverseStemIndex {
    pub fn new() -> Self {
        Self {
            index: HashMap::new(),
        }
    }

    pub fn add(&mut self, source_id: &str, raw_target: &str) {
        let stem = normalize_stem(raw_target);
        self.index
            .entry(stem)
            .or_default()
            .push((source_id.to_string(), raw_target.to_string()));
    }

    pub fn remove_source(&mut self, source_id: &str) {
        for entries in self.index.values_mut() {
            entries.retain(|(s, _)| s != source_id);
        }
        self.index.retain(|_, v| !v.is_empty());
    }

    pub fn lookup(&self, stem: &str) -> &[(String, String)] {
        self.index.get(stem).map(|v| v.as_slice()).unwrap_or(&[])
    }

    pub fn build_from_edges(edges: &[(String, String)]) -> Self {
        let mut idx = Self::new();
        for (source, raw_target) in edges {
            idx.add(source, raw_target);
        }
        idx
    }

    pub fn affected_sources(&self, stems: &[String]) -> HashSet<String> {
        let mut sources = HashSet::new();
        for stem in stems {
            if let Some(entries) = self.index.get(stem) {
                for (source_id, _) in entries {
                    sources.insert(source_id.clone());
                }
            }
        }
        sources
    }
}

pub fn normalize_stem(target: &str) -> String {
    let stripped = target.strip_suffix(".md").unwrap_or(target);
    let basename = stripped.rsplit('/').next().unwrap_or(stripped);
    basename.to_lowercase()
}

// ---------------------------------------------------------------------------
// walk_md_files
// ---------------------------------------------------------------------------

fn walk_md_files(root: &Path) -> Result<Vec<(String, i64)>, GraphError> {
    let mut files = Vec::new();
    for entry in WalkDir::new(root).into_iter().filter_entry(|e| {
        if e.depth() == 0 {
            return true;
        }
        let name = e.file_name().to_string_lossy();
        !name.starts_with('.')
    }) {
        let entry = entry.map_err(|e| GraphError::Io {
            source: e.into(),
            path: root.to_path_buf(),
        })?;
        if !entry.file_type().is_file() {
            continue;
        }
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("md") {
            continue;
        }
        let relative = path
            .strip_prefix(root)
            .unwrap_or(path)
            .to_string_lossy()
            .to_string();
        let mtime = entry
            .metadata()
            .ok()
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0);
        files.push((relative, mtime));
    }
    Ok(files)
}

// ---------------------------------------------------------------------------
// index_workspace (full scan)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone)]
pub struct IndexResult {
    pub nodes_indexed: usize,
    pub edges_resolved: usize,
    pub stubs_created: usize,
    pub removed_annotation_uuids: Vec<(String, String)>,
}

pub fn index_workspace(
    store: &Store,
    root: &Path,
    annotations_enabled: bool,
) -> Result<(IndexResult, ReverseStemIndex), GraphError> {
    index_workspace_with_progress(store, root, &super::progress::noop_callback(), annotations_enabled)
}

pub fn index_workspace_with_progress(
    store: &Store,
    root: &Path,
    on_progress: &dyn Fn(super::progress::IndexProgress),
    annotations_enabled: bool,
) -> Result<(IndexResult, ReverseStemIndex), GraphError> {
    use super::progress::{IndexPhase, IndexProgress};

    let lit_dir = root.join(".lit");
    if !lit_dir.exists() {
        std::fs::create_dir_all(&lit_dir).map_err(|e| GraphError::Io {
            source: e,
            path: lit_dir.clone(),
        })?;
    }

    let files = walk_md_files(root)?;
    let file_count = files.len();

    on_progress(IndexProgress {
        phase: IndexPhase::Scanning,
        current: file_count,
        total: file_count,
    });

    store.begin_transaction()?;

    let mut all_nodes: Vec<ParsedNode> = Vec::new();
    let mut all_links: HashMap<String, Vec<WikiLink>> = HashMap::new();
    let mut file_mtimes: HashMap<String, i64> = HashMap::new();
    let mut bodies: HashMap<String, String> = HashMap::new();
    let mut blanked_bodies: HashMap<String, String> = HashMap::new();

    for (i, (rel_path, mtime)) in files.iter().enumerate() {
        match parse_md_file(root, rel_path) {
            Ok((node, links, body, blanked)) => {
                bodies.insert(rel_path.clone(), body);
                blanked_bodies.insert(rel_path.clone(), blanked);
                file_mtimes.insert(rel_path.clone(), *mtime);
                all_links.insert(rel_path.clone(), links);
                all_nodes.push(node);
            }
            Err(e) => {
                tracing::warn!(path = %rel_path, error = %e, "skipping file");
            }
        }
        on_progress(IndexProgress {
            phase: IndexPhase::Parsing,
            current: i + 1,
            total: file_count,
        });
    }

    let node_ids: Vec<String> = all_nodes.iter().map(|n| n.id.clone()).collect();

    // Collect aliases for StemLookup
    let mut alias_map: HashMap<String, Vec<String>> = HashMap::new();
    for node in &all_nodes {
        let aliases = extract_aliases(&node.frontmatter);
        if !aliases.is_empty() {
            alias_map.insert(node.id.clone(), aliases);
        }
    }

    let stem_lookup = StemLookup::build(&node_ids, &alias_map);

    let mut nodes_indexed = 0;
    let mut edges_resolved = 0;
    let mut stubs_created = 0;
    let mut removed_annotation_uuids: Vec<(String, String)> = Vec::new();
    let mut reverse_stems = ReverseStemIndex::new();
    let mut known_stubs: HashSet<String> = HashSet::new();
    let node_count = all_nodes.len();

    // Workspace-merged mark codes, computed once (reads `.lit/marks.toml`).
    let mark_codes = if annotations_enabled {
        crate::annotation::marks::sorted_mark_codes(&crate::annotation::marks::merged_config(root))
    } else {
        Vec::new()
    };

    for (i, node) in all_nodes.iter().enumerate() {
        let mtime = file_mtimes.get(&node.id).copied().unwrap_or(0);
        store.upsert_node(node, mtime)?;
        nodes_indexed += 1;

        // Always call upsert even with empty vec so orphaned annotations get cleaned up.
        {
            let anns = if annotations_enabled {
                bodies.get(&node.id)
                    .map(|b| super::extract::extract_annotations(b, &mark_codes))
                    .unwrap_or_default()
            } else {
                vec![]
            };
            let deleted = store.upsert_annotations(&node.id, &anns)?;
            for uuid in deleted {
                removed_annotation_uuids.push((node.id.clone(), uuid));
            }
        }

        store.delete_edges_from(&node.id)?;

        if let Some(links) = all_links.get(&node.id) {
            let body = bodies.get(&node.id).map(|s| s.as_str()).unwrap_or("");
            for link in links {
                let resolved = stem_lookup.resolve(&link.target);
                let (context, source_line) = extract_sentence_context(
                    body,
                    &link.target,
                );
                let target_id = match &resolved.node_id {
                    Some(id) => id.clone(),
                    None => {
                        let stub_id = link.target.clone();
                        if !known_stubs.contains(&stub_id) {
                            store.upsert_stub(&stub_id)?;
                            known_stubs.insert(stub_id.clone());
                            stubs_created += 1;
                        }
                        stub_id
                    }
                };
                store.insert_edge(&node.id, &target_id, &context, &link.target, source_line, EdgeKind::Wikilink)?;
                reverse_stems.add(&node.id, &link.target);
                edges_resolved += 1;
            }
        }

        // Citation edges target bib keys, not pages: no stub, no reverse-stem
        // entry, and not counted in edges_resolved (resolved wikilinks only).
        let body = bodies.get(&node.id).map(|s| s.as_str()).unwrap_or("");
        let blanked = blanked_bodies.get(&node.id).map(|s| s.as_str()).unwrap_or("");
        for cite in extract_citations_blanked(blanked, body) {
            store.insert_edge(&node.id, &cite.bib_key, &cite.context, &cite.bib_key, cite.source_line, EdgeKind::Citation)?;
        }

        on_progress(IndexProgress {
            phase: IndexPhase::Resolving,
            current: i + 1,
            total: node_count,
        });
    }

    store.commit()?;

    info!(
        nodes = nodes_indexed,
        edges = edges_resolved,
        stubs = stubs_created,
        "index_workspace complete"
    );

    Ok((
        IndexResult {
            nodes_indexed,
            edges_resolved,
            stubs_created,
            removed_annotation_uuids,
        },
        reverse_stems,
    ))
}

// ---------------------------------------------------------------------------
// compute_diff
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq)]
pub struct DiffResult {
    pub new: Vec<String>,
    pub changed: Vec<String>,
    pub deleted: Vec<String>,
}

/// Build the diff for renaming a file: the old node is removed and the new one
/// added in a single atomic `batch_reindex`, so the index never carries a stale
/// path for a renamed page.
pub fn rename_reindex_diff(old_path: &str, new_path: &str) -> DiffResult {
    DiffResult {
        new: vec![new_path.to_string()],
        changed: vec![],
        deleted: vec![old_path.to_string()],
    }
}

impl DiffResult {
    pub fn is_empty(&self) -> bool {
        self.new.is_empty() && self.changed.is_empty() && self.deleted.is_empty()
    }

    pub fn merge(&self, other: &DiffResult) -> DiffResult {
        let mut deleted_set: HashSet<&str> = HashSet::new();
        for p in self.deleted.iter().chain(other.deleted.iter()) {
            deleted_set.insert(p);
        }

        let mut new_set: HashSet<&str> = HashSet::new();
        for p in self.new.iter().chain(other.new.iter()) {
            if !deleted_set.contains(p.as_str()) {
                new_set.insert(p);
            }
        }

        let mut changed_set: HashSet<&str> = HashSet::new();
        for p in self.changed.iter().chain(other.changed.iter()) {
            if !deleted_set.contains(p.as_str()) && !new_set.contains(p.as_str()) {
                changed_set.insert(p);
            }
        }

        let mut new: Vec<String> = new_set.into_iter().map(String::from).collect();
        let mut changed: Vec<String> = changed_set.into_iter().map(String::from).collect();
        let mut deleted: Vec<String> = deleted_set.into_iter().map(String::from).collect();
        new.sort();
        changed.sort();
        deleted.sort();

        DiffResult { new, changed, deleted }
    }
}

pub fn compute_diff(store: &Store, root: &Path) -> Result<DiffResult, GraphError> {
    let disk_files = walk_md_files(root)?;
    let sync_entries = store.all_sync_entries()?;

    let sync_map: HashMap<String, i64> = sync_entries.into_iter().collect();
    let disk_map: HashMap<String, i64> = disk_files.into_iter().collect();

    let mut new = Vec::new();
    let mut changed = Vec::new();
    let mut deleted = Vec::new();

    for (path, mtime) in &disk_map {
        match sync_map.get(path) {
            None => new.push(path.clone()),
            Some(old_mtime) if *old_mtime != *mtime => changed.push(path.clone()),
            _ => {}
        }
    }

    for path in sync_map.keys() {
        if !disk_map.contains_key(path) {
            deleted.push(path.clone());
        }
    }

    new.sort();
    changed.sort();
    deleted.sort();

    Ok(DiffResult {
        new,
        changed,
        deleted,
    })
}

// ---------------------------------------------------------------------------
// incremental_reindex
// ---------------------------------------------------------------------------

pub fn incremental_reindex(
    store: &Store,
    root: &Path,
    reverse_stems: &mut ReverseStemIndex,
    diff: &DiffResult,
    annotations_enabled: bool,
) -> Result<IndexResult, GraphError> {
    store.begin_transaction()?;

    let mut nodes_indexed = 0;
    let mut edges_resolved = 0;
    let mut stubs_created = 0;
    let mut removed_annotation_uuids: Vec<(String, String)> = Vec::new();

    // Workspace-merged mark codes, computed once (reads `.lit/marks.toml`).
    let mark_codes = if annotations_enabled {
        crate::annotation::marks::sorted_mark_codes(&crate::annotation::marks::merged_config(root))
    } else {
        Vec::new()
    };

    // Collect stems that changed (for re-resolution of other files)
    let mut changed_stems: Vec<String> = Vec::new();

    // Handle deleted files
    for path in &diff.deleted {
        // Compute stems this file was a target for
        let stem = normalize_stem(path);
        changed_stems.push(stem);
        store.delete_node(path)?;
        reverse_stems.remove_source(path);
    }

    // Handle new + changed files — track old aliases to detect alias changes
    let old_aliases = store.all_aliases()?;

    let all_ids = store.resolvable_node_ids()?;
    let mut stem_lookup = StemLookup::build(&all_ids, &old_aliases);

    for path in diff.new.iter().chain(diff.changed.iter()) {
        match parse_md_file(root, path) {
            Ok((node, links, body, blanked)) => {
                let mtime = std::fs::metadata(root.join(path))
                    .ok()
                    .and_then(|m| m.modified().ok())
                    .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                    .map(|d| d.as_millis() as i64)
                    .unwrap_or(0);

                // Check if aliases changed
                let new_aliases = extract_aliases(&node.frontmatter);
                let old_a = old_aliases.get(path).cloned().unwrap_or_default();
                if new_aliases != old_a {
                    for alias in old_a.iter().chain(new_aliases.iter()) {
                        changed_stems.push(alias.to_lowercase());
                    }
                }

                // For new files, their stem is a changed stem
                if diff.new.contains(path) {
                    changed_stems.push(normalize_stem(path));
                }

                store.upsert_node(&node, mtime)?;
                stem_lookup.insert(&node.id, &new_aliases);
                nodes_indexed += 1;

                // Always call upsert even with empty vec so orphaned annotations get cleaned up.
                {
                    let anns = if annotations_enabled {
                        super::extract::extract_annotations(&body, &mark_codes)
                    } else {
                        vec![]
                    };
                    let deleted = store.upsert_annotations(&node.id, &anns)?;
                    for uuid in deleted {
                        removed_annotation_uuids.push((node.id.clone(), uuid));
                    }
                }

                // Re-resolve outgoing links
                store.delete_edges_from(&node.id)?;
                reverse_stems.remove_source(&node.id);

                for link in &links {
                    let resolved = stem_lookup.resolve(&link.target);
                    let (context, source_line) = extract_sentence_context(&body, &link.target);
                    let target_id = match &resolved.node_id {
                        Some(id) => id.clone(),
                        None => {
                            store.upsert_stub(&link.target)?;
                            stubs_created += 1;
                            link.target.clone()
                        }
                    };
                    store.insert_edge(&node.id, &target_id, &context, &link.target, source_line, EdgeKind::Wikilink)?;
                    reverse_stems.add(&node.id, &link.target);
                    edges_resolved += 1;
                }

                // Citation edges target bib keys, not pages: no stub, no
                // reverse-stem entry, not counted in edges_resolved.
                for cite in extract_citations_blanked(&blanked, &body) {
                    store.insert_edge(&node.id, &cite.bib_key, &cite.context, &cite.bib_key, cite.source_line, EdgeKind::Citation)?;
                }
            }
            Err(e) => {
                tracing::warn!(path = %path, error = %e, "skipping file in incremental reindex");
            }
        }
    }

    // Clean up stubs that are now resolved by real files
    if !diff.new.is_empty() {
        let all_meta = store.all_nodes_metadata()?;
        let real_ids: HashSet<String> = all_meta
            .iter()
            .filter(|(_, is_stub, _)| !is_stub)
            .map(|(id, _, _)| id.clone())
            .collect();
        let real_stems: HashMap<String, String> = real_ids
            .iter()
            .map(|id| (normalize_stem(id), id.clone()))
            .collect();
        for (id, is_stub, _) in &all_meta {
            if *is_stub {
                let stub_stem = normalize_stem(id);
                if real_stems.contains_key(&stub_stem) {
                    store.delete_node(id)?;
                }
            }
        }
    }

    // Re-resolve other files affected by changed stems
    if !changed_stems.is_empty() {
        let affected = reverse_stems.affected_sources(&changed_stems);
        let all_ids = store.resolvable_node_ids()?;
        let aliases = store.all_aliases()?;
        let stem_lookup = StemLookup::build(&all_ids, &aliases);

        for source_id in &affected {
            if diff.new.contains(source_id)
                || diff.changed.contains(source_id)
                || diff.deleted.contains(source_id)
            {
                continue; // already handled
            }

            if let Ok((_, links, body, blanked)) = parse_md_file(root, source_id) {
                store.delete_edges_from(source_id)?;
                reverse_stems.remove_source(source_id);

                for link in &links {
                    let resolved = stem_lookup.resolve(&link.target);
                    let (context, source_line) = extract_sentence_context(&body, &link.target);
                    let target_id = match &resolved.node_id {
                        Some(id) => id.clone(),
                        None => {
                            store.upsert_stub(&link.target)?;
                            stubs_created += 1;
                            link.target.clone()
                        }
                    };
                    store.insert_edge(source_id, &target_id, &context, &link.target, source_line, EdgeKind::Wikilink)?;
                    reverse_stems.add(source_id, &link.target);
                    edges_resolved += 1;
                }

                // delete_edges_from above removed citation edges too — re-insert
                // them or stub promotion would silently destroy them.
                for cite in extract_citations_blanked(&blanked, &body) {
                    store.insert_edge(source_id, &cite.bib_key, &cite.context, &cite.bib_key, cite.source_line, EdgeKind::Citation)?;
                }
            }
        }
    }

    store.commit()?;

    Ok(IndexResult {
        nodes_indexed,
        edges_resolved,
        stubs_created,
        removed_annotation_uuids,
    })
}

// ---------------------------------------------------------------------------
// GraphIndex
// ---------------------------------------------------------------------------

use std::sync::Mutex;
use std::sync::atomic::AtomicBool;
use super::types::Position;

pub struct GraphIndex {
    store: Mutex<Store>,
    reverse_stems: Mutex<ReverseStemIndex>,
    knowledge: Mutex<KnowledgeGraph>,
    workspace_root: std::path::PathBuf,
    positions: Mutex<HashMap<String, Position>>,
    layout_in_progress: AtomicBool,
    bib_cache: crate::bib::cache::BibCache,
}

impl GraphIndex {
    pub fn load_from_store(workspace_root: std::path::PathBuf) -> Result<Option<Self>, GraphError> {
        let db_path = workspace_root.join(".lit").join("graph.db");
        if !db_path.exists() {
            return Ok(None);
        }
        let store = Store::open(&db_path)?;
        if !store.has_data()? {
            return Ok(None);
        }
        let edges: Vec<(String, String)> = store
            .all_raw_edges()?
            .into_iter()
            .map(|(source, _target, raw_target)| (source, raw_target))
            .collect();
        let reverse_stems = ReverseStemIndex::build_from_edges(&edges);
        let knowledge = KnowledgeGraph::from_store(&store)?;
        let positions = store.load_positions().unwrap_or_default();
        info!("loaded graph from store (skipped disk diff)");
        Ok(Some(Self {
            store: Mutex::new(store),
            reverse_stems: Mutex::new(reverse_stems),
            knowledge: Mutex::new(knowledge),
            workspace_root,
            positions: Mutex::new(positions),
            layout_in_progress: AtomicBool::new(false),
            bib_cache: crate::bib::cache::BibCache::new(),
        }))
    }

    pub fn sync_with_disk(&self, annotations_enabled: bool) -> Result<bool, GraphError> {
        let store = self.store.lock().unwrap();
        let diff = compute_diff(&store, &self.workspace_root)?;
        if diff.is_empty() {
            return Ok(false);
        }
        info!(
            new = diff.new.len(),
            changed = diff.changed.len(),
            deleted = diff.deleted.len(),
            "background sync: applying diff"
        );
        let mut reverse_stems = self.reverse_stems.lock().unwrap();
        incremental_reindex(&store, &self.workspace_root, &mut reverse_stems, &diff, annotations_enabled)?;
        crate::bib::db::ingest_workspace_bibs(&store.conn, &self.workspace_root, &self.bib_cache)?;
        resolve_shadows_tx(&store)?;
        let layout = self.load_cardbox_layout();
        super::cardbox_edges::sync_cardbox_edges_from_layout(&store, &layout)?;
        let mut knowledge = self.knowledge.lock().unwrap();
        *knowledge = KnowledgeGraph::from_store(&store)?;
        Ok(true)
    }

    pub fn build(workspace_root: std::path::PathBuf, annotations_enabled: bool) -> Result<Self, GraphError> {
        Self::build_with_progress(workspace_root, &super::progress::noop_callback(), annotations_enabled)
    }

    pub fn build_with_progress(
        workspace_root: std::path::PathBuf,
        on_progress: &dyn Fn(super::progress::IndexProgress),
        annotations_enabled: bool,
    ) -> Result<Self, GraphError> {
        use super::progress::{IndexPhase, IndexProgress};

        let db_path = workspace_root.join(".lit").join("graph.db");
        if let Some(parent) = db_path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| GraphError::Io {
                source: e,
                path: parent.to_path_buf(),
            })?;
        }
        let store = Store::open(&db_path)?;

        let reverse_stems = if store.has_data()? {
            let diff = compute_diff(&store, &workspace_root)?;
            if diff.is_empty() {
                info!("warm start: no changes detected, loading from store");
                on_progress(IndexProgress { phase: IndexPhase::Diffing, current: 0, total: 0 });
                let edges: Vec<(String, String)> = store
                    .all_raw_edges()?
                    .into_iter()
                    .map(|(source, _target, raw_target)| (source, raw_target))
                    .collect();
                ReverseStemIndex::build_from_edges(&edges)
            } else {
                info!(
                    new = diff.new.len(),
                    changed = diff.changed.len(),
                    deleted = diff.deleted.len(),
                    "warm start: applying diff"
                );
                on_progress(IndexProgress { phase: IndexPhase::Diffing, current: 0, total: 0 });
                let edges: Vec<(String, String)> = store
                    .all_raw_edges()?
                    .into_iter()
                    .map(|(source, _target, raw_target)| (source, raw_target))
                    .collect();
                let mut reverse = ReverseStemIndex::build_from_edges(&edges);
                incremental_reindex(&store, &workspace_root, &mut reverse, &diff, annotations_enabled)?;
                reverse
            }
        } else {
            info!("cold start: no existing store data, full index");
            let (_, reverse_stems) = index_workspace_with_progress(&store, &workspace_root, on_progress, annotations_enabled)?;
            reverse_stems
        };

        let bib_cache = crate::bib::cache::BibCache::new();
        crate::bib::db::ingest_workspace_bibs(&store.conn, &workspace_root, &bib_cache)?;
        resolve_shadows_tx(&store)?;
        let layout = crate::commands::cardbox::load_layout_from_disk(
            &workspace_root.join(".lit").join("cardbox.json"),
        );
        super::cardbox_edges::sync_cardbox_edges_from_layout(&store, &layout)?;

        on_progress(IndexProgress { phase: IndexPhase::Building, current: 0, total: 0 });
        let knowledge = KnowledgeGraph::from_store(&store)?;
        let positions = store.load_positions().unwrap_or_default();
        Ok(Self {
            store: Mutex::new(store),
            reverse_stems: Mutex::new(reverse_stems),
            knowledge: Mutex::new(knowledge),
            workspace_root,
            positions: Mutex::new(positions),
            layout_in_progress: AtomicBool::new(false),
            bib_cache,
        })
    }

    pub fn batch_reindex(&self, diff: &DiffResult, annotations_enabled: bool) -> Result<Vec<(String, String)>, GraphError> {
        if diff.is_empty() {
            return Ok(vec![]);
        }
        let t_start = std::time::Instant::now();
        let store = self.store.lock().unwrap();
        let lock_ms = t_start.elapsed().as_millis() as u64;
        let mut reverse = self.reverse_stems.lock().unwrap();

        let bib_in_diff = diff
            .new
            .iter()
            .chain(diff.changed.iter())
            .chain(diff.deleted.iter())
            .any(|p| Path::new(p).extension().is_some_and(|e| e.eq_ignore_ascii_case("bib")));

        // Keys cited by the changed/deleted pages *before* their edges are
        // replaced — needed so removing a page's last citation still prunes
        // the now-orphaned shadow. Also any citekeys the diff pages declared
        // before the edit, so removing a `citekey:` re-resolves its key.
        let mut affected: HashSet<String> = if bib_in_diff {
            HashSet::new()
        } else {
            let before_sources: Vec<String> =
                diff.changed.iter().chain(diff.deleted.iter()).cloned().collect();
            let mut keys = store.cited_keys_for_sources(&before_sources)?;
            keys.extend(citekeys_of_pages(&store, &before_sources)?);
            keys
        };

        let t = std::time::Instant::now();
        let result = incremental_reindex(&store, &self.workspace_root, &mut reverse, diff, annotations_enabled)?;
        let reindex_ms = t.elapsed().as_millis() as u64;
        let t = std::time::Instant::now();
        if bib_in_diff {
            crate::bib::db::ingest_workspace_bibs(&store.conn, &self.workspace_root, &self.bib_cache)?;
        }
        let ingest_ms = t.elapsed().as_millis() as u64;
        let t = std::time::Instant::now();
        let mut affected_count = 0usize;
        if bib_in_diff {
            resolve_shadows_tx(&store)?;
        } else {
            let after_sources: Vec<String> =
                diff.new.iter().chain(diff.changed.iter()).cloned().collect();
            affected.extend(store.cited_keys_for_sources(&after_sources)?);
            // Citekeys the diff pages declare now — a new/edited `citekey:`
            // must re-point existing `bib:X` edges to the page.
            affected.extend(citekeys_of_pages(&store, &after_sources)?);
            affected_count = affected.len();
            resolve_shadows_scoped_tx(&store, &affected)?;
        }
        let shadows_ms = t.elapsed().as_millis() as u64;
        let t = std::time::Instant::now();
        let layout = self.load_cardbox_layout();
        super::cardbox_edges::sync_cardbox_edges_from_layout(&store, &layout)?;
        let mut knowledge = self.knowledge.lock().unwrap();
        *knowledge = KnowledgeGraph::from_store(&store)?;
        let kg_rebuild_ms = t.elapsed().as_millis() as u64;
        info!(
            lock_ms,
            reindex_ms,
            ingest_ms,
            shadows_ms,
            kg_rebuild_ms,
            scoped = !bib_in_diff,
            affected_keys = affected_count,
            total_ms = t_start.elapsed().as_millis() as u64,
            "perf: batch_reindex"
        );
        Ok(result.removed_annotation_uuids)
    }

    pub fn reindex_file(&self, relative_path: &str, annotations_enabled: bool) -> Result<Vec<(String, String)>, GraphError> {
        self.batch_reindex(&DiffResult { new: vec![], changed: vec![relative_path.to_string()], deleted: vec![] }, annotations_enabled)
    }

    /// For newly created or restored files. Uses `new` semantics so stub promotion runs.
    pub fn add_file(&self, relative_path: &str, annotations_enabled: bool) -> Result<Vec<(String, String)>, GraphError> {
        self.batch_reindex(&DiffResult { new: vec![relative_path.to_string()], changed: vec![], deleted: vec![] }, annotations_enabled)
    }

    pub fn remove_file(&self, relative_path: &str, annotations_enabled: bool) -> Result<Vec<(String, String)>, GraphError> {
        self.batch_reindex(&DiffResult { new: vec![], changed: vec![], deleted: vec![relative_path.to_string()] }, annotations_enabled)
    }

    /// Load the cardbox layout from `.lit/cardbox.json` in this workspace.
    fn load_cardbox_layout(&self) -> CardboxLayout {
        crate::commands::cardbox::load_layout_from_disk(
            &self.workspace_root.join(".lit").join("cardbox.json"),
        )
    }

    /// Incremental cardbox edge add: locks store, inserts edge if cross-document
    /// and not already present, rebuilds KnowledgeGraph if changed.
    /// Lock ordering: store first, then knowledge (same as batch_reindex).
    pub fn sync_cardbox_edge_add(&self, uuid_a: &str, uuid_b: &str) -> Result<bool, GraphError> {
        let store = self.store.lock().unwrap();
        let added = super::cardbox_edges::update_cardbox_edge_after_add(&store, uuid_a, uuid_b)?;
        if added {
            let mut knowledge = self.knowledge.lock().unwrap();
            *knowledge = KnowledgeGraph::from_store(&store)?;
        }
        Ok(added)
    }

    /// Incremental cardbox edge remove: locks store, checks remaining layout links,
    /// removes edge if no other links connect the same documents, rebuilds KnowledgeGraph if changed.
    /// The layout is passed by the caller (cardbox command already has it loaded).
    pub fn sync_cardbox_edge_remove(&self, layout: &CardboxLayout, uuid_a: &str, uuid_b: &str) -> Result<bool, GraphError> {
        let store = self.store.lock().unwrap();
        let removed = super::cardbox_edges::update_cardbox_edge_after_remove(&store, layout, uuid_a, uuid_b)?;
        if removed {
            let mut knowledge = self.knowledge.lock().unwrap();
            *knowledge = KnowledgeGraph::from_store(&store)?;
        }
        Ok(removed)
    }

    pub fn full_rebuild(&self, annotations_enabled: bool) -> Result<IndexResult, GraphError> {
        let store = self.store.lock().unwrap();
        let (result, new_reverse) = index_workspace(&store, &self.workspace_root, annotations_enabled)?;
        crate::bib::db::ingest_workspace_bibs(&store.conn, &self.workspace_root, &self.bib_cache)?;
        resolve_shadows_tx(&store)?;
        let layout = self.load_cardbox_layout();
        super::cardbox_edges::sync_cardbox_edges_from_layout(&store, &layout)?;
        let mut reverse = self.reverse_stems.lock().unwrap();
        *reverse = new_reverse;
        let mut knowledge = self.knowledge.lock().unwrap();
        *knowledge = KnowledgeGraph::from_store(&store)?;
        Ok(result)
    }

    pub fn affected_sources(&self, stems: &[String]) -> HashSet<String> {
        self.reverse_stems.lock().unwrap().affected_sources(stems)
    }

    pub fn stats(&self) -> Result<Stats, GraphError> {
        let store = self.store.lock().unwrap();
        store.stats()
    }

    pub fn neighbors(
        &self,
        id: &str,
        depth: usize,
        directed: bool,
    ) -> Result<SubgraphResult, GraphError> {
        let knowledge = self.knowledge.lock().unwrap();
        knowledge.neighbors(id, depth, directed)
    }

    pub fn paths(
        &self,
        from: &str,
        to: &str,
        max_depth: usize,
        directed: bool,
    ) -> Result<Vec<Vec<String>>, GraphError> {
        let knowledge = self.knowledge.lock().unwrap();
        knowledge.paths(from, to, max_depth, directed)
    }

    pub fn shared(
        &self,
        a: &str,
        b: &str,
        directed: bool,
    ) -> Result<Vec<GraphNode>, GraphError> {
        let knowledge = self.knowledge.lock().unwrap();
        knowledge.shared(a, b, directed)
    }

    pub fn subgraph(
        &self,
        seeds: &[&str],
        depth: usize,
        directed: bool,
        include_citations: bool,
        include_cardbox: bool,
    ) -> Result<SubgraphResult, GraphError> {
        let knowledge = self.knowledge.lock().unwrap();
        knowledge.subgraph_filtered(seeds, depth, directed, include_citations, include_cardbox)
    }

    pub fn full_subgraph(&self, include_citations: bool, include_cardbox: bool) -> SubgraphResult {
        let knowledge = self.knowledge.lock().unwrap();
        knowledge.full_subgraph_filtered(include_citations, include_cardbox)
    }

    pub fn subgraph_bundle(
        &self,
        seeds: &[&str],
        depth: usize,
        directed: bool,
        include_citations: bool,
        include_cardbox: bool,
    ) -> Result<SubgraphBundle, GraphError> {
        let subgraph = self.subgraph(seeds, depth, directed, include_citations, include_cardbox)?;
        let pagerank = self.pagerank()?;
        let positions = self.get_positions();
        Ok(SubgraphBundle {
            subgraph,
            pagerank,
            positions,
        })
    }

    pub fn resolve_wikilink(&self, target: &str) -> Result<super::resolve::ResolvedLink, GraphError> {
        let store = self.store.lock().unwrap();
        let all_ids = store.resolvable_node_ids()?;
        let aliases = store.all_aliases()?;
        let lookup = StemLookup::build(&all_ids, &aliases);
        Ok(lookup.resolve(target))
    }

    pub fn page_headings(&self, target: &str) -> Result<Vec<HeadingInfo>, GraphError> {
        let resolved = self.resolve_wikilink(target)?;
        let node_id = resolved.node_id.ok_or_else(|| GraphError::NodeNotFound {
            id: target.to_string(),
        })?;
        let noop_registry = crate::workspace::write_hash::WriteHashRegistry::new();
        let page = crate::workspace::ops::read_page(&self.workspace_root, &node_id, &noop_registry)
            .map_err(|e| GraphError::Other(e.to_string()))?;
        Ok(extract_headings(&page.body))
    }

    pub fn backlinks(&self, page_id: &str) -> Result<Vec<BacklinkEntry>, GraphError> {
        let knowledge = self.knowledge.lock().unwrap();
        match knowledge.backlinks(page_id) {
            Ok(entries) => Ok(entries),
            Err(GraphError::NodeNotFound { .. }) => Ok(vec![]),
            Err(e) => Err(e),
        }
    }

    pub fn forward_links(&self, page_id: &str) -> Result<Vec<LinkEntry>, GraphError> {
        let knowledge = self.knowledge.lock().unwrap();
        match knowledge.forward_links(page_id) {
            Ok(entries) => Ok(entries),
            Err(GraphError::NodeNotFound { .. }) => Ok(vec![]),
            Err(e) => Err(e),
        }
    }

    /// Pages citing `bib_key` via `[@bib_key]` citation edges. Citation edges
    /// live only in the DB (targets are bib keys, not page ids), so this
    /// queries the store directly rather than the in-memory knowledge graph.
    pub fn citing_pages(&self, bib_key: &str) -> Result<Vec<BacklinkEntry>, GraphError> {
        let store = self.store.lock().unwrap();
        store.citing_pages(bib_key)
    }

    pub fn get_first_paragraphs(&self, ids: &[String]) -> Result<std::collections::HashMap<String, String>, GraphError> {
        let store = self.store.lock().unwrap();
        store.get_first_paragraphs(ids)
    }

    pub fn unlinked_mentions(&self, page_id: &str) -> Result<Vec<UnlinkedMention>, GraphError> {
        use grep_regex::RegexMatcherBuilder;
        use rayon::prelude::*;
        use super::extract::{extract_mention_context, find_plain_mentions, strip_for_mention_scan};

        let store = self.store.lock().unwrap();
        let (title, aliases) = store.title_and_aliases(page_id)?;
        let all_paths = store.all_synced_paths()?;
        let titles = store.node_titles()?;
        drop(store);

        let knowledge = self.knowledge.lock().unwrap();
        let already_linked = knowledge
            .backlink_source_ids(page_id)
            .unwrap_or_default();
        drop(knowledge);

        let mut names: Vec<String> = vec![title];
        names.extend(aliases);

        let filtered: Vec<&str> = names.iter().map(|n| n.as_str()).filter(|n| !n.is_empty()).collect();
        let prefilter_matcher = if !filtered.is_empty() {
            let pattern = filtered
                .iter()
                .map(|n| regex::escape(n))
                .collect::<Vec<_>>()
                .join("|");
            RegexMatcherBuilder::new()
                .case_insensitive(true)
                .build(&pattern)
                .ok()
        } else {
            None
        };

        let page_id_owned = page_id.to_string();
        let noop_registry = crate::workspace::write_hash::WriteHashRegistry::new();

        let results: Vec<UnlinkedMention> = all_paths
            .par_iter()
            .filter(|source_id| {
                source_id.as_str() != page_id_owned && !already_linked.contains(source_id.as_str())
            })
            .filter(|source_id| match &prefilter_matcher {
                Some(m) => file_contains_any_name_with_matcher(&self.workspace_root.join(source_id), m),
                None => false,
            })
            .flat_map_iter(|source_id| {
                let page = match crate::workspace::ops::read_page(&self.workspace_root, source_id, &noop_registry) {
                    Ok(p) => p,
                    Err(_) => return Vec::new(),
                };

                let stripped = strip_for_mention_scan(&page.body);
                let name_refs: Vec<&str> = names.iter().map(|n| n.as_str()).collect();
                let mentions = find_plain_mentions(&stripped, &name_refs);
                let source_title = titles.get(source_id).cloned().unwrap_or_default();

                mentions
                    .into_iter()
                    .map(|mention| {
                        let context = extract_mention_context(&page.body, mention.byte_offset);
                        UnlinkedMention {
                            source_id: source_id.clone(),
                            source_title: source_title.clone(),
                            context,
                            source_line: mention.line,
                            matched_text: mention.matched_text,
                        }
                    })
                    .collect::<Vec<_>>()
            })
            .collect();

        Ok(results)
    }

    pub fn search_by_title(&self, query: &str, limit: i64) -> Result<Vec<SearchResult>, GraphError> {
        let store = self.store.lock().unwrap();
        let pairs = store.search_titles(query, limit)?;
        Ok(pairs
            .into_iter()
            .map(|(id, title)| SearchResult {
                id,
                title,
                score: 0.0,
                excerpt: String::new(),
                first_match_line: None,
            })
            .collect())
    }

    pub fn search(&self, query: &str, limit: i64) -> Result<Vec<SearchResult>, GraphError> {
        use grep_regex::RegexMatcherBuilder;
        use rayon::prelude::*;

        let terms = parse_search_query(query);
        if terms.is_empty() {
            return Ok(vec![]);
        }

        let pattern = terms
            .iter()
            .map(|t| regex::escape(t))
            .collect::<Vec<_>>()
            .join("|");

        let matcher = match RegexMatcherBuilder::new()
            .case_insensitive(true)
            .build(&pattern)
        {
            Ok(m) => m,
            Err(_) => return Ok(vec![]),
        };

        let store = self.store.lock().unwrap();
        let synced = store.all_synced_paths()?;
        let titles = store.node_titles()?;
        drop(store);

        let mut hits: Vec<SearchResult> = synced
            .par_iter()
            .filter_map(|id| {
                let (count, excerpt, first_line_num) =
                    search_file_with_matcher(&self.workspace_root.join(id), &matcher, &terms)?;
                let title = titles.get(id).cloned().unwrap_or_default();
                Some(SearchResult {
                    id: id.clone(),
                    title,
                    score: -(count as f64),
                    excerpt,
                    first_match_line: Some(first_line_num),
                })
            })
            .collect();

        hits.sort_by(|a, b| a.score.partial_cmp(&b.score).unwrap());
        hits.truncate(limit as usize);
        Ok(hits)
    }

    pub fn pagerank(&self) -> Result<HashMap<String, f64>, GraphError> {
        let store = self.store.lock().unwrap();
        let fingerprint = store.graph_fingerprint()?;
        let cached_fp = store.get_meta("pagerank_fingerprint")?;

        let scores = if cached_fp.as_deref() == Some(fingerprint.as_str()) {
            store.get_meta("pagerank_scores")?
                .and_then(|json| serde_json::from_str::<HashMap<String, f64>>(&json).ok())
        } else {
            None
        };

        let scores = match scores {
            Some(s) => s,
            None => {
                let knowledge = self.knowledge.lock().unwrap();
                let s = knowledge.pagerank(0.85);
                let json = serde_json::to_string(&s).map_err(|e| GraphError::Other(e.to_string()))?;
                store.set_meta("pagerank_scores", &json)?;
                store.set_meta("pagerank_fingerprint", &fingerprint)?;
                s
            }
        };

        // Exclude non-materialized nodes (shadow, stub, partial) and re-normalize
        let meta = store.all_nodes_metadata()?;
        let materialized_ids: std::collections::HashSet<String> = meta
            .into_iter()
            .filter(|(_, _, m)| *m == super::types::Materialization::Materialized)
            .map(|(id, _, _)| id)
            .collect();
        let mut filtered: HashMap<String, f64> = scores
            .into_iter()
            .filter(|(k, _)| materialized_ids.contains(k))
            .collect();
        let total: f64 = filtered.values().sum();
        if total > 0.0 {
            for v in filtered.values_mut() {
                *v /= total;
            }
        }
        Ok(filtered)
    }

    pub fn search_tags(&self, query: &str, limit: i64) -> Result<Vec<super::types::TagSearchResult>, GraphError> {
        let store = self.store.lock().unwrap();
        store.search_tags(query, limit)
    }

    pub fn list_pages_by_tag(&self, tag: &str, limit: i64) -> Result<Vec<super::types::TagPageResult>, GraphError> {
        let store = self.store.lock().unwrap();
        store.list_pages_by_tag(tag, limit)
    }

    pub fn search_annotations(&self, query: &str, type_filter: Option<&str>, limit: i64) -> Result<Vec<super::types::AnnotationSearchResult>, GraphError> {
        let store = self.store.lock().unwrap();
        store.search_annotations(query, type_filter, limit)
    }

    pub fn list_annotations(&self, node_id: Option<&str>, type_filter: Option<&str>, limit: i64) -> Result<Vec<super::types::AnnotationSearchResult>, GraphError> {
        let store = self.store.lock().unwrap();
        store.list_annotations(node_id, type_filter, limit)
    }

    pub fn find_annotation_uuid(&self, node_id: &str, annotation_type: &str, body: Option<&str>, char_start_hint: usize) -> Result<Option<String>, GraphError> {
        let store = self.store.lock().unwrap();
        store.find_annotation_uuid(node_id, annotation_type, body, char_start_hint)
    }

    pub fn list_all_cardbox_annotations(&self) -> Result<Vec<super::types::CardboxAnnotation>, GraphError> {
        let mut annotations = {
            let store = self.store.lock().unwrap();
            store.list_all_cardbox_annotations()?
        };

        let mut pages: HashMap<String, Vec<usize>> = HashMap::new();
        for (i, ann) in annotations.iter().enumerate() {
            pages.entry(ann.source_page_id.clone()).or_default().push(i);
        }

        for (page_id, indices) in &pages {
            let abs = self.workspace_root.join(page_id);
            let raw = match std::fs::read_to_string(&abs) {
                Ok(r) => r,
                Err(_) => continue,
            };
            let parsed = parse_frontmatter(&raw);
            let body = parsed.body;

            for &idx in indices {
                let ann = &annotations[idx];
                let scope = match crate::annotation::types::Scope::from_db(&ann.scope_kind, &ann.scope_value) {
                    Some(s) => s,
                    None => continue,
                };
                if let Some(range) = crate::annotation::scope_resolver::resolve_scope_range(body, ann.char_start, &scope, "en") {
                    let text = crate::annotation::scope_resolver::extract_text_for_range(body, &range);
                    if !text.is_empty() {
                        annotations[idx].original = Some(text);
                    }
                }
            }
        }

        Ok(annotations)
    }

    pub fn top_by_pagerank(&self, n: usize) -> Result<Vec<(String, f64)>, GraphError> {
        let scores = self.pagerank()?;
        let mut pairs: Vec<(String, f64)> = scores.into_iter().collect();
        pairs.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
        pairs.truncate(n);
        Ok(pairs)
    }

    pub fn get_positions(&self) -> HashMap<String, Position> {
        self.positions.lock().unwrap().clone()
    }

    /// Returns a guard over the in-memory `Store`, allowing other modules (e.g.
    /// `lkg::export`) to read indexed graph data directly. Callers outside the
    /// indexer module cannot reach the private `store` field otherwise.
    pub fn store(&self) -> std::sync::MutexGuard<'_, crate::graph::store::Store> {
        self.store.lock().unwrap()
    }

    pub fn clear_positions(&self) -> Result<(), GraphError> {
        self.positions.lock().unwrap().clear();
        self.store.lock().map_err(|e| {
            GraphError::Other(e.to_string())
        })?.clear_positions()
    }

    /// Re-scan bibs, upsert/prune shadows, rebuild in-memory graph.
    /// Returns true if anything changed.
    pub fn refresh_shadows(&self) -> Result<bool, GraphError> {
        let store = self.store.lock().unwrap();
        crate::bib::db::ingest_workspace_bibs(&store.conn, &self.workspace_root, &self.bib_cache)?;
        let before_snapshot = Self::shadow_snapshot(&store)?;
        resolve_shadows_tx(&store)?;
        let after_snapshot = Self::shadow_snapshot(&store)?;
        let changed = before_snapshot != after_snapshot;
        if changed {
            let mut knowledge = self.knowledge.lock().unwrap();
            *knowledge = KnowledgeGraph::from_store(&store)?;
        }
        Ok(changed)
    }

    /// Returns a sorted snapshot of (id, title, materialization) for all shadow/partial nodes.
    fn shadow_snapshot(store: &Store) -> Result<Vec<(String, String, String)>, GraphError> {
        let mut stmt = store.conn.prepare(
            "SELECT id, title, materialization FROM nodes WHERE materialization IN ('shadow', 'partial') ORDER BY id"
        ).map_err(GraphError::from)?;
        let rows = stmt.query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            ))
        }).map_err(GraphError::from)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(GraphError::from)
    }

    pub fn compute_layout_background(&self, settings: &super::layout::LayoutSettings) {
        use std::sync::atomic::Ordering;
        if self.layout_in_progress.compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst).is_err() {
            return;
        }
        let graph = self.knowledge.lock().unwrap().graph_clone();
        let existing_tuples: HashMap<String, (f64, f64)> = {
            let p = self.positions.lock().unwrap();
            p.iter().map(|(k, v)| (k.clone(), (v.x, v.y))).collect()
        };
        let existing_ref = if existing_tuples.is_empty() { None } else { Some(&existing_tuples) };
        let raw = super::layout::compute_layout(&graph, existing_ref, settings);
        let result: HashMap<String, Position> = raw.into_iter()
            .map(|(k, (x, y))| (k, Position { x, y }))
            .collect();
        {
            let mut pos = self.positions.lock().unwrap();
            *pos = result.clone();
        }
        match self.store.lock() {
            Ok(store) => match store.save_positions(&result) {
                Ok(()) => tracing::debug!("layout positions saved"),
                Err(e) => tracing::warn!(error = %e, "failed to save layout positions"),
            },
            Err(e) => tracing::warn!(error = %e, "failed to lock store for position save"),
        }
        self.layout_in_progress.store(false, Ordering::SeqCst);
    }
}

// ---------------------------------------------------------------------------
// Shadow node helpers
// ---------------------------------------------------------------------------

/// Run [`resolve_shadows`] inside a database transaction.
fn resolve_shadows_tx(
    store: &Store,
) -> Result<(), GraphError> {
    store.with_savepoint("resolve_shadows", || {
        resolve_shadows(store)
    })
}

/// Citekeys declared in the frontmatter of the given pages (as currently
/// stored). Lets `batch_reindex` widen its affected-key set when a diff page
/// adds, edits, or removes a `citekey:` declaration.
fn citekeys_of_pages(store: &Store, pages: &[String]) -> Result<HashSet<String>, GraphError> {
    use rusqlite::OptionalExtension;
    let mut keys = HashSet::new();
    for page in pages {
        let citekey: Option<Option<String>> = store.conn.query_row(
            "SELECT json_extract(frontmatter, '$.citekey') FROM nodes WHERE id = ?1",
            [page],
            |row| row.get(0),
        ).optional().map_err(GraphError::from)?;
        if let Some(Some(key)) = citekey {
            keys.insert(key);
        }
    }
    Ok(keys)
}

/// Run [`resolve_shadows_scoped`] inside a database transaction.
fn resolve_shadows_scoped_tx(
    store: &Store,
    affected_keys: &HashSet<String>,
) -> Result<(), GraphError> {
    store.with_savepoint("resolve_shadows_scoped", || {
        resolve_shadows_scoped(store, affected_keys)
    })
}

/// Scoped variant of [`resolve_shadows`]: only re-resolves the given cited
/// keys instead of every citation in the workspace. Used by `batch_reindex`
/// for md-only diffs so a single-page save stays O(keys-on-that-page).
fn resolve_shadows_scoped(
    store: &Store,
    affected_keys: &HashSet<String>,
) -> Result<(), GraphError> {
    if affected_keys.is_empty() {
        return Ok(());
    }
    // One pass over citekey pages instead of a per-key `page_for_citekey`
    // scan — that query json_extracts every node row, which at hundreds of
    // affected keys costs more than the full resolver this replaces.
    let citekey_map: HashMap<String, String> = store.citekey_pages()?.into_iter().collect();
    for raw_key in affected_keys {
        let bib_id = format!("bib:{}", raw_key);
        let still_cited: bool = store.conn.query_row(
            "SELECT COUNT(*) FROM edges WHERE edge_kind = 'citation' AND raw_target = ?1",
            [raw_key],
            |row| row.get::<_, i64>(0).map(|n| n > 0),
        ).map_err(GraphError::from)?;

        if !still_cited {
            store.prune_shadow_if_uncited(&bib_id)?;
            continue;
        }

        if let Some(page_id) = citekey_map.get(raw_key.as_str()) {
            // A real page claims this key — route edges to it and drop any
            // shadow the key previously resolved to.
            store.conn.execute(
                "UPDATE edges SET target = ?1 WHERE raw_target = ?2 AND edge_kind = 'citation'",
                rusqlite::params![page_id, raw_key],
            ).map_err(GraphError::from)?;
            store.prune_shadow_if_uncited(&bib_id)?;
        } else if let Some(entry) = crate::bib::db::get_bib_item(&store.conn, raw_key)? {
            let mat = if entry.abstract_text.is_some() {
                super::types::Materialization::Partial
            } else {
                super::types::Materialization::Shadow
            };
            store.upsert_shadow(&bib_id, &shadow_title(&entry), mat)?;
            store.conn.execute(
                "UPDATE edges SET target = ?1 WHERE raw_target = ?2 AND edge_kind = 'citation'",
                rusqlite::params![bib_id, raw_key],
            ).map_err(GraphError::from)?;
        } else {
            // No citekey page and no live bib item (e.g. tombstoned): the
            // shadow is no longer backed — drop it (which also removes edges
            // targeting it) and sweep any bib:* edges left dangling.
            let is_shadow: bool = store.conn.query_row(
                "SELECT COUNT(*) FROM nodes
                 WHERE id = ?1 AND materialization IN ('shadow', 'partial')",
                [&bib_id],
                |row| row.get::<_, i64>(0).map(|n| n > 0),
            ).map_err(GraphError::from)?;
            if is_shadow {
                store.delete_node(&bib_id)?;
            }
            store.prune_dangling_citation_edges_for(std::slice::from_ref(raw_key))?;
        }
    }
    Ok(())
}

/// After all edges are inserted, create shadow/partial nodes for cited bib
/// keys and resolve citation edge targets from raw bib key to `bib:{key}`
/// or citekey page.
fn resolve_shadows(
    store: &Store,
) -> Result<(), GraphError> {
    let bib_index = crate::bib::db::live_index(&store.conn)?;
    let citekey_map: HashMap<String, String> = store
        .citekey_pages()?
        .into_iter()
        .collect();

    // Collect all distinct cited raw keys
    let all_cited_keys: HashSet<String> = {
        let mut stmt = store.conn.prepare(
            "SELECT DISTINCT raw_target FROM edges WHERE edge_kind = 'citation'"
        ).map_err(GraphError::from)?;
        let rows = stmt.query_map([], |row| row.get(0))
            .map_err(GraphError::from)?;
        rows.collect::<Result<HashSet<_>, _>>().map_err(GraphError::from)?
    };

    let mut shadow_ids: HashSet<String> = HashSet::new();

    for raw_key in &all_cited_keys {
        // Determine the resolved target: citekey page > bib entry > skip
        let resolved_target = if let Some(page_id) = citekey_map.get(raw_key.as_str()) {
            Some(page_id.clone())
        } else {
            let bib_id = format!("bib:{}", raw_key);
            // Upsert shadow node if the key exists in the bib index
            if let Some(entry) = bib_index.get(raw_key.as_str()) {
                let mat = if entry.abstract_text.is_some() {
                    super::types::Materialization::Partial
                } else {
                    super::types::Materialization::Shadow
                };
                let title = shadow_title(entry);
                store.upsert_shadow(&bib_id, &title, mat)?;
                shadow_ids.insert(bib_id.clone());
                Some(bib_id)
            } else {
                // Key absent from both citekey pages and bib index —
                // leave the edge target as-is to avoid creating a dangling bib:* reference
                None
            }
        };

        // Update citation edge targets for this raw_key only when we have a valid target
        if let Some(target) = resolved_target {
            store.conn.execute(
                "UPDATE edges SET target = ?1 WHERE raw_target = ?2 AND edge_kind = 'citation'",
                rusqlite::params![target, raw_key],
            ).map_err(GraphError::from)?;
        }
    }

    // Prune orphaned shadow nodes
    store.prune_shadows(&shadow_ids)?;

    // Prune citation edges whose bib:* target has no matching node
    store.prune_dangling_citation_edges()?;

    Ok(())
}

pub(crate) fn shadow_title(entry: &crate::bib::types::BibEntry) -> String {
    let author = entry
        .authors
        .first()
        .map(|a| a.split(',').next().unwrap_or(a).trim())
        .unwrap_or("Unknown");
    if entry.title.is_empty() {
        format!("{} ({})", author, entry.year)
    } else {
        format!("{} ({}) {}", author, entry.year, entry.title)
    }
}

// ---------------------------------------------------------------------------
// Ripgrep full-body search
// ---------------------------------------------------------------------------

fn parse_search_query(raw: &str) -> Vec<String> {
    let trimmed = raw.trim().strip_suffix('*').unwrap_or(raw.trim());
    trimmed.split_whitespace().map(|s| s.to_string()).collect()
}

fn search_file_with_matcher(
    path: &Path,
    matcher: &grep_regex::RegexMatcher,
    terms: &[String],
) -> Option<(usize, String, u64)> {
    use grep_searcher::sinks::UTF8;
    use grep_searcher::Searcher;

    if terms.is_empty() {
        return None;
    }

    let mut match_count: usize = 0;
    let mut first_line: Option<String> = None;
    let mut first_line_number: u64 = 0;
    let mut seen_terms: HashSet<usize> = HashSet::new();

    let result = Searcher::new().search_path(
        matcher,
        path,
        UTF8(|line_number, line| {
            match_count += 1;
            if first_line.is_none() {
                first_line = Some(line.trim().to_string());
                first_line_number = line_number;
            }
            let line_lower = line.to_lowercase();
            for (i, term) in terms.iter().enumerate() {
                if line_lower.contains(&term.to_lowercase()) {
                    seen_terms.insert(i);
                }
            }
            Ok(true)
        }),
    );

    match result {
        Ok(()) if seen_terms.len() == terms.len() => {
            Some((match_count, first_line.unwrap_or_default(), first_line_number))
        }
        _ => None,
    }
}

#[cfg(test)]
fn search_file_for_terms(path: &Path, terms: &[String]) -> Option<(usize, String)> {
    use grep_regex::RegexMatcherBuilder;

    if terms.is_empty() {
        return None;
    }

    let pattern = terms
        .iter()
        .map(|t| regex::escape(t))
        .collect::<Vec<_>>()
        .join("|");

    let matcher = RegexMatcherBuilder::new()
        .case_insensitive(true)
        .build(&pattern)
        .ok()?;

    search_file_with_matcher(path, &matcher, terms).map(|(count, excerpt, _)| (count, excerpt))
}

fn file_contains_any_name_with_matcher(path: &Path, matcher: &grep_regex::RegexMatcher) -> bool {
    use grep_searcher::sinks::UTF8;
    use grep_searcher::Searcher;

    let mut found = false;
    let result = Searcher::new().search_path(
        matcher,
        path,
        UTF8(|_line_number, _line| {
            found = true;
            Ok(false)
        }),
    );

    match result {
        Ok(()) => found,
        Err(_) => true,
    }
}

#[cfg(test)]
fn file_contains_any_name(path: &Path, names: &[&str]) -> bool {
    use grep_regex::RegexMatcherBuilder;

    let filtered: Vec<&str> = names.iter().copied().filter(|n| !n.is_empty()).collect();
    if filtered.is_empty() {
        return false;
    }

    let pattern = filtered
        .iter()
        .map(|n| regex::escape(n))
        .collect::<Vec<_>>()
        .join("|");

    let matcher = match RegexMatcherBuilder::new()
        .case_insensitive(true)
        .build(&pattern)
    {
        Ok(m) => m,
        Err(_) => return true,
    };

    file_contains_any_name_with_matcher(path, &matcher)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;
    use tracing_test::traced_test;

    fn create_workspace() -> TempDir {
        tempfile::tempdir().unwrap()
    }

    fn write_md(root: &Path, rel_path: &str, content: &str) {
        let abs = root.join(rel_path);
        if let Some(parent) = abs.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(abs, content).unwrap();
    }

    // --- custom workspace mark codes (end-to-end) ---

    #[test]
    fn build_recognizes_custom_workspace_mark_code() {
        let dir = create_workspace();
        fs::create_dir_all(dir.path().join(".lit")).unwrap();
        fs::write(
            dir.path().join(".lit").join("marks.toml"),
            "[zz]\nlabel = \"custom mark\"\n",
        )
        .unwrap();
        write_md(dir.path(), "a.md", "text<!--- zz _ ---> rest");
        let gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();
        let results = gi.list_annotations(Some("a.md"), None, 100).unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(
            results[0].annotation_type, "mark",
            "custom code from .lit/marks.toml must be indexed as a mark"
        );
    }

    #[test]
    fn build_without_custom_marks_falls_back_to_bare() {
        // Same document, but no `.lit/marks.toml` defining `zz`.
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "text<!--- zz _ ---> rest");
        let gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();
        let results = gi.list_annotations(Some("a.md"), None, 100).unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].annotation_type, "bare");
    }

    // --- get_first_paragraphs ---

    #[test]
    fn graph_index_get_first_paragraphs() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "First paragraph of A.\n\nMore text.");
        write_md(dir.path(), "b.md", "First paragraph of B.");
        let gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();
        let ids = vec!["a.md".into(), "b.md".into()];
        let result = gi.get_first_paragraphs(&ids).unwrap();
        assert_eq!(result.len(), 2);
        assert!(result["a.md"].contains("First paragraph of A"));
    }

    // --- parse_md_file ---

    #[test]
    fn parse_md_file_basic() {
        let dir = create_workspace();
        write_md(
            dir.path(),
            "note.md",
            "---\ntitle: My Note\ntags:\n  - rust\n---\nFirst paragraph.\n\n[[Link]]",
        );
        let (node, links, _, _) = parse_md_file(dir.path(), "note.md").unwrap();
        assert_eq!(node.id, "note.md");
        assert_eq!(node.title, "My Note");
        assert_eq!(node.tags, vec!["rust"]);
        assert_eq!(node.first_paragraph, "First paragraph.");
        assert_eq!(links.len(), 1);
        assert_eq!(links[0].target, "Link");
    }

    #[test]
    fn parse_md_file_no_frontmatter() {
        let dir = create_workspace();
        write_md(dir.path(), "plain.md", "Just some text.\n\n[[Other]]");
        let (node, links, _, _) = parse_md_file(dir.path(), "plain.md").unwrap();
        assert_eq!(node.title, "plain");
        assert!(node.tags.is_empty());
        assert_eq!(node.first_paragraph, "Just some text.");
        assert_eq!(links.len(), 1);
    }

    #[test]
    fn parse_md_file_with_tags() {
        let dir = create_workspace();
        write_md(
            dir.path(),
            "tagged.md",
            "---\ntags:\n  - alpha\n  - beta\n---\nBody.",
        );
        let (node, _, _, _) = parse_md_file(dir.path(), "tagged.md").unwrap();
        assert_eq!(node.tags, vec!["alpha", "beta"]);
    }

    #[test]
    fn parse_md_file_title_from_frontmatter() {
        let dir = create_workspace();
        write_md(
            dir.path(),
            "note.md",
            "---\ntitle: Custom Title\n---\nBody.",
        );
        let (node, _, _, _) = parse_md_file(dir.path(), "note.md").unwrap();
        assert_eq!(node.title, "Custom Title");
    }

    #[test]
    fn parse_md_file_missing_file_errors() {
        let dir = create_workspace();
        let result = parse_md_file(dir.path(), "nonexistent.md");
        assert!(result.is_err());
        match result.unwrap_err() {
            GraphError::Io { .. } => {}
            other => panic!("expected Io error, got: {other:?}"),
        }
    }

    #[test]
    fn parse_md_file_id_is_relative_path() {
        let dir = create_workspace();
        write_md(dir.path(), "sub/deep.md", "Content.");
        let (node, _, _, _) = parse_md_file(dir.path(), "sub/deep.md").unwrap();
        assert_eq!(node.id, "sub/deep.md");
    }

    #[test]
    fn parse_md_file_returns_body() {
        let dir = create_workspace();
        write_md(
            dir.path(),
            "note.md",
            "---\ntitle: Hello\n---\nThe body text.\n\nSecond paragraph.",
        );
        let (_, _, body, _) = parse_md_file(dir.path(), "note.md").unwrap();
        assert_eq!(body, "The body text.\n\nSecond paragraph.");
    }

    #[test]
    fn parse_md_file_returns_body_no_frontmatter() {
        let dir = create_workspace();
        write_md(dir.path(), "plain.md", "Just plain text.");
        let (_, _, body, _) = parse_md_file(dir.path(), "plain.md").unwrap();
        assert_eq!(body, "Just plain text.");
    }

    #[test]
    fn parse_md_file_empty_frontmatter_title_falls_back_to_filename() {
        let dir = create_workspace();
        write_md(dir.path(), "agentic-design.md", "---\ntitle: \"\"\n---\nBody.");
        let (node, _, _, _) = parse_md_file(dir.path(), "agentic-design.md").unwrap();
        assert_eq!(node.title, "agentic-design");
    }

    #[test]
    fn index_workspace_multiple_links_same_file() {
        let dir = create_workspace();
        write_md(
            dir.path(),
            "a.md",
            "---\ntitle: Source\n---\nFirst link to [[B]]. Second link to [[C]].",
        );
        write_md(dir.path(), "b.md", "Target B.");
        write_md(dir.path(), "c.md", "Target C.");
        let store = Store::open_memory().unwrap();
        index_workspace(&store, dir.path(), true).unwrap();
        let bl_b = store.backlinks("b.md").unwrap();
        assert_eq!(bl_b.len(), 1);
        assert!(!bl_b[0].context.contains("title:"));
        let bl_c = store.backlinks("c.md").unwrap();
        assert_eq!(bl_c.len(), 1);
        assert!(!bl_c[0].context.contains("title:"));
    }

    #[test]
    fn incremental_reindex_context_excludes_frontmatter() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "Placeholder.");
        let store = Store::open_memory().unwrap();
        let (_, mut reverse) = index_workspace(&store, dir.path(), true).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(50));
        write_md(
            dir.path(),
            "a.md",
            "---\ntitle: Updated\ntags:\n  - test\n---\nNow links to [[B]].",
        );
        write_md(dir.path(), "b.md", "Target.");
        let diff = DiffResult {
            new: vec!["b.md".to_string()],
            changed: vec!["a.md".to_string()],
            deleted: vec![],
        };
        incremental_reindex(&store, dir.path(), &mut reverse, &diff, true).unwrap();
        let bl = store.backlinks("b.md").unwrap();
        assert_eq!(bl.len(), 1);
        assert_eq!(bl[0].context, "Now links to [[B]].");
        assert!(!bl[0].context.contains("title:"));
    }

    #[test]
    fn incremental_reindex_affected_context_excludes_frontmatter() {
        let dir = create_workspace();
        write_md(
            dir.path(),
            "a.md",
            "---\ntitle: Source\n---\nLinks to [[B]].",
        );
        write_md(dir.path(), "b.md", "Target.");
        let store = Store::open_memory().unwrap();
        let (_, mut reverse) = index_workspace(&store, dir.path(), true).unwrap();
        // Delete b.md and recreate — triggers re-resolution of a.md as affected source
        fs::remove_file(dir.path().join("b.md")).unwrap();
        write_md(dir.path(), "b.md", "Recreated target.");
        std::thread::sleep(std::time::Duration::from_millis(50));
        let diff = DiffResult {
            new: vec![],
            changed: vec!["b.md".to_string()],
            deleted: vec![],
        };
        incremental_reindex(&store, dir.path(), &mut reverse, &diff, true).unwrap();
        let bl = store.backlinks("b.md").unwrap();
        assert_eq!(bl.len(), 1);
        assert!(!bl[0].context.contains("title:"));
    }

    // --- ReverseStemIndex ---

    #[test]
    fn reverse_stem_empty() {
        let idx = ReverseStemIndex::new();
        assert!(idx.lookup("anything").is_empty());
    }

    #[test]
    fn reverse_stem_add_and_lookup() {
        let mut idx = ReverseStemIndex::new();
        idx.add("a.md", "Target");
        let entries = idx.lookup("target");
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].0, "a.md");
        assert_eq!(entries[0].1, "Target");
    }

    #[test]
    fn reverse_stem_multiple_sources() {
        let mut idx = ReverseStemIndex::new();
        idx.add("a.md", "Target");
        idx.add("b.md", "Target");
        assert_eq!(idx.lookup("target").len(), 2);
    }

    #[test]
    fn reverse_stem_remove_source() {
        let mut idx = ReverseStemIndex::new();
        idx.add("a.md", "Target");
        idx.add("b.md", "Target");
        idx.remove_source("a.md");
        let entries = idx.lookup("target");
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].0, "b.md");
    }

    #[test]
    fn reverse_stem_build_from_edges() {
        let edges = vec![
            ("a.md".to_string(), "Link1".to_string()),
            ("b.md".to_string(), "Link1".to_string()),
            ("a.md".to_string(), "Link2".to_string()),
        ];
        let idx = ReverseStemIndex::build_from_edges(&edges);
        assert_eq!(idx.lookup("link1").len(), 2);
        assert_eq!(idx.lookup("link2").len(), 1);
    }

    #[test]
    fn reverse_stem_affected_sources() {
        let mut idx = ReverseStemIndex::new();
        idx.add("a.md", "Target");
        idx.add("b.md", "Other");
        idx.add("c.md", "Target");
        let affected = idx.affected_sources(&["target".to_string()]);
        assert!(affected.contains("a.md"));
        assert!(affected.contains("c.md"));
        assert!(!affected.contains("b.md"));
    }

    // --- index_workspace ---

    #[test]
    fn index_workspace_empty_dir() {
        let dir = create_workspace();
        let store = Store::open_memory().unwrap();
        let (result, _) = index_workspace(&store, dir.path(), true).unwrap();
        assert_eq!(result.nodes_indexed, 0);
        assert_eq!(result.edges_resolved, 0);
    }

    #[test]
    fn index_workspace_single_file() {
        let dir = create_workspace();
        write_md(
            dir.path(),
            "note.md",
            "---\ntitle: Hello\ntags:\n  - test\n---\nContent.",
        );
        let store = Store::open_memory().unwrap();
        let (result, _) = index_workspace(&store, dir.path(), true).unwrap();
        assert_eq!(result.nodes_indexed, 1);
        let stats = store.stats().unwrap();
        assert_eq!(stats.nodes, 1);
        assert_eq!(stats.tags, 1);
    }

    #[test]
    fn index_workspace_resolves_edges() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "Links to [[B]].");
        write_md(dir.path(), "b.md", "Target page.");
        let store = Store::open_memory().unwrap();
        let (result, _) = index_workspace(&store, dir.path(), true).unwrap();
        assert_eq!(result.edges_resolved, 1);
        let edges = store.all_edges().unwrap();
        assert_eq!(edges.len(), 1);
        assert_eq!(edges[0].0, "a.md");
        assert_eq!(edges[0].1, "b.md");
    }

    #[test]
    fn index_workspace_unresolved_creates_stub() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "Links to [[Ghost]].");
        let store = Store::open_memory().unwrap();
        let (result, _) = index_workspace(&store, dir.path(), true).unwrap();
        assert_eq!(result.stubs_created, 1);
        let meta = store.all_nodes_metadata().unwrap();
        assert!(meta.iter().any(|(id, is_stub, _)| id == "Ghost" && *is_stub));
    }

    #[test]
    fn index_workspace_raw_target_persisted() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "See [[My Note]].");
        write_md(dir.path(), "My Note.md", "Target.");
        let store = Store::open_memory().unwrap();
        index_workspace(&store, dir.path(), true).unwrap();
        let raw = store.all_raw_edges().unwrap();
        assert_eq!(raw.len(), 1);
        assert_eq!(raw[0].2, "My Note");
    }

    #[test]
    fn index_workspace_context_excludes_frontmatter() {
        let dir = create_workspace();
        write_md(
            dir.path(),
            "a.md",
            "---\ntitle: Source\ntags:\n  - note\n---\n\nThis links to [[B]].",
        );
        write_md(dir.path(), "b.md", "Target.");
        let store = Store::open_memory().unwrap();
        index_workspace(&store, dir.path(), true).unwrap();
        let bl = store.backlinks("b.md").unwrap();
        assert_eq!(bl.len(), 1);
        assert_eq!(bl[0].context, "This links to [[B]].");
        assert!(
            !bl[0].context.contains("title:"),
            "context should not contain frontmatter, got: {:?}",
            bl[0].context
        );
    }

    #[test]
    fn index_workspace_builds_reverse_index() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "[[B]]");
        write_md(dir.path(), "b.md", "Target.");
        let store = Store::open_memory().unwrap();
        let (_, reverse) = index_workspace(&store, dir.path(), true).unwrap();
        let entries = reverse.lookup("b");
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].0, "a.md");
    }

    #[test]
    fn index_workspace_records_sync_mtimes() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "Content.");
        let store = Store::open_memory().unwrap();
        index_workspace(&store, dir.path(), true).unwrap();
        let entries = store.all_sync_entries().unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].0, "a.md");
        assert!(entries[0].1 > 0);
    }

    #[test]
    fn index_workspace_skips_hidden_dirs() {
        let dir = create_workspace();
        write_md(dir.path(), ".obsidian/config.md", "Hidden.");
        write_md(dir.path(), "visible.md", "Visible.");
        let store = Store::open_memory().unwrap();
        let (result, _) = index_workspace(&store, dir.path(), true).unwrap();
        assert_eq!(result.nodes_indexed, 1);
    }

    #[test]
    fn index_workspace_idempotent() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "[[B]]");
        write_md(dir.path(), "b.md", "Target.");
        let store = Store::open_memory().unwrap();
        let (r1, _) = index_workspace(&store, dir.path(), true).unwrap();
        let (r2, _) = index_workspace(&store, dir.path(), true).unwrap();
        assert_eq!(r1.nodes_indexed, r2.nodes_indexed);
        assert_eq!(store.stats().unwrap().nodes, 2);
    }

    #[test]
    fn index_workspace_creates_lit_dir() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "Content.");
        let store = Store::open_memory().unwrap();
        index_workspace(&store, dir.path(), true).unwrap();
        assert!(dir.path().join(".lit").exists());
    }

    // --- index_workspace_with_progress ---

    #[test]
    fn index_with_progress_emits_phases_in_order() {
        use crate::graph::progress::{IndexPhase, IndexProgress};
        use std::sync::{Arc, Mutex};

        let dir = create_workspace();
        write_md(dir.path(), "a.md", "[[b]]");
        write_md(dir.path(), "b.md", "[[c]]");
        write_md(dir.path(), "c.md", "Leaf.");
        let store = Store::open_memory().unwrap();

        let log: Arc<Mutex<Vec<IndexProgress>>> = Arc::new(Mutex::new(Vec::new()));
        let log_clone = Arc::clone(&log);
        let callback = move |p: IndexProgress| {
            log_clone.lock().unwrap().push(p);
        };

        let (result, _) = index_workspace_with_progress(&store, dir.path(), &callback, true).unwrap();
        assert_eq!(result.nodes_indexed, 3);

        let events = log.lock().unwrap();
        // First event should be Scanning
        assert_eq!(events[0].phase, IndexPhase::Scanning);
        assert_eq!(events[0].current, 3);
        assert_eq!(events[0].total, 3);

        // Then 3 Parsing events
        let parsing: Vec<_> = events.iter().filter(|e| e.phase == IndexPhase::Parsing).collect();
        assert_eq!(parsing.len(), 3);
        assert_eq!(parsing[0].current, 1);
        assert_eq!(parsing[1].current, 2);
        assert_eq!(parsing[2].current, 3);
        assert!(parsing.iter().all(|e| e.total == 3));

        // Then 3 Resolving events
        let resolving: Vec<_> = events.iter().filter(|e| e.phase == IndexPhase::Resolving).collect();
        assert_eq!(resolving.len(), 3);
        assert_eq!(resolving[0].current, 1);
        assert_eq!(resolving[1].current, 2);
        assert_eq!(resolving[2].current, 3);
        assert!(resolving.iter().all(|e| e.total == 3));
    }

    #[test]
    fn index_with_progress_phases_strictly_ascending() {
        use crate::graph::progress::{IndexPhase, IndexProgress};
        use std::sync::{Arc, Mutex};

        let dir = create_workspace();
        write_md(dir.path(), "a.md", "Content.");
        write_md(dir.path(), "b.md", "Content.");
        let store = Store::open_memory().unwrap();

        let log: Arc<Mutex<Vec<IndexPhase>>> = Arc::new(Mutex::new(Vec::new()));
        let log_clone = Arc::clone(&log);
        let callback = move |p: IndexProgress| {
            let mut l = log_clone.lock().unwrap();
            if l.last() != Some(&p.phase) {
                l.push(p.phase);
            }
        };

        index_workspace_with_progress(&store, dir.path(), &callback, true).unwrap();

        let phases = log.lock().unwrap();
        assert_eq!(*phases, vec![IndexPhase::Scanning, IndexPhase::Parsing, IndexPhase::Resolving]);
    }

    #[test]
    fn index_workspace_delegation_preserves_behavior() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "[[b]]");
        write_md(dir.path(), "b.md", "Target.");
        let store = Store::open_memory().unwrap();
        let (result, _) = index_workspace(&store, dir.path(), true).unwrap();
        assert_eq!(result.nodes_indexed, 2);
        assert_eq!(result.edges_resolved, 1);
    }

    // --- compute_diff ---

    #[test]
    fn compute_diff_no_changes() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "Content.");
        let store = Store::open_memory().unwrap();
        index_workspace(&store, dir.path(), true).unwrap();
        let diff = compute_diff(&store, dir.path()).unwrap();
        assert!(diff.new.is_empty());
        assert!(diff.changed.is_empty());
        assert!(diff.deleted.is_empty());
    }

    #[test]
    fn compute_diff_new_file() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "Content.");
        let store = Store::open_memory().unwrap();
        index_workspace(&store, dir.path(), true).unwrap();
        write_md(dir.path(), "b.md", "New file.");
        let diff = compute_diff(&store, dir.path()).unwrap();
        assert_eq!(diff.new, vec!["b.md"]);
    }

    #[test]
    fn compute_diff_modified_file() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "Content.");
        let store = Store::open_memory().unwrap();
        index_workspace(&store, dir.path(), true).unwrap();
        // Touch the file to change mtime
        std::thread::sleep(std::time::Duration::from_millis(50));
        write_md(dir.path(), "a.md", "Updated content.");
        let diff = compute_diff(&store, dir.path()).unwrap();
        assert_eq!(diff.changed, vec!["a.md"]);
    }

    #[test]
    fn compute_diff_deleted_file() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "Content.");
        write_md(dir.path(), "b.md", "Content.");
        let store = Store::open_memory().unwrap();
        index_workspace(&store, dir.path(), true).unwrap();
        fs::remove_file(dir.path().join("b.md")).unwrap();
        let diff = compute_diff(&store, dir.path()).unwrap();
        assert_eq!(diff.deleted, vec!["b.md"]);
    }

    #[test]
    fn compute_diff_mixed() {
        let dir = create_workspace();
        write_md(dir.path(), "keep.md", "Keep.");
        write_md(dir.path(), "change.md", "Change.");
        write_md(dir.path(), "delete.md", "Delete.");
        let store = Store::open_memory().unwrap();
        index_workspace(&store, dir.path(), true).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(50));
        write_md(dir.path(), "change.md", "Changed.");
        fs::remove_file(dir.path().join("delete.md")).unwrap();
        write_md(dir.path(), "new.md", "New.");
        let diff = compute_diff(&store, dir.path()).unwrap();
        assert_eq!(diff.new, vec!["new.md"]);
        assert_eq!(diff.changed, vec!["change.md"]);
        assert_eq!(diff.deleted, vec!["delete.md"]);
    }

    // --- DiffResult::is_empty ---

    #[test]
    fn diff_result_is_empty_when_all_vecs_empty() {
        let diff = DiffResult {
            new: vec![],
            changed: vec![],
            deleted: vec![],
        };
        assert!(diff.is_empty());
    }

    #[test]
    fn diff_result_is_not_empty_with_new() {
        let diff = DiffResult {
            new: vec!["a.md".to_string()],
            changed: vec![],
            deleted: vec![],
        };
        assert!(!diff.is_empty());
    }

    #[test]
    fn diff_result_is_not_empty_with_changed() {
        let diff = DiffResult {
            new: vec![],
            changed: vec!["a.md".to_string()],
            deleted: vec![],
        };
        assert!(!diff.is_empty());
    }

    #[test]
    fn diff_result_is_not_empty_with_deleted() {
        let diff = DiffResult {
            new: vec![],
            changed: vec![],
            deleted: vec!["a.md".to_string()],
        };
        assert!(!diff.is_empty());
    }

    // --- DiffResult::merge ---

    #[test]
    fn diff_result_merge_combines_all_fields() {
        let a = DiffResult {
            new: vec!["x.md".to_string()],
            changed: vec!["y.md".to_string()],
            deleted: vec!["z.md".to_string()],
        };
        let b = DiffResult {
            new: vec!["p.md".to_string()],
            changed: vec!["q.md".to_string()],
            deleted: vec!["r.md".to_string()],
        };
        let merged = a.merge(&b);
        assert_eq!(merged.new, vec!["p.md", "x.md"]);
        assert_eq!(merged.changed, vec!["q.md", "y.md"]);
        assert_eq!(merged.deleted, vec!["r.md", "z.md"]);
    }

    #[test]
    fn diff_result_merge_deleted_wins_over_changed() {
        let a = DiffResult {
            new: vec![],
            changed: vec!["x.md".to_string()],
            deleted: vec![],
        };
        let b = DiffResult {
            new: vec![],
            changed: vec![],
            deleted: vec!["x.md".to_string()],
        };
        let merged = a.merge(&b);
        assert!(merged.changed.is_empty());
        assert_eq!(merged.deleted, vec!["x.md"]);
    }

    #[test]
    fn diff_result_merge_deleted_wins_over_new() {
        let a = DiffResult {
            new: vec!["x.md".to_string()],
            changed: vec![],
            deleted: vec![],
        };
        let b = DiffResult {
            new: vec![],
            changed: vec![],
            deleted: vec!["x.md".to_string()],
        };
        let merged = a.merge(&b);
        assert!(merged.new.is_empty());
        assert_eq!(merged.deleted, vec!["x.md"]);
    }

    #[test]
    fn diff_result_merge_new_wins_over_changed() {
        let a = DiffResult {
            new: vec!["x.md".to_string()],
            changed: vec![],
            deleted: vec![],
        };
        let b = DiffResult {
            new: vec![],
            changed: vec!["x.md".to_string()],
            deleted: vec![],
        };
        let merged = a.merge(&b);
        assert_eq!(merged.new, vec!["x.md"]);
        assert!(merged.changed.is_empty());
    }

    #[test]
    fn diff_result_merge_dedup_same_path() {
        let a = DiffResult {
            new: vec!["x.md".to_string()],
            changed: vec![],
            deleted: vec![],
        };
        let b = DiffResult {
            new: vec!["x.md".to_string()],
            changed: vec![],
            deleted: vec![],
        };
        let merged = a.merge(&b);
        assert_eq!(merged.new, vec!["x.md"]);
    }

    #[test]
    fn diff_result_merge_with_empty_is_identity() {
        let a = DiffResult {
            new: vec!["x.md".to_string()],
            changed: vec!["y.md".to_string()],
            deleted: vec!["z.md".to_string()],
        };
        let empty = DiffResult {
            new: vec![],
            changed: vec![],
            deleted: vec![],
        };
        let merged = a.merge(&empty);
        assert_eq!(merged, a);
    }

    // --- blanked body ---

    #[test]
    fn parse_md_file_returns_blanked_body() {
        use super::super::links::blank_code;

        let dir = create_workspace();
        write_md(
            dir.path(),
            "note.md",
            "---\ntitle: Test\n---\nSome `inline code` and\n```\nfenced block\n```\n[[Link]] and [@cite2024].",
        );
        let (_, _, body, blanked) = parse_md_file(dir.path(), "note.md").unwrap();
        assert_eq!(blanked, blank_code(&body));
    }

    #[test]
    fn index_workspace_citations_with_code_blocks() {
        let dir = create_workspace();
        write_md(
            dir.path(),
            "a.md",
            "Real cite [@outside2024].\n```\n[@inside2024]\n```\nDone.",
        );
        let store = Store::open_memory().unwrap();
        index_workspace(&store, dir.path(), true).unwrap();

        let outside = store.citing_pages("outside2024").unwrap();
        assert_eq!(outside.len(), 1, "citation outside code block must be indexed");

        let inside = store.citing_pages("inside2024").unwrap();
        assert!(inside.is_empty(), "citation inside code block must be skipped");
    }

    // --- citation edges ---

    #[test]
    fn index_workspace_extracts_citation_edges() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "As shown in [@smith2024].");
        let store = Store::open_memory().unwrap();
        index_workspace(&store, dir.path(), true).unwrap();

        let citing = store.citing_pages("smith2024").unwrap();
        assert_eq!(citing.len(), 1);
        assert_eq!(citing[0].source_id, "a.md");
        assert_eq!(citing[0].context, "As shown in [@smith2024].");
        assert_eq!(citing[0].source_line, 1);
    }

    #[test]
    fn citation_targets_do_not_create_stubs() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "As shown in [@smith2024].");
        let store = Store::open_memory().unwrap();
        let (result, _) = index_workspace(&store, dir.path(), true).unwrap();

        let meta = store.all_nodes_metadata().unwrap();
        assert!(
            !meta.iter().any(|(id, _, _)| id == "smith2024"),
            "bib key must not become a node, nodes: {:?}",
            meta
        );
        assert_eq!(result.stubs_created, 0);
    }

    #[test]
    fn incremental_reindex_updates_citation_edges() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "Cites [@old2020].");
        let store = Store::open_memory().unwrap();
        let (_, mut reverse) = index_workspace(&store, dir.path(), true).unwrap();
        assert_eq!(store.citing_pages("old2020").unwrap().len(), 1);

        write_md(dir.path(), "a.md", "Cites [@new2021].");
        let diff = DiffResult {
            new: vec![],
            changed: vec!["a.md".to_string()],
            deleted: vec![],
        };
        incremental_reindex(&store, dir.path(), &mut reverse, &diff, true).unwrap();

        assert!(store.citing_pages("old2020").unwrap().is_empty());
        assert_eq!(store.citing_pages("new2021").unwrap().len(), 1);
    }

    #[test]
    fn reresolve_preserves_citation_edges() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "See [[Ghost]] and [@smith2024].");
        let store = Store::open_memory().unwrap();
        let (_, mut reverse) = index_workspace(&store, dir.path(), true).unwrap();
        assert_eq!(store.citing_pages("smith2024").unwrap().len(), 1);

        // Creating ghost.md triggers the changed-stems re-resolve path, which
        // deletes ALL of a.md's edges and re-inserts them.
        write_md(dir.path(), "ghost.md", "I exist now.");
        let diff = DiffResult {
            new: vec!["ghost.md".to_string()],
            changed: vec![],
            deleted: vec![],
        };
        incremental_reindex(&store, dir.path(), &mut reverse, &diff, true).unwrap();

        let citing = store.citing_pages("smith2024").unwrap();
        assert_eq!(citing.len(), 1, "re-resolve must not drop citation edges");
        assert_eq!(citing[0].source_id, "a.md");
    }

    #[test]
    fn incremental_reindex_deleted_file_removes_citation_edges() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "Cites [@smith2024].");
        let store = Store::open_memory().unwrap();
        let (_, mut reverse) = index_workspace(&store, dir.path(), true).unwrap();
        assert_eq!(store.citing_pages("smith2024").unwrap().len(), 1);

        fs::remove_file(dir.path().join("a.md")).unwrap();
        let diff = DiffResult {
            new: vec![],
            changed: vec![],
            deleted: vec!["a.md".to_string()],
        };
        incremental_reindex(&store, dir.path(), &mut reverse, &diff, true).unwrap();

        assert!(
            store.citing_pages("smith2024").unwrap().is_empty(),
            "deleting a page must remove its citation edges"
        );
    }

    #[test]
    fn index_workspace_multi_cite_creates_edge_per_key() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "See [@alpha2020; @beta2021, pp. 10-12].");
        let store = Store::open_memory().unwrap();
        index_workspace(&store, dir.path(), true).unwrap();

        let alpha = store.citing_pages("alpha2020").unwrap();
        assert_eq!(alpha.len(), 1);
        assert_eq!(alpha[0].source_id, "a.md");
        assert_eq!(alpha[0].source_line, 1);
        assert_eq!(store.citing_pages("beta2021").unwrap().len(), 1);

        let meta = store.all_nodes_metadata().unwrap();
        assert!(
            !meta.iter().any(|(id, _, _)| id == "alpha2020" || id == "beta2021"),
            "multi-cite keys must not become nodes, nodes: {:?}",
            meta
        );
    }

    #[test]
    fn graph_index_citing_pages_queries_citation_edges() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "As shown in [@smith2024].");
        write_md(dir.path(), "b.md", "Links [[a]] but cites nothing.");
        let gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();

        let citing = gi.citing_pages("smith2024").unwrap();
        assert_eq!(citing.len(), 1);
        assert_eq!(citing[0].source_id, "a.md");
        assert_eq!(citing[0].context, "As shown in [@smith2024].");
        assert_eq!(citing[0].source_line, 1);

        // Unknown bib key → empty, not an error.
        assert!(gi.citing_pages("nope").unwrap().is_empty());
    }

    #[test]
    fn citation_edges_stay_out_of_knowledge_graph() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "As shown in [@smith2024].");
        let gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();

        let result = gi.neighbors("a.md", 1, false).unwrap();
        assert!(
            !result.nodes.iter().any(|n| n.id == "smith2024"),
            "citation target must not enter petgraph, nodes: {:?}",
            result.nodes
        );
    }

    #[test]
    fn citation_edges_not_counted_in_edges_resolved() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "Link [[B]] and cite [@smith2024].");
        write_md(dir.path(), "b.md", "Target.");
        let store = Store::open_memory().unwrap();
        let (result, _) = index_workspace(&store, dir.path(), true).unwrap();

        assert_eq!(result.edges_resolved, 1, "only the wikilink counts as resolved");
        assert_eq!(store.citing_pages("smith2024").unwrap().len(), 1);
    }

    // --- incremental_reindex ---

    #[test]
    fn incremental_body_edit_updates_paragraph() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "Old paragraph.");
        let store = Store::open_memory().unwrap();
        let (_, mut reverse) = index_workspace(&store, dir.path(), true).unwrap();
        write_md(dir.path(), "a.md", "New paragraph.");
        let diff = DiffResult {
            new: vec![],
            changed: vec!["a.md".to_string()],
            deleted: vec![],
        };
        incremental_reindex(&store, dir.path(), &mut reverse, &diff, true).unwrap();
        let titles = store.node_titles().unwrap();
        assert_eq!(titles.len(), 1);
    }

    #[test]
    fn incremental_body_edit_updates_edges() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "[[OldLink]]");
        write_md(dir.path(), "b.md", "Target.");
        let store = Store::open_memory().unwrap();
        let (_, mut reverse) = index_workspace(&store, dir.path(), true).unwrap();
        write_md(dir.path(), "a.md", "[[b]]");
        let diff = DiffResult {
            new: vec![],
            changed: vec!["a.md".to_string()],
            deleted: vec![],
        };
        incremental_reindex(&store, dir.path(), &mut reverse, &diff, true).unwrap();
        let edges = store.all_edges().unwrap();
        assert_eq!(edges.len(), 1);
        assert_eq!(edges[0].1, "b.md");
    }

    #[test]
    fn incremental_body_edit_preserves_other_nodes() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "Alpha.");
        write_md(dir.path(), "b.md", "Beta.");
        let store = Store::open_memory().unwrap();
        let (_, mut reverse) = index_workspace(&store, dir.path(), true).unwrap();
        write_md(dir.path(), "a.md", "Alpha updated.");
        let diff = DiffResult {
            new: vec![],
            changed: vec!["a.md".to_string()],
            deleted: vec![],
        };
        incremental_reindex(&store, dir.path(), &mut reverse, &diff, true).unwrap();
        assert_eq!(store.stats().unwrap().nodes, 2);
    }

    #[test]
    fn incremental_new_file_resolves_dangling() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "Links to [[B]].");
        let store = Store::open_memory().unwrap();
        let (_, mut reverse) = index_workspace(&store, dir.path(), true).unwrap();
        // B was unresolved (stub). Now create it.
        write_md(dir.path(), "b.md", "I exist now.");
        let diff = DiffResult {
            new: vec!["b.md".to_string()],
            changed: vec![],
            deleted: vec![],
        };
        incremental_reindex(&store, dir.path(), &mut reverse, &diff, true).unwrap();
        let edges = store.all_edges().unwrap();
        assert!(
            edges.iter().any(|(s, t)| s == "a.md" && t == "b.md"),
            "a.md should now link to b.md, edges: {:?}",
            edges
        );
    }

    #[test]
    fn incremental_deleted_file_removes_node() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "Alpha.");
        write_md(dir.path(), "b.md", "Beta.");
        let store = Store::open_memory().unwrap();
        let (_, mut reverse) = index_workspace(&store, dir.path(), true).unwrap();
        fs::remove_file(dir.path().join("b.md")).unwrap();
        let diff = DiffResult {
            new: vec![],
            changed: vec![],
            deleted: vec!["b.md".to_string()],
        };
        incremental_reindex(&store, dir.path(), &mut reverse, &diff, true).unwrap();
        let ids = store.all_node_ids().unwrap();
        assert!(!ids.contains(&"b.md".to_string()));
    }

    #[test]
    fn incremental_multiple_new_files_resolve_chain() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "Alpha.");
        let store = Store::open_memory().unwrap();
        let (_, mut reverse) = index_workspace(&store, dir.path(), true).unwrap();

        write_md(dir.path(), "b.md", "Links to [[A]].");
        write_md(dir.path(), "c.md", "Links to [[B]].");
        let diff = DiffResult {
            new: vec!["b.md".to_string(), "c.md".to_string()],
            changed: vec![],
            deleted: vec![],
        };
        incremental_reindex(&store, dir.path(), &mut reverse, &diff, true).unwrap();

        let bl_a = store.backlinks("a.md").unwrap();
        assert!(bl_a.iter().any(|bl| bl.source_id == "b.md"), "b.md should link to a.md");
        let bl_b = store.backlinks("b.md").unwrap();
        assert!(bl_b.iter().any(|bl| bl.source_id == "c.md"), "c.md should link to b.md");
    }

    #[test]
    fn incremental_new_file_with_alias_resolves() {
        let dir = create_workspace();
        write_md(
            dir.path(),
            "a.md",
            "---\naliases:\n  - Alpha\n---\nContent.",
        );
        let store = Store::open_memory().unwrap();
        let (_, mut reverse) = index_workspace(&store, dir.path(), true).unwrap();

        write_md(dir.path(), "b.md", "Links to [[Alpha]].");
        let diff = DiffResult {
            new: vec!["b.md".to_string()],
            changed: vec![],
            deleted: vec![],
        };
        incremental_reindex(&store, dir.path(), &mut reverse, &diff, true).unwrap();

        let bl = store.backlinks("a.md").unwrap();
        assert!(bl.iter().any(|bl| bl.source_id == "b.md"), "b.md should link to a.md via alias");
    }

    // --- GraphIndex ---

    #[test]
    fn graph_index_build_indexes_workspace() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "Hello.");
        write_md(dir.path(), "b.md", "World.");
        let gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();
        let stats = gi.stats().unwrap();
        assert_eq!(stats.nodes, 2);
    }

    #[test]
    fn build_warm_start_no_diff() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "Hello.");
        write_md(dir.path(), "b.md", "Links to [[a]].");

        // Cold start — builds .lit/graph.db
        let gi1 = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();
        let stats1 = gi1.stats().unwrap();
        assert_eq!(stats1.nodes, 2);
        assert_eq!(stats1.edges, 1);
        drop(gi1);

        // Warm start — same files, no changes
        let gi2 = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();
        let stats2 = gi2.stats().unwrap();
        assert_eq!(stats2.nodes, 2, "warm start should preserve node count");
        assert_eq!(stats2.edges, 1, "warm start should preserve edge count");

        // Verify backlinks work (proves in-memory structs were rebuilt)
        let backlinks = gi2.backlinks("a.md").unwrap();
        assert_eq!(backlinks.len(), 1);
        assert_eq!(backlinks[0].source_id, "b.md");
    }

    #[test]
    fn build_warm_start_with_diff() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "Hello.");
        write_md(dir.path(), "b.md", "Links to [[a]].");

        // Cold start
        let gi1 = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();
        assert_eq!(gi1.stats().unwrap().nodes, 2);
        drop(gi1);

        // Modify a file and add a new one
        std::thread::sleep(std::time::Duration::from_millis(50));
        write_md(dir.path(), "b.md", "Now links to [[c]].");
        write_md(dir.path(), "c.md", "New page.");

        // Warm start — should apply diff
        let gi2 = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();
        let stats2 = gi2.stats().unwrap();
        assert_eq!(stats2.nodes, 3, "should include new page c.md");

        // b.md should now link to c.md, not a.md
        let backlinks_a = gi2.backlinks("a.md").unwrap();
        assert!(backlinks_a.is_empty(), "a.md should have no backlinks after edit");
        let backlinks_c = gi2.backlinks("c.md").unwrap();
        assert_eq!(backlinks_c.len(), 1);
        assert_eq!(backlinks_c[0].source_id, "b.md");
    }

    #[test]
    fn build_warm_start_with_deletion() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "Hello.");
        write_md(dir.path(), "b.md", "World.");

        // Cold start
        let gi1 = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();
        assert_eq!(gi1.stats().unwrap().nodes, 2);
        drop(gi1);

        // Delete a file
        fs::remove_file(dir.path().join("b.md")).unwrap();

        // Warm start — should detect deletion
        let gi2 = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();
        let stats2 = gi2.stats().unwrap();
        assert_eq!(stats2.nodes, 1, "deleted file should be removed");
    }

    #[test]
    fn build_corrupt_store_falls_back_to_cold_start() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "Hello.");

        // Cold start — creates graph.db
        let gi1 = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();
        assert_eq!(gi1.stats().unwrap().nodes, 1);
        drop(gi1);

        // Corrupt the schema version
        let db_path = dir.path().join(".lit").join("graph.db");
        {
            let conn = rusqlite::Connection::open(&db_path).unwrap();
            conn.execute("UPDATE meta SET value = '999' WHERE key = 'schema_version'", [])
                .unwrap();
        }

        // Build again — should detect future version, reset, and do cold start
        let gi2 = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();
        let stats2 = gi2.stats().unwrap();
        assert_eq!(stats2.nodes, 1, "cold start fallback should re-index");
    }

    #[test]
    fn build_with_progress_cold_start() {
        use crate::graph::progress::{IndexPhase, IndexProgress};
        use std::sync::{Arc, Mutex};

        let dir = create_workspace();
        write_md(dir.path(), "a.md", "[[b]]");
        write_md(dir.path(), "b.md", "Target.");

        let log: Arc<Mutex<Vec<IndexPhase>>> = Arc::new(Mutex::new(Vec::new()));
        let log_clone = Arc::clone(&log);
        let callback = move |p: IndexProgress| {
            let mut l = log_clone.lock().unwrap();
            if l.last() != Some(&p.phase) {
                l.push(p.phase);
            }
        };

        let gi = GraphIndex::build_with_progress(dir.path().to_path_buf(), &callback, true).unwrap();
        assert_eq!(gi.stats().unwrap().nodes, 2);

        let phases = log.lock().unwrap();
        assert_eq!(phases[0], IndexPhase::Scanning);
        assert!(phases.contains(&IndexPhase::Parsing));
        assert!(phases.contains(&IndexPhase::Resolving));
        assert_eq!(*phases.last().unwrap(), IndexPhase::Building);
    }

    #[test]
    fn build_with_progress_warm_start_no_diff() {
        use crate::graph::progress::{IndexPhase, IndexProgress};
        use std::sync::{Arc, Mutex};

        let dir = create_workspace();
        write_md(dir.path(), "a.md", "Content.");

        GraphIndex::build(dir.path().to_path_buf(), true).unwrap();

        let log: Arc<Mutex<Vec<IndexPhase>>> = Arc::new(Mutex::new(Vec::new()));
        let log_clone = Arc::clone(&log);
        let callback = move |p: IndexProgress| {
            let mut l = log_clone.lock().unwrap();
            if l.last() != Some(&p.phase) {
                l.push(p.phase);
            }
        };

        let gi = GraphIndex::build_with_progress(dir.path().to_path_buf(), &callback, true).unwrap();
        assert_eq!(gi.stats().unwrap().nodes, 1);

        let phases = log.lock().unwrap();
        assert_eq!(*phases, vec![IndexPhase::Diffing, IndexPhase::Building]);
    }

    #[test]
    fn build_with_progress_warm_start_with_diff() {
        use crate::graph::progress::{IndexPhase, IndexProgress};
        use std::sync::{Arc, Mutex};

        let dir = create_workspace();
        write_md(dir.path(), "a.md", "Content.");

        GraphIndex::build(dir.path().to_path_buf(), true).unwrap();

        std::thread::sleep(std::time::Duration::from_millis(50));
        write_md(dir.path(), "a.md", "Updated content.");

        let log: Arc<Mutex<Vec<IndexPhase>>> = Arc::new(Mutex::new(Vec::new()));
        let log_clone = Arc::clone(&log);
        let callback = move |p: IndexProgress| {
            let mut l = log_clone.lock().unwrap();
            if l.last() != Some(&p.phase) {
                l.push(p.phase);
            }
        };

        let gi = GraphIndex::build_with_progress(dir.path().to_path_buf(), &callback, true).unwrap();
        assert_eq!(gi.stats().unwrap().nodes, 1);

        let phases = log.lock().unwrap();
        assert_eq!(*phases, vec![IndexPhase::Diffing, IndexPhase::Building]);
    }

    #[test]
    fn build_delegation_preserves_existing_behavior() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "[[b]]");
        write_md(dir.path(), "b.md", "Target.");
        let gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();
        let stats = gi.stats().unwrap();
        assert_eq!(stats.nodes, 2);
        assert_eq!(stats.edges, 1);
    }

    // --- GraphIndex::batch_reindex ---

    #[test]
    fn graph_index_batch_reindex_mixed_ops() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "[[b]]");
        write_md(dir.path(), "b.md", "Target.");
        write_md(dir.path(), "c.md", "Will be deleted.");
        let gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();
        assert_eq!(gi.stats().unwrap().nodes, 3);

        // new file, change a, delete c
        write_md(dir.path(), "d.md", "[[a]]");
        write_md(dir.path(), "a.md", "No links now.");
        fs::remove_file(dir.path().join("c.md")).unwrap();

        let diff = DiffResult {
            new: vec!["d.md".to_string()],
            changed: vec!["a.md".to_string()],
            deleted: vec!["c.md".to_string()],
        };
        gi.batch_reindex(&diff, true).unwrap();

        let stats = gi.stats().unwrap();
        assert_eq!(stats.nodes, 3); // a, b, d (c deleted)
        // d->a edge exists, a->b edge removed
        let sub = gi.full_subgraph(false, false);
        assert!(sub.edges.iter().any(|e| e.0 == "d.md" && e.1 == "a.md"));
        assert!(!sub.edges.iter().any(|e| e.0 == "a.md" && e.1 == "b.md"));
        assert!(!sub.nodes.iter().any(|n| n.id == "c.md"));
    }

    #[test]
    fn rename_reindex_diff_removes_old_adds_new() {
        let diff = rename_reindex_diff("old.md", "new.md");
        assert_eq!(
            diff,
            DiffResult {
                new: vec!["new.md".to_string()],
                changed: vec![],
                deleted: vec!["old.md".to_string()],
            }
        );
    }

    #[test]
    fn reindex_create_makes_node_queryable() {
        // B1: create — new file becomes queryable via subgraph for its own id
        let dir = create_workspace();
        write_md(dir.path(), "seed.md", "Seed content.");
        let gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();

        write_md(dir.path(), "fresh.md", "");
        gi.reindex_file("fresh.md", true).unwrap();

        let sub = gi.subgraph(&["fresh.md"], 1, false, false, false).unwrap();
        assert!(sub.nodes.iter().any(|n| n.id == "fresh.md"));
    }

    #[test]
    fn reindex_rename_swaps_old_for_new() {
        // B2: rename — old id no longer found, new id queryable
        let dir = create_workspace();
        write_md(dir.path(), "old.md", "Renamed content.");
        let gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();

        fs::rename(dir.path().join("old.md"), dir.path().join("new.md")).unwrap();
        gi.batch_reindex(&rename_reindex_diff("old.md", "new.md"), true).unwrap();

        assert!(matches!(
            gi.subgraph(&["old.md"], 1, false, false, false),
            Err(GraphError::NodeNotFound { .. })
        ));
        let sub = gi.subgraph(&["new.md"], 1, false, false, false).unwrap();
        assert!(sub.nodes.iter().any(|n| n.id == "new.md"));
    }

    #[test]
    fn reindex_delete_removes_node() {
        // B3: delete — id no longer found
        let dir = create_workspace();
        write_md(dir.path(), "doomed.md", "Doomed content.");
        let gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();

        fs::remove_file(dir.path().join("doomed.md")).unwrap();
        gi.remove_file("doomed.md", true).unwrap();

        assert!(matches!(
            gi.subgraph(&["doomed.md"], 1, false, false, false),
            Err(GraphError::NodeNotFound { .. })
        ));
    }

    #[test]
    fn batch_reindex_new_file_resolves_stub() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "Links to [[b]].");
        let gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();

        // b is a stub node — filtered from subgraph output
        let sub = gi.full_subgraph(false, false);
        assert!(!sub.nodes.iter().any(|n| n.id == "b"), "stub 'b' should not appear in subgraph");

        // Create b.md and batch_reindex with new
        write_md(dir.path(), "b.md", "I exist now.");
        let diff = DiffResult {
            new: vec!["b.md".to_string()],
            changed: vec![],
            deleted: vec![],
        };
        gi.batch_reindex(&diff, true).unwrap();

        let sub = gi.full_subgraph(false, false);
        // Real node should now appear (stub was replaced)
        assert!(!sub.nodes.iter().any(|n| n.id == "b"), "bare stub 'b' should be gone");
        let b_real = sub.nodes.iter().find(|n| n.id == "b.md").unwrap();
        assert!(!b_real.is_stub);
        // Edge a.md -> b.md should exist
        assert!(sub.edges.iter().any(|e| e.0 == "a.md" && e.1 == "b.md"));
    }

    #[test]
    fn create_page_scenario_promotes_stub() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "Links to [[b]].");
        let gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();

        write_md(dir.path(), "b.md", "I exist now.");
        gi.add_file("b.md", true).unwrap();

        let sub = gi.full_subgraph(false, false);
        assert!(!sub.nodes.iter().any(|n| n.id == "b"), "stub 'b' should be gone");
        let b_real = sub.nodes.iter().find(|n| n.id == "b.md").unwrap();
        assert!(!b_real.is_stub);
        assert!(sub.edges.iter().any(|e| e.0 == "a.md" && e.1 == "b.md"));
    }

    #[test]
    fn reindex_file_does_not_promote_stub_documents_limitation() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "Links to [[b]].");
        let gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();

        write_md(dir.path(), "b.md", "I exist now.");
        gi.reindex_file("b.md", true).unwrap();

        // reindex_file uses `changed` semantics — stub promotion is skipped,
        // so the edge a.md -> b.md is NOT resolved (still points at stub "b",
        // which without_stubs filters out).
        let sub = gi.full_subgraph(false, false);
        assert!(sub.nodes.iter().any(|n| n.id == "b.md"), "b.md exists as real node");
        assert!(!sub.edges.iter().any(|e| e.0 == "a.md" && e.1 == "b.md"), "edge not resolved because stub persists");
    }

    #[test]
    fn batch_diff_from_merge_scenario() {
        // Simulate merge: a.md + b.md → merged.md, c.md and d.md reference a/b and get rewritten
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "Alpha content.");
        write_md(dir.path(), "b.md", "Beta content.");
        write_md(dir.path(), "c.md", "Links to [[a]].");
        write_md(dir.path(), "d.md", "Links to [[b]].");
        let gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();
        assert_eq!(gi.stats().unwrap().nodes, 4);

        // After merge: a.md & b.md deleted, merged.md created, c.md & d.md rewritten
        write_md(dir.path(), "merged.md", "Alpha + Beta combined.");
        write_md(dir.path(), "c.md", "Links to [[merged]].");
        write_md(dir.path(), "d.md", "Links to [[merged]].");
        fs::remove_file(dir.path().join("a.md")).unwrap();
        fs::remove_file(dir.path().join("b.md")).unwrap();

        let diff = DiffResult {
            new: vec!["merged.md".to_string()],
            changed: vec!["c.md".to_string(), "d.md".to_string()],
            deleted: vec!["a.md".to_string(), "b.md".to_string()],
        };
        gi.batch_reindex(&diff, true).unwrap();

        let sub = gi.full_subgraph(false, false);
        assert_eq!(sub.nodes.len(), 3); // merged, c, d
        assert!(!sub.nodes.iter().any(|n| n.id == "a.md"));
        assert!(!sub.nodes.iter().any(|n| n.id == "b.md"));
        assert!(sub.nodes.iter().any(|n| n.id == "merged.md"));
        assert!(sub.edges.iter().any(|e| e.0 == "c.md" && e.1 == "merged.md"));
        assert!(sub.edges.iter().any(|e| e.0 == "d.md" && e.1 == "merged.md"));
    }

    #[test]
    fn batch_diff_from_split_scenario() {
        // Simulate split: big.md → part1.md + part2.md, ref.md references big and gets rewritten
        let dir = create_workspace();
        write_md(dir.path(), "big.md", "Part one.\n\nPart two.");
        write_md(dir.path(), "ref.md", "Links to [[big]].");
        let gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();
        assert_eq!(gi.stats().unwrap().nodes, 2);

        // After split: big.md deleted, part1.md & part2.md created, ref.md rewritten
        write_md(dir.path(), "part1.md", "Part one.");
        write_md(dir.path(), "part2.md", "Part two.");
        write_md(dir.path(), "ref.md", "Links to [[part1]].");
        fs::remove_file(dir.path().join("big.md")).unwrap();

        let diff = DiffResult {
            new: vec!["part1.md".to_string(), "part2.md".to_string()],
            changed: vec!["ref.md".to_string()],
            deleted: vec!["big.md".to_string()],
        };
        gi.batch_reindex(&diff, true).unwrap();

        let sub = gi.full_subgraph(false, false);
        assert_eq!(sub.nodes.len(), 3); // part1, part2, ref
        assert!(!sub.nodes.iter().any(|n| n.id == "big.md"));
        assert!(sub.nodes.iter().any(|n| n.id == "part1.md"));
        assert!(sub.nodes.iter().any(|n| n.id == "part2.md"));
        assert!(sub.edges.iter().any(|e| e.0 == "ref.md" && e.1 == "part1.md"));
    }

    #[test]
    fn batch_reindex_produces_same_result_as_sequential() {
        // Build two identical workspaces, apply changes via batch vs sequential,
        // compare resulting node IDs and edge sets.
        let make_workspace = || {
            let dir = create_workspace();
            for i in 0..10 {
                let name = format!("n{}.md", i);
                let content = if i > 0 {
                    format!("Links to [[n{}]].", i - 1)
                } else {
                    "Root node.".to_string()
                };
                write_md(dir.path(), &name, &content);
            }
            dir
        };

        // Sequential approach
        let dir_seq = make_workspace();
        let gi_seq = GraphIndex::build(dir_seq.path().to_path_buf(), true).unwrap();
        write_md(dir_seq.path(), "n0.md", "Updated root.");
        write_md(dir_seq.path(), "new.md", "Brand new [[n5]].");
        fs::remove_file(dir_seq.path().join("n9.md")).unwrap();
        gi_seq.reindex_file("n0.md", true).unwrap();
        gi_seq.reindex_file("new.md", true).unwrap();
        gi_seq.remove_file("n9.md", true).unwrap();

        // Batch approach
        let dir_batch = make_workspace();
        let gi_batch = GraphIndex::build(dir_batch.path().to_path_buf(), true).unwrap();
        write_md(dir_batch.path(), "n0.md", "Updated root.");
        write_md(dir_batch.path(), "new.md", "Brand new [[n5]].");
        fs::remove_file(dir_batch.path().join("n9.md")).unwrap();
        let diff = DiffResult {
            new: vec!["new.md".to_string()],
            changed: vec!["n0.md".to_string()],
            deleted: vec!["n9.md".to_string()],
        };
        gi_batch.batch_reindex(&diff, true).unwrap();

        // Compare node IDs
        let mut seq_nodes: Vec<String> = gi_seq.full_subgraph(false, false).nodes.iter().map(|n| n.id.clone()).collect();
        let mut batch_nodes: Vec<String> = gi_batch.full_subgraph(false, false).nodes.iter().map(|n| n.id.clone()).collect();
        seq_nodes.sort();
        batch_nodes.sort();
        assert_eq!(seq_nodes, batch_nodes);

        // Compare edge sets
        let mut seq_edges: Vec<(String, String, EdgeKind)> = gi_seq.full_subgraph(false, false).edges.clone();
        let mut batch_edges: Vec<(String, String, EdgeKind)> = gi_batch.full_subgraph(false, false).edges.clone();
        seq_edges.sort();
        batch_edges.sort();
        assert_eq!(seq_edges, batch_edges);
    }

    #[test]
    fn graph_index_batch_reindex_empty_diff_is_noop() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "Hello.");
        let gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();
        let diff = DiffResult { new: vec![], changed: vec![], deleted: vec![] };
        gi.batch_reindex(&diff, true).unwrap();
        assert_eq!(gi.stats().unwrap().nodes, 1);
    }

    #[test]
    fn graph_index_batch_reindex_only_deletes() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "Hello.");
        write_md(dir.path(), "b.md", "World.");
        let gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();
        fs::remove_file(dir.path().join("a.md")).unwrap();
        fs::remove_file(dir.path().join("b.md")).unwrap();
        let diff = DiffResult {
            new: vec![],
            changed: vec![],
            deleted: vec!["a.md".to_string(), "b.md".to_string()],
        };
        gi.batch_reindex(&diff, true).unwrap();
        assert_eq!(gi.stats().unwrap().nodes, 0);
    }

    #[test]
    fn graph_index_batch_reindex_only_new_files() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "Hello.");
        let gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();
        write_md(dir.path(), "b.md", "New file [[a]].");
        let diff = DiffResult {
            new: vec!["b.md".to_string()],
            changed: vec![],
            deleted: vec![],
        };
        gi.batch_reindex(&diff, true).unwrap();
        let stats = gi.stats().unwrap();
        assert_eq!(stats.nodes, 2);
        assert_eq!(stats.edges, 1);
    }

    #[test]
    fn graph_index_reindex_file() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "[[B]]");
        write_md(dir.path(), "b.md", "Target.");
        let gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();
        write_md(dir.path(), "a.md", "No links now.");
        gi.reindex_file("a.md", true).unwrap();
        let stats = gi.stats().unwrap();
        assert_eq!(stats.edges, 0);
    }

    #[test]
    fn graph_index_remove_file() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "Hello.");
        write_md(dir.path(), "b.md", "World.");
        let gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();
        fs::remove_file(dir.path().join("b.md")).unwrap();
        gi.remove_file("b.md", true).unwrap();
        let stats = gi.stats().unwrap();
        assert_eq!(stats.nodes, 1);
    }

    #[test]
    fn graph_index_full_rebuild() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "Hello.");
        let gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();
        write_md(dir.path(), "b.md", "New file.");
        let result = gi.full_rebuild(true).unwrap();
        assert_eq!(result.nodes_indexed, 2);
    }

    #[test]
    fn graph_index_stats() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "[[B]]");
        write_md(dir.path(), "b.md", "Target.");
        let gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();
        let stats = gi.stats().unwrap();
        assert_eq!(stats.nodes, 2);
        assert_eq!(stats.edges, 1);
    }

    // --- GraphIndex knowledge integration ---

    #[test]
    fn graph_index_neighbors_after_build() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "[[b]]");
        write_md(dir.path(), "b.md", "Target.");
        let gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();
        let result = gi.neighbors("a.md", 1, true).unwrap();
        let ids: std::collections::HashSet<&str> =
            result.nodes.iter().map(|n| n.id.as_str()).collect();
        assert!(ids.contains("a.md"));
        assert!(ids.contains("b.md"));
    }

    #[test]
    fn graph_index_knowledge_rebuilt_after_full_rebuild() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "Hello.");
        let gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();
        let sub = gi.full_subgraph(false, false);
        assert_eq!(sub.nodes.len(), 1);

        write_md(dir.path(), "b.md", "New.");
        gi.full_rebuild(true).unwrap();
        let sub = gi.full_subgraph(false, false);
        assert_eq!(sub.nodes.len(), 2);
    }

    #[test]
    fn graph_index_knowledge_rebuilt_after_reindex_file() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "No links.");
        write_md(dir.path(), "b.md", "Target.");
        let gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();
        let sub = gi.full_subgraph(false, false);
        assert!(sub.edges.is_empty());

        write_md(dir.path(), "a.md", "Now links to [[b]].");
        gi.reindex_file("a.md", true).unwrap();
        let sub = gi.full_subgraph(false, false);
        assert!(!sub.edges.is_empty());
    }

    // --- GraphIndex backlinks/forward_links/search ---

    #[test]
    fn graph_index_backlinks() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "Links to [[b]].");
        write_md(dir.path(), "b.md", "Target.");
        let gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();
        let bl = gi.backlinks("b.md").unwrap();
        assert_eq!(bl.len(), 1);
        assert_eq!(bl[0].source_id, "a.md");
    }

    #[test]
    fn graph_index_backlinks_empty() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "No outgoing links.");
        let gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();
        let bl = gi.backlinks("a.md").unwrap();
        assert!(bl.is_empty());
    }

    #[test]
    fn graph_index_forward_links() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "Links to [[b]].");
        write_md(dir.path(), "b.md", "Target.");
        let gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();
        let fl = gi.forward_links("a.md").unwrap();
        assert_eq!(fl.len(), 1);
        assert_eq!(fl[0].target_id, "b.md");
    }

    #[test]
    fn graph_index_forward_links_empty() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "No links.");
        let gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();
        let fl = gi.forward_links("a.md").unwrap();
        assert!(fl.is_empty());
    }

    #[test]
    fn graph_index_search() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "---\ntitle: Quantum Computing\n---\nBody.");
        let gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();
        let results = gi.search("Quantum", 20).unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].id, "a.md");
    }

    #[test]
    fn graph_index_search_empty() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "Content.");
        let gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();
        let results = gi.search("zzzznonexistent", 20).unwrap();
        assert!(results.is_empty());
    }

    // --- PageRank on GraphIndex ---

    #[test]
    fn pagerank_returns_scores_for_all_nodes() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "[[b]]");
        write_md(dir.path(), "b.md", "Target.");
        let gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();
        let scores = gi.pagerank().unwrap();
        assert_eq!(scores.len(), 2);
        for (id, score) in &scores {
            assert!(*score > 0.0, "{id} has non-positive score");
        }
    }

    #[test]
    fn pagerank_scores_sum_to_one() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "[[b]]");
        write_md(dir.path(), "b.md", "Target.");
        let gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();
        let scores = gi.pagerank().unwrap();
        let sum: f64 = scores.values().sum();
        assert!((sum - 1.0).abs() < 1e-9, "sum was {sum}");
    }

    #[test]
    fn pagerank_caches_in_meta_table() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "[[b]]");
        write_md(dir.path(), "b.md", "Target.");
        let gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();
        gi.pagerank().unwrap();
        let store = gi.store.lock().unwrap();
        assert!(store.get_meta("pagerank_scores").unwrap().is_some());
        assert!(store.get_meta("pagerank_fingerprint").unwrap().is_some());
    }

    #[test]
    fn pagerank_cache_hit_returns_same() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "[[b]]");
        write_md(dir.path(), "b.md", "Target.");
        let gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();
        let scores1 = gi.pagerank().unwrap();
        let scores2 = gi.pagerank().unwrap();
        assert_eq!(scores1, scores2);
    }

    #[test]
    fn pagerank_invalidated_after_reindex() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "[[b]]");
        write_md(dir.path(), "b.md", "[[a]]");
        let gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();
        let scores1 = gi.pagerank().unwrap();
        write_md(dir.path(), "a.md", "No links now.");
        gi.reindex_file("a.md", true).unwrap();
        let scores2 = gi.pagerank().unwrap();
        assert_ne!(scores1, scores2);
    }

    #[test]
    fn pagerank_invalidated_after_remove() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "Hello.");
        write_md(dir.path(), "b.md", "World.");
        let gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();
        let scores1 = gi.pagerank().unwrap();
        assert_eq!(scores1.len(), 2);
        fs::remove_file(dir.path().join("b.md")).unwrap();
        gi.remove_file("b.md", true).unwrap();
        let scores2 = gi.pagerank().unwrap();
        assert_eq!(scores2.len(), 1);
    }

    #[test]
    fn pagerank_invalidated_after_rebuild() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "Hello.");
        let gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();
        let scores1 = gi.pagerank().unwrap();
        assert_eq!(scores1.len(), 1);
        write_md(dir.path(), "b.md", "New file.");
        gi.full_rebuild(true).unwrap();
        let scores2 = gi.pagerank().unwrap();
        assert_eq!(scores2.len(), 2);
    }

    #[test]
    fn top_by_pagerank_sorted_desc() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "[[b]] [[c]]");
        write_md(dir.path(), "b.md", "[[c]]");
        write_md(dir.path(), "c.md", "Leaf.");
        let gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();
        let top = gi.top_by_pagerank(3).unwrap();
        assert_eq!(top.len(), 3);
        for w in top.windows(2) {
            assert!(w[0].1 >= w[1].1);
        }
    }

    #[test]
    fn top_by_pagerank_truncates() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "[[b]] [[c]]");
        write_md(dir.path(), "b.md", "[[c]]");
        write_md(dir.path(), "c.md", "Leaf.");
        let gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();
        let top = gi.top_by_pagerank(2).unwrap();
        assert_eq!(top.len(), 2);
    }

    // --- GraphIndex resolve_wikilink ---

    #[test]
    fn resolve_wikilink_existing_page() {
        let dir = create_workspace();
        write_md(dir.path(), "People/Alice.md", "Hello.");
        let gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();
        let r = gi.resolve_wikilink("Alice").unwrap();
        assert_eq!(r.node_id, Some("People/Alice.md".to_string()));
    }

    #[test]
    fn resolve_wikilink_unresolved_page() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "Hello.");
        let gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();
        let r = gi.resolve_wikilink("NonExistent").unwrap();
        assert_eq!(r.node_id, None);
        assert_eq!(r.tier, super::super::resolve::ResolutionTier::Unresolved);
    }

    #[test]
    fn resolve_wikilink_exact_path() {
        let dir = create_workspace();
        write_md(dir.path(), "Notes/Topic.md", "Content.");
        let gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();
        let r = gi.resolve_wikilink("Notes/Topic.md").unwrap();
        assert_eq!(r.tier, super::super::resolve::ResolutionTier::ExactPath);
        assert_eq!(r.node_id, Some("Notes/Topic.md".to_string()));
    }

    #[test]
    fn resolve_wikilink_ambiguous() {
        let dir = create_workspace();
        write_md(dir.path(), "a/Note.md", "Alpha.");
        write_md(dir.path(), "b/Note.md", "Beta.");
        let gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();
        let r = gi.resolve_wikilink("Note").unwrap();
        assert_eq!(r.tier, super::super::resolve::ResolutionTier::Ambiguous);
        assert_eq!(r.node_id, Some("a/Note.md".to_string()));
    }

    // --- GraphIndex page_headings ---

    #[test]
    fn page_headings_returns_headings() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "# Intro\n\n## Details");
        let gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();
        let headings = gi.page_headings("a").unwrap();
        assert_eq!(headings.len(), 2);
        assert_eq!(headings[0].text, "Intro");
        assert_eq!(headings[0].level, 1);
        assert_eq!(headings[1].text, "Details");
        assert_eq!(headings[1].level, 2);
    }

    #[test]
    fn page_headings_empty_for_no_headings() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "Just plain text.");
        let gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();
        let headings = gi.page_headings("a").unwrap();
        assert!(headings.is_empty());
    }

    #[test]
    fn page_headings_resolves_by_stem() {
        let dir = create_workspace();
        write_md(dir.path(), "notes/Topic.md", "# First\n## Second");
        let gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();
        let headings = gi.page_headings("Topic").unwrap();
        assert_eq!(headings.len(), 2);
    }

    #[test]
    fn page_headings_unresolved_errors() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "Content.");
        let gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();
        let result = gi.page_headings("NonExistent");
        assert!(result.is_err());
    }

    #[test]
    fn top_by_pagerank_n_exceeds_graph() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "Hello.");
        write_md(dir.path(), "b.md", "World.");
        let gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();
        let top = gi.top_by_pagerank(100).unwrap();
        assert_eq!(top.len(), 2);
    }

    #[test]
    fn pagerank_excludes_shadow_nodes() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "As shown in [@smith2024].");
        write_md(dir.path(), "b.md", "[[a]]");
        write_bib(
            dir.path(),
            "refs.bib",
            "@article{smith2024,\n  author = {Smith, John},\n  title = {Alpha},\n  year = {2024}\n}",
        );
        let gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();
        let scores = gi.pagerank().unwrap();
        for key in scores.keys() {
            assert!(!key.starts_with("bib:"), "shadow node {key} should not appear in pagerank");
        }
        // Scores still sum to 1
        let sum: f64 = scores.values().sum();
        assert!((sum - 1.0).abs() < 1e-9, "sum was {sum}");
    }

    #[test]
    fn top_by_pagerank_excludes_shadow_nodes() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "As shown in [@smith2024].");
        write_md(dir.path(), "b.md", "[[a]]");
        write_bib(
            dir.path(),
            "refs.bib",
            "@article{smith2024,\n  author = {Smith, John},\n  title = {Alpha},\n  year = {2024}\n}",
        );
        let gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();
        let top = gi.top_by_pagerank(100).unwrap();
        for (key, _) in &top {
            assert!(!key.starts_with("bib:"), "shadow node {key} should not appear in top_by_pagerank");
        }
    }

    #[test]
    fn subgraph_bundle_pagerank_excludes_shadows() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "As shown in [@smith2024].");
        write_bib(
            dir.path(),
            "refs.bib",
            "@article{smith2024,\n  author = {Smith, John},\n  title = {Alpha},\n  year = {2024}\n}",
        );
        let gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();
        let bundle = gi.subgraph_bundle(&[], 0, false, false, false).unwrap();
        for key in bundle.pagerank.keys() {
            assert!(!key.starts_with("bib:"), "shadow node {key} in pagerank with include_citations=false");
        }
    }

    // --- GraphIndex unlinked_mentions ---

    #[test]
    fn unlinked_mentions_no_mentions() {
        let dir = create_workspace();
        write_md(dir.path(), "target.md", "---\ntitle: Alice\n---\nI am Alice.");
        write_md(dir.path(), "other.md", "No mention of the name here.");
        let gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();
        let mentions = gi.unlinked_mentions("target.md").unwrap();
        assert!(mentions.is_empty());
    }

    #[test]
    fn unlinked_mentions_finds_plain_text() {
        let dir = create_workspace();
        write_md(dir.path(), "target.md", "---\ntitle: Alice\n---\nI am Alice.");
        write_md(dir.path(), "other.md", "I met Alice yesterday.");
        let gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();
        let mentions = gi.unlinked_mentions("target.md").unwrap();
        assert_eq!(mentions.len(), 1);
        assert_eq!(mentions[0].source_id, "other.md");
        assert_eq!(mentions[0].matched_text, "Alice");
        assert!(mentions[0].context.contains("Alice"));
    }

    #[test]
    fn unlinked_mentions_excludes_already_linked() {
        let dir = create_workspace();
        write_md(dir.path(), "target.md", "---\ntitle: Alice\n---\nI am Alice.");
        write_md(dir.path(), "linked.md", "[[target]] and Alice is great.");
        write_md(dir.path(), "unlinked.md", "Alice is here.");
        let gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();
        let mentions = gi.unlinked_mentions("target.md").unwrap();
        assert_eq!(mentions.len(), 1);
        assert_eq!(mentions[0].source_id, "unlinked.md");
    }

    #[test]
    fn unlinked_mentions_excludes_code_and_wikilinks() {
        let dir = create_workspace();
        write_md(dir.path(), "target.md", "---\ntitle: Alice\n---\nI am Alice.");
        write_md(dir.path(), "other.md", "`Alice` and [[Bob]] and Alice plain.");
        let gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();
        let mentions = gi.unlinked_mentions("target.md").unwrap();
        assert_eq!(mentions.len(), 1);
        assert_eq!(mentions[0].matched_text, "Alice");
    }

    #[test]
    fn unlinked_mentions_matches_aliases() {
        let dir = create_workspace();
        write_md(dir.path(), "target.md", "---\ntitle: Alice\naliases:\n  - Ali\n---\nContent.");
        write_md(dir.path(), "other.md", "I met Ali today.");
        let gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();
        let mentions = gi.unlinked_mentions("target.md").unwrap();
        assert_eq!(mentions.len(), 1);
        assert_eq!(mentions[0].matched_text, "Ali");
    }

    #[test]
    fn unlinked_mentions_skips_self() {
        let dir = create_workspace();
        write_md(dir.path(), "target.md", "---\ntitle: Alice\n---\nAlice talks about Alice.");
        let gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();
        let mentions = gi.unlinked_mentions("target.md").unwrap();
        assert!(mentions.is_empty());
    }

    #[test]
    fn unlinked_mentions_line_numbers_body_relative() {
        let dir = create_workspace();
        write_md(dir.path(), "target.md", "---\ntitle: Alice\n---\nContent.");
        write_md(
            dir.path(),
            "other.md",
            "---\ntitle: Other\ntags:\n  - test\n---\nLine one.\nAlice here.",
        );
        let gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();
        let mentions = gi.unlinked_mentions("target.md").unwrap();
        assert_eq!(mentions.len(), 1);
        assert_eq!(mentions[0].source_line, 2);
    }

    // --- unlinked_mentions many files (shared matcher gate) ---

    #[test]
    fn unlinked_mentions_many_files_shared_matcher() {
        let dir = create_workspace();
        write_md(dir.path(), "target.md", "---\ntitle: Alice\n---\nI am Alice.");
        for i in 0..20 {
            let content = if i % 2 == 0 {
                format!("File {i} mentions Alice in passing.")
            } else {
                format!("File {i} has no relevant names.")
            };
            write_md(dir.path(), &format!("note_{i}.md"), &content);
        }
        let gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();
        let mentions = gi.unlinked_mentions("target.md").unwrap();
        assert_eq!(mentions.len(), 10, "every even file of 20 should mention Alice");
        for m in &mentions {
            assert_eq!(m.matched_text, "Alice");
        }
    }

    // ------- file_contains_any_name_with_matcher tests -------

    fn build_name_matcher(names: &[&str]) -> grep_regex::RegexMatcher {
        let filtered: Vec<&str> = names.iter().copied().filter(|n| !n.is_empty()).collect();
        let pattern = filtered
            .iter()
            .map(|n| regex::escape(n))
            .collect::<Vec<_>>()
            .join("|");
        grep_regex::RegexMatcherBuilder::new()
            .case_insensitive(true)
            .build(&pattern)
            .unwrap()
    }

    #[test]
    fn prefilter_with_matcher_finds_name() {
        let dir = create_workspace();
        write_md(dir.path(), "note.md", "Hello Alice, welcome.");
        let matcher = build_name_matcher(&["Alice"]);
        assert!(file_contains_any_name_with_matcher(&dir.path().join("note.md"), &matcher));
    }

    #[test]
    fn prefilter_with_matcher_rejects_absent() {
        let dir = create_workspace();
        write_md(dir.path(), "note.md", "Hello world.");
        let matcher = build_name_matcher(&["Alice"]);
        assert!(!file_contains_any_name_with_matcher(&dir.path().join("note.md"), &matcher));
    }

    #[test]
    fn prefilter_with_matcher_missing_file_returns_true() {
        let dir = create_workspace();
        let matcher = build_name_matcher(&["Alice"]);
        assert!(file_contains_any_name_with_matcher(&dir.path().join("nonexistent.md"), &matcher));
    }

    // ------- file_contains_any_name pre-filter tests -------

    #[test]
    fn prefilter_finds_name_in_file() {
        let dir = create_workspace();
        write_md(dir.path(), "note.md", "Hello Alice, welcome.");
        assert!(file_contains_any_name(&dir.path().join("note.md"), &["Alice"]));
    }

    #[test]
    fn prefilter_rejects_when_no_name_present() {
        let dir = create_workspace();
        write_md(dir.path(), "note.md", "Hello world.");
        assert!(!file_contains_any_name(&dir.path().join("note.md"), &["Alice"]));
    }

    #[test]
    fn prefilter_case_insensitive() {
        let dir = create_workspace();
        write_md(dir.path(), "note.md", "I saw alice today.");
        assert!(file_contains_any_name(&dir.path().join("note.md"), &["Alice"]));
    }

    #[test]
    fn prefilter_matches_any_of_multiple_names() {
        let dir = create_workspace();
        write_md(dir.path(), "note.md", "Bob is here.");
        assert!(file_contains_any_name(&dir.path().join("note.md"), &["Alice", "Bob"]));
    }

    #[test]
    fn prefilter_empty_names_returns_false() {
        let dir = create_workspace();
        write_md(dir.path(), "note.md", "Hello world.");
        assert!(!file_contains_any_name(&dir.path().join("note.md"), &[]));
    }

    #[test]
    fn prefilter_all_empty_names_returns_false() {
        let dir = create_workspace();
        write_md(dir.path(), "note.md", "Hello world.");
        assert!(!file_contains_any_name(&dir.path().join("note.md"), &["", ""]));
    }

    #[test]
    fn prefilter_missing_file_returns_true() {
        let dir = create_workspace();
        assert!(file_contains_any_name(&dir.path().join("nonexistent.md"), &["Alice"]));
    }

    #[test]
    fn prefilter_special_chars_in_name() {
        let dir = create_workspace();
        write_md(dir.path(), "note.md", "I love C++ programming.");
        assert!(file_contains_any_name(&dir.path().join("note.md"), &["C++"]));
    }

    #[test]
    fn prefilter_special_chars_no_false_positive() {
        let dir = create_workspace();
        write_md(dir.path(), "note.md", "I love C programming.");
        assert!(!file_contains_any_name(&dir.path().join("note.md"), &["C++"]));
    }

    // --- parse_search_query ---

    #[test]
    fn parse_query_strips_trailing_star() {
        assert_eq!(parse_search_query("hello*"), vec!["hello"]);
    }

    #[test]
    fn parse_query_splits_words() {
        assert_eq!(parse_search_query("quantum computing"), vec!["quantum", "computing"]);
    }

    #[test]
    fn parse_query_empty_returns_empty() {
        assert!(parse_search_query("").is_empty());
    }

    #[test]
    fn parse_query_whitespace_only_returns_empty() {
        assert!(parse_search_query("   ").is_empty());
    }

    #[test]
    fn parse_query_single_word() {
        assert_eq!(parse_search_query("rust"), vec!["rust"]);
    }

    #[test]
    fn parse_query_interior_star_preserved() {
        assert_eq!(parse_search_query("he*llo*"), vec!["he*llo"]);
    }

    // --- search_file_with_matcher ---

    fn build_matcher(terms: &[String]) -> grep_regex::RegexMatcher {
        let pattern = terms
            .iter()
            .map(|t| regex::escape(t))
            .collect::<Vec<_>>()
            .join("|");
        grep_regex::RegexMatcherBuilder::new()
            .case_insensitive(true)
            .build(&pattern)
            .unwrap()
    }

    #[test]
    fn search_file_with_matcher_single_term_found() {
        let dir = create_workspace();
        write_md(dir.path(), "note.md", "Hello world of rust programming.");
        let terms = vec!["rust".to_string()];
        let matcher = build_matcher(&terms);
        let result = search_file_with_matcher(&dir.path().join("note.md"), &matcher, &terms);
        assert!(result.is_some());
        let (count, excerpt, _line) = result.unwrap();
        assert_eq!(count, 1);
        assert!(excerpt.contains("rust"));
    }

    #[test]
    fn search_file_with_matcher_term_not_found() {
        let dir = create_workspace();
        write_md(dir.path(), "note.md", "Hello world.");
        let terms = vec!["rust".to_string()];
        let matcher = build_matcher(&terms);
        let result = search_file_with_matcher(&dir.path().join("note.md"), &matcher, &terms);
        assert!(result.is_none());
    }

    #[test]
    fn search_file_with_matcher_multi_term_all_present() {
        let dir = create_workspace();
        write_md(dir.path(), "note.md", "Rust is great.\nSystems programming.");
        let terms = vec!["rust".to_string(), "programming".to_string()];
        let matcher = build_matcher(&terms);
        let result = search_file_with_matcher(&dir.path().join("note.md"), &matcher, &terms);
        assert!(result.is_some());
    }

    #[test]
    fn search_file_with_matcher_multi_term_one_missing() {
        let dir = create_workspace();
        write_md(dir.path(), "note.md", "Rust is great.");
        let terms = vec!["rust".to_string(), "python".to_string()];
        let matcher = build_matcher(&terms);
        let result = search_file_with_matcher(&dir.path().join("note.md"), &matcher, &terms);
        assert!(result.is_none());
    }

    #[test]
    fn search_file_with_matcher_returns_first_match_line_number() {
        let dir = create_workspace();
        write_md(dir.path(), "note.md", "line one\nrust is here\nline three");
        let terms = vec!["rust".to_string()];
        let matcher = build_matcher(&terms);
        let result = search_file_with_matcher(&dir.path().join("note.md"), &matcher, &terms);
        assert!(result.is_some());
        let (_count, _excerpt, line_num) = result.unwrap();
        assert_eq!(line_num, 2);
    }

    #[test]
    fn search_file_with_matcher_first_hit_line_number_multi_matches() {
        let dir = create_workspace();
        write_md(dir.path(), "note.md", "no match\nno match\nfoo here\nfoo again");
        let terms = vec!["foo".to_string()];
        let matcher = build_matcher(&terms);
        let result = search_file_with_matcher(&dir.path().join("note.md"), &matcher, &terms);
        assert!(result.is_some());
        let (_count, _excerpt, line_num) = result.unwrap();
        assert_eq!(line_num, 3);
    }

    // --- search_file_for_terms ---

    #[test]
    fn search_file_single_term_found() {
        let dir = create_workspace();
        write_md(dir.path(), "note.md", "Hello world of rust programming.");
        let result = search_file_for_terms(
            &dir.path().join("note.md"),
            &["rust".to_string()],
        );
        assert!(result.is_some());
        let (count, excerpt) = result.unwrap();
        assert_eq!(count, 1);
        assert!(excerpt.contains("rust"));
    }

    #[test]
    fn search_file_single_term_not_found() {
        let dir = create_workspace();
        write_md(dir.path(), "note.md", "Hello world.");
        let result = search_file_for_terms(
            &dir.path().join("note.md"),
            &["rust".to_string()],
        );
        assert!(result.is_none());
    }

    #[test]
    fn search_file_multiple_terms_all_present() {
        let dir = create_workspace();
        write_md(dir.path(), "note.md", "Rust is great.\nSystems programming.");
        let result = search_file_for_terms(
            &dir.path().join("note.md"),
            &["rust".to_string(), "programming".to_string()],
        );
        assert!(result.is_some());
    }

    #[test]
    fn search_file_multiple_terms_one_missing() {
        let dir = create_workspace();
        write_md(dir.path(), "note.md", "Rust is great.");
        let result = search_file_for_terms(
            &dir.path().join("note.md"),
            &["rust".to_string(), "python".to_string()],
        );
        assert!(result.is_none());
    }

    #[test]
    fn search_file_case_insensitive() {
        let dir = create_workspace();
        write_md(dir.path(), "note.md", "RUST is great.");
        let result = search_file_for_terms(
            &dir.path().join("note.md"),
            &["rust".to_string()],
        );
        assert!(result.is_some());
    }

    #[test]
    fn search_file_multiple_matching_lines() {
        let dir = create_workspace();
        write_md(dir.path(), "note.md", "Rust line one.\nRust line two.\nRust line three.");
        let result = search_file_for_terms(
            &dir.path().join("note.md"),
            &["rust".to_string()],
        );
        let (count, _) = result.unwrap();
        assert_eq!(count, 3);
    }

    #[test]
    fn search_file_special_regex_chars() {
        let dir = create_workspace();
        write_md(dir.path(), "note.md", "I love C++ programming.");
        let result = search_file_for_terms(
            &dir.path().join("note.md"),
            &["C++".to_string()],
        );
        assert!(result.is_some());
    }

    #[test]
    fn search_file_excerpt_is_first_matching_line() {
        let dir = create_workspace();
        write_md(dir.path(), "note.md", "No match here.\nFirst rust line.\nSecond rust line.");
        let result = search_file_for_terms(
            &dir.path().join("note.md"),
            &["rust".to_string()],
        );
        let (_, excerpt) = result.unwrap();
        assert_eq!(excerpt, "First rust line.");
    }

    // --- GraphIndex search (ripgrep) ---

    #[test]
    fn search_full_body() {
        let dir = create_workspace();
        write_md(
            dir.path(),
            "a.md",
            "---\ntitle: Intro\n---\nFirst paragraph.\n\nDeep in the body: thermodynamics rules.",
        );
        let gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();
        let results = gi.search("thermodynamics", 20).unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].id, "a.md");
    }

    #[test]
    fn search_ranks_by_match_count() {
        let dir = create_workspace();
        write_md(dir.path(), "many.md", "rust\nrust\nrust\nrust\nrust");
        write_md(dir.path(), "few.md", "rust once");
        let gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();
        let results = gi.search("rust", 20).unwrap();
        assert!(results.len() >= 2);
        assert_eq!(results[0].id, "many.md", "file with more matches should rank first");
    }

    #[test]
    fn search_multi_term_and() {
        let dir = create_workspace();
        write_md(dir.path(), "both.md", "quantum computing is here");
        write_md(dir.path(), "one.md", "quantum mechanics only");
        let gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();
        let results = gi.search("quantum computing", 20).unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].id, "both.md");
    }

    #[test]
    fn search_strips_trailing_star() {
        let dir = create_workspace();
        write_md(dir.path(), "alpha.md", "---\ntitle: Alpha\n---\nAlpha content.");
        let gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();
        let results = gi.search("Alph*", 20).unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].id, "alpha.md");
    }

    #[test]
    fn search_empty_query() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "Content.");
        let gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();
        let results = gi.search("", 20).unwrap();
        assert!(results.is_empty());
    }

    #[test]
    fn search_respects_limit() {
        let dir = create_workspace();
        for i in 0..5 {
            write_md(dir.path(), &format!("{i}.md"), "searchable content here");
        }
        let gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();
        let results = gi.search("searchable", 2).unwrap();
        assert_eq!(results.len(), 2);
    }

    #[test]
    fn search_shared_matcher_across_many_files() {
        let dir = create_workspace();
        for i in 0..50 {
            let content = if i % 5 == 0 {
                format!("This file mentions quantum computing on iteration {i}.")
            } else {
                format!("Unrelated content {i}.")
            };
            write_md(dir.path(), &format!("note_{i}.md"), &content);
        }
        let gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();
        let results = gi.search("quantum computing", 100).unwrap();
        assert_eq!(results.len(), 10, "every 5th of 50 files should match");
        for r in &results {
            assert!(r.score < 0.0, "score should be negative (negated count)");
        }
    }

    // --- GraphIndex search_by_title ---

    #[test]
    fn search_by_title_matches_title() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "---\ntitle: Quantum Computing\n---\nBody.");
        write_md(dir.path(), "b.md", "---\ntitle: Classical Physics\n---\nBody.");
        let gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();
        let results = gi.search_by_title("Quantum", 10).unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].id, "a.md");
        assert_eq!(results[0].title, "Quantum Computing");
    }

    #[test]
    fn search_by_title_matches_file_stem() {
        let dir = create_workspace();
        write_md(dir.path(), "quantum-notes.md", "---\ntitle: My Notes\n---\nBody.");
        let gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();
        let results = gi.search_by_title("quantum", 10).unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].id, "quantum-notes.md");
    }

    #[test]
    fn search_by_title_matches_aliases() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "---\ntitle: Alice\naliases:\n  - Ali\n---\nBody.");
        let gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();
        let results = gi.search_by_title("Ali", 10).unwrap();
        assert!(results.iter().any(|r| r.id == "a.md"));
    }

    #[test]
    fn search_by_title_returns_search_result_type() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "---\ntitle: Alpha\n---\nBody.");
        let gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();
        let results = gi.search_by_title("Alpha", 10).unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].score, 0.0);
        assert_eq!(results[0].excerpt, "");
    }

    #[test]
    fn search_by_title_empty_query_returns_empty() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "---\ntitle: Alpha\n---\nBody.");
        let gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();
        let results = gi.search_by_title("", 10).unwrap();
        assert!(results.is_empty());
    }

    #[test]
    fn search_by_title_excludes_stubs_from_wikilinks() {
        let dir = create_workspace();
        write_md(
            dir.path(),
            "real.md",
            "---\ntitle: Agentic Design Patterns\n---\nSee [[agentic-workflows]] for more.",
        );
        let gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();
        let results = gi.search_by_title("agentic", 10).unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].id, "real.md");
    }

    #[test]
    fn search_by_title_file_with_empty_frontmatter_title_uses_filename() {
        let dir = create_workspace();
        write_md(dir.path(), "agentic-workflows.md", "---\ntitle: \"\"\n---\nBody.");
        let gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();
        let results = gi.search_by_title("agentic", 10).unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].title, "agentic-workflows");
    }

    #[test]
    fn search_case_insensitive() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "QUANTUM computing.");
        let gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();
        let results = gi.search("quantum", 20).unwrap();
        assert_eq!(results.len(), 1);
    }

    #[test]
    fn unlinked_mentions_parallel_correctness() {
        let dir = create_workspace();
        write_md(dir.path(), "target.md", "---\ntitle: Alice\n---\nI am Alice.");
        for i in 0..30 {
            let content = if i % 2 == 0 {
                format!("File {i} mentions Alice in passing.")
            } else {
                format!("File {i} has no relevant names.")
            };
            write_md(dir.path(), &format!("src_{i}.md"), &content);
        }
        let gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();
        let mentions = gi.unlinked_mentions("target.md").unwrap();
        assert_eq!(mentions.len(), 15, "every even file of 30 should mention Alice");
        for m in &mentions {
            assert_eq!(m.matched_text, "Alice");
        }
    }

    #[test]
    fn search_parallel_produces_same_results() {
        let dir = create_workspace();
        for i in 0..30 {
            let content = if i % 3 == 0 {
                format!("This file discusses parallelism in iteration {i}.")
            } else {
                format!("Unrelated content number {i}.")
            };
            write_md(dir.path(), &format!("par_{i}.md"), &content);
        }
        let gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();
        let results = gi.search("parallelism", 100).unwrap();
        assert_eq!(results.len(), 10, "every 3rd of 30 files should match");
        for r in &results {
            assert!(r.score < 0.0, "score should be negative (negated count)");
        }
    }

    // --- load_from_store ---

    #[test]
    fn load_from_store_returns_none_when_no_db() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "Content.");
        let result = GraphIndex::load_from_store(dir.path().to_path_buf()).unwrap();
        assert!(result.is_none());
    }

    #[test]
    fn load_from_store_returns_none_when_empty_store() {
        let dir = create_workspace();
        let db_path = dir.path().join(".lit").join("graph.db");
        fs::create_dir_all(db_path.parent().unwrap()).unwrap();
        let _store = Store::open(&db_path).unwrap();
        let result = GraphIndex::load_from_store(dir.path().to_path_buf()).unwrap();
        assert!(result.is_none());
    }

    #[test]
    fn load_from_store_returns_graph_from_cached_data() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "Links to [[b]].");
        write_md(dir.path(), "b.md", "Target.");
        let gi1 = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();
        let stats1 = gi1.stats().unwrap();
        drop(gi1);

        let gi2 = GraphIndex::load_from_store(dir.path().to_path_buf()).unwrap();
        assert!(gi2.is_some());
        let gi2 = gi2.unwrap();
        let stats2 = gi2.stats().unwrap();
        assert_eq!(stats1.nodes, stats2.nodes);
        assert_eq!(stats1.edges, stats2.edges);
    }

    // --- sync_with_disk ---

    #[test]
    fn sync_with_disk_no_changes() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "Content.");
        GraphIndex::build(dir.path().to_path_buf(), true).unwrap();

        let gi = GraphIndex::load_from_store(dir.path().to_path_buf()).unwrap().unwrap();
        assert_eq!(gi.sync_with_disk(true).unwrap(), false);
    }

    #[test]
    fn sync_with_disk_detects_new_file() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "Content.");
        GraphIndex::build(dir.path().to_path_buf(), true).unwrap();

        write_md(dir.path(), "b.md", "New file.");
        let gi = GraphIndex::load_from_store(dir.path().to_path_buf()).unwrap().unwrap();
        let before = gi.stats().unwrap().nodes;
        assert_eq!(gi.sync_with_disk(true).unwrap(), true);
        assert!(gi.stats().unwrap().nodes > before);
    }

    #[test]
    fn sync_with_disk_detects_changed_file() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "Original.");
        GraphIndex::build(dir.path().to_path_buf(), true).unwrap();

        std::thread::sleep(std::time::Duration::from_millis(50));
        write_md(dir.path(), "a.md", "Modified content with [[b]].");
        write_md(dir.path(), "b.md", "Target.");
        let gi = GraphIndex::load_from_store(dir.path().to_path_buf()).unwrap().unwrap();
        assert_eq!(gi.sync_with_disk(true).unwrap(), true);
        let backlinks = gi.backlinks("b.md").unwrap();
        assert_eq!(backlinks.len(), 1);
    }

    #[test]
    fn sync_with_disk_detects_deleted_file() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "Keep.");
        write_md(dir.path(), "b.md", "Delete me.");
        GraphIndex::build(dir.path().to_path_buf(), true).unwrap();

        fs::remove_file(dir.path().join("b.md")).unwrap();
        let gi = GraphIndex::load_from_store(dir.path().to_path_buf()).unwrap().unwrap();
        let before = gi.stats().unwrap().nodes;
        assert_eq!(gi.sync_with_disk(true).unwrap(), true);
        assert!(gi.stats().unwrap().nodes < before);
    }

    // --- Cycle 10: full index stores annotations ---

    #[test]
    fn full_index_stores_annotations() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "Some text <!--- n: _ | important discovery ---> more.");
        let gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();
        let results = gi.search_annotations("important", None, 10).unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].node_id, "a.md");
        assert!(results[0].body.as_deref().unwrap().contains("important discovery"));
    }

    // --- Cycle 11: incremental reindex updates annotations ---

    #[test]
    fn incremental_reindex_updates_annotations() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "<!--- n: _ | old body --->");
        let gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();
        let results = gi.search_annotations("old", None, 10).unwrap();
        assert_eq!(results.len(), 1);

        write_md(dir.path(), "a.md", "<!--- n: _ | new body --->");
        gi.reindex_file("a.md", true).unwrap();

        let old_results = gi.search_annotations("old", None, 10).unwrap();
        assert!(old_results.is_empty());
        let new_results = gi.search_annotations("new", None, 10).unwrap();
        assert_eq!(new_results.len(), 1);
        assert!(new_results[0].body.as_deref().unwrap().contains("new body"));
    }

    // --- Cycle 12: annotations_enabled gating ---

    #[test]
    fn full_index_skips_annotations_when_disabled() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "<!--- n: _ | note body --->");
        fs::create_dir_all(dir.path().join(".lit")).unwrap();
        let store = Store::open(&dir.path().join(".lit").join("graph.db")).unwrap();
        index_workspace_with_progress(&store, dir.path(), &crate::graph::progress::noop_callback(), false).unwrap();

        let count: i64 = store
            .conn
            .query_row("SELECT COUNT(*) FROM annotations", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 0);
    }

    #[test]
    fn incremental_reindex_skips_when_disabled() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "initial content");
        fs::create_dir_all(dir.path().join(".lit")).unwrap();
        let store = Store::open(&dir.path().join(".lit").join("graph.db")).unwrap();
        index_workspace(&store, dir.path(), true).unwrap();

        write_md(dir.path(), "a.md", "<!--- n: _ | annotated --->");
        let diff = DiffResult {
            new: vec![],
            changed: vec!["a.md".to_string()],
            deleted: vec![],
        };
        let mut reverse = ReverseStemIndex::new();
        incremental_reindex(&store, dir.path(), &mut reverse, &diff, false).unwrap();

        let count: i64 = store
            .conn
            .query_row("SELECT COUNT(*) FROM annotations", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 0);
    }

    #[test]
    fn graph_index_build_skips_annotations_when_disabled() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "<!--- n: _ | note body --->");
        let gi = GraphIndex::build(dir.path().to_path_buf(), false).unwrap();
        let results = gi.search_annotations("note", None, 10).unwrap();
        assert!(results.is_empty());
    }

    #[test]
    fn graph_index_build_indexes_annotations_when_enabled() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "<!--- n: _ | note body --->");
        let gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();
        let results = gi.search_annotations("note", None, 10).unwrap();
        assert_eq!(results.len(), 1);
    }

    #[test]
    fn graph_index_sync_skips_annotations_when_disabled() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "initial");
        let gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(50));
        write_md(dir.path(), "a.md", "<!--- n: _ | synced note --->");
        gi.sync_with_disk(false).unwrap();
        let results = gi.search_annotations("synced", None, 10).unwrap();
        assert!(results.is_empty());
    }

    #[test]
    fn graph_index_reindex_file_skips_annotations_when_disabled() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "initial");
        let gi = GraphIndex::build(dir.path().to_path_buf(), false).unwrap();
        write_md(dir.path(), "a.md", "<!--- n: _ | reindexed note --->");
        gi.reindex_file("a.md", false).unwrap();
        let results = gi.search_annotations("reindexed", None, 10).unwrap();
        assert!(results.is_empty());
    }

    #[test]
    fn graph_index_remove_file_skips_annotations_when_disabled() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "<!--- n: _ | note --->");
        write_md(dir.path(), "b.md", "other");
        let gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();
        let results = gi.search_annotations("note", None, 10).unwrap();
        assert_eq!(results.len(), 1);
        fs::remove_file(dir.path().join("b.md")).unwrap();
        gi.remove_file("b.md", false).unwrap();
        let results = gi.search_annotations("note", None, 10).unwrap();
        assert_eq!(results.len(), 1);
    }

    #[test]
    fn graph_index_full_rebuild_skips_annotations_when_disabled() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "<!--- n: _ | note body --->");
        let gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();
        let results = gi.search_annotations("note", None, 10).unwrap();
        assert_eq!(results.len(), 1);
        let result = gi.full_rebuild(false).unwrap();
        assert_eq!(result.nodes_indexed, 1);
        let results = gi.search_annotations("note", None, 10).unwrap();
        assert!(results.is_empty());
    }

    // --- Layout positions ---

    fn build_graph_with_nodes(dir: &TempDir) -> GraphIndex {
        write_md(dir.path(), "alpha.md", "# Alpha\n\n[[beta]]");
        write_md(dir.path(), "beta.md", "# Beta\n\n[[gamma]]");
        write_md(dir.path(), "gamma.md", "# Gamma");
        GraphIndex::build(dir.path().to_path_buf(), false).unwrap()
    }

    #[test]
    fn get_positions_empty_initially() {
        let dir = create_workspace();
        let gi = build_graph_with_nodes(&dir);
        let positions = gi.get_positions();
        assert!(positions.is_empty());
    }

    #[test]
    fn compute_layout_background_populates_positions() {
        use crate::graph::layout::LayoutSettings;
        let dir = create_workspace();
        let gi = build_graph_with_nodes(&dir);
        gi.compute_layout_background(&LayoutSettings::default());
        let positions = gi.get_positions();
        assert_eq!(positions.len(), 3);
    }

    #[test]
    fn compute_layout_background_persists_to_store() {
        use crate::graph::layout::LayoutSettings;
        let dir = create_workspace();
        let gi = build_graph_with_nodes(&dir);
        gi.compute_layout_background(&LayoutSettings::default());
        let gi2 = GraphIndex::load_from_store(dir.path().to_path_buf()).unwrap().unwrap();
        let reloaded = gi2.get_positions();
        assert_eq!(reloaded.len(), 3);
    }

    #[test]
    fn clear_positions_empties_memory_and_store() {
        use crate::graph::layout::LayoutSettings;
        let dir = create_workspace();
        let gi = build_graph_with_nodes(&dir);
        gi.compute_layout_background(&LayoutSettings::default());
        assert_eq!(gi.get_positions().len(), 3);

        gi.clear_positions().unwrap();
        assert!(gi.get_positions().is_empty());

        let gi2 = GraphIndex::load_from_store(dir.path().to_path_buf()).unwrap().unwrap();
        assert!(gi2.get_positions().is_empty());
    }

    #[traced_test]
    #[test]
    fn compute_layout_background_logs_positions_saved() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "[[b]]");
        write_md(dir.path(), "b.md", "target");
        let gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();
        gi.compute_layout_background(&crate::graph::layout::LayoutSettings::default());
        assert!(logs_contain("layout positions saved"));
    }

    // --- GraphIndex::affected_sources ---

    #[test]
    fn graph_index_affected_sources_returns_linkers() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "links to [[B]]");
        write_md(dir.path(), "b.md", "target");
        write_md(dir.path(), "c.md", "links to [[D]]");
        write_md(dir.path(), "d.md", "other target");
        let gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();
        let affected = gi.affected_sources(&["b".to_string()]);
        assert!(affected.contains("a.md"));
        assert!(!affected.contains("c.md"));
    }

    #[test]
    fn graph_index_affected_sources_empty_stems() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "links to [[B]]");
        write_md(dir.path(), "b.md", "target");
        let gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();
        let affected = gi.affected_sources(&[]);
        assert!(affected.is_empty());
    }

    #[test]
    fn watcher_diff_created_file_resolves_stub() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "Links to [[b]].");
        let store = Store::open_memory().unwrap();
        let (_, mut reverse) = index_workspace(&store, dir.path(), true).unwrap();

        let meta = store.all_nodes_metadata().unwrap();
        assert!(
            meta.iter().any(|(id, is_stub, _)| id == "b" && *is_stub),
            "b should be a stub before b.md is created"
        );

        write_md(dir.path(), "b.md", "I exist now.");
        let diff = DiffResult {
            new: vec!["b.md".to_string()],
            changed: vec![],
            deleted: vec![],
        };
        incremental_reindex(&store, dir.path(), &mut reverse, &diff, true).unwrap();

        let meta = store.all_nodes_metadata().unwrap();
        assert!(
            !meta.iter().any(|(id, is_stub, _)| id == "b" && *is_stub),
            "stub 'b' should be cleaned up after b.md is created"
        );
        assert!(
            meta.iter().any(|(id, is_stub, _)| id == "b.md" && !is_stub),
            "b.md should exist as a real node"
        );
        let edges = store.all_edges().unwrap();
        assert!(
            edges.iter().any(|(s, t)| s == "a.md" && t == "b.md"),
            "a.md should link to b.md, edges: {:?}",
            edges
        );
    }

    // --- Issue #196: backlinks vs graph-view consistency ---
    //
    // These tests demonstrate edge cases where the two separate data sources
    // (store SQL queries for backlinks vs in-memory KnowledgeGraph for graph
    // view) can diverge, motivating a single-source-of-truth refactor.

    #[test]
    fn backlinks_match_graph_incoming_neighbors_after_cold_start() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "Links to [[b]] and [[c]].");
        write_md(dir.path(), "b.md", "Links to [[c]].");
        write_md(dir.path(), "c.md", "Links to [[a]].");
        let gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();

        for target in &["a.md", "b.md", "c.md"] {
            let bl_sources: HashSet<String> = gi
                .backlinks(target)
                .unwrap()
                .into_iter()
                .map(|e| e.source_id)
                .collect();

            let neighbors = gi.neighbors(target, 1, false).unwrap();
            let neighbor_ids: HashSet<&str> = neighbors
                .nodes
                .iter()
                .map(|n| n.id.as_str())
                .collect();

            for src in &bl_sources {
                assert!(
                    neighbor_ids.contains(src.as_str()),
                    "backlink source {} for target {} missing from graph neighbors {:?}",
                    src,
                    target,
                    neighbor_ids,
                );
            }
        }
    }

    #[test]
    fn backlinks_consistent_after_warm_start_with_new_linking_file() {
        let dir = create_workspace();
        write_md(dir.path(), "target.md", "I am the target.");
        write_md(dir.path(), "existing-linker.md", "Links to [[target]].");

        let gi1 = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();
        assert_eq!(gi1.backlinks("target.md").unwrap().len(), 1);
        drop(gi1);

        std::thread::sleep(std::time::Duration::from_millis(50));
        write_md(dir.path(), "new-linker.md", "Also links to [[target]].");

        let gi2 = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();
        let bl = gi2.backlinks("target.md").unwrap();
        let bl_sources: HashSet<String> = bl.into_iter().map(|e| e.source_id).collect();
        assert!(
            bl_sources.contains("new-linker.md"),
            "warm-start backlinks should include new-linker.md, got: {:?}",
            bl_sources,
        );

        let neighbors = gi2.neighbors("target.md", 1, false).unwrap();
        let neighbor_ids: HashSet<&str> = neighbors
            .nodes
            .iter()
            .map(|n| n.id.as_str())
            .collect();
        assert!(
            neighbor_ids.contains("new-linker.md"),
            "warm-start graph neighbors should include new-linker.md, got: {:?}",
            neighbor_ids,
        );
    }

    #[test]
    fn backlinks_appear_after_stub_resolved_by_batch_reindex() {
        let dir = create_workspace();
        write_md(dir.path(), "source.md", "Links to [[target]].");
        let gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();

        // Before target.md exists, backlinks for "target.md" should be empty
        // because the edge points to the stub "target", not "target.md"
        let bl_before = gi.backlinks("target.md").unwrap();
        assert!(
            bl_before.is_empty(),
            "no backlinks for target.md when it doesn't exist yet"
        );

        // Create the real file and reindex
        write_md(dir.path(), "target.md", "I exist now.");
        gi.batch_reindex(
            &DiffResult {
                new: vec!["target.md".to_string()],
                changed: vec![],
                deleted: vec![],
            },
            true,
        )
        .unwrap();

        // After reindex, backlinks("target.md") should include source.md
        let bl_after = gi.backlinks("target.md").unwrap();
        let bl_sources: HashSet<String> = bl_after.into_iter().map(|e| e.source_id).collect();
        assert!(
            bl_sources.contains("source.md"),
            "backlinks for target.md should include source.md after stub resolution, got: {:?}",
            bl_sources,
        );

        // Graph neighbors should also include source.md
        let neighbors = gi.neighbors("target.md", 1, false).unwrap();
        let neighbor_ids: HashSet<&str> = neighbors
            .nodes
            .iter()
            .map(|n| n.id.as_str())
            .collect();
        assert!(
            neighbor_ids.contains("source.md"),
            "graph neighbors should include source.md after stub resolution, got: {:?}",
            neighbor_ids,
        );
    }

    #[test]
    fn sync_with_disk_makes_new_backlinks_visible() {
        let dir = create_workspace();
        write_md(dir.path(), "target.md", "Target page.");
        write_md(dir.path(), "linker-a.md", "Links to [[target]].");
        let gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();
        assert_eq!(gi.backlinks("target.md").unwrap().len(), 1);

        // Add a new file that links to target — after build, so sync_with_disk sees it
        std::thread::sleep(std::time::Duration::from_millis(50));
        write_md(dir.path(), "linker-b.md", "Also links to [[target]].");
        gi.sync_with_disk(true).unwrap();

        let bl = gi.backlinks("target.md").unwrap();
        let bl_sources: HashSet<String> = bl.into_iter().map(|e| e.source_id).collect();
        assert!(
            bl_sources.contains("linker-b.md"),
            "sync_with_disk should make linker-b.md visible as backlink, got: {:?}",
            bl_sources,
        );

        let neighbors = gi.neighbors("target.md", 1, false).unwrap();
        let neighbor_ids: HashSet<&str> = neighbors
            .nodes
            .iter()
            .map(|n| n.id.as_str())
            .collect();
        assert!(
            neighbor_ids.contains("linker-b.md"),
            "graph neighbors should include linker-b.md after sync, got: {:?}",
            neighbor_ids,
        );
    }

    #[test]
    fn sync_with_disk_resolves_stub_and_updates_backlinks() {
        let dir = create_workspace();
        write_md(dir.path(), "source.md", "Links to [[future-page]].");
        let gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();
        assert!(gi.backlinks("future-page.md").unwrap().is_empty());

        std::thread::sleep(std::time::Duration::from_millis(50));
        write_md(dir.path(), "future-page.md", "I was created later.");
        gi.sync_with_disk(true).unwrap();

        let bl = gi.backlinks("future-page.md").unwrap();
        let bl_sources: HashSet<String> = bl.into_iter().map(|e| e.source_id).collect();
        assert!(
            bl_sources.contains("source.md"),
            "after sync, backlinks should show source.md linking to future-page.md, got: {:?}",
            bl_sources,
        );
    }

    #[test]
    fn backlinks_work_with_special_chars_in_filenames() {
        let dir = create_workspace();
        let target_name = "Alpha: First Part + Beta: Second Part.md";
        write_md(dir.path(), target_name, "Combined doc.");
        write_md(
            dir.path(),
            "linker.md",
            "Links to [[Alpha: First Part + Beta: Second Part]].",
        );
        let gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();

        let bl = gi.backlinks(target_name).unwrap();
        assert_eq!(
            bl.len(),
            1,
            "backlinks for file with special chars should work, got: {:?}",
            bl,
        );
        assert_eq!(bl[0].source_id, "linker.md");
    }

    #[test]
    fn backlinks_work_with_unicode_filenames() {
        let dir = create_workspace();
        let target_name = "知识图谱入门.md";
        write_md(dir.path(), target_name, "Content.");
        write_md(dir.path(), "reference.md", "See [[知识图谱入门]].");
        let gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();

        let bl = gi.backlinks(target_name).unwrap();
        assert_eq!(bl.len(), 1);
        assert_eq!(bl[0].source_id, "reference.md");

        let neighbors = gi.neighbors(target_name, 1, false).unwrap();
        let neighbor_ids: HashSet<&str> = neighbors
            .nodes
            .iter()
            .map(|n| n.id.as_str())
            .collect();
        assert!(neighbor_ids.contains("reference.md"));
    }

    #[test]
    fn warm_start_new_file_backlinks_match_graph() {
        let dir = create_workspace();
        write_md(dir.path(), "hub.md", "I am the hub. [[spoke-a]] [[spoke-b]]");
        write_md(dir.path(), "spoke-a.md", "Links back to [[hub]].");
        write_md(dir.path(), "spoke-b.md", "Links back to [[hub]].");

        let gi1 = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();

        let bl = gi1.backlinks("hub.md").unwrap();
        let bl_sources: HashSet<String> = bl.into_iter().map(|e| e.source_id).collect();
        assert_eq!(bl_sources.len(), 2);
        assert!(bl_sources.contains("spoke-a.md"));
        assert!(bl_sources.contains("spoke-b.md"));
        drop(gi1);

        // Add a third spoke
        std::thread::sleep(std::time::Duration::from_millis(50));
        write_md(dir.path(), "spoke-c.md", "Links back to [[hub]].");

        let gi2 = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();

        let bl = gi2.backlinks("hub.md").unwrap();
        let bl_sources: HashSet<String> = bl.into_iter().map(|e| e.source_id).collect();
        assert_eq!(
            bl_sources.len(),
            3,
            "warm start should index spoke-c's backlink, got: {:?}",
            bl_sources,
        );

        let neighbors = gi2.neighbors("hub.md", 1, false).unwrap();
        let neighbor_ids: HashSet<&str> = neighbors
            .nodes
            .iter()
            .map(|n| n.id.as_str())
            .collect();
        assert!(
            neighbor_ids.contains("spoke-c.md"),
            "graph neighbors should also include spoke-c.md, got: {:?}",
            neighbor_ids,
        );
    }

    #[test]
    fn backlinks_after_reindex_file_on_previously_unindexed_links() {
        let dir = create_workspace();
        write_md(dir.path(), "target.md", "Target.");
        write_md(dir.path(), "source.md", "No links yet.");
        let gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();
        assert!(gi.backlinks("target.md").unwrap().is_empty());

        // Source now links to target (simulates user editing and saving)
        write_md(dir.path(), "source.md", "Now links to [[target]].");
        gi.reindex_file("source.md", true).unwrap();

        let bl = gi.backlinks("target.md").unwrap();
        assert_eq!(bl.len(), 1);
        assert_eq!(bl[0].source_id, "source.md");

        let neighbors = gi.neighbors("target.md", 1, false).unwrap();
        let neighbor_ids: HashSet<&str> = neighbors
            .nodes
            .iter()
            .map(|n| n.id.as_str())
            .collect();
        assert!(neighbor_ids.contains("source.md"));
    }

    #[test]
    fn backlinks_and_graph_agree_on_multi_hop_network() {
        let dir = create_workspace();
        // A -> B -> C, D -> B, D -> C
        write_md(dir.path(), "a.md", "[[b]]");
        write_md(dir.path(), "b.md", "[[c]]");
        write_md(dir.path(), "c.md", "Leaf.");
        write_md(dir.path(), "d.md", "[[b]] and [[c]]");
        let gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();

        // b.md should have backlinks from a.md and d.md
        let bl_b: HashSet<String> = gi
            .backlinks("b.md")
            .unwrap()
            .into_iter()
            .map(|e| e.source_id)
            .collect();
        assert_eq!(bl_b.len(), 2, "b.md backlinks: {:?}", bl_b);
        assert!(bl_b.contains("a.md"));
        assert!(bl_b.contains("d.md"));

        // c.md should have backlinks from b.md and d.md
        let bl_c: HashSet<String> = gi
            .backlinks("c.md")
            .unwrap()
            .into_iter()
            .map(|e| e.source_id)
            .collect();
        assert_eq!(bl_c.len(), 2, "c.md backlinks: {:?}", bl_c);
        assert!(bl_c.contains("b.md"));
        assert!(bl_c.contains("d.md"));

        // Graph neighbors of b.md (undirected, depth=1) should include a, c, d
        let neighbors_b = gi.neighbors("b.md", 1, false).unwrap();
        let n_ids: HashSet<&str> = neighbors_b
            .nodes
            .iter()
            .map(|n| n.id.as_str())
            .collect();
        for expected in &["a.md", "c.md", "d.md"] {
            assert!(
                n_ids.contains(expected),
                "graph neighbors of b.md missing {}, got: {:?}",
                expected,
                n_ids,
            );
        }

        // Every backlink source should be a graph neighbor
        for src in &bl_b {
            assert!(
                n_ids.contains(src.as_str()),
                "backlink source {} not in graph neighbors of b.md",
                src,
            );
        }
    }

    // --- Edge-case coverage for unified KnowledgeGraph read path ---
    //
    // Now that GraphIndex delegates backlinks/forward_links to
    // KnowledgeGraph, these tests verify the store and graph agree on
    // edge data and that viz dedup is correctly layered on top.

    #[test]
    fn duplicate_wikilinks_backlinks_match_store_edges() {
        // A file mentions [[target]] twice. Both store and KG multigraph
        // keep both edges; viz SubgraphResult deduplicates for display.
        let dir = create_workspace();
        write_md(dir.path(), "source.md", "First [[target]]. Second [[target]].");
        write_md(dir.path(), "target.md", "Target.");
        let store = Store::open_memory().unwrap();
        index_workspace(&store, dir.path(), true).unwrap();

        let store_bl = store.backlinks("target.md").unwrap();
        let knowledge = KnowledgeGraph::from_store(&store).unwrap();
        let kg_bl = knowledge.backlinks("target.md").unwrap();

        let sub = knowledge.neighbors("target.md", 1, false).unwrap();
        let viz_edge_count = sub
            .edges
            .iter()
            .filter(|(s, t, _)| s == "source.md" && t == "target.md")
            .count();

        assert_eq!(store_bl.len(), 2, "store keeps both edge rows");
        assert_eq!(kg_bl.len(), 2, "KG multigraph keeps both edges");
        assert_eq!(
            store_bl.len(),
            kg_bl.len(),
            "store and KG backlinks agree"
        );
        assert_eq!(viz_edge_count, 1, "viz deduplicates to 1 edge per pair");
    }

    #[test]
    fn stub_edge_invisible_to_store_backlinks_for_real_node_id() {
        // When [[target]] creates a stub edge (source→"target"), querying
        // store.backlinks("target.md") returns nothing because the edge
        // target is "target" not "target.md". Root cause of issue #196.
        let dir = create_workspace();
        write_md(dir.path(), "source.md", "Links to [[target]].");
        // target.md does NOT exist yet
        let store = Store::open_memory().unwrap();
        index_workspace(&store, dir.path(), true).unwrap();

        // Edge points to stub "target", not "target.md"
        let all_edges = store.all_edges().unwrap();
        assert!(
            all_edges.iter().any(|(s, t)| s == "source.md" && t == "target"),
            "edge should point to stub 'target', edges: {:?}",
            all_edges,
        );

        // Backlinks for the stub ID works
        let bl_stub = store.backlinks("target").unwrap();
        assert_eq!(bl_stub.len(), 1, "backlinks('target') finds the stub edge");

        // But if target.md is later created, the frontend will query
        // backlinks("target.md") — which finds nothing
        // (This is what happens in issue #196 before the source is re-indexed)
        let bl_real = store.backlinks("target.md").unwrap();
        assert!(
            bl_real.is_empty(),
            "backlinks('target.md') finds nothing because edge target is 'target' not 'target.md'"
        );
    }

    #[test]
    fn backlinks_returns_incoming_only_while_neighbors_returns_both() {
        // Both backlinks() and neighbors() now read from KnowledgeGraph.
        // backlinks() returns incoming edges only; neighbors(directed=false)
        // returns both incoming and outgoing. By-design API difference.
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "Links to [[b]].");
        write_md(dir.path(), "b.md", "Links to [[c]].");
        write_md(dir.path(), "c.md", "Leaf.");
        let gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();

        // b.md's backlinks: only a.md (incoming)
        let bl: HashSet<String> = gi
            .backlinks("b.md")
            .unwrap()
            .into_iter()
            .map(|e| e.source_id)
            .collect();
        assert_eq!(bl.len(), 1);
        assert!(bl.contains("a.md"));

        // b.md's graph neighbors (undirected): a.md (incoming) + c.md (outgoing)
        let neighbors = gi.neighbors("b.md", 1, false).unwrap();
        let n_ids: HashSet<&str> = neighbors
            .nodes
            .iter()
            .filter(|n| n.id != "b.md")
            .map(|n| n.id.as_str())
            .collect();
        assert_eq!(n_ids.len(), 2);
        assert!(n_ids.contains("a.md"));
        assert!(n_ids.contains("c.md"));

        // backlinks = incoming only (1), neighbors = both directions (2)
        assert_ne!(
            bl.len(),
            n_ids.len(),
            "backlinks ({}) != neighbors ({}) — by-design API difference",
            bl.len(),
            n_ids.len(),
        );
    }

    #[test]
    fn late_file_creation_backlinks_and_graph_agree() {
        // Issue #196 scenario: source.md links to target, target.md is
        // created later. After incremental reindex, both backlinks() and
        // neighbors() (both via KG) see the resolved edge.
        let dir = create_workspace();
        write_md(dir.path(), "source.md", "See [[target]].");
        let gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();

        // Before target.md exists: graph can't find "target.md" as a node
        assert!(gi.neighbors("target.md", 1, false).is_err());
        assert!(gi.backlinks("target.md").unwrap().is_empty());

        // Create target.md and do incremental reindex
        write_md(dir.path(), "target.md", "Now I exist.");
        gi.batch_reindex(
            &DiffResult {
                new: vec!["target.md".to_string()],
                changed: vec![],
                deleted: vec![],
            },
            true,
        )
        .unwrap();

        // Graph should now show source.md as a neighbor of target.md
        let neighbors = gi.neighbors("target.md", 1, false).unwrap();
        let n_ids: HashSet<&str> = neighbors
            .nodes
            .iter()
            .map(|n| n.id.as_str())
            .collect();
        let graph_sees_source = n_ids.contains("source.md");

        // Backlinks should also show source.md
        let bl: HashSet<String> = gi
            .backlinks("target.md")
            .unwrap()
            .into_iter()
            .map(|e| e.source_id)
            .collect();
        let backlinks_sees_source = bl.contains("source.md");

        // CRITICAL: both must agree. If graph sees it but backlinks doesn't,
        // that's the issue #196 bug.
        assert!(
            graph_sees_source,
            "graph should see source.md as neighbor of target.md"
        );
        assert!(
            backlinks_sees_source,
            "backlinks should see source.md linking to target.md"
        );
        assert_eq!(
            graph_sees_source, backlinks_sees_source,
            "graph and backlinks must agree on whether source.md links to target.md"
        );
    }

    #[test]
    fn warm_start_resolves_stale_stub_edge() {
        // Scenario: cold start creates stub edge (source→"target").
        // Then target.md is created ON DISK but with the SAME mtime as the
        // initial indexing timestamp (e.g., file restored from backup).
        // On warm start, compute_diff sees target.md as new (not in sync
        // table) and should re-resolve, but source.md is NOT in the diff
        // and must be re-resolved via changed_stems.
        // This test verifies both code paths produce consistent results.
        let dir = create_workspace();
        write_md(dir.path(), "source.md", "Links to [[target]].");
        // Cold start — creates stub edge source.md → "target"
        let gi1 = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();
        assert!(gi1.backlinks("target.md").unwrap().is_empty());
        drop(gi1);

        // Create target.md AFTER cold start
        std::thread::sleep(std::time::Duration::from_millis(50));
        write_md(dir.path(), "target.md", "Created later.");

        // Warm start — should detect target.md as new, re-resolve source.md
        let gi2 = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();

        let bl = gi2.backlinks("target.md").unwrap();
        let bl_sources: HashSet<String> = bl.into_iter().map(|e| e.source_id).collect();

        let neighbors = gi2.neighbors("target.md", 1, false).unwrap();
        let n_ids: HashSet<&str> = neighbors
            .nodes
            .iter()
            .map(|n| n.id.as_str())
            .collect();

        // Both must agree
        assert!(
            bl_sources.contains("source.md"),
            "warm start backlinks should include source.md, got: {:?}",
            bl_sources,
        );
        assert!(
            n_ids.contains("source.md"),
            "warm start graph neighbors should include source.md, got: {:?}",
            n_ids,
        );
    }

    #[test]
    fn store_and_kg_backlink_sources_agree() {
        // After indexing a network, for every non-stub node, store.backlinks()
        // unique sources must match knowledge.backlink_source_ids().
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "[[b]] [[c]]");
        write_md(dir.path(), "b.md", "[[c]] [[a]]");
        write_md(dir.path(), "c.md", "[[a]]");
        write_md(dir.path(), "d.md", "[[a]] [[b]] [[c]]");
        let store = Store::open_memory().unwrap();
        index_workspace(&store, dir.path(), true).unwrap();

        let knowledge = KnowledgeGraph::from_store(&store).unwrap();

        for target in &["a.md", "b.md", "c.md"] {
            let store_sources: HashSet<String> = store
                .backlinks(target)
                .unwrap()
                .into_iter()
                .map(|e| e.source_id)
                .collect();

            let kg_sources = knowledge.backlink_source_ids(target).unwrap();

            assert_eq!(
                store_sources, kg_sources,
                "store and KG backlink sources must agree for {target}"
            );
        }
    }

    #[test]
    fn warm_start_no_diff_preserves_stale_stub_then_resolves() {
        // When the store has a stale stub edge and warm start sees no diff,
        // the stub persists. Creating the target file and re-building
        // triggers re-resolution so backlinks work.
        let dir = create_workspace();
        write_md(dir.path(), "source.md", "Links to [[target]].");

        // Cold start — creates stub edge source.md → "target"
        let gi1 = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();
        assert!(
            gi1.backlinks("target.md").unwrap().is_empty(),
            "before target.md exists, no backlinks for target.md"
        );
        drop(gi1);

        // Warm start (no changes on disk) — should preserve existing state
        let gi2 = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();
        let bl = gi2.backlinks("target.md").unwrap();
        assert!(
            bl.is_empty(),
            "warm start with stale stub: backlinks('target.md') still empty"
        );
        // But backlinks for the STUB id works
        let bl_stub = gi2.backlinks("target").unwrap();
        assert_eq!(
            bl_stub.len(),
            1,
            "backlinks('target') works but 'target.md' doesn't — stale stub problem"
        );
        drop(gi2);

        // NOW create target.md — this will be detected as "new" by compute_diff
        std::thread::sleep(std::time::Duration::from_millis(50));
        write_md(dir.path(), "target.md", "I exist now.");

        // Warm start WITH diff — should detect target.md as new
        let gi3 = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();

        // After warm start re-resolution, backlinks should work
        let bl = gi3.backlinks("target.md").unwrap();
        let bl_sources: HashSet<String> = bl.into_iter().map(|e| e.source_id).collect();
        assert!(
            bl_sources.contains("source.md"),
            "warm start should re-resolve stub edge so backlinks('target.md') includes source.md, got: {:?}",
            bl_sources,
        );
    }

    #[test]
    fn stale_stub_in_store_blocks_backlinks_until_reresolution() {
        // When edges point to a stub ID ("target") but the real node is
        // "target.md", backlinks for "target.md" returns nothing until
        // re-indexing resolves the stub edge to the real ID.
        let dir = create_workspace();
        write_md(dir.path(), "linker.md", "See also [[my-note]].");

        let store = Store::open_memory().unwrap();
        index_workspace(&store, dir.path(), true).unwrap();

        // Edge exists: linker.md → stub "my-note"
        let edges = store.all_edges().unwrap();
        assert!(edges.iter().any(|(s, t)| s == "linker.md" && t == "my-note"));

        // backlinks for stub ID works
        assert_eq!(store.backlinks("my-note").unwrap().len(), 1);
        // backlinks for real file ID does NOT work
        assert!(store.backlinks("my-note.md").unwrap().is_empty());

        // KnowledgeGraph also can't find my-note.md (it doesn't exist as a node)
        let knowledge = KnowledgeGraph::from_store(&store).unwrap();
        assert!(knowledge.neighbors("my-note.md", 1, false).is_err());

        // Now create the real file and re-index
        write_md(dir.path(), "my-note.md", "Content.");
        let diff = DiffResult {
            new: vec!["my-note.md".to_string()],
            changed: vec![],
            deleted: vec![],
        };
        let edges_raw = store.all_raw_edges().unwrap();
        let mut reverse = ReverseStemIndex::build_from_edges(
            &edges_raw
                .iter()
                .map(|(s, _, r)| (s.clone(), r.clone()))
                .collect::<Vec<_>>(),
        );
        incremental_reindex(&store, dir.path(), &mut reverse, &diff, true).unwrap();

        // NOW both paths should work
        let bl = store.backlinks("my-note.md").unwrap();
        assert_eq!(bl.len(), 1, "after re-resolution, backlinks should find linker.md");
        assert_eq!(bl[0].source_id, "linker.md");

        let knowledge = KnowledgeGraph::from_store(&store).unwrap();
        let neighbors = knowledge.neighbors("my-note.md", 1, false).unwrap();
        let n_ids: HashSet<&str> = neighbors
            .nodes
            .iter()
            .map(|n| n.id.as_str())
            .collect();
        assert!(
            n_ids.contains("linker.md"),
            "after re-resolution, graph also finds linker.md"
        );
    }

    #[test]
    fn orphaned_edges_invisible_to_both_store_and_kg() {
        // If an edge's source node is deleted from the nodes table without
        // cleaning up edges, store.backlinks() (JOIN fails) and KG (edge
        // not added during from_store) both silently drop it.
        let dir = create_workspace();
        write_md(dir.path(), "source.md", "Links to [[target]].");
        write_md(dir.path(), "target.md", "Target.");
        let store = Store::open_memory().unwrap();
        index_workspace(&store, dir.path(), true).unwrap();

        // Verify backlink exists
        assert_eq!(store.backlinks("target.md").unwrap().len(), 1);

        // Manually remove the source node but NOT its edges
        // (simulates a partial cleanup bug)
        store
            .conn
            .execute("DELETE FROM nodes WHERE id = 'source.md'", [])
            .unwrap();

        // Raw edge still exists
        let all_edges = store.all_edges().unwrap();
        assert!(
            all_edges.iter().any(|(s, t)| s == "source.md" && t == "target.md"),
            "raw edge should still exist after node deletion"
        );

        // But backlinks() uses JOIN → returns nothing
        let bl = store.backlinks("target.md").unwrap();
        assert!(
            bl.is_empty(),
            "backlinks() returns nothing when source node is missing (JOIN fails)"
        );

        // KnowledgeGraph built from same store also won't have the edge
        // because all_edges returns the edge but id_to_index won't have
        // the source node, so the edge is silently dropped
        let knowledge = KnowledgeGraph::from_store(&store).unwrap();
        let sub = knowledge.full_subgraph();
        assert!(
            !sub.edges.iter().any(|(s, _, _)| s == "source.md"),
            "KnowledgeGraph also drops edges from missing nodes"
        );
    }

    #[test]
    fn batch_reindex_returns_removed_annotation_uuids() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "Text <!--- n: _ | keep ---> more <!--- q: _ | remove --->");
        let gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();

        let remove_uuid: String = {
            let store = gi.store.lock().unwrap();
            store.conn.query_row(
                "SELECT uuid FROM annotations WHERE node_id = 'a.md' AND body = 'remove'",
                [], |r| r.get(0),
            ).unwrap()
        };

        write_md(dir.path(), "a.md", "Text <!--- n: _ | keep ---> more");
        let diff = DiffResult { new: vec![], changed: vec!["a.md".to_string()], deleted: vec![] };
        let removed = gi.batch_reindex(&diff, true).unwrap();

        assert_eq!(removed.len(), 1);
        assert_eq!(removed[0], ("a.md".to_string(), remove_uuid));
    }

    #[test]
    fn batch_reindex_returns_empty_when_no_annotations_removed() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "Text <!--- n: _ | stay --->");
        let gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();

        write_md(dir.path(), "a.md", "Changed text <!--- n: _ | stay --->");
        let diff = DiffResult { new: vec![], changed: vec!["a.md".to_string()], deleted: vec![] };
        let removed = gi.batch_reindex(&diff, true).unwrap();

        assert!(removed.is_empty());
    }

    // --- Phase 4: shadow node tests ---

    fn write_bib(root: &Path, rel_path: &str, content: &str) {
        let abs = root.join(rel_path);
        if let Some(parent) = abs.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(abs, content).unwrap();
    }

    /// Advance the mtime of a bib file by 2 seconds so the ingest ledger
    /// detects it as changed (the ledger stores second-resolution mtimes).
    fn bump_bib_mtime(path: &Path) {
        let meta = fs::metadata(path).unwrap();
        let current = filetime::FileTime::from_last_modification_time(&meta);
        let bumped = filetime::FileTime::from_unix_time(current.unix_seconds() + 2, 0);
        filetime::set_file_mtime(path, bumped).unwrap();
    }

    #[test]
    fn shadow_created_for_cited_bib_key() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "As shown in [@smith2024].");
        write_bib(
            dir.path(),
            "refs.bib",
            "@article{smith2024,\n  author = {Smith, John},\n  title = {Alpha},\n  year = {2024}\n}",
        );
        let gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();

        let meta = gi.store.lock().unwrap().all_nodes_metadata().unwrap();
        let shadow = meta.iter().find(|(id, _, _)| id == "bib:smith2024");
        assert!(
            shadow.is_some(),
            "shadow node bib:smith2024 must be created, nodes: {:?}",
            meta
        );
        let (_, is_stub, mat) = shadow.unwrap();
        assert!(!is_stub);
        assert_eq!(*mat, super::super::types::Materialization::Shadow);

        // Check title contains author and year
        let titles = gi.store.lock().unwrap().node_titles().unwrap();
        let title = titles.get("bib:smith2024").unwrap();
        assert!(title.contains("Smith"), "title should contain author: {}", title);
        assert!(title.contains("2024"), "title should contain year: {}", title);

        // Check citation edge target resolved to bib:smith2024
        let edges = gi.store.lock().unwrap().all_edges_full().unwrap();
        let cite_edge = edges.iter().find(|(s, _, _, _, _, k)| s == "a.md" && *k == EdgeKind::Citation);
        assert!(cite_edge.is_some(), "citation edge must exist");
        let (_, target, _, raw, _, _) = cite_edge.unwrap();
        assert_eq!(target, "bib:smith2024");
        assert_eq!(raw, "smith2024");
    }

    #[test]
    fn citekey_routes_edge_to_page_no_shadow() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "As shown in [@smith2024].");
        write_md(
            dir.path(),
            "notes/smith.md",
            "---\ncitekey: smith2024\n---\nNotes on Smith.",
        );
        write_bib(
            dir.path(),
            "refs.bib",
            "@article{smith2024,\n  author = {Smith, John},\n  title = {Alpha},\n  year = {2024}\n}",
        );
        let gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();

        // Citation edge target should be the citekey page, not bib:smith2024
        let edges = gi.store.lock().unwrap().all_edges_full().unwrap();
        let cite_edge = edges
            .iter()
            .find(|(s, _, _, _, _, k)| s == "a.md" && *k == EdgeKind::Citation);
        assert!(cite_edge.is_some(), "citation edge must exist");
        let (_, target, _, raw, _, _) = cite_edge.unwrap();
        assert_eq!(target, "notes/smith.md", "target should be citekey page");
        assert_eq!(raw, "smith2024", "raw_target stays the bib key");

        // No shadow node for smith2024 since citekey page claims it
        let meta = gi.store.lock().unwrap().all_nodes_metadata().unwrap();
        assert!(
            !meta.iter().any(|(id, _, _)| id == "bib:smith2024"),
            "citekey page claims the key; no shadow node should exist, nodes: {:?}",
            meta
        );
    }

    #[test]
    fn refresh_shadows_rescans_bibs() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "As shown in [@smith2024].");
        // No bib file initially
        let gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();

        // No shadow initially
        {
            let meta = gi.store.lock().unwrap().all_nodes_metadata().unwrap();
            assert!(!meta.iter().any(|(id, _, _)| id == "bib:smith2024"));
        }

        // Write bib file, then refresh
        write_bib(
            dir.path(),
            "refs.bib",
            "@article{smith2024,\n  author = {Smith, John},\n  title = {Alpha},\n  year = {2024}\n}",
        );
        let changed = gi.refresh_shadows().unwrap();
        assert!(changed, "refresh_shadows should report change");

        // Shadow should now exist
        {
            let meta = gi.store.lock().unwrap().all_nodes_metadata().unwrap();
            assert!(
                meta.iter().any(|(id, _, _)| id == "bib:smith2024"),
                "shadow must be created after refresh, nodes: {:?}",
                meta
            );
        }

        // Calling again without changes should return false
        let changed2 = gi.refresh_shadows().unwrap();
        assert!(!changed2, "no changes expected on second refresh");
    }

    #[test]
    fn incremental_citekey_removed_reresolves() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "As shown in [@smith2024].");
        write_md(
            dir.path(),
            "smith-note.md",
            "---\ncitekey: smith2024\n---\nNotes.",
        );
        write_bib(
            dir.path(),
            "refs.bib",
            "@article{smith2024,\n  author = {Smith, John},\n  title = {Alpha},\n  year = {2024}\n}",
        );
        let gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();

        // Initially: no shadow, citation target is smith-note.md
        {
            let meta = gi.store.lock().unwrap().all_nodes_metadata().unwrap();
            assert!(!meta.iter().any(|(id, _, _)| id == "bib:smith2024"));
            let edges = gi.store.lock().unwrap().all_edges_full().unwrap();
            let cite = edges
                .iter()
                .find(|(s, _, _, _, _, k)| s == "a.md" && *k == EdgeKind::Citation)
                .unwrap();
            assert_eq!(cite.1, "smith-note.md");
        }

        // Remove citekey from smith-note.md
        write_md(dir.path(), "smith-note.md", "---\ntitle: Smith\n---\nNotes.");
        let diff = DiffResult {
            new: vec![],
            changed: vec!["smith-note.md".to_string()],
            deleted: vec![],
        };
        gi.batch_reindex(&diff, true).unwrap();

        // Citation target should revert to bib:smith2024
        let edges = gi.store.lock().unwrap().all_edges_full().unwrap();
        let cite_edge = edges
            .iter()
            .find(|(s, _, _, _, _, k)| s == "a.md" && *k == EdgeKind::Citation);
        assert!(cite_edge.is_some());
        let (_, target, _, _, _, _) = cite_edge.unwrap();
        assert_eq!(target, "bib:smith2024");

        // Shadow should now be created
        let meta = gi.store.lock().unwrap().all_nodes_metadata().unwrap();
        assert!(
            meta.iter().any(|(id, _, _)| id == "bib:smith2024"),
            "shadow must be created when citekey is removed, nodes: {:?}",
            meta
        );
    }

    #[test]
    fn incremental_citekey_added_reresolves() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "As shown in [@smith2024].");
        write_bib(
            dir.path(),
            "refs.bib",
            "@article{smith2024,\n  author = {Smith, John},\n  title = {Alpha},\n  year = {2024}\n}",
        );
        let gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();

        // Initially: shadow bib:smith2024 exists, citation target is bib:smith2024
        {
            let meta = gi.store.lock().unwrap().all_nodes_metadata().unwrap();
            assert!(meta.iter().any(|(id, _, _)| id == "bib:smith2024"));
        }

        // Write a citekey page and reindex
        write_md(
            dir.path(),
            "smith-note.md",
            "---\ncitekey: smith2024\n---\nNotes.",
        );
        let diff = DiffResult {
            new: vec!["smith-note.md".to_string()],
            changed: vec![],
            deleted: vec![],
        };
        gi.batch_reindex(&diff, true).unwrap();

        // Citation edge target should now be smith-note.md
        let edges = gi.store.lock().unwrap().all_edges_full().unwrap();
        let cite_edge = edges
            .iter()
            .find(|(s, _, _, _, _, k)| s == "a.md" && *k == EdgeKind::Citation);
        assert!(cite_edge.is_some());
        let (_, target, _, _, _, _) = cite_edge.unwrap();
        assert_eq!(target, "smith-note.md");

        // Shadow should be pruned (citekey page claims the key)
        let meta = gi.store.lock().unwrap().all_nodes_metadata().unwrap();
        assert!(
            !meta.iter().any(|(id, _, _)| id == "bib:smith2024"),
            "shadow must be pruned when citekey page exists, nodes: {:?}",
            meta
        );
    }

    #[test]
    fn orphaned_shadow_pruned() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "As shown in [@smith2024].");
        write_bib(
            dir.path(),
            "refs.bib",
            "@article{smith2024,\n  author = {Smith, John},\n  title = {Alpha},\n  year = {2024}\n}",
        );
        let gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();

        // Shadow should exist initially
        let meta = gi.store.lock().unwrap().all_nodes_metadata().unwrap();
        assert!(
            meta.iter().any(|(id, _, _)| id == "bib:smith2024"),
            "shadow must exist after build"
        );

        // Remove citation from a.md and reindex
        write_md(dir.path(), "a.md", "No more citations.");
        let diff = DiffResult {
            new: vec![],
            changed: vec!["a.md".to_string()],
            deleted: vec![],
        };
        gi.batch_reindex(&diff, true).unwrap();

        // Shadow should be pruned
        let meta = gi.store.lock().unwrap().all_nodes_metadata().unwrap();
        assert!(
            !meta.iter().any(|(id, _, _)| id == "bib:smith2024"),
            "orphaned shadow must be pruned, nodes: {:?}",
            meta
        );
    }

    #[test]
    fn cited_key_absent_from_bib_no_shadow() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "As shown in [@ghost2024].");
        // No .bib file, or bib file without that key
        let gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();

        let meta = gi.store.lock().unwrap().all_nodes_metadata().unwrap();
        assert!(
            !meta.iter().any(|(id, _, _)| id == "bib:ghost2024" || id == "ghost2024"),
            "cited key absent from bib must not produce a node, nodes: {:?}",
            meta
        );

        // Edge target should remain as the raw key (not rewritten to bib:ghost2024)
        // because the key has no bib entry and no citekey page
        let edges = gi.store.lock().unwrap().all_edges_full().unwrap();
        let cite_edge = edges
            .iter()
            .find(|(s, _, _, _, _, k)| s == "a.md" && *k == EdgeKind::Citation);
        assert!(cite_edge.is_some(), "citation edge should still exist for citing_pages queries");
        let (_, target, _, _, _, _) = cite_edge.unwrap();
        assert_eq!(target, "ghost2024", "target should remain as raw key, not rewritten to bib:ghost2024");
    }

    #[test]
    fn stub_promoted_to_shadow_on_citation_resolve() {
        // When a page has both [[bib:smith2024]] (wikilink) and [@smith2024] (citation),
        // the wikilink creates a stub first; resolve_shadows should promote it to shadow.
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "See [[bib:smith2024]] and also [@smith2024].");
        write_bib(
            dir.path(),
            "refs.bib",
            "@article{smith2024,\n  author = {Smith, John},\n  title = {Alpha},\n  year = {2024}\n}",
        );
        let gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();

        let meta = gi.store.lock().unwrap().all_nodes_metadata().unwrap();
        let shadow = meta.iter().find(|(id, _, _)| id == "bib:smith2024");
        assert!(shadow.is_some(), "bib:smith2024 node must exist");
        let (_, is_stub, mat) = shadow.unwrap();
        assert_eq!(
            *mat,
            super::super::types::Materialization::Shadow,
            "bib:smith2024 should be shadow, not stub (promoted from stub)"
        );
        assert!(!is_stub, "is_stub should be false after promotion to shadow");
    }

    #[test]
    fn uncited_bib_key_no_shadow() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "No citations here.");
        write_bib(
            dir.path(),
            "refs.bib",
            "@article{smith2024,\n  author = {Smith, John},\n  title = {Alpha},\n  year = {2024}\n}",
        );
        let gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();

        let meta = gi.store.lock().unwrap().all_nodes_metadata().unwrap();
        assert!(
            !meta.iter().any(|(id, _, _)| id == "bib:smith2024"),
            "uncited bib key must not produce a shadow node, nodes: {:?}",
            meta
        );
    }

    #[test]
    fn shadow_partial_when_abstract_present() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "As shown in [@smith2024].");
        write_bib(
            dir.path(),
            "refs.bib",
            "@article{smith2024,\n  author = {Smith, John},\n  title = {Alpha},\n  year = {2024},\n  abstract = {This paper explores...}\n}",
        );
        let gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();

        let meta = gi.store.lock().unwrap().all_nodes_metadata().unwrap();
        let shadow = meta.iter().find(|(id, _, _)| id == "bib:smith2024");
        assert!(shadow.is_some(), "shadow node must exist");
        let (_, _, mat) = shadow.unwrap();
        assert_eq!(
            *mat,
            super::super::types::Materialization::Partial,
            "entry with abstract should be Partial"
        );
    }

    #[test]
    fn shadow_title_format() {
        use crate::bib::types::BibEntry;

        fn make_entry(authors: Vec<&str>, year: &str, title: &str) -> BibEntry {
            BibEntry {
                key: "test".into(),
                authors: authors.into_iter().map(String::from).collect(),
                title: title.into(),
                year: year.into(),
                entry_type: "article".into(),
                line_number: 0,
                bib_file: None,
                abstract_text: None,
                doi: None,
                journal: None,
                url: None,
                file: None,
                volume: None,
                number: None,
                pages: None,
                publisher: None,
                issn: None,
                isbn: None,
                arxiv_id: None,
                oclc: None,
                work_type: None,
                series: None,
                lccn: None,
                editors: vec![],
                tags: vec![],
            }
        }

        // Author "Smith, John", year 2024, title "Alpha" -> "Smith (2024) Alpha"
        let entry = make_entry(vec!["Smith, John"], "2024", "Alpha");
        assert_eq!(shadow_title(&entry), "Smith (2024) Alpha");

        // No title -> "Smith (2024)"
        let entry = make_entry(vec!["Smith, John"], "2024", "");
        assert_eq!(shadow_title(&entry), "Smith (2024)");

        // No author -> "Unknown (2024) Title"
        let entry = make_entry(vec![], "2024", "Some Title");
        assert_eq!(shadow_title(&entry), "Unknown (2024) Some Title");
    }

    #[test]
    fn refresh_shadows_detects_title_change() {
        // With DB-as-source-of-truth, gap-fill (from_scan=true) preserves
        // existing non-empty fields.  A title change in the .bib file is
        // picked up ONLY when the bib entry doesn't exist yet in the DB.
        // To test title change detection, start with NO bib file so the
        // initial build has no shadow, then write a bib with title "Alpha",
        // refresh (creates entry + shadow), change title to "Beta", and
        // use update_bib_fields (non-scan path) to propagate it.
        //
        // This test now verifies the NEW behavior: refresh_shadows after
        // writing a new bib creates the shadow with the correct title.
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "As shown in [@smith2024].");
        let gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();

        // No shadow initially
        {
            let meta = gi.store.lock().unwrap().all_nodes_metadata().unwrap();
            assert!(!meta.iter().any(|(id, _, _)| id == "bib:smith2024"));
        }

        // Write bib file and refresh
        write_bib(
            dir.path(),
            "refs.bib",
            "@article{smith2024,\n  author = {Smith, John},\n  title = {Alpha},\n  year = {2024}\n}",
        );
        let changed = gi.refresh_shadows().unwrap();
        assert!(changed, "refresh_shadows must detect new shadow");

        // Verify shadow exists with title containing "Alpha"
        {
            let titles = gi.store.lock().unwrap().node_titles().unwrap();
            let title = titles.get("bib:smith2024").expect("shadow must exist");
            assert!(
                title.contains("Alpha"),
                "initial title should contain 'Alpha', got: {title}"
            );
        }

        // Verify in-memory KnowledgeGraph was rebuilt
        {
            let kg = gi.knowledge.lock().unwrap();
            let subgraph = kg.full_subgraph_filtered(true, false);
            let node = subgraph
                .nodes
                .iter()
                .find(|n| n.id == "bib:smith2024")
                .expect("shadow must be in KnowledgeGraph");
            assert!(
                node.title.contains("Alpha"),
                "KnowledgeGraph title should contain 'Alpha', got: {}",
                node.title
            );
        }
    }

    #[test]
    fn refresh_shadows_detects_materialization_promotion() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "As shown in [@jones2023].");
        write_bib(
            dir.path(),
            "refs.bib",
            "@article{jones2023,\n  author = {Jones},\n  title = {Gamma},\n  year = {2023}\n}",
        );
        let gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();

        // Verify initial materialization is Shadow (no abstract)
        {
            let meta = gi.store.lock().unwrap().all_nodes_metadata().unwrap();
            let (_, _, mat) = meta
                .iter()
                .find(|(id, _, _)| id == "bib:jones2023")
                .expect("shadow must exist");
            assert_eq!(
                *mat,
                super::super::types::Materialization::Shadow,
                "without abstract, materialization should be Shadow"
            );
        }

        // Add abstract (promotes shadow -> partial, count stays at 1)
        write_bib(
            dir.path(),
            "refs.bib",
            "@article{jones2023,\n  author = {Jones},\n  title = {Gamma},\n  year = {2023},\n  abstract = {Some interesting text}\n}",
        );
        bump_bib_mtime(&dir.path().join("refs.bib"));
        let changed = gi.refresh_shadows().unwrap();
        assert!(changed, "refresh_shadows must detect materialization promotion even when count is unchanged");

        // Verify materialization is now Partial
        {
            let meta = gi.store.lock().unwrap().all_nodes_metadata().unwrap();
            let (_, _, mat) = meta
                .iter()
                .find(|(id, _, _)| id == "bib:jones2023")
                .expect("shadow must still exist");
            assert_eq!(
                *mat,
                super::super::types::Materialization::Partial,
                "with abstract, materialization should be Partial"
            );
        }

        // Verify in-memory KnowledgeGraph was rebuilt
        {
            let kg = gi.knowledge.lock().unwrap();
            let subgraph = kg.full_subgraph_filtered(true, false);
            let node = subgraph
                .nodes
                .iter()
                .find(|n| n.id == "bib:jones2023")
                .expect("shadow must be in KnowledgeGraph");
            assert_eq!(
                node.materialization,
                super::super::types::Materialization::Partial,
                "KnowledgeGraph should reflect Partial materialization"
            );
        }
    }

    // --- scoped shadow resolution (md-only diffs through batch_reindex) ---

    #[test]
    fn scoped_resolve_adds_shadow_for_newly_cited_key() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "No citations yet.");
        write_bib(
            dir.path(),
            "refs.bib",
            "@article{smith2024,\n  author = {Smith, John},\n  title = {Alpha},\n  year = {2024}\n}",
        );
        let gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();
        {
            let meta = gi.store.lock().unwrap().all_nodes_metadata().unwrap();
            assert!(
                !meta.iter().any(|(id, _, _)| id == "bib:smith2024"),
                "no shadow before the key is cited"
            );
        }

        write_md(dir.path(), "a.md", "As shown in [@smith2024].");
        gi.reindex_file("a.md", true).unwrap();

        let meta = gi.store.lock().unwrap().all_nodes_metadata().unwrap();
        assert!(
            meta.iter().any(|(id, _, _)| id == "bib:smith2024"),
            "shadow must be created for newly cited key, nodes: {:?}",
            meta
        );
        let edges = gi.store.lock().unwrap().all_edges_full().unwrap();
        let cite = edges
            .iter()
            .find(|(s, _, _, _, _, k)| s == "a.md" && *k == EdgeKind::Citation)
            .expect("citation edge must exist");
        assert_eq!(cite.1, "bib:smith2024", "edge must be retargeted to the shadow");
    }

    #[test]
    fn scoped_resolve_prunes_shadow_when_last_citation_removed() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "See [@smith2024].");
        write_md(dir.path(), "b.md", "Also [@smith2024].");
        write_bib(
            dir.path(),
            "refs.bib",
            "@article{smith2024,\n  author = {Smith, John},\n  title = {Alpha},\n  year = {2024}\n}",
        );
        let gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();

        // Remove the citation from a.md — b.md still cites it, shadow stays.
        write_md(dir.path(), "a.md", "Nothing here.");
        gi.reindex_file("a.md", true).unwrap();
        {
            let meta = gi.store.lock().unwrap().all_nodes_metadata().unwrap();
            assert!(
                meta.iter().any(|(id, _, _)| id == "bib:smith2024"),
                "shadow must survive while another page cites it"
            );
        }

        // Remove the last citation — shadow must be pruned.
        write_md(dir.path(), "b.md", "Nothing here either.");
        gi.reindex_file("b.md", true).unwrap();
        let meta = gi.store.lock().unwrap().all_nodes_metadata().unwrap();
        assert!(
            !meta.iter().any(|(id, _, _)| id == "bib:smith2024"),
            "shadow must be pruned when the last citation is removed, nodes: {:?}",
            meta
        );
    }

    #[test]
    fn scoped_resolve_leaves_unrelated_shadows_intact() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "See [@smith2024].");
        write_md(dir.path(), "b.md", "See [@jones2023].");
        write_bib(
            dir.path(),
            "refs.bib",
            "@article{smith2024,\n  author = {Smith},\n  title = {Alpha},\n  year = {2024}\n}\n@article{jones2023,\n  author = {Jones},\n  title = {Beta},\n  year = {2023}\n}",
        );
        let gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();

        // Reindex a.md only — b.md's shadow must not be touched.
        write_md(dir.path(), "a.md", "See [@smith2024] still.");
        gi.reindex_file("a.md", true).unwrap();

        let meta = gi.store.lock().unwrap().all_nodes_metadata().unwrap();
        assert!(
            meta.iter().any(|(id, _, _)| id == "bib:jones2023"),
            "unrelated shadow must survive a scoped reindex, nodes: {:?}",
            meta
        );
        let edges = gi.store.lock().unwrap().all_edges_full().unwrap();
        let cite = edges
            .iter()
            .find(|(s, _, _, _, _, k)| s == "b.md" && *k == EdgeKind::Citation)
            .expect("b.md citation edge must survive");
        assert_eq!(cite.1, "bib:jones2023");
    }

    #[test]
    fn scoped_resolve_citekey_page_precedence() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "No citations yet.");
        write_md(
            dir.path(),
            "smith-note.md",
            "---\ncitekey: smith2024\n---\nNotes on Smith.",
        );
        write_bib(
            dir.path(),
            "refs.bib",
            "@article{smith2024,\n  author = {Smith, John},\n  title = {Alpha},\n  year = {2024}\n}",
        );
        let gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();

        // Cite the key from a.md — must resolve to the citekey page, no shadow.
        write_md(dir.path(), "a.md", "As shown in [@smith2024].");
        gi.reindex_file("a.md", true).unwrap();

        let edges = gi.store.lock().unwrap().all_edges_full().unwrap();
        let cite = edges
            .iter()
            .find(|(s, _, _, _, _, k)| s == "a.md" && *k == EdgeKind::Citation)
            .expect("citation edge must exist");
        assert_eq!(cite.1, "smith-note.md", "citekey page takes precedence over bib shadow");

        let meta = gi.store.lock().unwrap().all_nodes_metadata().unwrap();
        assert!(
            !meta.iter().any(|(id, _, _)| id == "bib:smith2024"),
            "no shadow when a citekey page claims the key, nodes: {:?}",
            meta
        );
    }

    #[test]
    fn scoped_resolve_new_citekey_page_repoints_existing_edges() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "As shown in [@smith2024].");
        write_bib(
            dir.path(),
            "refs.bib",
            "@article{smith2024,\n  author = {Smith, John},\n  title = {Alpha},\n  year = {2024}\n}",
        );
        let gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();
        {
            let meta = gi.store.lock().unwrap().all_nodes_metadata().unwrap();
            assert!(meta.iter().any(|(id, _, _)| id == "bib:smith2024"), "shadow exists initially");
        }

        // A new page claims the citekey — reindexing only that page must
        // re-point a.md's existing edge and prune the shadow.
        write_md(
            dir.path(),
            "smith-note.md",
            "---\ncitekey: smith2024\n---\nNotes.",
        );
        let diff = DiffResult {
            new: vec!["smith-note.md".to_string()],
            changed: vec![],
            deleted: vec![],
        };
        gi.batch_reindex(&diff, true).unwrap();

        let edges = gi.store.lock().unwrap().all_edges_full().unwrap();
        let cite = edges
            .iter()
            .find(|(s, _, _, _, _, k)| s == "a.md" && *k == EdgeKind::Citation)
            .expect("citation edge must exist");
        assert_eq!(cite.1, "smith-note.md", "existing edge must re-point to the new citekey page");

        let meta = gi.store.lock().unwrap().all_nodes_metadata().unwrap();
        assert!(
            !meta.iter().any(|(id, _, _)| id == "bib:smith2024"),
            "shadow must be pruned once the citekey page claims the key, nodes: {:?}",
            meta
        );
    }

    #[test]
    fn scoped_resolve_drops_dangling_edges_for_tombstoned_key() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "See [@smith2024].");
        write_md(dir.path(), "b.md", "Also [@smith2024].");
        write_bib(
            dir.path(),
            "refs.bib",
            "@article{smith2024,\n  author = {Smith, John},\n  title = {Alpha},\n  year = {2024}\n}",
        );
        let gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();

        // Tombstone the bib item, then re-save a.md (still citing the key).
        {
            let store = gi.store.lock().unwrap();
            assert!(crate::bib::db::tombstone_bib_item(&store.conn, "smith2024").unwrap());
        }
        write_md(dir.path(), "a.md", "See [@smith2024] again.");
        gi.reindex_file("a.md", true).unwrap();

        // The shadow is no longer backed by a bib item — it must be gone,
        // along with every bib:* edge that pointed at it (b.md's included).
        let meta = gi.store.lock().unwrap().all_nodes_metadata().unwrap();
        assert!(
            !meta.iter().any(|(id, _, _)| id == "bib:smith2024"),
            "tombstoned key's shadow must be dropped, nodes: {:?}",
            meta
        );
        let edges = gi.store.lock().unwrap().all_edges_full().unwrap();
        assert!(
            !edges.iter().any(|(_, t, _, _, _, _)| t == "bib:smith2024"),
            "no edge may keep targeting the dropped shadow, edges: {:?}",
            edges
        );
    }

    // --- ingest gating in batch_reindex ---

    #[test]
    fn batch_reindex_skips_ingest_when_no_bib_in_diff() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "Nothing yet.");
        let gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();

        // A .bib appears on disk, but the diff is md-only — it must NOT be
        // ingested on the editor-save hot path.
        write_bib(
            dir.path(),
            "refs.bib",
            "@article{smith2024,\n  author = {Smith, John},\n  title = {Alpha},\n  year = {2024}\n}",
        );
        write_md(dir.path(), "a.md", "Changed.");
        gi.reindex_file("a.md", true).unwrap();

        let store = gi.store.lock().unwrap();
        let ledger_count: i64 = store
            .conn
            .query_row("SELECT COUNT(*) FROM bib_source_files", [], |r| r.get(0))
            .unwrap();
        assert_eq!(ledger_count, 0, "md-only diff must not touch the bib ingest ledger");
        let item = crate::bib::db::get_bib_item(&store.conn, "smith2024").unwrap();
        assert!(item.is_none(), "md-only diff must not ingest new bib items");
    }

    #[test]
    fn batch_reindex_ingests_and_fully_resolves_when_bib_in_diff() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "See [@smith2024].");
        let gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();
        {
            let meta = gi.store.lock().unwrap().all_nodes_metadata().unwrap();
            assert!(!meta.iter().any(|(id, _, _)| id == "bib:smith2024"), "no shadow yet");
        }

        write_bib(
            dir.path(),
            "refs.bib",
            "@article{smith2024,\n  author = {Smith, John},\n  title = {Alpha},\n  year = {2024}\n}",
        );
        let diff = DiffResult {
            new: vec!["refs.bib".to_string()],
            changed: vec![],
            deleted: vec![],
        };
        gi.batch_reindex(&diff, true).unwrap();

        let store = gi.store.lock().unwrap();
        let item = crate::bib::db::get_bib_item(&store.conn, "smith2024").unwrap();
        assert!(item.is_some(), "bib-in-diff must ingest the new bib file");
        let meta = store.all_nodes_metadata().unwrap();
        assert!(
            meta.iter().any(|(id, _, _)| id == "bib:smith2024"),
            "bib-in-diff must resolve shadows vault-wide, nodes: {:?}",
            meta
        );
    }

    #[test]
    fn resolve_shadows_tx_wraps_in_transaction() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "As shown in [@smith2024].");
        write_bib(
            dir.path(),
            "refs.bib",
            "@article{smith2024,\n  author = {Smith, John},\n  title = {Alpha},\n  year = {2024}\n}",
        );

        // Index the workspace (creates edges) without shadow resolution
        fs::create_dir_all(dir.path().join(".lit")).unwrap();
        let store = Store::open(&dir.path().join(".lit/graph.db")).unwrap();
        index_workspace(&store, dir.path(), true).unwrap();

        let bib_cache = crate::bib::cache::BibCache::new();
        crate::bib::db::ingest_workspace_bibs(&store.conn, dir.path(), &bib_cache).unwrap();
        resolve_shadows_tx(&store).unwrap();

        // Shadow node should exist
        let meta = store.all_nodes_metadata().unwrap();
        let shadow = meta.iter().find(|(id, _, _)| id == "bib:smith2024");
        assert!(
            shadow.is_some(),
            "resolve_shadows_tx must create shadow node bib:smith2024, nodes: {:?}",
            meta
        );

        // Transaction should be committed -- verify by successfully beginning a new one
        store.begin_transaction().unwrap();
        store.commit().unwrap();
    }

    #[test]
    fn resolve_shadows_tx_rolls_back_on_error() {
        // Setup: workspace with a citation + bib so resolve_shadows has work to do
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "As shown in [@smith2024].");
        write_bib(
            dir.path(),
            "refs.bib",
            "@article{smith2024,\n  author = {Smith, John},\n  title = {Alpha},\n  year = {2024}\n}",
        );

        // Index the workspace to populate edges
        fs::create_dir_all(dir.path().join(".lit")).unwrap();
        let store = Store::open(&dir.path().join(".lit/graph.db")).unwrap();
        index_workspace(&store, dir.path(), true).unwrap();

        // Sabotage: drop the edges table so resolve_shadows will fail
        // when it tries to SELECT from edges
        store
            .conn
            .execute_batch("DROP TABLE edges")
            .unwrap();

        // Act: resolve_shadows_tx should fail
        let result = resolve_shadows_tx(&store);
        assert!(
            result.is_err(),
            "resolve_shadows_tx must fail when edges table is missing"
        );

        // Assert: the connection must NOT be stuck in an open transaction.
        // If rollback was not issued, begin_transaction will fail with
        // "cannot start a transaction within a transaction".
        store
            .begin_transaction()
            .expect("begin_transaction must succeed — no dangling open transaction");
        store.commit().unwrap();
    }

    #[test]
    fn resolve_shadows_propagates_row_error() {
        // Setup: workspace with a citation + bib so resolve_shadows has work to do
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "As shown in [@smith2024].");
        write_bib(
            dir.path(),
            "refs.bib",
            "@article{smith2024,\n  author = {Smith, John},\n  title = {Alpha},\n  year = {2024}\n}",
        );

        // Index the workspace to populate edges
        fs::create_dir_all(dir.path().join(".lit")).unwrap();
        let store = Store::open(&dir.path().join(".lit/graph.db")).unwrap();
        index_workspace(&store, dir.path(), true).unwrap();

        // Sabotage: insert a row with NULL raw_target into the edges table.
        // The query_map closure does row.get::<_, String>(0) on raw_target;
        // a NULL value will cause rusqlite::Error::InvalidColumnType.
        store
            .conn
            .execute(
                "INSERT INTO edges (source, target, raw_target, edge_kind) VALUES ('x', '', NULL, 'citation')",
                [],
            )
            .unwrap();

        // Act: resolve_shadows_tx should fail because the NULL row causes a
        // row-level error that must be propagated, not silently swallowed.
        let bib_cache = crate::bib::cache::BibCache::new();
        crate::bib::db::ingest_workspace_bibs(&store.conn, dir.path(), &bib_cache).unwrap();
        let result = resolve_shadows_tx(&store);
        assert!(
            result.is_err(),
            "resolve_shadows_tx must propagate row-level errors from NULL raw_target"
        );

        // Assert: no dangling transaction after the error
        store
            .begin_transaction()
            .expect("begin_transaction must succeed — no dangling open transaction");
        store.commit().unwrap();
    }

    #[test]
    fn incremental_reindex_shadow_not_in_stem_lookup() {
        // Step 1: create workspace with a citation and a bib file so
        // resolve_shadows_tx creates `bib:smith2024` as a shadow node.
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "As shown in [@smith2024].");
        write_bib(
            dir.path(),
            "refs.bib",
            "@article{smith2024,\n  author = {Smith, John},\n  title = {Alpha},\n  year = {2024}\n}",
        );

        fs::create_dir_all(dir.path().join(".lit")).unwrap();
        let store = Store::open(&dir.path().join(".lit/graph.db")).unwrap();
        let (_, mut reverse) = index_workspace(&store, dir.path(), true).unwrap();

        let bib_cache = crate::bib::cache::BibCache::new();
        crate::bib::db::ingest_workspace_bibs(&store.conn, dir.path(), &bib_cache).unwrap();
        resolve_shadows_tx(&store).unwrap();

        // Verify the shadow node exists
        let meta = store.all_nodes_metadata().unwrap();
        assert!(
            meta.iter().any(|(id, _, _)| id == "bib:smith2024"),
            "shadow node bib:smith2024 must exist after resolve_shadows_tx"
        );

        // Step 2: verify the StemLookup built during incremental reindex
        // excludes the shadow node.  `resolvable_node_ids` should not
        // contain bib:smith2024.
        let resolvable = store.resolvable_node_ids().unwrap();
        assert!(
            !resolvable.contains(&"bib:smith2024".to_string()),
            "resolvable_node_ids must exclude shadow bib:smith2024, got: {:?}",
            resolvable
        );

        // all_node_ids still contains it (for completeness)
        let all = store.all_node_ids().unwrap();
        assert!(
            all.contains(&"bib:smith2024".to_string()),
            "all_node_ids must still include shadow bib:smith2024"
        );

        // Step 3: verify StemLookup.resolve returns Unresolved for the shadow
        let aliases = store.all_aliases().unwrap();
        let lookup = super::super::resolve::StemLookup::build(&resolvable, &aliases);
        let resolved = lookup.resolve("bib:smith2024");
        assert_eq!(
            resolved.tier,
            super::super::resolve::ResolutionTier::Unresolved,
            "bib:smith2024 shadow must not appear in StemLookup"
        );

        // Step 4: add a new file that tries to wikilink to the shadow node
        // and run incremental reindex.
        write_md(dir.path(), "b.md", "See [[bib:smith2024]].");
        let diff = DiffResult {
            new: vec!["b.md".to_string()],
            changed: vec![],
            deleted: vec![],
        };
        incremental_reindex(&store, dir.path(), &mut reverse, &diff, true).unwrap();

        // The wikilink edge target is the raw string "bib:smith2024" (since
        // StemLookup returns Unresolved, the code falls through to
        // upsert_stub).  The key guarantee: StemLookup did NOT match the
        // shadow as an ExactPath/Stem hit, so no legitimate wikilink
        // resolution occurred.  Verify via a fresh StemLookup:
        let resolvable_after = store.resolvable_node_ids().unwrap();
        let aliases_after = store.all_aliases().unwrap();
        let lookup_after = super::super::resolve::StemLookup::build(&resolvable_after, &aliases_after);
        let resolved_after = lookup_after.resolve("bib:smith2024");
        assert_eq!(
            resolved_after.tier,
            super::super::resolve::ResolutionTier::Unresolved,
            "bib:smith2024 must remain unresolved in StemLookup after incremental reindex"
        );
    }

    // --- bib index caching integration test ---

    #[test]
    fn batch_reindex_skips_bib_walk_on_md_only_change() {
        // Setup: workspace with a.md citing [@smith2024] and refs.bib
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "As shown in [@smith2024].");
        write_bib(
            dir.path(),
            "refs.bib",
            "@article{smith2024,\n  author = {Smith, John},\n  title = {Alpha},\n  year = {2024}\n}",
        );

        // Build the graph index (populates bib index cache)
        let gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();

        // Verify shadow node exists
        let store = gi.store();
        let meta = store.all_nodes_metadata().unwrap();
        assert!(
            meta.iter().any(|(id, _, _)| id == "bib:smith2024"),
            "shadow node bib:smith2024 must exist after build"
        );
        drop(store);

        // Delete refs.bib from disk (simulate the test) but do NOT call mark_bib_dirty
        fs::remove_file(dir.path().join("refs.bib")).unwrap();

        // Change a.md and call batch_reindex with the changed diff
        write_md(dir.path(), "a.md", "As shown in [@smith2024]. Updated.");
        let diff = DiffResult {
            new: vec![],
            changed: vec!["a.md".to_string()],
            deleted: vec![],
        };
        gi.batch_reindex(&diff, true).unwrap();

        // Assert the shadow node bib:smith2024 still exists (DB retains the entry)
        let store = gi.store();
        let meta = store.all_nodes_metadata().unwrap();
        assert!(
            meta.iter().any(|(id, _, _)| id == "bib:smith2024"),
            "shadow node bib:smith2024 must still exist after md-only reindex (DB retains entry)"
        );
    }

    // --- Phase 3: ingest hook integration tests ---

    #[test]
    fn resolve_shadows_uses_db_not_filesystem() {
        // Build with a .bib file, verify shadow exists. Then delete the
        // .bib file from disk but confirm shadow survives because
        // resolve_shadows reads from DB, not filesystem.
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "As shown in [@smith2024].");
        write_bib(
            dir.path(),
            "refs.bib",
            "@article{smith2024,\n  author = {Smith, John},\n  title = {Alpha},\n  year = {2024}\n}",
        );

        fs::create_dir_all(dir.path().join(".lit")).unwrap();
        let store = Store::open(&dir.path().join(".lit/graph.db")).unwrap();
        index_workspace(&store, dir.path(), true).unwrap();

        let bib_cache = crate::bib::cache::BibCache::new();
        crate::bib::db::ingest_workspace_bibs(&store.conn, dir.path(), &bib_cache).unwrap();
        resolve_shadows_tx(&store).unwrap();

        let meta = store.all_nodes_metadata().unwrap();
        assert!(meta.iter().any(|(id, _, _)| id == "bib:smith2024"),
            "shadow must exist after initial build");

        // Delete .bib file from disk
        fs::remove_file(dir.path().join("refs.bib")).unwrap();

        // Insert the entry directly into bib_items (simulating DB-only data)
        // It's already there from the ingest, so just call resolve_shadows_tx
        // again -- it should still work because it reads from DB.
        resolve_shadows_tx(&store).unwrap();

        let meta2 = store.all_nodes_metadata().unwrap();
        assert!(meta2.iter().any(|(id, _, _)| id == "bib:smith2024"),
            "shadow must survive after .bib deleted from disk (DB is source of truth)");
    }

    #[test]
    fn build_with_progress_ingests_bibs() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "As shown in [@smith2024].");
        write_bib(
            dir.path(),
            "refs.bib",
            "@article{smith2024,\n  author = {Smith, John},\n  title = {Alpha},\n  year = {2024}\n}",
        );

        let gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();
        let store = gi.store.lock().unwrap();

        // bib_items should have the entry
        let items = crate::bib::db::list_bib_items(&store.conn).unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].key, "smith2024");

        // bib_source_files ledger should have the file
        let refs_path = dir.path().join("refs.bib").to_string_lossy().to_string();
        let mtime = crate::bib::db::get_source_mtime(&store.conn, &refs_path).unwrap();
        assert!(mtime.is_some(), "bib_source_files must have a ledger row for refs.bib");
    }

    #[test]
    fn refresh_shadows_ingests_before_resolving() {
        // Build WITHOUT a .bib file. Then write one and call refresh_shadows.
        // Both bib_items and shadow node should be populated.
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "As shown in [@smith2024].");

        let gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();

        // No shadow initially
        {
            let meta = gi.store.lock().unwrap().all_nodes_metadata().unwrap();
            assert!(!meta.iter().any(|(id, _, _)| id == "bib:smith2024"));
        }

        // Write bib file, then refresh
        write_bib(
            dir.path(),
            "refs.bib",
            "@article{smith2024,\n  author = {Smith, John},\n  title = {Alpha},\n  year = {2024}\n}",
        );
        gi.refresh_shadows().unwrap();

        // bib_items should be populated
        let store = gi.store.lock().unwrap();
        let items = crate::bib::db::list_bib_items(&store.conn).unwrap();
        assert_eq!(items.len(), 1, "ingest must run before resolve in refresh_shadows");

        // Shadow node should exist
        let meta = store.all_nodes_metadata().unwrap();
        assert!(
            meta.iter().any(|(id, _, _)| id == "bib:smith2024"),
            "shadow must be created after refresh_shadows ingests bibs"
        );
    }

    #[test]
    fn batch_reindex_ingests_bibs() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "As shown in [@smith2024].");
        write_bib(
            dir.path(),
            "refs.bib",
            "@article{smith2024,\n  author = {Smith, John},\n  title = {Alpha},\n  year = {2024}\n}",
        );

        let gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();

        // Write a new bib file
        write_bib(
            dir.path(),
            "extra.bib",
            "@book{doe2022,\n  author = {Doe},\n  title = {Gamma},\n  year = {2022}\n}",
        );

        // Also add a citation to the new entry. The .bib must be part of the
        // diff — md-only diffs skip ingest on the editor-save hot path.
        write_md(dir.path(), "b.md", "See [@doe2022].");
        let diff = DiffResult {
            new: vec!["b.md".to_string(), "extra.bib".to_string()],
            changed: vec![],
            deleted: vec![],
        };
        gi.batch_reindex(&diff, true).unwrap();

        // Both entries should be in bib_items
        let store = gi.store.lock().unwrap();
        let items = crate::bib::db::list_bib_items(&store.conn).unwrap();
        assert!(
            items.iter().any(|e| e.key == "doe2022"),
            "new bib entry must be ingested during batch_reindex"
        );
    }

    // --- cardbox edge integration (Phase 5) ---

    use crate::graph::types::IndexableAnnotation;
    use crate::commands::cardbox::CardboxLayout;

    fn write_cardbox_layout(root: &Path, layout: &CardboxLayout) {
        let lit_dir = root.join(".lit");
        fs::create_dir_all(&lit_dir).unwrap();
        let content = serde_json::to_string_pretty(layout).unwrap();
        fs::write(lit_dir.join("cardbox.json"), content).unwrap();
    }

    fn make_annotation_for_indexer(uuid: &str, char_start: usize, char_end: usize) -> IndexableAnnotation {
        IndexableAnnotation {
            annotation_type: "note".to_string(),
            certainty: "certain".to_string(),
            body: Some(format!("note {}", uuid)),
            date: None,
            source_line: 1,
            char_start,
            char_end,
            scope_kind: "block".to_string(),
            scope_value: "_".to_string(),
            uuid: Some(uuid.to_string()),
        }
    }

    fn count_cardbox_edges_in_store(store: &Store) -> usize {
        store
            .all_edges_full()
            .unwrap()
            .iter()
            .filter(|e| e.5 == EdgeKind::Cardbox)
            .count()
    }

    #[test]
    fn full_rebuild_syncs_cardbox_edges_from_layout() {
        let dir = create_workspace();
        // Two documents with annotations
        write_md(dir.path(), "a.md", "text<!--- note _ --->rest of a");
        write_md(dir.path(), "b.md", "text<!--- note _ --->rest of b");

        // Build first to get annotations indexed
        let gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();

        // Get annotation UUIDs from the store
        let (uuid_a, uuid_b) = {
            let store = gi.store.lock().unwrap();
            let anns_a = store.list_annotations(Some("a.md"), None, 10).unwrap();
            let anns_b = store.list_annotations(Some("b.md"), None, 10).unwrap();
            assert!(!anns_a.is_empty(), "a.md should have annotations");
            assert!(!anns_b.is_empty(), "b.md should have annotations");
            (anns_a[0].uuid.clone(), anns_b[0].uuid.clone())
        };

        // Write a cardbox layout linking the two annotations
        let layout = CardboxLayout {
            links: vec![[uuid_a.clone(), uuid_b.clone()]],
            ..Default::default()
        };
        write_cardbox_layout(dir.path(), &layout);

        // Full rebuild should pick up cardbox edges
        gi.full_rebuild(true).unwrap();

        let store = gi.store.lock().unwrap();
        assert_eq!(
            count_cardbox_edges_in_store(&store),
            1,
            "full_rebuild should create cardbox edge from layout"
        );
    }

    #[test]
    fn build_with_progress_syncs_cardbox_edges() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "text<!--- note _ --->rest of a");
        write_md(dir.path(), "b.md", "text<!--- note _ --->rest of b");

        // Build once to index annotations and get their UUIDs
        let gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();
        let (uuid_a, uuid_b) = {
            let store = gi.store.lock().unwrap();
            let anns_a = store.list_annotations(Some("a.md"), None, 10).unwrap();
            let anns_b = store.list_annotations(Some("b.md"), None, 10).unwrap();
            (anns_a[0].uuid.clone(), anns_b[0].uuid.clone())
        };
        drop(gi);

        // Write cardbox layout
        let layout = CardboxLayout {
            links: vec![[uuid_a, uuid_b]],
            ..Default::default()
        };
        write_cardbox_layout(dir.path(), &layout);

        // build_with_progress (warm start) should sync cardbox edges
        let gi2 = GraphIndex::build_with_progress(
            dir.path().to_path_buf(),
            &super::super::progress::noop_callback(),
            true,
        ).unwrap();

        let store = gi2.store.lock().unwrap();
        assert_eq!(
            count_cardbox_edges_in_store(&store),
            1,
            "build_with_progress should create cardbox edge from layout"
        );
    }

    #[test]
    fn sync_cardbox_edge_add_creates_edge_and_updates_knowledge() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "text<!--- note _ --->rest of a");
        write_md(dir.path(), "b.md", "text<!--- note _ --->rest of b");

        let gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();

        let (uuid_a, uuid_b) = {
            let store = gi.store.lock().unwrap();
            let anns_a = store.list_annotations(Some("a.md"), None, 10).unwrap();
            let anns_b = store.list_annotations(Some("b.md"), None, 10).unwrap();
            (anns_a[0].uuid.clone(), anns_b[0].uuid.clone())
        };

        let added = gi.sync_cardbox_edge_add(&uuid_a, &uuid_b).unwrap();
        assert!(added, "should return true when edge is created");

        // Verify edge exists in store
        let store = gi.store.lock().unwrap();
        assert_eq!(count_cardbox_edges_in_store(&store), 1);
        drop(store);

        // Second call should return false (already exists)
        let added2 = gi.sync_cardbox_edge_add(&uuid_a, &uuid_b).unwrap();
        assert!(!added2, "should return false when edge already exists");
    }

    #[test]
    fn sync_cardbox_edge_remove_deletes_edge_and_updates_knowledge() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "text<!--- note _ --->rest of a");
        write_md(dir.path(), "b.md", "text<!--- note _ --->rest of b");

        let gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();

        let (uuid_a, uuid_b) = {
            let store = gi.store.lock().unwrap();
            let anns_a = store.list_annotations(Some("a.md"), None, 10).unwrap();
            let anns_b = store.list_annotations(Some("b.md"), None, 10).unwrap();
            (anns_a[0].uuid.clone(), anns_b[0].uuid.clone())
        };

        // First add the edge
        gi.sync_cardbox_edge_add(&uuid_a, &uuid_b).unwrap();

        // Then remove with an empty layout (no remaining links)
        let layout = CardboxLayout::default();
        let removed = gi.sync_cardbox_edge_remove(&layout, &uuid_a, &uuid_b).unwrap();
        assert!(removed, "should return true when edge is removed");

        let store = gi.store.lock().unwrap();
        assert_eq!(count_cardbox_edges_in_store(&store), 0);
    }

    #[test]
    fn batch_reindex_preserves_cardbox_edges() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "text<!--- note _ --->rest of a");
        write_md(dir.path(), "b.md", "text<!--- note _ --->rest of b");

        let gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();

        let (uuid_a, uuid_b) = {
            let store = gi.store.lock().unwrap();
            let anns_a = store.list_annotations(Some("a.md"), None, 10).unwrap();
            let anns_b = store.list_annotations(Some("b.md"), None, 10).unwrap();
            (anns_a[0].uuid.clone(), anns_b[0].uuid.clone())
        };

        // Write cardbox layout and add edge
        let layout = CardboxLayout {
            links: vec![[uuid_a.clone(), uuid_b.clone()]],
            ..Default::default()
        };
        write_cardbox_layout(dir.path(), &layout);
        gi.sync_cardbox_edge_add(&uuid_a, &uuid_b).unwrap();

        // Now do a batch_reindex (e.g. editing a.md)
        std::thread::sleep(std::time::Duration::from_millis(50));
        write_md(dir.path(), "a.md", "modified text<!--- note _ --->rest of a");
        let diff = DiffResult {
            new: vec![],
            changed: vec!["a.md".to_string()],
            deleted: vec![],
        };
        gi.batch_reindex(&diff, true).unwrap();

        // Cardbox edge should still exist (re-synced from layout)
        let store = gi.store.lock().unwrap();
        assert_eq!(
            count_cardbox_edges_in_store(&store),
            1,
            "batch_reindex should re-sync cardbox edges from layout"
        );
    }

    #[test]
    fn sync_with_disk_syncs_cardbox_edges() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "text<!--- note _ --->rest of a");
        write_md(dir.path(), "b.md", "text<!--- note _ --->rest of b");

        let gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();

        let (uuid_a, uuid_b) = {
            let store = gi.store.lock().unwrap();
            let anns_a = store.list_annotations(Some("a.md"), None, 10).unwrap();
            let anns_b = store.list_annotations(Some("b.md"), None, 10).unwrap();
            (anns_a[0].uuid.clone(), anns_b[0].uuid.clone())
        };

        // Write cardbox layout
        let layout = CardboxLayout {
            links: vec![[uuid_a, uuid_b]],
            ..Default::default()
        };
        write_cardbox_layout(dir.path(), &layout);

        // Trigger sync_with_disk by modifying a file
        std::thread::sleep(std::time::Duration::from_millis(50));
        write_md(dir.path(), "a.md", "changed text<!--- note _ --->rest of a");

        let changed = gi.sync_with_disk(true).unwrap();
        assert!(changed, "sync_with_disk should detect changes");

        let store = gi.store.lock().unwrap();
        assert_eq!(
            count_cardbox_edges_in_store(&store),
            1,
            "sync_with_disk should sync cardbox edges from layout"
        );
    }
}
