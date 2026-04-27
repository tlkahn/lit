use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::time::UNIX_EPOCH;

use tracing::info;
use walkdir::WalkDir;

use super::error::GraphError;
use super::extract::{extract_first_paragraph, extract_headings, extract_sentence_context};
use super::types::HeadingInfo;
use super::knowledge::{GraphNode, KnowledgeGraph, SubgraphResult};
use super::links::{extract_wikilinks, WikiLink};
use super::resolve::StemLookup;
use super::store::Store;
use super::types::{extract_aliases, extract_tags, BacklinkEntry, LinkEntry, ParsedNode, SearchResult, Stats, UnlinkedMention};
use crate::workspace::frontmatter::parse_frontmatter;
use crate::workspace::normalize::filename_to_page_name;

// ---------------------------------------------------------------------------
// parse_md_file
// ---------------------------------------------------------------------------

pub fn parse_md_file(
    root: &Path,
    relative_path: &str,
) -> Result<(ParsedNode, Vec<WikiLink>), GraphError> {
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
        .map(String::from)
        .unwrap_or_else(|| title_from_relative_path(relative_path));

    let tags = extract_tags(&fm_json);
    let first_paragraph = extract_first_paragraph(parsed.body);
    let links = extract_wikilinks(parsed.body);

    let node = ParsedNode {
        id: relative_path.to_string(),
        title,
        tags,
        frontmatter: fm_json,
        first_paragraph,
    };

    Ok((node, links))
}

fn title_from_relative_path(relative_path: &str) -> String {
    let basename = relative_path.rsplit('/').next().unwrap_or(relative_path);
    filename_to_page_name(basename)
}

fn yaml_map_to_json(map: &HashMap<String, serde_yaml::Value>) -> serde_json::Value {
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

fn normalize_stem(target: &str) -> String {
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
}

pub fn index_workspace(
    store: &Store,
    root: &Path,
) -> Result<(IndexResult, ReverseStemIndex), GraphError> {
    index_workspace_with_progress(store, root, &super::progress::noop_callback())
}

pub fn index_workspace_with_progress(
    store: &Store,
    root: &Path,
    on_progress: &dyn Fn(super::progress::IndexProgress),
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

    for (i, (rel_path, mtime)) in files.iter().enumerate() {
        match parse_md_file(root, rel_path) {
            Ok((node, links)) => {
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
    let mut reverse_stems = ReverseStemIndex::new();
    let mut known_stubs: HashSet<String> = HashSet::new();
    let node_count = all_nodes.len();

    for (i, node) in all_nodes.iter().enumerate() {
        let mtime = file_mtimes.get(&node.id).copied().unwrap_or(0);
        store.upsert_node(node, mtime)?;
        nodes_indexed += 1;

        store.delete_edges_from(&node.id)?;

        if let Some(links) = all_links.get(&node.id) {
            for link in links {
                let resolved = stem_lookup.resolve(&link.target);
                let raw = std::fs::read_to_string(root.join(&node.id)).unwrap_or_default();
                let parsed_fm = parse_frontmatter(&raw);
                let (context, source_line) = extract_sentence_context(
                    parsed_fm.body,
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
                store.insert_edge(&node.id, &target_id, &context, &link.target, source_line)?;
                reverse_stems.add(&node.id, &link.target);
                edges_resolved += 1;
            }
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

impl DiffResult {
    pub fn is_empty(&self) -> bool {
        self.new.is_empty() && self.changed.is_empty() && self.deleted.is_empty()
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
) -> Result<IndexResult, GraphError> {
    store.begin_transaction()?;

    let mut nodes_indexed = 0;
    let mut edges_resolved = 0;
    let mut stubs_created = 0;

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

    for path in diff.new.iter().chain(diff.changed.iter()) {
        match parse_md_file(root, path) {
            Ok((node, links)) => {
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
                nodes_indexed += 1;

                // Re-resolve outgoing links
                store.delete_edges_from(&node.id)?;
                reverse_stems.remove_source(&node.id);

                let all_ids = store.all_node_ids()?;
                let aliases = store.all_aliases()?;
                let stem_lookup = StemLookup::build(&all_ids, &aliases);

                let raw_content = std::fs::read_to_string(root.join(path)).unwrap_or_default();
                let parsed_fm = parse_frontmatter(&raw_content);
                for link in &links {
                    let resolved = stem_lookup.resolve(&link.target);
                    let (context, source_line) = extract_sentence_context(parsed_fm.body, &link.target);
                    let target_id = match &resolved.node_id {
                        Some(id) => id.clone(),
                        None => {
                            store.upsert_stub(&link.target)?;
                            stubs_created += 1;
                            link.target.clone()
                        }
                    };
                    store.insert_edge(&node.id, &target_id, &context, &link.target, source_line)?;
                    reverse_stems.add(&node.id, &link.target);
                    edges_resolved += 1;
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
            .filter(|(_, is_stub)| !is_stub)
            .map(|(id, _)| id.clone())
            .collect();
        let real_stems: HashMap<String, String> = real_ids
            .iter()
            .map(|id| (normalize_stem(id), id.clone()))
            .collect();
        for (id, is_stub) in &all_meta {
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
        let all_ids = store.all_node_ids()?;
        let aliases = store.all_aliases()?;
        let stem_lookup = StemLookup::build(&all_ids, &aliases);

        for source_id in &affected {
            if diff.new.contains(source_id)
                || diff.changed.contains(source_id)
                || diff.deleted.contains(source_id)
            {
                continue; // already handled
            }

            if let Ok((_, links)) = parse_md_file(root, source_id) {
                store.delete_edges_from(source_id)?;
                reverse_stems.remove_source(source_id);

                let raw_content = std::fs::read_to_string(root.join(source_id)).unwrap_or_default();
                let parsed_fm = parse_frontmatter(&raw_content);
                for link in &links {
                    let resolved = stem_lookup.resolve(&link.target);
                    let (context, source_line) = extract_sentence_context(parsed_fm.body, &link.target);
                    let target_id = match &resolved.node_id {
                        Some(id) => id.clone(),
                        None => {
                            store.upsert_stub(&link.target)?;
                            stubs_created += 1;
                            link.target.clone()
                        }
                    };
                    store.insert_edge(source_id, &target_id, &context, &link.target, source_line)?;
                    reverse_stems.add(source_id, &link.target);
                    edges_resolved += 1;
                }
            }
        }
    }

    store.commit()?;

    Ok(IndexResult {
        nodes_indexed,
        edges_resolved,
        stubs_created,
    })
}

// ---------------------------------------------------------------------------
// GraphIndex
// ---------------------------------------------------------------------------

use std::sync::Mutex;

pub struct GraphIndex {
    store: Mutex<Store>,
    reverse_stems: Mutex<ReverseStemIndex>,
    knowledge: Mutex<KnowledgeGraph>,
    workspace_root: std::path::PathBuf,
}

impl GraphIndex {
    pub fn build(workspace_root: std::path::PathBuf) -> Result<Self, GraphError> {
        Self::build_with_progress(workspace_root, &super::progress::noop_callback())
    }

    pub fn build_with_progress(
        workspace_root: std::path::PathBuf,
        on_progress: &dyn Fn(super::progress::IndexProgress),
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
                incremental_reindex(&store, &workspace_root, &mut reverse, &diff)?;
                reverse
            }
        } else {
            info!("cold start: no existing store data, full index");
            let (_, reverse_stems) = index_workspace_with_progress(&store, &workspace_root, on_progress)?;
            reverse_stems
        };

        on_progress(IndexProgress { phase: IndexPhase::Building, current: 0, total: 0 });
        let knowledge = KnowledgeGraph::from_store(&store)?;
        Ok(Self {
            store: Mutex::new(store),
            reverse_stems: Mutex::new(reverse_stems),
            knowledge: Mutex::new(knowledge),
            workspace_root,
        })
    }

    pub fn reindex_file(&self, relative_path: &str) -> Result<(), GraphError> {
        let diff = DiffResult {
            new: vec![],
            changed: vec![relative_path.to_string()],
            deleted: vec![],
        };
        let store = self.store.lock().unwrap();
        let mut reverse = self.reverse_stems.lock().unwrap();
        incremental_reindex(&store, &self.workspace_root, &mut reverse, &diff)?;
        let mut knowledge = self.knowledge.lock().unwrap();
        *knowledge = KnowledgeGraph::from_store(&store)?;
        Ok(())
    }

    pub fn remove_file(&self, relative_path: &str) -> Result<(), GraphError> {
        let diff = DiffResult {
            new: vec![],
            changed: vec![],
            deleted: vec![relative_path.to_string()],
        };
        let store = self.store.lock().unwrap();
        let mut reverse = self.reverse_stems.lock().unwrap();
        incremental_reindex(&store, &self.workspace_root, &mut reverse, &diff)?;
        let mut knowledge = self.knowledge.lock().unwrap();
        *knowledge = KnowledgeGraph::from_store(&store)?;
        Ok(())
    }

    pub fn full_rebuild(&self) -> Result<IndexResult, GraphError> {
        let store = self.store.lock().unwrap();
        let (result, new_reverse) = index_workspace(&store, &self.workspace_root)?;
        let mut reverse = self.reverse_stems.lock().unwrap();
        *reverse = new_reverse;
        let mut knowledge = self.knowledge.lock().unwrap();
        *knowledge = KnowledgeGraph::from_store(&store)?;
        Ok(result)
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
    ) -> Result<SubgraphResult, GraphError> {
        let knowledge = self.knowledge.lock().unwrap();
        knowledge.subgraph(seeds, depth, directed)
    }

    pub fn full_subgraph(&self) -> SubgraphResult {
        let knowledge = self.knowledge.lock().unwrap();
        knowledge.full_subgraph()
    }

    pub fn resolve_wikilink(&self, target: &str) -> Result<super::resolve::ResolvedLink, GraphError> {
        let store = self.store.lock().unwrap();
        let all_ids = store.all_node_ids()?;
        let aliases = store.all_aliases()?;
        let lookup = StemLookup::build(&all_ids, &aliases);
        Ok(lookup.resolve(target))
    }

    pub fn page_headings(&self, target: &str) -> Result<Vec<HeadingInfo>, GraphError> {
        let resolved = self.resolve_wikilink(target)?;
        let node_id = resolved.node_id.ok_or_else(|| GraphError::NodeNotFound {
            id: target.to_string(),
        })?;
        let page = crate::workspace::ops::read_page(&self.workspace_root, &node_id)
            .map_err(|e| GraphError::Other(e.to_string()))?;
        Ok(extract_headings(&page.body))
    }

    pub fn backlinks(&self, page_id: &str) -> Result<Vec<BacklinkEntry>, GraphError> {
        let store = self.store.lock().unwrap();
        store.backlinks(page_id)
    }

    pub fn forward_links(&self, page_id: &str) -> Result<Vec<LinkEntry>, GraphError> {
        let store = self.store.lock().unwrap();
        store.forward_links(page_id)
    }

    pub fn unlinked_mentions(&self, page_id: &str) -> Result<Vec<UnlinkedMention>, GraphError> {
        use grep_regex::RegexMatcherBuilder;
        use rayon::prelude::*;
        use super::extract::{extract_mention_context, find_plain_mentions, strip_for_mention_scan};

        let store = self.store.lock().unwrap();
        let (title, aliases) = store.title_and_aliases(page_id)?;
        let already_linked = store.backlink_source_ids(page_id)?;
        let all_paths = store.all_synced_paths()?;
        let titles = store.node_titles()?;
        drop(store);

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
                let page = match crate::workspace::ops::read_page(&self.workspace_root, source_id) {
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
                let (count, excerpt) =
                    search_file_with_matcher(&self.workspace_root.join(id), &matcher, &terms)?;
                let title = titles.get(id).cloned().unwrap_or_default();
                Some(SearchResult {
                    id: id.clone(),
                    title,
                    score: -(count as f64),
                    excerpt,
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

        if cached_fp.as_deref() == Some(fingerprint.as_str()) {
            if let Some(json) = store.get_meta("pagerank_scores")? {
                if let Ok(scores) = serde_json::from_str::<HashMap<String, f64>>(&json) {
                    return Ok(scores);
                }
            }
        }

        let knowledge = self.knowledge.lock().unwrap();
        let scores = knowledge.pagerank(0.85);
        let json = serde_json::to_string(&scores).map_err(|e| GraphError::Other(e.to_string()))?;
        store.set_meta("pagerank_scores", &json)?;
        store.set_meta("pagerank_fingerprint", &fingerprint)?;
        Ok(scores)
    }

    pub fn top_by_pagerank(&self, n: usize) -> Result<Vec<(String, f64)>, GraphError> {
        let scores = self.pagerank()?;
        let mut pairs: Vec<(String, f64)> = scores.into_iter().collect();
        pairs.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
        pairs.truncate(n);
        Ok(pairs)
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
) -> Option<(usize, String)> {
    use grep_searcher::sinks::UTF8;
    use grep_searcher::Searcher;

    if terms.is_empty() {
        return None;
    }

    let mut match_count: usize = 0;
    let mut first_line: Option<String> = None;
    let mut seen_terms: HashSet<usize> = HashSet::new();

    let result = Searcher::new().search_path(
        matcher,
        path,
        UTF8(|_line_number, line| {
            match_count += 1;
            if first_line.is_none() {
                first_line = Some(line.trim().to_string());
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
            Some((match_count, first_line.unwrap_or_default()))
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

    search_file_with_matcher(path, &matcher, terms)
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

    // --- parse_md_file ---

    #[test]
    fn parse_md_file_basic() {
        let dir = create_workspace();
        write_md(
            dir.path(),
            "note.md",
            "---\ntitle: My Note\ntags:\n  - rust\n---\nFirst paragraph.\n\n[[Link]]",
        );
        let (node, links) = parse_md_file(dir.path(), "note.md").unwrap();
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
        let (node, links) = parse_md_file(dir.path(), "plain.md").unwrap();
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
        let (node, _) = parse_md_file(dir.path(), "tagged.md").unwrap();
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
        let (node, _) = parse_md_file(dir.path(), "note.md").unwrap();
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
        let (node, _) = parse_md_file(dir.path(), "sub/deep.md").unwrap();
        assert_eq!(node.id, "sub/deep.md");
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
        let (result, _) = index_workspace(&store, dir.path()).unwrap();
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
        let (result, _) = index_workspace(&store, dir.path()).unwrap();
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
        let (result, _) = index_workspace(&store, dir.path()).unwrap();
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
        let (result, _) = index_workspace(&store, dir.path()).unwrap();
        assert_eq!(result.stubs_created, 1);
        let meta = store.all_nodes_metadata().unwrap();
        assert!(meta.iter().any(|(id, is_stub)| id == "Ghost" && *is_stub));
    }

    #[test]
    fn index_workspace_raw_target_persisted() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "See [[My Note]].");
        write_md(dir.path(), "My Note.md", "Target.");
        let store = Store::open_memory().unwrap();
        index_workspace(&store, dir.path()).unwrap();
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
        index_workspace(&store, dir.path()).unwrap();
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
        let (_, reverse) = index_workspace(&store, dir.path()).unwrap();
        let entries = reverse.lookup("b");
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].0, "a.md");
    }

    #[test]
    fn index_workspace_records_sync_mtimes() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "Content.");
        let store = Store::open_memory().unwrap();
        index_workspace(&store, dir.path()).unwrap();
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
        let (result, _) = index_workspace(&store, dir.path()).unwrap();
        assert_eq!(result.nodes_indexed, 1);
    }

    #[test]
    fn index_workspace_idempotent() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "[[B]]");
        write_md(dir.path(), "b.md", "Target.");
        let store = Store::open_memory().unwrap();
        let (r1, _) = index_workspace(&store, dir.path()).unwrap();
        let (r2, _) = index_workspace(&store, dir.path()).unwrap();
        assert_eq!(r1.nodes_indexed, r2.nodes_indexed);
        assert_eq!(store.stats().unwrap().nodes, 2);
    }

    #[test]
    fn index_workspace_creates_lit_dir() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "Content.");
        let store = Store::open_memory().unwrap();
        index_workspace(&store, dir.path()).unwrap();
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

        let (result, _) = index_workspace_with_progress(&store, dir.path(), &callback).unwrap();
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

        index_workspace_with_progress(&store, dir.path(), &callback).unwrap();

        let phases = log.lock().unwrap();
        assert_eq!(*phases, vec![IndexPhase::Scanning, IndexPhase::Parsing, IndexPhase::Resolving]);
    }

    #[test]
    fn index_workspace_delegation_preserves_behavior() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "[[b]]");
        write_md(dir.path(), "b.md", "Target.");
        let store = Store::open_memory().unwrap();
        let (result, _) = index_workspace(&store, dir.path()).unwrap();
        assert_eq!(result.nodes_indexed, 2);
        assert_eq!(result.edges_resolved, 1);
    }

    // --- compute_diff ---

    #[test]
    fn compute_diff_no_changes() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "Content.");
        let store = Store::open_memory().unwrap();
        index_workspace(&store, dir.path()).unwrap();
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
        index_workspace(&store, dir.path()).unwrap();
        write_md(dir.path(), "b.md", "New file.");
        let diff = compute_diff(&store, dir.path()).unwrap();
        assert_eq!(diff.new, vec!["b.md"]);
    }

    #[test]
    fn compute_diff_modified_file() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "Content.");
        let store = Store::open_memory().unwrap();
        index_workspace(&store, dir.path()).unwrap();
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
        index_workspace(&store, dir.path()).unwrap();
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
        index_workspace(&store, dir.path()).unwrap();
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

    // --- incremental_reindex ---

    #[test]
    fn incremental_body_edit_updates_paragraph() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "Old paragraph.");
        let store = Store::open_memory().unwrap();
        let (_, mut reverse) = index_workspace(&store, dir.path()).unwrap();
        write_md(dir.path(), "a.md", "New paragraph.");
        let diff = DiffResult {
            new: vec![],
            changed: vec!["a.md".to_string()],
            deleted: vec![],
        };
        incremental_reindex(&store, dir.path(), &mut reverse, &diff).unwrap();
        let titles = store.node_titles().unwrap();
        assert_eq!(titles.len(), 1);
    }

    #[test]
    fn incremental_body_edit_updates_edges() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "[[OldLink]]");
        write_md(dir.path(), "b.md", "Target.");
        let store = Store::open_memory().unwrap();
        let (_, mut reverse) = index_workspace(&store, dir.path()).unwrap();
        write_md(dir.path(), "a.md", "[[b]]");
        let diff = DiffResult {
            new: vec![],
            changed: vec!["a.md".to_string()],
            deleted: vec![],
        };
        incremental_reindex(&store, dir.path(), &mut reverse, &diff).unwrap();
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
        let (_, mut reverse) = index_workspace(&store, dir.path()).unwrap();
        write_md(dir.path(), "a.md", "Alpha updated.");
        let diff = DiffResult {
            new: vec![],
            changed: vec!["a.md".to_string()],
            deleted: vec![],
        };
        incremental_reindex(&store, dir.path(), &mut reverse, &diff).unwrap();
        assert_eq!(store.stats().unwrap().nodes, 2);
    }

    #[test]
    fn incremental_new_file_resolves_dangling() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "Links to [[B]].");
        let store = Store::open_memory().unwrap();
        let (_, mut reverse) = index_workspace(&store, dir.path()).unwrap();
        // B was unresolved (stub). Now create it.
        write_md(dir.path(), "b.md", "I exist now.");
        let diff = DiffResult {
            new: vec!["b.md".to_string()],
            changed: vec![],
            deleted: vec![],
        };
        incremental_reindex(&store, dir.path(), &mut reverse, &diff).unwrap();
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
        let (_, mut reverse) = index_workspace(&store, dir.path()).unwrap();
        fs::remove_file(dir.path().join("b.md")).unwrap();
        let diff = DiffResult {
            new: vec![],
            changed: vec![],
            deleted: vec!["b.md".to_string()],
        };
        incremental_reindex(&store, dir.path(), &mut reverse, &diff).unwrap();
        let ids = store.all_node_ids().unwrap();
        assert!(!ids.contains(&"b.md".to_string()));
    }

    // --- GraphIndex ---

    #[test]
    fn graph_index_build_indexes_workspace() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "Hello.");
        write_md(dir.path(), "b.md", "World.");
        let gi = GraphIndex::build(dir.path().to_path_buf()).unwrap();
        let stats = gi.stats().unwrap();
        assert_eq!(stats.nodes, 2);
    }

    #[test]
    fn build_warm_start_no_diff() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "Hello.");
        write_md(dir.path(), "b.md", "Links to [[a]].");

        // Cold start — builds .lit/graph.db
        let gi1 = GraphIndex::build(dir.path().to_path_buf()).unwrap();
        let stats1 = gi1.stats().unwrap();
        assert_eq!(stats1.nodes, 2);
        assert_eq!(stats1.edges, 1);
        drop(gi1);

        // Warm start — same files, no changes
        let gi2 = GraphIndex::build(dir.path().to_path_buf()).unwrap();
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
        let gi1 = GraphIndex::build(dir.path().to_path_buf()).unwrap();
        assert_eq!(gi1.stats().unwrap().nodes, 2);
        drop(gi1);

        // Modify a file and add a new one
        std::thread::sleep(std::time::Duration::from_millis(50));
        write_md(dir.path(), "b.md", "Now links to [[c]].");
        write_md(dir.path(), "c.md", "New page.");

        // Warm start — should apply diff
        let gi2 = GraphIndex::build(dir.path().to_path_buf()).unwrap();
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
        let gi1 = GraphIndex::build(dir.path().to_path_buf()).unwrap();
        assert_eq!(gi1.stats().unwrap().nodes, 2);
        drop(gi1);

        // Delete a file
        fs::remove_file(dir.path().join("b.md")).unwrap();

        // Warm start — should detect deletion
        let gi2 = GraphIndex::build(dir.path().to_path_buf()).unwrap();
        let stats2 = gi2.stats().unwrap();
        assert_eq!(stats2.nodes, 1, "deleted file should be removed");
    }

    #[test]
    fn build_corrupt_store_falls_back_to_cold_start() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "Hello.");

        // Cold start — creates graph.db
        let gi1 = GraphIndex::build(dir.path().to_path_buf()).unwrap();
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
        let gi2 = GraphIndex::build(dir.path().to_path_buf()).unwrap();
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

        let gi = GraphIndex::build_with_progress(dir.path().to_path_buf(), &callback).unwrap();
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

        GraphIndex::build(dir.path().to_path_buf()).unwrap();

        let log: Arc<Mutex<Vec<IndexPhase>>> = Arc::new(Mutex::new(Vec::new()));
        let log_clone = Arc::clone(&log);
        let callback = move |p: IndexProgress| {
            let mut l = log_clone.lock().unwrap();
            if l.last() != Some(&p.phase) {
                l.push(p.phase);
            }
        };

        let gi = GraphIndex::build_with_progress(dir.path().to_path_buf(), &callback).unwrap();
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

        GraphIndex::build(dir.path().to_path_buf()).unwrap();

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

        let gi = GraphIndex::build_with_progress(dir.path().to_path_buf(), &callback).unwrap();
        assert_eq!(gi.stats().unwrap().nodes, 1);

        let phases = log.lock().unwrap();
        assert_eq!(*phases, vec![IndexPhase::Diffing, IndexPhase::Building]);
    }

    #[test]
    fn build_delegation_preserves_existing_behavior() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "[[b]]");
        write_md(dir.path(), "b.md", "Target.");
        let gi = GraphIndex::build(dir.path().to_path_buf()).unwrap();
        let stats = gi.stats().unwrap();
        assert_eq!(stats.nodes, 2);
        assert_eq!(stats.edges, 1);
    }

    #[test]
    fn graph_index_reindex_file() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "[[B]]");
        write_md(dir.path(), "b.md", "Target.");
        let gi = GraphIndex::build(dir.path().to_path_buf()).unwrap();
        write_md(dir.path(), "a.md", "No links now.");
        gi.reindex_file("a.md").unwrap();
        let stats = gi.stats().unwrap();
        assert_eq!(stats.edges, 0);
    }

    #[test]
    fn graph_index_remove_file() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "Hello.");
        write_md(dir.path(), "b.md", "World.");
        let gi = GraphIndex::build(dir.path().to_path_buf()).unwrap();
        fs::remove_file(dir.path().join("b.md")).unwrap();
        gi.remove_file("b.md").unwrap();
        let stats = gi.stats().unwrap();
        assert_eq!(stats.nodes, 1);
    }

    #[test]
    fn graph_index_full_rebuild() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "Hello.");
        let gi = GraphIndex::build(dir.path().to_path_buf()).unwrap();
        write_md(dir.path(), "b.md", "New file.");
        let result = gi.full_rebuild().unwrap();
        assert_eq!(result.nodes_indexed, 2);
    }

    #[test]
    fn graph_index_stats() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "[[B]]");
        write_md(dir.path(), "b.md", "Target.");
        let gi = GraphIndex::build(dir.path().to_path_buf()).unwrap();
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
        let gi = GraphIndex::build(dir.path().to_path_buf()).unwrap();
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
        let gi = GraphIndex::build(dir.path().to_path_buf()).unwrap();
        let sub = gi.full_subgraph();
        assert_eq!(sub.nodes.len(), 1);

        write_md(dir.path(), "b.md", "New.");
        gi.full_rebuild().unwrap();
        let sub = gi.full_subgraph();
        assert_eq!(sub.nodes.len(), 2);
    }

    #[test]
    fn graph_index_knowledge_rebuilt_after_reindex_file() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "No links.");
        write_md(dir.path(), "b.md", "Target.");
        let gi = GraphIndex::build(dir.path().to_path_buf()).unwrap();
        let sub = gi.full_subgraph();
        assert!(sub.edges.is_empty());

        write_md(dir.path(), "a.md", "Now links to [[b]].");
        gi.reindex_file("a.md").unwrap();
        let sub = gi.full_subgraph();
        assert!(!sub.edges.is_empty());
    }

    // --- GraphIndex backlinks/forward_links/search ---

    #[test]
    fn graph_index_backlinks() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "Links to [[b]].");
        write_md(dir.path(), "b.md", "Target.");
        let gi = GraphIndex::build(dir.path().to_path_buf()).unwrap();
        let bl = gi.backlinks("b.md").unwrap();
        assert_eq!(bl.len(), 1);
        assert_eq!(bl[0].source_id, "a.md");
    }

    #[test]
    fn graph_index_backlinks_empty() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "No outgoing links.");
        let gi = GraphIndex::build(dir.path().to_path_buf()).unwrap();
        let bl = gi.backlinks("a.md").unwrap();
        assert!(bl.is_empty());
    }

    #[test]
    fn graph_index_forward_links() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "Links to [[b]].");
        write_md(dir.path(), "b.md", "Target.");
        let gi = GraphIndex::build(dir.path().to_path_buf()).unwrap();
        let fl = gi.forward_links("a.md").unwrap();
        assert_eq!(fl.len(), 1);
        assert_eq!(fl[0].target_id, "b.md");
    }

    #[test]
    fn graph_index_forward_links_empty() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "No links.");
        let gi = GraphIndex::build(dir.path().to_path_buf()).unwrap();
        let fl = gi.forward_links("a.md").unwrap();
        assert!(fl.is_empty());
    }

    #[test]
    fn graph_index_search() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "---\ntitle: Quantum Computing\n---\nBody.");
        let gi = GraphIndex::build(dir.path().to_path_buf()).unwrap();
        let results = gi.search("Quantum", 20).unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].id, "a.md");
    }

    #[test]
    fn graph_index_search_empty() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "Content.");
        let gi = GraphIndex::build(dir.path().to_path_buf()).unwrap();
        let results = gi.search("zzzznonexistent", 20).unwrap();
        assert!(results.is_empty());
    }

    // --- PageRank on GraphIndex ---

    #[test]
    fn pagerank_returns_scores_for_all_nodes() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "[[b]]");
        write_md(dir.path(), "b.md", "Target.");
        let gi = GraphIndex::build(dir.path().to_path_buf()).unwrap();
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
        let gi = GraphIndex::build(dir.path().to_path_buf()).unwrap();
        let scores = gi.pagerank().unwrap();
        let sum: f64 = scores.values().sum();
        assert!((sum - 1.0).abs() < 1e-9, "sum was {sum}");
    }

    #[test]
    fn pagerank_caches_in_meta_table() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "[[b]]");
        write_md(dir.path(), "b.md", "Target.");
        let gi = GraphIndex::build(dir.path().to_path_buf()).unwrap();
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
        let gi = GraphIndex::build(dir.path().to_path_buf()).unwrap();
        let scores1 = gi.pagerank().unwrap();
        let scores2 = gi.pagerank().unwrap();
        assert_eq!(scores1, scores2);
    }

    #[test]
    fn pagerank_invalidated_after_reindex() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "[[b]]");
        write_md(dir.path(), "b.md", "[[a]]");
        let gi = GraphIndex::build(dir.path().to_path_buf()).unwrap();
        let scores1 = gi.pagerank().unwrap();
        write_md(dir.path(), "a.md", "No links now.");
        gi.reindex_file("a.md").unwrap();
        let scores2 = gi.pagerank().unwrap();
        assert_ne!(scores1, scores2);
    }

    #[test]
    fn pagerank_invalidated_after_remove() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "Hello.");
        write_md(dir.path(), "b.md", "World.");
        let gi = GraphIndex::build(dir.path().to_path_buf()).unwrap();
        let scores1 = gi.pagerank().unwrap();
        assert_eq!(scores1.len(), 2);
        fs::remove_file(dir.path().join("b.md")).unwrap();
        gi.remove_file("b.md").unwrap();
        let scores2 = gi.pagerank().unwrap();
        assert_eq!(scores2.len(), 1);
    }

    #[test]
    fn pagerank_invalidated_after_rebuild() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "Hello.");
        let gi = GraphIndex::build(dir.path().to_path_buf()).unwrap();
        let scores1 = gi.pagerank().unwrap();
        assert_eq!(scores1.len(), 1);
        write_md(dir.path(), "b.md", "New file.");
        gi.full_rebuild().unwrap();
        let scores2 = gi.pagerank().unwrap();
        assert_eq!(scores2.len(), 2);
    }

    #[test]
    fn top_by_pagerank_sorted_desc() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "[[b]] [[c]]");
        write_md(dir.path(), "b.md", "[[c]]");
        write_md(dir.path(), "c.md", "Leaf.");
        let gi = GraphIndex::build(dir.path().to_path_buf()).unwrap();
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
        let gi = GraphIndex::build(dir.path().to_path_buf()).unwrap();
        let top = gi.top_by_pagerank(2).unwrap();
        assert_eq!(top.len(), 2);
    }

    // --- GraphIndex resolve_wikilink ---

    #[test]
    fn resolve_wikilink_existing_page() {
        let dir = create_workspace();
        write_md(dir.path(), "People/Alice.md", "Hello.");
        let gi = GraphIndex::build(dir.path().to_path_buf()).unwrap();
        let r = gi.resolve_wikilink("Alice").unwrap();
        assert_eq!(r.node_id, Some("People/Alice.md".to_string()));
    }

    #[test]
    fn resolve_wikilink_unresolved_page() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "Hello.");
        let gi = GraphIndex::build(dir.path().to_path_buf()).unwrap();
        let r = gi.resolve_wikilink("NonExistent").unwrap();
        assert_eq!(r.node_id, None);
        assert_eq!(r.tier, super::super::resolve::ResolutionTier::Unresolved);
    }

    #[test]
    fn resolve_wikilink_exact_path() {
        let dir = create_workspace();
        write_md(dir.path(), "Notes/Topic.md", "Content.");
        let gi = GraphIndex::build(dir.path().to_path_buf()).unwrap();
        let r = gi.resolve_wikilink("Notes/Topic.md").unwrap();
        assert_eq!(r.tier, super::super::resolve::ResolutionTier::ExactPath);
        assert_eq!(r.node_id, Some("Notes/Topic.md".to_string()));
    }

    #[test]
    fn resolve_wikilink_ambiguous() {
        let dir = create_workspace();
        write_md(dir.path(), "a/Note.md", "Alpha.");
        write_md(dir.path(), "b/Note.md", "Beta.");
        let gi = GraphIndex::build(dir.path().to_path_buf()).unwrap();
        let r = gi.resolve_wikilink("Note").unwrap();
        assert_eq!(r.tier, super::super::resolve::ResolutionTier::Ambiguous);
        assert_eq!(r.node_id, Some("a/Note.md".to_string()));
    }

    // --- GraphIndex page_headings ---

    #[test]
    fn page_headings_returns_headings() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "# Intro\n\n## Details");
        let gi = GraphIndex::build(dir.path().to_path_buf()).unwrap();
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
        let gi = GraphIndex::build(dir.path().to_path_buf()).unwrap();
        let headings = gi.page_headings("a").unwrap();
        assert!(headings.is_empty());
    }

    #[test]
    fn page_headings_resolves_by_stem() {
        let dir = create_workspace();
        write_md(dir.path(), "notes/Topic.md", "# First\n## Second");
        let gi = GraphIndex::build(dir.path().to_path_buf()).unwrap();
        let headings = gi.page_headings("Topic").unwrap();
        assert_eq!(headings.len(), 2);
    }

    #[test]
    fn page_headings_unresolved_errors() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "Content.");
        let gi = GraphIndex::build(dir.path().to_path_buf()).unwrap();
        let result = gi.page_headings("NonExistent");
        assert!(result.is_err());
    }

    #[test]
    fn top_by_pagerank_n_exceeds_graph() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "Hello.");
        write_md(dir.path(), "b.md", "World.");
        let gi = GraphIndex::build(dir.path().to_path_buf()).unwrap();
        let top = gi.top_by_pagerank(100).unwrap();
        assert_eq!(top.len(), 2);
    }

    // --- GraphIndex unlinked_mentions ---

    #[test]
    fn unlinked_mentions_no_mentions() {
        let dir = create_workspace();
        write_md(dir.path(), "target.md", "---\ntitle: Alice\n---\nI am Alice.");
        write_md(dir.path(), "other.md", "No mention of the name here.");
        let gi = GraphIndex::build(dir.path().to_path_buf()).unwrap();
        let mentions = gi.unlinked_mentions("target.md").unwrap();
        assert!(mentions.is_empty());
    }

    #[test]
    fn unlinked_mentions_finds_plain_text() {
        let dir = create_workspace();
        write_md(dir.path(), "target.md", "---\ntitle: Alice\n---\nI am Alice.");
        write_md(dir.path(), "other.md", "I met Alice yesterday.");
        let gi = GraphIndex::build(dir.path().to_path_buf()).unwrap();
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
        let gi = GraphIndex::build(dir.path().to_path_buf()).unwrap();
        let mentions = gi.unlinked_mentions("target.md").unwrap();
        assert_eq!(mentions.len(), 1);
        assert_eq!(mentions[0].source_id, "unlinked.md");
    }

    #[test]
    fn unlinked_mentions_excludes_code_and_wikilinks() {
        let dir = create_workspace();
        write_md(dir.path(), "target.md", "---\ntitle: Alice\n---\nI am Alice.");
        write_md(dir.path(), "other.md", "`Alice` and [[Bob]] and Alice plain.");
        let gi = GraphIndex::build(dir.path().to_path_buf()).unwrap();
        let mentions = gi.unlinked_mentions("target.md").unwrap();
        assert_eq!(mentions.len(), 1);
        assert_eq!(mentions[0].matched_text, "Alice");
    }

    #[test]
    fn unlinked_mentions_matches_aliases() {
        let dir = create_workspace();
        write_md(dir.path(), "target.md", "---\ntitle: Alice\naliases:\n  - Ali\n---\nContent.");
        write_md(dir.path(), "other.md", "I met Ali today.");
        let gi = GraphIndex::build(dir.path().to_path_buf()).unwrap();
        let mentions = gi.unlinked_mentions("target.md").unwrap();
        assert_eq!(mentions.len(), 1);
        assert_eq!(mentions[0].matched_text, "Ali");
    }

    #[test]
    fn unlinked_mentions_skips_self() {
        let dir = create_workspace();
        write_md(dir.path(), "target.md", "---\ntitle: Alice\n---\nAlice talks about Alice.");
        let gi = GraphIndex::build(dir.path().to_path_buf()).unwrap();
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
        let gi = GraphIndex::build(dir.path().to_path_buf()).unwrap();
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
        let gi = GraphIndex::build(dir.path().to_path_buf()).unwrap();
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
        let (count, excerpt) = result.unwrap();
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
        let gi = GraphIndex::build(dir.path().to_path_buf()).unwrap();
        let results = gi.search("thermodynamics", 20).unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].id, "a.md");
    }

    #[test]
    fn search_ranks_by_match_count() {
        let dir = create_workspace();
        write_md(dir.path(), "many.md", "rust\nrust\nrust\nrust\nrust");
        write_md(dir.path(), "few.md", "rust once");
        let gi = GraphIndex::build(dir.path().to_path_buf()).unwrap();
        let results = gi.search("rust", 20).unwrap();
        assert!(results.len() >= 2);
        assert_eq!(results[0].id, "many.md", "file with more matches should rank first");
    }

    #[test]
    fn search_multi_term_and() {
        let dir = create_workspace();
        write_md(dir.path(), "both.md", "quantum computing is here");
        write_md(dir.path(), "one.md", "quantum mechanics only");
        let gi = GraphIndex::build(dir.path().to_path_buf()).unwrap();
        let results = gi.search("quantum computing", 20).unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].id, "both.md");
    }

    #[test]
    fn search_strips_trailing_star() {
        let dir = create_workspace();
        write_md(dir.path(), "alpha.md", "---\ntitle: Alpha\n---\nAlpha content.");
        let gi = GraphIndex::build(dir.path().to_path_buf()).unwrap();
        let results = gi.search("Alph*", 20).unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].id, "alpha.md");
    }

    #[test]
    fn search_empty_query() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "Content.");
        let gi = GraphIndex::build(dir.path().to_path_buf()).unwrap();
        let results = gi.search("", 20).unwrap();
        assert!(results.is_empty());
    }

    #[test]
    fn search_respects_limit() {
        let dir = create_workspace();
        for i in 0..5 {
            write_md(dir.path(), &format!("{i}.md"), "searchable content here");
        }
        let gi = GraphIndex::build(dir.path().to_path_buf()).unwrap();
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
        let gi = GraphIndex::build(dir.path().to_path_buf()).unwrap();
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
        let gi = GraphIndex::build(dir.path().to_path_buf()).unwrap();
        let results = gi.search_by_title("Quantum", 10).unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].id, "a.md");
        assert_eq!(results[0].title, "Quantum Computing");
    }

    #[test]
    fn search_by_title_matches_file_stem() {
        let dir = create_workspace();
        write_md(dir.path(), "quantum-notes.md", "---\ntitle: My Notes\n---\nBody.");
        let gi = GraphIndex::build(dir.path().to_path_buf()).unwrap();
        let results = gi.search_by_title("quantum", 10).unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].id, "quantum-notes.md");
    }

    #[test]
    fn search_by_title_matches_aliases() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "---\ntitle: Alice\naliases:\n  - Ali\n---\nBody.");
        let gi = GraphIndex::build(dir.path().to_path_buf()).unwrap();
        let results = gi.search_by_title("Ali", 10).unwrap();
        assert!(results.iter().any(|r| r.id == "a.md"));
    }

    #[test]
    fn search_by_title_returns_search_result_type() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "---\ntitle: Alpha\n---\nBody.");
        let gi = GraphIndex::build(dir.path().to_path_buf()).unwrap();
        let results = gi.search_by_title("Alpha", 10).unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].score, 0.0);
        assert_eq!(results[0].excerpt, "");
    }

    #[test]
    fn search_by_title_empty_query_returns_empty() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "---\ntitle: Alpha\n---\nBody.");
        let gi = GraphIndex::build(dir.path().to_path_buf()).unwrap();
        let results = gi.search_by_title("", 10).unwrap();
        assert!(results.is_empty());
    }

    #[test]
    fn search_case_insensitive() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "QUANTUM computing.");
        let gi = GraphIndex::build(dir.path().to_path_buf()).unwrap();
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
        let gi = GraphIndex::build(dir.path().to_path_buf()).unwrap();
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
        let gi = GraphIndex::build(dir.path().to_path_buf()).unwrap();
        let results = gi.search("parallelism", 100).unwrap();
        assert_eq!(results.len(), 10, "every 3rd of 30 files should match");
        for r in &results {
            assert!(r.score < 0.0, "score should be negative (negated count)");
        }
    }
}
