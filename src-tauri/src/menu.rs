use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Emitter, Manager};
use tauri::Wry;

pub const MENU_ID_OPEN_WORKSPACE: &str = "open_workspace";
pub const MENU_ID_INSTALL_CLI: &str = "install_cli";
pub const MENU_ID_OPEN_PREFERENCES: &str = "open_preferences";
pub const MENU_ID_OPEN_IN_EXTERNAL_EDITOR: &str = "open_in_external_editor";
pub const MENU_ID_BUY_LICENSE: &str = "buy_license";
pub const MENU_ID_ENTER_LICENSE_KEY: &str = "enter_license_key";
pub const MENU_ID_LICENSE_INFO: &str = "license_info";
pub const MENU_ID_EXPORT_MARKDOWN: &str = "export_markdown";
pub const MENU_ID_EXPORT_LATEX: &str = "export_latex";
pub const MENU_ID_EXPORT_PDF: &str = "export_pdf";
pub const MENU_ID_EXPORT_HTML: &str = "export_html";
pub const MENU_ID_EXPORT_DOCX: &str = "export_docx";
pub const MENU_ID_EXPORT_LKG: &str = "export_lkg";
pub const MENU_ID_IMPORT_LKG: &str = "import_lkg";
pub const MENU_ID_CLOSE: &str = "close-pane";
pub const MENU_ID_ABOUT: &str = "show_about";

pub struct MenuShortcutDef {
    #[allow(dead_code)]
    pub menu_id: &'static str,
    pub command_id: &'static str,
    pub accelerator: &'static str,
    #[allow(dead_code)]
    pub label: &'static str,
}

pub const MENU_SHORTCUTS: &[MenuShortcutDef] = &[
    MenuShortcutDef { menu_id: MENU_ID_OPEN_PREFERENCES, command_id: "core.settings.open", accelerator: "cmdOrCtrl+,", label: "Settings" },
    MenuShortcutDef { menu_id: MENU_ID_EXPORT_MARKDOWN, command_id: "app.exportMarkdown", accelerator: "cmdOrCtrl+shift+s", label: "Export as Markdown Archive" },
    MenuShortcutDef { menu_id: MENU_ID_OPEN_IN_EXTERNAL_EDITOR, command_id: "editor.openInExternalEditor", accelerator: "cmdOrCtrl+shift+e", label: "Open in External Editor" },
    MenuShortcutDef { menu_id: MENU_ID_CLOSE, command_id: "pane.close", accelerator: "cmdOrCtrl+w", label: "Close" },
];

pub const EVENT_CLOSE_PANE: &str = "menu://close-pane";
pub const EVENT_OPEN_PREFERENCES: &str = "menu://open-preferences";
pub const EVENT_OPEN_IN_EXTERNAL_EDITOR: &str = "menu://open-in-external-editor";
pub const EVENT_BUY_LICENSE: &str = "menu://buy-license";
pub const EVENT_ENTER_LICENSE_KEY: &str = "menu://enter-license-key";
pub const EVENT_LICENSE_INFO: &str = "menu://license-info";
pub const EVENT_EXPORT_LATEX: &str = "menu://export-latex";
pub const EVENT_EXPORT_PDF: &str = "menu://export-pdf";
pub const EVENT_EXPORT_HTML: &str = "menu://export-html";
pub const EVENT_EXPORT_DOCX: &str = "menu://export-docx";
pub const EVENT_EXPORT_LKG: &str = "menu://export-lkg";
pub const EVENT_IMPORT_LKG: &str = "menu://import-lkg";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum MenuAction {
    OpenWorkspace,
    InstallCli,
    OpenPreferences,
    OpenInExternalEditor,
    ClosePane,
    BuyLicense,
    EnterLicenseKey,
    ExportMarkdown,
    ExportLatex,
    ExportPdf,
    ExportHtml,
    ExportDocx,
    ExportLkg,
    ImportLkg,
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
            MENU_ID_CLOSE => Some(Self::ClosePane),
            MENU_ID_BUY_LICENSE => Some(Self::BuyLicense),
            MENU_ID_ENTER_LICENSE_KEY => Some(Self::EnterLicenseKey),
            MENU_ID_LICENSE_INFO => Some(Self::LicenseInfo),
            MENU_ID_EXPORT_MARKDOWN => Some(Self::ExportMarkdown),
            MENU_ID_EXPORT_LATEX => Some(Self::ExportLatex),
            MENU_ID_EXPORT_PDF => Some(Self::ExportPdf),
            MENU_ID_EXPORT_HTML => Some(Self::ExportHtml),
            MENU_ID_EXPORT_DOCX => Some(Self::ExportDocx),
            MENU_ID_EXPORT_LKG => Some(Self::ExportLkg),
            MENU_ID_IMPORT_LKG => Some(Self::ImportLkg),
            MENU_ID_ABOUT => Some(Self::ShowAbout),
            _ => None,
        }
    }
}

/// Return the label of the first focused candidate, or `None`.
fn pick_focused_label(candidates: &[(String, bool)]) -> Option<String> {
    candidates
        .iter()
        .find(|(_, focused)| *focused)
        .map(|(label, _)| label.clone())
}

/// Find the focused window, or `None`. On macOS the menu bar can steal focus
/// briefly during selection, so callers must handle `None`.
fn find_focused_window(app: &AppHandle<Wry>) -> Option<tauri::WebviewWindow<Wry>> {
    let windows = app.webview_windows();
    let candidates: Vec<(String, bool)> = windows
        .iter()
        .map(|(label, window)| (label.clone(), window.is_focused().unwrap_or(false)))
        .collect();
    let label = pick_focused_label(&candidates)?;
    windows.get(&label).cloned()
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
            if let Some(window) = find_focused_window(app) {
                let _ = window.emit_to(window.label(), EVENT_OPEN_PREFERENCES, ());
            }
        }
        MenuAction::OpenInExternalEditor => {
            if let Some(window) = find_focused_window(app) {
                let _ = window.emit_to(window.label(), EVENT_OPEN_IN_EXTERNAL_EDITOR, ());
            }
        }
        MenuAction::ClosePane => {
            if let Some(window) = find_focused_window(app) {
                let _ = window.emit_to(window.label(), EVENT_CLOSE_PANE, ());
            }
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
        MenuAction::ExportMarkdown => {
            let handle = app.clone();
            let target_window = find_focused_window(app);
            tauri::async_runtime::spawn(async move {
                use tauri_plugin_dialog::DialogExt;
                let dialog = handle.dialog().clone();
                dialog
                    .file()
                    .set_file_name("export.zip")
                    .add_filter("ZIP Archive", &["zip"])
                    .save_file(move |path| {
                        if let Some(dest) = path {
                            let dest_str = dest.to_string();
                            if let Some(window) = target_window.clone() {
                                let state: tauri::State<crate::commands::workspace::WorkspaceRegistry> = handle.state();
                                let root = match crate::commands::workspace::get_workspace_root(&state, window.label()) {
                                    Ok(r) => r,
                                    Err(e) => {
                                        handle.dialog().message(format!("Export failed: {e}")).title("Export Error").blocking_show();
                                        return;
                                    }
                                };
                                let dest_path = std::path::PathBuf::from(&dest_str);
                                let dialog_handle = handle.clone();
                                std::thread::spawn(move || {
                                    match crate::export::run_export(&root, &dest_path, |current, total| {
                                        let _ = window.emit_to(window.label(), "lit:export-progress", crate::export::ExportProgress { current, total });
                                    }) {
                                        Ok(summary) => {
                                            let _ = window.emit_to(window.label(), "lit:export-complete", summary);
                                        }
                                        Err(e) => {
                                            dialog_handle.dialog().message(format!("Export failed: {e}")).title("Export Error").blocking_show();
                                        }
                                    }
                                });
                            }
                        }
                    });
            });
        }
        MenuAction::ExportLatex => {
            if let Some(window) = find_focused_window(app) {
                let _ = window.emit_to(window.label(), EVENT_EXPORT_LATEX, ());
            }
        }
        MenuAction::ExportPdf => {
            if let Some(window) = find_focused_window(app) {
                let _ = window.emit_to(window.label(), EVENT_EXPORT_PDF, ());
            }
        }
        MenuAction::ExportHtml => {
            if let Some(window) = find_focused_window(app) {
                let _ = window.emit_to(window.label(), EVENT_EXPORT_HTML, ());
            }
        }
        MenuAction::ExportDocx => {
            if let Some(window) = find_focused_window(app) {
                let _ = window.emit_to(window.label(), EVENT_EXPORT_DOCX, ());
            }
        }
        MenuAction::ExportLkg => {
            if let Some(window) = find_focused_window(app) {
                let _ = window.emit_to(window.label(), EVENT_EXPORT_LKG, ());
            }
        }
        MenuAction::ImportLkg => {
            if let Some(window) = find_focused_window(app) {
                let _ = window.emit_to(window.label(), EVENT_IMPORT_LKG, ());
            }
        }
        MenuAction::BuyLicense => {
            let _ = app.emit(EVENT_BUY_LICENSE, ());
        }
        MenuAction::EnterLicenseKey => {
            let _ = app.emit(EVENT_ENTER_LICENSE_KEY, ());
        }
        MenuAction::LicenseInfo => {
            let _ = app.emit(EVENT_LICENSE_INFO, ());
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

    let export_submenu = Submenu::with_items(
        app,
        "Export",
        true,
        &[
            &MenuItem::with_id(app, MENU_ID_EXPORT_MARKDOWN, "Export as Markdown Archive\u{2026}", true, Some("cmdOrCtrl+shift+s"))?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, MENU_ID_EXPORT_LATEX, "Export to LaTeX\u{2026}", true, None::<&str>)?,
            &MenuItem::with_id(app, MENU_ID_EXPORT_PDF, "Export to PDF\u{2026}", true, None::<&str>)?,
            &MenuItem::with_id(app, MENU_ID_EXPORT_HTML, "Export to HTML\u{2026}", true, None::<&str>)?,
            &MenuItem::with_id(app, MENU_ID_EXPORT_DOCX, "Export to DOCX\u{2026}", true, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, MENU_ID_EXPORT_LKG, "Export as Knowledge Graph Bundle\u{2026}", true, None::<&str>)?,
        ],
    )?;

    let file_menu = Submenu::with_items(
        app,
        "File",
        true,
        &[
            &MenuItem::with_id(app, MENU_ID_OPEN_WORKSPACE, "Open Another Workspace", true, None::<&str>)?,
            &MenuItem::with_id(app, MENU_ID_IMPORT_LKG, "Import Knowledge Graph Bundle\u{2026}", true, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &export_submenu,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, MENU_ID_OPEN_IN_EXTERNAL_EDITOR, "Open in External Editor", true, Some("cmdOrCtrl+shift+e"))?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, MENU_ID_CLOSE, "Close", true, Some("cmdOrCtrl+w"))?,
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

    // Build the Help menu via append() so the purchase-related items can be
    // cfg-gated out for App Store builds (where the App Store handles purchase
    // and license restoration).
    let help_menu = Submenu::new(app, "Help", true)?;
    #[cfg(not(feature = "app-store"))]
    {
        help_menu.append(&MenuItem::with_id(app, MENU_ID_BUY_LICENSE, "Buy License", true, None::<&str>)?)?;
        help_menu.append(&MenuItem::with_id(app, MENU_ID_ENTER_LICENSE_KEY, "Enter License Key\u{2026}", true, None::<&str>)?)?;
    }
    help_menu.append(&MenuItem::with_id(app, MENU_ID_LICENSE_INFO, "License\u{2026}", true, None::<&str>)?)?;
    help_menu.append(&PredefinedMenuItem::separator(app)?)?;
    help_menu.append(&MenuItem::with_id(app, MENU_ID_ABOUT, "About Lit\u{2026}", true, None::<&str>)?)?;

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
    fn academic_export_menu_ids_are_defined() {
        assert_eq!(MENU_ID_EXPORT_LATEX, "export_latex");
        assert_eq!(MENU_ID_EXPORT_PDF, "export_pdf");
        assert_eq!(MENU_ID_EXPORT_HTML, "export_html");
        assert_eq!(MENU_ID_EXPORT_DOCX, "export_docx");
    }

    #[test]
    fn academic_export_event_constants_defined() {
        assert_eq!(EVENT_EXPORT_LATEX, "menu://export-latex");
        assert_eq!(EVENT_EXPORT_PDF, "menu://export-pdf");
        assert_eq!(EVENT_EXPORT_HTML, "menu://export-html");
        assert_eq!(EVENT_EXPORT_DOCX, "menu://export-docx");
    }

    #[test]
    fn academic_export_from_id() {
        assert_eq!(MenuAction::from_id(MENU_ID_EXPORT_LATEX), Some(MenuAction::ExportLatex));
        assert_eq!(MenuAction::from_id(MENU_ID_EXPORT_PDF), Some(MenuAction::ExportPdf));
        assert_eq!(MenuAction::from_id(MENU_ID_EXPORT_HTML), Some(MenuAction::ExportHtml));
        assert_eq!(MenuAction::from_id(MENU_ID_EXPORT_DOCX), Some(MenuAction::ExportDocx));
    }

    #[test]
    fn lkg_bundle_menu_ids_are_defined() {
        assert_eq!(MENU_ID_EXPORT_LKG, "export_lkg");
        assert_eq!(MENU_ID_IMPORT_LKG, "import_lkg");
    }

    #[test]
    fn lkg_bundle_event_constants_defined() {
        assert_eq!(EVENT_EXPORT_LKG, "menu://export-lkg");
        assert_eq!(EVENT_IMPORT_LKG, "menu://import-lkg");
    }

    #[test]
    fn lkg_bundle_from_id() {
        assert_eq!(MenuAction::from_id(MENU_ID_EXPORT_LKG), Some(MenuAction::ExportLkg));
        assert_eq!(MenuAction::from_id(MENU_ID_IMPORT_LKG), Some(MenuAction::ImportLkg));
    }

    #[test]
    fn all_menu_ids_are_unique() {
        let ids = [
            MENU_ID_OPEN_WORKSPACE,
            MENU_ID_INSTALL_CLI,
            MENU_ID_OPEN_PREFERENCES,
            MENU_ID_OPEN_IN_EXTERNAL_EDITOR,
            MENU_ID_CLOSE,
            MENU_ID_EXPORT_MARKDOWN,
            MENU_ID_EXPORT_LATEX,
            MENU_ID_EXPORT_PDF,
            MENU_ID_EXPORT_HTML,
            MENU_ID_EXPORT_DOCX,
            MENU_ID_EXPORT_LKG,
            MENU_ID_IMPORT_LKG,
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
        assert_eq!(MenuAction::from_id(MENU_ID_CLOSE), Some(MenuAction::ClosePane));
        assert_eq!(MenuAction::from_id(MENU_ID_EXPORT_MARKDOWN), Some(MenuAction::ExportMarkdown));
        assert_eq!(MenuAction::from_id(MENU_ID_EXPORT_LATEX), Some(MenuAction::ExportLatex));
        assert_eq!(MenuAction::from_id(MENU_ID_EXPORT_PDF), Some(MenuAction::ExportPdf));
        assert_eq!(MenuAction::from_id(MENU_ID_EXPORT_HTML), Some(MenuAction::ExportHtml));
        assert_eq!(MenuAction::from_id(MENU_ID_EXPORT_DOCX), Some(MenuAction::ExportDocx));
        assert_eq!(MenuAction::from_id(MENU_ID_EXPORT_LKG), Some(MenuAction::ExportLkg));
        assert_eq!(MenuAction::from_id(MENU_ID_IMPORT_LKG), Some(MenuAction::ImportLkg));
        assert_eq!(MenuAction::from_id(MENU_ID_BUY_LICENSE), Some(MenuAction::BuyLicense));
        assert_eq!(MenuAction::from_id(MENU_ID_ENTER_LICENSE_KEY), Some(MenuAction::EnterLicenseKey));
        assert_eq!(MenuAction::from_id(MENU_ID_LICENSE_INFO), Some(MenuAction::LicenseInfo));
        assert_eq!(MenuAction::from_id(MENU_ID_ABOUT), Some(MenuAction::ShowAbout));
    }

    #[test]
    fn from_id_returns_none_for_unknown() {
        assert!(MenuAction::from_id("nonexistent").is_none());
    }

    #[test]
    fn menu_event_name_constants_defined() {
        assert_eq!(EVENT_CLOSE_PANE, "menu://close-pane");
        assert_eq!(EVENT_OPEN_PREFERENCES, "menu://open-preferences");
        assert_eq!(EVENT_OPEN_IN_EXTERNAL_EDITOR, "menu://open-in-external-editor");
        assert_eq!(EVENT_BUY_LICENSE, "menu://buy-license");
        assert_eq!(EVENT_ENTER_LICENSE_KEY, "menu://enter-license-key");
        assert_eq!(EVENT_LICENSE_INFO, "menu://license-info");
    }

    #[test]
    fn find_focused_window_exists() {
        let _: fn(&AppHandle<Wry>) -> Option<tauri::WebviewWindow<Wry>> = find_focused_window;
    }

    #[test]
    fn pick_focused_label_returns_focused() {
        let candidates = vec![
            ("a".to_string(), false),
            ("b".to_string(), true),
            ("c".to_string(), false),
        ];
        assert_eq!(pick_focused_label(&candidates), Some("b".to_string()));
    }

    #[test]
    fn pick_focused_label_returns_first_focused() {
        let candidates = vec![("a".to_string(), true), ("b".to_string(), true)];
        assert_eq!(pick_focused_label(&candidates), Some("a".to_string()));
    }

    #[test]
    fn pick_focused_label_none_when_no_focus() {
        let candidates = vec![("a".to_string(), false), ("b".to_string(), false)];
        assert_eq!(pick_focused_label(&candidates), None);
    }

    #[test]
    fn pick_focused_label_empty_is_none() {
        let candidates: Vec<(String, bool)> = vec![];
        assert_eq!(pick_focused_label(&candidates), None);
    }

    #[test]
    fn export_markdown_menu_action() {
        assert_eq!(MENU_ID_EXPORT_MARKDOWN, "export_markdown");
        assert_eq!(
            MenuAction::from_id("export_markdown"),
            Some(MenuAction::ExportMarkdown)
        );
    }
}
