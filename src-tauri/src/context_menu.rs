use serde::Serialize;
use std::sync::Mutex;
use tauri::menu::{ContextMenu, Menu, MenuItem, Submenu};
use tauri::{Emitter, Manager, Wry};

pub const CTX_TRASH_RESTORE: &str = "ctx_trash_restore";
pub const CTX_TRASH_PURGE: &str = "ctx_trash_purge";

pub const EVENT_CTX_TRASH_RESTORE: &str = "context-menu://trash/restore";
pub const EVENT_CTX_TRASH_PURGE: &str = "context-menu://trash/purge";

pub const CTX_SIDEBAR_RENAME: &str = "ctx_sidebar_rename";
pub const CTX_SIDEBAR_EXTERNAL_EDITOR: &str = "ctx_sidebar_external_editor";
pub const CTX_SIDEBAR_EXPORT_NETWORK: &str = "ctx_sidebar_export_network";
pub const CTX_SIDEBAR_TRASH: &str = "ctx_sidebar_trash";

pub const EVENT_CTX_SIDEBAR_RENAME: &str = "context-menu://sidebar/rename";
pub const EVENT_CTX_SIDEBAR_EXTERNAL_EDITOR: &str = "context-menu://sidebar/external-editor";
pub const EVENT_CTX_SIDEBAR_EXPORT_NETWORK: &str = "context-menu://sidebar/export-network";
pub const EVENT_CTX_SIDEBAR_TRASH: &str = "context-menu://sidebar/trash";

pub const CTX_MINDMAP_EDIT: &str = "ctx_mindmap_edit";
pub const CTX_MINDMAP_EXPORT_NETWORK: &str = "ctx_mindmap_export_network";

pub const EVENT_CTX_MINDMAP_EDIT: &str = "context-menu://mindmap/edit";
pub const EVENT_CTX_MINDMAP_EXPORT_NETWORK: &str = "context-menu://mindmap/export-network";

pub const CTX_GRAPH_MERGE: &str = "ctx_graph_merge";
pub const CTX_GRAPH_SPLIT: &str = "ctx_graph_split";
pub const CTX_GRAPH_DELETE: &str = "ctx_graph_delete";
pub const CTX_GRAPH_EXPORT_NETWORK: &str = "ctx_graph_export_network";
pub const CTX_GRAPH_FETCH_DETAILS: &str = "ctx_graph_fetch_details";
pub const CTX_GRAPH_CREATE_NOTE: &str = "ctx_graph_create_note";

pub const EVENT_CTX_GRAPH_MERGE: &str = "context-menu://graph/merge";
pub const EVENT_CTX_GRAPH_SPLIT: &str = "context-menu://graph/split";
pub const EVENT_CTX_GRAPH_DELETE: &str = "context-menu://graph/delete";
pub const EVENT_CTX_GRAPH_EXPORT_NETWORK: &str = "context-menu://graph/export-network";
pub const EVENT_CTX_GRAPH_FETCH_DETAILS: &str = "context-menu://graph/fetch-details";
pub const EVENT_CTX_GRAPH_CREATE_NOTE: &str = "context-menu://graph/create-note";

pub const CTX_CARDBOX_NEW_GROUP: &str = "ctx_cardbox_new_group";
pub const CTX_CARDBOX_ADD_TO_GROUP: &str = "ctx_cardbox_add_to_group";
pub const CTX_CARDBOX_REMOVE_FROM_GROUP: &str = "ctx_cardbox_remove_from_group";
pub const CTX_CARDBOX_DISSOLVE_GROUP: &str = "ctx_cardbox_dissolve_group";
pub const CTX_CARDBOX_RENAME_GROUP: &str = "ctx_cardbox_rename_group";
pub const CTX_CARDBOX_PIN: &str = "ctx_cardbox_pin";
pub const CTX_CARDBOX_UNPIN: &str = "ctx_cardbox_unpin";

pub const EVENT_CTX_CARDBOX_NEW_GROUP: &str = "context-menu://cardbox/new-group";
pub const EVENT_CTX_CARDBOX_ADD_TO_GROUP: &str = "context-menu://cardbox/add-to-group";
pub const EVENT_CTX_CARDBOX_REMOVE_FROM_GROUP: &str = "context-menu://cardbox/remove-from-group";
pub const EVENT_CTX_CARDBOX_DISSOLVE_GROUP: &str = "context-menu://cardbox/dissolve-group";
pub const EVENT_CTX_CARDBOX_RENAME_GROUP: &str = "context-menu://cardbox/rename-group";
pub const EVENT_CTX_CARDBOX_PIN: &str = "context-menu://cardbox/pin";
pub const EVENT_CTX_CARDBOX_UNPIN: &str = "context-menu://cardbox/unpin";

pub const CTX_CARDBOX_COLOR_PREFIX: &str = "ctx_cardbox_color_";
pub const CTX_CARDBOX_COLOR_BLUE: &str = "ctx_cardbox_color_blue";
pub const CTX_CARDBOX_COLOR_ORANGE: &str = "ctx_cardbox_color_orange";
pub const CTX_CARDBOX_COLOR_GREEN: &str = "ctx_cardbox_color_green";
pub const CTX_CARDBOX_COLOR_PURPLE: &str = "ctx_cardbox_color_purple";
pub const CTX_CARDBOX_COLOR_PINK: &str = "ctx_cardbox_color_pink";
pub const CTX_CARDBOX_COLOR_CYAN: &str = "ctx_cardbox_color_cyan";
pub const CTX_CARDBOX_COLOR_NONE: &str = "ctx_cardbox_color_none";
pub const EVENT_CTX_CARDBOX_SET_COLOR: &str = "context-menu://cardbox/set-color";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ContextMenuAction {
    TrashRestore,
    TrashPurge,
    SidebarRename,
    SidebarExternalEditor,
    SidebarExportNetwork,
    SidebarTrash,
    MindmapEdit,
    MindmapExportNetwork,
    GraphMerge,
    GraphSplit,
    GraphDelete,
    GraphExportNetwork,
    GraphFetchDetails,
    GraphCreateNote,
    CardboxNewGroup,
    CardboxAddToGroup,
    CardboxRemoveFromGroup,
    CardboxDissolveGroup,
    CardboxRenameGroup,
    CardboxPin,
    CardboxUnpin,
}

impl ContextMenuAction {
    pub fn from_id(id: &str) -> Option<Self> {
        match id {
            CTX_TRASH_RESTORE => Some(Self::TrashRestore),
            CTX_TRASH_PURGE => Some(Self::TrashPurge),
            CTX_SIDEBAR_RENAME => Some(Self::SidebarRename),
            CTX_SIDEBAR_EXTERNAL_EDITOR => Some(Self::SidebarExternalEditor),
            CTX_SIDEBAR_EXPORT_NETWORK => Some(Self::SidebarExportNetwork),
            CTX_SIDEBAR_TRASH => Some(Self::SidebarTrash),
            CTX_MINDMAP_EDIT => Some(Self::MindmapEdit),
            CTX_MINDMAP_EXPORT_NETWORK => Some(Self::MindmapExportNetwork),
            CTX_GRAPH_MERGE => Some(Self::GraphMerge),
            CTX_GRAPH_SPLIT => Some(Self::GraphSplit),
            CTX_GRAPH_DELETE => Some(Self::GraphDelete),
            CTX_GRAPH_EXPORT_NETWORK => Some(Self::GraphExportNetwork),
            CTX_GRAPH_FETCH_DETAILS => Some(Self::GraphFetchDetails),
            CTX_GRAPH_CREATE_NOTE => Some(Self::GraphCreateNote),
            CTX_CARDBOX_NEW_GROUP => Some(Self::CardboxNewGroup),
            CTX_CARDBOX_ADD_TO_GROUP => Some(Self::CardboxAddToGroup),
            CTX_CARDBOX_REMOVE_FROM_GROUP => Some(Self::CardboxRemoveFromGroup),
            CTX_CARDBOX_DISSOLVE_GROUP => Some(Self::CardboxDissolveGroup),
            CTX_CARDBOX_RENAME_GROUP => Some(Self::CardboxRenameGroup),
            CTX_CARDBOX_PIN => Some(Self::CardboxPin),
            CTX_CARDBOX_UNPIN => Some(Self::CardboxUnpin),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct TrashContextPayload {
    pub trash_name: String,
}

pub struct MenuItemSpec {
    pub id: &'static str,
    pub label: String,
    pub enabled: bool,
}

pub enum MenuEntry {
    Item(MenuItemSpec),
    Submenu { label: String, items: Vec<MenuItemSpec> },
}

#[derive(Debug, Clone, Serialize)]
pub struct SidebarContextPayload {
    pub relative_path: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct MindmapContextPayload {
    pub node_id: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct GraphContextPayload {
    pub node_id: String,
    pub node_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct CardboxContextPayload {
    pub card_uuid: Option<String>,
    pub group_id: Option<String>,
    pub color: Option<String>,
}

pub fn sidebar_menu_items() -> Vec<MenuItemSpec> {
    vec![
        MenuItemSpec {
            id: CTX_SIDEBAR_RENAME,
            label: "Rename".into(),
            enabled: true,
        },
        MenuItemSpec {
            id: CTX_SIDEBAR_EXTERNAL_EDITOR,
            label: "Open in External Editor".into(),
            enabled: true,
        },
        MenuItemSpec {
            id: CTX_SIDEBAR_EXPORT_NETWORK,
            label: "Export Local Network\u{2026}".into(),
            enabled: true,
        },
        MenuItemSpec {
            id: CTX_SIDEBAR_TRASH,
            label: "Move to Trash".into(),
            enabled: true,
        },
    ]
}

pub fn dispatch_sidebar_action(
    action: ContextMenuAction,
    context: &str,
) -> (&'static str, SidebarContextPayload) {
    let payload = SidebarContextPayload {
        relative_path: context.to_string(),
    };
    let event = match action {
        ContextMenuAction::SidebarRename => EVENT_CTX_SIDEBAR_RENAME,
        ContextMenuAction::SidebarExternalEditor => EVENT_CTX_SIDEBAR_EXTERNAL_EDITOR,
        ContextMenuAction::SidebarExportNetwork => EVENT_CTX_SIDEBAR_EXPORT_NETWORK,
        ContextMenuAction::SidebarTrash => EVENT_CTX_SIDEBAR_TRASH,
        _ => unreachable!("dispatch_sidebar_action called with non-sidebar action"),
    };
    (event, payload)
}

pub fn trash_menu_items() -> Vec<MenuItemSpec> {
    vec![
        MenuItemSpec {
            id: CTX_TRASH_RESTORE,
            label: "Restore".into(),
            enabled: true,
        },
        MenuItemSpec {
            id: CTX_TRASH_PURGE,
            label: "Delete Permanently".into(),
            enabled: true,
        },
    ]
}

pub fn mindmap_menu_items(has_export: bool) -> Vec<MenuItemSpec> {
    let mut items = vec![MenuItemSpec {
        id: CTX_MINDMAP_EDIT,
        label: "Edit".into(),
        enabled: true,
    }];
    if has_export {
        items.push(MenuItemSpec {
            id: CTX_MINDMAP_EXPORT_NETWORK,
            label: "Export Local Network\u{2026}".into(),
            enabled: true,
        });
    }
    items
}

pub struct GraphMenuContext {
    pub selection_count: usize,
    pub has_headings: bool,
    pub has_export: bool,
    pub is_shadow: bool,
}

pub struct CardboxMenuContext {
    pub is_grouped: bool,
    pub is_group_header: bool,
    pub has_groups: bool,
    pub is_pinned: bool,
}

pub fn graph_menu_items(ctx: &GraphMenuContext) -> Vec<MenuItemSpec> {
    let mut items = Vec::new();
    if ctx.is_shadow && ctx.selection_count <= 1 {
        items.push(MenuItemSpec {
            id: CTX_GRAPH_FETCH_DETAILS,
            label: "Fetch details".into(),
            enabled: true,
        });
        items.push(MenuItemSpec {
            id: CTX_GRAPH_CREATE_NOTE,
            label: "Create note".into(),
            enabled: true,
        });
    }
    if ctx.selection_count >= 2 {
        items.push(MenuItemSpec {
            id: CTX_GRAPH_MERGE,
            label: format!("Merge {} documents", ctx.selection_count),
            enabled: true,
        });
    }
    if ctx.selection_count <= 1 {
        items.push(MenuItemSpec {
            id: CTX_GRAPH_SPLIT,
            label: "Split document".into(),
            enabled: ctx.has_headings,
        });
    }
    items.push(MenuItemSpec {
        id: CTX_GRAPH_DELETE,
        label: if ctx.selection_count >= 2 {
            format!("Delete {} documents", ctx.selection_count)
        } else {
            "Delete document".into()
        },
        enabled: true,
    });
    if ctx.has_export {
        items.push(MenuItemSpec {
            id: CTX_GRAPH_EXPORT_NETWORK,
            label: "Export Local Network\u{2026}".into(),
            enabled: true,
        });
    }
    items
}

const CARDBOX_COLORS: &[(&str, &str, &str)] = &[
    (CTX_CARDBOX_COLOR_BLUE, "blue", "Blue"),
    (CTX_CARDBOX_COLOR_ORANGE, "orange", "Orange"),
    (CTX_CARDBOX_COLOR_GREEN, "green", "Green"),
    (CTX_CARDBOX_COLOR_PURPLE, "purple", "Purple"),
    (CTX_CARDBOX_COLOR_PINK, "pink", "Pink"),
    (CTX_CARDBOX_COLOR_CYAN, "cyan", "Cyan"),
    (CTX_CARDBOX_COLOR_NONE, "none", "None"),
];

fn color_submenu_items(current_color: Option<&str>) -> Vec<MenuItemSpec> {
    CARDBOX_COLORS
        .iter()
        .map(|(id, value, display)| {
            let is_active = match current_color {
                Some(c) => c == *value,
                None => *value == "none",
            };
            let label = if is_active {
                format!("\u{2713} {}", display)
            } else {
                display.to_string()
            };
            MenuItemSpec {
                id,
                label,
                enabled: true,
            }
        })
        .collect()
}

fn wrap_flat(specs: Vec<MenuItemSpec>) -> Vec<MenuEntry> {
    specs.into_iter().map(MenuEntry::Item).collect()
}

pub fn cardbox_menu_items(ctx: &CardboxMenuContext, current_color: Option<&str>) -> Vec<MenuEntry> {
    let mut items = Vec::new();
    if ctx.is_group_header {
        items.push(MenuEntry::Item(MenuItemSpec {
            id: CTX_CARDBOX_RENAME_GROUP,
            label: "Rename Group".into(),
            enabled: true,
        }));
        items.push(MenuEntry::Item(MenuItemSpec {
            id: CTX_CARDBOX_DISSOLVE_GROUP,
            label: "Dissolve Group".into(),
            enabled: true,
        }));
        // NO color submenu for group headers
    } else if ctx.is_grouped {
        items.push(MenuEntry::Item(MenuItemSpec {
            id: CTX_CARDBOX_REMOVE_FROM_GROUP,
            label: "Remove from Group".into(),
            enabled: true,
        }));
        items.push(MenuEntry::Item(MenuItemSpec {
            id: if ctx.is_pinned { CTX_CARDBOX_UNPIN } else { CTX_CARDBOX_PIN },
            label: if ctx.is_pinned { "Unpin".into() } else { "Pin".into() },
            enabled: true,
        }));
        items.push(MenuEntry::Submenu {
            label: "Color".into(),
            items: color_submenu_items(current_color),
        });
    } else {
        items.push(MenuEntry::Item(MenuItemSpec {
            id: CTX_CARDBOX_NEW_GROUP,
            label: "New Group".into(),
            enabled: true,
        }));
        if ctx.has_groups {
            items.push(MenuEntry::Item(MenuItemSpec {
                id: CTX_CARDBOX_ADD_TO_GROUP,
                label: "Add to Group\u{2026}".into(),
                enabled: true,
            }));
        }
        items.push(MenuEntry::Item(MenuItemSpec {
            id: if ctx.is_pinned { CTX_CARDBOX_UNPIN } else { CTX_CARDBOX_PIN },
            label: if ctx.is_pinned { "Unpin".into() } else { "Pin".into() },
            enabled: true,
        }));
        items.push(MenuEntry::Submenu {
            label: "Color".into(),
            items: color_submenu_items(current_color),
        });
    }
    items
}

pub fn dispatch_mindmap_action(
    action: ContextMenuAction,
    node_id: &str,
) -> (&'static str, MindmapContextPayload) {
    let payload = MindmapContextPayload {
        node_id: node_id.to_string(),
    };
    let event = match action {
        ContextMenuAction::MindmapEdit => EVENT_CTX_MINDMAP_EDIT,
        ContextMenuAction::MindmapExportNetwork => EVENT_CTX_MINDMAP_EXPORT_NETWORK,
        _ => unreachable!("dispatch_mindmap_action called with non-mindmap action"),
    };
    (event, payload)
}

pub fn dispatch_graph_action(
    action: ContextMenuAction,
    node_id: &str,
    node_ids: &[String],
) -> (&'static str, GraphContextPayload) {
    let payload = GraphContextPayload {
        node_id: node_id.to_string(),
        node_ids: node_ids.to_vec(),
    };
    let event = match action {
        ContextMenuAction::GraphMerge => EVENT_CTX_GRAPH_MERGE,
        ContextMenuAction::GraphSplit => EVENT_CTX_GRAPH_SPLIT,
        ContextMenuAction::GraphDelete => EVENT_CTX_GRAPH_DELETE,
        ContextMenuAction::GraphExportNetwork => EVENT_CTX_GRAPH_EXPORT_NETWORK,
        ContextMenuAction::GraphFetchDetails => EVENT_CTX_GRAPH_FETCH_DETAILS,
        ContextMenuAction::GraphCreateNote => EVENT_CTX_GRAPH_CREATE_NOTE,
        _ => unreachable!("dispatch_graph_action called with non-graph action"),
    };
    (event, payload)
}

pub fn dispatch_cardbox_action(
    action: ContextMenuAction,
    card_uuid: Option<String>,
    group_id: Option<String>,
) -> (&'static str, CardboxContextPayload) {
    let payload = CardboxContextPayload {
        card_uuid,
        group_id,
        color: None,
    };
    let event = match action {
        ContextMenuAction::CardboxNewGroup => EVENT_CTX_CARDBOX_NEW_GROUP,
        ContextMenuAction::CardboxAddToGroup => EVENT_CTX_CARDBOX_ADD_TO_GROUP,
        ContextMenuAction::CardboxRemoveFromGroup => EVENT_CTX_CARDBOX_REMOVE_FROM_GROUP,
        ContextMenuAction::CardboxDissolveGroup => EVENT_CTX_CARDBOX_DISSOLVE_GROUP,
        ContextMenuAction::CardboxRenameGroup => EVENT_CTX_CARDBOX_RENAME_GROUP,
        ContextMenuAction::CardboxPin => EVENT_CTX_CARDBOX_PIN,
        ContextMenuAction::CardboxUnpin => EVENT_CTX_CARDBOX_UNPIN,
        _ => unreachable!("dispatch_cardbox_action called with non-cardbox action"),
    };
    (event, payload)
}

pub fn dispatch_context_action(
    action: ContextMenuAction,
    context: &str,
) -> (&'static str, TrashContextPayload) {
    match action {
        ContextMenuAction::TrashRestore => (
            EVENT_CTX_TRASH_RESTORE,
            TrashContextPayload {
                trash_name: context.to_string(),
            },
        ),
        ContextMenuAction::TrashPurge => (
            EVENT_CTX_TRASH_PURGE,
            TrashContextPayload {
                trash_name: context.to_string(),
            },
        ),
        _ => unreachable!("dispatch_context_action called with non-trash action"),
    }
}

#[derive(Debug, Clone)]
pub enum ContextMenuContext {
    Trash { trash_name: String },
    Sidebar { relative_path: String },
    Mindmap { node_id: String },
    Graph { node_id: String, node_ids: Vec<String> },
    Cardbox { card_uuid: Option<String>, group_id: Option<String> },
}

pub struct PendingContextMenu(pub Mutex<Option<ContextMenuContext>>);

impl Default for PendingContextMenu {
    fn default() -> Self {
        Self(Mutex::new(None))
    }
}

fn show_popup_menu(
    entries: &[MenuEntry],
    window: &tauri::Window<Wry>,
) -> Result<(), String> {
    let app = window.app_handle();
    let mut menu_items: Vec<Box<dyn tauri::menu::IsMenuItem<Wry>>> = Vec::new();
    for entry in entries {
        match entry {
            MenuEntry::Item(s) => {
                let item = MenuItem::with_id(app, s.id, &s.label, s.enabled, None::<&str>)
                    .map_err(|e| e.to_string())?;
                menu_items.push(Box::new(item));
            }
            MenuEntry::Submenu { label, items } => {
                let sub_items: Vec<MenuItem<Wry>> = items
                    .iter()
                    .map(|s| MenuItem::with_id(app, s.id, &s.label, s.enabled, None::<&str>))
                    .collect::<Result<_, _>>()
                    .map_err(|e| e.to_string())?;
                let sub_refs: Vec<&dyn tauri::menu::IsMenuItem<Wry>> =
                    sub_items.iter().map(|i| i as &dyn tauri::menu::IsMenuItem<Wry>).collect();
                let submenu = Submenu::with_items(app, label, true, &sub_refs)
                    .map_err(|e| e.to_string())?;
                menu_items.push(Box::new(submenu));
            }
        }
    }
    let item_refs: Vec<&dyn tauri::menu::IsMenuItem<Wry>> =
        menu_items.iter().map(|i| i.as_ref()).collect();
    let menu = Menu::with_items(app, &item_refs).map_err(|e| e.to_string())?;
    menu.popup(window.clone()).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn show_trash_context_menu(
    trash_name: String,
    window: tauri::Window,
    pending: tauri::State<PendingContextMenu>,
) -> Result<(), String> {
    *pending.0.lock().unwrap() = Some(ContextMenuContext::Trash {
        trash_name,
    });
    let entries = wrap_flat(trash_menu_items());
    show_popup_menu(&entries, &window)
}

#[tauri::command]
pub fn show_sidebar_context_menu(
    relative_path: String,
    window: tauri::Window,
    pending: tauri::State<PendingContextMenu>,
) -> Result<(), String> {
    *pending.0.lock().unwrap() = Some(ContextMenuContext::Sidebar {
        relative_path,
    });
    let entries = wrap_flat(sidebar_menu_items());
    show_popup_menu(&entries, &window)
}

pub fn handle_context_menu_event(app: &tauri::AppHandle, menu_id: &str) {
    // --- Color submenu: prefix-based dispatch ---
    if menu_id.starts_with(CTX_CARDBOX_COLOR_PREFIX) {
        let color_name = &menu_id[CTX_CARDBOX_COLOR_PREFIX.len()..];
        let pending: tauri::State<PendingContextMenu> = app.state();
        let context = pending.0.lock().unwrap().take();
        if let Some(ContextMenuContext::Cardbox { card_uuid, group_id }) = context {
            let color = if color_name == "none" {
                None
            } else {
                Some(color_name.to_string())
            };
            let payload = CardboxContextPayload {
                card_uuid,
                group_id,
                color,
            };
            let windows = app.webview_windows();
            for window in windows.values() {
                let _ = window.emit(EVENT_CTX_CARDBOX_SET_COLOR, &payload);
            }
        }
        return;
    }

    // --- Existing enum-based dispatch ---
    let action = match ContextMenuAction::from_id(menu_id) {
        Some(a) => a,
        None => return,
    };
    let pending: tauri::State<PendingContextMenu> = app.state();
    let context = pending.0.lock().unwrap().take();
    let context = match context {
        Some(c) => c,
        None => return,
    };
    match context {
        ContextMenuContext::Trash { trash_name } => {
            let (event_name, payload) = dispatch_context_action(action, &trash_name);
            let windows = app.webview_windows();
            for window in windows.values() {
                let _ = window.emit(event_name, &payload);
            }
        }
        ContextMenuContext::Sidebar { relative_path } => {
            let (event_name, payload) = dispatch_sidebar_action(action, &relative_path);
            let windows = app.webview_windows();
            for window in windows.values() {
                let _ = window.emit(event_name, &payload);
            }
        }
        ContextMenuContext::Mindmap { node_id } => {
            let (event_name, payload) = dispatch_mindmap_action(action, &node_id);
            let windows = app.webview_windows();
            for window in windows.values() {
                let _ = window.emit(event_name, &payload);
            }
        }
        ContextMenuContext::Graph { node_id, node_ids } => {
            let (event_name, payload) = dispatch_graph_action(action, &node_id, &node_ids);
            let windows = app.webview_windows();
            for window in windows.values() {
                let _ = window.emit(event_name, &payload);
            }
        }
        ContextMenuContext::Cardbox { card_uuid, group_id } => {
            let (event_name, payload) = dispatch_cardbox_action(action, card_uuid, group_id);
            let windows = app.webview_windows();
            for window in windows.values() {
                let _ = window.emit(event_name, &payload);
            }
        }
    }
}

#[tauri::command]
pub fn show_graph_context_menu(
    node_id: String,
    node_ids: Vec<String>,
    selection_count: usize,
    has_headings: bool,
    has_export: bool,
    is_shadow: bool,
    window: tauri::Window,
    pending: tauri::State<PendingContextMenu>,
) -> Result<(), String> {
    *pending.0.lock().unwrap() = Some(ContextMenuContext::Graph {
        node_id,
        node_ids,
    });
    let ctx = GraphMenuContext {
        selection_count,
        has_headings,
        has_export,
        is_shadow,
    };
    let entries = wrap_flat(graph_menu_items(&ctx));
    show_popup_menu(&entries, &window)
}

#[tauri::command]
pub fn show_mindmap_context_menu(
    node_id: String,
    has_export: bool,
    window: tauri::Window,
    pending: tauri::State<PendingContextMenu>,
) -> Result<(), String> {
    *pending.0.lock().unwrap() = Some(ContextMenuContext::Mindmap { node_id });
    let entries = wrap_flat(mindmap_menu_items(has_export));
    show_popup_menu(&entries, &window)
}

#[tauri::command]
pub fn show_cardbox_context_menu(
    card_uuid: Option<String>,
    group_id: Option<String>,
    is_grouped: bool,
    is_group_header: bool,
    has_groups: bool,
    is_pinned: bool,
    current_color: Option<String>,
    window: tauri::Window,
    pending: tauri::State<PendingContextMenu>,
) -> Result<(), String> {
    *pending.0.lock().unwrap() = Some(ContextMenuContext::Cardbox {
        card_uuid,
        group_id,
    });
    let ctx = CardboxMenuContext {
        is_grouped,
        is_group_header,
        has_groups,
        is_pinned,
    };
    let entries = cardbox_menu_items(&ctx, current_color.as_deref());
    show_popup_menu(&entries, &window)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn trash_context_menu_ids_are_defined() {
        assert_eq!(CTX_TRASH_RESTORE, "ctx_trash_restore");
        assert_eq!(CTX_TRASH_PURGE, "ctx_trash_purge");
    }

    #[test]
    fn trash_event_constants_are_defined() {
        assert_eq!(EVENT_CTX_TRASH_RESTORE, "context-menu://trash/restore");
        assert_eq!(EVENT_CTX_TRASH_PURGE, "context-menu://trash/purge");
    }

    #[test]
    fn from_id_maps_trash_ids() {
        assert_eq!(
            ContextMenuAction::from_id(CTX_TRASH_RESTORE),
            Some(ContextMenuAction::TrashRestore)
        );
        assert_eq!(
            ContextMenuAction::from_id(CTX_TRASH_PURGE),
            Some(ContextMenuAction::TrashPurge)
        );
    }

    #[test]
    fn from_id_returns_none_for_unknown() {
        assert!(ContextMenuAction::from_id("nonexistent").is_none());
    }

    #[test]
    fn context_menu_ids_do_not_collide_with_app_menu_ids() {
        use crate::menu;
        let app_menu_ids = [
            menu::MENU_ID_OPEN_WORKSPACE,
            menu::MENU_ID_INSTALL_CLI,
            menu::MENU_ID_OPEN_PREFERENCES,
            menu::MENU_ID_OPEN_IN_EXTERNAL_EDITOR,
            menu::MENU_ID_CLOSE,
            menu::MENU_ID_EXPORT_MARKDOWN,
            menu::MENU_ID_BUY_LICENSE,
            menu::MENU_ID_ENTER_LICENSE_KEY,
            menu::MENU_ID_LICENSE_INFO,
            menu::MENU_ID_ABOUT,
        ];
        let ctx_ids = [CTX_TRASH_RESTORE, CTX_TRASH_PURGE];
        for ctx_id in &ctx_ids {
            for app_id in &app_menu_ids {
                assert_ne!(ctx_id, app_id, "Context menu ID {ctx_id} collides with app menu ID {app_id}");
            }
        }
    }

    #[test]
    fn trash_menu_items_returns_two_specs() {
        let items = trash_menu_items();
        assert_eq!(items.len(), 2);
        assert_eq!(items[0].id, CTX_TRASH_RESTORE);
        assert_eq!(items[0].label, "Restore");
        assert!(items[0].enabled);
        assert_eq!(items[1].id, CTX_TRASH_PURGE);
        assert_eq!(items[1].label, "Delete Permanently");
        assert!(items[1].enabled);
    }

    #[test]
    fn dispatch_trash_restore_returns_correct_event_and_payload() {
        let (event, payload) = dispatch_context_action(ContextMenuAction::TrashRestore, "file.123.md");
        assert_eq!(event, EVENT_CTX_TRASH_RESTORE);
        assert_eq!(payload.trash_name, "file.123.md");
    }

    #[test]
    fn dispatch_trash_purge_returns_correct_event_and_payload() {
        let (event, payload) = dispatch_context_action(ContextMenuAction::TrashPurge, "file.456.md");
        assert_eq!(event, EVENT_CTX_TRASH_PURGE);
        assert_eq!(payload.trash_name, "file.456.md");
    }

    #[test]
    fn sidebar_context_menu_ids_are_defined() {
        assert_eq!(CTX_SIDEBAR_RENAME, "ctx_sidebar_rename");
        assert_eq!(CTX_SIDEBAR_EXTERNAL_EDITOR, "ctx_sidebar_external_editor");
        assert_eq!(CTX_SIDEBAR_EXPORT_NETWORK, "ctx_sidebar_export_network");
        assert_eq!(CTX_SIDEBAR_TRASH, "ctx_sidebar_trash");
    }

    #[test]
    fn sidebar_event_constants_are_defined() {
        assert_eq!(EVENT_CTX_SIDEBAR_RENAME, "context-menu://sidebar/rename");
        assert_eq!(EVENT_CTX_SIDEBAR_EXTERNAL_EDITOR, "context-menu://sidebar/external-editor");
        assert_eq!(EVENT_CTX_SIDEBAR_EXPORT_NETWORK, "context-menu://sidebar/export-network");
        assert_eq!(EVENT_CTX_SIDEBAR_TRASH, "context-menu://sidebar/trash");
    }

    #[test]
    fn from_id_maps_sidebar_ids() {
        assert_eq!(
            ContextMenuAction::from_id(CTX_SIDEBAR_RENAME),
            Some(ContextMenuAction::SidebarRename)
        );
        assert_eq!(
            ContextMenuAction::from_id(CTX_SIDEBAR_EXTERNAL_EDITOR),
            Some(ContextMenuAction::SidebarExternalEditor)
        );
        assert_eq!(
            ContextMenuAction::from_id(CTX_SIDEBAR_EXPORT_NETWORK),
            Some(ContextMenuAction::SidebarExportNetwork)
        );
        assert_eq!(
            ContextMenuAction::from_id(CTX_SIDEBAR_TRASH),
            Some(ContextMenuAction::SidebarTrash)
        );
    }

    #[test]
    fn sidebar_menu_items_returns_four_specs() {
        let items = sidebar_menu_items();
        assert_eq!(items.len(), 4);
        assert_eq!(items[0].id, CTX_SIDEBAR_RENAME);
        assert_eq!(items[0].label, "Rename");
        assert!(items[0].enabled);
        assert_eq!(items[1].id, CTX_SIDEBAR_EXTERNAL_EDITOR);
        assert_eq!(items[1].label, "Open in External Editor");
        assert!(items[1].enabled);
        assert_eq!(items[2].id, CTX_SIDEBAR_EXPORT_NETWORK);
        assert_eq!(items[2].label, "Export Local Network\u{2026}");
        assert!(items[2].enabled);
        assert_eq!(items[3].id, CTX_SIDEBAR_TRASH);
        assert_eq!(items[3].label, "Move to Trash");
        assert!(items[3].enabled);
    }

    #[test]
    fn sidebar_context_menu_ids_do_not_collide_with_app_menu_ids() {
        use crate::menu;
        let app_menu_ids = [
            menu::MENU_ID_OPEN_WORKSPACE,
            menu::MENU_ID_INSTALL_CLI,
            menu::MENU_ID_OPEN_PREFERENCES,
            menu::MENU_ID_OPEN_IN_EXTERNAL_EDITOR,
            menu::MENU_ID_CLOSE,
            menu::MENU_ID_EXPORT_MARKDOWN,
            menu::MENU_ID_BUY_LICENSE,
            menu::MENU_ID_ENTER_LICENSE_KEY,
            menu::MENU_ID_LICENSE_INFO,
            menu::MENU_ID_ABOUT,
        ];
        let ctx_ids = [
            CTX_SIDEBAR_RENAME,
            CTX_SIDEBAR_EXTERNAL_EDITOR,
            CTX_SIDEBAR_EXPORT_NETWORK,
            CTX_SIDEBAR_TRASH,
        ];
        for ctx_id in &ctx_ids {
            for app_id in &app_menu_ids {
                assert_ne!(ctx_id, app_id, "Context menu ID {ctx_id} collides with app menu ID {app_id}");
            }
        }
    }

    #[test]
    fn sidebar_ids_do_not_collide_with_trash_ids() {
        let trash_ids = [CTX_TRASH_RESTORE, CTX_TRASH_PURGE];
        let sidebar_ids = [
            CTX_SIDEBAR_RENAME,
            CTX_SIDEBAR_EXTERNAL_EDITOR,
            CTX_SIDEBAR_EXPORT_NETWORK,
            CTX_SIDEBAR_TRASH,
        ];
        for sid in &sidebar_ids {
            for tid in &trash_ids {
                assert_ne!(sid, tid, "Sidebar ID {sid} collides with trash ID {tid}");
            }
        }
    }

    #[test]
    fn dispatch_sidebar_rename_returns_correct_event_and_payload() {
        let (event, payload) = dispatch_sidebar_action(ContextMenuAction::SidebarRename, "notes.md");
        assert_eq!(event, EVENT_CTX_SIDEBAR_RENAME);
        assert_eq!(payload.relative_path, "notes.md");
    }

    #[test]
    fn dispatch_sidebar_external_editor_returns_correct_event_and_payload() {
        let (event, payload) = dispatch_sidebar_action(ContextMenuAction::SidebarExternalEditor, "docs/readme.md");
        assert_eq!(event, EVENT_CTX_SIDEBAR_EXTERNAL_EDITOR);
        assert_eq!(payload.relative_path, "docs/readme.md");
    }

    #[test]
    fn dispatch_sidebar_export_network_returns_correct_event_and_payload() {
        let (event, payload) = dispatch_sidebar_action(ContextMenuAction::SidebarExportNetwork, "graph.md");
        assert_eq!(event, EVENT_CTX_SIDEBAR_EXPORT_NETWORK);
        assert_eq!(payload.relative_path, "graph.md");
    }

    #[test]
    fn dispatch_sidebar_trash_returns_correct_event_and_payload() {
        let (event, payload) = dispatch_sidebar_action(ContextMenuAction::SidebarTrash, "old.md");
        assert_eq!(event, EVENT_CTX_SIDEBAR_TRASH);
        assert_eq!(payload.relative_path, "old.md");
    }

    #[test]
    fn mindmap_context_menu_ids_are_defined() {
        assert_eq!(CTX_MINDMAP_EDIT, "ctx_mindmap_edit");
        assert_eq!(CTX_MINDMAP_EXPORT_NETWORK, "ctx_mindmap_export_network");
    }

    #[test]
    fn mindmap_event_constants_are_defined() {
        assert_eq!(EVENT_CTX_MINDMAP_EDIT, "context-menu://mindmap/edit");
        assert_eq!(EVENT_CTX_MINDMAP_EXPORT_NETWORK, "context-menu://mindmap/export-network");
    }

    #[test]
    fn from_id_maps_mindmap_ids() {
        assert_eq!(
            ContextMenuAction::from_id(CTX_MINDMAP_EDIT),
            Some(ContextMenuAction::MindmapEdit)
        );
        assert_eq!(
            ContextMenuAction::from_id(CTX_MINDMAP_EXPORT_NETWORK),
            Some(ContextMenuAction::MindmapExportNetwork)
        );
    }

    #[test]
    fn mindmap_context_menu_ids_do_not_collide_with_app_menu_ids() {
        use crate::menu;
        let app_menu_ids = [
            menu::MENU_ID_OPEN_WORKSPACE,
            menu::MENU_ID_INSTALL_CLI,
            menu::MENU_ID_OPEN_PREFERENCES,
            menu::MENU_ID_OPEN_IN_EXTERNAL_EDITOR,
            menu::MENU_ID_CLOSE,
            menu::MENU_ID_EXPORT_MARKDOWN,
            menu::MENU_ID_BUY_LICENSE,
            menu::MENU_ID_ENTER_LICENSE_KEY,
            menu::MENU_ID_LICENSE_INFO,
            menu::MENU_ID_ABOUT,
        ];
        let ctx_ids = [CTX_MINDMAP_EDIT, CTX_MINDMAP_EXPORT_NETWORK];
        for ctx_id in &ctx_ids {
            for app_id in &app_menu_ids {
                assert_ne!(ctx_id, app_id, "Mindmap menu ID {ctx_id} collides with app menu ID {app_id}");
            }
        }
    }

    #[test]
    fn mindmap_ids_do_not_collide_with_trash_ids() {
        let trash_ids = [CTX_TRASH_RESTORE, CTX_TRASH_PURGE];
        let mindmap_ids = [CTX_MINDMAP_EDIT, CTX_MINDMAP_EXPORT_NETWORK];
        for mid in &mindmap_ids {
            for tid in &trash_ids {
                assert_ne!(mid, tid, "Mindmap ID {mid} collides with trash ID {tid}");
            }
        }
    }

    #[test]
    fn mindmap_ids_do_not_collide_with_sidebar_ids() {
        let sidebar_ids = [
            CTX_SIDEBAR_RENAME,
            CTX_SIDEBAR_EXTERNAL_EDITOR,
            CTX_SIDEBAR_EXPORT_NETWORK,
            CTX_SIDEBAR_TRASH,
        ];
        let mindmap_ids = [CTX_MINDMAP_EDIT, CTX_MINDMAP_EXPORT_NETWORK];
        for mid in &mindmap_ids {
            for sid in &sidebar_ids {
                assert_ne!(mid, sid, "Mindmap ID {mid} collides with sidebar ID {sid}");
            }
        }
    }

    #[test]
    fn mindmap_menu_items_without_export_returns_one_spec() {
        let items = mindmap_menu_items(false);
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].id, CTX_MINDMAP_EDIT);
        assert_eq!(items[0].label, "Edit");
        assert!(items[0].enabled);
    }

    #[test]
    fn mindmap_menu_items_with_export_returns_two_specs() {
        let items = mindmap_menu_items(true);
        assert_eq!(items.len(), 2);
        assert_eq!(items[0].id, CTX_MINDMAP_EDIT);
        assert_eq!(items[0].label, "Edit");
        assert!(items[0].enabled);
        assert_eq!(items[1].id, CTX_MINDMAP_EXPORT_NETWORK);
        assert_eq!(items[1].label, "Export Local Network\u{2026}");
        assert!(items[1].enabled);
    }

    #[test]
    fn dispatch_mindmap_edit_returns_correct_event_and_payload() {
        let (event, payload) = dispatch_mindmap_action(ContextMenuAction::MindmapEdit, "node-123");
        assert_eq!(event, EVENT_CTX_MINDMAP_EDIT);
        assert_eq!(payload.node_id, "node-123");
    }

    #[test]
    fn dispatch_mindmap_export_network_returns_correct_event_and_payload() {
        let (event, payload) = dispatch_mindmap_action(ContextMenuAction::MindmapExportNetwork, "node-456");
        assert_eq!(event, EVENT_CTX_MINDMAP_EXPORT_NETWORK);
        assert_eq!(payload.node_id, "node-456");
    }

    // --- Cycle 4.1: Graph context menu ---

    #[test]
    fn graph_context_menu_ids_are_defined() {
        assert_eq!(CTX_GRAPH_MERGE, "ctx_graph_merge");
        assert_eq!(CTX_GRAPH_SPLIT, "ctx_graph_split");
        assert_eq!(CTX_GRAPH_DELETE, "ctx_graph_delete");
        assert_eq!(CTX_GRAPH_EXPORT_NETWORK, "ctx_graph_export_network");
    }

    #[test]
    fn graph_event_constants_are_defined() {
        assert_eq!(EVENT_CTX_GRAPH_MERGE, "context-menu://graph/merge");
        assert_eq!(EVENT_CTX_GRAPH_SPLIT, "context-menu://graph/split");
        assert_eq!(EVENT_CTX_GRAPH_DELETE, "context-menu://graph/delete");
        assert_eq!(EVENT_CTX_GRAPH_EXPORT_NETWORK, "context-menu://graph/export-network");
    }

    #[test]
    fn from_id_maps_graph_ids() {
        assert_eq!(
            ContextMenuAction::from_id(CTX_GRAPH_MERGE),
            Some(ContextMenuAction::GraphMerge)
        );
        assert_eq!(
            ContextMenuAction::from_id(CTX_GRAPH_SPLIT),
            Some(ContextMenuAction::GraphSplit)
        );
        assert_eq!(
            ContextMenuAction::from_id(CTX_GRAPH_DELETE),
            Some(ContextMenuAction::GraphDelete)
        );
        assert_eq!(
            ContextMenuAction::from_id(CTX_GRAPH_EXPORT_NETWORK),
            Some(ContextMenuAction::GraphExportNetwork)
        );
    }

    #[test]
    fn graph_menu_items_multi_selection_shows_merge_hides_split() {
        let ctx = GraphMenuContext {
            selection_count: 3,
            has_headings: false,
            has_export: false,
            is_shadow: false,
        };
        let items = graph_menu_items(&ctx);
        assert!(items.iter().any(|i| i.id == CTX_GRAPH_MERGE
            && i.label == "Merge 3 documents"
            && i.enabled));
        assert!(!items.iter().any(|i| i.id == CTX_GRAPH_SPLIT));
        assert!(items.iter().any(|i| i.id == CTX_GRAPH_DELETE
            && i.label == "Delete 3 documents"));
        assert!(!items.iter().any(|i| i.id == CTX_GRAPH_EXPORT_NETWORK));
    }

    #[test]
    fn graph_menu_items_no_selection_with_headings_shows_split_enabled() {
        let ctx = GraphMenuContext {
            selection_count: 0,
            has_headings: true,
            has_export: false,
            is_shadow: false,
        };
        let items = graph_menu_items(&ctx);
        assert!(!items.iter().any(|i| i.id == CTX_GRAPH_MERGE));
        assert!(items.iter().any(|i| i.id == CTX_GRAPH_SPLIT && i.enabled));
        assert!(items.iter().any(|i| i.id == CTX_GRAPH_DELETE
            && i.label == "Delete document"));
    }

    #[test]
    fn graph_menu_items_single_selection_without_headings_split_disabled() {
        let ctx = GraphMenuContext {
            selection_count: 1,
            has_headings: false,
            has_export: false,
            is_shadow: false,
        };
        let items = graph_menu_items(&ctx);
        assert!(items.iter().any(|i| i.id == CTX_GRAPH_SPLIT && !i.enabled));
    }

    #[test]
    fn graph_menu_items_with_export() {
        let ctx = GraphMenuContext {
            selection_count: 0,
            has_headings: false,
            has_export: true,
            is_shadow: false,
        };
        let items = graph_menu_items(&ctx);
        assert!(items.iter().any(|i| i.id == CTX_GRAPH_EXPORT_NETWORK
            && i.label == "Export Local Network\u{2026}"
            && i.enabled));
    }

    #[test]
    fn graph_menu_items_without_export() {
        let ctx = GraphMenuContext {
            selection_count: 0,
            has_headings: false,
            has_export: false,
            is_shadow: false,
        };
        let items = graph_menu_items(&ctx);
        assert!(!items.iter().any(|i| i.id == CTX_GRAPH_EXPORT_NETWORK));
    }

    #[test]
    fn graph_ids_do_not_collide_with_app_menu_ids() {
        use crate::menu;
        let app_menu_ids = [
            menu::MENU_ID_OPEN_WORKSPACE,
            menu::MENU_ID_INSTALL_CLI,
            menu::MENU_ID_OPEN_PREFERENCES,
            menu::MENU_ID_OPEN_IN_EXTERNAL_EDITOR,
            menu::MENU_ID_CLOSE,
            menu::MENU_ID_EXPORT_MARKDOWN,
            menu::MENU_ID_BUY_LICENSE,
            menu::MENU_ID_ENTER_LICENSE_KEY,
            menu::MENU_ID_LICENSE_INFO,
            menu::MENU_ID_ABOUT,
        ];
        let graph_ids = [
            CTX_GRAPH_MERGE,
            CTX_GRAPH_SPLIT,
            CTX_GRAPH_DELETE,
            CTX_GRAPH_EXPORT_NETWORK,
            CTX_GRAPH_FETCH_DETAILS,
            CTX_GRAPH_CREATE_NOTE,
        ];
        for gid in &graph_ids {
            for aid in &app_menu_ids {
                assert_ne!(gid, aid, "Graph ID {gid} collides with app menu ID {aid}");
            }
        }
    }

    #[test]
    fn graph_ids_do_not_collide_with_other_context_menu_ids() {
        let other_ids = [
            CTX_TRASH_RESTORE,
            CTX_TRASH_PURGE,
            CTX_SIDEBAR_RENAME,
            CTX_SIDEBAR_EXTERNAL_EDITOR,
            CTX_SIDEBAR_EXPORT_NETWORK,
            CTX_SIDEBAR_TRASH,
            CTX_MINDMAP_EDIT,
            CTX_MINDMAP_EXPORT_NETWORK,
        ];
        let graph_ids = [
            CTX_GRAPH_MERGE,
            CTX_GRAPH_SPLIT,
            CTX_GRAPH_DELETE,
            CTX_GRAPH_EXPORT_NETWORK,
            CTX_GRAPH_FETCH_DETAILS,
            CTX_GRAPH_CREATE_NOTE,
        ];
        for gid in &graph_ids {
            for oid in &other_ids {
                assert_ne!(gid, oid, "Graph ID {gid} collides with context menu ID {oid}");
            }
        }
    }

    // --- Cycle 4.2: Graph IPC command with pre-computed context ---

    #[test]
    fn dispatch_graph_merge_returns_correct_event_and_payload() {
        let (event, payload) = dispatch_graph_action(
            ContextMenuAction::GraphMerge,
            "node-1",
            &["node-1".to_string(), "node-2".to_string(), "node-3".to_string()],
        );
        assert_eq!(event, EVENT_CTX_GRAPH_MERGE);
        assert_eq!(payload.node_id, "node-1");
        assert_eq!(payload.node_ids, vec!["node-1", "node-2", "node-3"]);
    }

    #[test]
    fn dispatch_graph_split_returns_correct_event_and_payload() {
        let (event, payload) = dispatch_graph_action(
            ContextMenuAction::GraphSplit,
            "node-42",
            &[],
        );
        assert_eq!(event, EVENT_CTX_GRAPH_SPLIT);
        assert_eq!(payload.node_id, "node-42");
    }

    #[test]
    fn dispatch_graph_delete_returns_correct_event_and_payload() {
        let (event, payload) = dispatch_graph_action(
            ContextMenuAction::GraphDelete,
            "node-5",
            &["node-5".to_string(), "node-6".to_string()],
        );
        assert_eq!(event, EVENT_CTX_GRAPH_DELETE);
        assert_eq!(payload.node_id, "node-5");
        assert_eq!(payload.node_ids, vec!["node-5", "node-6"]);
    }

    #[test]
    fn dispatch_graph_export_returns_correct_event_and_payload() {
        let (event, payload) = dispatch_graph_action(
            ContextMenuAction::GraphExportNetwork,
            "node-99",
            &[],
        );
        assert_eq!(event, EVENT_CTX_GRAPH_EXPORT_NETWORK);
        assert_eq!(payload.node_id, "node-99");
    }

    #[test]
    fn graph_context_payload_serializes_correctly() {
        let payload = GraphContextPayload {
            node_id: "abc".to_string(),
            node_ids: vec!["abc".to_string(), "def".to_string()],
        };
        let json = serde_json::to_value(&payload).unwrap();
        assert_eq!(json["node_id"], "abc");
        assert_eq!(json["node_ids"], serde_json::json!(["abc", "def"]));
    }

    // --- Phase 6: Graph "Fetch details" context menu for shadow nodes ---

    #[test]
    fn graph_fetch_details_constant_equals_expected_value() {
        assert_eq!(CTX_GRAPH_FETCH_DETAILS, "ctx_graph_fetch_details");
    }

    #[test]
    fn graph_fetch_details_event_constant_equals_expected_value() {
        assert_eq!(EVENT_CTX_GRAPH_FETCH_DETAILS, "context-menu://graph/fetch-details");
    }

    #[test]
    fn from_id_maps_graph_fetch_details() {
        assert_eq!(
            ContextMenuAction::from_id(CTX_GRAPH_FETCH_DETAILS),
            Some(ContextMenuAction::GraphFetchDetails)
        );
    }

    #[test]
    fn graph_menu_items_shadow_no_selection_includes_fetch_details() {
        let ctx = GraphMenuContext {
            selection_count: 0,
            has_headings: false,
            has_export: false,
            is_shadow: true,
        };
        let items = graph_menu_items(&ctx);
        assert!(items.iter().any(|i| i.id == CTX_GRAPH_FETCH_DETAILS
            && i.label == "Fetch details"
            && i.enabled));
    }

    #[test]
    fn graph_menu_items_shadow_single_selection_includes_fetch_details() {
        let ctx = GraphMenuContext {
            selection_count: 1,
            has_headings: false,
            has_export: false,
            is_shadow: true,
        };
        let items = graph_menu_items(&ctx);
        assert!(items.iter().any(|i| i.id == CTX_GRAPH_FETCH_DETAILS));
    }

    #[test]
    fn graph_menu_items_shadow_multi_selection_excludes_fetch_details() {
        let ctx = GraphMenuContext {
            selection_count: 2,
            has_headings: false,
            has_export: false,
            is_shadow: true,
        };
        let items = graph_menu_items(&ctx);
        assert!(!items.iter().any(|i| i.id == CTX_GRAPH_FETCH_DETAILS));
    }

    #[test]
    fn graph_menu_items_not_shadow_excludes_fetch_details() {
        let ctx = GraphMenuContext {
            selection_count: 0,
            has_headings: false,
            has_export: false,
            is_shadow: false,
        };
        let items = graph_menu_items(&ctx);
        assert!(!items.iter().any(|i| i.id == CTX_GRAPH_FETCH_DETAILS));
    }

    #[test]
    fn graph_menu_items_not_shadow_with_selection_excludes_fetch_details() {
        let ctx = GraphMenuContext {
            selection_count: 1,
            has_headings: true,
            has_export: true,
            is_shadow: false,
        };
        let items = graph_menu_items(&ctx);
        assert!(!items.iter().any(|i| i.id == CTX_GRAPH_FETCH_DETAILS));
    }

    #[test]
    fn graph_menu_items_shadow_fetch_details_appears_first() {
        let ctx = GraphMenuContext {
            selection_count: 0,
            has_headings: false,
            has_export: true,
            is_shadow: true,
        };
        let items = graph_menu_items(&ctx);
        assert_eq!(items[0].id, CTX_GRAPH_FETCH_DETAILS);
    }

    #[test]
    fn dispatch_graph_fetch_details_returns_correct_event_and_payload() {
        let (event, payload) = dispatch_graph_action(
            ContextMenuAction::GraphFetchDetails,
            "bib:smith2024",
            &[],
        );
        assert_eq!(event, EVENT_CTX_GRAPH_FETCH_DETAILS);
        assert_eq!(payload.node_id, "bib:smith2024");
    }

    // --- Phase 7: Graph "Create note" context menu for shadow nodes ---

    #[test]
    fn graph_create_note_constant_equals_expected_value() {
        assert_eq!(CTX_GRAPH_CREATE_NOTE, "ctx_graph_create_note");
    }

    #[test]
    fn graph_create_note_event_constant_equals_expected_value() {
        assert_eq!(EVENT_CTX_GRAPH_CREATE_NOTE, "context-menu://graph/create-note");
    }

    #[test]
    fn from_id_maps_graph_create_note() {
        assert_eq!(
            ContextMenuAction::from_id(CTX_GRAPH_CREATE_NOTE),
            Some(ContextMenuAction::GraphCreateNote)
        );
    }

    #[test]
    fn graph_menu_items_shadow_no_selection_includes_create_note() {
        let ctx = GraphMenuContext {
            selection_count: 0,
            has_headings: false,
            has_export: false,
            is_shadow: true,
        };
        let items = graph_menu_items(&ctx);
        assert!(items.iter().any(|i| i.id == CTX_GRAPH_CREATE_NOTE
            && i.label == "Create note"
            && i.enabled));
    }

    #[test]
    fn graph_menu_items_shadow_single_selection_includes_create_note() {
        let ctx = GraphMenuContext {
            selection_count: 1,
            has_headings: false,
            has_export: false,
            is_shadow: true,
        };
        let items = graph_menu_items(&ctx);
        assert!(items.iter().any(|i| i.id == CTX_GRAPH_CREATE_NOTE));
    }

    #[test]
    fn graph_menu_items_shadow_multi_selection_excludes_create_note() {
        let ctx = GraphMenuContext {
            selection_count: 2,
            has_headings: false,
            has_export: false,
            is_shadow: true,
        };
        let items = graph_menu_items(&ctx);
        assert!(!items.iter().any(|i| i.id == CTX_GRAPH_CREATE_NOTE));
    }

    #[test]
    fn graph_menu_items_not_shadow_excludes_create_note() {
        let ctx = GraphMenuContext {
            selection_count: 0,
            has_headings: false,
            has_export: false,
            is_shadow: false,
        };
        let items = graph_menu_items(&ctx);
        assert!(!items.iter().any(|i| i.id == CTX_GRAPH_CREATE_NOTE));
    }

    #[test]
    fn graph_menu_items_shadow_create_note_appears_after_fetch_details() {
        let ctx = GraphMenuContext {
            selection_count: 0,
            has_headings: false,
            has_export: true,
            is_shadow: true,
        };
        let items = graph_menu_items(&ctx);
        let fetch_idx = items.iter().position(|i| i.id == CTX_GRAPH_FETCH_DETAILS).unwrap();
        let create_idx = items.iter().position(|i| i.id == CTX_GRAPH_CREATE_NOTE).unwrap();
        assert_eq!(create_idx, fetch_idx + 1);
    }

    #[test]
    fn dispatch_graph_create_note_returns_correct_event_and_payload() {
        let (event, payload) = dispatch_graph_action(
            ContextMenuAction::GraphCreateNote,
            "bib:jones2023",
            &[],
        );
        assert_eq!(event, EVENT_CTX_GRAPH_CREATE_NOTE);
        assert_eq!(payload.node_id, "bib:jones2023");
    }

    #[test]
    fn context_menu_context_graph_variant_stores_all_fields() {
        let ctx = ContextMenuContext::Graph {
            node_id: "n1".to_string(),
            node_ids: vec!["n1".to_string(), "n2".to_string()],
        };
        match ctx {
            ContextMenuContext::Graph { node_id, node_ids } => {
                assert_eq!(node_id, "n1");
                assert_eq!(node_ids, vec!["n1", "n2"]);
            }
            _ => panic!("Expected Graph variant"),
        }
    }

    // --- Cardbox context menu ---

    #[test]
    fn cardbox_context_menu_ids_are_defined() {
        assert_eq!(CTX_CARDBOX_NEW_GROUP, "ctx_cardbox_new_group");
        assert_eq!(CTX_CARDBOX_ADD_TO_GROUP, "ctx_cardbox_add_to_group");
        assert_eq!(CTX_CARDBOX_REMOVE_FROM_GROUP, "ctx_cardbox_remove_from_group");
        assert_eq!(CTX_CARDBOX_DISSOLVE_GROUP, "ctx_cardbox_dissolve_group");
        assert_eq!(CTX_CARDBOX_RENAME_GROUP, "ctx_cardbox_rename_group");
        assert_eq!(CTX_CARDBOX_PIN, "ctx_cardbox_pin");
        assert_eq!(CTX_CARDBOX_UNPIN, "ctx_cardbox_unpin");
    }

    #[test]
    fn cardbox_event_constants_are_defined() {
        assert_eq!(EVENT_CTX_CARDBOX_NEW_GROUP, "context-menu://cardbox/new-group");
        assert_eq!(EVENT_CTX_CARDBOX_ADD_TO_GROUP, "context-menu://cardbox/add-to-group");
        assert_eq!(EVENT_CTX_CARDBOX_REMOVE_FROM_GROUP, "context-menu://cardbox/remove-from-group");
        assert_eq!(EVENT_CTX_CARDBOX_DISSOLVE_GROUP, "context-menu://cardbox/dissolve-group");
        assert_eq!(EVENT_CTX_CARDBOX_RENAME_GROUP, "context-menu://cardbox/rename-group");
        assert_eq!(EVENT_CTX_CARDBOX_PIN, "context-menu://cardbox/pin");
        assert_eq!(EVENT_CTX_CARDBOX_UNPIN, "context-menu://cardbox/unpin");
    }

    #[test]
    fn from_id_maps_cardbox_ids() {
        assert_eq!(
            ContextMenuAction::from_id(CTX_CARDBOX_NEW_GROUP),
            Some(ContextMenuAction::CardboxNewGroup)
        );
        assert_eq!(
            ContextMenuAction::from_id(CTX_CARDBOX_ADD_TO_GROUP),
            Some(ContextMenuAction::CardboxAddToGroup)
        );
        assert_eq!(
            ContextMenuAction::from_id(CTX_CARDBOX_REMOVE_FROM_GROUP),
            Some(ContextMenuAction::CardboxRemoveFromGroup)
        );
        assert_eq!(
            ContextMenuAction::from_id(CTX_CARDBOX_DISSOLVE_GROUP),
            Some(ContextMenuAction::CardboxDissolveGroup)
        );
        assert_eq!(
            ContextMenuAction::from_id(CTX_CARDBOX_RENAME_GROUP),
            Some(ContextMenuAction::CardboxRenameGroup)
        );
    }

    #[test]
    fn cardbox_ids_do_not_collide_with_app_menu_ids() {
        use crate::menu;
        let app_menu_ids = [
            menu::MENU_ID_OPEN_WORKSPACE,
            menu::MENU_ID_INSTALL_CLI,
            menu::MENU_ID_OPEN_PREFERENCES,
            menu::MENU_ID_OPEN_IN_EXTERNAL_EDITOR,
            menu::MENU_ID_CLOSE,
            menu::MENU_ID_EXPORT_MARKDOWN,
            menu::MENU_ID_BUY_LICENSE,
            menu::MENU_ID_ENTER_LICENSE_KEY,
            menu::MENU_ID_LICENSE_INFO,
            menu::MENU_ID_ABOUT,
        ];
        let cardbox_ids = [
            CTX_CARDBOX_NEW_GROUP,
            CTX_CARDBOX_ADD_TO_GROUP,
            CTX_CARDBOX_REMOVE_FROM_GROUP,
            CTX_CARDBOX_DISSOLVE_GROUP,
            CTX_CARDBOX_RENAME_GROUP,
            CTX_CARDBOX_PIN,
            CTX_CARDBOX_UNPIN,
        ];
        for cid in &cardbox_ids {
            for aid in &app_menu_ids {
                assert_ne!(cid, aid, "Cardbox ID {cid} collides with app menu ID {aid}");
            }
        }
    }

    #[test]
    fn cardbox_ids_do_not_collide_with_other_context_menu_ids() {
        let other_ids = [
            CTX_TRASH_RESTORE,
            CTX_TRASH_PURGE,
            CTX_SIDEBAR_RENAME,
            CTX_SIDEBAR_EXTERNAL_EDITOR,
            CTX_SIDEBAR_EXPORT_NETWORK,
            CTX_SIDEBAR_TRASH,
            CTX_MINDMAP_EDIT,
            CTX_MINDMAP_EXPORT_NETWORK,
            CTX_GRAPH_MERGE,
            CTX_GRAPH_SPLIT,
            CTX_GRAPH_DELETE,
            CTX_GRAPH_EXPORT_NETWORK,
            CTX_GRAPH_FETCH_DETAILS,
            CTX_GRAPH_CREATE_NOTE,
        ];
        let cardbox_ids = [
            CTX_CARDBOX_NEW_GROUP,
            CTX_CARDBOX_ADD_TO_GROUP,
            CTX_CARDBOX_REMOVE_FROM_GROUP,
            CTX_CARDBOX_DISSOLVE_GROUP,
            CTX_CARDBOX_RENAME_GROUP,
            CTX_CARDBOX_PIN,
            CTX_CARDBOX_UNPIN,
        ];
        for cid in &cardbox_ids {
            for oid in &other_ids {
                assert_ne!(cid, oid, "Cardbox ID {cid} collides with context menu ID {oid}");
            }
        }
    }

    fn flat_items(entries: &[MenuEntry]) -> Vec<&MenuItemSpec> {
        entries.iter().filter_map(|e| match e {
            MenuEntry::Item(s) => Some(s),
            _ => None,
        }).collect()
    }

    fn find_submenu<'a>(entries: &'a [MenuEntry], label: &str) -> Option<&'a Vec<MenuItemSpec>> {
        entries.iter().find_map(|e| match e {
            MenuEntry::Submenu { label: l, items } if l == label => Some(items),
            _ => None,
        })
    }

    #[test]
    fn cardbox_menu_items_ungrouped_card_without_groups() {
        let ctx = CardboxMenuContext {
            is_grouped: false,
            is_group_header: false,
            has_groups: false,
            is_pinned: false,
        };
        let entries = cardbox_menu_items(&ctx, None);
        let items = flat_items(&entries);
        assert_eq!(items.len(), 2);
        assert_eq!(items[0].id, CTX_CARDBOX_NEW_GROUP);
        assert_eq!(items[0].label, "New Group");
        assert!(items[0].enabled);
        // Should have a Color submenu
        assert!(find_submenu(&entries, "Color").is_some());
    }

    #[test]
    fn cardbox_menu_items_ungrouped_card_with_groups() {
        let ctx = CardboxMenuContext {
            is_grouped: false,
            is_group_header: false,
            has_groups: true,
            is_pinned: false,
        };
        let entries = cardbox_menu_items(&ctx, None);
        let items = flat_items(&entries);
        assert_eq!(items.len(), 3);
        assert_eq!(items[0].id, CTX_CARDBOX_NEW_GROUP);
        assert_eq!(items[0].label, "New Group");
        assert!(items[0].enabled);
        assert_eq!(items[1].id, CTX_CARDBOX_ADD_TO_GROUP);
        assert_eq!(items[1].label, "Add to Group\u{2026}");
        assert!(items[1].enabled);
        // Should have a Color submenu
        assert!(find_submenu(&entries, "Color").is_some());
    }

    #[test]
    fn cardbox_menu_items_grouped_card() {
        let ctx = CardboxMenuContext {
            is_grouped: true,
            is_group_header: false,
            has_groups: true,
            is_pinned: false,
        };
        let entries = cardbox_menu_items(&ctx, None);
        let items = flat_items(&entries);
        assert_eq!(items.len(), 2);
        assert_eq!(items[0].id, CTX_CARDBOX_REMOVE_FROM_GROUP);
        assert_eq!(items[0].label, "Remove from Group");
        assert!(items[0].enabled);
        // Should have a Color submenu
        assert!(find_submenu(&entries, "Color").is_some());
    }

    #[test]
    fn cardbox_menu_items_group_header() {
        let ctx = CardboxMenuContext {
            is_grouped: false,
            is_group_header: true,
            has_groups: true,
            is_pinned: false,
        };
        let entries = cardbox_menu_items(&ctx, None);
        let items = flat_items(&entries);
        assert_eq!(items.len(), 2);
        assert_eq!(items[0].id, CTX_CARDBOX_RENAME_GROUP);
        assert_eq!(items[0].label, "Rename Group");
        assert!(items[0].enabled);
        assert_eq!(items[1].id, CTX_CARDBOX_DISSOLVE_GROUP);
        assert_eq!(items[1].label, "Dissolve Group");
        assert!(items[1].enabled);
        // Group headers should NOT have a Color submenu
        assert!(find_submenu(&entries, "Color").is_none());
    }

    #[test]
    fn dispatch_cardbox_actions() {
        // New Group
        let (event, payload) = dispatch_cardbox_action(
            ContextMenuAction::CardboxNewGroup,
            Some("uuid-1".to_string()),
            None,
        );
        assert_eq!(event, EVENT_CTX_CARDBOX_NEW_GROUP);
        assert_eq!(payload.card_uuid.as_deref(), Some("uuid-1"));
        assert!(payload.group_id.is_none());

        // Add to Group
        let (event, payload) = dispatch_cardbox_action(
            ContextMenuAction::CardboxAddToGroup,
            Some("uuid-2".to_string()),
            None,
        );
        assert_eq!(event, EVENT_CTX_CARDBOX_ADD_TO_GROUP);
        assert_eq!(payload.card_uuid.as_deref(), Some("uuid-2"));

        // Remove from Group
        let (event, payload) = dispatch_cardbox_action(
            ContextMenuAction::CardboxRemoveFromGroup,
            Some("uuid-3".to_string()),
            Some("group-a".to_string()),
        );
        assert_eq!(event, EVENT_CTX_CARDBOX_REMOVE_FROM_GROUP);
        assert_eq!(payload.card_uuid.as_deref(), Some("uuid-3"));
        assert_eq!(payload.group_id.as_deref(), Some("group-a"));

        // Dissolve Group
        let (event, payload) = dispatch_cardbox_action(
            ContextMenuAction::CardboxDissolveGroup,
            None,
            Some("group-b".to_string()),
        );
        assert_eq!(event, EVENT_CTX_CARDBOX_DISSOLVE_GROUP);
        assert!(payload.card_uuid.is_none());
        assert_eq!(payload.group_id.as_deref(), Some("group-b"));

        // Rename Group
        let (event, payload) = dispatch_cardbox_action(
            ContextMenuAction::CardboxRenameGroup,
            None,
            Some("group-c".to_string()),
        );
        assert_eq!(event, EVENT_CTX_CARDBOX_RENAME_GROUP);
        assert_eq!(payload.group_id.as_deref(), Some("group-c"));
    }

    #[test]
    fn cardbox_context_payload_serializes_correctly() {
        let payload = CardboxContextPayload {
            card_uuid: Some("abc".to_string()),
            group_id: Some("grp-1".to_string()),
            color: None,
        };
        let json = serde_json::to_value(&payload).unwrap();
        assert_eq!(json["card_uuid"], "abc");
        assert_eq!(json["group_id"], "grp-1");
        assert!(json["color"].is_null());

        let payload_none = CardboxContextPayload {
            card_uuid: None,
            group_id: None,
            color: None,
        };
        let json_none = serde_json::to_value(&payload_none).unwrap();
        assert!(json_none["card_uuid"].is_null());
        assert!(json_none["group_id"].is_null());
        assert!(json_none["color"].is_null());
    }

    #[test]
    fn cardbox_context_payload_serializes_with_color() {
        let payload = CardboxContextPayload {
            card_uuid: Some("abc".to_string()),
            group_id: None,
            color: Some("blue".to_string()),
        };
        let json = serde_json::to_value(&payload).unwrap();
        assert_eq!(json["card_uuid"], "abc");
        assert!(json["group_id"].is_null());
        assert_eq!(json["color"], "blue");
    }

    // --- Color submenu tests ---

    #[test]
    fn color_submenu_items_none_current_checks_none_option() {
        let items = color_submenu_items(None);
        assert_eq!(items.len(), 7);
        // "None" should have a checkmark
        let none_item = items.iter().find(|i| i.id == CTX_CARDBOX_COLOR_NONE).unwrap();
        assert!(none_item.label.starts_with('\u{2713}'));
        // Other items should not
        let blue_item = items.iter().find(|i| i.id == CTX_CARDBOX_COLOR_BLUE).unwrap();
        assert!(!blue_item.label.starts_with('\u{2713}'));
    }

    #[test]
    fn color_submenu_items_blue_current_checks_blue() {
        let items = color_submenu_items(Some("blue"));
        let blue_item = items.iter().find(|i| i.id == CTX_CARDBOX_COLOR_BLUE).unwrap();
        assert!(blue_item.label.starts_with('\u{2713}'));
        let none_item = items.iter().find(|i| i.id == CTX_CARDBOX_COLOR_NONE).unwrap();
        assert!(!none_item.label.starts_with('\u{2713}'));
    }

    #[test]
    fn color_submenu_items_has_all_seven_colors() {
        let items = color_submenu_items(None);
        let ids: Vec<&str> = items.iter().map(|i| i.id).collect();
        assert!(ids.contains(&CTX_CARDBOX_COLOR_BLUE));
        assert!(ids.contains(&CTX_CARDBOX_COLOR_ORANGE));
        assert!(ids.contains(&CTX_CARDBOX_COLOR_GREEN));
        assert!(ids.contains(&CTX_CARDBOX_COLOR_PURPLE));
        assert!(ids.contains(&CTX_CARDBOX_COLOR_PINK));
        assert!(ids.contains(&CTX_CARDBOX_COLOR_CYAN));
        assert!(ids.contains(&CTX_CARDBOX_COLOR_NONE));
    }

    #[test]
    fn color_id_prefix_stripping() {
        let id = CTX_CARDBOX_COLOR_BLUE;
        assert!(id.starts_with(CTX_CARDBOX_COLOR_PREFIX));
        let color_name = &id[CTX_CARDBOX_COLOR_PREFIX.len()..];
        assert_eq!(color_name, "blue");
    }

    #[test]
    fn color_none_id_prefix_stripping() {
        let id = CTX_CARDBOX_COLOR_NONE;
        assert!(id.starts_with(CTX_CARDBOX_COLOR_PREFIX));
        let color_name = &id[CTX_CARDBOX_COLOR_PREFIX.len()..];
        assert_eq!(color_name, "none");
    }

    #[test]
    fn cardbox_menu_ungrouped_color_submenu_has_seven_items() {
        let ctx = CardboxMenuContext {
            is_grouped: false,
            is_group_header: false,
            has_groups: false,
            is_pinned: false,
        };
        let entries = cardbox_menu_items(&ctx, None);
        let sub = find_submenu(&entries, "Color").expect("Color submenu missing");
        assert_eq!(sub.len(), 7);
    }

    #[test]
    fn cardbox_menu_grouped_color_submenu_has_seven_items() {
        let ctx = CardboxMenuContext {
            is_grouped: true,
            is_group_header: false,
            has_groups: true,
            is_pinned: false,
        };
        let entries = cardbox_menu_items(&ctx, Some("green"));
        let sub = find_submenu(&entries, "Color").expect("Color submenu missing");
        assert_eq!(sub.len(), 7);
        let green = sub.iter().find(|i| i.id == CTX_CARDBOX_COLOR_GREEN).unwrap();
        assert!(green.label.starts_with('\u{2713}'));
    }

    #[test]
    fn cardbox_color_ids_do_not_collide_with_other_ids() {
        let color_ids = [
            CTX_CARDBOX_COLOR_BLUE,
            CTX_CARDBOX_COLOR_ORANGE,
            CTX_CARDBOX_COLOR_GREEN,
            CTX_CARDBOX_COLOR_PURPLE,
            CTX_CARDBOX_COLOR_PINK,
            CTX_CARDBOX_COLOR_CYAN,
            CTX_CARDBOX_COLOR_NONE,
        ];
        let other_ids = [
            CTX_CARDBOX_NEW_GROUP,
            CTX_CARDBOX_ADD_TO_GROUP,
            CTX_CARDBOX_REMOVE_FROM_GROUP,
            CTX_CARDBOX_DISSOLVE_GROUP,
            CTX_CARDBOX_RENAME_GROUP,
            CTX_CARDBOX_PIN,
            CTX_CARDBOX_UNPIN,
        ];
        for cid in &color_ids {
            for oid in &other_ids {
                assert_ne!(cid, oid, "Color ID {cid} collides with cardbox ID {oid}");
            }
        }
    }
}
