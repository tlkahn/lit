import { describe, it, expect } from "vitest";
import { toGraphemes, graphemeEquals, localeIncludes, localeIndexOf, localeFilter } from "./localeSearch";

describe("toGraphemes", () => {
  it("splits ASCII text into characters", () => {
    expect(toGraphemes("abc")).toEqual(["a", "b", "c"]);
  });

  it("treats ZWJ emoji as single grapheme", () => {
    expect(toGraphemes("👨‍👩‍👧‍👦")).toEqual(["👨‍👩‍👧‍👦"]);
  });

  it("treats base + combining mark as single grapheme", () => {
    const result = toGraphemes("és");
    expect(result).toEqual(["é", "s"]);
  });
});

describe("graphemeEquals", () => {
  it("matches same characters", () => {
    expect(graphemeEquals("a", "a")).toBe(true);
  });

  it("matches case-insensitively", () => {
    expect(graphemeEquals("A", "a")).toBe(true);
  });

  it("matches accented to base character", () => {
    expect(graphemeEquals("é", "e")).toBe(true);
  });

  it("returns false for different characters", () => {
    expect(graphemeEquals("a", "b")).toBe(false);
  });
});

describe("localeIncludes", () => {
  it("finds accent-insensitive substring", () => {
    expect(localeIncludes("café notes", "cafe")).toBe(true);
  });

  it("finds ü matching u", () => {
    expect(localeIncludes("über alles", "uber")).toBe(true);
  });

  it("returns false for non-match", () => {
    expect(localeIncludes("hello", "xyz")).toBe(false);
  });

  it("returns true for empty needle", () => {
    expect(localeIncludes("abc", "")).toBe(true);
  });
});

describe("localeFilter", () => {
  it("returns all items when needle is empty", () => {
    const items = ["alpha", "beta", "gamma"];
    expect(localeFilter(items, "", (s) => s)).toEqual(items);
  });

  it("filters by accent-insensitive substring", () => {
    const items = ["café", "hello", "naïve"];
    expect(localeFilter(items, "cafe", (s) => s)).toEqual(["café"]);
  });

  it("returns empty array when nothing matches", () => {
    const items = ["alpha", "beta"];
    expect(localeFilter(items, "xyz", (s) => s)).toEqual([]);
  });

  it("matches case-insensitively", () => {
    const items = ["Hello World", "goodbye"];
    expect(localeFilter(items, "hello", (s) => s)).toEqual(["Hello World"]);
  });

  it("returns empty when needle is longer than all haystacks", () => {
    const items = ["ab", "cd"];
    expect(localeFilter(items, "abcdef", (s) => s)).toEqual([]);
  });

  it("is equivalent to items.filter with localeIncludes", () => {
    const items = ["café notes", "über alles", "plain", "naïve approach"];
    const needle = "uber";
    expect(localeFilter(items, needle, (s) => s)).toEqual(
      items.filter((h) => localeIncludes(h, needle)),
    );
  });

  it("uses getText to extract the searchable string", () => {
    const items = [
      { name: "café", id: 1 },
      { name: "other", id: 2 },
    ];
    expect(localeFilter(items, "cafe", (item) => item.name)).toEqual([{ name: "café", id: 1 }]);
  });
});

describe("localeIndexOf", () => {
  it("finds accent-insensitive match with UTF-16 offsets", () => {
    const result = localeIndexOf("visited the café today", "cafe");
    expect(result).not.toBeNull();
    expect(result!.start).toBe(12);
    expect(result!.end).toBe(16);
  });

  it("returns null for no match", () => {
    expect(localeIndexOf("no match here", "xyz")).toBeNull();
  });
});
