use super::WorkspaceError;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum StorageMode {
    #[default]
    Files,
    Db,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct WorkspaceConfig {
    #[serde(default)]
    pub storage_mode: StorageMode,
}

fn config_path(root: &Path) -> PathBuf {
    root.join(".lit").join("config.json")
}

/// Reads the workspace config from `<root>/.lit/config.json`.
///
/// Returns `WorkspaceConfig::default()` when the file is absent, unreadable, or
/// unparseable (forward-compatible / robust, mirroring `marks::read_marks`).
pub fn read_config(root: &Path) -> WorkspaceConfig {
    let path = config_path(root);
    if !path.exists() {
        return WorkspaceConfig::default();
    }
    let data = match fs::read_to_string(&path) {
        Ok(d) => d,
        Err(_) => return WorkspaceConfig::default(),
    };
    serde_json::from_str(&data).unwrap_or_default()
}

/// Atomically writes the workspace config to `<root>/.lit/config.json` via the
/// canonical tmp+rename pattern (mirrors `trash::write_manifest`).
pub fn write_config(root: &Path, config: &WorkspaceConfig) -> Result<(), WorkspaceError> {
    let lit_dir = root.join(".lit");
    fs::create_dir_all(&lit_dir)?;
    let tmp_path = lit_dir.join("config.json.tmp");
    let config_file = lit_dir.join("config.json");
    let json = serde_json::to_string_pretty(config)
        .map_err(|e| WorkspaceError::ParseError(e.to_string()))?;
    fs::write(&tmp_path, json)?;
    fs::rename(&tmp_path, &config_file)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn read_config_missing_returns_files_default() {
        let dir = TempDir::new().unwrap();
        let config = read_config(dir.path());
        assert_eq!(config.storage_mode, StorageMode::Files);
    }

    #[test]
    fn storage_mode_default_is_files() {
        assert_eq!(StorageMode::default(), StorageMode::Files);
    }

    #[test]
    fn write_then_read_round_trips_db_mode() {
        let dir = TempDir::new().unwrap();
        let config = WorkspaceConfig {
            storage_mode: StorageMode::Db,
        };
        write_config(dir.path(), &config).unwrap();
        let read = read_config(dir.path());
        assert_eq!(read.storage_mode, StorageMode::Db);
    }

    #[test]
    fn write_config_creates_lit_dir_and_leaves_no_tmp() {
        let dir = TempDir::new().unwrap();
        // .lit does not exist yet
        assert!(!dir.path().join(".lit").exists());
        write_config(dir.path(), &WorkspaceConfig::default()).unwrap();
        assert!(dir.path().join(".lit").join("config.json").exists());
        assert!(!dir.path().join(".lit").join("config.json.tmp").exists());
    }

    #[test]
    fn storage_mode_serializes_lowercase() {
        assert_eq!(serde_json::to_string(&StorageMode::Files).unwrap(), "\"files\"");
        assert_eq!(serde_json::to_string(&StorageMode::Db).unwrap(), "\"db\"");
        let rt: StorageMode = serde_json::from_str("\"db\"").unwrap();
        assert_eq!(rt, StorageMode::Db);
        let rt2: StorageMode = serde_json::from_str("\"files\"").unwrap();
        assert_eq!(rt2, StorageMode::Files);
    }

    #[test]
    fn config_with_unknown_keys_still_deserializes() {
        let dir = TempDir::new().unwrap();
        let lit = dir.path().join(".lit");
        fs::create_dir_all(&lit).unwrap();
        fs::write(
            lit.join("config.json"),
            r#"{"storage_mode":"db","future_field":42}"#,
        )
        .unwrap();
        let config = read_config(dir.path());
        assert_eq!(config.storage_mode, StorageMode::Db);
    }

    #[test]
    fn read_config_malformed_returns_default() {
        let dir = TempDir::new().unwrap();
        let lit = dir.path().join(".lit");
        fs::create_dir_all(&lit).unwrap();
        fs::write(lit.join("config.json"), "this is not json {{{").unwrap();
        let config = read_config(dir.path());
        assert_eq!(config.storage_mode, StorageMode::Files);
    }
}
