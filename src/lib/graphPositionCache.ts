import type Graph from "graphology";

export interface PositionEntry {
  x: number;
  y: number;
}

export interface CachedPositions {
  positions: Record<string, PositionEntry>;
  timestamp: number;
}

export function getCacheKey(workspacePath: string, mode: "full" | "local"): string {
  return `lit-graph-pos:${workspacePath}:${mode}`;
}

export function savePositions(key: string, graph: Graph): void {
  const positions: Record<string, PositionEntry> = {};
  graph.forEachNode((node: string, attrs: Record<string, unknown>) => {
    positions[node] = { x: attrs.x as number, y: attrs.y as number };
  });
  const data: CachedPositions = { positions, timestamp: Date.now() };
  try {
    localStorage.setItem(key, JSON.stringify(data));
  } catch {
    // Quota exceeded — silently skip caching
  }
}

const CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export function loadPositions(key: string): Record<string, PositionEntry> | null {
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  try {
    const data: CachedPositions = JSON.parse(raw);
    if (Date.now() - data.timestamp > CACHE_MAX_AGE_MS) return null;
    return data.positions;
  } catch {
    return null;
  }
}
