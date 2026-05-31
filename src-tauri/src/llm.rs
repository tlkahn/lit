use llm_core::types::{Message, Prompt, Role};
use llm_core::Provider;
use serde::Deserialize;
use std::collections::HashMap;

use crate::commands::credential::{self, CredentialStore};

const DEFAULT_OPENAI_URL: &str = "https://api.openai.com";
const DEFAULT_ANTHROPIC_URL: &str = "https://api.anthropic.com";

#[derive(Debug, Clone, PartialEq, Deserialize, serde::Serialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

pub fn build_prompt(
    text: &str,
    system: Option<&str>,
    messages: &[ChatMessage],
    options: &HashMap<String, serde_json::Value>,
) -> Prompt {
    let mut prompt = Prompt::new(text);

    if let Some(sys) = system {
        prompt = prompt.with_system(sys);
    }

    if !messages.is_empty() {
        let msgs: Vec<Message> = messages
            .iter()
            .map(|m| {
                let role = match m.role.as_str() {
                    "assistant" => Role::Assistant,
                    "tool" => Role::Tool,
                    _ => Role::User,
                };
                Message {
                    role,
                    content: m.content.clone(),
                    tool_calls: Vec::new(),
                    tool_results: Vec::new(),
                }
            })
            .collect();
        prompt = prompt.with_messages(msgs);
    }

    for (key, value) in options {
        prompt = prompt.with_option(key, value.clone());
    }

    prompt
}

pub fn estimate_tokens(text: &str) -> usize {
    (text.chars().count() + 3) / 4
}

const DEFAULT_CONTEXT_WINDOW: usize = 128_000;

pub fn context_window(model: &str) -> usize {
    if model.starts_with("claude-") {
        200_000
    } else {
        DEFAULT_CONTEXT_WINDOW
    }
}

pub fn estimate_prompt_size(prompt: &Prompt) -> usize {
    let mut total = estimate_tokens(&prompt.text);
    if let Some(ref sys) = prompt.system {
        total += estimate_tokens(sys);
    }
    for msg in &prompt.messages {
        total += estimate_tokens(&msg.content);
    }
    total
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct TruncationInfo {
    pub original_tokens: usize,
    pub kept_tokens: usize,
}

pub fn symmetric_trim(text: &str, budget_chars: usize) -> String {
    let char_count = text.chars().count();
    if char_count <= budget_chars {
        return text.to_string();
    }
    let trim_total = char_count - budget_chars;
    let trim_start = trim_total / 2;
    let trim_end = trim_total - trim_start;

    let start_byte = text.char_indices()
        .nth(trim_start)
        .map(|(i, _)| i)
        .unwrap_or(0);
    let end_char_idx = char_count - trim_end;
    let end_byte = text.char_indices()
        .nth(end_char_idx)
        .map(|(i, _)| i)
        .unwrap_or(text.len());

    text[start_byte..end_byte].to_string()
}

pub fn apply_token_budget(prompt: Prompt, model: &str) -> (Prompt, Option<TruncationInfo>) {
    let budget = (context_window(model) as f64 * 0.8) as usize;
    let size = estimate_prompt_size(&prompt);

    if size <= budget {
        return (prompt, None);
    }

    let overhead = size - estimate_tokens(&prompt.text);
    let text_budget_tokens = budget.saturating_sub(overhead);
    let text_budget_chars = text_budget_tokens * 4;

    let original_tokens = estimate_tokens(&prompt.text);
    let truncated = symmetric_trim(&prompt.text, text_budget_chars);

    let kept_tokens = estimate_tokens(&truncated);
    let mut result = Prompt::new(&truncated);
    result.system = prompt.system;
    result.messages = prompt.messages;
    result.options = prompt.options;
    result.attachments = prompt.attachments;
    result.tools = prompt.tools;

    (
        result,
        Some(TruncationInfo {
            original_tokens,
            kept_tokens,
        }),
    )
}

pub fn resolve_api_key_with_keychain(
    explicit: Option<&str>,
    provider_id: &str,
    store: &dyn CredentialStore,
    env_var_name: Option<&str>,
) -> Option<String> {
    if let Some(key) = explicit {
        return Some(key.to_string());
    }
    if let Ok(key) = credential::get_api_key_inner(store, provider_id) {
        return Some(key);
    }
    env_var_name.and_then(|name| std::env::var(name).ok())
}

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(tag = "type")]
pub enum LlmEvent {
    Chunk { text: String },
    Usage { input: u64, output: u64 },
    Done,
    Error { message: String, retryable: bool },
}

pub async fn process_stream<F>(
    stream: llm_core::stream::ResponseStream,
    mut emit: F,
) where
    F: FnMut(LlmEvent),
{
    use futures::StreamExt;
    use llm_core::stream::Chunk;

    let mut stream = stream;
    while let Some(item) = stream.next().await {
        match item {
            Ok(Chunk::Text(text)) => emit(LlmEvent::Chunk { text }),
            Ok(Chunk::Usage(usage)) => emit(LlmEvent::Usage {
                input: usage.input.unwrap_or(0),
                output: usage.output.unwrap_or(0),
            }),
            Ok(Chunk::Done) => {
                emit(LlmEvent::Done);
                break;
            }
            Ok(Chunk::ToolCallStart { .. } | Chunk::ToolCallDelta { .. }) => {}
            Err(e) => {
                emit(LlmEvent::Error {
                    retryable: e.is_retryable(),
                    message: e.to_string(),
                });
                break;
            }
        }
    }
}

pub async fn collect_stream_text(
    stream: llm_core::stream::ResponseStream,
) -> Result<String, String> {
    use futures::StreamExt;
    use llm_core::stream::Chunk;

    let mut text = String::new();
    let mut stream = stream;
    while let Some(item) = stream.next().await {
        match item {
            Ok(Chunk::Text(t)) => text.push_str(&t),
            Ok(Chunk::Done) => break,
            Ok(_) => {}
            Err(e) => return Err(e.to_string()),
        }
    }
    Ok(text)
}

pub fn create_provider(model: &str, base_url: Option<&str>) -> Box<dyn Provider> {
    if model.starts_with("claude-") {
        Box::new(llm_anthropic::provider::AnthropicProvider::new(
            base_url.unwrap_or(DEFAULT_ANTHROPIC_URL),
        ))
    } else {
        Box::new(llm_openai::provider::OpenAiProvider::new(
            base_url.unwrap_or(DEFAULT_OPENAI_URL),
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chat_message_serializes() {
        let msg = ChatMessage { role: "user".into(), content: "hello".into() };
        let json = serde_json::to_value(&msg).unwrap();
        assert_eq!(json["role"], "user");
        assert_eq!(json["content"], "hello");
    }

    #[test]
    fn create_provider_anthropic_sonnet() {
        let provider = create_provider("claude-sonnet-4-6", None);
        assert_eq!(provider.id(), "anthropic");
    }

    #[test]
    fn create_provider_anthropic_opus() {
        let provider = create_provider("claude-opus-4-6", None);
        assert_eq!(provider.id(), "anthropic");
    }

    #[test]
    fn create_provider_openai_gpt4o() {
        let provider = create_provider("gpt-4o", None);
        assert_eq!(provider.id(), "openai");
    }

    #[test]
    fn create_provider_unknown_defaults_to_openai() {
        let provider = create_provider("some-custom-model", None);
        assert_eq!(provider.id(), "openai");
    }

    #[test]
    fn create_provider_with_custom_base_url() {
        let provider = create_provider("gpt-4o", Some("http://localhost:8080"));
        assert_eq!(provider.id(), "openai");
    }

    #[test]
    fn build_prompt_minimal() {
        let prompt = build_prompt("Hello", None, &[], &HashMap::new());
        assert_eq!(prompt.text, "Hello");
        assert_eq!(prompt.system, None);
        assert!(prompt.messages.is_empty());
        assert!(prompt.options.is_empty());
    }

    #[test]
    fn build_prompt_with_system() {
        let prompt = build_prompt("Hello", Some("Be brief"), &[], &HashMap::new());
        assert_eq!(prompt.system.as_deref(), Some("Be brief"));
    }

    #[test]
    fn build_prompt_with_messages() {
        let messages = vec![
            ChatMessage { role: "user".into(), content: "Hi".into() },
            ChatMessage { role: "assistant".into(), content: "Hello!".into() },
            ChatMessage { role: "user".into(), content: "Follow up".into() },
        ];
        let prompt = build_prompt("Follow up", None, &messages, &HashMap::new());
        assert_eq!(prompt.messages.len(), 3);
        assert_eq!(prompt.messages[0].role, Role::User);
        assert_eq!(prompt.messages[0].content, "Hi");
        assert_eq!(prompt.messages[1].role, Role::Assistant);
        assert_eq!(prompt.messages[1].content, "Hello!");
        assert_eq!(prompt.messages[2].role, Role::User);
        assert_eq!(prompt.messages[2].content, "Follow up");
    }

    #[test]
    fn build_prompt_with_options() {
        let mut options = HashMap::new();
        options.insert("temperature".into(), serde_json::json!(0.7));
        options.insert("max_tokens".into(), serde_json::json!(100));
        let prompt = build_prompt("Hello", None, &[], &options);
        assert_eq!(prompt.options["temperature"], 0.7);
        assert_eq!(prompt.options["max_tokens"], 100);
    }

    #[test]
    fn context_window_gpt4o() {
        assert_eq!(context_window("gpt-4o"), 128_000);
    }

    #[test]
    fn context_window_claude_sonnet() {
        assert_eq!(context_window("claude-sonnet-4-6"), 200_000);
    }

    #[test]
    fn context_window_unknown() {
        assert_eq!(context_window("unknown-model"), DEFAULT_CONTEXT_WINDOW);
    }

    #[test]
    fn estimate_prompt_size_text_and_system() {
        let prompt = Prompt::new("Hello world").with_system("Be brief");
        let size = estimate_prompt_size(&prompt);
        assert!(size > 0, "should estimate nonzero size");
        assert!(size < 20, "should be reasonable for short text, got {size}");
    }

    #[test]
    fn apply_token_budget_short_text_unchanged() {
        let prompt = Prompt::new("Hello");
        let (result, trunc) = apply_token_budget(prompt, "gpt-4o");
        assert_eq!(result.text, "Hello");
        assert!(trunc.is_none());
    }

    #[test]
    fn apply_token_budget_long_text_truncated() {
        let long_text = "word ".repeat(200_000);
        let prompt = Prompt::new(&long_text);
        let (result, trunc) = apply_token_budget(prompt, "gpt-4o");
        assert!(result.text.len() < long_text.len(), "text should be truncated");
        let info = trunc.expect("should have truncation info");
        assert!(info.kept_tokens < info.original_tokens);
    }

    #[test]
    fn apply_token_budget_symmetric_truncation() {
        let long_text = "word ".repeat(200_000);
        let prompt = Prompt::new(&long_text);
        let (result, _) = apply_token_budget(prompt, "gpt-4o");
        let center_of_original = long_text.len() / 2;
        let center_region = &long_text[center_of_original - 10..center_of_original + 10];
        assert!(
            result.text.contains(center_region),
            "center of original should be preserved in truncated text"
        );
    }

    #[test]
    fn estimate_tokens_empty() {
        assert_eq!(estimate_tokens(""), 0);
    }

    #[test]
    fn estimate_tokens_short() {
        let count = estimate_tokens("Hello, world! This is a test.");
        assert!(count >= 1 && count <= 20, "got {count}");
    }

    #[test]
    fn estimate_tokens_long() {
        let text = "a".repeat(4000);
        let count = estimate_tokens(&text);
        assert!(count >= 900 && count <= 1100, "got {count}");
    }

    fn mock_stream(
        chunks: Vec<Result<llm_core::stream::Chunk, llm_core::error::LlmError>>,
    ) -> llm_core::stream::ResponseStream {
        Box::pin(futures::stream::iter(chunks))
    }

    #[tokio::test]
    async fn process_stream_text_and_done() {
        use llm_core::stream::Chunk;
        let stream = mock_stream(vec![
            Ok(Chunk::Text("Hello".into())),
            Ok(Chunk::Text(" world".into())),
            Ok(Chunk::Done),
        ]);
        let mut events = Vec::new();
        process_stream(stream, |e| events.push(e)).await;
        assert_eq!(events, vec![
            LlmEvent::Chunk { text: "Hello".into() },
            LlmEvent::Chunk { text: " world".into() },
            LlmEvent::Done,
        ]);
    }

    #[tokio::test]
    async fn process_stream_usage() {
        use llm_core::stream::Chunk;
        use llm_core::types::Usage;
        let stream = mock_stream(vec![
            Ok(Chunk::Usage(Usage { input: Some(10), output: Some(5), details: None })),
            Ok(Chunk::Done),
        ]);
        let mut events = Vec::new();
        process_stream(stream, |e| events.push(e)).await;
        assert_eq!(events, vec![
            LlmEvent::Usage { input: 10, output: 5 },
            LlmEvent::Done,
        ]);
    }

    #[tokio::test]
    async fn process_stream_http_error_retryable() {
        let stream = mock_stream(vec![
            Err(llm_core::error::LlmError::HttpError { status: 429, message: "rate limited".into() }),
        ]);
        let mut events = Vec::new();
        process_stream(stream, |e| events.push(e)).await;
        assert_eq!(events.len(), 1);
        assert_eq!(events[0], LlmEvent::Error { message: "HTTP error 429: rate limited".into(), retryable: true });
    }

    #[tokio::test]
    async fn process_stream_needs_key_not_retryable() {
        let stream = mock_stream(vec![
            Err(llm_core::error::LlmError::NeedsKey("missing".into())),
        ]);
        let mut events = Vec::new();
        process_stream(stream, |e| events.push(e)).await;
        assert_eq!(events.len(), 1);
        assert_eq!(events[0], LlmEvent::Error { message: "no key found: missing".into(), retryable: false });
    }

    #[tokio::test]
    async fn process_stream_ignores_tool_calls() {
        use llm_core::stream::Chunk;
        let stream = mock_stream(vec![
            Ok(Chunk::Text("Hi".into())),
            Ok(Chunk::ToolCallStart { name: "search".into(), id: None }),
            Ok(Chunk::ToolCallDelta { content: "{}".into() }),
            Ok(Chunk::Done),
        ]);
        let mut events = Vec::new();
        process_stream(stream, |e| events.push(e)).await;
        assert_eq!(events, vec![
            LlmEvent::Chunk { text: "Hi".into() },
            LlmEvent::Done,
        ]);
    }

    #[tokio::test]
    async fn integration_openai_streaming() {
        use wiremock::{MockServer, Mock, ResponseTemplate};
        use wiremock::matchers::{method, path};

        let server = MockServer::start().await;
        let sse_body = "\
data: {\"id\":\"1\",\"object\":\"chat.completion.chunk\",\"model\":\"gpt-4o\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"Hello\"},\"finish_reason\":null}]}\n\n\
data: {\"id\":\"1\",\"object\":\"chat.completion.chunk\",\"model\":\"gpt-4o\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\" world\"},\"finish_reason\":null}]}\n\n\
data: {\"id\":\"1\",\"object\":\"chat.completion.chunk\",\"model\":\"gpt-4o\",\"choices\":[{\"index\":0,\"delta\":{},\"finish_reason\":\"stop\"}]}\n\n\
data: [DONE]\n\n";

        Mock::given(method("POST"))
            .and(path("/v1/chat/completions"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_raw(sse_body, "text/event-stream"),
            )
            .mount(&server)
            .await;

        let provider = create_provider("gpt-4o", Some(&server.uri()));
        let prompt = Prompt::new("Say hello");
        let stream = provider.execute("gpt-4o", &prompt, Some("fake-key"), true).await.unwrap();

        let mut events = Vec::new();
        process_stream(stream, |e| events.push(e)).await;

        assert!(events.contains(&LlmEvent::Chunk { text: "Hello".into() }));
        assert!(events.contains(&LlmEvent::Chunk { text: " world".into() }));
        assert!(events.contains(&LlmEvent::Done));
    }

    #[tokio::test]
    async fn integration_anthropic_streaming() {
        use wiremock::{MockServer, Mock, ResponseTemplate};
        use wiremock::matchers::{method, path};

        let server = MockServer::start().await;
        let sse_body = format!(
            "{}{}{}{}{}{}{}",
            "event: message_start\ndata: {\"type\":\"message_start\",\"message\":{\"id\":\"msg_1\",\"type\":\"message\",\"role\":\"assistant\",\"model\":\"claude-sonnet-4-6\",\"usage\":{\"input_tokens\":10,\"output_tokens\":0}}}\n\n",
            "event: content_block_start\ndata: {\"type\":\"content_block_start\",\"index\":0,\"content_block\":{\"type\":\"text\",\"text\":\"\"}}\n\n",
            "event: content_block_delta\ndata: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\"Hello\"}}\n\n",
            "event: content_block_delta\ndata: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\" world\"}}\n\n",
            "event: content_block_stop\ndata: {\"type\":\"content_block_stop\",\"index\":0}\n\n",
            "event: message_delta\ndata: {\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"end_turn\"},\"usage\":{\"output_tokens\":5}}\n\n",
            "event: message_stop\ndata: {\"type\":\"message_stop\"}\n\n",
        );

        Mock::given(method("POST"))
            .and(path("/v1/messages"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_raw(sse_body, "text/event-stream"),
            )
            .mount(&server)
            .await;

        let provider = create_provider("claude-sonnet-4-6", Some(&server.uri()));
        let prompt = Prompt::new("Say hello");
        let stream = provider.execute("claude-sonnet-4-6", &prompt, Some("fake-key"), true).await.unwrap();

        let mut events = Vec::new();
        process_stream(stream, |e| events.push(e)).await;

        assert!(events.contains(&LlmEvent::Chunk { text: "Hello".into() }));
        assert!(events.contains(&LlmEvent::Chunk { text: " world".into() }));
        assert!(events.contains(&LlmEvent::Done));
    }

    #[test]
    fn symmetric_trim_exact_budget_odd_trim() {
        let input = "abcdefghijk"; // 11 chars
        let result = symmetric_trim(input, 8);
        assert_eq!(result.chars().count(), 8, "expected exactly 8 chars, got {}", result.chars().count());
    }

    #[test]
    fn symmetric_trim_exact_budget_even_trim() {
        let input = "abcdefghij"; // 10 chars
        let result = symmetric_trim(input, 6);
        assert_eq!(result.chars().count(), 6, "expected exactly 6 chars, got {}", result.chars().count());
    }

    #[test]
    fn symmetric_trim_odd_trim_cjk() {
        let input = "a你b好c世d界e魂f"; // 11 chars (mixed ASCII + CJK)
        assert_eq!(input.chars().count(), 11);
        let result = symmetric_trim(input, 8);
        assert_eq!(result.chars().count(), 8, "expected exactly 8 chars, got {}", result.chars().count());
    }

    #[test]
    fn estimate_tokens_cjk() {
        let count = estimate_tokens("你好世界");
        assert!(count >= 1 && count <= 2, "got {count}");
    }

    #[test]
    fn apply_token_budget_cjk_no_panic() {
        let cjk_text = "你好".repeat(300_000);
        let prompt = Prompt::new(&cjk_text);
        let (result, trunc) = apply_token_budget(prompt, "gpt-4o");
        assert!(result.text.len() < cjk_text.len());
        let info = trunc.expect("should have truncation info");
        assert!(info.kept_tokens < info.original_tokens);
    }

    #[test]
    fn apply_token_budget_cjk_preserves_center() {
        let cjk_text = "你好".repeat(300_000);
        let prompt = Prompt::new(&cjk_text);
        let (result, _) = apply_token_budget(prompt, "gpt-4o");
        let char_count = cjk_text.chars().count();
        let center_char = char_count / 2;
        let check_start: String = cjk_text.chars().skip(center_char - 2).take(4).collect();
        assert!(result.text.contains(&check_start));
    }

    #[test]
    fn apply_token_budget_mixed_script_no_panic() {
        let mixed = "Hello你好World世界".repeat(50_000);
        let prompt = Prompt::new(&mixed);
        let (result, _) = apply_token_budget(prompt, "gpt-4o");
        assert!(result.text.len() < mixed.len());
    }

    #[tokio::test]
    async fn integration_error_before_stream() {
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

        let provider = create_provider("gpt-4o", Some(&server.uri()));
        let prompt = Prompt::new("Hello");
        let result = provider.execute("gpt-4o", &prompt, Some("bad-key"), true).await;

        match result {
            Err(err) => assert!(!err.is_retryable()),
            Ok(_) => panic!("expected error for 401 response"),
        }
    }

    #[tokio::test]
    async fn collect_stream_text_concatenates_text_chunks() {
        use llm_core::stream::Chunk;
        let stream = mock_stream(vec![
            Ok(Chunk::Text("Hello".into())),
            Ok(Chunk::Text(" world".into())),
            Ok(Chunk::Done),
        ]);
        let result = collect_stream_text(stream).await.unwrap();
        assert_eq!(result, "Hello world");
    }

    #[tokio::test]
    async fn collect_stream_text_returns_error_on_error_chunk() {
        let stream = mock_stream(vec![
            Err(llm_core::error::LlmError::HttpError {
                status: 401,
                message: "Unauthorized".into(),
            }),
        ]);
        let result = collect_stream_text(stream).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("401"));
    }

    #[tokio::test]
    async fn collect_stream_text_empty_stream() {
        use llm_core::stream::Chunk;
        let stream = mock_stream(vec![Ok(Chunk::Done)]);
        let result = collect_stream_text(stream).await.unwrap();
        assert_eq!(result, "");
    }

    #[tokio::test]
    async fn collect_stream_text_ignores_non_text_chunks() {
        use llm_core::stream::Chunk;
        use llm_core::types::Usage;
        let stream = mock_stream(vec![
            Ok(Chunk::Text("A".into())),
            Ok(Chunk::Usage(Usage { input: Some(10), output: Some(5), details: None })),
            Ok(Chunk::ToolCallStart { name: "search".into(), id: None }),
            Ok(Chunk::ToolCallDelta { content: "{}".into() }),
            Ok(Chunk::Text("B".into())),
            Ok(Chunk::Done),
        ]);
        let result = collect_stream_text(stream).await.unwrap();
        assert_eq!(result, "AB");
    }

    use crate::commands::credential::InMemoryStore;

    #[test]
    fn resolve_with_keychain_explicit_wins() {
        let store = InMemoryStore::new();
        store.set("com.lit.app", "anthropic-api-key", "keychain-key").unwrap();
        std::env::set_var("LIT_TEST_EXPLICIT_WINS", "env-key");
        let result = resolve_api_key_with_keychain(
            Some("explicit-key"),
            "anthropic",
            &store,
            Some("LIT_TEST_EXPLICIT_WINS"),
        );
        std::env::remove_var("LIT_TEST_EXPLICIT_WINS");
        assert_eq!(result.as_deref(), Some("explicit-key"));
    }

    #[test]
    fn resolve_with_keychain_falls_back_to_keychain() {
        let store = InMemoryStore::new();
        store.set("com.lit.app", "anthropic-api-key", "keychain-key").unwrap();
        let result = resolve_api_key_with_keychain(
            None,
            "anthropic",
            &store,
            Some("LIT_TEST_NONEXISTENT_VAR_ABC"),
        );
        assert_eq!(result.as_deref(), Some("keychain-key"));
    }

    #[test]
    fn resolve_with_keychain_falls_back_to_env() {
        let store = InMemoryStore::new();
        std::env::set_var("LIT_TEST_FALLBACK_ENV", "env-key");
        let result = resolve_api_key_with_keychain(
            None,
            "anthropic",
            &store,
            Some("LIT_TEST_FALLBACK_ENV"),
        );
        std::env::remove_var("LIT_TEST_FALLBACK_ENV");
        assert_eq!(result.as_deref(), Some("env-key"));
    }

    #[test]
    fn resolve_with_keychain_returns_none_when_all_absent() {
        let store = InMemoryStore::new();
        let result = resolve_api_key_with_keychain(
            None,
            "anthropic",
            &store,
            Some("LIT_TEST_NONEXISTENT_VAR_XYZ"),
        );
        assert_eq!(result, None);
    }

    #[test]
    fn resolve_with_keychain_priority_order() {
        let store = InMemoryStore::new();
        store.set("com.lit.app", "openai-api-key", "keychain-key").unwrap();
        std::env::set_var("LIT_TEST_PRIORITY", "env-key");

        // With all three present, explicit wins
        let r1 = resolve_api_key_with_keychain(
            Some("explicit"),
            "openai",
            &store,
            Some("LIT_TEST_PRIORITY"),
        );
        assert_eq!(r1.as_deref(), Some("explicit"));

        // Without explicit, keychain wins over env
        let r2 = resolve_api_key_with_keychain(
            None,
            "openai",
            &store,
            Some("LIT_TEST_PRIORITY"),
        );
        assert_eq!(r2.as_deref(), Some("keychain-key"));

        // Without explicit or keychain, env wins
        let store_empty = InMemoryStore::new();
        let r3 = resolve_api_key_with_keychain(
            None,
            "openai",
            &store_empty,
            Some("LIT_TEST_PRIORITY"),
        );
        assert_eq!(r3.as_deref(), Some("env-key"));

        std::env::remove_var("LIT_TEST_PRIORITY");
    }

    #[test]
    fn resolve_with_keychain_release_build_scenario() {
        // Replicates the bug: no explicit key, no env var (release .app bundle),
        // but keychain has the key stored — the function still finds it.
        let store = InMemoryStore::new();
        store.set("com.lit.app", "anthropic-api-key", "sk-from-keychain").unwrap();

        let result = resolve_api_key_with_keychain(
            None,
            "anthropic",
            &store,
            Some("ANTHROPIC_API_KEY_NONEXISTENT_TEST"),
        );
        assert_eq!(result.as_deref(), Some("sk-from-keychain"));
    }
}
