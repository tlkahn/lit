use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::Manager;

use crate::bib::research_hub::{
    build_config, create_enabled_providers, legal_provider_ids, legal_provider_info,
    paper_to_bib_entry_with_pdf, ProviderInfo,
};
use crate::bib::types::BibEntry;
use crate::commands::credential::CredentialStore;

static CLIENT: std::sync::LazyLock<reqwest::Client> =
    std::sync::LazyLock::new(reqwest::Client::new);

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PaperSearchResult {
    pub entries: Vec<BibEntry>,
    pub pdf_urls: HashMap<String, String>,
    pub total_results: usize,
    pub providers_searched: Vec<String>,
    pub providers_failed: Vec<String>,
}

pub(crate) fn convert_search_result(
    search_result: &research_hub::SearchResult,
) -> PaperSearchResult {
    let mut entries = Vec::with_capacity(search_result.papers.len());
    let mut pdf_urls = HashMap::new();
    let mut existing_keys = HashSet::new();

    for paper in &search_result.papers {
        let (entry, pdf_url) = paper_to_bib_entry_with_pdf(paper, &existing_keys);
        existing_keys.insert(entry.key.clone());

        if let Some(url) = pdf_url {
            pdf_urls.insert(entry.key.clone(), url);
        }

        entries.push(entry);
    }

    PaperSearchResult {
        entries,
        pdf_urls,
        total_results: search_result.total_results,
        providers_searched: search_result.providers_searched.clone(),
        providers_failed: search_result.providers_failed.clone(),
    }
}

#[tauri::command]
pub fn list_search_providers() -> Vec<ProviderInfo> {
    legal_provider_info()
}

#[tauri::command]
pub async fn search_papers(
    query: String,
    limit: Option<usize>,
    offset: Option<usize>,
    app_handle: tauri::AppHandle,
) -> Result<PaperSearchResult, String> {
    let prefs = crate::preferences::read_preferences(&app_handle);

    let store = app_handle.state::<Arc<dyn CredentialStore>>();
    let config = build_config(&prefs, store.as_ref());

    let enabled: HashSet<String> = prefs
        .extra
        .get("search.enabledProviders")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str())
                .map(String::from)
                .collect()
        })
        .unwrap_or_else(|| {
            legal_provider_ids().into_iter().collect()
        });

    let client = CLIENT.clone();
    let config = Arc::new(config);
    let providers = create_enabled_providers(client, config.clone(), &enabled);

    if providers.is_empty() {
        return Ok(PaperSearchResult {
            entries: vec![],
            pdf_urls: HashMap::new(),
            total_results: 0,
            providers_searched: vec![],
            providers_failed: vec![],
        });
    }

    let result = research_hub::meta_search(
        &query,
        &providers,
        &config,
        None,
        limit.unwrap_or(20),
        offset.unwrap_or(0),
        research_hub::SortOrder::Relevance,
    )
    .await;

    Ok(convert_search_result(&result))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_paper(overrides: impl FnOnce(&mut research_hub::Paper)) -> research_hub::Paper {
        let mut p = research_hub::Paper::default();
        overrides(&mut p);
        p
    }

    fn make_search_result(
        papers: Vec<research_hub::Paper>,
        searched: Vec<&str>,
        failed: Vec<&str>,
    ) -> research_hub::SearchResult {
        let total_results = papers.len();
        research_hub::SearchResult {
            query: "test".to_string(),
            search_type: "KEYWORDS".to_string(),
            papers,
            total_results,
            offset: 0,
            sort: "relevance".to_string(),
            total_hits: None,
            provider_hits: vec![],
            providers_searched: searched.into_iter().map(String::from).collect(),
            providers_failed: failed.into_iter().map(String::from).collect(),
        }
    }

    // ── Test 1: Empty SearchResult ──────────────────────────────────

    #[test]
    fn convert_empty_search_result() {
        let sr = make_search_result(vec![], vec!["openalex"], vec![]);
        let result = convert_search_result(&sr);

        assert!(result.entries.is_empty());
        assert!(result.pdf_urls.is_empty());
        assert_eq!(result.total_results, 0);
        assert_eq!(result.providers_searched, vec!["openalex"]);
        assert!(result.providers_failed.is_empty());
    }

    // ── Test 2: Single paper without PDF ────────────────────────────

    #[test]
    fn convert_single_paper_no_pdf() {
        let paper = make_paper(|p| {
            p.title = "A Great Paper".to_string();
            p.authors = vec!["Smith, John".to_string()];
            p.year = Some(2024);
            p.doi = Some("10.1234/test".to_string());
            p.source = "crossref".to_string();
        });

        let sr = make_search_result(vec![paper], vec!["crossref"], vec![]);
        let result = convert_search_result(&sr);

        assert_eq!(result.entries.len(), 1);
        assert_eq!(result.entries[0].title, "A Great Paper");
        assert_eq!(result.entries[0].doi, Some("10.1234/test".to_string()));
        assert!(result.pdf_urls.is_empty());
        assert_eq!(result.total_results, 1);
    }

    // ── Test 3: Single paper with PDF and DOI ───────────────────────

    #[test]
    fn convert_single_paper_with_pdf() {
        let paper = make_paper(|p| {
            p.title = "A Great Paper".to_string();
            p.authors = vec!["Smith, John".to_string()];
            p.year = Some(2024);
            p.doi = Some("10.1234/test".to_string());
            p.pdf_url = Some("https://example.com/paper.pdf".to_string());
            p.source = "crossref".to_string();
        });

        let sr = make_search_result(vec![paper], vec!["crossref"], vec![]);
        let result = convert_search_result(&sr);

        assert_eq!(result.entries.len(), 1);
        assert_eq!(
            result.pdf_urls.get("smith2024"),
            Some(&"https://example.com/paper.pdf".to_string())
        );
    }

    // ── Test 4: PDF URL without DOI is not stored ───────────────────

    #[test]
    fn convert_pdf_url_without_doi_still_stored() {
        let paper = make_paper(|p| {
            p.title = "No DOI Paper".to_string();
            p.pdf_url = Some("https://example.com/paper.pdf".to_string());
        });

        let sr = make_search_result(vec![paper], vec!["openalex"], vec![]);
        let result = convert_search_result(&sr);

        assert_eq!(result.entries.len(), 1);
        assert_eq!(result.pdf_urls.len(), 1);
        assert_eq!(
            result.pdf_urls.get(&result.entries[0].key),
            Some(&"https://example.com/paper.pdf".to_string())
        );
    }

    // ── Test 5: Multiple papers with key deduplication ──────────────

    #[test]
    fn convert_multiple_papers_dedup_keys() {
        let paper1 = make_paper(|p| {
            p.title = "Paper One".to_string();
            p.authors = vec!["Smith, John".to_string()];
            p.year = Some(2024);
            p.source = "openalex".to_string();
        });
        let paper2 = make_paper(|p| {
            p.title = "Paper Two".to_string();
            p.authors = vec!["Smith, John".to_string()];
            p.year = Some(2024);
            p.source = "crossref".to_string();
        });

        let sr = make_search_result(vec![paper1, paper2], vec!["openalex", "crossref"], vec![]);
        let result = convert_search_result(&sr);

        assert_eq!(result.entries.len(), 2);
        assert_ne!(result.entries[0].key, result.entries[1].key);
        // First gets "smith2024", second gets "smith2024a"
        assert_eq!(result.entries[0].key, "smith2024");
        assert_eq!(result.entries[1].key, "smith2024a");
    }

    // ── Test 6: providers_searched and providers_failed propagated ──

    #[test]
    fn convert_preserves_providers_lists() {
        let sr = make_search_result(
            vec![],
            vec!["openalex", "crossref"],
            vec!["pubmed", "core"],
        );
        // Override total_results to test independent propagation
        let sr = research_hub::SearchResult {
            total_results: 42,
            ..sr
        };
        let result = convert_search_result(&sr);

        assert_eq!(result.providers_searched, vec!["openalex", "crossref"]);
        assert_eq!(result.providers_failed, vec!["pubmed", "core"]);
    }

    // ── Test 7: total_results forwarded from SearchResult ──────────

    #[test]
    fn convert_total_results_matches() {
        let sr = research_hub::SearchResult {
            query: "test".to_string(),
            search_type: "KEYWORDS".to_string(),
            papers: vec![],
            total_results: 999,
            offset: 0,
            sort: "relevance".to_string(),
            total_hits: Some(5000),
            provider_hits: vec![],
            providers_searched: vec!["openalex".to_string()],
            providers_failed: vec![],
        };

        let result = convert_search_result(&sr);
        assert_eq!(result.total_results, 999);
    }

    // ── Test 8: Multiple papers with PDFs — only those with DOIs stored ──

    #[test]
    fn convert_mixed_doi_pdf_papers() {
        let paper1 = make_paper(|p| {
            p.title = "Has Both".to_string();
            p.authors = vec!["Alpha, A".to_string()];
            p.year = Some(2023);
            p.doi = Some("10.1111/aaa".to_string());
            p.pdf_url = Some("https://example.com/a.pdf".to_string());
            p.source = "openalex".to_string();
        });
        let paper2 = make_paper(|p| {
            p.title = "Has PDF no DOI".to_string();
            p.authors = vec!["Beta, B".to_string()];
            p.year = Some(2023);
            p.pdf_url = Some("https://example.com/b.pdf".to_string());
            p.source = "arxiv".to_string();
        });
        let paper3 = make_paper(|p| {
            p.title = "Has DOI no PDF".to_string();
            p.authors = vec!["Gamma, G".to_string()];
            p.year = Some(2023);
            p.doi = Some("10.2222/bbb".to_string());
            p.source = "crossref".to_string();
        });

        let sr = make_search_result(
            vec![paper1, paper2, paper3],
            vec!["openalex", "arxiv", "crossref"],
            vec![],
        );
        let result = convert_search_result(&sr);

        assert_eq!(result.entries.len(), 3);
        // paper1 and paper2 both have PDF URLs (keyed by cite key)
        assert_eq!(result.pdf_urls.len(), 2);
        assert_eq!(
            result.pdf_urls.get("alpha2023"),
            Some(&"https://example.com/a.pdf".to_string())
        );
        assert_eq!(
            result.pdf_urls.get("beta2023"),
            Some(&"https://example.com/b.pdf".to_string())
        );
    }

    // ── Test 9: New paper fields flow through conversion ───────────

    #[test]
    fn convert_paper_with_new_fields() {
        let paper = make_paper(|p| {
            p.title = "A Book Chapter".to_string();
            p.authors = vec!["Author, A".to_string()];
            p.year = Some(2024);
            p.source = "crossref".to_string();
            p.publisher = Some("Springer".to_string());
            p.isbn = Some("978-3-030-12345-6".to_string());
            p.issn = Some("1234-5678".to_string());
            p.arxiv_id = Some("2301.00001".to_string());
            p.work_type = Some("book-chapter".to_string());
        });

        let sr = make_search_result(vec![paper], vec!["crossref"], vec![]);
        let result = convert_search_result(&sr);

        assert_eq!(result.entries.len(), 1);
        let e = &result.entries[0];
        assert_eq!(e.entry_type, "incollection");
        assert_eq!(e.publisher, Some("Springer".to_string()));
        assert_eq!(e.isbn, Some("978-3-030-12345-6".to_string()));
        assert_eq!(e.issn, Some("1234-5678".to_string()));
        assert_eq!(e.arxiv_id, Some("2301.00001".to_string()));
    }
}
