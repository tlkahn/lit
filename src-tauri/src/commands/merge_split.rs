use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use indexmap::IndexMap;
use serde::Deserialize;
use serde_yaml::Value;
use tauri::State;
use tokio::sync::oneshot;
use tokio::task::JoinHandle;

use crate::commands::graph::GraphRegistry;
use crate::commands::oplog::OpLogRegistry;
use crate::commands::workspace::{get_workspace_root, WorkspaceRegistry};
use crate::llm;
use crate::oplog::store::Action;
use crate::workspace::merge::{self, MergeInput, MergePlan};
use crate::workspace::ops;
use crate::workspace::split::{self, SplitPlan};
use crate::workspace::split_execute;
use crate::workspace::write_hash::WriteHashRegistry;
use super::credential::CredentialStore;

pub struct TitleSuggestState {
    active: Arc<Mutex<Option<JoinHandle<()>>>>,
}

impl TitleSuggestState {
    pub fn new() -> Self {
        Self {
            active: Arc::new(Mutex::new(None)),
        }
    }

    pub fn set_active(&self, handle: JoinHandle<()>) {
        let mut guard = self.active.lock().unwrap();
        if let Some(old) = guard.take() {
            old.abort();
        }
        *guard = Some(handle);
    }

    pub fn cancel(&self) {
        let mut guard = self.active.lock().unwrap();
        if let Some(handle) = guard.take() {
            handle.abort();
        }
    }

    pub fn clear(&self) {
        *self.active.lock().unwrap() = None;
    }
}

#[derive(Debug, Deserialize)]
pub struct MergeInputPayload {
    pub title: String,
    pub body: String,
    pub frontmatter: IndexMap<String, Value>,
}

#[tauri::command]
pub fn preview_merge(docs: Vec<MergeInputPayload>) -> Result<MergePlan, String> {
    let inputs: Vec<MergeInput> = docs
        .into_iter()
        .map(|d| MergeInput {
            title: d.title,
            body: d.body,
            frontmatter: d.frontmatter,
        })
        .collect();
    Ok(merge::plan_merge(&inputs))
}

#[tauri::command]
pub fn preview_split(
    content: String,
    title: String,
    frontmatter: IndexMap<String, Value>,
) -> Result<SplitPlan, String> {
    Ok(split::plan_split(&content, &title, &frontmatter))
}

const TITLE_SYSTEM_PROMPT: &str = "You are a title generator. Given the titles and content of documents being merged, suggest a single concise title for the combined document. Respond with ONLY the title text, nothing else. No quotes, no explanation.";

fn strip_surrounding_quotes(s: &str) -> &str {
    let bytes = s.as_bytes();
    if bytes.len() >= 2 {
        let first = bytes[0];
        let last = bytes[bytes.len() - 1];
        if (first == b'"' && last == b'"') || (first == b'\'' && last == b'\'') {
            return &s[1..s.len() - 1];
        }
    }
    if let (Some(first_char), Some(last_char)) = (s.chars().next(), s.chars().next_back()) {
        let matched = matches!(
            (first_char, last_char),
            ('\u{201C}', '\u{201D}') | ('\u{2018}', '\u{2019}')
        );
        if matched {
            return &s[first_char.len_utf8()..s.len() - last_char.len_utf8()];
        }
    }
    s
}

pub(crate) async fn suggest_title_inner(
    provider_id: &str,
    model: &str,
    api_key: &str,
    base_url: Option<&str>,
    source_titles: &[String],
    merged_body: &str,
    temperature: f64,
) -> Result<String, String> {
    if source_titles.is_empty() {
        return Err("source_titles must not be empty".to_string());
    }

    let provider = llm::create_provider(provider_id, base_url);

    let titles_text = source_titles.join(", ");
    let body_preview: String = merged_body.chars().take(2000).collect();
    let user_text = format!(
        "Source document titles: {titles_text}\n\nMerged content (first 2000 chars):\n{body_preview}"
    );

    let mut options = HashMap::new();
    options.insert("max_tokens".into(), serde_json::json!(100));
    options.insert("temperature".into(), serde_json::json!(temperature));

    let prompt = llm::build_prompt(&user_text, Some(TITLE_SYSTEM_PROMPT), &[], &options);

    let stream = provider
        .execute(model, &prompt, Some(api_key), false)
        .await
        .map_err(|e| e.to_string())?;

    let raw = llm::collect_stream_text(stream).await?;
    let title = strip_surrounding_quotes(raw.trim()).trim();

    if title.is_empty() {
        return Err("LLM returned empty title".to_string());
    }

    Ok(title.to_string())
}

#[tauri::command]
pub async fn suggest_merge_title(
    source_titles: Vec<String>,
    merged_body: String,
    app_handle: tauri::AppHandle,
    store: tauri::State<'_, std::sync::Arc<dyn CredentialStore>>,
    state: tauri::State<'_, TitleSuggestState>,
) -> Result<String, String> {
    let prefs = crate::preferences::read_preferences(&app_handle);

    let model = prefs
        .extra
        .get("llm.model")
        .and_then(|v| v.as_str())
        .unwrap_or("claude-sonnet-4-6")
        .to_string();

    let provider_pref = prefs
        .extra
        .get("llm.provider")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let provider_id = if provider_pref.is_empty() {
        llm::provider_id_for_model(&model).to_string()
    } else {
        provider_pref
    };

    let temperature = prefs
        .extra
        .get("llm.temperature")
        .and_then(|v| v.as_f64())
        .unwrap_or(0.7);

    let base_url = prefs
        .extra
        .get("llm.baseUrl")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string());

    let api_key = llm::resolve_api_key(&provider_id, store.as_ref())
        .ok_or_else(|| "No API key found. Set one in Settings.".to_string())?;

    let (tx, rx) = oneshot::channel();

    let handle = tokio::spawn(async move {
        let result = suggest_title_inner(
            &provider_id,
            &model,
            &api_key,
            base_url.as_deref(),
            &source_titles,
            &merged_body,
            temperature,
        )
        .await;
        let _ = tx.send(result);
    });

    state.set_active(handle);

    let result = rx.await.map_err(|_| "Title suggestion cancelled".to_string())?;
    state.clear();
    result
}

#[tauri::command]
pub async fn cancel_title_suggestion(
    state: tauri::State<'_, TitleSuggestState>,
) -> Result<(), String> {
    state.cancel();
    Ok(())
}

#[tauri::command]
pub fn execute_split(
    relative_path: String,
    window: tauri::Window,
    state: State<WorkspaceRegistry>,
    registry: State<Arc<WriteHashRegistry>>,
    oplog_state: State<Arc<OpLogRegistry>>,
    graph_state: State<Arc<GraphRegistry>>,
    app_handle: tauri::AppHandle,
) -> Result<Vec<String>, String> {
    let root = get_workspace_root(&state, window.label())?;

    let candidate_paths = {
        let indices = graph_state.indices.lock().unwrap();
        indices.get(&root).map(|gi| {
            let stem = crate::graph::indexer::normalize_stem(&relative_path);
            gi.affected_sources(&[stem])
        })
    };

    let result =
        split_execute::execute_split(&root, &relative_path, &registry, candidate_paths.as_ref()).map_err(|e| e.to_string())?;

    let ann_enabled = crate::preferences::annotations_enabled(&app_handle);
    let gi = {
        let indices = graph_state.indices.lock().unwrap();
        indices.get(&root).cloned()
    };

    for path in &result.created_paths {
        let content = std::fs::read_to_string(root.join(path)).unwrap_or_default();
        registry.record(&root.join(path), &content);
    }
    for pr in &result.rewrite_actions {
        registry.record(&root.join(&pr.relative_path), &pr.after_content);
    }

    if let Some(ref gi) = gi {
        let diff = crate::graph::indexer::DiffResult {
            new: result.created_paths.clone(),
            changed: result.rewrite_actions.iter().map(|pr| pr.relative_path.clone()).collect(),
            deleted: vec![relative_path.clone()],
        };
        let reindex_result = gi.batch_reindex(&diff, ann_enabled);
        crate::commands::graph::emit_reindex_side_effects(&app_handle, &reindex_result);
    }

    if let Ok(oplog) = oplog_state.get_oplog(&root) {
        let store = oplog.lock().unwrap();
        let mut actions: Vec<Action> = Vec::new();
        let mut seq: i64 = 0;

        for path in &result.created_paths {
            let content = std::fs::read_to_string(root.join(path)).unwrap_or_default();
            actions.push(Action {
                seq,
                action_type: "create_file".into(),
                path: path.clone(),
                old_path: None,
                before_content: None,
                after_content: Some(content),
            });
            seq += 1;
        }

        for pr in &result.rewrite_actions {
            actions.push(Action {
                seq,
                action_type: "modify_file".into(),
                path: pr.relative_path.clone(),
                old_path: None,
                before_content: Some(pr.before_content.clone()),
                after_content: Some(pr.after_content.clone()),
            });
            seq += 1;
        }

        actions.push(Action {
            seq,
            action_type: "delete_file".into(),
            path: relative_path.clone(),
            old_path: None,
            before_content: Some(
                std::fs::read_to_string(
                    root.join(".trash").join(&result.trash_entry.trash_name),
                )
                .unwrap_or_default(),
            ),
            after_content: None,
        });

        let desc = format!(
            "Split '{}' into {} document(s)",
            relative_path,
            result.created_paths.len()
        );
        let _ = store.record_operation("split_page", &desc, &actions);
    }

    Ok(result.created_paths)
}

#[tauri::command]
pub fn merge_documents(
    paths: Vec<String>,
    title: String,
    ordering: Vec<usize>,
    output_dir: Option<String>,
    window: tauri::Window,
    state: State<WorkspaceRegistry>,
    registry: State<Arc<WriteHashRegistry>>,
    graph_state: State<Arc<GraphRegistry>>,
    oplog_state: State<Arc<OpLogRegistry>>,
    app_handle: tauri::AppHandle,
) -> Result<String, String> {
    let root = get_workspace_root(&state, window.label())?;

    let docs: Vec<(String, MergeInput)> = paths
        .iter()
        .map(|p| {
            let page = ops::read_page(&root, p, &registry).map_err(|e| e.to_string())?;
            Ok((
                p.clone(),
                MergeInput {
                    title: page.meta.title,
                    body: page.body,
                    frontmatter: page.meta.frontmatter,
                },
            ))
        })
        .collect::<Result<Vec<_>, String>>()?;

    let candidate_paths = {
        let indices = graph_state.indices.lock().unwrap();
        indices.get(&root).map(|gi| {
            let stems: Vec<String> = paths
                .iter()
                .map(|p| crate::graph::indexer::normalize_stem(p))
                .collect();
            gi.affected_sources(&stems)
        })
    };

    let result = merge::merge_documents_inner(
        &root,
        &docs,
        Some(&title),
        &ordering,
        output_dir.as_deref(),
        candidate_paths.as_ref(),
    )?;

    registry.record(&root.join(&result.merged_path), &result.merged_content);
    for pr in &result.planned_rewrites.rewrites {
        registry.record(&root.join(&pr.relative_path), &pr.after_content);
    }

    let ann_enabled = crate::preferences::annotations_enabled(&app_handle);
    let gi = {
        let indices = graph_state.indices.lock().unwrap();
        indices.get(&root).cloned()
    };
    if let Some(ref gi) = gi {
        let diff = crate::graph::indexer::DiffResult {
            new: vec![result.merged_path.clone()],
            changed: result.planned_rewrites.rewrites.iter().map(|pr| pr.relative_path.clone()).collect(),
            deleted: result.source_snapshots.iter().map(|(p, _)| p.clone()).collect(),
        };
        let reindex_result = gi.batch_reindex(&diff, ann_enabled);
        crate::commands::graph::emit_reindex_side_effects(&app_handle, &reindex_result);
    }

    if let Ok(oplog) = oplog_state.get_oplog(&root) {
        let store = oplog.lock().unwrap();
        let mut actions: Vec<Action> = Vec::new();
        let mut seq: i64 = 0;

        for pr in &result.planned_rewrites.rewrites {
            actions.push(Action {
                seq,
                action_type: "modify_file".into(),
                path: pr.relative_path.clone(),
                old_path: None,
                before_content: Some(pr.before_content.clone()),
                after_content: Some(pr.after_content.clone()),
            });
            seq += 1;
        }

        actions.push(Action {
            seq,
            action_type: "create_file".into(),
            path: result.merged_path.clone(),
            old_path: None,
            before_content: None,
            after_content: Some(result.merged_content.clone()),
        });
        seq += 1;

        for (path, content) in &result.source_snapshots {
            actions.push(Action {
                seq,
                action_type: "delete_file".into(),
                path: path.clone(),
                old_path: None,
                before_content: Some(content.clone()),
                after_content: None,
            });
            seq += 1;
        }

        let desc = format!(
            "Merge {} documents into '{}'",
            result.source_snapshots.len(),
            title
        );
        let _ = store.record_operation("merge_documents", &desc, &actions);
    }

    Ok(result.merged_path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::oplog::store::OpLogStore;
    use crate::oplog::undo::execute_undo;
    use crate::workspace::write_hash::WriteHashRegistry;
    use tempfile::TempDir;

    fn write_file(dir: &std::path::Path, rel: &str, content: &str) {
        let path = dir.join(rel);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).unwrap();
        }
        std::fs::write(path, content).unwrap();
    }

    #[test]
    fn preview_merge_returns_plan() {
        let docs = vec![
            MergeInputPayload {
                title: "A".to_string(),
                body: "Hello A".to_string(),
                frontmatter: IndexMap::new(),
            },
            MergeInputPayload {
                title: "B".to_string(),
                body: "Hello B".to_string(),
                frontmatter: IndexMap::new(),
            },
        ];
        let plan = preview_merge(docs).unwrap();
        assert_eq!(plan.title, "A + B");
        assert_eq!(plan.source_titles, vec!["A", "B"]);
        assert!(plan.body.contains("Hello A"));
        assert!(plan.body.contains("Hello B"));
    }

    #[test]
    fn preview_split_returns_plan() {
        let content = "## Alpha\nAlpha body.\n## Beta\nBeta body.\n".to_string();
        let title = "My Doc".to_string();
        let fm = IndexMap::new();
        let plan = preview_split(content, title, fm).unwrap();
        assert_eq!(plan.sections.len(), 2);
        assert_eq!(plan.sections[0].title, "Alpha");
        assert_eq!(plan.sections[1].title, "Beta");
    }

    #[test]
    fn preview_split_with_preamble() {
        let content = "Some intro.\n\n## Section\nBody.\n".to_string();
        let title = "Doc".to_string();
        let fm = IndexMap::new();
        let plan = preview_split(content, title, fm).unwrap();
        assert!(plan.preamble.is_some());
        assert_eq!(plan.preamble.unwrap().title, "Doc - Introduction");
        assert_eq!(plan.sections.len(), 1);
    }

    #[test]
    fn strip_surrounding_quotes_double() {
        assert_eq!(strip_surrounding_quotes("\"My Title\""), "My Title");
    }

    #[test]
    fn strip_surrounding_quotes_single() {
        assert_eq!(strip_surrounding_quotes("'My Title'"), "My Title");
    }

    #[test]
    fn strip_surrounding_quotes_none() {
        assert_eq!(strip_surrounding_quotes("My Title"), "My Title");
    }

    #[test]
    fn strip_surrounding_quotes_mismatched() {
        assert_eq!(strip_surrounding_quotes("\"My Title'"), "\"My Title'");
    }

    fn openai_chat_response(content: &str) -> String {
        format!(
            r#"{{"id":"1","object":"chat.completion","model":"gpt-4o","choices":[{{"index":0,"message":{{"role":"assistant","content":"{content}"}},"finish_reason":"stop"}}],"usage":{{"prompt_tokens":10,"completion_tokens":5,"total_tokens":15}}}}"#,
        )
    }

    #[tokio::test]
    async fn suggest_title_inner_returns_title_from_llm() {
        use wiremock::{MockServer, Mock, ResponseTemplate};
        use wiremock::matchers::{method, path};

        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/v1/chat/completions"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_string(openai_chat_response("  Combined Notes  ")),
            )
            .mount(&server)
            .await;

        let result = suggest_title_inner(
            "openai",
            "gpt-4o",
            "fake-key",
            Some(&server.uri()),
            &["A".into(), "B".into()],
            "some body text",
            0.7,
        )
        .await;

        assert_eq!(result.unwrap(), "Combined Notes");
    }

    #[tokio::test]
    async fn suggest_title_inner_strips_quotes() {
        use wiremock::{MockServer, Mock, ResponseTemplate};
        use wiremock::matchers::{method, path};

        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/v1/chat/completions"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_string(openai_chat_response("\\\"My Title\\\"")),
            )
            .mount(&server)
            .await;

        let result = suggest_title_inner(
            "openai",
            "gpt-4o",
            "fake-key",
            Some(&server.uri()),
            &["A".into()],
            "body",
            0.7,
        )
        .await;

        assert_eq!(result.unwrap(), "My Title");
    }

    #[tokio::test]
    async fn suggest_title_inner_empty_response_returns_error() {
        use wiremock::{MockServer, Mock, ResponseTemplate};
        use wiremock::matchers::{method, path};

        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/v1/chat/completions"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_string(openai_chat_response("")),
            )
            .mount(&server)
            .await;

        let result = suggest_title_inner(
            "openai",
            "gpt-4o",
            "fake-key",
            Some(&server.uri()),
            &["A".into()],
            "body",
            0.7,
        )
        .await;

        assert!(result.is_err());
        assert!(result.unwrap_err().to_lowercase().contains("empty"));
    }

    #[tokio::test]
    async fn suggest_title_inner_api_error_propagates() {
        use wiremock::{MockServer, Mock, ResponseTemplate};
        use wiremock::matchers::{method, path};

        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/v1/chat/completions"))
            .respond_with(
                ResponseTemplate::new(401)
                    .set_body_string(r#"{"error":{"message":"Invalid API key"}}"#),
            )
            .mount(&server)
            .await;

        let result = suggest_title_inner(
            "openai",
            "gpt-4o",
            "bad-key",
            Some(&server.uri()),
            &["A".into()],
            "body",
            0.7,
        )
        .await;

        assert!(result.is_err());
    }

    #[tokio::test]
    async fn suggest_title_inner_sends_correct_prompt() {
        use wiremock::{MockServer, Mock, ResponseTemplate};
        use wiremock::matchers::{method, path};

        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/v1/chat/completions"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_string(openai_chat_response("Result Title")),
            )
            .mount(&server)
            .await;

        let _ = suggest_title_inner(
            "openai",
            "gpt-4o",
            "fake-key",
            Some(&server.uri()),
            &["Note A".into(), "Note B".into()],
            "merged body content here",
            0.5,
        )
        .await;

        let received = server.received_requests().await.unwrap();
        assert_eq!(received.len(), 1);
        let body: serde_json::Value = serde_json::from_slice(&received[0].body).unwrap();

        let messages = body["messages"].as_array().unwrap();
        let system_msg = messages.iter().find(|m| m["role"] == "system").unwrap();
        assert!(
            system_msg["content"].as_str().unwrap().to_lowercase().contains("title"),
            "system prompt should mention 'title'"
        );

        let user_msg = messages.iter().find(|m| m["role"] == "user").unwrap();
        let user_content = user_msg["content"].as_str().unwrap();
        assert!(user_content.contains("Note A"), "user message should contain source titles");
        assert!(user_content.contains("Note B"), "user message should contain source titles");

        assert_eq!(body["max_tokens"], 100);
        assert_eq!(body["temperature"], 0.5);
    }

    #[tokio::test]
    async fn suggest_title_inner_works_with_claude_model() {
        use wiremock::{MockServer, Mock, ResponseTemplate};
        use wiremock::matchers::{method, path};

        let server = MockServer::start().await;
        let body = r#"{"id":"msg_1","type":"message","role":"assistant","model":"claude-sonnet-4-6","content":[{"type":"text","text":"Claude Title"}],"stop_reason":"end_turn","usage":{"input_tokens":10,"output_tokens":3}}"#;

        Mock::given(method("POST"))
            .and(path("/v1/messages"))
            .respond_with(
                ResponseTemplate::new(200).set_body_string(body),
            )
            .mount(&server)
            .await;

        let result = suggest_title_inner(
            "anthropic",
            "claude-sonnet-4-6",
            "fake-key",
            Some(&server.uri()),
            &["A".into(), "B".into()],
            "body",
            0.7,
        )
        .await;

        assert_eq!(result.unwrap(), "Claude Title");
    }

    #[tokio::test]
    async fn suggest_title_inner_uses_explicit_provider_id() {
        use wiremock::{MockServer, Mock, ResponseTemplate};
        use wiremock::matchers::{method, path};

        let server = MockServer::start().await;
        // Anthropic provider_id -> Anthropic wire format -> /v1/messages,
        // even though the model string is "gpt-4o".
        let body = r#"{"id":"msg_1","type":"message","role":"assistant","model":"x","content":[{"type":"text","text":"Routed By Provider"}],"stop_reason":"end_turn","usage":{"input_tokens":1,"output_tokens":1}}"#;
        Mock::given(method("POST"))
            .and(path("/v1/messages"))
            .respond_with(ResponseTemplate::new(200).set_body_string(body))
            .mount(&server)
            .await;

        let result = suggest_title_inner(
            "anthropic",            // NEW first arg: provider_id
            "gpt-4o",               // model name deliberately mismatched
            "fake-key",
            Some(&server.uri()),
            &["A".into(), "B".into()],
            "body",
            0.7,
        )
        .await;

        assert_eq!(result.unwrap(), "Routed By Provider");
    }

    #[test]
    fn suggest_merge_title_resolves_provider_from_prefs() {
        // Explicit llm.provider in prefs wins, regardless of model name.
        let mut prefs = crate::preferences::Preferences::default();
        prefs.extra.insert("llm.provider".into(), serde_json::json!("groq"));
        prefs.extra.insert("llm.model".into(), serde_json::json!("claude-sonnet-4-6"));

        let model = prefs.extra.get("llm.model").and_then(|v| v.as_str())
            .unwrap_or("claude-sonnet-4-6").to_string();
        let provider_pref = prefs.extra.get("llm.provider").and_then(|v| v.as_str())
            .unwrap_or("").to_string();
        let provider_id = if provider_pref.is_empty() {
            llm::provider_id_for_model(&model).to_string()
        } else {
            provider_pref.clone()
        };
        assert_eq!(provider_id, "groq");

        // Absent llm.provider falls back to model sniffing.
        let prefs2 = crate::preferences::Preferences::default();
        let model2 = prefs2.extra.get("llm.model").and_then(|v| v.as_str())
            .unwrap_or("claude-sonnet-4-6").to_string();
        let provider_pref2 = prefs2.extra.get("llm.provider").and_then(|v| v.as_str())
            .unwrap_or("").to_string();
        let provider_id2 = if provider_pref2.is_empty() {
            llm::provider_id_for_model(&model2).to_string()
        } else { provider_pref2 };
        assert_eq!(provider_id2, "anthropic");
    }

    #[test]
    fn resolve_llm_settings_defaults() {
        let prefs = crate::preferences::Preferences::default();

        let model = prefs
            .extra
            .get("llm.model")
            .and_then(|v| v.as_str())
            .unwrap_or("claude-sonnet-4-6");
        assert_eq!(model, "claude-sonnet-4-6");

        let temperature = prefs
            .extra
            .get("llm.temperature")
            .and_then(|v| v.as_f64())
            .unwrap_or(0.7);
        assert!((temperature - 0.7).abs() < f64::EPSILON);

        let provider = crate::llm::create_provider(crate::llm::provider_id_for_model(model), None);
        assert_eq!(provider.id(), "anthropic");
    }

    #[tokio::test]
    async fn suggest_title_inner_empty_titles_returns_error() {
        let result = suggest_title_inner(
            "openai",
            "gpt-4o",
            "fake-key",
            None,
            &[],
            "body",
            0.7,
        )
        .await;

        assert!(result.is_err());
        assert!(result.unwrap_err().contains("source_titles must not be empty"));
    }

    #[test]
    fn strip_surrounding_quotes_curly_double() {
        assert_eq!(strip_surrounding_quotes("\u{201C}My Title\u{201D}"), "My Title");
    }

    #[test]
    fn strip_surrounding_quotes_curly_single() {
        assert_eq!(strip_surrounding_quotes("\u{2018}My Title\u{2019}"), "My Title");
    }

    #[test]
    fn strip_surrounding_quotes_curly_mismatched() {
        let input = "\u{201C}My Title\u{2019}";
        assert_eq!(strip_surrounding_quotes(input), input);
    }

    #[test]
    fn title_suggest_state_cancel() {
        let state = TitleSuggestState::new();
        let handle = tokio::runtime::Runtime::new().unwrap().spawn(async {
            tokio::time::sleep(std::time::Duration::from_secs(60)).await;
        });
        state.set_active(handle);
        state.cancel();
        assert!(state.active.lock().unwrap().is_none());
    }

    #[test]
    fn merge_documents_oplog_roundtrip() {
        let dir = TempDir::new().unwrap();
        let root = dir.path();
        write_file(root, "A.md", "---\ntags: [rust]\n---\nHello A");
        write_file(root, "B.md", "Hello B");
        write_file(root, "C.md", "Links: [[A]] and [[B]]");

        let a_original = std::fs::read_to_string(root.join("A.md")).unwrap();
        let b_original = std::fs::read_to_string(root.join("B.md")).unwrap();
        let c_original = std::fs::read_to_string(root.join("C.md")).unwrap();

        let docs: Vec<(String, MergeInput)> = vec![
            (
                "A.md".to_string(),
                MergeInput {
                    title: "A".to_string(),
                    body: "Hello A".to_string(),
                    frontmatter: {
                        let mut fm = IndexMap::new();
                        fm.insert(
                            "tags".to_string(),
                            Value::Sequence(vec![Value::String("rust".to_string())]),
                        );
                        fm
                    },
                },
            ),
            (
                "B.md".to_string(),
                MergeInput {
                    title: "B".to_string(),
                    body: "Hello B".to_string(),
                    frontmatter: IndexMap::new(),
                },
            ),
        ];

        let result = merge::merge_documents_inner(root, &docs, Some("Merged"), &[0, 1], None, None)
            .unwrap();

        assert!(root.join("Merged.md").exists());
        assert!(!root.join("A.md").exists());
        assert!(!root.join("B.md").exists());
        let c_after = std::fs::read_to_string(root.join("C.md")).unwrap();
        assert!(c_after.contains("[[Merged]]"));

        let write_hash_registry = WriteHashRegistry::new();
        let store = OpLogStore::open_memory().unwrap();

        let mut actions: Vec<Action> = Vec::new();
        let mut seq: i64 = 0;

        for pr in &result.planned_rewrites.rewrites {
            actions.push(Action {
                seq,
                action_type: "modify_file".into(),
                path: pr.relative_path.clone(),
                old_path: None,
                before_content: Some(pr.before_content.clone()),
                after_content: Some(pr.after_content.clone()),
            });
            seq += 1;
        }

        actions.push(Action {
            seq,
            action_type: "create_file".into(),
            path: result.merged_path.clone(),
            old_path: None,
            before_content: None,
            after_content: Some(result.merged_content.clone()),
        });
        seq += 1;

        for (path, content) in &result.source_snapshots {
            actions.push(Action {
                seq,
                action_type: "delete_file".into(),
                path: path.clone(),
                old_path: None,
                before_content: Some(content.clone()),
                after_content: None,
            });
            seq += 1;
        }

        store
            .record_operation("merge_documents", "Merge 2 documents into 'Merged'", &actions)
            .unwrap();

        let op = store.pop_latest().unwrap();
        execute_undo(root, &op, &write_hash_registry).unwrap();

        assert!(!root.join("Merged.md").exists());
        assert_eq!(
            std::fs::read_to_string(root.join("A.md")).unwrap(),
            a_original
        );
        assert_eq!(
            std::fs::read_to_string(root.join("B.md")).unwrap(),
            b_original
        );
        assert_eq!(
            std::fs::read_to_string(root.join("C.md")).unwrap(),
            c_original
        );
    }

    #[test]
    fn merge_inner_with_candidate_paths_only_scans_those() {
        let dir = TempDir::new().unwrap();
        let root = dir.path();
        write_file(root, "A.md", "Hello from A");
        write_file(root, "B.md", "Hello from B");
        write_file(root, "C.md", "See [[A]] and [[B]]");
        write_file(root, "D.md", "See [[A]]");

        let docs: Vec<(String, MergeInput)> = vec![
            ("A.md".to_string(), MergeInput { title: "A".into(), body: "Hello from A".into(), frontmatter: IndexMap::new() }),
            ("B.md".to_string(), MergeInput { title: "B".into(), body: "Hello from B".into(), frontmatter: IndexMap::new() }),
        ];

        let mut candidates: std::collections::HashSet<String> = std::collections::HashSet::new();
        candidates.insert("C.md".into());

        let result = merge::merge_documents_inner(root, &docs, Some("Merged"), &[0, 1], None, Some(&candidates)).unwrap();

        let c_content = std::fs::read_to_string(root.join("C.md")).unwrap();
        assert!(c_content.contains("[[Merged]]"), "C.md should be rewritten: {c_content}");

        let d_content = std::fs::read_to_string(root.join("D.md")).unwrap();
        assert!(d_content.contains("[[A]]"), "D.md should NOT be rewritten: {d_content}");

        assert_eq!(result.planned_rewrites.files_scanned, 1);
    }

    #[test]
    fn merge_inner_with_none_falls_back_to_full_walk() {
        let dir = TempDir::new().unwrap();
        let root = dir.path();
        write_file(root, "A.md", "Hello from A");
        write_file(root, "B.md", "Hello from B");
        write_file(root, "C.md", "See [[A]]");
        write_file(root, "D.md", "See [[B]]");

        let docs: Vec<(String, MergeInput)> = vec![
            ("A.md".to_string(), MergeInput { title: "A".into(), body: "Hello from A".into(), frontmatter: IndexMap::new() }),
            ("B.md".to_string(), MergeInput { title: "B".into(), body: "Hello from B".into(), frontmatter: IndexMap::new() }),
        ];

        let result = merge::merge_documents_inner(root, &docs, Some("Merged"), &[0, 1], None, None).unwrap();

        let c_content = std::fs::read_to_string(root.join("C.md")).unwrap();
        assert!(c_content.contains("[[Merged]]"), "C.md should be rewritten: {c_content}");

        let d_content = std::fs::read_to_string(root.join("D.md")).unwrap();
        assert!(d_content.contains("[[Merged]]"), "D.md should also be rewritten: {d_content}");

        assert!(result.planned_rewrites.files_scanned >= 2);
    }
}
