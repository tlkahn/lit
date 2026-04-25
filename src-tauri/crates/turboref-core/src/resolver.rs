use std::collections::HashMap;

use crate::types::{Definition, RefType};

/// Reference map for looking up definitions by ID.
pub struct ReferenceMap {
    definitions: HashMap<String, Definition>,
    by_type: HashMap<RefType, Vec<String>>,
}

impl ReferenceMap {
    pub fn from_definitions(defs: Vec<Definition>) -> Self {
        let mut definitions = HashMap::new();
        let mut by_type: HashMap<RefType, Vec<String>> = HashMap::new();

        for def in defs {
            by_type
                .entry(def.ref_type.clone())
                .or_default()
                .push(def.id.clone());
            definitions.insert(def.id.clone(), def);
        }

        Self {
            definitions,
            by_type,
        }
    }

    pub fn get(&self, id: &str) -> Option<&Definition> {
        self.definitions.get(id)
    }

    pub fn get_by_type(&self, ref_type: &RefType) -> &[String] {
        self.by_type
            .get(ref_type)
            .map(|v| v.as_slice())
            .unwrap_or(&[])
    }

    pub fn all_definitions(&self) -> Vec<&Definition> {
        self.definitions.values().collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::RefNumber;

    #[test]
    fn lookup_by_id() {
        let defs = vec![Definition {
            ref_type: RefType::Fig,
            id: "cat".to_string(),
            number: RefNumber::Simple(1),
            caption: Some("A cat".to_string()),
            line: 0,
            char_offset: 0,
        }];
        let map = ReferenceMap::from_definitions(defs);
        assert!(map.get("cat").is_some());
        assert!(map.get("dog").is_none());
    }

    #[test]
    fn lookup_by_type() {
        let defs = vec![
            Definition {
                ref_type: RefType::Fig,
                id: "cat".to_string(),
                number: RefNumber::Simple(1),
                caption: None,
                line: 0,
                char_offset: 0,
            },
            Definition {
                ref_type: RefType::Tbl,
                id: "data".to_string(),
                number: RefNumber::Simple(1),
                caption: None,
                line: 1,
                char_offset: 10,
            },
        ];
        let map = ReferenceMap::from_definitions(defs);
        assert_eq!(map.get_by_type(&RefType::Fig).len(), 1);
        assert_eq!(map.get_by_type(&RefType::Tbl).len(), 1);
        assert_eq!(map.get_by_type(&RefType::Eq).len(), 0);
    }
}
