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

                let mut md_events: Vec<(String, FileChangeKind)> = Vec::new();

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

                    if let Some(win) = app_handle.get_webview_window(&window_label) {
                        match event.kind {
                            DebouncedEventKind::Any => {
                                let exists = path.exists();
                                if exists && !is_external_change(path, &registry) {
                                    eprintln!("[watcher] self-write filtered: {}", relative);
                                    continue;
                                }

                                let kind = classify_file_event(&relative, exists, &mut known_files);

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

                                let is_md = path.extension().and_then(|e| e.to_str()) == Some("md");
                                if is_md {
                                    md_events.push((relative, kind));
                                }
                            }
                            DebouncedEventKind::AnyContinuous | _ => {}
                        }
                    }
                }

                if !md_events.is_empty() {
                    let refs: Vec<(&str, FileChangeKind)> = md_events.iter().map(|(p, k)| (p.as_str(), *k)).collect();
                    let diff = accumulate_diff(&refs);
                    if let Some(graph_reg) = app_handle.try_state::<std::sync::Arc<GraphRegistry>>() {
                        let indices = graph_reg.indices.lock().unwrap();
                        if let Some(gi) = indices.get(&root_clone) {
                            let ann_enabled = crate::preferences::annotations_enabled(&app_handle);
                            let result = gi.batch_reindex(&diff, ann_enabled);
                            drop(indices);
                            crate::commands::graph::emit_reindex_result(&app_handle, result);
                        } else {
                            drop(indices);
                        }
                    }
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

pub(crate) fn accumulate_diff(events: &[(&str, FileChangeKind)]) -> crate::graph::indexer::DiffResult {
    use indexmap::IndexMap;

    let mut last_state: IndexMap<&str, FileChangeKind> = IndexMap::new();
    for &(path, kind) in events {
        last_state.insert(path, kind);
    }

    let mut new_files = Vec::new();
    let mut deleted = Vec::new();
    for (path, kind) in last_state {
        match kind {
            FileChangeKind::Created => new_files.push(path.to_string()),
            FileChangeKind::Deleted => deleted.push(path.to_string()),
            FileChangeKind::Modified => {}
        }
    }
    new_files.sort();
    deleted.sort();

    crate::graph::indexer::DiffResult {
        new: new_files,
        changed: vec![],
        deleted,
    }
}

fn is_relevant_file(path: &Path, _root: &Path) -> bool {
    let extension = path.extension().and_then(|e| e.to_str());
    if !matches!(extension, Some("md") | Some("pdf")) {
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

    // --- accumulate_diff ---

    #[test]
    fn accumulate_watcher_diff_created_goes_to_new() {
        let diff = accumulate_diff(&[("a.md", FileChangeKind::Created)]);
        assert_eq!(diff.new, vec!["a.md"]);
        assert!(diff.changed.is_empty());
        assert!(diff.deleted.is_empty());
    }

    #[test]
    fn accumulate_watcher_diff_modified_skipped() {
        let diff = accumulate_diff(&[("a.md", FileChangeKind::Modified)]);
        assert!(diff.is_empty());
    }

    #[test]
    fn accumulate_watcher_diff_mixed_topology() {
        let diff = accumulate_diff(&[
            ("a.md", FileChangeKind::Created),
            ("b.md", FileChangeKind::Deleted),
            ("c.md", FileChangeKind::Modified),
        ]);
        assert_eq!(diff.new, vec!["a.md"]);
        assert!(diff.changed.is_empty());
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
    fn accumulate_watcher_diff_empty() {
        let diff = accumulate_diff(&[]);
        assert!(diff.is_empty());
    }
}
