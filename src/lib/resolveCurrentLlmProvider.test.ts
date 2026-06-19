import { describe, it, expect, beforeEach } from "vitest";
import { usePreferencesStore } from "../stores/preferences";
import { resolveCurrentLlmProvider } from "./resolveCurrentLlmProvider";

describe("resolveCurrentLlmProvider", () => {
  beforeEach(() => {
    usePreferencesStore.setState({
      llmProvider: {
        providerId: "anthropic",
        model: "claude-sonnet-4-6",
        apiKeySet: true,
      },
      llmCustomProviders: [],
    });
  });

  it("returns provider and model from preferences for a built-in provider", () => {
    const result = resolveCurrentLlmProvider();
    expect(result.provider).toBe("anthropic");
    expect(result.model).toBe("claude-sonnet-4-6");
  });

  it("returns undefined baseUrl and contextWindow for a built-in provider", () => {
    const result = resolveCurrentLlmProvider();
    expect(result.baseUrl).toBeUndefined();
    expect(result.contextWindow).toBeUndefined();
  });

  it("returns baseUrl and contextWindow from custom provider definition", () => {
    usePreferencesStore.setState({
      llmProvider: {
        providerId: "custom-vllm",
        model: "my-model",
        apiKeySet: false,
      },
      llmCustomProviders: [
        {
          id: "custom-vllm",
          name: "vLLM",
          baseUrl: "http://localhost:8000/v1",
          needsApiKey: false,
          modelId: "my-model",
          contextWindow: 4096,
        },
      ],
    });
    const result = resolveCurrentLlmProvider();
    expect(result.provider).toBe("custom-vllm");
    expect(result.baseUrl).toBe("http://localhost:8000/v1");
    expect(result.contextWindow).toBe(4096);
  });

  it("prefers llmProvider.baseUrl over customDef.baseUrl (manual override wins)", () => {
    usePreferencesStore.setState({
      llmProvider: {
        providerId: "custom-vllm",
        model: "my-model",
        baseUrl: "http://manual-override:9000/v1",
        apiKeySet: false,
      },
      llmCustomProviders: [
        {
          id: "custom-vllm",
          name: "vLLM",
          baseUrl: "http://localhost:8000/v1",
          needsApiKey: false,
          modelId: "my-model",
          contextWindow: 4096,
        },
      ],
    });
    const result = resolveCurrentLlmProvider();
    expect(result.baseUrl).toBe("http://manual-override:9000/v1");
  });

  it("returns undefined baseUrl/contextWindow when custom provider def is missing", () => {
    usePreferencesStore.setState({
      llmProvider: {
        providerId: "custom-missing",
        model: "some-model",
        apiKeySet: false,
      },
      llmCustomProviders: [],
    });
    const result = resolveCurrentLlmProvider();
    expect(result.baseUrl).toBeUndefined();
    expect(result.contextWindow).toBeUndefined();
  });

  it("returns exactly four keys: provider, model, baseUrl, contextWindow", () => {
    const result = resolveCurrentLlmProvider();
    expect(Object.keys(result).sort()).toEqual(
      ["baseUrl", "contextWindow", "model", "provider"],
    );
  });
});
