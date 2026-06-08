use image::ImageEncoder;
use std::collections::HashMap;
use std::fs;
use std::io::BufWriter;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::sync::Arc;
use std::thread;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;

pub mod disk_cache;

use disk_cache::{
    dims_key, read_dims_index, read_manifest, write_dims_index, write_manifest, CacheManifest,
    DimsIndex,
};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub struct PdfInfo {
    pub page_count: usize,
    pub path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub struct RenderedPage {
    pub page_index: usize,
    pub png_path: String,
    pub width: u32,
    pub height: u32,
}

/// Resolved on-disk render cache target for one open PDF.
///
/// `cache_dir` is `<cache_root>/pdf-render-cache/<key>/`, where `<key>` is the
/// content-identity hash from [`disk_cache::cache_key`]. B5 extends this struct
/// to thread it into `PdfCommand::Open` and the render thread; for B3 it only
/// needs to be constructible and importable.
#[derive(Debug, Clone, PartialEq)]
pub struct DiskCacheConfig {
    pub cache_dir: PathBuf,
    pub dpi: u32,
}

enum PdfCommand {
    Open {
        path: String,
        disk_cache: Option<DiskCacheConfig>,
        reply: mpsc::Sender<Result<PdfInfo, String>>,
    },
    RenderPage {
        page_index: usize,
        dpi: u32,
        reply: mpsc::Sender<Result<RenderedPage, String>>,
    },
    Close {
        reply: mpsc::Sender<Result<(), String>>,
    },
    PreRender {
        page_index: usize,
        dpi: u32,
    },
    PreCacheAll {
        dpi: u32,
        anchor_page: usize,
        cancel: Arc<AtomicBool>,
        progress_tx: mpsc::Sender<(usize, usize)>, // (current, total)
    },
    Shutdown,
}

/// Decision for how the `'precache` drain loop should treat a command it pulled
/// off the channel while a precache spiral is running.
///
/// The important variant is [`DrainAction::StashPrecache`]: a nested
/// `PreCacheAll` (e.g. from a re-anchored seek) must NOT be silently dropped,
/// because dropping it also drops its `progress_tx`, which strands the
/// progress-forwarding thread with zero events. Instead it is stashed and
/// re-processed once the current (now superseded) spiral abandons.
enum DrainAction {
    /// A nested `PreCacheAll` that supersedes the running spiral. Carries the
    /// command (and its live `progress_tx`) so the loop can re-enter with it.
    StashPrecache(PdfCommand),
    /// Any other command — handle it inline with the existing logic.
    Handle(PdfCommand),
}

/// Result of running a command through the shared `handle_command` logic. Both
/// the main render loop and the `'precache` drain loop dispatch commands through
/// the same handler so the two states can never diverge; this enum tells the
/// caller what to do next.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CmdOutcome {
    /// The command was handled; keep going (RenderPage, PreRender).
    Continue,
    /// The command replaced or tore down the document (Open, Close). A running
    /// precache spiral must abandon promptly because its document/cache is gone.
    AbandonPrecache,
    /// Shutdown: the render thread must terminate.
    Shutdown,
}

/// Pure decision: what outcome does a command imply for the precache spiral,
/// independent of its side effects? Kept side-effect free so it can be
/// unit-tested without pdfium. The actual document/cache mutation happens in
/// `handle_command`; this only classifies control flow. `PreCacheAll` never
/// reaches here — it is intercepted by [`classify_drain_command`].
fn command_outcome(cmd: &PdfCommand) -> CmdOutcome {
    match cmd {
        PdfCommand::Open { .. } | PdfCommand::Close { .. } => CmdOutcome::AbandonPrecache,
        PdfCommand::Shutdown => CmdOutcome::Shutdown,
        PdfCommand::RenderPage { .. } | PdfCommand::PreRender { .. } => CmdOutcome::Continue,
        // PreCacheAll is handled separately (re-entry / stash), never here.
        PdfCommand::PreCacheAll { .. } => CmdOutcome::Continue,
    }
}

/// Pure classification of a drained command. Kept side-effect free so it can be
/// unit-tested without pdfium: it only decides whether a command supersedes the
/// active precache spiral (stash) or should be handled inline.
fn classify_drain_command(cmd: PdfCommand) -> DrainAction {
    match cmd {
        PdfCommand::PreCacheAll { .. } => DrainAction::StashPrecache(cmd),
        other => DrainAction::Handle(other),
    }
}

/// Decide whether a finished precache spiral should emit the final
/// (total, total) completion on its progress channel. Only a spiral that
/// exhausted its order normally (`completed_normally == true`) may emit it.
/// Any aborted exit (cancel flag, Open/Close/Shutdown, no-document, or a
/// superseding PreCacheAll) must NOT, because the progress forwarder treats
/// `current >= total` as `done: true` and would flash a false 100% to the UI.
fn should_emit_completion(completed_normally: bool) -> bool {
    completed_normally
}

/// Decide whether a throttled intermediate progress event should be sent after
/// a page was *actually rendered*. `rendered_count` counts real renders, not
/// visited spiral positions: cache hits must contribute zero so the caller must
/// only invoke this after a successful render+insert. Returns `Some((rendered,
/// total))` on every 5th render, else `None`. It never reports `current ==
/// total`; the authoritative final completion is sent separately, gated by
/// `should_emit_completion`. This keeps a warm disk cache (all hits, no renders)
/// from racing the counter to `total` and flashing a false 100% in the UI.
fn precache_progress_event(rendered_count: usize, total: usize) -> Option<(usize, usize)> {
    if rendered_count > 0 && rendered_count % 5 == 0 {
        Some((rendered_count, total))
    } else {
        None
    }
}

pub fn spiral_order(anchor: usize, page_count: usize) -> Vec<usize> {
    if page_count == 0 {
        return Vec::new();
    }
    let mut result = Vec::with_capacity(page_count);
    result.push(anchor);
    for dist in 1..page_count {
        let right = anchor + dist;
        if right < page_count {
            result.push(right);
        }
        if dist <= anchor {
            result.push(anchor - dist);
        }
    }
    result
}

pub fn create_pdf_temp_dir() -> Result<PathBuf, String> {
    let dir = std::env::temp_dir().join(format!(
        "lit-pdf-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos()
    ));
    fs::create_dir_all(&dir).map_err(|e| format!("Failed to create temp dir: {e}"))?;
    Ok(dir)
}

pub fn cleanup_pdf_temp_dir(dir: &std::path::Path) {
    let _ = fs::remove_dir_all(dir);
}

/// Scans a persistent cache directory for previously rendered page PNGs and
/// rebuilds the in-memory render cache from them. Files are expected to be named
/// `page_{idx}_{dpi}.png`; anything else (including `manifest.json` and
/// `dims.json`) is skipped.
///
/// For each PNG, the pixel dimensions are recovered from `dims` (the sidecar
/// index, keyed by [`dims_key`]) when present, avoiding a file-open +
/// PNG-header-parse per page on the open path. Only PNGs absent from the index
/// (e.g. legacy caches written before the sidecar existed) fall back to
/// [`image::image_dimensions`].
fn scan_cache_dir(
    dir: &std::path::Path,
    dims: &DimsIndex,
) -> HashMap<(usize, u32), RenderedPage> {
    let mut cache = HashMap::new();
    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return cache,
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let name = match path.file_name().and_then(|n| n.to_str()) {
            Some(n) => n,
            None => continue,
        };
        let stem = match name.strip_suffix(".png") {
            Some(s) => s,
            None => continue,
        };
        // Expect "page_{idx}_{dpi}".
        let rest = match stem.strip_prefix("page_") {
            Some(r) => r,
            None => continue,
        };
        let mut parts = rest.splitn(2, '_');
        let idx = match parts.next().and_then(|s| s.parse::<usize>().ok()) {
            Some(i) => i,
            None => continue,
        };
        let dpi = match parts.next().and_then(|s| s.parse::<u32>().ok()) {
            Some(d) => d,
            None => continue,
        };
        let (width, height) = match dims.get(&dims_key(idx, dpi)) {
            Some(&dims) => dims,
            None => match image::image_dimensions(&path) {
                Ok(dims) => dims,
                Err(_) => continue,
            },
        };
        cache.insert(
            (idx, dpi),
            RenderedPage {
                page_index: idx,
                png_path: path.to_string_lossy().to_string(),
                width,
                height,
            },
        );
    }
    cache
}

/// Records a freshly rendered page's pixel dimensions into the in-memory `dims`
/// index and, when a persistent cache dir is active, flushes the full index to
/// its `dims.json` sidecar. The write is best-effort (errors ignored), matching
/// the surrounding cache code; persisting per render keeps the sidecar
/// crash-consistent with whatever PNGs are already on disk.
fn record_dims(
    dims: &mut DimsIndex,
    cache_dir: Option<&std::path::Path>,
    page_index: usize,
    dpi: u32,
    width: u32,
    height: u32,
) {
    dims.insert(dims_key(page_index, dpi), (width, height));
    if let Some(dir) = cache_dir {
        let _ = write_dims_index(dir, dims);
    }
}

/// Refreshes the `last_accessed` timestamp in `dir`'s manifest, if one exists.
/// Best-effort: missing or unreadable manifests are silently left alone.
fn touch_manifest_last_accessed(dir: &std::path::Path) {
    if let Some(m) = read_manifest(dir) {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let _ = write_manifest(
            dir,
            &CacheManifest {
                last_accessed: now,
                ..m
            },
        );
    }
}

pub struct PdfRenderThread {
    cmd_tx: mpsc::Sender<PdfCommand>,
    handle: Option<thread::JoinHandle<()>>,
    temp_dir: PathBuf,
}

impl PdfRenderThread {
    pub fn new(lib_path: &str) -> Result<Self, String> {
        let lib_path = lib_path.to_string();
        let (cmd_tx, cmd_rx) = mpsc::channel::<PdfCommand>();
        let (ready_tx, ready_rx) = mpsc::channel::<Result<(), String>>();
        let temp_dir = create_pdf_temp_dir()?;
        let thread_temp_dir = temp_dir.clone();

        let handle = thread::spawn(move || {
            let pdfium = match lmpdf::Pdfium::open(&lib_path) {
                Ok(p) => {
                    let _ = ready_tx.send(Ok(()));
                    p
                }
                Err(e) => {
                    let _ = ready_tx.send(Err(format!("Failed to load pdfium: {e}")));
                    return;
                }
            };

            let mut document: Option<lmpdf::Document> = None;
            let mut cache: HashMap<(usize, u32), RenderedPage> = HashMap::new();
            let mut active_cache_dir: Option<PathBuf> = None;
            // Per-page rendered dimensions for the active cache dir, persisted to
            // `dims.json` so a later warm-cache scan recovers (width,height)
            // without re-parsing every PNG header. Mirrors `cache`'s lifecycle.
            let mut dims: DimsIndex = DimsIndex::new();

            let render_page = |doc: &lmpdf::Document,
                               page_index: usize,
                               dpi: u32,
                               temp_dir: &std::path::Path|
             -> Result<RenderedPage, String> {
                let page_ref = doc
                    .page(page_index)
                    .map_err(|e| format!("Failed to get page: {e}"))?;
                let config = lmpdf::RenderConfig::new().dpi(dpi);
                let bitmap = doc
                    .render_page(page_ref, &config)
                    .map_err(|e| format!("Failed to render page: {e}"))?;

                let img = bitmap.to_image();
                let width = img.width();
                let height = img.height();

                let png_path = temp_dir.join(format!("page_{page_index}_{dpi}.png"));
                let file = fs::File::create(&png_path)
                    .map_err(|e| format!("Failed to create PNG file: {e}"))?;
                let writer = BufWriter::new(file);
                image::codecs::png::PngEncoder::new_with_quality(
                    writer,
                    image::codecs::png::CompressionType::Fast,
                    image::codecs::png::FilterType::Sub,
                )
                .write_image(img.as_bytes(), width, height, img.color().into())
                .map_err(|e| format!("PNG encode failed: {e}"))?;

                Ok(RenderedPage {
                    page_index,
                    png_path: png_path.to_string_lossy().to_string(),
                    width,
                    height,
                })
            };

            // Single source of truth for command side effects, shared by the
            // main loop and the `'precache` drain loop so the two states cannot
            // diverge. State is passed by mutable reference (not captured) to
            // avoid aliasing borrows; `render_page` is borrowed shared. The
            // returned `CmdOutcome` matches `command_outcome(&cmd)` and drives
            // the precache loop's break/flag handling. `PreCacheAll` is never
            // routed here — it is intercepted by `classify_drain_command`.
            let handle_command = |cmd: PdfCommand,
                                  document: &mut Option<lmpdf::Document>,
                                  cache: &mut HashMap<(usize, u32), RenderedPage>,
                                  active_cache_dir: &mut Option<PathBuf>,
                                  dims: &mut DimsIndex|
             -> CmdOutcome {
                // The control-flow outcome is decided by the pure
                // `command_outcome`; this closure only performs the side
                // effects. Tying them together here keeps the single source of
                // truth for precache abort/continue/shutdown decisions.
                let outcome = command_outcome(&cmd);
                match cmd {
                    PdfCommand::Open {
                        path,
                        disk_cache,
                        reply,
                    } => match pdfium.open_document(&path, None) {
                        Ok(doc) => {
                            let info = PdfInfo {
                                page_count: doc.page_count(),
                                path: path.clone(),
                            };
                            *document = Some(doc);
                            *active_cache_dir = disk_cache.map(|c| c.cache_dir);
                            *dims = active_cache_dir
                                .as_deref()
                                .map(read_dims_index)
                                .unwrap_or_default();
                            *cache = active_cache_dir
                                .as_deref()
                                .map(|d| scan_cache_dir(d, dims))
                                .unwrap_or_default();
                            let _ = reply.send(Ok(info));
                        }
                        Err(e) => {
                            let _ = reply.send(Err(format!("Failed to open PDF: {e}")));
                        }
                    },
                    PdfCommand::RenderPage {
                        page_index,
                        dpi,
                        reply,
                    } => {
                        if let Some(cached) = cache.get(&(page_index, dpi)) {
                            let _ = reply.send(Ok(cached.clone()));
                        } else {
                            let result = (|| -> Result<RenderedPage, String> {
                                let doc = document
                                    .as_ref()
                                    .ok_or_else(|| "No document open".to_string())?;
                                render_page(
                                    doc,
                                    page_index,
                                    dpi,
                                    active_cache_dir.as_deref().unwrap_or(&thread_temp_dir),
                                )
                            })();
                            if let Ok(ref rendered) = result {
                                cache.insert((page_index, dpi), rendered.clone());
                                record_dims(
                                    dims,
                                    active_cache_dir.as_deref(),
                                    page_index,
                                    dpi,
                                    rendered.width,
                                    rendered.height,
                                );
                            }
                            let _ = reply.send(result);
                        }
                    }
                    PdfCommand::Close { reply } => {
                        if let Some(dir) = active_cache_dir.as_ref() {
                            touch_manifest_last_accessed(dir);
                        }
                        *document = None;
                        cache.clear();
                        dims.clear();
                        cleanup_pdf_temp_dir(&thread_temp_dir);
                        *active_cache_dir = None;
                        let _ = reply.send(Ok(()));
                    }
                    PdfCommand::PreRender { page_index, dpi } => {
                        if !cache.contains_key(&(page_index, dpi)) {
                            if let Some(doc) = document.as_ref() {
                                if let Ok(rendered) = render_page(
                                    doc,
                                    page_index,
                                    dpi,
                                    active_cache_dir.as_deref().unwrap_or(&thread_temp_dir),
                                ) {
                                    record_dims(
                                        dims,
                                        active_cache_dir.as_deref(),
                                        page_index,
                                        dpi,
                                        rendered.width,
                                        rendered.height,
                                    );
                                    cache.insert((page_index, dpi), rendered);
                                }
                            }
                        }
                    }
                    PdfCommand::Shutdown => {}
                    // PreCacheAll has its own re-entry handling; it is never
                    // dispatched through this closure.
                    PdfCommand::PreCacheAll { .. } => unreachable!(),
                }
                outcome
            };

            while let Ok(cmd) = cmd_rx.recv() {
                match cmd {
                    cmd @ PdfCommand::PreCacheAll { .. } => {
                        // Re-entry loop: a nested PreCacheAll drained mid-spiral
                        // (e.g. a re-anchored seek) is stashed in `next` rather
                        // than dropped, then processed here with its own anchor,
                        // cancel token, and progress_tx. Dropping it would strand
                        // the progress-forwarding thread with zero events.
                        let mut next = Some(cmd);
                        let mut shutdown = false;
                        while let Some(PdfCommand::PreCacheAll {
                            dpi,
                            anchor_page,
                            cancel,
                            progress_tx,
                        }) = next.take()
                        {
                            let page_count = match document.as_ref() {
                                Some(doc) => doc.page_count(),
                                None => break, // no document; nothing to do
                            };
                            let total = page_count;
                            // Holds a superseding PreCacheAll to process next.
                            let mut pending_precache: Option<PdfCommand> = None;
                            let order = spiral_order(anchor_page, page_count);
                            let mut rendered_count = 0usize;
                            // True only if the spiral exhausts `order` without
                            // any early break. Gates the final completion send.
                            let mut completed_normally = true;
                            'precache: for page_index in order {
                            // 1. cancel check
                            if cancel.load(Ordering::Acquire) {
                                completed_normally = false;
                                break 'precache;
                            }
                            // 2. drain & handle any pending priority commands so
                            //    navigation stays responsive during precaching
                            while let Ok(pending) = cmd_rx.try_recv() {
                                let pending = match classify_drain_command(pending) {
                                    DrainAction::StashPrecache(cmd) => {
                                        // A re-anchored seek supersedes this
                                        // spiral. Stash it (overwriting any older
                                        // stashed one — the newest seek wins) and
                                        // abandon the current spiral promptly.
                                        pending_precache = Some(cmd);
                                        completed_normally = false;
                                        break 'precache;
                                    }
                                    DrainAction::Handle(cmd) => cmd,
                                };
                                // Same handler as the main loop — no duplicated
                                // command logic. Map its outcome onto the spiral's
                                // break/flag control flow.
                                match handle_command(
                                    pending,
                                    &mut document,
                                    &mut cache,
                                    &mut active_cache_dir,
                                    &mut dims,
                                ) {
                                    CmdOutcome::Continue => {}
                                    CmdOutcome::AbandonPrecache => {
                                        // Open replaced the doc, or Close tore it
                                        // down: abandon this spiral and suppress
                                        // its completion event.
                                        completed_normally = false;
                                        break 'precache;
                                    }
                                    CmdOutcome::Shutdown => {
                                        shutdown = true;
                                        completed_normally = false;
                                        break 'precache;
                                    }
                                }
                            }
                            // 3. skip if already cached. A cache HIT is zero
                            //    work: it must NOT advance `rendered_count` or
                            //    emit a throttled event, otherwise a warm disk
                            //    cache races the counter to `total` and flashes
                            //    a false 100% in the UI.
                            if cache.contains_key(&(page_index, dpi)) {
                                continue 'precache;
                            }
                            // 4. render + insert (document still present?)
                            match document.as_ref() {
                                Some(doc) => {
                                    if let Ok(r) = render_page(
                                        doc,
                                        page_index,
                                        dpi,
                                        active_cache_dir.as_deref().unwrap_or(&thread_temp_dir),
                                    ) {
                                        record_dims(
                                            &mut dims,
                                            active_cache_dir.as_deref(),
                                            page_index,
                                            dpi,
                                            r.width,
                                            r.height,
                                        );
                                        cache.insert((page_index, dpi), r);
                                        // 5. count only real renders, then emit a
                                        //    throttled progress event. The final
                                        //    (total, total) completion is sent
                                        //    separately at end-of-spiral.
                                        rendered_count += 1;
                                        if let Some(ev) =
                                            precache_progress_event(rendered_count, total)
                                        {
                                            let _ = progress_tx.send(ev);
                                        }
                                    }
                                }
                                None => {
                                    completed_normally = false;
                                    break 'precache;
                                }
                            }
                            }
                            // A spiral superseded by a stashed PreCacheAll must
                            // NOT emit a (total,total) completion on its old
                            // progress_tx — that would tell the UI the abandoned
                            // spiral finished. Its progress channel is replaced
                            // by the new spiral, which emits its own completion.
                            if let Some(p) = pending_precache.take() {
                                next = Some(p);
                                continue;
                            }
                            // Only a spiral that exhausted its order normally may
                            // emit the final completion. ANY non-normal exit
                            // (cancel flag, Open, Close, Shutdown, no-document, or
                            // a superseding PreCacheAll) must NOT send
                            // (total, total): the progress forwarder treats
                            // current >= total as done:true and would flash a
                            // false 100% to the UI for an aborted precache.
                            if should_emit_completion(completed_normally) {
                                let _ = progress_tx.send((total, total));
                            }
                        }
                        if shutdown {
                            break; // terminate the render thread
                        }
                    }
                    // Open, RenderPage, Close, PreRender, Shutdown all share the
                    // one handler. A Shutdown outcome terminates the thread.
                    other => {
                        if handle_command(
                            other,
                            &mut document,
                            &mut cache,
                            &mut active_cache_dir,
                            &mut dims,
                        ) == CmdOutcome::Shutdown
                        {
                            break;
                        }
                    }
                }
            }
        });

        ready_rx
            .recv()
            .map_err(|_| "Render thread died during init".to_string())??;

        Ok(Self {
            cmd_tx,
            handle: Some(handle),
            temp_dir,
        })
    }

    pub fn open(
        &self,
        path: &str,
        disk_cache: Option<DiskCacheConfig>,
    ) -> Result<PdfInfo, String> {
        let (tx, rx) = mpsc::channel();
        self.cmd_tx
            .send(PdfCommand::Open {
                path: path.to_string(),
                disk_cache,
                reply: tx,
            })
            .map_err(|_| "Render thread died".to_string())?;
        rx.recv().map_err(|_| "Render thread died".to_string())?
    }

    pub fn render_page(&self, page_index: usize, dpi: u32) -> Result<RenderedPage, String> {
        let (tx, rx) = mpsc::channel();
        self.cmd_tx
            .send(PdfCommand::RenderPage {
                page_index,
                dpi,
                reply: tx,
            })
            .map_err(|_| "Render thread died".to_string())?;
        rx.recv().map_err(|_| "Render thread died".to_string())?
    }

    pub fn close(&self) -> Result<(), String> {
        let (tx, rx) = mpsc::channel();
        self.cmd_tx
            .send(PdfCommand::Close { reply: tx })
            .map_err(|_| "Render thread died".to_string())?;
        rx.recv().map_err(|_| "Render thread died".to_string())?
    }

    pub fn prefetch(&self, page_index: usize, dpi: u32) -> Result<(), String> {
        self.cmd_tx
            .send(PdfCommand::PreRender { page_index, dpi })
            .map_err(|_| "Render thread died".to_string())
    }

    /// Fire-and-forget: pre-renders pages in spiral order around `anchor_page` on
    /// the render thread, reporting progress over `progress_tx`. Honors the `cancel`
    /// flag between pages and yields to pending priority commands.
    pub fn precache_all(
        &self,
        dpi: u32,
        anchor_page: usize,
        cancel: Arc<AtomicBool>,
        progress_tx: mpsc::Sender<(usize, usize)>,
    ) -> Result<(), String> {
        self.cmd_tx
            .send(PdfCommand::PreCacheAll {
                dpi,
                anchor_page,
                cancel,
                progress_tx,
            })
            .map_err(|_| "Render thread died".to_string())
    }

    /// Synchronously renders `count` pages starting at `start_page`. Individual
    /// failures (e.g. out-of-range indices) are skipped; the cache dedups repeats.
    pub fn render_pages_sync(
        &self,
        start_page: usize,
        count: usize,
        dpi: u32,
    ) -> Vec<RenderedPage> {
        let mut pages = Vec::new();
        for page_index in start_page..start_page + count {
            if let Ok(rendered) = self.render_page(page_index, dpi) {
                pages.push(rendered);
            }
        }
        pages
    }

    pub fn temp_dir(&self) -> &std::path::Path {
        &self.temp_dir
    }
}

impl Drop for PdfRenderThread {
    fn drop(&mut self) {
        let _ = self.cmd_tx.send(PdfCommand::Shutdown);
        if let Some(handle) = self.handle.take() {
            let _ = handle.join();
        }
        cleanup_pdf_temp_dir(&self.temp_dir);
    }
}

#[cfg(test)]
pub(crate) static PDFIUM_TEST_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

#[cfg(test)]
pub(crate) fn lock_pdfium() -> std::sync::MutexGuard<'static, ()> {
    PDFIUM_TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner())
}

pub fn find_libpdfium(resource_dir: Option<&std::path::Path>) -> Option<PathBuf> {
    if let Ok(p) = std::env::var("PDFIUM_LIB_PATH") {
        let path = PathBuf::from(&p);
        if path.exists() {
            return Some(path);
        }
    }

    if let Some(dir) = resource_dir {
        let lib_path = dir.join("libpdfium.dylib");
        if lib_path.exists() {
            return Some(lib_path);
        }
    }

    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let lib_path = manifest_dir.join("libs").join("libpdfium.dylib");
    if lib_path.exists() {
        return Some(lib_path);
    }

    None
}

pub fn find_libpdfium_or_default(resource_dir: Option<&std::path::Path>) -> String {
    find_libpdfium(resource_dir)
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|| "libpdfium.dylib".to_string())
}

#[cfg(test)]
fn fixture_path(name: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests")
        .join("fixtures")
        .join(name)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn require_pdfium() -> String {
        find_libpdfium(None)
            .map(|p| p.to_string_lossy().to_string())
            .expect("libpdfium not found — run scripts/fetch-pdfium.sh")
    }

    #[test]
    fn test_create_and_cleanup_temp_dir() {
        let dir = create_pdf_temp_dir().unwrap();
        assert!(dir.exists());
        cleanup_pdf_temp_dir(&dir);
        assert!(!dir.exists());
    }

    #[test]
    fn test_scan_cache_dir_uses_dims_index_without_reading_png() {
        use disk_cache::{dims_key, read_dims_index, write_dims_index, DimsIndex};
        let dir = tempfile::TempDir::new().unwrap();
        // A cataloged page whose PNG bytes are intentionally NOT a valid PNG.
        // If scan_cache_dir consulted the index, it never needs to parse these
        // bytes; if it fell back to image::image_dimensions, it would error and
        // drop the entry.
        fs::write(dir.path().join("page_0_144.png"), b"not a real png").unwrap();
        let mut idx: DimsIndex = std::collections::HashMap::new();
        idx.insert(dims_key(0, 144), (612, 792));
        write_dims_index(dir.path(), &idx).unwrap();

        let cache = scan_cache_dir(dir.path(), &read_dims_index(dir.path()));
        let page = cache.get(&(0, 144)).expect("entry should be present from index");
        assert_eq!(page.width, 612);
        assert_eq!(page.height, 792);
    }

    #[test]
    fn test_scan_cache_dir_falls_back_for_uncatalogued_png() {
        use disk_cache::read_dims_index;
        let dir = tempfile::TempDir::new().unwrap();
        // A real 2x3 RGBA PNG with NO dims.json entry: the legacy fallback must
        // recover its dimensions by parsing the header.
        let img = image::RgbaImage::new(2, 3);
        img.save(dir.path().join("page_5_144.png")).unwrap();

        let cache = scan_cache_dir(dir.path(), &read_dims_index(dir.path()));
        let page = cache.get(&(5, 144)).expect("legacy PNG should still be scanned");
        assert_eq!(page.width, 2);
        assert_eq!(page.height, 3);
    }

    #[test]
    #[ignore]
    fn test_open_returns_pdf_info() {
        let _guard = lock_pdfium();
        let lib = require_pdfium();
        let thread = PdfRenderThread::new(&lib).unwrap();
        let info = thread.open(fixture_path("sample.pdf").to_str().unwrap(), None).unwrap();
        assert_eq!(info.page_count, 2);
        assert!(info.path.ends_with("sample.pdf"));
    }

    #[test]
    #[ignore]
    fn test_render_page_writes_png_file() {
        let _guard = lock_pdfium();
        let lib = require_pdfium();
        let thread = PdfRenderThread::new(&lib).unwrap();
        thread.open(fixture_path("sample.pdf").to_str().unwrap(), None).unwrap();

        let rendered = thread.render_page(0, 144).unwrap();
        let path = std::path::Path::new(&rendered.png_path);
        assert!(path.exists(), "PNG file should exist on disk");
        let bytes = fs::read(path).unwrap();
        assert_eq!(&bytes[..4], &[0x89, 0x50, 0x4E, 0x47]); // PNG magic
        assert!(rendered.width > 0);
        assert!(rendered.height > 0);
        assert_eq!(rendered.page_index, 0);

        thread.close().unwrap();
    }

    #[test]
    #[ignore]
    fn test_close_cleans_up_temp_dir() {
        let _guard = lock_pdfium();
        let lib = require_pdfium();
        let thread = PdfRenderThread::new(&lib).unwrap();
        let temp_dir = thread.temp_dir().to_path_buf();
        thread.open(fixture_path("sample.pdf").to_str().unwrap(), None).unwrap();
        thread.render_page(0, 144).unwrap();
        assert!(temp_dir.exists());
        thread.close().unwrap();
        assert!(!temp_dir.exists());
    }

    #[test]
    #[ignore]
    fn test_close_succeeds() {
        let _guard = lock_pdfium();
        let lib = require_pdfium();
        let thread = PdfRenderThread::new(&lib).unwrap();
        thread.open(fixture_path("sample.pdf").to_str().unwrap(), None).unwrap();
        thread.close().unwrap();
    }

    #[test]
    #[ignore]
    fn test_render_after_close_returns_error() {
        let _guard = lock_pdfium();
        let lib = require_pdfium();
        let thread = PdfRenderThread::new(&lib).unwrap();
        thread.open(fixture_path("sample.pdf").to_str().unwrap(), None).unwrap();
        thread.close().unwrap();

        let result = thread.render_page(0, 144);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("No document open"));
    }

    #[test]
    #[ignore]
    fn test_open_invalid_path_returns_error() {
        let _guard = lock_pdfium();
        let lib = require_pdfium();
        let thread = PdfRenderThread::new(&lib).unwrap();
        let result = thread.open("/nonexistent/fake.pdf", None);
        assert!(result.is_err());
    }

    #[test]
    #[ignore]
    fn test_open_replaces_previous_document() {
        let _guard = lock_pdfium();
        let lib = require_pdfium();
        let thread = PdfRenderThread::new(&lib).unwrap();
        let path = fixture_path("sample.pdf").to_str().unwrap().to_string();
        let info1 = thread.open(&path, None).unwrap();
        let info2 = thread.open(&path, None).unwrap();
        assert_eq!(info1.page_count, info2.page_count);
    }

    #[test]
    #[ignore]
    fn test_render_page_with_dpi() {
        let _guard = lock_pdfium();
        let lib = require_pdfium();
        let thread = PdfRenderThread::new(&lib).unwrap();
        thread.open(fixture_path("sample.pdf").to_str().unwrap(), None).unwrap();

        let r1 = thread.render_page(0, 72).unwrap();
        let r2 = thread.render_page(0, 288).unwrap();

        assert!(
            r2.width > r1.width || r2.height > r1.height,
            "2x scale should produce larger image: {}x{} vs {}x{}",
            r2.width, r2.height, r1.width, r1.height,
        );

        thread.close().unwrap();
    }

    #[test]
    #[ignore]
    fn test_render_page_encodes_dpi_in_filename() {
        let _guard = lock_pdfium();
        let lib = require_pdfium();
        let thread = PdfRenderThread::new(&lib).unwrap();
        thread.open(fixture_path("sample.pdf").to_str().unwrap(), None).unwrap();

        let rendered = thread.render_page(0, 144).unwrap();
        assert!(
            rendered.png_path.contains("page_0_144.png"),
            "Expected DPI in filename, got: {}",
            rendered.png_path
        );

        thread.close().unwrap();
    }

    #[test]
    #[ignore]
    fn test_render_page_returns_cached_without_rewrite() {
        let _guard = lock_pdfium();
        let lib = require_pdfium();
        let thread = PdfRenderThread::new(&lib).unwrap();
        thread.open(fixture_path("sample.pdf").to_str().unwrap(), None).unwrap();

        let r1 = thread.render_page(0, 144).unwrap();
        let mtime1 = fs::metadata(&r1.png_path).unwrap().modified().unwrap();

        std::thread::sleep(std::time::Duration::from_millis(50));

        let r2 = thread.render_page(0, 144).unwrap();
        let mtime2 = fs::metadata(&r2.png_path).unwrap().modified().unwrap();

        assert_eq!(r1.png_path, r2.png_path);
        assert_eq!(mtime1, mtime2, "File should not have been rewritten");

        thread.close().unwrap();
    }

    #[test]
    #[ignore]
    fn test_cache_invalidated_on_open() {
        let _guard = lock_pdfium();
        let lib = require_pdfium();
        let thread = PdfRenderThread::new(&lib).unwrap();
        let pdf = fixture_path("sample.pdf").to_str().unwrap().to_string();
        thread.open(&pdf, None).unwrap();

        let r1 = thread.render_page(0, 144).unwrap();
        let mtime1 = fs::metadata(&r1.png_path).unwrap().modified().unwrap();

        std::thread::sleep(std::time::Duration::from_millis(50));

        thread.open(&pdf, None).unwrap();
        let r2 = thread.render_page(0, 144).unwrap();
        let mtime2 = fs::metadata(&r2.png_path).unwrap().modified().unwrap();

        assert!(mtime2 > mtime1, "File should have been re-rendered after re-open");

        thread.close().unwrap();
    }

    #[test]
    #[ignore]
    fn test_prefetch_creates_png_without_blocking() {
        let _guard = lock_pdfium();
        let lib = require_pdfium();
        let thread = PdfRenderThread::new(&lib).unwrap();
        thread.open(fixture_path("sample.pdf").to_str().unwrap(), None).unwrap();

        thread.prefetch(1, 144).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(500));

        let expected = thread.temp_dir().join("page_1_144.png");
        assert!(expected.exists(), "Prefetched PNG should exist at {:?}", expected);

        thread.close().unwrap();
    }

    #[test]
    #[ignore]
    fn test_prefetch_no_document_does_not_panic() {
        let _guard = lock_pdfium();
        let lib = require_pdfium();
        let thread = PdfRenderThread::new(&lib).unwrap();
        let result = thread.prefetch(0, 144);
        assert!(result.is_ok());
    }

    #[test]
    #[ignore]
    fn test_prefetch_populates_cache_for_subsequent_render() {
        let _guard = lock_pdfium();
        let lib = require_pdfium();
        let thread = PdfRenderThread::new(&lib).unwrap();
        thread.open(fixture_path("sample.pdf").to_str().unwrap(), None).unwrap();

        thread.prefetch(0, 144).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(500));

        let png_path = thread.temp_dir().join("page_0_144.png");
        let mtime1 = fs::metadata(&png_path).unwrap().modified().unwrap();

        std::thread::sleep(std::time::Duration::from_millis(50));

        let rendered = thread.render_page(0, 144).unwrap();
        let mtime2 = fs::metadata(&rendered.png_path).unwrap().modified().unwrap();
        assert_eq!(mtime1, mtime2, "render_page should use prefetched cache");

        thread.close().unwrap();
    }

    #[test]
    #[ignore]
    fn test_render_page_writes_to_persistent_dir() {
        let _guard = lock_pdfium();
        let lib = require_pdfium();
        let persist = tempfile::TempDir::new().unwrap();
        let thread = PdfRenderThread::new(&lib).unwrap();
        thread
            .open(
                fixture_path("sample.pdf").to_str().unwrap(),
                Some(DiskCacheConfig {
                    cache_dir: persist.path().to_path_buf(),
                    dpi: 144,
                }),
            )
            .unwrap();

        let rendered = thread.render_page(0, 144).unwrap();
        assert!(
            rendered.png_path.starts_with(persist.path().to_str().unwrap()),
            "PNG should be written to persistent dir, got: {}",
            rendered.png_path
        );
        assert!(
            !rendered.png_path.starts_with(thread.temp_dir().to_str().unwrap()),
            "PNG should NOT be in the thread temp dir"
        );
        assert!(persist.path().join("page_0_144.png").exists());

        thread.close().unwrap();
    }

    #[test]
    #[ignore]
    fn test_persistent_cache_survives_close() {
        let _guard = lock_pdfium();
        let lib = require_pdfium();
        let persist = tempfile::TempDir::new().unwrap();
        let thread = PdfRenderThread::new(&lib).unwrap();
        thread
            .open(
                fixture_path("sample.pdf").to_str().unwrap(),
                Some(DiskCacheConfig {
                    cache_dir: persist.path().to_path_buf(),
                    dpi: 144,
                }),
            )
            .unwrap();

        let _rendered = thread.render_page(0, 144).unwrap();
        thread.close().unwrap();

        assert!(
            persist.path().join("page_0_144.png").exists(),
            "persistent PNG should survive close"
        );
    }

    #[test]
    #[ignore]
    fn test_reopen_with_warm_cache_is_cache_hit() {
        let _guard = lock_pdfium();
        let lib = require_pdfium();
        let persist = tempfile::TempDir::new().unwrap();
        let cfg = DiskCacheConfig {
            cache_dir: persist.path().to_path_buf(),
            dpi: 144,
        };
        let pdf = fixture_path("sample.pdf").to_str().unwrap().to_string();
        let thread = PdfRenderThread::new(&lib).unwrap();
        thread.open(&pdf, Some(cfg.clone())).unwrap();

        let r1 = thread.render_page(0, 144).unwrap();
        let png = persist.path().join("page_0_144.png");
        let mtime1 = fs::metadata(&png).unwrap().modified().unwrap();

        std::thread::sleep(std::time::Duration::from_millis(50));

        thread.close().unwrap();
        thread.open(&pdf, Some(cfg.clone())).unwrap();

        let r2 = thread.render_page(0, 144).unwrap();
        let mtime2 = fs::metadata(&png).unwrap().modified().unwrap();

        assert_eq!(r2.png_path, png.to_string_lossy().to_string());
        assert_eq!(r1.png_path, r2.png_path);
        assert_eq!(mtime1, mtime2, "warm reopen should be a cache hit, not a re-render");

        thread.close().unwrap();
    }

    #[test]
    fn test_page_types_are_usize() {
        let info = PdfInfo { page_count: 0usize, path: String::new() };
        let _: usize = info.page_count;

        let rendered = RenderedPage {
            page_index: 0usize,
            png_path: String::new(),
            width: 0,
            height: 0,
        };
        let _: usize = rendered.page_index;
    }

    #[test]
    fn test_shutdown_command_variant_exists() {
        let _cmd = PdfCommand::Shutdown;
    }

    #[test]
    fn test_disk_cache_config_struct_fields() {
        let cfg = DiskCacheConfig {
            cache_dir: PathBuf::from("/tmp/cache/abc"),
            dpi: 144,
        };
        assert_eq!(cfg.cache_dir, PathBuf::from("/tmp/cache/abc"));
        assert_eq!(cfg.dpi, 144);
    }

    #[test]
    fn test_open_with_disk_cache_config_compiles() {
        let (tx, _rx) = mpsc::channel::<Result<PdfInfo, String>>();
        let _cmd = PdfCommand::Open {
            path: String::new(),
            disk_cache: Some(DiskCacheConfig {
                cache_dir: PathBuf::from("/tmp/x"),
                dpi: 144,
            }),
            reply: tx,
        };
    }

    #[test]
    fn test_precache_all_command_variant_exists() {
        let (tx, _rx) = mpsc::channel::<(usize, usize)>();
        let _cmd = PdfCommand::PreCacheAll {
            dpi: 144,
            anchor_page: 0,
            cancel: Arc::new(AtomicBool::new(false)),
            progress_tx: tx,
        };
    }

    #[test]
    fn test_precache_all_command_accepts_anchor_page() {
        let (tx, _rx) = mpsc::channel::<(usize, usize)>();
        let _cmd = PdfCommand::PreCacheAll {
            dpi: 144,
            anchor_page: 3,
            cancel: Arc::new(AtomicBool::new(false)),
            progress_tx: tx,
        };
    }

    #[test]
    fn test_nested_precache_is_stashed_not_dropped() {
        // A nested PreCacheAll drained while a spiral runs must be classified as
        // StashPrecache (carrying the command), NOT silently handled/dropped.
        let (tx, rx) = mpsc::channel::<(usize, usize)>();
        let cmd = PdfCommand::PreCacheAll {
            dpi: 144,
            anchor_page: 7,
            cancel: Arc::new(AtomicBool::new(false)),
            progress_tx: tx,
        };

        match classify_drain_command(cmd) {
            DrainAction::StashPrecache(PdfCommand::PreCacheAll {
                anchor_page,
                progress_tx,
                ..
            }) => {
                assert_eq!(anchor_page, 7, "stashed command must retain its anchor");
                // The progress channel must NOT have been dropped: a send must
                // succeed and the receiver must observe it. This is the crux of
                // the bug — dropping progress_tx strands the forwarding thread.
                progress_tx
                    .send((1, 10))
                    .expect("stashed progress_tx must still be live");
                assert_eq!(rx.recv().unwrap(), (1, 10));
            }
            DrainAction::StashPrecache(_) => panic!("stashed wrong command variant"),
            DrainAction::Handle(_) => panic!("nested PreCacheAll was not stashed"),
        }
    }

    #[test]
    fn test_command_outcome_open_abandons_precache() {
        let (tx, _rx) = mpsc::channel::<Result<PdfInfo, String>>();
        let cmd = PdfCommand::Open {
            path: String::new(),
            disk_cache: None,
            reply: tx,
        };
        assert_eq!(command_outcome(&cmd), CmdOutcome::AbandonPrecache);
    }

    #[test]
    fn test_command_outcome_close_abandons_precache() {
        let (tx, _rx) = mpsc::channel::<Result<(), String>>();
        let cmd = PdfCommand::Close { reply: tx };
        assert_eq!(command_outcome(&cmd), CmdOutcome::AbandonPrecache);
    }

    #[test]
    fn test_command_outcome_shutdown_is_shutdown() {
        let cmd = PdfCommand::Shutdown;
        assert_eq!(command_outcome(&cmd), CmdOutcome::Shutdown);
    }

    #[test]
    fn test_command_outcome_render_page_continues() {
        let (tx, _rx) = mpsc::channel::<Result<RenderedPage, String>>();
        let cmd = PdfCommand::RenderPage {
            page_index: 0,
            dpi: 144,
            reply: tx,
        };
        assert_eq!(command_outcome(&cmd), CmdOutcome::Continue);
    }

    #[test]
    fn test_command_outcome_pre_render_continues() {
        let cmd = PdfCommand::PreRender {
            page_index: 0,
            dpi: 144,
        };
        assert_eq!(command_outcome(&cmd), CmdOutcome::Continue);
    }

    #[test]
    fn test_non_precache_command_is_handled_not_stashed() {
        let (tx, _rx) = mpsc::channel::<(usize, usize)>();
        let _ = tx;
        let cmd = PdfCommand::PreRender {
            page_index: 2,
            dpi: 144,
        };
        match classify_drain_command(cmd) {
            DrainAction::Handle(PdfCommand::PreRender { page_index, .. }) => {
                assert_eq!(page_index, 2);
            }
            DrainAction::Handle(_) => panic!("handled wrong command variant"),
            DrainAction::StashPrecache(_) => panic!("non-precache must not be stashed"),
        }
    }

    #[test]
    fn test_spiral_order_at_start() {
        assert_eq!(spiral_order(0, 5), vec![0usize, 1, 2, 3, 4]);
    }

    #[test]
    fn test_spiral_order_at_middle() {
        assert_eq!(spiral_order(3, 7), vec![3usize, 4, 2, 5, 1, 6, 0]);
    }

    #[test]
    fn test_spiral_order_at_end() {
        assert_eq!(spiral_order(4, 5), vec![4usize, 3, 2, 1, 0]);
    }

    #[test]
    fn test_spiral_order_single_page() {
        assert_eq!(spiral_order(0, 1), vec![0usize]);
    }

    #[test]
    fn test_spiral_order_empty() {
        let empty: Vec<usize> = vec![];
        assert_eq!(spiral_order(0, 0), empty);
    }

    #[test]
    fn test_no_completion_send_on_abort() {
        // Any non-normal spiral exit (cancel, Open, Close, Shutdown,
        // no-document, superseded) must NOT emit a (total, total)
        // completion, since the forwarder treats current >= total as done.
        assert!(!should_emit_completion(false));
    }

    #[test]
    fn test_completion_send_on_normal_finish() {
        // A spiral that exhausts its order normally must emit completion.
        assert!(should_emit_completion(true));
    }

    #[test]
    fn test_precache_progress_event_throttles_every_5() {
        // A throttled intermediate progress event fires only on multiples of 5
        // renders, never at 0.
        assert_eq!(precache_progress_event(5, 20), Some((5, 20)));
        assert_eq!(precache_progress_event(4, 20), None);
        assert_eq!(precache_progress_event(0, 20), None);
        assert_eq!(precache_progress_event(10, 20), Some((10, 20)));
    }

    #[test]
    fn test_precache_progress_counts_only_renders() {
        // Simulate the spiral's progress accounting: a cache HIT must contribute
        // zero — neither an increment nor an intermediate event. Only a real
        // render advances `rendered_count` and may emit a throttled event.
        //
        // This mirrors the production loop's step 3/4/5 without touching pdfium.
        fn run(total: usize, cached: &[bool]) -> (usize, Vec<(usize, usize)>) {
            let mut rendered_count = 0usize;
            let mut events = Vec::new();
            for &is_cached in cached {
                if is_cached {
                    // cache hit: zero work, no counter change, no event
                    continue;
                }
                rendered_count += 1;
                if let Some(ev) = precache_progress_event(rendered_count, total) {
                    events.push(ev);
                }
            }
            (rendered_count, events)
        }

        // Fully warm cache: every page already cached. No renders, so no
        // intermediate events, and crucially NO event with current == total
        // (the false-100% regression this finding fixes).
        let warm = vec![true; 12];
        let (rendered, events) = run(12, &warm);
        assert_eq!(rendered, 0, "warm cache renders nothing");
        assert!(events.is_empty(), "warm cache emits no intermediate events");
        assert!(
            !events.iter().any(|&(cur, tot)| cur == tot),
            "warm cache must not flash a false 100%"
        );

        // Fully cold cache: every page rendered, counter reaches total.
        let cold = vec![false; 12];
        let (rendered, _events) = run(12, &cold);
        assert_eq!(rendered, 12, "cold cache renders every page");

        // Partially warm: 7 cached, 5 rendered. Counter reflects only renders.
        let partial = vec![
            true, false, true, false, true, false, true, false, true, false, true, true,
        ];
        let (rendered, events) = run(12, &partial);
        assert_eq!(rendered, 5, "partial cache counts only the 5 renders");
        // The single throttled event at render #5 reports (5, 12), never (12, 12).
        assert_eq!(events, vec![(5, 12)]);
        assert!(!events.iter().any(|&(cur, tot)| cur == tot));
    }

    #[test]
    #[ignore]
    fn test_precache_all_caches_all_pages() {
        let _guard = lock_pdfium();
        let lib = require_pdfium();
        let thread = PdfRenderThread::new(&lib).unwrap();
        thread.open(fixture_path("sample.pdf").to_str().unwrap(), None).unwrap();

        let cancel = Arc::new(AtomicBool::new(false));
        let (tx, rx) = mpsc::channel::<(usize, usize)>();
        thread.precache_all(144, 0, cancel, tx).unwrap();

        // Drain until completion (n == total) or timeout.
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(2);
        loop {
            match rx.recv_timeout(std::time::Duration::from_millis(200)) {
                Ok((n, total)) if n == total => break,
                Ok(_) => {}
                Err(_) => {
                    if std::time::Instant::now() > deadline {
                        panic!("precache did not complete in time");
                    }
                }
            }
        }

        assert!(thread.temp_dir().join("page_0_144.png").exists());
        assert!(thread.temp_dir().join("page_1_144.png").exists());

        thread.close().unwrap();
    }

    #[test]
    #[ignore]
    fn test_seek_precache_during_active_precache_emits_progress() {
        // A re-anchored seek issues a second PreCacheAll while the first spiral
        // is still running. The second command (with a fresh cancel + new
        // progress channel) must NOT be silently dropped: its progress channel
        // must receive a final (total, total). Regression for the ARM
        // weak-memory race that discarded the nested PreCacheAll.
        let _guard = lock_pdfium();
        let lib = require_pdfium();
        let thread = PdfRenderThread::new(&lib).unwrap();
        thread.open(fixture_path("sample.pdf").to_str().unwrap(), None).unwrap();

        // First spiral.
        let cancel1 = Arc::new(AtomicBool::new(false));
        let (tx1, _rx1) = mpsc::channel::<(usize, usize)>();
        thread.precache_all(144, 0, Arc::clone(&cancel1), tx1).unwrap();

        // Re-anchored seek: cancel the first, send a second with a new channel.
        cancel1.store(true, Ordering::Release);
        let cancel2 = Arc::new(AtomicBool::new(false));
        let (tx2, rx2) = mpsc::channel::<(usize, usize)>();
        thread.precache_all(144, 1, cancel2, tx2).unwrap();

        // The SECOND channel must observe a final completion.
        let mut last = None;
        while let Ok(msg) = rx2.recv_timeout(std::time::Duration::from_millis(500)) {
            last = Some(msg);
        }
        assert_eq!(
            last,
            Some((2, 2)),
            "the re-anchored seek's progress channel must receive (total, total)"
        );

        thread.close().unwrap();
    }

    #[test]
    #[ignore]
    fn test_precache_all_emits_final_progress() {
        let _guard = lock_pdfium();
        let lib = require_pdfium();
        let thread = PdfRenderThread::new(&lib).unwrap();
        thread.open(fixture_path("sample.pdf").to_str().unwrap(), None).unwrap();

        let cancel = Arc::new(AtomicBool::new(false));
        let (tx, rx) = mpsc::channel::<(usize, usize)>();
        thread.precache_all(144, 0, cancel, tx).unwrap();

        let mut last = None;
        while let Ok(msg) = rx.recv_timeout(std::time::Duration::from_millis(500)) {
            last = Some(msg);
        }
        assert_eq!(last, Some((2, 2)), "final progress should be (page_count, page_count)");

        thread.close().unwrap();
    }

    #[test]
    #[ignore]
    fn test_precache_warm_cache_does_not_flash_false_completion() {
        // Warm-cache regression: with every page already rendered to disk, the
        // spiral does zero rendering work. Intermediate progress events count
        // only real renders, so the channel must NOT emit (total, total) until
        // the deliberate end-of-spiral completion. Before the fix, the counter
        // raced from 0 to total on cache hits and flashed an instant 100%.
        let _guard = lock_pdfium();
        let lib = require_pdfium();
        let thread = PdfRenderThread::new(&lib).unwrap();
        thread.open(fixture_path("sample.pdf").to_str().unwrap(), None).unwrap();

        // Pre-render every page so the upcoming precache is all cache hits.
        thread.render_page(0, 144).unwrap();
        thread.render_page(1, 144).unwrap();

        let cancel = Arc::new(AtomicBool::new(false));
        let (tx, rx) = mpsc::channel::<(usize, usize)>();
        thread.precache_all(144, 0, cancel, tx).unwrap();

        // Collect every event in order.
        let mut events = Vec::new();
        while let Ok(msg) = rx.recv_timeout(std::time::Duration::from_millis(500)) {
            events.push(msg);
        }

        // Exactly one event — the authoritative completion — and no
        // intermediate event reaches (total, total).
        assert_eq!(
            events,
            vec![(2, 2)],
            "warm cache must emit only the final completion, never an inflated intermediate 100%"
        );

        thread.close().unwrap();
    }

    #[test]
    #[ignore]
    fn test_precache_all_skips_already_cached() {
        let _guard = lock_pdfium();
        let lib = require_pdfium();
        let thread = PdfRenderThread::new(&lib).unwrap();
        thread.open(fixture_path("sample.pdf").to_str().unwrap(), None).unwrap();

        let r0 = thread.render_page(0, 144).unwrap();
        let mtime0 = fs::metadata(&r0.png_path).unwrap().modified().unwrap();

        std::thread::sleep(std::time::Duration::from_millis(50));

        let cancel = Arc::new(AtomicBool::new(false));
        let (tx, rx) = mpsc::channel::<(usize, usize)>();
        thread.precache_all(144, 0, cancel, tx).unwrap();
        while let Ok(msg) = rx.recv_timeout(std::time::Duration::from_millis(500)) {
            if msg.0 == msg.1 {
                break;
            }
        }

        let mtime0_after = fs::metadata(&r0.png_path).unwrap().modified().unwrap();
        assert_eq!(mtime0, mtime0_after, "already-cached page should not be re-rendered");
        assert!(thread.temp_dir().join("page_1_144.png").exists());

        thread.close().unwrap();
    }

    #[test]
    #[ignore]
    fn test_precache_all_render_page_priority_during_precache() {
        let _guard = lock_pdfium();
        let lib = require_pdfium();
        let thread = PdfRenderThread::new(&lib).unwrap();
        thread.open(fixture_path("sample.pdf").to_str().unwrap(), None).unwrap();

        let cancel = Arc::new(AtomicBool::new(false));
        let (tx, _rx) = mpsc::channel::<(usize, usize)>();
        thread.precache_all(144, 0, cancel, tx).unwrap();

        // RenderPage goes through the same channel and must be served promptly.
        let rendered = thread.render_page(1, 144).unwrap();
        assert_eq!(rendered.page_index, 1);
        assert!(std::path::Path::new(&rendered.png_path).exists());

        thread.close().unwrap();
    }

    #[test]
    #[ignore]
    fn test_precache_all_cancel_stops_loop() {
        let _guard = lock_pdfium();
        let lib = require_pdfium();
        let thread = PdfRenderThread::new(&lib).unwrap();
        thread.open(fixture_path("sample.pdf").to_str().unwrap(), None).unwrap();

        let cancel = Arc::new(AtomicBool::new(true));
        let (tx, rx) = mpsc::channel::<(usize, usize)>();
        thread.precache_all(144, 0, cancel, tx).unwrap();

        // Drain any progress; a cancelled spiral emits no completion send.
        while rx.recv_timeout(std::time::Duration::from_millis(300)).is_ok() {}

        assert!(
            !thread.temp_dir().join("page_0_144.png").exists(),
            "cancelled precache should not render pages"
        );
        assert!(
            !thread.temp_dir().join("page_1_144.png").exists(),
            "cancelled precache should not render pages"
        );

        thread.close().unwrap();
    }

    #[test]
    #[ignore]
    fn test_precache_cancel_does_not_emit_false_completion() {
        // A pre-cancelled precache must not deliver a (total, total)
        // completion, which the forwarder would interpret as done:true and
        // flash a false 100% to the UI.
        let _guard = lock_pdfium();
        let lib = require_pdfium();
        let thread = PdfRenderThread::new(&lib).unwrap();
        let info = thread.open(fixture_path("sample.pdf").to_str().unwrap(), None).unwrap();
        let total = info.page_count;

        let cancel = Arc::new(AtomicBool::new(true));
        let (tx, rx) = mpsc::channel::<(usize, usize)>();
        thread.precache_all(144, 0, cancel, tx).unwrap();

        let mut last: Option<(usize, usize)> = None;
        while let Ok(msg) = rx.recv_timeout(std::time::Duration::from_millis(300)) {
            last = Some(msg);
        }
        assert_ne!(
            last,
            Some((total, total)),
            "cancelled precache must not emit (total, total) completion"
        );

        thread.close().unwrap();
    }

    #[test]
    #[ignore]
    fn test_precache_all_no_document_does_not_panic() {
        let _guard = lock_pdfium();
        let lib = require_pdfium();
        let thread = PdfRenderThread::new(&lib).unwrap();
        let cancel = Arc::new(AtomicBool::new(false));
        let (tx, _rx) = mpsc::channel::<(usize, usize)>();
        let result = thread.precache_all(144, 0, cancel, tx);
        assert!(result.is_ok());
        // Thread should still be alive and responsive.
        let r = thread.prefetch(0, 144);
        assert!(r.is_ok());
    }

    #[test]
    #[ignore]
    fn test_render_pages_sync_returns_pages() {
        let _guard = lock_pdfium();
        let lib = require_pdfium();
        let thread = PdfRenderThread::new(&lib).unwrap();
        thread.open(fixture_path("sample.pdf").to_str().unwrap(), None).unwrap();

        let pages = thread.render_pages_sync(0, 2, 144);
        assert_eq!(pages.len(), 2);
        assert_eq!(pages[0].page_index, 0);
        assert_eq!(pages[1].page_index, 1);
        assert!(std::path::Path::new(&pages[0].png_path).exists());
        assert!(std::path::Path::new(&pages[1].png_path).exists());

        thread.close().unwrap();
    }

    #[test]
    #[ignore]
    fn test_render_pages_sync_clamps_out_of_range() {
        let _guard = lock_pdfium();
        let lib = require_pdfium();
        let thread = PdfRenderThread::new(&lib).unwrap();
        thread.open(fixture_path("sample.pdf").to_str().unwrap(), None).unwrap();

        let pages = thread.render_pages_sync(0, 5, 144);
        assert_eq!(pages.len(), 2, "out-of-range pages should be skipped, not panic");

        thread.close().unwrap();
    }

    #[test]
    #[ignore]
    fn test_render_pages_sync_uses_cache() {
        let _guard = lock_pdfium();
        let lib = require_pdfium();
        let thread = PdfRenderThread::new(&lib).unwrap();
        thread.open(fixture_path("sample.pdf").to_str().unwrap(), None).unwrap();

        let r0 = thread.render_page(0, 144).unwrap();
        let mtime0 = fs::metadata(&r0.png_path).unwrap().modified().unwrap();

        std::thread::sleep(std::time::Duration::from_millis(50));

        let pages = thread.render_pages_sync(0, 1, 144);
        assert_eq!(pages.len(), 1);
        let mtime0_after = fs::metadata(&pages[0].png_path).unwrap().modified().unwrap();
        assert_eq!(mtime0, mtime0_after, "cache hit should not rewrite the PNG");

        thread.close().unwrap();
    }

    #[test]
    #[ignore]
    fn test_drop_joins_thread() {
        let _guard = lock_pdfium();
        let lib = require_pdfium();
        let temp_dir;
        {
            let thread = PdfRenderThread::new(&lib).unwrap();
            temp_dir = thread.temp_dir().to_path_buf();
            thread.open(fixture_path("sample.pdf").to_str().unwrap(), None).unwrap();
            assert!(temp_dir.exists());
        }
        assert!(!temp_dir.exists(), "temp dir should be cleaned up on drop");
        let thread2 = PdfRenderThread::new(&lib).unwrap();
        let info = thread2.open(fixture_path("sample.pdf").to_str().unwrap(), None).unwrap();
        assert_eq!(info.page_count, 2);
    }

    #[test]
    #[ignore]
    fn test_close_then_reopen_works() {
        let _guard = lock_pdfium();
        let lib = require_pdfium();
        let thread = PdfRenderThread::new(&lib).unwrap();
        thread.open(fixture_path("sample.pdf").to_str().unwrap(), None).unwrap();
        thread.close().unwrap();
        let info = thread.open(fixture_path("sample.pdf").to_str().unwrap(), None).unwrap();
        assert_eq!(info.page_count, 2);
    }

    #[test]
    #[ignore]
    fn test_sequential_create_drop_does_not_crash() {
        let _guard = lock_pdfium();
        let lib = require_pdfium();
        for _ in 0..5 {
            let thread = PdfRenderThread::new(&lib).unwrap();
            thread.open(fixture_path("sample.pdf").to_str().unwrap(), None).unwrap();
            drop(thread);
        }
    }

    #[test]
    fn test_pdfium_lock_is_acquirable() {
        let guard = lock_pdfium();
        assert!(std::sync::Mutex::try_lock(&PDFIUM_TEST_LOCK).is_err());
        drop(guard);
    }

    #[test]
    fn test_find_libpdfium_checks_resource_dir() {
        let dir = std::env::temp_dir().join("lit-test-pdfium-res");
        let _ = std::fs::create_dir_all(&dir);
        let fake_lib = dir.join("libpdfium.dylib");
        std::fs::write(&fake_lib, b"fake").unwrap();

        let result = find_libpdfium(Some(dir.as_path()));
        assert_eq!(result, Some(fake_lib));

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_find_libpdfium_skips_missing_resource_dir_file() {
        let dir = std::env::temp_dir().join("lit-test-pdfium-empty");
        let _ = std::fs::create_dir_all(&dir);

        let result = find_libpdfium(Some(dir.as_path()));
        if let Some(ref p) = result {
            assert!(!p.starts_with(&dir));
        }

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_find_libpdfium_none_does_not_panic() {
        let _result: Option<PathBuf> = find_libpdfium(None);
    }

    #[test]
    fn test_pdfium_lock_recovers_from_poison() {
        let handle = std::thread::spawn(|| {
            let _guard = lock_pdfium();
            panic!("intentional poison");
        });
        let _ = handle.join();
        let _guard = lock_pdfium();
    }
}
