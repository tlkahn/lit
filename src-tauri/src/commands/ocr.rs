use std::path::PathBuf;
use std::sync::{Arc, LazyLock};

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
fn updated_companion_search_paths(raw_paths: &[String]) -> Option<Vec<String>> {
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

/// Compute the workspace-relative path for the OCR markdown output.
fn ocr_markdown_path(root: &std::path::Path, key: &str) -> PathBuf {
    root.join(format!("{key}.md"))
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

/// Validate that `key` is safe to use as a path component (no slashes,
/// no leading dots, no OS-forbidden chars).
fn validate_key(key: &str) -> Result<(), String> {
    crate::workspace::normalize::validate_page_name(key)
        .map_err(|e| format!("Invalid citation key: {e}"))
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
fn ensure_companion_search_path(app_handle: &tauri::AppHandle) -> Result<(), String> {
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
        .map(|e| e.default_base_url.strip_suffix("/v1").unwrap_or(e.default_base_url).to_string())
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
    let stem = ocr_image_stem(&key);
    let md_relative = format!("{key}.md");
    let md_path = ocr_markdown_path(&root, &key);
    let pages = ocr_response.pages;
    tokio::task::spawn_blocking(move || -> Result<(), String> {
        let output = ocr_cli::postproc::postprocess(&pages, &image_dir, &stem)
            .map_err(|e| format!("Post-processing failed: {e}"))?;
        write_ocr_markdown(&md_path, output.markdown.as_bytes(), overwrite)?;
        Ok(())
    })
    .await
    .map_err(|e| format!("Post-process task failed: {e}"))??;

    // Step 8b: Ensure companion search path includes assets/pdf
    if let Err(e) = ensure_companion_search_path(&app_handle) {
        eprintln!("[ocr] failed to update companion search paths: {e}");
    }

    // Step 9: Done
    emit_progress(&window, &key, "done", "OCR complete");
    Ok(md_relative)
}

#[tauri::command]
pub async fn check_ocr_target_exists(
    key: String,
    workspace_path: String,
) -> Result<bool, String> {
    validate_key(&key)?;
    let path = PathBuf::from(&workspace_path).join(format!("{key}.md"));
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
        let stripped = entry.default_base_url.strip_suffix("/v1").unwrap_or(entry.default_base_url);
        assert_eq!(stripped, "https://api.mistral.ai");
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
}
