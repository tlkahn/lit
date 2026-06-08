use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::sync::LazyLock;
use walkdir::WalkDir;

static WIKILINK_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\[\[([^\[\]]+)\]\]").unwrap());

use super::indexer::normalize_stem;
use super::links::{blank_fenced_code_blocks, blank_frontmatter, blank_inline_code};

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
    blank_frontmatter(&mut blanked);
    blank_fenced_code_blocks(&mut blanked);
    blank_inline_code(&mut blanked);
    debug_assert_eq!(body.len(), blanked.len(), "blanking must preserve byte length");

    let mut replacements: Vec<(usize, usize, String)> = Vec::new();

    for m in WIKILINK_RE.find_iter(&blanked) {
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
            if let Some(slash_pos) = target.rfind('/') {
                replacement.push_str(&target[..=slash_pos]);
            }
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

pub(crate) fn walk_md_files_for_rewrite(root: &Path) -> Vec<String> {
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

#[derive(Debug, Clone, Serialize)]
pub struct PlannedRewrite {
    pub relative_path: String,
    pub before_content: String,
    pub after_content: String,
    pub links_changed: usize,
}

#[derive(Debug, Clone)]
pub struct PlannedVaultRewrite {
    pub files_scanned: usize,
    pub rewrites: Vec<PlannedRewrite>,
}

/// Closure-based scan: reads each candidate path via `read_fn` instead of the
/// filesystem. `read_fn` returns `Err` for a genuinely missing/unreadable path;
/// when `skip_missing` is set those paths are skipped silently.
fn scan_files_for_rewrites_with<R: Fn(&str) -> Result<String, String>>(
    rel_paths: &[String],
    map: &HashMap<String, String>,
    skip_missing: bool,
    read_fn: R,
) -> Result<(usize, Vec<PlannedRewrite>), String> {
    let mut files_scanned = 0;
    let mut rewrites = Vec::new();

    for rel_path in rel_paths {
        let original = match read_fn(rel_path) {
            Ok(s) => s,
            Err(_) if skip_missing => continue,
            Err(e) => return Err(format!("Failed to read {}: {}", rel_path, e)),
        };
        files_scanned += 1;
        let (rewritten, count) = rewrite_body(&original, map);
        if count > 0 {
            rewrites.push(PlannedRewrite {
                relative_path: rel_path.clone(),
                before_content: original,
                after_content: rewritten,
                links_changed: count,
            });
        }
    }

    Ok((files_scanned, rewrites))
}

fn scan_files_for_rewrites(
    root: &Path,
    rel_paths: &[String],
    map: &HashMap<String, String>,
    skip_missing: bool,
) -> Result<(usize, Vec<PlannedRewrite>), String> {
    scan_files_for_rewrites_with(rel_paths, map, skip_missing, |rel| {
        std::fs::read_to_string(root.join(rel)).map_err(|e| e.to_string())
    })
}

/// Plan rewrites over an explicit path list, reading content via `read_fn`
/// (e.g. from a `NotesStore` in DB storage mode). Missing paths are skipped.
pub fn plan_vault_rewrites_with<R: Fn(&str) -> Result<String, String>>(
    paths: &[String],
    redirects: &[LinkRedirect],
    read_fn: R,
) -> Result<PlannedVaultRewrite, String> {
    let map = build_redirect_map(redirects);
    if map.is_empty() || paths.is_empty() {
        return Ok(PlannedVaultRewrite {
            files_scanned: 0,
            rewrites: vec![],
        });
    }

    let (files_scanned, rewrites) = scan_files_for_rewrites_with(paths, &map, true, read_fn)?;

    Ok(PlannedVaultRewrite {
        files_scanned,
        rewrites,
    })
}

pub fn plan_vault_rewrites(
    root: &Path,
    redirects: &[LinkRedirect],
) -> Result<PlannedVaultRewrite, String> {
    let map = build_redirect_map(redirects);
    if map.is_empty() {
        return Ok(PlannedVaultRewrite {
            files_scanned: 0,
            rewrites: vec![],
        });
    }

    let md_files = walk_md_files_for_rewrite(root);
    let (files_scanned, rewrites) = scan_files_for_rewrites(root, &md_files, &map, false)?;

    Ok(PlannedVaultRewrite {
        files_scanned,
        rewrites,
    })
}

pub fn plan_vault_rewrites_for_paths(
    root: &Path,
    redirects: &[LinkRedirect],
    candidate_paths: &HashSet<String>,
) -> Result<PlannedVaultRewrite, String> {
    let map = build_redirect_map(redirects);
    if map.is_empty() || candidate_paths.is_empty() {
        return Ok(PlannedVaultRewrite {
            files_scanned: 0,
            rewrites: vec![],
        });
    }

    let paths: Vec<String> = candidate_paths.iter().cloned().collect();
    let (files_scanned, rewrites) = scan_files_for_rewrites(root, &paths, &map, true)?;

    Ok(PlannedVaultRewrite {
        files_scanned,
        rewrites,
    })
}

/// Closure-based apply: writes each rewrite via `write_fn(path, content)`
/// instead of the filesystem. On a write failure, already-written entries are
/// rolled back by calling `write_fn(path, before_content)`.
pub fn apply_planned_rewrites_with<W: Fn(&str, &str) -> Result<(), String>>(
    planned: &PlannedVaultRewrite,
    write_fn: W,
) -> Result<RewriteSummary, String> {
    let mut written: Vec<(&str, &str)> = Vec::new();

    for pr in &planned.rewrites {
        match write_fn(&pr.relative_path, &pr.after_content) {
            Ok(()) => {
                written.push((&pr.relative_path, &pr.before_content));
            }
            Err(e) => {
                for (written_path, orig) in &written {
                    let _ = write_fn(written_path, orig);
                }
                return Err(format!("Failed to write {}: {}", pr.relative_path, e));
            }
        }
    }

    let files_modified: Vec<FileRewriteResult> = planned
        .rewrites
        .iter()
        .map(|pr| FileRewriteResult {
            relative_path: pr.relative_path.clone(),
            links_changed: pr.links_changed,
        })
        .collect();
    let total_links_changed = files_modified.iter().map(|f| f.links_changed).sum();

    Ok(RewriteSummary {
        files_scanned: planned.files_scanned,
        files_modified,
        total_links_changed,
    })
}

pub fn apply_planned_rewrites(
    root: &Path,
    planned: &PlannedVaultRewrite,
) -> Result<RewriteSummary, String> {
    apply_planned_rewrites_with(planned, |rel, content| {
        std::fs::write(root.join(rel), content).map_err(|e| e.to_string())
    })
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

pub fn rewrite_body_for_split(
    body: &str,
    original_stem: &str,
    section_to_doc: &HashMap<String, String>,
    default_target: &str,
) -> (String, usize) {
    if body.is_empty() {
        return (body.to_string(), 0);
    }

    let norm_original = normalize_stem(original_stem);

    let mut blanked = body.to_string();
    blank_frontmatter(&mut blanked);
    blank_fenced_code_blocks(&mut blanked);
    blank_inline_code(&mut blanked);
    debug_assert_eq!(body.len(), blanked.len(), "blanking must preserve byte length");

    let mut replacements: Vec<(usize, usize, String)> = Vec::new();

    for m in WIKILINK_RE.find_iter(&blanked) {
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
            (
                target_part[..hash_pos].trim(),
                Some(target_part[hash_pos + 1..].trim()),
            )
        } else {
            (target_part, None)
        };

        let stem = normalize_stem(target);
        if stem != norm_original {
            continue;
        }

        let folder_prefix = if let Some(slash_pos) = target.rfind('/') {
            &target[..=slash_pos]
        } else {
            ""
        };

        let replacement = match section {
            Some(sec) => {
                let norm_sec = sec.to_lowercase();
                if let Some(doc_stem) = section_to_doc.get(&norm_sec) {
                    let mut r = String::from("[[");
                    r.push_str(folder_prefix);
                    r.push_str(doc_stem);
                    if let Some(disp) = display {
                        r.push('|');
                        r.push_str(disp);
                    }
                    r.push_str("]]");
                    r
                } else {
                    let mut r = String::from("[[");
                    r.push_str(folder_prefix);
                    r.push_str(default_target);
                    r.push('#');
                    r.push_str(sec);
                    if let Some(disp) = display {
                        r.push('|');
                        r.push_str(disp);
                    }
                    r.push_str("]]");
                    r
                }
            }
            None => {
                let mut r = String::from("[[");
                r.push_str(folder_prefix);
                r.push_str(default_target);
                if let Some(disp) = display {
                    r.push('|');
                    r.push_str(disp);
                }
                r.push_str("]]");
                r
            }
        };

        replacements.push((m.start(), m.end(), replacement));
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
        assert_eq!(result, "See [[folder/NewPage]] here.");
        assert_eq!(count, 1);
    }

    #[test]
    fn nested_folder_prefix_preserved() {
        let body = "[[a/b/OldPage]]";
        let map = make_map(&[("OldPage", "NewPage")]);
        let (result, count) = rewrite_body(body, &map);
        assert_eq!(result, "[[a/b/NewPage]]");
        assert_eq!(count, 1);
    }

    #[test]
    fn folder_prefix_with_section_and_display() {
        let body = "[[folder/OldPage#sec|alias]]";
        let map = make_map(&[("OldPage", "NewPage")]);
        let (result, count) = rewrite_body(body, &map);
        assert_eq!(result, "[[folder/NewPage#sec|alias]]");
        assert_eq!(count, 1);
    }

    #[test]
    fn rewrite_body_multibyte_with_links() {
        let body = "你好 [[OldPage]] 世界\n```\n[[OldPage]]\n```\n`[[OldPage]]` 结束";
        let map = make_map(&[("OldPage", "NewPage")]);
        let (result, count) = rewrite_body(body, &map);
        assert_eq!(count, 1);
        assert!(result.contains("你好 [[NewPage]] 世界"));
        assert!(result.contains("```\n[[OldPage]]\n```"));
        assert!(result.contains("`[[OldPage]]`"));
    }

    #[test]
    fn no_folder_prefix_unchanged() {
        let body = "[[OldPage]]";
        let map = make_map(&[("OldPage", "NewPage")]);
        let (result, count) = rewrite_body(body, &map);
        assert_eq!(result, "[[NewPage]]");
        assert_eq!(count, 1);
    }

    #[test]
    fn frontmatter_wikilink_not_rewritten() {
        let body = "---\nrelated: \"[[OldPage]]\"\n---\nBody [[OldPage]].";
        let map = make_map(&[("OldPage", "NewPage")]);
        let (result, count) = rewrite_body(body, &map);
        assert_eq!(count, 1);
        assert!(result.starts_with("---\nrelated: \"[[OldPage]]\"\n---"));
        assert!(result.ends_with("Body [[NewPage]]."));
    }

    #[test]
    fn frontmatter_only_wikilinks_zero_changes() {
        let body = "---\nrelated: \"[[OldPage]]\"\ntags: [a]\n---\nNo links.";
        let map = make_map(&[("OldPage", "NewPage")]);
        let (result, count) = rewrite_body(body, &map);
        assert_eq!(count, 0);
        assert_eq!(result, body);
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

    #[test]
    fn vault_frontmatter_wikilink_untouched() {
        let tmp = TempDir::new().unwrap();
        let content = "---\nrelated: \"[[OldPage]]\"\n---\nBody [[OldPage]].";
        write_file(tmp.path(), "note.md", content);
        let redirects = vec![LinkRedirect {
            old_target: "OldPage".into(),
            new_target: "NewPage".into(),
        }];
        let summary = rewrite_links_in_vault(tmp.path(), &redirects).unwrap();
        assert_eq!(summary.total_links_changed, 1);
        let result = read_file(tmp.path(), "note.md");
        assert!(result.contains("related: \"[[OldPage]]\""));
        assert!(result.contains("Body [[NewPage]]."));
    }

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

    // -----------------------------------------------------------------------
    // Phase D: plan_vault_rewrites — collect changes without writing
    // -----------------------------------------------------------------------

    #[test]
    fn plan_vault_rewrites_collects_before_after() {
        let tmp = TempDir::new().unwrap();
        write_file(tmp.path(), "note.md", "Link to [[OldPage]].");
        let redirects = vec![LinkRedirect {
            old_target: "OldPage".into(),
            new_target: "NewPage".into(),
        }];
        let planned = plan_vault_rewrites(tmp.path(), &redirects).unwrap();
        assert_eq!(planned.files_scanned, 1);
        assert_eq!(planned.rewrites.len(), 1);
        assert_eq!(planned.rewrites[0].before_content, "Link to [[OldPage]].");
        assert_eq!(planned.rewrites[0].after_content, "Link to [[NewPage]].");
        assert_eq!(planned.rewrites[0].links_changed, 1);
        // File on disk is NOT modified
        assert_eq!(read_file(tmp.path(), "note.md"), "Link to [[OldPage]].");
    }

    #[test]
    fn plan_vault_rewrites_empty_redirects() {
        let tmp = TempDir::new().unwrap();
        write_file(tmp.path(), "note.md", "[[OldPage]]");
        let planned = plan_vault_rewrites(tmp.path(), &[]).unwrap();
        assert_eq!(planned.files_scanned, 0);
        assert!(planned.rewrites.is_empty());
    }

    #[test]
    fn plan_vault_rewrites_no_matching_links() {
        let tmp = TempDir::new().unwrap();
        write_file(tmp.path(), "note.md", "[[Other]]");
        let redirects = vec![LinkRedirect {
            old_target: "OldPage".into(),
            new_target: "NewPage".into(),
        }];
        let planned = plan_vault_rewrites(tmp.path(), &redirects).unwrap();
        assert_eq!(planned.files_scanned, 1);
        assert!(planned.rewrites.is_empty());
    }

    #[test]
    fn plan_vault_rewrites_tracks_files_scanned() {
        let tmp = TempDir::new().unwrap();
        write_file(tmp.path(), "a.md", "[[OldPage]]");
        write_file(tmp.path(), "b.md", "[[Other]]");
        write_file(tmp.path(), "c.md", "No links.");
        let redirects = vec![LinkRedirect {
            old_target: "OldPage".into(),
            new_target: "NewPage".into(),
        }];
        let planned = plan_vault_rewrites(tmp.path(), &redirects).unwrap();
        assert_eq!(planned.files_scanned, 3);
        assert_eq!(planned.rewrites.len(), 1);
    }

    // -----------------------------------------------------------------------
    // Phase E: apply_planned_rewrites — write planned changes to disk
    // -----------------------------------------------------------------------

    #[test]
    fn apply_planned_rewrites_writes_to_disk() {
        let tmp = TempDir::new().unwrap();
        write_file(tmp.path(), "note.md", "Link to [[OldPage]].");
        let redirects = vec![LinkRedirect {
            old_target: "OldPage".into(),
            new_target: "NewPage".into(),
        }];
        let planned = plan_vault_rewrites(tmp.path(), &redirects).unwrap();
        let summary = apply_planned_rewrites(tmp.path(), &planned).unwrap();
        assert_eq!(summary.files_scanned, 1);
        assert_eq!(summary.files_modified.len(), 1);
        assert_eq!(summary.total_links_changed, 1);
        assert_eq!(read_file(tmp.path(), "note.md"), "Link to [[NewPage]].");
    }

    #[test]
    fn apply_planned_rewrites_returns_correct_summary() {
        let tmp = TempDir::new().unwrap();
        write_file(tmp.path(), "a.md", "[[OldPage]] and [[OldPage]]");
        write_file(tmp.path(), "b.md", "[[OldPage]]");
        let redirects = vec![LinkRedirect {
            old_target: "OldPage".into(),
            new_target: "NewPage".into(),
        }];
        let planned = plan_vault_rewrites(tmp.path(), &redirects).unwrap();
        let summary = apply_planned_rewrites(tmp.path(), &planned).unwrap();
        assert_eq!(summary.files_modified.len(), 2);
        assert_eq!(summary.total_links_changed, 3);
    }

    #[cfg(unix)]
    #[test]
    fn apply_planned_rewrites_rollback_on_failure() {
        use std::os::unix::fs::PermissionsExt;

        let tmp = TempDir::new().unwrap();
        write_file(tmp.path(), "a.md", "[[OldPage]]");
        write_file(tmp.path(), "b.md", "[[OldPage]]");

        let redirects = vec![LinkRedirect {
            old_target: "OldPage".into(),
            new_target: "NewPage".into(),
        }];
        let planned = plan_vault_rewrites(tmp.path(), &redirects).unwrap();

        // Make b.md read-only so the write fails
        let b_path = tmp.path().join("b.md");
        fs::set_permissions(&b_path, fs::Permissions::from_mode(0o444)).unwrap();

        let result = apply_planned_rewrites(tmp.path(), &planned);
        assert!(result.is_err());
        // a.md should be rolled back
        assert_eq!(read_file(tmp.path(), "a.md"), "[[OldPage]]");

        fs::set_permissions(&b_path, fs::Permissions::from_mode(0o644)).unwrap();
    }

    // -----------------------------------------------------------------------
    // Phase F: rewrite_body_for_split — section-aware link rewriting
    // -----------------------------------------------------------------------

    fn make_split_map(pairs: &[(&str, &str)]) -> HashMap<String, String> {
        pairs
            .iter()
            .map(|(k, v)| (k.to_lowercase(), v.to_string()))
            .collect()
    }

    // R1: no section anchor → redirect to default target
    #[test]
    fn split_rewrite_bare_link() {
        let map = make_split_map(&[("alpha", "Alpha"), ("beta", "Beta")]);
        let (result, count) = rewrite_body_for_split("See [[OldDoc]].", "OldDoc", &map, "Alpha");
        assert_eq!(result, "See [[Alpha]].");
        assert_eq!(count, 1);
    }

    // R2: matching section anchor → drop anchor
    #[test]
    fn split_rewrite_matching_section() {
        let map = make_split_map(&[("alpha", "Alpha"), ("beta", "Beta")]);
        let (result, count) =
            rewrite_body_for_split("See [[OldDoc#Alpha]].", "OldDoc", &map, "Alpha");
        assert_eq!(result, "See [[Alpha]].");
        assert_eq!(count, 1);
    }

    // R3: unmatched section anchor → redirect to default, keep anchor
    #[test]
    fn split_rewrite_unmatched_section() {
        let map = make_split_map(&[("alpha", "Alpha"), ("beta", "Beta")]);
        let (result, count) =
            rewrite_body_for_split("See [[OldDoc#Random]].", "OldDoc", &map, "Alpha");
        assert_eq!(result, "See [[Alpha#Random]].");
        assert_eq!(count, 1);
    }

    // R4 edge cases
    #[test]
    fn split_rewrite_preserves_display_text() {
        let map = make_split_map(&[("alpha", "Alpha")]);
        let (result, count) =
            rewrite_body_for_split("[[OldDoc|alias]]", "OldDoc", &map, "Alpha");
        assert_eq!(result, "[[Alpha|alias]]");
        assert_eq!(count, 1);
    }

    #[test]
    fn split_rewrite_skips_code_blocks() {
        let map = make_split_map(&[("alpha", "Alpha")]);
        let body = "before\n```\n[[OldDoc]]\n```\nafter [[OldDoc]]";
        let (result, count) = rewrite_body_for_split(body, "OldDoc", &map, "Alpha");
        assert_eq!(result, "before\n```\n[[OldDoc]]\n```\nafter [[Alpha]]");
        assert_eq!(count, 1);
    }

    #[test]
    fn split_rewrite_skips_frontmatter() {
        let map = make_split_map(&[("alpha", "Alpha")]);
        let body = "---\nrelated: \"[[OldDoc]]\"\n---\nBody [[OldDoc]].";
        let (result, count) = rewrite_body_for_split(body, "OldDoc", &map, "Alpha");
        assert_eq!(count, 1);
        assert!(result.starts_with("---\nrelated: \"[[OldDoc]]\"\n---"));
        assert!(result.ends_with("Body [[Alpha]]."));
    }

    #[test]
    fn split_rewrite_folder_prefix() {
        let map = make_split_map(&[("alpha", "Alpha")]);
        let (result, count) =
            rewrite_body_for_split("[[folder/OldDoc]]", "OldDoc", &map, "Alpha");
        assert_eq!(result, "[[folder/Alpha]]");
        assert_eq!(count, 1);
    }

    #[test]
    fn split_rewrite_embed() {
        let map = make_split_map(&[("alpha", "Alpha")]);
        let (result, count) = rewrite_body_for_split("![[OldDoc]]", "OldDoc", &map, "Alpha");
        assert_eq!(result, "![[Alpha]]");
        assert_eq!(count, 1);
    }

    #[test]
    fn split_rewrite_case_insensitive() {
        let map = make_split_map(&[("alpha", "Alpha")]);
        let (result, count) = rewrite_body_for_split("[[olddoc]]", "OldDoc", &map, "Alpha");
        assert_eq!(result, "[[Alpha]]");
        assert_eq!(count, 1);
    }

    #[test]
    fn split_rewrite_no_matching_links() {
        let map = make_split_map(&[("alpha", "Alpha")]);
        let (result, count) = rewrite_body_for_split("[[Other]]", "OldDoc", &map, "Alpha");
        assert_eq!(result, "[[Other]]");
        assert_eq!(count, 0);
    }

    #[test]
    fn split_rewrite_multiple_links() {
        let map = make_split_map(&[("alpha", "Alpha"), ("beta", "Beta")]);
        let body = "A [[OldDoc]] B [[OldDoc#Beta]] C [[OldDoc#Unknown]]";
        let (result, count) = rewrite_body_for_split(body, "OldDoc", &map, "Alpha");
        assert_eq!(result, "A [[Alpha]] B [[Beta]] C [[Alpha#Unknown]]");
        assert_eq!(count, 3);
    }

    #[test]
    fn split_rewrite_section_with_display() {
        let map = make_split_map(&[("alpha", "Alpha"), ("beta", "Beta")]);
        let (result, count) =
            rewrite_body_for_split("[[OldDoc#Beta|my alias]]", "OldDoc", &map, "Alpha");
        assert_eq!(result, "[[Beta|my alias]]");
        assert_eq!(count, 1);
    }

    #[test]
    fn split_rewrite_unmatched_section_with_display() {
        let map = make_split_map(&[("alpha", "Alpha")]);
        let (result, count) =
            rewrite_body_for_split("[[OldDoc#Unk|alias]]", "OldDoc", &map, "Alpha");
        assert_eq!(result, "[[Alpha#Unk|alias]]");
        assert_eq!(count, 1);
    }

    // -----------------------------------------------------------------------
    // Phase G: plan_vault_rewrites_for_paths — targeted scan
    // -----------------------------------------------------------------------

    #[test]
    fn plan_for_paths_scans_only_candidates() {
        let tmp = TempDir::new().unwrap();
        write_file(tmp.path(), "a.md", "[[OldPage]]");
        write_file(tmp.path(), "b.md", "[[OldPage]]");
        write_file(tmp.path(), "c.md", "[[OldPage]]");
        let redirects = vec![LinkRedirect {
            old_target: "OldPage".into(),
            new_target: "NewPage".into(),
        }];
        let candidates: HashSet<String> =
            ["a.md", "c.md"].iter().map(|s| s.to_string()).collect();
        let planned =
            plan_vault_rewrites_for_paths(tmp.path(), &redirects, &candidates).unwrap();
        assert_eq!(planned.files_scanned, 2);
        assert_eq!(planned.rewrites.len(), 2);
        // b.md should be untouched on disk
        assert_eq!(read_file(tmp.path(), "b.md"), "[[OldPage]]");
    }

    #[test]
    fn plan_for_paths_empty_candidates() {
        let tmp = TempDir::new().unwrap();
        write_file(tmp.path(), "a.md", "[[OldPage]]");
        let redirects = vec![LinkRedirect {
            old_target: "OldPage".into(),
            new_target: "NewPage".into(),
        }];
        let candidates: HashSet<String> = HashSet::new();
        let planned =
            plan_vault_rewrites_for_paths(tmp.path(), &redirects, &candidates).unwrap();
        assert_eq!(planned.files_scanned, 0);
        assert!(planned.rewrites.is_empty());
    }

    #[test]
    fn plan_for_paths_finds_rewrites() {
        let tmp = TempDir::new().unwrap();
        write_file(tmp.path(), "note.md", "See [[OldPage]] and [[OldPage]].");
        let redirects = vec![LinkRedirect {
            old_target: "OldPage".into(),
            new_target: "NewPage".into(),
        }];
        let candidates: HashSet<String> = ["note.md"].iter().map(|s| s.to_string()).collect();
        let planned =
            plan_vault_rewrites_for_paths(tmp.path(), &redirects, &candidates).unwrap();
        assert_eq!(planned.files_scanned, 1);
        assert_eq!(planned.rewrites.len(), 1);
        assert_eq!(planned.rewrites[0].before_content, "See [[OldPage]] and [[OldPage]].");
        assert_eq!(planned.rewrites[0].after_content, "See [[NewPage]] and [[NewPage]].");
        assert_eq!(planned.rewrites[0].links_changed, 2);
        // File on disk is NOT modified (plan only)
        assert_eq!(read_file(tmp.path(), "note.md"), "See [[OldPage]] and [[OldPage]].");
    }

    #[test]
    fn plan_for_paths_skips_missing_file() {
        let tmp = TempDir::new().unwrap();
        write_file(tmp.path(), "exists.md", "[[OldPage]]");
        let redirects = vec![LinkRedirect {
            old_target: "OldPage".into(),
            new_target: "NewPage".into(),
        }];
        let candidates: HashSet<String> =
            ["exists.md", "ghost.md"].iter().map(|s| s.to_string()).collect();
        let planned =
            plan_vault_rewrites_for_paths(tmp.path(), &redirects, &candidates).unwrap();
        // ghost.md is skipped, only exists.md counted
        assert_eq!(planned.files_scanned, 1);
        assert_eq!(planned.rewrites.len(), 1);
    }

    #[test]
    fn plan_for_paths_no_matching_links() {
        let tmp = TempDir::new().unwrap();
        write_file(tmp.path(), "a.md", "[[Other]]");
        write_file(tmp.path(), "b.md", "No links here.");
        let redirects = vec![LinkRedirect {
            old_target: "OldPage".into(),
            new_target: "NewPage".into(),
        }];
        let candidates: HashSet<String> =
            ["a.md", "b.md"].iter().map(|s| s.to_string()).collect();
        let planned =
            plan_vault_rewrites_for_paths(tmp.path(), &redirects, &candidates).unwrap();
        assert_eq!(planned.files_scanned, 2);
        assert!(planned.rewrites.is_empty());
    }

    // -----------------------------------------------------------------------
    // Phase H: closure-based plan/apply (Phase 2: StorageBackend dispatch)
    // -----------------------------------------------------------------------

    #[test]
    fn plan_vault_rewrites_with_uses_read_closure() {
        let contents: HashMap<String, String> = [
            ("a.md".to_string(), "See [[OldPage]].".to_string()),
            ("b.md".to_string(), "No links.".to_string()),
        ]
        .into_iter()
        .collect();
        let redirects = vec![LinkRedirect {
            old_target: "OldPage".into(),
            new_target: "NewPage".into(),
        }];
        let paths = vec!["a.md".to_string(), "b.md".to_string()];

        let planned = plan_vault_rewrites_with(&paths, &redirects, |rel| {
            contents
                .get(rel)
                .cloned()
                .ok_or_else(|| "missing".to_string())
        })
        .unwrap();

        assert_eq!(planned.files_scanned, 2);
        assert_eq!(planned.rewrites.len(), 1);
        assert_eq!(planned.rewrites[0].relative_path, "a.md");
        assert_eq!(planned.rewrites[0].before_content, "See [[OldPage]].");
        assert_eq!(planned.rewrites[0].after_content, "See [[NewPage]].");
    }

    #[test]
    fn plan_vault_rewrites_with_skips_missing() {
        let redirects = vec![LinkRedirect {
            old_target: "OldPage".into(),
            new_target: "NewPage".into(),
        }];
        let paths = vec!["exists.md".to_string(), "ghost.md".to_string()];

        let planned = plan_vault_rewrites_with(&paths, &redirects, |rel| {
            if rel == "exists.md" {
                Ok("[[OldPage]]".to_string())
            } else {
                Err("missing".to_string())
            }
        })
        .unwrap();

        assert_eq!(planned.files_scanned, 1);
        assert_eq!(planned.rewrites.len(), 1);
    }

    #[test]
    fn apply_planned_rewrites_with_uses_write_closure() {
        use std::cell::RefCell;

        let planned = PlannedVaultRewrite {
            files_scanned: 1,
            rewrites: vec![PlannedRewrite {
                relative_path: "a.md".into(),
                before_content: "See [[OldPage]].".into(),
                after_content: "See [[NewPage]].".into(),
                links_changed: 1,
            }],
        };

        let written: RefCell<HashMap<String, String>> = RefCell::new(HashMap::new());
        let summary = apply_planned_rewrites_with(&planned, |rel, content| {
            written.borrow_mut().insert(rel.to_string(), content.to_string());
            Ok(())
        })
        .unwrap();

        assert_eq!(summary.files_modified.len(), 1);
        assert_eq!(summary.total_links_changed, 1);
        assert_eq!(
            written.borrow().get("a.md").unwrap(),
            "See [[NewPage]]."
        );
    }

    #[test]
    fn apply_planned_rewrites_with_rolls_back_via_write_closure() {
        use std::cell::RefCell;

        let planned = PlannedVaultRewrite {
            files_scanned: 2,
            rewrites: vec![
                PlannedRewrite {
                    relative_path: "a.md".into(),
                    before_content: "[[OldPage]]".into(),
                    after_content: "[[NewPage]]".into(),
                    links_changed: 1,
                },
                PlannedRewrite {
                    relative_path: "b.md".into(),
                    before_content: "[[OldPage]]".into(),
                    after_content: "[[NewPage]]".into(),
                    links_changed: 1,
                },
            ],
        };

        let store: RefCell<HashMap<String, String>> = RefCell::new(HashMap::new());
        let result = apply_planned_rewrites_with(&planned, |rel, content| {
            if rel == "b.md" && content == "[[NewPage]]" {
                // Force failure on the forward write of b.md.
                return Err("forced failure".to_string());
            }
            store.borrow_mut().insert(rel.to_string(), content.to_string());
            Ok(())
        });

        assert!(result.is_err());
        // a.md must have been rolled back to its before_content.
        assert_eq!(store.borrow().get("a.md").unwrap(), "[[OldPage]]");
    }
}
