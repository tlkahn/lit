use std::fs;
use std::path::{Path, PathBuf};

/// Subdirectory under the workspace root where imported PDFs are stored.
pub const PDF_ASSET_DIR: &str = "assets/pdf";

/// Result of ensuring a PDF lives inside the workspace.
#[derive(Debug, Clone, PartialEq)]
pub struct AttachResult {
    /// Workspace-relative path with forward slashes (e.g. "assets/pdf/paper.pdf").
    pub relative_path: String,
    /// If a copy was made, the absolute path of the new file. `None` when the
    /// PDF was already inside the workspace.
    pub copied_to: Option<PathBuf>,
}

/// Pick a collision-safe path inside `<workspace_root>/assets/pdf/` for the
/// given `desired_filename`. Creates the directory if it does not exist.
/// Returns the absolute path of a not-yet-existing file.
pub fn generate_pdf_path(workspace_root: &Path, desired_filename: &str) -> Result<PathBuf, String> {
    let dest_dir = workspace_root.join(PDF_ASSET_DIR);
    fs::create_dir_all(&dest_dir)
        .map_err(|e| format!("failed to create {PDF_ASSET_DIR}: {e}"))?;

    let p = Path::new(desired_filename);
    let stem = p
        .file_stem()
        .ok_or_else(|| "desired filename has no file stem".to_string())?
        .to_string_lossy();
    let ext = p.extension().map(|e| e.to_string_lossy().into_owned());

    let make_name = |suffix: &str| match &ext {
        Some(e) => format!("{stem}{suffix}.{e}"),
        None => format!("{stem}{suffix}"),
    };

    let first = make_name("");
    if !dest_dir.join(&first).exists() {
        return Ok(dest_dir.join(first));
    }

    for i in 1..=1000 {
        let candidate = make_name(&format!("-{i}"));
        if !dest_dir.join(&candidate).exists() {
            return Ok(dest_dir.join(candidate));
        }
    }

    Err(format!("too many collisions for {stem} in {PDF_ASSET_DIR}"))
}

/// Validate that the first 4 bytes of a readable source are `%PDF`.
/// Returns `Ok(())` on success, or an error string on failure.
pub fn validate_pdf_magic<R: std::io::Read>(reader: &mut R) -> Result<(), String> {
    let mut magic = [0u8; 4];
    match reader.read_exact(&mut magic) {
        Ok(()) => {}
        Err(e) if e.kind() == std::io::ErrorKind::UnexpectedEof => {
            return Err("file is not a valid PDF (missing %PDF magic bytes)".to_string());
        }
        Err(e) => return Err(format!("I/O error reading magic bytes: {e}")),
    }
    if &magic != b"%PDF" {
        return Err("file is not a valid PDF (missing %PDF magic bytes)".to_string());
    }
    Ok(())
}

/// Ensure that the PDF at `pdf_path` lives inside `workspace_root`.
///
/// - If the PDF is already under the workspace root, returns its
///   workspace-relative path (forward slashes) with `copied_to = None`.
/// - Otherwise, copies it into `<workspace_root>/assets/pdf/` with
///   collision-safe naming (`name.pdf`, `name-1.pdf`, `name-2.pdf`, ...)
///   and returns the workspace-relative path of the copy with `copied_to`
///   set to the absolute path of the new file.
///
/// Both paths are canonicalized before comparison so that symlinks and
/// `..` segments are resolved.
pub fn ensure_pdf_in_workspace(
    pdf_path: &Path,
    workspace_root: &Path,
) -> Result<AttachResult, String> {
    let canonical_pdf = fs::canonicalize(pdf_path)
        .map_err(|e| format!("failed to canonicalize pdf_path: {e}"))?;
    let canonical_root = fs::canonicalize(workspace_root)
        .map_err(|e| format!("failed to canonicalize workspace_root: {e}"))?;

    if let Some(rel_str) = crate::util::relative_to_root(&canonical_root, &canonical_pdf) {
        return Ok(AttachResult {
            relative_path: rel_str,
            copied_to: None,
        });
    }

    let filename = pdf_path
        .file_name()
        .ok_or_else(|| "PDF path has no file name".to_string())?
        .to_string_lossy();

    let dest_path = generate_pdf_path(workspace_root, &filename)?;
    fs::copy(pdf_path, &dest_path)
        .map_err(|e| format!("failed to copy PDF: {e}"))?;

    let chosen_filename = dest_path.file_name().unwrap().to_string_lossy();
    let relative = Path::new(PDF_ASSET_DIR).join(chosen_filename.as_ref());
    Ok(AttachResult {
        relative_path: relative
            .to_string_lossy()
            .replace(std::path::MAIN_SEPARATOR, "/"),
        copied_to: Some(dest_path),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    #[test]
    fn test_pdf_already_in_workspace_returns_relative_path() {
        let workspace = TempDir::new().unwrap();
        let pdf_dir = workspace.path().join("assets/pdf");
        fs::create_dir_all(&pdf_dir).unwrap();
        let pdf_path = pdf_dir.join("paper.pdf");
        fs::write(&pdf_path, b"dummy pdf content").unwrap();

        let result = ensure_pdf_in_workspace(&pdf_path, workspace.path()).unwrap();
        assert_eq!(result.relative_path, "assets/pdf/paper.pdf");
        assert!(result.copied_to.is_none(), "PDF already in workspace should not have copied_to");
    }

    #[test]
    fn test_pdf_in_workspace_subdirectory() {
        let workspace = TempDir::new().unwrap();
        let nested_dir = workspace.path().join("some/nested/dir");
        fs::create_dir_all(&nested_dir).unwrap();
        let pdf_path = nested_dir.join("file.pdf");
        fs::write(&pdf_path, b"dummy pdf content").unwrap();

        let result = ensure_pdf_in_workspace(&pdf_path, workspace.path()).unwrap();
        assert_eq!(result.relative_path, "some/nested/dir/file.pdf");
        assert!(result.copied_to.is_none(), "PDF already in workspace should not have copied_to");
    }

    #[test]
    fn test_pdf_outside_workspace_is_copied() {
        let workspace = TempDir::new().unwrap();
        let external = TempDir::new().unwrap();
        let external_pdf = external.path().join("paper.pdf");
        fs::write(&external_pdf, b"dummy pdf content").unwrap();

        let result = ensure_pdf_in_workspace(&external_pdf, workspace.path()).unwrap();
        assert_eq!(result.relative_path, "assets/pdf/paper.pdf");

        let expected_dest = workspace.path().join("assets/pdf/paper.pdf");
        assert_eq!(
            result.copied_to.as_ref().map(|p| fs::canonicalize(p).unwrap()),
            Some(fs::canonicalize(&expected_dest).unwrap()),
            "copied_to should point to the destination"
        );

        // Verify the file was actually copied
        assert!(expected_dest.exists());
        assert_eq!(fs::read(&expected_dest).unwrap(), b"dummy pdf content");
    }

    #[test]
    fn test_collision_safe_naming() {
        let workspace = TempDir::new().unwrap();
        let pdf_dir = workspace.path().join("assets/pdf");
        fs::create_dir_all(&pdf_dir).unwrap();
        fs::write(pdf_dir.join("paper.pdf"), b"original").unwrap();

        let external = TempDir::new().unwrap();
        let external_pdf = external.path().join("paper.pdf");
        fs::write(&external_pdf, b"new").unwrap();

        let result = ensure_pdf_in_workspace(&external_pdf, workspace.path()).unwrap();
        assert_eq!(result.relative_path, "assets/pdf/paper-1.pdf");

        let expected_dest = workspace.path().join("assets/pdf/paper-1.pdf");
        assert_eq!(
            result.copied_to.as_ref().map(|p| fs::canonicalize(p).unwrap()),
            Some(fs::canonicalize(&expected_dest).unwrap()),
            "copied_to should point to the collision-safe destination"
        );

        // Original untouched
        assert_eq!(fs::read(pdf_dir.join("paper.pdf")).unwrap(), b"original");
        // New file created
        assert_eq!(fs::read(pdf_dir.join("paper-1.pdf")).unwrap(), b"new");
    }

    #[test]
    fn test_multiple_collisions() {
        let workspace = TempDir::new().unwrap();
        let pdf_dir = workspace.path().join("assets/pdf");
        fs::create_dir_all(&pdf_dir).unwrap();
        fs::write(pdf_dir.join("paper.pdf"), b"v0").unwrap();
        fs::write(pdf_dir.join("paper-1.pdf"), b"v1").unwrap();

        let external = TempDir::new().unwrap();
        let external_pdf = external.path().join("paper.pdf");
        fs::write(&external_pdf, b"v2").unwrap();

        let result = ensure_pdf_in_workspace(&external_pdf, workspace.path()).unwrap();
        assert_eq!(result.relative_path, "assets/pdf/paper-2.pdf");

        let expected_dest = workspace.path().join("assets/pdf/paper-2.pdf");
        assert_eq!(
            result.copied_to.as_ref().map(|p| fs::canonicalize(p).unwrap()),
            Some(fs::canonicalize(&expected_dest).unwrap()),
            "copied_to should point to paper-2.pdf"
        );
        assert!(expected_dest.exists());
    }

    #[test]
    fn test_returned_path_uses_forward_slashes() {
        let workspace = TempDir::new().unwrap();
        let external = TempDir::new().unwrap();
        let external_pdf = external.path().join("test.pdf");
        fs::write(&external_pdf, b"data").unwrap();

        let result = ensure_pdf_in_workspace(&external_pdf, workspace.path()).unwrap();
        assert!(!result.relative_path.contains('\\'), "path should not contain backslashes: {}", result.relative_path);
        assert!(result.relative_path.contains("assets/pdf/"), "path should contain assets/pdf/ with forward slash: {}", result.relative_path);
    }

    #[test]
    fn test_nonexistent_pdf_returns_error() {
        let workspace = TempDir::new().unwrap();
        let fake_pdf = workspace.path().join("nonexistent.pdf");

        let result = ensure_pdf_in_workspace(&fake_pdf, workspace.path());
        assert!(result.is_err(), "should return error for nonexistent PDF");
    }

    #[test]
    fn test_nonexistent_workspace_returns_error() {
        let external = TempDir::new().unwrap();
        let external_pdf = external.path().join("paper.pdf");
        fs::write(&external_pdf, b"data").unwrap();

        let fake_workspace = Path::new("/tmp/nonexistent_workspace_xyz_12345");
        let result = ensure_pdf_in_workspace(&external_pdf, fake_workspace);
        assert!(result.is_err(), "should return error for nonexistent workspace");
    }

    #[test]
    fn test_generate_pdf_path_creates_dir() {
        let workspace = TempDir::new().unwrap();
        let result = generate_pdf_path(workspace.path(), "smith2024.pdf").unwrap();
        assert!(workspace.path().join(PDF_ASSET_DIR).is_dir());
        assert_eq!(result, workspace.path().join("assets/pdf/smith2024.pdf"));
    }

    #[test]
    fn test_generate_pdf_path_collision_safe() {
        let workspace = TempDir::new().unwrap();
        let pdf_dir = workspace.path().join(PDF_ASSET_DIR);
        fs::create_dir_all(&pdf_dir).unwrap();
        fs::write(pdf_dir.join("smith2024.pdf"), b"v0").unwrap();
        fs::write(pdf_dir.join("smith2024-1.pdf"), b"v1").unwrap();

        let result = generate_pdf_path(workspace.path(), "smith2024.pdf").unwrap();
        assert_eq!(result, workspace.path().join("assets/pdf/smith2024-2.pdf"));
    }

    #[test]
    fn test_generate_pdf_path_no_extension() {
        let workspace = TempDir::new().unwrap();
        let result = generate_pdf_path(workspace.path(), "readme").unwrap();
        assert_eq!(result, workspace.path().join("assets/pdf/readme"));
    }
}
