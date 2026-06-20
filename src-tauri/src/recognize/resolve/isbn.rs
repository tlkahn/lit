use std::time::Duration;

use serde::Deserialize;

use crate::bib::convert::{csl_to_bib_entry, CslDate, CslItem, CslName, StringOrSeq};
use crate::bib::types::BibEntry;
use crate::recognize::identifiers::normalize_to_isbn13;

use super::arxiv::split_flat_name;
use super::ResolveError;

/// Per-provider timeout for ISBN resolution.
///
/// The shared HTTP client has a
/// [`HTTP_CLIENT_TIMEOUT`](crate::commands::bib_import::HTTP_CLIENT_TIMEOUT)
/// client-level timeout; this tighter bound ensures the entire ISBN
/// stage (OL + GB sequentially) completes within that budget.
///
/// Invariant: `2 * ISBN_PROVIDER_TIMEOUT <= HTTP_CLIENT_TIMEOUT` (two
/// sequential providers must fit inside the client timeout).  A unit
/// test in this module enforces this.
pub(crate) const ISBN_PROVIDER_TIMEOUT: Duration = Duration::from_secs(5);

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum IsbnPath {
    OpenLibrary,
    GoogleBooks,
}

impl IsbnPath {
    pub fn provider_name(&self) -> &'static str {
        match self {
            IsbnPath::OpenLibrary => "open_library",
            IsbnPath::GoogleBooks => "google_books",
        }
    }
}

pub async fn resolve_isbn_with_base(
    client: &reqwest::Client,
    isbn: &str,
    open_library_base_url: &str,
    google_books_base_url: &str,
) -> Result<(BibEntry, IsbnPath), ResolveError> {
    resolve_isbn_impl(
        client,
        isbn,
        open_library_base_url,
        google_books_base_url,
        ISBN_PROVIDER_TIMEOUT,
    )
    .await
}

async fn resolve_isbn_impl(
    client: &reqwest::Client,
    isbn: &str,
    open_library_base_url: &str,
    google_books_base_url: &str,
    provider_timeout: Duration,
) -> Result<(BibEntry, IsbnPath), ResolveError> {
    let isbn13 = normalize_to_isbn13(isbn)
        .ok_or_else(|| ResolveError::Parse(format!("Invalid ISBN: {}", isbn)))?;

    match tokio::time::timeout(
        provider_timeout,
        try_open_library(client, &isbn13, open_library_base_url),
    )
    .await
    {
        Ok(Ok(Some(result))) => return Ok((result, IsbnPath::OpenLibrary)),
        Ok(Ok(None)) => {}
        Ok(Err(e)) => return Err(e),
        Err(_elapsed) => {
            tracing::warn!(
                "Open Library request timed out after {:?}, trying Google Books",
                provider_timeout
            );
        }
    }

    match tokio::time::timeout(
        provider_timeout,
        try_google_books(client, &isbn13, google_books_base_url),
    )
    .await
    {
        Ok(result) => result.map(|entry| (entry, IsbnPath::GoogleBooks)),
        Err(_elapsed) => {
            tracing::warn!(
                "Google Books request timed out after {:?}",
                provider_timeout
            );
            Err(ResolveError::Http(
                "ISBN resolution timed out (both providers)".into(),
            ))
        }
    }
}

// ── Open Library ─────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
struct OlBookData {
    title: Option<String>,
    authors: Option<Vec<OlAuthor>>,
    publishers: Option<Vec<OlPublisher>>,
    publish_date: Option<String>,
    identifiers: Option<OlIdentifiers>,
    url: Option<String>,
}

#[derive(Debug, Deserialize)]
struct OlAuthor {
    name: Option<String>,
}

#[derive(Debug, Deserialize)]
struct OlPublisher {
    name: Option<String>,
}

#[derive(Debug, Deserialize)]
struct OlIdentifiers {
    isbn_13: Option<Vec<String>>,
    isbn_10: Option<Vec<String>>,
}

async fn try_open_library(
    client: &reqwest::Client,
    isbn13: &str,
    base_url: &str,
) -> Result<Option<BibEntry>, ResolveError> {
    let url = format!(
        "{}/api/books?bibkeys=ISBN:{}&format=json&jscmd=data",
        base_url, isbn13
    );

    let resp = match client.get(&url).send().await {
        Ok(resp) => resp,
        Err(e) => {
            tracing::warn!(error = %e, "Open Library request failed, skipping");
            return Ok(None);
        }
    };

    let resp = match super::check_status(resp, "Open Library") {
        Ok(resp) => resp,
        Err(e) => {
            tracing::warn!(error = %e, "Open Library returned error, skipping");
            return Ok(None);
        }
    };

    let body = resp
        .text()
        .await
        .map_err(|e| ResolveError::Parse(format!("Failed to read Open Library response: {}", e)))?;

    let map: serde_json::Map<String, serde_json::Value> = match serde_json::from_str(&body) {
        Ok(m) => m,
        Err(e) => {
            tracing::warn!(error = %e, "Failed to parse Open Library JSON, skipping");
            return Ok(None);
        }
    };

    let key = format!("ISBN:{}", isbn13);
    let book_value = match map.get(&key) {
        Some(v) => v,
        None => return Ok(None),
    };

    let book: OlBookData = match serde_json::from_value(book_value.clone()) {
        Ok(b) => b,
        Err(e) => {
            tracing::warn!(error = %e, "Failed to deserialize Open Library book data, skipping");
            return Ok(None);
        }
    };

    let title = match &book.title {
        Some(t) if !t.trim().is_empty() => t.clone(),
        _ => return Ok(None),
    };

    let returned_isbn = book
        .identifiers
        .as_ref()
        .and_then(|ids| {
            ids.isbn_13
                .as_ref()
                .and_then(|v| v.first().cloned())
                .or_else(|| ids.isbn_10.as_ref().and_then(|v| v.first().cloned()))
        });

    if let Some(ref ret_isbn) = returned_isbn {
        if let Some(ret13) = normalize_to_isbn13(ret_isbn) {
            if ret13 != isbn13 {
                return Ok(None);
            }
        }
    }

    let authors: Vec<CslName> = book
        .authors
        .unwrap_or_default()
        .into_iter()
        .filter_map(|a| a.name)
        .map(|n| name_to_csl(&n))
        .collect();

    let year_i64 = book
        .publish_date
        .as_deref()
        .and_then(extract_year)
        .and_then(|s| s.parse::<i64>().ok());

    let publisher = book
        .publishers
        .as_ref()
        .and_then(|p| p.first())
        .and_then(|p| p.name.clone());

    let csl_item = CslItem {
        item_type: Some("book".to_string()),
        title: Some(StringOrSeq::Single(title)),
        author: if authors.is_empty() { None } else { Some(authors) },
        container_title: None,
        issued: year_i64.map(|y| CslDate {
            date_parts: vec![vec![y]],
        }),
        doi: None,
        url: book.url,
        abstract_text: None,
        subject: None,
        volume: None,
        issue: None,
        page: None,
        publisher,
        issn: None,
        isbn: Some(isbn13.to_string()),
        reference: None,
    };

    let entry = csl_to_bib_entry(&csl_item);
    Ok(Some(entry))
}

// ── Google Books ─────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GBResponse {
    items: Option<Vec<GBItem>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GBItem {
    volume_info: Option<GBVolumeInfo>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GBVolumeInfo {
    title: Option<String>,
    authors: Option<Vec<String>>,
    publisher: Option<String>,
    published_date: Option<String>,
    industry_identifiers: Option<Vec<GBIdentifier>>,
}

#[derive(Debug, Deserialize)]
struct GBIdentifier {
    identifier: Option<String>,
}

async fn try_google_books(
    client: &reqwest::Client,
    isbn13: &str,
    base_url: &str,
) -> Result<BibEntry, ResolveError> {
    let url = format!("{}/books/v1/volumes?q=isbn:{}", base_url, isbn13);

    let resp = client.get(&url).send().await.map_err(|e| {
        ResolveError::Http(format!("Google Books request failed: {}", e))
    })?;

    let resp = super::check_status(resp, "Google Books API")?;

    let body = resp.text().await.map_err(|e| {
        ResolveError::Parse(format!("Failed to read Google Books response: {}", e))
    })?;

    let gb_resp: GBResponse = serde_json::from_str(&body)
        .map_err(|e| ResolveError::Parse(format!("Failed to parse Google Books response: {}", e)))?;

    let items = gb_resp.items.unwrap_or_default();

    let matching_item = items.iter().find(|item| {
        item.volume_info
            .as_ref()
            .and_then(|vi| vi.industry_identifiers.as_ref())
            .map(|ids| {
                ids.iter().any(|id| {
                    id.identifier
                        .as_ref()
                        .and_then(|s| normalize_to_isbn13(s))
                        .as_deref()
                        == Some(isbn13)
                })
            })
            .unwrap_or(false)
    });

    let item = matching_item
        .or_else(|| {
            // No item matched the queried ISBN by identifier.  Fall back to
            // the top-ranked result (`items[0]`) ONLY if it carries no
            // industryIdentifiers at all -- some GB records simply omit them.
            //
            // We intentionally inspect only items[0], not later items:
            // Google Books returns results in relevance order, so if the
            // top-ranked volume carries identifiers that don't match, the
            // entire response is untrustworthy and must be rejected -- even
            // if a lower-ranked item happens to lack identifiers.
            items.first().filter(|it| {
                let has_identifiers = it
                    .volume_info
                    .as_ref()
                    .and_then(|vi| vi.industry_identifiers.as_ref())
                    .map(|ids| !ids.is_empty())
                    .unwrap_or(false);
                !has_identifiers
            })
        })
        .ok_or_else(|| {
            ResolveError::Http("ISBN not found on Google Books (no matching volume)".into())
        })?;

    let vi = item.volume_info.as_ref().ok_or_else(|| {
        ResolveError::Parse("Google Books item missing volumeInfo".into())
    })?;

    let title = vi
        .title
        .as_ref()
        .filter(|t| !t.trim().is_empty())
        .cloned()
        .ok_or_else(|| ResolveError::Parse("Google Books item has no title".into()))?;

    let authors: Vec<CslName> = vi
        .authors
        .as_ref()
        .map(|a| a.iter().map(|n| name_to_csl(n)).collect())
        .unwrap_or_default();

    let year_i64 = vi
        .published_date
        .as_deref()
        .and_then(extract_year)
        .and_then(|s| s.parse::<i64>().ok());

    let csl_item = CslItem {
        item_type: Some("book".to_string()),
        title: Some(StringOrSeq::Single(title)),
        author: if authors.is_empty() { None } else { Some(authors) },
        container_title: None,
        issued: year_i64.map(|y| CslDate {
            date_parts: vec![vec![y]],
        }),
        doi: None,
        url: None,
        abstract_text: None,
        subject: None,
        volume: None,
        issue: None,
        page: None,
        publisher: vi.publisher.clone(),
        issn: None,
        isbn: Some(isbn13.to_string()),
        reference: None,
    };

    Ok(csl_to_bib_entry(&csl_item))
}

// ── Helpers ──────────────────────────────────────────────────────────

/// Convert a flat author name string into a [`CslName`].
///
/// Names containing a comma are treated as already-formatted and passed
/// through as a literal (preserving the old `format_author_name` behavior
/// for "Last, First" inputs). Names without a comma are split via
/// [`split_flat_name`].
fn name_to_csl(name: &str) -> CslName {
    if name.contains(',') {
        CslName {
            family: None,
            given: None,
            literal: Some(name.trim().to_string()),
        }
    } else {
        split_flat_name(name)
    }
}

fn extract_year(date_str: &str) -> Option<String> {
    static YEAR_RE: std::sync::LazyLock<regex::Regex> =
        std::sync::LazyLock::new(|| regex::Regex::new(r"\b(\d{4})\b").unwrap());
    YEAR_RE
        .captures(date_str)
        .map(|caps| caps[1].to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use wiremock::matchers::{method, path, query_param};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    fn test_client() -> reqwest::Client {
        reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(5))
            .build()
            .unwrap()
    }

    #[test]
    fn name_to_csl_first_last() {
        let n = name_to_csl("John Smith");
        assert_eq!(n.family, Some("Smith".to_string()));
        assert_eq!(n.given, Some("John".to_string()));
        assert!(n.literal.is_none());
    }

    #[test]
    fn name_to_csl_already_inverted_uses_literal() {
        let n = name_to_csl("Smith, John");
        assert_eq!(n.literal, Some("Smith, John".to_string()));
        assert!(n.family.is_none());
        assert!(n.given.is_none());
    }

    #[test]
    fn name_to_csl_single_name() {
        let n = name_to_csl("WHO");
        assert_eq!(n.family, Some("WHO".to_string()));
        assert!(n.given.is_none());
        assert!(n.literal.is_none());
    }

    #[test]
    fn name_to_csl_three_parts() {
        let n = name_to_csl("Martin Luther King");
        assert_eq!(n.family, Some("King".to_string()));
        assert_eq!(n.given, Some("Martin Luther".to_string()));
        assert!(n.literal.is_none());
    }

    #[test]
    fn split_flat_name_accessible_from_isbn() {
        let n = super::super::arxiv::split_flat_name("John Smith");
        assert_eq!(n.family, Some("Smith".to_string()));
        assert_eq!(n.given, Some("John".to_string()));
    }

    #[test]
    fn extract_year_full_date() {
        assert_eq!(extract_year("2003-07-31"), Some("2003".to_string()));
    }

    #[test]
    fn extract_year_month_year() {
        assert_eq!(extract_year("May 2003"), Some("2003".to_string()));
    }

    #[test]
    fn extract_year_just_year() {
        assert_eq!(extract_year("2003"), Some("2003".to_string()));
    }

    #[test]
    fn extract_year_no_year() {
        assert_eq!(extract_year("no date here"), None);
    }

    // ── Open Library tests ───────────────────────────────────────────

    #[tokio::test]
    async fn open_library_hit() {
        let server = MockServer::start().await;
        let client = test_client();

        let ol_json = r#"{
            "ISBN:9780306406157": {
                "title": "Fundamentals of Wavelets",
                "authors": [{"name": "Jaideva Goswami"}, {"name": "Andrew Chan"}],
                "publishers": [{"name": "Wiley-Interscience"}],
                "publish_date": "January 10, 1999",
                "identifiers": {
                    "isbn_13": ["9780306406157"],
                    "isbn_10": ["0306406152"]
                },
                "url": "https://openlibrary.org/books/OL123M"
            }
        }"#;

        Mock::given(method("GET"))
            .and(path("/api/books"))
            .and(query_param("bibkeys", "ISBN:9780306406157"))
            .respond_with(ResponseTemplate::new(200).set_body_string(ol_json))
            .mount(&server)
            .await;

        let result = resolve_isbn_with_base(
            &client,
            "9780306406157",
            &server.uri(),
            "http://localhost:1",
        )
        .await;

        let (entry, isbn_path) = result.expect("should resolve");
        assert_eq!(isbn_path, IsbnPath::OpenLibrary);
        assert_eq!(entry.title, "Fundamentals of Wavelets");
        assert_eq!(entry.authors, vec!["Goswami, Jaideva", "Chan, Andrew"]);
        assert_eq!(entry.year, "1999");
        assert_eq!(entry.publisher, Some("Wiley-Interscience".to_string()));
        assert_eq!(entry.isbn, Some("9780306406157".to_string()));
        assert_eq!(entry.entry_type, "book");
    }

    #[tokio::test]
    async fn open_library_miss_falls_through_to_google() {
        let ol_server = MockServer::start().await;
        let gb_server = MockServer::start().await;
        let client = test_client();

        Mock::given(method("GET"))
            .and(path("/api/books"))
            .respond_with(ResponseTemplate::new(200).set_body_string("{}"))
            .mount(&ol_server)
            .await;

        let gb_json = r#"{
            "totalItems": 1,
            "items": [{
                "volumeInfo": {
                    "title": "Test Book",
                    "authors": ["Jane Doe"],
                    "publisher": "Test Publisher",
                    "publishedDate": "2020",
                    "industryIdentifiers": [
                        {"type": "ISBN_13", "identifier": "9780306406157"}
                    ]
                }
            }]
        }"#;

        Mock::given(method("GET"))
            .and(path("/books/v1/volumes"))
            .and(query_param("q", "isbn:9780306406157"))
            .respond_with(ResponseTemplate::new(200).set_body_string(gb_json))
            .mount(&gb_server)
            .await;

        let result = resolve_isbn_with_base(
            &client,
            "9780306406157",
            &ol_server.uri(),
            &gb_server.uri(),
        )
        .await;

        let (entry, isbn_path) = result.expect("should resolve via Google Books");
        assert_eq!(isbn_path, IsbnPath::GoogleBooks);
        assert_eq!(entry.title, "Test Book");
        assert_eq!(entry.authors, vec!["Doe, Jane"]);
        assert_eq!(entry.publisher, Some("Test Publisher".to_string()));
    }

    #[tokio::test]
    async fn open_library_429_falls_through_to_google() {
        let ol_server = MockServer::start().await;
        let gb_server = MockServer::start().await;
        let client = test_client();

        Mock::given(method("GET"))
            .and(path("/api/books"))
            .respond_with(ResponseTemplate::new(429))
            .mount(&ol_server)
            .await;

        let gb_json = r#"{
            "totalItems": 1,
            "items": [{
                "volumeInfo": {
                    "title": "Another Book",
                    "authors": ["John Smith"],
                    "publishedDate": "2021",
                    "industryIdentifiers": [
                        {"type": "ISBN_13", "identifier": "9780306406157"}
                    ]
                }
            }]
        }"#;

        Mock::given(method("GET"))
            .and(path("/books/v1/volumes"))
            .respond_with(ResponseTemplate::new(200).set_body_string(gb_json))
            .mount(&gb_server)
            .await;

        let result = resolve_isbn_with_base(
            &client,
            "9780306406157",
            &ol_server.uri(),
            &gb_server.uri(),
        )
        .await;

        let (entry, isbn_path) = result.expect("should resolve via Google Books after OL 429");
        assert_eq!(isbn_path, IsbnPath::GoogleBooks);
        assert_eq!(entry.title, "Another Book");
    }

    #[tokio::test]
    async fn google_books_hit_with_isbn_match() {
        let server = MockServer::start().await;
        let client = test_client();

        let gb_json = r#"{
            "totalItems": 2,
            "items": [
                {
                    "volumeInfo": {
                        "title": "Wrong Book",
                        "industryIdentifiers": [
                            {"type": "ISBN_13", "identifier": "9780000000000"}
                        ]
                    }
                },
                {
                    "volumeInfo": {
                        "title": "Correct Book",
                        "authors": ["Author One"],
                        "publishedDate": "2019",
                        "industryIdentifiers": [
                            {"type": "ISBN_13", "identifier": "9780306406157"}
                        ]
                    }
                }
            ]
        }"#;

        Mock::given(method("GET"))
            .and(path("/books/v1/volumes"))
            .respond_with(ResponseTemplate::new(200).set_body_string(gb_json))
            .mount(&server)
            .await;

        let result =
            try_google_books(&client, "9780306406157", &server.uri()).await;

        let entry = result.expect("should resolve");
        assert_eq!(entry.title, "Correct Book");
    }

    #[tokio::test]
    async fn both_miss_returns_error() {
        let ol_server = MockServer::start().await;
        let gb_server = MockServer::start().await;
        let client = test_client();

        Mock::given(method("GET"))
            .and(path("/api/books"))
            .respond_with(ResponseTemplate::new(200).set_body_string("{}"))
            .mount(&ol_server)
            .await;

        Mock::given(method("GET"))
            .and(path("/books/v1/volumes"))
            .respond_with(
                ResponseTemplate::new(200).set_body_string(r#"{"totalItems": 0}"#),
            )
            .mount(&gb_server)
            .await;

        let result = resolve_isbn_with_base(
            &client,
            "9780306406157",
            &ol_server.uri(),
            &gb_server.uri(),
        )
        .await;

        assert!(result.is_err());
    }

    #[tokio::test]
    async fn google_books_429_returns_rate_limited() {
        let ol_server = MockServer::start().await;
        let gb_server = MockServer::start().await;
        let client = test_client();

        Mock::given(method("GET"))
            .and(path("/api/books"))
            .respond_with(ResponseTemplate::new(200).set_body_string("{}"))
            .mount(&ol_server)
            .await;

        Mock::given(method("GET"))
            .and(path("/books/v1/volumes"))
            .respond_with(ResponseTemplate::new(429))
            .mount(&gb_server)
            .await;

        let result = resolve_isbn_with_base(
            &client,
            "9780306406157",
            &ol_server.uri(),
            &gb_server.uri(),
        )
        .await;

        assert!(matches!(result, Err(ResolveError::RateLimited)));
    }

    #[tokio::test]
    async fn isbn10_input_normalizes_to_isbn13() {
        let server = MockServer::start().await;
        let client = test_client();

        let ol_json = r#"{
            "ISBN:9780306406157": {
                "title": "Normalized Book",
                "publish_date": "2000"
            }
        }"#;

        Mock::given(method("GET"))
            .and(path("/api/books"))
            .and(query_param("bibkeys", "ISBN:9780306406157"))
            .respond_with(ResponseTemplate::new(200).set_body_string(ol_json))
            .mount(&server)
            .await;

        let result = resolve_isbn_with_base(
            &client,
            "0306406152",
            &server.uri(),
            "http://localhost:1",
        )
        .await;

        let (entry, _) = result.expect("ISBN-10 should normalize and resolve");
        assert_eq!(entry.title, "Normalized Book");
        assert_eq!(entry.isbn, Some("9780306406157".to_string()));
    }

    #[tokio::test]
    async fn google_books_rejects_when_identifiers_present_but_mismatch() {
        let server = MockServer::start().await;
        let client = test_client();

        let gb_json = r#"{
            "totalItems": 1,
            "items": [{
                "volumeInfo": {
                    "title": "Wrong Book Entirely",
                    "authors": ["Wrong Author"],
                    "publishedDate": "2015",
                    "industryIdentifiers": [
                        {"type": "ISBN_13", "identifier": "9780000000000"}
                    ]
                }
            }]
        }"#;

        Mock::given(method("GET"))
            .and(path("/books/v1/volumes"))
            .respond_with(ResponseTemplate::new(200).set_body_string(gb_json))
            .mount(&server)
            .await;

        let result =
            try_google_books(&client, "9780306406157", &server.uri()).await;

        assert!(result.is_err(), "should reject when identifiers are present but mismatch");
    }

    #[tokio::test]
    async fn google_books_accepts_fallback_when_no_identifiers() {
        let server = MockServer::start().await;
        let client = test_client();

        let gb_json = r#"{
            "totalItems": 1,
            "items": [{
                "volumeInfo": {
                    "title": "Book Without Identifiers",
                    "authors": ["Some Author"],
                    "publishedDate": "2018"
                }
            }]
        }"#;

        Mock::given(method("GET"))
            .and(path("/books/v1/volumes"))
            .respond_with(ResponseTemplate::new(200).set_body_string(gb_json))
            .mount(&server)
            .await;

        let result =
            try_google_books(&client, "9780306406157", &server.uri()).await;

        let entry = result.expect("should accept fallback when no identifiers");
        assert_eq!(entry.title, "Book Without Identifiers");
        assert_eq!(entry.isbn, Some("9780306406157".to_string()));
    }

    #[tokio::test]
    async fn google_books_accepts_fallback_when_identifiers_empty() {
        let server = MockServer::start().await;
        let client = test_client();

        let gb_json = r#"{
            "totalItems": 1,
            "items": [{
                "volumeInfo": {
                    "title": "Book With Empty Identifiers",
                    "authors": ["Another Author"],
                    "publishedDate": "2017",
                    "industryIdentifiers": []
                }
            }]
        }"#;

        Mock::given(method("GET"))
            .and(path("/books/v1/volumes"))
            .respond_with(ResponseTemplate::new(200).set_body_string(gb_json))
            .mount(&server)
            .await;

        let result =
            try_google_books(&client, "9780306406157", &server.uri()).await;

        let entry = result.expect("should accept fallback when identifiers are empty");
        assert_eq!(entry.title, "Book With Empty Identifiers");
        assert_eq!(entry.isbn, Some("9780306406157".to_string()));
    }

    #[tokio::test]
    async fn google_books_missing_total_items_but_has_items() {
        let server = MockServer::start().await;
        let client = test_client();

        // totalItems field is completely absent, but items array is populated.
        // Previously this would fail because unwrap_or(0) treated absent as 0.
        let gb_json = r#"{
            "items": [{
                "volumeInfo": {
                    "title": "Surprise Book",
                    "authors": ["Test Author"],
                    "publishedDate": "2022",
                    "industryIdentifiers": [
                        {"type": "ISBN_13", "identifier": "9780306406157"}
                    ]
                }
            }]
        }"#;

        Mock::given(method("GET"))
            .and(path("/books/v1/volumes"))
            .and(query_param("q", "isbn:9780306406157"))
            .respond_with(ResponseTemplate::new(200).set_body_string(gb_json))
            .mount(&server)
            .await;

        let result =
            try_google_books(&client, "9780306406157", &server.uri()).await;

        let entry = result.expect("should resolve when totalItems is absent but items exist");
        assert_eq!(entry.title, "Surprise Book");
        assert_eq!(entry.authors, vec!["Author, Test"]);
        assert_eq!(entry.year, "2022");
        assert_eq!(entry.isbn, Some("9780306406157".to_string()));
    }

    #[tokio::test]
    async fn google_books_zero_total_items_with_items_still_resolves() {
        let server = MockServer::start().await;
        let client = test_client();

        // totalItems says 0 but items array has an entry -- contradictory but
        // possible from the API.  We should trust the actual items.
        let gb_json = r#"{
            "totalItems": 0,
            "items": [{
                "volumeInfo": {
                    "title": "Contradictory Book",
                    "authors": ["Test Author"],
                    "publishedDate": "2021",
                    "industryIdentifiers": [
                        {"type": "ISBN_13", "identifier": "9780306406157"}
                    ]
                }
            }]
        }"#;

        Mock::given(method("GET"))
            .and(path("/books/v1/volumes"))
            .and(query_param("q", "isbn:9780306406157"))
            .respond_with(ResponseTemplate::new(200).set_body_string(gb_json))
            .mount(&server)
            .await;

        let result =
            try_google_books(&client, "9780306406157", &server.uri()).await;

        let entry = result.expect("should resolve when totalItems is 0 but items exist");
        assert_eq!(entry.title, "Contradictory Book");
        assert_eq!(entry.authors, vec!["Author, Test"]);
        assert_eq!(entry.year, "2021");
        assert_eq!(entry.isbn, Some("9780306406157".to_string()));
    }

    #[tokio::test]
    async fn malformed_response_handled_gracefully() {
        let ol_server = MockServer::start().await;
        let gb_server = MockServer::start().await;
        let client = test_client();

        Mock::given(method("GET"))
            .and(path("/api/books"))
            .respond_with(ResponseTemplate::new(200).set_body_string("not json"))
            .mount(&ol_server)
            .await;

        Mock::given(method("GET"))
            .and(path("/books/v1/volumes"))
            .respond_with(
                ResponseTemplate::new(200).set_body_string(r#"{"totalItems": 0}"#),
            )
            .mount(&gb_server)
            .await;

        let result = resolve_isbn_with_base(
            &client,
            "9780306406157",
            &ol_server.uri(),
            &gb_server.uri(),
        )
        .await;

        assert!(result.is_err());
    }

    /// Short timeout used only by tests that exercise the per-provider timeout.
    const TEST_PROVIDER_TIMEOUT: std::time::Duration = std::time::Duration::from_millis(200);

    /// Delay applied to wiremock responses that should exceed the test timeout.
    const TEST_SLOW_DELAY: std::time::Duration = std::time::Duration::from_secs(2);

    #[tokio::test]
    async fn open_library_timeout_falls_through_to_google() {
        let ol_server = MockServer::start().await;
        let gb_server = MockServer::start().await;
        let client = test_client();

        // OL responds with a delay longer than TEST_PROVIDER_TIMEOUT
        let ol_json = r#"{
            "ISBN:9780306406157": {
                "title": "Slow Book",
                "publish_date": "2000"
            }
        }"#;
        Mock::given(method("GET"))
            .and(path("/api/books"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_string(ol_json)
                    .set_delay(TEST_SLOW_DELAY),
            )
            .mount(&ol_server)
            .await;

        let gb_json = r#"{
            "totalItems": 1,
            "items": [{
                "volumeInfo": {
                    "title": "Fast Google Book",
                    "authors": ["Jane Doe"],
                    "publishedDate": "2020",
                    "industryIdentifiers": [
                        {"type": "ISBN_13", "identifier": "9780306406157"}
                    ]
                }
            }]
        }"#;
        Mock::given(method("GET"))
            .and(path("/books/v1/volumes"))
            .respond_with(ResponseTemplate::new(200).set_body_string(gb_json))
            .mount(&gb_server)
            .await;

        let result = resolve_isbn_impl(
            &client,
            "9780306406157",
            &ol_server.uri(),
            &gb_server.uri(),
            TEST_PROVIDER_TIMEOUT,
        )
        .await;

        let (entry, isbn_path) = result.expect("should resolve via Google Books after OL timeout");
        assert_eq!(isbn_path, IsbnPath::GoogleBooks);
        assert_eq!(entry.title, "Fast Google Book");
    }

    #[test]
    fn isbn_provider_timeout_fits_within_http_client_timeout() {
        use crate::commands::bib_import::HTTP_CLIENT_TIMEOUT;
        assert!(
            2 * ISBN_PROVIDER_TIMEOUT <= HTTP_CLIENT_TIMEOUT,
            "Two sequential ISBN providers ({:?} each = {:?} total) must fit within \
             the HTTP client timeout ({:?}). If you lowered HTTP_CLIENT_TIMEOUT, \
             you must also lower ISBN_PROVIDER_TIMEOUT.",
            ISBN_PROVIDER_TIMEOUT,
            2 * ISBN_PROVIDER_TIMEOUT,
            HTTP_CLIENT_TIMEOUT,
        );
    }

    /// Policy lock: when the top-ranked Google Books result carries
    /// mismatching identifiers, the response must be rejected even if a
    /// lower-ranked item has no identifiers at all.
    #[tokio::test]
    async fn google_books_rejects_when_top_item_mismatches_despite_later_identifier_less_item() {
        let server = MockServer::start().await;
        let client = test_client();

        // items[0]: wrong ISBN identifiers  →  mismatch
        // items[1]: no identifiers at all   →  would pass the no-identifier filter,
        //           but must NOT be used because only items[0] is eligible.
        let gb_json = r#"{
            "totalItems": 2,
            "items": [
                {
                    "volumeInfo": {
                        "title": "Wrong Book",
                        "authors": ["Wrong Author"],
                        "publishedDate": "2015",
                        "industryIdentifiers": [
                            {"type": "ISBN_13", "identifier": "9780000000000"}
                        ]
                    }
                },
                {
                    "volumeInfo": {
                        "title": "Identifier-less Book",
                        "authors": ["Some Author"],
                        "publishedDate": "2020"
                    }
                }
            ]
        }"#;

        Mock::given(method("GET"))
            .and(path("/books/v1/volumes"))
            .respond_with(ResponseTemplate::new(200).set_body_string(gb_json))
            .mount(&server)
            .await;

        let result =
            try_google_books(&client, "9780306406157", &server.uri()).await;

        assert!(
            result.is_err(),
            "must reject: top-ranked item has mismatching identifiers, \
             so the identifier-less second item must not be used as fallback"
        );
    }

    #[tokio::test]
    async fn both_providers_timeout_returns_error() {
        let ol_server = MockServer::start().await;
        let gb_server = MockServer::start().await;
        let client = test_client();

        // Both providers delay beyond TEST_PROVIDER_TIMEOUT
        Mock::given(method("GET"))
            .and(path("/api/books"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_string("{}")
                    .set_delay(TEST_SLOW_DELAY),
            )
            .mount(&ol_server)
            .await;

        Mock::given(method("GET"))
            .and(path("/books/v1/volumes"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_string(r#"{"totalItems": 0}"#)
                    .set_delay(TEST_SLOW_DELAY),
            )
            .mount(&gb_server)
            .await;

        let result = resolve_isbn_impl(
            &client,
            "9780306406157",
            &ol_server.uri(),
            &gb_server.uri(),
            TEST_PROVIDER_TIMEOUT,
        )
        .await;

        let err = result.expect_err("should fail when both providers time out");
        let msg = format!("{}", err);
        assert!(
            msg.contains("timed out"),
            "error message should mention timeout, got: {}",
            msg
        );
    }
}
