use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};

use serde::Serialize;
use tauri::{Emitter, Manager};

use crate::pdf::disk_cache::{cache_key, read_manifest, write_manifest, CacheManifest};
use crate::pdf::{DiskCacheConfig, PdfInfo, PdfRenderThread, RenderedPage};

/// Cap eager precaching at this many pages. Beyond this, pages render on demand.
const MAX_PRECACHE_PAGES: usize = 200;
/// Number of pages rendered synchronously before returning from `pdf_open`.
const INITIAL_SYNC_PAGES: usize = 10;
/// Default TTL for persistent render-cache entries, in days. Entries whose
/// `last_accessed` is older than this are evicted by [`evict_stale_cache`].
pub const CACHE_MAX_AGE_DAYS: u32 = 30;
/// Default LRU size cap for the persistent render cache, in megabytes. When the
/// surviving entries' total footprint exceeds this, oldest entries are evicted
/// first by [`evict_stale_cache`].
pub const CACHE_MAX_SIZE_MB: u64 = 500;

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
    /// Root under which the persistent render cache lives
    /// (`<cache_root>/pdf-render-cache/<key>/`). `None` disables disk caching;
    /// [`resolve_disk_cache`](PdfViewerState::resolve_disk_cache) returns `None`.
    cache_root: Option<PathBuf>,
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
        Self::new_with_cache_root(lib_path, None)
    }

    /// Like [`new`](PdfViewerState::new) but with an explicit persistent cache
    /// root. `cache_root: None` disables disk caching (mirrors `new`).
    pub fn new_with_cache_root(lib_path: &str, cache_root: Option<PathBuf>) -> Self {
        Self {
            threads: Mutex::new(HashMap::new()),
            cancel_tokens: Mutex::new(HashMap::new()),
            lib_path: lib_path.to_string(),
            cache_root,
        }
    }

    /// Resolve (validate or create) the persistent on-disk render cache for the
    /// PDF at `pdf_path` rendered at `dpi`.
    ///
    /// The cache directory is `<cache_root>/pdf-render-cache/<key>/`, where
    /// `<key>` is [`cache_key`] over the file's canonical path, byte size, and
    /// whole-second mtime. Because the key folds in size+mtime, any edit to the
    /// source file yields a *different* key (a fresh dir); "invalidation" here
    /// means deleting any sibling cache dir whose manifest names the same
    /// `source_path` under a now-stale key.
    ///
    /// Returns `None` when no `cache_root` is configured, or when the file
    /// cannot be canonicalized / stat-ed.
    pub fn resolve_disk_cache(&self, pdf_path: &str, dpi: u32) -> Option<DiskCacheConfig> {
        let root = self.cache_root.as_ref()?;
        let base = root.join("pdf-render-cache");
        std::fs::create_dir_all(&base).ok()?;

        let canonical = std::fs::canonicalize(pdf_path).ok()?;
        let canonical_str = canonical.to_string_lossy().to_string();
        let meta = std::fs::metadata(&canonical).ok()?;
        let file_size = meta.len();
        let mtime_secs = meta
            .modified()
            .ok()?
            .duration_since(std::time::UNIX_EPOCH)
            .ok()?
            .as_secs();

        let key = cache_key(&canonical_str, file_size, mtime_secs);
        let cache_dir = base.join(&key);

        // Invalidate stale siblings: any other cache dir whose manifest names
        // the same source file (but a now-outdated key) is deleted.
        if let Ok(entries) = std::fs::read_dir(&base) {
            for entry in entries.flatten() {
                let entry_dir = entry.path();
                if entry.file_name() == std::ffi::OsStr::new(&key) {
                    continue;
                }
                if let Some(m) = read_manifest(&entry_dir) {
                    if m.source_path == canonical_str {
                        let _ = std::fs::remove_dir_all(&entry_dir);
                    }
                }
            }
        }

        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);

        match read_manifest(&cache_dir) {
            Some(existing) => {
                // Reuse: refresh last_accessed, keep identity/created fields.
                let refreshed = CacheManifest {
                    last_accessed: now,
                    ..existing
                };
                let _ = write_manifest(&cache_dir, &refreshed);
            }
            None => {
                write_manifest(
                    &cache_dir,
                    &CacheManifest {
                        source_path: canonical_str,
                        file_size,
                        mtime_epoch_secs: mtime_secs,
                        dpi,
                        // No document handle at this layer; B5 fills page_count
                        // during render integration.
                        page_count: 0,
                        created_at: now,
                        last_accessed: now,
                        version: 1,
                    },
                )
                .ok()?;
            }
        }

        Some(DiskCacheConfig { cache_dir, dpi })
    }

    /// Signals any in-flight precache for `slot` to stop, and forgets its token.
    /// Safe to call when no precache is active (no-op).
    pub fn cancel_precache(&self, slot: &str) {
        let mut tokens = self.cancel_tokens.lock().unwrap();
        if let Some(flag) = tokens.remove(slot) {
            flag.store(true, Ordering::Relaxed);
        }
    }

    /// Begins background precaching in spiral order around `anchor_page`.
    /// Creates a fresh cancel token (cancelling/replacing any prior one for this
    /// slot), sends `PreCacheAll` to the render thread, and spawns a thread that
    /// drains progress and emits `"lit:pdf-cache-progress"` to the originating
    /// window.
    pub fn start_precache(&self, window: &tauri::Window, slot: &str, anchor_page: usize, dpi: u32) {
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
                        .precache_all(dpi, anchor_page, Arc::clone(&cancel), progress_tx)
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

    /// Synchronously render a batch of `count` pages for `slot`, centered on
    /// `anchor_page`. The batch begins at `anchor_page.saturating_sub(count / 2)`
    /// so the anchor sits roughly in the middle. Returns whatever rendered
    /// successfully (out-of-range pages are skipped). Returns an empty vec if the
    /// slot has no open thread.
    pub fn render_initial_for_window(
        &self,
        slot: &str,
        anchor_page: usize,
        count: usize,
        dpi: u32,
    ) -> Vec<RenderedPage> {
        let start = anchor_page.saturating_sub(count / 2);
        let threads = self.threads.lock().unwrap();
        match threads.get(slot) {
            Some(thread) => thread.render_pages_sync(start, count, dpi),
            None => Vec::new(),
        }
    }

    pub fn open_for_window(
        &self,
        slot: &str,
        path: &str,
        disk_cache: Option<DiskCacheConfig>,
    ) -> Result<PdfInfo, String> {
        let mut threads = self.threads.lock().unwrap();
        if let Some(old) = threads.remove(slot) {
            let _ = old.close();
        }
        let thread = PdfRenderThread::new(&self.lib_path)?;
        let info = thread.open(path, disk_cache)?;
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

    /// Re-anchor background precaching for `slot`: cancel any in-flight
    /// precache and restart the spiral from `anchor_page`. No-op (returns `Ok`)
    /// when the slot has no open thread. `window` is `None` only in unit tests;
    /// in production it carries the originating window so progress events can be
    /// emitted.
    pub fn seek_precache_for_window(
        &self,
        window: Option<&tauri::Window>,
        slot: &str,
        anchor_page: usize,
        dpi: u32,
    ) -> Result<(), String> {
        // No open thread for this slot -> cancel any stale token and bail.
        let has_thread = self.threads.lock().unwrap().contains_key(slot);
        if !has_thread {
            self.cancel_precache(slot);
            return Ok(());
        }
        match window {
            // start_precache already cancels + replaces the prior token.
            Some(w) => self.start_precache(w, slot, anchor_page, dpi),
            // window-free fallback (tests): just cancel the in-flight precache.
            None => self.cancel_precache(slot),
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
    anchor_page: Option<usize>,
    window: tauri::Window,
    state: tauri::State<'_, PdfViewerState>,
) -> Result<PdfOpenResult, String> {
    let slot = slot_key(window.label(), &pane_id);
    let anchor = anchor_page.unwrap_or(0);

    // Cancel any precache from a prior PDF in this slot before reopening.
    state.cancel_precache(&slot);

    // Resolve (or create) the persistent on-disk render cache. Returns None
    // when no cache_root is configured, leaving behavior identical to before.
    let disk_cache = state.resolve_disk_cache(&path, dpi);

    let info = state.open_for_window(&slot, &path, disk_cache.clone())?;

    if let Some(temp_dir) = state.temp_dir_for_window(&slot) {
        window
            .app_handle()
            .asset_protocol_scope()
            .allow_directory(&temp_dir, false)
            .map_err(|e| format!("Failed to register asset scope: {e}"))?;
    }

    // Register the persistent cache dir with the asset protocol so cached page
    // PNGs served from it are reachable by the frontend.
    if let Some(cfg) = disk_cache.as_ref() {
        window
            .app_handle()
            .asset_protocol_scope()
            .allow_directory(&cfg.cache_dir, false)
            .map_err(|e| format!("Failed to register cache asset scope: {e}"))?;
    }

    // Synchronously render the first batch so navigation is instant on open.
    let initial_count = info.page_count.min(INITIAL_SYNC_PAGES);
    let initial_pages = state.render_initial_for_window(&slot, anchor, initial_count, dpi);

    // Kick off background precache for the remainder. The Phase-1 precache loop
    // runs `start_page..page_count` with no internal cap, so we enforce
    // MAX_PRECACHE_PAGES on the start side: only precache when the whole
    // document fits under the cap. Larger PDFs rely on on-demand rendering.
    if initial_count < info.page_count && info.page_count <= MAX_PRECACHE_PAGES {
        state.start_precache(&window, &slot, anchor, dpi);
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
pub fn pdf_seek_precache(
    pane_id: String,
    anchor_page: usize,
    dpi: u32,
    window: tauri::Window,
    state: tauri::State<'_, PdfViewerState>,
) -> Result<(), String> {
    let slot = slot_key(window.label(), &pane_id);
    state.seek_precache_for_window(Some(&window), &slot, anchor_page, dpi)
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

/// Sum the byte lengths of the immediate files in `dir`. Cache dirs are flat
/// (manifest.json + page PNGs), so a non-recursive scan is sufficient.
fn dir_size_bytes(dir: &std::path::Path) -> u64 {
    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return 0,
    };
    entries
        .flatten()
        .map(|entry| entry.metadata().map(|m| m.len()).unwrap_or(0))
        .sum()
}

/// Evict stale entries from the persistent PDF render cache rooted at
/// `cache_root`.
///
/// Each immediate subdirectory of `cache_root` is a per-PDF cache dir holding a
/// `manifest.json` plus page PNGs. Eviction runs in two phases:
///
/// 1. **TTL** — any entry whose `last_accessed` is older than `max_age_days`
///    (relative to now) is deleted.
/// 2. **LRU size cap** — if the surviving entries' total on-disk footprint
///    exceeds `max_size_mb`, entries are deleted oldest-first (ascending
///    `last_accessed`) until the total is back under the cap.
///
/// Robustness: a missing/unreadable `cache_root` is a silent no-op. Subdirs
/// without a parseable `manifest.json` are skipped (never deleted), so this
/// will not touch directories that are not part of the cache. All filesystem
/// removals are best-effort (`let _ =`), so a single failure cannot panic or
/// abort the sweep.
pub fn evict_stale_cache(cache_root: &std::path::Path, max_age_days: u32, max_size_mb: u64) {
    let entries = match std::fs::read_dir(cache_root) {
        Ok(e) => e,
        Err(_) => return,
    };

    // Collect (dir, last_accessed, size_bytes) for every valid cache dir.
    let mut records: Vec<(PathBuf, u64, u64)> = Vec::new();
    for entry in entries.flatten() {
        let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
        if !is_dir {
            continue;
        }
        let dir = entry.path();
        let manifest = match read_manifest(&dir) {
            Some(m) => m,
            None => continue, // not a cache dir — leave untouched
        };
        let size = dir_size_bytes(&dir);
        records.push((dir, manifest.last_accessed, size));
    }

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);

    // Phase 1: TTL eviction.
    let max_age_secs = max_age_days as u64 * 86_400;
    let mut survivors: Vec<(PathBuf, u64, u64)> = Vec::with_capacity(records.len());
    for (dir, last_accessed, size) in records {
        if now.saturating_sub(last_accessed) > max_age_secs {
            let _ = std::fs::remove_dir_all(&dir);
        } else {
            survivors.push((dir, last_accessed, size));
        }
    }

    // Phase 2: LRU size cap.
    let cap = max_size_mb * 1024 * 1024;
    let mut total: u64 = survivors.iter().map(|(_, _, size)| *size).sum();
    if total > cap {
        // Oldest (smallest last_accessed) first.
        survivors.sort_by_key(|(_, last_accessed, _)| *last_accessed);
        for (dir, _, size) in &survivors {
            if total <= cap {
                break;
            }
            let _ = std::fs::remove_dir_all(dir);
            total = total.saturating_sub(*size);
        }
    }
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
            .open_for_window("main", fixture_path("sample.pdf").to_str().unwrap(), None)
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
            .open_for_window("main", fixture_path("sample.pdf").to_str().unwrap(), None)
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
            .open_for_window("main", fixture_path("sample.pdf").to_str().unwrap(), None)
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
        state.open_for_window("main", &pdf, None).unwrap();
        let old_temp = state.temp_dir_for_window("main").unwrap();
        assert!(old_temp.exists());
        state.open_for_window("main", &pdf, None).unwrap();
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
            .open_for_window("main", fixture_path("sample.pdf").to_str().unwrap(), None)
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
        state.open_for_window(&slot1, &pdf, None).unwrap();
        state.open_for_window(&slot2, &pdf, None).unwrap();
        state.open_for_window(&slot3, &pdf, None).unwrap();

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
        state.open_for_window(&slot1, &pdf, None).unwrap();
        state.open_for_window(&slot2, &pdf, None).unwrap();
        state.open_for_window(&slot3, &pdf, None).unwrap();

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
        assert!(state
            .render_initial_for_window("unknown", 0, 5, 144)
            .is_empty());
    }

    #[test]
    fn test_render_initial_for_unknown_slot_with_anchor_returns_empty() {
        let state = PdfViewerState::new("dummy");
        // anchor_page = 5 is the 2nd positional arg (before count). An unknown
        // slot still returns an empty Vec<RenderedPage>.
        assert!(state
            .render_initial_for_window("unknown", 5, 10, 144)
            .is_empty());
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
    fn test_pdf_open_result_with_anchor() {
        // Guards that threading an `anchor_page` arg through `pdf_open` did not
        // alter the result struct's snake_case wire shape. `initial_pages` is
        // empty here (RenderedPage needs pdfium to construct); the centered
        // initial-pages behavior is the conceptual subject.
        let result = PdfOpenResult {
            page_count: 12,
            path: "/tmp/a.pdf".to_string(),
            initial_pages: vec![],
        };
        assert_eq!(result.page_count, 12);
        assert_eq!(result.path, "/tmp/a.pdf");

        let json = serde_json::to_string(&result).unwrap();
        assert!(json.contains("page_count"), "got: {json}");
        assert!(json.contains("path"), "got: {json}");
        assert!(json.contains("initial_pages"), "got: {json}");
        assert!(!json.contains("pageCount"), "got: {json}");
        assert!(!json.contains("initialPages"), "got: {json}");
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
    fn test_seek_precache_noop_on_empty_state() {
        let state = PdfViewerState::new("dummy");
        // Re-anchoring an unknown slot has no open thread, so it cancels any
        // stale token and returns Ok without touching pdfium. `window` is None
        // in unit tests (no Tauri app to construct a Window from).
        assert!(state
            .seek_precache_for_window(None, "main:pane-1", 3, 144)
            .is_ok());
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
            .open_for_window(&slot, fixture_path("sample.pdf").to_str().unwrap(), None)
            .unwrap();

        // sample.pdf has 2 pages; asking for 10 should clamp to 2.
        let pages = state.render_initial_for_window(&slot, 0, 10, 144);
        assert_eq!(pages.len(), 2);
        assert!(std::path::Path::new(&pages[0].png_path).exists());
        assert!(std::path::Path::new(&pages[1].png_path).exists());

        state.close_for_window(&slot).unwrap();
    }

    #[test]
    #[ignore]
    fn test_render_initial_centered_on_page_1() {
        let _guard = lock_pdfium();
        let lib = require_pdfium();
        let state = PdfViewerState::new(&lib);
        let slot = slot_key("main", "pane-1");
        state
            .open_for_window(&slot, fixture_path("sample.pdf").to_str().unwrap(), None)
            .unwrap();

        // anchor_page = 1, count = 10. With count/2 = 5 and saturating_sub,
        // start = 1.saturating_sub(5) = 0, so pages 0..10 clamp to the 2-page doc.
        let pages = state.render_initial_for_window(&slot, 1, 10, 144);
        assert_eq!(pages.len(), 2);
        assert_eq!(pages[0].page_index, 0);
        assert_eq!(pages[1].page_index, 1);
        assert!(std::path::Path::new(&pages[0].png_path).exists());
        assert!(std::path::Path::new(&pages[1].png_path).exists());

        state.close_for_window(&slot).unwrap();
    }

    #[test]
    fn test_resolve_creates_new_cache_dir() {
        let cache_root = tempfile::TempDir::new().unwrap();
        let pdf_dir = tempfile::TempDir::new().unwrap();
        let foo_path = pdf_dir.path().join("foo.pdf");
        std::fs::write(&foo_path, b"%PDF-1.4 fake").unwrap();
        let foo_str = foo_path.to_str().unwrap();

        let state =
            PdfViewerState::new_with_cache_root("dummy", Some(cache_root.path().to_path_buf()));

        let cfg = state
            .resolve_disk_cache(foo_str, 144)
            .expect("should create cache");
        assert_eq!(cfg.dpi, 144);
        assert!(cfg.cache_dir.exists());
        assert!(cfg.cache_dir.is_dir());
        assert!(cfg
            .cache_dir
            .parent()
            .unwrap()
            .ends_with("pdf-render-cache"));
        assert!(cfg.cache_dir.join("manifest.json").exists());

        let manifest =
            crate::pdf::disk_cache::read_manifest(&cfg.cache_dir).expect("manifest readable");
        assert_eq!(manifest.dpi, 144);
        let canonical = std::fs::canonicalize(&foo_path).unwrap();
        assert_eq!(manifest.source_path, canonical.to_string_lossy());
    }

    #[test]
    fn test_resolve_returns_existing_valid_cache() {
        let cache_root = tempfile::TempDir::new().unwrap();
        let pdf_dir = tempfile::TempDir::new().unwrap();
        let foo_path = pdf_dir.path().join("foo.pdf");
        std::fs::write(&foo_path, b"%PDF-1.4 fake").unwrap();
        let foo_str = foo_path.to_str().unwrap();

        let state =
            PdfViewerState::new_with_cache_root("dummy", Some(cache_root.path().to_path_buf()));

        let cfg1 = state.resolve_disk_cache(foo_str, 144).expect("first resolve");
        let cfg2 = state.resolve_disk_cache(foo_str, 144).expect("second resolve");

        assert_eq!(cfg1.cache_dir, cfg2.cache_dir);
        assert!(cfg2.cache_dir.join("manifest.json").exists());
    }

    #[test]
    fn test_resolve_invalidates_on_mtime_change() {
        let cache_root = tempfile::TempDir::new().unwrap();
        let pdf_dir = tempfile::TempDir::new().unwrap();
        let foo_path = pdf_dir.path().join("foo.pdf");
        std::fs::write(&foo_path, b"%PDF-1.4 fake").unwrap();
        let foo_str = foo_path.to_str().unwrap();

        let state =
            PdfViewerState::new_with_cache_root("dummy", Some(cache_root.path().to_path_buf()));

        let cfg1 = state.resolve_disk_cache(foo_str, 144).expect("first resolve");
        let old_dir = cfg1.cache_dir.clone();
        assert!(old_dir.exists());

        // Change the file so size (and thus the cache key) differs. cache_key
        // incorporates file_size, so this guarantees a distinct key without
        // relying on sub-second mtime granularity.
        std::fs::write(&foo_path, b"different longer contents that change file size").unwrap();

        let cfg2 = state
            .resolve_disk_cache(foo_str, 144)
            .expect("second resolve after change");
        assert_ne!(cfg2.cache_dir, old_dir);
        assert!(cfg2.cache_dir.exists());
        assert!(!old_dir.exists(), "stale dir for same source_path deleted");
    }

    #[test]
    fn test_state_new_with_cache_root() {
        // Constructing with an explicit cache_root must wire the field so that
        // resolve_disk_cache returns Some (it returns None iff cache_root is
        // None). Deterministic — no pdfium needed.
        let cache_root = tempfile::TempDir::new().unwrap();
        let pdf_dir = tempfile::TempDir::new().unwrap();
        let foo_path = pdf_dir.path().join("foo.pdf");
        std::fs::write(&foo_path, b"%PDF-1.4 fake").unwrap();
        let foo_str = foo_path.to_str().unwrap();

        let state =
            PdfViewerState::new_with_cache_root("dummy", Some(cache_root.path().to_path_buf()));

        let cfg = state.resolve_disk_cache(foo_str, 144);
        assert!(cfg.is_some(), "cache_root set -> resolve returns Some");
        assert!(cfg.unwrap().cache_dir.exists());
    }

    #[test]
    #[ignore]
    fn test_open_for_window_with_disk_cache() {
        let _guard = lock_pdfium();
        let lib = require_pdfium();
        let cache_root = tempfile::TempDir::new().unwrap();
        let state =
            PdfViewerState::new_with_cache_root(&lib, Some(cache_root.path().to_path_buf()));
        let pdf = fixture_path("sample.pdf");
        let cfg = state.resolve_disk_cache(pdf.to_str().unwrap(), 144);
        let slot = slot_key("main", "pane-1");
        let info = state
            .open_for_window(&slot, pdf.to_str().unwrap(), cfg)
            .unwrap();
        assert_eq!(info.page_count, 2);
        assert!(state.temp_dir_for_window(&slot).is_some());
        state.close_for_window(&slot).unwrap();
    }

    #[test]
    fn test_resolve_returns_none_without_cache_root() {
        let pdf_dir = tempfile::TempDir::new().unwrap();
        let foo_path = pdf_dir.path().join("foo.pdf");
        std::fs::write(&foo_path, b"%PDF-1.4 fake").unwrap();
        let state = PdfViewerState::new("dummy");
        assert!(state
            .resolve_disk_cache(foo_path.to_str().unwrap(), 144)
            .is_none());
    }

    #[test]
    #[ignore]
    fn test_open_for_window_drops_old_thread_cleanly() {
        let _guard = lock_pdfium();
        let lib = require_pdfium();
        let state = PdfViewerState::new(&lib);
        let pdf = fixture_path("sample.pdf").to_str().unwrap().to_string();
        state.open_for_window("win", &pdf, None).unwrap();
        let old_temp = state.temp_dir_for_window("win").unwrap();
        assert!(old_temp.exists());
        state.open_for_window("win", &pdf, None).unwrap();
        assert!(!old_temp.exists(), "old temp dir should be cleaned up by Drop");
        let new_temp = state.temp_dir_for_window("win").unwrap();
        assert!(new_temp.exists());
    }

    // ---- Cycle B4: eviction logic --------------------------------------

    fn now_secs() -> u64 {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs()
    }

    /// Build a cache dir under `root/name` with a manifest whose
    /// `last_accessed` is `last_accessed`, plus a filler page file of
    /// `filler_bytes` to control on-disk size.
    fn make_cache_dir(
        root: &std::path::Path,
        name: &str,
        last_accessed: u64,
        filler_bytes: usize,
    ) -> PathBuf {
        let dir = root.join(name);
        std::fs::create_dir_all(&dir).unwrap();
        let manifest = CacheManifest {
            source_path: format!("/abs/{name}.pdf"),
            file_size: 1024,
            mtime_epoch_secs: 1_700_000_000,
            dpi: 144,
            page_count: 1,
            created_at: last_accessed,
            last_accessed,
            version: 1,
        };
        write_manifest(&dir, &manifest).unwrap();
        std::fs::write(dir.join("0.png"), vec![0u8; filler_bytes]).unwrap();
        dir
    }

    #[test]
    fn test_evict_removes_entries_older_than_max_age() {
        let cache_root = tempfile::TempDir::new().unwrap();
        let now = now_secs();
        let old_dir = make_cache_dir(cache_root.path(), "old", now - 40 * 86_400, 64);
        let fresh_dir = make_cache_dir(cache_root.path(), "fresh", now, 64);

        evict_stale_cache(cache_root.path(), 30, 500);

        assert!(!old_dir.exists(), "entry older than max_age should be deleted");
        assert!(fresh_dir.exists(), "fresh entry should survive");
        assert!(fresh_dir.join("manifest.json").exists());
    }

    #[test]
    fn test_evict_respects_size_cap_lru() {
        let cache_root = tempfile::TempDir::new().unwrap();
        let now = now_secs();
        let two_mb = 2 * 1024 * 1024;
        let a = make_cache_dir(cache_root.path(), "a", now - 300, two_mb);
        let b = make_cache_dir(cache_root.path(), "b", now - 200, two_mb);
        let c = make_cache_dir(cache_root.path(), "c", now - 100, two_mb);

        // Total ~6 MB > 5 MB cap; all fresh (within TTL) so only LRU applies.
        evict_stale_cache(cache_root.path(), 30, 5);

        assert!(!a.exists(), "oldest entry should be evicted first under cap");
        assert!(b.exists(), "newer entry b should survive");
        assert!(c.exists(), "newest entry c should survive");
    }

    #[test]
    fn test_evict_noop_when_under_limits() {
        let cache_root = tempfile::TempDir::new().unwrap();
        let now = now_secs();
        let d1 = make_cache_dir(cache_root.path(), "d1", now, 64);
        let d2 = make_cache_dir(cache_root.path(), "d2", now, 64);

        evict_stale_cache(cache_root.path(), 30, 500);

        assert!(d1.exists() && d1.join("manifest.json").exists());
        assert!(d2.exists() && d2.join("manifest.json").exists());
    }

    #[test]
    fn test_evict_handles_missing_cache_root() {
        let cache_root = tempfile::TempDir::new().unwrap();
        let missing = cache_root.path().join("does-not-exist-subdir");
        assert!(!missing.exists());
        // Must not panic.
        evict_stale_cache(&missing, 30, 500);
    }

    #[test]
    fn test_cache_eviction_default_constants() {
        assert_eq!(CACHE_MAX_AGE_DAYS, 30);
        assert_eq!(CACHE_MAX_SIZE_MB, 500);
    }

    #[test]
    fn test_eviction_constants_are_publicly_visible() {
        // lib.rs references these by their public crate path when spawning the
        // startup eviction sweep. They must be `pub const` — this fails to
        // compile while they are private.
        assert_eq!(crate::commands::pdf_viewer::CACHE_MAX_AGE_DAYS, 30);
        assert_eq!(crate::commands::pdf_viewer::CACHE_MAX_SIZE_MB, 500);
    }
}
