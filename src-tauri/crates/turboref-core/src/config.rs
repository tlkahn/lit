use serde::{Deserialize, Serialize};

use crate::i18n::Locale;

/// Document-level configuration, constructed from plugin settings + frontmatter.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DocumentConfig {
    pub locale: Locale,

    // Caption prefixes (used in definition rendering, e.g., "Figure 1: ...")
    pub figure_title: String,
    pub table_title: String,
    pub listing_title: String,
    pub equation_title: String,

    // Citation prefixes (used in reference rendering, e.g., "Fig. 1")
    // Arrays support singular/plural: ["Fig.", "Figs."]
    pub fig_prefix: Vec<String>,
    pub tbl_prefix: Vec<String>,
    pub eq_prefix: Vec<String>,
    pub lst_prefix: Vec<String>,
    pub sec_prefix: Vec<String>,

    // Pandoc-crossref options
    pub link_references: bool,
    pub name_in_link: bool,
    pub subfig_grid: bool,
}

impl Default for DocumentConfig {
    fn default() -> Self {
        Self {
            locale: Locale::En,
            figure_title: "Figure".to_string(),
            table_title: "Table".to_string(),
            listing_title: "Listing".to_string(),
            equation_title: "Equation".to_string(),
            fig_prefix: vec!["Fig.".to_string(), "Figs.".to_string()],
            tbl_prefix: vec!["Table".to_string(), "Tables".to_string()],
            eq_prefix: vec!["Eq.".to_string(), "Eqs.".to_string()],
            lst_prefix: vec!["Listing".to_string(), "Listings".to_string()],
            sec_prefix: vec!["Section".to_string(), "Sections".to_string()],
            link_references: false,
            name_in_link: false,
            subfig_grid: false,
        }
    }
}

impl DocumentConfig {
    /// Select the appropriate prefix based on reference count.
    /// count=1 → prefix[0] (singular), count>1 → prefix[min(count-1, len-1)] (plural).
    pub fn select_prefix<'a>(prefix_array: &'a [String], count: usize) -> &'a str {
        if prefix_array.is_empty() {
            return "";
        }
        if count == 0 {
            return &prefix_array[0];
        }
        let index = (count - 1).min(prefix_array.len() - 1);
        &prefix_array[index]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn select_prefix_singular() {
        let prefixes = vec!["Fig.".to_string(), "Figs.".to_string()];
        assert_eq!(DocumentConfig::select_prefix(&prefixes, 1), "Fig.");
    }

    #[test]
    fn select_prefix_plural() {
        let prefixes = vec!["Fig.".to_string(), "Figs.".to_string()];
        assert_eq!(DocumentConfig::select_prefix(&prefixes, 2), "Figs.");
        assert_eq!(DocumentConfig::select_prefix(&prefixes, 5), "Figs.");
    }

    #[test]
    fn select_prefix_single_entry() {
        let prefixes = vec!["图".to_string()];
        assert_eq!(DocumentConfig::select_prefix(&prefixes, 1), "图");
        assert_eq!(DocumentConfig::select_prefix(&prefixes, 3), "图");
    }

    #[test]
    fn select_prefix_empty() {
        let prefixes: Vec<String> = vec![];
        assert_eq!(DocumentConfig::select_prefix(&prefixes, 1), "");
    }

    #[test]
    fn default_config_has_english_defaults() {
        let config = DocumentConfig::default();
        assert_eq!(config.figure_title, "Figure");
        assert_eq!(config.fig_prefix, vec!["Fig.", "Figs."]);
        assert_eq!(config.locale, Locale::En);
    }
}
