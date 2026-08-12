import { describe, expect, it } from "vitest";
import {
  SETTINGS_REGISTRY,
  CATEGORIES,
  FORM_SETTINGS_REGISTRY,
  FORM_CATEGORIES,
  groupByCategory,
  filterSettings,
  filterFormSettings,
} from "./settingsRegistry";

describe("SETTINGS_REGISTRY", () => {
  it("has no duplicate storeField keys", () => {
    const fields = SETTINGS_REGISTRY.map((e) => e.storeField);
    expect(new Set(fields).size).toBe(fields.length);
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

  it("every entry declares an explicit formVisible policy", () => {
    for (const entry of SETTINGS_REGISTRY) {
      expect(entry.formVisible, `${entry.storeField} must set formVisible explicitly`).toBeDefined();
    }
  });

  it("colorTheme entry has controlType 'dropdown'", () => {
    const entry = SETTINGS_REGISTRY.find((e) => e.storeField === "colorTheme");
    expect(entry).toBeDefined();
    expect(entry!.controlType).toBe("dropdown");
  });

  it("bottomPanelPosition entry has controlType 'segmented'", () => {
    const entry = SETTINGS_REGISTRY.find((e) => e.storeField === "bottomPanelPosition");
    expect(entry).toBeDefined();
    expect(entry!.category).toBe("Appearance");
    expect(entry!.controlType).toBe("segmented");
  });

  it("defaultImageDir entry exists with controlType 'text' in Editor category", () => {
    const entry = SETTINGS_REGISTRY.find((e) => e.storeField === "defaultImageDir");
    expect(entry).toBeDefined();
    expect(entry!.controlType).toBe("text");
    expect(entry!.category).toBe("Editor");
    expect(entry!.jsonKey).toBe("editor.defaultImageDir");
    expect(entry!.testId).toBe("settings-defaultImageDir");
  });

  it("defaultImageDir entry has normalize that maps empty/whitespace to default", () => {
    const entry = SETTINGS_REGISTRY.find((e) => e.storeField === "defaultImageDir");
    expect(entry).toBeDefined();
    expect(entry!.normalize).toBeDefined();
    expect(entry!.normalize!("")).toBe("assets/images");
    expect(entry!.normalize!("  ")).toBe("assets/images");
    expect(entry!.normalize!("media")).toBe("media");
  });

  it("companionSearchPath entry exists with controlType 'custom' in Editor category", () => {
    const entry = SETTINGS_REGISTRY.find((e) => e.storeField === "companionSearchPath");
    expect(entry).toBeDefined();
    expect(entry!.controlType).toBe("custom");
    expect(entry!.category).toBe("Editor");
    expect(entry!.jsonKey).toBe("companion.searchPath");
  });

});

describe("CATEGORIES", () => {
  it("equals the expected ordered list", () => {
    expect(CATEGORIES).toEqual([
      "Appearance",
      "Editor",
      "Cross-references",
      "Annotations",
      "Paper Search",
      "Credentials",
      "Academic Export",
      "Experimental",
      "Keyboard Shortcuts",
    ]);
  });
});

describe("FORM_SETTINGS_REGISTRY", () => {
  it("contains exactly the productized appearance and credentials entries", () => {
    expect(FORM_SETTINGS_REGISTRY).toHaveLength(8);
    expect(FORM_SETTINGS_REGISTRY.map((e) => e.storeField).sort()).toEqual([
      "colorTheme",
      "darkMode",
      "fontInterfaceList",
      "searchBaseApiKeySet",
      "searchCoreApiKeySet",
      "searchGoogleBooksApiKeySet",
      "searchPubmedApiKeySet",
      "searchS2ApiKeySet",
    ]);
  });

  it("every form-visible entry category is in FORM_CATEGORIES", () => {
    for (const entry of FORM_SETTINGS_REGISTRY) {
      expect(entry.formVisible).toBe(true);
      expect(FORM_CATEGORIES, entry.storeField).toContain(entry.category);
    }
  });

  it("the five paper-search API key entries are form-visible Credentials", () => {
    for (const field of [
      "searchS2ApiKeySet",
      "searchCoreApiKeySet",
      "searchPubmedApiKeySet",
      "searchGoogleBooksApiKeySet",
      "searchBaseApiKeySet",
    ]) {
      const entry = SETTINGS_REGISTRY.find((e) => e.storeField === field);
      expect(entry, `missing ${field}`).toBeDefined();
      expect(entry!.category).toBe("Credentials");
      expect(entry!.controlType).toBe("password");
      expect(entry!.formVisible).toBe(true);
    }
  });

  it("paper-search non-secret entries stay hidden on Paper Search", () => {
    for (const field of ["searchEnabledProviders", "searchCrossrefEmail", "searchUnpaywallEmail", "searchProviderTimeout"]) {
      const entry = SETTINGS_REGISTRY.find((e) => e.storeField === field);
      expect(entry, `missing ${field}`).toBeDefined();
      expect(entry!.category).toBe("Paper Search");
      expect(entry!.formVisible).toBe(false);
    }
  });

  it("darkMode entry is form-visible", () => {
    const entry = SETTINGS_REGISTRY.find((e) => e.storeField === "darkMode");
    expect(entry!.formVisible).toBe(true);
  });

  it("colorTheme entry is form-visible", () => {
    const entry = SETTINGS_REGISTRY.find((e) => e.storeField === "colorTheme");
    expect(entry!.formVisible).toBe(true);
  });

  it("fonts anchor entry is form-visible", () => {
    const entry = SETTINGS_REGISTRY.find((e) => e.storeField === "fontInterfaceList");
    expect(entry!.formVisible).toBe(true);
    expect(entry!.controlType).toBe("custom");
  });

  it("every hidden entry sets formVisible false explicitly", () => {
    const hidden = SETTINGS_REGISTRY.filter((e) => !FORM_SETTINGS_REGISTRY.includes(e));
    expect(hidden.length).toBe(SETTINGS_REGISTRY.length - 8);
    for (const entry of hidden) {
      expect(entry.formVisible, `${entry.storeField} must be formVisible:false`).toBe(false);
    }
  });
});

describe("FORM_CATEGORIES", () => {
  it("equals the form sidebar list", () => {
    expect(FORM_CATEGORIES).toEqual(["Appearance", "Credentials", "Keyboard Shortcuts"]);
  });

  it("is a subset of the full CATEGORIES taxonomy", () => {
    for (const cat of FORM_CATEGORIES) {
      expect(CATEGORIES).toContain(cat);
    }
  });
});

describe("groupByCategory", () => {
  it("returns Map with 9 keys and correct counts", () => {
    const grouped = groupByCategory(SETTINGS_REGISTRY);
    expect(grouped.size).toBe(9);
    expect(grouped.get("Appearance")).toHaveLength(9);
    expect(grouped.get("Editor")).toHaveLength(6);
    expect(grouped.get("Cross-references")).toHaveLength(3);
    expect(grouped.get("Annotations")).toHaveLength(5);
    expect(grouped.get("Paper Search")).toHaveLength(4);
    expect(grouped.get("Credentials")).toHaveLength(5);
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
    expect(results).toHaveLength(SETTINGS_REGISTRY.length);
    for (const r of results) {
      expect(r.indices).toEqual([]);
    }
  });

  it("returns empty array for non-matching query", () => {
    const results = filterSettings(SETTINGS_REGISTRY, "xyzzynonesuch");
    expect(results).toEqual([]);
  });

  it("form subset: 'dark' hits Dark Mode", () => {
    const results = filterSettings(FORM_SETTINGS_REGISTRY, "dark");
    expect(results.map((r) => r.entry.storeField)).toEqual(["darkMode"]);
  });

  it("form subset: 'theme' hits Color Theme", () => {
    const results = filterSettings(FORM_SETTINGS_REGISTRY, "theme");
    expect(results.map((r) => r.entry.storeField)).toEqual(["colorTheme"]);
  });

  it("form subset: 'fold' is empty (hidden controls not surfaced by search)", () => {
    expect(filterSettings(FORM_SETTINGS_REGISTRY, "fold")).toEqual([]);
  });

  it("form subset: 'pubmed' hits the PubMed credential row", () => {
    const results = filterSettings(FORM_SETTINGS_REGISTRY, "pubmed");
    expect(results.map((r) => r.entry.storeField)).toEqual(["searchPubmedApiKeySet"]);
  });

  it("form subset: 'api key' hits all five credential rows", () => {
    const results = filterSettings(FORM_SETTINGS_REGISTRY, "api key");
    expect(results.map((r) => r.entry.storeField).sort()).toEqual([
      "searchBaseApiKeySet",
      "searchCoreApiKeySet",
      "searchGoogleBooksApiKeySet",
      "searchPubmedApiKeySet",
      "searchS2ApiKeySet",
    ]);
  });

  it("form subset: LLM/companion queries are empty even though full registry matches", () => {
    for (const q of ["openai", "model", "companion", "pdf"]) {
      expect(filterSettings(FORM_SETTINGS_REGISTRY, q), `query "${q}"`).toEqual([]);
    }
  });

  it("filterFormSettings only searches the form subset", () => {
    expect(filterFormSettings("font").map((r) => r.entry.storeField)).toEqual(["fontInterfaceList"]);
    expect(filterFormSettings("pandoc")).toEqual([]);
    expect(filterFormSettings("")).toHaveLength(FORM_SETTINGS_REGISTRY.length);
  });

  it("LLM category is gone: no provider/model queries match any entry (#1010)", () => {
    for (const q of ["model", "provider", "api key", "openai", "anthropic", "llm provider", "llm"]) {
      const results = filterSettings(SETTINGS_REGISTRY, q);
      expect(
        results.some((r) => (r.entry.category as string) === "LLM"),
        `query "${q}" must not match an LLM entry`,
      ).toBe(false);
    }
  });

  it("matches the companion search-path entry for related queries via keywords", () => {
    for (const q of ["companion", "pdf", "search path", "sibling"]) {
      const results = filterSettings(SETTINGS_REGISTRY, q);
      expect(
        results.some((r) => r.entry.storeField === "companionSearchPath"),
        `expected a companionSearchPath match for query "${q}"`,
      ).toBe(true);
    }
  });

  it("yields empty highlight indices when only a keyword (not the label) matches", () => {
    const results = filterSettings(SETTINGS_REGISTRY, "sibling");
    const match = results.find((r) => r.entry.storeField === "companionSearchPath");
    expect(match).toBeDefined();
    expect(match!.indices).toEqual([]);
  });
});
