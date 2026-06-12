use std::collections::HashSet;

use serde::Deserialize;

use crate::bib::types::BibEntry;
use crate::bib::writer::generate_key;
use crate::recognize::identifiers::normalize_to_isbn13;

use super::ResolveError;

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum IsbnPath {
    OpenLibrary,
    GoogleBooks,
}

pub async fn resolve_isbn_with_base(
    client: &reqwest::Client,
    isbn: &str,
    open_library_base_url: &str,
    google_books_base_url: &str,
) -> Result<(BibEntry, IsbnPath), ResolveError> {
    let isbn13 = normalize_to_isbn13(isbn)
        .ok_or_else(|| ResolveError::Parse(format!("Invalid ISBN: {}", isbn)))?;

    if let Some(result) = try_open_library(client, &isbn13, open_library_base_url).await? {
        return Ok((result, IsbnPath::OpenLibrary));
    }

    try_google_books(client, &isbn13, google_books_base_url)
        .await
        .map(|entry| (entry, IsbnPath::GoogleBooks))
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
        Err(_) => return Ok(None),
    };

    let resp = match super::check_status(resp, "Open Library") {
        Ok(resp) => resp,
        Err(ResolveError::RateLimited) => return Ok(None),
        Err(_) => return Ok(None),
    };

    let body = resp
        .text()
        .await
        .map_err(|e| ResolveError::Parse(format!("Failed to read Open Library response: {}", e)))?;

    let map: serde_json::Map<String, serde_json::Value> = match serde_json::from_str(&body) {
        Ok(m) => m,
        Err(_) => return Ok(None),
    };

    let key = format!("ISBN:{}", isbn13);
    let book_value = match map.get(&key) {
        Some(v) => v,
        None => return Ok(None),
    };

    let book: OlBookData = match serde_json::from_value(book_value.clone()) {
        Ok(b) => b,
        Err(_) => return Ok(None),
    };

    let title = match &book.title {
        Some(t) if !t.trim().is_empty() => t.clone(),
        _ => return Ok(None),
    };

    let authors: Vec<String> = book
        .authors
        .unwrap_or_default()
        .into_iter()
        .filter_map(|a| a.name)
        .map(|n| format_author_name(&n))
        .collect();

    let year = book
        .publish_date
        .as_deref()
        .and_then(extract_year)
        .unwrap_or_default();

    let publisher = book
        .publishers
        .as_ref()
        .and_then(|p| p.first())
        .and_then(|p| p.name.clone());

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

    let entry_key = generate_key(&authors, &year, &HashSet::new());

    Ok(Some(BibEntry {
        key: entry_key,
        authors,
        title,
        year,
        entry_type: "book".to_string(),
        line_number: 0,
        bib_file: None,
        abstract_text: None,
        doi: None,
        journal: None,
        url: book.url,
        file: None,
        volume: None,
        number: None,
        pages: None,
        publisher,
        issn: None,
        isbn: Some(isbn13.to_string()),
        tags: vec![],
    }))
}

// ── Google Books ─────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GBResponse {
    total_items: Option<u32>,
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

    if gb_resp.total_items.unwrap_or(0) == 0 {
        return Err(ResolveError::Http(
            "ISBN not found on Google Books (Open Library also missed)".into(),
        ));
    }

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

    let item = matching_item.or(items.first()).ok_or_else(|| {
        ResolveError::Http("ISBN not found on Google Books (no items)".into())
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

    let authors: Vec<String> = vi
        .authors
        .as_ref()
        .map(|a| a.iter().map(|n| format_author_name(n)).collect())
        .unwrap_or_default();

    let year = vi
        .published_date
        .as_deref()
        .and_then(extract_year)
        .unwrap_or_default();

    let entry_key = generate_key(&authors, &year, &HashSet::new());

    Ok(BibEntry {
        key: entry_key,
        authors,
        title,
        year,
        entry_type: "book".to_string(),
        line_number: 0,
        bib_file: None,
        abstract_text: None,
        doi: None,
        journal: None,
        url: None,
        file: None,
        volume: None,
        number: None,
        pages: None,
        publisher: vi.publisher.clone(),
        issn: None,
        isbn: Some(isbn13.to_string()),
        tags: vec![],
    })
}

// ── Helpers ──────────────────────────────────────────────────────────

fn format_author_name(name: &str) -> String {
    let name = name.trim();
    if name.contains(',') {
        return name.to_string();
    }
    match name.rfind(' ') {
        Some(pos) => format!("{}, {}", &name[pos + 1..], &name[..pos]),
        None => name.to_string(),
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
    fn format_author_name_first_last() {
        assert_eq!(format_author_name("John Smith"), "Smith, John");
    }

    #[test]
    fn format_author_name_already_inverted() {
        assert_eq!(format_author_name("Smith, John"), "Smith, John");
    }

    #[test]
    fn format_author_name_single_name() {
        assert_eq!(format_author_name("WHO"), "WHO");
    }

    #[test]
    fn format_author_name_three_parts() {
        assert_eq!(
            format_author_name("Martin Luther King"),
            "King, Martin Luther"
        );
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
}
