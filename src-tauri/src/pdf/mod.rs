use image::ImageEncoder;
use std::collections::HashMap;
use std::fs;
use std::io::BufWriter;
use std::path::PathBuf;
use std::sync::mpsc;
use std::thread;

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub struct PdfInfo {
    pub page_count: i32,
    pub path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub struct RenderedPage {
    pub page_index: i32,
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
        page_index: i32,
        dpi: u32,
        reply: mpsc::Sender<Result<RenderedPage, String>>,
    },
    Close {
        reply: mpsc::Sender<Result<(), String>>,
    },
    PreRender {
        page_index: i32,
        dpi: u32,
    },
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
    temp_dir: PathBuf,
}

impl PdfRenderThread {
    pub fn new(lib_path: &str) -> Result<Self, String> {
        let lib_path = lib_path.to_string();
        let (cmd_tx, cmd_rx) = mpsc::channel::<PdfCommand>();
        let (ready_tx, ready_rx) = mpsc::channel::<Result<(), String>>();
        let temp_dir = create_pdf_temp_dir()?;
        let thread_temp_dir = temp_dir.clone();

        thread::spawn(move || {
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
            let mut cache: HashMap<(i32, u32), RenderedPage> = HashMap::new();

            let render_page = |doc: &lmpdf::Document,
                               page_index: i32,
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
                }
            }
        });

        ready_rx
            .recv()
            .map_err(|_| "Render thread died during init".to_string())??;

        Ok(Self { cmd_tx, temp_dir })
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

    pub fn render_page(&self, page_index: i32, dpi: u32) -> Result<RenderedPage, String> {
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

    pub fn prefetch(&self, page_index: i32, dpi: u32) -> Result<(), String> {
        self.cmd_tx
            .send(PdfCommand::PreRender { page_index, dpi })
            .map_err(|_| "Render thread died".to_string())
    }

    pub fn temp_dir(&self) -> &std::path::Path {
        &self.temp_dir
    }
}

pub fn find_libpdfium() -> Option<PathBuf> {
    if let Ok(p) = std::env::var("PDFIUM_LIB_PATH") {
        let path = PathBuf::from(&p);
        if path.exists() {
            return Some(path);
        }
    }

    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let lib_path = manifest_dir.join("libs").join("libpdfium.dylib");
    if lib_path.exists() {
        return Some(lib_path);
    }

    None
}

pub fn find_libpdfium_or_default() -> String {
    find_libpdfium()
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
        find_libpdfium()
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
        let lib = require_pdfium();
        let thread = PdfRenderThread::new(&lib).unwrap();
        let info = thread.open(fixture_path("sample.pdf").to_str().unwrap()).unwrap();
        assert_eq!(info.page_count, 2);
        assert!(info.path.ends_with("sample.pdf"));
    }

    #[test]
    #[ignore]
    fn test_render_page_writes_png_file() {
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
        let lib = require_pdfium();
        let thread = PdfRenderThread::new(&lib).unwrap();
        thread.open(fixture_path("sample.pdf").to_str().unwrap()).unwrap();
        thread.close().unwrap();
    }

    #[test]
    #[ignore]
    fn test_render_after_close_returns_error() {
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
        let lib = require_pdfium();
        let thread = PdfRenderThread::new(&lib).unwrap();
        let result = thread.open("/nonexistent/fake.pdf");
        assert!(result.is_err());
    }

    #[test]
    #[ignore]
    fn test_open_replaces_previous_document() {
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
        let lib = require_pdfium();
        let thread = PdfRenderThread::new(&lib).unwrap();
        let result = thread.prefetch(0, 144);
        assert!(result.is_ok());
    }

    #[test]
    #[ignore]
    fn test_prefetch_populates_cache_for_subsequent_render() {
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
}
