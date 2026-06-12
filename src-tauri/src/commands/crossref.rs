use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;

use serde::Serialize;
use turboref_core::document::Document;
use turboref_core::template;
use turboref_core::types::{Definition, ResolvedCitation, ResolvedDefinitionTag};

use crate::bib::cache::BibCache;
use crate::bib::types::BibEntry;
use crate::preferences;

#[derive(Serialize)]
pub struct AllDecorations {
    pub citations: Vec<ResolvedCitation>,
    pub definition_tags: Vec<ResolvedDefinitionTag>,
}

#[tauri::command]
pub fn resolve_all_decorations(
    content: String,
    frontmatter: Option<serde_json::Map<String, serde_json::Value>>,
    app_handle: tauri::AppHandle,
) -> AllDecorations {
    let prefs = preferences::read_preferences(&app_handle);
    let config =
        preferences::crossref_config_from_preferences(&prefs, frontmatter.as_ref());
    let doc = Document::parse(&content, config);
    let citations = doc.resolve_all();
    let definition_tags = doc.resolve_definition_tags(&content);
    AllDecorations {
        citations,
        definition_tags,
    }
}

#[tauri::command]
pub fn get_definitions(
    content: String,
    frontmatter: Option<serde_json::Map<String, serde_json::Value>>,
    app_handle: tauri::AppHandle,
) -> Vec<Definition> {
    let t_start = std::time::Instant::now();
    let prefs = preferences::read_preferences(&app_handle);
    let config =
        preferences::crossref_config_from_preferences(&prefs, frontmatter.as_ref());
    let doc = Document::parse(&content, config);
    let defs = doc.get_definitions().to_vec();
    tracing::info!(
        content_len = content.len(),
        defs = defs.len(),
        total_ms = t_start.elapsed().as_millis() as u64,
        "perf: get_definitions"
    );
    defs
}

#[tauri::command]
pub fn expand_template(
    template: String,
    filename: Option<String>,
    index: Option<u32>,
    ext: Option<String>,
) -> String {
    let ctx = template::TemplateContext {
        filename,
        index,
        ext,
    };
    template::expand(&template, &ctx)
}

#[tauri::command]
pub fn resolve_bib_entries(
    bib_paths: Vec<String>,
    note_dir: String,
    cache: tauri::State<BibCache>,
) -> Vec<BibEntry> {
    let mut all_entries = Vec::new();
    let note_dir_path = PathBuf::from(&note_dir);

    let resolved = crate::bib::resolver::resolve_bib_paths(&bib_paths, &note_dir_path);

    for path in resolved {
        let content = match fs::read_to_string(&path) {
            Ok(c) => c,
            Err(_) => continue,
        };
        let mtime = fs::metadata(&path)
            .and_then(|m| m.modified())
            .unwrap_or(std::time::SystemTime::UNIX_EPOCH);

        let mut entries = cache.get_or_parse(&path, &content, mtime);
        let path_str = path.to_string_lossy().to_string();
        for entry in &mut entries {
            entry.bib_file = Some(path_str.clone());
        }
        all_entries.extend(entries);
    }

    all_entries
}

#[tauri::command]
pub fn render_bib_citations(entries: Vec<BibEntry>) -> HashMap<String, String> {
    crate::bib::renderer::render_bib_citations(&entries)
}
