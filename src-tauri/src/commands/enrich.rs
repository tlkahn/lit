use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

use serde::Serialize;
use tauri::State;

use crate::bib::cache::BibCache;
use crate::bib::semantic_scholar::{
    lookup_by_doi_with_base as s2_lookup_by_doi_with_base, s2_paper_to_bib_entry,
    s2_ref_to_bib_entry, search_by_title_with_base, S2Paper,
};
use crate::bib::types::BibEntry;
use crate::bib::writer::{append_entries_to_file, update_entry_fields, SaveOutcome};
use crate::commands::bib::build_bib_index;
use crate::commands::bib_import::{fetch_crossref_by_doi, HTTP_CLIENT};
use crate::commands::graph::GraphRegistry;

const MAX_REFERENCES: usize = 30;

#[derive(Debug, Clone, Serialize)]
pub struct EnrichResult {
    pub entry: BibEntry,
    pub fields_added: Vec<String>,
    pub references_found: usize,
    pub references_appended: usize,
    pub shadow_nodes_created: usize,
}

/// Merge enrichment fields from CrossRef and S2 sources into an existing entry.
/// Only adds fields that are missing (None or empty) on the existing entry.
/// CrossRef takes priority over S2 when both provide a field.
/// Returns a HashMap of BibTeX field names to raw values.
pub fn merge_enrichment_fields(
    existing: &BibEntry,
    crossref: Option<&BibEntry>,
    s2: Option<&BibEntry>,
) -> HashMap<String, String> {
    let mut result = HashMap::new();

    let enrichable: Vec<(&str, fn(&BibEntry) -> Option<&str>)> = vec![
        ("abstract", |e: &BibEntry| e.abstract_text.as_deref()),
        ("doi", |e: &BibEntry| e.doi.as_deref()),
        ("journal", |e: &BibEntry| e.journal.as_deref()),
        ("url", |e: &BibEntry| e.url.as_deref()),
        ("volume", |e: &BibEntry| e.volume.as_deref()),
        ("number", |e: &BibEntry| e.number.as_deref()),
        ("pages", |e: &BibEntry| e.pages.as_deref()),
        ("publisher", |e: &BibEntry| e.publisher.as_deref()),
        ("issn", |e: &BibEntry| e.issn.as_deref()),
    ];

    for (field_name, getter) in &enrichable {
        let existing_val = getter(existing);
        if existing_val.is_some() && !existing_val.unwrap().is_empty() {
            continue;
        }

        let crossref_val = crossref.and_then(|e| getter(e));
        let s2_val = s2.and_then(|e| getter(e));

        let chosen = crossref_val
            .filter(|v| !v.is_empty())
            .or_else(|| s2_val.filter(|v| !v.is_empty()));

        if let Some(val) = chosen {
            result.insert(field_name.to_string(), val.to_string());
        }
    }

    result
}

async fn fetch_crossref(doi: &str) -> Result<BibEntry, String> {
    fetch_crossref_by_doi(doi).await
}

async fn fetch_s2(
    doi: Option<&str>,
    title: &str,
) -> Result<(S2Paper, BibEntry), String> {
    fetch_s2_with_base(doi, title, &HTTP_CLIENT, "https://api.semanticscholar.org").await
}

async fn fetch_s2_with_base(
    doi: Option<&str>,
    title: &str,
    client: &reqwest::Client,
    base_url: &str,
) -> Result<(S2Paper, BibEntry), String> {
    let title_is_empty = title.trim().is_empty();

    let paper = if let Some(doi) = doi {
        match s2_lookup_by_doi_with_base(client, doi, base_url).await {
            Ok(p) => p,
            Err(doi_err) => {
                if title_is_empty {
                    return Err(format!(
                        "DOI lookup failed ({}) and title is empty; cannot fall back to title search",
                        doi_err
                    ));
                }
                let papers = search_by_title_with_base(client, title, base_url).await?;
                papers
                    .into_iter()
                    .next()
                    .ok_or_else(|| "No results found on Semantic Scholar".to_string())?
            }
        }
    } else {
        if title_is_empty {
            return Err(
                "Cannot search Semantic Scholar: entry has no DOI and no title".to_string(),
            );
        }
        let papers = search_by_title_with_base(client, title, base_url).await?;
        papers
            .into_iter()
            .next()
            .ok_or_else(|| "No results found on Semantic Scholar".to_string())?
    };

    let entry = s2_paper_to_bib_entry(&paper);
    Ok((paper, entry))
}

#[tauri::command]
pub async fn enrich_bib_entry(
    bib_key: String,
    workspace_path: String,
    cache: State<'_, BibCache>,
    graph_state: State<'_, Arc<GraphRegistry>>,
    app_handle: tauri::AppHandle,
) -> Result<EnrichResult, String> {
    let root = PathBuf::from(&workspace_path);
    let index = build_bib_index(&root, &cache);

    let existing = index
        .get(&bib_key)
        .ok_or_else(|| format!("Entry '{}' not found in workspace", bib_key))?
        .clone();

    let bib_file_str = existing
        .bib_file
        .as_ref()
        .ok_or_else(|| format!("Entry '{}' has no bib_file path", bib_key))?;
    let bib_path = PathBuf::from(bib_file_str);

    // Fetch from CrossRef (non-fatal on failure)
    let crossref_entry = if let Some(ref doi) = existing.doi {
        fetch_crossref(doi).await.ok()
    } else {
        None
    };

    // Fetch from S2 (non-fatal on failure)
    let s2_result = fetch_s2(existing.doi.as_deref(), &existing.title).await.ok();
    let s2_entry = s2_result.as_ref().map(|(_, e)| e);
    let s2_paper = s2_result.as_ref().map(|(p, _)| p);

    // Merge enrichment fields
    let new_fields = merge_enrichment_fields(&existing, crossref_entry.as_ref(), s2_entry);
    let mut fields_added: Vec<String> = new_fields.keys().cloned().collect();

    // Update entry fields if any new fields were found
    if !new_fields.is_empty() {
        let modified = update_entry_fields(&bib_path, &bib_key, &new_fields, &cache)?;
        if !modified {
            fields_added.clear();
        }
    }

    // Append S2 references as minimal BibEntries
    let mut shadow_nodes_created: usize = 0;
    let mut references_appended: usize = 0;
    let references_found;

    if let Some(paper) = s2_paper {
        let refs = paper.references.as_deref().unwrap_or(&[]);
        references_found = refs.len();

        if !refs.is_empty() {
            let ref_entries: Vec<BibEntry> = refs
                .iter()
                .take(MAX_REFERENCES)
                .map(s2_ref_to_bib_entry)
                .collect();
            references_appended = ref_entries.len();

            let outcomes =
                append_entries_to_file(&ref_entries, &bib_path, &root, &cache)?;

            shadow_nodes_created = outcomes
                .iter()
                .filter(|o| {
                    matches!(o, SaveOutcome::Saved { .. } | SaveOutcome::SavedNoDoi { .. })
                })
                .count();
        }
    } else {
        references_found = 0;
    }

    // Refresh shadows in the graph index
    crate::commands::graph::refresh_graph_shadows(&graph_state, &root, &app_handle);

    // Re-read the entry to get the enriched version
    let updated_index = build_bib_index(&root, &cache);
    let updated_entry = updated_index
        .get(&bib_key)
        .cloned()
        .unwrap_or(existing);

    Ok(EnrichResult {
        entry: updated_entry,
        fields_added,
        references_found,
        references_appended,
        shadow_nodes_created,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::bib::cache::BibCache;
    use crate::bib::types::BibEntry;
    use std::fs;
    use tempfile::TempDir;

    fn make_entry(overrides: impl FnOnce(&mut BibEntry)) -> BibEntry {
        let mut entry = BibEntry {
            key: "test2024".to_string(),
            authors: vec!["Test, Author".to_string()],
            title: "Test Title".to_string(),
            year: "2024".to_string(),
            entry_type: "article".to_string(),
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
            tags: vec![],
        };
        overrides(&mut entry);
        entry
    }

    // ── merge_enrichment_fields ────────────────────────────────────

    #[test]
    fn merge_crossref_priority_over_s2() {
        let existing = make_entry(|_| {});

        let crossref = make_entry(|e| {
            e.abstract_text = Some("CrossRef abstract".to_string());
            e.doi = Some("10.1/crossref".to_string());
        });

        let s2 = make_entry(|e| {
            e.abstract_text = Some("S2 abstract".to_string());
            e.url = Some("https://s2.example.com".to_string());
        });

        let merged = merge_enrichment_fields(&existing, Some(&crossref), Some(&s2));
        assert_eq!(merged.get("abstract").unwrap(), "CrossRef abstract");
        assert_eq!(merged.get("doi").unwrap(), "10.1/crossref");
        assert_eq!(merged.get("url").unwrap(), "https://s2.example.com");
    }

    #[test]
    fn merge_skips_existing_fields() {
        let existing = make_entry(|e| {
            e.doi = Some("10.1/existing".to_string());
        });

        let crossref = make_entry(|e| {
            e.doi = Some("10.1/crossref".to_string());
        });

        let merged = merge_enrichment_fields(&existing, Some(&crossref), None);
        assert!(!merged.contains_key("doi"));
    }

    #[test]
    fn merge_falls_back_to_s2_when_no_crossref() {
        let existing = make_entry(|_| {});

        let s2 = make_entry(|e| {
            e.abstract_text = Some("S2 abstract".to_string());
        });

        let merged = merge_enrichment_fields(&existing, None, Some(&s2));
        assert_eq!(merged.get("abstract").unwrap(), "S2 abstract");
    }

    #[test]
    fn merge_both_none_returns_empty() {
        let existing = make_entry(|_| {});
        let merged = merge_enrichment_fields(&existing, None, None);
        assert!(merged.is_empty());
    }

    #[test]
    fn merge_field_name_mapping() {
        let existing = make_entry(|_| {});

        let crossref = make_entry(|e| {
            e.abstract_text = Some("abs".to_string());
            e.doi = Some("10.1/x".to_string());
            e.journal = Some("Nature".to_string());
            e.url = Some("https://example.com".to_string());
            e.volume = Some("42".to_string());
            e.number = Some("3".to_string());
            e.pages = Some("100--115".to_string());
            e.publisher = Some("Elsevier".to_string());
            e.issn = Some("1234-5678".to_string());
        });

        let merged = merge_enrichment_fields(&existing, Some(&crossref), None);
        assert!(merged.contains_key("abstract"));
        assert!(merged.contains_key("doi"));
        assert!(merged.contains_key("journal"));
        assert!(merged.contains_key("url"));
        assert!(merged.contains_key("volume"));
        assert!(merged.contains_key("number"));
        assert!(merged.contains_key("pages"));
        assert!(merged.contains_key("publisher"));
        assert!(merged.contains_key("issn"));
        assert_eq!(merged.len(), 9);
    }

    #[test]
    fn merge_includes_volume_number_pages_publisher_issn() {
        let existing = make_entry(|_| {});

        let crossref = make_entry(|e| {
            e.volume = Some("10".to_string());
            e.number = Some("2".to_string());
            e.pages = Some("50--75".to_string());
            e.publisher = Some("Springer".to_string());
            e.issn = Some("0028-0836".to_string());
        });

        let merged = merge_enrichment_fields(&existing, Some(&crossref), None);
        assert_eq!(merged.get("volume").unwrap(), "10");
        assert_eq!(merged.get("number").unwrap(), "2");
        assert_eq!(merged.get("pages").unwrap(), "50--75");
        assert_eq!(merged.get("publisher").unwrap(), "Springer");
        assert_eq!(merged.get("issn").unwrap(), "0028-0836");
    }

    #[test]
    fn merge_journal_for_inproceedings() {
        let existing = make_entry(|e| {
            e.entry_type = "inproceedings".to_string();
        });

        let crossref = make_entry(|e| {
            e.journal = Some("Conference 2024".to_string());
        });

        let merged = merge_enrichment_fields(&existing, Some(&crossref), None);
        assert_eq!(merged.get("journal").unwrap(), "Conference 2024");
    }

    #[test]
    fn merge_skips_empty_string_values_from_sources() {
        let existing = make_entry(|_| {});

        let crossref = make_entry(|e| {
            e.doi = Some("".to_string());
        });

        let s2 = make_entry(|e| {
            e.doi = Some("10.1/s2".to_string());
        });

        let merged = merge_enrichment_fields(&existing, Some(&crossref), Some(&s2));
        assert_eq!(merged.get("doi").unwrap(), "10.1/s2");
    }

    // ── fetch_crossref rejects invalid DOIs ─────────────────────────

    #[tokio::test]
    async fn fetch_crossref_rejects_invalid_doi() {
        let result = fetch_crossref("not-a-doi").await;
        assert!(result.is_err());
        assert!(
            result.as_ref().unwrap_err().contains("Invalid DOI format"),
            "Expected 'Invalid DOI format' but got: {}",
            result.unwrap_err()
        );
    }

    #[tokio::test]
    async fn fetch_crossref_rejects_garbage_doi_with_spaces() {
        let result = fetch_crossref("see paper above").await;
        assert!(result.is_err());
        assert!(
            result.as_ref().unwrap_err().contains("Invalid DOI format"),
            "Expected 'Invalid DOI format' but got: {}",
            result.unwrap_err()
        );
    }

    #[tokio::test]
    async fn fetch_crossref_rejects_url_only_doi() {
        let result = fetch_crossref("https://doi.org/").await;
        assert!(result.is_err());
        assert!(
            result.as_ref().unwrap_err().contains("Invalid DOI format"),
            "Expected 'Invalid DOI format' but got: {}",
            result.unwrap_err()
        );
    }

    // ── fetch_s2 empty-title guard ──────────────────────────────────

    #[tokio::test]
    async fn fetch_s2_rejects_empty_title_no_doi() {
        let client = reqwest::Client::new();
        let result = fetch_s2_with_base(None, "", &client, "http://unused.invalid").await;
        assert!(result.is_err(), "expected Err for empty title + no DOI");
        let err = result.unwrap_err();
        assert!(
            err.contains("no DOI") && err.contains("no title"),
            "expected error mentioning 'no DOI' and 'no title', got: {}",
            err
        );
    }

    #[tokio::test]
    async fn fetch_s2_rejects_whitespace_title_no_doi() {
        let client = reqwest::Client::new();
        let result = fetch_s2_with_base(None, "   \t  ", &client, "http://unused.invalid").await;
        assert!(result.is_err(), "expected Err for whitespace-only title + no DOI");
        let err = result.unwrap_err();
        assert!(
            err.contains("no DOI") && err.contains("no title"),
            "expected error mentioning 'no DOI' and 'no title', got: {}",
            err
        );
    }

    #[tokio::test]
    async fn fetch_s2_rejects_empty_title_after_doi_failure() {
        let mock_server = wiremock::MockServer::start().await;

        wiremock::Mock::given(wiremock::matchers::method("GET"))
            .and(wiremock::matchers::path_regex(r"/graph/v1/paper/DOI:.*"))
            .respond_with(wiremock::ResponseTemplate::new(404))
            .mount(&mock_server)
            .await;

        let client = reqwest::Client::new();
        let result =
            fetch_s2_with_base(Some("10.9999/nonexistent"), "", &client, &mock_server.uri()).await;
        assert!(result.is_err(), "expected Err when DOI fails and title is empty");
        let err = result.unwrap_err();
        assert!(
            err.contains("DOI lookup failed") && err.contains("title is empty"),
            "expected error mentioning 'DOI lookup failed' and 'title is empty', got: {}",
            err
        );
    }

    #[tokio::test]
    async fn fetch_s2_allows_nonempty_title_no_doi() {
        let mock_server = wiremock::MockServer::start().await;
        let body = r#"{
            "total": 1,
            "offset": 0,
            "data": [{
                "paperId": "abc",
                "title": "Quantum Computing Advances",
                "year": 2023,
                "externalIds": {"DOI": "10.1234/qc2023", "CorpusId": 42}
            }]
        }"#;

        wiremock::Mock::given(wiremock::matchers::method("GET"))
            .and(wiremock::matchers::path("/graph/v1/paper/search"))
            .respond_with(wiremock::ResponseTemplate::new(200).set_body_string(body))
            .mount(&mock_server)
            .await;

        let client = reqwest::Client::new();
        let result =
            fetch_s2_with_base(None, "quantum computing", &client, &mock_server.uri()).await;
        assert!(result.is_ok(), "expected Ok for nonempty title, got: {:?}", result);
        let (paper, entry) = result.unwrap();
        assert_eq!(paper.title.as_deref(), Some("Quantum Computing Advances"));
        assert_eq!(entry.doi, Some("10.1234/qc2023".to_string()));
    }

    // ── merge_receives_crossref fields via parse_crossref_body ────

    #[test]
    fn merge_receives_crossref_volume_issue_page_publisher_issn() {
        use crate::commands::bib_import::parse_crossref_body;

        let body = r#"{
            "status": "ok",
            "message-type": "work",
            "message": {
                "type": "journal-article",
                "title": ["A Paper"],
                "author": [{"family": "Smith", "given": "John"}],
                "container-title": ["Nature"],
                "issued": {"date-parts": [[2023]]},
                "DOI": "10.1038/test123",
                "volume": "600",
                "issue": "7890",
                "page": "100-110",
                "publisher": "Nature Publishing Group",
                "ISSN": ["0028-0836", "1476-4687"]
            }
        }"#;
        let crossref_entry = parse_crossref_body(body).unwrap();
        let existing = make_entry(|_| {});

        let merged = merge_enrichment_fields(&existing, Some(&crossref_entry), None);
        assert_eq!(merged.get("volume").unwrap(), "600");
        assert_eq!(merged.get("number").unwrap(), "7890");
        assert_eq!(merged.get("pages").unwrap(), "100-110");
        assert_eq!(merged.get("publisher").unwrap(), "Nature Publishing Group");
        assert_eq!(merged.get("issn").unwrap(), "0028-0836");
    }

    // ── refresh_shadows via cloned Arc ──────────────────────────────

    #[test]
    fn refresh_shadows_propagates_through_cloned_arc() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().to_path_buf();

        // Create a .md file citing [@smith2024] but no .bib yet
        fs::create_dir_all(dir.path()).unwrap();
        fs::write(dir.path().join("a.md"), "As shown in [@smith2024].").unwrap();

        let gi = crate::graph::indexer::GraphIndex::build(root.clone(), false).unwrap();

        // No shadow initially
        {
            let meta = gi.store().all_nodes_metadata().unwrap();
            assert!(
                !meta.iter().any(|(id, _, _)| id == "bib:smith2024"),
                "shadow should not exist before .bib is written"
            );
        }

        // Insert into a registry (same type as GraphRegistry)
        let registry = GraphRegistry::new();
        registry.indices.lock().unwrap().insert(root.clone(), Arc::new(gi));

        // Write a .bib file
        fs::write(
            dir.path().join("refs.bib"),
            "@article{smith2024,\n  author = {Smith, John},\n  title = {Alpha},\n  year = {2024}\n}",
        )
        .unwrap();

        // Clone the Arc out and drop the registry guard, then call refresh_shadows
        let gi = graph_state_indices_cloned(&registry, &root);
        assert!(gi.is_some(), "GraphIndex should be in the registry");
        let gi = gi.unwrap();
        let changed = gi.refresh_shadows().unwrap();
        assert!(changed, "refresh_shadows should detect the new .bib entry");

        // Shadow node should now exist
        {
            let meta = gi.store().all_nodes_metadata().unwrap();
            assert!(
                meta.iter().any(|(id, _, _)| id == "bib:smith2024"),
                "shadow must be created after refresh, nodes: {:?}",
                meta
            );
        }
    }

    /// Mirrors the clone-and-drop pattern used in the production code.
    fn graph_state_indices_cloned(
        registry: &GraphRegistry,
        root: &std::path::Path,
    ) -> Option<Arc<crate::graph::indexer::GraphIndex>> {
        registry.indices.lock().unwrap().get(root).cloned()
    }

    // ── EnrichResult serialization ───────────────────────────────────

    #[test]
    fn enrich_result_serializes_references_appended() {
        let result = EnrichResult {
            entry: make_entry(|_| {}),
            fields_added: vec!["abstract".to_string()],
            references_found: 50,
            references_appended: 10,
            shadow_nodes_created: 8,
        };
        let json = serde_json::to_value(&result).unwrap();
        assert_eq!(json["references_appended"], 10);
        assert_eq!(json["references_found"], 50);
        assert_eq!(json["shadow_nodes_created"], 8);
    }

    // ── references_appended capping contract ──────────────────────

    #[test]
    fn references_appended_capped_at_max_references() {
        let large: Vec<i32> = (0..50).collect();
        assert_eq!(large.iter().take(MAX_REFERENCES).count(), 30);

        let small: Vec<i32> = (0..10).collect();
        assert_eq!(small.iter().take(MAX_REFERENCES).count(), 10);
    }

    // ── full enrichment pipeline (pure functions + file ops) ───────

    #[test]
    fn enrichment_pipeline_with_tempdir() {
        let dir = TempDir::new().unwrap();
        let bib_path = dir.path().join("refs.bib");
        let content = "@article{smith2024,\n  author = {Smith, John},\n  title = {Test Paper},\n  year = {2024},\n  doi = {10.1/existing}\n}\n";
        fs::write(&bib_path, content).unwrap();
        let cache = BibCache::new();

        // Simulate CrossRef result
        let crossref = make_entry(|e| {
            e.abstract_text = Some("Enriched abstract".to_string());
            e.url = Some("https://enriched.example.com".to_string());
        });

        // Simulate S2 result
        let s2 = make_entry(|e| {
            e.journal = Some("Nature".to_string());
        });

        let new_fields = merge_enrichment_fields(
            &make_entry(|e| {
                e.doi = Some("10.1/existing".to_string());
            }),
            Some(&crossref),
            Some(&s2),
        );

        assert!(new_fields.contains_key("abstract"));
        assert!(new_fields.contains_key("url"));
        assert!(new_fields.contains_key("journal"));

        // Write back
        let modified = update_entry_fields(&bib_path, "smith2024", &new_fields, &cache).unwrap();
        assert!(modified);

        // Verify fields were written
        let updated_content = fs::read_to_string(&bib_path).unwrap();
        let parsed = crate::bib::parser::parse_bibtex(&updated_content);
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].abstract_text, Some("Enriched abstract".to_string()));
        assert_eq!(parsed[0].url, Some("https://enriched.example.com".to_string()));
        assert_eq!(parsed[0].journal, Some("Nature".to_string()));
        // Existing doi should be untouched
        assert_eq!(parsed[0].doi, Some("10.1/existing".to_string()));

        // Append reference entries
        let ref_entries = vec![
            make_entry(|e| {
                e.key = "ref1".to_string();
                e.title = "Reference Paper 1".to_string();
                e.doi = Some("10.1/ref1".to_string());
            }),
            make_entry(|e| {
                e.key = "ref2".to_string();
                e.title = "Reference Paper 2".to_string();
                e.doi = None;
            }),
        ];

        let outcomes = append_entries_to_file(&ref_entries, &bib_path, dir.path(), &cache).unwrap();
        assert_eq!(outcomes.len(), 2);

        let final_content = fs::read_to_string(&bib_path).unwrap();
        let final_parsed = crate::bib::parser::parse_bibtex(&final_content);
        assert_eq!(final_parsed.len(), 3);
    }

    // ── idempotent update should report no fields added ────────────

    #[test]
    fn update_noop_fields_added_empty_in_pipeline() {
        let dir = TempDir::new().unwrap();
        let bib_path = dir.path().join("refs.bib");
        let content = "@article{smith2024,\n  author = {Smith, John},\n  title = {Alpha},\n  year = {2024},\n  doi = {10.1/x},\n}\n";
        fs::write(&bib_path, content).unwrap();
        let cache = BibCache::new();

        let existing = make_entry(|e| {
            e.doi = None; // simulate stale parse missing the doi
        });
        let crossref = make_entry(|e| {
            e.doi = Some("10.1/x".to_string());
        });

        let new_fields = merge_enrichment_fields(&existing, Some(&crossref), None);
        assert!(!new_fields.is_empty(), "merge should propose doi");

        let mut fields_added: Vec<String> = new_fields.keys().cloned().collect();
        assert!(!fields_added.is_empty(), "fields_added should be non-empty before write");

        let modified = update_entry_fields(&bib_path, "smith2024", &new_fields, &cache).unwrap();
        assert!(!modified, "update_entry_fields should return false for idempotent write");

        if !modified {
            fields_added.clear();
        }

        assert!(fields_added.is_empty(), "fields_added should be empty when update was a no-op");
    }

    #[test]
    fn update_modified_fields_added_nonempty_in_pipeline() {
        let dir = TempDir::new().unwrap();
        let bib_path = dir.path().join("refs.bib");
        let content = "@article{smith2024,\n  author = {Smith, John},\n  title = {Alpha},\n  year = {2024}\n}\n";
        fs::write(&bib_path, content).unwrap();
        let cache = BibCache::new();

        let existing = make_entry(|e| {
            e.doi = None;
        });
        let crossref = make_entry(|e| {
            e.doi = Some("10.1/x".to_string());
        });

        let new_fields = merge_enrichment_fields(&existing, Some(&crossref), None);
        assert!(!new_fields.is_empty(), "merge should propose doi");

        let mut fields_added: Vec<String> = new_fields.keys().cloned().collect();
        assert!(!fields_added.is_empty());

        let modified = update_entry_fields(&bib_path, "smith2024", &new_fields, &cache).unwrap();
        assert!(modified, "update_entry_fields should return true when fields are actually added");

        if !modified {
            fields_added.clear();
        }

        assert!(!fields_added.is_empty(), "fields_added should still contain the added field");
        assert!(fields_added.contains(&"doi".to_string()));
    }
}
