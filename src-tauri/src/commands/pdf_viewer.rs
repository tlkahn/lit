use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;

use tauri::Manager;

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
        if let Some(old) = threads.remove(label) {
            let _ = old.close();
        }
        let thread = PdfRenderThread::new(&self.lib_path)?;
        let info = thread.open(path)?;
        threads.insert(label.to_string(), thread);
        Ok(info)
    }

    pub fn render_for_window(
        &self,
        label: &str,
        page_index: usize,
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

    pub fn prefetch_for_window(
        &self,
        label: &str,
        page_index: usize,
        dpi: u32,
    ) -> Result<(), String> {
        let threads = self.threads.lock().unwrap();
        if let Some(thread) = threads.get(label) {
            thread.prefetch(page_index, dpi)?;
        }
        Ok(())
    }

    pub fn temp_dir_for_window(&self, label: &str) -> Option<PathBuf> {
        let threads = self.threads.lock().unwrap();
        threads.get(label).map(|t| t.temp_dir().to_path_buf())
    }
}

#[tauri::command]
pub fn pdf_open(
    path: String,
    window: tauri::Window,
    state: tauri::State<'_, PdfViewerState>,
) -> Result<PdfInfo, String> {
    let info = state.open_for_window(window.label(), &path)?;

    if let Some(temp_dir) = state.temp_dir_for_window(window.label()) {
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
    window: tauri::Window,
    state: tauri::State<'_, PdfViewerState>,
) -> Result<RenderedPage, String> {
    state.render_for_window(window.label(), page_index, dpi)
}

#[tauri::command]
pub fn pdf_prefetch(
    page_index: usize,
    dpi: u32,
    window: tauri::Window,
    state: tauri::State<'_, PdfViewerState>,
) -> Result<(), String> {
    state.prefetch_for_window(window.label(), page_index, dpi)
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
