use serde::Deserialize;
use std::sync::Arc;
use tauri::State;

use crate::annotation::marks::{sorted_mark_codes, MarkConfig, MarkConfigCache};
use crate::annotation::parser::parse_annotations as do_parse;
use crate::annotation::scope_resolver::{
    resolve_scope_range, resolve_scope_range_with_mode, ScopeResolveCtx,
};
use crate::annotation::types::{Annotation, ResolutionMode, Scope, ScopeRange};

#[tauri::command]
pub fn parse_annotations(
    window: tauri::Window,
    workspace_state: State<crate::commands::workspace::WorkspaceRegistry>,
    mark_cache: State<MarkConfigCache>,
    content: String,
) -> Result<Vec<Annotation>, String> {
    let root = crate::commands::workspace::get_workspace_root(&workspace_state, window.label())?;
    let codes = sorted_mark_codes(&mark_cache.merged_config_cached(&root));
    Ok(do_parse(&content, &codes))
}

#[tauri::command]
pub fn resolve_annotation_scope(
    content: String,
    char_start: usize,
    scope: Scope,
    lang: String,
) -> Option<ScopeRange> {
    resolve_scope_range(&content, char_start, &scope, &lang)
}

#[tauri::command]
pub fn resolve_annotation_scope_with_mode(
    content: String,
    char_start: usize,
    scope: Scope,
    lang: String,
    mode: Option<ResolutionMode>,
) -> Option<ScopeRange> {
    let mode = mode.unwrap_or_default();
    resolve_scope_range_with_mode(&content, char_start, &scope, &lang, &mode)
}

/// One mark's scope-resolution request: where the mark sits, the scope it
/// spans, and optionally the segmentation language it resolved to on the
/// frontend (annotation `lang=` over document frontmatter).
#[derive(Debug, Clone, Deserialize)]
pub struct MarkScopeRequest {
    pub char_start: usize,
    pub scope: Scope,
    #[serde(default)]
    pub lang: Option<String>,
}

/// Batched scope resolution: resolves every mark in `marks` in a single IPC call,
/// returning results index-aligned with the input (`None` for unresolvable marks).
/// One `ScopeResolveCtx` is shared per distinct effective language so sentence
/// segmentation and the UTF-16 offset map are computed once per content per
/// language; each mark then selects its sentences by byte span out of that
/// shared segmentation. The top-level `lang` is the batch fallback for marks
/// that carry none of their own.
#[tauri::command]
pub fn resolve_mark_scopes(
    content: String,
    marks: Vec<MarkScopeRequest>,
    lang: String,
) -> Vec<Option<ScopeRange>> {
    use std::collections::hash_map::Entry;
    use std::collections::HashMap;

    let mut ctxs: HashMap<String, ScopeResolveCtx> = HashMap::new();
    marks
        .iter()
        .map(|m| {
            let key = crate::annotation::lang::effective_lang(
                m.lang.as_deref(),
                None,
                Some(&lang),
            );
            let ctx = match ctxs.entry(key) {
                Entry::Occupied(e) => e.into_mut(),
                Entry::Vacant(v) => {
                    let ctx = ScopeResolveCtx::new(&content, v.key());
                    v.insert(ctx)
                }
            };
            ctx.resolve_scope_range(m.char_start, &m.scope)
        })
        .collect()
}

#[tauri::command]
pub fn search_annotations(
    window: tauri::Window,
    workspace_state: State<crate::commands::workspace::WorkspaceRegistry>,
    graph_state: State<Arc<super::graph::GraphRegistry>>,
    query: String,
    annotation_type: Option<String>,
    limit: Option<i64>,
) -> Result<serde_json::Value, String> {
    super::graph::with_graph_index(&workspace_state, &graph_state, window.label(), |gi| {
        let results = gi.search_annotations(
            &query,
            annotation_type.as_deref(),
            limit.unwrap_or(20),
        )?;
        serde_json::to_value(results)
            .map_err(|e| crate::graph::error::GraphError::Other(e.to_string()))
    })
}

#[tauri::command]
pub fn list_annotations(
    window: tauri::Window,
    workspace_state: State<crate::commands::workspace::WorkspaceRegistry>,
    graph_state: State<Arc<super::graph::GraphRegistry>>,
    node_id: Option<String>,
    annotation_type: Option<String>,
    limit: Option<i64>,
) -> Result<serde_json::Value, String> {
    super::graph::with_graph_index(&workspace_state, &graph_state, window.label(), |gi| {
        let results = gi.list_annotations(
            node_id.as_deref(),
            annotation_type.as_deref(),
            limit.unwrap_or(100),
        )?;
        serde_json::to_value(results)
            .map_err(|e| crate::graph::error::GraphError::Other(e.to_string()))
    })
}

#[tauri::command]
pub fn annotation_find_uuid(
    window: tauri::Window,
    workspace_state: State<crate::commands::workspace::WorkspaceRegistry>,
    graph_state: State<Arc<super::graph::GraphRegistry>>,
    node_id: String,
    annotation_type: String,
    body: Option<String>,
    char_start_hint: usize,
) -> Result<Option<String>, String> {
    super::graph::with_graph_index(&workspace_state, &graph_state, window.label(), |gi| {
        gi.find_annotation_uuid(&node_id, &annotation_type, body.as_deref(), char_start_hint)
    })
}

#[tauri::command]
pub fn migrate_annotations(content: String) -> String {
    use crate::annotation::scanner::{find_fenced_ranges, is_in_fenced_range};

    let fenced_ranges = find_fenced_ranges(&content);
    let re = regex::Regex::new(r"(?s)%%!(.*?)%%").unwrap();

    let mut result = String::with_capacity(content.len());
    let mut last_end = 0;

    for m in re.find_iter(&content) {
        if is_in_fenced_range(m.start(), &fenced_ranges) {
            // Inside a fenced code block — keep the original text unchanged
            continue;
        }
        result.push_str(&content[last_end..m.start()]);
        let caps = re.captures(m.as_str()).unwrap();
        let inner = &caps[1];
        result.push_str("<!---");
        result.push_str(inner);
        result.push_str("--->");
        last_end = m.end();
    }
    result.push_str(&content[last_end..]);
    result
}

/// Built-in mark defaults merged with the window's workspace `.lit/marks.toml`.
#[tauri::command]
pub fn get_mark_config(
    window: tauri::Window,
    workspace_state: State<crate::commands::workspace::WorkspaceRegistry>,
    mark_cache: State<MarkConfigCache>,
) -> Result<MarkConfig, String> {
    let root = crate::commands::workspace::get_workspace_root(&workspace_state, window.label())?;
    Ok(mark_cache.merged_config_cached(&root))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::annotation::lang::AnnotationIndexOpts;
    use crate::annotation::marks::merged_config;
    use crate::annotation::scope_resolver::extract_text_for_range;
    use crate::annotation::types::{AnnotationType, ResolutionMode};
    use crate::graph::indexer::GraphIndex;

    // The `parse_annotations` command itself takes a `tauri::Window` + `State`,
    // which are impractical to construct in a unit test (same constraint as the
    // graph + `get_mark_config` commands). These tests exercise the command's
    // underlying parse logic via the builtin wrapper.
    use crate::annotation::parser::parse_annotations_builtin;

    #[test]
    fn cmd_parse_annotations_compact() {
        let result = parse_annotations_builtin("<!--- n: | note --->");
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].annotation_type, AnnotationType::Note);
    }

    #[test]
    fn cmd_parse_annotations_empty() {
        let result = parse_annotations_builtin("");
        assert!(result.is_empty());
    }

    #[test]
    fn cmd_resolve_scope_words() {
        let content = "hello world <!--- n: _ | note --->".to_string();
        let result = resolve_annotation_scope(
            content,
            12,
            Scope::Words(1),
            "en".to_string(),
        );
        assert!(result.is_some());
        assert_eq!(result.unwrap(), ScopeRange { start: 6, end: 11 });
    }

    #[test]
    fn cmd_resolve_scope_none() {
        let content = "<!--- n: _ | note --->".to_string();
        let result = resolve_annotation_scope(
            content,
            0,
            Scope::Words(1),
            "en".to_string(),
        );
        assert_eq!(result, None);
    }

    #[test]
    fn cmd_resolve_mark_scopes_batches() {
        let content = "hello world <!--- n: _ | note --->".to_string();
        let marks = vec![MarkScopeRequest {
            char_start: 12,
            scope: Scope::Words(1),
            lang: None,
        }];
        let result = resolve_mark_scopes(content, marks, "en".to_string());
        assert_eq!(result, vec![Some(ScopeRange { start: 6, end: 11 })]);
    }

    #[test]
    fn cmd_resolve_mark_scopes_preserves_none_and_order() {
        let content = "hello world <!--- n: _ | note --->".to_string();
        let marks = vec![
            MarkScopeRequest {
                char_start: 0,
                scope: Scope::Words(1),
                lang: None,
            },
            MarkScopeRequest {
                char_start: 12,
                scope: Scope::Words(1),
                lang: None,
            },
        ];
        let result = resolve_mark_scopes(content, marks, "en".to_string());
        assert_eq!(
            result,
            vec![None, Some(ScopeRange { start: 6, end: 11 })]
        );
    }

    #[test]
    fn cmd_resolve_mark_scopes_empty() {
        let result = resolve_mark_scopes("anything".to_string(), vec![], "en".to_string());
        assert!(result.is_empty());
    }

    #[test]
    fn cmd_resolve_mark_scopes_mixed_scope_kinds() {
        // One batch mixing sentence and word scopes against the same content
        // must agree with resolving each mark independently.
        let content = "The dog ran. The cat sat. <!--- n ---> tail".to_string();
        let cs = 26; // annotation marker start
        let marks = vec![
            MarkScopeRequest { char_start: cs, scope: Scope::Sentence(1), lang: None },
            MarkScopeRequest { char_start: cs, scope: Scope::Words(2), lang: None },
            MarkScopeRequest { char_start: 0, scope: Scope::Sentence(1), lang: None },
            MarkScopeRequest { char_start: cs, scope: Scope::Sentence(2), lang: None },
        ];
        let batched = resolve_mark_scopes(content.clone(), marks.clone(), "en".to_string());
        let single: Vec<Option<ScopeRange>> = marks
            .iter()
            .map(|m| resolve_annotation_scope(content.clone(), m.char_start, m.scope.clone(), "en".to_string()))
            .collect();
        assert_eq!(batched, single);
        assert_eq!(batched[0], Some(ScopeRange { start: 13, end: 25 }));
        assert_eq!(batched[2], None, "no text before offset 0");
    }

    /// The per-mark `lang` overrides the batch-level fallback, so one call can
    /// carry marks resolved under different segmentation languages (#854).
    #[test]
    fn cmd_resolve_mark_scopes_honours_per_mark_lang() {
        let body = "Voir p.ex. le chap. 3 ici. Ensuite la suite.";
        let cs = body.find("Ensuite").unwrap();
        let marks = vec![
            MarkScopeRequest { char_start: cs, scope: Scope::Sentence(1), lang: None },
            MarkScopeRequest {
                char_start: cs,
                scope: Scope::Sentence(1),
                lang: Some("fr".to_string()),
            },
            MarkScopeRequest {
                char_start: cs,
                scope: Scope::Sentence(1),
                lang: Some("en".to_string()),
            },
        ];
        let result = resolve_mark_scopes(body.to_string(), marks, "en".to_string());
        let texts: Vec<Option<String>> = result
            .iter()
            .map(|r| r.as_ref().map(|r| extract_text_for_range(body, r)))
            .collect();
        assert_eq!(texts[0].as_deref(), Some("3 ici."), "no mark lang falls back to the batch lang");
        assert_eq!(texts[1].as_deref(), Some("Voir p.ex. le chap. 3 ici."));
        assert_eq!(texts[2].as_deref(), Some("3 ici."));
    }

    #[test]
    fn cmd_resolve_mark_scopes_normalizes_per_mark_lang() {
        let body = "Voir p.ex. le chap. 3 ici. Ensuite la suite.";
        let cs = body.find("Ensuite").unwrap();
        let marks = vec![MarkScopeRequest {
            char_start: cs,
            scope: Scope::Sentence(1),
            lang: Some("FR-CA".to_string()),
        }];
        let result = resolve_mark_scopes(body.to_string(), marks, "en".to_string());
        let r = result[0].as_ref().unwrap();
        assert_eq!(extract_text_for_range(body, r), "Voir p.ex. le chap. 3 ici.");
    }

    #[test]
    fn cmd_resolve_scope_with_mode_backward() {
        let content = "hello world <!--- n --->".to_string();
        let result_new = resolve_annotation_scope_with_mode(
            content.clone(), 12, Scope::Words(1), "en".to_string(), None,
        );
        let result_old = resolve_annotation_scope(content, 12, Scope::Words(1), "en".to_string());
        assert_eq!(result_new, result_old);
    }

    #[test]
    fn cmd_resolve_scope_with_mode_bidirectional() {
        let content = "before <!--- n ---> after word".to_string();
        let result = resolve_annotation_scope_with_mode(
            content, 7, Scope::Words(1), "en".to_string(),
            Some(ResolutionMode::Bidirectional),
        );
        assert!(result.is_some());
        assert!(result.unwrap().end > 7);
    }

    fn create_workspace() -> tempfile::TempDir {
        tempfile::tempdir().unwrap()
    }

    fn write_md(root: &std::path::Path, rel_path: &str, content: &str) {
        let abs = root.join(rel_path);
        if let Some(parent) = abs.parent() {
            std::fs::create_dir_all(parent).unwrap();
        }
        std::fs::write(abs, content).unwrap();
    }

    #[test]
    fn cmd_search_annotations() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "Some text <!--- n: _ | Silk Road flourished ---> more.");
        let gi = GraphIndex::build(dir.path().to_path_buf(), &AnnotationIndexOpts::default()).unwrap();
        let results = gi.search_annotations("Silk Road", None, 20).unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].node_id, "a.md");
        assert!(results[0].body.as_deref().unwrap().contains("Silk Road"));
    }

    #[test]
    fn cmd_list_annotations() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "<!--- n: _ | first ---> text <!--- q: _ | second --->");
        let gi = GraphIndex::build(dir.path().to_path_buf(), &AnnotationIndexOpts::default()).unwrap();
        let results = gi.list_annotations(Some("a.md"), None, 100).unwrap();
        assert_eq!(results.len(), 2);
    }

    #[test]
    fn cmd_list_annotations_filtered() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "<!--- n: _ | note body ---> and <!--- q: _ | question body --->");
        let gi = GraphIndex::build(dir.path().to_path_buf(), &AnnotationIndexOpts::default()).unwrap();
        let results = gi.list_annotations(Some("a.md"), Some("note"), 100).unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].annotation_type, "note");
    }

    #[test]
    fn cmd_list_annotations_vault_wide() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "<!--- n: _ | alpha note --->");
        write_md(dir.path(), "b.md", "<!--- q: _ | beta question --->");
        let gi = GraphIndex::build(dir.path().to_path_buf(), &AnnotationIndexOpts::default()).unwrap();
        let results = gi.list_annotations(None, None, 100).unwrap();
        assert_eq!(results.len(), 2);
        let node_ids: Vec<&str> = results.iter().map(|r| r.node_id.as_str()).collect();
        assert!(node_ids.contains(&"a.md"));
        assert!(node_ids.contains(&"b.md"));
    }

    #[test]
    fn cmd_annotation_find_uuid() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "<!--- q: _ | What does this mean? ---> hello");
        let gi = GraphIndex::build(dir.path().to_path_buf(), &AnnotationIndexOpts::default()).unwrap();
        let uuid = gi.find_annotation_uuid("a.md", "question", Some("What does this mean?"), 0).unwrap();
        assert!(uuid.is_some());
        assert!(!uuid.unwrap().is_empty());
    }

    #[test]
    fn cmd_annotation_find_uuid_missing() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "<!--- n: _ | note --->");
        let gi = GraphIndex::build(dir.path().to_path_buf(), &AnnotationIndexOpts::default()).unwrap();
        let uuid = gi.find_annotation_uuid("a.md", "question", Some("nonexistent"), 0).unwrap();
        assert!(uuid.is_none());
    }

    // --- migrate_annotations tests ---

    #[test]
    fn cmd_migrate_compact() {
        let result = migrate_annotations("%%! n | body %%".to_string());
        assert_eq!(result, "<!--- n | body --->");
    }

    #[test]
    fn cmd_migrate_block() {
        let result = migrate_annotations("%%!\nn\n---\nbody\n%%".to_string());
        assert_eq!(result, "<!---\nn\n---\nbody\n--->");
    }

    #[test]
    fn cmd_migrate_mixed_with_text() {
        let input = "before %%! n | note %% middle %%! q | question %% after";
        let result = migrate_annotations(input.to_string());
        assert_eq!(result, "before <!--- n | note ---> middle <!--- q | question ---> after");
    }

    #[test]
    fn cmd_migrate_idempotent() {
        let already_migrated = "<!--- n | body --->";
        let result = migrate_annotations(already_migrated.to_string());
        assert_eq!(result, already_migrated);
    }

    #[test]
    fn cmd_migrate_parses_identically() {
        let old = "%%! n: _ | a note %%";
        let migrated = migrate_annotations(old.to_string());
        let old_anns = parse_annotations_builtin(old);
        let new_anns = parse_annotations_builtin(&migrated);
        assert_eq!(old_anns.len(), new_anns.len());
        assert_eq!(old_anns[0].annotation_type, new_anns[0].annotation_type);
        assert_eq!(old_anns[0].body, new_anns[0].body);
        assert_eq!(old_anns[0].scope, new_anns[0].scope);
    }

    // --- migrate_annotations fence-awareness tests ---

    #[test]
    fn cmd_migrate_skips_fenced_code_block() {
        let input = "before\n```\n%%! n | inside fence %%\n```\nafter";
        let result = migrate_annotations(input.to_string());
        assert_eq!(result, input, "%%! inside a fenced code block must not be migrated");
    }

    #[test]
    fn cmd_migrate_outside_fence() {
        let input = "text %%! n | outside %% end";
        let result = migrate_annotations(input.to_string());
        assert_eq!(result, "text <!--- n | outside ---> end");
    }

    #[test]
    fn cmd_migrate_mixed_fenced_and_unfenced() {
        let input = "%%! n | free %% then\n```\n%%! n | caged %%\n```\nand %%! q | also free %%";
        let result = migrate_annotations(input.to_string());
        let expected = "<!--- n | free ---> then\n```\n%%! n | caged %%\n```\nand <!--- q | also free --->";
        assert_eq!(result, expected);
    }

    #[test]
    fn cmd_list_annotations_vault_wide_with_type_filter() {
        let dir = create_workspace();
        write_md(dir.path(), "a.md", "<!--- n: _ | alpha note ---> and <!--- q: _ | alpha question --->");
        write_md(dir.path(), "b.md", "<!--- n: _ | beta note --->");
        let gi = GraphIndex::build(dir.path().to_path_buf(), &AnnotationIndexOpts::default()).unwrap();
        let results = gi.list_annotations(None, Some("note"), 100).unwrap();
        assert_eq!(results.len(), 2);
        assert!(results.iter().all(|r| r.annotation_type == "note"));
    }

    // --- get_mark_config tests ---
    //
    // `get_mark_config` itself takes a `tauri::Window` + `State`, which are
    // impractical to construct in a unit test (same constraint as the graph
    // commands above, which exercise `GraphIndex` directly). These tests cover
    // the command's actual logic — `merged_config` + serialization + the
    // `get_workspace_root` error path — which together lock the command's
    // contract.

    use crate::commands::workspace::{get_workspace_root, WorkspaceEntry, WorkspaceRegistry};
    use std::collections::HashMap;
    use std::sync::Mutex;

    #[test]
    fn cmd_get_mark_config_returns_builtin_defaults() {
        let dir = create_workspace();
        let cfg = merged_config(dir.path());
        assert_eq!(cfg.0.len(), 16, "expected exactly 16 builtin mark codes");
        assert!(cfg.0.contains_key("nb"));
    }

    #[test]
    fn cmd_get_mark_config_serializes_to_json_object() {
        let dir = create_workspace();
        let cfg = merged_config(dir.path());
        let v = serde_json::to_value(&cfg).unwrap();
        assert!(v.is_object(), "MarkConfig must serialize to a code-keyed object");
        assert_eq!(
            v.get("nb")
                .and_then(|n| n.get("label"))
                .and_then(|l| l.as_str()),
            Some("nota bene")
        );
    }

    #[test]
    fn cmd_get_mark_config_merges_workspace_override() {
        let dir = create_workspace();
        std::fs::create_dir_all(dir.path().join(".lit")).unwrap();
        std::fs::write(
            dir.path().join(".lit").join("marks.toml"),
            "[nb]\nlabel = \"custom bold\"\n\n[zz]\nlabel = \"custom code\"\n",
        )
        .unwrap();
        let cfg = merged_config(dir.path());
        assert_eq!(cfg.0.get("nb").unwrap().label, "custom bold");
        assert!(cfg.0.contains_key("crux"));
        assert_eq!(cfg.0.get("zz").unwrap().label, "custom code");
    }

    #[test]
    fn cmd_get_mark_config_unknown_label_errors() {
        // Documents the error path `get_mark_config` returns when no workspace
        // is open in the window.
        let registry = WorkspaceRegistry {
            workspaces: Mutex::new(HashMap::new()),
        };
        let result = get_workspace_root(&registry, "missing");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("missing"));
    }

    #[test]
    fn cmd_get_mark_config_resolves_known_workspace_root() {
        // A registered window resolves to its workspace root, which feeds
        // `merged_config` inside the command.
        let dir = create_workspace();
        let mut map = HashMap::new();
        map.insert(
            "test-win".to_string(),
            WorkspaceEntry {
                root: dir.path().to_path_buf(),
                watcher: None,
                companion_reverse_map: HashMap::new(),
            },
        );
        let registry = WorkspaceRegistry {
            workspaces: Mutex::new(map),
        };
        let root = get_workspace_root(&registry, "test-win").unwrap();
        let cfg = merged_config(&root);
        assert!(cfg.0.contains_key("nb"));
    }
}
