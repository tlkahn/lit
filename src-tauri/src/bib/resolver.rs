use std::path::{Path, PathBuf};

pub fn extract_bibliography_field(
    frontmatter: Option<&serde_json::Map<String, serde_json::Value>>,
) -> Vec<String> {
    let Some(fm) = frontmatter else { return Vec::new() };
    let Some(bib) = fm.get("bibliography") else { return Vec::new() };

    if let Some(s) = bib.as_str() {
        return vec![s.to_string()];
    }
    if let Some(arr) = bib.as_array() {
        return arr
            .iter()
            .filter_map(|v| v.as_str().map(String::from))
            .collect();
    }
    Vec::new()
}

pub fn resolve_bib_paths(bib_paths: &[String], note_dir: &Path) -> Vec<PathBuf> {
    bib_paths
        .iter()
        .map(|p| {
            let joined = note_dir.join(p);
            normalize_path(&joined)
        })
        .collect()
}

fn normalize_path(path: &Path) -> PathBuf {
    let mut result = Vec::new();
    for component in path.components() {
        match component {
            std::path::Component::ParentDir => {
                result.pop();
            }
            std::path::Component::CurDir => {}
            c => result.push(c.as_os_str().to_owned()),
        }
    }
    result.iter().collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn extract_single_string_bibliography() {
        let mut fm = serde_json::Map::new();
        fm.insert("bibliography".to_string(), json!("refs.bib"));
        assert_eq!(extract_bibliography_field(Some(&fm)), vec!["refs.bib"]);
    }

    #[test]
    fn extract_array_bibliography() {
        let mut fm = serde_json::Map::new();
        fm.insert("bibliography".to_string(), json!(["a.bib", "b.bib"]));
        assert_eq!(
            extract_bibliography_field(Some(&fm)),
            vec!["a.bib", "b.bib"]
        );
    }

    #[test]
    fn no_bibliography_field() {
        let fm = serde_json::Map::new();
        assert!(extract_bibliography_field(Some(&fm)).is_empty());
        assert!(extract_bibliography_field(None).is_empty());
    }

    #[test]
    fn non_string_bibliography_values() {
        let mut fm = serde_json::Map::new();
        fm.insert("bibliography".to_string(), json!(42));
        assert!(extract_bibliography_field(Some(&fm)).is_empty());

        fm.insert("bibliography".to_string(), serde_json::Value::Null);
        assert!(extract_bibliography_field(Some(&fm)).is_empty());
    }

    #[test]
    fn resolve_relative_path() {
        let result = resolve_bib_paths(&["refs.bib".to_string()], Path::new("papers/notes"));
        assert_eq!(result, vec![PathBuf::from("papers/notes/refs.bib")]);
    }

    #[test]
    fn resolve_from_root() {
        let result = resolve_bib_paths(&["refs.bib".to_string()], Path::new(""));
        assert_eq!(result, vec![PathBuf::from("refs.bib")]);
    }

    #[test]
    fn resolve_multiple_paths() {
        let result = resolve_bib_paths(
            &["a.bib".to_string(), "b.bib".to_string()],
            Path::new("dir"),
        );
        assert_eq!(
            result,
            vec![PathBuf::from("dir/a.bib"), PathBuf::from("dir/b.bib")]
        );
    }

    #[test]
    fn resolve_parent_directory() {
        let result =
            resolve_bib_paths(&["../shared/refs.bib".to_string()], Path::new("papers"));
        assert_eq!(result, vec![PathBuf::from("shared/refs.bib")]);
    }

    #[test]
    fn resolve_empty_input() {
        assert!(resolve_bib_paths(&[], Path::new("note")).is_empty());
    }
}
