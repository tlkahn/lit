use crate::bib::cache::BibCache;
use crate::bib::convert::normalize_doi;
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
            entry.authors.join(" and ")
        ));
    }

    // title
    out.push_str(&format!("  title = {{{}}},\n", entry.title));

    // year (always emitted, even if empty)
    out.push_str(&format!("  year = {{{}}},\n", entry.year));

    // doi
    if let Some(ref doi) = entry.doi {
        out.push_str(&format!("  doi = {{{}}},\n", doi));
    }

    // journal / booktitle (based on entry_type)
    if let Some(ref journal) = entry.journal {
        let field_name = match entry.entry_type.as_str() {
            "inproceedings" | "incollection" => "booktitle",
            _ => "journal",
        };
        out.push_str(&format!("  {} = {{{}}},\n", field_name, journal));
    }

    // url
    if let Some(ref url) = entry.url {
        out.push_str(&format!("  url = {{{}}},\n", url));
    }

    // abstract
    if let Some(ref abstract_text) = entry.abstract_text {
        out.push_str(&format!("  abstract = {{{}}},\n", abstract_text));
    }

    // keywords (from tags)
    if !entry.tags.is_empty() {
        out.push_str(&format!("  keywords = {{{}}},\n", entry.tags.join(", ")));
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
}
