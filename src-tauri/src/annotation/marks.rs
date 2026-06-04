//! Philological "mark" annotation configuration.
//!
//! Marks are display-only annotation codes (e.g. `nb` for bold, `sic` for a
//! wavy underline). Their definitions live in TOML: built-in defaults are
//! compiled into the binary via `include_str!`, and a workspace may override or
//! extend them through `.lit/marks.toml`.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;
use std::sync::LazyLock;

/// A single mark definition: how the mark is labelled and styled.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct MarkDef {
    /// Human-readable name (required).
    pub label: String,
    /// Compact pill badge text. Defaults to the code itself when absent.
    #[serde(default)]
    pub icon: Option<String>,
    /// CSS `::before` content prepended to the scoped text.
    #[serde(default)]
    pub before: Option<String>,
    /// CSS `::after` content appended to the scoped text.
    #[serde(default)]
    pub after: Option<String>,
    /// CSS property/value pairs applied to the mark decoration.
    #[serde(default)]
    pub style: Option<HashMap<String, String>>,
}

/// A map of mark code -> definition. Each top-level TOML table is one entry.
#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
#[serde(transparent)]
pub struct MarkConfig(pub HashMap<String, MarkDef>);

static BUILTIN: LazyLock<MarkConfig> = LazyLock::new(|| {
    toml::from_str(include_str!("marks_builtin.toml")).expect("builtin marks_builtin.toml must parse")
});

static BUILTIN_CODES: LazyLock<Vec<String>> = LazyLock::new(|| {
    let mut codes: Vec<String> = BUILTIN.0.keys().cloned().collect();
    sort_codes(&mut codes);
    codes
});

/// Sort mark codes longest-first so multi-char codes win during prefix
/// matching; the lexical tiebreaker keeps the ordering deterministic.
fn sort_codes(codes: &mut [String]) {
    codes.sort_by(|a, b| b.len().cmp(&a.len()).then_with(|| a.cmp(b)));
}

/// The built-in mark configuration, parsed once and cached.
pub fn builtin_config() -> &'static MarkConfig {
    &BUILTIN
}

/// All built-in mark codes, sorted longest-first (then lexically).
pub fn builtin_mark_codes() -> &'static [String] {
    &BUILTIN_CODES
}

/// Whether `s` is a known built-in mark code.
pub fn is_mark_code(s: &str) -> bool {
    BUILTIN.0.contains_key(s)
}

/// All mark codes from `config`, sorted longest-first (then lexically).
///
/// Use this to feed the parse layer with workspace-extended codes (e.g. from
/// `merged_config`) so custom `.lit/marks.toml` codes are recognized. The sort
/// order matches [`builtin_mark_codes`], which the prefix matcher relies on.
pub fn sorted_mark_codes(config: &MarkConfig) -> Vec<String> {
    let mut codes: Vec<String> = config.0.keys().cloned().collect();
    sort_codes(&mut codes);
    codes
}

/// Whether `s` is one of the provided mark `codes`.
pub fn is_known_mark_code(s: &str, codes: &[String]) -> bool {
    codes.iter().any(|c| c == s)
}

/// The path to a workspace's mark override file.
fn workspace_override_path(root: &Path) -> std::path::PathBuf {
    root.join(".lit").join("marks.toml")
}

/// Load workspace mark overrides from `.lit/marks.toml`, if present and valid.
///
/// Returns `None` when the file is absent or fails to parse.
pub fn load_workspace_overrides(root: &Path) -> Option<MarkConfig> {
    let path = workspace_override_path(root);
    std::fs::read_to_string(path)
        .ok()
        .and_then(|s| toml::from_str(&s).ok())
}

/// Built-in defaults merged with any workspace overrides (workspace wins per code).
pub fn merged_config(root: &Path) -> MarkConfig {
    let mut merged = builtin_config().clone();
    if let Some(overrides) = load_workspace_overrides(root) {
        for (code, def) in overrides.0 {
            merged.0.insert(code, def);
        }
    }
    merged
}

#[cfg(test)]
mod tests {
    use super::*;

    const ALL_CODES: [&str; 16] = [
        "nb", "it", "ul", "st", "sc", "hi", "sic", "crux", "lac", "del", "sup", "conj", "dub",
        "gloss", "interp", "em",
    ];

    #[test]
    fn builtin_config_loads_all_16_codes() {
        let config = builtin_config();
        assert_eq!(config.0.len(), 16, "expected exactly 16 mark codes");
        for code in ALL_CODES {
            assert!(config.0.contains_key(code), "missing code {code}");
        }
    }

    #[test]
    fn builtin_def_fields() {
        let config = builtin_config();
        let nb = config.0.get("nb").expect("nb present");
        assert_eq!(nb.label, "nota bene");
        let nb_style = nb.style.as_ref().expect("nb has style");
        assert_eq!(nb_style.get("font-weight").map(String::as_str), Some("bold"));

        let crux = config.0.get("crux").expect("crux present");
        assert_eq!(crux.before.as_deref(), Some("†"));
        assert_eq!(crux.after.as_deref(), Some("†"));
    }

    #[test]
    fn builtin_mark_codes_sorted_longest_first() {
        let codes = builtin_mark_codes();
        assert_eq!(codes.len(), 16);
        for pair in codes.windows(2) {
            assert!(
                pair[0].len() >= pair[1].len(),
                "codes must be sorted longest-first: {:?} before {:?}",
                pair[0],
                pair[1]
            );
        }
    }

    #[test]
    fn is_mark_code_known_and_unknown() {
        assert!(is_mark_code("nb"));
        assert!(is_mark_code("crux"));
        assert!(!is_mark_code("n"));
        assert!(!is_mark_code("xyz"));
        assert!(!is_mark_code(""));
    }

    #[test]
    fn sorted_mark_codes_matches_builtin_order() {
        assert_eq!(sorted_mark_codes(builtin_config()), builtin_mark_codes());
    }

    #[test]
    fn is_known_mark_code_respects_passed_codes() {
        let codes = vec!["zz".to_string(), "nb".to_string()];
        assert!(is_known_mark_code("zz", &codes));
        assert!(is_known_mark_code("nb", &codes));
        assert!(!is_known_mark_code("crux", &codes));
        assert!(!is_known_mark_code("", &codes));
    }

    #[test]
    fn sorted_mark_codes_includes_custom_from_merged_config() {
        let dir = tempfile::TempDir::new().unwrap();
        std::fs::create_dir_all(dir.path().join(".lit")).unwrap();
        std::fs::write(
            dir.path().join(".lit").join("marks.toml"),
            "[zz]\nlabel = \"custom code\"\n",
        )
        .unwrap();
        let codes = sorted_mark_codes(&merged_config(dir.path()));
        assert!(codes.iter().any(|c| c == "zz"));
        assert!(codes.iter().any(|c| c == "nb"));
        // Longest-first invariant still holds.
        for pair in codes.windows(2) {
            assert!(pair[0].len() >= pair[1].len());
        }
    }

    #[test]
    fn load_workspace_overrides_missing_returns_none() {
        let dir = tempfile::TempDir::new().unwrap();
        assert!(load_workspace_overrides(dir.path()).is_none());
    }

    #[test]
    fn load_workspace_overrides_reads_file() {
        let dir = tempfile::TempDir::new().unwrap();
        std::fs::create_dir_all(dir.path().join(".lit")).unwrap();
        std::fs::write(
            dir.path().join(".lit").join("marks.toml"),
            "[nb]\nlabel = \"custom bold\"\n",
        )
        .unwrap();
        let config = load_workspace_overrides(dir.path()).expect("overrides loaded");
        assert_eq!(config.0.get("nb").unwrap().label, "custom bold");
    }

    #[test]
    fn merged_config_overlays_workspace() {
        let dir = tempfile::TempDir::new().unwrap();
        std::fs::create_dir_all(dir.path().join(".lit")).unwrap();
        std::fs::write(
            dir.path().join(".lit").join("marks.toml"),
            "[nb]\nlabel = \"custom bold\"\n\n[zz]\nlabel = \"custom code\"\n",
        )
        .unwrap();
        let config = merged_config(dir.path());
        // Overridden builtin.
        assert_eq!(config.0.get("nb").unwrap().label, "custom bold");
        // Unmodified builtin retained.
        assert!(config.0.contains_key("crux"));
        // Brand-new custom code included.
        assert_eq!(config.0.get("zz").unwrap().label, "custom code");
    }

    #[test]
    fn merged_config_no_override_equals_builtin() {
        let dir = tempfile::TempDir::new().unwrap();
        let config = merged_config(dir.path());
        let mut merged_keys: Vec<&String> = config.0.keys().collect();
        let mut builtin_keys: Vec<&String> = builtin_config().0.keys().collect();
        merged_keys.sort();
        builtin_keys.sort();
        assert_eq!(merged_keys, builtin_keys);
    }
}
