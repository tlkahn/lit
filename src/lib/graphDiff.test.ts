import { describe, it, expect } from "vitest";
import Graph from "graphology";
import type { SubgraphResult, GraphNode, EdgeKind } from "./ipc";
import { computeDiff, applyDiff } from "./graphDiff";
import { SHADOW_COLOR, CITATION_EDGE_SIZE, CITATION_EDGE_COLOR, CARDBOX_EDGE_SIZE, CARDBOX_EDGE_COLOR, NODE_SIZE, SHADOW_NODE_SIZE_FACTOR } from "./graphLayout";

/** Helper to create a materialized GraphNode for test fixtures */
function n(id: string, title: string): GraphNode {
  return { id, title, is_stub: false, materialization: "materialized" };
}

/** Helper to create a wikilink edge triple */
function e(src: string, tgt: string): [string, string, EdgeKind] {
  return [src, tgt, "wikilink"];
}

describe("computeDiff", () => {
  it("returns empty diff when graph and subgraph are identical", () => {
    const graph = new Graph();
    graph.addNode("a.md", { label: "A" });
    graph.addNode("b.md", { label: "B" });
    graph.mergeUndirectedEdge("a.md", "b.md");

    const subgraph: SubgraphResult = {
      nodes: [n("a.md", "A"), n("b.md", "B")],
      edges: [e("a.md", "b.md")],
    };

    const diff = computeDiff(graph, subgraph);

    expect(diff.addedNodes).toEqual([]);
    expect(diff.removedNodes).toEqual([]);
    expect(diff.updatedNodes).toEqual([]);
    expect(diff.addedEdges).toEqual([]);
    expect(diff.removedEdges).toEqual([]);
    expect(diff.isMajorChange).toBe(false);
  });

  it("detects added node", () => {
    const graph = new Graph();
    graph.addNode("a.md", { label: "A" });
    graph.addNode("b.md", { label: "B" });

    const subgraph: SubgraphResult = {
      nodes: [n("a.md", "A"), n("b.md", "B"), n("c.md", "C")],
      edges: [],
    };

    const diff = computeDiff(graph, subgraph);

    expect(diff.addedNodes).toEqual([n("c.md", "C")]);
    expect(diff.removedNodes).toEqual([]);
  });

  it("detects removed node", () => {
    const graph = new Graph();
    graph.addNode("a.md", { label: "A" });
    graph.addNode("b.md", { label: "B" });
    graph.addNode("c.md", { label: "C" });

    const subgraph: SubgraphResult = {
      nodes: [n("a.md", "A"), n("b.md", "B")],
      edges: [],
    };

    const diff = computeDiff(graph, subgraph);

    expect(diff.addedNodes).toEqual([]);
    expect(diff.removedNodes).toEqual(["c.md"]);
  });

  it("detects title change", () => {
    const graph = new Graph();
    graph.addNode("a.md", { label: "Old Title" });

    const subgraph: SubgraphResult = {
      nodes: [n("a.md", "New Title")],
      edges: [],
    };

    const diff = computeDiff(graph, subgraph);

    expect(diff.updatedNodes).toEqual([{ id: "a.md", title: "New Title" }]);
  });

  it("detects added edges", () => {
    const graph = new Graph();
    graph.addNode("a.md", { label: "A" });
    graph.addNode("b.md", { label: "B" });
    graph.addNode("c.md", { label: "C" });
    graph.mergeUndirectedEdge("a.md", "b.md");

    const subgraph: SubgraphResult = {
      nodes: [n("a.md", "A"), n("b.md", "B"), n("c.md", "C")],
      edges: [e("a.md", "b.md"), e("a.md", "c.md")],
    };

    const diff = computeDiff(graph, subgraph);

    expect(diff.addedEdges).toEqual([["a.md", "c.md", "wikilink"]]);
    expect(diff.removedEdges).toEqual([]);
  });

  it("detects removed edges", () => {
    const graph = new Graph();
    graph.addNode("a.md", { label: "A" });
    graph.addNode("b.md", { label: "B" });
    graph.addNode("c.md", { label: "C" });
    graph.mergeUndirectedEdge("a.md", "b.md");
    graph.mergeUndirectedEdge("a.md", "c.md");

    const subgraph: SubgraphResult = {
      nodes: [n("a.md", "A"), n("b.md", "B"), n("c.md", "C")],
      edges: [e("a.md", "b.md")],
    };

    const diff = computeDiff(graph, subgraph);

    expect(diff.addedEdges).toEqual([]);
    expect(diff.removedEdges).toEqual([["a.md", "c.md", "wikilink"]]);
  });

  it("flags isMajorChange when >50% nodes differ", () => {
    const graph = new Graph();
    for (let i = 0; i < 10; i++) {
      graph.addNode(`old${i}.md`, { label: `Old ${i}` });
    }

    const subgraph: SubgraphResult = {
      nodes: [
        n("old0.md", "Old 0"), n("old1.md", "Old 1"), n("old2.md", "Old 2"), n("old3.md", "Old 3"),
        n("new0.md", "New 0"), n("new1.md", "New 1"), n("new2.md", "New 2"),
        n("new3.md", "New 3"), n("new4.md", "New 4"), n("new5.md", "New 5"),
      ],
      edges: [],
    };

    const diff = computeDiff(graph, subgraph);

    // 6 removed + 6 added = 12 changes / 10 new nodes = 1.2 > 0.5
    expect(diff.isMajorChange).toBe(true);
  });

  it("does not flag isMajorChange for small diff", () => {
    const graph = new Graph();
    for (let i = 0; i < 10; i++) {
      graph.addNode(`n${i}.md`, { label: `N ${i}` });
    }

    const subgraph: SubgraphResult = {
      nodes: [
        ...Array.from({ length: 10 }, (_, i) => n(`n${i}.md`, `N ${i}`)),
        n("new.md", "New"),
      ],
      edges: [],
    };

    const diff = computeDiff(graph, subgraph);

    // 1 added / 11 new nodes ≈ 0.09 < 0.5
    expect(diff.isMajorChange).toBe(false);
  });
});

describe("applyDiff", () => {
  it("adds nodes to graph", () => {
    const graph = new Graph();
    graph.addNode("a.md", { label: "A", color: "#0969da", type: "filled", size: 10, x: 50, y: 50 });
    graph.addNode("b.md", { label: "B", color: "#0969da", type: "filled", size: 8, x: 60, y: 60 });

    const diff = {
      addedNodes: [n("c.md", "Page C")],
      removedNodes: [],
      updatedNodes: [],
      addedEdges: [] as [string, string, EdgeKind][],
      removedEdges: [] as [string, string, EdgeKind][],
      isMajorChange: false,
    };
    applyDiff(graph, diff, "#0969da");

    expect(graph.hasNode("c.md")).toBe(true);
    expect(graph.getNodeAttribute("c.md", "label")).toBe("Page C");
    expect(graph.getNodeAttribute("c.md", "type")).toBe("filled");
  });

  it("removes nodes and cascades edges", () => {
    const graph = new Graph();
    graph.addNode("a.md", { label: "A", color: "#0969da", type: "filled", size: 10, x: 50, y: 50 });
    graph.addNode("b.md", { label: "B", color: "#0969da", type: "filled", size: 8, x: 60, y: 60 });
    graph.addNode("c.md", { label: "C", color: "#0969da", type: "filled", size: 6, x: 70, y: 70 });
    graph.mergeUndirectedEdge("a.md", "c.md");

    const diff = {
      addedNodes: [],
      removedNodes: ["c.md"],
      updatedNodes: [],
      addedEdges: [] as [string, string, EdgeKind][],
      removedEdges: [] as [string, string, EdgeKind][],
      isMajorChange: false,
    };

    applyDiff(graph, diff, "#0969da");

    expect(graph.hasNode("c.md")).toBe(false);
    expect(graph.size).toBe(0);
  });

  it("updates titles", () => {
    const graph = new Graph();
    graph.addNode("a.md", { label: "Old", color: "#0969da", type: "filled", size: 10, x: 50, y: 50 });

    const diff = {
      addedNodes: [],
      removedNodes: [],
      updatedNodes: [{ id: "a.md", title: "New" }],
      addedEdges: [] as [string, string, EdgeKind][],
      removedEdges: [] as [string, string, EdgeKind][],
      isMajorChange: false,
    };

    applyDiff(graph, diff, "#0969da");

    expect(graph.getNodeAttribute("a.md", "label")).toBe("New");
  });

  it("adds and removes edges", () => {
    const graph = new Graph();
    graph.addNode("a.md", { label: "A", color: "#0969da", type: "filled", size: 10, x: 50, y: 50 });
    graph.addNode("b.md", { label: "B", color: "#0969da", type: "filled", size: 8, x: 60, y: 60 });
    graph.addNode("c.md", { label: "C", color: "#0969da", type: "filled", size: 6, x: 70, y: 70 });
    graph.mergeUndirectedEdge("a.md", "b.md");

    const diff = {
      addedNodes: [],
      removedNodes: [],
      updatedNodes: [],
      addedEdges: [["a.md", "c.md", "wikilink"]] as [string, string, EdgeKind][],
      removedEdges: [["a.md", "b.md", "wikilink"]] as [string, string, EdgeKind][],
      isMajorChange: false,
    };

    applyDiff(graph, diff, "#0969da");

    expect(graph.hasUndirectedEdge("a.md", "c.md")).toBe(true);
    expect(graph.hasUndirectedEdge("a.md", "b.md")).toBe(false);
  });

  it("positions new nodes near their existing neighbors", () => {
    const graph = new Graph();
    graph.addNode("a.md", { label: "A", color: "#0969da", type: "filled", size: 10, x: 50, y: 50 });

    const diff = {
      addedNodes: [n("c.md", "C")],
      removedNodes: [],
      updatedNodes: [],
      addedEdges: [["a.md", "c.md", "wikilink"]] as [string, string, EdgeKind][],
      removedEdges: [] as [string, string, EdgeKind][],
      isMajorChange: false,
    };

    applyDiff(graph, diff, "#0969da");

    const cx = graph.getNodeAttribute("c.md", "x") as number;
    const cy = graph.getNodeAttribute("c.md", "y") as number;
    const dist = Math.sqrt((cx - 50) ** 2 + (cy - 50) ** 2);
    expect(dist).toBeLessThan(30);
  });
});

describe("computeDiff EdgeKind support", () => {
  it("edge tuples include EdgeKind as third element", () => {
    const graph = new Graph();
    graph.addNode("a.md", { label: "A" });
    graph.addNode("b.md", { label: "B" });

    const subgraph: SubgraphResult = {
      nodes: [n("a.md", "A"), n("b.md", "B")],
      edges: [["a.md", "b.md", "wikilink"]],
    };

    const diff = computeDiff(graph, subgraph);

    expect(diff.addedEdges).toEqual([["a.md", "b.md", "wikilink"]]);
  });

  it("treats wikilink and citation edges between same pair as distinct", () => {
    const graph = new Graph();
    graph.addNode("a.md", { label: "A" });
    graph.addNode("b.md", { label: "B" });
    graph.mergeUndirectedEdge("a.md", "b.md", { citation: false });

    const subgraph: SubgraphResult = {
      nodes: [n("a.md", "A"), n("b.md", "B")],
      edges: [
        ["a.md", "b.md", "wikilink"],
        ["a.md", "b.md", "citation"],
      ],
    };

    const diff = computeDiff(graph, subgraph);

    // The wikilink edge already exists, so only the citation edge is added
    expect(diff.addedEdges).toEqual([["a.md", "b.md", "citation"]]);
    expect(diff.removedEdges).toEqual([]);
  });
});

describe("computeDiff cardbox EdgeKind support", () => {
  it("treats cardbox and wikilink edges between same pair as distinct", () => {
    const graph = new Graph();
    graph.addNode("a.md", { label: "A" });
    graph.addNode("b.md", { label: "B" });
    graph.mergeUndirectedEdge("a.md", "b.md", { cardbox: false });

    const subgraph: SubgraphResult = {
      nodes: [n("a.md", "A"), n("b.md", "B")],
      edges: [
        ["a.md", "b.md", "wikilink"],
        ["a.md", "b.md", "cardbox"],
      ],
    };

    const diff = computeDiff(graph, subgraph);
    expect(diff.addedEdges).toEqual([["a.md", "b.md", "cardbox"]]);
    expect(diff.removedEdges).toEqual([]);
  });

  it("detects cardbox edge kind from graph attributes", () => {
    const graph = new Graph();
    graph.addNode("a.md", { label: "A" });
    graph.addNode("b.md", { label: "B" });
    graph.mergeUndirectedEdge("a.md", "b.md", { cardbox: true });

    const subgraph: SubgraphResult = {
      nodes: [n("a.md", "A"), n("b.md", "B")],
      edges: [],
    };

    const diff = computeDiff(graph, subgraph);
    expect(diff.removedEdges).toEqual([["a.md", "b.md", "cardbox"]]);
  });
});

describe("applyDiff materialization and EdgeKind styling", () => {
  it("uses shadow type for shadow nodes", () => {
    const graph = new Graph();
    graph.addNode("a.md", { label: "A", color: "#0969da", type: "filled", size: 10, x: 50, y: 50 });

    const diff = {
      addedNodes: [{ id: "x.md", title: "X", is_stub: false, materialization: "shadow" as const }],
      removedNodes: [],
      updatedNodes: [],
      addedEdges: [] as [string, string, EdgeKind][],
      removedEdges: [] as [string, string, EdgeKind][],
      isMajorChange: false,
    };

    applyDiff(graph, diff, "#0969da");

    expect(graph.getNodeAttribute("x.md", "type")).toBe("shadow");
    expect(graph.getNodeAttribute("x.md", "color")).toBe(SHADOW_COLOR);
    expect(graph.getNodeAttribute("x.md", "size")).toBe(NODE_SIZE * SHADOW_NODE_SIZE_FACTOR);
  });

  it("uses filled type for materialized nodes", () => {
    const graph = new Graph();
    graph.addNode("a.md", { label: "A", color: "#0969da", type: "filled", size: 10, x: 50, y: 50 });

    const diff = {
      addedNodes: [n("y.md", "Y")],
      removedNodes: [],
      updatedNodes: [],
      addedEdges: [] as [string, string, EdgeKind][],
      removedEdges: [] as [string, string, EdgeKind][],
      isMajorChange: false,
    };

    applyDiff(graph, diff, "#0969da");

    expect(graph.getNodeAttribute("y.md", "type")).toBe("filled");
    expect(graph.getNodeAttribute("y.md", "color")).toBe("#0969da");
    expect(graph.getNodeAttribute("y.md", "size")).toBe(NODE_SIZE);
  });

  it("styles citation edges differently from wikilink edges", () => {
    const graph = new Graph();
    graph.addNode("a.md", { label: "A", color: "#0969da", type: "filled", size: 10, x: 50, y: 50 });
    graph.addNode("b.md", { label: "B", color: "#0969da", type: "filled", size: 8, x: 60, y: 60 });

    const diff = {
      addedNodes: [],
      removedNodes: [],
      updatedNodes: [],
      addedEdges: [["a.md", "b.md", "citation"]] as [string, string, EdgeKind][],
      removedEdges: [] as [string, string, EdgeKind][],
      isMajorChange: false,
    };

    applyDiff(graph, diff, "#0969da");

    const edge = graph.undirectedEdge("a.md", "b.md")!;
    expect(graph.getEdgeAttribute(edge, "citation")).toBe(true);
    expect(graph.getEdgeAttribute(edge, "size")).toBe(CITATION_EDGE_SIZE);
    expect(graph.getEdgeAttribute(edge, "color")).toBe(CITATION_EDGE_COLOR);
  });

  it("styles cardbox edges with distinct color and size", () => {
    const graph = new Graph();
    graph.addNode("a.md", { label: "A", color: "#0969da", type: "filled", size: 10, x: 50, y: 50 });
    graph.addNode("b.md", { label: "B", color: "#0969da", type: "filled", size: 8, x: 60, y: 60 });

    const diff = {
      addedNodes: [],
      removedNodes: [],
      updatedNodes: [],
      addedEdges: [["a.md", "b.md", "cardbox"]] as [string, string, EdgeKind][],
      removedEdges: [] as [string, string, EdgeKind][],
      isMajorChange: false,
    };

    applyDiff(graph, diff, "#0969da");

    const edge = graph.undirectedEdge("a.md", "b.md")!;
    expect(graph.getEdgeAttribute(edge, "cardbox")).toBe(true);
    expect(graph.getEdgeAttribute(edge, "size")).toBe(CARDBOX_EDGE_SIZE);
    expect(graph.getEdgeAttribute(edge, "color")).toBe(CARDBOX_EDGE_COLOR);
  });
});
