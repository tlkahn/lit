use super::frontmatter::parse_raw_yaml;
use super::normalize::{
    filename_to_page_name, normalize_to_nfc, page_name_to_filename, validate_page_name,
};
use super::page::{FileType, PageContent, PageMeta};
use super::WorkspaceError;
use indexmap::IndexMap;
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

pub const CURRENT_SCHEMA_VERSION: i64 = 1;

const MAX_ASSET_BYTES: usize = 50 * 1024 * 1024;

#[derive(Debug, Clone, Serialize)]
pub struct SearchHit {
    pub relative_path: String,
    pub title: String,
    pub snippet: String,
}

/// A single page to bulk-import via [`NotesStore::import_all`]. Unlike
/// [`NotesStore::write_page`], `created_at`/`modified_at` are caller-supplied so
/// migration can preserve original file timestamps (important for the graph diff
/// after switching modes — see Phase 4 plan).
pub struct PageImport {
    pub relative_path: String,
    pub body: String,
    pub frontmatter: IndexMap<String, serde_yaml::Value>,
    pub created_at: Option<i64>,
    pub modified_at: Option<i64>,
}

/// A single asset to bulk-import via [`NotesStore::import_all`].
pub struct AssetImport {
    pub relative_path: String,
    pub data: Vec<u8>,
    pub mime_type: Option<String>,
}

pub struct NotesStore {
    conn: Connection,
}

impl NotesStore {
    pub fn open(path: &Path) -> Result<Self, WorkspaceError> {
        // Defensive: ensure the parent dir exists so SQLite can create the file.
        if let Some(parent) = path.parent() {
            if !parent.as_os_str().is_empty() && !parent.exists() {
                std::fs::create_dir_all(parent)?;
            }
        }
        let conn = Connection::open(path)?;
        let store = Self { conn };
        store.migrate()?;
        Ok(store)
    }

    pub fn open_memory() -> Result<Self, WorkspaceError> {
        let conn = Connection::open_in_memory()?;
        let store = Self { conn };
        store.migrate()?;
        Ok(store)
    }

    fn migrate(&self) -> Result<(), WorkspaceError> {
        self.conn.execute_batch("PRAGMA journal_mode=WAL;")?;
        self.conn.execute_batch("PRAGMA foreign_keys=ON;")?;

        self.conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS pages (
                relative_path   TEXT PRIMARY KEY,
                title           TEXT NOT NULL,
                body            TEXT NOT NULL DEFAULT '',
                frontmatter_yaml TEXT NOT NULL DEFAULT '',
                content_hash    TEXT NOT NULL DEFAULT '',
                created_at      INTEGER,
                modified_at     INTEGER,
                trashed_at      INTEGER
            );

            CREATE VIRTUAL TABLE IF NOT EXISTS pages_fts USING fts5(
                title,
                body,
                content='pages',
                content_rowid='rowid',
                tokenize='trigram case_sensitive 0'
            );

            CREATE TRIGGER IF NOT EXISTS pages_fts_insert AFTER INSERT ON pages BEGIN
                INSERT INTO pages_fts(rowid, title, body)
                VALUES (new.rowid, new.title, new.body);
            END;

            CREATE TRIGGER IF NOT EXISTS pages_fts_delete AFTER DELETE ON pages BEGIN
                INSERT INTO pages_fts(pages_fts, rowid, title, body)
                VALUES ('delete', old.rowid, old.title, old.body);
            END;

            CREATE TRIGGER IF NOT EXISTS pages_fts_update AFTER UPDATE ON pages BEGIN
                INSERT INTO pages_fts(pages_fts, rowid, title, body)
                VALUES ('delete', old.rowid, old.title, old.body);
                INSERT INTO pages_fts(rowid, title, body)
                VALUES (new.rowid, new.title, new.body);
            END;

            CREATE TABLE IF NOT EXISTS assets (
                relative_path  TEXT PRIMARY KEY,
                data           BLOB NOT NULL,
                mime_type      TEXT,
                size_bytes     INTEGER NOT NULL,
                created_at     INTEGER,
                modified_at    INTEGER
            );

            CREATE TABLE IF NOT EXISTS meta (
                key   TEXT PRIMARY KEY,
                value TEXT
            );

            INSERT OR IGNORE INTO meta(key, value) VALUES ('schema_version', '1');",
        )?;

        Ok(())
    }

    pub fn schema_version(&self) -> Result<i64, WorkspaceError> {
        let version: String = self.conn.query_row(
            "SELECT value FROM meta WHERE key = 'schema_version'",
            [],
            |row| row.get(0),
        )?;
        Ok(version.parse::<i64>().unwrap_or(0))
    }

    fn now_ms() -> i64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as i64
    }

    fn content_hash(frontmatter_yaml: &str, body: &str) -> String {
        let mut hasher = Sha256::new();
        hasher.update(frontmatter_yaml.as_bytes());
        hasher.update(body.as_bytes());
        let digest = hasher.finalize();
        format!("sha256:{:x}", digest)
    }

    fn yaml_from_map(frontmatter: &IndexMap<String, serde_yaml::Value>) -> String {
        if frontmatter.is_empty() {
            String::new()
        } else {
            serde_yaml::to_string(frontmatter).unwrap_or_default()
        }
    }

    fn title_from_path(relative_path: &str) -> String {
        let file_name = Path::new(relative_path)
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| relative_path.to_string());
        filename_to_page_name(&file_name)
    }

    // --- CRUD ---

    pub fn read_page(&self, relative_path: &str) -> Result<PageContent, WorkspaceError> {
        let row: Option<(String, String, String, Option<i64>, Option<i64>)> = self
            .conn
            .query_row(
                "SELECT title, body, frontmatter_yaml, created_at, modified_at
                 FROM pages WHERE relative_path = ?1 AND trashed_at IS NULL",
                params![relative_path],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
            )
            .optional()?;

        let (title, body, frontmatter_yaml, created_at, modified_at) =
            row.ok_or_else(|| WorkspaceError::PageNotFound(relative_path.to_string()))?;

        let frontmatter = parse_raw_yaml(&frontmatter_yaml).unwrap_or_default();

        Ok(PageContent {
            meta: PageMeta {
                title,
                relative_path: normalize_to_nfc(relative_path),
                frontmatter,
                created_at: created_at.map(|v| v as u64),
                modified_at: modified_at.map(|v| v as u64),
                trashed_at: None,
                file_type: FileType::Markdown,
            },
            body,
            raw_yaml: frontmatter_yaml,
        })
    }

    pub fn write_page(
        &self,
        relative_path: &str,
        body: &str,
        frontmatter: &IndexMap<String, serde_yaml::Value>,
    ) -> Result<(), WorkspaceError> {
        let yaml = Self::yaml_from_map(frontmatter);
        let hash = Self::content_hash(&yaml, body);
        let title = Self::title_from_path(relative_path);
        let now = Self::now_ms();

        self.conn.execute(
            "INSERT INTO pages(relative_path, title, body, frontmatter_yaml, content_hash, created_at, modified_at, trashed_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, NULL)
             ON CONFLICT(relative_path) DO UPDATE SET
                body = excluded.body,
                frontmatter_yaml = excluded.frontmatter_yaml,
                content_hash = excluded.content_hash,
                title = excluded.title,
                modified_at = excluded.modified_at,
                trashed_at = NULL",
            params![relative_path, title, body, yaml, hash, now, now],
        )?;
        Ok(())
    }

    /// Bulk-import pages and assets atomically in a single transaction.
    ///
    /// Used by migration (Files -> DB). Caller-supplied `created_at`/`modified_at`
    /// are persisted verbatim when `Some` (preserving file mtimes for the graph
    /// diff), falling back to `now_ms()` when `None`. The whole batch commits or
    /// rolls back together — a failure on any row leaves the DB unchanged.
    ///
    /// Oversize assets (> `MAX_ASSET_BYTES`) are SKIPPED with a `tracing::warn`,
    /// not errored: a single huge file must not abort a large migration.
    pub fn import_all(
        &mut self,
        pages: &[PageImport],
        assets: &[AssetImport],
    ) -> Result<(), WorkspaceError> {
        let tx = self.conn.transaction()?;
        for p in pages {
            let yaml = Self::yaml_from_map(&p.frontmatter);
            let hash = Self::content_hash(&yaml, &p.body);
            let title = Self::title_from_path(&p.relative_path);
            let created = p.created_at.unwrap_or_else(Self::now_ms);
            let modified = p.modified_at.unwrap_or_else(Self::now_ms);
            tx.execute(
                "INSERT INTO pages(relative_path, title, body, frontmatter_yaml, content_hash, created_at, modified_at, trashed_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, NULL)
                 ON CONFLICT(relative_path) DO UPDATE SET
                    body = excluded.body,
                    frontmatter_yaml = excluded.frontmatter_yaml,
                    content_hash = excluded.content_hash,
                    title = excluded.title,
                    created_at = excluded.created_at,
                    modified_at = excluded.modified_at,
                    trashed_at = NULL",
                params![p.relative_path, title, p.body, yaml, hash, created, modified],
            )?;
        }
        for a in assets {
            if a.data.len() > MAX_ASSET_BYTES {
                tracing::warn!(
                    path = %a.relative_path,
                    size = a.data.len(),
                    "skipping oversize asset during migration"
                );
                continue;
            }
            let now = Self::now_ms();
            let size = a.data.len() as i64;
            tx.execute(
                "INSERT INTO assets(relative_path, data, mime_type, size_bytes, created_at, modified_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?5)
                 ON CONFLICT(relative_path) DO UPDATE SET
                    data = excluded.data,
                    mime_type = excluded.mime_type,
                    size_bytes = excluded.size_bytes,
                    modified_at = excluded.modified_at",
                params![a.relative_path, a.data, a.mime_type, size, now],
            )?;
        }
        tx.commit()?;
        Ok(())
    }

    pub fn create_page(
        &self,
        name: &str,
        parent_dir: Option<&str>,
    ) -> Result<PageMeta, WorkspaceError> {
        validate_page_name(name)?;
        let filename = page_name_to_filename(name);
        let relative_path = match parent_dir {
            Some(dir) => format!("{dir}/{filename}"),
            None => filename,
        };

        let exists: Option<i64> = self
            .conn
            .query_row(
                "SELECT 1 FROM pages WHERE relative_path = ?1 AND trashed_at IS NULL",
                params![relative_path],
                |r| r.get(0),
            )
            .optional()?;
        if exists.is_some() {
            return Err(WorkspaceError::PageAlreadyExists(relative_path));
        }

        let now = Self::now_ms();
        let hash = Self::content_hash("", "");
        self.conn.execute(
            "INSERT INTO pages(relative_path, title, body, frontmatter_yaml, content_hash, created_at, modified_at, trashed_at)
             VALUES (?1, ?2, '', '', ?3, ?4, ?4, NULL)
             ON CONFLICT(relative_path) DO UPDATE SET
                 title=excluded.title,
                 body=excluded.body,
                 frontmatter_yaml=excluded.frontmatter_yaml,
                 content_hash=excluded.content_hash,
                 created_at=excluded.created_at,
                 modified_at=excluded.modified_at,
                 trashed_at=NULL",
            params![relative_path, name, hash, now],
        )?;

        Ok(PageMeta {
            title: name.to_string(),
            relative_path: normalize_to_nfc(&relative_path),
            frontmatter: IndexMap::new(),
            created_at: Some(now as u64),
            modified_at: Some(now as u64),
            trashed_at: None,
            file_type: FileType::Markdown,
        })
    }

    pub fn rename_page(&self, old_path: &str, new_name: &str) -> Result<String, WorkspaceError> {
        validate_page_name(new_name)?;

        let exists: Option<i64> = self
            .conn
            .query_row(
                "SELECT 1 FROM pages WHERE relative_path = ?1 AND trashed_at IS NULL",
                params![old_path],
                |r| r.get(0),
            )
            .optional()?;
        if exists.is_none() {
            return Err(WorkspaceError::PageNotFound(old_path.to_string()));
        }

        let new_filename = page_name_to_filename(new_name);
        let new_relative = match Path::new(old_path).parent() {
            Some(parent) if parent != Path::new("") => {
                format!("{}/{new_filename}", parent.to_string_lossy())
            }
            _ => new_filename,
        };

        let dest_exists: Option<i64> = self
            .conn
            .query_row(
                "SELECT 1 FROM pages WHERE relative_path = ?1 AND trashed_at IS NULL",
                params![new_relative],
                |r| r.get(0),
            )
            .optional()?;
        if dest_exists.is_some() {
            return Err(WorkspaceError::PageAlreadyExists(new_relative));
        }

        let new_title = Self::title_from_path(&new_relative);
        self.conn.execute(
            "UPDATE pages SET relative_path = ?1, title = ?2 WHERE relative_path = ?3",
            params![new_relative, new_title, old_path],
        )?;

        Ok(normalize_to_nfc(&new_relative))
    }

    pub fn delete_page(&self, relative_path: &str) -> Result<(), WorkspaceError> {
        let rows = self.conn.execute(
            "DELETE FROM pages WHERE relative_path = ?1",
            params![relative_path],
        )?;
        if rows == 0 {
            return Err(WorkspaceError::PageNotFound(relative_path.to_string()));
        }
        Ok(())
    }

    // --- Trash (soft-delete via trashed_at) ---

    pub fn trash_page(&self, relative_path: &str) -> Result<(), WorkspaceError> {
        let now = Self::now_ms();
        let rows = self.conn.execute(
            "UPDATE pages SET trashed_at = ?1 WHERE relative_path = ?2 AND trashed_at IS NULL",
            params![now, relative_path],
        )?;
        if rows == 0 {
            return Err(WorkspaceError::PageNotFound(relative_path.to_string()));
        }
        Ok(())
    }

    pub fn restore_page(&self, relative_path: &str) -> Result<(), WorkspaceError> {
        let rows = self.conn.execute(
            "UPDATE pages SET trashed_at = NULL WHERE relative_path = ?1 AND trashed_at IS NOT NULL",
            params![relative_path],
        )?;
        if rows == 0 {
            return Err(WorkspaceError::TrashEntryNotFound(
                relative_path.to_string(),
            ));
        }
        Ok(())
    }

    pub fn purge_page(&self, relative_path: &str) -> Result<(), WorkspaceError> {
        self.conn.execute(
            "DELETE FROM pages WHERE relative_path = ?1 AND trashed_at IS NOT NULL",
            params![relative_path],
        )?;
        Ok(())
    }

    /// Single-row primary-key lookup of a TRASHED page's metadata. Used to
    /// return the metadata for a page that was just soft-deleted without
    /// scanning the entire trash listing.
    pub fn get_page_meta(&self, relative_path: &str) -> Result<PageMeta, WorkspaceError> {
        self.conn
            .query_row(
                "SELECT relative_path, title, created_at, modified_at, trashed_at
                 FROM pages WHERE relative_path = ?1 AND trashed_at IS NOT NULL",
                params![relative_path],
                |r| {
                    let relative_path: String = r.get(0)?;
                    let title: String = r.get(1)?;
                    let created_at: Option<i64> = r.get(2)?;
                    let modified_at: Option<i64> = r.get(3)?;
                    let trashed_at: Option<i64> = r.get(4)?;
                    Ok(PageMeta {
                        title,
                        relative_path,
                        frontmatter: IndexMap::new(),
                        created_at: created_at.map(|v| v as u64),
                        modified_at: modified_at.map(|v| v as u64),
                        trashed_at: trashed_at.map(|v| v as u64),
                        file_type: FileType::Markdown,
                    })
                },
            )
            .optional()?
            .ok_or_else(|| WorkspaceError::PageNotFound(relative_path.to_string()))
    }

    pub fn list_trash(&self) -> Result<Vec<PageMeta>, WorkspaceError> {
        let mut stmt = self.conn.prepare(
            "SELECT relative_path, title, created_at, modified_at, trashed_at
             FROM pages WHERE trashed_at IS NOT NULL ORDER BY relative_path",
        )?;
        let rows = stmt
            .query_map([], |r| {
                let relative_path: String = r.get(0)?;
                let title: String = r.get(1)?;
                let created_at: Option<i64> = r.get(2)?;
                let modified_at: Option<i64> = r.get(3)?;
                let trashed_at: Option<i64> = r.get(4)?;
                Ok(PageMeta {
                    title,
                    relative_path,
                    frontmatter: IndexMap::new(),
                    created_at: created_at.map(|v| v as u64),
                    modified_at: modified_at.map(|v| v as u64),
                    trashed_at: trashed_at.map(|v| v as u64),
                    file_type: FileType::Markdown,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    pub fn empty_trash(&self) -> Result<usize, WorkspaceError> {
        let rows = self
            .conn
            .execute("DELETE FROM pages WHERE trashed_at IS NOT NULL", [])?;
        Ok(rows)
    }

    // --- Listing / indexer support ---

    pub fn list_pages(&self) -> Result<Vec<PageMeta>, WorkspaceError> {
        let mut stmt = self.conn.prepare(
            "SELECT relative_path, title, created_at, modified_at
             FROM pages WHERE trashed_at IS NULL ORDER BY relative_path",
        )?;
        let rows = stmt
            .query_map([], |r| {
                let relative_path: String = r.get(0)?;
                let title: String = r.get(1)?;
                let created_at: Option<i64> = r.get(2)?;
                let modified_at: Option<i64> = r.get(3)?;
                Ok(PageMeta {
                    title,
                    relative_path,
                    frontmatter: IndexMap::new(),
                    created_at: created_at.map(|v| v as u64),
                    modified_at: modified_at.map(|v| v as u64),
                    trashed_at: None,
                    file_type: FileType::Markdown,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    pub fn all_pages_with_mtime(&self) -> Result<Vec<(String, i64)>, WorkspaceError> {
        let mut stmt = self.conn.prepare(
            "SELECT relative_path, COALESCE(modified_at, 0)
             FROM pages WHERE trashed_at IS NULL",
        )?;
        let rows = stmt
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    pub fn read_raw_content(&self, relative_path: &str) -> Result<String, WorkspaceError> {
        let row: Option<(String, String)> = self
            .conn
            .query_row(
                "SELECT frontmatter_yaml, body FROM pages
                 WHERE relative_path = ?1 AND trashed_at IS NULL",
                params![relative_path],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()?;

        let (yaml, body) =
            row.ok_or_else(|| WorkspaceError::PageNotFound(relative_path.to_string()))?;

        if yaml.trim().is_empty() {
            Ok(body)
        } else {
            Ok(format!("---\n{yaml}---\n{body}"))
        }
    }

    // --- Search ---

    pub fn search_content(
        &self,
        query: &str,
        limit: i64,
    ) -> Result<Vec<SearchHit>, WorkspaceError> {
        let terms: Vec<&str> = query.split_whitespace().collect();
        let has_short_term = terms.iter().any(|t| t.chars().count() < 3);

        if terms.is_empty() {
            return Ok(Vec::new());
        }

        if has_short_term {
            // FTS5 trigram tokenizer cannot MATCH terms shorter than 3 chars;
            // fall back to LIKE over title/body (mirrors graph search_annotations).
            let mut conditions = Vec::new();
            let mut sql_params: Vec<rusqlite::types::Value> = Vec::new();
            let mut idx = 1;

            for term in &terms {
                let clean = term.replace('%', "").replace('_', "");
                conditions.push(format!("(p.title LIKE ?{idx} OR p.body LIKE ?{idx})"));
                sql_params.push(rusqlite::types::Value::Text(format!("%{clean}%")));
                idx += 1;
            }

            let where_clause = conditions.join(" AND ");
            let sql = format!(
                "SELECT p.relative_path, p.title, p.body
                 FROM pages p
                 WHERE {where_clause} AND p.trashed_at IS NULL
                 ORDER BY length(p.body) ASC
                 LIMIT ?{idx}"
            );
            sql_params.push(rusqlite::types::Value::Integer(limit));

            let mut stmt = self.conn.prepare(&sql)?;
            let param_refs: Vec<&dyn rusqlite::types::ToSql> = sql_params
                .iter()
                .map(|v| v as &dyn rusqlite::types::ToSql)
                .collect();
            let rows = stmt
                .query_map(param_refs.as_slice(), |r| {
                    let relative_path: String = r.get(0)?;
                    let title: String = r.get(1)?;
                    let body: String = r.get(2)?;
                    let snippet: String = body.chars().take(120).collect();
                    Ok(SearchHit {
                        relative_path,
                        title,
                        snippet,
                    })
                })?
                .collect::<Result<Vec<_>, _>>()?;
            Ok(rows)
        } else {
            let fts_query: String = terms
                .iter()
                .map(|w| format!("\"{}\"", w.replace('"', "")))
                .collect::<Vec<_>>()
                .join(" ");

            let mut stmt = self.conn.prepare(
                "SELECT p.relative_path, p.title,
                        snippet(pages_fts, 1, '', '', '…', 12)
                 FROM pages_fts f
                 JOIN pages p ON p.rowid = f.rowid
                 WHERE pages_fts MATCH ?1 AND p.trashed_at IS NULL
                 ORDER BY rank
                 LIMIT ?2",
            )?;
            let rows = stmt
                .query_map(params![fts_query, limit], |r| {
                    Ok(SearchHit {
                        relative_path: r.get(0)?,
                        title: r.get(1)?,
                        snippet: r.get(2)?,
                    })
                })?
                .collect::<Result<Vec<_>, _>>()?;
            Ok(rows)
        }
    }

    // --- Assets ---

    pub fn write_asset(
        &self,
        relative_path: &str,
        data: &[u8],
        mime_type: Option<&str>,
    ) -> Result<(), WorkspaceError> {
        if data.len() > MAX_ASSET_BYTES {
            return Err(WorkspaceError::IoError("asset exceeds 50 MB".to_string()));
        }
        let now = Self::now_ms();
        let size = data.len() as i64;
        self.conn.execute(
            "INSERT INTO assets(relative_path, data, mime_type, size_bytes, created_at, modified_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?5)
             ON CONFLICT(relative_path) DO UPDATE SET
                data = excluded.data,
                mime_type = excluded.mime_type,
                size_bytes = excluded.size_bytes,
                modified_at = excluded.modified_at",
            params![relative_path, data, mime_type, size, now],
        )?;
        Ok(())
    }

    pub fn read_asset(
        &self,
        relative_path: &str,
    ) -> Result<(Vec<u8>, Option<String>), WorkspaceError> {
        let row: Option<(Vec<u8>, Option<String>)> = self
            .conn
            .query_row(
                "SELECT data, mime_type FROM assets WHERE relative_path = ?1",
                params![relative_path],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()?;
        row.ok_or_else(|| WorkspaceError::PageNotFound(relative_path.to_string()))
    }

    /// List all asset relative paths (sorted). Used by migration (DB -> Files)
    /// to enumerate assets to write back to disk.
    pub fn list_asset_paths(&self) -> Result<Vec<String>, WorkspaceError> {
        let mut stmt = self
            .conn
            .prepare("SELECT relative_path FROM assets ORDER BY relative_path")?;
        let rows = stmt
            .query_map([], |r| r.get::<_, String>(0))?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fm_with_title(title: &str) -> IndexMap<String, serde_yaml::Value> {
        let mut fm = IndexMap::new();
        fm.insert(
            "title".to_string(),
            serde_yaml::Value::String(title.to_string()),
        );
        fm
    }

    // --- schema / constructor ---

    #[test]
    fn open_memory_creates_tables() {
        let store = NotesStore::open_memory().unwrap();
        let tables: Vec<String> = {
            let mut stmt = store
                .conn
                .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
                .unwrap();
            stmt.query_map([], |row| row.get(0))
                .unwrap()
                .collect::<Result<_, _>>()
                .unwrap()
        };
        assert!(tables.contains(&"pages".to_string()));
        assert!(tables.contains(&"pages_fts".to_string()));
        assert!(tables.contains(&"assets".to_string()));
        assert!(tables.contains(&"meta".to_string()));
    }

    #[test]
    fn schema_version_is_1() {
        let store = NotesStore::open_memory().unwrap();
        assert_eq!(store.schema_version().unwrap(), CURRENT_SCHEMA_VERSION);
    }

    #[test]
    fn open_file_is_idempotent() {
        let dir = tempfile::tempdir().unwrap();
        let db_path = dir.path().join(".lit").join("notes.db");
        {
            let store = NotesStore::open(&db_path).unwrap();
            assert_eq!(store.schema_version().unwrap(), 1);
        }
        {
            let store = NotesStore::open(&db_path).unwrap();
            assert_eq!(store.schema_version().unwrap(), 1);
        }
    }

    // --- CRUD ---

    #[test]
    fn write_then_read_round_trips_body_and_frontmatter() {
        let store = NotesStore::open_memory().unwrap();
        let fm = fm_with_title("Hello");
        store.write_page("Note.md", "# Content\n", &fm).unwrap();

        let page = store.read_page("Note.md").unwrap();
        assert_eq!(page.body, "# Content\n");
        assert_eq!(
            page.meta.frontmatter.get("title"),
            Some(&serde_yaml::Value::String("Hello".to_string()))
        );
        assert_eq!(page.meta.title, "Note");
    }

    #[test]
    fn write_page_twice_updates_body_preserves_created_at() {
        let store = NotesStore::open_memory().unwrap();
        store.write_page("N.md", "first", &IndexMap::new()).unwrap();
        let created_1: i64 = store
            .conn
            .query_row(
                "SELECT created_at FROM pages WHERE relative_path='N.md'",
                [],
                |r| r.get(0),
            )
            .unwrap();

        // Force a measurable time gap.
        std::thread::sleep(std::time::Duration::from_millis(2));
        store
            .write_page("N.md", "second", &IndexMap::new())
            .unwrap();

        let (created_2, modified_2): (i64, i64) = store
            .conn
            .query_row(
                "SELECT created_at, modified_at FROM pages WHERE relative_path='N.md'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();

        assert_eq!(store.read_page("N.md").unwrap().body, "second");
        assert_eq!(created_1, created_2, "created_at preserved");
        assert!(modified_2 >= created_2, "modified_at bumped");
    }

    #[test]
    fn create_page_returns_meta_and_reads_back() {
        let store = NotesStore::open_memory().unwrap();
        let meta = store.create_page("New Page", None).unwrap();
        assert_eq!(meta.title, "New Page");
        assert_eq!(meta.relative_path, "New Page.md");
        assert!(store.read_page("New Page.md").is_ok());
    }

    #[test]
    fn create_page_in_subdir() {
        let store = NotesStore::open_memory().unwrap();
        let meta = store.create_page("Entry", Some("journal")).unwrap();
        assert_eq!(meta.relative_path, "journal/Entry.md");
    }

    #[test]
    fn create_duplicate_page_errors() {
        let store = NotesStore::open_memory().unwrap();
        store.create_page("Dupe", None).unwrap();
        let result = store.create_page("Dupe", None);
        assert!(matches!(result, Err(WorkspaceError::PageAlreadyExists(_))));
    }

    #[test]
    fn create_page_over_trashed_path_succeeds() {
        let store = NotesStore::open_memory().unwrap();
        store.create_page("Recycled", None).unwrap();
        store.trash_page("Recycled.md").unwrap();

        let meta = store.create_page("Recycled", None).unwrap();
        assert_eq!(meta.relative_path, "Recycled.md");
        assert_eq!(meta.title, "Recycled");
        assert!(store.read_page("Recycled.md").is_ok());
        assert!(store.list_trash().unwrap().is_empty());
        assert_eq!(store.list_pages().unwrap().len(), 1);
    }

    #[test]
    fn create_page_forbidden_chars_errors() {
        let store = NotesStore::open_memory().unwrap();
        let result = store.create_page("bad/name", None);
        assert!(matches!(result, Err(WorkspaceError::InvalidPageName(_))));
    }

    #[test]
    fn rename_page_moves_content() {
        let store = NotesStore::open_memory().unwrap();
        store
            .write_page("old.md", "content", &IndexMap::new())
            .unwrap();
        let new_path = store.rename_page("old.md", "new").unwrap();
        assert_eq!(new_path, "new.md");
        assert!(matches!(
            store.read_page("old.md"),
            Err(WorkspaceError::PageNotFound(_))
        ));
        assert_eq!(store.read_page("new.md").unwrap().body, "content");
    }

    #[test]
    fn rename_to_existing_errors() {
        let store = NotesStore::open_memory().unwrap();
        store.write_page("a.md", "a", &IndexMap::new()).unwrap();
        store.write_page("b.md", "b", &IndexMap::new()).unwrap();
        let result = store.rename_page("a.md", "b");
        assert!(matches!(result, Err(WorkspaceError::PageAlreadyExists(_))));
    }

    #[test]
    fn rename_preserves_parent_dir() {
        let store = NotesStore::open_memory().unwrap();
        store
            .write_page("journal/old.md", "x", &IndexMap::new())
            .unwrap();
        let new_path = store.rename_page("journal/old.md", "new").unwrap();
        assert_eq!(new_path, "journal/new.md");
    }

    #[test]
    fn rename_to_path_of_trashed_page_succeeds() {
        let store = NotesStore::open_memory().unwrap();
        store.write_page("keep.md", "k", &IndexMap::new()).unwrap();
        store.write_page("taken.md", "t", &IndexMap::new()).unwrap();
        store.trash_page("taken.md").unwrap();
        // A trashed page at the destination must not block the rename with
        // a spurious PageAlreadyExists error.
        let result = store.rename_page("keep.md", "taken");
        assert!(
            !matches!(result, Err(WorkspaceError::PageAlreadyExists(_))),
            "trashed destination row should not cause PageAlreadyExists, got {result:?}"
        );
    }

    #[test]
    fn rename_of_trashed_page_errors() {
        let store = NotesStore::open_memory().unwrap();
        store.write_page("gone.md", "g", &IndexMap::new()).unwrap();
        store.trash_page("gone.md").unwrap();
        let result = store.rename_page("gone.md", "renamed");
        assert!(matches!(result, Err(WorkspaceError::PageNotFound(_))));
        // Trashed row must remain untouched under its original path.
        let trash = store.list_trash().unwrap();
        assert_eq!(trash.len(), 1);
        assert_eq!(trash[0].relative_path, "gone.md");
    }

    #[test]
    fn delete_page_removes_row() {
        let store = NotesStore::open_memory().unwrap();
        store
            .write_page("doomed.md", "bye", &IndexMap::new())
            .unwrap();
        store.delete_page("doomed.md").unwrap();
        assert!(matches!(
            store.read_page("doomed.md"),
            Err(WorkspaceError::PageNotFound(_))
        ));
    }

    #[test]
    fn delete_missing_page_errors() {
        let store = NotesStore::open_memory().unwrap();
        let result = store.delete_page("nope.md");
        assert!(matches!(result, Err(WorkspaceError::PageNotFound(_))));
    }

    // --- Trash ---

    #[test]
    fn trash_page_hides_from_listings() {
        let store = NotesStore::open_memory().unwrap();
        store.write_page("t.md", "x", &IndexMap::new()).unwrap();
        store.trash_page("t.md").unwrap();

        assert!(store.list_pages().unwrap().is_empty());
        assert!(matches!(
            store.read_page("t.md"),
            Err(WorkspaceError::PageNotFound(_))
        ));
        let trash = store.list_trash().unwrap();
        assert_eq!(trash.len(), 1);
        assert_eq!(trash[0].relative_path, "t.md");
    }

    #[test]
    fn get_page_meta_returns_trashed_row_with_trashed_at() {
        let store = NotesStore::open_memory().unwrap();
        store.write_page("g.md", "x", &IndexMap::new()).unwrap();
        store.trash_page("g.md").unwrap();

        let meta = store.get_page_meta("g.md").unwrap();
        assert_eq!(meta.relative_path, "g.md");
        assert_eq!(meta.title, "g");
        // trashed_at must be selected so synthesize_trash_entry preserves the
        // deletion timestamp (F4 dependency).
        assert!(meta.trashed_at.is_some());

        // A non-trashed (active) page must NOT be returned.
        store
            .write_page("active.md", "y", &IndexMap::new())
            .unwrap();
        assert!(matches!(
            store.get_page_meta("active.md"),
            Err(WorkspaceError::PageNotFound(_))
        ));

        // A missing path errors with PageNotFound.
        assert!(matches!(
            store.get_page_meta("missing.md"),
            Err(WorkspaceError::PageNotFound(_))
        ));
    }

    #[test]
    fn restore_page_unhides() {
        let store = NotesStore::open_memory().unwrap();
        store.write_page("r.md", "x", &IndexMap::new()).unwrap();
        store.trash_page("r.md").unwrap();
        store.restore_page("r.md").unwrap();

        let pages = store.list_pages().unwrap();
        assert_eq!(pages.len(), 1);
        assert_eq!(pages[0].relative_path, "r.md");
    }

    #[test]
    fn write_page_over_trashed_path_untrashes() {
        let store = NotesStore::open_memory().unwrap();
        store.write_page("t.md", "first", &IndexMap::new()).unwrap();
        store.trash_page("t.md").unwrap();
        assert!(matches!(
            store.read_page("t.md"),
            Err(WorkspaceError::PageNotFound(_))
        ));

        store
            .write_page("t.md", "second", &IndexMap::new())
            .unwrap();
        assert_eq!(store.read_page("t.md").unwrap().body, "second");
        assert!(store.list_trash().unwrap().is_empty());
        assert_eq!(store.list_pages().unwrap().len(), 1);
    }

    #[test]
    fn restore_non_trashed_errors() {
        let store = NotesStore::open_memory().unwrap();
        store.write_page("a.md", "x", &IndexMap::new()).unwrap();
        let result = store.restore_page("a.md");
        assert!(matches!(result, Err(WorkspaceError::TrashEntryNotFound(_))));
    }

    #[test]
    fn purge_page_removes_trashed() {
        let store = NotesStore::open_memory().unwrap();
        store.write_page("p.md", "x", &IndexMap::new()).unwrap();
        store.trash_page("p.md").unwrap();
        store.purge_page("p.md").unwrap();
        assert!(store.list_trash().unwrap().is_empty());
    }

    #[test]
    fn empty_trash_counts_and_keeps_active() {
        let store = NotesStore::open_memory().unwrap();
        store
            .write_page("active.md", "x", &IndexMap::new())
            .unwrap();
        store.write_page("t1.md", "x", &IndexMap::new()).unwrap();
        store.write_page("t2.md", "x", &IndexMap::new()).unwrap();
        store.trash_page("t1.md").unwrap();
        store.trash_page("t2.md").unwrap();

        let count = store.empty_trash().unwrap();
        assert_eq!(count, 2);
        let pages = store.list_pages().unwrap();
        assert_eq!(pages.len(), 1);
        assert_eq!(pages[0].relative_path, "active.md");
    }

    // --- listing ---

    #[test]
    fn list_pages_sorted_by_relative_path() {
        let store = NotesStore::open_memory().unwrap();
        store.write_page("c.md", "x", &IndexMap::new()).unwrap();
        store.write_page("a.md", "x", &IndexMap::new()).unwrap();
        store.write_page("b.md", "x", &IndexMap::new()).unwrap();

        let paths: Vec<String> = store
            .list_pages()
            .unwrap()
            .into_iter()
            .map(|p| p.relative_path)
            .collect();
        assert_eq!(paths, vec!["a.md", "b.md", "c.md"]);
    }

    #[test]
    fn all_pages_with_mtime_active_only() {
        let store = NotesStore::open_memory().unwrap();
        store.write_page("a.md", "x", &IndexMap::new()).unwrap();
        store.write_page("b.md", "x", &IndexMap::new()).unwrap();
        store.trash_page("b.md").unwrap();

        let rows = store.all_pages_with_mtime().unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].0, "a.md");
        assert!(rows[0].1 > 0);
    }

    #[test]
    fn read_raw_content_reconstructs() {
        let store = NotesStore::open_memory().unwrap();
        store
            .write_page("fm.md", "# Body\n", &fm_with_title("T"))
            .unwrap();
        store
            .write_page("plain.md", "# Just body\n", &IndexMap::new())
            .unwrap();

        let raw_fm = store.read_raw_content("fm.md").unwrap();
        assert!(raw_fm.starts_with("---\n"));
        assert!(raw_fm.contains("title: T"));
        assert!(raw_fm.ends_with("# Body\n"));

        let raw_plain = store.read_raw_content("plain.md").unwrap();
        assert_eq!(raw_plain, "# Just body\n");
    }

    // --- content hash ---

    #[test]
    fn content_hash_deterministic_and_distinct() {
        let h1 = NotesStore::content_hash("title: a\n", "body");
        let h2 = NotesStore::content_hash("title: a\n", "body");
        let h3 = NotesStore::content_hash("title: b\n", "body");
        let h4 = NotesStore::content_hash("title: a\n", "different");
        assert_eq!(h1, h2);
        assert_ne!(h1, h3);
        assert_ne!(h1, h4);
        assert!(h1.starts_with("sha256:"));
    }

    // --- search ---

    #[test]
    fn search_content_fts_path() {
        let store = NotesStore::open_memory().unwrap();
        store
            .write_page("doc.md", "the quick brown fox", &IndexMap::new())
            .unwrap();
        store
            .write_page("other.md", "lazy dog sleeping", &IndexMap::new())
            .unwrap();

        let hits = store.search_content("brown", 10).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].relative_path, "doc.md");
    }

    #[test]
    fn search_content_short_term_like_fallback() {
        let store = NotesStore::open_memory().unwrap();
        store
            .write_page("doc.md", "hi there world", &IndexMap::new())
            .unwrap();

        // "hi" is < 3 chars: trigram MATCH would return nothing; LIKE must work.
        let hits = store.search_content("hi", 10).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].relative_path, "doc.md");
    }

    #[test]
    fn search_content_excludes_trashed() {
        let store = NotesStore::open_memory().unwrap();
        store
            .write_page("doc.md", "the quick brown fox", &IndexMap::new())
            .unwrap();
        store.trash_page("doc.md").unwrap();

        let hits = store.search_content("brown", 10).unwrap();
        assert!(hits.is_empty());

        // Also verify exclusion for the short-term LIKE path.
        store
            .write_page("doc2.md", "hi there", &IndexMap::new())
            .unwrap();
        store.trash_page("doc2.md").unwrap();
        let short = store.search_content("hi", 10).unwrap();
        assert!(short.is_empty());
    }

    // --- assets ---

    #[test]
    fn asset_round_trip() {
        let store = NotesStore::open_memory().unwrap();
        let data = vec![1u8, 2, 3, 4, 5];
        store
            .write_asset("img/a.png", &data, Some("image/png"))
            .unwrap();
        let (bytes, mime) = store.read_asset("img/a.png").unwrap();
        assert_eq!(bytes, data);
        assert_eq!(mime, Some("image/png".to_string()));
    }

    #[test]
    fn write_asset_rejects_oversized() {
        let store = NotesStore::open_memory().unwrap();
        let big = vec![0u8; MAX_ASSET_BYTES + 1];
        let result = store.write_asset("big.bin", &big, None);
        assert!(matches!(result, Err(WorkspaceError::IoError(_))));
    }

    // --- bulk import (migration support) ---

    #[test]
    fn import_all_round_trips_pages_and_assets() {
        let mut store = NotesStore::open_memory().unwrap();
        let pages = vec![
            PageImport {
                relative_path: "fm.md".to_string(),
                body: "# Body\n".to_string(),
                frontmatter: fm_with_title("Hello"),
                created_at: None,
                modified_at: None,
            },
            PageImport {
                relative_path: "plain.md".to_string(),
                body: "just body".to_string(),
                frontmatter: IndexMap::new(),
                created_at: None,
                modified_at: None,
            },
        ];
        let assets = vec![AssetImport {
            relative_path: "img/a.png".to_string(),
            data: vec![9u8, 8, 7],
            mime_type: Some("image/png".to_string()),
        }];

        store.import_all(&pages, &assets).unwrap();

        let fm = store.read_page("fm.md").unwrap();
        assert_eq!(fm.body, "# Body\n");
        assert_eq!(
            fm.meta.frontmatter.get("title"),
            Some(&serde_yaml::Value::String("Hello".to_string()))
        );
        let plain = store.read_page("plain.md").unwrap();
        assert_eq!(plain.body, "just body");

        let raw = store.read_raw_content("fm.md").unwrap();
        assert!(raw.starts_with("---\n"));
        assert!(raw.contains("title: Hello"));

        let (bytes, mime) = store.read_asset("img/a.png").unwrap();
        assert_eq!(bytes, vec![9u8, 8, 7]);
        assert_eq!(mime, Some("image/png".to_string()));
    }

    #[test]
    fn import_all_preserves_supplied_timestamps() {
        let mut store = NotesStore::open_memory().unwrap();
        let pages = vec![PageImport {
            relative_path: "t.md".to_string(),
            body: "x".to_string(),
            frontmatter: IndexMap::new(),
            created_at: Some(111),
            modified_at: Some(222),
        }];
        store.import_all(&pages, &[]).unwrap();

        let (created, modified): (i64, i64) = store
            .conn
            .query_row(
                "SELECT created_at, modified_at FROM pages WHERE relative_path='t.md'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(created, 111);
        assert_eq!(modified, 222);
    }

    #[test]
    fn import_all_resets_trashed_at_on_conflict() {
        let mut store = NotesStore::open_memory().unwrap();
        let pages = vec![PageImport {
            relative_path: "trashed.md".to_string(),
            body: "v1".to_string(),
            frontmatter: IndexMap::new(),
            created_at: None,
            modified_at: None,
        }];
        store.import_all(&pages, &[]).unwrap();

        store.trash_page("trashed.md").unwrap();
        assert!(
            store.list_pages().unwrap().is_empty(),
            "page should be trashed after trash_page"
        );

        // Re-run the Files->DB migration. The upsert must resurrect the page.
        store.import_all(&pages, &[]).unwrap();

        let pages_after = store.list_pages().unwrap();
        assert_eq!(pages_after.len(), 1);
        assert_eq!(pages_after[0].relative_path, "trashed.md");
        assert!(store.read_page("trashed.md").is_ok());
    }

    #[test]
    fn import_all_is_atomic_on_failure() {
        let mut store = NotesStore::open_memory().unwrap();
        // Install a trigger that RAISES whenever a page titled "Boom" is
        // inserted, so the SECOND page in the batch fails. A correct
        // transaction must then roll back the FIRST (already-inserted) page,
        // leaving zero rows — proving all-or-nothing.
        store
            .conn
            .execute_batch(
                "CREATE TRIGGER boom_guard BEFORE INSERT ON pages
                 WHEN new.title = 'Boom' BEGIN
                    SELECT RAISE(ABORT, 'boom');
                 END;",
            )
            .unwrap();

        let pages = vec![
            PageImport {
                relative_path: "first.md".to_string(),
                body: "first".to_string(),
                frontmatter: IndexMap::new(),
                created_at: None,
                modified_at: None,
            },
            PageImport {
                // title derives to "Boom" → trips the guard trigger.
                relative_path: "Boom.md".to_string(),
                body: "boom".to_string(),
                frontmatter: IndexMap::new(),
                created_at: None,
                modified_at: None,
            },
        ];

        let result = store.import_all(&pages, &[]);
        assert!(result.is_err());
        // first.md must NOT have been committed (atomic rollback).
        assert!(matches!(
            store.read_page("first.md"),
            Err(WorkspaceError::PageNotFound(_))
        ));
        assert!(store.list_pages().unwrap().is_empty());
    }

    #[test]
    fn list_asset_paths_returns_written_assets() {
        let store = NotesStore::open_memory().unwrap();
        store.write_asset("z.png", &[1u8], None).unwrap();
        store.write_asset("a.png", &[2u8], None).unwrap();
        let paths = store.list_asset_paths().unwrap();
        assert_eq!(paths, vec!["a.png".to_string(), "z.png".to_string()]);
    }

    // --- not-found behavior ---

    #[test]
    fn read_missing_page_and_asset_return_not_found() {
        let store = NotesStore::open_memory().unwrap();
        assert!(matches!(
            store.read_page("nope.md"),
            Err(WorkspaceError::PageNotFound(_))
        ));
        assert!(matches!(
            store.read_asset("nope.png"),
            Err(WorkspaceError::PageNotFound(_))
        ));
    }
}
