use crate::config::DocumentConfig;
use crate::types::Definition;
use super::{Counters, ParserRegistry};

/// Shared scanning context updated as we iterate through lines.
/// Parsers check these flags to skip irrelevant states
/// (e.g., equation parser skips when in_code_block is true).
#[derive(Debug, Default)]
pub struct ScanContext {
    pub in_code_block: bool,
    pub code_fence: String,
    pub in_math_block: bool,
    pub in_html_div: Option<String>,
    /// Set when the previous line closed a display math block ($$).
    pub prev_line_closed_math: bool,
    /// Set when the previous line closed a fenced code block.
    pub prev_line_closed_code: bool,
}

impl ScanContext {
    pub fn new() -> Self {
        Self::default()
    }
}

/// Compute UTF-16 code unit offset for each line start.
fn compute_utf16_offsets(content: &str) -> Vec<usize> {
    let mut offsets = Vec::new();
    let mut utf16_offset: usize = 0;

    for line in content.split('\n') {
        offsets.push(utf16_offset);
        // Count UTF-16 code units for this line + newline
        for ch in line.chars() {
            utf16_offset += ch.len_utf16();
        }
        utf16_offset += 1; // newline
    }

    offsets
}

/// Detect if a line opens a fenced code block.
/// Returns the fence string (e.g., "```" or "````") if it's an opening fence.
fn detect_fence_open(line: &str) -> Option<String> {
    let trimmed = line.trim();
    if trimmed.starts_with("```") {
        // Extract the fence part (consecutive backticks)
        let fence_len = trimmed.chars().take_while(|&c| c == '`').count();
        let fence = &trimmed[..fence_len];
        // Opening fence may have an info string after it
        Some(fence.to_string())
    } else if trimmed.starts_with("~~~") {
        let fence_len = trimmed.chars().take_while(|&c| c == '~').count();
        let fence = &trimmed[..fence_len];
        Some(fence.to_string())
    } else {
        None
    }
}

/// Detect if a line closes a fenced code block.
fn detect_fence_close(line: &str, expected_fence: &str) -> bool {
    let trimmed = line.trim();
    // Closing fence must be at least as long as opening and contain only fence chars
    if expected_fence.starts_with('`') {
        let fence_len = trimmed.chars().take_while(|&c| c == '`').count();
        fence_len >= expected_fence.len()
            && trimmed.chars().all(|c| c == '`' || c.is_whitespace())
    } else if expected_fence.starts_with('~') {
        let fence_len = trimmed.chars().take_while(|&c| c == '~').count();
        fence_len >= expected_fence.len()
            && trimmed.chars().all(|c| c == '~' || c.is_whitespace())
    } else {
        false
    }
}

/// Single-pass scanner. Iterates all lines once, updates context, dispatches to parsers.
pub fn scan_document(
    content: &str,
    config: &DocumentConfig,
    registry: &ParserRegistry,
) -> Vec<Definition> {
    let lines: Vec<&str> = content.split('\n').collect();
    let utf16_offsets = compute_utf16_offsets(content);
    let mut ctx = ScanContext::new();
    let mut counters = Counters::default();
    let mut definitions = Vec::new();

    for (line_idx, line) in lines.iter().enumerate() {
        let char_offset = utf16_offsets.get(line_idx).copied().unwrap_or(0);

        // --- Update context: code blocks ---
        if ctx.in_code_block {
            if detect_fence_close(line, &ctx.code_fence) {
                ctx.in_code_block = false;
                ctx.code_fence.clear();
                ctx.prev_line_closed_code = true;
                // Don't dispatch parsers for the closing fence line itself
                continue;
            }
            // Inside code block — skip all parsers
            continue;
        }

        // Check for code fence opening (only when not already in code/math block)
        if !ctx.in_math_block {
            if let Some(fence) = detect_fence_open(line) {
                // But only if the line after the fence chars is an info string (or empty),
                // not a closing fence on the same line
                let rest = line.trim()[fence.len()..].trim();
                if !rest.is_empty() && rest.chars().all(|c| c == '`' || c == '~') {
                    // This might be a closing fence of zero content — edge case
                    // For simplicity, treat as opening fence
                }
                ctx.in_code_block = true;
                ctx.code_fence = fence;
                ctx.prev_line_closed_math = false;
                ctx.prev_line_closed_code = false;
                continue;
            }
        }

        // --- Update context: math blocks ---
        if !ctx.in_code_block {
            let trimmed = line.trim();
            if trimmed == "$$" {
                if ctx.in_math_block {
                    ctx.in_math_block = false;
                    ctx.prev_line_closed_math = true;
                    ctx.prev_line_closed_code = false;
                    continue;
                } else {
                    ctx.in_math_block = true;
                    ctx.prev_line_closed_math = false;
                    ctx.prev_line_closed_code = false;
                    continue;
                }
            }
        }

        // Inside math block — skip all parsers except equation (for sub-content)
        if ctx.in_math_block {
            ctx.prev_line_closed_math = false;
            ctx.prev_line_closed_code = false;
            continue;
        }

        // --- Update context: HTML div for sub-figures ---
        {
            let trimmed = line.trim();
            if trimmed.starts_with("<div id=\"fig:") {
                if let Some(start) = trimmed.find("fig:") {
                    if let Some(end) = trimmed[start..].find('"') {
                        let fig_id = &trimmed[start + 4..start + end];
                        ctx.in_html_div = Some(fig_id.to_string());
                    }
                }
            } else if trimmed == "</div>" && ctx.in_html_div.is_some() {
                ctx.in_html_div = None;
            }
        }

        // --- Dispatch to all parsers ---
        for parser in registry.parsers() {
            let defs = parser.on_line(line, line_idx, char_offset, &ctx, &mut counters, config);
            definitions.extend(defs);
        }

        // Reset prev_line flags (they're only valid for one line after the close)
        ctx.prev_line_closed_math = false;
        ctx.prev_line_closed_code = false;
    }

    // Flush any pending state at end of document
    for parser in registry.parsers() {
        let defs = parser.on_end(&mut counters);
        definitions.extend(defs);
    }

    definitions
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn utf16_offsets_ascii() {
        let content = "hello\nworld";
        let offsets = compute_utf16_offsets(content);
        assert_eq!(offsets, vec![0, 6]); // "hello\n" = 6 UTF-16 units
    }

    #[test]
    fn utf16_offsets_multibyte() {
        let content = "图\nok";
        let offsets = compute_utf16_offsets(content);
        // "图" = 1 UTF-16 unit, + newline = 2
        assert_eq!(offsets, vec![0, 2]);
    }

    #[test]
    fn detect_backtick_fence() {
        assert_eq!(detect_fence_open("```python"), Some("```".to_string()));
        assert_eq!(detect_fence_open("````"), Some("````".to_string()));
        assert_eq!(detect_fence_open("  ```"), Some("```".to_string()));
        assert_eq!(detect_fence_open("not a fence"), None);
    }

    #[test]
    fn detect_tilde_fence() {
        assert_eq!(detect_fence_open("~~~"), Some("~~~".to_string()));
        assert_eq!(detect_fence_open("~~~~rust"), Some("~~~~".to_string()));
    }

    #[test]
    fn fence_close_matching() {
        assert!(detect_fence_close("```", "```"));
        assert!(detect_fence_close("````", "```")); // longer is OK
        assert!(!detect_fence_close("``", "```")); // shorter is not OK
        assert!(detect_fence_close("~~~", "~~~"));
        assert!(!detect_fence_close("```", "~~~")); // different char
    }
}
