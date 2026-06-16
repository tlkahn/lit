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
use crate::recognize::resolve::isbn::{self, IsbnPath};
use crate::recognize::resolve::BaseUrls;

static CLIENT: std::sync::LazyLock<reqwest::Client> =
    std::sync::LazyLock::new(reqwest::Client::new);

fn parse_search_type(s: &str) -> Result<Option<research_hub::SearchType>, String> {
    let trimmed = s.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }
    match trimmed.to_ascii_lowercase().as_str() {
        "doi" => Ok(Some(research_hub::SearchType::Doi)),
        "keywords" => Ok(Some(research_hub::SearchType::Keywords)),
        "author" => Ok(Some(research_hub::SearchType::Author)),
        "title" => Ok(Some(research_hub::SearchType::Title)),
        "isbn" => Ok(Some(research_hub::SearchType::Isbn)),
        _ => Err(format!("Unknown search type: \"{}\"", trimmed)),
    }
}

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
    legal_provider_info().to_vec()
}

#[tauri::command]
pub async fn search_papers(
    query: String,
    limit: Option<usize>,
    offset: Option<usize>,
    search_type: Option<String>,
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
            legal_provider_ids().iter().map(|s| s.to_string()).collect()
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

    let parsed_search_type = match search_type.as_deref() {
        Some(s) => parse_search_type(s)?,
        None => None,
    };

    let result = research_hub::meta_search(
        &query,
        &providers,
        &config,
        parsed_search_type,
        limit.unwrap_or(20),
        offset.unwrap_or(0),
        research_hub::SortOrder::Relevance,
    )
    .await;

    let mut psr = convert_search_result(&result);

    let urls = BaseUrls::production();
    if let Some((entry, isbn_path)) =
        try_isbn_fallback(&CLIENT, &query, &result, urls.open_library, urls.google_books).await
    {
        let provider_name = match isbn_path {
            IsbnPath::OpenLibrary => "open_library",
            IsbnPath::GoogleBooks => "google_books",
        };
        psr.providers_searched.push(provider_name.to_string());
        psr.entries = vec![entry];
        psr.total_results = 1;
    }

    Ok(psr)
}

async fn try_isbn_fallback(
    client: &reqwest::Client,
    query: &str,
    search_result: &research_hub::SearchResult,
    open_library_url: &str,
    google_books_url: &str,
) -> Option<(BibEntry, IsbnPath)> {
    if search_result.search_type != "ISBN" || !search_result.papers.is_empty() {
        return None;
    }

    let isbn: String = query.chars().filter(|c| c.is_ascii_digit() || *c == 'X' || *c == 'x').collect();
    match isbn::resolve_isbn_with_base(client, &isbn, open_library_url, google_books_url).await {
        Ok(result) => Some(result),
        Err(e) => {
            tracing::debug!(error = %e, "ISBN fallback resolution failed");
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use wiremock::matchers::{method, path, query_param};
    use wiremock::{Mock, MockServer, ResponseTemplate};

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

    // ── ISBN fallback tests ───────────────────────────────────────────

    fn make_isbn_search_result(
        search_type: &str,
        papers: Vec<research_hub::Paper>,
    ) -> research_hub::SearchResult {
        research_hub::SearchResult {
            query: "9780262035613".to_string(),
            search_type: search_type.to_string(),
            papers,
            total_results: 0,
            offset: 0,
            sort: "relevance".to_string(),
            total_hits: None,
            provider_hits: vec![],
            providers_searched: vec!["crossref".to_string()],
            providers_failed: vec![],
        }
    }

    #[tokio::test]
    async fn isbn_fallback_on_empty_crossref_result() {
        let ol_server = MockServer::start().await;
        let gb_server = MockServer::start().await;
        let client = reqwest::Client::new();

        let ol_json = r#"{
            "ISBN:9780262035613": {
                "title": "Deep Learning",
                "authors": [
                    {"name": "Ian Goodfellow"},
                    {"name": "Yoshua Bengio"},
                    {"name": "Aaron Courville"}
                ],
                "publishers": [{"name": "MIT Press"}],
                "publish_date": "2016",
                "identifiers": {
                    "isbn_13": ["9780262035613"]
                }
            }
        }"#;

        Mock::given(method("GET"))
            .and(path("/api/books"))
            .and(query_param("bibkeys", "ISBN:9780262035613"))
            .respond_with(ResponseTemplate::new(200).set_body_string(ol_json))
            .mount(&ol_server)
            .await;

        let sr = make_isbn_search_result("ISBN", vec![]);

        let result = try_isbn_fallback(
            &client,
            "9780262035613",
            &sr,
            &ol_server.uri(),
            &gb_server.uri(),
        )
        .await;

        let (entry, isbn_path) = result.expect("fallback should return a result");
        assert_eq!(isbn_path, IsbnPath::OpenLibrary);
        assert_eq!(entry.title, "Deep Learning");
        assert_eq!(entry.isbn, Some("9780262035613".to_string()));
    }

    #[tokio::test]
    async fn isbn_fallback_with_spaced_isbn() {
        let ol_server = MockServer::start().await;
        let gb_server = MockServer::start().await;
        let client = reqwest::Client::new();

        let ol_json = r#"{
            "ISBN:9780262035613": {
                "title": "Deep Learning",
                "authors": [
                    {"name": "Ian Goodfellow"},
                    {"name": "Yoshua Bengio"},
                    {"name": "Aaron Courville"}
                ],
                "publishers": [{"name": "MIT Press"}],
                "publish_date": "2016",
                "identifiers": {
                    "isbn_13": ["9780262035613"]
                }
            }
        }"#;

        Mock::given(method("GET"))
            .and(path("/api/books"))
            .and(query_param("bibkeys", "ISBN:9780262035613"))
            .respond_with(ResponseTemplate::new(200).set_body_string(ol_json))
            .mount(&ol_server)
            .await;

        let sr = make_isbn_search_result("ISBN", vec![]);

        let result = try_isbn_fallback(
            &client,
            "978 0262035613",
            &sr,
            &ol_server.uri(),
            &gb_server.uri(),
        )
        .await;

        let (entry, _) = result.expect("fallback should resolve spaced ISBN");
        assert_eq!(entry.title, "Deep Learning");
    }

    #[tokio::test]
    async fn isbn_fallback_skipped_for_keywords() {
        let client = reqwest::Client::new();
        let sr = make_isbn_search_result("KEYWORDS", vec![]);

        let result = try_isbn_fallback(
            &client,
            "deep learning",
            &sr,
            "http://localhost:1",
            "http://localhost:1",
        )
        .await;

        assert!(result.is_none(), "fallback should be skipped for keyword searches");
    }

    #[tokio::test]
    async fn isbn_fallback_skipped_when_papers_present() {
        let client = reqwest::Client::new();
        let paper = make_paper(|p| {
            p.title = "Existing Result".to_string();
            p.source = "crossref".to_string();
        });
        let sr = make_isbn_search_result("ISBN", vec![paper]);

        let result = try_isbn_fallback(
            &client,
            "9780262035613",
            &sr,
            "http://localhost:1",
            "http://localhost:1",
        )
        .await;

        assert!(result.is_none(), "fallback should be skipped when papers already present");
    }

    #[test]
    fn parse_search_type_valid_variants() {
        assert_eq!(parse_search_type("doi").unwrap(), Some(research_hub::SearchType::Doi));
        assert_eq!(parse_search_type("keywords").unwrap(), Some(research_hub::SearchType::Keywords));
        assert_eq!(parse_search_type("author").unwrap(), Some(research_hub::SearchType::Author));
        assert_eq!(parse_search_type("title").unwrap(), Some(research_hub::SearchType::Title));
        assert_eq!(parse_search_type("isbn").unwrap(), Some(research_hub::SearchType::Isbn));
    }

    #[test]
    fn parse_search_type_case_insensitive() {
        assert_eq!(parse_search_type("DOI").unwrap(), Some(research_hub::SearchType::Doi));
        assert_eq!(parse_search_type("Keywords").unwrap(), Some(research_hub::SearchType::Keywords));
        assert_eq!(parse_search_type("ISBN").unwrap(), Some(research_hub::SearchType::Isbn));
    }

    #[test]
    fn parse_search_type_empty_returns_none() {
        assert_eq!(parse_search_type("").unwrap(), None);
        assert_eq!(parse_search_type("  ").unwrap(), None);
    }

    #[test]
    fn parse_search_type_unknown_returns_err() {
        assert!(parse_search_type("titl").is_err());
        assert!(parse_search_type("orcid").is_err());
        assert!(parse_search_type("unknown").is_err());
    }
}
