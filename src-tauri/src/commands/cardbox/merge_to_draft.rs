//! Pure helper functions backing the future `merge_to_draft` command.
//!
//! These cover four domains, each independently testable without file I/O or
//! Tauri wiring:
//!   1. annotation resolution by UUID (preserving request order),
//!   2. link-topology ordering via BFS over the selected set,
//!   3. citekey lookup from a page's frontmatter,
//!   4. markdown draft body / frontmatter construction.
//!
//! These building blocks are wired into the `merge_cards_to_draft` Tauri
//! command below, which assembles selected cards into a merged markdown draft,
//! asks the configured LLM for a title, and writes the file to disk.

use std::collections::{HashMap, HashSet, VecDeque};
use std::path::Path;
use std::sync::Arc;

use tauri::{Emitter, State};

use crate::graph::cardbox_layout::{self, CardboxLayout};
use crate::graph::store::Store;
use crate::graph::types::CardboxAnnotation;

use super::escape_yaml_double_quoted;
use super::CardboxLock;

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
    for v in adj.values_mut() {
        v.sort();
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
/// Thin wrapper around [`Store::citekey_for_page`] that maps the error to
/// `String` for the command layer.
pub(crate) fn citekey_for_page(store: &Store, page_id: &str) -> Result<Option<String>, String> {
    store.citekey_for_page(page_id).map_err(|e| e.to_string())
}

/// Produce a safe `[[…]]` wikilink string from a page title.
///
/// Brackets inside the title break wikilink syntax (the inner regex is
/// `[^\[\]]+`), so we replace `[` → `(` and `]` → `)` before wrapping.
pub(super) fn wikilink(title: &str) -> String {
    let safe: String = title
        .chars()
        .map(|c| match c {
            '[' => '(',
            ']' => ')',
            _ => c,
        })
        .collect();
    format!("[[{}]]", safe)
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
                let blockquoted = super::blockquote(original);
                out.push_str(&blockquoted);
                out.push('\n');

                let mut attribution =
                    format!("> — {}", wikilink(&card.annotation.source_page_title));
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
            "  - \"{}\"\n",
            escape_yaml_double_quoted(&wikilink(src))
        ));
    }
    out.push_str(&format!(
        "created: \"{}\"\n",
        escape_yaml_double_quoted(created)
    ));
    out.push_str("---\n");
    out
}

/// Assemble the merged draft body from the selected cards.
///
/// Resolves the requested `uuids` against `all_annotations`, orders them by link
/// topology (BFS over `layout.links`), pairs each with its slip note (from the
/// sn-derived `notes` map) and citekey (from the pre-computed `citekey_map`,
/// keyed by `source_page_id`), then renders the markdown body. Returns the body
/// plus the deduplicated source titles in first-seen order (used for
/// frontmatter and as the LLM-title fallback).
pub(crate) fn prepare_draft_content(
    uuids: &[String],
    all_annotations: &[CardboxAnnotation],
    layout: &CardboxLayout,
    notes: &HashMap<String, crate::graph::cardbox_layout::CardNote>,
    citekey_map: &HashMap<String, Option<String>>,
) -> Result<(String, Vec<String>), String> {
    // Validate up front so a missing UUID errors with a clear message.
    let resolved = resolve_annotations_by_uuid(all_annotations, uuids)?;
    let by_uuid: HashMap<&str, &CardboxAnnotation> =
        resolved.iter().map(|a| (a.uuid.as_str(), a)).collect();

    let ordered = order_by_links(uuids, &layout.links);

    let mut cards = Vec::with_capacity(ordered.len());
    let mut source_titles = Vec::new();
    let mut seen_sources = HashSet::new();
    for uuid in &ordered {
        let ann = by_uuid
            .get(uuid.as_str())
            .ok_or_else(|| format!("Annotation not found: {}", uuid))?;
        let slip_note = notes.get(uuid).map(|n| n.body.clone());
        let citekey = citekey_map
            .get(&ann.source_page_id)
            .cloned()
            .flatten();
        if seen_sources.insert(ann.source_page_id.clone()) {
            source_titles.push(ann.source_page_title.clone());
        }
        cards.push(ResolvedCard {
            annotation: (*ann).clone(),
            slip_note,
            citekey,
        });
    }

    let body = build_draft_body(&cards);
    Ok((body, source_titles))
}

/// Assemble frontmatter + body into the final draft content and write it to a
/// deduplicated filename under `root`. Returns `(filename, content)`.
pub(crate) fn write_draft_file(
    root: &Path,
    title: &str,
    body: &str,
    source_titles: &[String],
    created: &str,
) -> Result<(String, String), String> {
    let frontmatter = build_draft_frontmatter(title, source_titles, created);

    let mut content = String::with_capacity(frontmatter.len() + body.len() + 2);
    content.push_str(&frontmatter);
    content.push('\n');
    content.push_str(body);
    if !content.ends_with('\n') {
        content.push('\n');
    }

    let base = super::sanitize_filename(title);
    let base = if base.len() > 200 {
        base[..base.floor_char_boundary(200)].to_string()
    } else {
        base
    };
    let filename = super::dedup_filename(root, &base);
    let file_path = root.join(&filename);
    std::fs::write(&file_path, &content).map_err(|e| e.to_string())?;

    Ok((filename, content))
}

/// Merge the selected cards into a single markdown draft, write it to the
/// workspace, and return the created filename.
///
/// Three phases keep no `MutexGuard` across the `.await`:
///   1. sync collection — load the layout, fetch annotations + citekeys, build
///      the draft body via [`prepare_draft_content`];
///   2. async LLM title — falls back to `source_titles.join(" + ")` on any error;
///   3. sync write — guarded by [`CardboxLock`], records the write, reindexes,
///      and emits `workspace://file-created`.
#[tauri::command]
pub async fn merge_cards_to_draft(
    uuids: Vec<String>,
    window: tauri::Window,
    workspace_state: State<'_, crate::commands::workspace::WorkspaceRegistry>,
    graph_state: State<'_, Arc<crate::commands::graph::GraphRegistry>>,
    lock: State<'_, CardboxLock>,
    registry: State<'_, Arc<crate::workspace::write_hash::WriteHashRegistry>>,
    app_handle: tauri::AppHandle,
    credential_store: State<'_, Arc<dyn crate::commands::credential::CredentialStore>>,
) -> Result<String, String> {
    if uuids.is_empty() {
        return Err("No cards selected".to_string());
    }

    // ── Phase 1: sync data collection ─────────────────────────────────────
    let root = crate::commands::workspace::get_workspace_root(&workspace_state, window.label())?;
    let layout = cardbox_layout::load_layout(&root);

    let (body, source_titles) = crate::commands::graph::with_graph_index(
        &workspace_state,
        &graph_state,
        window.label(),
        |gi| {
            let all = gi.list_all_cardbox_annotations()?;
            let uuid_set: HashSet<&str> = uuids.iter().map(|s| s.as_str()).collect();
            let mut citekey_map: HashMap<String, Option<String>> = HashMap::new();
            {
                let store = gi.store();
                for ann in &all {
                    if uuid_set.contains(ann.uuid.as_str())
                        && !citekey_map.contains_key(&ann.source_page_id)
                    {
                        let key = citekey_for_page(&store, &ann.source_page_id)
                            .map_err(crate::graph::error::GraphError::Other)?;
                        citekey_map.insert(ann.source_page_id.clone(), key);
                    }
                }
            }
            let notes = super::slip_note::derive_notes(gi)
                .map_err(crate::graph::error::GraphError::Other)?;
            prepare_draft_content(&uuids, &all, &layout, &notes, &citekey_map)
                .map_err(crate::graph::error::GraphError::Other)
        },
    )?;

    // ── Phase 2: async LLM title (best-effort) ────────────────────────────
    let prefs = crate::preferences::read_preferences(&app_handle);
    let (provider_id, model, base_url, temperature) =
        crate::commands::merge_split::resolve_llm_settings(&prefs);
    let api_key = crate::llm::resolve_api_key(&provider_id, credential_store.as_ref());

    let title = match crate::commands::merge_split::suggest_title_inner(
        &provider_id,
        &model,
        api_key.as_deref(),
        base_url.as_deref(),
        &source_titles,
        &body,
        temperature,
    )
    .await
    {
        Ok(t) => t,
        Err(e) => {
            tracing::warn!("LLM title suggestion failed, using fallback: {e}");
            source_titles.join(" + ")
        }
    };

    // ── Phase 3: sync file write ──────────────────────────────────────────
    let created = chrono::Utc::now().to_rfc3339();
    let filename = {
        let _guard = lock.0.lock().unwrap();
        let (filename, content) =
            write_draft_file(&root, &title, &body, &source_titles, &created)?;
        registry.record(&root.join(&filename), &content);
        filename
    };

    crate::commands::page::reindex_and_emit(
        &graph_state,
        &app_handle,
        &root.to_path_buf(),
        |gi, ann_flag| gi.add_file(&filename, ann_flag),
    );

    let _ = window.emit(
        "workspace://file-created",
        crate::workspace::watcher::FileEvent {
            path: filename.clone(),
        },
    );

    Ok(filename)
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

    #[test]
    fn order_by_links_deterministic_regardless_of_link_order() {
        // Star topology: A connected to B, C, D.
        let uuids = vec![
            "A".to_string(),
            "B".to_string(),
            "C".to_string(),
            "D".to_string(),
        ];
        let links_v1 = vec![s2("A", "B"), s2("A", "C"), s2("A", "D")];
        let links_v2 = vec![s2("A", "D"), s2("A", "C"), s2("A", "B")];
        let result_v1 = order_by_links(&uuids, &links_v1);
        let result_v2 = order_by_links(&uuids, &links_v2);
        assert_eq!(
            result_v1, result_v2,
            "BFS order must be independent of link input order: v1={result_v1:?}, v2={result_v2:?}"
        );
        assert_eq!(result_v1, vec!["A", "B", "C", "D"]);
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

    // ── Wikilink sanitization ──────────────────────────────────────────

    #[test]
    fn wikilink_plain_title() {
        assert_eq!(wikilink("Page One"), "[[Page One]]");
    }

    #[test]
    fn wikilink_title_with_double_brackets() {
        assert_eq!(wikilink("Array[[0]]"), "[[Array((0))]]");
    }

    #[test]
    fn wikilink_title_with_single_bracket() {
        assert_eq!(wikilink("foo]bar"), "[[foo)bar]]");
    }

    #[test]
    fn body_title_with_brackets() {
        let cards = vec![card("a", "p1", "Array[[0]]", Some("quote"), None, None)];
        let body = build_draft_body(&cards);
        assert!(
            body.contains("> — [[Array((0))]]"),
            "attribution should contain sanitized wikilink: {body}"
        );
        assert!(
            !body.contains("[[Array[["),
            "raw brackets must not appear in wikilink: {body}"
        );
    }

    #[test]
    fn frontmatter_title_with_brackets() {
        let sources = vec!["Array[[0]]".to_string()];
        let fm = build_draft_frontmatter("Draft", &sources, "2026-01-01");
        assert!(
            fm.contains("[[Array((0))]]"),
            "frontmatter should contain sanitized wikilink: {fm}"
        );
        assert!(
            !fm.contains("[[Array[["),
            "raw brackets must not appear in wikilink: {fm}"
        );
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

    // ── Phase 2.5: prepare_draft_content + write_draft_file integration ────

    use crate::graph::cardbox_layout::CardNote;

    fn slip(body: &str) -> CardNote {
        CardNote {
            body: body.to_string(),
            updated_at: None,
        }
    }

    // T2.5.1 — 3 cards from 2 sources, two of them linked (a-b), one unlinked (c).
    #[test]
    fn draft_three_cards_two_sources_linked_and_unlinked() {
        let dir = tempfile::TempDir::new().unwrap();
        let root = dir.path();

        let all = vec![
            make_annotation_with_original("a", "p1", "Page One", Some("alpha quote")),
            make_annotation_with_original("b", "p2", "Page Two", Some("beta quote")),
            make_annotation_with_original("c", "p1", "Page One", Some("gamma quote")),
        ];
        let uuids = vec!["a".to_string(), "b".to_string(), "c".to_string()];

        let mut layout = CardboxLayout::default();
        layout.links = vec![s2("a", "b")];
        let mut notes: HashMap<String, CardNote> = HashMap::new();
        notes.insert("a".to_string(), slip("My thought on alpha."));

        let mut citekey_map: HashMap<String, Option<String>> = HashMap::new();
        citekey_map.insert("p1".to_string(), Some("smith2024".to_string()));
        citekey_map.insert("p2".to_string(), None);

        let (body, source_titles) =
            prepare_draft_content(&uuids, &all, &layout, &notes, &citekey_map).unwrap();

        // Two source headings, Page One before Page Two (BFS from a reaches b first,
        // and grouping folds c back into the Page One section).
        assert_eq!(body.matches("## Page One").count(), 1);
        assert_eq!(body.matches("## Page Two").count(), 1);
        assert!(body.find("## Page One").unwrap() < body.find("## Page Two").unwrap());

        // A blockquote for every original.
        assert!(body.contains("> alpha quote"));
        assert!(body.contains("> beta quote"));
        assert!(body.contains("> gamma quote"));

        // Citation marker only on p1 cards (p2 has no citekey).
        assert!(body.contains("> — [[Page One]] [@smith2024]"));
        assert!(body.contains("> — [[Page Two]]"));
        assert!(!body.contains("[[Page Two]] [@"), "p2 has no citekey: {body}");

        // Slip note prose present.
        assert!(body.contains("My thought on alpha."));

        // Deduplicated sources, first-seen order.
        assert_eq!(
            source_titles,
            vec!["Page One".to_string(), "Page Two".to_string()]
        );

        // File output.
        let (filename, content) =
            write_draft_file(root, "My Draft", &body, &source_titles, "2026-06-26T00:00:00Z")
                .unwrap();
        assert!(root.join(&filename).exists(), "draft file should exist");
        assert!(content.contains("title: \"My Draft\""));
        assert!(content.contains("  - \"[[Page One]]\""));
        assert!(content.contains("  - \"[[Page Two]]\""));
        assert!(content.contains("created: \"2026-06-26T00:00:00Z\""));
        assert!(content.contains("## Page One"));
    }

    // T2.5.2 — cards with originals but no slip notes: blockquotes only, no prose.
    #[test]
    fn draft_cards_no_slip_notes() {
        let dir = tempfile::TempDir::new().unwrap();
        let root = dir.path();

        let all = vec![
            make_annotation_with_original("a", "p1", "Page One", Some("first quote")),
            make_annotation_with_original("b", "p2", "Page Two", Some("second quote")),
        ];
        let uuids = vec!["a".to_string(), "b".to_string()];
        let layout = CardboxLayout::default(); // no notes, no links
        let notes: HashMap<String, CardNote> = HashMap::new();
        let citekey_map: HashMap<String, Option<String>> = HashMap::new();

        let (body, source_titles) =
            prepare_draft_content(&uuids, &all, &layout, &notes, &citekey_map).unwrap();

        assert!(body.contains("> first quote"));
        assert!(body.contains("> second quote"));

        // Every non-empty line is a heading or a blockquote line — no prose between
        // sections because no card has a slip note.
        for line in body.lines() {
            if line.trim().is_empty() {
                continue;
            }
            assert!(
                line.starts_with("## ") || line.starts_with('>'),
                "unexpected prose line: {line:?}"
            );
        }

        let (filename, _content) =
            write_draft_file(root, "Draft", &body, &source_titles, "2026-01-01").unwrap();
        assert!(root.join(filename).exists());
    }

    // T2.5.3 — 3 cards from one source: a single heading, one frontmatter source.
    #[test]
    fn draft_all_cards_same_source() {
        let dir = tempfile::TempDir::new().unwrap();
        let root = dir.path();

        let all = vec![
            make_annotation_with_original("a", "p1", "Page One", Some("q1")),
            make_annotation_with_original("b", "p1", "Page One", Some("q2")),
            make_annotation_with_original("c", "p1", "Page One", Some("q3")),
        ];
        let uuids = vec!["a".to_string(), "b".to_string(), "c".to_string()];
        let layout = CardboxLayout::default();
        let notes: HashMap<String, CardNote> = HashMap::new();
        let citekey_map: HashMap<String, Option<String>> = HashMap::new();

        let (body, source_titles) =
            prepare_draft_content(&uuids, &all, &layout, &notes, &citekey_map).unwrap();

        assert_eq!(body.matches("## Page One").count(), 1);
        assert!(body.contains("> q1"));
        assert!(body.contains("> q2"));
        assert!(body.contains("> q3"));
        assert_eq!(source_titles, vec!["Page One".to_string()]);

        let (filename, content) =
            write_draft_file(root, "Draft", &body, &source_titles, "2026-01-01").unwrap();
        assert!(root.join(filename).exists());

        // Exactly one frontmatter source entry.
        assert_eq!(content.matches("  - \"[[").count(), 1);
    }

    #[test]
    fn draft_includes_sn_backed_notes() {
        use crate::commands::cardbox::slip_note::notes_from_sn;

        let all = vec![
            make_annotation_with_original("a", "p1", "Page One", Some("quote")),
        ];
        let uuids = vec!["a".to_string()];

        let mut layout = CardboxLayout::default();

        let mut sn_map = HashMap::new();
        sn_map.insert("a".to_string(), CardboxAnnotation {
            uuid: "sn1".to_string(),
            annotation_type: "slipnote".to_string(),
            certainty: "neutral".to_string(),
            body: Some("sn prose from source".to_string()),
            date: Some("2026-07-28".to_string()),
            source_page_id: "p1".to_string(),
            source_page_title: "Page One".to_string(),
            source_line: 1,
            char_start: 0,
            char_end: 10,
            scope_kind: "anchor".to_string(),
            scope_value: "a".to_string(),
            original: None,
        });

        let notes = notes_from_sn(&sn_map);

        // A JSON-only legacy entry in the layout must play no part.
        layout.notes.insert("a".to_string(), slip("stale JSON prose"));

        let citekey_map: HashMap<String, Option<String>> = HashMap::new();
        let (body, _) = prepare_draft_content(&uuids, &all, &layout, &notes, &citekey_map).unwrap();

        assert!(body.contains("sn prose from source"),
            "draft must include sn-backed notes: {}", body);
        assert!(!body.contains("stale JSON prose"),
            "draft must ignore JSON-only layout entries: {}", body);
    }

    #[test]
    fn draft_ignores_json_only_entries() {
        // A card whose note exists only in layout.notes (no sn) gets no prose.
        let all = vec![
            make_annotation_with_original("a", "p1", "Page One", Some("quote")),
        ];
        let uuids = vec!["a".to_string()];

        let mut layout = CardboxLayout::default();
        layout.notes.insert("a".to_string(), slip("legacy JSON note"));

        let notes: HashMap<String, CardNote> = HashMap::new();
        let citekey_map: HashMap<String, Option<String>> = HashMap::new();
        let (body, _) = prepare_draft_content(&uuids, &all, &layout, &notes, &citekey_map).unwrap();

        assert!(!body.contains("legacy JSON note"),
            "JSON-only entries must not appear in drafts: {}", body);
    }

    #[test]
    fn write_draft_file_truncates_long_title() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        let long_title = "A ".repeat(200);
        assert!(long_title.len() > 300);

        let (filename, _) =
            write_draft_file(root, &long_title, "body", &["src".to_string()], "2026-01-01")
                .unwrap();
        assert!(
            filename.len() <= 204,
            "filename should be at most 200 base + .md (4), got {} bytes: {filename}",
            filename.len()
        );
        assert!(filename.ends_with(".md"));
        assert!(root.join(&filename).exists());
    }
}
