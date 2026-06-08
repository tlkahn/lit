import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, act } from "@testing-library/react";
import { LlmProviderSettings } from "./LlmProviderSettings";
import { mockInvoke } from "../test/tauri-mock";
import { usePreferencesStore } from "../stores/preferences";
import * as prefs from "../stores/preferences";
import { PROVIDER_ORDER, getMergedProviderOrder } from "../lib/providerRegistry";
import type { CustomProviderDef } from "../lib/providerRegistry";
import { useSecretStoreStore } from "../stores/secretStore";

function customDef(over: Partial<CustomProviderDef> = {}): CustomProviderDef {
  return {
    id: "custom-my-llm",
    name: "My LLM",
    baseUrl: "https://example.com/v1",
    needsApiKey: true,
    modelId: "my-model",
    contextWindow: 64000,
    ...over,
  };
}

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
    llmCustomProviders: [],
  });
  useSecretStoreStore.getState()._resetSettler();
  useSecretStoreStore.setState({ exists: false, unlocked: false, loading: false, migrationPromptOpen: false });
  ensureUnlocked.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
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

  it("dropdown options follow merged provider order including custom providers", () => {
    const def = customDef();
    usePreferencesStore.setState({ llmCustomProviders: [def] });
    const { container } = render(<LlmProviderSettings ensureUnlocked={ensureUnlocked} />);
    const select = container.querySelector("[data-testid='settings-llmProvider']") as HTMLSelectElement;
    const opts = Array.from(select.querySelectorAll("option"));
    expect(opts.map((o) => o.value)).toEqual(getMergedProviderOrder([def]));
    expect(opts.map((o) => o.value)).toContain(def.id);
    const customOpt = opts.find((o) => o.value === def.id)!;
    expect(customOpt.textContent).toBe(def.name);
  });

  it("Edit/Delete buttons shown for custom provider, absent for built-in", () => {
    const def = customDef();
    usePreferencesStore.setState({
      llmCustomProviders: [def],
      llmProvider: { providerId: def.id, model: def.modelId, apiKeySet: false },
    });
    const { container, rerender } = render(<LlmProviderSettings ensureUnlocked={ensureUnlocked} />);
    expect(container.querySelector("[data-testid='custom-provider-edit']")).toBeTruthy();
    expect(container.querySelector("[data-testid='custom-provider-delete']")).toBeTruthy();

    usePreferencesStore.setState({
      llmProvider: { providerId: "openai", model: "gpt-4o", apiKeySet: false },
    });
    rerender(<LlmProviderSettings ensureUnlocked={ensureUnlocked} />);
    expect(container.querySelector("[data-testid='custom-provider-edit']")).toBeNull();
    expect(container.querySelector("[data-testid='custom-provider-delete']")).toBeNull();
  });

  it("Add Custom Provider button opens the form; successful add selects new provider", async () => {
    const setSpy = vi.spyOn(prefs, "setLlmProvider");
    const addSpy = vi.spyOn(prefs, "addCustomProvider").mockImplementation(() => {});
    const { container } = render(<LlmProviderSettings ensureUnlocked={ensureUnlocked} />);
    expect(container.querySelector("[data-testid='custom-provider-form']")).toBeNull();
    fireEvent.click(container.querySelector("[data-testid='custom-provider-add']")!);
    expect(container.querySelector("[data-testid='custom-provider-form']")).toBeTruthy();

    fireEvent.change(container.querySelector("[data-testid='custom-provider-name']")!, { target: { value: "Cool" } });
    fireEvent.change(container.querySelector("[data-testid='custom-provider-baseUrl']")!, { target: { value: "https://c/v1" } });
    fireEvent.change(container.querySelector("[data-testid='custom-provider-modelId']")!, { target: { value: "c-1" } });
    await act(async () => {
      fireEvent.click(container.querySelector("[data-testid='custom-provider-save']")!);
    });
    expect(addSpy).toHaveBeenCalledTimes(1);
    expect(container.querySelector("[data-testid='custom-provider-form']")).toBeNull();
    await vi.waitFor(() => {
      const calls = setSpy.mock.calls.map((c) => c[0]);
      expect(calls.some((c) => c.providerId === "custom-cool")).toBe(true);
    });
  });

  it("Delete flow: confirm true removes provider and switches to first built-in", async () => {
    const def = customDef();
    usePreferencesStore.setState({
      llmCustomProviders: [def],
      llmProvider: { providerId: def.id, model: def.modelId, apiKeySet: false },
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const { container } = render(<LlmProviderSettings ensureUnlocked={ensureUnlocked} />);
    await act(async () => {
      fireEvent.click(container.querySelector("[data-testid='custom-provider-delete']")!);
    });
    expect(usePreferencesStore.getState().llmCustomProviders.find((p) => p.id === def.id)).toBeUndefined();
    await vi.waitFor(() => {
      expect(usePreferencesStore.getState().llmProvider.providerId).toBe(PROVIDER_ORDER[0]);
    });
  });

  it("Delete flow: confirm false leaves provider intact", () => {
    const def = customDef();
    usePreferencesStore.setState({
      llmCustomProviders: [def],
      llmProvider: { providerId: def.id, model: def.modelId, apiKeySet: false },
    });
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const removeSpy = vi.spyOn(prefs, "removeCustomProvider");
    const { container } = render(<LlmProviderSettings ensureUnlocked={ensureUnlocked} />);
    fireEvent.click(container.querySelector("[data-testid='custom-provider-delete']")!);
    expect(removeSpy).not.toHaveBeenCalled();
    expect(usePreferencesStore.getState().llmProvider.providerId).toBe(def.id);
    expect(usePreferencesStore.getState().llmCustomProviders).toHaveLength(1);
  });

  it("Edit opens form pre-populated from the def", () => {
    const def = customDef();
    usePreferencesStore.setState({
      llmCustomProviders: [def],
      llmProvider: { providerId: def.id, model: def.modelId, apiKeySet: false },
    });
    const { container } = render(<LlmProviderSettings ensureUnlocked={ensureUnlocked} />);
    fireEvent.click(container.querySelector("[data-testid='custom-provider-edit']")!);
    const name = container.querySelector("[data-testid='custom-provider-name']") as HTMLInputElement;
    const baseUrl = container.querySelector("[data-testid='custom-provider-baseUrl']") as HTMLInputElement;
    const modelId = container.querySelector("[data-testid='custom-provider-modelId']") as HTMLInputElement;
    const ctx = container.querySelector("[data-testid='custom-provider-contextWindow']") as HTMLInputElement;
    expect(name.value).toBe(def.name);
    expect(baseUrl.value).toBe(def.baseUrl);
    expect(modelId.value).toBe(def.modelId);
    expect(ctx.value).toBe(String(def.contextWindow));
  });
});
