use crate::graph::error::GraphError;
use crate::graph::store::Store;
use crate::graph::types::{IndexableAnnotation, ParsedNode, Position};
use crate::lkg::types::{
    BundleAnnotation, BundleEdge, BundleNode, LkgImportSummary, LkgManifest,
};
use std::collections::HashMap;
use std::fs::File;
use std::io::Read;
use std::path::{Component, Path, PathBuf};
use zip::ZipArchive;

/// The only `.lkg` format version this build understands. The exporter
/// hardcodes `format_version: 1`.
const SUPPORTED_FORMAT_VERSION: u32 = 1;

/// Opens the `.lkg` archive at `path` for reading.
fn open_archive(path: &Path) -> Result<ZipArchive<File>, String> {
    let file = File::open(path).map_err(|e| format!("cannot open bundle: {e}"))?;
    ZipArchive::new(file).map_err(|e| format!("invalid bundle archive: {e}"))
}

/// Opens the bundle at `path`, reads and validates its `manifest.json`, and
/// returns the parsed [`LkgManifest`].
pub fn validate_lkg(path: &Path) -> Result<LkgManifest, String> {
    let mut archive = open_archive(path)?;
    let entry = archive
        .by_name("manifest.json")
        .map_err(|e| format!("missing manifest.json: {e}"))?;
    let manifest: LkgManifest =
        serde_json::from_reader(entry).map_err(|e| format!("invalid manifest.json: {e}"))?;
    if manifest.format_version != SUPPORTED_FORMAT_VERSION {
        return Err(format!(
            "unsupported format version: {} (expected {})",
            manifest.format_version, SUPPORTED_FORMAT_VERSION
        ));
    }
    Ok(manifest)
}

/// Joins `rel` onto `target`, rejecting any path that would escape `target`.
///
/// The destination file does not exist yet, so canonicalization is impossible;
/// instead we walk `rel`'s components and refuse absolute roots, Windows
/// prefixes, and `..` parent traversal. Returns `None` when `rel` is unsafe.
fn safe_join(target: &Path, rel: &str) -> Option<PathBuf> {
    let mut out = target.to_path_buf();
    let mut pushed = false;
    for component in Path::new(rel).components() {
        match component {
            Component::Normal(part) => {
                out.push(part);
                pushed = true;
            }
            Component::CurDir => {}
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => return None,
        }
    }
    if pushed {
        Some(out)
    } else {
        None
    }
}

/// Writes a single archive entry's bytes to `dest`, creating parent
/// directories as needed.
fn write_entry(dest: &Path, bytes: &[u8]) -> Result<(), String> {
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("cannot create directory {}: {e}", parent.display()))?;
    }
    std::fs::write(dest, bytes).map_err(|e| format!("cannot write {}: {e}", dest.display()))
}

/// Extracts every `content/<path>` entry of the bundle at `path` into `target`,
/// stripping the `content/` prefix. Returns the number of files written.
/// Non-content entries (manifest, graph, annotations) are skipped.
pub fn extract_lkg_content(path: &Path, target: &Path) -> Result<usize, String> {
    let mut archive = open_archive(path)?;
    let mut written = 0usize;
    for i in 0..archive.len() {
        let mut entry = archive
            .by_index(i)
            .map_err(|e| format!("cannot read archive entry: {e}"))?;
        let name = entry.name().to_string();
        let Some(rel) = name.strip_prefix("content/") else {
            continue;
        };
        if rel.is_empty() || entry.is_dir() {
            continue;
        }
        let Some(dest) = safe_join(target, rel) else {
            return Err(format!("unsafe path in bundle: {name}"));
        };
        let mut bytes = Vec::new();
        entry
            .read_to_end(&mut bytes)
            .map_err(|e| format!("cannot read entry {name}: {e}"))?;
        write_entry(&dest, &bytes)?;
        written += 1;
    }
    Ok(written)
}

/// Reads and deserializes the archive entry named `name` as JSON of type `T`.
fn read_json<T: serde::de::DeserializeOwned>(
    archive: &mut ZipArchive<File>,
    name: &str,
) -> Result<T, String> {
    let entry = archive
        .by_name(name)
        .map_err(|e| format!("missing graph data: {name}: {e}"))?;
    serde_json::from_reader(entry).map_err(|e| format!("invalid {name}: {e}"))
}

#[allow(clippy::type_complexity)]
/// Reads the bundle's graph sections — `graph/nodes.json`, `graph/edges.json`,
/// `graph/positions.json`, and `annotations/annotations.json` — and returns
/// them as in-memory bundle structures.
pub fn load_lkg_graph_data(
    path: &Path,
) -> Result<
    (
        Vec<BundleNode>,
        Vec<BundleEdge>,
        HashMap<String, Position>,
        Vec<BundleAnnotation>,
    ),
    String,
> {
    let mut archive = open_archive(path)?;
    // `by_name` borrows the archive mutably, so read each section in sequence.
    let nodes: Vec<BundleNode> = read_json(&mut archive, "graph/nodes.json")?;
    let edges: Vec<BundleEdge> = read_json(&mut archive, "graph/edges.json")?;
    let positions: HashMap<String, Position> = read_json(&mut archive, "graph/positions.json")?;
    let annotations: Vec<BundleAnnotation> =
        read_json(&mut archive, "annotations/annotations.json")?;
    Ok((nodes, edges, positions, annotations))
}

/// Maps a [`BundleAnnotation`] into the store's [`IndexableAnnotation`],
/// preserving the original uuid so imported annotations keep stable identities.
fn to_indexable(b: &BundleAnnotation) -> IndexableAnnotation {
    IndexableAnnotation {
        annotation_type: b.annotation_type.clone(),
        certainty: b.certainty.clone(),
        body: b.body.clone(),
        date: b.date.clone(),
        source_line: b.source_line,
        char_start: b.char_start,
        char_end: b.char_end,
        scope_kind: b.scope_kind.clone(),
        scope_value: b.scope_value.clone(),
        uuid: Some(b.uuid.clone()),
    }
}

/// Inserts the decoded bundle graph into a (fresh) `store`.
///
/// Order: nodes, then edges, positions, and annotations. Each underlying
/// `Store` call autocommits independently — `&Store` exposes no public
/// transaction handle, so this is a sequence of writes rather than a single
/// atomic transaction. That is acceptable for import into a freshly created,
/// empty destination database.
///
/// Note: `BundleNode.aliases` is not persisted separately — `upsert_node`
/// re-derives aliases from the node's frontmatter. Round-trips hold because the
/// exporter derived aliases from the same frontmatter. Tags ARE persisted via
/// `ParsedNode.tags`.
pub fn import_graph_data(
    store: &Store,
    nodes: &[BundleNode],
    edges: &[BundleEdge],
    positions: &HashMap<String, Position>,
    annotations: &[BundleAnnotation],
) -> Result<(), GraphError> {
    for n in nodes {
        if n.is_stub {
            store.upsert_stub(&n.id)?;
        } else {
            let parsed = ParsedNode {
                id: n.id.clone(),
                title: n.title.clone(),
                tags: n.tags.clone(),
                frontmatter: n.frontmatter.clone(),
                first_paragraph: n.first_paragraph.clone(),
            };
            store.upsert_node(&parsed, 0)?;
        }
    }

    let edge_refs: Vec<(&str, &str, &str, &str, u32)> = edges
        .iter()
        .map(|e| {
            (
                e.source.as_str(),
                e.target.as_str(),
                e.context.as_str(),
                e.raw_target.as_str(),
                e.source_line,
            )
        })
        .collect();
    store.replace_all_edges(&edge_refs)?;

    store.save_positions(positions)?;

    // Group annotations by node_id, then upsert per node.
    let mut by_node: HashMap<&str, Vec<IndexableAnnotation>> = HashMap::new();
    for a in annotations {
        by_node
            .entry(a.node_id.as_str())
            .or_default()
            .push(to_indexable(a));
    }
    for (node_id, anns) in by_node {
        store.upsert_annotations(node_id, &anns)?;
    }

    Ok(())
}

/// Imports the `.lkg` bundle at `source` into the workspace at `destination`.
///
/// Validates the manifest, extracts all `content/` files, then loads the graph
/// data into a freshly created store at `destination/.lit/graph.db`.
pub fn import_lkg(source: &Path, destination: &Path) -> Result<LkgImportSummary, String> {
    validate_lkg(source)?;

    let file_count = extract_lkg_content(source, destination)?;
    let (nodes, edges, positions, annotations) = load_lkg_graph_data(source)?;

    let lit_dir = destination.join(".lit");
    std::fs::create_dir_all(&lit_dir)
        .map_err(|e| format!("cannot create {}: {e}", lit_dir.display()))?;
    let db_path = lit_dir.join("graph.db");
    let store = Store::open(&db_path).map_err(|e| e.to_string())?;

    import_graph_data(&store, &nodes, &edges, &positions, &annotations)
        .map_err(|e| e.to_string())?;

    Ok(LkgImportSummary {
        node_count: nodes.len() as u64,
        edge_count: edges.len() as u64,
        annotation_count: annotations.len() as u64,
        file_count,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::io::Write;
    use std::path::PathBuf;
    use zip::write::SimpleFileOptions;

    fn mem_store() -> Store {
        Store::open_memory().unwrap()
    }

    /// Writes a small workspace (a.md links to b and embeds img.png, plus b.md
    /// and img.png), indexes it, exports a real `.lkg`, and returns the bundle
    /// path. The bundle lives inside `dir` so the caller controls its lifetime.
    fn export_fixture(dir: &Path) -> PathBuf {
        std::fs::write(dir.join("a.md"), "# A\n\n[[b]]\n\n![](img.png)").unwrap();
        std::fs::write(dir.join("b.md"), "# B").unwrap();
        std::fs::write(dir.join("img.png"), b"fake png").unwrap();

        let gi = crate::graph::indexer::GraphIndex::build(dir.to_path_buf(), true).unwrap();
        let dest = dir.join("out.lkg");
        crate::lkg::export::export_lkg(dir, &gi, "My Graph", Some("desc"), &dest, |_, _| {}).unwrap();
        dest
    }

    /// Writes a zip with arbitrary (name, bytes) entries — used to craft
    /// malformed/partial archives that the exporter cannot produce.
    fn crafted_zip(dir: &Path, entries: &[(&str, &[u8])]) -> PathBuf {
        let dest = dir.join("crafted.lkg");
        let file = File::create(&dest).unwrap();
        let mut zip = zip::ZipWriter::new(file);
        let options =
            SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
        for (name, bytes) in entries {
            zip.start_file(*name, options).unwrap();
            zip.write_all(bytes).unwrap();
        }
        zip.finish().unwrap();
        dest
    }

    use crate::lkg::types::{LkgManifest, LkgStats};

    fn manifest_with_version(version: u32) -> Vec<u8> {
        let m = LkgManifest {
            format_version: version,
            generator: "lit".into(),
            created_at: "2026-06-06T00:00:00Z".into(),
            bundle_type: "full".into(),
            title: "T".into(),
            description: None,
            stats: LkgStats {
                node_count: 0,
                edge_count: 0,
                annotation_count: 0,
                asset_count: 0,
                total_size_bytes: 0,
            },
            content_hash: "sha256:abc".into(),
        };
        serde_json::to_vec(&m).unwrap()
    }

    // --- E1: validate_lkg rejects missing manifest ---

    #[test]
    fn validate_lkg_rejects_missing_manifest() {
        let dir = tempfile::tempdir().unwrap();
        let path = crafted_zip(&dir.path(), &[("graph/nodes.json", b"[]")]);
        let err = validate_lkg(&path).unwrap_err();
        assert!(
            err.to_lowercase().contains("manifest"),
            "expected error mentioning manifest, got: {err}"
        );
    }

    // --- E2: validate_lkg rejects unsupported version ---

    #[test]
    fn validate_lkg_rejects_unsupported_version() {
        let dir = tempfile::tempdir().unwrap();
        let manifest = manifest_with_version(999);
        let path = crafted_zip(&dir.path(), &[("manifest.json", &manifest)]);
        let err = validate_lkg(&path).unwrap_err();
        assert!(
            err.to_lowercase().contains("version"),
            "expected error mentioning version, got: {err}"
        );
    }

    // --- E3: validate_lkg returns manifest for valid archive ---

    #[test]
    fn validate_lkg_returns_manifest_for_valid_archive() {
        let dir = tempfile::tempdir().unwrap();
        let lkg = export_fixture(&dir.path());
        let manifest = validate_lkg(&lkg).unwrap();
        assert_eq!(manifest.format_version, 1);
        assert_eq!(manifest.bundle_type, "full");
    }

    // --- E4: extract_lkg_content writes content files ---

    #[test]
    fn extract_lkg_content_writes_content_files() {
        let dir = tempfile::tempdir().unwrap();
        let lkg = export_fixture(&dir.path());

        let target = tempfile::tempdir().unwrap();
        let count = extract_lkg_content(&lkg, &target.path()).unwrap();
        assert!(count >= 3, "expected at least 3 files, got {count}");

        assert!(target.path().join("a.md").exists());
        assert!(target.path().join("b.md").exists());
        assert!(target.path().join("img.png").exists());

        let a = std::fs::read_to_string(target.path().join("a.md")).unwrap();
        assert_eq!(a, "# A\n\n[[b]]\n\n![](img.png)");
    }

    // --- E5: extract_lkg_content skips non-content entries ---

    #[test]
    fn extract_lkg_content_skips_non_content() {
        let dir = tempfile::tempdir().unwrap();
        let lkg = export_fixture(&dir.path());

        let target = tempfile::tempdir().unwrap();
        extract_lkg_content(&lkg, &target.path()).unwrap();

        assert!(!target.path().join("manifest.json").exists());
        assert!(!target.path().join("graph").exists());
        assert!(!target.path().join("annotations").exists());
    }

    // --- E6: extract_lkg_content rejects path traversal ---

    #[test]
    fn extract_lkg_content_rejects_path_traversal() {
        let dir = tempfile::tempdir().unwrap();
        let path = crafted_zip(&dir.path(), &[("content/../../evil.txt", b"pwned")]);

        // Extract into a deeply nested target inside an isolated tempdir so any
        // `..` escape lands within `sandbox` (never the shared system temp).
        let sandbox = tempfile::tempdir().unwrap();
        let target = sandbox.path().join("a").join("b").join("c");
        std::fs::create_dir_all(&target).unwrap();

        let result = extract_lkg_content(&path, &target);

        // Either the call rejects the traversal, or it must not write anything
        // outside the target. Walk the whole sandbox and assert no stray file.
        let escaped = walk_files(sandbox.path())
            .into_iter()
            .any(|p| p.file_name().map(|n| n == "evil.txt").unwrap_or(false));
        assert!(
            !escaped,
            "path traversal escaped target (result was {result:?})"
        );
    }

    // --- E7: load_lkg_graph_data reads all sections ---

    #[test]
    fn load_lkg_graph_data_reads_all_sections() {
        let dir = tempfile::tempdir().unwrap();
        let lkg = export_fixture(&dir.path());

        let (nodes, edges, positions, annotations) = load_lkg_graph_data(&lkg).unwrap();
        assert_eq!(nodes.len(), 2);
        assert_eq!(edges.len(), 1);
        assert_eq!(annotations.len(), 0);
        // positions is a HashMap (may be empty for a fresh layout).
        let _: &HashMap<String, Position> = &positions;
    }

    // --- E8: load_lkg_graph_data errors on missing graph ---

    #[test]
    fn load_lkg_graph_data_errors_on_missing_graph() {
        let dir = tempfile::tempdir().unwrap();
        let manifest = manifest_with_version(1);
        let path = crafted_zip(&dir.path(), &[("manifest.json", &manifest)]);
        let err = load_lkg_graph_data(&path).unwrap_err();
        assert!(
            err.contains("nodes.json"),
            "expected error mentioning nodes.json, got: {err}"
        );
    }

    // --- E9: import_graph_data inserts nodes ---

    #[test]
    fn import_graph_data_inserts_nodes() {
        let store = mem_store();
        let nodes = vec![
            BundleNode {
                id: "a.md".into(),
                title: "A".into(),
                first_paragraph: "Intro".into(),
                frontmatter: json!({}),
                is_stub: false,
                tags: vec!["t1".into()],
                aliases: vec![],
            },
            BundleNode {
                id: "ghost".into(),
                title: "".into(),
                first_paragraph: "".into(),
                frontmatter: json!({}),
                is_stub: true,
                tags: vec![],
                aliases: vec![],
            },
        ];

        import_graph_data(&store, &nodes, &[], &HashMap::new(), &[]).unwrap();

        let metadata = store.all_nodes_metadata().unwrap();
        let map: HashMap<String, bool> = metadata.into_iter().collect();
        assert_eq!(map.get("a.md"), Some(&false));
        assert_eq!(map.get("ghost"), Some(&true));
        assert_eq!(store.node_titles().unwrap().get("a.md"), Some(&"A".to_string()));
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

    // --- E10: import_graph_data inserts edges ---

    #[test]
    fn import_graph_data_inserts_edges() {
        let store = mem_store();
        seed_node(&store, "a.md");
        seed_node(&store, "b.md");

        let edges = vec![BundleEdge {
            source: "a.md".into(),
            target: "b.md".into(),
            context: "see [[b]]".into(),
            raw_target: "b".into(),
            source_line: 5,
        }];
        import_graph_data(&store, &[], &edges, &HashMap::new(), &[]).unwrap();

        assert_eq!(
            store.all_edges_full().unwrap(),
            vec![(
                "a.md".to_string(),
                "b.md".to_string(),
                "see [[b]]".to_string(),
                "b".to_string(),
                5u32
            )]
        );
    }

    // --- E11: import_graph_data inserts positions ---

    #[test]
    fn import_graph_data_inserts_positions() {
        let store = mem_store();
        seed_node(&store, "a.md");

        let mut positions = HashMap::new();
        positions.insert("a.md".to_string(), Position { x: 1.0, y: 2.0 });
        import_graph_data(&store, &[], &[], &positions, &[]).unwrap();

        let loaded = store.load_positions().unwrap();
        assert_eq!(loaded.get("a.md"), Some(&Position { x: 1.0, y: 2.0 }));
    }

    // --- E12: import_graph_data inserts annotations ---

    #[test]
    fn import_graph_data_inserts_annotations() {
        let store = mem_store();
        seed_node(&store, "a.md");

        let annotations = vec![BundleAnnotation {
            uuid: "u1".into(),
            node_id: "a.md".into(),
            annotation_type: "claim".into(),
            certainty: "high".into(),
            body: Some("text".into()),
            date: None,
            source_line: 3,
            char_start: 10,
            char_end: 20,
            scope_kind: "char".into(),
            scope_value: "x".into(),
        }];
        import_graph_data(&store, &[], &[], &HashMap::new(), &annotations).unwrap();

        let rows = store.list_annotations(Some("a.md"), None, 100).unwrap();
        assert_eq!(rows.len(), 1);
        let r = &rows[0];
        assert_eq!(r.node_id, "a.md");
        assert_eq!(r.annotation_type, "claim");
        assert_eq!(r.char_start, 10);
        assert_eq!(r.uuid, "u1");
    }

    // --- E13: import_lkg end-to-end ---

    #[test]
    fn import_lkg_end_to_end() {
        let dir1 = tempfile::tempdir().unwrap();
        let lkg = export_fixture(&dir1.path());

        let dir2 = tempfile::tempdir().unwrap();
        let summary = import_lkg(&lkg, &dir2.path()).unwrap();

        assert!(dir2.path().join("a.md").exists());
        assert!(dir2.path().join("b.md").exists());
        assert!(dir2.path().join("img.png").exists());
        assert!(dir2.path().join(".lit").join("graph.db").exists());

        assert_eq!(summary.node_count, 2);
        assert_eq!(summary.edge_count, 1);
        assert_eq!(summary.annotation_count, 0);
        assert_eq!(summary.file_count, 3);

        let db_path = dir2.path().join(".lit").join("graph.db");
        let store = Store::open(&db_path).unwrap();
        assert_eq!(store.all_nodes_metadata().unwrap().len(), 2);
        assert_eq!(store.all_edges_full().unwrap().len(), 1);
    }

    /// Recursively collects every regular file path under `dir`.
    fn walk_files(dir: &Path) -> Vec<PathBuf> {
        let mut out = Vec::new();
        let Ok(entries) = std::fs::read_dir(dir) else {
            return out;
        };
        for entry in entries.flatten() {
            let p = entry.path();
            if p.is_dir() {
                out.extend(walk_files(&p));
            } else {
                out.push(p);
            }
        }
        out
    }
}
