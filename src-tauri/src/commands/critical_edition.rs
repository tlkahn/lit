use serde::Deserialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use tauri::{Emitter, Manager};

use crate::annotation::marks::{sorted_mark_codes, MarkConfigCache};
use crate::annotation::parser::parse_annotations as do_parse;
use crate::annotation::scope_resolver::ScopeResolveCtx;
use crate::annotation::types::{Annotation, AnnotationType, Certainty, ScopeRange};
use crate::preferences;

use super::academic_export::{
    self, AcademicExportProgress, ExportResult,
};
use super::workspace::{get_workspace_root, WorkspaceRegistry};

// ---------------------------------------------------------------------------
// Request / response types (B1)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CriticalEditionRequest {
    pub relative_path: String,
    pub output_path: String,
    pub csl: Option<String>,
    #[serde(default = "default_true")]
    pub line_numbers: bool,
    #[serde(default)]
    pub routing: HashMap<String, String>,
}

fn default_true() -> bool {
    true
}

// ---------------------------------------------------------------------------
// Validation (B2)
// ---------------------------------------------------------------------------

pub fn validate_input(
    input_path: &Path,
    output_path: &Path,
) -> Result<(), String> {
    if !input_path.is_file() {
        return Err(format!("Input file not found: {}", input_path.display()));
    }
    if let Some(parent) = output_path.parent() {
        if !parent.as_os_str().is_empty() && !parent.exists() {
            return Err(format!(
                "Output directory does not exist: {}",
                parent.display()
            ));
        }
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Route enum + defaults (A1-A2)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Route {
    Right,
    AFootnote,
    BFootnote,
    Suppress,
    Parent,
}

pub fn default_routing() -> HashMap<String, Route> {
    let mut m = HashMap::new();
    m.insert("n".into(), Route::Right);
    m.insert("tr".into(), Route::Right);
    m.insert("app".into(), Route::AFootnote);
    m.insert("cf".into(), Route::BFootnote);
    m.insert("q".into(), Route::Suppress);
    m.insert("todo".into(), Route::Suppress);
    m.insert("llm".into(), Route::Suppress);
    m.insert("th".into(), Route::Suppress);
    m.insert("bare".into(), Route::Right);
    m.insert("sn".into(), Route::Parent);
    m
}

pub fn resolve_routing(overrides: &HashMap<String, String>) -> HashMap<String, Route> {
    let mut routing = default_routing();
    for (key, val) in overrides {
        if !routing.contains_key(key.as_str()) {
            continue;
        }
        let route = match val.as_str() {
            "right" => Route::Right,
            "afootnote" => Route::AFootnote,
            "bfootnote" => Route::BFootnote,
            "suppress" => Route::Suppress,
            "parent" => Route::Parent,
            _ => continue,
        };
        routing.insert(key.clone(), route);
    }
    routing
}

fn route_key(ann: &Annotation) -> String {
    match ann.annotation_type {
        AnnotationType::Note => "n".into(),
        AnnotationType::Question => "q".into(),
        AnnotationType::Todo => "todo".into(),
        AnnotationType::CrossRef => "cf".into(),
        AnnotationType::Apparatus => "app".into(),
        AnnotationType::Translation => "tr".into(),
        AnnotationType::Llm => "llm".into(),
        AnnotationType::Thread => "th".into(),
        AnnotationType::SlipNote => "sn".into(),
        AnnotationType::Mark => "mark".into(),
        AnnotationType::Bare => "bare".into(),
    }
}

// ---------------------------------------------------------------------------
// Placeholder nonce
// ---------------------------------------------------------------------------

fn make_nonce() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let t = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    format!("XLIT{t:x}X")
}

// ---------------------------------------------------------------------------
// Footnote / mark entry types
// ---------------------------------------------------------------------------

#[derive(Debug, Clone)]
pub struct FootnoteEntry {
    pub index: usize,
    pub route: Route,
    pub body_md: String,
}

#[derive(Debug, Clone)]
pub struct MarkEntry {
    pub index: usize,
    pub code: String,
}

// ---------------------------------------------------------------------------
// UTF-16 to byte offset conversion
// ---------------------------------------------------------------------------

fn build_utf16_to_byte_map(content: &str) -> Vec<usize> {
    let mut map = Vec::new();
    for (byte_idx, ch) in content.char_indices() {
        for _ in 0..ch.len_utf16() {
            map.push(byte_idx);
        }
    }
    map.push(content.len());
    map
}

fn utf16_to_byte(map: &[usize], utf16_pos: usize) -> usize {
    if utf16_pos >= map.len() {
        *map.last().unwrap_or(&0)
    } else {
        map[utf16_pos]
    }
}

// ---------------------------------------------------------------------------
// Paragraph span
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParagraphSpan {
    pub index: usize,
    pub start: usize,
    pub end: usize,
}

pub fn split_paragraphs(content: &str) -> Vec<ParagraphSpan> {
    let body = skip_frontmatter(content);
    let body_offset = content.len() - body.len();

    let lines: Vec<&str> = body.split('\n').collect();
    let mut spans = Vec::new();
    let mut idx = 0;
    let mut in_para = false;
    let mut para_char_start = 0;
    let mut para_char_end = 0;
    let mut char_pos = 0;

    for line in &lines {
        let line_char_start = char_pos;
        let line_char_end = char_pos + line.len();
        let is_blank = line.trim().is_empty();

        if is_blank {
            if in_para {
                spans.push(ParagraphSpan {
                    index: idx,
                    start: body_offset + para_char_start,
                    end: body_offset + para_char_end,
                });
                idx += 1;
                in_para = false;
            }
        } else {
            if !in_para {
                para_char_start = line_char_start;
                in_para = true;
            }
            para_char_end = line_char_end;
        }

        char_pos = line_char_end + 1;
    }

    if in_para {
        spans.push(ParagraphSpan {
            index: idx,
            start: body_offset + para_char_start,
            end: body_offset + para_char_end,
        });
    }

    spans
}

fn skip_frontmatter(content: &str) -> &str {
    if !content.starts_with("---") {
        return content;
    }
    let after_first = &content[3..];
    if let Some(end) = after_first.find("\n---") {
        let closing_end = end + 4;
        let rest = &after_first[closing_end..];
        if rest.starts_with('\n') {
            return &rest[1..];
        }
        return rest;
    }
    content
}

// ---------------------------------------------------------------------------
// Lemma excerpt extraction
// ---------------------------------------------------------------------------

/// Approximate max display characters for a lemma key on the right page.
const LEMMA_MAX_CHARS: usize = 40;

/// Extract a lemma excerpt from `body` at byte `range`, truncating to
/// ~`LEMMA_MAX_CHARS` characters. Latin text truncates at a word boundary;
/// CJK truncates at a char boundary. Empty ranges yield an empty string.
/// Markdown is left intact (pandoc converts later).
fn flatten_to_inline(raw: &str) -> String {
    let stripped: String = raw
        .lines()
        .map(|line| {
            let t = line.trim_start();
            if t.starts_with('#') {
                t.trim_start_matches('#').trim_start()
            } else {
                let plen = detect_block_prefix_len(t);
                if plen > 0 { &t[plen..] } else { line }
            }
        })
        .collect::<Vec<_>>()
        .join(" ");
    let mut out = String::with_capacity(stripped.len());
    let mut prev_ws = false;
    for ch in stripped.chars() {
        if ch.is_whitespace() {
            if !prev_ws {
                out.push(' ');
            }
            prev_ws = true;
        } else {
            out.push(ch);
            prev_ws = false;
        }
    }
    out.trim().to_string()
}

pub fn lemma_excerpt(body: &str, range: &ScopeRange) -> String {
    let start = range.start.min(body.len());
    let end = range.end.min(body.len()).max(start);
    if start == end {
        return String::new();
    }
    // Ensure we land on char boundaries.
    let start = floor_char_boundary(body, start);
    let end = floor_char_boundary(body, end);
    let raw_excerpt = &body[start..end];
    let excerpt_owned = flatten_to_inline(raw_excerpt);
    let excerpt = excerpt_owned.as_str();
    let char_count = excerpt.chars().count();
    if char_count <= LEMMA_MAX_CHARS {
        return excerpt.to_string();
    }

    let mut cut = 0;
    for (i, (byte_idx, ch)) in excerpt.char_indices().enumerate() {
        if i >= LEMMA_MAX_CHARS {
            cut = byte_idx;
            break;
        }
        cut = byte_idx + ch.len_utf8();
    }
    let truncated = &excerpt[..cut];

    // Prefer word-boundary truncation for Latin-heavy text. CJK has no spaces,
    // so fall through to the char cut.
    let word_cut = truncated
        .rfind(|c: char| c.is_whitespace())
        .filter(|&idx| idx > 0)
        .unwrap_or(cut);
    let candidate = &truncated[..word_cut];
    let use_word = candidate.chars().any(|c| c.is_ascii_alphabetic())
        && !candidate.chars().any(is_cjk_char);
    let final_cut = if use_word { word_cut } else { cut };
    format!("{}…", excerpt[..final_cut].trim_end())
}

fn floor_char_boundary(s: &str, mut i: usize) -> usize {
    if i >= s.len() {
        return s.len();
    }
    while i > 0 && !s.is_char_boundary(i) {
        i -= 1;
    }
    i
}

fn is_cjk_char(c: char) -> bool {
    matches!(c,
        '一'..='鿿' | // CJK Unified Ideographs
        '㐀'..='䶿' | // CJK Extension A
        '豈'..='﫿' | // CJK Compatibility Ideographs
        '　'..='〿' | // CJK Symbols and Punctuation
        '＀'..='￯'   // Halfwidth and Fullwidth Forms
    )
}

// ---------------------------------------------------------------------------
// Chunking (sentence-boundary sync units for reledpar)
// ---------------------------------------------------------------------------

/// Approx display-width budget per chunk (~5-6 typeset lines).
/// ASCII = 1 unit, CJK char = 2 units.
pub const MAX_CHUNK_WIDTH: usize = 400;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ChunkSpan {
    pub start: usize,
    pub end: usize,
    pub para_start: bool,
}

#[derive(Debug, Clone)]
pub struct ChunkText {
    pub text: String,
    pub para_start: bool,
}

fn display_width(s: &str) -> usize {
    s.chars().map(|c| if is_cjk_char(c) { 2 } else { 1 }).sum()
}

fn is_structured_block(text: &str) -> bool {
    let first = text.lines().next().unwrap_or("").trim_start();
    if first.is_empty() {
        return false;
    }
    if first.starts_with('#')
        || first.starts_with('-')
        || first.starts_with('*')
        || first.starts_with('>')
        || first.starts_with('|')
        || first.starts_with("```")
        || first.starts_with("~~~")
    {
        return true;
    }
    // ordered list: digits then '.'
    let mut chars = first.chars();
    let mut saw_digit = false;
    while let Some(c) = chars.next() {
        if c.is_ascii_digit() {
            saw_digit = true;
            continue;
        }
        return saw_digit && c == '.';
    }
    false
}

/// True if any injection range is strictly split by a cut at `pos`
/// (i.e. start < pos < end).
fn cut_splits_injection(pos: usize, injection_ranges: &[(usize, usize)]) -> bool {
    injection_ranges
        .iter()
        .any(|&(s, e)| s < pos && pos < e)
}

/// Chunk `body` into fine-grained spans for reledpar sync.
///
/// - Paragraph boundaries are always chunk boundaries.
/// - Structured blocks (headings, lists, quotes, tables, fences) stay whole.
/// - Prose splits only at sentencex sentence boundaries.
/// - A sentence containing an anchor always starts a new chunk.
/// - Unannotated runs accumulate until `max_width` display units.
/// - Cuts never land inside an injection range.
pub fn chunk_spans(
    body: &str,
    paragraphs: &[ParagraphSpan],
    anchors: &[usize],
    injection_ranges: &[(usize, usize)],
    lang: &str,
    max_width: usize,
) -> Vec<ChunkSpan> {
    let mut spans = Vec::new();

    for para in paragraphs {
        let para_start = para.start.min(body.len());
        let para_end = para.end.min(body.len()).max(para_start);
        if para_start == para_end {
            continue;
        }
        let para_text = &body[para_start..para_end];

        if is_structured_block(para_text) {
            spans.push(ChunkSpan {
                start: para_start,
                end: para_end,
                para_start: true,
            });
            continue;
        }

        // Sentence boundaries relative to the paragraph, then absolute.
        let boundaries = sentencex::get_sentence_boundaries(lang, para_text);
        let mut sent_ranges: Vec<(usize, usize)> = boundaries
            .iter()
            .map(|b| (para_start + b.start_byte, para_start + b.end_byte))
            .filter(|(s, e)| s < e)
            .collect();

        // Fallback: whole paragraph as one sentence if segmenter returns nothing.
        if sent_ranges.is_empty() {
            sent_ranges.push((para_start, para_end));
        } else {
            // Ensure full coverage of the paragraph (segmenter may drop trailing whitespace).
            if let Some(&(s, _)) = sent_ranges.first() {
                if s > para_start {
                    sent_ranges.insert(0, (para_start, s));
                }
            }
            if let Some(&(_, e)) = sent_ranges.last() {
                if e < para_end {
                    sent_ranges.push((e, para_end));
                }
            }
        }

        // Determine which sentence indices must start a new chunk (contain an anchor).
        let mut force_start = vec![false; sent_ranges.len()];
        for &anchor in anchors {
            if anchor < para_start || anchor >= para_end {
                continue;
            }
            if let Some((si, _)) = sent_ranges
                .iter()
                .enumerate()
                .find(|(_, &(s, e))| anchor >= s && anchor < e)
            {
                force_start[si] = true;
            }
        }
        // First sentence of a paragraph always starts a chunk.
        if !force_start.is_empty() {
            force_start[0] = true;
        }

        let mut chunk_start = para_start;
        let mut chunk_width = 0usize;
        let mut is_para_start = true;

        for (si, &(s_start, s_end)) in sent_ranges.iter().enumerate() {
            let sent_text = &body[s_start..s_end];
            let sent_w = display_width(sent_text);
            let would_exceed = chunk_width > 0 && chunk_width + sent_w > max_width;
            let must_break = (force_start[si] && chunk_start < s_start) || would_exceed;

            if must_break {
                let mut cut = s_start;
                // Extend cut past any injection range it would split.
                while cut_splits_injection(cut, injection_ranges) {
                    if let Some(&(_, e)) = injection_ranges
                        .iter()
                        .find(|&&(s, e)| s < cut && cut < e)
                    {
                        cut = e;
                    } else {
                        break;
                    }
                }
                cut = cut.min(para_end).max(chunk_start);
                if cut > chunk_start {
                    spans.push(ChunkSpan {
                        start: chunk_start,
                        end: cut,
                        para_start: is_para_start,
                    });
                    is_para_start = false;
                    chunk_start = cut;
                    chunk_width = 0;
                }
            }

            // If this sentence starts after chunk_start (because cut extended),
            // include the gap in width accounting via the sentence itself next.
            if s_end > chunk_start {
                let included = &body[chunk_start.max(s_start)..s_end];
                chunk_width += display_width(included);
            }
        }

        if chunk_start < para_end {
            spans.push(ChunkSpan {
                start: chunk_start,
                end: para_end,
                para_start: is_para_start,
            });
        }
    }

    spans
}

// ---------------------------------------------------------------------------
// Transform document: strip annotations, inject placeholders (A3-A7)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone)]
pub struct TransformResult {
    pub chunks: Vec<ChunkText>,
    /// body_no_del coordinates for each chunk (parallel to `chunks`).
    pub chunk_spans: Vec<ChunkSpan>,
    pub footnotes: Vec<FootnoteEntry>,
    pub marks: Vec<MarkEntry>,
    pub right_notes: Vec<RightNote>,
    pub lemma_excerpts: Vec<String>,
    pub nonce: String,
}

impl TransformResult {
    /// Concatenate chunk texts (with original paragraph separators approximated
    /// by blank lines between para_start chunks after the first). Useful for
    /// tests that previously asserted on a single body string.
    pub fn body(&self) -> String {
        let mut out = String::new();
        for (i, c) in self.chunks.iter().enumerate() {
            if i > 0 {
                if c.para_start {
                    out.push_str("\n\n");
                }
            }
            out.push_str(&c.text);
        }
        out
    }
}

#[derive(Debug, Clone)]
pub struct RightNote {
    pub note_index: usize,
    pub annotation_type: String,
    pub certainty: Certainty,
    pub body_md: String,
    pub scope_range: ScopeRange,
}

pub fn transform_document(
    content: &str,
    annotations: &[Annotation],
    scopes: &[Option<ScopeRange>],
    routing: &HashMap<String, Route>,
    lang: &str,
) -> TransformResult {
    let u16map = build_utf16_to_byte_map(content);
    let to_byte = |u16pos: usize| utf16_to_byte(&u16map, u16pos);

    let nonce = make_nonce();
    let mut footnotes: Vec<FootnoteEntry> = Vec::new();
    let mut marks: Vec<MarkEntry> = Vec::new();
    let mut right_notes: Vec<RightNote> = Vec::new();

    let paragraphs = split_paragraphs(content);

    let mut injection_ranges: Vec<(usize, usize)> = Vec::new();

    struct Injection {
        scope_start: usize,
        scope_end: usize,
        kind: InjectionKind,
    }
    enum InjectionKind {
        Footnote { index: usize },
        Mark { index: usize },
        Label { index: usize },
    }

    let mut deletions: Vec<(usize, usize)> = Vec::new();
    let mut injections: Vec<Injection> = Vec::new();

    for (i, ann) in annotations.iter().enumerate() {
        let byte_start = to_byte(ann.char_start);
        let byte_end = to_byte(ann.char_end);
        deletions.push((byte_start, byte_end));

        let rk = route_key(ann);

        let scope_range_u16 = match scopes.get(i) {
            Some(Some(sr)) => sr,
            _ => {
                if ann.annotation_type != AnnotationType::Mark {
                    let route = routing.get(&rk).copied();
                    if route != Some(Route::Suppress) {
                        let body_md = ann.body.clone().unwrap_or_default();
                        let fallback_scope = ScopeRange {
                            start: byte_start,
                            end: byte_start,
                        };
                        let adj_start =
                            normalize_label_start(content, &paragraphs, &fallback_scope);
                        let ni = right_notes.len();
                        right_notes.push(RightNote {
                            note_index: ni,
                            annotation_type: rk,
                            certainty: ann.certainty.clone(),
                            body_md,
                            scope_range: ScopeRange {
                                start: adj_start,
                                end: adj_start,
                            },
                        });
                        injections.push(Injection {
                            scope_start: adj_start,
                            scope_end: adj_start,
                            kind: InjectionKind::Label { index: ni },
                        });
                    }
                }
                continue;
            }
        };
        let scope_range = &ScopeRange {
            start: to_byte(scope_range_u16.start),
            end: to_byte(scope_range_u16.end),
        };

        if ann.annotation_type == AnnotationType::Mark {
            if let Some(code) = &ann.mark {
                if !crosses_paragraph_boundary(scope_range, &paragraphs) {
                    if has_partial_overlap(scope_range, &injection_ranges) {
                        continue;
                    }
                    let mi = marks.len();
                    marks.push(MarkEntry {
                        index: mi,
                        code: code.clone(),
                    });
                    injection_ranges.push((scope_range.start, scope_range.end));
                    injections.push(Injection {
                        scope_start: scope_range.start,
                        scope_end: scope_range.end,
                        kind: InjectionKind::Mark { index: mi },
                    });
                }
            }
            continue;
        }

        let route = match routing.get(&rk).copied() {
            Some(r) => r,
            None => continue,
        };

        if route == Route::Suppress {
            continue;
        }

        let body_md = ann.body.clone().unwrap_or_default();

        if route == Route::AFootnote || route == Route::BFootnote {
            if crosses_paragraph_boundary(scope_range, &paragraphs)
                || has_partial_overlap(scope_range, &injection_ranges)
            {
                let adj_start =
                    normalize_label_start(content, &paragraphs, scope_range);
                let ni = right_notes.len();
                right_notes.push(RightNote {
                    note_index: ni,
                    annotation_type: rk,
                    certainty: ann.certainty.clone(),
                    body_md,
                    scope_range: ScopeRange {
                        start: adj_start,
                        end: scope_range.end,
                    },
                });
                injections.push(Injection {
                    scope_start: adj_start,
                    scope_end: adj_start,
                    kind: InjectionKind::Label { index: ni },
                });
                continue;
            }
            let fi = footnotes.len();
            footnotes.push(FootnoteEntry {
                index: fi,
                route,
                body_md,
            });
            injection_ranges.push((scope_range.start, scope_range.end));
            injections.push(Injection {
                scope_start: scope_range.start,
                scope_end: scope_range.end,
                kind: InjectionKind::Footnote { index: fi },
            });
        } else {
            let adj_start =
                normalize_label_start(content, &paragraphs, scope_range);
            let ni = right_notes.len();
            right_notes.push(RightNote {
                note_index: ni,
                annotation_type: rk,
                certainty: ann.certainty.clone(),
                body_md,
                scope_range: ScopeRange {
                    start: adj_start,
                    end: scope_range.end,
                },
            });
            injections.push(Injection {
                scope_start: adj_start,
                scope_end: adj_start,
                kind: InjectionKind::Label { index: ni },
            });
        }
    }

    let mut sorted_deletions = deletions.clone();
    sorted_deletions.sort_by_key(|d| d.0);

    // Build deletion-stripped body.
    let mut body_no_del = String::with_capacity(content.len());
    {
        let mut prev = 0;
        let mut sorted_del_asc = deletions.clone();
        sorted_del_asc.sort_by_key(|d| d.0);
        for &(s, e) in &sorted_del_asc {
            let s = s.min(content.len());
            let e = e.min(content.len());
            if s > prev {
                body_no_del.push_str(&content[prev..s]);
            }
            prev = e;
        }
        if prev < content.len() {
            body_no_del.push_str(&content[prev..]);
        }
    }

    // Adjust injection positions and right-note scopes into body_no_del coords.
    let mut adj_injections: Vec<(usize, usize, InjectionKind)> = Vec::new();
    for inj in &injections {
        let adj_start = adjust_pos(inj.scope_start, &sorted_deletions);
        let adj_end = adjust_pos(inj.scope_end, &sorted_deletions);
        adj_injections.push((adj_start, adj_end, match &inj.kind {
            InjectionKind::Footnote { index } => InjectionKind::Footnote { index: *index },
            InjectionKind::Mark { index } => InjectionKind::Mark { index: *index },
            InjectionKind::Label { index } => InjectionKind::Label { index: *index },
        }));
    }

    let adjusted_right_notes: Vec<RightNote> = right_notes
        .into_iter()
        .map(|mut rn| {
            rn.scope_range.start = adjust_pos(rn.scope_range.start, &sorted_deletions);
            rn.scope_range.end = adjust_pos(rn.scope_range.end, &sorted_deletions);
            rn
        })
        .collect();

    // Lemma excerpts from body_no_del at adjusted scope ranges.
    let lemma_excerpts: Vec<String> = adjusted_right_notes
        .iter()
        .map(|rn| lemma_excerpt(&body_no_del, &rn.scope_range))
        .collect();

    // Anchors = right-note adjusted scope starts.
    let anchors: Vec<usize> = adjusted_right_notes
        .iter()
        .map(|rn| rn.scope_range.start)
        .collect();

    // Footnote/mark ranges in body_no_del coords (labels are points, skip).
    let adj_injection_ranges: Vec<(usize, usize)> = adj_injections
        .iter()
        .filter_map(|(s, e, kind)| match kind {
            InjectionKind::Label { .. } => None,
            _ => Some((*s, *e)),
        })
        .collect();

    // Re-split paragraphs on body_no_del (original content offsets no longer apply).
    let body_paragraphs = split_paragraphs(&body_no_del);

    let chunks_meta = chunk_spans(
        &body_no_del,
        &body_paragraphs,
        &anchors,
        &adj_injection_ranges,
        lang,
        MAX_CHUNK_WIDTH,
    );

    // Event kinds for ordering: Close=0, Label=1, Open=2.
    #[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
    enum EvKind {
        Close = 0,
        Label = 1,
        Open = 2,
    }
    struct Event {
        pos: usize,
        scope_start: usize,
        scope_end: usize,
        kind: EvKind,
        tag: String,
    }

    let mut events: Vec<Event> = Vec::new();
    for (adj_start, adj_end, kind) in &adj_injections {
        match kind {
            InjectionKind::Footnote { index } => {
                events.push(Event {
                    pos: *adj_start,
                    scope_start: *adj_start,
                    scope_end: *adj_end,
                    kind: EvKind::Open,
                    tag: format!("{nonce}FO{index}{nonce}"),
                });
                events.push(Event {
                    pos: *adj_end,
                    scope_start: *adj_start,
                    scope_end: *adj_end,
                    kind: EvKind::Close,
                    tag: format!("{nonce}FC{index}{nonce}"),
                });
            }
            InjectionKind::Mark { index } => {
                events.push(Event {
                    pos: *adj_start,
                    scope_start: *adj_start,
                    scope_end: *adj_end,
                    kind: EvKind::Open,
                    tag: format!("{nonce}MO{index}{nonce}"),
                });
                events.push(Event {
                    pos: *adj_end,
                    scope_start: *adj_start,
                    scope_end: *adj_end,
                    kind: EvKind::Close,
                    tag: format!("{nonce}MC{index}{nonce}"),
                });
            }
            InjectionKind::Label { index } => {
                events.push(Event {
                    pos: *adj_start,
                    scope_start: *adj_start,
                    scope_end: *adj_start,
                    kind: EvKind::Label,
                    tag: format!("{nonce}LB{index}{nonce}"),
                });
            }
        }
    }

    // Sort: by position, then Close < Label < Open,
    // among closes: inner first (larger scope_start),
    // among opens: outer first (larger scope_end),
    // among labels: by index order already stable via tag.
    events.sort_by(|a, b| {
        a.pos.cmp(&b.pos).then_with(|| a.kind.cmp(&b.kind)).then_with(|| {
            match a.kind {
                EvKind::Close => b.scope_start.cmp(&a.scope_start),
                EvKind::Open => b.scope_end.cmp(&a.scope_end),
                EvKind::Label => a.tag.cmp(&b.tag),
            }
        })
    });

    // Emit per-chunk placeholder-injected text.
    // Opens/labels attach to the chunk whose half-open range contains pos.
    // Closes attach to the chunk whose half-open range would have contained
    // pos-1 (i.e. start < pos <= end). Events at body.len() land in the last
    // chunk.
    let mut chunks: Vec<ChunkText> = Vec::with_capacity(chunks_meta.len());
    for cs in &chunks_meta {
        let mut text = String::with_capacity(cs.end - cs.start + 64);
        let mut cursor = cs.start;
        for ev in &events {
            let include = match ev.kind {
                EvKind::Open | EvKind::Label => {
                    (ev.pos >= cs.start && ev.pos < cs.end)
                        || (ev.pos == cs.end
                            && ev.pos == body_no_del.len()
                            && ev.pos >= cs.start)
                }
                EvKind::Close => {
                    (ev.pos > cs.start && ev.pos <= cs.end)
                        || (ev.pos == cs.start && cs.start == cs.end)
                }
            };
            if !include {
                continue;
            }
            let p = ev.pos.min(body_no_del.len());
            if p > cursor {
                text.push_str(&body_no_del[cursor..p]);
                cursor = p;
            }
            text.push_str(&ev.tag);
        }
        if cursor < cs.end {
            text.push_str(&body_no_del[cursor..cs.end]);
        }
        chunks.push(ChunkText {
            text,
            para_start: cs.para_start,
        });
    }

    TransformResult {
        chunks,
        chunk_spans: chunks_meta,
        footnotes,
        marks,
        right_notes: adjusted_right_notes,
        lemma_excerpts,
        nonce,
    }
}

fn adjust_pos(pos: usize, sorted_deletions: &[(usize, usize)]) -> usize {
    let mut adjusted = pos;
    for &(start, end) in sorted_deletions {
        if start >= pos {
            break;
        }
        let del_end = end.min(pos);
        adjusted -= del_end - start;
    }
    adjusted
}

fn normalize_label_start(
    content: &str,
    paragraphs: &[ParagraphSpan],
    scope: &ScopeRange,
) -> usize {
    let para = match paragraphs
        .iter()
        .find(|p| scope.start >= p.start && scope.start < p.end)
    {
        Some(p) => p,
        None => return scope.start,
    };

    let para_text = &content[para.start..para.end];
    let first_line = para_text.lines().next().unwrap_or("");
    let trimmed = first_line.trim_start();

    if trimmed.starts_with('#') {
        let scope_extends_beyond = scope.end > para.end;
        if scope_extends_beyond {
            if let Some(next) = paragraphs.iter().find(|p| p.start > para.end) {
                return next.start;
            }
        }
        let prefix_len = first_line.len() - first_line.trim_start_matches('#').trim_start().len();
        return para.start + prefix_len;
    }

    if trimmed.starts_with("```") || trimmed.starts_with("~~~") || trimmed.starts_with('|') {
        if let Some(next) = paragraphs.iter().find(|p| p.start > para.end) {
            return next.start;
        }
        return scope.start;
    }

    let block_prefix_len = detect_block_prefix_len(trimmed);
    if block_prefix_len > 0 {
        let leading_ws = first_line.len() - trimmed.len();
        return para.start + leading_ws + block_prefix_len;
    }

    scope.start
}

fn detect_block_prefix_len(trimmed: &str) -> usize {
    if trimmed.starts_with("> ") {
        return 2;
    }
    if trimmed.starts_with("- ")
        || trimmed.starts_with("* ")
        || trimmed.starts_with("+ ")
    {
        return 2;
    }
    let mut chars = trimmed.chars().peekable();
    let mut digits = 0;
    while let Some(&c) = chars.peek() {
        if c.is_ascii_digit() {
            digits += 1;
            chars.next();
        } else {
            break;
        }
    }
    if digits > 0 {
        if let Some(&'.') = chars.peek() {
            chars.next();
            if let Some(&' ') = chars.peek() {
                return digits + 2;
            }
        }
    }
    0
}

fn crosses_paragraph_boundary(scope: &ScopeRange, paragraphs: &[ParagraphSpan]) -> bool {
    let start_para = paragraphs
        .iter()
        .find(|p| scope.start >= p.start && scope.start < p.end);
    let end_para = paragraphs
        .iter()
        .find(|p| scope.end > p.start && scope.end <= p.end);
    match (start_para, end_para) {
        (Some(s), Some(e)) => s.index != e.index,
        (None, _) | (_, None) => true,
    }
}

fn has_partial_overlap(scope: &ScopeRange, existing: &[(usize, usize)]) -> bool {
    for &(s, e) in existing {
        if scope.start < e && scope.end > s {
            let nested =
                (scope.start >= s && scope.end <= e) || (s >= scope.start && e <= scope.end);
            if !nested {
                return true;
            }
        }
    }
    false
}

// ---------------------------------------------------------------------------
// Note-to-chunk attachment
// ---------------------------------------------------------------------------

#[derive(Debug, Clone)]
pub struct AttachedNote {
    pub chunk_index: usize,
    pub note_index: usize,
    pub annotation_type: String,
    pub certainty: Certainty,
    pub body_md: String,
    pub body_latex: Option<String>,
    pub lemma_latex: Option<String>,
}

/// Attach each right note to the chunk containing its adjusted scope start.
/// Empty-range (scope-resolution fallback) notes still attach by position.
/// Out-of-range falls back to the last chunk.
pub fn attach_notes_to_chunks(
    right_notes: &[RightNote],
    chunks: &[ChunkSpan],
) -> Vec<AttachedNote> {
    if chunks.is_empty() {
        return Vec::new();
    }
    right_notes
        .iter()
        .map(|note| {
            let pos = note.scope_range.start;
            let chunk_index = chunks
                .iter()
                .position(|c| pos >= c.start && pos < c.end)
                .or_else(|| {
                    // Point at exact end of last chunk, or empty-range edge cases.
                    chunks.iter().position(|c| pos >= c.start && pos <= c.end)
                })
                .unwrap_or(chunks.len() - 1);

            AttachedNote {
                chunk_index,
                note_index: note.note_index,
                annotation_type: note.annotation_type.clone(),
                certainty: note.certainty.clone(),
                body_md: note.body_md.clone(),
                body_latex: None,
                lemma_latex: None,
            }
        })
        .collect()
}

// ---------------------------------------------------------------------------
// Sentinel batch build + split (A10)
// ---------------------------------------------------------------------------

/// Build a single pandoc input from chunks + footnote/right-note bodies + lemmas.
/// Piece order: chunks, then note_bodies, then lemmas, then a trailing sentinel
/// so bibliography (if any) lands in its own piece.
pub fn build_pandoc_input(
    frontmatter: Option<&str>,
    chunks: &[&str],
    note_bodies: &[&str],
    lemmas: &[&str],
    sentinel: &str,
) -> String {
    let mut parts: Vec<String> = Vec::new();

    if let Some(fm) = frontmatter {
        parts.push(fm.to_string());
        parts.push("\n\n".to_string());
    }

    for (i, chunk) in chunks.iter().enumerate() {
        if i > 0 {
            parts.push(format!("\n\n{sentinel}\n\n"));
        }
        parts.push(chunk.to_string());
    }

    for note in note_bodies {
        parts.push(format!("\n\n{sentinel}\n\n"));
        parts.push(note.to_string());
    }

    for lemma in lemmas {
        parts.push(format!("\n\n{sentinel}\n\n"));
        parts.push(lemma.to_string());
    }

    parts.push(format!("\n\n{sentinel}\n\n"));

    parts.join("")
}

pub struct SplitOutput {
    pub paragraphs: Vec<String>,
    pub notes: Vec<String>,
    pub lemmas: Vec<String>,
    pub bibliography: Option<String>,
}

pub fn split_pandoc_output(
    latex: &str,
    sentinel: &str,
    n_paras: usize,
    n_notes: usize,
    n_lemmas: usize,
) -> SplitOutput {
    let pieces: Vec<&str> = latex.split(sentinel).collect();
    let notes_end = n_paras + n_notes;
    let total_expected = notes_end + n_lemmas;

    let mut paragraphs = Vec::new();
    let mut notes = Vec::new();
    let mut lemmas = Vec::new();
    let mut bibliography = None;

    for (i, piece) in pieces.iter().enumerate() {
        let trimmed = piece.trim();
        if i < n_paras {
            paragraphs.push(trimmed.to_string());
        } else if i < notes_end {
            notes.push(trimmed.to_string());
        } else if i < total_expected {
            lemmas.push(trimmed.to_string());
        } else {
            let bib = trimmed.to_string();
            if !bib.is_empty() {
                bibliography = Some(bib);
            }
        }
    }

    while paragraphs.len() < n_paras {
        paragraphs.push(String::new());
    }
    while notes.len() < n_notes {
        notes.push(String::new());
    }
    while lemmas.len() < n_lemmas {
        lemmas.push(String::new());
    }

    SplitOutput {
        paragraphs,
        notes,
        lemmas,
        bibliography,
    }
}

// ---------------------------------------------------------------------------
// Placeholder substitution (A11)
// ---------------------------------------------------------------------------

pub fn substitute_footnote_placeholders(
    text: &str,
    nonce: &str,
    footnotes: &[FootnoteEntry],
    converted_notes: &[String],
) -> String {
    let mut result = text.to_string();
    for (i, fn_entry) in footnotes.iter().enumerate() {
        let open = format!("{nonce}FO{i}{nonce}");
        let close = format!("{nonce}FC{i}{nonce}");

        let note_body = converted_notes
            .get(fn_entry.index)
            .map(|s| s.as_str())
            .unwrap_or("");

        if let Some(open_pos) = result.find(&open) {
            let after_open = open_pos + open.len();
            if let Some(close_offset) = result[after_open..].find(&close) {
                let lemma = result[after_open..after_open + close_offset].to_string();
                let replacement = match fn_entry.route {
                    Route::AFootnote => {
                        format!("\\edtext{{{lemma}}}{{\\Afootnote{{{note_body}}}}}")
                    }
                    Route::BFootnote => {
                        format!("\\edtext{{{lemma}}}{{\\Bfootnote{{{note_body}}}}}")
                    }
                    _ => lemma.clone(),
                };
                let full = format!("{open}{lemma}{close}");
                result = result.replacen(&full, &replacement, 1);
            }
        }
    }
    result
}

// ---------------------------------------------------------------------------
// Mark macro substitution (A12)
// ---------------------------------------------------------------------------

pub fn mark_macro(code: &str) -> (&'static str, &'static str) {
    match code {
        "nb" => ("\\textbf{", "}"),
        "it" | "conj" | "dub" => ("\\emph{", "}"),
        "ul" | "em" => ("\\uline{", "}"),
        "st" | "del" => ("\\sout{", "}"),
        "sic" => ("\\uwave{", "}"),
        "sc" => ("\\textsc{", "}"),
        "hi" => ("\\lithl{", "}"),
        "gloss" => ("{\\footnotesize ", "}"),
        "crux" => ("\\textsuperscript{\\dag}", ""),
        "lac" => ("[", "]"),
        "sup" => ("\\textlangle{}", "\\textrangle{}"),
        "interp" => ("\u{27E6}", "\u{27E7}"),
        _ => ("", ""),
    }
}

pub fn substitute_mark_placeholders(text: &str, nonce: &str, marks: &[MarkEntry]) -> String {
    let mut result = text.to_string();
    for (i, mark) in marks.iter().enumerate() {
        let open = format!("{nonce}MO{i}{nonce}");
        let close = format!("{nonce}MC{i}{nonce}");
        let (macro_open, macro_close) = mark_macro(&mark.code);

        if let Some(open_pos) = result.find(&open) {
            let after_open = open_pos + open.len();
            if let Some(close_offset) = result[after_open..].find(&close) {
                let inner = result[after_open..after_open + close_offset].to_string();
                let full = format!("{open}{inner}{close}");
                let replacement = if macro_open.is_empty() && macro_close.is_empty() {
                    inner
                } else {
                    format!("{macro_open}{inner}{macro_close}")
                };
                result = result.replacen(&full, &replacement, 1);
            }
        }
    }
    result
}

/// Replace `{nonce}LB{i}{nonce}` with `\edlabel{lit:i}` for i in 0..n.
pub fn substitute_label_placeholders(text: &str, nonce: &str, n: usize) -> String {
    let mut result = text.to_string();
    for i in 0..n {
        let placeholder = format!("{nonce}LB{i}{nonce}");
        let replacement = format!("\\edlabel{{lit:{i}}}");
        result = result.replace(&placeholder, &replacement);
    }
    result
}

// ---------------------------------------------------------------------------
// Nonce survival guard
// ---------------------------------------------------------------------------

fn contains_block_latex(s: &str) -> bool {
    const BLOCK_CMDS: &[&str] = &[
        "\\chapter",
        "\\section",
        "\\subsection",
        "\\subsubsection",
        "\\paragraph{",
        "\\begin{",
        "\\pstart",
    ];
    BLOCK_CMDS.iter().any(|cmd| s.contains(cmd))
}

pub fn assert_no_residual_nonce(tex: &str, nonce: &str) -> Result<(), String> {
    let count = tex.matches(nonce).count();
    if count > 0 {
        Err(format!(
            "residual placeholder nonce found {count} time(s) in output - substitution incomplete"
        ))
    } else {
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Right-page note rendering (A13)
// ---------------------------------------------------------------------------

/// Render notes for one right-page chunk.
///
/// Format per note:
///   [\textbf{\edlineref{lit:i}} ][\emph{lemma}] ]\textsc{type}<certainty> body
/// - line_numbers off: omit the \edlineref part
/// - empty lemma: omit the lemma + `]` part
pub fn render_right_page_notes(notes: &[AttachedNote], line_numbers: bool) -> String {
    if notes.is_empty() {
        return "~".to_string();
    }
    notes
        .iter()
        .map(|note| {
            let mut key = String::new();
            if line_numbers {
                key.push_str(&format!(
                    "\\textbf{{\\edlineref{{lit:{}}}}}",
                    note.note_index
                ));
            }
            let lemma = note.lemma_latex.as_deref().unwrap_or("");
            if !lemma.is_empty() {
                if !key.is_empty() {
                    key.push(' ');
                }
                key.push_str(&format!("\\emph{{{lemma}}}"));
                key.push(']');
            }
            if !key.is_empty() {
                key.push(' ');
            }

            let label = format!("\\textsc{{{}}}", note.annotation_type);
            let certainty_suffix = match note.certainty {
                Certainty::Tentative => "?",
                Certainty::Firm => "!",
                Certainty::Neutral => "",
            };
            let body = note.body_latex.as_deref().unwrap_or(&note.body_md);
            format!("{key}{label}{certainty_suffix} {body}")
        })
        .collect::<Vec<_>>()
        .join("\n\n\\medskip\n\n")
}

// ---------------------------------------------------------------------------
// Preamble (A14)
// ---------------------------------------------------------------------------

pub struct PreambleOptions {
    pub line_numbers: bool,
    pub cjk_font: Option<String>,
    pub indic_preamble: Option<String>,
    pub extra_preamble: Option<String>,
}

pub fn build_preamble(opts: &PreambleOptions) -> String {
    let mut lines = Vec::new();
    lines.push("\\documentclass[12pt,twoside]{book}".to_string());
    lines.push("\\usepackage{fontspec}".to_string());
    lines.push("\\usepackage{polyglossia}".to_string());

    if let Some(ref font) = opts.cjk_font {
        lines.push("\\usepackage{xeCJK}".to_string());
        lines.push(format!("\\setCJKmainfont{{{font}}}"));
        lines.push("\\IfFileExists{newunicodechar.sty}{%".to_string());
        lines.push("  \\IfFontExistsTF{Apple Symbols}{%".to_string());
        lines.push("    \\usepackage{newunicodechar}%".to_string());
        lines.push("    \\newfontfamily\\litsymbolfont{Apple Symbols}%".to_string());
        for cp in 0x2630u32..=0x2637u32 {
            if let Some(ch) = char::from_u32(cp) {
                lines.push(format!(
                    "    \\newunicodechar{{{ch}}}{{{{\\litsymbolfont {ch}}}}}"
                ));
            }
        }
        lines.push("  }{}%".to_string());
        lines.push("}{}".to_string());
    }

    if let Some(ref indic) = opts.indic_preamble {
        lines.push(indic.clone());
    }

    lines.push("\\usepackage{xcolor}".to_string());
    lines.push("\\usepackage[normalem]{ulem}".to_string());
    lines.push("\\newcommand{\\lithl}[1]{\\colorbox{yellow!30}{#1}}".to_string());
    lines.push("\\usepackage{reledmac}".to_string());
    lines.push("\\usepackage{reledpar}".to_string());

    if opts.line_numbers {
        lines.push("\\firstlinenum{5}".to_string());
        lines.push("\\linenumincrement{5}".to_string());
    } else {
        lines.push("\\firstlinenum{100000}".to_string());
        lines.push("\\linenumincrement{100000}".to_string());
    }

    lines.push("\\firstlinenumR{100000}".to_string());
    lines.push("\\linenumincrementR{100000}".to_string());

    lines.push("\\providecommand{\\phantomsection}{}".to_string());
    lines.push("\\newcommand{\\citeproctext}{}".to_string());
    lines.push("\\newenvironment{CSLReferences}[2]{}{}".to_string());
    lines.push("\\newcommand{\\CSLLeftMargin}[1]{\\noindent #1}".to_string());
    lines.push("\\newcommand{\\CSLRightInline}[1]{#1}".to_string());
    lines.push("\\newcommand{\\CSLIndent}[1]{\\hspace{1.5em}#1}".to_string());

    if let Some(ref extra) = opts.extra_preamble {
        lines.push(extra.clone());
    }

    lines.push(String::new());
    lines.push("\\begin{document}".to_string());
    lines.join("\n")
}

// ---------------------------------------------------------------------------
// Assembly (A15)
// ---------------------------------------------------------------------------

/// Assemble the final .tex. `left_chunks` is (text, para_start); continuation
/// chunks (para_start=false) get a `\noindent ` prefix so they flush left.
pub fn assemble_tex(
    preamble: &str,
    left_chunks: &[(String, bool)],
    right_chunks: &[String],
    bibliography: Option<&str>,
) -> String {
    let mut out = String::new();
    out.push_str(preamble);
    out.push_str("\n\n");

    out.push_str("\\begin{pages}\n");

    out.push_str("\\begin{Leftside}\n");
    out.push_str("\\beginnumbering\n");
    for (text, para_start) in left_chunks {
        if *para_start {
            out.push_str(&format!("\\pstart\n{text}\n\\pend\n"));
        } else {
            out.push_str(&format!("\\pstart\n\\noindent {text}\n\\pend\n"));
        }
    }
    out.push_str("\\endnumbering\n");
    out.push_str("\\end{Leftside}\n\n");

    out.push_str("\\begin{Rightside}\n");
    out.push_str("\\beginnumbering\n");
    for text in right_chunks {
        out.push_str(&format!("\\pstart\n{text}\n\\pend\n"));
    }
    out.push_str("\\endnumbering\n");
    out.push_str("\\end{Rightside}\n");

    out.push_str("\\end{pages}\n");
    out.push_str("\\Pages\n");

    if let Some(bib) = bibliography {
        out.push('\n');
        out.push_str(bib);
        out.push('\n');
    }

    out.push_str("\n\\end{document}\n");
    out
}

// ---------------------------------------------------------------------------
// Tauri command (B3)
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn export_critical_edition(
    request: CriticalEditionRequest,
    window: tauri::Window,
    state: tauri::State<'_, WorkspaceRegistry>,
    app_handle: tauri::AppHandle,
    mark_cache: tauri::State<'_, MarkConfigCache>,
) -> Result<ExportResult, String> {
    let workspace_root = get_workspace_root(&state, window.label())?;
    let input_path = workspace_root.join(&request.relative_path);
    let output_path = PathBuf::from(&request.output_path);

    validate_input(&input_path, &output_path)?;

    let prefs = preferences::read_preferences(&app_handle);
    let pandoc_path = academic_export::validate_pandoc("critical edition export", &prefs)?;

    let content = std::fs::read_to_string(&input_path)
        .map_err(|e| format!("Failed to read input: {e}"))?;

    let routing = resolve_routing(&request.routing);

    let codes = sorted_mark_codes(&mark_cache.merged_config_cached(&workspace_root));
    let annotations = do_parse(&content, &codes);

    // Resolve scopes
    let mut ctxs: HashMap<String, ScopeResolveCtx> = HashMap::new();
    let frontmatter_lang = crate::workspace::frontmatter::parse_frontmatter(&content)
        .map
        .get("annotation-lang")
        .and_then(|v| match v {
            serde_yaml::Value::String(s) => Some(s.clone()),
            _ => None,
        });

    let doc_lang = crate::annotation::lang::effective_lang(
        None,
        frontmatter_lang.as_deref(),
        Some("en"),
    );

    let scopes: Vec<Option<ScopeRange>> = annotations
        .iter()
        .map(|ann| {
            let lang_key = crate::annotation::lang::effective_lang(
                ann.lang.as_deref(),
                frontmatter_lang.as_deref(),
                Some("en"),
            );
            let ctx = ctxs
                .entry(lang_key.clone())
                .or_insert_with(|| ScopeResolveCtx::new(&content, &lang_key));
            ctx.resolve_scope_range(ann.char_start, &ann.scope)
        })
        .collect();

    let transform = transform_document(&content, &annotations, &scopes, &routing, &doc_lang);

    let attached = attach_notes_to_chunks(&transform.right_notes, &transform.chunk_spans);

    let fn_bodies: Vec<String> = transform
        .footnotes
        .iter()
        .map(|f| f.body_md.clone())
        .collect();

    let right_note_bodies: Vec<String> = transform
        .right_notes
        .iter()
        .map(|rn| rn.body_md.clone())
        .collect();

    let lemma_bodies: Vec<String> = transform.lemma_excerpts.clone();

    let sentinel = format!("{}SENT{}", transform.nonce, transform.nonce);

    let fm_owned = if content.starts_with("---") {
        let after = &content[3..];
        after.find("\n---").map(|end| content[..3 + end + 4].to_string())
    } else {
        None
    };

    let chunk_texts: Vec<String> = transform.chunks.iter().map(|c| c.text.clone()).collect();
    let chunk_para_starts: Vec<bool> = transform.chunks.iter().map(|c| c.para_start).collect();
    let chunk_refs: Vec<&str> = chunk_texts.iter().map(|s| s.as_str()).collect();
    let mut all_note_refs: Vec<&str> = fn_bodies.iter().map(|s| s.as_str()).collect();
    for b in &right_note_bodies {
        all_note_refs.push(b.as_str());
    }
    let lemma_refs: Vec<&str> = lemma_bodies.iter().map(|s| s.as_str()).collect();
    let pandoc_input = build_pandoc_input(
        fm_owned.as_deref(),
        &chunk_refs,
        &all_note_refs,
        &lemma_refs,
        &sentinel,
    );

    let resource_dir = app_handle.path().resource_dir().ok();
    let frontmatter = academic_export::extract_export_frontmatter(&input_path);
    let csl = academic_export::resolve_csl(
        request.csl.as_deref(),
        frontmatter.csl.as_deref(),
        &prefs,
        resource_dir.as_deref(),
    );
    let ampersand_filter =
        academic_export::resolve_ampersand_filter("latex", resource_dir.as_deref());

    let cjk_font = academic_export::resolve_cjk_font(
        frontmatter.cjk_mainfont.as_deref(),
        &prefs,
        &content,
    );

    let indic_preamble = {
        let detected = academic_export::detect_indic_scripts(&content);
        if !detected.is_empty() {
            let fonts = academic_export::resolve_indic_fonts(
                &detected,
                frontmatter.indic_font.as_deref(),
                &frontmatter.indic_fonts,
                &prefs,
            );
            academic_export::build_indic_preamble(&fonts, None)
                .ok()
                .map(|f| std::fs::read_to_string(f.path()).unwrap_or_default())
        } else {
            None
        }
    };

    let note_dir = input_path.parent().unwrap_or(&workspace_root).to_path_buf();

    let indic_lua_filter = {
        let detected = academic_export::detect_indic_scripts(&content);
        if !detected.is_empty() {
            let fonts = academic_export::resolve_indic_fonts(
                &detected,
                frontmatter.indic_font.as_deref(),
                &frontmatter.indic_fonts,
                &prefs,
            );
            academic_export::build_indic_lua_filter(&fonts).ok()
        } else {
            None
        }
    };

    let win = window.clone();
    let req_output = request.output_path.clone();
    let line_numbers = request.line_numbers;
    let nonce = transform.nonce.clone();
    let footnotes = transform.footnotes.clone();
    let marks = transform.marks.clone();
    let n_right_notes = transform.right_notes.len();
    let n_chunk_texts = chunk_texts.len();
    let n_fn_bodies = fn_bodies.len();
    let n_right_note_bodies = right_note_bodies.len();
    let n_all_notes = n_fn_bodies + n_right_note_bodies;
    let n_lemmas = lemma_bodies.len();

    let result = tauri::async_runtime::spawn_blocking(move || {
        let _ = win.emit(
            "lit:academic-export-progress",
            AcademicExportProgress {
                stage: "compiling".into(),
                format: "reledmac".into(),
            },
        );

        let mut args = vec![
            "-f".to_string(),
            "markdown".to_string(),
            "-t".to_string(),
            "latex".to_string(),
        ];

        if let Some(ref csl_path) = csl {
            args.push("--citeproc".to_string());
            args.push(format!("--csl={}", csl_path.to_string_lossy()));
        }

        if let Some(ref f) = ampersand_filter {
            args.push(format!("--lua-filter={}", f.to_string_lossy()));
        }

        if let Some(ref lua) = indic_lua_filter {
            args.push(format!("--lua-filter={}", lua.path().to_string_lossy()));
        }

        let resource_path = format!("{}:{}",
            note_dir.to_string_lossy(),
            workspace_root.to_string_lossy());
        args.push("--resource-path".to_string());
        args.push(resource_path);

        let (status, stdout_bytes, stderr_bytes): (std::process::ExitStatus, Vec<u8>, Vec<u8>) =
            academic_export::run_pandoc_with_timeout(
                &pandoc_path,
                &args,
                Some(pandoc_input.as_bytes()),
                std::time::Duration::from_secs(300),
            )?;
        let stderr = String::from_utf8_lossy(&stderr_bytes).to_string();

        if !status.success() {
            return Ok::<ExportResult, String>(ExportResult {
                output_path: req_output,
                success: false,
                stderr,
            });
        }

        let latex_output = String::from_utf8_lossy(&stdout_bytes).to_string();

        let split = split_pandoc_output(
            &latex_output,
            &sentinel,
            n_chunk_texts,
            n_all_notes,
            n_lemmas,
        );

        let fn_notes_latex: Vec<String> = split.notes[..n_fn_bodies.min(split.notes.len())].to_vec();
        let right_notes_latex: Vec<String> = if split.notes.len() > n_fn_bodies {
            split.notes[n_fn_bodies..].to_vec()
        } else {
            Vec::new()
        };

        // Substitution order: footnotes, marks, then labels.
        let left_chunks: Vec<(String, bool)> = split
            .paragraphs
            .iter()
            .enumerate()
            .map(|(i, p)| {
                let p = substitute_footnote_placeholders(
                    p,
                    &nonce,
                    &footnotes,
                    &fn_notes_latex,
                );
                let p = substitute_mark_placeholders(&p, &nonce, &marks);
                let p = substitute_label_placeholders(&p, &nonce, n_right_notes);
                let para_start = chunk_para_starts.get(i).copied().unwrap_or(true);
                (p, para_start)
            })
            .collect();

        // Populate body_latex and lemma_latex on attached notes.
        let attached_with_latex: Vec<AttachedNote> = attached
            .into_iter()
            .enumerate()
            .map(|(i, mut a)| {
                if i < right_notes_latex.len() {
                    a.body_latex = Some(right_notes_latex[i].clone());
                }
                if i < split.lemmas.len() {
                    let lemma = split.lemmas[i].trim().replace('\n', " ");
                    if !lemma.is_empty() && !contains_block_latex(&lemma) {
                        a.lemma_latex = Some(lemma);
                    }
                }
                a
            })
            .collect();

        // Build right-page chunks (one per left chunk).
        let n_chunks = left_chunks.len();
        let mut right_chunks: Vec<String> = (0..n_chunks)
            .map(|ci| {
                let notes_for_chunk: Vec<AttachedNote> = attached_with_latex
                    .iter()
                    .filter(|a| a.chunk_index == ci)
                    .cloned()
                    .collect();
                render_right_page_notes(&notes_for_chunk, line_numbers)
            })
            .collect();

        while right_chunks.len() < left_chunks.len() {
            right_chunks.push("~".to_string());
        }

        let extra_preamble = academic_export::resolve_preamble("latex", resource_dir.as_deref())
            .and_then(|p| std::fs::read_to_string(&p).ok());
        let preamble = build_preamble(&PreambleOptions {
            line_numbers,
            cjk_font,
            indic_preamble,
            extra_preamble,
        });

        let tex = assemble_tex(
            &preamble,
            &left_chunks,
            &right_chunks,
            split.bibliography.as_deref(),
        );

        if let Err(msg) = assert_no_residual_nonce(&tex, &nonce) {
            return Ok(ExportResult {
                output_path: req_output,
                success: false,
                stderr: msg,
            });
        }

        std::fs::write(&req_output, &tex)
            .map_err(|e| format!("Failed to write output: {e}"))?;

        let _ = win.emit(
            "lit:academic-export-progress",
            AcademicExportProgress {
                stage: "done".into(),
                format: "reledmac".into(),
            },
        );

        Ok(ExportResult {
            output_path: req_output,
            success: true,
            stderr,
        })
    })
    .await
    .map_err(|e| format!("task join error: {e}"))??;

    Ok(result)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::annotation::types::{AnnotationForm, Scope};
    use std::process::Command;

    fn make_annotation(
        ann_type: AnnotationType,
        certainty: Certainty,
        scope: Scope,
        body: Option<&str>,
        char_start: usize,
        char_end: usize,
        mark: Option<&str>,
    ) -> Annotation {
        Annotation {
            form: AnnotationForm::Compact,
            annotation_type: ann_type,
            certainty,
            scope,
            body: body.map(|s| s.to_string()),
            date: None,
            is_structured: true,
            char_start,
            char_end,
            original: String::new(),
            uuid: None,
            mark: mark.map(|s| s.to_string()),
            lang: None,
        }
    }

    // --- Cycle 1: lemma excerpts ---

    #[test]
    fn lemma_excerpt_plain() {
        let body = "Hello world, this is fine.";
        let s = lemma_excerpt(body, &ScopeRange { start: 0, end: 11 });
        assert_eq!(s, "Hello world");
    }

    #[test]
    fn lemma_excerpt_truncates_latin_at_word_boundary() {
        let body = "The quick brown fox jumps over the lazy dog and then some more words here.";
        let s = lemma_excerpt(body, &ScopeRange { start: 0, end: body.len() });
        assert!(s.ends_with('…'), "got {s:?}");
        assert!(!s.contains("more words"), "should be truncated: {s:?}");
        // Must not end mid-word (ellipsis follows a full word).
        let without = s.trim_end_matches('…');
        assert!(!without.ends_with(|c: char| c.is_ascii_alphabetic() && without.chars().count() == LEMMA_MAX_CHARS),
            "unexpected: {s:?}");
        assert!(without.chars().count() <= LEMMA_MAX_CHARS);
    }

    #[test]
    fn lemma_excerpt_truncates_cjk_at_char_boundary() {
        // 50 CJK chars
        let body: String = "仁".repeat(50);
        let s = lemma_excerpt(&body, &ScopeRange { start: 0, end: body.len() });
        assert!(s.ends_with('…'));
        let without = s.trim_end_matches('…');
        assert_eq!(without.chars().count(), LEMMA_MAX_CHARS);
        // Must be valid UTF-8 / only full chars.
        assert!(without.chars().all(|c| c == '仁'));
    }

    #[test]
    fn lemma_excerpt_empty_range() {
        let body = "Hello world";
        assert_eq!(lemma_excerpt(body, &ScopeRange { start: 5, end: 5 }), "");
    }

    #[test]
    fn lemma_excerpt_preserves_markdown() {
        let body = "See *emphasis* and **bold** here.";
        let s = lemma_excerpt(body, &ScopeRange { start: 0, end: body.len() });
        assert!(s.contains("*emphasis*"));
        assert!(s.contains("**bold**"));
    }

    // --- Cycle 2: chunking ---

    #[test]
    fn chunk_spans_short_paragraph_single() {
        let body = "Hello world. Short.";
        let paras = split_paragraphs(body);
        let spans = chunk_spans(body, &paras, &[], &[], "en", MAX_CHUNK_WIDTH);
        assert_eq!(spans.len(), 1);
        assert!(spans[0].para_start);
        assert_eq!(spans[0].start, 0);
        assert_eq!(spans[0].end, body.len());
    }

    #[test]
    fn chunk_spans_long_paragraph_splits_at_sentences() {
        // Many short sentences so width cap forces splits at sentence boundaries.
        let sent = "This is a short sentence. ";
        let body = sent.repeat(40); // well over 400 width
        let paras = split_paragraphs(&body);
        let spans = chunk_spans(&body, &paras, &[], &[], "en", MAX_CHUNK_WIDTH);
        assert!(spans.len() > 1, "expected multiple chunks, got {}", spans.len());
        assert!(spans[0].para_start);
        assert!(!spans[1].para_start);
        // Spans tile the paragraph exactly.
        assert_eq!(spans[0].start, paras[0].start);
        assert_eq!(spans.last().unwrap().end, paras[0].end);
        for w in spans.windows(2) {
            assert_eq!(w[0].end, w[1].start);
        }
    }

    #[test]
    fn chunk_spans_anchored_sentence_starts_chunk() {
        let body = "First sentence here. Second sentence here. Third sentence here.";
        let paras = split_paragraphs(body);
        // Anchor inside "Second sentence here."
        let anchor = body.find("Second").unwrap();
        let spans = chunk_spans(body, &paras, &[anchor], &[], "en", MAX_CHUNK_WIDTH);
        assert!(spans.len() >= 2, "got {} spans", spans.len());
        // Some chunk should start at the second sentence.
        assert!(
            spans.iter().any(|s| s.start == anchor || body[s.start..].starts_with("Second")),
            "spans: {:?}", spans
        );
    }

    #[test]
    fn chunk_spans_two_anchors_adjacent_sentences() {
        let body = "Alpha sentence one. Beta sentence two. Gamma sentence three.";
        let paras = split_paragraphs(body);
        let a1 = body.find("Alpha").unwrap();
        let a2 = body.find("Beta").unwrap();
        let spans = chunk_spans(body, &paras, &[a1, a2], &[], "en", MAX_CHUNK_WIDTH);
        // At least two chunks: one starting at Alpha, one at Beta.
        assert!(spans.len() >= 2);
        let starts: Vec<&str> = spans.iter().map(|s| body[s.start..].split_whitespace().next().unwrap_or("")).collect();
        assert!(starts.iter().any(|s| *s == "Alpha"), "starts={starts:?}");
        assert!(starts.iter().any(|s| *s == "Beta"), "starts={starts:?}");
    }

    #[test]
    fn chunk_spans_cjk_splits_at_ideographic_full_stop() {
        let body = "这是第一句话。这是第二句话。这是第三句话。";
        let paras = split_paragraphs(body);
        let spans = chunk_spans(body, &paras, &[], &[], "zh", 10); // tiny width forces splits
        assert!(spans.len() > 1, "expected CJK split, got {} spans", spans.len());
        for w in spans.windows(2) {
            assert_eq!(w[0].end, w[1].start);
        }
    }

    #[test]
    fn chunk_spans_heading_never_splits() {
        let body = "# A Very Long Heading That Would Exceed Any Reasonable Width Cap If Split";
        let paras = split_paragraphs(body);
        let spans = chunk_spans(body, &paras, &[], &[], "en", 10);
        assert_eq!(spans.len(), 1);
        assert!(spans[0].para_start);
    }

    #[test]
    fn chunk_spans_list_never_splits() {
        let body = "- item one that is quite long and would split if it were prose content here";
        let paras = split_paragraphs(body);
        let spans = chunk_spans(body, &paras, &[], &[], "en", 10);
        assert_eq!(spans.len(), 1);
    }

    #[test]
    fn chunk_spans_never_splits_injection_range() {
        let body = "First sentence here. Second sentence here. Third sentence here.";
        let paras = split_paragraphs(body);
        // Injection covering the boundary between first and second sentence.
        let boundary = body.find("Second").unwrap();
        let inj = vec![(boundary - 5, boundary + 5)];
        let spans = chunk_spans(body, &paras, &[boundary], &inj, "en", MAX_CHUNK_WIDTH);
        for s in &spans {
            assert!(
                !inj.iter().any(|&(a, b)| s.start > a && s.start < b),
                "chunk start {} landed inside injection {:?}", s.start, inj
            );
        }
    }

    // --- Cycle 4: label substitution ---

    #[test]
    fn substitute_label_placeholders_replaces() {
        let nonce = "XTEST";
        let text = format!("ab {nonce}LB0{nonce} cd {nonce}LB1{nonce} ef");
        let out = substitute_label_placeholders(&text, nonce, 2);
        assert_eq!(out, "ab \\edlabel{lit:0} cd \\edlabel{lit:1} ef");
    }

    #[test]
    fn substitute_label_placeholders_noop_when_absent() {
        let out = substitute_label_placeholders("no labels here", "XTEST", 3);
        assert_eq!(out, "no labels here");
    }

    // --- Cycle 3: label injections in transform ---

    #[test]
    fn transform_right_note_injects_label_placeholder() {
        let content = "Hello world. <!--- n | This is a note. ---> More text.";
        let ann = make_annotation(
            AnnotationType::Note,
            Certainty::Neutral,
            Scope::Sentence(1),
            Some("This is a note."),
            13,
            43,
            None,
        );
        let scope = Some(ScopeRange { start: 0, end: 12 });
        let result = transform_document(content, &[ann], &[scope], &default_routing(), "en");
        assert_eq!(result.right_notes.len(), 1);
        let nonce = &result.nonce;
        let body = result.body();
        let lb = format!("{nonce}LB0{nonce}");
        assert_eq!(body.matches(&lb).count(), 1, "exactly one label placeholder");
        // Label at scope start ("Hello world.")
        assert!(body.starts_with(&lb) || body.contains(&format!("{lb}Hello")),
            "label should be at scope start, body={body:?}");
        assert_eq!(result.lemma_excerpts.len(), 1);
        assert!(result.lemma_excerpts[0].contains("Hello world"));
        assert!(!result.chunks.is_empty());
        assert!(result.chunks[0].para_start);
    }

    #[test]
    fn transform_label_sorts_before_open_at_same_pos() {
        // Right note and footnote sharing the same scope start: label before FO.
        let content = "Hello world. <!--- n | Note. ---> <!--- app | App. --->";
        let n_start = content.find("<!--- n").unwrap();
        let n_end = content.find("Note. --->").unwrap() + "Note. --->".len();
        let a_start = content.find("<!--- app").unwrap();
        let a_end = content.len();
        let ann_n = make_annotation(
            AnnotationType::Note, Certainty::Neutral, Scope::Words(1),
            Some("Note."), n_start, n_end, None,
        );
        let ann_a = make_annotation(
            AnnotationType::Apparatus, Certainty::Neutral, Scope::Words(1),
            Some("App."), a_start, a_end, None,
        );
        // Both scope to "Hello" [0,5)
        let scopes = vec![
            Some(ScopeRange { start: 0, end: 5 }),
            Some(ScopeRange { start: 0, end: 5 }),
        ];
        let result = transform_document(content, &[ann_n, ann_a], &scopes, &default_routing(), "en");
        let nonce = &result.nonce;
        let body = result.body();
        let lb = format!("{nonce}LB0{nonce}");
        let fo = format!("{nonce}FO0{nonce}");
        let pos_lb = body.find(&lb).expect("label");
        let pos_fo = body.find(&fo).expect("footnote open");
        assert!(pos_lb < pos_fo, "label should sort before open: body={body:?}");
    }

    // --- Cycle A1: routing defaults ---

    #[test]
    fn default_routing_maps_n_to_right() {
        assert_eq!(default_routing()["n"], Route::Right);
    }

    #[test]
    fn default_routing_maps_tr_to_right() {
        assert_eq!(default_routing()["tr"], Route::Right);
    }

    #[test]
    fn default_routing_maps_app_to_afootnote() {
        assert_eq!(default_routing()["app"], Route::AFootnote);
    }

    #[test]
    fn default_routing_maps_cf_to_bfootnote() {
        assert_eq!(default_routing()["cf"], Route::BFootnote);
    }

    #[test]
    fn default_routing_maps_q_todo_llm_th_to_suppress() {
        let r = default_routing();
        assert_eq!(r["q"], Route::Suppress);
        assert_eq!(r["todo"], Route::Suppress);
        assert_eq!(r["llm"], Route::Suppress);
        assert_eq!(r["th"], Route::Suppress);
    }

    // --- Cycle A2: routing overrides ---

    #[test]
    fn resolve_routing_overrides_known_types() {
        let mut ov = HashMap::new();
        ov.insert("q".into(), "right".into());
        ov.insert("app".into(), "suppress".into());
        let r = resolve_routing(&ov);
        assert_eq!(r["q"], Route::Right);
        assert_eq!(r["app"], Route::Suppress);
    }

    #[test]
    fn resolve_routing_unknown_route_string_falls_back() {
        let mut ov = HashMap::new();
        ov.insert("n".into(), "bogus".into());
        assert_eq!(resolve_routing(&ov)["n"], Route::Right);
    }

    #[test]
    fn resolve_routing_unknown_type_key_ignored() {
        let mut ov = HashMap::new();
        ov.insert("xyzzy".into(), "right".into());
        assert!(!resolve_routing(&ov).contains_key("xyzzy"));
    }

    #[test]
    fn resolve_routing_preserves_defaults_for_unmentioned() {
        let r = resolve_routing(&HashMap::new());
        assert_eq!(r["tr"], Route::Right);
        assert_eq!(r["cf"], Route::BFootnote);
    }

    // --- Cycle 14: bare and sn routing ---

    #[test]
    fn default_routing_maps_bare_to_right() {
        assert_eq!(default_routing()["bare"], Route::Right);
    }

    #[test]
    fn default_routing_maps_sn_to_parent() {
        assert_eq!(default_routing()["sn"], Route::Parent);
    }

    #[test]
    fn resolve_routing_accepts_parent() {
        let mut ov = HashMap::new();
        ov.insert("sn".into(), "parent".into());
        assert_eq!(resolve_routing(&ov)["sn"], Route::Parent);
    }

    #[test]
    fn transform_bare_surfaces_as_right_note() {
        let content = "Hello world. <!--- bare | Bare note. --->";
        let ann_start = content.find("<!---").unwrap();
        let ann_end = content.len();
        let ann = make_annotation(
            AnnotationType::Bare,
            Certainty::Neutral,
            Scope::Sentence(1),
            Some("Bare note."),
            ann_start,
            ann_end,
            None,
        );
        let scope = Some(ScopeRange { start: 0, end: 12 });
        let result = transform_document(content, &[ann], &[scope], &default_routing(), "en");
        assert_eq!(result.right_notes.len(), 1);
        assert_eq!(result.right_notes[0].annotation_type, "bare");
        assert_eq!(result.right_notes[0].body_md, "Bare note.");
    }

    // --- Cycle A3: annotation stripping ---

    #[test]
    fn transform_strips_annotations_no_placeholders_when_right_routed() {
        let content = "Hello world. <!--- n | This is a note. ---> More text.";
        let ann = make_annotation(
            AnnotationType::Note,
            Certainty::Neutral,
            Scope::Sentence(1),
            Some("This is a note."),
            13,
            43,
            None,
        );
        let scope = Some(ScopeRange { start: 0, end: 12 });
        let result = transform_document(content, &[ann], &[scope], &default_routing(), "en");
        assert!(!result.body().contains("<!---"));
        assert!(!result.body().contains("--->"));
        assert!(result.body().contains("Hello world."));
        assert!(result.body().contains("More text."));
        assert!(result.footnotes.is_empty());
        assert_eq!(result.right_notes.len(), 1);
    }

    // --- Cycle A4: single-paragraph footnote wrapping ---

    #[test]
    fn transform_wraps_afootnote_with_placeholders() {
        let content = "Hello world. <!--- app | Apparatus note. --->";
        let ann_start = content.find("<!---").unwrap();
        let ann_end = content.len();
        let ann = make_annotation(
            AnnotationType::Apparatus,
            Certainty::Neutral,
            Scope::Words(1),
            Some("Apparatus note."),
            ann_start,
            ann_end,
            None,
        );
        let scope = Some(ScopeRange { start: 6, end: 11 });
        let result = transform_document(content, &[ann], &[scope], &default_routing(), "en");
        assert_eq!(result.footnotes.len(), 1);
        assert_eq!(result.footnotes[0].route, Route::AFootnote);
        let nonce = &result.nonce;
        assert!(result.body().contains(&format!("{nonce}FO0{nonce}")));
        assert!(result.body().contains(&format!("{nonce}FC0{nonce}")));
    }

    // --- Cycle A5: nesting allowed, overlap degrades ---

    #[test]
    fn transform_nested_ranges_both_wrapped() {
        let content =
            "The quick brown fox jumps. <!--- app | Outer. ---> <!--- app | Inner. --->";
        let a1_start = content.find("<!--- app | Outer").unwrap();
        let a1_end = content.find("Outer. --->").unwrap() + "Outer. --->".len();
        let a2_start = content.find("<!--- app | Inner").unwrap();
        let a2_end = content.len();
        let ann_outer = make_annotation(
            AnnotationType::Apparatus,
            Certainty::Neutral,
            Scope::Sentence(1),
            Some("Outer."),
            a1_start,
            a1_end,
            None,
        );
        let ann_inner = make_annotation(
            AnnotationType::Apparatus,
            Certainty::Neutral,
            Scope::Words(1),
            Some("Inner."),
            a2_start,
            a2_end,
            None,
        );
        let scopes = vec![
            Some(ScopeRange { start: 0, end: 26 }),
            Some(ScopeRange { start: 4, end: 9 }),
        ];
        let result = transform_document(content, &[ann_outer, ann_inner], &scopes, &default_routing(), "en");
        assert_eq!(result.footnotes.len(), 2);

        let nonce = &result.nonce;
        let fo0 = format!("{nonce}FO0{nonce}");
        let fc0 = format!("{nonce}FC0{nonce}");
        let fo1 = format!("{nonce}FO1{nonce}");
        let fc1 = format!("{nonce}FC1{nonce}");
        // All four placeholders must appear intact in the body
        assert!(result.body().contains(&fo0), "FO0 missing");
        assert!(result.body().contains(&fc0), "FC0 missing");
        assert!(result.body().contains(&fo1), "FO1 missing");
        assert!(result.body().contains(&fc1), "FC1 missing");
        // Nesting order: FO0 < FO1 < FC1 < FC0
        let pos_fo0 = result.body().find(&fo0).unwrap();
        let pos_fo1 = result.body().find(&fo1).unwrap();
        let pos_fc1 = result.body().find(&fc1).unwrap();
        let pos_fc0 = result.body().find(&fc0).unwrap();
        assert!(pos_fo0 < pos_fo1, "FO0 should come before FO1");
        assert!(pos_fo1 < pos_fc1, "FO1 should come before FC1");
        assert!(pos_fc1 < pos_fc0, "FC1 should come before FC0");
    }

    #[test]
    fn transform_overlapping_ranges_second_degrades() {
        let content = "ABCDE. <!--- app | First. ---> <!--- app | Second. --->";
        let a1_start = content.find("<!--- app | First").unwrap();
        let a1_end = content.find("First. --->").unwrap() + "First. --->".len();
        let a2_start = content.find("<!--- app | Second").unwrap();
        let a2_end = content.len();
        let ann1 = make_annotation(
            AnnotationType::Apparatus,
            Certainty::Neutral,
            Scope::Words(1),
            Some("First."),
            a1_start,
            a1_end,
            None,
        );
        let ann2 = make_annotation(
            AnnotationType::Apparatus,
            Certainty::Neutral,
            Scope::Words(1),
            Some("Second."),
            a2_start,
            a2_end,
            None,
        );
        let scopes = vec![
            Some(ScopeRange { start: 0, end: 4 }),
            Some(ScopeRange { start: 2, end: 6 }),
        ];
        let result = transform_document(content, &[ann1, ann2], &scopes, &default_routing(), "en");
        assert_eq!(result.footnotes.len(), 1);
        assert_eq!(result.right_notes.len(), 1);
    }

    // --- Cycle 5: cross-kind partial overlap ---

    #[test]
    fn transform_mark_partially_overlapping_footnote_skipped() {
        // footnote scope [0,4), mark scope [2,6) - partial overlap
        let content = "ABCDEF. <!--- app | Foot. ---> <!--- hi _ --->";
        let a1_start = content.find("<!--- app").unwrap();
        let a1_end = content.find("Foot. --->").unwrap() + "Foot. --->".len();
        let a2_start = content.find("<!--- hi").unwrap();
        let a2_end = content.len();
        let ann1 = make_annotation(
            AnnotationType::Apparatus,
            Certainty::Neutral,
            Scope::Words(1),
            Some("Foot."),
            a1_start,
            a1_end,
            None,
        );
        let ann2 = make_annotation(
            AnnotationType::Mark,
            Certainty::Neutral,
            Scope::Words(2),
            None,
            a2_start,
            a2_end,
            Some("hi"),
        );
        let scopes = vec![
            Some(ScopeRange { start: 0, end: 4 }),
            Some(ScopeRange { start: 2, end: 6 }),
        ];
        let result = transform_document(content, &[ann1, ann2], &scopes, &default_routing(), "en");
        assert_eq!(result.footnotes.len(), 1, "footnote should stay");
        assert!(result.marks.is_empty(), "mark should be skipped due to partial overlap");
    }

    #[test]
    fn transform_footnote_partially_overlapping_mark_degrades() {
        // mark scope [0,4), footnote scope [2,6) - partial overlap
        let content = "ABCDEF. <!--- hi _ ---> <!--- app | Foot. --->";
        let a1_start = content.find("<!--- hi").unwrap();
        let a1_end = content.find("_ --->").unwrap() + "_ --->".len();
        let a2_start = content.find("<!--- app").unwrap();
        let a2_end = content.len();
        let ann1 = make_annotation(
            AnnotationType::Mark,
            Certainty::Neutral,
            Scope::Words(1),
            None,
            a1_start,
            a1_end,
            Some("hi"),
        );
        let ann2 = make_annotation(
            AnnotationType::Apparatus,
            Certainty::Neutral,
            Scope::Words(2),
            Some("Foot."),
            a2_start,
            a2_end,
            None,
        );
        let scopes = vec![
            Some(ScopeRange { start: 0, end: 4 }),
            Some(ScopeRange { start: 2, end: 6 }),
        ];
        let result = transform_document(content, &[ann1, ann2], &scopes, &default_routing(), "en");
        assert_eq!(result.marks.len(), 1, "mark should stay");
        assert!(result.footnotes.is_empty(), "footnote should degrade");
        assert_eq!(result.right_notes.len(), 1, "footnote degraded to right note");
    }

    // --- Cycle A6: cross-paragraph footnote degrades, mark skipped ---

    #[test]
    fn transform_cross_paragraph_footnote_degrades_to_right() {
        let content = "First paragraph.\n\nSecond paragraph. <!--- app | Cross. --->";
        let a_start = content.find("<!---").unwrap();
        let a_end = content.len();
        let ann = make_annotation(
            AnnotationType::Apparatus,
            Certainty::Neutral,
            Scope::Paragraph(2),
            Some("Cross."),
            a_start,
            a_end,
            None,
        );
        let scope = Some(ScopeRange { start: 0, end: 35 });
        let result = transform_document(content, &[ann], &[scope], &default_routing(), "en");
        assert!(result.footnotes.is_empty());
        assert_eq!(result.right_notes.len(), 1);
    }

    #[test]
    fn transform_cross_paragraph_mark_skipped() {
        let content = "First paragraph.\n\nSecond paragraph. <!--- hi _ --->";
        let a_start = content.find("<!---").unwrap();
        let a_end = content.len();
        let ann = make_annotation(
            AnnotationType::Mark,
            Certainty::Neutral,
            Scope::Paragraph(2),
            None,
            a_start,
            a_end,
            Some("hi"),
        );
        let scope = Some(ScopeRange { start: 0, end: 35 });
        let result = transform_document(content, &[ann], &[scope], &default_routing(), "en");
        assert!(result.marks.is_empty());
    }

    // --- Cycle A7: mark wrapping ---

    #[test]
    fn transform_wraps_mark_with_placeholders() {
        let content = "Hello world. <!--- hi _ --->";
        let a_start = content.find("<!---").unwrap();
        let a_end = content.len();
        let ann = make_annotation(
            AnnotationType::Mark,
            Certainty::Neutral,
            Scope::Words(1),
            None,
            a_start,
            a_end,
            Some("hi"),
        );
        let scope = Some(ScopeRange { start: 6, end: 11 });
        let result = transform_document(content, &[ann], &[scope], &default_routing(), "en");
        assert_eq!(result.marks.len(), 1);
        assert_eq!(result.marks[0].code, "hi");
        let nonce = &result.nonce;
        assert!(result.body().contains(&format!("{nonce}MO0{nonce}")));
        assert!(result.body().contains(&format!("{nonce}MC0{nonce}")));
    }

    // --- Cycle A8: paragraph split + frontmatter skip ---

    #[test]
    fn split_paragraphs_skips_frontmatter() {
        let content = "---\ntitle: Test\n---\n\nFirst paragraph.\n\nSecond paragraph.\n\nThird paragraph.";
        let paras = split_paragraphs(content);
        assert_eq!(paras.len(), 3);
        assert_eq!(&content[paras[0].start..paras[0].end], "First paragraph.");
        assert_eq!(
            &content[paras[1].start..paras[1].end],
            "Second paragraph."
        );
        assert_eq!(&content[paras[2].start..paras[2].end], "Third paragraph.");
    }

    #[test]
    fn split_paragraphs_no_frontmatter() {
        let content = "First.\n\nSecond.\n\nThird.";
        let paras = split_paragraphs(content);
        assert_eq!(paras.len(), 3);
        assert_eq!(paras[0].index, 0);
        assert_eq!(paras[1].index, 1);
        assert_eq!(paras[2].index, 2);
    }

    #[test]
    fn split_paragraphs_multiline_paragraph() {
        let content = "Line one\nline two\n\nNext para.";
        let paras = split_paragraphs(content);
        assert_eq!(paras.len(), 2);
        assert_eq!(
            &content[paras[0].start..paras[0].end],
            "Line one\nline two"
        );
    }

    // --- Cycle A9: note-to-chunk attachment ---

    #[test]
    fn attach_notes_scope_start_inside_chunk() {
        let chunks = vec![
            ChunkSpan { start: 0, end: 16, para_start: true },
            ChunkSpan { start: 16, end: 35, para_start: false },
        ];
        let notes = vec![RightNote {
            note_index: 0,
            annotation_type: "n".into(),
            certainty: Certainty::Neutral,
            body_md: "A note.".into(),
            scope_range: ScopeRange { start: 5, end: 10 },
        }];
        let attached = attach_notes_to_chunks(&notes, &chunks);
        assert_eq!(attached.len(), 1);
        assert_eq!(attached[0].chunk_index, 0);
        assert_eq!(attached[0].note_index, 0);
    }

    #[test]
    fn attach_notes_second_chunk() {
        let chunks = vec![
            ChunkSpan { start: 0, end: 16, para_start: true },
            ChunkSpan { start: 16, end: 35, para_start: false },
        ];
        let notes = vec![RightNote {
            note_index: 0,
            annotation_type: "n".into(),
            certainty: Certainty::Neutral,
            body_md: "A note.".into(),
            scope_range: ScopeRange { start: 20, end: 30 },
        }];
        let attached = attach_notes_to_chunks(&notes, &chunks);
        assert_eq!(attached[0].chunk_index, 1);
    }

    #[test]
    fn attach_notes_empty_range_by_position() {
        let chunks = vec![
            ChunkSpan { start: 0, end: 16, para_start: true },
            ChunkSpan { start: 16, end: 35, para_start: false },
        ];
        let notes = vec![RightNote {
            note_index: 0,
            annotation_type: "n".into(),
            certainty: Certainty::Neutral,
            body_md: "Orphan.".into(),
            scope_range: ScopeRange { start: 18, end: 18 },
        }];
        let attached = attach_notes_to_chunks(&notes, &chunks);
        assert_eq!(attached[0].chunk_index, 1);
    }

    #[test]
    fn attach_notes_out_of_range_falls_back_to_last() {
        let chunks = vec![
            ChunkSpan { start: 0, end: 16, para_start: true },
            ChunkSpan { start: 16, end: 35, para_start: false },
        ];
        let notes = vec![RightNote {
            note_index: 0,
            annotation_type: "n".into(),
            certainty: Certainty::Neutral,
            body_md: "Far.".into(),
            scope_range: ScopeRange { start: 999, end: 999 },
        }];
        let attached = attach_notes_to_chunks(&notes, &chunks);
        assert_eq!(attached[0].chunk_index, 1);
    }

    // --- Cycle 13: scope-resolution failure fallback ---

    #[test]
    fn transform_none_scope_surfaces_as_right_note() {
        let content = "Hello world. <!--- n | Orphan note. --->";
        let ann_start = content.find("<!---").unwrap();
        let ann_end = content.len();
        let ann = make_annotation(
            AnnotationType::Note,
            Certainty::Neutral,
            Scope::Sentence(1),
            Some("Orphan note."),
            ann_start,
            ann_end,
            None,
        );
        let scopes = vec![None]; // scope resolution failed
        let result = transform_document(content, &[ann], &scopes, &default_routing(), "en");
        assert_eq!(result.right_notes.len(), 1, "should surface as right note");
        assert_eq!(result.right_notes[0].body_md, "Orphan note.");
    }

    // --- Cycle 12: chunk attachment on transformed coordinates ---

    #[test]
    fn attach_notes_uses_transformed_coordinates() {
        // A block-form annotation sits between two prose paragraphs, occupying
        // its own paragraph in the original. After transform, it's deleted.
        // A right note scoped to the 2nd prose paragraph must attach to a later
        // chunk (not the first).
        let content = "First paragraph.\n\n<!--- n | Block note. --->\n\nSecond paragraph.";
        let ann = make_annotation(
            AnnotationType::Note,
            Certainty::Neutral,
            Scope::Paragraph(1),
            Some("Block note."),
            18, // start of <!---
            47, // end of --->
            None,
        );
        // Another note scoped to "Second paragraph" (original positions)
        let ann2 = make_annotation(
            AnnotationType::Note,
            Certainty::Neutral,
            Scope::Sentence(1),
            Some("About second."),
            49, // start of "Second"
            49 + 17, // dummy end
            None,
        );
        let scope1 = Some(ScopeRange { start: 0, end: 16 }); // "First paragraph."
        let scope2 = Some(ScopeRange { start: 49, end: 66 }); // "Second paragraph."
        let routing = default_routing();
        let result = transform_document(content, &[ann, ann2], &[scope1, scope2], &routing, "en");

        assert!(result.chunks.len() >= 2, "should have >=2 chunks after stripping block annotation");

        let attached = attach_notes_to_chunks(&result.right_notes, &result.chunk_spans);
        assert!(!attached.is_empty(), "should have at least one attached note");
        let second_note = attached.iter().find(|a| a.body_md == "About second.");
        assert!(second_note.is_some(), "note about second paragraph should be attached");
        assert!(second_note.unwrap().chunk_index >= 1,
            "note should attach to a chunk after the first (got {})",
            second_note.unwrap().chunk_index);
    }

    // --- Cycle A10: sentinel batch build + split ---

    #[test]
    fn build_pandoc_input_roundtrip() {
        let sentinel = "%%SENTINEL%%";
        let input = build_pandoc_input(
            Some("---\ntitle: T\n---"),
            &["Para one.", "Para two."],
            &["Note body."],
            &[],
            sentinel,
        );
        assert!(input.contains("---\ntitle: T\n---"));
        assert!(input.contains("Para one."));
        assert!(input.contains("Para two."));
        assert!(input.contains("Note body."));
        // Sentinels: (n_chunks - 1) between chunks + n_notes + n_lemmas + 1 trailing
        // = 1 + 1 + 0 + 1 = 3. No sentinel between frontmatter and chunk 0.
        assert_eq!(input.matches(sentinel).count(), 3);
        // Frontmatter followed by plain \n\n, NOT by sentinel
        let fm_end = input.find("---\ntitle: T\n---").unwrap() + "---\ntitle: T\n---".len();
        let after_fm = &input[fm_end..];
        assert!(after_fm.starts_with("\n\n"), "fm should be followed by \\n\\n, not sentinel");
        assert!(!after_fm.starts_with(&format!("\n\n{sentinel}")),
            "no sentinel between frontmatter and first paragraph");
        // Trailing sentinel exists (so bibliography gets its own piece)
        assert!(input.ends_with(&format!("\n\n{sentinel}\n\n")),
            "must end with trailing sentinel");
    }

    #[test]
    fn build_pandoc_input_with_lemmas() {
        let sentinel = "%%S%%";
        let input = build_pandoc_input(
            None,
            &["Chunk."],
            &["Note."],
            &["Lemma text."],
            sentinel,
        );
        // 0 between-chunk + 1 note + 1 lemma + 1 trailing = 3
        assert_eq!(input.matches(sentinel).count(), 3);
        assert!(input.contains("Lemma text."));
    }

    #[test]
    fn split_pandoc_output_with_lemmas() {
        let sentinel = "%%S%%";
        let latex = "chunk%%S%%note%%S%%lemma%%S%%bib";
        let split = split_pandoc_output(latex, sentinel, 1, 1, 1);
        assert_eq!(split.paragraphs[0], "chunk");
        assert_eq!(split.notes[0], "note");
        assert_eq!(split.lemmas[0], "lemma");
        assert_eq!(split.bibliography.as_deref(), Some("bib"));
    }

    #[test]
    fn split_pandoc_output_lemma_shortfall_pads() {
        let split = split_pandoc_output("c%%S%%n%%S%%", "%%S%%", 1, 1, 2);
        assert_eq!(split.lemmas.len(), 2);
        assert_eq!(split.lemmas[0], "");
        assert_eq!(split.lemmas[1], "");
    }

    #[test]
    fn build_pandoc_input_no_fm_has_trailing_sentinel() {
        let sentinel = "%%S%%";
        let input = build_pandoc_input(None, &["Only para."], &[], &[], sentinel);
        // 0 between-para sentinels + 0 note sentinels + 1 trailing = 1
        assert_eq!(input.matches(sentinel).count(), 1);
        assert!(input.ends_with(&format!("\n\n{sentinel}\n\n")));
    }

    #[test]
    fn split_pandoc_output_recovers_pieces() {
        let sentinel = "%%S%%";
        let latex =
            "converted para1%%S%%converted para2%%S%%converted note%%S%%bibliography here";
        let split = split_pandoc_output(latex, sentinel, 2, 1, 0);
        assert_eq!(split.paragraphs[0], "converted para1");
        assert_eq!(split.paragraphs[1], "converted para2");
        assert_eq!(split.notes[0], "converted note");
        assert_eq!(split.bibliography.as_deref(), Some("bibliography here"));
    }

    #[test]
    fn split_pandoc_output_no_bibliography() {
        let split = split_pandoc_output("p1%%S%%p2%%S%%", "%%S%%", 2, 0, 0);
        assert_eq!(split.paragraphs.len(), 2);
        assert!(split.bibliography.is_none());
    }

    #[test]
    fn split_pandoc_output_fm_consumed_by_pandoc() {
        // pandoc consumes frontmatter, so piece 0 is para 0 (not empty)
        let sentinel = "%%S%%";
        let latex = "para one%%S%%para two%%S%%note body%%S%%";
        let split = split_pandoc_output(latex, sentinel, 2, 1, 0);
        assert_eq!(split.paragraphs[0], "para one");
        assert_eq!(split.paragraphs[1], "para two");
        assert_eq!(split.notes[0], "note body");
        assert!(split.bibliography.is_none());
    }

    // --- Cycle A11: placeholder substitution ---

    #[test]
    fn substitute_footnote_afootnote() {
        let nonce = "XTEST";
        let text = format!("before {nonce}FO0{nonce}lemma{nonce}FC0{nonce} after");
        let footnotes = vec![FootnoteEntry {
            index: 0,
            route: Route::AFootnote,
            body_md: "fn body".into(),
        }];
        let converted = vec!["converted body".to_string()];
        let result = substitute_footnote_placeholders(&text, nonce, &footnotes, &converted);
        assert!(result.contains("\\edtext{lemma}{\\Afootnote{converted body}}"));
        assert!(!result.contains(nonce));
    }

    #[test]
    fn substitute_footnote_bfootnote() {
        let nonce = "XTEST";
        let text = format!("x {nonce}FO0{nonce}word{nonce}FC0{nonce} y");
        let footnotes = vec![FootnoteEntry {
            index: 0,
            route: Route::BFootnote,
            body_md: "fn".into(),
        }];
        let converted = vec!["conv".to_string()];
        let result = substitute_footnote_placeholders(&text, nonce, &footnotes, &converted);
        assert!(result.contains("\\edtext{word}{\\Bfootnote{conv}}"),
            "B-footnote must be inside \\edtext, got: {result}");
        assert!(!result.contains(nonce));
    }

    // --- Cycle 6: nonce survival guard ---

    #[test]
    fn assert_no_residual_nonce_clean() {
        assert!(assert_no_residual_nonce("clean text here", "XNONCE").is_ok());
    }

    #[test]
    fn assert_no_residual_nonce_dirty() {
        let result = assert_no_residual_nonce("some XNONCE leftover XNONCE text", "XNONCE");
        assert!(result.is_err());
        let msg = result.unwrap_err();
        assert!(msg.contains("2"), "should report count of residuals");
    }

    // --- Cycle A12: mark macro substitution ---

    #[test]
    fn mark_macro_known_codes() {
        assert_eq!(mark_macro("nb"), ("\\textbf{", "}"));
        assert_eq!(mark_macro("it"), ("\\emph{", "}"));
        assert_eq!(mark_macro("conj"), ("\\emph{", "}"));
        assert_eq!(mark_macro("dub"), ("\\emph{", "}"));
        assert_eq!(mark_macro("ul"), ("\\uline{", "}"));
        assert_eq!(mark_macro("em"), ("\\uline{", "}"));
        assert_eq!(mark_macro("st"), ("\\sout{", "}"));
        assert_eq!(mark_macro("del"), ("\\sout{", "}"));
        assert_eq!(mark_macro("sic"), ("\\uwave{", "}"));
        assert_eq!(mark_macro("sc"), ("\\textsc{", "}"));
        assert_eq!(mark_macro("hi"), ("\\lithl{", "}"));
        assert_eq!(mark_macro("gloss"), ("{\\footnotesize ", "}"));
        assert_eq!(mark_macro("crux"), ("\\textsuperscript{\\dag}", ""));
        assert_eq!(mark_macro("lac"), ("[", "]"));
        assert_eq!(mark_macro("sup"), ("\\textlangle{}", "\\textrangle{}"));
        assert_eq!(mark_macro("interp"), ("\u{27E6}", "\u{27E7}"));
    }

    #[test]
    fn mark_macro_unknown_unstyled() {
        assert_eq!(mark_macro("custom123"), ("", ""));
    }

    #[test]
    fn substitute_mark_hi() {
        let nonce = "XTEST";
        let text = format!("{nonce}MO0{nonce}word{nonce}MC0{nonce}");
        let marks = vec![MarkEntry {
            index: 0,
            code: "hi".into(),
        }];
        let result = substitute_mark_placeholders(&text, nonce, &marks);
        assert_eq!(result, "\\lithl{word}");
    }

    #[test]
    fn substitute_mark_unknown_passthrough() {
        let nonce = "XTEST";
        let text = format!("{nonce}MO0{nonce}word{nonce}MC0{nonce}");
        let marks = vec![MarkEntry {
            index: 0,
            code: "custom".into(),
        }];
        let result = substitute_mark_placeholders(&text, nonce, &marks);
        assert_eq!(result, "word");
    }

    // --- Cycle A13: right-page note rendering ---

    fn make_attached(
        note_index: usize,
        ann_type: &str,
        certainty: Certainty,
        body: &str,
        lemma: Option<&str>,
    ) -> AttachedNote {
        AttachedNote {
            chunk_index: 0,
            note_index,
            annotation_type: ann_type.into(),
            certainty,
            body_md: body.into(),
            body_latex: None,
            lemma_latex: lemma.map(|s| s.into()),
        }
    }

    #[test]
    fn render_right_notes_single() {
        let notes = vec![make_attached(0, "n", Certainty::Neutral, "A note body.", None)];
        let rendered = render_right_page_notes(&notes, true);
        assert!(rendered.contains("\\textsc{n}"));
        assert!(rendered.contains("A note body."));
        assert!(rendered.contains("\\textbf{\\edlineref{lit:0}}"));
        assert!(!rendered.contains('?'));
        assert!(!rendered.contains('!'));
    }

    #[test]
    fn render_right_notes_with_certainty() {
        let notes = vec![make_attached(0, "tr", Certainty::Tentative, "Translation.", None)];
        let rendered = render_right_page_notes(&notes, true);
        assert!(rendered.contains("\\textsc{tr}?"));
    }

    #[test]
    fn render_right_notes_line_numbers_on_with_lemma() {
        let notes = vec![make_attached(2, "n", Certainty::Neutral, "Body.", Some("hello world"))];
        let rendered = render_right_page_notes(&notes, true);
        assert!(rendered.contains("\\textbf{\\edlineref{lit:2}}"));
        assert!(rendered.contains("\\emph{hello world}]"));
        assert!(rendered.contains("\\textsc{n} Body."));
        assert!(!rendered.contains("(paras"));
    }

    #[test]
    fn render_right_notes_line_numbers_off_lemma_only() {
        let notes = vec![make_attached(2, "n", Certainty::Neutral, "Body.", Some("hello world"))];
        let rendered = render_right_page_notes(&notes, false);
        assert!(!rendered.contains("\\edlineref"));
        assert!(rendered.contains("\\emph{hello world}]"));
        assert!(rendered.contains("\\textsc{n} Body."));
    }

    #[test]
    fn render_right_notes_empty_lemma_omitted() {
        let notes = vec![make_attached(0, "n", Certainty::Neutral, "Body.", None)];
        let rendered = render_right_page_notes(&notes, true);
        assert!(!rendered.contains("\\emph"));
        assert!(!rendered.contains(']'));
        assert!(rendered.contains("\\textbf{\\edlineref{lit:0}} \\textsc{n} Body."));
    }

    #[test]
    fn render_right_notes_multiple_joined() {
        let notes = vec![
            make_attached(0, "n", Certainty::Neutral, "First.", None),
            make_attached(1, "tr", Certainty::Firm, "Second.", None),
        ];
        let rendered = render_right_page_notes(&notes, true);
        assert!(rendered.contains("\\medskip"));
    }

    #[test]
    fn render_right_notes_uses_body_latex() {
        let mut note = make_attached(0, "n", Certainty::Neutral, "raw % & _ markdown", None);
        note.body_latex = Some("converted \\% \\& \\_ latex".into());
        let rendered = render_right_page_notes(&[note], true);
        assert!(rendered.contains("converted \\% \\& \\_ latex"),
            "should use body_latex when available");
        assert!(!rendered.contains("raw % & _ markdown"),
            "should NOT use body_md when body_latex is available");
    }

    #[test]
    fn render_right_notes_empty() {
        assert_eq!(render_right_page_notes(&[], true), "~");
    }

    // --- Cycle A14: preamble ---

    #[test]
    fn preamble_reledmac_before_reledpar() {
        let p = build_preamble(&PreambleOptions {
            line_numbers: false,
            cjk_font: None,
            indic_preamble: None,
            extra_preamble: None,
        });
        let mac = p.find("\\usepackage{reledmac}").unwrap();
        let par = p.find("\\usepackage{reledpar}").unwrap();
        assert!(mac < par);
    }

    #[test]
    fn preamble_contains_twoside() {
        let p = build_preamble(&PreambleOptions {
            line_numbers: false,
            cjk_font: None,
            indic_preamble: None,
            extra_preamble: None,
        });
        assert!(p.contains("twoside"));
    }

    #[test]
    fn preamble_contains_normalem_ulem() {
        let p = build_preamble(&PreambleOptions {
            line_numbers: false,
            cjk_font: None,
            indic_preamble: None,
            extra_preamble: None,
        });
        assert!(p.contains("[normalem]{ulem}"));
        assert!(!p.contains("\\usepackage{soul}"), "soul hard-errors on CJK");
        assert!(p.contains("\\newcommand{\\lithl}"), "must define \\lithl");
        assert!(p.contains("\\colorbox"), "\\lithl should use \\colorbox");
    }

    #[test]
    fn preamble_line_numbers_on() {
        let p = build_preamble(&PreambleOptions {
            line_numbers: true,
            cjk_font: None,
            indic_preamble: None,
            extra_preamble: None,
        });
        assert!(p.contains("\\firstlinenum{5}"));
        assert!(p.contains("\\linenumincrement{5}"));
    }

    #[test]
    fn preamble_line_numbers_off() {
        let p = build_preamble(&PreambleOptions {
            line_numbers: false,
            cjk_font: None,
            indic_preamble: None,
            extra_preamble: None,
        });
        // "off" means suppress to huge values (reledmac defaults 5/5, so omitting is a no-op)
        assert!(p.contains("\\firstlinenum{100000}"), "must suppress left line numbers");
        assert!(p.contains("\\linenumincrement{100000}"), "must suppress left line number increment");
    }

    #[test]
    fn preamble_citeproc_macros() {
        let p = build_preamble(&PreambleOptions {
            line_numbers: true,
            cjk_font: None,
            indic_preamble: None,
            extra_preamble: None,
        });
        assert!(p.contains("\\providecommand{\\phantomsection}{}"),
            "must provide \\phantomsection");
        assert!(p.contains("CSLReferences"), "must define CSLReferences env");
        assert!(p.contains("\\citeproctext"), "must define \\citeproctext");
    }

    #[test]
    fn preamble_extra_preamble_included() {
        let p = build_preamble(&PreambleOptions {
            line_numbers: true,
            cjk_font: None,
            indic_preamble: None,
            extra_preamble: Some("\\usepackage{custom}\n\\setfoo{bar}".into()),
        });
        assert!(p.contains("\\usepackage{custom}"));
        assert!(p.contains("\\setfoo{bar}"));
    }

    #[test]
    fn preamble_right_side_numbers_always_suppressed() {
        for line_numbers in [true, false] {
            let p = build_preamble(&PreambleOptions {
                line_numbers,
                cjk_font: None,
                indic_preamble: None,
                extra_preamble: None,
            });
            assert!(p.contains("\\firstlinenumR{100000}"),
                "right-side line numbers must always be suppressed (line_numbers={line_numbers})");
            assert!(p.contains("\\linenumincrementR{100000}"),
                "right-side line number increment must always be suppressed (line_numbers={line_numbers})");
            // R commands must come after reledpar
            let par_pos = p.find("\\usepackage{reledpar}").unwrap();
            let r_pos = p.find("\\firstlinenumR{100000}").unwrap();
            assert!(r_pos > par_pos,
                "\\firstlinenumR must come after \\usepackage{{reledpar}}");
        }
    }

    #[test]
    fn preamble_cjk_font() {
        let p = build_preamble(&PreambleOptions {
            line_numbers: false,
            cjk_font: Some("PingFang SC".into()),
            indic_preamble: None,
            extra_preamble: None,
        });
        assert!(p.contains("\\usepackage{xeCJK}"));
        assert!(p.contains("\\setCJKmainfont{PingFang SC}"));
    }

    #[test]
    fn preamble_no_cjk_without_font() {
        let p = build_preamble(&PreambleOptions {
            line_numbers: false,
            cjk_font: None,
            indic_preamble: None,
            extra_preamble: None,
        });
        assert!(!p.contains("xeCJK"));
    }

    // --- Cycle A15: assembly golden test ---

    #[test]
    fn assembly_golden_test() {
        let preamble = build_preamble(&PreambleOptions {
            line_numbers: true,
            cjk_font: None,
            indic_preamble: None,
            extra_preamble: None,
        });
        let left = vec![
            ("\\edlabel{lit:0}Body chunk one.".to_string(), true),
            ("Body chunk two continuation.".to_string(), false),
            ("Body chunk three.".to_string(), true),
        ];
        let right = vec![
            "\\textbf{\\edlineref{lit:0}} \\emph{Body}] \\textsc{n} A note.".to_string(),
            "~".to_string(),
            "\\textsc{tr}? Translation.".to_string(),
        ];
        let tex = assemble_tex(&preamble, &left, &right, Some("\\printbibliography"));

        assert!(tex.contains("\\begin{pages}"));
        assert!(tex.contains("\\end{pages}"));
        assert!(tex.contains("\\Pages"));
        assert!(tex.contains("\\begin{Leftside}"));
        assert!(tex.contains("\\end{Leftside}"));
        assert!(tex.contains("\\begin{Rightside}"));
        assert!(tex.contains("\\end{Rightside}"));
        assert!(tex.contains("\\beginnumbering"));
        assert!(tex.contains("\\endnumbering"));
        // 3 pstarts on each side = 6 total
        assert_eq!(tex.matches("\\pstart").count(), 6);
        // Continuation chunk gets \\noindent
        assert!(tex.contains("\\noindent Body chunk two continuation."));
        // Labels / linerefs present
        assert!(tex.contains("\\edlabel{lit:0}"));
        assert!(tex.contains("\\edlineref{lit:0}"));
        // Empty right chunk
        assert!(tex.contains("~"));
        // Bibliography after \\Pages
        let pages_pos = tex.find("\\Pages").unwrap();
        let bib_pos = tex.find("\\printbibliography").unwrap();
        assert!(bib_pos > pages_pos);
        assert!(tex.contains("\\end{document}"));
    }

    // --- Cycle B1: request deserialization ---

    #[test]
    fn request_deserializes_camel_case() {
        let json = r#"{
            "relativePath": "notes/test.md",
            "outputPath": "/tmp/out.tex",
            "csl": "apa",
            "lineNumbers": true,
            "routing": {"q": "right", "app": "suppress"}
        }"#;
        let req: CriticalEditionRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.relative_path, "notes/test.md");
        assert_eq!(req.output_path, "/tmp/out.tex");
        assert_eq!(req.csl.as_deref(), Some("apa"));
        assert!(req.line_numbers);
        assert_eq!(req.routing["q"], "right");
    }

    #[test]
    fn request_deserializes_without_optional_fields() {
        let json = r#"{"relativePath": "a.md", "outputPath": "/out.tex"}"#;
        let req: CriticalEditionRequest = serde_json::from_str(json).unwrap();
        assert!(req.csl.is_none());
        assert!(req.line_numbers); // default true
        assert!(req.routing.is_empty());
    }

    // --- Cycle B2: validation ---

    #[test]
    fn validate_input_missing_file() {
        let result = validate_input(
            Path::new("/nonexistent/file.md"),
            Path::new("/tmp/out.tex"),
        );
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Input file not found"));
    }

    #[test]
    fn validate_input_unwritable_output_dir() {
        let tmp = std::env::temp_dir().join("test_ce_validate");
        std::fs::create_dir_all(&tmp).unwrap();
        let input = tmp.join("input.md");
        std::fs::write(&input, "test").unwrap();
        let result = validate_input(
            &input,
            &Path::new("/nonexistent_dir/subdir/out.tex"),
        );
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Output directory does not exist"));
        std::fs::remove_dir_all(&tmp).unwrap();
    }

    #[test]
    fn validate_input_ok() {
        let tmp = std::env::temp_dir().join("test_ce_validate_ok");
        std::fs::create_dir_all(&tmp).unwrap();
        let input = tmp.join("input.md");
        std::fs::write(&input, "test").unwrap();
        let result = validate_input(&input, &tmp.join("out.tex"));
        assert!(result.is_ok());
        std::fs::remove_dir_all(&tmp).unwrap();
    }

    // --- Cycle 3: pandoc integration test (gated) ---

    #[test]
    fn pandoc_roundtrip_with_frontmatter_aligns_pieces() {
        let pandoc = match academic_export::find_in_path("pandoc") {
            Some(p) => p,
            None => {
                eprintln!("SKIP: pandoc not found on PATH");
                return;
            }
        };

        let sentinel = "XSENTINEL42XSENTINEL42";
        let fm = "---\ntitle: Test\n---";
        let paras = &["First paragraph.", "Second paragraph."];
        let notes = &["A note body."];
        let input = build_pandoc_input(Some(fm), paras, notes, &[], sentinel);

        let mut child = Command::new(&pandoc)
            .args(["-f", "markdown", "-t", "latex"])
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .expect("failed to spawn pandoc");

        if let Some(mut stdin) = child.stdin.take() {
            use std::io::Write;
            stdin.write_all(input.as_bytes()).unwrap();
        }

        let output = child.wait_with_output().expect("failed to wait on pandoc");
        assert!(output.status.success(), "pandoc failed: {}", String::from_utf8_lossy(&output.stderr));

        let latex = String::from_utf8_lossy(&output.stdout).to_string();
        let split = split_pandoc_output(&latex, sentinel, 2, 1, 0);

        assert_eq!(split.paragraphs.len(), 2, "expected 2 paragraphs");
        assert_eq!(split.notes.len(), 1, "expected 1 note");

        assert!(!split.paragraphs[0].is_empty(), "para 0 should not be empty");
        assert!(!split.paragraphs[1].is_empty(), "para 1 should not be empty");
        assert!(!split.notes[0].is_empty(), "note 0 should not be empty");
    }

    // --- normalize_label_start ---

    #[test]
    fn normalize_label_start_heading_scope_extends_beyond() {
        let content = "### Heading\n\nBody text here.";
        let paras = split_paragraphs(content);
        let scope = ScopeRange { start: 0, end: content.len() };
        let result = normalize_label_start(content, &paras, &scope);
        let body_start = content.find("Body").unwrap();
        assert_eq!(result, body_start, "should move to next paragraph start");
    }

    #[test]
    fn normalize_label_start_heading_only_scope() {
        let content = "### Heading\n\nBody text here.";
        let paras = split_paragraphs(content);
        let heading_end = content.find('\n').unwrap();
        let scope = ScopeRange { start: 0, end: heading_end };
        let result = normalize_label_start(content, &paras, &scope);
        assert_eq!(&content[result..result + 7], "Heading");
    }

    #[test]
    fn normalize_label_start_list_item() {
        let content = "- List item text";
        let paras = split_paragraphs(content);
        let scope = ScopeRange { start: 0, end: content.len() };
        let result = normalize_label_start(content, &paras, &scope);
        assert_eq!(result, 2, "should skip past '- '");
        assert_eq!(&content[result..result + 4], "List");
    }

    #[test]
    fn normalize_label_start_ordered_list() {
        let content = "1. First item";
        let paras = split_paragraphs(content);
        let scope = ScopeRange { start: 0, end: content.len() };
        let result = normalize_label_start(content, &paras, &scope);
        assert_eq!(result, 3, "should skip past '1. '");
    }

    #[test]
    fn normalize_label_start_blockquote() {
        let content = "> Quoted text";
        let paras = split_paragraphs(content);
        let scope = ScopeRange { start: 0, end: content.len() };
        let result = normalize_label_start(content, &paras, &scope);
        assert_eq!(result, 2, "should skip past '> '");
    }

    #[test]
    fn normalize_label_start_plain_prose() {
        let content = "Just plain text here.";
        let paras = split_paragraphs(content);
        let scope = ScopeRange { start: 0, end: content.len() };
        let result = normalize_label_start(content, &paras, &scope);
        assert_eq!(result, 0, "plain prose unchanged");
    }

    #[test]
    fn normalize_label_start_fenced_code() {
        let content = "```rust\nfn main() {}\n```\n\nBody text.";
        let paras = split_paragraphs(content);
        let scope = ScopeRange { start: 0, end: content.len() };
        let result = normalize_label_start(content, &paras, &scope);
        let body_start = content.find("Body").unwrap();
        assert_eq!(result, body_start, "should move past code fence to body");
    }

    // --- lemma_excerpt flattening ---

    #[test]
    fn lemma_excerpt_heading_flattened() {
        let body = "### Heading\n\nBody paragraph text.";
        let s = lemma_excerpt(body, &ScopeRange { start: 0, end: body.len() });
        assert!(!s.contains('#'), "heading markers should be stripped: {s:?}");
        assert!(s.contains("Heading"), "heading text preserved: {s:?}");
        assert!(!s.contains('\n'), "no newlines: {s:?}");
    }

    #[test]
    fn lemma_excerpt_list_flattened() {
        let body = "- item one\n- item two";
        let s = lemma_excerpt(body, &ScopeRange { start: 0, end: body.len() });
        assert!(!s.starts_with('-'), "list marker stripped: {s:?}");
        assert!(s.contains("item one"), "content preserved: {s:?}");
    }

    #[test]
    fn lemma_excerpt_plain_prose_unchanged() {
        let body = "Hello world, this is fine.";
        let s = lemma_excerpt(body, &ScopeRange { start: 0, end: body.len() });
        assert_eq!(s, "Hello world, this is fine.");
    }

    // --- lemma guard ---

    #[test]
    fn contains_block_latex_detects_subsection() {
        assert!(contains_block_latex("\\subsubsection{Foo}"));
        assert!(contains_block_latex("text \\begin{itemize} stuff"));
        assert!(contains_block_latex("\\pstart more"));
    }

    #[test]
    fn contains_block_latex_passes_inline() {
        assert!(!contains_block_latex("\\emph{foo} bar"));
        assert!(!contains_block_latex("plain text here"));
    }

    // --- transform with heading-scoped note ---

    #[test]
    fn transform_heading_scope_preserves_heading_and_moves_label() {
        let content = "### \u{4e8c}\u{5341}\u{56db}\n\nBody text for section.\n\n<!--- n | Section note. --->";
        let ann_start = content.find("<!---").unwrap();
        let ann_end = content.len();
        let ann = make_annotation(
            AnnotationType::Note,
            Certainty::Neutral,
            Scope::Sentence(1),
            Some("Section note."),
            ann_start,
            ann_end,
            None,
        );
        let heading_start = 0;
        let scope_end = content.find("\n\n<!---").unwrap();
        let scope = Some(ScopeRange {
            start: heading_start,
            end: scope_end,
        });
        let result = transform_document(content, &[ann], &[scope], &default_routing(), "zh");
        let nonce = &result.nonce;
        let body = result.body();
        let lb = format!("{nonce}LB0{nonce}");

        assert!(body.contains(&lb), "label placeholder must exist");

        let heading_chunk = result.chunks.iter().find(|c| c.text.contains("###")).unwrap();
        assert!(
            !heading_chunk.text.contains(&lb),
            "label must NOT be in heading chunk: {:?}",
            heading_chunk.text,
        );
        assert!(
            heading_chunk.text.contains("### "),
            "heading markers must be preserved: {:?}",
            heading_chunk.text,
        );

        let label_chunk = result.chunks.iter().find(|c| c.text.contains(&lb)).unwrap();
        assert!(
            label_chunk.text.contains("Body"),
            "label should be in the body chunk: {:?}",
            label_chunk.text,
        );
    }

    // --- Cycle 9: end-to-end acceptance (ignored; needs pandoc/latexmk) ---

    #[test]
    #[ignore = "requires pandoc (and optionally latexmk) on PATH; run with --ignored"]
    fn e2e_critical_edition_export_aligns_chunks() {
        let pandoc = match academic_export::find_in_path("pandoc") {
            Some(p) => p,
            None => {
                eprintln!("SKIP: pandoc not found on PATH");
                return;
            }
        };

        // Fixture: frontmatter + page-spanning prose + 6 right notes + apparatus + CJK.
        let mut sentences = Vec::new();
        for i in 1..=30 {
            sentences.push(format!(
                "This is sentence number {i} of a long English paragraph designed to span pages."
            ));
        }
        let long_para = sentences.join(" ");

        let content = format!(
            r#"---
title: E2E Critical Edition
annotation-lang: en
---

{long_para}

仁学是中国近代的重要著作。它提出了平等的思想。这是第三句。

A short trailing paragraph.
"#
        );

        // UTF-16 index helper (annotation/scope offsets are UTF-16 code units).
        let u16map = build_utf16_to_byte_map(&content);
        let to_u16 = |byte: usize| -> usize {
            u16map
                .iter()
                .position(|&b| b >= byte)
                .unwrap_or(u16map.len() - 1)
        };

        // Build synthetic annotations: 6 right notes on various sentences + 1 apparatus.
        let mut annotations = Vec::new();
        let mut scopes = Vec::new();

        // Place right notes at several points in the long paragraph.
        let targets = [
            ("sentence number 1 ", "Note on first."),
            ("sentence number 5 ", "Note on fifth."),
            ("sentence number 10 ", "Note on tenth."),
            ("sentence number 15 ", "Note on fifteenth."),
            ("sentence number 20 ", "Note on twentieth."),
            ("sentence number 25 ", "Note on twenty-fifth."),
        ];
        for (needle, body) in targets {
            let start = content.find(needle).expect(needle);
            let end = start + needle.len();
            // Empty deletion (no real marker in the fixture text).
            annotations.push(make_annotation(
                AnnotationType::Note,
                Certainty::Neutral,
                Scope::Sentence(1),
                Some(body),
                to_u16(end),
                to_u16(end),
                None,
            ));
            scopes.push(Some(ScopeRange {
                start: to_u16(start),
                end: to_u16(end),
            }));
        }

        // Apparatus footnote on "trailing"
        let t_start = content.find("trailing").unwrap();
        let t_end = t_start + "trailing".len();
        annotations.push(make_annotation(
            AnnotationType::Apparatus,
            Certainty::Neutral,
            Scope::Words(1),
            Some("Apparatus on trailing."),
            to_u16(t_end),
            to_u16(t_end),
            None,
        ));
        scopes.push(Some(ScopeRange {
            start: to_u16(t_start),
            end: to_u16(t_end),
        }));

        // CJK right note
        let cjk_start = content.find("仁学").unwrap();
        let cjk_end = cjk_start + "仁学".len();
        annotations.push(make_annotation(
            AnnotationType::Note,
            Certainty::Neutral,
            Scope::Sentence(1),
            Some("CJK note."),
            to_u16(cjk_end),
            to_u16(cjk_end),
            None,
        ));
        scopes.push(Some(ScopeRange {
            start: to_u16(cjk_start),
            end: to_u16(cjk_end),
        }));

        let result = transform_document(&content, &annotations, &scopes, &default_routing(), "en");
        assert!(result.chunks.len() > 1, "expected multiple chunks");
        assert_eq!(result.right_notes.len(), 7, "right_notes={:?}",
            result.right_notes.iter().map(|r| &r.body_md).collect::<Vec<_>>());
        assert_eq!(result.footnotes.len(), 1);

        // Every right note got a label placeholder in some chunk.
        let nonce = &result.nonce;
        let body = result.body();
        for i in 0..result.right_notes.len() {
            let lb = format!("{nonce}LB{i}{nonce}");
            assert!(body.contains(&lb), "missing label {i}");
        }

        // Pandoc round-trip of the chunk batch.
        let chunk_refs: Vec<&str> = result.chunks.iter().map(|c| c.text.as_str()).collect();
        let fn_bodies: Vec<&str> = result.footnotes.iter().map(|f| f.body_md.as_str()).collect();
        let rn_bodies: Vec<&str> = result.right_notes.iter().map(|r| r.body_md.as_str()).collect();
        let mut notes: Vec<&str> = fn_bodies;
        notes.extend(rn_bodies);
        let lemmas: Vec<&str> = result.lemma_excerpts.iter().map(|s| s.as_str()).collect();
        let sentinel = format!("{nonce}SENT{nonce}");
        let fm = "---\ntitle: E2E Critical Edition\n---";
        let input = build_pandoc_input(Some(fm), &chunk_refs, &notes, &lemmas, &sentinel);

        let mut child = Command::new(&pandoc)
            .args(["-f", "markdown", "-t", "latex"])
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .expect("spawn pandoc");
        if let Some(mut stdin) = child.stdin.take() {
            use std::io::Write;
            stdin.write_all(input.as_bytes()).unwrap();
        }
        let output = child.wait_with_output().unwrap();
        assert!(output.status.success(), "pandoc failed: {}", String::from_utf8_lossy(&output.stderr));

        let latex = String::from_utf8_lossy(&output.stdout).to_string();
        let split = split_pandoc_output(
            &latex,
            &sentinel,
            result.chunks.len(),
            notes.len(),
            lemmas.len(),
        );
        assert_eq!(split.paragraphs.len(), result.chunks.len());

        let n_right = result.right_notes.len();
        let left: Vec<(String, bool)> = split
            .paragraphs
            .iter()
            .enumerate()
            .map(|(i, p)| {
                let p = substitute_footnote_placeholders(
                    p,
                    nonce,
                    &result.footnotes,
                    &split.notes[..result.footnotes.len()],
                );
                let p = substitute_mark_placeholders(&p, nonce, &result.marks);
                let p = substitute_label_placeholders(&p, nonce, n_right);
                (p, result.chunks[i].para_start)
            })
            .collect();

        let attached = attach_notes_to_chunks(&result.right_notes, &result.chunk_spans);
        let right_notes_latex = &split.notes[result.footnotes.len()..];
        let attached: Vec<AttachedNote> = attached
            .into_iter()
            .enumerate()
            .map(|(i, mut a)| {
                if i < right_notes_latex.len() {
                    a.body_latex = Some(right_notes_latex[i].clone());
                }
                if i < split.lemmas.len() && !split.lemmas[i].is_empty() {
                    a.lemma_latex = Some(split.lemmas[i].clone());
                }
                a
            })
            .collect();

        let right: Vec<String> = (0..left.len())
            .map(|ci| {
                let notes: Vec<_> = attached.iter().filter(|a| a.chunk_index == ci).cloned().collect();
                render_right_page_notes(&notes, true)
            })
            .collect();

        let preamble = build_preamble(&PreambleOptions {
            line_numbers: true,
            cjk_font: Some("PingFang SC".into()),
            indic_preamble: None,
            extra_preamble: None,
        });
        let tex = assemble_tex(&preamble, &left, &right, split.bibliography.as_deref());
        assert_no_residual_nonce(&tex, nonce).unwrap();
        assert_eq!(tex.matches("\\pstart").count(), left.len() * 2);
        assert!(tex.contains("\\edlabel{lit:0}"));
        assert!(tex.contains("\\edlineref{lit:0}"));

        let tmp = std::env::temp_dir().join("lit_ce_e2e");
        let _ = std::fs::create_dir_all(&tmp);
        let tex_path = tmp.join("e2e.tex");
        std::fs::write(&tex_path, &tex).unwrap();

        if academic_export::find_in_path("latexmk").is_some() {
            let status = Command::new("latexmk")
                .args([
                    "-xelatex",
                    "-interaction=nonstopmode",
                    "-cd",
                    tex_path.to_str().unwrap(),
                ])
                .status()
                .expect("run latexmk");
            assert!(status.success(), "latexmk failed");
        } else {
            eprintln!("NOTE: latexmk not on PATH; wrote {} for manual inspection", tex_path.display());
        }
    }

    #[test]
    fn transform_cjk_content_does_not_panic() {
        // CJK chars are 3 bytes UTF-8 but 1 UTF-16 code unit.
        // Annotation offsets are UTF-16, so byte != utf16 offset.
        // "Hello" = 5 chars, then annotation at UTF-16 positions 5..25
        let content = "Hello{.n Hello} world";
        // UTF-16 offsets: {=5, }=15, so char_start=5, char_end=16
        let ann = make_annotation(
            AnnotationType::Note,
            Certainty::Neutral,
            Scope::Words(1),
            Some("A note"),
            5, 16,
            None,
        );
        let scope = Some(ScopeRange { start: 0, end: 5 });
        let routing = [("n".to_string(), Route::Right)].into_iter().collect();
        let result = transform_document(content, &[ann], &[scope], &routing, "en");
        assert!(!result.body().is_empty());

        // Now test with actual CJK content where UTF-16 != byte offsets
        // "\u{4ec1}" is 3 bytes in UTF-8, 1 UTF-16 code unit
        let cjk_content = "\u{4ec1}\u{5b66}{.n note}\u{4e16}\u{754c}";
        // UTF-16 offsets: \u{4ec1}=0..1, \u{5b66}=1..2, {.n note}=2..12
        // \u{4e16}=12..13, \u{754c}=13..14
        let ann = make_annotation(
            AnnotationType::Note,
            Certainty::Neutral,
            Scope::Words(1),
            Some("A note"),
            2, 12,
            None,
        );
        let scope = Some(ScopeRange { start: 0, end: 2 });
        let result = transform_document(cjk_content, &[ann], &[scope], &routing, "en");
        assert!(!result.body().is_empty());
        assert!(!result.body().contains("{.n"));
    }
}
