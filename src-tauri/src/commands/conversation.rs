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
    title: Option<String>,
) -> Result<serde_json::Value, String> {
    super::graph::with_graph_index(&workspace_state, &graph_state, window.label(), |gi| {
        let row = gi.create_conversation(
            &id,
            &node_id,
            anchor_type.as_deref(),
            anchor_id,
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
