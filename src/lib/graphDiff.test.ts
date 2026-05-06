import { describe, it, expect } from "vitest";
import Graph from "graphology";
import type { SubgraphResult } from "./ipc";
import { computeDiff, applyDiff } from "./graphDiff";

describe("computeDiff", () => {
  it("returns empty diff when graph and subgraph are identical", () => {
    const graph = new Graph();
    graph.addNode("a.md", { label: "A" });
    graph.addNode("b.md", { label: "B" });
    graph.mergeUndirectedEdge("a.md", "b.md");

    const subgraph: SubgraphResult = {
      nodes: [
        { id: "a.md", title: "A", is_stub: false },
        { id: "b.md", title: "B", is_stub: false },
      ],
      edges: [["a.md", "b.md"]],
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
      nodes: [
        { id: "a.md", title: "A", is_stub: false },
        { id: "b.md", title: "B", is_stub: false },
        { id: "c.md", title: "C", is_stub: false },
      ],
      edges: [],
    };

    const diff = computeDiff(graph, subgraph);

    expect(diff.addedNodes).toEqual([{ id: "c.md", title: "C", is_stub: false }]);
    expect(diff.removedNodes).toEqual([]);
  });

  it("detects removed node", () => {
    const graph = new Graph();
    graph.addNode("a.md", { label: "A" });
    graph.addNode("b.md", { label: "B" });
    graph.addNode("c.md", { label: "C" });

    const subgraph: SubgraphResult = {
      nodes: [
        { id: "a.md", title: "A", is_stub: false },
        { id: "b.md", title: "B", is_stub: false },
      ],
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
      nodes: [{ id: "a.md", title: "New Title", is_stub: false }],
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
      nodes: [
        { id: "a.md", title: "A", is_stub: false },
        { id: "b.md", title: "B", is_stub: false },
        { id: "c.md", title: "C", is_stub: false },
      ],
      edges: [["a.md", "b.md"], ["a.md", "c.md"]],
    };

    const diff = computeDiff(graph, subgraph);

    expect(diff.addedEdges).toEqual([["a.md", "c.md"]]);
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
      nodes: [
        { id: "a.md", title: "A", is_stub: false },
        { id: "b.md", title: "B", is_stub: false },
        { id: "c.md", title: "C", is_stub: false },
      ],
      edges: [["a.md", "b.md"]],
    };

    const diff = computeDiff(graph, subgraph);

    expect(diff.addedEdges).toEqual([]);
    expect(diff.removedEdges).toEqual([["a.md", "c.md"]]);
  });

  it("flags isMajorChange when >50% nodes differ", () => {
    const graph = new Graph();
    for (let i = 0; i < 10; i++) {
      graph.addNode(`old${i}.md`, { label: `Old ${i}` });
    }

    const subgraph: SubgraphResult = {
      nodes: [
        { id: "old0.md", title: "Old 0", is_stub: false },
        { id: "old1.md", title: "Old 1", is_stub: false },
        { id: "old2.md", title: "Old 2", is_stub: false },
        { id: "old3.md", title: "Old 3", is_stub: false },
        { id: "new0.md", title: "New 0", is_stub: false },
        { id: "new1.md", title: "New 1", is_stub: false },
        { id: "new2.md", title: "New 2", is_stub: false },
        { id: "new3.md", title: "New 3", is_stub: false },
        { id: "new4.md", title: "New 4", is_stub: false },
        { id: "new5.md", title: "New 5", is_stub: false },
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
        ...Array.from({ length: 10 }, (_, i) => ({ id: `n${i}.md`, title: `N ${i}`, is_stub: false })),
        { id: "new.md", title: "New", is_stub: false },
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
      addedNodes: [{ id: "c.md", title: "Page C", is_stub: false }],
      removedNodes: [],
      updatedNodes: [],
      addedEdges: [] as [string, string][],
      removedEdges: [] as [string, string][],
      isMajorChange: false,
    };
    const pagerank = { "a.md": 0.4, "b.md": 0.3, "c.md": 0.3 };

    applyDiff(graph, diff, pagerank, "#0969da", "#818b98");

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
      addedEdges: [] as [string, string][],
      removedEdges: [] as [string, string][],
      isMajorChange: false,
    };

    applyDiff(graph, diff, { "a.md": 0.5, "b.md": 0.5 }, "#0969da", "#818b98");

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
      addedEdges: [] as [string, string][],
      removedEdges: [] as [string, string][],
      isMajorChange: false,
    };

    applyDiff(graph, diff, { "a.md": 0.5 }, "#0969da", "#818b98");

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
      addedEdges: [["a.md", "c.md"]] as [string, string][],
      removedEdges: [["a.md", "b.md"]] as [string, string][],
      isMajorChange: false,
    };

    applyDiff(graph, diff, { "a.md": 0.4, "b.md": 0.3, "c.md": 0.3 }, "#0969da", "#818b98");

    expect(graph.hasUndirectedEdge("a.md", "c.md")).toBe(true);
    expect(graph.hasUndirectedEdge("a.md", "b.md")).toBe(false);
  });

  it("recalculates node sizes from new pagerank", () => {
    const graph = new Graph();
    graph.addNode("a.md", { label: "A", color: "#0969da", type: "filled", size: 10, x: 50, y: 50 });

    const oldSize = graph.getNodeAttribute("a.md", "size") as number;

    const diff = {
      addedNodes: [],
      removedNodes: [],
      updatedNodes: [],
      addedEdges: [] as [string, string][],
      removedEdges: [] as [string, string][],
      isMajorChange: false,
    };

    applyDiff(graph, diff, { "a.md": 0.99 }, "#0969da", "#818b98");

    const newSize = graph.getNodeAttribute("a.md", "size") as number;
    expect(newSize).not.toBe(oldSize);
    expect(newSize).toBeGreaterThan(oldSize);
  });

  it("positions new nodes near their existing neighbors", () => {
    const graph = new Graph();
    graph.addNode("a.md", { label: "A", color: "#0969da", type: "filled", size: 10, x: 50, y: 50 });

    const diff = {
      addedNodes: [{ id: "c.md", title: "C", is_stub: false }],
      removedNodes: [],
      updatedNodes: [],
      addedEdges: [["a.md", "c.md"]] as [string, string][],
      removedEdges: [] as [string, string][],
      isMajorChange: false,
    };

    applyDiff(graph, diff, { "a.md": 0.5, "c.md": 0.3 }, "#0969da", "#818b98");

    const cx = graph.getNodeAttribute("c.md", "x") as number;
    const cy = graph.getNodeAttribute("c.md", "y") as number;
    const dist = Math.sqrt((cx - 50) ** 2 + (cy - 50) ** 2);
    expect(dist).toBeLessThan(30);
  });
});
