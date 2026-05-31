use std::sync::Arc;
use tauri::State;

#[tauri::command]
pub fn conversation_create(
    window: tauri::Window,
    workspace_state: State<crate::commands::workspace::WorkspaceRegistry>,
    graph_state: State<Arc<super::graph::GraphRegistry>>,
    id: String,
    node_id: String,
    anchor_type: Option<String>,
    anchor_id: Option<i64>,
    anchor_key: Option<String>,
    title: Option<String>,
) -> Result<serde_json::Value, String> {
    super::graph::with_graph_index(&workspace_state, &graph_state, window.label(), |gi| {
        let row = gi.create_conversation(
            &id,
            &node_id,
            anchor_type.as_deref(),
            anchor_id,
            anchor_key.as_deref(),
            title.as_deref(),
        )?;
        Ok(serde_json::to_value(row)?)
    })
}

#[tauri::command]
pub fn conversation_get(
    window: tauri::Window,
    workspace_state: State<crate::commands::workspace::WorkspaceRegistry>,
    graph_state: State<Arc<super::graph::GraphRegistry>>,
    conversation_id: String,
) -> Result<serde_json::Value, String> {
    super::graph::with_graph_index(&workspace_state, &graph_state, window.label(), |gi| {
        let row = gi.get_conversation(&conversation_id)?;
        Ok(serde_json::to_value(row)?)
    })
}

#[tauri::command]
pub fn conversation_list(
    window: tauri::Window,
    workspace_state: State<crate::commands::workspace::WorkspaceRegistry>,
    graph_state: State<Arc<super::graph::GraphRegistry>>,
    node_id: String,
) -> Result<serde_json::Value, String> {
    super::graph::with_graph_index(&workspace_state, &graph_state, window.label(), |gi| {
        let rows = gi.list_conversations(&node_id)?;
        Ok(serde_json::to_value(rows)?)
    })
}

#[tauri::command]
pub fn conversation_delete(
    window: tauri::Window,
    workspace_state: State<crate::commands::workspace::WorkspaceRegistry>,
    graph_state: State<Arc<super::graph::GraphRegistry>>,
    conversation_id: String,
) -> Result<(), String> {
    super::graph::with_graph_index(&workspace_state, &graph_state, window.label(), |gi| {
        gi.delete_conversation(&conversation_id)
    })
}

#[tauri::command]
pub fn conversation_messages(
    window: tauri::Window,
    workspace_state: State<crate::commands::workspace::WorkspaceRegistry>,
    graph_state: State<Arc<super::graph::GraphRegistry>>,
    conversation_id: String,
) -> Result<serde_json::Value, String> {
    super::graph::with_graph_index(&workspace_state, &graph_state, window.label(), |gi| {
        let rows = gi.list_messages(&conversation_id)?;
        Ok(serde_json::to_value(rows)?)
    })
}

#[tauri::command]
pub fn conversation_add_message(
    window: tauri::Window,
    workspace_state: State<crate::commands::workspace::WorkspaceRegistry>,
    graph_state: State<Arc<super::graph::GraphRegistry>>,
    conversation_id: String,
    role: String,
    content: String,
) -> Result<serde_json::Value, String> {
    super::graph::with_graph_index(&workspace_state, &graph_state, window.label(), |gi| {
        let row = gi.add_message(&conversation_id, &role, &content)?;
        Ok(serde_json::to_value(row)?)
    })
}

#[tauri::command]
pub fn conversation_delete_messages_after(
    window: tauri::Window,
    workspace_state: State<crate::commands::workspace::WorkspaceRegistry>,
    graph_state: State<Arc<super::graph::GraphRegistry>>,
    conversation_id: String,
    seq: i32,
) -> Result<(), String> {
    super::graph::with_graph_index(&workspace_state, &graph_state, window.label(), |gi| {
        gi.delete_messages_after(&conversation_id, seq)
    })
}

#[tauri::command]
pub fn conversation_find_by_anchor(
    window: tauri::Window,
    workspace_state: State<crate::commands::workspace::WorkspaceRegistry>,
    graph_state: State<Arc<super::graph::GraphRegistry>>,
    node_id: String,
    anchor_type: String,
    anchor_key: String,
) -> Result<serde_json::Value, String> {
    super::graph::with_graph_index(&workspace_state, &graph_state, window.label(), |gi| {
        let row = gi.find_conversation_by_anchor(&node_id, &anchor_type, &anchor_key)?;
        serde_json::to_value(row)
            .map_err(|e| crate::graph::error::GraphError::Other(e.to_string()))
    })
}

#[tauri::command]
pub fn conversation_delete_by_anchor(
    window: tauri::Window,
    workspace_state: State<crate::commands::workspace::WorkspaceRegistry>,
    graph_state: State<Arc<super::graph::GraphRegistry>>,
    node_id: String,
    anchor_type: String,
    anchor_key: String,
) -> Result<(), String> {
    super::graph::with_graph_index(&workspace_state, &graph_state, window.label(), |gi| {
        gi.delete_conversations_by_anchor(&node_id, &anchor_type, &anchor_key)
    })
}

#[cfg(test)]
mod tests {
    use crate::graph::indexer::GraphIndex;

    fn create_workspace() -> tempfile::TempDir {
        tempfile::tempdir().unwrap()
    }

    fn write_md(root: &std::path::Path, rel_path: &str, content: &str) {
        let abs = root.join(rel_path);
        if let Some(parent) = abs.parent() {
            std::fs::create_dir_all(parent).unwrap();
        }
        std::fs::write(abs, content).unwrap();
    }

    #[test]
    fn cmd_conversation_find_by_anchor() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "# hello");
        let gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();
        gi.create_conversation("c1", "a.md", Some("annotation"), None, Some("uuid-123"), Some("Test")).unwrap();
        let found = gi.find_conversation_by_anchor("a.md", "annotation", "uuid-123").unwrap();
        assert!(found.is_some());
        assert_eq!(found.unwrap().id, "c1");
    }

    #[test]
    fn cmd_conversation_find_by_anchor_missing() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "# hello");
        let gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();
        let found = gi.find_conversation_by_anchor("a.md", "annotation", "no-such-key").unwrap();
        assert!(found.is_none());
    }

    #[test]
    fn cmd_conversation_delete_by_anchor() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "# hello");
        let gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();
        gi.create_conversation("c1", "a.md", Some("annotation"), None, Some("uuid-123"), Some("Test")).unwrap();
        gi.delete_conversations_by_anchor("a.md", "annotation", "uuid-123").unwrap();
        let found = gi.find_conversation_by_anchor("a.md", "annotation", "uuid-123").unwrap();
        assert!(found.is_none());
    }

    #[test]
    fn cmd_conversation_delete_by_anchor_leaves_others() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "# hello");
        let gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();
        gi.create_conversation("c1", "a.md", Some("annotation"), None, Some("uuid-aaa"), Some("First")).unwrap();
        gi.create_conversation("c2", "a.md", Some("annotation"), None, Some("uuid-bbb"), Some("Second")).unwrap();
        gi.delete_conversations_by_anchor("a.md", "annotation", "uuid-aaa").unwrap();
        let gone = gi.find_conversation_by_anchor("a.md", "annotation", "uuid-aaa").unwrap();
        assert!(gone.is_none());
        let kept = gi.find_conversation_by_anchor("a.md", "annotation", "uuid-bbb").unwrap();
        assert!(kept.is_some());
        assert_eq!(kept.unwrap().id, "c2");
    }
}
