use std::collections::HashMap;

pub fn parse_frontmatter(raw: &str) -> (HashMap<String, serde_yaml::Value>, &str) {
    if !raw.starts_with("---") {
        return (HashMap::new(), raw);
    }

    let after_opening = &raw[3..];
    if !after_opening.starts_with('\n') && !after_opening.starts_with("\r\n") {
        return (HashMap::new(), raw);
    }

    let content_start = if after_opening.starts_with("\r\n") {
        5
    } else {
        4
    };
    let rest = &raw[content_start..];

    let closing = find_closing_fence(rest);
    let (yaml_str, body) = match closing {
        Some((yaml_end, body_start)) => (&rest[..yaml_end], &rest[body_start..]),
        None => return (HashMap::new(), raw),
    };

    let map: HashMap<String, serde_yaml::Value> = if yaml_str.trim().is_empty() {
        HashMap::new()
    } else {
        match serde_yaml::from_str(yaml_str) {
            Ok(m) => m,
            Err(_) => return (HashMap::new(), raw),
        }
    };

    (map, body)
}

fn find_closing_fence(s: &str) -> Option<(usize, usize)> {
    let mut pos = 0;
    for line in s.lines() {
        if line.trim() == "---" {
            let fence_end = pos + line.len();
            let body_start = if s[fence_end..].starts_with('\n') {
                fence_end + 1
            } else if s[fence_end..].starts_with("\r\n") {
                fence_end + 2
            } else {
                fence_end
            };
            return Some((pos, body_start));
        }
        pos += line.len();
        if s[pos..].starts_with("\r\n") {
            pos += 2;
        } else if s[pos..].starts_with('\n') {
            pos += 1;
        }
    }
    None
}

pub fn serialize_frontmatter(
    frontmatter: &HashMap<String, serde_yaml::Value>,
    body: &str,
) -> String {
    if frontmatter.is_empty() {
        return body.to_string();
    }

    let yaml = serde_yaml::to_string(frontmatter).unwrap_or_default();
    format!("---\n{yaml}---\n{body}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_with_frontmatter() {
        let raw = "---\ntitle: Hello\ntags:\n  - rust\n  - tauri\n---\n# Body\nContent here.\n";
        let (fm, body) = parse_frontmatter(raw);
        assert_eq!(
            fm.get("title"),
            Some(&serde_yaml::Value::String("Hello".to_string()))
        );
        let tags = fm.get("tags").unwrap();
        assert!(tags.is_sequence());
        assert_eq!(body, "# Body\nContent here.\n");
    }

    #[test]
    fn parse_without_frontmatter() {
        let raw = "# Just markdown\nNo frontmatter here.\n";
        let (fm, body) = parse_frontmatter(raw);
        assert!(fm.is_empty());
        assert_eq!(body, raw);
    }

    #[test]
    fn parse_empty_frontmatter() {
        let raw = "---\n---\nBody content.\n";
        let (fm, body) = parse_frontmatter(raw);
        assert!(fm.is_empty());
        assert_eq!(body, "Body content.\n");
    }

    #[test]
    fn round_trip() {
        let mut fm = HashMap::new();
        fm.insert(
            "title".to_string(),
            serde_yaml::Value::String("Test Page".to_string()),
        );
        let body = "# Hello\nWorld\n";
        let serialized = serialize_frontmatter(&fm, body);
        let (parsed_fm, parsed_body) = parse_frontmatter(&serialized);
        assert_eq!(parsed_fm.get("title"), fm.get("title"));
        assert_eq!(parsed_body, body);
    }

    #[test]
    fn various_yaml_types() {
        let raw = "---\nstring_val: hello\nnum_val: 42\nlist_val:\n  - a\n  - b\nnested:\n  key: value\n---\nBody\n";
        let (fm, body) = parse_frontmatter(raw);
        assert_eq!(
            fm.get("string_val"),
            Some(&serde_yaml::Value::String("hello".to_string()))
        );
        assert!(fm.get("num_val").unwrap().is_number());
        assert!(fm.get("list_val").unwrap().is_sequence());
        assert!(fm.get("nested").unwrap().is_mapping());
        assert_eq!(body, "Body\n");
    }

    #[test]
    fn preserve_body_exactly() {
        let body_content = "Line 1\n\nLine 3\n  indented\n";
        let raw = format!("---\ntitle: X\n---\n{body_content}");
        let (_, body) = parse_frontmatter(&raw);
        assert_eq!(body, body_content);
    }

    #[test]
    fn serialize_empty_frontmatter_omits_fences() {
        let fm = HashMap::new();
        let body = "Just content\n";
        let result = serialize_frontmatter(&fm, body);
        assert_eq!(result, body);
        assert!(!result.contains("---"));
    }
}
