import { describe, it, expect, beforeEach, vi } from "vitest";
import Graph from "graphology";
import { getCacheKey, savePositions, loadPositions } from "./graphPositionCache";

describe("graphPositionCache", () => {
  describe("getCacheKey", () => {
    it("returns correct key for full mode", () => {
      expect(getCacheKey("/path/to/ws", "full")).toBe("lit-graph-pos:/path/to/ws:full");
    });

    it("returns correct key for local mode", () => {
      expect(getCacheKey("/path/to/ws", "local")).toBe("lit-graph-pos:/path/to/ws:local");
    });

    it("different workspace paths produce different keys", () => {
      const key1 = getCacheKey("/ws1", "full");
      const key2 = getCacheKey("/ws2", "full");
      expect(key1).not.toBe(key2);
    });
  });

  describe("savePositions", () => {
    beforeEach(() => {
      localStorage.clear();
    });

    it("writes node positions from a Graphology graph to localStorage", () => {
      const graph = new Graph();
      graph.addNode("a.md", { x: 10, y: 20, label: "A" });
      graph.addNode("b.md", { x: 30, y: 40, label: "B" });
      graph.addNode("c.md", { x: 50, y: 60, label: "C" });

      const key = "lit-graph-pos:/ws:full";
      savePositions(key, graph);

      const stored = JSON.parse(localStorage.getItem(key)!);
      expect(stored.positions).toEqual({
        "a.md": { x: 10, y: 20 },
        "b.md": { x: 30, y: 40 },
        "c.md": { x: 50, y: 60 },
      });
    });

    it("does not throw when localStorage quota is exceeded", () => {
      const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
        throw new DOMException("QuotaExceededError");
      });

      const graph = new Graph();
      graph.addNode("a.md", { x: 10, y: 20 });

      expect(() => savePositions("key", graph)).not.toThrow();
      spy.mockRestore();
    });
  });

  describe("loadPositions", () => {
    beforeEach(() => {
      localStorage.clear();
    });

    it("returns cached positions when data exists", () => {
      const key = "lit-graph-pos:/ws:full";
      const data = {
        positions: { "a.md": { x: 10, y: 20 }, "b.md": { x: 30, y: 40 } },
        timestamp: Date.now(),
      };
      localStorage.setItem(key, JSON.stringify(data));

      const result = loadPositions(key);
      expect(result).toEqual(data.positions);
    });

    it("returns null for nonexistent key", () => {
      expect(loadPositions("nonexistent")).toBeNull();
    });

    it("returns null for expired cache (>7 days)", () => {
      const key = "lit-graph-pos:/ws:full";
      const eightDaysAgo = Date.now() - 8 * 24 * 60 * 60 * 1000;
      const data = {
        positions: { "a.md": { x: 10, y: 20 } },
        timestamp: eightDaysAgo,
      };
      localStorage.setItem(key, JSON.stringify(data));

      expect(loadPositions(key)).toBeNull();
    });
  });
});
