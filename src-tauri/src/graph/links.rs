use regex::Regex;
use std::sync::LazyLock;

static INLINE_CODE_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"`[^`]+`").unwrap());

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WikiLink {
    pub target: String,
    pub display: Option<String>,
    pub section: Option<String>,
}

pub fn extract_wikilinks(body: &str) -> Vec<WikiLink> {
    let mut text = body.to_string();

    blank_fenced_code_blocks(&mut text);
    blank_inline_code(&mut text);

    let re = Regex::new(r"\[\[([^\[\]]+)\]\]").unwrap();
    let mut links = Vec::new();

    for m in re.find_iter(&text) {
        let start = m.start();
        if start > 0 && text.as_bytes()[start - 1] == b'!' {
            continue;
        }

        let caps = re.captures(m.as_str()).unwrap();
        let inner = caps.get(1).unwrap().as_str().trim();

        if inner.is_empty() {
            continue;
        }

        let (target_part, display) = if let Some(pipe_pos) = inner.find('|') {
            let t = inner[..pipe_pos].trim();
            let d = inner[pipe_pos + 1..].trim();
            (t.to_string(), Some(d.to_string()))
        } else {
            (inner.to_string(), None)
        };

        let (target, section) = if let Some(hash_pos) = target_part.find('#') {
            let t = target_part[..hash_pos].trim().to_string();
            let s = target_part[hash_pos + 1..].trim().to_string();
            (t, Some(s))
        } else {
            (target_part, None)
        };

        links.push(WikiLink {
            target,
            display,
            section,
        });
    }

    links
}

pub(crate) fn blank_frontmatter(text: &mut String) {
    if !text.starts_with("---\n") && !text.starts_with("---\r\n") {
        return;
    }
    let search_start = if text.starts_with("---\r\n") { 5 } else { 4 };
    let closing = text[search_start..]
        .lines()
        .scan(search_start, |pos, line| {
            let line_start = *pos;
            // +1 for the \n; handle \r\n
            *pos += line.len() + 1;
            if line.ends_with('\r') {
                // already counted in line.len()
            }
            Some((line_start, line))
        })
        .find(|(_, line)| line.trim() == "---");
    if let Some((fence_start, fence_line)) = closing {
        let body_start = fence_start + fence_line.len() + 1;
        let body_start = body_start.min(text.len());
        let prefix = " ".repeat(body_start);
        text.replace_range(..body_start, &prefix);
    }
}

pub(crate) fn blank_fenced_code_blocks(text: &mut String) {
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

    if text.ends_with('\n') {
        // split('\n') on a string ending with '\n' produces a trailing empty element;
        // our loop appends '\n' after it, creating one extra byte. Trim it.
        if result.len() > text.len() {
            result.pop();
        }
    } else if result.ends_with('\n') {
        result.pop();
    }

    *text = result;
}

pub(crate) fn blank_inline_code(text: &mut String) {
    let blanked = INLINE_CODE_RE.replace_all(text, |caps: &regex::Captures| {
        let matched = caps.get(0).unwrap().as_str();
        " ".repeat(matched.len())
    });
    *text = blanked.into_owned();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn blank_frontmatter_preserves_length() {
        let input = "---\ntitle: \"[[Page]]\"\ntags: [a]\n---\nBody text here.".to_string();
        let mut text = input.clone();
        blank_frontmatter(&mut text);
        assert_eq!(text.len(), input.len());
        assert!(text.ends_with("Body text here."));
        assert!(!text.contains("title:"));
    }

    #[test]
    fn blanking_preserves_byte_length_multibyte() {
        let input = "before\n```\n你好 [[Link]] 世界\n```\nafter `code 你好`".to_string();
        let mut text = input.clone();
        blank_fenced_code_blocks(&mut text);
        assert_eq!(text.len(), input.len());
        blank_inline_code(&mut text);
        assert_eq!(text.len(), input.len());
    }

    #[test]
    fn blanking_preserves_byte_length_emoji() {
        let input = "text `🎉 emoji code` more".to_string();
        let mut text = input.clone();
        blank_inline_code(&mut text);
        assert_eq!(text.len(), input.len());
    }

    #[test]
    fn blank_frontmatter_preserves_byte_length_multibyte() {
        let input = "---\ntitle: \"你好世界\"\n---\nBody.".to_string();
        let mut text = input.clone();
        blank_frontmatter(&mut text);
        assert_eq!(text.len(), input.len());
    }

    #[test]
    fn blank_frontmatter_no_fence() {
        let input = "No frontmatter here.".to_string();
        let mut text = input.clone();
        blank_frontmatter(&mut text);
        assert_eq!(text, input);
    }

    #[test]
    fn blank_frontmatter_unclosed() {
        let input = "---\ntitle: Test\nNo closing fence".to_string();
        let mut text = input.clone();
        blank_frontmatter(&mut text);
        assert_eq!(text, input);
    }

    #[test]
    fn simple_link() {
        let links = extract_wikilinks("See [[Page]] for info.");
        assert_eq!(
            links,
            vec![WikiLink {
                target: "Page".into(),
                display: None,
                section: None,
            }]
        );
    }

    #[test]
    fn link_with_display() {
        let links = extract_wikilinks("See [[Page|shown text]].");
        assert_eq!(
            links,
            vec![WikiLink {
                target: "Page".into(),
                display: Some("shown text".into()),
                section: None,
            }]
        );
    }

    #[test]
    fn link_with_section() {
        let links = extract_wikilinks("See [[Page#Heading]].");
        assert_eq!(
            links,
            vec![WikiLink {
                target: "Page".into(),
                display: None,
                section: Some("Heading".into()),
            }]
        );
    }

    #[test]
    fn link_with_section_and_display() {
        let links = extract_wikilinks("See [[Page#Heading|text]].");
        assert_eq!(
            links,
            vec![WikiLink {
                target: "Page".into(),
                display: Some("text".into()),
                section: Some("Heading".into()),
            }]
        );
    }

    #[test]
    fn embed_image_skipped() {
        let links = extract_wikilinks("![[image.png]]");
        assert!(links.is_empty());
    }

    #[test]
    fn embed_note_skipped() {
        let links = extract_wikilinks("![[note]]");
        assert!(links.is_empty());
    }

    #[test]
    fn inside_fenced_code_block_skipped() {
        let body = "before\n```\n[[Link]]\n```\nafter";
        let links = extract_wikilinks(body);
        assert!(links.is_empty());
    }

    #[test]
    fn inside_inline_code_skipped() {
        let links = extract_wikilinks("Use `[[Link]]` in code.");
        assert!(links.is_empty());
    }

    #[test]
    fn multiple_links_one_line() {
        let links = extract_wikilinks("See [[A]] and [[B]].");
        assert_eq!(links.len(), 2);
        assert_eq!(links[0].target, "A");
        assert_eq!(links[1].target, "B");
    }

    #[test]
    fn multiple_links_across_lines() {
        let links = extract_wikilinks("Line one [[A]].\nLine two [[B]].");
        assert_eq!(links.len(), 2);
        assert_eq!(links[0].target, "A");
        assert_eq!(links[1].target, "B");
    }

    #[test]
    fn link_with_folder_path() {
        let links = extract_wikilinks("[[folder/Page]]");
        assert_eq!(
            links,
            vec![WikiLink {
                target: "folder/Page".into(),
                display: None,
                section: None,
            }]
        );
    }

    #[test]
    fn empty_brackets_skipped() {
        let links = extract_wikilinks("[[]]");
        assert!(links.is_empty());
    }

    #[test]
    fn no_links_returns_empty() {
        let links = extract_wikilinks("Just some plain text.");
        assert!(links.is_empty());
    }

    #[test]
    fn mixed_valid_code_embeds() {
        let body = "Real [[A]]. In code `[[B]]`. Embed ![[C]]. Also [[D]].";
        let links = extract_wikilinks(body);
        assert_eq!(links.len(), 2);
        assert_eq!(links[0].target, "A");
        assert_eq!(links[1].target, "D");
    }

    #[test]
    fn tilde_fenced_code_block_skipped() {
        let body = "before\n~~~\n[[Link]]\n~~~\nafter";
        let links = extract_wikilinks(body);
        assert!(links.is_empty());
    }

    #[test]
    fn link_immediately_after_code_span() {
        let body = "`code`[[Page]]";
        let links = extract_wikilinks(body);
        assert_eq!(links.len(), 1);
        assert_eq!(links[0].target, "Page");
    }
}
