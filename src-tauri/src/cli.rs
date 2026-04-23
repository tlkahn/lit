use std::path::PathBuf;

#[derive(Debug)]
pub enum CliTarget {
    Directory(PathBuf),
    File { workspace: PathBuf, file: String },
    Invalid(String),
}

pub fn resolve_arg(arg: &str, cwd: &str) -> CliTarget {
    let path = if PathBuf::from(arg).is_absolute() {
        PathBuf::from(arg)
    } else {
        PathBuf::from(cwd).join(arg)
    };

    match path.canonicalize() {
        Ok(canonical) => {
            if canonical.is_dir() {
                CliTarget::Directory(canonical)
            } else if canonical.is_file() {
                let workspace = canonical.parent().unwrap().to_path_buf();
                let file = canonical.file_name().unwrap().to_string_lossy().to_string();
                CliTarget::File { workspace, file }
            } else {
                CliTarget::Invalid(arg.to_string())
            }
        }
        Err(_) => CliTarget::Invalid(arg.to_string()),
    }
}

pub fn process_instance_args(args: &[String], cwd: &str) -> Option<CliTarget> {
    // args[0] is the binary path, args[1] is the user's argument
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

exec "{}" "$@"
"#,
        app_binary
    )
}

pub fn cli_script_path() -> PathBuf {
    PathBuf::from("/usr/local/bin/lit")
}

pub fn cli_init_script(workspace: &Option<String>, file: &Option<String>) -> Option<String> {
    if workspace.is_none() && file.is_none() {
        return None;
    }
    Some(format!(
        "window.__LIT_CLI__ = {};",
        serde_json::json!({ "workspace": workspace, "file": file })
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

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
            CliTarget::File { workspace, file } => {
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
            CliTarget::File { workspace, file } => {
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
        assert!(script.contains("exec"));
        assert!(script.contains("\"$@\""));
    }

    #[test]
    fn cli_script_path_is_correct() {
        assert_eq!(cli_script_path(), PathBuf::from("/usr/local/bin/lit"));
    }
}
