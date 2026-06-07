//! Integration tests for the escape-ampersand.lua pandoc filter.
//!
//! Each test exercises a specific bug that the filter must handle correctly.
//! They shell out to pandoc with the real filter, so they require pandoc on PATH.

use std::process::{Command, Stdio};

fn filter_path() -> std::path::PathBuf {
    std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("resources/academic/escape-ampersand.lua")
}

fn run_filter(markdown: &str) -> String {
    let filter = filter_path();
    assert!(filter.exists(), "filter not found at {}", filter.display());

    let mut child = Command::new("pandoc")
        .args([
            "-f",
            "markdown",
            "-t",
            "latex",
            &format!("--lua-filter={}", filter.display()),
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("pandoc must be installed");

    use std::io::Write;
    child
        .stdin
        .take()
        .unwrap()
        .write_all(markdown.as_bytes())
        .unwrap();

    let output = child.wait_with_output().unwrap();
    assert!(
        output.status.success(),
        "pandoc failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8(output.stdout)
        .unwrap()
        .trim()
        .to_string()
}

// ---------------------------------------------------------------------------
// Bug 1: starred-environment detection broken
//
// `s:find('\\begin{' .. env .. '*}')` used `*` as a Lua pattern quantifier
// instead of a literal star. Starred environments like `align*` silently
// failed to match, so their alignment `&` got incorrectly escaped.
// ---------------------------------------------------------------------------

#[test]
fn starred_align_env_preserves_ampersand() {
    let out = run_filter(r"$\begin{align*} a & b \end{align*}$");
    assert!(
        !out.contains(r"\&"),
        "align* ampersand was escaped — starred env not detected: {out}"
    );
    assert!(
        out.contains(" a & b "),
        "align* ampersand missing from output: {out}"
    );
}

#[test]
fn non_starred_align_env_also_preserves_ampersand() {
    let out = run_filter(r"$\begin{align} a & b \end{align}$");
    assert!(
        !out.contains(r"\&"),
        "align ampersand was escaped: {out}"
    );
}

#[test]
fn starred_gather_env_preserves_ampersand() {
    let out = run_filter(r"$\begin{gather*} a & b \end{gather*}$");
    assert!(
        !out.contains(r"\&"),
        "gather* ampersand was escaped — starred env not detected: {out}"
    );
}

// ---------------------------------------------------------------------------
// Bug 2: RawInline missing has_align_env guard
//
// The Math handler checked has_align_env before escaping, but RawInline
// escaped unconditionally. A raw inline with a matrix environment would
// get its column-separator `&` broken.
// ---------------------------------------------------------------------------

#[test]
fn raw_inline_with_matrix_preserves_ampersand() {
    let out = run_filter(r"`\begin{pmatrix} a & b \end{pmatrix}`{=latex}");
    assert!(
        !out.contains(r"\&"),
        "RawInline matrix ampersand was escaped: {out}"
    );
    assert!(
        out.contains(" a & b "),
        "RawInline matrix ampersand missing: {out}"
    );
}

#[test]
fn raw_inline_without_align_env_escapes_ampersand() {
    let out = run_filter(r"`X & Y`{=latex}");
    assert!(
        out.contains(r"X \& Y"),
        "RawInline bare ampersand was NOT escaped: {out}"
    );
}

// ---------------------------------------------------------------------------
// Bug 3: RawBlock nodes not handled
//
// Fenced raw LaTeX blocks produce RawBlock nodes, which the filter ignored.
// Bare `&` in those blocks would crash LaTeX.
// ---------------------------------------------------------------------------

#[test]
fn raw_block_escapes_bare_ampersand() {
    let input = "```{=latex}\nX & Y\n```\n";
    let out = run_filter(input);
    assert!(
        out.contains(r"X \& Y"),
        "RawBlock bare ampersand was NOT escaped: {out}"
    );
}

#[test]
fn raw_block_with_tabular_preserves_ampersand() {
    let input = "```{=latex}\n\\begin{tabular}{ll} a & b \\end{tabular}\n```\n";
    let out = run_filter(input);
    assert!(
        !out.contains(r"\&"),
        "RawBlock tabular ampersand was escaped: {out}"
    );
}

#[test]
fn raw_block_with_already_escaped_ampersand_stays_escaped() {
    let input = "```{=latex}\nA \\& B\n```\n";
    let out = run_filter(input);
    assert!(
        out.contains(r"A \& B"),
        "already-escaped ampersand was double-escaped: {out}"
    );
    assert!(
        !out.contains(r"\\&"),
        "already-escaped ampersand was double-escaped: {out}"
    );
}

// ---------------------------------------------------------------------------
// Baseline: Math node escaping (the one that already worked)
// ---------------------------------------------------------------------------

#[test]
fn math_bare_ampersand_is_escaped() {
    let out = run_filter(r"$a & b$");
    assert!(
        out.contains(r"\&"),
        "Math bare ampersand was NOT escaped: {out}"
    );
}

#[test]
fn math_already_escaped_ampersand_stays_single() {
    let out = run_filter(r"$a \& b$");
    assert!(
        out.contains(r"\&"),
        "escaped ampersand missing: {out}"
    );
    assert!(
        !out.contains(r"\\&"),
        "already-escaped ampersand was double-escaped: {out}"
    );
}
