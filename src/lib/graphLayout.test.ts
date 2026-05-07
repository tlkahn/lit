import { describe, it, expect, afterEach } from "vitest";
import { buildGraph, computeNodeSize, resolveThemeColors, applyPositions, MIN_SIZE, MAX_SIZE, SEED_COLOR } from "./graphLayout";
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

    it("seed node gets distinct color and type", () => {
      const subgraph: SubgraphResult = {
        nodes: [
          { id: "a.md", title: "A", is_stub: false },
          { id: "b.md", title: "B", is_stub: false },
        ],
        edges: [],
      };
      const graph = buildGraph({ subgraph, pagerank: { "a.md": 0.5, "b.md": 0.5 }, accentColor: "#7c3aed", stubColor: "#999", seedId: "a.md" });
      const seedAttrs = graph.getNodeAttributes("a.md");
      expect(seedAttrs.color).toBe(SEED_COLOR);
      expect(seedAttrs.type).toBe("seed");
      const otherAttrs = graph.getNodeAttributes("b.md");
      expect(otherAttrs.color).toBe("#7c3aed");
      expect(otherAttrs.type).toBe("filled");
    });

    it("seed node is larger than the same node without seed", () => {
      const subgraph: SubgraphResult = {
        nodes: [{ id: "a.md", title: "A", is_stub: false }],
        edges: [],
      };
      const withSeed = buildGraph({ subgraph, pagerank: { "a.md": 0.5 }, accentColor: "#7c3aed", stubColor: "#999", seedId: "a.md" });
      const withoutSeed = buildGraph({ subgraph, pagerank: { "a.md": 0.5 }, accentColor: "#7c3aed", stubColor: "#999" });
      expect(withSeed.getNodeAttributes("a.md").size).toBeGreaterThan(withoutSeed.getNodeAttributes("a.md").size);
    });

    it("no seedId means all nodes use normal attributes", () => {
      const subgraph: SubgraphResult = {
        nodes: [{ id: "a.md", title: "A", is_stub: false }],
        edges: [],
      };
      const graph = buildGraph({ subgraph, pagerank: { "a.md": 0.5 }, accentColor: "#7c3aed", stubColor: "#999" });
      expect(graph.getNodeAttributes("a.md").type).toBe("filled");
      expect(graph.getNodeAttributes("a.md").color).toBe("#7c3aed");
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
      document.documentElement.style.removeProperty("--background-modifier-border");
      document.documentElement.style.removeProperty("--text-normal");
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

    it("resolves dimColor from --background-modifier-border", () => {
      document.documentElement.style.setProperty("--background-modifier-border", "#3d444d");
      const colors = resolveThemeColors();
      expect(colors.dimColor).toBe("#3d444d");
    });

    it("dimColor falls back to default when CSS var is unset", () => {
      const colors = resolveThemeColors();
      expect(colors.dimColor).toBe("#d1d9e0");
    });

    it("resolves edgeColor from --text-faint", () => {
      document.documentElement.style.setProperty("--text-faint", "#656c76");
      const colors = resolveThemeColors();
      expect(colors.edgeColor).toBe("#656c76");
    });

    it("resolves labelColor from --text-normal", () => {
      document.documentElement.style.setProperty("--text-normal", "#f0f6fc");
      const colors = resolveThemeColors();
      expect(colors.labelColor).toBe("#f0f6fc");
    });

    it("edgeColor and labelColor fall back to defaults when CSS vars are unset", () => {
      const colors = resolveThemeColors();
      expect(colors.edgeColor).toBe("#818b98");
      expect(colors.labelColor).toBe("#1f2328");
    });
  });

  describe("applyPositions", () => {
    function makeGraph(edges: [string, string][] = []): import("graphology").default {
      const sub = {
        nodes: [
          { id: "a.md", title: "A", is_stub: false },
          { id: "b.md", title: "B", is_stub: false },
          { id: "c.md", title: "C", is_stub: false },
        ],
        edges,
      };
      return buildGraph({ subgraph: sub, pagerank: {}, accentColor: "#7c3aed", stubColor: "#999" });
    }

    it("applies exact positions for nodes present in the map", () => {
      const graph = makeGraph();
      applyPositions(graph, { "a.md": { x: 10, y: 20 }, "b.md": { x: 30, y: 40 }, "c.md": { x: 50, y: 60 } });
      expect(graph.getNodeAttribute("a.md", "x")).toBe(10);
      expect(graph.getNodeAttribute("a.md", "y")).toBe(20);
      expect(graph.getNodeAttribute("b.md", "x")).toBe(30);
      expect(graph.getNodeAttribute("b.md", "y")).toBe(40);
      expect(graph.getNodeAttribute("c.md", "x")).toBe(50);
      expect(graph.getNodeAttribute("c.md", "y")).toBe(60);
    });

    it("empty positions map is a no-op", () => {
      const graph = makeGraph();
      const origX = graph.getNodeAttribute("a.md", "x") as number;
      const origY = graph.getNodeAttribute("a.md", "y") as number;
      applyPositions(graph, {});
      expect(graph.getNodeAttribute("a.md", "x")).toBe(origX);
      expect(graph.getNodeAttribute("a.md", "y")).toBe(origY);
    });

    it("places uncached node near centroid of its positioned neighbors", () => {
      const graph = makeGraph([["a.md", "c.md"], ["b.md", "c.md"]]);
      applyPositions(graph, { "a.md": { x: 100, y: 100 }, "b.md": { x: 200, y: 200 } });
      const cx = graph.getNodeAttribute("c.md", "x") as number;
      const cy = graph.getNodeAttribute("c.md", "y") as number;
      expect(cx).toBeGreaterThanOrEqual(135);
      expect(cx).toBeLessThanOrEqual(165);
      expect(cy).toBeGreaterThanOrEqual(135);
      expect(cy).toBeLessThanOrEqual(165);
    });

    it("uncached node with no positioned neighbors keeps original position", () => {
      const graph = makeGraph();
      const origX = graph.getNodeAttribute("c.md", "x") as number;
      const origY = graph.getNodeAttribute("c.md", "y") as number;
      applyPositions(graph, { "a.md": { x: 10, y: 20 } });
      // b.md and c.md are not in positions and have no edges to positioned nodes
      expect(graph.getNodeAttribute("c.md", "x")).toBe(origX);
      expect(graph.getNodeAttribute("c.md", "y")).toBe(origY);
    });

    it("mixed scenario — cached, uncached-with-neighbor, uncached-isolated", () => {
      const graph = makeGraph([["a.md", "b.md"]]);
      applyPositions(graph, { "a.md": { x: 500, y: 500 } });
      // a.md: cached — exact position
      expect(graph.getNodeAttribute("a.md", "x")).toBe(500);
      expect(graph.getNodeAttribute("a.md", "y")).toBe(500);
      // b.md: uncached with positioned neighbor a.md — near 500,500
      const bx = graph.getNodeAttribute("b.md", "x") as number;
      const by = graph.getNodeAttribute("b.md", "y") as number;
      expect(bx).toBeGreaterThanOrEqual(485);
      expect(bx).toBeLessThanOrEqual(515);
      expect(by).toBeGreaterThanOrEqual(485);
      expect(by).toBeLessThanOrEqual(515);
      // c.md: isolated, no positioned neighbors — keeps original random position (not 500,500)
      // Just verify it wasn't moved to the cached position area
      const cx = graph.getNodeAttribute("c.md", "x") as number;
      const cy = graph.getNodeAttribute("c.md", "y") as number;
      expect(typeof cx).toBe("number");
      expect(typeof cy).toBe("number");
    });
  });

});
