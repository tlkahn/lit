use std::sync::Arc;

use indexmap::IndexMap;
use serde::Deserialize;
use serde_yaml::Value;
use tauri::State;

use crate::commands::graph::GraphRegistry;
use crate::commands::oplog::OpLogRegistry;
use crate::commands::workspace::{get_workspace_root, WorkspaceRegistry};
use crate::oplog::store::Action;
use crate::workspace::merge::{self, MergeInput, MergePlan};
use crate::workspace::split::{self, SplitPlan};
use crate::workspace::split_execute;
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
pub fn execute_split(
    relative_path: String,
    window: tauri::Window,
    state: State<WorkspaceRegistry>,
    registry: State<Arc<WriteHashRegistry>>,
    oplog_state: State<Arc<OpLogRegistry>>,
    graph_state: State<Arc<GraphRegistry>>,
    app_handle: tauri::AppHandle,
) -> Result<Vec<String>, String> {
    let root = get_workspace_root(&state, window.label())?;

    let result =
        split_execute::execute_split(&root, &relative_path, &registry).map_err(|e| e.to_string())?;

    let ann_enabled = crate::preferences::annotations_enabled(&app_handle);
    let gi = {
        let indices = graph_state.indices.lock().unwrap();
        indices.get(&root).cloned()
    };

    for path in &result.created_paths {
        if let Some(ref gi) = gi {
            let content = std::fs::read_to_string(root.join(path)).unwrap_or_default();
            registry.record(&root.join(path), &content);
            let _ = gi.reindex_file(path, ann_enabled);
        }
    }

    for pr in &result.rewrite_actions {
        registry.record(&root.join(&pr.relative_path), &pr.after_content);
        if let Some(ref gi) = gi {
            let _ = gi.reindex_file(&pr.relative_path, ann_enabled);
        }
    }

    if let Some(ref gi) = gi {
        let _ = gi.remove_file(&relative_path, ann_enabled);
    }

    if let Ok(oplog) = oplog_state.get_oplog(&root) {
        let store = oplog.lock().unwrap();
        let mut actions: Vec<Action> = Vec::new();
        let mut seq: i64 = 0;

        for path in &result.created_paths {
            let content = std::fs::read_to_string(root.join(path)).unwrap_or_default();
            actions.push(Action {
                seq,
                action_type: "create_file".into(),
                path: path.clone(),
                old_path: None,
                before_content: None,
                after_content: Some(content),
            });
            seq += 1;
        }

        for pr in &result.rewrite_actions {
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
            action_type: "delete_file".into(),
            path: relative_path.clone(),
            old_path: None,
            before_content: Some(
                std::fs::read_to_string(
                    root.join(".trash").join(&result.trash_entry.trash_name),
                )
                .unwrap_or_default(),
            ),
            after_content: None,
        });

        let desc = format!(
            "Split '{}' into {} document(s)",
            relative_path,
            result.created_paths.len()
        );
        let _ = store.record_operation("split_page", &desc, &actions);
    }

    Ok(result.created_paths)
}

#[cfg(test)]
mod tests {
    use super::*;

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
}
