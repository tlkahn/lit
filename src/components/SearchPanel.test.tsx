import { describe, it, expect } from "vitest";
import { countMatches } from "./SearchPanel";

describe("countMatches", () => {
  it("returns 0 for empty string", () => {
    expect(countMatches("")).toBe(0);
  });

  it("returns 0 for string with no <mark> tags", () => {
    expect(countMatches("no matches here")).toBe(0);
  });

  it("returns 1 for single match", () => {
    expect(countMatches("<mark>foo</mark> bar")).toBe(1);
  });

  it("returns 2 for two matches", () => {
    expect(countMatches("<mark>foo</mark> bar <mark>baz</mark>")).toBe(2);
  });

  it("returns correct count with ... separators between match groups", () => {
    expect(
      countMatches("<mark>rust</mark> ownership ... memory <mark>rust</mark> borrow ... <mark>rust</mark> lifetime"),
    ).toBe(3);
  });

  it("does not count partial <mark without closing >", () => {
    expect(countMatches("<mark foo")).toBe(0);
  });

  it("counts correctly with adjacent marks", () => {
    expect(countMatches("<mark>a</mark><mark>b</mark><mark>c</mark>")).toBe(3);
  });
});
