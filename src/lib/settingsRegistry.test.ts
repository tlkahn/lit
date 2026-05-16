import { describe, expect, it } from "vitest";
import {
  SETTINGS_REGISTRY,
  CATEGORIES,
  groupByCategory,
  filterSettings,
} from "./settingsRegistry";

describe("SETTINGS_REGISTRY", () => {
  it("has 15 entries", () => {
    expect(SETTINGS_REGISTRY).toHaveLength(15);
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
});

describe("CATEGORIES", () => {
  it("equals the expected ordered list", () => {
    expect(CATEGORIES).toEqual([
      "Appearance",
      "Editor",
      "Cross-references",
      "Annotations",
      "Experimental",
    ]);
  });
});

describe("groupByCategory", () => {
  it("returns Map with 5 keys and correct counts", () => {
    const grouped = groupByCategory(SETTINGS_REGISTRY);
    expect(grouped.size).toBe(5);
    expect(grouped.get("Appearance")).toHaveLength(4);
    expect(grouped.get("Editor")).toHaveLength(3);
    expect(grouped.get("Cross-references")).toHaveLength(3);
    expect(grouped.get("Annotations")).toHaveLength(4);
    expect(grouped.get("Experimental")).toHaveLength(1);
  });

  it("preserves CATEGORIES order", () => {
    const grouped = groupByCategory(SETTINGS_REGISTRY);
    expect([...grouped.keys()]).toEqual(CATEGORIES);
  });
});

describe("filterSettings", () => {
  it('returns only Folding entries for query "fold"', () => {
    const results = filterSettings(SETTINGS_REGISTRY, "fold");
    const labels = results.map((r) => r.entry.label);
    expect(labels).toContain("Folding");
    expect(labels).toContain("Folding Controls");
    expect(results).toHaveLength(2);
    for (const r of results) {
      expect(r.indices.length).toBeGreaterThan(0);
    }
  });

  it("returns all 15 entries with empty indices for empty query", () => {
    const results = filterSettings(SETTINGS_REGISTRY, "");
    expect(results).toHaveLength(15);
    for (const r of results) {
      expect(r.indices).toEqual([]);
    }
  });

  it("returns empty array for non-matching query", () => {
    const results = filterSettings(SETTINGS_REGISTRY, "xyzzynonesuch");
    expect(results).toEqual([]);
  });
});
