use super::frontmatter::{parse_frontmatter, serialize_frontmatter};
use super::normalize::{filename_to_page_name, normalize_to_nfc, page_name_to_filename, validate_page_name};
use super::page::{CodeFileContent, FileType, PageContent, PageMeta};
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
            has_companion: false,
        },
        body: parsed.body.to_string(),
        raw_yaml: parsed.raw_yaml,
    })
}

pub fn read_code_file(
    root: &Path,
    relative_path: &str,
    registry: &WriteHashRegistry,
) -> Result<CodeFileContent, WorkspaceError> {
    let full_path = root.join(relative_path);
    if !full_path.exists() {
        return Err(WorkspaceError::PageNotFound(relative_path.to_string()));
    }
    let raw = fs::read_to_string(&full_path)?;
    registry.record(&full_path, &raw);

    let file_name = full_path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();
    let title = filename_to_page_name(&file_name);

    Ok(CodeFileContent {
        title,
        relative_path: normalize_to_nfc(relative_path),
        body: raw,
    })
}

pub fn write_code_file(
    root: &Path,
    relative_path: &str,
    body: &str,
    registry: &WriteHashRegistry,
) -> Result<(), WorkspaceError> {
    let full_path = root.join(relative_path);
    if let Some(parent) = full_path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(&full_path, body)?;
    registry.record(&full_path, body);
    Ok(())
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
    registry: &WriteHashRegistry,
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
    registry.record(&full_path, "");

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
        has_companion: false,
    })
}

pub fn rename_page(
    root: &Path,
    old_path: &str,
    new_name: &str,
    registry: &WriteHashRegistry,
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
    let content = fs::read_to_string(&old_full)?;
    fs::rename(&old_full, &new_full)?;
    registry.record(&new_full, &content);
    registry.record_delete(&old_full);

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

pub fn delete_page(root: &Path, relative_path: &str, registry: &WriteHashRegistry) -> Result<(), WorkspaceError> {
    let full_path = root.join(relative_path);
    if !full_path.exists() {
        return Err(WorkspaceError::PageNotFound(relative_path.to_string()));
    }
    fs::remove_file(&full_path)?;
    registry.record_delete(&full_path);
    Ok(())
}

pub fn persist_companion_frontmatter(
    root: &Path,
    md_relative: &str,
    pdf_relative: &str,
    citekey: Option<&str>,
    page_offset: Option<i32>,
    registry: &WriteHashRegistry,
) -> Result<(), WorkspaceError> {
    let full_path = root.join(md_relative);
    if !full_path.exists() {
        return Err(WorkspaceError::PageNotFound(md_relative.to_string()));
    }
    let raw = fs::read_to_string(&full_path)?;
    let parsed = parse_frontmatter(&raw);

    // Only a positive offset is meaningful; 0 / None leaves the key absent.
    let offset = page_offset.filter(|&n| n > 0);

    let companion_ok = parsed.map.get("companion").and_then(|v| v.as_str()) == Some(pdf_relative);
    let citekey_ok = match citekey {
        Some(ck) => parsed.map.get("citekey").and_then(|v| v.as_str()) == Some(ck),
        None => true,
    };
    let offset_ok = match offset {
        Some(n) => {
            parsed.map.get("companion_page_offset").and_then(|v| v.as_i64()) == Some(n as i64)
        }
        None => !parsed.map.contains_key("companion_page_offset"),
    };
    if companion_ok && citekey_ok && offset_ok {
        registry.record(&full_path, &raw);
        return Ok(());
    }

    let mut fm = parsed.map;
    fm.insert(
        "companion".to_string(),
        serde_yaml::Value::String(pdf_relative.to_string()),
    );
    if let Some(ck) = citekey {
        fm.insert(
            "citekey".to_string(),
            serde_yaml::Value::String(ck.to_string()),
        );
    }
    if let Some(n) = offset {
        fm.insert(
            "companion_page_offset".to_string(),
            serde_yaml::Value::Number(serde_yaml::Number::from(n)),
        );
    } else {
        fm.swap_remove("companion_page_offset");
    }
    write_page(root, md_relative, parsed.body, &fm, registry)
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
        let registry = WriteHashRegistry::new();
        let meta = create_page(dir.path(), "New Page", None, &registry).unwrap();
        assert_eq!(meta.title, "New Page");
        assert_eq!(meta.relative_path, "New Page.md");
        assert!(dir.path().join("New Page.md").exists());
    }

    #[test]
    fn create_page_in_subdirectory() {
        let dir = TempDir::new().unwrap();
        let registry = WriteHashRegistry::new();
        let meta = create_page(dir.path(), "Entry", Some("journal"), &registry).unwrap();
        assert_eq!(meta.relative_path, "journal/Entry.md");
        assert!(dir.path().join("journal/Entry.md").exists());
    }

    #[test]
    fn create_duplicate_page() {
        let dir = TempDir::new().unwrap();
        let registry = WriteHashRegistry::new();
        create_page(dir.path(), "Dupe", None, &registry).unwrap();
        let result = create_page(dir.path(), "Dupe", None, &registry);
        assert!(result.is_err());
    }

    #[test]
    fn create_page_forbidden_chars() {
        let dir = TempDir::new().unwrap();
        let registry = WriteHashRegistry::new();
        let result = create_page(dir.path(), "bad/name", None, &registry);
        assert!(result.is_err());
    }

    #[test]
    fn create_page_records_hash() {
        let dir = TempDir::new().unwrap();
        let registry = WriteHashRegistry::new();
        create_page(dir.path(), "Hashed", None, &registry).unwrap();
        let full_path = dir.path().join("Hashed.md");
        assert!(registry.check(&full_path, ""));
    }

    #[test]
    fn rename_page_success() {
        let dir = TempDir::new().unwrap();
        let registry = WriteHashRegistry::new();
        fs::write(dir.path().join("old.md"), "content").unwrap();

        let new_path = rename_page(dir.path(), "old.md", "new", &registry).unwrap();
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
        let registry = WriteHashRegistry::new();
        fs::write(dir.path().join("a.md"), "a").unwrap();
        fs::write(dir.path().join("b.md"), "b").unwrap();

        let result = rename_page(dir.path(), "a.md", "b", &registry);
        assert!(result.is_err());
    }

    #[test]
    fn rename_page_records_new_path_hash() {
        let dir = TempDir::new().unwrap();
        let registry = WriteHashRegistry::new();
        fs::write(dir.path().join("old.md"), "content").unwrap();

        rename_page(dir.path(), "old.md", "new", &registry).unwrap();
        let new_full = dir.path().join("new.md");
        assert!(registry.check(&new_full, "content"));
    }

    #[test]
    fn rename_page_records_old_path_delete() {
        let dir = TempDir::new().unwrap();
        let registry = WriteHashRegistry::new();
        fs::write(dir.path().join("old.md"), "content").unwrap();

        rename_page(dir.path(), "old.md", "new", &registry).unwrap();
        let old_full = dir.path().join("old.md");
        assert!(registry.consume_delete(&old_full));
    }

    #[cfg(unix)]
    #[test]
    fn rename_unreadable_file_propagates_error() {
        use std::os::unix::fs::PermissionsExt;
        let dir = TempDir::new().unwrap();
        let registry = WriteHashRegistry::new();
        let file_path = dir.path().join("locked.md");
        fs::write(&file_path, "content").unwrap();
        fs::set_permissions(&file_path, fs::Permissions::from_mode(0o000)).unwrap();

        let result = rename_page(dir.path(), "locked.md", "new", &registry);
        assert!(result.is_err());

        fs::set_permissions(&file_path, fs::Permissions::from_mode(0o644)).unwrap();
    }

    #[test]
    fn delete_page_success() {
        let dir = TempDir::new().unwrap();
        let registry = WriteHashRegistry::new();
        fs::write(dir.path().join("doomed.md"), "bye").unwrap();

        delete_page(dir.path(), "doomed.md", &registry).unwrap();
        assert!(!dir.path().join("doomed.md").exists());
    }

    #[test]
    fn delete_nonexistent_page() {
        let dir = TempDir::new().unwrap();
        let registry = WriteHashRegistry::new();
        let result = delete_page(dir.path(), "nope.md", &registry);
        assert!(result.is_err());
    }

    #[test]
    fn delete_page_records_pending_delete() {
        let dir = TempDir::new().unwrap();
        let registry = WriteHashRegistry::new();
        fs::write(dir.path().join("doomed.md"), "bye").unwrap();

        delete_page(dir.path(), "doomed.md", &registry).unwrap();
        let full_path = dir.path().join("doomed.md");
        assert!(registry.consume_delete(&full_path));
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
    fn read_code_file_returns_raw_body() {
        let dir = TempDir::new().unwrap();
        let registry = WriteHashRegistry::new();
        let content = "@article{key,\n  title = {X}\n}";
        fs::write(dir.path().join("refs.bib"), content).unwrap();

        let code = read_code_file(dir.path(), "refs.bib", &registry).unwrap();
        assert_eq!(code.body, content);
        assert_eq!(code.title, "refs");
        assert_eq!(code.relative_path, "refs.bib");
    }

    #[test]
    fn read_code_file_does_not_strip_leading_dashes() {
        let dir = TempDir::new().unwrap();
        let registry = WriteHashRegistry::new();
        let content = "---\nfoo: bar\n";
        fs::write(dir.path().join("conf.yaml"), content).unwrap();

        let code = read_code_file(dir.path(), "conf.yaml", &registry).unwrap();
        assert_eq!(code.body, content);
    }

    #[test]
    fn read_code_file_records_hash() {
        let dir = TempDir::new().unwrap();
        let registry = WriteHashRegistry::new();
        let content = "let x = 1;\n";
        fs::write(dir.path().join("a.rs"), content).unwrap();

        read_code_file(dir.path(), "a.rs", &registry).unwrap();

        let full_path = dir.path().join("a.rs");
        assert!(registry.check(&full_path, content));
    }

    #[test]
    fn read_nonexistent_code_file() {
        let dir = TempDir::new().unwrap();
        let registry = WriteHashRegistry::new();
        let result = read_code_file(dir.path(), "nope.rs", &registry);
        assert!(result.is_err());
    }

    #[test]
    fn write_code_file_writes_verbatim() {
        let dir = TempDir::new().unwrap();
        let registry = WriteHashRegistry::new();
        let body = "let x = 1;\n";

        write_code_file(dir.path(), "a.rs", body, &registry).unwrap();

        let content = fs::read_to_string(dir.path().join("a.rs")).unwrap();
        assert_eq!(content, body);
        assert!(!content.contains("---"));
    }

    #[test]
    fn write_code_file_records_hash() {
        let dir = TempDir::new().unwrap();
        let registry = WriteHashRegistry::new();
        let body = "print(1)\n";

        write_code_file(dir.path(), "b.py", body, &registry).unwrap();

        let full_path = dir.path().join("b.py");
        assert!(registry.check(&full_path, body));
    }

    #[test]
    fn write_code_file_creates_parent_dirs() {
        let dir = TempDir::new().unwrap();
        let registry = WriteHashRegistry::new();

        write_code_file(dir.path(), "src/lib.rs", "fn x() {}\n", &registry).unwrap();

        assert!(dir.path().join("src/lib.rs").exists());
    }

    #[test]
    fn write_then_read_code_file_roundtrip() {
        let dir = TempDir::new().unwrap();
        let registry = WriteHashRegistry::new();
        let body = "---\nnot frontmatter\n@article{k}\n";

        write_code_file(dir.path(), "round.bib", body, &registry).unwrap();
        let code = read_code_file(dir.path(), "round.bib", &registry).unwrap();
        assert_eq!(code.body, body);
    }

    #[test]
    fn persist_companion_frontmatter_early_return_records_hash() {
        let dir = TempDir::new().unwrap();
        let registry = WriteHashRegistry::new();
        let content = "---\ncompanion: foo.pdf\n---\n# Body\n";
        fs::write(dir.path().join("note.md"), content).unwrap();

        persist_companion_frontmatter(dir.path(), "note.md", "foo.pdf", None, None, &registry).unwrap();

        let full_path = dir.path().join("note.md");
        assert!(registry.check(&full_path, content));
    }

    #[test]
    fn persist_companion_frontmatter_writes_citekey() {
        let dir = TempDir::new().unwrap();
        let registry = WriteHashRegistry::new();
        fs::write(dir.path().join("note.md"), "# Body\n").unwrap();

        persist_companion_frontmatter(dir.path(), "note.md", "foo.pdf", Some("smith2024"), None, &registry).unwrap();

        let content = fs::read_to_string(dir.path().join("note.md")).unwrap();
        let parsed = parse_frontmatter(&content);
        assert_eq!(parsed.map.get("companion").unwrap().as_str().unwrap(), "foo.pdf");
        assert_eq!(parsed.map.get("citekey").unwrap().as_str().unwrap(), "smith2024");
        assert!(parsed.body.contains("# Body"));
    }

    #[test]
    fn persist_companion_frontmatter_early_return_with_citekey() {
        let dir = TempDir::new().unwrap();
        let registry = WriteHashRegistry::new();
        let content = "---\ncompanion: foo.pdf\ncitekey: smith2024\n---\n# Body\n";
        fs::write(dir.path().join("note.md"), content).unwrap();

        persist_companion_frontmatter(dir.path(), "note.md", "foo.pdf", Some("smith2024"), None, &registry).unwrap();

        let full_path = dir.path().join("note.md");
        assert!(registry.check(&full_path, content));
    }

    #[test]
    fn persist_companion_frontmatter_writes_page_offset() {
        let dir = TempDir::new().unwrap();
        let registry = WriteHashRegistry::new();
        fs::write(dir.path().join("note.md"), "# Body\n").unwrap();

        persist_companion_frontmatter(dir.path(), "note.md", "foo.pdf", None, Some(2), &registry)
            .unwrap();

        let content = fs::read_to_string(dir.path().join("note.md")).unwrap();
        let parsed = parse_frontmatter(&content);
        assert_eq!(parsed.map.get("companion").unwrap().as_str().unwrap(), "foo.pdf");
        assert_eq!(
            parsed.map.get("companion_page_offset").unwrap().as_i64().unwrap(),
            2
        );
    }

    #[test]
    fn persist_companion_frontmatter_omits_zero_page_offset() {
        let dir = TempDir::new().unwrap();
        let registry = WriteHashRegistry::new();
        fs::write(dir.path().join("note.md"), "# Body\n").unwrap();

        persist_companion_frontmatter(dir.path(), "note.md", "foo.pdf", None, Some(0), &registry)
            .unwrap();

        let content = fs::read_to_string(dir.path().join("note.md")).unwrap();
        let parsed = parse_frontmatter(&content);
        assert!(
            parsed.map.get("companion_page_offset").is_none(),
            "offset of 0 must not be written"
        );
    }

    #[test]
    fn persist_companion_frontmatter_offset_idempotent() {
        let dir = TempDir::new().unwrap();
        let registry = WriteHashRegistry::new();
        let content = "---\ncompanion: foo.pdf\ncompanion_page_offset: 2\n---\n# Body\n";
        fs::write(dir.path().join("note.md"), content).unwrap();

        persist_companion_frontmatter(dir.path(), "note.md", "foo.pdf", None, Some(2), &registry)
            .unwrap();

        let full_path = dir.path().join("note.md");
        assert!(registry.check(&full_path, content), "no rewrite when offset matches");
    }

    #[test]
    fn persist_companion_frontmatter_removes_stale_offset() {
        let dir = TempDir::new().unwrap();
        let registry = WriteHashRegistry::new();
        let content = "---\ncompanion: foo.pdf\ncompanion_page_offset: 2\n---\n# Body\n";
        fs::write(dir.path().join("note.md"), content).unwrap();

        persist_companion_frontmatter(dir.path(), "note.md", "foo.pdf", None, Some(0), &registry)
            .unwrap();

        let rewritten = fs::read_to_string(dir.path().join("note.md")).unwrap();
        let parsed = parse_frontmatter(&rewritten);
        assert!(
            parsed.map.get("companion_page_offset").is_none(),
            "stale companion_page_offset must be removed when offset is 0"
        );
    }

    #[test]
    fn create_and_read_page_with_emoji_title() {
        let dir = TempDir::new().unwrap();
        let registry = WriteHashRegistry::new();
        let meta = create_page(dir.path(), "🚀 Launch", None, &registry).unwrap();
        assert_eq!(meta.title, "🚀 Launch");
        assert_eq!(meta.relative_path, "🚀 Launch.md");
        assert!(dir.path().join("🚀 Launch.md").exists());

        let page = read_page(dir.path(), "🚀 Launch.md", &registry).unwrap();
        assert_eq!(page.meta.title, "🚀 Launch");
    }
}
