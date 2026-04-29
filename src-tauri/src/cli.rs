use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Default, PartialEq)]
pub struct PositionSuffix {
    pub line: Option<u32>,
    pub col: Option<u32>,
}

#[derive(Debug)]
pub enum CliTarget {
    Directory(PathBuf),
    File {
        workspace: PathBuf,
        file: String,
        line: Option<u32>,
        col: Option<u32>,
    },
    Invalid(String),
}

pub fn parse_position_suffix(arg: &str) -> (&str, PositionSuffix) {
    if let Some((rest, last)) = arg.rsplit_once(':') {
        if let Ok(n) = last.parse::<u32>() {
            if let Some((path, mid)) = rest.rsplit_once(':') {
                if let Ok(line) = mid.parse::<u32>() {
                    if line > 0 {
                        return (
                            path,
                            PositionSuffix {
                                line: Some(line),
                                col: Some(n),
                            },
                        );
                    }
                    // line == 0 is invalid even with a col present
                    return (arg, PositionSuffix::default());
                }
            }
            if n > 0 {
                return (
                    rest,
                    PositionSuffix {
                        line: Some(n),
                        col: None,
                    },
                );
            }
        }
    }
    (arg, PositionSuffix::default())
}

fn expand_tilde(path_str: &str) -> String {
    if path_str == "~" {
        if let Some(home) = std::env::var_os("HOME") {
            return home.to_string_lossy().to_string();
        }
    } else if let Some(rest) = path_str.strip_prefix("~/") {
        if let Some(home) = std::env::var_os("HOME") {
            return format!("{}/{}", home.to_string_lossy(), rest);
        }
    }
    path_str.to_string()
}

fn make_absolute(path_str: &str, cwd: &str) -> PathBuf {
    let expanded = expand_tilde(path_str);
    let p = PathBuf::from(&expanded);
    if p.is_absolute() {
        p
    } else {
        PathBuf::from(cwd).join(&expanded)
    }
}

fn classify(
    canonical: PathBuf,
    line: Option<u32>,
    col: Option<u32>,
) -> CliTarget {
    if canonical.is_dir() {
        CliTarget::Directory(canonical)
    } else if canonical.is_file() {
        let workspace = canonical.parent().unwrap().to_path_buf();
        let file = canonical
            .file_name()
            .unwrap()
            .to_string_lossy()
            .to_string();
        CliTarget::File {
            workspace,
            file,
            line,
            col,
        }
    } else {
        CliTarget::Invalid(canonical.to_string_lossy().to_string())
    }
}

pub fn resolve_arg(arg: &str, cwd: &str) -> CliTarget {
    let full_path = make_absolute(arg, cwd);
    if let Ok(canonical) = full_path.canonicalize() {
        return classify(canonical, None, None);
    }

    let (path_str, pos) = parse_position_suffix(arg);
    if pos.line.is_some() {
        let stripped_path = make_absolute(path_str, cwd);
        if let Ok(canonical) = stripped_path.canonicalize() {
            return classify(canonical, pos.line, pos.col);
        }
    }

    CliTarget::Invalid(arg.to_string())
}

pub fn process_instance_args(args: &[String], cwd: &str) -> Option<CliTarget> {
    let user_arg = args.get(1)?;
    if user_arg.is_empty() {
        return None;
    }
    Some(resolve_arg(user_arg, cwd))
}

pub fn generate_cli_script(macos_dir: &str) -> String {
    format!(
        r#"#!/bin/bash
# Lit command-line launcher
# Opens files and directories in the Lit app

"{}/lit-cli" "$@"
"#,
        macos_dir
    )
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SocketRequest {
    pub action: String,
    pub path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub line: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub col: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SocketResponse {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

pub fn socket_path() -> PathBuf {
    if let Some(home) = std::env::var_os("HOME") {
        PathBuf::from(home)
            .join("Library/Application Support/com.lit.app/lit.sock")
    } else {
        PathBuf::from("/tmp/com.lit.app/lit.sock")
    }
}

pub fn cli_target_to_socket_request(target: &CliTarget) -> Option<SocketRequest> {
    match target {
        CliTarget::Directory(path) => Some(SocketRequest {
            action: "open".to_string(),
            path: path.to_string_lossy().to_string(),
            line: None,
            col: None,
        }),
        CliTarget::File {
            workspace,
            file,
            line,
            col,
        } => Some(SocketRequest {
            action: "open".to_string(),
            path: workspace.join(file).to_string_lossy().to_string(),
            line: *line,
            col: *col,
        }),
        CliTarget::Invalid(_) => None,
    }
}

pub fn cli_script_path() -> PathBuf {
    PathBuf::from("/usr/local/bin/lit")
}

pub fn cli_init_script(
    workspace: &Option<String>,
    file: &Option<String>,
    line: &Option<u32>,
    col: &Option<u32>,
) -> Option<String> {
    if workspace.is_none() && file.is_none() {
        return None;
    }
    Some(format!(
        "window.__LIT_CLI__ = {};",
        serde_json::json!({ "workspace": workspace, "file": file, "line": line, "col": col })
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn parse_position_suffix_line_and_col() {
        let (path, pos) = parse_position_suffix("notes.md:10:5");
        assert_eq!(path, "notes.md");
        assert_eq!(pos.line, Some(10));
        assert_eq!(pos.col, Some(5));
    }

    #[test]
    fn parse_position_suffix_line_only() {
        let (path, pos) = parse_position_suffix("notes.md:10");
        assert_eq!(path, "notes.md");
        assert_eq!(pos.line, Some(10));
        assert_eq!(pos.col, None);
    }

    #[test]
    fn parse_position_suffix_no_suffix() {
        let (path, pos) = parse_position_suffix("notes.md");
        assert_eq!(path, "notes.md");
        assert_eq!(pos, PositionSuffix::default());
    }

    #[test]
    fn parse_position_suffix_non_numeric() {
        let (path, pos) = parse_position_suffix("notes.md:abc");
        assert_eq!(path, "notes.md:abc");
        assert_eq!(pos, PositionSuffix::default());
    }

    #[test]
    fn parse_position_suffix_line_zero() {
        let (path, pos) = parse_position_suffix("notes.md:0");
        assert_eq!(path, "notes.md:0");
        assert_eq!(pos, PositionSuffix::default());
    }

    #[test]
    fn parse_position_suffix_line_zero_with_col() {
        let (path, pos) = parse_position_suffix("notes.md:0:5");
        assert_eq!(path, "notes.md:0:5");
        assert_eq!(pos, PositionSuffix::default());
    }

    #[test]
    fn parse_position_suffix_col_zero() {
        let (path, pos) = parse_position_suffix("notes.md:10:0");
        assert_eq!(path, "notes.md");
        assert_eq!(pos.line, Some(10));
        assert_eq!(pos.col, Some(0));
    }

    #[test]
    fn resolve_arg_absolute_dir() {
        let result = resolve_arg("/tmp", "/");
        match result {
            CliTarget::Directory(p) => {
                assert!(p.is_dir());
                assert!(p.is_absolute());
            }
            other => panic!("Expected Directory, got {:?}", other),
        }
    }

    #[test]
    fn resolve_arg_relative_dir() {
        let result = resolve_arg(".", "/tmp");
        match result {
            CliTarget::Directory(p) => {
                assert!(p.is_dir());
                assert!(p.is_absolute());
            }
            other => panic!("Expected Directory, got {:?}", other),
        }
    }

    #[test]
    fn resolve_arg_absolute_file() {
        let dir = tempfile::tempdir().unwrap();
        let file_path = dir.path().join("test.md");
        fs::write(&file_path, "hello").unwrap();

        let result = resolve_arg(file_path.to_str().unwrap(), "/");
        match result {
            CliTarget::File {
                workspace, file, ..
            } => {
                assert_eq!(workspace, dir.path().canonicalize().unwrap());
                assert_eq!(file, "test.md");
            }
            other => panic!("Expected File, got {:?}", other),
        }
    }

    #[test]
    fn resolve_arg_relative_file() {
        let dir = tempfile::tempdir().unwrap();
        let file_path = dir.path().join("test.md");
        fs::write(&file_path, "hello").unwrap();

        let result = resolve_arg("test.md", dir.path().to_str().unwrap());
        match result {
            CliTarget::File {
                workspace, file, ..
            } => {
                assert_eq!(workspace, dir.path().canonicalize().unwrap());
                assert_eq!(file, "test.md");
            }
            other => panic!("Expected File, got {:?}", other),
        }
    }

    #[test]
    fn resolve_arg_nonexistent() {
        let result = resolve_arg("/nonexistent_path_12345", "/");
        match result {
            CliTarget::Invalid(s) => assert_eq!(s, "/nonexistent_path_12345"),
            other => panic!("Expected Invalid, got {:?}", other),
        }
    }

    #[test]
    fn resolve_arg_with_line_and_col() {
        let dir = tempfile::tempdir().unwrap();
        let file_path = dir.path().join("test.md");
        fs::write(&file_path, "hello").unwrap();

        let arg = format!("{}:10:5", file_path.to_str().unwrap());
        let result = resolve_arg(&arg, "/");
        match result {
            CliTarget::File {
                workspace,
                file,
                line,
                col,
            } => {
                assert_eq!(workspace, dir.path().canonicalize().unwrap());
                assert_eq!(file, "test.md");
                assert_eq!(line, Some(10));
                assert_eq!(col, Some(5));
            }
            other => panic!("Expected File with position, got {:?}", other),
        }
    }

    #[test]
    fn resolve_arg_with_line_only() {
        let dir = tempfile::tempdir().unwrap();
        let file_path = dir.path().join("test.md");
        fs::write(&file_path, "hello").unwrap();

        let arg = format!("{}:42", file_path.to_str().unwrap());
        let result = resolve_arg(&arg, "/");
        match result {
            CliTarget::File {
                file, line, col, ..
            } => {
                assert_eq!(file, "test.md");
                assert_eq!(line, Some(42));
                assert_eq!(col, None);
            }
            other => panic!("Expected File with line, got {:?}", other),
        }
    }

    #[test]
    fn resolve_arg_file_with_colon_in_name() {
        let dir = tempfile::tempdir().unwrap();
        let file_path = dir.path().join("notes.md:10");
        fs::write(&file_path, "hello").unwrap();

        let result = resolve_arg(file_path.to_str().unwrap(), "/");
        match result {
            CliTarget::File {
                file, line, col, ..
            } => {
                assert_eq!(file, "notes.md:10");
                assert_eq!(line, None);
                assert_eq!(col, None);
            }
            other => panic!("Expected File without position, got {:?}", other),
        }
    }

    #[test]
    fn process_instance_args_no_user_args() {
        let args = vec!["/path/to/binary".to_string()];
        assert!(process_instance_args(&args, "/").is_none());
    }

    #[test]
    fn process_instance_args_empty_arg() {
        let args = vec!["/path/to/binary".to_string(), String::new()];
        assert!(process_instance_args(&args, "/").is_none());
    }

    #[test]
    fn process_instance_args_with_dir() {
        let args = vec!["/path/to/binary".to_string(), "/tmp".to_string()];
        let result = process_instance_args(&args, "/");
        assert!(result.is_some());
        match result.unwrap() {
            CliTarget::Directory(p) => assert!(p.is_dir()),
            other => panic!("Expected Directory, got {:?}", other),
        }
    }

    #[test]
    fn generate_cli_script_content() {
        let script = generate_cli_script("/Applications/Lit.app/Contents/MacOS");
        assert!(script.starts_with("#!/bin/bash"));
        assert!(script.contains("/Applications/Lit.app/Contents/MacOS/lit-cli"));
        assert!(script.contains("\"$@\""));
    }

    #[test]
    fn cli_script_path_is_correct() {
        assert_eq!(cli_script_path(), PathBuf::from("/usr/local/bin/lit"));
    }

    #[test]
    fn test_expand_tilde_home_prefix() {
        let home = std::env::var("HOME").unwrap();
        assert_eq!(expand_tilde("~/Documents/foo.md"), format!("{}/Documents/foo.md", home));
    }

    #[test]
    fn test_expand_tilde_bare() {
        let home = std::env::var("HOME").unwrap();
        assert_eq!(expand_tilde("~"), home);
    }

    #[test]
    fn test_expand_tilde_no_tilde() {
        assert_eq!(expand_tilde("/absolute/path"), "/absolute/path");
    }

    #[test]
    fn test_expand_tilde_mid_path() {
        assert_eq!(expand_tilde("/foo/~/bar"), "/foo/~/bar");
    }

    #[test]
    fn test_resolve_arg_tilde_file() {
        let home = std::env::var("HOME").unwrap();
        let dir = tempfile::TempDir::new_in(&home).unwrap();
        let file_path = dir.path().join("test.md");
        fs::write(&file_path, "hello").unwrap();

        let relative = file_path.strip_prefix(&home).unwrap();
        let tilde_path = format!("~/{}", relative.to_str().unwrap());

        let result = resolve_arg(&tilde_path, "/nonexistent");
        match result {
            CliTarget::File { file, .. } => {
                assert_eq!(file, "test.md");
            }
            other => panic!("Expected File, got {:?}", other),
        }
    }

    #[test]
    fn test_resolve_arg_tilde_directory() {
        let home = std::env::var("HOME").unwrap();
        let dir = tempfile::TempDir::new_in(&home).unwrap();

        let relative = dir.path().strip_prefix(&home).unwrap();
        let tilde_path = format!("~/{}", relative.to_str().unwrap());

        let result = resolve_arg(&tilde_path, "/nonexistent");
        match result {
            CliTarget::Directory(p) => {
                assert!(p.is_dir());
            }
            other => panic!("Expected Directory, got {:?}", other),
        }
    }

    #[test]
    fn test_socket_request_serialize() {
        let req = SocketRequest {
            action: "open".to_string(),
            path: "/tmp/test.md".to_string(),
            line: Some(10),
            col: Some(5),
        };
        let json = serde_json::to_string(&req).unwrap();
        let roundtrip: SocketRequest = serde_json::from_str(&json).unwrap();
        assert_eq!(req, roundtrip);
    }

    #[test]
    fn test_socket_request_deserialize_minimal() {
        let json = r#"{"action":"open","path":"/tmp/test.md"}"#;
        let req: SocketRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.action, "open");
        assert_eq!(req.path, "/tmp/test.md");
        assert_eq!(req.line, None);
        assert_eq!(req.col, None);
    }

    #[test]
    fn test_socket_response_serialize_ok() {
        let resp = SocketResponse {
            ok: true,
            error: None,
        };
        let json = serde_json::to_string(&resp).unwrap();
        assert_eq!(json, r#"{"ok":true}"#);
    }

    #[test]
    fn test_socket_response_serialize_error() {
        let resp = SocketResponse {
            ok: false,
            error: Some("not found".to_string()),
        };
        let json = serde_json::to_string(&resp).unwrap();
        let roundtrip: SocketResponse = serde_json::from_str(&json).unwrap();
        assert_eq!(roundtrip.ok, false);
        assert_eq!(roundtrip.error, Some("not found".to_string()));
    }

    #[test]
    fn test_socket_path_ends_with_expected_suffix() {
        let path = socket_path();
        assert!(path.ends_with("com.lit.app/lit.sock"));
    }

    #[test]
    fn test_cli_target_to_socket_request_file() {
        let dir = tempfile::tempdir().unwrap();
        let target = CliTarget::File {
            workspace: dir.path().to_path_buf(),
            file: "note.md".to_string(),
            line: Some(10),
            col: Some(5),
        };
        let req = cli_target_to_socket_request(&target).unwrap();
        assert_eq!(req.action, "open");
        assert!(req.path.ends_with("note.md"));
        assert_eq!(req.line, Some(10));
        assert_eq!(req.col, Some(5));
    }

    #[test]
    fn test_cli_target_to_socket_request_directory() {
        let target = CliTarget::Directory(PathBuf::from("/tmp/mydir"));
        let req = cli_target_to_socket_request(&target).unwrap();
        assert_eq!(req.action, "open");
        assert_eq!(req.path, "/tmp/mydir");
        assert_eq!(req.line, None);
        assert_eq!(req.col, None);
    }

    #[test]
    fn test_cli_target_to_socket_request_invalid() {
        let target = CliTarget::Invalid("bad".to_string());
        assert!(cli_target_to_socket_request(&target).is_none());
    }
}
