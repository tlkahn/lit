pub fn extract_first_paragraph(body: &str) -> String {
    let mut paragraph_lines: Vec<&str> = Vec::new();

    for line in body.lines() {
        let trimmed = line.trim();

        if trimmed.is_empty() {
            if !paragraph_lines.is_empty() {
                break;
            }
            continue;
        }

        if trimmed.starts_with('#') {
            if !paragraph_lines.is_empty() {
                break;
            }
            continue;
        }

        if is_horizontal_rule(trimmed) {
            if !paragraph_lines.is_empty() {
                break;
            }
            continue;
        }

        if is_blockquote_only(trimmed) {
            if !paragraph_lines.is_empty() {
                break;
            }
            continue;
        }

        paragraph_lines.push(trimmed);
    }

    paragraph_lines.join(" ")
}

fn is_horizontal_rule(line: &str) -> bool {
    let stripped: String = line.chars().filter(|c| !c.is_whitespace()).collect();
    if stripped.len() < 3 {
        return false;
    }
    let ch = stripped.chars().next().unwrap();
    (ch == '-' || ch == '*' || ch == '_') && stripped.chars().all(|c| c == ch)
}

fn is_blockquote_only(line: &str) -> bool {
    let stripped = line.trim_start_matches('>').trim();
    stripped.is_empty()
}

pub fn extract_sentence_context(body: &str, link_target: &str) -> (String, u32) {
    let link_pattern_pipe = format!("[[{}|", link_target);
    let link_pattern_close = format!("[[{}]]", link_target);
    let link_pattern_section = format!("[[{}#", link_target);

    let mut byte_offset = 0usize;

    for paragraph in body.split("\n\n") {
        let has_link = paragraph.contains(&link_pattern_close)
            || paragraph.contains(&link_pattern_pipe)
            || paragraph.contains(&link_pattern_section);

        if !has_link {
            byte_offset += paragraph.len() + 2;
            continue;
        }

        let line_number = body[..byte_offset.min(body.len())].matches('\n').count() as u32 + 1;

        let flat = paragraph.replace('\n', " ");

        for sentence in split_sentences(&flat) {
            let trimmed = sentence.trim();
            if trimmed.contains(&link_pattern_close)
                || trimmed.contains(&link_pattern_pipe)
                || trimmed.contains(&link_pattern_section)
            {
                return (trimmed.to_string(), line_number);
            }
        }

        byte_offset += paragraph.len() + 2;
    }

    (String::new(), 0)
}

pub fn extract_headings(body: &str) -> Vec<super::types::HeadingInfo> {
    let mut headings = Vec::new();
    let mut in_fence = false;
    let mut fence_char: u8 = 0;

    for line in body.lines() {
        let trimmed = line.trim_start();
        let fence_match = trimmed.as_bytes().first().copied();
        if matches!(fence_match, Some(b'`') | Some(b'~')) {
            let ch = fence_match.unwrap();
            let run = trimmed.bytes().take_while(|&b| b == ch).count();
            if run >= 3 {
                if !in_fence {
                    in_fence = true;
                    fence_char = ch;
                } else if ch == fence_char {
                    in_fence = false;
                }
                continue;
            }
        }
        if in_fence {
            continue;
        }

        let bytes = trimmed.as_bytes();
        if bytes.first() != Some(&b'#') {
            continue;
        }
        let hash_count = bytes.iter().take_while(|&&b| b == b'#').count();
        if hash_count > 6 || hash_count >= trimmed.len() {
            continue;
        }
        if bytes[hash_count] != b' ' {
            continue;
        }
        let text = trimmed[hash_count + 1..].trim();
        if text.is_empty() {
            continue;
        }
        headings.push(super::types::HeadingInfo {
            text: text.to_string(),
            level: hash_count as u8,
        });
    }

    headings
}

pub fn extract_block_anchors(body: &str) -> Vec<super::types::BlockAnchorInfo> {
    static ANCHOR_RE: std::sync::LazyLock<regex::Regex> = std::sync::LazyLock::new(|| {
        regex::Regex::new(r"(?:^|\s)\^([A-Za-z0-9-]+)[ \t]*$").unwrap()
    });

    let blanked = super::links::blank_code(body);
    let mut anchors = Vec::new();

    for (idx, line) in blanked.lines().enumerate() {
        if let Some(caps) = ANCHOR_RE.captures(line) {
            anchors.push(super::types::BlockAnchorInfo {
                id: caps.get(1).unwrap().as_str().to_string(),
                line: idx + 1,
            });
        }
    }

    anchors
}

pub fn strip_for_mention_scan(body: &str) -> String {
    let mut text = body.to_string();

    // Blank fenced code blocks (``` or ~~~)
    let mut result = String::with_capacity(text.len());
    let mut lines = text.split('\n').peekable();
    while let Some(line) = lines.next() {
        let trimmed = line.trim_start();
        let fence_char = if trimmed.starts_with("```") {
            Some(('`', trimmed.chars().take_while(|&c| c == '`').count()))
        } else if trimmed.starts_with("~~~") {
            Some(('~', trimmed.chars().take_while(|&c| c == '~').count()))
        } else {
            None
        };

        if let Some((ch, count)) = fence_char {
            result.push_str(&" ".repeat(line.len()));
            result.push('\n');
            while let Some(inner) = lines.next() {
                let inner_trimmed = inner.trim_start();
                let is_closing = inner_trimmed.starts_with(&ch.to_string().repeat(count))
                    && inner_trimmed.trim().chars().all(|c| c == ch);
                result.push_str(&" ".repeat(inner.len()));
                result.push('\n');
                if is_closing {
                    break;
                }
            }
        } else {
            result.push_str(line);
            result.push('\n');
        }
    }
    if result.ends_with('\n') && !text.ends_with('\n') {
        result.pop();
    }
    text = result;

    // Blank inline code
    let re_inline = regex::Regex::new(r"`[^`]+`").unwrap();
    text = re_inline
        .replace_all(&text, |caps: &regex::Captures| {
            " ".repeat(caps.get(0).unwrap().as_str().len())
        })
        .into_owned();

    // Blank HTML comments (preserve newlines for line stability)
    let re_comment = regex::Regex::new(r"(?s)<!--.*?-->").unwrap();
    text = re_comment
        .replace_all(&text, |caps: &regex::Captures| {
            let m = caps.get(0).unwrap().as_str();
            String::from_utf8(m.bytes().map(|b| if b == b'\n' { b'\n' } else { b' ' }).collect()).unwrap()
        })
        .into_owned();

    // Blank legacy annotations (%%!...%%)
    let re_legacy = regex::Regex::new(r"(?s)%%!.*?%%").unwrap();
    text = re_legacy
        .replace_all(&text, |caps: &regex::Captures| {
            let m = caps.get(0).unwrap().as_str();
            String::from_utf8(m.bytes().map(|b| if b == b'\n' { b'\n' } else { b' ' }).collect()).unwrap()
        })
        .into_owned();

    // Blank existing wikilinks
    let re_wikilink = regex::Regex::new(r"\[\[[^\]]+\]\]").unwrap();
    text = re_wikilink
        .replace_all(&text, |caps: &regex::Captures| {
            " ".repeat(caps.get(0).unwrap().as_str().len())
        })
        .into_owned();

    text
}

#[derive(Debug, Clone, PartialEq)]
pub struct MentionMatch {
    pub matched_text: String,
    pub line: u32,
    pub byte_offset: usize,
}

pub fn find_plain_mentions(body: &str, names: &[&str]) -> Vec<MentionMatch> {
    if names.is_empty() {
        return vec![];
    }

    let alternatives: Vec<String> = names
        .iter()
        .filter(|n| !n.is_empty())
        .map(|n| {
            let escaped = regex::escape(n);
            let starts_word = n.chars().next().map(|c| c.is_alphanumeric() || c == '_').unwrap_or(false);
            let ends_word = n.chars().last().map(|c| c.is_alphanumeric() || c == '_').unwrap_or(false);
            let prefix = if starts_word { r"\b" } else { "" };
            let suffix = if ends_word { r"\b" } else { "" };
            format!("{prefix}{escaped}{suffix}")
        })
        .collect();

    if alternatives.is_empty() {
        return vec![];
    }

    let pattern = format!("(?i)(?:{})", alternatives.join("|"));
    let re = regex::Regex::new(&pattern).unwrap();

    let non_word_end: Vec<bool> = names
        .iter()
        .map(|n| n.chars().last().map(|c| !(c.is_alphanumeric() || c == '_')).unwrap_or(false))
        .collect();
    let non_word_start: Vec<bool> = names
        .iter()
        .map(|n| n.chars().next().map(|c| !(c.is_alphanumeric() || c == '_')).unwrap_or(false))
        .collect();
    let needs_manual_boundary = non_word_end.iter().any(|&b| b) || non_word_start.iter().any(|&b| b);

    let mut matches = Vec::new();
    for m in re.find_iter(body) {
        if needs_manual_boundary {
            let end = m.end();
            if end < body.len() {
                let next_char = body[end..].chars().next().unwrap();
                if next_char.is_alphanumeric() || next_char == '_' {
                    continue;
                }
            }
            let start = m.start();
            if start > 0 {
                let prev_char = body[..start].chars().last().unwrap();
                if prev_char.is_alphanumeric() || prev_char == '_' {
                    continue;
                }
            }
        }
        let offset = m.start();
        let line = body[..offset].matches('\n').count() as u32 + 1;
        matches.push(MentionMatch {
            matched_text: m.as_str().to_string(),
            line,
            byte_offset: offset,
        });
    }

    matches
}

pub fn extract_mention_context(body: &str, byte_offset: usize) -> String {
    let byte_offset = byte_offset.min(body.len());
    let byte_offset = body.floor_char_boundary(byte_offset);
    let line_start = body[..byte_offset].rfind('\n').map(|i| i + 1).unwrap_or(0);
    let line_end = body[byte_offset..]
        .find('\n')
        .map(|i| byte_offset + i)
        .unwrap_or(body.len());
    let line_text = &body[line_start..line_end];

    for sentence in split_sentences(line_text) {
        let trimmed = sentence.trim();
        let sentence_start = line_text.find(trimmed).unwrap_or(0) + line_start;
        let sentence_end = sentence_start + trimmed.len();
        if byte_offset >= sentence_start && byte_offset < sentence_end {
            return trimmed.to_string();
        }
    }

    line_text.trim().to_string()
}

pub fn replace_mention_with_wikilink(
    body: &str,
    body_line: u32,
    mention: &str,
) -> Result<String, super::error::GraphError> {
    let lines: Vec<&str> = body.lines().collect();
    let idx = (body_line - 1) as usize;
    if idx >= lines.len() {
        return Err(super::error::GraphError::Other(format!(
            "line {} out of range (body has {} lines)",
            body_line,
            lines.len()
        )));
    }

    let line = lines[idx];
    let pattern = format!("(?i){}", regex::escape(mention));
    let re = regex::Regex::new(&pattern).unwrap();

    if let Some(m) = re.find(line) {
        let new_line = format!("{}[[{}]]{}", &line[..m.start()], mention, &line[m.end()..]);
        let mut result_lines: Vec<String> = lines.iter().map(|l| l.to_string()).collect();
        result_lines[idx] = new_line;
        let trailing_newline = body.ends_with('\n');
        let mut result = result_lines.join("\n");
        if trailing_newline {
            result.push('\n');
        }
        Ok(result)
    } else {
        Err(super::error::GraphError::Other(format!(
            "mention '{}' not found on line {}",
            mention, body_line
        )))
    }
}

pub fn utf16_offset_to_line(content: &str, utf16_offset: usize) -> u32 {
    let mut accumulated: usize = 0;
    let mut line: u32 = 1;
    for ch in content.chars() {
        if accumulated >= utf16_offset {
            return line;
        }
        if ch == '\n' {
            line += 1;
        }
        accumulated += ch.len_utf16();
    }
    line
}

pub fn extract_annotations(
    content: &str,
    mark_codes: &[String],
) -> Vec<super::types::IndexableAnnotation> {
    use crate::annotation::types::{AnnotationType, Certainty, Scope, ScopeKind};

    let parsed = crate::annotation::parser::parse_annotations(content, mark_codes);
    parsed
        .into_iter()
        .map(|ann| {
            let annotation_type = match ann.annotation_type {
                AnnotationType::Note => "note",
                AnnotationType::Question => "question",
                AnnotationType::Todo => "todo",
                AnnotationType::CrossRef => "crossref",
                AnnotationType::Apparatus => "apparatus",
                AnnotationType::Translation => "translation",
                // Legacy `llm` keyword: lit treats LLM annotations as Notes
                // (product direction #1010) without touching the pinned grammar.
                AnnotationType::Llm => "note",
                AnnotationType::Thread => "thread",
                AnnotationType::SlipNote => "slipnote",
                AnnotationType::Mark => "mark",
                AnnotationType::Bare => "bare",
            }
            .to_string();

            let certainty = match ann.certainty {
                Certainty::Tentative => "tentative",
                Certainty::Firm => "firm",
                Certainty::Neutral => "neutral",
            }
            .to_string();

            let (scope_kind, scope_value) = match &ann.scope {
                Scope::Words(n) => ("words".to_string(), n.to_string()),
                Scope::Paragraph(n) => ("paragraph".to_string(), n.to_string()),
                Scope::Page(n) => ("page".to_string(), n.to_string()),
                Scope::Sentence(n) => ("sentence".to_string(), n.to_string()),
                Scope::Anchor(s) => ("anchor".to_string(), s.clone()),
                Scope::Document => ("document".to_string(), String::new()),
                Scope::Section => ("section".to_string(), String::new()),
                Scope::Asymmetric { unit, before, after } => {
                    let unit_str = match unit {
                        ScopeKind::Word => "word",
                        ScopeKind::Sentence => "sentence",
                        ScopeKind::Paragraph => "paragraph",
                        ScopeKind::Page => "page",
                    };
                    (format!("asymmetric_{unit_str}"), format!("{before}:{after}"))
                }
            };

            let source_line = utf16_offset_to_line(content, ann.char_start);

            super::types::IndexableAnnotation {
                annotation_type,
                certainty,
                body: ann.body,
                date: ann.date,
                source_line,
                char_start: ann.char_start,
                char_end: ann.char_end,
                scope_kind,
                scope_value,
                uuid: ann.uuid,
                original: None,
                lang: ann.lang,
            }
        })
        .collect()
}

fn split_sentences(text: &str) -> Vec<&str> {
    let mut sentences = Vec::new();
    let mut start = 0;
    let bytes = text.as_bytes();
    let len = bytes.len();

    for i in 0..len {
        if bytes[i] == b'.' || bytes[i] == b'!' || bytes[i] == b'?' {
            let at_end = i + 1 == len;
            let followed_by_space = i + 1 < len && bytes[i + 1].is_ascii_whitespace();
            if at_end || followed_by_space {
                sentences.push(&text[start..=i]);
                start = i + 1;
            }
        }
    }

    if start < len {
        let remainder = text[start..].trim();
        if !remainder.is_empty() {
            sentences.push(&text[start..]);
        }
    }

    sentences
}

#[cfg(test)]
mod tests {
    use super::*;

    // --- extract_first_paragraph ---

    #[test]
    fn first_paragraph_after_heading() {
        let body = "# My Title\n\nThis is the first paragraph.\nIt has two lines.";
        assert_eq!(
            extract_first_paragraph(body),
            "This is the first paragraph. It has two lines."
        );
    }

    #[test]
    fn first_paragraph_no_heading() {
        let body = "This is directly the first paragraph.";
        assert_eq!(
            extract_first_paragraph(body),
            "This is directly the first paragraph."
        );
    }

    #[test]
    fn first_paragraph_leading_blank_lines() {
        let body = "\n\n\nEventually a paragraph.";
        assert_eq!(
            extract_first_paragraph(body),
            "Eventually a paragraph."
        );
    }

    #[test]
    fn first_paragraph_only_headings() {
        let body = "# Heading 1\n## Heading 2\n### Heading 3";
        assert_eq!(extract_first_paragraph(body), "");
    }

    #[test]
    fn first_paragraph_empty_body() {
        assert_eq!(extract_first_paragraph(""), "");
    }

    #[test]
    fn first_paragraph_stops_at_blank_line() {
        let body = "First paragraph line one.\nFirst paragraph line two.\n\nSecond paragraph.";
        assert_eq!(
            extract_first_paragraph(body),
            "First paragraph line one. First paragraph line two."
        );
    }

    #[test]
    fn first_paragraph_skips_blockquotes() {
        let body = "> \n> \n\nActual paragraph.";
        assert_eq!(extract_first_paragraph(body), "Actual paragraph.");
    }

    #[test]
    fn first_paragraph_skips_horizontal_rules() {
        let body = "---\n\nAfter the rule.";
        assert_eq!(extract_first_paragraph(body), "After the rule.");
    }

    #[test]
    fn first_paragraph_skips_star_horizontal_rule() {
        let body = "***\n\nAfter stars.";
        assert_eq!(extract_first_paragraph(body), "After stars.");
    }

    #[test]
    fn first_paragraph_skips_underscore_horizontal_rule() {
        let body = "___\n\nAfter underscores.";
        assert_eq!(extract_first_paragraph(body), "After underscores.");
    }

    // --- extract_headings ---

    use super::super::types::HeadingInfo;

    #[test]
    fn extract_headings_empty() {
        assert!(extract_headings("").is_empty());
    }

    #[test]
    fn extract_headings_no_headings() {
        assert!(extract_headings("just text\nmore text").is_empty());
    }

    #[test]
    fn extract_headings_single_h1() {
        let result = extract_headings("# Title");
        assert_eq!(result, vec![HeadingInfo { text: "Title".into(), level: 1 }]);
    }

    #[test]
    fn extract_headings_multiple_levels() {
        let result = extract_headings("# One\ntext\n## Two\n### Three");
        assert_eq!(result.len(), 3);
        assert_eq!(result[0].level, 1);
        assert_eq!(result[1].level, 2);
        assert_eq!(result[2].level, 3);
    }

    #[test]
    fn extract_headings_strips_whitespace() {
        let result = extract_headings("#   Spaced  ");
        assert_eq!(result, vec![HeadingInfo { text: "Spaced".into(), level: 1 }]);
    }

    #[test]
    fn extract_headings_h1_through_h6() {
        let body = "# H1\n## H2\n### H3\n#### H4\n##### H5\n###### H6";
        let result = extract_headings(body);
        assert_eq!(result.len(), 6);
        for (i, h) in result.iter().enumerate() {
            assert_eq!(h.level, (i + 1) as u8);
        }
    }

    #[test]
    fn extract_headings_ignores_7_hashes() {
        assert!(extract_headings("####### Not").is_empty());
    }

    #[test]
    fn extract_headings_ignores_no_space() {
        assert!(extract_headings("#nospace").is_empty());
    }

    #[test]
    fn extract_headings_skips_fenced_code() {
        let body = "# Before\n```\n# Inside\n```\n# After";
        let result = extract_headings(body);
        assert_eq!(result.len(), 2);
        assert_eq!(result[0].text, "Before");
        assert_eq!(result[1].text, "After");
    }

    #[test]
    fn extract_headings_skips_tilde_fence() {
        let body = "# Before\n~~~\n# Inside\n~~~\n# After";
        let result = extract_headings(body);
        assert_eq!(result.len(), 2);
        assert_eq!(result[0].text, "Before");
        assert_eq!(result[1].text, "After");
    }

    #[test]
    fn extract_headings_unclosed_fence() {
        let body = "```\n# Inside";
        assert!(extract_headings(body).is_empty());
    }

    #[test]
    fn extract_headings_fenced_with_lang() {
        let body = "```rust\n# Inside\n```\n# Outside";
        let result = extract_headings(body);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].text, "Outside");
    }

    // --- extract_block_anchors ---

    #[test]
    fn extract_block_anchors_trailing_form() {
        let result = extract_block_anchors("Some text ^abc");
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].id, "abc");
        assert_eq!(result[0].line, 1);
    }

    #[test]
    fn extract_block_anchors_standalone_line() {
        let body = "| a | b |\n| - | - |\n| 1 | 2 |\n^tbl-1";
        let result = extract_block_anchors(body);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].id, "tbl-1");
        assert_eq!(result[0].line, 4);
    }

    #[test]
    fn extract_block_anchors_allows_hyphens() {
        let result = extract_block_anchors("paragraph text ^my-block-1");
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].id, "my-block-1");
    }

    #[test]
    fn extract_block_anchors_ignores_midline() {
        assert!(extract_block_anchors("text ^abc more text").is_empty());
    }

    #[test]
    fn extract_block_anchors_ignores_no_leading_whitespace() {
        assert!(extract_block_anchors("foo^abc").is_empty());
    }

    #[test]
    fn extract_block_anchors_ignores_escaped() {
        assert!(extract_block_anchors(r"text \^abc").is_empty());
    }

    #[test]
    fn extract_block_anchors_ignores_invalid_chars() {
        assert!(extract_block_anchors("text ^ab_cd").is_empty());
    }

    #[test]
    fn extract_block_anchors_ignores_bare_caret() {
        assert!(extract_block_anchors("text ^").is_empty());
    }

    #[test]
    fn extract_block_anchors_ignores_inline_code_wrapped() {
        assert!(extract_block_anchors("text `^abc`").is_empty());
    }

    #[test]
    fn extract_block_anchors_skips_fenced_code() {
        let body = "```\ncode ^abc\n```\nreal text ^def";
        let result = extract_block_anchors(body);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].id, "def");
        assert_eq!(result[0].line, 4);
    }

    // --- extract_sentence_context ---

    #[test]
    fn sentence_context_link_in_middle() {
        let body = "Some intro. She talked to [[Alice]] about the project. Then she left.";
        assert_eq!(
            extract_sentence_context(body, "Alice"),
            ("She talked to [[Alice]] about the project.".into(), 1)
        );
    }

    #[test]
    fn sentence_context_link_at_start() {
        let body = "[[Alice]] is a great person. Others agree.";
        assert_eq!(
            extract_sentence_context(body, "Alice"),
            ("[[Alice]] is a great person.".into(), 1)
        );
    }

    #[test]
    fn sentence_context_link_at_end_no_period() {
        let body = "She met [[Alice]]";
        assert_eq!(
            extract_sentence_context(body, "Alice"),
            ("She met [[Alice]]".into(), 1)
        );
    }

    #[test]
    fn sentence_context_link_not_found() {
        let body = "No links here at all.";
        assert_eq!(extract_sentence_context(body, "Alice"), ("".into(), 0));
    }

    #[test]
    fn sentence_context_no_punctuation_returns_paragraph() {
        let body = "This paragraph has no sentence-ending punctuation and mentions [[Alice]] somewhere";
        assert_eq!(
            extract_sentence_context(body, "Alice"),
            ("This paragraph has no sentence-ending punctuation and mentions [[Alice]] somewhere".into(), 1)
        );
    }

    #[test]
    fn sentence_context_with_pipe_display() {
        let body = "She met [[Alice|her friend]] at the cafe.";
        assert_eq!(
            extract_sentence_context(body, "Alice"),
            ("She met [[Alice|her friend]] at the cafe.".into(), 1)
        );
    }

    #[test]
    fn sentence_context_with_section() {
        let body = "See [[Alice#Bio]] for details.";
        assert_eq!(
            extract_sentence_context(body, "Alice"),
            ("See [[Alice#Bio]] for details.".into(), 1)
        );
    }

    #[test]
    fn sentence_context_multiline_paragraph() {
        let body = "First sentence.\nShe mentioned [[Alice]] in passing.\nAnother sentence.";
        assert_eq!(
            extract_sentence_context(body, "Alice"),
            ("She mentioned [[Alice]] in passing.".into(), 1)
        );
    }

    #[test]
    fn sentence_context_returns_line_of_second_paragraph() {
        let body = "First paragraph.\n\nSecond paragraph links to [[Alice]].";
        let (ctx, line) = extract_sentence_context(body, "Alice");
        assert_eq!(ctx, "Second paragraph links to [[Alice]].");
        assert_eq!(line, 3);
    }

    #[test]
    fn sentence_context_returns_line_of_third_paragraph() {
        let body = "Para one.\n\nPara two.\n\nPara three mentions [[Bob]].";
        let (ctx, line) = extract_sentence_context(body, "Bob");
        assert_eq!(ctx, "Para three mentions [[Bob]].");
        assert_eq!(line, 5);
    }

    #[test]
    fn sentence_context_multiline_para_line_number() {
        let body = "Line one.\nLine two.\n\nLine three has [[Alice]].";
        let (ctx, line) = extract_sentence_context(body, "Alice");
        assert_eq!(ctx, "Line three has [[Alice]].");
        assert_eq!(line, 4);
    }

    // --- strip_for_mention_scan ---

    #[test]
    fn strip_blanks_fenced_code_blocks() {
        let body = "Alice outside\n```\nAlice inside\n```\nAlice after";
        let stripped = strip_for_mention_scan(body);
        assert_eq!(stripped.len(), body.len());
        assert!(!stripped[body.find("```").unwrap()..].starts_with("Alice inside"));
        assert!(stripped.starts_with("Alice outside"));
        assert!(stripped.ends_with("Alice after"));
    }

    #[test]
    fn strip_blanks_inline_code() {
        let body = "`Alice` and Alice is here";
        let stripped = strip_for_mention_scan(body);
        assert!(!stripped.starts_with("`Alice`"));
        assert!(stripped.contains("Alice is here"));
    }

    #[test]
    fn strip_blanks_html_comments() {
        let body = "before <!-- Alice --> after";
        let stripped = strip_for_mention_scan(body);
        assert!(stripped.contains("before"));
        assert!(stripped.contains("after"));
        assert!(!stripped.contains("Alice"));
    }

    #[test]
    fn strip_blanks_html_comments_multiline() {
        let body = "before\n<!--\nAlice\n-->\nafter";
        let stripped = strip_for_mention_scan(body);
        assert_eq!(stripped.lines().count(), body.lines().count());
        assert!(!stripped.contains("Alice"));
    }

    #[test]
    fn strip_blanks_wikilinks() {
        let body = "[[Alice]] and Alice outside";
        let stripped = strip_for_mention_scan(body);
        assert!(!stripped.starts_with("[[Alice]]"));
        assert!(stripped.contains("Alice outside"));
    }

    #[test]
    fn strip_blanks_legacy_annotations() {
        let body = "before %%! Alice inside %% after Alice";
        let stripped = strip_for_mention_scan(body);
        assert_eq!(stripped.len(), body.len());
        // "Alice inside" within %%!...%% should be blanked
        assert!(!stripped.contains("Alice inside"));
        // "Alice" after should remain
        assert!(stripped.contains("after Alice"));
    }

    #[test]
    fn strip_blanks_both_old_and_new() {
        let body = "%%! Alice old %% middle <!--- Alice new ---> Alice plain";
        let stripped = strip_for_mention_scan(body);
        assert_eq!(stripped.len(), body.len());
        // Both formats should be blanked
        assert!(!stripped.contains("Alice old"));
        assert!(!stripped.contains("Alice new"));
        // Plain mention should remain
        assert!(stripped.contains("Alice plain"));
    }

    #[test]
    fn strip_blanks_legacy_multiline() {
        let body = "before\n%%!\nAlice\n%%\nafter Alice";
        let stripped = strip_for_mention_scan(body);
        assert_eq!(stripped.len(), body.len());
        assert_eq!(stripped.lines().count(), body.lines().count());
        // Only the final "Alice" should survive
        let mentions = find_plain_mentions(&stripped, &["Alice"]);
        assert_eq!(mentions.len(), 1);
    }

    #[test]
    fn strip_offset_preservation() {
        let body = "```\nAlice\n```\n`Alice` and <!-- Alice --> plus [[Alice]] end";
        let stripped = strip_for_mention_scan(body);
        assert_eq!(stripped.len(), body.len());
        assert_eq!(stripped.lines().count(), body.lines().count());
    }

    // --- find_plain_mentions ---

    #[test]
    fn find_mentions_case_insensitive() {
        let matches = find_plain_mentions("Alice went home. alice too.", &["Alice"]);
        assert_eq!(matches.len(), 2);
    }

    #[test]
    fn find_mentions_multi_word_phrase() {
        let matches = find_plain_mentions("about Quantum Computing here", &["Quantum Computing"]);
        assert_eq!(matches.len(), 1);
        let no_match = find_plain_mentions("just Quantum alone", &["Quantum Computing"]);
        assert!(no_match.is_empty());
    }

    #[test]
    fn find_mentions_word_boundary_rejects_partials() {
        let matches = find_plain_mentions("Aliceson and malice", &["Alice"]);
        assert!(matches.is_empty());
    }

    #[test]
    fn find_mentions_regex_special_chars() {
        let matches = find_plain_mentions("The C++ language is great", &["C++"]);
        assert_eq!(matches.len(), 1);
        assert_eq!(matches[0].matched_text, "C++");
    }

    #[test]
    fn find_mentions_multiple_names() {
        let matches = find_plain_mentions("I met Alpha and also Alfa here", &["Alpha", "Alfa"]);
        assert_eq!(matches.len(), 2);
    }

    #[test]
    fn find_mentions_line_numbers() {
        let matches = find_plain_mentions("First.\nAlice here.\nThird.\nAlice again.", &["Alice"]);
        assert_eq!(matches.len(), 2);
        assert_eq!(matches[0].line, 2);
        assert_eq!(matches[1].line, 4);
    }

    #[test]
    fn find_mentions_integration_with_strip() {
        let body = "```\nAlice\n```\nAlice is here.";
        let stripped = strip_for_mention_scan(body);
        let matches = find_plain_mentions(&stripped, &["Alice"]);
        assert_eq!(matches.len(), 1);
    }

    // --- extract_mention_context ---

    #[test]
    fn mention_context_extracts_sentence() {
        let body = "Some intro. Alice went to the store. Then left.";
        let ctx = extract_mention_context(body, 12);
        assert_eq!(ctx, "Alice went to the store.");
    }

    #[test]
    fn mention_context_fallback_full_line() {
        let body = "This line has no sentence-ending punctuation and mentions Alice somewhere";
        let ctx = extract_mention_context(body, body.find("Alice").unwrap());
        assert_eq!(ctx, body);
    }

    // --- replace_mention_with_wikilink ---

    #[test]
    fn replace_basic_wrapping() {
        let body = "I met Alice at the park.";
        let result = replace_mention_with_wikilink(body, 1, "Alice").unwrap();
        assert_eq!(result, "I met [[Alice]] at the park.");
    }

    #[test]
    fn replace_preserves_canonical_case() {
        let body = "I met alice at the park.";
        let result = replace_mention_with_wikilink(body, 1, "Alice").unwrap();
        assert_eq!(result, "I met [[Alice]] at the park.");
    }

    #[test]
    fn replace_targets_correct_line() {
        let body = "Alice on line one.\nAlice on line two.\nAlice on line three.";
        let result = replace_mention_with_wikilink(body, 3, "Alice").unwrap();
        let lines: Vec<&str> = result.lines().collect();
        assert_eq!(lines[0], "Alice on line one.");
        assert_eq!(lines[1], "Alice on line two.");
        assert_eq!(lines[2], "[[Alice]] on line three.");
    }

    #[test]
    fn replace_error_if_not_found() {
        let result = replace_mention_with_wikilink("No mention here.", 1, "Alice");
        assert!(result.is_err());
    }

    // --- UTF-8 multibyte safety ---

    #[test]
    fn strip_html_comment_preserves_byte_length_multibyte() {
        let body = "before <!-- café --> after";
        let stripped = strip_for_mention_scan(body);
        assert_eq!(stripped.len(), body.len());
    }

    #[test]
    fn strip_html_comment_preserves_byte_length_emoji() {
        let body = "text <!-- 🎵🎵🎵 --> more";
        let stripped = strip_for_mention_scan(body);
        assert_eq!(stripped.len(), body.len());
    }

    #[test]
    fn strip_html_comment_multibyte_multiline_preserves_bytes() {
        let body = "start\n<!-- línea\nüber -->\nend";
        let stripped = strip_for_mention_scan(body);
        assert_eq!(stripped.len(), body.len());
        assert_eq!(stripped.lines().count(), body.lines().count());
    }

    #[test]
    fn find_mentions_after_multibyte_html_comment() {
        let body = "<!-- 🎵🎵🎵 -->ö Alice is here";
        let stripped = strip_for_mention_scan(body);
        let matches = find_plain_mentions(&stripped, &["Alice"]);
        assert_eq!(matches.len(), 1);
        let offset = matches[0].byte_offset;
        assert!(body.is_char_boundary(offset));
        assert!(body[offset..].starts_with("Alice"));
    }

    #[test]
    fn mention_context_with_bad_offset_no_panic() {
        let body = "café Alice is here";
        // byte 4 is a continuation byte of 'é' (U+00E9 = 0xC3 0xA9)
        let ctx = extract_mention_context(body, 4);
        assert!(!ctx.is_empty());
    }

    #[test]
    fn full_pipeline_multibyte_html_comment() {
        let body = "<!-- 中文注释 -->\nAlice met Bob here.\n<!-- もう一つ -->\nCharlie too.";
        let stripped = strip_for_mention_scan(body);
        assert_eq!(stripped.len(), body.len());
        let matches = find_plain_mentions(&stripped, &["Alice", "Bob", "Charlie"]);
        assert_eq!(matches.len(), 3);
        for m in &matches {
            assert!(body.is_char_boundary(m.byte_offset));
            let ctx = extract_mention_context(body, m.byte_offset);
            assert!(ctx.contains(&m.matched_text));
        }
    }

    // --- Cycle 8: utf16_offset_to_line ---

    #[test]
    fn utf16_offset_to_line_first_line() {
        assert_eq!(utf16_offset_to_line("hello world", 3), 1);
    }

    #[test]
    fn utf16_offset_to_line_second_line() {
        assert_eq!(utf16_offset_to_line("line one\nline two", 12), 2);
    }

    #[test]
    fn utf16_offset_to_line_cjk() {
        // '中' is 1 UTF-16 code unit, '\n' is 1, '世' is 1
        let text = "中\n世";
        // offset 0 = '中' → line 1
        assert_eq!(utf16_offset_to_line(text, 0), 1);
        // offset 1 = '\n' → line 1
        assert_eq!(utf16_offset_to_line(text, 1), 1);
        // offset 2 = '世' → line 2
        assert_eq!(utf16_offset_to_line(text, 2), 2);
    }

    #[test]
    fn utf16_offset_to_line_zero() {
        assert_eq!(utf16_offset_to_line("hello", 0), 1);
    }

    // --- Cycle 9: extract_annotations ---

    #[test]
    fn extract_annotations_basic() {
        let content = "Some text <!--- n: _ | a note ---> more";
        let result = extract_annotations(content, crate::annotation::marks::builtin_mark_codes());
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].annotation_type, "note");
        assert_eq!(result[0].certainty, "neutral");
        assert_eq!(result[0].scope_kind, "words");
        assert_eq!(result[0].source_line, 1);
    }

    #[test]
    fn extract_annotations_multiple() {
        let content = "<!--- n: _ | first ---> stuff <!--- q: _ | second --->";
        let result = extract_annotations(content, crate::annotation::marks::builtin_mark_codes());
        assert_eq!(result.len(), 2);
    }

    #[test]
    fn extract_annotations_no_body() {
        let content = "<!--- n: _ --->";
        let result = extract_annotations(content, crate::annotation::marks::builtin_mark_codes());
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].body, None);
    }

    #[test]
    fn extract_annotations_multiline() {
        let content = "line one\nline two\n<!--- n: _ | note --->";
        let result = extract_annotations(content, crate::annotation::marks::builtin_mark_codes());
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].source_line, 3);
    }

    #[test]
    fn extract_annotations_carries_lang() {
        let content = r"Some text <!--- n \s lang=fr | une note ---> more";
        let result = extract_annotations(content, crate::annotation::marks::builtin_mark_codes());
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].lang, Some("fr".to_string()));
    }

    #[test]
    fn extract_annotations_lang_absent_is_none() {
        let content = r"Some text <!--- n \s | a note ---> more";
        let result = extract_annotations(content, crate::annotation::marks::builtin_mark_codes());
        assert_eq!(result[0].lang, None);
    }

    #[test]
    fn extract_annotations_carries_block_lang() {
        let content = "text\n\n<!---\nn\nlang: ja\n---\nメモ\n--->\n";
        let result = extract_annotations(content, crate::annotation::marks::builtin_mark_codes());
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].lang, Some("ja".to_string()));
    }

    #[test]
    fn extract_annotations_empty() {
        let result = extract_annotations("", crate::annotation::marks::builtin_mark_codes());
        assert!(result.is_empty());
    }

    #[test]
    fn legacy_llm_keyword_extracts_as_note() {
        let content = "Some text <!--- llm | summarize ---> more";
        let result = extract_annotations(content, crate::annotation::marks::builtin_mark_codes());
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].annotation_type, "note");
    }

    #[test]
    fn extract_annotations_thread_type() {
        let content = "Some text <!--- th | a thread ---> more";
        let result = extract_annotations(content, crate::annotation::marks::builtin_mark_codes());
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].annotation_type, "thread");
    }

    #[test]
    fn extract_annotations_document_scope() {
        let content = r"<!--- llm \d | summarize --->";
        let result = extract_annotations(content, crate::annotation::marks::builtin_mark_codes());
        assert_eq!(result[0].scope_kind, "document");
        assert_eq!(result[0].scope_value, "");
    }

    #[test]
    fn extract_annotations_section_scope() {
        let content = r"<!--- n: \h | section note --->";
        let result = extract_annotations(content, crate::annotation::marks::builtin_mark_codes());
        assert_eq!(result[0].scope_kind, "section");
        assert_eq!(result[0].scope_value, "");
    }

    #[test]
    fn extract_annotations_asymmetric_scope() {
        let content = r"<!--- n 3\p1 | asymmetric note --->";
        let result = extract_annotations(content, crate::annotation::marks::builtin_mark_codes());
        assert_eq!(result[0].scope_kind, "asymmetric_paragraph");
        assert_eq!(result[0].scope_value, "3:1");
    }

    #[test]
    fn extract_annotations_custom_code_recognized() {
        let content = "word<!--- foo _ ---> rest";
        let codes = vec!["foo".to_string()];
        let result = extract_annotations(content, &codes);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].annotation_type, "mark");

        // Without the custom code it falls back to a bare annotation.
        let builtin = extract_annotations(content, crate::annotation::marks::builtin_mark_codes());
        assert_eq!(builtin[0].annotation_type, "bare");
    }

    #[test]
    fn extract_slipnote_annotation_type() {
        let content = r#"Text<!--- sn ^"parent-uuid" | a slip note @2026-07-28 --->"#;
        let result = extract_annotations(content, crate::annotation::marks::builtin_mark_codes());
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].annotation_type, "slipnote");
        assert_eq!(result[0].scope_kind, "anchor");
        assert_eq!(result[0].scope_value, "parent-uuid");
    }
}
