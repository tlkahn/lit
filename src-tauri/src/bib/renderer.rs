use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use crate::bib::types::BibEntry;

pub fn render_bib_citation(entry: &BibEntry) -> String {
    let last_name = extract_last_name(&entry.authors);
    match last_name {
        None => entry.key.clone(),
        Some(name) if entry.year.is_empty() => format!("{name} n.d."),
        Some(name) => format!("{name} {}", entry.year),
    }
}

pub fn render_bib_citations(entries: &[BibEntry]) -> HashMap<String, String> {
    let mut result = HashMap::new();

    let mut groups: HashMap<String, Vec<&BibEntry>> = HashMap::new();
    for e in entries {
        let base = render_bib_citation(e);
        groups.entry(base).or_default().push(e);
    }

    for (base, mut group) in groups {
        if group.len() == 1 {
            result.insert(group[0].key.clone(), base);
        } else {
            group.sort_by(|a, b| a.key.cmp(&b.key));
            for (i, e) in group.iter().enumerate() {
                let suffix = (b'a' + i as u8) as char;
                result.insert(e.key.clone(), format!("{base}{suffix}"));
            }
        }
    }

    result
}

pub fn render_bib_citation_year_only(entry: &BibEntry) -> String {
    if entry.year.is_empty() {
        "n.d.".to_string()
    } else {
        entry.year.clone()
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CiteprocKeyPart {
    pub key: String,
    pub suppress: bool,
    pub locator: String,
}

pub fn parse_citeproc_keys(inner: &str) -> Vec<CiteprocKeyPart> {
    inner
        .split(';')
        .map(|k| {
            let k = k.trim();
            let suppress = k.starts_with('-');
            let stripped = k.trim_start_matches('-').trim_start_matches('@');
            let (key, locator) = match stripped.find(',') {
                Some(idx) => (
                    stripped[..idx].trim().to_string(),
                    stripped[idx + 1..].trim().to_string(),
                ),
                None => (stripped.trim().to_string(), String::new()),
            };
            CiteprocKeyPart { key, suppress, locator }
        })
        .collect()
}

fn extract_last_name(authors: &[String]) -> Option<String> {
    if authors.is_empty() {
        return None;
    }
    let first = get_last_name(&authors[0]);
    match authors.len() {
        1 => Some(first),
        2 => Some(format!("{first} & {}", get_last_name(&authors[1]))),
        _ => Some(format!("{first} et al.")),
    }
}

fn strip_braces(s: &str) -> String {
    s.chars().filter(|&c| c != '{' && c != '}').collect()
}

fn get_last_name(author: &str) -> String {
    let trimmed = author.trim();
    if trimmed.starts_with('{') && trimmed.ends_with('}') {
        return strip_braces(trimmed);
    }
    if trimmed.contains(',') {
        return strip_braces(trimmed.split(',').next().unwrap_or("").trim());
    }
    strip_braces(trimmed.split_whitespace().last().unwrap_or(""))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(key: &str, authors: &[&str], year: &str) -> BibEntry {
        BibEntry {
            key: key.to_string(),
            authors: authors.iter().map(|s| s.to_string()).collect(),
            title: String::new(),
            year: year.to_string(),
            entry_type: "article".to_string(),
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
            publisher: None,
            issn: None,
            isbn: None,
            arxiv_id: None,
            oclc: None,
            work_type: None,
            series: None,
            lccn: None,
            editors: Vec::new(),
            tags: Vec::new(),
        }
    }

    #[test]
    fn single_author_with_year() {
        let e = entry("s2009", &["Sanderson, Alexis"], "2009");
        assert_eq!(render_bib_citation(&e), "Sanderson 2009");
    }

    #[test]
    fn two_authors_with_ampersand() {
        let e = entry("sj2009", &["Sanderson, Alexis", "Jordan, Robert"], "2009");
        assert_eq!(render_bib_citation(&e), "Sanderson & Jordan 2009");
    }

    #[test]
    fn three_plus_authors_et_al() {
        let e = entry("m2021", &["First, A.", "Second, B.", "Third, C."], "2021");
        assert_eq!(render_bib_citation(&e), "First et al. 2021");
    }

    #[test]
    fn first_last_format() {
        let e = entry("s2020", &["John Smith"], "2020");
        assert_eq!(render_bib_citation(&e), "Smith 2020");
    }

    #[test]
    fn last_first_format() {
        let e = entry("s2020", &["Smith, John"], "2020");
        assert_eq!(render_bib_citation(&e), "Smith 2020");
    }

    #[test]
    fn no_author_fallback_to_key() {
        let e = entry("anon2023", &[], "2023");
        assert_eq!(render_bib_citation(&e), "anon2023");
    }

    #[test]
    fn no_year_renders_nd() {
        let e = entry("s", &["Smith, John"], "");
        assert_eq!(render_bib_citation(&e), "Smith n.d.");
    }

    #[test]
    fn no_author_no_year_fallback_to_key() {
        let e = entry("mystery", &[], "");
        assert_eq!(render_bib_citation(&e), "mystery");
    }

    #[test]
    fn year_only_with_year() {
        let e = entry("bush1945", &["Bush, Vannevar"], "1945");
        assert_eq!(render_bib_citation_year_only(&e), "1945");
    }

    #[test]
    fn year_only_empty_year() {
        let e = entry("noyr", &["Smith, John"], "");
        assert_eq!(render_bib_citation_year_only(&e), "n.d.");
    }

    #[test]
    fn year_only_ignores_author() {
        let e = entry("multi", &["A, B", "C, D", "E, F"], "2020");
        assert_eq!(render_bib_citation_year_only(&e), "2020");
    }

    #[test]
    fn parse_single_key() {
        assert_eq!(
            parse_citeproc_keys("@newman2018"),
            vec![CiteprocKeyPart { key: "newman2018".into(), suppress: false, locator: String::new() }]
        );
    }

    #[test]
    fn parse_key_with_chapter_locator() {
        assert_eq!(
            parse_citeproc_keys("@newman2018networks, ch. 11"),
            vec![CiteprocKeyPart { key: "newman2018networks".into(), suppress: false, locator: "ch. 11".into() }]
        );
    }

    #[test]
    fn parse_suppressed_key_with_locator() {
        assert_eq!(
            parse_citeproc_keys("-@bush1945, ch. 5"),
            vec![CiteprocKeyPart { key: "bush1945".into(), suppress: true, locator: "ch. 5".into() }]
        );
    }

    #[test]
    fn parse_batch_mixed_locators() {
        assert_eq!(
            parse_citeproc_keys("@smith2020, ch. 3; @jones2021"),
            vec![
                CiteprocKeyPart { key: "smith2020".into(), suppress: false, locator: "ch. 3".into() },
                CiteprocKeyPart { key: "jones2021".into(), suppress: false, locator: String::new() },
            ]
        );
    }

    #[test]
    fn parse_page_locator() {
        assert_eq!(
            parse_citeproc_keys("@smith2020, pp. 45-50"),
            vec![CiteprocKeyPart { key: "smith2020".into(), suppress: false, locator: "pp. 45-50".into() }]
        );
    }

    #[test]
    fn parse_batch_all_with_locators() {
        assert_eq!(
            parse_citeproc_keys("@smith2020, ch. 3; -@jones2021, pp. 10"),
            vec![
                CiteprocKeyPart { key: "smith2020".into(), suppress: false, locator: "ch. 3".into() },
                CiteprocKeyPart { key: "jones2021".into(), suppress: true, locator: "pp. 10".into() },
            ]
        );
    }

    #[test]
    fn parse_suppressed_without_locator() {
        assert_eq!(
            parse_citeproc_keys("-@bush1945"),
            vec![CiteprocKeyPart { key: "bush1945".into(), suppress: true, locator: String::new() }]
        );
    }

    #[test]
    fn strip_braces_removes_all_braces() {
        assert_eq!(strip_braces("{Google DeepMind}"), "Google DeepMind");
        assert_eq!(strip_braces("no braces"), "no braces");
        assert_eq!(strip_braces("{}"), "");
        assert_eq!(strip_braces("{nested {braces}}"), "nested braces");
    }

    #[test]
    fn corporate_author_braces_stripped() {
        assert_eq!(get_last_name("{Google DeepMind}"), "Google DeepMind");
    }

    #[test]
    fn corporate_author_full_citation() {
        let e = entry("deepmind2024", &["{Google DeepMind}"], "2024");
        assert_eq!(render_bib_citation(&e), "Google DeepMind 2024");
    }

    #[test]
    fn normal_authors_unchanged() {
        assert_eq!(get_last_name("Sanderson, Alexis"), "Sanderson");
        assert_eq!(get_last_name("John Smith"), "Smith");
    }

    #[test]
    fn disambiguation_adds_letter_suffix() {
        let entries = vec![
            entry("sanderson2009a", &["Sanderson, Alexis"], "2009"),
            entry("sanderson2009b", &["Sanderson, Alexis"], "2009"),
        ];
        let result = render_bib_citations(&entries);
        assert_eq!(result.get("sanderson2009a").unwrap(), "Sanderson 2009a");
        assert_eq!(result.get("sanderson2009b").unwrap(), "Sanderson 2009b");
    }

    #[test]
    fn disambiguation_alphabetical_by_key() {
        let entries = vec![
            entry("z_key", &["Smith, John"], "2020"),
            entry("a_key", &["Smith, John"], "2020"),
        ];
        let result = render_bib_citations(&entries);
        assert_eq!(result.get("a_key").unwrap(), "Smith 2020a");
        assert_eq!(result.get("z_key").unwrap(), "Smith 2020b");
    }

    #[test]
    fn disambiguation_three_entries() {
        let entries = vec![
            entry("s2020a", &["Smith, John"], "2020"),
            entry("s2020b", &["Smith, John"], "2020"),
            entry("s2020c", &["Smith, John"], "2020"),
        ];
        let result = render_bib_citations(&entries);
        assert_eq!(result.get("s2020a").unwrap(), "Smith 2020a");
        assert_eq!(result.get("s2020b").unwrap(), "Smith 2020b");
        assert_eq!(result.get("s2020c").unwrap(), "Smith 2020c");
    }

    #[test]
    fn no_disambiguation_when_unique() {
        let entries = vec![
            entry("s2020", &["Smith, John"], "2020"),
            entry("j2021", &["Jones, Alice"], "2021"),
        ];
        let result = render_bib_citations(&entries);
        assert_eq!(result.get("s2020").unwrap(), "Smith 2020");
        assert_eq!(result.get("j2021").unwrap(), "Jones 2021");
    }

    #[test]
    fn mixed_disambiguation_and_unique() {
        let entries = vec![
            entry("s2020a", &["Smith, John"], "2020"),
            entry("s2020b", &["Smith, John"], "2020"),
            entry("j2021", &["Jones, Alice"], "2021"),
        ];
        let result = render_bib_citations(&entries);
        assert_eq!(result.get("s2020a").unwrap(), "Smith 2020a");
        assert_eq!(result.get("s2020b").unwrap(), "Smith 2020b");
        assert_eq!(result.get("j2021").unwrap(), "Jones 2021");
    }
}
