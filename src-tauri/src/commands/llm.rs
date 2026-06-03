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
    pub model: String,
    pub text: String,
    pub system: Option<String>,
    #[serde(default)]
    pub messages: Vec<ChatMessage>,
    #[serde(default)]
    pub options: HashMap<String, serde_json::Value>,
    pub base_url: Option<String>,
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

    let provider = llm::create_provider(&args.model, args.base_url.as_deref());

    let prompt = llm::build_prompt(
        &args.text,
        args.system.as_deref(),
        &args.messages,
        &args.options,
    );

    let (prompt, truncation) = llm::apply_token_budget(prompt, &args.model);

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

    let api_key = llm::resolve_api_key(provider.id(), store.as_ref());

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
    model: &str,
    api_key: Option<&str>,
    base_url: Option<&str>,
) -> Result<(), String> {
    let provider = llm::create_provider(model, base_url);
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
    base_url: Option<String>,
    store: tauri::State<'_, Arc<dyn CredentialStore>>,
) -> Result<(), String> {
    let provider = llm::create_provider(&model, base_url.as_deref());
    let api_key = llm::resolve_api_key(provider.id(), store.as_ref());
    test_connection_inner(&model, api_key.as_deref(), base_url.as_deref()).await
}

pub fn build_context_inner(
    node_id: &str,
    system_prompt: &str,
    neighbors_depth: usize,
    model: &str,
    messages: &[ChatMessage],
    graph_index: Option<&GraphIndex>,
    workspace_root: Option<&Path>,
    registry: &WriteHashRegistry,
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
        system_prompt, messages, &doc_content, &doc_title, &neighbors, model,
    ))
}

#[derive(Deserialize)]
pub struct BuildContextArgs {
    pub node_id: String,
    #[serde(default)]
    pub system_prompt: String,
    #[serde(default)]
    pub neighbors_depth: usize,
    pub model: String,
    #[serde(default)]
    pub messages: Vec<ChatMessage>,
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
            &args.model,
            &args.messages,
            gi_arc.as_deref(),
            root.as_deref(),
            &registry,
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
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

        let result = test_connection_inner("gpt-4o", Some("fake-key"), Some(&server.uri())).await;
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

        let result = test_connection_inner("gpt-4o", Some("bad-key"), Some(&server.uri())).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_connection_fails_without_key() {
        let result = test_connection_inner("gpt-4o", None, Some("http://localhost:1")).await;
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
        let result = test_connection_inner("gpt-4o", None, Some(&server.uri())).await;
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

        let _ = test_connection_inner("gpt-4o", Some("fake-key"), Some(&server.uri())).await;

        let received = server.received_requests().await.unwrap();
        assert_eq!(received.len(), 1);
        let req_body: serde_json::Value = serde_json::from_slice(&received[0].body).unwrap();
        assert_eq!(req_body["max_tokens"], 1, "test_connection should send max_tokens=1 to minimize token usage");
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
        let result = build_context_inner(GLOBAL_NODE_ID, "Be helpful", 0, "gpt-4o", &msgs, None, None, &registry).unwrap();
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
        let gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();
        let registry = WriteHashRegistry::new();
        let r = build_context_inner("note.md", "Sys", 0, "gpt-4o", &[], Some(&gi), Some(dir.path()), &registry).unwrap();
        assert!(r.system.contains("## Current document:"), "should contain document section");
        assert!(r.system.contains("The body."));
    }

    #[test]
    fn build_context_inner_missing_page_graceful() {
        let dir = tempfile::tempdir().unwrap();
        let gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();
        let registry = WriteHashRegistry::new();
        let r = build_context_inner("ghost.md", "Sys", 0, "gpt-4o", &[], Some(&gi), Some(dir.path()), &registry);
        assert!(r.is_ok());
        assert!(!r.unwrap().system.contains("## Current document"));
    }

    #[test]
    fn build_context_inner_depth_1_neighbors() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("a.md"), "Body A. Links to [[b]].").unwrap();
        std::fs::write(dir.path().join("b.md"), "First paragraph of B.\n\nMore of B.").unwrap();
        std::fs::write(dir.path().join("c.md"), "First paragraph of C.\n\nLinks to [[a]].").unwrap();
        let gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();
        let registry = WriteHashRegistry::new();
        let r = build_context_inner("a.md", "Sys", 1, "gpt-4o", &[], Some(&gi), Some(dir.path()), &registry).unwrap();
        assert!(r.system.contains("## Linked notes"), "should have linked notes section");
        assert!(r.system.contains("forward link"), "b should appear as forward link");
        assert!(r.system.contains("backlink"), "c should appear as backlink");
    }

    #[test]
    fn build_context_inner_depth_0_no_neighbors() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("a.md"), "Body A. Links to [[b]].").unwrap();
        std::fs::write(dir.path().join("b.md"), "Body B.").unwrap();
        let gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();
        let registry = WriteHashRegistry::new();
        let r = build_context_inner("a.md", "Sys", 0, "gpt-4o", &[], Some(&gi), Some(dir.path()), &registry).unwrap();
        assert!(!r.system.contains("## Linked notes"));
    }

    #[test]
    fn build_context_inner_depth_1_dedupes() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("a.md"), "Links to [[b]].").unwrap();
        std::fs::write(dir.path().join("b.md"), "First paragraph of B.\n\nLinks to [[a]].").unwrap();
        let gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();
        let registry = WriteHashRegistry::new();
        let r = build_context_inner("a.md", "Sys", 1, "gpt-4o", &[], Some(&gi), Some(dir.path()), &registry).unwrap();
        let neighbor_count = r.system.matches("###").count();
        assert_eq!(neighbor_count, 1, "mutual link should produce exactly one neighbor entry");
    }

    #[test]
    fn build_context_inner_depth_2_hops() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("a.md"), "Links to [[b]].").unwrap();
        std::fs::write(dir.path().join("b.md"), "First para B.\n\nLinks to [[c]].").unwrap();
        std::fs::write(dir.path().join("c.md"), "First para C.").unwrap();
        let gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();
        let registry = WriteHashRegistry::new();
        let r = build_context_inner("a.md", "Sys", 2, "gpt-4o", &[], Some(&gi), Some(dir.path()), &registry).unwrap();
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
        let gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();
        let registry = WriteHashRegistry::new();
        let r = build_context_inner("hub.md", "Sys", 1, "gpt-4o", &[], Some(&gi), Some(dir.path()), &registry).unwrap();
        let count = r.system.matches("###").count();
        assert!(count <= 20, "neighbor count {count} should be capped at 20");
    }

    #[test]
    fn build_context_inner_records_hash_via_provided_registry() {
        let dir = tempfile::tempdir().unwrap();
        let content = "---\ntitle: Hash Test\n---\nBody content.";
        std::fs::write(dir.path().join("note.md"), content).unwrap();
        let gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();
        let registry = WriteHashRegistry::new();
        let _ = build_context_inner("note.md", "Sys", 0, "gpt-4o", &[], Some(&gi), Some(dir.path()), &registry).unwrap();
        assert!(registry.check(&dir.path().join("note.md"), content), "registry should record hash for the read page");
    }

    #[test]
    fn build_context_inner_is_send() {
        fn assert_send<T: Send>(_: T) {}
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("a.md"), "body").unwrap();
        let gi = GraphIndex::build(dir.path().to_path_buf(), true).unwrap();
        let registry = WriteHashRegistry::new();
        let result = build_context_inner("a.md", "Sys", 0, "gpt-4o", &[], Some(&gi), Some(dir.path()), &registry);
        assert_send(result);
    }

    #[test]
    fn provider_id_matches_credential_store() {
        use crate::commands::credential::{self, InMemoryStore};

        let models_and_expected = [
            ("claude-sonnet-4-6", "anthropic"),
            ("claude-opus-4-6", "anthropic"),
            ("gpt-4o", "openai"),
            ("gpt-4o-mini", "openai"),
        ];
        let store = InMemoryStore::new();
        for (model, expected_id) in &models_and_expected {
            let provider = llm::create_provider(model, None);
            let id = provider.id();
            assert_eq!(id, *expected_id, "provider.id() for model {model}");
            store.set("com.lit.app", &format!("{}-api-key", id), "test-key").unwrap();
            let key = credential::get_api_key_inner(&store, id);
            assert!(key.is_ok(), "credential store should accept provider id '{id}' for model '{model}'");
        }
    }
}
