//! Per-workspace storage-mode IPC commands.
//!
//! Exposes the on-disk `.lit/config.json` `storage_mode` to the frontend so the
//! user can switch a workspace between Files and Db storage. The on-disk config
//! is the source of truth (matching what `build_backend_for_root` reads at
//! workspace-open time), so `get` reads the config rather than inferring from
//! the live backend variant.
//!
//! Phase 3 scope: `set_workspace_storage_mode` writes the config only. It does
//! NOT migrate page/asset content — `workspace::migration` does not exist yet
//! (Phase 4). The `MigrationSummary` shape is defined here now so the frontend
//! contract is stable across phases; Phase 4 will populate `migrated`/`phase`
//! for real and add the `lit:migration-progress` emit loop.

use crate::commands::workspace::{
    build_backend_for_root, get_workspace_backend, get_workspace_root, WorkspaceRegistry,
};
use crate::workspace::config::{read_config, StorageMode};
use crate::workspace::migration::{migrate, MigrationProgress};
use tauri::{Emitter, Manager, State};

/// Result of a storage-mode switch. `from`/`to` are the `"files"`/`"db"` string
/// union shared with the frontend. `migrated` is the number of pages affected;
/// `phase` is `"noop"` (no change), `"config_only"` (Phase 3 — config written,
/// no content moved) and will gain `"migrated"` in Phase 4.
#[derive(serde::Serialize, Clone, Debug, PartialEq)]
pub struct MigrationSummary {
    pub from: String,
    pub to: String,
    pub migrated: usize,
    pub phase: String,
}

/// Map a `StorageMode` to its frontend string form.
fn mode_str(m: StorageMode) -> &'static str {
    match m {
        StorageMode::Files => "files",
        StorageMode::Db => "db",
    }
}

/// Parse a frontend storage-mode string into a `StorageMode`, erroring (with a
/// descriptive message) on anything unrecognized.
pub(crate) fn parse_mode(s: &str) -> Result<StorageMode, String> {
    match s {
        "files" => Ok(StorageMode::Files),
        "db" => Ok(StorageMode::Db),
        other => Err(format!(
            "Unknown storage mode '{other}' (expected 'files' or 'db')"
        )),
    }
}

/// Pure summary builder for the no-op case (`target == current`). The non-noop
/// (real-migration) summary is built by [`migrated_summary`].
fn build_summary(current: StorageMode, target: StorageMode, _count: usize) -> MigrationSummary {
    MigrationSummary {
        from: mode_str(current).into(),
        to: mode_str(target).into(),
        migrated: 0,
        phase: "noop".into(),
    }
}

/// Pure summary builder for a completed migration. `count` is the number of
/// pages actually migrated (from `workspace::migration::migrate`).
fn migrated_summary(current: StorageMode, target: StorageMode, count: usize) -> MigrationSummary {
    MigrationSummary {
        from: mode_str(current).into(),
        to: mode_str(target).into(),
        migrated: count,
        phase: "migrated".into(),
    }
}

/// Read the current storage mode for the window's workspace from on-disk config.
#[tauri::command]
pub fn get_workspace_storage_mode(
    window: tauri::Window,
    state: State<WorkspaceRegistry>,
) -> Result<String, String> {
    let root = get_workspace_root(&state, window.label())?;
    let config = read_config(&root);
    Ok(mode_str(config.storage_mode).to_string())
}

/// Switch the window's workspace to `mode`, migrating page/asset content.
///
/// Phase 4: when the target differs from the current mode, this migrates all
/// content (Files<->DB) via `workspace::migration::migrate`, emitting
/// `lit:migration-progress` events to the calling window as it proceeds, then
/// refreshes the in-memory `WorkspaceEntry.backend` so any backend call before
/// the frontend's `reloadWorkspace()` already sees the new mode. Returns a
/// `MigrationSummary`. When the mode is unchanged this is a no-op.
#[tauri::command]
pub fn set_workspace_storage_mode(
    mode: String,
    window: tauri::Window,
    state: State<WorkspaceRegistry>,
) -> Result<MigrationSummary, String> {
    let target = parse_mode(&mode)?;
    let (root, _backend) = get_workspace_backend(&state, window.label())?;
    let current = read_config(&root).storage_mode;

    if current == target {
        return Ok(build_summary(current, target, 0));
    }

    // Emit progress to the calling window. Clone the handle + label by value so
    // the closure (passed by `&dyn Fn`) owns what it needs.
    let app = window.app_handle().clone();
    let label = window.label().to_string();
    let on_progress = move |p: MigrationProgress| {
        let _ = app.emit_to(label.as_str(), "lit:migration-progress", p);
    };

    // Migrate content AND write the new config (migrate writes config LAST).
    let migrated = migrate(&root, target, &on_progress).map_err(|e| e.to_string())?;

    // Refresh the in-memory backend so a stray backend call before the
    // frontend's reloadWorkspace() sees the new mode. reloadWorkspace() then
    // does the full re-open (watcher + graph rebuild) via open_workspace.
    let new_backend = build_backend_for_root(&root)?;
    {
        let mut ws = state.workspaces.lock().unwrap();
        if let Some(entry) = ws.get_mut(window.label()) {
            entry.backend = new_backend;
        }
    }

    Ok(migrated_summary(current, target, migrated))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::workspace::config::{write_config, WorkspaceConfig};

    #[test]
    fn parse_mode_accepts_files_and_db() {
        assert_eq!(parse_mode("files"), Ok(StorageMode::Files));
        assert_eq!(parse_mode("db"), Ok(StorageMode::Db));
    }

    #[test]
    fn parse_mode_rejects_unknown() {
        let err = parse_mode("sqlite");
        assert!(err.is_err());
        assert!(err.unwrap_err().contains("sqlite"));
    }

    #[test]
    fn mode_str_round_trips() {
        assert_eq!(mode_str(StorageMode::Files), "files");
        assert_eq!(mode_str(StorageMode::Db), "db");
        for m in [StorageMode::Files, StorageMode::Db] {
            assert_eq!(parse_mode(mode_str(m)), Ok(m));
        }
    }

    #[test]
    fn set_then_get_persists_via_config() {
        let dir = tempfile::tempdir().unwrap();
        write_config(
            dir.path(),
            &WorkspaceConfig {
                storage_mode: StorageMode::Files,
            },
        )
        .unwrap();
        assert_eq!(read_config(dir.path()).storage_mode, StorageMode::Files);

        write_config(
            dir.path(),
            &WorkspaceConfig {
                storage_mode: StorageMode::Db,
            },
        )
        .unwrap();
        assert_eq!(read_config(dir.path()).storage_mode, StorageMode::Db);
    }

    #[test]
    fn migration_summary_serializes_snake_case_strings() {
        let summary = MigrationSummary {
            from: "files".into(),
            to: "db".into(),
            migrated: 3,
            phase: "config_only".into(),
        };
        let value = serde_json::to_value(&summary).unwrap();
        assert_eq!(
            value,
            serde_json::json!({
                "from": "files",
                "to": "db",
                "migrated": 3,
                "phase": "config_only"
            })
        );
    }

    #[test]
    fn noop_summary_when_target_equals_current() {
        let noop = build_summary(StorageMode::Files, StorageMode::Files, 7);
        assert_eq!(noop.phase, "noop");
        assert_eq!(noop.migrated, 0);
        assert_eq!(noop.from, "files");
        assert_eq!(noop.to, "files");
    }

    #[test]
    fn migrated_summary_carries_migrated_phase_and_count() {
        let s = migrated_summary(StorageMode::Files, StorageMode::Db, 5);
        assert_eq!(s.phase, "migrated");
        assert_eq!(s.migrated, 5);
        assert_eq!(s.from, "files");
        assert_eq!(s.to, "db");
    }
}
