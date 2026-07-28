use std::collections::HashMap;
use std::sync::Arc;

use serde::Serialize;
use tauri::{Emitter, State};

use crate::annotation::emit::{
    emit_annotation, ensure_authored_uuid, utf16_offsets_to_byte, EmitFields,
};
use crate::annotation::parser::parse_annotations_builtin;
use crate::annotation::types::{AnnotationType, Certainty, Scope};
use crate::graph::cardbox_layout::{self, CardNote, CardboxLayout};

// ---------------------------------------------------------------------------
// Cycle C - Pure body mutation
// ---------------------------------------------------------------------------

#[derive(Debug, Clone)]
pub struct ChildSpan {
    pub uuid: String,
    pub char_start: usize,
    pub char_end: usize,
}

fn sanitize_body_for_fence(body: &str) -> String {
    // ZWSP breaks the scanner close delimiter: "--->" becomes "---\u{200B}>"
    // Bare "---" lines are left alone: block split_head_body only splits on
    // the first separator, so subsequent --- lines are safe in the body.
    body.replace("--->", "---\u{200B}>")
}

pub(crate) fn unsanitize_sn_body(body: &str) -> String {
    body.replace("---\u{200B}>", "--->")
}

pub fn apply_slip_note_edit(
    body: &str,
    parent_char_start: usize,
    parent_char_end: usize,
    parent_uuid: &str,
    existing_child: Option<&ChildSpan>,
    new_body: &str,
    today: &str,
    child_uuid: &str,
) -> Result<String, String> {
    let trimmed_body = new_body.trim();

    let (parent_byte_start, parent_byte_end) =
        utf16_offsets_to_byte(body, parent_char_start, parent_char_end);

    if parent_byte_start > parent_byte_end || parent_byte_end > body.len() {
        return Err(format!(
            "invalid parent span: {}..{} in body of len {}",
            parent_byte_start, parent_byte_end, body.len()
        ));
    }

    let parent_original = &body[parent_byte_start..parent_byte_end];
    let stamp = ensure_authored_uuid(parent_original, parent_uuid);

    let mut result = String::from(&body[..parent_byte_start]);
    result.push_str(&stamp.original);
    let after_parent = parent_byte_end;

    if trimmed_body.is_empty() {
        if let Some(child) = existing_child {
            let (child_byte_start, child_byte_end) =
                utf16_offsets_to_byte(body, child.char_start, child.char_end);

            if child_byte_start < after_parent {
                return Err(format!(
                    "child span start {} before parent end {}",
                    child_byte_start, after_parent
                ));
            }

            result.push_str(
                body.get(after_parent..child_byte_start)
                    .ok_or_else(|| format!(
                        "invalid slice {}..{} in body of len {}",
                        after_parent, child_byte_start, body.len()
                    ))?,
            );

            let trailing_newlines = result
                .as_bytes()
                .iter()
                .rev()
                .take_while(|&&b| b == b'\n')
                .count();
            if trailing_newlines >= 2 {
                result.truncate(result.len() - (trailing_newlines - 1));
            }

            let rest = &body[child_byte_end..];
            let rest_trimmed = rest.strip_prefix('\n').unwrap_or(rest);
            result.push_str(rest_trimmed);
        } else {
            result.push_str(&body[after_parent..]);
        }
        return Ok(result);
    }

    let safe_body = sanitize_body_for_fence(trimmed_body);
    let fields = EmitFields {
        id: Some(child_uuid.to_string()),
        annotation_type: AnnotationType::SlipNote,
        certainty: Certainty::Neutral,
        scope: Scope::Anchor(stamp.id.clone()),
        body: safe_body,
        date: Some(today.to_string()),
    };
    let dsl = emit_annotation(&fields);

    if let Some(child) = existing_child {
        let (child_byte_start, child_byte_end) =
            utf16_offsets_to_byte(body, child.char_start, child.char_end);
        if child_byte_start < after_parent {
            return Err(format!(
                "child span start {} before parent end {}",
                child_byte_start, after_parent
            ));
        }
        result.push_str(
            body.get(after_parent..child_byte_start).ok_or_else(|| {
                format!("invalid slice {}..{} in body of len {}", after_parent, child_byte_start, body.len())
            })?,
        );
        result.push_str(&dsl);
        result.push_str(&body[child_byte_end..]);
    } else {
        if !result.ends_with('\n') {
            result.push('\n');
        }
        result.push('\n');
        result.push_str(&dsl);
        result.push('\n');
        let rest = &body[after_parent..];
        let rest = rest.strip_prefix("\n\n").or_else(|| rest.strip_prefix('\n')).unwrap_or(rest);
        if !rest.is_empty() {
            result.push('\n');
            result.push_str(rest);
        }
    }

    Ok(result)
}

// ---------------------------------------------------------------------------
// Shared parent resolution helper (used by sync + migrate)
// ---------------------------------------------------------------------------

pub(crate) fn resolve_parent_in_page<'a>(
    anns: &'a [crate::annotation::types::Annotation],
    parent_uuid: &str,
    store_position: Option<(usize, usize)>,
) -> Result<&'a crate::annotation::types::Annotation, String> {
    if let Some(a) = anns.iter().find(|a| a.uuid.as_deref() == Some(parent_uuid)) {
        return Ok(a);
    }
    if let Some((cs, ce)) = store_position {
        if let Some(a) = anns.iter().find(|a| a.char_start == cs && a.char_end == ce) {
            match &a.uuid {
                None => return Ok(a),
                Some(id) if id == parent_uuid => return Ok(a),
                Some(id) => {
                    return Err(format!(
                        "parent uuid mismatch: store/request '{}' vs file id '{}' at {}..{}",
                        parent_uuid, id, cs, ce
                    ));
                }
            }
        }
    }
    Err(format!("parent {} missing from page body", parent_uuid))
}

// ---------------------------------------------------------------------------
// Cycle E - sync_slip_note_to_source (pure core + Tauri wrapper)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
pub struct SyncResult {
    pub parent_uuid: String,
    pub body: String,
    pub updated_at: String,
    pub sn_uuid: String,
    pub synced: bool,
    pub page_id: String,
}

#[derive(Debug)]
pub(crate) struct SyncOutput {
    pub result: SyncResult,
    pub removed_annotations: Vec<(String, String)>,
}

pub(crate) fn do_sync_slip_note_to_source(
    root: &std::path::Path,
    gi: &crate::graph::indexer::GraphIndex,
    registry: &crate::workspace::write_hash::WriteHashRegistry,
    ann_opts: &crate::annotation::lang::AnnotationIndexOpts,
    parent_uuid: &str,
    body: &str,
) -> Result<SyncOutput, String> {
    let (page_id, store_position) = {
        let store = gi.store();
        let ann = store
            .get_annotation_by_uuid(parent_uuid)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| format!("Annotation with uuid '{}' not found", parent_uuid))?;
        (ann.source_page_id.clone(), Some((ann.char_start, ann.char_end)))
    };

    let page = crate::workspace::ops::read_page(root, &page_id, registry)
        .map_err(|e| e.to_string())?;
    let page_body = &page.body;

    let anns = parse_annotations_builtin(page_body);
    let parent = resolve_parent_in_page(&anns, parent_uuid, store_position)?;

    // v1: earliest char_start wins when multiple sn exist for one parent
    let existing_child = anns
        .iter()
        .filter(|a| {
            a.annotation_type == AnnotationType::SlipNote
                && matches!(&a.scope, Scope::Anchor(v) if v == parent_uuid)
        })
        .min_by_key(|a| a.char_start)
        .map(|a| ChildSpan {
            uuid: a.uuid.clone().unwrap_or_default(),
            char_start: a.char_start,
            char_end: a.char_end,
        });

    let now = chrono::Utc::now();
    let dsl_date = now.format("%Y-%m-%d").to_string();
    let child_uuid = existing_child
        .as_ref()
        .map(|c| c.uuid.clone())
        .filter(|u| !u.is_empty())
        .or_else(|| {
            // Unauthored child: check store for an indexed slip note linked to parent
            let store = gi.store();
            let sn_map = store.list_slip_notes_for_parents().ok()?;
            sn_map.get(parent_uuid).map(|sn| sn.uuid.clone())
        })
        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());

    // Noop: empty body with no existing child
    if body.trim().is_empty() && existing_child.is_none() {
        return Ok(SyncOutput {
            result: SyncResult {
                parent_uuid: parent_uuid.to_string(),
                body: String::new(),
                updated_at: now.to_rfc3339(),
                sn_uuid: child_uuid,
                synced: false,
                page_id,
            },
            removed_annotations: vec![],
        });
    }

    let new_body = apply_slip_note_edit(
        page_body,
        parent.char_start,
        parent.char_end,
        parent_uuid,
        existing_child.as_ref(),
        body,
        &dsl_date,
        &child_uuid,
    )?;

    crate::workspace::ops::write_page(root, &page_id, &new_body, &page.meta.frontmatter, registry)
        .map_err(|e| e.to_string())?;

    // Drain JSON fallback before reindex: md is authoritative once written.
    drain_sync_fallback(root, parent_uuid)?;

    let removed = gi.batch_reindex(
        &crate::graph::indexer::DiffResult {
            new: vec![],
            changed: vec![page_id.clone()],
            deleted: vec![],
        },
        ann_opts,
    )
    .map_err(|e| e.to_string())?;

    Ok(SyncOutput {
        result: SyncResult {
            parent_uuid: parent_uuid.to_string(),
            body: body.trim().to_string(),
            updated_at: now.to_rfc3339(),
            sn_uuid: child_uuid,
            synced: true,
            page_id,
        },
        removed_annotations: removed,
    })
}

/// Requires single-writer per page; callers hold CardboxLock to serialize
/// slip-note + layout writers process-wide.
#[tauri::command]
pub fn sync_slip_note_to_source(
    window: tauri::Window,
    workspace_state: State<crate::commands::workspace::WorkspaceRegistry>,
    graph_state: State<Arc<crate::commands::graph::GraphRegistry>>,
    registry: State<Arc<crate::workspace::write_hash::WriteHashRegistry>>,
    lock: State<super::CardboxLock>,
    app_handle: tauri::AppHandle,
    parent_uuid: String,
    body: String,
) -> Result<SyncResult, String> {
    let _guard = lock.0.lock().unwrap();
    let root = crate::commands::workspace::get_workspace_root(&workspace_state, window.label())?;

    let gi = {
        let indices = graph_state.indices.lock().unwrap();
        Arc::clone(
            indices
                .get(&root)
                .ok_or_else(|| "No graph index for this workspace".to_string())?,
        )
    };

    let ann_opts = crate::preferences::annotation_index_opts(&app_handle);
    let output = do_sync_slip_note_to_source(&root, &gi, &registry, &ann_opts, &parent_uuid, &body)?;

    if output.result.synced {
        crate::commands::graph::emit_reindex_side_effects(
            &app_handle,
            &Ok(output.removed_annotations),
        );

        let _ = window.emit(
            "workspace://file-modified",
            crate::workspace::watcher::FileEvent {
                path: output.result.page_id.clone(),
            },
        );
    }

    Ok(output.result)
}

// ---------------------------------------------------------------------------
// Cycle F - Reconcile notes cache + migration
// ---------------------------------------------------------------------------

/// Remove notes whose parent uuid has a live slip note in the graph index.
/// Called before persisting layout to prevent sn overlay from poisoning disk.
pub(crate) fn strip_sn_backed_notes(
    notes: &mut HashMap<String, CardNote>,
    sn_parents: &std::collections::HashSet<String>,
) {
    notes.retain(|parent, _| !sn_parents.contains(parent));
}

/// Drain a single JSON fallback entry for `parent_uuid` from cardbox.json.
/// Returns `Ok(true)` if an entry was removed, `Ok(false)` if nothing to drain.
pub(crate) fn drain_sync_fallback(root: &std::path::Path, parent_uuid: &str) -> Result<bool, String> {
    let mut layout = cardbox_layout::load_layout(root);
    if layout.notes.remove(parent_uuid).is_some() {
        let lit_dir = root.join(".lit");
        std::fs::create_dir_all(&lit_dir).map_err(|e| e.to_string())?;
        super::persist_layout(&lit_dir, &layout)?;
        Ok(true)
    } else {
        Ok(false)
    }
}

/// Collect the set of parent uuids that have an active slip note in the index.
pub(crate) fn sn_parent_key_set(
    gi: &crate::graph::indexer::GraphIndex,
) -> Result<std::collections::HashSet<String>, String> {
    let store = gi.store();
    let sn_map = store
        .list_slip_notes_for_parents()
        .map_err(|e| e.to_string())?;
    Ok(sn_map.into_keys().collect())
}

/// Reject a JSON note write when the parent has a live slip note.
pub(crate) fn check_sn_guard(
    uuid: &str,
    sn_parents: &std::collections::HashSet<String>,
) -> Result<(), String> {
    if sn_parents.contains(uuid) {
        return Err(format!(
            "card note is source-backed (sn); use sync_slip_note_to_source for '{}'",
            uuid
        ));
    }
    Ok(())
}

/// Build effective notes by overlaying sn-derived bodies on top of fallback.
/// sn_map wins on key conflict; empty sn body means the key is absent.
pub(crate) fn overlay_notes_from_sn(
    fallback: &HashMap<String, CardNote>,
    sn_map: &HashMap<String, crate::graph::types::CardboxAnnotation>,
) -> HashMap<String, CardNote> {
    let mut out = fallback.clone();
    for (parent, sn) in sn_map {
        let body = unsanitize_sn_body(sn.body.as_deref().unwrap_or(""));
        if body.is_empty() {
            out.remove(parent);
            continue;
        }
        let updated_at = sn.date.as_deref().map(|d| {
            if d.contains('T') {
                d.to_string()
            } else {
                format!("{}T00:00:00Z", d)
            }
        });
        out.insert(parent.clone(), CardNote {
            body,
            updated_at,
        });
    }
    out
}

/// Apply sn overlay to layout.notes for display purposes.
/// layout.notes is treated as fallback-only; sn-derived entries are NOT
/// persisted into it. The overlay is computed at read time.
///
/// Returns the effective notes map (fallback + sn overlay). The caller
/// should set `layout.notes = effective` on the returned layout but NOT
/// persist that to disk.
pub(crate) fn reconcile_slip_notes(
    gi: &crate::graph::indexer::GraphIndex,
    layout: &CardboxLayout,
) -> Result<HashMap<String, CardNote>, String> {
    let sn_map = {
        let store = gi.store();
        store
            .list_slip_notes_for_parents()
            .map_err(|e| e.to_string())?
    };

    Ok(overlay_notes_from_sn(&layout.notes, &sn_map))
}

#[derive(Debug, Clone, Serialize)]
pub struct MigrateResult {
    pub migrated: usize,
    pub failed: usize,
    pub skipped: usize,
    pub changed_pages: Vec<String>,
}

#[derive(Debug)]
pub(crate) struct MigrateOutput {
    pub result: MigrateResult,
    pub removed_annotations: Vec<(String, String)>,
}

pub(crate) fn do_migrate_cardbox_slip_notes(
    root: &std::path::Path,
    gi: &crate::graph::indexer::GraphIndex,
    registry: &crate::workspace::write_hash::WriteHashRegistry,
    ann_opts: &crate::annotation::lang::AnnotationIndexOpts,
) -> Result<MigrateOutput, String> {
    let mut layout = cardbox_layout::load_layout(root);

    let sn_map = {
        let store = gi.store();
        store
            .list_slip_notes_for_parents()
            .map_err(|e| e.to_string())?
    };

    let pending: Vec<(String, String)> = layout
        .notes
        .iter()
        .filter(|(uuid, _)| !sn_map.contains_key(*uuid))
        .map(|(uuid, note)| (uuid.clone(), note.body.clone()))
        .collect();

    if pending.is_empty() {
        return Ok(MigrateOutput {
            result: MigrateResult {
                migrated: 0,
                failed: 0,
                skipped: 0,
                changed_pages: vec![],
            },
            removed_annotations: vec![],
        });
    }

    // Group pending entries by page, carrying store position for fallback resolution
    let mut by_page: HashMap<String, Vec<(String, String, Option<(usize, usize)>)>> = HashMap::new();
    {
        let store = gi.store();
        for (parent_uuid, body) in &pending {
            match store.get_annotation_by_uuid(parent_uuid) {
                Ok(Some(ann)) => {
                    by_page
                        .entry(ann.source_page_id.clone())
                        .or_default()
                        .push((parent_uuid.clone(), body.clone(), Some((ann.char_start, ann.char_end))));
                }
                _ => {}
            }
        }
    }

    for entries in by_page.values_mut() {
        entries.sort_by(|a, b| {
            let pos_a = a.2.map(|p| p.0).unwrap_or(0);
            let pos_b = b.2.map(|p| p.0).unwrap_or(0);
            pos_b.cmp(&pos_a)
        });
    }

    let mut migrated = 0usize;
    let mut failed = 0usize;
    let pending_count = pending.len();
    let mut drained_keys: Vec<String> = Vec::new();
    let mut changed_pages: Vec<String> = Vec::new();
    let mut all_removed: Vec<(String, String)> = Vec::new();

    for (page_id, entries) in &by_page {
        let page = match crate::workspace::ops::read_page(root, page_id, registry) {
            Ok(p) => p,
            Err(e) => {
                tracing::warn!("migrate: failed to read {}: {}", page_id, e);
                failed += entries.len();
                continue;
            }
        };

        let mut current_body = page.body.clone();
        let mut page_migrated = 0;

        for (parent_uuid, note_body, store_position) in entries {
            let anns = parse_annotations_builtin(&current_body);

            let parent = match resolve_parent_in_page(&anns, parent_uuid, *store_position) {
                Ok(p) => p,
                Err(e) => {
                    tracing::warn!("migrate: {}", e);
                    failed += 1;
                    continue;
                }
            };

            let existing_child = anns
                .iter()
                .filter(|a| {
                    a.annotation_type == AnnotationType::SlipNote
                        && matches!(&a.scope, Scope::Anchor(v) if v == parent_uuid)
                })
                .min_by_key(|a| a.char_start)
                .map(|a| ChildSpan {
                    uuid: a.uuid.clone().unwrap_or_default(),
                    char_start: a.char_start,
                    char_end: a.char_end,
                });

            if existing_child.is_some() {
                drained_keys.push(parent_uuid.clone());
                page_migrated += 1;
                migrated += 1;
                continue;
            }

            let today = chrono::Utc::now().format("%Y-%m-%d").to_string();
            let child_uuid = uuid::Uuid::new_v4().to_string();

            match apply_slip_note_edit(
                &current_body,
                parent.char_start,
                parent.char_end,
                parent_uuid,
                None,
                note_body,
                &today,
                &child_uuid,
            ) {
                Ok(new_body) => {
                    current_body = new_body;
                    drained_keys.push(parent_uuid.clone());
                    page_migrated += 1;
                    migrated += 1;
                }
                Err(e) => {
                    tracing::warn!(
                        "migrate: failed to apply edit for {} in {}: {}",
                        parent_uuid,
                        page_id,
                        e
                    );
                    failed += 1;
                }
            }
        }

        if page_migrated > 0 {
            if let Err(e) = crate::workspace::ops::write_page(
                root,
                page_id,
                &current_body,
                &page.meta.frontmatter,
                registry,
            ) {
                tracing::warn!("migrate: failed to write {}: {}", page_id, e);
                for (uuid, _, _) in entries {
                    drained_keys.retain(|k| k != uuid);
                }
                failed += page_migrated;
                migrated -= page_migrated;
                continue;
            }

            match gi.batch_reindex(
                &crate::graph::indexer::DiffResult {
                    new: vec![],
                    changed: vec![page_id.clone()],
                    deleted: vec![],
                },
                ann_opts,
            ) {
                Ok(removed) => {
                    all_removed.extend(removed);
                }
                Err(e) => {
                    tracing::warn!(
                        "migrate: reindex failed for {}: {} (file written, index stale)",
                        page_id, e
                    );
                }
            }

            // File was written even if reindex failed
            changed_pages.push(page_id.clone());
        }
    }

    // Drain fallback keys for successfully migrated entries
    for key in &drained_keys {
        layout.notes.remove(key);
    }

    let lit_dir = root.join(".lit");
    std::fs::create_dir_all(&lit_dir).map_err(|e| e.to_string())?;
    super::persist_layout(&lit_dir, &layout)?;

    let skipped = pending_count - migrated - failed;

    Ok(MigrateOutput {
        result: MigrateResult {
            migrated,
            failed,
            skipped,
            changed_pages,
        },
        removed_annotations: all_removed,
    })
}

#[tauri::command]
pub fn migrate_cardbox_slip_notes(
    window: tauri::Window,
    workspace_state: State<crate::commands::workspace::WorkspaceRegistry>,
    graph_state: State<Arc<crate::commands::graph::GraphRegistry>>,
    registry: State<Arc<crate::workspace::write_hash::WriteHashRegistry>>,
    lock: State<super::CardboxLock>,
    app_handle: tauri::AppHandle,
) -> Result<MigrateResult, String> {
    let _guard = lock.0.lock().unwrap();
    let root = crate::commands::workspace::get_workspace_root(&workspace_state, window.label())?;

    let gi = {
        let indices = graph_state.indices.lock().unwrap();
        Arc::clone(
            indices
                .get(&root)
                .ok_or_else(|| "No graph index for this workspace".to_string())?,
        )
    };

    let ann_opts = crate::preferences::annotation_index_opts(&app_handle);
    let output = do_migrate_cardbox_slip_notes(&root, &gi, &registry, &ann_opts)?;

    if !output.result.changed_pages.is_empty() {
        crate::commands::graph::emit_reindex_side_effects(
            &app_handle,
            &Ok(output.removed_annotations),
        );
    }

    for page_id in &output.result.changed_pages {
        let _ = window.emit(
            "workspace://file-modified",
            crate::workspace::watcher::FileEvent {
                path: page_id.clone(),
            },
        );
    }

    Ok(output.result)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::annotation::lang::AnnotationIndexOpts;
    use crate::graph::indexer::GraphIndex;
    use crate::workspace::write_hash::WriteHashRegistry;

    fn create_workspace() -> tempfile::TempDir {
        tempfile::tempdir().unwrap()
    }

    fn write_md(root: &std::path::Path, rel_path: &str, content: &str) {
        let abs = root.join(rel_path);
        if let Some(parent) = abs.parent() {
            std::fs::create_dir_all(parent).unwrap();
        }
        std::fs::write(abs, content).unwrap();
    }

    fn read_md(root: &std::path::Path, rel_path: &str) -> String {
        std::fs::read_to_string(root.join(rel_path)).unwrap()
    }

    fn write_layout(root: &std::path::Path, layout: &CardboxLayout) {
        let lit_dir = root.join(".lit");
        std::fs::create_dir_all(&lit_dir).unwrap();
        let content = serde_json::to_string_pretty(layout).unwrap();
        std::fs::write(lit_dir.join("cardbox.json"), content).unwrap();
    }

    fn find_parent_in_body(
        _body: &str,
        anns: &[crate::annotation::types::Annotation],
        ann_type: &str,
    ) -> (usize, usize, Option<String>) {
        let parent = anns
            .iter()
            .find(|a| {
                let t = format!("{:?}", a.annotation_type).to_lowercase();
                t == ann_type
            })
            .expect("parent annotation not found");
        (
            parent.char_start,
            parent.char_end,
            parent.uuid.clone(),
        )
    }

    fn find_child_span(
        anns: &[crate::annotation::types::Annotation],
        parent_uuid: &str,
    ) -> Option<ChildSpan> {
        anns.iter()
            .find(|a| {
                a.annotation_type == AnnotationType::SlipNote
                    && matches!(&a.scope, Scope::Anchor(v) if v == parent_uuid)
            })
            .map(|a| ChildSpan {
                uuid: a.uuid.clone().unwrap_or_default(),
                char_start: a.char_start,
                char_end: a.char_end,
            })
    }

    // -----------------------------------------------------------------------
    // Cycle C tests
    // -----------------------------------------------------------------------

    #[test]
    fn c1_insert_sn_after_parent_with_uuid() {
        let body =
            "Some passage.\n\n<!---[parent-uuid] n: \\s | The Silk Road flourished --->\n";
        let anns = parse_annotations_builtin(body);
        let (cs, ce, _) = find_parent_in_body(body, &anns, "note");

        let result = apply_slip_note_edit(
            body, cs, ce, "parent-uuid", None, "Compare with Braudel", "2026-07-28", "child-uuid",
        )
        .unwrap();

        assert!(result.contains("sn"));
        assert!(result.contains(r#"^"parent-uuid""#));
        assert!(result.contains("Compare with Braudel"));

        let re_parsed = parse_annotations_builtin(&result);
        assert_eq!(re_parsed.len(), 2);
        let sn = re_parsed
            .iter()
            .find(|a| a.annotation_type == AnnotationType::SlipNote)
            .unwrap();
        assert_eq!(sn.body.as_deref().unwrap().trim(), "Compare with Braudel");
        assert!(sn.char_start > cs);
    }

    #[test]
    fn c2_stamp_parent_and_insert_child() {
        let body = "Passage.\n\n<!--- n: \\s | Unstamped parent --->\n";
        let anns = parse_annotations_builtin(body);
        let (cs, ce, _) = find_parent_in_body(body, &anns, "note");

        let result = apply_slip_note_edit(
            body, cs, ce, "new-parent-uuid", None, "A slip note", "2026-07-28", "child-uuid",
        )
        .unwrap();

        assert!(result.contains("[new-parent-uuid]"));
        assert!(result.contains(r#"^"new-parent-uuid""#));

        let re_parsed = parse_annotations_builtin(&result);
        assert_eq!(re_parsed.len(), 2);
        let parent = re_parsed
            .iter()
            .find(|a| a.annotation_type == AnnotationType::Note)
            .unwrap();
        assert_eq!(parent.uuid.as_deref(), Some("new-parent-uuid"));
    }

    #[test]
    fn c3_update_existing_child() {
        let body = concat!(
            "Passage.\n\n",
            "<!---[parent-uuid] n: \\s | Parent note --->\n\n",
            "<!---[child-uuid] sn: ^\"parent-uuid\" | Old body @2026-07-28 --->\n",
        );
        let anns = parse_annotations_builtin(body);
        let (cs, ce, _) = find_parent_in_body(body, &anns, "note");
        let child = find_child_span(&anns, "parent-uuid").unwrap();

        let result = apply_slip_note_edit(
            body, cs, ce, "parent-uuid", Some(&child), "Updated body text", "2026-07-29",
            &child.uuid,
        )
        .unwrap();

        assert!(result.contains("Updated body text"));
        assert!(!result.contains("Old body"));
        assert!(result.contains("@2026-07-29"));

        let re_parsed = parse_annotations_builtin(&result);
        let sn = re_parsed
            .iter()
            .find(|a| a.annotation_type == AnnotationType::SlipNote)
            .unwrap();
        assert_eq!(sn.body.as_deref().unwrap().trim(), "Updated body text");
    }

    #[test]
    fn c4_delete_child_on_empty_body() {
        let body = concat!(
            "Passage.\n\n",
            "<!---[parent-uuid] n: \\s | Parent note --->\n\n",
            "<!---[child-uuid] sn: ^\"parent-uuid\" | Old body @2026-07-28 --->\n",
        );
        let anns = parse_annotations_builtin(body);
        let (cs, ce, _) = find_parent_in_body(body, &anns, "note");
        let child = find_child_span(&anns, "parent-uuid").unwrap();

        let result =
            apply_slip_note_edit(body, cs, ce, "parent-uuid", Some(&child), "", "2026-07-29", &child.uuid)
                .unwrap();

        assert!(!result.contains("sn:"));
        assert!(result.contains("Parent note"));

        let re_parsed = parse_annotations_builtin(&result);
        assert_eq!(re_parsed.len(), 1);
        assert_eq!(re_parsed[0].annotation_type, AnnotationType::Note);
    }

    #[test]
    fn c5_multiline_body_emits_block_form() {
        let body = "Passage.\n\n<!---[parent-uuid] n: \\s | Parent --->\n";
        let anns = parse_annotations_builtin(body);
        let (cs, ce, _) = find_parent_in_body(body, &anns, "note");

        let result = apply_slip_note_edit(
            body, cs, ce, "parent-uuid", None, "Line one.\n\nLine two.", "2026-07-28",
            "child-uuid",
        )
        .unwrap();

        assert!(result.contains("<!---[child-uuid]\nsn\n"));

        let re_parsed = parse_annotations_builtin(&result);
        let sn = re_parsed
            .iter()
            .find(|a| a.annotation_type == AnnotationType::SlipNote)
            .unwrap();
        assert!(sn.body.as_deref().unwrap().contains("Line one."));
        assert!(sn.body.as_deref().unwrap().contains("Line two."));
    }

    #[test]
    fn c6_cjk_utf16_offsets() {
        let body = "你好世界\n\n<!--- n: \\s | 注释 --->\n";
        let anns = parse_annotations_builtin(body);
        let (cs, ce, _) = find_parent_in_body(body, &anns, "note");

        let result = apply_slip_note_edit(
            body, cs, ce, "p-uuid", None, "笔记内容", "2026-07-28", "c-uuid",
        )
        .unwrap();

        assert!(result.contains("你好世界"));
        assert!(result.contains("注释"));
        assert!(result.contains("笔记内容"));

        let re_parsed = parse_annotations_builtin(&result);
        assert_eq!(re_parsed.len(), 2);
    }

    #[test]
    fn c_body_fence_safety_triple_dash() {
        let body = "Passage.\n\n<!---[parent-uuid] n: \\s | Parent --->\n";
        let anns = parse_annotations_builtin(body);
        let (cs, ce, _) = find_parent_in_body(body, &anns, "note");

        let input_body = "before\n---\nafter";
        let result = apply_slip_note_edit(
            body, cs, ce, "parent-uuid", None, input_body, "2026-07-28", "child-uuid",
        )
        .unwrap();

        let re_parsed = parse_annotations_builtin(&result);
        assert_eq!(re_parsed.len(), 2, "fence chars should not break parsing: {}", result);
        let sn = re_parsed.iter().find(|a| a.annotation_type == AnnotationType::SlipNote).unwrap();
        let sn_body = unsanitize_sn_body(sn.body.as_deref().unwrap());
        assert!(sn_body.contains("---"), "bare --- must round-trip without backslash escaping: {}", sn_body);
        assert!(!sn_body.contains("\\-\\-\\-"), "must not contain lossy backslash escape: {}", sn_body);
    }

    #[test]
    fn c_body_fence_safety_close_fence() {
        let body = "Passage.\n\n<!---[parent-uuid] n: \\s | Parent --->\n";
        let anns = parse_annotations_builtin(body);
        let (cs, ce, _) = find_parent_in_body(body, &anns, "note");

        let input_body = "body with ---> in it";
        let result = apply_slip_note_edit(
            body, cs, ce, "parent-uuid", None, input_body, "2026-07-28", "child-uuid",
        )
        .unwrap();

        let re_parsed = parse_annotations_builtin(&result);
        assert_eq!(re_parsed.len(), 2, "close-fence should not break parsing: {}", result);
        let sn = re_parsed.iter().find(|a| a.annotation_type == AnnotationType::SlipNote).unwrap();
        let sn_body = unsanitize_sn_body(sn.body.as_deref().unwrap().trim());
        assert_eq!(sn_body, input_body, "body must round-trip through sanitize/unsanitize");
        // No stray residue outside annotation spans
        let ann_end = re_parsed.iter().map(|a| a.char_end).max().unwrap();
        let trailing = &result[ann_end..].trim();
        assert!(!trailing.contains("in it"), "no residue outside ann spans: {}", result);
    }

    #[test]
    fn c_body_fence_safety_close_fence_multiline() {
        let body = "Passage.\n\n<!---[parent-uuid] n: \\s | Parent --->\n";
        let anns = parse_annotations_builtin(body);
        let (cs, ce, _) = find_parent_in_body(body, &anns, "note");

        let input_body = "line\n--->\nline";
        let result = apply_slip_note_edit(
            body, cs, ce, "parent-uuid", None, input_body, "2026-07-28", "child-uuid",
        )
        .unwrap();

        let re_parsed = parse_annotations_builtin(&result);
        assert_eq!(re_parsed.len(), 2, "multiline close-fence should not break parsing: {}", result);
        let sn = re_parsed.iter().find(|a| a.annotation_type == AnnotationType::SlipNote).unwrap();
        let sn_body = unsanitize_sn_body(sn.body.as_deref().unwrap().trim());
        assert_eq!(sn_body, input_body, "multiline body with ---> must round-trip");
    }

    #[test]
    fn c_body_midline_close_fence_no_residue() {
        let body = "Passage.\n\n<!---[parent-uuid] n: \\s | Parent --->\n";
        let anns = parse_annotations_builtin(body);
        let (cs, ce, _) = find_parent_in_body(body, &anns, "note");

        let input_body = "mid-line ---> text";
        let result = apply_slip_note_edit(
            body, cs, ce, "parent-uuid", None, input_body, "2026-07-28", "child-uuid",
        )
        .unwrap();

        let re_parsed = parse_annotations_builtin(&result);
        assert_eq!(re_parsed.len(), 2, "only parent + sn: {}", result);
        let sn = re_parsed.iter().find(|a| a.annotation_type == AnnotationType::SlipNote).unwrap();
        let sn_body = unsanitize_sn_body(sn.body.as_deref().unwrap().trim());
        assert_eq!(sn_body, input_body, "compact with mid-line ---> must round-trip");
    }

    #[test]
    fn c_delete_without_existing_child_is_noop() {
        let body = "Passage.\n\n<!---[parent-uuid] n: \\s | Parent --->\n";
        let anns = parse_annotations_builtin(body);
        let (cs, ce, _) = find_parent_in_body(body, &anns, "note");

        let result =
            apply_slip_note_edit(body, cs, ce, "parent-uuid", None, "", "2026-07-28", "child-uuid")
                .unwrap();

        assert_eq!(result, body);
    }

    #[test]
    fn c_delete_child_with_unstamped_parent() {
        let body = concat!(
            "Passage.\n\n",
            "<!--- n: \\s | Parent --->\n\n",
            "<!---[child-uuid] sn: ^\"new-parent-uuid\" | Old body @2026-07-28 --->\n\n",
            "YY trailing\n",
        );
        let anns = parse_annotations_builtin(body);
        let (cs, ce, _) = find_parent_in_body(body, &anns, "note");
        let child = find_child_span(&anns, "new-parent-uuid").unwrap();

        let result = apply_slip_note_edit(
            body, cs, ce, "new-parent-uuid", Some(&child), "", "2026-07-29", &child.uuid,
        )
        .unwrap();

        let re_parsed = parse_annotations_builtin(&result);
        assert_eq!(re_parsed.len(), 1, "should have exactly parent, no sn: {}", result);
        assert_eq!(re_parsed[0].annotation_type, AnnotationType::Note);
        assert!(re_parsed[0].uuid.as_deref() == Some("new-parent-uuid"),
            "parent should be stamped: {}", result);
        assert!(!result.contains("sn"), "sn should be removed: {}", result);
        assert!(!result.contains("<!---[child"), "no child fence fragment: {}", result);
        assert!(result.contains("YY trailing"), "trailing content preserved: {}", result);
    }

    #[test]
    fn c_delete_child_prestamped_still_works() {
        // delta=0 path: parent already stamped, delete should still work
        let body = concat!(
            "Passage.\n\n",
            "<!---[parent-uuid] n: \\s | Parent note --->\n\n",
            "<!---[child-uuid] sn: ^\"parent-uuid\" | Old body @2026-07-28 --->\n",
        );
        let anns = parse_annotations_builtin(body);
        let (cs, ce, _) = find_parent_in_body(body, &anns, "note");
        let child = find_child_span(&anns, "parent-uuid").unwrap();

        let result =
            apply_slip_note_edit(body, cs, ce, "parent-uuid", Some(&child), "", "2026-07-29", &child.uuid)
                .unwrap();

        assert!(!result.contains("sn:"), "sn removed: {}", result);
        assert!(result.contains("Parent note"));
        let re_parsed = parse_annotations_builtin(&result);
        assert_eq!(re_parsed.len(), 1);
    }

    #[test]
    fn c_insert_preserves_trailing_content() {
        let body =
            "Before.\n\n<!---[parent-uuid] n: \\s | Parent --->\n\nAfter paragraph.\n";
        let anns = parse_annotations_builtin(body);
        let (cs, ce, _) = find_parent_in_body(body, &anns, "note");

        let result = apply_slip_note_edit(
            body, cs, ce, "parent-uuid", None, "A note", "2026-07-28", "child-uuid",
        )
        .unwrap();

        assert!(result.contains("After paragraph."));
        let parent_pos = result.find("Parent").unwrap();
        let child_pos = result.find("A note").unwrap();
        let after_pos = result.find("After paragraph.").unwrap();
        assert!(parent_pos < child_pos && child_pos < after_pos);
    }

    // -----------------------------------------------------------------------
    // Cycle E tests - sync integration
    // -----------------------------------------------------------------------

    #[test]
    fn e1_sync_creates_sn_in_source_file() {
        let dir = create_workspace();
        write_md(
            dir.path(),
            "a.md",
            "Some text <!---[p1] n: \\s | Silk Road flourished ---> more.\n",
        );
        let gi =
            GraphIndex::build(dir.path().to_path_buf(), &AnnotationIndexOpts::default()).unwrap();
        let reg = WriteHashRegistry::new();

        let result = do_sync_slip_note_to_source(
            dir.path(), &gi, &reg, &AnnotationIndexOpts::default(), "p1", "Compare with Braudel",
        )
        .unwrap().result;

        assert!(result.synced);
        assert_eq!(result.parent_uuid, "p1");
        assert_eq!(result.body, "Compare with Braudel");
        assert!(!result.sn_uuid.is_empty());

        let file_content = read_md(dir.path(), "a.md");
        assert!(file_content.contains("sn"));
        assert!(file_content.contains(r#"^"p1""#));
        assert!(file_content.contains("Compare with Braudel"));
    }

    #[test]
    fn e2_sync_updates_same_sn_uuid() {
        let dir = create_workspace();
        write_md(
            dir.path(),
            "a.md",
            "Text <!---[p1] n: \\s | Parent ---> end.\n",
        );
        let gi =
            GraphIndex::build(dir.path().to_path_buf(), &AnnotationIndexOpts::default()).unwrap();
        let reg = WriteHashRegistry::new();

        let r1 = do_sync_slip_note_to_source(
            dir.path(), &gi, &reg, &AnnotationIndexOpts::default(), "p1", "First body",
        )
        .unwrap().result;

        let r2 = do_sync_slip_note_to_source(
            dir.path(), &gi, &reg, &AnnotationIndexOpts::default(), "p1", "Second body",
        )
        .unwrap().result;

        assert_eq!(r1.sn_uuid, r2.sn_uuid, "child uuid should be stable");

        let file_content = read_md(dir.path(), "a.md");
        assert!(file_content.contains("Second body"));
        assert!(!file_content.contains("First body"));
    }

    #[test]
    fn e3_sync_empty_body_removes_sn() {
        let dir = create_workspace();
        write_md(
            dir.path(),
            "a.md",
            "Text <!---[p1] n: \\s | Parent ---> end.\n",
        );
        let gi =
            GraphIndex::build(dir.path().to_path_buf(), &AnnotationIndexOpts::default()).unwrap();
        let reg = WriteHashRegistry::new();

        do_sync_slip_note_to_source(
            dir.path(), &gi, &reg, &AnnotationIndexOpts::default(), "p1", "A note",
        )
        .unwrap();

        let mid = read_md(dir.path(), "a.md");
        assert!(mid.contains("sn"));

        do_sync_slip_note_to_source(
            dir.path(), &gi, &reg, &AnnotationIndexOpts::default(), "p1", "",
        )
        .unwrap();

        let final_content = read_md(dir.path(), "a.md");
        assert!(!final_content.contains("sn"), "sn should be removed: {}", final_content);
    }

    #[test]
    fn e4_sync_stamps_parent_without_authored_uuid() {
        let dir = create_workspace();
        write_md(
            dir.path(),
            "a.md",
            "Text <!--- n: \\s | Unstamped ---> end.\n",
        );
        let gi =
            GraphIndex::build(dir.path().to_path_buf(), &AnnotationIndexOpts::default()).unwrap();
        let reg = WriteHashRegistry::new();

        let parent_uuid = {
            let store = gi.store();
            let anns = store.list_all_cardbox_annotations().unwrap();
            assert_eq!(anns.len(), 1);
            anns[0].uuid.clone()
        };

        let result = do_sync_slip_note_to_source(
            dir.path(),
            &gi,
            &reg,
            &AnnotationIndexOpts::default(),
            &parent_uuid,
            "A note on unstamped",
        )
        .unwrap().result;

        assert!(result.synced);

        let file_content = read_md(dir.path(), "a.md");
        assert!(
            file_content.contains(&format!("[{}]", parent_uuid)),
            "parent should be stamped: {}",
            file_content
        );
    }

    #[test]
    fn c_err_on_child_span_before_parent() {
        let body = concat!(
            "<!---[child-uuid] sn: ^\"parent-uuid\" | Note @2026-07-28 --->\n\n",
            "<!---[parent-uuid] n: \\s | Parent --->\n",
        );
        let child = ChildSpan {
            uuid: "child-uuid".to_string(),
            char_start: 0,
            char_end: 5,
        };
        // parent spans after child - inverted
        let result = apply_slip_note_edit(
            body, 10, 20, "parent-uuid", Some(&child), "New body", "2026-07-28", "child-uuid",
        );
        assert!(result.is_err(), "child before parent should return Err");
    }

    #[test]
    fn e_sync_result_updated_at_is_rfc3339() {
        let dir = create_workspace();
        write_md(
            dir.path(),
            "a.md",
            "Text <!---[p1] n: \\s | Parent ---> end.\n",
        );
        let gi =
            GraphIndex::build(dir.path().to_path_buf(), &AnnotationIndexOpts::default()).unwrap();
        let reg = WriteHashRegistry::new();

        let result = do_sync_slip_note_to_source(
            dir.path(), &gi, &reg, &AnnotationIndexOpts::default(), "p1", "A note",
        )
        .unwrap().result;

        // RFC3339 contains 'T' and timezone info
        assert!(result.updated_at.contains('T'),
            "updated_at should be RFC3339: {}", result.updated_at);
        chrono::DateTime::parse_from_rfc3339(&result.updated_at)
            .expect("updated_at must parse as RFC3339");
    }

    #[test]
    fn e5_sync_missing_parent_returns_error() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "No annotations here.\n");
        let gi =
            GraphIndex::build(dir.path().to_path_buf(), &AnnotationIndexOpts::default()).unwrap();
        let reg = WriteHashRegistry::new();

        let result = do_sync_slip_note_to_source(
            dir.path(), &gi, &reg, &AnnotationIndexOpts::default(), "nonexistent-uuid", "body",
        );

        assert!(result.is_err());
        assert!(result.unwrap_err().contains("not found"));
    }

    #[test]
    fn e6_sync_does_not_insert_sn_into_layout_notes() {
        let dir = create_workspace();
        write_md(
            dir.path(),
            "a.md",
            "Text <!---[p1] n: \\s | Parent ---> end.\n",
        );
        let gi =
            GraphIndex::build(dir.path().to_path_buf(), &AnnotationIndexOpts::default()).unwrap();
        let reg = WriteHashRegistry::new();

        let layout = CardboxLayout::default();
        write_layout(dir.path(), &layout);

        do_sync_slip_note_to_source(
            dir.path(), &gi, &reg, &AnnotationIndexOpts::default(), "p1", "A note",
        )
        .unwrap();

        let layout_after = cardbox_layout::load_layout(dir.path());
        assert!(
            layout_after.notes.is_empty(),
            "sync should not write notes to layout"
        );
    }

    #[test]
    fn e_sync_reuses_store_uuid_for_unauthored_child() {
        let dir = create_workspace();
        // File has parent + sn WITHOUT authored [id] on the sn
        write_md(
            dir.path(),
            "a.md",
            concat!(
                "Text <!---[p1] n: \\s | Parent ---> more.\n\n",
                "<!--- sn: ^\"p1\" | Hand-written note @2026-07-28 --->\n",
            ),
        );
        let gi =
            GraphIndex::build(dir.path().to_path_buf(), &AnnotationIndexOpts::default()).unwrap();
        let reg = WriteHashRegistry::new();

        // The indexer assigns a uuid to the unauthored sn
        let store_uuid = {
            let store = gi.store();
            let sn_map = store.list_slip_notes_for_parents().unwrap();
            sn_map.get("p1").unwrap().uuid.clone()
        };
        assert!(!store_uuid.is_empty());

        // Sync should reuse the store uuid, not mint a new one
        let result = do_sync_slip_note_to_source(
            dir.path(), &gi, &reg, &AnnotationIndexOpts::default(), "p1", "Updated body",
        )
        .unwrap().result;

        assert_eq!(result.sn_uuid, store_uuid, "should reuse store uuid for unauthored child");

        // File should now have the authored [uuid]
        let file_content = read_md(dir.path(), "a.md");
        assert!(file_content.contains(&format!("[{}]", store_uuid)),
            "file should have authored uuid: {}", file_content);

        // Second sync should still use the same uuid
        let result2 = do_sync_slip_note_to_source(
            dir.path(), &gi, &reg, &AnnotationIndexOpts::default(), "p1", "Third body",
        )
        .unwrap().result;
        assert_eq!(result2.sn_uuid, store_uuid);
    }

    #[test]
    fn e_sync_uses_file_offsets_when_store_stale() {
        let dir = create_workspace();
        write_md(
            dir.path(),
            "a.md",
            "Text <!---[p1] n: \\s | Parent ---> end.\n",
        );
        let gi =
            GraphIndex::build(dir.path().to_path_buf(), &AnnotationIndexOpts::default()).unwrap();
        let reg = WriteHashRegistry::new();

        // Shift the parent by prepending text WITHOUT reindexing
        write_md(
            dir.path(),
            "a.md",
            "PREPENDED PARAGRAPH\n\nText <!---[p1] n: \\s | Parent ---> end.\n",
        );
        // Store still has old offsets, but file has shifted parent

        let result = do_sync_slip_note_to_source(
            dir.path(), &gi, &reg, &AnnotationIndexOpts::default(), "p1", "A note",
        )
        .unwrap().result;

        assert!(result.synced);
        let file_content = read_md(dir.path(), "a.md");
        assert!(file_content.contains("PREPENDED PARAGRAPH"), "preamble preserved: {}", file_content);
        assert!(file_content.contains("A note"), "note written: {}", file_content);
        let anns = parse_annotations_builtin(&file_content);
        assert_eq!(anns.len(), 2, "parent + sn: {}", file_content);
    }

    #[test]
    fn e_sync_err_when_parent_uuid_missing_from_file() {
        let dir = create_workspace();
        write_md(
            dir.path(),
            "a.md",
            "Text <!---[p1] n: \\s | Parent ---> end.\n",
        );
        let gi =
            GraphIndex::build(dir.path().to_path_buf(), &AnnotationIndexOpts::default()).unwrap();
        let reg = WriteHashRegistry::new();

        // Overwrite file with no annotations (but keep it so read_page works)
        write_md(dir.path(), "a.md", "No annotations here.\n");

        let result = do_sync_slip_note_to_source(
            dir.path(), &gi, &reg, &AnnotationIndexOpts::default(), "p1", "A note",
        );
        assert!(result.is_err(), "should error when parent missing from page body");
        assert!(result.unwrap_err().contains("missing from page body"),
            "error should mention missing parent");
    }

    // -----------------------------------------------------------------------
    // Cycle F tests - reconcile + migrate
    // -----------------------------------------------------------------------

    #[test]
    fn f1_reconcile_populates_notes_from_sn() {
        let dir = create_workspace();
        write_md(
            dir.path(),
            "a.md",
            concat!(
                "Text <!---[p1] n: \\s | Parent ---> more.\n\n",
                "<!---[sn1] sn: ^\"p1\" | Slip note body @2026-07-28 --->\n",
            ),
        );
        let gi =
            GraphIndex::build(dir.path().to_path_buf(), &AnnotationIndexOpts::default()).unwrap();

        let layout = CardboxLayout::default();
        let effective = reconcile_slip_notes(&gi, &layout).unwrap();

        assert!(effective.contains_key("p1"));
        assert_eq!(effective["p1"].body, "Slip note body");
        // layout.notes is NOT mutated (sn overlay is display-only)
        assert!(layout.notes.is_empty());
    }

    #[test]
    fn f2_reconcile_preserves_json_only_notes_as_fallback() {
        let dir = create_workspace();
        write_md(
            dir.path(),
            "a.md",
            "Text <!---[p1] n: \\s | Parent ---> end.\n",
        );
        let gi =
            GraphIndex::build(dir.path().to_path_buf(), &AnnotationIndexOpts::default()).unwrap();

        let mut layout = CardboxLayout::default();
        layout.notes.insert(
            "p1".to_string(),
            CardNote {
                body: "JSON-only note".to_string(),
                updated_at: None,
            },
        );

        let effective = reconcile_slip_notes(&gi, &layout).unwrap();
        assert_eq!(effective["p1"].body, "JSON-only note");
    }

    #[test]
    fn f3_migrate_writes_sn_for_fallback_entries() {
        let dir = create_workspace();
        write_md(
            dir.path(),
            "a.md",
            "Text <!---[p1] n: \\s | Parent ---> end.\n",
        );
        let gi =
            GraphIndex::build(dir.path().to_path_buf(), &AnnotationIndexOpts::default()).unwrap();
        let reg = WriteHashRegistry::new();

        let mut layout = CardboxLayout::default();
        layout.notes.insert(
            "p1".to_string(),
            CardNote {
                body: "Legacy note".to_string(),
                updated_at: None,
            },
        );
        write_layout(dir.path(), &layout);

        let result =
            do_migrate_cardbox_slip_notes(dir.path(), &gi, &reg, &AnnotationIndexOpts::default())
                .unwrap().result;

        assert_eq!(result.migrated, 1);
        assert_eq!(result.failed, 0);

        let file_content = read_md(dir.path(), "a.md");
        assert!(file_content.contains("sn"), "sn should be written: {}", file_content);
        assert!(file_content.contains("Legacy note"));

        let result2 =
            do_migrate_cardbox_slip_notes(dir.path(), &gi, &reg, &AnnotationIndexOpts::default())
                .unwrap().result;
        assert_eq!(result2.migrated, 0, "second migration should be idempotent");
    }

    #[test]
    fn f4_prune_handles_deleted_parent() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "No annotations.\n");
        let gi =
            GraphIndex::build(dir.path().to_path_buf(), &AnnotationIndexOpts::default()).unwrap();

        let mut layout = CardboxLayout::default();
        layout.notes.insert(
            "deleted-uuid".to_string(),
            CardNote {
                body: "orphaned".to_string(),
                updated_at: None,
            },
        );

        let effective = reconcile_slip_notes(&gi, &layout).unwrap();
        assert!(
            effective.contains_key("deleted-uuid"),
            "orphaned note stays until pruned by read_cardbox_layout"
        );
    }

    #[test]
    fn f_reconcile_clears_note_when_sn_removed() {
        let dir = create_workspace();
        // Step 1: with sn present, overlay includes sn body
        write_md(
            dir.path(),
            "a.md",
            concat!(
                "Text <!---[p1] n: \\s | Parent ---> more.\n\n",
                "<!---[sn1] sn: ^\"p1\" | Slip note body @2026-07-28 --->\n",
            ),
        );
        let gi =
            GraphIndex::build(dir.path().to_path_buf(), &AnnotationIndexOpts::default()).unwrap();
        let layout = CardboxLayout::default();
        let effective = reconcile_slip_notes(&gi, &layout).unwrap();
        assert!(effective.contains_key("p1"));

        // Step 2: remove sn from file, reindex, reconcile
        write_md(
            dir.path(),
            "a.md",
            "Text <!---[p1] n: \\s | Parent ---> more.\n",
        );
        gi.batch_reindex(
            &crate::graph::indexer::DiffResult {
                new: vec![],
                changed: vec!["a.md".to_string()],
                deleted: vec![],
            },
            &AnnotationIndexOpts::default(),
        ).unwrap();

        // layout.notes never had p1 (sn overlay is display-only)
        let effective2 = reconcile_slip_notes(&gi, &layout).unwrap();
        assert!(!effective2.contains_key("p1"),
            "sn removed from md -> effective notes must not have p1: {:?}", effective2);
    }

    #[test]
    fn f_migrate_drains_fallback_key_after_sn_write() {
        let dir = create_workspace();
        write_md(
            dir.path(),
            "a.md",
            "Text <!---[p1] n: \\s | Parent ---> end.\n",
        );
        let gi =
            GraphIndex::build(dir.path().to_path_buf(), &AnnotationIndexOpts::default()).unwrap();
        let reg = WriteHashRegistry::new();

        let mut layout = CardboxLayout::default();
        layout.notes.insert(
            "p1".to_string(),
            CardNote {
                body: "Legacy note".to_string(),
                updated_at: None,
            },
        );
        write_layout(dir.path(), &layout);

        do_migrate_cardbox_slip_notes(dir.path(), &gi, &reg, &AnnotationIndexOpts::default())
            .unwrap();

        // After migrate, on-disk cardbox.json notes map should NOT contain p1
        let on_disk = cardbox_layout::load_layout(dir.path());
        assert!(!on_disk.notes.contains_key("p1"),
            "migrate must drain fallback key once sn exists: {:?}", on_disk.notes);
    }

    #[test]
    fn f_external_sn_delete_after_migrate_no_resurrect() {
        let dir = create_workspace();
        write_md(
            dir.path(),
            "a.md",
            "Text <!---[p1] n: \\s | Parent ---> end.\n",
        );
        let gi =
            GraphIndex::build(dir.path().to_path_buf(), &AnnotationIndexOpts::default()).unwrap();
        let reg = WriteHashRegistry::new();

        let mut layout = CardboxLayout::default();
        layout.notes.insert(
            "p1".to_string(),
            CardNote {
                body: "Legacy note".to_string(),
                updated_at: None,
            },
        );
        write_layout(dir.path(), &layout);

        // Migrate: writes sn to file, drains fallback
        do_migrate_cardbox_slip_notes(dir.path(), &gi, &reg, &AnnotationIndexOpts::default())
            .unwrap();

        // Now externally delete the sn from file
        write_md(
            dir.path(),
            "a.md",
            "Text <!---[p1] n: \\s | Parent ---> end.\n",
        );
        gi.batch_reindex(
            &crate::graph::indexer::DiffResult {
                new: vec![],
                changed: vec!["a.md".to_string()],
                deleted: vec![],
            },
            &AnnotationIndexOpts::default(),
        ).unwrap();

        // Reconcile: sn gone, fallback drained -> note should not resurrect
        let layout2 = cardbox_layout::load_layout(dir.path());
        let effective = reconcile_slip_notes(&gi, &layout2).unwrap();
        assert!(!effective.contains_key("p1"),
            "note must not resurrect after sn delete + fallback drain: {:?}", effective);
    }

    #[test]
    fn f5_migrate_failure_does_not_abort_others() {
        let dir = create_workspace();
        write_md(
            dir.path(),
            "a.md",
            "Text <!---[p1] n: \\s | Good parent ---> end.\n",
        );
        let gi =
            GraphIndex::build(dir.path().to_path_buf(), &AnnotationIndexOpts::default()).unwrap();
        let reg = WriteHashRegistry::new();

        let mut layout = CardboxLayout::default();
        layout.notes.insert(
            "p1".to_string(),
            CardNote {
                body: "Good note".to_string(),
                updated_at: None,
            },
        );
        layout.notes.insert(
            "missing-parent".to_string(),
            CardNote {
                body: "Bad note".to_string(),
                updated_at: None,
            },
        );
        write_layout(dir.path(), &layout);

        let result =
            do_migrate_cardbox_slip_notes(dir.path(), &gi, &reg, &AnnotationIndexOpts::default())
                .unwrap().result;

        assert_eq!(result.migrated, 1, "good note should migrate");
        assert!(result.skipped > 0 || result.failed > 0, "bad note should fail or be skipped");

        let file_content = read_md(dir.path(), "a.md");
        assert!(file_content.contains("Good note"));
    }

    // -----------------------------------------------------------------------
    // Cycle 1 tests - strip sn-backed notes on layout write
    // -----------------------------------------------------------------------

    #[test]
    fn strip_sn_backed_notes_removes_only_sn_keys() {
        let mut notes = HashMap::new();
        notes.insert("p1".to_string(), CardNote { body: "sn note".into(), updated_at: None });
        notes.insert("p2".to_string(), CardNote { body: "fallback note".into(), updated_at: None });

        let sn_parents: std::collections::HashSet<String> = ["p1".to_string()].into_iter().collect();
        strip_sn_backed_notes(&mut notes, &sn_parents);

        assert!(!notes.contains_key("p1"), "sn-backed key should be stripped");
        assert!(notes.contains_key("p2"), "fallback-only key should survive");
    }

    #[test]
    fn write_layout_does_not_persist_sn_overlay_keys() {
        let dir = create_workspace();
        write_md(
            dir.path(),
            "a.md",
            concat!(
                "Text <!---[p1] n: \\s | Parent ---> more.\n\n",
                "<!---[sn1] sn: ^\"p1\" | Slip note body @2026-07-28 --->\n",
            ),
        );
        let gi =
            GraphIndex::build(dir.path().to_path_buf(), &AnnotationIndexOpts::default()).unwrap();

        // reconcile produces effective notes with p1 from sn overlay
        let layout = CardboxLayout::default();
        let effective = reconcile_slip_notes(&gi, &layout).unwrap();
        assert!(effective.contains_key("p1"), "precondition: overlay has p1");

        // Simulate what write_cardbox_layout should do: strip sn-backed keys before persist
        let mut to_persist = CardboxLayout {
            notes: effective,
            ..Default::default()
        };
        let sn_parents = sn_parent_key_set(&gi).unwrap();
        strip_sn_backed_notes(&mut to_persist.notes, &sn_parents);
        write_layout(dir.path(), &to_persist);

        // Reload: disk notes should NOT contain p1
        let on_disk = cardbox_layout::load_layout(dir.path());
        assert!(!on_disk.notes.contains_key("p1"),
            "sn overlay key must not persist to disk: {:?}", on_disk.notes);

        // After removing sn from file + reindex, p1 must not resurrect
        write_md(
            dir.path(),
            "a.md",
            "Text <!---[p1] n: \\s | Parent ---> more.\n",
        );
        gi.batch_reindex(
            &crate::graph::indexer::DiffResult {
                new: vec![],
                changed: vec!["a.md".to_string()],
                deleted: vec![],
            },
            &AnnotationIndexOpts::default(),
        ).unwrap();

        let layout2 = cardbox_layout::load_layout(dir.path());
        let effective2 = reconcile_slip_notes(&gi, &layout2).unwrap();
        assert!(!effective2.contains_key("p1"),
            "no resurrection after sn delete + strip: {:?}", effective2);
    }

    // -----------------------------------------------------------------------
    // Cycle 2 tests - set/clear card note guard under live sn
    // -----------------------------------------------------------------------

    #[test]
    fn set_card_note_rejects_when_sn_exists() {
        let dir = create_workspace();
        write_md(
            dir.path(),
            "a.md",
            concat!(
                "Text <!---[p1] n: \\s | Parent ---> more.\n\n",
                "<!---[sn1] sn: ^\"p1\" | Slip note body @2026-07-28 --->\n",
            ),
        );
        let gi =
            GraphIndex::build(dir.path().to_path_buf(), &AnnotationIndexOpts::default()).unwrap();

        let sn_parents = sn_parent_key_set(&gi).unwrap();
        assert!(sn_parents.contains("p1"), "precondition: p1 has sn");

        let result = check_sn_guard("p1", &sn_parents);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("source-backed"));
    }

    #[test]
    fn clear_card_note_rejects_when_sn_exists() {
        let dir = create_workspace();
        write_md(
            dir.path(),
            "a.md",
            concat!(
                "Text <!---[p1] n: \\s | Parent ---> more.\n\n",
                "<!---[sn1] sn: ^\"p1\" | Slip note body @2026-07-28 --->\n",
            ),
        );
        let gi =
            GraphIndex::build(dir.path().to_path_buf(), &AnnotationIndexOpts::default()).unwrap();

        let sn_parents = sn_parent_key_set(&gi).unwrap();
        let result = check_sn_guard("p1", &sn_parents);
        assert!(result.is_err());
    }

    #[test]
    fn set_card_note_allows_json_only_parent() {
        let dir = create_workspace();
        write_md(
            dir.path(),
            "a.md",
            "Text <!---[p1] n: \\s | Parent ---> end.\n",
        );
        let gi =
            GraphIndex::build(dir.path().to_path_buf(), &AnnotationIndexOpts::default()).unwrap();

        let sn_parents = sn_parent_key_set(&gi).unwrap();
        assert!(!sn_parents.contains("p1"), "precondition: p1 has no sn");

        let result = check_sn_guard("p1", &sn_parents);
        assert!(result.is_ok());
    }

    #[test]
    fn strip_preserves_non_sn_keys_through_write() {
        let mut notes = HashMap::new();
        notes.insert("fallback-1".to_string(), CardNote { body: "keep me".into(), updated_at: None });
        notes.insert("fallback-2".to_string(), CardNote { body: "keep me too".into(), updated_at: None });

        let sn_parents: std::collections::HashSet<String> = std::collections::HashSet::new();
        strip_sn_backed_notes(&mut notes, &sn_parents);

        assert_eq!(notes.len(), 2);
        assert!(notes.contains_key("fallback-1"));
        assert!(notes.contains_key("fallback-2"));
    }

    // -----------------------------------------------------------------------
    // Cycle 3 tests - resolve_parent_in_page + migrate unstamped + mismatch
    // -----------------------------------------------------------------------

    #[test]
    fn resolve_parent_unstamped_via_position() {
        let body = "Text <!--- n: \\s | Unstamped parent ---> end.\n";
        let anns = parse_annotations_builtin(body);
        assert!(anns[0].uuid.is_none(), "precondition: parent is unstamped");

        let result = resolve_parent_in_page(
            &anns, "store-uuid", Some((anns[0].char_start, anns[0].char_end)),
        );
        assert!(result.is_ok(), "unstamped parent should resolve via position");
    }

    #[test]
    fn resolve_parent_mismatch_authored_id_errors() {
        let body = "Text <!---[p2] n: \\s | Different parent ---> end.\n";
        let anns = parse_annotations_builtin(body);
        assert_eq!(anns[0].uuid.as_deref(), Some("p2"));

        let result = resolve_parent_in_page(
            &anns, "p1", Some((anns[0].char_start, anns[0].char_end)),
        );
        assert!(result.is_err(), "mismatch should error");
        let err = result.unwrap_err();
        assert!(err.contains("p1"), "error should mention requested id: {}", err);
        assert!(err.contains("p2"), "error should mention file id: {}", err);
    }

    #[test]
    fn e_sync_err_on_authored_id_mismatch_at_span() {
        let dir = create_workspace();
        write_md(
            dir.path(),
            "a.md",
            "Text <!---[p1] n: \\s | Original parent ---> end.\n",
        );
        let gi =
            GraphIndex::build(dir.path().to_path_buf(), &AnnotationIndexOpts::default()).unwrap();
        let reg = WriteHashRegistry::new();

        // Rewrite file with different authored id at same text/span, without reindex
        write_md(
            dir.path(),
            "a.md",
            "Text <!---[p2] n: \\s | Original parent ---> end.\n",
        );

        let result = do_sync_slip_note_to_source(
            dir.path(), &gi, &reg, &AnnotationIndexOpts::default(), "p1", "A note",
        );
        assert!(result.is_err(), "mismatch should error");
        let err = result.unwrap_err();
        assert!(err.contains("mismatch") || err.contains("p2"),
            "error should indicate mismatch: {}", err);

        // File should be unchanged
        let file_content = read_md(dir.path(), "a.md");
        assert!(!file_content.contains("sn"), "no sn written on error: {}", file_content);
    }

    #[test]
    fn f_migrate_unstamped_parent_via_position_fallback() {
        let dir = create_workspace();
        // Unstamped parent in file
        write_md(
            dir.path(),
            "a.md",
            "Text <!--- n: \\s | Unstamped parent ---> end.\n",
        );
        let gi =
            GraphIndex::build(dir.path().to_path_buf(), &AnnotationIndexOpts::default()).unwrap();
        let reg = WriteHashRegistry::new();

        // Get the store uuid (assigned by indexer since file has no authored id)
        let store_uuid = {
            let store = gi.store();
            let anns = store.list_all_cardbox_annotations().unwrap();
            assert_eq!(anns.len(), 1);
            anns[0].uuid.clone()
        };

        // Set up layout with note keyed by store uuid
        let mut layout = CardboxLayout::default();
        layout.notes.insert(
            store_uuid.clone(),
            CardNote {
                body: "Legacy unstamped note".to_string(),
                updated_at: None,
            },
        );
        write_layout(dir.path(), &layout);

        let result =
            do_migrate_cardbox_slip_notes(dir.path(), &gi, &reg, &AnnotationIndexOpts::default())
                .unwrap().result;

        assert_eq!(result.migrated, 1, "unstamped parent should migrate via position fallback");
        assert_eq!(result.failed, 0);

        let file_content = read_md(dir.path(), "a.md");
        assert!(file_content.contains("sn"), "sn should be written: {}", file_content);
        assert!(file_content.contains("Legacy unstamped note"));
        // Parent should now be stamped
        assert!(file_content.contains(&format!("[{}]", store_uuid)),
            "parent should be stamped with store uuid: {}", file_content);
    }

    // -----------------------------------------------------------------------
    // Cycle 5 tests - overlay timestamp normalization
    // -----------------------------------------------------------------------

    #[test]
    fn overlay_notes_normalizes_date_to_rfc3339() {
        use crate::graph::types::CardboxAnnotation;

        let fallback = HashMap::new();
        let mut sn_map = HashMap::new();
        sn_map.insert("p1".to_string(), CardboxAnnotation {
            uuid: "sn1".to_string(),
            annotation_type: "slipnote".to_string(),
            certainty: "neutral".to_string(),
            body: Some("note body".to_string()),
            date: Some("2026-07-28".to_string()),
            source_page_id: "a.md".to_string(),
            source_page_title: "A".to_string(),
            source_line: 1,
            char_start: 0,
            char_end: 10,
            scope_kind: "anchor".to_string(),
            scope_value: "p1".to_string(),
            original: None,
        });

        let effective = overlay_notes_from_sn(&fallback, &sn_map);
        assert_eq!(
            effective["p1"].updated_at.as_deref(),
            Some("2026-07-28T00:00:00Z"),
            "date-only should be normalized to RFC3339"
        );
    }

    #[test]
    fn overlay_notes_preserves_rfc3339_date() {
        use crate::graph::types::CardboxAnnotation;

        let fallback = HashMap::new();
        let mut sn_map = HashMap::new();
        sn_map.insert("p1".to_string(), CardboxAnnotation {
            uuid: "sn1".to_string(),
            annotation_type: "slipnote".to_string(),
            certainty: "neutral".to_string(),
            body: Some("note body".to_string()),
            date: Some("2026-07-28T12:30:00+00:00".to_string()),
            source_page_id: "a.md".to_string(),
            source_page_title: "A".to_string(),
            source_line: 1,
            char_start: 0,
            char_end: 10,
            scope_kind: "anchor".to_string(),
            scope_value: "p1".to_string(),
            original: None,
        });

        let effective = overlay_notes_from_sn(&fallback, &sn_map);
        assert_eq!(
            effective["p1"].updated_at.as_deref(),
            Some("2026-07-28T12:30:00+00:00"),
            "already-RFC3339 should pass through unchanged"
        );
    }

    // -----------------------------------------------------------------------
    // H1 tests - sync drains JSON fallback
    // -----------------------------------------------------------------------

    #[test]
    fn sync_drains_json_fallback_on_create() {
        let dir = create_workspace();
        write_md(
            dir.path(),
            "a.md",
            "Text <!---[p1] n: \\s | Parent ---> end.\n",
        );
        let gi =
            GraphIndex::build(dir.path().to_path_buf(), &AnnotationIndexOpts::default()).unwrap();
        let reg = WriteHashRegistry::new();

        let mut layout = CardboxLayout::default();
        layout.notes.insert(
            "p1".to_string(),
            CardNote { body: "old json note".to_string(), updated_at: None },
        );
        write_layout(dir.path(), &layout);

        let output = do_sync_slip_note_to_source(
            dir.path(), &gi, &reg, &AnnotationIndexOpts::default(), "p1", "new body",
        ).unwrap();
        assert!(output.result.synced);

        let on_disk = cardbox_layout::load_layout(dir.path());
        assert!(!on_disk.notes.contains_key("p1"),
            "sync create must drain JSON fallback: {:?}", on_disk.notes);
    }

    #[test]
    fn sync_drains_json_fallback_on_delete() {
        let dir = create_workspace();
        write_md(
            dir.path(),
            "a.md",
            "Text <!---[p1] n: \\s | Parent ---> end.\n",
        );
        let gi =
            GraphIndex::build(dir.path().to_path_buf(), &AnnotationIndexOpts::default()).unwrap();
        let reg = WriteHashRegistry::new();

        do_sync_slip_note_to_source(
            dir.path(), &gi, &reg, &AnnotationIndexOpts::default(), "p1", "existing body",
        ).unwrap();

        let mut layout = cardbox_layout::load_layout(dir.path());
        layout.notes.insert(
            "p1".to_string(),
            CardNote { body: "stale json".to_string(), updated_at: None },
        );
        write_layout(dir.path(), &layout);

        do_sync_slip_note_to_source(
            dir.path(), &gi, &reg, &AnnotationIndexOpts::default(), "p1", "",
        ).unwrap();

        let on_disk = cardbox_layout::load_layout(dir.path());
        assert!(!on_disk.notes.contains_key("p1"),
            "sync delete must drain JSON fallback: {:?}", on_disk.notes);
    }

    #[test]
    fn sync_noop_preserves_fallback() {
        let dir = create_workspace();
        write_md(
            dir.path(),
            "a.md",
            "Text <!---[p1] n: \\s | Parent ---> end.\n",
        );
        let gi =
            GraphIndex::build(dir.path().to_path_buf(), &AnnotationIndexOpts::default()).unwrap();
        let reg = WriteHashRegistry::new();

        let mut layout = CardboxLayout::default();
        layout.notes.insert(
            "p1".to_string(),
            CardNote { body: "json note".to_string(), updated_at: None },
        );
        write_layout(dir.path(), &layout);

        let output = do_sync_slip_note_to_source(
            dir.path(), &gi, &reg, &AnnotationIndexOpts::default(), "p1", "",
        ).unwrap();
        assert!(!output.result.synced);

        let on_disk = cardbox_layout::load_layout(dir.path());
        assert!(on_disk.notes.contains_key("p1"),
            "noop sync must preserve JSON fallback: {:?}", on_disk.notes);
    }

    #[test]
    fn f_migrate_two_unstamped_same_page_forward_order() {
        let dir = create_workspace();
        write_md(
            dir.path(),
            "a.md",
            "First text <!--- n: _ | Early parent ---> middle <!--- n: _ | Late parent ---> end.\n",
        );
        let gi = GraphIndex::build(dir.path().to_path_buf(), &AnnotationIndexOpts::default()).unwrap();
        let reg = WriteHashRegistry::new();

        let (uuid_early, uuid_late) = {
            let store = gi.store();
            let anns = store.list_all_cardbox_annotations().unwrap();
            assert_eq!(anns.len(), 2, "should have two annotations");
            let early = anns.iter().min_by_key(|a| a.char_start).unwrap();
            let late = anns.iter().max_by_key(|a| a.char_start).unwrap();
            (early.uuid.clone(), late.uuid.clone())
        };

        let mut layout = CardboxLayout::default();
        layout.notes.insert(uuid_early.clone(), CardNote {
            body: "Note on early".to_string(),
            updated_at: None,
        });
        layout.notes.insert(uuid_late.clone(), CardNote {
            body: "Note on late".to_string(),
            updated_at: None,
        });
        write_layout(dir.path(), &layout);

        let result = do_migrate_cardbox_slip_notes(
            dir.path(), &gi, &reg, &AnnotationIndexOpts::default(),
        ).unwrap().result;

        assert_eq!(result.migrated, 2, "both entries should migrate");
        assert_eq!(result.failed, 0, "no failures");

        let file_content = read_md(dir.path(), "a.md");
        assert!(file_content.contains("Note on early"), "early note in file: {}", file_content);
        assert!(file_content.contains("Note on late"), "late note in file: {}", file_content);

        let anns = parse_annotations_builtin(&file_content);
        let sn_count = anns.iter().filter(|a| a.annotation_type == AnnotationType::SlipNote).count();
        assert_eq!(sn_count, 2, "two sn annotations in file: {}", file_content);
    }

    // -----------------------------------------------------------------------
    // drain_sync_fallback unit tests
    // -----------------------------------------------------------------------

    #[test]
    fn drain_sync_fallback_removes_json_entry() {
        let dir = create_workspace();
        let mut layout = CardboxLayout::default();
        layout.notes.insert(
            "p1".to_string(),
            CardNote { body: "stale json".to_string(), updated_at: None },
        );
        write_layout(dir.path(), &layout);

        let drained = drain_sync_fallback(dir.path(), "p1").unwrap();
        assert!(drained, "drain must return true when entry existed");

        let on_disk = cardbox_layout::load_layout(dir.path());
        assert!(!on_disk.notes.contains_key("p1"),
            "drained entry must not remain on disk: {:?}", on_disk.notes);
    }

    #[test]
    fn drain_sync_fallback_noop_when_absent() {
        let dir = create_workspace();
        write_layout(dir.path(), &CardboxLayout::default());

        let drained = drain_sync_fallback(dir.path(), "p1").unwrap();
        assert!(!drained, "drain must return false when nothing to drain");
    }
}
