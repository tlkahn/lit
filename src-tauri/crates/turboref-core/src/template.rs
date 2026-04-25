use regex::Regex;
use std::sync::LazyLock;

use rand::Rng;
use serde::{Deserialize, Serialize};

static TAG_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"\{tag:(\d+)\}").unwrap()
});

/// Context for template expansion.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct TemplateContext {
    pub filename: Option<String>,
    pub index: Option<u32>,
    pub ext: Option<String>,
}

/// Expand a template string with variables.
///
/// Supported variables:
/// - `{tag:n}` — random alphanumeric string of length n
/// - `{filename}` — current file name without extension
/// - `{index}` — auto-incrementing number
/// - `{ext}` — file extension
pub fn expand(template: &str, ctx: &TemplateContext) -> String {
    let mut result = template.to_string();

    // {tag:n} → random alphanumeric of length n
    if let Some(caps) = TAG_RE.captures(&result) {
        let n: usize = caps[1].parse().unwrap_or(3);
        let tag = generate_random_tag(n);
        result = TAG_RE.replace(&result, tag.as_str()).to_string();
    }

    // {filename}
    if let Some(ref filename) = ctx.filename {
        result = result.replace("{filename}", filename);
    }

    // {index}
    if let Some(index) = ctx.index {
        result = result.replace("{index}", &index.to_string());
    }

    // {ext}
    if let Some(ref ext) = ctx.ext {
        result = result.replace("{ext}", ext);
    }

    result
}

fn generate_random_tag(length: usize) -> String {
    let mut rng = rand::thread_rng();
    (0..length)
        .map(|_| {
            let idx = rng.gen_range(0..36);
            if idx < 10 {
                (b'0' + idx) as char
            } else {
                (b'a' + idx - 10) as char
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn expand_tag() {
        let result = expand("fig{tag:3}", &TemplateContext::default());
        assert_eq!(result.len(), 6); // "fig" + 3 random chars
        assert!(result.starts_with("fig"));
    }

    #[test]
    fn expand_tag_length() {
        let result = expand("{tag:5}", &TemplateContext::default());
        assert_eq!(result.len(), 5);
    }

    #[test]
    fn expand_filename() {
        let ctx = TemplateContext {
            filename: Some("myfile".to_string()),
            ..Default::default()
        };
        let result = expand("{filename}-img", &ctx);
        assert_eq!(result, "myfile-img");
    }

    #[test]
    fn expand_index() {
        let ctx = TemplateContext {
            index: Some(42),
            ..Default::default()
        };
        let result = expand("fig-{index}", &ctx);
        assert_eq!(result, "fig-42");
    }

    #[test]
    fn expand_ext() {
        let ctx = TemplateContext {
            ext: Some("png".to_string()),
            ..Default::default()
        };
        let result = expand("image.{ext}", &ctx);
        assert_eq!(result, "image.png");
    }

    #[test]
    fn expand_combined() {
        let ctx = TemplateContext {
            filename: Some("doc".to_string()),
            index: Some(1),
            ext: Some("jpg".to_string()),
        };
        let result = expand("{filename}-{index}.{ext}", &ctx);
        assert_eq!(result, "doc-1.jpg");
    }

    #[test]
    fn expand_no_variables() {
        let result = expand("plain-text", &TemplateContext::default());
        assert_eq!(result, "plain-text");
    }

    #[test]
    fn random_tag_is_alphanumeric() {
        let tag = generate_random_tag(100);
        assert!(tag.chars().all(|c| c.is_ascii_alphanumeric()));
    }
}
