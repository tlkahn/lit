use serde::{Deserialize, Serialize};
use indexmap::IndexMap;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FileType {
    Markdown,
    Pdf,
    Code,
}

impl Default for FileType {
    fn default() -> Self {
        FileType::Markdown
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PageMeta {
    pub title: String,
    pub relative_path: String,
    pub frontmatter: IndexMap<String, serde_yaml::Value>,
    pub created_at: Option<u64>,
    pub modified_at: Option<u64>,
    #[serde(default)]
    pub file_type: FileType,
    #[serde(default)]
    pub has_companion: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PageContent {
    pub meta: PageMeta,
    pub body: String,
    pub raw_yaml: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CodeFileContent {
    pub title: String,
    pub relative_path: String,
    pub body: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn file_type_serializes_to_lowercase() {
        assert_eq!(serde_json::to_string(&FileType::Markdown).unwrap(), "\"markdown\"");
        assert_eq!(serde_json::to_string(&FileType::Pdf).unwrap(), "\"pdf\"");
        let rt: FileType = serde_json::from_str("\"pdf\"").unwrap();
        assert_eq!(rt, FileType::Pdf);
        let rt2: FileType = serde_json::from_str("\"markdown\"").unwrap();
        assert_eq!(rt2, FileType::Markdown);
    }

    #[test]
    fn file_type_code_serializes_to_lowercase() {
        assert_eq!(serde_json::to_string(&FileType::Code).unwrap(), "\"code\"");
        let rt: FileType = serde_json::from_str("\"code\"").unwrap();
        assert_eq!(rt, FileType::Code);
    }

    #[test]
    fn code_file_content_serializes() {
        let content = CodeFileContent {
            title: "refs".to_string(),
            relative_path: "refs.bib".to_string(),
            body: "@article{key}".to_string(),
        };
        let json = serde_json::to_string(&content).unwrap();
        assert!(json.contains("\"body\""));
        assert!(json.contains("\"relative_path\""));
        assert!(json.contains("\"title\""));
        assert!(!json.contains("\"frontmatter\""));
        assert!(!json.contains("\"raw_yaml\""));
        assert!(!json.contains("\"file_type\""));
    }

    #[test]
    fn file_type_default_is_markdown() {
        assert_eq!(FileType::default(), FileType::Markdown);
    }

    #[test]
    fn page_meta_includes_file_type_in_json() {
        let meta = PageMeta {
            title: "test".to_string(),
            relative_path: "test.pdf".to_string(),
            frontmatter: IndexMap::new(),
            created_at: None,
            modified_at: None,
            file_type: FileType::Pdf,
            has_companion: false,
        };
        let json = serde_json::to_string(&meta).unwrap();
        assert!(json.contains("\"file_type\":\"pdf\""));

        // backward compat: deserializing without file_type yields Markdown
        let json_no_ft = r#"{"title":"t","relative_path":"t.md","frontmatter":{},"created_at":null,"modified_at":null}"#;
        let meta2: PageMeta = serde_json::from_str(json_no_ft).unwrap();
        assert_eq!(meta2.file_type, FileType::Markdown);
    }
}
