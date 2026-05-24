use indexmap::IndexMap;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SplitChunk {
    pub title: String,
    pub body: String,
    pub frontmatter: IndexMap<String, serde_yaml::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SplitPlan {
    pub preamble: Option<SplitChunk>,
    pub sections: Vec<SplitChunk>,
}

struct FenceTracker {
    in_fence: bool,
    fence_char: u8,
    fence_len: usize,
}

impl FenceTracker {
    fn new() -> Self {
        Self {
            in_fence: false,
            fence_char: 0,
            fence_len: 0,
        }
    }

    fn update(&mut self, trimmed: &str) {
        let first = trimmed.as_bytes().first().copied();
        if matches!(first, Some(b'`') | Some(b'~')) {
            let ch = first.unwrap();
            let run = trimmed.bytes().take_while(|&b| b == ch).count();
            if run >= 3 {
                if !self.in_fence {
                    self.in_fence = true;
                    self.fence_char = ch;
                    self.fence_len = run;
                } else if ch == self.fence_char
                    && run >= self.fence_len
                    && trimmed.bytes().all(|b| b == ch || b == b' ')
                {
                    self.in_fence = false;
                }
            }
        }
    }

    fn inside(&self) -> bool {
        self.in_fence
    }
}

fn strip_atx_closing(text: &str) -> &str {
    if !text.ends_with('#') {
        return text;
    }
    let without = text.trim_end_matches('#');
    if without.is_empty() {
        return "";
    }
    if without.ends_with(' ') {
        without.trim_end()
    } else {
        text
    }
}

fn parse_heading(line: &str) -> Option<(usize, &str)> {
    let indent = line.bytes().take_while(|&b| b == b' ').count();
    if indent >= 4 {
        return None;
    }
    let trimmed = &line[indent..];
    let bytes = trimmed.as_bytes();
    if bytes.first() != Some(&b'#') {
        return None;
    }
    let hash_count = bytes.iter().take_while(|&&b| b == b'#').count();
    if hash_count > 6 || hash_count >= trimmed.len() || bytes[hash_count] != b' ' {
        return None;
    }
    let text = strip_atx_closing(trimmed[hash_count + 1..].trim());
    if text.is_empty() {
        return None;
    }
    Some((hash_count, text))
}

pub fn demote_headings(body: &str, levels: u8) -> String {
    if levels == 0 || body.is_empty() {
        return body.to_string();
    }

    let mut result = String::with_capacity(body.len() + 64);
    let mut fence = FenceTracker::new();

    for (i, line) in body.lines().enumerate() {
        if i > 0 {
            result.push('\n');
        }

        let trimmed = line.trim_start();
        fence.update(trimmed);

        if fence.inside() {
            result.push_str(line);
            continue;
        }

        match parse_heading(line) {
            Some((hash_count, _)) => {
                let new_level = (hash_count + levels as usize).min(6);
                let leading_ws = &line[..line.len() - trimmed.len()];
                let after_hashes = &trimmed[hash_count..];
                result.push_str(leading_ws);
                for _ in 0..new_level {
                    result.push('#');
                }
                result.push_str(after_hashes);
            }
            None => result.push_str(line),
        }
    }

    if body.ends_with('\n') {
        result.push('\n');
    }

    result
}

pub fn plan_split(
    content: &str,
    original_title: &str,
    frontmatter: &IndexMap<String, serde_yaml::Value>,
) -> SplitPlan {
    if content.is_empty() {
        return SplitPlan {
            preamble: None,
            sections: Vec::new(),
        };
    }

    let split_level = detect_split_level(content);

    if split_level == 0 {
        return SplitPlan {
            preamble: Some(SplitChunk {
                title: format!("{original_title} - Introduction"),
                body: content.to_string(),
                frontmatter: frontmatter.clone(),
            }),
            sections: Vec::new(),
        };
    }

    let raw_sections = split_at_heading_level(content, split_level);

    let mut preamble = None;
    let mut sections = Vec::new();

    for (i, (title, body)) in raw_sections.into_iter().enumerate() {
        if i == 0 && title.is_none() {
            preamble = Some(SplitChunk {
                title: format!("{original_title} - Introduction"),
                body,
                frontmatter: frontmatter.clone(),
            });
            continue;
        }

        sections.push(SplitChunk {
            title: title.unwrap_or_default(),
            body: demote_headings(&body, 1),
            frontmatter: frontmatter.clone(),
        });
    }

    SplitPlan { preamble, sections }
}

fn detect_split_level(content: &str) -> u8 {
    let mut fence = FenceTracker::new();
    let mut min_level: u8 = 0;

    for line in content.lines() {
        let trimmed = line.trim_start();
        fence.update(trimmed);
        if fence.inside() {
            continue;
        }

        if let Some((hash_count, _)) = parse_heading(line) {
            let level = hash_count as u8;
            if min_level == 0 || level < min_level {
                min_level = level;
            }
        }
    }

    min_level
}

fn split_at_heading_level(content: &str, level: u8) -> Vec<(Option<String>, String)> {
    let mut sections: Vec<(Option<String>, String)> = Vec::new();
    let mut current_title: Option<String> = None;
    let mut current_body = String::new();
    let mut fence = FenceTracker::new();

    for line in content.lines() {
        let trimmed = line.trim_start();
        fence.update(trimmed);

        if !fence.inside() {
            if let Some((hash_count, text)) = parse_heading(line) {
                if hash_count == level as usize {
                    if current_title.is_some() || !current_body.is_empty() {
                        sections.push((current_title, current_body));
                    }
                    current_title = Some(text.to_string());
                    current_body = String::new();
                    continue;
                }
            }
        }

        current_body.push_str(line);
        current_body.push('\n');
    }

    if current_title.is_some() || !current_body.is_empty() {
        sections.push((current_title, current_body));
    }

    sections
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── demote_headings ──────────────────────────────────────────

    #[test]
    fn demote_h2_to_h3() {
        let body = "## Section\nSome text.\n";
        let result = demote_headings(body, 1);
        assert_eq!(result, "### Section\nSome text.\n");
    }

    #[test]
    fn demote_multiple_levels() {
        let body = "## A\n### B\n#### C\n";
        let result = demote_headings(body, 1);
        assert_eq!(result, "### A\n#### B\n##### C\n");
    }

    #[test]
    fn demote_by_two_levels() {
        let body = "## A\n### B\n";
        let result = demote_headings(body, 2);
        assert_eq!(result, "#### A\n##### B\n");
    }

    #[test]
    fn demote_clamps_at_h6() {
        let body = "##### H5\n###### H6\n";
        let result = demote_headings(body, 2);
        assert_eq!(result, "###### H5\n###### H6\n");
    }

    #[test]
    fn demote_preserves_non_heading_lines() {
        let body = "Normal text.\n## Heading\nMore text.\n";
        let result = demote_headings(body, 1);
        assert_eq!(result, "Normal text.\n### Heading\nMore text.\n");
    }

    #[test]
    fn demote_zero_levels_is_identity() {
        let body = "## A\n### B\n";
        let result = demote_headings(body, 0);
        assert_eq!(result, body);
    }

    #[test]
    fn demote_empty_body() {
        assert_eq!(demote_headings("", 1), "");
    }

    #[test]
    fn demote_no_headings() {
        let body = "Just plain text.\nAnother line.\n";
        let result = demote_headings(body, 1);
        assert_eq!(result, body);
    }

    #[test]
    fn demote_skips_code_fences() {
        let body = "## Real\n```\n## Not a heading\n```\n## Also real\n";
        let result = demote_headings(body, 1);
        assert_eq!(result, "### Real\n```\n## Not a heading\n```\n### Also real\n");
    }

    #[test]
    fn demote_skips_tilde_fences() {
        let body = "## Before\n~~~\n## Inside\n~~~\n## After\n";
        let result = demote_headings(body, 1);
        assert_eq!(result, "### Before\n~~~\n## Inside\n~~~\n### After\n");
    }

    #[test]
    fn demote_preserves_heading_trailing_whitespace() {
        let body = "##  Spaced heading  \nText.\n";
        let result = demote_headings(body, 1);
        assert_eq!(result, "###  Spaced heading  \nText.\n");
    }

    #[test]
    fn demote_h1_to_h2() {
        let body = "# Top\n## Sub\n";
        let result = demote_headings(body, 1);
        assert_eq!(result, "## Top\n### Sub\n");
    }

    // ── plan_split ───────────────────────────────────────────────

    fn make_fm(pairs: &[(&str, &str)]) -> IndexMap<String, serde_yaml::Value> {
        pairs
            .iter()
            .map(|(k, v)| (k.to_string(), serde_yaml::Value::String(v.to_string())))
            .collect()
    }

    #[test]
    fn split_basic_two_h2_sections() {
        let content = "## Alpha\nAlpha body.\n## Beta\nBeta body.\n";
        let fm = IndexMap::new();
        let plan = plan_split(content, "My Doc", &fm);

        assert!(plan.preamble.is_none());
        assert_eq!(plan.sections.len(), 2);
        assert_eq!(plan.sections[0].title, "Alpha");
        assert_eq!(plan.sections[0].body, "Alpha body.\n");
        assert_eq!(plan.sections[1].title, "Beta");
        assert_eq!(plan.sections[1].body, "Beta body.\n");
    }

    #[test]
    fn split_with_preamble() {
        let content = "Some preamble text.\n\n## Section One\nBody one.\n";
        let fm = IndexMap::new();
        let plan = plan_split(content, "Original", &fm);

        assert!(plan.preamble.is_some());
        let pre = plan.preamble.unwrap();
        assert_eq!(pre.title, "Original - Introduction");
        assert_eq!(pre.body, "Some preamble text.\n\n");
        assert_eq!(plan.sections.len(), 1);
        assert_eq!(plan.sections[0].title, "Section One");
    }

    #[test]
    fn split_fallback_to_h3_when_no_h2() {
        let content = "### A\nBody A.\n### B\nBody B.\n";
        let fm = IndexMap::new();
        let plan = plan_split(content, "Doc", &fm);

        assert!(plan.preamble.is_none());
        assert_eq!(plan.sections.len(), 2);
        assert_eq!(plan.sections[0].title, "A");
        assert_eq!(plan.sections[1].title, "B");
    }

    #[test]
    fn split_fallback_to_h4() {
        let content = "#### Deep A\nA content.\n#### Deep B\nB content.\n";
        let fm = IndexMap::new();
        let plan = plan_split(content, "Doc", &fm);

        assert_eq!(plan.sections.len(), 2);
        assert_eq!(plan.sections[0].title, "Deep A");
    }

    #[test]
    fn split_demotes_sub_headings() {
        let content = "## Section\n### Sub\n#### SubSub\nText.\n";
        let fm = IndexMap::new();
        let plan = plan_split(content, "Doc", &fm);

        assert_eq!(plan.sections.len(), 1);
        assert_eq!(plan.sections[0].title, "Section");
        assert!(plan.sections[0].body.contains("## Sub"));
        assert!(plan.sections[0].body.contains("### SubSub"));
    }

    #[test]
    fn split_frontmatter_inherited_by_all_chunks() {
        let content = "## A\nBody.\n## B\nBody.\n";
        let fm = make_fm(&[("status", "draft"), ("author", "Alice")]);
        let plan = plan_split(content, "Doc", &fm);

        for section in &plan.sections {
            assert_eq!(section.frontmatter.get("status"), fm.get("status"));
            assert_eq!(section.frontmatter.get("author"), fm.get("author"));
        }
    }

    #[test]
    fn split_preamble_inherits_frontmatter() {
        let content = "Preamble.\n## A\nBody.\n";
        let fm = make_fm(&[("tag", "important")]);
        let plan = plan_split(content, "Doc", &fm);

        let pre = plan.preamble.unwrap();
        assert_eq!(pre.frontmatter.get("tag"), fm.get("tag"));
    }

    #[test]
    fn split_single_heading_produces_one_section() {
        let content = "## Only Section\nContent here.\n";
        let fm = IndexMap::new();
        let plan = plan_split(content, "Doc", &fm);

        assert!(plan.preamble.is_none());
        assert_eq!(plan.sections.len(), 1);
        assert_eq!(plan.sections[0].title, "Only Section");
        assert_eq!(plan.sections[0].body, "Content here.\n");
    }

    #[test]
    fn split_no_headings_returns_empty_sections() {
        let content = "Just plain text.\nNo headings at all.\n";
        let fm = IndexMap::new();
        let plan = plan_split(content, "Doc", &fm);

        assert_eq!(plan.sections.len(), 0);
        assert!(plan.preamble.is_some());
        assert_eq!(plan.preamble.unwrap().body, content);
    }

    #[test]
    fn split_empty_content() {
        let fm = IndexMap::new();
        let plan = plan_split("", "Doc", &fm);

        assert!(plan.preamble.is_none());
        assert!(plan.sections.is_empty());
    }

    #[test]
    fn split_empty_section_body() {
        let content = "## A\n## B\nB content.\n";
        let fm = IndexMap::new();
        let plan = plan_split(content, "Doc", &fm);

        assert_eq!(plan.sections.len(), 2);
        assert_eq!(plan.sections[0].title, "A");
        assert_eq!(plan.sections[0].body, "");
        assert_eq!(plan.sections[1].title, "B");
        assert_eq!(plan.sections[1].body, "B content.\n");
    }

    #[test]
    fn split_heading_inside_code_fence_ignored() {
        let content = "## Real\n```\n## Fake\n```\n## Also Real\n";
        let fm = IndexMap::new();
        let plan = plan_split(content, "Doc", &fm);

        assert_eq!(plan.sections.len(), 2);
        assert_eq!(plan.sections[0].title, "Real");
        assert!(plan.sections[0].body.contains("## Fake"));
        assert_eq!(plan.sections[1].title, "Also Real");
    }

    #[test]
    fn split_deeply_nested_sub_headings_demoted() {
        let content = "## Top\n### Mid\n#### Deep\n##### Deeper\nText.\n";
        let fm = IndexMap::new();
        let plan = plan_split(content, "Doc", &fm);

        assert_eq!(plan.sections.len(), 1);
        let body = &plan.sections[0].body;
        assert!(body.contains("## Mid"));
        assert!(body.contains("### Deep"));
        assert!(body.contains("#### Deeper"));
    }

    #[test]
    fn split_multiline_preamble_with_blank_lines() {
        let content = "Line one.\n\nLine two.\n\n## Section\nBody.\n";
        let fm = IndexMap::new();
        let plan = plan_split(content, "Title", &fm);

        let pre = plan.preamble.unwrap();
        assert_eq!(pre.title, "Title - Introduction");
        assert_eq!(pre.body, "Line one.\n\nLine two.\n\n");
    }

    #[test]
    fn split_heading_text_trimmed() {
        let content = "##   Spaced Title   \nBody.\n";
        let fm = IndexMap::new();
        let plan = plan_split(content, "Doc", &fm);

        assert_eq!(plan.sections[0].title, "Spaced Title");
    }

    // ── Cycle 1: FenceTracker fence-length tracking ─────────────

    #[test]
    fn fence_tracker_ignores_short_closing_fence() {
        let mut ft = FenceTracker::new();
        ft.update("`````");
        assert!(ft.inside());
        ft.update("```");
        assert!(ft.inside());
    }

    #[test]
    fn fence_tracker_closes_with_longer_fence() {
        let mut ft = FenceTracker::new();
        ft.update("```");
        assert!(ft.inside());
        ft.update("``````");
        assert!(!ft.inside());
    }

    #[test]
    fn demote_skips_nested_backticks_in_long_fence() {
        let body = "`````\n```\n## heading\n```\n`````\n## real\n";
        let result = demote_headings(body, 1);
        assert!(result.contains("## heading"));
        assert!(result.contains("### real"));
    }

    // ── Cycle 2: ATX closing sequences ──────────────────────────

    #[test]
    fn parse_heading_strips_atx_closing() {
        assert_eq!(parse_heading("## Title ##"), Some((2, "Title")));
    }

    #[test]
    fn parse_heading_strips_atx_closing_different_count() {
        assert_eq!(parse_heading("## Title ####"), Some((2, "Title")));
    }

    #[test]
    fn parse_heading_closing_must_be_preceded_by_space() {
        assert_eq!(parse_heading("## Title##"), Some((2, "Title##")));
    }

    #[test]
    fn parse_heading_only_hashes_after_opening() {
        assert_eq!(parse_heading("## ##"), None);
    }

    // ── Cycle 3: Indentation depth check ────────────────────────

    #[test]
    fn parse_heading_rejects_4_space_indent() {
        assert_eq!(parse_heading("    ## Heading"), None);
    }

    #[test]
    fn parse_heading_accepts_3_space_indent() {
        assert_eq!(parse_heading("   ## Heading"), Some((2, "Heading")));
    }

    #[test]
    fn detect_split_level_ignores_indented_code_heading() {
        let content = "    ## Indented\n## Real\n";
        assert_eq!(detect_split_level(content), 2);
    }

    #[test]
    fn split_ignores_4_space_indented_heading() {
        let content = "## Section\n    ## Indented\nBody.\n";
        let fm = IndexMap::new();
        let plan = plan_split(content, "Doc", &fm);

        assert_eq!(plan.sections.len(), 1);
        assert!(plan.sections[0].body.contains("    ## Indented"));
    }

    // ── Cycle 4: Sentinel-then-remove elimination ───────────────

    #[test]
    fn split_content_starting_with_heading_no_empty_preamble() {
        let content = "## First\nBody.\n## Second\nBody.\n";
        let fm = IndexMap::new();
        let plan = plan_split(content, "Doc", &fm);

        assert!(plan.preamble.is_none());
        assert_eq!(plan.sections.len(), 2);
    }

    #[test]
    fn split_whitespace_only_before_heading_becomes_preamble() {
        let content = "  \n\n## Section\nBody.\n";
        let fm = IndexMap::new();
        let plan = plan_split(content, "Doc", &fm);

        assert!(plan.preamble.is_some());
        assert_eq!(plan.sections.len(), 1);
    }

    // ── Cycle 5: Edge case test coverage ────────────────────────

    #[test]
    fn split_nested_fence_backticks_not_closed_by_shorter() {
        let content = "## Real\n`````\n```\n## Fake\n```\n`````\n## Also Real\n";
        let fm = IndexMap::new();
        let plan = plan_split(content, "Doc", &fm);

        assert_eq!(plan.sections.len(), 2);
        assert_eq!(plan.sections[0].title, "Real");
        assert!(plan.sections[0].body.contains("## Fake"));
        assert_eq!(plan.sections[1].title, "Also Real");
    }

    #[test]
    fn split_nested_tilde_fence_not_closed_by_shorter() {
        let content = "## Real\n~~~~~\n~~~\n## Fake\n~~~\n~~~~~\n## Also Real\n";
        let fm = IndexMap::new();
        let plan = plan_split(content, "Doc", &fm);

        assert_eq!(plan.sections.len(), 2);
        assert_eq!(plan.sections[0].title, "Real");
        assert!(plan.sections[0].body.contains("## Fake"));
        assert_eq!(plan.sections[1].title, "Also Real");
    }

    #[test]
    fn split_content_without_trailing_newline() {
        let content = "## A\nBody A.\n## B\nBody B";
        let fm = IndexMap::new();
        let plan = plan_split(content, "Doc", &fm);

        assert_eq!(plan.sections.len(), 2);
        assert_eq!(plan.sections[0].title, "A");
        assert_eq!(plan.sections[1].title, "B");
        assert_eq!(plan.sections[1].body, "Body B\n");
    }

    #[test]
    fn demote_content_without_trailing_newline() {
        let body = "## A\nText";
        let result = demote_headings(body, 1);
        assert_eq!(result, "### A\nText");
    }

    #[test]
    fn split_crlf_line_endings() {
        let content = "## A\r\nBody A.\r\n## B\r\nBody B.\r\n";
        let fm = IndexMap::new();
        let plan = plan_split(content, "Doc", &fm);

        assert_eq!(plan.sections.len(), 2);
        assert_eq!(plan.sections[0].title, "A");
        assert_eq!(plan.sections[1].title, "B");
    }

    #[test]
    fn demote_crlf_line_endings() {
        let body = "## A\r\nText\r\n";
        let result = demote_headings(body, 1);
        assert!(result.contains("### A"));
    }
}
