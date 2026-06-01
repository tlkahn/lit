use super::types::Annotation;
use super::scanner::scan_annotations;
use super::compact::parse_compact;
use super::block::{is_block_form, parse_block};

pub fn parse_annotations(content: &str) -> Vec<Annotation> {
    let raw_annotations = scan_annotations(content);
    let mut annotations = Vec::with_capacity(raw_annotations.len());

    for ra in raw_annotations {
        let mut ann = if is_block_form(&ra.inner) {
            parse_block(&ra.inner)
        } else {
            parse_compact(&ra.inner)
        };

        ann.char_start = ra.char_start;
        ann.char_end = ra.char_end;
        ann.original = ra.original;
        if ra.id.is_some() {
            ann.uuid = ra.id;
        }

        annotations.push(ann);
    }

    annotations
}

#[cfg(test)]
mod tests {
    use super::*;
    use super::super::types::*;

    #[test]
    fn single_compact_annotation() {
        let doc = "The term *anuttara*<!--- n? __ | same sense as TĀ 3.68? @2026-03 ---> appears.";
        let anns = parse_annotations(doc);
        assert_eq!(anns.len(), 1);
        assert_eq!(anns[0].annotation_type, AnnotationType::Note);
        assert_eq!(anns[0].certainty, Certainty::Tentative);
        assert_eq!(anns[0].scope, Scope::Words(2));
        assert_eq!(anns[0].body, Some("same sense as TĀ 3.68?".to_string()));
        assert_eq!(anns[0].date, Some("2026-03".to_string()));
        assert_eq!(anns[0].form, AnnotationForm::Compact);
        assert!(anns[0].char_start > 0);
        assert!(anns[0].char_end > anns[0].char_start);
    }

    #[test]
    fn single_block_annotation() {
        let doc = "Text before.\n<!---\nn!\n\\p\n@2026-03-28\n---\nThe body.\n--->\nText after.";
        let anns = parse_annotations(doc);
        assert_eq!(anns.len(), 1);
        assert_eq!(anns[0].annotation_type, AnnotationType::Note);
        assert_eq!(anns[0].certainty, Certainty::Firm);
        assert_eq!(anns[0].scope, Scope::Paragraph(1));
        assert_eq!(anns[0].form, AnnotationForm::Block);
        assert_eq!(anns[0].body, Some("The body.".to_string()));
    }

    #[test]
    fn mixed_compact_and_block() {
        let doc = "<!--- n: | inline note --->\n\nParagraph.\n\n<!---\ncf\n---\nBlock crossref.\n--->";
        let anns = parse_annotations(doc);
        assert_eq!(anns.len(), 2);
        assert_eq!(anns[0].form, AnnotationForm::Compact);
        assert_eq!(anns[0].annotation_type, AnnotationType::Note);
        assert_eq!(anns[1].form, AnnotationForm::Block);
        assert_eq!(anns[1].annotation_type, AnnotationType::CrossRef);
    }

    #[test]
    fn bare_annotation() {
        let doc = "text<!--- compare Vasugupta SpK 1.1 --->more";
        let anns = parse_annotations(doc);
        assert_eq!(anns.len(), 1);
        assert_eq!(anns[0].annotation_type, AnnotationType::Bare);
        assert_eq!(anns[0].body, Some("compare Vasugupta SpK 1.1".to_string()));
    }

    #[test]
    fn skip_code_fenced_annotations() {
        let doc = "```\n<!--- skip --->\n```\n<!--- q? | keep --->";
        let anns = parse_annotations(doc);
        assert_eq!(anns.len(), 1);
        assert_eq!(anns[0].annotation_type, AnnotationType::Question);
    }

    #[test]
    fn no_annotations() {
        assert_eq!(parse_annotations("no annotations here").len(), 0);
    }

    #[test]
    fn ordering_by_position() {
        let doc = "<!--- a ---> middle <!--- b --->";
        let anns = parse_annotations(doc);
        assert_eq!(anns.len(), 2);
        assert!(anns[0].char_start < anns[1].char_start);
    }

    #[test]
    fn original_preserved() {
        let doc = "<!--- todo! | fix this --->";
        let anns = parse_annotations(doc);
        assert_eq!(anns[0].original, "<!--- todo! | fix this --->");
    }

    #[test]
    fn utf16_offsets_with_cjk() {
        let doc = "你好<!--- n: | 注释 --->";
        let anns = parse_annotations(doc);
        assert_eq!(anns[0].char_start, 2);
        assert_eq!(anns[0].body, Some("注释".to_string()));
    }

    #[test]
    fn apparatus_type_integration() {
        let doc = "<!--- app: | variant: ms. B has *prakāśa* --->";
        let anns = parse_annotations(doc);
        assert_eq!(anns[0].annotation_type, AnnotationType::Apparatus);
    }

    #[test]
    fn translation_type_integration() {
        let doc = "<!--- tr: _ | cf. Tibetan version @2026-03 --->";
        let anns = parse_annotations(doc);
        assert_eq!(anns.len(), 1);
        assert_eq!(anns[0].annotation_type, AnnotationType::Translation);
        assert_eq!(anns[0].scope, Scope::Words(1));
        assert_eq!(anns[0].body, Some("cf. Tibetan version".to_string()));
        assert_eq!(anns[0].date, Some("2026-03".to_string()));
    }

    #[test]
    fn page_scope_compact_integration() {
        let doc = r"<!--- n: \f | page-level note --->";
        let anns = parse_annotations(doc);
        assert_eq!(anns.len(), 1);
        assert_eq!(anns[0].scope, Scope::Page(1));
    }

    #[test]
    fn page_scope_block_integration() {
        let doc = "<!---\ncf\n\\ff\n---\nTwo pages.\n--->";
        let anns = parse_annotations(doc);
        assert_eq!(anns.len(), 1);
        assert_eq!(anns[0].scope, Scope::Page(2));
    }

    #[test]
    fn underscore_suffix_scope_integration() {
        let doc = r"<!--- n: \p__ | two paragraphs --->";
        let anns = parse_annotations(doc);
        assert_eq!(anns[0].scope, Scope::Paragraph(2));
        let doc2 = r"<!--- n: \pp | two paragraphs --->";
        let anns2 = parse_annotations(doc2);
        assert_eq!(anns[0].scope, anns2[0].scope);
    }

    #[test]
    fn plain_percent_comments_not_matched() {
        let doc = "<!-- normal --> <!--- real --->";
        let anns = parse_annotations(doc);
        assert_eq!(anns.len(), 1);
        assert_eq!(anns[0].inner_check(), true);
    }

    #[test]
    fn compact_with_id_populates_uuid() {
        let doc = "<!---[abc-123] n? __ | body --->";
        let anns = parse_annotations(doc);
        assert_eq!(anns.len(), 1);
        assert_eq!(anns[0].uuid, Some("abc-123".to_string()));
        assert_eq!(anns[0].annotation_type, AnnotationType::Note);
        assert_eq!(anns[0].certainty, Certainty::Tentative);
    }

    #[test]
    fn compact_without_id_uuid_is_none() {
        let doc = "<!--- n? __ | body --->";
        let anns = parse_annotations(doc);
        assert_eq!(anns.len(), 1);
        assert_eq!(anns[0].uuid, None);
    }

    #[test]
    fn block_with_id_populates_uuid() {
        let doc = "<!---[my-uuid]\nn!\n\\p\n---\nThe body.\n--->";
        let anns = parse_annotations(doc);
        assert_eq!(anns.len(), 1);
        assert_eq!(anns[0].uuid, Some("my-uuid".to_string()));
        assert_eq!(anns[0].form, AnnotationForm::Block);
    }

    #[test]
    fn multiple_annotations_with_blocks_and_compact() {
        let doc = "\
First paragraph.<!--- n: _ | marginal note @2026-03 --->

<!---
todo!
\\p
@2026-03-28
---
Need to verify this claim.
--->

Second paragraph.<!--- cf \\pp --->
";
        let anns = parse_annotations(doc);
        assert_eq!(anns.len(), 3);
        assert_eq!(anns[0].annotation_type, AnnotationType::Note);
        assert_eq!(anns[0].form, AnnotationForm::Compact);
        assert_eq!(anns[1].annotation_type, AnnotationType::Todo);
        assert_eq!(anns[1].form, AnnotationForm::Block);
        assert_eq!(anns[2].annotation_type, AnnotationType::CrossRef);
        assert_eq!(anns[2].form, AnnotationForm::Compact);
    }
}

#[cfg(test)]
impl Annotation {
    fn inner_check(&self) -> bool {
        !self.original.is_empty()
    }
}
