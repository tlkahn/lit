use serde::{Deserialize, Serialize};

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
        };
        let json_str = serde_json::to_string(&result).expect("serialize");
        let back: SearchResult = serde_json::from_str(&json_str).expect("deserialize");
        assert_eq!(back, result);
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
}
