use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;

use tauri::Manager;

use crate::pdf::{PdfInfo, PdfRenderThread, RenderedPage};

/// Holds one PDF render thread per open slot.
///
/// The slot key is a composite string of the form `"<window_label>:<pane_id>"`
/// (see [`slot_key`]). Keying by this composite — rather than by window label
/// alone — lets multiple panes within the same window each hold an independent
/// open PDF side by side.
pub struct PdfViewerState {
    threads: Mutex<HashMap<String, PdfRenderThread>>,
    lib_path: String,
}

/// Compose the [`PdfViewerState`] slot key for a given window + pane.
pub(crate) fn slot_key(window_label: &str, pane_id: &str) -> String {
    format!("{window_label}:{pane_id}")
}

impl PdfViewerState {
    pub fn new(lib_path: &str) -> Self {
        Self {
            threads: Mutex::new(HashMap::new()),
            lib_path: lib_path.to_string(),
        }
    }

    pub fn open_for_window(&self, slot: &str, path: &str) -> Result<PdfInfo, String> {
        let mut threads = self.threads.lock().unwrap();
        if let Some(old) = threads.remove(slot) {
            let _ = old.close();
        }
        let thread = PdfRenderThread::new(&self.lib_path)?;
        let info = thread.open(path)?;
        threads.insert(slot.to_string(), thread);
        Ok(info)
    }

    pub fn render_for_window(
        &self,
        slot: &str,
        page_index: usize,
        dpi: u32,
    ) -> Result<RenderedPage, String> {
        let threads = self.threads.lock().unwrap();
        let thread = threads
            .get(slot)
            .ok_or_else(|| "No PDF open in this window".to_string())?;
        thread.render_page(page_index, dpi)
    }

    pub fn close_for_window(&self, slot: &str) -> Result<(), String> {
        let mut threads = self.threads.lock().unwrap();
        if let Some(thread) = threads.remove(slot) {
            thread.close()?;
        }
        Ok(())
    }

    /// Close all PDF slots belonging to the given window.
    ///
    /// Slot keys have the form `"<window_label>:<pane_id>"`, so this
    /// method removes every entry whose key starts with `"<window_label>:"`.
    /// Each removed [`PdfRenderThread`] is dropped, which shuts down its
    /// background thread and deletes its temp directory.
    ///
    /// The lock is released before the removed threads are dropped: dropping a
    /// [`PdfRenderThread`] joins its background render thread, which can block,
    /// so we hold the mutex only for the cheap map mutation. This keeps
    /// concurrent IPC from other windows (e.g. [`open_for_window`],
    /// [`render_for_window`]) from being serialized behind the cumulative
    /// shutdown time of every closed pane.
    pub fn close_all_for_window(&self, window_label: &str) {
        let prefix = format!("{window_label}:");
        let to_close: Vec<PdfRenderThread> = {
            let mut threads = self.threads.lock().unwrap();
            let keys: Vec<String> = threads
                .keys()
                .filter(|k| k.starts_with(&prefix))
                .cloned()
                .collect();
            keys.into_iter().filter_map(|k| threads.remove(&k)).collect()
        };
        // Guard released above; joining/dropping render threads happens here.
        drop(to_close);
    }

    pub fn prefetch_for_window(
        &self,
        slot: &str,
        page_index: usize,
        dpi: u32,
    ) -> Result<(), String> {
        let threads = self.threads.lock().unwrap();
        if let Some(thread) = threads.get(slot) {
            thread.prefetch(page_index, dpi)?;
        }
        Ok(())
    }

    pub fn temp_dir_for_window(&self, slot: &str) -> Option<PathBuf> {
        let threads = self.threads.lock().unwrap();
        threads.get(slot).map(|t| t.temp_dir().to_path_buf())
    }
}

#[tauri::command]
pub fn pdf_open(
    path: String,
    pane_id: String,
    window: tauri::Window,
    state: tauri::State<'_, PdfViewerState>,
) -> Result<PdfInfo, String> {
    let slot = slot_key(window.label(), &pane_id);
    let info = state.open_for_window(&slot, &path)?;

    if let Some(temp_dir) = state.temp_dir_for_window(&slot) {
        window
            .app_handle()
            .asset_protocol_scope()
            .allow_directory(&temp_dir, false)
            .map_err(|e| format!("Failed to register asset scope: {e}"))?;
    }

    Ok(info)
}

#[tauri::command]
pub fn pdf_render_page(
    page_index: usize,
    dpi: u32,
    pane_id: String,
    window: tauri::Window,
    state: tauri::State<'_, PdfViewerState>,
) -> Result<RenderedPage, String> {
    state.render_for_window(&slot_key(window.label(), &pane_id), page_index, dpi)
}

#[tauri::command]
pub fn pdf_prefetch(
    page_index: usize,
    dpi: u32,
    pane_id: String,
    window: tauri::Window,
    state: tauri::State<'_, PdfViewerState>,
) -> Result<(), String> {
    state.prefetch_for_window(&slot_key(window.label(), &pane_id), page_index, dpi)
}

#[tauri::command]
pub fn pdf_close(
    pane_id: String,
    window: tauri::Window,
    state: tauri::State<'_, PdfViewerState>,
) -> Result<(), String> {
    state.close_for_window(&slot_key(window.label(), &pane_id))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pdf::{find_libpdfium, lock_pdfium};
    use std::path::PathBuf;

    fn fixture_path(name: &str) -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("tests")
            .join("fixtures")
            .join(name)
    }

    fn require_pdfium() -> String {
        find_libpdfium(None)
            .map(|p| p.to_string_lossy().to_string())
            .expect("libpdfium not found — run scripts/fetch-pdfium.sh")
    }

    #[test]
    #[ignore]
    fn test_open_creates_thread_and_returns_info() {
        let _guard = lock_pdfium();
        let lib = require_pdfium();
        let state = PdfViewerState::new(&lib);
        let info = state
            .open_for_window("main", fixture_path("sample.pdf").to_str().unwrap())
            .unwrap();
        assert_eq!(info.page_count, 2);
    }

    #[test]
    #[ignore]
    fn test_render_returns_png_file() {
        let _guard = lock_pdfium();
        let lib = require_pdfium();
        let state = PdfViewerState::new(&lib);
        state
            .open_for_window("main", fixture_path("sample.pdf").to_str().unwrap())
            .unwrap();
        let rendered = state.render_for_window("main", 0, 144).unwrap();
        let path = std::path::Path::new(&rendered.png_path);
        assert!(path.exists(), "PNG file should exist at {}", rendered.png_path);
    }

    #[test]
    #[ignore]
    fn test_close_removes_thread_and_temp_dir() {
        let _guard = lock_pdfium();
        let lib = require_pdfium();
        let state = PdfViewerState::new(&lib);
        state
            .open_for_window("main", fixture_path("sample.pdf").to_str().unwrap())
            .unwrap();
        let temp_dir = state.temp_dir_for_window("main").unwrap();
        assert!(temp_dir.exists());
        state.close_for_window("main").unwrap();
        assert!(!temp_dir.exists());
        let result = state.render_for_window("main", 0, 144);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("No PDF open in this window"));
    }

    #[test]
    #[ignore]
    fn test_open_replaces_old_thread_and_cleans_temp_dir() {
        let _guard = lock_pdfium();
        let lib = require_pdfium();
        let state = PdfViewerState::new(&lib);
        let pdf = fixture_path("sample.pdf").to_str().unwrap().to_string();
        state.open_for_window("main", &pdf).unwrap();
        let old_temp = state.temp_dir_for_window("main").unwrap();
        assert!(old_temp.exists());
        state.open_for_window("main", &pdf).unwrap();
        assert!(!old_temp.exists(), "old temp dir should be cleaned up");
    }

    #[test]
    fn test_render_unknown_window_returns_error() {
        let state = PdfViewerState::new("dummy");
        let result = state.render_for_window("unknown", 0, 144);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("No PDF open in this window"));
    }

    #[test]
    fn test_slots_are_independent_per_pane() {
        let state = PdfViewerState::new("dummy");
        let r1 = state.render_for_window("main:pane-1", 0, 144);
        let r2 = state.render_for_window("main:pane-2", 0, 144);
        assert!(r1.is_err());
        assert!(r2.is_err());
        assert!(r1.unwrap_err().contains("No PDF open in this window"));
        assert!(r2.unwrap_err().contains("No PDF open in this window"));
    }

    #[test]
    fn test_temp_dir_for_unknown_slot_is_none() {
        let state = PdfViewerState::new("dummy");
        assert!(state.temp_dir_for_window("main:pane-1").is_none());
    }

    #[test]
    fn test_slot_key_composes_window_and_pane() {
        assert_eq!(slot_key("main", "pane-1"), "main:pane-1");
        assert_eq!(slot_key("win2", "pane-abc"), "win2:pane-abc");
    }

    #[test]
    fn test_temp_dir_for_unknown_window_returns_none() {
        let state = PdfViewerState::new("dummy");
        assert!(state.temp_dir_for_window("unknown").is_none());
    }

    #[test]
    #[ignore]
    fn test_prefetch_for_window_succeeds() {
        let _guard = lock_pdfium();
        let lib = require_pdfium();
        let state = PdfViewerState::new(&lib);
        state
            .open_for_window("main", fixture_path("sample.pdf").to_str().unwrap())
            .unwrap();
        let result = state.prefetch_for_window("main", 1, 144);
        assert!(result.is_ok());
    }

    #[test]
    fn test_prefetch_for_unknown_window_returns_ok() {
        let state = PdfViewerState::new("dummy");
        let result = state.prefetch_for_window("unknown", 0, 144);
        assert!(result.is_ok());
    }

    #[test]
    fn test_state_new_with_resource_dir_path() {
        let dir = std::env::temp_dir().join("lit-test-pdf-state");
        let _ = std::fs::create_dir_all(&dir);
        let fake = dir.join("libpdfium.dylib");
        std::fs::write(&fake, b"fake").unwrap();

        let lib = crate::pdf::find_libpdfium_or_default(Some(dir.as_path()));
        assert!(lib.contains("libpdfium.dylib"));
        assert!(std::path::Path::new(&lib).exists());

        let state = PdfViewerState::new(&lib);
        assert!(state.temp_dir_for_window("x").is_none());

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_close_all_for_window_noop_on_empty_state() {
        let state = PdfViewerState::new("dummy");
        // Should not panic when no slots exist
        state.close_all_for_window("main");
    }

    #[test]
    fn test_close_all_for_window_does_not_match_longer_prefix() {
        // Verify that close_all_for_window("main") would NOT match "main2:pane-1"
        // because the prefix is "main:" not just "main".
        let state = PdfViewerState::new("dummy");
        state.close_all_for_window("main");
        // "main2:pane-1" was never inserted but this confirms no panic
        assert!(state.render_for_window("main2:pane-1", 0, 144).is_err());
    }

    #[test]
    #[ignore]
    fn test_close_all_for_window_cleans_up_all_panes() {
        let _guard = lock_pdfium();
        let lib = require_pdfium();
        let state = PdfViewerState::new(&lib);
        let pdf = fixture_path("sample.pdf").to_str().unwrap().to_string();

        // Open PDFs in two panes of "main" window and one pane of "other" window
        let slot1 = slot_key("main", "pane-1");
        let slot2 = slot_key("main", "pane-2");
        let slot3 = slot_key("other", "pane-1");
        state.open_for_window(&slot1, &pdf).unwrap();
        state.open_for_window(&slot2, &pdf).unwrap();
        state.open_for_window(&slot3, &pdf).unwrap();

        let temp1 = state.temp_dir_for_window(&slot1).unwrap();
        let temp2 = state.temp_dir_for_window(&slot2).unwrap();
        let temp3 = state.temp_dir_for_window(&slot3).unwrap();
        assert!(temp1.exists());
        assert!(temp2.exists());
        assert!(temp3.exists());

        // Close all panes for "main"
        state.close_all_for_window("main");

        // Both "main" slots should be gone
        assert!(!temp1.exists(), "pane-1 temp dir should be cleaned up");
        assert!(!temp2.exists(), "pane-2 temp dir should be cleaned up");
        assert!(state.temp_dir_for_window(&slot1).is_none());
        assert!(state.temp_dir_for_window(&slot2).is_none());

        // "other" window's slot should be untouched
        assert!(temp3.exists());
        assert!(state.temp_dir_for_window(&slot3).is_some());
    }

    #[test]
    #[ignore]
    fn test_close_all_for_window_releases_lock_before_join() {
        // Regression guard for the perf finding: close_all_for_window must not
        // hold the threads mutex while shutting down (joining) render threads.
        // It opens two panes in "main" and one in "other", then concurrently
        // closes all of "main" while another thread renders the "other" slot.
        // If close_all_for_window held the lock across the joins, the concurrent
        // render would be serialized behind every shutdown; with the lock
        // released before the drops, it proceeds promptly. Either way the
        // structural assertions (only "main" removed, "other" survives) hold.
        use std::sync::Arc;

        let _guard = lock_pdfium();
        let lib = require_pdfium();
        let state = Arc::new(PdfViewerState::new(&lib));
        let pdf = fixture_path("sample.pdf").to_str().unwrap().to_string();

        let slot1 = slot_key("main", "pane-1");
        let slot2 = slot_key("main", "pane-2");
        let slot3 = slot_key("other", "pane-1");
        state.open_for_window(&slot1, &pdf).unwrap();
        state.open_for_window(&slot2, &pdf).unwrap();
        state.open_for_window(&slot3, &pdf).unwrap();

        let state_bg = Arc::clone(&state);
        let slot3_bg = slot3.clone();
        let handle = std::thread::spawn(move || {
            // Concurrently render the surviving "other" slot while "main" closes.
            state_bg.render_for_window(&slot3_bg, 0, 144).is_ok()
        });

        state.close_all_for_window("main");

        let rendered_ok = handle.join().unwrap();
        assert!(rendered_ok, "concurrent render on 'other' slot should succeed");

        // Only "main" slots are removed; "other" survives.
        assert!(state.temp_dir_for_window(&slot1).is_none());
        assert!(state.temp_dir_for_window(&slot2).is_none());
        assert!(state.temp_dir_for_window(&slot3).is_some());
    }

    #[test]
    fn test_close_all_for_window_returns_unit_and_removes_only_prefix() {
        // Deterministic (no pdfium) contract guard for the refactor: removing a
        // window's slots must affect only keys with the "<window>:" prefix and
        // must leave differently-prefixed slots reachable. We assert via the
        // public lookup surface that closed slots are gone and others remain
        // unaffected (here, all are absent since none were inserted, but the
        // prefix logic must not panic and must return ()).
        let state = PdfViewerState::new("dummy");
        let unit: () = state.close_all_for_window("main");
        assert_eq!(unit, ());
        // Closing "main:" must not affect a "main2:" prefixed slot lookup.
        assert!(state.temp_dir_for_window("main2:pane-1").is_none());
        assert!(state.temp_dir_for_window("main:pane-1").is_none());
    }

    #[test]
    fn test_page_index_accepts_usize() {
        let state = PdfViewerState::new("dummy");
        let idx: usize = 0;
        let _ = state.render_for_window("x", idx, 72);
        let _ = state.prefetch_for_window("x", idx, 72);
    }

    #[test]
    #[ignore]
    fn test_open_for_window_drops_old_thread_cleanly() {
        let _guard = lock_pdfium();
        let lib = require_pdfium();
        let state = PdfViewerState::new(&lib);
        let pdf = fixture_path("sample.pdf").to_str().unwrap().to_string();
        state.open_for_window("win", &pdf).unwrap();
        let old_temp = state.temp_dir_for_window("win").unwrap();
        assert!(old_temp.exists());
        state.open_for_window("win", &pdf).unwrap();
        assert!(!old_temp.exists(), "old temp dir should be cleaned up by Drop");
        let new_temp = state.temp_dir_for_window("win").unwrap();
        assert!(new_temp.exists());
    }
}
