import type Graph from "graphology";
import type { SubgraphResult, GraphNode } from "./ipc";
import { NODE_SIZE } from "./graphLayout";

export interface GraphDiff {
  addedNodes: GraphNode[];
  removedNodes: string[];
  updatedNodes: { id: string; title: string }[];
  addedEdges: [string, string][];
  removedEdges: [string, string][];
  isMajorChange: boolean;
}

function edgeKey(a: string, b: string): string {
  return a < b ? `${a}--${b}` : `${b}--${a}`;
}

export function computeDiff(graph: Graph, subgraph: SubgraphResult): GraphDiff {
  const currentNodes = new Set(graph.nodes());
  const newNodeMap = new Map(subgraph.nodes.map((n) => [n.id, n]));

  const addedNodes: GraphNode[] = [];
  const removedNodes: string[] = [];
  const updatedNodes: { id: string; title: string }[] = [];

  for (const node of subgraph.nodes) {
    if (!currentNodes.has(node.id)) {
      addedNodes.push(node);
    }
  }

  for (const node of currentNodes) {
    if (!newNodeMap.has(node)) {
      removedNodes.push(node);
    }
  }

  for (const node of currentNodes) {
    const newNode = newNodeMap.get(node);
    if (newNode && graph.getNodeAttribute(node, "label") !== newNode.title) {
      updatedNodes.push({ id: node, title: newNode.title });
    }
  }

  const currentEdges = new Set<string>();
  graph.forEachEdge((_edge, _attrs, source, target) => {
    currentEdges.add(edgeKey(source, target));
  });

  const newEdges = new Set<string>();
  for (const [source, target] of subgraph.edges) {
    newEdges.add(edgeKey(source, target));
  }

  const addedEdges: [string, string][] = [];
  for (const e of newEdges) {
    if (!currentEdges.has(e)) {
      const [a, b] = e.split("--") as [string, string];
      addedEdges.push([a, b]);
    }
  }

  const removedEdges: [string, string][] = [];
  for (const e of currentEdges) {
    if (!newEdges.has(e)) {
      const [a, b] = e.split("--") as [string, string];
      removedEdges.push([a, b]);
    }
  }

  const totalChanged = addedNodes.length + removedNodes.length;
  const isMajorChange = subgraph.nodes.length > 0 && totalChanged / subgraph.nodes.length > 0.5;

  return { addedNodes, removedNodes, updatedNodes, addedEdges, removedEdges, isMajorChange };
}

export function isDiffEmpty(diff: GraphDiff): boolean {
  return (
    diff.addedNodes.length === 0 &&
    diff.removedNodes.length === 0 &&
    diff.updatedNodes.length === 0 &&
    diff.addedEdges.length === 0 &&
    diff.removedEdges.length === 0
  );
}

export function applyDiff(
  graph: Graph,
  diff: GraphDiff,
  _pagerank: Record<string, number>,
  accentColor: string,
  stubColor: string,
): void {
  for (const node of diff.addedNodes) {

    let x = Math.random() * 100;
    let y = Math.random() * 100;
    const neighbors: string[] = [];
    for (const [a, b] of diff.addedEdges) {
      if (a === node.id && graph.hasNode(b)) neighbors.push(b);
      else if (b === node.id && graph.hasNode(a)) neighbors.push(a);
    }
    if (neighbors.length > 0) {
      let sx = 0, sy = 0;
      for (const n of neighbors) {
        sx += graph.getNodeAttribute(n, "x") as number;
        sy += graph.getNodeAttribute(n, "y") as number;
      }
      x = sx / neighbors.length + (Math.random() - 0.5) * 20;
      y = sy / neighbors.length + (Math.random() - 0.5) * 20;
    }

    graph.addNode(node.id, {
      label: node.title,
      color: node.is_stub ? stubColor : accentColor,
      type: node.is_stub ? "hollow" : "filled",
      size: NODE_SIZE,
      x,
      y,
    });
  }

  for (const nodeId of diff.removedNodes) {
    graph.dropNode(nodeId);
  }

  for (const { id, title } of diff.updatedNodes) {
    graph.setNodeAttribute(id, "label", title);
  }

  for (const [source, target] of diff.addedEdges) {
    if (graph.hasNode(source) && graph.hasNode(target)) {
      graph.mergeUndirectedEdge(source, target, { size: 1 });
    }
  }

  for (const [source, target] of diff.removedEdges) {
    const edge = graph.undirectedEdge(source, target);
    if (edge) graph.dropEdge(edge);
  }

}
