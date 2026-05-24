use indexmap::IndexMap;
use serde_yaml::Value;

pub fn merge_frontmatter(sources: &[IndexMap<String, Value>]) -> IndexMap<String, Value> {
    let mut result = IndexMap::<String, Value>::new();

    for source in sources {
        for (key, value) in source {
            match result.get(key) {
                Some(existing) => {
                    let merged = merge_values(key, existing, value);
                    result.insert(key.clone(), merged);
                }
                None => {
                    result.insert(key.clone(), value.clone());
                }
            }
        }
    }

    result
}

fn merge_values(key: &str, existing: &Value, incoming: &Value) -> Value {
    if *incoming == Value::Null {
        return existing.clone();
    }
    if *existing == Value::Null {
        return incoming.clone();
    }

    let is_array_key = key == "tags" || matches!(existing, Value::Sequence(_)) || matches!(incoming, Value::Sequence(_));

    if is_array_key {
        let mut items: Vec<Value> = match existing {
            Value::Sequence(seq) => seq.clone(),
            Value::Null => vec![],
            other => vec![other.clone()],
        };

        match incoming {
            Value::Sequence(seq) => {
                for v in seq {
                    if !items.contains(v) {
                        items.push(v.clone());
                    }
                }
            }
            Value::Null => {}
            other => {
                if !items.contains(other) {
                    items.push(other.clone());
                }
            }
        }

        Value::Sequence(items)
    } else if existing == incoming {
        existing.clone()
    } else {
        // Scalar or mapping conflict → accumulate into array
        let mut items = match existing {
            Value::Sequence(seq) => seq.clone(),
            other => vec![other.clone()],
        };
        if !items.contains(incoming) {
            items.push(incoming.clone());
        }
        Value::Sequence(items)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_fm(pairs: &[(&str, Value)]) -> IndexMap<String, Value> {
        pairs.iter().map(|(k, v)| (k.to_string(), v.clone())).collect()
    }

    fn sv(s: &str) -> Value {
        Value::String(s.to_string())
    }

    fn make_tags(tags: &[&str]) -> Value {
        Value::Sequence(tags.iter().map(|t| sv(t)).collect())
    }

    // 1
    #[test]
    fn merge_empty_sources() {
        let result = merge_frontmatter(&[]);
        assert!(result.is_empty());
    }

    // 2
    #[test]
    fn merge_single_source() {
        let src = make_fm(&[("title", sv("Hello")), ("status", sv("draft"))]);
        let result = merge_frontmatter(&[src.clone()]);
        assert_eq!(result, src);
    }

    // 3
    #[test]
    fn merge_union_of_keys() {
        let a = make_fm(&[("a", sv("1"))]);
        let b = make_fm(&[("b", sv("2"))]);
        let result = merge_frontmatter(&[a, b]);
        assert_eq!(result.get("a"), Some(&sv("1")));
        assert_eq!(result.get("b"), Some(&sv("2")));
        assert_eq!(result.len(), 2);
    }

    // 4
    #[test]
    fn merge_scalar_agreement() {
        let a = make_fm(&[("status", sv("draft"))]);
        let b = make_fm(&[("status", sv("draft"))]);
        let result = merge_frontmatter(&[a, b]);
        assert_eq!(result.get("status"), Some(&sv("draft")));
    }

    // 5
    #[test]
    fn merge_scalar_conflict() {
        let a = make_fm(&[("status", sv("draft"))]);
        let b = make_fm(&[("status", sv("done"))]);
        let result = merge_frontmatter(&[a, b]);
        assert_eq!(
            result.get("status"),
            Some(&Value::Sequence(vec![sv("draft"), sv("done")]))
        );
    }

    // 6
    #[test]
    fn merge_scalar_conflict_three_sources() {
        let a = make_fm(&[("status", sv("draft"))]);
        let b = make_fm(&[("status", sv("done"))]);
        let c = make_fm(&[("status", sv("archived"))]);
        let result = merge_frontmatter(&[a, b, c]);
        assert_eq!(
            result.get("status"),
            Some(&Value::Sequence(vec![
                sv("draft"),
                sv("done"),
                sv("archived")
            ]))
        );
    }

    // 7
    #[test]
    fn merge_scalar_conflict_with_duplicates() {
        let a = make_fm(&[("status", sv("draft"))]);
        let b = make_fm(&[("status", sv("done"))]);
        let c = make_fm(&[("status", sv("draft"))]);
        let result = merge_frontmatter(&[a, b, c]);
        assert_eq!(
            result.get("status"),
            Some(&Value::Sequence(vec![sv("draft"), sv("done")]))
        );
    }

    // 8
    #[test]
    fn merge_tags_union() {
        let a = make_fm(&[("tags", make_tags(&["a", "b"]))]);
        let b = make_fm(&[("tags", make_tags(&["b", "c"]))]);
        let result = merge_frontmatter(&[a, b]);
        assert_eq!(result.get("tags"), Some(&make_tags(&["a", "b", "c"])));
    }

    // 9
    #[test]
    fn merge_tags_from_scalar() {
        let a = make_fm(&[("tags", sv("rust"))]);
        let b = make_fm(&[("tags", make_tags(&["python"]))]);
        let result = merge_frontmatter(&[a, b]);
        assert_eq!(
            result.get("tags"),
            Some(&make_tags(&["rust", "python"]))
        );
    }

    // 10
    #[test]
    fn merge_tags_all_scalars() {
        let a = make_fm(&[("tags", sv("rust"))]);
        let b = make_fm(&[("tags", sv("python"))]);
        let result = merge_frontmatter(&[a, b]);
        assert_eq!(
            result.get("tags"),
            Some(&make_tags(&["rust", "python"]))
        );
    }

    // 11
    #[test]
    fn merge_tags_dedup() {
        let a = make_fm(&[("tags", make_tags(&["a", "b"]))]);
        let b = make_fm(&[("tags", make_tags(&["a", "c"]))]);
        let result = merge_frontmatter(&[a, b]);
        assert_eq!(result.get("tags"), Some(&make_tags(&["a", "b", "c"])));
    }

    // 12
    #[test]
    fn merge_tags_one_source_only() {
        let a = make_fm(&[("title", sv("Hello"))]);
        let b = make_fm(&[("tags", make_tags(&["rust", "tauri"]))]);
        let result = merge_frontmatter(&[a, b]);
        assert_eq!(
            result.get("tags"),
            Some(&make_tags(&["rust", "tauri"]))
        );
    }

    // 13
    #[test]
    fn merge_array_concat_dedup() {
        let a = make_fm(&[("aliases", make_tags(&["a", "b"]))]);
        let b = make_fm(&[("aliases", make_tags(&["b", "c"]))]);
        let result = merge_frontmatter(&[a, b]);
        assert_eq!(
            result.get("aliases"),
            Some(&make_tags(&["a", "b", "c"]))
        );
    }

    // 14
    #[test]
    fn merge_array_preserves_order() {
        let a = make_fm(&[("aliases", make_tags(&["x", "y"]))]);
        let b = make_fm(&[("aliases", make_tags(&["a", "y", "z"]))]);
        let result = merge_frontmatter(&[a, b]);
        assert_eq!(
            result.get("aliases"),
            Some(&make_tags(&["x", "y", "a", "z"]))
        );
    }

    // 15
    #[test]
    fn merge_mixed_scalar_and_array() {
        let a = make_fm(&[("aliases", sv("foo"))]);
        let b = make_fm(&[("aliases", make_tags(&["bar"]))]);
        let result = merge_frontmatter(&[a, b]);
        assert_eq!(
            result.get("aliases"),
            Some(&make_tags(&["foo", "bar"]))
        );
    }

    // 16
    #[test]
    fn merge_mixed_array_and_scalar() {
        let a = make_fm(&[("aliases", make_tags(&["bar"]))]);
        let b = make_fm(&[("aliases", sv("foo"))]);
        let result = merge_frontmatter(&[a, b]);
        assert_eq!(
            result.get("aliases"),
            Some(&make_tags(&["bar", "foo"]))
        );
    }

    // 17
    #[test]
    fn merge_key_order_follows_first_source() {
        let a = make_fm(&[("z", sv("1")), ("a", sv("2")), ("m", sv("3"))]);
        let b = make_fm(&[("a", sv("2")), ("x", sv("4"))]);
        let result = merge_frontmatter(&[a, b]);
        let keys: Vec<&String> = result.keys().collect();
        assert_eq!(keys, vec!["z", "a", "m", "x"]);
    }

    // 18
    #[test]
    fn merge_key_order_new_keys_appended() {
        let a = make_fm(&[("first", sv("1"))]);
        let b = make_fm(&[("second", sv("2"))]);
        let c = make_fm(&[("third", sv("3"))]);
        let result = merge_frontmatter(&[a, b, c]);
        let keys: Vec<&String> = result.keys().collect();
        assert_eq!(keys, vec!["first", "second", "third"]);
    }

    // 19
    #[test]
    fn merge_null_skipped() {
        let a = make_fm(&[("a", Value::Null)]);
        let b = make_fm(&[("a", sv("hello"))]);
        let result = merge_frontmatter(&[a, b]);
        assert_eq!(result.get("a"), Some(&sv("hello")));
    }

    // 20
    #[test]
    fn merge_all_null() {
        let a = make_fm(&[("a", Value::Null)]);
        let b = make_fm(&[("a", Value::Null)]);
        let result = merge_frontmatter(&[a, b]);
        assert_eq!(result.get("a"), Some(&Value::Null));
    }

    // 21
    #[test]
    fn merge_null_with_array() {
        let a = make_fm(&[("tags", Value::Null)]);
        let b = make_fm(&[("tags", make_tags(&["a"]))]);
        let result = merge_frontmatter(&[a, b]);
        assert_eq!(result.get("tags"), Some(&make_tags(&["a"])));
    }

    // 22
    #[test]
    fn merge_mapping_agreement() {
        let mut map = serde_yaml::Mapping::new();
        map.insert(Value::String("key".into()), Value::String("value".into()));
        let mapping = Value::Mapping(map);

        let a = make_fm(&[("nested", mapping.clone())]);
        let b = make_fm(&[("nested", mapping.clone())]);
        let result = merge_frontmatter(&[a, b]);
        assert_eq!(result.get("nested"), Some(&mapping));
    }

    // 23
    #[test]
    fn merge_mapping_conflict() {
        let mut map1 = serde_yaml::Mapping::new();
        map1.insert(Value::String("key".into()), Value::String("val1".into()));
        let mut map2 = serde_yaml::Mapping::new();
        map2.insert(Value::String("key".into()), Value::String("val2".into()));

        let a = make_fm(&[("nested", Value::Mapping(map1.clone()))]);
        let b = make_fm(&[("nested", Value::Mapping(map2.clone()))]);
        let result = merge_frontmatter(&[a, b]);
        assert_eq!(
            result.get("nested"),
            Some(&Value::Sequence(vec![
                Value::Mapping(map1),
                Value::Mapping(map2),
            ]))
        );
    }

    // 24
    #[test]
    fn merge_bool_values_agreement() {
        let a = make_fm(&[("published", Value::Bool(true))]);
        let b = make_fm(&[("published", Value::Bool(true))]);
        let result = merge_frontmatter(&[a, b]);
        assert_eq!(result.get("published"), Some(&Value::Bool(true)));
    }

    // 25
    #[test]
    fn merge_bool_values_conflict() {
        let a = make_fm(&[("published", Value::Bool(true))]);
        let b = make_fm(&[("published", Value::Bool(false))]);
        let result = merge_frontmatter(&[a, b]);
        assert_eq!(
            result.get("published"),
            Some(&Value::Sequence(vec![
                Value::Bool(true),
                Value::Bool(false),
            ]))
        );
    }

    // 26
    #[test]
    fn merge_number_values() {
        let n1 = Value::Number(serde_yaml::Number::from(1));
        let n2 = Value::Number(serde_yaml::Number::from(2));
        let a = make_fm(&[("priority", n1.clone())]);
        let b = make_fm(&[("priority", n2.clone())]);
        let result = merge_frontmatter(&[a, b]);
        assert_eq!(
            result.get("priority"),
            Some(&Value::Sequence(vec![n1, n2]))
        );
    }

    // 27
    #[test]
    fn merge_many_sources() {
        let s1 = make_fm(&[
            ("title", sv("Note A")),
            ("tags", make_tags(&["rust", "dev"])),
            ("status", sv("draft")),
        ]);
        let s2 = make_fm(&[
            ("title", sv("Note B")),
            ("tags", make_tags(&["dev", "tauri"])),
            ("author", sv("Alice")),
        ]);
        let s3 = make_fm(&[
            ("title", sv("Note A")),
            ("tags", make_tags(&["rust", "wasm"])),
            ("priority", Value::Number(serde_yaml::Number::from(1))),
        ]);
        let s4 = make_fm(&[
            ("status", sv("done")),
            ("author", sv("Alice")),
        ]);
        let s5 = make_fm(&[
            ("tags", make_tags(&["tauri", "new-tag"])),
            ("extra", sv("info")),
        ]);

        let result = merge_frontmatter(&[s1, s2, s3, s4, s5]);

        // title: conflict "Note A" + "Note B" + "Note A" → [Note A, Note B] (deduped)
        assert_eq!(
            result.get("title"),
            Some(&Value::Sequence(vec![sv("Note A"), sv("Note B")]))
        );
        // tags: union of all → [rust, dev, tauri, wasm, new-tag]
        assert_eq!(
            result.get("tags"),
            Some(&make_tags(&["rust", "dev", "tauri", "wasm", "new-tag"]))
        );
        // status: draft + done → [draft, done]
        assert_eq!(
            result.get("status"),
            Some(&Value::Sequence(vec![sv("draft"), sv("done")]))
        );
        // author: Alice + Alice → Alice (agreement)
        assert_eq!(result.get("author"), Some(&sv("Alice")));
        // priority: single source → 1
        assert_eq!(
            result.get("priority"),
            Some(&Value::Number(serde_yaml::Number::from(1)))
        );
        // extra: single source → "info"
        assert_eq!(result.get("extra"), Some(&sv("info")));
        assert_eq!(result.len(), 6);
    }
}
