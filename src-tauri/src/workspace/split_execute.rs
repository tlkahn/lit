use std::collections::HashMap;
use std::path::Path;

use serde::Serialize;

use super::normalize::{page_name_to_filename, validate_page_name};
use super::ops;
use super::split::{plan_split, SplitPlan};
use super::trash::{self, TrashEntry};
use super::write_hash::WriteHashRegistry;
use super::WorkspaceError;
use crate::graph::rewriter::{rewrite_body_for_split, PlannedRewrite};

#[derive(Debug, Clone, Serialize)]
pub struct SplitResult {
    pub created_paths: Vec<String>,
    pub trash_entry: TrashEntry,
    pub rewrite_actions: Vec<PlannedRewrite>,
}

pub fn execute_split(
    root: &Path,
    relative_path: &str,
    registry: &WriteHashRegistry,
    candidate_paths: Option<&std::collections::HashSet<String>>,
) -> Result<SplitResult, WorkspaceError> {
    let page = ops::read_page(root, relative_path, registry)?;
    let plan = plan_split(&page.body, &page.meta.title, &page.meta.frontmatter);

    if plan.preamble.is_none() && plan.sections.is_empty() {
        return Err(WorkspaceError::ParseError(
            "Nothing to split: document is empty".into(),
        ));
    }

    let parent_dir = Path::new(relative_path)
        .parent()
        .filter(|p| *p != Path::new(""))
        .map(|p| p.to_string_lossy().to_string());

    let chunks = collect_chunks(&plan);

    for chunk_title in &chunks {
        validate_page_name(&chunk_title.0)?;
    }

    let target_paths: Vec<String> = chunks
        .iter()
        .map(|(title, _)| {
            let filename = page_name_to_filename(title);
            match &parent_dir {
                Some(dir) => format!("{dir}/{filename}"),
                None => filename,
            }
        })
        .collect();

    for path in &target_paths {
        let full = root.join(path);
        if full.exists() {
            return Err(WorkspaceError::PageAlreadyExists(path.clone()));
        }
    }

    let original_stem = Path::new(relative_path)
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default();

    let (section_to_doc, default_target) = build_section_map(&plan, &target_paths);

    for (i, (_, (body, frontmatter))) in chunks.iter().enumerate() {
        let (rewritten_body, _) =
            rewrite_body_for_split(body, &original_stem, &section_to_doc, &default_target);
        ops::write_page(root, &target_paths[i], &rewritten_body, frontmatter, registry)?;
    }

    let rewrite_actions = match rewrite_vault_for_split(
        root,
        &original_stem,
        &section_to_doc,
        &default_target,
        relative_path,
        candidate_paths,
    ) {
        Ok(actions) => actions,
        Err(e) => {
            cleanup_created_files(root, &target_paths);
            return Err(e);
        }
    };

    let trash_entry = match trash::trash_page(root, relative_path) {
        Ok(entry) => entry,
        Err(e) => {
            for pr in &rewrite_actions {
                let _ = std::fs::write(root.join(&pr.relative_path), &pr.before_content);
            }
            cleanup_created_files(root, &target_paths);
            return Err(e);
        }
    };

    Ok(SplitResult {
        created_paths: target_paths,
        trash_entry,
        rewrite_actions,
    })
}

type ChunkData = (String, (String, indexmap::IndexMap<String, serde_yaml::Value>));

fn collect_chunks(plan: &SplitPlan) -> Vec<ChunkData> {
    let mut chunks = Vec::new();
    if let Some(ref pre) = plan.preamble {
        chunks.push((
            pre.title.clone(),
            (pre.body.clone(), pre.frontmatter.clone()),
        ));
    }
    for sec in &plan.sections {
        chunks.push((
            sec.title.clone(),
            (sec.body.clone(), sec.frontmatter.clone()),
        ));
    }
    chunks
}

fn cleanup_created_files(root: &Path, paths: &[String]) {
    for path in paths {
        let _ = std::fs::remove_file(root.join(path));
    }
}

fn build_section_map(
    plan: &SplitPlan,
    target_paths: &[String],
) -> (HashMap<String, String>, String) {
    let mut section_to_doc: HashMap<String, String> = HashMap::new();
    let mut path_idx = 0;

    if plan.preamble.is_some() {
        path_idx = 1;
    }

    for (i, sec) in plan.sections.iter().enumerate() {
        let doc_stem = Path::new(&target_paths[path_idx + i])
            .file_stem()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_default();
        section_to_doc.insert(sec.title.to_lowercase(), doc_stem);
    }

    let default_target = Path::new(&target_paths[0])
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default();

    (section_to_doc, default_target)
}

fn rewrite_vault_for_split(
    root: &Path,
    original_stem: &str,
    section_to_doc: &HashMap<String, String>,
    default_target: &str,
    skip_path: &str,
    candidate_paths: Option<&std::collections::HashSet<String>>,
) -> Result<Vec<PlannedRewrite>, WorkspaceError> {
    use crate::graph::rewriter::walk_md_files_for_rewrite;

    let md_files = match candidate_paths {
        Some(paths) => paths.iter().cloned().collect(),
        None => walk_md_files_for_rewrite(root),
    };
    let mut rewrites = Vec::new();
    let mut written: Vec<(&str, String)> = Vec::new();

    for rel_path in &md_files {
        if rel_path == skip_path {
            continue;
        }

        let full_path = root.join(rel_path);
        let original = match std::fs::read_to_string(&full_path) {
            Ok(s) => s,
            Err(_) if candidate_paths.is_some() => continue,
            Err(e) => {
                return Err(WorkspaceError::IoError(format!(
                    "Failed to read {}: {}",
                    rel_path, e
                )));
            }
        };

        let (rewritten, count) =
            rewrite_body_for_split(&original, original_stem, section_to_doc, default_target);

        if count > 0 {
            match std::fs::write(&full_path, &rewritten) {
                Ok(()) => {
                    written.push((rel_path, original.clone()));
                    rewrites.push(PlannedRewrite {
                        relative_path: rel_path.clone(),
                        before_content: original,
                        after_content: rewritten,
                        links_changed: count,
                    });
                }
                Err(e) => {
                    for (written_path, orig) in &written {
                        let _ = std::fs::write(root.join(written_path), orig);
                    }
                    return Err(WorkspaceError::IoError(format!(
                        "Failed to write {}: {}",
                        rel_path, e
                    )));
                }
            }
        }
    }

    Ok(rewrites)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::workspace::frontmatter::serialize_frontmatter;
    use crate::workspace::write_hash::WriteHashRegistry;
    use indexmap::IndexMap;
    use std::fs;
    use tempfile::TempDir;

    fn write_file(dir: &Path, rel: &str, content: &str) {
        let path = dir.join(rel);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(path, content).unwrap();
    }

    fn read_file(dir: &Path, rel: &str) -> String {
        fs::read_to_string(dir.join(rel)).unwrap()
    }

    fn make_doc(_title: &str, body: &str, fm: &IndexMap<String, serde_yaml::Value>) -> String {
        serialize_frontmatter(fm, body)
    }

    // R5: basic two-section split creates files
    #[test]
    fn split_two_sections_creates_files() {
        let tmp = TempDir::new().unwrap();
        let registry = WriteHashRegistry::new();
        let fm = IndexMap::new();
        let body = "## Alpha\nAlpha body.\n## Beta\nBeta body.\n";
        write_file(tmp.path(), "Doc.md", &make_doc("Doc", body, &fm));

        let result = execute_split(tmp.path(), "Doc.md", &registry, None).unwrap();

        assert_eq!(result.created_paths.len(), 2);
        assert!(tmp.path().join("Alpha.md").exists());
        assert!(tmp.path().join("Beta.md").exists());

        let alpha = read_file(tmp.path(), "Alpha.md");
        assert!(alpha.contains("Alpha body."));
        let beta = read_file(tmp.path(), "Beta.md");
        assert!(beta.contains("Beta body."));
    }

    // R6: preamble handling
    #[test]
    fn split_with_preamble_creates_introduction() {
        let tmp = TempDir::new().unwrap();
        let registry = WriteHashRegistry::new();
        let fm = IndexMap::new();
        let body = "Some intro text.\n\n## Section\nSection body.\n";
        write_file(tmp.path(), "Doc.md", &make_doc("Doc", body, &fm));

        let result = execute_split(tmp.path(), "Doc.md", &registry, None).unwrap();

        assert_eq!(result.created_paths.len(), 2);
        assert!(tmp.path().join("Doc - Introduction.md").exists());
        assert!(tmp.path().join("Section.md").exists());

        let intro = read_file(tmp.path(), "Doc - Introduction.md");
        assert!(intro.contains("Some intro text."));
    }

    // R7: frontmatter inherited
    #[test]
    fn split_inherits_frontmatter() {
        let tmp = TempDir::new().unwrap();
        let registry = WriteHashRegistry::new();
        let mut fm = IndexMap::new();
        fm.insert(
            "status".to_string(),
            serde_yaml::Value::String("draft".to_string()),
        );
        let body = "## Alpha\nAlpha body.\n## Beta\nBeta body.\n";
        write_file(tmp.path(), "Doc.md", &make_doc("Doc", body, &fm));

        execute_split(tmp.path(), "Doc.md", &registry, None).unwrap();

        let alpha = read_file(tmp.path(), "Alpha.md");
        assert!(alpha.contains("status: draft"));
        let beta = read_file(tmp.path(), "Beta.md");
        assert!(beta.contains("status: draft"));
    }

    // R8: trashes original
    #[test]
    fn split_trashes_original() {
        let tmp = TempDir::new().unwrap();
        let registry = WriteHashRegistry::new();
        let fm = IndexMap::new();
        let body = "## Alpha\nAlpha body.\n## Beta\nBeta body.\n";
        write_file(tmp.path(), "Doc.md", &make_doc("Doc", body, &fm));

        let result = execute_split(tmp.path(), "Doc.md", &registry, None).unwrap();

        assert!(!tmp.path().join("Doc.md").exists());
        assert_eq!(result.trash_entry.original_path, "Doc.md");
        assert!(tmp.path().join(".trash").exists());
    }

    // R9: vault links rewritten
    #[test]
    fn split_rewrites_vault_links() {
        let tmp = TempDir::new().unwrap();
        let registry = WriteHashRegistry::new();
        let fm = IndexMap::new();
        let body = "## Alpha\nAlpha body.\n## Beta\nBeta body.\n";
        write_file(tmp.path(), "Doc.md", &make_doc("Doc", body, &fm));
        write_file(
            tmp.path(),
            "other.md",
            "See [[Doc]] and [[Doc#Alpha]] and [[Doc#Random]].",
        );

        let result = execute_split(tmp.path(), "Doc.md", &registry, None).unwrap();

        let other = read_file(tmp.path(), "other.md");
        assert!(
            other.contains("[[Alpha]]"),
            "bare link should redirect to default: {other}"
        );
        assert!(
            !other.contains("[[Doc]]"),
            "old stem should be gone: {other}"
        );
        assert!(
            !other.contains("[[Doc#Alpha]]"),
            "section link should be rewritten: {other}"
        );
        assert!(
            other.contains("[[Alpha#Random]]"),
            "unknown section should redirect to default with anchor: {other}"
        );
        assert!(!result.rewrite_actions.is_empty());
    }

    // R10: returns SplitResult
    #[test]
    fn split_returns_correct_result() {
        let tmp = TempDir::new().unwrap();
        let registry = WriteHashRegistry::new();
        let fm = IndexMap::new();
        let body = "## Alpha\nAlpha body.\n## Beta\nBeta body.\n";
        write_file(tmp.path(), "Doc.md", &make_doc("Doc", body, &fm));

        let result = execute_split(tmp.path(), "Doc.md", &registry, None).unwrap();

        assert_eq!(result.created_paths, vec!["Alpha.md", "Beta.md"]);
        assert_eq!(result.trash_entry.original_path, "Doc.md");
    }

    // R11: name collision error
    #[test]
    fn split_name_collision_error_no_partial_files() {
        let tmp = TempDir::new().unwrap();
        let registry = WriteHashRegistry::new();
        let fm = IndexMap::new();
        let body = "## Alpha\nAlpha body.\n## Beta\nBeta body.\n";
        write_file(tmp.path(), "Doc.md", &make_doc("Doc", body, &fm));
        write_file(tmp.path(), "Alpha.md", "existing");

        let result = execute_split(tmp.path(), "Doc.md", &registry, None);
        assert!(result.is_err());
        assert!(tmp.path().join("Doc.md").exists(), "original should remain");
        assert!(!tmp.path().join("Beta.md").exists(), "no partial files");
    }

    // R12: no headings (only preamble)
    #[test]
    fn split_no_headings_creates_introduction() {
        let tmp = TempDir::new().unwrap();
        let registry = WriteHashRegistry::new();
        let fm = IndexMap::new();
        let body = "Just plain text.\nNo headings at all.\n";
        write_file(tmp.path(), "Doc.md", &make_doc("Doc", body, &fm));

        let result = execute_split(tmp.path(), "Doc.md", &registry, None).unwrap();

        assert_eq!(result.created_paths, vec!["Doc - Introduction.md"]);
        assert!(tmp.path().join("Doc - Introduction.md").exists());
        assert!(!tmp.path().join("Doc.md").exists());
    }

    // R13: empty content returns error
    #[test]
    fn split_empty_content_errors() {
        let tmp = TempDir::new().unwrap();
        let registry = WriteHashRegistry::new();
        write_file(tmp.path(), "Empty.md", "");

        let result = execute_split(tmp.path(), "Empty.md", &registry, None);
        assert!(result.is_err());
    }

    // R14: subdirectory split
    #[test]
    fn split_in_subdirectory() {
        let tmp = TempDir::new().unwrap();
        let registry = WriteHashRegistry::new();
        let fm = IndexMap::new();
        let body = "## Alpha\nAlpha body.\n## Beta\nBeta body.\n";
        write_file(
            tmp.path(),
            "notes/Doc.md",
            &make_doc("Doc", body, &fm),
        );

        let result = execute_split(tmp.path(), "notes/Doc.md", &registry, None).unwrap();

        assert_eq!(
            result.created_paths,
            vec!["notes/Alpha.md", "notes/Beta.md"]
        );
        assert!(tmp.path().join("notes/Alpha.md").exists());
        assert!(tmp.path().join("notes/Beta.md").exists());
    }

    // R15: internal cross-references rewritten in-memory before writing
    #[test]
    fn split_rewrites_internal_links_in_created_files() {
        let tmp = TempDir::new().unwrap();
        let registry = WriteHashRegistry::new();
        let fm = IndexMap::new();
        let body = "## Alpha\nSee [[Doc#Beta]] for details.\n## Beta\nBeta body with [[Doc]].\n";
        write_file(tmp.path(), "Doc.md", &make_doc("Doc", body, &fm));

        let result = execute_split(tmp.path(), "Doc.md", &registry, None).unwrap();

        let alpha = read_file(tmp.path(), "Alpha.md");
        assert!(
            alpha.contains("[[Beta]]"),
            "cross-ref should be rewritten: {alpha}"
        );
        assert!(
            !alpha.contains("[[Doc#Beta]]"),
            "old section link should be gone: {alpha}"
        );

        let beta = read_file(tmp.path(), "Beta.md");
        assert!(
            beta.contains("[[Alpha]]"),
            "bare link should redirect to default: {beta}"
        );
        assert!(
            !beta.contains("[[Doc]]"),
            "old stem should be gone: {beta}"
        );

        for action in &result.rewrite_actions {
            assert_ne!(action.relative_path, "Alpha.md", "created file should not appear in rewrite_actions");
            assert_ne!(action.relative_path, "Beta.md", "created file should not appear in rewrite_actions");
        }
    }

    #[test]
    fn rewrite_vault_for_split_with_candidates_only_scans_those() {
        let tmp = TempDir::new().unwrap();
        let registry = WriteHashRegistry::new();
        let fm = IndexMap::new();
        let body = "## Alpha\nAlpha body.\n## Beta\nBeta body.\n";
        write_file(tmp.path(), "Doc.md", &make_doc("Doc", body, &fm));
        write_file(tmp.path(), "other.md", "See [[Doc]].");
        write_file(tmp.path(), "skip.md", "See [[Doc]].");

        let mut candidates: std::collections::HashSet<String> = std::collections::HashSet::new();
        candidates.insert("other.md".into());

        let result = execute_split(tmp.path(), "Doc.md", &registry, Some(&candidates)).unwrap();

        let other = read_file(tmp.path(), "other.md");
        assert!(
            other.contains("[[Alpha]]"),
            "other.md should be rewritten: {other}"
        );

        let skip = read_file(tmp.path(), "skip.md");
        assert!(
            skip.contains("[[Doc]]"),
            "skip.md should NOT be rewritten: {skip}"
        );

        assert!(!result.rewrite_actions.is_empty());
    }

    #[test]
    fn rewrite_vault_for_split_skips_missing_candidate_file() {
        let tmp = TempDir::new().unwrap();
        let registry = WriteHashRegistry::new();
        let fm = IndexMap::new();
        let body = "## Alpha\nAlpha body.\n## Beta\nBeta body.\n";
        write_file(tmp.path(), "Doc.md", &make_doc("Doc", body, &fm));
        write_file(tmp.path(), "other.md", "See [[Doc]].");

        let mut candidates: std::collections::HashSet<String> = std::collections::HashSet::new();
        candidates.insert("other.md".into());
        candidates.insert("ghost.md".into());

        let result = execute_split(tmp.path(), "Doc.md", &registry, Some(&candidates));
        assert!(result.is_ok(), "should not error on missing candidate: {result:?}");

        let other = read_file(tmp.path(), "other.md");
        assert!(
            other.contains("[[Alpha]]"),
            "other.md should be rewritten: {other}"
        );
        assert!(
            !other.contains("[[Doc]]"),
            "old link should be gone: {other}"
        );
    }
}
