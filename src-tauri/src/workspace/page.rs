use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PageMeta {
    pub title: String,
    pub relative_path: String,
    pub frontmatter: HashMap<String, serde_yaml::Value>,
    pub created_at: Option<u64>,
    pub modified_at: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PageContent {
    pub meta: PageMeta,
    pub body: String,
}
