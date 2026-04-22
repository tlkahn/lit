use notify_debouncer_mini::notify::RecursiveMode;
use notify_debouncer_mini::{new_debouncer, DebouncedEventKind};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::mpsc;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

fn default_sidebar_location() -> String {
    "left".to_string()
}

const fn default_true() -> bool {
    true
}

fn default_folding_show_controls() -> String {
    "mouseover".to_string()
}

fn default_dark_mode() -> String {
    "auto".to_string()
}

fn deserialize_dark_mode<'de, D>(deserializer: D) -> Result<String, D::Error>
where
    D: serde::Deserializer<'de>,
{
    use serde::de;

    struct DarkModeVisitor;

    impl<'de> de::Visitor<'de> for DarkModeVisitor {
        type Value = String;

        fn expecting(&self, formatter: &mut std::fmt::Formatter) -> std::fmt::Result {
            formatter.write_str(r#""light", "dark", "auto", or a boolean"#)
        }

        fn visit_bool<E: de::Error>(self, v: bool) -> Result<String, E> {
            Ok(if v { "dark" } else { "light" }.to_string())
        }

        fn visit_str<E: de::Error>(self, v: &str) -> Result<String, E> {
            match v {
                "light" | "dark" | "auto" => Ok(v.to_string()),
                _ => Ok("auto".to_string()),
            }
        }
    }

    deserializer.deserialize_any(DarkModeVisitor)
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Preferences {
    #[serde(rename = "workbench.colorTheme", default)]
    pub color_theme: Option<String>,
    #[serde(
        rename = "workbench.darkMode",
        default = "default_dark_mode",
        deserialize_with = "deserialize_dark_mode"
    )]
    pub dark_mode: String,
    #[serde(
        rename = "workbench.sideBar.location",
        default = "default_sidebar_location"
    )]
    pub sidebar_location: String,
    #[serde(rename = "editor.folding.enabled", default = "default_true")]
    pub folding_enabled: bool,
    #[serde(
        rename = "editor.folding.showFoldingControls",
        default = "default_folding_show_controls"
    )]
    pub folding_show_controls: String,
    #[serde(flatten)]
    pub extra: HashMap<String, serde_json::Value>,
}

impl Default for Preferences {
    fn default() -> Self {
        Self {
            color_theme: None,
            dark_mode: "auto".to_string(),
            sidebar_location: "left".to_string(),
            folding_enabled: true,
            folding_show_controls: "mouseover".to_string(),
            extra: HashMap::new(),
        }
    }
}

pub fn preferences_path(app_handle: &AppHandle) -> PathBuf {
    let data_dir = app_handle.path().app_data_dir().unwrap();
    data_dir.join("preferences.json")
}

pub fn read_preferences_from_path(path: &PathBuf) -> Preferences {
    let content = match fs::read_to_string(path) {
        Ok(c) => c,
        Err(_) => return Preferences::default(),
    };
    serde_json::from_str(&content).unwrap_or_else(|e| {
        eprintln!("[preferences] invalid JSON, using defaults: {e}");
        Preferences::default()
    })
}

pub fn read_preferences(app_handle: &AppHandle) -> Preferences {
    let path = preferences_path(app_handle);
    read_preferences_from_path(&path)
}

pub fn seed_default_if_missing(app_handle: &AppHandle) {
    let path = preferences_path(app_handle);
    if path.exists() {
        return;
    }
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let defaults = Preferences::default();
    let json = serde_json::to_string_pretty(&defaults).unwrap();
    let _ = fs::write(&path, json);
}

pub struct PreferencesWatcher {
    _debouncer:
        notify_debouncer_mini::Debouncer<notify_debouncer_mini::notify::RecommendedWatcher>,
}

impl PreferencesWatcher {
    pub fn new(app_handle: AppHandle) -> Result<Self, String> {
        let path = preferences_path(&app_handle);
        let watch_dir = path
            .parent()
            .ok_or("Cannot determine preferences directory")?
            .to_path_buf();
        let filename = path
            .file_name()
            .ok_or("Cannot determine preferences filename")?
            .to_os_string();

        let (tx, rx) = mpsc::channel();
        let mut debouncer = new_debouncer(Duration::from_millis(500), tx)
            .map_err(|e| format!("Failed to create preferences watcher: {e}"))?;

        debouncer
            .watcher()
            .watch(&watch_dir, RecursiveMode::NonRecursive)
            .map_err(|e| format!("Failed to watch preferences dir: {e}"))?;

        let handle = app_handle.clone();
        std::thread::spawn(move || {
            while let Ok(result) = rx.recv() {
                let events = match result {
                    Ok(events) => events,
                    Err(_) => continue,
                };

                let relevant = events.iter().any(|e| {
                    matches!(e.kind, DebouncedEventKind::Any)
                        && e.path.file_name() == Some(&filename)
                });
                if !relevant {
                    continue;
                }

                let prefs = read_preferences(&handle);
                let _ = handle.emit("preferences://changed", &prefs);
            }
        });

        Ok(PreferencesWatcher {
            _debouncer: debouncer,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn defaults() {
        let prefs = Preferences::default();
        assert_eq!(prefs.color_theme, None);
        assert_eq!(prefs.dark_mode, "auto");
        assert_eq!(prefs.sidebar_location, "left");
        assert!(prefs.folding_enabled);
        assert_eq!(prefs.folding_show_controls, "mouseover");
        assert!(prefs.extra.is_empty());
    }

    #[test]
    fn parse_empty_json() {
        let prefs: Preferences = serde_json::from_str("{}").unwrap();
        assert_eq!(prefs.color_theme, None);
        assert_eq!(prefs.dark_mode, "auto");
        assert_eq!(prefs.sidebar_location, "left");
        assert!(prefs.folding_enabled);
        assert_eq!(prefs.folding_show_controls, "mouseover");
    }

    #[test]
    fn parse_bool_true_becomes_dark() {
        let prefs: Preferences =
            serde_json::from_str(r#"{"workbench.darkMode": true}"#).unwrap();
        assert_eq!(prefs.dark_mode, "dark");
        assert_eq!(prefs.color_theme, None);
        assert_eq!(prefs.sidebar_location, "left");
    }

    #[test]
    fn parse_bool_false_becomes_light() {
        let prefs: Preferences =
            serde_json::from_str(r#"{"workbench.darkMode": false}"#).unwrap();
        assert_eq!(prefs.dark_mode, "light");
    }

    #[test]
    fn parse_string_auto() {
        let prefs: Preferences =
            serde_json::from_str(r#"{"workbench.darkMode": "auto"}"#).unwrap();
        assert_eq!(prefs.dark_mode, "auto");
    }

    #[test]
    fn parse_string_dark() {
        let prefs: Preferences =
            serde_json::from_str(r#"{"workbench.darkMode": "dark"}"#).unwrap();
        assert_eq!(prefs.dark_mode, "dark");
    }

    #[test]
    fn parse_string_light() {
        let prefs: Preferences =
            serde_json::from_str(r#"{"workbench.darkMode": "light"}"#).unwrap();
        assert_eq!(prefs.dark_mode, "light");
    }

    #[test]
    fn parse_unknown_string_becomes_auto() {
        let prefs: Preferences =
            serde_json::from_str(r#"{"workbench.darkMode": "invalid"}"#).unwrap();
        assert_eq!(prefs.dark_mode, "auto");
    }

    #[test]
    fn parse_full_json() {
        let json = r#"{
            "workbench.colorTheme": "lit-nordic",
            "workbench.darkMode": "dark",
            "workbench.sideBar.location": "right",
            "editor.folding.enabled": false,
            "editor.folding.showFoldingControls": "always"
        }"#;
        let prefs: Preferences = serde_json::from_str(json).unwrap();
        assert_eq!(prefs.color_theme, Some("lit-nordic".to_string()));
        assert_eq!(prefs.dark_mode, "dark");
        assert_eq!(prefs.sidebar_location, "right");
        assert!(!prefs.folding_enabled);
        assert_eq!(prefs.folding_show_controls, "always");
    }

    #[test]
    fn unknown_keys_preserved() {
        let json = r#"{
            "workbench.darkMode": "light",
            "myCustom.setting": 42,
            "another.key": "hello"
        }"#;
        let prefs: Preferences = serde_json::from_str(json).unwrap();
        assert_eq!(prefs.extra.get("myCustom.setting"), Some(&serde_json::json!(42)));
        assert_eq!(prefs.extra.get("another.key"), Some(&serde_json::json!("hello")));

        let serialized = serde_json::to_string(&prefs).unwrap();
        let roundtrip: Preferences = serde_json::from_str(&serialized).unwrap();
        assert_eq!(roundtrip.extra.get("myCustom.setting"), Some(&serde_json::json!(42)));
    }

    #[test]
    fn invalid_json_returns_defaults() {
        let path = PathBuf::from("/tmp/lit-test-nonexistent-prefs.json");
        let _ = fs::write(&path, "not valid json {{{");
        let prefs = read_preferences_from_path(&path);
        assert_eq!(prefs, Preferences::default());
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn write_and_read_roundtrip() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("preferences.json");

        let mut prefs = Preferences::default();
        prefs.dark_mode = "dark".to_string();
        prefs.color_theme = Some("nord".to_string());
        prefs.sidebar_location = "right".to_string();
        prefs.extra.insert("custom.key".to_string(), serde_json::json!("value"));

        let json = serde_json::to_string_pretty(&prefs).unwrap();
        fs::write(&path, &json).unwrap();

        let read_back = read_preferences_from_path(&path);
        assert_eq!(read_back, prefs);
    }

    #[test]
    fn seed_creates_file_when_absent() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("preferences.json");
        assert!(!path.exists());

        if let Some(parent) = path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        let defaults = Preferences::default();
        let json = serde_json::to_string_pretty(&defaults).unwrap();
        fs::write(&path, &json).unwrap();

        assert!(path.exists());
        let content = fs::read_to_string(&path).unwrap();
        let prefs: Preferences = serde_json::from_str(&content).unwrap();
        assert_eq!(prefs, Preferences::default());
    }

    #[test]
    fn seed_preserves_existing_file() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("preferences.json");

        let custom = r#"{"workbench.darkMode": "dark"}"#;
        fs::write(&path, custom).unwrap();

        // Simulating seed_default_if_missing: don't overwrite if exists
        if !path.exists() {
            let defaults = Preferences::default();
            let json = serde_json::to_string_pretty(&defaults).unwrap();
            fs::write(&path, &json).unwrap();
        }

        let content = fs::read_to_string(&path).unwrap();
        let prefs: Preferences = serde_json::from_str(&content).unwrap();
        assert_eq!(prefs.dark_mode, "dark");
    }

    #[test]
    fn missing_file_returns_defaults() {
        let path = PathBuf::from("/tmp/lit-test-definitely-missing.json");
        let _ = fs::remove_file(&path);
        let prefs = read_preferences_from_path(&path);
        assert_eq!(prefs, Preferences::default());
    }

    #[test]
    fn serialization_uses_dot_notation_keys() {
        let prefs = Preferences::default();
        let json = serde_json::to_string(&prefs).unwrap();
        assert!(json.contains("workbench.colorTheme"));
        assert!(json.contains("workbench.darkMode"));
        assert!(json.contains("workbench.sideBar.location"));
        assert!(json.contains("editor.folding.enabled"));
        assert!(json.contains("editor.folding.showFoldingControls"));
    }

    #[test]
    fn folding_defaults_when_omitted() {
        let json = r#"{"workbench.darkMode": "dark"}"#;
        let prefs: Preferences = serde_json::from_str(json).unwrap();
        assert!(prefs.folding_enabled);
        assert_eq!(prefs.folding_show_controls, "mouseover");
    }
}
