use serde::{Deserialize, Serialize};
use std::fmt;

/// Extensible enum for reference types.
/// Built-in types cover pandoc-crossref standard.
/// Custom types allow user-defined extensions (thm, def, lem, etc.)
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RefType {
    Fig,
    Tbl,
    Sec,
    Eq,
    Lst,
    Custom(String),
}

impl RefType {
    pub fn prefix_str(&self) -> &str {
        match self {
            RefType::Fig => "fig",
            RefType::Tbl => "tbl",
            RefType::Sec => "sec",
            RefType::Eq => "eq",
            RefType::Lst => "lst",
            RefType::Custom(s) => s.as_str(),
        }
    }

    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            "fig" => Some(RefType::Fig),
            "tbl" => Some(RefType::Tbl),
            "sec" => Some(RefType::Sec),
            "eq" => Some(RefType::Eq),
            "lst" => Some(RefType::Lst),
            _ => Some(RefType::Custom(s.to_string())),
        }
    }
}

impl fmt::Display for RefType {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.prefix_str())
    }
}

/// Numbering scheme for definitions.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum RefNumber {
    /// Simple sequential number: "3"
    Simple(u32),
    /// Sub-numbered with letter suffix: "3a"
    SubNumbered(u32, char),
    /// Hierarchical dot-separated: "1.2.3"
    Hierarchical(Vec<u32>),
}

impl RefNumber {
    pub fn display(&self) -> String {
        match self {
            RefNumber::Simple(n) => n.to_string(),
            RefNumber::SubNumbered(n, c) => format!("{}{}", n, c),
            RefNumber::Hierarchical(levels) => {
                levels
                    .iter()
                    .map(|n| n.to_string())
                    .collect::<Vec<_>>()
                    .join(".")
            }
        }
    }

    /// Extract a sortable integer for consecutive range detection.
    /// Returns None for hierarchical numbers (ranges don't apply).
    pub fn as_sortable_u32(&self) -> Option<u32> {
        match self {
            RefNumber::Simple(n) => Some(*n),
            _ => None,
        }
    }
}

impl fmt::Display for RefNumber {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.display())
    }
}

/// A definition found in the document (e.g., a labeled figure, table, equation).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Definition {
    pub ref_type: RefType,
    pub id: String,
    pub number: RefNumber,
    pub caption: Option<String>,
    pub line: usize,
    /// UTF-16 code unit offset for CodeMirror compatibility.
    pub char_offset: usize,
}

/// A citation found in the document (e.g., `[@fig:cat;@tbl:data]`).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Citation {
    pub refs: Vec<CitationRef>,
    pub char_start: usize,
    pub char_end: usize,
    pub original: String,
}

/// A single reference within a citation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CitationRef {
    pub ref_type: RefType,
    pub id: String,
}

/// A resolved citation ready for rendering.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResolvedCitation {
    pub char_start: usize,
    pub char_end: usize,
    pub rendered_text: String,
    pub is_valid: bool,
    pub original: String,
    /// Target definition's line number (for click-to-navigate).
    pub target_line: Option<usize>,
    /// Target definition's UTF-16 char offset (line start, for scrolling).
    pub target_char_offset: Option<usize>,
}

/// A resolved definition tag ready for live-mode rendering.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResolvedDefinitionTag {
    pub char_start: usize,
    pub char_end: usize,
    pub rendered_text: String,
    pub is_valid: bool,
    pub original: String,
    pub ref_type: String,
    pub id: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ref_type_from_str() {
        assert_eq!(RefType::from_str("fig"), Some(RefType::Fig));
        assert_eq!(RefType::from_str("tbl"), Some(RefType::Tbl));
        assert_eq!(RefType::from_str("sec"), Some(RefType::Sec));
        assert_eq!(RefType::from_str("eq"), Some(RefType::Eq));
        assert_eq!(RefType::from_str("lst"), Some(RefType::Lst));
        assert_eq!(
            RefType::from_str("thm"),
            Some(RefType::Custom("thm".to_string()))
        );
    }

    #[test]
    fn ref_type_prefix_str() {
        assert_eq!(RefType::Fig.prefix_str(), "fig");
        assert_eq!(RefType::Eq.prefix_str(), "eq");
        assert_eq!(RefType::Custom("thm".to_string()).prefix_str(), "thm");
    }

    #[test]
    fn ref_number_display() {
        assert_eq!(RefNumber::Simple(3).display(), "3");
        assert_eq!(RefNumber::SubNumbered(3, 'a').display(), "3a");
        assert_eq!(RefNumber::Hierarchical(vec![1, 2, 3]).display(), "1.2.3");
    }

    #[test]
    fn ref_number_sortable() {
        assert_eq!(RefNumber::Simple(5).as_sortable_u32(), Some(5));
        assert_eq!(RefNumber::SubNumbered(3, 'a').as_sortable_u32(), None);
        assert_eq!(
            RefNumber::Hierarchical(vec![1, 2]).as_sortable_u32(),
            None
        );
    }
}
