use crate::seed::SeedState;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tauri::{Manager, State};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum KeyBindingSource {
    Default,
    User,
    Menu,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct KeyBinding {
    pub key: String,
    pub command: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub when: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<KeyBindingSource>,
}

pub fn annotate_sources(
    merged: &[KeyBinding],
    _defaults: &[KeyBinding],
    user: &[KeyBinding],
) -> Vec<KeyBinding> {
    merged
        .iter()
        .map(|b| {
            let source = if user.iter().any(|u| u.command == b.command) {
                KeyBindingSource::User
            } else {
                KeyBindingSource::Default
            };
            KeyBinding {
                source: Some(source),
                ..b.clone()
            }
        })
        .collect()
}

pub fn convert_accelerator(accel: &str) -> String {
    accel
        .split('+')
        .map(|token| match token.to_lowercase().as_str() {
            "cmdorctrl" => "Mod".to_string(),
            "shift" => "Shift".to_string(),
            "alt" => "Alt".to_string(),
            "ctrl" => "Ctrl".to_string(),
            _ => token.to_string(),
        })
        .collect::<Vec<_>>()
        .join("-")
}

pub fn get_menu_shortcut_bindings() -> Vec<KeyBinding> {
    use crate::menu::MENU_SHORTCUTS;
    MENU_SHORTCUTS
        .iter()
        .map(|def| KeyBinding {
            key: convert_accelerator(def.accelerator),
            command: def.command_id.to_string(),
            when: None,
            source: Some(KeyBindingSource::Menu),
        })
        .collect()
}

#[tauri::command]
pub fn get_menu_shortcuts() -> Vec<KeyBinding> {
    get_menu_shortcut_bindings()
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
        let bundled_content = fs::read(&bundled).unwrap_or_default();
        let dest_content = fs::read(&dest).unwrap_or_default();
        if bundled_content == dest_content {
            return;
        }
    }
    let _ = fs::copy(&bundled, &dest);
}

#[tauri::command]
pub fn get_keymaps(
    app_handle: tauri::AppHandle,
    seed_state: State<'_, Arc<SeedState>>,
) -> Result<Vec<KeyBinding>, String> {
    seed_state.wait_ready();
    let dir = keymaps_dir(&app_handle)?;
    let defaults = read_keymaps_file(&dir.join("default.json"));
    let user = read_keymaps_file(&dir.join("user.json"));
    let merged = merge_keymaps(&defaults, &user);
    Ok(annotate_sources(&merged, &defaults, &user))
}

#[tauri::command]
pub fn get_default_keymaps(
    app_handle: tauri::AppHandle,
    seed_state: State<'_, Arc<SeedState>>,
) -> Result<Vec<KeyBinding>, String> {
    seed_state.wait_ready();
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
    let clean: Vec<KeyBinding> = bindings
        .iter()
        .map(|b| KeyBinding {
            source: None,
            ..b.clone()
        })
        .collect();
    let json =
        serde_json::to_string_pretty(&clean).map_err(|e| format!("Failed to serialize: {e}"))?;
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
            source: None,
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

    // --- Cycle 1: source field serialization ---

    #[test]
    fn test_keybinding_with_source_serializes() {
        let binding = KeyBinding {
            source: Some(KeyBindingSource::Default),
            ..kb("Mod-b", "editor.toggleBold", None)
        };
        let json = serde_json::to_string(&binding).unwrap();
        assert!(json.contains(r#""source":"default""#));
    }

    #[test]
    fn test_keybinding_without_source_skips_field() {
        let binding = kb("Mod-b", "editor.toggleBold", None);
        let json = serde_json::to_string(&binding).unwrap();
        assert!(!json.contains("source"));
    }

    #[test]
    fn test_keybinding_deserialize_without_source_field() {
        let json = r#"{"key":"Mod-b","command":"editor.toggleBold"}"#;
        let binding: KeyBinding = serde_json::from_str(json).unwrap();
        assert_eq!(binding.source, None);
    }

    #[test]
    fn test_keybinding_deserialize_with_source_field() {
        let json = r#"{"key":"Mod-b","command":"editor.toggleBold","source":"user"}"#;
        let binding: KeyBinding = serde_json::from_str(json).unwrap();
        assert_eq!(binding.source, Some(KeyBindingSource::User));
    }

    // --- Cycle 2: annotate_sources ---

    #[test]
    fn test_annotate_sources_tags_defaults() {
        let defaults = vec![kb("Mod-b", "editor.toggleBold", None)];
        let user: Vec<KeyBinding> = vec![];
        let merged = merge_keymaps(&defaults, &user);
        let annotated = annotate_sources(&merged, &defaults, &user);
        assert_eq!(annotated[0].source, Some(KeyBindingSource::Default));
    }

    #[test]
    fn test_annotate_sources_tags_user_override() {
        let defaults = vec![kb("Mod-b", "editor.toggleBold", None)];
        let user = vec![kb("Mod-Shift-b", "editor.toggleBold", None)];
        let merged = merge_keymaps(&defaults, &user);
        let annotated = annotate_sources(&merged, &defaults, &user);
        assert_eq!(annotated[0].source, Some(KeyBindingSource::User));
    }

    #[test]
    fn test_annotate_sources_tags_user_addition() {
        let defaults = vec![kb("Mod-b", "editor.toggleBold", None)];
        let user = vec![kb("Mod-n", "app.newPage", None)];
        let merged = merge_keymaps(&defaults, &user);
        let annotated = annotate_sources(&merged, &defaults, &user);
        assert_eq!(annotated[0].source, Some(KeyBindingSource::Default));
        assert_eq!(annotated[1].source, Some(KeyBindingSource::User));
    }

    // --- Cycle 3: convert_accelerator ---

    #[test]
    fn test_convert_accelerator_simple() {
        assert_eq!(convert_accelerator("cmdOrCtrl+,"), "Mod-,");
    }

    #[test]
    fn test_convert_accelerator_with_shift() {
        assert_eq!(convert_accelerator("cmdOrCtrl+shift+s"), "Mod-Shift-s");
    }

    #[test]
    fn test_convert_accelerator_alt() {
        assert_eq!(convert_accelerator("alt+f"), "Alt-f");
    }

    #[test]
    fn test_convert_accelerator_ctrl_only() {
        assert_eq!(convert_accelerator("ctrl+z"), "Ctrl-z");
    }

    // --- Cycle 4: menu shortcut extraction ---

    #[test]
    fn test_menu_shortcuts_returns_four_entries() {
        assert_eq!(get_menu_shortcut_bindings().len(), 4);
    }

    #[test]
    fn test_menu_shortcuts_have_source_menu() {
        for b in get_menu_shortcut_bindings() {
            assert_eq!(b.source, Some(KeyBindingSource::Menu));
        }
    }

    #[test]
    fn test_menu_shortcuts_keys_are_converted() {
        let bindings = get_menu_shortcut_bindings();
        let keys: Vec<&str> = bindings.iter().map(|b| b.key.as_str()).collect();
        assert!(keys.contains(&"Mod-,"));
        assert!(keys.contains(&"Mod-n"));
        assert!(keys.contains(&"Mod-Shift-s"));
        assert!(keys.contains(&"Mod-Shift-e"));
    }

    #[test]
    fn test_menu_shortcuts_command_ids() {
        let bindings = get_menu_shortcut_bindings();
        let cmds: Vec<&str> = bindings.iter().map(|b| b.command.as_str()).collect();
        assert!(cmds.contains(&"core.page.new"));
        assert!(cmds.contains(&"core.settings.open"));
        assert!(cmds.contains(&"app.exportMarkdown"));
        assert!(cmds.contains(&"editor.openInExternalEditor"));
    }

    // --- Cycle 5: save strips source ---

    #[test]
    fn test_save_strips_source() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("user.json");
        let bindings = vec![KeyBinding {
            source: Some(KeyBindingSource::User),
            ..kb("Mod-b", "editor.toggleBold", None)
        }];
        let clean: Vec<KeyBinding> = bindings
            .iter()
            .map(|b| KeyBinding {
                source: None,
                ..b.clone()
            })
            .collect();
        let json = serde_json::to_string_pretty(&clean).unwrap();
        fs::write(&path, &json).unwrap();
        let read = read_keymaps_file(&path);
        assert!(read.iter().all(|b| b.source.is_none()));
    }

    // --- Cycle 7: full pipeline integration ---

    #[test]
    fn test_full_pipeline_with_sources() {
        let tmp = tempfile::tempdir().unwrap();
        let default_path = tmp.path().join("default.json");
        let user_path = tmp.path().join("user.json");

        let defaults = vec![
            kb("Mod-b", "editor.toggleBold", Some("editorFocus")),
            kb("Mod-i", "editor.toggleItalic", Some("editorFocus")),
        ];
        let user = vec![
            kb("Mod-Shift-b", "editor.toggleBold", Some("editorFocus")),
            kb("Mod-n", "app.newPage", None),
        ];

        fs::write(&default_path, serde_json::to_string_pretty(&defaults).unwrap()).unwrap();
        fs::write(&user_path, serde_json::to_string_pretty(&user).unwrap()).unwrap();

        let read_defaults = read_keymaps_file(&default_path);
        let read_user = read_keymaps_file(&user_path);
        let merged = merge_keymaps(&read_defaults, &read_user);
        let annotated = annotate_sources(&merged, &read_defaults, &read_user);

        assert_eq!(annotated.len(), 3);
        // user-overridden
        assert_eq!(annotated[0].command, "editor.toggleBold");
        assert_eq!(annotated[0].key, "Mod-Shift-b");
        assert_eq!(annotated[0].source, Some(KeyBindingSource::User));
        // unmodified default
        assert_eq!(annotated[1].command, "editor.toggleItalic");
        assert_eq!(annotated[1].source, Some(KeyBindingSource::Default));
        // user-added
        assert_eq!(annotated[2].command, "app.newPage");
        assert_eq!(annotated[2].source, Some(KeyBindingSource::User));
    }
}
