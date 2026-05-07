import Graph from "graphology";
import type { SubgraphResult } from "./ipc";

const DEFAULT_ACCENT = "#0969da";
const DEFAULT_STUB = "#818b98";
const DEFAULT_DIM = "#d1d9e0";
const DEFAULT_EDGE = "#818b98";
const DEFAULT_LABEL = "#1f2328";

export function resolveThemeColors(): { accentColor: string; stubColor: string; dimColor: string; edgeColor: string; labelColor: string } {
  if (typeof document === "undefined") {
    return { accentColor: DEFAULT_ACCENT, stubColor: DEFAULT_STUB, dimColor: DEFAULT_DIM, edgeColor: DEFAULT_EDGE, labelColor: DEFAULT_LABEL };
  }
  const style = getComputedStyle(document.documentElement);
  const accent = style.getPropertyValue("--interactive-accent").trim();
  const stub = style.getPropertyValue("--text-faint").trim();
  const dim = style.getPropertyValue("--background-modifier-border").trim();
  const edge = style.getPropertyValue("--text-faint").trim();
  const label = style.getPropertyValue("--text-normal").trim();
  return {
    accentColor: accent || DEFAULT_ACCENT,
    stubColor: stub || DEFAULT_STUB,
    dimColor: dim || DEFAULT_DIM,
    edgeColor: edge || DEFAULT_EDGE,
    labelColor: label || DEFAULT_LABEL,
  };
}

export const MIN_SIZE = 4;
export const MAX_SIZE = 30;
export const SCALE_K = 1000;

export function computeNodeSize(pr: number, maxPr: number): number {
  if (pr <= 0 || maxPr <= 0) return MIN_SIZE;
  return MIN_SIZE + (MAX_SIZE - MIN_SIZE) * Math.log(1 + pr * SCALE_K) / Math.log(1 + maxPr * SCALE_K);
}

export const SEED_COLOR = "#f59e0b";

export interface GraphBuildOptions {
  subgraph: SubgraphResult;
  pagerank: Record<string, number>;
  accentColor: string;
  stubColor: string;
  seedId?: string;
}

export function buildGraph(options: GraphBuildOptions): Graph {
  const { subgraph, pagerank, accentColor, stubColor, seedId } = options;
  const graph = new Graph();

  if (subgraph.nodes.length === 0) return graph;

  const maxPr = Math.max(0, ...Object.values(pagerank));

  for (const node of subgraph.nodes) {
    const pr = pagerank[node.id] ?? 0;
    const size = node.is_stub ? MIN_SIZE : computeNodeSize(pr, maxPr);
    const isSeed = seedId != null && node.id === seedId;
    graph.addNode(node.id, {
      label: node.title,
      color: isSeed ? SEED_COLOR : node.is_stub ? stubColor : accentColor,
      type: isSeed ? "seed" : node.is_stub ? "hollow" : "filled",
      size: isSeed ? Math.max(size * 1.3, size + 4) : size,
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
