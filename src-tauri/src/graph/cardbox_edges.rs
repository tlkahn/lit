use std::collections::{HashMap, HashSet};

use super::error::GraphError;
use super::store::Store;
use super::types::EdgeKind;

pub fn resolve_cross_doc_pair(
    uuid_map: &HashMap<String, String>,
    a: &str,
    b: &str,
) -> Option<(String, String)> {
    let node_a = uuid_map.get(a)?;
    let node_b = uuid_map.get(b)?;
    if node_a == node_b {
        return None;
    }
    if node_a < node_b {
        Some((node_a.clone(), node_b.clone()))
    } else {
        Some((node_b.clone(), node_a.clone()))
    }
}

pub fn sync_cardbox_edges_from_layout(store: &Store, links: &[[String; 2]]) -> Result<(), GraphError> {
    let all_uuids: Vec<&str> = links
        .iter()
        .flat_map(|pair| [pair[0].as_str(), pair[1].as_str()])
        .collect::<HashSet<&str>>()
        .into_iter()
        .collect();

    if all_uuids.is_empty() {
        store.with_savepoint("sync_cardbox", || {
            store.delete_all_cardbox_edges()?;
            Ok(())
        })?;
        return Ok(());
    }

    let uuid_map = store.get_node_ids_for_uuids(&all_uuids)?;

    let mut pairs: HashSet<(String, String)> = HashSet::new();
    for link in links {
        if let Some(pair) = resolve_cross_doc_pair(&uuid_map, &link[0], &link[1]) {
            pairs.insert(pair);
        }
    }

    store.with_savepoint("sync_cardbox", || {
        store.delete_all_cardbox_edges()?;
        for (source, target) in &pairs {
            store.insert_edge(source, target, "", "", 0, EdgeKind::Cardbox)?;
        }
        Ok(())
    })?;

    Ok(())
}

pub fn update_cardbox_edge_after_add(store: &Store, a: &str, b: &str) -> Result<bool, GraphError> {
    let uuid_map = store.get_node_ids_for_uuids(&[a, b])?;
    let pair = match resolve_cross_doc_pair(&uuid_map, a, b) {
        Some(p) => p,
        None => return Ok(false),
    };
    if store.has_cardbox_edge(&pair.0, &pair.1)? {
        return Ok(false);
    }
    store.insert_edge(&pair.0, &pair.1, "", "", 0, EdgeKind::Cardbox)?;
    Ok(true)
}

pub fn update_cardbox_edge_after_remove(
    store: &Store,
    remaining_links: &[[String; 2]],
    a: &str,
    b: &str,
) -> Result<bool, GraphError> {
    let uuid_map_removed = store.get_node_ids_for_uuids(&[a, b])?;
    let removed_pair = match resolve_cross_doc_pair(&uuid_map_removed, a, b) {
        Some(p) => p,
        None => return Ok(false),
    };

    let all_uuids: Vec<&str> = remaining_links
        .iter()
        .flat_map(|pair| [pair[0].as_str(), pair[1].as_str()])
        .collect::<HashSet<&str>>()
        .into_iter()
        .collect();

    let uuid_map = if all_uuids.is_empty() {
        HashMap::new()
    } else {
        store.get_node_ids_for_uuids(&all_uuids)?
    };

    let still_connected = remaining_links.iter().any(|link| {
        resolve_cross_doc_pair(&uuid_map, &link[0], &link[1])
            .map(|p| p == removed_pair)
            .unwrap_or(false)
    });

    if still_connected {
        return Ok(false);
    }

    store.delete_cardbox_edges_between(&removed_pair.0, &removed_pair.1)?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn insert_node(store: &Store, id: &str, title: &str) {
        store.conn.execute(
            "INSERT INTO nodes(id, title, first_paragraph, frontmatter, mtime, is_stub, tags_text, materialization)
             VALUES (?1, ?2, '', '{}', 0, 0, '', 'materialized')",
            rusqlite::params![id, title],
        ).unwrap();
    }

    fn insert_annotation(store: &Store, uuid: &str, node_id: &str) {
        store.conn.execute(
            "INSERT INTO annotations (uuid, node_id, annotation_type, certainty, body, source_line, char_start, char_end, scope_kind, scope_value)
             VALUES (?1, ?2, 'note', '_', 'note body', 0, 0, 0, '_', '')",
            rusqlite::params![uuid, node_id],
        ).unwrap();
    }

    fn setup_two_doc_store() -> (Store, String, String) {
        let store = Store::open_memory().unwrap();

        insert_node(&store, "doc_a.md", "Doc A");
        insert_node(&store, "doc_b.md", "Doc B");

        let uuid_a = "aaaa-1111";
        let uuid_b = "bbbb-2222";
        insert_annotation(&store, uuid_a, "doc_a.md");
        insert_annotation(&store, uuid_b, "doc_b.md");

        (store, uuid_a.to_string(), uuid_b.to_string())
    }

    #[test]
    fn resolve_cross_doc_pair_basic() {
        let mut map = HashMap::new();
        map.insert("u1".to_string(), "doc_a.md".to_string());
        map.insert("u2".to_string(), "doc_b.md".to_string());

        let result = resolve_cross_doc_pair(&map, "u1", "u2");
        assert_eq!(result, Some(("doc_a.md".to_string(), "doc_b.md".to_string())));
    }

    #[test]
    fn resolve_cross_doc_pair_reversed_order() {
        let mut map = HashMap::new();
        map.insert("u1".to_string(), "doc_b.md".to_string());
        map.insert("u2".to_string(), "doc_a.md".to_string());

        let result = resolve_cross_doc_pair(&map, "u1", "u2");
        assert_eq!(result, Some(("doc_a.md".to_string(), "doc_b.md".to_string())));
    }

    #[test]
    fn resolve_same_doc_returns_none() {
        let mut map = HashMap::new();
        map.insert("u1".to_string(), "doc_a.md".to_string());
        map.insert("u2".to_string(), "doc_a.md".to_string());

        assert_eq!(resolve_cross_doc_pair(&map, "u1", "u2"), None);
    }

    #[test]
    fn resolve_missing_uuid_returns_none() {
        let mut map = HashMap::new();
        map.insert("u1".to_string(), "doc_a.md".to_string());

        assert_eq!(resolve_cross_doc_pair(&map, "u1", "u_missing"), None);
        assert_eq!(resolve_cross_doc_pair(&map, "u_missing", "u1"), None);
    }

    #[test]
    fn sync_creates_edges() {
        let (store, uuid_a, uuid_b) = setup_two_doc_store();

        let links = vec![[uuid_a.clone(), uuid_b.clone()]];
        sync_cardbox_edges_from_layout(&store, &links).unwrap();

        assert!(store.has_cardbox_edge("doc_a.md", "doc_b.md").unwrap());
    }

    #[test]
    fn sync_deduplicates_edges() {
        let (store, uuid_a, uuid_b) = setup_two_doc_store();

        let links = vec![
            [uuid_a.clone(), uuid_b.clone()],
            [uuid_b.clone(), uuid_a.clone()],
        ];
        sync_cardbox_edges_from_layout(&store, &links).unwrap();

        let count: i64 = store.conn.query_row(
            "SELECT COUNT(*) FROM edges WHERE edge_kind = 'cardbox'",
            [],
            |row| row.get(0),
        ).unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn sync_deletes_stale_edges() {
        let (store, uuid_a, uuid_b) = setup_two_doc_store();

        let links = vec![[uuid_a.clone(), uuid_b.clone()]];
        sync_cardbox_edges_from_layout(&store, &links).unwrap();
        assert!(store.has_cardbox_edge("doc_a.md", "doc_b.md").unwrap());

        sync_cardbox_edges_from_layout(&store, &[]).unwrap();
        assert!(!store.has_cardbox_edge("doc_a.md", "doc_b.md").unwrap());
    }

    #[test]
    fn add_creates_edge() {
        let (store, uuid_a, uuid_b) = setup_two_doc_store();

        let added = update_cardbox_edge_after_add(&store, &uuid_a, &uuid_b).unwrap();
        assert!(added);
        assert!(store.has_cardbox_edge("doc_a.md", "doc_b.md").unwrap());
    }

    #[test]
    fn add_idempotent() {
        let (store, uuid_a, uuid_b) = setup_two_doc_store();

        assert!(update_cardbox_edge_after_add(&store, &uuid_a, &uuid_b).unwrap());
        assert!(!update_cardbox_edge_after_add(&store, &uuid_a, &uuid_b).unwrap());

        let count: i64 = store.conn.query_row(
            "SELECT COUNT(*) FROM edges WHERE edge_kind = 'cardbox'",
            [],
            |row| row.get(0),
        ).unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn add_same_doc_returns_false() {
        let store = Store::open_memory().unwrap();
        insert_node(&store, "doc_a.md", "Doc A");
        insert_annotation(&store, "aaaa-1111", "doc_a.md");
        store.conn.execute(
            "INSERT INTO annotations (uuid, node_id, annotation_type, certainty, body, source_line, char_start, char_end, scope_kind, scope_value)
             VALUES (?1, ?2, 'note', '_', 'note 2', 0, 10, 10, '_', '')",
            rusqlite::params!["aaaa-2222", "doc_a.md"],
        ).unwrap();

        assert!(!update_cardbox_edge_after_add(&store, "aaaa-1111", "aaaa-2222").unwrap());
    }

    #[test]
    fn remove_deletes_when_last_link() {
        let (store, uuid_a, uuid_b) = setup_two_doc_store();

        update_cardbox_edge_after_add(&store, &uuid_a, &uuid_b).unwrap();
        assert!(store.has_cardbox_edge("doc_a.md", "doc_b.md").unwrap());

        let deleted = update_cardbox_edge_after_remove(&store, &[], &uuid_a, &uuid_b).unwrap();
        assert!(deleted);
        assert!(!store.has_cardbox_edge("doc_a.md", "doc_b.md").unwrap());
    }

    #[test]
    fn remove_keeps_edge_when_other_link_exists() {
        let (store, uuid_a, uuid_b) = setup_two_doc_store();

        let uuid_a2 = "aaaa-3333";
        store.conn.execute(
            "INSERT INTO annotations (uuid, node_id, annotation_type, certainty, body, source_line, char_start, char_end, scope_kind, scope_value)
             VALUES (?1, ?2, 'note', '_', 'note a2', 0, 20, 20, '_', '')",
            rusqlite::params![uuid_a2, "doc_a.md"],
        ).unwrap();

        update_cardbox_edge_after_add(&store, &uuid_a, &uuid_b).unwrap();

        let remaining = vec![[uuid_a2.to_string(), uuid_b.clone()]];
        let deleted = update_cardbox_edge_after_remove(&store, &remaining, &uuid_a, &uuid_b).unwrap();
        assert!(!deleted);
        assert!(store.has_cardbox_edge("doc_a.md", "doc_b.md").unwrap());
    }

    #[test]
    fn remove_missing_uuid_returns_false() {
        let (store, ..) = setup_two_doc_store();
        let deleted = update_cardbox_edge_after_remove(&store, &[], "missing-1", "missing-2").unwrap();
        assert!(!deleted);
    }
}
