use indexmap::IndexMap;
use serde::{Deserialize, Serialize};
use serde_yaml::Value;

use super::frontmatter_merge::merge_frontmatter;
use super::split::demote_headings;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MergeInput {
    pub title: String,
    pub body: String,
    pub frontmatter: IndexMap<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MergePlan {
    pub title: String,
    pub body: String,
    pub frontmatter: IndexMap<String, Value>,
    pub source_titles: Vec<String>,
}

pub fn plan_merge(docs: &[MergeInput]) -> MergePlan {
    if docs.is_empty() {
        return MergePlan {
            title: String::new(),
            body: String::new(),
            frontmatter: IndexMap::new(),
            source_titles: Vec::new(),
        };
    }

    let title = docs
        .iter()
        .map(|d| d.title.as_str())
        .collect::<Vec<_>>()
        .join(" + ");

    let mut body = String::new();
    for (i, doc) in docs.iter().enumerate() {
        if i > 0 {
            body.push('\n');
        }
        body.push_str(&format!("## {}\n\n", doc.title));
        if !doc.body.is_empty() {
            body.push_str(&demote_headings(&doc.body, 1));
            body.push('\n');
        }
    }

    let fm_sources: Vec<IndexMap<String, Value>> =
        docs.iter().map(|d| d.frontmatter.clone()).collect();
    let frontmatter = merge_frontmatter(&fm_sources);

    let source_titles = docs.iter().map(|d| d.title.clone()).collect();

    MergePlan {
        title,
        body,
        frontmatter,
        source_titles,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input(title: &str, body: &str) -> MergeInput {
        MergeInput {
            title: title.to_string(),
            body: body.to_string(),
            frontmatter: IndexMap::new(),
        }
    }

    fn input_with_fm(
        title: &str,
        body: &str,
        fm: IndexMap<String, Value>,
    ) -> MergeInput {
        MergeInput {
            title: title.to_string(),
            body: body.to_string(),
            frontmatter: fm,
        }
    }

    // ── Section A: plan_merge basics ──

    #[test]
    fn merge_two_docs_basic() {
        let result = plan_merge(&[
            input("A", "Hello from A"),
            input("B", "Hello from B"),
        ]);
        assert_eq!(result.title, "A + B");
        assert_eq!(result.source_titles, vec!["A", "B"]);
        assert!(result.body.contains("## A\n\n"));
        assert!(result.body.contains("## B\n\n"));
        assert!(result.body.contains("Hello from A"));
        assert!(result.body.contains("Hello from B"));
    }

    #[test]
    fn merge_three_docs() {
        let result = plan_merge(&[
            input("X", "x body"),
            input("Y", "y body"),
            input("Z", "z body"),
        ]);
        assert_eq!(result.title, "X + Y + Z");
        assert_eq!(result.source_titles, vec!["X", "Y", "Z"]);

        let x_pos = result.body.find("## X").unwrap();
        let y_pos = result.body.find("## Y").unwrap();
        let z_pos = result.body.find("## Z").unwrap();
        assert!(x_pos < y_pos);
        assert!(y_pos < z_pos);
    }

    #[test]
    fn merge_single_doc() {
        let result = plan_merge(&[input("Solo", "some content")]);
        assert_eq!(result.title, "Solo");
        assert!(!result.title.contains(" + "));
        assert!(result.body.contains("## Solo\n\n"));
        assert!(result.body.contains("some content"));
    }

    #[test]
    fn merge_empty_body() {
        let result = plan_merge(&[
            input("A", "content A"),
            input("Empty", ""),
            input("C", "content C"),
        ]);
        assert!(result.body.contains("## Empty\n\n"));
        assert!(result.body.contains("## A\n\n"));
        assert!(result.body.contains("## C\n\n"));
    }

    #[test]
    fn merge_heading_demotion() {
        let result = plan_merge(&[input("Doc", "## Sub\n\nParagraph")]);
        assert!(result.body.contains("### Sub"), "body was: {}", result.body);
        assert!(result.body.contains("Paragraph"));
    }

    #[test]
    fn merge_code_fences_preserved() {
        let body = "```markdown\n## Not a heading\n```\n\n## Real heading";
        let result = plan_merge(&[input("Doc", body)]);
        assert!(
            result.body.contains("## Not a heading"),
            "fenced heading should NOT be demoted: {}",
            result.body
        );
        assert!(
            result.body.contains("### Real heading"),
            "real heading should be demoted: {}",
            result.body
        );
    }

    #[test]
    fn merge_empty_input_slice() {
        let result = plan_merge(&[]);
        assert_eq!(result.title, "");
        assert_eq!(result.body, "");
        assert!(result.frontmatter.is_empty());
        assert!(result.source_titles.is_empty());
    }

    // ── Section B: Edge cases ──

    #[test]
    fn merge_deeply_nested_heading_clamped() {
        let body = "##### H5\n\n###### H6";
        let result = plan_merge(&[input("Doc", body)]);
        assert!(
            result.body.contains("###### H5"),
            "H5 should become H6: {}",
            result.body
        );
        assert!(
            result.body.contains("###### H6"),
            "H6 should stay H6 (clamped): {}",
            result.body
        );
    }

    #[test]
    fn merge_crlf_body() {
        let body = "Line one\r\nLine two\r\n## Heading\r\nMore text";
        let result = plan_merge(&[input("Doc", body)]);
        assert!(result.body.contains("Line one"));
        assert!(result.body.contains("Line two"));
        assert!(result.body.contains("More text"));
    }

    #[test]
    fn merge_frontmatter_delegation() {
        let mut fm1 = IndexMap::new();
        fm1.insert("tags".to_string(), Value::Sequence(vec![
            Value::String("rust".to_string()),
        ]));
        fm1.insert("author".to_string(), Value::String("Alice".to_string()));

        let mut fm2 = IndexMap::new();
        fm2.insert("tags".to_string(), Value::Sequence(vec![
            Value::String("merge".to_string()),
        ]));
        fm2.insert("draft".to_string(), Value::Bool(true));

        let result = plan_merge(&[
            input_with_fm("A", "body a", fm1),
            input_with_fm("B", "body b", fm2),
        ]);

        let tags = result.frontmatter.get("tags").expect("tags key missing");
        if let Value::Sequence(seq) = tags {
            let tag_strs: Vec<&str> = seq
                .iter()
                .filter_map(|v| v.as_str())
                .collect();
            assert!(tag_strs.contains(&"rust"));
            assert!(tag_strs.contains(&"merge"));
        } else {
            panic!("tags should be a sequence");
        }

        assert!(result.frontmatter.contains_key("author"));
        assert!(result.frontmatter.contains_key("draft"));
    }
}
