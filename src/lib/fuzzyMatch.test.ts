import { describe, it, expect } from "vitest";
import { fuzzyMatch } from "./fuzzyMatch";

describe("fuzzyMatch", () => {
  it("returns null when query is not a subsequence of candidate", () => {
    expect(fuzzyMatch("xyz", "hello")).toBeNull();
  });

  it("returns match with all indices for exact string match", () => {
    const result = fuzzyMatch("hello", "hello");
    expect(result).not.toBeNull();
    expect(result!.indices).toEqual([0, 1, 2, 3, 4]);
  });

  it("returns match for subsequence", () => {
    const result = fuzzyMatch("hlo", "hello");
    expect(result).not.toBeNull();
    expect(result!.indices).toEqual([0, 2, 4]);
  });

  it("matches case-insensitively", () => {
    const result = fuzzyMatch("HEL", "hello");
    expect(result).not.toBeNull();
    expect(result!.indices).toEqual([0, 1, 2]);
  });

  it("returns score 0 and empty indices for empty query", () => {
    const result = fuzzyMatch("", "anything");
    expect(result).not.toBeNull();
    expect(result!.score).toBe(0);
    expect(result!.indices).toEqual([]);
  });

  it("returns null for empty candidate with non-empty query", () => {
    expect(fuzzyMatch("a", "")).toBeNull();
  });

  it("returns null when query is longer than candidate", () => {
    expect(fuzzyMatch("toolong", "short")).toBeNull();
  });

  it("scores consecutive characters higher than scattered", () => {
    const consecutive = fuzzyMatch("ab", "abcd");
    const scattered = fuzzyMatch("ab", "axbx");
    expect(consecutive).not.toBeNull();
    expect(scattered).not.toBeNull();
    expect(consecutive!.score).toBeGreaterThan(scattered!.score);
  });

  it("scores word boundary matches higher", () => {
    const boundary = fuzzyMatch("gw", "get_widget");
    const nonBoundary = fuzzyMatch("gw", "growler");
    expect(boundary).not.toBeNull();
    expect(nonBoundary).not.toBeNull();
    expect(boundary!.score).toBeGreaterThan(nonBoundary!.score);
  });

  it("gives start-of-string bonus", () => {
    const atStart = fuzzyMatch("he", "hello world");
    const notStart = fuzzyMatch("he", "say hello");
    expect(atStart).not.toBeNull();
    expect(notStart).not.toBeNull();
    expect(atStart!.score).toBeGreaterThan(notStart!.score);
  });

  it("handles single character query", () => {
    const result = fuzzyMatch("h", "hello");
    expect(result).not.toBeNull();
    expect(result!.indices).toEqual([0]);
  });

  it("matches last character in candidate", () => {
    const result = fuzzyMatch("o", "hello");
    expect(result).not.toBeNull();
    expect(result!.indices).toEqual([4]);
  });

  describe("grapheme-aware indices", () => {
    it("returns grapheme-cluster indices for emoji", () => {
      const result = fuzzyMatch("L", "🚀 Launch");
      expect(result).not.toBeNull();
      expect(result!.indices).toEqual([2]);
    });

    it("treats ZWJ emoji sequence as single grapheme", () => {
      const result = fuzzyMatch("h", "👨‍👩‍👧‍👦 hi");
      expect(result).not.toBeNull();
      expect(result!.indices).toEqual([2]);
    });

    it("treats base + combining mark as single grapheme", () => {
      const result = fuzzyMatch("s", "és");
      expect(result).not.toBeNull();
      expect(result!.indices).toEqual([1]);
    });

    it("matches Korean characters as individual graphemes", () => {
      const result = fuzzyMatch("글", "한글");
      expect(result).not.toBeNull();
      expect(result!.indices).toEqual([1]);
    });

    it("scores consecutive graphemes correctly with emoji prefix", () => {
      const consecutive = fuzzyMatch("ab", "🎯 abc");
      const scattered = fuzzyMatch("ac", "🎯 abc");
      expect(consecutive).not.toBeNull();
      expect(scattered).not.toBeNull();
      expect(consecutive!.indices).toEqual([2, 3]);
      expect(consecutive!.score).toBeGreaterThan(scattered!.score);
    });
  });

  describe("locale-aware case folding", () => {
    it("matches accented characters with base equivalents", () => {
      const result = fuzzyMatch("cafe", "café");
      expect(result).not.toBeNull();
      expect(result!.indices).toEqual([0, 1, 2, 3]);
    });

    it("matches ü with u via locale-aware folding", () => {
      const result = fuzzyMatch("uber", "über");
      expect(result).not.toBeNull();
      expect(result!.indices).toEqual([0, 1, 2, 3]);
    });

    it("matches precomposed and decomposed forms", () => {
      const result = fuzzyMatch("é", "é rest");
      expect(result).not.toBeNull();
      expect(result!.indices).toEqual([0]);
    });

    it("gives case-exact bonus when accents match exactly", () => {
      const withAccent = fuzzyMatch("é", "café");
      const withoutAccent = fuzzyMatch("e", "café");
      expect(withAccent).not.toBeNull();
      expect(withoutAccent).not.toBeNull();
      expect(withAccent!.score).toBeGreaterThan(withoutAccent!.score);
    });
  });
});
