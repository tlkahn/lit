use super::WorkspaceError;
use unicode_normalization::UnicodeNormalization;

const FORBIDDEN_CHARS: &[char] = &['/', '\\', ':', '*', '?', '"', '<', '>', '|', '\0'];

pub fn normalize_to_nfc(s: &str) -> String {
    s.nfc().collect()
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
    let name = filename
        .strip_suffix(".md")
        .or_else(|| filename.strip_suffix(".pdf"))
        .unwrap_or(filename);
    normalize_to_nfc(name)
}

#[cfg(test)]
mod tests {
    use super::*;

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
    fn emoji_in_page_name() {
        let name = "🚀 Launch Notes";
        assert!(validate_page_name(name).is_ok());
        let filename = page_name_to_filename(name);
        assert_eq!(filename, "🚀 Launch Notes.md");
        let recovered = filename_to_page_name(&filename);
        assert_eq!(recovered, name);
    }
}
