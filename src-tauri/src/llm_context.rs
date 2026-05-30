use crate::llm::{ChatMessage, TruncationInfo, estimate_tokens, context_window, symmetric_trim};

#[derive(Debug, Clone, serde::Serialize)]
pub struct Neighbor {
    pub title: String,
    pub excerpt: String,
    pub relation: String,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct BuiltContext {
    pub system: String,
    pub messages: Vec<ChatMessage>,
    pub truncation: Option<TruncationInfo>,
}

pub fn build_context_layers(
    system_prompt: &str,
    messages: &[ChatMessage],
    document_content: &str,
    document_title: &str,
    neighbors: &[Neighbor],
    model: &str,
) -> BuiltContext {
    let budget = (context_window(model) as f64 * 0.8) as usize;
    let system_tokens = estimate_tokens(system_prompt);
    let remainder = budget.saturating_sub(system_tokens);

    let doc_cap = (remainder as f64 * 0.4) as usize;
    let neighbor_cap = (remainder as f64 * 0.2) as usize;

    // Trim document content first so we know actual usage
    let doc_budget_chars = doc_cap * 4;
    let trimmed_doc = symmetric_trim(document_content, doc_budget_chars);
    let doc_actual = estimate_tokens(&trimmed_doc);
    let truncation = if trimmed_doc.len() < document_content.len() {
        Some(TruncationInfo {
            original_tokens: estimate_tokens(document_content),
            kept_tokens: doc_actual,
        })
    } else {
        None
    };

    // Trim neighbors: drop from end (least relevant) until fits
    let mut kept_neighbors: Vec<&Neighbor> = Vec::new();
    let mut neighbor_actual = 0;
    for n in neighbors {
        let entry = format!("### {} ({})\n{}", n.title, n.relation, n.excerpt);
        let entry_tokens = estimate_tokens(&entry);
        if neighbor_actual + entry_tokens > neighbor_cap {
            break;
        }
        neighbor_actual += entry_tokens;
        kept_neighbors.push(n);
    }

    // History gets the entire remainder after doc and neighbors
    let history_cap = remainder.saturating_sub(doc_actual).saturating_sub(neighbor_actual);

    // Trim history: drop oldest pairs from front, keep most recent
    let mut kept_messages: Vec<ChatMessage> = messages.to_vec();
    let mut running_total: usize = kept_messages.iter().map(|m| estimate_tokens(&m.content)).sum();
    while running_total > history_cap && kept_messages.len() >= 2 {
        running_total -= estimate_tokens(&kept_messages[0].content);
        running_total -= estimate_tokens(&kept_messages[1].content);
        kept_messages.drain(..2);
    }
    if kept_messages.len() == 1 && running_total > history_cap {
        let budget_chars = history_cap * 4;
        kept_messages[0].content = symmetric_trim(&kept_messages[0].content, budget_chars);
    }

    // Assemble system string
    let mut system = system_prompt.to_string();

    if !trimmed_doc.is_empty() {
        if !system.is_empty() {
            system.push_str("\n\n");
        }
        system.push_str(&format!("## Current document: {}\n{}", document_title, trimmed_doc));
    }

    if !kept_neighbors.is_empty() {
        if !system.is_empty() {
            system.push_str("\n\n");
        }
        system.push_str("## Linked notes");
        for n in &kept_neighbors {
            system.push_str(&format!("\n### {} ({})\n{}", n.title, n.relation, n.excerpt));
        }
    }

    BuiltContext {
        system,
        messages: kept_messages,
        truncation,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn built_context_serializes() {
        let ctx = BuiltContext { system: "sys".into(), messages: vec![], truncation: None };
        let json = serde_json::to_value(&ctx).unwrap();
        assert_eq!(json["system"], "sys");
    }

    // Cycle 1: Empty passthrough
    #[test]
    fn empty_system_no_doc_no_neighbors() {
        let result = build_context_layers("", &[], "", "", &[], "gpt-4o");
        assert_eq!(result.system, "");
        assert!(result.messages.is_empty());
        assert!(result.truncation.is_none());
    }

    // Cycle 2: Document section rendering
    #[test]
    fn document_section_present_when_nonempty() {
        let result = build_context_layers("", &[], "Hello world", "My Note", &[], "gpt-4o");
        assert!(result.system.contains("## Current document: My Note\nHello world"));
    }

    #[test]
    fn document_section_absent_when_empty() {
        let result = build_context_layers("You are helpful.", &[], "", "", &[], "gpt-4o");
        assert!(!result.system.contains("## Current document"));
    }

    // Cycle 3: Neighbor section rendering
    #[test]
    fn neighbor_section_renders_with_relation() {
        let neighbors = vec![Neighbor {
            title: "Foo".into(),
            excerpt: "bar".into(),
            relation: "forward link".into(),
        }];
        let result = build_context_layers("", &[], "", "", &neighbors, "gpt-4o");
        assert!(result.system.contains("## Linked notes\n### Foo (forward link)\nbar"));
    }

    #[test]
    fn neighbor_section_absent_when_empty() {
        let result = build_context_layers("You are helpful.", &[], "", "", &[], "gpt-4o");
        assert!(!result.system.contains("## Linked notes"));
    }

    // Cycle 4: Under budget passthrough
    #[test]
    fn under_budget_messages_unchanged() {
        let messages = vec![
            ChatMessage { role: "user".into(), content: "Hi".into() },
            ChatMessage { role: "assistant".into(), content: "Hello!".into() },
        ];
        let neighbors = vec![Neighbor {
            title: "Note".into(),
            excerpt: "excerpt".into(),
            relation: "link".into(),
        }];
        let result = build_context_layers(
            "Be helpful.",
            &messages,
            "Some doc content",
            "Title",
            &neighbors,
            "gpt-4o",
        );
        assert_eq!(result.messages, messages);
        assert!(result.truncation.is_none());
    }

    // Cycle 5: System prompt never trimmed
    #[test]
    fn system_prompt_never_trimmed() {
        let huge_prompt = "x".repeat(200_000);
        let result = build_context_layers(&huge_prompt, &[], "", "", &[], "gpt-4o");
        assert!(result.system.starts_with(&huge_prompt[..100]));
        assert!(result.system.ends_with(&huge_prompt[huge_prompt.len() - 100..]));
    }

    // Cycle 6: Neighbors dropped when over budget
    #[test]
    fn neighbors_dropped_when_over_budget() {
        let messages = vec![
            ChatMessage { role: "user".into(), content: "Hi".into() },
            ChatMessage { role: "assistant".into(), content: "Hello!".into() },
        ];
        let huge_excerpt = "word ".repeat(100_000);
        let neighbors = vec![
            Neighbor { title: "N1".into(), excerpt: huge_excerpt.clone(), relation: "link".into() },
            Neighbor { title: "N2".into(), excerpt: huge_excerpt, relation: "link".into() },
        ];
        let result = build_context_layers(
            "Be helpful.",
            &messages,
            "doc",
            "Title",
            &neighbors,
            "gpt-4o",
        );
        // History should be intact
        assert_eq!(result.messages.len(), 2);
        // At least some neighbors should be dropped (may keep 0 or 1 depending on budget)
        let neighbor_count = result.system.matches("###").count();
        assert!(neighbor_count < 2, "expected some neighbors dropped, got {neighbor_count}");
    }

    // Cycle 7: Oldest history dropped
    #[test]
    fn oldest_history_dropped_when_over_budget() {
        let mut messages = Vec::new();
        for i in 0..100 {
            messages.push(ChatMessage {
                role: "user".into(),
                content: format!("Message {}: {}", i, "word ".repeat(1000)),
            });
            messages.push(ChatMessage {
                role: "assistant".into(),
                content: format!("Reply {}: {}", i, "word ".repeat(1000)),
            });
        }
        let result = build_context_layers(
            "Be helpful.",
            &messages,
            "",
            "",
            &[],
            "gpt-4o",
        );
        assert!(result.messages.len() < messages.len(), "some messages should be trimmed");
        assert!(result.messages.len() >= 2, "should keep at least one pair");
        // Most recent pair should be preserved
        let last_original = &messages[messages.len() - 1];
        let last_result = &result.messages[result.messages.len() - 1];
        assert_eq!(last_result.content, last_original.content);
    }

    // Cycle 8: Document symmetric-trimmed
    #[test]
    fn document_symmetric_trimmed_last() {
        let huge_doc = "word ".repeat(200_000);
        let result = build_context_layers(
            "Be helpful.",
            &[],
            &huge_doc,
            "Big Doc",
            &[],
            "gpt-4o",
        );
        assert!(result.truncation.is_some());
        let info = result.truncation.unwrap();
        assert!(info.kept_tokens < info.original_tokens);
        // Center of original should be preserved
        let center = huge_doc.len() / 2;
        let center_region = &huge_doc[center - 10..center + 10];
        assert!(result.system.contains(center_region));
    }

    // Cycle 9: CJK safety
    #[test]
    fn cjk_no_panic_on_byte_boundaries() {
        let cjk_doc = "你好世界".repeat(50_000);
        let result = build_context_layers(
            "Be helpful.",
            &[],
            &cjk_doc,
            "CJK Doc",
            &[],
            "gpt-4o",
        );
        assert!(result.truncation.is_some());
    }

    // Cycle 10: Single oversized message trimmed
    #[test]
    fn single_oversized_message_trimmed_to_budget() {
        let huge_content = "x".repeat(800_000);
        let messages = vec![ChatMessage {
            role: "user".into(),
            content: huge_content,
        }];
        let result = build_context_layers("Be helpful.", &messages, "", "", &[], "gpt-4o");
        let kept_tokens: usize = result.messages.iter().map(|m| estimate_tokens(&m.content)).sum();
        let budget = (context_window("gpt-4o") as f64 * 0.8) as usize;
        let system_tokens = estimate_tokens("Be helpful.");
        // With empty doc and no neighbors, history gets the full remainder
        let history_cap = budget - system_tokens;
        assert!(
            kept_tokens <= history_cap,
            "kept_tokens ({kept_tokens}) should be <= history_cap ({history_cap})"
        );
    }

    #[test]
    fn single_oversized_message_preserves_center() {
        let huge_content = "x".repeat(800_000);
        let center_idx = huge_content.len() / 2;
        let center_region = huge_content[center_idx - 5..center_idx + 5].to_string();
        let messages = vec![ChatMessage {
            role: "user".into(),
            content: huge_content,
        }];
        let result = build_context_layers("Be helpful.", &messages, "", "", &[], "gpt-4o");
        assert_eq!(result.messages.len(), 1);
        assert!(
            result.messages[0].content.contains(&center_region),
            "center of original should be preserved after symmetric trim"
        );
    }

    // Waterfall: empty doc/neighbors → history gets full remainder
    #[test]
    fn empty_doc_redistributes_budget_to_history() {
        let mut messages = Vec::new();
        for i in 0..100 {
            messages.push(ChatMessage {
                role: "user".into(),
                content: format!("Message {}: {}", i, "word ".repeat(1000)),
            });
            messages.push(ChatMessage {
                role: "assistant".into(),
                content: format!("Reply {}: {}", i, "word ".repeat(1000)),
            });
        }
        // With document content
        let result_with_doc = build_context_layers(
            "Be helpful.",
            &messages,
            &"word ".repeat(50_000),
            "Big Doc",
            &[],
            "gpt-4o",
        );
        // Without document content (global chat)
        let result_no_doc = build_context_layers(
            "Be helpful.",
            &messages,
            "",
            "",
            &[],
            "gpt-4o",
        );
        assert!(
            result_no_doc.messages.len() > result_with_doc.messages.len(),
            "global chat should keep more history ({} vs {})",
            result_no_doc.messages.len(),
            result_with_doc.messages.len(),
        );
    }

    // Additional: combined sections format
    #[test]
    fn combined_sections_format() {
        let neighbors = vec![Neighbor {
            title: "Related".into(),
            excerpt: "some info".into(),
            relation: "backlink".into(),
        }];
        let result = build_context_layers(
            "System prompt.",
            &[],
            "Doc content",
            "My Doc",
            &neighbors,
            "gpt-4o",
        );
        assert!(result.system.starts_with("System prompt."));
        assert!(result.system.contains("## Current document: My Doc\nDoc content"));
        assert!(result.system.contains("## Linked notes\n### Related (backlink)\nsome info"));
    }
}
