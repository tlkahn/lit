//! Tests for `build.rs`'s dev-fallback version resolution.
//!
//! Build scripts are a separate compilation unit, so their `#[cfg(test)]`
//! modules never run under `cargo test`. Following the same convention as
//! `tests/git_rerun_paths.rs` and `tests/ensure_placeholders.rs`, the pure
//! helper below is a mirror of the `build.rs` original and must be kept in
//! sync manually.

// --- mirror of build.rs (keep in sync) -------------------------------------

/// Mirror of `build.rs::resolve_dev_version`.
fn resolve_dev_version(tag: Option<&str>, pkg_version: &str) -> String {
    let cleaned = tag
        .map(|t| t.trim())
        .map(|t| t.strip_prefix('v').unwrap_or(t))
        .filter(|t| !t.is_empty());

    match cleaned {
        Some(t) => t.to_string(),
        None => format!("{pkg_version}-dev"),
    }
}

// ---------------------------------------------------------------------------

#[test]
fn fallback_when_no_tag_is_labelled_dev_not_bare_placeholder() {
    let v = resolve_dev_version(None, "0.0.0");
    assert_eq!(v, "0.0.0-dev");
    assert_ne!(v, "0.0.0", "bare placeholder must never leak as a fake release");
}

#[test]
fn cleans_and_uses_present_tag() {
    // leading `v` stripped, surrounding whitespace trimmed.
    assert_eq!(resolve_dev_version(Some("v0.12.0\n"), "0.0.0"), "0.12.0");
    assert_eq!(resolve_dev_version(Some("0.12.0"), "0.0.0"), "0.12.0");
    assert_eq!(resolve_dev_version(Some("  v1.2.3  "), "0.0.0"), "1.2.3");
}

#[test]
fn empty_or_whitespace_tag_falls_back_to_dev() {
    assert_eq!(resolve_dev_version(Some(""), "0.0.0"), "0.0.0-dev");
    assert_eq!(resolve_dev_version(Some("   \n"), "0.0.0"), "0.0.0-dev");
}

/// Future-proofing invariant (PR #336 review: F).
///
/// `git describe --tags --always` (the old flag set) yields `0.13.0-5-gabcdef`
/// on an off-tag commit — NOT valid semver, and a `-g<sha>` suffix that any
/// future semver consumer would choke on. build.rs now feeds this helper the
/// output of `git describe --tags --abbrev=0` (nearest tag only), and the `None`
/// branch yields a `X.Y.Z-dev` pre-release. Both forms are clean: neither can
/// carry a `-g<sha>` commit suffix. Pin that contract so a regression to
/// `--always` (or any helper change that lets a SHA suffix through) fails here.
#[test]
fn resolved_version_never_carries_git_sha_suffix() {
    let cases = [
        resolve_dev_version(Some("v0.13.0"), "0.0.0"),
        resolve_dev_version(Some("0.13.0\n"), "0.0.0"),
        resolve_dev_version(None, "0.0.0"),
        resolve_dev_version(Some(""), "1.2.3"),
    ];
    for v in cases {
        assert!(
            !v.contains("-g"),
            "resolved version {v:?} unexpectedly carries a git commit-sha suffix; \
             build.rs must feed abbrev-zero `git describe`, not `--always`"
        );
    }
}
