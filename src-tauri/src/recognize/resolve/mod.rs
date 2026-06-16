use std::fmt;

use serde::Serialize;

use crate::bib::types::BibEntry;
use crate::recognize::identifiers::ExtractedIdentifiers;

pub mod arxiv;
pub mod crossref_search;
pub mod doi;
pub mod isbn;
pub mod title_match;

#[derive(Debug)]
pub enum ResolveError {
    Http(String),
    Parse(String),
    RateLimited,
}

impl fmt::Display for ResolveError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ResolveError::Http(msg) => write!(f, "HTTP error: {}", msg),
            ResolveError::Parse(msg) => write!(f, "Parse error: {}", msg),
            ResolveError::RateLimited => write!(f, "Rate limited"),
        }
    }
}

impl std::error::Error for ResolveError {}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub enum ResolutionSource {
    DoiContentNegotiation,
    CrossrefApi,
    ArxivApi,
    OpenLibraryApi,
    GoogleBooksApi,
    CrossrefTitleSearch,
}

/// Whether the resolved entry was cross-validated against the extracted title.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Validation {
    /// Title (and optionally authors) matched the extracted text.
    Validated,
    /// Validation was skipped (trusted source or no extracted title available).
    Skipped,
}

#[derive(Debug, Clone, Serialize)]
pub struct ResolvedMetadata {
    pub entry: BibEntry,
    pub source: ResolutionSource,
    pub validation: Validation,
}

/// Base URLs for external metadata APIs.
///
/// Using a struct with named fields prevents accidental transposition of
/// the 5 same-typed `&str` base-URL parameters.
pub struct BaseUrls<'a> {
    pub doi: &'a str,
    pub crossref: &'a str,
    pub arxiv: &'a str,
    pub open_library: &'a str,
    pub google_books: &'a str,
}

impl BaseUrls<'static> {
    pub fn production() -> Self {
        Self {
            doi: "https://doi.org",
            crossref: "https://api.crossref.org",
            arxiv: "https://export.arxiv.org",
            open_library: "https://openlibrary.org",
            google_books: "https://www.googleapis.com",
        }
    }
}

/// Resolve identifiers and/or a title to a [`ResolvedMetadata`] using
/// the caller-provided HTTP client.
///
/// # Arguments
///
/// - `client`: a pre-configured `reqwest::Client` — should have a timeout
///   (recommended 10 s) and a `User-Agent` header (CrossRef etiquette requires
///   an identifying UA for polite access). In production, use
///   [`crate::commands::bib_import::HTTP_CLIENT`].
/// - `identifiers`: extracted DOI / arXiv / JSTOR identifiers
/// - `extracted_title`: an optional title extracted from the source document
/// - `trusted`: when `true`, skip cross-validation of the resolved title
///   against `extracted_title`
pub async fn resolve_to_bib_entry(
    client: &reqwest::Client,
    identifiers: &ExtractedIdentifiers,
    extracted_title: Option<&str>,
    trusted: bool,
) -> Result<Option<ResolvedMetadata>, ResolveError> {
    resolve_to_bib_entry_with_base(
        client,
        identifiers,
        extracted_title,
        trusted,
        &BaseUrls::production(),
    )
    .await
}

/// Resolve identifiers/title to a [`ResolvedMetadata`] using the shared
/// production HTTP client.
///
/// This is the recommended entry point — it uses
/// [`crate::commands::bib_import::HTTP_CLIENT`], which has the correct timeout
/// and `User-Agent` for CrossRef polite access.
pub async fn resolve_to_bib_entry_default(
    identifiers: &ExtractedIdentifiers,
    extracted_title: Option<&str>,
    trusted: bool,
) -> Result<Option<ResolvedMetadata>, ResolveError> {
    resolve_to_bib_entry(
        &crate::commands::bib_import::HTTP_CLIENT,
        identifiers,
        extracted_title,
        trusted,
    )
    .await
}

/// Unified acceptance policy for a resolved entry.
///
/// Returns `Some(metadata)` if the entry should be accepted, `None` if it
/// should be discarded (caller falls through to the next resolution path).
///
/// Policy (applied in order):
/// 1. Reject entries with empty/whitespace-only title (upstream garbage).
/// 2. If `trusted` or no `extracted_title`, accept with `validation: Skipped`.
/// 3. Reject if title does not match `extracted_title`.
/// 4. If `expected_authors` is non-empty, reject if no author overlap.
/// 5. Accept with `validation: Validated`.
fn accept_candidate(
    entry: BibEntry,
    source: ResolutionSource,
    extracted_title: Option<&str>,
    trusted: bool,
    expected_authors: &[String],
) -> Option<ResolvedMetadata> {
    // Reject entries with no meaningful title — a blank title means the
    // upstream API returned garbage; let the cascade try the next path.
    if entry.title.trim().is_empty() {
        return None;
    }

    if trusted || extracted_title.is_none() {
        return Some(ResolvedMetadata {
            entry,
            source,
            validation: Validation::Skipped,
        });
    }

    let title = extracted_title.unwrap();
    if !title_match::titles_match(&entry.title, title) {
        return None;
    }

    if !expected_authors.is_empty()
        && !title_match::authors_overlap(&entry.authors, expected_authors)
    {
        return None;
    }

    Some(ResolvedMetadata {
        entry,
        source,
        validation: Validation::Validated,
    })
}

/// Check an HTTP response status for rate-limiting (429) and generic failure.
///
/// - Returns `Err(ResolveError::RateLimited)` on 429.
/// - Returns `Err(ResolveError::Http(...))` on any other non-success status,
///   using `context` in the error message (e.g. `"arXiv API"`, `"CrossRef search API"`).
/// - Returns `Ok(response)` when the status is a success (2xx), passing
///   ownership of the response through for body consumption.
pub(crate) fn check_status(
    resp: reqwest::Response,
    context: &str,
) -> Result<reqwest::Response, ResolveError> {
    let status = resp.status();
    if status == reqwest::StatusCode::TOO_MANY_REQUESTS {
        return Err(ResolveError::RateLimited);
    }
    if !status.is_success() {
        return Err(ResolveError::Http(format!(
            "{} returned status {}",
            context, status
        )));
    }
    Ok(resp)
}

pub(crate) async fn resolve_to_bib_entry_with_base(
    client: &reqwest::Client,
    identifiers: &ExtractedIdentifiers,
    extracted_title: Option<&str>,
    trusted: bool,
    base_urls: &BaseUrls<'_>,
) -> Result<Option<ResolvedMetadata>, ResolveError> {
    // Step 1: DOI resolution
    if let Some(ref doi_str) = identifiers.doi {
        match doi::resolve_doi_with_base(client, doi_str, base_urls.doi, base_urls.crossref).await {
            Err(ResolveError::RateLimited) => return Err(ResolveError::RateLimited),
            Ok((entry, doi_path)) => {
                let source = match doi_path {
                    doi::DoiPath::ContentNegotiation => ResolutionSource::DoiContentNegotiation,
                    doi::DoiPath::CrossrefFallback => ResolutionSource::CrossrefApi,
                };
                if let Some(meta) = accept_candidate(
                    entry,
                    source,
                    extracted_title,
                    trusted,
                    &[],
                ) {
                    return Ok(Some(meta));
                }
            }
            Err(e) => tracing::warn!(error = %e, "DOI resolution failed, falling through"),
        }
    }

    // Step 2: arXiv resolution
    if let Some(ref arxiv_id) = identifiers.arxiv {
        match arxiv::resolve_arxiv_with_base(client, arxiv_id, base_urls.arxiv).await {
            Err(ResolveError::RateLimited) => return Err(ResolveError::RateLimited),
            Ok(entry) => {
                if let Some(meta) = accept_candidate(
                    entry,
                    ResolutionSource::ArxivApi,
                    extracted_title,
                    trusted,
                    &[],
                ) {
                    return Ok(Some(meta));
                }
            }
            Err(e) => tracing::warn!(error = %e, "arXiv resolution failed, falling through"),
        }
    }

    // Step 3: ISBN resolution (Open Library → Google Books)
    if let Some(ref isbn_str) = identifiers.isbn {
        match isbn::resolve_isbn_with_base(client, isbn_str, base_urls.open_library, base_urls.google_books).await {
            Err(ResolveError::RateLimited) => return Err(ResolveError::RateLimited),
            Ok((entry, path)) => {
                let source = match path {
                    isbn::IsbnPath::OpenLibrary => ResolutionSource::OpenLibraryApi,
                    isbn::IsbnPath::GoogleBooks => ResolutionSource::GoogleBooksApi,
                };
                if let Some(meta) = accept_candidate(entry, source, extracted_title, trusted, &[]) {
                    return Ok(Some(meta));
                }
            }
            Err(e) => tracing::warn!(error = %e, "ISBN resolution failed, falling through"),
        }
    }

    // Step 4: CrossRef title search
    if let Some(title) = extracted_title {
        let authors: Vec<String> = identifiers
            .jstor_metadata
            .as_ref()
            .map(|m| m.authors.clone())
            .unwrap_or_default();

        match crossref_search::search_crossref_by_title_with_base(
            client,
            title,
            &authors,
            base_urls.crossref,
        )
        .await
        {
            Err(ResolveError::RateLimited) => return Err(ResolveError::RateLimited),
            Ok(candidates) => {
                if let Some(best) = title_match::best_title_match(&candidates, title) {
                    // best_title_match already guarantees the title meets the
                    // similarity threshold; accept_candidate will re-check it
                    // (via titles_match) as the single shared acceptance policy.
                    // The redundancy is intentional — accept_candidate is the
                    // uniform gate for all resolution paths (DOI, arXiv, title
                    // search), so we always route through it.
                    if let Some(meta) = accept_candidate(
                        best.clone(),
                        ResolutionSource::CrossrefTitleSearch,
                        Some(title),
                        false,
                        &authors,
                    ) {
                        return Ok(Some(meta));
                    }
                }
            }
            Err(e) => tracing::warn!(error = %e, "CrossRef title search failed, falling through"),
        }
    }

    // Step 5: All paths exhausted
    Ok(None)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::recognize::identifiers::JstorMetadata;
    use wiremock::matchers::{header, method, path, query_param};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    fn test_client() -> reqwest::Client {
        reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(5))
            .build()
            .unwrap()
    }

    #[tokio::test]
    async fn doi_resolves_first_try() {
        let server = MockServer::start().await;
        let client = test_client();

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

        // arXiv mock with expect(0) — should NOT be called
        Mock::given(method("GET"))
            .and(path("/api/query"))
            .respond_with(ResponseTemplate::new(200))
            .expect(0)
            .mount(&server)
            .await;

        let identifiers = ExtractedIdentifiers {
            doi: Some("10.1038/nature12373".to_string()),
            arxiv: Some("2301.07041".to_string()),
            ..Default::default()
        };

        let uri = server.uri();
        let result = resolve_to_bib_entry_with_base(
            &client,
            &identifiers,
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
        assert_eq!(meta.source, ResolutionSource::DoiContentNegotiation);
        assert_eq!(meta.entry.title, "Probing condensed matter physics");
        assert_eq!(meta.validation, Validation::Skipped);
    }

    #[tokio::test]
    async fn doi_fails_arxiv_succeeds() {
        let doi_server = MockServer::start().await;
        let arxiv_server = MockServer::start().await;

        let client = test_client();

        // DOI content negotiation returns 404
        Mock::given(method("GET"))
            .and(path("/10.9999/nonexistent"))
            .respond_with(ResponseTemplate::new(404))
            .mount(&doi_server)
            .await;

        // CrossRef /works/{doi} also returns 404
        Mock::given(method("GET"))
            .and(path("/works/10.9999/nonexistent"))
            .respond_with(ResponseTemplate::new(404))
            .mount(&doi_server)
            .await;

        let arxiv_xml = r#"<?xml version='1.0' encoding='UTF-8'?>
<feed xmlns="http://www.w3.org/2005/Atom"
      xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/"
      xmlns:arxiv="http://arxiv.org/schemas/atom">
  <opensearch:totalResults>1</opensearch:totalResults>
  <entry>
    <id>http://arxiv.org/abs/2301.07041v2</id>
    <title>Verifiable Fully Homomorphic Encryption</title>
    <summary>FHE is seeing increasing deployment.</summary>
    <published>2023-01-17T17:50:26Z</published>
    <author><name>Alexander Viand</name></author>
    <category term="cs.CR" scheme="http://arxiv.org/schemas/atom"/>
  </entry>
</feed>"#;

        Mock::given(method("GET"))
            .and(path("/api/query"))
            .and(query_param("id_list", "2301.07041"))
            .respond_with(ResponseTemplate::new(200).set_body_string(arxiv_xml))
            .mount(&arxiv_server)
            .await;

        let identifiers = ExtractedIdentifiers {
            doi: Some("10.9999/nonexistent".to_string()),
            arxiv: Some("2301.07041".to_string()),
            ..Default::default()
        };

        let doi_uri = doi_server.uri();
        let arxiv_uri = arxiv_server.uri();
        let result = resolve_to_bib_entry_with_base(
            &client,
            &identifiers,
            None,
            true,
            &BaseUrls {
                doi: &doi_uri,
                crossref: &doi_uri,
                arxiv: &arxiv_uri,
                open_library: "http://localhost:1",
                google_books: "http://localhost:1",
            },
        )
        .await;

        let meta = result.expect("should succeed").expect("should have metadata");
        assert_eq!(meta.source, ResolutionSource::ArxivApi);
        assert_eq!(meta.entry.title, "Verifiable Fully Homomorphic Encryption");
    }

    #[tokio::test]
    async fn all_identifiers_fail_title_search_succeeds() {
        let server = MockServer::start().await;
        let client = test_client();

        let search_json = r#"{
            "status": "ok",
            "message-type": "work-list",
            "message": {
                "items": [
                    {
                        "type": "journal-article",
                        "title": ["Attention Is All You Need"],
                        "author": [{"family": "Vaswani", "given": "Ashish"}],
                        "container-title": ["Advances in Neural Information Processing Systems"],
                        "issued": {"date-parts": [[2017]]},
                        "DOI": "10.5555/3295222.3295349"
                    }
                ]
            }
        }"#;

        Mock::given(method("GET"))
            .and(path("/works"))
            .and(query_param("query.bibliographic", "Attention Is All You Need"))
            .respond_with(ResponseTemplate::new(200).set_body_string(search_json))
            .mount(&server)
            .await;

        let identifiers = ExtractedIdentifiers::default();

        let uri = server.uri();
        let result = resolve_to_bib_entry_with_base(
            &client,
            &identifiers,
            Some("Attention Is All You Need"),
            false,
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
        assert_eq!(meta.source, ResolutionSource::CrossrefTitleSearch);
        assert_eq!(meta.entry.title, "Attention Is All You Need");
        assert_eq!(meta.validation, Validation::Validated);
    }

    #[tokio::test]
    async fn all_fail_returns_none() {
        let client = test_client();

        let identifiers = ExtractedIdentifiers::default();

        let result = resolve_to_bib_entry_with_base(
            &client,
            &identifiers,
            None,
            true,
            &BaseUrls {
                doi: "http://localhost:1", // unreachable, but won't be called
                crossref: "http://localhost:1",
                arxiv: "http://localhost:1",
                open_library: "http://localhost:1",
                google_books: "http://localhost:1",
            },
        )
        .await;

        assert!(result.expect("should succeed").is_none());
    }

    #[tokio::test]
    async fn cross_validation_mismatch_discards_doi_and_falls_through() {
        let server = MockServer::start().await;
        let client = test_client();

        // DOI returns valid CSL-JSON with wrong title
        let csl_json = r#"{
            "type": "journal-article",
            "title": "Completely Wrong Title",
            "author": [{"family": "Nobody", "given": "John"}],
            "issued": {"date-parts": [[2020]]},
            "DOI": "10.1038/nature12373"
        }"#;

        Mock::given(method("GET"))
            .and(path("/10.1038/nature12373"))
            .and(header("Accept", "application/vnd.citationstyles.csl+json"))
            .respond_with(ResponseTemplate::new(200).set_body_string(csl_json))
            .mount(&server)
            .await;

        // CrossRef search returns the correct paper
        let search_json = r#"{
            "status": "ok",
            "message-type": "work-list",
            "message": {
                "items": [
                    {
                        "type": "journal-article",
                        "title": ["Correct Paper Title"],
                        "author": [{"family": "Smith", "given": "John"}],
                        "issued": {"date-parts": [[2021]]},
                        "DOI": "10.9999/correct"
                    }
                ]
            }
        }"#;

        Mock::given(method("GET"))
            .and(path("/works"))
            .and(query_param("query.bibliographic", "Correct Paper Title"))
            .respond_with(ResponseTemplate::new(200).set_body_string(search_json))
            .mount(&server)
            .await;

        let identifiers = ExtractedIdentifiers {
            doi: Some("10.1038/nature12373".to_string()),
            ..Default::default()
        };

        let uri = server.uri();
        let result = resolve_to_bib_entry_with_base(
            &client,
            &identifiers,
            Some("Correct Paper Title"),
            false,
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
        assert_eq!(meta.source, ResolutionSource::CrossrefTitleSearch);
    }

    #[tokio::test]
    async fn rate_limited_propagates_immediately() {
        let server = MockServer::start().await;
        let client = test_client();

        // DOI content negotiation returns 429
        Mock::given(method("GET"))
            .and(path("/10.1038/nature12373"))
            .respond_with(ResponseTemplate::new(429))
            .mount(&server)
            .await;

        // arXiv should NOT be reached
        Mock::given(method("GET"))
            .and(path("/api/query"))
            .respond_with(ResponseTemplate::new(200))
            .expect(0)
            .mount(&server)
            .await;

        let identifiers = ExtractedIdentifiers {
            doi: Some("10.1038/nature12373".to_string()),
            arxiv: Some("2301.07041".to_string()),
            ..Default::default()
        };

        let uri = server.uri();
        let result = resolve_to_bib_entry_with_base(
            &client,
            &identifiers,
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

        assert!(result.is_err());
        match result.unwrap_err() {
            ResolveError::RateLimited => {}
            other => panic!("expected ResolveError::RateLimited, got {:?}", other),
        }
    }

    #[tokio::test]
    async fn cross_validation_passes_when_trusted() {
        let server = MockServer::start().await;
        let client = test_client();

        let csl_json = r#"{
            "type": "journal-article",
            "title": "Any Title Here",
            "author": [{"family": "Author", "given": "Some"}],
            "issued": {"date-parts": [[2020]]},
            "DOI": "10.1038/nature12373"
        }"#;

        Mock::given(method("GET"))
            .and(path("/10.1038/nature12373"))
            .and(header("Accept", "application/vnd.citationstyles.csl+json"))
            .respond_with(ResponseTemplate::new(200).set_body_string(csl_json))
            .mount(&server)
            .await;

        let identifiers = ExtractedIdentifiers {
            doi: Some("10.1038/nature12373".to_string()),
            ..Default::default()
        };

        let uri = server.uri();
        let result = resolve_to_bib_entry_with_base(
            &client,
            &identifiers,
            Some("Completely Different Title"),
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
        assert_eq!(meta.validation, Validation::Skipped);
    }

    #[tokio::test]
    async fn title_search_with_author_overlap_required() {
        let server = MockServer::start().await;
        let client = test_client();

        let search_json = r#"{
            "status": "ok",
            "message-type": "work-list",
            "message": {
                "items": [
                    {
                        "type": "journal-article",
                        "title": ["Some Paper"],
                        "author": [{"family": "Smith", "given": "John"}],
                        "issued": {"date-parts": [[2021]]}
                    }
                ]
            }
        }"#;

        Mock::given(method("GET"))
            .and(path("/works"))
            .and(query_param("query.bibliographic", "Some Paper"))
            .respond_with(ResponseTemplate::new(200).set_body_string(search_json))
            .mount(&server)
            .await;

        let identifiers = ExtractedIdentifiers {
            jstor_metadata: Some(JstorMetadata {
                authors: vec!["Williams".to_string()],
                ..Default::default()
            }),
            ..Default::default()
        };

        let uri = server.uri();
        let result = resolve_to_bib_entry_with_base(
            &client,
            &identifiers,
            Some("Some Paper"),
            false,
            &BaseUrls {
                doi: &uri,
                crossref: &uri,
                arxiv: &uri,
                open_library: "http://localhost:1",
                google_books: "http://localhost:1",
            },
        )
        .await;

        assert!(result.expect("should succeed").is_none());
    }

    // --- F5: DOI CrossRef fallback produces ResolutionSource::CrossrefApi ---

    #[tokio::test]
    async fn doi_crossref_fallback_has_crossref_api_source() {
        let server = MockServer::start().await;
        let client = test_client();

        // doi.org content negotiation returns 404
        Mock::given(method("GET"))
            .and(path("/10.1038/nature12373"))
            .respond_with(ResponseTemplate::new(404))
            .mount(&server)
            .await;

        // CrossRef /works/{doi} returns valid data
        let crossref_json = r#"{
            "status": "ok",
            "message": {
                "type": "journal-article",
                "title": ["Probing condensed matter physics"],
                "author": [{"family": "Kucsko", "given": "Georg"}],
                "issued": {"date-parts": [[2013]]},
                "DOI": "10.1038/nature12373"
            }
        }"#;

        Mock::given(method("GET"))
            .and(path("/works/10.1038/nature12373"))
            .respond_with(ResponseTemplate::new(200).set_body_string(crossref_json))
            .mount(&server)
            .await;

        let identifiers = ExtractedIdentifiers {
            doi: Some("10.1038/nature12373".to_string()),
            ..Default::default()
        };

        let uri = server.uri();
        let result = resolve_to_bib_entry_with_base(
            &client,
            &identifiers,
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
        assert_eq!(
            meta.source,
            ResolutionSource::CrossrefApi,
            "when doi.org 404s and CrossRef succeeds, source should be CrossrefApi"
        );
        assert_eq!(meta.entry.title, "Probing condensed matter physics");
    }

    // --- F3: accept_candidate rejects empty/whitespace-only titles ---

    fn make_bib_entry(title: &str) -> BibEntry {
        BibEntry {
            key: "test2024".to_string(),
            authors: vec!["Author".to_string()],
            title: title.to_string(),
            year: "2024".to_string(),
            entry_type: "article".to_string(),
            line_number: 0,
            bib_file: None,
            abstract_text: None,
            doi: Some("10.1234/test".to_string()),
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
            oclc: None,
            work_type: None,
            series: None,
            lccn: None,
            editors: vec![],
            tags: vec![],
        }
    }

    #[test]
    fn accept_candidate_rejects_empty_title_when_trusted() {
        let entry = make_bib_entry("");
        let result = accept_candidate(
            entry,
            ResolutionSource::DoiContentNegotiation,
            None,
            true,
            &[],
        );
        assert!(result.is_none(), "empty title should be rejected even when trusted");
    }

    #[test]
    fn accept_candidate_rejects_whitespace_only_title_when_trusted() {
        let entry = make_bib_entry("   ");
        let result = accept_candidate(
            entry,
            ResolutionSource::DoiContentNegotiation,
            None,
            true,
            &[],
        );
        assert!(result.is_none(), "whitespace-only title should be rejected even when trusted");
    }

    #[test]
    fn accept_candidate_rejects_empty_title_no_extracted_title() {
        let entry = make_bib_entry("");
        let result = accept_candidate(
            entry,
            ResolutionSource::CrossrefApi,
            None,
            false,
            &[],
        );
        assert!(result.is_none(), "empty title should be rejected when extracted_title is None");
    }

    #[test]
    fn accept_candidate_rejects_empty_title_with_extracted_title() {
        let entry = make_bib_entry("");
        let result = accept_candidate(
            entry,
            ResolutionSource::DoiContentNegotiation,
            Some("Real Title"),
            false,
            &[],
        );
        assert!(result.is_none(), "empty title should be rejected even with extracted_title present");
    }

    #[test]
    fn accept_candidate_accepts_nonempty_title_when_trusted() {
        let entry = make_bib_entry("A Real Title");
        let result = accept_candidate(
            entry,
            ResolutionSource::DoiContentNegotiation,
            None,
            true,
            &[],
        );
        assert!(result.is_some(), "non-empty title should be accepted when trusted");
        let meta = result.unwrap();
        assert_eq!(meta.validation, Validation::Skipped);
        assert_eq!(meta.entry.title, "A Real Title");
    }

    // --- F4: ResolveError implements std::error::Error ---

    #[test]
    fn resolve_error_implements_std_error() {
        use std::error::Error;

        let http_err: &dyn Error = &ResolveError::Http("connection refused".into());
        assert_eq!(http_err.to_string(), "HTTP error: connection refused");

        let parse_err: &dyn Error = &ResolveError::Parse("invalid json".into());
        assert_eq!(parse_err.to_string(), "Parse error: invalid json");

        let rate_err: &dyn Error = &ResolveError::RateLimited;
        assert_eq!(rate_err.to_string(), "Rate limited");
    }

    #[test]
    fn resolve_error_source_is_none() {
        use std::error::Error;

        let variants: Vec<ResolveError> = vec![
            ResolveError::Http("msg".into()),
            ResolveError::Parse("msg".into()),
            ResolveError::RateLimited,
        ];

        for variant in &variants {
            let err: &dyn Error = variant;
            assert!(
                err.source().is_none(),
                "expected source() to be None for {:?}",
                variant,
            );
        }
    }

    // --- F6: resolve_to_bib_entry_default delegates to resolve_to_bib_entry ---

    #[tokio::test]
    async fn resolve_to_bib_entry_default_delegates_to_resolve_to_bib_entry() {
        let identifiers = ExtractedIdentifiers::default();

        // No identifiers and no title means all resolution paths are skipped,
        // so this should return Ok(None) without making any HTTP calls.
        let result = resolve_to_bib_entry_default(
            &identifiers,
            None,
            true,
        )
        .await;

        assert!(
            result.expect("should succeed").is_none(),
            "empty identifiers + no title should return None via default client"
        );
    }

    // --- F8: check_status helper ---

    #[tokio::test]
    async fn check_status_success_passes_through() {
        let server = MockServer::start().await;

        Mock::given(method("GET"))
            .and(path("/ok"))
            .respond_with(ResponseTemplate::new(200).set_body_string("hello"))
            .mount(&server)
            .await;

        let client = test_client();
        let resp = client
            .get(format!("{}/ok", server.uri()))
            .send()
            .await
            .unwrap();

        let resp = check_status(resp, "Test API").expect("200 should pass through");
        let body = resp.text().await.unwrap();
        assert_eq!(body, "hello");
    }

    #[tokio::test]
    async fn check_status_429_returns_rate_limited() {
        let server = MockServer::start().await;

        Mock::given(method("GET"))
            .and(path("/limited"))
            .respond_with(ResponseTemplate::new(429))
            .mount(&server)
            .await;

        let client = test_client();
        let resp = client
            .get(format!("{}/limited", server.uri()))
            .send()
            .await
            .unwrap();

        match check_status(resp, "Test API") {
            Err(ResolveError::RateLimited) => {} // expected
            other => panic!("expected RateLimited, got {:?}", other),
        }
    }

    #[tokio::test]
    async fn check_status_404_returns_http_error_with_context() {
        let server = MockServer::start().await;

        Mock::given(method("GET"))
            .and(path("/missing"))
            .respond_with(ResponseTemplate::new(404))
            .mount(&server)
            .await;

        let client = test_client();
        let resp = client
            .get(format!("{}/missing", server.uri()))
            .send()
            .await
            .unwrap();

        match check_status(resp, "My API") {
            Err(ResolveError::Http(msg)) => {
                assert!(msg.contains("My API"), "should contain context, got: {}", msg);
                assert!(msg.contains("404"), "should contain status code, got: {}", msg);
            }
            other => panic!("expected Http error, got {:?}", other),
        }
    }

    #[tokio::test]
    async fn check_status_500_returns_http_error_with_context() {
        let server = MockServer::start().await;

        Mock::given(method("GET"))
            .and(path("/error"))
            .respond_with(ResponseTemplate::new(500))
            .mount(&server)
            .await;

        let client = test_client();
        let resp = client
            .get(format!("{}/error", server.uri()))
            .send()
            .await
            .unwrap();

        match check_status(resp, "Some Service") {
            Err(ResolveError::Http(msg)) => {
                assert!(msg.contains("Some Service"), "should contain context, got: {}", msg);
                assert!(msg.contains("500"), "should contain status code, got: {}", msg);
            }
            other => panic!("expected Http error, got {:?}", other),
        }
    }

    // --- F9: accept_candidate unifies acceptance policy ---

    #[test]
    fn accept_candidate_rejects_empty_title() {
        let entry = make_bib_entry("");
        let result = accept_candidate(
            entry,
            ResolutionSource::DoiContentNegotiation,
            None,
            true,
            &[],
        );
        assert!(result.is_none(), "empty title should be rejected");
    }

    #[test]
    fn accept_candidate_accepts_trusted_without_authors() {
        let entry = make_bib_entry("A Real Title");
        let result = accept_candidate(
            entry,
            ResolutionSource::DoiContentNegotiation,
            None,
            true,
            &[],
        );
        assert!(result.is_some(), "trusted entry with valid title should be accepted");
        let meta = result.unwrap();
        assert_eq!(meta.validation, Validation::Skipped);
    }

    #[test]
    fn accept_candidate_title_match_no_authors_accepts() {
        let entry = make_bib_entry("Matching Title");
        let result = accept_candidate(
            entry,
            ResolutionSource::CrossrefTitleSearch,
            Some("Matching Title"),
            false,
            &[],
        );
        assert!(result.is_some(), "matching title with no expected authors should accept");
        let meta = result.unwrap();
        assert_eq!(meta.validation, Validation::Validated);
    }

    #[test]
    fn accept_candidate_title_match_with_matching_authors_accepts() {
        let mut entry = make_bib_entry("Matching Title");
        entry.authors = vec!["Smith".to_string()];
        let result = accept_candidate(
            entry,
            ResolutionSource::CrossrefTitleSearch,
            Some("Matching Title"),
            false,
            &["Smith".to_string()],
        );
        assert!(result.is_some(), "matching title + matching authors should accept");
        let meta = result.unwrap();
        assert_eq!(meta.validation, Validation::Validated);
    }

    #[test]
    fn accept_candidate_title_match_with_non_matching_authors_rejects() {
        let mut entry = make_bib_entry("Matching Title");
        entry.authors = vec!["Smith".to_string()];
        let result = accept_candidate(
            entry,
            ResolutionSource::CrossrefTitleSearch,
            Some("Matching Title"),
            false,
            &["Williams".to_string()],
        );
        assert!(result.is_none(), "matching title but non-matching authors should reject");
    }

    #[test]
    fn accept_candidate_title_mismatch_with_matching_authors_rejects() {
        let mut entry = make_bib_entry("Completely Different Title");
        entry.authors = vec!["Smith".to_string()];
        let result = accept_candidate(
            entry,
            ResolutionSource::CrossrefTitleSearch,
            Some("The Real Title"),
            false,
            &["Smith".to_string()],
        );
        assert!(result.is_none(), "title mismatch should reject even with matching authors");
    }

    #[test]
    fn accept_candidate_empty_authors_skips_author_check() {
        let mut entry = make_bib_entry("Matching Title");
        entry.authors = vec!["Smith".to_string()];
        let result = accept_candidate(
            entry,
            ResolutionSource::CrossrefTitleSearch,
            Some("Matching Title"),
            false,
            &[],
        );
        assert!(result.is_some(), "empty expected_authors should skip author check");
        let meta = result.unwrap();
        assert_eq!(meta.validation, Validation::Validated);
    }

    #[tokio::test]
    async fn trusted_doi_with_empty_title_falls_through_to_arxiv() {
        let doi_server = MockServer::start().await;
        let arxiv_server = MockServer::start().await;
        let client = test_client();

        // DOI returns CSL-JSON with empty title
        let csl_json = r#"{
            "type": "journal-article",
            "title": "",
            "author": [{"family": "Nobody", "given": "John"}],
            "issued": {"date-parts": [[2020]]},
            "DOI": "10.1038/nature12373"
        }"#;

        Mock::given(method("GET"))
            .and(path("/10.1038/nature12373"))
            .and(header("Accept", "application/vnd.citationstyles.csl+json"))
            .respond_with(ResponseTemplate::new(200).set_body_string(csl_json))
            .mount(&doi_server)
            .await;

        let arxiv_xml = r#"<?xml version='1.0' encoding='UTF-8'?>
<feed xmlns="http://www.w3.org/2005/Atom"
      xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/"
      xmlns:arxiv="http://arxiv.org/schemas/atom">
  <opensearch:totalResults>1</opensearch:totalResults>
  <entry>
    <id>http://arxiv.org/abs/2301.07041v2</id>
    <title>Verifiable Fully Homomorphic Encryption</title>
    <summary>FHE is seeing increasing deployment.</summary>
    <published>2023-01-17T17:50:26Z</published>
    <author><name>Alexander Viand</name></author>
    <category term="cs.CR" scheme="http://arxiv.org/schemas/atom"/>
  </entry>
</feed>"#;

        Mock::given(method("GET"))
            .and(path("/api/query"))
            .and(query_param("id_list", "2301.07041"))
            .respond_with(ResponseTemplate::new(200).set_body_string(arxiv_xml))
            .mount(&arxiv_server)
            .await;

        let identifiers = ExtractedIdentifiers {
            doi: Some("10.1038/nature12373".to_string()),
            arxiv: Some("2301.07041".to_string()),
            ..Default::default()
        };

        let doi_uri = doi_server.uri();
        let arxiv_uri = arxiv_server.uri();
        let result = resolve_to_bib_entry_with_base(
            &client,
            &identifiers,
            None,
            true,
            &BaseUrls {
                doi: &doi_uri,
                crossref: &doi_uri,
                arxiv: &arxiv_uri,
                open_library: "http://localhost:1",
                google_books: "http://localhost:1",
            },
        )
        .await;

        let meta = result.expect("should succeed").expect("should have metadata");
        assert_eq!(
            meta.source,
            ResolutionSource::ArxivApi,
            "empty-title DOI entry should be rejected, falling through to arXiv"
        );
        assert_eq!(meta.entry.title, "Verifiable Fully Homomorphic Encryption");
    }

    // --- F10: Validation enum tests ---

    #[test]
    fn validation_enum_serializes_to_snake_case() {
        let validated = serde_json::to_value(Validation::Validated).unwrap();
        assert_eq!(validated, serde_json::Value::String("validated".to_string()));

        let skipped = serde_json::to_value(Validation::Skipped).unwrap();
        assert_eq!(skipped, serde_json::Value::String("skipped".to_string()));
    }

    #[test]
    fn validation_enum_is_copy_and_eq() {
        let a = Validation::Validated;
        let b = a; // Copy
        assert_eq!(a, b);

        let c = Validation::Skipped;
        let d = c; // Copy
        assert_eq!(c, d);

        assert_ne!(a, c);
    }

    #[test]
    fn resolved_metadata_serializes_validation_field() {
        let meta_validated = ResolvedMetadata {
            entry: make_bib_entry("Test Title"),
            source: ResolutionSource::DoiContentNegotiation,
            validation: Validation::Validated,
        };
        let json = serde_json::to_value(&meta_validated).unwrap();
        assert_eq!(json["validation"], "validated");
        assert!(json.get("cross_validated").is_none());

        let meta_skipped = ResolvedMetadata {
            entry: make_bib_entry("Test Title"),
            source: ResolutionSource::DoiContentNegotiation,
            validation: Validation::Skipped,
        };
        let json = serde_json::to_value(&meta_skipped).unwrap();
        assert_eq!(json["validation"], "skipped");
        assert!(json.get("cross_validated").is_none());
    }

    // --- BaseUrls struct tests ---

    #[test]
    fn base_urls_production_has_correct_defaults() {
        let urls = BaseUrls::production();
        assert_eq!(urls.doi, "https://doi.org");
        assert_eq!(urls.crossref, "https://api.crossref.org");
        assert_eq!(urls.arxiv, "https://export.arxiv.org");
        assert_eq!(urls.open_library, "https://openlibrary.org");
        assert_eq!(urls.google_books, "https://www.googleapis.com");
    }

    // --- ISBN cascade tests ---

    #[tokio::test]
    async fn isbn_resolves_via_open_library_when_no_doi_or_arxiv() {
        let ol_server = MockServer::start().await;
        let client = test_client();

        let ol_response = r#"{"ISBN:9780306406157":{"title":"Fundamentals of Wavelets","authors":[{"name":"Jaideva Goswami"}],"publishers":[{"name":"Wiley"}],"publish_date":"1999","identifiers":{"isbn_13":["9780306406157"]}}}"#;

        Mock::given(method("GET"))
            .and(path("/api/books"))
            .and(query_param("bibkeys", "ISBN:9780306406157"))
            .respond_with(ResponseTemplate::new(200).set_body_string(ol_response))
            .mount(&ol_server)
            .await;

        let identifiers = ExtractedIdentifiers {
            isbn: Some("9780306406157".to_string()),
            ..Default::default()
        };

        let ol_uri = ol_server.uri();
        let result = resolve_to_bib_entry_with_base(
            &client,
            &identifiers,
            None,
            true,
            &BaseUrls {
                doi: "http://localhost:1",
                crossref: "http://localhost:1",
                arxiv: "http://localhost:1",
                open_library: &ol_uri,
                google_books: "http://localhost:1",
            },
        )
        .await;

        let meta = result.expect("should succeed").expect("should have metadata");
        assert_eq!(meta.source, ResolutionSource::OpenLibraryApi);
        assert_eq!(meta.entry.title, "Fundamentals of Wavelets");
        assert_eq!(meta.entry.isbn, Some("9780306406157".to_string()));
    }

    #[tokio::test]
    async fn doi_resolves_first_isbn_not_called() {
        let doi_server = MockServer::start().await;
        let isbn_server = MockServer::start().await;
        let client = test_client();

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
            .mount(&doi_server)
            .await;

        Mock::given(method("GET"))
            .and(path("/api/books"))
            .respond_with(ResponseTemplate::new(200))
            .expect(0)
            .mount(&isbn_server)
            .await;

        let identifiers = ExtractedIdentifiers {
            doi: Some("10.1038/nature12373".to_string()),
            isbn: Some("9780306406157".to_string()),
            ..Default::default()
        };

        let doi_uri = doi_server.uri();
        let isbn_uri = isbn_server.uri();
        let result = resolve_to_bib_entry_with_base(
            &client,
            &identifiers,
            None,
            true,
            &BaseUrls {
                doi: &doi_uri,
                crossref: &doi_uri,
                arxiv: "http://localhost:1",
                open_library: &isbn_uri,
                google_books: &isbn_uri,
            },
        )
        .await;

        let meta = result.expect("should succeed").expect("should have metadata");
        assert_eq!(meta.source, ResolutionSource::DoiContentNegotiation);
    }

    #[tokio::test]
    async fn isbn_empty_title_falls_through_to_title_search() {
        let ol_server = MockServer::start().await;
        let crossref_server = MockServer::start().await;
        let client = test_client();

        // Open Library returns a book with empty title — should be rejected
        let ol_response = r#"{"ISBN:9780306406157":{"title":"","authors":[{"name":"Someone"}],"publishers":[{"name":"Pub"}],"publish_date":"2000","identifiers":{"isbn_13":["9780306406157"]}}}"#;

        Mock::given(method("GET"))
            .and(path("/api/books"))
            .and(query_param("bibkeys", "ISBN:9780306406157"))
            .respond_with(ResponseTemplate::new(200).set_body_string(ol_response))
            .mount(&ol_server)
            .await;

        // Google Books also returns empty — ISBN fully fails
        Mock::given(method("GET"))
            .and(path("/books/v1/volumes"))
            .respond_with(
                ResponseTemplate::new(200).set_body_string(r#"{"totalItems":0,"items":[]}"#),
            )
            .mount(&ol_server)
            .await;

        // CrossRef title search picks it up
        let crossref_response = r#"{
            "status": "ok",
            "message": {
                "items": [{
                    "title": ["Fundamentals of Wavelets"],
                    "author": [{"family": "Goswami", "given": "Jaideva"}],
                    "container-title": ["Wiley"],
                    "issued": {"date-parts": [[1999]]},
                    "type": "journal-article",
                    "DOI": "10.1000/test123"
                }]
            }
        }"#;

        Mock::given(method("GET"))
            .and(path("/works"))
            .respond_with(ResponseTemplate::new(200).set_body_string(crossref_response))
            .mount(&crossref_server)
            .await;

        let identifiers = ExtractedIdentifiers {
            isbn: Some("9780306406157".to_string()),
            ..Default::default()
        };

        let crossref_uri = crossref_server.uri();
        let ol_uri = ol_server.uri();
        let result = resolve_to_bib_entry_with_base(
            &client,
            &identifiers,
            Some("Fundamentals of Wavelets"),
            false,
            &BaseUrls {
                doi: "http://localhost:1",
                crossref: &crossref_uri,
                arxiv: "http://localhost:1",
                open_library: &ol_uri,
                google_books: &ol_uri,
            },
        )
        .await;

        let meta = result.expect("should succeed").expect("should have metadata");
        assert_eq!(meta.source, ResolutionSource::CrossrefTitleSearch);
    }

    #[tokio::test]
    async fn isbn_untrusted_with_mismatching_title_falls_through() {
        let ol_server = MockServer::start().await;
        let crossref_server = MockServer::start().await;
        let client = test_client();

        // Open Library returns a real book — but it's not the paper we extracted
        let ol_response = r#"{"ISBN:9780306406157":{"title":"Fundamentals of Wavelets","authors":[{"name":"Jaideva Goswami"}],"publishers":[{"name":"Wiley"}],"publish_date":"1999","identifiers":{"isbn_13":["9780306406157"]}}}"#;

        Mock::given(method("GET"))
            .and(path("/api/books"))
            .and(query_param("bibkeys", "ISBN:9780306406157"))
            .respond_with(ResponseTemplate::new(200).set_body_string(ol_response))
            .mount(&ol_server)
            .await;

        // CrossRef title search returns the paper matching the extracted title
        let crossref_response = r#"{
            "status": "ok",
            "message": {
                "items": [{
                    "title": ["Completely Different Paper"],
                    "author": [{"family": "Smith", "given": "Jane"}],
                    "container-title": ["Some Journal"],
                    "issued": {"date-parts": [[2023]]},
                    "type": "journal-article",
                    "DOI": "10.1000/different456"
                }]
            }
        }"#;

        Mock::given(method("GET"))
            .and(path("/works"))
            .respond_with(ResponseTemplate::new(200).set_body_string(crossref_response))
            .mount(&crossref_server)
            .await;

        let identifiers = ExtractedIdentifiers {
            isbn: Some("9780306406157".to_string()),
            ..Default::default()
        };

        let crossref_uri = crossref_server.uri();
        let ol_uri = ol_server.uri();
        let result = resolve_to_bib_entry_with_base(
            &client,
            &identifiers,
            Some("Completely Different Paper"),
            false,
            &BaseUrls {
                doi: "http://localhost:1",
                crossref: &crossref_uri,
                arxiv: "http://localhost:1",
                open_library: &ol_uri,
                google_books: "http://localhost:1",
            },
        )
        .await;

        let meta = result.expect("should succeed").expect("should have metadata");
        assert_eq!(
            meta.source,
            ResolutionSource::CrossrefTitleSearch,
            "ISBN with mismatching title should be rejected when untrusted"
        );
        assert_eq!(meta.validation, Validation::Validated);
    }

    #[tokio::test]
    async fn isbn_untrusted_with_matching_title_accepts() {
        let ol_server = MockServer::start().await;
        let client = test_client();

        let ol_response = r#"{"ISBN:9780306406157":{"title":"Fundamentals of Wavelets","authors":[{"name":"Jaideva Goswami"}],"publishers":[{"name":"Wiley"}],"publish_date":"1999","identifiers":{"isbn_13":["9780306406157"]}}}"#;

        Mock::given(method("GET"))
            .and(path("/api/books"))
            .and(query_param("bibkeys", "ISBN:9780306406157"))
            .respond_with(ResponseTemplate::new(200).set_body_string(ol_response))
            .mount(&ol_server)
            .await;

        let identifiers = ExtractedIdentifiers {
            isbn: Some("9780306406157".to_string()),
            ..Default::default()
        };

        let ol_uri = ol_server.uri();
        let result = resolve_to_bib_entry_with_base(
            &client,
            &identifiers,
            Some("Fundamentals of Wavelets"),
            false,
            &BaseUrls {
                doi: "http://localhost:1",
                crossref: "http://localhost:1",
                arxiv: "http://localhost:1",
                open_library: &ol_uri,
                google_books: "http://localhost:1",
            },
        )
        .await;

        let meta = result.expect("should succeed").expect("should have metadata");
        assert_eq!(
            meta.source,
            ResolutionSource::OpenLibraryApi,
            "ISBN with matching title should be accepted even when untrusted"
        );
        assert_eq!(meta.validation, Validation::Validated);
    }

    #[tokio::test]
    async fn isbn_untrusted_with_no_extracted_title_accepts() {
        let ol_server = MockServer::start().await;
        let client = test_client();

        let ol_response = r#"{"ISBN:9780306406157":{"title":"Fundamentals of Wavelets","authors":[{"name":"Jaideva Goswami"}],"publishers":[{"name":"Wiley"}],"publish_date":"1999","identifiers":{"isbn_13":["9780306406157"]}}}"#;

        Mock::given(method("GET"))
            .and(path("/api/books"))
            .and(query_param("bibkeys", "ISBN:9780306406157"))
            .respond_with(ResponseTemplate::new(200).set_body_string(ol_response))
            .mount(&ol_server)
            .await;

        let identifiers = ExtractedIdentifiers {
            isbn: Some("9780306406157".to_string()),
            ..Default::default()
        };

        let ol_uri = ol_server.uri();
        let result = resolve_to_bib_entry_with_base(
            &client,
            &identifiers,
            None,
            false,
            &BaseUrls {
                doi: "http://localhost:1",
                crossref: "http://localhost:1",
                arxiv: "http://localhost:1",
                open_library: &ol_uri,
                google_books: "http://localhost:1",
            },
        )
        .await;

        let meta = result.expect("should succeed").expect("should have metadata");
        assert_eq!(
            meta.source,
            ResolutionSource::OpenLibraryApi,
            "ISBN with no extracted title should be accepted even when untrusted"
        );
        assert_eq!(
            meta.validation,
            Validation::Skipped,
            "no extracted title means validation is skipped"
        );
    }

    #[tokio::test]
    async fn isbn_trusted_skips_validation() {
        let ol_server = MockServer::start().await;
        let client = test_client();

        let ol_response = r#"{"ISBN:9780306406157":{"title":"Fundamentals of Wavelets","authors":[{"name":"Jaideva Goswami"}],"publishers":[{"name":"Wiley"}],"publish_date":"1999","identifiers":{"isbn_13":["9780306406157"]}}}"#;

        Mock::given(method("GET"))
            .and(path("/api/books"))
            .and(query_param("bibkeys", "ISBN:9780306406157"))
            .respond_with(ResponseTemplate::new(200).set_body_string(ol_response))
            .mount(&ol_server)
            .await;

        let identifiers = ExtractedIdentifiers {
            isbn: Some("9780306406157".to_string()),
            ..Default::default()
        };

        let ol_uri = ol_server.uri();
        let result = resolve_to_bib_entry_with_base(
            &client,
            &identifiers,
            Some("Totally Different Title"),
            true,
            &BaseUrls {
                doi: "http://localhost:1",
                crossref: "http://localhost:1",
                arxiv: "http://localhost:1",
                open_library: &ol_uri,
                google_books: "http://localhost:1",
            },
        )
        .await;

        let meta = result.expect("should succeed").expect("should have metadata");
        assert_eq!(
            meta.source,
            ResolutionSource::OpenLibraryApi,
            "trusted ISBN should be accepted regardless of title mismatch"
        );
        assert_eq!(
            meta.validation,
            Validation::Skipped,
            "trusted source skips validation"
        );
    }
}
