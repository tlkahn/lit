use font_kit::source::SystemSource;

#[tauri::command]
pub fn list_system_fonts() -> Result<Vec<String>, String> {
    let families = SystemSource::new()
        .all_families()
        .map_err(|e| format!("failed to enumerate system fonts: {e}"))?;
    let mut sorted: Vec<String> = families;
    sorted.sort_unstable_by(|a, b| a.to_lowercase().cmp(&b.to_lowercase()));
    sorted.dedup();
    Ok(sorted)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lists_fonts() {
        let fonts = list_system_fonts().expect("should enumerate fonts");
        assert!(!fonts.is_empty(), "system should have at least one font");
        for pair in fonts.windows(2) {
            assert!(
                pair[0].to_lowercase() <= pair[1].to_lowercase(),
                "fonts should be sorted case-insensitively: {:?} vs {:?}",
                pair[0],
                pair[1],
            );
        }
    }
}
