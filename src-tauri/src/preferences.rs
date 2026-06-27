use notify_debouncer_mini::notify::RecursiveMode;
use notify_debouncer_mini::{new_debouncer, DebouncedEventKind};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::mpsc;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};
use turboref_core::config::DocumentConfig;
use turboref_core::i18n::{self, Locale};

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

fn default_view_mode() -> String {
    "editor".to_string()
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
    #[serde(
        rename = "workbench.defaultViewMode",
        default = "default_view_mode"
    )]
    pub default_view_mode: String,
    #[serde(flatten)]
    pub extra: HashMap<String, serde_json::Value>,
}

impl Default for Preferences {
    fn default() -> Self {
        Self {
            dark_mode: "auto".to_string(),
            sidebar_location: "left".to_string(),
            folding_enabled: true,
            folding_show_controls: "mouseover".to_string(),
            default_view_mode: "editor".to_string(),
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

pub fn annotations_enabled(app_handle: &AppHandle) -> bool {
    read_preferences(app_handle)
        .extra
        .get("annotations.enabled")
        .and_then(|v| v.as_bool())
        .unwrap_or(true)
}

pub fn auto_update_enabled(app_handle: &AppHandle) -> bool {
    read_preferences(app_handle)
        .extra
        .get("app.autoUpdate")
        .and_then(|v| v.as_bool())
        .unwrap_or(true)
}

pub fn companion_search_paths(prefs: &Preferences) -> Vec<String> {
    prefs
        .extra
        .get("companion.searchPath")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|x| x.as_str())
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(|s| crate::cli::expand_tilde(s))
                .collect::<Vec<String>>()
        })
        .filter(|v| !v.is_empty())
        .unwrap_or_else(|| vec![".".to_string()])
}

/// Return the raw (unexpanded) `companion.searchPath` entries from preferences.
/// Unlike `companion_search_paths`, this does **not** trim, filter blanks, expand
/// tildes, or fall back to `["."]` -- it returns exactly what is stored in the
/// JSON array (or an empty vec when the key is absent / not an array).
pub fn raw_companion_search_paths(prefs: &Preferences) -> Vec<String> {
    prefs
        .extra
        .get("companion.searchPath")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|x| x.as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default()
}

pub fn citation_notes_dir(prefs: &Preferences) -> String {
    prefs
        .extra
        .get("citation.notesDir")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or("references")
        .to_string()
}

pub fn set_preference_at_path(
    path: &std::path::Path,
    key: &str,
    value: serde_json::Value,
) -> Result<(), String> {
    let content = fs::read_to_string(path).unwrap_or_else(|_| "{}".to_string());
    let mut obj: serde_json::Value =
        serde_json::from_str(&content).map_err(|e| format!("invalid JSON: {e}"))?;
    obj[key] = value;
    let pretty = serde_json::to_string_pretty(&obj).map_err(|e| e.to_string())?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("create dir failed: {e}"))?;
    }
    fs::write(path, pretty).map_err(|e| format!("write failed: {e}"))
}

pub fn set_preference(app_handle: &AppHandle, key: &str, value: serde_json::Value) -> Result<(), String> {
    let path = preferences_path(app_handle);
    set_preference_at_path(&path, key, value)
}

pub fn read_preferences_raw_from_path(path: &PathBuf) -> String {
    match fs::read_to_string(path) {
        Ok(content) => content,
        Err(_) => serde_json::to_string_pretty(&Preferences::default()).unwrap(),
    }
}

pub fn read_preferences_raw(app_handle: &AppHandle) -> String {
    read_preferences_raw_from_path(&preferences_path(app_handle))
}

pub fn set_preferences_raw_at_path(path: &std::path::Path, json: &str) -> Result<(), String> {
    let _: serde_json::Value =
        serde_json::from_str(json).map_err(|e| format!("invalid JSON: {e}"))?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(path, json).map_err(|e| e.to_string())
}

pub fn set_preferences_raw(app_handle: &AppHandle, json: &str) -> Result<(), String> {
    set_preferences_raw_at_path(&preferences_path(app_handle), json)
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

pub fn crossref_config_from_preferences(
    prefs: &Preferences,
    frontmatter: Option<&serde_json::Map<String, serde_json::Value>>,
) -> DocumentConfig {
    let locale = prefs
        .extra
        .get("crossref.locale")
        .and_then(|v| v.as_str())
        .and_then(|s| match s {
            "zh" => Some(Locale::Zh),
            "en" => Some(Locale::En),
            _ => None,
        })
        .unwrap_or(Locale::En);

    let mut config = i18n::localized_defaults(locale);

    fn get_string<'a>(
        prefs: &'a Preferences,
        fm: Option<&'a serde_json::Map<String, serde_json::Value>>,
        pref_key: &str,
        fm_key: &str,
    ) -> Option<&'a str> {
        if let Some(fm) = fm {
            if let Some(v) = fm.get(fm_key).and_then(|v| v.as_str()) {
                return Some(v);
            }
        }
        prefs.extra.get(pref_key).and_then(|v| v.as_str())
    }

    fn get_prefix(
        prefs: &Preferences,
        fm: Option<&serde_json::Map<String, serde_json::Value>>,
        pref_key: &str,
        fm_key: &str,
    ) -> Option<Vec<String>> {
        let source = if let Some(fm) = fm {
            fm.get(fm_key).or_else(|| prefs.extra.get(pref_key))
        } else {
            prefs.extra.get(pref_key)
        };
        source.and_then(|v| {
            if let Some(s) = v.as_str() {
                Some(vec![s.to_string()])
            } else if let Some(arr) = v.as_array() {
                Some(arr.iter().filter_map(|x| x.as_str().map(String::from)).collect())
            } else {
                None
            }
        })
    }

    fn get_bool(
        prefs: &Preferences,
        fm: Option<&serde_json::Map<String, serde_json::Value>>,
        pref_key: &str,
        fm_key: &str,
    ) -> Option<bool> {
        if let Some(fm) = fm {
            if let Some(v) = fm.get(fm_key).and_then(|v| v.as_bool()) {
                return Some(v);
            }
        }
        prefs.extra.get(pref_key).and_then(|v| v.as_bool())
    }

    if let Some(v) = get_string(prefs, frontmatter, "crossref.figureTitle", "figureTitle") {
        config.figure_title = v.to_string();
    }
    if let Some(v) = get_string(prefs, frontmatter, "crossref.tableTitle", "tableTitle") {
        config.table_title = v.to_string();
    }
    if let Some(v) = get_string(prefs, frontmatter, "crossref.listingTitle", "listingTitle") {
        config.listing_title = v.to_string();
    }
    if let Some(v) = get_string(prefs, frontmatter, "crossref.equationTitle", "equationTitle") {
        config.equation_title = v.to_string();
    }

    if let Some(v) = get_prefix(prefs, frontmatter, "crossref.figPrefix", "figPrefix") {
        config.fig_prefix = v;
    }
    if let Some(v) = get_prefix(prefs, frontmatter, "crossref.tblPrefix", "tblPrefix") {
        config.tbl_prefix = v;
    }
    if let Some(v) = get_prefix(prefs, frontmatter, "crossref.eqPrefix", "eqPrefix") {
        config.eq_prefix = v;
    }
    if let Some(v) = get_prefix(prefs, frontmatter, "crossref.lstPrefix", "lstPrefix") {
        config.lst_prefix = v;
    }
    if let Some(v) = get_prefix(prefs, frontmatter, "crossref.secPrefix", "secPrefix") {
        config.sec_prefix = v;
    }

    if let Some(v) = get_bool(prefs, frontmatter, "crossref.linkReferences", "linkReferences") {
        config.link_references = v;
    }
    if let Some(v) = get_bool(prefs, frontmatter, "crossref.nameInLink", "nameInLink") {
        config.name_in_link = v;
    }
    if let Some(v) = get_bool(prefs, frontmatter, "crossref.subfigGrid", "subfigGrid") {
        config.subfig_grid = v;
    }

    // Frontmatter locale overrides preferences locale
    if let Some(fm) = frontmatter {
        if let Some(locale_str) = fm.get("crossref-locale").and_then(|v| v.as_str()) {
            let fm_locale = match locale_str {
                "zh" => Some(Locale::Zh),
                "en" => Some(Locale::En),
                _ => None,
            };
            if let Some(l) = fm_locale {
                if l != locale {
                    config = i18n::localized_defaults(l);
                    // Re-apply any explicit overrides from prefs/frontmatter on top of new locale
                    // (recursive would be cleaner but this is a simple two-level override)
                    if let Some(v) = get_string(prefs, Some(fm), "crossref.figureTitle", "figureTitle") {
                        config.figure_title = v.to_string();
                    }
                    if let Some(v) = get_prefix(prefs, Some(fm), "crossref.figPrefix", "figPrefix") {
                        config.fig_prefix = v;
                    }
                }
            }
        }
    }

    config
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn defaults() {
        let prefs = Preferences::default();
        assert_eq!(prefs.dark_mode, "auto");
        assert_eq!(prefs.sidebar_location, "left");
        assert!(prefs.folding_enabled);
        assert_eq!(prefs.folding_show_controls, "mouseover");
        assert_eq!(prefs.default_view_mode, "editor");
        assert!(prefs.extra.is_empty());
    }

    #[test]
    fn parse_empty_json() {
        let prefs: Preferences = serde_json::from_str("{}").unwrap();
        assert_eq!(prefs.dark_mode, "auto");
        assert_eq!(prefs.sidebar_location, "left");
        assert!(prefs.folding_enabled);
        assert_eq!(prefs.folding_show_controls, "mouseover");
        assert_eq!(prefs.default_view_mode, "editor");
    }

    #[test]
    fn parse_bool_true_becomes_dark() {
        let prefs: Preferences =
            serde_json::from_str(r#"{"workbench.darkMode": true}"#).unwrap();
        assert_eq!(prefs.dark_mode, "dark");
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
            "workbench.darkMode": "dark",
            "workbench.sideBar.location": "right",
            "editor.folding.enabled": false,
            "editor.folding.showFoldingControls": "always"
        }"#;
        let prefs: Preferences = serde_json::from_str(json).unwrap();
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
        assert!(json.contains("workbench.darkMode"));
        assert!(json.contains("workbench.sideBar.location"));
        assert!(json.contains("editor.folding.enabled"));
        assert!(json.contains("editor.folding.showFoldingControls"));
        assert!(json.contains("workbench.defaultViewMode"));
    }

    #[test]
    fn folding_defaults_when_omitted() {
        let json = r#"{"workbench.darkMode": "dark"}"#;
        let prefs: Preferences = serde_json::from_str(json).unwrap();
        assert!(prefs.folding_enabled);
        assert_eq!(prefs.folding_show_controls, "mouseover");
    }

    #[test]
    fn crossref_config_defaults_when_no_crossref_keys() {
        let prefs = Preferences::default();
        let config = crossref_config_from_preferences(&prefs, None);
        assert_eq!(config.figure_title, "Figure");
        assert_eq!(config.fig_prefix, vec!["Fig.", "Figs."]);
        assert_eq!(config.locale, Locale::En);
        assert!(!config.link_references);
    }

    #[test]
    fn crossref_config_custom_prefix_overrides() {
        let json = r#"{
            "crossref.figPrefix": ["Figure", "Figures"],
            "crossref.figureTitle": "Abbildung"
        }"#;
        let prefs: Preferences = serde_json::from_str(json).unwrap();
        let config = crossref_config_from_preferences(&prefs, None);
        assert_eq!(config.fig_prefix, vec!["Figure", "Figures"]);
        assert_eq!(config.figure_title, "Abbildung");
        // Others remain default
        assert_eq!(config.tbl_prefix, vec!["Table", "Tables"]);
    }

    #[test]
    fn crossref_config_frontmatter_takes_precedence() {
        let json = r#"{"crossref.figPrefix": "Fig."}"#;
        let prefs: Preferences = serde_json::from_str(json).unwrap();

        let mut fm = serde_json::Map::new();
        fm.insert("figPrefix".to_string(), serde_json::json!(["Abb.", "Abbn."]));

        let config = crossref_config_from_preferences(&prefs, Some(&fm));
        assert_eq!(config.fig_prefix, vec!["Abb.", "Abbn."]);
    }

    #[test]
    fn crossref_config_locale_detection() {
        let json = r#"{"crossref.locale": "zh"}"#;
        let prefs: Preferences = serde_json::from_str(json).unwrap();
        let config = crossref_config_from_preferences(&prefs, None);
        assert_eq!(config.locale, Locale::Zh);
        assert_eq!(config.figure_title, "图");
        assert_eq!(config.fig_prefix, vec!["图"]);
    }

    #[test]
    fn crossref_config_bool_overrides() {
        let json = r#"{"crossref.linkReferences": true, "crossref.nameInLink": true}"#;
        let prefs: Preferences = serde_json::from_str(json).unwrap();
        let config = crossref_config_from_preferences(&prefs, None);
        assert!(config.link_references);
        assert!(config.name_in_link);
    }

    #[test]
    fn experimental_unlinked_references_round_trip() {
        let json = r#"{"experimental.unlinkedReferences": true}"#;
        let prefs: Preferences = serde_json::from_str(json).unwrap();
        assert_eq!(
            prefs.extra.get("experimental.unlinkedReferences"),
            Some(&serde_json::json!(true))
        );

        let serialized = serde_json::to_string(&prefs).unwrap();
        let roundtrip: Preferences = serde_json::from_str(&serialized).unwrap();
        assert_eq!(
            roundtrip.extra.get("experimental.unlinkedReferences"),
            Some(&serde_json::json!(true))
        );
    }

    #[test]
    fn experimental_unlinked_references_absent_by_default() {
        let prefs = Preferences::default();
        assert!(prefs.extra.get("experimental.unlinkedReferences").is_none());
    }

    #[test]
    fn crossref_config_string_prefix_becomes_single_element_vec() {
        let json = r#"{"crossref.eqPrefix": "Equation"}"#;
        let prefs: Preferences = serde_json::from_str(json).unwrap();
        let config = crossref_config_from_preferences(&prefs, None);
        assert_eq!(config.eq_prefix, vec!["Equation"]);
    }

    fn annotations_enabled_from_prefs(prefs: &Preferences) -> bool {
        prefs
            .extra
            .get("annotations.enabled")
            .and_then(|v| v.as_bool())
            .unwrap_or(true)
    }

    #[test]
    fn annotations_enabled_defaults_to_true() {
        let prefs = Preferences::default();
        assert!(annotations_enabled_from_prefs(&prefs));
    }

    #[test]
    fn annotations_enabled_respects_false() {
        let json = r#"{"annotations.enabled": false}"#;
        let prefs: Preferences = serde_json::from_str(json).unwrap();
        assert!(!annotations_enabled_from_prefs(&prefs));
    }

    #[test]
    fn annotations_enabled_respects_true() {
        let json = r#"{"annotations.enabled": true}"#;
        let prefs: Preferences = serde_json::from_str(json).unwrap();
        assert!(annotations_enabled_from_prefs(&prefs));
    }

    fn auto_update_enabled_from_prefs(prefs: &Preferences) -> bool {
        prefs
            .extra
            .get("app.autoUpdate")
            .and_then(|v| v.as_bool())
            .unwrap_or(true)
    }

    #[test]
    fn auto_update_enabled_defaults_to_true() {
        let prefs = Preferences::default();
        assert!(auto_update_enabled_from_prefs(&prefs));
    }

    #[test]
    fn auto_update_enabled_respects_false() {
        let json = r#"{"app.autoUpdate": false}"#;
        let prefs: Preferences = serde_json::from_str(json).unwrap();
        assert!(!auto_update_enabled_from_prefs(&prefs));
    }

    #[test]
    fn auto_update_enabled_respects_true() {
        let json = r#"{"app.autoUpdate": true}"#;
        let prefs: Preferences = serde_json::from_str(json).unwrap();
        assert!(auto_update_enabled_from_prefs(&prefs));
    }

    #[test]
    fn companion_search_paths_defaults_to_dot() {
        let prefs = Preferences::default();
        assert_eq!(super::companion_search_paths(&prefs), vec![".".to_string()]);
    }

    #[test]
    fn companion_search_paths_parses_array() {
        let prefs: Preferences =
            serde_json::from_str(r#"{"companion.searchPath": [".", "pdfs"]}"#).unwrap();
        assert_eq!(
            super::companion_search_paths(&prefs),
            vec![".".to_string(), "pdfs".to_string()]
        );
    }

    #[test]
    fn companion_search_paths_non_array_returns_default() {
        let prefs: Preferences =
            serde_json::from_str(r#"{"companion.searchPath": "pdfs"}"#).unwrap();
        assert_eq!(super::companion_search_paths(&prefs), vec![".".to_string()]);
    }

    #[test]
    fn companion_search_paths_filters_empty_and_whitespace_entries() {
        let prefs: Preferences =
            serde_json::from_str(r#"{"companion.searchPath": [".", "", "  ", "pdfs"]}"#).unwrap();
        assert_eq!(
            super::companion_search_paths(&prefs),
            vec![".".to_string(), "pdfs".to_string()]
        );
    }

    #[test]
    fn companion_search_paths_expands_tilde() {
        let prefs: Preferences =
            serde_json::from_str(r#"{"companion.searchPath": ["~/pdfs"]}"#).unwrap();
        let home = std::env::var("HOME").unwrap();
        assert_eq!(
            super::companion_search_paths(&prefs),
            vec![format!("{home}/pdfs")]
        );
    }

    #[test]
    fn companion_search_paths_preserves_absolute() {
        let prefs: Preferences =
            serde_json::from_str(r#"{"companion.searchPath": ["/abs/path"]}"#).unwrap();
        assert_eq!(
            super::companion_search_paths(&prefs),
            vec!["/abs/path".to_string()]
        );
    }

    #[test]
    fn companion_search_paths_does_not_expand_mid_tilde() {
        let prefs: Preferences =
            serde_json::from_str(r#"{"companion.searchPath": ["foo/~bar"]}"#).unwrap();
        assert_eq!(
            super::companion_search_paths(&prefs),
            vec!["foo/~bar".to_string()]
        );
    }

    // --- raw_companion_search_paths tests ---

    #[test]
    fn raw_companion_search_paths_empty_when_absent() {
        let prefs = Preferences::default();
        assert!(super::raw_companion_search_paths(&prefs).is_empty());
    }

    #[test]
    fn raw_companion_search_paths_returns_exact_strings() {
        let prefs: Preferences =
            serde_json::from_str(r#"{"companion.searchPath": [".", " assets/pdf ", "~/pdfs"]}"#)
                .unwrap();
        assert_eq!(
            super::raw_companion_search_paths(&prefs),
            vec![".".to_string(), " assets/pdf ".to_string(), "~/pdfs".to_string()]
        );
    }

    #[test]
    fn raw_companion_search_paths_non_array_returns_empty() {
        let prefs: Preferences =
            serde_json::from_str(r#"{"companion.searchPath": "pdfs"}"#).unwrap();
        assert!(super::raw_companion_search_paths(&prefs).is_empty());
    }

    #[test]
    fn set_preference_writes_key_to_file() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("preferences.json");
        fs::write(&path, "{}").unwrap();

        set_preference_at_path(&path, "workbench.darkMode", serde_json::json!("dark")).unwrap();

        let content = fs::read_to_string(&path).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&content).unwrap();
        assert_eq!(parsed["workbench.darkMode"], serde_json::json!("dark"));
    }

    #[test]
    fn set_preference_preserves_existing_keys() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("preferences.json");
        fs::write(&path, r#"{"workbench.darkMode": "light", "editor.folding.enabled": true}"#).unwrap();

        set_preference_at_path(&path, "custom.newKey", serde_json::json!(42)).unwrap();

        let content = fs::read_to_string(&path).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&content).unwrap();
        assert_eq!(parsed["workbench.darkMode"], serde_json::json!("light"));
        assert_eq!(parsed["editor.folding.enabled"], serde_json::json!(true));
        assert_eq!(parsed["custom.newKey"], serde_json::json!(42));
    }

    #[test]
    fn set_preference_overwrites_existing_key() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("preferences.json");
        fs::write(&path, r#"{"workbench.darkMode": "light"}"#).unwrap();

        set_preference_at_path(&path, "workbench.darkMode", serde_json::json!("dark")).unwrap();

        let content = fs::read_to_string(&path).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&content).unwrap();
        assert_eq!(parsed["workbench.darkMode"], serde_json::json!("dark"));
    }

    #[test]
    fn set_preference_creates_file_and_parent_dirs() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("nested").join("sub").join("preferences.json");
        assert!(!path.exists());

        set_preference_at_path(&path, "workbench.darkMode", serde_json::json!("auto")).unwrap();

        let content = fs::read_to_string(&path).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&content).unwrap();
        assert_eq!(parsed["workbench.darkMode"], serde_json::json!("auto"));
    }

    #[test]
    fn read_preferences_raw_returns_file_contents() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("preferences.json");
        let raw = "{\n\t\"workbench.darkMode\": \"dark\"\n}\n";
        fs::write(&path, raw).unwrap();

        let result = read_preferences_raw_from_path(&path);
        assert_eq!(result, raw);
    }

    #[test]
    fn read_preferences_raw_missing_file_returns_default() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("nonexistent.json");

        let result = read_preferences_raw_from_path(&path);
        let expected = serde_json::to_string_pretty(&Preferences::default()).unwrap();
        assert_eq!(result, expected);
    }

    #[test]
    fn set_preferences_raw_valid_json_writes_file() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("preferences.json");
        let json = r#"{"workbench.darkMode": "dark"}"#;

        set_preferences_raw_at_path(&path, json).unwrap();

        let content = fs::read_to_string(&path).unwrap();
        assert_eq!(content, json);
    }

    #[test]
    fn set_preferences_raw_invalid_json_returns_error() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("preferences.json");

        let result = set_preferences_raw_at_path(&path, "not { valid");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("invalid JSON"));
    }

    #[test]
    fn set_preferences_raw_preserves_exact_content() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("preferences.json");
        let json = "{\n\t\"workbench.darkMode\":\t\"dark\"\n}";

        set_preferences_raw_at_path(&path, json).unwrap();

        let content = fs::read_to_string(&path).unwrap();
        assert_eq!(content, json);
    }

    #[test]
    fn citation_notes_dir_defaults_to_references() {
        let prefs = Preferences::default();
        assert_eq!(super::citation_notes_dir(&prefs), "references");
    }

    #[test]
    fn citation_notes_dir_reads_custom_value() {
        let json = r#"{"citation.notesDir": "notes/refs"}"#;
        let prefs: Preferences = serde_json::from_str(json).unwrap();
        assert_eq!(super::citation_notes_dir(&prefs), "notes/refs");
    }

    #[test]
    fn citation_notes_dir_non_string_falls_back_to_default() {
        let json = r#"{"citation.notesDir": 42}"#;
        let prefs: Preferences = serde_json::from_str(json).unwrap();
        assert_eq!(super::citation_notes_dir(&prefs), "references");
    }

    #[test]
    fn citation_notes_dir_empty_string_falls_back_to_default() {
        let json = r#"{"citation.notesDir": ""}"#;
        let prefs: Preferences = serde_json::from_str(json).unwrap();
        assert_eq!(super::citation_notes_dir(&prefs), "references");
    }

    #[test]
    fn citation_notes_dir_whitespace_only_falls_back_to_default() {
        let json = r#"{"citation.notesDir": "   "}"#;
        let prefs: Preferences = serde_json::from_str(json).unwrap();
        assert_eq!(super::citation_notes_dir(&prefs), "references");
    }
}
