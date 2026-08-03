use std::path::Path;

pub(crate) fn do_export_cardbox_html(dest: &Path, html: &str) -> Result<String, String> {
    std::fs::write(dest, html).map_err(|e| format!("Failed to write HTML: {e}"))?;
    Ok(dest.display().to_string())
}

#[tauri::command]
pub async fn export_cardbox_html(
    destination: String,
    html: String,
) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        do_export_cardbox_html(Path::new(&destination), &html)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn c1_happy_path_write_and_readback() {
        let dir = tempfile::tempdir().unwrap();
        let dest = dir.path().join("cards.html");
        let html = "<!DOCTYPE html><html><body>hello</body></html>";
        let result = do_export_cardbox_html(&dest, html);
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), dest.display().to_string());
        let readback = std::fs::read_to_string(&dest).unwrap();
        assert_eq!(readback, html);
    }

    #[test]
    fn c2_overwrite_replaces_existing() {
        let dir = tempfile::tempdir().unwrap();
        let dest = dir.path().join("cards.html");
        std::fs::write(&dest, "old content").unwrap();
        let html = "new content";
        do_export_cardbox_html(&dest, html).unwrap();
        let readback = std::fs::read_to_string(&dest).unwrap();
        assert_eq!(readback, "new content");
    }

    #[test]
    fn c3_missing_parent_dir_returns_err() {
        let dir = tempfile::tempdir().unwrap();
        let dest = dir.path().join("nonexistent").join("cards.html");
        let result = do_export_cardbox_html(&dest, "html");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Failed to write HTML"));
        assert!(!dest.exists());
    }

    #[test]
    fn c4_utf8_and_large_payload_roundtrip() {
        let dir = tempfile::tempdir().unwrap();
        let dest = dir.path().join("cards.html");

        let utf8_html = "hello - 数学 𝔸";
        do_export_cardbox_html(&dest, utf8_html).unwrap();
        assert_eq!(std::fs::read(&dest).unwrap(), utf8_html.as_bytes());

        let large = "x".repeat(2_000_000);
        do_export_cardbox_html(&dest, &large).unwrap();
        assert_eq!(std::fs::read(&dest).unwrap(), large.as_bytes());
    }
}
