use crate::lkg::types::{BundleAnnotation, BundleEdge, BundleNode};
use serde::Serialize;
use sha2::{Digest, Sha256};

/// Sorts a clone of `items` by the given key extractor, serializes the sorted
/// collection to JSON, and feeds the bytes into `hasher`.
///
/// `serde_json::to_vec` on a `Vec` of these owned bundle structs cannot fail
/// (the field order is fixed and all values are JSON-representable), so the
/// `.expect` is documentation rather than a runtime hazard.
fn hash_sorted<T, K, F>(hasher: &mut Sha256, items: &[T], key: F)
where
    T: Clone + Serialize,
    K: Ord,
    F: Fn(&T) -> K,
{
    let mut items = items.to_vec();
    items.sort_by_key(&key);
    hasher.update(serde_json::to_vec(&items).expect("bundle slice serialize is infallible"));
}

/// Computes a deterministic, order-independent hash over the bundle's graph
/// metadata: nodes, edges, and annotations.
///
/// This hashes graph metadata ONLY — it does NOT hash the file bytes under
/// `content/`, so two bundles with identical graph metadata but different file
/// contents produce the same hash. The result is surfaced as `graph_hash` in
/// the manifest and is not used for bundle-level integrity verification.
///
/// The slices are cloned and sorted by stable keys (nodes by `id`, edges by
/// `(source, target)`, annotations by `(node_id, char_start)`), then each
/// sorted collection is serialized to JSON and fed into a single SHA-256 hasher
/// in a fixed order. The result is returned as `sha256:<lowercase-hex>`.
pub fn compute_graph_hash(
    nodes: &[BundleNode],
    edges: &[BundleEdge],
    annotations: &[BundleAnnotation],
) -> String {
    let mut hasher = Sha256::new();

    hash_sorted(&mut hasher, nodes, |n| n.id.clone());
    hash_sorted(&mut hasher, edges, |e| (e.source.clone(), e.target.clone()));
    hash_sorted(&mut hasher, annotations, |a| {
        (a.node_id.clone(), a.char_start)
    });

    let digest = hasher.finalize();
    format!("sha256:{:x}", digest)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::lkg::types::{BundleAnnotation, BundleEdge, BundleNode};
    use serde_json::json;

    fn node(id: &str, title: &str) -> BundleNode {
        BundleNode {
            id: id.into(),
            title: title.into(),
            first_paragraph: "".into(),
            frontmatter: json!({}),
            is_stub: false,
            tags: vec![],
            aliases: vec![],
        }
    }

    fn edge(source: &str, target: &str) -> BundleEdge {
        BundleEdge {
            source: source.into(),
            target: target.into(),
            context: "".into(),
            raw_target: "".into(),
            source_line: 0,
        }
    }

    fn ann(node_id: &str, char_start: usize) -> BundleAnnotation {
        BundleAnnotation {
            uuid: "uuid-1".into(),
            node_id: node_id.into(),
            annotation_type: "claim".into(),
            certainty: "high".into(),
            body: None,
            date: None,
            source_line: 0,
            char_start,
            char_end: char_start + 1,
            scope_kind: "char".into(),
            scope_value: "x".into(),
        }
    }

    #[test]
    fn compute_graph_hash_is_64_hex_and_deterministic() {
        let nodes = vec![node("a.md", "A"), node("b.md", "B")];
        let edges = vec![edge("a.md", "b.md")];
        let anns = vec![ann("a.md", 0)];

        let result = compute_graph_hash(&nodes, &edges, &anns);
        let again = compute_graph_hash(&nodes, &edges, &anns);

        assert!(result.starts_with("sha256:"));
        let hex = result.strip_prefix("sha256:").unwrap();
        assert_eq!(hex.len(), 64);
        for c in hex.chars() {
            assert!(c.is_ascii_hexdigit());
            assert!(!c.is_ascii_uppercase());
        }
        assert_eq!(result, again);
    }

    #[test]
    fn different_data_yields_different_hash() {
        let nodes = vec![node("a.md", "A"), node("b.md", "B")];
        let edges = vec![edge("a.md", "b.md")];
        let anns = vec![ann("a.md", 0)];
        let base = compute_graph_hash(&nodes, &edges, &anns);

        // Change a node title alone.
        let nodes2 = vec![node("a.md", "A"), node("b.md", "B-changed")];
        assert_ne!(base, compute_graph_hash(&nodes2, &edges, &anns));

        // Add a third node.
        let nodes3 = vec![node("a.md", "A"), node("b.md", "B"), node("c.md", "C")];
        assert_ne!(base, compute_graph_hash(&nodes3, &edges, &anns));

        // Change an edge target alone.
        let edges2 = vec![edge("a.md", "c.md")];
        assert_ne!(base, compute_graph_hash(&nodes, &edges2, &anns));

        // Change an annotation char_end alone.
        let mut ann2 = ann("a.md", 0);
        ann2.char_end = 99;
        let anns2 = vec![ann2];
        assert_ne!(base, compute_graph_hash(&nodes, &edges, &anns2));
    }

    #[test]
    fn order_independent_after_internal_sort() {
        let nodes1 = vec![node("a.md", "A"), node("b.md", "B")];
        let nodes2 = vec![node("b.md", "B"), node("a.md", "A")];

        let edges1 = vec![edge("a.md", "b.md"), edge("b.md", "c.md")];
        let edges2 = vec![edge("b.md", "c.md"), edge("a.md", "b.md")];

        let anns1 = vec![ann("a.md", 0), ann("a.md", 5)];
        let anns2 = vec![ann("a.md", 5), ann("a.md", 0)];

        assert_eq!(
            compute_graph_hash(&nodes1, &edges1, &anns1),
            compute_graph_hash(&nodes2, &edges2, &anns2),
        );
    }

    #[test]
    fn annotation_tiebreak_by_char_start() {
        // Two annotations sharing the same node_id must sort deterministically
        // by char_start, so insertion order does not affect the hash.
        let nodes = vec![node("a.md", "A")];
        let edges: Vec<BundleEdge> = vec![];

        let anns_order1 = vec![ann("a.md", 2), ann("a.md", 9)];
        let anns_order2 = vec![ann("a.md", 9), ann("a.md", 2)];

        assert_eq!(
            compute_graph_hash(&nodes, &edges, &anns_order1),
            compute_graph_hash(&nodes, &edges, &anns_order2),
        );
    }
}
