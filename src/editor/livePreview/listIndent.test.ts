import { describe, expect, it } from "vitest";
import { listPrefixIndentPx } from "./listIndent";

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
