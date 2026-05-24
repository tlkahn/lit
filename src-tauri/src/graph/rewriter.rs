use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;
use walkdir::WalkDir;

use super::indexer::normalize_stem;
use super::links::{blank_fenced_code_blocks, blank_inline_code};

#[derive(Debug, Clone, Deserialize)]
pub struct LinkRedirect {
    pub old_target: String,
    pub new_target: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct FileRewriteResult {
    pub relative_path: String,
    pub links_changed: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct RewriteSummary {
    pub files_scanned: usize,
    pub files_modified: Vec<FileRewriteResult>,
    pub total_links_changed: usize,
}

pub fn rewrite_body(
    body: &str,
    redirects: &HashMap<String, String>,
) -> (String, usize) {
    if body.is_empty() || redirects.is_empty() {
        return (body.to_string(), 0);
    }

    let mut blanked = body.to_string();
    blank_fenced_code_blocks(&mut blanked);
    blank_inline_code(&mut blanked);

    let re = Regex::new(r"\[\[([^\[\]]+)\]\]").unwrap();
    let mut replacements: Vec<(usize, usize, String)> = Vec::new();

    for m in re.find_iter(&blanked) {
        let inner = &blanked[m.start() + 2..m.end() - 2];
        let trimmed = inner.trim();
        if trimmed.is_empty() {
            continue;
        }

        let (target_part, display) = if let Some(pipe_pos) = trimmed.find('|') {
            (trimmed[..pipe_pos].trim(), Some(trimmed[pipe_pos + 1..].trim()))
        } else {
            (trimmed, None)
        };

        let (target, section) = if let Some(hash_pos) = target_part.find('#') {
            (target_part[..hash_pos].trim(), Some(target_part[hash_pos + 1..].trim()))
        } else {
            (target_part, None)
        };

        let stem = normalize_stem(target);
        if let Some(new_target) = redirects.get(&stem) {
            let mut replacement = String::from("[[");
            replacement.push_str(new_target);
            if let Some(sec) = section {
                replacement.push('#');
                replacement.push_str(sec);
            }
            if let Some(disp) = display {
                replacement.push('|');
                replacement.push_str(disp);
            }
            replacement.push_str("]]");
            replacements.push((m.start(), m.end(), replacement));
        }
    }

    let count = replacements.len();
    if count == 0 {
        return (body.to_string(), 0);
    }

    let mut result = body.to_string();
    for (start, end, replacement) in replacements.into_iter().rev() {
        result.replace_range(start..end, &replacement);
    }

    (result, count)
}

pub fn build_redirect_map(redirects: &[LinkRedirect]) -> HashMap<String, String> {
    redirects
        .iter()
        .map(|r| (normalize_stem(&r.old_target), r.new_target.clone()))
        .collect()
}

fn walk_md_files_for_rewrite(root: &Path) -> Vec<String> {
    let mut files = Vec::new();
    for entry in WalkDir::new(root).into_iter().filter_entry(|e| {
        if e.depth() == 0 {
            return true;
        }
        let name = e.file_name().to_string_lossy();
        !name.starts_with('.')
    }) {
        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue,
        };
        if !entry.file_type().is_file() {
            continue;
        }
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("md") {
            continue;
        }
        let relative = path
            .strip_prefix(root)
            .unwrap_or(path)
            .to_string_lossy()
            .to_string();
        files.push(relative);
    }
    files
}

pub fn rewrite_links_in_vault(
    root: &Path,
    redirects: &[LinkRedirect],
) -> Result<RewriteSummary, String> {
    let map = build_redirect_map(redirects);
    if map.is_empty() {
        return Ok(RewriteSummary {
            files_scanned: 0,
            files_modified: vec![],
            total_links_changed: 0,
        });
    }

    let md_files = walk_md_files_for_rewrite(root);
    let files_scanned = md_files.len();

    // Phase 1: Collect
    let mut changes: Vec<(String, String, String, usize)> = Vec::new(); // (rel_path, original, new, count)
    for rel_path in &md_files {
        let full_path = root.join(rel_path);
        let original = std::fs::read_to_string(&full_path)
            .map_err(|e| format!("Failed to read {}: {}", rel_path, e))?;
        let (rewritten, count) = rewrite_body(&original, &map);
        if count > 0 {
            changes.push((rel_path.clone(), original, rewritten, count));
        }
    }

    // Phase 2: Write with rollback
    let mut written: Vec<(String, String)> = Vec::new(); // (rel_path, original_content) for rollback
    for (rel_path, original, new_content, _) in &changes {
        let full_path = root.join(rel_path);
        match std::fs::write(&full_path, new_content) {
            Ok(()) => {
                written.push((rel_path.clone(), original.clone()));
            }
            Err(e) => {
                // Rollback all previously written files
                for (written_path, orig) in &written {
                    let _ = std::fs::write(root.join(written_path), orig);
                }
                return Err(format!("Failed to write {}: {}", rel_path, e));
            }
        }
    }

    let files_modified: Vec<FileRewriteResult> = changes
        .iter()
        .map(|(rel_path, _, _, count)| FileRewriteResult {
            relative_path: rel_path.clone(),
            links_changed: *count,
        })
        .collect();
    let total_links_changed = files_modified.iter().map(|f| f.links_changed).sum();

    Ok(RewriteSummary {
        files_scanned,
        files_modified,
        total_links_changed,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    fn make_map(pairs: &[(&str, &str)]) -> HashMap<String, String> {
        build_redirect_map(
            &pairs
                .iter()
                .map(|(old, new)| LinkRedirect {
                    old_target: old.to_string(),
                    new_target: new.to_string(),
                })
                .collect::<Vec<_>>(),
        )
    }

    // -----------------------------------------------------------------------
    // Phase A: rewrite_body — pure string transformation
    // -----------------------------------------------------------------------

    #[test]
    fn no_matching_links_unchanged() {
        let body = "See [[Other]] for details.";
        let map = make_map(&[("OldPage", "NewPage")]);
        let (result, count) = rewrite_body(body, &map);
        assert_eq!(result, body);
        assert_eq!(count, 0);
    }

    #[test]
    fn simple_link_rewrite() {
        let body = "See [[OldPage]] for details.";
        let map = make_map(&[("OldPage", "NewPage")]);
        let (result, count) = rewrite_body(body, &map);
        assert_eq!(result, "See [[NewPage]] for details.");
        assert_eq!(count, 1);
    }

    #[test]
    fn preserves_display_text() {
        let body = "See [[OldPage|alias]] here.";
        let map = make_map(&[("OldPage", "NewPage")]);
        let (result, count) = rewrite_body(body, &map);
        assert_eq!(result, "See [[NewPage|alias]] here.");
        assert_eq!(count, 1);
    }

    #[test]
    fn preserves_section_anchor() {
        let body = "See [[OldPage#heading]] here.";
        let map = make_map(&[("OldPage", "NewPage")]);
        let (result, count) = rewrite_body(body, &map);
        assert_eq!(result, "See [[NewPage#heading]] here.");
        assert_eq!(count, 1);
    }

    #[test]
    fn preserves_section_and_display() {
        let body = "See [[OldPage#sec|text]] here.";
        let map = make_map(&[("OldPage", "NewPage")]);
        let (result, count) = rewrite_body(body, &map);
        assert_eq!(result, "See [[NewPage#sec|text]] here.");
        assert_eq!(count, 1);
    }

    #[test]
    fn multiple_links_in_body() {
        let body = "A [[OldPage]] B [[Other]] C [[OldPage]] D";
        let map = make_map(&[("OldPage", "NewPage")]);
        let (result, count) = rewrite_body(body, &map);
        assert_eq!(result, "A [[NewPage]] B [[Other]] C [[NewPage]] D");
        assert_eq!(count, 2);
    }

    #[test]
    fn case_insensitive_stem_match() {
        let body = "See [[oldpage]] here.";
        let map = make_map(&[("OldPage", "NewPage")]);
        let (result, count) = rewrite_body(body, &map);
        assert_eq!(result, "See [[NewPage]] here.");
        assert_eq!(count, 1);
    }

    #[test]
    fn skips_fenced_code_block() {
        let body = "before\n```\n[[OldPage]]\n```\nafter [[OldPage]]";
        let map = make_map(&[("OldPage", "NewPage")]);
        let (result, count) = rewrite_body(body, &map);
        assert_eq!(result, "before\n```\n[[OldPage]]\n```\nafter [[NewPage]]");
        assert_eq!(count, 1);
    }

    #[test]
    fn skips_inline_code() {
        let body = "Use `[[OldPage]]` in code. Real [[OldPage]] here.";
        let map = make_map(&[("OldPage", "NewPage")]);
        let (result, count) = rewrite_body(body, &map);
        assert_eq!(result, "Use `[[OldPage]]` in code. Real [[NewPage]] here.");
        assert_eq!(count, 1);
    }

    #[test]
    fn rewrites_embed_link() {
        let body = "![[OldPage]]";
        let map = make_map(&[("OldPage", "NewPage")]);
        let (result, count) = rewrite_body(body, &map);
        assert_eq!(result, "![[NewPage]]");
        assert_eq!(count, 1);
    }

    #[test]
    fn mixed_content() {
        let body = "Real [[OldPage]]. Code `[[OldPage]]`. Embed ![[OldPage]]. Alias [[OldPage|x]]. Other [[Other]].";
        let map = make_map(&[("OldPage", "NewPage")]);
        let (result, count) = rewrite_body(body, &map);
        assert_eq!(
            result,
            "Real [[NewPage]]. Code `[[OldPage]]`. Embed ![[NewPage]]. Alias [[NewPage|x]]. Other [[Other]]."
        );
        assert_eq!(count, 3);
    }

    #[test]
    fn folder_path_link_stem_match() {
        let body = "See [[folder/OldPage]] here.";
        let map = make_map(&[("OldPage", "NewPage")]);
        let (result, count) = rewrite_body(body, &map);
        assert_eq!(result, "See [[NewPage]] here.");
        assert_eq!(count, 1);
    }

    #[test]
    fn multiple_redirects() {
        let body = "A [[Alpha]] and [[Beta]].";
        let map = make_map(&[("Alpha", "AlphaNew"), ("Beta", "BetaNew")]);
        let (result, count) = rewrite_body(body, &map);
        assert_eq!(result, "A [[AlphaNew]] and [[BetaNew]].");
        assert_eq!(count, 2);
    }

    #[test]
    fn empty_body() {
        let map = make_map(&[("OldPage", "NewPage")]);
        let (result, count) = rewrite_body("", &map);
        assert_eq!(result, "");
        assert_eq!(count, 0);
    }

    #[test]
    fn no_redirects() {
        let body = "See [[Page]] here.";
        let map: HashMap<String, String> = HashMap::new();
        let (result, count) = rewrite_body(body, &map);
        assert_eq!(result, body);
        assert_eq!(count, 0);
    }

    // -----------------------------------------------------------------------
    // Phase B: rewrite_links_in_vault — file-level scanning and writing
    // -----------------------------------------------------------------------

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

    #[test]
    fn single_file_vault() {
        let tmp = TempDir::new().unwrap();
        write_file(tmp.path(), "note.md", "Link to [[OldPage]].");
        let redirects = vec![LinkRedirect {
            old_target: "OldPage".into(),
            new_target: "NewPage".into(),
        }];
        let summary = rewrite_links_in_vault(tmp.path(), &redirects).unwrap();
        assert_eq!(summary.files_scanned, 1);
        assert_eq!(summary.files_modified.len(), 1);
        assert_eq!(summary.total_links_changed, 1);
        assert_eq!(read_file(tmp.path(), "note.md"), "Link to [[NewPage]].");
    }

    #[test]
    fn only_matching_files_modified() {
        let tmp = TempDir::new().unwrap();
        write_file(tmp.path(), "a.md", "[[OldPage]]");
        write_file(tmp.path(), "b.md", "[[Other]]");
        write_file(tmp.path(), "c.md", "No links here.");
        let redirects = vec![LinkRedirect {
            old_target: "OldPage".into(),
            new_target: "NewPage".into(),
        }];
        let summary = rewrite_links_in_vault(tmp.path(), &redirects).unwrap();
        assert_eq!(summary.files_scanned, 3);
        assert_eq!(summary.files_modified.len(), 1);
        assert_eq!(summary.files_modified[0].relative_path, "a.md");
        assert_eq!(read_file(tmp.path(), "b.md"), "[[Other]]");
        assert_eq!(read_file(tmp.path(), "c.md"), "No links here.");
    }

    #[test]
    fn hidden_dirs_skipped() {
        let tmp = TempDir::new().unwrap();
        write_file(tmp.path(), "visible.md", "[[OldPage]]");
        write_file(tmp.path(), ".obsidian/config.md", "[[OldPage]]");
        let redirects = vec![LinkRedirect {
            old_target: "OldPage".into(),
            new_target: "NewPage".into(),
        }];
        let summary = rewrite_links_in_vault(tmp.path(), &redirects).unwrap();
        assert_eq!(summary.files_modified.len(), 1);
        assert_eq!(
            read_file(tmp.path(), ".obsidian/config.md"),
            "[[OldPage]]"
        );
    }

    #[test]
    fn frontmatter_preserved() {
        let tmp = TempDir::new().unwrap();
        let content = "---\ntitle: My Note\ntags: [a, b]\n---\n\nBody with [[OldPage]].";
        write_file(tmp.path(), "note.md", content);
        let redirects = vec![LinkRedirect {
            old_target: "OldPage".into(),
            new_target: "NewPage".into(),
        }];
        let summary = rewrite_links_in_vault(tmp.path(), &redirects).unwrap();
        assert_eq!(summary.total_links_changed, 1);
        let result = read_file(tmp.path(), "note.md");
        assert!(result.starts_with("---\ntitle: My Note\ntags: [a, b]\n---"));
        assert!(result.contains("[[NewPage]]"));
    }

    #[test]
    fn empty_vault() {
        let tmp = TempDir::new().unwrap();
        let redirects = vec![LinkRedirect {
            old_target: "OldPage".into(),
            new_target: "NewPage".into(),
        }];
        let summary = rewrite_links_in_vault(tmp.path(), &redirects).unwrap();
        assert_eq!(summary.files_scanned, 0);
        assert_eq!(summary.files_modified.len(), 0);
    }

    #[test]
    fn non_md_files_skipped() {
        let tmp = TempDir::new().unwrap();
        write_file(tmp.path(), "note.txt", "[[OldPage]]");
        write_file(tmp.path(), "doc.pdf", "[[OldPage]]");
        write_file(tmp.path(), "real.md", "[[OldPage]]");
        let redirects = vec![LinkRedirect {
            old_target: "OldPage".into(),
            new_target: "NewPage".into(),
        }];
        let summary = rewrite_links_in_vault(tmp.path(), &redirects).unwrap();
        assert_eq!(summary.files_scanned, 1);
        assert_eq!(summary.files_modified.len(), 1);
        assert_eq!(read_file(tmp.path(), "note.txt"), "[[OldPage]]");
    }

    #[test]
    fn nested_subdirectories() {
        let tmp = TempDir::new().unwrap();
        write_file(tmp.path(), "a/b/c/deep.md", "[[OldPage]]");
        write_file(tmp.path(), "top.md", "[[OldPage]]");
        let redirects = vec![LinkRedirect {
            old_target: "OldPage".into(),
            new_target: "NewPage".into(),
        }];
        let summary = rewrite_links_in_vault(tmp.path(), &redirects).unwrap();
        assert_eq!(summary.files_modified.len(), 2);
        assert_eq!(summary.total_links_changed, 2);
        assert_eq!(read_file(tmp.path(), "a/b/c/deep.md"), "[[NewPage]]");
        assert_eq!(read_file(tmp.path(), "top.md"), "[[NewPage]]");
    }

    // -----------------------------------------------------------------------
    // Phase C: Atomicity
    // -----------------------------------------------------------------------

    #[cfg(unix)]
    #[test]
    fn rollback_on_write_failure() {
        use std::os::unix::fs::PermissionsExt;

        let tmp = TempDir::new().unwrap();
        write_file(tmp.path(), "a.md", "[[OldPage]]");
        write_file(tmp.path(), "b.md", "[[OldPage]]");

        // Make b.md read-only so the write fails
        let b_path = tmp.path().join("b.md");
        let perms = fs::Permissions::from_mode(0o444);
        fs::set_permissions(&b_path, perms).unwrap();

        let redirects = vec![LinkRedirect {
            old_target: "OldPage".into(),
            new_target: "NewPage".into(),
        }];
        let result = rewrite_links_in_vault(tmp.path(), &redirects);
        assert!(result.is_err());

        // a.md should be rolled back to original
        assert_eq!(read_file(tmp.path(), "a.md"), "[[OldPage]]");

        // Restore permissions for cleanup
        fs::set_permissions(&b_path, fs::Permissions::from_mode(0o644)).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn error_reports_failed_path() {
        use std::os::unix::fs::PermissionsExt;

        let tmp = TempDir::new().unwrap();
        write_file(tmp.path(), "fail.md", "[[OldPage]]");

        let fail_path = tmp.path().join("fail.md");
        fs::set_permissions(&fail_path, fs::Permissions::from_mode(0o444)).unwrap();

        let redirects = vec![LinkRedirect {
            old_target: "OldPage".into(),
            new_target: "NewPage".into(),
        }];
        let result = rewrite_links_in_vault(tmp.path(), &redirects);
        let err = result.unwrap_err();
        assert!(err.contains("fail.md"), "Error should mention the failed path: {}", err);

        fs::set_permissions(&fail_path, fs::Permissions::from_mode(0o644)).unwrap();
    }
}
