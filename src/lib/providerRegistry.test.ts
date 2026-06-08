import { describe, it, expect } from "vitest";
import {
  providerNeedsApiKey,
  providerIdForModel,
  PROVIDER_REGISTRY,
  PROVIDER_ORDER,
  slugify,
  customProviderToMeta,
  getMergedRegistry,
  getMergedProviderOrder,
} from "./providerRegistry";
import type { CustomProviderDef } from "./providerRegistry";

const makeDef = (overrides: Partial<CustomProviderDef> = {}): CustomProviderDef => ({
  id: "custom-my-server",
  name: "My Server",
  baseUrl: "http://localhost:8000/v1",
  needsApiKey: false,
  modelId: "my-model",
  contextWindow: 128000,
  ...overrides,
});

describe("providerNeedsApiKey", () => {
  it("returns true for openai", () => {
    expect(providerNeedsApiKey("openai")).toBe(true);
  });

  it("returns true for anthropic", () => {
    expect(providerNeedsApiKey("anthropic")).toBe(true);
  });

  it("returns true for openrouter", () => {
    expect(providerNeedsApiKey("openrouter")).toBe(true);
  });

  it("returns false for ollama", () => {
    expect(providerNeedsApiKey("ollama")).toBe(false);
  });

  it("returns true for groq", () => {
    expect(providerNeedsApiKey("groq")).toBe(true);
  });

  it("returns true for deepseek", () => {
    expect(providerNeedsApiKey("deepseek")).toBe(true);
  });

  it("returns true for gemini", () => {
    expect(providerNeedsApiKey("gemini")).toBe(true);
  });

  it("returns true for mistral", () => {
    expect(providerNeedsApiKey("mistral")).toBe(true);
  });

  it("returns true for together", () => {
    expect(providerNeedsApiKey("together")).toBe(true);
  });

  it("returns true for unknown providers", () => {
    expect(providerNeedsApiKey("unknown-provider")).toBe(true);
  });
});

describe("providerIdForModel", () => {
  it("maps claude-sonnet-4-6 to anthropic", () => {
    expect(providerIdForModel("claude-sonnet-4-6")).toBe("anthropic");
  });

  it("maps claude-opus-4-8 to anthropic", () => {
    expect(providerIdForModel("claude-opus-4-8")).toBe("anthropic");
  });

  it("maps claude-haiku-4-5-20251001 to anthropic", () => {
    expect(providerIdForModel("claude-haiku-4-5-20251001")).toBe("anthropic");
  });

  it("maps gpt-4o to openai", () => {
    expect(providerIdForModel("gpt-4o")).toBe("openai");
  });

  it("maps llama3 to openai", () => {
    expect(providerIdForModel("llama3")).toBe("openai");
  });

  it("maps empty string to openai", () => {
    expect(providerIdForModel("")).toBe("openai");
  });
});

describe("PROVIDER_REGISTRY", () => {
  it("has all expected providers", () => {
    expect(Object.keys(PROVIDER_REGISTRY).sort()).toEqual([
      "anthropic", "deepseek", "gemini", "groq", "mistral", "ollama", "openai", "openrouter", "together",
    ]);
  });
});

describe("slugify", () => {
  it("lowercases, replaces spaces with hyphens, prefixes custom-", () => {
    expect(slugify("My vLLM Server")).toBe("custom-my-vllm-server");
  });

  it("collapses non-alphanumeric runs to a single hyphen with no trailing hyphen", () => {
    expect(slugify("GPT@Home!!")).toBe("custom-gpt-home");
  });

  it("dedupes multiple whitespace to one hyphen", () => {
    expect(slugify("a   b")).toBe("custom-a-b");
  });

  it("trims leading and trailing whitespace", () => {
    expect(slugify("  Leading and trailing  ")).toBe("custom-leading-and-trailing");
  });

  it("yields exactly 'custom-' for all-non-alphanumeric (e.g. CJK) names", () => {
    expect(slugify("已经")).toBe("custom-");
  });

  it("does not produce double hyphens for hyphenated names", () => {
    expect(slugify("My-vLLM")).toBe("custom-my-vllm");
  });
});

describe("customProviderToMeta", () => {
  it("returns an object whose keys exactly match ProviderMeta", () => {
    const meta = customProviderToMeta(makeDef());
    expect(Object.keys(meta).sort()).toEqual([
      "defaultBaseUrl", "description", "label", "models", "needsApiKey",
    ]);
  });

  it("maps name, baseUrl, needsApiKey, and modelId into the meta", () => {
    const def = makeDef({
      name: "My Server",
      baseUrl: "http://localhost:8000/v1",
      needsApiKey: true,
      modelId: "my-model",
    });
    const meta = customProviderToMeta(def);
    expect(meta.label).toBe("My Server");
    expect(meta.defaultBaseUrl).toBe("http://localhost:8000/v1");
    expect(meta.needsApiKey).toBe(true);
    expect(meta.models).toEqual([{ id: "my-model", label: "my-model" }]);
  });

  it("synthesizes a non-empty description and omits contextWindow", () => {
    const meta = customProviderToMeta(makeDef());
    expect(meta.description.length).toBeGreaterThan(0);
    expect("contextWindow" in meta).toBe(false);
  });
});

describe("getMergedRegistry", () => {
  it("deep-equals PROVIDER_REGISTRY for an empty custom list", () => {
    expect(getMergedRegistry([])).toEqual(PROVIDER_REGISTRY);
  });

  it("contains the custom def keyed by id plus all built-ins", () => {
    const def = makeDef({ id: "custom-my-server" });
    const merged = getMergedRegistry([def]);
    expect(merged["custom-my-server"]).toEqual(customProviderToMeta(def));
    for (const id of Object.keys(PROVIDER_REGISTRY)) {
      expect(merged[id]).toEqual(PROVIDER_REGISTRY[id]);
    }
  });

  it("does not mutate PROVIDER_REGISTRY", () => {
    getMergedRegistry([makeDef()]);
    expect(Object.keys(PROVIDER_REGISTRY)).toHaveLength(9);
  });
});

describe("getMergedProviderOrder", () => {
  it("deep-equals PROVIDER_ORDER for an empty custom list", () => {
    expect(getMergedProviderOrder([])).toEqual(PROVIDER_ORDER);
  });

  it("appends custom ids after built-ins preserving order", () => {
    const defA = makeDef({ id: "custom-a" });
    const defB = makeDef({ id: "custom-b" });
    expect(getMergedProviderOrder([defA, defB])).toEqual([
      ...PROVIDER_ORDER, "custom-a", "custom-b",
    ]);
  });

  it("does not mutate PROVIDER_ORDER", () => {
    getMergedProviderOrder([makeDef()]);
    expect(PROVIDER_ORDER).toHaveLength(9);
  });
});
