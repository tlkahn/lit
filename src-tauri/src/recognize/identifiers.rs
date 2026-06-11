use crate::bib::convert::{is_valid_doi, normalize_doi};
use crate::pdf::PdfRecognizerData;
use regex::Regex;
use serde::Serialize;
use std::collections::HashMap;
use std::sync::LazyLock;
use unicode_normalization::UnicodeNormalization;

static ARXIV_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)arxiv:\s*([a-z\-]+/\d{7}(?:v\d+)?|\d{4}\.\d{4,6}(?:v\d+)?)").unwrap()
});

static ISSN_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"ISSN:? *(\d{4}-\d{3}[\dX])").unwrap());

static DOI_EXTRACT_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"10\.\d{4,9}/[^\s]+[^\s.,]").unwrap());

static ISBN_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)\b(?:ISBN(?:[- ]?1[03])?|SBN)[:\s]*([0-9][0-9\- \u{2013}\u{2014}xX]{8,26}[0-9xX])").unwrap()
});

static JSTOR_STABLE_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"Stable URL:\s*https?://www\.jstor\.org/stable/(\S+)").unwrap()
});

// ── Structs ───────────────────────────────────────────────────────────

#[derive(Debug, Clone, Default, PartialEq, Serialize)]
pub struct JstorMetadata {
    pub chapter_title: Option<String>,
    pub authors: Vec<String>,
    pub source: Option<String>,
    pub volume: Option<String>,
    pub number: Option<String>,
    pub pages: Option<String>,
    pub year: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize)]
pub struct ExtractedIdentifiers {
    pub doi: Option<String>,
    pub arxiv: Option<String>,
    pub isbn: Option<String>,
    pub issn: Option<String>,
    pub jstor_metadata: Option<JstorMetadata>,
    pub info_title: Option<String>,
}

// ── Public API ────────────────────────────────────────────────────────

pub fn extract_identifiers(data: &PdfRecognizerData) -> ExtractedIdentifiers {
    let mut result = ExtractedIdentifiers::default();

    // 1. JSTOR cover page (highest DOI precedence)
    let (jstor_doi, jstor_meta) = try_jstor_cover(&data.pages);
    if jstor_doi.is_some() {
        result.doi = jstor_doi;
    }
    result.jstor_metadata = jstor_meta;

    // 2. PDF Info dictionary
    if result.doi.is_none() {
        result.doi = try_info_doi(&data.info);
    }
    if result.isbn.is_none() {
        result.isbn = try_info_isbn(&data.info);
    }
    result.info_title = validate_info_title(&data.info, &data.pages);

    // 3. arXiv ID (page 0 only)
    result.arxiv = try_arxiv(&data.pages);

    // 4. ISBN from text (all pages, max 5)
    if result.isbn.is_none() {
        result.isbn = try_isbn(&data.pages);
    }

    // 5. ISSN from text
    result.issn = try_issn(&data.pages);

    // 6. DOI regex (pages 0-1, lowest precedence)
    if result.doi.is_none() {
        result.doi = try_doi_regex(&data.pages);
    }

    result
}

pub fn validate_isbn_10(digits: &[u8]) -> bool {
    if digits.len() != 10 {
        return false;
    }
    let sum: u32 = digits
        .iter()
        .enumerate()
        .map(|(i, &d)| d as u32 * (10 - i as u32))
        .sum();
    sum.is_multiple_of(11)
}

pub fn validate_isbn_13(digits: &[u8]) -> bool {
    if digits.len() != 13 {
        return false;
    }
    let sum: u32 = digits
        .iter()
        .enumerate()
        .map(|(i, &d)| {
            let weight = if i % 2 == 0 { 1u32 } else { 3u32 };
            d as u32 * weight
        })
        .sum();
    sum.is_multiple_of(10)
}

/// Strip hyphens, en-dashes, em-dashes, and spaces, then uppercase.
fn strip_isbn_separators(s: &str) -> String {
    s.chars()
        .filter(|&c| c != '-' && c != '\u{2013}' && c != '\u{2014}' && c != ' ')
        .collect::<String>()
        .to_uppercase()
}

pub fn clean_isbn(raw: &str) -> Option<String> {
    let cleaned = strip_isbn_separators(raw);

    // Validate length is exactly 10 or 13
    let len = cleaned.len();
    if len != 10 && len != 13 {
        return None;
    }

    // Validate characters: digits and at most one trailing X (ISBN-10 only)
    for (i, c) in cleaned.chars().enumerate() {
        match c {
            '0'..='9' => {}
            'X' if len == 10 && i == 9 => {}
            _ => return None,
        }
    }

    // Convert to digit values
    let digits: Vec<u8> = cleaned
        .chars()
        .map(|c| if c == 'X' { 10 } else { c as u8 - b'0' })
        .collect();

    // Validate checksum
    let valid = if len == 10 {
        validate_isbn_10(&digits)
    } else {
        validate_isbn_13(&digits)
    };

    if valid {
        Some(cleaned)
    } else {
        None
    }
}

pub fn validate_issn(s: &str) -> bool {
    let cleaned: String = s.chars().filter(|&c| c != '-').collect();
    if cleaned.len() != 8 {
        return false;
    }

    let mut digits: Vec<u8> = Vec::with_capacity(8);
    for (i, c) in cleaned.chars().enumerate() {
        match c {
            '0'..='9' => digits.push(c as u8 - b'0'),
            'X' | 'x' if i == 7 => digits.push(10),
            _ => return false,
        }
    }

    let weights: [u32; 8] = [8, 7, 6, 5, 4, 3, 2, 1];
    let sum: u32 = digits
        .iter()
        .zip(weights.iter())
        .map(|(&d, &w)| d as u32 * w)
        .sum();
    sum.is_multiple_of(11)
}

/// Extract an arXiv ID from page 0 text. Returns the bare ID (without the "arXiv:" prefix).
fn try_arxiv(pages: &[String]) -> Option<String> {
    let page0 = pages.first()?;
    ARXIV_RE.captures(page0).map(|caps| caps[1].to_string())
}

/// Extract an ISSN from any page. Returns the first valid match.
fn try_issn(pages: &[String]) -> Option<String> {
    for page in pages {
        for caps in ISSN_RE.captures_iter(page) {
            let candidate = caps[1].to_string();
            if validate_issn(&candidate) {
                return Some(candidate);
            }
        }
    }
    None
}

/// Given a stripped digit+X string, split concatenated ISBN pairs and return
/// candidate strings to try through `clean_isbn`. For SBN matches, prepend "0".
fn split_isbn_candidates(stripped: &str, is_sbn: bool) -> Vec<String> {
    let len = stripped.len();
    let mut candidates = Vec::new();

    if is_sbn {
        // SBN: prepend 0 to make ISBN-10
        let padded = format!("0{}", stripped);
        candidates.push(padded);
    } else if len == 20 {
        // Two concatenated ISBN-10s
        candidates.push(stripped[..10].to_string());
        candidates.push(stripped[10..].to_string());
    } else if len == 26 {
        // Two concatenated ISBN-13s
        candidates.push(stripped[..13].to_string());
        candidates.push(stripped[13..].to_string());
    } else {
        candidates.push(stripped.to_string());
    }

    candidates
}

/// Extract an ISBN from the text of up to 5 pages.
/// Returns `None` if >3 distinct valid ISBNs are found (likely a bibliography).
fn try_isbn(pages: &[String]) -> Option<String> {
    let limit = pages.len().min(5);
    let mut seen: Vec<String> = Vec::new();

    for page in &pages[..limit] {
        for caps in ISBN_RE.captures_iter(page) {
            let full_match_lower = caps[0].to_ascii_lowercase();
            let is_sbn = full_match_lower.starts_with("sbn");

            let stripped = strip_isbn_separators(&caps[1]);

            let candidates = split_isbn_candidates(&stripped, is_sbn);

            for candidate in candidates {
                if let Some(valid) = clean_isbn(&candidate) {
                    if !seen.contains(&valid) {
                        seen.push(valid);
                    }
                }
            }
        }
    }

    // Reject if more than 3 distinct valid ISBNs (bibliography heuristic)
    if seen.len() > 3 {
        return None;
    }

    seen.into_iter().next()
}

/// Trim trailing unbalanced closing brackets from a DOI match.
fn trim_unbalanced_brackets(s: &str) -> &str {
    let bytes = s.as_bytes();
    let mut end = bytes.len();
    let pairs: [(u8, u8); 3] = [(b'(', b')'), (b'[', b']'), (b'{', b'}')];
    for &(open, close) in &pairs {
        loop {
            if end == 0 || bytes[end - 1] != close {
                break;
            }
            let slice = &bytes[..end];
            let open_count = slice.iter().filter(|&&b| b == open).count();
            let close_count = slice.iter().filter(|&&b| b == close).count();
            if close_count > open_count {
                end -= 1;
            } else {
                break;
            }
        }
    }
    &s[..end]
}

/// Extract a DOI from pages 0-1 via regex. Returns the lowercased DOI.
fn try_doi_regex(pages: &[String]) -> Option<String> {
    let limit = pages.len().min(2);
    for page in &pages[..limit] {
        if let Some(m) = DOI_EXTRACT_RE.find(page) {
            let trimmed = trim_unbalanced_brackets(m.as_str());
            return Some(trimmed.to_lowercase());
        }
    }
    None
}

// ── Info dictionary heuristics ───────────────────────────────────────

/// NFKD-decompose, keep only alphabetic chars, lowercase.
fn nfkd_letters_lower(s: &str) -> String {
    s.nfkd()
        .filter(|c| c.is_alphabetic())
        .flat_map(|c| c.to_lowercase())
        .collect()
}

/// Case-insensitive lookup in the PDF info dictionary.
fn info_value_by_key<'a>(info: &'a HashMap<String, String>, target: &str) -> Option<&'a String> {
    info.iter()
        .find_map(|(k, v)| k.eq_ignore_ascii_case(target).then_some(v))
}

/// Extract a DOI from the PDF info dictionary.
fn try_info_doi(info: &HashMap<String, String>) -> Option<String> {
    for target in &["doi", "wps-articledoi"] {
        if let Some(value) = info_value_by_key(info, target) {
            let normalized = normalize_doi(value);
            if is_valid_doi(&normalized) {
                return Some(normalized.to_lowercase());
            }
        }
    }
    None
}

/// Extract an ISBN from the PDF info dictionary.
fn try_info_isbn(info: &HashMap<String, String>) -> Option<String> {
    info_value_by_key(info, "isbn").and_then(|v| clean_isbn(v))
}

/// Extract and validate the Title from the PDF info dictionary.
/// Rejects garbage titles (e.g. "Microsoft Word - Document1") by requiring
/// that the title's letter-only fingerprint appears in the extracted page text.
fn validate_info_title(info: &HashMap<String, String>, pages: &[String]) -> Option<String> {
    let title_value = info_value_by_key(info, "title")?;

    let title_fingerprint = nfkd_letters_lower(title_value);
    if title_fingerprint.is_empty() {
        return None;
    }

    let text_fingerprint: String = pages.iter().map(|p| nfkd_letters_lower(p)).collect();
    if text_fingerprint.contains(&title_fingerprint) {
        Some(title_value.clone())
    } else {
        None
    }
}

// ── JSTOR cover page heuristics ─────────────────────────────────────

/// Extract the value of a labeled JSTOR field from the text.
/// Looks for "Label: value" where value extends to the end of the line.
fn extract_jstor_field(text: &str, label: &str) -> Option<String> {
    for line in text.lines() {
        let trimmed = line.trim();
        if let Some(rest) = trimmed.strip_prefix(label) {
            let value = rest.trim().to_string();
            if !value.is_empty() {
                return Some(value);
            }
        }
    }
    None
}

/// Parse an "Author(s):" value into a Vec of author names.
/// Authors are comma-separated, with possible " and " or " & " conjunctions.
fn parse_jstor_authors(raw: &str) -> Vec<String> {
    raw.split(',')
        .flat_map(|part| part.split(" and "))
        .flat_map(|part| part.split(" & "))
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect()
}

/// Parse a JSTOR "Source:" value to extract volume, number, pages, and year.
/// Typical format: "The Journal Name, Vol. 98, No. 3 (Mar., 2001), pp. 5-28"
fn parse_jstor_source(
    source: &str,
) -> (Option<String>, Option<String>, Option<String>, Option<String>) {
    let volume = {
        static VOL_RE: LazyLock<Regex> =
            LazyLock::new(|| Regex::new(r"Vol\.?\s*(\d+)").unwrap());
        VOL_RE.captures(source).map(|c| c[1].to_string())
    };

    let number = {
        static NO_RE: LazyLock<Regex> =
            LazyLock::new(|| Regex::new(r"No\.?\s*(\d+)").unwrap());
        NO_RE.captures(source).map(|c| c[1].to_string())
    };

    let pages = {
        static PP_RE: LazyLock<Regex> =
            LazyLock::new(|| Regex::new(r"pp?\.?\s*(\d+(?:\s*-\s*\d+)?)").unwrap());
        PP_RE.captures(source).map(|c| c[1].to_string())
    };

    let year = {
        static YEAR_RE: LazyLock<Regex> =
            LazyLock::new(|| Regex::new(r"\((?:[^)]*,\s*)?(\d{4})\)").unwrap());
        YEAR_RE.captures(source).map(|c| c[1].to_string())
    };

    (volume, number, pages, year)
}

/// Parse structured JSTOR metadata fields from cover page text.
fn parse_jstor_metadata(text: &str) -> JstorMetadata {
    let chapter_title = extract_jstor_field(text, "Chapter Title:");
    let authors_raw = extract_jstor_field(text, "Author(s):");
    let source_raw = extract_jstor_field(text, "Source:");

    let authors = match &authors_raw {
        Some(s) => parse_jstor_authors(s),
        None => Vec::new(),
    };

    let (volume, number, pages, year) = match &source_raw {
        Some(s) => parse_jstor_source(s),
        None => (None, None, None, None),
    };

    // The "source" field in JstorMetadata is the journal name (everything before the first comma
    // or the full string if no comma)
    let source = source_raw.as_ref().map(|s| {
        s.split(',')
            .next()
            .unwrap_or(s)
            .trim()
            .to_string()
    });

    JstorMetadata {
        chapter_title,
        authors,
        source,
        volume,
        number,
        pages,
        year,
    }
}

/// Parse JSTOR cover page (page 0): extract stable-URL-derived DOI,
/// any explicit DOI, and structured metadata fields.
fn try_jstor_cover(pages: &[String]) -> (Option<String>, Option<JstorMetadata>) {
    let page0 = match pages.first() {
        Some(p) => p,
        None => return (None, None),
    };

    // Look for the stable URL to confirm this is a JSTOR cover page
    let stable_id = match JSTOR_STABLE_RE.captures(page0) {
        Some(caps) => caps[1].to_string(),
        None => return (None, None),
    };

    // Derive DOI from stable ID
    let derived_doi = format!("10.2307/{}", stable_id);

    // Collect all DOI matches on the page
    let all_dois: Vec<String> = DOI_EXTRACT_RE
        .find_iter(page0)
        .map(|m| {
            let trimmed = trim_unbalanced_brackets(m.as_str());
            trimmed.to_lowercase()
        })
        .collect();

    // Prefer a non-JSTOR DOI (explicit publisher DOI) over the derived one
    let explicit_doi = all_dois
        .iter()
        .find(|d| !d.starts_with("10.2307/"))
        .cloned();

    let doi = explicit_doi.or(Some(derived_doi));

    // Parse JSTOR metadata fields
    let metadata = parse_jstor_metadata(page0);

    (doi, Some(metadata))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    #[test]
    fn isbn_10_valid() {
        // Standard ISBN-10: 0-306-40615-2
        // Digits: [0, 3, 0, 6, 4, 0, 6, 1, 5, 2]
        // Checksum: 0*10 + 3*9 + 0*8 + 6*7 + 4*6 + 0*5 + 6*4 + 1*3 + 5*2 + 2*1 = 132, 132 % 11 == 0
        assert!(validate_isbn_10(&[0, 3, 0, 6, 4, 0, 6, 1, 5, 2]));
    }

    #[test]
    fn isbn_10_with_x_check_digit() {
        // ISBN-10: 0-8044-2957-X  (X = 10)
        // Digits: [0, 8, 0, 4, 4, 2, 9, 5, 7, 10]
        assert!(validate_isbn_10(&[0, 8, 0, 4, 4, 2, 9, 5, 7, 10]));
    }

    #[test]
    fn isbn_10_invalid() {
        // Same as isbn_10_valid but last digit changed from 2 to 3
        assert!(!validate_isbn_10(&[0, 3, 0, 6, 4, 0, 6, 1, 5, 3]));
    }

    #[test]
    fn isbn_10_wrong_length() {
        // 9 digits -- too short
        assert!(!validate_isbn_10(&[0, 3, 0, 6, 4, 0, 6, 1, 5]));
        // 11 digits -- too long
        assert!(!validate_isbn_10(&[0, 3, 0, 6, 4, 0, 6, 1, 5, 2, 0]));
    }

    #[test]
    fn isbn_13_valid() {
        // ISBN-13: 978-0-306-40615-7
        // Digits: [9, 7, 8, 0, 3, 0, 6, 4, 0, 6, 1, 5, 7]
        // Checksum: sum of digit[i] * (1 if i%2==0 else 3) mod 10 == 0
        assert!(validate_isbn_13(&[9, 7, 8, 0, 3, 0, 6, 4, 0, 6, 1, 5, 7]));
    }

    #[test]
    fn isbn_13_invalid() {
        // Same as isbn_13_valid but last digit changed from 7 to 8
        assert!(!validate_isbn_13(&[9, 7, 8, 0, 3, 0, 6, 4, 0, 6, 1, 5, 8]));
    }

    #[test]
    fn clean_isbn_strips_dashes() {
        assert_eq!(
            clean_isbn("978-0-306-40615-7"),
            Some("9780306406157".to_string())
        );
    }

    #[test]
    fn clean_isbn_with_x() {
        assert_eq!(
            clean_isbn("0-8044-2957-X"),
            Some("080442957X".to_string())
        );
    }

    #[test]
    fn clean_isbn_invalid_checksum() {
        // Last digit changed from 7 to 8 -- checksum fails
        assert_eq!(clean_isbn("978-0-306-40615-8"), None);
    }

    #[test]
    fn clean_isbn_wrong_length() {
        assert_eq!(clean_isbn("123"), None);
    }

    #[test]
    fn issn_valid() {
        assert!(validate_issn("0317-8471"));
    }

    #[test]
    fn issn_with_x() {
        // "0001-253X" is a real valid ISSN with X check digit.
        assert!(validate_issn("0001-253X"));
    }

    #[test]
    fn issn_invalid() {
        assert!(!validate_issn("1234-5670"));
    }

    #[test]
    fn issn_without_hyphen() {
        // Should accept unhyphenated form too
        assert!(validate_issn("03178471"));
    }

    #[test]
    fn issn_wrong_length() {
        assert!(!validate_issn("0317-84"));
        assert!(!validate_issn("0317-84711"));
    }

    #[test]
    fn issn_lowercase_x() {
        // Lowercase x should be accepted
        assert!(validate_issn("0001-253x"));
    }

    #[test]
    fn arxiv_new_style() {
        let pages = vec!["some text arXiv:2301.12345 more text".to_string()];
        assert_eq!(try_arxiv(&pages), Some("2301.12345".to_string()));
    }

    #[test]
    fn arxiv_new_style_version() {
        let pages = vec!["arXiv:2301.12345v2".to_string()];
        assert_eq!(try_arxiv(&pages), Some("2301.12345v2".to_string()));
    }

    #[test]
    fn arxiv_old_style() {
        let pages = vec!["arXiv:hep-th/0601234".to_string()];
        assert_eq!(try_arxiv(&pages), Some("hep-th/0601234".to_string()));
    }

    #[test]
    fn arxiv_old_style_version() {
        let pages = vec!["arXiv:hep-th/0601234v3".to_string()];
        assert_eq!(try_arxiv(&pages), Some("hep-th/0601234v3".to_string()));
    }

    #[test]
    fn arxiv_with_space() {
        let pages = vec!["arXiv: 2301.12345".to_string()];
        assert_eq!(try_arxiv(&pages), Some("2301.12345".to_string()));
    }

    #[test]
    fn arxiv_five_digit_suffix() {
        let pages = vec!["arXiv:2301.123456".to_string()];
        assert_eq!(try_arxiv(&pages), Some("2301.123456".to_string()));
    }

    #[test]
    fn arxiv_not_found() {
        let pages = vec!["This is a paper about quantum physics.".to_string()];
        assert_eq!(try_arxiv(&pages), None);
    }

    #[test]
    fn issn_extract_basic() {
        let pages = vec!["Journal of Foo ISSN 0317-8471 published quarterly".to_string()];
        assert_eq!(try_issn(&pages), Some("0317-8471".to_string()));
    }

    #[test]
    fn issn_extract_with_colon() {
        let pages = vec!["ISSN:0028-0836".to_string()];
        assert_eq!(try_issn(&pages), Some("0028-0836".to_string()));
    }

    #[test]
    fn issn_extract_with_x() {
        let pages = vec!["ISSN: 0250-474X".to_string()];
        assert_eq!(try_issn(&pages), Some("0250-474X".to_string()));
    }

    // ── Cycle 6: DOI regex extraction tests ──────────────────────────────

    #[test]
    fn doi_basic() {
        let pages = vec!["doi: 10.1038/nature12373".to_string()];
        assert_eq!(try_doi_regex(&pages), Some("10.1038/nature12373".to_string()));
    }

    #[test]
    fn doi_balanced_parens_kept() {
        let pages = vec!["10.1000/xyz(2023)".to_string()];
        assert_eq!(try_doi_regex(&pages), Some("10.1000/xyz(2023)".to_string()));
    }

    #[test]
    fn doi_unbalanced_close_paren_trimmed() {
        let pages = vec!["(see 10.1000/xyz)".to_string()];
        assert_eq!(try_doi_regex(&pages), Some("10.1000/xyz".to_string()));
    }

    #[test]
    fn doi_trailing_period_excluded() {
        let pages = vec!["10.1000/xyz.".to_string()];
        assert_eq!(try_doi_regex(&pages), Some("10.1000/xyz".to_string()));
    }

    #[test]
    fn doi_lowercased() {
        let pages = vec!["10.1038/Nature12373".to_string()];
        assert_eq!(try_doi_regex(&pages), Some("10.1038/nature12373".to_string()));
    }

    #[test]
    fn doi_only_first_two_pages() {
        let pages = vec![
            "nothing here".to_string(),
            "nothing here either".to_string(),
            "10.1038/nature12373".to_string(),
        ];
        assert_eq!(try_doi_regex(&pages), None);
    }

    #[test]
    fn doi_unbalanced_square_bracket_trimmed() {
        let pages = vec!["[see 10.1000/xyz]".to_string()];
        assert_eq!(try_doi_regex(&pages), Some("10.1000/xyz".to_string()));
    }

    #[test]
    fn doi_nested_balanced_parens() {
        let pages = vec!["10.1016/s1474-5151(03)00108-7".to_string()];
        assert_eq!(
            try_doi_regex(&pages),
            Some("10.1016/s1474-5151(03)00108-7".to_string()),
        );
    }

    #[test]
    fn doi_double_unbalanced_close_paren() {
        let pages = vec!["(see 10.1016/s1474-5151(03)00108-7)".to_string()];
        assert_eq!(
            try_doi_regex(&pages),
            Some("10.1016/s1474-5151(03)00108-7".to_string()),
        );
    }

    #[test]
    fn doi_found_on_page_1() {
        let pages = vec![
            "nothing on page 0".to_string(),
            "doi: 10.1038/nature12373".to_string(),
        ];
        assert_eq!(try_doi_regex(&pages), Some("10.1038/nature12373".to_string()));
    }

    // -- Cycle 7: ISBN text extraction tests --

    #[test]
    fn isbn_extract_single() {
        let pages = vec!["Some text ISBN 978-0-306-40615-7 more text".to_string()];
        assert_eq!(try_isbn(&pages), Some("9780306406157".to_string()));
    }

    #[test]
    fn isbn_extract_concatenated_pair() {
        // Two ISBN-13s printed without space: 9780306406157 + 9780262033848
        let pages = vec!["ISBN 97803064061579780262033848".to_string()];
        assert_eq!(try_isbn(&pages), Some("9780306406157".to_string()));
    }

    #[test]
    fn isbn_extract_various_dashes() {
        // en-dash (\u{2013}) and em-dash (\u{2014}) should be treated like hyphens
        let pages = vec!["ISBN 978\u{2013}0\u{2013}306\u{2014}40615\u{2013}7".to_string()];
        assert_eq!(try_isbn(&pages), Some("9780306406157".to_string()));
    }

    #[test]
    fn isbn_extract_multi_reject() {
        // 4 distinct valid ISBNs → likely a bibliography, reject
        let pages = vec![
            "ISBN 978-0-306-40615-7 ISBN 978-0-262-03384-8 ISBN 978-0-13-468599-1 ISBN 978-0-321-12521-7".to_string()
        ];
        assert_eq!(try_isbn(&pages), None);
    }

    #[test]
    fn isbn_extract_sbn_prefix() {
        // Old-style SBN: prepend 0 to get ISBN-10
        let pages = vec!["SBN 306-40615-2".to_string()];
        assert_eq!(try_isbn(&pages), Some("0306406152".to_string()));
    }

    // -- Cycle 8: Info dictionary heuristics tests --

    #[test]
    fn nfkd_letters_lower_basic() {
        // "Cafe\u{0301}" (e + combining acute) → "cafe"
        assert_eq!(nfkd_letters_lower("Caf\u{00e9}"), "cafe");
        // Digits, spaces, punctuation stripped
        assert_eq!(nfkd_letters_lower("Hello, World! 123"), "helloworld");
    }

    #[test]
    fn info_doi_normalized() {
        let mut info = HashMap::new();
        info.insert("doi".to_string(), "https://doi.org/10.1038/nature12373".to_string());
        assert_eq!(
            try_info_doi(&info),
            Some("10.1038/nature12373".to_string()),
        );
    }

    #[test]
    fn info_doi_wps_articledoi() {
        let mut info = HashMap::new();
        info.insert("wps-articledoi".to_string(), "10.1016/j.cell.2020.01.001".to_string());
        assert_eq!(
            try_info_doi(&info),
            Some("10.1016/j.cell.2020.01.001".to_string()),
        );
    }

    #[test]
    fn info_doi_invalid_rejected() {
        let mut info = HashMap::new();
        info.insert("doi".to_string(), "not-a-doi".to_string());
        assert_eq!(try_info_doi(&info), None);
    }

    #[test]
    fn info_doi_case_insensitive_key() {
        let mut info = HashMap::new();
        info.insert("DOI".to_string(), "10.1038/nature12373".to_string());
        assert_eq!(
            try_info_doi(&info),
            Some("10.1038/nature12373".to_string()),
        );
    }

    #[test]
    fn info_isbn_cleaned() {
        let mut info = HashMap::new();
        info.insert("ISBN".to_string(), "978-0-306-40615-7".to_string());
        assert_eq!(
            try_info_isbn(&info),
            Some("9780306406157".to_string()),
        );
    }

    #[test]
    fn info_isbn_invalid_rejected() {
        let mut info = HashMap::new();
        info.insert("isbn".to_string(), "978-0-306-40615-8".to_string());
        assert_eq!(try_info_isbn(&info), None);
    }

    #[test]
    fn info_title_present_in_text() {
        let mut info = HashMap::new();
        info.insert("Title".to_string(), "Quantum Entanglement".to_string());
        let pages = vec!["A study of Quantum Entanglement in systems".to_string()];
        assert_eq!(
            validate_info_title(&info, &pages),
            Some("Quantum Entanglement".to_string()),
        );
    }

    #[test]
    fn info_title_garbage_rejected() {
        let mut info = HashMap::new();
        info.insert("Title".to_string(), "Microsoft Word - Document1".to_string());
        let pages = vec!["A study of Quantum Entanglement in systems".to_string()];
        assert_eq!(validate_info_title(&info, &pages), None);
    }

    #[test]
    fn info_title_empty_rejected() {
        let mut info = HashMap::new();
        info.insert("Title".to_string(), "".to_string());
        let pages = vec!["Some text".to_string()];
        assert_eq!(validate_info_title(&info, &pages), None);
    }

    // -- Cycle 9: JSTOR cover page tests --

    #[test]
    fn jstor_stable_url_derives_doi() {
        let pages = vec![
            "Stable URL: http://www.jstor.org/stable/12345\n".to_string(),
        ];
        let (doi, _metadata) = try_jstor_cover(&pages);
        assert_eq!(doi, Some("10.2307/12345".to_string()));
    }

    #[test]
    fn jstor_embedded_doi_wins() {
        let pages = vec![
            "Stable URL: http://www.jstor.org/stable/12345\nDOI: 10.1086/599247\n".to_string(),
        ];
        let (doi, _metadata) = try_jstor_cover(&pages);
        // The explicit DOI on the cover page takes precedence over the derived 10.2307/12345
        assert_eq!(doi, Some("10.1086/599247".to_string()));
    }

    #[test]
    fn jstor_parses_metadata() {
        let pages = vec![
            concat!(
                "Chapter Title: The Theory of Everything\n",
                "Author(s): John Smith, Jane Doe\n",
                "Source: The Journal of Philosophy, Vol. 98, No. 3 (Mar., 2001), pp. 5-28\n",
                "Published by: The Publisher\n",
                "Stable URL: http://www.jstor.org/stable/12345\n",
            ).to_string(),
        ];
        let (doi, metadata) = try_jstor_cover(&pages);
        assert_eq!(doi, Some("10.2307/12345".to_string()));

        let meta = metadata.unwrap();
        assert_eq!(meta.chapter_title, Some("The Theory of Everything".to_string()));
        assert_eq!(meta.authors, vec!["John Smith".to_string(), "Jane Doe".to_string()]);
        assert_eq!(meta.source, Some("The Journal of Philosophy".to_string()));
        assert_eq!(meta.volume, Some("98".to_string()));
        assert_eq!(meta.number, Some("3".to_string()));
        assert_eq!(meta.pages, Some("5-28".to_string()));
        assert_eq!(meta.year, Some("2001".to_string()));
    }

    #[test]
    fn jstor_not_detected_without_stable_url() {
        let pages = vec!["Some random text without JSTOR content".to_string()];
        let (doi, metadata) = try_jstor_cover(&pages);
        assert_eq!(doi, None);
        assert!(metadata.is_none());
    }

    #[test]
    fn jstor_empty_pages() {
        let pages: Vec<String> = vec![];
        let (doi, metadata) = try_jstor_cover(&pages);
        assert_eq!(doi, None);
        assert!(metadata.is_none());
    }

    #[test]
    fn jstor_https_stable_url() {
        let pages = vec![
            "Stable URL: https://www.jstor.org/stable/99999\n".to_string(),
        ];
        let (doi, _metadata) = try_jstor_cover(&pages);
        assert_eq!(doi, Some("10.2307/99999".to_string()));
    }

    #[test]
    fn jstor_partial_metadata() {
        let pages = vec![
            concat!(
                "Author(s): Solo Author\n",
                "Stable URL: http://www.jstor.org/stable/67890\n",
            ).to_string(),
        ];
        let (_doi, metadata) = try_jstor_cover(&pages);
        let meta = metadata.unwrap();
        assert_eq!(meta.chapter_title, None);
        assert_eq!(meta.authors, vec!["Solo Author".to_string()]);
        assert_eq!(meta.source, None);
        assert_eq!(meta.volume, None);
        assert_eq!(meta.number, None);
        assert_eq!(meta.pages, None);
        assert_eq!(meta.year, None);
    }

    // -- Cycle 10: extract_identifiers integration + precedence tests --

    #[test]
    fn empty_data_returns_defaults() {
        let data = PdfRecognizerData {
            pages: vec![],
            total_pages: 0,
            info: HashMap::new(),
        };
        let result = extract_identifiers(&data);
        assert_eq!(result, ExtractedIdentifiers::default());
    }

    #[test]
    fn jstor_doi_beats_regex_doi() {
        let data = PdfRecognizerData {
            pages: vec![
                "Stable URL: http://www.jstor.org/stable/12345\n".to_string(),
                "See also 10.9999/should-not-win".to_string(),
            ],
            total_pages: 2,
            info: HashMap::new(),
        };
        let result = extract_identifiers(&data);
        // JSTOR-derived DOI (precedence 1) must NOT be overwritten by the regex DOI on page 1 (precedence 6)
        assert_eq!(result.doi, Some("10.2307/12345".to_string()));
    }

    #[test]
    fn info_doi_beats_regex_doi() {
        let mut info = HashMap::new();
        info.insert("doi".to_string(), "10.1038/nature12373".to_string());
        let data = PdfRecognizerData {
            pages: vec![
                "10.9999/regex-doi-should-not-win".to_string(),
            ],
            total_pages: 1,
            info,
        };
        let result = extract_identifiers(&data);
        // Info dict DOI (precedence 2) must NOT be overwritten by regex DOI (precedence 6)
        assert_eq!(result.doi, Some("10.1038/nature12373".to_string()));
    }

    #[test]
    fn all_identifiers_at_once() {
        let mut info = HashMap::new();
        info.insert("Title".to_string(), "Quantum Entanglement".to_string());
        let data = PdfRecognizerData {
            pages: vec![
                "arXiv:2301.12345v2 and ISSN 0317-8471 and Quantum Entanglement paper".to_string(),
                "ISBN 978-0-306-40615-7 and doi: 10.1038/nature12373".to_string(),
            ],
            total_pages: 2,
            info,
        };
        let result = extract_identifiers(&data);
        assert_eq!(result.arxiv, Some("2301.12345v2".to_string()));
        assert_eq!(result.issn, Some("0317-8471".to_string()));
        assert_eq!(result.isbn, Some("9780306406157".to_string()));
        assert_eq!(result.doi, Some("10.1038/nature12373".to_string()));
        assert_eq!(result.info_title, Some("Quantum Entanglement".to_string()));
        assert!(result.jstor_metadata.is_none());
    }
}
