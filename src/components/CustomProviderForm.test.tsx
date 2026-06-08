import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { CustomProviderForm } from "./CustomProviderForm";
import { mockInvoke } from "../test/tauri-mock";
import * as prefs from "../stores/preferences";
import { usePreferencesStore } from "../stores/preferences";
import type { CustomProviderDef } from "../lib/providerRegistry";
import { slugify } from "../lib/providerRegistry";

function existingDef(over: Partial<CustomProviderDef> = {}): CustomProviderDef {
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

beforeEach(() => {
  mockInvoke(() => undefined);
  usePreferencesStore.setState({ llmCustomProviders: [] });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function setInput(container: HTMLElement, testId: string, value: string) {
  const el = container.querySelector(`[data-testid='${testId}']`) as HTMLInputElement;
  fireEvent.change(el, { target: { value } });
}

describe("CustomProviderForm", () => {
  it("renders all fields with stable testids and defaults", () => {
    const { container } = render(
      <CustomProviderForm onCancel={vi.fn()} onSaved={vi.fn()} />,
    );
    const name = container.querySelector("[data-testid='custom-provider-name']") as HTMLInputElement;
    const baseUrl = container.querySelector("[data-testid='custom-provider-baseUrl']") as HTMLInputElement;
    const needsApiKey = container.querySelector("[data-testid='custom-provider-needsApiKey']") as HTMLInputElement;
    const modelId = container.querySelector("[data-testid='custom-provider-modelId']") as HTMLInputElement;
    const ctx = container.querySelector("[data-testid='custom-provider-contextWindow']") as HTMLInputElement;
    expect(name).toBeTruthy();
    expect(baseUrl).toBeTruthy();
    expect(needsApiKey.type).toBe("checkbox");
    expect(needsApiKey.checked).toBe(true);
    expect(modelId).toBeTruthy();
    expect(ctx.type).toBe("number");
    expect(ctx.value).toBe("128000");
    expect(container.querySelector("[data-testid='custom-provider-save']")).toBeTruthy();
    expect(container.querySelector("[data-testid='custom-provider-cancel']")).toBeTruthy();
  });

  it("blocks save when name, baseUrl, or modelId is empty", () => {
    const onSaved = vi.fn();
    const addSpy = vi.spyOn(prefs, "addCustomProvider");
    const { container } = render(
      <CustomProviderForm onCancel={vi.fn()} onSaved={onSaved} />,
    );
    setInput(container, "custom-provider-name", "Foo");
    const save = container.querySelector("[data-testid='custom-provider-save']") as HTMLButtonElement;
    fireEvent.click(save);
    expect(onSaved).not.toHaveBeenCalled();
    expect(addSpy).not.toHaveBeenCalled();
  });

  it("blocks save when slug collides with an existing custom provider id", () => {
    usePreferencesStore.setState({ llmCustomProviders: [existingDef()] });
    const onSaved = vi.fn();
    const addSpy = vi.spyOn(prefs, "addCustomProvider");
    const { container } = render(
      <CustomProviderForm onCancel={vi.fn()} onSaved={onSaved} />,
    );
    setInput(container, "custom-provider-name", "My LLM"); // slug -> custom-my-llm collides
    setInput(container, "custom-provider-baseUrl", "https://x.com/v1");
    setInput(container, "custom-provider-modelId", "m1");
    const save = container.querySelector("[data-testid='custom-provider-save']") as HTMLButtonElement;
    fireEvent.click(save);
    expect(onSaved).not.toHaveBeenCalled();
    expect(addSpy).not.toHaveBeenCalled();
    expect(container.querySelector("[data-testid='custom-provider-error']")).toBeTruthy();
  });

  it("edit mode allows same id (no self-collision) and calls updateCustomProvider", () => {
    const def = existingDef();
    usePreferencesStore.setState({ llmCustomProviders: [def] });
    const onSaved = vi.fn();
    const updateSpy = vi.spyOn(prefs, "updateCustomProvider").mockImplementation(() => {});
    const { container } = render(
      <CustomProviderForm initial={def} onCancel={vi.fn()} onSaved={onSaved} />,
    );
    setInput(container, "custom-provider-modelId", "new-model");
    setInput(container, "custom-provider-contextWindow", "32000");
    const save = container.querySelector("[data-testid='custom-provider-save']") as HTMLButtonElement;
    fireEvent.click(save);
    expect(updateSpy).toHaveBeenCalledTimes(1);
    const [id, patch] = updateSpy.mock.calls[0]!;
    expect(id).toBe(def.id);
    expect(patch).toMatchObject({ modelId: "new-model", contextWindow: 32000 });
    expect(typeof (patch as CustomProviderDef).contextWindow).toBe("number");
    expect(onSaved).toHaveBeenCalledWith(def.id);
  });

  it("successful add calls addCustomProvider with derived def and fires onSaved", () => {
    const onSaved = vi.fn();
    const addSpy = vi.spyOn(prefs, "addCustomProvider").mockImplementation(() => {});
    const { container } = render(
      <CustomProviderForm onCancel={vi.fn()} onSaved={onSaved} />,
    );
    setInput(container, "custom-provider-name", "Cool Provider");
    setInput(container, "custom-provider-baseUrl", "https://cool.example/v1");
    setInput(container, "custom-provider-modelId", "cool-1");
    const needsApiKey = container.querySelector("[data-testid='custom-provider-needsApiKey']") as HTMLInputElement;
    fireEvent.click(needsApiKey); // uncheck -> false
    setInput(container, "custom-provider-contextWindow", ""); // blank -> default 128000
    const save = container.querySelector("[data-testid='custom-provider-save']") as HTMLButtonElement;
    fireEvent.click(save);
    expect(addSpy).toHaveBeenCalledTimes(1);
    const def = addSpy.mock.calls[0]![0] as CustomProviderDef;
    expect(def.id).toBe(slugify("Cool Provider"));
    expect(def.name).toBe("Cool Provider");
    expect(def.baseUrl).toBe("https://cool.example/v1");
    expect(def.needsApiKey).toBe(false);
    expect(def.modelId).toBe("cool-1");
    expect(def.contextWindow).toBe(128000);
    expect(typeof def.contextWindow).toBe("number");
    expect(onSaved).toHaveBeenCalledWith(def.id);
  });

  it.each(["-5", "0"])(
    "falls back to default 128000 for non-positive contextWindow input %j",
    (value) => {
      const onSaved = vi.fn();
      const addSpy = vi.spyOn(prefs, "addCustomProvider").mockImplementation(() => {});
      const { container } = render(
        <CustomProviderForm onCancel={vi.fn()} onSaved={onSaved} />,
      );
      setInput(container, "custom-provider-name", "Cool Provider");
      setInput(container, "custom-provider-baseUrl", "https://cool.example/v1");
      setInput(container, "custom-provider-modelId", "cool-1");
      setInput(container, "custom-provider-contextWindow", value);
      const save = container.querySelector("[data-testid='custom-provider-save']") as HTMLButtonElement;
      fireEvent.click(save);
      expect(addSpy).toHaveBeenCalledTimes(1);
      const def = addSpy.mock.calls[0]![0] as CustomProviderDef;
      expect(def.contextWindow).toBe(128000);
      expect(typeof def.contextWindow).toBe("number");
    },
  );

  it("Cancel calls onCancel and does not add/update", () => {
    const onCancel = vi.fn();
    const addSpy = vi.spyOn(prefs, "addCustomProvider");
    const updateSpy = vi.spyOn(prefs, "updateCustomProvider");
    const { container } = render(
      <CustomProviderForm onCancel={onCancel} onSaved={vi.fn()} />,
    );
    const cancel = container.querySelector("[data-testid='custom-provider-cancel']") as HTMLButtonElement;
    fireEvent.click(cancel);
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(addSpy).not.toHaveBeenCalled();
    expect(updateSpy).not.toHaveBeenCalled();
  });
});
