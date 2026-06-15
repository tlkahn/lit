import { describe, it, expect } from "vitest";
import type { BibEntry } from "./ipc";
import { lastName, initialOf, buildSectionedList } from "./sectionedList";

function mkEntry(overrides: Partial<BibEntry> = {}): BibEntry {
  return {
    key: "test2024",
    authors: ["Doe, Jane"],
    title: "Test",
    year: "2024",
    entry_type: "article",
    line_number: 0,
    ...overrides,
  };
}

describe("lastName", () => {
  it("extracts text before comma", () => {
    expect(lastName(mkEntry({ authors: ["Knuth, Donald"] }))).toBe("Knuth");
  });

  it("returns full name when no comma", () => {
    expect(lastName(mkEntry({ authors: ["Plato"] }))).toBe("Plato");
  });

  it("returns empty string for empty authors", () => {
    expect(lastName(mkEntry({ authors: [] }))).toBe("");
  });
});

describe("initialOf", () => {
  it("returns uppercase first letter for standard last name", () => {
    expect(initialOf(mkEntry({ authors: ["Smith, John"] }))).toBe("S");
  });

  it("returns uppercase for lowercase first char", () => {
    expect(initialOf(mkEntry({ authors: ["de Vries, Jan"] }))).toBe("D");
  });

  it("strips diacritics via NFD normalization", () => {
    expect(initialOf(mkEntry({ authors: ["Öztürk, Ahmet"] }))).toBe("O");
  });

  it("returns # for CJK last name", () => {
    expect(initialOf(mkEntry({ authors: ["张伟"] }))).toBe("#");
  });

  it("returns # for Cyrillic last name", () => {
    expect(initialOf(mkEntry({ authors: ["Иванов, Иван"] }))).toBe("#");
  });

  it("returns # when authors array is empty", () => {
    expect(initialOf(mkEntry({ authors: [] }))).toBe("#");
  });

  it("returns # when first author is empty string", () => {
    expect(initialOf(mkEntry({ authors: [""] }))).toBe("#");
  });

  it("handles single-word author (no comma)", () => {
    expect(initialOf(mkEntry({ authors: ["Aristotle"] }))).toBe("A");
  });
});

describe("buildSectionedList", () => {
  it("inserts header before each new letter group", () => {
    const entries = [
      mkEntry({ key: "a1", authors: ["Adams, A"] }),
      mkEntry({ key: "b1", authors: ["Baker, B"] }),
      mkEntry({ key: "c1", authors: ["Carter, C"] }),
    ];
    const { items, letterSet } = buildSectionedList(entries);
    expect(items).toHaveLength(6);
    expect(items[0]).toEqual({ kind: "header", letter: "A" });
    expect(items[1]).toEqual({ kind: "entry", entry: entries[0] });
    expect(items[2]).toEqual({ kind: "header", letter: "B" });
    expect(items[3]).toEqual({ kind: "entry", entry: entries[1] });
    expect(items[4]).toEqual({ kind: "header", letter: "C" });
    expect(items[5]).toEqual({ kind: "entry", entry: entries[2] });
    expect(letterSet).toEqual(new Set(["A", "B", "C"]));
  });

  it("groups entries under the same letter", () => {
    const entries = [
      mkEntry({ key: "s1", authors: ["Smith, A"] }),
      mkEntry({ key: "s2", authors: ["Stevens, B"] }),
    ];
    const { items, letterSet } = buildSectionedList(entries);
    expect(items).toHaveLength(3);
    expect(items[0]).toEqual({ kind: "header", letter: "S" });
    expect(items[1]).toEqual({ kind: "entry", entry: entries[0] });
    expect(items[2]).toEqual({ kind: "entry", entry: entries[1] });
    expect(letterSet).toEqual(new Set(["S"]));
  });

  it("single entry produces one header and one entry", () => {
    const entry = mkEntry({ key: "j1", authors: ["Jones, J"] });
    const { items, letterSet } = buildSectionedList([entry]);
    expect(items).toEqual([
      { kind: "header", letter: "J" },
      { kind: "entry", entry },
    ]);
    expect(letterSet).toEqual(new Set(["J"]));
  });

  it("empty input returns empty items and empty letterSet", () => {
    const { items, letterSet } = buildSectionedList([]);
    expect(items).toEqual([]);
    expect(letterSet.size).toBe(0);
  });

  it("non-Latin names grouped under #", () => {
    const entries = [
      mkEntry({ key: "z1", authors: ["张伟"] }),
      mkEntry({ key: "z2", authors: ["李明"] }),
    ];
    const { items, letterSet } = buildSectionedList(entries);
    expect(items).toHaveLength(3);
    expect(items[0]).toEqual({ kind: "header", letter: "#" });
    expect(letterSet).toEqual(new Set(["#"]));
  });

  it("mixed Latin and non-Latin in pre-sorted order", () => {
    const entries = [
      mkEntry({ key: "a1", authors: ["Adams, A"] }),
      mkEntry({ key: "z1", authors: ["张伟"] }),
      mkEntry({ key: "b1", authors: ["Baker, B"] }),
    ];
    const { items, letterSet } = buildSectionedList(entries);
    expect(items).toHaveLength(6);
    expect(items[0]).toEqual({ kind: "header", letter: "A" });
    expect(items[1]).toEqual({ kind: "entry", entry: entries[0] });
    expect(items[2]).toEqual({ kind: "header", letter: "#" });
    expect(items[3]).toEqual({ kind: "entry", entry: entries[1] });
    expect(items[4]).toEqual({ kind: "header", letter: "B" });
    expect(items[5]).toEqual({ kind: "entry", entry: entries[2] });
    expect(letterSet).toEqual(new Set(["A", "#", "B"]));
  });

  it("search-filtered subset (only B entries survive)", () => {
    const entries = [
      mkEntry({ key: "b1", authors: ["Brown, A"] }),
      mkEntry({ key: "b2", authors: ["Burns, B"] }),
    ];
    const { items, letterSet } = buildSectionedList(entries);
    expect(items).toHaveLength(3);
    expect(items[0]).toEqual({ kind: "header", letter: "B" });
    expect(letterSet).toEqual(new Set(["B"]));
  });

  it("all entries same letter", () => {
    const entries = [
      mkEntry({ key: "m1", authors: ["Miller, A"] }),
      mkEntry({ key: "m2", authors: ["Morris, B"] }),
      mkEntry({ key: "m3", authors: ["Murphy, C"] }),
    ];
    const { items, letterSet } = buildSectionedList(entries);
    expect(items).toHaveLength(4);
    expect(items[0]).toEqual({ kind: "header", letter: "M" });
    expect(letterSet).toEqual(new Set(["M"]));
  });
});
