import Graph from "graphology";
import type { SubgraphResult } from "./ipc";

const DEFAULT_ACCENT = "#0969da";
const DEFAULT_DIM = "#d1d9e0";
const DEFAULT_EDGE = "#818b98";
const DEFAULT_LABEL = "#1f2328";

export function resolveThemeColors(): { accentColor: string; dimColor: string; edgeColor: string; labelColor: string } {
  if (typeof document === "undefined") {
    return { accentColor: DEFAULT_ACCENT, dimColor: DEFAULT_DIM, edgeColor: DEFAULT_EDGE, labelColor: DEFAULT_LABEL };
  }
  const style = getComputedStyle(document.documentElement);
  const accent = style.getPropertyValue("--interactive-accent").trim();
  const dim = style.getPropertyValue("--background-modifier-border").trim();
  const edge = style.getPropertyValue("--text-faint").trim();
  const label = style.getPropertyValue("--text-normal").trim();
  return {
    accentColor: accent || DEFAULT_ACCENT,
    dimColor: dim || DEFAULT_DIM,
    edgeColor: edge || DEFAULT_EDGE,
    labelColor: label || DEFAULT_LABEL,
  };
}

export const NODE_SIZE = 4;

export const SEED_COLOR = "#f59e0b";

export interface GraphBuildOptions {
  subgraph: SubgraphResult;
  accentColor: string;
  seedId?: string;
}

export function buildGraph(options: GraphBuildOptions): Graph {
  const { subgraph, accentColor, seedId } = options;
  const graph = new Graph();

  if (subgraph.nodes.length === 0) return graph;

  for (const node of subgraph.nodes) {
    const isSeed = seedId != null && node.id === seedId;
    graph.addNode(node.id, {
      label: node.title,
      color: isSeed ? SEED_COLOR : accentColor,
      type: isSeed ? "seed" : "filled",
      size: NODE_SIZE,
      x: Math.random() * 100,
      y: Math.random() * 100,
    });
  }

  for (const [source, target] of subgraph.edges) {
    if (!graph.hasNode(source) || !graph.hasNode(target)) continue;
    graph.mergeUndirectedEdge(source, target, { size: 0.5 });
  }

  return graph;
}

export function applyPositions(graph: Graph, positions: Record<string, { x: number; y: number }>): void {
  const positionedNodes = new Set<string>();

  graph.forEachNode((node: string) => {
    const pos = positions[node];
    if (pos) {
      graph.setNodeAttribute(node, "x", pos.x);
      graph.setNodeAttribute(node, "y", pos.y);
      positionedNodes.add(node);
    }
  });

  graph.forEachNode((node: string) => {
    if (positionedNodes.has(node)) return;
    const neighbors = graph.neighbors(node);
    const positioned = neighbors.filter((n) => positionedNodes.has(n));
    if (positioned.length === 0) return;
    let sx = 0, sy = 0;
    for (const n of positioned) {
      sx += graph.getNodeAttribute(n, "x") as number;
      sy += graph.getNodeAttribute(n, "y") as number;
    }
    graph.setNodeAttribute(node, "x", sx / positioned.length + (Math.random() - 0.5) * 20);
    graph.setNodeAttribute(node, "y", sy / positioned.length + (Math.random() - 0.5) * 20);
  });
}
