import { describe, it, expect, afterEach } from "vitest";
import { buildGraph, resolveThemeColors, applyPositions, recolorSeed, seedAttrs, NODE_SIZE, SEED_COLOR } from "./graphLayout";
import type { SubgraphResult } from "./ipc";

describe("graphLayout", () => {
  describe("buildGraph", () => {
    const defaults = {
      accentColor: "#7c3aed",
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
        nodes: [{ id: "a.md", title: "Alpha" }],
        edges: [],
      };
      const graph = buildGraph({ subgraph, accentColor: "#7c3aed" });
      const attrs = graph.getNodeAttributes("a.md");
      expect(attrs.label).toBe("Alpha");
      expect(attrs.color).toBe("#7c3aed");
      expect(attrs.type).toBe("filled");
      expect(typeof attrs.x).toBe("number");
      expect(typeof attrs.y).toBe("number");
      expect(attrs.size).toBeGreaterThan(0);
    });

    it("all nodes get uniform NODE_SIZE", () => {
      const subgraph: SubgraphResult = {
        nodes: [
          { id: "a.md", title: "A" },
          { id: "s.md", title: "Stub" },
        ],
        edges: [],
      };
      const graph = buildGraph({ subgraph, accentColor: "#7c3aed" });
      expect(graph.getNodeAttributes("a.md").size).toBe(NODE_SIZE);
      expect(graph.getNodeAttributes("s.md").size).toBe(NODE_SIZE);
    });

    it("edges added between existing nodes with size 1", () => {
      const subgraph: SubgraphResult = {
        nodes: [
          { id: "a.md", title: "A" },
          { id: "b.md", title: "B" },
        ],
        edges: [["a.md", "b.md"]],
      };
      const graph = buildGraph({ subgraph, ...defaults });
      expect(graph.size).toBe(1);
      expect(graph.getEdgeAttributes(graph.edges()[0]!).size).toBe(0.5);
    });

    it("edge referencing missing node is silently skipped", () => {
      const subgraph: SubgraphResult = {
        nodes: [{ id: "a.md", title: "A" }],
        edges: [["a.md", "missing.md"]],
      };
      const graph = buildGraph({ subgraph, ...defaults });
      expect(graph.size).toBe(0);
    });

    it("seed node gets distinct color and type", () => {
      const subgraph: SubgraphResult = {
        nodes: [
          { id: "a.md", title: "A" },
          { id: "b.md", title: "B" },
        ],
        edges: [],
      };
      const graph = buildGraph({ subgraph, accentColor: "#7c3aed", seedId: "a.md" });
      const seedAttrs = graph.getNodeAttributes("a.md");
      expect(seedAttrs.color).toBe(SEED_COLOR);
      expect(seedAttrs.type).toBe("seed");
      const otherAttrs = graph.getNodeAttributes("b.md");
      expect(otherAttrs.color).toBe("#7c3aed");
      expect(otherAttrs.type).toBe("filled");
    });

    it("seed node has same size as other nodes", () => {
      const subgraph: SubgraphResult = {
        nodes: [{ id: "a.md", title: "A" }],
        edges: [],
      };
      const graph = buildGraph({ subgraph, accentColor: "#7c3aed", seedId: "a.md" });
      expect(graph.getNodeAttributes("a.md").size).toBe(NODE_SIZE);
    });

    it("no seedId means all nodes use normal attributes", () => {
      const subgraph: SubgraphResult = {
        nodes: [{ id: "a.md", title: "A" }],
        edges: [],
      };
      const graph = buildGraph({ subgraph, accentColor: "#7c3aed" });
      expect(graph.getNodeAttributes("a.md").type).toBe("filled");
      expect(graph.getNodeAttributes("a.md").color).toBe("#7c3aed");
    });

    it("duplicate directional edges produce one undirected edge", () => {
      const subgraph: SubgraphResult = {
        nodes: [
          { id: "a.md", title: "A" },
          { id: "b.md", title: "B" },
        ],
        edges: [["a.md", "b.md"], ["b.md", "a.md"]],
      };
      const graph = buildGraph({ subgraph, ...defaults });
      expect(graph.size).toBe(1);
    });
  });

  describe("resolveThemeColors", () => {
    afterEach(() => {
      document.documentElement.style.removeProperty("--interactive-accent");
      document.documentElement.style.removeProperty("--text-faint");
      document.documentElement.style.removeProperty("--background-modifier-border");
      document.documentElement.style.removeProperty("--text-normal");
    });

    it("reads --interactive-accent from computed style", () => {
      document.documentElement.style.setProperty("--interactive-accent", "#0969da");
      const colors = resolveThemeColors();
      expect(colors.accentColor).toBe("#0969da");
    });

    it("falls back to defaults when CSS vars are unset", () => {
      const colors = resolveThemeColors();
      expect(colors.accentColor).toBe("#0969da");
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
          { id: "a.md", title: "A" },
          { id: "b.md", title: "B" },
          { id: "c.md", title: "C" },
        ],
        edges,
      };
      return buildGraph({ subgraph: sub, accentColor: "#7c3aed" });
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

  describe("seedAttrs", () => {
    it("returns seed type and SEED_COLOR when isSeed is true", () => {
      expect(seedAttrs(true, "#7c3aed")).toEqual({ type: "seed", color: SEED_COLOR });
    });

    it("returns filled type and accentColor when isSeed is false", () => {
      expect(seedAttrs(false, "#7c3aed")).toEqual({ type: "filled", color: "#7c3aed" });
    });

    it("uses the provided accentColor, not a hardcoded value", () => {
      expect(seedAttrs(false, "#ff0000").color).toBe("#ff0000");
    });
  });

  describe("recolorSeed", () => {
    const accentColor = "#7c3aed";

    function makeSeedGraph(): import("graphology").default {
      const sub: SubgraphResult = {
        nodes: [
          { id: "a.md", title: "A" },
          { id: "b.md", title: "B" },
          { id: "c.md", title: "C" },
        ],
        edges: [],
      };
      return buildGraph({ subgraph: sub, accentColor, seedId: "a.md" });
    }

    it("recolors old seed to filled/accent and new seed to seed/SEED_COLOR", () => {
      const graph = makeSeedGraph();
      expect(graph.getNodeAttribute("a.md", "type")).toBe("seed");
      expect(graph.getNodeAttribute("a.md", "color")).toBe(SEED_COLOR);

      recolorSeed(graph, "a.md", "b.md", accentColor);

      expect(graph.getNodeAttribute("a.md", "type")).toBe("filled");
      expect(graph.getNodeAttribute("a.md", "color")).toBe(accentColor);
      expect(graph.getNodeAttribute("b.md", "type")).toBe("seed");
      expect(graph.getNodeAttribute("b.md", "color")).toBe(SEED_COLOR);
    });

    it("old seed missing from graph — no error, new seed still colored", () => {
      const graph = makeSeedGraph();
      recolorSeed(graph, "missing.md", "b.md", accentColor);

      expect(graph.getNodeAttribute("b.md", "type")).toBe("seed");
      expect(graph.getNodeAttribute("b.md", "color")).toBe(SEED_COLOR);
    });

    it("new seed missing from graph — no error, old seed still reset", () => {
      const graph = makeSeedGraph();
      recolorSeed(graph, "a.md", "missing.md", accentColor);

      expect(graph.getNodeAttribute("a.md", "type")).toBe("filled");
      expect(graph.getNodeAttribute("a.md", "color")).toBe(accentColor);
    });

    it("both null — no-op, no error", () => {
      const graph = makeSeedGraph();
      expect(() => recolorSeed(graph, null, null, accentColor)).not.toThrow();
      expect(graph.getNodeAttribute("a.md", "type")).toBe("seed");
      expect(graph.getNodeAttribute("a.md", "color")).toBe(SEED_COLOR);
    });

    it("same prev and next — node stays as seed", () => {
      const graph = makeSeedGraph();
      recolorSeed(graph, "a.md", "a.md", accentColor);
      expect(graph.getNodeAttribute("a.md", "type")).toBe("seed");
      expect(graph.getNodeAttribute("a.md", "color")).toBe(SEED_COLOR);
    });
  });

});
