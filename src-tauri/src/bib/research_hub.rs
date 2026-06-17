use crate::bib::convert::{normalize_doi, strip_jats};
use crate::bib::types::BibEntry;
use crate::bib::writer::generate_key;
use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::{Arc, LazyLock};
use std::time::Duration;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ProviderInfo {
    pub id: String,
    pub label: String,
    pub description: String,
    pub category: String,
    pub needs_api_key: bool,
}

static PROVIDER_INFO: LazyLock<Vec<ProviderInfo>> = LazyLock::new(|| vec![
    ProviderInfo { id: "openalex".into(), label: "OpenAlex".into(), description: "Open catalog of the global research system".into(), category: "general".into(), needs_api_key: false },
    ProviderInfo { id: "crossref".into(), label: "Crossref".into(), description: "DOI registration agency metadata".into(), category: "general".into(), needs_api_key: false },
    ProviderInfo { id: "base".into(), label: "BASE".into(), description: "Bielefeld Academic Search Engine".into(), category: "general".into(), needs_api_key: true },
    ProviderInfo { id: "pubmed".into(), label: "PubMed".into(), description: "Biomedical literature from MEDLINE and life science journals".into(), category: "biomedical".into(), needs_api_key: true },
    ProviderInfo { id: "biorxiv".into(), label: "bioRxiv".into(), description: "Preprint server for biology".into(), category: "biomedical".into(), needs_api_key: false },
    ProviderInfo { id: "semantic_scholar".into(), label: "Semantic Scholar".into(), description: "AI-powered research tool by Allen Institute for AI".into(), category: "cs-ml".into(), needs_api_key: true },
    ProviderInfo { id: "openreview".into(), label: "OpenReview".into(), description: "Open peer review platform for ML conferences".into(), category: "cs-ml".into(), needs_api_key: false },
    ProviderInfo { id: "arxiv".into(), label: "arXiv".into(), description: "Open-access preprints in physics, math, CS, and more".into(), category: "cs-ml".into(), needs_api_key: false },
    ProviderInfo { id: "unpaywall".into(), label: "Unpaywall".into(), description: "Free legal full-text articles via open-access links".into(), category: "open-access".into(), needs_api_key: false },
    ProviderInfo { id: "core".into(), label: "CORE".into(), description: "Aggregator of open-access research papers".into(), category: "open-access".into(), needs_api_key: true },
    ProviderInfo { id: "zenodo".into(), label: "Zenodo".into(), description: "Open-access repository hosted by CERN".into(), category: "open-access".into(), needs_api_key: false },
    ProviderInfo { id: "doaj".into(), label: "DOAJ".into(), description: "Directory of Open Access Journals".into(), category: "open-access".into(), needs_api_key: false },
    ProviderInfo { id: "open_library".into(), label: "Open Library".into(), description: "Internet Archive's open book catalog".into(), category: "books".into(), needs_api_key: false },
    ProviderInfo { id: "google_books".into(), label: "Google Books".into(), description: "Google's book search and metadata".into(), category: "books".into(), needs_api_key: true },
    ProviderInfo { id: "hathitrust".into(), label: "HathiTrust".into(), description: "Digital library of research institution holdings".into(), category: "books".into(), needs_api_key: false },
]);

/// Derived from `PROVIDER_INFO` — always in sync, single allocation on first use.
static LEGAL_PROVIDER_IDS: LazyLock<Vec<String>> = LazyLock::new(|| {
    PROVIDER_INFO.iter().map(|p| p.id.clone()).collect()
});

/// Returns the full metadata for every legal (non-scraper) search provider.
/// Backed by a `LazyLock` — allocates once, returns a static slice thereafter.
pub fn legal_provider_info() -> &'static [ProviderInfo] {
    &PROVIDER_INFO
}

/// Convenience: just the ID strings, in the same order as `legal_provider_info()`.
pub fn legal_provider_ids() -> &'static [String] {
    &LEGAL_PROVIDER_IDS
}

/// Map a Paper's work_type to a BibTeX entry type.
/// Returns None if work_type is None or not in the mapping table,
/// in which case the caller should fall back to heuristics.
fn infer_entry_type(work_type: Option<&str>) -> Option<&'static str> {
    match work_type? {
        "book" => Some("book"),
        "book-chapter" => Some("incollection"),
        "conference-paper" | "proceedings-article" => Some("inproceedings"),
        "thesis" | "dissertation" => Some("phdthesis"),
        "dataset" => Some("misc"),
        "journal-article" | "article" => Some("article"),
        "preprint" => Some("article"),
        _ => None,
    }
}

pub fn paper_to_bib_entry(
    paper: &research_hub::Paper,
    existing_keys: &HashSet<String>,
) -> BibEntry {
    let authors: Vec<String> = paper.authors.clone();

    let title = strip_jats(&paper.title);

    let year = paper
        .year
        .map(|y| y.to_string())
        .unwrap_or_default();

    let journal = paper.journal.clone();
    let volume = paper.volume.clone();
    let pages = paper.pages.clone();
    let number = paper.issue.clone();

    let doi = paper.doi.as_deref().map(normalize_doi);
    let url = paper.url.clone();
    let abstract_text = paper.abstract_text.as_deref().map(strip_jats);

    let entry_type = infer_entry_type(paper.work_type.as_deref())
        .map(String::from)
        .unwrap_or_else(|| {
            if journal.is_some() {
                "article".to_string()
            } else {
                "misc".to_string()
            }
        });

    let tags = if paper.source.is_empty() {
        vec![]
    } else {
        vec![format!("source:{}", paper.source)]
    };

    let key = generate_key(&authors, &year, existing_keys);

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
        file: None,
        volume,
        number,
        pages,
        publisher: paper.publisher.clone(),
        issn: paper.issn.clone(),
        isbn: paper.isbn.clone(),
        arxiv_id: paper.arxiv_id.clone(),
        oclc: paper.oclc.clone(),
        work_type: paper.work_type.clone(),
        series: paper.series.clone(),
        lccn: paper.lccn.clone(),
        editors: paper.editors.clone(),
        tags,
    }
}

pub fn paper_to_bib_entry_with_pdf(
    paper: &research_hub::Paper,
    existing_keys: &HashSet<String>,
) -> (BibEntry, Option<String>) {
    let entry = paper_to_bib_entry(paper, existing_keys);
    let pdf_url = paper.pdf_url.clone();
    (entry, pdf_url)
}

pub fn build_config(
    prefs: &crate::preferences::Preferences,
    cred_store: &dyn crate::commands::credential::CredentialStore,
) -> research_hub::Config {
    let crossref_email = prefs
        .extra
        .get("search.crossrefEmail")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(String::from);

    let unpaywall_email = prefs
        .extra
        .get("search.unpaywallEmail")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .unwrap_or("lit@lit.solar")
        .to_string();

    let provider_timeout = prefs
        .extra
        .get("search.providerTimeout")
        .and_then(|v| v.as_f64())
        .filter(|&t| t > 0.0 && t <= 3600.0)
        .map(Duration::from_secs_f64)
        .unwrap_or(Duration::from_secs(30));

    let semantic_scholar_api_key = cred_store
        .get("com.lit.app", "semantic-scholar-api-key")
        .ok();
    let core_api_key = cred_store
        .get("com.lit.app", "core-api-key")
        .ok();
    let pubmed_api_key = cred_store
        .get("com.lit.app", "pubmed-api-key")
        .ok();
    let google_books_api_key = cred_store
        .get("com.lit.app", "google-books-api-key")
        .ok();
    let base_api_key = cred_store
        .get("com.lit.app", "base-api-key")
        .ok();

    research_hub::Config {
        download_dir: PathBuf::from("."),
        crossref_email,
        semantic_scholar_api_key,
        unpaywall_email,
        core_api_key,
        pubmed_api_key,
        google_books_api_key,
        base_api_key,
        provider_timeout,
        max_parallel_providers: 5,
    }
}

pub fn create_enabled_providers(
    client: reqwest::Client,
    config: Arc<research_hub::Config>,
    enabled: &HashSet<String>,
) -> Vec<Arc<dyn research_hub::Provider>> {
    let all = research_hub::create_all_providers(client, config);
    all.into_iter()
        .filter(|p| LEGAL_PROVIDER_IDS.iter().any(|id| id == p.name()))
        .filter(|p| enabled.contains(p.name()))
        .collect()
}

/// Build a config and provider list from an `AppHandle`.
///
/// Reads user preferences and credential store to construct a
/// `research_hub::Config` and the set of enabled providers.  Shared by
/// `search_papers` and `enrich_entry` so the wiring logic lives in one
/// place.
pub fn providers_from_app_handle(
    app_handle: &tauri::AppHandle,
    client: reqwest::Client,
) -> (Arc<research_hub::Config>, Vec<Arc<dyn research_hub::Provider>>) {
    use tauri::Manager;

    let prefs = crate::preferences::read_preferences(app_handle);
    let cred_store = app_handle.state::<Arc<dyn crate::commands::credential::CredentialStore>>();
    let config = build_config(&prefs, cred_store.as_ref());

    let enabled: HashSet<String> = prefs
        .extra
        .get("search.enabledProviders")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str())
                .map(String::from)
                .collect()
        })
        .unwrap_or_else(|| {
            legal_provider_ids()
                .iter()
                .map(|s| s.to_string())
                .collect()
        });

    let config = Arc::new(config);
    let providers = create_enabled_providers(client, config.clone(), &enabled);
    (config, providers)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    fn full_paper() -> research_hub::Paper {
        research_hub::Paper {
            title: "Attention Is All You Need".to_string(),
            authors: vec![
                "Vaswani, Ashish".to_string(),
                "Shazeer, Noam".to_string(),
            ],
            abstract_text: Some("<jats:p>We propose a new architecture</jats:p>".to_string()),
            doi: Some("https://doi.org/10.5555/3295222.3295349".to_string()),
            year: Some(2017),
            published_date: Some("2017-06-12".to_string()),
            source: "semantic-scholar".to_string(),
            url: Some("https://arxiv.org/abs/1706.03762".to_string()),
            pdf_url: Some("https://arxiv.org/pdf/1706.03762".to_string()),
            journal: Some("Advances in Neural Information Processing Systems".to_string()),
            volume: Some("30".to_string()),
            issue: Some("1".to_string()),
            pages: Some("5998-6008".to_string()),
            citation_count: Some(100000),
            publisher: Some("Curran Associates, Inc.".to_string()),
            isbn: None,
            issn: Some("1049-5258".to_string()),
            arxiv_id: Some("1706.03762".to_string()),
            work_type: Some("conference-paper".to_string()),
            editors: vec![],
            series: None,
            oclc: None,
            lccn: None,
        }
    }

    fn minimal_paper() -> research_hub::Paper {
        research_hub::Paper {
            title: "Untitled".to_string(),
            authors: vec![],
            abstract_text: None,
            doi: None,
            year: None,
            published_date: None,
            source: String::new(),
            url: None,
            pdf_url: None,
            journal: None,
            volume: None,
            issue: None,
            pages: None,
            citation_count: None,
            publisher: None,
            isbn: None,
            issn: None,
            arxiv_id: None,
            work_type: None,
            editors: vec![],
            series: None,
            oclc: None,
            lccn: None,
        }
    }

    fn book_paper() -> research_hub::Paper {
        research_hub::Paper {
            title: "Deep Learning".to_string(),
            authors: vec![
                "Goodfellow, Ian".to_string(),
                "Bengio, Yoshua".to_string(),
                "Courville, Aaron".to_string(),
            ],
            abstract_text: Some("An introduction to deep learning".to_string()),
            year: Some(2016),
            published_date: Some("2016-11-18".to_string()),
            source: "google_books".to_string(),
            publisher: Some("MIT Press".to_string()),
            isbn: Some("978-0-262-03561-3".to_string()),
            work_type: Some("book".to_string()),
            editors: vec!["Editor, A".to_string()],
            series: Some("Adaptive Computation and Machine Learning".to_string()),
            lccn: Some("2016022992".to_string()),
            ..Default::default()
        }
    }

    // ── Test 1: Full mapping (all fields populated) ──────────────────

    #[test]
    fn full_paper_all_fields_mapped() {
        let paper = full_paper();
        let entry = paper_to_bib_entry(&paper, &HashSet::new());

        assert_eq!(entry.key, "vaswani2017");
        assert_eq!(entry.authors, vec!["Vaswani, Ashish", "Shazeer, Noam"]);
        assert_eq!(entry.title, "Attention Is All You Need");
        assert_eq!(entry.year, "2017");
        assert_eq!(entry.entry_type, "inproceedings");
        assert_eq!(entry.journal, Some("Advances in Neural Information Processing Systems".to_string()));
        assert_eq!(entry.doi, Some("10.5555/3295222.3295349".to_string()));
        assert_eq!(entry.url, Some("https://arxiv.org/abs/1706.03762".to_string()));
        assert_eq!(entry.abstract_text, Some("We propose a new architecture".to_string()));
        assert_eq!(entry.volume, Some("30".to_string()));
        assert_eq!(entry.number, Some("1".to_string()));
        assert_eq!(entry.pages, Some("5998-6008".to_string()));
        assert_eq!(entry.tags, vec!["source:semantic-scholar"]);
        assert_eq!(entry.line_number, 0);
        assert_eq!(entry.bib_file, None);
        assert_eq!(entry.file, None);
        assert_eq!(entry.publisher, Some("Curran Associates, Inc.".to_string()));
        assert_eq!(entry.issn, Some("1049-5258".to_string()));
        assert_eq!(entry.isbn, None);
        assert_eq!(entry.arxiv_id, Some("1706.03762".to_string()));
    }

    // ── Test 2: Minimal paper ────────────────────────────────────────

    #[test]
    fn minimal_paper_defaults() {
        let paper = minimal_paper();
        let entry = paper_to_bib_entry(&paper, &HashSet::new());

        assert_eq!(entry.title, "Untitled");
        assert!(entry.authors.is_empty());
        assert_eq!(entry.year, "");
        assert_eq!(entry.entry_type, "misc"); // no journal -> misc
        assert_eq!(entry.doi, None);
        assert_eq!(entry.journal, None);
        assert_eq!(entry.url, None);
        assert_eq!(entry.abstract_text, None);
        assert_eq!(entry.volume, None);
        assert_eq!(entry.number, None);
        assert_eq!(entry.pages, None);
        assert!(entry.tags.is_empty()); // empty source -> no tags
        assert_eq!(entry.key, "unknown"); // no authors, no year
    }

    // ── Test 3: Year conversion (Option<i32> to String) ──────────────

    #[test]
    fn year_some_converted_to_string() {
        let mut paper = minimal_paper();
        paper.year = Some(2023);
        let entry = paper_to_bib_entry(&paper, &HashSet::new());
        assert_eq!(entry.year, "2023");
    }

    #[test]
    fn year_none_becomes_empty_string() {
        let paper = minimal_paper();
        let entry = paper_to_bib_entry(&paper, &HashSet::new());
        assert_eq!(entry.year, "");
    }

    #[test]
    fn year_negative_converted_to_string() {
        let mut paper = minimal_paper();
        paper.year = Some(-500);
        let entry = paper_to_bib_entry(&paper, &HashSet::new());
        assert_eq!(entry.year, "-500");
    }

    // ── Test 4: DOI normalization ────────────────────────────────────

    #[test]
    fn doi_https_prefix_stripped() {
        let mut paper = minimal_paper();
        paper.doi = Some("https://doi.org/10.1038/nature12373".to_string());
        let entry = paper_to_bib_entry(&paper, &HashSet::new());
        assert_eq!(entry.doi, Some("10.1038/nature12373".to_string()));
    }

    #[test]
    fn doi_bare_preserved() {
        let mut paper = minimal_paper();
        paper.doi = Some("10.1038/nature12373".to_string());
        let entry = paper_to_bib_entry(&paper, &HashSet::new());
        assert_eq!(entry.doi, Some("10.1038/nature12373".to_string()));
    }

    #[test]
    fn doi_none_stays_none() {
        let paper = minimal_paper();
        let entry = paper_to_bib_entry(&paper, &HashSet::new());
        assert_eq!(entry.doi, None);
    }

    // ── Test 5: issue -> number mapping ──────────────────────────────

    #[test]
    fn issue_maps_to_number() {
        let mut paper = minimal_paper();
        paper.issue = Some("42".to_string());
        let entry = paper_to_bib_entry(&paper, &HashSet::new());
        assert_eq!(entry.number, Some("42".to_string()));
    }

    #[test]
    fn issue_none_maps_to_number_none() {
        let paper = minimal_paper();
        let entry = paper_to_bib_entry(&paper, &HashSet::new());
        assert_eq!(entry.number, None);
    }

    // ── Test 6: Key collision handling ────────────────────────────────

    #[test]
    fn key_collision_appends_suffix() {
        let mut paper = minimal_paper();
        paper.authors = vec!["Smith, John".to_string()];
        paper.year = Some(2024);

        let mut existing = HashSet::new();
        existing.insert("smith2024".to_string());

        let entry = paper_to_bib_entry(&paper, &existing);
        assert_eq!(entry.key, "smith2024a");
    }

    #[test]
    fn key_double_collision_appends_b() {
        let mut paper = minimal_paper();
        paper.authors = vec!["Smith, John".to_string()];
        paper.year = Some(2024);

        let mut existing = HashSet::new();
        existing.insert("smith2024".to_string());
        existing.insert("smith2024a".to_string());

        let entry = paper_to_bib_entry(&paper, &existing);
        assert_eq!(entry.key, "smith2024b");
    }

    // ── Test 7: source -> tags mapping ───────────────────────────────

    #[test]
    fn source_nonempty_becomes_tag() {
        let mut paper = minimal_paper();
        paper.source = "crossref".to_string();
        let entry = paper_to_bib_entry(&paper, &HashSet::new());
        assert_eq!(entry.tags, vec!["source:crossref"]);
    }

    #[test]
    fn source_empty_no_tags() {
        let paper = minimal_paper();
        let entry = paper_to_bib_entry(&paper, &HashSet::new());
        assert!(entry.tags.is_empty());
    }

    #[test]
    fn source_with_hyphens_preserved() {
        let mut paper = minimal_paper();
        paper.source = "semantic-scholar".to_string();
        let entry = paper_to_bib_entry(&paper, &HashSet::new());
        assert_eq!(entry.tags, vec!["source:semantic-scholar"]);
    }

    // ── Test 8: entry_type inference ─────────────────────────────────

    #[test]
    fn entry_type_article_when_journal_present() {
        let mut paper = minimal_paper();
        paper.journal = Some("Nature".to_string());
        let entry = paper_to_bib_entry(&paper, &HashSet::new());
        assert_eq!(entry.entry_type, "article");
    }

    #[test]
    fn entry_type_misc_when_journal_absent() {
        let paper = minimal_paper();
        let entry = paper_to_bib_entry(&paper, &HashSet::new());
        assert_eq!(entry.entry_type, "misc");
    }

    // ── Test 9: pdf_url extraction in _with_pdf variant ──────────────

    #[test]
    fn with_pdf_returns_pdf_url() {
        let paper = full_paper();
        let (entry, pdf_url) = paper_to_bib_entry_with_pdf(&paper, &HashSet::new());
        assert_eq!(pdf_url, Some("https://arxiv.org/pdf/1706.03762".to_string()));
        // entry should be identical to paper_to_bib_entry result
        assert_eq!(entry.key, "vaswani2017");
    }

    #[test]
    fn with_pdf_returns_none_when_no_pdf() {
        let paper = minimal_paper();
        let (_entry, pdf_url) = paper_to_bib_entry_with_pdf(&paper, &HashSet::new());
        assert_eq!(pdf_url, None);
    }

    #[test]
    fn with_pdf_entry_matches_plain_conversion() {
        let paper = full_paper();
        let plain_entry = paper_to_bib_entry(&paper, &HashSet::new());
        let (pdf_entry, _) = paper_to_bib_entry_with_pdf(&paper, &HashSet::new());
        assert_eq!(plain_entry, pdf_entry);
    }

    // ── Test 10: JATS stripping ──────────────────────────────────────

    #[test]
    fn title_jats_tags_stripped() {
        let mut paper = minimal_paper();
        paper.title = "<jats:p>Tagged Title</jats:p>".to_string();
        let entry = paper_to_bib_entry(&paper, &HashSet::new());
        assert_eq!(entry.title, "Tagged Title");
    }

    #[test]
    fn abstract_jats_tags_stripped() {
        let mut paper = minimal_paper();
        paper.abstract_text = Some("<jats:p>Summary <jats:italic>text</jats:italic></jats:p>".to_string());
        let entry = paper_to_bib_entry(&paper, &HashSet::new());
        assert_eq!(entry.abstract_text, Some("Summary text".to_string()));
    }

    // ── build_config tests ──────────────────────────────────────────

    use crate::commands::credential::{CredentialStore, InMemoryStore};
    use crate::preferences::Preferences;
    use std::path::PathBuf;
    use std::time::Duration;

    #[test]
    fn build_config_defaults_with_empty_prefs() {
        let prefs = Preferences::default();
        let store = InMemoryStore::new();
        let config = super::build_config(&prefs, &store);

        assert_eq!(config.crossref_email, None);
        assert_eq!(config.unpaywall_email, "lit@lit.solar");
        assert_eq!(config.provider_timeout, Duration::from_secs(30));
        assert_eq!(config.semantic_scholar_api_key, None);
        assert_eq!(config.core_api_key, None);
        assert_eq!(config.pubmed_api_key, None);
        assert_eq!(config.google_books_api_key, None);
        assert_eq!(config.base_api_key, None);
        assert_eq!(config.download_dir, PathBuf::from("."));
        assert_eq!(config.max_parallel_providers, 5);
    }

    #[test]
    fn build_config_reads_emails_from_prefs() {
        let mut prefs = Preferences::default();
        prefs.extra.insert(
            "search.crossrefEmail".to_string(),
            serde_json::json!("me@uni.edu"),
        );
        prefs.extra.insert(
            "search.unpaywallEmail".to_string(),
            serde_json::json!("me@uni.edu"),
        );
        let store = InMemoryStore::new();
        let config = super::build_config(&prefs, &store);

        assert_eq!(config.crossref_email, Some("me@uni.edu".to_string()));
        assert_eq!(config.unpaywall_email, "me@uni.edu");
    }

    #[test]
    fn build_config_reads_api_keys_from_credential_store() {
        let prefs = Preferences::default();
        let store = InMemoryStore::new();
        store
            .set("com.lit.app", "semantic-scholar-api-key", "ss-key-123")
            .unwrap();
        store
            .set("com.lit.app", "core-api-key", "core-key-456")
            .unwrap();
        store
            .set("com.lit.app", "pubmed-api-key", "pm-key-789")
            .unwrap();
        let config = super::build_config(&prefs, &store);

        assert_eq!(
            config.semantic_scholar_api_key,
            Some("ss-key-123".to_string())
        );
        assert_eq!(config.core_api_key, Some("core-key-456".to_string()));
        assert_eq!(config.pubmed_api_key, Some("pm-key-789".to_string()));
    }

    #[test]
    fn build_config_missing_api_keys_are_none() {
        let prefs = Preferences::default();
        let store = InMemoryStore::new();
        store
            .set("com.lit.app", "semantic-scholar-api-key", "ss-key-123")
            .unwrap();
        let config = super::build_config(&prefs, &store);

        assert_eq!(
            config.semantic_scholar_api_key,
            Some("ss-key-123".to_string())
        );
        assert_eq!(config.core_api_key, None);
        assert_eq!(config.pubmed_api_key, None);
    }

    #[test]
    fn build_config_timeout_from_prefs() {
        let mut prefs = Preferences::default();
        prefs.extra.insert(
            "search.providerTimeout".to_string(),
            serde_json::json!(15),
        );
        let store = InMemoryStore::new();
        let config = super::build_config(&prefs, &store);
        assert_eq!(config.provider_timeout, Duration::from_secs(15));

        // Also test with a float value
        let mut prefs2 = Preferences::default();
        prefs2.extra.insert(
            "search.providerTimeout".to_string(),
            serde_json::json!(15.5),
        );
        let config2 = super::build_config(&prefs2, &store);
        assert_eq!(config2.provider_timeout, Duration::from_secs_f64(15.5));
    }

    #[test]
    fn build_config_invalid_timeout_uses_default() {
        let store = InMemoryStore::new();

        // Negative timeout
        let mut prefs = Preferences::default();
        prefs.extra.insert(
            "search.providerTimeout".to_string(),
            serde_json::json!(-5),
        );
        let config = super::build_config(&prefs, &store);
        assert_eq!(config.provider_timeout, Duration::from_secs(30));

        // Zero timeout
        let mut prefs2 = Preferences::default();
        prefs2.extra.insert(
            "search.providerTimeout".to_string(),
            serde_json::json!(0),
        );
        let config2 = super::build_config(&prefs2, &store);
        assert_eq!(config2.provider_timeout, Duration::from_secs(30));

        // String timeout (wrong type)
        let mut prefs3 = Preferences::default();
        prefs3.extra.insert(
            "search.providerTimeout".to_string(),
            serde_json::json!("thirty"),
        );
        let config3 = super::build_config(&prefs3, &store);
        assert_eq!(config3.provider_timeout, Duration::from_secs(30));

        // Huge timeout (would overflow Duration)
        let mut prefs4 = Preferences::default();
        prefs4.extra.insert(
            "search.providerTimeout".to_string(),
            serde_json::json!(1e308),
        );
        let config4 = super::build_config(&prefs4, &store);
        assert_eq!(config4.provider_timeout, Duration::from_secs(30));
    }

    #[test]
    fn build_config_empty_crossref_email_becomes_none() {
        let mut prefs = Preferences::default();
        prefs.extra.insert(
            "search.crossrefEmail".to_string(),
            serde_json::json!(""),
        );
        let store = InMemoryStore::new();
        let config = super::build_config(&prefs, &store);
        assert_eq!(config.crossref_email, None);
    }

    // ── create_enabled_providers tests ─────────────────────────────────

    fn test_config() -> Arc<research_hub::Config> {
        Arc::new(research_hub::Config {
            download_dir: PathBuf::from("/tmp"),
            crossref_email: None,
            semantic_scholar_api_key: None,
            unpaywall_email: "test@test.com".to_string(),
            core_api_key: None,
            pubmed_api_key: None,
            google_books_api_key: None,
            base_api_key: None,
            provider_timeout: Duration::from_secs(30),
            max_parallel_providers: 5,
        })
    }

    #[test]
    fn enabled_providers_excludes_scrapers() {
        let client = reqwest::Client::new();
        let config = test_config();
        // Enable everything — scrapers should still be excluded
        let enabled: HashSet<String> = [
            "openalex", "crossref", "base", "pubmed", "semantic_scholar",
            "unpaywall", "core", "openreview", "arxiv", "biorxiv",
            "zenodo", "doaj", "open_library", "google_books", "hathitrust",
            "ssrn", "mdpi", "researchgate", "sci_hub",
        ]
        .iter()
        .map(|s| s.to_string())
        .collect();
        let providers = super::create_enabled_providers(client, config, &enabled);
        let names: Vec<&str> = providers.iter().map(|p| p.name()).collect();
        assert_eq!(providers.len(), 15);
        assert!(!names.contains(&"ssrn"));
        assert!(!names.contains(&"mdpi"));
        assert!(!names.contains(&"researchgate"));
        assert!(!names.contains(&"sci_hub"));
    }

    #[test]
    fn enabled_providers_respects_user_disabled() {
        let client = reqwest::Client::new();
        let config = test_config();
        // Only enable two providers
        let enabled: HashSet<String> = ["crossref", "arxiv"]
            .iter()
            .map(|s| s.to_string())
            .collect();
        let providers = super::create_enabled_providers(client, config, &enabled);
        let names: Vec<&str> = providers.iter().map(|p| p.name()).collect();
        assert_eq!(providers.len(), 2);
        assert!(names.contains(&"crossref"));
        assert!(names.contains(&"arxiv"));
    }

    #[test]
    fn enabled_providers_empty_set_returns_nothing() {
        let client = reqwest::Client::new();
        let config = test_config();
        let enabled = HashSet::new();
        let providers = super::create_enabled_providers(client, config, &enabled);
        assert!(providers.is_empty());
    }

    #[test]
    fn enabled_providers_all_legal_returns_fifteen() {
        let client = reqwest::Client::new();
        let config = test_config();
        let enabled: HashSet<String> = [
            "openalex", "crossref", "base", "pubmed", "semantic_scholar",
            "unpaywall", "core", "openreview", "arxiv", "biorxiv",
            "zenodo", "doaj", "open_library", "google_books", "hathitrust",
        ]
        .iter()
        .map(|s| s.to_string())
        .collect();
        let providers = super::create_enabled_providers(client, config, &enabled);
        assert_eq!(providers.len(), 15);
    }

    #[test]
    fn enabled_providers_preserves_priority_order() {
        let client = reqwest::Client::new();
        let config = test_config();
        let enabled: HashSet<String> = [
            "openalex", "crossref", "base", "pubmed", "semantic_scholar",
            "unpaywall", "core", "openreview", "arxiv", "biorxiv",
            "zenodo", "doaj", "open_library", "google_books", "hathitrust",
        ]
        .iter()
        .map(|s| s.to_string())
        .collect();
        let providers = super::create_enabled_providers(client, config, &enabled);
        for i in 1..providers.len() {
            assert!(
                providers[i - 1].priority() >= providers[i].priority(),
                "{} (pri {}) should come before {} (pri {})",
                providers[i - 1].name(),
                providers[i - 1].priority(),
                providers[i].name(),
                providers[i].priority(),
            );
        }
    }

    #[test]
    fn enabled_providers_scraper_only_returns_nothing() {
        let client = reqwest::Client::new();
        let config = test_config();
        // Enable only scrapers — all should be filtered out
        let enabled: HashSet<String> = ["ssrn", "mdpi", "researchgate", "sci_hub"]
            .iter()
            .map(|s| s.to_string())
            .collect();
        let providers = super::create_enabled_providers(client, config, &enabled);
        assert!(providers.is_empty());
    }

    // ── ProviderInfo tests ────────────────────────────────────────

    #[test]
    fn provider_info_has_correct_count_and_unique_ids() {
        let info = super::legal_provider_info();
        assert_eq!(info.len(), 15);
        let ids: HashSet<_> = info.iter().map(|p| p.id.as_str()).collect();
        assert_eq!(ids.len(), 15); // no duplicates
    }

    #[test]
    fn provider_info_categories_are_valid() {
        let valid = ["general", "biomedical", "cs-ml", "open-access", "books"];
        for p in super::legal_provider_info() {
            assert!(valid.contains(&p.category.as_str()), "bad category: {}", p.category);
        }
    }

    #[test]
    fn legal_provider_ids_derived_from_provider_info() {
        let info_ids: Vec<&str> = super::PROVIDER_INFO.iter().map(|p| p.id.as_str()).collect();
        let derived: Vec<&str> = super::legal_provider_ids().iter().map(|s| s.as_str()).collect();
        assert_eq!(info_ids, derived, "legal_provider_ids must match PROVIDER_INFO entries in order");
    }

    #[test]
    fn provider_info_serializes_to_json() {
        let info = super::legal_provider_info();
        let json = serde_json::to_string(&info).expect("should serialize");
        assert!(json.contains("openalex"));
        assert!(json.contains("needs_api_key"));
    }

    // ── LazyLock / static tests ──────────────────────────────────────

    #[test]
    fn provider_info_returns_static_slice() {
        // Calling twice should return the same pointer (same static data)
        let a = super::legal_provider_info();
        let b = super::legal_provider_info();
        assert!(std::ptr::eq(a, b), "legal_provider_info should return the same static slice");
    }

    #[test]
    fn legal_provider_ids_is_static_string_slice() {
        let ids: &[String] = super::legal_provider_ids();
        assert_eq!(ids.len(), 15);
        assert_eq!(ids[0], "openalex");
        assert_eq!(ids[14], "hathitrust");
    }

    #[test]
    fn legal_provider_ids_contains_all_expected() {
        let ids: Vec<&str> = super::legal_provider_ids().iter().map(|s| s.as_str()).collect();
        let expected = [
            "openalex", "crossref", "base", "pubmed", "semantic_scholar",
            "unpaywall", "core", "openreview", "arxiv", "biorxiv",
            "zenodo", "doaj", "open_library", "google_books", "hathitrust",
        ];
        for e in &expected {
            assert!(ids.contains(e), "missing provider id: {}", e);
        }
    }

    // ── entry_type from work_type mapping ───────────────────────────

    #[test]
    fn entry_type_book_from_work_type() {
        let mut paper = minimal_paper();
        paper.work_type = Some("book".to_string());
        let entry = paper_to_bib_entry(&paper, &HashSet::new());
        assert_eq!(entry.entry_type, "book");
    }

    #[test]
    fn entry_type_incollection_from_book_chapter() {
        let mut paper = minimal_paper();
        paper.work_type = Some("book-chapter".to_string());
        let entry = paper_to_bib_entry(&paper, &HashSet::new());
        assert_eq!(entry.entry_type, "incollection");
    }

    #[test]
    fn entry_type_inproceedings_from_conference_paper() {
        let mut paper = minimal_paper();
        paper.work_type = Some("conference-paper".to_string());
        let entry = paper_to_bib_entry(&paper, &HashSet::new());
        assert_eq!(entry.entry_type, "inproceedings");
    }

    #[test]
    fn entry_type_inproceedings_from_proceedings_article() {
        let mut paper = minimal_paper();
        paper.work_type = Some("proceedings-article".to_string());
        let entry = paper_to_bib_entry(&paper, &HashSet::new());
        assert_eq!(entry.entry_type, "inproceedings");
    }

    #[test]
    fn entry_type_phdthesis_from_thesis() {
        let mut paper = minimal_paper();
        paper.work_type = Some("thesis".to_string());
        let entry = paper_to_bib_entry(&paper, &HashSet::new());
        assert_eq!(entry.entry_type, "phdthesis");
    }

    #[test]
    fn entry_type_misc_from_dataset() {
        let mut paper = minimal_paper();
        paper.work_type = Some("dataset".to_string());
        let entry = paper_to_bib_entry(&paper, &HashSet::new());
        assert_eq!(entry.entry_type, "misc");
    }

    #[test]
    fn entry_type_article_from_journal_article() {
        let mut paper = minimal_paper();
        paper.work_type = Some("journal-article".to_string());
        let entry = paper_to_bib_entry(&paper, &HashSet::new());
        assert_eq!(entry.entry_type, "article");
    }

    #[test]
    fn entry_type_article_from_preprint() {
        let mut paper = minimal_paper();
        paper.work_type = Some("preprint".to_string());
        let entry = paper_to_bib_entry(&paper, &HashSet::new());
        assert_eq!(entry.entry_type, "article");
    }

    #[test]
    fn entry_type_falls_back_to_journal_heuristic_for_unknown_work_type() {
        let mut paper = minimal_paper();
        paper.work_type = Some("unknown-type".to_string());
        paper.journal = Some("Nature".to_string());
        let entry = paper_to_bib_entry(&paper, &HashSet::new());
        assert_eq!(entry.entry_type, "article");
    }

    #[test]
    fn entry_type_falls_back_to_misc_for_unknown_work_type_no_journal() {
        let mut paper = minimal_paper();
        paper.work_type = Some("unknown-type".to_string());
        let entry = paper_to_bib_entry(&paper, &HashSet::new());
        assert_eq!(entry.entry_type, "misc");
    }

    #[test]
    fn entry_type_falls_back_when_work_type_none() {
        let mut paper = minimal_paper();
        paper.journal = Some("Science".to_string());
        let entry = paper_to_bib_entry(&paper, &HashSet::new());
        assert_eq!(entry.entry_type, "article");
    }

    // ── publisher/isbn/issn/arxiv_id passthrough ────────────────────

    #[test]
    fn publisher_passed_through() {
        let mut paper = minimal_paper();
        paper.publisher = Some("Springer".to_string());
        let entry = paper_to_bib_entry(&paper, &HashSet::new());
        assert_eq!(entry.publisher, Some("Springer".to_string()));
    }

    #[test]
    fn publisher_none_stays_none() {
        let paper = minimal_paper();
        let entry = paper_to_bib_entry(&paper, &HashSet::new());
        assert_eq!(entry.publisher, None);
    }

    #[test]
    fn isbn_passed_through() {
        let mut paper = minimal_paper();
        paper.isbn = Some("978-3-030-12345-6".to_string());
        let entry = paper_to_bib_entry(&paper, &HashSet::new());
        assert_eq!(entry.isbn, Some("978-3-030-12345-6".to_string()));
    }

    #[test]
    fn isbn_none_stays_none() {
        let paper = minimal_paper();
        let entry = paper_to_bib_entry(&paper, &HashSet::new());
        assert_eq!(entry.isbn, None);
    }

    #[test]
    fn issn_passed_through() {
        let mut paper = minimal_paper();
        paper.issn = Some("1234-5678".to_string());
        let entry = paper_to_bib_entry(&paper, &HashSet::new());
        assert_eq!(entry.issn, Some("1234-5678".to_string()));
    }

    #[test]
    fn issn_none_stays_none() {
        let paper = minimal_paper();
        let entry = paper_to_bib_entry(&paper, &HashSet::new());
        assert_eq!(entry.issn, None);
    }

    #[test]
    fn arxiv_id_passed_through() {
        let mut paper = minimal_paper();
        paper.arxiv_id = Some("2301.00001".to_string());
        let entry = paper_to_bib_entry(&paper, &HashSet::new());
        assert_eq!(entry.arxiv_id, Some("2301.00001".to_string()));
    }

    #[test]
    fn arxiv_id_none_stays_none() {
        let paper = minimal_paper();
        let entry = paper_to_bib_entry(&paper, &HashSet::new());
        assert_eq!(entry.arxiv_id, None);
    }

    // ── Book paper mapping ─────────────────────────────────────────

    #[test]
    fn book_paper_maps_correctly() {
        let paper = book_paper();
        let entry = paper_to_bib_entry(&paper, &HashSet::new());

        assert_eq!(entry.entry_type, "book");
        assert_eq!(entry.title, "Deep Learning");
        assert_eq!(entry.year, "2016");
        assert_eq!(entry.authors, vec!["Goodfellow, Ian", "Bengio, Yoshua", "Courville, Aaron"]);
        assert_eq!(entry.publisher, Some("MIT Press".to_string()));
        assert_eq!(entry.isbn, Some("978-0-262-03561-3".to_string()));
        assert_eq!(entry.series, Some("Adaptive Computation and Machine Learning".to_string()));
        assert_eq!(entry.editors, vec!["Editor, A".to_string()]);
        assert_eq!(entry.lccn, Some("2016022992".to_string()));
        assert_eq!(entry.journal, None);
        assert_eq!(entry.tags, vec!["source:google_books"]);
    }
}
