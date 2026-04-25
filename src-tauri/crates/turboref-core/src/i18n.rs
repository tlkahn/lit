use serde::{Deserialize, Serialize};

use crate::config::DocumentConfig;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Locale {
    En,
    Zh,
}

impl Default for Locale {
    fn default() -> Self {
        Locale::En
    }
}

/// Returns a DocumentConfig with locale-appropriate defaults.
pub fn localized_defaults(locale: Locale) -> DocumentConfig {
    match locale {
        Locale::En => DocumentConfig {
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
        },
        Locale::Zh => DocumentConfig {
            locale: Locale::Zh,
            figure_title: "图".to_string(),
            table_title: "表".to_string(),
            listing_title: "代码".to_string(),
            equation_title: "式".to_string(),
            fig_prefix: vec!["图".to_string()],
            tbl_prefix: vec!["表".to_string()],
            eq_prefix: vec!["式".to_string()],
            lst_prefix: vec!["代码".to_string()],
            sec_prefix: vec!["小节".to_string()],
            link_references: false,
            name_in_link: false,
            subfig_grid: false,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn english_defaults() {
        let config = localized_defaults(Locale::En);
        assert_eq!(config.figure_title, "Figure");
        assert_eq!(config.eq_prefix, vec!["Eq.", "Eqs."]);
    }

    #[test]
    fn chinese_defaults() {
        let config = localized_defaults(Locale::Zh);
        assert_eq!(config.figure_title, "图");
        assert_eq!(config.eq_prefix, vec!["式"]);
    }
}
