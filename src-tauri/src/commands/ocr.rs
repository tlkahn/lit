use std::path::PathBuf;
use std::sync::{Arc, LazyLock};

use crate::workspace::write_hash::WriteHashRegistry;

use tauri::Emitter;

static OCR_CLIENT: LazyLock<reqwest::Client> = LazyLock::new(|| {
    reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(30))
        .timeout(std::time::Duration::from_secs(600))
        .user_agent(format!(
            "lit/{} (https://github.com/tlkahn/lit)",
            env!("LIT_GIT_VERSION")
        ))
        .build()
        .expect("failed to build OCR client")
});

/// Given the current raw `companion.searchPath` entries (pre-expansion), return
/// an updated list that includes `"assets/pdf"`.  If the input is empty (the
/// implicit `["."]` default), `"."` is seeded explicitly so it is not lost when
/// the array is persisted.  Returns `None` when no update is needed (target
/// already present).
pub(crate) fn updated_companion_search_paths(raw_paths: &[String]) -> Option<Vec<String>> {
    const TARGET: &str = "assets/pdf";

    if raw_paths.iter().any(|p| p.trim() == TARGET) {
        return None; // already present
    }

    let mut updated: Vec<String> = raw_paths.to_vec();
    // Seed the implicit default so it isn't lost.
    if updated.is_empty() {
        updated.push(".".to_string());
    }
    updated.push(TARGET.to_string());
    Some(updated)
}

/// Return the bare filename for OCR markdown output: `"{key}.md"`.
fn ocr_markdown_filename(key: &str) -> String {
    format!("{key}.md")
}

/// Compute the workspace-relative path for the OCR markdown output.
fn ocr_markdown_path(root: &std::path::Path, key: &str) -> PathBuf {
    root.join(ocr_markdown_filename(key))
}

/// Compute the directory where OCR-extracted images are saved.
fn ocr_image_dir(root: &std::path::Path, key: &str) -> PathBuf {
    root.join("assets").join("images").join(key)
}

/// Compute the markdown-relative image stem used inside image references.
fn ocr_image_stem(key: &str) -> String {
    format!("assets/images/{key}")
}

/// Write OCR markdown output, respecting the overwrite flag.
///
/// When `overwrite` is false, uses `OpenOptions::create_new(true)` for atomic
/// "create only if absent" semantics — no TOCTOU race.
fn write_ocr_markdown(md_path: &std::path::Path, content: &[u8], overwrite: bool) -> Result<(), String> {
    if overwrite {
        std::fs::write(md_path, content)
            .map_err(|e| format!("Failed to write markdown: {e}"))
    } else {
        use std::io::Write;
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(md_path)
            .map_err(|e| {
                if e.kind() == std::io::ErrorKind::AlreadyExists {
                    format!(
                        "A note named '{}' already exists \u{2014} use overwrite to replace it",
                        md_path.file_name()
                            .map(|n| n.to_string_lossy().into_owned())
                            .unwrap_or_else(|| md_path.display().to_string()),
                    )
                } else {
                    format!("Failed to write markdown: {e}")
                }
            })?;
        file.write_all(content)
            .map_err(|e| format!("Failed to write markdown: {e}"))
    }
}

/// Remove an empty image directory left behind by postprocess for text-only PDFs.
///
/// `postprocess()` unconditionally creates the output directory via
/// `create_dir_all`.  When a PDF has no embedded images, that directory ends up
/// empty.  This function checks and removes it to avoid clutter.
// TODO: fix upstream in ocr-cli — postprocess() should only create_dir_all when images exist.
fn cleanup_empty_image_dir(image_dir: &std::path::Path) {
    if image_dir.is_dir() {
        if let Ok(mut entries) = std::fs::read_dir(image_dir) {
            if entries.next().is_none() {
                let _ = std::fs::remove_dir(image_dir);
            }
        }
    }
}

/// Validate that `key` is safe to use as a path component (no slashes,
/// no leading dots, no OS-forbidden chars).
fn validate_key(key: &str) -> Result<(), String> {
    crate::workspace::normalize::validate_page_name(key)
        .map_err(|e| format!("Invalid citation key: {e}"))
}

/// Validate that a relative path is safe: no `..` traversal, not absolute,
/// no null bytes, and not empty.
fn validate_relative_path(p: &str) -> Result<(), String> {
    if p.is_empty() {
        return Err("relative path must not be empty".to_string());
    }
    if p.starts_with('/') || p.starts_with('\\') {
        return Err(format!("path must be relative, got: {p}"));
    }
    if p.contains('\0') {
        return Err(format!("path contains null byte: {p}"));
    }
    for component in p.split(['/', '\\']) {
        if component == ".." {
            return Err(format!("path contains '..' traversal: {p}"));
        }
    }
    Ok(())
}

/// Map an `ocr_cli::error::Error` to a user-facing error string.
fn map_ocr_error(e: &ocr_cli::error::Error) -> String {
    match e {
        ocr_cli::error::Error::MistralApi { status, body } => match *status {
            401 => {
                "Mistral API key is invalid or expired \u{2014} check Settings \u{2192} LLM"
                    .to_string()
            }
            429 => "Mistral rate limit exceeded \u{2014} try again later".to_string(),
            _ => format!("Mistral OCR failed (HTTP {status}): {body}"),
        },
        ocr_cli::error::Error::Http(_) => format!("OCR request failed: {e}"),
        _ => format!("OCR failed: {e}"),
    }
}

/// Ensure `"assets/pdf"` is present in the user's `companion.searchPath`
/// preference.  Called after writing the OCR markdown file so the companion
/// resolver can find the PDF that lives under `assets/pdf/`.
pub(crate) fn ensure_companion_search_path(app_handle: &tauri::AppHandle) -> Result<(), String> {
    let prefs = crate::preferences::read_preferences(app_handle);

    let raw_paths = crate::preferences::raw_companion_search_paths(&prefs);

    if let Some(updated) = updated_companion_search_paths(&raw_paths) {
        crate::preferences::set_preference(
            app_handle,
            "companion.searchPath",
            serde_json::json!(updated),
        )?;
        let _ = app_handle.emit("preferences://changed", ());
    }

    Ok(())
}

/// Emit a progress event to the originating window (not all windows).
fn emit_progress(window: &tauri::Window, key: &str, step: &str, detail: &str) {
    let _ = window.emit(
        "lit:ocr-progress",
        serde_json::json!({
            "key": key,
            "step": step,
            "detail": detail,
        }),
    );
}

#[tauri::command]
pub async fn ocr_pdf_to_markdown(
    key: String,
    workspace_path: String,
    lead: usize,
    trail: usize,
    overwrite: bool,
    credential_store: tauri::State<'_, Arc<dyn crate::commands::credential::CredentialStore>>,
    pdfium_config: tauri::State<'_, crate::pdf::PdfiumConfig>,
    graph_state: tauri::State<'_, Arc<crate::commands::graph::GraphRegistry>>,
    registry: tauri::State<'_, Arc<WriteHashRegistry>>,
    file_lock: tauri::State<'_, Arc<crate::workspace::file_lock::FilePathLock>>,
    app_handle: tauri::AppHandle,
    window: tauri::Window,
) -> Result<String, String> {
    validate_key(&key)?;
    let root = PathBuf::from(&workspace_path);

    // Step 1: Look up bib entry from graph index
    emit_progress(&window, &key, "lookup", "Looking up bibliography entry");
    let gi = crate::commands::page::lookup_graph_index(&graph_state, &root)
        .ok_or_else(|| "Graph index not ready".to_string())?;
    let entry = {
        let store = gi.store();
        crate::bib::db::get_bib_item(&store.conn, &key)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| format!("Entry '{}' not found", key))?
    };

    // Step 2: Get PDF path from entry.file field
    emit_progress(&window, &key, "resolve_pdf", "Resolving PDF path");
    let relative_pdf = entry
        .file
        .as_deref()
        .filter(|f| !f.is_empty())
        .ok_or_else(|| format!("Entry '{}' has no PDF file", key))?;
    let pdf_path = root.join(relative_pdf);
    if !pdf_path.exists() {
        return Err(format!("PDF file not found for @{key}"));
    }

    // Step 3: Get Mistral API key via credential store
    emit_progress(&window, &key, "auth", "Retrieving Mistral API key");
    let api_key =
        crate::commands::credential::get_api_key_inner(credential_store.as_ref(), "mistral")
            .map_err(|_| "Mistral API key required \u{2014} configure in Settings \u{2192} LLM".to_string())?;

    // Step 4: Read PDF bytes from disk
    emit_progress(&window, &key, "read_pdf", "Reading PDF file");
    let pdf_path_clone = pdf_path.clone();
    let pdf_bytes = tokio::task::spawn_blocking(move || {
        std::fs::read(&pdf_path_clone)
    })
    .await
    .map_err(|e| format!("Read task failed: {e}"))?
    .map_err(|e| format!("Failed to read PDF: {e}"))?;

    // Step 5: Truncate if lead/trail > 0
    let ocr_bytes = if lead > 0 || trail > 0 {
        emit_progress(
            &window,
            &key,
            "truncate",
            &format!("Truncating PDF (lead={lead}, trail={trail})"),
        );
        // Pdfium is !Send -- must create and use entirely within one blocking thread.
        let lib_path = pdfium_config.lib_path().to_string();
        let bytes = pdf_bytes;
        tokio::task::spawn_blocking(move || -> Result<Vec<u8>, String> {
            let pdfium = lmpdf::Pdfium::open(&lib_path)
                .map_err(|e| format!("Failed to load pdfium: {e}"))?;
            let mut doc = pdfium
                .load_document(&bytes, None)
                .map_err(|e| format!("Failed to load PDF: {e}"))?;
            let page_count = doc.page_count();
            doc.truncate(lead, trail)
                .map_err(|_| format!("Cannot skip more pages than the document contains ({page_count} pages)"))?;
            doc.save_to_vec()
                .map_err(|e| format!("Failed to save truncated PDF: {e}"))
        })
        .await
        .map_err(|e| format!("Truncation task failed: {e}"))??
    } else {
        pdf_bytes
    };

    // Step 6: Call Mistral OCR API
    emit_progress(&window, &key, "ocr", "Running Mistral OCR");
    // The provider registry stores "https://api.mistral.ai/v1" but
    // ocr_pdf() builds "{base_url}/v1/ocr", so strip the /v1 suffix.
    let mistral_base = crate::provider_registry::lookup("mistral")
        .map(|e| {
            e.default_base_url
                .trim_end_matches('/')
                .trim_end_matches("/v1")
                .to_string()
        })
        .unwrap_or_else(|| "https://api.mistral.ai".to_string());
    let ocr_response = ocr_cli::ocr::ocr_pdf(
        &OCR_CLIENT,
        &mistral_base,
        &api_key,
        &ocr_bytes,
        true,
    )
    .await
    .map_err(|e| map_ocr_error(&e))?;

    if ocr_response.pages.is_empty() {
        return Err("OCR returned no content".to_string());
    }

    // Step 7: Post-process (save images, fix markdown refs)
    emit_progress(
        &window,
        &key,
        "postprocess",
        "Post-processing OCR output",
    );
    let image_dir = ocr_image_dir(&root, &key);
    let image_dir_cleanup = image_dir.clone();
    let stem = ocr_image_stem(&key);
    let md_relative = ocr_markdown_filename(&key);
    let md_path = ocr_markdown_path(&root, &key);
    let pages = ocr_response.pages;
    let reg = registry.inner().clone();
    let reg_for_write = reg.clone();
    tokio::task::spawn_blocking(move || -> Result<(), String> {
        let output = ocr_cli::postproc::postprocess(&pages, &image_dir, &stem)
            .map_err(|e| format!("Post-processing failed: {e}"))?;
        write_ocr_markdown(&md_path, output.markdown.as_bytes(), overwrite)?;
        reg_for_write.record(&md_path, &output.markdown);
        // Clean up empty image directory (text-only PDFs produce no images).
        // Done here in the blocking thread to avoid sync I/O on the async runtime.
        cleanup_empty_image_dir(&image_dir_cleanup);
        Ok(())
    })
    .await
    .map_err(|e| format!("Post-process task failed: {e}"))??;

    // Step 8b: Ensure companion search path includes assets/pdf.
    // Note: this does sync I/O on a small local JSON file, but app_handle is !Send
    // so it cannot be moved into spawn_blocking. Acceptable for tiny preferences I/O.
    if let Err(e) = ensure_companion_search_path(&app_handle) {
        eprintln!("[ocr] failed to update companion search paths: {e}");
    }

    // Step 8c: Persist companion frontmatter so the md↔pdf pairing survives renames.
    {
        let root_clone = root.clone();
        let md_rel = md_relative.clone();
        let pdf_rel = relative_pdf.to_string();
        let flock = file_lock.inner().clone();
        let full_path = root.join(&md_rel);
        tokio::task::spawn_blocking(move || {
            flock.with_lock(&full_path, || {
                if let Err(e) = crate::workspace::ops::persist_companion_frontmatter(
                    &root_clone, &md_rel, &pdf_rel, &reg,
                ) {
                    eprintln!("[ocr] failed to persist companion frontmatter: {e}");
                }
            });
        })
        .await
        .map_err(|e| format!("Companion frontmatter task failed: {e}"))?;
    }

    // Step 9: Done
    crate::commands::graph::notify_bib_changed(&graph_state, &root, &app_handle);
    emit_progress(&window, &key, "done", "OCR complete");
    Ok(md_relative)
}

fn is_companion_current(root: &std::path::Path, key: &str, pdf_relative: &str) -> bool {
    let md_path = ocr_markdown_path(root, key);
    let md_meta = match std::fs::metadata(&md_path) {
        Ok(m) => m,
        Err(_) => return false,
    };
    let pdf_meta = match std::fs::metadata(root.join(pdf_relative)) {
        Ok(m) => m,
        Err(_) => return false,
    };
    let md_mtime = md_meta.modified().unwrap_or(std::time::UNIX_EPOCH);
    let pdf_mtime = pdf_meta.modified().unwrap_or(std::time::UNIX_EPOCH);
    md_mtime >= pdf_mtime
}

#[tauri::command]
pub async fn is_ocr_companion_current(
    key: String,
    workspace_path: String,
    pdf_relative: String,
) -> Result<bool, String> {
    validate_key(&key)?;
    validate_relative_path(&pdf_relative)?;
    let root = PathBuf::from(&workspace_path);
    tokio::task::spawn_blocking(move || is_companion_current(&root, &key, &pdf_relative))
        .await
        .map_err(|e| format!("Join error: {e}"))
}

#[tauri::command]
pub async fn check_ocr_target_exists(
    key: String,
    workspace_path: String,
) -> Result<bool, String> {
    validate_key(&key)?;
    let path = PathBuf::from(&workspace_path).join(ocr_markdown_filename(&key));
    Ok(path.exists())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_check_ocr_target_nonexistent() {
        let dir = tempfile::TempDir::new().unwrap();
        let rt = tokio::runtime::Runtime::new().unwrap();
        let result = rt.block_on(check_ocr_target_exists(
            "nonexistent".to_string(),
            dir.path().to_string_lossy().to_string(),
        ));
        assert_eq!(result.unwrap(), false);
    }

    #[test]
    fn test_check_ocr_target_exists_when_present() {
        let dir = tempfile::TempDir::new().unwrap();
        std::fs::write(dir.path().join("my-key.md"), b"# OCR output").unwrap();
        let rt = tokio::runtime::Runtime::new().unwrap();
        let result = rt.block_on(check_ocr_target_exists(
            "my-key".to_string(),
            dir.path().to_string_lossy().to_string(),
        ));
        assert_eq!(result.unwrap(), true);
    }

    #[test]
    fn test_ocr_client_is_initialized() {
        // Verify the lazy static client can be dereferenced without panic.
        let _client: &reqwest::Client = &OCR_CLIENT;
    }

    #[test]
    fn test_mistral_base_url_stripping() {
        // Verify the provider registry URL is correctly stripped.
        let entry = crate::provider_registry::lookup("mistral")
            .expect("mistral must be in the registry");
        let stripped = entry
            .default_base_url
            .trim_end_matches('/')
            .trim_end_matches("/v1");
        assert_eq!(stripped, "https://api.mistral.ai");

        // Also verify the logic handles trailing-slash and bare variants.
        for (input, expected) in [
            ("https://api.mistral.ai/v1", "https://api.mistral.ai"),
            ("https://api.mistral.ai/v1/", "https://api.mistral.ai"),
            ("https://api.mistral.ai", "https://api.mistral.ai"),
        ] {
            let result = input.trim_end_matches('/').trim_end_matches("/v1");
            assert_eq!(result, expected, "failed for input: {input}");
        }
    }

    // --- updated_companion_search_paths tests ---

    #[test]
    fn updated_companion_search_paths_adds_to_empty() {
        let result = updated_companion_search_paths(&[]);
        assert_eq!(
            result,
            Some(vec![".".to_string(), "assets/pdf".to_string()])
        );
    }

    #[test]
    fn updated_companion_search_paths_adds_to_existing() {
        let existing = vec![".".to_string(), "custom/pdfs".to_string()];
        let result = updated_companion_search_paths(&existing);
        assert_eq!(
            result,
            Some(vec![
                ".".to_string(),
                "custom/pdfs".to_string(),
                "assets/pdf".to_string(),
            ])
        );
    }

    #[test]
    fn updated_companion_search_paths_returns_none_when_present() {
        let existing = vec![".".to_string(), "assets/pdf".to_string()];
        assert_eq!(updated_companion_search_paths(&existing), None);
    }

    #[test]
    fn updated_companion_search_paths_is_idempotent() {
        let first = updated_companion_search_paths(&[]).unwrap();
        assert_eq!(updated_companion_search_paths(&first), None);
    }

    #[test]
    fn updated_companion_search_paths_trims_whitespace_match() {
        let existing = vec![".".to_string(), " assets/pdf ".to_string()];
        assert_eq!(updated_companion_search_paths(&existing), None);
    }

    // --- Integration tests using preferences file helpers ---

    #[test]
    fn ensure_companion_search_path_adds_assets_pdf_to_empty_prefs() {
        use crate::preferences::{
            companion_search_paths, read_preferences_from_path, set_preference_at_path,
        };

        let dir = tempfile::TempDir::new().unwrap();
        let path = dir.path().join("preferences.json");
        std::fs::write(&path, "{}").unwrap();

        let prefs = read_preferences_from_path(&path);
        let raw_paths = crate::preferences::raw_companion_search_paths(&prefs);

        if let Some(updated) = updated_companion_search_paths(&raw_paths) {
            set_preference_at_path(&path, "companion.searchPath", serde_json::json!(updated))
                .unwrap();
        }

        let prefs2 = read_preferences_from_path(&path);
        let paths = companion_search_paths(&prefs2);
        assert!(paths.contains(&".".to_string()));
        assert!(paths.contains(&"assets/pdf".to_string()));
    }

    #[test]
    fn ensure_companion_search_path_is_idempotent() {
        use crate::preferences::{
            companion_search_paths, read_preferences_from_path, set_preference_at_path,
        };

        let dir = tempfile::TempDir::new().unwrap();
        let path = dir.path().join("preferences.json");
        std::fs::write(&path, "{}").unwrap();

        for _ in 0..2 {
            let prefs = read_preferences_from_path(&path);
            let raw_paths = crate::preferences::raw_companion_search_paths(&prefs);

            if let Some(updated) = updated_companion_search_paths(&raw_paths) {
                set_preference_at_path(
                    &path,
                    "companion.searchPath",
                    serde_json::json!(updated),
                )
                .unwrap();
            }
        }

        let prefs = read_preferences_from_path(&path);
        let paths = companion_search_paths(&prefs);
        assert_eq!(
            paths.iter().filter(|p| p.as_str() == "assets/pdf").count(),
            1
        );
        assert_eq!(paths.iter().filter(|p| p.as_str() == ".").count(), 1);
    }

    #[test]
    fn ensure_companion_search_path_preserves_existing_paths() {
        use crate::preferences::{
            companion_search_paths, read_preferences_from_path, set_preference_at_path,
        };

        let dir = tempfile::TempDir::new().unwrap();
        let path = dir.path().join("preferences.json");
        std::fs::write(
            &path,
            r#"{"companion.searchPath": [".", "custom/pdfs"]}"#,
        )
        .unwrap();

        let prefs = read_preferences_from_path(&path);
        let raw_paths = crate::preferences::raw_companion_search_paths(&prefs);

        if let Some(updated) = updated_companion_search_paths(&raw_paths) {
            set_preference_at_path(&path, "companion.searchPath", serde_json::json!(updated))
                .unwrap();
        }

        let prefs2 = read_preferences_from_path(&path);
        let paths = companion_search_paths(&prefs2);
        assert_eq!(
            paths,
            vec![
                ".".to_string(),
                "custom/pdfs".to_string(),
                "assets/pdf".to_string(),
            ]
        );
    }

    #[test]
    fn ensure_companion_search_path_skips_when_already_present() {
        use crate::preferences::{
            companion_search_paths, read_preferences_from_path,
        };

        let dir = tempfile::TempDir::new().unwrap();
        let path = dir.path().join("preferences.json");
        std::fs::write(
            &path,
            r#"{"companion.searchPath": [".", "assets/pdf"]}"#,
        )
        .unwrap();

        let prefs = read_preferences_from_path(&path);
        let raw_paths = crate::preferences::raw_companion_search_paths(&prefs);

        // Should detect it's already present
        assert!(updated_companion_search_paths(&raw_paths).is_none());

        let paths = companion_search_paths(&prefs);
        assert_eq!(paths, vec![".".to_string(), "assets/pdf".to_string()]);
    }

    // --- ocr_markdown_path tests ---

    #[test]
    fn ocr_markdown_path_simple_key() {
        let root = PathBuf::from("/workspace");
        assert_eq!(ocr_markdown_path(&root, "smith2024"), PathBuf::from("/workspace/smith2024.md"));
    }

    #[test]
    fn ocr_markdown_path_key_with_hyphens() {
        let root = PathBuf::from("/my/vault");
        assert_eq!(
            ocr_markdown_path(&root, "doe-jane-2023"),
            PathBuf::from("/my/vault/doe-jane-2023.md")
        );
    }

    #[test]
    fn ocr_markdown_path_root_is_dot() {
        assert_eq!(
            ocr_markdown_path(std::path::Path::new("."), "key"),
            PathBuf::from("./key.md")
        );
    }

    // --- ocr_image_dir tests ---

    #[test]
    fn ocr_image_dir_simple_key() {
        let root = PathBuf::from("/workspace");
        assert_eq!(
            ocr_image_dir(&root, "smith2024"),
            PathBuf::from("/workspace/assets/images/smith2024")
        );
    }

    #[test]
    fn ocr_image_dir_nested_root() {
        let root = PathBuf::from("/home/user/vault");
        assert_eq!(
            ocr_image_dir(&root, "abc"),
            PathBuf::from("/home/user/vault/assets/images/abc")
        );
    }

    // --- ocr_image_stem tests ---

    #[test]
    fn ocr_image_stem_simple() {
        assert_eq!(ocr_image_stem("smith2024"), "assets/images/smith2024");
    }

    #[test]
    fn ocr_image_stem_with_hyphens() {
        assert_eq!(
            ocr_image_stem("doe-jane-2023"),
            "assets/images/doe-jane-2023"
        );
    }

    // --- map_ocr_error tests ---

    #[test]
    fn map_ocr_error_mistral_401() {
        let e = ocr_cli::error::Error::MistralApi {
            status: 401,
            body: "unauthorized".into(),
        };
        let msg = map_ocr_error(&e);
        assert!(msg.contains("invalid or expired"), "got: {msg}");
        assert!(msg.contains("Settings"), "got: {msg}");
    }

    #[test]
    fn map_ocr_error_mistral_429() {
        let e = ocr_cli::error::Error::MistralApi {
            status: 429,
            body: "too many requests".into(),
        };
        let msg = map_ocr_error(&e);
        assert!(msg.contains("rate limit"), "got: {msg}");
    }

    #[test]
    fn map_ocr_error_mistral_500() {
        let e = ocr_cli::error::Error::MistralApi {
            status: 500,
            body: "internal error".into(),
        };
        let msg = map_ocr_error(&e);
        assert!(msg.contains("HTTP 500"), "got: {msg}");
        assert!(msg.contains("internal error"), "got: {msg}");
    }

    #[test]
    fn map_ocr_error_mistral_other_status() {
        let e = ocr_cli::error::Error::MistralApi {
            status: 503,
            body: "service unavailable".into(),
        };
        let msg = map_ocr_error(&e);
        assert!(msg.starts_with("Mistral OCR failed"), "got: {msg}");
        assert!(msg.contains("503"), "got: {msg}");
    }

    #[test]
    fn map_ocr_error_catchall_config() {
        let e = ocr_cli::error::Error::Config("missing key".into());
        let msg = map_ocr_error(&e);
        assert!(msg.starts_with("OCR failed:"), "got: {msg}");
        assert!(msg.contains("missing key"), "got: {msg}");
    }

    #[test]
    fn map_ocr_error_catchall_truncation() {
        let e = ocr_cli::error::Error::Truncation("too many pages".into());
        let msg = map_ocr_error(&e);
        assert!(msg.starts_with("OCR failed:"), "got: {msg}");
    }

    #[test]
    fn map_ocr_error_catchall_io() {
        let e = ocr_cli::error::Error::Io(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            "file gone",
        ));
        let msg = map_ocr_error(&e);
        assert!(msg.starts_with("OCR failed:"), "got: {msg}");
        assert!(msg.contains("file gone"), "got: {msg}");
    }

    #[test]
    fn map_ocr_error_catchall_json() {
        let json_err = serde_json::from_str::<()>("invalid json").unwrap_err();
        let e = ocr_cli::error::Error::Json(json_err);
        let msg = map_ocr_error(&e);
        assert!(msg.starts_with("OCR failed:"), "got: {msg}");
    }

    #[test]
    fn map_ocr_error_catchall_base64() {
        let e = ocr_cli::error::Error::Base64(base64::DecodeError::InvalidPadding);
        let msg = map_ocr_error(&e);
        assert!(msg.starts_with("OCR failed:"), "got: {msg}");
    }

    // --- page markers in postprocessed output (4.1.3) ---

    #[test]
    fn test_page_markers_present_in_postprocessed_output() {
        let dir = tempfile::TempDir::new().unwrap();
        let pages = vec![
            ocr_cli::ocr::OcrPage {
                index: 0,
                markdown: "First page content".to_string(),
                images: vec![],
                dimensions: None,
            },
            ocr_cli::ocr::OcrPage {
                index: 1,
                markdown: "Second page content".to_string(),
                images: vec![],
                dimensions: None,
            },
            ocr_cli::ocr::OcrPage {
                index: 2,
                markdown: "Third page content".to_string(),
                images: vec![],
                dimensions: None,
            },
        ];

        let output = ocr_cli::postproc::postprocess(&pages, dir.path(), "test_stem")
            .expect("postprocess should succeed");

        // Verify all page comments are present
        assert!(output.markdown.contains("<!-- Page 0"), "missing Page 0 marker");
        assert!(output.markdown.contains("<!-- Page 1"), "missing Page 1 marker");
        assert!(output.markdown.contains("<!-- Page 2"), "missing Page 2 marker");

        // Verify each page comment matches expected format
        let re = regex::Regex::new(r"<!-- Page \d+ - \d+ images -->").unwrap();
        let matches: Vec<_> = re.find_iter(&output.markdown).collect();
        assert_eq!(matches.len(), 3, "expected 3 page markers, got {}", matches.len());
    }

    // --- image path correctness (4.1.4) ---

    #[test]
    fn test_ocr_image_path_is_relative_to_markdown_location() {
        let root = PathBuf::from("/workspace");
        let key = "smith2024";

        // The stem used inside markdown image refs
        let stem = ocr_image_stem(key);
        // The absolute directory where images are saved
        let img_dir = ocr_image_dir(&root, key);

        // From the workspace root, joining the stem should produce the image dir
        assert_eq!(
            root.join(&stem),
            img_dir,
            "stem '{}' from root does not resolve to image dir '{}'",
            stem,
            img_dir.display()
        );
    }

    #[test]
    fn test_ocr_image_refs_use_forward_slashes() {
        let stem = ocr_image_stem("smith2024");
        assert!(
            !stem.contains('\\'),
            "image stem contains backslash: {}",
            stem
        );
        assert!(
            stem.contains('/'),
            "image stem should contain forward slash: {}",
            stem
        );
    }

    // --- validate_key tests ---

    #[test]
    fn validate_key_accepts_simple_key() {
        validate_key("smith2024").unwrap();
    }

    #[test]
    fn validate_key_accepts_hyphens_and_underscores() {
        validate_key("doe-jane_2023").unwrap();
    }

    #[test]
    fn validate_key_rejects_path_traversal() {
        let err = validate_key("../etc/passwd").unwrap_err();
        assert!(err.contains("Invalid citation key"), "got: {err}");
    }

    #[test]
    fn validate_key_rejects_forward_slash() {
        let err = validate_key("foo/bar").unwrap_err();
        assert!(err.contains("forbidden character"), "got: {err}");
    }

    #[test]
    fn validate_key_rejects_backslash() {
        let err = validate_key("foo\\bar").unwrap_err();
        assert!(err.contains("forbidden character"), "got: {err}");
    }

    #[test]
    fn validate_key_rejects_leading_dot() {
        let err = validate_key(".hidden").unwrap_err();
        assert!(err.contains("Invalid citation key"), "got: {err}");
    }

    #[test]
    fn validate_key_rejects_empty() {
        let err = validate_key("").unwrap_err();
        assert!(err.contains("Invalid citation key"), "got: {err}");
    }

    #[test]
    fn validate_key_rejects_null_byte() {
        let err = validate_key("foo\0bar").unwrap_err();
        assert!(err.contains("forbidden character"), "got: {err}");
    }

    #[test]
    fn check_ocr_target_rejects_traversal() {
        let dir = tempfile::TempDir::new().unwrap();
        let rt = tokio::runtime::Runtime::new().unwrap();
        let result = rt.block_on(check_ocr_target_exists(
            "../escape".to_string(),
            dir.path().to_string_lossy().to_string(),
        ));
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Invalid citation key"));
    }

    // --- write_ocr_markdown tests ---

    #[test]
    fn write_ocr_output_rejects_existing_when_no_overwrite() {
        let dir = tempfile::TempDir::new().unwrap();
        let md_path = dir.path().join("smith2024.md");
        std::fs::write(&md_path, "# Existing note").unwrap();

        let result = write_ocr_markdown(&md_path, b"# New content", false);

        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(err.contains("already exists"), "got: {err}");
        assert!(err.contains("smith2024.md"), "got: {err}");
        assert!(err.contains("overwrite"), "got: {err}");
        // Ensure original content is untouched
        assert_eq!(std::fs::read_to_string(&md_path).unwrap(), "# Existing note");
    }

    #[test]
    fn write_ocr_output_creates_new_when_no_overwrite() {
        let dir = tempfile::TempDir::new().unwrap();
        let md_path = dir.path().join("smith2024.md");

        write_ocr_markdown(&md_path, b"# OCR output", false).unwrap();

        assert_eq!(std::fs::read_to_string(&md_path).unwrap(), "# OCR output");
    }

    #[test]
    fn write_ocr_output_replaces_when_overwrite() {
        let dir = tempfile::TempDir::new().unwrap();
        let md_path = dir.path().join("smith2024.md");
        std::fs::write(&md_path, "# Old content").unwrap();

        write_ocr_markdown(&md_path, b"# New OCR output", true).unwrap();

        assert_eq!(std::fs::read_to_string(&md_path).unwrap(), "# New OCR output");
    }

    #[test]
    fn write_ocr_output_creates_new_when_overwrite() {
        let dir = tempfile::TempDir::new().unwrap();
        let md_path = dir.path().join("brand-new.md");

        write_ocr_markdown(&md_path, b"# Fresh content", true).unwrap();

        assert_eq!(std::fs::read_to_string(&md_path).unwrap(), "# Fresh content");
    }

    // --- 4.2.1 Text-only PDFs: empty image directory cleanup ---

    #[test]
    fn test_text_only_pdf_no_empty_image_dir() {
        let dir = tempfile::TempDir::new().unwrap();
        let root = dir.path();
        let key = "text-only-doc";

        let image_dir = ocr_image_dir(root, key);
        let stem = ocr_image_stem(key);

        // Simulate text-only PDF: all pages have zero images
        let pages = vec![
            ocr_cli::ocr::OcrPage {
                index: 0,
                markdown: "First page text".to_string(),
                images: vec![],
                dimensions: None,
            },
            ocr_cli::ocr::OcrPage {
                index: 1,
                markdown: "Second page text".to_string(),
                images: vec![],
                dimensions: None,
            },
        ];

        // postprocess creates the image_dir unconditionally
        let output = ocr_cli::postproc::postprocess(&pages, &image_dir, &stem)
            .expect("postprocess should succeed");

        assert!(output.saved_images.is_empty(), "text-only PDF should have no saved images");
        // The directory was created by postprocess
        assert!(image_dir.is_dir(), "postprocess creates the dir unconditionally");

        // Apply the cleanup logic (same as in ocr_pdf_to_markdown)
        cleanup_empty_image_dir(&image_dir);

        // After cleanup, the empty directory should be gone
        assert!(
            !image_dir.exists(),
            "empty image directory should be removed after cleanup"
        );
    }

    // --- 4.2.2 Large PDFs: page markers stress test ---

    #[test]
    fn test_page_markers_large_document() {
        let dir = tempfile::TempDir::new().unwrap();
        let page_count = 60;
        let pages: Vec<ocr_cli::ocr::OcrPage> = (0..page_count)
            .map(|i| ocr_cli::ocr::OcrPage {
                index: i,
                markdown: format!("Content for page {i}"),
                images: vec![],
                dimensions: None,
            })
            .collect();

        let output = ocr_cli::postproc::postprocess(&pages, dir.path(), "large_doc")
            .expect("postprocess should succeed for 60 pages");

        // Verify all 60 page markers are present and correctly numbered
        for i in 0..page_count {
            let marker = format!("<!-- Page {i} - 0 images -->");
            assert!(
                output.markdown.contains(&marker),
                "missing marker for page {i}"
            );
        }

        // Verify correct count of markers
        let re = regex::Regex::new(r"<!-- Page \d+ - \d+ images -->").unwrap();
        let matches: Vec<_> = re.find_iter(&output.markdown).collect();
        assert_eq!(
            matches.len(),
            page_count as usize,
            "expected {page_count} page markers, got {}",
            matches.len()
        );
    }

    // --- 4.2.3 Non-ASCII cite keys ---

    #[test]
    fn validate_key_accepts_cjk() {
        validate_key("日本語ページ").unwrap();
    }

    #[test]
    fn validate_key_accepts_umlaut() {
        validate_key("müller2024").unwrap();
    }

    #[test]
    fn validate_key_accepts_accented() {
        validate_key("café-résumé").unwrap();
    }

    #[test]
    fn ocr_markdown_path_non_ascii_key() {
        let root = PathBuf::from("/workspace");
        assert_eq!(
            ocr_markdown_path(&root, "日本語ページ"),
            PathBuf::from("/workspace/日本語ページ.md")
        );
    }

    #[test]
    fn ocr_image_dir_non_ascii_key() {
        let root = PathBuf::from("/workspace");
        assert_eq!(
            ocr_image_dir(&root, "müller2024"),
            PathBuf::from("/workspace/assets/images/müller2024")
        );
    }

    #[test]
    fn check_ocr_target_non_ascii_key_roundtrip() {
        let dir = tempfile::TempDir::new().unwrap();
        let key = "café-résumé";
        // Create the file with non-ASCII name
        std::fs::write(dir.path().join(format!("{key}.md")), b"# OCR output").unwrap();
        let rt = tokio::runtime::Runtime::new().unwrap();
        let result = rt.block_on(check_ocr_target_exists(
            key.to_string(),
            dir.path().to_string_lossy().to_string(),
        ));
        assert_eq!(result.unwrap(), true, "filesystem should handle non-ASCII key");
    }

    // --- 4.2.4 Companion search path edge cases ---

    #[test]
    fn updated_companion_search_paths_trailing_slash_is_distinct() {
        // "assets/pdf/" (with trailing slash) is NOT the same as "assets/pdf"
        let existing = vec![".".to_string(), "assets/pdf/".to_string()];
        let result = updated_companion_search_paths(&existing);
        // Should add "assets/pdf" because "assets/pdf/" != "assets/pdf"
        assert!(result.is_some(), "trailing slash should be treated as distinct");
        let updated = result.unwrap();
        assert!(updated.contains(&"assets/pdf".to_string()));
    }

    #[test]
    fn updated_companion_search_paths_case_sensitive() {
        // "Assets/PDF" is not the same as "assets/pdf" (case-sensitive matching)
        let existing = vec![".".to_string(), "Assets/PDF".to_string()];
        let result = updated_companion_search_paths(&existing);
        assert!(result.is_some(), "case-different path should be treated as distinct");
        let updated = result.unwrap();
        assert!(updated.contains(&"assets/pdf".to_string()));
    }

    // --- 4.2.5 Page marker re-indexing after trim ---

    #[test]
    fn test_page_markers_reindexed_after_trim() {
        // Simulates what happens when a 5-page PDF is truncated (lead=2, trail=1)
        // to 2 pages, then OCR returns 0-based indices for the truncated doc.
        let dir = tempfile::TempDir::new().unwrap();
        let pages = vec![
            ocr_cli::ocr::OcrPage {
                index: 0,
                markdown: "Content from original page 3".to_string(),
                images: vec![],
                dimensions: None,
            },
            ocr_cli::ocr::OcrPage {
                index: 1,
                markdown: "Content from original page 4".to_string(),
                images: vec![],
                dimensions: None,
            },
        ];

        let output = ocr_cli::postproc::postprocess(&pages, dir.path(), "trimmed")
            .expect("postprocess should succeed");

        // Markers should be 0-based (reflecting the truncated document)
        assert!(
            output.markdown.contains("<!-- Page 0"),
            "first page marker should be 0-based after trim"
        );
        assert!(
            output.markdown.contains("<!-- Page 1"),
            "second page marker should be 1"
        );
        // Should NOT contain markers for the original page numbers
        assert!(
            !output.markdown.contains("<!-- Page 2"),
            "should not contain original page indices"
        );
    }

    #[test]
    fn test_page_markers_passthrough_nonzero_indices() {
        // Documents that postprocess is a passthrough: whatever index the API
        // returns is used directly in the page comment, without re-indexing.
        let dir = tempfile::TempDir::new().unwrap();
        let pages = vec![
            ocr_cli::ocr::OcrPage {
                index: 5,
                markdown: "Page five content".to_string(),
                images: vec![],
                dimensions: None,
            },
            ocr_cli::ocr::OcrPage {
                index: 6,
                markdown: "Page six content".to_string(),
                images: vec![],
                dimensions: None,
            },
            ocr_cli::ocr::OcrPage {
                index: 7,
                markdown: "Page seven content".to_string(),
                images: vec![],
                dimensions: None,
            },
        ];

        let output = ocr_cli::postproc::postprocess(&pages, dir.path(), "passthrough")
            .expect("postprocess should succeed");

        assert!(
            output.markdown.contains("<!-- Page 5"),
            "should passthrough index 5"
        );
        assert!(
            output.markdown.contains("<!-- Page 6"),
            "should passthrough index 6"
        );
        assert!(
            output.markdown.contains("<!-- Page 7"),
            "should passthrough index 7"
        );
        // Should NOT contain 0-based indices
        assert!(
            !output.markdown.contains("<!-- Page 0"),
            "should not re-index to 0"
        );
    }

    // --- companion frontmatter after OCR ---

    #[test]
    fn ocr_output_gets_companion_frontmatter() {
        use crate::workspace::frontmatter::parse_frontmatter;
        use crate::workspace::write_hash::WriteHashRegistry;

        let dir = tempfile::TempDir::new().unwrap();
        let root = dir.path();
        let md_path = root.join("smith2024.md");
        std::fs::write(&md_path, "# OCR output\n\nSome text.\n").unwrap();

        let registry = WriteHashRegistry::new();
        crate::workspace::ops::persist_companion_frontmatter(
            root,
            "smith2024.md",
            "assets/pdf/smith2024.pdf",
            &registry,
        )
        .unwrap();

        let content = std::fs::read_to_string(&md_path).unwrap();
        let parsed = parse_frontmatter(&content);
        let companion = parsed.map.get("companion").unwrap();
        assert_eq!(
            companion.as_str().unwrap(),
            "assets/pdf/smith2024.pdf"
        );
        assert!(
            parsed.body.contains("# OCR output"),
            "body preserved after frontmatter insertion"
        );
    }

    #[test]
    fn ocr_companion_frontmatter_is_idempotent() {
        use crate::workspace::frontmatter::parse_frontmatter;
        use crate::workspace::write_hash::WriteHashRegistry;

        let dir = tempfile::TempDir::new().unwrap();
        let root = dir.path();
        let md_path = root.join("smith2024.md");
        std::fs::write(&md_path, "# OCR output\n").unwrap();

        let registry = WriteHashRegistry::new();
        for _ in 0..3 {
            crate::workspace::ops::persist_companion_frontmatter(
                root,
                "smith2024.md",
                "assets/pdf/smith2024.pdf",
                &registry,
            )
            .unwrap();
        }

        let content = std::fs::read_to_string(&md_path).unwrap();
        let parsed = parse_frontmatter(&content);
        assert_eq!(parsed.map.len(), 1, "only one frontmatter key");
        assert_eq!(
            parsed.map.get("companion").unwrap().as_str().unwrap(),
            "assets/pdf/smith2024.pdf"
        );
    }

    // --- is_companion_current tests ---

    #[test]
    fn test_companion_current_no_md() {
        let dir = tempfile::TempDir::new().unwrap();
        let root = dir.path();
        std::fs::create_dir_all(root.join("assets/pdf")).unwrap();
        std::fs::write(root.join("assets/pdf/smith.pdf"), b"fake pdf").unwrap();
        assert!(!is_companion_current(root, "smith2024", "assets/pdf/smith.pdf"));
    }

    #[test]
    fn test_companion_current_md_newer() {
        let dir = tempfile::TempDir::new().unwrap();
        let root = dir.path();
        let pdf_dir = root.join("assets/pdf");
        std::fs::create_dir_all(&pdf_dir).unwrap();
        let pdf_path = pdf_dir.join("smith.pdf");
        std::fs::write(&pdf_path, b"fake pdf").unwrap();
        let md_path = root.join("smith2024.md");
        std::fs::write(&md_path, b"# OCR output").unwrap();

        use filetime::FileTime;
        let old = FileTime::from_unix_time(1_000_000, 0);
        let new = FileTime::from_unix_time(2_000_000, 0);
        filetime::set_file_mtime(&pdf_path, old).unwrap();
        filetime::set_file_mtime(&md_path, new).unwrap();

        assert!(is_companion_current(root, "smith2024", "assets/pdf/smith.pdf"));
    }

    #[test]
    fn test_companion_current_pdf_newer() {
        let dir = tempfile::TempDir::new().unwrap();
        let root = dir.path();
        let pdf_dir = root.join("assets/pdf");
        std::fs::create_dir_all(&pdf_dir).unwrap();
        let pdf_path = pdf_dir.join("smith.pdf");
        std::fs::write(&pdf_path, b"fake pdf").unwrap();
        let md_path = root.join("smith2024.md");
        std::fs::write(&md_path, b"# OCR output").unwrap();

        use filetime::FileTime;
        let old = FileTime::from_unix_time(1_000_000, 0);
        let new = FileTime::from_unix_time(2_000_000, 0);
        filetime::set_file_mtime(&pdf_path, new).unwrap();
        filetime::set_file_mtime(&md_path, old).unwrap();

        assert!(!is_companion_current(root, "smith2024", "assets/pdf/smith.pdf"));
    }

    #[test]
    fn test_companion_current_same_mtime() {
        let dir = tempfile::TempDir::new().unwrap();
        let root = dir.path();
        let pdf_dir = root.join("assets/pdf");
        std::fs::create_dir_all(&pdf_dir).unwrap();
        let pdf_path = pdf_dir.join("smith.pdf");
        std::fs::write(&pdf_path, b"fake pdf").unwrap();
        let md_path = root.join("smith2024.md");
        std::fs::write(&md_path, b"# OCR output").unwrap();

        use filetime::FileTime;
        let same = FileTime::from_unix_time(1_000_000, 0);
        filetime::set_file_mtime(&pdf_path, same).unwrap();
        filetime::set_file_mtime(&md_path, same).unwrap();

        assert!(is_companion_current(root, "smith2024", "assets/pdf/smith.pdf"));
    }

    #[test]
    fn test_companion_current_no_file_field() {
        let dir = tempfile::TempDir::new().unwrap();
        let root = dir.path();
        // No PDF exists at this path
        assert!(!is_companion_current(root, "smith2024", "nonexistent.pdf"));
    }

    #[test]
    fn test_companion_current_rejects_traversal() {
        let dir = tempfile::TempDir::new().unwrap();
        let rt = tokio::runtime::Runtime::new().unwrap();
        let result = rt.block_on(is_ocr_companion_current(
            "../escape".to_string(),
            dir.path().to_string_lossy().to_string(),
            "assets/pdf/test.pdf".to_string(),
        ));
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Invalid citation key"));
    }

    // --- validate_relative_path tests ---

    #[test]
    fn validate_relative_path_rejects_dotdot() {
        let err = validate_relative_path("../escape").unwrap_err();
        assert!(err.contains("traversal"), "got: {err}");
    }

    #[test]
    fn validate_relative_path_rejects_nested_dotdot() {
        let err = validate_relative_path("a/../../b").unwrap_err();
        assert!(err.contains("traversal"), "got: {err}");
    }

    #[test]
    fn validate_relative_path_rejects_absolute() {
        let err = validate_relative_path("/etc/passwd").unwrap_err();
        assert!(err.contains("relative"), "got: {err}");
    }

    #[test]
    fn validate_relative_path_rejects_null_byte() {
        let err = validate_relative_path("foo\0bar.pdf").unwrap_err();
        assert!(err.contains("null"), "got: {err}");
    }

    #[test]
    fn validate_relative_path_rejects_empty() {
        let err = validate_relative_path("").unwrap_err();
        assert!(err.contains("empty"), "got: {err}");
    }

    #[test]
    fn validate_relative_path_accepts_normal() {
        validate_relative_path("assets/pdf/test.pdf").unwrap();
    }

    #[test]
    fn validate_relative_path_accepts_simple_filename() {
        validate_relative_path("test.pdf").unwrap();
    }

    #[test]
    fn validate_relative_path_accepts_dotfile() {
        validate_relative_path(".hidden/test.pdf").unwrap();
    }

    #[test]
    fn test_is_ocr_companion_current_rejects_pdf_traversal() {
        let dir = tempfile::TempDir::new().unwrap();
        let rt = tokio::runtime::Runtime::new().unwrap();
        let result = rt.block_on(is_ocr_companion_current(
            "valid-key".to_string(),
            dir.path().to_string_lossy().to_string(),
            "../../etc/passwd".to_string(),
        ));
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(err.contains("traversal"), "got: {err}");
    }

    #[test]
    fn ocr_companion_frontmatter_find_companion_roundtrip() {
        use crate::workspace::write_hash::WriteHashRegistry;

        let dir = tempfile::TempDir::new().unwrap();
        let root = dir.path();
        std::fs::write(root.join("smith2024.md"), "# OCR\n").unwrap();
        let pdf_dir = root.join("assets").join("pdf");
        std::fs::create_dir_all(&pdf_dir).unwrap();
        std::fs::write(pdf_dir.join("smith2024.pdf"), b"fake pdf").unwrap();

        let registry = WriteHashRegistry::new();
        crate::workspace::ops::persist_companion_frontmatter(
            root,
            "smith2024.md",
            "assets/pdf/smith2024.pdf",
            &registry,
        )
        .unwrap();

        let search_paths = vec![".".to_string(), "assets/pdf".to_string()];

        // md → pdf via frontmatter key
        let found = crate::commands::workspace::find_companion(
            "smith2024.md",
            root,
            &search_paths,
        );
        assert_eq!(found, Some("assets/pdf/smith2024.pdf".to_string()));

        // pdf → md via search_paths ("." finds root-level md)
        let reverse = crate::commands::workspace::find_companion(
            "assets/pdf/smith2024.pdf",
            root,
            &search_paths,
        );
        assert_eq!(reverse, Some("smith2024.md".to_string()));
    }
}
