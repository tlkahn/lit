use std::collections::HashMap;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CardboxLayout {
    pub version: u32,
    pub order: Vec<String>,
    #[serde(default)]
    pub links: Vec<[String; 2]>,
    #[serde(default)]
    pub groups: HashMap<String, GroupInfo>,
    #[serde(default)]
    pub pinned: Vec<String>,
    #[serde(default)]
    pub notes: HashMap<String, CardNote>,
    #[serde(default)]
    pub colors: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CardNote {
    pub body: String,
    pub updated_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct GroupInfo {
    pub name: String,
    pub order: Vec<String>,
    pub collapsed: bool,
}

impl Default for CardboxLayout {
    fn default() -> Self {
        Self {
            version: 1,
            order: vec![],
            links: vec![],
            groups: HashMap::new(),
            pinned: vec![],
            notes: HashMap::new(),
            colors: HashMap::new(),
        }
    }
}

pub fn layout_path(workspace_root: &Path) -> PathBuf {
    workspace_root.join(".lit").join("cardbox.json")
}

pub fn load_layout(workspace_root: &Path) -> CardboxLayout {
    let path = layout_path(workspace_root);
    match std::fs::read_to_string(&path) {
        Ok(content) => serde_json::from_str::<CardboxLayout>(&content)
            .unwrap_or_default(),
        Err(_) => CardboxLayout::default(),
    }
}

pub fn load_layout_links(workspace_root: &Path) -> Vec<[String; 2]> {
    load_layout(workspace_root).links
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn missing_file_returns_default() {
        let dir = tempfile::tempdir().unwrap();
        let layout = load_layout(dir.path());
        assert_eq!(layout, CardboxLayout::default());
    }

    #[test]
    fn extracts_links() {
        let dir = tempfile::tempdir().unwrap();
        let lit_dir = dir.path().join(".lit");
        fs::create_dir_all(&lit_dir).unwrap();
        fs::write(
            lit_dir.join("cardbox.json"),
            r#"{"version":1,"order":[],"links":[["a","b"],["c","d"]]}"#,
        )
        .unwrap();

        let links = load_layout_links(dir.path());
        assert_eq!(links, vec![["a".to_string(), "b".to_string()], ["c".to_string(), "d".to_string()]]);
    }

    #[test]
    fn layout_path_is_canonical() {
        let root = std::path::Path::new("/workspace");
        assert_eq!(layout_path(root), root.join(".lit").join("cardbox.json"));
    }
}
