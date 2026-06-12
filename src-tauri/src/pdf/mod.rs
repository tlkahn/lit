use image::ImageEncoder;
use std::collections::HashMap;
use std::fs;
use std::io::BufWriter;
use std::path::PathBuf;
use std::sync::mpsc;
use std::thread;

use serde::Serialize;

/// Maximum DPI the renderer will accept. Values above this are silently clamped
/// to prevent enormous bitmap allocations (e.g. 864 DPI on a Letter page = ~280 MB).
const MAX_DPI: u32 = 600;

fn clamp_dpi(dpi: u32) -> u32 {
    dpi.min(MAX_DPI)
}

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

#[derive(Debug, Clone, Serialize)]
pub struct PdfRecognizerData {
    pub pages: Vec<String>,
    pub total_pages: usize,
    pub info: HashMap<String, String>,
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
    ExtractRecognizerData {
        max_pages: usize,
        reply: mpsc::Sender<Result<PdfRecognizerData, String>>,
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

/// Maximum entries in the per-document render cache.  Evicted entries
/// have their temp PNG deleted from disk so the temp dir stays bounded.
const MAX_BACKEND_CACHE: usize = 24;

struct LruPngCache {
    map: HashMap<(usize, u32), RenderedPage>,
    order: Vec<(usize, u32)>,
    cap: usize,
}

impl LruPngCache {
    fn new(cap: usize) -> Self {
        Self {
            map: HashMap::new(),
            order: Vec::new(),
            cap,
        }
    }

    /// Look up a cached entry, promoting it to most-recently-used.
    fn get(&mut self, key: &(usize, u32)) -> Option<&RenderedPage> {
        if !self.map.contains_key(key) {
            return None;
        }
        // Move to back (most recent)
        if let Some(pos) = self.order.iter().position(|k| k == key) {
            self.order.remove(pos);
        }
        self.order.push(*key);
        self.map.get(key)
    }

    /// Insert an entry, evicting the oldest if at capacity.
    /// The evicted entry's PNG file is deleted from disk.
    fn insert(&mut self, key: (usize, u32), value: RenderedPage) {
        if self.map.contains_key(&key) {
            // Update existing: replace value, move to back
            self.map.insert(key, value);
            if let Some(pos) = self.order.iter().position(|k| k == &key) {
                self.order.remove(pos);
            }
            self.order.push(key);
            return;
        }
        // Evict oldest if at capacity
        if self.map.len() >= self.cap && self.cap > 0 {
            if let Some(oldest_key) = self.order.first().copied() {
                self.order.remove(0);
                if let Some(evicted) = self.map.remove(&oldest_key) {
                    if let Err(e) = fs::remove_file(&evicted.png_path) {
                        tracing::warn!(
                            "[pdf] failed to remove evicted PNG {}: {e}",
                            evicted.png_path
                        );
                    }
                }
            }
        }
        self.order.push(key);
        self.map.insert(key, value);
    }

    fn contains_key(&self, key: &(usize, u32)) -> bool {
        self.map.contains_key(key)
    }

    fn clear(&mut self) {
        self.map.clear();
        self.order.clear();
    }

    #[cfg(test)]
    fn len(&self) -> usize {
        self.map.len()
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
            let mut cache = LruPngCache::new(MAX_BACKEND_CACHE);

            let render_page = |doc: &lmpdf::Document,
                               page_index: usize,
                               dpi: u32,
                               temp_dir: &std::path::Path|
             -> Result<RenderedPage, String> {
                let dpi = clamp_dpi(dpi);
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
                    PdfCommand::ExtractRecognizerData { max_pages, reply } => {
                        // TODO(#444): runs synchronously on the render thread — will need chunking for recognition-on-open
                        let result = (|| -> Result<PdfRecognizerData, String> {
                            let doc = document
                                .as_ref()
                                .ok_or_else(|| "No document open".to_string())?;
                            let total_pages = doc.page_count();
                            let extract_count = max_pages.min(total_pages);
                            let mut pages = Vec::with_capacity(extract_count);
                            for i in 0..extract_count {
                                let text = doc.page_text(i).unwrap_or_else(|e| {
                                    tracing::warn!("[pdf] page {i} text extraction failed: {e}");
                                    String::new()
                                });
                                pages.push(text);
                            }
                            let info = doc.info().unwrap_or_else(|e| {
                                tracing::warn!("[pdf] metadata extraction failed: {e}");
                                HashMap::new()
                            });
                            Ok(PdfRecognizerData {
                                pages,
                                total_pages,
                                info,
                            })
                        })();
                        let _ = reply.send(result);
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

    /// Send a command that carries a reply channel, wait for the response.
    /// Centralizes the channel send+recv error handling for all request-reply methods.
    fn request<T>(
        &self,
        make: impl FnOnce(mpsc::Sender<Result<T, String>>) -> PdfCommand,
    ) -> Result<T, String> {
        let (tx, rx) = mpsc::channel();
        self.cmd_tx
            .send(make(tx))
            .map_err(|_| "Render thread died".to_string())?;
        rx.recv()
            .map_err(|_| "Render thread died".to_string())?
    }

    pub fn open(&self, path: &str) -> Result<PdfInfo, String> {
        let path = path.to_string();
        self.request(|tx| PdfCommand::Open { path, reply: tx })
    }

    pub fn render_page(&self, page_index: usize, dpi: u32) -> Result<RenderedPage, String> {
        let dpi = clamp_dpi(dpi);
        self.request(|tx| PdfCommand::RenderPage {
            page_index,
            dpi,
            reply: tx,
        })
    }

    pub fn close(&self) -> Result<(), String> {
        self.request(|tx| PdfCommand::Close { reply: tx })
    }

    pub fn prefetch(&self, page_index: usize, dpi: u32) -> Result<(), String> {
        let dpi = clamp_dpi(dpi);
        self.cmd_tx
            .send(PdfCommand::PreRender { page_index, dpi })
            .map_err(|_| "Render thread died".to_string())
    }

    pub fn extract_recognizer_data(&self, max_pages: usize) -> Result<PdfRecognizerData, String> {
        self.request(|tx| PdfCommand::ExtractRecognizerData {
            max_pages,
            reply: tx,
        })
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

    #[test]
    #[ignore]
    fn test_extract_recognizer_data_born_digital() {
        let _guard = lock_pdfium();
        let lib = require_pdfium();
        let thread = PdfRenderThread::new(&lib).unwrap();
        thread.open(fixture_path("born_digital.pdf").to_str().unwrap()).unwrap();

        let data: PdfRecognizerData = thread.extract_recognizer_data(5).unwrap();

        // born_digital.pdf has 7 pages; we asked for max 5
        assert_eq!(data.pages.len(), 5);
        assert_eq!(data.total_pages, 7);
        // Each extracted page should have non-empty text
        for (i, page_text) in data.pages.iter().enumerate() {
            assert!(!page_text.trim().is_empty(), "page {} text should be non-empty", i);
        }
        // Page 0 must contain the known substring
        assert!(
            data.pages[0].contains("comprehensive survey of neural retrieval models"),
            "page 0 should contain known substring, got: {}",
            &data.pages[0][..data.pages[0].len().min(200)]
        );
        // Info dict should contain Title and Author
        assert_eq!(
            data.info.get("Title").map(|s| s.as_str()),
            Some("Advances in Neural Retrieval Models for Scholarly Document Processing")
        );
        assert_eq!(
            data.info.get("Author").map(|s| s.as_str()),
            Some("Dr. Elena Vasquez and Prof. Martin Chen")
        );
    }

    #[test]
    #[ignore]
    fn test_extract_recognizer_data_scanned_pdf() {
        let _guard = lock_pdfium();
        let lib = require_pdfium();
        let thread = PdfRenderThread::new(&lib).unwrap();
        thread.open(fixture_path("scanned.pdf").to_str().unwrap()).unwrap();

        let data: PdfRecognizerData = thread.extract_recognizer_data(5).unwrap();

        // scanned.pdf has 1 page, all image-only => empty/whitespace text
        assert_eq!(data.total_pages, 1);
        assert_eq!(data.pages.len(), 1);
        assert!(
            data.pages[0].trim().is_empty(),
            "scanned PDF page text should be empty or whitespace, got: {:?}",
            data.pages[0]
        );
    }

    #[test]
    #[ignore]
    fn test_extract_recognizer_data_short_pdf() {
        let _guard = lock_pdfium();
        let lib = require_pdfium();
        let thread = PdfRenderThread::new(&lib).unwrap();
        thread.open(fixture_path("short.pdf").to_str().unwrap()).unwrap();

        let data: PdfRecognizerData = thread.extract_recognizer_data(5).unwrap();

        // short.pdf has 1 page; asking for 5 should give just 1
        assert_eq!(data.total_pages, 1);
        assert_eq!(data.pages.len(), 1);
        // The single page should have some text
        assert!(!data.pages[0].trim().is_empty(), "short.pdf should have extractable text");
    }

    #[test]
    #[ignore]
    fn test_extract_recognizer_data_no_document() {
        let _guard = lock_pdfium();
        let lib = require_pdfium();
        let thread = PdfRenderThread::new(&lib).unwrap();
        // Do NOT open any document
        let result = thread.extract_recognizer_data(5);
        assert!(result.is_err());
        assert!(
            result.unwrap_err().contains("No document open"),
            "error should mention 'No document open'"
        );
    }

    #[test]
    #[ignore]
    fn test_extract_recognizer_data_respects_max_pages() {
        let _guard = lock_pdfium();
        let lib = require_pdfium();
        let thread = PdfRenderThread::new(&lib).unwrap();
        thread.open(fixture_path("born_digital.pdf").to_str().unwrap()).unwrap();

        let data: PdfRecognizerData = thread.extract_recognizer_data(2).unwrap();

        assert_eq!(data.pages.len(), 2, "should extract exactly max_pages pages");
        assert_eq!(data.total_pages, 7, "total_pages should reflect full document");
    }

    #[test]
    fn test_clamp_dpi_caps_at_max() {
        assert_eq!(clamp_dpi(864), MAX_DPI);
        assert_eq!(clamp_dpi(1000), MAX_DPI);
        assert_eq!(clamp_dpi(u32::MAX), MAX_DPI);
    }

    #[test]
    fn test_clamp_dpi_passes_through_below_max() {
        assert_eq!(clamp_dpi(144), 144);
        assert_eq!(clamp_dpi(288), 288);
        assert_eq!(clamp_dpi(MAX_DPI), MAX_DPI);
        assert_eq!(clamp_dpi(0), 0);
    }

    // --- LruPngCache tests (no pdfium needed) ---

    fn make_rendered(page_index: usize, png_path: &str) -> RenderedPage {
        RenderedPage {
            page_index,
            png_path: png_path.to_string(),
            width: 100,
            height: 100,
        }
    }

    fn write_temp_png(dir: &std::path::Path, name: &str) -> PathBuf {
        let p = dir.join(name);
        fs::write(&p, b"fakepng").unwrap();
        p
    }

    #[test]
    fn test_lru_cache_evicts_oldest_entry() {
        let dir = create_pdf_temp_dir().unwrap();
        let mut cache = LruPngCache::new(3);

        let p0 = write_temp_png(&dir, "p0.png");
        let p1 = write_temp_png(&dir, "p1.png");
        let p2 = write_temp_png(&dir, "p2.png");
        let p3 = write_temp_png(&dir, "p3.png");

        cache.insert((0, 72), make_rendered(0, p0.to_str().unwrap()));
        cache.insert((1, 72), make_rendered(1, p1.to_str().unwrap()));
        cache.insert((2, 72), make_rendered(2, p2.to_str().unwrap()));
        // This insert should evict (0, 72) and delete p0
        cache.insert((3, 72), make_rendered(3, p3.to_str().unwrap()));

        assert_eq!(cache.len(), 3);
        assert!(!cache.contains_key(&(0, 72)), "oldest entry should be evicted");
        assert!(!p0.exists(), "evicted entry's PNG should be deleted from disk");
        assert!(p1.exists());
        assert!(p2.exists());
        assert!(p3.exists());

        cleanup_pdf_temp_dir(&dir);
    }

    #[test]
    fn test_lru_cache_get_refreshes_order() {
        let dir = create_pdf_temp_dir().unwrap();
        let mut cache = LruPngCache::new(3);

        let pa = write_temp_png(&dir, "a.png");
        let pb = write_temp_png(&dir, "b.png");
        let pc = write_temp_png(&dir, "c.png");
        let pd = write_temp_png(&dir, "d.png");

        cache.insert((0, 72), make_rendered(0, pa.to_str().unwrap()));
        cache.insert((1, 72), make_rendered(1, pb.to_str().unwrap()));
        cache.insert((2, 72), make_rendered(2, pc.to_str().unwrap()));

        // Access A to refresh it — B is now oldest
        let got = cache.get(&(0, 72));
        assert!(got.is_some(), "get should find existing entry");

        // Insert D — should evict B (oldest), not A
        cache.insert((3, 72), make_rendered(3, pd.to_str().unwrap()));

        assert!(!cache.contains_key(&(1, 72)), "B should be evicted");
        assert!(!pb.exists(), "B's PNG should be deleted");
        assert!(pa.exists(), "A should still exist (refreshed)");
        assert!(pc.exists());
        assert!(pd.exists());

        cleanup_pdf_temp_dir(&dir);
    }

    #[test]
    fn test_lru_cache_insert_existing_key_updates_and_refreshes() {
        let dir = create_pdf_temp_dir().unwrap();
        let mut cache = LruPngCache::new(3);

        let pa = write_temp_png(&dir, "a.png");
        let pb = write_temp_png(&dir, "b.png");
        let pc = write_temp_png(&dir, "c.png");
        let pd = write_temp_png(&dir, "d.png");

        cache.insert((0, 72), make_rendered(0, pa.to_str().unwrap()));
        cache.insert((1, 72), make_rendered(1, pb.to_str().unwrap()));
        cache.insert((2, 72), make_rendered(2, pc.to_str().unwrap()));

        // Re-insert A with a new path — refreshes A, B is now oldest
        let pa2 = write_temp_png(&dir, "a2.png");
        cache.insert((0, 72), make_rendered(0, pa2.to_str().unwrap()));

        // Insert D — should evict B (oldest after A was refreshed)
        cache.insert((3, 72), make_rendered(3, pd.to_str().unwrap()));

        assert_eq!(cache.len(), 3);
        assert!(!cache.contains_key(&(1, 72)), "B should be evicted");
        assert!(cache.contains_key(&(0, 72)), "A should still exist");
        assert!(cache.contains_key(&(2, 72)), "C should still exist");
        assert!(cache.contains_key(&(3, 72)), "D should still exist");

        cleanup_pdf_temp_dir(&dir);
    }

    #[test]
    fn test_lru_cache_clear_does_not_delete_files() {
        let dir = create_pdf_temp_dir().unwrap();
        let mut cache = LruPngCache::new(3);

        let pa = write_temp_png(&dir, "a.png");
        let pb = write_temp_png(&dir, "b.png");

        cache.insert((0, 72), make_rendered(0, pa.to_str().unwrap()));
        cache.insert((1, 72), make_rendered(1, pb.to_str().unwrap()));

        cache.clear();

        assert_eq!(cache.len(), 0);
        assert!(pa.exists(), "clear should NOT delete files — caller handles cleanup");
        assert!(pb.exists(), "clear should NOT delete files — caller handles cleanup");

        cleanup_pdf_temp_dir(&dir);
    }

    #[test]
    fn test_lru_cache_eviction_tolerates_missing_file() {
        let mut cache = LruPngCache::new(1);

        // Insert with a non-existent path
        cache.insert(
            (0, 72),
            make_rendered(0, "/tmp/lit_nonexistent_xyz_42.png"),
        );
        // This insert triggers eviction of the previous entry whose file doesn't exist
        let dir = create_pdf_temp_dir().unwrap();
        let p1 = write_temp_png(&dir, "real.png");
        cache.insert((1, 72), make_rendered(1, p1.to_str().unwrap()));

        assert_eq!(cache.len(), 1);
        assert!(!cache.contains_key(&(0, 72)));
        assert!(cache.contains_key(&(1, 72)));

        cleanup_pdf_temp_dir(&dir);
    }
}
