use std::sync::Arc;

use serde::{Deserialize, Serialize};

use crate::bib::types::BibEntry;
use crate::bib::writer::SaveOutcome;
use crate::commands::graph::GraphRegistry;
use crate::recognize::identifiers::ExtractedIdentifiers;
use crate::recognize::resolve::{ResolutionSource, Validation};

/// Why a PDF needs manual confirmation.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum ConfirmReason {
    NoTextLayer,
    NoIdentifier,
    NoMatch,
    OfflineError,
}

/// Result of recognize_pdf: either auto-resolved or needs user confirmation.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum RecognizeResult {
    Resolved {
        outcome: SaveOutcome,
        source: ResolutionSource,
        validation: Validation,
        file: String,
        entry: BibEntry,
    },
    NeedsConfirmation {
        reason: ConfirmReason,
        prefilled: BibEntry,
        file: String,
        message: Option<String>,
    },
}

const MAX_RECOGNIZE_PAGES: usize = 10;

/// Returns true if all extracted pages contain only whitespace (scanned PDF).
fn all_pages_whitespace(pages: &[String]) -> bool {
    pages.is_empty() || pages.iter().all(|p| p.trim().is_empty())
}

/// Choose NoMatch vs NoIdentifier based on whether any identifier or title was found.
fn choose_no_result_reason(ids: &ExtractedIdentifiers, title: Option<&str>) -> ConfirmReason {
    let has_identifier = ids.doi.is_some()
        || ids.arxiv.is_some()
        || ids.isbn.is_some()
        || ids.issn.is_some();
    let has_title = title.map_or(false, |t| !t.trim().is_empty());
    if has_identifier || has_title {
        ConfirmReason::NoMatch
    } else {
        ConfirmReason::NoIdentifier
    }
}

/// If `outcome` is `DuplicateDoi` and `copied_to` is `Some`, remove the
/// orphaned PDF copy so repeated imports of the same paper don't accumulate
/// paper-1.pdf, paper-2.pdf, etc.
pub(crate) fn cleanup_copy_on_duplicate(
    outcome: &SaveOutcome,
    copied_to: &Option<std::path::PathBuf>,
) {
    if matches!(outcome, SaveOutcome::DuplicateDoi { .. }) {
        if let Some(ref p) = copied_to {
            let _ = std::fs::remove_file(p);
        }
    }
}

/// Compute the effective title from extracted identifiers.
/// chapter_title (from JSTOR metadata) takes precedence over info_title.
pub(crate) fn effective_title(ids: &ExtractedIdentifiers) -> Option<&str> {
    ids.jstor_metadata
        .as_ref()
        .and_then(|m| m.chapter_title.as_deref())
        .or(ids.info_title.as_deref())
}

/// Build a prefilled BibEntry from extraction metadata for the manual confirmation form.
fn build_prefilled_entry(ids: &ExtractedIdentifiers, file: &str) -> BibEntry {
    let mut entry = BibEntry {
        key: String::new(),
        authors: Vec::new(),
        title: String::new(),
        year: String::new(),
        entry_type: "misc".to_string(),
        line_number: 0,
        bib_file: None,
        abstract_text: None,
        doi: ids.doi.clone(),
        journal: None,
        url: None,
        file: Some(file.to_string()),
        volume: None,
        number: None,
        pages: None,
        publisher: None,
        issn: ids.issn.clone(),
        isbn: ids.isbn.clone(),
        arxiv_id: ids.arxiv.clone(),
        tags: vec![],
    };

    // Pre-fill from info_title
    if let Some(ref title) = ids.info_title {
        entry.title = title.clone();
    }

    // Pre-fill from jstor_metadata
    if let Some(ref jstor) = ids.jstor_metadata {
        if !jstor.authors.is_empty() {
            entry.authors = jstor.authors.clone();
        }
        if let Some(ref year) = jstor.year {
            entry.year = year.clone();
        }
        if let Some(ref source) = jstor.source {
            entry.journal = Some(source.clone());
        }
        // chapter_title takes precedence over info_title when present
        if let Some(ref ct) = jstor.chapter_title {
            entry.title = ct.clone();
        }
    }

    entry
}

#[tauri::command]
pub async fn recognize_pdf(
    pdf_path: String,
    workspace_path: String,
    pdfium_config: tauri::State<'_, crate::pdf::PdfiumConfig>,
    graph_state: tauri::State<'_, Arc<GraphRegistry>>,
    app_handle: tauri::AppHandle,
) -> Result<RecognizeResult, String> {
    use std::path::PathBuf;

    use crate::bib::db::save_entry_with_generated_key;
    use crate::commands::page::lookup_graph_index;
    use crate::pdf::PdfRenderThread;
    use crate::recognize::attach::ensure_pdf_in_workspace;
    use crate::recognize::identifiers::extract_identifiers;
    use crate::recognize::resolve::resolve_to_bib_entry_default;

    let workspace_root = PathBuf::from(&workspace_path);
    let pdf = PathBuf::from(&pdf_path);

    // 1. Copy/reference PDF in workspace (up front, every branch carries valid file)
    let attach = ensure_pdf_in_workspace(&pdf, &workspace_root)?;
    let file = attach.relative_path;
    let copied_to = attach.copied_to;

    // 2. Extract text via transient PdfRenderThread in spawn_blocking
    let lib_path = pdfium_config.lib_path().to_string();
    let pdf_path_clone = pdf_path.clone();
    let data = tauri::async_runtime::spawn_blocking(move || {
        let thread = PdfRenderThread::new(&lib_path)?;
        thread.open(&pdf_path_clone)?;
        thread.extract_recognizer_data(MAX_RECOGNIZE_PAGES)
    })
    .await
    .map_err(|e| format!("spawn_blocking join error: {e}"))??;

    // 3. All pages whitespace -> NeedsConfirmation { NoTextLayer }
    if all_pages_whitespace(&data.pages) {
        let ids = extract_identifiers(&data);
        let prefilled = build_prefilled_entry(&ids, &file);
        return Ok(RecognizeResult::NeedsConfirmation {
            reason: ConfirmReason::NoTextLayer,
            prefilled,
            file,
            message: None,
        });
    }

    // 4. Extract identifiers
    let ids = extract_identifiers(&data);
    let title: Option<&str> = effective_title(&ids);

    // 5. Resolve
    match resolve_to_bib_entry_default(&ids, title, false).await {
        Ok(Some(meta)) => {
            // Set file on the resolved entry
            let mut entry = meta.entry;
            entry.file = Some(file.clone());

            // Get graph index and upsert into DB
            let gi = lookup_graph_index(&graph_state, &workspace_root)
                .ok_or_else(|| "Graph index not ready".to_string())?;
            let outcome = {
                let store = gi.store();
                let result = save_entry_with_generated_key(&store.conn, &mut entry)
                    .map_err(|e| e.to_string())?;
                // For DedupSkipped, update entry.key to the existing key
                if let SaveOutcome::DuplicateDoi { ref existing_key, .. } = result {
                    entry.key = existing_key.clone();
                }
                result
            };

            // Clean up the copied file if this was a duplicate
            cleanup_copy_on_duplicate(&outcome, &copied_to);

            crate::commands::graph::notify_bib_changed(&graph_state, &workspace_root, &app_handle);

            Ok(RecognizeResult::Resolved {
                outcome,
                source: meta.source,
                validation: meta.validation,
                file,
                entry,
            })
        }
        Ok(None) => {
            let reason = choose_no_result_reason(&ids, title);
            let prefilled = build_prefilled_entry(&ids, &file);
            Ok(RecognizeResult::NeedsConfirmation {
                reason,
                prefilled,
                file,
                message: None,
            })
        }
        Err(e) => {
            let prefilled = build_prefilled_entry(&ids, &file);
            Ok(RecognizeResult::NeedsConfirmation {
                reason: ConfirmReason::OfflineError,
                prefilled,
                file,
                message: Some(e.to_string()),
            })
        }
    }
}

#[tauri::command]
pub async fn import_recognized_entry(
    mut entry: BibEntry,
    workspace_path: String,
    graph_state: tauri::State<'_, Arc<GraphRegistry>>,
    app_handle: tauri::AppHandle,
) -> Result<Vec<SaveOutcome>, String> {
    use std::path::PathBuf;

    use crate::bib::db::save_entry_with_generated_key;
    use crate::commands::page::lookup_graph_index;

    let workspace_root = PathBuf::from(&workspace_path);

    let gi = lookup_graph_index(&graph_state, &workspace_root)
        .ok_or_else(|| "Graph index not ready".to_string())?;
    let outcome = {
        let store = gi.store();
        save_entry_with_generated_key(&store.conn, &mut entry)
            .map_err(|e| e.to_string())?
    };

    crate::commands::graph::notify_bib_changed(&graph_state, &workspace_root, &app_handle);
    Ok(vec![outcome])
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::recognize::identifiers::{ExtractedIdentifiers, JstorMetadata};

    // ── Serde tests ───────────────────────────────────────────────────

    #[test]
    fn test_recognize_result_serde_resolved() {
        let result = RecognizeResult::Resolved {
            outcome: SaveOutcome::Saved {
                key: "kucsko2013".to_string(),
            },
            source: ResolutionSource::DoiContentNegotiation,
            validation: Validation::Validated,
            file: "assets/pdf/paper.pdf".to_string(),
            entry: BibEntry {
                key: "kucsko2013".to_string(),
                authors: vec!["Kucsko, Georg".to_string()],
                title: "Probing condensed matter physics".to_string(),
                year: "2013".to_string(),
                entry_type: "article".to_string(),
                line_number: 0,
                bib_file: None,
                abstract_text: None,
                doi: Some("10.1038/nature12373".to_string()),
                journal: None,
                url: None,
                file: Some("assets/pdf/paper.pdf".to_string()),
                volume: None,
                number: None,
                pages: None,
                publisher: None,
                issn: None,
                isbn: None,
                arxiv_id: None,
                tags: vec![],
            },
        };

        let json = serde_json::to_value(&result).unwrap();
        assert_eq!(json["kind"], "resolved");
        assert!(json.get("outcome").is_some());
        assert!(json.get("source").is_some());
        assert!(json.get("validation").is_some());
        assert!(json.get("file").is_some());
        assert!(json.get("entry").is_some());
        assert_eq!(json["file"], "assets/pdf/paper.pdf");
        assert_eq!(json["validation"], "validated");
    }

    #[test]
    fn test_recognize_result_serde_needs_confirmation() {
        let result_none_msg = RecognizeResult::NeedsConfirmation {
            reason: ConfirmReason::NoTextLayer,
            prefilled: BibEntry {
                key: String::new(),
                authors: Vec::new(),
                title: String::new(),
                year: String::new(),
                entry_type: "misc".to_string(),
                line_number: 0,
                bib_file: None,
                abstract_text: None,
                doi: None,
                journal: None,
                url: None,
                file: Some("assets/pdf/scanned.pdf".to_string()),
                volume: None,
                number: None,
                pages: None,
                publisher: None,
                issn: None,
                isbn: None,
                arxiv_id: None,
                tags: vec![],
            },
            file: "assets/pdf/scanned.pdf".to_string(),
            message: None,
        };

        let json = serde_json::to_value(&result_none_msg).unwrap();
        assert_eq!(json["kind"], "needs_confirmation");
        assert_eq!(json["reason"], "no_text_layer");
        assert!(json["message"].is_null());

        let result_some_msg = RecognizeResult::NeedsConfirmation {
            reason: ConfirmReason::OfflineError,
            prefilled: BibEntry {
                key: String::new(),
                authors: Vec::new(),
                title: String::new(),
                year: String::new(),
                entry_type: "misc".to_string(),
                line_number: 0,
                bib_file: None,
                abstract_text: None,
                doi: None,
                journal: None,
                url: None,
                file: None,
                volume: None,
                number: None,
                pages: None,
                publisher: None,
                issn: None,
                isbn: None,
                arxiv_id: None,
                tags: vec![],
            },
            file: "test.pdf".to_string(),
            message: Some("connection refused".to_string()),
        };

        let json = serde_json::to_value(&result_some_msg).unwrap();
        assert_eq!(json["kind"], "needs_confirmation");
        assert_eq!(json["reason"], "offline_error");
        assert_eq!(json["message"], "connection refused");
    }

    #[test]
    fn test_confirm_reason_serde_variants() {
        assert_eq!(
            serde_json::to_value(ConfirmReason::NoTextLayer).unwrap(),
            serde_json::Value::String("no_text_layer".to_string())
        );
        assert_eq!(
            serde_json::to_value(ConfirmReason::NoIdentifier).unwrap(),
            serde_json::Value::String("no_identifier".to_string())
        );
        assert_eq!(
            serde_json::to_value(ConfirmReason::NoMatch).unwrap(),
            serde_json::Value::String("no_match".to_string())
        );
        assert_eq!(
            serde_json::to_value(ConfirmReason::OfflineError).unwrap(),
            serde_json::Value::String("offline_error".to_string())
        );
    }

    // ── all_pages_whitespace tests ────────────────────────────────────

    #[test]
    fn test_all_pages_whitespace_empty() {
        assert!(all_pages_whitespace(&[]));
    }

    #[test]
    fn test_all_pages_whitespace_only_spaces() {
        assert!(all_pages_whitespace(&["  ".into(), "\n\t".into()]));
    }

    #[test]
    fn test_all_pages_whitespace_with_text() {
        assert!(!all_pages_whitespace(&["hello".into()]));
    }

    #[test]
    fn test_all_pages_whitespace_mixed() {
        assert!(!all_pages_whitespace(&["  ".into(), "text".into()]));
    }

    // ── choose_no_result_reason tests ─────────────────────────────────

    #[test]
    fn test_choose_reason_no_identifier() {
        let ids = ExtractedIdentifiers::default();
        assert_eq!(choose_no_result_reason(&ids, None), ConfirmReason::NoIdentifier);
    }

    #[test]
    fn test_choose_reason_no_match_has_doi() {
        let ids = ExtractedIdentifiers {
            doi: Some("10.1038/nature12373".to_string()),
            ..Default::default()
        };
        assert_eq!(choose_no_result_reason(&ids, None), ConfirmReason::NoMatch);
    }

    #[test]
    fn test_choose_reason_no_match_has_title() {
        let ids = ExtractedIdentifiers::default();
        assert_eq!(
            choose_no_result_reason(&ids, Some("A Title")),
            ConfirmReason::NoMatch
        );
    }

    #[test]
    fn test_choose_reason_no_match_has_arxiv() {
        let ids = ExtractedIdentifiers {
            arxiv: Some("2301.07041".to_string()),
            ..Default::default()
        };
        assert_eq!(choose_no_result_reason(&ids, None), ConfirmReason::NoMatch);
    }

    #[test]
    fn test_choose_reason_no_match_has_isbn() {
        let ids = ExtractedIdentifiers {
            isbn: Some("9780306406157".to_string()),
            ..Default::default()
        };
        assert_eq!(choose_no_result_reason(&ids, None), ConfirmReason::NoMatch);
    }

    #[test]
    fn test_choose_reason_no_identifier_whitespace_title() {
        let ids = ExtractedIdentifiers::default();
        assert_eq!(
            choose_no_result_reason(&ids, Some("   ")),
            ConfirmReason::NoIdentifier
        );
    }

    // ── build_prefilled_entry tests ───────────────────────────────────

    #[test]
    fn test_build_prefilled_entry_from_jstor() {
        let ids = ExtractedIdentifiers {
            doi: Some("10.2307/12345".to_string()),
            info_title: Some("Info Dict Title".to_string()),
            jstor_metadata: Some(JstorMetadata {
                chapter_title: Some("Chapter Title Override".to_string()),
                authors: vec!["Smith, John".to_string(), "Doe, Jane".to_string()],
                source: Some("The Journal of Philosophy".to_string()),
                volume: None,
                number: None,
                pages: None,
                year: Some("2001".to_string()),
            }),
            ..Default::default()
        };

        let entry = build_prefilled_entry(&ids, "assets/pdf/paper.pdf");
        assert_eq!(entry.entry_type, "misc");
        // chapter_title overrides info_title
        assert_eq!(entry.title, "Chapter Title Override");
        assert_eq!(entry.authors, vec!["Smith, John", "Doe, Jane"]);
        assert_eq!(entry.year, "2001");
        assert_eq!(entry.journal, Some("The Journal of Philosophy".to_string()));
        assert_eq!(entry.doi, Some("10.2307/12345".to_string()));
        assert_eq!(entry.file, Some("assets/pdf/paper.pdf".to_string()));
    }

    #[test]
    fn test_build_prefilled_entry_minimal() {
        let ids = ExtractedIdentifiers::default();
        let entry = build_prefilled_entry(&ids, "assets/pdf/test.pdf");
        assert_eq!(entry.title, "");
        assert!(entry.authors.is_empty());
        assert_eq!(entry.entry_type, "misc");
        assert_eq!(entry.file, Some("assets/pdf/test.pdf".to_string()));
        assert_eq!(entry.key, "");
        assert_eq!(entry.year, "");
    }

    #[test]
    fn test_build_prefilled_entry_sets_isbn_and_arxiv_from_ids() {
        let ids = ExtractedIdentifiers {
            isbn: Some("978-0-306-40615-7".to_string()),
            arxiv: Some("2301.07041".to_string()),
            ..Default::default()
        };
        let entry = build_prefilled_entry(&ids, "assets/pdf/test.pdf");
        assert_eq!(entry.isbn, Some("978-0-306-40615-7".to_string()));
        assert_eq!(entry.arxiv_id, Some("2301.07041".to_string()));
    }

    #[test]
    fn test_build_prefilled_entry_minimal_isbn_arxiv_none() {
        let ids = ExtractedIdentifiers::default();
        let entry = build_prefilled_entry(&ids, "assets/pdf/test.pdf");
        assert_eq!(entry.isbn, None);
        assert_eq!(entry.arxiv_id, None);
    }

    // ── wiremock integration test: resolve + write file field ─────────

    #[tokio::test]
    async fn test_resolve_write_file_field_round_trip() {
        use crate::bib::cache::BibCache;
        use crate::bib::parser::parse_bibtex;
        use crate::bib::writer::append_entries_to_file;
        use crate::recognize::resolve::{resolve_to_bib_entry_with_base, BaseUrls};
        use wiremock::matchers::{header, method, path};
        use wiremock::{Mock, MockServer, ResponseTemplate};

        let server = MockServer::start().await;
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(5))
            .build()
            .unwrap();

        let csl_json = r#"{
            "type": "journal-article",
            "title": "Probing condensed matter physics",
            "author": [{"family": "Kucsko", "given": "Georg"}],
            "container-title": "Nature",
            "issued": {"date-parts": [[2013]]},
            "DOI": "10.1038/nature12373"
        }"#;

        Mock::given(method("GET"))
            .and(path("/10.1038/nature12373"))
            .and(header("Accept", "application/vnd.citationstyles.csl+json"))
            .respond_with(ResponseTemplate::new(200).set_body_string(csl_json))
            .mount(&server)
            .await;

        let ids = ExtractedIdentifiers {
            doi: Some("10.1038/nature12373".to_string()),
            ..Default::default()
        };

        let uri = server.uri();
        let result = resolve_to_bib_entry_with_base(
            &client,
            &ids,
            None,
            true,
            &BaseUrls {
                doi: &uri,
                crossref: &uri,
                arxiv: &uri,
                open_library: "http://localhost:1",
                google_books: "http://localhost:1",
            },
        )
        .await;

        let meta = result.expect("should succeed").expect("should have metadata");
        let mut entry = meta.entry;
        entry.file = Some("assets/pdf/test.pdf".to_string());

        // Write to a tempdir bib file
        let dir = tempfile::tempdir().unwrap();
        let bib_path = dir.path().join("refs.bib");
        std::fs::write(&bib_path, "").unwrap();
        let cache = BibCache::new();

        let outcomes = append_entries_to_file(&[entry], &bib_path, dir.path(), &cache).unwrap();
        assert!(!outcomes.is_empty());

        // Read back and verify file field
        let content = std::fs::read_to_string(&bib_path).unwrap();
        let entries = parse_bibtex(&content);
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].file, Some("assets/pdf/test.pdf".to_string()));
        assert_eq!(entries[0].doi, Some("10.1038/nature12373".to_string()));
        assert_eq!(entries[0].title, "Probing condensed matter physics");
    }

    // ── duplicate DOI cleanup test ─────────────────────────────────────

    #[test]
    fn test_duplicate_doi_cleans_up_orphaned_pdf_copy() {
        use crate::bib::cache::BibCache;
        use crate::bib::writer::{append_entries_to_file, SaveOutcome};
        use crate::recognize::attach::ensure_pdf_in_workspace;

        // 1. Set up workspace with a bib file containing an entry with a known DOI
        let workspace = tempfile::tempdir().unwrap();
        let bib_path = workspace.path().join("refs.bib");
        let existing_bib = "@article{kucsko2013,\n  author = {Kucsko, Georg},\n  title = {Probing condensed matter physics},\n  year = {2013},\n  doi = {10.1038/nature12373}\n}\n";
        std::fs::write(&bib_path, existing_bib).unwrap();

        // 2. Create an external PDF file in a separate tempdir
        let external = tempfile::tempdir().unwrap();
        let external_pdf = external.path().join("paper.pdf");
        std::fs::write(&external_pdf, b"dummy pdf data").unwrap();

        // 3. Copy the external PDF into the workspace
        let attach = ensure_pdf_in_workspace(&external_pdf, workspace.path()).unwrap();
        assert!(attach.copied_to.is_some(), "external PDF should have been copied");
        let copied_path = attach.copied_to.clone().unwrap();
        assert!(copied_path.exists(), "copied file should exist before cleanup");

        // 4. Try to append an entry with the same DOI -- should get DuplicateDoi
        let cache = BibCache::new();
        let entry = BibEntry {
            key: String::new(),
            authors: vec!["Kucsko, Georg".to_string()],
            title: "Probing condensed matter physics".to_string(),
            year: "2013".to_string(),
            entry_type: "article".to_string(),
            line_number: 0,
            bib_file: None,
            abstract_text: None,
            doi: Some("10.1038/nature12373".to_string()),
            journal: None,
            url: None,
            file: Some(attach.relative_path.clone()),
            volume: None,
            number: None,
            pages: None,
            publisher: None,
            issn: None,
            isbn: None,
            arxiv_id: None,
            tags: vec![],
        };
        let outcomes =
            append_entries_to_file(&[entry], &bib_path, workspace.path(), &cache).unwrap();
        let outcome = &outcomes[0];
        assert!(
            matches!(outcome, SaveOutcome::DuplicateDoi { .. }),
            "should detect duplicate DOI"
        );

        // 5. Call the production cleanup helper
        cleanup_copy_on_duplicate(outcome, &attach.copied_to);

        // 6. Assert the copied file no longer exists
        assert!(
            !copied_path.exists(),
            "orphaned PDF copy should be deleted after DuplicateDoi cleanup"
        );
    }

    #[test]
    fn test_cleanup_copy_on_duplicate_no_op_for_saved() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("keep-me.pdf");
        std::fs::write(&file, b"dummy").unwrap();

        let outcome = SaveOutcome::Saved {
            key: "foo2024".to_string(),
        };
        cleanup_copy_on_duplicate(&outcome, &Some(file.clone()));

        assert!(file.exists(), "file should NOT be deleted for Saved outcome");
    }

    #[test]
    fn test_cleanup_copy_on_duplicate_no_op_for_none() {
        let outcome = SaveOutcome::DuplicateDoi {
            doi: "10.1234/test".to_string(),
            existing_key: "test2024".to_string(),
        };
        // Should not panic when copied_to is None
        cleanup_copy_on_duplicate(&outcome, &None);
    }

    // ── title fallback (chapter_title > info_title) tests ──────────────

    #[test]
    fn test_title_fallback_prefers_chapter_title_over_info_title() {
        // JSTOR chapter PDF with chapter_title but no info_title.
        // The effective title should be the chapter_title, so
        // choose_no_result_reason should return NoMatch, not NoIdentifier.
        let ids = ExtractedIdentifiers {
            jstor_metadata: Some(JstorMetadata {
                chapter_title: Some("The Chapter Title".to_string()),
                authors: vec!["Author, First".to_string()],
                ..Default::default()
            }),
            // info_title is None
            ..Default::default()
        };

        let title = effective_title(&ids);
        assert_eq!(title, Some("The Chapter Title"));
        assert_eq!(
            choose_no_result_reason(&ids, title),
            ConfirmReason::NoMatch,
            "chapter_title should make this NoMatch, not NoIdentifier"
        );
    }

    #[test]
    fn test_title_fallback_chapter_title_none_uses_info_title() {
        let ids = ExtractedIdentifiers {
            info_title: Some("Info Dict Title".to_string()),
            // no jstor_metadata
            ..Default::default()
        };

        let title = effective_title(&ids);
        assert_eq!(title, Some("Info Dict Title"));
        assert_eq!(
            choose_no_result_reason(&ids, title),
            ConfirmReason::NoMatch,
        );
    }

    #[test]
    fn test_title_fallback_both_present_prefers_chapter_title() {
        let ids = ExtractedIdentifiers {
            info_title: Some("Info Dict Title".to_string()),
            jstor_metadata: Some(JstorMetadata {
                chapter_title: Some("Chapter Title Override".to_string()),
                ..Default::default()
            }),
            ..Default::default()
        };

        let title = effective_title(&ids);
        assert_eq!(title, Some("Chapter Title Override"));
    }

    #[test]
    fn test_title_fallback_neither_present_is_none() {
        let ids = ExtractedIdentifiers::default();

        let title = effective_title(&ids);
        assert!(title.is_none());
        assert_eq!(
            choose_no_result_reason(&ids, title),
            ConfirmReason::NoIdentifier,
        );
    }

    // ── pdfium integration tests (ignored by default) ─────────────────

    #[test]
    #[ignore]
    fn test_born_digital_pdf_extracts_identifiers() {
        use crate::pdf::{find_libpdfium, lock_pdfium, PdfRenderThread};
        use crate::recognize::identifiers::extract_identifiers;

        let _guard = lock_pdfium();
        let lib_path = find_libpdfium(None)
            .map(|p| p.to_string_lossy().to_string())
            .expect("libpdfium not found");

        let fixture = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("tests")
            .join("fixtures")
            .join("born_digital.pdf");

        let thread = PdfRenderThread::new(&lib_path).unwrap();
        thread.open(fixture.to_str().unwrap()).unwrap();
        let data = thread.extract_recognizer_data(MAX_RECOGNIZE_PAGES).unwrap();

        let ids = extract_identifiers(&data);
        let has_id = ids.doi.is_some() || ids.arxiv.is_some();
        assert!(has_id, "born_digital.pdf should have at least one identifier: {ids:?}");
    }

    #[test]
    #[ignore]
    fn test_scanned_pdf_triggers_no_text_layer() {
        use crate::pdf::{find_libpdfium, lock_pdfium, PdfRenderThread};

        let _guard = lock_pdfium();
        let lib_path = find_libpdfium(None)
            .map(|p| p.to_string_lossy().to_string())
            .expect("libpdfium not found");

        let fixture = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("tests")
            .join("fixtures")
            .join("scanned.pdf");

        let thread = PdfRenderThread::new(&lib_path).unwrap();
        thread.open(fixture.to_str().unwrap()).unwrap();
        let data = thread.extract_recognizer_data(MAX_RECOGNIZE_PAGES).unwrap();

        assert!(
            all_pages_whitespace(&data.pages),
            "scanned.pdf should be detected as all-whitespace"
        );
    }
}
