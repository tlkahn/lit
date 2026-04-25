use regex::Regex;
use std::sync::LazyLock;

use crate::config::DocumentConfig;
use crate::types::{Definition, RefNumber, RefType};
use super::{Counters, DefinitionParser};
use super::scan::ScanContext;

// Same-line display math: $$E = mc^2$${#eq:id}
static DISPLAY_SAME_LINE_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^\$\$(.+)\$\$\s*\{#eq:([^}]+)\}\s*$").unwrap()
});

// Same-line inline math: $E = mc^2${#eq:id}
// Must not start with $$ (negative: we check the line doesn't start with $$)
static INLINE_SAME_LINE_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?:^|[^$])\$([^$]+)\$\s*\{#eq:([^}]+)\}\s*$").unwrap()
});

// Next-line bare tag: {#eq:id}
static EQ_TAG_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^\s*\{#eq:([^}]+)\}\s*$").unwrap()
});

// Caption-style: : Caption text {#eq:id}
static EQ_CAPTION_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^:(.*?)\s*\{#eq:([^}]+)\}\s*$").unwrap()
});


pub struct EquationParser;

impl EquationParser {
    pub fn new() -> Self {
        Self
    }
}

impl DefinitionParser for EquationParser {
    fn ref_type(&self) -> RefType {
        RefType::Eq
    }

    fn prefix_str(&self) -> &str {
        "eq"
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
        if ctx.in_code_block {
            return Vec::new();
        }

        // 1. Check for next-line tag after display math block closed
        if ctx.prev_line_closed_math {
            // Bare tag: {#eq:id}
            if let Some(caps) = EQ_TAG_RE.captures(line) {
                let id = caps[1].trim().to_string();
                counters.eq_count += 1;
                return vec![Definition {
                    ref_type: RefType::Eq,
                    id,
                    number: RefNumber::Simple(counters.eq_count),
                    caption: None,
                    line: line_idx,
                    char_offset,
                }];
            }
            // Caption-style: : Caption {#eq:id}
            if let Some(caps) = EQ_CAPTION_RE.captures(line) {
                let caption = caps[1].trim().to_string();
                let id = caps[2].trim().to_string();
                counters.eq_count += 1;
                return vec![Definition {
                    ref_type: RefType::Eq,
                    id,
                    number: RefNumber::Simple(counters.eq_count),
                    caption: if caption.is_empty() { None } else { Some(caption) },
                    line: line_idx,
                    char_offset,
                }];
            }
        }

        // Don't parse inside math blocks (content lines)
        if ctx.in_math_block {
            return Vec::new();
        }

        // 2. Same-line display math: $$...$${#eq:id}
        if let Some(caps) = DISPLAY_SAME_LINE_RE.captures(line) {
            let id = caps[2].trim().to_string();
            counters.eq_count += 1;
            return vec![Definition {
                ref_type: RefType::Eq,
                id,
                number: RefNumber::Simple(counters.eq_count),
                caption: None,
                line: line_idx,
                char_offset,
            }];
        }

        // 3. Same-line inline math: $...$\{#eq:id}
        if let Some(caps) = INLINE_SAME_LINE_RE.captures(line) {
            let id = caps[2].trim().to_string();
            counters.eq_count += 1;
            return vec![Definition {
                ref_type: RefType::Eq,
                id,
                number: RefNumber::Simple(counters.eq_count),
                caption: None,
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

    fn parse_equations(content: &str) -> Vec<Definition> {
        let config = DocumentConfig::default();
        let mut registry = ParserRegistry::new();
        registry.register(Box::new(EquationParser::new()));
        scan_document(content, &config, &registry)
    }

    #[test]
    fn parse_display_same_line() {
        let defs = parse_equations("$$E = mc^2$${#eq:einstein}");
        assert_eq!(defs.len(), 1);
        assert_eq!(defs[0].id, "einstein");
        assert_eq!(defs[0].number, RefNumber::Simple(1));
        assert_eq!(defs[0].ref_type, RefType::Eq);
    }

    #[test]
    fn parse_inline_same_line() {
        let defs = parse_equations("$E = mc^2${#eq:einstein}");
        assert_eq!(defs.len(), 1);
        assert_eq!(defs[0].id, "einstein");
        assert_eq!(defs[0].number, RefNumber::Simple(1));
    }

    #[test]
    fn parse_display_next_line() {
        let content = "$$\nE = mc^2\n$$\n{#eq:einstein}";
        let defs = parse_equations(content);
        assert_eq!(defs.len(), 1);
        assert_eq!(defs[0].id, "einstein");
        assert_eq!(defs[0].number, RefNumber::Simple(1));
    }

    #[test]
    fn parse_display_next_line_no_tag() {
        // No tag after $$ → no definition
        let content = "$$\nE = mc^2\n$$\nSome text";
        let defs = parse_equations(content);
        assert_eq!(defs.len(), 0);
    }

    #[test]
    fn parse_display_next_line_blank_line_between() {
        // Blank line between $$ and tag → no definition
        let content = "$$\nE = mc^2\n$$\n\n{#eq:einstein}";
        let defs = parse_equations(content);
        assert_eq!(defs.len(), 0);
    }

    #[test]
    fn parse_multiple_equations() {
        let content = "\
$$a^2 + b^2 = c^2$${#eq:pythag}\n\
$$\nF = ma\n$$\n{#eq:newton}";
        let defs = parse_equations(content);
        assert_eq!(defs.len(), 2);
        assert_eq!(defs[0].id, "pythag");
        assert_eq!(defs[0].number, RefNumber::Simple(1));
        assert_eq!(defs[1].id, "newton");
        assert_eq!(defs[1].number, RefNumber::Simple(2));
    }

    #[test]
    fn parse_equation_in_code_block_ignored() {
        let content = "```\n$$E = mc^2$${#eq:fake}\n```";
        let defs = parse_equations(content);
        assert_eq!(defs.len(), 0);
    }

    #[test]
    fn parse_empty_document() {
        let defs = parse_equations("");
        assert_eq!(defs.len(), 0);
    }

    #[test]
    fn parse_display_math_without_tag_ignored() {
        let content = "$$\nE = mc^2\n$$";
        let defs = parse_equations(content);
        assert_eq!(defs.len(), 0);
    }

    #[test]
    fn parse_inline_same_line_not_confused_with_display() {
        // $x$ should match inline, not display
        let defs = parse_equations("$x${#eq:var}");
        assert_eq!(defs.len(), 1);
        assert_eq!(defs[0].id, "var");
    }

    #[test]
    fn parse_same_line_with_trailing_space() {
        let defs = parse_equations("$$E = mc^2$${#eq:einstein}  ");
        assert_eq!(defs.len(), 1);
        assert_eq!(defs[0].id, "einstein");
    }

    // --- Caption-style equation tag tests ---

    #[test]
    fn parse_equation_with_caption() {
        let content = "$$\nE = mc^2\n$$\n: Einstein's equation {#eq:einstein}";
        let defs = parse_equations(content);
        assert_eq!(defs.len(), 1);
        assert_eq!(defs[0].id, "einstein");
        assert_eq!(defs[0].caption, Some("Einstein's equation".to_string()));
        assert_eq!(defs[0].number, RefNumber::Simple(1));
    }

    #[test]
    fn parse_equation_with_caption_unicode() {
        let content = "$$\nE = mc^2\n$$\n: 爱因斯坦方程 {#eq:einstein}";
        let defs = parse_equations(content);
        assert_eq!(defs.len(), 1);
        assert_eq!(defs[0].caption, Some("爱因斯坦方程".to_string()));
    }

    #[test]
    fn parse_equation_with_empty_caption() {
        let content = "$$\nE = mc^2\n$$\n: {#eq:einstein}";
        let defs = parse_equations(content);
        assert_eq!(defs.len(), 1);
        assert_eq!(defs[0].id, "einstein");
        assert_eq!(defs[0].caption, None);
    }

    #[test]
    fn parse_equation_caption_not_after_math() {
        // Caption-style without preceding $$ block → ignored
        let content = "Some text\n: Caption {#eq:orphan}";
        let defs = parse_equations(content);
        assert_eq!(defs.len(), 0);
    }
}
