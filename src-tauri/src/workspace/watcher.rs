use super::write_hash::WriteHashRegistry;
use crate::commands::graph::GraphRegistry;
use notify_debouncer_mini::notify::RecursiveMode;
use notify_debouncer_mini::{new_debouncer, DebouncedEventKind};
use serde::Serialize;
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::{mpsc, Arc};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum FileChangeKind {
    Created,
    Modified,
    Deleted,
}

pub fn classify_file_event(
    relative: &str,
    exists: bool,
    known: &mut HashSet<String>,
) -> FileChangeKind {
    if exists {
        if known.insert(relative.to_string()) {
            FileChangeKind::Created
        } else {
            FileChangeKind::Modified
        }
    } else {
        known.remove(relative);
        FileChangeKind::Deleted
    }
}

pub struct FileWatcher {
    _debouncer: notify_debouncer_mini::Debouncer<notify_debouncer_mini::notify::RecommendedWatcher>,
}

#[derive(Clone, Serialize)]
pub struct FileEvent {
    pub path: String,
}

#[derive(Clone, Serialize)]
pub struct FileRenamedEvent {
    pub old_path: String,
    pub new_path: String,
}

fn try_refresh_shadows(app_handle: &AppHandle, root: &PathBuf) {
    if let Some(graph_reg) = app_handle.try_state::<std::sync::Arc<GraphRegistry>>() {
        let indices = graph_reg.indices.lock().unwrap();
        if let Some(gi) = indices.get(root) {
            let gi = Arc::clone(gi);
            drop(indices);
            match gi.refresh_shadows() {
                Ok(true) => {
                    let _ = app_handle.emit("lit:graph-updated", ());
                }
                Ok(false) => {}
                Err(e) => {
                    eprintln!("[watcher] bib shadow refresh failed: {e}");
                }
            }
        } else {
            drop(indices);
        }
    }
}

impl FileWatcher {
    pub fn new(
        root: PathBuf,
        window_label: String,
        app_handle: AppHandle,
        registry: Arc<WriteHashRegistry>,
        initial_paths: HashSet<String>,
    ) -> Result<Self, String> {
        let root_clone = root.clone();

        let (tx, rx) = mpsc::channel();
        let mut debouncer = new_debouncer(Duration::from_millis(500), tx)
            .map_err(|e| format!("Failed to create file watcher: {e}"))?;

        debouncer
            .watcher()
            .watch(&root, RecursiveMode::Recursive)
            .map_err(|e| format!("Failed to watch directory: {e}"))?;

        std::thread::spawn(move || {
            let mut known_files = initial_paths;

            while let Ok(result) = rx.recv() {
                let events = match result {
                    Ok(events) => events,
                    Err(_) => continue,
                };

                let mut classified_events: Vec<(String, FileChangeKind)> = Vec::new();
                let mut md_events: Vec<(String, FileChangeKind)> = Vec::new();
                let mut bib_changed = false;
                let win = app_handle.get_webview_window(&window_label);

                for event in events {
                    let path = &event.path;
                    if !is_relevant_file(path, &root_clone) {
                        continue;
                    }

                    let relative = path
                        .strip_prefix(&root_clone)
                        .unwrap_or(path)
                        .to_string_lossy()
                        .to_string();

                    if let Some(build_state) = app_handle.try_state::<Arc<crate::commands::graph::GraphBuildState>>() {
                        if build_state.is_in_progress(&root_clone) {
                            eprintln!("[watcher] skipping reindex during initial build: {}", relative);
                            continue;
                        }
                    }

                    match event.kind {
                        DebouncedEventKind::Any => {
                            let exists = path.exists();
                            if should_skip_event(path, exists, &registry) {
                                if exists {
                                    eprintln!("[watcher] self-write filtered: {}", relative);
                                } else {
                                    eprintln!("[watcher] self-delete filtered: {}", relative);
                                }
                                continue;
                            }

                            let kind = classify_file_event(&relative, exists, &mut known_files);
                            classified_events.push((relative, kind));
                        }
                        DebouncedEventKind::AnyContinuous | _ => {}
                    }
                }

                // Detect renames: pairs of (Deleted, Created) with same parent + extension
                let renames = detect_renames(&mut classified_events);

                // Emit events for detected renames
                if let Some(ref win) = win {
                    for rename in &renames {
                        eprintln!("[watcher] file-RENAMED: {} -> {}", rename.old_path, rename.new_path);
                        let _ = win.emit("workspace://file-renamed", &FileRenamedEvent {
                            old_path: rename.old_path.clone(),
                            new_path: rename.new_path.clone(),
                        });

                        let ext = Path::new(&rename.new_path).extension().and_then(|e| e.to_str());
                        if ext == Some("md") {
                            md_events.push((rename.old_path.clone(), FileChangeKind::Deleted));
                            md_events.push((rename.new_path.clone(), FileChangeKind::Created));
                        } else if ext == Some("bib") {
                            bib_changed = true;
                        }
                    }

                    // Check for companion rename prompts
                    let prefs = crate::preferences::read_preferences(&app_handle);
                    let search_paths = crate::preferences::companion_search_paths(&prefs);
                    for rename in &renames {
                        if let Some(prompt) = check_companion_for_rename(rename, &root_clone, &search_paths, &renames) {
                            eprintln!(
                                "[watcher] companion-rename-prompt: {} -> {}",
                                prompt.companion_path, prompt.suggested_companion_new_path
                            );
                            let _ = win.emit("workspace://companion-rename-prompt", &prompt);
                        }
                    }
                }

                // Emit remaining (non-rename) events
                for (relative, kind) in &classified_events {
                    if let Some(ref win) = win {
                        let payload = FileEvent { path: relative.clone() };
                        match kind {
                            FileChangeKind::Created => {
                                eprintln!("[watcher] file-CREATED: {}", relative);
                                let _ = win.emit("workspace://file-created", &payload);
                            }
                            FileChangeKind::Modified => {
                                eprintln!("[watcher] file-modified: {}", relative);
                                let _ = win.emit("workspace://file-modified", &payload);
                            }
                            FileChangeKind::Deleted => {
                                eprintln!("[watcher] file-DELETED: {}", relative);
                                let _ = win.emit("workspace://file-deleted", &payload);
                            }
                        }
                    }

                    let ext = Path::new(relative.as_str()).extension().and_then(|e| e.to_str());
                    if ext == Some("md") {
                        md_events.push((relative.clone(), *kind));
                    } else if ext == Some("bib") {
                        bib_changed = true;
                    }
                }

                if !md_events.is_empty() {
                    let refs: Vec<(&str, FileChangeKind)> = md_events.iter().map(|(p, k)| (p.as_str(), *k)).collect();
                    let diff = accumulate_diff(&refs);
                    if diff.is_empty() {
                        if bib_changed {
                            try_refresh_shadows(&app_handle, &root_clone);
                        }
                        continue;
                    }
                    if let Some(graph_reg) = app_handle.try_state::<std::sync::Arc<GraphRegistry>>() {
                        let indices = graph_reg.indices.lock().unwrap();
                        if let Some(gi) = indices.get(&root_clone) {
                            let ann_enabled = crate::preferences::annotations_enabled(&app_handle);
                            let result = gi.batch_reindex(&diff, ann_enabled);
                            drop(indices);
                            crate::commands::graph::emit_reindex_side_effects(&app_handle, &result);
                        } else {
                            drop(indices);
                        }
                    }
                } else if bib_changed {
                    try_refresh_shadows(&app_handle, &root_clone);
                }
            }
        });

        Ok(FileWatcher {
            _debouncer: debouncer,
        })
    }
}

pub fn is_external_change(path: &Path, registry: &WriteHashRegistry) -> bool {
    let content = match std::fs::read_to_string(path) {
        Ok(c) => c,
        Err(_) => return true,
    };
    !registry.check(path, &content)
}

pub fn should_skip_event(path: &Path, exists: bool, registry: &WriteHashRegistry) -> bool {
    if exists {
        !is_external_change(path, registry)
    } else {
        registry.consume_delete(path)
    }
}

pub(crate) fn accumulate_diff(events: &[(&str, FileChangeKind)]) -> crate::graph::indexer::DiffResult {
    use indexmap::IndexMap;

    let mut last_state: IndexMap<&str, FileChangeKind> = IndexMap::new();
    for &(path, kind) in events {
        match (last_state.get(path), kind) {
            (Some(FileChangeKind::Created), FileChangeKind::Modified) => {}
            _ => { last_state.insert(path, kind); }
        }
    }

    let mut new_files = Vec::new();
    let mut changed = Vec::new();
    let mut deleted = Vec::new();
    for (path, kind) in last_state {
        match kind {
            FileChangeKind::Created => new_files.push(path.to_string()),
            FileChangeKind::Modified => changed.push(path.to_string()),
            FileChangeKind::Deleted => deleted.push(path.to_string()),
        }
    }
    new_files.sort();
    changed.sort();
    deleted.sort();

    crate::graph::indexer::DiffResult {
        new: new_files,
        changed,
        deleted,
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct DetectedRename {
    pub old_path: String,
    pub new_path: String,
}

pub fn detect_renames(
    events: &mut Vec<(String, FileChangeKind)>,
) -> Vec<DetectedRename> {
    use std::collections::HashMap;

    // Group deleted/created events by (parent_dir, extension)
    let mut groups: HashMap<(String, String), (Vec<usize>, Vec<usize>)> = HashMap::new();
    for (i, (path, kind)) in events.iter().enumerate() {
        if *kind != FileChangeKind::Deleted && *kind != FileChangeKind::Created {
            continue;
        }
        let p = Path::new(path);
        let parent = p.parent().unwrap_or(Path::new("")).to_string_lossy().to_string();
        let ext = p.extension().and_then(|e| e.to_str()).unwrap_or("").to_string();
        let key = (parent, ext);
        let entry = groups.entry(key).or_insert_with(|| (Vec::new(), Vec::new()));
        match kind {
            FileChangeKind::Deleted => entry.0.push(i),
            FileChangeKind::Created => entry.1.push(i),
            _ => {}
        }
    }

    let mut renames = Vec::new();
    let mut indices_to_remove: Vec<usize> = Vec::new();

    for (_key, (deleted, created)) in &groups {
        if deleted.len() != 1 || created.len() != 1 {
            continue;
        }
        let del_idx = deleted[0];
        let cr_idx = created[0];
        renames.push(DetectedRename {
            old_path: events[del_idx].0.clone(),
            new_path: events[cr_idx].0.clone(),
        });
        indices_to_remove.push(del_idx);
        indices_to_remove.push(cr_idx);
    }

    indices_to_remove.sort_unstable();
    indices_to_remove.dedup();
    for idx in indices_to_remove.into_iter().rev() {
        events.remove(idx);
    }

    renames
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct CompanionRenamePrompt {
    pub renamed_file_old: String,
    pub renamed_file_new: String,
    pub companion_path: String,
    pub suggested_companion_new_path: String,
}

pub fn check_companion_for_rename(
    rename: &DetectedRename,
    root: &Path,
    search_paths: &[String],
    all_renames: &[DetectedRename],
) -> Option<CompanionRenamePrompt> {
    let companion = crate::commands::workspace::find_companion(&rename.old_path, root, search_paths)?;

    // If the companion was also renamed in this batch, skip the prompt
    if all_renames.iter().any(|r| r.old_path == companion) {
        return None;
    }

    // Compute the suggested new path for the companion
    let new_stem = Path::new(&rename.new_path)
        .file_stem()
        .and_then(|s| s.to_str())?;
    let companion_path = Path::new(&companion);
    let companion_ext = companion_path.extension().and_then(|e| e.to_str()).unwrap_or("");
    let new_companion_filename = if companion_ext.is_empty() {
        new_stem.to_string()
    } else {
        format!("{new_stem}.{companion_ext}")
    };
    let suggested = match companion_path.parent() {
        Some(parent) if parent != Path::new("") => {
            format!("{}/{new_companion_filename}", parent.to_string_lossy())
        }
        _ => new_companion_filename,
    };

    Some(CompanionRenamePrompt {
        renamed_file_old: rename.old_path.clone(),
        renamed_file_new: rename.new_path.clone(),
        companion_path: companion,
        suggested_companion_new_path: suggested,
    })
}

/// Source-code file extensions that the app can open and edit.
///
/// This is the single canonical list of code extensions on the Rust side.
/// scan::scan_pages (src/workspace/scan.rs) calls this helper rather than
/// holding its own copy, so the watcher and the scanner can never diverge.
pub(crate) fn is_code_extension(ext: &str) -> bool {
    matches!(
        ext,
        "bib" | "js" | "mjs" | "cjs" | "jsx" | "ts" | "mts" | "cts" | "tsx" | "py" | "rs"
            | "json" | "yaml" | "yml" | "toml" | "html" | "htm" | "css" | "sh" | "bash" | "zsh"
    )
}

fn is_relevant_file(path: &Path, _root: &Path) -> bool {
    let extension = path.extension().and_then(|e| e.to_str());
    let relevant = matches!(extension, Some("md") | Some("pdf"))
        || extension.map(is_code_extension).unwrap_or(false);
    if !relevant {
        return false;
    }

    for component in path.components() {
        if let std::path::Component::Normal(name) = component {
            if name.to_string_lossy().starts_with('.') {
                return false;
            }
        }
    }

    true
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn classify_new_file_returns_created() {
        let mut known = HashSet::new();
        assert_eq!(
            classify_file_event("note.md", true, &mut known),
            FileChangeKind::Created
        );
        assert!(known.contains("note.md"));
    }

    #[test]
    fn classify_known_file_returns_modified() {
        let mut known = HashSet::from(["note.md".to_string()]);
        assert_eq!(
            classify_file_event("note.md", true, &mut known),
            FileChangeKind::Modified
        );
        assert!(known.contains("note.md"));
    }

    #[test]
    fn classify_deleted_known_file_returns_deleted() {
        let mut known = HashSet::from(["note.md".to_string()]);
        assert_eq!(
            classify_file_event("note.md", false, &mut known),
            FileChangeKind::Deleted
        );
        assert!(!known.contains("note.md"));
    }

    #[test]
    fn classify_deleted_unknown_file_returns_deleted() {
        let mut known = HashSet::new();
        assert_eq!(
            classify_file_event("note.md", false, &mut known),
            FileChangeKind::Deleted
        );
    }

    #[test]
    fn classify_lifecycle_create_then_modify() {
        let mut known = HashSet::new();
        assert_eq!(
            classify_file_event("note.md", true, &mut known),
            FileChangeKind::Created
        );
        assert_eq!(
            classify_file_event("note.md", true, &mut known),
            FileChangeKind::Modified
        );
    }

    #[test]
    fn relevant_file_detection() {
        let root = Path::new("/workspace");
        assert!(is_relevant_file(Path::new("/workspace/page.md"), root));
        assert!(is_relevant_file(Path::new("/workspace/sub/page.md"), root));
        assert!(!is_relevant_file(Path::new("/workspace/file.txt"), root));
        assert!(!is_relevant_file(Path::new("/workspace/.hidden.md"), root));
        assert!(!is_relevant_file(
            Path::new("/workspace/.obsidian/config.md"),
            root
        ));
    }

    #[test]
    fn relevant_file_accepts_pdf() {
        let root = Path::new("/workspace");
        assert!(is_relevant_file(Path::new("/workspace/paper.pdf"), root));
        assert!(!is_relevant_file(
            Path::new("/workspace/.hidden.pdf"),
            root
        ));
    }

    #[test]
    fn relevant_file_accepts_code() {
        let root = Path::new("/workspace");
        assert!(is_relevant_file(Path::new("/workspace/refs.bib"), root));
        assert!(is_relevant_file(Path::new("/workspace/main.rs"), root));
        assert!(is_relevant_file(Path::new("/workspace/app.ts"), root));
        assert!(is_relevant_file(Path::new("/workspace/sub/script.py"), root));
        assert!(!is_relevant_file(Path::new("/workspace/.hidden.rs"), root));
        assert!(!is_relevant_file(Path::new("/workspace/notes.txt"), root));
    }

    #[test]
    fn bib_file_is_relevant_but_not_md() {
        let root = Path::new("/workspace");
        let bib_path = Path::new("/workspace/refs.bib");
        assert!(is_relevant_file(bib_path, root));
        let ext = bib_path.extension().and_then(|e| e.to_str());
        assert_ne!(ext, Some("md"), ".bib must not be classified as .md");
        assert_eq!(ext, Some("bib"));
    }

    #[test]
    fn is_code_extension_matches_expected_set() {
        assert!(is_code_extension("bib"));
        assert!(is_code_extension("rs"));
        assert!(is_code_extension("tsx"));
        assert!(!is_code_extension("txt"));
        assert!(!is_code_extension("md"));
        assert!(!is_code_extension("pdf"));
    }

    #[test]
    fn self_write_filtered() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("test.md");
        std::fs::write(&path, "hello").unwrap();
        let registry = WriteHashRegistry::new();
        registry.record(&path, "hello");
        assert!(!is_external_change(&path, &registry));
    }

    #[test]
    fn external_write_detected() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("test.md");
        std::fs::write(&path, "external content").unwrap();
        let registry = WriteHashRegistry::new();
        registry.record(&path, "our content");
        assert!(is_external_change(&path, &registry));
    }

    #[test]
    fn no_record_means_external() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("test.md");
        std::fs::write(&path, "anything").unwrap();
        let registry = WriteHashRegistry::new();
        assert!(is_external_change(&path, &registry));
    }

    #[test]
    fn hash_retained_after_check() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("test.md");
        std::fs::write(&path, "hello").unwrap();
        let registry = WriteHashRegistry::new();
        registry.record(&path, "hello");
        assert!(!is_external_change(&path, &registry));
        assert!(!is_external_change(&path, &registry));
    }

    #[test]
    fn file_unreadable_returns_external() {
        let registry = WriteHashRegistry::new();
        let path = Path::new("/nonexistent/file.md");
        assert!(is_external_change(path, &registry));
    }

    #[test]
    fn should_skip_self_delete() {
        let registry = WriteHashRegistry::new();
        let path = Path::new("/workspace/deleted.md");
        registry.record_delete(path);
        assert!(should_skip_event(path, false, &registry));
    }

    #[test]
    fn should_not_skip_external_delete() {
        let registry = WriteHashRegistry::new();
        let path = Path::new("/workspace/deleted.md");
        assert!(!should_skip_event(path, false, &registry));
    }

    // --- accumulate_diff ---

    #[test]
    fn accumulate_watcher_diff_created_goes_to_new() {
        let diff = accumulate_diff(&[("a.md", FileChangeKind::Created)]);
        assert_eq!(diff.new, vec!["a.md"]);
        assert!(diff.changed.is_empty());
        assert!(diff.deleted.is_empty());
    }

    #[test]
    fn accumulate_watcher_diff_modified_goes_to_changed() {
        let diff = accumulate_diff(&[("a.md", FileChangeKind::Modified)]);
        assert_eq!(diff.changed, vec!["a.md"]);
        assert!(diff.new.is_empty());
        assert!(diff.deleted.is_empty());
    }

    #[test]
    fn accumulate_watcher_diff_mixed_topology() {
        let diff = accumulate_diff(&[
            ("a.md", FileChangeKind::Created),
            ("b.md", FileChangeKind::Deleted),
            ("c.md", FileChangeKind::Modified),
        ]);
        assert_eq!(diff.new, vec!["a.md"]);
        assert_eq!(diff.changed, vec!["c.md"]);
        assert_eq!(diff.deleted, vec!["b.md"]);
    }

    #[test]
    fn accumulate_watcher_diff_created_then_deleted() {
        let diff = accumulate_diff(&[
            ("a.md", FileChangeKind::Created),
            ("a.md", FileChangeKind::Deleted),
        ]);
        assert!(diff.new.is_empty());
        assert_eq!(diff.deleted, vec!["a.md"]);
    }

    #[test]
    fn accumulate_watcher_diff_deleted_then_created() {
        let diff = accumulate_diff(&[
            ("a.md", FileChangeKind::Deleted),
            ("a.md", FileChangeKind::Created),
        ]);
        assert_eq!(diff.new, vec!["a.md"]);
        assert!(diff.deleted.is_empty());
    }

    #[test]
    fn accumulate_watcher_diff_created_then_modified() {
        let diff = accumulate_diff(&[
            ("a.md", FileChangeKind::Created),
            ("a.md", FileChangeKind::Modified),
        ]);
        assert_eq!(diff.new, vec!["a.md"]);
        assert!(diff.changed.is_empty());
    }

    #[test]
    fn accumulate_watcher_diff_created_modified_deleted() {
        let diff = accumulate_diff(&[
            ("a.md", FileChangeKind::Created),
            ("a.md", FileChangeKind::Modified),
            ("a.md", FileChangeKind::Deleted),
        ]);
        assert!(diff.new.is_empty());
        assert!(diff.changed.is_empty());
        assert_eq!(diff.deleted, vec!["a.md"]);
    }

    #[test]
    fn accumulate_watcher_diff_empty() {
        let diff = accumulate_diff(&[]);
        assert!(diff.is_empty());
    }

    #[test]
    fn accumulate_watcher_diff_all_modified_no_topology() {
        let diff = accumulate_diff(&[
            ("a.md", FileChangeKind::Modified),
            ("b.md", FileChangeKind::Modified),
        ]);
        assert!(!diff.is_empty());
        assert_eq!(diff.changed, vec!["a.md", "b.md"]);
    }

    // --- detect_renames ---

    #[test]
    fn detect_renames_simple_pair() {
        let mut events = vec![
            ("paper.md".to_string(), FileChangeKind::Deleted),
            ("notes.md".to_string(), FileChangeKind::Created),
        ];
        let renames = detect_renames(&mut events);
        assert_eq!(renames.len(), 1);
        assert_eq!(renames[0].old_path, "paper.md");
        assert_eq!(renames[0].new_path, "notes.md");
        assert!(events.is_empty());
    }

    #[test]
    fn detect_renames_different_ext_no_pair() {
        let mut events = vec![
            ("paper.md".to_string(), FileChangeKind::Deleted),
            ("notes.pdf".to_string(), FileChangeKind::Created),
        ];
        let renames = detect_renames(&mut events);
        assert!(renames.is_empty());
        assert_eq!(events.len(), 2);
    }

    #[test]
    fn detect_renames_different_parent_no_pair() {
        let mut events = vec![
            ("a/x.md".to_string(), FileChangeKind::Deleted),
            ("b/y.md".to_string(), FileChangeKind::Created),
        ];
        let renames = detect_renames(&mut events);
        assert!(renames.is_empty());
        assert_eq!(events.len(), 2);
    }

    #[test]
    fn detect_renames_multiple_pairs() {
        let mut events = vec![
            ("a.md".to_string(), FileChangeKind::Deleted),
            ("b.md".to_string(), FileChangeKind::Created),
            ("x.pdf".to_string(), FileChangeKind::Deleted),
            ("y.pdf".to_string(), FileChangeKind::Created),
        ];
        let renames = detect_renames(&mut events);
        assert_eq!(renames.len(), 2);
        assert!(events.is_empty());
    }

    #[test]
    fn detect_renames_unpaired_pass_through() {
        let mut events = vec![
            ("a.md".to_string(), FileChangeKind::Modified),
            ("b.md".to_string(), FileChangeKind::Deleted),
            ("c.md".to_string(), FileChangeKind::Created),
        ];
        let renames = detect_renames(&mut events);
        assert_eq!(renames.len(), 1);
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].0, "a.md");
        assert_eq!(events[0].1, FileChangeKind::Modified);
    }

    #[test]
    fn detect_renames_ambiguous_skips() {
        let mut events = vec![
            ("a.md".to_string(), FileChangeKind::Deleted),
            ("b.md".to_string(), FileChangeKind::Deleted),
            ("c.md".to_string(), FileChangeKind::Created),
        ];
        let renames = detect_renames(&mut events);
        assert!(renames.is_empty());
        assert_eq!(events.len(), 3);
    }

    #[test]
    fn detect_renames_empty() {
        let mut events: Vec<(String, FileChangeKind)> = vec![];
        let renames = detect_renames(&mut events);
        assert!(renames.is_empty());
    }

    // --- check_companion_for_rename ---

    #[test]
    fn check_companion_finds_sibling() {
        let dir = TempDir::new().unwrap();
        let root = dir.path();
        std::fs::write(root.join("paper.md"), "x").unwrap();
        std::fs::write(root.join("paper.pdf"), "x").unwrap();

        let rename = DetectedRename {
            old_path: "paper.md".to_string(),
            new_path: "notes.md".to_string(),
        };
        let prompt = check_companion_for_rename(&rename, root, &[], &[]);
        assert!(prompt.is_some());
        let p = prompt.unwrap();
        assert_eq!(p.companion_path, "paper.pdf");
        assert_eq!(p.suggested_companion_new_path, "notes.pdf");
    }

    #[test]
    fn check_companion_no_companion() {
        let dir = TempDir::new().unwrap();
        let root = dir.path();
        std::fs::write(root.join("paper.md"), "x").unwrap();
        // No paper.pdf

        let rename = DetectedRename {
            old_path: "paper.md".to_string(),
            new_path: "notes.md".to_string(),
        };
        let prompt = check_companion_for_rename(&rename, root, &[], &[]);
        assert!(prompt.is_none());
    }

    #[test]
    fn check_companion_already_renamed_in_batch() {
        let dir = TempDir::new().unwrap();
        let root = dir.path();
        std::fs::write(root.join("paper.md"), "x").unwrap();
        std::fs::write(root.join("paper.pdf"), "x").unwrap();

        let rename_md = DetectedRename {
            old_path: "paper.md".to_string(),
            new_path: "notes.md".to_string(),
        };
        let rename_pdf = DetectedRename {
            old_path: "paper.pdf".to_string(),
            new_path: "notes.pdf".to_string(),
        };
        let all = vec![rename_md.clone(), rename_pdf.clone()];
        let prompt = check_companion_for_rename(&rename_md, root, &[], &all);
        assert!(prompt.is_none());
    }

    #[test]
    fn check_companion_via_search_path() {
        let dir = TempDir::new().unwrap();
        let root = dir.path();
        std::fs::create_dir_all(root.join("notes")).unwrap();
        std::fs::create_dir_all(root.join("pdfs")).unwrap();
        std::fs::write(root.join("notes/paper.md"), "x").unwrap();
        std::fs::write(root.join("pdfs/paper.pdf"), "x").unwrap();

        let rename = DetectedRename {
            old_path: "notes/paper.md".to_string(),
            new_path: "notes/lecture.md".to_string(),
        };
        let prompt = check_companion_for_rename(&rename, root, &["pdfs".to_string()], &[]);
        assert!(prompt.is_some());
        let p = prompt.unwrap();
        assert_eq!(p.companion_path, "pdfs/paper.pdf");
        assert_eq!(p.suggested_companion_new_path, "pdfs/lecture.pdf");
    }

    #[test]
    fn check_companion_pdf_renamed_finds_md() {
        let dir = TempDir::new().unwrap();
        let root = dir.path();
        std::fs::write(root.join("paper.md"), "x").unwrap();
        std::fs::write(root.join("paper.pdf"), "x").unwrap();

        let rename = DetectedRename {
            old_path: "paper.pdf".to_string(),
            new_path: "notes.pdf".to_string(),
        };
        let prompt = check_companion_for_rename(&rename, root, &[], &[]);
        assert!(prompt.is_some());
        let p = prompt.unwrap();
        assert_eq!(p.companion_path, "paper.md");
        assert_eq!(p.suggested_companion_new_path, "notes.md");
    }
}
