use base64::Engine;
use image::ImageEncoder;
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
    pub png_base64: String,
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
        scale: f32,
        reply: mpsc::Sender<Result<RenderedPage, String>>,
    },
    Close {
        reply: mpsc::Sender<Result<(), String>>,
    },
}

pub struct PdfRenderThread {
    cmd_tx: mpsc::Sender<PdfCommand>,
}

impl PdfRenderThread {
    pub fn new(lib_path: &str) -> Result<Self, String> {
        let lib_path = lib_path.to_string();
        let (cmd_tx, cmd_rx) = mpsc::channel::<PdfCommand>();
        let (ready_tx, ready_rx) = mpsc::channel::<Result<(), String>>();

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
                                let _ = reply.send(Ok(info));
                            }
                            Err(e) => {
                                let _ = reply.send(Err(format!("Failed to open PDF: {e}")));
                            }
                        }
                    }
                    PdfCommand::RenderPage {
                        page_index,
                        scale,
                        reply,
                    } => {
                        let result = (|| -> Result<RenderedPage, String> {
                            let doc = document
                                .as_ref()
                                .ok_or_else(|| "No document open".to_string())?;
                            let page_ref = doc
                                .page(page_index)
                                .map_err(|e| format!("Failed to get page: {e}"))?;
                            let config = lmpdf::RenderConfig::new().scale(scale);
                            let bitmap = doc
                                .render_page(page_ref, &config)
                                .map_err(|e| format!("Failed to render page: {e}"))?;

                            let img = bitmap.to_image();
                            let width = img.width();
                            let height = img.height();

                            let mut png_buf = Vec::new();
                            image::codecs::png::PngEncoder::new(&mut png_buf)
                                .write_image(
                                    img.as_bytes(),
                                    width,
                                    height,
                                    img.color().into(),
                                )
                                .map_err(|e| format!("PNG encode failed: {e}"))?;

                            let png_base64 =
                                base64::engine::general_purpose::STANDARD.encode(&png_buf);

                            Ok(RenderedPage {
                                page_index,
                                png_base64,
                                width,
                                height,
                            })
                        })();
                        let _ = reply.send(result);
                    }
                    PdfCommand::Close { reply } => {
                        document = None;
                        let _ = reply.send(Ok(()));
                    }
                }
            }
        });

        ready_rx
            .recv()
            .map_err(|_| "Render thread died during init".to_string())??;

        Ok(Self { cmd_tx })
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

    pub fn render_page(&self, page_index: i32, scale: f32) -> Result<RenderedPage, String> {
        let (tx, rx) = mpsc::channel();
        self.cmd_tx
            .send(PdfCommand::RenderPage {
                page_index,
                scale,
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
    fn test_render_page_returns_png_data() {
        let lib = require_pdfium();
        let thread = PdfRenderThread::new(&lib).unwrap();
        thread.open(fixture_path("sample.pdf").to_str().unwrap()).unwrap();

        let rendered = thread.render_page(0, 1.0).unwrap();
        assert!(!rendered.png_base64.is_empty());
        assert!(rendered.width > 0);
        assert!(rendered.height > 0);
        assert_eq!(rendered.page_index, 0);

        let bytes = base64::engine::general_purpose::STANDARD
            .decode(&rendered.png_base64)
            .unwrap();
        assert_eq!(&bytes[..4], &[0x89, 0x50, 0x4E, 0x47]); // PNG magic
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

        let result = thread.render_page(0, 1.0);
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
    fn test_render_page_with_scale() {
        let lib = require_pdfium();
        let thread = PdfRenderThread::new(&lib).unwrap();
        thread.open(fixture_path("sample.pdf").to_str().unwrap()).unwrap();

        let r1 = thread.render_page(0, 1.0).unwrap();
        let r2 = thread.render_page(0, 2.0).unwrap();

        assert!(
            r2.width > r1.width || r2.height > r1.height,
            "2x scale should produce larger image: {}x{} vs {}x{}",
            r2.width, r2.height, r1.width, r1.height,
        );
    }
}
