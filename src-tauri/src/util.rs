//! Small shared utilities with no domain ownership.

use std::path::Path;

/// Given `canonical_child` (an already-canonicalized absolute path) and
/// `canonical_root` (an already-canonicalized workspace root), attempt to
/// produce the workspace-relative path as a forward-slash string.
///
/// Returns `Some(relative_path_string)` if `canonical_child` is under
/// `canonical_root`, or `None` if the child escapes the root (e.g. a
/// symlink pointing outside).
///
/// Both arguments MUST already be canonicalized by the caller -- this
/// function does not call `fs::canonicalize`.
pub(crate) fn relative_to_root(canonical_root: &Path, canonical_child: &Path) -> Option<String> {
    canonical_child
        .strip_prefix(canonical_root)
        .ok()
        .map(|rel| rel.to_string_lossy().replace(std::path::MAIN_SEPARATOR, "/"))
}

/// The single shared hidden-path predicate used by every `WalkDir::filter_entry`
/// caller (bib scan, export collection, workspace page scan). The walk root
/// (depth 0) is never treated as hidden; any other entry whose file name begins
/// with `.` is.
pub fn is_hidden(entry: &walkdir::DirEntry) -> bool {
    if entry.depth() == 0 {
        return false;
    }
    entry
        .file_name()
        .to_str()
        .map(|s| s.starts_with('.'))
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;
    use walkdir::WalkDir;

    #[test]
    fn root_dir_is_not_hidden() {
        let dir = TempDir::new().unwrap();
        let mut walk = WalkDir::new(dir.path()).into_iter();
        let root = walk.next().unwrap().unwrap();
        assert_eq!(root.depth(), 0);
        // Even if the temp path component starts with '.', depth-0 is never hidden.
        assert!(!is_hidden(&root));
    }

    #[test]
    fn dotfile_is_hidden() {
        let dir = TempDir::new().unwrap();
        fs::write(dir.path().join(".secret.bib"), "x").unwrap();
        let entry = WalkDir::new(dir.path())
            .into_iter()
            .filter_map(Result::ok)
            .find(|e| e.file_name() == ".secret.bib")
            .unwrap();
        assert!(is_hidden(&entry));
    }

    #[test]
    fn regular_file_not_hidden() {
        let dir = TempDir::new().unwrap();
        fs::write(dir.path().join("visible.md"), "x").unwrap();
        let entry = WalkDir::new(dir.path())
            .into_iter()
            .filter_map(Result::ok)
            .find(|e| e.file_name() == "visible.md")
            .unwrap();
        assert!(!is_hidden(&entry));
    }

    #[test]
    fn dot_directory_is_hidden() {
        let dir = TempDir::new().unwrap();
        fs::create_dir(dir.path().join(".obsidian")).unwrap();
        let entry = WalkDir::new(dir.path())
            .into_iter()
            .filter_map(Result::ok)
            .find(|e| e.file_name() == ".obsidian")
            .unwrap();
        assert!(is_hidden(&entry));
    }

    #[test]
    fn relative_to_root_returns_relative_for_child_under_root() {
        let dir = TempDir::new().unwrap();
        let root = dir.path().canonicalize().unwrap();
        fs::create_dir_all(root.join("assets/pdf")).unwrap();
        fs::write(root.join("assets/pdf/paper.pdf"), "x").unwrap();
        let child = root.join("assets/pdf/paper.pdf").canonicalize().unwrap();
        assert_eq!(
            relative_to_root(&root, &child),
            Some("assets/pdf/paper.pdf".to_string())
        );
    }

    #[test]
    fn relative_to_root_returns_none_when_child_outside_root() {
        let root_dir = TempDir::new().unwrap();
        let other_dir = TempDir::new().unwrap();
        let root = root_dir.path().canonicalize().unwrap();
        fs::write(other_dir.path().join("file.pdf"), "x").unwrap();
        let child = other_dir.path().join("file.pdf").canonicalize().unwrap();
        assert_eq!(relative_to_root(&root, &child), None);
    }

    #[test]
    fn relative_to_root_uses_forward_slashes() {
        let dir = TempDir::new().unwrap();
        let root = dir.path().canonicalize().unwrap();
        fs::create_dir_all(root.join("a/b")).unwrap();
        fs::write(root.join("a/b/c.txt"), "x").unwrap();
        let child = root.join("a/b/c.txt").canonicalize().unwrap();
        let result = relative_to_root(&root, &child).unwrap();
        assert!(!result.contains('\\'), "should use forward slashes: {result}");
        assert_eq!(result, "a/b/c.txt");
    }

    #[test]
    fn relative_to_root_returns_empty_string_for_root_itself() {
        let dir = TempDir::new().unwrap();
        let root = dir.path().canonicalize().unwrap();
        assert_eq!(relative_to_root(&root, &root), Some("".to_string()));
    }
}
