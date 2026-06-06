use crate::graph::error::GraphError;
use crate::graph::store::Store;
use crate::graph::types::{extract_aliases, extract_tags, Position};
use crate::lkg::hash::compute_content_hash;
use crate::lkg::types::{
    BundleAnnotation, BundleEdge, BundleNode, LkgExportSummary, LkgManifest, LkgStats,
};
use std::collections::HashMap;
use std::io::Write;
use std::path::Path;
use zip::write::SimpleFileOptions;

/// Maps every node row in `store` into a [`BundleNode`], sorted by id.
///
/// Tags are derived from each node's parsed frontmatter (there is no all-tags
/// query on `Store`); aliases come from the `aliases` table, falling back to
/// frontmatter extraction when the table has no rows for a node.
pub fn collect_bundle_nodes(store: &Store) -> Result<Vec<BundleNode>, GraphError> {
    let metadata = store.all_nodes_metadata()?; // Vec<(id, is_stub)>, sorted by id.
    let titles = store.node_titles()?;
    let frontmatters = store.node_frontmatter_map()?;
    let all_ids: Vec<String> = metadata.iter().map(|(id, _)| id.clone()).collect();
    let first_paragraphs = store.get_first_paragraphs(&all_ids)?;
    let aliases_map = store.all_aliases()?;

    let mut nodes = Vec::with_capacity(metadata.len());
    for (id, is_stub) in metadata {
        let frontmatter = frontmatters
            .get(&id)
            .cloned()
            .unwrap_or_else(|| serde_json::Value::Object(Default::default()));
        let tags = extract_tags(&frontmatter);
        let aliases = match aliases_map.get(&id) {
            Some(a) => a.clone(),
            None => extract_aliases(&frontmatter),
        };
        nodes.push(BundleNode {
            title: titles.get(&id).cloned().unwrap_or_default(),
            first_paragraph: first_paragraphs.get(&id).cloned().unwrap_or_default(),
            frontmatter,
            is_stub,
            tags,
            aliases,
            id,
        });
    }
    Ok(nodes)
}

/// Maps every edge row in `store` into a [`BundleEdge`], preserving the
/// store's ordering (sorted by source then target).
pub fn collect_bundle_edges(store: &Store) -> Result<Vec<BundleEdge>, GraphError> {
    let edges = store
        .all_edges_full()?
        .into_iter()
        .map(|(source, target, context, raw_target, source_line)| BundleEdge {
            source,
            target,
            context,
            raw_target,
            source_line,
        })
        .collect();
    Ok(edges)
}

/// Maps every annotation row in `store` into a [`BundleAnnotation`], preserving
/// the store's ordering (sorted by node_id then char_start).
pub fn collect_bundle_annotations(store: &Store) -> Result<Vec<BundleAnnotation>, GraphError> {
    let anns = store
        .all_annotations_full()?
        .into_iter()
        .map(|r| BundleAnnotation {
            uuid: r.uuid,
            node_id: r.node_id,
            annotation_type: r.annotation_type,
            certainty: r.certainty,
            body: r.body,
            date: r.date,
            source_line: r.source_line,
            char_start: r.char_start,
            char_end: r.char_end,
            scope_kind: r.scope_kind,
            scope_value: r.scope_value,
        })
        .collect();
    Ok(anns)
}

/// Formats the current wall-clock time as an RFC 3339 UTC timestamp
/// (`YYYY-MM-DDTHH:MM:SSZ`). Implemented without a date crate by converting
/// the UNIX epoch seconds via the civil-from-days algorithm.
fn now_rfc3339() -> String {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);

    let days = secs.div_euclid(86_400);
    let rem = secs.rem_euclid(86_400);
    let (hour, min, sec) = (rem / 3600, (rem % 3600) / 60, rem % 60);

    // Civil-from-days (Howard Hinnant's algorithm), epoch shifted to 0000-03-01.
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let year = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = if month <= 2 { year + 1 } else { year };

    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z",
        year, month, day, hour, min, sec
    )
}

/// Writes a single in-memory entry (JSON bytes) to the zip under `name`.
fn write_zip_bytes(
    zip: &mut zip::ZipWriter<std::fs::File>,
    name: &str,
    bytes: &[u8],
    options: SimpleFileOptions,
) -> Result<(), String> {
    zip.start_file(name, options).map_err(|e| e.to_string())?;
    zip.write_all(bytes).map_err(|e| e.to_string())?;
    Ok(())
}

/// Serializes `value` to pretty JSON and writes it to the zip under `name`.
fn write_zip_json<T: serde::Serialize>(
    zip: &mut zip::ZipWriter<std::fs::File>,
    name: &str,
    value: &T,
    options: SimpleFileOptions,
) -> Result<(), String> {
    let bytes = serde_json::to_vec_pretty(value).map_err(|e| e.to_string())?;
    write_zip_bytes(zip, name, &bytes, options)
}

/// Writes a complete `.lkg` bundle zip to `dest`.
///
/// Entry order is fixed: (1) `manifest.json` first, (2) `content/<path>` for
/// every workspace file, (3) `graph/{nodes,edges,positions}.json`, and finally
/// (4) `annotations/annotations.json`. `on_progress(current, total)` is called
/// after each entry is written, with `current` monotonically increasing to
/// `total`.
#[allow(clippy::too_many_arguments)]
pub fn write_lkg_zip<F>(
    root: &Path,
    nodes: &[BundleNode],
    edges: &[BundleEdge],
    annotations: &[BundleAnnotation],
    positions: &HashMap<String, Position>,
    title: &str,
    description: Option<&str>,
    dest: &Path,
    on_progress: F,
) -> Result<LkgExportSummary, String>
where
    F: Fn(usize, usize),
{
    let content_entries = crate::export::collect_export_files(root)?;

    // Total write steps: manifest + content files + 3 graph files + annotations.
    let total = 1 + content_entries.len() + 3 + 1;
    let mut current = 0usize;
    let mut bump = |on_progress: &F| {
        current += 1;
        on_progress(current, total);
    };

    let file = std::fs::File::create(dest).map_err(|e| e.to_string())?;
    let mut zip = zip::ZipWriter::new(file);
    let options = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);

    // Compute stats and content hash for the manifest.
    let asset_count = content_entries
        .iter()
        .filter(|e| !e.relative_path.ends_with(".md"))
        .count() as u64;
    let total_size_bytes: u64 = content_entries
        .iter()
        .filter_map(|e| std::fs::metadata(&e.absolute_path).ok())
        .map(|m| m.len())
        .sum();
    let content_hash = compute_content_hash(nodes, edges, annotations);

    let manifest = LkgManifest {
        format_version: 1,
        generator: "lit".into(),
        created_at: now_rfc3339(),
        bundle_type: "full".into(),
        title: title.to_string(),
        description: description.map(|s| s.to_string()),
        stats: LkgStats {
            node_count: nodes.len() as u64,
            edge_count: edges.len() as u64,
            annotation_count: annotations.len() as u64,
            asset_count,
            total_size_bytes,
        },
        content_hash: content_hash.clone(),
    };

    // (1) manifest.json — always first.
    write_zip_json(&mut zip, "manifest.json", &manifest, options)?;
    bump(&on_progress);

    // (2) content/<relative_path> for each workspace file.
    for entry in &content_entries {
        let data = std::fs::read(&entry.absolute_path).map_err(|e| e.to_string())?;
        let name = format!("content/{}", entry.relative_path);
        write_zip_bytes(&mut zip, &name, &data, options)?;
        bump(&on_progress);
    }

    // (3) graph/ files.
    write_zip_json(&mut zip, "graph/nodes.json", &nodes, options)?;
    bump(&on_progress);
    write_zip_json(&mut zip, "graph/edges.json", &edges, options)?;
    bump(&on_progress);
    write_zip_json(&mut zip, "graph/positions.json", &positions, options)?;
    bump(&on_progress);

    // (4) annotations/annotations.json.
    write_zip_json(&mut zip, "annotations/annotations.json", &annotations, options)?;
    bump(&on_progress);

    zip.finish().map_err(|e| e.to_string())?;

    Ok(LkgExportSummary {
        exported_count: content_entries.len(),
        destination: dest.to_string_lossy().to_string(),
        content_hash,
    })
}

/// Exports the full workspace at `root` (with its indexed graph) as a `.lkg`
/// bundle written to `dest`. Reads node/edge/annotation data from the
/// `graph_index`'s in-memory store and positions from its layout state.
pub fn export_lkg<F>(
    root: &Path,
    graph_index: &crate::graph::indexer::GraphIndex,
    title: &str,
    description: Option<&str>,
    dest: &Path,
    on_progress: F,
) -> Result<LkgExportSummary, String>
where
    F: Fn(usize, usize),
{
    let (nodes, edges, annotations) = {
        let store = graph_index.store();
        let nodes = collect_bundle_nodes(&store).map_err(|e| e.to_string())?;
        let edges = collect_bundle_edges(&store).map_err(|e| e.to_string())?;
        let annotations = collect_bundle_annotations(&store).map_err(|e| e.to_string())?;
        (nodes, edges, annotations)
    };
    let positions = graph_index.get_positions();

    write_lkg_zip(
        root,
        &nodes,
        &edges,
        &annotations,
        &positions,
        title,
        description,
        dest,
        on_progress,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::graph::types::{IndexableAnnotation, ParsedNode, Position};
    use serde_json::json;
    use std::collections::HashMap;

    fn mem_store() -> Store {
        Store::open_memory().expect("open in-memory store")
    }

    // --- D1: collect_bundle_nodes ---

    #[test]
    fn collect_bundle_nodes_maps_store_rows() {
        let store = mem_store();
        let node = ParsedNode {
            id: "a.md".into(),
            title: "A".into(),
            tags: vec!["t1".into()],
            frontmatter: json!({"aliases": ["AL"], "tags": ["t1"]}),
            first_paragraph: "Intro".into(),
        };
        store.upsert_node(&node, 0).unwrap();
        store.upsert_stub("ghost").unwrap();

        let nodes = collect_bundle_nodes(&store).unwrap();
        // Sorted by id: "a.md" then "ghost".
        assert_eq!(nodes.len(), 2);
        assert_eq!(nodes[0].id, "a.md");
        assert_eq!(nodes[0].title, "A");
        assert_eq!(nodes[0].first_paragraph, "Intro");
        assert!(!nodes[0].is_stub);
        assert!(nodes[0].frontmatter.is_object());
        assert_eq!(nodes[0].tags, vec!["t1".to_string()]);
        assert_eq!(nodes[0].aliases, vec!["AL".to_string()]);

        assert_eq!(nodes[1].id, "ghost");
        assert!(nodes[1].is_stub);
        assert_eq!(nodes[1].first_paragraph, "");
    }

    fn seed_node(store: &Store, id: &str) {
        let node = ParsedNode {
            id: id.into(),
            title: id.into(),
            tags: vec![],
            frontmatter: json!({}),
            first_paragraph: "".into(),
        };
        store.upsert_node(&node, 0).unwrap();
    }

    // --- D2: collect_bundle_edges ---

    #[test]
    fn collect_bundle_edges_maps_tuples() {
        let store = mem_store();
        seed_node(&store, "a.md");
        seed_node(&store, "b.md");
        store
            .replace_all_edges(&[("a.md", "b.md", "see [[b]]", "b", 5)])
            .unwrap();

        let edges = collect_bundle_edges(&store).unwrap();
        assert_eq!(
            edges,
            vec![BundleEdge {
                source: "a.md".into(),
                target: "b.md".into(),
                context: "see [[b]]".into(),
                raw_target: "b".into(),
                source_line: 5,
            }]
        );
    }

    // --- D3: collect_bundle_annotations ---

    #[test]
    fn collect_bundle_annotations_maps_full_records() {
        let store = mem_store();
        seed_node(&store, "a.md");
        let ann = IndexableAnnotation {
            annotation_type: "claim".into(),
            certainty: "high".into(),
            body: Some("text".into()),
            date: Some("2026-01-01".into()),
            source_line: 3,
            char_start: 10,
            char_end: 20,
            scope_kind: "char".into(),
            scope_value: "x".into(),
            uuid: None,
        };
        store.upsert_annotations("a.md", &[ann]).unwrap();

        let anns = collect_bundle_annotations(&store).unwrap();
        assert_eq!(anns.len(), 1);
        let a = &anns[0];
        assert_eq!(a.node_id, "a.md");
        assert_eq!(a.annotation_type, "claim");
        assert_eq!(a.certainty, "high");
        assert_eq!(a.char_start, 10);
        assert_eq!(a.char_end, 20);
        assert_eq!(a.scope_kind, "char");
        assert_eq!(a.scope_value, "x");
        assert_eq!(a.source_line, 3);
        assert!(!a.uuid.is_empty());
    }

    // --- D4: write_lkg_zip — manifest first entry ---

    #[test]
    fn write_lkg_zip_manifest_is_first_entry() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("note.md"), "hello").unwrap();
        let dest = dir.path().join("out.lkg");

        let nodes: Vec<BundleNode> = vec![];
        let edges: Vec<BundleEdge> = vec![];
        let annotations: Vec<BundleAnnotation> = vec![];
        let positions: HashMap<String, Position> = HashMap::new();

        write_lkg_zip(
            dir.path(),
            &nodes,
            &edges,
            &annotations,
            &positions,
            "Title",
            None,
            &dest,
            |_, _| {},
        )
        .unwrap();

        let file = std::fs::File::open(&dest).unwrap();
        let mut archive = zip::ZipArchive::new(file).unwrap();
        assert_eq!(archive.name_for_index(0).unwrap(), "manifest.json");
        let entry = archive.by_index(0).unwrap();
        let manifest: crate::lkg::types::LkgManifest = serde_json::from_reader(entry).unwrap();
        assert_eq!(manifest.format_version, 1);
        assert_eq!(manifest.bundle_type, "full");
    }

    fn zip_names(dest: &std::path::Path) -> Vec<String> {
        let file = std::fs::File::open(dest).unwrap();
        let archive = zip::ZipArchive::new(file).unwrap();
        (0..archive.len())
            .map(|i| archive.name_for_index(i).unwrap().to_string())
            .collect()
    }

    fn read_zip_json<T: serde::de::DeserializeOwned>(dest: &std::path::Path, name: &str) -> T {
        let file = std::fs::File::open(dest).unwrap();
        let mut archive = zip::ZipArchive::new(file).unwrap();
        let entry = archive.by_name(name).unwrap();
        serde_json::from_reader(entry).unwrap()
    }

    // --- D5: content/ prefix ---

    #[test]
    fn write_lkg_zip_content_files_prefixed() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("note.md"), "hello").unwrap();
        let dest = dir.path().join("out.lkg");
        write_lkg_zip(
            dir.path(),
            &[],
            &[],
            &[],
            &HashMap::new(),
            "T",
            None,
            &dest,
            |_, _| {},
        )
        .unwrap();

        let names = zip_names(&dest);
        assert!(names.iter().any(|n| n == "content/note.md"));
        assert!(!names.iter().any(|n| n == "note.md"));
    }

    // --- D6: graph/ files ---

    #[test]
    fn write_lkg_zip_graph_files_present() {
        let dir = tempfile::tempdir().unwrap();
        let dest = dir.path().join("out.lkg");
        let nodes = vec![
            BundleNode {
                id: "a.md".into(),
                title: "A".into(),
                first_paragraph: "".into(),
                frontmatter: json!({}),
                is_stub: false,
                tags: vec![],
                aliases: vec![],
            },
            BundleNode {
                id: "b.md".into(),
                title: "B".into(),
                first_paragraph: "".into(),
                frontmatter: json!({}),
                is_stub: false,
                tags: vec![],
                aliases: vec![],
            },
        ];
        let edges = vec![BundleEdge {
            source: "a.md".into(),
            target: "b.md".into(),
            context: "".into(),
            raw_target: "b".into(),
            source_line: 1,
        }];
        let mut positions = HashMap::new();
        positions.insert("a.md".to_string(), Position { x: 1.0, y: 2.0 });

        write_lkg_zip(
            dir.path(),
            &nodes,
            &edges,
            &[],
            &positions,
            "T",
            None,
            &dest,
            |_, _| {},
        )
        .unwrap();

        let read_nodes: Vec<BundleNode> = read_zip_json(&dest, "graph/nodes.json");
        let read_edges: Vec<BundleEdge> = read_zip_json(&dest, "graph/edges.json");
        let read_positions: HashMap<String, Position> = read_zip_json(&dest, "graph/positions.json");
        assert_eq!(read_nodes.len(), 2);
        assert_eq!(read_edges.len(), 1);
        assert_eq!(read_positions.len(), 1);
    }

    // --- D7: annotations/annotations.json ---

    #[test]
    fn write_lkg_zip_annotations_present() {
        let dir = tempfile::tempdir().unwrap();
        let dest = dir.path().join("out.lkg");
        let annotations = vec![BundleAnnotation {
            uuid: "u1".into(),
            node_id: "a.md".into(),
            annotation_type: "claim".into(),
            certainty: "high".into(),
            body: None,
            date: None,
            source_line: 1,
            char_start: 0,
            char_end: 1,
            scope_kind: "char".into(),
            scope_value: "x".into(),
        }];
        write_lkg_zip(
            dir.path(),
            &[],
            &[],
            &annotations,
            &HashMap::new(),
            "T",
            None,
            &dest,
            |_, _| {},
        )
        .unwrap();

        let read: Vec<BundleAnnotation> = read_zip_json(&dest, "annotations/annotations.json");
        assert_eq!(read.len(), 1);
    }

    // --- D8: content_hash valid ---

    #[test]
    fn write_lkg_zip_manifest_content_hash_valid() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("note.md"), "hello").unwrap();
        let dest = dir.path().join("out.lkg");
        write_lkg_zip(
            dir.path(),
            &[],
            &[],
            &[],
            &HashMap::new(),
            "T",
            None,
            &dest,
            |_, _| {},
        )
        .unwrap();

        let manifest: crate::lkg::types::LkgManifest = read_zip_json(&dest, "manifest.json");
        assert!(manifest.content_hash.starts_with("sha256:"));
        let hex = manifest.content_hash.strip_prefix("sha256:").unwrap();
        assert_eq!(hex.len(), 64);
        assert!(hex.chars().all(|c| c.is_ascii_hexdigit()));
    }

    // --- D9: progress callback ---

    #[test]
    fn write_lkg_zip_progress_monotonic() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("a.md"), "1").unwrap();
        std::fs::write(dir.path().join("b.md"), "2").unwrap();
        let dest = dir.path().join("out.lkg");

        let calls = std::sync::Mutex::new(Vec::new());
        write_lkg_zip(
            dir.path(),
            &[],
            &[],
            &[],
            &HashMap::new(),
            "T",
            None,
            &dest,
            |current, total| calls.lock().unwrap().push((current, total)),
        )
        .unwrap();

        let calls = calls.into_inner().unwrap();
        assert!(!calls.is_empty());
        let total = calls[0].1;
        assert!(calls.iter().all(|(_, t)| *t == total));
        for w in calls.windows(2) {
            assert!(w[1].0 >= w[0].0);
        }
        assert_eq!(calls.last().unwrap().0, total);
    }

    // --- D10: export_lkg end-to-end ---

    #[test]
    fn export_lkg_creates_valid_bundle() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(
            dir.path().join("a.md"),
            "# A\n\n[[b]]\n\n![](img.png)",
        )
        .unwrap();
        std::fs::write(dir.path().join("b.md"), "# B").unwrap();
        std::fs::write(dir.path().join("img.png"), b"fake png").unwrap();

        let gi =
            crate::graph::indexer::GraphIndex::build(dir.path().to_path_buf(), true).unwrap();
        let dest = dir.path().join("out.lkg");

        let summary =
            export_lkg(dir.path(), &gi, "My Graph", Some("desc"), &dest, |_, _| {}).unwrap();
        assert!(summary.content_hash.starts_with("sha256:"));

        let names = zip_names(&dest);
        assert_eq!(names[0], "manifest.json");
        assert!(names.iter().any(|n| n == "content/a.md"));
        assert!(names.iter().any(|n| n == "content/b.md"));
        assert!(names.iter().any(|n| n == "content/img.png"));
        assert!(names.iter().any(|n| n == "graph/nodes.json"));
        assert!(names.iter().any(|n| n == "graph/edges.json"));
        assert!(names.iter().any(|n| n == "graph/positions.json"));
        assert!(names.iter().any(|n| n == "annotations/annotations.json"));

        let manifest: crate::lkg::types::LkgManifest = read_zip_json(&dest, "manifest.json");
        assert_eq!(manifest.title, "My Graph");

        let read_nodes: Vec<BundleNode> = read_zip_json(&dest, "graph/nodes.json");
        let read_edges: Vec<BundleEdge> = read_zip_json(&dest, "graph/edges.json");
        assert_eq!(manifest.stats.node_count, read_nodes.len() as u64);
        assert_eq!(manifest.stats.edge_count, read_edges.len() as u64);
        // a.md links to b (real edge).
        assert!(read_edges.iter().any(|e| e.source == "a.md"));
    }
}
