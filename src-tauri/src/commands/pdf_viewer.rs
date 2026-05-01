use std::collections::HashMap;
use std::sync::Mutex;

use crate::pdf::{PdfInfo, PdfRenderThread, RenderedPage};

pub struct PdfViewerState {
    threads: Mutex<HashMap<String, PdfRenderThread>>,
    lib_path: String,
}

impl PdfViewerState {
    pub fn new(lib_path: &str) -> Self {
        Self {
            threads: Mutex::new(HashMap::new()),
            lib_path: lib_path.to_string(),
        }
    }

    pub fn open_for_window(&self, label: &str, path: &str) -> Result<PdfInfo, String> {
        let mut threads = self.threads.lock().unwrap();
        threads.remove(label);
        let thread = PdfRenderThread::new(&self.lib_path)?;
        let info = thread.open(path)?;
        threads.insert(label.to_string(), thread);
        Ok(info)
    }

    pub fn render_for_window(
        &self,
        label: &str,
        page_index: i32,
        dpi: u32,
    ) -> Result<RenderedPage, String> {
        let threads = self.threads.lock().unwrap();
        let thread = threads
            .get(label)
            .ok_or_else(|| "No PDF open in this window".to_string())?;
        thread.render_page(page_index, dpi)
    }

    pub fn close_for_window(&self, label: &str) -> Result<(), String> {
        let mut threads = self.threads.lock().unwrap();
        if let Some(thread) = threads.remove(label) {
            thread.close()?;
        }
        Ok(())
    }
}

#[tauri::command]
pub fn pdf_open(
    path: String,
    window: tauri::Window,
    state: tauri::State<'_, PdfViewerState>,
) -> Result<PdfInfo, String> {
    state.open_for_window(window.label(), &path)
}

#[tauri::command]
pub fn pdf_render_page(
    page_index: i32,
    dpi: u32,
    window: tauri::Window,
    state: tauri::State<'_, PdfViewerState>,
) -> Result<RenderedPage, String> {
    state.render_for_window(window.label(), page_index, dpi)
}

#[tauri::command]
pub fn pdf_close(
    window: tauri::Window,
    state: tauri::State<'_, PdfViewerState>,
) -> Result<(), String> {
    state.close_for_window(window.label())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pdf::find_libpdfium;
    use std::path::PathBuf;

    fn fixture_path(name: &str) -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("tests")
            .join("fixtures")
            .join(name)
    }

    fn require_pdfium() -> String {
        find_libpdfium()
            .map(|p| p.to_string_lossy().to_string())
            .expect("libpdfium not found — run scripts/fetch-pdfium.sh")
    }

    #[test]
    #[ignore]
    fn test_open_creates_thread_and_returns_info() {
        let lib = require_pdfium();
        let state = PdfViewerState::new(&lib);
        let info = state
            .open_for_window("main", fixture_path("sample.pdf").to_str().unwrap())
            .unwrap();
        assert_eq!(info.page_count, 2);
    }

    #[test]
    #[ignore]
    fn test_render_returns_data() {
        let lib = require_pdfium();
        let state = PdfViewerState::new(&lib);
        state
            .open_for_window("main", fixture_path("sample.pdf").to_str().unwrap())
            .unwrap();
        let rendered = state.render_for_window("main", 0, 144).unwrap();
        assert!(!rendered.png_base64.is_empty());
    }

    #[test]
    #[ignore]
    fn test_close_removes_thread() {
        let lib = require_pdfium();
        let state = PdfViewerState::new(&lib);
        state
            .open_for_window("main", fixture_path("sample.pdf").to_str().unwrap())
            .unwrap();
        state.close_for_window("main").unwrap();
        let result = state.render_for_window("main", 0, 144);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("No PDF open in this window"));
    }

    #[test]
    fn test_render_unknown_window_returns_error() {
        let state = PdfViewerState::new("dummy");
        let result = state.render_for_window("unknown", 0, 144);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("No PDF open in this window"));
    }
}
