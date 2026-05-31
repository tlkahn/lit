use crate::commands::graph::GraphRegistry;
use crate::commands::oplog::OpLogRegistry;
use crate::commands::workspace::{get_workspace_root, WorkspaceRegistry};
use crate::oplog::store::Action;
use crate::workspace::ops;
use crate::workspace::page::{PageContent, PageMeta};
use crate::workspace::write_hash::WriteHashRegistry;
use indexmap::IndexMap;
use std::sync::Arc;
use tauri::State;

#[tauri::command]
pub fn parse_raw_yaml(raw_yaml: String) -> Result<IndexMap<String, serde_yaml::Value>, String> {
    crate::workspace::frontmatter::parse_raw_yaml(&raw_yaml)
}

#[tauri::command]
pub fn read_page(
    relative_path: String,
    window: tauri::Window,
    state: State<WorkspaceRegistry>,
    registry: State<Arc<WriteHashRegistry>>,
) -> Result<PageContent, String> {
    let root = get_workspace_root(&state, window.label())?;
    ops::read_page(&root, &relative_path, &registry).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn write_page(
    relative_path: String,
    body: String,
    frontmatter: IndexMap<String, serde_yaml::Value>,
    window: tauri::Window,
    state: State<WorkspaceRegistry>,
    registry: State<Arc<WriteHashRegistry>>,
    graph_state: State<Arc<GraphRegistry>>,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    let root = get_workspace_root(&state, window.label())?;
    ops::write_page(&root, &relative_path, &body, &frontmatter, &registry).map_err(|e| e.to_string())?;

    let indices = graph_state.indices.lock().unwrap();
    if let Some(gi) = indices.get(&root) {
        let ann_enabled = crate::preferences::annotations_enabled(&app_handle);
        let result = gi.reindex_file(&relative_path, ann_enabled);
        drop(indices);
        crate::commands::graph::emit_reindex_side_effects(&app_handle, &result);
    }

    Ok(())
}

#[tauri::command]
pub fn create_page(
    name: String,
    parent_dir: Option<String>,
    window: tauri::Window,
    state: State<WorkspaceRegistry>,
    oplog_state: State<Arc<OpLogRegistry>>,
) -> Result<PageMeta, String> {
    let root = get_workspace_root(&state, window.label())?;
    let meta = ops::create_page(&root, &name, parent_dir.as_deref()).map_err(|e| e.to_string())?;

    if let Ok(oplog) = oplog_state.get_oplog(&root) {
        let store = oplog.lock().unwrap();
        let _ = store.record_operation(
            "create_page",
            &format!("Create '{name}'"),
            &[Action {
                seq: 0,
                action_type: "create_file".into(),
                path: meta.relative_path.clone(),
                old_path: None,
                before_content: None,
                after_content: Some(String::new()),
            }],
        );
    }

    Ok(meta)
}

#[tauri::command]
pub fn rename_page(
    old_path: String,
    new_name: String,
    window: tauri::Window,
    state: State<WorkspaceRegistry>,
    oplog_state: State<Arc<OpLogRegistry>>,
) -> Result<String, String> {
    let root = get_workspace_root(&state, window.label())?;
    let new_path = ops::rename_page(&root, &old_path, &new_name).map_err(|e| e.to_string())?;

    if let Ok(oplog) = oplog_state.get_oplog(&root) {
        let store = oplog.lock().unwrap();
        let _ = store.record_operation(
            "rename_page",
            &format!("Rename '{old_path}' to '{new_name}'"),
            &[Action {
                seq: 0,
                action_type: "rename_file".into(),
                path: new_path.clone(),
                old_path: Some(old_path),
                before_content: None,
                after_content: None,
            }],
        );
    }

    Ok(new_path)
}

#[tauri::command]
pub fn delete_page(
    relative_path: String,
    window: tauri::Window,
    state: State<WorkspaceRegistry>,
    oplog_state: State<Arc<OpLogRegistry>>,
) -> Result<(), String> {
    let root = get_workspace_root(&state, window.label())?;

    let before_content = std::fs::read_to_string(root.join(&relative_path)).ok();

    ops::delete_page(&root, &relative_path).map_err(|e| e.to_string())?;

    if let Ok(oplog) = oplog_state.get_oplog(&root) {
        let store = oplog.lock().unwrap();
        let _ = store.record_operation(
            "delete_page",
            &format!("Delete '{relative_path}'"),
            &[Action {
                seq: 0,
                action_type: "delete_file".into(),
                path: relative_path,
                old_path: None,
                before_content,
                after_content: None,
            }],
        );
    }

    Ok(())
}

#[tauri::command]
pub fn rewrite_vault_links(
    window: tauri::Window,
    workspace_state: State<WorkspaceRegistry>,
    graph_state: State<Arc<GraphRegistry>>,
    registry: State<Arc<WriteHashRegistry>>,
    oplog_state: State<Arc<OpLogRegistry>>,
    app_handle: tauri::AppHandle,
    redirects: Vec<crate::graph::rewriter::LinkRedirect>,
) -> Result<crate::graph::rewriter::RewriteSummary, String> {
    let root = get_workspace_root(&workspace_state, window.label())?;

    let planned = {
        let candidate_paths = {
            let indices = graph_state.indices.lock().unwrap();
            indices.get(&root).map(|gi| {
                let stems: Vec<String> = redirects
                    .iter()
                    .map(|r| crate::graph::indexer::normalize_stem(&r.old_target))
                    .collect();
                gi.affected_sources(&stems)
            })
        };
        match candidate_paths {
            Some(ref paths) => crate::graph::rewriter::plan_vault_rewrites_for_paths(&root, &redirects, paths)?,
            None => crate::graph::rewriter::plan_vault_rewrites(&root, &redirects)?,
        }
    };
    if planned.rewrites.is_empty() {
        return Ok(crate::graph::rewriter::RewriteSummary {
            files_scanned: planned.files_scanned,
            files_modified: vec![],
            total_links_changed: 0,
        });
    }

    let summary = crate::graph::rewriter::apply_planned_rewrites(&root, &planned)?;

    let gi = {
        let indices = graph_state.indices.lock().unwrap();
        indices.get(&root).cloned()
    };
    let ann_enabled = crate::preferences::annotations_enabled(&app_handle);

    let mut reindex_err: Option<crate::graph::error::GraphError> = None;
    let mut all_removed: Vec<(String, String)> = Vec::new();
    for pr in &planned.rewrites {
        registry.record(&root.join(&pr.relative_path), &pr.after_content);
        if let Some(ref gi) = gi {
            match gi.reindex_file(&pr.relative_path, ann_enabled) {
                Ok(removed) => all_removed.extend(removed),
                Err(e) => { reindex_err = Some(e); }
            }
        }
    }

    if gi.is_some() {
        let result: Result<(), _> = match reindex_err {
            Some(e) => Err(e),
            None => Ok(()),
        };
        crate::commands::graph::emit_reindex_side_effects_with_removed(&app_handle, &result, &all_removed);
    }

    if let Ok(oplog) = oplog_state.get_oplog(&root) {
        let store = oplog.lock().unwrap();
        let actions: Vec<Action> = planned
            .rewrites
            .iter()
            .enumerate()
            .map(|(i, pr)| Action {
                seq: i as i64,
                action_type: "modify_file".into(),
                path: pr.relative_path.clone(),
                old_path: None,
                before_content: Some(pr.before_content.clone()),
                after_content: Some(pr.after_content.clone()),
            })
            .collect();
        let desc = format!(
            "Rewrite {} link(s) in {} file(s)",
            summary.total_links_changed,
            summary.files_modified.len()
        );
        let _ = store.record_operation("rewrite_vault_links", &desc, &actions);
    }

    Ok(summary)
}

#[tauri::command]
pub fn acknowledge_file_hash(
    relative_path: String,
    window: tauri::Window,
    state: State<WorkspaceRegistry>,
    registry: State<Arc<WriteHashRegistry>>,
) -> Result<(), String> {
    let root = get_workspace_root(&state, window.label())?;
    ops::acknowledge_file_hash(&root, &relative_path, &registry).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use crate::graph::rewriter::{plan_vault_rewrites, apply_planned_rewrites, LinkRedirect};
    use crate::oplog::store::{OpLogStore, Action};

    fn write_file(dir: &std::path::Path, rel: &str, content: &str) {
        let path = dir.join(rel);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).unwrap();
        }
        std::fs::write(path, content).unwrap();
    }

    #[test]
    fn rewrite_vault_links_records_oplog_modify_file() {
        let tmp = tempfile::tempdir().unwrap();
        write_file(tmp.path(), "a.md", "[[OldPage]]");
        write_file(tmp.path(), "b.md", "[[OldPage]] and [[OldPage]]");

        let redirects = vec![LinkRedirect {
            old_target: "OldPage".into(),
            new_target: "NewPage".into(),
        }];
        let planned = plan_vault_rewrites(tmp.path(), &redirects).unwrap();
        let summary = apply_planned_rewrites(tmp.path(), &planned).unwrap();

        let store = OpLogStore::open_memory().unwrap();
        let actions: Vec<Action> = planned
            .rewrites
            .iter()
            .enumerate()
            .map(|(i, pr)| Action {
                seq: i as i64,
                action_type: "modify_file".into(),
                path: pr.relative_path.clone(),
                old_path: None,
                before_content: Some(pr.before_content.clone()),
                after_content: Some(pr.after_content.clone()),
            })
            .collect();
        let desc = format!(
            "Rewrite {} link(s) in {} file(s)",
            summary.total_links_changed,
            summary.files_modified.len()
        );
        store
            .record_operation("rewrite_vault_links", &desc, &actions)
            .unwrap();

        let op = store.pop_latest().unwrap();
        assert_eq!(op.op_type, "rewrite_vault_links");
        assert_eq!(op.description, "Rewrite 3 link(s) in 2 file(s)");
        assert_eq!(op.actions.len(), 2);
        for action in &op.actions {
            assert_eq!(action.action_type, "modify_file");
            assert!(action.before_content.is_some());
            assert!(action.after_content.is_some());
        }
    }

    #[test]
    fn rewrite_vault_links_no_op_no_oplog_entry() {
        let tmp = tempfile::tempdir().unwrap();
        write_file(tmp.path(), "a.md", "[[Other]]");

        let redirects = vec![LinkRedirect {
            old_target: "OldPage".into(),
            new_target: "NewPage".into(),
        }];
        let planned = plan_vault_rewrites(tmp.path(), &redirects).unwrap();
        assert!(planned.rewrites.is_empty());

        let store = OpLogStore::open_memory().unwrap();
        assert!(store.latest_operation().unwrap().is_none());
    }

    #[test]
    fn rewrite_vault_links_empty_redirects_no_op() {
        let tmp = tempfile::tempdir().unwrap();
        write_file(tmp.path(), "a.md", "[[OldPage]]");

        let planned = plan_vault_rewrites(tmp.path(), &[]).unwrap();
        assert_eq!(planned.files_scanned, 0);
        assert!(planned.rewrites.is_empty());
    }
}
