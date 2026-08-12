// A user-defined provider. `id` is always "custom-" prefixed with a non-empty
// suffix (slugified name, or a deterministic hash for all-non-alphanumeric names;
// see `slugify`). `contextWindow` defaults to 128000; that default is applied by
// the form/store layer, not by this type.
export interface CustomProviderDef {
  id: string;
  name: string;
  baseUrl: string;
  needsApiKey: boolean;
  modelId: string;
  contextWindow: number;
}

/**
 * Map a legacy flat `llm.model` preference value to a provider id, used only by
 * the preference migration path (`migrateLlmProvider`) so old JSON keeps
 * loading. LLM is not a productized feature; this helper exists solely to keep
 * back-compat reads deterministic.
 */
export function providerIdForModel(model: string): string {
  if (model.startsWith("claude-")) return "anthropic";
  return "openai";
}
