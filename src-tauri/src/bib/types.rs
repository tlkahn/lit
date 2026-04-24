use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct BibEntry {
    pub key: String,
    pub authors: Vec<String>,
    pub title: String,
    pub year: String,
    pub entry_type: String,
    pub line_number: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bib_file: Option<String>,
}
