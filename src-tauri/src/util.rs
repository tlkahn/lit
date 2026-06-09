//! Small shared utilities with no domain ownership.

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
    use super::is_hidden;
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
}
