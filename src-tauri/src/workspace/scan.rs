use super::normalize::{filename_to_page_name, normalize_to_nfc};
use super::page::PageMeta;
use super::WorkspaceError;
use std::collections::HashMap;
use std::path::Path;
use std::time::UNIX_EPOCH;
use walkdir::WalkDir;

pub fn scan_pages(root: &Path) -> Result<Vec<PageMeta>, WorkspaceError> {
    let mut pages = Vec::new();

    for entry in WalkDir::new(root)
        .into_iter()
        .filter_entry(|e| !is_hidden(e))
    {
        let entry = entry.map_err(|e| WorkspaceError::IoError(e.to_string()))?;
        if !entry.file_type().is_file() {
            continue;
        }

        let path = entry.path();
        let extension = path.extension().and_then(|e| e.to_str());
        if extension != Some("md") {
            continue;
        }

        let relative = path
            .strip_prefix(root)
            .map_err(|e| WorkspaceError::IoError(e.to_string()))?;
        let relative_str = normalize_to_nfc(&relative.to_string_lossy());

        let file_name = path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();
        let title = filename_to_page_name(&file_name);

        let metadata = entry.metadata().map_err(|e| WorkspaceError::IoError(e.to_string()))?;
        let created_at = metadata
            .created()
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as u64);
        let modified_at = metadata
            .modified()
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as u64);

        pages.push(PageMeta {
            title,
            relative_path: relative_str,
            frontmatter: HashMap::new(),
            created_at,
            modified_at,
        });
    }

    pages.sort_by(|a, b| a.relative_path.cmp(&b.relative_path));
    Ok(pages)
}

fn is_hidden(entry: &walkdir::DirEntry) -> bool {
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

    #[test]
    fn empty_directory() {
        let dir = TempDir::new().unwrap();
        let pages = scan_pages(dir.path()).unwrap();
        assert!(pages.is_empty());
    }

    #[test]
    fn finds_md_files() {
        let dir = TempDir::new().unwrap();
        fs::write(dir.path().join("Page One.md"), "# One").unwrap();
        fs::write(dir.path().join("Page Two.md"), "# Two").unwrap();
        fs::write(dir.path().join("Page Three.md"), "# Three").unwrap();

        let pages = scan_pages(dir.path()).unwrap();
        assert_eq!(pages.len(), 3);
        let titles: Vec<&str> = pages.iter().map(|p| p.title.as_str()).collect();
        assert!(titles.contains(&"Page One"));
        assert!(titles.contains(&"Page Two"));
        assert!(titles.contains(&"Page Three"));
    }

    #[test]
    fn subdirectory_relative_paths() {
        let dir = TempDir::new().unwrap();
        let sub = dir.path().join("journal");
        fs::create_dir(&sub).unwrap();
        fs::write(sub.join("2026-04-20.md"), "entry").unwrap();

        let pages = scan_pages(dir.path()).unwrap();
        assert_eq!(pages.len(), 1);
        assert_eq!(pages[0].relative_path, "journal/2026-04-20.md");
        assert_eq!(pages[0].title, "2026-04-20");
    }

    #[test]
    fn non_md_files_ignored() {
        let dir = TempDir::new().unwrap();
        fs::write(dir.path().join("readme.txt"), "text").unwrap();
        fs::write(dir.path().join("image.png"), "data").unwrap();
        fs::write(dir.path().join("page.md"), "# page").unwrap();

        let pages = scan_pages(dir.path()).unwrap();
        assert_eq!(pages.len(), 1);
        assert_eq!(pages[0].title, "page");
    }

    #[test]
    fn hidden_files_and_dirs_ignored() {
        let dir = TempDir::new().unwrap();
        fs::write(dir.path().join(".hidden.md"), "hidden").unwrap();
        let obsidian = dir.path().join(".obsidian");
        fs::create_dir(&obsidian).unwrap();
        fs::write(obsidian.join("config.md"), "config").unwrap();
        fs::write(dir.path().join("visible.md"), "visible").unwrap();

        let pages = scan_pages(dir.path()).unwrap();
        assert_eq!(pages.len(), 1);
        assert_eq!(pages[0].title, "visible");
    }

    #[test]
    fn timestamps_populated() {
        let dir = TempDir::new().unwrap();
        fs::write(dir.path().join("page.md"), "content").unwrap();

        let pages = scan_pages(dir.path()).unwrap();
        assert_eq!(pages.len(), 1);
        assert!(pages[0].created_at.is_some());
        assert!(pages[0].modified_at.is_some());
    }

    #[test]
    fn sorted_by_relative_path() {
        let dir = TempDir::new().unwrap();
        fs::write(dir.path().join("c.md"), "").unwrap();
        fs::write(dir.path().join("a.md"), "").unwrap();
        fs::write(dir.path().join("b.md"), "").unwrap();

        let pages = scan_pages(dir.path()).unwrap();
        let paths: Vec<&str> = pages.iter().map(|p| p.relative_path.as_str()).collect();
        assert_eq!(paths, vec!["a.md", "b.md", "c.md"]);
    }
}
