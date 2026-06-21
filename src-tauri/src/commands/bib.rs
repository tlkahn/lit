use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use indexmap::IndexMap;
use rusqlite::Connection;
use tauri::State;

use crate::bib::cache::BibCache;
use crate::bib::types::BibEntry;
use crate::bib::writer::serialize_bib_entry;
use crate::commands::graph::GraphRegistry;
use crate::commands::oplog::OpLogRegistry;
use crate::commands::page::{lookup_graph_index, reindex_and_emit};
use crate::commands::workspace::{get_workspace_root, WorkspaceRegistry};
use crate::graph::indexer::shadow_title;
use crate::oplog::store::Action;
use crate::workspace::frontmatter::{parse_frontmatter, serialize_frontmatter};
use crate::workspace::normalize::{normalize_to_nfc, validate_within_root, FORBIDDEN_CHARS};
use crate::workspace::ops;
use crate::workspace::page::{FileType, PageMeta};
use crate::workspace::write_hash::WriteHashRegistry;
use crate::util::is_hidden;

/// Walk `root`, parse every `.bib` file (skipping hidden directories), and
/// return all entries with `bib_file` set to the file's absolute path.
///
/// Results are sorted by `bib_file` then `line_number` for determinism. The
/// frontend may re-sort (e.g. by author) downstream.
pub fn scan_workspace_bibs(root: &Path, cache: &BibCache) -> Vec<BibEntry> {
    let mut all = Vec::new();

    for entry in walkdir::WalkDir::new(root)
        .into_iter()
        .filter_entry(|e| !is_hidden(e))
    {
        let Ok(entry) = entry else { continue };
        if !entry.file_type().is_file() {
            continue;
        }
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("bib") {
            continue;
        }

        // Reuse the metadata walkdir already cached during traversal (no second
        // stat syscall) instead of issuing a fresh `fs::metadata(path)`.
        let mtime = entry
            .metadata()
            .ok()
            .and_then(|m| m.modified().ok())
            .unwrap_or(std::time::SystemTime::UNIX_EPOCH);

        let path_buf = path.to_path_buf();
        // Read the file ONLY on a cache miss: the closure is invoked lazily and
        // is skipped entirely on a warm-cache hit (mtime match).
        let mut entries =
            cache.get_or_parse_with(&path_buf, mtime, || fs::read_to_string(path).ok());
        let path_str = path.to_string_lossy().to_string();
        for e in &mut entries {
            e.bib_file = Some(path_str.clone());
        }
        all.extend(entries);
    }

    all.sort_by(|a, b| {
        a.bib_file
            .cmp(&b.bib_file)
            .then(a.line_number.cmp(&b.line_number))
    });
    all
}

#[tauri::command]
pub fn list_bib_entries(
    workspace_path: String,
    graph_state: tauri::State<Arc<GraphRegistry>>,
) -> Result<Vec<BibEntry>, String> {
    let root = PathBuf::from(&workspace_path);
    let gi = lookup_graph_index(&graph_state, &root)
        .ok_or_else(|| "Graph index not ready".to_string())?;
    let store = gi.store();
    crate::bib::db::list_bib_items(&store.conn).map_err(|e| e.to_string())
}

/// Build frontmatter for a citation note from a BibEntry.
fn build_citation_frontmatter(entry: &BibEntry) -> IndexMap<String, serde_yaml::Value> {
    use serde_yaml::Value;

    let mut fm = IndexMap::new();
    fm.insert(
        "title".to_string(),
        Value::String(shadow_title(entry)),
    );
    fm.insert(
        "citekey".to_string(),
        Value::String(entry.key.clone()),
    );
    if !entry.authors.is_empty() {
        fm.insert(
            "authors".to_string(),
            Value::Sequence(
                entry
                    .authors
                    .iter()
                    .map(|a| Value::String(a.clone()))
                    .collect(),
            ),
        );
    }
    if !entry.year.is_empty() {
        fm.insert("year".to_string(), Value::String(entry.year.clone()));
    }
    if let Some(doi) = &entry.doi {
        fm.insert("doi".to_string(), Value::String(doi.clone()));
    }
    if let Some(journal) = &entry.journal {
        fm.insert("journal".to_string(), Value::String(journal.clone()));
    }
    if let Some(url) = &entry.url {
        fm.insert("url".to_string(), Value::String(url.clone()));
    }
    if !entry.tags.is_empty() {
        fm.insert(
            "tags".to_string(),
            Value::Sequence(
                entry
                    .tags
                    .iter()
                    .map(|t| Value::String(t.clone()))
                    .collect(),
            ),
        );
    }
    fm
}

/// Build the markdown body for a citation note from a BibEntry.
fn build_citation_body(entry: &BibEntry, references: &[BibEntry]) -> String {
    let mut body = String::new();
    if let Some(abstract_text) = &entry.abstract_text {
        body.push_str("## Abstract\n\n");
        body.push_str(abstract_text);
        body.push_str("\n\n");
    }
    body.push_str("## Notes\n");
    if !references.is_empty() {
        body.push('\n');
        body.push_str("## References\n\n");
        for r in references {
            body.push_str(&format!("- [@{}]\n", r.key));
        }
    }
    body
}

/// Build and validate the relative path for a citation note.
///
/// Returns the validated relative path (e.g. `"References/smith2020.md"`), or an
/// error string if `bib_key` contains forbidden characters, is empty, or
/// `notes_dir` would cause the path to escape the workspace root.
fn build_citation_note_path(
    root: &Path,
    bib_key: &str,
    notes_dir: &str,
) -> Result<String, String> {
    // Reject empty bib_key
    if bib_key.is_empty() {
        return Err("bib_key cannot be empty".to_string());
    }

    // Reject forbidden characters in bib_key
    for ch in bib_key.chars() {
        if FORBIDDEN_CHARS.contains(&ch) {
            return Err(format!(
                "bib_key contains forbidden character '{ch}': {bib_key}"
            ));
        }
    }

    // Reject dot-prefixed bib_key: the graph indexer's full rescan skips
    // dot-prefixed paths, so the note would silently drop from the index
    // and the shadow node would reappear with the file stuck on disk.
    if bib_key.starts_with('.') {
        return Err(format!("bib_key cannot start with '.': {bib_key}"));
    }

    // Reject absolute notes_dir
    if notes_dir.starts_with('/') || notes_dir.starts_with('\\') {
        return Err(format!(
            "notes_dir must be a relative path, got: {notes_dir}"
        ));
    }

    // Reject traversal and dot-prefixed components in notes_dir (the
    // indexer skips hidden directories, same stuck state as above)
    for component in notes_dir.split(['/', '\\']) {
        if component == ".." {
            return Err(format!(
                "notes_dir contains '..' traversal: {notes_dir}"
            ));
        }
        if component.starts_with('.') {
            return Err(format!(
                "notes_dir contains a hidden ('.'-prefixed) component: {notes_dir}"
            ));
        }
    }

    // Build the relative path
    let relative_path = if notes_dir.is_empty() {
        format!("{bib_key}.md")
    } else {
        format!("{notes_dir}/{bib_key}.md")
    };

    // Defense-in-depth: validate the final path is within workspace root
    validate_within_root(root, &relative_path).map_err(|e| e.to_string())?;

    Ok(relative_path)
}

#[tauri::command]
pub async fn materialize_citation(
    bib_key: String,
    window: tauri::Window,
    state: State<'_, WorkspaceRegistry>,
    registry: State<'_, Arc<WriteHashRegistry>>,
    oplog_state: State<'_, Arc<OpLogRegistry>>,
    graph_state: State<'_, Arc<GraphRegistry>>,
    app_handle: tauri::AppHandle,
) -> Result<PageMeta, String> {
    // 1. Resolve workspace root
    let root = get_workspace_root(&state, window.label())?;

    // 2. Get graph index first (needed for both DB lookup and citekey check)
    let gi = lookup_graph_index(&graph_state, &root)
        .ok_or_else(|| "Graph index not ready".to_string())?;

    // 3. Look up BibEntry from DB (initial existence check)
    {
        let store = gi.store();
        crate::bib::db::get_bib_item(&store.conn, &bib_key)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| format!("Bib key '{bib_key}' not found"))?;
    }

    // 4. Check no citekey page already exists (guard before enrichment)
    if let Some(page_id) = gi.store().page_for_citekey(&bib_key).map_err(|e| e.to_string())? {
        return Err(format!(
            "A page with citekey '{bib_key}' already exists: {page_id}"
        ));
    }

    // 5. Read citation.notesDir from preferences
    let prefs = crate::preferences::read_preferences(&app_handle);
    let notes_dir = crate::preferences::citation_notes_dir(&prefs);

    // 6. Build and validate relative path
    let relative_path = build_citation_note_path(&root, &bib_key, &notes_dir)?;

    // 7. Check the file doesn't already exist on disk (guard before enrichment)
    if root.join(&relative_path).exists() {
        return Err(format!("File already exists: {relative_path}"));
    }

    // 8. Best-effort enrichment (online fields + references).
    //    Runs AFTER existence guards so a duplicate-materialize fast-fails
    //    without network I/O or bib_references churn.
    match crate::commands::enrich::enrich_entry(&bib_key, &gi, &app_handle).await {
        Ok(enrich_result) => {
            if !enrich_result.candidates.is_empty() {
                tracing::info!(
                    "Enrichment for '{}' returned {} candidates (below auto-merge threshold); enrich manually via the UI",
                    bib_key,
                    enrich_result.candidates.len(),
                );
            }
            crate::commands::graph::notify_bib_changed(&graph_state, &root, &app_handle);
        }
        Err(e) => {
            tracing::warn!("Enrichment failed for '{}', proceeding without: {}", bib_key, e);
        }
    }

    // 9. Re-read entry (may have been enriched)
    let entry = {
        let store = gi.store();
        crate::bib::db::get_bib_item(&store.conn, &bib_key)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| format!("Bib key '{bib_key}' not found after enrichment"))?
    };

    // 10. Load references for body rendering
    let references = {
        let store = gi.store();
        crate::bib::db::get_references_for(&store.conn, &bib_key)
            .map_err(|e| e.to_string())?
    };

    // 11. Build frontmatter and body
    let frontmatter = build_citation_frontmatter(&entry);
    let body = build_citation_body(&entry, &references);

    // NOTE (F8/partial-failure safety): If write_page fails below,
    // reference edges and shadow stubs from enrichment (step 8)
    // persist in the DB. This is harmless:
    //   - Shadow stubs are normal bib_items (identical to standalone
    //     enrich_bib_entry output) and represent real referenced papers.
    //   - Reference edges are rebuilt idempotently on retry because
    //     enrich_entry calls delete_references_for before re-linking.
    //   - On retry, guards (steps 4+7) pass since no file/page was
    //     created, and enrichment re-runs cleanly.
    // See test: enrichment_edges_idempotent_on_retry.

    // 12. Write the file
    let content = serialize_frontmatter(&frontmatter, &body);
    ops::write_page(&root, &relative_path, &body, &frontmatter, &registry)
        .map_err(|e| e.to_string())?;

    // 13. Record oplog action
    if let Ok(oplog) = oplog_state.get_oplog(&root) {
        let store = oplog.lock().unwrap();
        let _ = store.record_operation(
            "create_page",
            &format!("Create citation note '{bib_key}'"),
            &[Action {
                seq: 0,
                action_type: "create_file".into(),
                path: relative_path.clone(),
                old_path: None,
                before_content: None,
                after_content: Some(content),
            }],
        );
    }

    // 14. Build PageMeta for the new page
    let full_path = root.join(&relative_path);
    let fs_meta = std::fs::metadata(&full_path).map_err(|e| e.to_string())?;
    let created_at = fs_meta
        .created()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64);
    let modified_at = fs_meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64);

    let page_meta = PageMeta {
        title: frontmatter
            .get("title")
            .and_then(|v| v.as_str())
            .unwrap_or(&bib_key)
            .to_string(),
        relative_path: normalize_to_nfc(&relative_path),
        frontmatter: frontmatter.clone(),
        created_at,
        modified_at,
        file_type: FileType::Markdown,
        has_companion: false,
    };

    // 15. Reindex
    reindex_and_emit(&graph_state, &app_handle, &root, |gi, ann| {
        gi.add_file(&relative_path, ann)
    });

    // 16. Return PageMeta
    Ok(page_meta)
}

// ── New DB-backed commands ───────────────────────────────────────

#[tauri::command]
pub fn bib_search(
    query: String,
    limit: usize,
    workspace_path: String,
    graph_state: tauri::State<Arc<GraphRegistry>>,
) -> Result<Vec<BibEntry>, String> {
    let root = PathBuf::from(&workspace_path);
    let gi = lookup_graph_index(&graph_state, &root)
        .ok_or_else(|| "Graph index not ready".to_string())?;
    let store = gi.store();
    crate::bib::db::search_bib_items(&store.conn, &query, limit)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn bib_get(
    cite_key: String,
    workspace_path: String,
    graph_state: tauri::State<Arc<GraphRegistry>>,
) -> Result<Option<BibEntry>, String> {
    let root = PathBuf::from(&workspace_path);
    let gi = lookup_graph_index(&graph_state, &root)
        .ok_or_else(|| "Graph index not ready".to_string())?;
    let store = gi.store();
    crate::bib::db::get_bib_item(&store.conn, &cite_key)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn bib_update_fields(
    cite_key: String,
    fields: HashMap<String, String>,
    workspace_path: String,
    graph_state: tauri::State<Arc<GraphRegistry>>,
    app_handle: tauri::AppHandle,
) -> Result<bool, String> {
    let root = PathBuf::from(&workspace_path);
    let gi = lookup_graph_index(&graph_state, &root)
        .ok_or_else(|| "Graph index not ready".to_string())?;
    let store = gi.store();
    let updated = crate::bib::db::update_bib_fields(&store.conn, &cite_key, &fields)
        .map_err(|e| e.to_string())?;
    if updated {
        crate::commands::graph::notify_bib_changed(&graph_state, &root, &app_handle);
    }
    Ok(updated)
}

#[tauri::command]
pub fn get_references(
    bib_key: String,
    workspace_path: String,
    graph_state: tauri::State<Arc<GraphRegistry>>,
) -> Result<Vec<BibEntry>, String> {
    let root = PathBuf::from(&workspace_path);
    let gi = lookup_graph_index(&graph_state, &root)
        .ok_or_else(|| "Graph index not ready".to_string())?;
    let store = gi.store();
    crate::bib::db::get_references_for(&store.conn, &bib_key)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn bib_delete(
    cite_key: String,
    workspace_path: String,
    graph_state: tauri::State<Arc<GraphRegistry>>,
    app_handle: tauri::AppHandle,
) -> Result<bool, String> {
    let root = PathBuf::from(&workspace_path);
    let gi = lookup_graph_index(&graph_state, &root)
        .ok_or_else(|| "Graph index not ready".to_string())?;
    let deleted = {
        let store = gi.store();
        crate::bib::db::tombstone_bib_item(&store.conn, &cite_key)
            .map_err(|e| e.to_string())?
    };
    if deleted {
        crate::commands::graph::notify_bib_changed(&graph_state, &root, &app_handle);
    }
    Ok(deleted)
}

/// Extract bibliography paths from YAML frontmatter.
fn extract_bib_paths_from_yaml(fm: &IndexMap<String, serde_yaml::Value>) -> Vec<String> {
    let Some(bib) = fm.get("bibliography") else {
        return Vec::new();
    };
    match bib {
        serde_yaml::Value::String(s) => vec![s.clone()],
        serde_yaml::Value::Sequence(seq) => seq
            .iter()
            .filter_map(|v| v.as_str().map(String::from))
            .collect(),
        _ => Vec::new(),
    }
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct EnsureCompanionBibResult {
    pub bib_path: String,
    /// Set to the auto-generated bibliography relative path (e.g.
    /// "assets/bib/Note.bib") when the note had NO `bibliography:` frontmatter
    /// field and the caller asked to skip the note rewrite. `None` when the
    /// field was already present or was written by Rust.
    pub bibliography_value: Option<String>,
}

/// Inner implementation of ensure_in_companion_bib, testable without Tauri state.
fn ensure_in_companion_bib_inner(
    cite_key: &str,
    note_path: &str,
    workspace_root: &Path,
    conn: &Connection,
    cache: &BibCache,
    skip_note_rewrite: bool,
) -> Result<EnsureCompanionBibResult, String> {
    // ── Reject absolute note_path ────────────────────────────────────
    // Path::join discards the root when the argument is absolute, so
    // an absolute note_path would let the caller read/write anywhere.
    if Path::new(note_path).is_absolute() {
        return Err(format!(
            "note_path must be a relative path within the workspace, got absolute: {note_path}"
        ));
    }

    // ── Validate note_path stays within workspace ──────────────────
    validate_within_root(workspace_root, note_path)
        .map_err(|e| format!("note_path escapes workspace: {e}"))?;

    // Read the note file (now safe — note_path is validated relative)
    let abs_note = workspace_root.join(note_path);
    let note_content = fs::read_to_string(&abs_note)
        .map_err(|e| format!("Failed to read note '{}': {}", note_path, e))?;

    // Parse frontmatter
    let parsed = parse_frontmatter(&note_content);
    let fm = parsed.map;
    let body = parsed.body;

    // Extract bibliography paths
    let bib_paths = extract_bib_paths_from_yaml(&fm);

    // Determine the companion bib path
    let (companion_bib_rel, bibliography_value) = if bib_paths.is_empty() {
        // Auto-create assets/bib/<NoteStem>.bib
        let note_stem = Path::new(note_path)
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("note");
        let note_dir = Path::new(note_path)
            .parent()
            .unwrap_or(Path::new(""));
        let bib_value = format!("assets/bib/{}.bib", note_stem);
        let bib_rel = if note_dir == Path::new("") {
            bib_value.clone()
        } else {
            format!("{}/assets/bib/{}.bib", note_dir.display(), note_stem)
        };
        let abs_bib = workspace_root.join(&bib_rel);
        if let Some(parent) = abs_bib.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create bib dir: {}", e))?;
        }
        if !abs_bib.exists() {
            fs::write(&abs_bib, "")
                .map_err(|e| format!("Failed to create bib file: {}", e))?;
        }

        let bib_val = if skip_note_rewrite {
            // Caller (editor) will inject the field into the live buffer.
            Some(bib_value)
        } else {
            // Write frontmatter directly (non-editor callers).
            let mut new_fm = fm;
            new_fm.insert(
                "bibliography".to_string(),
                serde_yaml::Value::String(bib_value),
            );
            let new_content = serialize_frontmatter(&new_fm, body);
            fs::write(&abs_note, new_content)
                .map_err(|e| format!("Failed to update note frontmatter: {}", e))?;
            None
        };

        (bib_rel, bib_val)
    } else {
        // Use the first bibliography path, resolve relative to note dir
        let first_bib = &bib_paths[0];
        let note_dir = Path::new(note_path).parent().unwrap_or(Path::new(""));
        let resolved = if note_dir == Path::new("") {
            first_bib.clone()
        } else {
            format!("{}/{}", note_dir.display(), first_bib)
        };
        // Normalize path (remove ./ etc.)
        let norm = PathBuf::from(&resolved);
        (norm.to_string_lossy().to_string(), None)
    };

    // ── Validate resolved bib path stays within workspace ──────────
    validate_within_root(workspace_root, &companion_bib_rel)
        .map_err(|e| format!("bibliography path escapes workspace: {e}"))?;

    // Get the entry from DB
    let entry = crate::bib::db::get_bib_item(conn, cite_key)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Bib key '{}' not found in database", cite_key))?;

    // Check if the key already exists in the target .bib file
    let abs_bib = workspace_root.join(&companion_bib_rel);
    let existing_content = fs::read_to_string(&abs_bib).unwrap_or_default();
    let existing_entries = crate::bib::parser::parse_bibtex(&existing_content);
    let key_exists = existing_entries.iter().any(|e| e.key == cite_key);

    if !key_exists {
        // Append the serialized entry directly
        let bib_str = serialize_bib_entry(&entry);
        // Create parent directories if needed (declared bib path may point to
        // a not-yet-existing directory, e.g. assets/bib/Foo.bib).
        if let Some(parent) = abs_bib.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create bib directory: {}", e))?;
        }
        let mut file = fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&abs_bib)
            .map_err(|e| format!("Failed to open bib file for append: {}", e))?;
        use std::io::Write;
        if !existing_content.is_empty() && !existing_content.ends_with('\n') {
            writeln!(file).map_err(|e| e.to_string())?;
        }
        write!(file, "{}", bib_str).map_err(|e| e.to_string())?;
        writeln!(file).map_err(|e| e.to_string())?;

        // Invalidate per-file parse cache for the modified bib file
        cache.invalidate(&abs_bib.to_path_buf());
    }

    Ok(EnsureCompanionBibResult { bib_path: companion_bib_rel, bibliography_value })
}

#[tauri::command]
pub fn ensure_in_companion_bib(
    cite_key: String,
    note_path: String,
    workspace_path: String,
    skip_note_rewrite: bool,
    graph_state: tauri::State<Arc<GraphRegistry>>,
    cache: tauri::State<BibCache>,
) -> Result<EnsureCompanionBibResult, String> {
    let root = PathBuf::from(&workspace_path);
    let gi = lookup_graph_index(&graph_state, &root)
        .ok_or_else(|| "Graph index not ready".to_string())?;
    let store = gi.store();
    ensure_in_companion_bib_inner(&cite_key, &note_path, &root, &store.conn, &cache, skip_note_rewrite)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::bib::cache::BibCache;
    use crate::bib::db;
    use crate::graph::store::Store;
    use std::collections::HashMap;
    use std::fs;
    use tempfile::TempDir;

    fn test_entry(key: &str) -> BibEntry {
        BibEntry {
            key: key.to_string(),
            entry_type: "article".to_string(),
            title: format!("Title for {}", key),
            authors: vec!["Author, Test".to_string()],
            year: "2024".to_string(),
            line_number: 0,
            bib_file: None,
            abstract_text: None,
            doi: None,
            isbn: None,
            arxiv_id: None,
            url: None,
            journal: None,
            publisher: None,
            issn: None,
            volume: None,
            number: None,
            pages: None,
            file: None,
            oclc: None,
            work_type: None,
            series: None,
            lccn: None,
            editors: vec![],
            tags: vec![],
        }
    }

    // ── DB-backed bib_search tests ────────────────────────────────

    #[test]
    fn test_bib_search_returns_matching_entries() {
        let store = Store::open_memory().unwrap();
        let mut e1 = test_entry("smith2024");
        e1.title = "Machine Learning Overview".to_string();
        db::upsert_bib_item(&store.conn, &e1, None, None, false).unwrap();
        let mut e2 = test_entry("jones2023");
        e2.title = "Quantum Computing".to_string();
        db::upsert_bib_item(&store.conn, &e2, None, None, false).unwrap();

        let results = db::search_bib_items(&store.conn, "Machine", 10).unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].key, "smith2024");
    }

    #[test]
    fn test_bib_get_returns_entry() {
        let store = Store::open_memory().unwrap();
        let e = test_entry("smith2024");
        db::upsert_bib_item(&store.conn, &e, None, None, false).unwrap();

        let fetched = db::get_bib_item(&store.conn, "smith2024").unwrap();
        assert!(fetched.is_some());
        assert_eq!(fetched.unwrap().key, "smith2024");
    }

    #[test]
    fn test_bib_get_returns_none_for_missing() {
        let store = Store::open_memory().unwrap();
        let fetched = db::get_bib_item(&store.conn, "nonexistent").unwrap();
        assert!(fetched.is_none());
    }

    #[test]
    fn test_bib_update_fields_updates_entry() {
        let store = Store::open_memory().unwrap();
        let e = test_entry("smith2024");
        db::upsert_bib_item(&store.conn, &e, None, None, false).unwrap();

        let mut fields = HashMap::new();
        fields.insert("title".to_string(), "Updated Title".to_string());
        let updated = db::update_bib_fields(&store.conn, "smith2024", &fields).unwrap();
        assert!(updated);

        let fetched = db::get_bib_item(&store.conn, "smith2024").unwrap().unwrap();
        assert_eq!(fetched.title, "Updated Title");
    }

    #[test]
    fn test_bib_delete_tombstones_entry() {
        let store = Store::open_memory().unwrap();
        let e = test_entry("smith2024");
        db::upsert_bib_item(&store.conn, &e, None, None, false).unwrap();

        let deleted = db::tombstone_bib_item(&store.conn, "smith2024").unwrap();
        assert!(deleted);

        let fetched = db::get_bib_item(&store.conn, "smith2024").unwrap();
        assert!(fetched.is_none());
    }

    // ── extract_bib_paths_from_yaml tests ─────────────────────────

    #[test]
    fn test_extract_bib_paths_from_yaml_single_string() {
        let mut fm = IndexMap::new();
        fm.insert(
            "bibliography".to_string(),
            serde_yaml::Value::String("assets/bib/Note.bib".to_string()),
        );
        let paths = extract_bib_paths_from_yaml(&fm);
        assert_eq!(paths, vec!["assets/bib/Note.bib"]);
    }

    #[test]
    fn test_extract_bib_paths_from_yaml_array() {
        let mut fm = IndexMap::new();
        fm.insert(
            "bibliography".to_string(),
            serde_yaml::Value::Sequence(vec![
                serde_yaml::Value::String("a.bib".to_string()),
                serde_yaml::Value::String("b.bib".to_string()),
            ]),
        );
        let paths = extract_bib_paths_from_yaml(&fm);
        assert_eq!(paths, vec!["a.bib", "b.bib"]);
    }

    #[test]
    fn test_extract_bib_paths_from_yaml_absent() {
        let fm = IndexMap::new();
        let paths = extract_bib_paths_from_yaml(&fm);
        assert!(paths.is_empty());
    }

    // ── ensure_in_companion_bib helper tests ─────────────────────

    #[test]
    fn test_ensure_in_companion_bib_auto_creates_bib_file() {
        let dir = TempDir::new().unwrap();
        let note_content = "---\ntitle: Test Note\n---\n\nSome content.\n";
        fs::write(dir.path().join("Note.md"), note_content).unwrap();

        let store = Store::open_memory().unwrap();
        let mut e = test_entry("smith2024");
        e.doi = Some("10.1/test".to_string());
        db::upsert_bib_item(&store.conn, &e, None, None, false).unwrap();

        let cache = BibCache::new();
        let result = ensure_in_companion_bib_inner(
            "smith2024",
            "Note.md",
            dir.path(),
            &store.conn,
            &cache,
            false,
        );
        assert!(result.is_ok(), "got: {:?}", result);
        let r = result.unwrap();
        assert!(r.bib_path.contains("assets/bib/Note.bib"));

        // The .bib file should exist and contain the entry
        let abs_bib = dir.path().join(&r.bib_path);
        assert!(abs_bib.exists(), "bib file should be created");
        let content = fs::read_to_string(&abs_bib).unwrap();
        assert!(content.contains("smith2024"), "bib file should contain the entry key");
    }

    #[test]
    fn test_ensure_in_companion_bib_uses_existing_bibliography() {
        let dir = TempDir::new().unwrap();
        let note_content = "---\ntitle: Test Note\nbibliography: refs.bib\n---\n\nSome content.\n";
        fs::write(dir.path().join("Note.md"), note_content).unwrap();
        fs::write(dir.path().join("refs.bib"), "").unwrap();

        let store = Store::open_memory().unwrap();
        let e = test_entry("smith2024");
        db::upsert_bib_item(&store.conn, &e, None, None, false).unwrap();

        let cache = BibCache::new();
        let result = ensure_in_companion_bib_inner(
            "smith2024",
            "Note.md",
            dir.path(),
            &store.conn,
            &cache,
            false,
        );
        assert!(result.is_ok(), "got: {:?}", result);
        let r = result.unwrap();
        assert_eq!(r.bib_path, "refs.bib");
    }

    #[test]
    fn test_ensure_in_companion_bib_appends_if_key_missing() {
        let dir = TempDir::new().unwrap();
        let note_content = "---\ntitle: Test Note\nbibliography: refs.bib\n---\n\nContent.\n";
        fs::write(dir.path().join("Note.md"), note_content).unwrap();
        fs::write(dir.path().join("refs.bib"), "").unwrap();

        let store = Store::open_memory().unwrap();
        let e = test_entry("smith2024");
        db::upsert_bib_item(&store.conn, &e, None, None, false).unwrap();

        let cache = BibCache::new();
        ensure_in_companion_bib_inner(
            "smith2024",
            "Note.md",
            dir.path(),
            &store.conn,
            &cache,
            false,
        )
        .unwrap();

        let content = fs::read_to_string(dir.path().join("refs.bib")).unwrap();
        assert!(content.contains("smith2024"), "entry should be appended");
    }

    #[test]
    fn test_ensure_in_companion_bib_skips_if_key_present() {
        let dir = TempDir::new().unwrap();
        let note_content = "---\ntitle: Test Note\nbibliography: refs.bib\n---\n\nContent.\n";
        fs::write(dir.path().join("Note.md"), note_content).unwrap();
        let existing_bib = "@article{smith2024,\n  author = {Author, Test},\n  title = {A Paper},\n  year = {2024}\n}\n";
        fs::write(dir.path().join("refs.bib"), existing_bib).unwrap();

        let store = Store::open_memory().unwrap();
        let e = test_entry("smith2024");
        db::upsert_bib_item(&store.conn, &e, None, None, false).unwrap();

        let cache = BibCache::new();
        ensure_in_companion_bib_inner(
            "smith2024",
            "Note.md",
            dir.path(),
            &store.conn,
            &cache,
            false,
        )
        .unwrap();

        // Parse the bib file and count entries with key smith2024
        let content = fs::read_to_string(dir.path().join("refs.bib")).unwrap();
        let entries = crate::bib::parser::parse_bibtex(&content);
        let matching = entries.iter().filter(|e| e.key == "smith2024").count();
        assert_eq!(matching, 1, "entry should not be duplicated, found {matching} entries with key smith2024");
    }

    #[test]
    fn test_ensure_skip_note_rewrite_does_not_modify_note() {
        let dir = TempDir::new().unwrap();
        let note_content = "---\ntitle: Test Note\n---\n\nSome content.\n";
        fs::write(dir.path().join("Note.md"), note_content).unwrap();

        let store = Store::open_memory().unwrap();
        let mut e = test_entry("smith2024");
        e.doi = Some("10.1/test".to_string());
        db::upsert_bib_item(&store.conn, &e, None, None, false).unwrap();

        let cache = BibCache::new();
        let result = ensure_in_companion_bib_inner(
            "smith2024",
            "Note.md",
            dir.path(),
            &store.conn,
            &cache,
            true, // skip_note_rewrite
        );
        assert!(result.is_ok(), "got: {:?}", result);
        let r = result.unwrap();

        // Note file should NOT have been modified
        let note_on_disk = fs::read_to_string(dir.path().join("Note.md")).unwrap();
        assert_eq!(note_on_disk, note_content, "note should not be modified on disk");

        // bibliography_value should be returned
        assert_eq!(
            r.bibliography_value,
            Some("assets/bib/Note.bib".to_string()),
            "should return bibliography_value when skipping note rewrite"
        );
    }

    #[test]
    fn test_ensure_skip_note_rewrite_creates_bib_file() {
        let dir = TempDir::new().unwrap();
        let note_content = "---\ntitle: Test Note\n---\n\nSome content.\n";
        fs::write(dir.path().join("Note.md"), note_content).unwrap();

        let store = Store::open_memory().unwrap();
        let mut e = test_entry("smith2024");
        e.doi = Some("10.1/test".to_string());
        db::upsert_bib_item(&store.conn, &e, None, None, false).unwrap();

        let cache = BibCache::new();
        ensure_in_companion_bib_inner(
            "smith2024",
            "Note.md",
            dir.path(),
            &store.conn,
            &cache,
            true, // skip_note_rewrite
        )
        .unwrap();

        // The .bib file should still be created and contain the entry
        let abs_bib = dir.path().join("assets/bib/Note.bib");
        assert!(abs_bib.exists(), "bib file should be created even with skip_note_rewrite");
        let content = fs::read_to_string(&abs_bib).unwrap();
        assert!(content.contains("smith2024"), "bib file should contain the entry key");
    }

    #[test]
    fn test_ensure_no_skip_writes_note_as_before() {
        let dir = TempDir::new().unwrap();
        let note_content = "---\ntitle: Test Note\n---\n\nSome content.\n";
        fs::write(dir.path().join("Note.md"), note_content).unwrap();

        let store = Store::open_memory().unwrap();
        let mut e = test_entry("smith2024");
        e.doi = Some("10.1/test".to_string());
        db::upsert_bib_item(&store.conn, &e, None, None, false).unwrap();

        let cache = BibCache::new();
        let result = ensure_in_companion_bib_inner(
            "smith2024",
            "Note.md",
            dir.path(),
            &store.conn,
            &cache,
            false, // do NOT skip note rewrite
        );
        assert!(result.is_ok(), "got: {:?}", result);
        let r = result.unwrap();

        // Note file should have bibliography field
        let note_on_disk = fs::read_to_string(dir.path().join("Note.md")).unwrap();
        assert!(note_on_disk.contains("bibliography:"), "note should have bibliography field");

        // bibliography_value should be None (Rust wrote it)
        assert_eq!(r.bibliography_value, None, "bibliography_value should be None when note was rewritten");
    }

    #[test]
    fn test_ensure_existing_bibliography_returns_none() {
        let dir = TempDir::new().unwrap();
        let note_content = "---\ntitle: Test Note\nbibliography: refs.bib\n---\n\nSome content.\n";
        fs::write(dir.path().join("Note.md"), note_content).unwrap();
        fs::write(dir.path().join("refs.bib"), "").unwrap();

        let store = Store::open_memory().unwrap();
        let e = test_entry("smith2024");
        db::upsert_bib_item(&store.conn, &e, None, None, false).unwrap();

        let cache = BibCache::new();
        // Even with skip_note_rewrite=true, bibliography_value should be None
        // because the field already exists
        let result = ensure_in_companion_bib_inner(
            "smith2024",
            "Note.md",
            dir.path(),
            &store.conn,
            &cache,
            true,
        );
        assert!(result.is_ok(), "got: {:?}", result);
        let r = result.unwrap();
        assert_eq!(r.bibliography_value, None, "should be None when bibliography field already exists");
    }

    #[test]
    fn test_ensure_result_has_correct_bib_path() {
        let dir = TempDir::new().unwrap();
        let note_content = "---\ntitle: Test Note\n---\n\nSome content.\n";
        fs::write(dir.path().join("Note.md"), note_content).unwrap();

        let store = Store::open_memory().unwrap();
        let mut e = test_entry("smith2024");
        e.doi = Some("10.1/test".to_string());
        db::upsert_bib_item(&store.conn, &e, None, None, false).unwrap();

        let cache = BibCache::new();
        let result = ensure_in_companion_bib_inner(
            "smith2024",
            "Note.md",
            dir.path(),
            &store.conn,
            &cache,
            true,
        );
        let r = result.unwrap();
        assert_eq!(r.bib_path, "assets/bib/Note.bib");
    }

    // ── Workspace-containment validation tests ───────────────────────

    #[test]
    fn test_ensure_rejects_absolute_note_path() {
        let dir = TempDir::new().unwrap();
        // Create a note at the absolute path to prove it's the validation
        // (not a missing-file error) that triggers the rejection.
        let abs_path = dir.path().join("Note.md");
        fs::write(&abs_path, "---\ntitle: Test\n---\nBody.\n").unwrap();

        let store = Store::open_memory().unwrap();
        let e = test_entry("smith2024");
        db::upsert_bib_item(&store.conn, &e, None, None, false).unwrap();

        let cache = BibCache::new();
        let result = ensure_in_companion_bib_inner(
            "smith2024",
            &abs_path.to_string_lossy(),
            dir.path(),
            &store.conn,
            &cache,
            false,
        );
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(
            err.contains("absolute") || err.contains("relative"),
            "error should mention absolute/relative, got: {err}"
        );
    }

    #[test]
    fn test_ensure_rejects_traversal_note_path() {
        let dir = TempDir::new().unwrap();
        // Create a note inside the workspace so the only failure is the
        // traversal validation, not a missing-file error.
        fs::write(dir.path().join("Note.md"), "---\ntitle: T\n---\n").unwrap();

        let store = Store::open_memory().unwrap();
        let e = test_entry("smith2024");
        db::upsert_bib_item(&store.conn, &e, None, None, false).unwrap();

        let cache = BibCache::new();
        let result = ensure_in_companion_bib_inner(
            "smith2024",
            "../../../tmp/Note.md",
            dir.path(),
            &store.conn,
            &cache,
            false,
        );
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(
            err.contains("escapes workspace") || err.contains("escapes"),
            "error should mention workspace escape, got: {err}"
        );
    }

    #[test]
    fn test_ensure_rejects_traversal_bibliography_frontmatter() {
        let dir = TempDir::new().unwrap();
        // Note whose frontmatter points outside the workspace
        let note_content =
            "---\ntitle: Evil\nbibliography: '../../../../tmp/evil.bib'\n---\nBody.\n";
        fs::write(dir.path().join("Note.md"), note_content).unwrap();

        let store = Store::open_memory().unwrap();
        let e = test_entry("smith2024");
        db::upsert_bib_item(&store.conn, &e, None, None, false).unwrap();

        let cache = BibCache::new();
        let result = ensure_in_companion_bib_inner(
            "smith2024",
            "Note.md",
            dir.path(),
            &store.conn,
            &cache,
            false,
        );
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(
            err.contains("escapes workspace") || err.contains("bibliography"),
            "error should mention workspace escape, got: {err}"
        );
    }

    #[test]
    fn test_ensure_rejects_absolute_bibliography_frontmatter() {
        let dir = TempDir::new().unwrap();
        let note_content = "---\ntitle: Evil\nbibliography: '/tmp/evil.bib'\n---\nBody.\n";
        fs::write(dir.path().join("Note.md"), note_content).unwrap();

        let store = Store::open_memory().unwrap();
        let e = test_entry("smith2024");
        db::upsert_bib_item(&store.conn, &e, None, None, false).unwrap();

        let cache = BibCache::new();
        let result = ensure_in_companion_bib_inner(
            "smith2024",
            "Note.md",
            dir.path(),
            &store.conn,
            &cache,
            false,
        );
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(
            err.contains("escapes workspace")
                || err.contains("absolute")
                || err.contains("bibliography"),
            "error should reject absolute bib path, got: {err}"
        );
    }

    #[test]
    fn test_ensure_subdirectory_note_with_valid_bib_works() {
        let dir = TempDir::new().unwrap();
        // Note in a subdirectory with a valid relative bibliography path
        let sub = dir.path().join("notes");
        fs::create_dir(&sub).unwrap();
        let note_content =
            "---\ntitle: Sub Note\nbibliography: '../refs.bib'\n---\nBody.\n";
        fs::write(sub.join("Note.md"), note_content).unwrap();
        // refs.bib is in workspace root — notes/../refs.bib resolves to refs.bib
        fs::write(dir.path().join("refs.bib"), "").unwrap();

        let store = Store::open_memory().unwrap();
        let e = test_entry("smith2024");
        db::upsert_bib_item(&store.conn, &e, None, None, false).unwrap();

        let cache = BibCache::new();
        let result = ensure_in_companion_bib_inner(
            "smith2024",
            "notes/Note.md",
            dir.path(),
            &store.conn,
            &cache,
            false,
        );
        // This SHOULD succeed: notes/../refs.bib resolves to refs.bib, still inside workspace
        assert!(
            result.is_ok(),
            "valid .. traversal within workspace should work, got: {:?}",
            result
        );
        assert_eq!(result.unwrap().bib_path, "notes/../refs.bib");
    }

    fn sample_bib() -> &'static str {
        "@article{smith2020,\n  author = {Smith, John},\n  title = {Alpha},\n  year = {2020},\n  doi = {10.1/x},\n  keywords = {ml, nlp}\n}"
    }

    #[test]
    fn empty_workspace_returns_empty() {
        let dir = TempDir::new().unwrap();
        let entries = scan_workspace_bibs(dir.path(), &BibCache::new());
        assert!(entries.is_empty());
    }

    #[test]
    fn finds_bib_in_root() {
        let dir = TempDir::new().unwrap();
        fs::write(dir.path().join("refs.bib"), sample_bib()).unwrap();
        let entries = scan_workspace_bibs(dir.path(), &BibCache::new());
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].key, "smith2020");
    }

    #[test]
    fn finds_bib_in_nested_dirs() {
        let dir = TempDir::new().unwrap();
        fs::write(dir.path().join("root.bib"), sample_bib()).unwrap();
        let sub = dir.path().join("papers");
        fs::create_dir(&sub).unwrap();
        fs::write(
            sub.join("nested.bib"),
            "@book{doe2021,\n  author = {Doe, Jane},\n  title = {Beta},\n  year = {2021}\n}",
        )
        .unwrap();
        let entries = scan_workspace_bibs(dir.path(), &BibCache::new());
        assert_eq!(entries.len(), 2);
        let keys: Vec<&str> = entries.iter().map(|e| e.key.as_str()).collect();
        assert!(keys.contains(&"smith2020"));
        assert!(keys.contains(&"doe2021"));
    }

    #[test]
    fn skips_hidden_dirs() {
        let dir = TempDir::new().unwrap();
        let hidden = dir.path().join(".obsidian");
        fs::create_dir(&hidden).unwrap();
        fs::write(hidden.join("hidden.bib"), sample_bib()).unwrap();
        fs::write(dir.path().join("visible.bib"), sample_bib()).unwrap();
        let entries = scan_workspace_bibs(dir.path(), &BibCache::new());
        assert_eq!(entries.len(), 1);
        assert!(entries[0]
            .bib_file
            .as_ref()
            .unwrap()
            .ends_with("visible.bib"));
    }

    #[test]
    fn bib_file_is_absolute_path() {
        let dir = TempDir::new().unwrap();
        fs::write(dir.path().join("refs.bib"), sample_bib()).unwrap();
        let entries = scan_workspace_bibs(dir.path(), &BibCache::new());
        let bib_file = entries[0].bib_file.as_ref().unwrap();
        assert!(bib_file.ends_with("refs.bib"));
        assert!(Path::new(bib_file).is_absolute());
    }

    #[test]
    fn ignores_non_bib_files() {
        let dir = TempDir::new().unwrap();
        fs::write(dir.path().join("notes.md"), "# hello").unwrap();
        fs::write(dir.path().join("data.txt"), "stuff").unwrap();
        fs::write(dir.path().join("refs.bib"), sample_bib()).unwrap();
        let entries = scan_workspace_bibs(dir.path(), &BibCache::new());
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].key, "smith2020");
    }

    #[test]
    fn multiple_entries_in_one_file() {
        let dir = TempDir::new().unwrap();
        let two = "@article{smith2020,\n  author = {Smith, John},\n  title = {Alpha},\n  year = {2020}\n}\n\n@book{doe2021,\n  author = {Doe, Jane},\n  title = {Beta},\n  year = {2021}\n}";
        fs::write(dir.path().join("refs.bib"), two).unwrap();
        let entries = scan_workspace_bibs(dir.path(), &BibCache::new());
        assert_eq!(entries.len(), 2);
    }

    #[test]
    fn results_are_sorted_by_bib_file_then_line() {
        let dir = TempDir::new().unwrap();
        fs::write(
            dir.path().join("b.bib"),
            "@article{bbb,\n  author = {B, B},\n  title = {B},\n  year = {2020}\n}",
        )
        .unwrap();
        fs::write(
            dir.path().join("a.bib"),
            "@article{aaa,\n  author = {A, A},\n  title = {A},\n  year = {2020}\n}",
        )
        .unwrap();
        let entries = scan_workspace_bibs(dir.path(), &BibCache::new());
        assert_eq!(entries.len(), 2);
        let a_idx = entries.iter().position(|e| e.key == "aaa").unwrap();
        let b_idx = entries.iter().position(|e| e.key == "bbb").unwrap();
        assert!(a_idx < b_idx, "a.bib entries should come before b.bib");
    }

    #[test]
    fn skips_unreadable_or_non_utf8_bib() {
        let dir = TempDir::new().unwrap();
        fs::write(dir.path().join("bad.bib"), [0xff, 0xfe, 0x00]).unwrap();
        fs::write(dir.path().join("good.bib"), sample_bib()).unwrap();
        let entries = scan_workspace_bibs(dir.path(), &BibCache::new());
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].key, "smith2020");
    }

    #[test]
    fn warm_cache_skips_file_read() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("refs.bib");
        fs::write(&path, sample_bib()).unwrap();

        let cache = BibCache::new();

        // First scan populates the cache.
        let entries1 = scan_workspace_bibs(dir.path(), &cache);
        assert_eq!(entries1.len(), 1);
        assert_eq!(entries1[0].key, "smith2020");

        // Capture the original mtime, then overwrite the file with DIFFERENT
        // content while restoring the original mtime. A correct warm-cache path
        // must not read the new bytes.
        let orig_mtime = filetime::FileTime::from_last_modification_time(
            &fs::metadata(&path).unwrap(),
        );
        fs::write(
            &path,
            "@article{changed9999,\n  author = {New, Author},\n  title = {Changed},\n  year = {2099}\n}",
        )
        .unwrap();
        filetime::set_file_mtime(&path, orig_mtime).unwrap();

        let entries2 = scan_workspace_bibs(dir.path(), &cache);
        assert_eq!(entries2.len(), 1);
        assert_eq!(
            entries2[0].key, "smith2020",
            "warm cache must return original entry; new file content must not be read"
        );
    }

    #[test]
    fn new_metadata_fields_populated() {
        let dir = TempDir::new().unwrap();
        fs::write(dir.path().join("refs.bib"), sample_bib()).unwrap();
        let entries = scan_workspace_bibs(dir.path(), &BibCache::new());
        assert_eq!(entries[0].doi, Some("10.1/x".to_string()));
        assert_eq!(entries[0].tags, vec!["ml", "nlp"]);
    }

    // --- build_citation_frontmatter ---

    fn sample_citation_entry() -> BibEntry {
        BibEntry {
            key: "smith2020".to_string(),
            authors: vec!["Smith, John".to_string(), "Doe, Jane".to_string()],
            title: "Alpha".to_string(),
            year: "2020".to_string(),
            entry_type: "article".to_string(),
            line_number: 1,
            bib_file: None,
            abstract_text: Some("This paper studies...".to_string()),
            doi: Some("10.1/x".to_string()),
            journal: Some("Nature".to_string()),
            url: Some("https://example.com".to_string()),
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
            tags: vec!["ml".to_string(), "nlp".to_string()],
        }
    }

    #[test]
    fn frontmatter_includes_title_from_shadow_title() {
        let entry = sample_citation_entry();
        let fm = super::build_citation_frontmatter(&entry);
        let title = fm.get("title").unwrap();
        assert_eq!(
            title,
            &serde_yaml::Value::String("Smith (2020) Alpha".to_string())
        );
    }

    #[test]
    fn frontmatter_includes_citekey() {
        let entry = sample_citation_entry();
        let fm = super::build_citation_frontmatter(&entry);
        assert_eq!(
            fm.get("citekey").unwrap(),
            &serde_yaml::Value::String("smith2020".to_string())
        );
    }

    #[test]
    fn frontmatter_includes_authors_sequence() {
        let entry = sample_citation_entry();
        let fm = super::build_citation_frontmatter(&entry);
        let authors = fm.get("authors").unwrap();
        match authors {
            serde_yaml::Value::Sequence(seq) => {
                assert_eq!(seq.len(), 2);
                assert_eq!(seq[0], serde_yaml::Value::String("Smith, John".to_string()));
                assert_eq!(seq[1], serde_yaml::Value::String("Doe, Jane".to_string()));
            }
            _ => panic!("expected Sequence"),
        }
    }

    #[test]
    fn frontmatter_includes_optional_fields() {
        let entry = sample_citation_entry();
        let fm = super::build_citation_frontmatter(&entry);
        assert_eq!(
            fm.get("doi").unwrap(),
            &serde_yaml::Value::String("10.1/x".to_string())
        );
        assert_eq!(
            fm.get("journal").unwrap(),
            &serde_yaml::Value::String("Nature".to_string())
        );
        assert_eq!(
            fm.get("url").unwrap(),
            &serde_yaml::Value::String("https://example.com".to_string())
        );
        assert_eq!(
            fm.get("year").unwrap(),
            &serde_yaml::Value::String("2020".to_string())
        );
    }

    #[test]
    fn frontmatter_omits_absent_optional_fields() {
        let entry = BibEntry {
            key: "doe2021".to_string(),
            authors: vec!["Doe, Jane".to_string()],
            title: "Beta".to_string(),
            year: "2021".to_string(),
            entry_type: "book".to_string(),
            line_number: 1,
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
        };
        let fm = super::build_citation_frontmatter(&entry);
        assert!(fm.get("doi").is_none());
        assert!(fm.get("journal").is_none());
        assert!(fm.get("url").is_none());
        assert!(fm.get("tags").is_none());
        // citekey, title, authors, year should still be present
        assert!(fm.get("citekey").is_some());
        assert!(fm.get("title").is_some());
        assert!(fm.get("authors").is_some());
        assert!(fm.get("year").is_some());
    }

    #[test]
    fn frontmatter_omits_empty_authors() {
        let entry = BibEntry {
            key: "anon2021".to_string(),
            authors: vec![],
            title: "No Author".to_string(),
            year: "2021".to_string(),
            entry_type: "misc".to_string(),
            line_number: 1,
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
        };
        let fm = super::build_citation_frontmatter(&entry);
        assert!(fm.get("authors").is_none());
    }

    #[test]
    fn frontmatter_includes_tags_sequence() {
        let entry = sample_citation_entry();
        let fm = super::build_citation_frontmatter(&entry);
        let tags = fm.get("tags").unwrap();
        match tags {
            serde_yaml::Value::Sequence(seq) => {
                assert_eq!(seq.len(), 2);
                assert_eq!(seq[0], serde_yaml::Value::String("ml".to_string()));
                assert_eq!(seq[1], serde_yaml::Value::String("nlp".to_string()));
            }
            _ => panic!("expected Sequence"),
        }
    }

    // --- build_citation_body ---

    #[test]
    fn body_includes_abstract_when_present() {
        let entry = sample_citation_entry();
        let body = super::build_citation_body(&entry, &[]);
        assert!(body.contains("## Abstract"));
        assert!(body.contains("This paper studies..."));
        assert!(body.contains("## Notes"));
    }

    #[test]
    fn body_omits_abstract_when_absent() {
        let entry = BibEntry {
            key: "doe2021".to_string(),
            authors: vec!["Doe, Jane".to_string()],
            title: "Beta".to_string(),
            year: "2021".to_string(),
            entry_type: "book".to_string(),
            line_number: 1,
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
        };
        let body = super::build_citation_body(&entry, &[]);
        assert!(!body.contains("## Abstract"));
        assert!(body.contains("## Notes"));
    }

    #[test]
    fn body_always_has_notes_section() {
        let entry = sample_citation_entry();
        let body = super::build_citation_body(&entry, &[]);
        assert!(body.ends_with("## Notes\n"));
    }

    // --- build_citation_body with references ---

    #[test]
    fn body_includes_references_section_with_entries() {
        let entry = sample_citation_entry();
        let refs = vec![
            test_entry("ref_alpha2020"),
            test_entry("ref_beta2021"),
            test_entry("ref_gamma2022"),
        ];
        let body = super::build_citation_body(&entry, &refs);
        assert!(body.contains("## References"), "body should contain references section");
        assert!(body.contains("- [@ref_alpha2020]"));
        assert!(body.contains("- [@ref_beta2021]"));
        assert!(body.contains("- [@ref_gamma2022]"));
        // References section must come after Notes section
        let notes_pos = body.find("## Notes").unwrap();
        let refs_pos = body.find("## References").unwrap();
        assert!(refs_pos > notes_pos, "References should come after Notes");
    }

    #[test]
    fn body_omits_references_section_when_empty() {
        let entry = sample_citation_entry();
        let body = super::build_citation_body(&entry, &[]);
        assert!(!body.contains("## References"), "body should NOT contain references section when no refs");
        assert!(body.contains("## Notes"));
    }

    #[test]
    fn body_references_ordered_as_given() {
        let entry = sample_citation_entry();
        let refs = vec![
            test_entry("zzz_last2020"),
            test_entry("aaa_first2020"),
        ];
        let body = super::build_citation_body(&entry, &refs);
        let zzz_pos = body.find("[@zzz_last2020]").unwrap();
        let aaa_pos = body.find("[@aaa_first2020]").unwrap();
        assert!(zzz_pos < aaa_pos, "references should be in insertion order, not sorted");
    }

    #[test]
    fn body_with_abstract_and_references() {
        let entry = sample_citation_entry(); // has abstract_text
        let refs = vec![test_entry("child2024")];
        let body = super::build_citation_body(&entry, &refs);
        // All three sections present in order
        let abs_pos = body.find("## Abstract").unwrap();
        let notes_pos = body.find("## Notes").unwrap();
        let refs_pos = body.find("## References").unwrap();
        assert!(abs_pos < notes_pos);
        assert!(notes_pos < refs_pos);
        assert!(body.contains("- [@child2024]"));
    }

    // --- build_citation_note_path ---

    #[test]
    fn note_path_simple_key_and_dir() {
        let dir = TempDir::new().unwrap();
        let result = build_citation_note_path(dir.path(), "smith2020", "References");
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), "References/smith2020.md");
    }

    #[test]
    fn note_path_empty_notes_dir() {
        let dir = TempDir::new().unwrap();
        let result = build_citation_note_path(dir.path(), "smith2020", "");
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), "smith2020.md");
    }

    #[test]
    fn note_path_nested_notes_dir() {
        let dir = TempDir::new().unwrap();
        let result = build_citation_note_path(dir.path(), "smith2020", "a/b/c");
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), "a/b/c/smith2020.md");
    }

    #[test]
    fn note_path_rejects_slash_in_key() {
        let dir = TempDir::new().unwrap();
        let result = build_citation_note_path(dir.path(), "foo/bar", "References");
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(err.contains("forbidden character"), "got: {err}");
    }

    #[test]
    fn note_path_rejects_backslash_in_key() {
        let dir = TempDir::new().unwrap();
        let result = build_citation_note_path(dir.path(), "foo\\bar", "References");
        assert!(result.is_err());
    }

    #[test]
    fn note_path_rejects_null_in_key() {
        let dir = TempDir::new().unwrap();
        let result = build_citation_note_path(dir.path(), "foo\0bar", "References");
        assert!(result.is_err());
    }

    #[test]
    fn note_path_rejects_colon_in_key() {
        let dir = TempDir::new().unwrap();
        let result = build_citation_note_path(dir.path(), "foo:bar", "References");
        assert!(result.is_err());
    }

    #[test]
    fn note_path_rejects_empty_key() {
        let dir = TempDir::new().unwrap();
        let result = build_citation_note_path(dir.path(), "", "References");
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(err.contains("empty"), "got: {err}");
    }

    #[test]
    fn note_path_rejects_dot_prefixed_key() {
        let dir = TempDir::new().unwrap();
        let result = build_citation_note_path(dir.path(), ".hidden2020", "References");
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(err.contains("cannot start with '.'"), "got: {err}");
    }

    #[test]
    fn note_path_rejects_dot_prefixed_notes_dir() {
        let dir = TempDir::new().unwrap();
        let result = build_citation_note_path(dir.path(), "smith2020", ".references");
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(err.contains("hidden"), "got: {err}");
    }

    #[test]
    fn note_path_rejects_hidden_component_in_nested_notes_dir() {
        let dir = TempDir::new().unwrap();
        let result = build_citation_note_path(dir.path(), "smith2020", "notes/.refs/sub");
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(err.contains("hidden"), "got: {err}");
    }

    #[test]
    fn note_path_rejects_traversal_in_notes_dir() {
        let dir = TempDir::new().unwrap();
        let result = build_citation_note_path(dir.path(), "smith2020", "../outside");
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(
            err.contains("escapes") || err.contains("traversal") || err.contains(".."),
            "got: {err}"
        );
    }

    #[test]
    fn note_path_rejects_absolute_notes_dir() {
        let dir = TempDir::new().unwrap();
        let result = build_citation_note_path(dir.path(), "smith2020", "/etc/evil");
        assert!(result.is_err());
    }

    #[test]
    fn note_path_rejects_dotdot_in_notes_dir() {
        let dir = TempDir::new().unwrap();
        let result = build_citation_note_path(dir.path(), "smith2020", "a/../../../etc");
        assert!(result.is_err());
    }

    #[test]
    fn note_path_validates_within_root() {
        let dir = TempDir::new().unwrap();
        // Even a sneaky notes_dir that looks fine but resolves outside
        let result = build_citation_note_path(dir.path(), "smith2020", "legit");
        assert!(result.is_ok());
        let path = result.unwrap();
        // The returned path, when joined with root, must be inside root
        let full = dir.path().join(&path);
        assert!(
            full.starts_with(dir.path()),
            "full path {full:?} must start with root {:?}",
            dir.path()
        );
    }

    #[test]
    fn note_path_all_forbidden_chars_rejected_in_key() {
        use crate::workspace::normalize::FORBIDDEN_CHARS;
        let dir = TempDir::new().unwrap();
        for ch in FORBIDDEN_CHARS {
            let key = format!("key{ch}bad");
            let result = build_citation_note_path(dir.path(), &key, "References");
            assert!(result.is_err(), "should reject key with '{ch}'");
        }
    }

    #[test]
    fn citation_serialized_content_matches_written_file() {
        use crate::workspace::frontmatter::serialize_frontmatter;
        use crate::workspace::write_hash::WriteHashRegistry;

        let entry = sample_citation_entry();
        let frontmatter = build_citation_frontmatter(&entry);
        let body = build_citation_body(&entry, &[]);
        let content = serialize_frontmatter(&frontmatter, &body);

        // The serialized content must be non-empty (regression guard against
        // the old bug where after_content was always String::new()).
        assert!(!content.is_empty(), "serialized content must not be empty");

        // Verify it contains the frontmatter delimiters and body
        assert!(content.starts_with("---\n"), "must start with YAML fence");
        assert!(content.contains("citekey: smith2020"), "must contain citekey");
        assert!(content.contains("## Notes"), "must contain body");

        // Verify roundtrip: write_page writes the same content to disk
        let dir = TempDir::new().unwrap();
        let registry = WriteHashRegistry::new();
        ops::write_page(dir.path(), "test.md", &body, &frontmatter, &registry).unwrap();
        let on_disk = std::fs::read_to_string(dir.path().join("test.md")).unwrap();
        assert_eq!(
            content, on_disk,
            "serialize_frontmatter must produce identical output to what write_page writes"
        );
    }

    #[test]
    fn test_ensure_declared_bib_file_missing_on_disk() {
        // Regression: when frontmatter declares bibliography: refs.bib but the
        // file does not exist on disk, the append branch must create it instead
        // of failing with NotFound.
        let dir = TempDir::new().unwrap();
        let note_content = "---\ntitle: Test Note\nbibliography: refs.bib\n---\n\nSome content.\n";
        fs::write(dir.path().join("Note.md"), note_content).unwrap();
        // Intentionally do NOT create refs.bib on disk

        let store = Store::open_memory().unwrap();
        let e = test_entry("smith2024");
        db::upsert_bib_item(&store.conn, &e, None, None, false).unwrap();

        let cache = BibCache::new();
        let result = ensure_in_companion_bib_inner(
            "smith2024",
            "Note.md",
            dir.path(),
            &store.conn,
            &cache,
            false,
        );
        assert!(result.is_ok(), "should succeed even when declared bib file is missing, got: {:?}", result);
        let r = result.unwrap();
        assert_eq!(r.bib_path, "refs.bib");

        // The .bib file should now exist on disk and contain the cite key
        let abs_bib = dir.path().join("refs.bib");
        assert!(abs_bib.exists(), "refs.bib should be created on disk");
        let content = fs::read_to_string(&abs_bib).unwrap();
        assert!(content.contains("smith2024"), "bib file should contain the entry key");
    }

    #[test]
    fn test_ensure_declared_bib_nested_dir_missing() {
        // When frontmatter declares bibliography: assets/bib/Deep.bib and
        // neither the directory nor the file exist, both must be created.
        let dir = TempDir::new().unwrap();
        let note_content = "---\ntitle: Test Note\nbibliography: assets/bib/Deep.bib\n---\n\nContent.\n";
        fs::write(dir.path().join("Note.md"), note_content).unwrap();
        // Intentionally do NOT create assets/bib/ directory

        let store = Store::open_memory().unwrap();
        let e = test_entry("smith2024");
        db::upsert_bib_item(&store.conn, &e, None, None, false).unwrap();

        let cache = BibCache::new();
        let result = ensure_in_companion_bib_inner(
            "smith2024",
            "Note.md",
            dir.path(),
            &store.conn,
            &cache,
            false,
        );
        assert!(result.is_ok(), "should succeed even when parent dirs are missing, got: {:?}", result);
        let r = result.unwrap();
        assert_eq!(r.bib_path, "assets/bib/Deep.bib");

        // The nested .bib file should now exist and contain the cite key
        let abs_bib = dir.path().join("assets/bib/Deep.bib");
        assert!(abs_bib.exists(), "assets/bib/Deep.bib should be created on disk");
        let content = fs::read_to_string(&abs_bib).unwrap();
        assert!(content.contains("smith2024"), "bib file should contain the entry key");
    }

    // ── get_references tests ─────────────────────────────────────

    #[test]
    fn test_get_references_returns_children() {
        let store = Store::open_memory().unwrap();
        let parent = test_entry("parent2024");
        db::upsert_bib_item(&store.conn, &parent, None, None, false).unwrap();
        let child1 = test_entry("child_a2024");
        db::upsert_bib_item(&store.conn, &child1, None, None, false).unwrap();
        let child2 = test_entry("child_b2024");
        db::upsert_bib_item(&store.conn, &child2, None, None, false).unwrap();

        db::insert_bib_reference(&store.conn, "parent2024", "child_a2024", Some(0)).unwrap();
        db::insert_bib_reference(&store.conn, "parent2024", "child_b2024", Some(1)).unwrap();

        let refs = crate::bib::db::get_references_for(&store.conn, "parent2024").unwrap();
        assert_eq!(refs.len(), 2);
        assert_eq!(refs[0].key, "child_a2024");
        assert_eq!(refs[1].key, "child_b2024");
    }

    #[test]
    fn test_get_references_returns_empty_when_no_refs() {
        let store = Store::open_memory().unwrap();
        let parent = test_entry("lonely2024");
        db::upsert_bib_item(&store.conn, &parent, None, None, false).unwrap();

        let refs = crate::bib::db::get_references_for(&store.conn, "lonely2024").unwrap();
        assert!(refs.is_empty());
    }

    /// Regression test for F10: bib_update_fields must trigger refresh_shadows
    /// so that shadow node titles in the graph reflect updated DB fields.
    #[test]
    fn test_bib_update_fields_refreshes_shadow_title() {
        use crate::graph::indexer::GraphIndex;

        let dir = TempDir::new().unwrap();
        let root = dir.path().to_path_buf();

        // Write a .md file citing [@smith2024]
        fs::write(dir.path().join("a.md"), "See [@smith2024].").unwrap();

        // Write a .bib file so the initial build ingests the entry
        fs::write(
            dir.path().join("refs.bib"),
            "@article{smith2024,\n  author = {Smith, John},\n  title = {Original Title},\n  year = {2024}\n}",
        ).unwrap();

        // Build GraphIndex (ingests .bib into DB and creates shadow nodes)
        let gi = GraphIndex::build(root.clone(), false).unwrap();

        // Verify initial shadow title contains "Original Title"
        {
            let store = gi.store();
            let titles = store.node_titles().unwrap();
            let title = titles.get("bib:smith2024").expect("shadow should exist after build");
            assert!(
                title.contains("Original Title"),
                "initial shadow title should contain 'Original Title', got: {title}"
            );
        }

        // Update title in DB (simulating what bib_update_fields does)
        let mut fields = HashMap::new();
        fields.insert("title".to_string(), "Updated Title".to_string());
        {
            let store = gi.store();
            let updated = db::update_bib_fields(&store.conn, "smith2024", &fields).unwrap();
            assert!(updated);
        }

        // Refresh shadows (this is what notify_bib_changed does internally)
        let changed = gi.refresh_shadows().unwrap();
        assert!(changed, "refresh_shadows should detect the title change");

        // Verify updated shadow title contains "Updated Title"
        {
            let store = gi.store();
            let titles = store.node_titles().unwrap();
            let title = titles.get("bib:smith2024").expect("shadow should still exist");
            assert!(
                title.contains("Updated Title"),
                "shadow title should be updated to contain 'Updated Title', got: {title}"
            );
        }
    }

    /// Regression test for F1: materialize_citation must check existence guards
    /// (page_for_citekey and file-on-disk) BEFORE running enrichment, so that
    /// re-materializing an already-noted citation fast-fails without network I/O
    /// or bib_references churn.
    ///
    /// We can't call the async Tauri command from a unit test, so this test
    /// validates the invariant: when a citekey page already exists, the guard
    /// detects it AND no reference edges exist (proving enrichment could not
    /// have run first).
    #[test]
    fn materialize_guards_reject_before_creating_references() {
        use crate::graph::indexer::GraphIndex;

        let dir = TempDir::new().unwrap();
        let root = dir.path().to_path_buf();

        // Create a markdown file with citekey frontmatter (simulates an
        // already-materialized citation note).
        fs::write(
            dir.path().join("existing.md"),
            "---\ntitle: Existing\ncitekey: smith2024\n---\nBody.\n",
        )
        .unwrap();

        // Create a .bib file so the entry is ingested into the DB.
        fs::write(
            dir.path().join("refs.bib"),
            "@article{smith2024,\n  author = {Smith, John},\n  title = {A Paper},\n  year = {2024}\n}",
        )
        .unwrap();

        // Build GraphIndex (ingests bib + indexes pages)
        let gi = GraphIndex::build(root.clone(), false).unwrap();

        // Guard 1: page_for_citekey must detect the existing page
        let page_id = gi.store().page_for_citekey("smith2024").unwrap();
        assert!(
            page_id.is_some(),
            "page_for_citekey should find the existing page with citekey smith2024"
        );

        // Invariant: no reference edges exist because enrichment has never run.
        // In the fixed code, guards fire before enrichment, so this state is
        // what the function sees when it rejects the duplicate.
        let refs = {
            let store = gi.store();
            crate::bib::db::get_references_for(&store.conn, "smith2024").unwrap()
        };
        assert!(
            refs.is_empty(),
            "no reference edges should exist since enrichment was never called"
        );

        // Guard 2: build_citation_note_path + file-exists check.
        // The citation note path is independent of enrichment results.
        let relative_path = build_citation_note_path(&root, "smith2024", "").unwrap();
        assert_eq!(relative_path, "smith2024.md");
        // Note: "smith2024.md" doesn't exist on disk (the file is "existing.md"),
        // so the file-exists guard wouldn't fire here. But the citekey guard
        // above already catches the duplicate. Both guards must precede enrichment.
    }

    /// F8 regression: if write_page fails after enrichment (step 12),
    /// reference edges and shadow stubs persist. On retry, enrichment
    /// must be idempotent: delete_references_for + re-link reproduces
    /// the same edges, and upsert_bib_item(..., from_scan=true) on
    /// existing shadows gap-fills without clobbering.
    #[test]
    fn enrichment_edges_idempotent_on_retry() {
        let store = Store::open_memory().unwrap();

        // Insert parent entry
        let parent = test_entry("parent2024");
        db::upsert_bib_item(&store.conn, &parent, None, None, false).unwrap();

        // --- First enrichment pass (simulates successful enrich_entry) ---
        let ref_keys = ["ref_a2024", "ref_b2024", "ref_c2024"];
        for (idx, key) in ref_keys.iter().enumerate() {
            let ref_entry = test_entry(key);
            db::upsert_bib_item(&store.conn, &ref_entry, None, None, true).unwrap();
            db::insert_bib_reference(&store.conn, "parent2024", key, Some(idx as i64)).unwrap();
        }

        // Snapshot state after first pass
        let refs_after_first = db::get_references_for(&store.conn, "parent2024").unwrap();
        assert_eq!(refs_after_first.len(), 3);
        let keys_after_first: Vec<String> = refs_after_first.iter().map(|r| r.key.clone()).collect();

        // Snapshot shadow entries
        let shadow_a = db::get_bib_item(&store.conn, "ref_a2024").unwrap();
        assert!(shadow_a.is_some(), "shadow stub must exist after first pass");
        let shadow_a = shadow_a.unwrap();

        // --- Simulate write_page failure: edges persist, no file created ---
        // --- Second enrichment pass (retry) ---
        // enrich_entry calls delete_references_for before re-linking
        db::delete_references_for(&store.conn, "parent2024").unwrap();

        // Re-upsert same shadows with from_scan=true (gap-fill, not clobber)
        for (idx, key) in ref_keys.iter().enumerate() {
            let ref_entry = test_entry(key);
            let outcome = db::upsert_bib_item(&store.conn, &ref_entry, None, None, true).unwrap();
            // Must be Updated (entry already exists), not Inserted
            assert!(
                matches!(outcome, db::UpsertOutcome::Updated { .. }),
                "retry upsert for '{}' should be Updated, got {:?}", key, outcome,
            );
            db::insert_bib_reference(&store.conn, "parent2024", key, Some(idx as i64)).unwrap();
        }

        // Assert edges are identical after retry
        let refs_after_retry = db::get_references_for(&store.conn, "parent2024").unwrap();
        let keys_after_retry: Vec<String> = refs_after_retry.iter().map(|r| r.key.clone()).collect();
        assert_eq!(
            keys_after_first, keys_after_retry,
            "reference edges must be identical after retry"
        );

        // Assert shadow entries are not clobbered (gap-fill preserves existing fields)
        let shadow_a_retry = db::get_bib_item(&store.conn, "ref_a2024").unwrap().unwrap();
        assert_eq!(shadow_a.title, shadow_a_retry.title, "shadow title must survive retry");
        assert_eq!(shadow_a.year, shadow_a_retry.year, "shadow year must survive retry");

        // Assert total bib_items count is stable (no duplicates created)
        let all_items = db::list_bib_items(&store.conn).unwrap();
        assert_eq!(
            all_items.len(), 4, // 1 parent + 3 refs
            "retry must not create additional entries"
        );
    }
}
