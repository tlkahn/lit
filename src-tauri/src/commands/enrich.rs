use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

use serde::Serialize;
use tauri::{Emitter, State};

use crate::bib::cache::BibCache;
use crate::bib::convert::normalize_doi;
use crate::bib::semantic_scholar::{
    lookup_by_doi as s2_lookup_by_doi, s2_paper_to_bib_entry, s2_ref_to_bib_entry,
    search_by_title, S2Paper,
};
use crate::bib::types::BibEntry;
use crate::bib::writer::{append_entries_to_file, update_entry_fields, SaveOutcome};
use crate::commands::bib::build_bib_index;
use crate::commands::bib_import::{parse_crossref_body, HTTP_CLIENT};
use crate::commands::graph::GraphRegistry;

const MAX_REFERENCES: usize = 30;

#[derive(Debug, Clone, Serialize)]
pub struct EnrichResult {
    pub entry: BibEntry,
    pub fields_added: Vec<String>,
    pub references_found: usize,
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
    let normalized = normalize_doi(doi);
    let url = format!("https://api.crossref.org/works/{}", normalized);
    let response = HTTP_CLIENT.get(&url).send().await.map_err(|e| {
        if e.is_timeout() {
            "Request timed out".to_string()
        } else {
            format!("HTTP request failed: {}", e)
        }
    })?;

    let status = response.status();
    if status == reqwest::StatusCode::NOT_FOUND {
        return Err(format!("DOI not found on Crossref: {}", normalized));
    }
    if status == reqwest::StatusCode::TOO_MANY_REQUESTS {
        return Err("Rate limited by Crossref API, please try again later".to_string());
    }
    if !status.is_success() {
        return Err(format!("Crossref API returned status {}", status));
    }

    let body = response
        .text()
        .await
        .map_err(|e| format!("Failed to read response body: {}", e))?;

    parse_crossref_body(&body)
}

async fn fetch_s2(
    doi: Option<&str>,
    title: &str,
) -> Result<(S2Paper, BibEntry), String> {
    let paper = if let Some(doi) = doi {
        match s2_lookup_by_doi(&HTTP_CLIENT, doi).await {
            Ok(p) => p,
            Err(_) => {
                let papers = search_by_title(&HTTP_CLIENT, title).await?;
                papers
                    .into_iter()
                    .next()
                    .ok_or_else(|| "No results found on Semantic Scholar".to_string())?
            }
        }
    } else {
        let papers = search_by_title(&HTTP_CLIENT, title).await?;
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
    let fields_added: Vec<String> = new_fields.keys().cloned().collect();

    // Update entry fields if any new fields were found
    if !new_fields.is_empty() {
        update_entry_fields(&bib_path, &bib_key, &new_fields, &cache)?;
    }

    // Append S2 references as minimal BibEntries
    let mut shadow_nodes_created: usize = 0;
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
    let graph_changed = {
        let indices = graph_state.indices.lock().unwrap();
        if let Some(gi) = indices.get(&root) {
            gi.refresh_shadows().unwrap_or(false)
        } else {
            false
        }
    };

    if graph_changed {
        let _ = app_handle.emit("lit:graph-updated", ());
    }

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
}
