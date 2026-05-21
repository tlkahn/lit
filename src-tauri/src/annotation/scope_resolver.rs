use super::scanner::utf16_len;
use super::types::{ResolutionMode, Scope, ScopeKind, ScopeRange};

fn split_sentences(text: &str, lang: &str) -> Vec<String> {
    sentencex::segment(lang, text)
        .into_iter()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect()
}

pub fn resolve_scope_range(
    content: &str,
    char_start: usize,
    scope: &Scope,
    lang: &str,
) -> Option<ScopeRange> {
    let (start, end) = match scope {
        Scope::Words(n) => resolve_words(content, char_start, *n)?,
        Scope::Sentence(n) => resolve_sentence(content, char_start, *n, lang)?,
        Scope::Paragraph(n) => resolve_paragraph(content, char_start, *n)?,
        Scope::Page(n) => resolve_page(content, char_start, *n)?,
        Scope::Anchor(text) => resolve_anchor(content, char_start, text)?,
        Scope::Document => return Some(ScopeRange { start: 0, end: utf16_len(content) }),
        Scope::Section => resolve_section(content, char_start)?,
        Scope::Asymmetric { unit, before, after } => {
            resolve_asymmetric(content, char_start, unit, *before, *after, lang)?
        }
    };
    Some(ScopeRange { start, end })
}

fn utf16_to_byte(s: &str, utf16_offset: usize) -> usize {
    let mut utf16_acc = 0;
    for (byte_idx, ch) in s.char_indices() {
        if utf16_acc >= utf16_offset {
            return byte_idx;
        }
        utf16_acc += ch.len_utf16();
    }
    s.len()
}

fn resolve_words(content: &str, char_start: usize, n: usize) -> Option<(usize, usize)> {
    if n == 0 {
        return None;
    }
    let byte_start = utf16_to_byte(content, char_start);
    let text_before = &content[..byte_start];

    let trimmed = text_before.trim_end();
    if trimmed.is_empty() {
        return None;
    }
    let scope_end_byte = trimmed.len();

    let mut words_found = 0;
    let mut scope_start_byte = 0;
    let mut in_word = false;

    for (i, ch) in trimmed.char_indices().rev() {
        if ch.is_whitespace() {
            if in_word {
                words_found += 1;
                if words_found >= n {
                    scope_start_byte = i + ch.len_utf8();
                    break;
                }
                in_word = false;
            }
        } else {
            in_word = true;
        }
    }

    if words_found < n && in_word {
        words_found += 1;
    }
    if words_found < n {
        scope_start_byte = 0;
    }

    let scope_start_utf16 = utf16_len(&content[..scope_start_byte]);
    let scope_end_utf16 = utf16_len(&content[..scope_end_byte]);

    Some((scope_start_utf16, scope_end_utf16))
}

fn ws_flexible_find(haystack: &str, needle: &str, start_from: usize) -> Option<(usize, usize)> {
    let parts: Vec<&str> = needle.split_whitespace().collect();
    if parts.is_empty() {
        return None;
    }

    let mut offset = start_from;
    loop {
        let rel_pos = haystack[offset..].find(parts[0])?;
        let match_start = offset + rel_pos;
        let mut cursor = match_start + parts[0].len();

        let mut ok = true;
        for part in &parts[1..] {
            let rest = &haystack[cursor..];
            let ws = rest.len() - rest.trim_start().len();
            if ws == 0 {
                ok = false;
                break;
            }
            cursor += ws;
            if haystack[cursor..].starts_with(part) {
                cursor += part.len();
            } else {
                ok = false;
                break;
            }
        }

        if ok {
            return Some((match_start, cursor));
        }

        match haystack[offset + rel_pos..].char_indices().nth(1) {
            Some((next, _)) => offset += rel_pos + next,
            None => return None,
        }
    }
}

fn resolve_sentence(content: &str, char_start: usize, n: usize, lang: &str) -> Option<(usize, usize)> {
    if n == 0 {
        return None;
    }
    let byte_start = utf16_to_byte(content, char_start);
    let text_before = &content[..byte_start];
    let trimmed = text_before.trim_end();
    if trimmed.is_empty() {
        return None;
    }

    let sentences = split_sentences(trimmed, lang);
    if sentences.is_empty() {
        return None;
    }

    let take = n.min(sentences.len());
    let first_sentence = &sentences[sentences.len() - take];
    let last_sentence = &sentences[sentences.len() - 1];

    let (first_start, _) = ws_flexible_find(trimmed, first_sentence, 0)?;
    let (_, last_end) = ws_flexible_find(trimmed, last_sentence, first_start)?;

    let scope_start_byte = first_start;
    let scope_end_byte = last_end.min(trimmed.len());

    let scope_start_utf16 = utf16_len(&content[..scope_start_byte]);
    let scope_end_utf16 = utf16_len(&content[..scope_end_byte]);

    Some((scope_start_utf16, scope_end_utf16))
}

fn resolve_paragraph(content: &str, char_start: usize, n: usize) -> Option<(usize, usize)> {
    if n == 0 {
        return None;
    }
    let byte_start = utf16_to_byte(content, char_start);
    let text_before = &content[..byte_start];
    let trimmed = text_before.trim_end();
    if trimmed.is_empty() {
        return None;
    }

    let scope_end_byte = trimmed.len();

    let mut para_boundaries: Vec<usize> = vec![0];
    let mut i = 0;
    let bytes = trimmed.as_bytes();
    while i + 1 < bytes.len() {
        if bytes[i] == b'\n' && bytes[i + 1] == b'\n' {
            let mut end = i + 2;
            while end < bytes.len() && bytes[end] == b'\n' {
                end += 1;
            }
            para_boundaries.push(end);
            i = end;
        } else {
            i += 1;
        }
    }

    let boundary_idx = if para_boundaries.len() >= n {
        para_boundaries.len() - n
    } else {
        0
    };
    let scope_start_byte = para_boundaries[boundary_idx];

    let scope_start_utf16 = utf16_len(&content[..scope_start_byte]);
    let scope_end_utf16 = utf16_len(&content[..scope_end_byte]);

    Some((scope_start_utf16, scope_end_utf16))
}

fn resolve_page(content: &str, char_start: usize, n: usize) -> Option<(usize, usize)> {
    if n == 0 {
        return None;
    }
    let byte_start = utf16_to_byte(content, char_start);
    let text_before = &content[..byte_start];
    let trimmed = text_before.trim_end();
    if trimmed.is_empty() {
        return None;
    }

    let scope_end_byte = trimmed.len();

    let mut page_boundaries: Vec<usize> = vec![0];
    for (i, b) in trimmed.bytes().enumerate() {
        if b == b'\x0C' {
            page_boundaries.push(i + 1);
        }
    }

    let boundary_idx = if page_boundaries.len() >= n {
        page_boundaries.len() - n
    } else {
        0
    };
    let scope_start_byte = page_boundaries[boundary_idx];

    let scope_start_utf16 = utf16_len(&content[..scope_start_byte]);
    let scope_end_utf16 = utf16_len(&content[..scope_end_byte]);

    Some((scope_start_utf16, scope_end_utf16))
}

fn resolve_anchor(content: &str, char_start: usize, anchor: &str) -> Option<(usize, usize)> {
    let byte_start = utf16_to_byte(content, char_start);
    let text_before = &content[..byte_start];

    let pos = text_before.rfind(anchor)?;
    let scope_start_utf16 = utf16_len(&content[..pos]);
    let scope_end_utf16 = utf16_len(&content[..pos + anchor.len()]);

    Some((scope_start_utf16, scope_end_utf16))
}

fn resolve_section(content: &str, char_start: usize) -> Option<(usize, usize)> {
    let byte_start = utf16_to_byte(content, char_start);

    let mut headings: Vec<(usize, usize)> = Vec::new();
    let mut in_fence = false;
    let mut line_start = 0;
    for line in content.split('\n') {
        let trimmed = line.trim_start();
        if trimmed.starts_with("```") || trimmed.starts_with("~~~") {
            in_fence = !in_fence;
        } else if !in_fence && trimmed.starts_with('#') {
            let level = trimmed.bytes().take_while(|&b| b == b'#').count();
            if level <= 6 && trimmed.as_bytes().get(level) == Some(&b' ') {
                headings.push((line_start, level));
            }
        }
        line_start += line.len() + 1;
    }

    if headings.is_empty() {
        return Some((0, utf16_len(content)));
    }

    let current_idx = headings.iter().rposition(|(off, _)| *off <= byte_start);

    let (section_byte_start, current_level) = match current_idx {
        Some(idx) => (headings[idx].0, headings[idx].1),
        None => {
            let end_byte = headings[0].0;
            let start_utf16 = 0;
            let end_utf16 = utf16_len(&content[..end_byte]);
            return Some((start_utf16, end_utf16));
        }
    };

    let section_byte_end = headings[current_idx.unwrap() + 1..]
        .iter()
        .find(|(_, lvl)| *lvl <= current_level)
        .map(|(off, _)| *off)
        .unwrap_or(content.len());

    let start_utf16 = utf16_len(&content[..section_byte_start]);
    let end_utf16 = utf16_len(&content[..section_byte_end]);
    Some((start_utf16, end_utf16))
}

fn resolve_forward_words(content: &str, char_start: usize, n: usize) -> Option<usize> {
    if n == 0 {
        return Some(char_start);
    }
    let byte_start = utf16_to_byte(content, char_start);
    let text_after = &content[byte_start..];
    let trimmed = text_after.trim_start();
    let trim_offset = text_after.len() - trimmed.len();

    let mut words_found = 0;
    let mut end_byte = 0;
    let mut in_word = false;

    for (i, ch) in trimmed.char_indices() {
        if ch.is_whitespace() {
            if in_word {
                words_found += 1;
                end_byte = i;
                if words_found >= n {
                    break;
                }
                in_word = false;
            }
        } else {
            in_word = true;
        }
    }

    if in_word && words_found < n {
        words_found += 1;
        end_byte = trimmed.len();
    }

    if words_found == 0 {
        return None;
    }

    let abs_byte = byte_start + trim_offset + end_byte;
    Some(utf16_len(&content[..abs_byte]))
}

fn resolve_forward_sentences(content: &str, char_start: usize, n: usize, lang: &str) -> Option<usize> {
    if n == 0 {
        return Some(char_start);
    }
    let byte_start = utf16_to_byte(content, char_start);
    let text_after = &content[byte_start..];
    let trimmed = text_after.trim_start();
    if trimmed.is_empty() {
        return None;
    }

    let sentences = split_sentences(trimmed, lang);
    if sentences.is_empty() {
        return None;
    }

    let take = n.min(sentences.len());
    let target_sentence = &sentences[take - 1];

    let trim_offset = text_after.len() - trimmed.len();
    let (_, sent_end) = ws_flexible_find(trimmed, target_sentence, 0)?;

    let abs_byte = byte_start + trim_offset + sent_end;
    Some(utf16_len(&content[..abs_byte]))
}

fn resolve_forward_paragraphs(content: &str, char_start: usize, n: usize) -> Option<usize> {
    if n == 0 {
        return Some(char_start);
    }
    let byte_start = utf16_to_byte(content, char_start);
    let text_after = &content[byte_start..];
    let bytes = text_after.as_bytes();

    let mut i = 0;
    while i < bytes.len() && bytes[i] == b'\n' {
        i += 1;
    }

    let mut paras_found = 0;
    while i + 1 < bytes.len() {
        if bytes[i] == b'\n' && bytes[i + 1] == b'\n' {
            paras_found += 1;
            if paras_found >= n {
                let abs_byte = byte_start + i;
                return Some(utf16_len(&content[..abs_byte]));
            }
            while i + 1 < bytes.len() && bytes[i + 1] == b'\n' {
                i += 1;
            }
        }
        i += 1;
    }

    Some(utf16_len(content))
}

fn resolve_forward_pages(content: &str, char_start: usize, n: usize) -> Option<usize> {
    if n == 0 {
        return Some(char_start);
    }
    let byte_start = utf16_to_byte(content, char_start);
    let text_after = &content[byte_start..];
    let bytes = text_after.as_bytes();

    let mut start = 0;
    while start < bytes.len() && bytes[start] == b'\x0C' {
        start += 1;
    }

    let mut pages_found = 0;
    for (i, b) in text_after[start..].bytes().enumerate() {
        if b == b'\x0C' {
            pages_found += 1;
            if pages_found >= n {
                let abs_byte = byte_start + start + i;
                return Some(utf16_len(&content[..abs_byte]));
            }
        }
    }

    Some(utf16_len(content))
}

fn resolve_asymmetric(
    content: &str,
    char_start: usize,
    unit: &ScopeKind,
    before: usize,
    after: usize,
    lang: &str,
) -> Option<(usize, usize)> {
    let backward_scope = match unit {
        ScopeKind::Word => Scope::Words(before),
        ScopeKind::Sentence => Scope::Sentence(before),
        ScopeKind::Paragraph => Scope::Paragraph(before),
        ScopeKind::Page => Scope::Page(before),
    };

    let start = if before == 0 {
        char_start
    } else {
        resolve_scope_range(content, char_start, &backward_scope, lang)
            .map(|r| r.start)
            .unwrap_or(char_start)
    };

    let end = match unit {
        ScopeKind::Word => resolve_forward_words(content, char_start, after),
        ScopeKind::Sentence => resolve_forward_sentences(content, char_start, after, lang),
        ScopeKind::Paragraph => resolve_forward_paragraphs(content, char_start, after),
        ScopeKind::Page => resolve_forward_pages(content, char_start, after),
    }
    .unwrap_or(char_start);

    Some((start, end))
}

pub fn resolve_scope_range_with_mode(
    content: &str,
    char_start: usize,
    scope: &Scope,
    lang: &str,
    mode: &ResolutionMode,
) -> Option<ScopeRange> {
    match mode {
        ResolutionMode::Backward => resolve_scope_range(content, char_start, scope, lang),
        ResolutionMode::Bidirectional => {
            let backward = resolve_scope_range(content, char_start, scope, lang)?;
            match scope {
                Scope::Words(n) => Some(ScopeRange {
                    start: backward.start,
                    end: resolve_forward_words(content, char_start, *n).unwrap_or(backward.end),
                }),
                Scope::Sentence(n) => Some(ScopeRange {
                    start: backward.start,
                    end: resolve_forward_sentences(content, char_start, *n, lang).unwrap_or(backward.end),
                }),
                Scope::Paragraph(n) => Some(ScopeRange {
                    start: backward.start,
                    end: resolve_forward_paragraphs(content, char_start, *n).unwrap_or(backward.end),
                }),
                Scope::Page(n) => Some(ScopeRange {
                    start: backward.start,
                    end: resolve_forward_pages(content, char_start, *n).unwrap_or(backward.end),
                }),
                _ => Some(backward),
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn words_1_single_preceding_word() {
        let content = "hello %%! n: _ | note %%";
        let char_start = 6;
        let result = resolve_scope_range(content, char_start, &Scope::Words(1), "en");
        assert_eq!(result, Some(ScopeRange { start: 0, end: 5 }));
    }

    #[test]
    fn words_2_two_preceding_words() {
        let content = "the quick brown fox %%! n: __ | note %%";
        let char_start = 20;
        let result = resolve_scope_range(content, char_start, &Scope::Words(2), "en");
        assert_eq!(result, Some(ScopeRange { start: 10, end: 19 }));
    }

    #[test]
    fn words_3_three_preceding_words() {
        let content = "the quick brown fox %%! n: ___ | note %%";
        let char_start = 20;
        let result = resolve_scope_range(content, char_start, &Scope::Words(3), "en");
        assert_eq!(result, Some(ScopeRange { start: 4, end: 19 }));
    }

    #[test]
    fn words_more_than_available() {
        let content = "brown fox %%! n: | note %%";
        let char_start = 10;
        let result = resolve_scope_range(content, char_start, &Scope::Words(5), "en");
        assert_eq!(result, Some(ScopeRange { start: 0, end: 9 }));
    }

    #[test]
    fn words_with_cjk() {
        let content = "你好 世界 %%! n: __ | note %%";
        let char_start = 5;
        let result = resolve_scope_range(content, char_start, &Scope::Words(1), "en");
        assert_eq!(result, Some(ScopeRange { start: 3, end: 5 }));
    }

    #[test]
    fn words_no_preceding_text() {
        let content = "%%! n: _ | note %%";
        let char_start = 0;
        let result = resolve_scope_range(content, char_start, &Scope::Words(1), "en");
        assert_eq!(result, None);
    }

    #[test]
    fn words_only_whitespace_before() {
        let content = "   %%! n: _ | note %%";
        let char_start = 3;
        let result = resolve_scope_range(content, char_start, &Scope::Words(1), "en");
        assert_eq!(result, None);
    }

    #[test]
    fn sentence_single_sentence() {
        let content = "The cat sat on the mat.%%! n: | note %%";
        let char_start = 23;
        let result = resolve_scope_range(content, char_start, &Scope::Sentence(1), "en");
        assert_eq!(result, Some(ScopeRange { start: 0, end: 23 }));
    }

    #[test]
    fn sentence_last_of_multiple_sentences() {
        let content = "The dog ran. The cat sat.%%! n: | note %%";
        let char_start = 25;
        let result = resolve_scope_range(content, char_start, &Scope::Sentence(1), "en");
        assert_eq!(result, Some(ScopeRange { start: 13, end: 25 }));
    }

    #[test]
    fn sentence_two_of_multiple() {
        let content = "First one. The dog ran. The cat sat.%%! n: \\ss | note %%";
        let char_start = 36;
        let result = resolve_scope_range(content, char_start, &Scope::Sentence(2), "en");
        assert_eq!(result, Some(ScopeRange { start: 11, end: 36 }));
    }

    #[test]
    fn sentence_more_than_available() {
        let content = "The dog ran. The cat sat.%%! n: \\sss | note %%";
        let char_start = 25;
        let result = resolve_scope_range(content, char_start, &Scope::Sentence(3), "en");
        assert_eq!(result, Some(ScopeRange { start: 0, end: 25 }));
    }

    #[test]
    fn sentence_mid_sentence() {
        let content = "The dog ran. The cat sat%%! n: | note %% on the mat.";
        let char_start = 25;
        let result = resolve_scope_range(content, char_start, &Scope::Sentence(1), "en");
        assert_eq!(result, Some(ScopeRange { start: 13, end: 25 }));
    }

    #[test]
    fn sentence_no_preceding_text() {
        let content = "%%! n: | note %%";
        let char_start = 0;
        let result = resolve_scope_range(content, char_start, &Scope::Sentence(1), "en");
        assert_eq!(result, None);
    }

    #[test]
    fn paragraph_1_current_paragraph() {
        let content = "First paragraph.\n\nSecond paragraph text.%%! n: \\p | note %%";
        let char_start = 40;
        let result = resolve_scope_range(content, char_start, &Scope::Paragraph(1), "en");
        assert_eq!(result, Some(ScopeRange { start: 18, end: 40 }));
    }

    #[test]
    fn paragraph_2_current_and_preceding() {
        let content = "First para.\n\nSecond para.\n\nThird para.%%! n: \\pp | note %%";
        let char_start = 38;
        let result = resolve_scope_range(content, char_start, &Scope::Paragraph(2), "en");
        assert_eq!(result, Some(ScopeRange { start: 13, end: 38 }));
    }

    #[test]
    fn paragraph_more_than_available() {
        let content = "Only paragraph.%%! n: \\ppp | note %%";
        let char_start = 15;
        let result = resolve_scope_range(content, char_start, &Scope::Paragraph(3), "en");
        assert_eq!(result, Some(ScopeRange { start: 0, end: 15 }));
    }

    #[test]
    fn paragraph_no_preceding_text() {
        let content = "%%! n: \\p | note %%";
        let char_start = 0;
        let result = resolve_scope_range(content, char_start, &Scope::Paragraph(1), "en");
        assert_eq!(result, None);
    }

    #[test]
    fn page_1_current_page() {
        let content = "Page one.\x0CPage two text.%%! n: \\f | note %%";
        let char_start = 25;
        let result = resolve_scope_range(content, char_start, &Scope::Page(1), "en");
        assert_eq!(result, Some(ScopeRange { start: 10, end: 25 }));
    }

    #[test]
    fn page_2_current_and_preceding() {
        let content = "Page one.\x0CPage two.\x0CPage three.%%! n: | note %%";
        let char_start = 31;
        let result = resolve_scope_range(content, char_start, &Scope::Page(2), "en");
        assert_eq!(result, Some(ScopeRange { start: 10, end: 31 }));
    }

    #[test]
    fn page_no_form_feed() {
        let content = "All one page.%%! n: \\f | note %%";
        let char_start = 14;
        let result = resolve_scope_range(content, char_start, &Scope::Page(1), "en");
        assert_eq!(result, Some(ScopeRange { start: 0, end: 14 }));
    }

    #[test]
    fn anchor_found() {
        let content = "The term anuttara appears in this text.%%! n: ^\"anuttara\" | note %%";
        let char_start = 39;
        let result = resolve_scope_range(
            content, char_start,
            &Scope::Anchor("anuttara".to_string()), "en",
        );
        assert_eq!(result, Some(ScopeRange { start: 9, end: 17 }));
    }

    #[test]
    fn anchor_not_found() {
        let content = "No match here.%%! n: ^\"missing\" | note %%";
        let char_start = 15;
        let result = resolve_scope_range(
            content, char_start,
            &Scope::Anchor("missing".to_string()), "en",
        );
        assert_eq!(result, None);
    }

    #[test]
    fn sentence_with_double_spaces() {
        let content = "Maximum depth  $d = 5$  and composition.%%! n: | note %%";
        let ann_start = content.find("%%!").unwrap();
        let ann_start_utf16 = utf16_len(&content[..ann_start]);
        let result = resolve_scope_range(content, ann_start_utf16, &Scope::Sentence(1), "en");
        assert!(result.is_some(), "scope should resolve despite double spaces");
        let range = result.unwrap();
        assert_eq!(range.start, 0);
        assert_eq!(range.end, ann_start_utf16);
    }

    #[test]
    fn sentence_double_spaces_multi_sentence() {
        let content = "First sentence. Second  has  double  spaces.%%! n: | note %%";
        let ann_start = content.find("%%!").unwrap();
        let ann_start_utf16 = utf16_len(&content[..ann_start]);
        let result = resolve_scope_range(content, ann_start_utf16, &Scope::Sentence(1), "en");
        assert!(result.is_some());
        let range = result.unwrap();
        assert_eq!(range.start, 16);
        assert_eq!(range.end, ann_start_utf16);
    }

    #[test]
    fn ws_flex_exact_match() {
        assert_eq!(ws_flexible_find("hello world", "hello world", 0), Some((0, 11)));
    }

    #[test]
    fn ws_flex_double_space_in_haystack() {
        assert_eq!(ws_flexible_find("hello  world", "hello world", 0), Some((0, 12)));
    }

    #[test]
    fn ws_flex_multiple_double_spaces() {
        assert_eq!(ws_flexible_find("a  b  c", "a b c", 0), Some((0, 7)));
    }

    #[test]
    fn ws_flex_start_offset() {
        assert_eq!(ws_flexible_find("xx hello  world", "hello world", 3), Some((3, 15)));
    }

    #[test]
    fn ws_flex_no_match() {
        assert_eq!(ws_flexible_find("hello world", "goodbye", 0), None);
    }

    #[test]
    fn document_scope_entire_content() {
        let content = "First line.\n\nSecond paragraph.\n\nThird paragraph.";
        let result = resolve_scope_range(content, 12, &Scope::Document, "en");
        assert_eq!(result, Some(ScopeRange { start: 0, end: utf16_len(content) }));
    }

    #[test]
    fn document_scope_empty() {
        assert_eq!(
            resolve_scope_range("", 0, &Scope::Document, "en"),
            Some(ScopeRange { start: 0, end: 0 })
        );
    }

    #[test]
    fn section_scope_middle_heading() {
        let content = "# Intro\n\nSome text.\n\n## Methods\n\nMethod details.%%! n %%\n\n## Results\n\nResult text.";
        let ann_pos = content.find("%%!").unwrap();
        let char_start = utf16_len(&content[..ann_pos]);
        let result = resolve_scope_range(content, char_start, &Scope::Section, "en");
        let range = result.unwrap();
        let expected_start = utf16_len(&content[..content.find("## Methods").unwrap()]);
        let expected_end = utf16_len(&content[..content.find("## Results").unwrap()]);
        assert_eq!(range.start, expected_start);
        assert_eq!(range.end, expected_end);
    }

    #[test]
    fn section_scope_last_heading() {
        let content = "# Title\n\nText.\n\n## Last Section\n\nFinal text.";
        let char_start = utf16_len(&content[..content.len() - 5]);
        let range = resolve_scope_range(content, char_start, &Scope::Section, "en").unwrap();
        assert_eq!(range.start, utf16_len(&content[..content.find("## Last Section").unwrap()]));
        assert_eq!(range.end, utf16_len(content));
    }

    #[test]
    fn section_scope_no_headings() {
        let content = "Just plain text with no headings.";
        let range = resolve_scope_range(content, 5, &Scope::Section, "en").unwrap();
        assert_eq!(range, ScopeRange { start: 0, end: utf16_len(content) });
    }

    #[test]
    fn section_scope_before_first_heading() {
        let content = "Preamble text.\n\n# First Heading\n\nBody.";
        let range = resolve_scope_range(content, 3, &Scope::Section, "en").unwrap();
        assert_eq!(range.start, 0);
        assert_eq!(range.end, utf16_len(&content[..content.find("# First Heading").unwrap()]));
    }

    #[test]
    fn asymmetric_words_forward() {
        let content = "alpha beta gamma delta epsilon";
        let char_start = utf16_len(&content[..content.find(" gamma").unwrap()]);
        let result = resolve_scope_range(
            content,
            char_start,
            &Scope::Asymmetric { unit: ScopeKind::Word, before: 1, after: 2 },
            "en",
        );
        let range = result.unwrap();
        assert_eq!(range.start, utf16_len(&content[..content.find("beta").unwrap()]));
        assert_eq!(range.end, utf16_len(&content[..content.find("delta").unwrap() + "delta".len()]));
    }

    #[test]
    fn asymmetric_sentence_forward() {
        let content = "Before sentence. After first. After second. After third.";
        let char_start = utf16_len(&content[..content.find(" After").unwrap()]);
        let result = resolve_scope_range(
            content,
            char_start,
            &Scope::Asymmetric { unit: ScopeKind::Sentence, before: 1, after: 2 },
            "en",
        );
        let range = result.unwrap();
        assert_eq!(range.start, 0);
        assert_eq!(range.end, utf16_len(&content[..content.find(" After third").unwrap()]));
    }

    #[test]
    fn asymmetric_paragraph_forward() {
        let content = "Before.\n\nMiddle.\n\nAfter one.\n\nAfter two.";
        let char_start = utf16_len(&content[..content.find("\n\nAfter").unwrap()]);
        let result = resolve_scope_range(
            content,
            char_start,
            &Scope::Asymmetric { unit: ScopeKind::Paragraph, before: 1, after: 1 },
            "en",
        );
        let range = result.unwrap();
        assert_eq!(range.end, utf16_len(&content[..content.find("\n\nAfter two").unwrap()]));
    }

    #[test]
    fn asymmetric_page_forward() {
        let content = "Page one.\x0CPage two.\x0CPage three.\x0CPage four.";
        let char_start = utf16_len(&content[..content.find("\x0CPage three").unwrap()]);
        let result = resolve_scope_range(
            content,
            char_start,
            &Scope::Asymmetric { unit: ScopeKind::Page, before: 1, after: 1 },
            "en",
        );
        let range = result.unwrap();
        assert_eq!(range.end, utf16_len(&content[..content.rfind("\x0CPage four").unwrap()]));
    }

    #[test]
    fn bidirectional_paragraph() {
        let content = "Before.\n\nMiddle.\n\nAfter.";
        let char_start = utf16_len(&content[..content.find("\n\nAfter").unwrap()]);
        let result = resolve_scope_range_with_mode(
            content,
            char_start,
            &Scope::Paragraph(1),
            "en",
            &ResolutionMode::Bidirectional,
        );
        let range = result.unwrap();
        let middle_start = utf16_len(&content[..content.find("Middle").unwrap()]);
        assert_eq!(range.start, middle_start);
        assert_eq!(range.end, utf16_len(content));
    }

    #[test]
    fn backward_mode_matches_original() {
        let content = "hello world %%! n %%";
        let cs = utf16_len(&content[..content.find("%%!").unwrap()]);
        let backward = resolve_scope_range_with_mode(content, cs, &Scope::Words(1), "en", &ResolutionMode::Backward);
        let original = resolve_scope_range(content, cs, &Scope::Words(1), "en");
        assert_eq!(backward, original);
    }

    // --- Cycle 1: ws_flexible_find handles \n\n ---

    #[test]
    fn ws_flex_double_newline_in_haystack() {
        assert_eq!(ws_flexible_find("hello\n\nworld", "hello world", 0), Some((0, 12)));
    }

    #[test]
    fn ws_flex_newline_and_spaces_mixed() {
        assert_eq!(ws_flexible_find("a\n\nb\n\nc", "a b c", 0), Some((0, 7)));
    }

    // --- Cycle 2: backward sentence crosses paragraph boundary ---

    #[test]
    fn sentence_crosses_paragraph_boundary_backward() {
        let content = "First sentence.\n\nSecond sentence.%%! n \\ss | note %%";
        let char_start = utf16_len(&content[..content.find("%%!").unwrap()]);
        let result = resolve_scope_range(content, char_start, &Scope::Sentence(2), "en");
        let range = result.unwrap();
        assert_eq!(range.start, 0);
    }

    #[test]
    fn sentence_one_in_current_para_backward() {
        let content = "First sentence.\n\nSecond sentence.%%! n \\s | note %%";
        let char_start = utf16_len(&content[..content.find("%%!").unwrap()]);
        let result = resolve_scope_range(content, char_start, &Scope::Sentence(1), "en");
        let range = result.unwrap();
        let expected_start = utf16_len(&content[..content.find("Second").unwrap()]);
        assert_eq!(range.start, expected_start);
    }

    // --- Cycle 3: backward edge cases ---

    #[test]
    fn sentence_crosses_two_paragraph_boundaries_backward() {
        let content = "First sentence.\n\nSecond sentence.\n\nThird sentence.%%! n \\sss | note %%";
        let char_start = utf16_len(&content[..content.find("%%!").unwrap()]);
        let result = resolve_scope_range(content, char_start, &Scope::Sentence(3), "en");
        let range = result.unwrap();
        assert_eq!(range.start, 0);
    }

    #[test]
    fn sentence_more_than_available_cross_paragraph_backward() {
        let content = "First sentence.\n\nSecond sentence.%%! n | note %%";
        let char_start = utf16_len(&content[..content.find("%%!").unwrap()]);
        let result = resolve_scope_range(content, char_start, &Scope::Sentence(5), "en");
        let range = result.unwrap();
        assert_eq!(range.start, 0);
    }

    #[test]
    fn sentence_empty_paragraph_between_content_backward() {
        let content = "First sentence.\n\n\n\nSecond sentence.%%! n \\ss | note %%";
        let char_start = utf16_len(&content[..content.find("%%!").unwrap()]);
        let result = resolve_scope_range(content, char_start, &Scope::Sentence(2), "en");
        let range = result.unwrap();
        assert_eq!(range.start, 0);
    }

    // --- Cycle 4: forward sentence crosses paragraph boundary ---

    #[test]
    fn forward_sentence_crosses_paragraph_boundary() {
        let content = "Before. First fwd.\n\nSecond fwd.";
        let char_start = utf16_len(&content[..content.find(" First").unwrap()]);
        let result = resolve_scope_range(
            content,
            char_start,
            &Scope::Asymmetric { unit: ScopeKind::Sentence, before: 1, after: 2 },
            "en",
        );
        let range = result.unwrap();
        assert_eq!(range.end, utf16_len(content));
    }

    #[test]
    fn forward_sentence_one_in_current_paragraph() {
        let content = "Before. First fwd.\n\nSecond fwd.";
        let char_start = utf16_len(&content[..content.find(" First").unwrap()]);
        let result = resolve_scope_range(
            content,
            char_start,
            &Scope::Asymmetric { unit: ScopeKind::Sentence, before: 1, after: 1 },
            "en",
        );
        let range = result.unwrap();
        let expected_end = utf16_len(&content[..content.find("\n\nSecond").unwrap()]);
        assert_eq!(range.end, expected_end);
    }

    // --- Cycle 5: forward edge cases ---

    #[test]
    fn forward_sentence_more_than_available_cross_paragraph() {
        let content = "Before. First fwd.\n\nSecond fwd.";
        let char_start = utf16_len(&content[..content.find(" First").unwrap()]);
        let result = resolve_scope_range(
            content,
            char_start,
            &Scope::Asymmetric { unit: ScopeKind::Sentence, before: 1, after: 5 },
            "en",
        );
        let range = result.unwrap();
        assert_eq!(range.end, utf16_len(content));
    }

    #[test]
    fn forward_sentence_empty_paragraph_between() {
        let content = "Before. First fwd.\n\n\n\nSecond fwd.";
        let char_start = utf16_len(&content[..content.find(" First").unwrap()]);
        let result = resolve_scope_range(
            content,
            char_start,
            &Scope::Asymmetric { unit: ScopeKind::Sentence, before: 1, after: 2 },
            "en",
        );
        let range = result.unwrap();
        assert_eq!(range.end, utf16_len(content));
    }

    // --- Cycle 6: bidirectional + CJK ---

    #[test]
    fn bidirectional_sentence_crosses_paragraphs() {
        let content = "Sent A.\n\nSent B.\n\nSent C.\n\nSent D.";
        let char_start = utf16_len(&content[..content.find("\n\nSent C").unwrap()]);
        let result = resolve_scope_range_with_mode(
            content,
            char_start,
            &Scope::Sentence(2),
            "en",
            &ResolutionMode::Bidirectional,
        );
        let range = result.unwrap();
        assert_eq!(range.start, 0);
        assert_eq!(range.end, utf16_len(content));
    }

    #[test]
    fn sentence_crosses_paragraph_boundary_cjk() {
        let content = "第一句话。\n\n第二句话。%%! n \\ss | note %%";
        let char_start = utf16_len(&content[..content.find("%%!").unwrap()]);
        let result = resolve_scope_range(content, char_start, &Scope::Sentence(2), "zh");
        let range = result.unwrap();
        assert_eq!(range.start, 0);
    }

    #[test]
    fn sentence_cjk_with_prior_annotation_debris() {
        let content = "Silently count to 10 seconds before speaking\"\n%%\n\n4.接电话前先微笑(加州大学) -- not renders\n\n%%! q \\s | what does this mean? %%";
        let char_start = utf16_len(&content[..content.rfind("%%!").unwrap()]);
        let result = resolve_sentence(content, char_start, 1, "en");
        assert!(result.is_some());
    }

    #[test]
    fn paragraph_cjk_with_prior_annotation_debris() {
        let content = "Silently count to 10 seconds before speaking\"\n%%\n\n4.接电话前先微笑(加州大学) -- not renders\n\n%%! q \\p | what does this mean? %%";
        let char_start = utf16_len(&content[..content.rfind("%%!").unwrap()]);
        let result = resolve_paragraph(content, char_start, 1);
        assert!(result.is_some());
        let (start, end) = result.unwrap();
        let scope = &content[utf16_to_byte(content, start)..utf16_to_byte(content, end)];
        assert!(!scope.contains("%%!"));
    }

    #[test]
    fn forward_sentence_with_dashes_in_text() {
        let content = "Before. First -- important. After that.";
        let char_start = utf16_len(&content[..content.find(" First").unwrap()]);
        let result = resolve_scope_range(
            content,
            char_start,
            &Scope::Asymmetric { unit: ScopeKind::Sentence, before: 1, after: 1 },
            "en",
        );
        let range = result.unwrap();
        let expected_end = utf16_len(&content[..content.find(" After").unwrap()]);
        assert_eq!(range.end, expected_end);
    }

    #[test]
    fn sentence_with_double_comma_resolves() {
        let content = "First sentence. Second,, important sentence.%%! n \\s | note %%";
        let char_start = utf16_len(&content[..content.find("%%!").unwrap()]);
        let result = resolve_scope_range(content, char_start, &Scope::Sentence(1), "en");
        assert!(result.is_some());
    }
}
