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
