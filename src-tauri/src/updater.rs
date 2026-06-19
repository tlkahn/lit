use std::sync::atomic::{AtomicBool, Ordering};

use serde::Serialize;
use tauri::AppHandle;
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use tauri_plugin_updater::UpdaterExt;

#[derive(Serialize, Clone, Debug, PartialEq)]
pub(crate) struct UpdateDownloadProgress {
    pub downloaded: u64,
    pub total: Option<u64>,
}

static UPDATE_IN_PROGRESS: AtomicBool = AtomicBool::new(false);

#[must_use = "update guard is released immediately when dropped"]
struct UpdateGuard;

impl UpdateGuard {
    fn acquire() -> Option<UpdateGuard> {
        if UPDATE_IN_PROGRESS
            .compare_exchange(false, true, Ordering::Acquire, Ordering::Relaxed)
            .is_ok()
        {
            Some(UpdateGuard)
        } else {
            None
        }
    }
}

impl Drop for UpdateGuard {
    fn drop(&mut self) {
        UPDATE_IN_PROGRESS.store(false, Ordering::Release);
    }
}

pub(crate) async fn oneshot_bridge(
    start: impl FnOnce(Box<dyn FnOnce(bool) + Send + 'static>),
) -> bool {
    let (tx, rx) = tokio::sync::oneshot::channel();
    start(Box::new(move |result| {
        let _ = tx.send(result);
    }));
    rx.await.unwrap_or_else(|_| {
        tracing::warn!("dialog oneshot dropped without response — defaulting to false");
        false
    })
}

pub(crate) async fn show_dialog<R: tauri::Runtime>(
    builder: tauri_plugin_dialog::MessageDialogBuilder<R>,
) -> bool {
    oneshot_bridge(|cb| builder.show(cb)).await
}

/// Run the full install + restart flow for a found update.
/// Shows a download-error dialog on failure; prompts to restart on success.
async fn install_update(app: &AppHandle, update: tauri_plugin_updater::Update) {
    use tauri::Emitter;

    let handle = app.clone();
    let mut downloaded: u64 = 0;
    let mut last_emit = std::time::Instant::now();

    let on_chunk = move |chunk_bytes: usize, content_length: Option<u64>| {
        downloaded += chunk_bytes as u64;
        let now = std::time::Instant::now();
        let is_complete = content_length.is_some_and(|total| downloaded >= total);
        if is_complete || now.duration_since(last_emit).as_millis() >= 100 {
            last_emit = now;
            let _ = handle.emit(
                "lit:update-download-progress",
                UpdateDownloadProgress {
                    downloaded,
                    total: content_length,
                },
            );
        }
    };

    let finish_handle = app.clone();
    let on_finish = move || {
        let _ = finish_handle.emit("lit:update-installing", ());
    };

    match update.download_and_install(on_chunk, on_finish).await {
        Ok(()) => {
            let restart = show_dialog(
                app.dialog()
                    .message("Update installed. Restart Lit now to use the new version?")
                    .title("Update Ready")
                    .buttons(MessageDialogButtons::OkCancelCustom(
                        "Restart".to_string(),
                        "Later".to_string(),
                    )),
            )
            .await;
            if restart {
                app.restart();
            }
        }
        Err(e) => {
            app.dialog()
                .message(format!("Failed to install update: {e}"))
                .title("Update Error")
                .kind(MessageDialogKind::Error)
                .show(|_| {});
        }
    }
}

/// Prompt the user about a found update and, if accepted, install it.
async fn prompt_and_install(app: &AppHandle, update: tauri_plugin_updater::Update) {
    let install = show_dialog(
        app.dialog()
            .message(format!(
                "A new version of Lit is available.\n\nCurrent: {}\nLatest: {}",
                update.current_version, update.version
            ))
            .title("Update Available")
            .buttons(MessageDialogButtons::OkCancelCustom(
                "Install".to_string(),
                "Later".to_string(),
            )),
    )
    .await;
    if install {
        install_update(app, update).await;
    }
}

/// Interactive update check for the "Check for Updates..." menu item.
/// Shows a dialog in all cases: update available, up-to-date, or error.
pub async fn check_for_updates_interactive(app: &AppHandle) {
    let _guard = match UpdateGuard::acquire() {
        Some(g) => g,
        None => {
            app.dialog()
                .message(
                    "An update check is already in progress. Please wait for it to finish.",
                )
                .title("Update In Progress")
                .show(|_| {});
            return;
        }
    };

    let updater = match app.updater() {
        Ok(u) => u,
        Err(e) => {
            app.dialog()
                .message(format!("Could not initialize updater: {e}"))
                .title("Update Error")
                .kind(MessageDialogKind::Error)
                .show(|_| {});
            return;
        }
    };

    match updater.check().await {
        Ok(Some(update)) => {
            prompt_and_install(app, update).await;
        }
        Ok(None) => {
            app.dialog()
                .message("You're running the latest version of Lit.")
                .title("No Updates")
                .show(|_| {});
        }
        Err(e) => {
            app.dialog()
                .message(format!("Failed to check for updates: {e}"))
                .title("Update Error")
                .kind(MessageDialogKind::Error)
                .show(|_| {});
        }
    }
}

/// Silent update check for the launch-time auto-check.
/// Only shows a dialog when an update is found; logs errors instead of showing them.
pub async fn check_for_updates_silent(app: &AppHandle) {
    let _guard = match UpdateGuard::acquire() {
        Some(g) => g,
        None => {
            tracing::info!("update check already in progress; skipping silent check");
            return;
        }
    };

    let updater = match app.updater() {
        Ok(u) => u,
        Err(e) => {
            tracing::warn!("updater init failed: {e}");
            return;
        }
    };

    match updater.check().await {
        Ok(Some(update)) => {
            prompt_and_install(app, update).await;
        }
        Ok(None) => {}
        Err(e) => {
            tracing::warn!("update check failed: {e}");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Exercises the full guard lifecycle in a single sequential test, because
    /// `UPDATE_IN_PROGRESS` is a process-global static and splitting these into
    /// separate `#[test]` fns would let them run in parallel and corrupt each
    /// other's expectations.
    #[test]
    fn update_guard_serializes_access() {
        // First acquisition succeeds.
        let g1 = UpdateGuard::acquire();
        assert!(g1.is_some(), "first acquire should succeed");

        // Second acquisition while the first is held fails.
        assert!(
            UpdateGuard::acquire().is_none(),
            "second acquire should fail while guard is held"
        );

        // Dropping the first guard releases the lock.
        drop(g1);

        // After release, acquisition succeeds again.
        let g2 = UpdateGuard::acquire();
        assert!(g2.is_some(), "acquire should succeed after drop");

        // Releasing via end-of-scope also frees the lock for the next caller.
        drop(g2);
        let g3 = UpdateGuard::acquire();
        assert!(g3.is_some(), "acquire should succeed after scoped release");
    }

    #[tokio::test]
    async fn oneshot_bridge_returns_true_on_true() {
        assert!(oneshot_bridge(|cb| cb(true)).await);
    }

    #[tokio::test]
    async fn oneshot_bridge_returns_false_on_false() {
        assert!(!oneshot_bridge(|cb| cb(false)).await);
    }

    #[tokio::test]
    async fn oneshot_bridge_returns_false_on_dropped_callback() {
        assert!(!oneshot_bridge(|_cb| {}).await);
    }

    #[tokio::test]
    async fn oneshot_bridge_handles_deferred_callback() {
        assert!(oneshot_bridge(|cb| { tokio::spawn(async move { cb(true) }); }).await);
    }

    #[test]
    fn update_download_progress_serializes_with_total() {
        let p = UpdateDownloadProgress {
            downloaded: 1024,
            total: Some(4096),
        };
        let json = serde_json::to_value(&p).unwrap();
        assert_eq!(json["downloaded"], 1024);
        assert_eq!(json["total"], 4096);
    }

    #[test]
    fn update_download_progress_serializes_without_total() {
        let p = UpdateDownloadProgress {
            downloaded: 512,
            total: None,
        };
        let json = serde_json::to_value(&p).unwrap();
        assert_eq!(json["downloaded"], 512);
        assert!(json["total"].is_null());
    }
}
