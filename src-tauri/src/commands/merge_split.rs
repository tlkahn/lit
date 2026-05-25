use indexmap::IndexMap;
use serde::Deserialize;
use serde_yaml::Value;
use std::sync::Arc;
use tauri::State;

use crate::commands::graph::GraphRegistry;
use crate::commands::oplog::OpLogRegistry;
use crate::commands::workspace::{get_workspace_root, WorkspaceRegistry};
use crate::oplog::store::Action;
use crate::workspace::merge::{self, MergeInput, MergePlan};
use crate::workspace::ops;
use crate::workspace::split::{self, SplitPlan};
use crate::workspace::write_hash::WriteHashRegistry;

#[derive(Debug, Deserialize)]
pub struct MergeInputPayload {
    pub title: String,
    pub body: String,
    pub frontmatter: IndexMap<String, Value>,
}

#[tauri::command]
pub fn preview_merge(docs: Vec<MergeInputPayload>) -> Result<MergePlan, String> {
    let inputs: Vec<MergeInput> = docs
        .into_iter()
        .map(|d| MergeInput {
            title: d.title,
            body: d.body,
            frontmatter: d.frontmatter,
        })
        .collect();
    Ok(merge::plan_merge(&inputs))
}

#[tauri::command]
pub fn preview_split(
    content: String,
    title: String,
    frontmatter: IndexMap<String, Value>,
) -> Result<SplitPlan, String> {
    Ok(split::plan_split(&content, &title, &frontmatter))
}

#[tauri::command]
pub fn merge_documents(
    paths: Vec<String>,
    title: String,
    ordering: Vec<usize>,
    output_dir: Option<String>,
    window: tauri::Window,
    state: State<WorkspaceRegistry>,
    registry: State<Arc<WriteHashRegistry>>,
    graph_state: State<Arc<GraphRegistry>>,
    oplog_state: State<Arc<OpLogRegistry>>,
    app_handle: tauri::AppHandle,
) -> Result<String, String> {
    let root = get_workspace_root(&state, window.label())?;

    let docs: Vec<(String, MergeInput)> = paths
        .iter()
        .map(|p| {
            let page = ops::read_page(&root, p, &registry).map_err(|e| e.to_string())?;
            Ok((
                p.clone(),
                MergeInput {
                    title: page.meta.title,
                    body: page.body,
                    frontmatter: page.meta.frontmatter,
                },
            ))
        })
        .collect::<Result<Vec<_>, String>>()?;

    let result = merge::merge_documents_inner(
        &root,
        &docs,
        Some(&title),
        &ordering,
        output_dir.as_deref(),
    )?;

    registry.record(&root.join(&result.merged_path), &result.merged_content);
    for pr in &result.planned_rewrites.rewrites {
        registry.record(&root.join(&pr.relative_path), &pr.after_content);
    }

    let ann_enabled = crate::preferences::annotations_enabled(&app_handle);
    let gi = {
        let indices = graph_state.indices.lock().unwrap();
        indices.get(&root).cloned()
    };
    if let Some(ref gi) = gi {
        for (path, _) in &result.source_snapshots {
            let _ = gi.remove_file(path, ann_enabled);
        }
        let _ = gi.reindex_file(&result.merged_path, ann_enabled);
        for pr in &result.planned_rewrites.rewrites {
            let _ = gi.reindex_file(&pr.relative_path, ann_enabled);
        }
    }

    if let Ok(oplog) = oplog_state.get_oplog(&root) {
        let store = oplog.lock().unwrap();
        let mut actions: Vec<Action> = Vec::new();
        let mut seq: i64 = 0;

        for pr in &result.planned_rewrites.rewrites {
            actions.push(Action {
                seq,
                action_type: "modify_file".into(),
                path: pr.relative_path.clone(),
                old_path: None,
                before_content: Some(pr.before_content.clone()),
                after_content: Some(pr.after_content.clone()),
            });
            seq += 1;
        }

        actions.push(Action {
            seq,
            action_type: "create_file".into(),
            path: result.merged_path.clone(),
            old_path: None,
            before_content: None,
            after_content: Some(result.merged_content.clone()),
        });
        seq += 1;

        for (path, content) in &result.source_snapshots {
            actions.push(Action {
                seq,
                action_type: "delete_file".into(),
                path: path.clone(),
                old_path: None,
                before_content: Some(content.clone()),
                after_content: None,
            });
            seq += 1;
        }

        let desc = format!(
            "Merge {} documents into '{}'",
            result.source_snapshots.len(),
            title
        );
        let _ = store.record_operation("merge_documents", &desc, &actions);
    }

    Ok(result.merged_path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::oplog::store::OpLogStore;
    use crate::oplog::undo::execute_undo;
    use crate::workspace::write_hash::WriteHashRegistry;
    use tempfile::TempDir;

    fn write_file(dir: &std::path::Path, rel: &str, content: &str) {
        let path = dir.join(rel);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).unwrap();
        }
        std::fs::write(path, content).unwrap();
    }

    #[test]
    fn preview_merge_returns_plan() {
        let docs = vec![
            MergeInputPayload {
                title: "A".to_string(),
                body: "Hello A".to_string(),
                frontmatter: IndexMap::new(),
            },
            MergeInputPayload {
                title: "B".to_string(),
                body: "Hello B".to_string(),
                frontmatter: IndexMap::new(),
            },
        ];
        let plan = preview_merge(docs).unwrap();
        assert_eq!(plan.title, "A + B");
        assert_eq!(plan.source_titles, vec!["A", "B"]);
        assert!(plan.body.contains("Hello A"));
        assert!(plan.body.contains("Hello B"));
    }

    #[test]
    fn preview_split_returns_plan() {
        let content = "## Alpha\nAlpha body.\n## Beta\nBeta body.\n".to_string();
        let title = "My Doc".to_string();
        let fm = IndexMap::new();
        let plan = preview_split(content, title, fm).unwrap();
        assert_eq!(plan.sections.len(), 2);
        assert_eq!(plan.sections[0].title, "Alpha");
        assert_eq!(plan.sections[1].title, "Beta");
    }

    #[test]
    fn preview_split_with_preamble() {
        let content = "Some intro.\n\n## Section\nBody.\n".to_string();
        let title = "Doc".to_string();
        let fm = IndexMap::new();
        let plan = preview_split(content, title, fm).unwrap();
        assert!(plan.preamble.is_some());
        assert_eq!(plan.preamble.unwrap().title, "Doc - Introduction");
        assert_eq!(plan.sections.len(), 1);
    }

    #[test]
    fn merge_documents_oplog_roundtrip() {
        let dir = TempDir::new().unwrap();
        let root = dir.path();
        write_file(root, "A.md", "---\ntags: [rust]\n---\nHello A");
        write_file(root, "B.md", "Hello B");
        write_file(root, "C.md", "Links: [[A]] and [[B]]");

        let a_original = std::fs::read_to_string(root.join("A.md")).unwrap();
        let b_original = std::fs::read_to_string(root.join("B.md")).unwrap();
        let c_original = std::fs::read_to_string(root.join("C.md")).unwrap();

        let docs: Vec<(String, MergeInput)> = vec![
            (
                "A.md".to_string(),
                MergeInput {
                    title: "A".to_string(),
                    body: "Hello A".to_string(),
                    frontmatter: {
                        let mut fm = IndexMap::new();
                        fm.insert(
                            "tags".to_string(),
                            Value::Sequence(vec![Value::String("rust".to_string())]),
                        );
                        fm
                    },
                },
            ),
            (
                "B.md".to_string(),
                MergeInput {
                    title: "B".to_string(),
                    body: "Hello B".to_string(),
                    frontmatter: IndexMap::new(),
                },
            ),
        ];

        let result = merge::merge_documents_inner(root, &docs, Some("Merged"), &[0, 1], None)
            .unwrap();

        assert!(root.join("Merged.md").exists());
        assert!(!root.join("A.md").exists());
        assert!(!root.join("B.md").exists());
        let c_after = std::fs::read_to_string(root.join("C.md")).unwrap();
        assert!(c_after.contains("[[Merged]]"));

        let write_hash_registry = WriteHashRegistry::new();
        let store = OpLogStore::open_memory().unwrap();

        let mut actions: Vec<Action> = Vec::new();
        let mut seq: i64 = 0;

        for pr in &result.planned_rewrites.rewrites {
            actions.push(Action {
                seq,
                action_type: "modify_file".into(),
                path: pr.relative_path.clone(),
                old_path: None,
                before_content: Some(pr.before_content.clone()),
                after_content: Some(pr.after_content.clone()),
            });
            seq += 1;
        }

        actions.push(Action {
            seq,
            action_type: "create_file".into(),
            path: result.merged_path.clone(),
            old_path: None,
            before_content: None,
            after_content: Some(result.merged_content.clone()),
        });
        seq += 1;

        for (path, content) in &result.source_snapshots {
            actions.push(Action {
                seq,
                action_type: "delete_file".into(),
                path: path.clone(),
                old_path: None,
                before_content: Some(content.clone()),
                after_content: None,
            });
            seq += 1;
        }

        store
            .record_operation("merge_documents", "Merge 2 documents into 'Merged'", &actions)
            .unwrap();

        let op = store.pop_latest().unwrap();
        execute_undo(root, &op, &write_hash_registry).unwrap();

        assert!(!root.join("Merged.md").exists());
        assert_eq!(
            std::fs::read_to_string(root.join("A.md")).unwrap(),
            a_original
        );
        assert_eq!(
            std::fs::read_to_string(root.join("B.md")).unwrap(),
            b_original
        );
        assert_eq!(
            std::fs::read_to_string(root.join("C.md")).unwrap(),
            c_original
        );
    }
}
