import { describe, it, expect, afterEach } from "vitest";
import { buildGraph, computeNodeSize, resolveThemeColors, MIN_SIZE, MAX_SIZE } from "./graphLayout";
import type { SubgraphResult } from "./ipc";

describe("graphLayout", () => {
  describe("buildGraph", () => {
    const defaults = {
      pagerank: {} as Record<string, number>,
      accentColor: "#7c3aed",
      stubColor: "#999",
    };

    it("empty subgraph returns empty graph", () => {
      const graph = buildGraph({
        subgraph: { nodes: [], edges: [] },
        ...defaults,
      });
      expect(graph.order).toBe(0);
      expect(graph.size).toBe(0);
    });

    it("single real node has correct attributes", () => {
      const subgraph: SubgraphResult = {
        nodes: [{ id: "a.md", title: "Alpha", is_stub: false }],
        edges: [],
      };
      const graph = buildGraph({ subgraph, pagerank: { "a.md": 0.5 }, accentColor: "#7c3aed", stubColor: "#999" });
      const attrs = graph.getNodeAttributes("a.md");
      expect(attrs.label).toBe("Alpha");
      expect(attrs.color).toBe("#7c3aed");
      expect(attrs.type).toBe("filled");
      expect(typeof attrs.x).toBe("number");
      expect(typeof attrs.y).toBe("number");
      expect(attrs.size).toBeGreaterThan(0);
    });

    it("stub node has hollow type and stub color", () => {
      const subgraph: SubgraphResult = {
        nodes: [{ id: "s.md", title: "Stub", is_stub: true }],
        edges: [],
      };
      const graph = buildGraph({ subgraph, pagerank: { "s.md": 0.9 }, accentColor: "#7c3aed", stubColor: "#999" });
      const attrs = graph.getNodeAttributes("s.md");
      expect(attrs.type).toBe("hollow");
      expect(attrs.color).toBe("#999");
    });

    it("stub always gets MIN_SIZE regardless of pagerank", () => {
      const subgraph: SubgraphResult = {
        nodes: [{ id: "s.md", title: "Stub", is_stub: true }],
        edges: [],
      };
      const graph = buildGraph({ subgraph, pagerank: { "s.md": 1.0 }, accentColor: "#7c3aed", stubColor: "#999" });
      expect(graph.getNodeAttributes("s.md").size).toBe(MIN_SIZE);
    });

    it("higher pagerank produces larger size", () => {
      const subgraph: SubgraphResult = {
        nodes: [
          { id: "a.md", title: "A", is_stub: false },
          { id: "b.md", title: "B", is_stub: false },
        ],
        edges: [],
      };
      const graph = buildGraph({ subgraph, pagerank: { "a.md": 0.1, "b.md": 0.9 }, accentColor: "#7c3aed", stubColor: "#999" });
      expect(graph.getNodeAttributes("b.md").size).toBeGreaterThan(graph.getNodeAttributes("a.md").size);
    });

    it("edges added between existing nodes with size 1", () => {
      const subgraph: SubgraphResult = {
        nodes: [
          { id: "a.md", title: "A", is_stub: false },
          { id: "b.md", title: "B", is_stub: false },
        ],
        edges: [["a.md", "b.md"]],
      };
      const graph = buildGraph({ subgraph, ...defaults });
      expect(graph.size).toBe(1);
      expect(graph.getEdgeAttributes(graph.edges()[0]!).size).toBe(1);
    });

    it("edge referencing missing node is silently skipped", () => {
      const subgraph: SubgraphResult = {
        nodes: [{ id: "a.md", title: "A", is_stub: false }],
        edges: [["a.md", "missing.md"]],
      };
      const graph = buildGraph({ subgraph, ...defaults });
      expect(graph.size).toBe(0);
    });

    it("duplicate directional edges produce one undirected edge", () => {
      const subgraph: SubgraphResult = {
        nodes: [
          { id: "a.md", title: "A", is_stub: false },
          { id: "b.md", title: "B", is_stub: false },
        ],
        edges: [["a.md", "b.md"], ["b.md", "a.md"]],
      };
      const graph = buildGraph({ subgraph, ...defaults });
      expect(graph.size).toBe(1);
    });
  });

  describe("computeNodeSize", () => {
    it("zero pagerank returns MIN_SIZE", () => {
      expect(computeNodeSize(0, 0.5)).toBe(MIN_SIZE);
    });

    it("max pagerank returns MAX_SIZE", () => {
      expect(computeNodeSize(0.5, 0.5)).toBeCloseTo(MAX_SIZE, 1);
    });

    it("result is between MIN_SIZE and MAX_SIZE", () => {
      const size = computeNodeSize(0.3, 1.0);
      expect(size).toBeGreaterThanOrEqual(MIN_SIZE);
      expect(size).toBeLessThanOrEqual(MAX_SIZE);
    });
  });

  describe("resolveThemeColors", () => {
    afterEach(() => {
      document.documentElement.style.removeProperty("--interactive-accent");
      document.documentElement.style.removeProperty("--text-faint");
    });

    it("reads --interactive-accent and --text-faint from computed style", () => {
      document.documentElement.style.setProperty("--interactive-accent", "#0969da");
      document.documentElement.style.setProperty("--text-faint", "#818b98");
      const colors = resolveThemeColors();
      expect(colors.accentColor).toBe("#0969da");
      expect(colors.stubColor).toBe("#818b98");
    });

    it("falls back to defaults when CSS vars are unset", () => {
      const colors = resolveThemeColors();
      expect(colors.accentColor).toBe("#0969da");
      expect(colors.stubColor).toBe("#818b98");
    });
  });
});
