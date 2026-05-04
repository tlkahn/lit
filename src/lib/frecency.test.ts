import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { recordAccess, getScore, sortByFrecency, _clear } from "./frecency";

describe("frecency", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-06-01T00:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("recordAccess stores entry in localStorage", () => {
    recordAccess("item-1");
    const raw = localStorage.getItem("lit-palette-frecency");
    expect(raw).not.toBeNull();
    const data = JSON.parse(raw!);
    expect(data["item-1"]).toBeDefined();
    expect(data["item-1"].count).toBe(1);
  });

  it("repeated access increments count", () => {
    recordAccess("item-1");
    recordAccess("item-1");
    recordAccess("item-1");
    const data = JSON.parse(localStorage.getItem("lit-palette-frecency")!);
    expect(data["item-1"].count).toBe(3);
  });

  it("getScore returns 0 for unknown id", () => {
    expect(getScore("unknown")).toBe(0);
  });

  it("more recent access → higher score", () => {
    recordAccess("old");
    vi.advanceTimersByTime(48 * 60 * 60 * 1000);
    recordAccess("new");
    expect(getScore("new")).toBeGreaterThan(getScore("old"));
  });

  it("more frequent access → higher score", () => {
    recordAccess("frequent");
    recordAccess("frequent");
    recordAccess("frequent");
    recordAccess("rare");
    expect(getScore("frequent")).toBeGreaterThan(getScore("rare"));
  });

  it("sortByFrecency sorts higher-scored items first, stable for equal", () => {
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

  it("sortByFrecency preserves original order for equal-scored items even with unstable sort", () => {
    // All items have score 0 (never accessed), so they're all "equal"
    const items = [
      { name: "alpha" },
      { name: "beta" },
      { name: "gamma" },
      { name: "delta" },
    ];

    // Monkey-patch Array.prototype.sort to simulate an unstable engine:
    // when comparator returns 0, reverse the pair
    const originalSort = Array.prototype.sort;
    Array.prototype.sort = function (compareFn?: (a: unknown, b: unknown) => number) {
      if (!compareFn) return originalSort.call(this);
      return originalSort.call(this, (a: unknown, b: unknown) => {
        const result = compareFn(a, b);
        // Simulate instability: when comparator says "equal", prefer reverse order
        return result === 0 ? -1 : result;
      });
    };

    try {
      const sorted = sortByFrecency(items, (i) => i.name);
      // Should preserve original insertion order: alpha, beta, gamma, delta
      expect(sorted.map((i) => i.name)).toEqual(["alpha", "beta", "gamma", "delta"]);
    } finally {
      Array.prototype.sort = originalSort;
    }
  });

  it("_clear removes localStorage data", () => {
    recordAccess("item-1");
    _clear();
    expect(localStorage.getItem("lit-palette-frecency")).toBeNull();
    expect(getScore("item-1")).toBe(0);
  });
});
