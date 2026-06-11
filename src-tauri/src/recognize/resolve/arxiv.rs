use std::collections::HashSet;

use crate::bib::types::BibEntry;
use crate::bib::writer::generate_key;
use quick_xml::events::Event;
use quick_xml::reader::Reader;
use super::ResolveError;

/// Convert an arXiv author name from "Given Family" format to "Family, Given".
/// If the name has no spaces, return as-is.
fn arxiv_author_to_bib_format(name: &str) -> String {
    let trimmed = name.trim();
    if let Some(pos) = trimmed.rfind(' ') {
        let given = &trimmed[..pos];
        let family = &trimmed[pos + 1..];
        format!("{}, {}", family, given)
    } else {
        trimmed.to_string()
    }
}

/// Parse an arXiv Atom XML feed and extract the first `<entry>` into a `BibEntry`.
pub fn parse_arxiv_atom(xml: &str) -> Result<BibEntry, ResolveError> {
    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(true);

    let mut in_entry = false;
    let mut in_author = false;

    let mut title: Option<String> = None;
    let mut authors: Vec<String> = Vec::new();
    let mut year: Option<String> = None;
    let mut url: Option<String> = None;
    let mut abstract_text: Option<String> = None;
    let mut doi: Option<String> = None;
    let mut journal: Option<String> = None;
    let mut tags: Vec<String> = Vec::new();

    loop {
        match reader.read_event() {
            Ok(Event::Start(ref e)) => {
                match e.local_name().as_ref() {
                    b"entry" => in_entry = true,
                    b"author" if in_entry => in_author = true,
                    b"name" if in_author => {
                        let text = reader
                            .read_text(e.to_end().name())
                            .map_err(|err| ResolveError::Parse(format!("Failed to read author name: {}", err)))?;
                        authors.push(arxiv_author_to_bib_format(&text));
                    }
                    b"title" if in_entry => {
                        let text = reader
                            .read_text(e.to_end().name())
                            .map_err(|err| ResolveError::Parse(format!("Failed to read title: {}", err)))?;
                        title = Some(text.into_owned());
                    }
                    b"summary" if in_entry => {
                        let text = reader
                            .read_text(e.to_end().name())
                            .map_err(|err| ResolveError::Parse(format!("Failed to read summary: {}", err)))?;
                        abstract_text = Some(text.trim().to_string());
                    }
                    b"published" if in_entry => {
                        let text = reader
                            .read_text(e.to_end().name())
                            .map_err(|err| ResolveError::Parse(format!("Failed to read published date: {}", err)))?;
                        if text.len() >= 4 {
                            year = Some(text[..4].to_string());
                        }
                    }
                    b"id" if in_entry => {
                        let text = reader
                            .read_text(e.to_end().name())
                            .map_err(|err| ResolveError::Parse(format!("Failed to read id: {}", err)))?;
                        url = Some(text.into_owned());
                    }
                    b"doi" if in_entry => {
                        let text = reader
                            .read_text(e.to_end().name())
                            .map_err(|err| ResolveError::Parse(format!("Failed to read doi: {}", err)))?;
                        doi = Some(text.trim().to_string());
                    }
                    b"journal_ref" if in_entry => {
                        let text = reader
                            .read_text(e.to_end().name())
                            .map_err(|err| ResolveError::Parse(format!("Failed to read journal_ref: {}", err)))?;
                        journal = Some(text.trim().to_string());
                    }
                    _ => {}
                }
            }
            Ok(Event::Empty(ref e))
                if e.local_name().as_ref() == b"category" && in_entry =>
            {
                for attr in e.attributes().flatten() {
                    if attr.key.as_ref() == b"term" {
                        if let Ok(val) = std::str::from_utf8(&attr.value) {
                            tags.push(val.to_string());
                        }
                    }
                }
            }
            Ok(Event::End(ref e)) => {
                match e.local_name().as_ref() {
                    b"entry" => break, // only process first entry
                    b"author" => in_author = false,
                    _ => {}
                }
            }
            Ok(Event::Eof) => break,
            Err(err) => return Err(ResolveError::Parse(format!("XML parse error: {}", err))),
            _ => {}
        }
    }

    let title = title.ok_or_else(|| ResolveError::Parse("arXiv ID not found".into()))?;
    let year_str = year.unwrap_or_default();
    let key = generate_key(&authors, &year_str, &HashSet::new());

    Ok(BibEntry {
        key,
        authors,
        title,
        year: year_str,
        entry_type: "article".to_string(),
        line_number: 0,
        bib_file: None,
        abstract_text,
        doi,
        journal,
        url,
        volume: None,
        number: None,
        pages: None,
        publisher: None,
        issn: None,
        tags,
    })
}

/// Resolve an arXiv ID to a `BibEntry` by fetching metadata from the arXiv API.
///
/// - `client`: a pre-configured `reqwest::Client`
/// - `arxiv_id`: bare arXiv ID (e.g. `"2301.07041"`)
/// - `base_url`: base URL for the arXiv API (production: `"https://export.arxiv.org"`)
pub async fn resolve_arxiv_with_base(
    client: &reqwest::Client,
    arxiv_id: &str,
    base_url: &str,
) -> Result<BibEntry, ResolveError> {
    let url = format!("{}/api/query?id_list={}", base_url, arxiv_id);
    let resp = client.get(&url).send().await.map_err(|e| {
        ResolveError::Http(format!("arXiv request failed: {}", e))
    })?;

    let status = resp.status();
    if status == reqwest::StatusCode::TOO_MANY_REQUESTS {
        return Err(ResolveError::RateLimited);
    }
    if !status.is_success() {
        return Err(ResolveError::Http(format!(
            "arXiv API returned status {}",
            status
        )));
    }

    let body = resp.text().await.map_err(|e| {
        ResolveError::Parse(format!("Failed to read arXiv response: {}", e))
    })?;

    parse_arxiv_atom(&body)
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── XML fixtures ───────────────────────────────────────────────

    const SINGLE_AUTHOR_XML: &str = r#"<?xml version='1.0' encoding='UTF-8'?>
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

    const MULTIPLE_AUTHORS_XML: &str = r#"<?xml version='1.0' encoding='UTF-8'?>
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
    <author><name>Christian Knabenhans</name></author>
    <author><name>Anwar Hithnawi</name></author>
    <category term="cs.CR" scheme="http://arxiv.org/schemas/atom"/>
    <category term="cs.LG" scheme="http://arxiv.org/schemas/atom"/>
  </entry>
</feed>"#;

    const WITH_DOI_AND_JOURNAL_XML: &str = r#"<?xml version='1.0' encoding='UTF-8'?>
<feed xmlns="http://www.w3.org/2005/Atom"
      xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/"
      xmlns:arxiv="http://arxiv.org/schemas/atom">
  <opensearch:totalResults>1</opensearch:totalResults>
  <entry>
    <id>http://arxiv.org/abs/0704.0001v1</id>
    <title>Calculation of prompt diphoton production</title>
    <summary>A brief summary of prompt diphoton calculation.</summary>
    <published>2007-04-02T20:00:00Z</published>
    <author><name>C. Balazs</name></author>
    <author><name>E. L. Berger</name></author>
    <arxiv:doi>10.1103/PhysRevD.76.013009</arxiv:doi>
    <arxiv:journal_ref>Phys.Rev.D76:013009,2007</arxiv:journal_ref>
    <category term="hep-ph" scheme="http://arxiv.org/schemas/atom"/>
  </entry>
</feed>"#;

    const MISSING_DOI_XML: &str = r#"<?xml version='1.0' encoding='UTF-8'?>
<feed xmlns="http://www.w3.org/2005/Atom"
      xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/"
      xmlns:arxiv="http://arxiv.org/schemas/atom">
  <opensearch:totalResults>1</opensearch:totalResults>
  <entry>
    <id>http://arxiv.org/abs/2301.07041v2</id>
    <title>Some Paper Without DOI</title>
    <summary>A paper summary.</summary>
    <published>2023-06-10T12:00:00Z</published>
    <author><name>Jane Doe</name></author>
    <category term="cs.AI" scheme="http://arxiv.org/schemas/atom"/>
  </entry>
</feed>"#;

    const OLD_STYLE_ID_XML: &str = r#"<?xml version='1.0' encoding='UTF-8'?>
<feed xmlns="http://www.w3.org/2005/Atom"
      xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/"
      xmlns:arxiv="http://arxiv.org/schemas/atom">
  <opensearch:totalResults>1</opensearch:totalResults>
  <entry>
    <id>http://arxiv.org/abs/hep-ph/0703105v1</id>
    <title>Old Style arXiv Paper</title>
    <summary>An older paper.</summary>
    <published>2007-03-12T10:00:00Z</published>
    <author><name>John Smith</name></author>
    <category term="hep-ph" scheme="http://arxiv.org/schemas/atom"/>
  </entry>
</feed>"#;

    const EMPTY_FEED_XML: &str = r#"<?xml version='1.0' encoding='UTF-8'?>
<feed xmlns="http://www.w3.org/2005/Atom"
      xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/"
      xmlns:arxiv="http://arxiv.org/schemas/atom">
  <opensearch:totalResults>0</opensearch:totalResults>
</feed>"#;

    // ── Pure parse tests ───────────────────────────────────────────

    #[test]
    fn parse_single_author() {
        let entry = parse_arxiv_atom(SINGLE_AUTHOR_XML).expect("should parse");
        assert_eq!(entry.title, "Verifiable Fully Homomorphic Encryption");
        assert_eq!(entry.authors, vec!["Viand, Alexander"]);
        assert_eq!(entry.year, "2023");
        assert_eq!(
            entry.url,
            Some("http://arxiv.org/abs/2301.07041v2".to_string())
        );
        assert_eq!(
            entry.abstract_text,
            Some("FHE is seeing increasing deployment.".to_string())
        );
        assert_eq!(entry.entry_type, "article");
        assert_eq!(entry.tags, vec!["cs.CR"]);
        assert_eq!(entry.key, "viand2023");
        assert_eq!(entry.line_number, 0);
        assert_eq!(entry.bib_file, None);
    }

    #[test]
    fn parse_multiple_authors() {
        let entry = parse_arxiv_atom(MULTIPLE_AUTHORS_XML).expect("should parse");
        assert_eq!(
            entry.authors,
            vec![
                "Viand, Alexander",
                "Knabenhans, Christian",
                "Hithnawi, Anwar"
            ]
        );
        // Key uses first author's last name
        assert_eq!(entry.key, "viand2023");
        assert_eq!(entry.tags, vec!["cs.CR", "cs.LG"]);
    }

    #[test]
    fn parse_with_doi_and_journal_ref() {
        let entry = parse_arxiv_atom(WITH_DOI_AND_JOURNAL_XML).expect("should parse");
        assert_eq!(
            entry.doi,
            Some("10.1103/PhysRevD.76.013009".to_string())
        );
        assert_eq!(
            entry.journal,
            Some("Phys.Rev.D76:013009,2007".to_string())
        );
        assert_eq!(entry.year, "2007");
        assert_eq!(
            entry.url,
            Some("http://arxiv.org/abs/0704.0001v1".to_string())
        );
    }

    #[test]
    fn parse_missing_doi() {
        let entry = parse_arxiv_atom(MISSING_DOI_XML).expect("should parse");
        assert_eq!(entry.doi, None);
        assert_eq!(entry.journal, None);
    }

    #[test]
    fn parse_old_style_id() {
        let entry = parse_arxiv_atom(OLD_STYLE_ID_XML).expect("should parse");
        assert_eq!(
            entry.url,
            Some("http://arxiv.org/abs/hep-ph/0703105v1".to_string())
        );
        assert_eq!(entry.title, "Old Style arXiv Paper");
        assert_eq!(entry.authors, vec!["Smith, John"]);
    }

    #[test]
    fn parse_empty_feed_returns_error() {
        let result = parse_arxiv_atom(EMPTY_FEED_XML);
        assert!(result.is_err());
        match result.unwrap_err() {
            ResolveError::Parse(msg) => {
                assert!(
                    msg.contains("not found"),
                    "error should mention not found, got: {}",
                    msg
                );
            }
            other => panic!("expected ResolveError::Parse, got {:?}", other),
        }
    }

    // ── Helper function tests ──────────────────────────────────────

    #[test]
    fn author_format_two_parts() {
        assert_eq!(
            arxiv_author_to_bib_format("Alexander Viand"),
            "Viand, Alexander"
        );
    }

    #[test]
    fn author_format_three_parts() {
        assert_eq!(
            arxiv_author_to_bib_format("E. L. Berger"),
            "Berger, E. L."
        );
    }

    #[test]
    fn author_format_single_name() {
        assert_eq!(arxiv_author_to_bib_format("Aristotle"), "Aristotle");
    }

    // ── Wiremock integration tests ─────────────────────────────────

    #[tokio::test]
    async fn resolve_arxiv_full_flow() {
        use wiremock::matchers::{method, path, query_param};
        use wiremock::{Mock, MockServer, ResponseTemplate};

        let server = MockServer::start().await;
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(5))
            .build()
            .unwrap();

        Mock::given(method("GET"))
            .and(path("/api/query"))
            .and(query_param("id_list", "2301.07041"))
            .respond_with(ResponseTemplate::new(200).set_body_string(SINGLE_AUTHOR_XML))
            .mount(&server)
            .await;

        let result = resolve_arxiv_with_base(&client, "2301.07041", &server.uri()).await;

        let entry = result.expect("should resolve successfully");
        assert_eq!(entry.title, "Verifiable Fully Homomorphic Encryption");
        assert_eq!(entry.authors, vec!["Viand, Alexander"]);
        assert_eq!(entry.year, "2023");
        assert_eq!(entry.entry_type, "article");
    }

    #[tokio::test]
    async fn resolve_arxiv_not_found() {
        use wiremock::matchers::{method, path};
        use wiremock::{Mock, MockServer, ResponseTemplate};

        let server = MockServer::start().await;
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(5))
            .build()
            .unwrap();

        Mock::given(method("GET"))
            .and(path("/api/query"))
            .respond_with(ResponseTemplate::new(200).set_body_string(EMPTY_FEED_XML))
            .mount(&server)
            .await;

        let result =
            resolve_arxiv_with_base(&client, "0000.00000", &server.uri()).await;

        assert!(result.is_err());
    }

    #[tokio::test]
    async fn resolve_arxiv_rate_limited() {
        use wiremock::matchers::{method, path};
        use wiremock::{Mock, MockServer, ResponseTemplate};

        let server = MockServer::start().await;
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(5))
            .build()
            .unwrap();

        Mock::given(method("GET"))
            .and(path("/api/query"))
            .respond_with(ResponseTemplate::new(429))
            .mount(&server)
            .await;

        let result =
            resolve_arxiv_with_base(&client, "2301.07041", &server.uri()).await;

        assert!(result.is_err());
        match result.unwrap_err() {
            ResolveError::RateLimited => {} // expected
            other => panic!("expected ResolveError::RateLimited, got {:?}", other),
        }
    }

    #[tokio::test]
    async fn resolve_arxiv_server_error() {
        use wiremock::matchers::{method, path};
        use wiremock::{Mock, MockServer, ResponseTemplate};

        let server = MockServer::start().await;
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(5))
            .build()
            .unwrap();

        Mock::given(method("GET"))
            .and(path("/api/query"))
            .respond_with(ResponseTemplate::new(500))
            .mount(&server)
            .await;

        let result =
            resolve_arxiv_with_base(&client, "2301.07041", &server.uri()).await;

        assert!(result.is_err());
        match result.unwrap_err() {
            ResolveError::Http(msg) => {
                assert!(
                    msg.contains("500"),
                    "error should mention status 500, got: {}",
                    msg
                );
            }
            other => panic!("expected ResolveError::Http, got {:?}", other),
        }
    }
}
