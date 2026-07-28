use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AnnotationType {
    Note,
    Question,
    Todo,
    CrossRef,
    Apparatus,
    Translation,
    Llm,
    Thread,
    SlipNote,
    Mark,
    Bare,
}

impl AnnotationType {
    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            "n" => Some(Self::Note),
            "q" => Some(Self::Question),
            "todo" => Some(Self::Todo),
            "cf" => Some(Self::CrossRef),
            "app" => Some(Self::Apparatus),
            "tr" => Some(Self::Translation),
            "llm" => Some(Self::Llm),
            "th" => Some(Self::Thread),
            "sn" => Some(Self::SlipNote),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Certainty {
    Tentative,
    Firm,
    Neutral,
}

impl Certainty {
    pub fn from_char(c: char) -> Self {
        match c {
            '?' => Self::Tentative,
            '!' => Self::Firm,
            _ => Self::Neutral,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ScopeKind {
    Word,
    Sentence,
    Paragraph,
    Page,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "value", rename_all = "snake_case")]
pub enum Scope {
    Words(usize),
    Paragraph(usize),
    Page(usize),
    Sentence(usize),
    Anchor(String),
    Document,
    Section,
    Asymmetric {
        unit: ScopeKind,
        before: usize,
        after: usize,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum ResolutionMode {
    #[default]
    Backward,
    Bidirectional,
}

impl Scope {
    pub fn try_parse(s: &str) -> Option<Self> {
        if !s.is_empty() && s.starts_with('_') && s.chars().all(|c| c == '_') {
            Some(Self::Words(s.len()))
        } else if s.starts_with(r"\p") {
            let rest = &s[2..];
            if rest.is_empty() || rest.chars().all(|c| c == 'p') {
                Some(Self::Paragraph(1 + rest.len()))
            } else if rest.chars().all(|c| c == '_') {
                Some(Self::Paragraph(rest.len()))
            } else {
                None
            }
        } else if s.starts_with(r"\f") {
            let rest = &s[2..];
            if rest.is_empty() || rest.chars().all(|c| c == 'f') {
                Some(Self::Page(1 + rest.len()))
            } else if rest.chars().all(|c| c == '_') {
                Some(Self::Page(rest.len()))
            } else {
                None
            }
        } else if s.starts_with(r"\s") {
            let rest = &s[2..];
            if rest.is_empty() || rest.chars().all(|c| c == 's') {
                Some(Self::Sentence(1 + rest.len()))
            } else if rest.chars().all(|c| c == '_') {
                Some(Self::Sentence(rest.len()))
            } else {
                None
            }
        } else if s == r"\d" {
            Some(Self::Document)
        } else if s == r"\h" {
            Some(Self::Section)
        } else {
            Self::try_parse_asymmetric(s)
        }
    }

    fn try_parse_asymmetric(s: &str) -> Option<Scope> {
        let bytes = s.as_bytes();
        let before_end = bytes.iter().position(|b| !b.is_ascii_digit())?;
        if before_end == 0 {
            return None;
        }
        let before: usize = s[..before_end].parse().ok()?;
        let rest = &s[before_end..];

        if let Some(after_str) = rest.strip_prefix('_') {
            if !after_str.is_empty() && after_str.bytes().all(|b| b.is_ascii_digit()) {
                let after: usize = after_str.parse().ok()?;
                return Some(Scope::Asymmetric {
                    unit: ScopeKind::Word,
                    before,
                    after,
                });
            }
        }

        if rest.len() >= 2 && rest.as_bytes()[0] == b'\\' {
            let unit = match rest.as_bytes()[1] {
                b'p' => ScopeKind::Paragraph,
                b's' => ScopeKind::Sentence,
                b'f' => ScopeKind::Page,
                _ => return None,
            };
            let after_str = &rest[2..];
            if !after_str.is_empty() && after_str.bytes().all(|b| b.is_ascii_digit()) {
                let after: usize = after_str.parse().ok()?;
                return Some(Scope::Asymmetric {
                    unit,
                    before,
                    after,
                });
            }
        }
        None
    }

    pub fn from_str(s: &str) -> Self {
        Self::try_parse(s).unwrap_or(Self::Sentence(1))
    }

    pub fn from_db(scope_kind: &str, scope_value: &str) -> Option<Self> {
        match scope_kind {
            "words" => scope_value.parse::<usize>().ok().map(Self::Words),
            "sentence" => scope_value.parse::<usize>().ok().map(Self::Sentence),
            "paragraph" => scope_value.parse::<usize>().ok().map(Self::Paragraph),
            "page" => scope_value.parse::<usize>().ok().map(Self::Page),
            "anchor" => Some(Self::Anchor(scope_value.to_string())),
            "document" => Some(Self::Document),
            "section" => Some(Self::Section),
            k if k.starts_with("asymmetric_") => {
                let unit = match &k["asymmetric_".len()..] {
                    "word" => ScopeKind::Word,
                    "sentence" => ScopeKind::Sentence,
                    "paragraph" => ScopeKind::Paragraph,
                    "page" => ScopeKind::Page,
                    _ => return None,
                };
                let (before_s, after_s) = scope_value.split_once(':')?;
                let before = before_s.parse::<usize>().ok()?;
                let after = after_s.parse::<usize>().ok()?;
                Some(Self::Asymmetric { unit, before, after })
            }
            _ => None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AnnotationForm {
    Compact,
    Block,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Annotation {
    pub form: AnnotationForm,
    pub annotation_type: AnnotationType,
    pub certainty: Certainty,
    pub scope: Scope,
    pub body: Option<String>,
    pub date: Option<String>,
    pub is_structured: bool,
    pub char_start: usize,
    pub char_end: usize,
    pub original: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub uuid: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mark: Option<String>,
    /// Annotation-scope segmentation language, the highest-precedence input to
    /// [`crate::annotation::lang::effective_lang`]. `None` means "inherit"
    /// (document frontmatter, then the global preference).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub lang: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ScopeRange {
    pub start: usize,
    pub end: usize,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn annotation_type_note() {
        assert_eq!(AnnotationType::from_str("n"), Some(AnnotationType::Note));
    }

    #[test]
    fn annotation_type_question() {
        assert_eq!(AnnotationType::from_str("q"), Some(AnnotationType::Question));
    }

    #[test]
    fn annotation_type_todo() {
        assert_eq!(AnnotationType::from_str("todo"), Some(AnnotationType::Todo));
    }

    #[test]
    fn annotation_type_crossref() {
        assert_eq!(AnnotationType::from_str("cf"), Some(AnnotationType::CrossRef));
    }

    #[test]
    fn annotation_type_apparatus() {
        assert_eq!(AnnotationType::from_str("app"), Some(AnnotationType::Apparatus));
    }

    #[test]
    fn annotation_type_translation() {
        assert_eq!(AnnotationType::from_str("tr"), Some(AnnotationType::Translation));
    }

    #[test]
    fn annotation_type_unknown() {
        assert_eq!(AnnotationType::from_str("xyz"), None);
        assert_eq!(AnnotationType::from_str(""), None);
        assert_eq!(AnnotationType::from_str("N"), None);
    }

    #[test]
    fn certainty_tentative() {
        assert_eq!(Certainty::from_char('?'), Certainty::Tentative);
    }

    #[test]
    fn certainty_firm() {
        assert_eq!(Certainty::from_char('!'), Certainty::Firm);
    }

    #[test]
    fn certainty_neutral_colon() {
        assert_eq!(Certainty::from_char(':'), Certainty::Neutral);
    }

    #[test]
    fn certainty_neutral_other() {
        assert_eq!(Certainty::from_char('x'), Certainty::Neutral);
    }

    #[test]
    fn scope_one_word() {
        assert_eq!(Scope::from_str("_"), Scope::Words(1));
    }

    #[test]
    fn scope_three_words() {
        assert_eq!(Scope::from_str("___"), Scope::Words(3));
    }

    #[test]
    fn scope_paragraph() {
        assert_eq!(Scope::from_str(r"\p"), Scope::Paragraph(1));
    }

    #[test]
    fn scope_paragraph_two() {
        assert_eq!(Scope::from_str(r"\pp"), Scope::Paragraph(2));
    }

    #[test]
    fn scope_paragraph_three() {
        assert_eq!(Scope::from_str(r"\ppp"), Scope::Paragraph(3));
    }

    #[test]
    fn scope_paragraph_underscore_suffix() {
        assert_eq!(Scope::from_str(r"\p__"), Scope::Paragraph(2));
        assert_eq!(Scope::from_str(r"\p___"), Scope::Paragraph(3));
    }

    #[test]
    fn scope_paragraph_underscore_one() {
        assert_eq!(Scope::from_str(r"\p_"), Scope::Paragraph(1));
    }

    #[test]
    fn scope_page() {
        assert_eq!(Scope::from_str(r"\f"), Scope::Page(1));
    }

    #[test]
    fn scope_page_two() {
        assert_eq!(Scope::from_str(r"\ff"), Scope::Page(2));
    }

    #[test]
    fn scope_page_three() {
        assert_eq!(Scope::from_str(r"\fff"), Scope::Page(3));
    }

    #[test]
    fn scope_page_underscore_suffix() {
        assert_eq!(Scope::from_str(r"\f__"), Scope::Page(2));
        assert_eq!(Scope::from_str(r"\f___"), Scope::Page(3));
    }

    #[test]
    fn scope_sentence() {
        assert_eq!(Scope::from_str(r"\s"), Scope::Sentence(1));
    }

    #[test]
    fn scope_sentence_two() {
        assert_eq!(Scope::from_str(r"\ss"), Scope::Sentence(2));
    }

    #[test]
    fn scope_sentence_three() {
        assert_eq!(Scope::from_str(r"\sss"), Scope::Sentence(3));
    }

    #[test]
    fn scope_sentence_underscore_suffix() {
        assert_eq!(Scope::from_str(r"\s__"), Scope::Sentence(2));
        assert_eq!(Scope::from_str(r"\s___"), Scope::Sentence(3));
    }

    #[test]
    fn scope_sentence_underscore_one() {
        assert_eq!(Scope::from_str(r"\s_"), Scope::Sentence(1));
    }

    #[test]
    fn scope_equivalences() {
        assert_eq!(Scope::from_str(r"\p__"), Scope::from_str(r"\pp"));
        assert_eq!(Scope::from_str(r"\f___"), Scope::from_str(r"\fff"));
        assert_eq!(Scope::from_str(r"\s__"), Scope::from_str(r"\ss"));
    }

    #[test]
    fn scope_unrecognized_defaults_sentence() {
        assert_eq!(Scope::from_str("unknown"), Scope::Sentence(1));
        assert_eq!(Scope::from_str(r"\pf"), Scope::Sentence(1));
        assert_eq!(Scope::from_str(r"\fp"), Scope::Sentence(1));
    }

    #[test]
    fn annotation_type_llm() {
        assert_eq!(AnnotationType::from_str("llm"), Some(AnnotationType::Llm));
    }

    #[test]
    fn annotation_type_thread() {
        assert_eq!(AnnotationType::from_str("th"), Some(AnnotationType::Thread));
    }

    #[test]
    fn annotation_type_thread_word_does_not_map() {
        assert_eq!(AnnotationType::from_str("thread"), None);
    }

    #[test]
    fn thread_annotation_type_serializes_lowercase() {
        let json = serde_json::to_string(&AnnotationType::Thread).unwrap();
        assert_eq!(json, "\"thread\"");
        let parsed: AnnotationType = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed, AnnotationType::Thread);
    }

    #[test]
    fn annotation_type_slipnote() {
        assert_eq!(AnnotationType::from_str("sn"), Some(AnnotationType::SlipNote));
    }

    #[test]
    fn annotation_type_slipnote_word_does_not_map() {
        assert_eq!(AnnotationType::from_str("slipnote"), None);
    }

    #[test]
    fn slipnote_annotation_type_serializes_lowercase() {
        let json = serde_json::to_string(&AnnotationType::SlipNote).unwrap();
        assert_eq!(json, "\"slipnote\"");
        let parsed: AnnotationType = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed, AnnotationType::SlipNote);
    }

    #[test]
    fn scope_document_parse() {
        assert_eq!(Scope::try_parse(r"\d"), Some(Scope::Document));
    }

    #[test]
    fn scope_document_from_str() {
        assert_eq!(Scope::from_str(r"\d"), Scope::Document);
    }

    #[test]
    fn scope_document_serde() {
        let scope = Scope::Document;
        let json = serde_json::to_string(&scope).unwrap();
        let parsed: Scope = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed, Scope::Document);
    }

    #[test]
    fn scope_section_parse() {
        assert_eq!(Scope::try_parse(r"\h"), Some(Scope::Section));
    }

    #[test]
    fn scope_section_serde() {
        let scope = Scope::Section;
        let json = serde_json::to_string(&scope).unwrap();
        let parsed: Scope = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed, Scope::Section);
    }

    #[test]
    fn scope_asymmetric_paragraph_parse() {
        assert_eq!(
            Scope::try_parse(r"3\p1"),
            Some(Scope::Asymmetric { unit: ScopeKind::Paragraph, before: 3, after: 1 })
        );
    }

    #[test]
    fn scope_asymmetric_sentence_parse() {
        assert_eq!(
            Scope::try_parse(r"0\s2"),
            Some(Scope::Asymmetric { unit: ScopeKind::Sentence, before: 0, after: 2 })
        );
    }

    #[test]
    fn scope_asymmetric_word_parse() {
        assert_eq!(
            Scope::try_parse("3_1"),
            Some(Scope::Asymmetric { unit: ScopeKind::Word, before: 3, after: 1 })
        );
    }

    #[test]
    fn scope_asymmetric_page_parse() {
        assert_eq!(
            Scope::try_parse(r"2\f0"),
            Some(Scope::Asymmetric { unit: ScopeKind::Page, before: 2, after: 0 })
        );
    }

    #[test]
    fn scope_asymmetric_serde_roundtrip() {
        let scope = Scope::Asymmetric { unit: ScopeKind::Paragraph, before: 3, after: 1 };
        let json = serde_json::to_string(&scope).unwrap();
        let parsed: Scope = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed, scope);
    }

    #[test]
    fn resolution_mode_serde() {
        let mode = ResolutionMode::Backward;
        let json = serde_json::to_string(&mode).unwrap();
        assert_eq!(serde_json::from_str::<ResolutionMode>(&json).unwrap(), ResolutionMode::Backward);

        let bidir = ResolutionMode::Bidirectional;
        let json2 = serde_json::to_string(&bidir).unwrap();
        assert_eq!(serde_json::from_str::<ResolutionMode>(&json2).unwrap(), ResolutionMode::Bidirectional);
    }

    #[test]
    fn scope_existing_variants_still_parse() {
        assert_eq!(Scope::try_parse("_"), Some(Scope::Words(1)));
        assert_eq!(Scope::try_parse("___"), Some(Scope::Words(3)));
        assert_eq!(Scope::try_parse(r"\p"), Some(Scope::Paragraph(1)));
        assert_eq!(Scope::try_parse(r"\pp"), Some(Scope::Paragraph(2)));
        assert_eq!(Scope::try_parse(r"\f"), Some(Scope::Page(1)));
        assert_eq!(Scope::try_parse(r"\s"), Some(Scope::Sentence(1)));
        assert_eq!(Scope::try_parse("unknown"), None);
    }

    #[test]
    fn annotation_serde_roundtrip() {
        let ann = Annotation {
            form: AnnotationForm::Compact,
            annotation_type: AnnotationType::Note,
            certainty: Certainty::Tentative,
            scope: Scope::Words(2),
            body: Some("a note".to_string()),
            date: Some("2026-03".to_string()),
            is_structured: true,
            char_start: 10,
            char_end: 50,
            original: "<!--- n? __ | a note @2026-03 --->".to_string(),
            uuid: None,
            mark: None,
            lang: None,
        };
        let json = serde_json::to_string(&ann).unwrap();
        let parsed: Annotation = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.annotation_type, AnnotationType::Note);
        assert_eq!(parsed.certainty, Certainty::Tentative);
        assert_eq!(parsed.scope, Scope::Words(2));
        assert_eq!(parsed.body, Some("a note".to_string()));
        assert_eq!(parsed.date, Some("2026-03".to_string()));
        assert_eq!(parsed.is_structured, true);
    }

    #[test]
    fn scope_serde_tagged() {
        let scope = Scope::Anchor("8th century".to_string());
        let json = serde_json::to_string(&scope).unwrap();
        let parsed: Scope = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed, scope);

        let scope_adj = Scope::Sentence(1);
        let json_adj = serde_json::to_string(&scope_adj).unwrap();
        let parsed_adj: Scope = serde_json::from_str(&json_adj).unwrap();
        assert_eq!(parsed_adj, Scope::Sentence(1));

        let scope_words = Scope::Words(3);
        let json_words = serde_json::to_string(&scope_words).unwrap();
        let parsed_words: Scope = serde_json::from_str(&json_words).unwrap();
        assert_eq!(parsed_words, Scope::Words(3));

        let scope_para = Scope::Paragraph(2);
        let json_para = serde_json::to_string(&scope_para).unwrap();
        let parsed_para: Scope = serde_json::from_str(&json_para).unwrap();
        assert_eq!(parsed_para, Scope::Paragraph(2));

        let scope_page = Scope::Page(3);
        let json_page = serde_json::to_string(&scope_page).unwrap();
        let parsed_page: Scope = serde_json::from_str(&json_page).unwrap();
        assert_eq!(parsed_page, Scope::Page(3));

        let scope_sent = Scope::Sentence(2);
        let json_sent = serde_json::to_string(&scope_sent).unwrap();
        let parsed_sent: Scope = serde_json::from_str(&json_sent).unwrap();
        assert_eq!(parsed_sent, Scope::Sentence(2));
    }

    #[test]
    fn annotation_json_omits_uuid_when_none() {
        let ann = Annotation {
            form: AnnotationForm::Compact,
            annotation_type: AnnotationType::Note,
            certainty: Certainty::Neutral,
            scope: Scope::Sentence(1),
            body: None,
            date: None,
            is_structured: false,
            char_start: 0,
            char_end: 10,
            original: "<!---: n --->".to_string(),
            uuid: None,
            mark: None,
            lang: None,
        };
        let json = serde_json::to_string(&ann).unwrap();
        assert!(!json.contains("uuid"), "JSON should omit uuid when None, got: {json}");
    }

    #[test]
    fn annotation_json_includes_uuid_when_some() {
        let ann = Annotation {
            form: AnnotationForm::Compact,
            annotation_type: AnnotationType::Note,
            certainty: Certainty::Neutral,
            scope: Scope::Sentence(1),
            body: None,
            date: None,
            is_structured: false,
            char_start: 0,
            char_end: 10,
            original: "<!---: n --->".to_string(),
            uuid: Some("abc".to_string()),
            mark: None,
            lang: None,
        };
        let json = serde_json::to_string(&ann).unwrap();
        assert!(json.contains(r#""uuid":"abc""#), "JSON should include uuid when Some, got: {json}");
        let parsed: Annotation = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.uuid, Some("abc".to_string()));
    }

    #[test]
    fn annotation_scanner_id_takes_precedence_in_json() {
        let ann = Annotation {
            form: AnnotationForm::Compact,
            annotation_type: AnnotationType::Note,
            certainty: Certainty::Neutral,
            scope: Scope::Sentence(1),
            body: Some("test".to_string()),
            date: None,
            is_structured: true,
            char_start: 0,
            char_end: 10,
            original: "<!---[scanner-id] n | test --->".to_string(),
            uuid: Some("scanner-id".to_string()),
            mark: None,
            lang: None,
        };
        let json = serde_json::to_string(&ann).unwrap();
        assert!(json.contains(r#""uuid":"scanner-id""#), "JSON should contain scanner-id, got: {json}");
        let parsed: Annotation = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.uuid, Some("scanner-id".to_string()));
    }

    #[test]
    fn mark_annotation_type_serializes_lowercase() {
        let json = serde_json::to_string(&AnnotationType::Mark).unwrap();
        assert_eq!(json, "\"mark\"");
        let parsed: AnnotationType = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed, AnnotationType::Mark);
    }

    #[test]
    fn annotation_json_omits_mark_when_none() {
        let ann = Annotation {
            form: AnnotationForm::Compact,
            annotation_type: AnnotationType::Note,
            certainty: Certainty::Neutral,
            scope: Scope::Sentence(1),
            body: None,
            date: None,
            is_structured: false,
            char_start: 0,
            char_end: 10,
            original: "<!---: n --->".to_string(),
            uuid: None,
            mark: None,
            lang: None,
        };
        let json = serde_json::to_string(&ann).unwrap();
        assert!(!json.contains("\"mark\""), "JSON should omit mark when None, got: {json}");
    }

    #[test]
    fn annotation_json_includes_mark_when_some() {
        let ann = Annotation {
            form: AnnotationForm::Compact,
            annotation_type: AnnotationType::Mark,
            certainty: Certainty::Neutral,
            scope: Scope::Words(1),
            body: None,
            date: None,
            is_structured: true,
            char_start: 0,
            char_end: 10,
            original: "<!--- nb _ --->".to_string(),
            uuid: None,
            mark: Some("nb".to_string()),
            lang: None,
        };
        let json = serde_json::to_string(&ann).unwrap();
        assert!(json.contains(r#""mark":"nb""#), "JSON should include mark when Some, got: {json}");
        let parsed: Annotation = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.mark, Some("nb".to_string()));
    }

    #[test]
    fn from_str_does_not_map_mark_codes() {
        assert_eq!(AnnotationType::from_str("nb"), None);
        assert_eq!(AnnotationType::from_str("mark"), None);
    }

    #[test]
    fn scope_from_db_words() {
        assert_eq!(Scope::from_db("words", "3"), Some(Scope::Words(3)));
    }

    #[test]
    fn scope_from_db_sentence() {
        assert_eq!(Scope::from_db("sentence", "1"), Some(Scope::Sentence(1)));
    }

    #[test]
    fn scope_from_db_paragraph() {
        assert_eq!(Scope::from_db("paragraph", "2"), Some(Scope::Paragraph(2)));
    }

    #[test]
    fn scope_from_db_page() {
        assert_eq!(Scope::from_db("page", "1"), Some(Scope::Page(1)));
    }

    #[test]
    fn scope_from_db_anchor() {
        assert_eq!(Scope::from_db("anchor", "text"), Some(Scope::Anchor("text".to_string())));
    }

    #[test]
    fn scope_from_db_document() {
        assert_eq!(Scope::from_db("document", ""), Some(Scope::Document));
    }

    #[test]
    fn scope_from_db_section() {
        assert_eq!(Scope::from_db("section", ""), Some(Scope::Section));
    }

    #[test]
    fn scope_from_db_asymmetric_word() {
        assert_eq!(
            Scope::from_db("asymmetric_word", "3:1"),
            Some(Scope::Asymmetric { unit: ScopeKind::Word, before: 3, after: 1 })
        );
    }

    #[test]
    fn scope_from_db_asymmetric_sentence() {
        assert_eq!(
            Scope::from_db("asymmetric_sentence", "0:2"),
            Some(Scope::Asymmetric { unit: ScopeKind::Sentence, before: 0, after: 2 })
        );
    }

    #[test]
    fn scope_from_db_unknown() {
        assert_eq!(Scope::from_db("unknown", "x"), None);
    }

    #[test]
    fn scope_from_db_invalid_value() {
        assert_eq!(Scope::from_db("words", "abc"), None);
    }
}
