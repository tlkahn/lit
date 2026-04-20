use notify_debouncer_mini::notify::RecursiveMode;
use notify_debouncer_mini::{new_debouncer, DebouncedEventKind};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

pub struct FileWatcher {
    _debouncer: notify_debouncer_mini::Debouncer<notify_debouncer_mini::notify::RecommendedWatcher>,
}

#[derive(Clone, Serialize)]
pub struct FileEvent {
    pub path: String,
}

impl FileWatcher {
    pub fn new(root: PathBuf, app_handle: AppHandle) -> Result<Self, String> {
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

                    let payload = FileEvent { path: relative };

                    match event.kind {
                        DebouncedEventKind::Any => {
                            if path.exists() {
                                let _ = app_handle.emit("workspace://file-modified", &payload);
                            } else {
                                let _ = app_handle.emit("workspace://file-deleted", &payload);
                            }
                        }
                        DebouncedEventKind::AnyContinuous | _ => {}
                    }
                }
            }
        });

        Ok(FileWatcher {
            _debouncer: debouncer,
        })
    }
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
}
