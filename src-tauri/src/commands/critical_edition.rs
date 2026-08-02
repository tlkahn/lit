use serde::Deserialize;
use std::collections::HashMap;
use std::io::Read as IoRead;
use std::path::{Path, PathBuf};
use std::process::Command;
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

    // Track footnote injection ranges for overlap detection
    let mut fn_ranges: Vec<(usize, usize)> = Vec::new();

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

        let scope_range = match scopes.get(i) {
            Some(Some(sr)) => sr,
            _ => continue,
        };

        let rk = route_key(ann);

        if ann.annotation_type == AnnotationType::Mark {
            if let Some(code) = &ann.mark {
                if !crosses_paragraph_boundary(scope_range, &paragraphs) {
                    let mi = marks.len();
                    marks.push(MarkEntry {
                        index: mi,
                        code: code.clone(),
                    });
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
            if has_partial_overlap(scope_range, &fn_ranges) {
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
            fn_ranges.push((scope_range.start, scope_range.end));
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

    // Sort deletions by start ascending for offset calculation
    let mut sorted_deletions = deletions.clone();
    sorted_deletions.sort_by_key(|d| d.0);

    // Build the result body: apply deletions first, then injections
    let mut body = content.to_string();

    // Apply deletions from back to front
    deletions.sort_by(|a, b| b.0.cmp(&a.0));
    for (start, end) in &deletions {
        let s = *start;
        let e = (*end).min(body.len());
        body.replace_range(s..e, "");
    }

    // Adjust injection positions for deletions
    let adjusted: Vec<(usize, usize, usize)> = injections
        .iter()
        .enumerate()
        .map(|(idx, inj)| {
            let adj_start = adjust_pos(inj.scope_start, &sorted_deletions);
            let adj_end = adjust_pos(inj.scope_end, &sorted_deletions);
            (adj_start, adj_end, idx)
        })
        .collect();

    // Sort by adjusted start descending for back-to-front insertion
    let mut sorted_adj = adjusted;
    sorted_adj.sort_by(|a, b| b.0.cmp(&a.0));

    for (adj_start, adj_end, idx) in &sorted_adj {
        let s = *adj_start;
        let e = (*adj_end).min(body.len());
        match &injections[*idx].kind {
            InjectionKind::Footnote { index } => {
                let close = format!("{nonce}FC{index}{nonce}");
                let open = format!("{nonce}FO{index}{nonce}");
                body.insert_str(e, &close);
                body.insert_str(s, &open);
            }
            InjectionKind::Mark { index } => {
                let close = format!("{nonce}MC{index}{nonce}");
                let open = format!("{nonce}MO{index}{nonce}");
                body.insert_str(e, &close);
                body.insert_str(s, &open);
            }
        }
    }

    TransformResult {
        body,
        footnotes,
        marks,
        right_notes,
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
    }

    for (i, para) in paragraphs.iter().enumerate() {
        if i > 0 || frontmatter.is_some() {
            parts.push(format!("\n\n{sentinel}\n\n"));
        }
        parts.push(para.to_string());
    }

    for note in note_bodies {
        parts.push(format!("\n\n{sentinel}\n\n"));
        parts.push(note.to_string());
    }

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
                        format!("{lemma}\\Bfootnote{{{note_body}}}")
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
        "hi" => ("\\hl{", "}"),
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
            format!("{prefix}{label}{certainty_suffix} {}", note.body_md)
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
    lines.push("\\usepackage{soul}".to_string());
    lines.push("\\usepackage[normalem]{ulem}".to_string());
    lines.push("\\usepackage{reledmac}".to_string());
    lines.push("\\usepackage{reledpar}".to_string());

    if opts.line_numbers {
        lines.push("\\firstlinenum{5}".to_string());
        lines.push("\\linenumincrement{5}".to_string());
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

    let original_paragraphs = split_paragraphs(&content);
    let attached = attach_notes_to_paragraphs(&transform.right_notes, &original_paragraphs);

    let fn_bodies: Vec<String> = transform
        .footnotes
        .iter()
        .map(|f| f.body_md.clone())
        .collect();

    let sentinel = format!("{}SENT{}", transform.nonce, transform.nonce);

    let fm_owned = if content.starts_with("---") {
        let after = &content[3..];
        after.find("\n---").map(|end| content[..3 + end + 4].to_string())
    } else {
        None
    };

    let para_refs: Vec<&str> = para_texts.iter().map(|s| s.as_str()).collect();
    let fn_refs: Vec<&str> = fn_bodies.iter().map(|s| s.as_str()).collect();
    let pandoc_input = build_pandoc_input(
        fm_owned.as_deref(),
        &para_refs,
        &fn_refs,
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

    let win = window.clone();
    let req_output = request.output_path.clone();
    let line_numbers = request.line_numbers;
    let nonce = transform.nonce.clone();
    let footnotes = transform.footnotes.clone();
    let marks = transform.marks.clone();
    let n_para_texts = para_texts.len();
    let n_fn_bodies = fn_bodies.len();

    let result = tauri::async_runtime::spawn_blocking(move || {
        let _ = win.emit(
            "lit:academic-export-progress",
            AcademicExportProgress {
                stage: "compiling".into(),
                format: "reledmac".into(),
            },
        );

        // Run pandoc: stdin -> latex fragments
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

        let mut child = Command::new(&pandoc_path)
            .args(&args)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .map_err(|e| format!("failed to run pandoc: {e}"))?;

        if let Some(mut stdin) = child.stdin.take() {
            use std::io::Write;
            let _ = stdin.write_all(pandoc_input.as_bytes());
        }

        let child_stdout = child.stdout.take();
        let child_stderr = child.stderr.take();

        let stdout_thread = std::thread::spawn(move || {
            let mut buf = Vec::new();
            if let Some(mut pipe) = child_stdout {
                let _ = pipe.read_to_end(&mut buf);
            }
            buf
        });
        let stderr_thread = std::thread::spawn(move || {
            let mut buf = Vec::new();
            if let Some(mut pipe) = child_stderr {
                let _ = pipe.read_to_end(&mut buf);
            }
            buf
        });

        let timeout = std::time::Duration::from_secs(300);
        let start = std::time::Instant::now();
        loop {
            match child.try_wait() {
                Ok(Some(_)) => break,
                Ok(None) => {
                    if start.elapsed() >= timeout {
                        let _ = child.kill();
                        let _ = stdout_thread.join();
                        let _ = stderr_thread.join();
                        return Err("pandoc timed out after 5 minutes".to_string());
                    }
                    std::thread::sleep(std::time::Duration::from_millis(200));
                }
                Err(e) => {
                    let _ = child.kill();
                    let _ = stdout_thread.join();
                    let _ = stderr_thread.join();
                    return Err(format!("failed to wait on pandoc: {e}"));
                }
            }
        }

        let status = child
            .wait()
            .map_err(|e| format!("failed to collect pandoc exit status: {e}"))?;
        let stdout_bytes = stdout_thread.join().unwrap_or_default();
        let stderr_bytes = stderr_thread.join().unwrap_or_default();
        let stderr = String::from_utf8_lossy(&stderr_bytes).to_string();

        if !status.success() {
            return Ok(ExportResult {
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
            n_fn_bodies,
        );

        let left_paragraphs: Vec<String> = split
            .paragraphs
            .iter()
            .map(|p| {
                let p = substitute_footnote_placeholders(
                    p,
                    &nonce,
                    &footnotes,
                    &split.notes,
                );
                substitute_mark_placeholders(&p, &nonce, &marks)
            })
            .collect();

        // Build right-page paragraphs
        let n_paras = left_paragraphs.len();
        let mut right_paragraphs: Vec<String> = (0..n_paras)
            .map(|pi| {
                let notes_for_para: Vec<AttachedNote> = attached
                    .iter()
                    .filter(|a| a.paragraph_index == pi)
                    .map(|a| AttachedNote {
                        paragraph_index: a.paragraph_index,
                        span_prefix: a.span_prefix.clone(),
                        annotation_type: a.annotation_type.clone(),
                        certainty: a.certainty.clone(),
                        body_md: a.body_md.clone(),
                    })
                    .collect();
                render_right_page_notes(&notes_for_para)
            })
            .collect();

        // Pad to equal lengths
        while right_paragraphs.len() < left_paragraphs.len() {
            right_paragraphs.push("~".to_string());
        }

        let preamble = build_preamble(&PreambleOptions {
            line_numbers,
            cjk_font,
            indic_preamble,
        });

        let tex = assemble_tex(
            &preamble,
            &left_paragraphs,
            &right_paragraphs,
            split.bibliography.as_deref(),
        );

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
        assert_eq!(input.matches(sentinel).count(), 3);
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
        let split = split_pandoc_output("p1%%S%%p2", "%%S%%", 2, 0);
        assert_eq!(split.paragraphs.len(), 2);
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
        assert!(result.contains("word\\Bfootnote{conv}"));
        assert!(!result.contains(nonce));
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
        assert_eq!(mark_macro("hi"), ("\\hl{", "}"));
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
        assert_eq!(result, "\\hl{word}");
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
            },
            AttachedNote {
                paragraph_index: 0,
                span_prefix: None,
                annotation_type: "tr".into(),
                certainty: Certainty::Firm,
                body_md: "Second.".into(),
            },
        ];
        let rendered = render_right_page_notes(&notes);
        assert!(rendered.contains("\\medskip"));
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
        });
        assert!(p.contains("twoside"));
    }

    #[test]
    fn preamble_contains_normalem_ulem() {
        let p = build_preamble(&PreambleOptions {
            line_numbers: false,
            cjk_font: None,
            indic_preamble: None,
        });
        assert!(p.contains("[normalem]{ulem}"));
    }

    #[test]
    fn preamble_line_numbers_on() {
        let p = build_preamble(&PreambleOptions {
            line_numbers: true,
            cjk_font: None,
            indic_preamble: None,
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
        });
        assert!(!p.contains("\\firstlinenum"));
    }

    #[test]
    fn preamble_cjk_font() {
        let p = build_preamble(&PreambleOptions {
            line_numbers: false,
            cjk_font: Some("PingFang SC".into()),
            indic_preamble: None,
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
}
