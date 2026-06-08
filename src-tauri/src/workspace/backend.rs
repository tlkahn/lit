//! Storage backend dispatch.
//!
//! `StorageBackend` is an enum that abstracts over the two storage modes a
//! workspace can run in:
//!
//! - [`StorageBackend::Files`] forwards to the filesystem operations in
//!   [`super::ops`] / [`super::trash`] / [`super::scan`].
//! - [`StorageBackend::Db`] forwards to a SQLite-backed [`NotesStore`].
//!
//! The dispatch methods keep call-sites in the command layer uniform: every
//! method accepts a `root: &Path` and a `&WriteHashRegistry`, even though the
//! `Db` arm ignores both (there are no files to hash in DB mode). The command
//! layer is responsible for skipping `registry.record(...)` calls in DB mode.
//!
//! ## Phase-3 reconciliation note (trash)
//!
//! The filesystem trash (`trash.rs`) keys off a generated `trash_name` and
//! returns rich [`TrashEntry`] values. The DB store soft-deletes via a
//! `trashed_at` column keyed off the `relative_path` and returns [`PageMeta`].
//! These shapes differ. To preserve the existing IPC contract (and the
//! frontend's `TrashEntry` type), the `Db` arm SYNTHESIZES a `TrashEntry` whose
//! `trash_name == original_path == relative_path`, and treats an incoming
//! `trash_name` parameter AS the `relative_path` for restore/purge. Reconciling
//! the real UI contract is Phase 3 work; do not change the `TrashEntry` struct.

use super::notes_store::NotesStore;
use super::ops;
use super::page::{PageContent, PageMeta};
use super::trash::{self, TrashEntry};
use super::write_hash::WriteHashRegistry;
use super::WorkspaceError;
use indexmap::IndexMap;
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Clone)]
pub enum StorageBackend {
    Files,
    Db(Arc<Mutex<NotesStore>>),
}

/// Build a synthesized `TrashEntry` for the DB arm from a `PageMeta`.
///
/// `trash_name` and `original_path` both carry the `relative_path` so that the
/// existing IPC contract (which keys restore/purge off `trash_name`) keeps
/// working when those calls are routed back through the DB arm.
fn synthesize_trash_entry(meta: &PageMeta) -> TrashEntry {
    let deleted_at = meta.modified_at.unwrap_or_else(|| {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs()
    });
    TrashEntry {
        trash_name: meta.relative_path.clone(),
        original_path: meta.relative_path.clone(),
        deleted_at,
    }
}

impl StorageBackend {
    pub fn read_page(
        &self,
        root: &Path,
        rel: &str,
        registry: &WriteHashRegistry,
    ) -> Result<PageContent, WorkspaceError> {
        match self {
            StorageBackend::Files => ops::read_page(root, rel, registry),
            StorageBackend::Db(store) => store.lock().unwrap().read_page(rel),
        }
    }

    pub fn write_page(
        &self,
        root: &Path,
        rel: &str,
        body: &str,
        frontmatter: &IndexMap<String, serde_yaml::Value>,
        registry: &WriteHashRegistry,
    ) -> Result<(), WorkspaceError> {
        match self {
            StorageBackend::Files => ops::write_page(root, rel, body, frontmatter, registry),
            StorageBackend::Db(store) => store.lock().unwrap().write_page(rel, body, frontmatter),
        }
    }

    pub fn create_page(
        &self,
        root: &Path,
        name: &str,
        parent: Option<&str>,
        registry: &WriteHashRegistry,
    ) -> Result<PageMeta, WorkspaceError> {
        match self {
            StorageBackend::Files => ops::create_page(root, name, parent, registry),
            StorageBackend::Db(store) => store.lock().unwrap().create_page(name, parent),
        }
    }

    pub fn rename_page(
        &self,
        root: &Path,
        old: &str,
        new: &str,
        registry: &WriteHashRegistry,
    ) -> Result<String, WorkspaceError> {
        match self {
            StorageBackend::Files => ops::rename_page(root, old, new, registry),
            StorageBackend::Db(store) => store.lock().unwrap().rename_page(old, new),
        }
    }

    /// Hard delete. The trash-vs-delete distinction lives in the trash command.
    pub fn delete_page(
        &self,
        root: &Path,
        rel: &str,
        registry: &WriteHashRegistry,
    ) -> Result<(), WorkspaceError> {
        match self {
            StorageBackend::Files => ops::delete_page(root, rel, registry),
            StorageBackend::Db(store) => store.lock().unwrap().delete_page(rel),
        }
    }

    pub fn list_pages(&self, root: &Path) -> Result<Vec<PageMeta>, WorkspaceError> {
        match self {
            StorageBackend::Files => super::scan::scan_pages(root),
            StorageBackend::Db(store) => store.lock().unwrap().list_pages(),
        }
    }

    pub fn trash_page(&self, root: &Path, rel: &str) -> Result<TrashEntry, WorkspaceError> {
        match self {
            StorageBackend::Files => trash::trash_page(root, rel),
            StorageBackend::Db(store) => {
                let store = store.lock().unwrap();
                store.trash_page(rel)?;
                // Find the synthesized entry from the trash listing.
                let trashed = store.list_trash()?;
                let meta = trashed
                    .into_iter()
                    .find(|m| m.relative_path == rel)
                    .ok_or_else(|| WorkspaceError::PageNotFound(rel.to_string()))?;
                Ok(synthesize_trash_entry(&meta))
            }
        }
    }

    pub fn restore_page(&self, root: &Path, name: &str) -> Result<String, WorkspaceError> {
        match self {
            StorageBackend::Files => trash::restore_page(root, name),
            StorageBackend::Db(store) => {
                // In DB mode the incoming `trash_name` IS the relative_path.
                store.lock().unwrap().restore_page(name)?;
                Ok(name.to_string())
            }
        }
    }

    pub fn purge_page(&self, root: &Path, name: &str) -> Result<(), WorkspaceError> {
        match self {
            StorageBackend::Files => trash::purge_page(root, name),
            StorageBackend::Db(store) => store.lock().unwrap().purge_page(name),
        }
    }

    pub fn list_trash(&self, root: &Path) -> Result<Vec<TrashEntry>, WorkspaceError> {
        match self {
            StorageBackend::Files => trash::list_trash(root),
            StorageBackend::Db(store) => {
                let metas = store.lock().unwrap().list_trash()?;
                Ok(metas.iter().map(synthesize_trash_entry).collect())
            }
        }
    }

    pub fn empty_trash(&self, root: &Path) -> Result<(), WorkspaceError> {
        match self {
            StorageBackend::Files => trash::empty_trash(root),
            StorageBackend::Db(store) => {
                store.lock().unwrap().empty_trash()?;
                Ok(())
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn db_backend() -> StorageBackend {
        StorageBackend::Db(Arc::new(Mutex::new(NotesStore::open_memory().unwrap())))
    }

    fn fm_with_title(title: &str) -> IndexMap<String, serde_yaml::Value> {
        let mut fm = IndexMap::new();
        fm.insert(
            "title".to_string(),
            serde_yaml::Value::String(title.to_string()),
        );
        fm
    }

    #[test]
    fn files_arm_read_write_round_trips() {
        let dir = TempDir::new().unwrap();
        let registry = WriteHashRegistry::new();
        let backend = StorageBackend::Files;

        backend
            .write_page(dir.path(), "Note.md", "# Body\n", &IndexMap::new(), &registry)
            .unwrap();
        let page = backend.read_page(dir.path(), "Note.md", &registry).unwrap();
        assert_eq!(page.body, "# Body\n");
    }

    #[test]
    fn db_arm_read_write_round_trips() {
        let backend = db_backend();
        // root and registry are ignored in DB mode.
        let registry = WriteHashRegistry::new();
        let root = Path::new("/ignored");

        backend
            .write_page(root, "Note.md", "# Content\n", &fm_with_title("Hello"), &registry)
            .unwrap();
        let page = backend.read_page(root, "Note.md", &registry).unwrap();
        assert_eq!(page.body, "# Content\n");
        assert_eq!(
            page.meta.frontmatter.get("title"),
            Some(&serde_yaml::Value::String("Hello".to_string()))
        );
    }

    #[test]
    fn db_arm_list_pages_excludes_trashed() {
        let backend = db_backend();
        let registry = WriteHashRegistry::new();
        let root = Path::new("/ignored");

        backend
            .write_page(root, "a.md", "x", &IndexMap::new(), &registry)
            .unwrap();
        backend
            .write_page(root, "b.md", "x", &IndexMap::new(), &registry)
            .unwrap();
        backend.trash_page(root, "a.md").unwrap();

        let pages = backend.list_pages(root).unwrap();
        assert_eq!(pages.len(), 1);
        assert_eq!(pages[0].relative_path, "b.md");
    }

    #[test]
    fn db_arm_trash_page_returns_synthesized_entry() {
        let backend = db_backend();
        let registry = WriteHashRegistry::new();
        let root = Path::new("/ignored");

        backend
            .write_page(root, "doomed.md", "x", &IndexMap::new(), &registry)
            .unwrap();

        let entry = backend.trash_page(root, "doomed.md").unwrap();
        assert_eq!(entry.trash_name, "doomed.md");
        assert_eq!(entry.original_path, "doomed.md");

        let listing = backend.list_trash(root).unwrap();
        assert_eq!(listing.len(), 1);
        assert_eq!(listing[0].trash_name, "doomed.md");

        // restore by trash_name (== relative_path)
        let restored = backend.restore_page(root, "doomed.md").unwrap();
        assert_eq!(restored, "doomed.md");
        assert_eq!(backend.list_pages(root).unwrap().len(), 1);

        // trash again, then purge
        backend.trash_page(root, "doomed.md").unwrap();
        backend.purge_page(root, "doomed.md").unwrap();
        assert!(backend.list_trash(root).unwrap().is_empty());
    }

    #[test]
    fn db_arm_empty_trash_clears() {
        let backend = db_backend();
        let registry = WriteHashRegistry::new();
        let root = Path::new("/ignored");

        backend
            .write_page(root, "t1.md", "x", &IndexMap::new(), &registry)
            .unwrap();
        backend
            .write_page(root, "t2.md", "x", &IndexMap::new(), &registry)
            .unwrap();
        backend.trash_page(root, "t1.md").unwrap();
        backend.trash_page(root, "t2.md").unwrap();

        backend.empty_trash(root).unwrap();
        assert!(backend.list_trash(root).unwrap().is_empty());
    }

    #[test]
    fn files_arm_trash_round_trips() {
        let dir = TempDir::new().unwrap();
        let registry = WriteHashRegistry::new();
        let backend = StorageBackend::Files;

        std::fs::write(dir.path().join("hello.md"), "content").unwrap();
        let entry = backend.trash_page(dir.path(), "hello.md").unwrap();
        assert!(!dir.path().join("hello.md").exists());

        let listing = backend.list_trash(dir.path()).unwrap();
        assert_eq!(listing.len(), 1);

        let original = backend.restore_page(dir.path(), &entry.trash_name).unwrap();
        assert_eq!(original, "hello.md");
        assert!(dir.path().join("hello.md").exists());

        let _ = registry; // registry is unused in this path but kept for parity
    }
}
