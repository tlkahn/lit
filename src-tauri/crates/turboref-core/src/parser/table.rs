use regex::Regex;
use std::sync::LazyLock;

use crate::config::DocumentConfig;
use crate::types::{Definition, RefNumber, RefType};
use super::{Counters, DefinitionParser};
use super::scan::ScanContext;

static TABLE_CAPTION_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^:(.*?)\s*\{#tbl:([^}]+)\}\s*$").unwrap()
});

pub struct TableParser;

impl DefinitionParser for TableParser {
    fn ref_type(&self) -> RefType {
        RefType::Tbl
    }

    fn prefix_str(&self) -> &str {
        "tbl"
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

        if let Some(caps) = TABLE_CAPTION_RE.captures(line) {
            let caption = caps[1].trim().to_string();
            let id = caps[2].trim().to_string();
            counters.tbl_count += 1;

            return vec![Definition {
                ref_type: RefType::Tbl,
                id,
                number: RefNumber::Simple(counters.tbl_count),
                caption: if caption.is_empty() { None } else { Some(caption) },
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

    fn parse_tables(content: &str) -> Vec<Definition> {
        let config = DocumentConfig::default();
        let mut registry = ParserRegistry::new();
        registry.register(Box::new(TableParser));
        scan_document(content, &config, &registry)
    }

    #[test]
    fn parse_simple_table_caption() {
        let defs = parse_tables(": My table caption {#tbl:data}");
        assert_eq!(defs.len(), 1);
        assert_eq!(defs[0].id, "data");
        assert_eq!(defs[0].number, RefNumber::Simple(1));
        assert_eq!(defs[0].caption, Some("My table caption".to_string()));
        assert_eq!(defs[0].ref_type, RefType::Tbl);
    }

    #[test]
    fn parse_multiple_tables() {
        let content = "\
| A | B |\n\
|---|---|\n\
| 1 | 2 |\n\
: First table {#tbl:first}\n\
\n\
| X | Y |\n\
|---|---|\n\
| 3 | 4 |\n\
: Second table {#tbl:second}";
        let defs = parse_tables(content);
        assert_eq!(defs.len(), 2);
        assert_eq!(defs[0].id, "first");
        assert_eq!(defs[0].number, RefNumber::Simple(1));
        assert_eq!(defs[1].id, "second");
        assert_eq!(defs[1].number, RefNumber::Simple(2));
    }

    #[test]
    fn parse_table_empty_caption() {
        let defs = parse_tables(": {#tbl:nocap}");
        assert_eq!(defs.len(), 1);
        assert_eq!(defs[0].id, "nocap");
        assert_eq!(defs[0].caption, None);
    }

    #[test]
    fn parse_table_in_code_block_ignored() {
        let content = "```\n: Caption {#tbl:inside}\n```";
        let defs = parse_tables(content);
        assert_eq!(defs.len(), 0);
    }

    #[test]
    fn parse_no_tables() {
        let defs = parse_tables("Just some text\nNo tables here");
        assert_eq!(defs.len(), 0);
    }

    #[test]
    fn parse_table_with_unicode_caption() {
        let defs = parse_tables(": 数据表格 {#tbl:zh1}");
        assert_eq!(defs.len(), 1);
        assert_eq!(defs[0].caption, Some("数据表格".to_string()));
    }

    #[test]
    fn parse_table_trailing_whitespace() {
        let defs = parse_tables(": Caption {#tbl:trail}  ");
        assert_eq!(defs.len(), 1);
        assert_eq!(defs[0].id, "trail");
    }

    #[test]
    fn parse_table_with_space_before_tag() {
        let defs = parse_tables(": Caption  {#tbl:spaced}");
        assert_eq!(defs.len(), 1);
        assert_eq!(defs[0].id, "spaced");
        assert_eq!(defs[0].caption, Some("Caption".to_string()));
    }
}
