import { usePreferencesStore } from "../stores/preferences";

export interface ResolvedLlmProvider {
  provider: string;
  model: string;
  baseUrl: string | undefined;
  contextWindow: number | undefined;
}

/**
 * Read the current LLM provider configuration from the preferences store,
 * resolving custom-provider definitions (baseUrl, contextWindow) when the
 * active provider is a custom one.
 *
 * The manual `llmProvider.baseUrl` override (if set) takes precedence over
 * the custom provider definition's `baseUrl`.
 */
export function resolveCurrentLlmProvider(): ResolvedLlmProvider {
  const prefs = usePreferencesStore.getState();
  const customDef = prefs.llmProvider.providerId.startsWith("custom-")
    ? prefs.llmCustomProviders.find((p) => p.id === prefs.llmProvider.providerId)
    : undefined;
  return {
    provider: prefs.llmProvider.providerId,
    model: prefs.llmProvider.model,
    baseUrl: prefs.llmProvider.baseUrl ?? customDef?.baseUrl,
    contextWindow: customDef?.contextWindow,
  };
}
