use regex::Regex;
use std::sync::LazyLock;

use crate::config::DocumentConfig;
use crate::types::{Definition, RefNumber, RefType};
use super::{Counters, DefinitionParser};
use super::scan::ScanContext;

static SEC_ID_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"\{#sec:([^}]+)\}").unwrap()
});

pub struct SectionParser;

impl DefinitionParser for SectionParser {
    fn ref_type(&self) -> RefType {
        RefType::Sec
    }

    fn prefix_str(&self) -> &str {
        "sec"
    }

    fn on_line(
        &self,
        line: &str,
        line_idx: usize,
        char_offset: usize,
        ctx: &ScanContext,
        counters: &mut Counters,
        _config: &DocumentConfig,
    ) -> Vec<Definition> {
        if ctx.in_code_block || ctx.in_math_block {
            return Vec::new();
        }

        if !line.starts_with('#') {
            return Vec::new();
        }

        // Count heading level
        let head_level = line.chars().take_while(|&c| c == '#').count();
        if head_level == 0 || head_level > 6 {
            return Vec::new();
        }

        // Must have a space after the # characters
        let after_hashes = &line[head_level..];
        if !after_hashes.starts_with(' ') {
            return Vec::new();
        }

        let title_raw = after_hashes.trim();

        // Extract section ID if present
        let sec_id = SEC_ID_RE.captures(title_raw).map(|c| c[1].trim().to_string());
        let title = SEC_ID_RE.replace(title_raw, "").trim().to_string();

        // Update counters for ALL headings (not just those with IDs)
        let level_idx = head_level - 1; // 0-based
        counters.sec_levels[level_idx] += 1;

        // Reset all deeper level counters
        for j in head_level..6 {
            counters.sec_levels[j] = 0;
        }

        // Only emit definition if there's an explicit ID
        if let Some(id) = sec_id {
            // Build hierarchical number: "1.2.3"
            let levels: Vec<u32> = counters.sec_levels[..head_level].to_vec();

            return vec![Definition {
                ref_type: RefType::Sec,
                id,
                number: RefNumber::Hierarchical(levels),
                caption: if title.is_empty() { None } else { Some(title) },
                line: line_idx,
                char_offset,
            }];
        }

        Vec::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::parser::scan::scan_document;
    use crate::parser::ParserRegistry;

    fn parse_sections(content: &str) -> Vec<Definition> {
        let config = DocumentConfig::default();
        let mut registry = ParserRegistry::new();
        registry.register(Box::new(SectionParser));
        scan_document(content, &config, &registry)
    }

    #[test]
    fn parse_simple_section() {
        let defs = parse_sections("# Introduction {#sec:intro}");
        assert_eq!(defs.len(), 1);
        assert_eq!(defs[0].id, "intro");
        assert_eq!(defs[0].number, RefNumber::Hierarchical(vec![1]));
        assert_eq!(defs[0].caption, Some("Introduction".to_string()));
    }

    #[test]
    fn parse_hierarchical_numbering() {
        let content = "\
# Chapter 1 {#sec:ch1}\n\
## Section 1.1 {#sec:s11}\n\
## Section 1.2 {#sec:s12}\n\
# Chapter 2 {#sec:ch2}\n\
## Section 2.1 {#sec:s21}";
        let defs = parse_sections(content);
        assert_eq!(defs.len(), 5);
        assert_eq!(defs[0].number, RefNumber::Hierarchical(vec![1]));
        assert_eq!(defs[1].number, RefNumber::Hierarchical(vec![1, 1]));
        assert_eq!(defs[2].number, RefNumber::Hierarchical(vec![1, 2]));
        assert_eq!(defs[3].number, RefNumber::Hierarchical(vec![2]));
        assert_eq!(defs[4].number, RefNumber::Hierarchical(vec![2, 1]));
    }

    #[test]
    fn parse_heading_without_id_affects_numbering() {
        let content = "\
# First\n\
# Second\n\
# Third {#sec:third}";
        let defs = parse_sections(content);
        assert_eq!(defs.len(), 1);
        assert_eq!(defs[0].id, "third");
        // "Third" is the 3rd H1, so number is [3]
        assert_eq!(defs[0].number, RefNumber::Hierarchical(vec![3]));
    }

    #[test]
    fn parse_deep_nesting() {
        let content = "\
# A {#sec:a}\n\
## B {#sec:b}\n\
### C {#sec:c}";
        let defs = parse_sections(content);
        assert_eq!(defs.len(), 3);
        assert_eq!(defs[0].number, RefNumber::Hierarchical(vec![1]));
        assert_eq!(defs[1].number, RefNumber::Hierarchical(vec![1, 1]));
        assert_eq!(defs[2].number, RefNumber::Hierarchical(vec![1, 1, 1]));
    }

    #[test]
    fn parse_deeper_levels_reset_on_shallower() {
        let content = "\
# Ch1 {#sec:ch1}\n\
## S1 {#sec:s1}\n\
### Sub1 {#sec:sub1}\n\
## S2 {#sec:s2}\n\
### Sub2 {#sec:sub2}";
        let defs = parse_sections(content);
        // sub1 = 1.1.1, s2 = 1.2 (resets H3 counter), sub2 = 1.2.1
        assert_eq!(defs[2].number, RefNumber::Hierarchical(vec![1, 1, 1]));
        assert_eq!(defs[3].number, RefNumber::Hierarchical(vec![1, 2]));
        assert_eq!(defs[4].number, RefNumber::Hierarchical(vec![1, 2, 1]));
    }

    #[test]
    fn parse_section_in_code_block_ignored() {
        let content = "```\n# Not a heading {#sec:fake}\n```";
        let defs = parse_sections(content);
        assert_eq!(defs.len(), 0);
    }

    #[test]
    fn parse_no_sections() {
        let defs = parse_sections("Just some text\nNo headings here");
        assert_eq!(defs.len(), 0);
    }

    #[test]
    fn parse_hash_without_space_not_heading() {
        // "#word" is not a valid heading — must have space after #
        let defs = parse_sections("#nospace {#sec:bad}");
        assert_eq!(defs.len(), 0);
    }

    #[test]
    fn parse_section_with_unicode_title() {
        let defs = parse_sections("# 第一章 {#sec:ch1zh}");
        assert_eq!(defs.len(), 1);
        assert_eq!(defs[0].caption, Some("第一章".to_string()));
    }
}
