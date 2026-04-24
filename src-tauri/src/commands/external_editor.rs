use std::process::{Command, Stdio};
use tauri::State;

use crate::external_editor::build_args;
use crate::preferences::{read_preferences, Preferences};

use super::workspace::{get_workspace_root, WorkspaceRegistry};

pub fn resolve_editor_config(prefs: &Preferences) -> Option<(String, String)> {
    let editor = prefs
        .extra
        .get("editor.externalEditor")
        .and_then(|v| v.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())?;

    let args = prefs
        .extra
        .get("editor.externalEditor.args")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .unwrap_or_else(|| "{file}".to_string());

    Some((editor, args))
}

#[tauri::command]
pub fn open_in_external_editor(
    relative_path: String,
    line: u32,
    col: u32,
    window: tauri::Window,
    state: State<WorkspaceRegistry>,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    let root = get_workspace_root(&state, window.label())?;
    let full_path = root.join(&relative_path);
    let file_str = full_path.to_string_lossy().to_string();

    let prefs = read_preferences(&app_handle);
    let (editor, template) =
        resolve_editor_config(&prefs).ok_or("No external editor configured. Set \"editor.externalEditor\" in preferences.")?;

    let args = build_args(&template, &file_str, line, col);

    Command::new(&editor)
        .args(&args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("Failed to launch editor '{}': {}", editor, e))?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn prefs_from_json(json: &str) -> Preferences {
        serde_json::from_str(json).unwrap()
    }

    #[test]
    fn resolve_returns_none_for_default_prefs() {
        let prefs = Preferences::default();
        assert!(resolve_editor_config(&prefs).is_none());
    }

    #[test]
    fn resolve_returns_editor_with_default_args() {
        let prefs = prefs_from_json(r#"{"editor.externalEditor": "/usr/local/bin/subl"}"#);
        let (editor, args) = resolve_editor_config(&prefs).unwrap();
        assert_eq!(editor, "/usr/local/bin/subl");
        assert_eq!(args, "{file}");
    }

    #[test]
    fn resolve_returns_editor_and_custom_args() {
        let prefs = prefs_from_json(
            r#"{"editor.externalEditor": "subl", "editor.externalEditor.args": "{file}:{line}:{col}"}"#,
        );
        let (editor, args) = resolve_editor_config(&prefs).unwrap();
        assert_eq!(editor, "subl");
        assert_eq!(args, "{file}:{line}:{col}");
    }

    #[test]
    fn resolve_returns_none_for_empty_editor() {
        let prefs = prefs_from_json(r#"{"editor.externalEditor": ""}"#);
        assert!(resolve_editor_config(&prefs).is_none());
    }

    #[test]
    fn resolve_returns_none_for_whitespace_editor() {
        let prefs = prefs_from_json(r#"{"editor.externalEditor": "  "}"#);
        assert!(resolve_editor_config(&prefs).is_none());
    }
}
