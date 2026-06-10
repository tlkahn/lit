use std::collections::{HashMap, HashSet};
use std::path::Path;

use rusqlite::{Connection, OptionalExtension};
use tracing::{debug, info};

use super::error::GraphError;
use super::types::{extract_aliases, AnnotationSearchResult, BacklinkEntry, EdgeKind, FullAnnotationRecord, IndexableAnnotation, LinkEntry, Materialization, ParsedNode, Stats, TagPageResult, TagSearchResult};

pub const CURRENT_SCHEMA_VERSION: i64 = 17;

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
        uuid: row.get(10)?,
    })
}

pub struct Store {
    pub(crate) conn: Connection,
}

struct ExistingAnnotation {
    id: i64,
    annotation_type: String,
    body: Option<String>,
    char_start: i64,
    uuid: String,
}

struct AnnotationDiff {
    updates: Vec<(usize, usize)>,
    inserts: Vec<usize>,
    deletes: Vec<usize>,
}

fn match_annotations(existing: &[ExistingAnnotation], incoming: &[IndexableAnnotation]) -> AnnotationDiff {
    // Group existing annotations by (type, body) key.
    let mut existing_groups: HashMap<(String, Option<String>), Vec<usize>> = HashMap::new();
    for (i, ex) in existing.iter().enumerate() {
        existing_groups
            .entry((ex.annotation_type.clone(), ex.body.clone()))
            .or_default()
            .push(i);
    }

    // Sort each group of existing candidates by char_start.
    for indices in existing_groups.values_mut() {
        indices.sort_by_key(|&i| existing[i].char_start);
    }

    // Group incoming annotations by the same key, sorted by char_start.
    let mut incoming_groups: HashMap<(String, Option<String>), Vec<usize>> = HashMap::new();
    for (i, ann) in incoming.iter().enumerate() {
        incoming_groups
            .entry((ann.annotation_type.clone(), ann.body.clone()))
            .or_default()
            .push(i);
    }
    for indices in incoming_groups.values_mut() {
        indices.sort_by_key(|&i| incoming[i].char_start);
    }

    // Pair by ordinal rank within each (type, body) group: first existing
    // (by position) pairs with first incoming (by position), etc. This
    // prevents UUID swaps when positions shift dramatically — e.g. an
    // annotation moving from pos 10 to 190 won't steal the UUID of
    // a neighbor at pos 200.
    let mut updates = Vec::new();
    let mut inserts = Vec::new();
    let mut matched_old: HashSet<usize> = HashSet::new();

    for (key, inc_indices) in &incoming_groups {
        if let Some(ex_indices) = existing_groups.get(key) {
            let pair_count = inc_indices.len().min(ex_indices.len());
            for rank in 0..pair_count {
                updates.push((inc_indices[rank], ex_indices[rank]));
                matched_old.insert(ex_indices[rank]);
            }
            // Extra incoming annotations beyond existing count are inserts.
            for &new_idx in &inc_indices[pair_count..] {
                inserts.push(new_idx);
            }
        } else {
            // No existing annotations for this key — all are inserts.
            for &new_idx in inc_indices {
                inserts.push(new_idx);
            }
        }
    }

    let deletes: Vec<usize> = (0..existing.len())
        .filter(|i| !matched_old.contains(i))
        .collect();

    AnnotationDiff { updates, inserts, deletes }
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
                "DROP TABLE IF EXISTS conversation_messages;
                 DROP TABLE IF EXISTS conversations;
                 DROP TABLE IF EXISTS annotations_fts;
                 DROP TABLE IF EXISTS annotations;
                 DROP TABLE IF EXISTS node_positions;
                 DROP TABLE IF EXISTS nodes;
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
                CREATE VIRTUAL TABLE IF NOT EXISTS annotations_fts USING fts5(body, node_id UNINDEXED, annotation_type UNINDEXED, tokenize = 'trigram case_sensitive 0');
                UPDATE meta SET value = '6' WHERE key = 'schema_version';"
            )?;
        }

        if version < 7 {
            info!(from = version, to = 7, "migrating schema: switching annotations_fts to trigram tokenizer");
            self.conn.execute_batch(
                "DROP TABLE IF EXISTS annotations_fts;
                 CREATE VIRTUAL TABLE IF NOT EXISTS annotations_fts USING fts5(
                     body, node_id UNINDEXED, annotation_type UNINDEXED,
                     tokenize = 'trigram case_sensitive 0'
                 );
                 INSERT INTO annotations_fts(rowid, body, node_id, annotation_type)
                     SELECT id, body, node_id, annotation_type
                     FROM annotations WHERE body IS NOT NULL;
                 UPDATE meta SET value = '7' WHERE key = 'schema_version';"
            )?;
        }

        if version < 8 {
            info!(from = version, to = 8, "migrating schema: adding node_positions");
            self.conn.execute_batch(
                "CREATE TABLE IF NOT EXISTS node_positions (
                    node_id TEXT PRIMARY KEY,
                    x REAL NOT NULL,
                    y REAL NOT NULL
                );
                UPDATE meta SET value = '8' WHERE key = 'schema_version';"
            )?;
        }

        if version < 9 {
            info!(from = version, to = 9, "migrating schema: adding conversations");
            self.conn.execute_batch(
                "CREATE TABLE IF NOT EXISTS conversations (
                    id TEXT PRIMARY KEY,
                    node_id TEXT NOT NULL REFERENCES nodes(id),
                    anchor_type TEXT,
                    anchor_id INTEGER,
                    title TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_conversations_node_id ON conversations(node_id);

                CREATE TABLE IF NOT EXISTS conversation_messages (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
                    role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
                    content TEXT NOT NULL,
                    seq INTEGER NOT NULL,
                    created_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_conv_messages_conv_id ON conversation_messages(conversation_id);

                UPDATE meta SET value = '9' WHERE key = 'schema_version';"
            )?;
        }

        if version < 10 {
            info!(from = version, to = 10, "migrating schema: adding ON DELETE CASCADE to conversations FK");
            self.conn.execute_batch("PRAGMA foreign_keys=OFF;")?;
            self.conn.execute_batch(
                "BEGIN TRANSACTION;
                CREATE TABLE conversations_new (
                    id TEXT PRIMARY KEY,
                    node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
                    anchor_type TEXT,
                    anchor_id INTEGER,
                    title TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                INSERT INTO conversations_new SELECT * FROM conversations;
                DROP TABLE conversations;
                ALTER TABLE conversations_new RENAME TO conversations;
                CREATE INDEX idx_conversations_node_id ON conversations(node_id);
                UPDATE meta SET value = '10' WHERE key = 'schema_version';
                COMMIT;"
            )?;
            self.conn.execute_batch("PRAGMA foreign_keys=ON;")?;
        }

        if version < 11 {
            info!(from = version, to = 11, "migrating schema: adding uuid to annotations, anchor_key to conversations");
            self.conn.execute_batch(
                "ALTER TABLE annotations ADD COLUMN uuid TEXT;
                 ALTER TABLE conversations ADD COLUMN anchor_key TEXT;
                 CREATE INDEX IF NOT EXISTS idx_conversations_anchor ON conversations(node_id, anchor_type, anchor_key);
                 UPDATE meta SET value = '11' WHERE key = 'schema_version';"
            )?;
            let mut stmt = self.conn.prepare("SELECT rowid FROM annotations WHERE uuid IS NULL")?;
            let rowids: Vec<i64> = stmt.query_map([], |row| row.get(0))?
                .collect::<Result<Vec<_>, _>>()?;
            for rowid in rowids {
                let id = uuid::Uuid::new_v4().to_string();
                self.conn.execute(
                    "UPDATE annotations SET uuid = ?1 WHERE rowid = ?2",
                    rusqlite::params![id, rowid],
                )?;
            }
        }

        if version < 12 {
            info!(from = version, to = 12, "migrating schema: enforcing NOT NULL on annotations.uuid");
            self.conn.execute_batch("PRAGMA foreign_keys=OFF;")?;
            self.conn.execute_batch(
                "BEGIN TRANSACTION;
                CREATE TABLE annotations_new (
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
                    scope_value TEXT NOT NULL,
                    uuid TEXT NOT NULL
                );
                INSERT INTO annotations_new SELECT id, node_id, annotation_type, certainty, body, date, source_line, char_start, char_end, scope_kind, scope_value, uuid FROM annotations;
                DROP TABLE annotations;
                ALTER TABLE annotations_new RENAME TO annotations;
                CREATE INDEX idx_annotations_node_id ON annotations(node_id);
                CREATE INDEX idx_annotations_type ON annotations(annotation_type);
                DELETE FROM annotations_fts;
                INSERT INTO annotations_fts(rowid, body, node_id, annotation_type)
                    SELECT id, body, node_id, annotation_type FROM annotations WHERE body IS NOT NULL;
                UPDATE meta SET value = '12' WHERE key = 'schema_version';
                COMMIT;"
            )?;
            self.conn.execute_batch("PRAGMA foreign_keys=ON;")?;
        }

        if version < 13 {
            info!(from = version, to = 13, "migrating schema: unique anchor constraint on conversations");
            self.conn.execute_batch(
                "DELETE FROM conversations WHERE rowid NOT IN (
                    SELECT MIN(rowid) FROM conversations
                    WHERE anchor_key IS NOT NULL
                    GROUP BY node_id, anchor_type, anchor_key
                ) AND anchor_key IS NOT NULL;
                DROP INDEX IF EXISTS idx_conversations_anchor;
                CREATE UNIQUE INDEX idx_conversations_anchor
                    ON conversations(node_id, anchor_type, anchor_key);
                UPDATE meta SET value = '13' WHERE key = 'schema_version';"
            )?;
        }

        if version < 14 {
            info!(from = version, to = 14, "migrating schema: removing conversations — existing conversation data is removed");
            self.conn.execute_batch(
                "DROP INDEX IF EXISTS idx_conversations_anchor;
                 DROP INDEX IF EXISTS idx_conversations_node_id;
                 DROP INDEX IF EXISTS idx_conv_messages_conv_id;
                 DROP TABLE IF EXISTS conversation_messages;
                 DROP TABLE IF EXISTS conversations;
                 UPDATE meta SET value = '14' WHERE key = 'schema_version';"
            )?;
        }

        if version < 15 {
            info!(from = version, to = 15, "migrating schema: adding edge_kind to edges");
            self.conn.execute_batch(
                "ALTER TABLE edges ADD COLUMN edge_kind TEXT NOT NULL DEFAULT 'wikilink';
                 CREATE INDEX IF NOT EXISTS idx_edges_kind ON edges(edge_kind);
                 UPDATE sync SET mtime = 0;
                 UPDATE meta SET value = '15' WHERE key = 'schema_version';"
            )?;
        }

        if version < 16 {
            info!(from = version, to = 16, "migrating schema: adding materialization to nodes");
            self.conn.execute_batch(
                "ALTER TABLE nodes ADD COLUMN materialization TEXT NOT NULL DEFAULT 'materialized';
                 UPDATE nodes SET materialization = 'stub' WHERE is_stub = 1;
                 UPDATE sync SET mtime = 0;
                 UPDATE meta SET value = '16' WHERE key = 'schema_version';"
            )?;
        }

        if version < 17 {
            info!(from = version, to = 17, "migrating schema: adding is_stub/materialization consistency triggers");
            self.conn.execute_batch(
                "CREATE TRIGGER IF NOT EXISTS trg_nodes_is_stub_insert
                 BEFORE INSERT ON nodes
                 FOR EACH ROW
                 WHEN NEW.materialization IS NOT NULL
                   AND NEW.is_stub != (NEW.materialization = 'stub')
                 BEGIN
                     SELECT RAISE(ABORT, 'is_stub inconsistent with materialization');
                 END;

                 CREATE TRIGGER IF NOT EXISTS trg_nodes_is_stub_update
                 BEFORE UPDATE ON nodes
                 FOR EACH ROW
                 WHEN NEW.materialization IS NOT NULL
                   AND NEW.is_stub != (NEW.materialization = 'stub')
                 BEGIN
                     SELECT RAISE(ABORT, 'is_stub inconsistent with materialization');
                 END;

                 UPDATE meta SET value = '17' WHERE key = 'schema_version';"
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
            "INSERT INTO nodes(id, title, first_paragraph, frontmatter, mtime, is_stub, tags_text, materialization)
             VALUES (?1, ?2, ?3, ?4, ?5, 0, ?6, 'materialized')
             ON CONFLICT(id) DO UPDATE SET
                title = excluded.title,
                first_paragraph = excluded.first_paragraph,
                frontmatter = excluded.frontmatter,
                mtime = excluded.mtime,
                is_stub = excluded.is_stub,
                tags_text = excluded.tags_text,
                materialization = excluded.materialization",
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
            "INSERT OR IGNORE INTO nodes(id, title, first_paragraph, frontmatter, mtime, is_stub, materialization)
             VALUES (?1, '', '', '{}', 0, 1, 'stub')",
            [id],
        )?;
        Ok(())
    }

    pub fn upsert_shadow(&self, id: &str, title: &str, materialization: Materialization) -> Result<(), GraphError> {
        self.conn.execute(
            "INSERT INTO nodes(id, title, first_paragraph, frontmatter, mtime, is_stub, tags_text, materialization)
             VALUES (?1, ?2, '', '{}', 0, 0, '', ?3)
             ON CONFLICT(id) DO UPDATE SET
                title = excluded.title,
                materialization = excluded.materialization
             WHERE nodes.materialization IN ('shadow', 'partial')",
            rusqlite::params![id, title, materialization.as_str()],
        )?;
        Ok(())
    }

    pub fn prune_shadows(&self, keep_ids: &HashSet<String>) -> Result<usize, GraphError> {
        let mut stmt = self.conn.prepare(
            "SELECT id FROM nodes WHERE id LIKE 'bib:%' AND materialization IN ('shadow', 'partial')"
        )?;
        let all_shadow_ids: Vec<String> = stmt
            .query_map([], |row| row.get(0))?
            .collect::<Result<Vec<_>, _>>()?;

        let mut count = 0usize;
        for id in &all_shadow_ids {
            if !keep_ids.contains(id) {
                self.delete_node(id)?;
                count += 1;
            }
        }
        Ok(count)
    }

    pub fn delete_node(&self, id: &str) -> Result<(), GraphError> {
        self.with_savepoint("delete_node", || {
            self.conn.execute("DELETE FROM annotations_fts WHERE node_id = ?1", [id])?;
            self.conn.execute("DELETE FROM annotations WHERE node_id = ?1", [id])?;
            self.conn.execute("DELETE FROM nodes WHERE id = ?1", [id])?;
            self.conn.execute("DELETE FROM tags WHERE node_id = ?1", [id])?;
            self.conn.execute("DELETE FROM aliases WHERE node_id = ?1", [id])?;
            self.conn.execute("DELETE FROM edges WHERE source = ?1 OR target = ?1", [id])?;
            self.conn.execute("DELETE FROM sync WHERE path = ?1", [id])?;
            self.conn.execute("DELETE FROM node_positions WHERE node_id = ?1", [id])?;
            Ok(())
        })
    }

    // --- Positions ---

    pub fn save_positions(&self, positions: &HashMap<String, super::types::Position>) -> Result<(), GraphError> {
        let tx = self.conn.unchecked_transaction()?;
        self.write_positions_no_tx(positions)?;
        tx.commit()?;
        Ok(())
    }

    /// Replaces all rows in `node_positions` without opening its own
    /// transaction. Callers must wrap this in a transaction (or SAVEPOINT) to
    /// preserve atomicity — `save_positions` does so directly, while the `.lkg`
    /// importer calls this inside its own SAVEPOINT (a nested `BEGIN` would
    /// otherwise raise "cannot start a transaction within a transaction").
    ///
    /// # Single-connection invariant
    ///
    /// `Store` holds a single `rusqlite::Connection` (no pooling). This method
    /// operates on `self.conn` directly and relies on the caller's transaction
    /// living on the same connection.
    pub(crate) fn write_positions_no_tx(&self, positions: &HashMap<String, super::types::Position>) -> Result<(), GraphError> {
        self.conn.execute_batch("DELETE FROM node_positions")?;
        let mut stmt = self.conn.prepare(
            "INSERT INTO node_positions(node_id, x, y) VALUES (?1, ?2, ?3)"
        )?;
        for (id, pos) in positions {
            stmt.execute(rusqlite::params![id, pos.x, pos.y])?;
        }
        Ok(())
    }

    pub fn load_positions(&self) -> Result<HashMap<String, super::types::Position>, GraphError> {
        let mut stmt = self.conn.prepare(
            "SELECT node_id, x, y FROM node_positions"
        )?;
        let map = stmt.query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                super::types::Position { x: row.get(1)?, y: row.get(2)? },
            ))
        })?.filter_map(|r| r.ok()).collect();
        Ok(map)
    }

    pub fn clear_positions(&self) -> Result<(), GraphError> {
        self.conn.execute("DELETE FROM node_positions", [])?;
        Ok(())
    }

    // --- Edges ---

    pub fn insert_edge(&self, source: &str, target: &str, ctx: &str, raw_target: &str, source_line: u32, kind: EdgeKind) -> Result<(), GraphError> {
        self.conn.execute(
            "INSERT INTO edges(source, target, context, raw_target, source_line, edge_kind) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            rusqlite::params![source, target, ctx, raw_target, source_line, kind.as_str()],
        )?;
        Ok(())
    }

    pub fn delete_edges_from(&self, source: &str) -> Result<(), GraphError> {
        self.conn
            .execute("DELETE FROM edges WHERE source = ?1", [source])?;
        Ok(())
    }

    pub fn replace_all_edges(&self, edges: &[(&str, &str, &str, &str, u32, EdgeKind)]) -> Result<(), GraphError> {
        let tx = self.conn.unchecked_transaction()?;
        self.replace_all_edges_no_tx(edges)?;
        tx.commit()?;
        Ok(())
    }

    /// Replaces all rows in `edges` without opening its own transaction. Callers
    /// must wrap this in a transaction (or SAVEPOINT) to preserve atomicity —
    /// `replace_all_edges` does so directly, while the `.lkg` importer calls this
    /// inside its own SAVEPOINT (a nested `BEGIN` would otherwise raise "cannot
    /// start a transaction within a transaction").
    ///
    /// # Single-connection invariant
    ///
    /// `Store` holds a single `rusqlite::Connection` (no pooling). This method
    /// operates on `self.conn` directly and relies on the caller's transaction
    /// living on the same connection.
    pub(crate) fn replace_all_edges_no_tx(&self, edges: &[(&str, &str, &str, &str, u32, EdgeKind)]) -> Result<(), GraphError> {
        self.conn.execute("DELETE FROM edges", [])?;
        for &(source, target, context, raw_target, source_line, kind) in edges {
            self.conn.execute(
                "INSERT INTO edges(source, target, context, raw_target, source_line, edge_kind) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                rusqlite::params![source, target, context, raw_target, source_line, kind.as_str()],
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

    /// Wikilink edges only, by design: this feeds `ReverseStemIndex`, which
    /// tracks page stems — citation targets are bib keys, not stems.
    pub fn all_raw_edges(&self) -> Result<Vec<(String, String, String)>, GraphError> {
        let mut stmt = self.conn.prepare(
            "SELECT source, target, raw_target FROM edges WHERE edge_kind = 'wikilink' ORDER BY source, target"
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

    /// Returns node IDs eligible for wikilink resolution (StemLookup).
    /// Excludes shadow and partial nodes so that wikilinks never resolve
    /// to citation-only nodes, preserving the citation-only invariant.
    pub fn resolvable_node_ids(&self) -> Result<Vec<String>, GraphError> {
        let mut stmt = self.conn.prepare(
            "SELECT id FROM nodes WHERE materialization NOT IN ('shadow', 'partial') ORDER BY id"
        )?;
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

    pub fn all_edges_full(&self) -> Result<Vec<(String, String, String, String, u32, EdgeKind)>, GraphError> {
        let mut stmt = self.conn.prepare(
            "SELECT source, target, context, raw_target, source_line, edge_kind FROM edges ORDER BY source, target"
        )?;
        let edges = stmt
            .query_map([], |row| {
                let kind: String = row.get(5)?;
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, u32>(4)?,
                    EdgeKind::from(kind.as_str()),
                ))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(edges)
    }

    pub fn all_nodes_metadata(&self) -> Result<Vec<(String, bool, Materialization)>, GraphError> {
        let mut stmt = self
            .conn
            .prepare("SELECT id, is_stub, materialization FROM nodes ORDER BY id")?;
        let nodes = stmt
            .query_map([], |row| {
                let id: String = row.get(0)?;
                let is_stub: i64 = row.get(1)?;
                let mat_str: String = row.get(2)?;
                Ok((id, is_stub != 0, Materialization::from(mat_str.as_str())))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(nodes)
    }

    /// Returns every node row's `(id, is_stub, title, frontmatter, first_paragraph)`
    /// in a single id-sorted scan, collapsing what would otherwise be four separate
    /// full-table queries ([`all_nodes_metadata`](Self::all_nodes_metadata),
    /// [`node_titles`](Self::node_titles),
    /// [`node_frontmatter_map`](Self::node_frontmatter_map), and
    /// [`get_first_paragraphs`](Self::get_first_paragraphs)). Used by the `.lkg`
    /// exporter. Frontmatter falls back to an empty object on NULL/parse-failure and
    /// `first_paragraph` falls back to `""` on NULL, matching the per-column accessors.
    pub fn all_bundle_node_rows(
        &self,
    ) -> Result<Vec<(String, bool, String, serde_json::Value, String)>, GraphError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, is_stub, title, frontmatter, first_paragraph FROM nodes ORDER BY id",
        )?;
        let rows = stmt
            .query_map([], |row| {
                let id: String = row.get(0)?;
                let is_stub: i64 = row.get(1)?;
                let title: String = row.get(2)?;
                let fm_str: Option<String> = row.get(3)?;
                let first_paragraph: Option<String> = row.get(4)?;
                Ok((id, is_stub, title, fm_str, first_paragraph))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        let mapped = rows
            .into_iter()
            .map(|(id, is_stub, title, fm_str, first_paragraph)| {
                let frontmatter = fm_str
                    .and_then(|s| serde_json::from_str(&s).ok())
                    .unwrap_or_else(|| serde_json::Value::Object(Default::default()));
                (
                    id,
                    is_stub != 0,
                    title,
                    frontmatter,
                    first_paragraph.unwrap_or_default(),
                )
            })
            .collect();
        Ok(mapped)
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

    pub fn node_frontmatter_map(&self) -> Result<HashMap<String, serde_json::Value>, GraphError> {
        let mut stmt = self.conn.prepare("SELECT id, frontmatter FROM nodes")?;
        let rows = stmt
            .query_map([], |row| {
                let id: String = row.get(0)?;
                let fm_str: Option<String> = row.get(1)?;
                Ok((id, fm_str))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        let mut map = HashMap::new();
        for (id, fm_str) in rows {
            let value = fm_str
                .and_then(|s| serde_json::from_str(&s).ok())
                .unwrap_or_else(|| serde_json::Value::Object(Default::default()));
            map.insert(id, value);
        }
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

    /// Pages containing a `[@bib_key]` citation of `bib_key`, via citation-kind
    /// edges only. Citation edge targets are bib keys (not page ids), so these
    /// rows never appear in petgraph; this is the DB-only query path for them.
    pub fn citing_pages(&self, bib_key: &str) -> Result<Vec<BacklinkEntry>, GraphError> {
        let mut stmt = self.conn.prepare(
            "SELECT e.source, n.title, e.context, e.source_line
             FROM edges e
             JOIN nodes n ON n.id = e.source
             WHERE e.raw_target = ?1 AND e.edge_kind = 'citation'
             ORDER BY e.source",
        )?;
        let results = stmt
            .query_map([bib_key], |row| {
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

    /// Returns `(citekey, page_id)` pairs for all pages that declare a `citekey`
    /// in their frontmatter JSON.
    pub fn citekey_pages(&self) -> Result<Vec<(String, String)>, GraphError> {
        let mut stmt = self.conn.prepare(
            "SELECT json_extract(frontmatter, '$.citekey'), id FROM nodes
             WHERE json_extract(frontmatter, '$.citekey') IS NOT NULL
             ORDER BY id"
        )?;
        let rows = stmt
            .query_map([], |row| {
                let citekey: String = row.get(0)?;
                let page_id: String = row.get(1)?;
                Ok((citekey, page_id))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    /// Returns page ids that cite the given raw key via citation edges.
    pub fn sources_citing(&self, raw_key: &str) -> Result<Vec<String>, GraphError> {
        let mut stmt = self.conn.prepare(
            "SELECT DISTINCT source FROM edges
             WHERE raw_target = ?1 AND edge_kind = 'citation'
             ORDER BY source"
        )?;
        let sources = stmt
            .query_map([raw_key], |row| row.get(0))?
            .collect::<Result<Vec<String>, _>>()?;
        Ok(sources)
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

    pub fn get_first_paragraphs(&self, ids: &[String]) -> Result<HashMap<String, String>, GraphError> {
        if ids.is_empty() {
            return Ok(HashMap::new());
        }
        let placeholders: Vec<String> = (1..=ids.len()).map(|i| format!("?{i}")).collect();
        let sql = format!(
            "SELECT id, first_paragraph FROM nodes WHERE id IN ({}) AND first_paragraph IS NOT NULL",
            placeholders.join(", ")
        );
        let mut stmt = self.conn.prepare(&sql)?;
        let params: Vec<&dyn rusqlite::types::ToSql> =
            ids.iter().map(|id| id as &dyn rusqlite::types::ToSql).collect();
        let map = stmt
            .query_map(params.as_slice(), |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })?
            .filter_map(|r| r.ok())
            .collect();
        Ok(map)
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
             WHERE (title LIKE '%' || ?1 || '%' COLLATE NOCASE
                OR id LIKE '%' || ?1 || '%' COLLATE NOCASE)
               AND is_stub = 0
             UNION
             SELECT a.node_id, n.title FROM aliases a
             JOIN nodes n ON n.id = a.node_id
             WHERE a.alias LIKE '%' || ?1 || '%' COLLATE NOCASE
               AND n.is_stub = 0
             LIMIT ?2"
        )?;
        let results = stmt
            .query_map(rusqlite::params![query, limit], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(results)
    }

    // --- Tags ---

    pub fn search_tags(&self, query: &str, limit: i64) -> Result<Vec<TagSearchResult>, GraphError> {
        if query.is_empty() {
            return Ok(vec![]);
        }
        let mut stmt = self.conn.prepare(
            "SELECT tag, COUNT(*) as cnt FROM tags
             WHERE tag LIKE '%' || ?1 || '%' COLLATE NOCASE
             GROUP BY tag
             ORDER BY cnt DESC, tag ASC
             LIMIT ?2"
        )?;
        let results = stmt
            .query_map(rusqlite::params![query, limit], |row| {
                Ok(TagSearchResult {
                    tag: row.get(0)?,
                    count: row.get(1)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(results)
    }

    pub fn list_pages_by_tag(&self, tag: &str, limit: i64) -> Result<Vec<TagPageResult>, GraphError> {
        let mut stmt = self.conn.prepare(
            "SELECT n.id, n.title, n.first_paragraph FROM nodes n
             JOIN tags t ON n.id = t.node_id
             WHERE t.tag = ?1
             ORDER BY n.title ASC
             LIMIT ?2"
        )?;
        let results = stmt
            .query_map(rusqlite::params![tag, limit], |row| {
                Ok(TagPageResult {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    first_paragraph: row.get(2)?,
                })
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

    /// Count only wikilink edges. Used by `graph_fingerprint()` because
    /// pagerank only operates on wikilink edges; citation edges are DB-only.
    pub fn wikilink_edge_count(&self) -> Result<i64, GraphError> {
        let count: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM edges WHERE edge_kind = 'wikilink'",
            [],
            |row| row.get(0),
        )?;
        Ok(count)
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
        // Only wikilink edges participate in pagerank; citation edges are DB-only.
        let wikilink_edges = self.wikilink_edge_count()?;
        let max_mtime = self.max_mtime()?;
        Ok(format!("{}:{}:{}", total_nodes, wikilink_edges, max_mtime))
    }

    // --- Annotations ---

    fn fetch_existing_annotations(&self, node_id: &str) -> Result<Vec<ExistingAnnotation>, GraphError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, annotation_type, body, char_start, uuid FROM annotations WHERE node_id = ?1",
        )?;
        let rows = stmt.query_map([node_id], |row| {
            Ok(ExistingAnnotation {
                id: row.get(0)?,
                annotation_type: row.get(1)?,
                body: row.get(2)?,
                char_start: row.get(3)?,
                uuid: row.get(4)?,
            })
        })?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    }

    pub fn upsert_annotations(&self, node_id: &str, annotations: &[IndexableAnnotation]) -> Result<Vec<String>, GraphError> {
        let existing = self.fetch_existing_annotations(node_id)?;
        let diff = match_annotations(&existing, annotations);

        let mut update_stmt = self.conn.prepare(
            "UPDATE annotations SET certainty=?1, date=?2, source_line=?3, char_start=?4, char_end=?5, scope_kind=?6, scope_value=?7, uuid=COALESCE(?8, uuid) WHERE id=?9",
        )?;
        for &(new_idx, old_idx) in &diff.updates {
            let ann = &annotations[new_idx];
            update_stmt.execute(rusqlite::params![
                ann.certainty,
                ann.date,
                ann.source_line,
                ann.char_start,
                ann.char_end,
                ann.scope_kind,
                ann.scope_value,
                ann.uuid,
                existing[old_idx].id,
            ])?;
        }

        let mut insert_stmt = self.conn.prepare(
            "INSERT INTO annotations(node_id, annotation_type, certainty, body, date, source_line, char_start, char_end, scope_kind, scope_value, uuid)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
        )?;
        let mut inserted_rowids = Vec::with_capacity(diff.inserts.len());
        for &new_idx in &diff.inserts {
            let ann = &annotations[new_idx];
            let uuid_val = ann.uuid.clone().unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
            insert_stmt.execute(rusqlite::params![
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
                uuid_val,
            ])?;
            inserted_rowids.push(self.conn.last_insert_rowid());
        }

        let deleted_uuids: Vec<String> = diff.deletes.iter()
            .map(|&old_idx| existing[old_idx].uuid.clone())
            .collect();

        for &old_idx in &diff.deletes {
            self.conn.execute("DELETE FROM annotations WHERE id = ?1", [existing[old_idx].id])?;
        }

        // Incremental FTS maintenance: only touch rows that changed
        if !diff.inserts.is_empty() || !diff.deletes.is_empty() {
            // Delete FTS rows for removed annotations
            for &old_idx in &diff.deletes {
                self.conn.execute(
                    "DELETE FROM annotations_fts WHERE rowid = ?1",
                    [existing[old_idx].id],
                )?;
            }
            // Insert FTS rows for newly added annotations
            let mut fts_insert = self.conn.prepare(
                "INSERT INTO annotations_fts(rowid, body, node_id, annotation_type)
                 SELECT id, body, node_id, annotation_type FROM annotations WHERE id = ?1 AND body IS NOT NULL",
            )?;
            for rowid in &inserted_rowids {
                fts_insert.execute([rowid])?;
            }
        }

        Ok(deleted_uuids)
    }

    pub fn search_annotations(&self, query: &str, type_filter: Option<&str>, limit: i64) -> Result<Vec<AnnotationSearchResult>, GraphError> {
        let terms: Vec<&str> = query.split_whitespace().collect();
        let has_short_term = terms.iter().any(|t| t.chars().count() < 3);

        if has_short_term {
            let mut conditions = Vec::new();
            let mut params: Vec<rusqlite::types::Value> = Vec::new();
            let mut idx = 1;

            for term in &terms {
                let clean = term.replace('%', "").replace('_', "");
                conditions.push(format!("a.body LIKE ?{idx}"));
                params.push(rusqlite::types::Value::Text(format!("%{clean}%")));
                idx += 1;
            }

            if let Some(tf) = type_filter {
                conditions.push(format!("a.annotation_type = ?{idx}"));
                params.push(rusqlite::types::Value::Text(tf.to_string()));
                idx += 1;
            }

            let where_clause = conditions.join(" AND ");
            let sql = format!(
                "SELECT a.id, a.node_id, n.title, a.annotation_type, a.certainty, a.body, a.date, a.source_line, a.char_start, a.char_end, a.uuid
                 FROM annotations a
                 JOIN nodes n ON n.id = a.node_id
                 WHERE {where_clause}
                 ORDER BY length(a.body) ASC
                 LIMIT ?{idx}"
            );
            params.push(rusqlite::types::Value::Integer(limit));

            let mut stmt = self.conn.prepare(&sql)?;
            let param_refs: Vec<&dyn rusqlite::types::ToSql> = params.iter().map(|v| v as &dyn rusqlite::types::ToSql).collect();
            let results = stmt
                .query_map(param_refs.as_slice(), map_annotation_row)?
                .collect::<Result<Vec<_>, _>>()?;
            Ok(results)
        } else {
            let fts_query: String = query
                .split_whitespace()
                .map(|w| format!("\"{}\"", w.replace('"', "")))
                .collect::<Vec<_>>()
                .join(" ");

            let (sql, params_count) = if type_filter.is_some() {
                (
                    "SELECT a.id, a.node_id, n.title, a.annotation_type, a.certainty, a.body, a.date, a.source_line, a.char_start, a.char_end, a.uuid
                     FROM annotations_fts f
                     JOIN annotations a ON a.id = f.rowid
                     JOIN nodes n ON n.id = a.node_id
                     WHERE annotations_fts MATCH ?1 AND a.annotation_type = ?2
                     ORDER BY rank
                     LIMIT ?3",
                    3,
                )
            } else {
                (
                    "SELECT a.id, a.node_id, n.title, a.annotation_type, a.certainty, a.body, a.date, a.source_line, a.char_start, a.char_end, a.uuid
                     FROM annotations_fts f
                     JOIN annotations a ON a.id = f.rowid
                     JOIN nodes n ON n.id = a.node_id
                     WHERE annotations_fts MATCH ?1
                     ORDER BY rank
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
    }

    pub fn all_annotations_full(&self) -> Result<Vec<FullAnnotationRecord>, GraphError> {
        let mut stmt = self.conn.prepare(
            "SELECT uuid, node_id, annotation_type, certainty, body, date, source_line, char_start, char_end, scope_kind, scope_value
             FROM annotations
             ORDER BY node_id, char_start",
        )?;
        let rows = stmt
            .query_map([], |row| {
                Ok(FullAnnotationRecord {
                    uuid: row.get(0)?,
                    node_id: row.get(1)?,
                    annotation_type: row.get(2)?,
                    certainty: row.get(3)?,
                    body: row.get(4)?,
                    date: row.get(5)?,
                    source_line: row.get(6)?,
                    char_start: row.get(7)?,
                    char_end: row.get(8)?,
                    scope_kind: row.get(9)?,
                    scope_value: row.get(10)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    pub fn list_annotations(&self, node_id: Option<&str>, type_filter: Option<&str>, limit: i64) -> Result<Vec<AnnotationSearchResult>, GraphError> {
        match (node_id, type_filter) {
            (Some(nid), Some(tf)) => {
                let mut stmt = self.conn.prepare(
                    "SELECT a.id, a.node_id, n.title, a.annotation_type, a.certainty, a.body, a.date, a.source_line, a.char_start, a.char_end, a.uuid
                     FROM annotations a
                     JOIN nodes n ON n.id = a.node_id
                     WHERE a.node_id = ?1 AND a.annotation_type = ?2
                     ORDER BY a.source_line
                     LIMIT ?3",
                )?;
                let results = stmt
                    .query_map(rusqlite::params![nid, tf, limit], map_annotation_row)?
                    .collect::<Result<Vec<_>, _>>()?;
                Ok(results)
            }
            (Some(nid), None) => {
                let mut stmt = self.conn.prepare(
                    "SELECT a.id, a.node_id, n.title, a.annotation_type, a.certainty, a.body, a.date, a.source_line, a.char_start, a.char_end, a.uuid
                     FROM annotations a
                     JOIN nodes n ON n.id = a.node_id
                     WHERE a.node_id = ?1
                     ORDER BY a.source_line
                     LIMIT ?2",
                )?;
                let results = stmt
                    .query_map(rusqlite::params![nid, limit], map_annotation_row)?
                    .collect::<Result<Vec<_>, _>>()?;
                Ok(results)
            }
            (None, Some(tf)) => {
                let mut stmt = self.conn.prepare(
                    "SELECT a.id, a.node_id, n.title, a.annotation_type, a.certainty, a.body, a.date, a.source_line, a.char_start, a.char_end, a.uuid
                     FROM annotations a
                     JOIN nodes n ON n.id = a.node_id
                     WHERE a.annotation_type = ?1
                     ORDER BY a.node_id, a.source_line
                     LIMIT ?2",
                )?;
                let results = stmt
                    .query_map(rusqlite::params![tf, limit], map_annotation_row)?
                    .collect::<Result<Vec<_>, _>>()?;
                Ok(results)
            }
            (None, None) => {
                let mut stmt = self.conn.prepare(
                    "SELECT a.id, a.node_id, n.title, a.annotation_type, a.certainty, a.body, a.date, a.source_line, a.char_start, a.char_end, a.uuid
                     FROM annotations a
                     JOIN nodes n ON n.id = a.node_id
                     ORDER BY a.node_id, a.source_line
                     LIMIT ?1",
                )?;
                let results = stmt
                    .query_map(rusqlite::params![limit], map_annotation_row)?
                    .collect::<Result<Vec<_>, _>>()?;
                Ok(results)
            }
        }
    }

    pub fn find_annotation_uuid(
        &self,
        node_id: &str,
        annotation_type: &str,
        body: Option<&str>,
        char_start_hint: usize,
    ) -> Result<Option<String>, GraphError> {
        let uuid: Option<String> = self
            .conn
            .query_row(
                "SELECT uuid FROM annotations
                 WHERE node_id = ?1 AND annotation_type = ?2 AND body IS ?3
                 ORDER BY ABS(char_start - ?4) LIMIT 1",
                rusqlite::params![node_id, annotation_type, body, char_start_hint as i64],
                |row| row.get(0),
            )
            .optional()?;
        Ok(uuid)
    }

    // --- Transactions ---

    pub(crate) fn with_savepoint<F, T>(&self, name: &str, f: F) -> Result<T, GraphError>
    where
        F: FnOnce() -> Result<T, GraphError>,
    {
        self.conn
            .execute_batch(&format!("SAVEPOINT {name}"))?;
        match f() {
            Ok(val) => {
                self.conn
                    .execute_batch(&format!("RELEASE {name}"))?;
                Ok(val)
            }
            Err(e) => {
                self.conn
                    .execute_batch(&format!("ROLLBACK TO {name}"))?;
                self.conn
                    .execute_batch(&format!("RELEASE {name}"))?;
                Err(e)
            }
        }
    }

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

    // --- with_savepoint ---

    #[test]
    fn with_savepoint_commits_on_success() {
        let store = Store::open_memory().unwrap();
        store
            .with_savepoint("sp", || {
                let node = make_node("a.md", "A", &[], json!({}));
                store.upsert_node(&node, 1)?;
                Ok(())
            })
            .unwrap();
        assert_eq!(store.node_titles().unwrap().get("a.md"), Some(&"A".to_string()));
    }

    #[test]
    fn with_savepoint_rolls_back_on_error() {
        let store = Store::open_memory().unwrap();
        let node = make_node("a.md", "A", &[], json!({}));
        store.upsert_node(&node, 1).unwrap();

        let result: Result<(), _> = store.with_savepoint("sp", || {
            let node_b = make_node("b.md", "B", &[], json!({}));
            store.upsert_node(&node_b, 1)?;
            Err(GraphError::Other("forced failure".into()))
        });
        assert!(result.is_err());

        let titles = store.node_titles().unwrap();
        assert_eq!(titles.get("a.md"), Some(&"A".to_string()));
        assert_eq!(titles.get("b.md"), None);
    }

    #[test]
    fn with_savepoint_returns_closure_value() {
        let store = Store::open_memory().unwrap();
        let val = store.with_savepoint("sp", || Ok(42u64)).unwrap();
        assert_eq!(val, 42);
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
    fn schema_version_from_future_resets_all_tables() {
        let dir = tempfile::tempdir().unwrap();
        let db_path = dir.path().join("graph.db");

        {
            let store = Store::open(&db_path).unwrap();
            let node = make_node("a.md", "A", &["t"], json!({"aliases": ["X"]}));
            store.upsert_node(&node, 1000).unwrap();
            store.upsert_annotations("a.md", &[IndexableAnnotation {
                annotation_type: "highlight".into(),
                certainty: "certain".into(),
                body: Some("test body".into()),
                date: None,
                source_line: 1,
                char_start: 0,
                char_end: 10,
                scope_kind: "file".into(),
                scope_value: "a.md".into(),
                uuid: None,
            }]).unwrap();
            use super::super::types::Position;
            let mut positions = HashMap::new();
            positions.insert("a.md".into(), Position { x: 1.0, y: 2.0 });
            store.save_positions(&positions).unwrap();

            store.conn.execute(
                "UPDATE meta SET value = '999' WHERE key = 'schema_version'", [],
            ).unwrap();
        }

        let store = Store::open(&db_path).unwrap();
        assert_eq!(store.schema_version().unwrap(), CURRENT_SCHEMA_VERSION);

        for table in &["annotations", "annotations_fts", "node_positions"] {
            let count: i64 = store.conn.query_row(
                &format!("SELECT COUNT(*) FROM {}", table), [], |r| r.get(0),
            ).unwrap();
            assert_eq!(count, 0, "table {} should be empty after future-schema reset", table);
        }
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
            assert_eq!(store.schema_version().unwrap(), CURRENT_SCHEMA_VERSION);
        }
        {
            let store = Store::open(&db_path).unwrap();
            assert_eq!(store.schema_version().unwrap(), CURRENT_SCHEMA_VERSION);
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
        assert_eq!(store.get_meta("schema_version").unwrap(), Some(CURRENT_SCHEMA_VERSION.to_string()));
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
        store.insert_edge("a.md", "b.md", "ctx", "", 0, EdgeKind::Wikilink).unwrap();

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
        store.insert_edge("a.md", "b.md", "", "", 0, EdgeKind::Wikilink).unwrap();
        store.insert_edge("b.md", "a.md", "", "", 0, EdgeKind::Wikilink).unwrap();

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

    #[test]
    fn delete_node_is_atomic() {
        let store = Store::open_memory().unwrap();
        let node = make_node("a.md", "A", &["t"], json!({}));
        store.upsert_node(&node, 1).unwrap();
        store.insert_edge("a.md", "b.md", "ctx", "", 0, EdgeKind::Wikilink).unwrap();
        {
            use super::super::types::Position;
            let mut positions = HashMap::new();
            positions.insert("a.md".into(), Position { x: 1.0, y: 2.0 });
            store.save_positions(&positions).unwrap();
        }

        store.conn.execute_batch(
            "CREATE TRIGGER test_block_position_delete
             BEFORE DELETE ON node_positions
             BEGIN
                 SELECT RAISE(ABORT, 'blocked by test trigger');
             END;"
        ).unwrap();

        let result = store.delete_node("a.md");
        assert!(result.is_err(), "delete_node should fail when trigger blocks");

        let node_count: i64 = store.conn.query_row(
            "SELECT COUNT(*) FROM nodes WHERE id = 'a.md'", [], |r| r.get(0),
        ).unwrap();
        assert_eq!(node_count, 1, "node should survive rollback");

        let tag_count: i64 = store.conn.query_row(
            "SELECT COUNT(*) FROM tags WHERE node_id = 'a.md'", [], |r| r.get(0),
        ).unwrap();
        assert_eq!(tag_count, 1, "tags should survive rollback");

        let edge_count: i64 = store.conn.query_row(
            "SELECT COUNT(*) FROM edges WHERE source = 'a.md'", [], |r| r.get(0),
        ).unwrap();
        assert_eq!(edge_count, 1, "edges should survive rollback");

        store.conn.execute_batch("DROP TRIGGER test_block_position_delete;").unwrap();
    }

    // --- Phase 6: Edge operations ---

    #[test]
    fn insert_edge_and_query() {
        let store = Store::open_memory().unwrap();
        store.insert_edge("a.md", "b.md", "links to b", "b", 0, EdgeKind::Wikilink).unwrap();

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
    fn insert_edge_stores_kind() {
        let store = Store::open_memory().unwrap();
        store.insert_edge("a.md", "b.md", "ctx", "b", 1, EdgeKind::Wikilink).unwrap();
        store.insert_edge("a.md", "smith2024", "ctx", "smith2024", 2, EdgeKind::Citation).unwrap();

        let wikilink_kind: String = store
            .conn
            .query_row("SELECT edge_kind FROM edges WHERE target = 'b.md'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(wikilink_kind, "wikilink");

        let citation_kind: String = store
            .conn
            .query_row("SELECT edge_kind FROM edges WHERE target = 'smith2024'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(citation_kind, "citation");
    }

    #[test]
    fn all_raw_edges_excludes_citation_edges() {
        let store = Store::open_memory().unwrap();
        store.insert_edge("a.md", "b.md", "ctx", "B", 1, EdgeKind::Wikilink).unwrap();
        store.insert_edge("a.md", "smith2024", "[@smith2024]", "smith2024", 2, EdgeKind::Citation).unwrap();

        let raw = store.all_raw_edges().unwrap();
        assert_eq!(raw.len(), 1);
        assert_eq!(raw[0], ("a.md".to_string(), "b.md".to_string(), "B".to_string()));
    }

    #[test]
    fn delete_edges_from_source() {
        let store = Store::open_memory().unwrap();
        store.insert_edge("a.md", "b.md", "", "", 0, EdgeKind::Wikilink).unwrap();
        store.insert_edge("a.md", "c.md", "", "", 0, EdgeKind::Wikilink).unwrap();
        store.insert_edge("x.md", "y.md", "", "", 0, EdgeKind::Wikilink).unwrap();

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
        store.insert_edge("old.md", "old_target.md", "", "", 0, EdgeKind::Wikilink).unwrap();

        let edges = vec![
            ("a.md", "b.md", "link to B", "B", 0, EdgeKind::Wikilink),
            ("a.md", "c.md", "link to C", "C", 0, EdgeKind::Wikilink),
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

    #[test]
    fn all_edges_full_returns_edge_kind() {
        let store = Store::open_memory().unwrap();
        store.insert_edge("a.md", "b.md", "ctx", "b", 1, EdgeKind::Wikilink).unwrap();
        store.insert_edge("a.md", "smith2024", "ctx2", "smith2024", 2, EdgeKind::Citation).unwrap();

        let edges = store.all_edges_full().unwrap();
        assert_eq!(edges.len(), 2);
        assert_eq!(edges[0].5, EdgeKind::Wikilink);
        assert_eq!(edges[1].5, EdgeKind::Citation);
    }

    #[test]
    fn replace_all_edges_stores_kind() {
        let store = Store::open_memory().unwrap();
        let edges = vec![
            ("a.md", "b.md", "c", "b", 1, EdgeKind::Wikilink),
            ("a.md", "smith2024", "c2", "smith2024", 2, EdgeKind::Citation),
        ];
        store.replace_all_edges(&edges).unwrap();

        let citation_kind: String = store
            .conn
            .query_row(
                "SELECT edge_kind FROM edges WHERE target = 'smith2024'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(citation_kind, "citation");

        let wikilink_kind: String = store
            .conn
            .query_row(
                "SELECT edge_kind FROM edges WHERE target = 'b.md'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(wikilink_kind, "wikilink");
    }

    #[test]
    fn replace_all_edges_no_tx_clears_and_inserts() {
        let store = Store::open_memory().unwrap();
        store.insert_edge("old.md", "old_target.md", "", "", 0, EdgeKind::Wikilink).unwrap();

        let edges = vec![
            ("a.md", "b.md", "link to B", "B", 0, EdgeKind::Wikilink),
            ("a.md", "c.md", "link to C", "C", 0, EdgeKind::Wikilink),
        ];
        store.replace_all_edges_no_tx(&edges).unwrap();

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

    #[test]
    fn replace_all_edges_is_atomic() {
        let store = Store::open_memory().unwrap();
        store.insert_edge("keep.md", "keep_target.md", "orig", "kt", 0, EdgeKind::Wikilink).unwrap();

        // Trigger aborts the second inserted edge, after DELETE has already run
        // and the first INSERT succeeded — the wrapper must roll everything back.
        store
            .conn
            .execute_batch(
                "CREATE TRIGGER block_edge BEFORE INSERT ON edges \
                 WHEN NEW.source = 'boom.md' \
                 BEGIN SELECT RAISE(ABORT, 'blocked by test trigger'); END;",
            )
            .unwrap();

        let edges = vec![
            ("ok.md", "x.md", "", "", 0, EdgeKind::Wikilink),
            ("boom.md", "y.md", "", "", 0, EdgeKind::Wikilink),
        ];
        let result = store.replace_all_edges(&edges);
        assert!(result.is_err());

        let keep_count: i64 = store
            .conn
            .query_row(
                "SELECT COUNT(*) FROM edges WHERE source = 'keep.md'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(keep_count, 1, "original edge must survive rollback");

        let partial_count: i64 = store
            .conn
            .query_row(
                "SELECT COUNT(*) FROM edges WHERE source = 'ok.md'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(partial_count, 0, "no partial new edges may remain");

        store.conn.execute_batch("DROP TRIGGER block_edge").unwrap();
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
    fn resolvable_node_ids_excludes_shadows() {
        let store = Store::open_memory().unwrap();
        let node = make_node("a.md", "A", &[], json!({}));
        store.upsert_node(&node, 1).unwrap();
        store.upsert_stub("Ghost").unwrap();
        store.upsert_shadow("bib:smith2024", "Smith 2024", Materialization::Shadow).unwrap();

        let resolvable = store.resolvable_node_ids().unwrap();
        assert_eq!(resolvable, vec!["Ghost", "a.md"], "shadow nodes must be excluded from resolvable IDs");

        let all = store.all_node_ids().unwrap();
        assert_eq!(all, vec!["Ghost", "a.md", "bib:smith2024"], "all_node_ids must still return every node");
    }

    #[test]
    fn resolvable_node_ids_excludes_partial() {
        let store = Store::open_memory().unwrap();
        let node = make_node("a.md", "A", &[], json!({}));
        store.upsert_node(&node, 1).unwrap();
        store.upsert_stub("Ghost").unwrap();
        store.upsert_shadow("bib:jones2023", "Jones 2023", Materialization::Partial).unwrap();

        let resolvable = store.resolvable_node_ids().unwrap();
        assert_eq!(resolvable, vec!["Ghost", "a.md"], "partial nodes must be excluded from resolvable IDs");

        let all = store.all_node_ids().unwrap();
        assert_eq!(all, vec!["Ghost", "a.md", "bib:jones2023"], "all_node_ids must still return every node");
    }

    #[test]
    fn all_edges_returns_source_target_pairs() {
        let store = Store::open_memory().unwrap();
        store.insert_edge("a.md", "b.md", "", "", 0, EdgeKind::Wikilink).unwrap();
        store.insert_edge("c.md", "d.md", "", "", 0, EdgeKind::Wikilink).unwrap();

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
        assert!(meta.contains(&("Ghost".into(), true, Materialization::Stub)));
        assert!(meta.contains(&("a.md".into(), false, Materialization::Materialized)));
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

    #[test]
    fn node_frontmatter_map_returns_frontmatter() {
        let store = Store::open_memory().unwrap();
        store
            .upsert_node(&make_node("a.md", "Alpha", &["tag1"], json!({"title":"Alpha","custom":42})), 1)
            .unwrap();

        let map = store.node_frontmatter_map().unwrap();
        assert_eq!(map.len(), 1);
        assert_eq!(map["a.md"], json!({"title":"Alpha","custom":42}));
    }

    #[test]
    fn node_frontmatter_map_stub_is_empty_object() {
        let store = Store::open_memory().unwrap();
        store.upsert_stub("stub.md").unwrap();

        let map = store.node_frontmatter_map().unwrap();
        assert_eq!(map["stub.md"], json!({}));
    }

    #[test]
    fn node_frontmatter_map_empty_store() {
        let store = Store::open_memory().unwrap();
        assert!(store.node_frontmatter_map().unwrap().is_empty());
    }

    #[test]
    fn all_bundle_node_rows_returns_combined_columns() {
        let store = Store::open_memory().unwrap();
        store
            .upsert_node(
                &make_node("a.md", "Alpha", &["t1"], json!({"title":"Alpha","custom":42})),
                1,
            )
            .unwrap();
        store.upsert_stub("Ghost").unwrap();

        let rows = store.all_bundle_node_rows().unwrap();
        assert_eq!(rows.len(), 2);
        // id-sorted: "Ghost" < "a.md"
        assert_eq!(
            rows[0],
            ("Ghost".to_string(), true, String::new(), json!({}), String::new())
        );
        assert_eq!(rows[1].0, "a.md");
        assert!(!rows[1].1);
        assert_eq!(rows[1].2, "Alpha");
        assert_eq!(rows[1].3, json!({"title":"Alpha","custom":42}));
        assert_eq!(rows[1].4, "First paragraph of Alpha");
    }

    #[test]
    fn all_bundle_node_rows_empty_store() {
        let store = Store::open_memory().unwrap();
        assert!(store.all_bundle_node_rows().unwrap().is_empty());
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
        store.insert_edge("a.md", "b.md", "", "", 0, EdgeKind::Wikilink).unwrap();
        store.insert_edge("a.md", "Ghost", "", "", 0, EdgeKind::Wikilink).unwrap();

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

    // --- wikilink_edge_count ---

    #[test]
    fn wikilink_edge_count_empty_db() {
        let store = Store::open_memory().unwrap();
        assert_eq!(store.wikilink_edge_count().unwrap(), 0);
    }

    #[test]
    fn wikilink_edge_count_excludes_citations() {
        let store = Store::open_memory().unwrap();
        let a = make_node("a.md", "A", &[], json!({}));
        store.upsert_node(&a, 1).unwrap();
        let b = make_node("b.md", "B", &[], json!({}));
        store.upsert_node(&b, 1).unwrap();
        store.insert_edge("a.md", "b.md", "", "", 0, EdgeKind::Wikilink).unwrap();
        store.insert_edge("a.md", "smith2024", "[@smith2024]", "smith2024", 2, EdgeKind::Citation).unwrap();

        assert_eq!(store.wikilink_edge_count().unwrap(), 1);
        assert_eq!(store.stats().unwrap().edges, 2);
    }

    #[test]
    fn graph_fingerprint_stable_when_citation_added() {
        let store = Store::open_memory().unwrap();
        let a = make_node("a.md", "A", &[], json!({}));
        store.upsert_node(&a, 1).unwrap();
        let b = make_node("b.md", "B", &[], json!({}));
        store.upsert_node(&b, 1).unwrap();
        store.insert_edge("a.md", "b.md", "", "", 0, EdgeKind::Wikilink).unwrap();

        let fp1 = store.graph_fingerprint().unwrap();
        store.insert_edge("a.md", "smith2024", "[@smith2024]", "smith2024", 2, EdgeKind::Citation).unwrap();
        let fp2 = store.graph_fingerprint().unwrap();

        assert_eq!(fp1, fp2, "adding a citation edge must not change the pagerank fingerprint");
    }

    #[test]
    fn graph_fingerprint_changes_when_wikilink_added() {
        let store = Store::open_memory().unwrap();
        let a = make_node("a.md", "A", &[], json!({}));
        store.upsert_node(&a, 1).unwrap();

        let fp1 = store.graph_fingerprint().unwrap();

        let b = make_node("b.md", "B", &[], json!({}));
        store.upsert_node(&b, 1).unwrap();
        store.insert_edge("a.md", "b.md", "", "", 0, EdgeKind::Wikilink).unwrap();

        let fp2 = store.graph_fingerprint().unwrap();
        assert_ne!(fp1, fp2, "adding a wikilink edge must change the fingerprint");
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
        store.insert_edge("a.md", "b.md", "ctx", "B", 0, EdgeKind::Wikilink).unwrap();
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
        store.insert_edge("a.md", "b.md", "links to b", "b", 5, EdgeKind::Wikilink).unwrap();

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
        store.insert_edge("a.md", "c.md", "from a", "c", 1, EdgeKind::Wikilink).unwrap();
        store.insert_edge("b.md", "c.md", "from b", "c", 3, EdgeKind::Wikilink).unwrap();

        let bl = store.backlinks("c.md").unwrap();
        assert_eq!(bl.len(), 2);
        assert_eq!(bl[0].source_id, "a.md");
        assert_eq!(bl[0].source_line, 1);
        assert_eq!(bl[1].source_id, "b.md");
        assert_eq!(bl[1].source_line, 3);
    }

    // --- Citing pages ---

    #[test]
    fn citing_pages_returns_only_citation_edges() {
        let store = Store::open_memory().unwrap();
        let a = make_node("a.md", "Alpha", &[], json!({}));
        let b = make_node("b.md", "Beta", &[], json!({}));
        store.upsert_node(&a, 1).unwrap();
        store.upsert_node(&b, 1).unwrap();
        store.insert_edge("a.md", "smith2024", "as shown [@smith2024]", "smith2024", 7, EdgeKind::Citation).unwrap();
        // Decoy wikilink edge to the same target must not appear.
        store.insert_edge("b.md", "smith2024", "noise", "smith2024", 2, EdgeKind::Wikilink).unwrap();

        let citing = store.citing_pages("smith2024").unwrap();
        assert_eq!(citing.len(), 1);
        assert_eq!(citing[0].source_id, "a.md");
        assert_eq!(citing[0].source_title, "Alpha");
        assert_eq!(citing[0].context, "as shown [@smith2024]");
        assert_eq!(citing[0].source_line, 7);
    }

    #[test]
    fn citing_pages_orders_by_source_and_requires_known_node() {
        let store = Store::open_memory().unwrap();
        let a = make_node("a.md", "Alpha", &[], json!({}));
        let b = make_node("b.md", "Beta", &[], json!({}));
        store.upsert_node(&a, 1).unwrap();
        store.upsert_node(&b, 1).unwrap();
        store.insert_edge("b.md", "doe2020", "cite b", "doe2020", 3, EdgeKind::Citation).unwrap();
        store.insert_edge("a.md", "doe2020", "cite a", "doe2020", 1, EdgeKind::Citation).unwrap();
        // Orphan source with no nodes row is dropped by the JOIN.
        store.insert_edge("ghost.md", "doe2020", "cite ghost", "doe2020", 9, EdgeKind::Citation).unwrap();

        let citing = store.citing_pages("doe2020").unwrap();
        assert_eq!(citing.len(), 2);
        assert_eq!(citing[0].source_id, "a.md");
        assert_eq!(citing[1].source_id, "b.md");

        assert!(store.citing_pages("nope").unwrap().is_empty());
    }

    // --- Forward links ---

    #[test]
    fn forward_links_returns_targets_from_page() {
        let store = Store::open_memory().unwrap();
        let a = make_node("a.md", "Alpha", &[], json!({}));
        let b = make_node("b.md", "Beta", &[], json!({}));
        store.upsert_node(&a, 1).unwrap();
        store.upsert_node(&b, 1).unwrap();
        store.insert_edge("a.md", "b.md", "links to b", "B", 0, EdgeKind::Wikilink).unwrap();

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
        store.insert_edge("a.md", "b.md", "to b", "B", 0, EdgeKind::Wikilink).unwrap();
        store.insert_edge("a.md", "c.md", "to c", "C", 0, EdgeKind::Wikilink).unwrap();

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
        store.insert_edge("a.md", "Ghost", "to ghost", "Ghost", 0, EdgeKind::Wikilink).unwrap();

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
        assert_eq!(store.schema_version().unwrap(), CURRENT_SCHEMA_VERSION);

        let tags_text: String = store
            .conn
            .query_row("SELECT tags_text FROM nodes WHERE id = 'a.md'", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert!(!tags_text.is_empty(), "tags_text should be backfilled");

        // v3 column should exist
        store.insert_edge("a.md", "b.md", "ctx", "b", 0, EdgeKind::Wikilink).unwrap();
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
        assert_eq!(store.schema_version().unwrap(), CURRENT_SCHEMA_VERSION);

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
        assert_eq!(store.schema_version().unwrap(), CURRENT_SCHEMA_VERSION);

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
        store.insert_edge("a.md", "target.md", "", "", 0, EdgeKind::Wikilink).unwrap();
        store.insert_edge("b.md", "target.md", "", "", 0, EdgeKind::Wikilink).unwrap();
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
    fn search_titles_excludes_stubs() {
        let store = Store::open_memory().unwrap();
        let node = make_node("agentic-design.md", "Agentic Design", &[], json!({}));
        store.upsert_node(&node, 1).unwrap();
        store.upsert_stub("agentic-workflows").unwrap();
        let results = store.search_titles("agentic", 10).unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].0, "agentic-design.md");
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

    #[test]
    fn edge_kind_column_exists() {
        let store = Store::open_memory().unwrap();
        let has_column: bool = store
            .conn
            .prepare("SELECT edge_kind FROM edges LIMIT 0")
            .is_ok();
        assert!(has_column, "edges table should have edge_kind column");
    }

    // --- Cycle 2: Schema v6 ---

    #[test]
    fn schema_version_is_seventeen() {
        assert_eq!(CURRENT_SCHEMA_VERSION, 17);
    }

    #[test]
    fn migration_v11_adds_uuid() {
        let store = Store::open_memory().unwrap();

        let has_uuid: bool = store.conn
            .prepare("SELECT uuid FROM annotations LIMIT 0")
            .is_ok();
        assert!(has_uuid, "annotations table should have uuid column");
    }

    #[test]
    fn migration_v14_drops_conversation_tables_on_fresh_db() {
        let store = Store::open_memory().unwrap();
        assert_eq!(store.schema_version().unwrap(), CURRENT_SCHEMA_VERSION);
        for table in &["conversations", "conversation_messages"] {
            let count: i64 = store.conn.query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?1",
                [table],
                |r| r.get(0),
            ).unwrap();
            assert_eq!(count, 0, "table {table} should not exist after v14 migration");
        }
    }

    #[test]
    fn v13_to_v14_migration_drops_conversations_and_data() {
        let dir = tempfile::tempdir().unwrap();
        let db_path = dir.path().join("test.db");

        {
            let conn = Connection::open(&db_path).unwrap();
            conn.execute_batch("PRAGMA journal_mode=WAL;").unwrap();
            conn.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
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
                CREATE TABLE annotations (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    node_id TEXT NOT NULL, annotation_type TEXT NOT NULL,
                    certainty TEXT NOT NULL, body TEXT, date TEXT,
                    source_line INTEGER NOT NULL, char_start INTEGER NOT NULL, char_end INTEGER NOT NULL,
                    scope_kind TEXT NOT NULL, scope_value TEXT NOT NULL,
                    uuid TEXT NOT NULL
                );
                CREATE INDEX idx_annotations_node_id ON annotations(node_id);
                CREATE INDEX idx_annotations_type ON annotations(annotation_type);
                CREATE VIRTUAL TABLE annotations_fts USING fts5(
                    body, node_id UNINDEXED, annotation_type UNINDEXED,
                    tokenize = 'trigram case_sensitive 0'
                );
                CREATE TABLE node_positions (
                    node_id TEXT PRIMARY KEY, x REAL NOT NULL, y REAL NOT NULL
                );
                CREATE TABLE conversations (
                    id TEXT PRIMARY KEY,
                    node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
                    anchor_type TEXT,
                    anchor_id INTEGER,
                    anchor_key TEXT,
                    title TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                CREATE INDEX idx_conversations_node_id ON conversations(node_id);
                CREATE UNIQUE INDEX idx_conversations_anchor ON conversations(node_id, anchor_type, anchor_key);
                CREATE TABLE conversation_messages (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
                    role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
                    content TEXT NOT NULL,
                    seq INTEGER NOT NULL,
                    created_at TEXT NOT NULL
                );
                CREATE INDEX idx_conv_messages_conv_id ON conversation_messages(conversation_id);
                INSERT INTO meta(key, value) VALUES ('schema_version', '13');
                INSERT INTO nodes(id, title, first_paragraph, frontmatter, mtime, is_stub)
                    VALUES ('a.md', 'Alpha', 'p1', '{}', 1, 0);
                INSERT INTO conversations(id, node_id, anchor_type, anchor_id, anchor_key, title, created_at, updated_at)
                    VALUES ('conv-1', 'a.md', NULL, NULL, NULL, 'Chat', '2025-01-01', '2025-01-01');
                INSERT INTO conversation_messages(conversation_id, role, content, seq, created_at)
                    VALUES ('conv-1', 'user', 'Hello', 0, '2025-01-01');",
            ).unwrap();
        }

        let store = Store::open(&db_path).unwrap();

        // schema upgraded to the current version (migrations run all the way through)
        assert_eq!(store.schema_version().unwrap(), CURRENT_SCHEMA_VERSION);

        // both conversation tables are gone
        for table in &["conversations", "conversation_messages"] {
            let count: i64 = store.conn.query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?1",
                [table],
                |r| r.get(0),
            ).unwrap();
            assert_eq!(count, 0, "table {table} should be dropped by v14 migration");
        }

        // querying the dropped tables now errors
        assert!(
            store.conn.query_row("SELECT COUNT(*) FROM conversations", [], |r| r.get::<_, i64>(0)).is_err(),
            "conversations table should no longer be queryable"
        );

        // unrelated data (node) survives
        let title: String = store.conn
            .query_row("SELECT title FROM nodes WHERE id = 'a.md'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(title, "Alpha");
    }

    #[test]
    fn v14_to_v15_migration_preserves_existing_edges_as_wikilink() {
        let dir = tempfile::tempdir().unwrap();
        let db_path = dir.path().join("test.db");

        {
            let conn = Connection::open(&db_path).unwrap();
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
                INSERT INTO meta(key, value) VALUES ('schema_version', '14');
                INSERT INTO edges(source, target, context, raw_target, source_line) VALUES ('a.md', 'b.md', 'ctx1', 'b', 3);
                INSERT INTO edges(source, target, context, raw_target, source_line) VALUES ('c.md', 'b.md', 'ctx2', 'b', 7);",
            ).unwrap();
        }

        let store = Store::open(&db_path).unwrap();

        assert_eq!(store.schema_version().unwrap(), CURRENT_SCHEMA_VERSION);

        // both pre-existing edges survive and are backfilled to 'wikilink'
        let count: i64 = store.conn
            .query_row("SELECT COUNT(*) FROM edges WHERE edge_kind = 'wikilink'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 2);

        // index exists
        let idx: i64 = store.conn
            .query_row("SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND name='idx_edges_kind'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(idx, 1);
    }

    #[test]
    fn v14_to_v15_migration_resets_sync_mtimes() {
        let dir = tempfile::tempdir().unwrap();
        let db_path = dir.path().join("test.db");

        {
            let conn = Connection::open(&db_path).unwrap();
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
                INSERT INTO meta(key, value) VALUES ('schema_version', '14');
                INSERT INTO sync(path, mtime) VALUES ('notes/a.md', 1700000000);
                INSERT INTO sync(path, mtime) VALUES ('notes/b.md', 1700000001);
                INSERT INTO sync(path, mtime) VALUES ('notes/c.md', 1700000002);",
            ).unwrap();
        }

        let store = Store::open(&db_path).unwrap();

        assert_eq!(store.schema_version().unwrap(), CURRENT_SCHEMA_VERSION);

        let max_mtime: i64 = store.conn
            .query_row("SELECT MAX(mtime) FROM sync", [], |r| r.get(0))
            .unwrap();
        assert_eq!(max_mtime, 0, "all sync mtimes should be reset to 0 after v15 migration");

        let count: i64 = store.conn
            .query_row("SELECT COUNT(*) FROM sync", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 3, "sync rows should be preserved, only mtimes reset");
    }

    #[test]
    fn migration_v11_backfills_existing_annotation_uuids() {
        let store = Store::open_memory().unwrap();
        let node = make_node("a.md", "A", &[], json!({}));
        store.upsert_node(&node, 1).unwrap();
        store.upsert_annotations("a.md", &[make_annotation("note", Some("hello"))]).unwrap();

        let uuid: String = store.conn.query_row(
            "SELECT uuid FROM annotations WHERE node_id = 'a.md' LIMIT 1",
            [],
            |r| r.get(0),
        ).unwrap();
        assert_eq!(uuid.len(), 36, "uuid should be 36-char hyphenated v4 format");
        assert_eq!(&uuid[14..15], "4", "uuid version nibble should be 4");
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
        assert_eq!(store.schema_version().unwrap(), CURRENT_SCHEMA_VERSION);
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
            uuid: None,
        }
    }

    #[test]
    fn upsert_annotations_generates_v4_uuid() {
        let store = Store::open_memory().unwrap();
        let node = make_node("a.md", "A", &[], json!({}));
        store.upsert_node(&node, 1).unwrap();

        store.upsert_annotations("a.md", &[make_annotation("note", Some("hello"))]).unwrap();

        let uuid: String = store.conn.query_row(
            "SELECT uuid FROM annotations WHERE node_id = 'a.md'", [], |r| r.get(0),
        ).unwrap();
        assert_eq!(uuid.len(), 36, "uuid should be 36-char hyphenated v4 format");
        assert_eq!(&uuid[14..15], "4", "uuid version nibble should be 4");
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

    // --- Cycle 1.2: incremental upsert_annotations ---

    #[test]
    fn upsert_annotations_preserves_uuid_on_body_match() {
        let store = Store::open_memory().unwrap();
        let node = make_node("a.md", "A", &[], json!({}));
        store.upsert_node(&node, 1).unwrap();

        let anns = vec![super::IndexableAnnotation {
            char_start: 0,
            ..make_annotation("note", Some("important note"))
        }];
        store.upsert_annotations("a.md", &anns).unwrap();

        let uuid1: String = store.conn.query_row(
            "SELECT uuid FROM annotations WHERE node_id = 'a.md'", [], |r| r.get(0),
        ).unwrap();

        let anns2 = vec![super::IndexableAnnotation {
            char_start: 50,
            source_line: 5,
            ..make_annotation("note", Some("important note"))
        }];
        store.upsert_annotations("a.md", &anns2).unwrap();

        let (uuid2, char_start): (String, i64) = store.conn.query_row(
            "SELECT uuid, char_start FROM annotations WHERE node_id = 'a.md'", [], |r| Ok((r.get(0)?, r.get(1)?)),
        ).unwrap();
        let count: i64 = store.conn.query_row(
            "SELECT COUNT(*) FROM annotations WHERE node_id = 'a.md'", [], |r| r.get(0),
        ).unwrap();

        assert_eq!(uuid2, uuid1);
        assert_eq!(char_start, 50);
        assert_eq!(count, 1);
    }

    #[test]
    fn upsert_annotations_assigns_new_uuid_on_new_annotation() {
        let store = Store::open_memory().unwrap();
        let node = make_node("a.md", "A", &[], json!({}));
        store.upsert_node(&node, 1).unwrap();

        let anns = vec![make_annotation("note", Some("first"))];
        store.upsert_annotations("a.md", &anns).unwrap();

        let uuid1: String = store.conn.query_row(
            "SELECT uuid FROM annotations WHERE node_id = 'a.md'", [], |r| r.get(0),
        ).unwrap();

        let anns2 = vec![
            make_annotation("note", Some("first")),
            make_annotation("question", Some("new q")),
        ];
        store.upsert_annotations("a.md", &anns2).unwrap();

        let count: i64 = store.conn.query_row(
            "SELECT COUNT(*) FROM annotations WHERE node_id = 'a.md'", [], |r| r.get(0),
        ).unwrap();
        let fts_count: i64 = store.conn.query_row(
            "SELECT COUNT(*) FROM annotations_fts WHERE node_id = 'a.md'", [], |r| r.get(0),
        ).unwrap();

        let mut stmt = store.conn.prepare(
            "SELECT uuid, annotation_type FROM annotations WHERE node_id = 'a.md' ORDER BY annotation_type",
        ).unwrap();
        let rows: Vec<(String, String)> = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap().filter_map(|r| r.ok()).collect();

        assert_eq!(count, 2);
        assert_eq!(fts_count, 2);
        assert_eq!(rows[0].1, "note");
        assert_eq!(rows[0].0, uuid1);
        assert_eq!(rows[1].1, "question");
        assert!(!rows[1].0.is_empty());
        assert_ne!(rows[1].0, uuid1);
    }

    #[test]
    fn upsert_annotations_deletes_removed_annotations() {
        let store = Store::open_memory().unwrap();
        let node = make_node("a.md", "A", &[], json!({}));
        store.upsert_node(&node, 1).unwrap();

        let anns = vec![
            make_annotation("note", Some("keep")),
            make_annotation("question", Some("remove")),
        ];
        store.upsert_annotations("a.md", &anns).unwrap();

        let keep_uuid: String = store.conn.query_row(
            "SELECT uuid FROM annotations WHERE node_id = 'a.md' AND body = 'keep'", [], |r| r.get(0),
        ).unwrap();

        let anns2 = vec![make_annotation("note", Some("keep"))];
        store.upsert_annotations("a.md", &anns2).unwrap();

        let count: i64 = store.conn.query_row(
            "SELECT COUNT(*) FROM annotations WHERE node_id = 'a.md'", [], |r| r.get(0),
        ).unwrap();
        let fts_count: i64 = store.conn.query_row(
            "SELECT COUNT(*) FROM annotations_fts WHERE node_id = 'a.md'", [], |r| r.get(0),
        ).unwrap();
        let surviving_uuid: String = store.conn.query_row(
            "SELECT uuid FROM annotations WHERE node_id = 'a.md'", [], |r| r.get(0),
        ).unwrap();

        assert_eq!(count, 1);
        assert_eq!(fts_count, 1);
        assert_eq!(surviving_uuid, keep_uuid);
    }

    #[test]
    fn upsert_annotations_returns_deleted_uuids() {
        let store = Store::open_memory().unwrap();
        let node = make_node("a.md", "A", &[], json!({}));
        store.upsert_node(&node, 1).unwrap();

        let anns = vec![
            make_annotation("note", Some("keep")),
            make_annotation("question", Some("remove-1")),
            make_annotation("question", Some("remove-2")),
        ];
        store.upsert_annotations("a.md", &anns).unwrap();

        let remove1_uuid: String = store.conn.query_row(
            "SELECT uuid FROM annotations WHERE node_id = 'a.md' AND body = 'remove-1'", [], |r| r.get(0),
        ).unwrap();
        let remove2_uuid: String = store.conn.query_row(
            "SELECT uuid FROM annotations WHERE node_id = 'a.md' AND body = 'remove-2'", [], |r| r.get(0),
        ).unwrap();

        let anns2 = vec![make_annotation("note", Some("keep"))];
        let deleted_uuids = store.upsert_annotations("a.md", &anns2).unwrap();

        assert_eq!(deleted_uuids.len(), 2);
        assert!(deleted_uuids.contains(&remove1_uuid));
        assert!(deleted_uuids.contains(&remove2_uuid));
    }

    #[test]
    fn upsert_annotations_returns_empty_when_no_deletions() {
        let store = Store::open_memory().unwrap();
        let node = make_node("a.md", "A", &[], json!({}));
        store.upsert_node(&node, 1).unwrap();

        let anns = vec![make_annotation("note", Some("stay"))];
        let deleted = store.upsert_annotations("a.md", &anns).unwrap();
        assert!(deleted.is_empty());

        let anns2 = vec![make_annotation("note", Some("stay"))];
        let deleted2 = store.upsert_annotations("a.md", &anns2).unwrap();
        assert!(deleted2.is_empty());
    }

    #[test]
    fn upsert_annotations_handles_duplicate_type_body() {
        let store = Store::open_memory().unwrap();
        let node = make_node("a.md", "A", &[], json!({}));
        store.upsert_node(&node, 1).unwrap();

        let anns = vec![
            super::IndexableAnnotation { char_start: 10, ..make_annotation("note", Some("recurring")) },
            super::IndexableAnnotation { char_start: 100, ..make_annotation("note", Some("recurring")) },
        ];
        store.upsert_annotations("a.md", &anns).unwrap();

        let mut stmt = store.conn.prepare(
            "SELECT uuid, char_start FROM annotations WHERE node_id = 'a.md' ORDER BY char_start",
        ).unwrap();
        let old_rows: Vec<(String, i64)> = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap().filter_map(|r| r.ok()).collect();
        assert_eq!(old_rows.len(), 2);

        let anns2 = vec![
            super::IndexableAnnotation { char_start: 15, ..make_annotation("note", Some("recurring")) },
            super::IndexableAnnotation { char_start: 105, ..make_annotation("note", Some("recurring")) },
        ];
        store.upsert_annotations("a.md", &anns2).unwrap();

        let mut stmt2 = store.conn.prepare(
            "SELECT uuid, char_start FROM annotations WHERE node_id = 'a.md' ORDER BY char_start",
        ).unwrap();
        let new_rows: Vec<(String, i64)> = stmt2.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap().filter_map(|r| r.ok()).collect();
        assert_eq!(new_rows.len(), 2);

        assert_eq!(new_rows[0].1, 15);
        assert_eq!(new_rows[0].0, old_rows[0].0);
        assert_eq!(new_rows[1].1, 105);
        assert_eq!(new_rows[1].0, old_rows[1].0);
    }

    #[test]
    fn upsert_annotations_fts_rowids_stable_on_update_only() {
        let store = Store::open_memory().unwrap();
        let node = make_node("a.md", "A", &[], json!({}));
        store.upsert_node(&node, 1).unwrap();

        // Insert two annotations with bodies
        let anns = vec![
            super::IndexableAnnotation { char_start: 10, ..make_annotation("note", Some("alpha body")) },
            super::IndexableAnnotation { char_start: 50, ..make_annotation("note", Some("beta body")) },
        ];
        store.upsert_annotations("a.md", &anns).unwrap();

        // Capture FTS rowids
        let rowids_before: Vec<i64> = store.conn
            .prepare("SELECT rowid FROM annotations_fts WHERE node_id = 'a.md' ORDER BY rowid")
            .unwrap()
            .query_map([], |r| r.get(0))
            .unwrap()
            .filter_map(|r| r.ok())
            .collect();
        assert_eq!(rowids_before.len(), 2);

        // Re-upsert the SAME annotations with shifted char_start (update-only diff)
        let anns2 = vec![
            super::IndexableAnnotation { char_start: 15, ..make_annotation("note", Some("alpha body")) },
            super::IndexableAnnotation { char_start: 55, ..make_annotation("note", Some("beta body")) },
        ];
        store.upsert_annotations("a.md", &anns2).unwrap();

        // Capture FTS rowids again
        let rowids_after: Vec<i64> = store.conn
            .prepare("SELECT rowid FROM annotations_fts WHERE node_id = 'a.md' ORDER BY rowid")
            .unwrap()
            .query_map([], |r| r.get(0))
            .unwrap()
            .filter_map(|r| r.ok())
            .collect();

        // Rowids must be identical — no delete+re-insert churn
        assert_eq!(rowids_before, rowids_after);
    }

    // --- match_annotations: greedy position-sorted pairing ---

    #[test]
    fn match_annotations_no_uuid_swap_on_position_shift() {
        // Regression test: two annotations share (type, body). User inserts text
        // moving the first from pos 10 to pos 190. Without sorted iteration the
        // greedy matcher assigns incoming@190 to existing@200 (dist 10) stealing
        // that UUID, then incoming@200 falls back to existing@10 — a UUID swap.
        let existing = vec![
            super::ExistingAnnotation {
                id: 1, annotation_type: "note".into(), body: Some("TODO".into()),
                char_start: 10, uuid: "uuid-A".into(),
            },
            super::ExistingAnnotation {
                id: 2, annotation_type: "note".into(), body: Some("TODO".into()),
                char_start: 200, uuid: "uuid-B".into(),
            },
        ];
        let incoming = vec![
            super::IndexableAnnotation { char_start: 190, ..make_annotation("note", Some("TODO")) },
            super::IndexableAnnotation { char_start: 200, ..make_annotation("note", Some("TODO")) },
        ];

        let diff = super::match_annotations(&existing, &incoming);

        // Build a map: incoming_idx → matched existing_idx
        let map: std::collections::HashMap<usize, usize> =
            diff.updates.iter().copied().collect();

        // incoming[0] (pos 190) should match existing[0] (pos 10, uuid-A)
        // incoming[1] (pos 200) should match existing[1] (pos 200, uuid-B)
        assert_eq!(map[&0], 0, "incoming@190 must match existing@10 (uuid-A), not existing@200");
        assert_eq!(map[&1], 1, "incoming@200 must match existing@200 (uuid-B)");
        assert!(diff.inserts.is_empty());
        assert!(diff.deletes.is_empty());
    }

    #[test]
    fn match_annotations_three_same_key_preserves_order() {
        // Three annotations with the same (type, body), positions shift slightly.
        // Ordinal pairing must hold: first→first, second→second, third→third.
        let existing = vec![
            super::ExistingAnnotation {
                id: 1, annotation_type: "note".into(), body: Some("x".into()),
                char_start: 10, uuid: "u1".into(),
            },
            super::ExistingAnnotation {
                id: 2, annotation_type: "note".into(), body: Some("x".into()),
                char_start: 100, uuid: "u2".into(),
            },
            super::ExistingAnnotation {
                id: 3, annotation_type: "note".into(), body: Some("x".into()),
                char_start: 300, uuid: "u3".into(),
            },
        ];
        let incoming = vec![
            super::IndexableAnnotation { char_start: 15, ..make_annotation("note", Some("x")) },
            super::IndexableAnnotation { char_start: 110, ..make_annotation("note", Some("x")) },
            super::IndexableAnnotation { char_start: 290, ..make_annotation("note", Some("x")) },
        ];

        let diff = super::match_annotations(&existing, &incoming);

        let map: std::collections::HashMap<usize, usize> =
            diff.updates.iter().copied().collect();

        assert_eq!(map[&0], 0, "first incoming must pair with first existing");
        assert_eq!(map[&1], 1, "second incoming must pair with second existing");
        assert_eq!(map[&2], 2, "third incoming must pair with third existing");
        assert!(diff.inserts.is_empty());
        assert!(diff.deletes.is_empty());
    }

    #[test]
    fn upsert_annotations_no_uuid_swap_on_large_shift() {
        // Integration test through upsert_annotations: two TODO annotations,
        // first one shifts dramatically. UUIDs must stay with their original
        // ordinal annotation.
        let store = Store::open_memory().unwrap();
        let node = make_node("a.md", "A", &[], json!({}));
        store.upsert_node(&node, 1).unwrap();

        let anns = vec![
            super::IndexableAnnotation { char_start: 10, ..make_annotation("note", Some("TODO")) },
            super::IndexableAnnotation { char_start: 200, ..make_annotation("note", Some("TODO")) },
        ];
        store.upsert_annotations("a.md", &anns).unwrap();

        let mut stmt = store.conn.prepare(
            "SELECT uuid, char_start FROM annotations WHERE node_id = 'a.md' ORDER BY char_start",
        ).unwrap();
        let old_rows: Vec<(String, i64)> = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap().filter_map(|r| r.ok()).collect();
        assert_eq!(old_rows.len(), 2);
        let (uuid_a, uuid_b) = (old_rows[0].0.clone(), old_rows[1].0.clone());

        // Shift first annotation from 10 → 190 (close to the second at 200).
        let anns2 = vec![
            super::IndexableAnnotation { char_start: 190, ..make_annotation("note", Some("TODO")) },
            super::IndexableAnnotation { char_start: 200, ..make_annotation("note", Some("TODO")) },
        ];
        store.upsert_annotations("a.md", &anns2).unwrap();

        let mut stmt2 = store.conn.prepare(
            "SELECT uuid, char_start FROM annotations WHERE node_id = 'a.md' ORDER BY char_start",
        ).unwrap();
        let new_rows: Vec<(String, i64)> = stmt2.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap().filter_map(|r| r.ok()).collect();
        assert_eq!(new_rows.len(), 2);

        // uuid-A (originally at 10) should now be at 190
        assert_eq!(new_rows[0].0, uuid_a, "uuid-A must follow its annotation to pos 190");
        assert_eq!(new_rows[0].1, 190);
        // uuid-B (originally at 200) should stay at 200
        assert_eq!(new_rows[1].0, uuid_b, "uuid-B must remain at pos 200");
        assert_eq!(new_rows[1].1, 200);
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
            uuid: None,
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

    #[test]
    fn search_annotations_returns_results_ordered_by_relevance() {
        let store = Store::open_memory().unwrap();
        let node = make_node("a.md", "Alpha", &[], json!({}));
        store.upsert_node(&node, 1).unwrap();

        let ann_a = super::IndexableAnnotation {
            body: Some("The trade agreement was signed alongside many other economic policies and regulations that affect imports".into()),
            ..make_annotation("note", None)
        };
        let ann_b = super::IndexableAnnotation {
            body: Some("Trade trade trade: this is all about trade and trade policy and trade agreements".into()),
            ..make_annotation("note", None)
        };
        let ann_c = super::IndexableAnnotation {
            body: Some("A short note on trade".into()),
            ..make_annotation("note", None)
        };

        store.upsert_annotations("a.md", &[ann_a, ann_b, ann_c]).unwrap();

        let results = store.search_annotations("trade", None, 10).unwrap();
        assert_eq!(results.len(), 3);
        // BM25 rank: ann_b (most mentions) should be first
        assert_eq!(results[0].body.as_deref(), Some("Trade trade trade: this is all about trade and trade policy and trade agreements"));
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

        let results = store.list_annotations(Some("a.md"), None, 100).unwrap();
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

        let results = store.list_annotations(Some("a.md"), Some("note"), 100).unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].annotation_type, "note");
    }

    #[test]
    fn list_annotations_empty_for_nonexistent() {
        let store = Store::open_memory().unwrap();
        let results = store.list_annotations(Some("unknown.md"), None, 100).unwrap();
        assert!(results.is_empty());
    }

    #[test]
    fn list_annotations_vault_wide() {
        let store = Store::open_memory().unwrap();
        let node_a = make_node("a.md", "Alpha", &[], json!({}));
        let node_b = make_node("b.md", "Beta", &[], json!({}));
        store.upsert_node(&node_a, 1).unwrap();
        store.upsert_node(&node_b, 1).unwrap();

        let mut ann1 = make_annotation("note", Some("first"));
        ann1.source_line = 1;
        let mut ann2 = make_annotation("question", Some("second"));
        ann2.source_line = 5;
        store.upsert_annotations("a.md", &[ann1, ann2]).unwrap();

        let mut ann3 = make_annotation("note", Some("third"));
        ann3.source_line = 2;
        store.upsert_annotations("b.md", &[ann3]).unwrap();

        let results = store.list_annotations(None, None, 100).unwrap();
        assert_eq!(results.len(), 3);
        assert_eq!(results[0].node_id, "a.md");
        assert_eq!(results[1].node_id, "a.md");
        assert_eq!(results[2].node_id, "b.md");
    }

    #[test]
    fn list_annotations_vault_wide_with_type_filter() {
        let store = Store::open_memory().unwrap();
        let node_a = make_node("a.md", "Alpha", &[], json!({}));
        let node_b = make_node("b.md", "Beta", &[], json!({}));
        store.upsert_node(&node_a, 1).unwrap();
        store.upsert_node(&node_b, 1).unwrap();

        let ann1 = make_annotation("note", Some("a note"));
        let ann2 = make_annotation("question", Some("a question"));
        store.upsert_annotations("a.md", &[ann1, ann2]).unwrap();

        let ann3 = make_annotation("note", Some("b note"));
        store.upsert_annotations("b.md", &[ann3]).unwrap();

        let results = store.list_annotations(None, Some("note"), 100).unwrap();
        assert_eq!(results.len(), 2);
        assert!(results.iter().all(|r| r.annotation_type == "note"));
        assert_eq!(results[0].node_id, "a.md");
        assert_eq!(results[1].node_id, "b.md");
    }

    #[test]
    fn all_annotations_full_returns_scope_fields() {
        let store = Store::open_memory().unwrap();
        store.upsert_node(&make_node("a.md", "Alpha", &[], json!({})), 1).unwrap();

        let mut ann = make_annotation("note", Some("hello"));
        ann.scope_kind = "words".into();
        ann.scope_value = "3".into();
        store.upsert_annotations("a.md", &[ann]).unwrap();

        let recs = store.all_annotations_full().unwrap();
        assert_eq!(recs.len(), 1);
        assert_eq!(recs[0].node_id, "a.md");
        assert_eq!(recs[0].annotation_type, "note");
        assert_eq!(recs[0].scope_kind, "words");
        assert_eq!(recs[0].scope_value, "3");
        assert_eq!(recs[0].body, Some("hello".into()));
        assert!(!recs[0].uuid.is_empty());
    }

    #[test]
    fn all_annotations_full_empty_store() {
        let store = Store::open_memory().unwrap();
        assert!(store.all_annotations_full().unwrap().is_empty());
    }

    #[test]
    fn all_annotations_full_orders_by_node_then_charstart() {
        let store = Store::open_memory().unwrap();
        store.upsert_node(&make_node("b.md", "Beta", &[], json!({})), 1).unwrap();
        store.upsert_node(&make_node("a.md", "Alpha", &[], json!({})), 1).unwrap();

        let ann_a1 = super::IndexableAnnotation { char_start: 30, ..make_annotation("note", Some("x")) };
        let ann_a2 = super::IndexableAnnotation { char_start: 10, ..make_annotation("question", Some("y")) };
        store.upsert_annotations("a.md", &[ann_a1, ann_a2]).unwrap();

        let ann_b = make_annotation("note", Some("z"));
        store.upsert_annotations("b.md", &[ann_b]).unwrap();

        let recs = store.all_annotations_full().unwrap();
        assert_eq!(recs.len(), 3);
        assert_eq!(recs[0].node_id, "a.md");
        assert_eq!(recs[0].char_start, 10);
        assert_eq!(recs[1].node_id, "a.md");
        assert_eq!(recs[1].char_start, 30);
        assert_eq!(recs[2].node_id, "b.md");
    }

    // --- Multilingual (trigram) annotation search ---

    #[test]
    fn search_annotations_finds_cjk_body() {
        let store = Store::open_memory().unwrap();
        let node = make_node("a.md", "Alpha", &[], json!({}));
        store.upsert_node(&node, 1).unwrap();

        let ann = super::IndexableAnnotation {
            body: Some("丝绸之路是古代贸易通道".into()),
            ..make_annotation("note", None)
        };
        store.upsert_annotations("a.md", &[ann]).unwrap();

        let results = store.search_annotations("丝绸之路", None, 10).unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].node_id, "a.md");
    }

    #[test]
    fn search_annotations_finds_short_cjk_query() {
        let store = Store::open_memory().unwrap();
        let node = make_node("a.md", "Alpha", &[], json!({}));
        store.upsert_node(&node, 1).unwrap();

        let ann = super::IndexableAnnotation {
            body: Some("丝绸之路是古代贸易通道".into()),
            ..make_annotation("note", None)
        };
        store.upsert_annotations("a.md", &[ann]).unwrap();

        let results = store.search_annotations("丝绸", None, 10).unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].node_id, "a.md");
    }

    #[test]
    fn search_annotations_finds_devanagari_body() {
        let store = Store::open_memory().unwrap();
        let node = make_node("a.md", "Alpha", &[], json!({}));
        store.upsert_node(&node, 1).unwrap();

        let ann = super::IndexableAnnotation {
            body: Some("यह एक टिप्पणी है".into()),
            ..make_annotation("note", None)
        };
        store.upsert_annotations("a.md", &[ann]).unwrap();

        let results = store.search_annotations("टिप्पणी", None, 10).unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].node_id, "a.md");
    }

    #[test]
    fn search_annotations_mixed_script_query() {
        let store = Store::open_memory().unwrap();
        let node_a = make_node("a.md", "Alpha", &[], json!({}));
        let node_b = make_node("b.md", "Beta", &[], json!({}));
        store.upsert_node(&node_a, 1).unwrap();
        store.upsert_node(&node_b, 1).unwrap();

        let ann_cjk = super::IndexableAnnotation {
            body: Some("丝绸之路是古代贸易通道".into()),
            ..make_annotation("note", None)
        };
        let ann_latin = super::IndexableAnnotation {
            body: Some("The Silk Road was an ancient trade route".into()),
            ..make_annotation("note", None)
        };
        store.upsert_annotations("a.md", &[ann_cjk]).unwrap();
        store.upsert_annotations("b.md", &[ann_latin]).unwrap();

        let cjk_results = store.search_annotations("丝绸之路", None, 10).unwrap();
        assert_eq!(cjk_results.len(), 1);
        assert_eq!(cjk_results[0].node_id, "a.md");

        let latin_results = store.search_annotations("Silk Road", None, 10).unwrap();
        assert_eq!(latin_results.len(), 1);
        assert_eq!(latin_results[0].node_id, "b.md");
    }

    // --- find_annotation_uuid ---

    #[test]
    fn find_annotation_uuid_returns_match() {
        let store = Store::open_memory().unwrap();
        let node = make_node("a.md", "A", &[], json!({}));
        store.upsert_node(&node, 1).unwrap();

        let ann = make_annotation("note", Some("hello world"));
        store.upsert_annotations("a.md", &[ann]).unwrap();

        let result = store
            .find_annotation_uuid("a.md", "note", Some("hello world"), 0)
            .unwrap();
        assert!(result.is_some());
        let uuid = result.unwrap();
        assert!(!uuid.is_empty());
    }

    #[test]
    fn find_annotation_uuid_returns_none_for_missing() {
        let store = Store::open_memory().unwrap();
        let node = make_node("a.md", "A", &[], json!({}));
        store.upsert_node(&node, 1).unwrap();

        let result = store
            .find_annotation_uuid("a.md", "note", Some("no such body"), 0)
            .unwrap();
        assert_eq!(result, None);
    }

    #[test]
    fn find_annotation_uuid_closest_when_duplicates() {
        let store = Store::open_memory().unwrap();
        let node = make_node("a.md", "A", &[], json!({}));
        store.upsert_node(&node, 1).unwrap();

        let ann_at_0 = super::IndexableAnnotation {
            char_start: 0,
            ..make_annotation("note", Some("dup body"))
        };
        let ann_at_100 = super::IndexableAnnotation {
            char_start: 100,
            ..make_annotation("note", Some("dup body"))
        };
        store.upsert_annotations("a.md", &[ann_at_0, ann_at_100]).unwrap();

        // hint=90, closer to 100
        let result = store
            .find_annotation_uuid("a.md", "note", Some("dup body"), 90)
            .unwrap()
            .unwrap();

        // Verify it's the one at char_start=100
        let uuid_at_100: String = store
            .conn
            .query_row(
                "SELECT uuid FROM annotations WHERE node_id='a.md' AND char_start=100",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(result, uuid_at_100);
    }

    #[test]
    fn find_annotation_uuid_with_null_body() {
        let store = Store::open_memory().unwrap();
        let node = make_node("a.md", "A", &[], json!({}));
        store.upsert_node(&node, 1).unwrap();

        let ann = make_annotation("note", None);
        store.upsert_annotations("a.md", &[ann]).unwrap();

        let result = store
            .find_annotation_uuid("a.md", "note", None, 0)
            .unwrap();
        assert!(result.is_some(), "should match annotation with NULL body");
    }

    // --- v6 → v7 migration path ---

    #[test]
    fn v6_to_v7_migration_recreates_fts_with_trigram() {
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
                CREATE TABLE annotations (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    node_id TEXT NOT NULL, annotation_type TEXT NOT NULL,
                    certainty TEXT NOT NULL, body TEXT, date TEXT,
                    source_line INTEGER NOT NULL, char_start INTEGER NOT NULL, char_end INTEGER NOT NULL,
                    scope_kind TEXT NOT NULL, scope_value TEXT NOT NULL
                );
                CREATE VIRTUAL TABLE annotations_fts USING fts5(body, node_id UNINDEXED, annotation_type UNINDEXED);
                INSERT INTO meta(key, value) VALUES ('schema_version', '6');
                INSERT INTO nodes(id, title, first_paragraph, frontmatter, mtime, is_stub)
                    VALUES ('a.md', 'Alpha', '', '{}', 1, 0);
                INSERT INTO annotations(node_id, annotation_type, certainty, body, date, source_line, char_start, char_end, scope_kind, scope_value)
                    VALUES ('a.md', 'note', 'neutral', '丝绸之路是古代贸易通道', NULL, 1, 0, 10, 'words', '1');",
            ).unwrap();
            conn.execute_batch(
                "INSERT INTO annotations_fts(rowid, body, node_id, annotation_type)
                    SELECT id, body, node_id, annotation_type FROM annotations WHERE body IS NOT NULL;",
            ).unwrap();
        }

        let store = Store::open(&db_path).unwrap();
        assert_eq!(store.schema_version().unwrap(), CURRENT_SCHEMA_VERSION);

        let results = store.search_annotations("丝绸之路", None, 10).unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].node_id, "a.md");
    }

    // --- Tag search ---

    #[test]
    fn search_tags_finds_matching_tags_with_counts() {
        let store = Store::open_memory().unwrap();
        let a = make_node("a.md", "A", &["rust", "coding"], json!({}));
        let b = make_node("b.md", "B", &["rust"], json!({}));
        let c = make_node("c.md", "C", &["python"], json!({}));
        store.upsert_node(&a, 1).unwrap();
        store.upsert_node(&b, 2).unwrap();
        store.upsert_node(&c, 3).unwrap();

        let results = store.search_tags("rust", 10).unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].tag, "rust");
        assert_eq!(results[0].count, 2);
    }

    #[test]
    fn search_tags_empty_query_returns_empty() {
        let store = Store::open_memory().unwrap();
        let a = make_node("a.md", "A", &["rust"], json!({}));
        store.upsert_node(&a, 1).unwrap();
        assert!(store.search_tags("", 10).unwrap().is_empty());
    }

    #[test]
    fn search_tags_no_match_returns_empty() {
        let store = Store::open_memory().unwrap();
        let a = make_node("a.md", "A", &["rust"], json!({}));
        store.upsert_node(&a, 1).unwrap();
        assert!(store.search_tags("zzz", 10).unwrap().is_empty());
    }

    #[test]
    fn search_tags_substring_match() {
        let store = Store::open_memory().unwrap();
        let a = make_node("a.md", "A", &["project/lit"], json!({}));
        store.upsert_node(&a, 1).unwrap();
        let results = store.search_tags("proj", 10).unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].tag, "project/lit");
    }

    #[test]
    fn search_tags_limit_enforced() {
        let store = Store::open_memory().unwrap();
        let a = make_node("a.md", "A", &["alpha", "beta", "gamma"], json!({}));
        store.upsert_node(&a, 1).unwrap();
        let results = store.search_tags("a", 2).unwrap();
        assert!(results.len() <= 2);
    }

    #[test]
    fn search_tags_ordered_by_count_desc_then_name() {
        let store = Store::open_memory().unwrap();
        let a = make_node("a.md", "A", &["alpha", "beta"], json!({}));
        let b = make_node("b.md", "B", &["beta"], json!({}));
        store.upsert_node(&a, 1).unwrap();
        store.upsert_node(&b, 2).unwrap();
        // both contain "a" or "b" — "beta" has count=2, "alpha" has count=1
        let results = store.search_tags("a", 10).unwrap();
        assert_eq!(results.len(), 2);
        assert_eq!(results[0].tag, "beta");
        assert_eq!(results[0].count, 2);
        assert_eq!(results[1].tag, "alpha");
        assert_eq!(results[1].count, 1);
    }

    #[test]
    fn list_pages_by_tag_returns_matching_pages() {
        let store = Store::open_memory().unwrap();
        let a = make_node("a.md", "Alpha", &["rust", "coding"], json!({}));
        let b = make_node("b.md", "Beta", &["rust"], json!({}));
        let c = make_node("c.md", "Charlie", &["python"], json!({}));
        store.upsert_node(&a, 1).unwrap();
        store.upsert_node(&b, 2).unwrap();
        store.upsert_node(&c, 3).unwrap();

        let results = store.list_pages_by_tag("rust", 10).unwrap();
        assert_eq!(results.len(), 2);
        assert_eq!(results[0].id, "a.md");
        assert_eq!(results[0].title, "Alpha");
        assert_eq!(results[1].id, "b.md");
        assert_eq!(results[1].title, "Beta");
    }

    #[test]
    fn list_pages_by_tag_nonexistent_returns_empty() {
        let store = Store::open_memory().unwrap();
        let a = make_node("a.md", "A", &["rust"], json!({}));
        store.upsert_node(&a, 1).unwrap();
        assert!(store.list_pages_by_tag("zzz", 10).unwrap().is_empty());
    }

    #[test]
    fn list_pages_by_tag_exact_match_only() {
        let store = Store::open_memory().unwrap();
        let a = make_node("a.md", "A", &["rust-lang"], json!({}));
        store.upsert_node(&a, 1).unwrap();
        assert!(store.list_pages_by_tag("rust", 10).unwrap().is_empty());
    }

    #[test]
    fn list_pages_by_tag_ordered_by_title() {
        let store = Store::open_memory().unwrap();
        let b = make_node("b.md", "Zebra", &["tag"], json!({}));
        let a = make_node("a.md", "Apple", &["tag"], json!({}));
        store.upsert_node(&b, 1).unwrap();
        store.upsert_node(&a, 2).unwrap();
        let results = store.list_pages_by_tag("tag", 10).unwrap();
        assert_eq!(results[0].title, "Apple");
        assert_eq!(results[1].title, "Zebra");
    }

    // --- Positions ---

    #[test]
    fn save_and_load_positions() {
        use super::super::types::Position;
        let store = Store::open_memory().unwrap();
        let mut positions = HashMap::new();
        positions.insert("A".to_string(), Position { x: 1.0, y: 2.0 });
        positions.insert("B".to_string(), Position { x: 3.0, y: 4.0 });
        store.save_positions(&positions).unwrap();
        let loaded = store.load_positions().unwrap();
        assert_eq!(loaded.len(), 2);
        assert_eq!(loaded["A"], Position { x: 1.0, y: 2.0 });
        assert_eq!(loaded["B"], Position { x: 3.0, y: 4.0 });
    }

    #[test]
    fn load_positions_empty() {
        let store = Store::open_memory().unwrap();
        let loaded = store.load_positions().unwrap();
        assert!(loaded.is_empty());
    }

    #[test]
    fn clear_positions() {
        use super::super::types::Position;
        let store = Store::open_memory().unwrap();
        let mut positions = HashMap::new();
        positions.insert("X".to_string(), Position { x: 5.0, y: 6.0 });
        store.save_positions(&positions).unwrap();
        store.clear_positions().unwrap();
        let loaded = store.load_positions().unwrap();
        assert!(loaded.is_empty());
    }

    #[test]
    fn save_positions_overwrites() {
        use super::super::types::Position;
        let store = Store::open_memory().unwrap();
        let mut p1 = HashMap::new();
        p1.insert("A".to_string(), Position { x: 1.0, y: 2.0 });
        store.save_positions(&p1).unwrap();
        let mut p2 = HashMap::new();
        p2.insert("A".to_string(), Position { x: 10.0, y: 20.0 });
        p2.insert("C".to_string(), Position { x: 30.0, y: 40.0 });
        store.save_positions(&p2).unwrap();
        let loaded = store.load_positions().unwrap();
        assert_eq!(loaded["A"], Position { x: 10.0, y: 20.0 });
        assert_eq!(loaded["C"], Position { x: 30.0, y: 40.0 });
    }

    #[test]
    fn delete_node_removes_positions() {
        use super::super::types::Position;
        let store = Store::open_memory().unwrap();
        store.upsert_node(&make_node("A", "Alpha", &[], json!({})), 1).unwrap();
        let mut positions = HashMap::new();
        positions.insert("A".to_string(), Position { x: 1.0, y: 2.0 });
        store.save_positions(&positions).unwrap();
        store.delete_node("A").unwrap();
        let loaded = store.load_positions().unwrap();
        assert!(!loaded.contains_key("A"));
    }

    #[test]
    fn v8_to_v9_migration_preserves_data() {
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
                CREATE TABLE annotations (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    node_id TEXT NOT NULL, annotation_type TEXT NOT NULL,
                    certainty TEXT NOT NULL, body TEXT, date TEXT,
                    source_line INTEGER NOT NULL, char_start INTEGER NOT NULL, char_end INTEGER NOT NULL,
                    scope_kind TEXT NOT NULL, scope_value TEXT NOT NULL
                );
                CREATE VIRTUAL TABLE annotations_fts USING fts5(
                    body, node_id UNINDEXED, annotation_type UNINDEXED,
                    tokenize = 'trigram case_sensitive 0'
                );
                CREATE TABLE node_positions (
                    node_id TEXT PRIMARY KEY, x REAL NOT NULL, y REAL NOT NULL
                );
                INSERT INTO meta(key, value) VALUES ('schema_version', '8');
                INSERT INTO nodes(id, title, first_paragraph, frontmatter, mtime, is_stub)
                    VALUES ('a.md', 'Alpha', 'First paragraph', '{}', 1, 0);",
            ).unwrap();
        }

        let store = Store::open(&db_path).unwrap();
        assert_eq!(store.schema_version().unwrap(), CURRENT_SCHEMA_VERSION);

        let title: String = store
            .conn
            .query_row("SELECT title FROM nodes WHERE id = 'a.md'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(title, "Alpha");
    }

    #[test]
    fn fetch_existing_annotations_propagates_row_error() {
        let store = Store::open_memory().unwrap();
        let node = make_node("a.md", "A", &[], json!({}));
        store.upsert_node(&node, 1000).unwrap();

        // Recreate the annotations table without NOT NULL on uuid so we can
        // insert a row with NULL uuid, which will fail deserialization
        // (ExistingAnnotation.uuid is String, not Option<String>).
        store.conn.execute_batch(
            "DROP TABLE annotations;
             CREATE TABLE annotations (
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
                 scope_value TEXT NOT NULL,
                 uuid TEXT
             );"
        ).unwrap();

        store.conn.execute(
            "INSERT INTO annotations(node_id, annotation_type, certainty, body, date, source_line, char_start, char_end, scope_kind, scope_value, uuid)
             VALUES ('a.md', 'highlight', 'certain', NULL, NULL, 1, 0, 10, 'line', '1', NULL)",
            [],
        ).unwrap();

        let result = store.fetch_existing_annotations("a.md");
        assert!(result.is_err(), "should propagate row-level deserialization error for NULL uuid");
    }

    #[test]
    fn upsert_annotations_update_applies_user_uuid() {
        let store = Store::open_memory().unwrap();
        let node = make_node("a.md", "A", &[], json!({}));
        store.upsert_node(&node, 1).unwrap();

        // First insert: no user-specified uuid → auto-generated v4 UUID
        let anns = vec![make_annotation("note", Some("body"))];
        store.upsert_annotations("a.md", &anns).unwrap();

        let auto_uuid: String = store.conn.query_row(
            "SELECT uuid FROM annotations WHERE node_id = 'a.md'", [], |r| r.get(0),
        ).unwrap();
        assert_eq!(auto_uuid.len(), 36, "should be auto-generated v4 UUID");

        // Second upsert: same body (matches existing) but with a user-specified [id]
        let anns2 = vec![super::IndexableAnnotation {
            uuid: Some("my-custom-id".into()),
            ..make_annotation("note", Some("body"))
        }];
        store.upsert_annotations("a.md", &anns2).unwrap();

        let updated_uuid: String = store.conn.query_row(
            "SELECT uuid FROM annotations WHERE node_id = 'a.md'", [], |r| r.get(0),
        ).unwrap();
        assert_eq!(updated_uuid, "my-custom-id", "user-specified uuid should replace auto-generated one");

        // Third upsert: same body, uuid=None → should keep existing "my-custom-id"
        let anns3 = vec![make_annotation("note", Some("body"))];
        store.upsert_annotations("a.md", &anns3).unwrap();

        let preserved_uuid: String = store.conn.query_row(
            "SELECT uuid FROM annotations WHERE node_id = 'a.md'", [], |r| r.get(0),
        ).unwrap();
        assert_eq!(preserved_uuid, "my-custom-id", "COALESCE should preserve existing uuid when incoming is None");
    }

    // --- Phase 2: v16 migration + materialization ---

    /// Helper: creates a v15 on-disk database with the full v15 schema (no materialization column).
    fn create_v15_db(db_path: &std::path::Path) {
        let conn = Connection::open(db_path).unwrap();
        conn.execute_batch("PRAGMA journal_mode=WAL;").unwrap();
        conn.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
        conn.execute_batch(
            "CREATE TABLE nodes (
                id TEXT PRIMARY KEY, title TEXT, first_paragraph TEXT,
                frontmatter JSON, mtime INTEGER, is_stub INTEGER DEFAULT 0, tags_text TEXT DEFAULT ''
            );
            CREATE TABLE tags (node_id TEXT, tag TEXT);
            CREATE TABLE aliases (node_id TEXT, alias TEXT);
            CREATE TABLE edges (source TEXT, target TEXT, context TEXT, raw_target TEXT DEFAULT '', source_line INTEGER DEFAULT 0, edge_kind TEXT NOT NULL DEFAULT 'wikilink');
            CREATE INDEX idx_edges_kind ON edges(edge_kind);
            CREATE TABLE sync (path TEXT PRIMARY KEY, mtime INTEGER);
            CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
            CREATE TABLE annotations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                node_id TEXT NOT NULL, annotation_type TEXT NOT NULL,
                certainty TEXT NOT NULL, body TEXT, date TEXT,
                source_line INTEGER NOT NULL, char_start INTEGER NOT NULL, char_end INTEGER NOT NULL,
                scope_kind TEXT NOT NULL, scope_value TEXT NOT NULL,
                uuid TEXT NOT NULL
            );
            CREATE INDEX idx_annotations_node_id ON annotations(node_id);
            CREATE INDEX idx_annotations_type ON annotations(annotation_type);
            CREATE VIRTUAL TABLE annotations_fts USING fts5(
                body, node_id UNINDEXED, annotation_type UNINDEXED,
                tokenize = 'trigram case_sensitive 0'
            );
            CREATE TABLE node_positions (
                node_id TEXT PRIMARY KEY, x REAL NOT NULL, y REAL NOT NULL
            );
            INSERT INTO meta(key, value) VALUES ('schema_version', '15');",
        ).unwrap();
    }

    #[test]
    fn v15_to_v16_migration_adds_materialization_column() {
        let dir = tempfile::tempdir().unwrap();
        let db_path = dir.path().join("test.db");
        create_v15_db(&db_path);

        // Insert a materialized node and a stub before migration
        {
            let conn = Connection::open(&db_path).unwrap();
            conn.execute(
                "INSERT INTO nodes(id, title, first_paragraph, frontmatter, mtime, is_stub) VALUES ('a.md', 'Alpha', 'p1', '{}', 1, 0)",
                [],
            ).unwrap();
            conn.execute(
                "INSERT INTO nodes(id, title, first_paragraph, frontmatter, mtime, is_stub) VALUES ('Ghost', '', '', '{}', 0, 1)",
                [],
            ).unwrap();
        }

        let store = Store::open(&db_path).unwrap();

        assert_eq!(store.schema_version().unwrap(), CURRENT_SCHEMA_VERSION);

        // materialized node gets 'materialized'
        let mat: String = store.conn.query_row(
            "SELECT materialization FROM nodes WHERE id = 'a.md'", [], |r| r.get(0),
        ).unwrap();
        assert_eq!(mat, "materialized");

        // stub node gets 'stub'
        let mat_stub: String = store.conn.query_row(
            "SELECT materialization FROM nodes WHERE id = 'Ghost'", [], |r| r.get(0),
        ).unwrap();
        assert_eq!(mat_stub, "stub");
    }

    #[test]
    fn v15_to_v16_migration_resets_sync_mtimes() {
        let dir = tempfile::tempdir().unwrap();
        let db_path = dir.path().join("test.db");
        create_v15_db(&db_path);

        {
            let conn = Connection::open(&db_path).unwrap();
            conn.execute_batch(
                "INSERT INTO sync(path, mtime) VALUES ('notes/a.md', 1700000000);
                 INSERT INTO sync(path, mtime) VALUES ('notes/b.md', 1700000001);",
            ).unwrap();
        }

        let store = Store::open(&db_path).unwrap();

        let max_mtime: i64 = store.conn
            .query_row("SELECT MAX(mtime) FROM sync", [], |r| r.get(0))
            .unwrap();
        assert_eq!(max_mtime, 0, "all sync mtimes should be reset to 0 after v16 migration");
    }

    #[test]
    fn v15_to_v16_migration_preserves_edges() {
        let dir = tempfile::tempdir().unwrap();
        let db_path = dir.path().join("test.db");
        create_v15_db(&db_path);

        {
            let conn = Connection::open(&db_path).unwrap();
            conn.execute_batch(
                "INSERT INTO nodes(id, title, first_paragraph, frontmatter, mtime, is_stub) VALUES ('a.md', 'A', '', '{}', 1, 0);
                 INSERT INTO nodes(id, title, first_paragraph, frontmatter, mtime, is_stub) VALUES ('b.md', 'B', '', '{}', 1, 0);
                 INSERT INTO edges(source, target, context, raw_target, source_line, edge_kind)
                     VALUES ('a.md', 'b.md', 'ctx', 'b', 3, 'wikilink');
                 INSERT INTO edges(source, target, context, raw_target, source_line, edge_kind)
                     VALUES ('a.md', 'b.md', 'cite', 'smith2024', 5, 'citation');",
            ).unwrap();
        }

        let store = Store::open(&db_path).unwrap();

        let count: i64 = store.conn
            .query_row("SELECT COUNT(*) FROM edges", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 2, "both edges should survive v16 migration");

        let wikilink_count: i64 = store.conn
            .query_row("SELECT COUNT(*) FROM edges WHERE edge_kind = 'wikilink'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(wikilink_count, 1);

        let citation_count: i64 = store.conn
            .query_row("SELECT COUNT(*) FROM edges WHERE edge_kind = 'citation'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(citation_count, 1);
    }

    #[test]
    fn upsert_node_writes_materialization_materialized() {
        let store = Store::open_memory().unwrap();
        let node = make_node("a.md", "Alpha", &[], json!({}));
        store.upsert_node(&node, 1).unwrap();

        let mat: String = store.conn.query_row(
            "SELECT materialization FROM nodes WHERE id = 'a.md'", [], |r| r.get(0),
        ).unwrap();
        assert_eq!(mat, "materialized");

        // Manually insert a stub-like row to test that upsert_node overwrites materialization
        store.conn.execute(
            "INSERT INTO nodes(id, title, first_paragraph, frontmatter, mtime, is_stub, materialization)
             VALUES ('Ghost', '', '', '{}', 0, 1, 'stub')",
            [],
        ).unwrap();

        let node_ghost = make_node("Ghost", "Ghost Page", &[], json!({}));
        store.upsert_node(&node_ghost, 1).unwrap();
        let mat_promoted: String = store.conn.query_row(
            "SELECT materialization FROM nodes WHERE id = 'Ghost'", [], |r| r.get(0),
        ).unwrap();
        assert_eq!(mat_promoted, "materialized", "upsert_node over a stub should set materialization to 'materialized'");
    }

    #[test]
    fn upsert_stub_writes_materialization_stub() {
        let store = Store::open_memory().unwrap();
        store.upsert_stub("Ghost").unwrap();

        let mat: String = store.conn.query_row(
            "SELECT materialization FROM nodes WHERE id = 'Ghost'", [], |r| r.get(0),
        ).unwrap();
        assert_eq!(mat, "stub");
    }

    #[test]
    fn upsert_shadow_inserts_new_shadow_node() {
        let store = Store::open_memory().unwrap();
        store.upsert_shadow("bib:smith2024", "Smith (2024) Title", Materialization::Shadow).unwrap();

        let (is_stub, mtime, mat, title): (i64, i64, String, String) = store.conn.query_row(
            "SELECT is_stub, mtime, materialization, title FROM nodes WHERE id = 'bib:smith2024'",
            [], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        ).unwrap();
        assert_eq!(is_stub, 0);
        assert_eq!(mtime, 0);
        assert_eq!(mat, "shadow");
        assert_eq!(title, "Smith (2024) Title");
    }

    #[test]
    fn upsert_shadow_flips_shadow_to_partial() {
        let store = Store::open_memory().unwrap();
        store.upsert_shadow("bib:smith2024", "Smith (2024)", Materialization::Shadow).unwrap();

        let mat: String = store.conn.query_row(
            "SELECT materialization FROM nodes WHERE id = 'bib:smith2024'", [], |r| r.get(0),
        ).unwrap();
        assert_eq!(mat, "shadow");

        store.upsert_shadow("bib:smith2024", "Smith (2024) Updated", Materialization::Partial).unwrap();

        let (mat2, title2): (String, String) = store.conn.query_row(
            "SELECT materialization, title FROM nodes WHERE id = 'bib:smith2024'",
            [], |r| Ok((r.get(0)?, r.get(1)?)),
        ).unwrap();
        assert_eq!(mat2, "partial");
        assert_eq!(title2, "Smith (2024) Updated");
    }

    #[test]
    fn upsert_shadow_does_not_overwrite_materialized_node() {
        let store = Store::open_memory().unwrap();
        let node = make_node("some.md", "Some Page", &[], json!({}));
        store.upsert_node(&node, 1).unwrap();

        store.upsert_shadow("some.md", "Shadow Title", Materialization::Shadow).unwrap();

        let (mat, title): (String, String) = store.conn.query_row(
            "SELECT materialization, title FROM nodes WHERE id = 'some.md'",
            [], |r| Ok((r.get(0)?, r.get(1)?)),
        ).unwrap();
        assert_eq!(mat, "materialized", "upsert_shadow should not overwrite a materialized node");
        assert_eq!(title, "Some Page", "title of materialized node should be unchanged");
    }

    #[test]
    fn prune_shadows_deletes_orphaned_bib_nodes() {
        let store = Store::open_memory().unwrap();
        store.upsert_shadow("bib:a", "A", Materialization::Shadow).unwrap();
        store.upsert_shadow("bib:b", "B", Materialization::Shadow).unwrap();
        store.upsert_shadow("bib:c", "C", Materialization::Shadow).unwrap();

        let keep: HashSet<String> = ["bib:a".into(), "bib:c".into()].into();
        let deleted = store.prune_shadows(&keep).unwrap();
        assert_eq!(deleted, 1);

        let count: i64 = store.conn.query_row(
            "SELECT COUNT(*) FROM nodes WHERE id LIKE 'bib:%'", [], |r| r.get(0),
        ).unwrap();
        assert_eq!(count, 2);
    }

    #[test]
    fn prune_shadows_leaves_non_bib_nodes_alone() {
        let store = Store::open_memory().unwrap();
        let node = make_node("page.md", "Page", &[], json!({}));
        store.upsert_node(&node, 1).unwrap();
        store.upsert_shadow("bib:x", "X", Materialization::Shadow).unwrap();

        let keep: HashSet<String> = HashSet::new();
        let deleted = store.prune_shadows(&keep).unwrap();
        assert_eq!(deleted, 1);

        // page.md survives
        let page_exists: bool = store.conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM nodes WHERE id = 'page.md')", [], |r| r.get(0),
        ).unwrap();
        assert!(page_exists, "non-bib node should survive prune_shadows");
    }

    #[test]
    fn prune_shadows_noop_when_all_kept() {
        let store = Store::open_memory().unwrap();
        store.upsert_shadow("bib:a", "A", Materialization::Shadow).unwrap();

        let keep: HashSet<String> = ["bib:a".into()].into();
        let deleted = store.prune_shadows(&keep).unwrap();
        assert_eq!(deleted, 0);

        let count: i64 = store.conn.query_row(
            "SELECT COUNT(*) FROM nodes WHERE id = 'bib:a'", [], |r| r.get(0),
        ).unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn sources_citing_returns_page_ids_citing_key() {
        let store = Store::open_memory().unwrap();
        let a = make_node("a.md", "A", &[], json!({}));
        let b = make_node("b.md", "B", &[], json!({}));
        store.upsert_node(&a, 1).unwrap();
        store.upsert_node(&b, 1).unwrap();

        store.insert_edge("a.md", "bib:smith2024", "ctx", "smith2024", 3, EdgeKind::Citation).unwrap();
        store.insert_edge("b.md", "bib:smith2024", "ctx", "smith2024", 7, EdgeKind::Citation).unwrap();

        let sources = store.sources_citing("smith2024").unwrap();
        assert_eq!(sources, vec!["a.md", "b.md"]);
    }

    #[test]
    fn sources_citing_empty_for_unknown_key() {
        let store = Store::open_memory().unwrap();
        let sources = store.sources_citing("nonexistent").unwrap();
        assert!(sources.is_empty());
    }

    #[test]
    fn citekey_pages_returns_pages_with_citekey_frontmatter() {
        let store = Store::open_memory().unwrap();
        let paper = make_node("paper.md", "Paper", &[], json!({"citekey": "smith2024"}));
        let other = make_node("other.md", "Other", &[], json!({}));
        store.upsert_node(&paper, 1).unwrap();
        store.upsert_node(&other, 1).unwrap();

        let pages = store.citekey_pages().unwrap();
        assert_eq!(pages, vec![("smith2024".into(), "paper.md".into())]);
    }

    #[test]
    fn citekey_pages_empty_when_no_citekeys() {
        let store = Store::open_memory().unwrap();
        let node = make_node("a.md", "A", &[], json!({}));
        store.upsert_node(&node, 1).unwrap();

        let pages = store.citekey_pages().unwrap();
        assert!(pages.is_empty());
    }

    #[test]
    fn all_nodes_metadata_returns_materialization() {
        let store = Store::open_memory().unwrap();
        let node = make_node("a.md", "A", &[], json!({}));
        store.upsert_node(&node, 1).unwrap();
        store.upsert_stub("Ghost").unwrap();
        store.upsert_shadow("bib:x", "X", Materialization::Shadow).unwrap();

        let meta = store.all_nodes_metadata().unwrap();
        assert_eq!(meta.len(), 3);
        assert!(meta.contains(&("a.md".into(), false, Materialization::Materialized)));
        assert!(meta.contains(&("Ghost".into(), true, Materialization::Stub)));
        assert!(meta.contains(&("bib:x".into(), false, Materialization::Shadow)));
    }

    #[test]
    fn citing_pages_matches_on_raw_target() {
        let store = Store::open_memory().unwrap();
        let a = make_node("a.md", "A", &[], json!({}));
        store.upsert_node(&a, 1).unwrap();
        store.upsert_shadow("bib:smith2024", "Smith", Materialization::Shadow).unwrap();

        // Edge target is the resolved bib: node id, raw_target is the raw key
        store.insert_edge("a.md", "bib:smith2024", "cited here", "smith2024", 5, EdgeKind::Citation).unwrap();

        // citing_pages should match on raw_target, not target
        let results = store.citing_pages("smith2024").unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].source_id, "a.md");
    }

    // --- is_stub / materialization consistency triggers ---

    #[test]
    fn check_constraint_rejects_inconsistent_is_stub_materialized() {
        let store = Store::open_memory().unwrap();
        // is_stub=1 but materialization='materialized' is inconsistent
        let result = store.conn.execute(
            "INSERT INTO nodes(id, title, first_paragraph, frontmatter, mtime, is_stub, materialization)
             VALUES ('bad1', '', '', '{}', 0, 1, 'materialized')",
            [],
        );
        assert!(result.is_err(), "trigger should reject is_stub=1 with materialization='materialized'");
        let err_msg = result.unwrap_err().to_string();
        assert!(
            err_msg.contains("is_stub inconsistent with materialization"),
            "unexpected error message: {err_msg}"
        );
    }

    #[test]
    fn check_constraint_rejects_inconsistent_is_stub_stub() {
        let store = Store::open_memory().unwrap();
        // is_stub=0 but materialization='stub' is inconsistent
        let result = store.conn.execute(
            "INSERT INTO nodes(id, title, first_paragraph, frontmatter, mtime, is_stub, materialization)
             VALUES ('bad2', '', '', '{}', 0, 0, 'stub')",
            [],
        );
        assert!(result.is_err(), "trigger should reject is_stub=0 with materialization='stub'");
        let err_msg = result.unwrap_err().to_string();
        assert!(
            err_msg.contains("is_stub inconsistent with materialization"),
            "unexpected error message: {err_msg}"
        );
    }

    #[test]
    fn check_constraint_rejects_update_inconsistency() {
        let store = Store::open_memory().unwrap();
        // Insert a consistent row first
        store.conn.execute(
            "INSERT INTO nodes(id, title, first_paragraph, frontmatter, mtime, is_stub, materialization)
             VALUES ('upd1', '', '', '{}', 0, 1, 'stub')",
            [],
        ).unwrap();

        // Now update materialization without updating is_stub — should be rejected
        let result = store.conn.execute(
            "UPDATE nodes SET materialization = 'materialized' WHERE id = 'upd1'",
            [],
        );
        assert!(result.is_err(), "trigger should reject update that makes is_stub inconsistent with materialization");
        let err_msg = result.unwrap_err().to_string();
        assert!(
            err_msg.contains("is_stub inconsistent with materialization"),
            "unexpected error message: {err_msg}"
        );
    }
}
