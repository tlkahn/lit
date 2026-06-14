use std::path::PathBuf;
use std::sync::{Arc, LazyLock};

use tauri::Emitter;

static OCR_CLIENT: LazyLock<reqwest::Client> = LazyLock::new(|| {
    reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(30))
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

    let raw_paths: Vec<String> = prefs
        .extra
        .get("companion.searchPath")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|x| x.as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default();

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

/// Emit a progress event to the frontend.
fn emit_progress(app: &tauri::AppHandle, key: &str, step: &str, detail: &str) {
    let _ = app.emit(
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
    credential_store: tauri::State<'_, Arc<dyn crate::commands::credential::CredentialStore>>,
    pdfium_config: tauri::State<'_, crate::pdf::PdfiumConfig>,
    graph_state: tauri::State<'_, Arc<crate::commands::graph::GraphRegistry>>,
    app_handle: tauri::AppHandle,
) -> Result<String, String> {
    let root = PathBuf::from(&workspace_path);

    // Step 1: Look up bib entry from graph index
    emit_progress(&app_handle, &key, "lookup", "Looking up bibliography entry");
    let gi = crate::commands::page::lookup_graph_index(&graph_state, &root)
        .ok_or_else(|| "Graph index not ready".to_string())?;
    let entry = {
        let store = gi.store();
        crate::bib::db::get_bib_item(&store.conn, &key)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| format!("Entry '{}' not found", key))?
    };

    // Step 2: Get PDF path from entry.file field
    emit_progress(&app_handle, &key, "resolve_pdf", "Resolving PDF path");
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
    emit_progress(&app_handle, &key, "auth", "Retrieving Mistral API key");
    let api_key =
        crate::commands::credential::get_api_key_inner(credential_store.as_ref(), "mistral")
            .map_err(|_| "Mistral API key required \u{2014} configure in Settings \u{2192} LLM".to_string())?;

    // Step 4: Read PDF bytes from disk
    emit_progress(&app_handle, &key, "read_pdf", "Reading PDF file");
    let pdf_bytes =
        std::fs::read(&pdf_path).map_err(|e| format!("Failed to read PDF: {e}"))?;

    // Step 5: Truncate if lead/trail > 0
    let ocr_bytes = if lead > 0 || trail > 0 {
        emit_progress(
            &app_handle,
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
    emit_progress(&app_handle, &key, "ocr", "Running Mistral OCR");
    // The provider registry stores "https://api.mistral.ai/v1" but
    // ocr_pdf() builds "{base_url}/v1/ocr", so strip the /v1 suffix.
    let mistral_base = crate::provider_registry::lookup("mistral")
        .map(|e| e.default_base_url.trim_end_matches("/v1").to_string())
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
        &app_handle,
        &key,
        "postprocess",
        "Post-processing OCR output",
    );
    let image_dir = ocr_image_dir(&root, &key);
    let stem = ocr_image_stem(&key);
    let output = ocr_cli::postproc::postprocess(&ocr_response.pages, &image_dir, &stem)
        .map_err(|e| format!("Post-processing failed: {e}"))?;

    // Step 8: Write markdown file
    emit_progress(&app_handle, &key, "write", "Writing markdown file");
    let md_relative = format!("{key}.md");
    let md_path = ocr_markdown_path(&root, &key);
    std::fs::write(&md_path, &output.markdown)
        .map_err(|e| format!("Failed to write markdown: {e}"))?;

    // Step 8b: Ensure companion search path includes assets/pdf
    if let Err(e) = ensure_companion_search_path(&app_handle) {
        eprintln!("[ocr] failed to update companion search paths: {e}");
    }

    // Step 9: Done
    emit_progress(&app_handle, &key, "done", "OCR complete");
    Ok(md_relative)
}

#[tauri::command]
pub async fn check_ocr_target_exists(
    key: String,
    workspace_path: String,
) -> Result<bool, String> {
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
        let stripped = entry.default_base_url.trim_end_matches("/v1");
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
        let raw_paths: Vec<String> = prefs
            .extra
            .get("companion.searchPath")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|x| x.as_str().map(String::from))
                    .collect()
            })
            .unwrap_or_default();

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
            let raw_paths: Vec<String> = prefs
                .extra
                .get("companion.searchPath")
                .and_then(|v| v.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|x| x.as_str().map(String::from))
                        .collect()
                })
                .unwrap_or_default();

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
        let raw_paths: Vec<String> = prefs
            .extra
            .get("companion.searchPath")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|x| x.as_str().map(String::from))
                    .collect()
            })
            .unwrap_or_default();

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
        let raw_paths: Vec<String> = prefs
            .extra
            .get("companion.searchPath")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|x| x.as_str().map(String::from))
                    .collect()
            })
            .unwrap_or_default();

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
}
