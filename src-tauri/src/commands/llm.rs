use std::collections::HashMap;
use std::sync::Mutex;
use tokio::task::JoinHandle;

use serde::Deserialize;
use tauri::{Emitter, Window};

use crate::llm::{self, ChatMessage, LlmEvent};

pub struct LlmState {
    active: Mutex<Option<JoinHandle<()>>>,
}

impl LlmState {
    pub fn new() -> Self {
        Self {
            active: Mutex::new(None),
        }
    }

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
    });

    state.set_active(handle);
    Ok(())
}

#[tauri::command]
pub fn llm_cancel(state: tauri::State<'_, LlmState>) -> Result<(), String> {
    state.cancel();
    Ok(())
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
}
