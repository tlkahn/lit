use crate::workspace::WorkspaceError;
use serde::{Deserialize, Serialize};
use std::fs;
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
    let manifest_path = trash_dir.join("manifest.json");
    let json = serde_json::to_string_pretty(manifest)
        .map_err(|e| WorkspaceError::ParseError(e.to_string()))?;
    fs::write(&manifest_path, json)?;
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

pub fn trash_page(root: &Path, relative_path: &str) -> Result<TrashEntry, WorkspaceError> {
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
    let mut manifest = read_manifest(root)?;
    let trash_dir = root.join(".trash");

    for entry in &manifest.entries {
        let path = trash_dir.join(&entry.trash_name);
        if path.exists() {
            fs::remove_file(&path)?;
        }
    }

    manifest.entries.clear();
    write_manifest(root, &manifest)?;
    Ok(())
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
