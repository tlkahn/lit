import { describe, it, expect } from "vitest";
import { distinctPublisher, materializationBorderClass } from "./bibUtils";
import type { BibEntry } from "./ipc";

function makeEntry(overrides: Partial<BibEntry> = {}): BibEntry {
  return {
    key: "test2020",
    authors: [],
    title: "Test",
    year: "2020",
    entry_type: "article",
    line_number: 0,
    ...overrides,
  };
}

describe("distinctPublisher", () => {
  it("returns publisher when it differs from journal", () => {
    expect(distinctPublisher(makeEntry({ journal: "Nature", publisher: "Springer" }))).toBe("Springer");
  });

  it("returns undefined when publisher equals journal", () => {
    expect(distinctPublisher(makeEntry({ journal: "Nature", publisher: "Nature" }))).toBeUndefined();
  });

  it("returns undefined when publisher equals journal case-insensitively", () => {
    expect(distinctPublisher(makeEntry({ journal: "Nature", publisher: "NATURE" }))).toBeUndefined();
  });

  it("returns undefined when publisher equals journal with whitespace differences", () => {
    expect(distinctPublisher(makeEntry({ journal: "Nature", publisher: " Nature " }))).toBeUndefined();
  });

  it("returns undefined when publisher is absent", () => {
    expect(distinctPublisher(makeEntry({ publisher: undefined }))).toBeUndefined();
  });

  it("returns undefined when publisher is empty string", () => {
    expect(distinctPublisher(makeEntry({ publisher: "" }))).toBeUndefined();
  });

  it("returns undefined when publisher is whitespace only", () => {
    expect(distinctPublisher(makeEntry({ publisher: "   " }))).toBeUndefined();
  });

  it("returns publisher when journal is absent", () => {
    expect(distinctPublisher(makeEntry({ journal: undefined, publisher: "MIT Press" }))).toBe("MIT Press");
  });

  it("returns trimmed publisher", () => {
    expect(distinctPublisher(makeEntry({ publisher: "  MIT Press  " }))).toBe("MIT Press");
  });
});

describe("materializationBorderClass", () => {
  it("returns accent border when page_id is set", () => {
    expect(
      materializationBorderClass({ materialization: "materialized", page_id: "notes/foo.md" }),
    ).toBe("border-l-2 border-interactive-accent");
  });

  it("returns accent border even when materialization is partial if page_id is set", () => {
    expect(
      materializationBorderClass({ materialization: "partial", page_id: "notes/foo.md" }),
    ).toBe("border-l-2 border-interactive-accent");
  });

  it("returns dashed muted border when materialization is partial and page_id is null", () => {
    expect(
      materializationBorderClass({ materialization: "partial", page_id: null }),
    ).toBe("border-l-2 border-dashed border-text-muted");
  });

  it("returns undefined when state is undefined", () => {
    expect(materializationBorderClass(undefined)).toBeUndefined();
  });

  it("returns undefined for shadow materialization with no page_id", () => {
    expect(
      materializationBorderClass({ materialization: "shadow", page_id: null }),
    ).toBeUndefined();
  });
});
