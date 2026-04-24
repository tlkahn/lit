pub fn build_args(template: &str, file: &str, line: u32, col: u32) -> Vec<String> {
    let trimmed = template.trim();
    if trimmed.is_empty() {
        return vec![file.to_string()];
    }

    trimmed
        .split_whitespace()
        .map(|token| {
            token
                .replace("{file}", file)
                .replace("{line}", &line.to_string())
                .replace("{col}", &col.to_string())
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn file_only_template() {
        assert_eq!(
            build_args("{file}", "/workspace/notes.md", 1, 1),
            vec!["/workspace/notes.md"]
        );
    }

    #[test]
    fn sublime_template() {
        assert_eq!(
            build_args("{file}:{line}:{col}", "/workspace/notes.md", 10, 5),
            vec!["/workspace/notes.md:10:5"]
        );
    }

    #[test]
    fn vscode_template() {
        assert_eq!(
            build_args("--goto {file}:{line}:{col}", "/w/n.md", 3, 7),
            vec!["--goto", "/w/n.md:3:7"]
        );
    }

    #[test]
    fn vim_template() {
        assert_eq!(
            build_args("+{line} {file}", "/w/n.md", 42, 1),
            vec!["+42", "/w/n.md"]
        );
    }

    #[test]
    fn empty_template_falls_back_to_file() {
        assert_eq!(
            build_args("", "/w/n.md", 1, 1),
            vec!["/w/n.md"]
        );
    }

    #[test]
    fn multi_flag_template() {
        assert_eq!(
            build_args("--line {line} --col {col} {file}", "/a.md", 5, 3),
            vec!["--line", "5", "--col", "3", "/a.md"]
        );
    }
}
