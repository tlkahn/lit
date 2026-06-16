import { describe, it, expect } from "vitest";
import { distinctPublisher } from "./bibUtils";
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
