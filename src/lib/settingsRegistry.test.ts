import { describe, expect, it } from "vitest";
import {
  SETTINGS_REGISTRY,
  CATEGORIES,
  groupByCategory,
  filterSettings,
} from "./settingsRegistry";

describe("SETTINGS_REGISTRY", () => {
  it("has 35 entries", () => {
    expect(SETTINGS_REGISTRY).toHaveLength(35);
  });

  it("every entry has required fields defined", () => {
    for (const entry of SETTINGS_REGISTRY) {
      expect(entry.category).toBeDefined();
      expect(entry.label).toBeDefined();
      expect(entry.storeField).toBeDefined();
      expect(entry.jsonKey).toBeDefined();
      expect(entry.controlType).toBeDefined();
      expect(entry.testId).toBeDefined();
    }
  });

  it("colorTheme entry has controlType 'dropdown'", () => {
    const entry = SETTINGS_REGISTRY.find((e) => e.storeField === "colorTheme");
    expect(entry).toBeDefined();
    expect(entry!.controlType).toBe("dropdown");
  });

  it("llmModel entry has controlType 'dropdown'", () => {
    const entry = SETTINGS_REGISTRY.find((e) => e.storeField === "llmModel");
    expect(entry).toBeDefined();
    expect(entry!.controlType).toBe("dropdown");
  });

  it("llmTemperature entry has controlType 'slider'", () => {
    const entry = SETTINGS_REGISTRY.find((e) => e.storeField === "llmTemperature");
    expect(entry).toBeDefined();
    expect(entry!.controlType).toBe("slider");
  });

  it("llmOpenaiApiKeySet entry has controlType 'password'", () => {
    const entry = SETTINGS_REGISTRY.find((e) => e.storeField === "llmOpenaiApiKeySet");
    expect(entry).toBeDefined();
    expect(entry!.controlType).toBe("password");
  });

  it("llmSystemPrompt entry has controlType 'textarea'", () => {
    const entry = SETTINGS_REGISTRY.find((e) => e.storeField === "llmSystemPrompt");
    expect(entry).toBeDefined();
    expect(entry!.controlType).toBe("textarea");
  });

  it("llmPromptLlm entry exists with controlType 'textarea'", () => {
    const entry = SETTINGS_REGISTRY.find((e) => e.storeField === "llmPromptLlm");
    expect(entry).toBeDefined();
    expect(entry!.controlType).toBe("textarea");
    expect(entry!.category).toBe("LLM");
  });

  it("bottomPanelPosition entry has controlType 'segmented'", () => {
    const entry = SETTINGS_REGISTRY.find((e) => e.storeField === "bottomPanelPosition");
    expect(entry).toBeDefined();
    expect(entry!.category).toBe("Appearance");
    expect(entry!.controlType).toBe("segmented");
  });

  it("all 3 type-specific prompt entries exist", () => {
    const promptFields = [
      "llmPromptLlm", "llmPromptTr", "llmPromptQ",
    ];
    for (const field of promptFields) {
      const entry = SETTINGS_REGISTRY.find((e) => e.storeField === field);
      expect(entry, `missing entry for ${field}`).toBeDefined();
      expect(entry!.controlType).toBe("textarea");
    }
  });
});

describe("CATEGORIES", () => {
  it("equals the expected ordered list", () => {
    expect(CATEGORIES).toEqual([
      "Appearance",
      "Editor",
      "Cross-references",
      "Annotations",
      "LLM",
      "Academic Export",
      "Experimental",
      "Keyboard Shortcuts",
    ]);
  });
});

describe("groupByCategory", () => {
  it("returns Map with 8 keys and correct counts", () => {
    const grouped = groupByCategory(SETTINGS_REGISTRY);
    expect(grouped.size).toBe(8);
    expect(grouped.get("Appearance")).toHaveLength(5);
    expect(grouped.get("Editor")).toHaveLength(3);
    expect(grouped.get("Cross-references")).toHaveLength(3);
    expect(grouped.get("Annotations")).toHaveLength(5);
    expect(grouped.get("LLM")).toHaveLength(12);
    expect(grouped.get("Academic Export")).toHaveLength(6);
    expect(grouped.get("Experimental")).toHaveLength(1);
    expect(grouped.get("Keyboard Shortcuts")).toHaveLength(0);
  });

  it("preserves CATEGORIES order", () => {
    const grouped = groupByCategory(SETTINGS_REGISTRY);
    expect([...grouped.keys()]).toEqual(CATEGORIES);
  });
});

describe("filterSettings", () => {
  it('returns only Folding entries for query "fold"', () => {
    const results = filterSettings(SETTINGS_REGISTRY, "fold");
    expect(results).toHaveLength(2);
    expect(results[0]!.entry.label).toBe("Folding");
    expect(results[1]!.entry.label).toBe("Folding Controls");
    for (const r of results) {
      expect(r.indices.length).toBeGreaterThan(0);
    }
  });

  it("returns all entries with empty indices for empty query", () => {
    const results = filterSettings(SETTINGS_REGISTRY, "");
    expect(results).toHaveLength(35);
    for (const r of results) {
      expect(r.indices).toEqual([]);
    }
  });

  it("returns empty array for non-matching query", () => {
    const results = filterSettings(SETTINGS_REGISTRY, "xyzzynonesuch");
    expect(results).toEqual([]);
  });
});
