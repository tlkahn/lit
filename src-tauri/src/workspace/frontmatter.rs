use indexmap::IndexMap;

pub struct ParsedFrontmatter<'a> {
    pub map: IndexMap<String, serde_yaml::Value>,
    pub raw_yaml: String,
    pub body: &'a str,
}

pub fn parse_frontmatter(raw: &str) -> ParsedFrontmatter<'_> {
    let empty = || ParsedFrontmatter {
        map: IndexMap::new(),
        raw_yaml: String::new(),
        body: raw,
    };

    if !raw.starts_with("---") {
        return empty();
    }

    let after_opening = &raw[3..];
    if !after_opening.starts_with('\n') && !after_opening.starts_with("\r\n") {
        return empty();
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
        None => return empty(),
    };

    let map: IndexMap<String, serde_yaml::Value> = if yaml_str.trim().is_empty() {
        IndexMap::new()
    } else {
        match serde_yaml::from_str(yaml_str) {
            Ok(m) => m,
            Err(_) => return empty(),
        }
    };

    ParsedFrontmatter {
        raw_yaml: yaml_str.to_string(),
        map,
        body,
    }
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

pub fn parse_raw_yaml(raw: &str) -> Result<IndexMap<String, serde_yaml::Value>, String> {
    if raw.trim().is_empty() {
        return Ok(IndexMap::new());
    }
    serde_yaml::from_str(raw).map_err(|e| e.to_string())
}

pub fn serialize_frontmatter(
    frontmatter: &IndexMap<String, serde_yaml::Value>,
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
        let parsed = parse_frontmatter(raw);
        assert_eq!(
            parsed.map.get("title"),
            Some(&serde_yaml::Value::String("Hello".to_string()))
        );
        let tags = parsed.map.get("tags").unwrap();
        assert!(tags.is_sequence());
        assert_eq!(parsed.body, "# Body\nContent here.\n");
        assert_eq!(parsed.raw_yaml, "title: Hello\ntags:\n  - rust\n  - tauri\n");
    }

    #[test]
    fn parse_without_frontmatter() {
        let raw = "# Just markdown\nNo frontmatter here.\n";
        let parsed = parse_frontmatter(raw);
        assert!(parsed.map.is_empty());
        assert!(parsed.raw_yaml.is_empty());
        assert_eq!(parsed.body, raw);
    }

    #[test]
    fn parse_empty_frontmatter() {
        let raw = "---\n---\nBody content.\n";
        let parsed = parse_frontmatter(raw);
        assert!(parsed.map.is_empty());
        assert!(parsed.raw_yaml.is_empty());
        assert_eq!(parsed.body, "Body content.\n");
    }

    #[test]
    fn round_trip() {
        let mut fm = IndexMap::new();
        fm.insert(
            "title".to_string(),
            serde_yaml::Value::String("Test Page".to_string()),
        );
        let body = "# Hello\nWorld\n";
        let serialized = serialize_frontmatter(&fm, body);
        let parsed = parse_frontmatter(&serialized);
        assert_eq!(parsed.map.get("title"), fm.get("title"));
        assert_eq!(parsed.body, body);
    }

    #[test]
    fn various_yaml_types() {
        let raw = "---\nstring_val: hello\nnum_val: 42\nlist_val:\n  - a\n  - b\nnested:\n  key: value\n---\nBody\n";
        let parsed = parse_frontmatter(raw);
        assert_eq!(
            parsed.map.get("string_val"),
            Some(&serde_yaml::Value::String("hello".to_string()))
        );
        assert!(parsed.map.get("num_val").unwrap().is_number());
        assert!(parsed.map.get("list_val").unwrap().is_sequence());
        assert!(parsed.map.get("nested").unwrap().is_mapping());
        assert_eq!(parsed.body, "Body\n");
    }

    #[test]
    fn preserve_body_exactly() {
        let body_content = "Line 1\n\nLine 3\n  indented\n";
        let raw = format!("---\ntitle: X\n---\n{body_content}");
        let parsed = parse_frontmatter(&raw);
        assert_eq!(parsed.body, body_content);
    }

    #[test]
    fn parse_raw_yaml_valid() {
        let result = parse_raw_yaml("title: Hello\ntags:\n  - rust\n").unwrap();
        assert_eq!(
            result.get("title"),
            Some(&serde_yaml::Value::String("Hello".to_string()))
        );
        assert!(result.get("tags").unwrap().is_sequence());
    }

    #[test]
    fn parse_raw_yaml_invalid() {
        let result = parse_raw_yaml("title: :\n  bad yaml [[[");
        assert!(result.is_err());
    }

    #[test]
    fn parse_raw_yaml_empty() {
        let result = parse_raw_yaml("").unwrap();
        assert!(result.is_empty());
        let result2 = parse_raw_yaml("   \n  ").unwrap();
        assert!(result2.is_empty());
    }

    #[test]
    fn parse_raw_yaml_non_mapping() {
        let result = parse_raw_yaml("- one\n- two\n");
        assert!(result.is_err());
        let result2 = parse_raw_yaml("just a scalar");
        assert!(result2.is_err());
    }

    #[test]
    fn serialize_empty_frontmatter_omits_fences() {
        let fm = IndexMap::new();
        let body = "Just content\n";
        let result = serialize_frontmatter(&fm, body);
        assert_eq!(result, body);
        assert!(!result.contains("---"));
    }

    #[test]
    fn frontmatter_with_cjk_and_devanagari() {
        let input = "---\ntitle: 日本語のタイトル\ntags:\n  - 漢字\n  - かな\n  - देवनागरी\n---\nBody text.\n";
        let parsed = parse_frontmatter(input);
        assert_eq!(
            parsed.map.get("title"),
            Some(&serde_yaml::Value::String("日本語のタイトル".to_string()))
        );
        let tags = parsed.map.get("tags").unwrap().as_sequence().unwrap();
        assert_eq!(tags.len(), 3);
        assert_eq!(parsed.body, "Body text.\n");
    }

    #[test]
    fn round_trip_cjk_frontmatter() {
        let mut fm = IndexMap::new();
        fm.insert(
            "title".to_string(),
            serde_yaml::Value::String("日本語のタイトル".to_string()),
        );
        let body = "本文テキスト\n";
        let serialized = serialize_frontmatter(&fm, body);
        let parsed = parse_frontmatter(&serialized);
        assert_eq!(parsed.map.get("title"), fm.get("title"));
        assert_eq!(parsed.body, body);
    }

    #[test]
    fn serialize_preserves_field_order() {
        let mut fm = IndexMap::new();
        fm.insert("author".into(), serde_yaml::Value::String("Alice".into()));
        fm.insert("description".into(), serde_yaml::Value::String("A note".into()));
        fm.insert("published".into(), serde_yaml::Value::Bool(true));
        fm.insert("title".into(), serde_yaml::Value::String("My Page".into()));

        let output = serialize_frontmatter(&fm, "body\n");
        let lines: Vec<&str> = output.lines().collect();
        assert_eq!(lines[0], "---");
        assert!(lines[1].starts_with("author:"));
        assert!(lines[2].starts_with("description:"));
        assert!(lines[3].starts_with("published:"));
        assert!(lines[4].starts_with("title:"));
    }

    #[test]
    fn round_trip_preserves_field_order() {
        let input = "---\nauthor: Alice\ndescription: A note\npublished: true\ntitle: My Page\n---\nbody\n";
        let parsed = parse_frontmatter(input);
        let output = serialize_frontmatter(&parsed.map, parsed.body);
        assert_eq!(output, input);
    }

    #[test]
    fn parse_raw_yaml_preserves_order() {
        let yaml = "zebra: 1\nalpha: 2\nmiddle: 3\n";
        let map = parse_raw_yaml(yaml).unwrap();
        let keys: Vec<&String> = map.keys().collect();
        assert_eq!(keys, vec!["zebra", "alpha", "middle"]);
    }
}
