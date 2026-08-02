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
// Transform document: strip annotations, inject placeholders (A3-A7)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone)]
pub struct TransformResult {
    pub body: String,
    pub footnotes: Vec<FootnoteEntry>,
    pub marks: Vec<MarkEntry>,
    pub right_notes: Vec<RightNote>,
    pub nonce: String,
}

#[derive(Debug, Clone)]
pub struct RightNote {
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
) -> TransformResult {
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
    }

    let mut deletions: Vec<(usize, usize)> = Vec::new();
    let mut injections: Vec<Injection> = Vec::new();

    for (i, ann) in annotations.iter().enumerate() {
        deletions.push((ann.char_start, ann.char_end));

        let rk = route_key(ann);

        let scope_range = match scopes.get(i) {
            Some(Some(sr)) => sr,
            _ => {
                if ann.annotation_type != AnnotationType::Mark {
                    let route = routing.get(&rk).copied();
                    if route != Some(Route::Suppress) {
                        let body_md = ann.body.clone().unwrap_or_default();
                        right_notes.push(RightNote {
                            annotation_type: rk,
                            certainty: ann.certainty.clone(),
                            body_md,
                            scope_range: ScopeRange {
                                start: ann.char_start,
                                end: ann.char_start,
                            },
                        });
                    }
                }
                continue;
            }
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
            if crosses_paragraph_boundary(scope_range, &paragraphs) {
                right_notes.push(RightNote {
                    annotation_type: rk,
                    certainty: ann.certainty.clone(),
                    body_md,
                    scope_range: scope_range.clone(),
                });
                continue;
            }
            if has_partial_overlap(scope_range, &injection_ranges) {
                right_notes.push(RightNote {
                    annotation_type: rk,
                    certainty: ann.certainty.clone(),
                    body_md,
                    scope_range: scope_range.clone(),
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
            right_notes.push(RightNote {
                annotation_type: rk,
                certainty: ann.certainty.clone(),
                body_md,
                scope_range: scope_range.clone(),
            });
        }
    }

    let mut sorted_deletions = deletions.clone();
    sorted_deletions.sort_by_key(|d| d.0);

    // Build deletion-stripped body and track deleted ranges for position adjustment
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

    // Collect open/close events at adjusted positions
    struct Event {
        pos: usize,
        scope_start: usize,
        scope_end: usize,
        is_open: bool,
        tag: String,
    }

    let mut events: Vec<Event> = Vec::new();
    for inj in &injections {
        let adj_start = adjust_pos(inj.scope_start, &sorted_deletions);
        let adj_end = adjust_pos(inj.scope_end, &sorted_deletions);
        let (open_tag, close_tag) = match &inj.kind {
            InjectionKind::Footnote { index } => (
                format!("{nonce}FO{index}{nonce}"),
                format!("{nonce}FC{index}{nonce}"),
            ),
            InjectionKind::Mark { index } => (
                format!("{nonce}MO{index}{nonce}"),
                format!("{nonce}MC{index}{nonce}"),
            ),
        };
        events.push(Event {
            pos: adj_start,
            scope_start: adj_start,
            scope_end: adj_end,
            is_open: true,
            tag: open_tag,
        });
        events.push(Event {
            pos: adj_end,
            scope_start: adj_start,
            scope_end: adj_end,
            is_open: false,
            tag: close_tag,
        });
    }

    // Sort: by position, then closes before opens at same position,
    // among closes at same pos: inner first (larger scope_start),
    // among opens at same pos: outer first (larger scope_end)
    events.sort_by(|a, b| {
        a.pos.cmp(&b.pos)
            .then_with(|| a.is_open.cmp(&b.is_open)) // false < true, so closes first
            .then_with(|| {
                if !a.is_open {
                    b.scope_start.cmp(&a.scope_start) // inner close first (larger start)
                } else {
                    b.scope_end.cmp(&a.scope_end) // outer open first (larger end)
                }
            })
    });

    // Build body in one left-to-right pass
    let mut body = String::with_capacity(body_no_del.len() * 2);
    let mut cursor = 0;
    for ev in &events {
        let p = ev.pos.min(body_no_del.len());
        if p > cursor {
            body.push_str(&body_no_del[cursor..p]);
        }
        body.push_str(&ev.tag);
        cursor = p;
    }
    if cursor < body_no_del.len() {
        body.push_str(&body_no_del[cursor..]);
    }

    let adjusted_right_notes: Vec<RightNote> = right_notes
        .into_iter()
        .map(|mut rn| {
            rn.scope_range.start = adjust_pos(rn.scope_range.start, &sorted_deletions);
            rn.scope_range.end = adjust_pos(rn.scope_range.end, &sorted_deletions);
            rn
        })
        .collect();

    TransformResult {
        body,
        footnotes,
        marks,
        right_notes: adjusted_right_notes,
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
// Note-to-paragraph attachment (A9)
// ---------------------------------------------------------------------------

pub struct AttachedNote {
    pub paragraph_index: usize,
    pub span_prefix: Option<String>,
    pub annotation_type: String,
    pub certainty: Certainty,
    pub body_md: String,
    pub body_latex: Option<String>,
}

pub fn attach_notes_to_paragraphs(
    right_notes: &[RightNote],
    paragraphs: &[ParagraphSpan],
) -> Vec<AttachedNote> {
    right_notes
        .iter()
        .filter_map(|note| {
            let para = paragraphs
                .iter()
                .find(|p| note.scope_range.start >= p.start && note.scope_range.start < p.end)
                .or_else(|| paragraphs.last())?;

            let end_para = paragraphs
                .iter()
                .find(|p| note.scope_range.end > p.start && note.scope_range.end <= p.end)
                .unwrap_or(para);

            let span_prefix = if end_para.index != para.index {
                Some(format!(
                    "(paras {}-{})",
                    para.index + 1,
                    end_para.index + 1
                ))
            } else {
                None
            };

            Some(AttachedNote {
                paragraph_index: para.index,
                span_prefix,
                annotation_type: note.annotation_type.clone(),
                certainty: note.certainty.clone(),
                body_md: note.body_md.clone(),
                body_latex: None,
            })
        })
        .collect()
}

// ---------------------------------------------------------------------------
// Sentinel batch build + split (A10)
// ---------------------------------------------------------------------------

pub fn build_pandoc_input(
    frontmatter: Option<&str>,
    paragraphs: &[&str],
    note_bodies: &[&str],
    sentinel: &str,
) -> String {
    let mut parts: Vec<String> = Vec::new();

    if let Some(fm) = frontmatter {
        parts.push(fm.to_string());
        parts.push("\n\n".to_string());
    }

    for (i, para) in paragraphs.iter().enumerate() {
        if i > 0 {
            parts.push(format!("\n\n{sentinel}\n\n"));
        }
        parts.push(para.to_string());
    }

    for note in note_bodies {
        parts.push(format!("\n\n{sentinel}\n\n"));
        parts.push(note.to_string());
    }

    parts.push(format!("\n\n{sentinel}\n\n"));

    parts.join("")
}

pub struct SplitOutput {
    pub paragraphs: Vec<String>,
    pub notes: Vec<String>,
    pub bibliography: Option<String>,
}

pub fn split_pandoc_output(
    latex: &str,
    sentinel: &str,
    n_paras: usize,
    n_notes: usize,
) -> SplitOutput {
    let pieces: Vec<&str> = latex.split(sentinel).collect();
    let total_expected = n_paras + n_notes;

    let mut paragraphs = Vec::new();
    let mut notes = Vec::new();
    let mut bibliography = None;

    for (i, piece) in pieces.iter().enumerate() {
        let trimmed = piece.trim();
        if i < n_paras {
            paragraphs.push(trimmed.to_string());
        } else if i < total_expected {
            notes.push(trimmed.to_string());
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

    SplitOutput {
        paragraphs,
        notes,
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

// ---------------------------------------------------------------------------
// Nonce survival guard
// ---------------------------------------------------------------------------

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

pub fn render_right_page_notes(notes: &[AttachedNote]) -> String {
    if notes.is_empty() {
        return "~".to_string();
    }
    notes
        .iter()
        .map(|note| {
            let label = format!("\\textsc{{{}}}", note.annotation_type);
            let certainty_suffix = match note.certainty {
                Certainty::Tentative => "?",
                Certainty::Firm => "!",
                Certainty::Neutral => "",
            };
            let prefix = note
                .span_prefix
                .as_ref()
                .map(|p| format!("{p} "))
                .unwrap_or_default();
            let body = note.body_latex.as_deref().unwrap_or(&note.body_md);
            format!("{prefix}{label}{certainty_suffix} {body}")
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

pub fn assemble_tex(
    preamble: &str,
    left_paragraphs: &[String],
    right_paragraphs: &[String],
    bibliography: Option<&str>,
) -> String {
    let mut out = String::new();
    out.push_str(preamble);
    out.push_str("\n\n");

    out.push_str("\\begin{pages}\n");

    out.push_str("\\begin{Leftside}\n");
    out.push_str("\\beginnumbering\n");
    for para in left_paragraphs {
        out.push_str(&format!("\\pstart\n{para}\n\\pend\n"));
    }
    out.push_str("\\endnumbering\n");
    out.push_str("\\end{Leftside}\n\n");

    out.push_str("\\begin{Rightside}\n");
    out.push_str("\\beginnumbering\n");
    for para in right_paragraphs {
        out.push_str(&format!("\\pstart\n{para}\n\\pend\n"));
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

    let transform = transform_document(&content, &annotations, &scopes, &routing);

    let body_paragraphs = split_paragraphs(&transform.body);
    let para_texts: Vec<String> = body_paragraphs
        .iter()
        .map(|p| transform.body[p.start..p.end].to_string())
        .collect();

    let attached = attach_notes_to_paragraphs(&transform.right_notes, &body_paragraphs);

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

    let sentinel = format!("{}SENT{}", transform.nonce, transform.nonce);

    let fm_owned = if content.starts_with("---") {
        let after = &content[3..];
        after.find("\n---").map(|end| content[..3 + end + 4].to_string())
    } else {
        None
    };

    let para_refs: Vec<&str> = para_texts.iter().map(|s| s.as_str()).collect();
    let mut all_note_refs: Vec<&str> = fn_bodies.iter().map(|s| s.as_str()).collect();
    for b in &right_note_bodies {
        all_note_refs.push(b.as_str());
    }
    let pandoc_input = build_pandoc_input(
        fm_owned.as_deref(),
        &para_refs,
        &all_note_refs,
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
    let n_para_texts = para_texts.len();
    let n_fn_bodies = fn_bodies.len();
    let n_right_note_bodies = right_note_bodies.len();
    let n_all_notes = n_fn_bodies + n_right_note_bodies;

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
            n_para_texts,
            n_all_notes,
        );

        let fn_notes_latex: Vec<String> = split.notes[..n_fn_bodies].to_vec();
        let right_notes_latex: Vec<String> = split.notes[n_fn_bodies..].to_vec();

        let left_paragraphs: Vec<String> = split
            .paragraphs
            .iter()
            .map(|p| {
                let p = substitute_footnote_placeholders(
                    p,
                    &nonce,
                    &footnotes,
                    &fn_notes_latex,
                );
                substitute_mark_placeholders(&p, &nonce, &marks)
            })
            .collect();

        // Populate body_latex on attached notes
        let attached_with_latex: Vec<AttachedNote> = attached
            .into_iter()
            .enumerate()
            .map(|(i, mut a)| {
                if i < right_notes_latex.len() {
                    a.body_latex = Some(right_notes_latex[i].clone());
                }
                a
            })
            .collect();

        // Build right-page paragraphs
        let n_paras = left_paragraphs.len();
        let mut right_paragraphs: Vec<String> = (0..n_paras)
            .map(|pi| {
                let notes_for_para: Vec<AttachedNote> = attached_with_latex
                    .iter()
                    .filter(|a| a.paragraph_index == pi)
                    .map(|a| AttachedNote {
                        paragraph_index: a.paragraph_index,
                        span_prefix: a.span_prefix.clone(),
                        annotation_type: a.annotation_type.clone(),
                        certainty: a.certainty.clone(),
                        body_md: a.body_md.clone(),
                        body_latex: a.body_latex.clone(),
                    })
                    .collect();
                render_right_page_notes(&notes_for_para)
            })
            .collect();

        // Pad to equal lengths
        while right_paragraphs.len() < left_paragraphs.len() {
            right_paragraphs.push("~".to_string());
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
            &left_paragraphs,
            &right_paragraphs,
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
        let result = transform_document(content, &[ann], &[scope], &default_routing());
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
        let result = transform_document(content, &[ann], &[scope], &default_routing());
        assert!(!result.body.contains("<!---"));
        assert!(!result.body.contains("--->"));
        assert!(result.body.contains("Hello world."));
        assert!(result.body.contains("More text."));
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
        let result = transform_document(content, &[ann], &[scope], &default_routing());
        assert_eq!(result.footnotes.len(), 1);
        assert_eq!(result.footnotes[0].route, Route::AFootnote);
        let nonce = &result.nonce;
        assert!(result.body.contains(&format!("{nonce}FO0{nonce}")));
        assert!(result.body.contains(&format!("{nonce}FC0{nonce}")));
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
        let result = transform_document(content, &[ann_outer, ann_inner], &scopes, &default_routing());
        assert_eq!(result.footnotes.len(), 2);

        let nonce = &result.nonce;
        let fo0 = format!("{nonce}FO0{nonce}");
        let fc0 = format!("{nonce}FC0{nonce}");
        let fo1 = format!("{nonce}FO1{nonce}");
        let fc1 = format!("{nonce}FC1{nonce}");
        // All four placeholders must appear intact in the body
        assert!(result.body.contains(&fo0), "FO0 missing");
        assert!(result.body.contains(&fc0), "FC0 missing");
        assert!(result.body.contains(&fo1), "FO1 missing");
        assert!(result.body.contains(&fc1), "FC1 missing");
        // Nesting order: FO0 < FO1 < FC1 < FC0
        let pos_fo0 = result.body.find(&fo0).unwrap();
        let pos_fo1 = result.body.find(&fo1).unwrap();
        let pos_fc1 = result.body.find(&fc1).unwrap();
        let pos_fc0 = result.body.find(&fc0).unwrap();
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
        let result = transform_document(content, &[ann1, ann2], &scopes, &default_routing());
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
        let result = transform_document(content, &[ann1, ann2], &scopes, &default_routing());
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
        let result = transform_document(content, &[ann1, ann2], &scopes, &default_routing());
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
        let result = transform_document(content, &[ann], &[scope], &default_routing());
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
        let result = transform_document(content, &[ann], &[scope], &default_routing());
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
        let result = transform_document(content, &[ann], &[scope], &default_routing());
        assert_eq!(result.marks.len(), 1);
        assert_eq!(result.marks[0].code, "hi");
        let nonce = &result.nonce;
        assert!(result.body.contains(&format!("{nonce}MO0{nonce}")));
        assert!(result.body.contains(&format!("{nonce}MC0{nonce}")));
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

    // --- Cycle A9: note-to-paragraph attachment ---

    #[test]
    fn attach_notes_single_paragraph() {
        let paras = vec![
            ParagraphSpan {
                index: 0,
                start: 0,
                end: 16,
            },
            ParagraphSpan {
                index: 1,
                start: 18,
                end: 35,
            },
        ];
        let notes = vec![RightNote {
            annotation_type: "n".into(),
            certainty: Certainty::Neutral,
            body_md: "A note.".into(),
            scope_range: ScopeRange { start: 5, end: 10 },
        }];
        let attached = attach_notes_to_paragraphs(&notes, &paras);
        assert_eq!(attached.len(), 1);
        assert_eq!(attached[0].paragraph_index, 0);
        assert!(attached[0].span_prefix.is_none());
    }

    #[test]
    fn attach_notes_multi_paragraph_scope() {
        let paras = vec![
            ParagraphSpan {
                index: 0,
                start: 0,
                end: 16,
            },
            ParagraphSpan {
                index: 1,
                start: 18,
                end: 35,
            },
        ];
        let notes = vec![RightNote {
            annotation_type: "n".into(),
            certainty: Certainty::Neutral,
            body_md: "A note.".into(),
            scope_range: ScopeRange { start: 5, end: 30 },
        }];
        let attached = attach_notes_to_paragraphs(&notes, &paras);
        assert_eq!(attached.len(), 1);
        assert_eq!(attached[0].paragraph_index, 0);
        assert_eq!(attached[0].span_prefix.as_deref(), Some("(paras 1-2)"));
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
        let result = transform_document(content, &[ann], &scopes, &default_routing());
        assert_eq!(result.right_notes.len(), 1, "should surface as right note");
        assert_eq!(result.right_notes[0].body_md, "Orphan note.");
    }

    // --- Cycle 12: paragraph attachment on transformed coordinates ---

    #[test]
    fn attach_notes_uses_transformed_coordinates() {
        // A block-form annotation sits between two prose paragraphs, occupying
        // its own paragraph in the original. After transform, it's deleted.
        // A right note scoped to the 2nd prose paragraph (original index 2)
        // must attach to transformed paragraph index 1.
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
        let result = transform_document(content, &[ann, ann2], &[scope1, scope2], &routing);

        // In the transformed body, annotation is deleted, so "Second paragraph."
        // becomes paragraph index 1 (not 2)
        let body_paras = split_paragraphs(&result.body);
        assert_eq!(body_paras.len(), 2, "should have 2 paragraphs after stripping block annotation");

        // Attach using transformed paragraphs
        let attached = attach_notes_to_paragraphs(&result.right_notes, &body_paras);
        assert!(!attached.is_empty(), "should have at least one attached note");
        // The note about "Second paragraph" should be at transformed index 1
        let second_note = attached.iter().find(|a| a.body_md == "About second.");
        assert!(second_note.is_some(), "note about second paragraph should be attached");
        assert_eq!(second_note.unwrap().paragraph_index, 1,
            "note should attach to transformed paragraph index 1, not original index 2");
    }

    // --- Cycle A10: sentinel batch build + split ---

    #[test]
    fn build_pandoc_input_roundtrip() {
        let sentinel = "%%SENTINEL%%";
        let input = build_pandoc_input(
            Some("---\ntitle: T\n---"),
            &["Para one.", "Para two."],
            &["Note body."],
            sentinel,
        );
        assert!(input.contains("---\ntitle: T\n---"));
        assert!(input.contains("Para one."));
        assert!(input.contains("Para two."));
        assert!(input.contains("Note body."));
        // Sentinels: (n_paras - 1) between paras + n_notes + 1 trailing
        // = 1 + 1 + 1 = 3. No sentinel between frontmatter and para 0.
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
    fn build_pandoc_input_no_fm_has_trailing_sentinel() {
        let sentinel = "%%S%%";
        let input = build_pandoc_input(None, &["Only para."], &[], sentinel);
        // 0 between-para sentinels + 0 note sentinels + 1 trailing = 1
        assert_eq!(input.matches(sentinel).count(), 1);
        assert!(input.ends_with(&format!("\n\n{sentinel}\n\n")));
    }

    #[test]
    fn split_pandoc_output_recovers_pieces() {
        let sentinel = "%%S%%";
        let latex =
            "converted para1%%S%%converted para2%%S%%converted note%%S%%bibliography here";
        let split = split_pandoc_output(latex, sentinel, 2, 1);
        assert_eq!(split.paragraphs[0], "converted para1");
        assert_eq!(split.paragraphs[1], "converted para2");
        assert_eq!(split.notes[0], "converted note");
        assert_eq!(split.bibliography.as_deref(), Some("bibliography here"));
    }

    #[test]
    fn split_pandoc_output_no_bibliography() {
        let split = split_pandoc_output("p1%%S%%p2%%S%%", "%%S%%", 2, 0);
        assert_eq!(split.paragraphs.len(), 2);
        assert!(split.bibliography.is_none());
    }

    #[test]
    fn split_pandoc_output_fm_consumed_by_pandoc() {
        // pandoc consumes frontmatter, so piece 0 is para 0 (not empty)
        let sentinel = "%%S%%";
        let latex = "para one%%S%%para two%%S%%note body%%S%%";
        let split = split_pandoc_output(latex, sentinel, 2, 1);
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

    #[test]
    fn render_right_notes_single() {
        let notes = vec![AttachedNote {
            paragraph_index: 0,
            span_prefix: None,
            annotation_type: "n".into(),
            certainty: Certainty::Neutral,
            body_md: "A note body.".into(),
            body_latex: None,
        }];
        let rendered = render_right_page_notes(&notes);
        assert!(rendered.contains("\\textsc{n}"));
        assert!(rendered.contains("A note body."));
        assert!(!rendered.contains('?'));
        assert!(!rendered.contains('!'));
    }

    #[test]
    fn render_right_notes_with_certainty() {
        let notes = vec![AttachedNote {
            paragraph_index: 0,
            span_prefix: None,
            annotation_type: "tr".into(),
            certainty: Certainty::Tentative,
            body_md: "Translation.".into(),
            body_latex: None,
        }];
        let rendered = render_right_page_notes(&notes);
        assert!(rendered.contains("\\textsc{tr}?"));
    }

    #[test]
    fn render_right_notes_with_span_prefix() {
        let notes = vec![AttachedNote {
            paragraph_index: 0,
            span_prefix: Some("(paras 1-3)".into()),
            annotation_type: "n".into(),
            certainty: Certainty::Neutral,
            body_md: "Multi-para.".into(),
            body_latex: None,
        }];
        let rendered = render_right_page_notes(&notes);
        assert!(rendered.contains("(paras 1-3) \\textsc{n}"));
    }

    #[test]
    fn render_right_notes_multiple_joined() {
        let notes = vec![
            AttachedNote {
                paragraph_index: 0,
                span_prefix: None,
                annotation_type: "n".into(),
                certainty: Certainty::Neutral,
                body_md: "First.".into(),
                body_latex: None,
            },
            AttachedNote {
                paragraph_index: 0,
                span_prefix: None,
                annotation_type: "tr".into(),
                certainty: Certainty::Firm,
                body_md: "Second.".into(),
                body_latex: None,
            },
        ];
        let rendered = render_right_page_notes(&notes);
        assert!(rendered.contains("\\medskip"));
    }

    #[test]
    fn render_right_notes_uses_body_latex() {
        let notes = vec![AttachedNote {
            paragraph_index: 0,
            span_prefix: None,
            annotation_type: "n".into(),
            certainty: Certainty::Neutral,
            body_md: "raw % & _ markdown".into(),
            body_latex: Some("converted \\% \\& \\_ latex".into()),
        }];
        let rendered = render_right_page_notes(&notes);
        assert!(rendered.contains("converted \\% \\& \\_ latex"),
            "should use body_latex when available");
        assert!(!rendered.contains("raw % & _ markdown"),
            "should NOT use body_md when body_latex is available");
    }

    #[test]
    fn render_right_notes_empty() {
        assert_eq!(render_right_page_notes(&[]), "~");
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
            "Body paragraph one.".to_string(),
            "Body paragraph two.".to_string(),
            "Body paragraph three.".to_string(),
        ];
        let right = vec![
            "\\textsc{n} A note about para 1.".to_string(),
            "~".to_string(),
            "\\textsc{tr}? Translation of para 3.".to_string(),
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
        // Empty right paragraph
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
        let input = build_pandoc_input(Some(fm), paras, notes, sentinel);

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
        let split = split_pandoc_output(&latex, sentinel, 2, 1);

        assert_eq!(split.paragraphs.len(), 2, "expected 2 paragraphs");
        assert_eq!(split.notes.len(), 1, "expected 1 note");

        assert!(!split.paragraphs[0].is_empty(), "para 0 should not be empty");
        assert!(!split.paragraphs[1].is_empty(), "para 1 should not be empty");
        assert!(!split.notes[0].is_empty(), "note 0 should not be empty");
    }
}
