use std::sync::LazyLock;
use regex::Regex;
use super::types::*;

static DATE_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"@(\d{4}-\d{2}(?:-\d{2})?)").unwrap()
});

static ANCHOR_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"\^"((?:[^"\\]|\\.)+)""#).unwrap()
});

static SCOPE_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^(_{1,}|\\p(?:p+|_{1,})?|\\f(?:f+|_{1,})?|\\s(?:s+|_{1,})?|\\d|\\h|\d+\\[psf]\d+|\d+_\d+)\s").unwrap()
});

pub fn parse_compact(inner: &str) -> Annotation {
    let mut remaining = inner;
    let mut annotation_type = AnnotationType::Bare;
    let mut certainty = Certainty::Neutral;
    let mut scope = Scope::Sentence(1);
    let mut is_structured = false;

    let type_keywords = ["todo", "app", "llm", "cf", "tr", "n", "q"];
    for &kw in &type_keywords {
        if remaining.starts_with(kw) {
            let after = &remaining[kw.len()..];
            let next_ch = after.chars().next();
            if next_ch.is_none()
                || next_ch == Some('?')
                || next_ch == Some('!')
                || next_ch == Some(':')
                || next_ch == Some(' ')
                || next_ch == Some('|')
            {
                if let Some(t) = AnnotationType::from_str(kw) {
                    annotation_type = t;
                    remaining = after;
                    is_structured = true;
                    break;
                }
            }
        }
    }

    if let Some(ch) = remaining.chars().next() {
        if ch == '?' || ch == '!' || ch == ':' {
            certainty = Certainty::from_char(ch);
            remaining = &remaining[1..];
            if ch != ':' {
                is_structured = true;
            }
        }
    }

    remaining = remaining.trim_start();

    if let Some(caps) = SCOPE_RE.captures(remaining) {
        let scope_str = caps.get(1).unwrap().as_str();
        scope = Scope::from_str(scope_str);
        remaining = &remaining[caps.get(0).unwrap().end()..];
        is_structured = true;
    } else if remaining.starts_with('_') && remaining.chars().all(|c| c == '_') {
        scope = Scope::from_str(remaining);
        remaining = "";
        is_structured = true;
    } else if Scope::try_parse(remaining).is_some() {
        scope = Scope::from_str(remaining);
        remaining = "";
        is_structured = true;
    }

    remaining = remaining.trim_start();

    if let Some(caps) = ANCHOR_RE.captures(remaining) {
        scope = Scope::Anchor(caps.get(1).unwrap().as_str().replace("\\\"", "\""));
        remaining = &remaining[caps.get(0).unwrap().end()..];
        is_structured = true;
    }

    remaining = remaining.trim_start();

    let body_text = if let Some(idx) = remaining.find('|') {
        let after_pipe = remaining[idx + 1..].trim_start();
        is_structured = true;
        after_pipe
    } else {
        remaining
    };

    let (body_clean, date) = if let Some(caps) = DATE_RE.captures(body_text) {
        let date_str = caps.get(1).unwrap().as_str().to_string();
        let before_date = body_text[..caps.get(0).unwrap().start()].trim_end();
        is_structured = true;
        (before_date, Some(date_str))
    } else {
        (body_text.trim_end(), None)
    };

    let body = if body_clean.is_empty() {
        None
    } else {
        Some(body_clean.to_string())
    };

    if !is_structured {
        return Annotation {
            form: AnnotationForm::Compact,
            annotation_type: AnnotationType::Bare,
            certainty: Certainty::Neutral,
            scope: Scope::Sentence(1),
            body: Some(inner.to_string()),
            date: None,
            is_structured: false,
            char_start: 0,
            char_end: 0,
            original: String::new(),
            uuid: None,
        };
    }

    Annotation {
        form: AnnotationForm::Compact,
        annotation_type,
        certainty,
        scope,
        body,
        date,
        is_structured,
        char_start: 0,
        char_end: 0,
        original: String::new(),
        uuid: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn full_compact_annotation() {
        let ann = parse_compact("n? __ | same sense as TĀ 3.68? @2026-03");
        assert_eq!(ann.annotation_type, AnnotationType::Note);
        assert_eq!(ann.certainty, Certainty::Tentative);
        assert_eq!(ann.scope, Scope::Words(2));
        assert_eq!(ann.body, Some("same sense as TĀ 3.68?".to_string()));
        assert_eq!(ann.date, Some("2026-03".to_string()));
        assert_eq!(ann.form, AnnotationForm::Compact);
    }

    #[test]
    fn todo_firm_with_anchor() {
        let ann = parse_compact(r#"todo! ^"8th century" | Sanderson 2007 handout says 9th c."#);
        assert_eq!(ann.annotation_type, AnnotationType::Todo);
        assert_eq!(ann.certainty, Certainty::Firm);
        assert_eq!(ann.scope, Scope::Anchor("8th century".to_string()));
        assert_eq!(ann.body, Some("Sanderson 2007 handout says 9th c.".to_string()));
        assert_eq!(ann.date, None);
    }

    #[test]
    fn crossref_preceding_paragraph() {
        let ann = parse_compact(r"cf \pp");
        assert_eq!(ann.annotation_type, AnnotationType::CrossRef);
        assert_eq!(ann.certainty, Certainty::Neutral);
        assert_eq!(ann.scope, Scope::Paragraph(2));
        assert_eq!(ann.body, None);
    }

    #[test]
    fn note_with_colon_separator() {
        let ann = parse_compact("n: _ | seems wrong @2026-03");
        assert_eq!(ann.annotation_type, AnnotationType::Note);
        assert_eq!(ann.certainty, Certainty::Neutral);
        assert_eq!(ann.scope, Scope::Words(1));
        assert_eq!(ann.body, Some("seems wrong".to_string()));
        assert_eq!(ann.date, Some("2026-03".to_string()));
    }

    #[test]
    fn apparatus_type() {
        let ann = parse_compact("app: | variant reading in ms. B");
        assert_eq!(ann.annotation_type, AnnotationType::Apparatus);
        assert_eq!(ann.body, Some("variant reading in ms. B".to_string()));
    }

    #[test]
    fn type_only_no_body() {
        let ann = parse_compact("q?");
        assert_eq!(ann.annotation_type, AnnotationType::Question);
        assert_eq!(ann.certainty, Certainty::Tentative);
        assert_eq!(ann.body, None);
    }

    #[test]
    fn date_with_full_precision() {
        let ann = parse_compact("n: | a note @2026-03-28");
        assert_eq!(ann.date, Some("2026-03-28".to_string()));
    }

    #[test]
    fn bare_comment() {
        let ann = parse_compact("compare Vasugupta SpK 1.1");
        assert_eq!(ann.annotation_type, AnnotationType::Bare);
        assert_eq!(ann.certainty, Certainty::Neutral);
        assert_eq!(ann.scope, Scope::Sentence(1));
        assert_eq!(ann.body, Some("compare Vasugupta SpK 1.1".to_string()));
    }

    #[test]
    fn body_only_with_pipe() {
        let ann = parse_compact("| just the body");
        assert_eq!(ann.annotation_type, AnnotationType::Bare);
        assert_eq!(ann.body, Some("just the body".to_string()));
    }

    #[test]
    fn paragraph_scope() {
        let ann = parse_compact(r"n: \p | paragraph note");
        assert_eq!(ann.scope, Scope::Paragraph(1));
        assert_eq!(ann.body, Some("paragraph note".to_string()));
    }

    #[test]
    fn three_word_scope() {
        let ann = parse_compact("n: ___ | three words");
        assert_eq!(ann.scope, Scope::Words(3));
    }

    #[test]
    fn question_with_scope_and_anchor() {
        let ann = parse_compact(r#"q? ^"some phrase" | is this right?"#);
        assert_eq!(ann.annotation_type, AnnotationType::Question);
        assert_eq!(ann.scope, Scope::Anchor("some phrase".to_string()));
        assert_eq!(ann.body, Some("is this right?".to_string()));
    }

    #[test]
    fn translation_type() {
        let ann = parse_compact("tr: | Sanskrit translation of verse 3");
        assert_eq!(ann.annotation_type, AnnotationType::Translation);
        assert_eq!(ann.certainty, Certainty::Neutral);
        assert_eq!(ann.body, Some("Sanskrit translation of verse 3".to_string()));
    }

    #[test]
    fn translation_tentative_with_date() {
        let ann = parse_compact("tr? _ | tentative rendering @2026-03");
        assert_eq!(ann.annotation_type, AnnotationType::Translation);
        assert_eq!(ann.certainty, Certainty::Tentative);
        assert_eq!(ann.scope, Scope::Words(1));
        assert_eq!(ann.body, Some("tentative rendering".to_string()));
        assert_eq!(ann.date, Some("2026-03".to_string()));
    }

    #[test]
    fn page_scope() {
        let ann = parse_compact(r"n: \f | page-level note");
        assert_eq!(ann.scope, Scope::Page(1));
        assert_eq!(ann.body, Some("page-level note".to_string()));
    }

    #[test]
    fn page_scope_two() {
        let ann = parse_compact(r"n: \ff | this and preceding page");
        assert_eq!(ann.scope, Scope::Page(2));
    }

    #[test]
    fn page_scope_underscore_suffix() {
        let ann = parse_compact(r"cf \f__");
        assert_eq!(ann.annotation_type, AnnotationType::CrossRef);
        assert_eq!(ann.scope, Scope::Page(2));
        assert_eq!(ann.body, None);
    }

    #[test]
    fn paragraph_underscore_suffix_compact() {
        let ann = parse_compact(r"n: \p__ | two paragraphs");
        assert_eq!(ann.scope, Scope::Paragraph(2));
        assert_eq!(ann.body, Some("two paragraphs".to_string()));
    }

    #[test]
    fn page_scope_three_letters() {
        let ann = parse_compact(r"cf \fff");
        assert_eq!(ann.scope, Scope::Page(3));
    }

    #[test]
    fn page_scope_three_underscores() {
        let ann = parse_compact(r"cf \f___");
        assert_eq!(ann.scope, Scope::Page(3));
    }

    #[test]
    fn page_scope_equivalence() {
        let a = parse_compact(r"n: \f___ | note");
        let b = parse_compact(r"n: \fff | note");
        assert_eq!(a.scope, b.scope);
    }

    #[test]
    fn sentence_scope() {
        let ann = parse_compact(r"n: \s | sentence-level note");
        assert_eq!(ann.scope, Scope::Sentence(1));
        assert_eq!(ann.body, Some("sentence-level note".to_string()));
    }

    #[test]
    fn sentence_scope_two() {
        let ann = parse_compact(r"n: \ss | two sentences");
        assert_eq!(ann.scope, Scope::Sentence(2));
    }

    #[test]
    fn sentence_scope_three_letters() {
        let ann = parse_compact(r"cf \sss");
        assert_eq!(ann.scope, Scope::Sentence(3));
    }

    #[test]
    fn sentence_scope_underscore_suffix() {
        let ann = parse_compact(r"cf \s__");
        assert_eq!(ann.annotation_type, AnnotationType::CrossRef);
        assert_eq!(ann.scope, Scope::Sentence(2));
        assert_eq!(ann.body, None);
    }

    #[test]
    fn sentence_scope_three_underscores() {
        let ann = parse_compact(r"cf \s___");
        assert_eq!(ann.scope, Scope::Sentence(3));
    }

    #[test]
    fn sentence_scope_equivalence() {
        let a = parse_compact(r"n: \s___ | note");
        let b = parse_compact(r"n: \sss | note");
        assert_eq!(a.scope, b.scope);
    }

    #[test]
    fn llm_type_compact() {
        let ann = parse_compact("llm | AI summary of passage");
        assert_eq!(ann.annotation_type, AnnotationType::Llm);
        assert_eq!(ann.body, Some("AI summary of passage".to_string()));
    }

    #[test]
    fn llm_with_scope_and_certainty() {
        let ann = parse_compact(r"llm! \p | summarize this section");
        assert_eq!(ann.annotation_type, AnnotationType::Llm);
        assert_eq!(ann.certainty, Certainty::Firm);
        assert_eq!(ann.scope, Scope::Paragraph(1));
    }

    #[test]
    fn document_scope_compact() {
        let ann = parse_compact(r"llm \d | summarize entire document");
        assert_eq!(ann.scope, Scope::Document);
        assert_eq!(ann.body, Some("summarize entire document".to_string()));
    }

    #[test]
    fn section_scope_compact() {
        let ann = parse_compact(r"n: \h | section-level note");
        assert_eq!(ann.scope, Scope::Section);
        assert_eq!(ann.body, Some("section-level note".to_string()));
    }

    #[test]
    fn asymmetric_paragraph_scope_compact() {
        let ann = parse_compact(r"n 3\p1 | three before one after");
        assert_eq!(ann.scope, Scope::Asymmetric {
            unit: ScopeKind::Paragraph, before: 3, after: 1,
        });
        assert_eq!(ann.body, Some("three before one after".to_string()));
    }

    #[test]
    fn asymmetric_word_scope_compact() {
        let ann = parse_compact("n 3_1 | asymmetric words");
        assert_eq!(ann.scope, Scope::Asymmetric {
            unit: ScopeKind::Word, before: 3, after: 1,
        });
    }

    #[test]
    fn existing_types_still_parse() {
        assert_eq!(parse_compact("n | note").annotation_type, AnnotationType::Note);
        assert_eq!(parse_compact("todo | task").annotation_type, AnnotationType::Todo);
        assert_eq!(parse_compact("tr | translate").annotation_type, AnnotationType::Translation);
    }
}
