use regex::Regex;
use std::sync::LazyLock;

use crate::config::DocumentConfig;
use crate::types::{Definition, RefNumber, RefType};
use super::{Counters, DefinitionParser};
use super::scan::ScanContext;

// Next-line bare tag: {#lst:id}
static LST_TAG_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^\s*\{#lst:([^}]+)\}\s*$").unwrap()
});

// Caption-style: : Caption text {#lst:id}
static LST_CAPTION_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^:(.*?)\s*\{#lst:([^}]+)\}\s*$").unwrap()
});

pub struct ListingParser;

impl ListingParser {
    pub fn new() -> Self {
        Self
    }
}

impl DefinitionParser for ListingParser {
    fn ref_type(&self) -> RefType {
        RefType::Lst
    }

    fn prefix_str(&self) -> &str {
        "lst"
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

        // Only check for tag on the line immediately after a code block closes
        if ctx.prev_line_closed_code {
            // Bare tag: {#lst:id}
            if let Some(caps) = LST_TAG_RE.captures(line) {
                let id = caps[1].trim().to_string();
                counters.lst_count += 1;
                return vec![Definition {
                    ref_type: RefType::Lst,
                    id,
                    number: RefNumber::Simple(counters.lst_count),
                    caption: None,
                    line: line_idx,
                    char_offset,
                }];
            }
            // Caption-style: : Caption {#lst:id}
            if let Some(caps) = LST_CAPTION_RE.captures(line) {
                let caption = caps[1].trim().to_string();
                let id = caps[2].trim().to_string();
                counters.lst_count += 1;
                return vec![Definition {
                    ref_type: RefType::Lst,
                    id,
                    number: RefNumber::Simple(counters.lst_count),
                    caption: if caption.is_empty() { None } else { Some(caption) },
                    line: line_idx,
                    char_offset,
                }];
            }
        }

        Vec::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::parser::scan::scan_document;
    use crate::parser::ParserRegistry;

    fn parse_listings(content: &str) -> Vec<Definition> {
        let config = DocumentConfig::default();
        let mut registry = ParserRegistry::new();
        registry.register(Box::new(ListingParser::new()));
        scan_document(content, &config, &registry)
    }

    #[test]
    fn parse_simple_listing() {
        let content = "```python\nprint('hello')\n```\n{#lst:hello}";
        let defs = parse_listings(content);
        assert_eq!(defs.len(), 1);
        assert_eq!(defs[0].id, "hello");
        assert_eq!(defs[0].number, RefNumber::Simple(1));
        assert_eq!(defs[0].ref_type, RefType::Lst);
    }

    #[test]
    fn parse_multiple_listings() {
        let content = "\
```python\nprint('a')\n```\n{#lst:first}\n\
```rust\nfn main() {}\n```\n{#lst:second}";
        let defs = parse_listings(content);
        assert_eq!(defs.len(), 2);
        assert_eq!(defs[0].id, "first");
        assert_eq!(defs[0].number, RefNumber::Simple(1));
        assert_eq!(defs[1].id, "second");
        assert_eq!(defs[1].number, RefNumber::Simple(2));
    }

    #[test]
    fn parse_code_block_without_tag_ignored() {
        let content = "```\nsome code\n```\nJust text after";
        let defs = parse_listings(content);
        assert_eq!(defs.len(), 0);
    }

    #[test]
    fn parse_tag_with_blank_line_ignored() {
        // Blank line between ``` and tag → no definition
        let content = "```\ncode\n```\n\n{#lst:nope}";
        let defs = parse_listings(content);
        assert_eq!(defs.len(), 0);
    }

    #[test]
    fn parse_listing_tag_not_after_code_block() {
        // Tag appearing without a preceding code block → ignored
        let content = "{#lst:orphan}";
        let defs = parse_listings(content);
        assert_eq!(defs.len(), 0);
    }

    #[test]
    fn parse_tilde_fence_listing() {
        let content = "~~~\ncode here\n~~~\n{#lst:tilde}";
        let defs = parse_listings(content);
        assert_eq!(defs.len(), 1);
        assert_eq!(defs[0].id, "tilde");
    }

    #[test]
    fn parse_empty_document() {
        let defs = parse_listings("");
        assert_eq!(defs.len(), 0);
    }

    #[test]
    fn parse_listing_tag_with_whitespace() {
        let content = "```\ncode\n```\n  {#lst:spaced}  ";
        let defs = parse_listings(content);
        assert_eq!(defs.len(), 1);
        assert_eq!(defs[0].id, "spaced");
    }

    // --- Caption-style listing tag tests ---

    #[test]
    fn parse_listing_with_caption() {
        let content = "```python\nprint('hello')\n```\n: My listing {#lst:hello}";
        let defs = parse_listings(content);
        assert_eq!(defs.len(), 1);
        assert_eq!(defs[0].id, "hello");
        assert_eq!(defs[0].caption, Some("My listing".to_string()));
        assert_eq!(defs[0].number, RefNumber::Simple(1));
    }

    #[test]
    fn parse_listing_with_caption_unicode() {
        let content = "```python\ncode\n```\n: 选择最优动作 {#lst:best}";
        let defs = parse_listings(content);
        assert_eq!(defs.len(), 1);
        assert_eq!(defs[0].id, "best");
        assert_eq!(defs[0].caption, Some("选择最优动作".to_string()));
    }

    #[test]
    fn parse_listing_with_empty_caption() {
        let content = "```\ncode\n```\n: {#lst:nocap}";
        let defs = parse_listings(content);
        assert_eq!(defs.len(), 1);
        assert_eq!(defs[0].id, "nocap");
        assert_eq!(defs[0].caption, None);
    }

    #[test]
    fn parse_listing_caption_not_after_code_block() {
        // Caption-style without preceding code block → ignored
        let content = "Some text\n: Caption {#lst:orphan}";
        let defs = parse_listings(content);
        assert_eq!(defs.len(), 0);
    }
}
