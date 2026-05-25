use std::collections::HashMap;

use indexmap::IndexMap;
use serde::Deserialize;
use serde_yaml::Value;

use crate::llm;
use crate::workspace::merge::{self, MergeInput, MergePlan};
use crate::workspace::split::{self, SplitPlan};
use super::credential::{self, CredentialStore};

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
    s
}

pub(crate) async fn suggest_title_inner(
    model: &str,
    api_key: &str,
    base_url: Option<&str>,
    source_titles: &[String],
    merged_body: &str,
    temperature: f64,
) -> Result<String, String> {
    let provider = llm::create_provider(model, base_url);

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
) -> Result<String, String> {
    let prefs = crate::preferences::read_preferences(&app_handle);

    let model = prefs
        .extra
        .get("llm.model")
        .and_then(|v| v.as_str())
        .unwrap_or("claude-sonnet-4-6")
        .to_string();

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

    let provider_name = if model.starts_with("claude-") {
        "anthropic"
    } else {
        "openai"
    };

    let api_key = credential::get_api_key_inner(store.as_ref(), provider_name)?;

    suggest_title_inner(
        &model,
        &api_key,
        base_url.as_deref(),
        &source_titles,
        &merged_body,
        temperature,
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

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

        let provider_name = if model.starts_with("claude-") {
            "anthropic"
        } else {
            "openai"
        };
        assert_eq!(provider_name, "anthropic");
    }
}
