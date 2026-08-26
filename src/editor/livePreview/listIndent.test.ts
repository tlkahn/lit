import { describe, expect, it } from "vitest";
import { listPrefixIndentPx, columnAt, listContinuationIndentEnd } from "./listIndent";

describe("listPrefixIndentPx (#1050)", () => {
  it("uses rounded positive measureWidth when provided", () => {
    expect(listPrefixIndentPx("2. ", 10, () => 17.4)).toBe(17);
    expect(listPrefixIndentPx("2. ", 10, () => 17.6)).toBe(18);
  });

  it("falls back to prefix.length * fallbackCharWidth when measure missing", () => {
    expect(listPrefixIndentPx("2. ", 10)).toBe(30); // 3 * 10
  });

  it("falls back when measure returns null / 0 / non-finite", () => {
    expect(listPrefixIndentPx("- ", 8, () => null)).toBe(16);
    expect(listPrefixIndentPx("- ", 8, () => 0)).toBe(16);
    expect(listPrefixIndentPx("- ", 8, () => NaN)).toBe(16);
    expect(listPrefixIndentPx("- ", 8, () => -4)).toBe(16);
  });

  it("uses prefix string length for fallback (task / multi-digit)", () => {
    expect(listPrefixIndentPx("10. ", 10)).toBe(40);
    expect(listPrefixIndentPx("- [ ] ", 10)).toBe(60);
  });
});

describe("columnAt (#1057)", () => {
  it("counts spaces as one column each", () => {
    expect(columnAt("    The", 4)).toBe(4);
    expect(columnAt("    The", 0)).toBe(0);
  });

  it("expands tabs to tabSize 4 (CommonMark)", () => {
    // "\t" at col 0 -> occupies columns 0..3, next char at col 4
    expect(columnAt("\tX", 1)).toBe(4);
    expect(columnAt("  \tX", 3)).toBe(4); // two spaces + tab fills to 4
  });

  it("clamps charOffset to string length", () => {
    expect(columnAt("ab", 99)).toBe(2);
  });
});

describe("listContinuationIndentEnd (#1057)", () => {
  it("hides lead spaces up to contentColumn", () => {
    // contentColumn 4 (e.g. "36. "), line "    The…"
    expect(listContinuationIndentEnd("    The", 4)).toBe(4);
  });

  it("hides only up to contentColumn when extra spaces remain", () => {
    // 7 spaces, content col 3 -> hide 3 chars, leave 4
    expect(listContinuationIndentEnd("       code", 3)).toBe(3);
  });

  it("stops at first non-whitespace even if column < contentColumn", () => {
    expect(listContinuationIndentEnd("  x", 4)).toBe(2);
  });

  it("returns 0 when line has no lead indent", () => {
    expect(listContinuationIndentEnd("The", 4)).toBe(0);
    expect(listContinuationIndentEnd("", 4)).toBe(0);
  });

  it("ordered hard-wrap: 3 spaces under contentColumn 3", () => {
    expect(listContinuationIndentEnd("   continuation", 3)).toBe(3);
  });

  it("bullet hard-wrap: 2 spaces under contentColumn 2", () => {
    expect(listContinuationIndentEnd("  continuation", 2)).toBe(2);
  });

  it("consumes a leading tab toward contentColumn", () => {
    // tab at 0 -> one tab char hides when contentColumn >= 4
    expect(listContinuationIndentEnd("\tThe", 4)).toBe(1);
  });

  it("skips blockquote marker prefix then hides remaining spaces", () => {
    // physical: ">    cont" ; contentColumn 5 for "> 1. " body
    // prefix match "> " (len 2), then 3 spaces before "cont" -> end at 5
    expect(listContinuationIndentEnd(">    cont", 5)).toBe(5);
  });

  it("blockquote with no extra spaces returns prefix length when prefix columns cover contentColumn", () => {
    // tight case: "> " covers contentColumn 2, no extra spaces -> end at 2
    expect(listContinuationIndentEnd("> cont", 2)).toBe(2);
  });
});
