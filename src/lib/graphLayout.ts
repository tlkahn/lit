import Graph from "graphology";
import type { SubgraphResult, EdgeKind } from "./ipc";

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

export const SELECTED_COLOR = "#fbbf24";

export const SHADOW_COLOR = "#8b949e";

export const WIKILINK_EDGE_SIZE = 0.5;
export const WIKILINK_EDGE_COLOR = "#818b98";
export const MDLINK_EDGE_SIZE = 0.5;
export const MDLINK_EDGE_COLOR = "#818b98";
export const CITATION_EDGE_SIZE = 0.3;
export const CITATION_EDGE_COLOR = "#8b949e";
export const ANNOTATION_EDGE_SIZE = 0.3;
export const ANNOTATION_EDGE_COLOR = "#8b949e";

export const SHADOW_NODE_SIZE_FACTOR = 0.7;

/** Derive a node label from its path: strip directory and the `.md` extension. Mirrors the Rust title fallback. */
export function nodeLabelFromPath(p: string): string {
  const base = p.split("/").pop() ?? p;
  return base.endsWith(".md") ? base.slice(0, -3) : base;
}

export function edgeAttrsForKind(kind: EdgeKind): { kind: EdgeKind; size: number; color: string } {
  switch (kind) {
    case "wikilink":
      return { kind, size: WIKILINK_EDGE_SIZE, color: WIKILINK_EDGE_COLOR };
    case "mdlink":
      return { kind, size: MDLINK_EDGE_SIZE, color: MDLINK_EDGE_COLOR };
    case "citation":
      return { kind, size: CITATION_EDGE_SIZE, color: CITATION_EDGE_COLOR };
    case "annotation":
      return { kind, size: ANNOTATION_EDGE_SIZE, color: ANNOTATION_EDGE_COLOR };
  }
}

export function seedAttrs(isSeed: boolean, accentColor: string): { type: string; color: string } {
  return isSeed
    ? { type: "seed", color: SEED_COLOR }
    : { type: "filled", color: accentColor };
}

export function materializationAttrs(
  materialization: import("./ipc").Materialization,
  accentColor: string,
): { type: string; color: string; size: number } {
  if (materialization === "shadow" || materialization === "partial") {
    return { type: "shadow", color: SHADOW_COLOR, size: NODE_SIZE * SHADOW_NODE_SIZE_FACTOR };
  }
  return { type: "filled", color: accentColor, size: NODE_SIZE };
}

export interface GraphBuildOptions {
  subgraph: SubgraphResult;
  accentColor: string;
  seedId?: string;
}

export function populateGraph(graph: Graph, subgraph: SubgraphResult, accentColor: string, seedId?: string): void {
  for (const node of subgraph.nodes) {
    const isSeed = seedId != null && node.id === seedId;
    let type: string, color: string, size: number;
    if (isSeed) {
      ({ type, color } = seedAttrs(true, accentColor));
      size = NODE_SIZE;
    } else {
      ({ type, color, size } = materializationAttrs(node.materialization, accentColor));
    }
    graph.addNode(node.id, {
      label: node.title,
      color,
      type,
      size,
      x: Math.random() * 100,
      y: Math.random() * 100,
    });
  }

  for (const [source, target, kind] of subgraph.edges) {
    if (!graph.hasNode(source) || !graph.hasNode(target)) continue;
    graph.mergeUndirectedEdge(source, target, edgeAttrsForKind(kind));
  }
}

export function recolorSeed(
  graph: Graph,
  prevSeedId: string | null | undefined,
  nextSeedId: string | null | undefined,
  accentColor: string,
): void {
  if (prevSeedId && prevSeedId !== nextSeedId && graph.hasNode(prevSeedId)) {
    const { type, color } = seedAttrs(false, accentColor);
    graph.setNodeAttribute(prevSeedId, "type", type);
    graph.setNodeAttribute(prevSeedId, "color", color);
  }
  if (nextSeedId && graph.hasNode(nextSeedId)) {
    const { type, color } = seedAttrs(true, accentColor);
    graph.setNodeAttribute(nextSeedId, "type", type);
    graph.setNodeAttribute(nextSeedId, "color", color);
  }
}

export function buildGraph(options: GraphBuildOptions): Graph {
  const { subgraph, accentColor, seedId } = options;
  const graph = new Graph();
  if (subgraph.nodes.length === 0) return graph;
  populateGraph(graph, subgraph, accentColor, seedId);
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
