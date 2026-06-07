export interface ModelInfo {
  id: string;
  label: string;
}

export interface ProviderMeta {
  label: string;
  description: string;
  needsApiKey: boolean;
  defaultBaseUrl: string;
  models: ModelInfo[];
}

export const PROVIDER_REGISTRY: Record<string, ProviderMeta> = {
  openai: {
    label: "OpenAI",
    description: "GPT models via the OpenAI API",
    needsApiKey: true,
    defaultBaseUrl: "https://api.openai.com",
    models: [
      { id: "gpt-4o", label: "GPT-4o" },
      { id: "gpt-4o-mini", label: "GPT-4o Mini" },
    ],
  },
  anthropic: {
    label: "Anthropic",
    description: "Claude models via the Anthropic API",
    needsApiKey: true,
    defaultBaseUrl: "https://api.anthropic.com",
    models: [
      { id: "claude-opus-4-6", label: "Claude Opus 4.6" },
      { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
      { id: "claude-haiku-4-5", label: "Claude Haiku 4.5" },
    ],
  },
  openrouter: {
    label: "OpenRouter",
    description: "Access multiple providers through OpenRouter",
    needsApiKey: true,
    defaultBaseUrl: "https://openrouter.ai/api/v1",
    models: [
      { id: "anthropic/claude-sonnet-4", label: "Anthropic: Claude Sonnet 4" },
      { id: "openai/gpt-4o", label: "OpenAI: GPT-4o" },
      { id: "meta-llama/llama-4-maverick", label: "Meta: Llama 4 Maverick" },
    ],
  },
  ollama: {
    label: "Ollama",
    description: "Local models via Ollama",
    needsApiKey: false,
    defaultBaseUrl: "http://localhost:11434/v1",
    models: [
      { id: "llama3.1", label: "Llama 3.1" },
      { id: "mistral", label: "Mistral" },
      { id: "gemma2", label: "Gemma 2" },
      { id: "qwen2.5", label: "Qwen 2.5" },
    ],
  },
  groq: {
    label: "Groq",
    description: "Fast inference via the Groq API",
    needsApiKey: true,
    defaultBaseUrl: "https://api.groq.com/openai/v1",
    models: [
      { id: "llama-3.3-70b-versatile", label: "Llama 3.3 70B" },
      { id: "gemma2-9b-it", label: "Gemma 2 9B" },
      { id: "mixtral-8x7b-32768", label: "Mixtral 8x7B" },
    ],
  },
  deepseek: {
    label: "DeepSeek",
    description: "DeepSeek models",
    needsApiKey: true,
    defaultBaseUrl: "https://api.deepseek.com",
    models: [
      { id: "deepseek-chat", label: "DeepSeek Chat" },
      { id: "deepseek-reasoner", label: "DeepSeek Reasoner" },
    ],
  },
};

export const PROVIDER_ORDER = ["openai", "anthropic", "openrouter", "ollama", "groq", "deepseek"];

export function defaultModelForProvider(providerId: string): string {
  return PROVIDER_REGISTRY[providerId]?.models[0]?.id ?? "";
}

export function providerNeedsApiKey(providerId: string): boolean {
  return PROVIDER_REGISTRY[providerId]?.needsApiKey ?? true;
}

export function providerIdForModel(model: string): string {
  if (model.startsWith("claude-")) return "anthropic";
  return "openai";
}
