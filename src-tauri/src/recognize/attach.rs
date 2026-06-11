use std::fs;
use std::path::Path;

/// Subdirectory under the workspace root where imported PDFs are stored.
pub const PDF_ASSET_DIR: &str = "assets/pdf";

/// Ensure that the PDF at `pdf_path` lives inside `workspace_root`.
///
/// - If the PDF is already under the workspace root, returns its
///   workspace-relative path (forward slashes).
/// - Otherwise, copies it into `<workspace_root>/assets/pdf/` with
///   collision-safe naming (`name.pdf`, `name-1.pdf`, `name-2.pdf`, ...)
///   and returns the workspace-relative path of the copy.
///
/// Both paths are canonicalized before comparison so that symlinks and
/// `..` segments are resolved.
pub fn ensure_pdf_in_workspace(
    pdf_path: &Path,
    workspace_root: &Path,
) -> Result<String, String> {
    let canonical_pdf = fs::canonicalize(pdf_path)
        .map_err(|e| format!("failed to canonicalize pdf_path: {e}"))?;
    let canonical_root = fs::canonicalize(workspace_root)
        .map_err(|e| format!("failed to canonicalize workspace_root: {e}"))?;

    // If PDF is already inside the workspace, return its relative path.
    if let Ok(relative) = canonical_pdf.strip_prefix(&canonical_root) {
        return Ok(relative
            .to_string_lossy()
            .replace(std::path::MAIN_SEPARATOR, "/"));
    }

    // PDF is outside workspace — copy into assets/pdf/.
    let dest_dir = workspace_root.join(PDF_ASSET_DIR);
    fs::create_dir_all(&dest_dir)
        .map_err(|e| format!("failed to create {PDF_ASSET_DIR}: {e}"))?;

    let stem = pdf_path
        .file_stem()
        .ok_or_else(|| "PDF path has no file name".to_string())?
        .to_string_lossy();
    let ext = pdf_path
        .extension()
        .map(|e| e.to_string_lossy().into_owned());

    // Build collision-safe filename.
    let chosen_filename = {
        let make_name = |suffix: &str| match &ext {
            Some(e) => format!("{stem}{suffix}.{e}"),
            None => format!("{stem}{suffix}"),
        };

        let first = make_name("");
        if !dest_dir.join(&first).exists() {
            first
        } else {
            let mut found = None;
            for i in 1..=1000 {
                let candidate = make_name(&format!("-{i}"));
                if !dest_dir.join(&candidate).exists() {
                    found = Some(candidate);
                    break;
                }
            }
            found.ok_or_else(|| {
                format!("too many collisions for {stem} in {PDF_ASSET_DIR}")
            })?
        }
    };

    let dest_path = dest_dir.join(&chosen_filename);
    fs::copy(pdf_path, &dest_path)
        .map_err(|e| format!("failed to copy PDF: {e}"))?;

    let relative = Path::new(PDF_ASSET_DIR).join(&chosen_filename);
    Ok(relative
        .to_string_lossy()
        .replace(std::path::MAIN_SEPARATOR, "/"))
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

        let result = ensure_pdf_in_workspace(&pdf_path, workspace.path());
        assert_eq!(result, Ok("assets/pdf/paper.pdf".to_string()));
    }

    #[test]
    fn test_pdf_in_workspace_subdirectory() {
        let workspace = TempDir::new().unwrap();
        let nested_dir = workspace.path().join("some/nested/dir");
        fs::create_dir_all(&nested_dir).unwrap();
        let pdf_path = nested_dir.join("file.pdf");
        fs::write(&pdf_path, b"dummy pdf content").unwrap();

        let result = ensure_pdf_in_workspace(&pdf_path, workspace.path());
        assert_eq!(result, Ok("some/nested/dir/file.pdf".to_string()));
    }

    #[test]
    fn test_pdf_outside_workspace_is_copied() {
        let workspace = TempDir::new().unwrap();
        let external = TempDir::new().unwrap();
        let external_pdf = external.path().join("paper.pdf");
        fs::write(&external_pdf, b"dummy pdf content").unwrap();

        let result = ensure_pdf_in_workspace(&external_pdf, workspace.path());
        assert_eq!(result, Ok("assets/pdf/paper.pdf".to_string()));

        // Verify the file was actually copied
        let copied = workspace.path().join("assets/pdf/paper.pdf");
        assert!(copied.exists());
        assert_eq!(fs::read(&copied).unwrap(), b"dummy pdf content");
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

        let result = ensure_pdf_in_workspace(&external_pdf, workspace.path());
        assert_eq!(result, Ok("assets/pdf/paper-1.pdf".to_string()));

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

        let result = ensure_pdf_in_workspace(&external_pdf, workspace.path());
        assert_eq!(result, Ok("assets/pdf/paper-2.pdf".to_string()));
        assert!(workspace.path().join("assets/pdf/paper-2.pdf").exists());
    }

    #[test]
    fn test_returned_path_uses_forward_slashes() {
        let workspace = TempDir::new().unwrap();
        let external = TempDir::new().unwrap();
        let external_pdf = external.path().join("test.pdf");
        fs::write(&external_pdf, b"data").unwrap();

        let result = ensure_pdf_in_workspace(&external_pdf, workspace.path()).unwrap();
        assert!(!result.contains('\\'), "path should not contain backslashes: {result}");
        assert!(result.contains("assets/pdf/"), "path should contain assets/pdf/ with forward slash: {result}");
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
}
