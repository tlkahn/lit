import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, act } from "@testing-library/react";
import { LlmProviderSettings } from "./LlmProviderSettings";
import { mockInvoke } from "../test/tauri-mock";
import { usePreferencesStore } from "../stores/preferences";
import { PROVIDER_ORDER } from "../lib/providerRegistry";
import { useSecretStoreStore } from "../stores/secretStore";

let invokeCalls: { cmd: string; args: Record<string, unknown> }[];

const ensureUnlocked = vi.fn(() => Promise.resolve());

beforeEach(() => {
  invokeCalls = [];
  mockInvoke((cmd, args) => {
    invokeCalls.push({ cmd, args: args ?? {} });
    if (cmd === "has_api_key") return false;
    return undefined;
  });
  usePreferencesStore.setState({
    llmProvider: { providerId: "anthropic", model: "claude-sonnet-4-6", apiKeySet: false },
  });
  useSecretStoreStore.getState()._resetSettler();
  useSecretStoreStore.setState({ exists: false, unlocked: false, loading: false, migrationPromptOpen: false });
  ensureUnlocked.mockClear();
});

describe("LlmProviderSettings", () => {
  it("renders provider dropdown with all 6 providers", () => {
    const { container } = render(<LlmProviderSettings ensureUnlocked={ensureUnlocked} />);
    const select = container.querySelector("[data-testid='settings-llmProvider']") as HTMLSelectElement;
    expect(select).toBeTruthy();
    const opts = Array.from(select.querySelectorAll("option"));
    expect(opts).toHaveLength(PROVIDER_ORDER.length);
    expect(opts.map((o) => o.value)).toEqual(PROVIDER_ORDER);
  });

  it("changing provider updates providerId and resets model", async () => {
    const { container } = render(<LlmProviderSettings ensureUnlocked={ensureUnlocked} />);
    const select = container.querySelector("[data-testid='settings-llmProvider']")!;
    await act(async () => {
      fireEvent.change(select, { target: { value: "openai" } });
    });
    const provider = usePreferencesStore.getState().llmProvider;
    expect(provider.providerId).toBe("openai");
    expect(provider.model).toBe("gpt-4o");
    expect(provider.baseUrl).toBeUndefined();
  });

  it("model dropdown populates from selected provider's model list", () => {
    const { container } = render(<LlmProviderSettings ensureUnlocked={ensureUnlocked} />);
    const select = container.querySelector("[data-testid='settings-llmModel']") as HTMLSelectElement;
    const opts = Array.from(select.querySelectorAll("option"));
    const values = opts.map((o) => o.value);
    expect(values).toContain("claude-opus-4-6");
    expect(values).toContain("claude-sonnet-4-6");
    expect(values).toContain("claude-haiku-4-5");
    expect(values).toContain("__custom__");
  });

  it("selecting Custom shows free-text model input", () => {
    const { container } = render(<LlmProviderSettings ensureUnlocked={ensureUnlocked} />);
    const select = container.querySelector("[data-testid='settings-llmModel']")!;
    fireEvent.change(select, { target: { value: "__custom__" } });
    const input = container.querySelector("[data-testid='settings-llmModel']") as HTMLInputElement;
    expect(input.tagName).toBe("INPUT");
    expect(input.type).toBe("text");
  });

  it("API key field hidden for Ollama", async () => {
    usePreferencesStore.setState({
      llmProvider: { providerId: "ollama", model: "llama3.1", apiKeySet: false },
    });
    const { container } = render(<LlmProviderSettings ensureUnlocked={ensureUnlocked} />);
    expect(container.querySelector("[data-testid='settings-llmApiKey']")).toBeNull();
  });

  it("API key field shown for OpenAI", () => {
    usePreferencesStore.setState({
      llmProvider: { providerId: "openai", model: "gpt-4o", apiKeySet: false },
    });
    const { container } = render(<LlmProviderSettings ensureUnlocked={ensureUnlocked} />);
    expect(container.querySelector("[data-testid='settings-llmApiKey']")).toBeTruthy();
  });

  it("API key field shown for Anthropic", () => {
    const { container } = render(<LlmProviderSettings ensureUnlocked={ensureUnlocked} />);
    expect(container.querySelector("[data-testid='settings-llmApiKey']")).toBeTruthy();
  });

  it("base URL override collapsed by default", () => {
    const { container } = render(<LlmProviderSettings ensureUnlocked={ensureUnlocked} />);
    expect(container.querySelector("[data-testid='settings-llmBaseUrl']")).toBeNull();
    expect(container.querySelector("[data-testid='settings-baseUrl-toggle']")).toBeTruthy();
  });

  it("expanding base URL shows input with provider default as placeholder", () => {
    const { container } = render(<LlmProviderSettings ensureUnlocked={ensureUnlocked} />);
    const toggle = container.querySelector("[data-testid='settings-baseUrl-toggle']")!;
    fireEvent.click(toggle);
    const input = container.querySelector("[data-testid='settings-llmBaseUrl']") as HTMLInputElement;
    expect(input).toBeTruthy();
    expect(input.placeholder).toBe("https://api.anthropic.com");
  });

  it("saving API key calls set_api_key IPC with correct provider", async () => {
    ensureUnlocked.mockResolvedValue(undefined);
    const { container } = render(<LlmProviderSettings ensureUnlocked={ensureUnlocked} />);
    const input = container.querySelector("[data-testid='settings-llmApiKey']")!;
    const saveBtn = container.querySelector("[data-testid='settings-llmApiKey-save']")!;
    await act(async () => {
      fireEvent.change(input, { target: { value: "sk-test-key" } });
      fireEvent.click(saveBtn);
    });
    await vi.waitFor(() => {
      expect(invokeCalls).toContainEqual({ cmd: "set_api_key", args: { provider: "anthropic", key: "sk-test-key" } });
    });
    expect(usePreferencesStore.getState().llmProvider.apiKeySet).toBe(true);
  });

  it("test connection button present", () => {
    const { container } = render(<LlmProviderSettings ensureUnlocked={ensureUnlocked} />);
    expect(container.querySelector("[data-testid='test-connection-btn']")).toBeTruthy();
  });

  it("provider change triggers has_api_key check for new provider", async () => {
    const { container } = render(<LlmProviderSettings ensureUnlocked={ensureUnlocked} />);
    invokeCalls.length = 0;
    const select = container.querySelector("[data-testid='settings-llmProvider']")!;
    await act(async () => {
      fireEvent.change(select, { target: { value: "groq" } });
    });
    await vi.waitFor(() => {
      expect(invokeCalls).toContainEqual({ cmd: "has_api_key", args: { provider: "groq" } });
    });
  });
});
