use crate::graph::error::GraphError;
use crate::graph::store::Store;
use crate::graph::types::{EdgeKind, IndexableAnnotation, ParsedNode, Position};
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

#[cfg(test)]
thread_local! {
    /// Test-only, per-thread counter of how many times [`open_archive`] has been
    /// called. Used by `import_lkg_opens_archive_once` to assert an import opens
    /// (and central-directory-parses) the bundle exactly once. Thread-local so
    /// the assertion is unaffected by other tests opening archives on other
    /// threads under cargo's parallel runner. Fully gated out of release builds.
    static OPEN_ARCHIVE_COUNT: std::cell::Cell<usize> = const { std::cell::Cell::new(0) };
}

/// Opens the `.lkg` archive at `path` for reading.
fn open_archive(path: &Path) -> Result<ZipArchive<File>, String> {
    #[cfg(test)]
    OPEN_ARCHIVE_COUNT.with(|c| c.set(c.get() + 1));
    let file = File::open(path).map_err(|e| format!("cannot open bundle: {e}"))?;
    ZipArchive::new(file).map_err(|e| format!("invalid bundle archive: {e}"))
}

/// Opens the bundle at `path`, reads and validates its `manifest.json`, and
/// returns the parsed [`LkgManifest`].
pub fn validate_lkg(path: &Path) -> Result<LkgManifest, String> {
    let mut archive = open_archive(path)?;
    validate_lkg_from_archive(&mut archive)
}

/// Reads and validates `manifest.json` from an already-open `archive`.
///
/// Factored out so `import_lkg` can validate, extract, and load graph data from
/// a single [`ZipArchive`] handle without re-parsing the central directory.
fn validate_lkg_from_archive(archive: &mut ZipArchive<File>) -> Result<LkgManifest, String> {
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
    extract_lkg_content_from_archive(&mut archive, target)
}

/// Extracts every `content/<path>` entry of an already-open `archive` into
/// `target`, stripping the `content/` prefix. Returns the number of files
/// written. Factored out so `import_lkg` can reuse one [`ZipArchive`] handle.
fn extract_lkg_content_from_archive(
    archive: &mut ZipArchive<File>,
    target: &Path,
) -> Result<usize, String> {
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
    load_lkg_graph_data_from_archive(&mut archive)
}

/// Reads the bundle's graph sections from an already-open `archive`. Factored
/// out so `import_lkg` can reuse one [`ZipArchive`] handle across validate,
/// extract, and load steps.
#[allow(clippy::type_complexity)]
fn load_lkg_graph_data_from_archive(
    archive: &mut ZipArchive<File>,
) -> Result<
    (
        Vec<BundleNode>,
        Vec<BundleEdge>,
        HashMap<String, Position>,
        Vec<BundleAnnotation>,
    ),
    String,
> {
    // `by_name` borrows the archive mutably, so read each section in sequence.
    let nodes: Vec<BundleNode> = read_json(archive, "graph/nodes.json")?;
    let edges: Vec<BundleEdge> = read_json(archive, "graph/edges.json")?;
    let positions: HashMap<String, Position> = read_json(archive, "graph/positions.json")?;
    let annotations: Vec<BundleAnnotation> = read_json(archive, "annotations/annotations.json")?;
    Ok((nodes, edges, positions, annotations))
}

/// Inserts the decoded bundle graph into a (fresh) `store`.
///
/// Order: nodes, then edges, positions, and annotations. The whole sequence
/// runs inside a single SQLite `SAVEPOINT` (`lkg_import`): it is released on
/// success and rolled back on any error, so a mid-import failure (e.g. disk
/// full while writing annotations) leaves the destination database unchanged
/// rather than half-populated. Wrapping all writes in one savepoint also
/// collapses the per-node WAL flushes into a single commit, making large
/// imports orders of magnitude faster.
///
/// Note: positions are written via `Store::write_positions_no_tx` rather than
/// `save_positions`, because the latter opens its own inner transaction
/// (`BEGIN DEFERRED`), and SQLite forbids `BEGIN` inside an active SAVEPOINT.
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
    store.with_savepoint("lkg_import", || {
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
                store.upsert_node(&parsed, 0, None)?;
            }
        }

        let edge_refs: Vec<(&str, &str, &str, &str, u32, EdgeKind)> = edges
            .iter()
            .map(|e| {
                (
                    e.source.as_str(),
                    e.target.as_str(),
                    e.context.as_str(),
                    e.raw_target.as_str(),
                    e.source_line,
                    EdgeKind::from(e.edge_kind.as_str()),
                )
            })
            .collect();
        store.replace_all_edges_no_tx(&edge_refs)?;

        store.write_positions_no_tx(positions)?;

        let mut by_node: HashMap<&str, Vec<IndexableAnnotation>> = HashMap::new();
        for a in annotations {
            by_node
                .entry(a.node_id.as_str())
                .or_default()
                .push(a.clone().into());
        }
        for (node_id, anns) in by_node {
            store.upsert_annotations(node_id, &anns)?;
        }

        Ok(())
    })
}

/// Returns `true` when `destination` is already an initialized Lit workspace,
/// detected by the presence of `<destination>/.lit/graph.db`.
fn destination_has_workspace(destination: &Path) -> bool {
    destination.join(".lit").join("graph.db").exists()
}

/// Imports the `.lkg` bundle at `source` into the workspace at `destination`.
///
/// Validates the manifest, extracts all `content/` files, then loads the graph
/// data into a freshly created store at `destination/.lit/graph.db`.
///
/// Refuses to import into a destination that is already an initialized
/// workspace (i.e. `<destination>/.lit/graph.db` exists), to avoid silently
/// overwriting `.md` files and destroying existing graph data if the user
/// mistakenly picks their active workspace as the import target.
pub fn import_lkg(source: &Path, destination: &Path) -> Result<LkgImportSummary, String> {
    // Data-safety guard first, before any destructive operation.
    let db_path = destination.join(".lit").join("graph.db");
    if destination_has_workspace(destination) {
        return Err(format!(
            "destination already contains a workspace: {} (refusing to overwrite)",
            db_path.display()
        ));
    }

    // Open (and central-directory-parse) the bundle exactly once, then thread
    // the single handle through validate/extract/load. Each step finishes its
    // entry borrows before the next, so sequential `&mut` reuse is valid (the
    // same pattern `load_lkg_graph_data_from_archive` uses internally). Opening
    // happens AFTER the workspace guard above so a guarded import never touches
    // the destination.
    let mut archive = open_archive(source)?;

    let manifest = validate_lkg_from_archive(&mut archive)?;

    // Staging as a sibling of the destination (same parent dir) so the final
    // rename is an atomic intra-filesystem move. The destination itself is NOT
    // created until the rename succeeds — a failed import leaves no empty dir.
    let parent = destination
        .parent()
        .ok_or_else(|| format!("destination has no parent: {}", destination.display()))?;
    std::fs::create_dir_all(parent)
        .map_err(|e| format!("cannot create {}: {e}", parent.display()))?;
    let staging = tempfile::TempDir::new_in(parent)
        .map_err(|e| format!("cannot create staging dir: {e}"))?;

    let file_count = extract_lkg_content_from_archive(&mut archive, staging.path())?;
    let (nodes, edges, positions, annotations) = load_lkg_graph_data_from_archive(&mut archive)?;

    let expected_hash = &manifest.graph_hash;
    let actual_hash =
        crate::lkg::hash::compute_graph_hash(&nodes, &edges, &annotations);
    if actual_hash != *expected_hash {
        return Err(format!(
            "graph hash mismatch: manifest says {expected_hash}, computed {actual_hash}"
        ));
    }

    let staging_lit = staging.path().join(".lit");
    std::fs::create_dir_all(&staging_lit)
        .map_err(|e| format!("cannot create {}: {e}", staging_lit.display()))?;
    let store = Store::open(&staging_lit.join("graph.db")).map_err(|e| e.to_string())?;

    import_graph_data(&store, &nodes, &edges, &positions, &annotations)
        .map_err(|e| e.to_string())?;

    drop(store);

    // Atomic promotion: single rename of the staging dir to the destination.
    // `into_path()` disarms TempDir's Drop so it won't remove the dir we're
    // about to rename.
    let staging_path = staging.keep();
    std::fs::rename(&staging_path, destination).map_err(|e| {
        let _ = std::fs::remove_dir_all(&staging_path);
        format!(
            "cannot move staging to {}: {e}",
            destination.display()
        )
    })?;

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
            graph_hash: "sha256:abc".into(),
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
        let map: HashMap<String, bool> = metadata.into_iter().map(|(id, is_stub, _)| (id, is_stub)).collect();
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
        store.upsert_node(&node, 0, None).unwrap();
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
            edge_kind: "wikilink".into(),
        }];
        import_graph_data(&store, &[], &edges, &HashMap::new(), &[]).unwrap();

        assert_eq!(
            store.all_edges_full().unwrap(),
            vec![(
                "a.md".to_string(),
                "b.md".to_string(),
                "see [[b]]".to_string(),
                "b".to_string(),
                5u32,
                EdgeKind::Wikilink
            )]
        );
    }

    #[test]
    fn import_graph_data_preserves_edge_kind() {
        let store = mem_store();
        seed_node(&store, "a.md");

        let edges = vec![BundleEdge {
            source: "a.md".into(),
            target: "smith2024".into(),
            context: "[@smith2024]".into(),
            raw_target: "smith2024".into(),
            source_line: 3,
            edge_kind: "citation".into(),
        }];
        import_graph_data(&store, &[], &edges, &HashMap::new(), &[]).unwrap();

        let rows = store.all_edges_full().unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].5, EdgeKind::Citation);
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

    // --- E12b: import_graph_data is atomic — a mid-import failure rolls back ---

    #[test]
    fn import_graph_data_is_atomic_on_failure() {
        let store = mem_store();

        // Block annotation inserts to force a mid-import failure AFTER nodes,
        // edges, and positions have been written.
        store
            .conn
            .execute_batch(
                "CREATE TRIGGER block_ann BEFORE INSERT ON annotations
                 BEGIN
                     SELECT RAISE(ABORT, 'blocked by test trigger');
                 END;",
            )
            .unwrap();

        let nodes = vec![BundleNode {
            id: "a.md".into(),
            title: "A".into(),
            first_paragraph: "Intro".into(),
            frontmatter: json!({}),
            is_stub: false,
            tags: vec![],
            aliases: vec![],
        }];
        let edges = vec![BundleEdge {
            source: "a.md".into(),
            target: "b.md".into(),
            context: "see [[b]]".into(),
            raw_target: "b".into(),
            source_line: 1,
            edge_kind: "wikilink".into(),
        }];
        let mut positions = HashMap::new();
        positions.insert("a.md".to_string(), Position { x: 1.0, y: 2.0 });
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

        let result = import_graph_data(&store, &nodes, &edges, &positions, &annotations);
        assert!(result.is_err(), "import should fail when annotation insert is blocked");

        // Nothing must survive the failed import — the whole sequence rolls back.
        assert!(
            store.all_nodes_metadata().unwrap().is_empty(),
            "nodes must roll back on import failure"
        );
        assert!(
            store.all_edges_full().unwrap().is_empty(),
            "edges must roll back on import failure"
        );
        assert!(
            store.load_positions().unwrap().is_empty(),
            "positions must roll back on import failure"
        );

        store.conn.execute_batch("DROP TRIGGER block_ann;").unwrap();
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

    // --- E13b: import_lkg opens (and central-directory-parses) the archive once ---

    #[test]
    fn import_lkg_opens_archive_once() {
        let dir1 = tempfile::tempdir().unwrap();
        let lkg = export_fixture(&dir1.path());

        let dir2 = tempfile::tempdir().unwrap();

        // Reset immediately before the import so only opens caused by import_lkg
        // (not by export_fixture's indexing/export) are counted. The counter is
        // thread-local, so a parallel test opening archives on another thread
        // cannot perturb this assertion.
        OPEN_ARCHIVE_COUNT.with(|c| c.set(0));
        import_lkg(&lkg, &dir2.path()).unwrap();
        let opens = OPEN_ARCHIVE_COUNT.with(|c| c.get());

        assert_eq!(
            opens, 1,
            "import_lkg should open the bundle archive exactly once, opened {opens} times"
        );
    }

    // --- E14: import_lkg refuses a destination that already has a workspace ---

    #[test]
    fn import_lkg_refuses_existing_workspace() {
        let dir1 = tempfile::tempdir().unwrap();
        let lkg = export_fixture(&dir1.path());

        let dest = tempfile::tempdir().unwrap();
        // Simulate an already-initialized workspace at the destination.
        std::fs::create_dir_all(dest.path().join(".lit")).unwrap();
        let _ = Store::open(&dest.path().join(".lit").join("graph.db")).unwrap();

        let err = import_lkg(&lkg, &dest.path()).unwrap_err();
        assert!(
            err.to_lowercase().contains("workspace"),
            "expected error mentioning workspace, got: {err}"
        );
    }

    // --- E15: import_lkg does not overwrite existing files when guarded ---

    #[test]
    fn import_lkg_does_not_overwrite_existing_files() {
        let dir1 = tempfile::tempdir().unwrap();
        let lkg = export_fixture(&dir1.path());

        let dest = tempfile::tempdir().unwrap();
        // The destination already has user content and an initialized workspace.
        std::fs::write(dest.path().join("a.md"), "ORIGINAL USER CONTENT").unwrap();
        std::fs::create_dir_all(dest.path().join(".lit")).unwrap();
        let _ = Store::open(&dest.path().join(".lit").join("graph.db")).unwrap();

        let result = import_lkg(&lkg, &dest.path());
        assert!(result.is_err(), "expected import to be refused, got {result:?}");

        // The guard must fire BEFORE extract_lkg_content, so a.md is untouched.
        let a = std::fs::read_to_string(dest.path().join("a.md")).unwrap();
        assert_eq!(a, "ORIGINAL USER CONTENT");
    }

    // --- E16: destination_has_workspace detects an initialized .lit/graph.db ---

    #[test]
    fn destination_has_workspace_detects_graph_db() {
        let dir = tempfile::tempdir().unwrap();
        assert!(!destination_has_workspace(&dir.path()));

        std::fs::create_dir_all(dir.path().join(".lit")).unwrap();
        let _ = Store::open(&dir.path().join(".lit").join("graph.db")).unwrap();
        assert!(destination_has_workspace(&dir.path()));
    }

    // --- Cycle 5.1: import_lkg cleans up staging on graph-data failure ---

    #[test]
    fn import_lkg_cleans_up_on_graph_failure() {
        let dir = tempfile::tempdir().unwrap();
        // A valid manifest and content file, but malformed graph/nodes.json so the
        // graph-data load fails AFTER content has been staged. With atomic import,
        // a failure must leave the destination untouched (no orphaned .md, no
        // half-initialized .lit).
        let crafted = crafted_zip(
            dir.path(),
            &[
                ("manifest.json", &manifest_with_version(1)),
                ("content/hello.md", b"# Hello"),
                ("graph/nodes.json", b"{ bad"),
                ("graph/edges.json", b"[]"),
                ("graph/positions.json", b"{}"),
                ("annotations/annotations.json", b"[]"),
            ],
        );

        let dest = tempfile::tempdir().unwrap();
        let result = import_lkg(&crafted, dest.path());
        assert!(result.is_err(), "expected import to fail, got {result:?}");

        assert!(
            !dest.path().join("hello.md").exists(),
            "orphaned content file left behind after failed import"
        );
        assert!(
            !dest.path().join(".lit").exists(),
            "half-initialized .lit left behind after failed import"
        );
        assert!(
            walk_files(dest.path()).is_empty(),
            "destination should be empty after a failed import, found: {:?}",
            walk_files(dest.path())
        );
    }

    fn manifest_with_hash(hash: &str) -> Vec<u8> {
        let m = LkgManifest {
            format_version: 1,
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
            graph_hash: hash.into(),
        };
        serde_json::to_vec(&m).unwrap()
    }

    // --- graph_hash validation ---

    #[test]
    fn import_lkg_rejects_graph_hash_mismatch() {
        let dir = tempfile::tempdir().unwrap();
        let manifest = manifest_with_hash("sha256:0000000000000000000000000000000000000000000000000000000000000000");
        let crafted = crafted_zip(
            dir.path(),
            &[
                ("manifest.json", &manifest),
                ("graph/nodes.json", b"[]"),
                ("graph/edges.json", b"[]"),
                ("graph/positions.json", b"{}"),
                ("annotations/annotations.json", b"[]"),
            ],
        );

        let dest = dir.path().join("imported");
        let err = import_lkg(&crafted, &dest).unwrap_err();
        assert!(
            err.to_lowercase().contains("hash"),
            "expected error mentioning hash, got: {err}"
        );
    }

    #[test]
    fn import_lkg_hash_mismatch_leaves_no_files() {
        let dir = tempfile::tempdir().unwrap();
        let manifest = manifest_with_hash("sha256:0000000000000000000000000000000000000000000000000000000000000000");
        let crafted = crafted_zip(
            dir.path(),
            &[
                ("manifest.json", &manifest),
                ("content/hello.md", b"# Hello"),
                ("graph/nodes.json", b"[]"),
                ("graph/edges.json", b"[]"),
                ("graph/positions.json", b"{}"),
                ("annotations/annotations.json", b"[]"),
            ],
        );

        let dest = dir.path().join("imported");
        let result = import_lkg(&crafted, &dest);
        assert!(result.is_err());
        assert!(
            !dest.exists(),
            "destination should not exist after hash mismatch"
        );
    }

    // --- atomic single-rename: destination not created on failure ---

    #[test]
    fn import_lkg_failed_import_does_not_create_destination() {
        let dir = tempfile::tempdir().unwrap();
        let crafted = crafted_zip(
            dir.path(),
            &[
                ("manifest.json", &manifest_with_version(1)),
                ("content/hello.md", b"# Hello"),
                ("graph/nodes.json", b"{ bad"),
                ("graph/edges.json", b"[]"),
                ("graph/positions.json", b"{}"),
                ("annotations/annotations.json", b"[]"),
            ],
        );

        let dest = dir.path().join("nonexistent_subdir");
        let result = import_lkg(&crafted, &dest);
        assert!(result.is_err());
        assert!(
            !dest.exists(),
            "destination should not exist after a failed import"
        );
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
