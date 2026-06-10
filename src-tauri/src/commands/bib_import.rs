use std::path::Path;
use std::sync::LazyLock;

use serde::Deserialize;

use crate::bib::cache::BibCache;
use crate::bib::convert::{csl_to_bib_entry, is_valid_doi, normalize_doi, CslItem};
use crate::bib::types::BibEntry;
use crate::bib::writer::{append_entries_to_file, SaveOutcome};
use crate::commands::bib::scan_workspace_bib_paths;

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

fn list_bib_files_inner(workspace_path: &Path) -> Vec<String> {
    scan_workspace_bib_paths(workspace_path)
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

#[tauri::command]
pub async fn lookup_doi(doi: String) -> Result<BibEntry, String> {
    let normalized = normalize_doi(&doi);
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
pub fn save_bib_entry(
    entry: BibEntry,
    bib_path: String,
    workspace_path: String,
    cache: tauri::State<BibCache>,
) -> Result<Vec<SaveOutcome>, String> {
    append_entries_to_file(
        &[entry],
        Path::new(&bib_path),
        Path::new(&workspace_path),
        &cache,
    )
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
    bib_path: String,
    workspace_path: String,
    cache: tauri::State<BibCache>,
) -> Result<Vec<SaveOutcome>, String> {
    append_entries_to_file(
        &entries,
        Path::new(&bib_path),
        Path::new(&workspace_path),
        &cache,
    )
}

#[tauri::command]
pub fn list_bib_files(
    workspace_path: String,
    _cache: tauri::State<BibCache>,
) -> Vec<String> {
    list_bib_files_inner(Path::new(&workspace_path))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::bib::cache::BibCache;
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
                "subject": ["Physics", "Quantum"]
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

    // ── Group 3: list_bib_files_inner ───────────────────────────────

    #[test]
    fn list_bib_files_empty_workspace() {
        let dir = TempDir::new().unwrap();
        let files = list_bib_files_inner(dir.path());
        assert!(files.is_empty());
    }

    #[test]
    fn list_bib_files_finds_all_bib_files() {
        let dir = TempDir::new().unwrap();
        fs::write(
            dir.path().join("root.bib"),
            "@article{a,\n  author = {A},\n  title = {A},\n  year = {2020}\n}",
        )
        .unwrap();
        let sub = dir.path().join("papers");
        fs::create_dir(&sub).unwrap();
        fs::write(
            sub.join("nested.bib"),
            "@book{b,\n  author = {B},\n  title = {B},\n  year = {2021}\n}",
        )
        .unwrap();
        let files = list_bib_files_inner(dir.path());
        assert_eq!(files.len(), 2);
        assert!(files.iter().any(|f| f.ends_with("root.bib")));
        assert!(files.iter().any(|f| f.ends_with("nested.bib")));
    }

    #[test]
    fn list_bib_files_deduplicates() {
        let dir = TempDir::new().unwrap();
        // File with two entries -- should still yield one unique path
        fs::write(
            dir.path().join("refs.bib"),
            "@article{a,\n  author={A},\n  title={A},\n  year={2020}\n}\n\n@book{b,\n  author={B},\n  title={B},\n  year={2021}\n}",
        )
        .unwrap();
        let files = list_bib_files_inner(dir.path());
        assert_eq!(files.len(), 1);
    }

    #[test]
    fn list_bib_files_skips_hidden_dirs() {
        let dir = TempDir::new().unwrap();
        let hidden = dir.path().join(".obsidian");
        fs::create_dir(&hidden).unwrap();
        fs::write(
            hidden.join("hidden.bib"),
            "@article{h,\n  author={H},\n  title={H},\n  year={2020}\n}",
        )
        .unwrap();
        fs::write(
            dir.path().join("visible.bib"),
            "@article{v,\n  author={V},\n  title={V},\n  year={2020}\n}",
        )
        .unwrap();
        let files = list_bib_files_inner(dir.path());
        assert_eq!(files.len(), 1);
        assert!(files[0].ends_with("visible.bib"));
    }

    // ── Group 4: save_bib_entry (via append_entries_to_file) ────────

    #[test]
    fn save_bib_entry_new_file() {
        let dir = TempDir::new().unwrap();
        let bib_path = dir.path().join("refs.bib");
        let cache = BibCache::new();
        let entry = BibEntry {
            key: "smith2020".to_string(),
            authors: vec!["Smith, John".to_string()],
            title: "Test Paper".to_string(),
            year: "2020".to_string(),
            entry_type: "article".to_string(),
            line_number: 0,
            bib_file: None,
            abstract_text: None,
            doi: Some("10.1000/test".to_string()),
            journal: None,
            url: None,
            volume: None,
            number: None,
            pages: None,
            publisher: None,
            issn: None,
            tags: vec![],
        };
        let results = append_entries_to_file(
            &[entry],
            &bib_path,
            dir.path(),
            &cache,
        )
        .unwrap();
        assert_eq!(results.len(), 1);
        assert!(matches!(&results[0], SaveOutcome::Saved { .. }));
        assert!(bib_path.exists());
    }

    #[test]
    fn save_bib_entry_appends_to_existing() {
        let dir = TempDir::new().unwrap();
        let bib_path = dir.path().join("refs.bib");
        fs::write(
            &bib_path,
            "@article{doe2019,\n  author = {Doe, Jane},\n  title = {Existing},\n  year = {2019}\n}",
        )
        .unwrap();
        let cache = BibCache::new();
        let entry = BibEntry {
            key: "smith2020".to_string(),
            authors: vec!["Smith, John".to_string()],
            title: "New Paper".to_string(),
            year: "2020".to_string(),
            entry_type: "article".to_string(),
            line_number: 0,
            bib_file: None,
            abstract_text: None,
            doi: Some("10.1000/new".to_string()),
            journal: None,
            url: None,
            volume: None,
            number: None,
            pages: None,
            publisher: None,
            issn: None,
            tags: vec![],
        };
        let results = append_entries_to_file(
            &[entry],
            &bib_path,
            dir.path(),
            &cache,
        )
        .unwrap();
        assert_eq!(results.len(), 1);
        assert!(matches!(&results[0], SaveOutcome::Saved { .. }));
        let content = fs::read_to_string(&bib_path).unwrap();
        let parsed = crate::bib::parser::parse_bibtex(&content);
        assert_eq!(parsed.len(), 2);
    }

    #[test]
    fn save_bib_entry_deduplicates_by_doi() {
        let dir = TempDir::new().unwrap();
        let bib_path = dir.path().join("refs.bib");
        fs::write(
            &bib_path,
            "@article{doe2019,\n  author = {Doe},\n  title = {X},\n  year = {2019},\n  doi = {10.1000/dup}\n}",
        )
        .unwrap();
        let cache = BibCache::new();
        let entry = BibEntry {
            key: "smith2020".to_string(),
            authors: vec!["Smith, John".to_string()],
            title: "Dup Paper".to_string(),
            year: "2020".to_string(),
            entry_type: "article".to_string(),
            line_number: 0,
            bib_file: None,
            abstract_text: None,
            doi: Some("10.1000/dup".to_string()),
            journal: None,
            url: None,
            volume: None,
            number: None,
            pages: None,
            publisher: None,
            issn: None,
            tags: vec![],
        };
        let results = append_entries_to_file(
            &[entry],
            &bib_path,
            dir.path(),
            &cache,
        )
        .unwrap();
        assert_eq!(results.len(), 1);
        assert!(matches!(&results[0], SaveOutcome::DuplicateDoi { .. }));
    }

    // ── Group 5: save_bib_entries (parse + append) ───────────────────

    #[test]
    fn save_bib_entries_multiple_entries() {
        let dir = TempDir::new().unwrap();
        let bib_path = dir.path().join("refs.bib");
        let cache = BibCache::new();
        let json = r#"[
            {"type": "article-journal", "title": "A", "author": [{"family": "A", "given": "A"}], "issued": {"date-parts": [[2020]]}, "DOI": "10.1000/a"},
            {"type": "book", "title": "B", "author": [{"family": "B", "given": "B"}], "issued": {"date-parts": [[2021]]}, "DOI": "10.1000/b"},
            {"type": "article-journal", "title": "C", "author": [{"family": "C", "given": "C"}], "issued": {"date-parts": [[2022]]}, "DOI": "10.1000/c"}
        ]"#;
        let entries = parse_csl_json_inner(json).unwrap();
        let results = append_entries_to_file(
            &entries,
            &bib_path,
            dir.path(),
            &cache,
        )
        .unwrap();
        assert_eq!(results.len(), 3);
        assert!(bib_path.exists());
        let content = fs::read_to_string(&bib_path).unwrap();
        let parsed = crate::bib::parser::parse_bibtex(&content);
        assert_eq!(parsed.len(), 3);
    }

    #[test]
    fn save_bib_entries_mixed_outcomes() {
        let dir = TempDir::new().unwrap();
        let bib_path = dir.path().join("refs.bib");
        fs::write(
            &bib_path,
            "@article{old,\n  author = {Old},\n  title = {Old},\n  year = {2019},\n  doi = {10.1000/dup}\n}",
        )
        .unwrap();
        let cache = BibCache::new();
        let json = r#"[
            {"title": "Dup", "DOI": "10.1000/dup"},
            {"title": "New", "DOI": "10.1000/new"}
        ]"#;
        let entries = parse_csl_json_inner(json).unwrap();
        let results = append_entries_to_file(
            &entries,
            &bib_path,
            dir.path(),
            &cache,
        )
        .unwrap();
        assert_eq!(results.len(), 2);
        assert!(matches!(&results[0], SaveOutcome::DuplicateDoi { .. }));
        assert!(matches!(&results[1], SaveOutcome::Saved { .. }));
    }

    #[test]
    fn save_bib_entries_invalid_json() {
        let result = parse_csl_json_inner("not valid json");
        assert!(result.is_err());
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
}
