use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::Manager;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct KeyBinding {
    pub key: String,
    pub command: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub when: Option<String>,
}

pub fn merge_keymaps(defaults: &[KeyBinding], user: &[KeyBinding]) -> Vec<KeyBinding> {
    let mut result: Vec<KeyBinding> = defaults
        .iter()
        .map(|d| {
            user.iter()
                .find(|u| u.command == d.command)
                .cloned()
                .unwrap_or_else(|| d.clone())
        })
        .collect();

    for u in user {
        if !defaults.iter().any(|d| d.command == u.command) {
            result.push(u.clone());
        }
    }

    result
}

fn keymaps_dir(app_handle: &tauri::AppHandle) -> Result<PathBuf, String> {
    let data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {e}"))?;
    let dir = data_dir.join("keymaps");
    if !dir.exists() {
        fs::create_dir_all(&dir).map_err(|e| format!("Failed to create keymaps dir: {e}"))?;
    }
    Ok(dir)
}

fn read_keymaps_file(path: &Path) -> Vec<KeyBinding> {
    let content = match fs::read_to_string(path) {
        Ok(c) => c,
        Err(_) => return Vec::new(),
    };
    serde_json::from_str(&content).unwrap_or_default()
}

pub fn seed_default_keymaps(app_handle: &tauri::AppHandle) {
    let resource_dir = match app_handle.path().resource_dir() {
        Ok(d) => d,
        Err(_) => return,
    };
    let bundled = resource_dir.join("bundled-keymaps").join("default.json");
    if !bundled.exists() {
        return;
    }
    let dir = match keymaps_dir(app_handle) {
        Ok(d) => d,
        Err(_) => return,
    };
    let dest = dir.join("default.json");
    if dest.exists() {
        return;
    }
    let _ = fs::copy(&bundled, &dest);
}

#[tauri::command]
pub fn get_keymaps(app_handle: tauri::AppHandle) -> Result<Vec<KeyBinding>, String> {
    let dir = keymaps_dir(&app_handle)?;
    let defaults = read_keymaps_file(&dir.join("default.json"));
    let user = read_keymaps_file(&dir.join("user.json"));
    Ok(merge_keymaps(&defaults, &user))
}

#[tauri::command]
pub fn get_default_keymaps(app_handle: tauri::AppHandle) -> Result<Vec<KeyBinding>, String> {
    let dir = keymaps_dir(&app_handle)?;
    Ok(read_keymaps_file(&dir.join("default.json")))
}

#[tauri::command]
pub fn get_user_keymaps_path(app_handle: tauri::AppHandle) -> Result<String, String> {
    let dir = keymaps_dir(&app_handle)?;
    Ok(dir.join("user.json").to_string_lossy().to_string())
}

#[tauri::command]
pub fn save_user_keymaps(
    app_handle: tauri::AppHandle,
    bindings: Vec<KeyBinding>,
) -> Result<(), String> {
    let dir = keymaps_dir(&app_handle)?;
    let json =
        serde_json::to_string_pretty(&bindings).map_err(|e| format!("Failed to serialize: {e}"))?;
    fs::write(dir.join("user.json"), json).map_err(|e| format!("Failed to write: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn kb(key: &str, command: &str, when: Option<&str>) -> KeyBinding {
        KeyBinding {
            key: key.to_string(),
            command: command.to_string(),
            when: when.map(|s| s.to_string()),
        }
    }

    #[test]
    fn test_keybinding_deserialize() {
        let json = r#"{"key":"Mod-b","command":"editor.toggleBold","when":"editorFocus"}"#;
        let binding: KeyBinding = serde_json::from_str(json).unwrap();
        assert_eq!(binding.key, "Mod-b");
        assert_eq!(binding.command, "editor.toggleBold");
        assert_eq!(binding.when, Some("editorFocus".to_string()));
    }

    #[test]
    fn test_keybinding_serialize() {
        let binding = kb("Mod-b", "editor.toggleBold", Some("editorFocus"));
        let json = serde_json::to_string(&binding).unwrap();
        let roundtrip: KeyBinding = serde_json::from_str(&json).unwrap();
        assert_eq!(binding, roundtrip);
    }

    #[test]
    fn test_keybinding_without_when_skips_field() {
        let binding = kb("Mod-b", "editor.toggleBold", None);
        let json = serde_json::to_string(&binding).unwrap();
        assert!(!json.contains("when"));
    }

    #[test]
    fn test_keybinding_with_when() {
        let json = r#"{"key":"Mod-b","command":"editor.toggleBold","when":"editorFocus"}"#;
        let binding: KeyBinding = serde_json::from_str(json).unwrap();
        assert_eq!(binding.when, Some("editorFocus".to_string()));
    }

    #[test]
    fn test_merge_user_overrides_default() {
        let defaults = vec![kb("Mod-b", "editor.toggleBold", Some("editorFocus"))];
        let user = vec![kb("Mod-Shift-b", "editor.toggleBold", Some("editorFocus"))];
        let merged = merge_keymaps(&defaults, &user);
        assert_eq!(merged.len(), 1);
        assert_eq!(merged[0].key, "Mod-Shift-b");
    }

    #[test]
    fn test_merge_preserves_unoverridden() {
        let defaults = vec![
            kb("Mod-b", "editor.toggleBold", Some("editorFocus")),
            kb("Mod-i", "editor.toggleItalic", Some("editorFocus")),
        ];
        let user = vec![kb("Mod-Shift-b", "editor.toggleBold", Some("editorFocus"))];
        let merged = merge_keymaps(&defaults, &user);
        assert_eq!(merged.len(), 2);
        assert_eq!(merged[0].key, "Mod-Shift-b");
        assert_eq!(merged[1].key, "Mod-i");
    }

    #[test]
    fn test_merge_user_adds_new_binding() {
        let defaults = vec![kb("Mod-b", "editor.toggleBold", Some("editorFocus"))];
        let user = vec![kb("Mod-Shift-n", "app.newPage", None)];
        let merged = merge_keymaps(&defaults, &user);
        assert_eq!(merged.len(), 2);
        assert_eq!(merged[1].command, "app.newPage");
    }

    #[test]
    fn test_merge_empty_user() {
        let defaults = vec![
            kb("Mod-b", "editor.toggleBold", Some("editorFocus")),
            kb("Mod-i", "editor.toggleItalic", Some("editorFocus")),
        ];
        let merged = merge_keymaps(&defaults, &[]);
        assert_eq!(merged, defaults);
    }

    #[test]
    fn test_read_keymaps_from_file() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("keymaps.json");
        let bindings = vec![kb("Mod-b", "editor.toggleBold", Some("editorFocus"))];
        let json = serde_json::to_string_pretty(&bindings).unwrap();
        fs::write(&path, &json).unwrap();

        let read = read_keymaps_file(&path);
        assert_eq!(read, bindings);
    }

    #[test]
    fn test_read_keymaps_missing_file() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("nonexistent.json");
        let read = read_keymaps_file(&path);
        assert!(read.is_empty());
    }

    #[test]
    fn test_write_and_read_back() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("user.json");
        let bindings = vec![
            kb("Mod-Shift-b", "editor.toggleBold", Some("editorFocus")),
            kb("Mod-p", "app.commandPalette", None),
        ];
        let json = serde_json::to_string_pretty(&bindings).unwrap();
        fs::write(&path, &json).unwrap();

        let read = read_keymaps_file(&path);
        assert_eq!(read, bindings);
    }
}
