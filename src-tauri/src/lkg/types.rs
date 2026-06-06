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
    pub content_hash: String,
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
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct BundleAnnotation {
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
pub struct LkgExportSummary {
    pub exported_count: usize,
    pub destination: String,
    pub content_hash: String,
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
            content_hash: "sha256:abc".into(),
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
            content_hash: "sha256:abc".into(),
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
        };
        let s = serde_json::to_string(&e).expect("serialize");
        let back: BundleEdge = serde_json::from_str(&s).expect("deserialize");
        assert_eq!(back, e);

        let v = serde_json::to_value(&e).expect("to_value");
        assert_eq!(v["source_line"], 5);
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
            content_hash: "sha256:abc".into(),
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
