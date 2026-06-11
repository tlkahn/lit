use crate::bib::convert::{csl_to_bib_entry, CslItem};
use crate::bib::types::BibEntry;
use crate::commands::bib_import::parse_crossref_body;
use super::ResolveError;

/// Resolve a DOI to a `BibEntry` via content negotiation at doi.org,
/// with automatic fallback to the CrossRef API.
///
/// - `client`: a pre-configured `reqwest::Client`
/// - `doi`: bare DOI string (e.g. `"10.1038/nature12373"`)
/// - `doi_base_url`: base URL for content negotiation (production: `"https://doi.org"`)
/// - `crossref_base_url`: base URL for CrossRef API (production: `"https://api.crossref.org"`)
pub async fn resolve_doi_with_base(
    client: &reqwest::Client,
    doi: &str,
    doi_base_url: &str,
    crossref_base_url: &str,
) -> Result<BibEntry, ResolveError> {
    // 1. Content negotiation attempt via doi.org
    if let Some(result) = try_content_negotiation(client, doi, doi_base_url).await? {
        return Ok(result);
    }

    // 2. CrossRef fallback
    try_crossref(client, doi, crossref_base_url).await
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
    let url = format!("{}/{}", doi_base_url, doi);
    let resp = match client
        .get(&url)
        .header("Accept", "application/vnd.citationstyles.csl+json")
        .send()
        .await
    {
        Ok(resp) => resp,
        Err(_) => return Ok(None), // timeout or network error — fall through
    };

    let status = resp.status();
    if status == reqwest::StatusCode::TOO_MANY_REQUESTS {
        return Err(ResolveError::RateLimited);
    }
    if !status.is_success() {
        return Ok(None); // 404 or other — fall through to CrossRef
    }

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
    let url = format!("{}/works/{}", crossref_base_url, doi);
    let resp = client.get(&url).send().await.map_err(|e| {
        ResolveError::Http(format!("CrossRef request failed: {}", e))
    })?;

    let status = resp.status();
    if status == reqwest::StatusCode::TOO_MANY_REQUESTS {
        return Err(ResolveError::RateLimited);
    }
    if status == reqwest::StatusCode::NOT_FOUND {
        return Err(ResolveError::Http(
            "DOI not found on both doi.org and CrossRef".into(),
        ));
    }
    if !status.is_success() {
        return Err(ResolveError::Http(format!(
            "CrossRef API returned status {}",
            status
        )));
    }

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

        let entry = result.expect("should resolve successfully");
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

        let entry = result.expect("should resolve via CrossRef fallback");
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

        let entry = result.expect("should resolve via CrossRef after doi.org timeout");
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
}
