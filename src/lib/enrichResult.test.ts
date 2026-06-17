import { describe, it, expect } from "vitest";
import { classifyEnrichResult } from "./enrichResult";
import type { EnrichResult, BibEntry } from "./ipc";

/** Minimal BibEntry for testing */
function stubEntry(overrides: Partial<BibEntry> = {}): BibEntry {
  return {
    key: "smith2020",
    authors: ["Smith, John"],
    title: "Test Paper Title",
    year: "2020",
    entry_type: "article",
    line_number: 1,
    ...overrides,
  };
}

/** Minimal EnrichResult for testing */
function stubResult(overrides: Partial<EnrichResult> = {}): EnrichResult {
  return {
    entry: stubEntry(),
    fields_added: [],
    references_found: 0,
    references_appended: 0,
    shadow_nodes_created: 0,
    references_linked: 0,
    candidates: [],
    providers_searched: [],
    providers_failed: [],
    ...overrides,
  };
}

describe("classifyEnrichResult", () => {
  it("returns 'candidates' when result has candidates, regardless of other fields", () => {
    const candidates = [stubEntry({ key: "c1" }), stubEntry({ key: "c2" })];
    const result = stubResult({
      candidates,
      fields_added: ["doi"],
      references_appended: 2,
      providers_searched: ["crossref", "s2"],
      providers_failed: ["openlibrary"],
    });

    const classified = classifyEnrichResult(result, "smith2020", "Test Paper Title");

    expect(classified.kind).toBe("candidates");
    if (classified.kind === "candidates") {
      expect(classified.bibKey).toBe("smith2020");
      expect(classified.title).toBe("Test Paper Title");
      expect(classified.candidates).toBe(candidates);
      expect(classified.providersSearched).toEqual(["crossref", "s2"]);
      expect(classified.providersFailed).toEqual(["openlibrary"]);
    }
  });

  it("returns 'miss' when no candidates, no fields added, no references, no shadow nodes", () => {
    const result = stubResult({
      candidates: [],
      fields_added: [],
      references_appended: 0,
      shadow_nodes_created: 0,
    });

    const classified = classifyEnrichResult(result, "smith2020", "Test Paper Title");

    expect(classified.kind).toBe("miss");
    if (classified.kind === "miss") {
      expect(classified.title).toBe("Test Paper Title");
    }
  });

  it("returns 'success' when no candidates but fields were added", () => {
    const result = stubResult({
      candidates: [],
      fields_added: ["doi", "abstract"],
      references_appended: 3,
      references_found: 5,
      shadow_nodes_created: 2,
    });

    const classified = classifyEnrichResult(result, "smith2020", "Test Paper Title");

    expect(classified.kind).toBe("success");
    if (classified.kind === "success") {
      expect(classified.message).toContain("Enriched smith2020");
      expect(classified.message).toContain("added doi, abstract");
      expect(classified.message).toContain("3 of 5 references added");
      expect(classified.message).toContain("2 shadow nodes created");
    }
  });

  it("returns 'success' with only references appended (no fields added)", () => {
    const result = stubResult({
      candidates: [],
      fields_added: [],
      references_appended: 4,
      references_found: 4,
    });

    const classified = classifyEnrichResult(result, "smith2020", "Test Paper Title");

    expect(classified.kind).toBe("success");
    if (classified.kind === "success") {
      expect(classified.message).toContain("4 references added");
      expect(classified.message).not.toContain(" of ");
    }
  });

  it("returns 'success' with only shadow nodes created", () => {
    const result = stubResult({
      candidates: [],
      fields_added: [],
      references_appended: 0,
      shadow_nodes_created: 5,
    });

    const classified = classifyEnrichResult(result, "smith2020", "Test Paper Title");

    expect(classified.kind).toBe("success");
    if (classified.kind === "success") {
      expect(classified.message).toContain("5 shadow nodes created");
    }
  });

  it("returns 'success' with bare message when only fields_added", () => {
    const result = stubResult({
      candidates: [],
      fields_added: ["journal"],
    });

    const classified = classifyEnrichResult(result, "key1", "Some Title");

    expect(classified.kind).toBe("success");
    if (classified.kind === "success") {
      expect(classified.message).toBe("Enriched key1: added journal");
    }
  });

  it("candidates branch takes priority even when fields_added and references exist", () => {
    const candidates = [stubEntry({ key: "c1" })];
    const result = stubResult({
      candidates,
      fields_added: ["doi"],
      references_appended: 2,
      shadow_nodes_created: 1,
    });

    const classified = classifyEnrichResult(result, "key1", "Title");

    expect(classified.kind).toBe("candidates");
  });

  it("miss message includes the entry title", () => {
    const result = stubResult();

    const classified = classifyEnrichResult(result, "key1", "My Special Paper");

    expect(classified.kind).toBe("miss");
    if (classified.kind === "miss") {
      expect(classified.message).toContain("My Special Paper");
      expect(classified.message).toContain("No metadata found");
      expect(classified.message).toContain("Try searching manually");
    }
  });

  it("success message has no colon-space suffix when all parts empty (only fields_added)", () => {
    const result = stubResult({
      fields_added: ["url"],
    });

    const classified = classifyEnrichResult(result, "k", "T");

    expect(classified.kind).toBe("success");
    if (classified.kind === "success") {
      expect(classified.message).toBe("Enriched k: added url");
    }
  });
});
