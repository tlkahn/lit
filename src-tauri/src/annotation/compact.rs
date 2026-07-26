use std::sync::LazyLock;
use regex::Regex;
use super::types::*;

static DATE_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"@(\d{4}-\d{2}(?:-\d{2})?)").unwrap()
});

static ANCHOR_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"\^"((?:[^"\\]|\\.)+)""#).unwrap()
});

static LANG_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^(?i)lang=([A-Za-z0-9_-]+)").unwrap()
});

static SCOPE_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^(_{1,}|\\p(?:p+|_{1,})?|\\f(?:f+|_{1,})?|\\s(?:s+|_{1,})?|\\d|\\h|\d+\\[psf]\d+|\d+_\d+)\s").unwrap()
});

pub fn parse_compact(inner: &str, mark_codes: &[String]) -> Annotation {
    let mut remaining = inner;
    let mut annotation_type = AnnotationType::Bare;
    let mut certainty = Certainty::Neutral;
    let mut scope = Scope::Sentence(1);
    let mut is_structured = false;
    let mut mark: Option<String> = None;
    let mut lang: Option<String> = None;

    let type_keywords = ["todo", "app", "llm", "cf", "tr", "th", "n", "q"];
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

    // When no type keyword matched, the type-keyword position may instead hold a
    // philological mark code (e.g. `nb`, `sic`). Match longest-first and require a
    // terminator of whitespace/?/!/|/EOS — note `:` is deliberately NOT a mark
    // terminator (unlike type keywords) to avoid ambiguity with body separators.
    if annotation_type == AnnotationType::Bare {
        for code in mark_codes {
            if remaining.starts_with(code.as_str()) {
                let next_ch = remaining[code.len()..].chars().next();
                if next_ch.is_none()
                    || next_ch == Some(' ')
                    || next_ch == Some('\t')
                    || next_ch == Some('?')
                    || next_ch == Some('!')
                    || next_ch == Some('|')
                {
                    annotation_type = AnnotationType::Mark;
                    mark = Some(code.clone());
                    remaining = &remaining[code.len()..];
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

    // `lang=xx` sits in the header region, after the scope/anchor and before
    // the `|`. On an annotation that is not yet structured the token is
    // ambiguous with prose (`<!--- lang=en is a variable name --->`), so it is
    // only consumed when nothing but a body separator, a date or the end of
    // the annotation follows it. Text after `|` is body and never scanned.
    if let Some(caps) = LANG_RE.captures(remaining) {
        let rest = &remaining[caps.get(0).unwrap().end()..];
        let after = rest.trim_start();
        let unambiguous =
            is_structured || after.is_empty() || after.starts_with('|') || after.starts_with('@');
        if unambiguous {
            if let Some(normalized) = super::lang::normalize_lang(caps.get(1).unwrap().as_str()) {
                lang = Some(normalized);
                remaining = rest;
                is_structured = true;
            }
        }
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
            mark: None,
            lang: None,
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
        mark,
        lang,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::annotation::marks;

    #[test]
    fn full_compact_annotation() {
        let ann = parse_compact("n? __ | same sense as TĀ 3.68? @2026-03", marks::builtin_mark_codes());
        assert_eq!(ann.annotation_type, AnnotationType::Note);
        assert_eq!(ann.certainty, Certainty::Tentative);
        assert_eq!(ann.scope, Scope::Words(2));
        assert_eq!(ann.body, Some("same sense as TĀ 3.68?".to_string()));
        assert_eq!(ann.date, Some("2026-03".to_string()));
        assert_eq!(ann.form, AnnotationForm::Compact);
    }

    #[test]
    fn todo_firm_with_anchor() {
        let ann = parse_compact(r#"todo! ^"8th century" | Sanderson 2007 handout says 9th c."#, marks::builtin_mark_codes());
        assert_eq!(ann.annotation_type, AnnotationType::Todo);
        assert_eq!(ann.certainty, Certainty::Firm);
        assert_eq!(ann.scope, Scope::Anchor("8th century".to_string()));
        assert_eq!(ann.body, Some("Sanderson 2007 handout says 9th c.".to_string()));
        assert_eq!(ann.date, None);
    }

    #[test]
    fn crossref_preceding_paragraph() {
        let ann = parse_compact(r"cf \pp", marks::builtin_mark_codes());
        assert_eq!(ann.annotation_type, AnnotationType::CrossRef);
        assert_eq!(ann.certainty, Certainty::Neutral);
        assert_eq!(ann.scope, Scope::Paragraph(2));
        assert_eq!(ann.body, None);
    }

    #[test]
    fn note_with_colon_separator() {
        let ann = parse_compact("n: _ | seems wrong @2026-03", marks::builtin_mark_codes());
        assert_eq!(ann.annotation_type, AnnotationType::Note);
        assert_eq!(ann.certainty, Certainty::Neutral);
        assert_eq!(ann.scope, Scope::Words(1));
        assert_eq!(ann.body, Some("seems wrong".to_string()));
        assert_eq!(ann.date, Some("2026-03".to_string()));
    }

    #[test]
    fn apparatus_type() {
        let ann = parse_compact("app: | variant reading in ms. B", marks::builtin_mark_codes());
        assert_eq!(ann.annotation_type, AnnotationType::Apparatus);
        assert_eq!(ann.body, Some("variant reading in ms. B".to_string()));
    }

    #[test]
    fn type_only_no_body() {
        let ann = parse_compact("q?", marks::builtin_mark_codes());
        assert_eq!(ann.annotation_type, AnnotationType::Question);
        assert_eq!(ann.certainty, Certainty::Tentative);
        assert_eq!(ann.body, None);
    }

    #[test]
    fn date_with_full_precision() {
        let ann = parse_compact("n: | a note @2026-03-28", marks::builtin_mark_codes());
        assert_eq!(ann.date, Some("2026-03-28".to_string()));
    }

    #[test]
    fn bare_comment() {
        let ann = parse_compact("compare Vasugupta SpK 1.1", marks::builtin_mark_codes());
        assert_eq!(ann.annotation_type, AnnotationType::Bare);
        assert_eq!(ann.certainty, Certainty::Neutral);
        assert_eq!(ann.scope, Scope::Sentence(1));
        assert_eq!(ann.body, Some("compare Vasugupta SpK 1.1".to_string()));
    }

    #[test]
    fn body_only_with_pipe() {
        let ann = parse_compact("| just the body", marks::builtin_mark_codes());
        assert_eq!(ann.annotation_type, AnnotationType::Bare);
        assert_eq!(ann.body, Some("just the body".to_string()));
    }

    #[test]
    fn paragraph_scope() {
        let ann = parse_compact(r"n: \p | paragraph note", marks::builtin_mark_codes());
        assert_eq!(ann.scope, Scope::Paragraph(1));
        assert_eq!(ann.body, Some("paragraph note".to_string()));
    }

    #[test]
    fn three_word_scope() {
        let ann = parse_compact("n: ___ | three words", marks::builtin_mark_codes());
        assert_eq!(ann.scope, Scope::Words(3));
    }

    #[test]
    fn question_with_scope_and_anchor() {
        let ann = parse_compact(r#"q? ^"some phrase" | is this right?"#, marks::builtin_mark_codes());
        assert_eq!(ann.annotation_type, AnnotationType::Question);
        assert_eq!(ann.scope, Scope::Anchor("some phrase".to_string()));
        assert_eq!(ann.body, Some("is this right?".to_string()));
    }

    #[test]
    fn translation_type() {
        let ann = parse_compact("tr: | Sanskrit translation of verse 3", marks::builtin_mark_codes());
        assert_eq!(ann.annotation_type, AnnotationType::Translation);
        assert_eq!(ann.certainty, Certainty::Neutral);
        assert_eq!(ann.body, Some("Sanskrit translation of verse 3".to_string()));
    }

    #[test]
    fn translation_tentative_with_date() {
        let ann = parse_compact("tr? _ | tentative rendering @2026-03", marks::builtin_mark_codes());
        assert_eq!(ann.annotation_type, AnnotationType::Translation);
        assert_eq!(ann.certainty, Certainty::Tentative);
        assert_eq!(ann.scope, Scope::Words(1));
        assert_eq!(ann.body, Some("tentative rendering".to_string()));
        assert_eq!(ann.date, Some("2026-03".to_string()));
    }

    #[test]
    fn page_scope() {
        let ann = parse_compact(r"n: \f | page-level note", marks::builtin_mark_codes());
        assert_eq!(ann.scope, Scope::Page(1));
        assert_eq!(ann.body, Some("page-level note".to_string()));
    }

    #[test]
    fn page_scope_two() {
        let ann = parse_compact(r"n: \ff | this and preceding page", marks::builtin_mark_codes());
        assert_eq!(ann.scope, Scope::Page(2));
    }

    #[test]
    fn page_scope_underscore_suffix() {
        let ann = parse_compact(r"cf \f__", marks::builtin_mark_codes());
        assert_eq!(ann.annotation_type, AnnotationType::CrossRef);
        assert_eq!(ann.scope, Scope::Page(2));
        assert_eq!(ann.body, None);
    }

    #[test]
    fn paragraph_underscore_suffix_compact() {
        let ann = parse_compact(r"n: \p__ | two paragraphs", marks::builtin_mark_codes());
        assert_eq!(ann.scope, Scope::Paragraph(2));
        assert_eq!(ann.body, Some("two paragraphs".to_string()));
    }

    #[test]
    fn page_scope_three_letters() {
        let ann = parse_compact(r"cf \fff", marks::builtin_mark_codes());
        assert_eq!(ann.scope, Scope::Page(3));
    }

    #[test]
    fn page_scope_three_underscores() {
        let ann = parse_compact(r"cf \f___", marks::builtin_mark_codes());
        assert_eq!(ann.scope, Scope::Page(3));
    }

    #[test]
    fn page_scope_equivalence() {
        let a = parse_compact(r"n: \f___ | note", marks::builtin_mark_codes());
        let b = parse_compact(r"n: \fff | note", marks::builtin_mark_codes());
        assert_eq!(a.scope, b.scope);
    }

    #[test]
    fn sentence_scope() {
        let ann = parse_compact(r"n: \s | sentence-level note", marks::builtin_mark_codes());
        assert_eq!(ann.scope, Scope::Sentence(1));
        assert_eq!(ann.body, Some("sentence-level note".to_string()));
    }

    #[test]
    fn sentence_scope_two() {
        let ann = parse_compact(r"n: \ss | two sentences", marks::builtin_mark_codes());
        assert_eq!(ann.scope, Scope::Sentence(2));
    }

    #[test]
    fn sentence_scope_three_letters() {
        let ann = parse_compact(r"cf \sss", marks::builtin_mark_codes());
        assert_eq!(ann.scope, Scope::Sentence(3));
    }

    #[test]
    fn sentence_scope_underscore_suffix() {
        let ann = parse_compact(r"cf \s__", marks::builtin_mark_codes());
        assert_eq!(ann.annotation_type, AnnotationType::CrossRef);
        assert_eq!(ann.scope, Scope::Sentence(2));
        assert_eq!(ann.body, None);
    }

    #[test]
    fn sentence_scope_three_underscores() {
        let ann = parse_compact(r"cf \s___", marks::builtin_mark_codes());
        assert_eq!(ann.scope, Scope::Sentence(3));
    }

    #[test]
    fn sentence_scope_equivalence() {
        let a = parse_compact(r"n: \s___ | note", marks::builtin_mark_codes());
        let b = parse_compact(r"n: \sss | note", marks::builtin_mark_codes());
        assert_eq!(a.scope, b.scope);
    }

    #[test]
    fn llm_type_compact() {
        let ann = parse_compact("llm | AI summary of passage", marks::builtin_mark_codes());
        assert_eq!(ann.annotation_type, AnnotationType::Llm);
        assert_eq!(ann.body, Some("AI summary of passage".to_string()));
    }

    #[test]
    fn llm_with_scope_and_certainty() {
        let ann = parse_compact(r"llm! \p | summarize this section", marks::builtin_mark_codes());
        assert_eq!(ann.annotation_type, AnnotationType::Llm);
        assert_eq!(ann.certainty, Certainty::Firm);
        assert_eq!(ann.scope, Scope::Paragraph(1));
    }

    #[test]
    fn document_scope_compact() {
        let ann = parse_compact(r"llm \d | summarize entire document", marks::builtin_mark_codes());
        assert_eq!(ann.scope, Scope::Document);
        assert_eq!(ann.body, Some("summarize entire document".to_string()));
    }

    #[test]
    fn section_scope_compact() {
        let ann = parse_compact(r"n: \h | section-level note", marks::builtin_mark_codes());
        assert_eq!(ann.scope, Scope::Section);
        assert_eq!(ann.body, Some("section-level note".to_string()));
    }

    #[test]
    fn asymmetric_paragraph_scope_compact() {
        let ann = parse_compact(r"n 3\p1 | three before one after", marks::builtin_mark_codes());
        assert_eq!(ann.scope, Scope::Asymmetric {
            unit: ScopeKind::Paragraph, before: 3, after: 1,
        });
        assert_eq!(ann.body, Some("three before one after".to_string()));
    }

    #[test]
    fn asymmetric_word_scope_compact() {
        let ann = parse_compact("n 3_1 | asymmetric words", marks::builtin_mark_codes());
        assert_eq!(ann.scope, Scope::Asymmetric {
            unit: ScopeKind::Word, before: 3, after: 1,
        });
    }

    #[test]
    fn thread_type_compact() {
        let ann = parse_compact(r"th \p | a thread", marks::builtin_mark_codes());
        assert_eq!(ann.annotation_type, AnnotationType::Thread);
        assert_eq!(ann.scope, Scope::Paragraph(1));
        assert_eq!(ann.body, Some("a thread".to_string()));
    }

    #[test]
    fn thread_bare_eos() {
        let ann = parse_compact("th", marks::builtin_mark_codes());
        assert_eq!(ann.annotation_type, AnnotationType::Thread);
        assert!(ann.is_structured);
        assert_eq!(ann.body, None);
    }

    #[test]
    fn existing_types_still_parse() {
        assert_eq!(parse_compact("n | note", marks::builtin_mark_codes()).annotation_type, AnnotationType::Note);
        assert_eq!(parse_compact("todo | task", marks::builtin_mark_codes()).annotation_type, AnnotationType::Todo);
        assert_eq!(parse_compact("tr | translate", marks::builtin_mark_codes()).annotation_type, AnnotationType::Translation);
        assert_eq!(parse_compact("q? | maybe", marks::builtin_mark_codes()).annotation_type, AnnotationType::Question);
        assert_eq!(parse_compact("llm | go", marks::builtin_mark_codes()).annotation_type, AnnotationType::Llm);
    }

    #[test]
    fn mark_basic_word_scope() {
        let ann = parse_compact("nb _", marks::builtin_mark_codes());
        assert_eq!(ann.annotation_type, AnnotationType::Mark);
        assert_eq!(ann.mark, Some("nb".to_string()));
        assert_eq!(ann.scope, Scope::Words(1));
        assert!(ann.is_structured);
        assert_eq!(ann.body, None);
    }

    #[test]
    fn mark_with_eos_no_scope() {
        let ann = parse_compact("sic", marks::builtin_mark_codes());
        assert_eq!(ann.annotation_type, AnnotationType::Mark);
        assert_eq!(ann.mark, Some("sic".to_string()));
        assert!(ann.is_structured);
        assert_eq!(ann.body, None);
    }

    #[test]
    fn mark_with_certainty() {
        let ann = parse_compact("sic? _", marks::builtin_mark_codes());
        assert_eq!(ann.annotation_type, AnnotationType::Mark);
        assert_eq!(ann.mark, Some("sic".to_string()));
        assert_eq!(ann.certainty, Certainty::Tentative);
        assert_eq!(ann.scope, Scope::Words(1));
    }

    #[test]
    fn mark_with_pipe_body() {
        let ann = parse_compact("crux | dagger here", marks::builtin_mark_codes());
        assert_eq!(ann.annotation_type, AnnotationType::Mark);
        assert_eq!(ann.mark, Some("crux".to_string()));
        assert_eq!(ann.body, Some("dagger here".to_string()));
    }

    #[test]
    fn mark_longest_first() {
        let ann = parse_compact("interp _", marks::builtin_mark_codes());
        assert_eq!(ann.annotation_type, AnnotationType::Mark);
        assert_eq!(ann.mark, Some("interp".to_string()));

        // `nb_` has no valid terminator after `nb` (`_` is not whitespace/?/!/|/EOS),
        // so it stays Bare and the whole token becomes the body.
        let ann = parse_compact("nb_", marks::builtin_mark_codes());
        assert_eq!(ann.annotation_type, AnnotationType::Bare);
        assert_eq!(ann.mark, None);
        assert_eq!(ann.body, Some("nb_".to_string()));
    }

    #[test]
    fn type_keyword_beats_mark() {
        // The type-keyword loop runs first; `n` resolves to Note before the mark
        // detection block (which is gated on annotation_type == Bare) can run.
        let ann = parse_compact("n _", marks::builtin_mark_codes());
        assert_eq!(ann.annotation_type, AnnotationType::Note);
        assert_eq!(ann.mark, None);
    }

    #[test]
    fn unknown_code_falls_through() {
        let ann = parse_compact("xyz _", marks::builtin_mark_codes());
        assert_eq!(ann.annotation_type, AnnotationType::Bare);
        assert_eq!(ann.mark, None);

        // `nbx` starts with the code `nb` but the next char `x` is not a valid
        // terminator, so no mark is detected.
        let ann = parse_compact("nbx _", marks::builtin_mark_codes());
        assert_eq!(ann.annotation_type, AnnotationType::Bare);
        assert_eq!(ann.mark, None);
    }

    #[test]
    fn mark_with_anchor() {
        let ann = parse_compact(r#"em ^"phrase" | text"#, marks::builtin_mark_codes());
        assert_eq!(ann.annotation_type, AnnotationType::Mark);
        assert_eq!(ann.mark, Some("em".to_string()));
        assert_eq!(ann.scope, Scope::Anchor("phrase".to_string()));
        assert_eq!(ann.body, Some("text".to_string()));
    }

    #[test]
    fn custom_code_recognized_when_passed() {
        // Build a sorted code list so the longest-first prefix invariant holds.
        let mut cfg = marks::builtin_config().clone();
        cfg.0.insert(
            "foo".to_string(),
            marks::MarkDef {
                label: "foo".to_string(),
                icon: None,
                before: None,
                after: None,
                style: None,
            },
        );
        let codes = marks::sorted_mark_codes(&cfg);
        let ann = parse_compact("foo _", &codes);
        assert_eq!(ann.annotation_type, AnnotationType::Mark);
        assert_eq!(ann.mark, Some("foo".to_string()));
        assert_eq!(ann.scope, Scope::Words(1));
    }

    #[test]
    fn custom_code_ignored_when_not_passed() {
        let ann = parse_compact("foo _", marks::builtin_mark_codes());
        assert_eq!(ann.annotation_type, AnnotationType::Bare);
        assert_eq!(ann.mark, None);
    }

    // --- lang= field ---

    #[test]
    fn lang_after_scope_with_body() {
        let ann = parse_compact(r"n? \ss lang=fr | même sens ? @2026-07", marks::builtin_mark_codes());
        assert_eq!(ann.annotation_type, AnnotationType::Note);
        assert_eq!(ann.certainty, Certainty::Tentative);
        assert_eq!(ann.scope, Scope::Sentence(2));
        assert_eq!(ann.lang, Some("fr".to_string()));
        assert_eq!(ann.body, Some("même sens ?".to_string()));
        assert_eq!(ann.date, Some("2026-07".to_string()));
    }

    #[test]
    fn lang_after_scope_without_body() {
        let ann = parse_compact("tr _ lang=ja", marks::builtin_mark_codes());
        assert_eq!(ann.annotation_type, AnnotationType::Translation);
        assert_eq!(ann.scope, Scope::Words(1));
        assert_eq!(ann.lang, Some("ja".to_string()));
        assert_eq!(ann.body, None);
    }

    #[test]
    fn lang_after_type_without_scope() {
        let ann = parse_compact("n lang=fr | a note", marks::builtin_mark_codes());
        assert_eq!(ann.annotation_type, AnnotationType::Note);
        assert_eq!(ann.lang, Some("fr".to_string()));
        assert_eq!(ann.body, Some("a note".to_string()));
    }

    #[test]
    fn lang_after_anchor() {
        let ann = parse_compact(r#"cf ^"anuttara" lang=sa | parallels"#, marks::builtin_mark_codes());
        assert_eq!(ann.scope, Scope::Anchor("anuttara".to_string()));
        assert_eq!(ann.lang, Some("sa".to_string()));
        assert_eq!(ann.body, Some("parallels".to_string()));
    }

    #[test]
    fn lang_is_normalized_at_parse_time() {
        let ann = parse_compact(r"n \s lang=FR-CA | note", marks::builtin_mark_codes());
        assert_eq!(ann.lang, Some("fr".to_string()));
    }

    #[test]
    fn lang_absent_leaves_none() {
        let ann = parse_compact(r"n \s | note", marks::builtin_mark_codes());
        assert_eq!(ann.lang, None);
    }

    // The disambiguation rule: an unstructured annotation only yields its
    // `lang=` token when nothing that looks like prose follows it.
    #[test]
    fn bare_annotation_keeps_lang_looking_prose_as_body() {
        let ann = parse_compact("lang=en is a variable name", marks::builtin_mark_codes());
        assert_eq!(ann.annotation_type, AnnotationType::Bare);
        assert!(!ann.is_structured);
        assert_eq!(ann.lang, None);
        assert_eq!(ann.body, Some("lang=en is a variable name".to_string()));
    }

    #[test]
    fn lang_alone_before_pipe_structures_the_annotation() {
        let ann = parse_compact("lang=fr | note", marks::builtin_mark_codes());
        assert!(ann.is_structured);
        assert_eq!(ann.lang, Some("fr".to_string()));
        assert_eq!(ann.body, Some("note".to_string()));
    }

    #[test]
    fn lang_alone_at_end_structures_the_annotation() {
        let ann = parse_compact("lang=fr", marks::builtin_mark_codes());
        assert!(ann.is_structured);
        assert_eq!(ann.lang, Some("fr".to_string()));
        assert_eq!(ann.body, None);
    }

    #[test]
    fn lang_alone_before_date_structures_the_annotation() {
        let ann = parse_compact("lang=fr @2026-07", marks::builtin_mark_codes());
        assert!(ann.is_structured);
        assert_eq!(ann.lang, Some("fr".to_string()));
        assert_eq!(ann.date, Some("2026-07".to_string()));
        assert_eq!(ann.body, None);
    }

    #[test]
    fn lang_in_body_after_pipe_is_never_consumed() {
        let ann = parse_compact(r"n \s | set lang=fr in the config", marks::builtin_mark_codes());
        assert_eq!(ann.lang, None);
        assert_eq!(ann.body, Some("set lang=fr in the config".to_string()));
    }

    #[test]
    fn unnormalizable_lang_token_stays_body_text() {
        let ann = parse_compact(r"n \s | lang=x", marks::builtin_mark_codes());
        assert_eq!(ann.lang, None);
        assert_eq!(ann.body, Some("lang=x".to_string()));
    }

    #[test]
    fn lang_keyword_case_insensitive() {
        let ann = parse_compact(r"n \s Lang=fr | note", marks::builtin_mark_codes());
        assert_eq!(ann.lang, Some("fr".to_string()));
        assert_eq!(ann.body, Some("note".to_string()));
    }

    #[test]
    fn lang_keyword_uppercase() {
        let ann = parse_compact(r"n \s LANG=ja | note", marks::builtin_mark_codes());
        assert_eq!(ann.lang, Some("ja".to_string()));
    }

    #[test]
    fn unnormalizable_lang_value_dropped_from_header() {
        let ann = parse_compact(r"n \s lang=english | note", marks::builtin_mark_codes());
        assert_eq!(ann.lang, None);
        assert_eq!(ann.body, Some("note".to_string()));
    }
}
