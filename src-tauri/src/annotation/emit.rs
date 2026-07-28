use super::types::{AnnotationType, Certainty, Scope, ScopeKind};

pub struct EmitFields {
    pub id: Option<String>,
    pub annotation_type: AnnotationType,
    pub certainty: Certainty,
    pub scope: Scope,
    pub body: String,
    pub date: Option<String>,
}

fn serialize_type(t: &AnnotationType) -> &'static str {
    match t {
        AnnotationType::Note => "n",
        AnnotationType::Question => "q",
        AnnotationType::Todo => "todo",
        AnnotationType::CrossRef => "cf",
        AnnotationType::Apparatus => "app",
        AnnotationType::Translation => "tr",
        AnnotationType::Llm => "llm",
        AnnotationType::Thread => "th",
        AnnotationType::SlipNote => "sn",
        AnnotationType::Mark => "",
        AnnotationType::Bare => "",
    }
}

fn serialize_certainty(c: &Certainty) -> &'static str {
    match c {
        Certainty::Tentative => "?",
        Certainty::Firm => "!",
        Certainty::Neutral => "",
    }
}

fn serialize_scope(scope: &Scope) -> String {
    match scope {
        Scope::Words(n) => "_".repeat(*n),
        Scope::Sentence(n) => {
            let mut s = String::from("\\s");
            for _ in 1..*n {
                s.push('s');
            }
            s
        }
        Scope::Paragraph(n) => {
            let mut s = String::from("\\p");
            for _ in 1..*n {
                s.push('p');
            }
            s
        }
        Scope::Page(n) => {
            let mut s = String::from("\\f");
            for _ in 1..*n {
                s.push('f');
            }
            s
        }
        Scope::Anchor(val) => {
            let escaped = val.replace('"', "\\\"");
            format!("^\"{}\"", escaped)
        }
        Scope::Document => "\\d".to_string(),
        Scope::Section => "\\h".to_string(),
        Scope::Asymmetric { unit, before, after } => {
            let u = match unit {
                ScopeKind::Word => return format!("{}_{}", before, after),
                ScopeKind::Sentence => "s",
                ScopeKind::Paragraph => "p",
                ScopeKind::Page => "f",
            };
            format!("{}\\{}{}", before, u, after)
        }
    }
}

pub fn emit_annotation(fields: &EmitFields) -> String {
    let type_str = serialize_type(&fields.annotation_type);
    let cert_str = serialize_certainty(&fields.certainty);
    let scope_str = serialize_scope(&fields.scope);
    let date_str = fields.date.as_ref().map(|d| format!("@{}", d)).unwrap_or_default();

    if fields.body.contains('\n') {
        return emit_block(fields, type_str, cert_str, &scope_str, &date_str);
    }

    emit_compact(fields, type_str, cert_str, &scope_str, &date_str)
}

fn emit_compact(
    fields: &EmitFields,
    type_str: &str,
    cert_str: &str,
    scope_str: &str,
    date_str: &str,
) -> String {
    let id_str = fields.id.as_ref().map(|id| format!("[{}]", id)).unwrap_or_default();
    let type_cert = format!("{}{}", type_str, cert_str);

    let mut header_parts = Vec::new();
    if !type_cert.is_empty() {
        header_parts.push(type_cert);
    }
    if !scope_str.is_empty() {
        header_parts.push(scope_str.to_string());
    }

    let mut tail_parts = Vec::new();
    if !fields.body.is_empty() {
        tail_parts.push(fields.body.clone());
    }
    if !date_str.is_empty() {
        tail_parts.push(date_str.to_string());
    }

    let tail_str = tail_parts.join(" ");

    let inner = if !header_parts.is_empty() && !fields.body.is_empty() {
        format!("{} | {}", header_parts.join(" "), tail_str)
    } else if !header_parts.is_empty() && !tail_str.is_empty() {
        format!("{} {}", header_parts.join(" "), tail_str)
    } else if !header_parts.is_empty() {
        header_parts.join(" ")
    } else {
        tail_str
    };

    if !id_str.is_empty() {
        format!("<!---{} {} --->", id_str, inner)
    } else {
        format!("<!--- {} --->", inner)
    }
}

fn emit_block(
    fields: &EmitFields,
    type_str: &str,
    cert_str: &str,
    scope_str: &str,
    date_str: &str,
) -> String {
    let mut lines = Vec::new();

    if let Some(ref id) = fields.id {
        lines.push(format!("<!---[{}]", id));
    } else {
        lines.push("<!---".to_string());
    }

    let type_cert = format!("{}{}", type_str, cert_str);
    if !type_cert.is_empty() {
        lines.push(type_cert);
    }
    if !scope_str.is_empty() {
        lines.push(scope_str.to_string());
    }
    if !date_str.is_empty() {
        lines.push(date_str.to_string());
    }

    if !fields.body.is_empty() {
        lines.push("---".to_string());
        lines.push(fields.body.clone());
    }

    lines.push("--->".to_string());
    lines.join("\n")
}

/// If `original` already contains an authored `[id]`, return that id and the
/// unchanged original. Otherwise inject `[uuid]` immediately after the opening
/// fence token and return the modified string.
pub fn ensure_authored_uuid(original: &str, uuid: &str) -> (String, bool) {
    if let Some(rest) = original.strip_prefix("<!---[") {
        if let Some(bracket_end) = rest.find(']') {
            let existing_id = &rest[..bracket_end];
            return (existing_id.to_string(), false);
        }
    }
    if let Some(rest) = original.strip_prefix("%%![") {
        if let Some(bracket_end) = rest.find(']') {
            let existing_id = &rest[..bracket_end];
            return (existing_id.to_string(), false);
        }
    }

    if let Some(rest) = original.strip_prefix("<!---") {
        let stamped = format!("<!---[{}]{}", uuid, rest);
        return (stamped, true);
    }
    if let Some(rest) = original.strip_prefix("%%!") {
        let stamped = format!("%%![{}]{}", uuid, rest);
        return (stamped, true);
    }

    (original.to_string(), false)
}

/// Convert a UTF-16 offset pair into byte offsets within `text`.
/// Returns `(byte_start, byte_end)`.
pub fn utf16_offsets_to_byte(text: &str, utf16_start: usize, utf16_end: usize) -> (usize, usize) {
    let mut utf16_pos = 0;
    let mut byte_start = text.len();
    let mut byte_end = text.len();
    let mut found_start = false;
    let mut found_end = false;

    for (byte_idx, ch) in text.char_indices() {
        if !found_start && utf16_pos >= utf16_start {
            byte_start = byte_idx;
            found_start = true;
        }
        if !found_end && utf16_pos >= utf16_end {
            byte_end = byte_idx;
            found_end = true;
            break;
        }
        utf16_pos += ch.len_utf16();
    }

    if !found_start {
        byte_start = text.len();
    }
    if !found_end {
        byte_end = text.len();
    }

    (byte_start, byte_end)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn emit_compact_slipnote() {
        let fields = EmitFields {
            id: Some("f0e1d2c3-0000-0000-0000-000000000000".to_string()),
            annotation_type: AnnotationType::SlipNote,
            certainty: Certainty::Neutral,
            scope: Scope::Anchor("parent-uuid".to_string()),
            body: "Compare with Braudel".to_string(),
            date: Some("2026-07-28".to_string()),
        };
        assert_eq!(
            emit_annotation(&fields),
            r#"<!---[f0e1d2c3-0000-0000-0000-000000000000] sn ^"parent-uuid" | Compare with Braudel @2026-07-28 --->"#
        );
    }

    #[test]
    fn emit_block_slipnote_multiline() {
        let fields = EmitFields {
            id: Some("f0e1d2c3-0000-0000-0000-000000000000".to_string()),
            annotation_type: AnnotationType::SlipNote,
            certainty: Certainty::Neutral,
            scope: Scope::Anchor("parent-uuid".to_string()),
            body: "Compare with Braudel.\n\nAlso see chapter 4.".to_string(),
            date: Some("2026-07-28".to_string()),
        };
        let expected = "<!---[f0e1d2c3-0000-0000-0000-000000000000]\nsn\n^\"parent-uuid\"\n@2026-07-28\n---\nCompare with Braudel.\n\nAlso see chapter 4.\n--->";
        assert_eq!(emit_annotation(&fields), expected);
    }

    #[test]
    fn emit_without_id() {
        let fields = EmitFields {
            id: None,
            annotation_type: AnnotationType::SlipNote,
            certainty: Certainty::Neutral,
            scope: Scope::Anchor("parent-uuid".to_string()),
            body: "a note".to_string(),
            date: None,
        };
        assert_eq!(
            emit_annotation(&fields),
            r#"<!--- sn ^"parent-uuid" | a note --->"#
        );
    }

    #[test]
    fn emit_neutral_certainty_omits_marker() {
        let fields = EmitFields {
            id: None,
            annotation_type: AnnotationType::Note,
            certainty: Certainty::Neutral,
            scope: Scope::Sentence(1),
            body: "hello".to_string(),
            date: None,
        };
        let dsl = emit_annotation(&fields);
        assert!(dsl.contains("n "), "Expected 'n ' in: {}", dsl);
        assert!(!dsl.contains("n?") && !dsl.contains("n!"), "Should not have certainty marker");
    }

    #[test]
    fn emit_tentative_certainty() {
        let fields = EmitFields {
            id: None,
            annotation_type: AnnotationType::Note,
            certainty: Certainty::Tentative,
            scope: Scope::Sentence(1),
            body: "maybe".to_string(),
            date: None,
        };
        let dsl = emit_annotation(&fields);
        assert!(dsl.contains("n?"), "Expected 'n?' in: {}", dsl);
    }

    #[test]
    fn emit_firm_certainty() {
        let fields = EmitFields {
            id: None,
            annotation_type: AnnotationType::Note,
            certainty: Certainty::Firm,
            scope: Scope::Sentence(1),
            body: "sure".to_string(),
            date: None,
        };
        let dsl = emit_annotation(&fields);
        assert!(dsl.contains("n!"), "Expected 'n!' in: {}", dsl);
    }

    #[test]
    fn ensure_authored_uuid_inserts_when_missing() {
        let original = "<!--- n | hello --->";
        let (result, changed) = ensure_authored_uuid(original, "my-uuid");
        assert!(changed);
        assert_eq!(result, "<!---[my-uuid] n | hello --->");
    }

    #[test]
    fn ensure_authored_uuid_noop_when_present() {
        let original = "<!---[existing-id] n | hello --->";
        let (result, changed) = ensure_authored_uuid(original, "my-uuid");
        assert!(!changed);
        assert_eq!(result, "existing-id");
    }

    #[test]
    fn ensure_authored_uuid_returns_existing_id_even_if_different() {
        let original = "<!---[different-id] n | hello --->";
        let (result, changed) = ensure_authored_uuid(original, "my-uuid");
        assert!(!changed);
        assert_eq!(result, "different-id");
    }

    #[test]
    fn ensure_authored_uuid_handles_block_form() {
        let original = "<!---\nn\n---\nbody\n--->";
        let (result, changed) = ensure_authored_uuid(original, "my-uuid");
        assert!(changed);
        assert_eq!(result, "<!---[my-uuid]\nn\n---\nbody\n--->");
    }

    #[test]
    fn ensure_authored_uuid_handles_percent_fence() {
        let original = "%%! n | hello %%";
        let (result, changed) = ensure_authored_uuid(original, "my-uuid");
        assert!(changed);
        assert_eq!(result, "%%![my-uuid] n | hello %%");
    }

    #[test]
    fn ensure_authored_uuid_handles_percent_with_existing_id() {
        let original = "%%![existing] n | hello %%";
        let (result, changed) = ensure_authored_uuid(original, "my-uuid");
        assert!(!changed);
        assert_eq!(result, "existing");
    }

    #[test]
    fn utf16_offsets_ascii() {
        let text = "hello world";
        let (start, end) = utf16_offsets_to_byte(text, 6, 11);
        assert_eq!(&text[start..end], "world");
    }

    #[test]
    fn utf16_offsets_cjk() {
        // CJK characters are 3 bytes each in UTF-8, but 1 UTF-16 code unit each.
        let text = "你好世界";
        let (start, end) = utf16_offsets_to_byte(text, 2, 4);
        assert_eq!(&text[start..end], "世界");
    }

    #[test]
    fn utf16_offsets_emoji() {
        // Emoji like 😀 is 4 bytes in UTF-8 and 2 UTF-16 code units (surrogate pair).
        let text = "a😀b";
        let (start, end) = utf16_offsets_to_byte(text, 0, 1);
        assert_eq!(&text[start..end], "a");
        let (start2, end2) = utf16_offsets_to_byte(text, 3, 4);
        assert_eq!(&text[start2..end2], "b");
    }

    #[test]
    fn utf16_offsets_mixed() {
        let text = "Hello 你好!";
        // "Hello " = 6 UTF-16 units, "你好" = 2 UTF-16 units, "!" = 1
        let (start, end) = utf16_offsets_to_byte(text, 6, 8);
        assert_eq!(&text[start..end], "你好");
    }
}
