use serde::Deserialize;

use crate::bib::convert::{csl_to_bib_entry, CslItem};
use crate::bib::types::BibEntry;
use super::ResolveError;

#[derive(Deserialize)]
struct CrossrefSearchResponse {
    message: CrossrefSearchMessage,
}

#[derive(Deserialize)]
struct CrossrefSearchMessage {
    items: Vec<CslItem>,
}

/// Search CrossRef by bibliographic title and optional author names.
///
/// Returns up to `rows` BibEntry results from the CrossRef search API.
///
/// - `client`: a pre-configured `reqwest::Client`
/// - `title`: the title to search for
/// - `authors`: optional author names to include in the query
/// - `base_url`: base URL for CrossRef API (production: `"https://api.crossref.org"`)
pub async fn search_crossref_by_title_with_base(
    client: &reqwest::Client,
    title: &str,
    authors: &[String],
    base_url: &str,
) -> Result<Vec<BibEntry>, ResolveError> {
    let mut query_params: Vec<(&str, &str)> = vec![
        ("query.bibliographic", title),
        ("rows", "5"),
    ];

    let authors_joined;
    if !authors.is_empty() {
        authors_joined = authors.join(" ");
        query_params.push(("query.author", &authors_joined));
    }

    let resp = client
        .get(format!("{}/works", base_url))
        .query(&query_params)
        .send()
        .await
        .map_err(|e| ResolveError::Http(format!("CrossRef search request failed: {}", e)))?;

    let status = resp.status();
    if status == reqwest::StatusCode::TOO_MANY_REQUESTS {
        return Err(ResolveError::RateLimited);
    }
    if !status.is_success() {
        return Err(ResolveError::Http(format!(
            "CrossRef search API returned status {}",
            status
        )));
    }

    let body = resp.text().await.map_err(|e| {
        ResolveError::Parse(format!("Failed to read CrossRef search response: {}", e))
    })?;

    let parsed: CrossrefSearchResponse = serde_json::from_str(&body).map_err(|e| {
        ResolveError::Parse(format!("Failed to parse CrossRef search response: {}", e))
    })?;

    Ok(parsed
        .message
        .items
        .iter()
        .map(csl_to_bib_entry)
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use wiremock::matchers::{method, path, query_param};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    const SEARCH_RESPONSE_5_HITS: &str = r#"{
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
                },
                {
                    "type": "journal-article",
                    "title": ["Attention Is All You Need: Revisited"],
                    "author": [{"family": "Doe", "given": "John"}],
                    "issued": {"date-parts": [[2020]]}
                },
                {
                    "type": "journal-article",
                    "title": ["Self-Attention in Neural Networks"],
                    "author": [{"family": "Smith", "given": "Jane"}],
                    "issued": {"date-parts": [[2019]]}
                },
                {
                    "type": "journal-article",
                    "title": ["Transformer Models Survey"],
                    "author": [{"family": "Lee", "given": "Chris"}],
                    "issued": {"date-parts": [[2021]]}
                },
                {
                    "type": "journal-article",
                    "title": ["Multi-Head Attention Mechanisms"],
                    "author": [{"family": "Park", "given": "Jin"}],
                    "issued": {"date-parts": [[2022]]}
                }
            ]
        }
    }"#;

    const SEARCH_RESPONSE_EMPTY: &str = r#"{
        "status": "ok",
        "message-type": "work-list",
        "message": {
            "items": []
        }
    }"#;

    fn test_client() -> reqwest::Client {
        reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(5))
            .build()
            .unwrap()
    }

    #[tokio::test]
    async fn search_returns_hits() {
        let server = MockServer::start().await;
        let client = test_client();

        Mock::given(method("GET"))
            .and(path("/works"))
            .and(query_param("query.bibliographic", "Attention Is All You Need"))
            .respond_with(
                ResponseTemplate::new(200).set_body_string(SEARCH_RESPONSE_5_HITS),
            )
            .mount(&server)
            .await;

        let result = search_crossref_by_title_with_base(
            &client,
            "Attention Is All You Need",
            &[],
            &server.uri(),
        )
        .await;

        let entries = result.expect("should return Ok");
        assert_eq!(entries.len(), 5);
        assert_eq!(entries[0].title, "Attention Is All You Need");
        assert_eq!(entries[0].authors, vec!["Vaswani, Ashish"]);
        assert_eq!(entries[0].year, "2017");
        assert_eq!(
            entries[0].doi,
            Some("10.5555/3295222.3295349".to_string())
        );
        assert_eq!(entries[0].entry_type, "article");
        assert_eq!(
            entries[0].journal,
            Some("Advances in Neural Information Processing Systems".to_string())
        );
    }

    #[tokio::test]
    async fn search_returns_empty() {
        let server = MockServer::start().await;
        let client = test_client();

        Mock::given(method("GET"))
            .and(path("/works"))
            .respond_with(
                ResponseTemplate::new(200).set_body_string(SEARCH_RESPONSE_EMPTY),
            )
            .mount(&server)
            .await;

        let result = search_crossref_by_title_with_base(
            &client,
            "Some Nonexistent Paper",
            &[],
            &server.uri(),
        )
        .await;

        let entries = result.expect("should return Ok with empty vec");
        assert!(entries.is_empty());
    }

    #[tokio::test]
    async fn search_rate_limited() {
        let server = MockServer::start().await;
        let client = test_client();

        Mock::given(method("GET"))
            .and(path("/works"))
            .respond_with(ResponseTemplate::new(429))
            .mount(&server)
            .await;

        let result = search_crossref_by_title_with_base(
            &client,
            "Attention Is All You Need",
            &[],
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
    async fn search_with_authors_includes_query_author_param() {
        let server = MockServer::start().await;
        let client = test_client();

        Mock::given(method("GET"))
            .and(path("/works"))
            .and(query_param("query.bibliographic", "Attention Is All You Need"))
            .and(query_param("query.author", "Vaswani Ashish"))
            .respond_with(
                ResponseTemplate::new(200).set_body_string(SEARCH_RESPONSE_5_HITS),
            )
            .mount(&server)
            .await;

        let authors = vec!["Vaswani".to_string(), "Ashish".to_string()];
        let result = search_crossref_by_title_with_base(
            &client,
            "Attention Is All You Need",
            &authors,
            &server.uri(),
        )
        .await;

        let entries = result.expect("should return Ok when authors param matches");
        assert_eq!(entries.len(), 5);
    }
}
