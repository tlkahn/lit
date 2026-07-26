use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::sync::{Arc, Mutex};
use tokio::task::JoinHandle;

use serde::Deserialize;
use tauri::{Emitter, Window};

use tracing::{info, debug};

use crate::graph::indexer::GraphIndex;
use crate::llm::{self, ChatMessage, LlmEvent, TruncationInfo};
use crate::llm_context::{build_context_layers, BuiltContext, Neighbor};
use crate::workspace::write_hash::WriteHashRegistry;
use super::credential::CredentialStore;

pub const GLOBAL_NODE_ID: &str = "_global";

pub struct LlmState {
    active: Arc<Mutex<Option<JoinHandle<()>>>>,
}

impl LlmState {
    pub fn new() -> Self {
        Self {
            active: Arc::new(Mutex::new(None)),
        }
    }

    pub fn clone_ref(&self) -> Self {
        Self {
            active: Arc::clone(&self.active),
        }
    }

    #[allow(dead_code)]
    pub fn has_active_task(&self) -> bool {
        self.active.lock().unwrap().is_some()
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

#[derive(Deserialize)]
pub struct LlmPromptArgs {
    #[serde(default)]
    pub provider: String,
    pub model: String,
    pub text: String,
    pub system: Option<String>,
    #[serde(default)]
    pub messages: Vec<ChatMessage>,
    #[serde(default)]
    pub options: HashMap<String, serde_json::Value>,
    pub base_url: Option<String>,
    #[serde(default)]
    pub context_window: Option<usize>,
}

pub fn log_prompt_info(
    model: &str,
    system: Option<&str>,
    text: &str,
    message_count: usize,
    truncation: Option<&TruncationInfo>,
) {
    let system_len = system.map_or(0, |s| s.len());
    let text_len = text.len();
    let estimated_tokens = llm::estimate_tokens(text)
        + llm::estimate_tokens(system.unwrap_or(""));
    let truncated = truncation.is_some();

    info!(
        %model,
        system_len,
        text_len,
        message_count,
        estimated_tokens,
        truncated,
        "llm prompt"
    );

    debug!(system_prompt = system.unwrap_or(""), "llm system prompt");
    debug!(prompt_text = %text, "llm prompt text");
}

#[tauri::command]
pub async fn llm_prompt_streaming(
    args: LlmPromptArgs,
    window: Window,
    state: tauri::State<'_, LlmState>,
    store: tauri::State<'_, Arc<dyn CredentialStore>>,
) -> Result<(), String> {
    state.cancel();

    let provider_id = resolve_provider_id(&args.provider, &args.model);
    let provider = llm::create_provider(provider_id, args.base_url.as_deref());

    let prompt = llm::build_prompt(
        &args.text,
        args.system.as_deref(),
        &args.messages,
        &args.options,
    );

    let (prompt, truncation) = llm::apply_token_budget(prompt, provider_id, &args.model, args.context_window)?;

    log_prompt_info(
        &args.model,
        args.system.as_deref(),
        &prompt.text,
        args.messages.len(),
        truncation.as_ref(),
    );

    if let Some(info) = truncation {
        let _ = window.emit("llm://truncated", &info);
    }

    let api_key = llm::resolve_api_key(provider_id, store.as_ref());

    let model = args.model.clone();
    let state_ref = state.clone_ref();
    let handle = tokio::spawn(async move {
        let stream_result = provider
            .execute(&model, &prompt, api_key.as_deref(), true)
            .await;

        match stream_result {
            Ok(stream) => {
                llm::process_stream(stream, |event| {
                    match &event {
                        LlmEvent::Chunk { text } => {
                            let _ = window.emit("llm://chunk", text);
                        }
                        LlmEvent::Usage { input, output } => {
                            let _ = window.emit(
                                "llm://usage",
                                serde_json::json!({ "input": input, "output": output }),
                            );
                        }
                        LlmEvent::Done => {
                            let _ = window.emit("llm://done", ());
                        }
                        LlmEvent::Error { message, retryable } => {
                            let _ = window.emit(
                                "llm://error",
                                serde_json::json!({ "message": message, "retryable": retryable }),
                            );
                        }
                    }
                })
                .await;
            }
            Err(e) => {
                let _ = window.emit(
                    "llm://error",
                    serde_json::json!({
                        "message": e.to_string(),
                        "retryable": e.is_retryable(),
                    }),
                );
            }
        }

        state_ref.clear();
    });

    state.set_active(handle);
    Ok(())
}

#[tauri::command]
pub fn llm_cancel(state: tauri::State<'_, LlmState>) -> Result<(), String> {
    state.cancel();
    Ok(())
}

pub async fn test_connection_inner(
    provider_id: &str,
    model: &str,
    api_key: Option<&str>,
    base_url: Option<&str>,
) -> Result<(), String> {
    let provider = llm::create_provider(provider_id, base_url);
    let mut options = HashMap::new();
    options.insert("max_tokens".into(), serde_json::json!(1));
    let prompt = llm::build_prompt("hi", None, &[], &options);
    let _ = provider
        .execute(model, &prompt, api_key, false)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn llm_test_connection(
    model: String,
    provider: Option<String>,
    base_url: Option<String>,
    store: tauri::State<'_, Arc<dyn CredentialStore>>,
) -> Result<(), String> {
    let provider_id = resolve_provider_id(provider.as_deref().unwrap_or(""), &model);
    let api_key = llm::resolve_api_key(provider_id, store.as_ref());
    test_connection_inner(provider_id, &model, api_key.as_deref(), base_url.as_deref()).await
}

/// Resolve the provider id to use: an explicit non-empty `provider` wins;
/// otherwise fall back to sniffing the provider from the model name.
fn resolve_provider_id<'a>(provider: &'a str, model: &str) -> &'a str {
    if provider.is_empty() {
        llm::provider_id_for_model(model)
    } else {
        provider
    }
}

pub fn build_context_inner(
    node_id: &str,
    system_prompt: &str,
    neighbors_depth: usize,
    provider_id: &str,
    model: &str,
    messages: &[ChatMessage],
    graph_index: Option<&GraphIndex>,
    workspace_root: Option<&Path>,
    registry: &WriteHashRegistry,
    context_window_override: Option<usize>,
) -> Result<BuiltContext, String> {
    let (doc_content, doc_title, neighbors) = if node_id == GLOBAL_NODE_ID || workspace_root.is_none() {
        (String::new(), String::new(), vec![])
    } else {
        let root = workspace_root.unwrap();
        let (doc_content, doc_title) = {
            match crate::workspace::ops::read_page(root, node_id, registry) {
                Ok(page) => (page.body, page.meta.title),
                Err(_) => (String::new(), String::new()),
            }
        };

        let neighbors = if neighbors_depth == 0 || graph_index.is_none() {
            vec![]
        } else {
            let gi = graph_index.unwrap();
            let mut seen = HashSet::new();
            let mut neighbor_entries: Vec<(String, String, String, String)> = Vec::new();

            if let Ok(flinks) = gi.forward_links(node_id) {
                for link in flinks {
                    if seen.insert(link.target_id.clone()) {
                        neighbor_entries.push((
                            link.target_id,
                            link.target_title,
                            "forward link".into(),
                            link.context,
                        ));
                    }
                }
            }
            if let Ok(blinks) = gi.backlinks(node_id) {
                for bl in blinks {
                    if seen.insert(bl.source_id.clone()) {
                        neighbor_entries.push((
                            bl.source_id,
                            bl.source_title,
                            format!("backlink from line {}", bl.source_line),
                            bl.context,
                        ));
                    }
                }
            }

            if neighbors_depth >= 2 {
                if let Ok(subgraph) = gi.neighbors(node_id, 2, false) {
                    for node in subgraph.nodes {
                        if node.id != node_id && seen.insert(node.id.clone()) {
                            neighbor_entries.push((
                                node.id,
                                node.title,
                                "2-hop neighbor".into(),
                                String::new(),
                            ));
                        }
                    }
                }
            }

            neighbor_entries.truncate(20);

            let ids: Vec<String> = neighbor_entries.iter().map(|(id, ..)| id.clone()).collect();
            let first_paragraphs = gi.get_first_paragraphs(&ids).unwrap_or_default();

            neighbor_entries
                .into_iter()
                .map(|(id, title, relation, context)| {
                    let excerpt = first_paragraphs
                        .get(&id)
                        .filter(|s| !s.is_empty())
                        .cloned()
                        .unwrap_or(context);
                    Neighbor { title, excerpt, relation }
                })
                .collect()
        };

        (doc_content, doc_title, neighbors)
    };

    Ok(build_context_layers(
        system_prompt, messages, &doc_content, &doc_title, &neighbors, provider_id, model, context_window_override,
    ))
}

#[derive(Deserialize)]
pub struct BuildContextArgs {
    #[serde(default)]
    pub provider: String,
    pub node_id: String,
    #[serde(default)]
    pub system_prompt: String,
    #[serde(default)]
    pub neighbors_depth: usize,
    pub model: String,
    #[serde(default)]
    pub messages: Vec<ChatMessage>,
    #[serde(default)]
    pub context_window: Option<usize>,
}

#[tauri::command]
pub async fn llm_build_context(
    args: BuildContextArgs,
    window: Window,
    workspace_state: tauri::State<'_, crate::commands::workspace::WorkspaceRegistry>,
    graph_state: tauri::State<'_, Arc<super::graph::GraphRegistry>>,
    registry: tauri::State<'_, Arc<WriteHashRegistry>>,
) -> Result<BuiltContext, String> {
    let root = crate::commands::workspace::get_workspace_root(&workspace_state, window.label()).ok();
    let gi_arc = root.as_ref().and_then(|r| {
        graph_state.indices.lock().unwrap().get(r).cloned()
    });
    let registry = Arc::clone(&registry);
    tauri::async_runtime::spawn_blocking(move || {
        build_context_inner(
            &args.node_id,
            &args.system_prompt,
            args.neighbors_depth,
            resolve_provider_id(&args.provider, &args.model),
            &args.model,
            &args.messages,
            gi_arc.as_deref(),
            root.as_deref(),
            &registry,
            args.context_window,
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::annotation::lang::AnnotationIndexOpts;
    use tracing_test::traced_test;

    #[traced_test]
    #[test]
    fn log_prompt_info_emits_summary() {
        log_prompt_info("gpt-4o", Some("Be brief"), "Hello world", 2, None);
        assert!(logs_contain("llm prompt"));
        assert!(logs_contain("gpt-4o"));
        assert!(logs_contain("message_count=2"));
    }

    #[traced_test]
    #[test]
    fn log_prompt_debug_emits_full_content() {
        log_prompt_info("gpt-4o", Some("System instructions"), "Translate this text", 0, None);
        assert!(logs_contain("System instructions"));
        assert!(logs_contain("Translate this text"));
    }

    #[traced_test]
    #[test]
    fn log_prompt_info_truncated_field() {
        let trunc = crate::llm::TruncationInfo {
            original_tokens: 200_000,
            kept_tokens: 100_000,
        };
        log_prompt_info("gpt-4o", None, "text", 0, Some(&trunc));
        assert!(logs_contain("truncated=true"));
    }

    #[traced_test]
    #[test]
    fn log_prompt_info_no_truncation() {
        log_prompt_info("gpt-4o", None, "short text", 0, None);
        assert!(logs_contain("truncated=false"));
    }

    #[test]
    fn new_state_has_no_active_task() {
        let state = LlmState::new();
        assert!(!state.has_active_task());
    }

    #[tokio::test]
    async fn set_active_makes_task_active() {
        let state = LlmState::new();
        let handle = tokio::spawn(async {});
        state.set_active(handle);
        assert!(state.has_active_task());
    }

    #[tokio::test]
    async fn cancel_clears_active_task() {
        let state = LlmState::new();
        let handle = tokio::spawn(async {
            tokio::time::sleep(std::time::Duration::from_secs(60)).await;
        });
        state.set_active(handle);
        assert!(state.has_active_task());
        state.cancel();
        assert!(!state.has_active_task());
    }

    #[test]
    fn cancel_noop_when_no_active_task() {
        let state = LlmState::new();
        state.cancel();
        assert!(!state.has_active_task());
    }

    #[tokio::test]
    async fn clear_removes_active_task() {
        let state = LlmState::new();
        let handle = tokio::spawn(async {});
        state.set_active(handle);
        state.clear();
        assert!(!state.has_active_task());
    }

    #[tokio::test]
    async fn test_connection_succeeds_with_valid_key() {
        use wiremock::{MockServer, Mock, ResponseTemplate};
        use wiremock::matchers::{method, path};

        let server = MockServer::start().await;
        let body = r#"{"id":"1","object":"chat.completion","model":"gpt-4o","choices":[{"index":0,"message":{"role":"assistant","content":"hi"},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":1,"total_tokens":2}}"#;
        Mock::given(method("POST"))
            .and(path("/v1/chat/completions"))
            .respond_with(ResponseTemplate::new(200).set_body_string(body))
            .mount(&server)
            .await;

        let result = test_connection_inner("openai", "gpt-4o", Some("fake-key"), Some(&server.uri())).await;
        assert!(result.is_ok(), "expected Ok, got {:?}", result);
    }

    #[tokio::test]
    async fn test_connection_fails_with_invalid_key() {
        use wiremock::{MockServer, Mock, ResponseTemplate};
        use wiremock::matchers::{method, path};

        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/v1/chat/completions"))
            .respond_with(
                ResponseTemplate::new(401)
                    .set_body_string(r#"{"error":{"message":"Invalid API key","type":"invalid_request_error"}}"#),
            )
            .mount(&server)
            .await;

        let result = test_connection_inner("openai", "gpt-4o", Some("bad-key"), Some(&server.uri())).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_connection_fails_without_key() {
        let result = test_connection_inner("openai", "gpt-4o", None, Some("http://localhost:1")).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_connection_inner_does_not_resolve_env_var() {
        use wiremock::{MockServer, Mock, ResponseTemplate};
        use wiremock::matchers::{method, path};

        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/v1/chat/completions"))
            .respond_with(ResponseTemplate::new(200).set_body_string(
                r#"{"id":"1","object":"chat.completion","model":"gpt-4o","choices":[{"index":0,"message":{"role":"assistant","content":"hi"},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":1,"total_tokens":2}}"#,
            ))
            .mount(&server)
            .await;

        std::env::set_var("OPENAI_API_KEY", "env-key-should-not-be-used");
        let result = test_connection_inner("openai", "gpt-4o", None, Some(&server.uri())).await;
        std::env::remove_var("OPENAI_API_KEY");

        // With api_key=None the call should fail (no key provided)
        assert!(result.is_err(), "expected error when api_key is None, but got Ok — inner function should not resolve env vars");

        let received = server.received_requests().await.unwrap();
        assert_eq!(received.len(), 0, "no requests should reach the server when api_key is None");
    }

    #[tokio::test]
    async fn test_connection_sends_max_tokens_1() {
        use wiremock::{MockServer, Mock, ResponseTemplate};
        use wiremock::matchers::{method, path};

        let server = MockServer::start().await;
        let body = r#"{"id":"1","object":"chat.completion","model":"gpt-4o","choices":[{"index":0,"message":{"role":"assistant","content":"hi"},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":1,"total_tokens":2}}"#;
        Mock::given(method("POST"))
            .and(path("/v1/chat/completions"))
            .respond_with(ResponseTemplate::new(200).set_body_string(body))
            .mount(&server)
            .await;

        let _ = test_connection_inner("openai", "gpt-4o", Some("fake-key"), Some(&server.uri())).await;

        let received = server.received_requests().await.unwrap();
        assert_eq!(received.len(), 1);
        let req_body: serde_json::Value = serde_json::from_slice(&received[0].body).unwrap();
        assert_eq!(req_body["max_tokens"], 1, "test_connection should send max_tokens=1 to minimize token usage");
    }

    #[tokio::test]
    async fn test_connection_inner_uses_explicit_provider() {
        use wiremock::{MockServer, Mock, ResponseTemplate};
        use wiremock::matchers::{method, path};

        let server = MockServer::start().await;
        let body = r#"{"id":"1","object":"chat.completion","model":"x","choices":[{"index":0,"message":{"role":"assistant","content":"hi"},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":1,"total_tokens":2}}"#;
        Mock::given(method("POST"))
            .and(path("/v1/chat/completions"))
            .respond_with(ResponseTemplate::new(200).set_body_string(body))
            .mount(&server)
            .await;

        // "openrouter" is OpenAI wire format → /v1/chat/completions
        let result = test_connection_inner(
            "openrouter",
            "meta-llama/llama-4-maverick",
            Some("fake-key"),
            Some(&server.uri()),
        )
        .await;
        assert!(result.is_ok(), "expected Ok, got {:?}", result);
    }

    #[tokio::test]
    async fn test_connection_openrouter_provider() {
        use wiremock::matchers::{method, path};
        use wiremock::{Mock, MockServer, ResponseTemplate};

        let server = MockServer::start().await;
        let body = r#"{"id":"1","object":"chat.completion","model":"x","choices":[{"index":0,"message":{"role":"assistant","content":"hi"},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":1,"total_tokens":2}}"#;
        Mock::given(method("POST"))
            .and(path("/v1/chat/completions"))
            .respond_with(ResponseTemplate::new(200).set_body_string(body))
            .mount(&server)
            .await;

        let result = test_connection_inner(
            "openrouter",
            "meta-llama/llama-4-maverick",
            Some("fake-key"),
            Some(&server.uri()),
        )
        .await;
        assert!(result.is_ok(), "expected Ok, got {:?}", result);

        // Prove the openrouter provider id routed to the OpenAI-wire
        // /v1/chat/completions endpoint (exactly one request reached it).
        let received = server.received_requests().await.unwrap();
        assert_eq!(
            received.len(),
            1,
            "openrouter provider should route to the OpenAI /v1/chat/completions path"
        );
    }

    #[tokio::test]
    async fn state_auto_clears_after_task_completes() {
        let state = LlmState::new();
        let state_ref = state.clone_ref();
        let handle = tokio::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
            state_ref.clear();
        });
        state.set_active(handle);
        assert!(state.has_active_task());

        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        assert!(!state.has_active_task(), "state should auto-clear after task completes");
    }

    #[test]
    fn global_node_id_constant_equals_underscore_global() {
        assert_eq!(GLOBAL_NODE_ID, "_global");
    }

    // --- build_context_inner ---

    #[test]
    fn build_context_inner_global() {
        let msgs = vec![
            ChatMessage { role: "user".into(), content: "Hello".into() },
            ChatMessage { role: "assistant".into(), content: "Hi".into() },
        ];
        let registry = WriteHashRegistry::new();
        let result = build_context_inner(GLOBAL_NODE_ID, "Be helpful", 0, "openai", "gpt-4o", &msgs, None, None, &registry, None).unwrap();
        assert!(result.system.contains("Be helpful"));
        assert!(!result.system.contains("## Current document"));
        assert!(!result.system.contains("## Linked notes"));
        assert_eq!(result.messages.len(), 2);
        assert_eq!(result.messages[0].content, "Hello");
    }

    #[test]
    fn build_context_inner_reads_page() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("note.md"), "---\ntitle: My Note\n---\nThe body.").unwrap();
        let gi = GraphIndex::build(dir.path().to_path_buf(), &AnnotationIndexOpts::default()).unwrap();
        let registry = WriteHashRegistry::new();
        let r = build_context_inner("note.md", "Sys", 0, "openai", "gpt-4o", &[], Some(&gi), Some(dir.path()), &registry, None).unwrap();
        assert!(r.system.contains("## Current document:"), "should contain document section");
        assert!(r.system.contains("The body."));
    }

    #[test]
    fn build_context_inner_missing_page_graceful() {
        let dir = tempfile::tempdir().unwrap();
        let gi = GraphIndex::build(dir.path().to_path_buf(), &AnnotationIndexOpts::default()).unwrap();
        let registry = WriteHashRegistry::new();
        let r = build_context_inner("ghost.md", "Sys", 0, "openai", "gpt-4o", &[], Some(&gi), Some(dir.path()), &registry, None);
        assert!(r.is_ok());
        assert!(!r.unwrap().system.contains("## Current document"));
    }

    #[test]
    fn build_context_inner_depth_1_neighbors() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("a.md"), "Body A. Links to [[b]].").unwrap();
        std::fs::write(dir.path().join("b.md"), "First paragraph of B.\n\nMore of B.").unwrap();
        std::fs::write(dir.path().join("c.md"), "First paragraph of C.\n\nLinks to [[a]].").unwrap();
        let gi = GraphIndex::build(dir.path().to_path_buf(), &AnnotationIndexOpts::default()).unwrap();
        let registry = WriteHashRegistry::new();
        let r = build_context_inner("a.md", "Sys", 1, "openai", "gpt-4o", &[], Some(&gi), Some(dir.path()), &registry, None).unwrap();
        assert!(r.system.contains("## Linked notes"), "should have linked notes section");
        assert!(r.system.contains("forward link"), "b should appear as forward link");
        assert!(r.system.contains("backlink"), "c should appear as backlink");
    }

    #[test]
    fn build_context_inner_depth_0_no_neighbors() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("a.md"), "Body A. Links to [[b]].").unwrap();
        std::fs::write(dir.path().join("b.md"), "Body B.").unwrap();
        let gi = GraphIndex::build(dir.path().to_path_buf(), &AnnotationIndexOpts::default()).unwrap();
        let registry = WriteHashRegistry::new();
        let r = build_context_inner("a.md", "Sys", 0, "openai", "gpt-4o", &[], Some(&gi), Some(dir.path()), &registry, None).unwrap();
        assert!(!r.system.contains("## Linked notes"));
    }

    #[test]
    fn build_context_inner_depth_1_dedupes() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("a.md"), "Links to [[b]].").unwrap();
        std::fs::write(dir.path().join("b.md"), "First paragraph of B.\n\nLinks to [[a]].").unwrap();
        let gi = GraphIndex::build(dir.path().to_path_buf(), &AnnotationIndexOpts::default()).unwrap();
        let registry = WriteHashRegistry::new();
        let r = build_context_inner("a.md", "Sys", 1, "openai", "gpt-4o", &[], Some(&gi), Some(dir.path()), &registry, None).unwrap();
        let neighbor_count = r.system.matches("###").count();
        assert_eq!(neighbor_count, 1, "mutual link should produce exactly one neighbor entry");
    }

    #[test]
    fn build_context_inner_depth_2_hops() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("a.md"), "Links to [[b]].").unwrap();
        std::fs::write(dir.path().join("b.md"), "First para B.\n\nLinks to [[c]].").unwrap();
        std::fs::write(dir.path().join("c.md"), "First para C.").unwrap();
        let gi = GraphIndex::build(dir.path().to_path_buf(), &AnnotationIndexOpts::default()).unwrap();
        let registry = WriteHashRegistry::new();
        let r = build_context_inner("a.md", "Sys", 2, "openai", "gpt-4o", &[], Some(&gi), Some(dir.path()), &registry, None).unwrap();
        assert!(r.system.contains("c"), "2-hop neighbor c.md should appear");
    }

    #[test]
    fn build_context_inner_neighbor_cap() {
        let dir = tempfile::tempdir().unwrap();
        let mut body = String::new();
        for i in 0..25 {
            body.push_str(&format!("[[n{i}]] "));
            std::fs::write(dir.path().join(format!("n{i}.md")), format!("Para {i}.")).unwrap();
        }
        std::fs::write(dir.path().join("hub.md"), &body).unwrap();
        let gi = GraphIndex::build(dir.path().to_path_buf(), &AnnotationIndexOpts::default()).unwrap();
        let registry = WriteHashRegistry::new();
        let r = build_context_inner("hub.md", "Sys", 1, "openai", "gpt-4o", &[], Some(&gi), Some(dir.path()), &registry, None).unwrap();
        let count = r.system.matches("###").count();
        assert!(count <= 20, "neighbor count {count} should be capped at 20");
    }

    #[test]
    fn build_context_inner_records_hash_via_provided_registry() {
        let dir = tempfile::tempdir().unwrap();
        let content = "---\ntitle: Hash Test\n---\nBody content.";
        std::fs::write(dir.path().join("note.md"), content).unwrap();
        let gi = GraphIndex::build(dir.path().to_path_buf(), &AnnotationIndexOpts::default()).unwrap();
        let registry = WriteHashRegistry::new();
        let _ = build_context_inner("note.md", "Sys", 0, "openai", "gpt-4o", &[], Some(&gi), Some(dir.path()), &registry, None).unwrap();
        assert!(registry.check(&dir.path().join("note.md"), content), "registry should record hash for the read page");
    }

    #[test]
    fn build_context_inner_is_send() {
        fn assert_send<T: Send>(_: T) {}
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("a.md"), "body").unwrap();
        let gi = GraphIndex::build(dir.path().to_path_buf(), &AnnotationIndexOpts::default()).unwrap();
        let registry = WriteHashRegistry::new();
        let result = build_context_inner("a.md", "Sys", 0, "openai", "gpt-4o", &[], Some(&gi), Some(dir.path()), &registry, None);
        assert_send(result);
    }

    #[test]
    fn build_context_resolves_explicit_provider_over_model() {
        // explicit provider wins
        assert_eq!(resolve_provider_id("openrouter", "gpt-4o"), "openrouter");
        // empty provider falls back to model sniffing
        assert_eq!(resolve_provider_id("", "claude-sonnet-4-6"), "anthropic");
        assert_eq!(resolve_provider_id("", "gpt-4o"), "openai");
    }

    #[test]
    fn provider_id_matches_credential_store() {
        use crate::commands::credential::{self, InMemoryStore};

        let cases = [
            ("openai", "gpt-4o"),
            ("anthropic", "claude-sonnet-4-6"),
            ("openrouter", "gpt-4o"),
            ("groq", "llama-3.1-70b"),
        ];
        let store = InMemoryStore::new();
        for (provider_id, _model) in &cases {
            // create_provider must succeed for each registry provider_id
            let _provider = llm::create_provider(provider_id, None);
            // credential store keyed by OUR provider_id (not provider.id())
            store
                .set("com.lit.app", &format!("{provider_id}-api-key"), "test-key")
                .unwrap();
            let key = credential::get_api_key_inner(&store, provider_id);
            assert!(
                key.is_ok(),
                "credential store should accept provider id '{provider_id}'"
            );
            assert_eq!(key.unwrap(), "test-key");
        }
    }

    #[test]
    fn test_prompt_args_with_provider() {
        let json = r#"{"provider":"openai","model":"gpt-4o","text":"hi"}"#;
        let args: LlmPromptArgs = serde_json::from_str(json).unwrap();
        assert_eq!(args.provider, "openai");
    }

    #[test]
    fn test_prompt_args_without_provider() {
        let json = r#"{"model":"gpt-4o","text":"hi"}"#;
        let args: LlmPromptArgs = serde_json::from_str(json).unwrap();
        assert_eq!(args.provider, "");
    }

    #[test]
    fn test_context_args_with_provider() {
        let json = r#"{"provider":"openai","node_id":"n1","model":"gpt-4o"}"#;
        let args: BuildContextArgs = serde_json::from_str(json).unwrap();
        assert_eq!(args.provider, "openai");
    }

    #[test]
    fn test_context_args_without_provider() {
        let json = r#"{"node_id":"n1","model":"gpt-4o"}"#;
        let args: BuildContextArgs = serde_json::from_str(json).unwrap();
        assert_eq!(args.provider, "");
    }

    #[test]
    fn build_context_args_deserializes_context_window() {
        let json = r#"{"node_id":"n1","model":"gpt-4o","context_window":4096}"#;
        let args: BuildContextArgs = serde_json::from_str(json).unwrap();
        assert_eq!(args.context_window, Some(4096));
    }

    #[test]
    fn build_context_args_context_window_defaults_none() {
        let json = r#"{"node_id":"n1","model":"gpt-4o"}"#;
        let args: BuildContextArgs = serde_json::from_str(json).unwrap();
        assert_eq!(args.context_window, None);
    }

    #[test]
    fn prompt_args_deserializes_context_window() {
        let json = r#"{"model":"gpt-4o","text":"hi","context_window":4096}"#;
        let args: LlmPromptArgs = serde_json::from_str(json).unwrap();
        assert_eq!(args.context_window, Some(4096));
    }

    #[test]
    fn prompt_args_context_window_defaults_none() {
        let json = r#"{"model":"gpt-4o","text":"hi"}"#;
        let args: LlmPromptArgs = serde_json::from_str(json).unwrap();
        assert_eq!(args.context_window, None);
    }

    #[test]
    fn build_context_inner_passes_override() {
        // A large document fits under openai's default but a tiny override
        // forces truncation, proving the override reaches build_context_layers.
        let dir = tempfile::tempdir().unwrap();
        let big_body = "word ".repeat(24_000); // ~30000 tokens, under openai doc_cap
        std::fs::write(dir.path().join("note.md"), format!("---\ntitle: Big\n---\n{big_body}")).unwrap();
        let gi = GraphIndex::build(dir.path().to_path_buf(), &AnnotationIndexOpts::default()).unwrap();
        let registry = WriteHashRegistry::new();

        let with_override = build_context_inner(
            "note.md", "Sys", 0, "openai", "gpt-4o", &[], Some(&gi), Some(dir.path()), &registry, Some(1000),
        ).unwrap();
        assert!(with_override.truncation.is_some(), "tiny override should truncate the document");

        let without = build_context_inner(
            "note.md", "Sys", 0, "openai", "gpt-4o", &[], Some(&gi), Some(dir.path()), &registry, None,
        ).unwrap();
        assert!(without.truncation.is_none(), "openai default should not truncate this document");
    }
}
