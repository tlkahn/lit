use regex::Regex;
use std::sync::LazyLock;

use crate::config::DocumentConfig;
use crate::renderer::prefix_for_type;
use crate::resolver::ReferenceMap;
use crate::types::{RefType, ResolvedDefinitionTag};

static DEF_TAG_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"\{#(\w+):([^}]+)\}").unwrap()
});

/// A raw definition tag match with position data.
#[derive(Debug, Clone)]
pub struct DefinitionTagMatch {
    pub ref_type: RefType,
    pub id: String,
    pub char_start: usize,
    pub char_end: usize,
    pub original: String,
}

/// Compute byte ranges that should be excluded (code blocks and math blocks).
fn compute_excluded_ranges(content: &str) -> Vec<(usize, usize)> {
    let mut ranges = Vec::new();
    let mut i = 0;
    let bytes = content.as_bytes();
    let len = bytes.len();

    while i < len {
        // Check for fenced code block (``` or ~~~)
        if i < len && (bytes[i] == b'`' || bytes[i] == b'~') {
            let fence_char = bytes[i];
            let fence_start = i;

            // Count consecutive fence chars
            let mut fence_len = 0;
            while i < len && bytes[i] == fence_char {
                fence_len += 1;
                i += 1;
            }

            if fence_len >= 3 {
                // Skip the rest of the opening fence line (info string)
                while i < len && bytes[i] != b'\n' {
                    i += 1;
                }
                if i < len {
                    i += 1; // skip newline
                }

                // Find closing fence
                let block_start = fence_start;
                loop {
                    if i >= len {
                        // Unclosed fence — exclude to EOF
                        ranges.push((block_start, len));
                        break;
                    }

                    // Check if this line is a closing fence
                    let mut close_count = 0;
                    while i < len && bytes[i] == fence_char {
                        close_count += 1;
                        i += 1;
                    }
                    // Skip trailing whitespace
                    while i < len && bytes[i] != b'\n' && bytes[i].is_ascii_whitespace() {
                        i += 1;
                    }
                    if close_count >= fence_len && (i >= len || bytes[i] == b'\n') {
                        // Closing fence found — exclude from opening to end of closing line
                        if i < len {
                            i += 1;
                        }
                        ranges.push((block_start, i));
                        break;
                    }
                    // Not a closing fence — skip to end of line
                    while i < len && bytes[i] != b'\n' {
                        i += 1;
                    }
                    if i < len {
                        i += 1;
                    }
                }
                continue;
            }
        }

        // Check for display math block (standalone $$ on its own line)
        if i < len.saturating_sub(1) && bytes[i] == b'$' && bytes[i + 1] == b'$' {
            // Check it's at the start of a line (or start of content)
            let at_line_start = i == 0 || bytes[i - 1] == b'\n';
            if at_line_start {
                // Check the rest of the line is empty (just $$)
                let mut j = i + 2;
                while j < len && bytes[j] != b'\n' && bytes[j].is_ascii_whitespace() {
                    j += 1;
                }
                if j >= len || bytes[j] == b'\n' {
                    // Opening $$
                    let block_start = i;
                    i = if j < len { j + 1 } else { j };

                    // Find closing $$
                    loop {
                        if i >= len {
                            ranges.push((block_start, len));
                            break;
                        }
                        // Check if line is $$
                        if bytes[i] == b'$' && i + 1 < len && bytes[i + 1] == b'$' {
                            let mut k = i + 2;
                            while k < len && bytes[k] != b'\n' && bytes[k].is_ascii_whitespace() {
                                k += 1;
                            }
                            if k >= len || bytes[k] == b'\n' {
                                // Closing $$
                                if k < len {
                                    k += 1;
                                }
                                ranges.push((block_start, k));
                                i = k;
                                break;
                            }
                        }
                        // Skip to next line
                        while i < len && bytes[i] != b'\n' {
                            i += 1;
                        }
                        if i < len {
                            i += 1;
                        }
                    }
                    continue;
                }
            }
        }

        // Move to next line
        while i < len && bytes[i] != b'\n' {
            i += 1;
        }
        if i < len {
            i += 1;
        }
    }

    ranges
}

fn is_in_excluded(ranges: &[(usize, usize)], start: usize, end: usize) -> bool {
    ranges.iter().any(|&(rs, re)| start >= rs && end <= re)
}

/// Scan document content for all `{#type:id}` definition tags.
/// Skips tags inside fenced code blocks and display math blocks.
pub fn scan_definition_tags(content: &str) -> Vec<DefinitionTagMatch> {
    let excluded = compute_excluded_ranges(content);

    // Build UTF-16 offset maps (same approach as citation.rs)
    let utf16_offsets: Vec<usize> = {
        let mut offsets = Vec::with_capacity(content.len());
        let mut utf16_pos: usize = 0;
        for ch in content.chars() {
            offsets.push(utf16_pos);
            utf16_pos += ch.len_utf16();
        }
        offsets.push(utf16_pos);
        offsets
    };

    let byte_to_char: Vec<usize> = {
        let mut map = vec![0usize; content.len() + 1];
        for (char_idx, (byte_idx, _)) in content.char_indices().enumerate() {
            map[byte_idx] = char_idx;
        }
        map[content.len()] = content.chars().count();
        map
    };

    let mut tags = Vec::new();

    for m in DEF_TAG_RE.find_iter(content) {
        if is_in_excluded(&excluded, m.start(), m.end()) {
            continue;
        }

        let caps = DEF_TAG_RE.captures(m.as_str()).unwrap();
        let type_str = &caps[1];
        let id = caps[2].trim().to_string();

        if let Some(ref_type) = RefType::from_str(type_str) {
            let char_start = byte_to_char[m.start()];
            let char_end = byte_to_char[m.end()];
            let utf16_start = utf16_offsets[char_start];
            let utf16_end = utf16_offsets[char_end];

            tags.push(DefinitionTagMatch {
                ref_type,
                id,
                char_start: utf16_start,
                char_end: utf16_end,
                original: m.as_str().to_string(),
            });
        }
    }

    tags
}

/// Resolve scanned definition tags against the reference map.
pub fn resolve_definition_tags(
    tags: &[DefinitionTagMatch],
    ref_map: &ReferenceMap,
    config: &DocumentConfig,
) -> Vec<ResolvedDefinitionTag> {
    tags.iter()
        .map(|tag| {
            if let Some(def) = ref_map.get(&tag.id) {
                let prefix_array = prefix_for_type(&def.ref_type, config);
                let prefix = DocumentConfig::select_prefix(prefix_array, 1);
                let rendered = format!("#{} {}", prefix, def.number.display());
                ResolvedDefinitionTag {
                    char_start: tag.char_start,
                    char_end: tag.char_end,
                    rendered_text: rendered,
                    is_valid: true,
                    original: tag.original.clone(),
                    ref_type: def.ref_type.prefix_str().to_string(),
                    id: tag.id.clone(),
                }
            } else {
                ResolvedDefinitionTag {
                    char_start: tag.char_start,
                    char_end: tag.char_end,
                    rendered_text: tag.original.clone(),
                    is_valid: false,
                    original: tag.original.clone(),
                    ref_type: tag.ref_type.prefix_str().to_string(),
                    id: tag.id.clone(),
                }
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{Definition, RefNumber};

    fn make_ref_map(defs: Vec<Definition>) -> ReferenceMap {
        ReferenceMap::from_definitions(defs)
    }

    fn make_def(ref_type: RefType, id: &str, number: RefNumber) -> Definition {
        Definition {
            ref_type,
            id: id.to_string(),
            number,
            caption: None,
            line: 0,
            char_offset: 0,
        }
    }

    // --- scan_definition_tags tests ---

    #[test]
    fn scan_single_fig_tag() {
        let tags = scan_definition_tags("![Cat](cat.png){#fig:cat}");
        assert_eq!(tags.len(), 1);
        assert_eq!(tags[0].ref_type, RefType::Fig);
        assert_eq!(tags[0].id, "cat");
        assert_eq!(tags[0].original, "{#fig:cat}");
    }

    #[test]
    fn scan_tag_positions_utf16() {
        // "![Cat](cat.png)" = 15 chars, then "{#fig:cat}" = 10 chars
        let tags = scan_definition_tags("![Cat](cat.png){#fig:cat}");
        assert_eq!(tags[0].char_start, 15);
        assert_eq!(tags[0].char_end, 25);
    }

    #[test]
    fn scan_tag_with_unicode_before() {
        let tags = scan_definition_tags("图 {#fig:cat}");
        assert_eq!(tags[0].char_start, 2);
    }

    #[test]
    fn scan_equation_tag() {
        let tags = scan_definition_tags("$$E=mc^2$${#eq:einstein}");
        assert_eq!(tags.len(), 1);
        assert_eq!(tags[0].ref_type, RefType::Eq);
        assert_eq!(tags[0].id, "einstein");
    }

    #[test]
    fn scan_section_tag() {
        let tags = scan_definition_tags("# Introduction {#sec:intro}");
        assert_eq!(tags.len(), 1);
        assert_eq!(tags[0].ref_type, RefType::Sec);
    }

    #[test]
    fn scan_table_tag() {
        let tags = scan_definition_tags(": Data table {#tbl:data}");
        assert_eq!(tags.len(), 1);
        assert_eq!(tags[0].ref_type, RefType::Tbl);
    }

    #[test]
    fn scan_listing_tag() {
        let tags = scan_definition_tags("{#lst:hello}");
        assert_eq!(tags.len(), 1);
        assert_eq!(tags[0].ref_type, RefType::Lst);
    }

    #[test]
    fn scan_multiple_tags() {
        let content = "![A](a.png){#fig:a}\n![B](b.png){#fig:b}";
        let tags = scan_definition_tags(content);
        assert_eq!(tags.len(), 2);
        assert_eq!(tags[0].id, "a");
        assert_eq!(tags[1].id, "b");
    }

    #[test]
    fn scan_no_tags() {
        let tags = scan_definition_tags("Just some text, no tags.");
        assert_eq!(tags.len(), 0);
    }

    #[test]
    fn scan_tag_in_code_block_skipped() {
        let content = "```\n{#fig:fake}\n```";
        let tags = scan_definition_tags(content);
        assert_eq!(tags.len(), 0);
    }

    #[test]
    fn scan_tag_in_math_block_skipped() {
        let content = "$$\n{#eq:fake}\n$$";
        let tags = scan_definition_tags(content);
        assert_eq!(tags.len(), 0);
    }

    #[test]
    fn scan_tag_after_code_block_not_skipped() {
        let content = "```\ncode\n```\n{#lst:hello}";
        let tags = scan_definition_tags(content);
        assert_eq!(tags.len(), 1);
        assert_eq!(tags[0].id, "hello");
    }

    #[test]
    fn scan_tag_after_math_block_not_skipped() {
        let content = "$$\nE=mc^2\n$$\n{#eq:einstein}";
        let tags = scan_definition_tags(content);
        assert_eq!(tags.len(), 1);
        assert_eq!(tags[0].id, "einstein");
    }

    #[test]
    fn scan_custom_type_tag() {
        let tags = scan_definition_tags("{#thm:fermat}");
        assert_eq!(tags.len(), 1);
        assert_eq!(tags[0].ref_type, RefType::Custom("thm".to_string()));
    }

    #[test]
    fn scan_tag_with_hyphenated_id() {
        let tags = scan_definition_tags("{#fig:my-cat-photo}");
        assert_eq!(tags.len(), 1);
        assert_eq!(tags[0].id, "my-cat-photo");
    }

    #[test]
    fn scan_tag_in_tilde_code_block_skipped() {
        let content = "~~~\n{#fig:fake}\n~~~";
        let tags = scan_definition_tags(content);
        assert_eq!(tags.len(), 0);
    }

    #[test]
    fn scan_mixed_valid_and_excluded() {
        let content = "![Cat](cat.png){#fig:cat}\n```\n{#fig:fake}\n```\n{#lst:code}";
        let tags = scan_definition_tags(content);
        assert_eq!(tags.len(), 2);
        assert_eq!(tags[0].id, "cat");
        assert_eq!(tags[1].id, "code");
    }

    // --- resolve_definition_tags tests ---

    #[test]
    fn resolve_valid_fig_tag() {
        let tags = scan_definition_tags("![Cat](cat.png){#fig:cat}");
        let ref_map = make_ref_map(vec![make_def(RefType::Fig, "cat", RefNumber::Simple(1))]);
        let config = DocumentConfig::default();
        let resolved = resolve_definition_tags(&tags, &ref_map, &config);
        assert_eq!(resolved.len(), 1);
        assert!(resolved[0].is_valid);
        assert_eq!(resolved[0].rendered_text, "#Fig. 1");
    }

    #[test]
    fn resolve_unresolvable_tag() {
        let tags = scan_definition_tags("{#fig:missing}");
        let ref_map = make_ref_map(vec![]);
        let config = DocumentConfig::default();
        let resolved = resolve_definition_tags(&tags, &ref_map, &config);
        assert_eq!(resolved.len(), 1);
        assert!(!resolved[0].is_valid);
        assert_eq!(resolved[0].rendered_text, "{#fig:missing}");
    }

    #[test]
    fn resolve_section_tag() {
        let tags = scan_definition_tags("# Intro {#sec:intro}");
        let ref_map = make_ref_map(vec![make_def(
            RefType::Sec,
            "intro",
            RefNumber::Hierarchical(vec![1, 2]),
        )]);
        let config = DocumentConfig::default();
        let resolved = resolve_definition_tags(&tags, &ref_map, &config);
        assert_eq!(resolved[0].rendered_text, "#Section 1.2");
    }

    #[test]
    fn resolve_chinese_locale() {
        let tags = scan_definition_tags("![Cat](cat.png){#fig:cat}");
        let ref_map = make_ref_map(vec![make_def(RefType::Fig, "cat", RefNumber::Simple(1))]);
        let config = crate::i18n::localized_defaults(crate::i18n::Locale::Zh);
        let resolved = resolve_definition_tags(&tags, &ref_map, &config);
        assert_eq!(resolved[0].rendered_text, "#图 1");
    }
}
