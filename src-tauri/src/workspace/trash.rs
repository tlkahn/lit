use crate::workspace::normalize::validate_within_root;
use crate::workspace::WorkspaceError;
use std::path::Path;

/// Move a file to the macOS system trash via `NSFileManager.trashItemAtURL`.
/// The file becomes visible in Finder → Trash and recoverable via "Put Back".
fn system_trash(path: &Path) -> Result<(), WorkspaceError> {
    use objc2_foundation::{NSFileManager, NSString, NSURL};

    let abs = path
        .canonicalize()
        .map_err(|e| WorkspaceError::IoError(e.to_string()))?;
    let path_str = abs
        .to_str()
        .ok_or_else(|| WorkspaceError::IoError("Non-UTF-8 path".into()))?;
    let url = NSURL::fileURLWithPath(&NSString::from_str(path_str));
    let fm = NSFileManager::defaultManager();
    fm.trashItemAtURL_resultingItemURL_error(&url, None)
        .map_err(|e| WorkspaceError::IoError(format!("Failed to trash: {e}")))?;
    Ok(())
}

/// Move the page at `relative_path` to the macOS system trash.
pub fn trash_page(root: &Path, relative_path: &str) -> Result<(), WorkspaceError> {
    validate_within_root(root, relative_path)?;
    let full_path = root.join(relative_path);
    if !full_path.exists() {
        return Err(WorkspaceError::PageNotFound(relative_path.to_string()));
    }
    system_trash(&full_path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    #[test]
    fn trash_page_removes_file() {
        let dir = TempDir::new().unwrap();
        fs::write(dir.path().join("hello.md"), "content").unwrap();

        let result = trash_page(dir.path(), "hello.md");
        assert!(result.is_ok(), "expected Ok, got {result:?}");
        assert!(!dir.path().join("hello.md").exists());
    }

    #[test]
    fn trash_page_nonexistent_errors() {
        let dir = TempDir::new().unwrap();
        let result = trash_page(dir.path(), "nope.md");
        assert!(
            matches!(result, Err(WorkspaceError::PageNotFound(_))),
            "expected PageNotFound, got {result:?}"
        );
    }

    #[test]
    fn trash_page_nested_file() {
        let dir = TempDir::new().unwrap();
        fs::create_dir_all(dir.path().join("sub")).unwrap();
        fs::write(dir.path().join("sub/note.md"), "hi").unwrap();

        let result = trash_page(dir.path(), "sub/note.md");
        assert!(result.is_ok(), "expected Ok, got {result:?}");
        assert!(!dir.path().join("sub/note.md").exists());
    }

    #[test]
    fn trash_page_path_traversal() {
        let dir = TempDir::new().unwrap();
        let sibling = dir.path().parent().unwrap().join("secret.md");
        fs::write(&sibling, "secret").unwrap();

        let result = trash_page(dir.path(), "../secret.md");
        fs::remove_file(&sibling).ok();
        assert!(
            matches!(result, Err(WorkspaceError::InvalidPath(_))),
            "expected InvalidPath, got {result:?}"
        );
    }

    #[test]
    fn trash_page_no_trash_dir() {
        let dir = TempDir::new().unwrap();
        fs::write(dir.path().join("a.md"), "x").unwrap();

        trash_page(dir.path(), "a.md").unwrap();
        assert!(
            !dir.path().join(".trash").exists(),
            "no custom .trash/ dir should be created"
        );
    }
}
