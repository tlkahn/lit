use tauri::AppHandle;
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use tauri_plugin_updater::UpdaterExt;

/// Run the full install + restart flow for a found update.
/// Shows a download-error dialog on failure; prompts to restart on success.
async fn install_update(app: &AppHandle, update: tauri_plugin_updater::Update) {
    match update.download_and_install(|_chunk, _total| {}, || {}).await {
        Ok(()) => {
            let restart = app
                .dialog()
                .message("Update installed. Restart Lit now to use the new version?")
                .title("Update Ready")
                .buttons(MessageDialogButtons::OkCancelCustom(
                    "Restart".to_string(),
                    "Later".to_string(),
                ))
                .blocking_show();
            if restart {
                app.restart();
            }
        }
        Err(e) => {
            app.dialog()
                .message(format!("Failed to install update: {e}"))
                .title("Update Error")
                .kind(MessageDialogKind::Error)
                .blocking_show();
        }
    }
}

/// Interactive update check for the "Check for Updates..." menu item.
/// Shows a dialog in all cases: update available, up-to-date, or error.
pub async fn check_for_updates_interactive(app: &AppHandle) {
    let updater = match app.updater() {
        Ok(u) => u,
        Err(e) => {
            app.dialog()
                .message(format!("Could not initialize updater: {e}"))
                .title("Update Error")
                .kind(MessageDialogKind::Error)
                .blocking_show();
            return;
        }
    };

    match updater.check().await {
        Ok(Some(update)) => {
            let install = app
                .dialog()
                .message(format!(
                    "A new version of Lit is available.\n\nCurrent: {}\nLatest: {}",
                    update.current_version, update.version
                ))
                .title("Update Available")
                .buttons(MessageDialogButtons::OkCancelCustom(
                    "Install".to_string(),
                    "Later".to_string(),
                ))
                .blocking_show();
            if install {
                install_update(app, update).await;
            }
        }
        Ok(None) => {
            app.dialog()
                .message("You're running the latest version of Lit.")
                .title("No Updates")
                .blocking_show();
        }
        Err(e) => {
            app.dialog()
                .message(format!("Failed to check for updates: {e}"))
                .title("Update Error")
                .kind(MessageDialogKind::Error)
                .blocking_show();
        }
    }
}

/// Silent update check for the launch-time auto-check.
/// Only shows a dialog when an update is found; logs errors instead of showing them.
pub async fn check_for_updates_silent(app: &AppHandle) {
    let updater = match app.updater() {
        Ok(u) => u,
        Err(e) => {
            tracing::warn!("updater init failed: {e}");
            return;
        }
    };

    match updater.check().await {
        Ok(Some(update)) => {
            let install = app
                .dialog()
                .message(format!(
                    "A new version of Lit is available.\n\nCurrent: {}\nLatest: {}",
                    update.current_version, update.version
                ))
                .title("Update Available")
                .buttons(MessageDialogButtons::OkCancelCustom(
                    "Install".to_string(),
                    "Later".to_string(),
                ))
                .blocking_show();
            if install {
                install_update(app, update).await;
            }
        }
        Ok(None) => {}
        Err(e) => {
            tracing::warn!("update check failed: {e}");
        }
    }
}
