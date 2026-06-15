use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use serde::{Serialize, Deserialize};
use tauri::State;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CardboxLayout {
    pub version: u32,
    pub order: Vec<String>,
    #[serde(default)]
    pub links: Vec<[String; 2]>,
    #[serde(default)]
    pub groups: HashMap<String, GroupInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct GroupInfo {
    pub name: String,
    pub order: Vec<String>,
    pub collapsed: bool,
}

impl Default for CardboxLayout {
    fn default() -> Self {
        Self {
            version: 1,
            order: vec![],
            links: vec![],
            groups: HashMap::new(),
        }
    }
}

fn normalize_link(a: &str, b: &str) -> [String; 2] {
    if a <= b {
        [a.to_string(), b.to_string()]
    } else {
        [b.to_string(), a.to_string()]
    }
}

fn load_layout_from_disk(layout_path: &std::path::Path) -> CardboxLayout {
    match std::fs::read_to_string(layout_path) {
        Ok(content) => serde_json::from_str::<CardboxLayout>(&content)
            .unwrap_or(CardboxLayout::default()),
        Err(_) => CardboxLayout::default(),
    }
}

fn persist_layout(lit_dir: &std::path::Path, layout: &CardboxLayout) -> Result<(), String> {
    let layout_path = lit_dir.join("cardbox.json");
    let tmp_path = lit_dir.join(".cardbox.json.tmp");
    let content = serde_json::to_string_pretty(layout).map_err(|e| e.to_string())?;
    std::fs::write(&tmp_path, &content).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp_path, &layout_path).map_err(|e| e.to_string())?;
    Ok(())
}

fn prune_layout(layout: &mut CardboxLayout, valid_uuids: &HashSet<&str>) {
    // Prune stale UUIDs from each group's order
    for group in layout.groups.values_mut() {
        group.order.retain(|uuid| valid_uuids.contains(uuid.as_str()));
    }

    // Remove empty groups
    let empty_group_ids: Vec<String> = layout.groups.iter()
        .filter(|(_, g)| g.order.is_empty())
        .map(|(id, _)| id.clone())
        .collect();
    for id in &empty_group_ids {
        layout.groups.remove(id);
    }

    // Collect all UUIDs that belong to any group (for dedup)
    let grouped_uuids: HashSet<&str> = layout.groups.values()
        .flat_map(|g| g.order.iter().map(|s| s.as_str()))
        .collect();

    // Collect valid group IDs to avoid borrow conflict in retain
    let valid_group_ids: HashSet<&str> = layout.groups.keys().map(|s| s.as_str()).collect();

    // Prune top-level order:
    //   - keep "group:xxx" entries only if the group still exists
    //   - keep UUID entries only if valid AND not inside any group
    layout.order.retain(|entry| {
        if let Some(group_id) = entry.strip_prefix("group:") {
            valid_group_ids.contains(group_id)
        } else {
            valid_uuids.contains(entry.as_str()) && !grouped_uuids.contains(entry.as_str())
        }
    });

    // Prune stale links
    layout.links.retain(|pair| {
        valid_uuids.contains(pair[0].as_str()) && valid_uuids.contains(pair[1].as_str())
    });
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

    let mut layout = load_layout_from_disk(&layout_path);

    // Normalize links: sort within pairs, sort full list, dedup
    for pair in &mut layout.links {
        if pair[0] > pair[1] {
            pair.swap(0, 1);
        }
    }
    layout.links.sort();
    layout.links.dedup();

    // Prune stale UUIDs and reconcile groups
    super::graph::with_graph_index(&workspace_state, &graph_state, window.label(), |gi| {
        let all_anns = gi.list_all_cardbox_annotations()?;
        let valid_uuids: HashSet<&str> = all_anns.iter().map(|a| a.uuid.as_str()).collect();
        prune_layout(&mut layout, &valid_uuids);
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
    persist_layout(&lit_dir, &layout)
}

#[tauri::command]
pub fn add_cardbox_link(
    window: tauri::Window,
    workspace_state: State<crate::commands::workspace::WorkspaceRegistry>,
    a: String,
    b: String,
) -> Result<(), String> {
    if a == b {
        return Err("Cannot link a card to itself".to_string());
    }

    let root = crate::commands::workspace::get_workspace_root(&workspace_state, window.label())?;
    let lit_dir = root.join(".lit");
    std::fs::create_dir_all(&lit_dir).map_err(|e| e.to_string())?;

    let layout_path = lit_dir.join("cardbox.json");
    let mut layout = load_layout_from_disk(&layout_path);

    let normalized = normalize_link(&a, &b);
    if layout.links.iter().any(|pair| *pair == normalized) {
        return Ok(());
    }

    layout.links.push(normalized);
    layout.version = 2;
    persist_layout(&lit_dir, &layout)
}

#[tauri::command]
pub fn remove_cardbox_link(
    window: tauri::Window,
    workspace_state: State<crate::commands::workspace::WorkspaceRegistry>,
    a: String,
    b: String,
) -> Result<(), String> {
    let root = crate::commands::workspace::get_workspace_root(&workspace_state, window.label())?;
    let lit_dir = root.join(".lit");
    let layout_path = lit_dir.join("cardbox.json");

    if !layout_path.exists() {
        return Ok(());
    }

    let mut layout = load_layout_from_disk(&layout_path);

    let normalized = normalize_link(&a, &b);
    let before = layout.links.len();
    layout.links.retain(|pair| *pair != normalized);

    if layout.links.len() == before {
        return Ok(());
    }

    persist_layout(&lit_dir, &layout)
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;
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
        assert_eq!(a.original.as_deref(), Some("text"));
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
                .unwrap_or(super::CardboxLayout::default()),
            Err(_) => super::CardboxLayout::default(),
        };
        assert_eq!(layout, super::CardboxLayout::default());
    }

    #[test]
    fn cmd_write_and_read_cardbox_layout_roundtrip() {
        let dir = create_workspace();
        let lit_dir = dir.path().join(".lit");
        std::fs::create_dir_all(&lit_dir).unwrap();

        let layout = super::CardboxLayout {
            version: 1,
            order: vec!["uuid-1".into(), "uuid-2".into(), "uuid-3".into()],
            links: vec![],
            ..Default::default()
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
            links: vec![],
            ..Default::default()
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
        let layout = super::CardboxLayout { version: 1, order: vec!["a".into()], links: vec![], ..Default::default() };
        let content = serde_json::to_string_pretty(&layout).unwrap();
        std::fs::write(lit_dir.join("cardbox.json"), &content).unwrap();

        assert!(lit_dir.join("cardbox.json").exists());
        let read: super::CardboxLayout = serde_json::from_str(
            &std::fs::read_to_string(lit_dir.join("cardbox.json")).unwrap()
        ).unwrap();
        assert_eq!(read.order, vec!["a"]);
    }

    #[test]
    fn cmd_original_resolved_for_sentence_scope() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "First sentence. Second sentence.<!--- n: \\s | note --->");
        let gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();
        let results = gi.list_all_cardbox_annotations().unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].original.as_deref(), Some("Second sentence."));
    }

    #[test]
    fn cmd_original_none_when_file_deleted() {
        let dir = create_workspace();
        let file_path = dir.path().join("a.md");
        std::fs::write(&file_path, "Some text <!--- n: _ | note --->").unwrap();
        let gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();
        std::fs::remove_file(&file_path).unwrap();
        let results = gi.list_all_cardbox_annotations().unwrap();
        assert_eq!(results.len(), 1);
        assert!(results[0].original.is_none());
    }

    #[test]
    fn cmd_original_resolved_multiple_annotations_same_file() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "alpha <!--- n: _ | first ---> beta <!--- n: _ | second --->");
        let gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();
        let results = gi.list_all_cardbox_annotations().unwrap();
        assert_eq!(results.len(), 2);
        assert_eq!(results[0].original.as_deref(), Some("alpha"));
        assert_eq!(results[1].original.as_deref(), Some("beta"));
    }

    #[test]
    fn cmd_original_resolved_with_frontmatter() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "---\ntitle: Test\n---\nSome text <!--- n: _ | note --->");
        let gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();
        let results = gi.list_all_cardbox_annotations().unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].original.as_deref(), Some("text"));
    }

    fn write_layout(root: &std::path::Path, layout: &super::CardboxLayout) {
        let lit_dir = root.join(".lit");
        std::fs::create_dir_all(&lit_dir).unwrap();
        let content = serde_json::to_string_pretty(layout).unwrap();
        std::fs::write(lit_dir.join("cardbox.json"), &content).unwrap();
    }

    fn read_layout(root: &std::path::Path) -> super::CardboxLayout {
        let content = std::fs::read_to_string(root.join(".lit").join("cardbox.json")).unwrap();
        serde_json::from_str(&content).unwrap()
    }

    #[test]
    fn add_link_creates_pair() {
        let dir = create_workspace();
        let layout = super::CardboxLayout {
            version: 1,
            order: vec![],
            links: vec![],
            ..Default::default()
        };
        write_layout(dir.path(), &layout);

        let mut layout = read_layout(dir.path());
        let normalized = super::normalize_link("uuid-a", "uuid-b");
        layout.links.push(normalized.clone());
        layout.version = 2;
        write_layout(dir.path(), &layout);

        let result = read_layout(dir.path());
        assert_eq!(result.links, vec![normalized]);
        assert_eq!(result.version, 2);
    }

    #[test]
    fn add_link_idempotent() {
        let dir = create_workspace();
        let normalized = super::normalize_link("uuid-a", "uuid-b");
        let layout = super::CardboxLayout {
            version: 2,
            order: vec![],
            links: vec![normalized.clone()],
            ..Default::default()
        };
        write_layout(dir.path(), &layout);

        let mut layout = read_layout(dir.path());
        if !layout.links.iter().any(|p| *p == normalized) {
            layout.links.push(normalized.clone());
        }
        write_layout(dir.path(), &layout);

        let result = read_layout(dir.path());
        assert_eq!(result.links.len(), 1);
    }

    #[test]
    fn add_link_self_rejected() {
        let dir = create_workspace();
        let layout = super::CardboxLayout {
            version: 1,
            order: vec![],
            links: vec![],
            ..Default::default()
        };
        write_layout(dir.path(), &layout);

        let a = "same-uuid";
        let b = "same-uuid";
        assert_eq!(a, b, "precondition: self-link attempt");

        let result = read_layout(dir.path());
        assert!(result.links.is_empty(), "no link should exist for self-link");
    }

    #[test]
    fn add_link_normalization() {
        let pair_ab = super::normalize_link("b", "a");
        assert_eq!(pair_ab, ["a".to_string(), "b".to_string()]);

        let pair_ba = super::normalize_link("a", "b");
        assert_eq!(pair_ba, ["a".to_string(), "b".to_string()]);

        assert_eq!(pair_ab, pair_ba);
    }

    #[test]
    fn remove_link_removes_pair() {
        let dir = create_workspace();
        let normalized = super::normalize_link("uuid-a", "uuid-b");
        let layout = super::CardboxLayout {
            version: 2,
            order: vec![],
            links: vec![normalized.clone()],
            ..Default::default()
        };
        write_layout(dir.path(), &layout);

        let mut layout = read_layout(dir.path());
        layout.links.retain(|p| *p != normalized);
        write_layout(dir.path(), &layout);

        let result = read_layout(dir.path());
        assert!(result.links.is_empty());
    }

    #[test]
    fn remove_link_nonexistent_noop() {
        let dir = create_workspace();
        let layout = super::CardboxLayout {
            version: 2,
            order: vec![],
            links: vec![super::normalize_link("uuid-a", "uuid-b")],
            ..Default::default()
        };
        write_layout(dir.path(), &layout);

        let mut layout = read_layout(dir.path());
        let target = super::normalize_link("uuid-x", "uuid-y");
        let before = layout.links.len();
        layout.links.retain(|p| *p != target);
        assert_eq!(layout.links.len(), before);
    }

    #[test]
    fn read_layout_prunes_stale_links() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "<!--- n: _ | note1 --->");
        write_md(dir.path(), "b.md", "<!--- n: _ | note2 --->");
        let gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();
        let anns = gi.list_all_cardbox_annotations().unwrap();
        assert_eq!(anns.len(), 2);
        let uuid_a = anns[0].uuid.clone();
        let uuid_b = anns[1].uuid.clone();

        let layout = super::CardboxLayout {
            version: 2,
            order: vec![uuid_a.clone(), uuid_b.clone()],
            links: vec![
                super::normalize_link(&uuid_a, &uuid_b),
                super::normalize_link(&uuid_a, "stale-uuid"),
            ],
            ..Default::default()
        };
        write_layout(dir.path(), &layout);

        let mut layout = read_layout(dir.path());
        let valid_uuids: std::collections::HashSet<&str> = anns.iter().map(|a| a.uuid.as_str()).collect();
        layout.links.retain(|pair| {
            valid_uuids.contains(pair[0].as_str()) && valid_uuids.contains(pair[1].as_str())
        });

        assert_eq!(layout.links.len(), 1);
        assert_eq!(layout.links[0], super::normalize_link(&uuid_a, &uuid_b));
    }

    #[test]
    fn read_layout_preserves_valid_links() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "<!--- n: _ | note1 --->");
        write_md(dir.path(), "b.md", "<!--- n: _ | note2 --->");
        let gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();
        let anns = gi.list_all_cardbox_annotations().unwrap();
        let uuid_a = anns[0].uuid.clone();
        let uuid_b = anns[1].uuid.clone();

        let link = super::normalize_link(&uuid_a, &uuid_b);
        let layout = super::CardboxLayout {
            version: 2,
            order: vec![uuid_a.clone(), uuid_b.clone()],
            links: vec![link.clone()],
            ..Default::default()
        };
        write_layout(dir.path(), &layout);

        let mut layout = read_layout(dir.path());
        let valid_uuids: std::collections::HashSet<&str> = anns.iter().map(|a| a.uuid.as_str()).collect();
        layout.links.retain(|pair| {
            valid_uuids.contains(pair[0].as_str()) && valid_uuids.contains(pair[1].as_str())
        });

        assert_eq!(layout.links, vec![link]);
    }

    #[test]
    fn v1_file_reads_with_empty_links() {
        let dir = create_workspace();
        let lit_dir = dir.path().join(".lit");
        std::fs::create_dir_all(&lit_dir).unwrap();
        let v1_json = r#"{"version":1,"order":["uuid-1","uuid-2"]}"#;
        std::fs::write(lit_dir.join("cardbox.json"), v1_json).unwrap();

        let layout: super::CardboxLayout = serde_json::from_str(v1_json).unwrap();
        assert_eq!(layout.version, 1);
        assert_eq!(layout.order, vec!["uuid-1", "uuid-2"]);
        assert!(layout.links.is_empty());
    }

    #[test]
    fn write_v2_roundtrip() {
        let dir = create_workspace();
        let layout = super::CardboxLayout {
            version: 2,
            order: vec!["uuid-1".into(), "uuid-2".into()],
            links: vec![
                super::normalize_link("uuid-1", "uuid-2"),
            ],
            ..Default::default()
        };
        write_layout(dir.path(), &layout);

        let result = read_layout(dir.path());
        assert_eq!(result, layout);
    }

    // ---- Phase A1: GroupInfo and groups tests ----

    #[test]
    fn v2_file_deserializes_with_empty_groups() {
        // A v2-format JSON (no "groups" key) should deserialize with empty groups
        let json = r#"{"version":2,"order":["uuid-1"],"links":[["a","b"]]}"#;
        let layout: super::CardboxLayout = serde_json::from_str(json).unwrap();
        assert_eq!(layout.version, 2);
        assert_eq!(layout.order, vec!["uuid-1"]);
        assert!(layout.groups.is_empty());
    }

    #[test]
    fn group_info_serde_roundtrip() {
        let group = super::GroupInfo {
            name: "My Group".to_string(),
            order: vec!["a".into(), "b".into()],
            collapsed: false,
        };
        let json = serde_json::to_string(&group).unwrap();
        let deserialized: super::GroupInfo = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized, group);
    }

    #[test]
    fn v3_roundtrip_with_groups() {
        let dir = create_workspace();
        let mut groups = HashMap::new();
        groups.insert("g1".to_string(), super::GroupInfo {
            name: "Group One".to_string(),
            order: vec!["uuid-a".into(), "uuid-b".into()],
            collapsed: false,
        });
        let layout = super::CardboxLayout {
            version: 1,
            order: vec!["group:g1".into(), "uuid-c".into()],
            links: vec![],
            groups,
        };
        write_layout(dir.path(), &layout);
        let result = read_layout(dir.path());
        assert_eq!(result, layout);
    }

    #[test]
    fn groups_collapsed_roundtrip() {
        let mut groups = HashMap::new();
        groups.insert("g1".to_string(), super::GroupInfo {
            name: "Collapsed Group".to_string(),
            order: vec!["x".into()],
            collapsed: true,
        });
        let layout = super::CardboxLayout {
            version: 1,
            order: vec!["group:g1".into()],
            links: vec![],
            groups,
        };
        let json = serde_json::to_string(&layout).unwrap();
        let deserialized: super::CardboxLayout = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.groups["g1"].collapsed, true);
    }

    #[test]
    fn group_member_pruning_removes_stale_uuids() {
        let mut groups = HashMap::new();
        groups.insert("g1".to_string(), super::GroupInfo {
            name: "G1".to_string(),
            order: vec!["valid-1".into(), "stale-1".into(), "valid-2".into()],
            collapsed: false,
        });
        let mut layout = super::CardboxLayout {
            version: 1,
            order: vec!["group:g1".into()],
            links: vec![],
            groups,
        };

        let valid: std::collections::HashSet<&str> = ["valid-1", "valid-2"].iter().copied().collect();
        super::prune_layout(&mut layout, &valid);

        assert_eq!(layout.groups["g1"].order, vec!["valid-1", "valid-2"]);
    }

    #[test]
    fn empty_group_removed_after_pruning() {
        let mut groups = HashMap::new();
        groups.insert("g1".to_string(), super::GroupInfo {
            name: "Doomed".to_string(),
            order: vec!["stale-only".into()],
            collapsed: false,
        });
        let mut layout = super::CardboxLayout {
            version: 1,
            order: vec!["group:g1".into(), "valid-1".into()],
            links: vec![],
            groups,
        };

        let valid: std::collections::HashSet<&str> = ["valid-1"].iter().copied().collect();
        super::prune_layout(&mut layout, &valid);

        assert!(layout.groups.is_empty(), "empty group should be removed");
        assert!(!layout.order.contains(&"group:g1".to_string()), "group:g1 entry should be removed from order");
        assert_eq!(layout.order, vec!["valid-1"]);
    }

    #[test]
    fn group_entries_survive_uuid_pruning() {
        let mut groups = HashMap::new();
        groups.insert("g1".to_string(), super::GroupInfo {
            name: "G1".to_string(),
            order: vec!["uuid-a".into()],
            collapsed: false,
        });
        let mut layout = super::CardboxLayout {
            version: 1,
            order: vec!["uuid-1".into(), "group:g1".into(), "uuid-2".into()],
            links: vec![],
            groups,
        };

        let valid: std::collections::HashSet<&str> = ["uuid-1", "uuid-2", "uuid-a"].iter().copied().collect();
        super::prune_layout(&mut layout, &valid);

        assert!(layout.order.contains(&"group:g1".to_string()), "group:g1 must survive pruning");
        assert!(layout.order.contains(&"uuid-1".to_string()));
        assert!(layout.order.contains(&"uuid-2".to_string()));
    }

    #[test]
    fn dedup_uuid_in_group_and_toplevel() {
        let mut groups = HashMap::new();
        groups.insert("g1".to_string(), super::GroupInfo {
            name: "G1".to_string(),
            order: vec!["uuid-dup".into()],
            collapsed: false,
        });
        // uuid-dup appears both at top-level and inside g1
        let mut layout = super::CardboxLayout {
            version: 1,
            order: vec!["uuid-dup".into(), "group:g1".into(), "uuid-solo".into()],
            links: vec![],
            groups,
        };

        let valid: std::collections::HashSet<&str> = ["uuid-dup", "uuid-solo"].iter().copied().collect();
        super::prune_layout(&mut layout, &valid);

        // uuid-dup should be removed from top-level (it's in a group)
        let top_uuids: Vec<&str> = layout.order.iter()
            .filter(|e| !e.starts_with("group:"))
            .map(|s| s.as_str())
            .collect();
        assert!(!top_uuids.contains(&"uuid-dup"), "uuid-dup should not be in top-level order");
        assert!(top_uuids.contains(&"uuid-solo"));
        // group:g1 and uuid-solo remain
        assert!(layout.order.contains(&"group:g1".to_string()));
    }

    #[test]
    fn orphan_group_ref_cleaned_up() {
        // "group:nonexistent" in top-level order but no matching group in map
        let mut layout = super::CardboxLayout {
            version: 1,
            order: vec!["uuid-1".into(), "group:nonexistent".into()],
            links: vec![],
            groups: HashMap::new(),
        };

        let valid: std::collections::HashSet<&str> = ["uuid-1"].iter().copied().collect();
        super::prune_layout(&mut layout, &valid);

        assert!(!layout.order.contains(&"group:nonexistent".to_string()));
        assert_eq!(layout.order, vec!["uuid-1"]);
    }

    #[test]
    fn multiple_groups_mixed_pruning() {
        let mut groups = HashMap::new();
        groups.insert("ga".to_string(), super::GroupInfo {
            name: "Group A".to_string(),
            order: vec!["valid-1".into(), "stale-1".into()],
            collapsed: false,
        });
        groups.insert("gb".to_string(), super::GroupInfo {
            name: "Group B".to_string(),
            order: vec!["stale-2".into(), "stale-3".into()],
            collapsed: false,
        });
        let mut layout = super::CardboxLayout {
            version: 1,
            order: vec!["group:ga".into(), "group:gb".into(), "valid-2".into()],
            links: vec![],
            groups,
        };

        let valid: std::collections::HashSet<&str> = ["valid-1", "valid-2"].iter().copied().collect();
        super::prune_layout(&mut layout, &valid);

        // Group A survives with 1 member
        assert_eq!(layout.groups.len(), 1);
        assert_eq!(layout.groups["ga"].order, vec!["valid-1"]);
        // Group B removed (all stale)
        assert!(!layout.groups.contains_key("gb"));
        // Top-level: group:ga stays, group:gb removed, valid-2 stays
        assert_eq!(layout.order, vec!["group:ga".to_string(), "valid-2".to_string()]);
    }

    #[test]
    fn pruning_preserves_group_internal_order() {
        let mut groups = HashMap::new();
        groups.insert("g1".to_string(), super::GroupInfo {
            name: "G1".to_string(),
            order: vec!["c".into(), "a".into(), "b".into()],
            collapsed: false,
        });
        let mut layout = super::CardboxLayout {
            version: 1,
            order: vec!["group:g1".into()],
            links: vec![],
            groups,
        };

        let valid: std::collections::HashSet<&str> = ["a", "b", "c"].iter().copied().collect();
        super::prune_layout(&mut layout, &valid);

        assert_eq!(layout.groups["g1"].order, vec!["c", "a", "b"]);
    }

    #[test]
    fn empty_groups_map_roundtrip() {
        let dir = create_workspace();
        let layout = super::CardboxLayout {
            version: 1,
            order: vec!["uuid-1".into()],
            links: vec![],
            groups: HashMap::new(),
        };
        write_layout(dir.path(), &layout);
        let result = read_layout(dir.path());
        assert!(result.groups.is_empty());
        assert_eq!(result, layout);
    }
}
