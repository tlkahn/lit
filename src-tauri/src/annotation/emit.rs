//! Rust-side DSL emitter for source write-back (cycle C sn path).
//!
//! North star: FE `generateDsl` for the sn subset. Non-goals for now:
//! `mark` codes, `lang=`, forced `opts.form` override, eliding default
//! sentence scope (Rust always emits explicit scope tokens).
//!
//! **Hazard (cycle C):** freeform `body` characters that collide with fence
//! grammar (`--->`, a body line that is exactly `---`) are not escaped here.
//! Cycle C write-back must escape, reject, or otherwise encode user slip-note
//! text before calling `emit_annotation`.

use super::scanner::{extract_id, is_valid_authored_id};
use super::types::{AnnotationType, Certainty, Scope, ScopeKind};

#[derive(Debug, Clone)]
pub struct EmitFields {
    pub id: Option<String>,
    pub annotation_type: AnnotationType,
    pub certainty: Certainty,
    pub scope: Scope,
    pub body: String,
    /// Must be `YYYY-MM` or `YYYY-MM-DD` to round-trip via the parser's
    /// `DATE_RE`. Other strings pass through emit but will not survive a
    /// parse cycle.
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

fn try_invalid_bracket_token(s: &str) -> Option<usize> {
    if !s.starts_with('[') {
        return None;
    }
    let close = s.find(']')?;
    Some(close + 1)
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EnsureAuthoredUuid {
    /// Stable id children should anchor to (`^"id"`).
    pub id: String,
    /// Full annotation text to splice into the page (possibly stamped).
    pub original: String,
    /// True iff `original` was modified by stamping.
    pub changed: bool,
}

/// Ensure the annotation fence in `original` carries a scanner-valid authored
/// `[id]`. If one exists, returns it with the text unchanged. If missing,
/// injects `[uuid]` immediately after the opening fence token.
///
/// `uuid` must pass [`is_valid_authored_id`] (same charset as scanner `ID_RE`).
/// Invalid values are not written; the call returns `changed=false` and
/// fires a `debug_assert` so cycle-C mistakes surface in dev builds.
///
/// Non-fence inputs are returned unchanged; `id` is set to `uuid` so callers
/// always have a usable anchor.
pub fn ensure_authored_uuid(original: &str, uuid: &str) -> EnsureAuthoredUuid {
    let (fence, rest) = if let Some(r) = original.strip_prefix("<!---") {
        ("<!---", r)
    } else if let Some(r) = original.strip_prefix("%%!") {
        ("%%!", r)
    } else {
        return EnsureAuthoredUuid {
            id: uuid.to_string(),
            original: original.to_string(),
            changed: false,
        };
    };

    let trimmed = rest.trim_start();
    let (maybe_id, _) = extract_id(trimmed);

    if let Some(id) = maybe_id {
        return EnsureAuthoredUuid {
            id,
            original: original.to_string(),
            changed: false,
        };
    }

    if !is_valid_authored_id(uuid) {
        #[cfg(not(test))]
        debug_assert!(
            false,
            "ensure_authored_uuid: uuid {:?} is not a scanner-valid authored id",
            uuid
        );
        return EnsureAuthoredUuid {
            id: uuid.to_string(),
            original: original.to_string(),
            changed: false,
        };
    }

    let leading_ws = &rest[..rest.len() - trimmed.len()];
    let stamped = if let Some(bracket_end) = try_invalid_bracket_token(trimmed) {
        let after = &trimmed[bracket_end..];
        format!("{}{}[{}]{}", fence, leading_ws, uuid, after)
    } else {
        format!("{}[{}]{}", fence, uuid, rest)
    };

    EnsureAuthoredUuid {
        id: uuid.to_string(),
        original: stamped,
        changed: true,
    }
}

/// Convert a UTF-16 offset pair into byte offsets within `text`.
/// Returns `(byte_start, byte_end)` with `byte_start <= byte_end` guaranteed.
///
/// Mid-char offsets snap forward to the next char boundary. Offsets past the
/// end of `text` clamp to `text.len()`. If `utf16_start > utf16_end`, the
/// mapped offsets are swapped so the invariant holds.
pub fn utf16_offsets_to_byte(text: &str, utf16_start: usize, utf16_end: usize) -> (usize, usize) {
    let (lo, hi) = if utf16_start <= utf16_end {
        (utf16_start, utf16_end)
    } else {
        (utf16_end, utf16_start)
    };

    let mut utf16_pos = 0;
    let mut byte_start = text.len();
    let mut byte_end = text.len();
    let mut found_start = false;
    let mut found_end = false;

    for (byte_idx, ch) in text.char_indices() {
        if !found_start && utf16_pos >= lo {
            byte_start = byte_idx;
            found_start = true;
        }
        if !found_end && utf16_pos >= hi {
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
        let r = ensure_authored_uuid(original, "my-uuid");
        assert!(r.changed);
        assert_eq!(r.id, "my-uuid");
        assert_eq!(r.original, "<!---[my-uuid] n | hello --->");
    }

    #[test]
    fn ensure_authored_uuid_noop_when_present() {
        let original = "<!---[existing-id] n | hello --->";
        let r = ensure_authored_uuid(original, "my-uuid");
        assert!(!r.changed);
        assert_eq!(r.id, "existing-id");
        assert_eq!(r.original, original);
    }

    #[test]
    fn ensure_authored_uuid_returns_existing_id_even_if_different() {
        let original = "<!---[different-id] n | hello --->";
        let r = ensure_authored_uuid(original, "my-uuid");
        assert!(!r.changed);
        assert_eq!(r.id, "different-id");
        assert_eq!(r.original, original);
    }

    #[test]
    fn ensure_authored_uuid_handles_block_form() {
        let original = "<!---\nn\n---\nbody\n--->";
        let r = ensure_authored_uuid(original, "my-uuid");
        assert!(r.changed);
        assert_eq!(r.id, "my-uuid");
        assert_eq!(r.original, "<!---[my-uuid]\nn\n---\nbody\n--->");
    }

    #[test]
    fn ensure_authored_uuid_handles_percent_fence() {
        let original = "%%! n | hello %%";
        let r = ensure_authored_uuid(original, "my-uuid");
        assert!(r.changed);
        assert_eq!(r.id, "my-uuid");
        assert_eq!(r.original, "%%![my-uuid] n | hello %%");
    }

    #[test]
    fn ensure_authored_uuid_handles_percent_with_existing_id() {
        let original = "%%![existing] n | hello %%";
        let r = ensure_authored_uuid(original, "my-uuid");
        assert!(!r.changed);
        assert_eq!(r.id, "existing");
        assert_eq!(r.original, original);
    }

    #[test]
    fn ensure_authored_uuid_space_before_bracket_html_fence() {
        let original = "<!--- [abc] n | body --->";
        let r = ensure_authored_uuid(original, "new");
        assert!(!r.changed, "should detect existing id, not stamp");
        assert_eq!(r.id, "abc");
        assert_eq!(r.original, original);
    }

    #[test]
    fn ensure_authored_uuid_newline_before_bracket_html_fence() {
        let original = "<!---\n[abc]\nn\n--->";
        let r = ensure_authored_uuid(original, "new");
        assert!(!r.changed, "should detect existing id, not stamp");
        assert_eq!(r.id, "abc");
        assert_eq!(r.original, original);
    }

    #[test]
    fn ensure_authored_uuid_space_before_bracket_percent_fence() {
        let original = "%%! [abc] n | body %%";
        let r = ensure_authored_uuid(original, "new");
        assert!(!r.changed, "should detect existing id, not stamp");
        assert_eq!(r.id, "abc");
        assert_eq!(r.original, original);
    }

    #[test]
    fn ensure_authored_uuid_newline_before_bracket_percent_fence() {
        let original = "%%!\n[abc]\nn\n%%";
        let r = ensure_authored_uuid(original, "new");
        assert!(!r.changed, "should detect existing id, not stamp");
        assert_eq!(r.id, "abc");
        assert_eq!(r.original, original);
    }

    #[test]
    fn ensure_authored_uuid_replaces_empty_bracket() {
        let original = "<!---[] n | body --->";
        let r = ensure_authored_uuid(original, "new");
        assert!(r.changed, "empty brackets should not be treated as an authored id");
        assert_eq!(r.id, "new");
        assert_eq!(r.original, "<!---[new] n | body --->");
    }

    #[test]
    fn ensure_authored_uuid_replaces_invalid_bracket_token() {
        let original = "<!---[-bad] n | body --->";
        let r = ensure_authored_uuid(original, "new");
        assert!(r.changed, "invalid bracket token should not be treated as an authored id");
        assert_eq!(r.id, "new");
        assert_eq!(r.original, "<!---[new] n | body --->");
    }

    #[test]
    fn ensure_authored_uuid_replaces_invalid_bracket_with_leading_space() {
        let original = "<!--- [-bad] n | body --->";
        let r = ensure_authored_uuid(original, "new");
        assert!(r.changed);
        assert_eq!(r.original, "<!--- [new] n | body --->");
    }

    #[test]
    fn ensure_authored_uuid_replace_then_parse_recovers_type() {
        use crate::annotation::parser::parse_annotations_builtin;
        let original = "<!---[] n | body --->";
        let r = ensure_authored_uuid(original, "new");
        let anns = parse_annotations_builtin(&r.original);
        assert_eq!(anns.len(), 1, "should parse one annotation");
        assert_eq!(anns[0].annotation_type, AnnotationType::Note);
        assert_eq!(anns[0].uuid.as_deref(), Some("new"));
    }

    #[test]
    fn ensure_authored_uuid_rejects_empty_uuid() {
        let original = "<!--- n | body --->";
        let r = ensure_authored_uuid(original, "");
        assert!(!r.changed, "empty uuid must not stamp");
        assert_eq!(r.id, "");
        assert_eq!(r.original, original);
    }

    #[test]
    fn ensure_authored_uuid_rejects_leading_hyphen_uuid() {
        let original = "<!--- n | body --->";
        let r = ensure_authored_uuid(original, "-bad");
        assert!(!r.changed, "leading-hyphen uuid must not stamp");
        assert_eq!(r.id, "-bad");
        assert_eq!(r.original, original);
    }

    #[test]
    fn ensure_authored_uuid_rejects_space_uuid() {
        let original = "<!--- n | body --->";
        let r = ensure_authored_uuid(original, "has space");
        assert!(!r.changed, "space uuid must not stamp");
        assert_eq!(r.id, "has space");
        assert_eq!(r.original, original);
    }

    #[test]
    fn ensure_authored_uuid_accepts_graph_shaped_uuid() {
        let original = "<!--- n | body --->";
        let r = ensure_authored_uuid(original, "a1b2c3d4-e5f6-7890-abcd-ef1234567890");
        assert!(r.changed);
        assert_eq!(r.id, "a1b2c3d4-e5f6-7890-abcd-ef1234567890");
        assert_eq!(
            r.original,
            "<!---[a1b2c3d4-e5f6-7890-abcd-ef1234567890] n | body --->"
        );
    }

    #[test]
    fn ensure_authored_uuid_invalid_uuid_does_not_restamp() {
        let original = "<!--- n | body --->";
        let r1 = ensure_authored_uuid(original, "");
        assert!(!r1.changed);
        let r2 = ensure_authored_uuid(&r1.original, "");
        assert!(!r2.changed);
        assert_eq!(r2.original, original, "must not accumulate stamps");
    }

    #[test]
    fn ensure_authored_uuid_non_fence_returns_uuid_as_id() {
        let original = "not a fence at all";
        let r = ensure_authored_uuid(original, "fallback-uuid");
        assert!(!r.changed);
        assert_eq!(r.id, "fallback-uuid");
        assert_eq!(r.original, original);
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

    #[test]
    fn utf16_zero_width() {
        let text = "abc";
        let (start, end) = utf16_offsets_to_byte(text, 1, 1);
        assert_eq!(start, 1);
        assert_eq!(end, 1);
        assert_eq!(&text[start..end], "");
    }

    #[test]
    fn utf16_oob_both_past_end() {
        let text = "abc";
        let (start, end) = utf16_offsets_to_byte(text, 10, 20);
        assert_eq!(start, 3);
        assert_eq!(end, 3);
    }

    #[test]
    fn utf16_inverted_range() {
        let text = "abc";
        let (start, end) = utf16_offsets_to_byte(text, 5, 2);
        assert!(start <= end, "byte_start ({start}) must be <= byte_end ({end})");
    }
}
