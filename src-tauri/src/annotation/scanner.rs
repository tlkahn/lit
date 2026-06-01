#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RawAnnotation {
    pub char_start: usize,
    pub char_end: usize,
    pub inner: String,
    pub original: String,
}

pub(crate) fn utf16_len(s: &str) -> usize {
    s.chars().map(|c| c.len_utf16()).sum()
}

pub fn scan_annotations(content: &str) -> Vec<RawAnnotation> {
    let fenced_ranges = find_fenced_ranges(content);

    let mut results = Vec::new();
    let mut search_from = 0usize;
    let mut last_byte = 0usize;
    let mut utf16_acc = 0usize;

    while let Some(rel) = content[search_from..].find("<!---") {
        let open_byte = search_from + rel;

        if is_in_fenced_range(open_byte, &fenced_ranges) {
            search_from = open_byte + 5;
            continue;
        }

        let after_open = open_byte + 5;
        if let Some(close_rel) = content[after_open..].find("--->") {
            let close_byte = after_open + close_rel;
            let end_byte = close_byte + 4;

            utf16_acc += utf16_len(&content[last_byte..open_byte]);
            let comment_utf16_start = utf16_acc;

            let original = &content[open_byte..end_byte];
            let comment_utf16_end = comment_utf16_start + utf16_len(original);

            let inner_raw = &content[after_open..close_byte];
            let inner = inner_raw.trim().to_string();

            results.push(RawAnnotation {
                char_start: comment_utf16_start,
                char_end: comment_utf16_end,
                inner,
                original: original.to_string(),
            });

            last_byte = open_byte;
            search_from = end_byte;
        } else {
            break;
        }
    }

    results
}

struct FencedRange {
    start: usize,
    end: usize,
}

fn find_fenced_ranges(content: &str) -> Vec<FencedRange> {
    let mut ranges = Vec::new();
    let mut in_fence = false;
    let mut fence_marker = String::new();
    let mut fence_start_byte = 0usize;
    let mut byte_offset = 0usize;

    for line in content.split('\n') {
        let trimmed = line.trim_start();

        if !in_fence {
            if let Some(marker) = detect_fence_open(trimmed) {
                in_fence = true;
                fence_marker = marker;
                fence_start_byte = byte_offset;
            }
        } else if detect_fence_close(trimmed, &fence_marker) {
            let fence_end_byte = byte_offset + line.len();
            ranges.push(FencedRange {
                start: fence_start_byte,
                end: fence_end_byte,
            });
            in_fence = false;
            fence_marker.clear();
        }

        byte_offset += line.len() + 1;
    }

    if in_fence {
        ranges.push(FencedRange {
            start: fence_start_byte,
            end: content.len(),
        });
    }

    ranges
}

fn detect_fence_open(trimmed: &str) -> Option<String> {
    if trimmed.starts_with("```") {
        let fence_len = trimmed.chars().take_while(|&c| c == '`').count();
        Some("`".repeat(fence_len))
    } else if trimmed.starts_with("~~~") {
        let fence_len = trimmed.chars().take_while(|&c| c == '~').count();
        Some("~".repeat(fence_len))
    } else {
        None
    }
}

fn detect_fence_close(trimmed: &str, marker: &str) -> bool {
    if marker.starts_with('`') {
        trimmed.starts_with(marker) && trimmed.trim().chars().all(|c| c == '`')
    } else {
        trimmed.starts_with(marker) && trimmed.trim().chars().all(|c| c == '~')
    }
}

fn is_in_fenced_range(byte_offset: usize, ranges: &[FencedRange]) -> bool {
    ranges.iter().any(|r| byte_offset >= r.start && byte_offset < r.end)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn single_line_annotation() {
        let doc = "hello <!--- world ---> end";
        let anns = scan_annotations(doc);
        assert_eq!(anns.len(), 1);
        assert_eq!(anns[0].inner, "world");
        assert_eq!(anns[0].original, "<!--- world --->");
        assert_eq!(anns[0].char_start, 6);
        assert_eq!(anns[0].char_end, 22);
    }

    #[test]
    fn multi_line_annotation() {
        let doc = "before\n<!---\nfoo\nbar\n--->\nafter";
        let anns = scan_annotations(doc);
        assert_eq!(anns.len(), 1);
        assert_eq!(anns[0].inner, "foo\nbar");
        assert_eq!(anns[0].original, "<!---\nfoo\nbar\n--->");
        assert_eq!(anns[0].char_start, 7);
    }

    #[test]
    fn multiple_annotations() {
        let doc = "<!--- a ---> text <!--- b --->";
        let anns = scan_annotations(doc);
        assert_eq!(anns.len(), 2);
        assert_eq!(anns[0].inner, "a");
        assert_eq!(anns[1].inner, "b");
    }

    #[test]
    fn empty_document() {
        assert_eq!(scan_annotations("").len(), 0);
    }

    #[test]
    fn no_annotations() {
        assert_eq!(scan_annotations("just regular text").len(), 0);
    }

    #[test]
    fn empty_annotation() {
        let anns = scan_annotations("<!---  --->");
        assert_eq!(anns.len(), 1);
        assert_eq!(anns[0].inner, "");
    }

    #[test]
    fn annotation_no_spaces() {
        let anns = scan_annotations("<!---text--->");
        assert_eq!(anns.len(), 1);
        assert_eq!(anns[0].inner, "text");
    }

    #[test]
    fn skip_annotation_in_backtick_fence() {
        let doc = "before\n```\n<!--- skip --->\n```\nafter <!--- keep --->";
        let anns = scan_annotations(doc);
        assert_eq!(anns.len(), 1);
        assert_eq!(anns[0].inner, "keep");
    }

    #[test]
    fn skip_annotation_in_tilde_fence() {
        let doc = "~~~\n<!--- skip --->\n~~~\n<!--- keep --->";
        let anns = scan_annotations(doc);
        assert_eq!(anns.len(), 1);
        assert_eq!(anns[0].inner, "keep");
    }

    #[test]
    fn skip_annotation_in_four_backtick_fence() {
        let doc = "````\n```\n<!--- skip --->\n```\n````\n<!--- keep --->";
        let anns = scan_annotations(doc);
        assert_eq!(anns.len(), 1);
        assert_eq!(anns[0].inner, "keep");
    }

    #[test]
    fn fence_with_language_tag() {
        let doc = "```rust\n<!--- skip --->\n```\n<!--- keep --->";
        let anns = scan_annotations(doc);
        assert_eq!(anns.len(), 1);
        assert_eq!(anns[0].inner, "keep");
    }

    #[test]
    fn plain_html_comments_ignored() {
        let doc = "<!-- normal --> <!--- keep --->";
        let anns = scan_annotations(doc);
        assert_eq!(anns.len(), 1);
        assert_eq!(anns[0].inner, "keep");
    }

    #[test]
    fn utf16_offsets_ascii() {
        // "ab " = 3, then "<!--- c --->" = 12 chars
        let doc = "ab <!--- c ---> de";
        let anns = scan_annotations(doc);
        assert_eq!(anns[0].char_start, 3);
        assert_eq!(anns[0].char_end, 15);
    }

    #[test]
    fn utf16_offsets_cjk() {
        // "你好" = 2 UTF-16 units, "<!--- note --->" = 15 chars
        let doc = "你好<!--- note --->";
        let anns = scan_annotations(doc);
        assert_eq!(anns[0].char_start, 2);
        assert_eq!(anns[0].char_end, 17);
    }

    #[test]
    fn utf16_offsets_emoji() {
        // 🎉 = U+1F389 = 2 UTF-16 code units, "<!--- hi --->" = 13 chars
        let doc = "🎉<!--- hi --->";
        let anns = scan_annotations(doc);
        assert_eq!(anns[0].char_start, 2);
        assert_eq!(anns[0].char_end, 15);
    }

    #[test]
    fn utf16_offsets_mixed() {
        // "a你🎉" = 1 + 1 + 2 = 4 UTF-16 units
        let doc = "a你🎉<!--- x --->";
        let anns = scan_annotations(doc);
        assert_eq!(anns[0].char_start, 4);
    }

    #[test]
    fn unclosed_annotation() {
        let doc = "<!--- no end";
        assert_eq!(scan_annotations(doc).len(), 0);
    }

    #[test]
    fn annotation_at_document_start() {
        let doc = "<!--- first --->";
        let anns = scan_annotations(doc);
        assert_eq!(anns[0].char_start, 0);
    }

    #[test]
    fn adjacent_annotations() {
        let doc = "<!--- a ---><!--- b --->";
        let anns = scan_annotations(doc);
        assert_eq!(anns.len(), 2);
        assert_eq!(anns[0].inner, "a");
        assert_eq!(anns[1].inner, "b");
    }

    #[test]
    fn annotation_after_multiline() {
        let doc = "<!---\nblock\n--->\n<!--- inline --->";
        let anns = scan_annotations(doc);
        assert_eq!(anns.len(), 2);
        assert_eq!(anns[0].inner, "block");
        assert_eq!(anns[1].inner, "inline");
    }
}
