use std::collections::HashMap;
use std::fs;
use std::path::Path;
use std::sync::Arc;

use indexmap::IndexMap;
use tauri::State;

use crate::bib::cache::BibCache;
use crate::bib::types::BibEntry;
use crate::commands::graph::GraphRegistry;
use crate::commands::oplog::OpLogRegistry;
use crate::commands::page::{lookup_graph_index, reindex_and_emit};
use crate::commands::workspace::{get_workspace_root, WorkspaceRegistry};
use crate::graph::indexer::shadow_title;
use crate::oplog::store::Action;
use crate::workspace::frontmatter::serialize_frontmatter;
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

/// Build a key -> BibEntry index from all `.bib` files in the workspace.
/// Used by the graph indexer to create shadow nodes for cited bib keys.
///
/// Returns a cached result when the index cache is warm (populated by a
/// previous call and not yet invalidated via [`BibCache::mark_index_dirty`]).
/// This avoids the O(filesystem) `WalkDir` on the hot path (pure `.md` saves).
pub fn build_bib_index(root: &Path, cache: &BibCache) -> HashMap<String, BibEntry> {
    if let Some(cached) = cache.get_cached_index() {
        return cached;
    }
    let index: HashMap<String, BibEntry> = scan_workspace_bibs(root, cache)
        .into_iter()
        .map(|e| (e.key.clone(), e))
        .collect();
    cache.set_cached_index(index.clone());
    index
}

/// Look up a single bib entry by key, preferring a targeted cache lookup
/// that clones only the matched entry.  Falls back to `build_bib_index`
/// (full walk + full clone) when the index cache is cold.
pub fn lookup_bib_entry(root: &Path, cache: &BibCache, key: &str) -> Option<BibEntry> {
    // Fast path: index cache is warm, clone only the one entry.
    if let Some(entry) = cache.get_entry(key) {
        return Some(entry);
    }
    // Cold cache: build the full index (populates the cache for later),
    // then extract the single entry.
    build_bib_index(root, cache).remove(key)
}

pub fn scan_workspace_bib_paths(root: &Path) -> Vec<String> {
    let mut paths = Vec::new();
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
        paths.push(path.to_string_lossy().to_string());
    }
    paths.sort();
    paths
}

#[tauri::command]
pub fn list_bib_entries(
    workspace_path: String,
    cache: tauri::State<BibCache>,
) -> Vec<BibEntry> {
    scan_workspace_bibs(Path::new(&workspace_path), &cache)
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
fn build_citation_body(entry: &BibEntry) -> String {
    let mut body = String::new();
    if let Some(abstract_text) = &entry.abstract_text {
        body.push_str("## Abstract\n\n");
        body.push_str(abstract_text);
        body.push_str("\n\n");
    }
    body.push_str("## Notes\n");
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

    // Reject absolute notes_dir
    if notes_dir.starts_with('/') || notes_dir.starts_with('\\') {
        return Err(format!(
            "notes_dir must be a relative path, got: {notes_dir}"
        ));
    }

    // Reject path traversal components in notes_dir
    for component in notes_dir.split(['/', '\\']) {
        if component == ".." {
            return Err(format!(
                "notes_dir contains '..' traversal: {notes_dir}"
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
pub fn materialize_citation(
    bib_key: String,
    window: tauri::Window,
    state: State<WorkspaceRegistry>,
    cache: State<BibCache>,
    registry: State<Arc<WriteHashRegistry>>,
    oplog_state: State<Arc<OpLogRegistry>>,
    graph_state: State<Arc<GraphRegistry>>,
    app_handle: tauri::AppHandle,
) -> Result<PageMeta, String> {
    // 1. Resolve workspace root
    let root = get_workspace_root(&state, window.label())?;

    // 2. Look up BibEntry
    let entry = lookup_bib_entry(&root, &cache, &bib_key)
        .ok_or_else(|| format!("Bib key '{bib_key}' not found"))?;

    // 3. Check no citekey page already exists
    let gi = lookup_graph_index(&graph_state, &root)
        .ok_or_else(|| "Graph index not ready".to_string())?;
    if let Some(page_id) = gi.store().page_for_citekey(&bib_key).map_err(|e| e.to_string())? {
        return Err(format!(
            "A page with citekey '{bib_key}' already exists: {page_id}"
        ));
    }

    // 4. Read citation.notesDir from preferences
    let prefs = crate::preferences::read_preferences(&app_handle);
    let notes_dir = crate::preferences::citation_notes_dir(&prefs);

    // 5. Build and validate relative path
    let relative_path = build_citation_note_path(&root, &bib_key, &notes_dir)?;

    // 6. Check the file doesn't already exist on disk
    if root.join(&relative_path).exists() {
        return Err(format!("File already exists: {relative_path}"));
    }

    // 7. Build frontmatter and body
    let frontmatter = build_citation_frontmatter(&entry);
    let body = build_citation_body(&entry);

    // 8. Write the file
    let content = serialize_frontmatter(&frontmatter, &body);
    ops::write_page(&root, &relative_path, &body, &frontmatter, &registry)
        .map_err(|e| e.to_string())?;

    // 9. Record oplog action
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

    // 10. Build PageMeta for the new page
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
    };

    // 11. Reindex
    reindex_and_emit(&graph_state, &app_handle, &root, |gi, ann| {
        gi.add_file(&relative_path, ann)
    });

    // 12. Return PageMeta
    Ok(page_meta)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::bib::cache::BibCache;
    use std::fs;
    use tempfile::TempDir;

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

    // --- build_bib_index caching tests ---

    #[test]
    fn build_bib_index_caches_result() {
        let dir = TempDir::new().unwrap();
        let bib_path = dir.path().join("refs.bib");
        fs::write(&bib_path, sample_bib()).unwrap();

        let cache = BibCache::new();

        // First call populates the index cache
        let index1 = build_bib_index(dir.path(), &cache);
        assert_eq!(index1.len(), 1);
        assert!(index1.contains_key("smith2020"));

        // Delete the .bib file from disk but do NOT mark dirty
        fs::remove_file(&bib_path).unwrap();

        // Second call should return cached result (proves no re-walk)
        let index2 = build_bib_index(dir.path(), &cache);
        assert_eq!(index2.len(), 1, "cached result should be returned even though .bib file is gone");
        assert!(index2.contains_key("smith2020"));
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
        let body = super::build_citation_body(&entry);
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
            tags: vec![],
        };
        let body = super::build_citation_body(&entry);
        assert!(!body.contains("## Abstract"));
        assert!(body.contains("## Notes"));
    }

    #[test]
    fn body_always_has_notes_section() {
        let entry = sample_citation_entry();
        let body = super::build_citation_body(&entry);
        assert!(body.ends_with("## Notes\n"));
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
        let body = build_citation_body(&entry);
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

    // --- lookup_bib_entry tests ---

    #[test]
    fn lookup_bib_entry_cold_cache_fallback() {
        let dir = TempDir::new().unwrap();
        fs::write(dir.path().join("refs.bib"), sample_bib()).unwrap();
        let cache = BibCache::new();

        // Cache is cold -- lookup should fall back to build_bib_index
        let result = lookup_bib_entry(dir.path(), &cache, "smith2020");
        assert!(result.is_some(), "cold-cache fallback must find the entry");
        assert_eq!(result.unwrap().key, "smith2020");

        // After the fallback, the index cache should now be warm
        assert!(cache.get_cached_index().is_some(), "fallback should populate index cache");
    }

    #[test]
    fn lookup_bib_entry_warm_cache_fast_path() {
        let dir = TempDir::new().unwrap();
        fs::write(dir.path().join("refs.bib"), sample_bib()).unwrap();
        let cache = BibCache::new();

        // Warm the cache
        build_bib_index(dir.path(), &cache);

        // Delete the .bib file -- warm cache should still return the entry
        fs::remove_file(dir.path().join("refs.bib")).unwrap();

        let result = lookup_bib_entry(dir.path(), &cache, "smith2020");
        assert!(result.is_some(), "warm cache fast path must return the entry");
        assert_eq!(result.unwrap().key, "smith2020");
    }

    #[test]
    fn lookup_bib_entry_missing_key() {
        let dir = TempDir::new().unwrap();
        fs::write(dir.path().join("refs.bib"), sample_bib()).unwrap();
        let cache = BibCache::new();

        let result = lookup_bib_entry(dir.path(), &cache, "nonexistent");
        assert!(result.is_none(), "missing key should return None");
    }

    #[test]
    fn build_bib_index_re_walks_after_dirty() {
        let dir = TempDir::new().unwrap();
        let bib_path = dir.path().join("refs.bib");
        fs::write(&bib_path, sample_bib()).unwrap();

        let cache = BibCache::new();

        // First call populates the index cache
        let index1 = build_bib_index(dir.path(), &cache);
        assert_eq!(index1.len(), 1);

        // Delete the .bib file from disk, then mark dirty
        fs::remove_file(&bib_path).unwrap();
        cache.mark_index_dirty();

        // Now build_bib_index should re-walk and find nothing
        let index2 = build_bib_index(dir.path(), &cache);
        assert!(index2.is_empty(), "after mark_index_dirty and file deletion, index should be empty");
    }
}
