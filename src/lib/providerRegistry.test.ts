import { describe, it, expect } from "vitest";
import { providerNeedsApiKey, providerIdForModel, PROVIDER_REGISTRY } from "./providerRegistry";

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
      "anthropic", "deepseek", "groq", "ollama", "openai", "openrouter",
    ]);
  });
});
