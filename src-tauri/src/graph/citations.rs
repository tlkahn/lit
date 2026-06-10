use regex::Regex;
use std::sync::LazyLock;

use super::links::{blank_fenced_code_blocks, blank_inline_code};

/// Mirrors `scanCiteprocCitations` in `src/editor/livePreview/citeproc.ts`
/// (CITE_BRACKET_RE / CITE_ITEM_RE) so backend citation edges agree with what
/// the editor renders as citations.
static CITE_BRACKET_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\[([^\]]*@[^\]]+)\]").unwrap());
static CITE_ITEM_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"-?@([A-Za-z0-9_][A-Za-z0-9_:.#$%&\-+?<>~/]*)").unwrap());

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CitationRef {
    pub bib_key: String,
    /// Trimmed full line of the original body containing the citation.
    pub context: String,
    /// 1-based line number within the (frontmatter-stripped) body,
    /// matching the wikilink convention in `extract_sentence_context`.
    pub source_line: u32,
}

pub fn extract_citations(body: &str) -> Vec<CitationRef> {
    let mut text = body.to_string();
    blank_fenced_code_blocks(&mut text);
    blank_inline_code(&mut text);
    // Blanking is byte-length-preserving (asserted by links.rs tests), so byte
    // offsets found in `text` are valid char boundaries in `body`.

    let mut refs = Vec::new();
    for caps in CITE_BRACKET_RE.captures_iter(&text) {
        let whole = caps.get(0).unwrap();
        let inner = caps.get(1).unwrap().as_str();

        let mut keys: Vec<String> = Vec::new();
        let mut has_crossref = false;
        for part in inner.split(';') {
            let Some(km) = CITE_ITEM_RE.captures(part) else {
                continue;
            };
            let key = km.get(1).unwrap().as_str();
            if key.contains(':') {
                // pandoc-crossref reference (e.g. @fig:diagram) — the whole
                // bracket group is a cross-reference, not a citation.
                has_crossref = true;
                break;
            }
            keys.push(key.to_string());
        }
        if has_crossref || keys.is_empty() {
            continue;
        }

        let start = whole.start();
        let source_line = text[..start].matches('\n').count() as u32 + 1;
        let line_start = body[..start].rfind('\n').map(|i| i + 1).unwrap_or(0);
        let line_end = body[start..]
            .find('\n')
            .map(|i| start + i)
            .unwrap_or(body.len());
        let context = body[line_start..line_end].trim().to_string();

        for bib_key in keys {
            refs.push(CitationRef {
                bib_key,
                context: context.clone(),
                source_line,
            });
        }
    }
    refs
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn single_cite_extracted() {
        let refs = extract_citations("As shown in [@smith2024].");
        assert_eq!(
            refs,
            vec![CitationRef {
                bib_key: "smith2024".to_string(),
                context: "As shown in [@smith2024].".to_string(),
                source_line: 1,
            }]
        );
    }

    #[test]
    fn multi_cite_extracts_each_key() {
        let refs = extract_citations("[@alpha2020; @beta2021]");
        assert_eq!(refs.len(), 2);
        assert_eq!(refs[0].bib_key, "alpha2020");
        assert_eq!(refs[1].bib_key, "beta2021");
        assert_eq!(refs[0].source_line, 1);
        assert_eq!(refs[1].source_line, 1);
        assert_eq!(refs[0].context, refs[1].context);
    }

    #[test]
    fn suppressed_author_cite_extracted() {
        let refs = extract_citations("Smith said [-@smith2024].");
        assert_eq!(refs.len(), 1);
        assert_eq!(refs[0].bib_key, "smith2024");
    }

    #[test]
    fn locator_suffix_not_part_of_key() {
        let refs = extract_citations("[@smith2024, pp. 33-35]");
        assert_eq!(refs.len(), 1);
        assert_eq!(refs[0].bib_key, "smith2024");
    }

    #[test]
    fn prefix_text_inside_brackets_allowed() {
        let refs = extract_citations("[see @smith2024, ch. 3]");
        assert_eq!(refs.len(), 1);
        assert_eq!(refs[0].bib_key, "smith2024");
    }

    #[test]
    fn cite_in_fenced_code_block_skipped() {
        let refs = extract_citations("before\n```\n[@key]\n```\nafter");
        assert!(refs.is_empty());
    }

    #[test]
    fn cite_in_inline_code_skipped() {
        let refs = extract_citations("Use `[@key]` in code.");
        assert!(refs.is_empty());
    }

    #[test]
    fn crossref_group_skipped() {
        let refs = extract_citations("See [@fig:diagram].");
        assert!(refs.is_empty());
    }

    #[test]
    fn crossref_anywhere_in_group_skips_whole_group() {
        let refs = extract_citations("[@smith2024; @fig:diagram]");
        assert!(refs.is_empty());
    }

    #[test]
    fn malformed_patterns_skipped() {
        assert!(extract_citations("[@]").is_empty());
        assert!(extract_citations("[no at sign]").is_empty());
        assert!(extract_citations("@smith2024").is_empty());
        assert!(extract_citations("[]").is_empty());
    }

    #[test]
    fn source_line_is_one_based_across_lines() {
        let refs = extract_citations("line one\nline two\ncite here [@smith2024]\n");
        assert_eq!(refs.len(), 1);
        assert_eq!(refs[0].source_line, 3);
        assert_eq!(refs[0].context, "cite here [@smith2024]");
    }

    #[test]
    fn same_key_cited_twice_yields_two_refs() {
        let refs = extract_citations("[@k] and later [@k]");
        assert_eq!(refs.len(), 2);
        assert_eq!(refs[0].bib_key, "k");
        assert_eq!(refs[1].bib_key, "k");
    }

    #[test]
    fn duplicate_key_within_group_yields_ref_per_occurrence() {
        // Mirrors scanCiteprocCitations: no dedup — every occurrence is its
        // own ref so each citation edge carries its own line/context.
        let refs = extract_citations("[@k; @k]");
        assert_eq!(refs.len(), 2);
        assert_eq!(refs[0].bib_key, "k");
        assert_eq!(refs[1].bib_key, "k");
    }

    #[test]
    fn context_is_trimmed_line() {
        let refs = extract_citations("  indented [@k] text  \n");
        assert_eq!(refs.len(), 1);
        assert_eq!(refs[0].context, "indented [@k] text");
    }

    #[test]
    fn multibyte_text_before_cite() {
        let refs = extract_citations("你好世界 [@k]");
        assert_eq!(refs.len(), 1);
        assert_eq!(refs[0].bib_key, "k");
    }
}
