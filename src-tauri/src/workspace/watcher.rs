use super::write_hash::WriteHashRegistry;
use crate::commands::graph::GraphRegistry;
use notify_debouncer_mini::notify::RecursiveMode;
use notify_debouncer_mini::{new_debouncer, DebouncedEventKind};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::{mpsc, Arc};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

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
            while let Ok(result) = rx.recv() {
                let events = match result {
                    Ok(events) => events,
                    Err(_) => continue,
                };

                for event in events {
                    let path = &event.path;
                    if !is_relevant_md_file(path, &root_clone) {
                        continue;
                    }

                    let relative = path
                        .strip_prefix(&root_clone)
                        .unwrap_or(path)
                        .to_string_lossy()
                        .to_string();

                    if let Some(win) = app_handle.get_webview_window(&window_label) {
                        match event.kind {
                            DebouncedEventKind::Any => {
                                let exists = path.exists();
                                if exists {
                                    if !is_external_change(path, &registry) {
                                        eprintln!("[watcher] self-write filtered: {}", relative);
                                        continue;
                                    }
                                    eprintln!("[watcher] file-modified: {}", relative);
                                } else {
                                    eprintln!("[watcher] file-DELETED (exists=false): {}", relative);
                                }
                                let payload = FileEvent { path: relative.clone() };
                                if exists {
                                    let _ = win.emit("workspace://file-modified", &payload);
                                } else {
                                    let _ = win.emit("workspace://file-deleted", &payload);
                                }

                                if let Some(graph_reg) = app_handle.try_state::<std::sync::Arc<GraphRegistry>>() {
                                    let indices = graph_reg.indices.lock().unwrap();
                                    if let Some(gi) = indices.get(&root_clone) {
                                        if exists {
                                            let _ = gi.reindex_file(&relative);
                                        } else {
                                            let _ = gi.remove_file(&relative);
                                        }
                                    }
                                    drop(indices);
                                    let _ = app_handle.emit("lit:graph-updated", ());
                                }
                            }
                            DebouncedEventKind::AnyContinuous | _ => {}
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
    !registry.check_and_clear(path, &content)
}

fn is_relevant_md_file(path: &Path, _root: &Path) -> bool {
    let extension = path.extension().and_then(|e| e.to_str());
    if extension != Some("md") {
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
    fn relevant_md_file_detection() {
        let root = Path::new("/workspace");
        assert!(is_relevant_md_file(Path::new("/workspace/page.md"), root));
        assert!(is_relevant_md_file(
            Path::new("/workspace/sub/page.md"),
            root
        ));
        assert!(!is_relevant_md_file(
            Path::new("/workspace/file.txt"),
            root
        ));
        assert!(!is_relevant_md_file(
            Path::new("/workspace/.hidden.md"),
            root
        ));
        assert!(!is_relevant_md_file(
            Path::new("/workspace/.obsidian/config.md"),
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
    fn hash_consumed_after_check() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("test.md");
        std::fs::write(&path, "hello").unwrap();
        let registry = WriteHashRegistry::new();
        registry.record(&path, "hello");
        assert!(!is_external_change(&path, &registry));
        assert!(is_external_change(&path, &registry));
    }

    #[test]
    fn file_unreadable_returns_external() {
        let registry = WriteHashRegistry::new();
        let path = Path::new("/nonexistent/file.md");
        assert!(is_external_change(path, &registry));
    }
}
