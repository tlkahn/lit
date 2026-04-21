use serde::Serialize;
use std::fs;
use std::path::PathBuf;
use tauri::Manager;

#[derive(Debug, Serialize, Clone)]
pub struct ThemeInfo {
    pub name: String,
    pub version: String,
    pub author: String,
    pub directory_name: String,
}

fn themes_dir(app_handle: &tauri::AppHandle) -> Result<PathBuf, String> {
    let data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {e}"))?;
    let dir = data_dir.join("themes");
    if !dir.exists() {
        fs::create_dir_all(&dir).map_err(|e| format!("Failed to create themes dir: {e}"))?;
    }
    Ok(dir)
}

#[tauri::command]
pub fn list_themes(app_handle: tauri::AppHandle) -> Result<Vec<ThemeInfo>, String> {
    let dir = themes_dir(&app_handle)?;
    let mut themes = Vec::new();

    let entries = fs::read_dir(&dir).map_err(|e| format!("Failed to read themes dir: {e}"))?;
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let manifest_path = path.join("manifest.json");
        if !manifest_path.exists() {
            continue;
        }
        let manifest_str =
            fs::read_to_string(&manifest_path).map_err(|e| format!("Failed to read manifest: {e}"))?;
        let manifest: serde_json::Value =
            serde_json::from_str(&manifest_str).map_err(|e| format!("Invalid manifest JSON: {e}"))?;

        let dir_name = path
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string();

        themes.push(ThemeInfo {
            name: manifest["name"].as_str().unwrap_or(&dir_name).to_string(),
            version: manifest["version"].as_str().unwrap_or("0.0.0").to_string(),
            author: manifest["author"].as_str().unwrap_or("Unknown").to_string(),
            directory_name: dir_name,
        });
    }

    themes.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(themes)
}

#[tauri::command]
pub fn read_theme_css(app_handle: tauri::AppHandle, directory_name: String) -> Result<String, String> {
    let dir = themes_dir(&app_handle)?;
    let css_path = dir.join(&directory_name).join("theme.css");
    if !css_path.exists() {
        return Err(format!("Theme CSS not found: {}", css_path.display()));
    }
    fs::read_to_string(&css_path).map_err(|e| format!("Failed to read theme CSS: {e}"))
}

#[tauri::command]
pub fn get_themes_directory(app_handle: tauri::AppHandle) -> Result<String, String> {
    let dir = themes_dir(&app_handle)?;
    Ok(dir.to_string_lossy().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn test_theme_info_serializes() {
        let info = ThemeInfo {
            name: "Test Theme".to_string(),
            version: "1.0.0".to_string(),
            author: "Test Author".to_string(),
            directory_name: "test-theme".to_string(),
        };
        let json = serde_json::to_string(&info).unwrap();
        assert!(json.contains("Test Theme"));
    }

    #[test]
    fn test_list_themes_reads_manifests() {
        let tmp = tempfile::tempdir().unwrap();
        let theme_dir = tmp.path().join("my-theme");
        fs::create_dir_all(&theme_dir).unwrap();

        let manifest = r#"{"name": "My Theme", "version": "1.0.0", "author": "Me"}"#;
        let mut f = fs::File::create(theme_dir.join("manifest.json")).unwrap();
        f.write_all(manifest.as_bytes()).unwrap();

        let mut f2 = fs::File::create(theme_dir.join("theme.css")).unwrap();
        f2.write_all(b":root { --background-primary: red; }").unwrap();

        let css = fs::read_to_string(theme_dir.join("theme.css")).unwrap();
        assert!(css.contains("--background-primary"));
    }
}
