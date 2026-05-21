use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tokio::task::JoinHandle;

use serde::Deserialize;
use tauri::{Emitter, Window};

use crate::llm::{self, ChatMessage, LlmEvent};
use super::credential::{self, CredentialStore};

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
    pub api_key: Option<String>,
}

#[tauri::command]
pub async fn llm_prompt_streaming(
    args: LlmPromptArgs,
    window: Window,
    state: tauri::State<'_, LlmState>,
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
    if let Some(info) = truncation {
        let _ = window.emit("llm://truncated", &info);
    }

    let env_var_name = provider.key_env_var();
    let api_key = llm::resolve_api_key(args.api_key.as_deref(), env_var_name);

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
    let prompt = llm::build_prompt("hi", None, &[], &HashMap::new());
    let api_key = match api_key {
        Some(k) => Some(k.to_string()),
        None => {
            let env_var = provider.key_env_var();
            llm::resolve_api_key(None, env_var)
        }
    };
    let _ = provider
        .execute(model, &prompt, api_key.as_deref(), false)
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
    let provider_name = if model.starts_with("claude-") { "anthropic" } else { "openai" };
    let keychain_key = credential::get_api_key_inner(store.as_ref(), provider_name).ok();
    let provider = llm::create_provider(&model, base_url.as_deref());
    let env_var_name = provider.key_env_var();
    let api_key = llm::resolve_api_key(keychain_key.as_deref(), env_var_name);
    test_connection_inner(&model, api_key.as_deref(), base_url.as_deref()).await
}

#[cfg(test)]
mod tests {
    use super::*;

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
}
