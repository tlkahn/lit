import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { recordAccess, getScore, sortByFrecency, _clear } from "./frecency";

describe("frecency", () => {
  beforeEach(() => {
    _clear();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-01-01T00:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    _clear();
  });

  it("recordAccess stores entry in localStorage", () => {
    recordAccess("item-1");
    const raw = localStorage.getItem("lit-palette-frecency");
    expect(raw).toBeTruthy();
    const data = JSON.parse(raw!);
    expect(data["item-1"]).toBeDefined();
    expect(data["item-1"].count).toBe(1);
  });

  it("recordAccess increments count for repeated accesses", () => {
    recordAccess("item-1");
    recordAccess("item-1");
    recordAccess("item-1");
    const data = JSON.parse(localStorage.getItem("lit-palette-frecency")!);
    expect(data["item-1"].count).toBe(3);
  });

  it("getScore returns 0 for unknown id", () => {
    expect(getScore("nonexistent")).toBe(0);
  });

  it("higher score for more recent access", () => {
    recordAccess("old");
    vi.advanceTimersByTime(24 * 60 * 60 * 1000);
    recordAccess("new");
    expect(getScore("new")).toBeGreaterThan(getScore("old"));
  });

  it("higher score for more frequent access", () => {
    recordAccess("frequent");
    recordAccess("frequent");
    recordAccess("frequent");
    recordAccess("rare");
    expect(getScore("frequent")).toBeGreaterThan(getScore("rare"));
  });

  it("sortByFrecency sorts higher-scored items first, stable for equal scores", () => {
    recordAccess("b");
    recordAccess("b");
    recordAccess("a");
    const items = [
      { name: "a" },
      { name: "b" },
      { name: "c" },
    ];
    const sorted = sortByFrecency(items, (i) => i.name);
    expect(sorted[0]!.name).toBe("b");
    expect(sorted[1]!.name).toBe("a");
    expect(sorted[2]!.name).toBe("c");
  });

  it("_clear removes data", () => {
    recordAccess("item-1");
    _clear();
    expect(getScore("item-1")).toBe(0);
    expect(localStorage.getItem("lit-palette-frecency")).toBeNull();
  });
});
