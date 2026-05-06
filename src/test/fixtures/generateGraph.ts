import type { SubgraphResult, GraphNode } from "../../lib/ipc";

export interface SyntheticGraphOptions {
  nodeCount: number;
  edgeDensity?: number;
  stubFraction?: number;
  seed?: number;
}

export interface SyntheticGraphResult {
  subgraph: SubgraphResult;
  pagerank: Record<string, number>;
}

function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function generateSyntheticGraph(opts: SyntheticGraphOptions): SyntheticGraphResult {
  const { nodeCount, edgeDensity = 3, stubFraction = 0.1, seed = 42 } = opts;
  const rng = mulberry32(seed);

  const stubCount = Math.round(nodeCount * stubFraction);
  const realCount = nodeCount - stubCount;

  const nodes: GraphNode[] = [];
  for (let i = 0; i < realCount; i++) {
    nodes.push({ id: `page-${i}`, title: `Page ${i}`, is_stub: false });
  }
  for (let i = 0; i < stubCount; i++) {
    nodes.push({ id: `stub-${i}`, title: `Stub ${i}`, is_stub: true });
  }

  const edgeSet = new Set<string>();
  const edges: [string, string][] = [];
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
    edges.push([src, tgt]);
    inDegree.set(tgt, (inDegree.get(tgt) ?? 0) + 1);
  }

  const totalInDegree = Array.from(inDegree.values()).reduce((a, b) => a + b, 0) || 1;
  const pagerank: Record<string, number> = {};
  for (const [id, deg] of inDegree) {
    pagerank[id] = deg / totalInDegree;
  }

  return { subgraph: { nodes, edges }, pagerank };
}
