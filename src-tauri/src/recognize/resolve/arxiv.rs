use crate::bib::convert::{csl_to_bib_entry, normalize_arxiv_id, CslDate, CslItem, CslName, StringOrSeq};
use crate::bib::types::BibEntry;
use quick_xml::events::Event;
use quick_xml::reader::Reader;
use super::ResolveError;

/// Split a flat "Given Family" name string into a [`CslName`].
///
/// Uses a last-space heuristic: everything after the last space is treated
/// as the family name, the rest as the given name. This matches standard
/// BibTeX behavior for unstructured names but **cannot detect name
/// particles** (e.g., "van", "de", "von") -- "Pieter van der Berg" will
/// produce `family: "Berg", given: "Pieter van der"` rather than the
/// correct `family: "van der Berg", given: "Pieter"`.
pub(crate) fn split_flat_name(name: &str) -> CslName {
    let trimmed = name.trim();
    if let Some(pos) = trimmed.rfind(' ') {
        CslName {
            family: Some(trimmed[pos + 1..].to_string()),
            given: Some(trimmed[..pos].to_string()),
            literal: None,
        }
    } else {
        CslName {
            family: Some(trimmed.to_string()),
            given: None,
            literal: None,
        }
    }
}

/// Parse an arXiv Atom XML feed and extract the first `<entry>` into a `BibEntry`.
///
/// Internally builds a [`CslItem`] from the parsed Atom fields and delegates
/// to [`csl_to_bib_entry`], so that DOI normalization, JATS stripping, and
/// author formatting remain consistent with the Crossref/CSL code path.
pub fn parse_arxiv_atom(xml: &str) -> Result<BibEntry, ResolveError> {
    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(true);

    let mut in_entry = false;
    let mut saw_entry = false;
    let mut in_author = false;

    let mut title: Option<String> = None;
    let mut authors: Vec<CslName> = Vec::new();
    let mut year: Option<i64> = None;
    let mut url: Option<String> = None;
    let mut abstract_text: Option<String> = None;
    let mut doi: Option<String> = None;
    let mut journal: Option<String> = None;
    let mut tags: Vec<String> = Vec::new();

    loop {
        match reader.read_event() {
            Ok(Event::Start(ref e)) => {
                match e.local_name().as_ref() {
                    b"entry" => {
                        in_entry = true;
                        saw_entry = true;
                    }
                    b"author" if in_entry => in_author = true,
                    b"name" if in_author => {
                        let text = reader
                            .read_text(e.to_end().name())
                            .map_err(|err| ResolveError::Parse(format!("Failed to read author name: {}", err)))?;
                        authors.push(split_flat_name(&text));
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
                        if let Some(prefix) = text.get(..4) {
                            if prefix.chars().all(|c| c.is_ascii_digit()) {
                                year = prefix.parse::<i64>().ok();
                            }
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

    let title = title.ok_or_else(|| {
        if saw_entry {
            ResolveError::Parse("arXiv entry missing title".into())
        } else {
            ResolveError::Parse("arXiv ID not found".into())
        }
    })?;

    let csl_item = CslItem {
        // Use "article-journal" so map_entry_type produces "article"
        item_type: Some("article-journal".to_string()),
        title: Some(StringOrSeq::Single(title)),
        author: if authors.is_empty() { None } else { Some(authors) },
        container_title: journal.map(StringOrSeq::Single),
        issued: year.map(|y| CslDate {
            date_parts: vec![vec![y]],
        }),
        doi,
        url,
        abstract_text,
        subject: if tags.is_empty() { None } else { Some(tags) },
        volume: None,
        issue: None,
        page: None,
        publisher: None,
        issn: None,
        isbn: None,
        reference: None,
    };

    let mut entry = csl_to_bib_entry(&csl_item);
    if let Some(ref url_str) = entry.url {
        let marker = "/abs/";
        if let Some(pos) = url_str.find(marker) {
            let id = &url_str[pos + marker.len()..];
            if !id.is_empty() {
                entry.arxiv_id = Some(normalize_arxiv_id(id));
            }
        }
    }
    Ok(entry)
}

/// Resolve an arXiv ID to a `BibEntry` by fetching metadata from the arXiv API.
///
/// - `client`: a pre-configured `reqwest::Client` — should have a timeout
///   (recommended 10 s) and a `User-Agent` header (arXiv does not mandate a UA
///   but a timeout prevents indefinite hangs). In production, use
///   [`crate::commands::bib_import::HTTP_CLIENT`].
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

    let resp = super::check_status(resp, "arXiv API")?;

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

    const ENTRY_WITHOUT_TITLE_XML: &str = r#"<?xml version='1.0' encoding='UTF-8'?>
<feed xmlns="http://www.w3.org/2005/Atom"
      xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/"
      xmlns:arxiv="http://arxiv.org/schemas/atom">
  <opensearch:totalResults>1</opensearch:totalResults>
  <entry>
    <id>http://arxiv.org/abs/2301.07041v2</id>
    <summary>A summary but no title.</summary>
    <published>2023-01-17T17:50:26Z</published>
    <author><name>Jane Doe</name></author>
    <category term="cs.AI" scheme="http://arxiv.org/schemas/atom"/>
  </entry>
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

    #[test]
    fn parse_entry_without_title_returns_distinct_error() {
        let result = parse_arxiv_atom(ENTRY_WITHOUT_TITLE_XML);
        assert!(result.is_err());
        match result.unwrap_err() {
            ResolveError::Parse(msg) => {
                assert!(
                    msg.contains("missing title"),
                    "error should mention missing title, got: {}",
                    msg
                );
            }
            other => panic!("expected ResolveError::Parse, got {:?}", other),
        }
    }

    // ── Helper function tests ──────────────────────────────────────

    #[test]
    fn split_flat_name_two_parts() {
        let name = split_flat_name("Alexander Viand");
        assert_eq!(name.family, Some("Viand".to_string()));
        assert_eq!(name.given, Some("Alexander".to_string()));
        assert_eq!(name.literal, None);
    }

    #[test]
    fn split_flat_name_three_parts_particle_limitation() {
        // Documents the known limitation: name particles like "van der"
        // are not detected — the last space heuristic treats only the
        // final token as the family name.
        let name = split_flat_name("Pieter van der Berg");
        assert_eq!(name.family, Some("Berg".to_string()));
        assert_eq!(name.given, Some("Pieter van der".to_string()));
        assert_eq!(name.literal, None);
    }

    #[test]
    fn split_flat_name_initials() {
        let name = split_flat_name("E. L. Berger");
        assert_eq!(name.family, Some("Berger".to_string()));
        assert_eq!(name.given, Some("E. L.".to_string()));
        assert_eq!(name.literal, None);
    }

    #[test]
    fn split_flat_name_single_name() {
        let name = split_flat_name("Aristotle");
        assert_eq!(name.family, Some("Aristotle".to_string()));
        assert_eq!(name.given, None);
        assert_eq!(name.literal, None);
    }

    #[test]
    fn parse_arxiv_atom_sets_arxiv_id() {
        let entry = parse_arxiv_atom(SINGLE_AUTHOR_XML).expect("should parse");
        assert_eq!(entry.arxiv_id, Some("2301.07041".to_string()));
    }

    #[test]
    fn parse_arxiv_atom_old_style_sets_arxiv_id() {
        let entry = parse_arxiv_atom(OLD_STYLE_ID_XML).expect("should parse");
        assert_eq!(entry.arxiv_id, Some("hep-ph/0703105".to_string()));
    }

    #[test]
    fn parse_arxiv_atom_isbn_is_none() {
        let entry = parse_arxiv_atom(SINGLE_AUTHOR_XML).expect("should parse");
        assert_eq!(entry.isbn, None);
    }

    #[test]
    fn parse_arxiv_atom_uses_csl_author_format() {
        // Verify that the CslName -> csl_to_bib_entry path produces
        // the same "Family, Given" format as before.
        let entry = parse_arxiv_atom(SINGLE_AUTHOR_XML).expect("should parse");
        assert_eq!(entry.authors, vec!["Viand, Alexander"]);
    }

    #[test]
    fn parse_arxiv_atom_doi_normalized() {
        // DOI normalization from csl_to_bib_entry now applies to arXiv path.
        let xml = r#"<?xml version='1.0' encoding='UTF-8'?>
<feed xmlns="http://www.w3.org/2005/Atom"
      xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/"
      xmlns:arxiv="http://arxiv.org/schemas/atom">
  <opensearch:totalResults>1</opensearch:totalResults>
  <entry>
    <id>http://arxiv.org/abs/0704.0001v1</id>
    <title>DOI Normalization Test</title>
    <summary>A test.</summary>
    <published>2007-04-02T20:00:00Z</published>
    <author><name>Jane Doe</name></author>
    <arxiv:doi>https://doi.org/10.1103/PhysRevD.76.013009</arxiv:doi>
    <category term="hep-ph" scheme="http://arxiv.org/schemas/atom"/>
  </entry>
</feed>"#;
        let entry = parse_arxiv_atom(xml).expect("should parse");
        assert_eq!(
            entry.doi,
            Some("10.1103/PhysRevD.76.013009".to_string()),
            "DOI should be normalized (URL prefix stripped)"
        );
    }

    #[test]
    fn parse_arxiv_atom_tags_preserved() {
        let entry = parse_arxiv_atom(MULTIPLE_AUTHORS_XML).expect("should parse");
        assert_eq!(entry.tags, vec!["cs.CR", "cs.LG"]);
    }

    // ── Wiremock integration tests ─────────────────────────────────

    /// Helper to build a minimal arXiv Atom feed with a custom <published> value.
    fn atom_with_published(published: &str) -> String {
        format!(
            r#"<?xml version='1.0' encoding='UTF-8'?>
<feed xmlns="http://www.w3.org/2005/Atom"
      xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/"
      xmlns:arxiv="http://arxiv.org/schemas/atom">
  <opensearch:totalResults>1</opensearch:totalResults>
  <entry>
    <id>http://arxiv.org/abs/2301.07041v2</id>
    <title>Test Paper</title>
    <summary>A summary.</summary>
    <published>{}</published>
    <author><name>Jane Doe</name></author>
    <category term="cs.AI" scheme="http://arxiv.org/schemas/atom"/>
  </entry>
</feed>"#,
            published
        )
    }

    #[test]
    fn parse_published_multibyte_prefix_no_panic() {
        // Two 2-byte e-accent chars (\u{00E9}) followed by digits.
        // text.len() >= 4 is true (6+ bytes), but first 4 bytes are NOT all ASCII digits.
        // Before the fix, text[..4] might slice mid-char and panic or yield garbage.
        let xml = atom_with_published("\u{00E9}\u{00E9}23-01-17T00:00:00Z");
        let entry = parse_arxiv_atom(&xml).expect("should parse without panic");
        assert_eq!(entry.year, "", "year should be empty for multibyte-prefixed published value");
    }

    #[test]
    fn parse_published_short_value_no_panic() {
        // Published value shorter than 4 bytes -- must not panic.
        let xml = atom_with_published("20");
        let entry = parse_arxiv_atom(&xml).expect("should parse without panic");
        assert_eq!(entry.year, "", "year should be empty for too-short published value");
    }

    #[test]
    fn parse_published_non_digit_prefix() {
        // First 4 chars are ASCII but not digits -- should not be accepted as a year.
        let xml = atom_with_published("ABCD-01-01T00:00:00Z");
        let entry = parse_arxiv_atom(&xml).expect("should parse without panic");
        assert_eq!(entry.year, "", "year should be empty for non-digit prefix");
    }

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
