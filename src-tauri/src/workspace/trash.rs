use crate::workspace::normalize::validate_within_root;
use crate::workspace::WorkspaceError;
use serde::{Deserialize, Serialize};
use std::fs;
use std::fs::OpenOptions;
use std::io::Write;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TrashEntry {
    pub trash_name: String,
    pub original_path: String,
    pub deleted_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TrashManifest {
    pub version: u32,
    pub entries: Vec<TrashEntry>,
}

impl TrashManifest {
    pub fn new() -> Self {
        Self {
            version: 1,
            entries: Vec::new(),
        }
    }
}

pub fn read_manifest(root: &Path) -> Result<TrashManifest, WorkspaceError> {
    let manifest_path = root.join(".trash").join("manifest.json");
    if !manifest_path.exists() {
        return Ok(TrashManifest::new());
    }
    let data = fs::read_to_string(&manifest_path)?;
    serde_json::from_str(&data).map_err(|e| WorkspaceError::ParseError(e.to_string()))
}

pub fn write_manifest(root: &Path, manifest: &TrashManifest) -> Result<(), WorkspaceError> {
    let trash_dir = root.join(".trash");
    fs::create_dir_all(&trash_dir)?;
    let tmp_path = trash_dir.join("manifest.json.tmp");
    let manifest_path = trash_dir.join("manifest.json");
    let json = serde_json::to_string_pretty(manifest)
        .map_err(|e| WorkspaceError::ParseError(e.to_string()))?;
    fs::write(&tmp_path, json)?;
    fs::rename(&tmp_path, &manifest_path)?;
    Ok(())
}

pub fn make_trash_name(relative_path: &str, timestamp: u64) -> String {
    let sanitized = relative_path.replace(['/', '\\'], "__");
    let path = Path::new(&sanitized);
    let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or(&sanitized);
    match path.extension().and_then(|e| e.to_str()) {
        Some(ext) => format!("{stem}.{timestamp}.{ext}"),
        None => format!("{stem}.{timestamp}"),
    }
}

fn now_timestamp() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs()
}

fn ensure_trash_gitignored(root: &Path) {
    if !root.join(".git").is_dir() {
        return;
    }
    let gitignore_path = root.join(".gitignore");
    let content = fs::read_to_string(&gitignore_path).unwrap_or_default();
    if content.lines().any(|line| line.trim() == ".trash/") {
        return;
    }
    if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(&gitignore_path) {
        if !content.is_empty() && !content.ends_with('\n') {
            let _ = writeln!(f);
        }
        let _ = writeln!(f, ".trash/");
    }
}

pub fn trash_page(root: &Path, relative_path: &str) -> Result<TrashEntry, WorkspaceError> {
    validate_within_root(root, relative_path)?;
    let full_path = root.join(relative_path);
    if !full_path.exists() {
        return Err(WorkspaceError::PageNotFound(relative_path.to_string()));
    }

    let mut manifest = read_manifest(root)?;
    let mut ts = now_timestamp();

    let mut trash_name = make_trash_name(relative_path, ts);
    while manifest.entries.iter().any(|e| e.trash_name == trash_name) {
        ts += 1;
        trash_name = make_trash_name(relative_path, ts);
    }

    let trash_dir = root.join(".trash");
    fs::create_dir_all(&trash_dir)?;
    fs::rename(&full_path, trash_dir.join(&trash_name))?;

    let entry = TrashEntry {
        trash_name,
        original_path: relative_path.to_string(),
        deleted_at: ts,
    };
    manifest.entries.push(entry.clone());
    write_manifest(root, &manifest)?;

    ensure_trash_gitignored(root);

    Ok(entry)
}

pub fn list_trash(root: &Path) -> Result<Vec<TrashEntry>, WorkspaceError> {
    let manifest = read_manifest(root)?;
    Ok(manifest.entries)
}

pub fn restore_page(root: &Path, trash_name: &str) -> Result<String, WorkspaceError> {
    let mut manifest = read_manifest(root)?;
    let idx = manifest
        .entries
        .iter()
        .position(|e| e.trash_name == trash_name)
        .ok_or_else(|| WorkspaceError::TrashEntryNotFound(trash_name.to_string()))?;

    let entry = &manifest.entries[idx];
    let original = &entry.original_path;
    validate_within_root(root, original)?;
    let dest = root.join(original);

    if dest.exists() {
        return Err(WorkspaceError::RestoreConflict(original.clone()));
    }

    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent)?;
    }

    let trash_file = root.join(".trash").join(trash_name);
    fs::rename(&trash_file, &dest)?;

    let original_path = entry.original_path.clone();
    manifest.entries.remove(idx);
    write_manifest(root, &manifest)?;

    Ok(original_path)
}

pub fn purge_page(root: &Path, trash_name: &str) -> Result<(), WorkspaceError> {
    let mut manifest = read_manifest(root)?;
    let idx = manifest
        .entries
        .iter()
        .position(|e| e.trash_name == trash_name)
        .ok_or_else(|| WorkspaceError::TrashEntryNotFound(trash_name.to_string()))?;

    let trash_file = root.join(".trash").join(trash_name);
    if trash_file.exists() {
        fs::remove_file(&trash_file)?;
    }

    manifest.entries.remove(idx);
    write_manifest(root, &manifest)?;
    Ok(())
}

pub fn empty_trash(root: &Path) -> Result<(), WorkspaceError> {
    let manifest = read_manifest(root)?;
    let trash_dir = root.join(".trash");

    let mut failed: Vec<TrashEntry> = Vec::new();
    let mut errors: Vec<String> = Vec::new();

    for entry in manifest.entries {
        let path = trash_dir.join(&entry.trash_name);
        if !path.exists() {
            continue;
        }
        match fs::remove_file(&path) {
            Ok(()) => {}
            Err(e) => {
                errors.push(format!("{}: {e}", entry.trash_name));
                failed.push(entry);
            }
        }
    }

    let remaining = TrashManifest {
        version: manifest.version,
        entries: failed,
    };
    write_manifest(root, &remaining)?;

    if errors.is_empty() {
        Ok(())
    } else {
        Err(WorkspaceError::IoError(format!(
            "failed to delete {} item(s): {}",
            errors.len(),
            errors.join("; ")
        )))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    // Cycle 1: Manifest types + serialization

    #[test]
    fn empty_manifest_json() {
        let m = TrashManifest::new();
        let json = serde_json::to_string(&m).unwrap();
        assert!(json.contains("\"version\":1"));
        assert!(json.contains("\"entries\":[]"));
    }

    #[test]
    fn manifest_round_trip() {
        let m = TrashManifest {
            version: 1,
            entries: vec![TrashEntry {
                trash_name: "foo.123.md".into(),
                original_path: "foo.md".into(),
                deleted_at: 123,
            }],
        };
        let json = serde_json::to_string(&m).unwrap();
        let m2: TrashManifest = serde_json::from_str(&json).unwrap();
        assert_eq!(m, m2);
    }

    #[test]
    fn trash_entry_clone() {
        let e = TrashEntry {
            trash_name: "a.1.md".into(),
            original_path: "a.md".into(),
            deleted_at: 1,
        };
        let e2 = e.clone();
        assert_eq!(e, e2);
    }

    // Cycle 2: Manifest read/write helpers

    #[test]
    fn read_manifest_no_trash_dir() {
        let dir = TempDir::new().unwrap();
        let m = read_manifest(dir.path()).unwrap();
        assert_eq!(m, TrashManifest::new());
    }

    #[test]
    fn read_write_manifest_round_trip() {
        let dir = TempDir::new().unwrap();
        let m = TrashManifest {
            version: 1,
            entries: vec![TrashEntry {
                trash_name: "x.1.md".into(),
                original_path: "x.md".into(),
                deleted_at: 1,
            }],
        };
        write_manifest(dir.path(), &m).unwrap();
        let m2 = read_manifest(dir.path()).unwrap();
        assert_eq!(m, m2);
    }

    #[test]
    fn write_manifest_creates_dir() {
        let dir = TempDir::new().unwrap();
        let m = TrashManifest::new();
        write_manifest(dir.path(), &m).unwrap();
        assert!(dir.path().join(".trash").is_dir());
    }

    #[test]
    fn read_manifest_missing_file_existing_dir() {
        let dir = TempDir::new().unwrap();
        fs::create_dir_all(dir.path().join(".trash")).unwrap();
        let m = read_manifest(dir.path()).unwrap();
        assert_eq!(m, TrashManifest::new());
    }

    // Cycle 3: Trash name generation

    #[test]
    fn trash_name_root_file() {
        assert_eq!(make_trash_name("foo.md", 100), "foo.100.md");
    }

    #[test]
    fn trash_name_nested_file() {
        assert_eq!(
            make_trash_name("notes/foo.md", 200),
            "notes__foo.200.md"
        );
    }

    #[test]
    fn trash_name_pdf_extension() {
        assert_eq!(make_trash_name("doc.pdf", 300), "doc.300.pdf");
    }

    #[test]
    fn trash_name_no_extension() {
        assert_eq!(make_trash_name("README", 400), "README.400");
    }

    // Cycle 4: trash_page operation

    #[test]
    fn trash_page_moves_file() {
        let dir = TempDir::new().unwrap();
        fs::write(dir.path().join("hello.md"), "content").unwrap();

        let entry = trash_page(dir.path(), "hello.md").unwrap();
        assert!(!dir.path().join("hello.md").exists());
        assert!(dir.path().join(".trash").join(&entry.trash_name).exists());
        assert_eq!(entry.original_path, "hello.md");
    }

    #[test]
    fn trash_page_nonexistent_errors() {
        let dir = TempDir::new().unwrap();
        let result = trash_page(dir.path(), "nope.md");
        assert!(result.is_err());
    }

    #[test]
    fn trash_page_nested_file() {
        let dir = TempDir::new().unwrap();
        fs::create_dir_all(dir.path().join("sub")).unwrap();
        fs::write(dir.path().join("sub/note.md"), "hi").unwrap();

        let entry = trash_page(dir.path(), "sub/note.md").unwrap();
        assert!(!dir.path().join("sub/note.md").exists());
        assert!(entry.trash_name.contains("sub__note"));
    }

    #[test]
    fn trash_page_returns_entry() {
        let dir = TempDir::new().unwrap();
        fs::write(dir.path().join("a.md"), "").unwrap();

        let entry = trash_page(dir.path(), "a.md").unwrap();
        assert_eq!(entry.original_path, "a.md");
        assert!(entry.deleted_at > 0);
    }

    #[test]
    fn trash_page_collision_unique_names() {
        let dir = TempDir::new().unwrap();
        fs::write(dir.path().join("a.md"), "v1").unwrap();
        let e1 = trash_page(dir.path(), "a.md").unwrap();

        fs::write(dir.path().join("a.md"), "v2").unwrap();
        let e2 = trash_page(dir.path(), "a.md").unwrap();

        assert_ne!(e1.trash_name, e2.trash_name);
    }

    // Cycle 5: list_trash operation

    #[test]
    fn list_trash_empty_workspace() {
        let dir = TempDir::new().unwrap();
        let items = list_trash(dir.path()).unwrap();
        assert!(items.is_empty());
    }

    #[test]
    fn list_trash_after_trashing_files() {
        let dir = TempDir::new().unwrap();
        fs::write(dir.path().join("a.md"), "").unwrap();
        fs::write(dir.path().join("b.md"), "").unwrap();
        trash_page(dir.path(), "a.md").unwrap();
        trash_page(dir.path(), "b.md").unwrap();

        let items = list_trash(dir.path()).unwrap();
        assert_eq!(items.len(), 2);
    }

    // Cycle 6: restore_page operation

    #[test]
    fn restore_page_moves_back() {
        let dir = TempDir::new().unwrap();
        fs::write(dir.path().join("hello.md"), "content").unwrap();
        let entry = trash_page(dir.path(), "hello.md").unwrap();

        let original = restore_page(dir.path(), &entry.trash_name).unwrap();
        assert_eq!(original, "hello.md");
        assert!(dir.path().join("hello.md").exists());
        assert_eq!(fs::read_to_string(dir.path().join("hello.md")).unwrap(), "content");
    }

    #[test]
    fn restore_page_recreates_parent_dir() {
        let dir = TempDir::new().unwrap();
        fs::create_dir_all(dir.path().join("sub")).unwrap();
        fs::write(dir.path().join("sub/note.md"), "hi").unwrap();
        let entry = trash_page(dir.path(), "sub/note.md").unwrap();
        fs::remove_dir(dir.path().join("sub")).unwrap();

        restore_page(dir.path(), &entry.trash_name).unwrap();
        assert!(dir.path().join("sub/note.md").exists());
    }

    #[test]
    fn restore_page_conflict_error() {
        let dir = TempDir::new().unwrap();
        fs::write(dir.path().join("hello.md"), "v1").unwrap();
        let entry = trash_page(dir.path(), "hello.md").unwrap();
        fs::write(dir.path().join("hello.md"), "v2").unwrap();

        let result = restore_page(dir.path(), &entry.trash_name);
        assert!(result.is_err());
    }

    #[test]
    fn restore_page_unknown_trash_name() {
        let dir = TempDir::new().unwrap();
        let result = restore_page(dir.path(), "nonexistent.123.md");
        assert!(result.is_err());
    }

    // Cycle 7: purge_page and empty_trash

    #[test]
    fn purge_removes_file() {
        let dir = TempDir::new().unwrap();
        fs::write(dir.path().join("a.md"), "").unwrap();
        let entry = trash_page(dir.path(), "a.md").unwrap();

        purge_page(dir.path(), &entry.trash_name).unwrap();
        assert!(!dir.path().join(".trash").join(&entry.trash_name).exists());
        assert!(list_trash(dir.path()).unwrap().is_empty());
    }

    #[test]
    fn purge_unknown_errors() {
        let dir = TempDir::new().unwrap();
        let result = purge_page(dir.path(), "nope.123.md");
        assert!(result.is_err());
    }

    #[test]
    fn empty_trash_removes_all() {
        let dir = TempDir::new().unwrap();
        fs::write(dir.path().join("a.md"), "").unwrap();
        fs::write(dir.path().join("b.md"), "").unwrap();
        let e1 = trash_page(dir.path(), "a.md").unwrap();
        let e2 = trash_page(dir.path(), "b.md").unwrap();

        empty_trash(dir.path()).unwrap();
        assert!(!dir.path().join(".trash").join(&e1.trash_name).exists());
        assert!(!dir.path().join(".trash").join(&e2.trash_name).exists());
        assert!(list_trash(dir.path()).unwrap().is_empty());
    }

    #[test]
    fn empty_trash_on_empty_is_noop() {
        let dir = TempDir::new().unwrap();
        empty_trash(dir.path()).unwrap();
        assert!(list_trash(dir.path()).unwrap().is_empty());
    }

    // Cycle 1.4–1.5: Path traversal guards

    #[test]
    fn trash_page_rejects_path_traversal() {
        let dir = TempDir::new().unwrap();
        let sibling = dir.path().parent().unwrap().join("secret.md");
        fs::write(&sibling, "secret").unwrap();

        let result = trash_page(dir.path(), "../secret.md");
        fs::remove_file(&sibling).ok();
        assert!(
            matches!(result, Err(WorkspaceError::InvalidPath(_))),
            "Expected InvalidPath, got {result:?}"
        );
    }

    #[test]
    fn restore_page_rejects_traversal_in_original_path() {
        let dir = TempDir::new().unwrap();
        let trash_dir = dir.path().join(".trash");
        fs::create_dir_all(&trash_dir).unwrap();
        fs::write(trash_dir.join("evil.123.md"), "pwned").unwrap();

        let manifest = TrashManifest {
            version: 1,
            entries: vec![TrashEntry {
                trash_name: "evil.123.md".into(),
                original_path: "../../../etc/shadow".into(),
                deleted_at: 123,
            }],
        };
        write_manifest(dir.path(), &manifest).unwrap();

        let result = restore_page(dir.path(), "evil.123.md");
        assert!(
            matches!(result, Err(WorkspaceError::InvalidPath(_))),
            "Expected InvalidPath, got {result:?}"
        );
    }

    // Cycle 3: empty_trash partial failure

    #[test]
    fn empty_trash_partial_failure_keeps_failed_entries() {
        let dir = TempDir::new().unwrap();
        let trash_dir = dir.path().join(".trash");
        fs::create_dir_all(&trash_dir).unwrap();

        // Entry 1: normal file (will succeed)
        fs::write(trash_dir.join("a.1.md"), "content a").unwrap();
        // Entry 2: a directory instead of file (fs::remove_file will fail)
        fs::create_dir_all(trash_dir.join("b.2.md")).unwrap();
        // Entry 3: normal file (will succeed)
        fs::write(trash_dir.join("c.3.md"), "content c").unwrap();

        let manifest = TrashManifest {
            version: 1,
            entries: vec![
                TrashEntry { trash_name: "a.1.md".into(), original_path: "a.md".into(), deleted_at: 1 },
                TrashEntry { trash_name: "b.2.md".into(), original_path: "b.md".into(), deleted_at: 2 },
                TrashEntry { trash_name: "c.3.md".into(), original_path: "c.md".into(), deleted_at: 3 },
            ],
        };
        write_manifest(dir.path(), &manifest).unwrap();

        let result = empty_trash(dir.path());
        assert!(result.is_err(), "Should report partial failure");

        // Successfully deleted files should be gone
        assert!(!trash_dir.join("a.1.md").exists());
        assert!(!trash_dir.join("c.3.md").exists());

        // Manifest should only contain the failed entry
        let remaining = read_manifest(dir.path()).unwrap();
        assert_eq!(remaining.entries.len(), 1);
        assert_eq!(remaining.entries[0].trash_name, "b.2.md");
    }

    #[test]
    fn empty_trash_missing_file_treated_as_success() {
        let dir = TempDir::new().unwrap();
        let trash_dir = dir.path().join(".trash");
        fs::create_dir_all(&trash_dir).unwrap();

        // Manifest entry with no corresponding file on disk
        let manifest = TrashManifest {
            version: 1,
            entries: vec![TrashEntry {
                trash_name: "ghost.1.md".into(),
                original_path: "ghost.md".into(),
                deleted_at: 1,
            }],
        };
        write_manifest(dir.path(), &manifest).unwrap();

        let result = empty_trash(dir.path());
        assert!(result.is_ok(), "Missing file should be treated as success, got {result:?}");
        assert!(read_manifest(dir.path()).unwrap().entries.is_empty());
    }

    // Cycle 4: Atomic manifest write

    #[test]
    fn write_manifest_no_tmp_file_remains() {
        let dir = TempDir::new().unwrap();
        let m = TrashManifest {
            version: 1,
            entries: vec![TrashEntry {
                trash_name: "x.1.md".into(),
                original_path: "x.md".into(),
                deleted_at: 1,
            }],
        };
        write_manifest(dir.path(), &m).unwrap();

        assert!(
            !dir.path().join(".trash").join("manifest.json.tmp").exists(),
            "Temp file should not remain after write"
        );
        assert!(dir.path().join(".trash").join("manifest.json").exists());
        let m2 = read_manifest(dir.path()).unwrap();
        assert_eq!(m, m2);
    }

    // Cycle 5: Gitignore management

    #[test]
    fn trash_page_adds_gitignore_in_git_workspace() {
        let dir = TempDir::new().unwrap();
        fs::create_dir_all(dir.path().join(".git")).unwrap();
        fs::write(dir.path().join("a.md"), "content").unwrap();

        trash_page(dir.path(), "a.md").unwrap();

        let gitignore = fs::read_to_string(dir.path().join(".gitignore")).unwrap();
        assert!(
            gitignore.contains(".trash/"),
            ".gitignore should contain .trash/, got: {gitignore}"
        );
    }

    #[test]
    fn trash_page_no_duplicate_gitignore_entry() {
        let dir = TempDir::new().unwrap();
        fs::create_dir_all(dir.path().join(".git")).unwrap();
        fs::write(dir.path().join(".gitignore"), ".trash/\n").unwrap();
        fs::write(dir.path().join("a.md"), "").unwrap();

        trash_page(dir.path(), "a.md").unwrap();

        let content = fs::read_to_string(dir.path().join(".gitignore")).unwrap();
        let count = content.lines().filter(|l| l.trim() == ".trash/").count();
        assert_eq!(count, 1, "Expected .trash/ once, got {count} in: {content}");
    }

    #[test]
    fn trash_page_no_gitignore_without_git() {
        let dir = TempDir::new().unwrap();
        fs::write(dir.path().join("a.md"), "").unwrap();

        trash_page(dir.path(), "a.md").unwrap();

        assert!(
            !dir.path().join(".gitignore").exists(),
            ".gitignore should not be created without .git/"
        );
    }

    #[test]
    fn trash_page_preserves_existing_gitignore() {
        let dir = TempDir::new().unwrap();
        fs::create_dir_all(dir.path().join(".git")).unwrap();
        fs::write(dir.path().join(".gitignore"), "node_modules/\n.DS_Store\n").unwrap();
        fs::write(dir.path().join("a.md"), "").unwrap();

        trash_page(dir.path(), "a.md").unwrap();

        let content = fs::read_to_string(dir.path().join(".gitignore")).unwrap();
        assert!(content.contains("node_modules/"), "Lost node_modules/");
        assert!(content.contains(".DS_Store"), "Lost .DS_Store");
        assert!(content.contains(".trash/"), "Missing .trash/");
    }

    // Cycle 8: Integration with scan

    #[test]
    fn scan_excludes_trashed_files() {
        let dir = TempDir::new().unwrap();
        fs::write(dir.path().join("a.md"), "# A").unwrap();
        fs::write(dir.path().join("b.md"), "# B").unwrap();

        trash_page(dir.path(), "a.md").unwrap();

        let pages = crate::workspace::scan::scan_pages(dir.path()).unwrap();
        let paths: Vec<&str> = pages.iter().map(|p| p.relative_path.as_str()).collect();
        assert!(!paths.contains(&"a.md"));
        assert!(paths.contains(&"b.md"));
    }

    #[test]
    fn scan_includes_restored_files() {
        let dir = TempDir::new().unwrap();
        fs::write(dir.path().join("a.md"), "# A").unwrap();
        let entry = trash_page(dir.path(), "a.md").unwrap();
        restore_page(dir.path(), &entry.trash_name).unwrap();

        let pages = crate::workspace::scan::scan_pages(dir.path()).unwrap();
        let paths: Vec<&str> = pages.iter().map(|p| p.relative_path.as_str()).collect();
        assert!(paths.contains(&"a.md"));
    }
}
