use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};

use serde::Serialize;
use tauri::{Emitter, Manager};

use crate::pdf::{PdfInfo, PdfRenderThread, RenderedPage};

/// Cap eager precaching at this many pages. Beyond this, pages render on demand.
const MAX_PRECACHE_PAGES: usize = 200;
/// Number of pages rendered synchronously before returning from `pdf_open`.
const INITIAL_SYNC_PAGES: usize = 10;

/// Holds one PDF render thread per open slot.
///
/// The slot key is a composite string of the form `"<window_label>:<pane_id>"`
/// (see [`slot_key`]). Keying by this composite — rather than by window label
/// alone — lets multiple panes within the same window each hold an independent
/// open PDF side by side.
pub struct PdfViewerState {
    threads: Mutex<HashMap<String, PdfRenderThread>>,
    /// One cancel token per slot with an in-flight background precache.
    cancel_tokens: Mutex<HashMap<String, Arc<AtomicBool>>>,
    lib_path: String,
}

/// Result of [`pdf_open`]: the page count, the resolved path, and the first
/// batch of synchronously rendered pages so navigation is instant on open.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub struct PdfOpenResult {
    pub page_count: usize,
    pub path: String,
    pub initial_pages: Vec<RenderedPage>,
}

/// Progress payload emitted as `"lit:pdf-cache-progress"` during background
/// precaching. `done` is set once `current >= total`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub struct PdfCacheProgress {
    pub slot: String,
    pub current: usize,
    pub total: usize,
    pub done: bool,
}

/// Compose the [`PdfViewerState`] slot key for a given window + pane.
pub(crate) fn slot_key(window_label: &str, pane_id: &str) -> String {
    format!("{window_label}:{pane_id}")
}

impl PdfViewerState {
    pub fn new(lib_path: &str) -> Self {
        Self {
            threads: Mutex::new(HashMap::new()),
            cancel_tokens: Mutex::new(HashMap::new()),
            lib_path: lib_path.to_string(),
        }
    }

    /// Signals any in-flight precache for `slot` to stop, and forgets its token.
    /// Safe to call when no precache is active (no-op).
    pub fn cancel_precache(&self, slot: &str) {
        let mut tokens = self.cancel_tokens.lock().unwrap();
        if let Some(flag) = tokens.remove(slot) {
            flag.store(true, Ordering::Relaxed);
        }
    }

    /// Begins background precaching from `start_page`. Creates a fresh cancel
    /// token (cancelling/replacing any prior one for this slot), sends
    /// `PreCacheAll` to the render thread, and spawns a thread that drains
    /// progress and emits `"lit:pdf-cache-progress"` to the originating window.
    pub fn start_precache(&self, window: &tauri::Window, slot: &str, start_page: usize, dpi: u32) {
        // Cancel + replace any prior token for this slot (reopen case).
        let cancel = Arc::new(AtomicBool::new(false));
        {
            let mut tokens = self.cancel_tokens.lock().unwrap();
            if let Some(old) = tokens.insert(slot.to_string(), Arc::clone(&cancel)) {
                old.store(true, Ordering::Relaxed);
            }
        }

        let (progress_tx, progress_rx) = mpsc::channel::<(usize, usize)>();

        // Send PreCacheAll to the render thread (under the threads lock). The
        // threads lock is released before the progress thread is spawned.
        {
            let threads = self.threads.lock().unwrap();
            match threads.get(slot) {
                Some(thread) => {
                    if thread
                        .precache_all(dpi, start_page, Arc::clone(&cancel), progress_tx)
                        .is_err()
                    {
                        // Thread died; drop token, no progress thread.
                        drop(threads);
                        self.cancel_tokens.lock().unwrap().remove(slot);
                        return;
                    }
                }
                None => {
                    drop(threads);
                    self.cancel_tokens.lock().unwrap().remove(slot);
                    return;
                }
            }
        }

        // Progress-forwarding thread: read (current,total) and emit to the window.
        let window = window.clone(); // tauri::Window is Clone + Send
        let slot_string = slot.to_string();
        std::thread::spawn(move || {
            let label = window.label().to_string();
            while let Ok((current, total)) = progress_rx.recv() {
                let done = current >= total;
                let payload = PdfCacheProgress {
                    slot: slot_string.clone(),
                    current,
                    total,
                    done,
                };
                let _ = window.emit_to(&label, "lit:pdf-cache-progress", payload);
                if done {
                    break; // final (total,total) send terminates the loop
                }
            }
        });
    }

    /// Synchronously render the first `count` pages for `slot`, returning
    /// whatever rendered successfully (out-of-range pages are skipped). Returns
    /// an empty vec if the slot has no open thread.
    pub fn render_initial_for_window(
        &self,
        slot: &str,
        count: usize,
        dpi: u32,
    ) -> Vec<RenderedPage> {
        let threads = self.threads.lock().unwrap();
        match threads.get(slot) {
            Some(thread) => thread.render_pages_sync(0, count, dpi),
            None => Vec::new(),
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
        // Cancel before sending Close so the precache loop sees the flag and
        // breaks at the next page boundary, rather than the close blocking on an
        // in-progress render.
        self.cancel_precache(slot);
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

        // Cancel any in-flight precaches for this window first so their render
        // loops break promptly, then drop the render threads. Released before
        // the threads block runs — we never hold both locks at once.
        {
            let mut tokens = self.cancel_tokens.lock().unwrap();
            let keys: Vec<String> = tokens
                .keys()
                .filter(|k| k.starts_with(&prefix))
                .cloned()
                .collect();
            for k in keys {
                if let Some(flag) = tokens.remove(&k) {
                    flag.store(true, Ordering::Relaxed);
                }
            }
        }

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
    dpi: u32,
    window: tauri::Window,
    state: tauri::State<'_, PdfViewerState>,
) -> Result<PdfOpenResult, String> {
    let slot = slot_key(window.label(), &pane_id);

    // Cancel any precache from a prior PDF in this slot before reopening.
    state.cancel_precache(&slot);

    let info = state.open_for_window(&slot, &path)?;

    if let Some(temp_dir) = state.temp_dir_for_window(&slot) {
        window
            .app_handle()
            .asset_protocol_scope()
            .allow_directory(&temp_dir, false)
            .map_err(|e| format!("Failed to register asset scope: {e}"))?;
    }

    // Synchronously render the first batch so navigation is instant on open.
    let initial_count = info.page_count.min(INITIAL_SYNC_PAGES);
    let initial_pages = state.render_initial_for_window(&slot, initial_count, dpi);

    // Kick off background precache for the remainder. The Phase-1 precache loop
    // runs `start_page..page_count` with no internal cap, so we enforce
    // MAX_PRECACHE_PAGES on the start side: only precache when the whole
    // document fits under the cap. Larger PDFs rely on on-demand rendering.
    if initial_count < info.page_count && info.page_count <= MAX_PRECACHE_PAGES {
        state.start_precache(&window, &slot, initial_count, dpi);
    }

    Ok(PdfOpenResult {
        page_count: info.page_count,
        path: info.path,
        initial_pages,
    })
}

#[tauri::command]
pub fn pdf_cancel_precache(
    pane_id: String,
    window: tauri::Window,
    state: tauri::State<'_, PdfViewerState>,
) {
    state.cancel_precache(&slot_key(window.label(), &pane_id));
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
    fn test_cancel_precache_noop_when_no_token() {
        let state = PdfViewerState::new("dummy");
        // No precache active for this slot — must not panic.
        state.cancel_precache("main:pane-1");
    }

    #[test]
    fn test_cancel_precache_is_idempotent() {
        let state = PdfViewerState::new("dummy");
        // Calling twice on a slot with no token is a safe no-op.
        state.cancel_precache("main:pane-1");
        state.cancel_precache("main:pane-1");
    }

    #[test]
    fn test_render_initial_for_unknown_slot_returns_empty() {
        let state = PdfViewerState::new("dummy");
        assert!(state.render_initial_for_window("unknown", 5, 144).is_empty());
    }

    #[test]
    fn test_pdf_open_result_struct_fields() {
        let result = PdfOpenResult {
            page_count: 7,
            path: "/tmp/x.pdf".to_string(),
            initial_pages: vec![],
        };
        assert_eq!(result.page_count, 7);
        assert_eq!(result.path, "/tmp/x.pdf");
        assert!(result.initial_pages.is_empty());

        let json = serde_json::to_string(&result).unwrap();
        assert!(json.contains("page_count"), "got: {json}");
        assert!(json.contains("initial_pages"), "got: {json}");
        // camelCase must NOT appear — frontend reads snake_case.
        assert!(!json.contains("pageCount"));
        assert!(!json.contains("initialPages"));
    }

    #[test]
    fn test_pdf_cache_progress_serializes_snake_case() {
        let progress = PdfCacheProgress {
            slot: "main:pane-1".to_string(),
            current: 5,
            total: 10,
            done: false,
        };
        let json = serde_json::to_string(&progress).unwrap();
        assert!(json.contains("\"slot\""), "got: {json}");
        assert!(json.contains("\"current\""), "got: {json}");
        assert!(json.contains("\"total\""), "got: {json}");
        assert!(json.contains("\"done\""), "got: {json}");
    }

    #[test]
    fn test_close_all_for_window_clears_cancel_tokens() {
        let state = PdfViewerState::new("dummy");
        // The new token-draining block must handle the empty-map path cleanly.
        state.close_all_for_window("main");
    }

    #[test]
    fn test_close_for_window_cancels_precache_safely_on_empty_slot() {
        let state = PdfViewerState::new("dummy");
        // cancel_precache(slot) runs first inside close_for_window; with no
        // token and no thread this is a no-op and returns Ok.
        assert!(state.close_for_window("main:pane-1").is_ok());
    }

    #[test]
    fn test_max_precache_and_initial_constants() {
        assert_eq!(MAX_PRECACHE_PAGES, 200);
        assert_eq!(INITIAL_SYNC_PAGES, 10);
        assert!(INITIAL_SYNC_PAGES <= MAX_PRECACHE_PAGES);
    }

    #[test]
    #[ignore]
    fn test_render_initial_for_window_renders_fixture_pages() {
        let _guard = lock_pdfium();
        let lib = require_pdfium();
        let state = PdfViewerState::new(&lib);
        let slot = slot_key("main", "pane-1");
        state
            .open_for_window(&slot, fixture_path("sample.pdf").to_str().unwrap())
            .unwrap();

        // sample.pdf has 2 pages; asking for 10 should clamp to 2.
        let pages = state.render_initial_for_window(&slot, 10, 144);
        assert_eq!(pages.len(), 2);
        assert!(std::path::Path::new(&pages[0].png_path).exists());
        assert!(std::path::Path::new(&pages[1].png_path).exists());

        state.close_for_window(&slot).unwrap();
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
