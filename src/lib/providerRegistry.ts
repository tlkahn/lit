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

// A user-defined provider. `id` is always "custom-" prefixed (see `slugify`).
// `contextWindow` defaults to 128000; that default is applied by the form/store
// layer, not by this type.
export interface CustomProviderDef {
  id: string;
  name: string;
  baseUrl: string;
  needsApiKey: boolean;
  modelId: string;
  contextWindow: number;
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
  gemini: {
    label: "Google Gemini",
    description: "Gemini models via Google's OpenAI-compatible endpoint",
    needsApiKey: true,
    defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta/openai/",
    models: [
      { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
      { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
      { id: "gemini-2.0-flash", label: "Gemini 2.0 Flash" },
    ],
  },
  mistral: {
    label: "Mistral",
    description: "Mistral models via the Mistral API",
    needsApiKey: true,
    defaultBaseUrl: "https://api.mistral.ai/v1",
    models: [
      { id: "mistral-large-latest", label: "Mistral Large" },
      { id: "mistral-small-latest", label: "Mistral Small" },
    ],
  },
  together: {
    label: "Together AI",
    description: "Open models via Together AI",
    needsApiKey: true,
    defaultBaseUrl: "https://api.together.xyz/v1",
    models: [
      { id: "meta-llama/Llama-3.3-70B-Instruct-Turbo", label: "Llama 3.3 70B" },
      { id: "deepseek-ai/DeepSeek-V3", label: "DeepSeek V3" },
      { id: "Qwen/Qwen2.5-72B-Instruct-Turbo", label: "Qwen 2.5 72B" },
    ],
  },
};

export const PROVIDER_ORDER = ["openai", "anthropic", "openrouter", "ollama", "groq", "deepseek", "gemini", "mistral", "together"];

export function defaultModelForProvider(providerId: string): string {
  return PROVIDER_REGISTRY[providerId]?.models[0]?.id ?? "";
}

export function providerNeedsApiKey(
  providerId: string,
  customProviders: CustomProviderDef[] = [],
): boolean {
  return getMergedRegistry(customProviders)[providerId]?.needsApiKey ?? true;
}

export function providerIdForModel(model: string): string {
  if (model.startsWith("claude-")) return "anthropic";
  return "openai";
}

// Derive a stable provider id from a human-readable name. Lowercases, collapses
// runs of non-alphanumeric characters into single hyphens, trims leading/trailing
// hyphens, and prefixes "custom-". An all-non-alphanumeric name yields "custom-".
export function slugify(name: string): string {
  return "custom-" + name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

// Convert a custom provider definition into the same ProviderMeta shape used by
// built-ins. Synthesizes a description, wraps the single modelId into a models
// array, and drops contextWindow (which lives only on the def).
export function customProviderToMeta(def: CustomProviderDef): ProviderMeta {
  return {
    label: def.name,
    description: `Custom provider (${def.baseUrl})`,
    needsApiKey: def.needsApiKey,
    defaultBaseUrl: def.baseUrl,
    models: [{ id: def.modelId, label: def.modelId }],
  };
}

// Merge custom providers into the built-in registry without mutating it.
export function getMergedRegistry(
  customProviders: CustomProviderDef[],
): Record<string, ProviderMeta> {
  const merged = { ...PROVIDER_REGISTRY };
  for (const def of customProviders) {
    merged[def.id] = customProviderToMeta(def);
  }
  return merged;
}

// Built-in provider order followed by custom provider ids, without mutating
// PROVIDER_ORDER.
export function getMergedProviderOrder(customProviders: CustomProviderDef[]): string[] {
  return [...PROVIDER_ORDER, ...customProviders.map((p) => p.id)];
}
