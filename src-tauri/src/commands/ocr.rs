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

/// Derive the filename stem for OCR artifacts from a bib entry: a kebab-case
/// slug of the document title, falling back to the citation key when the title
/// is empty or yields no usable characters.
fn ocr_slug(title: &str, key: &str) -> String {
    use crate::workspace::normalize::{truncate_slug, MAX_SLUG_LEN, MIN_SLUG_LEN};
    match crate::workspace::normalize::kebab_case_title(title) {
        Some(t) => {
            let suffix_len = 1 + key.len(); // "-{key}"
            let budget = MAX_SLUG_LEN.saturating_sub(suffix_len);
            if budget >= MIN_SLUG_LEN {
                let t = truncate_slug(&t, budget);
                format!("{}-{}", t, key)
            } else {
                // Key alone exhausts the byte budget; drop the title portion
                truncate_slug(key, MAX_SLUG_LEN)
            }
        }
        None => truncate_slug(key, MAX_SLUG_LEN),
    }
}

/// Return the bare filename for OCR markdown output: `"{stem}.md"`.
fn ocr_markdown_filename(stem: &str) -> String {
    format!("{stem}.md")
}

/// Core slug resolution given a `Store` reference: returns the graph-indexed
/// companion filename (sans `.md`) when present, falling back to `ocr_slug`.
fn resolve_slug_from_store(store: &crate::graph::store::Store, key: &str, title: &str) -> String {
    if let Ok(Some(page_id)) = store.ocr_companion_for_citekey(key) {
        return page_id.strip_suffix(".md").unwrap_or(&page_id).to_string();
    }
    ocr_slug(title, key)
}

/// Resolve the OCR slug for a bib entry, preferring the graph-indexed
/// companion filename (survives title changes) and falling back to
/// `ocr_slug(title, key)` when the graph is unavailable or has no match.
fn resolve_ocr_slug(
    registry: &crate::commands::graph::GraphRegistry,
    root: &PathBuf,
    key: &str,
    title: &str,
) -> String {
    if let Some(gi) = crate::commands::page::lookup_graph_index(registry, root) {
        let store = gi.store();
        return resolve_slug_from_store(&store, key, title);
    }
    ocr_slug(title, key)
}

/// Compute the workspace-relative path for the OCR markdown output.
fn ocr_markdown_path(root: &std::path::Path, stem: &str) -> PathBuf {
    root.join(ocr_markdown_filename(stem))
}

/// Compute the directory where OCR-extracted images are saved.
fn ocr_image_dir(root: &std::path::Path, stem: &str) -> PathBuf {
    root.join("assets").join("images").join(stem)
}

/// Compute the markdown-relative image stem used inside image references.
fn ocr_image_stem(stem: &str) -> String {
    format!("assets/images/{stem}")
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

    // Name all OCR artifacts after a human-readable, title-derived slug rather
    // than the opaque bib key (falls back to the key for empty titles).
    // Graph-first: reuse the existing companion filename if one was indexed,
    // so re-OCR after a title change overwrites the original file instead of
    // creating a duplicate under the new slug.
    let slug = {
        let store = gi.store();
        resolve_slug_from_store(&store, &entry.key, &entry.title)
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
    let trimmed_pdf_relative: Option<String> = if lead > 0 || trail > 0 {
        Some(format!("assets/pdf/{slug}-trimmed.pdf"))
    } else {
        None
    };
    let ocr_bytes = if lead > 0 || trail > 0 {
        emit_progress(
            &window,
            &key,
            "truncate",
            &format!("Truncating PDF (lead={lead}, trail={trail})"),
        );
        // Pdfium is !Send -- must create and use entirely within one blocking thread.
        let trimmed_disk_path = root.join(trimmed_pdf_relative.as_deref().unwrap());
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
            let trimmed = doc.save_to_vec()
                .map_err(|e| format!("Failed to save truncated PDF: {e}"))?;
            if let Some(parent) = trimmed_disk_path.parent() {
                std::fs::create_dir_all(parent)
                    .map_err(|e| format!("Failed to create trimmed PDF directory: {e}"))?;
            }
            std::fs::write(&trimmed_disk_path, &trimmed)
                .map_err(|e| format!("Failed to write trimmed PDF: {e}"))?;
            Ok(trimmed)
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
    let image_dir = ocr_image_dir(&root, &slug);
    let image_dir_cleanup = image_dir.clone();
    let stem = ocr_image_stem(&slug);
    let md_relative = ocr_markdown_filename(&slug);
    let md_path = ocr_markdown_path(&root, &slug);
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
    // Always point `companion:` at the ORIGINAL imported PDF (the file the user
    // sees in the sidebar) — the trimmed PDF is a pure ephemeral OCR artifact.
    // `lead` is recorded as `companion_page_offset` so scroll sync can map the
    // 0-indexed OCR page markers back onto the original PDF's page numbers.
    {
        let root_clone = root.clone();
        let md_rel = md_relative.clone();
        let pdf_rel = relative_pdf.to_string();
        let page_offset = lead as i32;
        let key_for_fm = key.clone();
        let flock = file_lock.inner().clone();
        let full_path = root.join(&md_rel);
        tokio::task::spawn_blocking(move || {
            flock.with_lock(&full_path, || {
                if let Err(e) = crate::workspace::ops::persist_companion_frontmatter(
                    &root_clone, &md_rel, &pdf_rel, Some(&key_for_fm), Some(page_offset), &reg,
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

fn is_companion_current(root: &std::path::Path, slug: &str, pdf_relative: &str) -> bool {
    let md_path = ocr_markdown_path(root, slug);
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

/// Inner logic for `is_ocr_companion_current`.  Accepts the graph registry
/// as an `Option` so unit tests can pass `None` (simulating graph-not-ready).
/// Validation runs first, before any graph or filesystem access.
fn is_ocr_companion_current_inner(
    key: &str,
    title: &str,
    workspace_path: &str,
    pdf_relative: &str,
    registry: Option<&crate::commands::graph::GraphRegistry>,
) -> Result<Option<String>, String> {
    validate_key(key)?;
    validate_relative_path(pdf_relative)?;
    let root = PathBuf::from(workspace_path);
    let slug = match registry {
        Some(reg) => resolve_ocr_slug(reg, &root, key, title),
        None => ocr_slug(title, key),
    };
    let filename = ocr_markdown_filename(&slug);
    if is_companion_current(&root, &slug, pdf_relative) {
        Ok(Some(filename))
    } else {
        Ok(None)
    }
}

#[tauri::command]
pub async fn is_ocr_companion_current(
    key: String,
    title: String,
    workspace_path: String,
    pdf_relative: String,
    graph_state: tauri::State<'_, Arc<crate::commands::graph::GraphRegistry>>,
) -> Result<Option<String>, String> {
    let gs = graph_state.inner().clone();
    tokio::task::spawn_blocking(move || {
        is_ocr_companion_current_inner(&key, &title, &workspace_path, &pdf_relative, Some(&*gs))
    })
    .await
    .map_err(|e| format!("Join error: {e}"))?
}

/// Return whether the OCR target markdown file (`{slug}.md`) already exists at
/// the workspace root.
fn check_ocr_target_inner(root: &std::path::Path, slug: &str) -> bool {
    ocr_markdown_path(root, slug).exists()
}

/// Inner logic for `check_ocr_target_exists`.  Accepts the graph registry as
/// an `Option` so unit tests can pass `None` (simulating graph-not-ready).
/// Validation runs first, before any graph or filesystem access.
fn check_ocr_target_exists_inner(
    key: &str,
    title: &str,
    workspace_path: &str,
    registry: Option<&crate::commands::graph::GraphRegistry>,
) -> Result<bool, String> {
    validate_key(key)?;
    let root = PathBuf::from(workspace_path);
    let slug = match registry {
        Some(reg) => resolve_ocr_slug(reg, &root, key, title),
        None => ocr_slug(title, key),
    };
    Ok(check_ocr_target_inner(&root, &slug))
}

#[tauri::command]
pub async fn check_ocr_target_exists(
    key: String,
    title: String,
    workspace_path: String,
    graph_state: tauri::State<'_, Arc<crate::commands::graph::GraphRegistry>>,
) -> Result<bool, String> {
    let gs = graph_state.inner().clone();
    tokio::task::spawn_blocking(move || {
        check_ocr_target_exists_inner(&key, &title, &workspace_path, Some(&*gs))
    })
    .await
    .map_err(|e| format!("Join error: {e}"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ocr_slug_uses_title() {
        assert_eq!(ocr_slug("The Well-Posed Problem", "smith2024"), "the-well-posed-problem-smith2024");
    }

    #[test]
    fn ocr_slug_truncates_title_to_fit_key_within_limit() {
        let long_title = "the quick brown fox jumps over the lazy dog and then runs across the wide open green field again";
        let slug = ocr_slug(long_title, "smith2024");
        assert!(
            slug.len() <= crate::workspace::normalize::MAX_SLUG_LEN,
            "slug too long: {} bytes: {slug}",
            slug.len()
        );
        assert!(slug.ends_with("-smith2024"));
    }

    #[test]
    fn ocr_slug_falls_back_to_key_when_title_empty() {
        assert_eq!(ocr_slug("", "smith2024"), "smith2024");
    }

    #[test]
    fn test_check_ocr_target_nonexistent() {
        let dir = tempfile::TempDir::new().unwrap();
        assert_eq!(
            check_ocr_target_inner(dir.path(), "nonexistent-slug"),
            false
        );
    }

    #[test]
    fn test_check_ocr_target_exists_when_present() {
        let dir = tempfile::TempDir::new().unwrap();
        std::fs::write(dir.path().join("the-well-posed-problem.md"), b"# OCR output").unwrap();
        assert_eq!(
            check_ocr_target_inner(dir.path(), "the-well-posed-problem"),
            true
        );
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

    // --- command-level traversal rejection (via inner fns) ---
    // Retargeted from the old async #[tauri::command] fns to the sync inner fns
    // so the tests don't need tauri::State (which is only injectable by the
    // Tauri runtime).  Passing `None` for the graph registry confirms validation
    // runs before any graph/fs access.

    #[test]
    fn check_ocr_target_exists_rejects_key_traversal() {
        let err = check_ocr_target_exists_inner(
            "../etc/passwd",
            "Some Title",
            "/tmp/fake",
            None,
        )
        .unwrap_err();
        assert!(err.contains("Invalid citation key"), "got: {err}");
    }

    #[test]
    fn is_ocr_companion_current_rejects_key_traversal() {
        let err = is_ocr_companion_current_inner(
            "../etc/passwd",
            "Some Title",
            "/tmp/fake",
            "assets/pdf/test.pdf",
            None,
        )
        .unwrap_err();
        assert!(err.contains("Invalid citation key"), "got: {err}");
    }

    #[test]
    fn is_ocr_companion_current_rejects_pdf_traversal() {
        let err = is_ocr_companion_current_inner(
            "smith2024",
            "Some Title",
            "/tmp/fake",
            "../../etc/shadow",
            None,
        )
        .unwrap_err();
        assert!(err.contains("traversal"), "got: {err}");
    }

    // --- graph-not-ready graceful fallback ---
    // Prove that the inner fns return Ok (never Err) when the graph registry
    // is None, falling back to the ocr_slug(title,key) derivation.

    #[test]
    fn check_ocr_target_exists_inner_graph_not_ready_falls_back_to_slug() {
        let dir = tempfile::TempDir::new().unwrap();
        let slug = ocr_slug("Some Title", "smith2024");
        std::fs::write(dir.path().join(format!("{slug}.md")), b"# OCR").unwrap();
        let result = check_ocr_target_exists_inner(
            "smith2024",
            "Some Title",
            dir.path().to_str().unwrap(),
            None,
        );
        assert_eq!(result, Ok(true));
    }

    #[test]
    fn is_ocr_companion_current_inner_graph_not_ready_falls_back_to_slug() {
        let dir = tempfile::TempDir::new().unwrap();
        let slug = ocr_slug("Some Title", "smith2024");
        let md_path = dir.path().join(format!("{slug}.md"));
        let pdf_path = dir.path().join("assets/pdf/test.pdf");
        std::fs::create_dir_all(pdf_path.parent().unwrap()).unwrap();
        std::fs::write(&md_path, b"# OCR").unwrap();
        std::fs::write(&pdf_path, b"PDF").unwrap();
        // Set md newer than pdf so companion is "current"
        use filetime::FileTime;
        let old = FileTime::from_unix_time(1_000_000, 0);
        let new = FileTime::from_unix_time(2_000_000, 0);
        filetime::set_file_mtime(&pdf_path, old).unwrap();
        filetime::set_file_mtime(&md_path, new).unwrap();
        let result = is_ocr_companion_current_inner(
            "smith2024",
            "Some Title",
            dir.path().to_str().unwrap(),
            "assets/pdf/test.pdf",
            None,
        );
        assert!(result.unwrap().is_some());
    }

    // --- resolve_slug_from_store unit tests ---

    #[test]
    fn resolve_slug_from_store_returns_companion_sans_md() {
        use crate::graph::indexer::GraphIndex;
        use crate::graph::types::ParsedNode;

        let dir = tempfile::TempDir::new().unwrap();
        let root = dir.path().to_path_buf();

        let gi = GraphIndex::build(root.clone(), false).unwrap();
        {
            let store = gi.store();
            let node = ParsedNode {
                id: "old-title-smith2024.md".into(),
                title: "Old Title".into(),
                tags: vec![],
                frontmatter: serde_json::json!({
                    "citekey": "smith2024",
                    "companion": "assets/pdf/smith2024.pdf"
                }),
                first_paragraph: String::new(),
            };
            store.upsert_node(&node, 1).unwrap();
        }

        // With a companion in the graph, should return the page id sans .md
        let store = gi.store();
        let slug = resolve_slug_from_store(&store, "smith2024", "Completely New Title");
        assert_eq!(slug, "old-title-smith2024");
    }

    #[test]
    fn resolve_slug_from_store_falls_back_to_ocr_slug() {
        use crate::graph::indexer::GraphIndex;

        let dir = tempfile::TempDir::new().unwrap();
        let root = dir.path().to_path_buf();

        // Empty graph - no companion indexed
        let gi = GraphIndex::build(root.clone(), false).unwrap();
        let store = gi.store();
        let slug = resolve_slug_from_store(&store, "smith2024", "The Well-Posed Problem");
        assert_eq!(slug, ocr_slug("The Well-Posed Problem", "smith2024"));
    }

    // --- graph-first slug resolution survives title changes ---
    // A companion was created with the old title.  After the title changes the
    // graph still maps the citekey to the old filename.  Both inner fns should
    // find the file via the graph rather than deriving a new (wrong) slug from
    // the changed title.

    #[test]
    fn resolve_ocr_slug_prefers_graph_companion_over_title() {
        use crate::commands::graph::GraphRegistry;
        use crate::graph::indexer::GraphIndex;
        use crate::graph::types::ParsedNode;

        let dir = tempfile::TempDir::new().unwrap();
        let root = dir.path().to_path_buf();

        // Build an empty graph index (creates .lit/graph.db)
        let gi = GraphIndex::build(root.clone(), false).unwrap();
        {
            let store = gi.store();
            let node = ParsedNode {
                id: "old-title-smith2024.md".into(),
                title: "Old Title".into(),
                tags: vec![],
                frontmatter: serde_json::json!({
                    "citekey": "smith2024",
                    "companion": "assets/pdf/smith2024.pdf"
                }),
                first_paragraph: String::new(),
            };
            store.upsert_node(&node, 1).unwrap();
        }

        // Register the index in a GraphRegistry
        let registry = GraphRegistry::new();
        registry
            .indices
            .lock()
            .unwrap()
            .insert(root.clone(), Arc::new(gi));

        // resolve_ocr_slug with a DIFFERENT title should return the graph slug
        let slug = resolve_ocr_slug(&registry, &root, "smith2024", "Completely New Title");
        assert_eq!(slug, "old-title-smith2024");
    }

    #[test]
    fn check_ocr_target_exists_inner_finds_file_via_graph_after_title_change() {
        use crate::commands::graph::GraphRegistry;
        use crate::graph::indexer::GraphIndex;
        use crate::graph::types::ParsedNode;

        let dir = tempfile::TempDir::new().unwrap();
        let root = dir.path().to_path_buf();

        // Create the OCR markdown file with the OLD slug
        std::fs::write(root.join("old-title-smith2024.md"), b"# OCR output").unwrap();

        let gi = GraphIndex::build(root.clone(), false).unwrap();
        {
            let store = gi.store();
            let node = ParsedNode {
                id: "old-title-smith2024.md".into(),
                title: "Old Title".into(),
                tags: vec![],
                frontmatter: serde_json::json!({
                    "citekey": "smith2024",
                    "companion": "assets/pdf/smith2024.pdf"
                }),
                first_paragraph: String::new(),
            };
            store.upsert_node(&node, 1).unwrap();
        }

        let registry = GraphRegistry::new();
        registry
            .indices
            .lock()
            .unwrap()
            .insert(root.clone(), Arc::new(gi));

        // The CURRENT title is different, but the graph lookup finds the old file
        let result = check_ocr_target_exists_inner(
            "smith2024",
            "Completely New Title",
            root.to_str().unwrap(),
            Some(&registry),
        );
        assert_eq!(result, Ok(true));
    }

    #[test]
    fn is_ocr_companion_current_inner_finds_file_via_graph_after_title_change() {
        use crate::commands::graph::GraphRegistry;
        use crate::graph::indexer::GraphIndex;
        use crate::graph::types::ParsedNode;

        let dir = tempfile::TempDir::new().unwrap();
        let root = dir.path().to_path_buf();

        // Create OCR markdown + PDF with old slug
        std::fs::write(root.join("old-title-smith2024.md"), b"# OCR output").unwrap();
        let pdf_dir = root.join("assets/pdf");
        std::fs::create_dir_all(&pdf_dir).unwrap();
        std::fs::write(pdf_dir.join("smith2024.pdf"), b"PDF").unwrap();

        use filetime::FileTime;
        let old = FileTime::from_unix_time(1_000_000, 0);
        let new = FileTime::from_unix_time(2_000_000, 0);
        filetime::set_file_mtime(pdf_dir.join("smith2024.pdf"), old).unwrap();
        filetime::set_file_mtime(root.join("old-title-smith2024.md"), new).unwrap();

        let gi = GraphIndex::build(root.clone(), false).unwrap();
        {
            let store = gi.store();
            let node = ParsedNode {
                id: "old-title-smith2024.md".into(),
                title: "Old Title".into(),
                tags: vec![],
                frontmatter: serde_json::json!({
                    "citekey": "smith2024",
                    "companion": "assets/pdf/smith2024.pdf"
                }),
                first_paragraph: String::new(),
            };
            store.upsert_node(&node, 1).unwrap();
        }

        let registry = GraphRegistry::new();
        registry
            .indices
            .lock()
            .unwrap()
            .insert(root.clone(), Arc::new(gi));

        let result = is_ocr_companion_current_inner(
            "smith2024",
            "Completely New Title",
            root.to_str().unwrap(),
            "assets/pdf/smith2024.pdf",
            Some(&registry),
        );
        assert_eq!(
            result.unwrap(),
            Some("old-title-smith2024.md".to_string())
        );
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
    fn check_ocr_target_non_ascii_slug_roundtrip() {
        let dir = tempfile::TempDir::new().unwrap();
        let slug = "café-résumé";
        // Create the file with a non-ASCII slug name.
        std::fs::write(dir.path().join(format!("{slug}.md")), b"# OCR output").unwrap();
        assert_eq!(
            check_ocr_target_inner(dir.path(), slug),
            true,
            "filesystem should handle non-ASCII slug"
        );
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
            None,
            None,
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
                None,
                None,
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
    fn test_companion_current_slug_named_md() {
        // The companion check builds its path from a title-derived slug, not the
        // bib key. Verify it resolves `the-well-posed-problem.md`.
        let dir = tempfile::TempDir::new().unwrap();
        let root = dir.path();
        let pdf_dir = root.join("assets/pdf");
        std::fs::create_dir_all(&pdf_dir).unwrap();
        let pdf_path = pdf_dir.join("smith.pdf");
        std::fs::write(&pdf_path, b"fake pdf").unwrap();
        let md_path = root.join("the-well-posed-problem.md");
        std::fs::write(&md_path, b"# OCR output").unwrap();

        use filetime::FileTime;
        let old = FileTime::from_unix_time(1_000_000, 0);
        let new = FileTime::from_unix_time(2_000_000, 0);
        filetime::set_file_mtime(&pdf_path, old).unwrap();
        filetime::set_file_mtime(&md_path, new).unwrap();

        assert!(is_companion_current(
            root,
            "the-well-posed-problem",
            "assets/pdf/smith.pdf"
        ));
    }

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

    // Command-level traversal rejection for `is_ocr_companion_current` and
    // `check_ocr_target_exists` is covered by the integration tests above
    // (search for "command-level traversal rejection").

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
    fn ocr_companion_frontmatter_slug_named_roundtrip() {
        // After OCR, artifacts are named from a title-derived slug. Verify the
        // companion frontmatter roundtrips for a slug-named markdown file paired
        // with the ORIGINAL (slug-named) PDF — the trimmed PDF is ephemeral.
        use crate::workspace::write_hash::WriteHashRegistry;

        let dir = tempfile::TempDir::new().unwrap();
        let root = dir.path();
        std::fs::write(root.join("the-well-posed-problem.md"), "# OCR\n").unwrap();
        let pdf_dir = root.join("assets").join("pdf");
        std::fs::create_dir_all(&pdf_dir).unwrap();
        std::fs::write(
            pdf_dir.join("the-well-posed-problem.pdf"),
            b"original pdf",
        )
        .unwrap();

        let registry = WriteHashRegistry::new();
        crate::workspace::ops::persist_companion_frontmatter(
            root,
            "the-well-posed-problem.md",
            "assets/pdf/the-well-posed-problem.pdf",
            None,
            Some(1),
            &registry,
        )
        .unwrap();

        let search_paths = vec![".".to_string(), "assets/pdf".to_string()];
        let found = crate::commands::workspace::find_companion(
            "the-well-posed-problem.md",
            root,
            &search_paths,
        );
        assert_eq!(
            found,
            Some("assets/pdf/the-well-posed-problem.pdf".to_string())
        );
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
            None,
            None,
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

    #[test]
    fn ocr_companion_frontmatter_original_pdf_with_offset_roundtrip() {
        // OCR with first-page trimming (lead > 0) records the ORIGINAL PDF as the
        // companion plus a `companion_page_offset` equal to `lead`. Verify both
        // the frontmatter shape and that find_companion resolves the original PDF.
        use crate::workspace::frontmatter::parse_frontmatter;
        use crate::workspace::write_hash::WriteHashRegistry;

        let dir = tempfile::TempDir::new().unwrap();
        let root = dir.path();
        std::fs::write(root.join("smith2024.md"), "# OCR\n").unwrap();
        let pdf_dir = root.join("assets").join("pdf");
        std::fs::create_dir_all(&pdf_dir).unwrap();
        std::fs::write(pdf_dir.join("smith2024.pdf"), b"original pdf").unwrap();

        let registry = WriteHashRegistry::new();
        // Simulates OCR with lead=2: companion -> original PDF, offset = 2.
        crate::workspace::ops::persist_companion_frontmatter(
            root,
            "smith2024.md",
            "assets/pdf/smith2024.pdf",
            None,
            Some(2),
            &registry,
        )
        .unwrap();

        let content = std::fs::read_to_string(root.join("smith2024.md")).unwrap();
        let parsed = parse_frontmatter(&content);
        assert_eq!(
            parsed.map.get("companion").unwrap().as_str().unwrap(),
            "assets/pdf/smith2024.pdf"
        );
        assert_eq!(
            parsed.map.get("companion_page_offset").unwrap().as_i64().unwrap(),
            2
        );

        let search_paths = vec![".".to_string(), "assets/pdf".to_string()];
        let found = crate::commands::workspace::find_companion(
            "smith2024.md",
            root,
            &search_paths,
        );
        assert_eq!(found, Some("assets/pdf/smith2024.pdf".to_string()));
    }

    // --- ocr_slug overlong slug invariant tests ---

    #[test]
    fn ocr_slug_long_key_at_boundary() {
        // suffix_len = 1 + 79 = 80 = MAX_SLUG_LEN; budget = 0 < MIN_SLUG_LEN
        let key = "a".repeat(79);
        let slug = ocr_slug("Some Valid Title", &key);
        assert!(
            slug.len() <= crate::workspace::normalize::MAX_SLUG_LEN,
            "slug exceeds MAX_SLUG_LEN: {} bytes: {slug}",
            slug.len()
        );
    }

    #[test]
    fn ocr_slug_very_long_key_beyond_boundary() {
        let key = "b".repeat(100);
        let slug = ocr_slug("Another Title Here", &key);
        assert!(
            slug.len() <= crate::workspace::normalize::MAX_SLUG_LEN,
            "slug exceeds MAX_SLUG_LEN: {} bytes: {slug}",
            slug.len()
        );
    }

    #[test]
    fn ocr_slug_empty_title_long_key_respects_limit() {
        let key = "c".repeat(100);
        let slug = ocr_slug("", &key);
        assert!(
            slug.len() <= crate::workspace::normalize::MAX_SLUG_LEN,
            "slug exceeds MAX_SLUG_LEN: {} bytes: {slug}",
            slug.len()
        );
    }

    #[test]
    fn ocr_companion_frontmatter_updated_on_re_ocr() {
        use crate::workspace::frontmatter::parse_frontmatter;
        use crate::workspace::write_hash::WriteHashRegistry;

        let dir = tempfile::TempDir::new().unwrap();
        let root = dir.path();
        let trimmed_dir = root.join("assets").join("pdf");
        std::fs::create_dir_all(&trimmed_dir).unwrap();

        std::fs::write(root.join("smith2024.md"), "# OCR output\n").unwrap();
        std::fs::write(trimmed_dir.join("smith2024-trimmed.pdf"), b"trimmed v1").unwrap();
        let registry = WriteHashRegistry::new();
        crate::workspace::ops::persist_companion_frontmatter(
            root,
            "smith2024.md",
            "assets/pdf/smith2024-trimmed.pdf",
            None,
            None,
            &registry,
        )
        .unwrap();

        // Re-OCR without trimming updates companion to original PDF
        std::fs::write(trimmed_dir.join("smith2024.pdf"), b"original").unwrap();
        crate::workspace::ops::persist_companion_frontmatter(
            root,
            "smith2024.md",
            "assets/pdf/smith2024.pdf",
            None,
            None,
            &registry,
        )
        .unwrap();

        let content = std::fs::read_to_string(root.join("smith2024.md")).unwrap();
        let parsed = parse_frontmatter(&content);
        assert_eq!(
            parsed.map.get("companion").unwrap().as_str().unwrap(),
            "assets/pdf/smith2024.pdf"
        );
    }
}
