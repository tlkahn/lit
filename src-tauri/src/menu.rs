use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::AppHandle;
use tauri::Wry;

pub const MENU_ID_OPEN_WORKSPACE: &str = "open_workspace";
pub const MENU_ID_INSTALL_CLI: &str = "install_cli";
pub const MENU_ID_OPEN_PREFERENCES: &str = "open_preferences";
pub const MENU_ID_OPEN_IN_EXTERNAL_EDITOR: &str = "open_in_external_editor";
pub const MENU_ID_BUY_LICENSE: &str = "buy_license";
pub const MENU_ID_ENTER_LICENSE_KEY: &str = "enter_license_key";
pub const MENU_ID_LICENSE_INFO: &str = "license_info";
pub const MENU_ID_ABOUT: &str = "show_about";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum MenuAction {
    OpenWorkspace,
    InstallCli,
    OpenPreferences,
    OpenInExternalEditor,
    BuyLicense,
    EnterLicenseKey,
    LicenseInfo,
    ShowAbout,
}

impl MenuAction {
    pub fn from_id(id: &str) -> Option<Self> {
        match id {
            MENU_ID_OPEN_WORKSPACE => Some(Self::OpenWorkspace),
            MENU_ID_INSTALL_CLI => Some(Self::InstallCli),
            MENU_ID_OPEN_PREFERENCES => Some(Self::OpenPreferences),
            MENU_ID_OPEN_IN_EXTERNAL_EDITOR => Some(Self::OpenInExternalEditor),
            MENU_ID_BUY_LICENSE => Some(Self::BuyLicense),
            MENU_ID_ENTER_LICENSE_KEY => Some(Self::EnterLicenseKey),
            MENU_ID_LICENSE_INFO => Some(Self::LicenseInfo),
            MENU_ID_ABOUT => Some(Self::ShowAbout),
            _ => None,
        }
    }
}

pub(crate) fn execute_action(action: MenuAction, app: &AppHandle) {
    match action {
        MenuAction::OpenWorkspace => {
            let handle = app.clone();
            tauri::async_runtime::spawn(async move {
                use tauri_plugin_dialog::DialogExt;
                let dialog = handle.dialog().clone();
                dialog.file().pick_folder(move |folder| {
                    if let Some(path) = folder {
                        let p = path.to_string();
                        let _ = crate::commands::workspace::create_workspace_window(
                            &handle,
                            Some(p),
                            None,
                            None,
                            None,
                        );
                    }
                });
            });
        }
        MenuAction::InstallCli => {
            let handle = app.clone();
            tauri::async_runtime::spawn(async move {
                use tauri_plugin_dialog::DialogExt;
                let result = crate::commands::cli::install_cli(handle.clone());
                let dialog = handle.dialog();
                match result {
                    Ok(()) => {
                        dialog
                            .message("Command line tool installed at /usr/local/bin/lit")
                            .title("Success")
                            .blocking_show();
                    }
                    Err(e) => {
                        dialog
                            .message(format!("Failed to install: {e}"))
                            .title("Error")
                            .blocking_show();
                    }
                }
            });
        }
        MenuAction::OpenPreferences => {
            let handle = app.clone();
            tauri::async_runtime::spawn(async move {
                crate::preferences::seed_default_if_missing(&handle);
                let path = crate::preferences::preferences_path(&handle);
                if let Some(path_str) = path.to_str() {
                    use tauri_plugin_opener::OpenerExt;
                    let _ = handle.opener().open_path(path_str, None::<&str>);
                }
            });
        }
        MenuAction::OpenInExternalEditor => {
            use tauri::Emitter;
            let _ = app.emit("menu://open-in-external-editor", ());
        }
        MenuAction::ShowAbout => {
            let handle = app.clone();
            tauri::async_runtime::spawn(async move {
                use tauri_plugin_dialog::DialogExt;
                handle
                    .dialog()
                    .message(format!("Lit v{}", env!("CARGO_PKG_VERSION")))
                    .title("About Lit")
                    .blocking_show();
            });
        }
        MenuAction::BuyLicense | MenuAction::EnterLicenseKey | MenuAction::LicenseInfo => {
            // Stubs — wired in #86
        }
    }
}

pub fn build_menu(app: &AppHandle) -> tauri::Result<Menu<Wry>> {
    let app_menu = Submenu::new(app, "Lit", true)?;
    app_menu.append(&MenuItem::with_id(app, MENU_ID_INSTALL_CLI, "Install Command Line Tool\u{2026}", true, None::<&str>)?)?;
    app_menu.append(&PredefinedMenuItem::separator(app)?)?;
    app_menu.append(&MenuItem::with_id(app, MENU_ID_OPEN_PREFERENCES, "Settings\u{2026}", true, Some("cmdOrCtrl+,"))?)?;
    app_menu.append(&PredefinedMenuItem::separator(app)?)?;
    #[cfg(target_os = "macos")]
    {
        app_menu.append(&PredefinedMenuItem::services(app, None)?)?;
        app_menu.append(&PredefinedMenuItem::separator(app)?)?;
        app_menu.append(&PredefinedMenuItem::hide(app, Some("Hide Lit"))?)?;
        app_menu.append(&PredefinedMenuItem::hide_others(app, None)?)?;
        app_menu.append(&PredefinedMenuItem::show_all(app, None)?)?;
        app_menu.append(&PredefinedMenuItem::separator(app)?)?;
    }
    app_menu.append(&PredefinedMenuItem::quit(app, Some("Quit Lit"))?)?;

    let file_menu = Submenu::with_items(
        app,
        "File",
        true,
        &[
            &MenuItem::with_id(app, MENU_ID_OPEN_WORKSPACE, "Open Another Workspace", true, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, MENU_ID_OPEN_IN_EXTERNAL_EDITOR, "Open in External Editor", true, Some("cmdOrCtrl+shift+e"))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::close_window(app, None)?,
        ],
    )?;

    let edit_menu = Submenu::with_items(
        app,
        "Edit",
        true,
        &[
            &PredefinedMenuItem::undo(app, None)?,
            &PredefinedMenuItem::redo(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, None)?,
            &PredefinedMenuItem::copy(app, None)?,
            &PredefinedMenuItem::paste(app, None)?,
            &PredefinedMenuItem::select_all(app, None)?,
        ],
    )?;

    let window_menu = Submenu::with_items(
        app,
        "Window",
        true,
        &[
            &PredefinedMenuItem::minimize(app, None)?,
            &PredefinedMenuItem::maximize(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::fullscreen(app, None)?,
        ],
    )?;

    let help_menu = Submenu::with_items(
        app,
        "Help",
        true,
        &[
            &MenuItem::with_id(app, MENU_ID_BUY_LICENSE, "Buy License", false, None::<&str>)?,
            &MenuItem::with_id(app, MENU_ID_ENTER_LICENSE_KEY, "Enter License Key\u{2026}", false, None::<&str>)?,
            &MenuItem::with_id(app, MENU_ID_LICENSE_INFO, "License\u{2026}", false, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, MENU_ID_ABOUT, "About Lit\u{2026}", true, None::<&str>)?,
        ],
    )?;

    Menu::with_items(app, &[&app_menu, &file_menu, &edit_menu, &window_menu, &help_menu])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn help_menu_ids_are_defined() {
        assert_eq!(MENU_ID_BUY_LICENSE, "buy_license");
        assert_eq!(MENU_ID_ENTER_LICENSE_KEY, "enter_license_key");
        assert_eq!(MENU_ID_LICENSE_INFO, "license_info");
        assert_eq!(MENU_ID_ABOUT, "show_about");
    }

    #[test]
    fn existing_menu_ids_are_defined() {
        assert_eq!(MENU_ID_OPEN_WORKSPACE, "open_workspace");
        assert_eq!(MENU_ID_INSTALL_CLI, "install_cli");
        assert_eq!(MENU_ID_OPEN_PREFERENCES, "open_preferences");
        assert_eq!(MENU_ID_OPEN_IN_EXTERNAL_EDITOR, "open_in_external_editor");
    }

    #[test]
    fn all_menu_ids_are_unique() {
        let ids = [
            MENU_ID_OPEN_WORKSPACE,
            MENU_ID_INSTALL_CLI,
            MENU_ID_OPEN_PREFERENCES,
            MENU_ID_OPEN_IN_EXTERNAL_EDITOR,
            MENU_ID_BUY_LICENSE,
            MENU_ID_ENTER_LICENSE_KEY,
            MENU_ID_LICENSE_INFO,
            MENU_ID_ABOUT,
        ];
        let mut seen = std::collections::HashSet::new();
        for id in &ids {
            assert!(seen.insert(id), "Duplicate menu ID: {}", id);
        }
    }

    #[test]
    fn from_id_maps_all_known_ids() {
        assert_eq!(MenuAction::from_id(MENU_ID_OPEN_WORKSPACE), Some(MenuAction::OpenWorkspace));
        assert_eq!(MenuAction::from_id(MENU_ID_INSTALL_CLI), Some(MenuAction::InstallCli));
        assert_eq!(MenuAction::from_id(MENU_ID_OPEN_PREFERENCES), Some(MenuAction::OpenPreferences));
        assert_eq!(MenuAction::from_id(MENU_ID_OPEN_IN_EXTERNAL_EDITOR), Some(MenuAction::OpenInExternalEditor));
        assert_eq!(MenuAction::from_id(MENU_ID_BUY_LICENSE), Some(MenuAction::BuyLicense));
        assert_eq!(MenuAction::from_id(MENU_ID_ENTER_LICENSE_KEY), Some(MenuAction::EnterLicenseKey));
        assert_eq!(MenuAction::from_id(MENU_ID_LICENSE_INFO), Some(MenuAction::LicenseInfo));
        assert_eq!(MenuAction::from_id(MENU_ID_ABOUT), Some(MenuAction::ShowAbout));
    }

    #[test]
    fn from_id_returns_none_for_unknown() {
        assert!(MenuAction::from_id("nonexistent").is_none());
    }
}
