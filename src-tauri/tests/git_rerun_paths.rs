//! Tests for `build.rs`'s git rerun-directive logic.
//!
//! Build scripts are a separate compilation unit, so their `#[cfg(test)]`
//! modules never run under `cargo test`. Following the same convention as
//! `tests/ensure_placeholders.rs`, the pure helpers below are mirrors of the
//! `build.rs` originals and must be kept in sync manually.

use std::collections::HashSet;
use std::path::Path;
use std::process::Command;

// --- mirrors of build.rs (keep in sync, enforced by release.bats) ----------

// SYNC:begin:resolve_git_path
fn resolve_git_path(rel: &str) -> Option<String> {
    let arg = if rel == "HEAD" {
        "--git-path"
    } else {
        "--git-common-dir"
    };
    let mut args = vec!["rev-parse", "--path-format=absolute", arg];
    if rel == "HEAD" {
        args.push(rel);
    }
    let out = Command::new("git").args(&args).output().ok()?;
    if !out.status.success() {
        return None;
    }
    let base = String::from_utf8(out.stdout).ok()?.trim().to_string();
    if base.is_empty() {
        return None;
    }
    if rel == "HEAD" {
        Some(base)
    } else {
        Some(Path::new(&base).join(rel).to_string_lossy().into_owned())
    }
}
// SYNC:end:resolve_git_path

// SYNC:begin:git_rerun_paths
fn git_rerun_paths<R, E>(resolve: R, exists: E) -> Vec<String>
where
    R: Fn(&str) -> Option<String>,
    E: Fn(&str) -> bool,
{
    ["HEAD", "refs/tags", "packed-refs"]
        .iter()
        .filter_map(|rel| resolve(rel))
        .filter(|p| exists(p))
        .collect()
}
// SYNC:end:git_rerun_paths

// --- tests ------------------------------------------------------------------

#[test]
fn emits_existing_git_paths_only() {
    let resolve = |rel: &str| -> Option<String> {
        Some(match rel {
            "HEAD" => "/wt/.git/worktrees/x/HEAD".to_string(),
            "refs/tags" => "/repo/.git/refs/tags".to_string(),
            "packed-refs" => "/repo/.git/packed-refs".to_string(),
            _ => return None,
        })
    };
    // refs/tags directory absent (all tags are packed) — must be skipped,
    // otherwise emitting a rerun-if-changed for a missing path would force
    // Cargo to re-run the build script on every single build.
    let present: HashSet<&str> =
        ["/wt/.git/worktrees/x/HEAD", "/repo/.git/packed-refs"]
            .into_iter()
            .collect();
    let exists = |p: &str| present.contains(p);

    let paths = git_rerun_paths(resolve, exists);

    assert_eq!(
        paths,
        vec![
            "/wt/.git/worktrees/x/HEAD".to_string(),
            "/repo/.git/packed-refs".to_string(),
        ]
    );
}

#[test]
fn no_git_yields_no_directives() {
    // Resolver returns None for everything (git unavailable / packaged source
    // tarball) — no directives, no panic.
    let paths = git_rerun_paths(|_| None, |_| true);
    assert!(paths.is_empty());
}

#[test]
fn worktree_aware_resolution_against_real_git() {
    // The test binary runs inside the repo, so git is available. HEAD must
    // resolve to an existing file. In a linked worktree this lives under the
    // per-worktree git dir, not the common dir — `--git-path HEAD` handles
    // that for us.
    let head = resolve_git_path("HEAD").expect("HEAD should resolve");
    assert!(Path::new(&head).exists(), "resolved HEAD must exist: {head}");
    assert!(head.ends_with("HEAD"), "unexpected HEAD path: {head}");

    let paths = git_rerun_paths(resolve_git_path, |p| Path::new(p).exists());
    assert!(
        paths.iter().any(|p| p.ends_with("HEAD")),
        "expected HEAD among rerun paths: {paths:?}"
    );
}
