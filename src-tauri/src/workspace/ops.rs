use super::frontmatter::{parse_frontmatter, serialize_frontmatter};
use super::normalize::{filename_to_page_name, normalize_to_nfc, page_name_to_filename, validate_page_name};
use super::page::{FileType, PageContent, PageMeta};
use super::write_hash::WriteHashRegistry;
use super::WorkspaceError;
use indexmap::IndexMap;
use std::fs;
use std::path::Path;
use std::time::UNIX_EPOCH;

pub fn read_page(root: &Path, relative_path: &str, registry: &WriteHashRegistry) -> Result<PageContent, WorkspaceError> {
    let full_path = root.join(relative_path);
    if !full_path.exists() {
        return Err(WorkspaceError::PageNotFound(relative_path.to_string()));
    }
    let raw = fs::read_to_string(&full_path)?;
    registry.record(&full_path, &raw);
    let parsed = parse_frontmatter(&raw);

    let file_name = full_path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();
    let title = filename_to_page_name(&file_name);

    let metadata = fs::metadata(&full_path)?;
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

    Ok(PageContent {
        meta: PageMeta {
            title,
            relative_path: normalize_to_nfc(relative_path),
            frontmatter: parsed.map,
            created_at,
            modified_at,
            file_type: FileType::Markdown,
        },
        body: parsed.body.to_string(),
        raw_yaml: parsed.raw_yaml,
    })
}

pub fn write_page(
    root: &Path,
    relative_path: &str,
    body: &str,
    frontmatter: &IndexMap<String, serde_yaml::Value>,
    registry: &WriteHashRegistry,
) -> Result<(), WorkspaceError> {
    let full_path = root.join(relative_path);
    if let Some(parent) = full_path.parent() {
        fs::create_dir_all(parent)?;
    }
    let content = serialize_frontmatter(frontmatter, body);
    fs::write(&full_path, &content)?;
    registry.record(&full_path, &content);
    Ok(())
}

pub fn create_page(
    root: &Path,
    name: &str,
    parent_dir: Option<&str>,
) -> Result<PageMeta, WorkspaceError> {
    validate_page_name(name)?;
    let filename = page_name_to_filename(name);
    let relative_path = match parent_dir {
        Some(dir) => format!("{dir}/{filename}"),
        None => filename,
    };

    let full_path = root.join(&relative_path);
    if full_path.exists() {
        return Err(WorkspaceError::PageAlreadyExists(relative_path));
    }
    if let Some(parent) = full_path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(&full_path, "")?;

    let metadata = fs::metadata(&full_path)?;
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

    Ok(PageMeta {
        title: name.to_string(),
        relative_path: normalize_to_nfc(&relative_path),
        frontmatter: IndexMap::new(),
        created_at,
        modified_at,
        file_type: FileType::Markdown,
    })
}

pub fn rename_page(
    root: &Path,
    old_path: &str,
    new_name: &str,
) -> Result<String, WorkspaceError> {
    validate_page_name(new_name)?;
    let old_full = root.join(old_path);
    if !old_full.exists() {
        return Err(WorkspaceError::PageNotFound(old_path.to_string()));
    }

    let new_filename = page_name_to_filename(new_name);
    let new_relative = match Path::new(old_path).parent() {
        Some(parent) if parent != Path::new("") => {
            format!("{}/{new_filename}", parent.to_string_lossy())
        }
        _ => new_filename,
    };

    let new_full = root.join(&new_relative);
    if new_full.exists() {
        return Err(WorkspaceError::PageAlreadyExists(new_relative));
    }

    if let Some(parent) = new_full.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::rename(&old_full, &new_full)?;
    Ok(normalize_to_nfc(&new_relative))
}

pub fn acknowledge_file_hash(root: &Path, relative_path: &str, registry: &WriteHashRegistry) -> Result<(), WorkspaceError> {
    let full_path = root.join(relative_path);
    if !full_path.exists() {
        return Err(WorkspaceError::PageNotFound(relative_path.to_string()));
    }
    let raw = fs::read_to_string(&full_path)?;
    registry.record(&full_path, &raw);
    Ok(())
}

pub fn delete_page(root: &Path, relative_path: &str) -> Result<(), WorkspaceError> {
    let full_path = root.join(relative_path);
    if !full_path.exists() {
        return Err(WorkspaceError::PageNotFound(relative_path.to_string()));
    }
    fs::remove_file(&full_path)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::workspace::frontmatter::serialize_frontmatter;
    use tempfile::TempDir;

    #[test]
    fn read_page_with_frontmatter() {
        let dir = TempDir::new().unwrap();
        let registry = WriteHashRegistry::new();
        fs::write(
            dir.path().join("test.md"),
            "---\ntitle: Hello\n---\n# Content\n",
        )
        .unwrap();

        let page = read_page(dir.path(), "test.md", &registry).unwrap();
        assert_eq!(page.meta.title, "test");
        assert_eq!(page.body, "# Content\n");
        assert!(page.meta.frontmatter.contains_key("title"));
    }

    #[test]
    fn read_page_without_frontmatter() {
        let dir = TempDir::new().unwrap();
        let registry = WriteHashRegistry::new();
        fs::write(dir.path().join("plain.md"), "# Just markdown\n").unwrap();

        let page = read_page(dir.path(), "plain.md", &registry).unwrap();
        assert!(page.meta.frontmatter.is_empty());
        assert_eq!(page.body, "# Just markdown\n");
    }

    #[test]
    fn read_nonexistent_page() {
        let dir = TempDir::new().unwrap();
        let registry = WriteHashRegistry::new();
        let result = read_page(dir.path(), "nope.md", &registry);
        assert!(result.is_err());
    }

    #[test]
    fn read_page_records_hash() {
        let dir = TempDir::new().unwrap();
        let registry = WriteHashRegistry::new();
        let content = "---\ntitle: Hello\n---\n# Content\n";
        fs::write(dir.path().join("test.md"), content).unwrap();

        read_page(dir.path(), "test.md", &registry).unwrap();

        let full_path = dir.path().join("test.md");
        assert!(registry.check(&full_path, content));
    }

    #[test]
    fn write_page_with_frontmatter() {
        let dir = TempDir::new().unwrap();
        let registry = WriteHashRegistry::new();
        let mut fm = IndexMap::new();
        fm.insert(
            "title".to_string(),
            serde_yaml::Value::String("Test".to_string()),
        );

        write_page(dir.path(), "output.md", "# Body\n", &fm, &registry).unwrap();

        let content = fs::read_to_string(dir.path().join("output.md")).unwrap();
        assert!(content.contains("---"));
        assert!(content.contains("title: Test"));
        assert!(content.contains("# Body"));
    }

    #[test]
    fn write_page_without_frontmatter() {
        let dir = TempDir::new().unwrap();
        let registry = WriteHashRegistry::new();
        write_page(dir.path(), "plain.md", "# Body\n", &IndexMap::new(), &registry).unwrap();

        let content = fs::read_to_string(dir.path().join("plain.md")).unwrap();
        assert!(!content.contains("---"));
        assert_eq!(content, "# Body\n");
    }

    #[test]
    fn write_page_records_hash() {
        let dir = TempDir::new().unwrap();
        let registry = WriteHashRegistry::new();
        let mut fm = IndexMap::new();
        fm.insert(
            "title".to_string(),
            serde_yaml::Value::String("T".to_string()),
        );
        let body = "content\n";

        write_page(dir.path(), "hashed.md", body, &fm, &registry).unwrap();

        let expected_content = serialize_frontmatter(&fm, body);
        let full_path = dir.path().join("hashed.md");
        assert!(registry.check(&full_path, &expected_content));
    }

    #[test]
    fn create_page_basic() {
        let dir = TempDir::new().unwrap();
        let meta = create_page(dir.path(), "New Page", None).unwrap();
        assert_eq!(meta.title, "New Page");
        assert_eq!(meta.relative_path, "New Page.md");
        assert!(dir.path().join("New Page.md").exists());
    }

    #[test]
    fn create_page_in_subdirectory() {
        let dir = TempDir::new().unwrap();
        let meta = create_page(dir.path(), "Entry", Some("journal")).unwrap();
        assert_eq!(meta.relative_path, "journal/Entry.md");
        assert!(dir.path().join("journal/Entry.md").exists());
    }

    #[test]
    fn create_duplicate_page() {
        let dir = TempDir::new().unwrap();
        create_page(dir.path(), "Dupe", None).unwrap();
        let result = create_page(dir.path(), "Dupe", None);
        assert!(result.is_err());
    }

    #[test]
    fn create_page_forbidden_chars() {
        let dir = TempDir::new().unwrap();
        let result = create_page(dir.path(), "bad/name", None);
        assert!(result.is_err());
    }

    #[test]
    fn rename_page_success() {
        let dir = TempDir::new().unwrap();
        fs::write(dir.path().join("old.md"), "content").unwrap();

        let new_path = rename_page(dir.path(), "old.md", "new").unwrap();
        assert_eq!(new_path, "new.md");
        assert!(!dir.path().join("old.md").exists());
        assert!(dir.path().join("new.md").exists());
        assert_eq!(
            fs::read_to_string(dir.path().join("new.md")).unwrap(),
            "content"
        );
    }

    #[test]
    fn rename_to_existing() {
        let dir = TempDir::new().unwrap();
        fs::write(dir.path().join("a.md"), "a").unwrap();
        fs::write(dir.path().join("b.md"), "b").unwrap();

        let result = rename_page(dir.path(), "a.md", "b");
        assert!(result.is_err());
    }

    #[test]
    fn delete_page_success() {
        let dir = TempDir::new().unwrap();
        fs::write(dir.path().join("doomed.md"), "bye").unwrap();

        delete_page(dir.path(), "doomed.md").unwrap();
        assert!(!dir.path().join("doomed.md").exists());
    }

    #[test]
    fn delete_nonexistent_page() {
        let dir = TempDir::new().unwrap();
        let result = delete_page(dir.path(), "nope.md");
        assert!(result.is_err());
    }

    #[test]
    fn acknowledge_records_current_disk_hash() {
        let dir = TempDir::new().unwrap();
        let registry = WriteHashRegistry::new();
        let content = "# Acknowledged\n";
        fs::write(dir.path().join("ack.md"), content).unwrap();

        acknowledge_file_hash(dir.path(), "ack.md", &registry).unwrap();

        let full_path = dir.path().join("ack.md");
        assert!(registry.check(&full_path, content));
    }

    #[test]
    fn acknowledge_nonexistent_file_errors() {
        let dir = TempDir::new().unwrap();
        let registry = WriteHashRegistry::new();
        let result = acknowledge_file_hash(dir.path(), "missing.md", &registry);
        assert!(result.is_err());
    }

    #[test]
    fn create_and_read_page_with_emoji_title() {
        let dir = TempDir::new().unwrap();
        let registry = WriteHashRegistry::new();
        let meta = create_page(dir.path(), "🚀 Launch", None).unwrap();
        assert_eq!(meta.title, "🚀 Launch");
        assert_eq!(meta.relative_path, "🚀 Launch.md");
        assert!(dir.path().join("🚀 Launch.md").exists());

        let page = read_page(dir.path(), "🚀 Launch.md", &registry).unwrap();
        assert_eq!(page.meta.title, "🚀 Launch");
    }
}
