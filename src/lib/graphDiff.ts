import type Graph from "graphology";
import type { SubgraphResult, GraphNode, EdgeKind } from "./ipc";
import { materializationAttrs, edgeAttrsForKind } from "./graphLayout";

export interface GraphDiff {
  addedNodes: GraphNode[];
  removedNodes: string[];
  updatedNodes: { id: string; title: string }[];
  addedEdges: [string, string, EdgeKind][];
  removedEdges: [string, string, EdgeKind][];
  isMajorChange: boolean;
}

function edgeKey(a: string, b: string, kind: EdgeKind): string {
  const pair = a < b ? `${a}--${b}` : `${b}--${a}`;
  return `${pair}::${kind}`;
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

  const currentEdgeMap = new Map<string, [string, string, EdgeKind]>();
  graph.forEachEdge((_edge, attrs, source, target) => {
    const kind: EdgeKind = attrs.kind ?? "wikilink";
    currentEdgeMap.set(edgeKey(source, target, kind), [source, target, kind]);
  });

  const newEdgeMap = new Map<string, [string, string, EdgeKind]>();
  for (const [source, target, kind] of subgraph.edges) {
    newEdgeMap.set(edgeKey(source, target, kind), [source, target, kind]);
  }

  const addedEdges: [string, string, EdgeKind][] = [];
  for (const [key, tuple] of newEdgeMap) {
    if (!currentEdgeMap.has(key)) addedEdges.push(tuple);
  }

  const removedEdges: [string, string, EdgeKind][] = [];
  for (const [key, tuple] of currentEdgeMap) {
    if (!newEdgeMap.has(key)) removedEdges.push(tuple);
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
  accentColor: string,
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

    const { type, color, size } = materializationAttrs(node.materialization, accentColor);
    graph.addNode(node.id, {
      label: node.title,
      color,
      type,
      size,
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

  for (const [source, target, kind] of diff.addedEdges) {
    if (graph.hasNode(source) && graph.hasNode(target)) {
      graph.mergeUndirectedEdge(source, target, edgeAttrsForKind(kind));
    }
  }

  for (const [source, target] of diff.removedEdges) {
    const edge = graph.undirectedEdge(source, target);
    if (edge) graph.dropEdge(edge);
  }

}
