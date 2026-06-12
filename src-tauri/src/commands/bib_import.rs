use std::path::PathBuf;
use std::sync::{Arc, LazyLock};

use serde::Deserialize;
use crate::bib::convert::{csl_to_bib_entry, is_valid_doi, normalize_doi, CslItem};
use crate::bib::db::{all_live_keys, upsert_bib_item, UpsertOutcome};
use crate::bib::types::BibEntry;
use crate::bib::writer::{generate_key, SaveOutcome};
use crate::commands::graph::GraphRegistry;
use crate::commands::page::lookup_graph_index;

/// Wrapper for the Crossref API JSON envelope.
#[derive(Deserialize)]
struct CrossrefResponse {
    message: CslItem,
}

/// Parse the raw Crossref API JSON response body into a BibEntry.
/// Extracted as a pure function so it can be unit-tested without network calls.
pub fn parse_crossref_body(body: &str) -> Result<BibEntry, String> {
    let resp: CrossrefResponse = serde_json::from_str(body)
        .map_err(|e| format!("Failed to parse Crossref response: {}", e))?;
    Ok(csl_to_bib_entry(&resp.message))
}

/// Parse a CSL-JSON string (array or single item) into BibEntries.
fn parse_csl_json_inner(json_str: &str) -> Result<Vec<BibEntry>, String> {
    // Try array first (standard CSL-JSON export)
    if let Ok(items) = serde_json::from_str::<Vec<CslItem>>(json_str) {
        return Ok(items.iter().map(|item| csl_to_bib_entry(item)).collect());
    }
    // Fall back to single item (Zotero sometimes exports a single object)
    if let Ok(item) = serde_json::from_str::<CslItem>(json_str) {
        return Ok(vec![csl_to_bib_entry(&item)]);
    }
    Err("Failed to parse CSL-JSON: expected an array or single CSL-JSON item".to_string())
}

// ── Tauri commands ──────────────────────────────────────────────────

pub(crate) static HTTP_CLIENT: LazyLock<reqwest::Client> = LazyLock::new(|| {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .user_agent(format!(
            "lit/{} (https://github.com/tlkahn/lit)",
            env!("LIT_GIT_VERSION")
        ))
        .build()
        .expect("failed to build reqwest client")
});

pub(crate) async fn fetch_crossref_by_doi(doi: &str) -> Result<BibEntry, String> {
    let normalized = normalize_doi(doi);
    if !is_valid_doi(&normalized) {
        return Err(format!("Invalid DOI format: {}", doi));
    }

    let url = format!("https://api.crossref.org/works/{}", normalized);
    let response = HTTP_CLIENT
        .get(&url)
        .send()
        .await
        .map_err(|e| {
            if e.is_timeout() {
                "Request timed out".to_string()
            } else {
                format!("HTTP request failed: {}", e)
            }
        })?;

    let status = response.status();
    if status == reqwest::StatusCode::NOT_FOUND {
        return Err(format!("DOI not found: {}", normalized));
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

#[tauri::command]
pub async fn lookup_doi(doi: String) -> Result<BibEntry, String> {
    fetch_crossref_by_doi(&doi).await
}

#[tauri::command]
pub fn save_bib_entry(
    mut entry: BibEntry,
    workspace_path: String,
    graph_state: tauri::State<Arc<GraphRegistry>>,
    app_handle: tauri::AppHandle,
) -> Result<Vec<SaveOutcome>, String> {
    let workspace_root = PathBuf::from(&workspace_path);

    let gi = lookup_graph_index(&graph_state, &workspace_root)
        .ok_or_else(|| "Graph index not ready".to_string())?;
    let outcome = {
        let store = gi.store();
        let live_keys = all_live_keys(&store.conn).map_err(|e| e.to_string())?;
        let generated_key = generate_key(&entry.authors, &entry.year, &live_keys);
        entry.key = generated_key;
        let upsert_result = upsert_bib_item(&store.conn, &entry, None, None, false)
            .map_err(|e| e.to_string())?;
        match upsert_result {
            UpsertOutcome::Inserted { cite_key } | UpsertOutcome::Updated { cite_key } => {
                if entry.doi.is_some() {
                    SaveOutcome::Saved { key: cite_key }
                } else {
                    SaveOutcome::SavedNoDoi { key: cite_key }
                }
            }
            UpsertOutcome::DedupSkipped { existing_key } => {
                let doi = entry.doi.clone().unwrap_or_default();
                SaveOutcome::DuplicateDoi { doi, existing_key }
            }
        }
    };

    crate::commands::graph::notify_bib_changed(&graph_state, &workspace_root, &app_handle);
    Ok(vec![outcome])
}

fn read_csl_file(json_path: &str) -> Result<String, String> {
    std::fs::read_to_string(json_path)
        .map_err(|e| format!("Failed to read {}: {}", json_path, e))
}

#[tauri::command]
pub fn parse_csl_json(json_path: String) -> Result<Vec<BibEntry>, String> {
    parse_csl_json_inner(&read_csl_file(&json_path)?)
}

#[tauri::command]
pub fn save_bib_entries(
    entries: Vec<BibEntry>,
    workspace_path: String,
    graph_state: tauri::State<Arc<GraphRegistry>>,
    app_handle: tauri::AppHandle,
) -> Result<Vec<SaveOutcome>, String> {
    let workspace_root = PathBuf::from(&workspace_path);

    let gi = lookup_graph_index(&graph_state, &workspace_root)
        .ok_or_else(|| "Graph index not ready".to_string())?;
    let outcomes = {
        let store = gi.store();
        let mut results = Vec::with_capacity(entries.len());
        for mut entry in entries {
            let live_keys = all_live_keys(&store.conn).map_err(|e| e.to_string())?;
            let generated_key = generate_key(&entry.authors, &entry.year, &live_keys);
            entry.key = generated_key;
            let upsert_result = upsert_bib_item(&store.conn, &entry, None, None, false)
                .map_err(|e| e.to_string())?;
            let outcome = match upsert_result {
                UpsertOutcome::Inserted { cite_key } | UpsertOutcome::Updated { cite_key } => {
                    if entry.doi.is_some() {
                        SaveOutcome::Saved { key: cite_key }
                    } else {
                        SaveOutcome::SavedNoDoi { key: cite_key }
                    }
                }
                UpsertOutcome::DedupSkipped { existing_key } => {
                    let doi = entry.doi.clone().unwrap_or_default();
                    SaveOutcome::DuplicateDoi { doi, existing_key }
                }
            };
            results.push(outcome);
        }
        results
    };

    crate::commands::graph::notify_bib_changed(&graph_state, &workspace_root, &app_handle);
    Ok(outcomes)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    // ── Group 1: parse_crossref_body (pure, no network) ─────────────

    #[test]
    fn parse_crossref_body_full_response() {
        let body = r#"{
            "status": "ok",
            "message-type": "work",
            "message": {
                "type": "journal-article",
                "title": ["Probing condensed matter physics"],
                "author": [
                    {"family": "Kucsko", "given": "Georg"},
                    {"family": "Maurer", "given": "Peter C."}
                ],
                "container-title": ["Nature"],
                "issued": {"date-parts": [[2013, 7, 31]]},
                "DOI": "10.1038/nature12373",
                "URL": "https://doi.org/10.1038/nature12373",
                "abstract": "<jats:p>Summary of the paper</jats:p>",
                "subject": ["Physics", "Quantum"],
                "volume": "500",
                "issue": "7460",
                "page": "54-58",
                "publisher": "Springer Science and Business Media LLC",
                "ISSN": ["0028-0836", "1476-4687"]
            }
        }"#;
        let entry = parse_crossref_body(body).unwrap();
        assert_eq!(entry.key, "kucsko2013");
        assert_eq!(entry.entry_type, "article");
        assert_eq!(entry.authors, vec!["Kucsko, Georg", "Maurer, Peter C."]);
        assert_eq!(entry.title, "Probing condensed matter physics");
        assert_eq!(entry.year, "2013");
        assert_eq!(entry.journal, Some("Nature".to_string()));
        assert_eq!(entry.doi, Some("10.1038/nature12373".to_string()));
        assert_eq!(
            entry.url,
            Some("https://doi.org/10.1038/nature12373".to_string())
        );
        assert_eq!(
            entry.abstract_text,
            Some("Summary of the paper".to_string())
        );
        assert_eq!(entry.tags, vec!["Physics", "Quantum"]);
        assert_eq!(entry.volume, Some("500".to_string()));
        assert_eq!(entry.number, Some("7460".to_string()));
        assert_eq!(entry.pages, Some("54-58".to_string()));
        assert_eq!(entry.publisher, Some("Springer Science and Business Media LLC".to_string()));
        assert_eq!(entry.issn, Some("0028-0836".to_string()));
    }

    #[test]
    fn parse_crossref_body_minimal_response() {
        let body = r#"{"status":"ok","message":{"title":["Minimal"]}}"#;
        let entry = parse_crossref_body(body).unwrap();
        assert_eq!(entry.title, "Minimal");
        assert!(entry.authors.is_empty());
        assert_eq!(entry.year, "");
        assert_eq!(entry.entry_type, "misc");
        assert_eq!(entry.doi, None);
        assert_eq!(entry.journal, None);
        assert_eq!(entry.url, None);
        assert_eq!(entry.abstract_text, None);
        assert!(entry.tags.is_empty());
    }

    #[test]
    fn parse_crossref_body_invalid_json() {
        let result = parse_crossref_body("not json at all");
        assert!(result.is_err());
    }

    #[test]
    fn parse_crossref_body_missing_message_field() {
        let body = r#"{"status":"ok"}"#;
        let result = parse_crossref_body(body);
        assert!(result.is_err());
    }

    #[test]
    fn parse_crossref_body_strips_jats_from_title_and_abstract() {
        let body = r#"{
            "message": {
                "title": ["<jats:p>Tagged Title</jats:p>"],
                "abstract": "<jats:p>Tagged <jats:italic>Abstract</jats:italic></jats:p>"
            }
        }"#;
        let entry = parse_crossref_body(body).unwrap();
        assert_eq!(entry.title, "Tagged Title");
        assert_eq!(entry.abstract_text, Some("Tagged Abstract".to_string()));
    }

    #[test]
    fn parse_crossref_body_normalizes_doi() {
        let body = r#"{
            "message": {
                "title": ["X"],
                "DOI": "https://doi.org/10.1038/nature12373"
            }
        }"#;
        let entry = parse_crossref_body(body).unwrap();
        assert_eq!(entry.doi, Some("10.1038/nature12373".to_string()));
    }

    // ── Group 2: parse_csl_json ─────────────────────────────────────

    #[test]
    fn parse_csl_json_array() {
        let json = r#"[
            {"type": "article-journal", "title": "First", "author": [{"family": "A", "given": "B"}], "issued": {"date-parts": [[2020]]}},
            {"type": "book", "title": "Second", "author": [{"family": "C", "given": "D"}], "issued": {"date-parts": [[2021]]}}
        ]"#;
        let entries = parse_csl_json_inner(json).unwrap();
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].title, "First");
        assert_eq!(entries[0].entry_type, "article");
        assert_eq!(entries[1].title, "Second");
        assert_eq!(entries[1].entry_type, "book");
    }

    #[test]
    fn parse_csl_json_single_item() {
        let json = r#"{"type": "article-journal", "title": "Solo", "author": [{"family": "Smith", "given": "J"}]}"#;
        let entries = parse_csl_json_inner(json).unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].title, "Solo");
    }

    #[test]
    fn parse_csl_json_empty_array() {
        let entries = parse_csl_json_inner("[]").unwrap();
        assert!(entries.is_empty());
    }

    #[test]
    fn parse_csl_json_invalid_json() {
        let result = parse_csl_json_inner("not json");
        assert!(result.is_err());
    }

    #[test]
    fn parse_csl_json_zotero_export() {
        let json = r#"[{
            "type": "article-journal",
            "title": "Zotero Paper",
            "author": [{"family": "Doe", "given": "Jane"}],
            "container-title": "Journal of Testing",
            "issued": {"date-parts": [[2022]]}
        }]"#;
        let entries = parse_csl_json_inner(json).unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].title, "Zotero Paper");
        assert_eq!(entries[0].entry_type, "article");
        assert_eq!(
            entries[0].journal,
            Some("Journal of Testing".to_string())
        );
    }

    #[test]
    fn read_csl_file_reads_from_path() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("export.json");
        fs::write(&path, r#"[{"type": "book", "title": "From Disk"}]"#).unwrap();
        let content = read_csl_file(path.to_str().unwrap()).unwrap();
        let entries = parse_csl_json_inner(&content).unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].title, "From Disk");
    }

    #[test]
    fn read_csl_file_missing_path() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("nope.json");
        let result = read_csl_file(path.to_str().unwrap());
        assert!(result.unwrap_err().contains("Failed to read"));
    }

    // ── Group 6: lookup_doi (validation only, no network) ───────────

    #[test]
    fn lookup_doi_invalid_format() {
        // We test the validation logic directly
        let doi = "not-a-doi";
        let normalized = normalize_doi(doi);
        assert!(!is_valid_doi(&normalized));
    }

    #[test]
    fn lookup_doi_normalizes_url_prefix() {
        let doi = "https://doi.org/10.1038/nature12373";
        let normalized = normalize_doi(doi);
        assert_eq!(normalized, "10.1038/nature12373");
        assert!(is_valid_doi(&normalized));
    }

    // ── Group 7: CrossRef body with volume/issue/page/publisher/ISSN ─

    #[test]
    fn parse_crossref_body_extracts_volume_issue_page_publisher_issn() {
        let body = r#"{
            "status": "ok",
            "message-type": "work",
            "message": {
                "type": "journal-article",
                "title": ["Probing condensed matter physics"],
                "author": [
                    {"family": "Kucsko", "given": "Georg"}
                ],
                "container-title": ["Nature"],
                "issued": {"date-parts": [[2013, 7, 31]]},
                "DOI": "10.1038/nature12373",
                "volume": "500",
                "issue": "7460",
                "page": "54-58",
                "publisher": "Springer Science and Business Media LLC",
                "ISSN": ["0028-0836", "1476-4687"]
            }
        }"#;
        let entry = parse_crossref_body(body).unwrap();
        assert_eq!(entry.volume, Some("500".to_string()));
        assert_eq!(entry.number, Some("7460".to_string()));
        assert_eq!(entry.pages, Some("54-58".to_string()));
        assert_eq!(entry.publisher, Some("Springer Science and Business Media LLC".to_string()));
        assert_eq!(entry.issn, Some("0028-0836".to_string()));
    }
}
