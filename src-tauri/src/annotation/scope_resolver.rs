use super::scanner::utf16_len;
use super::types::{Scope, ScopeRange};

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

    let para_byte_start = trimmed.rfind("\n\n").map(|i| i + 2).unwrap_or(0);
    let paragraph = &trimmed[para_byte_start..];

    if paragraph.trim().is_empty() {
        return None;
    }

    let sentences = sentenza::split_sentences(paragraph, lang);
    if sentences.is_empty() {
        return None;
    }

    let take = n.min(sentences.len());
    let first_sentence = &sentences[sentences.len() - take];
    let last_sentence = &sentences[sentences.len() - 1];

    let (first_start, _) = ws_flexible_find(paragraph, first_sentence, 0)?;
    let (_, last_end) = ws_flexible_find(paragraph, last_sentence, first_start)?;

    let scope_start_byte = para_byte_start + first_start;
    let scope_end_byte = (para_byte_start + last_end).min(trimmed.len());

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
}
