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
});
