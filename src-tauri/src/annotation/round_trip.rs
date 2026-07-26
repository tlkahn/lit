#[cfg(test)]
mod tests {
    use crate::annotation::parser::parse_annotations_builtin as parse_annotations;
    use crate::annotation::types::*;

    fn parse_one(dsl: &str) -> Annotation {
        let anns = parse_annotations(dsl);
        assert_eq!(anns.len(), 1, "expected 1 annotation in: {dsl}");
        anns.into_iter().next().unwrap()
    }

    #[test]
    fn compact_bare_body() {
        let ann = parse_one("<!--- compare Vasugupta SpK 1.1 --->");
        assert_eq!(ann.annotation_type, AnnotationType::Bare);
        assert_eq!(ann.body, Some("compare Vasugupta SpK 1.1".to_string()));
    }

    #[test]
    fn compact_note_with_body() {
        let ann = parse_one("<!--- n | a note --->");
        assert_eq!(ann.annotation_type, AnnotationType::Note);
        assert_eq!(ann.certainty, Certainty::Neutral);
        assert_eq!(ann.body, Some("a note".to_string()));
    }

    #[test]
    fn compact_question_tentative_words_date() {
        let ann = parse_one("<!--- q? __ | same sense as TĀ 3.68? @2026-03 --->");
        assert_eq!(ann.annotation_type, AnnotationType::Question);
        assert_eq!(ann.certainty, Certainty::Tentative);
        assert_eq!(ann.scope, Scope::Words(2));
        assert_eq!(ann.body, Some("same sense as TĀ 3.68?".to_string()));
        assert_eq!(ann.date, Some("2026-03".to_string()));
    }

    #[test]
    fn compact_todo_firm_anchor() {
        let ann = parse_one(r#"<!--- todo! ^"8th century" | Sanderson 2007 handout says 9th c. --->"#);
        assert_eq!(ann.annotation_type, AnnotationType::Todo);
        assert_eq!(ann.certainty, Certainty::Firm);
        assert_eq!(ann.scope, Scope::Anchor("8th century".to_string()));
        assert_eq!(ann.body, Some("Sanderson 2007 handout says 9th c.".to_string()));
    }

    #[test]
    fn compact_crossref_paragraph_no_body() {
        let ann = parse_one(r"<!--- cf \pp --->");
        assert_eq!(ann.annotation_type, AnnotationType::CrossRef);
        assert_eq!(ann.scope, Scope::Paragraph(2));
        assert_eq!(ann.body, None);
    }

    #[test]
    fn compact_apparatus() {
        let ann = parse_one("<!--- app | variant reading in ms. B --->");
        assert_eq!(ann.annotation_type, AnnotationType::Apparatus);
        assert_eq!(ann.body, Some("variant reading in ms. B".to_string()));
    }

    #[test]
    fn compact_translation_words_date() {
        let ann = parse_one("<!--- tr _ | cf. Tibetan version @2026-03 --->");
        assert_eq!(ann.annotation_type, AnnotationType::Translation);
        assert_eq!(ann.scope, Scope::Words(1));
        assert_eq!(ann.body, Some("cf. Tibetan version".to_string()));
        assert_eq!(ann.date, Some("2026-03".to_string()));
    }

    #[test]
    fn compact_note_firm_page() {
        let ann = parse_one(r"<!--- n! \f | page-level note --->");
        assert_eq!(ann.annotation_type, AnnotationType::Note);
        assert_eq!(ann.certainty, Certainty::Firm);
        assert_eq!(ann.scope, Scope::Page(1));
        assert_eq!(ann.body, Some("page-level note".to_string()));
    }

    #[test]
    fn compact_note_sentence_scope_2() {
        let ann = parse_one(r"<!--- n \ss | two sentences --->");
        assert_eq!(ann.annotation_type, AnnotationType::Note);
        assert_eq!(ann.scope, Scope::Sentence(2));
        assert_eq!(ann.body, Some("two sentences".to_string()));
    }

    #[test]
    fn compact_crossref_page_3() {
        let ann = parse_one(r"<!--- cf \fff --->");
        assert_eq!(ann.annotation_type, AnnotationType::CrossRef);
        assert_eq!(ann.scope, Scope::Page(3));
    }

    #[test]
    fn compact_note_words_3() {
        let ann = parse_one("<!--- n ___ | three words --->");
        assert_eq!(ann.annotation_type, AnnotationType::Note);
        assert_eq!(ann.scope, Scope::Words(3));
        assert_eq!(ann.body, Some("three words".to_string()));
    }

    #[test]
    fn compact_note_paragraph_1() {
        let ann = parse_one(r"<!--- n \p | one paragraph --->");
        assert_eq!(ann.scope, Scope::Paragraph(1));
    }

    #[test]
    fn compact_note_sentence_1() {
        let ann = parse_one(r"<!--- n \s | one sentence --->");
        assert_eq!(ann.scope, Scope::Sentence(1));
    }

    #[test]
    fn compact_note_date_no_body() {
        let ann = parse_one("<!--- n @2026-03 --->");
        assert_eq!(ann.annotation_type, AnnotationType::Note);
        assert_eq!(ann.date, Some("2026-03".to_string()));
        assert_eq!(ann.body, None);
    }

    #[test]
    fn compact_todo_firm_paragraph_date() {
        let ann = parse_one(r"<!--- todo! \p @2026-03-28 --->");
        assert_eq!(ann.annotation_type, AnnotationType::Todo);
        assert_eq!(ann.certainty, Certainty::Firm);
        assert_eq!(ann.scope, Scope::Paragraph(1));
        assert_eq!(ann.date, Some("2026-03-28".to_string()));
    }

    #[test]
    fn block_note_firm_paragraph_date_multiline() {
        let dsl = "<!---\nn!\n\\p\n@2026-03-28\n---\nLambert's framing maps closely to Tainter's\ncomplexity brake.\n--->";
        let ann = parse_one(dsl);
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
    fn block_note_long_body() {
        let long_body = "This is a very long annotation body that exceeds the eighty character threshold and should trigger block form output.";
        let dsl = format!("<!---\nn\n---\n{long_body}\n--->");
        let ann = parse_one(&dsl);
        assert_eq!(ann.form, AnnotationForm::Block);
        assert_eq!(ann.annotation_type, AnnotationType::Note);
        assert_eq!(ann.body, Some(long_body.to_string()));
    }

    #[test]
    fn block_crossref_anchor_date_multiline() {
        let dsl = "<!---\ncf\n^\"anuttara\"\n@2026-03\n---\nPrimary parallels:\n- TĀ 3.68\n--->";
        let ann = parse_one(dsl);
        assert_eq!(ann.form, AnnotationForm::Block);
        assert_eq!(ann.annotation_type, AnnotationType::CrossRef);
        assert_eq!(ann.scope, Scope::Anchor("anuttara".to_string()));
        assert_eq!(ann.date, Some("2026-03".to_string()));
        assert!(ann.body.as_ref().unwrap().contains("Primary parallels:"));
        assert!(ann.body.as_ref().unwrap().contains("- TĀ 3.68"));
    }

    #[test]
    fn compact_anchor_with_escaped_quotes() {
        let ann = parse_one(r#"<!--- n ^"a \"quoted\" phrase" | body --->"#);
        assert_eq!(ann.scope, Scope::Anchor(r#"a "quoted" phrase"#.to_string()));
        assert_eq!(ann.body, Some("body".to_string()));
    }

    #[test]
    fn block_anchor_with_escaped_quotes() {
        let dsl = "<!---\nn\n^\"a \\\"quoted\\\" phrase\"\n---\nbody\n--->";
        let ann = parse_one(dsl);
        assert_eq!(ann.scope, Scope::Anchor("a \"quoted\" phrase".to_string()));
        assert_eq!(ann.body, Some("body".to_string()));
    }

    #[test]
    fn block_bare_multiline() {
        let dsl = "<!---\n---\nline one\nline two\n--->";
        let ann = parse_one(dsl);
        assert_eq!(ann.form, AnnotationForm::Block);
        assert_eq!(ann.annotation_type, AnnotationType::Bare);
        assert!(ann.body.as_ref().unwrap().contains("line one"));
        assert!(ann.body.as_ref().unwrap().contains("line two"));
    }

    #[test]
    fn compact_llm_document_scope() {
        let ann = parse_one(r"<!--- llm \d | summarize the document --->");
        assert_eq!(ann.annotation_type, AnnotationType::Llm);
        assert_eq!(ann.scope, Scope::Document);
        assert_eq!(ann.body, Some("summarize the document".to_string()));
    }

    #[test]
    fn compact_llm_section_scope() {
        let ann = parse_one(r"<!--- llm \h | summarize this section --->");
        assert_eq!(ann.annotation_type, AnnotationType::Llm);
        assert_eq!(ann.scope, Scope::Section);
    }

    #[test]
    fn compact_asymmetric_paragraph() {
        let ann = parse_one(r"<!--- n 3\p1 | asymmetric --->");
        assert_eq!(ann.scope, Scope::Asymmetric {
            unit: ScopeKind::Paragraph, before: 3, after: 1,
        });
    }

    #[test]
    fn compact_asymmetric_word() {
        let ann = parse_one("<!--- n 2_3 | words --->");
        assert_eq!(ann.scope, Scope::Asymmetric {
            unit: ScopeKind::Word, before: 2, after: 3,
        });
    }

    #[test]
    fn block_llm_section() {
        let ann = parse_one("<!---\nllm\n\\h\n---\nAI section summary.\n--->");
        assert_eq!(ann.annotation_type, AnnotationType::Llm);
        assert_eq!(ann.scope, Scope::Section);
    }

    #[test]
    fn block_asymmetric_sentence() {
        let ann = parse_one("<!---\nn\n2\\s1\n---\nNote body.\n--->");
        assert_eq!(ann.scope, Scope::Asymmetric {
            unit: ScopeKind::Sentence, before: 2, after: 1,
        });
    }

    #[test]
    fn compact_with_id_round_trip() {
        let ann = parse_one("<!---[abc-123] n? __ | body --->");
        assert_eq!(ann.uuid, Some("abc-123".to_string()));
        assert_eq!(ann.annotation_type, AnnotationType::Note);
        assert_eq!(ann.certainty, Certainty::Tentative);
        assert_eq!(ann.scope, Scope::Words(2));
        assert_eq!(ann.body, Some("body".to_string()));
        assert_eq!(ann.form, AnnotationForm::Compact);
    }

    #[test]
    fn compact_without_id_round_trip() {
        let ann = parse_one("<!--- n? __ | body --->");
        assert_eq!(ann.uuid, None);
        assert_eq!(ann.annotation_type, AnnotationType::Note);
        assert_eq!(ann.certainty, Certainty::Tentative);
        assert_eq!(ann.scope, Scope::Words(2));
        assert_eq!(ann.body, Some("body".to_string()));
    }

    #[test]
    fn compact_with_lang_round_trip() {
        let ann = parse_one(r"<!--- n? \ss lang=fr | même sens ? @2026-07 --->");
        assert_eq!(ann.annotation_type, AnnotationType::Note);
        assert_eq!(ann.certainty, Certainty::Tentative);
        assert_eq!(ann.scope, Scope::Sentence(2));
        assert_eq!(ann.lang, Some("fr".to_string()));
        assert_eq!(ann.body, Some("même sens ?".to_string()));
        assert_eq!(ann.date, Some("2026-07".to_string()));
        assert_eq!(ann.form, AnnotationForm::Compact);
    }

    #[test]
    fn compact_with_lang_no_body_round_trip() {
        let ann = parse_one("<!--- tr _ lang=ja --->");
        assert_eq!(ann.annotation_type, AnnotationType::Translation);
        assert_eq!(ann.scope, Scope::Words(1));
        assert_eq!(ann.lang, Some("ja".to_string()));
        assert_eq!(ann.body, None);
    }

    #[test]
    fn compact_without_lang_round_trip() {
        let ann = parse_one(r"<!--- n \s | a note --->");
        assert_eq!(ann.lang, None);
    }

    #[test]
    fn block_with_lang_round_trip() {
        let ann = parse_one("<!---\nn!\n\\p\nlang: fr\n@2026-03-28\n---\nLe corps.\n--->");
        assert_eq!(ann.annotation_type, AnnotationType::Note);
        assert_eq!(ann.certainty, Certainty::Firm);
        assert_eq!(ann.scope, Scope::Paragraph(1));
        assert_eq!(ann.lang, Some("fr".to_string()));
        assert_eq!(ann.date, Some("2026-03-28".to_string()));
        assert_eq!(ann.body, Some("Le corps.".to_string()));
        assert_eq!(ann.form, AnnotationForm::Block);
    }

    #[test]
    fn block_with_uuid_and_lang_round_trip() {
        let ann = parse_one(
            "<!---[550e8400-e29b-41d4-a716-446655440000]\nq?\nlang: zh-Hant\n---\n本文\n--->",
        );
        assert_eq!(ann.uuid, Some("550e8400-e29b-41d4-a716-446655440000".to_string()));
        assert_eq!(ann.annotation_type, AnnotationType::Question);
        assert_eq!(ann.lang, Some("zh-hant".to_string()));
        assert_eq!(ann.body, Some("本文".to_string()));
    }

    #[test]
    fn block_with_uuid_id_round_trip() {
        let ann = parse_one("<!---[550e8400-e29b-41d4-a716-446655440000]\nn!\n\\p\n@2026-03-28\n---\nThe body.\n--->");
        assert_eq!(ann.uuid, Some("550e8400-e29b-41d4-a716-446655440000".to_string()));
        assert_eq!(ann.annotation_type, AnnotationType::Note);
        assert_eq!(ann.certainty, Certainty::Firm);
        assert_eq!(ann.scope, Scope::Paragraph(1));
        assert_eq!(ann.date, Some("2026-03-28".to_string()));
        assert_eq!(ann.body, Some("The body.".to_string()));
        assert_eq!(ann.form, AnnotationForm::Block);
    }
}
