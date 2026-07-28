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

    let parent_original = &body[parent_byte_start..parent_byte_end];
    let stamp = ensure_authored_uuid(parent_original, parent_uuid);

    let mut result = String::from(&body[..parent_byte_start]);
    result.push_str(&stamp.original);
    let after_parent = parent_byte_end;

    if trimmed_body.is_empty() {
        if let Some(child) = existing_child {
            let (child_byte_start, child_byte_end) =
                utf16_offsets_to_byte(body, child.char_start, child.char_end);

            // child spans are in original body space; delta only affects
            // the stamped parent prefix already written to `result`
            result.push_str(&body[after_parent..child_byte_start]);

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
        result.push_str(&body[after_parent..child_byte_start]);
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
// Cycle E - sync_slip_note_to_source (pure core + Tauri wrapper)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
pub struct SyncResult {
    pub parent_uuid: String,
    pub body: String,
    pub updated_at: String,
    pub sn_uuid: String,
    pub synced: bool,
}

pub(crate) fn do_sync_slip_note_to_source(
    root: &std::path::Path,
    gi: &crate::graph::indexer::GraphIndex,
    registry: &crate::workspace::write_hash::WriteHashRegistry,
    ann_opts: &crate::annotation::lang::AnnotationIndexOpts,
    parent_uuid: &str,
    body: &str,
) -> Result<SyncResult, String> {
    // Use store only to discover which page the parent lives on
    let page_id = {
        let store = gi.store();
        let ann = store
            .get_annotation_by_uuid(parent_uuid)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| format!("Annotation with uuid '{}' not found", parent_uuid))?;
        ann.source_page_id.clone()
    };

    let page = crate::workspace::ops::read_page(root, &page_id, registry)
        .map_err(|e| e.to_string())?;
    let page_body = &page.body;

    // Resolve parent from fresh parse by authored uuid.
    // Unstamped parents won't have an authored id in the file, so fall back
    // to the store's position-based match as a secondary lookup.
    let anns = parse_annotations_builtin(page_body);

    let parent = anns
        .iter()
        .find(|a| a.uuid.as_deref() == Some(parent_uuid))
        .or_else(|| {
            let store = gi.store();
            let store_ann = store.get_annotation_by_uuid(parent_uuid).ok()??;
            anns.iter().find(|a| {
                a.char_start == store_ann.char_start && a.char_end == store_ann.char_end
            })
        })
        .ok_or_else(|| format!("parent {} missing from page body", parent_uuid))?;

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

    let today = chrono::Utc::now().format("%Y-%m-%d").to_string();
    let child_uuid = existing_child
        .as_ref()
        .map(|c| c.uuid.clone())
        .filter(|u| !u.is_empty())
        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());

    let new_body = apply_slip_note_edit(
        page_body,
        parent.char_start,
        parent.char_end,
        parent_uuid,
        existing_child.as_ref(),
        body,
        &today,
        &child_uuid,
    )?;

    crate::workspace::ops::write_page(root, &page_id, &new_body, &page.meta.frontmatter, registry)
        .map_err(|e| e.to_string())?;

    gi.batch_reindex(
        &crate::graph::indexer::DiffResult {
            new: vec![],
            changed: vec![page_id.clone()],
            deleted: vec![],
        },
        ann_opts,
    )
    .map_err(|e| e.to_string())?;

    Ok(SyncResult {
        parent_uuid: parent_uuid.to_string(),
        body: body.trim().to_string(),
        updated_at: today,
        sn_uuid: child_uuid,
        synced: true,
    })
}

#[tauri::command]
pub fn sync_slip_note_to_source(
    window: tauri::Window,
    workspace_state: State<crate::commands::workspace::WorkspaceRegistry>,
    graph_state: State<Arc<crate::commands::graph::GraphRegistry>>,
    registry: State<Arc<crate::workspace::write_hash::WriteHashRegistry>>,
    app_handle: tauri::AppHandle,
    parent_uuid: String,
    body: String,
) -> Result<SyncResult, String> {
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
    let result = do_sync_slip_note_to_source(&root, &gi, &registry, &ann_opts, &parent_uuid, &body)?;

    let _ = window.emit(
        "workspace://file-modified",
        crate::workspace::watcher::FileEvent {
            path: {
                let store = gi.store();
                store
                    .get_annotation_by_uuid(&parent_uuid)
                    .ok()
                    .flatten()
                    .map(|a| a.source_page_id)
                    .unwrap_or_default()
            },
        },
    );

    Ok(result)
}

// ---------------------------------------------------------------------------
// Cycle F - Reconcile notes cache + migration
// ---------------------------------------------------------------------------

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
        out.insert(parent.clone(), CardNote {
            body,
            updated_at: sn.date.clone(),
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
}

pub(crate) fn do_migrate_cardbox_slip_notes(
    root: &std::path::Path,
    gi: &crate::graph::indexer::GraphIndex,
    registry: &crate::workspace::write_hash::WriteHashRegistry,
    ann_opts: &crate::annotation::lang::AnnotationIndexOpts,
) -> Result<MigrateResult, String> {
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
        return Ok(MigrateResult {
            migrated: 0,
            failed: 0,
            skipped: 0,
        });
    }

    let mut by_page: HashMap<String, Vec<(String, String)>> = HashMap::new();
    {
        let store = gi.store();
        for (parent_uuid, body) in &pending {
            match store.get_annotation_by_uuid(parent_uuid) {
                Ok(Some(ann)) => {
                    by_page
                        .entry(ann.source_page_id.clone())
                        .or_default()
                        .push((parent_uuid.clone(), body.clone()));
                }
                _ => {}
            }
        }
    }

    let mut migrated = 0usize;
    let mut failed = 0usize;
    let pending_count = pending.len();
    let mut drained_keys: Vec<String> = Vec::new();

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

        for (parent_uuid, note_body) in entries {
            let anns = parse_annotations_builtin(&current_body);

            let parent = anns.iter().find(|a| a.uuid.as_deref() == Some(parent_uuid));
            let parent = match parent {
                Some(p) => p,
                None => {
                    tracing::warn!("migrate: parent {} not found in {}", parent_uuid, page_id);
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
                // Revert drain for this page's entries
                for (uuid, _) in entries {
                    drained_keys.retain(|k| k != uuid);
                }
                failed += page_migrated;
                migrated -= page_migrated;
                continue;
            }

            let _ = gi.batch_reindex(
                &crate::graph::indexer::DiffResult {
                    new: vec![],
                    changed: vec![page_id.clone()],
                    deleted: vec![],
                },
                ann_opts,
            );
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

    Ok(MigrateResult {
        migrated,
        failed,
        skipped,
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
    do_migrate_cardbox_slip_notes(&root, &gi, &registry, &ann_opts)
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
        .unwrap();

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
        .unwrap();

        let r2 = do_sync_slip_note_to_source(
            dir.path(), &gi, &reg, &AnnotationIndexOpts::default(), "p1", "Second body",
        )
        .unwrap();

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
        .unwrap();

        assert!(result.synced);

        let file_content = read_md(dir.path(), "a.md");
        assert!(
            file_content.contains(&format!("[{}]", parent_uuid)),
            "parent should be stamped: {}",
            file_content
        );
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
    fn e6_sync_does_not_write_layout_notes() {
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
        .unwrap();

        assert!(result.synced);
        let file_content = read_md(dir.path(), "a.md");
        assert!(file_content.contains("PREPENDED PARAGRAPH"), "preamble preserved: {}", file_content);
        assert!(file_content.contains("A note"), "note written: {}", file_content);
        // Parse should find parent + sn, both well-formed
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
                .unwrap();

        assert_eq!(result.migrated, 1);
        assert_eq!(result.failed, 0);

        let file_content = read_md(dir.path(), "a.md");
        assert!(file_content.contains("sn"), "sn should be written: {}", file_content);
        assert!(file_content.contains("Legacy note"));

        let result2 =
            do_migrate_cardbox_slip_notes(dir.path(), &gi, &reg, &AnnotationIndexOpts::default())
                .unwrap();
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
    fn f_reconcile_keeps_json_only_fallback() {
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
                .unwrap();

        assert_eq!(result.migrated, 1, "good note should migrate");
        assert!(result.skipped > 0 || result.failed > 0, "bad note should fail or be skipped");

        let file_content = read_md(dir.path(), "a.md");
        assert!(file_content.contains("Good note"));
    }
}
