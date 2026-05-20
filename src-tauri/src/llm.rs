use llm_core::types::{Message, Prompt, Role};
use llm_core::Provider;
use serde::Deserialize;
use std::collections::HashMap;

const DEFAULT_OPENAI_URL: &str = "https://api.openai.com";
const DEFAULT_ANTHROPIC_URL: &str = "https://api.anthropic.com";

#[derive(Debug, Clone, Deserialize)]
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
    (text.len() + 3) / 4
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
    let text = &prompt.text;
    let truncated = if text.len() > text_budget_chars {
        let trim_total = text.len() - text_budget_chars;
        let trim_each = trim_total / 2;
        let start = trim_each;
        let end = text.len() - trim_each;
        text[start..end].to_string()
    } else {
        text.clone()
    };

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

pub fn resolve_api_key(explicit: Option<&str>, env_var_name: Option<&str>) -> Option<String> {
    if let Some(key) = explicit {
        return Some(key.to_string());
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

    #[test]
    fn resolve_api_key_explicit() {
        let key = resolve_api_key(Some("sk-123"), None);
        assert_eq!(key.as_deref(), Some("sk-123"));
    }

    #[test]
    fn resolve_api_key_no_explicit_no_env_var_name() {
        let key = resolve_api_key(None, None);
        assert_eq!(key, None);
    }

    #[test]
    fn resolve_api_key_no_explicit_env_var_not_set() {
        let key = resolve_api_key(None, Some("LIT_TEST_NONEXISTENT_KEY_XYZ"));
        assert_eq!(key, None);
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
}
