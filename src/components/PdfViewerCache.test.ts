import { describe, it, expect } from "vitest";
import { cacheGet, cacheSet, cacheKey } from "./PdfViewer";
import type { RenderedPage } from "../lib/ipc";

function page(idx: number): RenderedPage {
  return {
    page_index: idx,
    png_path: `/tmp/page_${idx}.png`,
    width: 100,
    height: 200,
  };
}

describe("PdfViewer cache helpers", () => {
  it("cacheKey combines page index and dpi", () => {
    expect(cacheKey(3, 144)).toBe("3_144");
  });

  it("cacheSet stores a value retrievable by cacheGet (round-trip identity)", () => {
    const m = new Map<string, RenderedPage>();
    const v = page(0);
    cacheSet(m, "k", v);
    expect(cacheGet(m, "k")).toBe(v);
  });

  it("cacheSet overwrites an existing key without growing the map", () => {
    const m = new Map<string, RenderedPage>();
    const v1 = page(0);
    const v2 = page(0);
    cacheSet(m, "k", v1);
    cacheSet(m, "k", v2);
    expect(cacheGet(m, "k")).toBe(v2);
    expect(m.size).toBe(1);
  });

  it("cacheGet returns undefined for a missing key", () => {
    const m = new Map<string, RenderedPage>();
    expect(cacheGet(m, "missing")).toBeUndefined();
  });

  it("cacheGet does not mutate insertion order on a hit (no LRU promotion)", () => {
    const m = new Map<string, RenderedPage>();
    cacheSet(m, "a", page(0));
    cacheSet(m, "b", page(1));
    cacheSet(m, "c", page(2));
    expect([...m.keys()]).toEqual(["a", "b", "c"]);

    cacheGet(m, "a");

    expect([...m.keys()]).toEqual(["a", "b", "c"]);
    expect(m.size).toBe(3);
  });
});
