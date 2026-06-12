use crate::bib::cache::BibCache;
use crate::bib::convert::normalize_doi;
use crate::bib::parser::{ENTRY_RE, FIELD_RE, find_value_end};
use crate::bib::types::BibEntry;
use crate::commands::bib::scan_workspace_bibs;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::Write;
use std::path::Path;

/// Result for each entry passed to append_entries_to_file.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum SaveOutcome {
    /// Entry was appended to the file.
    Saved { key: String },
    /// Entry was skipped because its DOI already exists in the workspace.
    DuplicateDoi { doi: String, existing_key: String },
    /// Entry had no DOI and was appended unconditionally.
    SavedNoDoi { key: String },
}

/// Serialize a BibEntry to BibTeX string that round-trips through parse_bibtex.
pub fn serialize_bib_entry(entry: &BibEntry) -> String {
    let mut out = String::new();
    out.push_str(&format!("@{}{{{},\n", entry.entry_type, entry.key));

    // author (only if non-empty)
    if !entry.authors.is_empty() {
        out.push_str(&format!(
            "  author = {{{}}},\n",
            sanitize_bib_value(&entry.authors.join(" and "))
        ));
    }

    // title
    out.push_str(&format!("  title = {{{}}},\n", sanitize_bib_value(&entry.title)));

    // year (always emitted, even if empty)
    out.push_str(&format!("  year = {{{}}},\n", sanitize_bib_value(&entry.year)));

    // doi
    if let Some(ref doi) = entry.doi {
        out.push_str(&format!("  doi = {{{}}},\n", sanitize_bib_value(doi)));
    }

    // journal / booktitle (based on entry_type)
    if let Some(ref journal) = entry.journal {
        let field_name = match entry.entry_type.as_str() {
            "inproceedings" | "incollection" => "booktitle",
            _ => "journal",
        };
        out.push_str(&format!("  {} = {{{}}},\n", field_name, sanitize_bib_value(journal)));
    }

    // url
    if let Some(ref url) = entry.url {
        out.push_str(&format!("  url = {{{}}},\n", sanitize_bib_value(url)));
    }

    // file
    if let Some(ref file) = entry.file {
        out.push_str(&format!("  file = {{{}}},\n", sanitize_bib_value(file)));
    }

    // volume
    if let Some(ref volume) = entry.volume {
        out.push_str(&format!("  volume = {{{}}},\n", sanitize_bib_value(volume)));
    }

    // number
    if let Some(ref number) = entry.number {
        out.push_str(&format!("  number = {{{}}},\n", sanitize_bib_value(number)));
    }

    // pages
    if let Some(ref pages) = entry.pages {
        out.push_str(&format!("  pages = {{{}}},\n", sanitize_bib_value(pages)));
    }

    // publisher
    if let Some(ref publisher) = entry.publisher {
        out.push_str(&format!("  publisher = {{{}}},\n", sanitize_bib_value(publisher)));
    }

    // issn
    if let Some(ref issn) = entry.issn {
        out.push_str(&format!("  issn = {{{}}},\n", sanitize_bib_value(issn)));
    }

    // isbn
    if let Some(ref isbn) = entry.isbn {
        out.push_str(&format!("  isbn = {{{}}},\n", sanitize_bib_value(isbn)));
    }

    // abstract
    if let Some(ref abstract_text) = entry.abstract_text {
        out.push_str(&format!("  abstract = {{{}}},\n", sanitize_bib_value(abstract_text)));
    }

    // keywords (from tags)
    if !entry.tags.is_empty() {
        out.push_str(&format!("  keywords = {{{}}},\n", sanitize_bib_value(&entry.tags.join(", "))));
    }

    out.push('}');
    out
}

/// Generate a citation key from author surname + year.
/// `existing_keys` is consulted for collision avoidance: if "smith2020" exists,
/// returns "smith2020a"; if "smith2020a" exists too, returns "smith2020b", etc.
pub fn generate_key(authors: &[String], year: &str, existing_keys: &HashSet<String>) -> String {
    let last_name = authors.first().map(|a| {
        // "Family, Given" -> "Family"; "Given Family" -> "Family"; "WHO" -> "WHO"
        let name = if let Some(comma_pos) = a.find(',') {
            &a[..comma_pos]
        } else if let Some(space_pos) = a.rfind(' ') {
            &a[space_pos + 1..]
        } else {
            a.as_str()
        };
        // Lowercase and keep only ASCII alphanumeric
        name.chars()
            .filter(|c| c.is_ascii_alphanumeric())
            .collect::<String>()
            .to_lowercase()
    });

    let base = match (last_name.as_deref(), year.is_empty()) {
        (Some(name), false) if !name.is_empty() => format!("{}{}", name, year),
        (Some(name), true) if !name.is_empty() => name.to_string(),
        (_, false) => format!("unknown{}", year),
        _ => "unknown".to_string(),
    };

    if !existing_keys.contains(&base) {
        return base;
    }

    // Try suffixes a, b, c, ..., z, aa, ab, ...
    for i in 0u32.. {
        let suffix = suffix_from_index(i);
        let candidate = format!("{}{}", base, suffix);
        if !existing_keys.contains(&candidate) {
            return candidate;
        }
    }

    // Unreachable in practice
    base
}

/// Convert a 0-based index to a suffix: 0->"a", 1->"b", ..., 25->"z", 26->"aa", etc.
fn suffix_from_index(mut i: u32) -> String {
    let mut suffix = String::new();
    loop {
        suffix.insert(0, (b'a' + (i % 26) as u8) as char);
        if i < 26 {
            break;
        }
        i = i / 26 - 1;
    }
    suffix
}

/// Ensure a raw value has balanced braces before wrapping in `{…}`.
/// Strips unmatched `}` (closers with no opener) and unmatched `{`
/// (openers with no closer), preserving balanced pairs like `{LaTeX}`.
fn sanitize_bib_value(value: &str) -> String {
    let chars: Vec<char> = value.chars().collect();

    // Pass 1: find unmatched openers via a stack of opener indices.
    // Skip unmatched closers on the fly.
    let mut keep = vec![true; chars.len()];
    let mut opener_stack: Vec<usize> = Vec::new();
    for (i, &ch) in chars.iter().enumerate() {
        match ch {
            '{' => opener_stack.push(i),
            '}' => {
                if opener_stack.is_empty() {
                    keep[i] = false; // unmatched closer
                } else {
                    opener_stack.pop();
                }
            }
            _ => {}
        }
    }
    // Remaining items in opener_stack are unmatched openers
    for idx in opener_stack {
        keep[idx] = false;
    }

    chars
        .iter()
        .enumerate()
        .filter(|(i, _)| keep[*i])
        .map(|(_, &ch)| ch)
        .collect()
}

/// Append entries to `bib_path`, skipping entries whose DOI already exists
/// anywhere in the workspace. Returns one SaveOutcome per input entry.
/// `workspace_root` is used for the duplicate-DOI scan via scan_workspace_bibs.
pub fn append_entries_to_file(
    entries: &[BibEntry],
    bib_path: &Path,
    workspace_root: &Path,
    cache: &BibCache,
) -> Result<Vec<SaveOutcome>, String> {
    if entries.is_empty() {
        return Ok(Vec::new());
    }

    // Scan workspace for existing entries
    let existing = scan_workspace_bibs(workspace_root, cache);

    // Build DOI -> key map for duplicate detection
    let mut doi_map: HashMap<String, String> = HashMap::new();
    for e in &existing {
        if let Some(ref doi) = e.doi {
            let normalized = normalize_doi(doi);
            if !normalized.is_empty() {
                doi_map.entry(normalized).or_insert_with(|| e.key.clone());
            }
        }
    }

    // Build existing keys set for collision avoidance
    let mut existing_keys: HashSet<String> = existing.iter().map(|e| e.key.clone()).collect();

    let mut outcomes = Vec::with_capacity(entries.len());
    let mut serialized_entries = Vec::new();

    for entry in entries {
        // Check for duplicate DOI
        if let Some(ref doi) = entry.doi {
            let normalized = normalize_doi(doi);
            if !normalized.is_empty() {
                if let Some(existing_key) = doi_map.get(&normalized) {
                    outcomes.push(SaveOutcome::DuplicateDoi {
                        doi: normalized,
                        existing_key: existing_key.clone(),
                    });
                    continue;
                }
            }
        }

        // Generate a collision-free key
        let key = generate_key(&entry.authors, &entry.year, &existing_keys);
        existing_keys.insert(key.clone());

        // Also add the new DOI to the doi_map so subsequent entries in the
        // same batch can detect duplicates within the batch.
        if let Some(ref doi) = entry.doi {
            let normalized = normalize_doi(doi);
            if !normalized.is_empty() {
                doi_map.insert(normalized, key.clone());
            }
        }

        // Clone entry and set the generated key
        let mut new_entry = entry.clone();
        new_entry.key = key.clone();

        let bib_str = serialize_bib_entry(&new_entry);
        serialized_entries.push(bib_str);

        if entry.doi.is_some() {
            outcomes.push(SaveOutcome::Saved { key });
        } else {
            outcomes.push(SaveOutcome::SavedNoDoi { key });
        }
    }

    // Write serialized entries to the file
    if !serialized_entries.is_empty() {
        // Create parent directories if needed
        if let Some(parent) = bib_path.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("Failed to create directory: {}", e))?;
        }

        // Determine prefix: if file exists and has content, prepend \n\n
        let prefix = if bib_path.exists() {
            let existing_content = fs::read_to_string(bib_path)
                .map_err(|e| format!("Failed to read existing file: {}", e))?;
            if existing_content.is_empty() {
                String::new()
            } else if existing_content.ends_with('\n') {
                "\n".to_string()
            } else {
                "\n\n".to_string()
            }
        } else {
            String::new()
        };

        let mut file = fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(bib_path)
            .map_err(|e| format!("Failed to open file for writing: {}", e))?;

        let combined = format!(
            "{}{}",
            prefix,
            serialized_entries.join("\n\n")
        );

        file.write_all(combined.as_bytes())
            .map_err(|e| format!("Failed to write to file: {}", e))?;

        // Invalidate cache so subsequent scans pick up new entries
        cache.invalidate(&bib_path.to_path_buf());
    }

    Ok(outcomes)
}

/// Find the byte range `(start, end)` of the entry with the given `key` in `content`.
/// `start` is the byte offset of the `@` character; `end` is one past the closing `}`.
fn find_entry_span(content: &str, key: &str) -> Option<(usize, usize)> {
    let mut offset = 0;
    for line in content.split('\n') {
        if let Some(caps) = ENTRY_RE.captures(line) {
            let rest = &caps[2];
            if let Some(comma_idx) = rest.find(',') {
                let entry_key = rest[..comma_idx].trim();
                if entry_key == key {
                    let start = offset;
                    // Track brace depth from the first `{`
                    let brace_start = start + line.find('{').unwrap_or(0);
                    let mut depth: i32 = 0;
                    for (i, ch) in content[brace_start..].char_indices() {
                        if ch == '{' {
                            depth += 1;
                        } else if ch == '}' {
                            depth -= 1;
                            if depth == 0 {
                                return Some((start, brace_start + i + 1));
                            }
                        }
                    }
                    return None; // unbalanced braces
                }
            }
        }
        offset += line.len() + 1; // +1 for the '\n'
    }
    None
}

/// Find the byte range of a field line within `entry_text`.
/// Returns `(field_start, field_end)` where `field_start` is the byte offset of the
/// first character of the field name, and `field_end` is one past the trailing comma
/// or the last character of the value (including any newline).
fn find_field_span(entry_text: &str, field_name: &str) -> Option<(usize, usize)> {
    let mut search_start = 0;
    while search_start < entry_text.len() {
        let Some(caps) = FIELD_RE.captures(&entry_text[search_start..]) else {
            break;
        };
        let m = caps.get(0).unwrap();
        let matched_name = caps[1].to_lowercase();
        let abs_match_start = search_start + m.start();

        if matched_name == field_name.to_lowercase() {
            // Find the start of this line
            let line_start = entry_text[..abs_match_start]
                .rfind('\n')
                .map(|p| p + 1)
                .unwrap_or(0);

            let value_start = search_start + m.end();
            // Determine the value span
            if let Some(end) = find_value_end(entry_text, value_start) {
                // Include trailing comma and whitespace up to (including) newline
                let mut field_end = end;
                if field_end < entry_text.len()
                    && entry_text.as_bytes()[field_end] == b','
                {
                    field_end += 1;
                }
                // Skip trailing whitespace up to and including newline
                while field_end < entry_text.len() {
                    let ch = entry_text.as_bytes()[field_end];
                    if ch == b'\n' {
                        field_end += 1;
                        break;
                    } else if ch == b' ' || ch == b'\t' || ch == b'\r' {
                        field_end += 1;
                    } else {
                        break;
                    }
                }
                return Some((line_start, field_end));
            }
        }
        let value_start = search_start + m.end();
        if let Some(value_end) = find_value_end(entry_text, value_start) {
            search_start = value_end;
        } else {
            break;
        }
    }
    None
}

/// Update or insert fields in a BibTeX entry identified by `key`.
///
/// `new_fields` maps BibTeX field names (lowercase, e.g. "doi", "abstract") to
/// raw values (without `{}`  the function wraps them).
///
/// Returns `Ok(true)` if the file was modified, `Ok(false)` if all fields already
/// matched (idempotent no-op), or `Err` on I/O or parse failure.
pub fn update_entry_fields(
    bib_path: &Path,
    key: &str,
    new_fields: &HashMap<String, String>,
    cache: &BibCache,
) -> Result<bool, String> {
    let content = fs::read_to_string(bib_path)
        .map_err(|e| format!("Failed to read {}: {}", bib_path.display(), e))?;

    let (entry_start, entry_end) = find_entry_span(&content, key)
        .ok_or_else(|| format!("Entry '{}' not found in {}", key, bib_path.display()))?;

    let entry_text = &content[entry_start..entry_end];

    // Process fields: build a new entry text by applying replacements and insertions
    let mut result_entry = entry_text.to_string();
    let mut modified = false;

    // Sort field names for deterministic ordering of insertions
    let mut field_names: Vec<&String> = new_fields.keys().collect();
    field_names.sort();

    for field_name in field_names {
        let value = &new_fields[field_name];
        let new_field_line = format!("  {} = {{{}}},\n", field_name, sanitize_bib_value(value));

        if let Some((fs, fe)) = find_field_span(&result_entry, field_name) {
            // Check if existing value already matches
            let existing_line = &result_entry[fs..fe];
            if existing_line == new_field_line {
                continue;
            }
            result_entry.replace_range(fs..fe, &new_field_line);
            modified = true;
        } else {
            // Insert before the closing `}`
            let close_pos = result_entry.rfind('}').unwrap();
            // Ensure there's a newline before the closing brace
            let insert_pos = if close_pos > 0
                && result_entry.as_bytes()[close_pos - 1] != b'\n'
            {
                result_entry.insert(close_pos, '\n');
                close_pos
            } else {
                close_pos
            };
            result_entry.insert_str(insert_pos, &new_field_line);
            modified = true;
        }
    }

    if !modified {
        return Ok(false);
    }

    // Build the full new file content
    let new_content = format!(
        "{}{}{}",
        &content[..entry_start],
        result_entry,
        &content[entry_end..]
    );

    // Atomic write: write to tempfile in the same directory, then rename
    let parent = bib_path.parent().ok_or("Invalid bib path: no parent directory")?;
    let tmp = tempfile::NamedTempFile::new_in(parent)
        .map_err(|e| format!("Failed to create temp file: {}", e))?;
    fs::write(tmp.path(), &new_content)
        .map_err(|e| format!("Failed to write temp file: {}", e))?;
    tmp.persist(bib_path)
        .map_err(|e| format!("Failed to atomically replace {}: {}", bib_path.display(), e))?;

    cache.invalidate(&bib_path.to_path_buf());
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::bib::cache::BibCache;
    use crate::bib::parser::parse_bibtex;
    use crate::bib::types::BibEntry;
    use std::collections::HashSet;
    use std::fs;
    use tempfile::TempDir;

    /// Helper: create a BibEntry with all fields populated.
    fn full_entry() -> BibEntry {
        BibEntry {
            key: "smith2020".to_string(),
            authors: vec!["Smith, John".to_string(), "Doe, Jane".to_string()],
            title: "A Study of Things".to_string(),
            year: "2020".to_string(),
            entry_type: "article".to_string(),
            line_number: 0,
            bib_file: None,
            abstract_text: Some("Summary text".to_string()),
            doi: Some("10.1000/xyz".to_string()),
            journal: Some("Nature".to_string()),
            url: Some("https://example.com".to_string()),
            file: None,
            volume: Some("42".to_string()),
            number: Some("3".to_string()),
            pages: Some("100--115".to_string()),
            publisher: Some("Nature Publishing".to_string()),
            issn: None,
            isbn: None,
            tags: vec!["ml".to_string(), "nlp".to_string()],
        }
    }

    /// Helper: create a minimal BibEntry.
    fn minimal_entry() -> BibEntry {
        BibEntry {
            key: "minimal2020".to_string(),
            authors: vec![],
            title: "Minimal Title".to_string(),
            year: "2020".to_string(),
            entry_type: "misc".to_string(),
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
            tags: vec![],
        }
    }

    // ── Group 1: serialize_bib_entry ────────────────────────────────

    #[test]
    fn serialize_article_round_trips() {
        let entry = full_entry();
        let bib_str = serialize_bib_entry(&entry);
        let parsed = parse_bibtex(&bib_str);
        assert_eq!(parsed.len(), 1);
        let p = &parsed[0];
        assert_eq!(p.key, entry.key);
        assert_eq!(p.entry_type, entry.entry_type);
        assert_eq!(p.authors, entry.authors);
        assert_eq!(p.title, entry.title);
        assert_eq!(p.year, entry.year);
        assert_eq!(p.doi, entry.doi);
        assert_eq!(p.journal, entry.journal);
        assert_eq!(p.url, entry.url);
        assert_eq!(p.abstract_text, entry.abstract_text);
        assert_eq!(p.tags, entry.tags);
    }

    #[test]
    fn serialize_minimal_entry() {
        let entry = minimal_entry();
        let bib_str = serialize_bib_entry(&entry);
        let parsed = parse_bibtex(&bib_str);
        assert_eq!(parsed.len(), 1);
        let p = &parsed[0];
        assert_eq!(p.key, "minimal2020");
        assert_eq!(p.entry_type, "misc");
        assert_eq!(p.title, "Minimal Title");
        assert_eq!(p.year, "2020");
        assert!(p.authors.is_empty());
        assert_eq!(p.doi, None);
        assert_eq!(p.journal, None);
        assert_eq!(p.url, None);
        assert_eq!(p.abstract_text, None);
        assert!(p.tags.is_empty());
    }

    #[test]
    fn serialize_preserves_nested_braces() {
        let mut entry = minimal_entry();
        entry.title = "The {LaTeX} Way of {Formatting}".to_string();
        let bib_str = serialize_bib_entry(&entry);
        let parsed = parse_bibtex(&bib_str);
        assert_eq!(parsed[0].title, "The {LaTeX} Way of {Formatting}");
    }

    #[test]
    fn serialize_multiple_authors_joined_with_and() {
        let mut entry = minimal_entry();
        entry.authors = vec![
            "First, A.".to_string(),
            "Second, B.".to_string(),
            "Third, C.".to_string(),
        ];
        let bib_str = serialize_bib_entry(&entry);
        assert!(bib_str.contains("author = {First, A. and Second, B. and Third, C.}"));
        let parsed = parse_bibtex(&bib_str);
        assert_eq!(parsed[0].authors.len(), 3);
        assert_eq!(parsed[0].authors[0], "First, A.");
        assert_eq!(parsed[0].authors[1], "Second, B.");
        assert_eq!(parsed[0].authors[2], "Third, C.");
    }

    #[test]
    fn serialize_omits_none_fields() {
        let entry = minimal_entry();
        let bib_str = serialize_bib_entry(&entry);
        assert!(!bib_str.contains("doi"));
        assert!(!bib_str.contains("journal"));
        assert!(!bib_str.contains("booktitle"));
        assert!(!bib_str.contains("url"));
        assert!(!bib_str.contains("abstract"));
        assert!(!bib_str.contains("keywords"));
    }

    #[test]
    fn serialize_uses_booktitle_for_inproceedings() {
        let mut entry = minimal_entry();
        entry.entry_type = "inproceedings".to_string();
        entry.journal = Some("Conference Name".to_string());
        let bib_str = serialize_bib_entry(&entry);
        assert!(
            bib_str.contains("booktitle"),
            "inproceedings should use booktitle, got: {}",
            bib_str
        );
        assert!(
            !bib_str.contains("journal"),
            "inproceedings should not use journal field name"
        );
        // Parse back: parser falls back to booktitle for journal
        let parsed = parse_bibtex(&bib_str);
        assert_eq!(parsed[0].journal, Some("Conference Name".to_string()));
    }

    #[test]
    fn serialize_tags_as_keywords() {
        let mut entry = minimal_entry();
        entry.tags = vec!["ml".to_string(), "nlp".to_string()];
        let bib_str = serialize_bib_entry(&entry);
        assert!(bib_str.contains("keywords = {ml, nlp}"));
        let parsed = parse_bibtex(&bib_str);
        assert_eq!(parsed[0].tags, vec!["ml", "nlp"]);
    }

    #[test]
    fn serialize_empty_year() {
        let mut entry = minimal_entry();
        entry.year = "".to_string();
        let bib_str = serialize_bib_entry(&entry);
        assert!(bib_str.contains("year = {}"));
        let parsed = parse_bibtex(&bib_str);
        assert_eq!(parsed[0].year, "");
    }

    // ── Group 2: generate_key ───────────────────────────────────────

    #[test]
    fn generate_key_basic() {
        let keys = HashSet::new();
        assert_eq!(
            generate_key(&["Smith, John".to_string()], "2020", &keys),
            "smith2020"
        );
    }

    #[test]
    fn generate_key_no_author() {
        let keys = HashSet::new();
        assert_eq!(generate_key(&[], "2020", &keys), "unknown2020");
    }

    #[test]
    fn generate_key_no_year() {
        let keys = HashSet::new();
        assert_eq!(
            generate_key(&["Smith, John".to_string()], "", &keys),
            "smith"
        );
    }

    #[test]
    fn generate_key_no_author_no_year() {
        let keys = HashSet::new();
        assert_eq!(generate_key(&[], "", &keys), "unknown");
    }

    #[test]
    fn generate_key_collision_adds_suffix_a() {
        let keys: HashSet<String> = ["smith2020".to_string()].into();
        assert_eq!(
            generate_key(&["Smith, John".to_string()], "2020", &keys),
            "smith2020a"
        );
    }

    #[test]
    fn generate_key_collision_adds_suffix_b() {
        let keys: HashSet<String> =
            ["smith2020".to_string(), "smith2020a".to_string()].into();
        assert_eq!(
            generate_key(&["Smith, John".to_string()], "2020", &keys),
            "smith2020b"
        );
    }

    #[test]
    fn generate_key_literal_author() {
        let keys = HashSet::new();
        assert_eq!(
            generate_key(&["WHO".to_string()], "2020", &keys),
            "who2020"
        );
    }

    #[test]
    fn generate_key_first_last_format() {
        let keys = HashSet::new();
        assert_eq!(
            generate_key(&["John Smith".to_string()], "2020", &keys),
            "smith2020"
        );
    }

    #[test]
    fn generate_key_ascii_author() {
        let keys = HashSet::new();
        assert_eq!(
            generate_key(&["Muller, Hans".to_string()], "2020", &keys),
            "muller2020"
        );
    }

    #[test]
    fn generate_key_unicode_author_strips_non_ascii() {
        // "Muller" with umlaut -- non-ASCII chars should be stripped
        let keys = HashSet::new();
        assert_eq!(
            generate_key(&["M\u{00fc}ller, Hans".to_string()], "2020", &keys),
            "mller2020"
        );
    }

    #[test]
    fn generate_key_collision_on_unknown() {
        let keys: HashSet<String> = ["unknown2020".to_string()].into();
        assert_eq!(generate_key(&[], "2020", &keys), "unknown2020a");
    }

    // ── Group 2b: suffix_from_index ────────────────────────────────

    #[test]
    fn suffix_from_index_first_26() {
        assert_eq!(suffix_from_index(0), "a");
        assert_eq!(suffix_from_index(1), "b");
        assert_eq!(suffix_from_index(25), "z");
    }

    #[test]
    fn suffix_from_index_double_letter() {
        assert_eq!(suffix_from_index(26), "aa");
        assert_eq!(suffix_from_index(27), "ab");
        assert_eq!(suffix_from_index(51), "az");
        assert_eq!(suffix_from_index(52), "ba");
    }

    // ── Group 3: append_entries_to_file ─────────────────────────────

    #[test]
    fn append_to_new_file() {
        let dir = TempDir::new().unwrap();
        let bib_path = dir.path().join("refs.bib");
        let cache = BibCache::new();
        let mut entry = full_entry();
        entry.doi = Some("10.1000/new".to_string());

        let results =
            append_entries_to_file(&[entry], &bib_path, dir.path(), &cache).unwrap();

        assert_eq!(results.len(), 1);
        assert!(matches!(&results[0], SaveOutcome::Saved { key } if !key.is_empty()));
        let content = fs::read_to_string(&bib_path).unwrap();
        let parsed = parse_bibtex(&content);
        assert_eq!(parsed.len(), 1);
    }

    #[test]
    fn append_to_existing_file() {
        let dir = TempDir::new().unwrap();
        let bib_path = dir.path().join("refs.bib");
        let existing =
            "@article{doe2019,\n  author = {Doe, Jane},\n  title = {Existing},\n  year = {2019}\n}";
        fs::write(&bib_path, existing).unwrap();
        let cache = BibCache::new();

        let mut entry = full_entry();
        entry.doi = Some("10.1000/new".to_string());

        let results =
            append_entries_to_file(&[entry], &bib_path, dir.path(), &cache).unwrap();

        assert_eq!(results.len(), 1);
        let content = fs::read_to_string(&bib_path).unwrap();
        let parsed = parse_bibtex(&content);
        assert_eq!(parsed.len(), 2);
        // Existing entry must be unchanged
        assert!(parsed.iter().any(|e| e.key == "doe2019"));
    }

    #[test]
    fn append_skips_duplicate_doi() {
        let dir = TempDir::new().unwrap();
        let bib_path = dir.path().join("refs.bib");
        let existing = "@article{doe2019,\n  author = {Doe, Jane},\n  title = {Existing},\n  year = {2019},\n  doi = {10.1000/abc}\n}";
        fs::write(&bib_path, existing).unwrap();
        let cache = BibCache::new();

        let mut entry = full_entry();
        entry.doi = Some("10.1000/abc".to_string());

        let results =
            append_entries_to_file(&[entry], &bib_path, dir.path(), &cache).unwrap();

        assert_eq!(results.len(), 1);
        assert!(matches!(
            &results[0],
            SaveOutcome::DuplicateDoi { doi, existing_key }
            if doi == "10.1000/abc" && existing_key == "doe2019"
        ));
        // File should be unchanged
        let content = fs::read_to_string(&bib_path).unwrap();
        let parsed = parse_bibtex(&content);
        assert_eq!(parsed.len(), 1);
    }

    #[test]
    fn append_duplicate_doi_normalized() {
        let dir = TempDir::new().unwrap();
        let bib_path = dir.path().join("refs.bib");
        let existing = "@article{doe2019,\n  author = {Doe, Jane},\n  title = {Existing},\n  year = {2019},\n  doi = {10.1000/abc}\n}";
        fs::write(&bib_path, existing).unwrap();
        let cache = BibCache::new();

        let mut entry = full_entry();
        entry.doi = Some("https://doi.org/10.1000/abc".to_string());

        let results =
            append_entries_to_file(&[entry], &bib_path, dir.path(), &cache).unwrap();

        assert_eq!(results.len(), 1);
        assert!(matches!(&results[0], SaveOutcome::DuplicateDoi { .. }));
    }

    #[test]
    fn append_no_doi_always_saved() {
        let dir = TempDir::new().unwrap();
        let bib_path = dir.path().join("refs.bib");
        let cache = BibCache::new();

        let mut entry = full_entry();
        entry.doi = None;

        let results =
            append_entries_to_file(&[entry], &bib_path, dir.path(), &cache).unwrap();

        assert_eq!(results.len(), 1);
        assert!(matches!(&results[0], SaveOutcome::SavedNoDoi { key } if !key.is_empty()));
        assert!(bib_path.exists());
    }

    #[test]
    fn append_generates_collision_free_key() {
        let dir = TempDir::new().unwrap();
        let bib_path = dir.path().join("refs.bib");
        let existing = "@article{smith2020,\n  author = {Smith, John},\n  title = {Existing},\n  year = {2020},\n  doi = {10.1000/existing}\n}";
        fs::write(&bib_path, existing).unwrap();
        let cache = BibCache::new();

        let mut entry = full_entry();
        entry.authors = vec!["Smith, Alice".to_string()];
        entry.year = "2020".to_string();
        entry.doi = Some("10.1000/new".to_string());

        let results =
            append_entries_to_file(&[entry], &bib_path, dir.path(), &cache).unwrap();

        assert_eq!(results.len(), 1);
        assert!(matches!(
            &results[0],
            SaveOutcome::Saved { key } if key == "smith2020a"
        ));
    }

    #[test]
    fn append_batch_deduplicates_within_batch() {
        let dir = TempDir::new().unwrap();
        let bib_path = dir.path().join("refs.bib");
        let cache = BibCache::new();

        let mut entry1 = full_entry();
        entry1.authors = vec!["Smith, John".to_string()];
        entry1.year = "2020".to_string();
        entry1.doi = Some("10.1000/first".to_string());

        let mut entry2 = full_entry();
        entry2.authors = vec!["Smith, Alice".to_string()];
        entry2.year = "2020".to_string();
        entry2.doi = Some("10.1000/second".to_string());

        let results =
            append_entries_to_file(&[entry1, entry2], &bib_path, dir.path(), &cache)
                .unwrap();

        assert_eq!(results.len(), 2);
        // First gets "smith2020", second gets "smith2020a"
        assert!(matches!(
            &results[0],
            SaveOutcome::Saved { key } if key == "smith2020"
        ));
        assert!(matches!(
            &results[1],
            SaveOutcome::Saved { key } if key == "smith2020a"
        ));
    }

    #[test]
    fn append_batch_mixed_outcomes() {
        let dir = TempDir::new().unwrap();
        let bib_path = dir.path().join("refs.bib");
        let existing = "@article{doe2019,\n  author = {Doe, Jane},\n  title = {Existing},\n  year = {2019},\n  doi = {10.1000/dup}\n}";
        fs::write(&bib_path, existing).unwrap();
        let cache = BibCache::new();

        // Entry 1: duplicate DOI
        let mut dup = full_entry();
        dup.doi = Some("10.1000/dup".to_string());

        // Entry 2: new DOI
        let mut with_doi = full_entry();
        with_doi.doi = Some("10.1000/new".to_string());

        // Entry 3: no DOI
        let mut no_doi = full_entry();
        no_doi.doi = None;

        let results =
            append_entries_to_file(&[dup, with_doi, no_doi], &bib_path, dir.path(), &cache)
                .unwrap();

        assert_eq!(results.len(), 3);
        assert!(matches!(&results[0], SaveOutcome::DuplicateDoi { .. }));
        assert!(matches!(&results[1], SaveOutcome::Saved { .. }));
        assert!(matches!(&results[2], SaveOutcome::SavedNoDoi { .. }));
    }

    #[test]
    fn append_invalidates_cache() {
        let dir = TempDir::new().unwrap();
        let bib_path = dir.path().join("refs.bib");
        let cache = BibCache::new();

        // First scan: empty workspace
        let entries1 =
            crate::commands::bib::scan_workspace_bibs(dir.path(), &cache);
        assert!(entries1.is_empty());

        // Append an entry
        let mut entry = full_entry();
        entry.doi = Some("10.1000/new".to_string());
        append_entries_to_file(&[entry], &bib_path, dir.path(), &cache).unwrap();

        // Second scan with same cache should find the new entry
        let entries2 =
            crate::commands::bib::scan_workspace_bibs(dir.path(), &cache);
        assert!(
            !entries2.is_empty(),
            "cache should have been invalidated; new entry should appear"
        );
    }

    #[test]
    fn append_empty_input_returns_empty() {
        let dir = TempDir::new().unwrap();
        let bib_path = dir.path().join("refs.bib");
        let cache = BibCache::new();

        let results =
            append_entries_to_file(&[], &bib_path, dir.path(), &cache).unwrap();

        assert!(results.is_empty());
        assert!(!bib_path.exists(), "file should not be created for empty input");
    }

    #[test]
    fn append_creates_parent_dirs() {
        let dir = TempDir::new().unwrap();
        let bib_path = dir.path().join("subdir").join("deep").join("refs.bib");
        let cache = BibCache::new();

        let mut entry = full_entry();
        entry.doi = Some("10.1000/new".to_string());

        let results =
            append_entries_to_file(&[entry], &bib_path, dir.path(), &cache).unwrap();

        assert_eq!(results.len(), 1);
        assert!(bib_path.exists());
    }

    // ── Group 4: update_entry_fields ───────────────────────────────

    #[test]
    fn update_new_field_inserted() {
        let dir = TempDir::new().unwrap();
        let bib_path = dir.path().join("refs.bib");
        let content = "@article{smith2024,\n  author = {Smith},\n  title = {Alpha},\n  year = {2024}\n}\n";
        fs::write(&bib_path, content).unwrap();
        let cache = BibCache::new();

        let mut fields = HashMap::new();
        fields.insert("doi".to_string(), "10.1000/xyz".to_string());

        let result = update_entry_fields(&bib_path, "smith2024", &fields, &cache).unwrap();
        assert!(result, "should return true when file is modified");

        let updated = fs::read_to_string(&bib_path).unwrap();
        let parsed = parse_bibtex(&updated);
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].doi, Some("10.1000/xyz".to_string()));
        assert_eq!(parsed[0].title, "Alpha");
        assert_eq!(parsed[0].year, "2024");
        assert_eq!(parsed[0].authors, vec!["Smith"]);
    }

    #[test]
    fn update_existing_field_replaced() {
        let dir = TempDir::new().unwrap();
        let bib_path = dir.path().join("refs.bib");
        let content = "@article{smith2024,\n  title = {Old Title},\n  year = {2024}\n}\n";
        fs::write(&bib_path, content).unwrap();
        let cache = BibCache::new();

        let mut fields = HashMap::new();
        fields.insert("title".to_string(), "New Title".to_string());

        let result = update_entry_fields(&bib_path, "smith2024", &fields, &cache).unwrap();
        assert!(result);

        let updated = fs::read_to_string(&bib_path).unwrap();
        let parsed = parse_bibtex(&updated);
        assert_eq!(parsed[0].title, "New Title");
        assert_eq!(parsed[0].year, "2024");
    }

    #[test]
    fn update_idempotent_no_write() {
        let dir = TempDir::new().unwrap();
        let bib_path = dir.path().join("refs.bib");
        let content = "@article{smith2024,\n  title = {Alpha},\n  year = {2024},\n  doi = {10.1/x},\n}\n";
        fs::write(&bib_path, content).unwrap();
        let cache = BibCache::new();

        let mut fields = HashMap::new();
        fields.insert("doi".to_string(), "10.1/x".to_string());

        let result = update_entry_fields(&bib_path, "smith2024", &fields, &cache).unwrap();
        assert!(!result, "should return false when nothing changed");
    }

    #[test]
    fn update_multiple_fields() {
        let dir = TempDir::new().unwrap();
        let bib_path = dir.path().join("refs.bib");
        let content = "@article{smith2024,\n  author = {Smith},\n  title = {Alpha},\n  year = {2024}\n}\n";
        fs::write(&bib_path, content).unwrap();
        let cache = BibCache::new();

        let mut fields = HashMap::new();
        fields.insert("doi".to_string(), "10.1/x".to_string());
        fields.insert("abstract".to_string(), "Summary text".to_string());
        fields.insert("url".to_string(), "https://example.com".to_string());

        let result = update_entry_fields(&bib_path, "smith2024", &fields, &cache).unwrap();
        assert!(result);

        let updated = fs::read_to_string(&bib_path).unwrap();
        let parsed = parse_bibtex(&updated);
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].doi, Some("10.1/x".to_string()));
        assert_eq!(parsed[0].abstract_text, Some("Summary text".to_string()));
        assert_eq!(parsed[0].url, Some("https://example.com".to_string()));
        assert_eq!(parsed[0].title, "Alpha");
    }

    #[test]
    fn update_preserves_other_entries() {
        let dir = TempDir::new().unwrap();
        let bib_path = dir.path().join("refs.bib");
        let entry1 = "@article{smith2024,\n  author = {Smith},\n  title = {Alpha},\n  year = {2024}\n}";
        let entry2 = "@article{doe2023,\n  author = {Doe},\n  title = {Beta},\n  year = {2023}\n}";
        let content = format!("{}\n\n{}\n", entry1, entry2);
        fs::write(&bib_path, &content).unwrap();
        let cache = BibCache::new();

        let mut fields = HashMap::new();
        fields.insert("doi".to_string(), "10.1/x".to_string());

        update_entry_fields(&bib_path, "smith2024", &fields, &cache).unwrap();

        let updated = fs::read_to_string(&bib_path).unwrap();
        // doe2023 entry should be byte-for-byte unchanged
        assert!(
            updated.contains(entry2),
            "doe2023 entry should be preserved verbatim, got: {}",
            updated
        );
        let parsed = parse_bibtex(&updated);
        assert_eq!(parsed.len(), 2);
        assert_eq!(parsed[1].key, "doe2023");
        assert_eq!(parsed[1].title, "Beta");
    }

    #[test]
    fn update_key_not_found() {
        let dir = TempDir::new().unwrap();
        let bib_path = dir.path().join("refs.bib");
        let content = "@article{smith2024,\n  title = {Alpha},\n  year = {2024}\n}\n";
        fs::write(&bib_path, content).unwrap();
        let cache = BibCache::new();

        let mut fields = HashMap::new();
        fields.insert("doi".to_string(), "10.1/x".to_string());

        let result = update_entry_fields(&bib_path, "nonexistent", &fields, &cache);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("not found"));
    }

    #[test]
    fn update_empty_file() {
        let dir = TempDir::new().unwrap();
        let bib_path = dir.path().join("refs.bib");
        fs::write(&bib_path, "").unwrap();
        let cache = BibCache::new();

        let mut fields = HashMap::new();
        fields.insert("doi".to_string(), "10.1/x".to_string());

        let result = update_entry_fields(&bib_path, "anything", &fields, &cache);
        assert!(result.is_err());
    }

    #[test]
    fn update_file_not_found() {
        let dir = TempDir::new().unwrap();
        let bib_path = dir.path().join("nonexistent.bib");
        let cache = BibCache::new();

        let mut fields = HashMap::new();
        fields.insert("doi".to_string(), "10.1/x".to_string());

        let result = update_entry_fields(&bib_path, "anything", &fields, &cache);
        assert!(result.is_err());
    }

    #[test]
    fn update_cache_invalidated() {
        let dir = TempDir::new().unwrap();
        let bib_path = dir.path().join("refs.bib");
        let content = "@article{smith2024,\n  author = {Smith},\n  title = {Alpha},\n  year = {2024}\n}\n";
        fs::write(&bib_path, content).unwrap();
        let cache = BibCache::new();

        // Prime the cache
        let mtime = fs::metadata(&bib_path).unwrap().modified().unwrap();
        let initial = cache.get_or_parse(&bib_path.to_path_buf(), &content, mtime);
        assert_eq!(initial.len(), 1);
        assert_eq!(initial[0].doi, None);

        // Update a field
        let mut fields = HashMap::new();
        fields.insert("doi".to_string(), "10.1/x".to_string());
        update_entry_fields(&bib_path, "smith2024", &fields, &cache).unwrap();

        // Cache should be invalidated; re-parse should see the new field
        let new_content = fs::read_to_string(&bib_path).unwrap();
        let new_mtime = fs::metadata(&bib_path).unwrap().modified().unwrap();
        let refreshed = cache.get_or_parse(&bib_path.to_path_buf(), &new_content, new_mtime);
        assert_eq!(refreshed.len(), 1);
        assert_eq!(refreshed[0].doi, Some("10.1/x".to_string()));
    }

    #[test]
    fn update_atomic_write_preserves_on_success() {
        let dir = TempDir::new().unwrap();
        let bib_path = dir.path().join("refs.bib");
        let content = "@article{smith2024,\n  author = {Smith},\n  title = {Alpha},\n  year = {2024}\n}\n";
        fs::write(&bib_path, content).unwrap();
        let cache = BibCache::new();

        let mut fields = HashMap::new();
        fields.insert("doi".to_string(), "10.1/x".to_string());
        update_entry_fields(&bib_path, "smith2024", &fields, &cache).unwrap();

        let updated = fs::read_to_string(&bib_path).unwrap();
        let parsed = parse_bibtex(&updated);
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].key, "smith2024");
        assert_eq!(parsed[0].doi, Some("10.1/x".to_string()));
        assert_eq!(parsed[0].title, "Alpha");
        assert_eq!(parsed[0].authors, vec!["Smith"]);
        assert_eq!(parsed[0].year, "2024");
    }

    #[test]
    fn update_mixed_insert_and_replace() {
        let dir = TempDir::new().unwrap();
        let bib_path = dir.path().join("refs.bib");
        let content = "@article{smith2024,\n  title = {Alpha},\n  year = {2024},\n  doi = {old},\n}\n";
        fs::write(&bib_path, content).unwrap();
        let cache = BibCache::new();

        let mut fields = HashMap::new();
        fields.insert("doi".to_string(), "new".to_string());
        fields.insert("url".to_string(), "https://new.com".to_string());

        let result = update_entry_fields(&bib_path, "smith2024", &fields, &cache).unwrap();
        assert!(result);

        let updated = fs::read_to_string(&bib_path).unwrap();
        let parsed = parse_bibtex(&updated);
        assert_eq!(parsed[0].doi, Some("new".to_string()));
        assert_eq!(parsed[0].url, Some("https://new.com".to_string()));
    }

    #[test]
    fn update_field_with_braces_in_value() {
        let dir = TempDir::new().unwrap();
        let bib_path = dir.path().join("refs.bib");
        let content = "@article{smith2024,\n  title = {Alpha},\n  year = {2024}\n}\n";
        fs::write(&bib_path, content).unwrap();
        let cache = BibCache::new();

        let mut fields = HashMap::new();
        fields.insert("title".to_string(), "The {LaTeX} Approach".to_string());

        update_entry_fields(&bib_path, "smith2024", &fields, &cache).unwrap();

        let updated = fs::read_to_string(&bib_path).unwrap();
        let parsed = parse_bibtex(&updated);
        assert_eq!(parsed[0].title, "The {LaTeX} Approach");
    }

    #[test]
    fn serialize_full_entry_round_trips_new_fields() {
        let mut entry = full_entry();
        entry.volume = Some("42".to_string());
        entry.number = Some("3".to_string());
        entry.pages = Some("100--115".to_string());
        entry.publisher = Some("Nature Publishing".to_string());
        entry.issn = Some("0028-0836".to_string());
        let bib_str = serialize_bib_entry(&entry);
        let parsed = parse_bibtex(&bib_str);
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].volume, Some("42".to_string()));
        assert_eq!(parsed[0].number, Some("3".to_string()));
        assert_eq!(parsed[0].pages, Some("100--115".to_string()));
        assert_eq!(parsed[0].publisher, Some("Nature Publishing".to_string()));
        assert_eq!(parsed[0].issn, Some("0028-0836".to_string()));
    }

    #[test]
    fn serialize_omits_none_new_fields() {
        let entry = minimal_entry();
        let bib_str = serialize_bib_entry(&entry);
        assert!(!bib_str.contains("volume"));
        assert!(!bib_str.contains("number"));
        assert!(!bib_str.contains("pages"));
        assert!(!bib_str.contains("publisher"));
        assert!(!bib_str.contains("issn"));
    }

    #[test]
    fn serialize_issn_round_trips() {
        let mut entry = minimal_entry();
        entry.issn = Some("1234-5678".to_string());
        let bib_str = serialize_bib_entry(&entry);
        let parsed = parse_bibtex(&bib_str);
        assert_eq!(parsed[0].issn, Some("1234-5678".to_string()));
    }

    // ── Group 5: find_field_span field-name-inside-value regression ──

    #[test]
    fn find_field_span_skips_field_name_inside_braced_value() {
        let entry = "@article{test2024,\n  abstract = {where volume = 5 is noted},\n  title = {Test},\n  year = {2024}\n}";
        assert_eq!(find_field_span(entry, "volume"), None);
    }

    #[test]
    fn find_field_span_finds_real_field_after_value_containing_name() {
        let entry = "@article{test2024,\n  abstract = {where volume = 5 is noted},\n  volume = {10},\n  title = {Test},\n  year = {2024}\n}";
        let (start, end) = find_field_span(entry, "volume").expect("should find real volume field");
        let span = &entry[start..end];
        assert!(
            span.contains("volume = {10}"),
            "span should contain the real volume field, got: {:?}",
            span
        );
        assert!(
            !span.contains("abstract"),
            "span should not contain abstract text"
        );
    }

    #[test]
    fn find_field_span_skips_field_name_inside_quoted_value() {
        let entry = "@article{test2024,\n  note = \"see volume = 3 for details\",\n  title = {Test},\n  year = {2024}\n}";
        assert_eq!(find_field_span(entry, "volume"), None);
    }

    #[test]
    fn update_insert_field_whose_name_appears_inside_existing_value() {
        let dir = TempDir::new().unwrap();
        let bib_path = dir.path().join("refs.bib");
        let content = "@article{test2024,\n  abstract = {discusses how volume = 5 affects outcomes},\n  title = {Test},\n  year = {2024}\n}\n";
        fs::write(&bib_path, content).unwrap();
        let cache = BibCache::new();

        let mut fields = HashMap::new();
        fields.insert("volume".to_string(), "10".to_string());

        update_entry_fields(&bib_path, "test2024", &fields, &cache).unwrap();

        let updated = fs::read_to_string(&bib_path).unwrap();
        let parsed = parse_bibtex(&updated);
        assert_eq!(parsed.len(), 1);
        assert_eq!(
            parsed[0].abstract_text,
            Some("discusses how volume = 5 affects outcomes".to_string()),
            "abstract must be unchanged"
        );
        assert_eq!(
            parsed[0].volume,
            Some("10".to_string()),
            "volume should be inserted as a new field"
        );
    }

    #[test]
    fn update_replace_field_after_value_containing_field_name_pattern() {
        let dir = TempDir::new().unwrap();
        let bib_path = dir.path().join("refs.bib");
        let content = "@article{test2024,\n  abstract = {where doi = 10.1000/fake is cited},\n  doi = {10.1000/real},\n  title = {Test},\n  year = {2024}\n}\n";
        fs::write(&bib_path, content).unwrap();
        let cache = BibCache::new();

        let mut fields = HashMap::new();
        fields.insert("doi".to_string(), "10.1000/updated".to_string());

        update_entry_fields(&bib_path, "test2024", &fields, &cache).unwrap();

        let updated = fs::read_to_string(&bib_path).unwrap();
        let parsed = parse_bibtex(&updated);
        assert_eq!(parsed.len(), 1);
        assert_eq!(
            parsed[0].abstract_text,
            Some("where doi = 10.1000/fake is cited".to_string()),
            "abstract must be unchanged"
        );
        assert_eq!(
            parsed[0].doi,
            Some("10.1000/updated".to_string()),
            "doi should be updated to the new value"
        );
    }

    #[test]
    fn update_preserves_formatting_of_untouched_fields() {
        let dir = TempDir::new().unwrap();
        let bib_path = dir.path().join("refs.bib");
        // Custom formatting: 4-space indent, tab indent
        let content = "@article{smith2024,\n    author = {Smith},\n\ttitle = {Alpha},\n    year = {2024}\n}\n";
        fs::write(&bib_path, content).unwrap();
        let cache = BibCache::new();

        let mut fields = HashMap::new();
        fields.insert("doi".to_string(), "10.1/x".to_string());

        update_entry_fields(&bib_path, "smith2024", &fields, &cache).unwrap();

        let updated = fs::read_to_string(&bib_path).unwrap();
        // The author and year lines should be preserved with their original formatting
        assert!(
            updated.contains("    author = {Smith},"),
            "4-space author line should be preserved, got: {}",
            updated
        );
        assert!(
            updated.contains("\ttitle = {Alpha},"),
            "tab-indented title line should be preserved, got: {}",
            updated
        );
        assert!(
            updated.contains("    year = {2024}"),
            "4-space year line should be preserved, got: {}",
            updated
        );
    }

    // ── Group 6: sanitize_bib_value ───────────────────────────────

    #[test]
    fn sanitize_bib_value_strips_lone_closer() {
        assert_eq!(
            sanitize_bib_value("text with } stray closer"),
            "text with  stray closer"
        );
    }

    #[test]
    fn sanitize_bib_value_strips_lone_opener() {
        assert_eq!(
            sanitize_bib_value("text with { stray opener"),
            "text with  stray opener"
        );
    }

    #[test]
    fn sanitize_bib_value_preserves_balanced_braces() {
        assert_eq!(
            sanitize_bib_value("The {LaTeX} Way of {Formatting}"),
            "The {LaTeX} Way of {Formatting}"
        );
    }

    #[test]
    fn sanitize_bib_value_mixed_balanced_and_unmatched() {
        assert_eq!(
            sanitize_bib_value("a {b} c } d { e {f} g"),
            "a {b} c  d  e {f} g"
        );
    }

    #[test]
    fn sanitize_bib_value_empty_and_no_braces() {
        assert_eq!(sanitize_bib_value(""), "");
        assert_eq!(sanitize_bib_value("no braces here"), "no braces here");
    }

    #[test]
    fn serialize_bib_entry_sanitizes_stray_closer_in_abstract() {
        let mut entry = minimal_entry();
        entry.abstract_text = Some("ratio a/b} is large".to_string());
        let bib_str = serialize_bib_entry(&entry);
        let parsed = parse_bibtex(&bib_str);
        assert_eq!(parsed.len(), 1, "should parse exactly one entry, got bib:\n{}", bib_str);
        assert_eq!(
            parsed[0].abstract_text,
            Some("ratio a/b is large".to_string()),
            "stray closer should be stripped from abstract"
        );
    }

    #[test]
    fn serialize_bib_entry_sanitizes_stray_opener_in_title() {
        let mut entry = minimal_entry();
        entry.title = "The {incomplete case".to_string();
        let bib_str = serialize_bib_entry(&entry);
        let parsed = parse_bibtex(&bib_str);
        assert_eq!(parsed.len(), 1, "should parse exactly one entry, got bib:\n{}", bib_str);
        assert_eq!(
            parsed[0].title,
            "The incomplete case",
            "stray opener should be stripped from title"
        );
    }

    #[test]
    fn update_entry_fields_sanitizes_stray_closer() {
        let dir = TempDir::new().unwrap();
        let bib_path = dir.path().join("refs.bib");
        let content = "@article{smith2024,\n  author = {Smith},\n  title = {Alpha},\n  year = {2024}\n}\n";
        fs::write(&bib_path, content).unwrap();
        let cache = BibCache::new();

        let mut fields = HashMap::new();
        fields.insert("abstract".to_string(), "result is x} > 0".to_string());
        update_entry_fields(&bib_path, "smith2024", &fields, &cache).unwrap();

        let updated = fs::read_to_string(&bib_path).unwrap();
        let parsed = parse_bibtex(&updated);
        assert_eq!(parsed.len(), 1, "entry should still be parseable after stray closer");
        assert_eq!(
            parsed[0].abstract_text,
            Some("result is x > 0".to_string()),
            "stray closer should be stripped"
        );

        // Second update should still locate the entry
        let mut fields2 = HashMap::new();
        fields2.insert("url".to_string(), "https://example.com".to_string());
        let result = update_entry_fields(&bib_path, "smith2024", &fields2, &cache);
        assert!(result.is_ok(), "second update should succeed: {:?}", result);

        let updated2 = fs::read_to_string(&bib_path).unwrap();
        let parsed2 = parse_bibtex(&updated2);
        assert_eq!(parsed2[0].url, Some("https://example.com".to_string()));
    }

    #[test]
    fn update_entry_fields_sanitizes_stray_opener() {
        let dir = TempDir::new().unwrap();
        let bib_path = dir.path().join("refs.bib");
        let content = "@article{smith2024,\n  author = {Smith},\n  title = {Alpha},\n  year = {2024}\n}\n";
        fs::write(&bib_path, content).unwrap();
        let cache = BibCache::new();

        let mut fields = HashMap::new();
        fields.insert("abstract".to_string(), "set {S is open".to_string());
        update_entry_fields(&bib_path, "smith2024", &fields, &cache).unwrap();

        let updated = fs::read_to_string(&bib_path).unwrap();
        let parsed = parse_bibtex(&updated);
        assert_eq!(parsed.len(), 1, "entry should still be parseable after stray opener");

        // Second update should still locate the entry
        let mut fields2 = HashMap::new();
        fields2.insert("url".to_string(), "https://example.com".to_string());
        let result = update_entry_fields(&bib_path, "smith2024", &fields2, &cache);
        assert!(result.is_ok(), "second update should succeed: {:?}", result);
    }

    #[test]
    fn writer_uses_shared_find_value_end_bare_semantics() {
        let dir = TempDir::new().unwrap();
        let bib_path = dir.path().join("refs.bib");
        let content = "@article{test2024,\n  title = {Alpha},\n  year = 2024\n}\n";
        fs::write(&bib_path, content).unwrap();
        let cache = BibCache::new();

        let mut fields = HashMap::new();
        fields.insert("year".to_string(), "2025".to_string());

        let result = update_entry_fields(&bib_path, "test2024", &fields, &cache).unwrap();
        assert!(result);

        let updated = fs::read_to_string(&bib_path).unwrap();
        let parsed = parse_bibtex(&updated);
        assert_eq!(parsed[0].year, "2025");
    }

    #[test]
    fn serialize_file_field_round_trips() {
        let mut entry = minimal_entry();
        entry.file = Some("assets/pdf/paper.pdf".to_string());
        let bib_str = serialize_bib_entry(&entry);
        let parsed = parse_bibtex(&bib_str);
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].file, Some("assets/pdf/paper.pdf".to_string()));
    }

    #[test]
    fn serialize_omits_none_file_field() {
        let entry = minimal_entry();
        let bib_str = serialize_bib_entry(&entry);
        assert!(!bib_str.contains("file"));
    }

    #[test]
    fn serialize_file_after_url() {
        let mut entry = minimal_entry();
        entry.url = Some("https://example.com".to_string());
        entry.file = Some("assets/pdf/test.pdf".to_string());
        let bib_str = serialize_bib_entry(&entry);
        let url_pos = bib_str.find("url =").unwrap();
        let file_pos = bib_str.find("file =").unwrap();
        assert!(file_pos > url_pos, "file field should come after url field");
    }

    #[test]
    fn serialize_full_entry_with_file_round_trips() {
        let mut entry = full_entry();
        entry.file = Some("assets/pdf/example.pdf".to_string());
        let bib_str = serialize_bib_entry(&entry);
        let parsed = parse_bibtex(&bib_str);
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].file, Some("assets/pdf/example.pdf".to_string()));
        // Verify other fields are unaffected
        assert_eq!(parsed[0].title, entry.title);
        assert_eq!(parsed[0].doi, entry.doi);
        assert_eq!(parsed[0].url, entry.url);
    }

    #[test]
    fn roundtrip_serialize_parse_update_with_unbalanced_braces() {
        let dir = TempDir::new().unwrap();
        let bib_path = dir.path().join("refs.bib");

        let mut entry = minimal_entry();
        entry.key = "test2024".to_string();
        entry.abstract_text = Some("both { stray and } unmatched".to_string());

        let bib_str = serialize_bib_entry(&entry);
        fs::write(&bib_path, &bib_str).unwrap();

        let parsed = parse_bibtex(&fs::read_to_string(&bib_path).unwrap());
        assert_eq!(parsed.len(), 1, "should parse exactly one entry after serialize");

        let cache = BibCache::new();
        let mut fields = HashMap::new();
        fields.insert("doi".to_string(), "10.1000/test".to_string());
        let result = update_entry_fields(&bib_path, "test2024", &fields, &cache);
        assert!(result.is_ok(), "update should succeed: {:?}", result);

        let updated = fs::read_to_string(&bib_path).unwrap();
        let parsed2 = parse_bibtex(&updated);
        assert_eq!(parsed2.len(), 1, "should still be one entry after update");
        assert!(parsed2[0].abstract_text.is_some(), "abstract should still be present");
        assert_eq!(parsed2[0].doi, Some("10.1000/test".to_string()), "doi should be added");
    }
}
