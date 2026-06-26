//! Pure helper functions backing the future `merge_to_draft` command.
//!
//! These cover four domains, each independently testable without file I/O or
//! Tauri wiring:
//!   1. annotation resolution by UUID (preserving request order),
//!   2. link-topology ordering via BFS over the selected set,
//!   3. citekey lookup from a page's frontmatter,
//!   4. markdown draft body / frontmatter construction.
//!
//! These are the building blocks for a future `merge_to_draft` Tauri command;
//! until that command lands they have no non-test caller, hence the
//! module-level `dead_code` allowance.
#![allow(dead_code)]

use std::collections::{HashMap, HashSet, VecDeque};

use crate::graph::store::Store;
use crate::graph::types::CardboxAnnotation;

use super::escape_yaml_double_quoted;

/// Resolve the requested `uuids` against the pre-fetched annotation list,
/// returning clones in request order. Errors if any UUID is missing.
///
/// Takes the annotation slice (not `&GraphIndex`) so it stays pure and
/// testable; the caller fetches via `gi.list_all_cardbox_annotations()`.
pub(crate) fn resolve_annotations_by_uuid(
    all_annotations: &[CardboxAnnotation],
    uuids: &[String],
) -> Result<Vec<CardboxAnnotation>, String> {
    let by_uuid: HashMap<&str, &CardboxAnnotation> = all_annotations
        .iter()
        .map(|a| (a.uuid.as_str(), a))
        .collect();
    let mut result = Vec::with_capacity(uuids.len());
    for uuid in uuids {
        match by_uuid.get(uuid.as_str()) {
            Some(ann) => result.push((*ann).clone()),
            None => return Err(format!("Annotation not found: {}", uuid)),
        }
    }
    Ok(result)
}

/// Order the selected `uuids` by link topology: build an undirected adjacency
/// from `links` restricted to the selected set, BFS from `uuids[0]`, then
/// append any unreached UUIDs in their original order.
pub(crate) fn order_by_links(uuids: &[String], links: &[[String; 2]]) -> Vec<String> {
    if uuids.is_empty() {
        return Vec::new();
    }

    let set: HashSet<&str> = uuids.iter().map(|s| s.as_str()).collect();
    let mut adj: HashMap<&str, Vec<&str>> = HashMap::new();
    for link in links {
        let (a, b) = (link[0].as_str(), link[1].as_str());
        if set.contains(a) && set.contains(b) {
            adj.entry(a).or_default().push(b);
            adj.entry(b).or_default().push(a);
        }
    }

    let mut visited: HashSet<&str> = HashSet::new();
    let mut result: Vec<String> = Vec::with_capacity(uuids.len());
    let mut queue: VecDeque<&str> = VecDeque::new();

    let start = uuids[0].as_str();
    visited.insert(start);
    queue.push_back(start);
    while let Some(node) = queue.pop_front() {
        result.push(node.to_string());
        if let Some(neighbors) = adj.get(node) {
            for &n in neighbors {
                if visited.insert(n) {
                    queue.push_back(n);
                }
            }
        }
    }

    // Append UUIDs the BFS never reached, preserving original selection order.
    for uuid in uuids {
        if !visited.contains(uuid.as_str()) {
            result.push(uuid.clone());
        }
    }

    result
}

/// Look up a page's `citekey` from its frontmatter. Returns `Ok(None)` when the
/// page exists without a citekey or when the page row is absent.
///
/// Mirrors the `citekeys_of_pages` pattern in `indexer.rs` — the
/// `json_extract` yields `NULL` (outer `None`) for a missing row and a JSON
/// `null` (inner `None`) for a missing key, both flattened away.
pub(crate) fn citekey_for_page(store: &Store, page_id: &str) -> Result<Option<String>, String> {
    use rusqlite::OptionalExtension;
    let citekey: Option<Option<String>> = store
        .conn
        .query_row(
            "SELECT json_extract(frontmatter, '$.citekey') FROM nodes WHERE id = ?1",
            [page_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    Ok(citekey.flatten())
}

/// A selected annotation paired with its (optional) slip note and citekey,
/// ready to be rendered into the draft body.
#[derive(Debug, Clone)]
pub(crate) struct ResolvedCard {
    pub annotation: CardboxAnnotation,
    pub slip_note: Option<String>,
    pub citekey: Option<String>,
}

/// Build the markdown draft body. Cards are grouped by `source_page_id`
/// (first-seen order preserved); each group gets one `## Source Page Title`
/// heading. Per card: the `original` as a blockquote with a
/// `> — [[Title]]` attribution line (plus `[@citekey]` when present), then the
/// slip note prose. Cards without an `original` skip the blockquote; cards
/// without a slip note skip the prose.
pub(crate) fn build_draft_body(cards: &[ResolvedCard]) -> String {
    use indexmap::IndexMap;

    let mut groups: IndexMap<&str, Vec<&ResolvedCard>> = IndexMap::new();
    for card in cards {
        groups
            .entry(card.annotation.source_page_id.as_str())
            .or_default()
            .push(card);
    }

    let mut out = String::new();
    for (_page_id, group) in &groups {
        let heading = &group[0].annotation.source_page_title;
        out.push_str(&format!("## {}\n\n", heading));

        for card in group {
            if let Some(ref original) = card.annotation.original {
                let blockquoted: String = original
                    .lines()
                    .map(|line| format!("> {}", line))
                    .collect::<Vec<_>>()
                    .join("\n");
                out.push_str(&blockquoted);
                out.push('\n');

                let mut attribution =
                    format!("> — [[{}]]", card.annotation.source_page_title);
                if let Some(ref key) = card.citekey {
                    attribution.push_str(&format!(" [@{}]", key));
                }
                out.push_str(&attribution);
                out.push_str("\n\n");
            }

            if let Some(ref note) = card.slip_note {
                out.push_str(note);
                out.push_str("\n\n");
            }
        }
    }

    out
}

/// Build the YAML frontmatter block for the draft. `source_titles` are emitted
/// as wikilinks; all string values are escaped for double-quoted YAML.
pub(crate) fn build_draft_frontmatter(
    title: &str,
    source_titles: &[String],
    created: &str,
) -> String {
    let mut out = String::new();
    out.push_str("---\n");
    out.push_str(&format!(
        "title: \"{}\"\n",
        escape_yaml_double_quoted(title)
    ));
    out.push_str("sources:\n");
    for src in source_titles {
        out.push_str(&format!(
            "  - \"[[{}]]\"\n",
            escape_yaml_double_quoted(src)
        ));
    }
    out.push_str(&format!(
        "created: \"{}\"\n",
        escape_yaml_double_quoted(created)
    ));
    out.push_str("---\n");
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::graph::types::ParsedNode;
    use serde_json::json;

    fn make_annotation(uuid: &str, page_id: &str, title: &str) -> CardboxAnnotation {
        make_annotation_with_original(uuid, page_id, title, None)
    }

    fn make_annotation_with_original(
        uuid: &str,
        page_id: &str,
        title: &str,
        original: Option<&str>,
    ) -> CardboxAnnotation {
        CardboxAnnotation {
            uuid: uuid.to_string(),
            annotation_type: "highlight".to_string(),
            certainty: "certain".to_string(),
            body: None,
            date: None,
            source_page_id: page_id.to_string(),
            source_page_title: title.to_string(),
            source_line: 0,
            char_start: 0,
            char_end: 0,
            scope_kind: "text".to_string(),
            scope_value: String::new(),
            original: original.map(|s| s.to_string()),
        }
    }

    fn s2(a: &str, b: &str) -> [String; 2] {
        [a.to_string(), b.to_string()]
    }

    fn upsert_with_frontmatter(store: &Store, id: &str, fm: serde_json::Value) {
        let node = ParsedNode {
            id: id.to_string(),
            title: id.to_string(),
            tags: vec![],
            frontmatter: fm,
            first_paragraph: String::new(),
        };
        store.upsert_node(&node, 0).unwrap();
    }

    // ── Phase 1.1: resolve_annotations_by_uuid ────────────────────────────

    #[test]
    fn resolve_annotations_known_uuids() {
        let all = vec![
            make_annotation("a", "p1", "Page One"),
            make_annotation("b", "p2", "Page Two"),
        ];
        // Request in reversed order — output must follow request order.
        let uuids = vec!["b".to_string(), "a".to_string()];
        let resolved = resolve_annotations_by_uuid(&all, &uuids).unwrap();
        assert_eq!(resolved.len(), 2);
        assert_eq!(resolved[0].uuid, "b");
        assert_eq!(resolved[1].uuid, "a");
    }

    #[test]
    fn resolve_annotations_unknown_uuid_errors() {
        let all = vec![make_annotation("a", "p1", "Page One")];
        let uuids = vec!["a".to_string(), "missing".to_string()];
        let err = resolve_annotations_by_uuid(&all, &uuids).unwrap_err();
        assert!(err.contains("missing"), "error should name the missing uuid: {err}");
    }

    // ── Phase 1.2: order_by_links ─────────────────────────────────────────

    #[test]
    fn order_by_links_linear_chain() {
        // Chain A-B-C, selection [C,A,B] → BFS from C: [C,B,A].
        let uuids = vec!["C".to_string(), "A".to_string(), "B".to_string()];
        let links = vec![s2("A", "B"), s2("B", "C")];
        assert_eq!(order_by_links(&uuids, &links), vec!["C", "B", "A"]);
    }

    #[test]
    fn order_by_links_disconnected() {
        // Two pairs A-B, C-D; selection [C,A,D,B] → [C,D,A,B].
        let uuids = vec![
            "C".to_string(),
            "A".to_string(),
            "D".to_string(),
            "B".to_string(),
        ];
        let links = vec![s2("A", "B"), s2("C", "D")];
        assert_eq!(order_by_links(&uuids, &links), vec!["C", "D", "A", "B"]);
    }

    #[test]
    fn order_by_links_no_links() {
        let uuids = vec!["A".to_string(), "B".to_string(), "C".to_string()];
        let links: Vec<[String; 2]> = vec![];
        assert_eq!(order_by_links(&uuids, &links), vec!["A", "B", "C"]);
    }

    #[test]
    fn order_by_links_single() {
        // One selected UUID with a link to an outside UUID → just the one.
        let uuids = vec!["A".to_string()];
        let links = vec![s2("A", "Z")];
        assert_eq!(order_by_links(&uuids, &links), vec!["A"]);
    }

    // ── Phase 1.3: citekey_for_page ───────────────────────────────────────

    #[test]
    fn citekey_for_page_present() {
        let store = Store::open_memory().unwrap();
        upsert_with_frontmatter(&store, "p1", json!({ "citekey": "smith2024" }));
        assert_eq!(
            citekey_for_page(&store, "p1").unwrap(),
            Some("smith2024".to_string())
        );
    }

    #[test]
    fn citekey_for_page_absent() {
        let store = Store::open_memory().unwrap();
        upsert_with_frontmatter(&store, "p1", json!({}));
        assert_eq!(citekey_for_page(&store, "p1").unwrap(), None);
    }

    // ── Phase 1.4: draft body / frontmatter builders ──────────────────────

    fn card(
        uuid: &str,
        page_id: &str,
        title: &str,
        original: Option<&str>,
        slip_note: Option<&str>,
        citekey: Option<&str>,
    ) -> ResolvedCard {
        ResolvedCard {
            annotation: make_annotation_with_original(uuid, page_id, title, original),
            slip_note: slip_note.map(|s| s.to_string()),
            citekey: citekey.map(|s| s.to_string()),
        }
    }

    #[test]
    fn body_two_sources() {
        let cards = vec![
            card("a", "p1", "Page One", Some("quote one"), None, None),
            card("b", "p2", "Page Two", Some("quote two"), None, None),
        ];
        let body = build_draft_body(&cards);
        assert!(body.contains("## Page One"));
        assert!(body.contains("## Page Two"));
        // Card order preserved: Page One section precedes Page Two.
        assert!(body.find("## Page One").unwrap() < body.find("## Page Two").unwrap());
    }

    #[test]
    fn body_same_source() {
        let cards = vec![
            card("a", "p1", "Page One", Some("quote one"), None, None),
            card("b", "p1", "Page One", Some("quote two"), None, None),
        ];
        let body = build_draft_body(&cards);
        assert_eq!(body.matches("## Page One").count(), 1);
        assert!(body.contains("> quote one"));
        assert!(body.contains("> quote two"));
    }

    #[test]
    fn body_no_slip_note() {
        let cards = vec![card("a", "p1", "Page One", Some("quote"), None, None)];
        let body = build_draft_body(&cards);
        assert!(body.contains("> quote"));
        assert!(body.contains("> — [[Page One]]"));
    }

    #[test]
    fn body_no_original() {
        let cards = vec![card("a", "p1", "Page One", None, Some("my thoughts"), None)];
        let body = build_draft_body(&cards);
        assert!(!body.contains('>'), "no blockquote should be emitted: {body}");
        assert!(body.contains("my thoughts"));
    }

    #[test]
    fn body_with_citekey() {
        let cards = vec![card(
            "a",
            "p1",
            "Page One",
            Some("quote"),
            None,
            Some("smith2024"),
        )];
        let body = build_draft_body(&cards);
        assert!(body.contains("[@smith2024]"));
    }

    #[test]
    fn body_without_citekey() {
        let cards = vec![card("a", "p1", "Page One", Some("quote"), None, None)];
        let body = build_draft_body(&cards);
        assert!(!body.contains("[@"), "no citekey marker expected: {body}");
    }

    #[test]
    fn frontmatter_basic() {
        let sources = vec!["Page One".to_string(), "Page Two".to_string()];
        let fm = build_draft_frontmatter("My Draft", &sources, "2026-06-26T12:00:00Z");
        assert!(fm.starts_with("---\n"));
        assert!(fm.trim_end().ends_with("---"));
        assert!(fm.contains("title: \"My Draft\""));
        assert!(fm.contains("  - \"[[Page One]]\""));
        assert!(fm.contains("  - \"[[Page Two]]\""));
        assert!(fm.contains("created: \"2026-06-26T12:00:00Z\""));
    }
}
