use std::collections::HashSet;
use std::sync::{Arc, Mutex};
use serde::Deserialize;

pub(crate) mod merge_to_draft;
pub(crate) mod slip_note;

pub struct CardboxLock(Mutex<()>);

impl CardboxLock {
    pub fn new() -> Self {
        Self(Mutex::new(()))
    }
}
use tauri::{Emitter, State};

pub use crate::graph::cardbox_layout::{CardboxLayout, GroupInfo};
use crate::graph::cardbox_layout;

const GROUP_PREFIX: &str = "group:";

fn group_entry_key(group_id: &str) -> String {
    format!("{}{}", GROUP_PREFIX, group_id)
}

fn normalize_link(a: &str, b: &str) -> [String; 2] {
    if a <= b {
        [a.to_string(), b.to_string()]
    } else {
        [b.to_string(), a.to_string()]
    }
}

fn persist_layout(lit_dir: &std::path::Path, layout: &CardboxLayout) -> Result<(), String> {
    let layout_path = lit_dir.join("cardbox.json");
    let tmp_path = lit_dir.join(".cardbox.json.tmp");
    let content = serde_json::to_string_pretty(layout).map_err(|e| e.to_string())?;
    std::fs::write(&tmp_path, &content).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp_path, &layout_path).map_err(|e| e.to_string())?;
    Ok(())
}

fn with_cardbox_layout<F, T>(
    window: &tauri::Window,
    workspace_state: &State<crate::commands::workspace::WorkspaceRegistry>,
    lock: &State<CardboxLock>,
    f: F,
) -> Result<T, String>
where
    F: FnOnce(&mut CardboxLayout) -> Result<T, String>,
{
    let _guard = lock.0.lock().unwrap();
    let root = crate::commands::workspace::get_workspace_root(workspace_state, window.label())?;
    let lit_dir = root.join(".lit");
    std::fs::create_dir_all(&lit_dir).map_err(|e| e.to_string())?;
    let mut layout = cardbox_layout::load_layout(&root);
    let result = f(&mut layout)?;
    persist_layout(&lit_dir, &layout)?;
    Ok(result)
}

/// Remove a card UUID from wherever it currently lives (top-level order and all group orders).
fn remove_card_from_all(layout: &mut CardboxLayout, uuid: &str) {
    layout.order.retain(|e| e != uuid);
    for group in layout.groups.values_mut() {
        group.order.retain(|e| e != uuid);
    }
}

/// Pure mutation: create a group, moving cards from their current locations into it.
fn do_create_group(
    layout: &mut CardboxLayout,
    group_id: String,
    name: String,
    card_uuids: Vec<String>,
    after_entry: Option<String>,
) {
    // If the group already exists, remove its stale order entry so we don't
    // end up with duplicate "group:xxx" entries after re-inserting below.
    if layout.groups.contains_key(&group_id) {
        let group_entry = group_entry_key(&group_id);
        layout.order.retain(|e| *e != group_entry);
    }

    // Resolve the insertion position BEFORE removing cards from order.
    // After removal, indices shift — so we find after_entry's position first,
    // then count how many of card_uuids appear at or before that position to
    // compute the adjusted insertion point.
    let card_set: HashSet<&str> = card_uuids.iter().map(|s| s.as_str()).collect();
    let insertion_index = if let Some(ref after) = after_entry {
        if let Some(pos) = layout.order.iter().position(|e| *e == *after) {
            let preceding_removals = layout.order[..=pos]
                .iter()
                .filter(|e| card_set.contains(e.as_str()))
                .count();
            Some(pos + 1 - preceding_removals)
        } else {
            None // after_entry not found — will append
        }
    } else {
        None // no after_entry — will append
    };

    for uuid in &card_uuids {
        remove_card_from_all(layout, uuid);
    }
    layout.groups.insert(group_id.clone(), GroupInfo {
        name,
        order: card_uuids,
        collapsed: false,
    });
    let group_entry = group_entry_key(&group_id);
    if let Some(idx) = insertion_index {
        let clamped = idx.min(layout.order.len());
        layout.order.insert(clamped, group_entry);
    } else {
        layout.order.push(group_entry);
    }
    layout.version = 3;
}

/// Pure mutation: rename a group.
fn do_rename_group(layout: &mut CardboxLayout, group_id: &str, name: String) -> Result<(), String> {
    let group = layout.groups.get_mut(group_id)
        .ok_or_else(|| format!("Group '{}' does not exist", group_id))?;
    group.name = name;
    Ok(())
}

/// Pure mutation: dissolve a group, splicing its members back into top-level order.
fn do_dissolve_group(layout: &mut CardboxLayout, group_id: &str) -> Result<(), String> {
    let group = layout.groups.remove(group_id)
        .ok_or_else(|| format!("Group '{}' does not exist", group_id))?;
    let group_entry = group_entry_key(group_id);
    if let Some(pos) = layout.order.iter().position(|e| *e == group_entry) {
        layout.order.remove(pos);
        for (i, uuid) in group.order.into_iter().enumerate() {
            layout.order.insert(pos + i, uuid);
        }
    } else {
        // Corrupted layout: group existed in map but "group:xxx" missing from order.
        // Recover by appending members to the end rather than losing them.
        layout.order.extend(group.order);
    }
    Ok(())
}

/// Pure mutation: move a card into a group at an optional index.
fn do_move_card_to_group(
    layout: &mut CardboxLayout,
    card_uuid: String,
    target_group_id: &str,
    index: Option<usize>,
) -> Result<(), String> {
    if !layout.groups.contains_key(target_group_id) {
        return Err(format!("Group '{}' does not exist", target_group_id));
    }
    remove_card_from_all(layout, &card_uuid);
    let group = layout.groups.get_mut(target_group_id).unwrap();
    match index {
        Some(idx) => {
            let clamped = idx.min(group.order.len());
            group.order.insert(clamped, card_uuid);
        }
        None => group.order.push(card_uuid),
    }
    Ok(())
}

/// Pure mutation: remove a card from a specific group and place it at top-level.
/// Auto-dissolves the group if it becomes empty.
fn do_remove_card_from_group(
    layout: &mut CardboxLayout,
    card_uuid: String,
    group_id: &str,
    top_level_index: Option<usize>,
) -> Result<(), String> {
    let group = layout.groups.get_mut(group_id)
        .ok_or_else(|| format!("Group '{}' does not exist", group_id))?;
    group.order.retain(|e| e != &card_uuid);

    match top_level_index {
        Some(idx) => {
            let clamped = idx.min(layout.order.len());
            layout.order.insert(clamped, card_uuid);
        }
        None => layout.order.push(card_uuid),
    }

    if layout.groups.get(group_id).map_or(false, |g| g.order.is_empty()) {
        layout.groups.remove(group_id);
        let group_entry = group_entry_key(group_id);
        layout.order.retain(|e| *e != group_entry);
    }
    Ok(())
}

/// Pure mutation: set the collapsed flag on a group.
fn do_toggle_group_collapsed(
    layout: &mut CardboxLayout,
    group_id: &str,
    collapsed: bool,
) -> Result<(), String> {
    let group = layout.groups.get_mut(group_id)
        .ok_or_else(|| format!("Group '{}' does not exist", group_id))?;
    group.collapsed = collapsed;
    Ok(())
}

/// Merge the client's structural view state into the disk layout. Client-sent
/// `notes` never merge: disk notes are a read-only migration input owned by
/// `migrate_cardbox_slip_notes` and are preserved verbatim.
pub(crate) fn merge_structural_layout(disk: &mut CardboxLayout, client: CardboxLayout) {
    disk.order = client.order;
    disk.links = client.links;
    disk.groups = client.groups;
    disk.pinned = client.pinned;
    disk.colors = client.colors;
    disk.version = disk.version.max(client.version);
}

fn prune_layout(layout: &mut CardboxLayout, valid_uuids: &HashSet<&str>) {
    // Prune stale UUIDs from each group's order
    for group in layout.groups.values_mut() {
        group.order.retain(|uuid| valid_uuids.contains(uuid.as_str()));
    }

    // Remove empty groups
    let empty_group_ids: Vec<String> = layout.groups.iter()
        .filter(|(_, g)| g.order.is_empty())
        .map(|(id, _)| id.clone())
        .collect();
    for id in &empty_group_ids {
        layout.groups.remove(id);
    }

    // Collect all UUIDs that belong to any group (for dedup)
    let grouped_uuids: HashSet<&str> = layout.groups.values()
        .flat_map(|g| g.order.iter().map(|s| s.as_str()))
        .collect();

    // Collect valid group IDs to avoid borrow conflict in retain
    let valid_group_ids: HashSet<&str> = layout.groups.keys().map(|s| s.as_str()).collect();

    // Prune top-level order:
    //   - keep "group:xxx" entries only if the group still exists
    //   - keep UUID entries only if valid AND not inside any group
    layout.order.retain(|entry| {
        if let Some(group_id) = entry.strip_prefix(GROUP_PREFIX) {
            valid_group_ids.contains(group_id)
        } else {
            valid_uuids.contains(entry.as_str()) && !grouped_uuids.contains(entry.as_str())
        }
    });

    // Prune stale links
    layout.links.retain(|pair| {
        valid_uuids.contains(pair[0].as_str()) && valid_uuids.contains(pair[1].as_str())
    });

    // Prune stale color entries
    layout.colors.retain(|uuid, _| valid_uuids.contains(uuid.as_str()));
}

#[tauri::command]
pub fn list_all_annotations(
    window: tauri::Window,
    workspace_state: State<crate::commands::workspace::WorkspaceRegistry>,
    graph_state: State<Arc<super::graph::GraphRegistry>>,
) -> Result<serde_json::Value, String> {
    super::graph::with_graph_index(&workspace_state, &graph_state, window.label(), |gi| {
        let results = gi.list_all_cardbox_annotations()?;
        serde_json::to_value(results)
            .map_err(|e| crate::graph::error::GraphError::Other(e.to_string()))
    })
}

/// Load, normalize, and prune the layout, then derive the response notes
/// purely from sn annotations.
///
/// Disk `notes` are a legacy migration input owned by
/// `migrate_cardbox_slip_notes`: the read path never modifies them, and the
/// dirty-persist decision is made before the derived notes are attached, so a
/// structural persist rewrites the disk notes verbatim.
pub(crate) fn do_read_cardbox_layout(
    root: &std::path::Path,
    gi: &crate::graph::indexer::GraphIndex,
) -> Result<CardboxLayout, String> {
    let mut layout = cardbox_layout::load_layout(root);
    let snapshot = layout.clone();

    // Normalize links: sort within pairs, sort full list, dedup
    for pair in &mut layout.links {
        if pair[0] > pair[1] {
            pair.swap(0, 1);
        }
    }
    layout.links.sort();
    layout.links.dedup();

    // Prune stale UUIDs from structural fields; `notes` are left untouched.
    let all_uuids = gi.list_all_cardbox_annotation_uuids().map_err(|e| e.to_string())?;
    let valid_uuids: HashSet<&str> = all_uuids.iter().map(|s| s.as_str()).collect();
    prune_layout(&mut layout, &valid_uuids);
    layout.pinned.retain(|uuid| valid_uuids.contains(uuid.as_str()));
    let mut seen = HashSet::new();
    layout.pinned.retain(|uuid| seen.insert(uuid.clone()));

    // Persist only if normalize/prune actually changed something. Notes are
    // untouched above, so this can never rewrite the disk `notes` field.
    if layout != snapshot {
        let lit_dir = root.join(".lit");
        std::fs::create_dir_all(&lit_dir).map_err(|e| e.to_string())?;
        persist_layout(&lit_dir, &layout)?;
    }

    // Response notes are purely sn-derived (never persisted).
    layout.notes = slip_note::derive_notes(gi)?;

    Ok(layout)
}

#[tauri::command]
pub fn read_cardbox_layout(
    window: tauri::Window,
    workspace_state: State<crate::commands::workspace::WorkspaceRegistry>,
    graph_state: State<Arc<super::graph::GraphRegistry>>,
    lock: State<CardboxLock>,
) -> Result<CardboxLayout, String> {
    let _guard = lock.0.lock().unwrap();
    let root = crate::commands::workspace::get_workspace_root(&workspace_state, window.label())?;

    super::graph::with_graph_index(&workspace_state, &graph_state, window.label(), |gi| {
        do_read_cardbox_layout(&root, gi)
            .map_err(crate::graph::error::GraphError::Other)
    })
}

#[tauri::command]
pub fn write_cardbox_layout(
    window: tauri::Window,
    workspace_state: State<crate::commands::workspace::WorkspaceRegistry>,
    lock: State<CardboxLock>,
    layout: CardboxLayout,
) -> Result<(), String> {
    let _guard = lock.0.lock().unwrap();
    let root = crate::commands::workspace::get_workspace_root(&workspace_state, window.label())?;

    let mut disk_layout = cardbox_layout::load_layout(&root);
    merge_structural_layout(&mut disk_layout, layout);

    let lit_dir = root.join(".lit");
    std::fs::create_dir_all(&lit_dir).map_err(|e| e.to_string())?;
    persist_layout(&lit_dir, &disk_layout)
}

#[tauri::command]
pub fn add_cardbox_link(
    window: tauri::Window,
    workspace_state: State<crate::commands::workspace::WorkspaceRegistry>,
    graph_state: State<Arc<super::graph::GraphRegistry>>,
    lock: State<CardboxLock>,
    app_handle: tauri::AppHandle,
    a: String,
    b: String,
) -> Result<(), String> {
    if a == b {
        return Err("Cannot link a card to itself".to_string());
    }

    let added = with_cardbox_layout(&window, &workspace_state, &lock, |layout| {
        let normalized = normalize_link(&a, &b);
        if layout.links.iter().any(|pair| *pair == normalized) {
            return Ok(false);
        }
        layout.links.push(normalized);
        layout.version = layout.version.max(2);
        Ok(true)
    })?;

    if added {
        let root = crate::commands::workspace::get_workspace_root(&workspace_state, window.label())?;
        if let Some(gi) = super::page::lookup_graph_index(&graph_state, &root) {
            match gi.add_cardbox_edge(&a, &b) {
                Ok(true) => { let _ = app_handle.emit("lit:graph-updated", ()); }
                Ok(false) => {}
                Err(e) => tracing::warn!("add_cardbox_edge failed: {e}"),
            }
        }
    }

    Ok(())
}

#[tauri::command]
pub fn remove_cardbox_link(
    window: tauri::Window,
    workspace_state: State<crate::commands::workspace::WorkspaceRegistry>,
    graph_state: State<Arc<super::graph::GraphRegistry>>,
    lock: State<CardboxLock>,
    app_handle: tauri::AppHandle,
    a: String,
    b: String,
) -> Result<(), String> {
    let removed = with_cardbox_layout(&window, &workspace_state, &lock, |layout| {
        let normalized = normalize_link(&a, &b);
        let before = layout.links.len();
        layout.links.retain(|pair| *pair != normalized);
        if layout.links.len() == before {
            Ok(None)
        } else {
            Ok(Some(layout.links.clone()))
        }
    })?;

    if let Some(remaining_links) = removed {
        let root = crate::commands::workspace::get_workspace_root(&workspace_state, window.label())?;
        if let Some(gi) = super::page::lookup_graph_index(&graph_state, &root) {
            match gi.remove_cardbox_edge(&remaining_links, &a, &b) {
                Ok(true) => { let _ = app_handle.emit("lit:graph-updated", ()); }
                Ok(false) => {}
                Err(e) => tracing::warn!("remove_cardbox_edge failed: {e}"),
            }
        }
    }

    Ok(())
}

#[tauri::command]
pub fn create_cardbox_group(
    window: tauri::Window,
    workspace_state: State<crate::commands::workspace::WorkspaceRegistry>,
    lock: State<CardboxLock>,
    group_id: String,
    name: String,
    card_uuids: Vec<String>,
    after_entry: Option<String>,
) -> Result<(), String> {
    with_cardbox_layout(&window, &workspace_state, &lock, |layout| {
        do_create_group(layout, group_id, name, card_uuids, after_entry);
        Ok(())
    })
}

#[tauri::command]
pub fn rename_cardbox_group(
    window: tauri::Window,
    workspace_state: State<crate::commands::workspace::WorkspaceRegistry>,
    lock: State<CardboxLock>,
    group_id: String,
    name: String,
) -> Result<(), String> {
    with_cardbox_layout(&window, &workspace_state, &lock, |layout| {
        do_rename_group(layout, &group_id, name)
    })
}

#[tauri::command]
pub fn dissolve_cardbox_group(
    window: tauri::Window,
    workspace_state: State<crate::commands::workspace::WorkspaceRegistry>,
    lock: State<CardboxLock>,
    group_id: String,
) -> Result<(), String> {
    with_cardbox_layout(&window, &workspace_state, &lock, |layout| {
        do_dissolve_group(layout, &group_id)
    })
}

#[tauri::command]
pub fn move_card_to_group(
    window: tauri::Window,
    workspace_state: State<crate::commands::workspace::WorkspaceRegistry>,
    lock: State<CardboxLock>,
    card_uuid: String,
    target_group_id: String,
    index: Option<usize>,
) -> Result<(), String> {
    with_cardbox_layout(&window, &workspace_state, &lock, |layout| {
        do_move_card_to_group(layout, card_uuid, &target_group_id, index)
    })
}

#[tauri::command]
pub fn remove_card_from_group(
    window: tauri::Window,
    workspace_state: State<crate::commands::workspace::WorkspaceRegistry>,
    lock: State<CardboxLock>,
    card_uuid: String,
    group_id: String,
    top_level_index: Option<usize>,
) -> Result<(), String> {
    with_cardbox_layout(&window, &workspace_state, &lock, |layout| {
        do_remove_card_from_group(layout, card_uuid, &group_id, top_level_index)
    })
}

#[tauri::command]
pub fn toggle_group_collapsed(
    window: tauri::Window,
    workspace_state: State<crate::commands::workspace::WorkspaceRegistry>,
    lock: State<CardboxLock>,
    group_id: String,
    collapsed: bool,
) -> Result<(), String> {
    with_cardbox_layout(&window, &workspace_state, &lock, |layout| {
        do_toggle_group_collapsed(layout, &group_id, collapsed)
    })
}

#[tauri::command]
pub fn pin_cardbox_card(
    window: tauri::Window,
    workspace_state: State<crate::commands::workspace::WorkspaceRegistry>,
    lock: State<CardboxLock>,
    uuid: String,
) -> Result<(), String> {
    with_cardbox_layout(&window, &workspace_state, &lock, |layout| {
        if layout.pinned.contains(&uuid) {
            return Ok(());
        }
        layout.pinned.push(uuid.clone());
        layout.version = layout.version.max(3);
        Ok(())
    })
}

#[tauri::command]
pub fn unpin_cardbox_card(
    window: tauri::Window,
    workspace_state: State<crate::commands::workspace::WorkspaceRegistry>,
    lock: State<CardboxLock>,
    uuid: String,
) -> Result<(), String> {
    with_cardbox_layout(&window, &workspace_state, &lock, |layout| {
        let before = layout.pinned.len();
        layout.pinned.retain(|u| *u != uuid);
        if layout.pinned.len() < before {
            layout.version = layout.version.max(3);
        }
        Ok(())
    })
}

pub(super) fn sanitize_filename(name: &str) -> String {
    name.chars()
        .map(|c| if c.is_control() || matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|') { '_' } else { c })
        .collect()
}

pub(super) fn dedup_filename(root: &std::path::Path, base: &str) -> String {
    let candidate = format!("{}.md", base);
    if !root.join(&candidate).exists() {
        return candidate;
    }
    for i in 1.. {
        let candidate = format!("{} {}.md", base, i);
        if !root.join(&candidate).exists() {
            return candidate;
        }
    }
    unreachable!()
}

pub(super) fn escape_yaml_double_quoted(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '\\' => out.push_str("\\\\"),
            '"'  => out.push_str("\\\""),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            '\0' => out.push_str("\\0"),
            _    => out.push(c),
        }
    }
    out
}

pub(super) fn blockquote(text: &str) -> String {
    text.lines()
        .map(|line| format!("> {}", line))
        .collect::<Vec<_>>()
        .join("\n")
}

pub(crate) fn do_export_card_note(
    root: &std::path::Path,
    gi: &crate::graph::indexer::GraphIndex,
    registry: &crate::workspace::write_hash::WriteHashRegistry,
    uuid: &str,
) -> Result<String, String> {
    let effective = slip_note::derive_notes(gi)?;

    let note = effective.get(uuid)
        .ok_or_else(|| format!("No note for card {}", uuid))?;

    let all = gi.list_all_cardbox_annotations()
        .map_err(|e| e.to_string())?;
    let ann = all.into_iter()
        .find(|a| a.uuid == uuid)
        .ok_or_else(|| format!("Annotation {} not found", uuid))?;

    let base = sanitize_filename(&format!("Note on {}", ann.source_page_title));
    let filename = dedup_filename(root, &base);
    let file_path = root.join(&filename);

    let mut content = String::new();
    content.push_str("---\n");
    content.push_str(&format!("source: \"{}\"\n", escape_yaml_double_quoted(&ann.source_page_id)));
    content.push_str(&format!("annotation_uuid: \"{}\"\n", escape_yaml_double_quoted(uuid)));
    if let Some(ref updated_at) = note.updated_at {
        content.push_str(&format!("created: \"{}\"\n", escape_yaml_double_quoted(updated_at)));
    }
    content.push_str("---\n\n");

    if let Some(ref original) = ann.original {
        let blockquoted = blockquote(original);
        content.push_str(&blockquoted);
        content.push_str("\n\n");
    }

    content.push_str(&note.body);
    content.push('\n');

    std::fs::write(&file_path, &content).map_err(|e| e.to_string())?;
    registry.record(&file_path, &content);

    Ok(filename)
}

#[tauri::command]
pub fn export_card_note(
    window: tauri::Window,
    workspace_state: State<crate::commands::workspace::WorkspaceRegistry>,
    graph_state: State<Arc<super::graph::GraphRegistry>>,
    lock: State<CardboxLock>,
    registry: State<Arc<crate::workspace::write_hash::WriteHashRegistry>>,
    app_handle: tauri::AppHandle,
    uuid: String,
) -> Result<String, String> {
    let _guard = lock.0.lock().unwrap();
    let root = crate::commands::workspace::get_workspace_root(&workspace_state, window.label())?;

    let filename = super::graph::with_graph_index(&workspace_state, &graph_state, window.label(), |gi| {
        do_export_card_note(&root, gi, &registry, &uuid)
            .map_err(|e| crate::graph::error::GraphError::Other(e))
    })?;

    super::page::reindex_and_emit(&graph_state, &app_handle, &root.to_path_buf(), |gi, ann_flag| {
        gi.add_file(&filename, ann_flag)
    });

    let _ = window.emit("workspace://file-created", crate::workspace::watcher::FileEvent {
        path: filename.clone(),
    });

    Ok(filename)
}

const VALID_COLORS: &[&str] = &["blue", "orange", "green", "purple", "pink", "cyan"];

#[tauri::command]
pub fn set_card_color(
    window: tauri::Window,
    workspace_state: State<crate::commands::workspace::WorkspaceRegistry>,
    lock: State<CardboxLock>,
    uuid: String,
    color: String,
) -> Result<(), String> {
    if !VALID_COLORS.contains(&color.as_str()) {
        return Err(format!(
            "Invalid color '{}'. Must be one of: {}",
            color,
            VALID_COLORS.join(", ")
        ));
    }
    with_cardbox_layout(&window, &workspace_state, &lock, |layout| {
        layout.colors.insert(uuid.clone(), color.clone());
        layout.version = layout.version.max(4);
        Ok(())
    })
}

#[tauri::command]
pub fn clear_card_color(
    window: tauri::Window,
    workspace_state: State<crate::commands::workspace::WorkspaceRegistry>,
    lock: State<CardboxLock>,
    uuid: String,
) -> Result<(), String> {
    with_cardbox_layout(&window, &workspace_state, &lock, |layout| {
        if layout.colors.remove(&uuid).is_some() {
            layout.version = layout.version.max(4);
        }
        Ok(())
    })
}

#[derive(Debug, Clone, Deserialize)]
pub struct ColorEntry {
    pub uuid: String,
    pub color: String,
}

#[tauri::command]
pub fn batch_set_card_color(
    window: tauri::Window,
    workspace_state: State<crate::commands::workspace::WorkspaceRegistry>,
    lock: State<CardboxLock>,
    entries: Vec<ColorEntry>,
) -> Result<(), String> {
    // Validate all colors upfront before touching layout
    for entry in &entries {
        if !VALID_COLORS.contains(&entry.color.as_str()) {
            return Err(format!(
                "Invalid color '{}'. Must be one of: {}",
                entry.color,
                VALID_COLORS.join(", ")
            ));
        }
    }
    with_cardbox_layout(&window, &workspace_state, &lock, |layout| {
        for entry in &entries {
            layout.colors.insert(entry.uuid.clone(), entry.color.clone());
        }
        layout.version = layout.version.max(4);
        Ok(())
    })
}

#[tauri::command]
pub fn batch_clear_card_color(
    window: tauri::Window,
    workspace_state: State<crate::commands::workspace::WorkspaceRegistry>,
    lock: State<CardboxLock>,
    uuids: Vec<String>,
) -> Result<(), String> {
    with_cardbox_layout(&window, &workspace_state, &lock, |layout| {
        let mut changed = false;
        for uuid in &uuids {
            if layout.colors.remove(uuid).is_some() {
                changed = true;
            }
        }
        if changed {
            layout.version = layout.version.max(4);
        }
        Ok(())
    })
}

#[tauri::command]
pub fn batch_pin_cards(
    window: tauri::Window,
    workspace_state: State<crate::commands::workspace::WorkspaceRegistry>,
    lock: State<CardboxLock>,
    uuids: Vec<String>,
) -> Result<(), String> {
    with_cardbox_layout(&window, &workspace_state, &lock, |layout| {
        let pinned_set: HashSet<String> = layout.pinned.iter().cloned().collect();
        let to_add: Vec<String> = uuids.iter()
            .filter(|uuid| !pinned_set.contains(uuid.as_str()))
            .cloned()
            .collect();
        if !to_add.is_empty() {
            layout.pinned.extend(to_add);
            layout.version = layout.version.max(3);
        }
        Ok(())
    })
}

#[tauri::command]
pub fn batch_unpin_cards(
    window: tauri::Window,
    workspace_state: State<crate::commands::workspace::WorkspaceRegistry>,
    lock: State<CardboxLock>,
    uuids: Vec<String>,
) -> Result<(), String> {
    with_cardbox_layout(&window, &workspace_state, &lock, |layout| {
        let remove_set: HashSet<&str> = uuids.iter().map(|s| s.as_str()).collect();
        let before = layout.pinned.len();
        layout.pinned.retain(|u| !remove_set.contains(u.as_str()));
        if layout.pinned.len() < before {
            layout.version = layout.version.max(3);
        }
        Ok(())
    })
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;
    use crate::graph::cardbox_layout::CardNote;
    use crate::graph::indexer::GraphIndex;
    use crate::annotation::lang::AnnotationIndexOpts;

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

    #[test]
    fn cmd_list_all_annotations_empty_workspace() {
        let dir = create_workspace();
        write_md(dir.path(), "empty.md", "no annotations here");
        let gi = GraphIndex::build(dir.path().to_path_buf(), &AnnotationIndexOpts::default()).unwrap();
        let results = gi.list_all_cardbox_annotations().unwrap();
        assert!(results.is_empty());
    }

    #[test]
    fn cmd_list_all_annotations_across_pages() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "Some text <!--- n: _ | Silk Road flourished ---> more.");
        write_md(dir.path(), "b.md", "Question <!--- q: _ | What happened? ---> end.");
        write_md(dir.path(), "c.md", "Todo <!--- t: _ | Fix this ---> done.");
        let gi = GraphIndex::build(dir.path().to_path_buf(), &AnnotationIndexOpts::default()).unwrap();
        let results = gi.list_all_cardbox_annotations().unwrap();
        assert_eq!(results.len(), 3);
        let page_ids: Vec<&str> = results.iter().map(|r| r.source_page_id.as_str()).collect();
        assert!(page_ids.contains(&"a.md"));
        assert!(page_ids.contains(&"b.md"));
        assert!(page_ids.contains(&"c.md"));
        // Verify fields are populated
        let a = results.iter().find(|r| r.source_page_id == "a.md").unwrap();
        assert_eq!(a.annotation_type, "note");
        assert!(a.body.as_deref().unwrap().contains("Silk Road"));
        assert!(!a.uuid.is_empty());
        assert_eq!(a.original.as_deref(), Some("text"));
    }

    #[test]
    fn cmd_list_all_annotations_sorted_by_page_then_position() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "<!--- n: _ | first ---> text <!--- q: _ | second --->");
        let gi = GraphIndex::build(dir.path().to_path_buf(), &AnnotationIndexOpts::default()).unwrap();
        let results = gi.list_all_cardbox_annotations().unwrap();
        assert_eq!(results.len(), 2);
        assert!(results[0].char_start < results[1].char_start);
    }

    #[test]
    fn cmd_read_cardbox_layout_missing_file() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "<!--- n: _ | note --->");
        let _gi = GraphIndex::build(dir.path().to_path_buf(), &AnnotationIndexOpts::default()).unwrap();

        // No .lit/cardbox.json exists
        let layout_path = dir.path().join(".lit").join("cardbox.json");
        assert!(!layout_path.exists());

        // Simulate reading: no file should return empty layout
        let layout = match std::fs::read_to_string(&layout_path) {
            Ok(content) => serde_json::from_str::<super::CardboxLayout>(&content)
                .unwrap_or(super::CardboxLayout::default()),
            Err(_) => super::CardboxLayout::default(),

        };
        assert_eq!(layout, super::CardboxLayout::default());

    }

    #[test]
    fn cmd_write_and_read_cardbox_layout_roundtrip() {
        let dir = create_workspace();
        let lit_dir = dir.path().join(".lit");
        std::fs::create_dir_all(&lit_dir).unwrap();

        let layout = super::CardboxLayout {
            version: 1,
            order: vec!["uuid-1".into(), "uuid-2".into(), "uuid-3".into()],
            links: vec![],
            ..Default::default()

        };

        // Write
        let layout_path = lit_dir.join("cardbox.json");
        let tmp_path = lit_dir.join(".cardbox.json.tmp");
        let content = serde_json::to_string_pretty(&layout).unwrap();
        std::fs::write(&tmp_path, &content).unwrap();
        std::fs::rename(&tmp_path, &layout_path).unwrap();

        // Read back
        let read_content = std::fs::read_to_string(&layout_path).unwrap();
        let read_layout: super::CardboxLayout = serde_json::from_str(&read_content).unwrap();
        assert_eq!(read_layout, layout);
    }

    #[test]
    fn cmd_read_cardbox_layout_prunes_stale_uuids() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "<!--- n: _ | note --->");
        let gi = GraphIndex::build(dir.path().to_path_buf(), &AnnotationIndexOpts::default()).unwrap();

        // Get the real UUID of the annotation
        let anns = gi.list_all_cardbox_annotations().unwrap();
        assert_eq!(anns.len(), 1);
        let real_uuid = anns[0].uuid.clone();

        // Write a layout with the real UUID + a stale one
        let lit_dir = dir.path().join(".lit");
        std::fs::create_dir_all(&lit_dir).unwrap();
        let layout = super::CardboxLayout {
            version: 1,
            order: vec!["stale-uuid".into(), real_uuid.clone()],
            links: vec![],
            ..Default::default()

        };
        std::fs::write(
            lit_dir.join("cardbox.json"),
            serde_json::to_string(&layout).unwrap(),
        ).unwrap();

        // Read and prune
        let layout_path = lit_dir.join("cardbox.json");
        let mut read_layout: super::CardboxLayout = serde_json::from_str(
            &std::fs::read_to_string(&layout_path).unwrap()
        ).unwrap();

        let valid_uuids: std::collections::HashSet<&str> = anns.iter().map(|a| a.uuid.as_str()).collect();
        read_layout.order.retain(|uuid| valid_uuids.contains(uuid.as_str()));

        assert_eq!(read_layout.order, vec![real_uuid]);
    }

    #[test]
    fn cmd_write_cardbox_layout_creates_lit_dir() {
        let dir = create_workspace();
        let lit_dir = dir.path().join(".lit");
        assert!(!lit_dir.exists());

        std::fs::create_dir_all(&lit_dir).unwrap();
        let layout = super::CardboxLayout { version: 1, order: vec!["a".into()], links: vec![], ..Default::default() };

        let content = serde_json::to_string_pretty(&layout).unwrap();
        std::fs::write(lit_dir.join("cardbox.json"), &content).unwrap();

        assert!(lit_dir.join("cardbox.json").exists());
        let read: super::CardboxLayout = serde_json::from_str(
            &std::fs::read_to_string(lit_dir.join("cardbox.json")).unwrap()
        ).unwrap();
        assert_eq!(read.order, vec!["a"]);
    }

    #[test]
    fn cmd_original_resolved_for_sentence_scope() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "First sentence. Second sentence.<!--- n: \\s | note --->");
        let gi = GraphIndex::build(dir.path().to_path_buf(), &AnnotationIndexOpts::default()).unwrap();
        let results = gi.list_all_cardbox_annotations().unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].original.as_deref(), Some("Second sentence."));
    }

    #[test]
    fn cmd_original_survives_file_deletion_until_reindex() {
        let dir = create_workspace();
        let file_path = dir.path().join("a.md");
        std::fs::write(&file_path, "Some text <!--- n: _ | note --->").unwrap();
        let gi = GraphIndex::build(dir.path().to_path_buf(), &AnnotationIndexOpts::default()).unwrap();
        std::fs::remove_file(&file_path).unwrap();

        // original is resolved at index time, so the DB snapshot survives the
        // on-disk deletion until the watcher-driven reindex removes the file.
        let results = gi.list_all_cardbox_annotations().unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].original.as_deref(), Some("text"));

        gi.remove_file("a.md", &AnnotationIndexOpts::default()).unwrap();
        let results = gi.list_all_cardbox_annotations().unwrap();
        assert!(results.is_empty(), "reindex after deletion should drop the annotation entirely");
    }

    #[test]
    fn cmd_original_resolved_multiple_annotations_same_file() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "alpha <!--- n: _ | first ---> beta <!--- n: _ | second --->");
        let gi = GraphIndex::build(dir.path().to_path_buf(), &AnnotationIndexOpts::default()).unwrap();
        let results = gi.list_all_cardbox_annotations().unwrap();
        assert_eq!(results.len(), 2);
        assert_eq!(results[0].original.as_deref(), Some("alpha"));
        assert_eq!(results[1].original.as_deref(), Some("beta"));
    }

    #[test]
    fn cmd_original_resolved_with_frontmatter() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "---\ntitle: Test\n---\nSome text <!--- n: _ | note --->");
        let gi = GraphIndex::build(dir.path().to_path_buf(), &AnnotationIndexOpts::default()).unwrap();
        let results = gi.list_all_cardbox_annotations().unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].original.as_deref(), Some("text"));
    }

    fn write_layout(root: &std::path::Path, layout: &super::CardboxLayout) {
        let lit_dir = root.join(".lit");
        std::fs::create_dir_all(&lit_dir).unwrap();
        let content = serde_json::to_string_pretty(layout).unwrap();
        std::fs::write(lit_dir.join("cardbox.json"), &content).unwrap();
    }

    fn read_layout(root: &std::path::Path) -> super::CardboxLayout {
        let content = std::fs::read_to_string(root.join(".lit").join("cardbox.json")).unwrap();
        serde_json::from_str(&content).unwrap()
    }

    #[test]
    fn add_link_creates_pair() {
        let dir = create_workspace();
        let layout = super::CardboxLayout {
            version: 1,
            order: vec![],
            links: vec![],
            ..Default::default()

        };
        write_layout(dir.path(), &layout);

        let mut layout = read_layout(dir.path());
        let normalized = super::normalize_link("uuid-a", "uuid-b");
        layout.links.push(normalized.clone());
        layout.version = 2;
        write_layout(dir.path(), &layout);

        let result = read_layout(dir.path());
        assert_eq!(result.links, vec![normalized]);
        assert_eq!(result.version, 2);
    }

    #[test]
    fn add_link_idempotent() {
        let dir = create_workspace();
        let normalized = super::normalize_link("uuid-a", "uuid-b");
        let layout = super::CardboxLayout {
            version: 2,
            order: vec![],
            links: vec![normalized.clone()],
            ..Default::default()

        };
        write_layout(dir.path(), &layout);

        let mut layout = read_layout(dir.path());
        if !layout.links.iter().any(|p| *p == normalized) {
            layout.links.push(normalized.clone());
        }
        write_layout(dir.path(), &layout);

        let result = read_layout(dir.path());
        assert_eq!(result.links.len(), 1);
    }

    #[test]
    fn add_link_self_rejected() {
        let dir = create_workspace();
        let layout = super::CardboxLayout {
            version: 1,
            order: vec![],
            links: vec![],
            ..Default::default()

        };
        write_layout(dir.path(), &layout);

        let a = "same-uuid";
        let b = "same-uuid";
        assert_eq!(a, b, "precondition: self-link attempt");

        let result = read_layout(dir.path());
        assert!(result.links.is_empty(), "no link should exist for self-link");
    }

    #[test]
    fn add_link_normalization() {
        let pair_ab = super::normalize_link("b", "a");
        assert_eq!(pair_ab, ["a".to_string(), "b".to_string()]);

        let pair_ba = super::normalize_link("a", "b");
        assert_eq!(pair_ba, ["a".to_string(), "b".to_string()]);

        assert_eq!(pair_ab, pair_ba);
    }

    #[test]
    fn remove_link_removes_pair() {
        let dir = create_workspace();
        let normalized = super::normalize_link("uuid-a", "uuid-b");
        let layout = super::CardboxLayout {
            version: 2,
            order: vec![],
            links: vec![normalized.clone()],
            ..Default::default()

        };
        write_layout(dir.path(), &layout);

        let mut layout = read_layout(dir.path());
        layout.links.retain(|p| *p != normalized);
        write_layout(dir.path(), &layout);

        let result = read_layout(dir.path());
        assert!(result.links.is_empty());
    }

    #[test]
    fn remove_link_nonexistent_noop() {
        let dir = create_workspace();
        let layout = super::CardboxLayout {
            version: 2,
            order: vec![],
            links: vec![super::normalize_link("uuid-a", "uuid-b")],
            ..Default::default()

        };
        write_layout(dir.path(), &layout);

        let mut layout = read_layout(dir.path());
        let target = super::normalize_link("uuid-x", "uuid-y");
        let before = layout.links.len();
        layout.links.retain(|p| *p != target);
        assert_eq!(layout.links.len(), before);
    }

    #[test]
    fn read_layout_prunes_stale_links() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "<!--- n: _ | note1 --->");
        write_md(dir.path(), "b.md", "<!--- n: _ | note2 --->");
        let gi = GraphIndex::build(dir.path().to_path_buf(), &AnnotationIndexOpts::default()).unwrap();
        let anns = gi.list_all_cardbox_annotations().unwrap();
        assert_eq!(anns.len(), 2);
        let uuid_a = anns[0].uuid.clone();
        let uuid_b = anns[1].uuid.clone();

        let layout = super::CardboxLayout {
            version: 2,
            order: vec![uuid_a.clone(), uuid_b.clone()],
            links: vec![
                super::normalize_link(&uuid_a, &uuid_b),
                super::normalize_link(&uuid_a, "stale-uuid"),
            ],
            ..Default::default()

        };
        write_layout(dir.path(), &layout);

        let mut layout = read_layout(dir.path());
        let valid_uuids: std::collections::HashSet<&str> = anns.iter().map(|a| a.uuid.as_str()).collect();
        layout.links.retain(|pair| {
            valid_uuids.contains(pair[0].as_str()) && valid_uuids.contains(pair[1].as_str())
        });

        assert_eq!(layout.links.len(), 1);
        assert_eq!(layout.links[0], super::normalize_link(&uuid_a, &uuid_b));
    }

    #[test]
    fn read_layout_preserves_valid_links() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "<!--- n: _ | note1 --->");
        write_md(dir.path(), "b.md", "<!--- n: _ | note2 --->");
        let gi = GraphIndex::build(dir.path().to_path_buf(), &AnnotationIndexOpts::default()).unwrap();
        let anns = gi.list_all_cardbox_annotations().unwrap();
        let uuid_a = anns[0].uuid.clone();
        let uuid_b = anns[1].uuid.clone();

        let link = super::normalize_link(&uuid_a, &uuid_b);
        let layout = super::CardboxLayout {
            version: 2,
            order: vec![uuid_a.clone(), uuid_b.clone()],
            links: vec![link.clone()],
            ..Default::default()

        };
        write_layout(dir.path(), &layout);

        let mut layout = read_layout(dir.path());
        let valid_uuids: std::collections::HashSet<&str> = anns.iter().map(|a| a.uuid.as_str()).collect();
        layout.links.retain(|pair| {
            valid_uuids.contains(pair[0].as_str()) && valid_uuids.contains(pair[1].as_str())
        });

        assert_eq!(layout.links, vec![link]);
    }

    #[test]
    fn v1_file_reads_with_empty_links() {
        let dir = create_workspace();
        let lit_dir = dir.path().join(".lit");
        std::fs::create_dir_all(&lit_dir).unwrap();
        let v1_json = r#"{"version":1,"order":["uuid-1","uuid-2"]}"#;
        std::fs::write(lit_dir.join("cardbox.json"), v1_json).unwrap();

        let layout: super::CardboxLayout = serde_json::from_str(v1_json).unwrap();
        assert_eq!(layout.version, 1);
        assert_eq!(layout.order, vec!["uuid-1", "uuid-2"]);
        assert!(layout.links.is_empty());
    }

    #[test]
    fn write_v2_roundtrip() {
        let dir = create_workspace();
        let layout = super::CardboxLayout {
            version: 2,
            order: vec!["uuid-1".into(), "uuid-2".into()],
            links: vec![
                super::normalize_link("uuid-1", "uuid-2"),
            ],
            ..Default::default()

        };
        write_layout(dir.path(), &layout);

        let result = read_layout(dir.path());
        assert_eq!(result, layout);
    }

    // ---- Phase A1: GroupInfo and groups tests ----

    #[test]
    fn v2_file_deserializes_with_empty_groups() {
        // A v2-format JSON (no "groups" key) should deserialize with empty groups
        let json = r#"{"version":2,"order":["uuid-1"],"links":[["a","b"]]}"#;
        let layout: super::CardboxLayout = serde_json::from_str(json).unwrap();
        assert_eq!(layout.version, 2);
        assert_eq!(layout.order, vec!["uuid-1"]);
        assert!(layout.groups.is_empty());
    }

    #[test]
    fn group_info_serde_roundtrip() {
        let group = super::GroupInfo {
            name: "My Group".to_string(),
            order: vec!["a".into(), "b".into()],
            collapsed: false,
        };
        let json = serde_json::to_string(&group).unwrap();
        let deserialized: super::GroupInfo = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized, group);
    }

    #[test]
    fn v3_roundtrip_with_groups() {
        let dir = create_workspace();
        let mut groups = HashMap::new();
        groups.insert("g1".to_string(), super::GroupInfo {
            name: "Group One".to_string(),
            order: vec!["uuid-a".into(), "uuid-b".into()],
            collapsed: false,
        });
        let layout = super::CardboxLayout {
            version: 1,
            order: vec!["group:g1".into(), "uuid-c".into()],
            links: vec![],
            groups,
            pinned: vec![],
            notes: HashMap::new(),
            colors: HashMap::new(),
        };
        write_layout(dir.path(), &layout);
        let result = read_layout(dir.path());
        assert_eq!(result, layout);
    }

    #[test]
    fn groups_collapsed_roundtrip() {
        let mut groups = HashMap::new();
        groups.insert("g1".to_string(), super::GroupInfo {
            name: "Collapsed Group".to_string(),
            order: vec!["x".into()],
            collapsed: true,
        });
        let layout = super::CardboxLayout {
            version: 1,
            order: vec!["group:g1".into()],
            links: vec![],
            groups,
            pinned: vec![],
            notes: HashMap::new(),
            colors: HashMap::new(),
        };
        let json = serde_json::to_string(&layout).unwrap();
        let deserialized: super::CardboxLayout = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.groups["g1"].collapsed, true);
    }

    #[test]
    fn group_member_pruning_removes_stale_uuids() {
        let mut groups = HashMap::new();
        groups.insert("g1".to_string(), super::GroupInfo {
            name: "G1".to_string(),
            order: vec!["valid-1".into(), "stale-1".into(), "valid-2".into()],
            collapsed: false,
        });
        let mut layout = super::CardboxLayout {
            version: 1,
            order: vec!["group:g1".into()],
            links: vec![],
            groups,
            pinned: vec![],
            notes: HashMap::new(),
            colors: HashMap::new(),
        };

        let valid: std::collections::HashSet<&str> = ["valid-1", "valid-2"].iter().copied().collect();
        super::prune_layout(&mut layout, &valid);

        assert_eq!(layout.groups["g1"].order, vec!["valid-1", "valid-2"]);
    }

    #[test]
    fn empty_group_removed_after_pruning() {
        let mut groups = HashMap::new();
        groups.insert("g1".to_string(), super::GroupInfo {
            name: "Doomed".to_string(),
            order: vec!["stale-only".into()],
            collapsed: false,
        });
        let mut layout = super::CardboxLayout {
            version: 1,
            order: vec!["group:g1".into(), "valid-1".into()],
            links: vec![],
            groups,
            pinned: vec![],
            notes: HashMap::new(),
            colors: HashMap::new(),
        };

        let valid: std::collections::HashSet<&str> = ["valid-1"].iter().copied().collect();
        super::prune_layout(&mut layout, &valid);

        assert!(layout.groups.is_empty(), "empty group should be removed");
        assert!(!layout.order.contains(&"group:g1".to_string()), "group:g1 entry should be removed from order");
        assert_eq!(layout.order, vec!["valid-1"]);
    }

    #[test]
    fn group_entries_survive_uuid_pruning() {
        let mut groups = HashMap::new();
        groups.insert("g1".to_string(), super::GroupInfo {
            name: "G1".to_string(),
            order: vec!["uuid-a".into()],
            collapsed: false,
        });
        let mut layout = super::CardboxLayout {
            version: 1,
            order: vec!["uuid-1".into(), "group:g1".into(), "uuid-2".into()],
            links: vec![],
            groups,
            pinned: vec![],
            notes: HashMap::new(),
            colors: HashMap::new(),
        };

        let valid: std::collections::HashSet<&str> = ["uuid-1", "uuid-2", "uuid-a"].iter().copied().collect();
        super::prune_layout(&mut layout, &valid);

        assert!(layout.order.contains(&"group:g1".to_string()), "group:g1 must survive pruning");
        assert!(layout.order.contains(&"uuid-1".to_string()));
        assert!(layout.order.contains(&"uuid-2".to_string()));
    }

    #[test]
    fn dedup_uuid_in_group_and_toplevel() {
        let mut groups = HashMap::new();
        groups.insert("g1".to_string(), super::GroupInfo {
            name: "G1".to_string(),
            order: vec!["uuid-dup".into()],
            collapsed: false,
        });
        // uuid-dup appears both at top-level and inside g1
        let mut layout = super::CardboxLayout {
            version: 1,
            order: vec!["uuid-dup".into(), "group:g1".into(), "uuid-solo".into()],
            links: vec![],
            groups,
            pinned: vec![],
            notes: HashMap::new(),
            colors: HashMap::new(),
        };

        let valid: std::collections::HashSet<&str> = ["uuid-dup", "uuid-solo"].iter().copied().collect();
        super::prune_layout(&mut layout, &valid);

        // uuid-dup should be removed from top-level (it's in a group)
        let top_uuids: Vec<&str> = layout.order.iter()
            .filter(|e| !e.starts_with("group:"))
            .map(|s| s.as_str())
            .collect();
        assert!(!top_uuids.contains(&"uuid-dup"), "uuid-dup should not be in top-level order");
        assert!(top_uuids.contains(&"uuid-solo"));
        // group:g1 and uuid-solo remain
        assert!(layout.order.contains(&"group:g1".to_string()));
    }

    #[test]
    fn orphan_group_ref_cleaned_up() {
        // "group:nonexistent" in top-level order but no matching group in map
        let mut layout = super::CardboxLayout {
            version: 1,
            order: vec!["uuid-1".into(), "group:nonexistent".into()],
            links: vec![],
            groups: HashMap::new(),
            pinned: vec![],
            notes: HashMap::new(),
            colors: HashMap::new(),
        };

        let valid: std::collections::HashSet<&str> = ["uuid-1"].iter().copied().collect();
        super::prune_layout(&mut layout, &valid);

        assert!(!layout.order.contains(&"group:nonexistent".to_string()));
        assert_eq!(layout.order, vec!["uuid-1"]);
    }

    #[test]
    fn multiple_groups_mixed_pruning() {
        let mut groups = HashMap::new();
        groups.insert("ga".to_string(), super::GroupInfo {
            name: "Group A".to_string(),
            order: vec!["valid-1".into(), "stale-1".into()],
            collapsed: false,
        });
        groups.insert("gb".to_string(), super::GroupInfo {
            name: "Group B".to_string(),
            order: vec!["stale-2".into(), "stale-3".into()],
            collapsed: false,
        });
        let mut layout = super::CardboxLayout {
            version: 1,
            order: vec!["group:ga".into(), "group:gb".into(), "valid-2".into()],
            links: vec![],
            groups,
            pinned: vec![],
            notes: HashMap::new(),
            colors: HashMap::new(),
        };

        let valid: std::collections::HashSet<&str> = ["valid-1", "valid-2"].iter().copied().collect();
        super::prune_layout(&mut layout, &valid);

        // Group A survives with 1 member
        assert_eq!(layout.groups.len(), 1);
        assert_eq!(layout.groups["ga"].order, vec!["valid-1"]);
        // Group B removed (all stale)
        assert!(!layout.groups.contains_key("gb"));
        // Top-level: group:ga stays, group:gb removed, valid-2 stays
        assert_eq!(layout.order, vec!["group:ga".to_string(), "valid-2".to_string()]);
    }

    #[test]
    fn pruning_preserves_group_internal_order() {
        let mut groups = HashMap::new();
        groups.insert("g1".to_string(), super::GroupInfo {
            name: "G1".to_string(),
            order: vec!["c".into(), "a".into(), "b".into()],
            collapsed: false,
        });
        let mut layout = super::CardboxLayout {
            version: 1,
            order: vec!["group:g1".into()],
            links: vec![],
            groups,
            pinned: vec![],
            notes: HashMap::new(),
            colors: HashMap::new(),
        };

        let valid: std::collections::HashSet<&str> = ["a", "b", "c"].iter().copied().collect();
        super::prune_layout(&mut layout, &valid);

        assert_eq!(layout.groups["g1"].order, vec!["c", "a", "b"]);
    }

    #[test]
    fn empty_groups_map_roundtrip() {
        let dir = create_workspace();
        let layout = super::CardboxLayout {
            version: 1,
            order: vec!["uuid-1".into()],
            links: vec![],
            groups: HashMap::new(),
            pinned: vec![],
            notes: HashMap::new(),
            colors: HashMap::new(),
        };
        write_layout(dir.path(), &layout);
        let result = read_layout(dir.path());
        assert!(result.groups.is_empty());
        assert_eq!(result, layout);
    }

    // ---- Phase A2: CRUD group command tests ----

    #[test]
    fn create_group_basic() {
        let dir = create_workspace();
        let layout = super::CardboxLayout {
            version: 1,
            order: vec!["a".into(), "b".into(), "c".into()],
            links: vec![],
            groups: HashMap::new(),
            pinned: vec![],
            notes: HashMap::new(),
            colors: HashMap::new(),
        };
        write_layout(dir.path(), &layout);

        let mut layout = read_layout(dir.path());
        super::do_create_group(
            &mut layout,
            "g1".to_string(),
            "G1".to_string(),
            vec!["a".to_string(), "c".to_string()],
            None,
        );
        write_layout(dir.path(), &layout);

        let result = read_layout(dir.path());
        assert_eq!(result.order, vec!["b", "group:g1"]);
        assert_eq!(result.groups["g1"].order, vec!["a", "c"]);
        assert_eq!(result.groups["g1"].name, "G1");
        assert!(!result.groups["g1"].collapsed);
        assert_eq!(result.version, 3);
    }

    #[test]
    fn create_group_with_after_entry() {
        let dir = create_workspace();
        let layout = super::CardboxLayout {
            version: 1,
            order: vec!["a".into(), "b".into(), "c".into()],
            links: vec![],
            groups: HashMap::new(),
            pinned: vec![],
            notes: HashMap::new(),
            colors: HashMap::new(),
        };
        write_layout(dir.path(), &layout);

        let mut layout = read_layout(dir.path());
        super::do_create_group(
            &mut layout,
            "g1".to_string(),
            "G1".to_string(),
            vec!["c".to_string()],
            Some("a".to_string()),
        );
        write_layout(dir.path(), &layout);

        let result = read_layout(dir.path());
        assert_eq!(result.order, vec!["a", "group:g1", "b"]);
    }

    #[test]
    fn create_group_after_entry_stable_when_cards_removed() {
        // Regression: do_create_group used to find after_entry position AFTER
        // removing card_uuids from order, causing the insertion point to shift.
        // order=['a','b','c','d'], card_uuids=['a','c'], after_entry='b'
        // Expected: group appears after 'b', result is ['b', 'group:g1', 'd']
        let mut layout = super::CardboxLayout {
            version: 1,
            order: vec!["a".into(), "b".into(), "c".into(), "d".into()],
            links: vec![],
            groups: HashMap::new(),
            pinned: vec![],
            notes: HashMap::new(),
            colors: HashMap::new(),
        };

        super::do_create_group(
            &mut layout,
            "g1".to_string(),
            "G1".to_string(),
            vec!["a".to_string(), "c".to_string()],
            Some("b".to_string()),
        );

        assert_eq!(layout.order, vec!["b", "group:g1", "d"]);
        assert_eq!(layout.groups["g1"].order, vec!["a", "c"]);
    }

    #[test]
    fn create_group_at_end_without_after() {
        let dir = create_workspace();
        let layout = super::CardboxLayout {
            version: 1,
            order: vec!["a".into(), "b".into()],
            links: vec![],
            groups: HashMap::new(),
            pinned: vec![],
            notes: HashMap::new(),
            colors: HashMap::new(),
        };
        write_layout(dir.path(), &layout);

        let mut layout = read_layout(dir.path());
        super::do_create_group(
            &mut layout,
            "g1".to_string(),
            "G1".to_string(),
            vec![],
            None,
        );
        write_layout(dir.path(), &layout);

        let result = read_layout(dir.path());
        assert_eq!(result.order, vec!["a", "b", "group:g1"]);
        assert!(result.groups["g1"].order.is_empty());
    }

    #[test]
    fn rename_group_updates_name() {
        let dir = create_workspace();
        let mut groups = HashMap::new();
        groups.insert("g1".to_string(), super::GroupInfo {
            name: "Old Name".to_string(),
            order: vec!["a".into()],
            collapsed: false,
        });
        let layout = super::CardboxLayout {
            version: 3,
            order: vec!["group:g1".into()],
            links: vec![],
            groups,
            pinned: vec![],
            notes: HashMap::new(),
            colors: HashMap::new(),
        };
        write_layout(dir.path(), &layout);

        let mut layout = read_layout(dir.path());
        super::do_rename_group(&mut layout, "g1", "New Name".to_string()).unwrap();
        write_layout(dir.path(), &layout);

        let result = read_layout(dir.path());
        assert_eq!(result.groups["g1"].name, "New Name");
    }

    #[test]
    fn rename_nonexistent_group_errors() {
        let mut layout = super::CardboxLayout::default();
        let result = super::do_rename_group(&mut layout, "nonexistent", "Name".to_string());
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("does not exist"));
    }

    #[test]
    fn dissolve_group_splices_members() {
        let dir = create_workspace();
        let mut groups = HashMap::new();
        groups.insert("g1".to_string(), super::GroupInfo {
            name: "G1".to_string(),
            order: vec!["x".into(), "y".into()],
            collapsed: false,
        });
        let layout = super::CardboxLayout {
            version: 3,
            order: vec!["a".into(), "group:g1".into(), "b".into()],
            links: vec![],
            groups,
            pinned: vec![],
            notes: HashMap::new(),
            colors: HashMap::new(),
        };
        write_layout(dir.path(), &layout);

        let mut layout = read_layout(dir.path());
        super::do_dissolve_group(&mut layout, "g1").unwrap();
        write_layout(dir.path(), &layout);

        let result = read_layout(dir.path());
        assert_eq!(result.order, vec!["a", "x", "y", "b"]);
        assert!(!result.groups.contains_key("g1"));
    }

    #[test]
    fn dissolve_group_recovers_members_when_entry_missing() {
        // Simulate corrupted layout: group exists in map but "group:g1" is missing from order.
        let mut groups = HashMap::new();
        groups.insert("g1".to_string(), super::GroupInfo {
            name: "G1".to_string(),
            order: vec!["x".into(), "y".into()],
            collapsed: false,
        });
        let mut layout = super::CardboxLayout {
            version: 3,
            // Note: no "group:g1" entry — only plain cards
            order: vec!["a".into(), "b".into()],
            links: vec![],
            groups,
            pinned: vec![],
            notes: HashMap::new(),
            colors: HashMap::new(),
        };

        super::do_dissolve_group(&mut layout, "g1").unwrap();

        // Group should be removed from the map
        assert!(!layout.groups.contains_key("g1"));
        // Members should appear at the end of order (not lost)
        assert_eq!(layout.order, vec!["a", "b", "x", "y"]);
    }

    #[test]
    fn move_card_to_group_from_toplevel() {
        let dir = create_workspace();
        let mut groups = HashMap::new();
        groups.insert("g1".to_string(), super::GroupInfo {
            name: "G1".to_string(),
            order: vec!["x".into()],
            collapsed: false,
        });
        let layout = super::CardboxLayout {
            version: 3,
            order: vec!["a".into(), "group:g1".into(), "b".into()],
            links: vec![],
            groups,
            pinned: vec![],
            notes: HashMap::new(),
            colors: HashMap::new(),
        };
        write_layout(dir.path(), &layout);

        let mut layout = read_layout(dir.path());
        super::do_move_card_to_group(&mut layout, "b".to_string(), "g1", None).unwrap();
        write_layout(dir.path(), &layout);

        let result = read_layout(dir.path());
        assert_eq!(result.order, vec!["a", "group:g1"]);
        assert_eq!(result.groups["g1"].order, vec!["x", "b"]);
    }

    #[test]
    fn move_card_between_groups() {
        let dir = create_workspace();
        let mut groups = HashMap::new();
        groups.insert("g1".to_string(), super::GroupInfo {
            name: "G1".to_string(),
            order: vec!["a".into(), "b".into()],
            collapsed: false,
        });
        groups.insert("g2".to_string(), super::GroupInfo {
            name: "G2".to_string(),
            order: vec!["c".into()],
            collapsed: false,
        });
        let layout = super::CardboxLayout {
            version: 3,
            order: vec!["group:g1".into(), "group:g2".into()],
            links: vec![],
            groups,
            pinned: vec![],
            notes: HashMap::new(),
            colors: HashMap::new(),
        };
        write_layout(dir.path(), &layout);

        let mut layout = read_layout(dir.path());
        super::do_move_card_to_group(&mut layout, "b".to_string(), "g2", Some(0)).unwrap();
        write_layout(dir.path(), &layout);

        let result = read_layout(dir.path());
        assert_eq!(result.groups["g1"].order, vec!["a"]);
        assert_eq!(result.groups["g2"].order, vec!["b", "c"]);
    }

    #[test]
    fn remove_card_from_group_to_toplevel() {
        let dir = create_workspace();
        let mut groups = HashMap::new();
        groups.insert("g1".to_string(), super::GroupInfo {
            name: "G1".to_string(),
            order: vec!["a".into(), "b".into()],
            collapsed: false,
        });
        let layout = super::CardboxLayout {
            version: 3,
            order: vec!["group:g1".into(), "z".into()],
            links: vec![],
            groups,
            pinned: vec![],
            notes: HashMap::new(),
            colors: HashMap::new(),
        };
        write_layout(dir.path(), &layout);

        let mut layout = read_layout(dir.path());
        super::do_remove_card_from_group(&mut layout, "a".to_string(), "g1", None).unwrap();
        write_layout(dir.path(), &layout);

        let result = read_layout(dir.path());
        assert_eq!(result.groups["g1"].order, vec!["b"]);
        assert_eq!(result.order, vec!["group:g1", "z", "a"]);
    }

    #[test]
    fn remove_card_auto_dissolves_empty_group() {
        let dir = create_workspace();
        let mut groups = HashMap::new();
        groups.insert("g1".to_string(), super::GroupInfo {
            name: "G1".to_string(),
            order: vec!["a".into()],
            collapsed: false,
        });
        let layout = super::CardboxLayout {
            version: 3,
            order: vec!["z".into(), "group:g1".into()],
            links: vec![],
            groups,
            pinned: vec![],
            notes: HashMap::new(),
            colors: HashMap::new(),
        };
        write_layout(dir.path(), &layout);

        let mut layout = read_layout(dir.path());
        super::do_remove_card_from_group(&mut layout, "a".to_string(), "g1", None).unwrap();
        write_layout(dir.path(), &layout);

        let result = read_layout(dir.path());
        assert!(!result.groups.contains_key("g1"));
        assert!(!result.order.contains(&"group:g1".to_string()));
        assert_eq!(result.order, vec!["z", "a"]);
    }

    #[test]
    fn toggle_collapsed() {
        let dir = create_workspace();
        let mut groups = HashMap::new();
        groups.insert("g1".to_string(), super::GroupInfo {
            name: "G1".to_string(),
            order: vec!["a".into()],
            collapsed: false,
        });
        let layout = super::CardboxLayout {
            version: 3,
            order: vec!["group:g1".into()],
            links: vec![],
            groups,
            pinned: vec![],
            notes: HashMap::new(),
            colors: HashMap::new(),
        };
        write_layout(dir.path(), &layout);

        let mut layout = read_layout(dir.path());
        super::do_toggle_group_collapsed(&mut layout, "g1", true).unwrap();
        write_layout(dir.path(), &layout);

        let result = read_layout(dir.path());
        assert!(result.groups["g1"].collapsed);

        // Toggle back
        let mut layout = result;
        super::do_toggle_group_collapsed(&mut layout, "g1", false).unwrap();
        write_layout(dir.path(), &layout);

        let result2 = read_layout(dir.path());
        assert!(!result2.groups["g1"].collapsed);
    }

    #[test]
    fn create_group_replaces_existing_group() {
        let mut layout = super::CardboxLayout {
            version: 1,
            order: vec!["a".into(), "b".into(), "c".into(), "d".into()],
            links: vec![],
            groups: HashMap::new(),
            pinned: vec![],
            notes: HashMap::new(),
            colors: HashMap::new(),
        };

        // First creation: group g1 with cards [a, b]
        super::do_create_group(
            &mut layout,
            "g1".to_string(),
            "First".to_string(),
            vec!["a".to_string(), "b".to_string()],
            None,
        );
        assert_eq!(layout.groups["g1"].order, vec!["a", "b"]);
        assert_eq!(layout.groups["g1"].name, "First");

        // Second creation with same id but different cards [c, d]
        super::do_create_group(
            &mut layout,
            "g1".to_string(),
            "Replaced".to_string(),
            vec!["c".to_string(), "d".to_string()],
            None,
        );

        // Only one "group:g1" entry in order
        let group_entries: Vec<&String> = layout.order.iter()
            .filter(|e| *e == "group:g1")
            .collect();
        assert_eq!(group_entries.len(), 1, "must have exactly one group:g1 in order");

        // The group has the new cards and name
        assert_eq!(layout.groups["g1"].order, vec!["c", "d"]);
        assert_eq!(layout.groups["g1"].name, "Replaced");
        assert_eq!(layout.groups.len(), 1);
    }

    // ---- Pinning tests ----

    #[test]
    fn pin_adds_to_pinned() {
        let dir = create_workspace();
        let layout = super::CardboxLayout {
            pinned: vec![],
            ..Default::default()
        };
        write_layout(dir.path(), &layout);

        let mut layout = read_layout(dir.path());
        layout.pinned.push("uuid-x".into());
        layout.version = 3;
        write_layout(dir.path(), &layout);

        let result = read_layout(dir.path());
        assert_eq!(result.pinned, vec!["uuid-x"]);
        assert_eq!(result.version, 3);
    }

    #[test]
    fn pin_idempotent() {
        let dir = create_workspace();
        let layout = super::CardboxLayout {
            version: 3,
            pinned: vec!["uuid-x".into()],
            ..Default::default()
        };
        write_layout(dir.path(), &layout);

        let mut layout = read_layout(dir.path());
        if !layout.pinned.contains(&"uuid-x".to_string()) {
            layout.pinned.push("uuid-x".into());
        }
        write_layout(dir.path(), &layout);

        let result = read_layout(dir.path());
        assert_eq!(result.pinned.len(), 1);
    }

    #[test]
    fn unpin_removes() {
        let dir = create_workspace();
        let layout = super::CardboxLayout {
            version: 3,
            pinned: vec!["uuid-x".into(), "uuid-y".into()],
            ..Default::default()
        };
        write_layout(dir.path(), &layout);

        let mut layout = read_layout(dir.path());
        layout.pinned.retain(|u| u != "uuid-x");
        write_layout(dir.path(), &layout);

        let result = read_layout(dir.path());
        assert_eq!(result.pinned, vec!["uuid-y"]);
    }

    #[test]
    fn unpin_nonexistent_noop() {
        let dir = create_workspace();
        let layout = super::CardboxLayout {
            version: 3,
            pinned: vec!["uuid-x".into()],
            ..Default::default()
        };
        write_layout(dir.path(), &layout);

        let layout = read_layout(dir.path());
        let before = layout.pinned.len();
        let mut pinned = layout.pinned.clone();
        pinned.retain(|u| u != "uuid-z");
        assert_eq!(pinned.len(), before);
    }

    #[test]
    fn read_layout_prunes_stale_pinned() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "<!--- n: _ | note1 --->");
        let gi = GraphIndex::build(dir.path().to_path_buf(), &AnnotationIndexOpts::default()).unwrap();
        let anns = gi.list_all_cardbox_annotations().unwrap();
        assert_eq!(anns.len(), 1);
        let real_uuid = anns[0].uuid.clone();

        let layout = super::CardboxLayout {
            version: 3,
            order: vec![real_uuid.clone()],
            pinned: vec!["stale-uuid".into(), real_uuid.clone()],
            ..Default::default()
        };
        write_layout(dir.path(), &layout);

        let mut layout = read_layout(dir.path());
        let valid_uuids: std::collections::HashSet<&str> = anns.iter().map(|a| a.uuid.as_str()).collect();
        layout.pinned.retain(|u| valid_uuids.contains(u.as_str()));

        assert_eq!(layout.pinned, vec![real_uuid]);
    }

    #[test]
    fn v2_file_reads_with_empty_pinned() {
        let dir = create_workspace();
        let lit_dir = dir.path().join(".lit");
        std::fs::create_dir_all(&lit_dir).unwrap();
        let v2_json = r#"{"version":2,"order":["uuid-1"],"links":[]}"#;
        std::fs::write(lit_dir.join("cardbox.json"), v2_json).unwrap();

        let layout: super::CardboxLayout = serde_json::from_str(v2_json).unwrap();
        assert_eq!(layout.version, 2);
        assert_eq!(layout.order, vec!["uuid-1"]);
        assert!(layout.links.is_empty());
        assert!(layout.pinned.is_empty());
    }

    #[test]
    fn write_v3_roundtrip() {
        let dir = create_workspace();
        let layout = super::CardboxLayout {
            version: 3,
            order: vec!["uuid-1".into(), "uuid-2".into()],
            links: vec![super::normalize_link("uuid-1", "uuid-2")],
            pinned: vec!["uuid-1".into()],
            ..Default::default()
        };
        write_layout(dir.path(), &layout);

        let result = read_layout(dir.path());
        assert_eq!(result, layout);
    }

    // ---- K1: read path derives notes purely from sn ----

    #[test]
    fn read_layout_json_only_note_not_displayed_disk_untouched() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "Text <!---[p1] n: \\s | Parent ---> end.");
        let gi = GraphIndex::build(dir.path().to_path_buf(), &AnnotationIndexOpts::default()).unwrap();

        let mut layout = super::CardboxLayout {
            version: 4,
            order: vec!["p1".to_string()],
            ..Default::default()
        };
        layout.notes.insert("p1".into(), CardNote {
            body: "JSON-only legacy note".into(),
            updated_at: None,
        });
        write_layout(dir.path(), &layout);

        let response = super::do_read_cardbox_layout(dir.path(), &gi).unwrap();
        assert!(!response.notes.contains_key("p1"),
            "JSON-only entries must not be displayed: {:?}", response.notes);

        let on_disk = read_layout(dir.path());
        assert_eq!(on_disk.notes.get("p1").unwrap().body, "JSON-only legacy note",
            "read must leave disk notes untouched");
    }

    #[test]
    fn read_layout_sn_note_wins_over_json_entry() {
        let dir = create_workspace();
        write_md(
            dir.path(),
            "a.md",
            concat!(
                "Text <!---[p1] n: \\s | Parent ---> more.\n\n",
                "<!---[sn1] sn: ^\"p1\" | Live sn body @2026-07-28 --->\n",
            ),
        );
        let gi = GraphIndex::build(dir.path().to_path_buf(), &AnnotationIndexOpts::default()).unwrap();

        let mut layout = super::CardboxLayout {
            version: 4,
            order: vec!["p1".to_string()],
            ..Default::default()
        };
        layout.notes.insert("p1".into(), CardNote {
            body: "stale JSON body".into(),
            updated_at: None,
        });
        write_layout(dir.path(), &layout);

        let response = super::do_read_cardbox_layout(dir.path(), &gi).unwrap();
        assert_eq!(response.notes.get("p1").unwrap().body, "Live sn body",
            "sn body must win: {:?}", response.notes);
    }

    #[test]
    fn read_layout_dead_parent_note_survives_read() {
        // Pruning of dead-parent legacy entries is migrate's job, not read's.
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "<!--- n: _ | note --->");
        let gi = GraphIndex::build(dir.path().to_path_buf(), &AnnotationIndexOpts::default()).unwrap();

        let mut layout = super::CardboxLayout::default();
        layout.notes.insert("stale-uuid".into(), CardNote {
            body: "stale note".into(),
            updated_at: None,
        });
        write_layout(dir.path(), &layout);

        let response = super::do_read_cardbox_layout(dir.path(), &gi).unwrap();
        assert!(!response.notes.contains_key("stale-uuid"));

        let on_disk = read_layout(dir.path());
        assert!(on_disk.notes.contains_key("stale-uuid"),
            "read must not prune legacy notes from disk: {:?}", on_disk.notes);
    }

    #[test]
    fn read_layout_structural_persist_preserves_disk_notes() {
        // A structural prune (stale uuid in order) triggers the dirty persist;
        // the persisted file must still carry the legacy notes verbatim.
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "Text <!---[p1] n: \\s | Parent ---> end.");
        let gi = GraphIndex::build(dir.path().to_path_buf(), &AnnotationIndexOpts::default()).unwrap();

        let mut layout = super::CardboxLayout {
            version: 4,
            order: vec!["p1".to_string(), "stale-uuid".to_string()],
            ..Default::default()
        };
        layout.notes.insert("legacy-key".into(), CardNote {
            body: "legacy body".into(),
            updated_at: Some("2026-01-01T00:00:00Z".into()),
        });
        write_layout(dir.path(), &layout);

        let response = super::do_read_cardbox_layout(dir.path(), &gi).unwrap();
        assert_eq!(response.order, vec!["p1"], "structural prune should apply");

        let on_disk = read_layout(dir.path());
        assert_eq!(on_disk.order, vec!["p1"], "prune persisted");
        let note = on_disk.notes.get("legacy-key").expect("legacy note survives persist");
        assert_eq!(note.body, "legacy body");
        assert_eq!(note.updated_at.as_deref(), Some("2026-01-01T00:00:00Z"));
    }

    #[test]
    fn test_v3_layout_deserializes_with_empty_notes() {
        let json = r#"{"version":3,"order":["uuid-1"],"links":[],"groups":{},"pinned":["uuid-1"]}"#;
        let layout: super::CardboxLayout = serde_json::from_str(json).unwrap();
        assert_eq!(layout.version, 3);
        assert!(layout.notes.is_empty());
    }

    #[test]
    fn multiline_blockquote_all_lines_prefixed() {
        // Test the shared blockquote helper
        let original = "First line\nSecond line\nThird line";
        let blockquoted = super::blockquote(original);
        let content = format!("{}\n\n", blockquoted);
        // Every non-empty line must start with "> "
        for line in content.trim().lines() {
            assert!(
                line.starts_with("> "),
                "Line missing blockquote prefix: {:?}",
                line
            );
        }
        assert_eq!(content, "> First line\n> Second line\n> Third line\n\n");
    }

    #[test]
    fn sanitize_filename_preserves_spaces() {
        // Spaces are valid in filenames and must not be replaced with underscores.
        let result = super::sanitize_filename("Note on My Page Title");
        assert_eq!(result, "Note on My Page Title");
    }

    #[test]
    fn sanitize_filename_replaces_forbidden_chars() {
        // All filesystem-forbidden characters should become underscores.
        let result = super::sanitize_filename("a/b\\c:d*e?f\"g<h>i|j");
        assert_eq!(result, "a_b_c_d_e_f_g_h_i_j");
    }

    #[test]
    fn sanitize_filename_mixed_spaces_and_forbidden() {
        // Spaces stay, forbidden chars become underscores.
        let result = super::sanitize_filename("My File: a <test>");
        assert_eq!(result, "My File_ a _test_");
    }

    #[test]
    fn yaml_frontmatter_escapes_double_quotes() {
        let source_page_id = "He said \"hello\".md";
        let line = format!("source: \"{}\"\n", super::escape_yaml_double_quoted(source_page_id));
        assert_eq!(line, "source: \"He said \\\"hello\\\".md\"\n");
        // The YAML value must not contain unescaped double quotes
        // between the outer delimiters
        let inner = &line["source: \"".len()..line.len() - "\"\n".len()];
        let mut prev = None;
        for c in inner.chars() {
            if c == '"' {
                assert_eq!(prev, Some('\\'), "Found unescaped double quote in YAML value");
            }
            prev = Some(c);
        }
    }

    #[test]
    fn yaml_frontmatter_escapes_backslashes() {
        let val = "path\\to\\file.md";
        let escaped = super::escape_yaml_double_quoted(val);
        assert_eq!(escaped, "path\\\\to\\\\file.md");
    }

    #[test]
    fn escape_yaml_newline_is_escaped() {
        let input = "line one\nline two";
        let escaped = super::escape_yaml_double_quoted(input);
        assert_eq!(escaped, "line one\\nline two");
        assert!(!escaped.contains('\n'), "literal newline must not survive escaping");
    }

    #[test]
    fn escape_yaml_cr_tab_null_escaped() {
        assert_eq!(super::escape_yaml_double_quoted("a\rb"), "a\\rb");
        assert_eq!(super::escape_yaml_double_quoted("a\tb"), "a\\tb");
        assert_eq!(super::escape_yaml_double_quoted("a\0b"), "a\\0b");
    }

    #[test]
    fn escape_yaml_mixed_special_chars() {
        let input = "He said \"hello\"\npath\\to\\file\ttab\0end";
        let escaped = super::escape_yaml_double_quoted(input);
        assert_eq!(
            escaped,
            "He said \\\"hello\\\"\\npath\\\\to\\\\file\\ttab\\0end"
        );
    }

    #[test]
    fn blockquote_prefixes_every_line() {
        let original = "First line\nSecond line\nThird line";
        let blockquoted = super::blockquote(original);
        assert_eq!(blockquoted, "> First line\n> Second line\n> Third line");
    }

    #[test]
    fn blockquote_helper_single_line() {
        assert_eq!(super::blockquote("hello"), "> hello");
    }

    #[test]
    fn blockquote_helper_multiline() {
        assert_eq!(
            super::blockquote("First line\nSecond line\nThird line"),
            "> First line\n> Second line\n> Third line"
        );
    }

    #[test]
    fn blockquote_helper_empty_string() {
        // "".lines() yields zero items, so collect+join = ""
        assert_eq!(super::blockquote(""), "");
    }

    #[test]
    fn blockquote_helper_blank_lines_preserved() {
        // Lines with only whitespace should still get the "> " prefix
        assert_eq!(
            super::blockquote("a\n\nb"),
            "> a\n> \n> b"
        );
    }

    // ---- Color tag tests ----

    #[test]
    fn set_card_color_updates_layout() {
        let dir = create_workspace();
        let layout = super::CardboxLayout::default();
        write_layout(dir.path(), &layout);

        let mut layout = read_layout(dir.path());
        layout.colors.insert("uuid-1".into(), "blue".into());
        layout.version = layout.version.max(4);
        write_layout(dir.path(), &layout);

        let result = read_layout(dir.path());
        assert_eq!(result.colors.get("uuid-1").unwrap(), "blue");
        assert_eq!(result.version, 4);
    }

    #[test]
    fn set_card_color_invalid_rejected() {
        assert_eq!(super::VALID_COLORS.len(), 6);
        assert!(super::VALID_COLORS.contains(&"blue"));
        assert!(super::VALID_COLORS.contains(&"orange"));
        assert!(super::VALID_COLORS.contains(&"green"));
        assert!(super::VALID_COLORS.contains(&"purple"));
        assert!(super::VALID_COLORS.contains(&"pink"));
        assert!(super::VALID_COLORS.contains(&"cyan"));
        assert!(!super::VALID_COLORS.contains(&"red"));
        assert!(!super::VALID_COLORS.contains(&"yellow"));
        assert!(!super::VALID_COLORS.contains(&""));
    }

    #[test]
    fn clear_card_color_removes_entry() {
        let dir = create_workspace();
        let mut layout = super::CardboxLayout::default();
        layout.colors.insert("uuid-1".into(), "green".into());
        layout.version = 4;
        write_layout(dir.path(), &layout);

        let mut layout = read_layout(dir.path());
        assert!(layout.colors.contains_key("uuid-1"));
        layout.colors.remove("uuid-1");
        layout.version = layout.version.max(4);
        write_layout(dir.path(), &layout);

        let result = read_layout(dir.path());
        assert!(!result.colors.contains_key("uuid-1"));
    }

    #[test]
    fn clear_card_color_noop_for_absent() {
        let dir = create_workspace();
        let layout = super::CardboxLayout {
            version: 3,
            ..Default::default()
        };
        write_layout(dir.path(), &layout);

        let mut layout = read_layout(dir.path());
        let had_color = layout.colors.remove("nonexistent").is_some();
        assert!(!had_color, "should not have had a color entry");
        // version should not bump
        assert_eq!(layout.version, 3);
    }

    #[test]
    fn prune_removes_stale_colors() {
        let mut layout = super::CardboxLayout {
            version: 4,
            order: vec!["valid-1".into()],
            colors: HashMap::from([
                ("valid-1".into(), "blue".into()),
                ("stale-1".into(), "pink".into()),
            ]),
            ..Default::default()
        };
        let valid: std::collections::HashSet<&str> = ["valid-1"].iter().copied().collect();
        super::prune_layout(&mut layout, &valid);

        assert_eq!(layout.colors.len(), 1);
        assert!(layout.colors.contains_key("valid-1"));
        assert!(!layout.colors.contains_key("stale-1"));
    }

    #[test]
    fn colors_serde_backwards_compat() {
        // Old JSON without colors field should deserialize with empty colors
        let json = r#"{"version":3,"order":["uuid-1"],"links":[],"pinned":[]}"#;
        let layout: super::CardboxLayout = serde_json::from_str(json).unwrap();
        assert!(layout.colors.is_empty());
    }

    #[test]
    fn colors_roundtrip() {
        let dir = create_workspace();
        let mut colors = HashMap::new();
        colors.insert("uuid-1".into(), "blue".into());
        colors.insert("uuid-2".into(), "cyan".into());
        let layout = super::CardboxLayout {
            version: 4,
            order: vec!["uuid-1".into(), "uuid-2".into()],
            colors,
            ..Default::default()
        };
        write_layout(dir.path(), &layout);

        let result = read_layout(dir.path());
        assert_eq!(result, layout);
        assert_eq!(result.colors.len(), 2);
    }

    #[test]
    fn version_max_preserves_higher() {
        // If version is already 5, setting color should not downgrade it
        let dir = create_workspace();
        let mut layout = super::CardboxLayout {
            version: 5,
            ..Default::default()
        };
        layout.colors.insert("uuid-1".into(), "orange".into());
        layout.version = layout.version.max(4);
        write_layout(dir.path(), &layout);

        let result = read_layout(dir.path());
        assert_eq!(result.version, 5);
    }

    // ---- Batch operation tests ----

    #[test]
    fn batch_set_card_color_applies_all() {
        let dir = create_workspace();
        let layout = super::CardboxLayout::default();
        write_layout(dir.path(), &layout);

        let mut layout = read_layout(dir.path());
        let entries = vec![
            ("uuid-1", "blue"),
            ("uuid-2", "green"),
            ("uuid-3", "pink"),
        ];
        for (uuid, color) in &entries {
            assert!(super::VALID_COLORS.contains(color));
            layout.colors.insert(uuid.to_string(), color.to_string());
        }
        layout.version = layout.version.max(4);
        write_layout(dir.path(), &layout);

        let result = read_layout(dir.path());
        assert_eq!(result.colors.get("uuid-1").unwrap(), "blue");
        assert_eq!(result.colors.get("uuid-2").unwrap(), "green");
        assert_eq!(result.colors.get("uuid-3").unwrap(), "pink");
        assert_eq!(result.version, 4);
    }

    #[test]
    fn batch_set_card_color_rejects_invalid() {
        let invalid = "red";
        assert!(!super::VALID_COLORS.contains(&invalid));
    }

    #[test]
    fn batch_clear_card_color_removes_all() {
        let dir = create_workspace();
        let mut layout = super::CardboxLayout::default();
        layout.colors.insert("uuid-1".into(), "blue".into());
        layout.colors.insert("uuid-2".into(), "green".into());
        layout.colors.insert("uuid-3".into(), "pink".into());
        layout.version = 4;
        write_layout(dir.path(), &layout);

        let mut layout = read_layout(dir.path());
        let uuids = vec!["uuid-1", "uuid-2"];
        for uuid in &uuids {
            layout.colors.remove(*uuid);
        }
        write_layout(dir.path(), &layout);

        let result = read_layout(dir.path());
        assert!(!result.colors.contains_key("uuid-1"));
        assert!(!result.colors.contains_key("uuid-2"));
        assert!(result.colors.contains_key("uuid-3")); // untouched
    }

    #[test]
    fn batch_pin_cards_adds_all() {
        let dir = create_workspace();
        let layout = super::CardboxLayout::default();
        write_layout(dir.path(), &layout);

        let mut layout = read_layout(dir.path());
        let uuids = vec!["uuid-a", "uuid-b", "uuid-c"];
        let pinned_set: std::collections::HashSet<String> =
            layout.pinned.iter().cloned().collect();
        let to_add: Vec<String> = uuids.iter()
            .filter(|u| !pinned_set.contains(**u))
            .map(|u| u.to_string())
            .collect();
        layout.pinned.extend(to_add);
        layout.version = layout.version.max(3);
        write_layout(dir.path(), &layout);

        let result = read_layout(dir.path());
        assert_eq!(result.pinned, vec!["uuid-a", "uuid-b", "uuid-c"]);
    }

    #[test]
    fn batch_pin_cards_idempotent() {
        let dir = create_workspace();
        let layout = super::CardboxLayout {
            pinned: vec!["uuid-a".into()],
            version: 3,
            ..Default::default()
        };
        write_layout(dir.path(), &layout);

        let mut layout = read_layout(dir.path());
        let uuids = vec!["uuid-a", "uuid-b"];
        let pinned_set: std::collections::HashSet<String> =
            layout.pinned.iter().cloned().collect();
        let to_add: Vec<String> = uuids.iter()
            .filter(|u| !pinned_set.contains(**u))
            .map(|u| u.to_string())
            .collect();
        layout.pinned.extend(to_add);
        write_layout(dir.path(), &layout);

        let result = read_layout(dir.path());
        assert_eq!(result.pinned.iter().filter(|u| *u == "uuid-a").count(), 1);
        assert!(result.pinned.contains(&"uuid-b".to_string()));
    }

    #[test]
    fn batch_unpin_cards_removes_all() {
        let dir = create_workspace();
        let layout = super::CardboxLayout {
            pinned: vec!["uuid-a".into(), "uuid-b".into(), "uuid-c".into()],
            version: 3,
            ..Default::default()
        };
        write_layout(dir.path(), &layout);

        let mut layout = read_layout(dir.path());
        let remove_set: std::collections::HashSet<&str> = ["uuid-a", "uuid-c"].iter().copied().collect();
        layout.pinned.retain(|u| !remove_set.contains(u.as_str()));
        write_layout(dir.path(), &layout);

        let result = read_layout(dir.path());
        assert_eq!(result.pinned, vec!["uuid-b"]);
    }

    // ---- Concurrency / TOCTOU race tests ----
    //
    // These tests reproduce the read-modify-write races that CardboxLock prevents.
    // Without the lock, concurrent threads doing load → mutate → persist can
    // silently clobber each other's writes. With the lock, every mutation is
    // serialized and all writes survive.

    fn locked_read_modify_write<F>(
        root: &std::path::Path,
        lock: &super::CardboxLock,
        f: F,
    ) where
        F: FnOnce(&mut super::CardboxLayout),
    {
        let _guard = lock.0.lock().unwrap();
        let mut layout = crate::graph::cardbox_layout::load_layout(root);
        f(&mut layout);
        super::persist_layout(&root.join(".lit"), &layout).unwrap();
    }

    #[test]
    fn concurrent_link_adds_no_lost_writes() {
        let dir = create_workspace();
        let lit_dir = dir.path().join(".lit");
        std::fs::create_dir_all(&lit_dir).unwrap();
        write_layout(dir.path(), &super::CardboxLayout::default());

        let lock = std::sync::Arc::new(super::CardboxLock::new());
        let root = dir.path().to_path_buf();
        let n = 50;

        let handles: Vec<_> = (0..n).map(|i| {
            let lock = lock.clone();
            let root = root.clone();
            std::thread::spawn(move || {
                let link = super::normalize_link(
                    &format!("uuid-{i}"),
                    &format!("uuid-{}", i + 1000),
                );
                locked_read_modify_write(&root, &lock, |layout| {
                    if !layout.links.iter().any(|p| *p == link) {
                        layout.links.push(link);
                    }
                    layout.version = layout.version.max(2);
                });
            })
        }).collect();

        for h in handles {
            h.join().unwrap();
        }

        let result = read_layout(dir.path());
        assert_eq!(
            result.links.len(), n,
            "expected {n} links, got {} — writes were lost",
            result.links.len()
        );
    }

    #[test]
    fn concurrent_pin_and_unpin_consistent() {
        let dir = create_workspace();
        let lit_dir = dir.path().join(".lit");
        std::fs::create_dir_all(&lit_dir).unwrap();
        let initial = super::CardboxLayout {
            version: 3,
            pinned: (0..20).map(|i| format!("uuid-{i}")).collect(),
            ..Default::default()
        };
        write_layout(dir.path(), &initial);

        let lock = std::sync::Arc::new(super::CardboxLock::new());
        let root = dir.path().to_path_buf();

        let mut handles = vec![];

        // 10 threads each pin a new unique UUID
        for i in 100..110 {
            let lock = lock.clone();
            let root = root.clone();
            handles.push(std::thread::spawn(move || {
                let uuid = format!("uuid-{i}");
                locked_read_modify_write(&root, &lock, |layout| {
                    if !layout.pinned.contains(&uuid) {
                        layout.pinned.push(uuid);
                    }
                });
            }));
        }

        // 10 threads each unpin one of the initial UUIDs
        for i in 0..10 {
            let lock = lock.clone();
            let root = root.clone();
            handles.push(std::thread::spawn(move || {
                let uuid = format!("uuid-{i}");
                locked_read_modify_write(&root, &lock, |layout| {
                    layout.pinned.retain(|u| *u != uuid);
                });
            }));
        }

        for h in handles {
            h.join().unwrap();
        }

        let result = read_layout(dir.path());
        // Started with 20 (uuid-0..19), removed 10 (uuid-0..9), added 10 (uuid-100..109)
        assert_eq!(
            result.pinned.len(), 20,
            "expected 20 pinned, got {} — concurrent pin/unpin lost writes",
            result.pinned.len()
        );
        for i in 0..10 {
            assert!(
                !result.pinned.contains(&format!("uuid-{i}")),
                "uuid-{i} should have been unpinned"
            );
        }
        for i in 10..20 {
            assert!(
                result.pinned.contains(&format!("uuid-{i}")),
                "uuid-{i} should still be pinned"
            );
        }
        for i in 100..110 {
            assert!(
                result.pinned.contains(&format!("uuid-{i}")),
                "uuid-{i} should have been pinned"
            );
        }
    }

    #[test]
    fn concurrent_link_add_and_remove_consistent() {
        let dir = create_workspace();
        let lit_dir = dir.path().join(".lit");
        std::fs::create_dir_all(&lit_dir).unwrap();

        // Seed with 10 links that will be removed concurrently
        let mut initial = super::CardboxLayout::default();
        for i in 0..10 {
            initial.links.push(super::normalize_link(
                &format!("old-{i}"),
                &format!("old-{}", i + 100),
            ));
        }
        initial.version = 2;
        write_layout(dir.path(), &initial);

        let lock = std::sync::Arc::new(super::CardboxLock::new());
        let root = dir.path().to_path_buf();
        let mut handles = vec![];

        // 10 threads add new links
        for i in 0..10 {
            let lock = lock.clone();
            let root = root.clone();
            handles.push(std::thread::spawn(move || {
                let link = super::normalize_link(
                    &format!("new-{i}"),
                    &format!("new-{}", i + 100),
                );
                locked_read_modify_write(&root, &lock, |layout| {
                    if !layout.links.iter().any(|p| *p == link) {
                        layout.links.push(link);
                    }
                });
            }));
        }

        // 10 threads remove old links
        for i in 0..10 {
            let lock = lock.clone();
            let root = root.clone();
            handles.push(std::thread::spawn(move || {
                let link = super::normalize_link(
                    &format!("old-{i}"),
                    &format!("old-{}", i + 100),
                );
                locked_read_modify_write(&root, &lock, |layout| {
                    layout.links.retain(|p| *p != link);
                });
            }));
        }

        for h in handles {
            h.join().unwrap();
        }

        let result = read_layout(dir.path());
        assert_eq!(
            result.links.len(), 10,
            "expected 10 links (old removed, new added), got {}",
            result.links.len()
        );
        for i in 0..10 {
            let old = super::normalize_link(
                &format!("old-{i}"),
                &format!("old-{}", i + 100),
            );
            assert!(
                !result.links.contains(&old),
                "old-{i} link should have been removed"
            );
            let new = super::normalize_link(
                &format!("new-{i}"),
                &format!("new-{}", i + 100),
            );
            assert!(
                result.links.contains(&new),
                "new-{i} link should have been added"
            );
        }
    }

    #[test]
    fn concurrent_color_sets_no_lost_writes() {
        let dir = create_workspace();
        let lit_dir = dir.path().join(".lit");
        std::fs::create_dir_all(&lit_dir).unwrap();
        write_layout(dir.path(), &super::CardboxLayout::default());

        let lock = std::sync::Arc::new(super::CardboxLock::new());
        let root = dir.path().to_path_buf();
        let n = 30;

        let handles: Vec<_> = (0..n).map(|i| {
            let lock = lock.clone();
            let root = root.clone();
            std::thread::spawn(move || {
                let uuid = format!("uuid-{i}");
                let color = super::VALID_COLORS[i % super::VALID_COLORS.len()].to_string();
                locked_read_modify_write(&root, &lock, |layout| {
                    layout.colors.insert(uuid, color);
                    layout.version = layout.version.max(4);
                });
            })
        }).collect();

        for h in handles {
            h.join().unwrap();
        }

        let result = read_layout(dir.path());
        assert_eq!(
            result.colors.len(), n,
            "expected {n} color entries, got {} — writes were lost",
            result.colors.len()
        );
    }

    #[test]
    fn concurrent_group_create_and_dissolve_consistent() {
        let dir = create_workspace();
        let lit_dir = dir.path().join(".lit");
        std::fs::create_dir_all(&lit_dir).unwrap();

        // Seed: cards uuid-0..19 at top level, groups g-0..4 pre-existing
        let mut initial = super::CardboxLayout {
            version: 3,
            order: (0..20).map(|i| format!("uuid-{i}")).collect(),
            ..Default::default()
        };
        for i in 0..5 {
            let gid = format!("g-{i}");
            let cards = vec![format!("gcard-{i}-0"), format!("gcard-{i}-1")];
            super::do_create_group(
                &mut initial,
                gid,
                format!("Group {i}"),
                cards,
                None,
            );
        }
        write_layout(dir.path(), &initial);

        let lock = std::sync::Arc::new(super::CardboxLock::new());
        let root = dir.path().to_path_buf();
        let mut handles = vec![];

        // 5 threads dissolve the existing groups
        for i in 0..5 {
            let lock = lock.clone();
            let root = root.clone();
            handles.push(std::thread::spawn(move || {
                let gid = format!("g-{i}");
                locked_read_modify_write(&root, &lock, |layout| {
                    let _ = super::do_dissolve_group(layout, &gid);
                });
            }));
        }

        // 5 threads create new groups from top-level cards
        for i in 0..5 {
            let lock = lock.clone();
            let root = root.clone();
            handles.push(std::thread::spawn(move || {
                let gid = format!("new-g-{i}");
                let cards = vec![
                    format!("uuid-{}", i * 4),
                    format!("uuid-{}", i * 4 + 1),
                ];
                locked_read_modify_write(&root, &lock, |layout| {
                    super::do_create_group(
                        layout,
                        gid,
                        format!("New Group {i}"),
                        cards,
                        None,
                    );
                });
            }));
        }

        for h in handles {
            h.join().unwrap();
        }

        let result = read_layout(dir.path());

        // Old groups should all be dissolved
        for i in 0..5 {
            assert!(
                !result.groups.contains_key(&format!("g-{i}")),
                "g-{i} should have been dissolved"
            );
        }

        // New groups should all exist
        for i in 0..5 {
            assert!(
                result.groups.contains_key(&format!("new-g-{i}")),
                "new-g-{i} should have been created"
            );
        }

        // No duplicate entries in top-level order
        let mut seen = std::collections::HashSet::new();
        for entry in &result.order {
            assert!(
                seen.insert(entry.clone()),
                "duplicate entry in order: {entry}"
            );
        }

        // Every card UUID should appear exactly once across top-level + all groups
        let mut all_uuids: Vec<String> = result.order.iter()
            .filter(|e| !e.starts_with(super::GROUP_PREFIX))
            .cloned()
            .collect();
        for group in result.groups.values() {
            all_uuids.extend(group.order.iter().cloned());
        }
        all_uuids.sort();
        let before_dedup = all_uuids.len();
        all_uuids.dedup();
        assert_eq!(
            all_uuids.len(), before_dedup,
            "some card UUIDs appear more than once"
        );
    }

    #[test]
    fn sanitize_filename_strips_control_characters() {
        let input = "hello\0world\x07bell\x1Fescape";
        let result = super::sanitize_filename(input);
        assert_eq!(result, "hello_world_bell_escape");
        assert!(!result.chars().any(|c| c.is_control()));
    }

    #[test]
    fn sanitize_filename_strips_newlines_and_tabs() {
        let input = "line one\nline two\r\nline three\ttabbed";
        let result = super::sanitize_filename(input);
        assert_eq!(result, "line one_line two__line three_tabbed");
        assert!(!result.contains('\n'));
        assert!(!result.contains('\r'));
        assert!(!result.contains('\t'));
    }

    // ---- cardbox load perf guards (#849 / PR #848) ----

    /// 仁学-style classical Chinese document with `count` inline annotations.
    /// Each annotation is preceded by a distinct CJK run so index-time
    /// `original` resolution yields distinct, non-empty text per annotation.
    fn generate_renxue_md(count: usize) -> String {
        const CLAUSES: [&str; 10] = [
            "仁以通为第一义。",
            "以太也，电也，心力也，皆指出所以通之具。",
            "通之义，以道通为一最浑括。",
            "通有四义：中外通，多取其义于《春秋》。",
            "上下通，男女内外通，多取其义于《易》。",
            "人我通，多取其义于《佛书》。",
            "仁为天地万物之源，故唯心，故唯识。",
            "智慧生于仁，不仁则不智。",
            "平等生万化，代数之方程是也。",
            "仁不仁之辨，于其通与塞。",
        ];
        const CODES: [char; 3] = ['n', 'q', 't'];
        let mut md = String::from("# 仁学\n\n");
        for i in 0..count {
            let clause = CLAUSES[i % CLAUSES.len()];
            let code = CODES[i % CODES.len()];
            md.push_str(&format!(
                "{}第{}节 <!--- {}: _ | 第{}条批注 --->。{}\n\n",
                clause,
                i,
                code,
                i,
                CLAUSES[(i + 1) % CLAUSES.len()],
            ));
        }
        md
    }

    /// The #849 fix made cardbox load a pure SQL query. Deleting the source
    /// file after indexing and loading again on the SAME GraphIndex (no
    /// rebuild — a rebuild would diff the rows away and invert this test's
    /// meaning) proves the load path performs zero file reads and zero
    /// re-segmentation.
    #[test]
    fn cardbox_load_does_no_file_io_after_files_deleted() {
        let dir = create_workspace();
        write_md(dir.path(), "renxue.md", &generate_renxue_md(60));
        let gi = GraphIndex::build(dir.path().to_path_buf(), &AnnotationIndexOpts::default()).unwrap();

        let before = gi.list_all_cardbox_annotations().unwrap();
        assert_eq!(before.len(), 60);
        for a in &before {
            let original = a.original.as_deref().unwrap_or("");
            assert!(!original.is_empty(), "annotation {} has empty original", a.uuid);
        }

        std::fs::remove_file(dir.path().join("renxue.md")).unwrap();

        let after = gi.list_all_cardbox_annotations().unwrap();
        assert_eq!(after.len(), before.len());
        for (b, a) in before.iter().zip(after.iter()) {
            assert_eq!(b.uuid, a.uuid);
            assert_eq!(b.original, a.original);
            assert_eq!(b.body, a.body);
        }
    }

    /// Gross-regression tripwire: a pure indexed SELECT of 200 rows costs
    /// well under 1ms; 100ms only trips if per-annotation file reads or
    /// re-segmentation is reintroduced on the load path.
    #[test]
    fn cardbox_load_time_under_budget_200_annotations() {
        let dir = create_workspace();
        write_md(dir.path(), "renxue.md", &generate_renxue_md(200));
        let gi = GraphIndex::build(dir.path().to_path_buf(), &AnnotationIndexOpts::default()).unwrap();

        let t = std::time::Instant::now();
        let anns = gi.list_all_cardbox_annotations().unwrap();
        let elapsed = t.elapsed();

        assert_eq!(anns.len(), 200);
        assert!(anns.iter().all(|a| a.original.is_some()));
        assert!(
            elapsed < std::time::Duration::from_millis(100),
            "cardbox load took {elapsed:?} (budget 100ms)"
        );
    }

    /// #851 baseline: index-time original resolution is still
    /// O(annotations × doc size) per file reindex. Prints the cost for a
    /// 200-annotation CJK document; the only assertion is an absurd ceiling
    /// to catch a hang. Run with `cargo test cardbox -- --nocapture` to see it.
    #[test]
    fn cardbox_index_build_baseline_renxue() {
        let dir = create_workspace();
        write_md(dir.path(), "renxue.md", &generate_renxue_md(200));

        let t = std::time::Instant::now();
        let gi = GraphIndex::build(dir.path().to_path_buf(), &AnnotationIndexOpts::default()).unwrap();
        let elapsed = t.elapsed();

        assert_eq!(gi.list_all_cardbox_annotations().unwrap().len(), 200);
        eprintln!("[perf][#851] index build, 200 CJK annotations in one file: {elapsed:?}");
        assert!(elapsed < std::time::Duration::from_secs(30));
    }

    #[test]
    fn export_card_note_json_only_note_errors() {
        // K3: a note that exists only as a JSON legacy entry is not exportable.
        use crate::workspace::write_hash::WriteHashRegistry;

        let dir = create_workspace();
        write_md(
            dir.path(),
            "a.md",
            "Text <!---[p1] n: \\s | Parent ---> more.\n",
        );
        let gi = GraphIndex::build(dir.path().to_path_buf(), &AnnotationIndexOpts::default()).unwrap();
        let reg = WriteHashRegistry::new();

        let mut layout = super::CardboxLayout::default();
        layout.notes.insert("p1".to_string(), CardNote {
            body: "JSON legacy note".to_string(),
            updated_at: None,
        });
        write_layout(dir.path(), &layout);

        let result = super::do_export_card_note(dir.path(), &gi, &reg, "p1");
        assert!(result.is_err(), "JSON-only note must not export");
        assert!(result.unwrap_err().contains("No note for card"),
            "error should say no note exists");
    }

    #[test]
    fn export_card_note_reads_sn_body() {
        use crate::workspace::write_hash::WriteHashRegistry;

        let dir = create_workspace();
        write_md(
            dir.path(),
            "a.md",
            concat!(
                "Text <!---[p1] n: \\s | Parent ---> more.\n\n",
                "<!---[sn1] sn: ^\"p1\" | sn body @2026-07-28 --->\n",
            ),
        );
        let gi = GraphIndex::build(dir.path().to_path_buf(), &AnnotationIndexOpts::default()).unwrap();
        let reg = WriteHashRegistry::new();

        let layout = super::CardboxLayout::default();
        write_layout(dir.path(), &layout);

        let filename = super::do_export_card_note(dir.path(), &gi, &reg, "p1").unwrap();

        let content = std::fs::read_to_string(dir.path().join(&filename)).unwrap();
        assert!(content.contains("sn body"),
            "exported file must contain sn-derived body: {}", content);
    }

    #[test]
    fn merge_structural_layout_client_notes_never_merge() {
        // K2: client-sent notes (sn-backed or not) never reach disk; disk
        // notes are preserved verbatim.
        let mut disk = super::CardboxLayout {
            version: 1,
            order: vec!["p1".to_string(), "p2".to_string()],
            ..Default::default()
        };
        disk.notes.insert("p2".to_string(), CardNote {
            body: "disk legacy note".to_string(),
            updated_at: Some("2026-01-01T00:00:00Z".to_string()),
        });

        let client = super::CardboxLayout {
            version: 2,
            order: vec!["p1".to_string(), "p2".to_string()],
            notes: {
                let mut m = HashMap::new();
                m.insert("p1".to_string(), CardNote {
                    body: "client note for p1".to_string(),
                    updated_at: None,
                });
                m.insert("p2".to_string(), CardNote {
                    body: "client overwrite of p2".to_string(),
                    updated_at: None,
                });
                m
            },
            ..Default::default()
        };

        super::merge_structural_layout(&mut disk, client);

        assert!(!disk.notes.contains_key("p1"),
            "client notes must never merge into disk: {:?}", disk.notes);
        assert_eq!(disk.notes.get("p2").unwrap().body, "disk legacy note",
            "disk notes must be preserved verbatim: {:?}", disk.notes);
        assert_eq!(disk.version, 2);
        assert_eq!(disk.order, vec!["p1", "p2"]);
    }

    #[test]
    fn write_layout_client_notes_leave_disk_notes_verbatim() {
        // Full write path: disk cardbox.json notes bytes survive a client
        // write that carries a notes payload.
        let dir = create_workspace();

        let mut disk = super::CardboxLayout::default();
        disk.notes.insert("p1".to_string(), CardNote {
            body: "legacy".to_string(),
            updated_at: None,
        });
        write_layout(dir.path(), &disk);

        let mut client = super::CardboxLayout {
            version: 4,
            order: vec!["p1".to_string()],
            ..Default::default()
        };
        client.notes.insert("p1".to_string(), CardNote {
            body: "client payload".to_string(),
            updated_at: None,
        });

        let mut on_disk = crate::graph::cardbox_layout::load_layout(dir.path());
        let notes_before = on_disk.notes.clone();
        super::merge_structural_layout(&mut on_disk, client);
        write_layout(dir.path(), &on_disk);

        let reloaded = read_layout(dir.path());
        assert_eq!(reloaded.notes, notes_before,
            "disk notes must survive client write verbatim: {:?}", reloaded.notes);
        assert_eq!(reloaded.notes.get("p1").unwrap().body, "legacy");
    }
}
