#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WireFormat {
    OpenAi,
    Anthropic,
}

#[derive(Debug)]
pub struct ProviderEntry {
    pub id: &'static str,
    pub default_base_url: &'static str,
    pub wire_format: WireFormat,
    pub needs_api_key: bool,
    pub default_context_window: usize,
}

static REGISTRY: &[ProviderEntry] = &[
    ProviderEntry {
        id: "openai",
        default_base_url: "https://api.openai.com",
        wire_format: WireFormat::OpenAi,
        needs_api_key: true,
        default_context_window: 128_000,
    },
    ProviderEntry {
        id: "anthropic",
        default_base_url: "https://api.anthropic.com",
        wire_format: WireFormat::Anthropic,
        needs_api_key: true,
        default_context_window: 200_000,
    },
    ProviderEntry {
        id: "openrouter",
        default_base_url: "https://openrouter.ai/api/v1",
        wire_format: WireFormat::OpenAi,
        needs_api_key: true,
        default_context_window: 128_000,
    },
    ProviderEntry {
        id: "ollama",
        default_base_url: "http://localhost:11434/v1",
        wire_format: WireFormat::OpenAi,
        needs_api_key: false,
        default_context_window: 128_000,
    },
    ProviderEntry {
        id: "groq",
        default_base_url: "https://api.groq.com/openai/v1",
        wire_format: WireFormat::OpenAi,
        needs_api_key: true,
        default_context_window: 128_000,
    },
    ProviderEntry {
        id: "deepseek",
        default_base_url: "https://api.deepseek.com",
        wire_format: WireFormat::OpenAi,
        needs_api_key: true,
        default_context_window: 128_000,
    },
];

pub fn lookup(id: &str) -> Option<&'static ProviderEntry> {
    REGISTRY.iter().find(|e| e.id == id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_lookup_openai() {
        let e = lookup("openai").expect("openai must be registered");
        assert_eq!(e.default_base_url, "https://api.openai.com");
        assert_eq!(e.wire_format, WireFormat::OpenAi);
        assert!(e.needs_api_key);
        assert_eq!(e.default_context_window, 128_000);
    }

    #[test]
    fn test_lookup_anthropic() {
        let e = lookup("anthropic").expect("anthropic must be registered");
        assert_eq!(e.default_base_url, "https://api.anthropic.com");
        assert_eq!(e.wire_format, WireFormat::Anthropic);
        assert!(e.needs_api_key);
        assert_eq!(e.default_context_window, 200_000);
    }

    #[test]
    fn test_lookup_unknown() {
        assert!(lookup("nonexistent").is_none());
    }

    #[test]
    fn test_lookup_openrouter() {
        let e = lookup("openrouter").expect("openrouter must be registered");
        assert_eq!(e.default_base_url, "https://openrouter.ai/api/v1");
        assert_eq!(e.wire_format, WireFormat::OpenAi);
        assert!(e.needs_api_key);
    }

    #[test]
    fn test_lookup_ollama() {
        let e = lookup("ollama").expect("ollama must be registered");
        assert_eq!(e.default_base_url, "http://localhost:11434/v1");
        assert_eq!(e.wire_format, WireFormat::OpenAi);
        assert!(!e.needs_api_key);
    }

    #[test]
    fn test_lookup_groq() {
        let e = lookup("groq").expect("groq must be registered");
        assert_eq!(e.default_base_url, "https://api.groq.com/openai/v1");
        assert_eq!(e.wire_format, WireFormat::OpenAi);
        assert!(e.needs_api_key);
    }

    #[test]
    fn test_lookup_deepseek() {
        let e = lookup("deepseek").expect("deepseek must be registered");
        assert_eq!(e.default_base_url, "https://api.deepseek.com");
        assert_eq!(e.wire_format, WireFormat::OpenAi);
        assert!(e.needs_api_key);
    }
}
