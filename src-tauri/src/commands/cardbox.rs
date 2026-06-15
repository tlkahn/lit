use std::collections::HashSet;
use std::sync::Arc;
use serde::{Serialize, Deserialize};
use tauri::State;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CardboxLayout {
    pub version: u32,
    pub order: Vec<String>,
}

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

#[tauri::command]
pub fn read_cardbox_layout(
    window: tauri::Window,
    workspace_state: State<crate::commands::workspace::WorkspaceRegistry>,
    graph_state: State<Arc<super::graph::GraphRegistry>>,
) -> Result<CardboxLayout, String> {
    let root = crate::commands::workspace::get_workspace_root(&workspace_state, window.label())?;
    let layout_path = root.join(".lit").join("cardbox.json");

    let mut layout = match std::fs::read_to_string(&layout_path) {
        Ok(content) => serde_json::from_str::<CardboxLayout>(&content)
            .unwrap_or(CardboxLayout { version: 1, order: vec![] }),
        Err(_) => CardboxLayout { version: 1, order: vec![] },
    };

    // Prune stale UUIDs
    super::graph::with_graph_index(&workspace_state, &graph_state, window.label(), |gi| {
        let all_anns = gi.list_all_cardbox_annotations()?;
        let valid_uuids: HashSet<&str> = all_anns.iter().map(|a| a.uuid.as_str()).collect();
        layout.order.retain(|uuid| valid_uuids.contains(uuid.as_str()));
        Ok(())
    })?;

    Ok(layout)
}

#[tauri::command]
pub fn write_cardbox_layout(
    window: tauri::Window,
    workspace_state: State<crate::commands::workspace::WorkspaceRegistry>,
    layout: CardboxLayout,
) -> Result<(), String> {
    let root = crate::commands::workspace::get_workspace_root(&workspace_state, window.label())?;
    let lit_dir = root.join(".lit");
    std::fs::create_dir_all(&lit_dir).map_err(|e| e.to_string())?;

    let layout_path = lit_dir.join("cardbox.json");
    let tmp_path = lit_dir.join(".cardbox.json.tmp");

    let content = serde_json::to_string_pretty(&layout)
        .map_err(|e| e.to_string())?;
    std::fs::write(&tmp_path, &content).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp_path, &layout_path).map_err(|e| e.to_string())?;

    Ok(())
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

    #[test]
    fn cmd_read_cardbox_layout_missing_file() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "<!--- n: _ | note --->");
        let _gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();

        // No .lit/cardbox.json exists
        let layout_path = dir.path().join(".lit").join("cardbox.json");
        assert!(!layout_path.exists());

        // Simulate reading: no file should return empty layout
        let layout = match std::fs::read_to_string(&layout_path) {
            Ok(content) => serde_json::from_str::<super::CardboxLayout>(&content)
                .unwrap_or(super::CardboxLayout { version: 1, order: vec![] }),
            Err(_) => super::CardboxLayout { version: 1, order: vec![] },
        };
        assert_eq!(layout, super::CardboxLayout { version: 1, order: vec![] });
    }

    #[test]
    fn cmd_write_and_read_cardbox_layout_roundtrip() {
        let dir = create_workspace();
        let lit_dir = dir.path().join(".lit");
        std::fs::create_dir_all(&lit_dir).unwrap();

        let layout = super::CardboxLayout {
            version: 1,
            order: vec!["uuid-1".into(), "uuid-2".into(), "uuid-3".into()],
        };

        // Write
        let layout_path = lit_dir.join("cardbox.json");
        let tmp_path = lit_dir.join(".cardbox.json.tmp");
        let content = serde_json::to_string_pretty(&layout).unwrap();
        std::fs::write(&tmp_path, &content).unwrap();
        std::fs::rename(&tmp_path, &layout_path).unwrap();

        // Read back
        let read_content = std::fs::read_to_string(&layout_path).unwrap();
        let read_layout: super::CardboxLayout = serde_json::from_str(&read_content).unwrap();
        assert_eq!(read_layout, layout);
    }

    #[test]
    fn cmd_read_cardbox_layout_prunes_stale_uuids() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "<!--- n: _ | note --->");
        let gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();

        // Get the real UUID of the annotation
        let anns = gi.list_all_cardbox_annotations().unwrap();
        assert_eq!(anns.len(), 1);
        let real_uuid = anns[0].uuid.clone();

        // Write a layout with the real UUID + a stale one
        let lit_dir = dir.path().join(".lit");
        std::fs::create_dir_all(&lit_dir).unwrap();
        let layout = super::CardboxLayout {
            version: 1,
            order: vec!["stale-uuid".into(), real_uuid.clone()],
        };
        std::fs::write(
            lit_dir.join("cardbox.json"),
            serde_json::to_string(&layout).unwrap(),
        ).unwrap();

        // Read and prune
        let layout_path = lit_dir.join("cardbox.json");
        let mut read_layout: super::CardboxLayout = serde_json::from_str(
            &std::fs::read_to_string(&layout_path).unwrap()
        ).unwrap();

        let valid_uuids: std::collections::HashSet<&str> = anns.iter().map(|a| a.uuid.as_str()).collect();
        read_layout.order.retain(|uuid| valid_uuids.contains(uuid.as_str()));

        assert_eq!(read_layout.order, vec![real_uuid]);
    }

    #[test]
    fn cmd_write_cardbox_layout_creates_lit_dir() {
        let dir = create_workspace();
        let lit_dir = dir.path().join(".lit");
        assert!(!lit_dir.exists());

        std::fs::create_dir_all(&lit_dir).unwrap();
        let layout = super::CardboxLayout { version: 1, order: vec!["a".into()] };
        let content = serde_json::to_string_pretty(&layout).unwrap();
        std::fs::write(lit_dir.join("cardbox.json"), &content).unwrap();

        assert!(lit_dir.join("cardbox.json").exists());
        let read: super::CardboxLayout = serde_json::from_str(
            &std::fs::read_to_string(lit_dir.join("cardbox.json")).unwrap()
        ).unwrap();
        assert_eq!(read.order, vec!["a"]);
    }
}
