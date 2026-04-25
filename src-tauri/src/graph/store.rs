use std::collections::HashMap;
use std::path::Path;

use rusqlite::Connection;
use tracing::{debug, info};

use super::error::GraphError;
use super::types::{extract_aliases, BacklinkEntry, LinkEntry, ParsedNode, SearchResult, Stats};

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

        self.conn.execute_batch(
            "CREATE VIRTUAL TABLE IF NOT EXISTS nodes_fts USING fts5(
                title, first_paragraph, tags_text,
                content=nodes, content_rowid=rowid
            );",
        )?;

        self.conn.execute_batch(
            "CREATE TRIGGER IF NOT EXISTS nodes_fts_insert AFTER INSERT ON nodes
            BEGIN
                INSERT INTO nodes_fts(rowid, title, first_paragraph, tags_text)
                VALUES (new.rowid, new.title, new.first_paragraph, new.tags_text);
            END;",
        )?;

        self.conn.execute_batch(
            "CREATE TRIGGER IF NOT EXISTS nodes_fts_delete AFTER DELETE ON nodes
            BEGIN
                INSERT INTO nodes_fts(nodes_fts, rowid, title, first_paragraph, tags_text)
                VALUES ('delete', old.rowid, old.title, old.first_paragraph, old.tags_text);
            END;",
        )?;

        self.conn.execute_batch(
            "CREATE TRIGGER IF NOT EXISTS nodes_fts_update AFTER UPDATE ON nodes
            BEGIN
                INSERT INTO nodes_fts(nodes_fts, rowid, title, first_paragraph, tags_text)
                VALUES ('delete', old.rowid, old.title, old.first_paragraph, old.tags_text);
                INSERT INTO nodes_fts(rowid, title, first_paragraph, tags_text)
                VALUES (new.rowid, new.title, new.first_paragraph, new.tags_text);
            END;",
        )?;

        if version < 2 {
            self.conn
                .execute_batch("INSERT INTO nodes_fts(nodes_fts) VALUES ('rebuild');")?;
        }

        Ok(())
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

    // --- Search ---

    pub fn search(&self, query: &str, limit: i64) -> Result<Vec<SearchResult>, GraphError> {
        info!(query, limit, "searching");
        let mut stmt = self.conn.prepare(
            "SELECT n.id, n.title, bm25(nodes_fts) AS score,
                    snippet(nodes_fts, -1, '[', ']', '...', 64) AS excerpt
             FROM nodes_fts
             JOIN nodes n ON n.rowid = nodes_fts.rowid
             WHERE nodes_fts MATCH ?1 AND n.is_stub = 0
             ORDER BY score
             LIMIT ?2",
        )?;

        let results = stmt
            .query_map(rusqlite::params![query, limit], |row| {
                Ok(SearchResult {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    score: row.get(2)?,
                    excerpt: row.get(3)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;

        debug!(results = results.len(), "search complete");
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
    fn schema_version_is_4() {
        let store = Store::open_memory().unwrap();
        assert_eq!(store.schema_version().unwrap(), 4);
    }

    #[test]
    fn fts_table_exists() {
        let store = Store::open_memory().unwrap();
        let count: i64 = store
            .conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='nodes_fts'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn open_file_is_idempotent() {
        let dir = tempfile::tempdir().unwrap();
        let db_path = dir.path().join("test.db");
        {
            let store = Store::open(&db_path).unwrap();
            assert_eq!(store.schema_version().unwrap(), 4);
        }
        {
            let store = Store::open(&db_path).unwrap();
            assert_eq!(store.schema_version().unwrap(), 4);
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
        assert_eq!(store.get_meta("schema_version").unwrap(), Some("4".into()));
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

    // --- Phase 9: FTS5 Search ---

    #[test]
    fn fts_trigger_fires_on_upsert() {
        let store = Store::open_memory().unwrap();
        let node = make_node("a.md", "Alpha", &[], json!({}));
        store.upsert_node(&node, 1).unwrap();

        let count: i64 = store
            .conn
            .query_row(
                "SELECT COUNT(*) FROM nodes_fts WHERE nodes_fts MATCH 'Alpha'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn search_by_title() {
        let store = Store::open_memory().unwrap();
        let node = make_node(
            "People/Alice.md",
            "Alice Smith",
            &["person"],
            json!({}),
        );
        store.upsert_node(&node, 1).unwrap();

        let results = store.search("Alice", 20).unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].id, "People/Alice.md");
        assert_eq!(results[0].title, "Alice Smith");
        assert!(results[0].score < 0.0);
        assert!(!results[0].excerpt.is_empty());
    }

    #[test]
    fn search_by_tag() {
        let store = Store::open_memory().unwrap();
        let node = make_node("a.md", "Something", &["engineering", "rust"], json!({}));
        store.upsert_node(&node, 1).unwrap();

        let results = store.search("engineering", 20).unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].id, "a.md");
    }

    #[test]
    fn search_by_paragraph() {
        let store = Store::open_memory().unwrap();
        let mut node = make_node("a.md", "Title", &[], json!({}));
        node.first_paragraph = "Quantum computing revolutionizes cryptography".into();
        store.upsert_node(&node, 1).unwrap();

        let results = store.search("cryptography", 20).unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].id, "a.md");
    }

    #[test]
    fn search_bm25_ordering() {
        let store = Store::open_memory().unwrap();
        let mut strong = make_node("strong.md", "Rust Rust Rust", &["rust"], json!({}));
        strong.first_paragraph = "Rust programming language for systems".into();
        store.upsert_node(&strong, 1).unwrap();

        let mut weak = make_node("weak.md", "Other Topic", &[], json!({}));
        weak.first_paragraph = "Mentions rust once in passing".into();
        store.upsert_node(&weak, 1).unwrap();

        let results = store.search("rust", 20).unwrap();
        assert!(results.len() >= 2);
        assert_eq!(
            results[0].id, "strong.md",
            "strongly relevant doc should rank first"
        );
    }

    #[test]
    fn search_excludes_stubs() {
        let store = Store::open_memory().unwrap();
        store.upsert_stub("Ghost Node").unwrap();

        let results = store.search("Ghost", 20).unwrap();
        assert!(results.is_empty());
    }

    #[test]
    fn search_respects_limit() {
        let store = Store::open_memory().unwrap();
        for i in 0..5 {
            let node = make_node(
                &format!("{i}.md"),
                &format!("Searchable Item {i}"),
                &[],
                json!({}),
            );
            store.upsert_node(&node, 1).unwrap();
        }

        let results = store.search("Searchable", 2).unwrap();
        assert_eq!(results.len(), 2);
    }

    #[test]
    fn search_no_matches_returns_empty() {
        let store = Store::open_memory().unwrap();
        let node = make_node("a.md", "Alpha", &[], json!({}));
        store.upsert_node(&node, 1).unwrap();

        let results = store.search("zzzznonexistent", 20).unwrap();
        assert!(results.is_empty());
    }

    #[test]
    fn fts_trigger_fires_on_delete() {
        let store = Store::open_memory().unwrap();
        let node = make_node("a.md", "Deleteable", &[], json!({}));
        store.upsert_node(&node, 1).unwrap();

        store.delete_node("a.md").unwrap();

        let results = store.search("Deleteable", 20).unwrap();
        assert!(results.is_empty());
    }

    #[test]
    fn fts_trigger_fires_on_update() {
        let store = Store::open_memory().unwrap();
        let old = make_node("a.md", "OldTitle", &[], json!({}));
        store.upsert_node(&old, 1).unwrap();

        let new = make_node("a.md", "NewTitle", &[], json!({}));
        store.upsert_node(&new, 2).unwrap();

        let old_results = store.search("OldTitle", 20).unwrap();
        assert!(old_results.is_empty(), "old title should not be in FTS");

        let new_results = store.search("NewTitle", 20).unwrap();
        assert_eq!(new_results.len(), 1);
        assert_eq!(new_results[0].title, "NewTitle");
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

    #[traced_test]
    #[test]
    fn search_logs() {
        let store = Store::open_memory().unwrap();
        let node = make_node("a.md", "Alpha", &[], json!({}));
        store.upsert_node(&node, 1).unwrap();
        let _ = store.search("Alpha", 20).unwrap();
        assert!(logs_contain("searching"));
        assert!(logs_contain("search complete"));
    }

    // --- Phase 11: Migration ---

    #[test]
    fn v1_to_v4_migration_backfills_tags_text_and_adds_raw_target_and_source_line() {
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
        assert_eq!(store.schema_version().unwrap(), 4);

        let tags_text: String = store
            .conn
            .query_row("SELECT tags_text FROM nodes WHERE id = 'a.md'", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert!(!tags_text.is_empty(), "tags_text should be backfilled");

        let results = store.search("Alpha", 20).unwrap();
        assert_eq!(results.len(), 1);

        // v3 column should exist
        store.insert_edge("a.md", "b.md", "ctx", "b", 0).unwrap();
        let raw_edges = store.all_raw_edges().unwrap();
        assert_eq!(raw_edges.len(), 1);
        assert_eq!(raw_edges[0].2, "b");
    }

    #[test]
    fn v2_to_v4_migration_adds_raw_target_and_source_line() {
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
        assert_eq!(store.schema_version().unwrap(), 4);

        let raw_edges = store.all_raw_edges().unwrap();
        assert_eq!(raw_edges.len(), 1);
        assert_eq!(raw_edges[0].2, "", "existing edges get empty raw_target");
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
}
