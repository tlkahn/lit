use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::AppHandle;
use tauri::Wry;

pub fn build_menu(app: &AppHandle) -> tauri::Result<Menu<Wry>> {
    let app_menu = Submenu::new(app, "Lit", true)?;
    app_menu.append(&PredefinedMenuItem::about(app, Some("About Lit"), None)?)?;
    app_menu.append(&PredefinedMenuItem::separator(app)?)?;
    app_menu.append(&MenuItem::with_id(app, "install_cli", "Install Command Line Tool\u{2026}", true, None::<&str>)?)?;
    app_menu.append(&PredefinedMenuItem::separator(app)?)?;
    app_menu.append(&MenuItem::with_id(app, "open_preferences", "Settings\u{2026}", true, Some("cmdOrCtrl+,"))?)?;
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
            &MenuItem::with_id(app, "open_workspace", "Open Another Workspace", true, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "open_in_external_editor", "Open in External Editor", true, Some("cmdOrCtrl+shift+e"))?,
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

    Menu::with_items(app, &[&app_menu, &file_menu, &edit_menu, &window_menu])
}
