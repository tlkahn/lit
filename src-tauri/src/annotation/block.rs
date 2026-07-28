use std::sync::LazyLock;
use regex::Regex;
use super::marks;
use super::types::*;

static DATE_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^@(\d{4}-\d{2}(?:-\d{2})?)$").unwrap()
});

static ANCHOR_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"^\^"((?:[^"\\]|\\.)+)"$"#).unwrap()
});

static LANG_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^(?i)lang\s*[:=]\s*(\S+)$").unwrap()
});

pub fn parse_block(inner: &str, mark_codes: &[String]) -> Annotation {
    let (head, body) = split_head_body(inner);

    let mut annotation_type = AnnotationType::Bare;
    let mut certainty = Certainty::Neutral;
    let mut scope = Scope::Sentence(1);
    let mut date = None;
    let mut mark: Option<String> = None;
    let mut lang: Option<String> = None;

    for line in head.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }

        if let Some(caps) = DATE_RE.captures(line) {
            date = Some(caps.get(1).unwrap().as_str().to_string());
            continue;
        }

        if let Some(caps) = ANCHOR_RE.captures(line) {
            scope = Scope::Anchor(caps.get(1).unwrap().as_str().replace("\\\"", "\""));
            continue;
        }

        // A `lang:` line only carries meaning in the header; after the `---`
        // separator it is body text, which `split_head_body` already excludes.
        if let Some(caps) = LANG_RE.captures(line) {
            lang = super::lang::normalize_lang(caps.get(1).unwrap().as_str());
            continue;
        }

        if Scope::try_parse(line).is_some() {
            scope = Scope::from_str(line);
            continue;
        }

        if annotation_type == AnnotationType::Bare {
            let (type_part, cert_char) = if line.ends_with('?') || line.ends_with('!') {
                let c = line.chars().last().unwrap();
                (&line[..line.len() - 1], Some(c))
            } else {
                (line, None)
            };

            if let Some(t) = AnnotationType::from_str(type_part) {
                annotation_type = t;
                if let Some(c) = cert_char {
                    certainty = Certainty::from_char(c);
                }
            } else if marks::is_known_mark_code(type_part, mark_codes) {
                annotation_type = AnnotationType::Mark;
                mark = Some(type_part.to_string());
                if let Some(c) = cert_char {
                    certainty = Certainty::from_char(c);
                }
            }
        }
    }

    let body = body
        .map(|b| b.trim())
        .filter(|b| !b.is_empty())
        .map(|b| b.to_string());

    Annotation {
        form: AnnotationForm::Block,
        annotation_type,
        certainty,
        scope,
        body,
        date,
        is_structured: true,
        char_start: 0,
        char_end: 0,
        original: String::new(),
        uuid: None,
        mark,
        lang,
    }
}

fn split_head_body(inner: &str) -> (&str, Option<&str>) {
    let mut byte_offset: usize = 0;
    for line in inner.split('\n') {
        if line.trim() == "---" {
            let head = &inner[..byte_offset.saturating_sub(1)];
            let body_start = byte_offset + line.len() + 1;
            let body = if body_start <= inner.len() {
                Some(&inner[body_start..])
            } else {
                None
            };
            return (head, body);
        }
        byte_offset += line.len() + 1;
    }
    (inner, None)
}

pub fn is_block_form(inner: &str) -> bool {
    inner.lines().any(|line| line.trim() == "---")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::annotation::marks;

    #[test]
    fn basic_block() {
        let inner = "n!\n\\p\n@2026-03-28\n---\nLambert's framing maps closely to Tainter's\ncomplexity brake.";
        let ann = parse_block(inner, marks::builtin_mark_codes());
        assert_eq!(ann.form, AnnotationForm::Block);
        assert_eq!(ann.annotation_type, AnnotationType::Note);
        assert_eq!(ann.certainty, Certainty::Firm);
        assert_eq!(ann.scope, Scope::Paragraph(1));
        assert_eq!(ann.date, Some("2026-03-28".to_string()));
        assert_eq!(
            ann.body,
            Some("Lambert's framing maps closely to Tainter's\ncomplexity brake.".to_string())
        );
    }

    #[test]
    fn block_with_anchor() {
        let inner = "cf\n^\"anuttara\"\n@2026-03\n---\nPrimary parallels:\n- TĀ 3.68";
        let ann = parse_block(inner, marks::builtin_mark_codes());
        assert_eq!(ann.annotation_type, AnnotationType::CrossRef);
        assert_eq!(ann.scope, Scope::Anchor("anuttara".to_string()));
        assert_eq!(ann.date, Some("2026-03".to_string()));
        assert!(ann.body.unwrap().contains("Primary parallels:"));
    }

    #[test]
    fn block_question_tentative() {
        let inner = "q?\n@2026-03-28\n---\nIs this Jayaratha or Abhinavagupta?";
        let ann = parse_block(inner, marks::builtin_mark_codes());
        assert_eq!(ann.annotation_type, AnnotationType::Question);
        assert_eq!(ann.certainty, Certainty::Tentative);
        assert_eq!(ann.body, Some("Is this Jayaratha or Abhinavagupta?".to_string()));
    }

    #[test]
    fn block_with_multiple_body_sections() {
        let inner = "cf\n---\nFirst section.\n\n---\n\nSecond section.";
        let ann = parse_block(inner, marks::builtin_mark_codes());
        assert_eq!(ann.annotation_type, AnnotationType::CrossRef);
        let body = ann.body.unwrap();
        assert!(body.contains("First section."));
        assert!(body.contains("---"));
        assert!(body.contains("Second section."));
    }

    #[test]
    fn block_no_body() {
        let inner = "todo\n\\p\n---";
        let ann = parse_block(inner, marks::builtin_mark_codes());
        assert_eq!(ann.annotation_type, AnnotationType::Todo);
        assert_eq!(ann.scope, Scope::Paragraph(1));
        assert_eq!(ann.body, None);
    }

    #[test]
    fn block_apparatus() {
        let inner = "app\n---\nms. B reads *prakāśa* instead of *vimarśa*";
        let ann = parse_block(inner, marks::builtin_mark_codes());
        assert_eq!(ann.annotation_type, AnnotationType::Apparatus);
        assert!(ann.body.unwrap().contains("ms. B reads"));
    }

    #[test]
    fn block_date_only_head() {
        let inner = "n\n@2026-03\n---\nSome note.";
        let ann = parse_block(inner, marks::builtin_mark_codes());
        assert_eq!(ann.date, Some("2026-03".to_string()));
    }

    #[test]
    fn block_scope_underscores() {
        let inner = "n\n__\n---\nTwo words.";
        let ann = parse_block(inner, marks::builtin_mark_codes());
        assert_eq!(ann.scope, Scope::Words(2));
    }

    #[test]
    fn block_page_scope() {
        let inner = "n\n\\f\n---\nPage-level note.";
        let ann = parse_block(inner, marks::builtin_mark_codes());
        assert_eq!(ann.scope, Scope::Page(1));
    }

    #[test]
    fn block_page_scope_two() {
        let inner = "cf\n\\ff\n---\nCross-ref spanning two pages.";
        let ann = parse_block(inner, marks::builtin_mark_codes());
        assert_eq!(ann.scope, Scope::Page(2));
    }

    #[test]
    fn block_paragraph_underscore_suffix() {
        let inner = "n\n\\p__\n---\nTwo paragraphs.";
        let ann = parse_block(inner, marks::builtin_mark_codes());
        assert_eq!(ann.scope, Scope::Paragraph(2));
    }

    #[test]
    fn block_page_underscore_suffix() {
        let inner = "cf\n\\f___\n---\nThree pages.";
        let ann = parse_block(inner, marks::builtin_mark_codes());
        assert_eq!(ann.scope, Scope::Page(3));
    }

    #[test]
    fn block_paragraph_three_letters() {
        let inner = "n\n\\ppp\n---\nThree paragraphs.";
        let ann = parse_block(inner, marks::builtin_mark_codes());
        assert_eq!(ann.scope, Scope::Paragraph(3));
    }

    #[test]
    fn block_sentence_scope() {
        let inner = "n\n\\s\n---\nSentence-level note.";
        let ann = parse_block(inner, marks::builtin_mark_codes());
        assert_eq!(ann.scope, Scope::Sentence(1));
    }

    #[test]
    fn block_sentence_scope_two() {
        let inner = "cf\n\\ss\n---\nTwo sentences.";
        let ann = parse_block(inner, marks::builtin_mark_codes());
        assert_eq!(ann.scope, Scope::Sentence(2));
    }

    #[test]
    fn block_sentence_underscore_suffix() {
        let inner = "n\n\\s__\n---\nTwo sentences.";
        let ann = parse_block(inner, marks::builtin_mark_codes());
        assert_eq!(ann.scope, Scope::Sentence(2));
    }

    #[test]
    fn detect_block_form() {
        assert!(is_block_form("n\n---\nbody"));
        assert!(is_block_form("  ---  "));
        assert!(!is_block_form("no separator here"));
        assert!(!is_block_form("text --- inline"));
    }

    #[test]
    fn block_llm_type() {
        let inner = "llm\n\\p\n---\nAI content analysis.";
        let ann = parse_block(inner, marks::builtin_mark_codes());
        assert_eq!(ann.annotation_type, AnnotationType::Llm);
        assert_eq!(ann.scope, Scope::Paragraph(1));
        assert_eq!(ann.body, Some("AI content analysis.".to_string()));
    }

    #[test]
    fn block_document_scope() {
        let inner = "llm\n\\d\n---\nSummarize the whole document.";
        let ann = parse_block(inner, marks::builtin_mark_codes());
        assert_eq!(ann.scope, Scope::Document);
    }

    #[test]
    fn block_section_scope() {
        let inner = "n\n\\h\n---\nSection-level note.";
        let ann = parse_block(inner, marks::builtin_mark_codes());
        assert_eq!(ann.scope, Scope::Section);
    }

    #[test]
    fn block_asymmetric_paragraph_scope() {
        let inner = "n\n3\\p1\n---\nAsymmetric note.";
        let ann = parse_block(inner, marks::builtin_mark_codes());
        assert_eq!(ann.scope, Scope::Asymmetric {
            unit: ScopeKind::Paragraph, before: 3, after: 1,
        });
    }

    #[test]
    fn block_mark_basic() {
        let inner = "nb\n_\n---\nbold text";
        let ann = parse_block(inner, marks::builtin_mark_codes());
        assert_eq!(ann.annotation_type, AnnotationType::Mark);
        assert_eq!(ann.mark, Some("nb".to_string()));
        assert_eq!(ann.scope, Scope::Words(1));
        assert_eq!(ann.body, Some("bold text".to_string()));
    }

    #[test]
    fn block_mark_with_certainty() {
        let inner = "sic?\n---\nbody";
        let ann = parse_block(inner, marks::builtin_mark_codes());
        assert_eq!(ann.annotation_type, AnnotationType::Mark);
        assert_eq!(ann.mark, Some("sic".to_string()));
        assert_eq!(ann.certainty, Certainty::Tentative);
    }

    #[test]
    fn block_mark_unknown_stays_bare() {
        let inner = "xyz\n---\nbody";
        let ann = parse_block(inner, marks::builtin_mark_codes());
        assert_eq!(ann.annotation_type, AnnotationType::Bare);
        assert_eq!(ann.mark, None);
    }

    #[test]
    fn block_type_keyword_still_wins() {
        let inner = "n\n---\nbody";
        let ann = parse_block(inner, marks::builtin_mark_codes());
        assert_eq!(ann.annotation_type, AnnotationType::Note);
        assert_eq!(ann.mark, None);
    }

    #[test]
    fn block_custom_code_recognized() {
        let codes = vec!["foo".to_string()];
        let inner = "foo\n---\nbody";
        let ann = parse_block(inner, &codes);
        assert_eq!(ann.annotation_type, AnnotationType::Mark);
        assert_eq!(ann.mark, Some("foo".to_string()));
    }

    #[test]
    fn block_custom_code_ignored() {
        let inner = "foo\n---\nbody";
        let ann = parse_block(inner, marks::builtin_mark_codes());
        assert_eq!(ann.annotation_type, AnnotationType::Bare);
        assert_eq!(ann.mark, None);
    }

    #[test]
    fn block_slipnote_with_anchor() {
        let inner = "sn\n^\"parent-uuid\"\n@2026-07-28\n---\nCompare with Braudel's take on Mediterranean trade.";
        let ann = parse_block(inner, marks::builtin_mark_codes());
        assert_eq!(ann.annotation_type, AnnotationType::SlipNote);
        assert_eq!(ann.scope, Scope::Anchor("parent-uuid".to_string()));
        assert_eq!(ann.date, Some("2026-07-28".to_string()));
        assert_eq!(ann.body, Some("Compare with Braudel's take on Mediterranean trade.".to_string()));
    }

    #[test]
    fn block_slipnote_multiline_body() {
        let inner = "sn\n^\"parent-uuid\"\n@2026-07-28\n---\nCompare with Braudel.\n\nAlso see chapter 4.";
        let ann = parse_block(inner, marks::builtin_mark_codes());
        assert_eq!(ann.annotation_type, AnnotationType::SlipNote);
        assert_eq!(ann.body, Some("Compare with Braudel.\n\nAlso see chapter 4.".to_string()));
    }

    // --- lang: header line ---

    #[test]
    fn block_lang_header_line() {
        let inner = "n\n\\s\nlang: fr\n@2026-07\n---\nune note";
        let ann = parse_block(inner, marks::builtin_mark_codes());
        assert_eq!(ann.annotation_type, AnnotationType::Note);
        assert_eq!(ann.scope, Scope::Sentence(1));
        assert_eq!(ann.lang, Some("fr".to_string()));
        assert_eq!(ann.date, Some("2026-07".to_string()));
        assert_eq!(ann.body, Some("une note".to_string()));
    }

    #[test]
    fn block_lang_accepts_equals_and_case_insensitive_key() {
        let inner = "n\nLang = ja\n---\nbody";
        let ann = parse_block(inner, marks::builtin_mark_codes());
        assert_eq!(ann.lang, Some("ja".to_string()));
    }

    #[test]
    fn block_lang_is_normalized() {
        let inner = "n\nlang: zh-Hant-TW\n---\nbody";
        let ann = parse_block(inner, marks::builtin_mark_codes());
        assert_eq!(ann.lang, Some("zh-hant".to_string()));
    }

    #[test]
    fn block_without_lang_header_leaves_none() {
        let inner = "n\n\\s\n---\nbody";
        let ann = parse_block(inner, marks::builtin_mark_codes());
        assert_eq!(ann.lang, None);
    }

    #[test]
    fn block_unnormalizable_lang_header_leaves_none() {
        let inner = "n\nlang: x\n---\nbody";
        let ann = parse_block(inner, marks::builtin_mark_codes());
        assert_eq!(ann.lang, None);
    }

    #[test]
    fn block_lang_line_after_separator_stays_body_text() {
        let inner = "n\n---\nlang: fr\nis how you set it";
        let ann = parse_block(inner, marks::builtin_mark_codes());
        assert_eq!(ann.lang, None);
        assert_eq!(ann.body, Some("lang: fr\nis how you set it".to_string()));
    }

    #[test]
    fn block_lang_header_does_not_shadow_the_type_line() {
        // `lang: fr` must not be mistaken for a type/mark line and leave the
        // annotation typeless.
        let inner = "q?\nlang: fr\n---\nbody";
        let ann = parse_block(inner, marks::builtin_mark_codes());
        assert_eq!(ann.annotation_type, AnnotationType::Question);
        assert_eq!(ann.certainty, Certainty::Tentative);
        assert_eq!(ann.lang, Some("fr".to_string()));
    }
}
