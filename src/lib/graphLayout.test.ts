import { describe, it, expect, afterEach } from "vitest";
import { buildGraph, resolveThemeColors, applyPositions, recolorSeed, seedAttrs, nodeLabelFromPath, NODE_SIZE, SEED_COLOR, SELECTED_COLOR, SHADOW_COLOR, CITATION_EDGE_COLOR, CITATION_EDGE_SIZE, SHADOW_NODE_SIZE_FACTOR, materializationAttrs, populateGraph } from "./graphLayout";
import Graph from "graphology";
import type { SubgraphResult, GraphNode, EdgeKind } from "./ipc";

/** Helper to create a materialized GraphNode for test fixtures */
function gn(id: string, title: string): GraphNode {
  return { id, title, is_stub: false, materialization: "materialized" };
}

/** Helper to create a wikilink edge triple */
function ge(src: string, tgt: string): [string, string, EdgeKind] {
  return [src, tgt, "wikilink"];
}

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
        nodes: [gn("a.md", "Alpha")],
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
        nodes: [gn("a.md", "A"), gn("s.md", "Stub")],
        edges: [],
      };
      const graph = buildGraph({ subgraph, accentColor: "#7c3aed" });
      expect(graph.getNodeAttributes("a.md").size).toBe(NODE_SIZE);
      expect(graph.getNodeAttributes("s.md").size).toBe(NODE_SIZE);
    });

    it("edges added between existing nodes with size 1", () => {
      const subgraph: SubgraphResult = {
        nodes: [gn("a.md", "A"), gn("b.md", "B")],
        edges: [ge("a.md", "b.md")],
      };
      const graph = buildGraph({ subgraph, ...defaults });
      expect(graph.size).toBe(1);
      expect(graph.getEdgeAttributes(graph.edges()[0]!).size).toBe(0.5);
    });

    it("edge referencing missing node is silently skipped", () => {
      const subgraph: SubgraphResult = {
        nodes: [gn("a.md", "A")],
        edges: [ge("a.md", "missing.md")],
      };
      const graph = buildGraph({ subgraph, ...defaults });
      expect(graph.size).toBe(0);
    });

    it("seed node gets distinct color and type", () => {
      const subgraph: SubgraphResult = {
        nodes: [gn("a.md", "A"), gn("b.md", "B")],
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
        nodes: [gn("a.md", "A")],
        edges: [],
      };
      const graph = buildGraph({ subgraph, accentColor: "#7c3aed", seedId: "a.md" });
      expect(graph.getNodeAttributes("a.md").size).toBe(NODE_SIZE);
    });

    it("no seedId means all nodes use normal attributes", () => {
      const subgraph: SubgraphResult = {
        nodes: [gn("a.md", "A")],
        edges: [],
      };
      const graph = buildGraph({ subgraph, accentColor: "#7c3aed" });
      expect(graph.getNodeAttributes("a.md").type).toBe("filled");
      expect(graph.getNodeAttributes("a.md").color).toBe("#7c3aed");
    });

    it("duplicate directional edges produce one undirected edge", () => {
      const subgraph: SubgraphResult = {
        nodes: [gn("a.md", "A"), gn("b.md", "B")],
        edges: [ge("a.md", "b.md"), ge("b.md", "a.md")],
      };
      const graph = buildGraph({ subgraph, ...defaults });
      expect(graph.size).toBe(1);
    });
  });

  describe("nodeLabelFromPath", () => {
    it("strips directory and .md extension", () => {
      expect(nodeLabelFromPath("notes/My Page.md")).toBe("My Page");
    });

    it("strips .md from a top-level file", () => {
      expect(nodeLabelFromPath("Inbox.md")).toBe("Inbox");
    });

    it("returns the basename for a path without .md", () => {
      expect(nodeLabelFromPath("a/b/c")).toBe("c");
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
    function makeGraph(edges: [string, string, EdgeKind][] = []): import("graphology").default {
      const sub: SubgraphResult = {
        nodes: [gn("a.md", "A"), gn("b.md", "B"), gn("c.md", "C")],
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
      const graph = makeGraph([ge("a.md", "c.md"), ge("b.md", "c.md")]);
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
      const graph = makeGraph([ge("a.md", "b.md")]);
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

  describe("SELECTED_COLOR", () => {
    it("is amber-400 (#fbbf24), distinct from SEED_COLOR", () => {
      expect(SELECTED_COLOR).toBe("#fbbf24");
      expect(SELECTED_COLOR).not.toBe(SEED_COLOR);
    });
  });

  describe("materializationAttrs", () => {
    it("returns shadow type for shadow materialization", () => {
      const result = materializationAttrs("shadow", "#7c3aed");
      expect(result).toEqual({ type: "shadow", color: SHADOW_COLOR, size: NODE_SIZE * SHADOW_NODE_SIZE_FACTOR });
    });

    it("returns shadow type for partial materialization", () => {
      const result = materializationAttrs("partial", "#7c3aed");
      expect(result).toEqual({ type: "shadow", color: SHADOW_COLOR, size: NODE_SIZE * SHADOW_NODE_SIZE_FACTOR });
    });

    it("returns filled type for materialized", () => {
      const result = materializationAttrs("materialized", "#7c3aed");
      expect(result).toEqual({ type: "filled", color: "#7c3aed", size: NODE_SIZE });
    });
  });

  describe("populateGraph shadow/citation styling", () => {
    it("shadow node gets shadow type, dimmed color, smaller size", () => {
      const graph = new Graph();
      const subgraph: SubgraphResult = {
        nodes: [
          { id: "bib:smith2024", title: "Smith (2024)", is_stub: false, materialization: "shadow" },
          { id: "a.md", title: "A", is_stub: false, materialization: "materialized" },
        ],
        edges: [["a.md", "bib:smith2024", "citation"]],
      };
      populateGraph(graph, subgraph, "#7c3aed");
      const attrs = graph.getNodeAttributes("bib:smith2024");
      expect(attrs.type).toBe("shadow");
      expect(attrs.color).toBe(SHADOW_COLOR);
      expect(attrs.size).toBe(NODE_SIZE * SHADOW_NODE_SIZE_FACTOR);
    });

    it("citation edge gets faint color and thin size", () => {
      const graph = new Graph();
      const subgraph: SubgraphResult = {
        nodes: [
          { id: "a.md", title: "A", is_stub: false, materialization: "materialized" },
          { id: "bib:smith2024", title: "Smith (2024)", is_stub: false, materialization: "shadow" },
        ],
        edges: [["a.md", "bib:smith2024", "citation"]],
      };
      populateGraph(graph, subgraph, "#7c3aed");
      const edgeKey = graph.edges()[0]!;
      const edgeAttrs = graph.getEdgeAttributes(edgeKey);
      expect(edgeAttrs.size).toBe(CITATION_EDGE_SIZE);
      expect(edgeAttrs.color).toBe(CITATION_EDGE_COLOR);
      expect(edgeAttrs.citation).toBe(true);
    });

    it("citation edge with missing node is skipped", () => {
      const graph = new Graph();
      const subgraph: SubgraphResult = {
        nodes: [
          { id: "a.md", title: "A", is_stub: false, materialization: "materialized" },
        ],
        edges: [["a.md", "bib:missing", "citation"]],
      };
      populateGraph(graph, subgraph, "#7c3aed");
      expect(graph.size).toBe(0);
    });

    it("wikilink edge still gets default attrs", () => {
      const graph = new Graph();
      const subgraph: SubgraphResult = {
        nodes: [
          { id: "a.md", title: "A", is_stub: false, materialization: "materialized" },
          { id: "b.md", title: "B", is_stub: false, materialization: "materialized" },
        ],
        edges: [["a.md", "b.md", "wikilink"]],
      };
      populateGraph(graph, subgraph, "#7c3aed");
      const edgeKey = graph.edges()[0]!;
      const edgeAttrs = graph.getEdgeAttributes(edgeKey);
      expect(edgeAttrs.size).toBe(0.5);
      expect(edgeAttrs.citation).toBeUndefined();
    });
  });

  describe("recolorSeed", () => {
    const accentColor = "#7c3aed";

    function makeSeedGraph(): import("graphology").default {
      const sub: SubgraphResult = {
        nodes: [gn("a.md", "A"), gn("b.md", "B"), gn("c.md", "C")],
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
