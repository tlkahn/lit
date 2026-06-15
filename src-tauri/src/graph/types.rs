use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "lowercase")]
pub enum EdgeKind {
    Wikilink,
    Citation,
}

impl EdgeKind {
    pub fn as_str(self) -> &'static str {
        match self {
            EdgeKind::Wikilink => "wikilink",
            EdgeKind::Citation => "citation",
        }
    }
}

impl From<&str> for EdgeKind {
    fn from(s: &str) -> Self {
        match s {
            "citation" => EdgeKind::Citation,
            // Unknown kinds degrade to wikilink, mirroring the edges table's
            // `edge_kind TEXT NOT NULL DEFAULT 'wikilink'` semantics.
            _ => EdgeKind::Wikilink,
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq, Hash)]
#[serde(rename_all = "lowercase")]
pub enum Materialization {
    Stub,
    Shadow,
    Partial,
    Materialized,
}

impl Materialization {
    pub fn as_str(self) -> &'static str {
        match self {
            Materialization::Stub => "stub",
            Materialization::Shadow => "shadow",
            Materialization::Partial => "partial",
            Materialization::Materialized => "materialized",
        }
    }
}

impl From<&str> for Materialization {
    fn from(s: &str) -> Self {
        match s {
            "stub" => Materialization::Stub,
            "shadow" => Materialization::Shadow,
            "partial" => Materialization::Partial,
            // Unknown values degrade to Materialized, mirroring the nodes table's
            // `materialization TEXT NOT NULL DEFAULT 'materialized'` semantics.
            _ => Materialization::Materialized,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ParsedNode {
    pub id: String,
    pub title: String,
    pub tags: Vec<String>,
    pub frontmatter: serde_json::Value,
    pub first_paragraph: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SearchResult {
    pub id: String,
    pub title: String,
    pub score: f64,
    pub excerpt: String,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub first_match_line: Option<u64>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Stats {
    pub nodes: i64,
    pub stubs: i64,
    pub edges: i64,
    pub tags: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct BacklinkEntry {
    pub source_id: String,
    pub source_title: String,
    pub context: String,
    pub source_line: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct LinkEntry {
    pub target_id: String,
    pub target_title: String,
    pub raw_target: String,
    pub context: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HeadingInfo {
    pub text: String,
    pub level: u8,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct UnlinkedMention {
    pub source_id: String,
    pub source_title: String,
    pub context: String,
    pub source_line: u32,
    pub matched_text: String,
}

pub fn extract_tags(fm: &serde_json::Value) -> Vec<String> {
    match fm.get("tags") {
        Some(serde_json::Value::Array(arr)) => {
            arr.iter().filter_map(|v| v.as_str().map(String::from)).collect()
        }
        Some(serde_json::Value::String(s)) => vec![s.clone()],
        _ => vec![],
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct IndexableAnnotation {
    pub annotation_type: String,
    pub certainty: String,
    pub body: Option<String>,
    pub date: Option<String>,
    pub source_line: u32,
    pub char_start: usize,
    pub char_end: usize,
    pub scope_kind: String,
    pub scope_value: String,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub uuid: Option<String>,
}

impl From<FullAnnotationRecord> for IndexableAnnotation {
    fn from(r: FullAnnotationRecord) -> Self {
        IndexableAnnotation {
            annotation_type: r.annotation_type,
            certainty: r.certainty,
            body: r.body,
            date: r.date,
            source_line: r.source_line,
            char_start: r.char_start,
            char_end: r.char_end,
            scope_kind: r.scope_kind,
            scope_value: r.scope_value,
            uuid: Some(r.uuid),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AnnotationSearchResult {
    pub annotation_id: i64,
    pub node_id: String,
    pub node_title: String,
    pub annotation_type: String,
    pub certainty: String,
    pub body: Option<String>,
    pub date: Option<String>,
    pub source_line: u32,
    pub char_start: usize,
    pub char_end: usize,
    pub uuid: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct FullAnnotationRecord {
    pub uuid: String,
    pub node_id: String,
    pub annotation_type: String,
    pub certainty: String,
    pub body: Option<String>,
    pub date: Option<String>,
    pub source_line: u32,
    pub char_start: usize,
    pub char_end: usize,
    pub scope_kind: String,
    pub scope_value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CardboxAnnotation {
    pub uuid: String,
    pub annotation_type: String,
    pub certainty: String,
    pub body: Option<String>,
    pub date: Option<String>,
    pub source_page_id: String,
    pub source_page_title: String,
    pub source_line: u32,
    pub char_start: usize,
    pub char_end: usize,
    pub scope_kind: String,
    pub scope_value: String,
    pub original: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TagSearchResult {
    pub tag: String,
    pub count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TagPageResult {
    pub id: String,
    pub title: String,
    pub first_paragraph: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
pub struct Position {
    pub x: f64,
    pub y: f64,
}

pub fn extract_aliases(fm: &serde_json::Value) -> Vec<String> {
    match fm.get("aliases") {
        Some(serde_json::Value::Array(arr)) => {
            arr.iter().filter_map(|v| v.as_str().map(String::from)).collect()
        }
        Some(serde_json::Value::String(s)) => vec![s.clone()],
        _ => vec![],
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn edge_kind_serializes_lowercase() {
        assert_eq!(serde_json::to_string(&EdgeKind::Wikilink).unwrap(), "\"wikilink\"");
        assert_eq!(serde_json::to_string(&EdgeKind::Citation).unwrap(), "\"citation\"");
        assert_eq!(EdgeKind::Wikilink.as_str(), "wikilink");
        assert_eq!(EdgeKind::Citation.as_str(), "citation");
        assert_eq!(serde_json::from_str::<EdgeKind>("\"citation\"").unwrap(), EdgeKind::Citation);
    }

    #[test]
    fn edge_kind_from_str() {
        assert_eq!(EdgeKind::from("citation"), EdgeKind::Citation);
        assert_eq!(EdgeKind::from("wikilink"), EdgeKind::Wikilink);
        // Unknown kinds degrade to wikilink, mirroring the DB column default.
        assert_eq!(EdgeKind::from("garbage"), EdgeKind::Wikilink);
    }

    #[test]
    fn materialization_serializes_lowercase() {
        assert_eq!(serde_json::to_string(&Materialization::Stub).unwrap(), "\"stub\"");
        assert_eq!(serde_json::to_string(&Materialization::Shadow).unwrap(), "\"shadow\"");
        assert_eq!(serde_json::to_string(&Materialization::Partial).unwrap(), "\"partial\"");
        assert_eq!(serde_json::to_string(&Materialization::Materialized).unwrap(), "\"materialized\"");
        assert_eq!(Materialization::Stub.as_str(), "stub");
        assert_eq!(Materialization::Shadow.as_str(), "shadow");
        assert_eq!(Materialization::Partial.as_str(), "partial");
        assert_eq!(Materialization::Materialized.as_str(), "materialized");
        assert_eq!(
            serde_json::from_str::<Materialization>("\"partial\"").unwrap(),
            Materialization::Partial
        );
    }

    #[test]
    fn materialization_from_str() {
        assert_eq!(Materialization::from("stub"), Materialization::Stub);
        assert_eq!(Materialization::from("shadow"), Materialization::Shadow);
        assert_eq!(Materialization::from("partial"), Materialization::Partial);
        assert_eq!(Materialization::from("materialized"), Materialization::Materialized);
        // Unknown values degrade to Materialized, mirroring the DB column default.
        assert_eq!(Materialization::from("garbage"), Materialization::Materialized);
    }

    #[test]
    fn materialization_roundtrips_all_variants() {
        let variants = [
            Materialization::Stub,
            Materialization::Shadow,
            Materialization::Partial,
            Materialization::Materialized,
        ];
        for v in variants {
            let json_str = serde_json::to_string(&v).unwrap();
            let back: Materialization = serde_json::from_str(&json_str).unwrap();
            assert_eq!(back, v);
        }
    }

    #[test]
    fn materialization_copy_and_eq() {
        let a = Materialization::Shadow;
        let b = a; // exercises Copy
        assert_eq!(a, b); // exercises Eq
    }

    #[test]
    fn materialization_debug_format() {
        assert!(format!("{:?}", Materialization::Shadow).contains("Shadow"));
    }

    #[test]
    fn full_annotation_record_converts_to_indexable() {
        let rec = FullAnnotationRecord {
            uuid: "u1".into(),
            node_id: "a.md".into(),
            annotation_type: "claim".into(),
            certainty: "high".into(),
            body: Some("text".into()),
            date: Some("2026-06-06".into()),
            source_line: 3,
            char_start: 10,
            char_end: 20,
            scope_kind: "char".into(),
            scope_value: "x".into(),
        };
        let ia: IndexableAnnotation = rec.clone().into();
        assert_eq!(ia.annotation_type, rec.annotation_type);
        assert_eq!(ia.certainty, rec.certainty);
        assert_eq!(ia.body, rec.body);
        assert_eq!(ia.date, rec.date);
        assert_eq!(ia.source_line, rec.source_line);
        assert_eq!(ia.char_start, rec.char_start);
        assert_eq!(ia.char_end, rec.char_end);
        assert_eq!(ia.scope_kind, rec.scope_kind);
        assert_eq!(ia.scope_value, rec.scope_value);
        assert_eq!(ia.uuid, Some("u1".to_string()));
    }

    #[test]
    fn parsed_node_serializes_to_json() {
        let node = ParsedNode {
            id: "People/Alice.md".into(),
            title: "Alice".into(),
            tags: vec!["person".into()],
            frontmatter: json!({"title": "Alice"}),
            first_paragraph: "First paragraph.".into(),
        };
        let value = serde_json::to_value(&node).expect("serialize");
        assert_eq!(value["id"], "People/Alice.md");
        assert_eq!(value["title"], "Alice");
        assert_eq!(value["tags"], json!(["person"]));
        assert!(value["frontmatter"].is_object());
    }

    #[test]
    fn search_result_round_trips() {
        let result = SearchResult {
            id: "a.md".into(),
            title: "A".into(),
            score: -2.5,
            excerpt: "some [match]".into(),
            first_match_line: None,
        };
        let json_str = serde_json::to_string(&result).expect("serialize");
        let back: SearchResult = serde_json::from_str(&json_str).expect("deserialize");
        assert_eq!(back, result);
    }

    #[test]
    fn search_result_with_first_match_line_round_trips() {
        let result = SearchResult {
            id: "a.md".into(),
            title: "A".into(),
            score: -1.0,
            excerpt: "line content".into(),
            first_match_line: Some(42),
        };
        let json_str = serde_json::to_string(&result).expect("serialize");
        let back: SearchResult = serde_json::from_str(&json_str).expect("deserialize");
        assert_eq!(back, result);
        assert!(json_str.contains("\"first_match_line\":42"));
    }

    #[test]
    fn search_result_none_line_omitted_in_json() {
        let result = SearchResult {
            id: "a.md".into(),
            title: "A".into(),
            score: -1.0,
            excerpt: "x".into(),
            first_match_line: None,
        };
        let json_str = serde_json::to_string(&result).expect("serialize");
        assert!(!json_str.contains("first_match_line"));
    }

    #[test]
    fn search_result_missing_field_deserializes_as_none() {
        let json_str = r#"{"id":"a.md","title":"A","score":-1.0,"excerpt":"x"}"#;
        let result: SearchResult = serde_json::from_str(json_str).expect("deserialize");
        assert_eq!(result.first_match_line, None);
    }

    #[test]
    fn stats_equality() {
        let a = Stats { nodes: 1, stubs: 2, edges: 3, tags: 4 };
        let b = Stats { nodes: 1, stubs: 2, edges: 3, tags: 4 };
        assert_eq!(a, b);
    }

    #[test]
    fn extract_tags_from_array() {
        let fm = json!({"tags": ["rust", "coding"]});
        assert_eq!(extract_tags(&fm), vec!["rust", "coding"]);
    }

    #[test]
    fn extract_tags_from_string() {
        let fm = json!({"tags": "solo"});
        assert_eq!(extract_tags(&fm), vec!["solo"]);
    }

    #[test]
    fn extract_tags_missing() {
        let fm = json!({});
        assert!(extract_tags(&fm).is_empty());
    }

    #[test]
    fn extract_tags_non_string_filtered() {
        let fm = json!({"tags": ["good", 42, null]});
        assert_eq!(extract_tags(&fm), vec!["good"]);
    }

    #[test]
    fn backlink_entry_round_trips() {
        let entry = BacklinkEntry {
            source_id: "a.md".into(),
            source_title: "Alpha".into(),
            context: "links to target".into(),
            source_line: 5,
        };
        let json_str = serde_json::to_string(&entry).expect("serialize");
        let back: BacklinkEntry = serde_json::from_str(&json_str).expect("deserialize");
        assert_eq!(back, entry);
    }

    #[test]
    fn link_entry_round_trips() {
        let entry = LinkEntry {
            target_id: "b.md".into(),
            target_title: "Beta".into(),
            raw_target: "B".into(),
            context: "see B for details".into(),
        };
        let json_str = serde_json::to_string(&entry).expect("serialize");
        let back: LinkEntry = serde_json::from_str(&json_str).expect("deserialize");
        assert_eq!(back, entry);
    }

    #[test]
    fn unlinked_mention_round_trips() {
        let mention = UnlinkedMention {
            source_id: "other.md".into(),
            source_title: "Other Page".into(),
            context: "I met Alice yesterday".into(),
            source_line: 3,
            matched_text: "Alice".into(),
        };
        let json_str = serde_json::to_string(&mention).expect("serialize");
        let back: UnlinkedMention = serde_json::from_str(&json_str).expect("deserialize");
        assert_eq!(back, mention);
    }

    #[test]
    fn extract_aliases_from_array() {
        let fm = json!({"aliases": ["Alpha", "Alfa"]});
        assert_eq!(extract_aliases(&fm), vec!["Alpha", "Alfa"]);
    }

    #[test]
    fn extract_aliases_missing() {
        let fm = json!({});
        assert!(extract_aliases(&fm).is_empty());
    }

    #[test]
    fn extract_aliases_single_string() {
        let fm = json!({"aliases": "Solo"});
        assert_eq!(extract_aliases(&fm), vec!["Solo"]);
    }

    #[test]
    fn extract_aliases_non_string_items() {
        let fm = json!({"aliases": ["Good", 42, null, "Also Good"]});
        assert_eq!(extract_aliases(&fm), vec!["Good", "Also Good"]);
    }

    #[test]
    fn indexable_annotation_round_trips() {
        let ia = IndexableAnnotation {
            annotation_type: "note".into(),
            certainty: "tentative".into(),
            body: Some("a note".into()),
            date: Some("2026-03".into()),
            source_line: 5,
            char_start: 10,
            char_end: 50,
            scope_kind: "words".into(),
            scope_value: "2".into(),
            uuid: None,
        };
        let json_str = serde_json::to_string(&ia).expect("serialize");
        let back: IndexableAnnotation = serde_json::from_str(&json_str).expect("deserialize");
        assert_eq!(back, ia);
    }

    #[test]
    fn tag_search_result_round_trips() {
        let result = TagSearchResult {
            tag: "rust".into(),
            count: 5,
        };
        let json_str = serde_json::to_string(&result).expect("serialize");
        let back: TagSearchResult = serde_json::from_str(&json_str).expect("deserialize");
        assert_eq!(back, result);
    }

    #[test]
    fn tag_page_result_round_trips() {
        let result = TagPageResult {
            id: "a.md".into(),
            title: "Alpha".into(),
            first_paragraph: "First paragraph.".into(),
        };
        let json_str = serde_json::to_string(&result).expect("serialize");
        let back: TagPageResult = serde_json::from_str(&json_str).expect("deserialize");
        assert_eq!(back, result);
    }

    #[test]
    fn annotation_search_result_round_trips() {
        let asr = AnnotationSearchResult {
            annotation_id: 42,
            node_id: "a.md".into(),
            node_title: "Alpha".into(),
            annotation_type: "note".into(),
            certainty: "neutral".into(),
            body: Some("Silk Road".into()),
            date: None,
            source_line: 3,
            char_start: 10,
            char_end: 30,
            uuid: "550e8400-e29b-41d4-a716-446655440000".into(),
        };
        let json_str = serde_json::to_string(&asr).expect("serialize");
        let back: AnnotationSearchResult = serde_json::from_str(&json_str).expect("deserialize");
        assert_eq!(back, asr);
    }

    #[test]
    fn full_annotation_record_round_trips() {
        let rec = FullAnnotationRecord {
            uuid: "550e8400-e29b-41d4-a716-446655440000".into(),
            node_id: "a.md".into(),
            annotation_type: "note".into(),
            certainty: "neutral".into(),
            body: Some("Silk Road".into()),
            date: Some("2026-06-06".into()),
            source_line: 3,
            char_start: 10,
            char_end: 30,
            scope_kind: "words".into(),
            scope_value: "2".into(),
        };
        let json_str = serde_json::to_string(&rec).expect("serialize");
        let back: FullAnnotationRecord = serde_json::from_str(&json_str).expect("deserialize");
        assert_eq!(back, rec);
    }

    #[test]
    fn cardbox_annotation_round_trips() {
        let ann = CardboxAnnotation {
            uuid: "550e8400-e29b-41d4-a716-446655440000".into(),
            annotation_type: "note".into(),
            certainty: "neutral".into(),
            body: Some("Silk Road flourished".into()),
            date: Some("2026-06-15".into()),
            source_page_id: "a.md".into(),
            source_page_title: "Alpha".into(),
            source_line: 3,
            char_start: 10,
            char_end: 30,
            scope_kind: "words".into(),
            scope_value: "2".into(),
            original: None,
        };
        let json_str = serde_json::to_string(&ann).expect("serialize");
        let back: CardboxAnnotation = serde_json::from_str(&json_str).expect("deserialize");
        assert_eq!(back, ann);
    }
}
