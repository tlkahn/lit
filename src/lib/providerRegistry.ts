export interface ProviderMeta {
  needsApiKey: boolean;
  defaultBaseUrl: string;
}

export const PROVIDER_REGISTRY: Record<string, ProviderMeta> = {
  openai:     { needsApiKey: true,  defaultBaseUrl: "https://api.openai.com" },
  anthropic:  { needsApiKey: true,  defaultBaseUrl: "https://api.anthropic.com" },
  openrouter: { needsApiKey: true,  defaultBaseUrl: "https://openrouter.ai/api/v1" },
  ollama:     { needsApiKey: false, defaultBaseUrl: "http://localhost:11434/v1" },
  groq:       { needsApiKey: true,  defaultBaseUrl: "https://api.groq.com/openai/v1" },
  deepseek:   { needsApiKey: true,  defaultBaseUrl: "https://api.deepseek.com" },
};

export function providerNeedsApiKey(providerId: string): boolean {
  return PROVIDER_REGISTRY[providerId]?.needsApiKey ?? true;
}

export function providerIdForModel(model: string): string {
  if (model.startsWith("claude-")) return "anthropic";
  return "openai";
}
