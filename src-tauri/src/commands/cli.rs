use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::Path;
use std::process::Command;
use tauri::Manager;

use crate::cli;

#[tauri::command]
pub fn install_cli(app_handle: tauri::AppHandle) -> Result<(), String> {
    let binary = app_handle
        .path()
        .resource_dir()
        .map_err(|e| e.to_string())?;
    let app_binary = binary
        .parent()
        .unwrap_or(&binary)
        .join("MacOS")
        .join("Lit");
    let app_binary_str = app_binary.to_string_lossy();
    let script = cli::generate_cli_script(&app_binary_str);
    let target = cli::cli_script_path();

    write_cli_script(&target, &script)
}

fn write_cli_script(target: &Path, script: &str) -> Result<(), String> {
    match fs::write(target, script) {
        Ok(()) => {
            fs::set_permissions(target, fs::Permissions::from_mode(0o755))
                .map_err(|e| format!("Failed to set permissions: {e}"))?;
            Ok(())
        }
        Err(e) if e.kind() == std::io::ErrorKind::PermissionDenied => {
            let escaped_script = script.replace('\'', "'\\''");
            let cmd = format!(
                "echo '{}' > '{}' && chmod 755 '{}'",
                escaped_script,
                target.display(),
                target.display()
            );
            let status = Command::new("osascript")
                .args([
                    "-e",
                    &format!(
                        "do shell script \"{}\" with administrator privileges",
                        cmd.replace('\\', "\\\\").replace('"', "\\\"")
                    ),
                ])
                .status()
                .map_err(|e| format!("Failed to run osascript: {e}"))?;

            if status.success() {
                Ok(())
            } else {
                Err("User cancelled privilege escalation".to_string())
            }
        }
        Err(e) => Err(format!("Failed to write CLI script: {e}")),
    }
}

#[tauri::command]
pub fn uninstall_cli() -> Result<(), String> {
    let target = cli::cli_script_path();
    if target.exists() {
        fs::remove_file(&target).map_err(|e| format!("Failed to remove CLI script: {e}"))?;
    }
    Ok(())
}

#[tauri::command]
pub fn is_cli_installed() -> bool {
    cli::cli_script_path().exists()
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn write_cli_script_creates_file_with_correct_content() {
        let dir = TempDir::new().unwrap();
        let target = dir.path().join("lit");
        let script = "#!/bin/bash\necho hello\n";

        write_cli_script(&target, script).unwrap();

        let content = fs::read_to_string(&target).unwrap();
        assert_eq!(content, script);
    }

    #[test]
    fn write_cli_script_sets_executable_permissions() {
        let dir = TempDir::new().unwrap();
        let target = dir.path().join("lit");
        let script = "#!/bin/bash\necho hello\n";

        write_cli_script(&target, script).unwrap();

        let perms = fs::metadata(&target).unwrap().permissions();
        assert_eq!(perms.mode() & 0o777, 0o755);
    }

    #[test]
    fn is_cli_installed_returns_false_when_missing() {
        assert!(!Path::new("/usr/local/bin/_lit_test_nonexistent").exists());
    }
}
