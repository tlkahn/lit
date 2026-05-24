use std::fs;
use std::path::Path;

/// Mirror of `build.rs::ensure_placeholders_in` — kept in sync manually
/// because build scripts are a separate compilation unit.
fn ensure_placeholders_in(base: &Path, triple: &str) {
    let placeholders = [
        base.join("binaries").join(format!("lit-cli-{triple}")),
        base.join("libs").join("libpdfium.dylib"),
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
}
