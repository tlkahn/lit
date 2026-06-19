use std::collections::{HashMap, HashSet};

use super::error::GraphError;
use super::store::Store;
use super::types::EdgeKind;
use crate::commands::cardbox::CardboxLayout;

/// Resolve two annotation UUIDs to their owning document node IDs.
/// Returns `Ok(None)` if either UUID is unknown or both belong to the same document.
fn resolve_cross_doc_pair(
    store: &Store,
    uuid_a: &str,
    uuid_b: &str,
) -> Result<Option<(String, String)>, GraphError> {
    let node_a = match store.get_node_id_for_uuid(uuid_a)? {
        Some(id) => id,
        None => return Ok(None),
    };
    let node_b = match store.get_node_id_for_uuid(uuid_b)? {
        Some(id) => id,
        None => return Ok(None),
    };
    if node_a == node_b {
        return Ok(None);
    }
    Ok(Some((node_a, node_b)))
}

/// Bulk sync: delete all cardbox edges and re-insert one per unique
/// cross-document pair found in the layout's links.
pub fn sync_cardbox_edges_from_layout(
    store: &Store,
    layout: &CardboxLayout,
) -> Result<(), GraphError> {
    store.delete_cardbox_edges()?;

    let mut seen_pairs: HashSet<(String, String)> = HashSet::new();

    for link in &layout.links {
        let (node_a, node_b) = match resolve_cross_doc_pair(store, &link[0], &link[1])? {
            Some(pair) => pair,
            None => continue,
        };

        // Normalize pair order for dedup
        let pair = if node_a < node_b {
            (node_a.clone(), node_b.clone())
        } else {
            (node_b.clone(), node_a.clone())
        };

        if seen_pairs.insert(pair.clone()) {
            store.insert_edge(&pair.0, &pair.1, "", "", 0, EdgeKind::Cardbox)?;
        }
    }

    Ok(())
}

/// Incremental add: insert a cardbox edge between two annotations' documents
/// if they belong to different documents and no edge exists yet.
/// Returns true if an edge was added.
pub fn update_cardbox_edge_after_add(
    store: &Store,
    uuid_a: &str,
    uuid_b: &str,
) -> Result<bool, GraphError> {
    let (node_a, node_b) = match resolve_cross_doc_pair(store, uuid_a, uuid_b)? {
        Some(pair) => pair,
        None => {
            tracing::debug!(uuid_a, uuid_b, "cardbox edge add: UUIDs unresolved or same document");
            return Ok(false);
        }
    };

    if store.has_cardbox_edge(&node_a, &node_b)? {
        tracing::debug!(node_a = %node_a, node_b = %node_b, "cardbox edge add: edge already exists");
        return Ok(false);
    }

    // Normalize order for consistency
    let (a, b) = if node_a < node_b {
        (node_a, node_b)
    } else {
        (node_b, node_a)
    };

    tracing::info!(source = %a, target = %b, "inserting cardbox edge");
    store.insert_edge(&a, &b, "", "", 0, EdgeKind::Cardbox)?;
    Ok(true)
}

/// Incremental remove: delete a cardbox edge between two annotations' documents
/// only if no remaining links in the layout still connect those same two documents.
/// Returns true if an edge was removed.
pub fn update_cardbox_edge_after_remove(
    store: &Store,
    layout: &CardboxLayout,
    uuid_a: &str,
    uuid_b: &str,
) -> Result<bool, GraphError> {
    let (node_a, node_b) = match resolve_cross_doc_pair(store, uuid_a, uuid_b)? {
        Some(pair) => pair,
        None => return Ok(false),
    };

    // Pre-build a lookup cache: resolve each unique UUID from layout.links
    // once, avoiding 2*k DB queries in the loop below.
    let mut uuid_to_node: HashMap<&str, Option<String>> = HashMap::new();
    for link in &layout.links {
        for uuid in link {
            uuid_to_node
                .entry(uuid.as_str())
                .or_insert_with(|| store.get_node_id_for_uuid(uuid).unwrap_or(None));
        }
    }

    // Check if any remaining link in the layout still connects these two documents
    for link in &layout.links {
        let other_a = match uuid_to_node.get(link[0].as_str()).and_then(|v| v.as_deref()) {
            Some(id) => id,
            None => continue,
        };
        let other_b = match uuid_to_node.get(link[1].as_str()).and_then(|v| v.as_deref()) {
            Some(id) => id,
            None => continue,
        };

        // Same document pair (either direction)?
        if (other_a == node_a && other_b == node_b)
            || (other_a == node_b && other_b == node_a)
        {
            // Another link still connects these docs -- keep the edge
            return Ok(false);
        }
    }

    store.delete_cardbox_edge_between(&node_a, &node_b)?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::graph::store::Store;
    use crate::graph::types::{EdgeKind, IndexableAnnotation, ParsedNode};
    use crate::commands::cardbox::CardboxLayout;

    /// Helper: open in-memory store, insert two nodes with annotations having known UUIDs.
    fn setup_two_doc_store() -> (Store, String, String) {
        let store = Store::open_memory().unwrap();

        let node_a = ParsedNode {
            id: "doc_a.md".to_string(),
            title: "Doc A".to_string(),
            first_paragraph: String::new(),
            frontmatter: serde_json::Value::Object(Default::default()),
            tags: vec![],
        };
        let node_b = ParsedNode {
            id: "doc_b.md".to_string(),
            title: "Doc B".to_string(),
            first_paragraph: String::new(),
            frontmatter: serde_json::Value::Object(Default::default()),
            tags: vec![],
        };
        store.upsert_node(&node_a, 1).unwrap();
        store.upsert_node(&node_b, 1).unwrap();

        let uuid_a = "aaaa-1111".to_string();
        let uuid_b = "bbbb-2222".to_string();

        let ann_a = IndexableAnnotation {
            annotation_type: "note".to_string(),
            certainty: "certain".to_string(),
            body: Some("note in A".to_string()),
            date: None,
            source_line: 1,
            char_start: 0,
            char_end: 10,
            scope_kind: "block".to_string(),
            scope_value: "_".to_string(),
            uuid: Some(uuid_a.clone()),
        };
        let ann_b = IndexableAnnotation {
            annotation_type: "note".to_string(),
            certainty: "certain".to_string(),
            body: Some("note in B".to_string()),
            date: None,
            source_line: 1,
            char_start: 0,
            char_end: 10,
            scope_kind: "block".to_string(),
            scope_value: "_".to_string(),
            uuid: Some(uuid_b.clone()),
        };

        store.upsert_annotations("doc_a.md", &[ann_a]).unwrap();
        store.upsert_annotations("doc_b.md", &[ann_b]).unwrap();

        (store, uuid_a, uuid_b)
    }

    fn make_annotation(uuid: &str, char_start: usize, char_end: usize) -> IndexableAnnotation {
        IndexableAnnotation {
            annotation_type: "note".to_string(),
            certainty: "certain".to_string(),
            body: Some(format!("note {}", uuid)),
            date: None,
            source_line: 1,
            char_start,
            char_end,
            scope_kind: "block".to_string(),
            scope_value: "_".to_string(),
            uuid: Some(uuid.to_string()),
        }
    }

    fn make_node(id: &str, title: &str) -> ParsedNode {
        ParsedNode {
            id: id.to_string(),
            title: title.to_string(),
            first_paragraph: String::new(),
            frontmatter: serde_json::Value::Object(Default::default()),
            tags: vec![],
        }
    }

    fn count_cardbox_edges(store: &Store) -> usize {
        store
            .all_edges_full()
            .unwrap()
            .iter()
            .filter(|e| e.5 == EdgeKind::Cardbox)
            .count()
    }

    // ---- sync_cardbox_edges_from_layout tests ----

    #[test]
    fn sync_empty_layout_no_edges() {
        let (store, _uuid_a, _uuid_b) = setup_two_doc_store();
        let layout = CardboxLayout::default();

        sync_cardbox_edges_from_layout(&store, &layout).unwrap();

        assert_eq!(count_cardbox_edges(&store), 0);
    }

    #[test]
    fn sync_creates_cross_doc_edge() {
        let (store, uuid_a, uuid_b) = setup_two_doc_store();
        let layout = CardboxLayout {
            links: vec![[uuid_a, uuid_b]],
            ..Default::default()
        };

        sync_cardbox_edges_from_layout(&store, &layout).unwrap();

        let edges = store.all_edges_full().unwrap();
        let cardbox_edges: Vec<_> = edges
            .iter()
            .filter(|e| e.5 == EdgeKind::Cardbox)
            .collect();
        assert_eq!(cardbox_edges.len(), 1);
        assert_eq!(cardbox_edges[0].0, "doc_a.md");
        assert_eq!(cardbox_edges[0].1, "doc_b.md");
    }

    #[test]
    fn sync_skips_same_document_link() {
        let store = Store::open_memory().unwrap();
        store.upsert_node(&make_node("doc.md", "Doc"), 1).unwrap();

        store
            .upsert_annotations(
                "doc.md",
                &[
                    make_annotation("same-doc-1", 0, 5),
                    make_annotation("same-doc-2", 10, 15),
                ],
            )
            .unwrap();

        let layout = CardboxLayout {
            links: vec![["same-doc-1".to_string(), "same-doc-2".to_string()]],
            ..Default::default()
        };

        sync_cardbox_edges_from_layout(&store, &layout).unwrap();

        assert_eq!(
            count_cardbox_edges(&store),
            0,
            "same-document link should not create edge"
        );
    }

    #[test]
    fn sync_deduplicates_document_pairs() {
        let (store, uuid_a, uuid_b) = setup_two_doc_store();

        // Add a second annotation in doc_a
        store
            .upsert_annotations(
                "doc_a.md",
                &[
                    make_annotation(&uuid_a, 0, 10),
                    make_annotation("aaaa-3333", 20, 30),
                ],
            )
            .unwrap();

        // Two links between doc_a and doc_b (different UUID pairs, same document pair)
        let layout = CardboxLayout {
            links: vec![
                [uuid_a, uuid_b.clone()],
                ["aaaa-3333".to_string(), uuid_b],
            ],
            ..Default::default()
        };

        sync_cardbox_edges_from_layout(&store, &layout).unwrap();

        assert_eq!(
            count_cardbox_edges(&store),
            1,
            "duplicate doc pairs should produce one edge"
        );
    }

    #[test]
    fn sync_skips_unknown_uuid() {
        let (store, uuid_a, _uuid_b) = setup_two_doc_store();
        let layout = CardboxLayout {
            links: vec![[uuid_a, "unknown-uuid".to_string()]],
            ..Default::default()
        };

        sync_cardbox_edges_from_layout(&store, &layout).unwrap();

        assert_eq!(count_cardbox_edges(&store), 0);
    }

    #[test]
    fn sync_deletes_old_cardbox_edges_first() {
        let (store, _uuid_a, _uuid_b) = setup_two_doc_store();

        // Pre-insert a cardbox edge
        store
            .insert_edge("doc_a.md", "doc_b.md", "", "", 0, EdgeKind::Cardbox)
            .unwrap();
        assert!(store.has_cardbox_edge("doc_a.md", "doc_b.md").unwrap());

        // Sync with empty layout should remove it
        let layout = CardboxLayout::default();
        sync_cardbox_edges_from_layout(&store, &layout).unwrap();

        assert!(!store.has_cardbox_edge("doc_a.md", "doc_b.md").unwrap());
    }

    // ---- update_cardbox_edge_after_add tests ----

    #[test]
    fn add_creates_edge_for_cross_doc() {
        let (store, uuid_a, uuid_b) = setup_two_doc_store();

        let added = update_cardbox_edge_after_add(&store, &uuid_a, &uuid_b).unwrap();
        assert!(added);
        assert!(store.has_cardbox_edge("doc_a.md", "doc_b.md").unwrap());
    }

    #[test]
    fn add_returns_false_for_same_doc() {
        let store = Store::open_memory().unwrap();
        store.upsert_node(&make_node("doc.md", "Doc"), 1).unwrap();

        store
            .upsert_annotations(
                "doc.md",
                &[make_annotation("u1", 0, 5), make_annotation("u2", 10, 15)],
            )
            .unwrap();

        let added = update_cardbox_edge_after_add(&store, "u1", "u2").unwrap();
        assert!(!added);
    }

    #[test]
    fn add_returns_false_for_unknown_uuid() {
        let (store, uuid_a, _uuid_b) = setup_two_doc_store();

        let added = update_cardbox_edge_after_add(&store, &uuid_a, "nonexistent").unwrap();
        assert!(!added);
    }

    #[test]
    fn add_returns_false_if_edge_already_exists() {
        let (store, uuid_a, uuid_b) = setup_two_doc_store();

        let first = update_cardbox_edge_after_add(&store, &uuid_a, &uuid_b).unwrap();
        assert!(first);

        let second = update_cardbox_edge_after_add(&store, &uuid_a, &uuid_b).unwrap();
        assert!(!second);
    }

    // ---- update_cardbox_edge_after_remove tests ----

    #[test]
    fn remove_deletes_edge_when_no_remaining_links() {
        let (store, uuid_a, uuid_b) = setup_two_doc_store();

        store
            .insert_edge("doc_a.md", "doc_b.md", "", "", 0, EdgeKind::Cardbox)
            .unwrap();

        // Empty layout = no remaining links
        let layout = CardboxLayout::default();

        let removed =
            update_cardbox_edge_after_remove(&store, &layout, &uuid_a, &uuid_b).unwrap();
        assert!(removed);
        assert!(!store.has_cardbox_edge("doc_a.md", "doc_b.md").unwrap());
    }

    #[test]
    fn remove_keeps_edge_when_other_links_remain() {
        let (store, uuid_a, uuid_b) = setup_two_doc_store();

        // Add a second annotation in doc_a
        store
            .upsert_annotations(
                "doc_a.md",
                &[
                    make_annotation(&uuid_a, 0, 10),
                    make_annotation("aaaa-extra", 20, 30),
                ],
            )
            .unwrap();

        store
            .insert_edge("doc_a.md", "doc_b.md", "", "", 0, EdgeKind::Cardbox)
            .unwrap();

        // Layout still has a remaining link between the same two docs
        let layout = CardboxLayout {
            links: vec![["aaaa-extra".to_string(), uuid_b.clone()]],
            ..Default::default()
        };

        let removed =
            update_cardbox_edge_after_remove(&store, &layout, &uuid_a, &uuid_b).unwrap();
        assert!(
            !removed,
            "edge should remain because another link connects same docs"
        );
        assert!(store.has_cardbox_edge("doc_a.md", "doc_b.md").unwrap());
    }

    #[test]
    fn remove_returns_false_for_same_doc() {
        let store = Store::open_memory().unwrap();
        store.upsert_node(&make_node("doc.md", "Doc"), 1).unwrap();

        store
            .upsert_annotations(
                "doc.md",
                &[make_annotation("s1", 0, 5), make_annotation("s2", 10, 15)],
            )
            .unwrap();

        let layout = CardboxLayout::default();
        let removed = update_cardbox_edge_after_remove(&store, &layout, "s1", "s2").unwrap();
        assert!(!removed);
    }

    #[test]
    fn remove_returns_false_for_unknown_uuid() {
        let (store, uuid_a, _uuid_b) = setup_two_doc_store();
        let layout = CardboxLayout::default();

        let removed =
            update_cardbox_edge_after_remove(&store, &layout, &uuid_a, "ghost").unwrap();
        assert!(!removed);
    }

    #[test]
    fn remove_with_many_links_sharing_uuids() {
        // Regression test: multiple links share the same UUIDs.
        // The HashMap-based lookup should resolve each unique UUID only once.
        let store = Store::open_memory().unwrap();
        store.upsert_node(&make_node("doc_a.md", "Doc A"), 1).unwrap();
        store.upsert_node(&make_node("doc_b.md", "Doc B"), 1).unwrap();
        store.upsert_node(&make_node("doc_c.md", "Doc C"), 1).unwrap();

        store
            .upsert_annotations(
                "doc_a.md",
                &[
                    make_annotation("a1", 0, 5),
                    make_annotation("a2", 10, 15),
                    make_annotation("a3", 20, 25),
                ],
            )
            .unwrap();
        store
            .upsert_annotations(
                "doc_b.md",
                &[
                    make_annotation("b1", 0, 5),
                    make_annotation("b2", 10, 15),
                ],
            )
            .unwrap();
        store
            .upsert_annotations("doc_c.md", &[make_annotation("c1", 0, 5)])
            .unwrap();

        // Edge between doc_a and doc_b
        store
            .insert_edge("doc_a.md", "doc_b.md", "", "", 0, EdgeKind::Cardbox)
            .unwrap();

        // Layout has multiple links between doc_a and doc_b (sharing UUIDs),
        // plus a link to doc_c
        let layout = CardboxLayout {
            links: vec![
                ["a1".to_string(), "b1".to_string()],
                ["a2".to_string(), "b2".to_string()],
                ["a3".to_string(), "b1".to_string()], // reuses b1
                ["a1".to_string(), "c1".to_string()],
            ],
            ..Default::default()
        };

        // Removing a1<->b1 should NOT delete the edge because a2<->b2
        // and a3<->b1 still connect the same doc pair
        let removed =
            update_cardbox_edge_after_remove(&store, &layout, "a1", "b1").unwrap();
        assert!(
            !removed,
            "edge should remain because other links connect same docs"
        );
        assert!(store.has_cardbox_edge("doc_a.md", "doc_b.md").unwrap());
    }

    #[test]
    fn remove_deletes_edge_when_remaining_links_connect_different_docs() {
        // Remaining links exist but connect different document pairs,
        // so the edge for the removed pair should be deleted.
        let store = Store::open_memory().unwrap();
        store.upsert_node(&make_node("doc_a.md", "Doc A"), 1).unwrap();
        store.upsert_node(&make_node("doc_b.md", "Doc B"), 1).unwrap();
        store.upsert_node(&make_node("doc_c.md", "Doc C"), 1).unwrap();

        store
            .upsert_annotations("doc_a.md", &[make_annotation("a1", 0, 5)])
            .unwrap();
        store
            .upsert_annotations("doc_b.md", &[make_annotation("b1", 0, 5)])
            .unwrap();
        store
            .upsert_annotations("doc_c.md", &[make_annotation("c1", 0, 5)])
            .unwrap();

        store
            .insert_edge("doc_a.md", "doc_b.md", "", "", 0, EdgeKind::Cardbox)
            .unwrap();

        // Only remaining link is a1<->c1 (different doc pair)
        let layout = CardboxLayout {
            links: vec![["a1".to_string(), "c1".to_string()]],
            ..Default::default()
        };

        let removed =
            update_cardbox_edge_after_remove(&store, &layout, "a1", "b1").unwrap();
        assert!(removed, "edge should be removed because no remaining link connects doc_a and doc_b");
        assert!(!store.has_cardbox_edge("doc_a.md", "doc_b.md").unwrap());
    }

    #[test]
    fn remove_handles_unknown_uuids_in_remaining_links() {
        // Some links in the layout reference unknown UUIDs -- they should be
        // skipped gracefully, and not prevent correct removal.
        let (store, uuid_a, uuid_b) = setup_two_doc_store();

        store
            .insert_edge("doc_a.md", "doc_b.md", "", "", 0, EdgeKind::Cardbox)
            .unwrap();

        // Layout has links with unknown UUIDs -- none connect the same doc pair
        let layout = CardboxLayout {
            links: vec![
                ["ghost-1".to_string(), uuid_b.clone()],
                [uuid_a.clone(), "ghost-2".to_string()],
            ],
            ..Default::default()
        };

        let removed =
            update_cardbox_edge_after_remove(&store, &layout, &uuid_a, &uuid_b).unwrap();
        assert!(removed, "edge should be removed because no valid remaining link connects the docs");
    }
}
