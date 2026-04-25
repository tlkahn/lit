use regex::Regex;
use std::sync::LazyLock;

use crate::config::DocumentConfig;
use crate::types::{Definition, RefNumber, RefType};
use super::{Counters, DefinitionParser, PendingFigure, PendingImage};
use super::scan::ScanContext;

// Same-line: ![desc](src){#fig:id} or ![desc](src) {#fig:id}
static IMAGE_WITH_TAG_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"!\[(.*?)\]\((.*?)\)\s*\{#fig:([^}]+)\}").unwrap()
});

// Image without inline tag
static IMAGE_NO_TAG_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^!\[(.*?)\]\((.*?)\)\s*$").unwrap()
});

// Next-line standalone tag: {#fig:id}
static FIG_TAG_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^\s*\{#fig:([^}]+)\}\s*$").unwrap()
});

// Caption line: : Caption text {#fig:id}
static FIG_CAPTION_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^:(.*?)\s*\{#fig:([^}]+)\}\s*$").unwrap()
});

static SUBFIG_OPEN_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"<div\s+id="fig:([^"]+)">"#).unwrap()
});

pub struct FigureParser;

impl FigureParser {
    /// Extract the main caption from accumulated sub-figure lines (<div> syntax).
    fn extract_subfig_caption(lines: &[String]) -> Option<String> {
        for line in lines.iter().rev() {
            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }
            if IMAGE_WITH_TAG_RE.is_match(trimmed) {
                continue;
            }
            if trimmed.starts_with("<div") || trimmed.starts_with("</div") {
                continue;
            }
            return Some(trimmed.to_string());
        }
        None
    }

    /// Flush accumulated images as standalone figures.
    fn flush_accumulator(counters: &mut Counters) -> Vec<Definition> {
        let mut defs = Vec::new();
        let images = std::mem::take(&mut counters.image_acc.images);
        counters.image_acc.awaiting_tag = false;

        for img in images {
            if let Some(id) = img.id {
                counters.fig_count += 1;
                defs.push(Definition {
                    ref_type: RefType::Fig,
                    id,
                    number: RefNumber::Simple(counters.fig_count),
                    caption: Some(img.description),
                    line: img.line,
                    char_offset: img.char_offset,
                });
            }
        }
        defs
    }

    /// Finalize accumulated images as sub-figures with a main caption figure.
    fn finalize_as_subfigures(
        counters: &mut Counters,
        main_caption: String,
        main_id: String,
        caption_line: usize,
        caption_char_offset: usize,
    ) -> Vec<Definition> {
        let mut defs = Vec::new();
        let images = std::mem::take(&mut counters.image_acc.images);
        counters.image_acc.awaiting_tag = false;

        counters.fig_count += 1;
        let main_number = counters.fig_count;

        let mut sub_count: u32 = 0;
        for img in &images {
            sub_count += 1;
            let letter = (b'a' + (sub_count - 1) as u8) as char;
            if let Some(ref id) = img.id {
                defs.push(Definition {
                    ref_type: RefType::Fig,
                    id: id.clone(),
                    number: RefNumber::SubNumbered(main_number, letter),
                    caption: Some(img.description.clone()),
                    line: img.line,
                    char_offset: img.char_offset,
                });
            }
        }

        defs.push(Definition {
            ref_type: RefType::Fig,
            id: main_id,
            number: RefNumber::Simple(main_number),
            caption: if main_caption.is_empty() { None } else { Some(main_caption) },
            line: caption_line,
            char_offset: caption_char_offset,
        });

        defs
    }
}

impl DefinitionParser for FigureParser {
    fn ref_type(&self) -> RefType {
        RefType::Fig
    }

    fn prefix_str(&self) -> &str {
        "fig"
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
        // Skip inside code or math blocks — flush any pending state
        if ctx.in_code_block || ctx.in_math_block {
            let defs = Self::flush_accumulator(counters);
            counters.pending_fig = PendingFigure::default();
            return defs;
        }

        let trimmed = line.trim();

        // ========================================
        // PART A: Inside <div> sub-figure block
        // ========================================
        if counters.sub_fig.active {
            let mut defs = Vec::new();

            // Check pending_fig for next-line tag inside <div>
            if counters.pending_fig.active {
                let pending = std::mem::take(&mut counters.pending_fig);
                if let Some(caps) = FIG_TAG_RE.captures(trimmed) {
                    let id = caps[1].trim().to_string();
                    counters.sub_fig.current_count += 1;
                    let letter = (b'a' + (counters.sub_fig.current_count - 1) as u8) as char;
                    defs.push(Definition {
                        ref_type: RefType::Fig,
                        id,
                        number: RefNumber::SubNumbered(counters.sub_fig.main_number, letter),
                        caption: Some(pending.description),
                        line: pending.line,
                        char_offset: pending.char_offset,
                    });
                    return defs;
                }
            }

            // Check for </div> close
            if trimmed == "</div>" {
                let caption = Self::extract_subfig_caption(&counters.sub_fig.accumulated_lines);
                defs.push(Definition {
                    ref_type: RefType::Fig,
                    id: counters.sub_fig.main_id.clone(),
                    number: RefNumber::Simple(counters.sub_fig.main_number),
                    caption,
                    line: line_idx,
                    char_offset,
                });
                counters.sub_fig = super::SubFigState::default();
                return defs;
            }

            // Accumulate line
            counters.sub_fig.accumulated_lines.push(line.to_string());

            // Image with inline tag inside <div>
            if let Some(caps) = IMAGE_WITH_TAG_RE.captures(line) {
                let description = caps[1].to_string();
                let id = caps[3].to_string();
                counters.sub_fig.current_count += 1;
                let letter = (b'a' + (counters.sub_fig.current_count - 1) as u8) as char;
                defs.push(Definition {
                    ref_type: RefType::Fig,
                    id,
                    number: RefNumber::SubNumbered(counters.sub_fig.main_number, letter),
                    caption: Some(description),
                    line: line_idx,
                    char_offset,
                });
                return defs;
            }

            // Image without tag inside <div>
            if let Some(caps) = IMAGE_NO_TAG_RE.captures(line) {
                counters.pending_fig = PendingFigure {
                    active: true,
                    description: caps[1].to_string(),
                    line: line_idx,
                    char_offset,
                };
            }

            return defs;
        }

        // ========================================
        // PART B: Outside <div> — use image accumulator
        // ========================================

        // B-pre. Check for {#fig:id} after a code block (e.g., mermaid/dot/d2/plantuml/excalidraw)
        if ctx.prev_line_closed_code {
            if let Some(caps) = FIG_TAG_RE.captures(trimmed) {
                let id = caps[1].trim().to_string();
                counters.fig_count += 1;
                return vec![Definition {
                    ref_type: RefType::Fig,
                    id,
                    number: RefNumber::Simple(counters.fig_count),
                    caption: None,
                    line: line_idx,
                    char_offset,
                }];
            }
        }

        // B0. If awaiting tag for last untagged image
        if counters.image_acc.awaiting_tag {
            if let Some(caps) = FIG_TAG_RE.captures(trimmed) {
                // Assign tag to last image in accumulator
                if let Some(last) = counters.image_acc.images.last_mut() {
                    last.id = Some(caps[1].trim().to_string());
                }
                counters.image_acc.awaiting_tag = false;
                return Vec::new();
            }
            // Not a tag — stop waiting, fall through
            counters.image_acc.awaiting_tag = false;
        }

        // B1. Caption line: `: Caption {#fig:id}`
        if let Some(caps) = FIG_CAPTION_RE.captures(trimmed) {
            if !counters.image_acc.images.is_empty() {
                let caption = caps[1].trim().to_string();
                let id = caps[2].trim().to_string();
                return Self::finalize_as_subfigures(
                    counters, caption, id, line_idx, char_offset,
                );
            }
            // Orphan caption — ignore
            return Vec::new();
        }

        // B2. <div> open — flush accumulator first, then enter div mode
        if let Some(caps) = SUBFIG_OPEN_RE.captures(trimmed) {
            let defs = Self::flush_accumulator(counters);
            let main_id = caps[1].to_string();
            counters.fig_count += 1;
            counters.sub_fig = super::SubFigState {
                active: true,
                main_id,
                main_number: counters.fig_count,
                current_count: 0,
                accumulated_lines: Vec::new(),
            };
            return defs;
        }

        // B3. Image with inline tag — push to accumulator
        if let Some(caps) = IMAGE_WITH_TAG_RE.captures(line) {
            counters.image_acc.images.push(PendingImage {
                description: caps[1].to_string(),
                id: Some(caps[3].to_string()),
                line: line_idx,
                char_offset,
            });
            return Vec::new();
        }

        // B4. Image without tag — push to accumulator, await next-line tag
        if let Some(caps) = IMAGE_NO_TAG_RE.captures(line) {
            counters.image_acc.images.push(PendingImage {
                description: caps[1].to_string(),
                id: None,
                line: line_idx,
                char_offset,
            });
            counters.image_acc.awaiting_tag = true;
            return Vec::new();
        }

        // B5. Non-image, non-caption line — flush accumulator as standalone
        Self::flush_accumulator(counters)
    }

    fn on_end(&self, counters: &mut Counters) -> Vec<Definition> {
        Self::flush_accumulator(counters)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::parser::scan::scan_document;
    use crate::parser::ParserRegistry;

    /// Helper: parse content with only the FigureParser and return definitions.
    fn parse_figures(content: &str) -> Vec<Definition> {
        let config = DocumentConfig::default();
        let mut registry = ParserRegistry::new();
        registry.register(Box::new(FigureParser));
        scan_document(content, &config, &registry)
    }

    #[test]
    fn parse_standalone_figure() {
        let defs = parse_figures("![A cat](cat.png){#fig:cat}");
        assert_eq!(defs.len(), 1);
        assert_eq!(defs[0].id, "cat");
        assert_eq!(defs[0].number, RefNumber::Simple(1));
        assert_eq!(defs[0].caption, Some("A cat".to_string()));
        assert_eq!(defs[0].ref_type, RefType::Fig);
    }

    #[test]
    fn parse_multiple_figures() {
        let content = "![Cat](cat.png){#fig:cat}\n![Dog](dog.png){#fig:dog}";
        let defs = parse_figures(content);
        assert_eq!(defs.len(), 2);
        assert_eq!(defs[0].id, "cat");
        assert_eq!(defs[0].number, RefNumber::Simple(1));
        assert_eq!(defs[1].id, "dog");
        assert_eq!(defs[1].number, RefNumber::Simple(2));
    }

    #[test]
    fn parse_subfigure_block() {
        let content = "\
<div id=\"fig:animals\">\n\
![Cat](cat.png){#fig:cat}\n\
![Dog](dog.png){#fig:dog}\n\
Animal collection\n\
</div>";
        let defs = parse_figures(content);
        assert_eq!(defs.len(), 3);
        assert_eq!(defs[0].id, "cat");
        assert_eq!(defs[0].number, RefNumber::SubNumbered(1, 'a'));
        assert_eq!(defs[0].caption, Some("Cat".to_string()));
        assert_eq!(defs[1].id, "dog");
        assert_eq!(defs[1].number, RefNumber::SubNumbered(1, 'b'));
        assert_eq!(defs[1].caption, Some("Dog".to_string()));
        assert_eq!(defs[2].id, "animals");
        assert_eq!(defs[2].number, RefNumber::Simple(1));
        assert_eq!(defs[2].caption, Some("Animal collection".to_string()));
    }

    #[test]
    fn parse_mixed_standalone_and_subfig() {
        let content = "\
![First](first.png){#fig:first}\n\
<div id=\"fig:group\">\n\
![A](a.png){#fig:a}\n\
![B](b.png){#fig:b}\n\
Group caption\n\
</div>\n\
![Third](third.png){#fig:third}";
        let defs = parse_figures(content);
        assert_eq!(defs.len(), 5);
        assert_eq!(defs[0].id, "first");
        assert_eq!(defs[0].number, RefNumber::Simple(1));
        assert_eq!(defs[1].id, "a");
        assert_eq!(defs[1].number, RefNumber::SubNumbered(2, 'a'));
        assert_eq!(defs[2].id, "b");
        assert_eq!(defs[2].number, RefNumber::SubNumbered(2, 'b'));
        assert_eq!(defs[3].id, "group");
        assert_eq!(defs[3].number, RefNumber::Simple(2));
        assert_eq!(defs[4].id, "third");
        assert_eq!(defs[4].number, RefNumber::Simple(3));
    }

    #[test]
    fn parse_subfig_caption_extraction() {
        let content = "\
<div id=\"fig:main\">\n\
![A](a.png){#fig:a}\n\
\n\
Some text line\n\
The actual caption\n\
</div>";
        let defs = parse_figures(content);
        let main_def = defs.iter().find(|d| d.id == "main").unwrap();
        assert_eq!(main_def.caption, Some("The actual caption".to_string()));
    }

    #[test]
    fn parse_image_without_tag_ignored() {
        let content = "![No tag](img.png)\nSome text\n![Also no tag](other.png)";
        let defs = parse_figures(content);
        assert_eq!(defs.len(), 0);
    }

    #[test]
    fn parse_figure_in_code_block_ignored() {
        let content = "```\n![A cat](cat.png){#fig:cat}\n```";
        let defs = parse_figures(content);
        assert_eq!(defs.len(), 0);
    }

    #[test]
    fn parse_empty_document() {
        let defs = parse_figures("");
        assert_eq!(defs.len(), 0);
    }

    #[test]
    fn parse_subfig_letter_sequence() {
        let content = "\
<div id=\"fig:quad\">\n\
![A](a.png){#fig:qa}\n\
![B](b.png){#fig:qb}\n\
![C](c.png){#fig:qc}\n\
![D](d.png){#fig:qd}\n\
Four images\n\
</div>";
        let defs = parse_figures(content);
        assert_eq!(defs.len(), 5);
        assert_eq!(defs[0].number, RefNumber::SubNumbered(1, 'a'));
        assert_eq!(defs[1].number, RefNumber::SubNumbered(1, 'b'));
        assert_eq!(defs[2].number, RefNumber::SubNumbered(1, 'c'));
        assert_eq!(defs[3].number, RefNumber::SubNumbered(1, 'd'));
        assert_eq!(defs[4].number, RefNumber::Simple(1));
    }

    #[test]
    fn parse_figure_with_unicode_caption() {
        let defs = parse_figures("![图片描述](img.png){#fig:zh1}");
        assert_eq!(defs.len(), 1);
        assert_eq!(defs[0].id, "zh1");
        assert_eq!(defs[0].caption, Some("图片描述".to_string()));
        assert_eq!(defs[0].number, RefNumber::Simple(1));
    }

    #[test]
    fn parse_figure_with_space_before_tag() {
        let defs = parse_figures("![Sunset](sunset.png) {#fig:sunset}");
        assert_eq!(defs.len(), 1);
        assert_eq!(defs[0].id, "sunset");
        assert_eq!(defs[0].number, RefNumber::Simple(1));
    }

    #[test]
    fn parse_figure_with_multiple_spaces_before_tag() {
        let defs = parse_figures("![Sunset](sunset.png)   {#fig:sunset}");
        assert_eq!(defs.len(), 1);
        assert_eq!(defs[0].id, "sunset");
    }

    #[test]
    fn parse_figure_with_tab_before_tag() {
        let defs = parse_figures("![Sunset](sunset.png)\t{#fig:sunset}");
        assert_eq!(defs.len(), 1);
        assert_eq!(defs[0].id, "sunset");
    }

    // --- Next-line tag tests ---

    #[test]
    fn parse_figure_next_line_tag() {
        let content = "![A sunset](sunset.png)\n{#fig:sunset}";
        let defs = parse_figures(content);
        assert_eq!(defs.len(), 1);
        assert_eq!(defs[0].id, "sunset");
        assert_eq!(defs[0].number, RefNumber::Simple(1));
        assert_eq!(defs[0].caption, Some("A sunset".to_string()));
    }

    #[test]
    fn parse_figure_next_line_tag_with_indent() {
        let content = "![A sunset](sunset.png)\n  {#fig:sunset}";
        let defs = parse_figures(content);
        assert_eq!(defs.len(), 1);
        assert_eq!(defs[0].id, "sunset");
    }

    #[test]
    fn parse_figure_next_line_blank_line_no_match() {
        let content = "![A sunset](sunset.png)\n\n{#fig:sunset}";
        let defs = parse_figures(content);
        assert_eq!(defs.len(), 0);
    }

    #[test]
    fn parse_figure_next_line_numbering() {
        let content = "\
![First](a.png){#fig:first}\n\
![Second](b.png)\n\
{#fig:second}\n\
![Third](c.png){#fig:third}";
        let defs = parse_figures(content);
        assert_eq!(defs.len(), 3);
        assert_eq!(defs[0].number, RefNumber::Simple(1));
        assert_eq!(defs[1].number, RefNumber::Simple(2));
        assert_eq!(defs[2].number, RefNumber::Simple(3));
    }

    #[test]
    fn parse_figure_next_line_image_without_following_tag() {
        let content = "![No tag](img.png)\nJust regular text";
        let defs = parse_figures(content);
        assert_eq!(defs.len(), 0);
    }

    // --- Caption-based sub-figure tests ---

    #[test]
    fn parse_caption_subfig_basic() {
        let content = "\
![Cat](cat.png){#fig:cat}\n\
![Dog](dog.png){#fig:dog}\n\
: Animals {#fig:animals}";
        let defs = parse_figures(content);
        assert_eq!(defs.len(), 3);
        assert_eq!(defs[0].id, "cat");
        assert_eq!(defs[0].number, RefNumber::SubNumbered(1, 'a'));
        assert_eq!(defs[1].id, "dog");
        assert_eq!(defs[1].number, RefNumber::SubNumbered(1, 'b'));
        assert_eq!(defs[2].id, "animals");
        assert_eq!(defs[2].number, RefNumber::Simple(1));
        assert_eq!(defs[2].caption, Some("Animals".to_string()));
    }

    #[test]
    fn parse_caption_subfig_single_image() {
        let content = "![Cat](cat.png){#fig:cat}\n: Animals {#fig:animals}";
        let defs = parse_figures(content);
        assert_eq!(defs.len(), 2);
        assert_eq!(defs[0].number, RefNumber::SubNumbered(1, 'a'));
        assert_eq!(defs[1].number, RefNumber::Simple(1));
    }

    #[test]
    fn parse_caption_subfig_three_images() {
        let content = "\
![A](a.png){#fig:a}\n\
![B](b.png){#fig:b}\n\
![C](c.png){#fig:c}\n\
: Group {#fig:group}";
        let defs = parse_figures(content);
        assert_eq!(defs.len(), 4);
        assert_eq!(defs[0].number, RefNumber::SubNumbered(1, 'a'));
        assert_eq!(defs[1].number, RefNumber::SubNumbered(1, 'b'));
        assert_eq!(defs[2].number, RefNumber::SubNumbered(1, 'c'));
        assert_eq!(defs[3].number, RefNumber::Simple(1));
    }

    #[test]
    fn parse_caption_subfig_with_standalone_before() {
        let content = "\
![First](first.png){#fig:first}\n\
\n\
![A](a.png){#fig:a}\n\
![B](b.png){#fig:b}\n\
: Group {#fig:group}";
        let defs = parse_figures(content);
        assert_eq!(defs.len(), 4);
        assert_eq!(defs[0].id, "first");
        assert_eq!(defs[0].number, RefNumber::Simple(1));
        assert_eq!(defs[1].number, RefNumber::SubNumbered(2, 'a'));
        assert_eq!(defs[2].number, RefNumber::SubNumbered(2, 'b'));
        assert_eq!(defs[3].number, RefNumber::Simple(2));
    }

    #[test]
    fn parse_caption_subfig_with_standalone_after() {
        let content = "\
![A](a.png){#fig:a}\n\
![B](b.png){#fig:b}\n\
: Group {#fig:group}\n\
![Third](third.png){#fig:third}";
        let defs = parse_figures(content);
        assert_eq!(defs.len(), 4);
        assert_eq!(defs[0].number, RefNumber::SubNumbered(1, 'a'));
        assert_eq!(defs[1].number, RefNumber::SubNumbered(1, 'b'));
        assert_eq!(defs[2].id, "group");
        assert_eq!(defs[2].number, RefNumber::Simple(1));
        assert_eq!(defs[3].id, "third");
        assert_eq!(defs[3].number, RefNumber::Simple(2));
    }

    #[test]
    fn parse_caption_subfig_mixed_tagged_untagged() {
        let content = "\
![Cat](cat.png){#fig:cat}\n\
![Random dog](dog.png)\n\
![Bird](bird.png){#fig:bird}\n\
: Animals {#fig:animals}";
        let defs = parse_figures(content);
        assert_eq!(defs.len(), 3);
        assert_eq!(defs[0].id, "cat");
        assert_eq!(defs[0].number, RefNumber::SubNumbered(1, 'a'));
        assert_eq!(defs[1].id, "bird");
        assert_eq!(defs[1].number, RefNumber::SubNumbered(1, 'c'));
        assert_eq!(defs[2].id, "animals");
        assert_eq!(defs[2].number, RefNumber::Simple(1));
    }

    #[test]
    fn parse_caption_subfig_next_line_tag_in_group() {
        let content = "\
![Cat](cat.png)\n\
{#fig:cat}\n\
![Dog](dog.png){#fig:dog}\n\
: Animals {#fig:animals}";
        let defs = parse_figures(content);
        assert_eq!(defs.len(), 3);
        assert_eq!(defs[0].id, "cat");
        assert_eq!(defs[0].number, RefNumber::SubNumbered(1, 'a'));
        assert_eq!(defs[1].id, "dog");
        assert_eq!(defs[1].number, RefNumber::SubNumbered(1, 'b'));
        assert_eq!(defs[2].id, "animals");
        assert_eq!(defs[2].number, RefNumber::Simple(1));
    }

    #[test]
    fn parse_caption_subfig_blank_line_breaks() {
        let content = "\
![Cat](cat.png){#fig:cat}\n\
\n\
![Dog](dog.png){#fig:dog}\n\
: Animals {#fig:animals}";
        let defs = parse_figures(content);
        assert_eq!(defs.len(), 3);
        assert_eq!(defs[0].id, "cat");
        assert_eq!(defs[0].number, RefNumber::Simple(1));
        assert_eq!(defs[1].id, "dog");
        assert_eq!(defs[1].number, RefNumber::SubNumbered(2, 'a'));
        assert_eq!(defs[2].id, "animals");
        assert_eq!(defs[2].number, RefNumber::Simple(2));
    }

    #[test]
    fn parse_caption_subfig_text_breaks() {
        let content = "\
![Cat](cat.png){#fig:cat}\n\
Some text\n\
![Dog](dog.png){#fig:dog}";
        let defs = parse_figures(content);
        assert_eq!(defs.len(), 2);
        assert_eq!(defs[0].number, RefNumber::Simple(1));
        assert_eq!(defs[1].number, RefNumber::Simple(2));
    }

    #[test]
    fn parse_caption_subfig_empty_caption() {
        let content = "\
![A](a.png){#fig:a}\n\
: {#fig:group}";
        let defs = parse_figures(content);
        assert_eq!(defs.len(), 2);
        assert_eq!(defs[1].id, "group");
        assert_eq!(defs[1].caption, None);
    }

    #[test]
    fn parse_caption_subfig_unicode_caption() {
        let content = "\
![猫](cat.png){#fig:cat}\n\
: 动物对比 {#fig:animals}";
        let defs = parse_figures(content);
        assert_eq!(defs.len(), 2);
        assert_eq!(defs[1].caption, Some("动物对比".to_string()));
    }

    #[test]
    fn parse_caption_subfig_numbering_with_div() {
        let content = "\
<div id=\"fig:divgroup\">\n\
![A](a.png){#fig:a}\n\
![B](b.png){#fig:b}\n\
Div caption\n\
</div>\n\
![C](c.png){#fig:c}\n\
![D](d.png){#fig:d}\n\
: Caption group {#fig:capgroup}";
        let defs = parse_figures(content);
        let div_main = defs.iter().find(|d| d.id == "divgroup").unwrap();
        assert_eq!(div_main.number, RefNumber::Simple(1));
        let cap_main = defs.iter().find(|d| d.id == "capgroup").unwrap();
        assert_eq!(cap_main.number, RefNumber::Simple(2));
        let c = defs.iter().find(|d| d.id == "c").unwrap();
        assert_eq!(c.number, RefNumber::SubNumbered(2, 'a'));
    }

    #[test]
    fn parse_caption_subfig_no_images_ignored() {
        let content = "Some text\n: Orphan {#fig:orphan}";
        let defs = parse_figures(content);
        assert_eq!(defs.len(), 0);
    }

    #[test]
    fn parse_caption_subfig_eof_flushes() {
        let content = "![A](a.png){#fig:a}\n![B](b.png){#fig:b}";
        let defs = parse_figures(content);
        assert_eq!(defs.len(), 2);
        assert_eq!(defs[0].number, RefNumber::Simple(1));
        assert_eq!(defs[1].number, RefNumber::Simple(2));
    }

    #[test]
    fn parse_caption_subfig_consecutive_groups() {
        let content = "\
![A](a.png){#fig:a}\n\
![B](b.png){#fig:b}\n\
: Group1 {#fig:g1}\n\
![C](c.png){#fig:c}\n\
![D](d.png){#fig:d}\n\
: Group2 {#fig:g2}";
        let defs = parse_figures(content);
        assert_eq!(defs.len(), 6);
        assert_eq!(defs[0].number, RefNumber::SubNumbered(1, 'a'));
        assert_eq!(defs[1].number, RefNumber::SubNumbered(1, 'b'));
        assert_eq!(defs[2].number, RefNumber::Simple(1));
        assert_eq!(defs[3].number, RefNumber::SubNumbered(2, 'a'));
        assert_eq!(defs[4].number, RefNumber::SubNumbered(2, 'b'));
        assert_eq!(defs[5].number, RefNumber::Simple(2));
    }

    #[test]
    fn parse_caption_subfig_in_code_block() {
        let content = "```\n![A](a.png){#fig:a}\n: Cap {#fig:cap}\n```";
        let defs = parse_figures(content);
        assert_eq!(defs.len(), 0);
    }

    // --- Figure tag after code blocks (diagram-as-image) ---

    #[test]
    fn parse_fig_after_mermaid_block() {
        let content = "```mermaid\ngraph LR\n    A --> B\n```\n{#fig:diagram}";
        let defs = parse_figures(content);
        assert_eq!(defs.len(), 1);
        assert_eq!(defs[0].id, "diagram");
        assert_eq!(defs[0].number, RefNumber::Simple(1));
    }

    #[test]
    fn parse_fig_after_dot_block() {
        let content = "```dot\ndigraph { A -> B }\n```\n{#fig:dotgraph}";
        let defs = parse_figures(content);
        assert_eq!(defs.len(), 1);
        assert_eq!(defs[0].id, "dotgraph");
    }

    #[test]
    fn parse_fig_after_plantuml_block() {
        let content = "```plantuml\nAlice -> Bob: hello\n```\n{#fig:sequence}";
        let defs = parse_figures(content);
        assert_eq!(defs.len(), 1);
        assert_eq!(defs[0].id, "sequence");
    }

    #[test]
    fn parse_fig_after_d2_block() {
        let content = "```d2\nx -> y\n```\n{#fig:d2dia}";
        let defs = parse_figures(content);
        assert_eq!(defs.len(), 1);
        assert_eq!(defs[0].id, "d2dia");
    }

    #[test]
    fn parse_fig_after_excalidraw_block() {
        let content = "```excalidraw\n{\"elements\":[]}\n```\n{#fig:sketch}";
        let defs = parse_figures(content);
        assert_eq!(defs.len(), 1);
        assert_eq!(defs[0].id, "sketch");
    }

    #[test]
    fn parse_fig_after_tikz_block() {
        let content = "```tikz\n\\draw (0,0) -- (1,1);\n```\n{#fig:tikzfig}";
        let defs = parse_figures(content);
        assert_eq!(defs.len(), 1);
        assert_eq!(defs[0].id, "tikzfig");
    }

    #[test]
    fn parse_fig_after_generic_code_block() {
        let content = "```\nsome code\n```\n{#fig:output}";
        let defs = parse_figures(content);
        assert_eq!(defs.len(), 1);
        assert_eq!(defs[0].id, "output");
    }

    #[test]
    fn parse_fig_after_code_block_blank_line_no_match() {
        let content = "```mermaid\ngraph LR\n```\n\n{#fig:diagram}";
        let defs = parse_figures(content);
        assert_eq!(defs.len(), 0);
    }

    #[test]
    fn parse_fig_after_code_block_numbering() {
        let content = "![First](a.png){#fig:a}\n\n```mermaid\ngraph LR\n```\n{#fig:b}";
        let defs = parse_figures(content);
        assert_eq!(defs.len(), 2);
        assert_eq!(defs[0].id, "a");
        assert_eq!(defs[0].number, RefNumber::Simple(1));
        assert_eq!(defs[1].id, "b");
        assert_eq!(defs[1].number, RefNumber::Simple(2));
    }

    #[test]
    fn parse_lst_and_fig_dont_conflict() {
        let config = DocumentConfig::default();
        let registry = ParserRegistry::with_builtins();
        let content = "```python\ncode\n```\n{#lst:code}\n\n```mermaid\ngraph\n```\n{#fig:diagram}";
        let defs = scan_document(content, &config, &registry);
        let fig_defs: Vec<_> = defs.iter().filter(|d| d.ref_type == RefType::Fig).collect();
        let lst_defs: Vec<_> = defs.iter().filter(|d| d.ref_type == RefType::Lst).collect();
        assert_eq!(fig_defs.len(), 1);
        assert_eq!(fig_defs[0].id, "diagram");
        assert_eq!(lst_defs.len(), 1);
        assert_eq!(lst_defs[0].id, "code");
    }
}
