use std::collections::HashMap;
use std::path::Path;

use rusqlite::Connection;
use tracing::{debug, info};

use super::error::GraphError;
use super::types::{extract_aliases, AnnotationSearchResult, BacklinkEntry, IndexableAnnotation, LinkEntry, ParsedNode, Stats};

pub const CURRENT_SCHEMA_VERSION: i64 = 6;

fn map_annotation_row(row: &rusqlite::Row) -> Result<AnnotationSearchResult, rusqlite::Error> {
    Ok(AnnotationSearchResult {
        annotation_id: row.get(0)?,
        node_id: row.get(1)?,
        node_title: row.get(2)?,
        annotation_type: row.get(3)?,
        certainty: row.get(4)?,
        body: row.get(5)?,
        date: row.get(6)?,
        source_line: row.get(7)?,
        char_start: row.get(8)?,
        char_end: row.get(9)?,
    })
}

pub struct Store {
    pub(crate) conn: Connection,
}

impl Store {
    pub fn open(path: &Path) -> Result<Self, GraphError> {
        info!(path = %path.display(), "opening store");
        let conn = Connection::open(path)?;
        let store = Self { conn };
        store.migrate()?;
        Ok(store)
    }

    pub fn open_memory() -> Result<Self, GraphError> {
        debug!("opening in-memory store");
        let conn = Connection::open_in_memory()?;
        let store = Self { conn };
        store.migrate()?;
        Ok(store)
    }

    fn migrate(&self) -> Result<(), GraphError> {
        self.conn.execute_batch("PRAGMA journal_mode=WAL;")?;
        self.conn.execute_batch("PRAGMA foreign_keys=ON;")?;

        self.conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS nodes (
                id TEXT PRIMARY KEY,
                title TEXT,
                first_paragraph TEXT,
                frontmatter JSON,
                mtime INTEGER,
                is_stub INTEGER DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS tags (
                node_id TEXT,
                tag TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_tags_node_id ON tags(node_id);

            CREATE TABLE IF NOT EXISTS aliases (
                node_id TEXT,
                alias TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_aliases_node_id ON aliases(node_id);

            CREATE TABLE IF NOT EXISTS edges (
                source TEXT,
                target TEXT,
                context TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(source);
            CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(target);

            CREATE TABLE IF NOT EXISTS sync (
                path TEXT PRIMARY KEY,
                mtime INTEGER
            );

            CREATE TABLE IF NOT EXISTS meta (
                key TEXT PRIMARY KEY,
                value TEXT
            );

            INSERT OR IGNORE INTO meta(key, value) VALUES ('schema_version', '1');",
        )?;

        let version = self.schema_version()?;

        if version > CURRENT_SCHEMA_VERSION {
            info!(
                found = version,
                expected = CURRENT_SCHEMA_VERSION,
                "schema version from the future — resetting store"
            );
            self.conn.execute_batch(
                "DROP TABLE IF EXISTS nodes;
                 DROP TABLE IF EXISTS tags;
                 DROP TABLE IF EXISTS aliases;
                 DROP TABLE IF EXISTS edges;
                 DROP TABLE IF EXISTS sync;
                 DROP TABLE IF EXISTS meta;"
            )?;
            return self.migrate();
        }

        if version < 2 {
            info!(from = 1, to = 2, "migrating schema");
            self.conn
                .execute_batch("ALTER TABLE nodes ADD COLUMN tags_text TEXT DEFAULT '';")?;
            self.conn.execute_batch(
                "UPDATE nodes SET tags_text = COALESCE(
                    (SELECT group_concat(tag, ' ') FROM tags WHERE tags.node_id = nodes.id),
                    ''
                );",
            )?;
            self.conn.execute_batch(
                "UPDATE meta SET value = '2' WHERE key = 'schema_version';",
            )?;
        }

        if version < 3 {
            info!(from = version, to = 3, "migrating schema");
            self.conn
                .execute_batch("ALTER TABLE edges ADD COLUMN raw_target TEXT DEFAULT '';")?;
            self.conn.execute_batch(
                "UPDATE meta SET value = '3' WHERE key = 'schema_version';",
            )?;
        }

        if version < 4 {
            info!(from = version, to = 4, "migrating schema");
            self.conn
                .execute_batch("ALTER TABLE edges ADD COLUMN source_line INTEGER DEFAULT 0;")?;
            self.conn.execute_batch(
                "UPDATE meta SET value = '4' WHERE key = 'schema_version';",
            )?;
        }

        if version < 5 {
            info!(from = version, to = 5, "migrating schema: dropping FTS5");
            self.conn.execute_batch(
                "DROP TRIGGER IF EXISTS nodes_fts_insert;
                 DROP TRIGGER IF EXISTS nodes_fts_delete;
                 DROP TRIGGER IF EXISTS nodes_fts_update;
                 DROP TABLE IF EXISTS nodes_fts;
                 UPDATE meta SET value = '5' WHERE key = 'schema_version';"
            )?;
        }

        if version < 6 {
            info!(from = version, to = 6, "migrating schema: adding annotations + FTS5");
            self.conn.execute_batch(
                "CREATE TABLE IF NOT EXISTS annotations (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    node_id TEXT NOT NULL,
                    annotation_type TEXT NOT NULL,
                    certainty TEXT NOT NULL,
                    body TEXT,
                    date TEXT,
                    source_line INTEGER NOT NULL,
                    char_start INTEGER NOT NULL,
                    char_end INTEGER NOT NULL,
                    scope_kind TEXT NOT NULL,
                    scope_value TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_annotations_node_id ON annotations(node_id);
                CREATE INDEX IF NOT EXISTS idx_annotations_type ON annotations(annotation_type);
                CREATE VIRTUAL TABLE IF NOT EXISTS annotations_fts USING fts5(body, node_id UNINDEXED, annotation_type UNINDEXED);
                UPDATE meta SET value = '6' WHERE key = 'schema_version';"
            )?;
        }

        Ok(())
    }

    pub fn has_data(&self) -> Result<bool, GraphError> {
        let exists: bool = self.conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM nodes LIMIT 1)",
            [],
            |row| row.get(0),
        )?;
        Ok(exists)
    }

    pub fn schema_version(&self) -> Result<i64, GraphError> {
        let version: String = self.conn.query_row(
            "SELECT value FROM meta WHERE key = 'schema_version'",
            [],
            |row| row.get(0),
        )?;
        Ok(version.parse::<i64>().unwrap_or(0))
    }

    // --- CRUD ---

    pub fn upsert_node(&self, node: &ParsedNode, mtime: i64) -> Result<(), GraphError> {
        let fm_json = serde_json::to_string(&node.frontmatter).unwrap_or_default();
        let tags_text = node.tags.join(" ");

        self.conn.execute(
            "INSERT OR REPLACE INTO nodes(id, title, first_paragraph, frontmatter, mtime, is_stub, tags_text)
             VALUES (?1, ?2, ?3, ?4, ?5, 0, ?6)",
            rusqlite::params![node.id, node.title, node.first_paragraph, fm_json, mtime, tags_text],
        )?;

        self.conn
            .execute("DELETE FROM tags WHERE node_id = ?1", [&node.id])?;
        for tag in &node.tags {
            self.conn.execute(
                "INSERT INTO tags(node_id, tag) VALUES (?1, ?2)",
                rusqlite::params![node.id, tag],
            )?;
        }

        self.conn
            .execute("DELETE FROM aliases WHERE node_id = ?1", [&node.id])?;
        let aliases = extract_aliases(&node.frontmatter);
        for alias in &aliases {
            self.conn.execute(
                "INSERT INTO aliases(node_id, alias) VALUES (?1, ?2)",
                rusqlite::params![node.id, alias],
            )?;
        }

        self.conn.execute(
            "INSERT OR REPLACE INTO sync(path, mtime) VALUES (?1, ?2)",
            rusqlite::params![node.id, mtime],
        )?;

        Ok(())
    }

    pub fn upsert_stub(&self, id: &str) -> Result<(), GraphError> {
        self.conn.execute(
            "INSERT OR IGNORE INTO nodes(id, title, first_paragraph, frontmatter, mtime, is_stub)
             VALUES (?1, '', '', '{}', 0, 1)",
            [id],
        )?;
        Ok(())
    }

    pub fn delete_node(&self, id: &str) -> Result<(), GraphError> {
        self.conn.execute("DELETE FROM annotations_fts WHERE node_id = ?1", [id])?;
        self.conn.execute("DELETE FROM annotations WHERE node_id = ?1", [id])?;
        self.conn.execute("DELETE FROM nodes WHERE id = ?1", [id])?;
        self.conn
            .execute("DELETE FROM tags WHERE node_id = ?1", [id])?;
        self.conn
            .execute("DELETE FROM aliases WHERE node_id = ?1", [id])?;
        self.conn
            .execute("DELETE FROM edges WHERE source = ?1 OR target = ?1", [id])?;
        self.conn
            .execute("DELETE FROM sync WHERE path = ?1", [id])?;
        Ok(())
    }

    // --- Edges ---

    pub fn insert_edge(&self, source: &str, target: &str, ctx: &str, raw_target: &str, source_line: u32) -> Result<(), GraphError> {
        self.conn.execute(
            "INSERT INTO edges(source, target, context, raw_target, source_line) VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params![source, target, ctx, raw_target, source_line],
        )?;
        Ok(())
    }

    pub fn delete_edges_from(&self, source: &str) -> Result<(), GraphError> {
        self.conn
            .execute("DELETE FROM edges WHERE source = ?1", [source])?;
        Ok(())
    }

    pub fn replace_all_edges(&self, edges: &[(&str, &str, &str, &str, u32)]) -> Result<(), GraphError> {
        self.conn.execute("DELETE FROM edges", [])?;
        for &(source, target, context, raw_target, source_line) in edges {
            self.conn.execute(
                "INSERT INTO edges(source, target, context, raw_target, source_line) VALUES (?1, ?2, ?3, ?4, ?5)",
                rusqlite::params![source, target, context, raw_target, source_line],
            )?;
        }
        Ok(())
    }

    // --- Queries ---

    pub fn get_sync_mtime(&self, path: &str) -> Result<Option<i64>, GraphError> {
        let mut stmt = self.conn.prepare("SELECT mtime FROM sync WHERE path = ?1")?;
        let mut rows = stmt.query([path])?;
        match rows.next()? {
            Some(row) => Ok(Some(row.get(0)?)),
            None => Ok(None),
        }
    }

    pub fn all_sync_entries(&self) -> Result<Vec<(String, i64)>, GraphError> {
        let mut stmt = self.conn.prepare("SELECT path, mtime FROM sync ORDER BY path")?;
        let entries = stmt
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(entries)
    }

    pub fn all_aliases(&self) -> Result<HashMap<String, Vec<String>>, GraphError> {
        let mut stmt = self.conn.prepare("SELECT node_id, alias FROM aliases ORDER BY node_id, alias")?;
        let rows = stmt
            .query_map([], |row| {
                let node_id: String = row.get(0)?;
                let alias: String = row.get(1)?;
                Ok((node_id, alias))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        let mut map: HashMap<String, Vec<String>> = HashMap::new();
        for (node_id, alias) in rows {
            map.entry(node_id).or_default().push(alias);
        }
        Ok(map)
    }

    pub fn all_raw_edges(&self) -> Result<Vec<(String, String, String)>, GraphError> {
        let mut stmt = self.conn.prepare(
            "SELECT source, target, raw_target FROM edges ORDER BY source, target"
        )?;
        let edges = stmt
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(edges)
    }

    pub fn all_synced_paths(&self) -> Result<Vec<String>, GraphError> {
        let mut stmt = self.conn.prepare("SELECT path FROM sync ORDER BY path")?;
        let paths = stmt
            .query_map([], |row| row.get(0))?
            .collect::<Result<Vec<String>, _>>()?;
        Ok(paths)
    }

    pub fn all_node_ids(&self) -> Result<Vec<String>, GraphError> {
        let mut stmt = self.conn.prepare("SELECT id FROM nodes ORDER BY id")?;
        let ids = stmt
            .query_map([], |row| row.get(0))?
            .collect::<Result<Vec<String>, _>>()?;
        Ok(ids)
    }

    pub fn all_edges(&self) -> Result<Vec<(String, String)>, GraphError> {
        let mut stmt = self
            .conn
            .prepare("SELECT source, target FROM edges ORDER BY source, target")?;
        let edges = stmt
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(edges)
    }

    pub fn all_nodes_metadata(&self) -> Result<Vec<(String, bool)>, GraphError> {
        let mut stmt = self
            .conn
            .prepare("SELECT id, is_stub FROM nodes ORDER BY id")?;
        let nodes = stmt
            .query_map([], |row| {
                let id: String = row.get(0)?;
                let is_stub: i64 = row.get(1)?;
                Ok((id, is_stub != 0))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(nodes)
    }

    pub fn node_titles(&self) -> Result<HashMap<String, String>, GraphError> {
        let mut stmt = self.conn.prepare("SELECT id, title FROM nodes")?;
        let map = stmt
            .query_map([], |row| {
                let id: String = row.get(0)?;
                let title: String = row.get(1)?;
                Ok((id, title))
            })?
            .collect::<Result<HashMap<String, String>, _>>()?;
        Ok(map)
    }

    pub fn title_and_aliases(&self, page_id: &str) -> Result<(String, Vec<String>), GraphError> {
        let title: String = self.conn.query_row(
            "SELECT title FROM nodes WHERE id = ?1",
            [page_id],
            |row| row.get(0),
        ).map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => GraphError::NodeNotFound { id: page_id.to_string() },
            other => GraphError::from(other),
        })?;

        let mut stmt = self.conn.prepare("SELECT alias FROM aliases WHERE node_id = ?1 ORDER BY alias")?;
        let aliases = stmt
            .query_map([page_id], |row| row.get(0))?
            .collect::<Result<Vec<String>, _>>()?;

        Ok((title, aliases))
    }

    pub fn backlink_source_ids(&self, page_id: &str) -> Result<std::collections::HashSet<String>, GraphError> {
        let mut stmt = self.conn.prepare(
            "SELECT DISTINCT source FROM edges WHERE target = ?1"
        )?;
        let sources = stmt
            .query_map([page_id], |row| row.get(0))?
            .collect::<Result<std::collections::HashSet<String>, _>>()?;
        Ok(sources)
    }

    // --- Backlinks / Forward links ---

    pub fn backlinks(&self, page_id: &str) -> Result<Vec<BacklinkEntry>, GraphError> {
        let mut stmt = self.conn.prepare(
            "SELECT e.source, n.title, e.context, e.source_line
             FROM edges e
             JOIN nodes n ON n.id = e.source
             WHERE e.target = ?1
             ORDER BY e.source",
        )?;
        let results = stmt
            .query_map([page_id], |row| {
                Ok(BacklinkEntry {
                    source_id: row.get(0)?,
                    source_title: row.get(1)?,
                    context: row.get(2)?,
                    source_line: row.get::<_, u32>(3).unwrap_or(0),
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(results)
    }

    pub fn forward_links(&self, page_id: &str) -> Result<Vec<LinkEntry>, GraphError> {
        let mut stmt = self.conn.prepare(
            "SELECT e.target, n.title, e.raw_target, e.context
             FROM edges e
             JOIN nodes n ON n.id = e.target
             WHERE e.source = ?1
             ORDER BY e.target",
        )?;
        let results = stmt
            .query_map([page_id], |row| {
                Ok(LinkEntry {
                    target_id: row.get(0)?,
                    target_title: row.get(1)?,
                    raw_target: row.get(2)?,
                    context: row.get(3)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(results)
    }

    // --- Meta ---

    pub fn get_meta(&self, key: &str) -> Result<Option<String>, GraphError> {
        let mut stmt = self.conn.prepare("SELECT value FROM meta WHERE key = ?1")?;
        let mut rows = stmt.query([key])?;
        match rows.next()? {
            Some(row) => Ok(Some(row.get(0)?)),
            None => Ok(None),
        }
    }

    pub fn set_meta(&self, key: &str, value: &str) -> Result<(), GraphError> {
        self.conn.execute(
            "INSERT OR REPLACE INTO meta(key, value) VALUES (?1, ?2)",
            rusqlite::params![key, value],
        )?;
        Ok(())
    }

    // --- Title search ---

    pub fn search_titles(&self, query: &str, limit: i64) -> Result<Vec<(String, String)>, GraphError> {
        if query.is_empty() {
            return Ok(vec![]);
        }
        let mut stmt = self.conn.prepare(
            "SELECT id, title FROM nodes
             WHERE title LIKE '%' || ?1 || '%' COLLATE NOCASE
                OR id LIKE '%' || ?1 || '%' COLLATE NOCASE
             UNION
             SELECT a.node_id, n.title FROM aliases a
             JOIN nodes n ON n.id = a.node_id
             WHERE a.alias LIKE '%' || ?1 || '%' COLLATE NOCASE
             LIMIT ?2"
        )?;
        let results = stmt
            .query_map(rusqlite::params![query, limit], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(results)
    }

    // --- Stats ---

    pub fn stats(&self) -> Result<Stats, GraphError> {
        let nodes: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM nodes WHERE is_stub = 0",
            [],
            |row| row.get(0),
        )?;
        let stubs: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM nodes WHERE is_stub = 1",
            [],
            |row| row.get(0),
        )?;
        let edges: i64 = self
            .conn
            .query_row("SELECT COUNT(*) FROM edges", [], |row| row.get(0))?;
        let tags: i64 = self.conn.query_row(
            "SELECT COUNT(DISTINCT tag) FROM tags",
            [],
            |row| row.get(0),
        )?;
        Ok(Stats {
            nodes,
            stubs,
            edges,
            tags,
        })
    }

    pub fn max_mtime(&self) -> Result<i64, GraphError> {
        let mtime: i64 = self.conn.query_row(
            "SELECT COALESCE(MAX(mtime), 0) FROM nodes WHERE is_stub = 0",
            [],
            |row| row.get(0),
        )?;
        Ok(mtime)
    }

    pub fn graph_fingerprint(&self) -> Result<String, GraphError> {
        let stats = self.stats()?;
        let total_nodes = stats.nodes + stats.stubs;
        let max_mtime = self.max_mtime()?;
        Ok(format!("{}:{}:{}", total_nodes, stats.edges, max_mtime))
    }

    // --- Annotations ---

    pub fn upsert_annotations(&self, node_id: &str, annotations: &[IndexableAnnotation]) -> Result<(), GraphError> {
        self.conn.execute("DELETE FROM annotations_fts WHERE node_id = ?1", [node_id])?;
        self.conn.execute("DELETE FROM annotations WHERE node_id = ?1", [node_id])?;
        for ann in annotations {
            self.conn.execute(
                "INSERT INTO annotations(node_id, annotation_type, certainty, body, date, source_line, char_start, char_end, scope_kind, scope_value)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
                rusqlite::params![
                    node_id,
                    ann.annotation_type,
                    ann.certainty,
                    ann.body,
                    ann.date,
                    ann.source_line,
                    ann.char_start,
                    ann.char_end,
                    ann.scope_kind,
                    ann.scope_value,
                ],
            )?;
            if ann.body.is_some() {
                let rowid = self.conn.last_insert_rowid();
                self.conn.execute(
                    "INSERT INTO annotations_fts(rowid, body, node_id, annotation_type) VALUES (?1, ?2, ?3, ?4)",
                    rusqlite::params![rowid, ann.body, node_id, ann.annotation_type],
                )?;
            }
        }
        Ok(())
    }

    pub fn search_annotations(&self, query: &str, type_filter: Option<&str>, limit: i64) -> Result<Vec<AnnotationSearchResult>, GraphError> {
        let fts_query: String = query
            .split_whitespace()
            .map(|w| format!("\"{}\"", w.replace('"', "")))
            .collect::<Vec<_>>()
            .join(" ");

        let (sql, params_count) = if type_filter.is_some() {
            (
                "SELECT a.id, a.node_id, n.title, a.annotation_type, a.certainty, a.body, a.date, a.source_line, a.char_start, a.char_end
                 FROM annotations_fts f
                 JOIN annotations a ON a.id = f.rowid
                 JOIN nodes n ON n.id = a.node_id
                 WHERE annotations_fts MATCH ?1 AND a.annotation_type = ?2
                 LIMIT ?3",
                3,
            )
        } else {
            (
                "SELECT a.id, a.node_id, n.title, a.annotation_type, a.certainty, a.body, a.date, a.source_line, a.char_start, a.char_end
                 FROM annotations_fts f
                 JOIN annotations a ON a.id = f.rowid
                 JOIN nodes n ON n.id = a.node_id
                 WHERE annotations_fts MATCH ?1
                 LIMIT ?2",
                2,
            )
        };

        let mut stmt = self.conn.prepare(sql)?;
        let results = if params_count == 3 {
            stmt.query_map(
                rusqlite::params![fts_query, type_filter.unwrap(), limit],
                map_annotation_row,
            )?
            .collect::<Result<Vec<_>, _>>()?
        } else {
            stmt.query_map(
                rusqlite::params![fts_query, limit],
                map_annotation_row,
            )?
            .collect::<Result<Vec<_>, _>>()?
        };
        Ok(results)
    }

    pub fn list_annotations(&self, node_id: &str, type_filter: Option<&str>, limit: i64) -> Result<Vec<AnnotationSearchResult>, GraphError> {
        if type_filter.is_some() {
            let mut stmt = self.conn.prepare(
                "SELECT a.id, a.node_id, n.title, a.annotation_type, a.certainty, a.body, a.date, a.source_line, a.char_start, a.char_end
                 FROM annotations a
                 JOIN nodes n ON n.id = a.node_id
                 WHERE a.node_id = ?1 AND a.annotation_type = ?2
                 ORDER BY a.source_line
                 LIMIT ?3",
            )?;
            let results = stmt
                .query_map(
                    rusqlite::params![node_id, type_filter.unwrap(), limit],
                    map_annotation_row,
                )?
                .collect::<Result<Vec<_>, _>>()?;
            Ok(results)
        } else {
            let mut stmt = self.conn.prepare(
                "SELECT a.id, a.node_id, n.title, a.annotation_type, a.certainty, a.body, a.date, a.source_line, a.char_start, a.char_end
                 FROM annotations a
                 JOIN nodes n ON n.id = a.node_id
                 WHERE a.node_id = ?1
                 ORDER BY a.source_line
                 LIMIT ?2",
            )?;
            let results = stmt
                .query_map(
                    rusqlite::params![node_id, limit],
                    map_annotation_row,
                )?
                .collect::<Result<Vec<_>, _>>()?;
            Ok(results)
        }
    }

    // --- Transactions ---

    pub fn begin_transaction(&self) -> Result<(), GraphError> {
        self.conn.execute_batch("BEGIN")?;
        Ok(())
    }

    pub fn commit(&self) -> Result<(), GraphError> {
        self.conn.execute_batch("COMMIT")?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use tracing_test::traced_test;

    fn make_node(id: &str, title: &str, tags: &[&str], fm: serde_json::Value) -> ParsedNode {
        ParsedNode {
            id: id.into(),
            title: title.into(),
            tags: tags.iter().map(|s| s.to_string()).collect(),
            frontmatter: fm,
            first_paragraph: format!("First paragraph of {title}"),
        }
    }

    // --- Phase 3: Store constructor & schema ---

    #[test]
    fn open_memory_creates_tables() {
        let store = Store::open_memory().expect("open_memory");
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
        assert!(tables.contains(&"nodes".to_string()));
        assert!(tables.contains(&"tags".to_string()));
        assert!(tables.contains(&"aliases".to_string()));
        assert!(tables.contains(&"edges".to_string()));
        assert!(tables.contains(&"sync".to_string()));
        assert!(tables.contains(&"meta".to_string()));
    }

    #[test]
    fn schema_version_matches_const() {
        let store = Store::open_memory().unwrap();
        assert_eq!(
            store.schema_version().unwrap(),
            CURRENT_SCHEMA_VERSION,
            "migrate() final version drifted from CURRENT_SCHEMA_VERSION — bump the const"
        );
    }

    #[test]
    fn has_data_empty_store() {
        let store = Store::open_memory().unwrap();
        assert!(!store.has_data().unwrap());
    }

    #[test]
    fn has_data_after_upsert() {
        let store = Store::open_memory().unwrap();
        let node = make_node("a.md", "A", &[], json!({}));
        store.upsert_node(&node, 1000).unwrap();
        assert!(store.has_data().unwrap());
    }

    #[test]
    fn has_data_false_after_delete() {
        let store = Store::open_memory().unwrap();
        let node = make_node("a.md", "A", &[], json!({}));
        store.upsert_node(&node, 1000).unwrap();
        store.delete_node("a.md").unwrap();
        assert!(!store.has_data().unwrap());
    }

    #[test]
    fn schema_version_from_future_resets_store() {
        let dir = tempfile::tempdir().unwrap();
        let db_path = dir.path().join("graph.db");

        // Create a store, insert a node, then bump version to 999
        {
            let store = Store::open(&db_path).unwrap();
            let node = make_node("a.md", "A", &[], json!({}));
            store.upsert_node(&node, 1000).unwrap();
            assert!(store.has_data().unwrap());
            store
                .conn
                .execute("UPDATE meta SET value = '999' WHERE key = 'schema_version'", [])
                .unwrap();
        }

        // Reopen — should detect future version and reset
        let store = Store::open(&db_path).unwrap();
        assert_eq!(store.schema_version().unwrap(), CURRENT_SCHEMA_VERSION);
        assert!(!store.has_data().unwrap(), "store should be empty after schema reset");
    }

    #[test]
    fn fts_table_does_not_exist() {
        let store = Store::open_memory().unwrap();
        let count: i64 = store
            .conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='nodes_fts'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 0);
    }

    #[test]
    fn fts_triggers_do_not_exist() {
        let store = Store::open_memory().unwrap();
        let count: i64 = store
            .conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='trigger' AND name LIKE 'nodes_fts%'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 0);
    }

    #[test]
    fn open_file_is_idempotent() {
        let dir = tempfile::tempdir().unwrap();
        let db_path = dir.path().join("test.db");
        {
            let store = Store::open(&db_path).unwrap();
            assert_eq!(store.schema_version().unwrap(), 6);
        }
        {
            let store = Store::open(&db_path).unwrap();
            assert_eq!(store.schema_version().unwrap(), 6);
        }
    }

    // --- Phase 4: Meta operations ---

    #[test]
    fn get_meta_nonexistent_returns_none() {
        let store = Store::open_memory().unwrap();
        assert_eq!(store.get_meta("nonexistent").unwrap(), None);
    }

    #[test]
    fn set_meta_get_meta_round_trip() {
        let store = Store::open_memory().unwrap();
        store.set_meta("foo", "bar").unwrap();
        assert_eq!(store.get_meta("foo").unwrap(), Some("bar".into()));
    }

    #[test]
    fn set_meta_overwrites_existing() {
        let store = Store::open_memory().unwrap();
        store.set_meta("key", "old").unwrap();
        store.set_meta("key", "new").unwrap();
        assert_eq!(store.get_meta("key").unwrap(), Some("new".into()));
    }

    #[test]
    fn schema_version_readable_via_get_meta() {
        let store = Store::open_memory().unwrap();
        assert_eq!(store.get_meta("schema_version").unwrap(), Some("6".into()));
    }

    // --- Phase 5: Node CRUD ---

    #[test]
    fn upsert_node_insert_and_readback() {
        let store = Store::open_memory().unwrap();
        let node = make_node("People/Alice.md", "Alice", &["person"], json!({"title": "Alice"}));
        store.upsert_node(&node, 1000).unwrap();

        let title: String = store
            .conn
            .query_row(
                "SELECT title FROM nodes WHERE id = ?1",
                ["People/Alice.md"],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(title, "Alice");
    }

    #[test]
    fn upsert_node_writes_tags() {
        let store = Store::open_memory().unwrap();
        let node = make_node("a.md", "A", &["tag1", "tag2"], json!({}));
        store.upsert_node(&node, 1).unwrap();

        let mut stmt = store
            .conn
            .prepare("SELECT tag FROM tags WHERE node_id = 'a.md' ORDER BY tag")
            .unwrap();
        let tags: Vec<String> = stmt
            .query_map([], |r| r.get(0))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        assert_eq!(tags, vec!["tag1", "tag2"]);
    }

    #[test]
    fn upsert_node_writes_aliases() {
        let store = Store::open_memory().unwrap();
        let node = make_node("a.md", "A", &[], json!({"aliases": ["Alpha", "Alfa"]}));
        store.upsert_node(&node, 1).unwrap();

        let mut stmt = store
            .conn
            .prepare("SELECT alias FROM aliases WHERE node_id = 'a.md' ORDER BY alias")
            .unwrap();
        let aliases: Vec<String> = stmt
            .query_map([], |r| r.get(0))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        assert_eq!(aliases, vec!["Alfa", "Alpha"]);
    }

    #[test]
    fn upsert_node_writes_sync() {
        let store = Store::open_memory().unwrap();
        let node = make_node("a.md", "A", &[], json!({}));
        store.upsert_node(&node, 42).unwrap();

        assert_eq!(store.get_sync_mtime("a.md").unwrap(), Some(42));
    }

    #[test]
    fn upsert_node_replaces_on_conflict() {
        let store = Store::open_memory().unwrap();
        let node1 = make_node("a.md", "Old", &[], json!({}));
        store.upsert_node(&node1, 1).unwrap();
        let node2 = make_node("a.md", "New", &[], json!({}));
        store.upsert_node(&node2, 2).unwrap();

        let title: String = store
            .conn
            .query_row("SELECT title FROM nodes WHERE id = 'a.md'", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(title, "New");
    }

    #[test]
    fn upsert_node_replaces_tags_on_reupsert() {
        let store = Store::open_memory().unwrap();
        let node1 = make_node("a.md", "A", &["old"], json!({}));
        store.upsert_node(&node1, 1).unwrap();
        let node2 = make_node("a.md", "A", &["new1", "new2"], json!({}));
        store.upsert_node(&node2, 2).unwrap();

        let mut stmt = store
            .conn
            .prepare("SELECT tag FROM tags WHERE node_id = 'a.md' ORDER BY tag")
            .unwrap();
        let tags: Vec<String> = stmt
            .query_map([], |r| r.get(0))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        assert_eq!(tags, vec!["new1", "new2"]);
    }

    #[test]
    fn upsert_node_populates_tags_text() {
        let store = Store::open_memory().unwrap();
        let node = make_node("a.md", "A", &["rust", "coding"], json!({}));
        store.upsert_node(&node, 1).unwrap();

        let tags_text: String = store
            .conn
            .query_row("SELECT tags_text FROM nodes WHERE id = 'a.md'", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(tags_text, "rust coding");
    }

    #[test]
    fn upsert_stub_creates_stub() {
        let store = Store::open_memory().unwrap();
        store.upsert_stub("Ghost").unwrap();

        let is_stub: i64 = store
            .conn
            .query_row("SELECT is_stub FROM nodes WHERE id = 'Ghost'", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(is_stub, 1);
    }

    #[test]
    fn upsert_stub_does_not_overwrite_real_node() {
        let store = Store::open_memory().unwrap();
        let node = make_node("Real.md", "Real", &[], json!({}));
        store.upsert_node(&node, 1).unwrap();

        store.upsert_stub("Real.md").unwrap();

        let is_stub: i64 = store
            .conn
            .query_row("SELECT is_stub FROM nodes WHERE id = 'Real.md'", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(is_stub, 0);
    }

    #[test]
    fn upsert_stub_idempotent() {
        let store = Store::open_memory().unwrap();
        store.upsert_stub("Ghost").unwrap();
        store.upsert_stub("Ghost").unwrap();

        let count: i64 = store
            .conn
            .query_row(
                "SELECT COUNT(*) FROM nodes WHERE id = 'Ghost'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn delete_node_removes_all_data() {
        let store = Store::open_memory().unwrap();
        let node = make_node("a.md", "A", &["t"], json!({"aliases": ["X"]}));
        store.upsert_node(&node, 1).unwrap();
        store.insert_edge("a.md", "b.md", "ctx", "", 0).unwrap();

        store.delete_node("a.md").unwrap();

        let count: i64 = store
            .conn
            .query_row("SELECT COUNT(*) FROM nodes WHERE id = 'a.md'", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(count, 0);
        let tag_count: i64 = store
            .conn
            .query_row(
                "SELECT COUNT(*) FROM tags WHERE node_id = 'a.md'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(tag_count, 0);
        let alias_count: i64 = store
            .conn
            .query_row(
                "SELECT COUNT(*) FROM aliases WHERE node_id = 'a.md'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(alias_count, 0);
        let sync_count: i64 = store
            .conn
            .query_row(
                "SELECT COUNT(*) FROM sync WHERE path = 'a.md'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(sync_count, 0);
    }

    #[test]
    fn delete_node_removes_edges_from_and_to() {
        let store = Store::open_memory().unwrap();
        let node_a = make_node("a.md", "A", &[], json!({}));
        let node_b = make_node("b.md", "B", &[], json!({}));
        store.upsert_node(&node_a, 1).unwrap();
        store.upsert_node(&node_b, 1).unwrap();
        store.insert_edge("a.md", "b.md", "", "", 0).unwrap();
        store.insert_edge("b.md", "a.md", "", "", 0).unwrap();

        store.delete_node("a.md").unwrap();

        let count: i64 = store
            .conn
            .query_row("SELECT COUNT(*) FROM edges", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 0);
    }

    #[test]
    fn delete_node_noop_for_nonexistent() {
        let store = Store::open_memory().unwrap();
        store.delete_node("nonexistent.md").unwrap();
    }

    // --- Phase 6: Edge operations ---

    #[test]
    fn insert_edge_and_query() {
        let store = Store::open_memory().unwrap();
        store.insert_edge("a.md", "b.md", "links to b", "b", 0).unwrap();

        let ctx: String = store
            .conn
            .query_row(
                "SELECT context FROM edges WHERE source = 'a.md' AND target = 'b.md'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(ctx, "links to b");
    }

    #[test]
    fn delete_edges_from_source() {
        let store = Store::open_memory().unwrap();
        store.insert_edge("a.md", "b.md", "", "", 0).unwrap();
        store.insert_edge("a.md", "c.md", "", "", 0).unwrap();
        store.insert_edge("x.md", "y.md", "", "", 0).unwrap();

        store.delete_edges_from("a.md").unwrap();

        let count: i64 = store
            .conn
            .query_row("SELECT COUNT(*) FROM edges", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn replace_all_edges_clears_and_inserts() {
        let store = Store::open_memory().unwrap();
        store.insert_edge("old.md", "old_target.md", "", "", 0).unwrap();

        let edges = vec![
            ("a.md", "b.md", "link to B", "B", 0),
            ("a.md", "c.md", "link to C", "C", 0),
        ];
        store.replace_all_edges(&edges).unwrap();

        let count: i64 = store
            .conn
            .query_row("SELECT COUNT(*) FROM edges", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 2);

        let target: String = store
            .conn
            .query_row(
                "SELECT target FROM edges WHERE source = 'a.md' AND context = 'link to B'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(target, "b.md");
    }

    // --- Phase 7: Query methods ---

    #[test]
    fn get_sync_mtime_none_for_unknown() {
        let store = Store::open_memory().unwrap();
        assert_eq!(store.get_sync_mtime("unknown.md").unwrap(), None);
    }

    #[test]
    fn get_sync_mtime_returns_stored() {
        let store = Store::open_memory().unwrap();
        let node = make_node("a.md", "A", &[], json!({}));
        store.upsert_node(&node, 999).unwrap();
        assert_eq!(store.get_sync_mtime("a.md").unwrap(), Some(999));
    }

    #[test]
    fn all_synced_paths_returns_all() {
        let store = Store::open_memory().unwrap();
        let node_a = make_node("b.md", "B", &[], json!({}));
        let node_b = make_node("a.md", "A", &[], json!({}));
        store.upsert_node(&node_a, 1).unwrap();
        store.upsert_node(&node_b, 1).unwrap();

        let paths = store.all_synced_paths().unwrap();
        assert_eq!(paths, vec!["a.md", "b.md"]);
    }

    #[test]
    fn all_node_ids_returns_sorted() {
        let store = Store::open_memory().unwrap();
        let node_b = make_node("b.md", "B", &[], json!({}));
        let node_a = make_node("a.md", "A", &[], json!({}));
        store.upsert_node(&node_b, 1).unwrap();
        store.upsert_node(&node_a, 1).unwrap();

        let ids = store.all_node_ids().unwrap();
        assert_eq!(ids, vec!["a.md", "b.md"]);
    }

    #[test]
    fn all_edges_returns_source_target_pairs() {
        let store = Store::open_memory().unwrap();
        store.insert_edge("a.md", "b.md", "", "", 0).unwrap();
        store.insert_edge("c.md", "d.md", "", "", 0).unwrap();

        let edges = store.all_edges().unwrap();
        assert_eq!(
            edges,
            vec![
                ("a.md".into(), "b.md".into()),
                ("c.md".into(), "d.md".into())
            ]
        );
    }

    #[test]
    fn all_edges_empty_db() {
        let store = Store::open_memory().unwrap();
        let edges = store.all_edges().unwrap();
        assert!(edges.is_empty());
    }

    #[test]
    fn all_nodes_metadata_returns_id_and_stub_flag() {
        let store = Store::open_memory().unwrap();
        let node = make_node("a.md", "A", &[], json!({}));
        store.upsert_node(&node, 1).unwrap();
        store.upsert_stub("Ghost").unwrap();

        let meta = store.all_nodes_metadata().unwrap();
        assert_eq!(meta.len(), 2);
        assert!(meta.contains(&("Ghost".into(), true)));
        assert!(meta.contains(&("a.md".into(), false)));
    }

    #[test]
    fn all_nodes_metadata_empty_db() {
        let store = Store::open_memory().unwrap();
        let meta = store.all_nodes_metadata().unwrap();
        assert!(meta.is_empty());
    }

    #[test]
    fn node_titles_returns_all() {
        let store = Store::open_memory().unwrap();
        let node = make_node("a.md", "Alpha", &[], json!({}));
        store.upsert_node(&node, 1).unwrap();
        store.upsert_stub("Ghost").unwrap();

        let titles = store.node_titles().unwrap();
        assert_eq!(titles.len(), 2);
        assert_eq!(titles["a.md"], "Alpha");
        assert_eq!(titles["Ghost"], "");
    }

    // --- Phase 8: Stats & Fingerprint ---

    #[test]
    fn stats_empty_db() {
        let store = Store::open_memory().unwrap();
        let s = store.stats().unwrap();
        assert_eq!(
            s,
            Stats {
                nodes: 0,
                stubs: 0,
                edges: 0,
                tags: 0
            }
        );
    }

    #[test]
    fn stats_populated() {
        let store = Store::open_memory().unwrap();
        let node = make_node("a.md", "A", &["t1", "t2"], json!({}));
        store.upsert_node(&node, 1).unwrap();
        let node2 = make_node("b.md", "B", &["t1"], json!({}));
        store.upsert_node(&node2, 1).unwrap();
        store.upsert_stub("Ghost").unwrap();
        store.insert_edge("a.md", "b.md", "", "", 0).unwrap();
        store.insert_edge("a.md", "Ghost", "", "", 0).unwrap();

        let s = store.stats().unwrap();
        assert_eq!(s.nodes, 2);
        assert_eq!(s.stubs, 1);
        assert_eq!(s.edges, 2);
        assert_eq!(s.tags, 2);
    }

    #[test]
    fn max_mtime_empty_db_returns_zero() {
        let store = Store::open_memory().unwrap();
        assert_eq!(store.max_mtime().unwrap(), 0);
    }

    #[test]
    fn max_mtime_returns_largest() {
        let store = Store::open_memory().unwrap();
        let node_a = make_node("a.md", "A", &[], json!({}));
        store.upsert_node(&node_a, 100).unwrap();
        let node_b = make_node("b.md", "B", &[], json!({}));
        store.upsert_node(&node_b, 200).unwrap();
        assert_eq!(store.max_mtime().unwrap(), 200);
    }

    #[test]
    fn max_mtime_ignores_stubs() {
        let store = Store::open_memory().unwrap();
        let node = make_node("a.md", "A", &[], json!({}));
        store.upsert_node(&node, 50).unwrap();
        store.upsert_stub("Ghost").unwrap();
        assert_eq!(store.max_mtime().unwrap(), 50);
    }

    #[test]
    fn graph_fingerprint_changes_with_data() {
        let store = Store::open_memory().unwrap();
        let fp1 = store.graph_fingerprint().unwrap();

        let node = make_node("a.md", "A", &[], json!({}));
        store.upsert_node(&node, 100).unwrap();
        let fp2 = store.graph_fingerprint().unwrap();
        assert_ne!(fp1, fp2);
    }

    #[test]
    fn graph_fingerprint_stable_for_same_data() {
        let store = Store::open_memory().unwrap();
        let node = make_node("a.md", "A", &[], json!({}));
        store.upsert_node(&node, 100).unwrap();
        let fp1 = store.graph_fingerprint().unwrap();
        let fp2 = store.graph_fingerprint().unwrap();
        assert_eq!(fp1, fp2);
    }

    // --- all_sync_entries ---

    #[test]
    fn all_sync_entries_empty() {
        let store = Store::open_memory().unwrap();
        assert!(store.all_sync_entries().unwrap().is_empty());
    }

    #[test]
    fn all_sync_entries_returns_path_mtime_pairs() {
        let store = Store::open_memory().unwrap();
        let a = make_node("a.md", "A", &[], json!({}));
        let b = make_node("b.md", "B", &[], json!({}));
        store.upsert_node(&a, 1).unwrap();
        store.upsert_node(&b, 2).unwrap();
        let entries = store.all_sync_entries().unwrap();
        assert_eq!(entries, vec![("a.md".into(), 1), ("b.md".into(), 2)]);
    }

    // --- all_aliases ---

    #[test]
    fn all_aliases_empty() {
        let store = Store::open_memory().unwrap();
        assert!(store.all_aliases().unwrap().is_empty());
    }

    #[test]
    fn all_aliases_returns_grouped() {
        let store = Store::open_memory().unwrap();
        let a = make_node("a.md", "A", &[], json!({"aliases": ["Alpha", "Alfa"]}));
        let b = make_node("b.md", "B", &[], json!({"aliases": ["Beta"]}));
        store.upsert_node(&a, 1).unwrap();
        store.upsert_node(&b, 1).unwrap();
        let aliases = store.all_aliases().unwrap();
        assert_eq!(aliases.len(), 2);
        assert_eq!(aliases["a.md"], vec!["Alfa", "Alpha"]);
        assert_eq!(aliases["b.md"], vec!["Beta"]);
    }

    #[test]
    fn all_aliases_excludes_nodes_without_aliases() {
        let store = Store::open_memory().unwrap();
        let a = make_node("a.md", "A", &[], json!({}));
        store.upsert_node(&a, 1).unwrap();
        assert!(store.all_aliases().unwrap().is_empty());
    }

    // --- raw_target ---

    #[test]
    fn insert_edge_with_raw_target() {
        let store = Store::open_memory().unwrap();
        store.insert_edge("a.md", "b.md", "ctx", "B", 0).unwrap();
        let raw = store.all_raw_edges().unwrap();
        assert_eq!(raw.len(), 1);
        assert_eq!(raw[0], ("a.md".into(), "b.md".into(), "B".into()));
    }

    // --- Backlinks ---

    #[test]
    fn backlinks_returns_sources_targeting_page() {
        let store = Store::open_memory().unwrap();
        let a = make_node("a.md", "Alpha", &[], json!({}));
        let b = make_node("b.md", "Beta", &[], json!({}));
        store.upsert_node(&a, 1).unwrap();
        store.upsert_node(&b, 1).unwrap();
        store.insert_edge("a.md", "b.md", "links to b", "b", 5).unwrap();

        let bl = store.backlinks("b.md").unwrap();
        assert_eq!(bl.len(), 1);
        assert_eq!(bl[0].source_id, "a.md");
        assert_eq!(bl[0].source_title, "Alpha");
        assert_eq!(bl[0].context, "links to b");
        assert_eq!(bl[0].source_line, 5);
    }

    #[test]
    fn backlinks_empty_when_no_inbound() {
        let store = Store::open_memory().unwrap();
        let a = make_node("a.md", "Alpha", &[], json!({}));
        store.upsert_node(&a, 1).unwrap();
        let bl = store.backlinks("a.md").unwrap();
        assert!(bl.is_empty());
    }

    #[test]
    fn backlinks_multiple_sources() {
        let store = Store::open_memory().unwrap();
        let a = make_node("a.md", "Alpha", &[], json!({}));
        let b = make_node("b.md", "Beta", &[], json!({}));
        let c = make_node("c.md", "Charlie", &[], json!({}));
        store.upsert_node(&a, 1).unwrap();
        store.upsert_node(&b, 1).unwrap();
        store.upsert_node(&c, 1).unwrap();
        store.insert_edge("a.md", "c.md", "from a", "c", 1).unwrap();
        store.insert_edge("b.md", "c.md", "from b", "c", 3).unwrap();

        let bl = store.backlinks("c.md").unwrap();
        assert_eq!(bl.len(), 2);
        assert_eq!(bl[0].source_id, "a.md");
        assert_eq!(bl[0].source_line, 1);
        assert_eq!(bl[1].source_id, "b.md");
        assert_eq!(bl[1].source_line, 3);
    }

    // --- Forward links ---

    #[test]
    fn forward_links_returns_targets_from_page() {
        let store = Store::open_memory().unwrap();
        let a = make_node("a.md", "Alpha", &[], json!({}));
        let b = make_node("b.md", "Beta", &[], json!({}));
        store.upsert_node(&a, 1).unwrap();
        store.upsert_node(&b, 1).unwrap();
        store.insert_edge("a.md", "b.md", "links to b", "B", 0).unwrap();

        let fl = store.forward_links("a.md").unwrap();
        assert_eq!(fl.len(), 1);
        assert_eq!(fl[0].target_id, "b.md");
        assert_eq!(fl[0].target_title, "Beta");
        assert_eq!(fl[0].raw_target, "B");
        assert_eq!(fl[0].context, "links to b");
    }

    #[test]
    fn forward_links_empty_when_no_outbound() {
        let store = Store::open_memory().unwrap();
        let a = make_node("a.md", "Alpha", &[], json!({}));
        store.upsert_node(&a, 1).unwrap();
        let fl = store.forward_links("a.md").unwrap();
        assert!(fl.is_empty());
    }

    #[test]
    fn forward_links_multiple_targets() {
        let store = Store::open_memory().unwrap();
        let a = make_node("a.md", "Alpha", &[], json!({}));
        let b = make_node("b.md", "Beta", &[], json!({}));
        let c = make_node("c.md", "Charlie", &[], json!({}));
        store.upsert_node(&a, 1).unwrap();
        store.upsert_node(&b, 1).unwrap();
        store.upsert_node(&c, 1).unwrap();
        store.insert_edge("a.md", "b.md", "to b", "B", 0).unwrap();
        store.insert_edge("a.md", "c.md", "to c", "C", 0).unwrap();

        let fl = store.forward_links("a.md").unwrap();
        assert_eq!(fl.len(), 2);
        assert_eq!(fl[0].target_id, "b.md");
        assert_eq!(fl[1].target_id, "c.md");
    }

    #[test]
    fn forward_links_includes_stub_targets() {
        let store = Store::open_memory().unwrap();
        let a = make_node("a.md", "Alpha", &[], json!({}));
        store.upsert_node(&a, 1).unwrap();
        store.upsert_stub("Ghost").unwrap();
        store.insert_edge("a.md", "Ghost", "to ghost", "Ghost", 0).unwrap();

        let fl = store.forward_links("a.md").unwrap();
        assert_eq!(fl.len(), 1);
        assert_eq!(fl[0].target_id, "Ghost");
        assert_eq!(fl[0].target_title, "");
    }

    // --- Phase 10: Transactions & Tracing ---

    #[test]
    fn begin_and_commit_transaction() {
        let store = Store::open_memory().unwrap();
        store.begin_transaction().unwrap();
        let node = make_node("a.md", "A", &[], json!({}));
        store.upsert_node(&node, 1).unwrap();
        store.commit().unwrap();

        let ids = store.all_node_ids().unwrap();
        assert_eq!(ids, vec!["a.md"]);
    }

    #[traced_test]
    #[test]
    fn open_memory_logs() {
        let _store = Store::open_memory().unwrap();
        assert!(logs_contain("opening in-memory store"));
    }

    #[traced_test]
    #[test]
    fn open_file_logs() {
        let dir = tempfile::tempdir().unwrap();
        let db_path = dir.path().join("test.db");
        let _store = Store::open(&db_path).unwrap();
        assert!(logs_contain("opening store"));
    }

    // --- Phase 11: Migration ---

    #[test]
    fn v1_to_v5_migration_backfills_tags_text_and_adds_raw_target_and_source_line() {
        let dir = tempfile::tempdir().unwrap();
        let db_path = dir.path().join("test.db");

        {
            let conn = Connection::open(&db_path).unwrap();
            conn.execute_batch("PRAGMA journal_mode=WAL;").unwrap();
            conn.execute_batch(
                "CREATE TABLE nodes (
                    id TEXT PRIMARY KEY,
                    title TEXT,
                    first_paragraph TEXT,
                    frontmatter JSON,
                    mtime INTEGER,
                    is_stub INTEGER DEFAULT 0
                );
                CREATE TABLE tags (node_id TEXT, tag TEXT);
                CREATE TABLE aliases (node_id TEXT, alias TEXT);
                CREATE TABLE edges (source TEXT, target TEXT, context TEXT);
                CREATE TABLE sync (path TEXT PRIMARY KEY, mtime INTEGER);
                CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
                INSERT INTO meta(key, value) VALUES ('schema_version', '1');
                INSERT INTO nodes(id, title, first_paragraph, frontmatter, mtime, is_stub)
                    VALUES ('a.md', 'Alpha', 'First paragraph', '{}', 1, 0);
                INSERT INTO tags(node_id, tag) VALUES ('a.md', 'rust');
                INSERT INTO tags(node_id, tag) VALUES ('a.md', 'coding');",
            )
            .unwrap();
        }

        let store = Store::open(&db_path).unwrap();
        assert_eq!(store.schema_version().unwrap(), 6);

        let tags_text: String = store
            .conn
            .query_row("SELECT tags_text FROM nodes WHERE id = 'a.md'", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert!(!tags_text.is_empty(), "tags_text should be backfilled");

        // v3 column should exist
        store.insert_edge("a.md", "b.md", "ctx", "b", 0).unwrap();
        let raw_edges = store.all_raw_edges().unwrap();
        assert_eq!(raw_edges.len(), 1);
        assert_eq!(raw_edges[0].2, "b");
    }

    #[test]
    fn v2_to_v5_migration_adds_raw_target_and_source_line() {
        let dir = tempfile::tempdir().unwrap();
        let db_path = dir.path().join("test.db");

        {
            let conn = Connection::open(&db_path).unwrap();
            conn.execute_batch("PRAGMA journal_mode=WAL;").unwrap();
            conn.execute_batch(
                "CREATE TABLE nodes (
                    id TEXT PRIMARY KEY,
                    title TEXT,
                    first_paragraph TEXT,
                    frontmatter JSON,
                    mtime INTEGER,
                    is_stub INTEGER DEFAULT 0,
                    tags_text TEXT DEFAULT ''
                );
                CREATE TABLE tags (node_id TEXT, tag TEXT);
                CREATE TABLE aliases (node_id TEXT, alias TEXT);
                CREATE TABLE edges (source TEXT, target TEXT, context TEXT);
                CREATE TABLE sync (path TEXT PRIMARY KEY, mtime INTEGER);
                CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
                INSERT INTO meta(key, value) VALUES ('schema_version', '2');
                INSERT INTO edges(source, target, context) VALUES ('a.md', 'b.md', 'ctx');",
            )
            .unwrap();
        }

        let store = Store::open(&db_path).unwrap();
        assert_eq!(store.schema_version().unwrap(), 6);

        let raw_edges = store.all_raw_edges().unwrap();
        assert_eq!(raw_edges.len(), 1);
        assert_eq!(raw_edges[0].2, "", "existing edges get empty raw_target");
    }

    #[test]
    fn v4_to_v5_migration_drops_fts() {
        let dir = tempfile::tempdir().unwrap();
        let db_path = dir.path().join("test.db");

        {
            let conn = Connection::open(&db_path).unwrap();
            conn.execute_batch("PRAGMA journal_mode=WAL;").unwrap();
            conn.execute_batch(
                "CREATE TABLE nodes (
                    id TEXT PRIMARY KEY,
                    title TEXT,
                    first_paragraph TEXT,
                    frontmatter JSON,
                    mtime INTEGER,
                    is_stub INTEGER DEFAULT 0,
                    tags_text TEXT DEFAULT ''
                );
                CREATE TABLE tags (node_id TEXT, tag TEXT);
                CREATE TABLE aliases (node_id TEXT, alias TEXT);
                CREATE TABLE edges (source TEXT, target TEXT, context TEXT, raw_target TEXT DEFAULT '', source_line INTEGER DEFAULT 0);
                CREATE TABLE sync (path TEXT PRIMARY KEY, mtime INTEGER);
                CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
                INSERT INTO meta(key, value) VALUES ('schema_version', '4');
                CREATE VIRTUAL TABLE nodes_fts USING fts5(title, first_paragraph, tags_text, content=nodes, content_rowid=rowid);
                CREATE TRIGGER nodes_fts_insert AFTER INSERT ON nodes BEGIN
                    INSERT INTO nodes_fts(rowid, title, first_paragraph, tags_text)
                    VALUES (new.rowid, new.title, new.first_paragraph, new.tags_text);
                END;
                CREATE TRIGGER nodes_fts_delete AFTER DELETE ON nodes BEGIN
                    INSERT INTO nodes_fts(nodes_fts, rowid, title, first_paragraph, tags_text)
                    VALUES ('delete', old.rowid, old.title, old.first_paragraph, old.tags_text);
                END;
                CREATE TRIGGER nodes_fts_update AFTER UPDATE ON nodes BEGIN
                    INSERT INTO nodes_fts(nodes_fts, rowid, title, first_paragraph, tags_text)
                    VALUES ('delete', old.rowid, old.title, old.first_paragraph, old.tags_text);
                    INSERT INTO nodes_fts(rowid, title, first_paragraph, tags_text)
                    VALUES (new.rowid, new.title, new.first_paragraph, new.tags_text);
                END;",
            )
            .unwrap();
        }

        let store = Store::open(&db_path).unwrap();
        assert_eq!(store.schema_version().unwrap(), 6);

        let fts_count: i64 = store
            .conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='nodes_fts'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(fts_count, 0, "FTS table should be dropped");

        let trigger_count: i64 = store
            .conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='trigger' AND name LIKE 'nodes_fts%'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(trigger_count, 0, "FTS triggers should be dropped");
    }

    // --- title_and_aliases ---

    #[test]
    fn title_and_aliases_returns_title_and_aliases() {
        let store = Store::open_memory().unwrap();
        let node = make_node("a.md", "Alpha", &[], json!({"aliases": ["Alfa", "A"]}));
        store.upsert_node(&node, 1).unwrap();
        let (title, aliases) = store.title_and_aliases("a.md").unwrap();
        assert_eq!(title, "Alpha");
        assert_eq!(aliases, vec!["A", "Alfa"]);
    }

    #[test]
    fn title_and_aliases_no_aliases() {
        let store = Store::open_memory().unwrap();
        let node = make_node("a.md", "Alpha", &[], json!({}));
        store.upsert_node(&node, 1).unwrap();
        let (title, aliases) = store.title_and_aliases("a.md").unwrap();
        assert_eq!(title, "Alpha");
        assert!(aliases.is_empty());
    }

    #[test]
    fn title_and_aliases_nonexistent_page() {
        let store = Store::open_memory().unwrap();
        let result = store.title_and_aliases("nope.md");
        assert!(result.is_err());
        match result.unwrap_err() {
            super::GraphError::NodeNotFound { id } => assert_eq!(id, "nope.md"),
            other => panic!("expected NodeNotFound, got: {other:?}"),
        }
    }

    // --- backlink_source_ids ---

    #[test]
    fn backlink_source_ids_returns_sources() {
        let store = Store::open_memory().unwrap();
        store.insert_edge("a.md", "target.md", "", "", 0).unwrap();
        store.insert_edge("b.md", "target.md", "", "", 0).unwrap();
        let sources = store.backlink_source_ids("target.md").unwrap();
        assert!(sources.contains("a.md"));
        assert!(sources.contains("b.md"));
        assert_eq!(sources.len(), 2);
    }

    #[test]
    fn backlink_source_ids_empty() {
        let store = Store::open_memory().unwrap();
        let sources = store.backlink_source_ids("lonely.md").unwrap();
        assert!(sources.is_empty());
    }

    // --- search_titles ---

    #[test]
    fn search_titles_matches_title_substring() {
        let store = Store::open_memory().unwrap();
        let node = make_node("a.md", "Quantum Computing", &[], json!({}));
        store.upsert_node(&node, 1).unwrap();
        let results = store.search_titles("Quantum", 10).unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].0, "a.md");
        assert_eq!(results[0].1, "Quantum Computing");
    }

    #[test]
    fn search_titles_case_insensitive() {
        let store = Store::open_memory().unwrap();
        let node = make_node("a.md", "Quantum Computing", &[], json!({}));
        store.upsert_node(&node, 1).unwrap();
        let results = store.search_titles("quantum", 10).unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].0, "a.md");
    }

    #[test]
    fn search_titles_matches_id_stem() {
        let store = Store::open_memory().unwrap();
        let node = make_node("quantum-notes.md", "My Notes", &[], json!({}));
        store.upsert_node(&node, 1).unwrap();
        let results = store.search_titles("quantum", 10).unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].0, "quantum-notes.md");
    }

    #[test]
    fn search_titles_matches_aliases() {
        let store = Store::open_memory().unwrap();
        let node = make_node("a.md", "Alice", &[], json!({"aliases": ["Ali", "Ally"]}));
        store.upsert_node(&node, 1).unwrap();
        let results = store.search_titles("Ali", 10).unwrap();
        assert!(results.iter().any(|(id, _)| id == "a.md"));
    }

    #[test]
    fn search_titles_respects_limit() {
        let store = Store::open_memory().unwrap();
        for i in 0..10 {
            let node = make_node(&format!("{i}.md"), &format!("Note {i}"), &[], json!({}));
            store.upsert_node(&node, 1).unwrap();
        }
        let results = store.search_titles("Note", 3).unwrap();
        assert_eq!(results.len(), 3);
    }

    #[test]
    fn search_titles_empty_query_returns_empty() {
        let store = Store::open_memory().unwrap();
        let node = make_node("a.md", "Alpha", &[], json!({}));
        store.upsert_node(&node, 1).unwrap();
        let results = store.search_titles("", 10).unwrap();
        assert!(results.is_empty());
    }

    #[test]
    fn search_titles_deduplicates_alias_and_title_match() {
        let store = Store::open_memory().unwrap();
        let node = make_node("a.md", "Alpha", &[], json!({"aliases": ["Alpha Team"]}));
        store.upsert_node(&node, 1).unwrap();
        let results = store.search_titles("Alpha", 10).unwrap();
        let ids: Vec<&str> = results.iter().map(|(id, _)| id.as_str()).collect();
        let unique: std::collections::HashSet<&str> = ids.iter().copied().collect();
        assert_eq!(ids.len(), unique.len(), "results should be deduplicated");
    }

    #[test]
    fn source_line_column_exists() {
        let store = Store::open_memory().unwrap();
        let has_column: bool = store
            .conn
            .prepare("SELECT source_line FROM edges LIMIT 0")
            .is_ok();
        assert!(has_column, "edges table should have source_line column");
    }

    // --- Cycle 2: Schema v6 ---

    #[test]
    fn schema_version_is_six() {
        assert_eq!(CURRENT_SCHEMA_VERSION, 6);
    }

    #[test]
    fn annotations_table_exists() {
        let store = Store::open_memory().unwrap();
        let count: i64 = store
            .conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='annotations'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn annotations_fts_table_exists() {
        let store = Store::open_memory().unwrap();
        let count: i64 = store
            .conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='annotations_fts'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);
    }

    // --- Cycle 3: v5 → v6 migration path ---

    #[test]
    fn v5_to_v6_migration_creates_annotations_tables() {
        let dir = tempfile::tempdir().unwrap();
        let db_path = dir.path().join("test.db");

        {
            let conn = Connection::open(&db_path).unwrap();
            conn.execute_batch("PRAGMA journal_mode=WAL;").unwrap();
            conn.execute_batch(
                "CREATE TABLE nodes (
                    id TEXT PRIMARY KEY, title TEXT, first_paragraph TEXT,
                    frontmatter JSON, mtime INTEGER, is_stub INTEGER DEFAULT 0, tags_text TEXT DEFAULT ''
                );
                CREATE TABLE tags (node_id TEXT, tag TEXT);
                CREATE TABLE aliases (node_id TEXT, alias TEXT);
                CREATE TABLE edges (source TEXT, target TEXT, context TEXT, raw_target TEXT DEFAULT '', source_line INTEGER DEFAULT 0);
                CREATE TABLE sync (path TEXT PRIMARY KEY, mtime INTEGER);
                CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
                INSERT INTO meta(key, value) VALUES ('schema_version', '5');",
            )
            .unwrap();
        }

        let store = Store::open(&db_path).unwrap();
        assert_eq!(store.schema_version().unwrap(), 6);
        let ann_count: i64 = store
            .conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='annotations'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(ann_count, 1);
        let fts_count: i64 = store
            .conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='annotations_fts'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(fts_count, 1);
    }

    // --- Cycle 4: upsert_annotations ---

    fn make_annotation(ann_type: &str, body: Option<&str>) -> super::IndexableAnnotation {
        super::IndexableAnnotation {
            annotation_type: ann_type.into(),
            certainty: "neutral".into(),
            body: body.map(String::from),
            date: None,
            source_line: 1,
            char_start: 0,
            char_end: 10,
            scope_kind: "words".into(),
            scope_value: "1".into(),
        }
    }

    #[test]
    fn upsert_annotations_inserts_rows() {
        let store = Store::open_memory().unwrap();
        let node = make_node("a.md", "A", &[], json!({}));
        store.upsert_node(&node, 1).unwrap();

        let anns = vec![
            make_annotation("note", Some("first note")),
            make_annotation("question", Some("a question")),
        ];
        store.upsert_annotations("a.md", &anns).unwrap();

        let count: i64 = store
            .conn
            .query_row("SELECT COUNT(*) FROM annotations WHERE node_id = 'a.md'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 2);

        let fts_count: i64 = store
            .conn
            .query_row("SELECT COUNT(*) FROM annotations_fts WHERE node_id = 'a.md'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(fts_count, 2);
    }

    #[test]
    fn upsert_annotations_replaces_on_reupsert() {
        let store = Store::open_memory().unwrap();
        let node = make_node("a.md", "A", &[], json!({}));
        store.upsert_node(&node, 1).unwrap();

        let anns = vec![
            make_annotation("note", Some("first")),
            make_annotation("note", Some("second")),
        ];
        store.upsert_annotations("a.md", &anns).unwrap();
        assert_eq!(
            store.conn.query_row("SELECT COUNT(*) FROM annotations", [], |r| r.get::<_, i64>(0)).unwrap(),
            2
        );

        let anns2 = vec![make_annotation("note", Some("only one now"))];
        store.upsert_annotations("a.md", &anns2).unwrap();
        assert_eq!(
            store.conn.query_row("SELECT COUNT(*) FROM annotations", [], |r| r.get::<_, i64>(0)).unwrap(),
            1
        );
        assert_eq!(
            store.conn.query_row("SELECT COUNT(*) FROM annotations_fts", [], |r| r.get::<_, i64>(0)).unwrap(),
            1
        );
    }

    // --- Cycle 5: delete_node cascades ---

    #[test]
    fn delete_node_removes_annotations() {
        let store = Store::open_memory().unwrap();
        let node = make_node("a.md", "A", &[], json!({}));
        store.upsert_node(&node, 1).unwrap();
        store.upsert_annotations("a.md", &[make_annotation("note", Some("body"))]).unwrap();

        store.delete_node("a.md").unwrap();

        let ann_count: i64 = store
            .conn
            .query_row("SELECT COUNT(*) FROM annotations WHERE node_id = 'a.md'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(ann_count, 0);
        let fts_count: i64 = store
            .conn
            .query_row("SELECT COUNT(*) FROM annotations_fts WHERE node_id = 'a.md'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(fts_count, 0);
    }

    // --- Cycle 6: search_annotations ---

    #[test]
    fn search_annotations_finds_by_body() {
        let store = Store::open_memory().unwrap();
        let node = make_node("a.md", "Alpha", &[], json!({}));
        store.upsert_node(&node, 1).unwrap();

        let ann = super::IndexableAnnotation {
            annotation_type: "note".into(),
            certainty: "neutral".into(),
            body: Some("Silk Road flourished in Tang dynasty".into()),
            date: None,
            source_line: 5,
            char_start: 10,
            char_end: 50,
            scope_kind: "words".into(),
            scope_value: "2".into(),
        };
        store.upsert_annotations("a.md", &[ann]).unwrap();

        let results = store.search_annotations("Silk Road", None, 10).unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].node_id, "a.md");
        assert_eq!(results[0].node_title, "Alpha");
        assert_eq!(results[0].annotation_type, "note");
        assert_eq!(results[0].body, Some("Silk Road flourished in Tang dynasty".into()));
        assert_eq!(results[0].source_line, 5);
    }

    #[test]
    fn search_annotations_filters_by_type() {
        let store = Store::open_memory().unwrap();
        let node = make_node("a.md", "Alpha", &[], json!({}));
        store.upsert_node(&node, 1).unwrap();

        let anns = vec![
            make_annotation("note", Some("important note")),
            make_annotation("question", Some("important question")),
        ];
        store.upsert_annotations("a.md", &anns).unwrap();

        let results = store.search_annotations("important", Some("note"), 10).unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].annotation_type, "note");
    }

    // --- Cycle 7: list_annotations ---

    #[test]
    fn list_annotations_for_node() {
        let store = Store::open_memory().unwrap();
        let node = make_node("a.md", "Alpha", &[], json!({}));
        store.upsert_node(&node, 1).unwrap();

        let mut ann1 = make_annotation("note", Some("first"));
        ann1.source_line = 1;
        let mut ann2 = make_annotation("note", Some("second"));
        ann2.source_line = 5;
        let mut ann3 = make_annotation("question", Some("third"));
        ann3.source_line = 10;

        store.upsert_annotations("a.md", &[ann1, ann2, ann3]).unwrap();

        let results = store.list_annotations("a.md", None, 100).unwrap();
        assert_eq!(results.len(), 3);
        assert_eq!(results[0].source_line, 1);
        assert_eq!(results[1].source_line, 5);
        assert_eq!(results[2].source_line, 10);
    }

    #[test]
    fn list_annotations_with_type_filter() {
        let store = Store::open_memory().unwrap();
        let node = make_node("a.md", "Alpha", &[], json!({}));
        store.upsert_node(&node, 1).unwrap();

        let anns = vec![
            make_annotation("note", Some("a note")),
            make_annotation("question", Some("a question")),
        ];
        store.upsert_annotations("a.md", &anns).unwrap();

        let results = store.list_annotations("a.md", Some("note"), 100).unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].annotation_type, "note");
    }

    #[test]
    fn list_annotations_empty_for_nonexistent() {
        let store = Store::open_memory().unwrap();
        let results = store.list_annotations("unknown.md", None, 100).unwrap();
        assert!(results.is_empty());
    }
}
