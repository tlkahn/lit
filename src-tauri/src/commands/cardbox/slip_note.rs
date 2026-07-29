use std::collections::HashMap;
use std::sync::Arc;

use serde::Serialize;
use tauri::{Emitter, State};

use crate::annotation::emit::{
    emit_annotation, ensure_authored_uuid, utf16_offsets_to_byte, EmitFields,
};
use crate::annotation::parser::parse_annotations_builtin;
use crate::annotation::types::{AnnotationType, Certainty, Scope};
use crate::graph::cardbox_layout::{self, CardNote};

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
// Reindex outcome interpreter (shared by sync + migrate)
// ---------------------------------------------------------------------------

#[derive(Debug)]
pub(crate) struct ReindexOutcome {
    pub removed: Vec<(String, String)>,
    pub retry: bool,
}

pub(crate) fn interpret_reindex_outcome<E: std::fmt::Display>(
    result: Result<Vec<(String, String)>, E>,
    page_id: &str,
) -> ReindexOutcome {
    match result {
        Ok(r) => ReindexOutcome { removed: r, retry: false },
        Err(e) => {
            tracing::warn!(
                "reindex failed for {}: {} (index stale; retry requested)",
                page_id, e
            );
            ReindexOutcome { removed: vec![], retry: true }
        }
    }
}

// ---------------------------------------------------------------------------
// Emit plan (shared by sync + migrate wrappers)
// ---------------------------------------------------------------------------

#[derive(Debug, PartialEq)]
pub(crate) struct SlipEmitPlan {
    pub file_modified: bool,
    pub graph_side_effects: bool,
}

pub(crate) fn sync_emit_plan(
    file_changed: bool,
    index_touched: bool,
    reindex_retry: bool,
) -> SlipEmitPlan {
    SlipEmitPlan {
        file_modified: file_changed,
        graph_side_effects: index_touched && !reindex_retry,
    }
}

/// Emit immediate graph side effects iff at least one changed page
/// reindexed successfully (not present in retry_pages).
pub(crate) fn migrate_graph_emit(changed_pages: &[String], retry_pages: &[String]) -> bool {
    changed_pages.iter().any(|p| !retry_pages.iter().any(|r| r == p))
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
    pub reindex_retry: bool,
    /// True when page bytes were written (Wrote). False for TrueNoop / DriftHeal.
    pub file_changed: bool,
}

enum WritePhase {
    TrueNoop {
        child_uuid: String,
        page_id: String,
    },
    DriftHeal {
        child_uuid: String,
        page_id: String,
    },
    Wrote {
        child_uuid: String,
        page_id: String,
    },
}

pub(crate) fn do_sync_slip_note_to_source(
    root: &std::path::Path,
    gi: &crate::graph::indexer::GraphIndex,
    registry: &crate::workspace::write_hash::WriteHashRegistry,
    ann_opts: &crate::annotation::lang::AnnotationIndexOpts,
    file_lock: &crate::workspace::file_lock::FilePathLock,
    parent_uuid: &str,
    body: &str,
) -> Result<SyncOutput, String> {
    let now = chrono::Utc::now();

    let (page_id, store_position) = {
        let store = gi.store();
        let ann = store
            .get_annotation_by_uuid(parent_uuid)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| format!("Annotation with uuid '{}' not found", parent_uuid))?;
        (ann.source_page_id.clone(), Some((ann.char_start, ann.char_end)))
    };

    let phase = file_lock.with_lock(&root.join(&page_id), || -> Result<WritePhase, String> {
        let page = crate::workspace::ops::read_page(root, &page_id, registry)
            .map_err(|e| e.to_string())?;
        let page_body = &page.body;

        let anns = parse_annotations_builtin(page_body);
        let parent = resolve_parent_in_page(&anns, parent_uuid, store_position)?;

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

        let child_uuid = existing_child
            .as_ref()
            .map(|c| c.uuid.clone())
            .filter(|u| !u.is_empty())
            .or_else(|| {
                let store = gi.store();
                let sn_map = store.list_slip_notes_for_parents().ok()?;
                sn_map.get(parent_uuid).map(|sn| sn.uuid.clone())
            })
            .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());

        // Noop / drift heal: empty body with no existing child in file
        if body.trim().is_empty() && existing_child.is_none() {
            let index_has_sn = {
                let store = gi.store();
                store.list_slip_notes_for_parents()
                    .map(|m| m.contains_key(parent_uuid))
                    .unwrap_or(false)
            };
            if !index_has_sn {
                return Ok(WritePhase::TrueNoop { child_uuid, page_id: page_id.clone() });
            }
            return Ok(WritePhase::DriftHeal { child_uuid, page_id: page_id.clone() });
        }

        let dsl_date = now.format("%Y-%m-%d").to_string();
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

        Ok(WritePhase::Wrote { child_uuid, page_id: page_id.clone() })
    })?;

    match phase {
        WritePhase::TrueNoop { child_uuid, page_id } => Ok(SyncOutput {
            result: SyncResult {
                parent_uuid: parent_uuid.to_string(),
                body: String::new(),
                updated_at: now.to_rfc3339(),
                sn_uuid: child_uuid,
                synced: false,
                page_id,
            },
            removed_annotations: vec![],
            reindex_retry: false,
            file_changed: false,
        }),
        WritePhase::DriftHeal { child_uuid, page_id } => {
            // delete-equivalent: md already has no sn
            let outcome = interpret_reindex_outcome(
                gi.batch_reindex(
                    &crate::graph::indexer::DiffResult {
                        new: vec![],
                        changed: vec![page_id.clone()],
                        deleted: vec![],
                    },
                    ann_opts,
                ),
                &page_id,
            );
            Ok(SyncOutput {
                result: SyncResult {
                    parent_uuid: parent_uuid.to_string(),
                    body: String::new(),
                    updated_at: now.to_rfc3339(),
                    sn_uuid: child_uuid,
                    synced: true,
                    page_id,
                },
                removed_annotations: outcome.removed,
                reindex_retry: outcome.retry,
                file_changed: false,
            })
        }
        WritePhase::Wrote { child_uuid, page_id } => {
            let outcome = interpret_reindex_outcome(
                gi.batch_reindex(
                    &crate::graph::indexer::DiffResult {
                        new: vec![],
                        changed: vec![page_id.clone()],
                        deleted: vec![],
                    },
                    ann_opts,
                ),
                &page_id,
            );

            Ok(SyncOutput {
                result: SyncResult {
                    parent_uuid: parent_uuid.to_string(),
                    body: body.trim().to_string(),
                    updated_at: now.to_rfc3339(),
                    sn_uuid: child_uuid,
                    synced: true,
                    page_id,
                },
                removed_annotations: outcome.removed,
                reindex_retry: outcome.retry,
                file_changed: true,
            })
        }
    }
}

pub(crate) fn schedule_slip_reindex_retry(
    queue: &Arc<crate::commands::reindex_queue::ReindexQueue>,
    root: std::path::PathBuf,
    page_id: String,
    gi: Arc<crate::graph::indexer::GraphIndex>,
    opts_fn: impl Fn() -> crate::annotation::lang::AnnotationIndexOpts + Send + 'static,
    on_done: impl Fn(&Result<Vec<(String, String)>, crate::graph::error::GraphError>) + Send + 'static,
) {
    queue.schedule(
        root,
        crate::commands::reindex_queue::ChangeKind::Changed,
        page_id,
        crate::commands::reindex_queue::fresh_opts_run(
            opts_fn,
            move |diff, ann| gi.batch_reindex(diff, ann),
        ),
        on_done,
    );
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
    file_lock: State<Arc<crate::workspace::file_lock::FilePathLock>>,
    queue: State<Arc<crate::commands::reindex_queue::ReindexQueue>>,
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
    let output = do_sync_slip_note_to_source(&root, &gi, &registry, &ann_opts, &file_lock, &parent_uuid, &body)?;

    let plan = sync_emit_plan(
        output.file_changed,
        output.result.synced,
        output.reindex_retry,
    );

    if plan.file_modified {
        let _ = window.emit(
            "workspace://file-modified",
            crate::workspace::watcher::FileEvent {
                path: output.result.page_id.clone(),
            },
        );
    }

    if plan.graph_side_effects {
        crate::commands::graph::emit_reindex_side_effects(
            &app_handle,
            &Ok(output.removed_annotations),
        );
    } else if output.reindex_retry {
        let handle = app_handle.clone();
        schedule_slip_reindex_retry(
            queue.inner(),
            root,
            output.result.page_id.clone(),
            gi,
            move || crate::preferences::annotation_index_opts(&handle),
            move |result| crate::commands::graph::emit_reindex_side_effects(&app_handle, result),
        );
    }

    Ok(output.result)
}

// ---------------------------------------------------------------------------
// Cycle F - Reconcile notes cache + migration
// ---------------------------------------------------------------------------

/// Derive the display notes map purely from the sn annotation map.
/// Single source of truth: `layout.notes` on disk plays no part here.
/// Empty sn body means the key is absent. `updated_at` comes from the sn
/// `@date` (day precision, normalized to RFC3339 midnight UTC).
pub(crate) fn notes_from_sn(
    sn_map: &HashMap<String, crate::graph::types::CardboxAnnotation>,
) -> HashMap<String, CardNote> {
    let mut out = HashMap::new();
    for (parent, sn) in sn_map {
        let body = unsanitize_sn_body(sn.body.as_deref().unwrap_or(""));
        if body.is_empty() {
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

/// Fetch the sn map from the graph index and derive the display notes map.
pub(crate) fn derive_notes(
    gi: &crate::graph::indexer::GraphIndex,
) -> Result<HashMap<String, CardNote>, String> {
    let sn_map = {
        let store = gi.store();
        store
            .list_slip_notes_for_parents()
            .map_err(|e| e.to_string())?
    };
    Ok(notes_from_sn(&sn_map))
}

#[derive(Debug, Clone, Serialize)]
pub struct MigrateFailure {
    pub uuid: String,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct MigrateResult {
    pub migrated: usize,
    pub failed: usize,
    pub skipped: usize,
    pub changed_pages: Vec<String>,
    /// Per-entry detail for `failed`; entries stay in cardbox.json for retry.
    pub failures: Vec<MigrateFailure>,
}

#[derive(Debug)]
pub(crate) struct MigrateOutput {
    pub result: MigrateResult,
    pub removed_annotations: Vec<(String, String)>,
    pub reindex_retry_pages: Vec<String>,
}

pub(crate) fn do_migrate_cardbox_slip_notes(
    root: &std::path::Path,
    gi: &crate::graph::indexer::GraphIndex,
    registry: &crate::workspace::write_hash::WriteHashRegistry,
    ann_opts: &crate::annotation::lang::AnnotationIndexOpts,
    file_lock: &crate::workspace::file_lock::FilePathLock,
) -> Result<MigrateOutput, String> {
    let mut layout = cardbox_layout::load_layout(root);

    let sn_map = {
        let store = gi.store();
        store
            .list_slip_notes_for_parents()
            .map_err(|e| e.to_string())?
    };

    let pre_drained: usize = sn_map.keys()
        .filter(|k| layout.notes.remove(*k).is_some())
        .count();

    let pending: Vec<(String, String)> = layout
        .notes
        .iter()
        .filter(|(uuid, _)| !sn_map.contains_key(*uuid))
        .map(|(uuid, note)| (uuid.clone(), note.body.clone()))
        .collect();

    if pending.is_empty() {
        if pre_drained > 0 {
            let lit_dir = root.join(".lit");
            std::fs::create_dir_all(&lit_dir).map_err(|e| e.to_string())?;
            super::persist_layout(&lit_dir, &layout)?;
        }
        return Ok(MigrateOutput {
            result: MigrateResult {
                migrated: pre_drained,
                failed: 0,
                skipped: 0,
                changed_pages: vec![],
                failures: vec![],
            },
            removed_annotations: vec![],
            reindex_retry_pages: vec![],
        });
    }

    // Group pending entries by page, carrying store position for fallback
    // resolution. Entries whose parent uuid is absent from the index entirely
    // are dead: prune them from cardbox.json and count them skipped.
    let mut by_page: HashMap<String, Vec<(String, String, Option<(usize, usize)>)>> = HashMap::new();
    let mut dead_parent_keys: Vec<String> = Vec::new();
    let mut failures: Vec<MigrateFailure> = Vec::new();
    let mut failed = 0usize;
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
                Ok(None) => {
                    dead_parent_keys.push(parent_uuid.clone());
                }
                Err(e) => {
                    tracing::warn!("migrate: index lookup failed for {}: {}", parent_uuid, e);
                    failed += 1;
                    failures.push(MigrateFailure {
                        uuid: parent_uuid.clone(),
                        reason: format!("index lookup failed: {}", e),
                    });
                }
            }
        }
    }

    let skipped = dead_parent_keys.len();
    for key in &dead_parent_keys {
        layout.notes.remove(key);
    }

    for entries in by_page.values_mut() {
        entries.sort_by(|a, b| {
            let pos_a = a.2.map(|p| p.0).unwrap_or(0);
            let pos_b = b.2.map(|p| p.0).unwrap_or(0);
            pos_b.cmp(&pos_a)
        });
    }

    let mut migrated = 0usize;
    let mut drained_keys: Vec<String> = Vec::new();
    let mut changed_pages: Vec<String> = Vec::new();
    let mut all_removed: Vec<(String, String)> = Vec::new();
    let mut reindex_retry_pages: Vec<String> = Vec::new();

    for (page_id, entries) in &by_page {
        let write_result = file_lock.with_lock(&root.join(page_id), || -> Result<(String, usize, Vec<String>), (usize, String)> {
            let page = match crate::workspace::ops::read_page(root, page_id, registry) {
                Ok(p) => p,
                Err(e) => {
                    for (uuid, _, _) in entries.iter() {
                        failures.push(MigrateFailure {
                            uuid: uuid.clone(),
                            reason: format!("read failed for {}: {}", page_id, e),
                        });
                    }
                    return Err((entries.len(), e.to_string()));
                }
            };

            let mut current_body = page.body.clone();
            let mut page_migrated = 0usize;
            let mut page_drained: Vec<String> = Vec::new();

            for (parent_uuid, note_body, store_position) in entries {
                let anns = parse_annotations_builtin(&current_body);

                let parent = match resolve_parent_in_page(&anns, parent_uuid, *store_position) {
                    Ok(p) => p,
                    Err(e) => {
                        tracing::warn!("migrate: {}", e);
                        failed += 1;
                        failures.push(MigrateFailure {
                            uuid: parent_uuid.clone(),
                            reason: e,
                        });
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
                    page_drained.push(parent_uuid.clone());
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
                        page_drained.push(parent_uuid.clone());
                        page_migrated += 1;
                        migrated += 1;
                    }
                    Err(e) => {
                        tracing::warn!(
                            "migrate: failed to apply edit for {} in {}: {}",
                            parent_uuid, page_id, e
                        );
                        failed += 1;
                        failures.push(MigrateFailure {
                            uuid: parent_uuid.clone(),
                            reason: format!("apply edit failed: {}", e),
                        });
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
                    for uuid in &page_drained {
                        failures.push(MigrateFailure {
                            uuid: uuid.clone(),
                            reason: format!("write failed for {}: {}", page_id, e),
                        });
                    }
                    failed += page_migrated;
                    migrated -= page_migrated;
                    return Err((0, e.to_string()));
                }
            }

            Ok((page_id.clone(), page_migrated, page_drained))
        });

        match write_result {
            Ok((pid, page_migrated, page_drained)) => {
                drained_keys.extend(page_drained);
                if page_migrated > 0 {
                    // Reindex outside lock
                    let outcome = interpret_reindex_outcome(
                        gi.batch_reindex(
                            &crate::graph::indexer::DiffResult {
                                new: vec![],
                                changed: vec![pid.clone()],
                                deleted: vec![],
                            },
                            ann_opts,
                        ),
                        &pid,
                    );
                    all_removed.extend(outcome.removed);
                    if outcome.retry {
                        reindex_retry_pages.push(pid.clone());
                    }
                    changed_pages.push(pid);
                }
            }
            Err((extra_fail, _)) => {
                failed += extra_fail;
            }
        }
    }

    // Drain fallback keys for successfully migrated entries
    for key in &drained_keys {
        layout.notes.remove(key);
    }

    let lit_dir = root.join(".lit");
    std::fs::create_dir_all(&lit_dir).map_err(|e| e.to_string())?;
    super::persist_layout(&lit_dir, &layout)?;

    // Invariant relied on by the migrate-failure notice (#948): every failed
    // count has a matching per-entry failure detail.
    debug_assert_eq!(failed, failures.len(),
        "failed count must equal failures detail: {:?}", failures);

    Ok(MigrateOutput {
        result: MigrateResult {
            migrated: migrated + pre_drained,
            failed,
            skipped,
            changed_pages,
            failures,
        },
        removed_annotations: all_removed,
        reindex_retry_pages,
    })
}

#[tauri::command]
pub fn migrate_cardbox_slip_notes(
    window: tauri::Window,
    workspace_state: State<crate::commands::workspace::WorkspaceRegistry>,
    graph_state: State<Arc<crate::commands::graph::GraphRegistry>>,
    registry: State<Arc<crate::workspace::write_hash::WriteHashRegistry>>,
    lock: State<super::CardboxLock>,
    file_lock: State<Arc<crate::workspace::file_lock::FilePathLock>>,
    queue: State<Arc<crate::commands::reindex_queue::ReindexQueue>>,
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
    let output = do_migrate_cardbox_slip_notes(&root, &gi, &registry, &ann_opts, &file_lock)?;

    for page_id in &output.result.changed_pages {
        let _ = window.emit(
            "workspace://file-modified",
            crate::workspace::watcher::FileEvent {
                path: page_id.clone(),
            },
        );
    }

    if migrate_graph_emit(&output.result.changed_pages, &output.reindex_retry_pages) {
        crate::commands::graph::emit_reindex_side_effects(
            &app_handle,
            &Ok(output.removed_annotations),
        );
    }

    for page_id in &output.reindex_retry_pages {
        let handle = app_handle.clone();
        schedule_slip_reindex_retry(
            queue.inner(),
            root.clone(),
            page_id.clone(),
            Arc::clone(&gi),
            move || crate::preferences::annotation_index_opts(&handle),
            {
                let handle = app_handle.clone();
                move |result| crate::commands::graph::emit_reindex_side_effects(&handle, result)
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
    use crate::graph::cardbox_layout::CardboxLayout;
    use crate::graph::indexer::GraphIndex;
    use crate::workspace::file_lock::FilePathLock;
    use crate::workspace::write_hash::WriteHashRegistry;

    fn create_workspace() -> tempfile::TempDir {
        tempfile::tempdir().unwrap()
    }

    fn make_file_lock() -> FilePathLock {
        FilePathLock::new()
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
            dir.path(), &gi, &reg, &AnnotationIndexOpts::default(), &make_file_lock(), "p1", "Compare with Braudel",
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
            dir.path(), &gi, &reg, &AnnotationIndexOpts::default(), &make_file_lock(), "p1", "First body",
        )
        .unwrap().result;

        let r2 = do_sync_slip_note_to_source(
            dir.path(), &gi, &reg, &AnnotationIndexOpts::default(), &make_file_lock(), "p1", "Second body",
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
            dir.path(), &gi, &reg, &AnnotationIndexOpts::default(), &make_file_lock(), "p1", "A note",
        )
        .unwrap();

        let mid = read_md(dir.path(), "a.md");
        assert!(mid.contains("sn"));

        do_sync_slip_note_to_source(
            dir.path(), &gi, &reg, &AnnotationIndexOpts::default(), &make_file_lock(), "p1", "",
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
            &make_file_lock(),
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
            dir.path(), &gi, &reg, &AnnotationIndexOpts::default(), &make_file_lock(), "p1", "A note",
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
            dir.path(), &gi, &reg, &AnnotationIndexOpts::default(), &make_file_lock(), "nonexistent-uuid", "body",
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
            dir.path(), &gi, &reg, &AnnotationIndexOpts::default(), &make_file_lock(), "p1", "A note",
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
            dir.path(), &gi, &reg, &AnnotationIndexOpts::default(), &make_file_lock(), "p1", "Updated body",
        )
        .unwrap().result;

        assert_eq!(result.sn_uuid, store_uuid, "should reuse store uuid for unauthored child");

        // File should now have the authored [uuid]
        let file_content = read_md(dir.path(), "a.md");
        assert!(file_content.contains(&format!("[{}]", store_uuid)),
            "file should have authored uuid: {}", file_content);

        // Second sync should still use the same uuid
        let result2 = do_sync_slip_note_to_source(
            dir.path(), &gi, &reg, &AnnotationIndexOpts::default(), &make_file_lock(), "p1", "Third body",
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
            dir.path(), &gi, &reg, &AnnotationIndexOpts::default(), &make_file_lock(), "p1", "A note",
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
            dir.path(), &gi, &reg, &AnnotationIndexOpts::default(), &make_file_lock(), "p1", "A note",
        );
        assert!(result.is_err(), "should error when parent missing from page body");
        assert!(result.unwrap_err().contains("missing from page body"),
            "error should mention missing parent");
    }

    // -----------------------------------------------------------------------
    // Cycle F tests - reconcile + migrate
    // -----------------------------------------------------------------------

    #[test]
    fn f1_notes_derived_from_sn_index() {
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

        let effective = derive_notes(&gi).unwrap();

        assert!(effective.contains_key("p1"));
        assert_eq!(effective["p1"].body, "Slip note body");
    }

    #[test]
    fn f2_json_only_notes_are_not_derived() {
        // Inverts the old fallback semantics: a note that exists only in
        // cardbox.json (no sn in source) must NOT appear in derived notes.
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
        write_layout(dir.path(), &layout);

        let effective = derive_notes(&gi).unwrap();
        assert!(!effective.contains_key("p1"),
            "JSON-only legacy entries must not be displayed: {:?}", effective);
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
            do_migrate_cardbox_slip_notes(dir.path(), &gi, &reg, &AnnotationIndexOpts::default(), &make_file_lock())
                .unwrap().result;

        assert_eq!(result.migrated, 1);
        assert_eq!(result.failed, 0);

        let file_content = read_md(dir.path(), "a.md");
        assert!(file_content.contains("sn"), "sn should be written: {}", file_content);
        assert!(file_content.contains("Legacy note"));

        let result2 =
            do_migrate_cardbox_slip_notes(dir.path(), &gi, &reg, &AnnotationIndexOpts::default(), &make_file_lock())
                .unwrap().result;
        assert_eq!(result2.migrated, 0, "second migration should be idempotent");
    }

    #[test]
    fn f4_dead_parent_json_entry_not_derived() {
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
        write_layout(dir.path(), &layout);

        let effective = derive_notes(&gi).unwrap();
        assert!(
            !effective.contains_key("deleted-uuid"),
            "dead-parent JSON entry must not be displayed (pruned by migrate)"
        );
    }

    #[test]
    fn f_derived_notes_clear_when_sn_removed() {
        let dir = create_workspace();
        // Step 1: with sn present, derived notes include sn body
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
        let effective = derive_notes(&gi).unwrap();
        assert!(effective.contains_key("p1"));

        // Step 2: remove sn from file, reindex, derive again
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

        let effective2 = derive_notes(&gi).unwrap();
        assert!(!effective2.contains_key("p1"),
            "sn removed from md -> derived notes must not have p1: {:?}", effective2);
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

        do_migrate_cardbox_slip_notes(dir.path(), &gi, &reg, &AnnotationIndexOpts::default(), &make_file_lock())
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
        do_migrate_cardbox_slip_notes(dir.path(), &gi, &reg, &AnnotationIndexOpts::default(), &make_file_lock())
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

        // Derive: sn gone -> note should not resurrect
        let effective = derive_notes(&gi).unwrap();
        assert!(!effective.contains_key("p1"),
            "note must not resurrect after sn delete + fallback drain: {:?}", effective);
    }

    #[test]
    fn migrate_drains_json_for_already_indexed_sn() {
        let dir = create_workspace();
        write_md(
            dir.path(),
            "a.md",
            concat!(
                "Text <!---[p1] n: \\s | Parent ---> more.\n\n",
                "<!---[sn1] sn: ^\"p1\" | Existing sn body @2026-07-28 --->\n",
            ),
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

        let original_content = read_md(dir.path(), "a.md");

        let result =
            do_migrate_cardbox_slip_notes(dir.path(), &gi, &reg, &AnnotationIndexOpts::default(), &make_file_lock())
                .unwrap().result;

        let on_disk = cardbox_layout::load_layout(dir.path());
        assert!(!on_disk.notes.contains_key("p1"),
            "pre-pass must drain JSON key when sn already exists: {:?}", on_disk.notes);
        assert!(result.migrated >= 1, "drain should count as migrated");

        let post_content = read_md(dir.path(), "a.md");
        assert_eq!(original_content, post_content,
            "file content must be unchanged for drain-only migrate");
    }

    #[test]
    fn migrate_indexed_dual_state_no_resurrect_after_sn_delete() {
        let dir = create_workspace();
        write_md(
            dir.path(),
            "a.md",
            concat!(
                "Text <!---[p1] n: \\s | Parent ---> more.\n\n",
                "<!---[sn1] sn: ^\"p1\" | Existing sn body @2026-07-28 --->\n",
            ),
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

        do_migrate_cardbox_slip_notes(dir.path(), &gi, &reg, &AnnotationIndexOpts::default(), &make_file_lock())
            .unwrap();

        // Externally delete the sn from file, reindex
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

        let effective = derive_notes(&gi).unwrap();
        assert!(!effective.contains_key("p1"),
            "dual-state: note must not resurrect after sn delete + JSON drain: {:?}", effective);
    }

    // -----------------------------------------------------------------------
    // Cycle K4 tests - migrate prunes dead parents + reports failures
    // -----------------------------------------------------------------------

    #[test]
    fn k4_migrate_prunes_dead_parent_entries() {
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
            "ghost-uuid".to_string(),
            CardNote { body: "orphaned note".to_string(), updated_at: None },
        );
        write_layout(dir.path(), &layout);

        let result = do_migrate_cardbox_slip_notes(
            dir.path(), &gi, &reg, &AnnotationIndexOpts::default(), &make_file_lock(),
        ).unwrap().result;

        assert_eq!(result.migrated, 0);
        assert_eq!(result.failed, 0);
        assert_eq!(result.skipped, 1, "dead-parent entry counts as skipped");
        assert!(result.failures.is_empty(), "prune is not a failure: {:?}", result.failures);

        let on_disk = cardbox_layout::load_layout(dir.path());
        assert!(!on_disk.notes.contains_key("ghost-uuid"),
            "dead-parent entry must be pruned from cardbox.json: {:?}", on_disk.notes);
    }

    #[test]
    fn k4_migrate_failure_retained_with_reason() {
        let dir = create_workspace();
        write_md(
            dir.path(),
            "a.md",
            "Text <!---[p1] n: \\s | Parent ---> end.\n",
        );
        let gi =
            GraphIndex::build(dir.path().to_path_buf(), &AnnotationIndexOpts::default()).unwrap();
        let reg = WriteHashRegistry::new();

        // Stale index: parent p1 indexed, but the page no longer contains it.
        write_md(dir.path(), "a.md", "No annotations here.\n");

        let mut layout = CardboxLayout::default();
        layout.notes.insert(
            "p1".to_string(),
            CardNote { body: "cannot migrate".to_string(), updated_at: None },
        );
        write_layout(dir.path(), &layout);

        let result = do_migrate_cardbox_slip_notes(
            dir.path(), &gi, &reg, &AnnotationIndexOpts::default(), &make_file_lock(),
        ).unwrap().result;

        assert_eq!(result.migrated, 0);
        assert_eq!(result.failed, 1);
        assert_eq!(result.skipped, 0);
        assert_eq!(result.failures.len(), 1, "failure detail expected: {:?}", result.failures);
        assert_eq!(result.failures[0].uuid, "p1");
        assert!(result.failures[0].reason.contains("missing from page body"),
            "reason should be actionable: {}", result.failures[0].reason);

        let on_disk = cardbox_layout::load_layout(dir.path());
        assert!(on_disk.notes.contains_key("p1"),
            "failed entry must stay on disk for retry: {:?}", on_disk.notes);
    }

    #[test]
    fn k4_migrate_idempotent_after_prune_and_migrate() {
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
            CardNote { body: "good note".to_string(), updated_at: None },
        );
        layout.notes.insert(
            "ghost-uuid".to_string(),
            CardNote { body: "orphaned".to_string(), updated_at: None },
        );
        write_layout(dir.path(), &layout);

        let first = do_migrate_cardbox_slip_notes(
            dir.path(), &gi, &reg, &AnnotationIndexOpts::default(), &make_file_lock(),
        ).unwrap().result;
        assert_eq!(first.migrated, 1);
        assert_eq!(first.skipped, 1);
        assert_eq!(first.failed, 0);

        let second = do_migrate_cardbox_slip_notes(
            dir.path(), &gi, &reg, &AnnotationIndexOpts::default(), &make_file_lock(),
        ).unwrap().result;
        assert_eq!(second.migrated, 0, "second run migrates nothing");
        assert_eq!(second.skipped, 0, "second run prunes nothing");
        assert_eq!(second.failed, 0);
        assert!(second.failures.is_empty());

        let on_disk = cardbox_layout::load_layout(dir.path());
        assert!(on_disk.notes.is_empty(),
            "healthy workspace converges to empty notes: {:?}", on_disk.notes);
    }

    #[test]
    fn migrate_dead_parent_does_not_abort_others() {
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
            do_migrate_cardbox_slip_notes(dir.path(), &gi, &reg, &AnnotationIndexOpts::default(), &make_file_lock())
                .unwrap().result;

        assert_eq!(result.migrated, 1, "good note should migrate");
        assert_eq!(result.skipped, 1, "dead-parent note is skipped");
        assert_eq!(result.failed, 0);

        let file_content = read_md(dir.path(), "a.md");
        assert!(file_content.contains("Good note"));

        let on_disk = cardbox_layout::load_layout(dir.path());
        assert!(!on_disk.notes.contains_key("missing-parent"),
            "dead-parent entry pruned: {:?}", on_disk.notes);
    }

    #[test]
    fn migrate_resolve_failure_does_not_abort_siblings_on_same_page() {
        let dir = create_workspace();
        write_md(
            dir.path(),
            "a.md",
            "Text <!---[p1] n: \\s | Good parent ---> mid <!---[p2] n: \\s | Doomed parent ---> end.\n",
        );
        let gi =
            GraphIndex::build(dir.path().to_path_buf(), &AnnotationIndexOpts::default()).unwrap();
        let reg = WriteHashRegistry::new();

        // Stale index: p2 still indexed, but the page no longer contains it.
        // p1's prefix is byte-identical, so its indexed position stays valid.
        write_md(
            dir.path(),
            "a.md",
            "Text <!---[p1] n: \\s | Good parent ---> mid end.\n",
        );

        let mut layout = CardboxLayout::default();
        layout.notes.insert(
            "p1".to_string(),
            CardNote { body: "Good note".to_string(), updated_at: None },
        );
        layout.notes.insert(
            "p2".to_string(),
            CardNote { body: "Doomed note".to_string(), updated_at: None },
        );
        write_layout(dir.path(), &layout);

        let result = do_migrate_cardbox_slip_notes(
            dir.path(), &gi, &reg, &AnnotationIndexOpts::default(), &make_file_lock(),
        ).unwrap().result;

        assert_eq!(result.migrated, 1, "sibling on the same page must migrate");
        assert_eq!(result.failed, 1);
        assert_eq!(result.skipped, 0);
        assert_eq!(result.failed, result.failures.len(),
            "failed must equal failures detail: {:?}", result.failures);
        assert_eq!(result.failures[0].uuid, "p2");
        assert!(result.failures[0].reason.contains("missing from page body"),
            "reason should be actionable: {}", result.failures[0].reason);

        let file_content = read_md(dir.path(), "a.md");
        assert!(file_content.contains("Good note"),
            "sibling's note must land in the page: {}", file_content);

        let on_disk = cardbox_layout::load_layout(dir.path());
        assert!(!on_disk.notes.contains_key("p1"),
            "migrated entry drained: {:?}", on_disk.notes);
        assert!(on_disk.notes.contains_key("p2"),
            "failed entry retained for retry: {:?}", on_disk.notes);
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
            dir.path(), &gi, &reg, &AnnotationIndexOpts::default(), &make_file_lock(), "p1", "A note",
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
            do_migrate_cardbox_slip_notes(dir.path(), &gi, &reg, &AnnotationIndexOpts::default(), &make_file_lock())
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
    // notes_from_sn unit tests (timestamp normalization + empty-body absence)
    // -----------------------------------------------------------------------

    fn sn_ann(body: Option<&str>, date: Option<&str>) -> crate::graph::types::CardboxAnnotation {
        crate::graph::types::CardboxAnnotation {
            uuid: "sn1".to_string(),
            annotation_type: "slipnote".to_string(),
            certainty: "neutral".to_string(),
            body: body.map(|s| s.to_string()),
            date: date.map(|s| s.to_string()),
            source_page_id: "a.md".to_string(),
            source_page_title: "A".to_string(),
            source_line: 1,
            char_start: 0,
            char_end: 10,
            scope_kind: "anchor".to_string(),
            scope_value: "p1".to_string(),
            original: None,
        }
    }

    #[test]
    fn notes_from_sn_normalizes_date_to_rfc3339() {
        let mut sn_map = HashMap::new();
        sn_map.insert("p1".to_string(), sn_ann(Some("note body"), Some("2026-07-28")));

        let effective = notes_from_sn(&sn_map);
        assert_eq!(effective["p1"].body, "note body");
        assert_eq!(
            effective["p1"].updated_at.as_deref(),
            Some("2026-07-28T00:00:00Z"),
            "date-only should be normalized to RFC3339"
        );
    }

    #[test]
    fn notes_from_sn_preserves_rfc3339_date() {
        let mut sn_map = HashMap::new();
        sn_map.insert(
            "p1".to_string(),
            sn_ann(Some("note body"), Some("2026-07-28T12:30:00+00:00")),
        );

        let effective = notes_from_sn(&sn_map);
        assert_eq!(
            effective["p1"].updated_at.as_deref(),
            Some("2026-07-28T12:30:00+00:00"),
            "already-RFC3339 should pass through unchanged"
        );
    }

    #[test]
    fn notes_from_sn_empty_body_key_absent() {
        let mut sn_map = HashMap::new();
        sn_map.insert("p1".to_string(), sn_ann(None, Some("2026-07-28")));
        sn_map.insert("p2".to_string(), sn_ann(Some(""), Some("2026-07-28")));

        let effective = notes_from_sn(&sn_map);
        assert!(effective.is_empty(),
            "empty sn body must not produce a note entry: {:?}", effective);
    }

    // -----------------------------------------------------------------------
    // K2 tests - sync never touches cardbox.json
    // -----------------------------------------------------------------------

    fn read_cardbox_json_bytes(root: &std::path::Path) -> String {
        std::fs::read_to_string(root.join(".lit").join("cardbox.json")).unwrap()
    }

    #[test]
    fn sync_create_leaves_cardbox_json_bytes_untouched() {
        let dir = create_workspace();
        write_md(
            dir.path(),
            "a.md",
            "Text <!---[p1] n: \\s | Parent ---> end.\n",
        );
        let gi =
            GraphIndex::build(dir.path().to_path_buf(), &AnnotationIndexOpts::default()).unwrap();
        let reg = WriteHashRegistry::new();

        // Legacy JSON entry for the same parent must survive sync verbatim.
        let mut layout = CardboxLayout::default();
        layout.notes.insert(
            "p1".to_string(),
            CardNote { body: "legacy json note".to_string(), updated_at: None },
        );
        write_layout(dir.path(), &layout);
        let before = read_cardbox_json_bytes(dir.path());

        let output = do_sync_slip_note_to_source(
            dir.path(), &gi, &reg, &AnnotationIndexOpts::default(), &make_file_lock(), "p1", "new body",
        ).unwrap();
        assert!(output.result.synced);

        let after = read_cardbox_json_bytes(dir.path());
        assert_eq!(before, after,
            "sync must not touch cardbox.json at all");
    }

    #[test]
    fn sync_delete_leaves_cardbox_json_bytes_untouched() {
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
            dir.path(), &gi, &reg, &AnnotationIndexOpts::default(), &make_file_lock(), "p1", "existing body",
        ).unwrap();

        let mut layout = cardbox_layout::load_layout(dir.path());
        layout.notes.insert(
            "p1".to_string(),
            CardNote { body: "stale json".to_string(), updated_at: None },
        );
        write_layout(dir.path(), &layout);
        let before = read_cardbox_json_bytes(dir.path());

        do_sync_slip_note_to_source(
            dir.path(), &gi, &reg, &AnnotationIndexOpts::default(), &make_file_lock(), "p1", "",
        ).unwrap();

        let after = read_cardbox_json_bytes(dir.path());
        assert_eq!(before, after,
            "sync delete must not touch cardbox.json");
    }

    #[test]
    fn sync_noop_leaves_cardbox_json_bytes_untouched() {
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
        let before = read_cardbox_json_bytes(dir.path());

        let output = do_sync_slip_note_to_source(
            dir.path(), &gi, &reg, &AnnotationIndexOpts::default(), &make_file_lock(), "p1", "",
        ).unwrap();
        assert!(!output.result.synced);

        let after = read_cardbox_json_bytes(dir.path());
        assert_eq!(before, after, "noop sync must not touch cardbox.json");
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
            dir.path(), &gi, &reg, &AnnotationIndexOpts::default(), &make_file_lock(),
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
    // R7 Cycle 1 tests - interpret_reindex_outcome + SyncOutput.reindex_retry
    // -----------------------------------------------------------------------

    #[test]
    fn interpret_reindex_outcome_ok_no_retry() {
        let result: Result<Vec<(String, String)>, String> =
            Ok(vec![("a.md".to_string(), "u1".to_string())]);
        let outcome = interpret_reindex_outcome(result, "a.md");
        assert_eq!(outcome.removed.len(), 1);
        assert!(!outcome.retry);
    }

    #[test]
    fn interpret_reindex_outcome_err_requests_retry() {
        let result: Result<Vec<(String, String)>, String> = Err("boom".to_string());
        let outcome = interpret_reindex_outcome(result, "a.md");
        assert!(outcome.removed.is_empty());
        assert!(outcome.retry);
    }

    #[test]
    fn schedule_slip_reindex_retry_runs_batch_reindex() {
        use std::sync::mpsc;
        use std::time::Duration;

        let dir = create_workspace();
        write_md(
            dir.path(),
            "a.md",
            "Text <!---[p1] n: \\s | Parent ---> end.\n",
        );
        let gi = Arc::new(
            GraphIndex::build(dir.path().to_path_buf(), &AnnotationIndexOpts::default()).unwrap(),
        );

        // Write sn into file WITHOUT reindexing - index is now stale
        write_md(
            dir.path(),
            "a.md",
            concat!(
                "Text <!---[p1] n: \\s | Parent ---> end.\n\n",
                "<!---[sn1] sn: ^\"p1\" | Queued note @2026-07-28 --->\n",
            ),
        );

        // Precondition: index does not know about the sn yet
        {
            let store = gi.store();
            let sn_map = store.list_slip_notes_for_parents().unwrap();
            assert!(!sn_map.contains_key("p1"), "precondition: index stale");
        }

        let spawner: Arc<dyn Fn(Box<dyn FnOnce() + Send + 'static>) + Send + Sync> =
            Arc::new(|job| { std::thread::spawn(move || job()); });
        let queue = Arc::new(crate::commands::reindex_queue::ReindexQueue::with_spawner(spawner));
        let (done_tx, done_rx) = mpsc::channel::<()>();

        let gi_for_schedule = Arc::clone(&gi);
        schedule_slip_reindex_retry(
            &queue,
            dir.path().to_path_buf(),
            "a.md".to_string(),
            gi_for_schedule,
            || AnnotationIndexOpts::default(),
            move |_result| { let _ = done_tx.send(()); },
        );

        done_rx.recv_timeout(Duration::from_secs(5))
            .expect("reindex retry must complete");

        // Index should now have the sn
        let store = gi.store();
        let sn_map = store.list_slip_notes_for_parents().unwrap();
        assert!(sn_map.contains_key("p1"), "retry must reindex: index should have sn for p1");
    }

    #[test]
    fn sync_output_reindex_retry_defaults_false_on_happy_path() {
        let dir = create_workspace();
        write_md(
            dir.path(),
            "a.md",
            "Text <!---[p1] n: \\s | Parent ---> end.\n",
        );
        let gi =
            GraphIndex::build(dir.path().to_path_buf(), &AnnotationIndexOpts::default()).unwrap();
        let reg = WriteHashRegistry::new();

        let output = do_sync_slip_note_to_source(
            dir.path(), &gi, &reg, &AnnotationIndexOpts::default(), &make_file_lock(), "p1", "A note",
        ).unwrap();

        assert!(output.result.synced);
        assert!(!output.reindex_retry);
    }

    // -----------------------------------------------------------------------
    // R7 Cycle 3 tests - drift heal on noop path
    // -----------------------------------------------------------------------

    #[test]
    fn sync_empty_heals_stale_index_when_file_has_no_sn() {
        let dir = create_workspace();
        // Start with parent + sn in file, build index
        write_md(
            dir.path(),
            "a.md",
            concat!(
                "Text <!---[p1] n: \\s | Parent ---> end.\n\n",
                "<!---[sn1] sn: ^\"p1\" | Note body @2026-07-28 --->\n",
            ),
        );
        let gi =
            GraphIndex::build(dir.path().to_path_buf(), &AnnotationIndexOpts::default()).unwrap();
        let reg = WriteHashRegistry::new();

        // Precondition: index has sn for p1
        {
            let store = gi.store();
            let sn_map = store.list_slip_notes_for_parents().unwrap();
            assert!(sn_map.contains_key("p1"), "precondition: index has sn");
        }

        // Externally rewrite file to parent-only (no reindex)
        write_md(
            dir.path(),
            "a.md",
            "Text <!---[p1] n: \\s | Parent ---> end.\n",
        );

        // sync("") should heal: file has no sn, index stale
        let output = do_sync_slip_note_to_source(
            dir.path(), &gi, &reg, &AnnotationIndexOpts::default(), &make_file_lock(), "p1", "",
        ).unwrap();

        assert!(output.result.synced, "heal should report synced=true");
        assert!(!output.reindex_retry, "successful heal should not request retry");

        // Index should now be clear
        let store = gi.store();
        let sn_map = store.list_slip_notes_for_parents().unwrap();
        assert!(!sn_map.contains_key("p1"), "heal should clear ghost sn from index");

        // File unchanged
        let content = read_md(dir.path(), "a.md");
        assert!(!content.contains("sn"), "file should still have no sn");
    }

    #[test]
    fn sync_drift_heal_leaves_cardbox_json_bytes_untouched() {
        let dir = create_workspace();
        // Parent + sn in file, build index so sn is indexed for p1.
        write_md(
            dir.path(),
            "a.md",
            concat!(
                "Text <!---[p1] n: \\s | Parent ---> end.\n\n",
                "<!---[sn1] sn: ^\"p1\" | Note body @2026-07-28 --->\n",
            ),
        );
        let gi =
            GraphIndex::build(dir.path().to_path_buf(), &AnnotationIndexOpts::default()).unwrap();
        let reg = WriteHashRegistry::new();

        // Dual-state: stale JSON legacy entry alongside indexed sn.
        let mut layout = cardbox_layout::load_layout(dir.path());
        layout.notes.insert(
            "p1".to_string(),
            CardNote {
                body: "stale json body".to_string(),
                updated_at: None,
            },
        );
        write_layout(dir.path(), &layout);
        let before = read_cardbox_json_bytes(dir.path());

        // Externally rewrite file to parent-only (no reindex) - index still has sn.
        write_md(
            dir.path(),
            "a.md",
            "Text <!---[p1] n: \\s | Parent ---> end.\n",
        );

        let output = do_sync_slip_note_to_source(
            dir.path(),
            &gi,
            &reg,
            &AnnotationIndexOpts::default(),
            &make_file_lock(),
            "p1",
            "",
        )
        .unwrap();

        assert!(output.result.synced, "heal should report synced=true");
        assert!(!output.reindex_retry, "successful heal should not request retry");

        let after = read_cardbox_json_bytes(dir.path());
        assert_eq!(before, after, "drift heal must not touch cardbox.json");

        {
            let store = gi.store();
            let sn_map = store.list_slip_notes_for_parents().unwrap();
            assert!(!sn_map.contains_key("p1"), "heal should clear ghost sn from index");
        }

        // Derived notes ignore the JSON legacy entry: p1 stays absent.
        let effective = derive_notes(&gi).unwrap();
        assert!(
            !effective.contains_key("p1"),
            "derived notes must not resurrect p1 after heal: {:?}",
            effective
        );

        let content = read_md(dir.path(), "a.md");
        assert!(!content.contains("sn"), "file should still have no sn");
    }

    // -----------------------------------------------------------------------
    // R7 Cycle 4 tests - FilePathLock in sync
    // -----------------------------------------------------------------------

    #[test]
    fn sync_page_rmw_respects_file_path_lock() {
        use std::sync::Barrier;
        use std::time::{Duration, Instant};

        let dir = create_workspace();
        write_md(
            dir.path(),
            "a.md",
            "Text <!---[p1] n: \\s | Parent ---> end.\n",
        );
        let gi =
            GraphIndex::build(dir.path().to_path_buf(), &AnnotationIndexOpts::default()).unwrap();
        let reg = WriteHashRegistry::new();
        let file_lock = Arc::new(FilePathLock::new());
        let page_path = dir.path().join("a.md");
        let barrier = Arc::new(Barrier::new(2));
        let hold_ms = 80u64;

        // Thread A: hold the page lock for hold_ms
        let fl_a = Arc::clone(&file_lock);
        let bar_a = Arc::clone(&barrier);
        let t_a = std::thread::spawn(move || {
            fl_a.with_lock(&page_path, || {
                bar_a.wait();
                std::thread::sleep(Duration::from_millis(hold_ms));
            });
        });

        // Thread B: do_sync on the same page - must wait for A's lock
        let fl_b = Arc::clone(&file_lock);
        let bar_b = barrier;
        let root = dir.path().to_path_buf();
        let t_b = std::thread::spawn(move || {
            bar_b.wait();
            let start = Instant::now();
            let _ = do_sync_slip_note_to_source(
                &root, &gi, &reg, &AnnotationIndexOpts::default(), &fl_b, "p1", "A note",
            );
            start.elapsed()
        });

        t_a.join().unwrap();
        let sync_elapsed = t_b.join().unwrap();

        assert!(sync_elapsed >= Duration::from_millis(hold_ms / 2),
            "do_sync must wait for FilePathLock (elapsed {:?}, expected >= {}ms)",
            sync_elapsed, hold_ms / 2);
    }

    // -----------------------------------------------------------------------
    // R7 Cycle 5 tests - migrate FilePathLock + retry_pages
    // -----------------------------------------------------------------------

    #[test]
    fn migrate_output_reindex_retry_pages_empty_on_happy_path() {
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
            CardNote { body: "Migrate me".to_string(), updated_at: None },
        );
        write_layout(dir.path(), &layout);

        let output = do_migrate_cardbox_slip_notes(
            dir.path(), &gi, &reg, &AnnotationIndexOpts::default(), &make_file_lock(),
        ).unwrap();

        assert_eq!(output.result.migrated, 1);
        assert!(output.reindex_retry_pages.is_empty(),
            "happy-path migrate should have no retry pages");
    }

    #[test]
    fn migrate_page_rmw_respects_file_path_lock() {
        use std::sync::Barrier;
        use std::time::{Duration, Instant};

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
            CardNote { body: "Migrate under lock".to_string(), updated_at: None },
        );
        write_layout(dir.path(), &layout);

        let file_lock = Arc::new(FilePathLock::new());
        let page_path = dir.path().join("a.md");
        let barrier = Arc::new(Barrier::new(2));
        let hold_ms = 80u64;

        let fl_a = Arc::clone(&file_lock);
        let bar_a = Arc::clone(&barrier);
        let t_a = std::thread::spawn(move || {
            fl_a.with_lock(&page_path, || {
                bar_a.wait();
                std::thread::sleep(Duration::from_millis(hold_ms));
            });
        });

        let fl_b = Arc::clone(&file_lock);
        let bar_b = barrier;
        let root = dir.path().to_path_buf();
        let t_b = std::thread::spawn(move || {
            bar_b.wait();
            let start = Instant::now();
            let _ = do_migrate_cardbox_slip_notes(
                &root, &gi, &reg, &AnnotationIndexOpts::default(), &fl_b,
            );
            start.elapsed()
        });

        t_a.join().unwrap();
        let migrate_elapsed = t_b.join().unwrap();

        assert!(migrate_elapsed >= Duration::from_millis(hold_ms / 2),
            "do_migrate must wait for FilePathLock (elapsed {:?}, expected >= {}ms)",
            migrate_elapsed, hold_ms / 2);
    }

    // -----------------------------------------------------------------------
    // R7 Cycle 6 / R8 Cycle 2 tests - emit plan (file vs index)
    // -----------------------------------------------------------------------

    #[test]
    fn sync_emit_plan_drift_heal_ok_graph_only() {
        let plan = sync_emit_plan(false, true, false);
        assert!(!plan.file_modified);
        assert!(plan.graph_side_effects);
    }

    #[test]
    fn sync_emit_plan_drift_heal_retry_emits_nothing_immediate() {
        let plan = sync_emit_plan(false, true, true);
        assert!(!plan.file_modified);
        assert!(!plan.graph_side_effects);
    }

    #[test]
    fn sync_emit_plan_wrote_ok_emits_both() {
        let plan = sync_emit_plan(true, true, false);
        assert!(plan.file_modified);
        assert!(plan.graph_side_effects);
    }

    #[test]
    fn sync_emit_plan_wrote_retry_file_only() {
        let plan = sync_emit_plan(true, true, true);
        assert!(plan.file_modified);
        assert!(!plan.graph_side_effects);
    }

    #[test]
    fn sync_emit_plan_true_noop_emits_nothing() {
        let plan = sync_emit_plan(false, false, false);
        assert!(!plan.file_modified);
        assert!(!plan.graph_side_effects);
    }

    #[test]
    fn sync_drift_heal_marks_file_unchanged() {
        let dir = create_workspace();
        write_md(
            dir.path(),
            "a.md",
            concat!(
                "Text <!---[p1] n: \\s | Parent ---> end.\n\n",
                "<!---[sn1] sn: ^\"p1\" | Note body @2026-07-28 --->\n",
            ),
        );
        let gi =
            GraphIndex::build(dir.path().to_path_buf(), &AnnotationIndexOpts::default()).unwrap();
        let reg = WriteHashRegistry::new();

        // Externally rewrite file to parent-only (no reindex)
        write_md(
            dir.path(),
            "a.md",
            "Text <!---[p1] n: \\s | Parent ---> end.\n",
        );

        let output = do_sync_slip_note_to_source(
            dir.path(), &gi, &reg, &AnnotationIndexOpts::default(), &make_file_lock(), "p1", "",
        ).unwrap();

        assert!(output.result.synced, "heal reports work done");
        assert!(!output.file_changed, "heal must not claim file bytes changed");
    }

    #[test]
    fn sync_write_marks_file_changed() {
        let dir = create_workspace();
        write_md(
            dir.path(),
            "a.md",
            "Text <!---[p1] n: \\s | Parent ---> end.\n",
        );
        let gi =
            GraphIndex::build(dir.path().to_path_buf(), &AnnotationIndexOpts::default()).unwrap();
        let reg = WriteHashRegistry::new();

        let output = do_sync_slip_note_to_source(
            dir.path(), &gi, &reg, &AnnotationIndexOpts::default(), &make_file_lock(), "p1", "A note",
        ).unwrap();

        assert!(output.result.synced);
        assert!(output.file_changed, "write path must mark file_changed");
    }

    // -----------------------------------------------------------------------
    // R8 Cycle 3 tests - migrate_graph_emit
    // -----------------------------------------------------------------------

    #[test]
    fn migrate_graph_emit_all_success() {
        let changed = vec!["a.md".into(), "b.md".into()];
        let retry: Vec<String> = vec![];
        assert!(migrate_graph_emit(&changed, &retry));
    }

    #[test]
    fn migrate_graph_emit_all_retry() {
        let changed = vec!["a.md".into(), "b.md".into()];
        let retry = vec!["a.md".into(), "b.md".into()];
        assert!(!migrate_graph_emit(&changed, &retry));
    }

    #[test]
    fn migrate_graph_emit_mixed_success_emits() {
        // Old algebra: !removed.is_empty() || (!changed.is_empty() && retry.is_empty())
        // with removed=[] and mixed retry returned false (insert-only bug).
        // New helper must emit when any changed page succeeded.
        let changed = vec!["a.md".into(), "b.md".into()];
        let retry = vec!["b.md".into()];
        assert!(migrate_graph_emit(&changed, &retry));
    }

    #[test]
    fn migrate_graph_emit_empty_changed() {
        assert!(!migrate_graph_emit(&[], &[]));
    }

    #[test]
    fn migrate_graph_emit_single_retry() {
        let changed = vec!["a.md".into()];
        let retry = vec!["a.md".into()];
        assert!(!migrate_graph_emit(&changed, &retry));
    }

    #[test]
    fn sync_empty_true_noop_when_file_and_index_lack_sn() {
        let dir = create_workspace();
        write_md(
            dir.path(),
            "a.md",
            "Text <!---[p1] n: \\s | Parent ---> end.\n",
        );
        let gi =
            GraphIndex::build(dir.path().to_path_buf(), &AnnotationIndexOpts::default()).unwrap();
        let reg = WriteHashRegistry::new();

        let output = do_sync_slip_note_to_source(
            dir.path(), &gi, &reg, &AnnotationIndexOpts::default(), &make_file_lock(), "p1", "",
        ).unwrap();

        assert!(!output.result.synced, "true noop when neither file nor index has sn");
        assert!(!output.reindex_retry);
    }
}
