use std::path::Path;

use rusqlite::Connection;
use serde::Serialize;
use tracing::{debug, info};

use super::error::OpLogError;

pub const CURRENT_SCHEMA_VERSION: i64 = 1;
pub const MAX_UNDO_DEPTH: i64 = 50;

#[derive(Debug, Clone)]
pub struct Action {
    pub seq: i64,
    pub action_type: String,
    pub path: String,
    pub old_path: Option<String>,
    pub before_content: Option<String>,
    pub after_content: Option<String>,
}

#[derive(Debug, Clone)]
pub struct Operation {
    pub id: i64,
    pub op_type: String,
    pub description: String,
    pub created_at: i64,
    pub actions: Vec<Action>,
}

#[derive(Debug, Clone, Serialize)]
pub struct OperationSummary {
    pub id: i64,
    pub op_type: String,
    pub description: String,
    pub created_at: i64,
}

pub struct OpLogStore {
    conn: Connection,
}

impl OpLogStore {
    pub fn open(path: &Path) -> Result<Self, OpLogError> {
        info!(path = %path.display(), "opening oplog store");
        let conn = Connection::open(path)?;
        let store = Self { conn };
        store.migrate()?;
        Ok(store)
    }

    pub fn open_memory() -> Result<Self, OpLogError> {
        debug!("opening in-memory oplog store");
        let conn = Connection::open_in_memory()?;
        let store = Self { conn };
        store.migrate()?;
        Ok(store)
    }

    fn migrate(&self) -> Result<(), OpLogError> {
        self.conn.execute_batch("PRAGMA journal_mode=WAL;")?;
        self.conn.execute_batch("PRAGMA foreign_keys=ON;")?;

        self.conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS operations (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                op_type     TEXT NOT NULL,
                description TEXT NOT NULL,
                created_at  INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS actions (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                operation_id    INTEGER NOT NULL REFERENCES operations(id) ON DELETE CASCADE,
                seq             INTEGER NOT NULL,
                action_type     TEXT NOT NULL,
                path            TEXT NOT NULL,
                old_path        TEXT,
                before_content  TEXT,
                after_content   TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_actions_operation_id ON actions(operation_id);

            CREATE TABLE IF NOT EXISTS meta (
                key   TEXT PRIMARY KEY,
                value TEXT
            );

            INSERT OR IGNORE INTO meta(key, value) VALUES ('schema_version', '1');",
        )?;

        Ok(())
    }

    pub fn schema_version(&self) -> Result<i64, OpLogError> {
        let version: String = self.conn.query_row(
            "SELECT value FROM meta WHERE key = 'schema_version'",
            [],
            |row| row.get(0),
        )?;
        Ok(version.parse::<i64>().unwrap_or(0))
    }

    pub fn record_operation(
        &self,
        op_type: &str,
        description: &str,
        actions: &[Action],
    ) -> Result<i64, OpLogError> {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as i64;

        self.conn.execute(
            "INSERT INTO operations(op_type, description, created_at) VALUES (?1, ?2, ?3)",
            rusqlite::params![op_type, description, now],
        )?;
        let op_id = self.conn.last_insert_rowid();

        for action in actions {
            self.conn.execute(
                "INSERT INTO actions(operation_id, seq, action_type, path, old_path, before_content, after_content)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                rusqlite::params![
                    op_id,
                    action.seq,
                    action.action_type,
                    action.path,
                    action.old_path,
                    action.before_content,
                    action.after_content,
                ],
            )?;
        }

        self.prune(MAX_UNDO_DEPTH)?;

        Ok(op_id)
    }

    pub fn latest_operation(&self) -> Result<Option<Operation>, OpLogError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, op_type, description, created_at FROM operations ORDER BY id DESC LIMIT 1",
        )?;
        let mut rows = stmt.query([])?;

        match rows.next()? {
            Some(row) => {
                let op = self.build_operation(row)?;
                Ok(Some(op))
            }
            None => Ok(None),
        }
    }

    pub fn list_operations(&self, limit: i64) -> Result<Vec<OperationSummary>, OpLogError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, op_type, description, created_at FROM operations ORDER BY id DESC LIMIT ?1",
        )?;
        let results = stmt
            .query_map([limit], |row| {
                Ok(OperationSummary {
                    id: row.get(0)?,
                    op_type: row.get(1)?,
                    description: row.get(2)?,
                    created_at: row.get(3)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(results)
    }

    pub fn pop_latest(&self) -> Result<Operation, OpLogError> {
        let op = self
            .latest_operation()?
            .ok_or(OpLogError::NothingToUndo)?;

        self.conn
            .execute("DELETE FROM operations WHERE id = ?1", [op.id])?;

        Ok(op)
    }

    fn prune(&self, max_depth: i64) -> Result<(), OpLogError> {
        self.conn.execute(
            "DELETE FROM operations WHERE id NOT IN (
                SELECT id FROM operations ORDER BY id DESC LIMIT ?1
            )",
            [max_depth],
        )?;
        Ok(())
    }

    fn build_operation(&self, row: &rusqlite::Row) -> Result<Operation, rusqlite::Error> {
        let id: i64 = row.get(0)?;
        let op_type: String = row.get(1)?;
        let description: String = row.get(2)?;
        let created_at: i64 = row.get(3)?;

        let mut action_stmt = self.conn.prepare(
            "SELECT seq, action_type, path, old_path, before_content, after_content
             FROM actions WHERE operation_id = ?1 ORDER BY seq",
        ).map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;

        let actions = action_stmt
            .query_map([id], |arow| {
                Ok(Action {
                    seq: arow.get(0)?,
                    action_type: arow.get(1)?,
                    path: arow.get(2)?,
                    old_path: arow.get(3)?,
                    before_content: arow.get(4)?,
                    after_content: arow.get(5)?,
                })
            })
            .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?
            .collect::<Result<Vec<_>, _>>()?;

        Ok(Operation {
            id,
            op_type,
            description,
            created_at,
            actions,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_action(seq: i64, action_type: &str, path: &str) -> Action {
        Action {
            seq,
            action_type: action_type.into(),
            path: path.into(),
            old_path: None,
            before_content: None,
            after_content: None,
        }
    }

    // --- Cycle 2: schema and constructor ---

    #[test]
    fn open_memory_creates_tables() {
        let store = OpLogStore::open_memory().unwrap();
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
        assert!(tables.contains(&"operations".to_string()));
        assert!(tables.contains(&"actions".to_string()));
        assert!(tables.contains(&"meta".to_string()));
    }

    #[test]
    fn schema_version_is_1() {
        let store = OpLogStore::open_memory().unwrap();
        assert_eq!(store.schema_version().unwrap(), CURRENT_SCHEMA_VERSION);
    }

    #[test]
    fn open_file_is_idempotent() {
        let dir = tempfile::tempdir().unwrap();
        let db_path = dir.path().join("oplog.db");
        {
            let store = OpLogStore::open(&db_path).unwrap();
            assert_eq!(store.schema_version().unwrap(), 1);
        }
        {
            let store = OpLogStore::open(&db_path).unwrap();
            assert_eq!(store.schema_version().unwrap(), 1);
        }
    }

    // --- Cycle 3: record operation ---

    #[test]
    fn record_single_action_operation() {
        let store = OpLogStore::open_memory().unwrap();
        let actions = vec![make_action(0, "create_file", "Test.md")];
        let id = store
            .record_operation("create_page", "Create 'Test'", &actions)
            .unwrap();
        assert!(id > 0);

        let op_count: i64 = store
            .conn
            .query_row("SELECT COUNT(*) FROM operations", [], |r| r.get(0))
            .unwrap();
        assert_eq!(op_count, 1);

        let action_count: i64 = store
            .conn
            .query_row("SELECT COUNT(*) FROM actions", [], |r| r.get(0))
            .unwrap();
        assert_eq!(action_count, 1);
    }

    #[test]
    fn record_compound_operation() {
        let store = OpLogStore::open_memory().unwrap();
        let actions = vec![
            make_action(0, "delete_file", "a.md"),
            make_action(1, "create_file", "b.md"),
            make_action(2, "modify_file", "c.md"),
        ];
        store
            .record_operation("compound", "Merge pages", &actions)
            .unwrap();

        let seqs: Vec<i64> = {
            let mut stmt = store
                .conn
                .prepare("SELECT seq FROM actions ORDER BY seq")
                .unwrap();
            stmt.query_map([], |r| r.get(0))
                .unwrap()
                .collect::<Result<_, _>>()
                .unwrap()
        };
        assert_eq!(seqs, vec![0, 1, 2]);
    }

    #[test]
    fn record_returns_operation_id() {
        let store = OpLogStore::open_memory().unwrap();
        let id1 = store
            .record_operation("create_page", "Create A", &[make_action(0, "create_file", "a.md")])
            .unwrap();
        let id2 = store
            .record_operation("create_page", "Create B", &[make_action(0, "create_file", "b.md")])
            .unwrap();
        assert!(id2 > id1);
    }

    #[test]
    fn record_stores_before_and_after_content() {
        let store = OpLogStore::open_memory().unwrap();
        let actions = vec![Action {
            seq: 0,
            action_type: "modify_file".into(),
            path: "test.md".into(),
            old_path: None,
            before_content: Some("old content".into()),
            after_content: Some("new content".into()),
        }];
        store
            .record_operation("modify", "Edit test", &actions)
            .unwrap();

        let (before, after): (Option<String>, Option<String>) = store
            .conn
            .query_row(
                "SELECT before_content, after_content FROM actions LIMIT 1",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(before.unwrap(), "old content");
        assert_eq!(after.unwrap(), "new content");
    }

    // --- Cycle 4: query operations ---

    #[test]
    fn latest_operation_empty_returns_none() {
        let store = OpLogStore::open_memory().unwrap();
        assert!(store.latest_operation().unwrap().is_none());
    }

    #[test]
    fn latest_operation_returns_most_recent_with_actions() {
        let store = OpLogStore::open_memory().unwrap();
        store
            .record_operation("create_page", "Create A", &[make_action(0, "create_file", "a.md")])
            .unwrap();
        store
            .record_operation("create_page", "Create B", &[make_action(0, "create_file", "b.md")])
            .unwrap();

        let op = store.latest_operation().unwrap().unwrap();
        assert_eq!(op.description, "Create B");
        assert_eq!(op.actions.len(), 1);
        assert_eq!(op.actions[0].path, "b.md");
    }

    #[test]
    fn list_operations_returns_newest_first() {
        let store = OpLogStore::open_memory().unwrap();
        store
            .record_operation("create_page", "Create A", &[make_action(0, "create_file", "a.md")])
            .unwrap();
        store
            .record_operation("create_page", "Create B", &[make_action(0, "create_file", "b.md")])
            .unwrap();

        let ops = store.list_operations(10).unwrap();
        assert_eq!(ops.len(), 2);
        assert_eq!(ops[0].description, "Create B");
        assert_eq!(ops[1].description, "Create A");
    }

    #[test]
    fn list_operations_respects_limit() {
        let store = OpLogStore::open_memory().unwrap();
        for i in 0..5 {
            store
                .record_operation(
                    "create_page",
                    &format!("Create {i}"),
                    &[make_action(0, "create_file", &format!("{i}.md"))],
                )
                .unwrap();
        }

        let ops = store.list_operations(3).unwrap();
        assert_eq!(ops.len(), 3);
    }

    // --- Cycle 5: pop latest ---

    #[test]
    fn pop_latest_returns_and_removes() {
        let store = OpLogStore::open_memory().unwrap();
        store
            .record_operation("create_page", "Create A", &[make_action(0, "create_file", "a.md")])
            .unwrap();

        let op = store.pop_latest().unwrap();
        assert_eq!(op.description, "Create A");

        let count: i64 = store
            .conn
            .query_row("SELECT COUNT(*) FROM operations", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 0);
    }

    #[test]
    fn pop_empty_returns_nothing_to_undo() {
        let store = OpLogStore::open_memory().unwrap();
        let result = store.pop_latest();
        assert!(result.is_err());
        assert_eq!(result.unwrap_err().to_string(), "nothing to undo");
    }

    #[test]
    fn pop_removes_associated_actions() {
        let store = OpLogStore::open_memory().unwrap();
        store
            .record_operation(
                "compound",
                "Merge",
                &[
                    make_action(0, "delete_file", "a.md"),
                    make_action(1, "create_file", "b.md"),
                ],
            )
            .unwrap();

        store.pop_latest().unwrap();

        let action_count: i64 = store
            .conn
            .query_row("SELECT COUNT(*) FROM actions", [], |r| r.get(0))
            .unwrap();
        assert_eq!(action_count, 0);
    }

    #[test]
    fn pop_twice_returns_different_operations() {
        let store = OpLogStore::open_memory().unwrap();
        store
            .record_operation("create_page", "Create A", &[make_action(0, "create_file", "a.md")])
            .unwrap();
        store
            .record_operation("create_page", "Create B", &[make_action(0, "create_file", "b.md")])
            .unwrap();

        let op1 = store.pop_latest().unwrap();
        let op2 = store.pop_latest().unwrap();
        assert_eq!(op1.description, "Create B");
        assert_eq!(op2.description, "Create A");
    }

    // --- Cycle 6: pruning ---

    #[test]
    fn prune_keeps_at_most_n() {
        let store = OpLogStore::open_memory().unwrap();
        for i in 0..60 {
            store
                .record_operation(
                    "create_page",
                    &format!("Create {i}"),
                    &[make_action(0, "create_file", &format!("{i}.md"))],
                )
                .unwrap();
        }

        let count: i64 = store
            .conn
            .query_row("SELECT COUNT(*) FROM operations", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, MAX_UNDO_DEPTH);
    }

    #[test]
    fn prune_removes_orphan_actions() {
        let store = OpLogStore::open_memory().unwrap();
        for i in 0..60 {
            store
                .record_operation(
                    "create_page",
                    &format!("Create {i}"),
                    &[make_action(0, "create_file", &format!("{i}.md"))],
                )
                .unwrap();
        }

        let action_count: i64 = store
            .conn
            .query_row("SELECT COUNT(*) FROM actions", [], |r| r.get(0))
            .unwrap();
        assert_eq!(action_count, MAX_UNDO_DEPTH);
    }

    #[test]
    fn prune_noop_below_limit() {
        let store = OpLogStore::open_memory().unwrap();
        for i in 0..3 {
            store
                .record_operation(
                    "create_page",
                    &format!("Create {i}"),
                    &[make_action(0, "create_file", &format!("{i}.md"))],
                )
                .unwrap();
        }

        let count: i64 = store
            .conn
            .query_row("SELECT COUNT(*) FROM operations", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 3);
    }
}
