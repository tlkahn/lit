use crate::bib::types::BibEntry;
use crate::bib::writer::generate_key;
use regex::Regex;
use serde::Deserialize;
use std::collections::HashSet;
use std::sync::LazyLock;

/// A single author/editor name in CSL-JSON.
#[derive(Debug, Clone, Deserialize)]
pub struct CslName {
    pub family: Option<String>,
    pub given: Option<String>,
    /// Institutional or one-string author, e.g. "World Health Organization"
    pub literal: Option<String>,
}

/// CSL date object. `date-parts` is an array of arrays: [[2013, 7, 31]].
#[derive(Debug, Clone, Deserialize)]
pub struct CslDate {
    #[serde(default, rename = "date-parts")]
    pub date_parts: Vec<Vec<i64>>,
}

/// Handles fields that can be either a string or an array of strings.
#[derive(Debug, Clone, Deserialize)]
#[serde(untagged)]
pub enum StringOrSeq {
    Single(String),
    Seq(Vec<String>),
}

impl StringOrSeq {
    pub fn into_first(self) -> Option<String> {
        match self {
            StringOrSeq::Single(s) if !s.is_empty() => Some(s),
            StringOrSeq::Seq(v) => v.into_iter().next(),
            _ => None,
        }
    }
}

/// A CSL-JSON item. Fields are the union of Crossref work `message` and
/// Zotero CSL-JSON export. All fields are optional to tolerate partial data.
#[derive(Debug, Clone, Deserialize)]
pub struct CslItem {
    #[serde(rename = "type")]
    pub item_type: Option<String>,
    pub title: Option<StringOrSeq>,
    pub author: Option<Vec<CslName>>,
    #[serde(rename = "container-title")]
    pub container_title: Option<StringOrSeq>,
    pub issued: Option<CslDate>,
    #[serde(rename = "DOI")]
    pub doi: Option<String>,
    #[serde(rename = "URL")]
    pub url: Option<String>,
    #[serde(rename = "abstract")]
    pub abstract_text: Option<String>,
    pub subject: Option<Vec<String>>,
    pub volume: Option<String>,
    pub issue: Option<String>,
    pub page: Option<String>,
    pub publisher: Option<String>,
    #[serde(rename = "ISSN")]
    pub issn: Option<StringOrSeq>,
    #[serde(rename = "ISBN")]
    pub isbn: Option<String>,
    pub reference: Option<Vec<CrossrefReference>>,
}

/// A single entry from the Crossref `reference` array. These are sparse
/// bibliography stubs — all fields are optional.
#[derive(Debug, Clone, Deserialize)]
pub struct CrossrefReference {
    #[serde(rename = "DOI")]
    pub doi: Option<String>,
    #[serde(rename = "article-title")]
    pub article_title: Option<String>,
    pub author: Option<String>,
    pub year: Option<String>,
    pub volume: Option<String>,
    #[serde(rename = "first-page")]
    pub first_page: Option<String>,
    #[serde(rename = "journal-title")]
    pub journal_title: Option<String>,
}

static TAG_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"</?[a-zA-Z][a-zA-Z0-9:_-]*[^>]*>").unwrap());

/// Remove JATS XML tags and plain HTML tags, then trim whitespace.
pub fn strip_jats(s: &str) -> String {
    TAG_RE.replace_all(s, "").trim().to_string()
}

static DOI_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^10\.\d{4,}/\S+$").unwrap());

/// Validate that a string looks like a bare DOI (10.NNNN/suffix).
pub fn is_valid_doi(s: &str) -> bool {
    DOI_RE.is_match(s.trim())
}

/// Map a CSL/Crossref type string to a BibTeX entry type.
fn map_entry_type(csl_type: &str) -> String {
    match csl_type {
        "journal-article" | "article-journal" => "article",
        "book" => "book",
        "book-chapter" | "chapter" => "incollection",
        "proceedings-article" | "paper-conference" => "inproceedings",
        "dissertation" | "thesis" => "phdthesis",
        "report" | "report-entry" => "techreport",
        _ => "misc",
    }
    .to_string()
}

/// Strip the trailing version suffix (e.g. "v2") from an arXiv ID.
/// Both new-style ("2301.07041v2" -> "2301.07041") and old-style
/// ("hep-ph/0703105v1" -> "hep-ph/0703105") are handled.
pub fn normalize_arxiv_id(raw: &str) -> String {
    let s = raw.trim();
    static VER_SUFFIX: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"v\d+$").unwrap());
    VER_SUFFIX.replace(s, "").into_owned()
}

/// Normalize a DOI to its bare form by stripping known URL prefixes and trimming.
pub fn normalize_doi(raw: &str) -> String {
    let s = raw.trim();
    let prefixes = [
        "https://doi.org/",
        "http://doi.org/",
        "https://dx.doi.org/",
        "http://dx.doi.org/",
        "doi:",
    ];
    for prefix in prefixes {
        if s.len() >= prefix.len()
            && s.as_bytes()[..prefix.len()].eq_ignore_ascii_case(prefix.as_bytes())
        {
            return s[prefix.len()..].trim().to_string();
        }
    }
    s.to_string()
}

/// Convert a CSL-JSON item into a `BibEntry`.
pub fn csl_to_bib_entry(item: &CslItem) -> BibEntry {
    let authors: Vec<String> = item
        .author
        .as_ref()
        .map(|names| {
            names
                .iter()
                .filter_map(|n| {
                    if let (Some(family), Some(given)) = (&n.family, &n.given) {
                        Some(format!("{}, {}", family, given))
                    } else if let Some(literal) = &n.literal {
                        Some(literal.clone())
                    } else {
                        n.family.clone()
                    }
                })
                .collect()
        })
        .unwrap_or_default();

    let title = item
        .title
        .clone()
        .and_then(|t| t.into_first())
        .map(|t| strip_jats(&t))
        .unwrap_or_default();

    let year = item
        .issued
        .as_ref()
        .and_then(|d| d.date_parts.first())
        .and_then(|parts| parts.first())
        .map(|y| y.to_string())
        .unwrap_or_default();

    let entry_type = item
        .item_type
        .as_deref()
        .map(map_entry_type)
        .unwrap_or_else(|| "misc".to_string());

    let key = generate_key(&authors, &year, &HashSet::new());

    BibEntry {
        key,
        authors,
        title,
        year,
        entry_type,
        line_number: 0,
        bib_file: None,
        abstract_text: item.abstract_text.as_deref().map(strip_jats),
        doi: item.doi.as_deref().map(normalize_doi),
        journal: item.container_title.clone().and_then(|ct| ct.into_first()),
        url: item.url.clone(),
        file: None,
        volume: item.volume.clone(),
        number: item.issue.clone(),
        pages: item.page.clone(),
        publisher: item.publisher.clone(),
        issn: item.issn.clone().and_then(|i| i.into_first()),
        isbn: item.isbn.clone(),
        arxiv_id: None,
        oclc: None,
        work_type: None,
        series: None,
        lccn: None,
        editors: vec![],
        tags: item.subject.clone().unwrap_or_default(),
    }
}

/// Convert a Crossref reference entry into a minimal `BibEntry`.
/// Mirrors `s2_ref_to_bib_entry` from the S2 pipeline.
pub fn crossref_ref_to_bib_entry(
    cr_ref: &CrossrefReference,
    existing_keys: &HashSet<String>,
) -> BibEntry {
    let authors: Vec<String> = cr_ref
        .author
        .as_deref()
        .filter(|s| !s.is_empty())
        .map(|s| vec![s.to_string()])
        .unwrap_or_default();

    let title = cr_ref
        .article_title
        .as_deref()
        .map(strip_jats)
        .unwrap_or_default();

    let year = cr_ref.year.clone().unwrap_or_default();

    let doi = cr_ref.doi.as_deref().map(normalize_doi);

    let mut entry = minimal_ref_bib_entry(authors, title, year, doi, existing_keys);
    entry.journal = cr_ref.journal_title.clone();
    entry.volume = cr_ref.volume.clone();
    entry.pages = cr_ref.first_page.clone();
    entry
}

/// Build a minimal reference `BibEntry` stub from pre-extracted fields.
///
/// Both `crossref_ref_to_bib_entry` and `s2_ref_to_bib_entry` derive the same
/// skeleton: entry_type "misc", line_number 0, all optional fields None, tags
/// empty. This builder centralises that contract; callers override extra
/// fields on the returned value.
pub fn minimal_ref_bib_entry(
    authors: Vec<String>,
    title: String,
    year: String,
    doi: Option<String>,
    existing_keys: &HashSet<String>,
) -> BibEntry {
    let key = generate_key(&authors, &year, existing_keys);
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

#[cfg(test)]
mod tests {
    use super::*;

    // ── Group 1: strip_jats ──────────────────────────────────────────

    #[test]
    fn strip_jats_removes_jats_p_tags() {
        assert_eq!(strip_jats("<jats:p>Hello world</jats:p>"), "Hello world");
    }

    #[test]
    fn strip_jats_removes_nested_jats() {
        assert_eq!(
            strip_jats("<jats:p>Some <jats:italic>emphasized</jats:italic> text</jats:p>"),
            "Some emphasized text"
        );
    }

    #[test]
    fn strip_jats_removes_plain_html() {
        assert_eq!(
            strip_jats("<p>Paragraph with <b>bold</b></p>"),
            "Paragraph with bold"
        );
    }

    #[test]
    fn strip_jats_passthrough_no_tags() {
        assert_eq!(
            strip_jats("Plain text with no tags"),
            "Plain text with no tags"
        );
    }

    #[test]
    fn strip_jats_empty_string() {
        assert_eq!(strip_jats(""), "");
    }

    #[test]
    fn strip_jats_trims_whitespace() {
        assert_eq!(strip_jats("  <jats:p>  spaced  </jats:p>  "), "spaced");
    }

    // ── Group 2a: normalize_arxiv_id ──────────────────────────────────

    #[test]
    fn test_normalize_arxiv_id_strips_version() {
        assert_eq!(normalize_arxiv_id("2301.07041v2"), "2301.07041");
    }

    #[test]
    fn test_normalize_arxiv_id_no_version() {
        assert_eq!(normalize_arxiv_id("2301.07041"), "2301.07041");
    }

    #[test]
    fn test_normalize_arxiv_id_old_style_strips_version() {
        assert_eq!(normalize_arxiv_id("hep-ph/0703105v1"), "hep-ph/0703105");
    }

    #[test]
    fn test_normalize_arxiv_id_old_style_no_version() {
        assert_eq!(normalize_arxiv_id("hep-ph/0703105"), "hep-ph/0703105");
    }

    #[test]
    fn test_normalize_arxiv_id_high_version() {
        assert_eq!(normalize_arxiv_id("2301.07041v15"), "2301.07041");
    }

    #[test]
    fn test_normalize_arxiv_id_trims_whitespace() {
        assert_eq!(normalize_arxiv_id("  2301.07041v2  "), "2301.07041");
    }

    // ── Group 2b: normalize_doi ──────────────────────────────────────

    #[test]
    fn normalize_doi_bare() {
        assert_eq!(normalize_doi("10.1038/nature12373"), "10.1038/nature12373");
    }

    #[test]
    fn normalize_doi_https_prefix() {
        assert_eq!(
            normalize_doi("https://doi.org/10.1038/nature12373"),
            "10.1038/nature12373"
        );
    }

    #[test]
    fn normalize_doi_http_prefix() {
        assert_eq!(
            normalize_doi("http://doi.org/10.1038/nature12373"),
            "10.1038/nature12373"
        );
    }

    #[test]
    fn normalize_doi_doi_colon_prefix() {
        assert_eq!(
            normalize_doi("doi:10.1038/nature12373"),
            "10.1038/nature12373"
        );
    }

    #[test]
    fn normalize_doi_trims_whitespace() {
        assert_eq!(
            normalize_doi("  10.1038/nature12373  "),
            "10.1038/nature12373"
        );
    }

    #[test]
    fn normalize_doi_dx_doi_org() {
        assert_eq!(
            normalize_doi("https://dx.doi.org/10.1038/nature12373"),
            "10.1038/nature12373"
        );
    }

    #[test]
    fn normalize_doi_uppercase_https_prefix() {
        assert_eq!(
            normalize_doi("HTTPS://DOI.ORG/10.1038/nature12373"),
            "10.1038/nature12373"
        );
    }

    #[test]
    fn normalize_doi_mixed_case_https_prefix() {
        assert_eq!(
            normalize_doi("Https://Doi.Org/10.1038/nature12373"),
            "10.1038/nature12373"
        );
    }

    #[test]
    fn normalize_doi_uppercase_dx_doi_org() {
        assert_eq!(
            normalize_doi("HTTPS://DX.DOI.ORG/10.1038/nature12373"),
            "10.1038/nature12373"
        );
    }

    #[test]
    fn normalize_doi_uppercase_doi_colon() {
        assert_eq!(
            normalize_doi("DOI:10.1038/nature12373"),
            "10.1038/nature12373"
        );
    }

    #[test]
    fn normalize_doi_preserves_suffix_casing() {
        assert_eq!(
            normalize_doi("HTTPS://DOI.ORG/10.1038/NaTuRe12373"),
            "10.1038/NaTuRe12373"
        );
    }

    #[test]
    fn normalize_doi_non_ascii_input_does_not_panic() {
        // Multibyte chars must not panic prefix-length slicing
        assert_eq!(normalize_doi("€€€€€€€€"), "€€€€€€€€");
    }

    // ── Group 3: is_valid_doi ────────────────────────────────────────

    #[test]
    fn is_valid_doi_standard() {
        assert!(is_valid_doi("10.1038/nature12373"));
    }

    #[test]
    fn is_valid_doi_long_registrant() {
        assert!(is_valid_doi("10.11234/some-suffix"));
    }

    #[test]
    fn is_valid_doi_with_special_chars() {
        assert!(is_valid_doi("10.1000/xyz123.456"));
    }

    #[test]
    fn is_valid_doi_missing_prefix() {
        assert!(!is_valid_doi("nature12373"));
    }

    #[test]
    fn is_valid_doi_no_suffix() {
        assert!(!is_valid_doi("10.1038/"));
    }

    #[test]
    fn is_valid_doi_short_registrant() {
        assert!(!is_valid_doi("10.1/x"));
    }

    #[test]
    fn is_valid_doi_empty() {
        assert!(!is_valid_doi(""));
    }

    // ── Group 4: map_entry_type ──────────────────────────────────────

    #[test]
    fn map_entry_type_journal_article() {
        assert_eq!(map_entry_type("journal-article"), "article");
    }

    #[test]
    fn map_entry_type_article_journal() {
        assert_eq!(map_entry_type("article-journal"), "article");
    }

    #[test]
    fn map_entry_type_book() {
        assert_eq!(map_entry_type("book"), "book");
    }

    #[test]
    fn map_entry_type_proceedings() {
        assert_eq!(map_entry_type("proceedings-article"), "inproceedings");
    }

    #[test]
    fn map_entry_type_paper_conference() {
        assert_eq!(map_entry_type("paper-conference"), "inproceedings");
    }

    #[test]
    fn map_entry_type_book_chapter() {
        assert_eq!(map_entry_type("book-chapter"), "incollection");
    }

    #[test]
    fn map_entry_type_chapter() {
        assert_eq!(map_entry_type("chapter"), "incollection");
    }

    #[test]
    fn map_entry_type_dissertation() {
        assert_eq!(map_entry_type("dissertation"), "phdthesis");
    }

    #[test]
    fn map_entry_type_thesis() {
        assert_eq!(map_entry_type("thesis"), "phdthesis");
    }

    #[test]
    fn map_entry_type_report() {
        assert_eq!(map_entry_type("report"), "techreport");
    }

    #[test]
    fn map_entry_type_report_entry() {
        assert_eq!(map_entry_type("report-entry"), "techreport");
    }

    #[test]
    fn map_entry_type_unknown_falls_back_to_misc() {
        assert_eq!(map_entry_type("posted-content"), "misc");
    }

    #[test]
    fn map_entry_type_dataset() {
        assert_eq!(map_entry_type("dataset"), "misc");
    }

    // ── Group 5: CslItem deserialization ─────────────────────────────

    #[test]
    fn deserialize_crossref_title_as_array() {
        let json = r#"{"title": ["Foo Bar"]}"#;
        let item: CslItem = serde_json::from_str(json).unwrap();
        let title = item.title.unwrap().into_first().unwrap();
        assert_eq!(title, "Foo Bar");
    }

    #[test]
    fn deserialize_zotero_title_as_string() {
        let json = r#"{"title": "Foo Bar"}"#;
        let item: CslItem = serde_json::from_str(json).unwrap();
        let title = item.title.unwrap().into_first().unwrap();
        assert_eq!(title, "Foo Bar");
    }

    #[test]
    fn deserialize_crossref_author() {
        let json = r#"{"author": [{"family": "Smith", "given": "John"}]}"#;
        let item: CslItem = serde_json::from_str(json).unwrap();
        let authors = item.author.unwrap();
        assert_eq!(authors[0].family.as_deref(), Some("Smith"));
        assert_eq!(authors[0].given.as_deref(), Some("John"));
    }

    #[test]
    fn deserialize_literal_author() {
        let json = r#"{"author": [{"literal": "WHO"}]}"#;
        let item: CslItem = serde_json::from_str(json).unwrap();
        let authors = item.author.unwrap();
        assert_eq!(authors[0].literal.as_deref(), Some("WHO"));
    }

    #[test]
    fn deserialize_issued_date_parts() {
        let json = r#"{"issued": {"date-parts": [[2013, 7, 31]]}}"#;
        let item: CslItem = serde_json::from_str(json).unwrap();
        let year = item.issued.unwrap().date_parts[0][0];
        assert_eq!(year, 2013);
    }

    #[test]
    fn deserialize_issued_year_only() {
        let json = r#"{"issued": {"date-parts": [[2013]]}}"#;
        let item: CslItem = serde_json::from_str(json).unwrap();
        let year = item.issued.unwrap().date_parts[0][0];
        assert_eq!(year, 2013);
    }

    #[test]
    fn deserialize_missing_issued() {
        let json = r#"{"title": "X"}"#;
        let item: CslItem = serde_json::from_str(json).unwrap();
        assert!(item.issued.is_none());
    }

    #[test]
    fn deserialize_empty_date_parts() {
        let json = r#"{"issued": {"date-parts": []}}"#;
        let item: CslItem = serde_json::from_str(json).unwrap();
        assert!(item.issued.unwrap().date_parts.is_empty());
    }

    #[test]
    fn deserialize_container_title_array() {
        let json = r#"{"container-title": ["Nature"]}"#;
        let item: CslItem = serde_json::from_str(json).unwrap();
        let journal = item.container_title.unwrap().into_first().unwrap();
        assert_eq!(journal, "Nature");
    }

    #[test]
    fn deserialize_container_title_string() {
        let json = r#"{"container-title": "Nature"}"#;
        let item: CslItem = serde_json::from_str(json).unwrap();
        let journal = item.container_title.unwrap().into_first().unwrap();
        assert_eq!(journal, "Nature");
    }

    // ── Group 6: csl_to_bib_entry (integration) ─────────────────────

    #[test]
    fn csl_to_bib_entry_full_crossref_item() {
        let json = r#"{
            "type": "journal-article",
            "title": ["Probing condensed matter physics with magnetometry based on nitrogen-vacancy centres in diamond"],
            "author": [
                {"family": "Kucsko", "given": "Georg"},
                {"family": "Maurer", "given": "Peter C."}
            ],
            "container-title": ["Nature"],
            "issued": {"date-parts": [[2013, 7, 31]]},
            "DOI": "10.1038/nature12373",
            "URL": "https://doi.org/10.1038/nature12373",
            "abstract": "<jats:p>Summary of the paper</jats:p>",
            "subject": ["Physics", "Quantum"],
            "volume": "500",
            "issue": "7460",
            "page": "54-58",
            "publisher": "Springer Science and Business Media LLC",
            "ISSN": ["0028-0836", "1476-4687"]
        }"#;
        let item: CslItem = serde_json::from_str(json).unwrap();
        let entry = csl_to_bib_entry(&item);
        assert_eq!(entry.key, "kucsko2013");
        assert_eq!(entry.entry_type, "article");
        assert_eq!(entry.authors, vec!["Kucsko, Georg", "Maurer, Peter C."]);
        assert_eq!(entry.title, "Probing condensed matter physics with magnetometry based on nitrogen-vacancy centres in diamond");
        assert_eq!(entry.year, "2013");
        assert_eq!(entry.journal, Some("Nature".to_string()));
        assert_eq!(entry.doi, Some("10.1038/nature12373".to_string()));
        assert_eq!(entry.url, Some("https://doi.org/10.1038/nature12373".to_string()));
        assert_eq!(entry.abstract_text, Some("Summary of the paper".to_string()));
        assert_eq!(entry.tags, vec!["Physics", "Quantum"]);
        assert_eq!(entry.volume, Some("500".to_string()));
        assert_eq!(entry.number, Some("7460".to_string()));
        assert_eq!(entry.pages, Some("54-58".to_string()));
        assert_eq!(entry.publisher, Some("Springer Science and Business Media LLC".to_string()));
        assert_eq!(entry.issn, Some("0028-0836".to_string()));
    }

    #[test]
    fn csl_to_bib_entry_zotero_item() {
        let json = r#"{
            "type": "article-journal",
            "title": "A Zotero Paper",
            "author": [{"family": "Smith", "given": "Jane"}],
            "container-title": "Journal of Testing",
            "issued": {"date-parts": [[2022]]}
        }"#;
        let item: CslItem = serde_json::from_str(json).unwrap();
        let entry = csl_to_bib_entry(&item);
        assert_eq!(entry.key, "smith2022");
        assert_eq!(entry.entry_type, "article");
        assert_eq!(entry.authors, vec!["Smith, Jane"]);
        assert_eq!(entry.title, "A Zotero Paper");
        assert_eq!(entry.year, "2022");
        assert_eq!(entry.journal, Some("Journal of Testing".to_string()));
    }

    #[test]
    fn csl_to_bib_entry_minimal_item() {
        let json = r#"{
            "type": "book",
            "title": "Minimal Book"
        }"#;
        let item: CslItem = serde_json::from_str(json).unwrap();
        let entry = csl_to_bib_entry(&item);
        assert_eq!(entry.entry_type, "book");
        assert_eq!(entry.title, "Minimal Book");
        assert_eq!(entry.year, "");
        assert!(entry.authors.is_empty());
        assert_eq!(entry.doi, None);
        assert_eq!(entry.journal, None);
        assert_eq!(entry.url, None);
        assert_eq!(entry.abstract_text, None);
        assert!(entry.tags.is_empty());
    }

    #[test]
    fn csl_to_bib_entry_strips_jats_from_abstract() {
        let json = r#"{
            "title": "X",
            "abstract": "<jats:p>Summary</jats:p>"
        }"#;
        let item: CslItem = serde_json::from_str(json).unwrap();
        let entry = csl_to_bib_entry(&item);
        assert_eq!(entry.abstract_text, Some("Summary".to_string()));
    }

    #[test]
    fn csl_to_bib_entry_normalizes_doi() {
        let json = r#"{
            "title": "X",
            "DOI": "https://doi.org/10.1038/nature12373"
        }"#;
        let item: CslItem = serde_json::from_str(json).unwrap();
        let entry = csl_to_bib_entry(&item);
        assert_eq!(entry.doi, Some("10.1038/nature12373".to_string()));
    }

    #[test]
    fn csl_to_bib_entry_generates_key_from_author_year() {
        let json = r#"{
            "title": "X",
            "author": [{"family": "Kucsko", "given": "Georg"}],
            "issued": {"date-parts": [[2013]]}
        }"#;
        let item: CslItem = serde_json::from_str(json).unwrap();
        let entry = csl_to_bib_entry(&item);
        assert_eq!(entry.key, "kucsko2013");
    }

    #[test]
    fn csl_to_bib_entry_key_no_author() {
        let json = r#"{
            "title": "X",
            "issued": {"date-parts": [[2013]]}
        }"#;
        let item: CslItem = serde_json::from_str(json).unwrap();
        let entry = csl_to_bib_entry(&item);
        assert_eq!(entry.key, "unknown2013");
    }

    #[test]
    fn csl_to_bib_entry_key_no_year() {
        let json = r#"{
            "title": "X",
            "author": [{"family": "Smith", "given": "John"}]
        }"#;
        let item: CslItem = serde_json::from_str(json).unwrap();
        let entry = csl_to_bib_entry(&item);
        assert_eq!(entry.key, "smith");
    }

    #[test]
    fn csl_to_bib_entry_literal_author() {
        let json = r#"{
            "title": "X",
            "author": [{"literal": "WHO"}],
            "issued": {"date-parts": [[2020]]}
        }"#;
        let item: CslItem = serde_json::from_str(json).unwrap();
        let entry = csl_to_bib_entry(&item);
        assert!(entry.authors.contains(&"WHO".to_string()));
        assert_eq!(entry.key, "who2020");
    }

    #[test]
    fn csl_to_bib_entry_line_number_zero() {
        let json = r#"{"title": "X"}"#;
        let item: CslItem = serde_json::from_str(json).unwrap();
        let entry = csl_to_bib_entry(&item);
        assert_eq!(entry.line_number, 0);
    }

    #[test]
    fn csl_to_bib_entry_bib_file_none() {
        let json = r#"{"title": "X"}"#;
        let item: CslItem = serde_json::from_str(json).unwrap();
        let entry = csl_to_bib_entry(&item);
        assert_eq!(entry.bib_file, None);
    }

    #[test]
    fn csl_to_bib_entry_subjects_become_tags() {
        let json = r#"{
            "title": "X",
            "subject": ["Physics", "Biology"]
        }"#;
        let item: CslItem = serde_json::from_str(json).unwrap();
        let entry = csl_to_bib_entry(&item);
        assert_eq!(entry.tags, vec!["Physics", "Biology"]);
    }

    #[test]
    fn csl_to_bib_entry_strips_jats_from_title() {
        let json = r#"{
            "title": "<jats:p>Thermometry</jats:p>"
        }"#;
        let item: CslItem = serde_json::from_str(json).unwrap();
        let entry = csl_to_bib_entry(&item);
        assert_eq!(entry.title, "Thermometry");
    }

    // ── Group 7: CslItem new field deserialization ──────────────────

    #[test]
    fn deserialize_crossref_volume() {
        let json = r#"{"volume": "500"}"#;
        let item: CslItem = serde_json::from_str(json).unwrap();
        assert_eq!(item.volume, Some("500".to_string()));
    }

    #[test]
    fn deserialize_crossref_issue() {
        let json = r#"{"issue": "7460"}"#;
        let item: CslItem = serde_json::from_str(json).unwrap();
        assert_eq!(item.issue, Some("7460".to_string()));
    }

    #[test]
    fn deserialize_crossref_page() {
        let json = r#"{"page": "54-58"}"#;
        let item: CslItem = serde_json::from_str(json).unwrap();
        assert_eq!(item.page, Some("54-58".to_string()));
    }

    #[test]
    fn deserialize_crossref_publisher() {
        let json = r#"{"publisher": "Springer Science and Business Media LLC"}"#;
        let item: CslItem = serde_json::from_str(json).unwrap();
        assert_eq!(item.publisher, Some("Springer Science and Business Media LLC".to_string()));
    }

    #[test]
    fn deserialize_crossref_issn_as_array() {
        let json = r#"{"ISSN": ["0028-0836", "1476-4687"]}"#;
        let item: CslItem = serde_json::from_str(json).unwrap();
        assert!(item.issn.is_some());
        assert_eq!(item.issn.unwrap().into_first(), Some("0028-0836".to_string()));
    }

    #[test]
    fn deserialize_crossref_issn_as_string() {
        let json = r#"{"ISSN": "0028-0836"}"#;
        let item: CslItem = serde_json::from_str(json).unwrap();
        assert!(item.issn.is_some());
        assert_eq!(item.issn.unwrap().into_first(), Some("0028-0836".to_string()));
    }

    // ── Group 8: csl_to_bib_entry mapping of new fields ─────────────

    #[test]
    fn csl_to_bib_entry_maps_volume_issue_page_publisher_issn() {
        let json = r#"{
            "type": "journal-article",
            "title": ["Probing condensed matter physics"],
            "author": [
                {"family": "Kucsko", "given": "Georg"},
                {"family": "Maurer", "given": "Peter C."}
            ],
            "container-title": ["Nature"],
            "issued": {"date-parts": [[2013, 7, 31]]},
            "DOI": "10.1038/nature12373",
            "URL": "https://doi.org/10.1038/nature12373",
            "abstract": "<jats:p>Summary of the paper</jats:p>",
            "subject": ["Physics", "Quantum"],
            "volume": "500",
            "issue": "7460",
            "page": "54-58",
            "publisher": "Springer Science and Business Media LLC",
            "ISSN": ["0028-0836", "1476-4687"]
        }"#;
        let item: CslItem = serde_json::from_str(json).unwrap();
        let entry = csl_to_bib_entry(&item);
        assert_eq!(entry.volume, Some("500".to_string()));
        assert_eq!(entry.number, Some("7460".to_string()));
        assert_eq!(entry.pages, Some("54-58".to_string()));
        assert_eq!(entry.publisher, Some("Springer Science and Business Media LLC".to_string()));
        assert_eq!(entry.issn, Some("0028-0836".to_string()));
    }

    #[test]
    fn csl_to_bib_entry_issn_array_takes_first() {
        let json = r#"{
            "title": "X",
            "ISSN": ["1111-2222", "3333-4444"]
        }"#;
        let item: CslItem = serde_json::from_str(json).unwrap();
        let entry = csl_to_bib_entry(&item);
        assert_eq!(entry.issn, Some("1111-2222".to_string()));
    }

    // ── Group 9: CslItem ISBN field ────────────────────────────────────

    #[test]
    fn deserialize_csl_isbn() {
        let json = r#"{"ISBN": "9780306406157"}"#;
        let item: CslItem = serde_json::from_str(json).unwrap();
        assert_eq!(item.isbn, Some("9780306406157".to_string()));
    }

    #[test]
    fn csl_to_bib_entry_maps_isbn() {
        let json = r#"{
            "type": "book",
            "title": "A Book With ISBN",
            "ISBN": "9780306406157"
        }"#;
        let item: CslItem = serde_json::from_str(json).unwrap();
        let entry = csl_to_bib_entry(&item);
        assert_eq!(entry.isbn, Some("9780306406157".to_string()));
    }

    #[test]
    fn csl_to_bib_entry_isbn_none_when_absent() {
        let json = r#"{
            "type": "journal-article",
            "title": "A Paper Without ISBN"
        }"#;
        let item: CslItem = serde_json::from_str(json).unwrap();
        let entry = csl_to_bib_entry(&item);
        assert_eq!(entry.isbn, None);
    }

    // ── Group 10: CrossrefReference deserialization ─────────────────

    #[test]
    fn deserialize_crossref_reference_full() {
        let json = r#"{
            "DOI": "10.1038/nature12373",
            "article-title": "A Referenced Paper",
            "author": "Smith, J.",
            "year": "2020",
            "volume": "42",
            "first-page": "100",
            "journal-title": "Nature"
        }"#;
        let cr: CrossrefReference = serde_json::from_str(json).unwrap();
        assert_eq!(cr.doi, Some("10.1038/nature12373".to_string()));
        assert_eq!(cr.article_title, Some("A Referenced Paper".to_string()));
        assert_eq!(cr.author, Some("Smith, J.".to_string()));
        assert_eq!(cr.year, Some("2020".to_string()));
        assert_eq!(cr.volume, Some("42".to_string()));
        assert_eq!(cr.first_page, Some("100".to_string()));
        assert_eq!(cr.journal_title, Some("Nature".to_string()));
    }

    #[test]
    fn deserialize_crossref_reference_minimal() {
        let json = r#"{}"#;
        let cr: CrossrefReference = serde_json::from_str(json).unwrap();
        assert!(cr.doi.is_none());
        assert!(cr.article_title.is_none());
        assert!(cr.author.is_none());
        assert!(cr.year.is_none());
        assert!(cr.volume.is_none());
        assert!(cr.first_page.is_none());
        assert!(cr.journal_title.is_none());
    }

    #[test]
    fn deserialize_crossref_reference_doi_only() {
        let json = r#"{"DOI": "10.1234/ref"}"#;
        let cr: CrossrefReference = serde_json::from_str(json).unwrap();
        assert_eq!(cr.doi, Some("10.1234/ref".to_string()));
        assert!(cr.article_title.is_none());
    }

    // ── Group 11: crossref_ref_to_bib_entry ────────────────────────

    #[test]
    fn crossref_ref_to_bib_entry_full() {
        let cr = CrossrefReference {
            doi: Some("10.1038/nature12373".to_string()),
            article_title: Some("A Referenced Paper".to_string()),
            author: Some("Smith, J.".to_string()),
            year: Some("2020".to_string()),
            volume: Some("42".to_string()),
            first_page: Some("100".to_string()),
            journal_title: Some("Nature".to_string()),
        };
        let entry = crossref_ref_to_bib_entry(&cr, &HashSet::new());
        assert_eq!(entry.entry_type, "misc");
        assert_eq!(entry.title, "A Referenced Paper");
        assert_eq!(entry.year, "2020");
        assert_eq!(entry.authors, vec!["Smith, J."]);
        assert_eq!(entry.doi, Some("10.1038/nature12373".to_string()));
        assert_eq!(entry.journal, Some("Nature".to_string()));
        assert_eq!(entry.volume, Some("42".to_string()));
        assert_eq!(entry.pages, Some("100".to_string()));
        assert_eq!(entry.key, "smith2020");
    }

    #[test]
    fn crossref_ref_to_bib_entry_minimal() {
        let cr = CrossrefReference {
            doi: None,
            article_title: None,
            author: None,
            year: None,
            volume: None,
            first_page: None,
            journal_title: None,
        };
        let entry = crossref_ref_to_bib_entry(&cr, &HashSet::new());
        assert_eq!(entry.entry_type, "misc");
        assert!(entry.title.is_empty());
        assert!(entry.year.is_empty());
        assert!(entry.authors.is_empty());
        assert!(entry.doi.is_none());
        assert!(entry.journal.is_none());
        assert!(entry.volume.is_none());
        assert!(entry.pages.is_none());
    }

    #[test]
    fn crossref_ref_to_bib_entry_normalizes_doi() {
        let cr = CrossrefReference {
            doi: Some("https://doi.org/10.1038/nature12373".to_string()),
            article_title: Some("X".to_string()),
            author: None,
            year: None,
            volume: None,
            first_page: None,
            journal_title: None,
        };
        let entry = crossref_ref_to_bib_entry(&cr, &HashSet::new());
        assert_eq!(entry.doi, Some("10.1038/nature12373".to_string()));
    }

    #[test]
    fn crossref_ref_to_bib_entry_key_collision_avoided() {
        let mut existing = HashSet::new();
        existing.insert("smith2024".to_string());

        let cr = CrossrefReference {
            doi: None,
            article_title: Some("Some Paper".to_string()),
            author: Some("Smith, J.".to_string()),
            year: Some("2024".to_string()),
            volume: None,
            first_page: None,
            journal_title: None,
        };
        let entry = crossref_ref_to_bib_entry(&cr, &existing);
        assert_eq!(entry.key, "smith2024a");
    }

    #[test]
    fn crossref_ref_to_bib_entry_strips_jats_from_title() {
        let cr = CrossrefReference {
            doi: None,
            article_title: Some("<jats:p>Tagged Title</jats:p>".to_string()),
            author: None,
            year: None,
            volume: None,
            first_page: None,
            journal_title: None,
        };
        let entry = crossref_ref_to_bib_entry(&cr, &HashSet::new());
        assert_eq!(entry.title, "Tagged Title");
    }

    // ── Group 12: CslItem reference field deserialization ───────────

    #[test]
    fn deserialize_csl_item_with_references() {
        let json = r#"{
            "title": "Parent Paper",
            "reference": [
                {"DOI": "10.1/ref1", "article-title": "Ref One"},
                {"DOI": "10.1/ref2", "article-title": "Ref Two"}
            ]
        }"#;
        let item: CslItem = serde_json::from_str(json).unwrap();
        assert!(item.reference.is_some());
        let refs = item.reference.unwrap();
        assert_eq!(refs.len(), 2);
        assert_eq!(refs[0].doi, Some("10.1/ref1".to_string()));
        assert_eq!(refs[1].article_title, Some("Ref Two".to_string()));
    }

    #[test]
    fn deserialize_csl_item_without_references() {
        let json = r#"{"title": "No Refs"}"#;
        let item: CslItem = serde_json::from_str(json).unwrap();
        assert!(item.reference.is_none());
    }

    // ── Group 13: minimal_ref_bib_entry ────────────────────────────

    #[test]
    fn minimal_ref_bib_entry_basic() {
        let authors = vec!["Smith, J.".to_string()];
        let title = "A Paper Title".to_string();
        let year = "2020".to_string();
        let doi = Some("10.1038/nature12373".to_string());
        let entry = minimal_ref_bib_entry(
            authors.clone(),
            title.clone(),
            year.clone(),
            doi.clone(),
            &HashSet::new(),
        );
        assert_eq!(entry.key, "smith2020");
        assert_eq!(entry.authors, authors);
        assert_eq!(entry.title, title);
        assert_eq!(entry.year, year);
        assert_eq!(entry.doi, doi);
        assert_eq!(entry.entry_type, "misc");
        assert_eq!(entry.line_number, 0);
        assert_eq!(entry.bib_file, None);
        assert_eq!(entry.abstract_text, None);
        assert_eq!(entry.journal, None);
        assert_eq!(entry.url, None);
        assert_eq!(entry.file, None);
        assert_eq!(entry.volume, None);
        assert_eq!(entry.number, None);
        assert_eq!(entry.pages, None);
        assert_eq!(entry.publisher, None);
        assert_eq!(entry.issn, None);
        assert_eq!(entry.isbn, None);
        assert_eq!(entry.arxiv_id, None);
        assert!(entry.tags.is_empty());
    }

    #[test]
    fn minimal_ref_bib_entry_key_collision() {
        let mut existing = HashSet::new();
        existing.insert("smith2020".to_string());
        let entry = minimal_ref_bib_entry(
            vec!["Smith, J.".to_string()],
            "Title".to_string(),
            "2020".to_string(),
            None,
            &existing,
        );
        assert_eq!(entry.key, "smith2020a");
    }
}
