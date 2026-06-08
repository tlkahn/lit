import { describe, expect, it } from "vitest";
import {
  SETTINGS_REGISTRY,
  CATEGORIES,
  STORE_FIELDS,
  groupByCategory,
  filterSettings,
} from "./settingsRegistry";

describe("SETTINGS_REGISTRY", () => {
  it("has 32 entries", () => {
    expect(SETTINGS_REGISTRY).toHaveLength(32);
  });

  it("every entry has required fields defined", () => {
    for (const entry of SETTINGS_REGISTRY) {
      expect(entry.category).toBeDefined();
      expect(entry.label).toBeDefined();
      expect(entry.jsonKey).toBeDefined();
      expect(entry.controlType).toBeDefined();
      expect(entry.testId).toBeDefined();
      // storeField is required for everything except custom anchor entries.
      if (entry.controlType !== "custom") {
        expect(entry.storeField).toBeDefined();
      }
    }
  });

  it("colorTheme entry has controlType 'dropdown'", () => {
    const entry = SETTINGS_REGISTRY.find((e) => e.storeField === "colorTheme");
    expect(entry).toBeDefined();
    expect(entry!.controlType).toBe("dropdown");
  });

  it("llmModel entry was removed (now in LlmProviderSettings)", () => {
    const entry = SETTINGS_REGISTRY.find((e) => e.storeField === "llmModel");
    expect(entry).toBeUndefined();
  });

  it("llmTemperature entry has controlType 'slider'", () => {
    const entry = SETTINGS_REGISTRY.find((e) => e.storeField === "llmTemperature");
    expect(entry).toBeDefined();
    expect(entry!.controlType).toBe("slider");
  });

  it("llmOpenaiApiKeySet entry was removed (now in LlmProviderSettings)", () => {
    const entry = SETTINGS_REGISTRY.find((e) => e.storeField === "llmOpenaiApiKeySet");
    expect(entry).toBeUndefined();
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
      "Storage",
      "Experimental",
      "Keyboard Shortcuts",
    ]);
  });

  it("includes Storage", () => {
    expect(CATEGORIES).toContain("Storage");
  });
});

describe("STORE_FIELDS", () => {
  it("excludes custom anchor entries that have no storeField", () => {
    // The Storage Mode anchor has no storeField; it must not leak in.
    expect(STORE_FIELDS).not.toContain(undefined);
    expect(STORE_FIELDS.every((f) => typeof f === "string")).toBe(true);
    // One entry (Storage Mode) is a storeField-less anchor.
    expect(STORE_FIELDS).toHaveLength(SETTINGS_REGISTRY.length - 1);
  });
});

describe("groupByCategory", () => {
  it("returns Map with 9 keys and correct counts", () => {
    const grouped = groupByCategory(SETTINGS_REGISTRY);
    expect(grouped.size).toBe(9);
    expect(grouped.get("Appearance")).toHaveLength(6);
    expect(grouped.get("Editor")).toHaveLength(3);
    expect(grouped.get("Cross-references")).toHaveLength(3);
    expect(grouped.get("Annotations")).toHaveLength(5);
    expect(grouped.get("LLM")).toHaveLength(7);
    expect(grouped.get("Academic Export")).toHaveLength(6);
    expect(grouped.get("Storage")).toHaveLength(1);
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
    expect(results).toHaveLength(32);
    for (const r of results) {
      expect(r.indices).toEqual([]);
    }
  });

  it("surfaces the Storage anchor for database/sqlite queries via keywords", () => {
    for (const q of ["database", "sqlite", "notes.db", "migration"]) {
      const results = filterSettings(SETTINGS_REGISTRY, q);
      expect(
        results.some((r) => r.entry.category === "Storage"),
        `expected a Storage-category match for query "${q}"`,
      ).toBe(true);
    }
  });

  it("returns empty array for non-matching query", () => {
    const results = filterSettings(SETTINGS_REGISTRY, "xyzzynonesuch");
    expect(results).toEqual([]);
  });

  it("matches an LLM entry for provider-related queries via keywords", () => {
    for (const q of ["model", "provider", "api key", "openai", "anthropic", "llm provider"]) {
      const results = filterSettings(SETTINGS_REGISTRY, q);
      expect(
        results.some((r) => r.entry.category === "LLM"),
        `expected an LLM-category match for query "${q}"`,
      ).toBe(true);
    }
  });

  it("yields empty highlight indices when only a keyword (not the label) matches", () => {
    const results = filterSettings(SETTINGS_REGISTRY, "openai");
    const llmMatch = results.find((r) => r.entry.category === "LLM" && r.entry.label === "LLM Provider");
    expect(llmMatch).toBeDefined();
    expect(llmMatch!.indices).toEqual([]);
  });
});
