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

pub fn extract_sentence_context(body: &str, link_target: &str) -> String {
    let link_pattern_pipe = format!("[[{}|", link_target);
    let link_pattern_close = format!("[[{}]]", link_target);
    let link_pattern_section = format!("[[{}#", link_target);

    for paragraph in body.split("\n\n") {
        let has_link = paragraph.contains(&link_pattern_close)
            || paragraph.contains(&link_pattern_pipe)
            || paragraph.contains(&link_pattern_section);

        if !has_link {
            continue;
        }

        let flat = paragraph.replace('\n', " ");

        for sentence in split_sentences(&flat) {
            let trimmed = sentence.trim();
            if trimmed.contains(&link_pattern_close)
                || trimmed.contains(&link_pattern_pipe)
                || trimmed.contains(&link_pattern_section)
            {
                return trimmed.to_string();
            }
        }
    }

    String::new()
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

    // --- extract_sentence_context ---

    #[test]
    fn sentence_context_link_in_middle() {
        let body = "Some intro. She talked to [[Alice]] about the project. Then she left.";
        assert_eq!(
            extract_sentence_context(body, "Alice"),
            "She talked to [[Alice]] about the project."
        );
    }

    #[test]
    fn sentence_context_link_at_start() {
        let body = "[[Alice]] is a great person. Others agree.";
        assert_eq!(
            extract_sentence_context(body, "Alice"),
            "[[Alice]] is a great person."
        );
    }

    #[test]
    fn sentence_context_link_at_end_no_period() {
        let body = "She met [[Alice]]";
        assert_eq!(
            extract_sentence_context(body, "Alice"),
            "She met [[Alice]]"
        );
    }

    #[test]
    fn sentence_context_link_not_found() {
        let body = "No links here at all.";
        assert_eq!(extract_sentence_context(body, "Alice"), "");
    }

    #[test]
    fn sentence_context_no_punctuation_returns_paragraph() {
        let body = "This paragraph has no sentence-ending punctuation and mentions [[Alice]] somewhere";
        assert_eq!(
            extract_sentence_context(body, "Alice"),
            "This paragraph has no sentence-ending punctuation and mentions [[Alice]] somewhere"
        );
    }

    #[test]
    fn sentence_context_with_pipe_display() {
        let body = "She met [[Alice|her friend]] at the cafe.";
        assert_eq!(
            extract_sentence_context(body, "Alice"),
            "She met [[Alice|her friend]] at the cafe."
        );
    }

    #[test]
    fn sentence_context_with_section() {
        let body = "See [[Alice#Bio]] for details.";
        assert_eq!(
            extract_sentence_context(body, "Alice"),
            "See [[Alice#Bio]] for details."
        );
    }

    #[test]
    fn sentence_context_multiline_paragraph() {
        let body = "First sentence.\nShe mentioned [[Alice]] in passing.\nAnother sentence.";
        assert_eq!(
            extract_sentence_context(body, "Alice"),
            "She mentioned [[Alice]] in passing."
        );
    }
}
