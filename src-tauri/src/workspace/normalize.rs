use super::WorkspaceError;
use std::path::{Path, PathBuf};
use unicode_normalization::UnicodeNormalization;

pub const FORBIDDEN_CHARS: &[char] = &['/', '\\', ':', '*', '?', '"', '<', '>', '|', '\0'];

pub fn validate_within_root(root: &Path, relative_path: &str) -> Result<PathBuf, WorkspaceError> {
    let canonical_root = root
        .canonicalize()
        .map_err(|e| WorkspaceError::InvalidPath(e.to_string()))?;
    let full = root.join(relative_path);
    let canonical_full = if full.exists() {
        full.canonicalize()
            .map_err(|e| WorkspaceError::InvalidPath(e.to_string()))?
    } else {
        let mut ancestor = full.as_path();
        let mut trailing = Vec::new();
        loop {
            if ancestor.exists() {
                let base = ancestor
                    .canonicalize()
                    .map_err(|e| WorkspaceError::InvalidPath(e.to_string()))?;
                let mut result = base;
                for seg in trailing.into_iter().rev() {
                    result = result.join(seg);
                }
                break result;
            }
            let name = ancestor
                .file_name()
                .ok_or_else(|| WorkspaceError::InvalidPath("no file name".into()))?;
            trailing.push(name.to_os_string());
            ancestor = ancestor
                .parent()
                .ok_or_else(|| WorkspaceError::InvalidPath("no parent directory".into()))?;
        }
    };
    if !canonical_full.starts_with(&canonical_root) {
        return Err(WorkspaceError::InvalidPath(format!(
            "path escapes workspace root: {relative_path}"
        )));
    }
    Ok(canonical_full)
}

pub fn normalize_to_nfc(s: &str) -> String {
    s.nfc().collect()
}

/// Derive a human-readable kebab-case slug from a document title, suitable for
/// use as a filename stem. NFC-normalizes, lowercases, replaces forbidden and
/// non-alphanumeric characters with hyphen separators, and collapses/trims
/// hyphens. Returns `None` when the title yields no usable characters (empty,
/// whitespace-only, or pure punctuation) so callers can fall back to the key.
pub fn kebab_case_title(title: &str) -> Option<String> {
    let normalized = normalize_to_nfc(title).to_lowercase();
    let mut slug = String::with_capacity(normalized.len());
    for ch in normalized.chars() {
        if ch.is_alphanumeric() {
            slug.push(ch);
        } else {
            // Any separator/punctuation/forbidden char becomes a boundary.
            if !slug.ends_with('-') {
                slug.push('-');
            }
        }
    }
    let trimmed = slug.trim_matches('-');
    if trimmed.is_empty() {
        return None;
    }
    Some(truncate_slug(trimmed, MAX_SLUG_LEN))
}

/// Maximum slug length in bytes. Keeps filenames well under filesystem limits
/// while staying readable.
pub(crate) const MAX_SLUG_LEN: usize = 80;

/// Truncate a kebab-case slug to at most `max` bytes, preferring to cut at a
/// word boundary (hyphen) and never leaving a trailing hyphen or splitting a
/// multi-byte character.
pub(crate) fn truncate_slug(s: &str, max: usize) -> String {
    if s.len() <= max {
        return s.to_string();
    }
    // Floor to a char boundary so slicing is safe for multi-byte chars.
    let mut boundary = max;
    while boundary > 0 && !s.is_char_boundary(boundary) {
        boundary -= 1;
    }
    let head = &s[..boundary];
    // Cut at the last word boundary at or before the limit; if there is none,
    // keep the whole head (a single long word).
    let cut = head.rfind('-').unwrap_or(boundary);
    head[..cut].trim_end_matches('-').to_string()
}

pub fn validate_page_name(name: &str) -> Result<(), WorkspaceError> {
    if name.is_empty() {
        return Err(WorkspaceError::InvalidPageName(
            "Page name cannot be empty".to_string(),
        ));
    }
    if name.starts_with('.') {
        return Err(WorkspaceError::InvalidPageName(format!(
            "Page name cannot start with '.': {name}"
        )));
    }
    for ch in name.chars() {
        if FORBIDDEN_CHARS.contains(&ch) {
            return Err(WorkspaceError::InvalidPageName(format!(
                "Page name contains forbidden character '{ch}': {name}"
            )));
        }
    }
    Ok(())
}

pub fn page_name_to_filename(name: &str) -> String {
    format!("{name}.md")
}

pub fn filename_to_page_name(filename: &str) -> String {
    // Strip the final extension (e.g. ".md", ".pdf", ".bib", ".rs") to derive
    // the display title. Files with no extension keep their full name.
    let name = std::path::Path::new(filename)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or(filename);
    normalize_to_nfc(name)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn nfc_normalization_of_decomposed_unicode() {
        // NFD: e + combining acute accent
        let nfd = "caf\u{0065}\u{0301}";
        let nfc = normalize_to_nfc(nfd);
        assert_eq!(nfc, "caf\u{00e9}");
    }

    #[test]
    fn forbidden_character_rejection() {
        for ch in FORBIDDEN_CHARS {
            let name = format!("page{ch}name");
            assert!(
                validate_page_name(&name).is_err(),
                "Should reject '{ch}'"
            );
        }
    }

    #[test]
    fn empty_name_rejection() {
        assert!(validate_page_name("").is_err());
    }

    #[test]
    fn dotfile_rejection() {
        assert!(validate_page_name(".hidden").is_err());
    }

    #[test]
    fn valid_names_accepted() {
        assert!(validate_page_name("My Page").is_ok());
        assert!(validate_page_name("日本語ページ").is_ok());
        assert!(validate_page_name("page-with-dashes").is_ok());
    }

    #[test]
    fn round_trip_name_filename() {
        let name = "My Page";
        let filename = page_name_to_filename(name);
        assert_eq!(filename, "My Page.md");
        let recovered = filename_to_page_name(&filename);
        assert_eq!(recovered, name);
    }

    #[test]
    fn filename_to_page_name_nfc_normalizes() {
        let nfd_filename = "caf\u{0065}\u{0301}.md";
        let name = filename_to_page_name(nfd_filename);
        assert_eq!(name, "caf\u{00e9}");
    }

    #[test]
    fn arabic_filename_round_trip() {
        let name = "اختبار";
        assert!(validate_page_name(name).is_ok());
        let filename = page_name_to_filename(name);
        assert_eq!(filename, "اختبار.md");
        let recovered = filename_to_page_name(&filename);
        assert_eq!(recovered, name);
    }

    #[test]
    fn tibetan_filename_round_trip() {
        let name = "བོད་ཡིག";
        assert!(validate_page_name(name).is_ok());
        let filename = page_name_to_filename(name);
        let recovered = filename_to_page_name(&filename);
        assert_eq!(recovered, name);
    }

    #[test]
    fn filename_to_page_name_strips_pdf_extension() {
        assert_eq!(filename_to_page_name("Research Paper.pdf"), "Research Paper");
    }

    #[test]
    fn validate_within_root_accepts_valid_path() {
        let dir = TempDir::new().unwrap();
        std::fs::create_dir_all(dir.path().join("sub")).unwrap();
        std::fs::write(dir.path().join("sub/note.md"), "hi").unwrap();

        let result = validate_within_root(dir.path(), "sub/note.md");
        assert!(result.is_ok(), "Expected Ok, got {result:?}");
    }

    #[test]
    fn validate_within_root_nonexistent_valid_dest() {
        let dir = TempDir::new().unwrap();
        std::fs::create_dir_all(dir.path().join("sub")).unwrap();
        // File doesn't exist, but parent dir does — should be Ok
        let result = validate_within_root(dir.path(), "sub/new_file.md");
        assert!(result.is_ok(), "Expected Ok for nonexistent valid dest, got {result:?}");
    }

    #[test]
    fn validate_within_root_rejects_traversal() {
        let dir = TempDir::new().unwrap();
        let sibling = dir.path().parent().unwrap().join("sibling.md");
        std::fs::write(&sibling, "secret").unwrap();

        let result = validate_within_root(dir.path(), "../sibling.md");
        std::fs::remove_file(&sibling).ok();
        assert!(
            matches!(result, Err(WorkspaceError::InvalidPath(_))),
            "Expected InvalidPath, got {result:?}"
        );
    }

    #[test]
    fn kebab_case_title_basic() {
        assert_eq!(
            kebab_case_title("The Well-Posed Problem"),
            Some("the-well-posed-problem".to_string())
        );
    }

    #[test]
    fn kebab_case_title_strips_punctuation() {
        assert_eq!(
            kebab_case_title("What is AI? A Survey (2024)"),
            Some("what-is-ai-a-survey-2024".to_string())
        );
    }

    #[test]
    fn kebab_case_title_empty_is_none() {
        assert_eq!(kebab_case_title(""), None);
    }

    #[test]
    fn kebab_case_title_whitespace_only_is_none() {
        assert_eq!(kebab_case_title("   "), None);
    }

    #[test]
    fn kebab_case_title_pure_punctuation_is_none() {
        assert_eq!(kebab_case_title("??!!"), None);
    }

    #[test]
    fn kebab_case_title_truncates_at_word_boundary() {
        // 90-char title; should truncate at a hyphen at or before position 80.
        let title = "the quick brown fox jumps over the lazy dog and then runs across the wide open green field again";
        let slug = kebab_case_title(title).unwrap();
        assert!(slug.len() <= 80, "slug too long: {} chars", slug.len());
        assert!(!slug.ends_with('-'), "slug should not end with hyphen: {slug}");
        // Truncation happens at a word boundary, so the slug is a prefix of the
        // full kebab string ending on a complete word.
        assert!(
            "the-quick-brown-fox-jumps-over-the-lazy-dog-and-then-runs-across-the-wide-open-green-field-again".starts_with(&slug),
            "slug should be a word-boundary prefix: {slug}"
        );
    }

    #[test]
    fn kebab_case_title_collapses_hyphens() {
        assert_eq!(kebab_case_title("foo---bar"), Some("foo-bar".to_string()));
    }

    #[test]
    fn kebab_case_title_cjk() {
        assert_eq!(
            kebab_case_title("深度学习综述"),
            Some("深度学习综述".to_string())
        );
    }

    #[test]
    fn kebab_case_title_accented() {
        assert_eq!(
            kebab_case_title("Café Résumé"),
            Some("café-résumé".to_string())
        );
    }

    #[test]
    fn kebab_case_title_trims_leading_trailing_hyphens() {
        assert_eq!(
            kebab_case_title("-leading-and-trailing-"),
            Some("leading-and-trailing".to_string())
        );
    }

    #[test]
    fn emoji_in_page_name() {
        let name = "🚀 Launch Notes";
        assert!(validate_page_name(name).is_ok());
        let filename = page_name_to_filename(name);
        assert_eq!(filename, "🚀 Launch Notes.md");
        let recovered = filename_to_page_name(&filename);
        assert_eq!(recovered, name);
    }
}
