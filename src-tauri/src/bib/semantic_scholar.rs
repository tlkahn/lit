use serde::Deserialize;

use crate::bib::convert::{normalize_doi, strip_jats};
use crate::bib::types::BibEntry;
use crate::bib::writer::generate_key;
use std::collections::HashSet;

// ── S2 API response types ──────────────────────────────────────────

#[derive(Debug, Clone, Deserialize)]
pub struct S2ExternalIds {
    #[serde(rename = "DOI")]
    pub doi: Option<String>,
    #[serde(rename = "ArXiv")]
    pub arxiv: Option<String>,
    #[serde(rename = "PubMed")]
    pub pubmed: Option<String>,
    #[serde(rename = "PubMedCentral")]
    pub pubmed_central: Option<String>,
    #[serde(rename = "MAG")]
    pub mag: Option<String>,
    #[serde(rename = "CorpusId")]
    pub corpus_id: Option<u64>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct S2Author {
    #[serde(rename = "authorId")]
    pub author_id: Option<String>,
    pub name: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct S2Tldr {
    pub model: Option<String>,
    pub text: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct S2Journal {
    pub name: Option<String>,
    pub pages: Option<String>,
    pub volume: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct S2Reference {
    #[serde(rename = "paperId")]
    pub paper_id: Option<String>,
    #[serde(rename = "externalIds")]
    pub external_ids: Option<S2ExternalIds>,
    pub title: Option<String>,
    pub year: Option<i64>,
    pub authors: Option<Vec<S2Author>>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct S2Paper {
    #[serde(rename = "paperId")]
    pub paper_id: Option<String>,
    #[serde(rename = "externalIds")]
    pub external_ids: Option<S2ExternalIds>,
    pub url: Option<String>,
    pub title: Option<String>,
    pub venue: Option<String>,
    pub year: Option<i64>,
    #[serde(rename = "referenceCount")]
    pub reference_count: Option<i64>,
    #[serde(rename = "citationCount")]
    pub citation_count: Option<i64>,
    pub tldr: Option<S2Tldr>,
    pub journal: Option<S2Journal>,
    pub authors: Option<Vec<S2Author>>,
    #[serde(rename = "abstract")]
    pub abstract_text: Option<String>,
    pub references: Option<Vec<S2Reference>>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct S2SearchResponse {
    pub total: Option<i64>,
    pub offset: Option<i64>,
    pub next: Option<i64>,
    pub data: Option<Vec<S2Paper>>,
}

// ── Pure parsers ───────────────────────────────────────────────────

pub fn parse_s2_response(body: &str) -> Result<S2Paper, String> {
    serde_json::from_str(body).map_err(|e| format!("Failed to parse S2 response: {}", e))
}

pub fn parse_s2_search(body: &str) -> Result<Vec<S2Paper>, String> {
    let resp: S2SearchResponse =
        serde_json::from_str(body).map_err(|e| format!("Failed to parse S2 search response: {}", e))?;
    Ok(resp.data.unwrap_or_default())
}

pub fn s2_paper_to_bib_entry(paper: &S2Paper) -> BibEntry {
    let authors: Vec<String> = paper
        .authors
        .as_ref()
        .map(|auths| auths.iter().filter_map(|a| a.name.clone()).collect())
        .unwrap_or_default();

    let title = paper
        .title
        .as_deref()
        .map(strip_jats)
        .unwrap_or_default();

    let year = paper
        .year
        .map(|y| y.to_string())
        .unwrap_or_default();

    let journal = paper
        .journal
        .as_ref()
        .and_then(|j| j.name.clone());

    let volume = paper
        .journal
        .as_ref()
        .and_then(|j| j.volume.clone());

    let pages = paper
        .journal
        .as_ref()
        .and_then(|j| j.pages.clone());

    let doi = paper
        .external_ids
        .as_ref()
        .and_then(|ids| ids.doi.as_deref())
        .map(normalize_doi);

    let url = paper.url.clone();

    let abstract_text = paper
        .abstract_text
        .as_deref()
        .map(strip_jats)
        .or_else(|| {
            paper.tldr.as_ref().and_then(|t| t.text.clone())
        });

    let entry_type = if journal.is_some() {
        "article".to_string()
    } else {
        "misc".to_string()
    };

    let key = generate_key(&authors, &year, &HashSet::new());

    BibEntry {
        key,
        authors,
        title,
        year,
        entry_type,
        line_number: 0,
        bib_file: None,
        abstract_text,
        doi,
        journal,
        url,
        volume,
        number: None,
        pages,
        publisher: None,
        issn: None,
        tags: vec![],
    }
}

pub fn s2_ref_to_bib_entry(reference: &S2Reference) -> BibEntry {
    let authors: Vec<String> = reference
        .authors
        .as_ref()
        .map(|auths| auths.iter().filter_map(|a| a.name.clone()).collect())
        .unwrap_or_default();

    let title = reference
        .title
        .as_deref()
        .map(strip_jats)
        .unwrap_or_default();

    let year = reference
        .year
        .map(|y| y.to_string())
        .unwrap_or_default();

    let doi = reference
        .external_ids
        .as_ref()
        .and_then(|ids| ids.doi.as_deref())
        .map(normalize_doi);

    let key = generate_key(&authors, &year, &HashSet::new());

    BibEntry {
        key,
        authors,
        title,
        year,
        entry_type: "misc".to_string(),
        line_number: 0,
        bib_file: None,
        abstract_text: None,
        doi,
        journal: None,
        url: None,
        volume: None,
        number: None,
        pages: None,
        publisher: None,
        issn: None,
        tags: vec![],
    }
}

// ── Async API calls ────────────────────────────────────────────────

const S2_PAPER_FIELDS: &str = "paperId,title,abstract,authors,year,referenceCount,citationCount,tldr,externalIds,journal,venue,url,references.title,references.authors,references.year,references.externalIds";

const S2_SEARCH_FIELDS: &str = "paperId,title,authors,year,externalIds,journal,abstract,tldr";

const S2_BASE_URL: &str = "https://api.semanticscholar.org";

pub async fn lookup_by_doi(client: &reqwest::Client, doi: &str) -> Result<S2Paper, String> {
    lookup_by_doi_with_base(client, doi, S2_BASE_URL).await
}

pub(crate) async fn lookup_by_doi_with_base(
    client: &reqwest::Client,
    doi: &str,
    base_url: &str,
) -> Result<S2Paper, String> {
    let normalized = normalize_doi(doi);
    let url = format!(
        "{}/graph/v1/paper/DOI:{}?fields={}",
        base_url, normalized, S2_PAPER_FIELDS
    );

    let response = client.get(&url).send().await.map_err(|e| {
        if e.is_timeout() {
            "Request timed out".to_string()
        } else {
            format!("HTTP request failed: {}", e)
        }
    })?;

    let status = response.status();
    if status == reqwest::StatusCode::NOT_FOUND {
        return Err(format!("DOI not found on Semantic Scholar: {}", normalized));
    }
    if status == reqwest::StatusCode::TOO_MANY_REQUESTS {
        return Err(
            "Rate limited by Semantic Scholar API. Please wait and try again, or apply for an API key at https://www.semanticscholar.org/product/api#api-key-form"
                .to_string(),
        );
    }
    if !status.is_success() {
        return Err(format!(
            "Semantic Scholar API returned status {}",
            status.as_u16()
        ));
    }

    let body = response
        .text()
        .await
        .map_err(|e| format!("Failed to read response body: {}", e))?;

    parse_s2_response(&body)
}

pub async fn search_by_title(
    client: &reqwest::Client,
    title: &str,
) -> Result<Vec<S2Paper>, String> {
    search_by_title_with_base(client, title, S2_BASE_URL).await
}

pub(crate) async fn search_by_title_with_base(
    client: &reqwest::Client,
    title: &str,
    base_url: &str,
) -> Result<Vec<S2Paper>, String> {
    let url = format!("{}/graph/v1/paper/search", base_url);

    let response = client
        .get(&url)
        .query(&[
            ("query", title),
            ("fields", S2_SEARCH_FIELDS),
            ("limit", "5"),
        ])
        .send()
        .await
        .map_err(|e| {
            if e.is_timeout() {
                "Request timed out".to_string()
            } else {
                format!("HTTP request failed: {}", e)
            }
        })?;

    let status = response.status();
    if status == reqwest::StatusCode::NOT_FOUND {
        return Err("Search endpoint not found".to_string());
    }
    if status == reqwest::StatusCode::TOO_MANY_REQUESTS {
        return Err(
            "Rate limited by Semantic Scholar API. Please wait and try again, or apply for an API key at https://www.semanticscholar.org/product/api#api-key-form"
                .to_string(),
        );
    }
    if !status.is_success() {
        return Err(format!(
            "Semantic Scholar API returned status {}",
            status.as_u16()
        ));
    }

    let body = response
        .text()
        .await
        .map_err(|e| format!("Failed to read response body: {}", e))?;

    parse_s2_search(&body)
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── Group 1: parse_s2_response (pure, no network) ──────────────

    #[test]
    fn parse_s2_response_full_paper() {
        let body = r#"{
            "paperId": "e3f5697c8b2fd1b0ef6a1b7b2d3c4e5f6a7b8c9d",
            "externalIds": {
                "DOI": "10.1038/nature12373",
                "ArXiv": "1304.1068",
                "PubMed": "23887427",
                "CorpusId": 4314121,
                "MAG": "2044635027"
            },
            "url": "https://www.semanticscholar.org/paper/e3f5697c",
            "title": "Nanometre-scale thermometry in a living cell",
            "venue": "Nature",
            "year": 2013,
            "referenceCount": 42,
            "citationCount": 1500,
            "tldr": {
                "model": "tldr@v2.0.0",
                "text": "A new approach using nitrogen-vacancy centres in diamond for nanoscale thermometry."
            },
            "journal": {
                "name": "Nature",
                "volume": "500",
                "pages": "54 - 58"
            },
            "authors": [
                {"authorId": "123", "name": "G. Kucsko"},
                {"authorId": "456", "name": "P. Maurer"},
                {"authorId": "789", "name": "N. Yao"}
            ],
            "abstract": "We demonstrate a new approach to nanoscale thermometry using nitrogen-vacancy centres in diamond.",
            "references": [
                {
                    "paperId": "ref1",
                    "externalIds": {"DOI": "10.1000/ref1", "CorpusId": 12345},
                    "title": "A reference paper",
                    "year": 2010,
                    "authors": [{"authorId": "r1", "name": "R. One"}]
                }
            ]
        }"#;
        let paper = parse_s2_response(body).unwrap();
        assert_eq!(paper.paper_id.as_deref(), Some("e3f5697c8b2fd1b0ef6a1b7b2d3c4e5f6a7b8c9d"));
        assert_eq!(paper.title.as_deref(), Some("Nanometre-scale thermometry in a living cell"));
        assert_eq!(paper.year, Some(2013));
        assert_eq!(paper.venue.as_deref(), Some("Nature"));
        assert_eq!(paper.reference_count, Some(42));
        assert_eq!(paper.citation_count, Some(1500));

        let ids = paper.external_ids.as_ref().unwrap();
        assert_eq!(ids.doi.as_deref(), Some("10.1038/nature12373"));
        assert_eq!(ids.arxiv.as_deref(), Some("1304.1068"));
        assert_eq!(ids.pubmed.as_deref(), Some("23887427"));
        assert_eq!(ids.corpus_id, Some(4314121));

        let journal = paper.journal.as_ref().unwrap();
        assert_eq!(journal.name.as_deref(), Some("Nature"));
        assert_eq!(journal.volume.as_deref(), Some("500"));
        assert_eq!(journal.pages.as_deref(), Some("54 - 58"));

        let authors = paper.authors.as_ref().unwrap();
        assert_eq!(authors.len(), 3);
        assert_eq!(authors[0].name.as_deref(), Some("G. Kucsko"));
        assert_eq!(authors[1].name.as_deref(), Some("P. Maurer"));

        assert!(paper.abstract_text.as_deref().unwrap().contains("nanoscale thermometry"));

        let tldr = paper.tldr.as_ref().unwrap();
        assert!(tldr.text.as_deref().unwrap().contains("nitrogen-vacancy"));

        let refs = paper.references.as_ref().unwrap();
        assert!(!refs.is_empty());
        assert_eq!(refs[0].title.as_deref(), Some("A reference paper"));
        assert_eq!(refs[0].year, Some(2010));
    }

    #[test]
    fn parse_s2_response_minimal() {
        let body = r#"{"paperId": "abc123", "title": "Minimal Paper"}"#;
        let paper = parse_s2_response(body).unwrap();
        assert_eq!(paper.paper_id.as_deref(), Some("abc123"));
        assert_eq!(paper.title.as_deref(), Some("Minimal Paper"));
        assert!(paper.external_ids.is_none());
        assert!(paper.year.is_none());
        assert!(paper.authors.is_none());
        assert!(paper.journal.is_none());
        assert!(paper.tldr.is_none());
        assert!(paper.abstract_text.is_none());
        assert!(paper.references.is_none());
        assert!(paper.venue.is_none());
        assert!(paper.reference_count.is_none());
        assert!(paper.citation_count.is_none());
        assert!(paper.url.is_none());
    }

    #[test]
    fn parse_s2_response_invalid_json() {
        let result = parse_s2_response("not json at all");
        assert!(result.is_err());
        assert!(result.unwrap_err().to_lowercase().contains("parse"));
    }

    #[test]
    fn parse_s2_response_empty_object() {
        let paper = parse_s2_response("{}").unwrap();
        assert!(paper.paper_id.is_none());
        assert!(paper.title.is_none());
        assert!(paper.year.is_none());
        assert!(paper.authors.is_none());
        assert!(paper.journal.is_none());
    }

    // ── Group 2: S2SearchResponse parsing ──────────────────────────

    #[test]
    fn parse_s2_search_response() {
        let body = r#"{
            "total": 2,
            "offset": 0,
            "next": 2,
            "data": [
                {"paperId": "a", "title": "Paper X"},
                {"paperId": "b", "title": "Paper Y"}
            ]
        }"#;
        let papers = parse_s2_search(body).unwrap();
        assert_eq!(papers.len(), 2);
        assert_eq!(papers[0].paper_id.as_deref(), Some("a"));
        assert_eq!(papers[0].title.as_deref(), Some("Paper X"));
        assert_eq!(papers[1].paper_id.as_deref(), Some("b"));
        assert_eq!(papers[1].title.as_deref(), Some("Paper Y"));
    }

    #[test]
    fn parse_s2_search_response_empty_results() {
        let body = r#"{"total": 0, "data": []}"#;
        let papers = parse_s2_search(body).unwrap();
        assert!(papers.is_empty());
    }

    // ── Group 3: s2_paper_to_bib_entry conversion ──────────────────

    #[test]
    fn s2_paper_to_bib_entry_full() {
        let paper = S2Paper {
            paper_id: Some("abc".to_string()),
            external_ids: Some(S2ExternalIds {
                doi: Some("10.1038/nature12373".to_string()),
                arxiv: None,
                pubmed: None,
                pubmed_central: None,
                mag: None,
                corpus_id: Some(4314121),
            }),
            url: Some("https://www.semanticscholar.org/paper/abc".to_string()),
            title: Some("Nanometre-scale thermometry in a living cell".to_string()),
            venue: Some("Nature".to_string()),
            year: Some(2013),
            reference_count: Some(42),
            citation_count: Some(1500),
            tldr: Some(S2Tldr {
                model: Some("tldr@v2.0.0".to_string()),
                text: Some("A nitrogen-vacancy approach".to_string()),
            }),
            journal: Some(S2Journal {
                name: Some("Nature".to_string()),
                volume: Some("500".to_string()),
                pages: Some("54 - 58".to_string()),
            }),
            authors: Some(vec![
                S2Author { author_id: Some("1".to_string()), name: Some("G. Kucsko".to_string()) },
                S2Author { author_id: Some("2".to_string()), name: Some("P. Maurer".to_string()) },
            ]),
            abstract_text: Some("We demonstrate nanoscale thermometry.".to_string()),
            references: None,
        };

        let entry = s2_paper_to_bib_entry(&paper);
        assert_eq!(entry.entry_type, "article");
        assert_eq!(entry.key, "kucsko2013");
        assert_eq!(entry.authors, vec!["G. Kucsko", "P. Maurer"]);
        assert_eq!(entry.title, "Nanometre-scale thermometry in a living cell");
        assert_eq!(entry.year, "2013");
        assert_eq!(entry.journal, Some("Nature".to_string()));
        assert_eq!(entry.volume, Some("500".to_string()));
        assert_eq!(entry.pages, Some("54 - 58".to_string()));
        assert_eq!(entry.doi, Some("10.1038/nature12373".to_string()));
        assert_eq!(entry.url, Some("https://www.semanticscholar.org/paper/abc".to_string()));
        assert_eq!(entry.abstract_text, Some("We demonstrate nanoscale thermometry.".to_string()));
    }

    #[test]
    fn s2_paper_to_bib_entry_minimal() {
        let paper = S2Paper {
            paper_id: None,
            external_ids: None,
            url: None,
            title: Some("Untitled Paper".to_string()),
            venue: None,
            year: None,
            reference_count: None,
            citation_count: None,
            tldr: None,
            journal: None,
            authors: None,
            abstract_text: None,
            references: None,
        };

        let entry = s2_paper_to_bib_entry(&paper);
        assert_eq!(entry.entry_type, "misc");
        assert_eq!(entry.year, "");
        assert!(entry.authors.is_empty());
        assert!(entry.doi.is_none());
        assert!(entry.journal.is_none());
        assert!(entry.volume.is_none());
        assert!(entry.pages.is_none());
        assert!(entry.url.is_none());
        assert!(entry.abstract_text.is_none());
    }

    #[test]
    fn s2_paper_to_bib_entry_tldr_fallback() {
        let paper = S2Paper {
            paper_id: None,
            external_ids: None,
            url: None,
            title: Some("Paper".to_string()),
            venue: None,
            year: Some(2020),
            reference_count: None,
            citation_count: None,
            tldr: Some(S2Tldr {
                model: None,
                text: Some("This is the TLDR summary.".to_string()),
            }),
            journal: None,
            authors: None,
            abstract_text: None,
            references: None,
        };

        let entry = s2_paper_to_bib_entry(&paper);
        assert_eq!(entry.abstract_text, Some("This is the TLDR summary.".to_string()));
    }

    #[test]
    fn s2_paper_to_bib_entry_normalizes_doi() {
        let paper = S2Paper {
            paper_id: None,
            external_ids: Some(S2ExternalIds {
                doi: Some("https://doi.org/10.1038/xxx".to_string()),
                arxiv: None,
                pubmed: None,
                pubmed_central: None,
                mag: None,
                corpus_id: None,
            }),
            url: None,
            title: Some("Paper".to_string()),
            venue: None,
            year: None,
            reference_count: None,
            citation_count: None,
            tldr: None,
            journal: None,
            authors: None,
            abstract_text: None,
            references: None,
        };

        let entry = s2_paper_to_bib_entry(&paper);
        assert_eq!(entry.doi, Some("10.1038/xxx".to_string()));
    }

    // ── Group 4: serde edge cases ──────────────────────────────────

    #[test]
    fn s2_external_ids_corpus_id_is_number() {
        let json = r#"{"CorpusId": 4314121}"#;
        let ids: S2ExternalIds = serde_json::from_str(json).unwrap();
        assert_eq!(ids.corpus_id, Some(4314121));
    }

    #[test]
    fn s2_journal_nested_object() {
        let json = r#"{"journal": {"name": "Nature", "volume": "500", "pages": "54-58"}}"#;
        let paper: S2Paper = serde_json::from_str(json).unwrap();
        let journal = paper.journal.unwrap();
        assert_eq!(journal.name.as_deref(), Some("Nature"));
        assert_eq!(journal.volume.as_deref(), Some("500"));
        assert_eq!(journal.pages.as_deref(), Some("54-58"));
    }

    // ── Group 5: async lookup/search (wiremock) ────────────────────

    #[tokio::test]
    async fn lookup_by_doi_success() {
        let mock_server = wiremock::MockServer::start().await;
        let body = r#"{
            "paperId": "abc",
            "title": "Test Paper",
            "year": 2013,
            "externalIds": {"DOI": "10.1038/nature12373", "CorpusId": 123}
        }"#;

        wiremock::Mock::given(wiremock::matchers::method("GET"))
            .and(wiremock::matchers::path_regex(r"/graph/v1/paper/DOI:.*"))
            .respond_with(wiremock::ResponseTemplate::new(200).set_body_string(body))
            .mount(&mock_server)
            .await;

        let client = reqwest::Client::new();
        let paper = lookup_by_doi_with_base(&client, "10.1038/nature12373", &mock_server.uri())
            .await
            .unwrap();

        assert_eq!(paper.paper_id.as_deref(), Some("abc"));
        assert_eq!(paper.title.as_deref(), Some("Test Paper"));
        assert_eq!(paper.year, Some(2013));
    }

    #[tokio::test]
    async fn lookup_by_doi_404() {
        let mock_server = wiremock::MockServer::start().await;

        wiremock::Mock::given(wiremock::matchers::method("GET"))
            .and(wiremock::matchers::path_regex(r"/graph/v1/paper/DOI:.*"))
            .respond_with(wiremock::ResponseTemplate::new(404))
            .mount(&mock_server)
            .await;

        let client = reqwest::Client::new();
        let result = lookup_by_doi_with_base(&client, "10.9999/nonexistent", &mock_server.uri()).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("not found"));
    }

    #[tokio::test]
    async fn lookup_by_doi_429() {
        let mock_server = wiremock::MockServer::start().await;

        wiremock::Mock::given(wiremock::matchers::method("GET"))
            .and(wiremock::matchers::path_regex(r"/graph/v1/paper/DOI:.*"))
            .respond_with(wiremock::ResponseTemplate::new(429).set_body_string(
                r#"{"message": "Too Many Requests", "code": "429"}"#,
            ))
            .mount(&mock_server)
            .await;

        let client = reqwest::Client::new();
        let result = lookup_by_doi_with_base(&client, "10.1038/nature12373", &mock_server.uri()).await;
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(err.contains("Rate limited"), "expected rate limited error, got: {}", err);
        assert!(err.contains("api-key"), "expected API key mention, got: {}", err);
    }

    #[tokio::test]
    async fn lookup_by_doi_500() {
        let mock_server = wiremock::MockServer::start().await;

        wiremock::Mock::given(wiremock::matchers::method("GET"))
            .and(wiremock::matchers::path_regex(r"/graph/v1/paper/DOI:.*"))
            .respond_with(wiremock::ResponseTemplate::new(500))
            .mount(&mock_server)
            .await;

        let client = reqwest::Client::new();
        let result = lookup_by_doi_with_base(&client, "10.1038/nature12373", &mock_server.uri()).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("status 500"));
    }

    #[tokio::test]
    async fn search_by_title_success() {
        let mock_server = wiremock::MockServer::start().await;
        let body = r#"{
            "total": 2,
            "offset": 0,
            "data": [
                {"paperId": "a", "title": "Paper A"},
                {"paperId": "b", "title": "Paper B"}
            ]
        }"#;

        wiremock::Mock::given(wiremock::matchers::method("GET"))
            .and(wiremock::matchers::path("/graph/v1/paper/search"))
            .respond_with(wiremock::ResponseTemplate::new(200).set_body_string(body))
            .mount(&mock_server)
            .await;

        let client = reqwest::Client::new();
        let papers = search_by_title_with_base(&client, "test query", &mock_server.uri()).await.unwrap();
        assert_eq!(papers.len(), 2);
        assert_eq!(papers[0].title.as_deref(), Some("Paper A"));
        assert_eq!(papers[1].title.as_deref(), Some("Paper B"));
    }

    #[tokio::test]
    async fn search_by_title_empty_results() {
        let mock_server = wiremock::MockServer::start().await;
        let body = r#"{"total": 0, "data": []}"#;

        wiremock::Mock::given(wiremock::matchers::method("GET"))
            .and(wiremock::matchers::path("/graph/v1/paper/search"))
            .respond_with(wiremock::ResponseTemplate::new(200).set_body_string(body))
            .mount(&mock_server)
            .await;

        let client = reqwest::Client::new();
        let papers = search_by_title_with_base(&client, "nonexistent", &mock_server.uri()).await.unwrap();
        assert!(papers.is_empty());
    }

    #[tokio::test]
    async fn search_by_title_429() {
        let mock_server = wiremock::MockServer::start().await;

        wiremock::Mock::given(wiremock::matchers::method("GET"))
            .and(wiremock::matchers::path("/graph/v1/paper/search"))
            .respond_with(wiremock::ResponseTemplate::new(429))
            .mount(&mock_server)
            .await;

        let client = reqwest::Client::new();
        let result = search_by_title_with_base(&client, "test", &mock_server.uri()).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Rate limited"));
    }

    #[tokio::test]
    async fn search_by_title_url_encodes_query() {
        let mock_server = wiremock::MockServer::start().await;
        let body = r#"{"total": 0, "data": []}"#;

        wiremock::Mock::given(wiremock::matchers::method("GET"))
            .and(wiremock::matchers::path("/graph/v1/paper/search"))
            .and(wiremock::matchers::query_param("query", "hello world"))
            .respond_with(wiremock::ResponseTemplate::new(200).set_body_string(body))
            .mount(&mock_server)
            .await;

        let client = reqwest::Client::new();
        let papers = search_by_title_with_base(&client, "hello world", &mock_server.uri()).await.unwrap();
        assert!(papers.is_empty());
    }

    // ── Group 6: s2_ref_to_bib_entry ──────────────────────────────

    #[test]
    fn s2_ref_to_bib_entry_with_doi() {
        let reference = S2Reference {
            paper_id: Some("ref123".to_string()),
            external_ids: Some(S2ExternalIds {
                doi: Some("10.1000/ref1".to_string()),
                arxiv: None,
                pubmed: None,
                pubmed_central: None,
                mag: None,
                corpus_id: Some(99999),
            }),
            title: Some("A Reference Paper".to_string()),
            year: Some(2010),
            authors: Some(vec![
                S2Author { author_id: Some("r1".to_string()), name: Some("R. One".to_string()) },
            ]),
        };

        let entry = s2_ref_to_bib_entry(&reference);
        assert_eq!(entry.entry_type, "misc");
        assert_eq!(entry.title, "A Reference Paper");
        assert_eq!(entry.year, "2010");
        assert_eq!(entry.authors, vec!["R. One"]);
        assert_eq!(entry.doi, Some("10.1000/ref1".to_string()));
        assert_eq!(entry.key, "one2010");
    }

    #[test]
    fn s2_ref_to_bib_entry_minimal() {
        let reference = S2Reference {
            paper_id: None,
            external_ids: None,
            title: None,
            year: None,
            authors: None,
        };

        let entry = s2_ref_to_bib_entry(&reference);
        assert_eq!(entry.entry_type, "misc");
        assert!(entry.title.is_empty());
        assert!(entry.year.is_empty());
        assert!(entry.authors.is_empty());
        assert!(entry.doi.is_none());
        assert!(entry.journal.is_none());
        assert!(entry.url.is_none());
        assert!(entry.abstract_text.is_none());
    }

    #[test]
    fn s2_ref_to_bib_entry_none_authors() {
        let reference = S2Reference {
            paper_id: Some("ref456".to_string()),
            external_ids: None,
            title: Some("Paper Without Authors".to_string()),
            year: Some(2015),
            authors: None,
        };

        let entry = s2_ref_to_bib_entry(&reference);
        assert!(entry.authors.is_empty());
        assert_eq!(entry.title, "Paper Without Authors");
        assert_eq!(entry.year, "2015");
    }

    #[test]
    fn s2_ref_to_bib_entry_normalizes_doi() {
        let reference = S2Reference {
            paper_id: None,
            external_ids: Some(S2ExternalIds {
                doi: Some("https://doi.org/10.1038/xyz".to_string()),
                arxiv: None,
                pubmed: None,
                pubmed_central: None,
                mag: None,
                corpus_id: None,
            }),
            title: Some("Paper".to_string()),
            year: None,
            authors: None,
        };

        let entry = s2_ref_to_bib_entry(&reference);
        assert_eq!(entry.doi, Some("10.1038/xyz".to_string()));
    }
}
