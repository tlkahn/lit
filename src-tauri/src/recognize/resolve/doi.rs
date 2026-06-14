use crate::bib::convert::{csl_to_bib_entry, is_valid_doi, CslItem};
use crate::bib::types::BibEntry;
use crate::commands::bib_import::parse_crossref_body;
use super::ResolveError;

/// Percent-encode the subset of URL-reserved characters that can appear in
/// a validated DOI suffix but would break URL path semantics.
///
/// **Precondition:** `doi` has already passed [`is_valid_doi`], which
/// enforces the `^10.\d{4,}/\S+$` pattern -- so whitespace and control
/// characters are already excluded.
///
/// The encoded characters and why they need escaping:
/// - `#` -- would be parsed as a fragment delimiter
/// - `?` -- would be parsed as a query-string delimiter
/// - `%` -- must be escaped to avoid ambiguous percent-sequences
/// - `<`, `>` -- not valid in URI paths per RFC 3986 section 2.2
///
/// Characters like `/`, `(`, `)`, `:`, `;` are legal in URI path segments
/// (RFC 3986 sub-delims / pchar) and left as-is.
pub(crate) fn percent_encode_doi_path(doi: &str) -> String {
    let mut out = String::with_capacity(doi.len() + 16);
    for ch in doi.chars() {
        match ch {
            '#' => out.push_str("%23"),
            '?' => out.push_str("%3F"),
            '%' => out.push_str("%25"),
            '<' => out.push_str("%3C"),
            '>' => out.push_str("%3E"),
            _ => out.push(ch),
        }
    }
    out
}

/// Which internal path `resolve_doi_with_base` used to obtain the result.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum DoiPath {
    /// Resolved via doi.org content negotiation (CSL-JSON).
    ContentNegotiation,
    /// doi.org failed; resolved via the CrossRef `/works/{doi}` API.
    CrossrefFallback,
}

/// Resolve a DOI to a `BibEntry` via content negotiation at doi.org,
/// with automatic fallback to the CrossRef API.
///
/// - `client`: a pre-configured `reqwest::Client` — should have a timeout
///   (recommended 10 s) and a `User-Agent` header (CrossRef etiquette requires
///   an identifying UA for polite access). In production, use
///   [`crate::commands::bib_import::HTTP_CLIENT`].
/// - `doi`: bare DOI string (e.g. `"10.1038/nature12373"`)
/// - `doi_base_url`: base URL for content negotiation (production: `"https://doi.org"`)
/// - `crossref_base_url`: base URL for CrossRef API (production: `"https://api.crossref.org"`)
///
/// Returns the resolved `BibEntry` together with a `DoiPath` indicating
/// which resolution strategy succeeded.
pub async fn resolve_doi_with_base(
    client: &reqwest::Client,
    doi: &str,
    doi_base_url: &str,
    crossref_base_url: &str,
) -> Result<(BibEntry, DoiPath), ResolveError> {
    if !is_valid_doi(doi) {
        return Err(ResolveError::Parse(format!("Invalid DOI: {}", doi)));
    }

    // 1. Content negotiation attempt via doi.org
    if let Some(result) = try_content_negotiation(client, doi, doi_base_url).await? {
        return Ok((result, DoiPath::ContentNegotiation));
    }

    // 2. CrossRef fallback
    try_crossref(client, doi, crossref_base_url)
        .await
        .map(|entry| (entry, DoiPath::CrossrefFallback))
}

/// Attempt content negotiation at doi.org. Returns:
/// - `Ok(Some(entry))` on success
/// - `Ok(None)` when doi.org fails but CrossRef should be tried (404, timeout, parse error)
/// - `Err(RateLimited)` on 429 (caller should NOT retry via CrossRef)
async fn try_content_negotiation(
    client: &reqwest::Client,
    doi: &str,
    doi_base_url: &str,
) -> Result<Option<BibEntry>, ResolveError> {
    let url = format!("{}/{}", doi_base_url, percent_encode_doi_path(doi));
    let resp = match client
        .get(&url)
        .header("Accept", "application/vnd.citationstyles.csl+json")
        .send()
        .await
    {
        Ok(resp) => resp,
        Err(_) => return Ok(None), // timeout or network error — fall through
    };

    let resp = match super::check_status(resp, "doi.org") {
        Ok(resp) => resp,
        Err(ResolveError::RateLimited) => return Err(ResolveError::RateLimited),
        Err(_) => return Ok(None), // 404 or other non-success — fall through to CrossRef
    };

    let body = resp
        .text()
        .await
        .map_err(|e| ResolveError::Parse(format!("Failed to read doi.org response: {}", e)))?;

    match serde_json::from_str::<CslItem>(&body) {
        Ok(item) => Ok(Some(csl_to_bib_entry(&item))),
        Err(_) => Ok(None), // parse failed — fall through to CrossRef
    }
}

/// Fetch metadata from the CrossRef API.
async fn try_crossref(
    client: &reqwest::Client,
    doi: &str,
    crossref_base_url: &str,
) -> Result<BibEntry, ResolveError> {
    let url = format!("{}/works/{}", crossref_base_url, percent_encode_doi_path(doi));
    let resp = client.get(&url).send().await.map_err(|e| {
        ResolveError::Http(format!("CrossRef request failed: {}", e))
    })?;

    if resp.status() == reqwest::StatusCode::NOT_FOUND {
        return Err(ResolveError::Http(
            "DOI not found on CrossRef (doi.org content negotiation also failed)".into(),
        ));
    }
    let resp = super::check_status(resp, "CrossRef API")?;

    let body = resp.text().await.map_err(|e| {
        ResolveError::Parse(format!("Failed to read CrossRef response: {}", e))
    })?;

    parse_crossref_body(&body).map_err(ResolveError::Parse)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn content_negotiation_happy_path() {
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

        let result = resolve_doi_with_base(
            &client,
            "10.1038/nature12373",
            &server.uri(),
            &server.uri(),
        )
        .await;

        let (entry, doi_path) = result.expect("should resolve successfully");
        assert_eq!(doi_path, DoiPath::ContentNegotiation);
        assert_eq!(entry.title, "Probing condensed matter physics");
        assert_eq!(entry.authors, vec!["Kucsko, Georg"]);
        assert_eq!(entry.year, "2013");
        assert_eq!(entry.doi, Some("10.1038/nature12373".to_string()));
        assert_eq!(entry.entry_type, "article");
        assert_eq!(entry.journal, Some("Nature".to_string()));
    }

    #[tokio::test]
    async fn doi_org_404_falls_back_to_crossref() {
        use wiremock::matchers::{method, path};
        use wiremock::{Mock, MockServer, ResponseTemplate};

        let server = MockServer::start().await;
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(5))
            .build()
            .unwrap();

        // doi.org returns 404
        Mock::given(method("GET"))
            .and(path("/10.1038/nature12373"))
            .respond_with(ResponseTemplate::new(404))
            .mount(&server)
            .await;

        // CrossRef fallback returns valid JSON
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

        let result = resolve_doi_with_base(
            &client,
            "10.1038/nature12373",
            &server.uri(),
            &server.uri(),
        )
        .await;

        let (entry, doi_path) = result.expect("should resolve via CrossRef fallback");
        assert_eq!(doi_path, DoiPath::CrossrefFallback);
        assert_eq!(entry.title, "Probing condensed matter physics");
        assert_eq!(entry.authors, vec!["Kucsko, Georg"]);
        assert_eq!(entry.year, "2013");
        assert_eq!(entry.doi, Some("10.1038/nature12373".to_string()));
    }

    #[tokio::test]
    async fn doi_org_timeout_falls_back_to_crossref() {
        use wiremock::matchers::{method, path};
        use wiremock::{Mock, MockServer, ResponseTemplate};

        let server = MockServer::start().await;
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(1))
            .build()
            .unwrap();

        // doi.org takes too long (30s delay, client timeout is 1s)
        Mock::given(method("GET"))
            .and(path("/10.1038/nature12373"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_delay(std::time::Duration::from_secs(30)),
            )
            .mount(&server)
            .await;

        // CrossRef returns immediately
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

        let result = resolve_doi_with_base(
            &client,
            "10.1038/nature12373",
            &server.uri(),
            &server.uri(),
        )
        .await;

        let (entry, doi_path) = result.expect("should resolve via CrossRef after doi.org timeout");
        assert_eq!(doi_path, DoiPath::CrossrefFallback);
        assert_eq!(entry.title, "Probing condensed matter physics");
    }

    #[tokio::test]
    async fn both_fail_returns_error() {
        use wiremock::matchers::{method, path};
        use wiremock::{Mock, MockServer, ResponseTemplate};

        let server = MockServer::start().await;
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(5))
            .build()
            .unwrap();

        // doi.org returns 404
        Mock::given(method("GET"))
            .and(path("/10.1038/nature12373"))
            .respond_with(ResponseTemplate::new(404))
            .mount(&server)
            .await;

        // CrossRef also returns 404
        Mock::given(method("GET"))
            .and(path("/works/10.1038/nature12373"))
            .respond_with(ResponseTemplate::new(404))
            .mount(&server)
            .await;

        let result = resolve_doi_with_base(
            &client,
            "10.1038/nature12373",
            &server.uri(),
            &server.uri(),
        )
        .await;

        assert!(result.is_err());
        match result.unwrap_err() {
            ResolveError::Http(msg) => {
                assert!(
                    msg.contains("not found"),
                    "error message should mention not found, got: {}",
                    msg
                );
            }
            other => panic!("expected ResolveError::Http, got {:?}", other),
        }
    }

    #[tokio::test]
    async fn rate_limited_returns_immediately() {
        use wiremock::matchers::{method, path};
        use wiremock::{Mock, MockServer, ResponseTemplate};

        let server = MockServer::start().await;
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(5))
            .build()
            .unwrap();

        // doi.org returns 429 -- should NOT fall through to CrossRef
        Mock::given(method("GET"))
            .and(path("/10.1038/nature12373"))
            .respond_with(ResponseTemplate::new(429))
            .mount(&server)
            .await;

        // No CrossRef mock mounted -- if it falls through, wiremock returns 404

        let result = resolve_doi_with_base(
            &client,
            "10.1038/nature12373",
            &server.uri(),
            &server.uri(),
        )
        .await;

        assert!(result.is_err());
        match result.unwrap_err() {
            ResolveError::RateLimited => {} // expected
            other => panic!("expected ResolveError::RateLimited, got {:?}", other),
        }
    }

    #[tokio::test]
    async fn doi_with_angle_brackets_encodes_path_correctly() {
        use wiremock::matchers::{header, method, path};
        use wiremock::{Mock, MockServer, ResponseTemplate};

        let server = MockServer::start().await;
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(5))
            .build()
            .unwrap();

        // SICI DOI with <, >, (, ), :, ; — only < and > need encoding
        let sici_doi = "10.1002/(SICI)1097-4571(199009)41:6<391::AID-ASI1>3.0.CO;2-9";
        let encoded_path =
            "/10.1002/(SICI)1097-4571(199009)41:6%3C391::AID-ASI1%3E3.0.CO;2-9";

        let csl_json = r#"{
            "type": "journal-article",
            "title": "SICI Test Article",
            "author": [{"family": "Test", "given": "Author"}],
            "issued": {"date-parts": [[1990]]},
            "DOI": "10.1002/(SICI)1097-4571(199009)41:6<391::AID-ASI1>3.0.CO;2-9"
        }"#;

        Mock::given(method("GET"))
            .and(path(encoded_path))
            .and(header("Accept", "application/vnd.citationstyles.csl+json"))
            .respond_with(ResponseTemplate::new(200).set_body_string(csl_json))
            .mount(&server)
            .await;

        let result = resolve_doi_with_base(
            &client,
            sici_doi,
            &server.uri(),
            &server.uri(),
        )
        .await;

        let (entry, _doi_path) = result.expect("should resolve SICI DOI with encoded angle brackets");
        assert_eq!(entry.title, "SICI Test Article");
    }

    #[tokio::test]
    async fn doi_with_hash_encodes_correctly() {
        use wiremock::matchers::{header, method, path};
        use wiremock::{Mock, MockServer, ResponseTemplate};

        let server = MockServer::start().await;
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(5))
            .build()
            .unwrap();

        let doi_with_hash = "10.1000/test#fragment";
        let encoded_path = "/10.1000/test%23fragment";

        let csl_json = r#"{
            "type": "journal-article",
            "title": "Hash Test Article",
            "author": [{"family": "Hash", "given": "Test"}],
            "issued": {"date-parts": [[2020]]},
            "DOI": "10.1000/test#fragment"
        }"#;

        Mock::given(method("GET"))
            .and(path(encoded_path))
            .and(header("Accept", "application/vnd.citationstyles.csl+json"))
            .respond_with(ResponseTemplate::new(200).set_body_string(csl_json))
            .mount(&server)
            .await;

        let result = resolve_doi_with_base(
            &client,
            doi_with_hash,
            &server.uri(),
            &server.uri(),
        )
        .await;

        let (entry, _doi_path) = result.expect("should resolve DOI with encoded hash");
        assert_eq!(entry.title, "Hash Test Article");
    }

    #[tokio::test]
    async fn doi_with_percent_encodes_correctly() {
        use wiremock::matchers::{header, method, path};
        use wiremock::{Mock, MockServer, ResponseTemplate};

        let server = MockServer::start().await;
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(5))
            .build()
            .unwrap();

        let doi_with_pct = "10.1000/test%value";
        let encoded_path = "/10.1000/test%25value";

        let csl_json = r#"{
            "type": "journal-article",
            "title": "Percent Test Article",
            "author": [{"family": "Pct", "given": "Test"}],
            "issued": {"date-parts": [[2020]]},
            "DOI": "10.1000/test%value"
        }"#;

        Mock::given(method("GET"))
            .and(path(encoded_path))
            .and(header("Accept", "application/vnd.citationstyles.csl+json"))
            .respond_with(ResponseTemplate::new(200).set_body_string(csl_json))
            .mount(&server)
            .await;

        let result = resolve_doi_with_base(
            &client,
            doi_with_pct,
            &server.uri(),
            &server.uri(),
        )
        .await;

        let (entry, _doi_path) = result.expect("should resolve DOI with encoded percent");
        assert_eq!(entry.title, "Percent Test Article");
    }

    #[tokio::test]
    async fn invalid_doi_rejected_without_http() {
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(5))
            .build()
            .unwrap();

        // Use unreachable base URLs — if any HTTP call is attempted, it will fail
        let result = resolve_doi_with_base(
            &client,
            "not-a-doi",
            "http://localhost:1",
            "http://localhost:1",
        )
        .await;

        assert!(result.is_err());
        match result.unwrap_err() {
            ResolveError::Parse(msg) => {
                assert!(
                    msg.contains("Invalid DOI"),
                    "error message should mention Invalid DOI, got: {}",
                    msg
                );
            }
            other => panic!("expected ResolveError::Parse, got {:?}", other),
        }
    }

    #[tokio::test]
    async fn crossref_fallback_also_encodes_special_chars() {
        use wiremock::matchers::{method, path};
        use wiremock::{Mock, MockServer, ResponseTemplate};

        let server = MockServer::start().await;
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(5))
            .build()
            .unwrap();

        let sici_doi = "10.1002/(SICI)1097-4571(199009)41:6<391::AID-ASI1>3.0.CO;2-9";
        let encoded_doi_path =
            "/10.1002/(SICI)1097-4571(199009)41:6%3C391::AID-ASI1%3E3.0.CO;2-9";
        let encoded_crossref_path =
            "/works/10.1002/(SICI)1097-4571(199009)41:6%3C391::AID-ASI1%3E3.0.CO;2-9";

        // doi.org returns 404 on the encoded path
        Mock::given(method("GET"))
            .and(path(encoded_doi_path))
            .respond_with(ResponseTemplate::new(404))
            .mount(&server)
            .await;

        // CrossRef mock matches the encoded path
        let crossref_json = r#"{
            "status": "ok",
            "message": {
                "type": "journal-article",
                "title": ["SICI Crossref Article"],
                "author": [{"family": "Test", "given": "Author"}],
                "issued": {"date-parts": [[1990]]},
                "DOI": "10.1002/(SICI)1097-4571(199009)41:6<391::AID-ASI1>3.0.CO;2-9"
            }
        }"#;

        Mock::given(method("GET"))
            .and(path(encoded_crossref_path))
            .respond_with(ResponseTemplate::new(200).set_body_string(crossref_json))
            .mount(&server)
            .await;

        let result = resolve_doi_with_base(
            &client,
            sici_doi,
            &server.uri(),
            &server.uri(),
        )
        .await;

        let (entry, doi_path) = result.expect("should resolve SICI DOI via CrossRef with encoded path");
        assert_eq!(doi_path, DoiPath::CrossrefFallback);
        assert_eq!(entry.title, "SICI Crossref Article");
    }
}
