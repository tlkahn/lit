use serde::Serialize;
use std::sync::Mutex;
use tauri::menu::{ContextMenu, Menu, MenuItem};
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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ContextMenuAction {
    TrashRestore,
    TrashPurge,
    SidebarRename,
    SidebarExternalEditor,
    SidebarExportNetwork,
    SidebarTrash,
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
    pub label: &'static str,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct SidebarContextPayload {
    pub relative_path: String,
}

pub fn sidebar_menu_items() -> Vec<MenuItemSpec> {
    vec![
        MenuItemSpec {
            id: CTX_SIDEBAR_RENAME,
            label: "Rename",
            enabled: true,
        },
        MenuItemSpec {
            id: CTX_SIDEBAR_EXTERNAL_EDITOR,
            label: "Open in External Editor",
            enabled: true,
        },
        MenuItemSpec {
            id: CTX_SIDEBAR_EXPORT_NETWORK,
            label: "Export Local Network\u{2026}",
            enabled: true,
        },
        MenuItemSpec {
            id: CTX_SIDEBAR_TRASH,
            label: "Move to Trash",
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
            label: "Restore",
            enabled: true,
        },
        MenuItemSpec {
            id: CTX_TRASH_PURGE,
            label: "Delete Permanently",
            enabled: true,
        },
    ]
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
}

pub struct PendingContextMenu(pub Mutex<Option<ContextMenuContext>>);

impl Default for PendingContextMenu {
    fn default() -> Self {
        Self(Mutex::new(None))
    }
}

fn show_popup_menu(
    specs: &[MenuItemSpec],
    window: &tauri::Window<Wry>,
) -> Result<(), String> {
    let app = window.app_handle();
    let items: Vec<MenuItem<Wry>> = specs
        .iter()
        .map(|s| MenuItem::with_id(app, s.id, s.label, s.enabled, None::<&str>))
        .collect::<Result<_, _>>()
        .map_err(|e| e.to_string())?;
    let item_refs: Vec<&dyn tauri::menu::IsMenuItem<Wry>> =
        items.iter().map(|i| i as &dyn tauri::menu::IsMenuItem<Wry>).collect();
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
    let specs = trash_menu_items();
    show_popup_menu(&specs, &window)
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
    let specs = sidebar_menu_items();
    show_popup_menu(&specs, &window)
}

pub fn handle_context_menu_event(app: &tauri::AppHandle, menu_id: &str) {
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
    }
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
}
