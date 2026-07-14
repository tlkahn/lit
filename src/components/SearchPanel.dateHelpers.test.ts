import { describe, it, expect } from "vitest";
import { toDateString, fromDateString, presetMtimeAfter } from "./SearchPanel";

describe("DateRangeFilter epoch helpers (milliseconds)", () => {
  it("toDateString treats input as milliseconds", () => {
    // 2025-01-15T00:00:00Z in ms
    const ms = new Date("2025-01-15T00:00:00Z").getTime(); // 1736899200000
    expect(toDateString(ms)).toBe("2025-01-15");
  });

  it("toDateString returns empty string for falsy input", () => {
    expect(toDateString(undefined)).toBe("");
    expect(toDateString(0)).toBe("");
  });

  it("toDateString with seconds-scale values gives wrong (1970s) date", () => {
    // If someone passes seconds instead of ms, new Date(seconds) is Jan 1970.
    // This test documents that the function expects MILLISECONDS.
    const seconds = Math.floor(new Date("2025-01-15T00:00:00Z").getTime() / 1000);
    const result = toDateString(seconds);
    // A seconds-scale value (1736899200) treated as ms yields a 1970 date, not 2025
    expect(result).not.toBe("2025-01-15");
  });

  it("fromDateString returns milliseconds", () => {
    const result = fromDateString("2025-01-15");
    expect(result).toBeDefined();
    // Must be in milliseconds (> 1 trillion). Seconds would be ~1.7 billion.
    expect(result!).toBeGreaterThan(1_000_000_000_000);
    expect(result!).toBe(new Date("2025-01-15").getTime());
  });

  it("fromDateString returns undefined for empty string", () => {
    expect(fromDateString("")).toBeUndefined();
  });

  it("presetMtimeAfter computes millisecond timestamps", () => {
    const now = 1736899200000; // 2025-01-15 in ms
    const after = presetMtimeAfter(7, now);
    expect(after).toBe(now - 7 * 86_400_000);
    expect(after).toBeGreaterThan(1_000_000_000_000); // still in ms range
  });

  it("presetMtimeAfter(1) gives exactly 24h ago in ms", () => {
    const now = Date.now();
    const after = presetMtimeAfter(1, now);
    expect(now - after).toBe(86_400_000); // exactly 1 day in ms
  });
});
