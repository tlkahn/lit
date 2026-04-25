use std::collections::{HashMap, HashSet};

use tracing::warn;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ResolutionTier {
    ExactPath,
    Stem,
    PathSuffix,
    Ambiguous,
    Unresolved,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolvedLink {
    pub target: String,
    pub node_id: Option<String>,
    pub tier: ResolutionTier,
}

pub struct StemLookup {
    ids: HashSet<String>,
    stems: HashMap<String, Vec<String>>,
    all_ids: Vec<String>,
}

impl StemLookup {
    pub fn build(node_ids: &[String], aliases: &HashMap<String, Vec<String>>) -> Self {
        let ids: HashSet<String> = node_ids.iter().cloned().collect();
        let mut stems: HashMap<String, Vec<String>> = HashMap::new();

        for id in node_ids {
            let stem = extract_stem(id);
            stems.entry(stem).or_default().push(id.clone());
        }

        for (node_id, alias_list) in aliases {
            for alias in alias_list {
                let key = alias.to_lowercase();
                stems.entry(key).or_default().push(node_id.clone());
            }
        }

        Self {
            ids,
            stems,
            all_ids: node_ids.to_vec(),
        }
    }

    pub fn resolve(&self, target: &str) -> ResolvedLink {
        // Tier 1: exact path
        if self.ids.contains(target) {
            return ResolvedLink {
                target: target.to_string(),
                node_id: Some(target.to_string()),
                tier: ResolutionTier::ExactPath,
            };
        }

        let with_md = format!("{}.md", target);
        if self.ids.contains(&with_md) {
            return ResolvedLink {
                target: target.to_string(),
                node_id: Some(with_md),
                tier: ResolutionTier::ExactPath,
            };
        }

        // Tier 2: stem lookup (filename stems + aliases)
        let stem_key = normalize_stem(target);
        if let Some(candidates) = self.stems.get(&stem_key) {
            let unique: Vec<_> = candidates.iter().collect::<HashSet<_>>().into_iter().collect();
            if unique.len() == 1 {
                return ResolvedLink {
                    target: target.to_string(),
                    node_id: Some(unique[0].clone()),
                    tier: ResolutionTier::Stem,
                };
            }
        }

        // Tier 3: path-suffix match
        let suffix_md = if target.ends_with(".md") {
            target.to_string()
        } else {
            format!("{}.md", target)
        };
        let suffix_with_slash = format!("/{}", suffix_md);

        let mut suffix_matches: Vec<&String> = self
            .all_ids
            .iter()
            .filter(|id| **id == suffix_md || id.ends_with(&suffix_with_slash))
            .collect();
        suffix_matches.sort();

        if suffix_matches.len() == 1 {
            return ResolvedLink {
                target: target.to_string(),
                node_id: Some(suffix_matches[0].clone()),
                tier: ResolutionTier::PathSuffix,
            };
        }

        // Tier 4: ambiguous — collect all candidates from stem + suffix
        let mut all_candidates: Vec<String> = Vec::new();

        if let Some(stem_candidates) = self.stems.get(&stem_key) {
            all_candidates.extend(stem_candidates.iter().cloned());
        }

        for id in &suffix_matches {
            if !all_candidates.contains(id) {
                all_candidates.push((*id).clone());
            }
        }

        if all_candidates.len() > 1 {
            all_candidates.sort();
            warn!(
                target = target,
                picked = %all_candidates[0],
                candidates = ?all_candidates,
                "ambiguous link resolution"
            );
            return ResolvedLink {
                target: target.to_string(),
                node_id: Some(all_candidates[0].clone()),
                tier: ResolutionTier::Ambiguous,
            };
        }

        // Tier 5: unresolved
        ResolvedLink {
            target: target.to_string(),
            node_id: None,
            tier: ResolutionTier::Unresolved,
        }
    }
}

fn extract_stem(id: &str) -> String {
    let basename = id.rsplit('/').next().unwrap_or(id);
    let stem = basename.strip_suffix(".md").unwrap_or(basename);
    stem.to_lowercase()
}

fn normalize_stem(target: &str) -> String {
    let stripped = target.strip_suffix(".md").unwrap_or(target);
    let basename = stripped.rsplit('/').next().unwrap_or(stripped);
    basename.to_lowercase()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn empty_aliases() -> HashMap<String, Vec<String>> {
        HashMap::new()
    }

    #[test]
    fn build_empty_inputs() {
        let lookup = StemLookup::build(&[], &empty_aliases());
        assert!(lookup.ids.is_empty());
        assert!(lookup.stems.is_empty());
    }

    #[test]
    fn build_indexes_stems() {
        let ids = vec!["People/Alice.md".to_string()];
        let lookup = StemLookup::build(&ids, &empty_aliases());
        assert!(lookup.stems.contains_key("alice"));
    }

    #[test]
    fn build_indexes_aliases() {
        let ids = vec!["People/Alice.md".to_string()];
        let mut aliases = HashMap::new();
        aliases.insert(
            "People/Alice.md".to_string(),
            vec!["Ally".to_string()],
        );
        let lookup = StemLookup::build(&ids, &aliases);
        assert!(lookup.stems.contains_key("ally"));
    }

    #[test]
    fn build_handles_duplicate_stems() {
        let ids = vec!["a/Note.md".to_string(), "b/Note.md".to_string()];
        let lookup = StemLookup::build(&ids, &empty_aliases());
        assert_eq!(lookup.stems["note"].len(), 2);
    }

    #[test]
    fn resolve_exact_path_with_md() {
        let ids = vec!["People/Alice.md".to_string()];
        let lookup = StemLookup::build(&ids, &empty_aliases());
        let r = lookup.resolve("People/Alice.md");
        assert_eq!(r.tier, ResolutionTier::ExactPath);
        assert_eq!(r.node_id, Some("People/Alice.md".into()));
    }

    #[test]
    fn resolve_exact_path_without_md() {
        let ids = vec!["People/Alice.md".to_string()];
        let lookup = StemLookup::build(&ids, &empty_aliases());
        let r = lookup.resolve("People/Alice");
        assert_eq!(r.tier, ResolutionTier::ExactPath);
        assert_eq!(r.node_id, Some("People/Alice.md".into()));
    }

    #[test]
    fn resolve_by_stem_case_insensitive() {
        let ids = vec!["People/Alice.md".to_string()];
        let lookup = StemLookup::build(&ids, &empty_aliases());
        let r = lookup.resolve("alice");
        assert_eq!(r.tier, ResolutionTier::Stem);
        assert_eq!(r.node_id, Some("People/Alice.md".into()));
    }

    #[test]
    fn resolve_by_alias() {
        let ids = vec!["People/Alice.md".to_string()];
        let mut aliases = HashMap::new();
        aliases.insert(
            "People/Alice.md".to_string(),
            vec!["Ally".to_string()],
        );
        let lookup = StemLookup::build(&ids, &aliases);
        let r = lookup.resolve("Ally");
        assert_eq!(r.tier, ResolutionTier::Stem);
        assert_eq!(r.node_id, Some("People/Alice.md".into()));
    }

    #[test]
    fn resolve_by_path_suffix() {
        let ids = vec!["deep/a/Alice.md".to_string(), "deep/b/Alice.md".to_string()];
        let lookup = StemLookup::build(&ids, &empty_aliases());
        let r = lookup.resolve("a/Alice");
        assert_eq!(r.tier, ResolutionTier::PathSuffix);
        assert_eq!(r.node_id, Some("deep/a/Alice.md".into()));
    }

    #[test]
    fn resolve_ambiguous() {
        let ids = vec!["a/Note.md".to_string(), "b/Note.md".to_string()];
        let lookup = StemLookup::build(&ids, &empty_aliases());
        let r = lookup.resolve("Note");
        assert_eq!(r.tier, ResolutionTier::Ambiguous);
        assert_eq!(r.node_id, Some("a/Note.md".into()));
    }

    #[test]
    fn resolve_unresolved() {
        let ids = vec!["People/Alice.md".to_string()];
        let lookup = StemLookup::build(&ids, &empty_aliases());
        let r = lookup.resolve("Bob");
        assert_eq!(r.tier, ResolutionTier::Unresolved);
        assert_eq!(r.node_id, None);
    }

    #[test]
    fn stem_beats_path_suffix() {
        let ids = vec!["Alice.md".to_string(), "deep/People/Alice.md".to_string()];
        let lookup = StemLookup::build(&ids, &empty_aliases());
        // "Alice" matches "Alice.md" exactly (exact path with .md append)
        let r = lookup.resolve("Alice");
        assert_eq!(r.tier, ResolutionTier::ExactPath);
        assert_eq!(r.node_id, Some("Alice.md".into()));
    }

    #[test]
    fn exact_beats_stem() {
        let ids = vec![
            "Alice.md".to_string(),
            "People/Alice.md".to_string(),
        ];
        let lookup = StemLookup::build(&ids, &empty_aliases());
        let r = lookup.resolve("Alice.md");
        assert_eq!(r.tier, ResolutionTier::ExactPath);
        assert_eq!(r.node_id, Some("Alice.md".into()));
    }

    #[test]
    fn alias_does_not_shadow_real_stem() {
        // Both "People/Ally.md" (real file) and "People/Alice.md" (via alias "Ally")
        // map to stem "ally". Stem tier is ambiguous, but path-suffix narrows
        // to the real file — alias doesn't shadow it.
        let ids = vec![
            "People/Ally.md".to_string(),
            "People/Alice.md".to_string(),
        ];
        let mut aliases = HashMap::new();
        aliases.insert(
            "People/Alice.md".to_string(),
            vec!["Ally".to_string()],
        );
        let lookup = StemLookup::build(&ids, &aliases);
        let r = lookup.resolve("Ally");
        assert_eq!(r.tier, ResolutionTier::PathSuffix);
        assert_eq!(r.node_id, Some("People/Ally.md".into()));
    }

    #[test]
    fn resolve_plain_target_without_section() {
        let ids = vec!["Notes/Topic.md".to_string()];
        let lookup = StemLookup::build(&ids, &empty_aliases());
        let r = lookup.resolve("Topic");
        assert_eq!(r.tier, ResolutionTier::Stem);
        assert_eq!(r.node_id, Some("Notes/Topic.md".into()));
    }
}
