use crate::bib::convert::{normalize_doi, strip_jats};
use crate::bib::types::BibEntry;
use crate::bib::writer::generate_key;
use std::collections::HashSet;
use std::path::PathBuf;
use std::time::Duration;

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

    let entry_type = if journal.is_some() {
        "article".to_string()
    } else {
        "misc".to_string()
    };

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
        publisher: None,
        issn: None,
        isbn: None,
        arxiv_id: None,
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
        .map(String::from);

    let unpaywall_email = prefs
        .extra
        .get("search.unpaywallEmail")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .unwrap_or("user@example.com")
        .to_string();

    let provider_timeout = prefs
        .extra
        .get("search.providerTimeout")
        .and_then(|v| v.as_f64())
        .filter(|&t| t > 0.0)
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

    research_hub::Config {
        download_dir: PathBuf::from("."),
        crossref_email,
        semantic_scholar_api_key,
        unpaywall_email,
        core_api_key,
        pubmed_api_key,
        provider_timeout,
        max_parallel_providers: 5,
    }
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
        assert_eq!(entry.entry_type, "article");
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
        assert_eq!(entry.publisher, None);
        assert_eq!(entry.issn, None);
        assert_eq!(entry.isbn, None);
        assert_eq!(entry.arxiv_id, None);
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
        assert_eq!(config.unpaywall_email, "user@example.com");
        assert_eq!(config.provider_timeout, Duration::from_secs(30));
        assert_eq!(config.semantic_scholar_api_key, None);
        assert_eq!(config.core_api_key, None);
        assert_eq!(config.pubmed_api_key, None);
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
    }
}
