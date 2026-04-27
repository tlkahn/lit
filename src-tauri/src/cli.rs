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
            if n == 0 {
                return (arg, PositionSuffix::default());
            }
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
                }
            }
            return (
                rest,
                PositionSuffix {
                    line: Some(n),
                    col: None,
                },
            );
        }
    }
    (arg, PositionSuffix::default())
}

fn make_absolute(path_str: &str, cwd: &str) -> PathBuf {
    let p = PathBuf::from(path_str);
    if p.is_absolute() {
        p
    } else {
        PathBuf::from(cwd).join(path_str)
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

pub fn generate_cli_script(app_binary: &str) -> String {
    format!(
        r#"#!/bin/bash
# Lit command-line launcher
# Opens files and directories in the Lit app

"{}" "$@" &>/dev/null &
disown
"#,
        app_binary
    )
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

pub fn resolve_deep_link(url: &url::Url) -> Option<CliTarget> {
    if url.scheme() != "lit" {
        return None;
    }
    if url.host_str() != Some("open") {
        return None;
    }

    let pairs: std::collections::HashMap<_, _> = url.query_pairs().collect();
    let file_str = pairs.get("file")?;
    let path = PathBuf::from(file_str.as_ref());
    let canonical = path.canonicalize().ok()?;

    let line: Option<u32> = pairs.get("line").and_then(|v| v.parse().ok()).filter(|&n: &u32| n > 0);
    let col: Option<u32> = pairs.get("col").and_then(|v| v.parse().ok()).filter(|&n: &u32| n > 0);

    Some(classify(canonical, line, col))
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
        assert_eq!(path, "notes.md:0");
        assert_eq!(pos.line, Some(5));
        assert_eq!(pos.col, None);
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
        let script = generate_cli_script("/Applications/Lit.app/Contents/MacOS/Lit");
        assert!(script.starts_with("#!/bin/bash"));
        assert!(script.contains("/Applications/Lit.app/Contents/MacOS/Lit"));
        assert!(script.contains("&>/dev/null &"));
        assert!(script.contains("disown"));
        assert!(script.contains("\"$@\""));
    }

    #[test]
    fn cli_script_path_is_correct() {
        assert_eq!(cli_script_path(), PathBuf::from("/usr/local/bin/lit"));
    }

    #[test]
    fn resolve_deep_link_with_position() {
        let dir = tempfile::tempdir().unwrap();
        let file_path = dir.path().join("note.md");
        fs::write(&file_path, "hello").unwrap();

        let url_str = format!(
            "lit://open?file={}&line=10&col=5",
            file_path.to_str().unwrap()
        );
        let url = url::Url::parse(&url_str).unwrap();
        let result = resolve_deep_link(&url);
        match result {
            Some(CliTarget::File {
                file, line, col, ..
            }) => {
                assert_eq!(file, "note.md");
                assert_eq!(line, Some(10));
                assert_eq!(col, Some(5));
            }
            other => panic!("Expected File with position, got {:?}", other),
        }
    }

    #[test]
    fn resolve_deep_link_no_position() {
        let dir = tempfile::tempdir().unwrap();
        let file_path = dir.path().join("note.md");
        fs::write(&file_path, "hello").unwrap();

        let url_str = format!("lit://open?file={}", file_path.to_str().unwrap());
        let url = url::Url::parse(&url_str).unwrap();
        let result = resolve_deep_link(&url);
        match result {
            Some(CliTarget::File {
                file, line, col, ..
            }) => {
                assert_eq!(file, "note.md");
                assert_eq!(line, None);
                assert_eq!(col, None);
            }
            other => panic!("Expected File without position, got {:?}", other),
        }
    }

    #[test]
    fn resolve_deep_link_directory() {
        let dir = tempfile::tempdir().unwrap();
        let url_str = format!("lit://open?file={}", dir.path().to_str().unwrap());
        let url = url::Url::parse(&url_str).unwrap();
        let result = resolve_deep_link(&url);
        match result {
            Some(CliTarget::Directory(_)) => {}
            other => panic!("Expected Directory, got {:?}", other),
        }
    }

    #[test]
    fn resolve_deep_link_wrong_scheme() {
        let url = url::Url::parse("http://open?file=/tmp").unwrap();
        assert!(resolve_deep_link(&url).is_none());
    }

    #[test]
    fn resolve_deep_link_wrong_host() {
        let url = url::Url::parse("lit://close?file=/tmp").unwrap();
        assert!(resolve_deep_link(&url).is_none());
    }

    #[test]
    fn resolve_deep_link_nonexistent_file() {
        let url = url::Url::parse("lit://open?file=/nonexistent_path_12345/note.md").unwrap();
        assert!(resolve_deep_link(&url).is_none());
    }
}
