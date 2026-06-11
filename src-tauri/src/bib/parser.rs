use crate::bib::types::BibEntry;
use regex::Regex;
use std::collections::HashMap;
use std::sync::LazyLock;

pub(crate) static ENTRY_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^\s*@(\w+)\s*\{(.+)").unwrap());

pub(crate) static FIELD_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(\w+)\s*=\s*").unwrap());

const SKIP_TYPES: &[&str] = &["comment", "string", "preamble"];

pub fn parse_bibtex(input: &str) -> Vec<BibEntry> {
    let mut entries = Vec::new();
    let lines: Vec<&str> = input.split('\n').collect();
    let mut i = 0;

    while i < lines.len() {
        let line = lines[i];
        let Some(caps) = ENTRY_RE.captures(line) else {
            i += 1;
            continue;
        };

        let entry_type = caps[1].to_lowercase();
        if SKIP_TYPES.contains(&entry_type.as_str()) {
            let brace_start = line.find('{').unwrap_or(0);
            let mut depth: i32 = 0;
            for ch in line[brace_start..].chars() {
                if ch == '{' { depth += 1; }
                else if ch == '}' { depth -= 1; }
                if depth == 0 { break; }
            }
            if depth > 0 {
                i += 1;
                while i < lines.len() && depth > 0 {
                    for ch in lines[i].chars() {
                        if ch == '{' { depth += 1; }
                        else if ch == '}' { depth -= 1; }
                        if depth == 0 { break; }
                    }
                    i += 1;
                }
            } else {
                i += 1;
            }
            continue;
        }

        let rest = &caps[2];
        let Some(comma_idx) = rest.find(',') else {
            i += 1;
            continue;
        };

        let key = rest[..comma_idx].trim().to_string();
        let entry_start_line = i;

        let mut depth: i32 = 1;
        let mut body_parts = vec![rest[comma_idx + 1..].to_string()];
        i += 1;

        while i < lines.len() && depth > 0 {
            let l = lines[i];
            for ch in l.chars() {
                if ch == '{' { depth += 1; }
                else if ch == '}' { depth -= 1; }
                if depth == 0 { break; }
            }
            if depth > 0 {
                body_parts.push(l.to_string());
            } else {
                let closing_idx = find_closing_brace(l, (depth + 1) as usize);
                if closing_idx > 0 {
                    body_parts.push(l[..closing_idx].to_string());
                }
            }
            i += 1;
        }

        let body = body_parts.join("\n");
        let fields = parse_fields(&body);

        let authors = match fields.get("author") {
            Some(a) => a
                .split(" and ")
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .collect(),
            None => Vec::new(),
        };

        entries.push(BibEntry {
            key,
            entry_type,
            authors,
            title: fields.get("title").cloned().unwrap_or_default(),
            year: fields.get("year").cloned().unwrap_or_default(),
            line_number: entry_start_line,
            bib_file: None,
            abstract_text: fields.get("abstract").cloned(),
            doi: fields.get("doi").cloned(),
            journal: fields
                .get("journal")
                .or_else(|| fields.get("booktitle"))
                .cloned(),
            url: fields.get("url").cloned(),
            volume: fields.get("volume").cloned(),
            number: fields.get("number").cloned(),
            pages: fields.get("pages").cloned(),
            publisher: fields.get("publisher").cloned(),
            issn: fields.get("issn").cloned(),
            tags: match fields.get("keywords") {
                Some(kw) => kw
                    .split(',')
                    .map(|s| s.trim().to_string())
                    .filter(|s| !s.is_empty())
                    .collect(),
                None => Vec::new(),
            },
        });
    }

    entries
}

fn find_closing_brace(line: &str, start_depth: usize) -> usize {
    let mut depth = start_depth as i32;
    for (i, ch) in line.chars().enumerate() {
        if ch == '{' { depth += 1; }
        else if ch == '}' { depth -= 1; }
        if depth == 0 { return i; }
    }
    0
}

fn parse_fields(body: &str) -> HashMap<String, String> {
    let mut fields = HashMap::new();
    let mut search_start = 0;

    while search_start < body.len() {
        let Some(caps) = FIELD_RE.captures(&body[search_start..]) else {
            break;
        };
        let m = caps.get(0).unwrap();
        let field_name = caps[1].to_lowercase();
        let value_start = search_start + m.end();

        if let Some(extracted) = extract_field_value(body, value_start) {
            fields.insert(field_name, extracted.text);
            search_start = extracted.end;
        } else {
            search_start = value_start;
        }
    }

    fields
}

/// Find the byte offset just past the end of a BibTeX field value starting at `start`.
/// Handles `{...}` (brace-delimited), `"..."` (quote-delimited), and bare values.
/// Returns `None` if the value is unterminated.
pub(crate) fn find_value_end(text: &str, start: usize) -> Option<usize> {
    let bytes = text.as_bytes();
    let mut i = start;
    while i < bytes.len() && (bytes[i] as char).is_whitespace() {
        i += 1;
    }
    if i >= bytes.len() {
        return None;
    }
    match bytes[i] as char {
        '{' => {
            let mut depth: i32 = 0;
            for j in i..bytes.len() {
                if bytes[j] == b'{' {
                    depth += 1;
                } else if bytes[j] == b'}' {
                    depth -= 1;
                    if depth == 0 {
                        return Some(j + 1);
                    }
                }
            }
            None
        }
        '"' => {
            let mut j = i + 1;
            while j < bytes.len() {
                if bytes[j] == b'"' && (j == i + 1 || bytes[j - 1] != b'\\') {
                    return Some(j + 1);
                }
                j += 1;
            }
            None
        }
        _ => {
            let remaining = &text[i..];
            let end = remaining
                .find(|c: char| c == ',' || c == '}' || c.is_whitespace())
                .unwrap_or(remaining.len());
            Some(i + end)
        }
    }
}

struct ExtractedValue {
    text: String,
    end: usize,
}

fn extract_field_value(body: &str, start: usize) -> Option<ExtractedValue> {
    let bytes = body.as_bytes();
    let mut i = start;

    while i < bytes.len() && (bytes[i] as char).is_whitespace() {
        i += 1;
    }
    if i >= bytes.len() {
        return None;
    }

    let ch = bytes[i] as char;
    match ch {
        '{' => extract_braced(body, i),
        '"' => extract_quoted(body, i),
        _ => {
            let end = find_value_end(body, start)?;
            let text = body[i..end].trim().to_string();
            if text.is_empty() {
                return None;
            }
            Some(ExtractedValue { text, end })
        }
    }
}

fn extract_braced(body: &str, start: usize) -> Option<ExtractedValue> {
    let mut depth: i32 = 0;
    let mut chars = Vec::new();

    for (offset, ch) in body[start..].char_indices() {
        if ch == '{' {
            depth += 1;
            if depth > 1 { chars.push(ch); }
        } else if ch == '}' {
            depth -= 1;
            if depth == 0 {
                return Some(ExtractedValue {
                    text: normalize_whitespace(&chars.iter().collect::<String>()),
                    end: start + offset + 1,
                });
            }
            chars.push(ch);
        } else {
            chars.push(ch);
        }
    }
    None
}

fn extract_quoted(body: &str, start: usize) -> Option<ExtractedValue> {
    let mut chars = Vec::new();
    let body_chars: Vec<char> = body[start..].chars().collect();

    let mut i = 1; // skip opening quote
    while i < body_chars.len() {
        if body_chars[i] == '"' && (i == 0 || body_chars[i - 1] != '\\') {
            return Some(ExtractedValue {
                text: normalize_whitespace(&chars.iter().collect::<String>()),
                end: start + body_chars[..=i].iter().map(|c| c.len_utf8()).sum::<usize>(),
            });
        }
        chars.push(body_chars[i]);
        i += 1;
    }
    None
}

fn normalize_whitespace(s: &str) -> String {
    let mut result = String::new();
    let mut prev_was_ws = false;
    for ch in s.chars() {
        if ch.is_whitespace() {
            if !prev_was_ws && !result.is_empty() {
                result.push(' ');
            }
            prev_was_ws = true;
        } else {
            prev_was_ws = false;
            result.push(ch);
        }
    }
    result.trim().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_single_article() {
        let input = "@article{sanderson2009,\n  author = {Sanderson, Alexis},\n  title = {The Śaiva Age},\n  year = {2009}\n}";
        let entries = parse_bibtex(input);
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].key, "sanderson2009");
        assert_eq!(entries[0].entry_type, "article");
        assert_eq!(entries[0].authors, vec!["Sanderson, Alexis"]);
        assert_eq!(entries[0].title, "The Śaiva Age");
        assert_eq!(entries[0].year, "2009");
        assert_eq!(entries[0].line_number, 0);
    }

    #[test]
    fn parse_book_entry() {
        let input = "@book{flood1996,\n  author = {Flood, Gavin},\n  title = {An Introduction to Hinduism},\n  year = {1996},\n  publisher = {Cambridge University Press}\n}";
        let entries = parse_bibtex(input);
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].key, "flood1996");
        assert_eq!(entries[0].entry_type, "book");
        assert_eq!(entries[0].authors, vec!["Flood, Gavin"]);
        assert_eq!(entries[0].year, "1996");
        assert_eq!(entries[0].publisher, Some("Cambridge University Press".to_string()));
    }

    #[test]
    fn double_quote_delimited_fields() {
        let input = "@article{test2020,\n  author = \"Smith, John\",\n  title = \"A Study of Things\",\n  year = \"2020\"\n}";
        let entries = parse_bibtex(input);
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].authors, vec!["Smith, John"]);
        assert_eq!(entries[0].title, "A Study of Things");
        assert_eq!(entries[0].year, "2020");
    }

    #[test]
    fn multiple_and_separated_authors() {
        let input = "@article{multi2021,\n  author = {First, A. and Second, B. and Third, C.},\n  title = {Collaborative Work},\n  year = {2021}\n}";
        let entries = parse_bibtex(input);
        assert_eq!(entries[0].authors, vec!["First, A.", "Second, B.", "Third, C."]);
    }

    #[test]
    fn multi_line_field_values() {
        let input = "@article{long2022,\n  author = {Author, Long},\n  title = {A Very Long Title\n    That Spans Multiple Lines},\n  year = {2022}\n}";
        let entries = parse_bibtex(input);
        assert_eq!(entries[0].title, "A Very Long Title That Spans Multiple Lines");
    }

    #[test]
    fn keys_with_special_chars() {
        let input = "@article{van-der-berg.2009_a,\n  author = {van der Berg, Jan},\n  title = {Some Research},\n  year = {2009}\n}";
        let entries = parse_bibtex(input);
        assert_eq!(entries[0].key, "van-der-berg.2009_a");
    }

    #[test]
    fn multiple_entries() {
        let input = "@article{first2020,\n  author = {First, Author},\n  title = {Paper One},\n  year = {2020}\n}\n\n@book{second2021,\n  author = {Second, Author},\n  title = {Book Two},\n  year = {2021}\n}";
        let entries = parse_bibtex(input);
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].key, "first2020");
        assert_eq!(entries[1].key, "second2021");
        assert_eq!(entries[1].line_number, 6);
    }

    #[test]
    fn tracks_line_numbers() {
        let input = "\n% A comment line\n\n@article{entry1,\n  author = {One, Author},\n  title = {First},\n  year = {2020}\n}\n\n@article{entry2,\n  author = {Two, Author},\n  title = {Second},\n  year = {2021}\n}";
        let entries = parse_bibtex(input);
        assert_eq!(entries[0].line_number, 3);
        assert_eq!(entries[1].line_number, 9);
    }

    #[test]
    fn missing_author() {
        let input = "@article{noauthor2023,\n  title = {Orphan Paper},\n  year = {2023}\n}";
        let entries = parse_bibtex(input);
        assert_eq!(entries.len(), 1);
        assert!(entries[0].authors.is_empty());
        assert_eq!(entries[0].title, "Orphan Paper");
    }

    #[test]
    fn missing_title() {
        let input = "@misc{notitle2023,\n  author = {Smith, John},\n  year = {2023}\n}";
        let entries = parse_bibtex(input);
        assert_eq!(entries[0].title, "");
    }

    #[test]
    fn missing_year() {
        let input = "@article{noyear,\n  author = {Smith, John},\n  title = {Timeless}\n}";
        let entries = parse_bibtex(input);
        assert_eq!(entries[0].year, "");
    }

    #[test]
    fn ignores_comment_entries() {
        let input = "@comment{This is a comment}\n\n@article{real2020,\n  author = {Real, Author},\n  title = {Real Paper},\n  year = {2020}\n}";
        let entries = parse_bibtex(input);
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].key, "real2020");
    }

    #[test]
    fn ignores_string_entries() {
        let input = "@string{cup = {Cambridge University Press}}\n\n@article{real2020,\n  author = {Real, Author},\n  title = {Real Paper},\n  year = {2020}\n}";
        let entries = parse_bibtex(input);
        assert_eq!(entries.len(), 1);
    }

    #[test]
    fn ignores_preamble_entries() {
        let input = "@preamble{\"Some LaTeX preamble\"}\n\n@article{real2020,\n  author = {Real, Author},\n  title = {Real Paper},\n  year = {2020}\n}";
        let entries = parse_bibtex(input);
        assert_eq!(entries.len(), 1);
    }

    #[test]
    fn preserves_key_casing() {
        let input = "@article{VanDerBerg2009,\n  author = {van der Berg, Jan},\n  title = {Mixed Case Key},\n  year = {2009}\n}";
        let entries = parse_bibtex(input);
        assert_eq!(entries[0].key, "VanDerBerg2009");
    }

    #[test]
    fn empty_input() {
        assert!(parse_bibtex("").is_empty());
    }

    #[test]
    fn only_comments() {
        assert!(parse_bibtex("% just a comment\n% another").is_empty());
    }

    #[test]
    fn nested_braces_in_fields() {
        let input = "@article{nested2020,\n  author = {Smith, John},\n  title = {The {LaTeX} Way of {Formatting}},\n  year = {2020}\n}";
        let entries = parse_bibtex(input);
        assert_eq!(entries[0].title, "The {LaTeX} Way of {Formatting}");
    }

    #[test]
    fn case_insensitive_entry_type() {
        let input = "@Article{case2020,\n  author = {Smith, John},\n  title = {Case Test},\n  year = {2020}\n}";
        let entries = parse_bibtex(input);
        assert_eq!(entries[0].entry_type, "article");
    }

    #[test]
    fn case_insensitive_field_names() {
        let input = "@article{fields2020,\n  Author = {Smith, John},\n  TITLE = {Field Case Test},\n  Year = {2020}\n}";
        let entries = parse_bibtex(input);
        assert_eq!(entries[0].authors, vec!["Smith, John"]);
        assert_eq!(entries[0].title, "Field Case Test");
        assert_eq!(entries[0].year, "2020");
    }

    #[test]
    fn bare_numeric_year() {
        let input = "@article{bare2020,\n  author = {Smith, John},\n  title = {Bare Year},\n  year = 2020\n}";
        let entries = parse_bibtex(input);
        assert_eq!(entries[0].year, "2020");
    }

    #[test]
    fn extracts_abstract_field() {
        let input = "@article{a2020,\n  author = {Smith, John},\n  title = {T},\n  year = {2020},\n  abstract = {This is a summary.}\n}";
        let entries = parse_bibtex(input);
        assert_eq!(entries[0].abstract_text, Some("This is a summary.".to_string()));
    }

    #[test]
    fn extracts_doi_field() {
        let input = "@article{a2020,\n  author = {Smith, John},\n  title = {T},\n  year = {2020},\n  doi = {10.1000/xyz123}\n}";
        let entries = parse_bibtex(input);
        assert_eq!(entries[0].doi, Some("10.1000/xyz123".to_string()));
    }

    #[test]
    fn extracts_journal_field() {
        let input = "@article{a2020,\n  author = {Smith, John},\n  title = {T},\n  year = {2020},\n  journal = {Journal of Things}\n}";
        let entries = parse_bibtex(input);
        assert_eq!(entries[0].journal, Some("Journal of Things".to_string()));
    }

    #[test]
    fn journal_falls_back_to_booktitle() {
        let input = "@inproceedings{a2020,\n  author = {Smith, John},\n  title = {T},\n  year = {2020},\n  booktitle = {Proceedings of X}\n}";
        let entries = parse_bibtex(input);
        assert_eq!(entries[0].journal, Some("Proceedings of X".to_string()));
    }

    #[test]
    fn journal_prefers_journal_over_booktitle() {
        let input = "@article{a2020,\n  author = {Smith, John},\n  title = {T},\n  year = {2020},\n  journal = {Real Journal},\n  booktitle = {Some Book}\n}";
        let entries = parse_bibtex(input);
        assert_eq!(entries[0].journal, Some("Real Journal".to_string()));
    }

    #[test]
    fn extracts_url_field() {
        let input = "@article{a2020,\n  author = {Smith, John},\n  title = {T},\n  year = {2020},\n  url = {https://example.com/paper}\n}";
        let entries = parse_bibtex(input);
        assert_eq!(entries[0].url, Some("https://example.com/paper".to_string()));
    }

    #[test]
    fn extracts_keywords_as_tags() {
        let input = "@article{a2020,\n  author = {Smith, John},\n  title = {T},\n  year = {2020},\n  keywords = {tantra, śaivism, history}\n}";
        let entries = parse_bibtex(input);
        assert_eq!(entries[0].tags, vec!["tantra", "śaivism", "history"]);
    }

    #[test]
    fn missing_optional_fields_are_none_and_empty() {
        let input = "@article{a2020,\n  author = {Smith, John},\n  title = {T},\n  year = {2020}\n}";
        let entries = parse_bibtex(input);
        assert_eq!(entries[0].abstract_text, None);
        assert_eq!(entries[0].doi, None);
        assert_eq!(entries[0].journal, None);
        assert_eq!(entries[0].url, None);
        assert!(entries[0].tags.is_empty());
    }

    #[test]
    fn empty_keywords_yields_no_tags() {
        let input = "@article{a2020,\n  author = {Smith, John},\n  title = {T},\n  year = {2020},\n  keywords = {}\n}";
        let entries = parse_bibtex(input);
        assert!(entries[0].tags.is_empty());
    }

    #[test]
    fn keywords_with_trailing_comma() {
        let input = "@article{a2020,\n  author = {Smith, John},\n  title = {T},\n  year = {2020},\n  keywords = {a, b, }\n}";
        let entries = parse_bibtex(input);
        assert_eq!(entries[0].tags, vec!["a", "b"]);
    }

    #[test]
    fn parse_extracts_volume_field() {
        let input = "@article{a2020,\n  author = {Smith, John},\n  title = {T},\n  year = {2020},\n  volume = {42}\n}";
        let entries = parse_bibtex(input);
        assert_eq!(entries[0].volume, Some("42".to_string()));
    }

    #[test]
    fn parse_extracts_number_field() {
        let input = "@article{a2020,\n  author = {Smith, John},\n  title = {T},\n  year = {2020},\n  number = {3}\n}";
        let entries = parse_bibtex(input);
        assert_eq!(entries[0].number, Some("3".to_string()));
    }

    #[test]
    fn parse_extracts_pages_field() {
        let input = "@article{a2020,\n  author = {Smith, John},\n  title = {T},\n  year = {2020},\n  pages = {100--115}\n}";
        let entries = parse_bibtex(input);
        assert_eq!(entries[0].pages, Some("100--115".to_string()));
    }

    #[test]
    fn parse_extracts_publisher_field() {
        let input = "@book{b2020,\n  author = {Smith, John},\n  title = {T},\n  year = {2020},\n  publisher = {Cambridge University Press}\n}";
        let entries = parse_bibtex(input);
        assert_eq!(entries[0].publisher, Some("Cambridge University Press".to_string()));
    }

    #[test]
    fn parse_extracts_issn_field() {
        let input = "@article{a2020,\n  author = {Smith, John},\n  title = {T},\n  year = {2020},\n  issn = {0028-0836}\n}";
        let entries = parse_bibtex(input);
        assert_eq!(entries[0].issn, Some("0028-0836".to_string()));
    }

    #[test]
    fn missing_new_fields_are_none() {
        let input = "@article{a2020,\n  author = {Smith, John},\n  title = {T},\n  year = {2020}\n}";
        let entries = parse_bibtex(input);
        assert_eq!(entries[0].volume, None);
        assert_eq!(entries[0].number, None);
        assert_eq!(entries[0].pages, None);
        assert_eq!(entries[0].publisher, None);
        assert_eq!(entries[0].issn, None);
    }

    #[test]
    fn parse_all_new_fields_together() {
        let input = "@article{a2020,\n  author = {Smith, John},\n  title = {T},\n  year = {2020},\n  volume = {10},\n  number = {2},\n  pages = {50--75},\n  publisher = {Springer},\n  issn = {1234-5678}\n}";
        let entries = parse_bibtex(input);
        assert_eq!(entries[0].volume, Some("10".to_string()));
        assert_eq!(entries[0].number, Some("2".to_string()));
        assert_eq!(entries[0].pages, Some("50--75".to_string()));
        assert_eq!(entries[0].publisher, Some("Springer".to_string()));
        assert_eq!(entries[0].issn, Some("1234-5678".to_string()));
    }

    #[test]
    fn find_value_end_braced() {
        assert_eq!(find_value_end("{hello}", 0), Some(7));
    }

    #[test]
    fn find_value_end_quoted() {
        assert_eq!(find_value_end("\"hello\"", 0), Some(7));
    }

    #[test]
    fn find_value_end_bare() {
        assert_eq!(find_value_end("2020 ,", 0), Some(4));
        assert_eq!(find_value_end("2020,", 0), Some(4));
        assert_eq!(find_value_end("2020}", 0), Some(4));
    }

    #[test]
    fn find_value_end_nested_braces() {
        assert_eq!(find_value_end("{The {LaTeX} Way}", 0), Some(17));
    }

    #[test]
    fn find_value_end_skips_leading_whitespace() {
        assert_eq!(find_value_end("  {hello}", 0), Some(9));
        assert_eq!(find_value_end("  2020,", 0), Some(6));
    }

    #[test]
    fn find_value_end_unterminated() {
        assert_eq!(find_value_end("{unclosed", 0), None);
        assert_eq!(find_value_end("\"unclosed", 0), None);
        assert_eq!(find_value_end("", 0), None);
    }
}
