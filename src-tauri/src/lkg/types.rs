use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct LkgManifest {
    pub format_version: u32,
    pub generator: String,
    pub created_at: String,
    pub bundle_type: String,
    pub title: String,
    pub description: Option<String>,
    pub stats: LkgStats,
    pub graph_hash: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct LkgStats {
    pub node_count: u64,
    pub edge_count: u64,
    pub annotation_count: u64,
    pub asset_count: u64,
    pub total_size_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct BundleNode {
    pub id: String,
    pub title: String,
    pub first_paragraph: String,
    pub frontmatter: serde_json::Value,
    pub is_stub: bool,
    pub tags: Vec<String>,
    pub aliases: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct BundleEdge {
    pub source: String,
    pub target: String,
    pub context: String,
    pub raw_target: String,
    pub source_line: u32,
    /// Omitted from JSON when "wikilink" so legacy bundles' graph hashes
    /// (computed before this field existed) still verify on import.
    #[serde(default = "default_edge_kind", skip_serializing_if = "is_default_edge_kind")]
    pub edge_kind: String,
}

fn default_edge_kind() -> String {
    "wikilink".to_string()
}

fn is_default_edge_kind(kind: &str) -> bool {
    kind == "wikilink"
}

/// An annotation row carried inside a `.lkg` bundle.
///
/// This is a type alias for [`crate::graph::types::FullAnnotationRecord`]: the
/// two are structurally identical (same 11 fields, same plain serde derives), so
/// the bundle format is intentionally coupled to the graph type as the single
/// source of truth. Any future annotation schema change touches exactly one
/// struct, and the on-disk JSON shape stays byte-compatible.
pub type BundleAnnotation = crate::graph::types::FullAnnotationRecord;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct LkgExportSummary {
    pub exported_count: usize,
    pub destination: String,
    pub graph_hash: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct LkgImportSummary {
    pub node_count: u64,
    pub edge_count: u64,
    pub annotation_count: u64,
    pub file_count: usize,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn lkg_manifest_round_trips() {
        let m = LkgManifest {
            format_version: 1u32,
            generator: "lit".into(),
            created_at: "2026-06-06T00:00:00Z".into(),
            bundle_type: "full".into(),
            title: "My Graph".into(),
            description: Some("desc".into()),
            stats: LkgStats {
                node_count: 2,
                edge_count: 1,
                annotation_count: 0,
                asset_count: 1,
                total_size_bytes: 123,
            },
            graph_hash: "sha256:abc".into(),
        };
        let s = serde_json::to_string(&m).expect("serialize");
        let back: LkgManifest = serde_json::from_str(&s).expect("deserialize");
        assert_eq!(back, m);

        let v = serde_json::to_value(&m).expect("to_value");
        assert_eq!(v["format_version"], 1);
        assert_eq!(v["bundle_type"], "full");
    }

    #[test]
    fn lkg_stats_round_trips() {
        let s = LkgStats {
            node_count: 5,
            edge_count: 3,
            annotation_count: 2,
            asset_count: 1,
            total_size_bytes: 999,
        };
        let json_str = serde_json::to_string(&s).expect("serialize");
        let back: LkgStats = serde_json::from_str(&json_str).expect("deserialize");
        assert_eq!(back, s);

        let v = serde_json::to_value(&s).expect("to_value");
        assert_eq!(v["total_size_bytes"], 999);
    }

    #[test]
    fn lkg_manifest_description_none_round_trips() {
        let m = LkgManifest {
            format_version: 1u32,
            generator: "lit".into(),
            created_at: "2026-06-06T00:00:00Z".into(),
            bundle_type: "full".into(),
            title: "My Graph".into(),
            description: None,
            stats: LkgStats {
                node_count: 2,
                edge_count: 1,
                annotation_count: 0,
                asset_count: 1,
                total_size_bytes: 123,
            },
            graph_hash: "sha256:abc".into(),
        };
        let s = serde_json::to_string(&m).expect("serialize");
        let back: LkgManifest = serde_json::from_str(&s).expect("deserialize");
        assert_eq!(back, m);
    }

    #[test]
    fn bundle_node_round_trips() {
        let n = BundleNode {
            id: "Folder/Page.md".into(),
            title: "Page".into(),
            first_paragraph: "Intro.".into(),
            frontmatter: json!({"title": "Page"}),
            is_stub: false,
            tags: vec!["a".into()],
            aliases: vec!["P".into()],
        };
        let s = serde_json::to_string(&n).expect("serialize");
        let back: BundleNode = serde_json::from_str(&s).expect("deserialize");
        assert_eq!(back, n);

        let v = serde_json::to_value(&n).expect("to_value");
        assert!(v["frontmatter"].is_object());
        assert_eq!(v["is_stub"], false);
    }

    #[test]
    fn bundle_node_stub_round_trips() {
        let n = BundleNode {
            id: "Folder/Stub.md".into(),
            title: "Stub".into(),
            first_paragraph: "".into(),
            frontmatter: json!({}),
            is_stub: true,
            tags: vec![],
            aliases: vec![],
        };
        let s = serde_json::to_string(&n).expect("serialize");
        let back: BundleNode = serde_json::from_str(&s).expect("deserialize");
        assert_eq!(back, n);
    }

    #[test]
    fn bundle_edge_round_trips() {
        let e = BundleEdge {
            source: "a.md".into(),
            target: "b.md".into(),
            context: "see [[b]]".into(),
            raw_target: "b".into(),
            source_line: 5u32,
            edge_kind: "citation".into(),
        };
        let s = serde_json::to_string(&e).expect("serialize");
        let back: BundleEdge = serde_json::from_str(&s).expect("deserialize");
        assert_eq!(back, e);

        let v = serde_json::to_value(&e).expect("to_value");
        assert_eq!(v["source_line"], 5);
        assert_eq!(v["edge_kind"], "citation");
    }

    #[test]
    fn bundle_edge_legacy_json_defaults_to_wikilink() {
        // Edges from pre-edge_kind bundles must deserialize with the default.
        let legacy = r#"{"source":"a.md","target":"b.md","context":"","raw_target":"b","source_line":5}"#;
        let e: BundleEdge = serde_json::from_str(legacy).expect("deserialize legacy");
        assert_eq!(e.edge_kind, "wikilink");
    }

    #[test]
    fn bundle_edge_wikilink_kind_omitted_citation_kind_serialized() {
        // Wikilink edges must serialize WITHOUT the edge_kind key so legacy
        // bundles' graph hashes (computed before the field existed) still
        // verify on import.
        let wiki = BundleEdge {
            source: "a.md".into(),
            target: "b.md".into(),
            context: "".into(),
            raw_target: "b".into(),
            source_line: 1u32,
            edge_kind: "wikilink".into(),
        };
        let v = serde_json::to_value(&wiki).expect("to_value");
        assert!(v.get("edge_kind").is_none());

        let cite = BundleEdge { edge_kind: "citation".into(), ..wiki };
        let v = serde_json::to_value(&cite).expect("to_value");
        assert_eq!(v["edge_kind"], "citation");
    }

    #[test]
    fn bundle_annotation_is_full_annotation_record() {
        // BundleAnnotation must be the SAME type as graph::types::FullAnnotationRecord
        // (a type alias), so a FullAnnotationRecord is assignable to a BundleAnnotation
        // binding and the two compare equal across names.
        let full = crate::graph::types::FullAnnotationRecord {
            uuid: "uuid-1".into(),
            node_id: "a.md".into(),
            annotation_type: "claim".into(),
            certainty: "high".into(),
            body: Some("text".into()),
            date: Some("2026-01-01".into()),
            source_line: 3u32,
            char_start: 10usize,
            char_end: 20usize,
            scope_kind: "char".into(),
            scope_value: "x".into(),
        };
        let alias_view: BundleAnnotation = full.clone();
        assert_eq!(alias_view, full);
    }

    #[test]
    fn bundle_annotation_alias_serde_is_identical() {
        // The on-disk .lkg JSON shape must stay byte-compatible: a FullAnnotationRecord
        // serialized then deserialized as a BundleAnnotation round-trips all 11 fields.
        let full = crate::graph::types::FullAnnotationRecord {
            uuid: "uuid-9".into(),
            node_id: "b.md".into(),
            annotation_type: "note".into(),
            certainty: "low".into(),
            body: Some("body".into()),
            date: Some("2026-02-02".into()),
            source_line: 7u32,
            char_start: 1usize,
            char_end: 4usize,
            scope_kind: "line".into(),
            scope_value: "y".into(),
        };
        let s = serde_json::to_string(&full).expect("serialize full");
        let back: BundleAnnotation = serde_json::from_str(&s).expect("deserialize as bundle");
        assert_eq!(back.uuid, full.uuid);
        assert_eq!(back.node_id, full.node_id);
        assert_eq!(back.annotation_type, full.annotation_type);
        assert_eq!(back.certainty, full.certainty);
        assert_eq!(back.body, full.body);
        assert_eq!(back.date, full.date);
        assert_eq!(back.source_line, full.source_line);
        assert_eq!(back.char_start, full.char_start);
        assert_eq!(back.char_end, full.char_end);
        assert_eq!(back.scope_kind, full.scope_kind);
        assert_eq!(back.scope_value, full.scope_value);
    }

    #[test]
    fn bundle_annotation_round_trips() {
        let a = BundleAnnotation {
            uuid: "uuid-1".into(),
            node_id: "a.md".into(),
            annotation_type: "claim".into(),
            certainty: "high".into(),
            body: Some("text".into()),
            date: Some("2026-01-01".into()),
            source_line: 3u32,
            char_start: 10usize,
            char_end: 20usize,
            scope_kind: "char".into(),
            scope_value: "x".into(),
        };
        let s = serde_json::to_string(&a).expect("serialize");
        let back: BundleAnnotation = serde_json::from_str(&s).expect("deserialize");
        assert_eq!(back, a);
    }

    #[test]
    fn bundle_annotation_none_fields_round_trips() {
        let a = BundleAnnotation {
            uuid: "uuid-1".into(),
            node_id: "a.md".into(),
            annotation_type: "claim".into(),
            certainty: "high".into(),
            body: None,
            date: None,
            source_line: 3u32,
            char_start: 10usize,
            char_end: 20usize,
            scope_kind: "char".into(),
            scope_value: "x".into(),
        };
        let s = serde_json::to_string(&a).expect("serialize");
        let back: BundleAnnotation = serde_json::from_str(&s).expect("deserialize");
        assert_eq!(back, a);
    }

    #[test]
    fn lkg_export_summary_round_trips() {
        let summary = LkgExportSummary {
            exported_count: 7usize,
            destination: "/tmp/out.lkg".into(),
            graph_hash: "sha256:abc".into(),
        };
        let s = serde_json::to_string(&summary).expect("serialize");
        let back: LkgExportSummary = serde_json::from_str(&s).expect("deserialize");
        assert_eq!(back, summary);

        let v = serde_json::to_value(&summary).expect("to_value");
        assert_eq!(v["exported_count"], 7);
    }

    #[test]
    fn lkg_import_summary_round_trips() {
        let summary = LkgImportSummary {
            node_count: 2,
            edge_count: 1,
            annotation_count: 0,
            file_count: 3usize,
        };
        let s = serde_json::to_string(&summary).expect("serialize");
        let back: LkgImportSummary = serde_json::from_str(&s).expect("deserialize");
        assert_eq!(back, summary);

        let v = serde_json::to_value(&summary).expect("to_value");
        assert_eq!(v["file_count"], 3);
    }
}
