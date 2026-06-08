use image::ImageEncoder;
use std::collections::HashMap;
use std::fs;
use std::io::BufWriter;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::sync::Arc;
use std::thread;

use serde::Serialize;

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

enum PdfCommand {
    Open {
        path: String,
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
        start_page: usize,
        cancel: Arc<AtomicBool>,
        progress_tx: mpsc::Sender<(usize, usize)>, // (current, total)
    },
    Shutdown,
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

            while let Ok(cmd) = cmd_rx.recv() {
                match cmd {
                    PdfCommand::Open { path, reply } => {
                        match pdfium.open_document(&path, None) {
                            Ok(doc) => {
                                let info = PdfInfo {
                                    page_count: doc.page_count(),
                                    path: path.clone(),
                                };
                                document = Some(doc);
                                cache.clear();
                                let _ = reply.send(Ok(info));
                            }
                            Err(e) => {
                                let _ = reply.send(Err(format!("Failed to open PDF: {e}")));
                            }
                        }
                    }
                    PdfCommand::RenderPage {
                        page_index,
                        dpi,
                        reply,
                    } => {
                        if let Some(cached) = cache.get(&(page_index, dpi)) {
                            let _ = reply.send(Ok(cached.clone()));
                            continue;
                        }
                        let result = (|| -> Result<RenderedPage, String> {
                            let doc = document
                                .as_ref()
                                .ok_or_else(|| "No document open".to_string())?;
                            render_page(doc, page_index, dpi, &thread_temp_dir)
                        })();
                        if let Ok(ref rendered) = result {
                            cache.insert((page_index, dpi), rendered.clone());
                        }
                        let _ = reply.send(result);
                    }
                    PdfCommand::Close { reply } => {
                        document = None;
                        cache.clear();
                        cleanup_pdf_temp_dir(&thread_temp_dir);
                        let _ = reply.send(Ok(()));
                    }
                    PdfCommand::PreRender { page_index, dpi } => {
                        if cache.contains_key(&(page_index, dpi)) {
                            continue;
                        }
                        if let Some(doc) = document.as_ref() {
                            if let Ok(rendered) =
                                render_page(doc, page_index, dpi, &thread_temp_dir)
                            {
                                cache.insert((page_index, dpi), rendered);
                            }
                        }
                    }
                    PdfCommand::PreCacheAll {
                        dpi,
                        start_page,
                        cancel,
                        progress_tx,
                    } => {
                        let page_count = match document.as_ref() {
                            Some(doc) => doc.page_count(),
                            None => continue, // no document; nothing to do
                        };
                        let total = page_count;
                        let mut shutdown = false;
                        'precache: for page_index in start_page..page_count {
                            // 1. cancel check
                            if cancel.load(Ordering::Relaxed) {
                                break 'precache;
                            }
                            // 2. drain & handle any pending priority commands so
                            //    navigation stays responsive during precaching
                            while let Ok(pending) = cmd_rx.try_recv() {
                                match pending {
                                    PdfCommand::RenderPage {
                                        page_index: pi,
                                        dpi: pd,
                                        reply,
                                    } => {
                                        if let Some(cached) = cache.get(&(pi, pd)) {
                                            let _ = reply.send(Ok(cached.clone()));
                                        } else {
                                            let result = (|| -> Result<RenderedPage, String> {
                                                let doc = document.as_ref().ok_or_else(|| {
                                                    "No document open".to_string()
                                                })?;
                                                render_page(doc, pi, pd, &thread_temp_dir)
                                            })();
                                            if let Ok(ref r) = result {
                                                cache.insert((pi, pd), r.clone());
                                            }
                                            let _ = reply.send(result);
                                        }
                                    }
                                    PdfCommand::Open { path, reply } => {
                                        // a new document supersedes precache
                                        match pdfium.open_document(&path, None) {
                                            Ok(doc) => {
                                                let info = PdfInfo {
                                                    page_count: doc.page_count(),
                                                    path: path.clone(),
                                                };
                                                document = Some(doc);
                                                cache.clear();
                                                let _ = reply.send(Ok(info));
                                            }
                                            Err(e) => {
                                                let _ = reply
                                                    .send(Err(format!("Failed to open PDF: {e}")));
                                            }
                                        }
                                        break 'precache; // abandon precache for the old doc
                                    }
                                    PdfCommand::Close { reply } => {
                                        document = None;
                                        cache.clear();
                                        cleanup_pdf_temp_dir(&thread_temp_dir);
                                        let _ = reply.send(Ok(()));
                                        break 'precache; // document gone; stop precaching
                                    }
                                    PdfCommand::PreRender {
                                        page_index: pi,
                                        dpi: pd,
                                    } => {
                                        if cache.contains_key(&(pi, pd)) {
                                            continue;
                                        }
                                        if let Some(doc) = document.as_ref() {
                                            if let Ok(r) =
                                                render_page(doc, pi, pd, &thread_temp_dir)
                                            {
                                                cache.insert((pi, pd), r);
                                            }
                                        }
                                    }
                                    PdfCommand::Shutdown => {
                                        shutdown = true;
                                        break 'precache;
                                    }
                                    PdfCommand::PreCacheAll { .. } => { /* ignore nested */ }
                                }
                            }
                            // 3. skip if already cached
                            if cache.contains_key(&(page_index, dpi)) {
                                continue;
                            }
                            // 4. render + insert (document still present?)
                            match document.as_ref() {
                                Some(doc) => {
                                    if let Ok(r) =
                                        render_page(doc, page_index, dpi, &thread_temp_dir)
                                    {
                                        cache.insert((page_index, dpi), r);
                                    }
                                }
                                None => break 'precache,
                            }
                            // 5. throttled progress: every 5 pages and on the final page
                            let done_count = page_index + 1;
                            if done_count % 5 == 0 || done_count == total {
                                let _ = progress_tx.send((done_count, total));
                            }
                        }
                        // Always send a final completion so consumers see (total, total).
                        let _ = progress_tx.send((total, total));
                        if shutdown {
                            break; // terminate the render thread
                        }
                    }
                    PdfCommand::Shutdown => {
                        break;
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

    pub fn open(&self, path: &str) -> Result<PdfInfo, String> {
        let (tx, rx) = mpsc::channel();
        self.cmd_tx
            .send(PdfCommand::Open {
                path: path.to_string(),
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

    /// Fire-and-forget: pre-renders all pages from `start_page` to the end on the
    /// render thread, reporting progress over `progress_tx`. Honors the `cancel`
    /// flag between pages and yields to pending priority commands.
    pub fn precache_all(
        &self,
        dpi: u32,
        start_page: usize,
        cancel: Arc<AtomicBool>,
        progress_tx: mpsc::Sender<(usize, usize)>,
    ) -> Result<(), String> {
        self.cmd_tx
            .send(PdfCommand::PreCacheAll {
                dpi,
                start_page,
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
    #[ignore]
    fn test_open_returns_pdf_info() {
        let _guard = lock_pdfium();
        let lib = require_pdfium();
        let thread = PdfRenderThread::new(&lib).unwrap();
        let info = thread.open(fixture_path("sample.pdf").to_str().unwrap()).unwrap();
        assert_eq!(info.page_count, 2);
        assert!(info.path.ends_with("sample.pdf"));
    }

    #[test]
    #[ignore]
    fn test_render_page_writes_png_file() {
        let _guard = lock_pdfium();
        let lib = require_pdfium();
        let thread = PdfRenderThread::new(&lib).unwrap();
        thread.open(fixture_path("sample.pdf").to_str().unwrap()).unwrap();

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
        thread.open(fixture_path("sample.pdf").to_str().unwrap()).unwrap();
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
        thread.open(fixture_path("sample.pdf").to_str().unwrap()).unwrap();
        thread.close().unwrap();
    }

    #[test]
    #[ignore]
    fn test_render_after_close_returns_error() {
        let _guard = lock_pdfium();
        let lib = require_pdfium();
        let thread = PdfRenderThread::new(&lib).unwrap();
        thread.open(fixture_path("sample.pdf").to_str().unwrap()).unwrap();
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
        let result = thread.open("/nonexistent/fake.pdf");
        assert!(result.is_err());
    }

    #[test]
    #[ignore]
    fn test_open_replaces_previous_document() {
        let _guard = lock_pdfium();
        let lib = require_pdfium();
        let thread = PdfRenderThread::new(&lib).unwrap();
        let path = fixture_path("sample.pdf").to_str().unwrap().to_string();
        let info1 = thread.open(&path).unwrap();
        let info2 = thread.open(&path).unwrap();
        assert_eq!(info1.page_count, info2.page_count);
    }

    #[test]
    #[ignore]
    fn test_render_page_with_dpi() {
        let _guard = lock_pdfium();
        let lib = require_pdfium();
        let thread = PdfRenderThread::new(&lib).unwrap();
        thread.open(fixture_path("sample.pdf").to_str().unwrap()).unwrap();

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
        thread.open(fixture_path("sample.pdf").to_str().unwrap()).unwrap();

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
        thread.open(fixture_path("sample.pdf").to_str().unwrap()).unwrap();

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
        thread.open(&pdf).unwrap();

        let r1 = thread.render_page(0, 144).unwrap();
        let mtime1 = fs::metadata(&r1.png_path).unwrap().modified().unwrap();

        std::thread::sleep(std::time::Duration::from_millis(50));

        thread.open(&pdf).unwrap();
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
        thread.open(fixture_path("sample.pdf").to_str().unwrap()).unwrap();

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
        thread.open(fixture_path("sample.pdf").to_str().unwrap()).unwrap();

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
    fn test_precache_all_command_variant_exists() {
        let (tx, _rx) = mpsc::channel::<(usize, usize)>();
        let _cmd = PdfCommand::PreCacheAll {
            dpi: 144,
            start_page: 0,
            cancel: Arc::new(AtomicBool::new(false)),
            progress_tx: tx,
        };
    }

    #[test]
    #[ignore]
    fn test_precache_all_caches_all_pages() {
        let _guard = lock_pdfium();
        let lib = require_pdfium();
        let thread = PdfRenderThread::new(&lib).unwrap();
        thread.open(fixture_path("sample.pdf").to_str().unwrap()).unwrap();

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
    fn test_precache_all_emits_final_progress() {
        let _guard = lock_pdfium();
        let lib = require_pdfium();
        let thread = PdfRenderThread::new(&lib).unwrap();
        thread.open(fixture_path("sample.pdf").to_str().unwrap()).unwrap();

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
    fn test_precache_all_skips_already_cached() {
        let _guard = lock_pdfium();
        let lib = require_pdfium();
        let thread = PdfRenderThread::new(&lib).unwrap();
        thread.open(fixture_path("sample.pdf").to_str().unwrap()).unwrap();

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
        thread.open(fixture_path("sample.pdf").to_str().unwrap()).unwrap();

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
        thread.open(fixture_path("sample.pdf").to_str().unwrap()).unwrap();

        let cancel = Arc::new(AtomicBool::new(true));
        let (tx, rx) = mpsc::channel::<(usize, usize)>();
        thread.precache_all(144, 0, cancel, tx).unwrap();

        // Drain progress; the only message should be the final completion send.
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
        thread.open(fixture_path("sample.pdf").to_str().unwrap()).unwrap();

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
        thread.open(fixture_path("sample.pdf").to_str().unwrap()).unwrap();

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
        thread.open(fixture_path("sample.pdf").to_str().unwrap()).unwrap();

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
            thread.open(fixture_path("sample.pdf").to_str().unwrap()).unwrap();
            assert!(temp_dir.exists());
        }
        assert!(!temp_dir.exists(), "temp dir should be cleaned up on drop");
        let thread2 = PdfRenderThread::new(&lib).unwrap();
        let info = thread2.open(fixture_path("sample.pdf").to_str().unwrap()).unwrap();
        assert_eq!(info.page_count, 2);
    }

    #[test]
    #[ignore]
    fn test_close_then_reopen_works() {
        let _guard = lock_pdfium();
        let lib = require_pdfium();
        let thread = PdfRenderThread::new(&lib).unwrap();
        thread.open(fixture_path("sample.pdf").to_str().unwrap()).unwrap();
        thread.close().unwrap();
        let info = thread.open(fixture_path("sample.pdf").to_str().unwrap()).unwrap();
        assert_eq!(info.page_count, 2);
    }

    #[test]
    #[ignore]
    fn test_sequential_create_drop_does_not_crash() {
        let _guard = lock_pdfium();
        let lib = require_pdfium();
        for _ in 0..5 {
            let thread = PdfRenderThread::new(&lib).unwrap();
            thread.open(fixture_path("sample.pdf").to_str().unwrap()).unwrap();
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
