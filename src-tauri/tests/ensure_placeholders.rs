use std::fs;
use std::path::Path;

/// Mirror of `build.rs::ensure_placeholders_in` — kept in sync manually
/// because build scripts are a separate compilation unit.
fn ensure_placeholders_in(base: &Path, triple: &str) {
    let academic = base.join("resources").join("academic");
    let csl_dir = academic.join("csl");

    let placeholders = [
        base.join("binaries").join(format!("lit-cli-{triple}")),
        base.join("libs").join("libpdfium.dylib"),
        academic.join("lit-reference.docx"),
        academic.join("lit-article.tex"),
        csl_dir.join("apa.csl"),
        csl_dir.join("chicago-author-date.csl"),
        csl_dir.join("ieee.csl"),
        csl_dir.join("vancouver.csl"),
        csl_dir.join("mla.csl"),
        csl_dir.join("acm-sig-proceedings.csl"),
        csl_dir.join("nature.csl"),
        csl_dir.join("harvard-cite-them-right.csl"),
        csl_dir.join("american-medical-association.csl"),
        csl_dir.join("springer-basic-author-date.csl"),
    ];

    for path in &placeholders {
        if !path.exists() {
            if let Some(parent) = path.parent() {
                let _ = fs::create_dir_all(parent);
            }
            let _ = fs::write(path, []);
        }
    }
}

#[test]
fn creates_missing_placeholders() {
    let tmp = tempfile::tempdir().unwrap();

    ensure_placeholders_in(tmp.path(), "aarch64-apple-darwin");

    assert!(tmp.path().join("binaries/lit-cli-aarch64-apple-darwin").exists());
    assert!(tmp.path().join("libs/libpdfium.dylib").exists());
    assert!(tmp.path().join("resources/academic/lit-reference.docx").exists());
    assert!(tmp.path().join("resources/academic/lit-article.tex").exists());
    assert!(tmp.path().join("resources/academic/csl/apa.csl").exists());
    assert!(tmp.path().join("resources/academic/csl/chicago-author-date.csl").exists());
    assert!(tmp.path().join("resources/academic/csl/ieee.csl").exists());
    assert!(tmp.path().join("resources/academic/csl/vancouver.csl").exists());
    assert!(tmp.path().join("resources/academic/csl/mla.csl").exists());
    assert!(tmp.path().join("resources/academic/csl/acm-sig-proceedings.csl").exists());
    assert!(tmp.path().join("resources/academic/csl/nature.csl").exists());
    assert!(tmp.path().join("resources/academic/csl/harvard-cite-them-right.csl").exists());
    assert!(tmp.path().join("resources/academic/csl/american-medical-association.csl").exists());
    assert!(tmp.path().join("resources/academic/csl/springer-basic-author-date.csl").exists());
}

#[test]
fn does_not_overwrite_existing_files() {
    let tmp = tempfile::tempdir().unwrap();

    let bin_dir = tmp.path().join("binaries");
    fs::create_dir_all(&bin_dir).unwrap();
    let existing = bin_dir.join("lit-cli-x86_64-apple-darwin");
    fs::write(&existing, b"real binary").unwrap();

    ensure_placeholders_in(tmp.path(), "x86_64-apple-darwin");

    assert_eq!(fs::read(&existing).unwrap(), b"real binary");
}

#[test]
fn works_with_different_triples() {
    let tmp = tempfile::tempdir().unwrap();

    ensure_placeholders_in(tmp.path(), "x86_64-unknown-linux-gnu");

    assert!(tmp.path().join("binaries/lit-cli-x86_64-unknown-linux-gnu").exists());
    assert!(tmp.path().join("libs/libpdfium.dylib").exists());
    assert!(tmp.path().join("resources/academic/lit-article.tex").exists());
    assert!(tmp.path().join("resources/academic/csl/apa.csl").exists());
}
