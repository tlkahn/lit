//! Segmentation-language resolution for annotations.
//!
//! An annotation's sentence scope depends on which language's rules
//! `sentencex` segments the body with, so index time and live preview must
//! agree on one answer. The language is a three-scope setting resolved with
//! precedence **annotation > document > app-global**:
//!
//! | Scope      | Mechanism                                            |
//! |------------|------------------------------------------------------|
//! | Annotation | DSL field: `lang=fr` (compact) / `lang: fr` (block)  |
//! | Document   | frontmatter `annotation-lang`, else pandoc's `lang`  |
//! | Global     | preference `annotations.defaultLang` (default `en`)  |
//!
//! The TypeScript mirror of this module is `src/lib/annotationLang.ts`; the
//! two must normalize identically.

/// Fallback when nothing in the three scopes yields a usable tag.
pub const DEFAULT_LANG: &str = "en";

/// Canonicalizes a raw language tag into the form `sentencex` expects, or
/// `None` when it is empty or malformed.
///
/// Lowercases, and drops BCP-47 **region** subtags (2 alpha or 3 digits)
/// while keeping **script** subtags: `zh-CN` -> `zh`, `en-US` -> `en`,
/// `fr-CA` -> `fr`, `zh-Hant` -> `zh-hant`. Dropping the region matters
/// because `sentencex::language_factory` falls through unknown tags to `en`,
/// and its fallback table knows `zh-hant`/`zh-hans` but not `zh-cn` - so a
/// pandoc-style `lang: zh-CN` would silently segment as English.
pub fn normalize_lang(raw: &str) -> Option<String> {
    let lowered = raw.trim().to_lowercase();
    if lowered.is_empty() {
        return None;
    }
    let mut subtags = lowered.split(['-', '_']);

    let primary = subtags.next()?;
    if primary.len() < 2 || primary.len() > 3 || !primary.chars().all(|c| c.is_ascii_alphabetic()) {
        return None;
    }

    // Only a script subtag survives; regions and variants are dropped because
    // `sentencex` keys its fallback table on language and script alone.
    let script = subtags.find(|s| s.len() == 4 && s.chars().all(|c| c.is_ascii_alphabetic()));
    Some(match script {
        Some(script) => format!("{primary}-{script}"),
        None => primary.to_string(),
    })
}

/// Resolves the three scopes in precedence order, falling back to
/// [`DEFAULT_LANG`]. Each candidate must normalize; a garbage value at one
/// scope falls through to the next rather than poisoning the result.
pub fn effective_lang(ann: Option<&str>, doc: Option<&str>, global: Option<&str>) -> String {
    [ann, doc, global]
        .into_iter()
        .flatten()
        .find_map(normalize_lang)
        .unwrap_or_else(|| DEFAULT_LANG.to_string())
}

/// Document-scope language from frontmatter: the namespaced `annotation-lang`
/// key first, then pandoc's generic `lang`.
pub fn frontmatter_lang(fm: &serde_json::Value) -> Option<String> {
    ["annotation-lang", "lang"]
        .into_iter()
        .filter_map(|key| fm.get(key).and_then(|v| v.as_str()))
        .find_map(normalize_lang)
}

/// The annotation-indexing settings read from preferences, passed as one
/// value through the `GraphIndex` surface instead of a growing parameter list.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AnnotationIndexOpts {
    pub enabled: bool,
    pub default_lang: String,
}

impl Default for AnnotationIndexOpts {
    fn default() -> Self {
        Self { enabled: true, default_lang: DEFAULT_LANG.to_string() }
    }
}

impl AnnotationIndexOpts {
    /// Annotations off; the language is irrelevant but still well-formed.
    pub fn disabled() -> Self {
        Self { enabled: false, default_lang: DEFAULT_LANG.to_string() }
    }

    /// Annotations on with an explicit global default language.
    pub fn with_lang(default_lang: &str) -> Self {
        Self {
            enabled: true,
            default_lang: normalize_lang(default_lang).unwrap_or_else(|| DEFAULT_LANG.to_string()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    // --- normalize_lang ---

    #[test]
    fn normalize_keeps_plain_tag() {
        assert_eq!(normalize_lang("en"), Some("en".to_string()));
        assert_eq!(normalize_lang("fr"), Some("fr".to_string()));
        assert_eq!(normalize_lang("zh"), Some("zh".to_string()));
    }

    #[test]
    fn normalize_lowercases_and_trims() {
        assert_eq!(normalize_lang("  FR  "), Some("fr".to_string()));
        assert_eq!(normalize_lang("En"), Some("en".to_string()));
    }

    #[test]
    fn normalize_drops_region_subtag() {
        assert_eq!(normalize_lang("zh-CN"), Some("zh".to_string()));
        assert_eq!(normalize_lang("en-US"), Some("en".to_string()));
        assert_eq!(normalize_lang("fr-CA"), Some("fr".to_string()));
    }

    #[test]
    fn normalize_drops_numeric_region_subtag() {
        assert_eq!(normalize_lang("es-419"), Some("es".to_string()));
    }

    #[test]
    fn normalize_keeps_script_subtag() {
        assert_eq!(normalize_lang("zh-Hant"), Some("zh-hant".to_string()));
        assert_eq!(normalize_lang("zh-Hans"), Some("zh-hans".to_string()));
    }

    #[test]
    fn normalize_keeps_script_and_drops_region_together() {
        assert_eq!(normalize_lang("zh-Hant-TW"), Some("zh-hant".to_string()));
    }

    #[test]
    fn normalize_accepts_underscore_separator() {
        assert_eq!(normalize_lang("zh_CN"), Some("zh".to_string()));
    }

    #[test]
    fn normalize_rejects_empty_and_blank() {
        assert_eq!(normalize_lang(""), None);
        assert_eq!(normalize_lang("   "), None);
    }

    #[test]
    fn normalize_rejects_malformed_primary_subtag() {
        assert_eq!(normalize_lang("e"), None);
        assert_eq!(normalize_lang("123"), None);
        assert_eq!(normalize_lang("fr!"), None);
        assert_eq!(normalize_lang("english-language-tag"), None);
        assert_eq!(normalize_lang("-fr"), None);
    }

    #[test]
    fn normalize_drops_variant_subtags() {
        assert_eq!(normalize_lang("de-DE-1996"), Some("de".to_string()));
    }

    // --- effective_lang ---

    #[test]
    fn effective_prefers_annotation_scope() {
        assert_eq!(effective_lang(Some("fr"), Some("ja"), Some("zh")), "fr");
    }

    #[test]
    fn effective_falls_back_to_document_scope() {
        assert_eq!(effective_lang(None, Some("ja"), Some("zh")), "ja");
    }

    #[test]
    fn effective_falls_back_to_global_scope() {
        assert_eq!(effective_lang(None, None, Some("zh")), "zh");
    }

    #[test]
    fn effective_falls_back_to_default_when_nothing_set() {
        assert_eq!(effective_lang(None, None, None), "en");
    }

    #[test]
    fn effective_normalizes_the_winner() {
        assert_eq!(effective_lang(Some("FR-ca"), None, None), "fr");
        assert_eq!(effective_lang(None, Some("zh-Hant-TW"), None), "zh-hant");
    }

    #[test]
    fn effective_skips_unusable_values_at_each_scope() {
        assert_eq!(effective_lang(Some("  "), Some("ja"), Some("zh")), "ja");
        assert_eq!(effective_lang(Some("!!"), Some(""), Some("zh")), "zh");
        assert_eq!(effective_lang(Some("!!"), Some(""), Some("?")), "en");
    }

    // --- frontmatter_lang ---

    #[test]
    fn frontmatter_reads_namespaced_key() {
        let fm = json!({ "annotation-lang": "fr" });
        assert_eq!(frontmatter_lang(&fm), Some("fr".to_string()));
    }

    #[test]
    fn frontmatter_falls_back_to_pandoc_lang() {
        let fm = json!({ "lang": "fr-CA" });
        assert_eq!(frontmatter_lang(&fm), Some("fr".to_string()));
    }

    #[test]
    fn frontmatter_namespaced_key_wins_over_pandoc_lang() {
        let fm = json!({ "annotation-lang": "ja", "lang": "fr-CA" });
        assert_eq!(frontmatter_lang(&fm), Some("ja".to_string()));
    }

    #[test]
    fn frontmatter_unusable_namespaced_key_falls_through_to_pandoc_lang() {
        let fm = json!({ "annotation-lang": "  ", "lang": "fr" });
        assert_eq!(frontmatter_lang(&fm), Some("fr".to_string()));
    }

    #[test]
    fn frontmatter_ignores_non_string_and_missing_values() {
        assert_eq!(frontmatter_lang(&json!({})), None);
        assert_eq!(frontmatter_lang(&json!({ "lang": 42 })), None);
        assert_eq!(frontmatter_lang(&json!({ "lang": ["fr"] })), None);
        assert_eq!(frontmatter_lang(&json!(null)), None);
        assert_eq!(frontmatter_lang(&json!("fr")), None);
    }

    // --- AnnotationIndexOpts ---

    #[test]
    fn index_opts_default_is_enabled_english() {
        let opts = AnnotationIndexOpts::default();
        assert!(opts.enabled);
        assert_eq!(opts.default_lang, "en");
    }

    #[test]
    fn index_opts_with_lang_normalizes() {
        assert_eq!(AnnotationIndexOpts::with_lang("FR-CA").default_lang, "fr");
        assert_eq!(AnnotationIndexOpts::with_lang("garbage!").default_lang, "en");
    }

    #[test]
    fn index_opts_disabled_still_has_a_language() {
        let opts = AnnotationIndexOpts::disabled();
        assert!(!opts.enabled);
        assert_eq!(opts.default_lang, "en");
    }
}
