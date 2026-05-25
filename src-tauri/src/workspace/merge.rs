use indexmap::IndexMap;
use serde::{Deserialize, Serialize};
use serde_yaml::Value;
use std::collections::HashSet;
use std::fs;
use std::path::Path;

use super::frontmatter::serialize_frontmatter;
use super::frontmatter_merge::merge_frontmatter;
use super::normalize::{filename_to_page_name, page_name_to_filename};
use super::split::demote_headings;
use super::trash;
use crate::graph::rewriter::{self, LinkRedirect, PlannedVaultRewrite};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MergeInput {
    pub title: String,
    pub body: String,
    pub frontmatter: IndexMap<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MergePlan {
    pub title: String,
    pub body: String,
    pub frontmatter: IndexMap<String, Value>,
    pub source_titles: Vec<String>,
}

// Spec has `ordering: &[usize]`; omitted here — callers pre-order the slice (Phase 4A).
pub fn plan_merge(docs: &[MergeInput]) -> MergePlan {
    if docs.is_empty() {
        return MergePlan {
            title: String::new(),
            body: String::new(),
            frontmatter: IndexMap::new(),
            source_titles: Vec::new(),
        };
    }

    let title = docs
        .iter()
        .map(|d| d.title.as_str())
        .collect::<Vec<_>>()
        .join(" + ");

    let mut body = String::new();
    for (i, doc) in docs.iter().enumerate() {
        if i > 0 {
            body.push('\n');
        }
        body.push_str("## ");
        body.push_str(&doc.title);
        body.push('\n');
        if !doc.body.is_empty() {
            body.push('\n');
            body.push_str(&demote_headings(&doc.body, 1));
            body.push('\n');
        }
    }

    let fm_sources: Vec<IndexMap<String, Value>> =
        docs.iter().map(|d| d.frontmatter.clone()).collect();
    let frontmatter = merge_frontmatter(&fm_sources);

    let source_titles = docs.iter().map(|d| d.title.clone()).collect();

    MergePlan {
        title,
        body,
        frontmatter,
        source_titles,
    }
}

#[derive(Debug, Clone)]
pub struct MergeResult {
    pub merged_path: String,
    pub merged_content: String,
    pub trashed: Vec<trash::TrashEntry>,
    pub planned_rewrites: PlannedVaultRewrite,
    pub source_snapshots: Vec<(String, String)>,
}

pub fn merge_documents_inner(
    root: &Path,
    docs: &[(String, MergeInput)],
    title: Option<&str>,
    ordering: &[usize],
    output_dir: Option<&str>,
) -> Result<MergeResult, String> {
    if docs.is_empty() {
        return Err("Cannot merge: no documents provided".to_string());
    }

    if ordering.is_empty() {
        return Err("Cannot merge: ordering is empty".to_string());
    }
    if let Some(&i) = ordering.iter().find(|&&i| i >= docs.len()) {
        return Err(format!(
            "Invalid ordering index {}: only {} documents provided",
            i,
            docs.len()
        ));
    }
    {
        let mut seen = HashSet::new();
        for &i in ordering {
            if !seen.insert(i) {
                return Err(format!("Duplicate ordering index: {}", i));
            }
        }
    }

    let ordered: Vec<&(String, MergeInput)> = ordering.iter().map(|&i| &docs[i]).collect();

    let merge_inputs: Vec<MergeInput> = ordered.iter().map(|(_, input)| input.clone()).collect();
    let plan = plan_merge(&merge_inputs);

    let merged_title = match title {
        Some(t) if !t.trim().is_empty() => t,
        _ => &plan.title,
    };

    let parent_dir = if let Some(dir) = output_dir {
        dir.to_string()
    } else {
        let first_path = &ordered[0].0;
        Path::new(first_path)
            .parent()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_default()
    };

    let merged_filename = page_name_to_filename(merged_title);
    let merged_path = if parent_dir.is_empty() {
        merged_filename.clone()
    } else {
        format!("{}/{}", parent_dir, merged_filename)
    };

    let full_merged = root.join(&merged_path);
    if full_merged.exists() {
        return Err(format!("Target file already exists: {}", merged_path));
    }

    let merged_content = serialize_frontmatter(&plan.frontmatter, &plan.body);

    let source_snapshots: Vec<(String, String)> = ordered
        .iter()
        .map(|(path, _)| {
            let content = fs::read_to_string(root.join(path)).unwrap_or_default();
            (path.clone(), content)
        })
        .collect();

    let redirects: Vec<LinkRedirect> = ordered
        .iter()
        .map(|(path, _)| {
            let filename = Path::new(path)
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .to_string();
            LinkRedirect {
                old_target: filename_to_page_name(&filename),
                new_target: filename_to_page_name(&merged_filename),
            }
        })
        .collect();

    let source_paths: HashSet<&str> = ordered.iter().map(|(p, _)| p.as_str()).collect();
    let full_planned = rewriter::plan_vault_rewrites(root, &redirects)?;
    let planned_rewrites = PlannedVaultRewrite {
        files_scanned: full_planned.files_scanned,
        rewrites: full_planned
            .rewrites
            .into_iter()
            .filter(|r| !source_paths.contains(r.relative_path.as_str()))
            .collect(),
    };

    if !planned_rewrites.rewrites.is_empty() {
        rewriter::apply_planned_rewrites(root, &planned_rewrites)?;
    }

    if let Some(parent) = full_merged.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(&full_merged, &merged_content).map_err(|e| e.to_string())?;

    let mut trashed = Vec::new();
    for (path, _) in &ordered {
        let entry = trash::trash_page(root, path).map_err(|e| e.to_string())?;
        trashed.push(entry);
    }

    Ok(MergeResult {
        merged_path,
        merged_content,
        trashed,
        planned_rewrites,
        source_snapshots,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input(title: &str, body: &str) -> MergeInput {
        MergeInput {
            title: title.to_string(),
            body: body.to_string(),
            frontmatter: IndexMap::new(),
        }
    }

    fn input_with_fm(
        title: &str,
        body: &str,
        fm: IndexMap<String, Value>,
    ) -> MergeInput {
        MergeInput {
            title: title.to_string(),
            body: body.to_string(),
            frontmatter: fm,
        }
    }

    // ── Section A: plan_merge basics ──

    #[test]
    fn merge_two_docs_basic() {
        let result = plan_merge(&[
            input("A", "Hello from A"),
            input("B", "Hello from B"),
        ]);
        assert_eq!(result.title, "A + B");
        assert_eq!(result.source_titles, vec!["A", "B"]);
        assert!(result.body.contains("## A\n\n"));
        assert!(result.body.contains("## B\n\n"));
        assert!(result.body.contains("Hello from A"));
        assert!(result.body.contains("Hello from B"));
    }

    #[test]
    fn merge_three_docs() {
        let result = plan_merge(&[
            input("X", "x body"),
            input("Y", "y body"),
            input("Z", "z body"),
        ]);
        assert_eq!(result.title, "X + Y + Z");
        assert_eq!(result.source_titles, vec!["X", "Y", "Z"]);

        let x_pos = result.body.find("## X").unwrap();
        let y_pos = result.body.find("## Y").unwrap();
        let z_pos = result.body.find("## Z").unwrap();
        assert!(x_pos < y_pos);
        assert!(y_pos < z_pos);
    }

    #[test]
    fn merge_single_doc() {
        let result = plan_merge(&[input("Solo", "some content")]);
        assert_eq!(result.title, "Solo");
        assert!(!result.title.contains(" + "));
        assert!(result.body.contains("## Solo\n\n"));
        assert!(result.body.contains("some content"));
    }

    #[test]
    fn merge_empty_body() {
        let result = plan_merge(&[
            input("A", "content A"),
            input("Empty", ""),
            input("C", "content C"),
        ]);
        assert!(result.body.contains("## Empty\n\n"));
        assert!(result.body.contains("## A\n\n"));
        assert!(result.body.contains("## C\n\n"));
    }

    #[test]
    fn merge_heading_demotion() {
        let result = plan_merge(&[input("Doc", "## Sub\n\nParagraph")]);
        assert!(result.body.contains("### Sub"), "body was: {}", result.body);
        assert!(result.body.contains("Paragraph"));
    }

    #[test]
    fn merge_code_fences_preserved() {
        let body = "```markdown\n## Not a heading\n```\n\n## Real heading";
        let result = plan_merge(&[input("Doc", body)]);
        assert!(
            result.body.contains("## Not a heading"),
            "fenced heading should NOT be demoted: {}",
            result.body
        );
        assert!(
            result.body.contains("### Real heading"),
            "real heading should be demoted: {}",
            result.body
        );
    }

    #[test]
    fn merge_empty_input_slice() {
        let result = plan_merge(&[]);
        assert_eq!(result.title, "");
        assert_eq!(result.body, "");
        assert!(result.frontmatter.is_empty());
        assert!(result.source_titles.is_empty());
    }

    // ── Section B: Edge cases ──

    #[test]
    fn merge_empty_body_consistent_spacing() {
        let result = plan_merge(&[
            input("A", "content A"),
            input("Empty", ""),
            input("C", "content C"),
        ]);
        assert!(
            !result.body.contains("\n\n\n"),
            "body should not contain triple newlines: {:?}",
            result.body
        );
    }

    #[test]
    fn merge_deeply_nested_heading_clamped() {
        let body = "##### H5\n\n###### H6";
        let result = plan_merge(&[input("Doc", body)]);
        assert!(
            result.body.contains("###### H5"),
            "H5 should become H6: {}",
            result.body
        );
        assert!(
            result.body.contains("###### H6"),
            "H6 should stay H6 (clamped): {}",
            result.body
        );
    }

    #[test]
    fn merge_crlf_body() {
        let body = "Line one\r\nLine two\r\n## Heading\r\nMore text";
        let result = plan_merge(&[input("Doc", body)]);
        assert!(!result.body.contains('\r'), "CRLF should be normalized to LF");
        assert!(result.body.contains("### Heading"), "heading should be demoted");
        assert!(result.body.contains("Line one"));
        assert!(result.body.contains("More text"));
    }

    #[test]
    fn merge_frontmatter_delegation() {
        let mut fm1 = IndexMap::new();
        fm1.insert("tags".to_string(), Value::Sequence(vec![
            Value::String("rust".to_string()),
        ]));
        fm1.insert("author".to_string(), Value::String("Alice".to_string()));

        let mut fm2 = IndexMap::new();
        fm2.insert("tags".to_string(), Value::Sequence(vec![
            Value::String("merge".to_string()),
        ]));
        fm2.insert("draft".to_string(), Value::Bool(true));

        let result = plan_merge(&[
            input_with_fm("A", "body a", fm1),
            input_with_fm("B", "body b", fm2),
        ]);

        let tags = result.frontmatter.get("tags").expect("tags key missing");
        if let Value::Sequence(seq) = tags {
            let tag_strs: Vec<&str> = seq
                .iter()
                .filter_map(|v| v.as_str())
                .collect();
            assert!(tag_strs.contains(&"rust"));
            assert!(tag_strs.contains(&"merge"));
        } else {
            panic!("tags should be a sequence");
        }

        assert!(result.frontmatter.contains_key("author"));
        assert!(result.frontmatter.contains_key("draft"));
    }

    // ── Section C: merge_documents_inner ──

    use tempfile::TempDir;

    fn write_file(dir: &Path, rel: &str, content: &str) {
        let path = dir.join(rel);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(path, content).unwrap();
    }

    fn make_docs(root: &Path, paths: &[&str]) -> Vec<(String, MergeInput)> {
        paths
            .iter()
            .map(|&p| {
                let content = fs::read_to_string(root.join(p)).unwrap();
                let parsed = super::super::frontmatter::parse_frontmatter(&content);
                let filename = Path::new(p).file_name().unwrap().to_string_lossy().to_string();
                let title = super::super::normalize::filename_to_page_name(&filename);
                (
                    p.to_string(),
                    MergeInput {
                        title,
                        body: parsed.body.to_string(),
                        frontmatter: parsed.map,
                    },
                )
            })
            .collect()
    }

    #[test]
    fn merge_inner_two_docs_creates_merged_file() {
        let dir = TempDir::new().unwrap();
        let root = dir.path();
        write_file(root, "A.md", "Hello from A");
        write_file(root, "B.md", "Hello from B");

        let docs = make_docs(root, &["A.md", "B.md"]);
        let result = merge_documents_inner(root, &docs, None, &[0, 1], None).unwrap();

        assert!(root.join(&result.merged_path).exists());
        assert!(result.merged_content.contains("## A"));
        assert!(result.merged_content.contains("## B"));
        assert!(result.merged_path.ends_with("A + B.md"));
    }

    #[test]
    fn merge_inner_ordering_respected() {
        let dir = TempDir::new().unwrap();
        let root = dir.path();
        write_file(root, "A.md", "Hello from A");
        write_file(root, "B.md", "Hello from B");

        let docs = make_docs(root, &["A.md", "B.md"]);
        let result = merge_documents_inner(root, &docs, None, &[1, 0], None).unwrap();

        let b_pos = result.merged_content.find("## B").unwrap();
        let a_pos = result.merged_content.find("## A").unwrap();
        assert!(b_pos < a_pos, "B should come before A with ordering [1,0]");
    }

    #[test]
    fn merge_inner_title_override() {
        let dir = TempDir::new().unwrap();
        let root = dir.path();
        write_file(root, "A.md", "Hello from A");
        write_file(root, "B.md", "Hello from B");

        let docs = make_docs(root, &["A.md", "B.md"]);
        let result =
            merge_documents_inner(root, &docs, Some("My Merge"), &[0, 1], None).unwrap();

        assert!(result.merged_path.ends_with("My Merge.md"));
    }

    #[test]
    fn merge_inner_trashes_source_files() {
        let dir = TempDir::new().unwrap();
        let root = dir.path();
        write_file(root, "A.md", "Hello from A");
        write_file(root, "B.md", "Hello from B");

        let docs = make_docs(root, &["A.md", "B.md"]);
        let result = merge_documents_inner(root, &docs, None, &[0, 1], None).unwrap();

        assert!(!root.join("A.md").exists());
        assert!(!root.join("B.md").exists());
        assert_eq!(result.trashed.len(), 2);
    }

    #[test]
    fn merge_inner_source_snapshots_captured() {
        let dir = TempDir::new().unwrap();
        let root = dir.path();
        write_file(root, "A.md", "---\ntags: [rust]\n---\nHello A");
        write_file(root, "B.md", "Hello B");

        let docs = make_docs(root, &["A.md", "B.md"]);
        let result = merge_documents_inner(root, &docs, None, &[0, 1], None).unwrap();

        assert_eq!(result.source_snapshots.len(), 2);
        assert!(result.source_snapshots[0].1.contains("tags: [rust]"));
        assert!(result.source_snapshots[1].1.contains("Hello B"));
    }

    #[test]
    fn merge_inner_rewrites_links() {
        let dir = TempDir::new().unwrap();
        let root = dir.path();
        write_file(root, "A.md", "Hello from A");
        write_file(root, "B.md", "Hello from B");
        write_file(root, "C.md", "See [[A]] and [[B]]");

        let docs = make_docs(root, &["A.md", "B.md"]);
        let result =
            merge_documents_inner(root, &docs, Some("Merged"), &[0, 1], None).unwrap();

        let c_content = fs::read_to_string(root.join("C.md")).unwrap();
        assert!(c_content.contains("[[Merged]]"), "C.md should have [[Merged]], got: {}", c_content);
        assert!(!c_content.contains("[[A]]"));
        assert!(!c_content.contains("[[B]]"));
        assert!(!result.planned_rewrites.rewrites.is_empty());
    }

    #[test]
    fn merge_inner_unrelated_links_untouched() {
        let dir = TempDir::new().unwrap();
        let root = dir.path();
        write_file(root, "A.md", "Hello from A");
        write_file(root, "B.md", "Hello from B");
        write_file(root, "C.md", "See [[Other]]");

        let docs = make_docs(root, &["A.md", "B.md"]);
        merge_documents_inner(root, &docs, None, &[0, 1], None).unwrap();

        let c_content = fs::read_to_string(root.join("C.md")).unwrap();
        assert!(c_content.contains("[[Other]]"));
    }

    #[test]
    fn merge_inner_subdirectory_output() {
        let dir = TempDir::new().unwrap();
        let root = dir.path();
        write_file(root, "notes/A.md", "Hello from A");
        write_file(root, "notes/B.md", "Hello from B");

        let docs = make_docs(root, &["notes/A.md", "notes/B.md"]);
        let result = merge_documents_inner(root, &docs, None, &[0, 1], None).unwrap();

        assert!(result.merged_path.starts_with("notes/"));
        assert!(root.join(&result.merged_path).exists());
    }

    #[test]
    fn merge_inner_mixed_dirs_uses_first() {
        let dir = TempDir::new().unwrap();
        let root = dir.path();
        write_file(root, "notes/A.md", "Hello from A");
        write_file(root, "journal/B.md", "Hello from B");

        let docs = make_docs(root, &["notes/A.md", "journal/B.md"]);
        let result = merge_documents_inner(root, &docs, None, &[0, 1], None).unwrap();

        assert!(result.merged_path.starts_with("notes/"));
    }

    #[test]
    fn merge_inner_explicit_output_dir() {
        let dir = TempDir::new().unwrap();
        let root = dir.path();
        write_file(root, "A.md", "Hello from A");
        write_file(root, "B.md", "Hello from B");

        let docs = make_docs(root, &["A.md", "B.md"]);
        let result =
            merge_documents_inner(root, &docs, None, &[0, 1], Some("archive")).unwrap();

        assert!(result.merged_path.starts_with("archive/"));
        assert!(root.join(&result.merged_path).exists());
    }

    #[test]
    fn merge_inner_target_exists_returns_error() {
        let dir = TempDir::new().unwrap();
        let root = dir.path();
        write_file(root, "A.md", "Hello from A");
        write_file(root, "B.md", "Hello from B");
        write_file(root, "A + B.md", "already here");

        let docs = make_docs(root, &["A.md", "B.md"]);
        let result = merge_documents_inner(root, &docs, None, &[0, 1], None);

        assert!(result.is_err());
        assert!(result.unwrap_err().contains("already exists"));
    }

    #[test]
    fn merge_inner_empty_docs_returns_error() {
        let dir = TempDir::new().unwrap();
        let root = dir.path();

        let result = merge_documents_inner(root, &[], None, &[], None);
        assert!(result.is_err());
    }

    // ── Section D: Validation edge cases ──

    #[test]
    fn merge_inner_empty_ordering_returns_error() {
        let dir = TempDir::new().unwrap();
        let root = dir.path();
        write_file(root, "A.md", "Hello from A");

        let docs = make_docs(root, &["A.md"]);
        let result = merge_documents_inner(root, &docs, None, &[], None);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("ordering is empty"));
    }

    #[test]
    fn merge_inner_out_of_bounds_ordering_returns_error() {
        let dir = TempDir::new().unwrap();
        let root = dir.path();
        write_file(root, "A.md", "Hello from A");
        write_file(root, "B.md", "Hello from B");

        let docs = make_docs(root, &["A.md", "B.md"]);
        let result = merge_documents_inner(root, &docs, None, &[0, 5], None);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Invalid ordering index 5"));
    }

    #[test]
    fn merge_inner_duplicate_ordering_returns_error() {
        let dir = TempDir::new().unwrap();
        let root = dir.path();
        write_file(root, "A.md", "Hello from A");
        write_file(root, "B.md", "Hello from B");

        let docs = make_docs(root, &["A.md", "B.md"]);
        let result = merge_documents_inner(root, &docs, None, &[0, 0], None);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Duplicate ordering index"));
    }

    #[test]
    fn merge_inner_empty_title_falls_back_to_plan() {
        let dir = TempDir::new().unwrap();
        let root = dir.path();
        write_file(root, "A.md", "Hello from A");
        write_file(root, "B.md", "Hello from B");

        let docs = make_docs(root, &["A.md", "B.md"]);
        let result =
            merge_documents_inner(root, &docs, Some(""), &[0, 1], None).unwrap();

        assert!(
            result.merged_path.ends_with("A + B.md"),
            "empty title should fall back to plan title, got: {}",
            result.merged_path
        );
    }

    #[test]
    fn merge_inner_whitespace_title_falls_back_to_plan() {
        let dir = TempDir::new().unwrap();
        let root = dir.path();
        write_file(root, "A.md", "Hello from A");
        write_file(root, "B.md", "Hello from B");

        let docs = make_docs(root, &["A.md", "B.md"]);
        let result =
            merge_documents_inner(root, &docs, Some("   "), &[0, 1], None).unwrap();

        assert!(
            result.merged_path.ends_with("A + B.md"),
            "whitespace title should fall back to plan title, got: {}",
            result.merged_path
        );
    }

    #[test]
    fn merge_inner_no_self_referential_rewrite() {
        let dir = TempDir::new().unwrap();
        let root = dir.path();
        write_file(root, "A.md", "Links to [[B]]");
        write_file(root, "B.md", "Links to [[A]]");
        write_file(root, "C.md", "See [[A]] and [[B]]");

        let docs = make_docs(root, &["A.md", "B.md"]);
        let result =
            merge_documents_inner(root, &docs, Some("Merged"), &[0, 1], None).unwrap();

        let merged_on_disk = fs::read_to_string(root.join("Merged.md")).unwrap();
        assert_eq!(
            merged_on_disk, result.merged_content,
            "on-disk content must match returned merged_content"
        );
        assert!(
            !merged_on_disk.contains("[[Merged]]"),
            "merged file should not contain self-referential links, got: {}",
            merged_on_disk
        );

        let c_content = fs::read_to_string(root.join("C.md")).unwrap();
        assert!(
            c_content.contains("[[Merged]]"),
            "C.md should still be rewritten: {}",
            c_content
        );
    }

    #[test]
    fn merge_inner_source_files_not_rewritten_before_trash() {
        let dir = TempDir::new().unwrap();
        let root = dir.path();
        write_file(root, "A.md", "References [[B]]");
        write_file(root, "B.md", "Hello from B");

        let docs = make_docs(root, &["A.md", "B.md"]);
        let result =
            merge_documents_inner(root, &docs, Some("Merged"), &[0, 1], None).unwrap();

        for pr in &result.planned_rewrites.rewrites {
            assert_ne!(
                pr.relative_path, "A.md",
                "source file A.md should not be in planned rewrites"
            );
            assert_ne!(
                pr.relative_path, "B.md",
                "source file B.md should not be in planned rewrites"
            );
        }

        assert_eq!(
            result.source_snapshots[0].1, "References [[B]]",
            "source snapshot should contain original content"
        );
    }
}
