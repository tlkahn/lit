use std::fmt;

use serde::Serialize;

use crate::bib::types::BibEntry;
use crate::recognize::identifiers::ExtractedIdentifiers;

pub mod arxiv;
pub mod crossref_search;
pub mod doi;
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

#[derive(Debug, Clone, PartialEq, Serialize)]
pub enum ResolutionSource {
    DoiContentNegotiation,
    CrossrefApi,
    ArxivApi,
    CrossrefTitleSearch,
}

#[derive(Debug, Clone, Serialize)]
pub struct ResolvedMetadata {
    pub entry: BibEntry,
    pub source: ResolutionSource,
    pub cross_validated: Option<bool>,
}

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
        "https://doi.org",
        "https://api.crossref.org",
        "https://export.arxiv.org",
    )
    .await
}

/// Cross-validate a resolved entry against an extracted title.
///
/// Returns `Some(metadata)` if the entry should be accepted, `None` if the
/// title mismatch means we should discard and try the next resolution path.
fn cross_validate(
    entry: BibEntry,
    source: ResolutionSource,
    extracted_title: Option<&str>,
    trusted: bool,
) -> Option<ResolvedMetadata> {
    if trusted || extracted_title.is_none() {
        return Some(ResolvedMetadata {
            entry,
            source,
            cross_validated: None,
        });
    }

    let title = extracted_title.unwrap();
    if title_match::titles_match(&entry.title, title) {
        Some(ResolvedMetadata {
            entry,
            source,
            cross_validated: Some(true),
        })
    } else {
        None // mismatch — caller should fall through
    }
}

async fn resolve_to_bib_entry_with_base(
    client: &reqwest::Client,
    identifiers: &ExtractedIdentifiers,
    extracted_title: Option<&str>,
    trusted: bool,
    doi_base_url: &str,
    crossref_base_url: &str,
    arxiv_base_url: &str,
) -> Result<Option<ResolvedMetadata>, ResolveError> {
    // Step 1: DOI resolution
    if let Some(ref doi_str) = identifiers.doi {
        match doi::resolve_doi_with_base(client, doi_str, doi_base_url, crossref_base_url).await {
            Err(ResolveError::RateLimited) => return Err(ResolveError::RateLimited),
            Ok(entry) => {
                if let Some(meta) = cross_validate(
                    entry,
                    ResolutionSource::DoiContentNegotiation,
                    extracted_title,
                    trusted,
                ) {
                    return Ok(Some(meta));
                }
            }
            Err(_) => {} // non-rate-limit error — fall through
        }
    }

    // Step 2: arXiv resolution
    if let Some(ref arxiv_id) = identifiers.arxiv {
        match arxiv::resolve_arxiv_with_base(client, arxiv_id, arxiv_base_url).await {
            Err(ResolveError::RateLimited) => return Err(ResolveError::RateLimited),
            Ok(entry) => {
                if let Some(meta) = cross_validate(
                    entry,
                    ResolutionSource::ArxivApi,
                    extracted_title,
                    trusted,
                ) {
                    return Ok(Some(meta));
                }
            }
            Err(_) => {} // non-rate-limit error — fall through
        }
    }

    // Step 3: CrossRef title search
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
            crossref_base_url,
        )
        .await
        {
            Err(ResolveError::RateLimited) => return Err(ResolveError::RateLimited),
            Ok(candidates) => {
                if let Some(best) = title_match::best_title_match(&candidates, title) {
                    if authors.is_empty()
                        || title_match::authors_overlap(&best.authors, &authors)
                    {
                        return Ok(Some(ResolvedMetadata {
                            entry: best.clone(),
                            source: ResolutionSource::CrossrefTitleSearch,
                            cross_validated: Some(true),
                        }));
                    }
                }
            }
            Err(_) => {} // non-rate-limit error — fall through
        }
    }

    // Step 4: All paths exhausted
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

        let result = resolve_to_bib_entry_with_base(
            &client,
            &identifiers,
            None,
            true,
            &server.uri(),
            &server.uri(),
            &server.uri(),
        )
        .await;

        let meta = result.expect("should succeed").expect("should have metadata");
        assert_eq!(meta.source, ResolutionSource::DoiContentNegotiation);
        assert_eq!(meta.entry.title, "Probing condensed matter physics");
        assert_eq!(meta.cross_validated, None);
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

        let result = resolve_to_bib_entry_with_base(
            &client,
            &identifiers,
            None,
            true,
            &doi_server.uri(),
            &doi_server.uri(),
            &arxiv_server.uri(),
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

        let result = resolve_to_bib_entry_with_base(
            &client,
            &identifiers,
            Some("Attention Is All You Need"),
            false,
            &server.uri(),
            &server.uri(),
            &server.uri(),
        )
        .await;

        let meta = result.expect("should succeed").expect("should have metadata");
        assert_eq!(meta.source, ResolutionSource::CrossrefTitleSearch);
        assert_eq!(meta.entry.title, "Attention Is All You Need");
        assert_eq!(meta.cross_validated, Some(true));
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
            "http://localhost:1", // unreachable, but won't be called
            "http://localhost:1",
            "http://localhost:1",
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

        let result = resolve_to_bib_entry_with_base(
            &client,
            &identifiers,
            Some("Correct Paper Title"),
            false,
            &server.uri(),
            &server.uri(),
            &server.uri(),
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

        let result = resolve_to_bib_entry_with_base(
            &client,
            &identifiers,
            None,
            true,
            &server.uri(),
            &server.uri(),
            &server.uri(),
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

        let result = resolve_to_bib_entry_with_base(
            &client,
            &identifiers,
            Some("Completely Different Title"),
            true,
            &server.uri(),
            &server.uri(),
            &server.uri(),
        )
        .await;

        let meta = result.expect("should succeed").expect("should have metadata");
        assert_eq!(meta.cross_validated, None);
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

        let result = resolve_to_bib_entry_with_base(
            &client,
            &identifiers,
            Some("Some Paper"),
            false,
            &server.uri(),
            &server.uri(),
            &server.uri(),
        )
        .await;

        assert!(result.expect("should succeed").is_none());
    }
}
