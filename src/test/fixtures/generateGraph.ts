import type { SubgraphResult, GraphNode, EdgeKind } from "../../lib/ipc";
import { mulberry32 } from "../../lib/random";

export interface SyntheticGraphOptions {
  nodeCount: number;
  edgeDensity?: number;
  seed?: number;
}

export interface SyntheticGraphResult {
  subgraph: SubgraphResult;
  pagerank: Record<string, number>;
}

export function generateSyntheticGraph(opts: SyntheticGraphOptions): SyntheticGraphResult {
  const { nodeCount, edgeDensity = 3, seed = 42 } = opts;
  const rng = mulberry32(seed);

  const nodes: GraphNode[] = [];
  for (let i = 0; i < nodeCount; i++) {
    nodes.push({ id: `page-${i}`, title: `Page ${i}`, is_stub: false, materialization: "materialized" });
  }

  const edgeSet = new Set<string>();
  const edges: [string, string, EdgeKind][] = [];
  const inDegree = new Map<string, number>();
  for (const n of nodes) inDegree.set(n.id, 0);

  const targetEdgeCount = Math.round(nodeCount * edgeDensity);
  let attempts = 0;
  const maxAttempts = targetEdgeCount * 10;

  while (edges.length < targetEdgeCount && attempts < maxAttempts) {
    attempts++;
    const srcIdx = Math.floor(rng() * nodeCount);
    const tgtIdx = Math.floor(rng() * nodeCount);
    if (srcIdx === tgtIdx) continue;
    const src = nodes[srcIdx]!.id;
    const tgt = nodes[tgtIdx]!.id;
    const key = src < tgt ? `${src}|${tgt}` : `${tgt}|${src}`;
    if (edgeSet.has(key)) continue;
    edgeSet.add(key);
    edges.push([src, tgt, "wikilink"]);
    inDegree.set(tgt, (inDegree.get(tgt) ?? 0) + 1);
  }

  const totalInDegree = Array.from(inDegree.values()).reduce((a, b) => a + b, 0) || 1;
  const pagerank: Record<string, number> = {};
  for (const [id, deg] of inDegree) {
    pagerank[id] = deg / totalInDegree;
  }

  return { subgraph: { nodes, edges }, pagerank };
}
