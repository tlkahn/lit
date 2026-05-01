use crate::annotation::parser::parse_annotations as do_parse;
use crate::annotation::scope_resolver::resolve_scope_range;
use crate::annotation::types::{Annotation, Scope, ScopeRange};

#[tauri::command]
pub fn parse_annotations(content: String) -> Vec<Annotation> {
    do_parse(&content)
}

#[tauri::command]
pub fn resolve_annotation_scope(
    content: String,
    char_start: usize,
    scope: Scope,
    lang: String,
) -> Option<ScopeRange> {
    resolve_scope_range(&content, char_start, &scope, &lang)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::annotation::types::AnnotationType;

    #[test]
    fn cmd_parse_annotations_compact() {
        let result = parse_annotations("%%! n: | note %%".to_string());
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].annotation_type, AnnotationType::Note);
    }

    #[test]
    fn cmd_parse_annotations_empty() {
        let result = parse_annotations(String::new());
        assert!(result.is_empty());
    }

    #[test]
    fn cmd_resolve_scope_words() {
        let content = "hello world %%! n: _ | note %%".to_string();
        let result = resolve_annotation_scope(
            content,
            12,
            Scope::Words(1),
            "en".to_string(),
        );
        assert!(result.is_some());
        assert_eq!(result.unwrap(), ScopeRange { start: 6, end: 11 });
    }

    #[test]
    fn cmd_resolve_scope_none() {
        let content = "%%! n: _ | note %%".to_string();
        let result = resolve_annotation_scope(
            content,
            0,
            Scope::Words(1),
            "en".to_string(),
        );
        assert_eq!(result, None);
    }
}
