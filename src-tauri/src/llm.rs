use llm_core::types::{Attachment, AttachmentSource, Message, Prompt, Role};
use llm_core::Provider;
use serde::Deserialize;
use std::collections::HashMap;

use crate::commands::credential::{self, CredentialStore};
use crate::provider_registry;

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

pub fn build_prompt_with_attachments(
    text: &str,
    system: Option<&str>,
    messages: &[ChatMessage],
    options: &HashMap<String, serde_json::Value>,
    attachments: Vec<Attachment>,
) -> Prompt {
    let prompt = build_prompt(text, system, messages, options);
    if attachments.is_empty() {
        prompt
    } else {
        prompt.with_attachments(attachments)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct AttachmentCapabilityError {
    pub model: String,
    pub unsupported_types: Vec<String>,
}

impl std::fmt::Display for AttachmentCapabilityError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "Model '{}' does not support attachment types: {}",
            self.model,
            self.unsupported_types.join(", ")
        )
    }
}

impl std::error::Error for AttachmentCapabilityError {}

/// Check whether the given provider+model combination supports the MIME types
/// of the supplied attachments.
///
/// - No attachments -> `Ok(())`
/// - Known model in `provider.models()` -> check `attachment_types` against
///   each attachment's `mime_type`
/// - Unknown model on a provider that declares default attachment types
///   -> allow those default types
/// - Provider with no default attachment types -> reject all attachments
pub fn check_attachment_capability(
    provider: &dyn Provider,
    model: &str,
    attachments: &[Attachment],
) -> Result<(), AttachmentCapabilityError> {
    if attachments.is_empty() {
        return Ok(());
    }

    // Collect the MIME types that need checking. URL-source attachments with
    // no declared MIME are pass-through (providers fetch and sniff natively).
    // Path/Bytes sources with no MIME fall back to "application/octet-stream"
    // which will be rejected by any allowlist.
    let attachment_mimes: Vec<String> = attachments
        .iter()
        .filter_map(|a| match (&a.mime_type, &a.source) {
            (Some(mime), _) => Some(mime.clone()),
            (None, AttachmentSource::Url(_)) => None, // pass-through
            (None, _) => Some("application/octet-stream".to_string()),
        })
        .collect();

    if attachment_mimes.is_empty() {
        return Ok(());
    }

    // Try to find the model in the provider's known model list
    let models = provider.models();
    if let Some(model_info) = models.iter().find(|m| m.id == model) {
        // Known model: check against its declared attachment_types
        let unsupported: Vec<String> = attachment_mimes
            .iter()
            .filter(|mime| !model_info.supports_mime(mime))
            .cloned()
            .collect();
        if unsupported.is_empty() {
            Ok(())
        } else {
            Err(AttachmentCapabilityError {
                model: model.to_string(),
                unsupported_types: unsupported,
            })
        }
    } else {
        // Unknown model: check provider's default attachment types
        let defaults = provider.default_attachment_types();

        if defaults.is_empty() {
            // Provider declares no default vision support: reject all
            Err(AttachmentCapabilityError {
                model: model.to_string(),
                unsupported_types: attachment_mimes,
            })
        } else {
            let unsupported: Vec<String> = attachment_mimes
                .iter()
                .filter(|mime| !defaults.iter().any(|allowed| *allowed == mime.as_str()))
                .cloned()
                .collect();
            if unsupported.is_empty() {
                Ok(())
            } else {
                Err(AttachmentCapabilityError {
                    model: model.to_string(),
                    unsupported_types: unsupported,
                })
            }
        }
    }
}

pub fn estimate_tokens(text: &str) -> usize {
    (text.chars().count() + 3) / 4
}

const DEFAULT_CONTEXT_WINDOW: usize = 128_000;
const IMAGE_TOKEN_ESTIMATE: usize = 1000;

/// Minimum tokens reserved for user text when attachments are present.
/// Prevents attachment overhead from starving the text budget to zero.
const MIN_TEXT_BUDGET_TOKENS: usize = 100;

pub fn context_window(provider_id: &str) -> usize {
    provider_registry::lookup(provider_id)
        .map(|e| e.default_context_window)
        .unwrap_or(DEFAULT_CONTEXT_WINDOW)
}

pub fn estimate_prompt_size(prompt: &Prompt) -> usize {
    let mut total = estimate_tokens(&prompt.text);
    if let Some(ref sys) = prompt.system {
        total += estimate_tokens(sys);
    }
    for msg in &prompt.messages {
        total += estimate_tokens(&msg.content);
    }
    total += prompt.attachments.len() * IMAGE_TOKEN_ESTIMATE;
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

pub fn apply_token_budget(prompt: Prompt, provider_id: &str, _model: &str, context_window_override: Option<usize>) -> Result<(Prompt, Option<TruncationInfo>), String> {
    let window = context_window_override.unwrap_or_else(|| context_window(provider_id));
    let budget = (window as f64 * 0.8) as usize;
    let size = estimate_prompt_size(&prompt);

    if size <= budget {
        return Ok((prompt, None));
    }

    let overhead = size - estimate_tokens(&prompt.text);

    // When attachments are present, ensure text gets at least MIN_TEXT_BUDGET_TOKENS.
    // If even that minimum is impossible (attachments alone exceed the budget),
    // return an error instead of silently sending an empty question.
    let text_budget_tokens = if !prompt.attachments.is_empty() {
        if overhead > budget {
            return Err(format!(
                "Attachments ({} images) require ~{} tokens, which exceeds the {}-token budget \
                 (80% of {} context window). Remove some attachments or use a model with a larger context window.",
                prompt.attachments.len(),
                overhead,
                budget,
                window,
            ));
        }
        let raw = budget.saturating_sub(overhead);
        raw.max(MIN_TEXT_BUDGET_TOKENS.min(estimate_tokens(&prompt.text)))
    } else {
        budget.saturating_sub(overhead)
    };
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

    Ok((
        result,
        Some(TruncationInfo {
            original_tokens,
            kept_tokens,
        }),
    ))
}

pub fn resolve_api_key(provider_id: &str, store: &dyn CredentialStore) -> Option<String> {
    credential::get_api_key_inner(store, provider_id).ok()
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

pub fn provider_id_for_model(model: &str) -> &'static str {
    if model.starts_with("claude-") {
        "anthropic"
    } else {
        "openai"
    }
}

pub fn create_provider(provider_id: &str, base_url: Option<&str>) -> Box<dyn Provider> {
    match provider_registry::lookup(provider_id) {
        Some(entry) => match entry.wire_format {
            provider_registry::WireFormat::Anthropic => Box::new(
                llm_anthropic::provider::AnthropicProvider::new(
                    base_url.unwrap_or(entry.default_base_url),
                ),
            ),
            provider_registry::WireFormat::OpenAi => {
                let url = base_url.unwrap_or(entry.default_base_url);
                if entry.extra_headers.is_empty() {
                    Box::new(llm_openai::provider::OpenAiProvider::new(url))
                } else {
                    let headers = entry.extra_headers
                        .iter()
                        .map(|(k, v)| (k.to_string(), v.to_string()))
                        .collect();
                    Box::new(llm_openai::provider::OpenAiProvider::with_extra_headers(url, headers))
                }
            }
        },
        // Unknown id → fall back to OpenAI wire format on the OpenAI default URL.
        None => Box::new(llm_openai::provider::OpenAiProvider::new(
            base_url.unwrap_or("https://api.openai.com"),
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use async_trait::async_trait;
    use llm_core::types::{AttachmentSource, ModelInfo};

    #[test]
    fn chat_message_serializes() {
        let msg = ChatMessage { role: "user".into(), content: "hello".into() };
        let json = serde_json::to_value(&msg).unwrap();
        assert_eq!(json["role"], "user");
        assert_eq!(json["content"], "hello");
    }

    #[test]
    fn create_provider_anthropic_sonnet() {
        let provider = create_provider("anthropic", None);
        assert_eq!(provider.id(), "anthropic");
    }

    #[test]
    fn create_provider_anthropic_opus() {
        let provider = create_provider("anthropic", None);
        assert_eq!(provider.id(), "anthropic");
    }

    #[test]
    fn create_provider_openai_gpt4o() {
        let provider = create_provider("openai", None);
        assert_eq!(provider.id(), "openai");
    }

    #[test]
    fn create_provider_unknown_defaults_to_openai() {
        let provider = create_provider("nonexistent", None);
        assert_eq!(provider.id(), "openai");
    }

    #[test]
    fn create_provider_with_custom_base_url() {
        let provider = create_provider("openai", Some("http://localhost:8080"));
        assert_eq!(provider.id(), "openai");
    }

    #[test]
    fn create_provider_openrouter() {
        let p = create_provider("openrouter", None);
        assert_eq!(p.id(), "openai");
    }

    #[test]
    fn create_provider_ollama() {
        let p = create_provider("ollama", None);
        assert_eq!(p.id(), "openai");
    }

    #[test]
    fn provider_id_for_model_maps_claude_to_anthropic() {
        assert_eq!(provider_id_for_model("claude-sonnet-4-6"), "anthropic");
        assert_eq!(provider_id_for_model("gpt-4o"), "openai");
        assert_eq!(provider_id_for_model("llama-3.1-70b"), "openai");
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
        assert_eq!(context_window("openai"), 128_000);
    }

    #[test]
    fn context_window_claude_sonnet() {
        assert_eq!(context_window("anthropic"), 200_000);
    }

    #[test]
    fn context_window_unknown() {
        assert_eq!(context_window("nonexistent"), DEFAULT_CONTEXT_WINDOW);
    }

    #[test]
    fn context_window_groq() {
        assert_eq!(context_window("groq"), 128_000);
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
        let (result, trunc) = apply_token_budget(prompt, "openai", "gpt-4o", None).unwrap();
        assert_eq!(result.text, "Hello");
        assert!(trunc.is_none());
    }

    #[test]
    fn apply_token_budget_override_some_wins() {
        // Build a prompt that fits comfortably under openai's 128k default
        // (0.8 * 128000 = 102400 token budget) but exceeds a small 1000-token
        // override (0.8 * 1000 = 800 token budget). ~2000 tokens of text.
        let text = "word ".repeat(8_000); // 40000 chars => ~10000 tokens
        let prompt = Prompt::new(&text);
        let (_result, trunc) = apply_token_budget(prompt, "openai", "gpt-4o", Some(1000)).unwrap();
        assert!(trunc.is_some(), "override (1000) should force truncation");
    }

    #[test]
    fn apply_token_budget_override_none_falls_back() {
        // Same prompt that fits under the openai default — with None we should
        // fall back to context_window(provider_id) and NOT truncate.
        let text = "word ".repeat(8_000);
        let prompt = Prompt::new(&text);
        let (_result, trunc) = apply_token_budget(prompt, "openai", "gpt-4o", None).unwrap();
        assert!(trunc.is_none(), "fallback to openai default should not truncate");
    }

    #[test]
    fn apply_token_budget_override_larger_than_default_prevents_truncation() {
        // Text that WOULD truncate under the 128k default but fits under a huge override.
        let long_text = "word ".repeat(200_000);
        let prompt = Prompt::new(&long_text);
        let (_result, trunc) = apply_token_budget(prompt, "openai", "gpt-4o", Some(1_000_000)).unwrap();
        assert!(trunc.is_none(), "huge override should prevent truncation");
    }

    #[test]
    fn apply_token_budget_long_text_truncated() {
        let long_text = "word ".repeat(200_000);
        let prompt = Prompt::new(&long_text);
        let (result, trunc) = apply_token_budget(prompt, "openai", "gpt-4o", None).unwrap();
        assert!(result.text.len() < long_text.len(), "text should be truncated");
        let info = trunc.expect("should have truncation info");
        assert!(info.kept_tokens < info.original_tokens);
    }

    #[test]
    fn apply_token_budget_symmetric_truncation() {
        let long_text = "word ".repeat(200_000);
        let prompt = Prompt::new(&long_text);
        let (result, _) = apply_token_budget(prompt, "openai", "gpt-4o", None).unwrap();
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

        let provider = create_provider("openai", Some(&server.uri()));
        let prompt = Prompt::new("Say hello");
        let stream = provider.execute("gpt-4o", &prompt, Some("fake-key"), true).await.unwrap();

        let mut events = Vec::new();
        process_stream(stream, |e| events.push(e)).await;

        assert!(events.contains(&LlmEvent::Chunk { text: "Hello".into() }));
        assert!(events.contains(&LlmEvent::Chunk { text: " world".into() }));
        assert!(events.contains(&LlmEvent::Done));
    }

    #[tokio::test]
    async fn integration_openrouter_sends_extra_headers() {
        use wiremock::{MockServer, Mock, ResponseTemplate};
        use wiremock::matchers::{method, path, header};

        let server = MockServer::start().await;
        let sse_body = "\
data: {\"id\":\"1\",\"object\":\"chat.completion.chunk\",\"model\":\"gpt-4o\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"Hi\"},\"finish_reason\":null}]}\n\n\
data: {\"id\":\"1\",\"object\":\"chat.completion.chunk\",\"model\":\"gpt-4o\",\"choices\":[{\"index\":0,\"delta\":{},\"finish_reason\":\"stop\"}]}\n\n\
data: [DONE]\n\n";

        Mock::given(method("POST"))
            .and(path("/v1/chat/completions"))
            .and(header("HTTP-Referer", "https://lit.app"))
            .and(header("X-Title", "Lit"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_raw(sse_body, "text/event-stream"),
            )
            .expect(1)
            .mount(&server)
            .await;

        let provider = create_provider("openrouter", Some(&server.uri()));
        let prompt = Prompt::new("Say hi");
        let stream = provider.execute("gpt-4o", &prompt, Some("fake-key"), true).await.unwrap();

        let mut events = Vec::new();
        process_stream(stream, |e| events.push(e)).await;

        assert!(events.contains(&LlmEvent::Chunk { text: "Hi".into() }));
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

        let provider = create_provider("anthropic", Some(&server.uri()));
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
        let (result, trunc) = apply_token_budget(prompt, "openai", "gpt-4o", None).unwrap();
        assert!(result.text.len() < cjk_text.len());
        let info = trunc.expect("should have truncation info");
        assert!(info.kept_tokens < info.original_tokens);
    }

    #[test]
    fn apply_token_budget_cjk_preserves_center() {
        let cjk_text = "你好".repeat(300_000);
        let prompt = Prompt::new(&cjk_text);
        let (result, _) = apply_token_budget(prompt, "openai", "gpt-4o", None).unwrap();
        let char_count = cjk_text.chars().count();
        let center_char = char_count / 2;
        let check_start: String = cjk_text.chars().skip(center_char - 2).take(4).collect();
        assert!(result.text.contains(&check_start));
    }

    #[test]
    fn apply_token_budget_mixed_script_no_panic() {
        let mixed = "Hello你好World世界".repeat(50_000);
        let prompt = Prompt::new(&mixed);
        let (result, _) = apply_token_budget(prompt, "openai", "gpt-4o", None).unwrap();
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

        let provider = create_provider("openai", Some(&server.uri()));
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
    fn resolve_api_key_returns_stored_key() {
        let store = InMemoryStore::new();
        store.set("com.lit.app", "anthropic-api-key", "stored-key").unwrap();
        let result = resolve_api_key("anthropic", &store);
        assert_eq!(result.as_deref(), Some("stored-key"));
    }

    #[test]
    fn resolve_api_key_returns_none_when_absent() {
        let store = InMemoryStore::new();
        let result = resolve_api_key("anthropic", &store);
        assert_eq!(result, None);
    }

    #[test]
    fn resolve_api_key_release_build_scenario() {
        let store = InMemoryStore::new();
        store.set("com.lit.app", "anthropic-api-key", "sk-from-store").unwrap();
        let result = resolve_api_key("anthropic", &store);
        assert_eq!(result.as_deref(), Some("sk-from-store"));
    }

    #[test]
    fn build_prompt_with_attachments_passes_through() {
        let attachments = vec![
            Attachment {
                mime_type: Some("image/png".into()),
                source: AttachmentSource::Bytes(vec![0x89, 0x50, 0x4E, 0x47]),
            },
        ];
        let prompt = build_prompt_with_attachments(
            "Describe this image",
            Some("Be brief"),
            &[],
            &HashMap::new(),
            attachments.clone(),
        );
        assert_eq!(prompt.text, "Describe this image");
        assert_eq!(prompt.system.as_deref(), Some("Be brief"));
        assert_eq!(prompt.attachments.len(), 1);
        assert_eq!(prompt.attachments[0].mime_type, Some("image/png".into()));
        assert!(matches!(prompt.attachments[0].source, AttachmentSource::Bytes(_)));
    }

    #[test]
    fn attachments_survive_token_budget() {
        let attachments = vec![
            Attachment {
                mime_type: Some("image/png".into()),
                source: AttachmentSource::Bytes(vec![1, 2, 3]),
            },
        ];
        let prompt = build_prompt_with_attachments(
            "Short text",
            None,
            &[],
            &HashMap::new(),
            attachments,
        );
        let (result, trunc) = apply_token_budget(prompt, "openai", "gpt-4o", None).unwrap();
        assert!(trunc.is_none(), "short text should not be truncated");
        assert_eq!(result.attachments.len(), 1);
        assert_eq!(result.text, "Short text");
    }

    #[test]
    fn attachments_survive_token_budget_with_truncation() {
        let long_text = "word ".repeat(200_000);
        let attachments = vec![
            Attachment {
                mime_type: Some("image/jpeg".into()),
                source: AttachmentSource::Bytes(vec![0xFF, 0xD8, 0xFF]),
            },
        ];
        let prompt = build_prompt_with_attachments(
            &long_text,
            None,
            &[],
            &HashMap::new(),
            attachments,
        );
        let (result, trunc) = apply_token_budget(prompt, "openai", "gpt-4o", None).unwrap();
        assert!(trunc.is_some(), "long text should be truncated");
        assert!(result.text.len() < long_text.len());
        assert_eq!(result.attachments.len(), 1, "attachments must survive truncation");
        assert_eq!(result.attachments[0].mime_type, Some("image/jpeg".into()));
    }

    // --- Mock provider for check_attachment_capability tests ---

    struct MockVisionProvider {
        provider_id: &'static str,
        model_infos: Vec<ModelInfo>,
        default_attachment_types: &'static [&'static str],
    }

    #[async_trait]
    impl Provider for MockVisionProvider {
        fn id(&self) -> &str {
            self.provider_id
        }

        fn models(&self) -> Vec<ModelInfo> {
            self.model_infos.clone()
        }

        fn default_attachment_types(&self) -> &'static [&'static str] {
            self.default_attachment_types
        }

        async fn execute(
            &self,
            _model: &str,
            _prompt: &Prompt,
            _key: Option<&str>,
            _stream: bool,
        ) -> llm_core::error::Result<llm_core::stream::ResponseStream> {
            Ok(Box::pin(futures::stream::iter(vec![
                Ok(llm_core::stream::Chunk::Done),
            ])))
        }
    }

    // --- check_attachment_capability tests ---

    #[test]
    fn check_attachment_capability_no_attachments() {
        let provider = MockVisionProvider {
            provider_id: "anthropic",
            model_infos: vec![ModelInfo {
                id: "claude-sonnet-4-6".into(),
                can_stream: true,
                supports_tools: true,
                supports_schema: true,
                attachment_types: vec![
                    "image/png".into(),
                    "image/jpeg".into(),
                    "image/webp".into(),
                    "image/gif".into(),
                ],
            }],
            default_attachment_types: llm_core::types::DEFAULT_IMAGE_MIME_TYPES,
        };
        let result = check_attachment_capability(&provider, "claude-sonnet-4-6", &[]);
        assert!(result.is_ok());
    }

    #[test]
    fn check_attachment_capability_supported_model() {
        let provider = MockVisionProvider {
            provider_id: "anthropic",
            model_infos: vec![ModelInfo {
                id: "claude-sonnet-4-6".into(),
                can_stream: true,
                supports_tools: true,
                supports_schema: true,
                attachment_types: vec![
                    "image/png".into(),
                    "image/jpeg".into(),
                    "image/webp".into(),
                    "image/gif".into(),
                ],
            }],
            default_attachment_types: llm_core::types::DEFAULT_IMAGE_MIME_TYPES,
        };
        let attachments = vec![Attachment {
            mime_type: Some("image/png".into()),
            source: AttachmentSource::Bytes(vec![0x89, 0x50, 0x4E, 0x47]),
        }];
        let result = check_attachment_capability(&provider, "claude-sonnet-4-6", &attachments);
        assert!(result.is_ok());
    }

    #[test]
    fn check_attachment_capability_unsupported_type() {
        let provider = MockVisionProvider {
            provider_id: "anthropic",
            model_infos: vec![ModelInfo {
                id: "claude-sonnet-4-6".into(),
                can_stream: true,
                supports_tools: true,
                supports_schema: true,
                attachment_types: vec![
                    "image/png".into(),
                    "image/jpeg".into(),
                    "image/webp".into(),
                    "image/gif".into(),
                ],
            }],
            default_attachment_types: llm_core::types::DEFAULT_IMAGE_MIME_TYPES,
        };
        let attachments = vec![Attachment {
            mime_type: Some("audio/mp3".into()),
            source: AttachmentSource::Bytes(vec![0xFF, 0xFB]),
        }];
        let result = check_attachment_capability(&provider, "claude-sonnet-4-6", &attachments);
        let err = result.unwrap_err();
        assert_eq!(err.model, "claude-sonnet-4-6");
        assert_eq!(err.unsupported_types, vec!["audio/mp3".to_string()]);
    }

    #[test]
    fn check_attachment_capability_unknown_model_conservative() {
        let provider = MockVisionProvider {
            provider_id: "openai",
            model_infos: vec![ModelInfo {
                id: "gpt-4o".into(),
                can_stream: true,
                supports_tools: true,
                supports_schema: true,
                attachment_types: vec![
                    "image/png".into(),
                    "image/jpeg".into(),
                    "image/webp".into(),
                    "image/gif".into(),
                ],
            }],
            default_attachment_types: llm_core::types::DEFAULT_IMAGE_MIME_TYPES,
        };
        let attachments = vec![Attachment {
            mime_type: Some("image/png".into()),
            source: AttachmentSource::Bytes(vec![0x89, 0x50, 0x4E, 0x47]),
        }];
        // "llama-3.1-70b" is NOT in provider.models(), but provider.id() == "openai"
        let result = check_attachment_capability(&provider, "llama-3.1-70b", &attachments);
        assert!(result.is_ok());
    }

    #[test]
    fn check_attachment_capability_unknown_model_rejects_non_image() {
        let provider = MockVisionProvider {
            provider_id: "openai",
            model_infos: vec![ModelInfo {
                id: "gpt-4o".into(),
                can_stream: true,
                supports_tools: true,
                supports_schema: true,
                attachment_types: vec![
                    "image/png".into(),
                    "image/jpeg".into(),
                    "image/webp".into(),
                    "image/gif".into(),
                ],
            }],
            default_attachment_types: llm_core::types::DEFAULT_IMAGE_MIME_TYPES,
        };
        let attachments = vec![Attachment {
            mime_type: Some("audio/mp3".into()),
            source: AttachmentSource::Bytes(vec![0xFF, 0xFB]),
        }];
        let result = check_attachment_capability(&provider, "llama-3.1-70b", &attachments);
        let err = result.unwrap_err();
        assert_eq!(err.unsupported_types, vec!["audio/mp3".to_string()]);
    }

    #[test]
    fn check_attachment_capability_unknown_provider_rejects_all() {
        let provider = MockVisionProvider {
            provider_id: "custom-unknown",
            model_infos: vec![],
            default_attachment_types: &[],
        };
        let attachments = vec![Attachment {
            mime_type: Some("image/png".into()),
            source: AttachmentSource::Bytes(vec![0x89, 0x50, 0x4E, 0x47]),
        }];
        let result = check_attachment_capability(&provider, "some-model", &attachments);
        let err = result.unwrap_err();
        assert_eq!(err.unsupported_types, vec!["image/png".to_string()]);
    }

    #[test]
    fn check_attachment_capability_none_mime_bytes_rejected() {
        let provider = MockVisionProvider {
            provider_id: "anthropic",
            model_infos: vec![ModelInfo {
                id: "claude-sonnet-4-6".into(),
                can_stream: true,
                supports_tools: true,
                supports_schema: true,
                attachment_types: vec![
                    "image/png".into(),
                    "image/jpeg".into(),
                    "image/webp".into(),
                    "image/gif".into(),
                ],
            }],
            default_attachment_types: llm_core::types::DEFAULT_IMAGE_MIME_TYPES,
        };
        let attachments = vec![Attachment {
            mime_type: None,
            source: AttachmentSource::Bytes(vec![0x00, 0x01]),
        }];
        let result = check_attachment_capability(&provider, "claude-sonnet-4-6", &attachments);
        let err = result.unwrap_err();
        assert_eq!(
            err.unsupported_types,
            vec!["application/octet-stream".to_string()]
        );
    }

    #[test]
    fn check_attachment_capability_none_mime_url_passthrough() {
        let provider = MockVisionProvider {
            provider_id: "anthropic",
            model_infos: vec![ModelInfo {
                id: "claude-sonnet-4-6".into(),
                can_stream: true,
                supports_tools: true,
                supports_schema: true,
                attachment_types: vec![
                    "image/png".into(),
                    "image/jpeg".into(),
                    "image/webp".into(),
                    "image/gif".into(),
                ],
            }],
            default_attachment_types: llm_core::types::DEFAULT_IMAGE_MIME_TYPES,
        };
        // URL attachment with no declared MIME should pass through —
        // providers fetch and sniff URL images natively.
        let attachments = vec![Attachment {
            mime_type: None,
            source: AttachmentSource::Url("https://example.com/image.png".into()),
        }];
        let result = check_attachment_capability(&provider, "claude-sonnet-4-6", &attachments);
        assert!(result.is_ok(), "Url+None should pass through, got: {:?}", result);
    }

    #[test]
    fn check_attachment_capability_url_with_unsupported_declared_mime() {
        let provider = MockVisionProvider {
            provider_id: "anthropic",
            model_infos: vec![ModelInfo {
                id: "claude-sonnet-4-6".into(),
                can_stream: true,
                supports_tools: true,
                supports_schema: true,
                attachment_types: vec![
                    "image/png".into(),
                    "image/jpeg".into(),
                    "image/webp".into(),
                    "image/gif".into(),
                ],
            }],
            default_attachment_types: llm_core::types::DEFAULT_IMAGE_MIME_TYPES,
        };
        // URL attachment WITH an explicit unsupported MIME should still be rejected.
        let attachments = vec![Attachment {
            mime_type: Some("audio/mp3".into()),
            source: AttachmentSource::Url("https://example.com/audio.mp3".into()),
        }];
        let result = check_attachment_capability(&provider, "claude-sonnet-4-6", &attachments);
        let err = result.unwrap_err();
        assert_eq!(err.unsupported_types, vec!["audio/mp3".to_string()]);
    }

    #[test]
    fn check_attachment_capability_mixed_url_none_and_bytes_none() {
        let provider = MockVisionProvider {
            provider_id: "anthropic",
            model_infos: vec![ModelInfo {
                id: "claude-sonnet-4-6".into(),
                can_stream: true,
                supports_tools: true,
                supports_schema: true,
                attachment_types: vec![
                    "image/png".into(),
                    "image/jpeg".into(),
                    "image/webp".into(),
                    "image/gif".into(),
                ],
            }],
            default_attachment_types: llm_core::types::DEFAULT_IMAGE_MIME_TYPES,
        };
        // Mix: Url+None (pass-through) and Bytes+None (rejected as octet-stream).
        let attachments = vec![
            Attachment {
                mime_type: None,
                source: AttachmentSource::Url("https://example.com/image.png".into()),
            },
            Attachment {
                mime_type: None,
                source: AttachmentSource::Bytes(vec![0x00, 0x01]),
            },
        ];
        let result = check_attachment_capability(&provider, "claude-sonnet-4-6", &attachments);
        let err = result.unwrap_err();
        assert_eq!(
            err.unsupported_types,
            vec!["application/octet-stream".to_string()]
        );
    }

    #[test]
    fn check_attachment_capability_all_url_none_passthrough() {
        let provider = MockVisionProvider {
            provider_id: "anthropic",
            model_infos: vec![ModelInfo {
                id: "claude-sonnet-4-6".into(),
                can_stream: true,
                supports_tools: true,
                supports_schema: true,
                attachment_types: vec![
                    "image/png".into(),
                    "image/jpeg".into(),
                    "image/webp".into(),
                    "image/gif".into(),
                ],
            }],
            default_attachment_types: llm_core::types::DEFAULT_IMAGE_MIME_TYPES,
        };
        // All URL attachments with no MIME — all should pass through.
        let attachments = vec![
            Attachment {
                mime_type: None,
                source: AttachmentSource::Url("https://example.com/a.png".into()),
            },
            Attachment {
                mime_type: None,
                source: AttachmentSource::Url("https://example.com/b.jpg".into()),
            },
        ];
        let result = check_attachment_capability(&provider, "claude-sonnet-4-6", &attachments);
        assert!(result.is_ok(), "all Url+None should pass through, got: {:?}", result);
    }

    #[test]
    fn check_attachment_capability_mixed_supported_and_unsupported() {
        let provider = MockVisionProvider {
            provider_id: "anthropic",
            model_infos: vec![ModelInfo {
                id: "claude-sonnet-4-6".into(),
                can_stream: true,
                supports_tools: true,
                supports_schema: true,
                attachment_types: vec![
                    "image/png".into(),
                    "image/jpeg".into(),
                    "image/webp".into(),
                    "image/gif".into(),
                ],
            }],
            default_attachment_types: llm_core::types::DEFAULT_IMAGE_MIME_TYPES,
        };
        let attachments = vec![
            Attachment {
                mime_type: Some("image/png".into()),
                source: AttachmentSource::Bytes(vec![0x89, 0x50, 0x4E, 0x47]),
            },
            Attachment {
                mime_type: Some("audio/mp3".into()),
                source: AttachmentSource::Bytes(vec![0xFF, 0xFB]),
            },
        ];
        let result = check_attachment_capability(&provider, "claude-sonnet-4-6", &attachments);
        let err = result.unwrap_err();
        assert_eq!(err.unsupported_types, vec!["audio/mp3".to_string()]);
    }

    #[test]
    fn check_attachment_capability_provider_with_default_types_allows_images() {
        // A "gemini" provider that declares default image types should allow
        // images for unknown models -- proving the fix works for ANY provider
        // that declares defaults, not just hardcoded "anthropic"/"openai".
        let provider = MockVisionProvider {
            provider_id: "gemini",
            model_infos: vec![],
            default_attachment_types: llm_core::types::DEFAULT_IMAGE_MIME_TYPES,
        };
        let attachments = vec![Attachment {
            mime_type: Some("image/png".into()),
            source: AttachmentSource::Bytes(vec![0x89, 0x50, 0x4E, 0x47]),
        }];
        let result = check_attachment_capability(&provider, "gemini-2.0-flash", &attachments);
        assert!(result.is_ok(), "provider with default types should allow images, got: {:?}", result);
    }

    #[test]
    fn check_attachment_capability_provider_without_default_types_rejects() {
        // A provider that does NOT override default_attachment_types (returns &[])
        // should reject all attachments for unknown models.
        let provider = MockVisionProvider {
            provider_id: "custom-local",
            model_infos: vec![],
            default_attachment_types: &[],
        };
        let attachments = vec![Attachment {
            mime_type: Some("image/png".into()),
            source: AttachmentSource::Bytes(vec![0x89, 0x50, 0x4E, 0x47]),
        }];
        let result = check_attachment_capability(&provider, "some-model", &attachments);
        let err = result.unwrap_err();
        assert_eq!(err.unsupported_types, vec!["image/png".to_string()]);
    }

    #[test]
    fn estimate_prompt_size_includes_attachments() {
        let prompt_without = Prompt::new("Hello world");
        let size_without = estimate_prompt_size(&prompt_without);

        let prompt_with = Prompt::new("Hello world")
            .with_attachments(vec![Attachment {
                mime_type: Some("image/png".into()),
                source: AttachmentSource::Bytes(vec![0x89, 0x50, 0x4E, 0x47]),
            }]);
        let size_with = estimate_prompt_size(&prompt_with);

        assert_eq!(
            size_with - size_without,
            IMAGE_TOKEN_ESTIMATE,
            "one attachment should add exactly IMAGE_TOKEN_ESTIMATE tokens"
        );

        // Two attachments should add 2 * IMAGE_TOKEN_ESTIMATE
        let prompt_two = Prompt::new("Hello world")
            .with_attachments(vec![
                Attachment {
                    mime_type: Some("image/png".into()),
                    source: AttachmentSource::Bytes(vec![0x89, 0x50, 0x4E, 0x47]),
                },
                Attachment {
                    mime_type: Some("image/jpeg".into()),
                    source: AttachmentSource::Bytes(vec![0xFF, 0xD8, 0xFF]),
                },
            ]);
        let size_two = estimate_prompt_size(&prompt_two);
        assert_eq!(
            size_two - size_without,
            2 * IMAGE_TOKEN_ESTIMATE,
            "two attachments should add exactly 2 * IMAGE_TOKEN_ESTIMATE tokens"
        );
    }

    #[tokio::test]
    async fn integration_anthropic_with_image_attachment() {
        use wiremock::{MockServer, Mock, ResponseTemplate};
        use wiremock::matchers::{method, path};

        let server = MockServer::start().await;
        let sse_body = format!(
            "{}{}{}{}{}{}",
            "event: message_start\ndata: {\"type\":\"message_start\",\"message\":{\"id\":\"msg_1\",\"type\":\"message\",\"role\":\"assistant\",\"model\":\"claude-sonnet-4-6\",\"usage\":{\"input_tokens\":100,\"output_tokens\":0}}}\n\n",
            "event: content_block_start\ndata: {\"type\":\"content_block_start\",\"index\":0,\"content_block\":{\"type\":\"text\",\"text\":\"\"}}\n\n",
            "event: content_block_delta\ndata: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\"I see a cat\"}}\n\n",
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

        let provider = create_provider("anthropic", Some(&server.uri()));
        let prompt = Prompt::new("Describe this image")
            .with_attachments(vec![Attachment {
                mime_type: Some("image/png".into()),
                source: AttachmentSource::Bytes(vec![0x89, 0x50, 0x4E, 0x47]),
            }]);
        let stream = provider
            .execute("claude-sonnet-4-6", &prompt, Some("fake-key"), true)
            .await
            .unwrap();

        // Consume the stream
        let mut events = Vec::new();
        process_stream(stream, |e| events.push(e)).await;
        assert!(events.contains(&LlmEvent::Chunk { text: "I see a cat".into() }));
        assert!(events.contains(&LlmEvent::Done));

        // Inspect the outgoing request body
        let received = server.received_requests().await.unwrap();
        assert_eq!(received.len(), 1);
        let req_body: serde_json::Value =
            serde_json::from_slice(&received[0].body).unwrap();

        // messages[0].content should be an array (Blocks) with an image block
        let content = &req_body["messages"][0]["content"];
        assert!(content.is_array(), "content should be array of blocks, got: {content}");
        let blocks = content.as_array().unwrap();

        // First block: image (Anthropic convention: images before text)
        assert_eq!(blocks[0]["type"], "image");
        assert_eq!(blocks[0]["source"]["type"], "base64");
        assert_eq!(blocks[0]["source"]["media_type"], "image/png");
        assert!(!blocks[0]["source"]["data"].as_str().unwrap().is_empty());

        // Second block: text
        assert_eq!(blocks[1]["type"], "text");
        assert_eq!(blocks[1]["text"], "Describe this image");
    }

    #[tokio::test]
    async fn integration_openai_with_image_attachment() {
        use wiremock::{MockServer, Mock, ResponseTemplate};
        use wiremock::matchers::{method, path};

        let server = MockServer::start().await;
        let sse_body = "\
data: {\"id\":\"1\",\"object\":\"chat.completion.chunk\",\"model\":\"gpt-4o\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"I see a cat\"},\"finish_reason\":null}]}\n\n\
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

        let provider = create_provider("openai", Some(&server.uri()));
        let prompt = Prompt::new("Describe this image")
            .with_attachments(vec![Attachment {
                mime_type: Some("image/png".into()),
                source: AttachmentSource::Bytes(vec![0x89, 0x50, 0x4E, 0x47]),
            }]);
        let stream = provider
            .execute("gpt-4o", &prompt, Some("fake-key"), true)
            .await
            .unwrap();

        // Consume the stream
        let mut events = Vec::new();
        process_stream(stream, |e| events.push(e)).await;
        assert!(events.contains(&LlmEvent::Chunk { text: "I see a cat".into() }));
        assert!(events.contains(&LlmEvent::Done));

        // Inspect the outgoing request body
        let received = server.received_requests().await.unwrap();
        assert_eq!(received.len(), 1);
        let req_body: serde_json::Value =
            serde_json::from_slice(&received[0].body).unwrap();

        // For OpenAI, user message is messages[0] (no system message in this prompt).
        // content should be an array (Parts) with text + image_url
        let content = &req_body["messages"][0]["content"];
        assert!(content.is_array(), "content should be array of parts, got: {content}");
        let parts = content.as_array().unwrap();

        // First part: text (OpenAI convention: text before images)
        assert_eq!(parts[0]["type"], "text");
        assert_eq!(parts[0]["text"], "Describe this image");

        // Second part: image_url with data URI
        assert_eq!(parts[1]["type"], "image_url");
        let url = parts[1]["image_url"]["url"].as_str().unwrap();
        assert!(url.starts_with("data:image/png;base64,"), "expected data URI, got: {url}");
        assert!(url.len() > "data:image/png;base64,".len());
    }

    // --- F10 regression tests: attachment overhead must not starve text budget ---

    #[test]
    fn apply_token_budget_many_attachments_preserves_text() {
        // 10 images => 10 * 1000 = 10_000 tokens overhead.
        // context_window_override = 20_000 => budget = 16_000.
        // Without the fix, text_budget_tokens = 16000 - 10000 - system/etc = ~6000,
        // but with a borderline case (e.g. override=14000, budget=11200),
        // the old code would saturate to 0. Use a tight budget to trigger the floor.
        let attachments: Vec<Attachment> = (0..10)
            .map(|_| Attachment {
                mime_type: Some("image/png".into()),
                source: AttachmentSource::Bytes(vec![0x89, 0x50, 0x4E, 0x47]),
            })
            .collect();
        let prompt = build_prompt_with_attachments(
            "Describe these images in detail",
            None,
            &[],
            &HashMap::new(),
            attachments,
        );
        // Budget = 0.8 * 14000 = 11200 tokens. Overhead from 10 images = 10000.
        // Old code: text_budget = 11200 - 10000 - text_tokens ~= 1192 (still positive here).
        // Use an even tighter budget: 13000 => budget=10400, overhead=10000+8=10008 => raw=392
        // That's still > 0. Let's go extreme: 12600 => budget=10080, overhead=10008 => raw=72
        // With the fix, raw(72) gets bumped to min(100, 8) = 8 (the text is only ~8 tokens).
        // Actually, the text "Describe these images in detail" is ~8 tokens, always preserved.
        // The real regression is when raw goes to 0. Use override=12500 => budget=10000.
        // overhead = 10000 + 8 = 10008. raw = 10000 - 10008 = saturates to 0.
        // Old code: symmetric_trim(text, 0) => empty. New code: floor to min(100,8)=8 => text preserved.
        let result = apply_token_budget(prompt, "openai", "gpt-4o", Some(12_500));
        assert!(result.is_ok(), "should not error — attachments don't exceed budget alone");
        let (result_prompt, trunc) = result.unwrap();
        assert!(
            !result_prompt.text.is_empty(),
            "text must not be starved to empty when attachments are present"
        );
        assert!(trunc.is_some(), "truncation info should be present");
    }

    #[test]
    fn apply_token_budget_attachments_exceed_budget_returns_error() {
        // 20 images => 20 * 1000 = 20_000 tokens overhead.
        // context_window_override = 100 => budget = 80 tokens.
        // Attachments alone far exceed the budget => should return Err.
        let attachments: Vec<Attachment> = (0..20)
            .map(|_| Attachment {
                mime_type: Some("image/png".into()),
                source: AttachmentSource::Bytes(vec![0x89, 0x50, 0x4E, 0x47]),
            })
            .collect();
        let prompt = build_prompt_with_attachments(
            "What are these?",
            None,
            &[],
            &HashMap::new(),
            attachments,
        );
        let result = apply_token_budget(prompt, "openai", "gpt-4o", Some(100));
        assert!(result.is_err(), "should error when attachments alone exceed budget");
        let err = result.unwrap_err();
        assert!(err.contains("Attachments"), "error should mention attachments: {err}");
        assert!(err.contains("exceed"), "error should mention exceeding budget: {err}");
    }

    #[test]
    fn apply_token_budget_single_attachment_short_text_unchanged() {
        // 1 image + "Hi" text, default 128k context => no truncation at all.
        let attachments = vec![Attachment {
            mime_type: Some("image/png".into()),
            source: AttachmentSource::Bytes(vec![0x89, 0x50, 0x4E, 0x47]),
        }];
        let prompt = build_prompt_with_attachments(
            "Hi",
            None,
            &[],
            &HashMap::new(),
            attachments,
        );
        let (result, trunc) = apply_token_budget(prompt, "openai", "gpt-4o", None).unwrap();
        assert_eq!(result.text, "Hi", "short text with single attachment should be unchanged");
        assert!(trunc.is_none(), "no truncation expected");
    }

    #[test]
    fn apply_token_budget_attachments_with_empty_text() {
        // 1 image + empty text, small context window.
        // Empty text can't be starved further; min floor doesn't inflate beyond original.
        let attachments = vec![Attachment {
            mime_type: Some("image/png".into()),
            source: AttachmentSource::Bytes(vec![0x89, 0x50, 0x4E, 0x47]),
        }];
        let prompt = build_prompt_with_attachments(
            "",
            None,
            &[],
            &HashMap::new(),
            attachments,
        );
        // budget = 0.8 * 5000 = 4000 tokens. overhead = 1000 (image) + 0 (empty text) = 1000.
        // size = 1000 (image) + 0 (text) = 1000 <= 4000, so early return with no truncation.
        let (result, trunc) = apply_token_budget(prompt, "openai", "gpt-4o", Some(5000)).unwrap();
        assert_eq!(result.text, "", "empty text should stay empty");
        assert!(trunc.is_none());
    }
}
