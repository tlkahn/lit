import Graph from "graphology";
import type { SubgraphResult } from "./ipc";

const DEFAULT_ACCENT = "#0969da";
const DEFAULT_STUB = "#818b98";

export function resolveThemeColors(): { accentColor: string; stubColor: string } {
  if (typeof document === "undefined") {
    return { accentColor: DEFAULT_ACCENT, stubColor: DEFAULT_STUB };
  }
  const style = getComputedStyle(document.documentElement);
  const accent = style.getPropertyValue("--interactive-accent").trim();
  const stub = style.getPropertyValue("--text-faint").trim();
  return {
    accentColor: accent || DEFAULT_ACCENT,
    stubColor: stub || DEFAULT_STUB,
  };
}

export const MIN_SIZE = 4;
export const MAX_SIZE = 30;
export const SCALE_K = 1000;

export function computeNodeSize(pr: number, maxPr: number): number {
  if (pr <= 0 || maxPr <= 0) return MIN_SIZE;
  return MIN_SIZE + (MAX_SIZE - MIN_SIZE) * Math.log(1 + pr * SCALE_K) / Math.log(1 + maxPr * SCALE_K);
}

export interface GraphBuildOptions {
  subgraph: SubgraphResult;
  pagerank: Record<string, number>;
  accentColor: string;
  stubColor: string;
}

export function buildGraph(options: GraphBuildOptions): Graph {
  const { subgraph, pagerank, accentColor, stubColor } = options;
  const graph = new Graph();

  if (subgraph.nodes.length === 0) return graph;

  const maxPr = Math.max(0, ...Object.values(pagerank));

  for (const node of subgraph.nodes) {
    const pr = pagerank[node.id] ?? 0;
    const size = node.is_stub ? MIN_SIZE : computeNodeSize(pr, maxPr);
    graph.addNode(node.id, {
      label: node.title,
      color: node.is_stub ? stubColor : accentColor,
      type: node.is_stub ? "hollow" : "filled",
      size,
      x: Math.random() * 100,
      y: Math.random() * 100,
    });
  }

  for (const [source, target] of subgraph.edges) {
    if (!graph.hasNode(source) || !graph.hasNode(target)) continue;
    graph.mergeUndirectedEdge(source, target, { size: 1 });
  }

  return graph;
}
