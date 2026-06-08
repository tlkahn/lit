//! Migration between storage modes (Files <-> DB) for the Notes-in-DB feature.
//!
//! Pure, Tauri-free functions driven by a `&dyn Fn(MigrationProgress)` callback
//! (mirroring `rewriter.rs`'s `*_with` closure pattern and the graph indexer's
//! `*_with_store` pattern) so they are unit-testable with a tempdir.
//!
//! Invariants:
//! - Source data is NEVER deleted (Files->DB leaves the .md/.png files; DB->Files
//!   leaves notes.db). Migration is therefore re-runnable.
//! - `config.json` is written LAST in both directions, so a crash mid-migration
//!   leaves the workspace in its original mode (re-runnable, no data "loss").
//! - The whole page+asset import (Files->DB) happens in ONE transaction via
//!   `NotesStore::import_all`, preserving original file timestamps.

use super::config::{self, StorageMode, WorkspaceConfig};
use super::frontmatter::parse_frontmatter;
use super::notes_store::{AssetImport, NotesStore, PageImport};
use super::normalize::normalize_to_nfc;
use super::page::FileType;
use super::{scan, WorkspaceError};
use std::fs;
use std::path::Path;
use walkdir::WalkDir;

/// Maximum asset size copied into the DB. Mirrors `NotesStore`'s cap; oversize
/// files are skipped (not errored) so one huge file can't abort a migration.
const MAX_ASSET_BYTES: u64 = 50 * 1024 * 1024;

/// Progress event emitted during migration. Field shape matches the frontend
/// `lit:migration-progress` payload exactly: `{ current, total, phase }`.
#[derive(Clone, serde::Serialize)]
pub struct MigrationProgress {
    pub current: usize,
    pub total: usize,
    pub phase: String,
}

fn db_path(root: &Path) -> std::path::PathBuf {
    root.join(".lit").join("notes.db")
}

/// Guess a MIME type from a file extension. Returns `None` for unknown types so
/// the asset is still stored (mime is advisory).
fn mime_from_ext(ext: &str) -> Option<&'static str> {
    match ext.to_ascii_lowercase().as_str() {
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "gif" => Some("image/gif"),
        "webp" => Some("image/webp"),
        "svg" => Some("image/svg+xml"),
        "pdf" => Some("application/pdf"),
        "mp4" => Some("video/mp4"),
        "webm" => Some("video/webm"),
        "mp3" => Some("audio/mpeg"),
        "wav" => Some("audio/wav"),
        _ => None,
    }
}

/// Collect every non-`.md` regular file under `root` as an [`AssetImport`],
/// skipping dotfiles/dot-dirs (mirrors `scan::is_hidden`, depth-aware) and the
/// `.lit/` directory (which holds notes.db/config/graph — never import into self).
/// Oversize files are skipped with a warning.
fn collect_assets(root: &Path) -> Result<Vec<AssetImport>, WorkspaceError> {
    let mut assets = Vec::new();
    for entry in WalkDir::new(root)
        .into_iter()
        .filter_entry(|e| !is_hidden(e))
    {
        let entry = entry.map_err(|e| WorkspaceError::IoError(e.to_string()))?;
        if !entry.file_type().is_file() {
            continue;
        }
        let path = entry.path();
        let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
        if ext.eq_ignore_ascii_case("md") {
            continue; // markdown pages are handled separately
        }
        let metadata = entry
            .metadata()
            .map_err(|e| WorkspaceError::IoError(e.to_string()))?;
        if metadata.len() > MAX_ASSET_BYTES {
            tracing::warn!(
                path = %path.display(),
                size = metadata.len(),
                "skipping oversize asset during migration"
            );
            continue;
        }
        let relative = path
            .strip_prefix(root)
            .map_err(|e| WorkspaceError::IoError(e.to_string()))?;
        let relative_str = normalize_to_nfc(&relative.to_string_lossy());
        let data = fs::read(path)?;
        assets.push(AssetImport {
            relative_path: relative_str,
            data,
            mime_type: mime_from_ext(ext).map(|s| s.to_string()),
        });
    }
    assets.sort_by(|a, b| a.relative_path.cmp(&b.relative_path));
    Ok(assets)
}

/// Depth-aware dotfile skip mirroring `scan::is_hidden`, additionally excluding
/// the `.lit/` directory (covered by the dotfile rule, but explicit for clarity).
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

/// Migrate a Files-mode workspace into Db mode. Returns the page count migrated.
/// Markdown files become page rows; every other (non-hidden) file becomes an
/// asset. Source files are NOT deleted; config is written LAST.
pub fn migrate_files_to_db(
    root: &Path,
    on_progress: &dyn Fn(MigrationProgress),
) -> Result<usize, WorkspaceError> {
    let pages_meta = scan::scan_pages(root)?;
    let assets = collect_assets(root)?;

    // Markdown pages → PageImport (preserving file timestamps).
    let mut page_imports: Vec<PageImport> = Vec::new();
    for meta in &pages_meta {
        if meta.file_type != FileType::Markdown {
            continue; // PDFs are routed through the asset walk (binary, not a page row)
        }
        let raw = fs::read_to_string(root.join(&meta.relative_path))?;
        let parsed = parse_frontmatter(&raw);
        page_imports.push(PageImport {
            relative_path: meta.relative_path.clone(),
            body: parsed.body.to_string(),
            frontmatter: parsed.map,
            created_at: meta.created_at.map(|v| v as i64),
            modified_at: meta.modified_at.map(|v| v as i64),
        });
    }

    let total = page_imports.len() + assets.len();
    on_progress(MigrationProgress {
        current: 0,
        total,
        phase: "scan".to_string(),
    });

    // Open the DB only after scanning, so we don't hold a write lock during IO.
    let mut store = NotesStore::open(&db_path(root))?;
    store.import_all(&page_imports, &assets)?;

    // Emit per-phase progress (post-import, since import_all is one atomic txn).
    let page_count = page_imports.len();
    on_progress(MigrationProgress {
        current: page_count,
        total,
        phase: "pages".to_string(),
    });
    on_progress(MigrationProgress {
        current: total,
        total,
        phase: "assets".to_string(),
    });

    // Config LAST: a crash before this leaves Files mode intact (re-runnable).
    config::write_config(
        root,
        &WorkspaceConfig {
            storage_mode: StorageMode::Db,
        },
    )?;

    on_progress(MigrationProgress {
        current: total,
        total,
        phase: "done".to_string(),
    });

    Ok(page_count)
}

/// Migrate a Db-mode workspace back to Files mode. Returns the page count.
/// Pages are written to disk via `read_raw_content` (already canonical), assets
/// via `read_asset`. notes.db is NOT deleted; config is written LAST.
pub fn migrate_db_to_files(
    root: &Path,
    on_progress: &dyn Fn(MigrationProgress),
) -> Result<usize, WorkspaceError> {
    let store = NotesStore::open(&db_path(root))?;
    let pages = store.list_pages()?;
    let asset_paths = store.list_asset_paths()?;
    let total = pages.len() + asset_paths.len();

    on_progress(MigrationProgress {
        current: 0,
        total,
        phase: "scan".to_string(),
    });

    for (i, page) in pages.iter().enumerate() {
        let raw = store.read_raw_content(&page.relative_path)?;
        let full = root.join(&page.relative_path);
        if let Some(parent) = full.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::write(&full, raw)?;
        on_progress(MigrationProgress {
            current: i + 1,
            total,
            phase: "pages".to_string(),
        });
    }

    for (i, rel) in asset_paths.iter().enumerate() {
        let (bytes, _mime) = store.read_asset(rel)?;
        let full = root.join(rel);
        if let Some(parent) = full.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::write(&full, bytes)?;
        on_progress(MigrationProgress {
            current: pages.len() + i + 1,
            total,
            phase: "assets".to_string(),
        });
    }

    // Config LAST: a crash before this leaves Db mode intact (re-runnable).
    config::write_config(
        root,
        &WorkspaceConfig {
            storage_mode: StorageMode::Files,
        },
    )?;

    on_progress(MigrationProgress {
        current: total,
        total,
        phase: "done".to_string(),
    });

    Ok(pages.len())
}

/// Dispatch to the correct migration based on the workspace's current on-disk
/// mode and the `target`. A no-op (returns `Ok(0)`) when already in `target`.
pub fn migrate(
    root: &Path,
    target: StorageMode,
    on_progress: &dyn Fn(MigrationProgress),
) -> Result<usize, WorkspaceError> {
    let current = config::read_config(root).storage_mode;
    if current == target {
        return Ok(0);
    }
    match (current, target) {
        (StorageMode::Files, StorageMode::Db) => migrate_files_to_db(root, on_progress),
        (StorageMode::Db, StorageMode::Files) => migrate_db_to_files(root, on_progress),
        _ => Ok(0),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use indexmap::IndexMap;
    use std::cell::RefCell;
    use tempfile::TempDir;

    fn noop(_: MigrationProgress) {}

    fn write_config_mode(root: &Path, mode: StorageMode) {
        config::write_config(root, &WorkspaceConfig { storage_mode: mode }).unwrap();
    }

    #[test]
    fn migrate_files_to_db_inserts_pages_and_writes_config() {
        let dir = TempDir::new().unwrap();
        let root = dir.path();
        fs::write(
            root.join("a.md"),
            "---\ntitle: Alpha\n---\n# Alpha body\n",
        )
        .unwrap();
        fs::write(root.join("b.md"), "plain body").unwrap();
        fs::write(root.join("image.png"), b"\x89PNGdata").unwrap();

        let count = migrate_files_to_db(root, &noop).unwrap();
        assert_eq!(count, 2);

        // DB exists and is in Db mode now.
        assert!(db_path(root).exists());
        assert_eq!(config::read_config(root).storage_mode, StorageMode::Db);

        // Pages present with correct content.
        let store = NotesStore::open(&db_path(root)).unwrap();
        let pages = store.list_pages().unwrap();
        assert_eq!(pages.len(), 2);
        let a = store.read_page("a.md").unwrap();
        assert_eq!(a.body, "# Alpha body\n");
        assert_eq!(
            a.meta.frontmatter.get("title"),
            Some(&serde_yaml::Value::String("Alpha".to_string()))
        );
        let b = store.read_page("b.md").unwrap();
        assert_eq!(b.body, "plain body");

        // Asset present.
        let (bytes, mime) = store.read_asset("image.png").unwrap();
        assert_eq!(bytes, b"\x89PNGdata");
        assert_eq!(mime, Some("image/png".to_string()));

        // Source files STILL exist (never deleted).
        assert!(root.join("a.md").exists());
        assert!(root.join("b.md").exists());
        assert!(root.join("image.png").exists());
    }

    #[test]
    fn migrate_files_to_db_emits_progress() {
        let dir = TempDir::new().unwrap();
        let root = dir.path();
        fs::write(root.join("a.md"), "body").unwrap();

        let events: RefCell<Vec<MigrationProgress>> = RefCell::new(Vec::new());
        let cb = |p: MigrationProgress| events.borrow_mut().push(p);
        migrate_files_to_db(root, &cb).unwrap();

        let evs = events.borrow();
        assert!(!evs.is_empty());
        assert_eq!(evs.last().unwrap().phase, "done");
    }

    #[test]
    fn migrate_files_to_db_excludes_lit_dir() {
        let dir = TempDir::new().unwrap();
        let root = dir.path();
        fs::write(root.join("a.md"), "body").unwrap();
        // Pre-existing .lit dir with junk that must NOT be imported as an asset.
        let lit = root.join(".lit");
        fs::create_dir_all(&lit).unwrap();
        fs::write(lit.join("graph.db"), b"junk").unwrap();

        migrate_files_to_db(root, &noop).unwrap();
        let store = NotesStore::open(&db_path(root)).unwrap();
        assert!(store.list_asset_paths().unwrap().is_empty());
    }

    #[test]
    fn migrate_files_to_db_skips_oversize_asset() {
        let dir = TempDir::new().unwrap();
        let root = dir.path();
        fs::write(root.join("a.md"), "body").unwrap();
        // > 50 MB dummy asset.
        let big = vec![0u8; (MAX_ASSET_BYTES + 1) as usize];
        fs::write(root.join("huge.bin"), &big).unwrap();

        let count = migrate_files_to_db(root, &noop).unwrap();
        assert_eq!(count, 1);
        let store = NotesStore::open(&db_path(root)).unwrap();
        assert!(store.read_asset("huge.bin").is_err());
        assert_eq!(store.list_pages().unwrap().len(), 1);
    }

    #[test]
    fn migrate_db_to_files_reconstructs_disk() {
        let dir = TempDir::new().unwrap();
        let root = dir.path();
        write_config_mode(root, StorageMode::Db);
        {
            let store = NotesStore::open(&db_path(root)).unwrap();
            let mut fm = IndexMap::new();
            fm.insert(
                "title".to_string(),
                serde_yaml::Value::String("FM".to_string()),
            );
            store.write_page("fm.md", "# Body\n", &fm).unwrap();
            store
                .write_page("plain.md", "bare body", &IndexMap::new())
                .unwrap();
            store
                .write_asset("img/a.png", &[1u8, 2, 3], Some("image/png"))
                .unwrap();
        }

        let count = migrate_db_to_files(root, &noop).unwrap();
        assert_eq!(count, 2);

        let fm_disk = fs::read_to_string(root.join("fm.md")).unwrap();
        assert!(fm_disk.starts_with("---\n"));
        assert!(fm_disk.contains("title: FM"));
        assert!(fm_disk.ends_with("# Body\n"));

        let plain_disk = fs::read_to_string(root.join("plain.md")).unwrap();
        assert_eq!(plain_disk, "bare body");

        let asset_disk = fs::read(root.join("img/a.png")).unwrap();
        assert_eq!(asset_disk, vec![1u8, 2, 3]);

        assert_eq!(config::read_config(root).storage_mode, StorageMode::Files);
        // notes.db STILL exists (never deleted).
        assert!(db_path(root).exists());
    }

    #[test]
    fn migrate_noop_when_already_target() {
        let dir = TempDir::new().unwrap();
        let root = dir.path();
        write_config_mode(root, StorageMode::Db);

        let events: RefCell<Vec<MigrationProgress>> = RefCell::new(Vec::new());
        let cb = |p: MigrationProgress| events.borrow_mut().push(p);
        let count = migrate(root, StorageMode::Db, &cb).unwrap();
        assert_eq!(count, 0);
        assert!(events.borrow().is_empty());
    }

    #[test]
    fn roundtrip_files_to_db_to_files_preserves_content() {
        let dir = TempDir::new().unwrap();
        let root = dir.path();
        let original = "---\ntitle: Round\ntags:\n- one\n- two\n---\n# Heading\n\nbody text\n";
        fs::write(root.join("note.md"), original).unwrap();

        migrate(root, StorageMode::Db, &noop).unwrap();
        // Remove disk file to prove DB->Files actually rewrites it.
        fs::remove_file(root.join("note.md")).unwrap();
        migrate(root, StorageMode::Files, &noop).unwrap();

        let restored = fs::read_to_string(root.join("note.md")).unwrap();
        assert_eq!(restored, original);
    }
}
