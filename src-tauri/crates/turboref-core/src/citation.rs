use regex::Regex;
use std::sync::LazyLock;

use crate::types::{Citation, CitationRef, RefType};

// Match [@...] citations. Supports batch refs: [@fig:a;@tbl:b,@sec:c]
static CITATION_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"\[@([^@\]]+(?:[@;,][^@\]]+)*)\]").unwrap()
});

// Parse individual ref: @?type:id
static REF_PART_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^@?(\w+):(.+)$").unwrap()
});

/// Scan document content for all citations, returning their positions and parsed refs.
/// Offsets are in UTF-16 code units for CodeMirror compatibility.
pub fn scan_citations(content: &str) -> Vec<Citation> {
    let mut citations = Vec::new();

    // We need UTF-16 offsets, so build a char-to-utf16 mapping
    let utf16_offsets: Vec<usize> = {
        let mut offsets = Vec::with_capacity(content.len());
        let mut utf16_pos: usize = 0;
        for ch in content.chars() {
            offsets.push(utf16_pos);
            utf16_pos += ch.len_utf16();
        }
        offsets.push(utf16_pos); // sentinel for end
        offsets
    };

    // Map byte offset to char index
    let byte_to_char: Vec<usize> = {
        let mut map = vec![0usize; content.len() + 1];
        for (char_idx, (byte_idx, _)) in content.char_indices().enumerate() {
            map[byte_idx] = char_idx;
        }
        map[content.len()] = content.chars().count();
        map
    };

    for m in CITATION_RE.find_iter(content) {
        let byte_start = m.start();
        let byte_end = m.end();
        let char_start = byte_to_char[byte_start];
        let char_end = byte_to_char[byte_end];
        let utf16_start = utf16_offsets[char_start];
        let utf16_end = utf16_offsets[char_end];

        let original = m.as_str().to_string();

        // Extract the inner content (between [@ and ])
        let caps = CITATION_RE.captures(m.as_str()).unwrap();
        let inner = &caps[1];

        let refs = parse_citation_content(inner);

        if !refs.is_empty() {
            citations.push(Citation {
                refs,
                char_start: utf16_start,
                char_end: utf16_end,
                original,
            });
        }
    }

    citations
}

/// Parse the inner content of a citation (e.g., "fig:cat;@tbl:data").
pub fn parse_citation_content(content: &str) -> Vec<CitationRef> {
    let mut refs = Vec::new();

    for part in content.split([';', ',']) {
        let trimmed = part.trim();
        let clean = trimmed.strip_prefix('@').unwrap_or(trimmed);

        if let Some(caps) = REF_PART_RE.captures(clean) {
            let type_str = &caps[1];
            let id = caps[2].trim().to_string();

            if let Some(ref_type) = RefType::from_str(type_str) {
                refs.push(CitationRef { ref_type, id });
            }
        }
    }

    refs
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scan_single_citation() {
        let citations = scan_citations("See [@fig:cat] for details.");
        assert_eq!(citations.len(), 1);
        assert_eq!(citations[0].refs.len(), 1);
        assert_eq!(citations[0].refs[0].ref_type, RefType::Fig);
        assert_eq!(citations[0].refs[0].id, "cat");
        assert_eq!(citations[0].original, "[@fig:cat]");
    }

    #[test]
    fn scan_batch_citation_semicolon() {
        let citations = scan_citations("[@fig:a;@fig:b;@fig:c]");
        assert_eq!(citations.len(), 1);
        assert_eq!(citations[0].refs.len(), 3);
        assert_eq!(citations[0].refs[0].id, "a");
        assert_eq!(citations[0].refs[1].id, "b");
        assert_eq!(citations[0].refs[2].id, "c");
    }

    #[test]
    fn scan_batch_citation_comma() {
        let citations = scan_citations("[@fig:a,@tbl:b]");
        assert_eq!(citations.len(), 1);
        assert_eq!(citations[0].refs.len(), 2);
        assert_eq!(citations[0].refs[0].ref_type, RefType::Fig);
        assert_eq!(citations[0].refs[1].ref_type, RefType::Tbl);
    }

    #[test]
    fn scan_mixed_types() {
        let citations = scan_citations("[@fig:cat;@tbl:data;@sec:intro]");
        assert_eq!(citations.len(), 1);
        assert_eq!(citations[0].refs.len(), 3);
        assert_eq!(citations[0].refs[0].ref_type, RefType::Fig);
        assert_eq!(citations[0].refs[1].ref_type, RefType::Tbl);
        assert_eq!(citations[0].refs[2].ref_type, RefType::Sec);
    }

    #[test]
    fn scan_multiple_citations() {
        let citations = scan_citations("See [@fig:cat] and [@tbl:data].");
        assert_eq!(citations.len(), 2);
        assert_eq!(citations[0].refs[0].id, "cat");
        assert_eq!(citations[1].refs[0].id, "data");
    }

    #[test]
    fn scan_no_citations() {
        let citations = scan_citations("No references here.");
        assert_eq!(citations.len(), 0);
    }

    #[test]
    fn scan_equation_citation() {
        let citations = scan_citations("See [@eq:einstein].");
        assert_eq!(citations.len(), 1);
        assert_eq!(citations[0].refs[0].ref_type, RefType::Eq);
        assert_eq!(citations[0].refs[0].id, "einstein");
    }

    #[test]
    fn scan_listing_citation() {
        let citations = scan_citations("See [@lst:hello].");
        assert_eq!(citations.len(), 1);
        assert_eq!(citations[0].refs[0].ref_type, RefType::Lst);
    }

    #[test]
    fn scan_without_at_prefix() {
        // First ref has @, subsequent can omit it
        let citations = scan_citations("[@fig:a;fig:b]");
        assert_eq!(citations.len(), 1);
        assert_eq!(citations[0].refs.len(), 2);
        assert_eq!(citations[0].refs[1].id, "b");
    }

    #[test]
    fn scan_utf16_offsets() {
        // "图" is 1 UTF-16 unit, so offset after "图 " is 2
        let citations = scan_citations("图 [@fig:cat]");
        assert_eq!(citations.len(), 1);
        assert_eq!(citations[0].char_start, 2); // "图 " = 2 UTF-16 units
        assert_eq!(citations[0].char_end, 12); // "[@fig:cat]" = 10 UTF-16 units
    }

    #[test]
    fn parse_content_single() {
        let refs = parse_citation_content("fig:cat");
        assert_eq!(refs.len(), 1);
        assert_eq!(refs[0].ref_type, RefType::Fig);
        assert_eq!(refs[0].id, "cat");
    }

    #[test]
    fn parse_content_batch() {
        let refs = parse_citation_content("fig:a;@fig:b;@tbl:c");
        assert_eq!(refs.len(), 3);
    }

    #[test]
    fn parse_content_empty() {
        let refs = parse_citation_content("");
        assert_eq!(refs.len(), 0);
    }
}
