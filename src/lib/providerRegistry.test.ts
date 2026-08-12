import { describe, it, expect } from "vitest";
import { providerIdForModel } from "./providerRegistry";

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
