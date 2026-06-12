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
    LazyLock::new(|| Regex::new(r"(?i)ISSN:? *(\d{4}-\d{3}[\dX])").unwrap());

static DOI_EXTRACT_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"10\.\d{4,9}/[^\s]+[^\s.,]").unwrap());

static ISBN_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)\b(?:ISBN(?:[- ]?1[03])?|SBN)[:\s]*([0-9][0-9\- \t\n\r\u{2013}\u{2014}xX]{8,52}[0-9xX])").unwrap()
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

/// Strip hyphens, en-dashes, em-dashes, and whitespace (including Unicode), then uppercase.
fn strip_isbn_separators(s: &str) -> String {
    s.chars()
        .filter(|&c| c != '-' && c != '\u{2013}' && c != '\u{2014}' && !c.is_whitespace())
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

pub fn isbn10_to_isbn13(isbn10: &str) -> Option<String> {
    let cleaned = strip_isbn_separators(isbn10);
    if cleaned.len() != 10 {
        return None;
    }
    let body = &cleaned[..9];
    if !body.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    let isbn13_body = format!("978{}", body);
    let sum: u32 = isbn13_body
        .bytes()
        .enumerate()
        .map(|(i, b)| {
            let d = (b - b'0') as u32;
            if i % 2 == 0 { d } else { d * 3 }
        })
        .sum();
    let check = (10 - (sum % 10)) % 10;
    Some(format!("{}{}", isbn13_body, check))
}

pub fn normalize_to_isbn13(isbn: &str) -> Option<String> {
    let cleaned = strip_isbn_separators(isbn);
    match cleaned.len() {
        13 => clean_isbn(&cleaned),
        10 => isbn10_to_isbn13(&cleaned),
        _ => None,
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
                // Normalize check digit to uppercase for consistent output
                let mut normalized = candidate;
                if normalized.ends_with('x') {
                    normalized.pop();
                    normalized.push('X');
                }
                return Some(normalized);
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
    } else if len == 23 {
        // Mixed ISBN-10 + ISBN-13 pair (either order).
        // Try both splits; prefer the one where both halves validate.
        let mut split_found = false;
        for split_at in [10, 13] {
            let left = clean_isbn(&stripped[..split_at]);
            let right = clean_isbn(&stripped[split_at..]);
            if let (Some(l), Some(r)) = (left, right) {
                candidates.push(l);
                candidates.push(r);
                split_found = true;
                break;
            }
        }
        if !split_found {
            candidates.push(stripped.to_string());
        }
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

            // Split the raw capture on whitespace first to separate
            // space-delimited ISBN pairs that the regex captured as one run,
            // then strip separators from each fragment individually.
            let raw = &caps[1];
            let fragments: Vec<&str> = raw.split_whitespace().collect();

            let mut all_candidates = Vec::new();
            if fragments.len() > 1 {
                // Multiple whitespace-separated fragments: strip and validate each
                for frag in &fragments {
                    let stripped = strip_isbn_separators(frag);
                    all_candidates.extend(split_isbn_candidates(&stripped, is_sbn));
                }
            }
            // Also try the fully-stripped (concatenated) path for cases
            // where two ISBNs are printed without any whitespace.
            let stripped = strip_isbn_separators(raw);
            all_candidates.extend(split_isbn_candidates(&stripped, is_sbn));

            for candidate in all_candidates {
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

/// Strip URL-cruft suffixes from a DOI candidate.
///
/// Removes query strings (`?...`), fragment identifiers (`#...`), and known
/// session/tracking parameters appended with `;` (e.g. `;jsessionid=...`,
/// `;token=...`). A bare trailing `;` is also trimmed.
///
/// Legitimate DOIs MAY contain internal semicolons (e.g. SICI-style DOIs like
/// `...3.0.CO;2-2`), so we only strip from a `;` that is followed by a known
/// URL-parameter pattern (`key=value`) or is the final character.
fn strip_doi_url_cruft(s: &str) -> &str {
    // 1. Strip from `?` onward (query string) — DOIs never contain `?`.
    let s = s.split('?').next().unwrap_or(s);

    // 2. Strip from `#` onward (fragment) — DOIs never contain `#`.
    let s = s.split('#').next().unwrap_or(s);

    // 3. Strip `;key=value` suffixes. Scan backwards for the leftmost `;`
    //    that starts a `key=value` parameter chain. A "parameter" matches
    //    `;<ascii-alphanumeric-or-dash>+=`.
    let bytes = s.as_bytes();
    let mut cut = s.len();
    // Walk backwards through semicolons
    loop {
        let search = &bytes[..cut];
        let pos = match search.iter().rposition(|&b| b == b';') {
            Some(p) => p,
            None => break,
        };
        let after = &s[pos + 1..cut];
        // Check if the segment after `;` looks like `key=value`
        if after.contains('=') {
            let key = after.split('=').next().unwrap_or("");
            if !key.is_empty()
                && key
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
            {
                cut = pos;
                continue;
            }
        }
        break;
    }
    let s = &s[..cut];

    // 4. Trim a bare trailing `;`
    s.strip_suffix(';').unwrap_or(s)
}

/// Run the shared DOI cleanup pipeline on a candidate string:
/// regex-extract, trim brackets, strip URL cruft, validate, lowercase.
fn clean_doi_match(candidate: &str) -> Option<String> {
    let m = DOI_EXTRACT_RE.find(candidate)?;
    let trimmed = trim_unbalanced_brackets(m.as_str());
    let trimmed = strip_doi_url_cruft(trimmed);
    if is_valid_doi(trimmed) {
        Some(trimmed.to_lowercase())
    } else {
        None
    }
}

/// Collapse `\n` between non-whitespace chars so line-wrapped DOIs become contiguous.
///
/// Only collapses when the line break looks like it falls *within* a DOI rather
/// than *between* a DOI and unrelated text.  Specifically, a `\n` is kept when:
///   - the following text starts a new DOI (`10.\d`), or
///   - the previous char is alphanumeric and the next char is uppercase
///     (indicates a word/sentence boundary, not a mid-DOI wrap).
fn collapse_doi_linebreaks(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut chars = text.char_indices().peekable();
    let mut prev_char: Option<char> = None;
    while let Some((i, ch)) = chars.next() {
        if ch == '\n' {
            if let (Some(pc), Some(&(_, next_ch))) = (prev_char, chars.peek()) {
                if !pc.is_whitespace() && !next_ch.is_whitespace() {
                    // Don't collapse if the following text starts a new DOI.
                    let rest = &text[i + 1..];
                    if rest.starts_with("10.")
                        && rest.as_bytes().get(3).is_some_and(|b| b.is_ascii_digit())
                    {
                        out.push('\n');
                        prev_char = Some('\n');
                        continue;
                    }
                    // Don't collapse at a word/sentence boundary: previous char
                    // is alphanumeric (end of a word) and next char is uppercase
                    // (start of a new word). Mid-DOI wraps happen after separators
                    // like '.', '-', '/', '(', ':', '<' which are not alphanumeric.
                    if pc.is_alphanumeric() && next_ch.is_uppercase() {
                        out.push('\n');
                        prev_char = Some('\n');
                        continue;
                    }
                    // Collapse: skip the \n, keep prev_char as-is.
                    continue;
                }
            }
        }
        prev_char = Some(ch);
        out.push(ch);
    }
    out
}

/// Extract a DOI from pages 0-1 via regex. Returns the lowercased DOI.
fn try_doi_regex(pages: &[String]) -> Option<String> {
    let limit = pages.len().min(2);
    for page in &pages[..limit] {
        let joined = collapse_doi_linebreaks(page);
        for m in DOI_EXTRACT_RE.find_iter(&joined) {
            if let Some(doi) = clean_doi_match(m.as_str()) {
                return Some(doi);
            }
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
            if let Some(doi) = clean_doi_match(&normalized) {
                return Some(doi);
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

/// Maximum number of continuation lines to collect after a JSTOR field label line.
/// Real JSTOR cover pages wrap field values over at most 2-3 lines. Capping here
/// prevents runaway collection when body text follows without a blank-line separator.
const MAX_JSTOR_CONTINUATION_LINES: usize = 3;

/// Known JSTOR cover-page field labels that act as block terminators.
const JSTOR_FIELD_LABELS: &[&str] = &[
    "Chapter Title",
    "Book Title",
    "Author(s)",
    "Source",
    "Published by",
    "Stable URL",
    "Accessed",
    "Your use of",
    "JSTOR is",
];

/// Extract the value of a labeled JSTOR field from the text.
///
/// Performs block parsing: captures from the label line through continuation
/// lines until a blank line or another known JSTOR label is encountered.
/// Tolerates optional whitespace before the colon (e.g. "Author(s) :").
fn extract_jstor_field(text: &str, label: &str) -> Option<String> {
    // Split the label into the part before ":" so we can match with optional
    // whitespace before the colon.  e.g. "Author(s):" -> prefix_before_colon = "Author(s)"
    let prefix_before_colon = label.strip_suffix(':').unwrap_or(label);

    let lines: Vec<&str> = text.lines().collect();
    let mut start_idx = None;
    let mut value_parts: Vec<&str> = Vec::new();

    // Pass 1: find the line that starts with the label (tolerating space before colon).
    for (i, line) in lines.iter().enumerate() {
        let trimmed = line.trim();
        if let Some(after_prefix) = trimmed.strip_prefix(prefix_before_colon) {
            // After the label text, expect optional whitespace then ":"
            let after_prefix = after_prefix.trim_start();
            if let Some(after_colon) = after_prefix.strip_prefix(':') {
                let first_value = after_colon.trim();
                if !first_value.is_empty() {
                    value_parts.push(first_value);
                }
                start_idx = Some(i);
                break;
            }
        }
    }

    let start_idx = start_idx?;

    // Pass 2: collect continuation lines until a terminator.
    for (continuation_count, line) in lines[start_idx + 1..].iter().enumerate() {
        let trimmed = line.trim();

        // Blank line terminates the block.
        if trimmed.is_empty() {
            break;
        }

        // Another known JSTOR field label terminates the block.
        let is_new_label = JSTOR_FIELD_LABELS.iter().any(|&lbl| {
            if let Some(rest) = trimmed.strip_prefix(lbl) {
                let rest = rest.trim_start();
                rest.starts_with(':')
            } else {
                false
            }
        });

        if is_new_label {
            break;
        }

        // Cap continuation lines to prevent runaway collection when body
        // text follows a field value without a blank-line separator.
        if continuation_count >= MAX_JSTOR_CONTINUATION_LINES {
            break;
        }

        value_parts.push(trimmed);
    }

    if value_parts.is_empty() {
        return None;
    }

    Some(value_parts.join(" "))
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
            LazyLock::new(|| Regex::new(r"\b(?:pp\.?|p\.)\s*(\d+(?:\s*-\s*\d+)?)").unwrap());
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

    // Trim trailing punctuation that the greedy \S+ may have captured
    // from surrounding sentence context (e.g. "…/stable/12345. Accessed").
    let stable_id = stable_id.trim_end_matches(['.', ',', ';']);
    let stable_id = trim_unbalanced_brackets(stable_id);

    // Derive DOI from stable ID
    let derived_doi = format!("10.2307/{}", stable_id);

    // Collect all valid DOI matches on the page (same pipeline as try_doi_regex)
    let all_dois: Vec<String> = DOI_EXTRACT_RE
        .find_iter(page0)
        .filter_map(|m| clean_doi_match(m.as_str()))
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

    // -- Finding 5: Line-wrapped ISBN tests --

    #[test]
    fn isbn_extract_line_wrapped() {
        // ISBN-13 split across a newline boundary
        let pages = vec!["ISBN 978-0-306-\n40615-7".to_string()];
        assert_eq!(try_isbn(&pages), Some("9780306406157".to_string()));
    }

    #[test]
    fn isbn_extract_line_wrapped_isbn10() {
        // ISBN-10 split across a newline
        let pages = vec!["ISBN 0-306-\n40615-2".to_string()];
        assert_eq!(try_isbn(&pages), Some("0306406152".to_string()));
    }

    #[test]
    fn isbn_extract_tab_separated() {
        // Tab character within an ISBN (e.g. from column-based PDF layout)
        let pages = vec!["ISBN 978-0-306\t40615-7".to_string()];
        assert_eq!(try_isbn(&pages), Some("9780306406157".to_string()));
    }

    #[test]
    fn isbn_extract_crlf_wrapped() {
        // CRLF line break within an ISBN
        let pages = vec!["ISBN 978-0-306-\r\n40615-7".to_string()];
        assert_eq!(try_isbn(&pages), Some("9780306406157".to_string()));
    }

    #[test]
    fn isbn_line_wrapped_pair_still_splits() {
        // Two ISBNs separated by newline -- should parse as two distinct ISBNs, not reject
        // (verifies split_whitespace still separates them)
        let pages = vec!["ISBN 978-0-306-40615-7\n978-0-262-03384-8".to_string()];
        let result = try_isbn(&pages);
        // First ISBN wins
        assert_eq!(result, Some("9780306406157".to_string()));
    }

    #[test]
    fn isbn_line_wrapped_multi_reject_still_works() {
        // 4 distinct ISBNs separated by newlines -- bibliography heuristic must still reject
        let pages = vec![
            "ISBN 978-0-306-40615-7\nISBN 978-0-262-03384-8\nISBN 978-0-13-468599-1\nISBN 978-0-321-12521-7".to_string()
        ];
        assert_eq!(try_isbn(&pages), None);
    }

    #[test]
    fn strip_isbn_separators_strips_whitespace() {
        // All whitespace variants should be stripped
        assert_eq!(strip_isbn_separators("978 0\t306\n40615\r\n7"), "9780306406157");
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

    // -- Finding 6: Info-dict ISBN whitespace regression tests --

    #[test]
    fn info_isbn_trailing_newline() {
        let mut info = HashMap::new();
        info.insert("isbn".to_string(), "978-0-306-40615-7\n".to_string());
        assert_eq!(try_info_isbn(&info), Some("9780306406157".to_string()));
    }

    #[test]
    fn info_isbn_trailing_tab() {
        let mut info = HashMap::new();
        info.insert("ISBN".to_string(), "978-0-306-40615-7\t".to_string());
        assert_eq!(try_info_isbn(&info), Some("9780306406157".to_string()));
    }

    #[test]
    fn info_isbn_surrounding_whitespace() {
        let mut info = HashMap::new();
        info.insert("isbn".to_string(), "  978-0-306-40615-7\r\n".to_string());
        assert_eq!(try_info_isbn(&info), Some("9780306406157".to_string()));
    }

    #[test]
    fn info_isbn_embedded_newline() {
        let mut info = HashMap::new();
        info.insert("isbn".to_string(), "978-0-306-\n40615-7".to_string());
        assert_eq!(try_info_isbn(&info), Some("9780306406157".to_string()));
    }

    #[test]
    fn info_isbn_nbsp_stripped() {
        let mut info = HashMap::new();
        info.insert("isbn".to_string(), "978-0-306\u{00A0}40615-7".to_string());
        assert_eq!(try_info_isbn(&info), Some("9780306406157".to_string()));
    }

    #[test]
    fn strip_isbn_separators_strips_unicode_whitespace() {
        // Non-breaking space (U+00A0) and thin space (U+2009)
        assert_eq!(strip_isbn_separators("978\u{00A0}0\u{2009}306-40615-7"), "9780306406157");
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

    // -- DOI line-wrap handling tests --

    #[test]
    fn doi_line_wrapped_rejoined() {
        let pages = vec!["doi: 10.1016/j.cell.\n2020.01.001".to_string()];
        assert_eq!(
            try_doi_regex(&pages),
            Some("10.1016/j.cell.2020.01.001".to_string()),
        );
    }

    #[test]
    fn doi_line_wrapped_with_hyphen() {
        let pages = vec!["10.1103/physrevlett.\n123.045701".to_string()];
        assert_eq!(
            try_doi_regex(&pages),
            Some("10.1103/physrevlett.123.045701".to_string()),
        );
    }

    #[test]
    fn doi_line_wrapped_only_first_two_pages() {
        let pages = vec![
            "nothing here".to_string(),
            "nothing here either".to_string(),
            "10.1016/j.cell.\n2020.01.001".to_string(),
        ];
        assert_eq!(try_doi_regex(&pages), None);
    }

    #[test]
    fn doi_invalid_after_trim_skipped() {
        // "(10.1234/)" -> regex matches "10.1234/)" -> trim_unbalanced_brackets -> "10.1234/"
        // is_valid_doi("10.1234/") is false (no suffix), so it's skipped.
        // The second DOI on the page is valid and returned.
        let pages = vec!["(10.1234/) see 10.1038/nature12373".to_string()];
        assert_eq!(
            try_doi_regex(&pages),
            Some("10.1038/nature12373".to_string()),
        );
    }

    #[test]
    fn doi_multiple_newline_wraps() {
        // DOI wraps at two points
        let pages = vec!["10.1016/j.\ncell.2020.\n01.001".to_string()];
        assert_eq!(
            try_doi_regex(&pages),
            Some("10.1016/j.cell.2020.01.001".to_string()),
        );
    }

    // -- DOI URL-cruft stripping tests --

    #[test]
    fn doi_jsessionid_stripped() {
        let pages = vec!["10.1000/xyz;jsessionid=ABC123".to_string()];
        assert_eq!(try_doi_regex(&pages), Some("10.1000/xyz".to_string()));
    }

    #[test]
    fn doi_trailing_bare_semicolon_stripped() {
        let pages = vec!["10.1000/xyz;".to_string()];
        assert_eq!(try_doi_regex(&pages), Some("10.1000/xyz".to_string()));
    }

    #[test]
    fn doi_jsessionid_case_insensitive() {
        let pages = vec!["10.1000/xyz;JSESSIONID=DEADBEEF".to_string()];
        assert_eq!(try_doi_regex(&pages), Some("10.1000/xyz".to_string()));
    }

    #[test]
    fn doi_with_legitimate_semicolon_preserved() {
        // Real DOI from Wiley SICI scheme — the ";2-2" at the end is part of the DOI.
        let pages = vec!["10.1002/(SICI)1097-0258(19980815)17:15<1661::AID-SIM968>3.0.CO;2-2".to_string()];
        assert_eq!(
            try_doi_regex(&pages),
            Some("10.1002/(sici)1097-0258(19980815)17:15<1661::aid-sim968>3.0.co;2-2".to_string()),
        );
    }

    #[test]
    fn doi_multiple_url_params_stripped() {
        let pages = vec!["10.1038/nature12373;token=XYZ;sid=abc".to_string()];
        assert_eq!(try_doi_regex(&pages), Some("10.1038/nature12373".to_string()));
    }

    #[test]
    fn doi_question_mark_query_stripped() {
        let pages = vec!["10.1038/nature12373?download=true".to_string()];
        assert_eq!(try_doi_regex(&pages), Some("10.1038/nature12373".to_string()));
    }

    #[test]
    fn doi_hash_fragment_stripped() {
        let pages = vec!["10.1038/nature12373#section2".to_string()];
        assert_eq!(try_doi_regex(&pages), Some("10.1038/nature12373".to_string()));
    }

    #[test]
    fn jstor_doi_url_cruft_stripped() {
        let pages = vec![
            "Stable URL: http://www.jstor.org/stable/12345\nDOI: 10.1086/599247;jsessionid=XYZ\n".to_string(),
        ];
        let (doi, _metadata) = try_jstor_cover(&pages);
        assert_eq!(doi, Some("10.1086/599247".to_string()));
    }

    // -- Finding 3: try_info_doi cleanup consistency tests --

    #[test]
    fn info_doi_trailing_junk_extracted() {
        let mut info = HashMap::new();
        info.insert(
            "doi".to_string(),
            "10.1038/nature12373 (Author accepted manuscript)".to_string(),
        );
        assert_eq!(
            try_info_doi(&info),
            Some("10.1038/nature12373".to_string()),
        );
    }

    #[test]
    fn info_doi_trailing_period_trimmed() {
        let mut info = HashMap::new();
        info.insert("doi".to_string(), "10.1038/nature12373.".to_string());
        assert_eq!(
            try_info_doi(&info),
            Some("10.1038/nature12373".to_string()),
        );
    }

    #[test]
    fn info_doi_trailing_comma_trimmed() {
        let mut info = HashMap::new();
        info.insert("doi".to_string(), "10.1016/j.cell.2020.01.001,".to_string());
        assert_eq!(
            try_info_doi(&info),
            Some("10.1016/j.cell.2020.01.001".to_string()),
        );
    }

    #[test]
    fn info_doi_url_cruft_stripped() {
        let mut info = HashMap::new();
        info.insert(
            "doi".to_string(),
            "10.1038/nature12373;jsessionid=ABC123".to_string(),
        );
        assert_eq!(
            try_info_doi(&info),
            Some("10.1038/nature12373".to_string()),
        );
    }

    #[test]
    fn info_doi_unbalanced_bracket_trimmed() {
        let mut info = HashMap::new();
        info.insert("doi".to_string(), "10.1000/xyz)".to_string());
        assert_eq!(
            try_info_doi(&info),
            Some("10.1000/xyz".to_string()),
        );
    }

    #[test]
    fn info_doi_https_with_trailing_junk() {
        let mut info = HashMap::new();
        info.insert(
            "doi".to_string(),
            "https://doi.org/10.1038/nature12373 retrieved 2024-01-01".to_string(),
        );
        assert_eq!(
            try_info_doi(&info),
            Some("10.1038/nature12373".to_string()),
        );
    }

    #[test]
    fn info_doi_query_string_stripped() {
        let mut info = HashMap::new();
        info.insert(
            "doi".to_string(),
            "https://doi.org/10.1038/nature12373?download=true".to_string(),
        );
        assert_eq!(
            try_info_doi(&info),
            Some("10.1038/nature12373".to_string()),
        );
    }

    // -- Finding 4: Mixed ISBN-10+13 concatenated pair tests --

    #[test]
    fn isbn_extract_mixed_10_then_13() {
        // ISBN-10 "0306406152" + space + ISBN-13 "9780306406157"
        // After stripping: 23 chars. Must split as 10+13.
        let pages = vec!["ISBN 0306406152 9780306406157".to_string()];
        assert_eq!(try_isbn(&pages), Some("0306406152".to_string()));
    }

    #[test]
    fn isbn_extract_mixed_13_then_10() {
        // ISBN-13 "9780306406157" + space + ISBN-10 "0306406152"
        // After stripping: 23 chars. Must split as 13+10.
        let pages = vec!["ISBN 9780306406157 0306406152".to_string()];
        assert_eq!(try_isbn(&pages), Some("9780306406157".to_string()));
    }

    #[test]
    fn isbn_extract_mixed_10x_then_13() {
        // ISBN-10 "0-8044-2957-X" + ISBN-13 "978-0-306-40615-7" with space
        let pages = vec!["ISBN 0-8044-2957-X 978-0-306-40615-7".to_string()];
        assert_eq!(try_isbn(&pages), Some("080442957X".to_string()));
    }

    #[test]
    fn isbn_extract_mixed_13_then_10x() {
        // ISBN-13 first, ISBN-10 with X second
        let pages = vec!["ISBN 978-0-306-40615-7 0-8044-2957-X".to_string()];
        assert_eq!(try_isbn(&pages), Some("9780306406157".to_string()));
    }

    // -- Concern 2: ISBN_RE quantifier must span hyphenated pairs --

    #[test]
    fn isbn_extract_hyphenated_13_pair() {
        // Two hyphenated ISBN-13s: print + ebook. 35 chars in the capture.
        // Before fix: second ISBN truncated to "978-0-262" (7 stripped digits), silently lost.
        let pages = vec!["ISBN 978-0-306-40615-7 978-0-262-03384-8".to_string()];
        let result = try_isbn(&pages);
        assert_eq!(result, Some("9780306406157".to_string()));
    }

    #[test]
    fn isbn_extract_hyphenated_10_13_pair() {
        // Hyphenated ISBN-10 (13 chars) + space + hyphenated ISBN-13 (17 chars) = 31 chars.
        let pages = vec!["ISBN 0-306-40615-2 978-0-262-03384-8".to_string()];
        let result = try_isbn(&pages);
        assert_eq!(result, Some("0306406152".to_string()));
    }

    #[test]
    fn isbn_extract_hyphenated_13_10_pair() {
        // Hyphenated ISBN-13 (17 chars) + space + hyphenated ISBN-10 (13 chars) = 31 chars.
        let pages = vec!["ISBN 978-0-262-03384-8 0-306-40615-2".to_string()];
        let result = try_isbn(&pages);
        assert_eq!(result, Some("9780262033848".to_string()));
    }

    #[test]
    fn isbn_extract_hyphenated_pair_both_counted() {
        // Two hyphenated pairs under separate ISBN prefixes = 4 distinct ISBNs.
        // If the second ISBN in each pair were truncated, only 2 would be found -> no reject.
        // After fix, all 4 are found -> bibliography heuristic rejects.
        let pages = vec![
            "ISBN 978-0-306-40615-7 978-0-262-03384-8 ISBN 978-0-13-468599-1 978-0-321-12521-7".to_string()
        ];
        assert_eq!(try_isbn(&pages), None);
    }

    #[test]
    fn isbn_extract_hyphenated_13_pair_endash() {
        // En-dash (\u{2013}) used as separator within ISBNs, space between the pair.
        let pages = vec!["ISBN 978\u{2013}0\u{2013}306\u{2013}40615\u{2013}7 978\u{2013}0\u{2013}262\u{2013}03384\u{2013}8".to_string()];
        let result = try_isbn(&pages);
        assert_eq!(result, Some("9780306406157".to_string()));
    }

    // -- Finding 7: ISSN_RE case-insensitive matching tests --

    #[test]
    fn issn_extract_lowercase_label() {
        // Lowercase "issn" label -- must match with (?i)
        let pages = vec!["issn 0317-8471".to_string()];
        assert_eq!(try_issn(&pages), Some("0317-8471".to_string()));
    }

    #[test]
    fn issn_extract_mixed_case_label() {
        // Mixed-case "Issn:" label
        let pages = vec!["Issn: 0028-0836".to_string()];
        assert_eq!(try_issn(&pages), Some("0028-0836".to_string()));
    }

    #[test]
    fn issn_extract_lowercase_x_check_digit() {
        // Lowercase x check digit -- regex must capture it, returned normalized to uppercase X
        let pages = vec!["ISSN 0001-253x".to_string()];
        assert_eq!(try_issn(&pages), Some("0001-253X".to_string()));
    }

    #[test]
    fn issn_extract_lowercase_label_and_x() {
        // Both label and check digit lowercase
        let pages = vec!["issn: 0001-253x".to_string()];
        assert_eq!(try_issn(&pages), Some("0001-253X".to_string()));
    }

    #[test]
    fn issn_extract_uppercase_x_unchanged() {
        // Uppercase X stays uppercase (non-regression for existing behavior)
        let pages = vec!["ISSN 0250-474X".to_string()];
        assert_eq!(try_issn(&pages), Some("0250-474X".to_string()));
    }

    #[test]
    fn issn_extract_numeric_check_digit_unchanged() {
        // Numeric check digit unaffected by normalization (non-regression)
        let pages = vec!["ISSN 0317-8471".to_string()];
        assert_eq!(try_issn(&pages), Some("0317-8471".to_string()));
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

    // -- Finding 8: JSTOR stable-URL trailing punctuation tests --

    #[test]
    fn jstor_stable_url_trailing_period_trimmed() {
        let pages = vec![
            "Stable URL: http://www.jstor.org/stable/12345. Accessed: 2024-01-01\n".to_string(),
        ];
        let (doi, _metadata) = try_jstor_cover(&pages);
        assert_eq!(doi, Some("10.2307/12345".to_string()));
    }

    #[test]
    fn jstor_stable_url_trailing_comma_trimmed() {
        let pages = vec![
            "Stable URL: http://www.jstor.org/stable/12345, retrieved 2024\n".to_string(),
        ];
        let (doi, _metadata) = try_jstor_cover(&pages);
        assert_eq!(doi, Some("10.2307/12345".to_string()));
    }

    #[test]
    fn jstor_stable_url_trailing_semicolon_trimmed() {
        let pages = vec![
            "Stable URL: http://www.jstor.org/stable/12345; see also\n".to_string(),
        ];
        let (doi, _metadata) = try_jstor_cover(&pages);
        assert_eq!(doi, Some("10.2307/12345".to_string()));
    }

    #[test]
    fn jstor_stable_url_trailing_close_paren_trimmed() {
        let pages = vec![
            "(Stable URL: http://www.jstor.org/stable/12345)\n".to_string(),
        ];
        let (doi, _metadata) = try_jstor_cover(&pages);
        assert_eq!(doi, Some("10.2307/12345".to_string()));
    }

    #[test]
    fn jstor_stable_url_multiple_trailing_punct_trimmed() {
        let pages = vec![
            "Stable URL: http://www.jstor.org/stable/12345.,\n".to_string(),
        ];
        let (doi, _metadata) = try_jstor_cover(&pages);
        assert_eq!(doi, Some("10.2307/12345".to_string()));
    }

    #[test]
    fn jstor_stable_url_clean_id_unchanged() {
        let pages = vec![
            "Stable URL: http://www.jstor.org/stable/12345\n".to_string(),
        ];
        let (doi, _metadata) = try_jstor_cover(&pages);
        assert_eq!(doi, Some("10.2307/12345".to_string()));
    }

    #[test]
    fn jstor_stable_url_hierarchical_id_preserved() {
        let pages = vec![
            "Stable URL: http://www.jstor.org/stable/j.ctt1pwtd1.8\n".to_string(),
        ];
        let (doi, _metadata) = try_jstor_cover(&pages);
        assert_eq!(doi, Some("10.2307/j.ctt1pwtd1.8".to_string()));
    }

    #[test]
    fn jstor_stable_url_hierarchical_id_trailing_period_trimmed() {
        let pages = vec![
            "Stable URL: http://www.jstor.org/stable/j.ctt1pwtd1.8. Accessed: 2024\n".to_string(),
        ];
        let (doi, _metadata) = try_jstor_cover(&pages);
        // Only the final trailing period is stripped; the ".8" is preserved because
        // trim_end_matches stops at the first non-matching char from the right.
        assert_eq!(doi, Some("10.2307/j.ctt1pwtd1.8".to_string()));
    }

    // -- Finding 9: PP_RE mis-capture on p-final words --

    #[test]
    fn jstor_source_pages_not_captured_from_workshop() {
        // "Workshop 12" must not be captured as pages
        let (_, _, pages, _) = parse_jstor_source(
            "History Workshop 12, Vol. 5, No. 2 (1998), pp. 100-130",
        );
        assert_eq!(pages, Some("100-130".to_string()));
    }

    #[test]
    fn jstor_source_pages_not_captured_from_group() {
        // "Group 3" must not be captured as pages
        let (_, _, pages, _) = parse_jstor_source(
            "Research Group 3 Review, Vol. 1, No. 4 (2005), pp. 45-67",
        );
        assert_eq!(pages, Some("45-67".to_string()));
    }

    #[test]
    fn jstor_source_pages_not_captured_from_top() {
        // "Top 10" must not be captured as pages
        let (_, _, pages, _) = parse_jstor_source(
            "Top 10 Digest, Vol. 2, No. 1 (2010), pp. 8-19",
        );
        assert_eq!(pages, Some("8-19".to_string()));
    }

    #[test]
    fn jstor_source_pages_pp_dot_range() {
        // Standard "pp." form
        let (_, _, pages, _) = parse_jstor_source(
            "The Journal, Vol. 98, No. 3 (Mar., 2001), pp. 5-28",
        );
        assert_eq!(pages, Some("5-28".to_string()));
    }

    #[test]
    fn jstor_source_pages_pp_no_dot() {
        // "pp" without dot (double-p form is unambiguous even without dot)
        let (_, _, pages, _) = parse_jstor_source(
            "The Journal, Vol. 12 (2001), pp 100-130",
        );
        assert_eq!(pages, Some("100-130".to_string()));
    }

    #[test]
    fn jstor_source_pages_p_dot_single() {
        // "p." single-page form
        let (_, _, pages, _) = parse_jstor_source(
            "The Journal, Vol. 5 (1999), p. 7",
        );
        assert_eq!(pages, Some("7".to_string()));
    }

    #[test]
    fn jstor_source_pages_bare_p_no_match() {
        // Bare "p" without dot must NOT match (too ambiguous)
        let (_, _, pages, _) = parse_jstor_source(
            "Appendix p 42",
        );
        assert_eq!(pages, None);
    }

    #[test]
    fn jstor_source_pages_single_page_pp_dot() {
        // "pp." with a single page number (no range)
        let (_, _, pages, _) = parse_jstor_source(
            "The Journal (2020), pp. 100",
        );
        assert_eq!(pages, Some("100".to_string()));
    }

    // -- Finding 10: JSTOR field extraction wrapped values + space-before-colon --

    #[test]
    fn jstor_source_field_wrapped_across_lines() {
        // Source value spans two lines; continuation has year + pages.
        let text = concat!(
            "Author(s): John Smith\n",
            "Source: The American Economic Review, Vol. 68, No. 5\n",
            "(Dec., 1978), pp. 101-112\n",
            "Published by: American Economic Association\n",
            "Stable URL: http://www.jstor.org/stable/1811098\n",
        );
        let result = extract_jstor_field(text, "Source:");
        assert_eq!(
            result,
            Some("The American Economic Review, Vol. 68, No. 5 (Dec., 1978), pp. 101-112".to_string()),
        );
    }

    #[test]
    fn jstor_author_field_space_before_colon() {
        // "Author(s) :" with a space before the colon -- must still match.
        let text = concat!(
            "Author(s) : Jane Doe\n",
            "Source: Some Journal, Vol. 1 (2000), pp. 1-10\n",
            "Stable URL: http://www.jstor.org/stable/99999\n",
        );
        let result = extract_jstor_field(text, "Author(s):");
        assert_eq!(result, Some("Jane Doe".to_string()));
    }

    #[test]
    fn jstor_source_field_three_continuation_lines() {
        // Value wraps over three lines before the next known label.
        let text = concat!(
            "Source: Proceedings of the National Academy\n",
            "of Sciences of the United States of America,\n",
            "Vol. 75, No. 12 (Dec., 1978), pp. 5913-5917\n",
            "Published by: National Academy of Sciences\n",
            "Stable URL: http://www.jstor.org/stable/68555\n",
        );
        let result = extract_jstor_field(text, "Source:");
        assert_eq!(
            result,
            Some("Proceedings of the National Academy of Sciences of the United States of America, Vol. 75, No. 12 (Dec., 1978), pp. 5913-5917".to_string()),
        );
    }

    #[test]
    fn jstor_field_terminated_by_blank_line() {
        // Continuation stops at a blank line even without a known label following.
        let text = concat!(
            "Source: The Journal of Philosophy, Vol. 2\n",
            "(Jan., 2005), pp. 30-50\n",
            "\n",
            "Some unrelated text\n",
        );
        let result = extract_jstor_field(text, "Source:");
        assert_eq!(
            result,
            Some("The Journal of Philosophy, Vol. 2 (Jan., 2005), pp. 30-50".to_string()),
        );
    }

    #[test]
    fn jstor_field_terminated_by_stable_url() {
        // "Stable URL:" acts as a terminator even without "Published by:" in between.
        let text = concat!(
            "Source: Short Journal, Vol. 1 (2000), pp. 1-5\n",
            "Stable URL: http://www.jstor.org/stable/12345\n",
        );
        let result = extract_jstor_field(text, "Source:");
        assert_eq!(
            result,
            Some("Short Journal, Vol. 1 (2000), pp. 1-5".to_string()),
        );
    }

    #[test]
    fn jstor_field_terminated_by_accessed() {
        // "Accessed:" terminates the block.
        let text = concat!(
            "Source: A Journal, Vol. 3\n",
            "(1999), pp. 10-20\n",
            "Accessed: 15-06-2024 10:30 UTC\n",
        );
        let result = extract_jstor_field(text, "Source:");
        assert_eq!(
            result,
            Some("A Journal, Vol. 3 (1999), pp. 10-20".to_string()),
        );
    }

    #[test]
    fn jstor_chapter_title_field_space_before_colon() {
        // "Chapter Title :" with space before colon.
        let text = concat!(
            "Chapter Title : The Big Idea\n",
            "Author(s): Someone\n",
            "Stable URL: http://www.jstor.org/stable/11111\n",
        );
        let result = extract_jstor_field(text, "Chapter Title:");
        assert_eq!(result, Some("The Big Idea".to_string()));
    }

    #[test]
    fn jstor_field_single_line_unchanged() {
        // Single-line field (no wrapping) -- must still work.
        let text = concat!(
            "Author(s): John Smith, Jane Doe\n",
            "Source: The Journal, Vol. 1 (2000), pp. 1-10\n",
            "Stable URL: http://www.jstor.org/stable/12345\n",
        );
        let result = extract_jstor_field(text, "Author(s):");
        assert_eq!(result, Some("John Smith, Jane Doe".to_string()));
    }

    #[test]
    fn jstor_field_not_found_returns_none() {
        // Label not present at all.
        let text = "Source: Something\nStable URL: http://www.jstor.org/stable/12345\n";
        let result = extract_jstor_field(text, "Chapter Title:");
        assert_eq!(result, None);
    }

    // -- Concern 3: JSTOR block field parser over-collects without terminator --

    #[test]
    fn jstor_field_continuation_cap_stops_body_text() {
        // "Chapter Title:" value on one line, followed immediately by body text
        // that has no blank line and no JSTOR label prefix.
        // Without the cap, all 5 body lines would be swallowed.
        let text = concat!(
            "Chapter Title: The Big Idea\n",
            "This is body text that follows without a blank line.\n",
            "It continues for several lines without any known label.\n",
            "More body text that should not be collected.\n",
            "Even more body text here.\n",
            "And yet more body text.\n",
            "Stable URL: http://www.jstor.org/stable/12345\n",
        );
        let result = extract_jstor_field(text, "Chapter Title:");
        // The value on the label line is captured, but body text beyond the
        // continuation cap (3 lines) must NOT be included.
        // With cap=3, collects: "This is body text..." (1), "It continues..." (2),
        // "More body text..." (3), then stops.
        assert_eq!(
            result,
            Some("The Big Idea This is body text that follows without a blank line. It continues for several lines without any known label. More body text that should not be collected.".to_string()),
        );
    }

    #[test]
    fn jstor_field_continuation_cap_allows_three() {
        // Source value wraps across exactly 3 continuation lines, all legitimate.
        let text = concat!(
            "Source: Proceedings of the National Academy\n",
            "of Sciences of the United States\n",
            "of America, Vol. 75, No. 12\n",
            "(Dec., 1978), pp. 5913-5917\n",
            "Published by: National Academy of Sciences\n",
        );
        let result = extract_jstor_field(text, "Source:");
        assert_eq!(
            result,
            Some("Proceedings of the National Academy of Sciences of the United States of America, Vol. 75, No. 12 (Dec., 1978), pp. 5913-5917".to_string()),
        );
    }

    #[test]
    fn jstor_field_continuation_cap_truncates_at_four() {
        // Source value appears to wrap over 4 continuation lines (no terminator until line 5).
        // Only the first 3 continuation lines should be collected.
        let text = concat!(
            "Source: Proceedings of the National Academy\n",
            "of Sciences of the United States\n",
            "of America, Vol. 75, No. 12\n",
            "(Dec., 1978), pp. 5913-5917\n",
            "Extra line that should be dropped\n",
            "Published by: National Academy of Sciences\n",
        );
        let result = extract_jstor_field(text, "Source:");
        // 4th continuation line ("Extra line...") is dropped
        assert_eq!(
            result,
            Some("Proceedings of the National Academy of Sciences of the United States of America, Vol. 75, No. 12 (Dec., 1978), pp. 5913-5917".to_string()),
        );
    }

    #[test]
    fn jstor_field_blank_line_before_cap() {
        // Blank line after 1 continuation line -- stops before cap.
        let text = concat!(
            "Source: Short Journal, Vol. 1\n",
            "(2000), pp. 1-5\n",
            "\n",
            "Body text that must not be collected.\n",
        );
        let result = extract_jstor_field(text, "Source:");
        assert_eq!(
            result,
            Some("Short Journal, Vol. 1 (2000), pp. 1-5".to_string()),
        );
    }

    #[test]
    fn jstor_field_label_terminator_before_cap() {
        // Known label after 1 continuation line -- stops before cap.
        let text = concat!(
            "Source: Short Journal, Vol. 1\n",
            "(2000), pp. 1-5\n",
            "Published by: Someone\n",
            "More text\n",
        );
        let result = extract_jstor_field(text, "Source:");
        assert_eq!(
            result,
            Some("Short Journal, Vol. 1 (2000), pp. 1-5".to_string()),
        );
    }

    // -- Concern 1: collapse_doi_linebreaks must not glue unrelated tokens --

    #[test]
    fn doi_collapse_does_not_glue_trailing_word() {
        // Scenario (a): DOI followed by unrelated capitalized word on next line.
        // "10.1234/abc" is a valid DOI; collapsing the \n would wrongly produce
        // "10.1234/abcNextword" which also passes is_valid_doi.
        let pages = vec!["see 10.1234/abc\nNextword more text".to_string()];
        assert_eq!(try_doi_regex(&pages), Some("10.1234/abc".to_string()));
    }

    #[test]
    fn doi_collapse_does_not_glue_adjacent_dois() {
        // Scenario (b): Two DOIs on adjacent lines in a reference list.
        // Must return the first DOI, not a bogus concatenation.
        let pages = vec!["10.1234/foo\n10.5678/bar".to_string()];
        assert_eq!(try_doi_regex(&pages), Some("10.1234/foo".to_string()));
    }

    #[test]
    fn doi_collapse_adjacent_dois_second_returned_when_first_invalid() {
        // Edge case of (b): first line is an invalid DOI prefix, second is valid.
        let pages = vec!["10.1234/\n10.5678/bar".to_string()];
        assert_eq!(try_doi_regex(&pages), Some("10.5678/bar".to_string()));
    }

    #[test]
    fn doi_collapse_preserves_wrap_after_separator() {
        // Non-regression: wrapping after '.' still collapses (existing behavior).
        let collapsed = collapse_doi_linebreaks("10.1016/j.cell.\n2020.01.001");
        assert_eq!(collapsed, "10.1016/j.cell.2020.01.001");
    }

    #[test]
    fn doi_collapse_preserves_wrap_after_slash() {
        // Wrapping after '/' is a legitimate DOI break point.
        let pages = vec!["10.1038/\nnature12373".to_string()];
        assert_eq!(
            try_doi_regex(&pages),
            Some("10.1038/nature12373".to_string()),
        );
    }

    #[test]
    fn doi_collapse_preserves_wrap_after_hyphen() {
        // Wrapping after '-' is a legitimate DOI break point.
        let pages = vec!["10.1103/physrev-\nlett.123".to_string()];
        assert_eq!(
            try_doi_regex(&pages),
            Some("10.1103/physrev-lett.123".to_string()),
        );
    }

    #[test]
    fn jstor_parses_metadata_wrapped_source() {
        let pages = vec![
            concat!(
                "Chapter Title: The Theory of Everything\n",
                "Author(s): John Smith, Jane Doe\n",
                "Source: The Journal of Philosophy, Vol. 98, No. 3\n",
                "(Mar., 2001), pp. 5-28\n",
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
    fn jstor_explicit_doi_validated() {
        // "10.1234/?query=value" on a JSTOR page: regex matches it, then
        // strip_doi_url_cruft removes "?query=value" leaving "10.1234/"
        // which fails is_valid_doi (no suffix after slash).
        // Before fix: returned as "10.1234/" (no validation).
        // After fix: rejected, falls back to derived 10.2307/12345.
        let pages = vec![
            "10.1234/?query=value Stable URL: http://www.jstor.org/stable/12345\n".to_string(),
        ];
        let (doi, _metadata) = try_jstor_cover(&pages);
        assert_eq!(doi, Some("10.2307/12345".to_string()));
    }

    #[test]
    fn jstor_explicit_doi_valid_still_wins() {
        // Valid explicit DOI must still win over derived 10.2307/... DOI.
        // (Non-regression for jstor_embedded_doi_wins.)
        let pages = vec![
            "Stable URL: http://www.jstor.org/stable/12345\n10.1086/599247\n".to_string(),
        ];
        let (doi, _metadata) = try_jstor_cover(&pages);
        assert_eq!(doi, Some("10.1086/599247".to_string()));
    }

    #[test]
    fn isbn10_to_isbn13_known_pair() {
        assert_eq!(
            isbn10_to_isbn13("0306406152"),
            Some("9780306406157".to_string())
        );
    }

    #[test]
    fn isbn10_to_isbn13_with_hyphens() {
        assert_eq!(
            isbn10_to_isbn13("0-306-40615-2"),
            Some("9780306406157".to_string())
        );
    }

    #[test]
    fn isbn10_to_isbn13_trailing_x() {
        assert_eq!(
            isbn10_to_isbn13("080442957X"),
            Some("9780804429573".to_string())
        );
    }

    #[test]
    fn isbn10_to_isbn13_wrong_length() {
        assert_eq!(isbn10_to_isbn13("12345"), None);
    }

    #[test]
    fn normalize_to_isbn13_passthrough_valid_13() {
        assert_eq!(
            normalize_to_isbn13("9780306406157"),
            Some("9780306406157".to_string())
        );
    }

    #[test]
    fn normalize_to_isbn13_converts_isbn10() {
        assert_eq!(
            normalize_to_isbn13("0306406152"),
            Some("9780306406157".to_string())
        );
    }

    #[test]
    fn normalize_to_isbn13_rejects_invalid_13() {
        assert_eq!(normalize_to_isbn13("9780306406158"), None);
    }

    #[test]
    fn normalize_to_isbn13_strips_hyphens() {
        assert_eq!(
            normalize_to_isbn13("978-0-306-40615-7"),
            Some("9780306406157".to_string())
        );
    }

    #[test]
    fn normalize_to_isbn13_rejects_x_in_isbn13() {
        // ISBN-13 never contains X; this must be rejected
        assert_eq!(normalize_to_isbn13("97803064X6157"), None);
    }

    #[test]
    fn normalize_to_isbn13_rejects_non_digit_bytes() {
        // Google Books OTHER identifiers like "AAAA.BBBB.CCC" must not panic
        assert_eq!(normalize_to_isbn13("AAAA.BBBB.CCC"), None);
    }

    #[test]
    fn normalize_to_isbn13_rejects_special_chars() {
        // 13 chars after stripping; contains + and , which are not separators
        assert_eq!(normalize_to_isbn13("97803+640,157"), None);
    }

    #[test]
    fn normalize_to_isbn13_rejects_parens_in_isbn13() {
        // 13 chars containing parentheses must not panic or pass
        assert_eq!(normalize_to_isbn13("9780(06406157"), None);
    }
}
