use std::sync::Arc;
use tauri::State;

#[tauri::command]
pub fn list_all_annotations(
    window: tauri::Window,
    workspace_state: State<crate::commands::workspace::WorkspaceRegistry>,
    graph_state: State<Arc<super::graph::GraphRegistry>>,
) -> Result<serde_json::Value, String> {
    super::graph::with_graph_index(&workspace_state, &graph_state, window.label(), |gi| {
        let results = gi.list_all_cardbox_annotations()?;
        serde_json::to_value(results)
            .map_err(|e| crate::graph::error::GraphError::Other(e.to_string()))
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
    fn cmd_list_all_annotations_empty_workspace() {
        let dir = create_workspace();
        write_md(dir.path(), "empty.md", "no annotations here");
        let gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();
        let results = gi.list_all_cardbox_annotations().unwrap();
        assert!(results.is_empty());
    }

    #[test]
    fn cmd_list_all_annotations_across_pages() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "Some text <!--- n: _ | Silk Road flourished ---> more.");
        write_md(dir.path(), "b.md", "Question <!--- q: _ | What happened? ---> end.");
        write_md(dir.path(), "c.md", "Todo <!--- t: _ | Fix this ---> done.");
        let gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();
        let results = gi.list_all_cardbox_annotations().unwrap();
        assert_eq!(results.len(), 3);
        let page_ids: Vec<&str> = results.iter().map(|r| r.source_page_id.as_str()).collect();
        assert!(page_ids.contains(&"a.md"));
        assert!(page_ids.contains(&"b.md"));
        assert!(page_ids.contains(&"c.md"));
        // Verify fields are populated
        let a = results.iter().find(|r| r.source_page_id == "a.md").unwrap();
        assert_eq!(a.annotation_type, "note");
        assert!(a.body.as_deref().unwrap().contains("Silk Road"));
        assert!(!a.uuid.is_empty());
        assert!(a.original.is_none());
    }

    #[test]
    fn cmd_list_all_annotations_sorted_by_page_then_position() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "<!--- n: _ | first ---> text <!--- q: _ | second --->");
        let gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();
        let results = gi.list_all_cardbox_annotations().unwrap();
        assert_eq!(results.len(), 2);
        assert!(results[0].char_start < results[1].char_start);
    }
}
