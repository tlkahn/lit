use std::fs;
use std::path::Path;

use crate::workspace::write_hash::WriteHashRegistry;

use super::error::OpLogError;
use super::store::Operation;

pub fn execute_undo(
    root: &Path,
    operation: &Operation,
    write_hash_registry: &WriteHashRegistry,
) -> Result<(), OpLogError> {
    for action in operation.actions.iter().rev() {
        match action.action_type.as_str() {
            "create_file" => {
                let full_path = root.join(&action.path);
                if full_path.exists() {
                    fs::remove_file(&full_path)?;
                }
            }
            "delete_file" => {
                let full_path = root.join(&action.path);
                if let Some(parent) = full_path.parent() {
                    fs::create_dir_all(parent)?;
                }
                let content = action.before_content.as_deref().unwrap_or("");
                fs::write(&full_path, content)?;
                write_hash_registry.record(&full_path, content);
            }
            "modify_file" => {
                let full_path = root.join(&action.path);
                if let Some(parent) = full_path.parent() {
                    fs::create_dir_all(parent)?;
                }
                let content = action.before_content.as_deref().unwrap_or("");
                fs::write(&full_path, content)?;
                write_hash_registry.record(&full_path, content);
            }
            "rename_file" => {
                let current_path = root.join(&action.path);
                if let Some(old_path_str) = &action.old_path {
                    let original_path = root.join(old_path_str);
                    if let Some(parent) = original_path.parent() {
                        fs::create_dir_all(parent)?;
                    }
                    if current_path.exists() {
                        fs::rename(&current_path, &original_path)?;
                    }
                }
            }
            _ => {}
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::oplog::store::Action;
    use tempfile::TempDir;

    fn make_operation(actions: Vec<Action>) -> Operation {
        Operation {
            id: 1,
            op_type: "test".into(),
            description: "test op".into(),
            created_at: 0,
            actions,
        }
    }

    // --- Cycle 7: core actions ---

    #[test]
    fn undo_create_deletes_file() {
        let dir = TempDir::new().unwrap();
        fs::write(dir.path().join("new.md"), "content").unwrap();
        let registry = WriteHashRegistry::new();

        let op = make_operation(vec![Action {
            seq: 0,
            action_type: "create_file".into(),
            path: "new.md".into(),
            old_path: None,
            before_content: None,
            after_content: Some("content".into()),
        }]);

        execute_undo(dir.path(), &op, &registry).unwrap();
        assert!(!dir.path().join("new.md").exists());
    }

    #[test]
    fn undo_delete_restores_content() {
        let dir = TempDir::new().unwrap();
        let registry = WriteHashRegistry::new();

        let op = make_operation(vec![Action {
            seq: 0,
            action_type: "delete_file".into(),
            path: "deleted.md".into(),
            old_path: None,
            before_content: Some("original content".into()),
            after_content: None,
        }]);

        execute_undo(dir.path(), &op, &registry).unwrap();
        assert_eq!(
            fs::read_to_string(dir.path().join("deleted.md")).unwrap(),
            "original content"
        );
    }

    #[test]
    fn undo_modify_restores_before_content() {
        let dir = TempDir::new().unwrap();
        fs::write(dir.path().join("modified.md"), "new content").unwrap();
        let registry = WriteHashRegistry::new();

        let op = make_operation(vec![Action {
            seq: 0,
            action_type: "modify_file".into(),
            path: "modified.md".into(),
            old_path: None,
            before_content: Some("old content".into()),
            after_content: Some("new content".into()),
        }]);

        execute_undo(dir.path(), &op, &registry).unwrap();
        assert_eq!(
            fs::read_to_string(dir.path().join("modified.md")).unwrap(),
            "old content"
        );
    }

    #[test]
    fn undo_rename_moves_back() {
        let dir = TempDir::new().unwrap();
        fs::write(dir.path().join("new-name.md"), "content").unwrap();
        let registry = WriteHashRegistry::new();

        let op = make_operation(vec![Action {
            seq: 0,
            action_type: "rename_file".into(),
            path: "new-name.md".into(),
            old_path: Some("old-name.md".into()),
            before_content: None,
            after_content: None,
        }]);

        execute_undo(dir.path(), &op, &registry).unwrap();
        assert!(!dir.path().join("new-name.md").exists());
        assert!(dir.path().join("old-name.md").exists());
        assert_eq!(
            fs::read_to_string(dir.path().join("old-name.md")).unwrap(),
            "content"
        );
    }

    #[test]
    fn undo_compound_reverses_in_reverse_order() {
        let dir = TempDir::new().unwrap();
        fs::write(dir.path().join("b.md"), "").unwrap();
        let registry = WriteHashRegistry::new();

        let op = make_operation(vec![
            Action {
                seq: 0,
                action_type: "delete_file".into(),
                path: "a.md".into(),
                old_path: None,
                before_content: Some("a content".into()),
                after_content: None,
            },
            Action {
                seq: 1,
                action_type: "create_file".into(),
                path: "b.md".into(),
                old_path: None,
                before_content: None,
                after_content: Some("".into()),
            },
        ]);

        execute_undo(dir.path(), &op, &registry).unwrap();
        assert!(dir.path().join("a.md").exists());
        assert!(!dir.path().join("b.md").exists());
    }

    // --- Cycle 8: edge cases ---

    #[test]
    fn undo_updates_write_hash_registry() {
        let dir = TempDir::new().unwrap();
        let registry = WriteHashRegistry::new();

        let op = make_operation(vec![Action {
            seq: 0,
            action_type: "delete_file".into(),
            path: "restored.md".into(),
            old_path: None,
            before_content: Some("restored content".into()),
            after_content: None,
        }]);

        execute_undo(dir.path(), &op, &registry).unwrap();

        let full_path = dir.path().join("restored.md");
        assert!(registry.check(&full_path, "restored content"));
    }

    #[test]
    fn undo_restores_to_nested_dir() {
        let dir = TempDir::new().unwrap();
        let registry = WriteHashRegistry::new();

        let op = make_operation(vec![Action {
            seq: 0,
            action_type: "delete_file".into(),
            path: "deep/nested/dir/page.md".into(),
            old_path: None,
            before_content: Some("nested content".into()),
            after_content: None,
        }]);

        execute_undo(dir.path(), &op, &registry).unwrap();
        assert!(dir.path().join("deep/nested/dir/page.md").exists());
        assert_eq!(
            fs::read_to_string(dir.path().join("deep/nested/dir/page.md")).unwrap(),
            "nested content"
        );
    }

    #[test]
    fn undo_create_already_gone_is_ok() {
        let dir = TempDir::new().unwrap();
        let registry = WriteHashRegistry::new();

        let op = make_operation(vec![Action {
            seq: 0,
            action_type: "create_file".into(),
            path: "already-deleted.md".into(),
            old_path: None,
            before_content: None,
            after_content: Some("content".into()),
        }]);

        let result = execute_undo(dir.path(), &op, &registry);
        assert!(result.is_ok());
    }
}
