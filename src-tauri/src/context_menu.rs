use serde::Serialize;
use std::sync::Mutex;
use tauri::menu::{ContextMenu, Menu, MenuItem};
use tauri::{Emitter, Manager, Wry};

pub const CTX_TRASH_RESTORE: &str = "ctx_trash_restore";
pub const CTX_TRASH_PURGE: &str = "ctx_trash_purge";

pub const EVENT_CTX_TRASH_RESTORE: &str = "context-menu://trash/restore";
pub const EVENT_CTX_TRASH_PURGE: &str = "context-menu://trash/purge";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ContextMenuAction {
    TrashRestore,
    TrashPurge,
}

impl ContextMenuAction {
    pub fn from_id(id: &str) -> Option<Self> {
        match id {
            CTX_TRASH_RESTORE => Some(Self::TrashRestore),
            CTX_TRASH_PURGE => Some(Self::TrashPurge),
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
    }
}

#[derive(Debug, Clone)]
pub enum ContextMenuContext {
    Trash { trash_name: String },
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
}
