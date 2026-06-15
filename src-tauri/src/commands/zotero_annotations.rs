use rusqlite::{params, Connection, OpenFlags};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::Arc;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ZoteroAnnotation {
    pub item_id: i64,
    pub ann_type: i32,
    pub text: Option<String>,
    pub comment: Option<String>,
    pub color: Option<String>,
    pub page_label: Option<String>,
    pub sort_index: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ZoteroChildNote {
    pub item_id: i64,
    pub html_content: String,
    pub title: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ZoteroPdfRecord {
    pub filename: String,
    pub parent_title: Option<String>,
    pub annotations: Vec<ZoteroAnnotation>,
    pub child_notes: Vec<ZoteroChildNote>,
}

/// Open the Zotero SQLite database in read-only mode.
/// Uses URI filename with `?mode=ro` to avoid WAL lock contention
/// when Zotero is running.
fn open_zotero_db(db_path: &str) -> Result<Connection, String> {
    Connection::open_with_flags(
        format!("file:{}?mode=ro", db_path),
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_URI,
    )
    .map_err(|e| format!("Failed to open Zotero database at '{}': {}", db_path, e))
}

/// Strip HTML tags from a string, collapsing whitespace.
/// Handles simple HTML as produced by Zotero notes (`<p>`, `<b>`, `<br>`, etc.).
fn strip_html_tags(html: &str) -> String {
    let mut result = String::with_capacity(html.len());
    let mut in_tag = false;
    for ch in html.chars() {
        match ch {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => result.push(ch),
            _ => {}
        }
    }
    result.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Query the Zotero database for PDF annotations matching the given filename.
///
/// Returns annotations of type 1 (highlight), 2 (note/sticky), and 5 (underline),
/// filtering out type 3 (image) and type 4 (ink/freehand) since they cannot be
/// meaningfully represented as text. Results are ordered by `sortIndex` which
/// encodes document position (page, y-position, character offset).
pub fn query_zotero_for_pdf(
    db_path: &str,
    pdf_filename: &str,
) -> Result<Vec<ZoteroAnnotation>, String> {
    let conn = open_zotero_db(db_path)?;

    let mut stmt = conn
        .prepare(
            "SELECT
                ia.itemID,
                ia.type,
                ia.text,
                ia.comment,
                ia.color,
                ia.pageLabel,
                ia.sortIndex
            FROM itemAnnotations ia
            JOIN itemAttachments att ON ia.parentItemID = att.itemID
            WHERE att.path LIKE '%' || ?1
              AND ia.type NOT IN (3, 4)
            ORDER BY ia.sortIndex ASC",
        )
        .map_err(|e| format!("Failed to prepare annotation query: {}", e))?;

    let rows = stmt
        .query_map(params![pdf_filename], |row| {
            Ok(ZoteroAnnotation {
                item_id: row.get(0)?,
                ann_type: row.get(1)?,
                text: row.get(2)?,
                comment: row.get(3)?,
                color: row.get(4)?,
                page_label: row.get(5)?,
                sort_index: row.get(6)?,
            })
        })
        .map_err(|e| format!("Failed to query annotations: {}", e))?;

    let mut annotations = Vec::new();
    for row in rows {
        annotations.push(row.map_err(|e| format!("Failed to read annotation row: {}", e))?);
    }
    Ok(annotations)
}

/// Resolve a PDF filename stem to its Zotero attachment and parent item IDs.
///
/// Returns `Some((attachment_item_id, parent_item_id))` if found, `None` otherwise.
/// Matching is case-insensitive. Orphan attachments (NULL parentItemID) are skipped.
pub fn resolve_pdf_in_zotero(
    db_path: &str,
    pdf_filename_stem: &str,
) -> Result<Option<(i64, i64)>, String> {
    let conn = open_zotero_db(db_path)?;

    let mut stmt = conn
        .prepare(
            "SELECT
                att.itemID,
                att.parentItemID
            FROM itemAttachments att
            JOIN items i ON att.itemID = i.itemID
            WHERE i.itemTypeID = (SELECT itemTypeID FROM itemTypes WHERE typeName = 'attachment')
              AND att.contentType = 'application/pdf'
              AND LOWER(att.path) LIKE '%' || LOWER(?1) || '.pdf'
            LIMIT 1",
        )
        .map_err(|e| format!("Failed to prepare resolve query: {}", e))?;

    let mut rows = stmt
        .query(params![pdf_filename_stem])
        .map_err(|e| format!("Failed to query PDF resolution: {}", e))?;

    while let Some(row) = rows.next().map_err(|e| format!("Failed to read row: {}", e))? {
        let att_id: i64 = row
            .get(0)
            .map_err(|e| format!("Failed to read attachment ID: {}", e))?;
        let parent_id: Option<i64> = row
            .get(1)
            .map_err(|e| format!("Failed to read parent ID: {}", e))?;
        if let Some(pid) = parent_id {
            return Ok(Some((att_id, pid)));
        }
    }
    Ok(None)
}

/// Query child notes attached to a Zotero parent item.
///
/// HTML content is stripped to plain text. Results are ordered by item ID.
pub fn query_zotero_child_notes(
    db_path: &str,
    parent_item_id: i64,
) -> Result<Vec<ZoteroChildNote>, String> {
    let conn = open_zotero_db(db_path)?;

    let mut stmt = conn
        .prepare(
            "SELECT
                n.itemID,
                n.note,
                n.title
            FROM itemNotes n
            JOIN items i ON n.itemID = i.itemID
            WHERE n.parentItemID = ?1
              AND i.itemTypeID = (SELECT itemTypeID FROM itemTypes WHERE typeName = 'note')
            ORDER BY n.itemID ASC",
        )
        .map_err(|e| format!("Failed to prepare child notes query: {}", e))?;

    let rows = stmt
        .query_map(params![parent_item_id], |row| {
            let item_id: i64 = row.get(0)?;
            let note: Option<String> = row.get(1)?;
            let title: Option<String> = row.get(2)?;
            let html_content = strip_html_tags(note.as_deref().unwrap_or(""));
            Ok(ZoteroChildNote {
                item_id,
                html_content,
                title,
            })
        })
        .map_err(|e| format!("Failed to query child notes: {}", e))?;

    let mut notes = Vec::new();
    for row in rows {
        notes.push(row.map_err(|e| format!("Failed to read note row: {}", e))?);
    }
    Ok(notes)
}

/// Determine the Zotero database path from user preferences.
///
/// Reads `zotero.databasePath` from preferences, falling back to
/// `~/Zotero/zotero.sqlite` (Zotero's standard location on macOS/Linux).
pub fn zotero_db_path(prefs: &crate::preferences::Preferences) -> String {
    prefs
        .extra
        .get("zotero.databasePath")
        .and_then(|v| v.as_str())
        .map(|s| crate::cli::expand_tilde(s))
        .unwrap_or_else(|| crate::cli::expand_tilde("~/Zotero/zotero.sqlite"))
}

// ---------------------------------------------------------------------------
// Phase 1.2: Text matching engine
// ---------------------------------------------------------------------------

/// Collapse all whitespace runs to a single space, trim, and lowercase.
pub fn normalize(text: &str) -> String {
    text.split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

/// Search for `needle` as an exact normalized substring across all lines joined.
/// Returns the 0-based line index where the match ENDS (insertion point).
/// Returns `None` if the needle is not found.
pub fn find_exact_match(needle: &str, lines: &[&str]) -> Option<usize> {
    let mut joined = String::new();
    let mut line_starts: Vec<(usize, usize)> = Vec::with_capacity(lines.len());

    let mut pos: usize = 0;
    for (i, line) in lines.iter().enumerate() {
        if !joined.is_empty() {
            joined.push(' ');
            pos += 1;
        }
        line_starts.push((pos, i));
        let nl = normalize(line);
        joined.push_str(&nl);
        pos += nl.len();
    }

    let norm_needle = normalize(needle);
    let idx = joined.find(&norm_needle)?;
    let end = idx + norm_needle.len();

    let mut result = 0;
    for &(start, li) in &line_starts {
        if start <= end {
            result = li;
        } else {
            break;
        }
    }
    Some(result)
}

/// Group consecutive non-blank lines into paragraphs.
/// Returns a vec of (normalized_paragraph_text, last_line_index).
/// Blank lines (whitespace-only) act as paragraph separators.
pub fn build_paragraphs(lines: &[&str]) -> Vec<(String, usize)> {
    let mut paragraphs: Vec<(String, usize)> = Vec::new();
    let mut current_parts: Vec<String> = Vec::new();
    let mut last_line_idx: usize = 0;

    for (i, line) in lines.iter().enumerate() {
        let nl = normalize(line);
        if nl.is_empty() {
            if !current_parts.is_empty() {
                let text = current_parts.join(" ");
                paragraphs.push((text, last_line_idx));
                current_parts.clear();
            }
        } else {
            current_parts.push(nl);
            last_line_idx = i;
        }
    }
    if !current_parts.is_empty() {
        let text = current_parts.join(" ");
        paragraphs.push((text, last_line_idx));
    }

    paragraphs
}

/// Compute the length of the longest common substring between `a` and `b`
/// using a standard DP approach with O(min(|a|,|b|)) space.
fn lcs_length(a: &str, b: &str) -> usize {
    let a = a.as_bytes();
    let b = b.as_bytes();

    // Ensure `b` is the shorter side for memory efficiency.
    let (a, b) = if a.len() >= b.len() { (a, b) } else { (b, a) };

    let cols = b.len();
    let mut prev = vec![0usize; cols + 1];
    let mut curr = vec![0usize; cols + 1];
    let mut max_len: usize = 0;

    for &ai in a.iter() {
        for (j, &bj) in b.iter().enumerate() {
            if ai == bj {
                curr[j + 1] = prev[j] + 1;
                if curr[j + 1] > max_len {
                    max_len = curr[j + 1];
                }
            } else {
                curr[j + 1] = 0;
            }
        }
        std::mem::swap(&mut prev, &mut curr);
        curr.iter_mut().for_each(|x| *x = 0);
    }
    max_len
}

/// Score each paragraph against the needle using longest-common-substring ratio.
/// LCS ratio = lcs_length / max(len(needle), len(paragraph)).
/// Returns the `last_line_index` of the best-matching paragraph if its score >= threshold.
pub fn find_fuzzy_match(
    needle: &str,
    paragraphs: &[(String, usize)],
    threshold: f64,
) -> Option<usize> {
    let norm_needle = normalize(needle);
    if norm_needle.is_empty() {
        return None;
    }

    let mut best_score: f64 = 0.0;
    let mut best_line: Option<usize> = None;

    for (para_text, last_line) in paragraphs {
        let max_len = norm_needle.len().max(para_text.len());
        if max_len == 0 {
            continue;
        }
        let lcs = lcs_length(&norm_needle, para_text);
        let score = lcs as f64 / max_len as f64;
        if score > best_score {
            best_score = score;
            best_line = Some(*last_line);
        }
    }

    if best_score >= threshold {
        best_line
    } else {
        None
    }
}

/// Find the line index where `needle` best matches within `lines`.
/// Tries exact substring match first, falls back to fuzzy paragraph matching.
/// Returns `None` if the needle is empty or no match meets the threshold.
pub fn find_match_line(needle: &str, lines: &[&str], threshold: f64) -> Option<usize> {
    let norm_needle = normalize(needle);
    if norm_needle.is_empty() {
        return None;
    }

    if let Some(line_idx) = find_exact_match(needle, lines) {
        return Some(line_idx);
    }

    let paragraphs = build_paragraphs(lines);
    find_fuzzy_match(needle, &paragraphs, threshold)
}

/// Read the fuzzy-match threshold from preferences.
/// Key: `zotero.matchThreshold`. Default: 0.65.
pub fn zotero_match_threshold(prefs: &crate::preferences::Preferences) -> f64 {
    prefs
        .extra
        .get("zotero.matchThreshold")
        .and_then(|v| v.as_f64())
        .unwrap_or(0.65)
}

// ---------------------------------------------------------------------------
// Phase 1.3: Annotation generation, insertion, and Tauri command
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImportResult {
    pub inserted: usize,
    pub unmatched: usize,
    pub skipped: usize,
}

fn ann_type_name(ann_type: i32) -> &'static str {
    match ann_type {
        1 => "highlight",
        2 => "note",
        5 => "underline",
        6 => "freetext",
        _ => "annotation",
    }
}

fn truncate_anchor(text: &str, max_len: usize) -> String {
    let trimmed: String = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if trimmed.len() <= max_len {
        return trimmed;
    }
    let truncated = &trimmed[..max_len];
    match truncated.rfind(' ') {
        Some(pos) => format!("{}\u{2026}", &truncated[..pos]),
        None => format!("{}\u{2026}", truncated),
    }
}

fn escape_anchor(text: &str) -> String {
    text.replace('\\', "\\\\").replace('"', "\\\"")
}

/// Generate a Lit annotation DSL string for a single Zotero annotation.
pub fn zotero_ann_to_dsl(ann: &ZoteroAnnotation) -> String {
    let uuid = format!("zot-{}", ann.item_id);
    let type_name = ann_type_name(ann.ann_type);

    // Build page prefix
    let page_prefix = match ann.page_label.as_deref() {
        Some(p) if !p.is_empty() => format!("p. {} \u{2014} {}", p, type_name),
        _ => type_name.to_string(),
    };

    // Build body
    let body = match ann.comment.as_deref() {
        Some(c) if !c.is_empty() => format!("{}: {}", page_prefix, c),
        _ => page_prefix,
    };

    // Build scope anchor
    let anchor = ann
        .text
        .as_deref()
        .filter(|t| !t.is_empty())
        .map(|t| truncate_anchor(t, 60));

    // Build compact form candidate
    let scope_part = match &anchor {
        Some(a) => format!(r#" ^"{}""#, escape_anchor(a)),
        None => String::new(),
    };

    let compact = format!("<!---[{}] n:{} | {} --->", uuid, scope_part, body);

    if compact.len() <= 120 {
        compact
    } else {
        let mut lines = vec![format!("<!---[{}]", uuid), "n:".to_string()];
        if let Some(a) = &anchor {
            lines.push(format!(r#"^"{}""#, escape_anchor(a)));
        }
        lines.push("---".to_string());
        lines.push(body);
        lines.push("--->".to_string());
        lines.join("\n")
    }
}

/// Generate a Lit annotation DSL string for a Zotero child note.
pub fn zotero_note_to_dsl(note: &ZoteroChildNote) -> String {
    let uuid = format!("zot-note-{}", note.item_id);
    let body = match note.title.as_deref() {
        Some(t) if !t.is_empty() => format!("{}: {}", t, note.html_content),
        _ => note.html_content.clone(),
    };

    let compact = format!("<!---[{}] n: | {} --->", uuid, body);

    if compact.len() <= 120 {
        compact
    } else {
        format!("<!---[{}]\nn:\n---\n{}\n--->", uuid, body)
    }
}

/// Extract all existing Zotero annotation IDs from markdown content.
///
/// Scans for `<!---[zot-...]` patterns and returns the set of IDs found
/// (e.g. `zot-301`, `zot-note-400`).
pub fn existing_zotero_ids(content: &str) -> HashSet<String> {
    let mut ids = HashSet::new();
    let mut search_from = 0;
    while let Some(start) = content[search_from..].find("<!---[zot-") {
        let abs_start = search_from + start + 6; // skip "<!---["
        if let Some(end) = content[abs_start..].find(']') {
            let id = &content[abs_start..abs_start + end];
            if !id.is_empty() {
                ids.insert(id.to_string());
            }
            search_from = abs_start + end;
        } else {
            break;
        }
    }
    ids
}

/// Detect the line index of YAML frontmatter closing delimiter.
///
/// Returns `Some(line_index)` of the closing `---` if the file starts
/// with a `---` line. Returns `None` if there is no frontmatter.
fn detect_frontmatter_end(lines: &[String]) -> Option<usize> {
    if lines.first().map(|l| l.trim()) != Some("---") {
        return None;
    }
    for (i, line) in lines.iter().enumerate().skip(1) {
        if line.trim() == "---" {
            return Some(i);
        }
    }
    None
}

/// Insert annotation DSL strings into markdown content at specified line positions.
///
/// Each entry in `annotations_with_positions` is `(line_index, dsl_string)`.
/// Insertions happen after the target line. YAML frontmatter is respected:
/// insertions targeting lines inside frontmatter are clamped to after it.
pub fn insert_annotations_into_markdown(
    content: &str,
    mut annotations_with_positions: Vec<(usize, String)>,
) -> String {
    let mut lines: Vec<String> = content.lines().map(|l| l.to_string()).collect();
    let trailing_newline = content.ends_with('\n');

    let frontmatter_end = detect_frontmatter_end(&lines);

    // Sort descending by line_index for bottom-up insertion
    annotations_with_positions.sort_by(|a, b| b.0.cmp(&a.0));

    for (line_idx, dsl) in annotations_with_positions {
        // Clamp: never insert inside frontmatter
        let insert_after = line_idx.max(frontmatter_end.unwrap_or(0));
        let pos = (insert_after + 1).min(lines.len());
        lines.insert(pos, String::new());
        lines.insert(pos + 1, dsl);
    }

    let mut result = lines.join("\n");
    if trailing_newline && !result.ends_with('\n') {
        result.push('\n');
    }
    result
}

/// Format a collection of unmatched annotations into a markdown section.
pub fn collect_unmatched_section(unmatched: &[ZoteroAnnotation]) -> String {
    let mut parts = vec![
        "## Unmatched Zotero Annotations".to_string(),
        String::new(),
    ];
    for ann in unmatched {
        parts.push(zotero_ann_to_dsl(ann));
        parts.push(String::new());
    }
    parts.join("\n")
}

#[tauri::command]
pub async fn import_zotero_annotations(
    key: String,
    workspace_path: String,
    graph_state: tauri::State<'_, Arc<crate::commands::graph::GraphRegistry>>,
    app_handle: tauri::AppHandle,
) -> Result<ImportResult, String> {
    let root = PathBuf::from(&workspace_path);
    let gi = crate::commands::page::lookup_graph_index(&graph_state, &root)
        .ok_or_else(|| "Graph index not ready".to_string())?;

    // Get bib entry and its PDF file path
    let pdf_rel_path = {
        let store = gi.store();
        let entry = crate::bib::db::get_bib_item(&store.conn, &key)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| format!("entry '{}' not found", key))?;
        entry
            .file
            .filter(|f| !f.is_empty())
            .ok_or_else(|| format!("entry '{}' has no linked PDF", key))?
    };

    // Read preferences
    let prefs = crate::preferences::read_preferences(&app_handle);
    let db_path = zotero_db_path(&prefs);
    let threshold = zotero_match_threshold(&prefs);
    let search_paths = crate::preferences::companion_search_paths(&prefs);

    // Find companion markdown
    let companion_rel = crate::commands::workspace::find_companion(
        &pdf_rel_path,
        &root,
        &search_paths,
    )
    .ok_or_else(|| format!("no companion markdown found for '{}'", pdf_rel_path))?;
    let companion_abs = root.join(&companion_rel);

    // Extract PDF filename for Zotero lookup
    let pdf_path_obj = std::path::Path::new(&pdf_rel_path);
    let pdf_filename = pdf_path_obj
        .file_name()
        .ok_or_else(|| "invalid PDF path".to_string())?
        .to_str()
        .ok_or_else(|| "invalid PDF filename".to_string())?
        .to_string();

    let pdf_stem = pdf_path_obj
        .file_stem()
        .ok_or_else(|| "invalid PDF path".to_string())?
        .to_str()
        .ok_or_else(|| "invalid PDF stem".to_string())?
        .to_string();

    // Run blocking DB + file work
    let companion_path = companion_abs.clone();
    tokio::task::spawn_blocking(move || {
        // Resolve in Zotero
        let (_att_id, parent_id) = resolve_pdf_in_zotero(&db_path, &pdf_stem)?
            .ok_or_else(|| {
                format!("PDF '{}' not found in Zotero database", pdf_filename)
            })?;

        // Get annotations and child notes
        let annotations = query_zotero_for_pdf(&db_path, &pdf_filename)?;
        let child_notes = query_zotero_child_notes(&db_path, parent_id)?;

        // Read companion content
        let content = std::fs::read_to_string(&companion_path)
            .map_err(|e| format!("failed to read companion: {}", e))?;

        // Dedup
        let existing_ids = existing_zotero_ids(&content);
        let new_anns: Vec<&ZoteroAnnotation> = annotations
            .iter()
            .filter(|a| !existing_ids.contains(&format!("zot-{}", a.item_id)))
            .collect();
        let new_notes: Vec<&ZoteroChildNote> = child_notes
            .iter()
            .filter(|n| !existing_ids.contains(&format!("zot-note-{}", n.item_id)))
            .collect();
        let skipped =
            (annotations.len() - new_anns.len()) + (child_notes.len() - new_notes.len());

        if new_anns.is_empty() && new_notes.is_empty() {
            return Ok(ImportResult {
                inserted: 0,
                unmatched: 0,
                skipped,
            });
        }

        // Match annotations to line positions in companion
        let lines: Vec<&str> = content.lines().collect();
        let mut matched: Vec<(usize, String)> = Vec::new();
        let mut unmatched_anns: Vec<&ZoteroAnnotation> = Vec::new();

        for ann in &new_anns {
            let dsl = zotero_ann_to_dsl(ann);
            if let Some(text) = ann.text.as_deref().filter(|t| !t.is_empty()) {
                if let Some(line_idx) = find_match_line(text, &lines, threshold) {
                    matched.push((line_idx, dsl));
                } else {
                    unmatched_anns.push(ann);
                }
            } else {
                unmatched_anns.push(ann);
            }
        }

        // Generate DSL for child notes (append at end)
        let note_dsls: Vec<String> =
            new_notes.iter().map(|n| zotero_note_to_dsl(n)).collect();

        let inserted = matched.len() + note_dsls.len();
        let unmatched_count = unmatched_anns.len();

        let mut result = insert_annotations_into_markdown(&content, matched);

        // Append child notes at end
        if !note_dsls.is_empty() {
            if !result.ends_with('\n') {
                result.push('\n');
            }
            result.push('\n');
            for dsl in &note_dsls {
                result.push_str(dsl);
                result.push_str("\n\n");
            }
        }

        // Append unmatched section
        if !unmatched_anns.is_empty() {
            let section = collect_unmatched_section(
                &unmatched_anns
                    .iter()
                    .map(|a| (*a).clone())
                    .collect::<Vec<_>>(),
            );
            if !result.ends_with('\n') {
                result.push('\n');
            }
            result.push('\n');
            result.push_str(&section);
            if !result.ends_with('\n') {
                result.push('\n');
            }
        }

        // Write back
        std::fs::write(&companion_path, &result)
            .map_err(|e| format!("failed to write companion: {}", e))?;

        Ok(ImportResult {
            inserted: inserted + unmatched_count,
            unmatched: unmatched_count,
            skipped,
        })
    })
    .await
    .map_err(|e| format!("task failed: {}", e))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    /// Create a minimal Zotero-schema SQLite database with test data.
    /// Returns the TempDir (must be kept alive) and the path string.
    fn create_test_db() -> (tempfile::TempDir, String) {
        let dir = tempfile::TempDir::new().unwrap();
        let db_path = dir.path().join("zotero.sqlite");
        let path_str = db_path.to_str().unwrap().to_string();

        let conn = Connection::open(&db_path).unwrap();

        conn.execute_batch(
            "
            CREATE TABLE itemTypes (
                itemTypeID INTEGER PRIMARY KEY,
                typeName TEXT NOT NULL UNIQUE
            );
            INSERT INTO itemTypes (itemTypeID, typeName) VALUES (1, 'attachment');
            INSERT INTO itemTypes (itemTypeID, typeName) VALUES (2, 'note');
            INSERT INTO itemTypes (itemTypeID, typeName) VALUES (3, 'journalArticle');

            CREATE TABLE items (
                itemID INTEGER PRIMARY KEY,
                itemTypeID INTEGER NOT NULL,
                FOREIGN KEY (itemTypeID) REFERENCES itemTypes(itemTypeID)
            );

            CREATE TABLE itemAttachments (
                itemID INTEGER PRIMARY KEY,
                parentItemID INTEGER,
                contentType TEXT,
                path TEXT,
                FOREIGN KEY (itemID) REFERENCES items(itemID)
            );

            CREATE TABLE itemAnnotations (
                itemID INTEGER PRIMARY KEY,
                parentItemID INTEGER NOT NULL,
                type INTEGER NOT NULL,
                text TEXT,
                comment TEXT,
                color TEXT,
                pageLabel TEXT,
                sortIndex TEXT NOT NULL,
                FOREIGN KEY (parentItemID) REFERENCES items(itemID)
            );

            CREATE TABLE itemNotes (
                itemID INTEGER PRIMARY KEY,
                parentItemID INTEGER,
                note TEXT,
                title TEXT,
                FOREIGN KEY (itemID) REFERENCES items(itemID)
            );
        ",
        )
        .unwrap();

        // -- Parent item (journal article) --
        conn.execute(
            "INSERT INTO items (itemID, itemTypeID) VALUES (100, 3)",
            [],
        )
        .unwrap();

        // -- PDF attachment --
        conn.execute(
            "INSERT INTO items (itemID, itemTypeID) VALUES (200, 1)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO itemAttachments (itemID, parentItemID, contentType, path)
             VALUES (200, 100, 'application/pdf', 'storage:Smith2024_Deep_Learning.pdf')",
            [],
        )
        .unwrap();

        // -- Annotations on the PDF --

        // Type 1 = highlight (page 5)
        conn.execute(
            "INSERT INTO items (itemID, itemTypeID) VALUES (301, 1)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO itemAnnotations (itemID, parentItemID, type, text, comment, color, pageLabel, sortIndex)
             VALUES (301, 200, 1, 'highlighted text one', 'my comment', '#ffd400', '5', '00005|000100|00000')",
            [],
        )
        .unwrap();

        // Type 2 = note/sticky note (page 3)
        conn.execute(
            "INSERT INTO items (itemID, itemTypeID) VALUES (302, 1)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO itemAnnotations (itemID, parentItemID, type, text, comment, color, pageLabel, sortIndex)
             VALUES (302, 200, 2, NULL, 'sticky note text', '#ff6666', '3', '00003|000050|00000')",
            [],
        )
        .unwrap();

        // Type 3 = image (should be SKIPPED)
        conn.execute(
            "INSERT INTO items (itemID, itemTypeID) VALUES (303, 1)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO itemAnnotations (itemID, parentItemID, type, text, comment, color, pageLabel, sortIndex)
             VALUES (303, 200, 3, NULL, 'image region', '#00ff00', '7', '00007|000200|00000')",
            [],
        )
        .unwrap();

        // Type 4 = ink (should be SKIPPED)
        conn.execute(
            "INSERT INTO items (itemID, itemTypeID) VALUES (304, 1)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO itemAnnotations (itemID, parentItemID, type, text, comment, color, pageLabel, sortIndex)
             VALUES (304, 200, 4, NULL, 'freehand drawing', '#0000ff', '8', '00008|000300|00000')",
            [],
        )
        .unwrap();

        // Type 1 = another highlight (page 1, should appear first after sort)
        conn.execute(
            "INSERT INTO items (itemID, itemTypeID) VALUES (305, 1)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO itemAnnotations (itemID, parentItemID, type, text, comment, color, pageLabel, sortIndex)
             VALUES (305, 200, 1, 'highlighted text on page one', NULL, '#ffd400', '1', '00001|000020|00000')",
            [],
        )
        .unwrap();

        // -- Child notes on the parent item --
        conn.execute(
            "INSERT INTO items (itemID, itemTypeID) VALUES (400, 2)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO itemNotes (itemID, parentItemID, note, title)
             VALUES (400, 100, '<p>This is a <b>child note</b> with HTML.</p>', NULL)",
            [],
        )
        .unwrap();

        conn.execute(
            "INSERT INTO items (itemID, itemTypeID) VALUES (401, 2)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO itemNotes (itemID, parentItemID, note, title)
             VALUES (401, 100, '<p>Second note</p><p>with two paragraphs.</p>', 'My Note Title')",
            [],
        )
        .unwrap();

        drop(conn);
        (dir, path_str)
    }

    // -----------------------------------------------------------------------
    // query_zotero_for_pdf tests
    // -----------------------------------------------------------------------

    #[test]
    fn extracts_annotations_ordered_by_sort_index() {
        let (_dir, db_path) = create_test_db();
        let anns = query_zotero_for_pdf(&db_path, "Smith2024_Deep_Learning.pdf").unwrap();

        // Should have 3 annotations (types 1, 2, 1) -- types 3, 4 filtered out
        assert_eq!(anns.len(), 3);

        // Ordered by sortIndex: page 1, page 3, page 5
        assert_eq!(anns[0].page_label.as_deref(), Some("1"));
        assert_eq!(
            anns[0].text.as_deref(),
            Some("highlighted text on page one")
        );
        assert_eq!(anns[0].sort_index, "00001|000020|00000");

        assert_eq!(anns[1].page_label.as_deref(), Some("3"));
        assert_eq!(anns[1].ann_type, 2); // sticky note
        assert_eq!(anns[1].comment.as_deref(), Some("sticky note text"));

        assert_eq!(anns[2].page_label.as_deref(), Some("5"));
        assert_eq!(anns[2].text.as_deref(), Some("highlighted text one"));
        assert_eq!(anns[2].comment.as_deref(), Some("my comment"));
    }

    #[test]
    fn filters_out_image_and_ink_annotations() {
        let (_dir, db_path) = create_test_db();
        let anns = query_zotero_for_pdf(&db_path, "Smith2024_Deep_Learning.pdf").unwrap();

        for ann in &anns {
            assert!(
                ann.ann_type != 3,
                "image annotation (type 3) should be filtered out"
            );
            assert!(
                ann.ann_type != 4,
                "ink annotation (type 4) should be filtered out"
            );
        }
    }

    #[test]
    fn no_annotations_returns_empty_vec() {
        let (_dir, db_path) = create_test_db();
        let anns = query_zotero_for_pdf(&db_path, "nonexistent.pdf").unwrap();
        assert!(anns.is_empty());
    }

    // -----------------------------------------------------------------------
    // resolve_pdf_in_zotero tests
    // -----------------------------------------------------------------------

    #[test]
    fn resolve_pdf_case_insensitive() {
        let (_dir, db_path) = create_test_db();

        // Exact stem
        let result = resolve_pdf_in_zotero(&db_path, "Smith2024_Deep_Learning").unwrap();
        assert_eq!(result, Some((200, 100)));

        // Lowercase stem
        let result = resolve_pdf_in_zotero(&db_path, "smith2024_deep_learning").unwrap();
        assert_eq!(result, Some((200, 100)));

        // Uppercase stem
        let result = resolve_pdf_in_zotero(&db_path, "SMITH2024_DEEP_LEARNING").unwrap();
        assert_eq!(result, Some((200, 100)));

        // Non-existent stem
        let result = resolve_pdf_in_zotero(&db_path, "nonexistent_paper").unwrap();
        assert_eq!(result, None);
    }

    // -----------------------------------------------------------------------
    // query_zotero_child_notes tests
    // -----------------------------------------------------------------------

    #[test]
    fn queries_child_notes() {
        let (_dir, db_path) = create_test_db();
        let notes = query_zotero_child_notes(&db_path, 100).unwrap();

        assert_eq!(notes.len(), 2);

        // First note -- HTML stripped
        assert_eq!(notes[0].item_id, 400);
        assert!(
            !notes[0].html_content.contains('<'),
            "HTML tags should be stripped: {}",
            notes[0].html_content
        );
        assert!(notes[0].html_content.contains("child note"));
        assert_eq!(notes[0].title, None);

        // Second note -- has title
        assert_eq!(notes[1].item_id, 401);
        assert_eq!(notes[1].title.as_deref(), Some("My Note Title"));
        assert!(notes[1].html_content.contains("Second note"));
        assert!(notes[1].html_content.contains("two paragraphs"));
    }

    #[test]
    fn no_child_notes_returns_empty_vec() {
        let (_dir, db_path) = create_test_db();
        let notes = query_zotero_child_notes(&db_path, 999).unwrap();
        assert!(notes.is_empty());
    }

    // -----------------------------------------------------------------------
    // strip_html_tags tests
    // -----------------------------------------------------------------------

    #[test]
    fn strip_html_tags_works() {
        assert_eq!(strip_html_tags("<p>Hello <b>world</b></p>"), "Hello world");
        assert_eq!(strip_html_tags("plain text"), "plain text");
        assert_eq!(strip_html_tags("<br/>line<br>break"), "linebreak");
        assert_eq!(strip_html_tags(""), "");
        assert_eq!(strip_html_tags("<p>  spaced   out  </p>"), "spaced out");
    }

    // -----------------------------------------------------------------------
    // zotero_db_path tests
    // -----------------------------------------------------------------------

    #[test]
    fn zotero_db_path_returns_default_when_unset() {
        let prefs = crate::preferences::Preferences::default();
        let path = zotero_db_path(&prefs);
        let home = std::env::var("HOME").unwrap();
        assert_eq!(path, format!("{}/Zotero/zotero.sqlite", home));
    }

    #[test]
    fn zotero_db_path_reads_custom_value() {
        let json = r#"{"zotero.databasePath": "/custom/path/zotero.sqlite"}"#;
        let prefs: crate::preferences::Preferences = serde_json::from_str(json).unwrap();
        assert_eq!(zotero_db_path(&prefs), "/custom/path/zotero.sqlite");
    }

    #[test]
    fn zotero_db_path_expands_tilde() {
        let json = r#"{"zotero.databasePath": "~/CustomZotero/zotero.sqlite"}"#;
        let prefs: crate::preferences::Preferences = serde_json::from_str(json).unwrap();
        let home = std::env::var("HOME").unwrap();
        assert_eq!(
            zotero_db_path(&prefs),
            format!("{}/CustomZotero/zotero.sqlite", home)
        );
    }

    // -----------------------------------------------------------------------
    // normalize tests
    // -----------------------------------------------------------------------

    #[test]
    fn test_normalize_collapses_whitespace() {
        assert_eq!(normalize("  hello   world  "), "hello world");
    }

    #[test]
    fn test_normalize_lowercases() {
        assert_eq!(normalize("Hello World"), "hello world");
    }

    #[test]
    fn test_normalize_handles_newlines() {
        assert_eq!(normalize("line1\nline2\tline3"), "line1 line2 line3");
    }

    #[test]
    fn test_normalize_empty_string() {
        assert_eq!(normalize(""), "");
    }

    #[test]
    fn test_normalize_whitespace_only() {
        assert_eq!(normalize("   \t\n  "), "");
    }

    // -----------------------------------------------------------------------
    // find_exact_match tests
    // -----------------------------------------------------------------------

    #[test]
    fn test_exact_match_single_line() {
        let lines = vec!["The quick brown fox jumps over the lazy dog"];
        assert_eq!(find_exact_match("brown fox", &lines), Some(0));
    }

    #[test]
    fn test_exact_match_spans_lines() {
        let lines = vec!["end of first", "start of second"];
        assert_eq!(find_exact_match("first start", &lines), Some(1));
    }

    #[test]
    fn test_exact_match_returns_end_line() {
        let lines = vec!["aaa bbb", "ccc ddd", "eee fff"];
        // "bbb ccc ddd eee" spans lines 0-2, ends in line 2
        assert_eq!(find_exact_match("bbb ccc ddd eee", &lines), Some(2));
    }

    #[test]
    fn test_exact_match_not_found() {
        let lines = vec!["hello world"];
        assert_eq!(find_exact_match("goodbye", &lines), None);
    }

    #[test]
    fn test_exact_match_whitespace_normalized() {
        let lines = vec!["word   one    two"];
        assert_eq!(find_exact_match("one  two", &lines), Some(0));
    }

    #[test]
    fn test_exact_match_case_insensitive() {
        let lines = vec!["The Quick Brown Fox"];
        assert_eq!(find_exact_match("quick brown", &lines), Some(0));
    }

    // -----------------------------------------------------------------------
    // build_paragraphs tests
    // -----------------------------------------------------------------------

    #[test]
    fn test_build_paragraphs_basic() {
        let lines = vec!["para one a", "para one b", "", "para two a"];
        let paras = build_paragraphs(&lines);
        assert_eq!(paras.len(), 2);
        assert_eq!(paras[0].0, "para one a para one b");
        assert_eq!(paras[0].1, 1);
        assert_eq!(paras[1].0, "para two a");
        assert_eq!(paras[1].1, 3);
    }

    #[test]
    fn test_build_paragraphs_single() {
        let lines = vec!["line one", "line two", "line three"];
        let paras = build_paragraphs(&lines);
        assert_eq!(paras.len(), 1);
        assert_eq!(paras[0].0, "line one line two line three");
        assert_eq!(paras[0].1, 2);
    }

    #[test]
    fn test_build_paragraphs_empty() {
        let lines: Vec<&str> = vec![];
        let paras = build_paragraphs(&lines);
        assert_eq!(paras.len(), 0);
    }

    #[test]
    fn test_build_paragraphs_all_blank() {
        let lines = vec!["", "  ", "\t"];
        let paras = build_paragraphs(&lines);
        assert_eq!(paras.len(), 0);
    }

    #[test]
    fn test_build_paragraphs_leading_trailing_blanks() {
        let lines = vec!["", "", "content", ""];
        let paras = build_paragraphs(&lines);
        assert_eq!(paras.len(), 1);
        assert_eq!(paras[0].0, "content");
        assert_eq!(paras[0].1, 2);
    }

    // -----------------------------------------------------------------------
    // lcs_length tests
    // -----------------------------------------------------------------------

    #[test]
    fn test_lcs_length_identical() {
        assert_eq!(lcs_length("abcdef", "abcdef"), 6);
    }

    #[test]
    fn test_lcs_length_partial() {
        // Longest common substring of "abcdef" and "xbcdey" is "bcde" (length 4)
        assert_eq!(lcs_length("abcdef", "xbcdey"), 4);
    }

    #[test]
    fn test_lcs_length_no_common() {
        assert_eq!(lcs_length("abc", "xyz"), 0);
    }

    #[test]
    fn test_lcs_length_empty() {
        assert_eq!(lcs_length("", "abc"), 0);
        assert_eq!(lcs_length("abc", ""), 0);
        assert_eq!(lcs_length("", ""), 0);
    }

    #[test]
    fn test_lcs_length_one_is_substring() {
        assert_eq!(lcs_length("the quick brown fox", "quick brown"), 11);
    }

    // -----------------------------------------------------------------------
    // find_fuzzy_match tests
    // -----------------------------------------------------------------------

    #[test]
    fn test_fuzzy_match_above_threshold() {
        let paragraphs = vec![
            ("the quick brown fox jumps over the lazy dog".to_string(), 2),
            ("something completely different".to_string(), 5),
        ];
        let result = find_fuzzy_match("quick brown fox jumps over", &paragraphs, 0.5);
        assert_eq!(result, Some(2));
    }

    #[test]
    fn test_fuzzy_match_below_threshold() {
        let paragraphs = vec![("the quick brown fox".to_string(), 2)];
        let result =
            find_fuzzy_match("completely unrelated text here", &paragraphs, 0.65);
        assert_eq!(result, None);
    }

    #[test]
    fn test_fuzzy_match_best_paragraph() {
        let paragraphs = vec![
            ("introduction to machine learning".to_string(), 3),
            (
                "deep learning neural networks for image recognition".to_string(),
                7,
            ),
            (
                "machine learning algorithms and applications".to_string(),
                12,
            ),
        ];
        let result = find_fuzzy_match("machine learning algorithms", &paragraphs, 0.5);
        assert_eq!(result, Some(12));
    }

    #[test]
    fn test_fuzzy_match_empty_needle() {
        let paragraphs = vec![("some text".to_string(), 0)];
        assert_eq!(find_fuzzy_match("", &paragraphs, 0.65), None);
        assert_eq!(find_fuzzy_match("   ", &paragraphs, 0.65), None);
    }

    #[test]
    fn test_fuzzy_match_empty_paragraphs() {
        let paragraphs: Vec<(String, usize)> = vec![];
        assert_eq!(find_fuzzy_match("some needle", &paragraphs, 0.65), None);
    }

    // -----------------------------------------------------------------------
    // find_match_line tests (integration)
    // -----------------------------------------------------------------------

    #[test]
    fn test_find_match_line_exact_preferred() {
        let lines = vec![
            "The quick brown fox",
            "jumps over the lazy dog",
            "",
            "A completely different paragraph",
        ];
        assert_eq!(
            find_match_line("brown fox jumps over", &lines, 0.65),
            Some(1)
        );
    }

    #[test]
    fn test_find_match_line_fuzzy_fallback() {
        let lines = vec![
            "The quikc brownn fox",
            "jumps over the lazy dog",
            "",
            "Something else entirely",
        ];
        // Typos prevent exact match, but fuzzy should match first paragraph
        let result =
            find_match_line("quick brown fox jumps over the lazy", &lines, 0.4);
        assert_eq!(result, Some(1));
    }

    #[test]
    fn test_find_match_line_empty_needle() {
        let lines = vec!["hello world"];
        assert_eq!(find_match_line("", &lines, 0.65), None);
        assert_eq!(find_match_line("   ", &lines, 0.65), None);
    }

    #[test]
    fn test_find_match_line_no_match() {
        let lines = vec!["alpha beta gamma", "", "delta epsilon zeta"];
        assert_eq!(
            find_match_line(
                "completely unrelated content that shares no substring",
                &lines,
                0.65
            ),
            None
        );
    }

    #[test]
    fn test_find_match_line_single_line_doc() {
        let lines = vec!["the only line in the document"];
        assert_eq!(find_match_line("only line", &lines, 0.65), Some(0));
    }

    // -----------------------------------------------------------------------
    // zotero_match_threshold tests
    // -----------------------------------------------------------------------

    #[test]
    fn test_zotero_match_threshold_default() {
        let prefs = crate::preferences::Preferences::default();
        assert!((zotero_match_threshold(&prefs) - 0.65).abs() < f64::EPSILON);
    }

    #[test]
    fn test_zotero_match_threshold_custom() {
        let json = r#"{"zotero.matchThreshold": 0.8}"#;
        let prefs: crate::preferences::Preferences = serde_json::from_str(json).unwrap();
        assert!((zotero_match_threshold(&prefs) - 0.8).abs() < f64::EPSILON);
    }

    #[test]
    fn test_zotero_match_threshold_ignores_non_numeric() {
        let json = r#"{"zotero.matchThreshold": "not a number"}"#;
        let prefs: crate::preferences::Preferences = serde_json::from_str(json).unwrap();
        assert!((zotero_match_threshold(&prefs) - 0.65).abs() < f64::EPSILON);
    }

    // -----------------------------------------------------------------------
    // ann_type_name tests
    // -----------------------------------------------------------------------

    #[test]
    fn ann_type_name_known_types() {
        assert_eq!(ann_type_name(1), "highlight");
        assert_eq!(ann_type_name(2), "note");
        assert_eq!(ann_type_name(5), "underline");
        assert_eq!(ann_type_name(6), "freetext");
    }

    #[test]
    fn ann_type_name_unknown_type() {
        assert_eq!(ann_type_name(99), "annotation");
    }

    // -----------------------------------------------------------------------
    // truncate_anchor tests
    // -----------------------------------------------------------------------

    #[test]
    fn truncate_anchor_short_text() {
        assert_eq!(truncate_anchor("short text", 60), "short text");
    }

    #[test]
    fn truncate_anchor_exact_60() {
        let text = "a".repeat(60);
        assert_eq!(truncate_anchor(&text, 60), text);
    }

    #[test]
    fn truncate_anchor_long_text_breaks_at_space() {
        let text = "the quick brown fox jumps over the lazy dog and keeps running far away into the distance";
        let result = truncate_anchor(text, 60);
        assert!(result.ends_with('\u{2026}'));
        assert!(!result.contains("distance"));
        // The text before the ellipsis should be <= 60 chars
        let before_ellipsis = &result[..result.len() - '\u{2026}'.len_utf8()];
        assert!(before_ellipsis.len() <= 60);
    }

    #[test]
    fn truncate_anchor_normalizes_whitespace() {
        let text = "  hello   world  ";
        assert_eq!(truncate_anchor(text, 60), "hello world");
    }

    // -----------------------------------------------------------------------
    // escape_anchor tests
    // -----------------------------------------------------------------------

    #[test]
    fn escape_anchor_no_specials() {
        assert_eq!(escape_anchor("hello world"), "hello world");
    }

    #[test]
    fn escape_anchor_quotes() {
        assert_eq!(
            escape_anchor(r#"a "quoted" word"#),
            r#"a \"quoted\" word"#
        );
    }

    #[test]
    fn escape_anchor_backslash() {
        assert_eq!(escape_anchor(r"back\slash"), r"back\\slash");
    }

    // -----------------------------------------------------------------------
    // zotero_ann_to_dsl tests
    // -----------------------------------------------------------------------

    #[test]
    fn dsl_highlight_with_comment() {
        let ann = ZoteroAnnotation {
            item_id: 301,
            ann_type: 1,
            text: Some("highlighted text one".to_string()),
            comment: Some("my comment".to_string()),
            color: Some("#ffd400".to_string()),
            page_label: Some("5".to_string()),
            sort_index: "00005|000100|00000".to_string(),
        };
        let dsl = zotero_ann_to_dsl(&ann);
        assert!(dsl.contains("[zot-301]"));
        assert!(dsl.contains("n:"));
        assert!(dsl.contains(r#"^"highlighted text one""#));
        assert!(dsl.contains("p. 5"));
        assert!(dsl.contains("highlight"));
        assert!(dsl.contains("my comment"));
    }

    #[test]
    fn dsl_highlight_without_comment() {
        let ann = ZoteroAnnotation {
            item_id: 305,
            ann_type: 1,
            text: Some("highlighted text on page one".to_string()),
            comment: None,
            color: Some("#ffd400".to_string()),
            page_label: Some("1".to_string()),
            sort_index: "00001|000020|00000".to_string(),
        };
        let dsl = zotero_ann_to_dsl(&ann);
        assert!(dsl.contains("[zot-305]"));
        assert!(dsl.contains(r#"^"highlighted text on page one""#));
        assert!(dsl.contains("p. 1"));
        assert!(dsl.contains("highlight"));
        // Body should end with just the type name, no colon after it
        assert!(dsl.contains("highlight --->") || dsl.contains("highlight\n"));
    }

    #[test]
    fn dsl_sticky_note_no_text() {
        let ann = ZoteroAnnotation {
            item_id: 302,
            ann_type: 2,
            text: None,
            comment: Some("sticky note text".to_string()),
            color: Some("#ff6666".to_string()),
            page_label: Some("3".to_string()),
            sort_index: "00003|000050|00000".to_string(),
        };
        let dsl = zotero_ann_to_dsl(&ann);
        assert!(dsl.contains("[zot-302]"));
        assert!(dsl.contains("n:"));
        assert!(!dsl.contains(r#"^""#)); // no anchor scope
        assert!(dsl.contains("p. 3"));
        assert!(dsl.contains("note"));
        assert!(dsl.contains("sticky note text"));
    }

    #[test]
    fn dsl_long_text_uses_block_form() {
        let long_text = "This is a very long highlighted text that exceeds the normal threshold for compact annotations and should cause block form to be used instead of compact form";
        let ann = ZoteroAnnotation {
            item_id: 999,
            ann_type: 1,
            text: Some(long_text.to_string()),
            comment: Some("A very detailed comment about this highlight that makes the total length quite substantial".to_string()),
            color: None,
            page_label: Some("42".to_string()),
            sort_index: "00042|000100|00000".to_string(),
        };
        let dsl = zotero_ann_to_dsl(&ann);
        assert!(dsl.contains("<!---[zot-999]"));
        assert!(dsl.contains('\n')); // block form
        assert!(dsl.contains("--->"));
    }

    #[test]
    fn dsl_parseable_by_annotation_scanner() {
        let ann = ZoteroAnnotation {
            item_id: 100,
            ann_type: 1,
            text: Some("test text".to_string()),
            comment: Some("a comment".to_string()),
            color: None,
            page_label: Some("1".to_string()),
            sort_index: "00001|000001|00000".to_string(),
        };
        let dsl = zotero_ann_to_dsl(&ann);
        let scanned = crate::annotation::scanner::scan_annotations(&dsl);
        assert_eq!(
            scanned.len(),
            1,
            "DSL should parse as exactly one annotation: {}",
            dsl
        );
        assert_eq!(scanned[0].id, Some("zot-100".to_string()));
    }

    #[test]
    fn dsl_block_form_parseable_by_scanner() {
        let long_text = "A very long highlighted passage that goes on and on to ensure the compact form exceeds the 120 char limit and triggers block formatting";
        let ann = ZoteroAnnotation {
            item_id: 777,
            ann_type: 1,
            text: Some(long_text.to_string()),
            comment: Some("detailed comment about this passage".to_string()),
            color: None,
            page_label: Some("10".to_string()),
            sort_index: "00010|000050|00000".to_string(),
        };
        let dsl = zotero_ann_to_dsl(&ann);
        assert!(dsl.contains('\n'), "should be block form");
        let scanned = crate::annotation::scanner::scan_annotations(&dsl);
        assert_eq!(
            scanned.len(),
            1,
            "Block-form DSL should parse as exactly one annotation: {}",
            dsl
        );
        assert_eq!(scanned[0].id, Some("zot-777".to_string()));
    }

    // -----------------------------------------------------------------------
    // zotero_note_to_dsl tests
    // -----------------------------------------------------------------------

    #[test]
    fn note_dsl_without_title() {
        let note = ZoteroChildNote {
            item_id: 400,
            html_content: "plain text content".to_string(),
            title: None,
        };
        let dsl = zotero_note_to_dsl(&note);
        assert!(dsl.contains("[zot-note-400]"));
        assert!(dsl.contains("n:"));
        assert!(dsl.contains("plain text content"));
    }

    #[test]
    fn note_dsl_with_title() {
        let note = ZoteroChildNote {
            item_id: 401,
            html_content: "note body".to_string(),
            title: Some("My Title".to_string()),
        };
        let dsl = zotero_note_to_dsl(&note);
        assert!(dsl.contains("[zot-note-401]"));
        assert!(dsl.contains("My Title: note body"));
    }

    #[test]
    fn note_dsl_parseable() {
        let note = ZoteroChildNote {
            item_id: 500,
            html_content: "test content".to_string(),
            title: None,
        };
        let dsl = zotero_note_to_dsl(&note);
        let scanned = crate::annotation::scanner::scan_annotations(&dsl);
        assert_eq!(scanned.len(), 1);
        assert_eq!(scanned[0].id, Some("zot-note-500".to_string()));
    }

    // -----------------------------------------------------------------------
    // existing_zotero_ids tests
    // -----------------------------------------------------------------------

    #[test]
    fn existing_ids_empty_content() {
        let ids = existing_zotero_ids("");
        assert!(ids.is_empty());
    }

    #[test]
    fn existing_ids_no_zotero_annotations() {
        let content = "# Title\n\nSome text\n\n<!---[abc-123] n: | a note --->";
        let ids = existing_zotero_ids(content);
        assert!(ids.is_empty());
    }

    #[test]
    fn existing_ids_finds_annotation_ids() {
        let content = r#"# Title

<!---[zot-301] n: ^"text" | comment --->

Some text

<!---[zot-note-400] n: | note content --->
"#;
        let ids = existing_zotero_ids(content);
        assert_eq!(ids.len(), 2);
        assert!(ids.contains("zot-301"));
        assert!(ids.contains("zot-note-400"));
    }

    #[test]
    fn existing_ids_handles_block_form() {
        let content = "<!---[zot-999]\nn:\n---\nbody\n--->";
        let ids = existing_zotero_ids(content);
        assert!(ids.contains("zot-999"));
    }

    #[test]
    fn existing_ids_ignores_non_zotero() {
        let content = "<!---[abc-123] n: | body --->\n<!---[zot-42] n: | body --->";
        let ids = existing_zotero_ids(content);
        assert_eq!(ids.len(), 1);
        assert!(ids.contains("zot-42"));
    }

    // -----------------------------------------------------------------------
    // detect_frontmatter_end tests
    // -----------------------------------------------------------------------

    #[test]
    fn detect_frontmatter_end_present() {
        let lines = vec![
            "---".to_string(),
            "title: Test".to_string(),
            "---".to_string(),
            "body".to_string(),
        ];
        assert_eq!(detect_frontmatter_end(&lines), Some(2));
    }

    #[test]
    fn detect_frontmatter_end_absent() {
        let lines = vec!["# Title".to_string(), "body".to_string()];
        assert_eq!(detect_frontmatter_end(&lines), None);
    }

    #[test]
    fn detect_frontmatter_end_no_closing() {
        let lines = vec![
            "---".to_string(),
            "title: Test".to_string(),
            "body".to_string(),
        ];
        assert_eq!(detect_frontmatter_end(&lines), None);
    }

    // -----------------------------------------------------------------------
    // insert_annotations_into_markdown tests
    // -----------------------------------------------------------------------

    #[test]
    fn insert_after_target_line() {
        let content = "line 0\nline 1\nline 2\nline 3\n";
        let annotations = vec![(1, "<!---[zot-1] n: | ann --->".to_string())];
        let result = insert_annotations_into_markdown(content, annotations);
        let lines: Vec<&str> = result.lines().collect();
        assert_eq!(lines[0], "line 0");
        assert_eq!(lines[1], "line 1");
        assert_eq!(lines[2], ""); // blank separator
        assert_eq!(lines[3], "<!---[zot-1] n: | ann --->");
        assert_eq!(lines[4], "line 2");
    }

    #[test]
    fn insert_multiple_preserves_order() {
        let content = "line 0\nline 1\nline 2\n";
        let annotations = vec![
            (0, "<!---[zot-1] n: | first --->".to_string()),
            (2, "<!---[zot-2] n: | second --->".to_string()),
        ];
        let result = insert_annotations_into_markdown(content, annotations);
        assert!(result.contains("first"));
        assert!(result.contains("second"));
        let pos1 = result.find("first").unwrap();
        let pos2 = result.find("second").unwrap();
        assert!(pos1 < pos2);
    }

    #[test]
    fn insert_respects_frontmatter() {
        let content = "---\ntitle: Test\n---\nline 3\nline 4\n";
        // Try to insert at line 0 (inside frontmatter) -- should be clamped to after frontmatter
        let annotations = vec![(0, "<!---[zot-1] n: | ann --->".to_string())];
        let result = insert_annotations_into_markdown(content, annotations);
        let lines: Vec<&str> = result.lines().collect();
        // Frontmatter should be intact
        assert_eq!(lines[0], "---");
        assert_eq!(lines[1], "title: Test");
        assert_eq!(lines[2], "---");
        // Annotation should appear after frontmatter (line 2 = closing ---),
        // so the inserted blank + annotation should be at lines 3 and 4
        assert_eq!(lines[3], "");
        assert_eq!(lines[4], "<!---[zot-1] n: | ann --->");
        assert_eq!(lines[5], "line 3");
    }

    #[test]
    fn insert_empty_annotations_returns_unchanged() {
        let content = "# Title\n\nBody text\n";
        let result = insert_annotations_into_markdown(content, vec![]);
        assert_eq!(result, content);
    }

    // -----------------------------------------------------------------------
    // collect_unmatched_section tests
    // -----------------------------------------------------------------------

    #[test]
    fn unmatched_section_format() {
        let anns = vec![ZoteroAnnotation {
            item_id: 10,
            ann_type: 2,
            text: None,
            comment: Some("a note".to_string()),
            color: None,
            page_label: Some("1".to_string()),
            sort_index: "00001|000001|00000".to_string(),
        }];
        let section = collect_unmatched_section(&anns);
        assert!(section.starts_with("## Unmatched Zotero Annotations"));
        assert!(section.contains("[zot-10]"));
        assert!(section.contains("a note"));
    }

    #[test]
    fn unmatched_section_empty() {
        let section = collect_unmatched_section(&[]);
        assert!(section.starts_with("## Unmatched Zotero Annotations"));
    }
}
