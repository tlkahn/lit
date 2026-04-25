use std::collections::BTreeMap;

use crate::config::DocumentConfig;
use crate::resolver::ReferenceMap;
use crate::types::{Citation, RefNumber, RefType, ResolvedCitation};

/// Resolve and render all citations against a reference map.
pub fn resolve_all(
    citations: &[Citation],
    ref_map: &ReferenceMap,
    config: &DocumentConfig,
) -> Vec<ResolvedCitation> {
    citations
        .iter()
        .map(|c| resolve_one(c, ref_map, config))
        .collect()
}

fn resolve_one(
    citation: &Citation,
    ref_map: &ReferenceMap,
    config: &DocumentConfig,
) -> ResolvedCitation {
    // Group refs by type, preserving order of first appearance.
    // Track the first resolved definition for navigation target.
    let mut groups: BTreeMap<String, Vec<&RefNumber>> = BTreeMap::new();
    let mut group_order: Vec<String> = Vec::new();
    let mut all_valid = true;
    let mut first_target: Option<(usize, usize)> = None; // (line, char_offset)

    for cref in &citation.refs {
        let key = cref.ref_type.prefix_str().to_string();
        if !groups.contains_key(&key) {
            group_order.push(key.clone());
        }
        if let Some(def) = ref_map.get(&cref.id) {
            groups.entry(key).or_default().push(&def.number);
            if first_target.is_none() {
                first_target = Some((def.line, def.char_offset));
            }
        } else {
            all_valid = false;
        }
    }

    if !all_valid || groups.is_empty() {
        return ResolvedCitation {
            char_start: citation.char_start,
            char_end: citation.char_end,
            rendered_text: citation.original.clone(),
            is_valid: false,
            original: citation.original.clone(),
            target_line: None,
            target_char_offset: None,
        };
    }

    let rendered_groups: Vec<String> = group_order
        .iter()
        .filter_map(|key| {
            let numbers = groups.get(key)?;
            let ref_type = RefType::from_str(key)?;
            let prefix_array = prefix_for_type(&ref_type, config);
            let prefix = DocumentConfig::select_prefix(prefix_array, numbers.len());
            let number_str = render_numbers(numbers);
            Some(format!("{} {}", prefix, number_str))
        })
        .collect();

    ResolvedCitation {
        char_start: citation.char_start,
        char_end: citation.char_end,
        rendered_text: rendered_groups.join(", "),
        is_valid: true,
        original: citation.original.clone(),
        target_line: first_target.map(|(l, _)| l),
        target_char_offset: first_target.map(|(_, o)| o),
    }
}

pub(crate) fn prefix_for_type<'a>(ref_type: &RefType, config: &'a DocumentConfig) -> &'a [String] {
    match ref_type {
        RefType::Fig => &config.fig_prefix,
        RefType::Tbl => &config.tbl_prefix,
        RefType::Eq => &config.eq_prefix,
        RefType::Lst => &config.lst_prefix,
        RefType::Sec => &config.sec_prefix,
        RefType::Custom(_) => &config.fig_prefix, // fallback
    }
}

/// Render a list of numbers, detecting consecutive ranges.
fn render_numbers(numbers: &[&RefNumber]) -> String {
    // Try to extract sortable u32 values for range detection
    let sortable: Vec<Option<u32>> = numbers.iter().map(|n| n.as_sortable_u32()).collect();

    // If all are simple numbers, try range detection
    if sortable.iter().all(|s| s.is_some()) && sortable.len() > 1 {
        let mut vals: Vec<u32> = sortable.into_iter().flatten().collect();
        vals.sort();
        vals.dedup();

        if is_consecutive(&vals) {
            return format!("{}-{}", vals.first().unwrap(), vals.last().unwrap());
        }

        // Non-consecutive: list all
        return vals
            .iter()
            .map(|v| v.to_string())
            .collect::<Vec<_>>()
            .join(", ");
    }

    // Mixed or non-simple: just display all
    numbers
        .iter()
        .map(|n| n.display())
        .collect::<Vec<_>>()
        .join(", ")
}

fn is_consecutive(sorted: &[u32]) -> bool {
    if sorted.len() <= 1 {
        return false; // don't render range for single number
    }
    for i in 1..sorted.len() {
        if sorted[i] != sorted[i - 1] + 1 {
            return false;
        }
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{CitationRef, Definition};

    fn make_ref_map(defs: Vec<Definition>) -> ReferenceMap {
        ReferenceMap::from_definitions(defs)
    }

    fn make_def(ref_type: RefType, id: &str, number: RefNumber) -> Definition {
        Definition {
            ref_type,
            id: id.to_string(),
            number,
            caption: None,
            line: 0,
            char_offset: 0,
        }
    }

    fn make_citation(refs: Vec<(&str, &str)>) -> Citation {
        Citation {
            refs: refs
                .into_iter()
                .map(|(t, id)| CitationRef {
                    ref_type: RefType::from_str(t).unwrap(),
                    id: id.to_string(),
                })
                .collect(),
            char_start: 0,
            char_end: 10,
            original: "[@...]".to_string(),
        }
    }

    #[test]
    fn render_single_figure() {
        let ref_map = make_ref_map(vec![make_def(RefType::Fig, "cat", RefNumber::Simple(1))]);
        let citation = make_citation(vec![("fig", "cat")]);
        let config = DocumentConfig::default();
        let resolved = resolve_all(&[citation], &ref_map, &config);
        assert_eq!(resolved.len(), 1);
        assert_eq!(resolved[0].rendered_text, "Fig. 1");
        assert!(resolved[0].is_valid);
    }

    #[test]
    fn render_unresolved_ref() {
        let ref_map = make_ref_map(vec![]);
        let citation = make_citation(vec![("fig", "missing")]);
        let config = DocumentConfig::default();
        let resolved = resolve_all(&[citation], &ref_map, &config);
        assert!(!resolved[0].is_valid);
        assert_eq!(resolved[0].rendered_text, "[@...]");
    }

    #[test]
    fn render_consecutive_range() {
        let ref_map = make_ref_map(vec![
            make_def(RefType::Fig, "a", RefNumber::Simple(1)),
            make_def(RefType::Fig, "b", RefNumber::Simple(2)),
            make_def(RefType::Fig, "c", RefNumber::Simple(3)),
        ]);
        let citation = make_citation(vec![("fig", "a"), ("fig", "b"), ("fig", "c")]);
        let config = DocumentConfig::default();
        let resolved = resolve_all(&[citation], &ref_map, &config);
        assert_eq!(resolved[0].rendered_text, "Figs. 1-3");
    }

    #[test]
    fn render_non_consecutive() {
        let ref_map = make_ref_map(vec![
            make_def(RefType::Fig, "a", RefNumber::Simple(1)),
            make_def(RefType::Fig, "c", RefNumber::Simple(3)),
            make_def(RefType::Fig, "e", RefNumber::Simple(5)),
        ]);
        let citation = make_citation(vec![("fig", "a"), ("fig", "c"), ("fig", "e")]);
        let config = DocumentConfig::default();
        let resolved = resolve_all(&[citation], &ref_map, &config);
        assert_eq!(resolved[0].rendered_text, "Figs. 1, 3, 5");
    }

    #[test]
    fn render_mixed_types() {
        let ref_map = make_ref_map(vec![
            make_def(RefType::Fig, "cat", RefNumber::Simple(1)),
            make_def(RefType::Tbl, "data", RefNumber::Simple(2)),
        ]);
        let citation = make_citation(vec![("fig", "cat"), ("tbl", "data")]);
        let config = DocumentConfig::default();
        let resolved = resolve_all(&[citation], &ref_map, &config);
        assert_eq!(resolved[0].rendered_text, "Fig. 1, Table 2");
    }

    #[test]
    fn render_singular_vs_plural_prefix() {
        let ref_map = make_ref_map(vec![
            make_def(RefType::Fig, "a", RefNumber::Simple(1)),
        ]);
        let citation = make_citation(vec![("fig", "a")]);
        let config = DocumentConfig::default(); // fig_prefix = ["Fig.", "Figs."]
        let resolved = resolve_all(&[citation], &ref_map, &config);
        assert_eq!(resolved[0].rendered_text, "Fig. 1"); // singular
    }

    #[test]
    fn render_equation() {
        let ref_map = make_ref_map(vec![
            make_def(RefType::Eq, "einstein", RefNumber::Simple(1)),
        ]);
        let citation = make_citation(vec![("eq", "einstein")]);
        let config = DocumentConfig::default();
        let resolved = resolve_all(&[citation], &ref_map, &config);
        assert_eq!(resolved[0].rendered_text, "Eq. 1");
    }

    #[test]
    fn render_listing() {
        let ref_map = make_ref_map(vec![
            make_def(RefType::Lst, "hello", RefNumber::Simple(1)),
        ]);
        let citation = make_citation(vec![("lst", "hello")]);
        let config = DocumentConfig::default();
        let resolved = resolve_all(&[citation], &ref_map, &config);
        assert_eq!(resolved[0].rendered_text, "Listing 1");
    }

    #[test]
    fn render_section() {
        let ref_map = make_ref_map(vec![
            make_def(RefType::Sec, "intro", RefNumber::Hierarchical(vec![1, 2])),
        ]);
        let citation = make_citation(vec![("sec", "intro")]);
        let config = DocumentConfig::default();
        let resolved = resolve_all(&[citation], &ref_map, &config);
        assert_eq!(resolved[0].rendered_text, "Section 1.2");
    }

    #[test]
    fn render_subfigure_numbers() {
        let ref_map = make_ref_map(vec![
            make_def(RefType::Fig, "a", RefNumber::SubNumbered(1, 'a')),
            make_def(RefType::Fig, "b", RefNumber::SubNumbered(1, 'b')),
        ]);
        let citation = make_citation(vec![("fig", "a"), ("fig", "b")]);
        let config = DocumentConfig::default();
        let resolved = resolve_all(&[citation], &ref_map, &config);
        // SubNumbered is not sortable, so displays as list
        assert_eq!(resolved[0].rendered_text, "Figs. 1a, 1b");
    }

    #[test]
    fn render_chinese_locale() {
        let ref_map = make_ref_map(vec![
            make_def(RefType::Fig, "cat", RefNumber::Simple(1)),
        ]);
        let citation = make_citation(vec![("fig", "cat")]);
        let config = crate::i18n::localized_defaults(crate::i18n::Locale::Zh);
        let resolved = resolve_all(&[citation], &ref_map, &config);
        assert_eq!(resolved[0].rendered_text, "图 1");
    }

    // --- Target navigation info tests ---

    fn make_def_at(ref_type: RefType, id: &str, number: RefNumber, line: usize, char_offset: usize) -> Definition {
        Definition {
            ref_type,
            id: id.to_string(),
            number,
            caption: None,
            line,
            char_offset,
        }
    }

    #[test]
    fn resolve_single_figure_has_target_info() {
        let ref_map = make_ref_map(vec![
            make_def_at(RefType::Fig, "cat", RefNumber::Simple(1), 5, 100),
        ]);
        let citation = make_citation(vec![("fig", "cat")]);
        let config = DocumentConfig::default();
        let resolved = resolve_all(&[citation], &ref_map, &config);
        assert_eq!(resolved[0].target_line, Some(5));
        assert_eq!(resolved[0].target_char_offset, Some(100));
    }

    #[test]
    fn resolve_unresolved_has_no_target() {
        let ref_map = make_ref_map(vec![]);
        let citation = make_citation(vec![("fig", "missing")]);
        let config = DocumentConfig::default();
        let resolved = resolve_all(&[citation], &ref_map, &config);
        assert_eq!(resolved[0].target_line, None);
        assert_eq!(resolved[0].target_char_offset, None);
    }

    #[test]
    fn resolve_batch_uses_first_ref_target() {
        let ref_map = make_ref_map(vec![
            make_def_at(RefType::Fig, "a", RefNumber::Simple(1), 2, 50),
            make_def_at(RefType::Fig, "b", RefNumber::Simple(2), 8, 200),
        ]);
        let citation = make_citation(vec![("fig", "a"), ("fig", "b")]);
        let config = DocumentConfig::default();
        let resolved = resolve_all(&[citation], &ref_map, &config);
        // Target should be the first ref's definition
        assert_eq!(resolved[0].target_line, Some(2));
        assert_eq!(resolved[0].target_char_offset, Some(50));
    }

    #[test]
    fn resolve_mixed_types_first_ref_target() {
        let ref_map = make_ref_map(vec![
            make_def_at(RefType::Fig, "cat", RefNumber::Simple(1), 3, 60),
            make_def_at(RefType::Tbl, "data", RefNumber::Simple(1), 10, 300),
        ]);
        let citation = make_citation(vec![("fig", "cat"), ("tbl", "data")]);
        let config = DocumentConfig::default();
        let resolved = resolve_all(&[citation], &ref_map, &config);
        assert_eq!(resolved[0].target_line, Some(3));
        assert_eq!(resolved[0].target_char_offset, Some(60));
    }
}
