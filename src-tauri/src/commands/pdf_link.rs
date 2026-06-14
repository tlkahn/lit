use std::collections::HashMap;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use crate::recognize::attach::generate_pdf_path;

#[derive(Debug, thiserror::Error)]
pub(crate) enum LinkError {
    #[error("entry '{0}' not found in bib database")]
    EntryNotFound(String),

    #[error("source file does not exist: {0}")]
    FileNotFound(String),

    #[error("file is not a valid PDF (missing %PDF magic bytes)")]
    NotAPdf,

    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),

    #[error("{0}")]
    Other(String),
}

/// Core logic: validate, copy, and update bib DB.
/// Returns the workspace-relative path (forward slashes).
pub(crate) fn link_pdf_to_entry(
    conn: &rusqlite::Connection,
    key: &str,
    file_path: &Path,
    workspace_root: &Path,
) -> Result<String, LinkError> {
    // 1. Validate key exists in bib DB
    match crate::bib::db::get_bib_item(conn, key) {
        Ok(Some(_)) => {} // entry exists, proceed
        Ok(None) => return Err(LinkError::EntryNotFound(key.to_string())),
        Err(e) => return Err(LinkError::Other(e.to_string())),
    }

    // 2. Verify source file exists
    if !file_path.exists() {
        return Err(LinkError::FileNotFound(file_path.display().to_string()));
    }

    // 3. Validate PDF magic bytes (%PDF)
    {
        let mut f = std::fs::File::open(file_path)?;
        let mut magic = [0u8; 4];
        if f.read_exact(&mut magic).is_err() {
            return Err(LinkError::NotAPdf);
        }
        if &magic != b"%PDF" {
            return Err(LinkError::NotAPdf);
        }
    }

    // 4. Copy file to workspace using collision-safe naming
    let filename = format!("{key}.pdf");
    let dest_path =
        generate_pdf_path(workspace_root, &filename).map_err(LinkError::Other)?;
    std::fs::copy(file_path, &dest_path)?;

    // 5. Compute workspace-relative path (forward slashes)
    let relative = dest_path
        .strip_prefix(workspace_root)
        .unwrap_or(&dest_path);
    let relative_str = relative
        .to_string_lossy()
        .replace(std::path::MAIN_SEPARATOR, "/");

    // 6. Update bib DB file field
    let mut fields = HashMap::new();
    fields.insert("file".to_string(), relative_str.clone());
    crate::bib::db::update_bib_fields(conn, key, &fields)
        .map_err(|e| LinkError::Other(e.to_string()))?;

    // 7. Return relative path
    Ok(relative_str)
}

#[tauri::command]
pub async fn link_entry_pdf(
    key: String,
    file_path: String,
    workspace_path: String,
    graph_state: tauri::State<'_, Arc<crate::commands::graph::GraphRegistry>>,
    app_handle: tauri::AppHandle,
) -> Result<String, String> {
    let root = PathBuf::from(&workspace_path);
    let gi = crate::commands::page::lookup_graph_index(&graph_state, &root)
        .ok_or_else(|| "Graph index not ready".to_string())?;

    let relative_path = {
        let store = gi.store();
        link_pdf_to_entry(&store.conn, &key, Path::new(&file_path), &root)
            .map_err(|e| e.to_string())?
    };

    crate::commands::graph::notify_bib_changed(&graph_state, &root, &app_handle);

    if let Err(e) = crate::commands::ocr::ensure_companion_search_path(&app_handle) {
        eprintln!("[pdf_link] failed to update companion search paths: {e}");
    }

    Ok(relative_path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::bib::types::BibEntry;
    use crate::graph::store::Store;

    fn make_entry(key: &str) -> BibEntry {
        BibEntry {
            key: key.to_string(),
            authors: vec![],
            title: "Test Paper".to_string(),
            year: "2024".to_string(),
            entry_type: "article".to_string(),
            line_number: 0,
            bib_file: None,
            abstract_text: None,
            doi: None,
            journal: None,
            url: None,
            file: None,
            volume: None,
            number: None,
            pages: None,
            publisher: None,
            issn: None,
            isbn: None,
            arxiv_id: None,
            tags: vec![],
        }
    }

    fn setup_db_with_entry(key: &str) -> Store {
        let store = Store::open_memory().expect("failed to open in-memory store");
        let entry = make_entry(key);
        crate::bib::db::upsert_bib_item(&store.conn, &entry, None, None, false)
            .expect("failed to upsert entry");
        store
    }

    fn create_temp_pdf(dir: &Path, name: &str) -> PathBuf {
        let path = dir.join(name);
        std::fs::write(&path, b"%PDF-1.4 fake pdf content here").unwrap();
        path
    }

    #[test]
    fn happy_path_copies_and_updates_db() {
        let store = setup_db_with_entry("smith2024");
        let workspace = tempfile::TempDir::new().unwrap();
        let source_dir = tempfile::TempDir::new().unwrap();
        let pdf_path = create_temp_pdf(source_dir.path(), "paper.pdf");

        let result = link_pdf_to_entry(
            &store.conn,
            "smith2024",
            &pdf_path,
            workspace.path(),
        );

        let rel_path = result.expect("should succeed");
        assert_eq!(rel_path, "assets/pdf/smith2024.pdf");

        // File should exist in workspace
        let abs_path = workspace.path().join(&rel_path);
        assert!(abs_path.exists(), "copied PDF should exist in workspace");

        // Content should match
        let content = std::fs::read(&abs_path).unwrap();
        assert_eq!(&content[..4], b"%PDF");

        // DB file field should be updated
        let entry = crate::bib::db::get_bib_item(&store.conn, "smith2024")
            .unwrap()
            .expect("entry should exist");
        assert_eq!(entry.file, Some("assets/pdf/smith2024.pdf".to_string()));
    }

    #[test]
    fn missing_key_returns_error() {
        let store = setup_db_with_entry("other2024");
        let workspace = tempfile::TempDir::new().unwrap();
        let source_dir = tempfile::TempDir::new().unwrap();
        let pdf_path = create_temp_pdf(source_dir.path(), "paper.pdf");

        let result = link_pdf_to_entry(
            &store.conn,
            "nonexistent2024",
            &pdf_path,
            workspace.path(),
        );

        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(
            matches!(err, LinkError::EntryNotFound(_)),
            "expected EntryNotFound, got: {err:?}"
        );
    }

    #[test]
    fn source_file_not_found() {
        let store = setup_db_with_entry("smith2024");
        let workspace = tempfile::TempDir::new().unwrap();
        let missing_path = PathBuf::from("/tmp/definitely_does_not_exist_abc123.pdf");

        let result = link_pdf_to_entry(
            &store.conn,
            "smith2024",
            &missing_path,
            workspace.path(),
        );

        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(
            matches!(err, LinkError::FileNotFound(_)),
            "expected FileNotFound, got: {err:?}"
        );
    }

    #[test]
    fn not_a_pdf_returns_error() {
        let store = setup_db_with_entry("smith2024");
        let workspace = tempfile::TempDir::new().unwrap();
        let source_dir = tempfile::TempDir::new().unwrap();
        let bad_path = source_dir.path().join("page.html");
        std::fs::write(&bad_path, b"<html><body>Not a PDF</body></html>").unwrap();

        let result = link_pdf_to_entry(
            &store.conn,
            "smith2024",
            &bad_path,
            workspace.path(),
        );

        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(
            matches!(err, LinkError::NotAPdf),
            "expected NotAPdf, got: {err:?}"
        );
    }

    #[test]
    fn too_small_file_returns_not_a_pdf() {
        let store = setup_db_with_entry("smith2024");
        let workspace = tempfile::TempDir::new().unwrap();
        let source_dir = tempfile::TempDir::new().unwrap();
        let tiny_path = source_dir.path().join("tiny.pdf");
        std::fs::write(&tiny_path, b"AB").unwrap();

        let result = link_pdf_to_entry(
            &store.conn,
            "smith2024",
            &tiny_path,
            workspace.path(),
        );

        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(
            matches!(err, LinkError::NotAPdf),
            "expected NotAPdf, got: {err:?}"
        );
    }

    #[test]
    fn overwrites_existing_file_field() {
        let store = setup_db_with_entry("smith2024");
        // Set an existing file field
        let mut fields = HashMap::new();
        fields.insert("file".to_string(), "old/path.pdf".to_string());
        crate::bib::db::update_bib_fields(&store.conn, "smith2024", &fields).unwrap();

        let workspace = tempfile::TempDir::new().unwrap();
        let source_dir = tempfile::TempDir::new().unwrap();
        let pdf_path = create_temp_pdf(source_dir.path(), "paper.pdf");

        let result = link_pdf_to_entry(
            &store.conn,
            "smith2024",
            &pdf_path,
            workspace.path(),
        );

        let rel_path = result.expect("should succeed");
        assert_eq!(rel_path, "assets/pdf/smith2024.pdf");

        // DB file field should be updated to the new path
        let entry = crate::bib::db::get_bib_item(&store.conn, "smith2024")
            .unwrap()
            .expect("entry should exist");
        assert_eq!(entry.file, Some("assets/pdf/smith2024.pdf".to_string()));
    }

    #[test]
    fn empty_file_returns_not_a_pdf() {
        let store = setup_db_with_entry("smith2024");
        let workspace = tempfile::TempDir::new().unwrap();
        let source_dir = tempfile::TempDir::new().unwrap();
        let empty_path = source_dir.path().join("empty.pdf");
        std::fs::write(&empty_path, b"").unwrap();

        let result = link_pdf_to_entry(
            &store.conn,
            "smith2024",
            &empty_path,
            workspace.path(),
        );

        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(
            matches!(err, LinkError::NotAPdf),
            "expected NotAPdf for 0-byte file, got: {err:?}"
        );
    }

    #[test]
    fn returned_path_uses_forward_slashes() {
        let store = setup_db_with_entry("jones2023");
        let workspace = tempfile::TempDir::new().unwrap();
        let source_dir = tempfile::TempDir::new().unwrap();
        let pdf_path = create_temp_pdf(source_dir.path(), "paper.pdf");

        let rel_path = link_pdf_to_entry(
            &store.conn,
            "jones2023",
            &pdf_path,
            workspace.path(),
        )
        .expect("should succeed");

        assert!(
            !rel_path.contains('\\'),
            "relative path should use forward slashes, got: {rel_path}"
        );
        assert!(
            rel_path.starts_with("assets/pdf/"),
            "relative path should start with assets/pdf/, got: {rel_path}"
        );
    }

    #[test]
    fn collision_safe_naming() {
        let store = setup_db_with_entry("smith2024");
        let workspace = tempfile::TempDir::new().unwrap();

        // Pre-create assets/pdf/smith2024.pdf in workspace
        let pdf_dir = workspace.path().join("assets/pdf");
        std::fs::create_dir_all(&pdf_dir).unwrap();
        std::fs::write(pdf_dir.join("smith2024.pdf"), b"%PDF-existing").unwrap();

        let source_dir = tempfile::TempDir::new().unwrap();
        let pdf_path = create_temp_pdf(source_dir.path(), "paper.pdf");

        let result = link_pdf_to_entry(
            &store.conn,
            "smith2024",
            &pdf_path,
            workspace.path(),
        );

        let rel_path = result.expect("should succeed");
        assert_eq!(rel_path, "assets/pdf/smith2024-1.pdf");
    }
}
