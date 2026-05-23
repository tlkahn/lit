import type Graph from "graphology";

export const PULL_FRACTION = 0.04;
export const HOVER_SIZE_BOOST = 1.5;
export const NEIGHBOR_SIZE_BOOST = 0.5;
export const LERP = 0.12;
export const EPSILON = 0.01;

interface Snapshot {
  x: number;
  y: number;
  size: number;
}

export interface NudgeController {
  enter(node: string): void;
  leave(): void;
  dispose(): void;
}

export function createNudgeController(
  graph: Graph,
  refresh: () => void,
): NudgeController {
  let originals: Map<string, Snapshot> | null = null;
  let targets: Map<string, Snapshot> | null = null;
  let settling = false;
  let rafHandle = 0;

  function snapshot(nodes: string[]): Map<string, Snapshot> {
    const map = new Map<string, Snapshot>();
    for (const n of nodes) {
      map.set(n, {
        x: graph.getNodeAttribute(n, "x") as number,
        y: graph.getNodeAttribute(n, "y") as number,
        size: graph.getNodeAttribute(n, "size") as number,
      });
    }
    return map;
  }

  function snapToOriginals() {
    if (!originals) return;
    for (const [n, snap] of originals) {
      if (!graph.hasNode(n)) continue;
      graph.setNodeAttribute(n, "x", snap.x);
      graph.setNodeAttribute(n, "y", snap.y);
      graph.setNodeAttribute(n, "size", snap.size);
    }
  }

  function tick() {
    if (!targets || !originals) return;

    let maxDelta = 0;

    for (const [n, target] of targets) {
      if (!graph.hasNode(n)) continue;
      const cx = graph.getNodeAttribute(n, "x") as number;
      const cy = graph.getNodeAttribute(n, "y") as number;
      const cs = graph.getNodeAttribute(n, "size") as number;

      const nx = cx + (target.x - cx) * LERP;
      const ny = cy + (target.y - cy) * LERP;
      const ns = cs + (target.size - cs) * LERP;

      const dx = Math.abs(target.x - nx);
      const dy = Math.abs(target.y - ny);
      const ds = Math.abs(target.size - ns);
      maxDelta = Math.max(maxDelta, dx, dy, ds);

      graph.setNodeAttribute(n, "x", nx);
      graph.setNodeAttribute(n, "y", ny);
      graph.setNodeAttribute(n, "size", ns);
    }

    refresh();

    if (maxDelta < EPSILON) {
      if (settling) {
        snapToOriginals();
        originals = null;
        targets = null;
        settling = false;
        refresh();
      }
      rafHandle = 0;
      return;
    }

    rafHandle = requestAnimationFrame(tick);
  }

  function enter(node: string) {
    if (originals) {
      cancelAnimationFrame(rafHandle);
      rafHandle = 0;
      snapToOriginals();
    }

    settling = false;
    const neighbors = graph.neighbors(node);
    const involved = [node, ...neighbors];
    originals = snapshot(involved);

    const hoveredSnap = originals.get(node)!;
    targets = new Map<string, Snapshot>();

    targets.set(node, {
      x: hoveredSnap.x,
      y: hoveredSnap.y,
      size: hoveredSnap.size + HOVER_SIZE_BOOST,
    });

    for (const nb of neighbors) {
      const nbSnap = originals.get(nb)!;
      targets.set(nb, {
        x: nbSnap.x + (hoveredSnap.x - nbSnap.x) * PULL_FRACTION,
        y: nbSnap.y + (hoveredSnap.y - nbSnap.y) * PULL_FRACTION,
        size: nbSnap.size + NEIGHBOR_SIZE_BOOST,
      });
    }

    rafHandle = requestAnimationFrame(tick);
  }

  function leave() {
    if (!originals) return;
    settling = true;
    targets = new Map(originals);
    if (rafHandle === 0) {
      rafHandle = requestAnimationFrame(tick);
    }
  }

  function dispose() {
    cancelAnimationFrame(rafHandle);
    rafHandle = 0;
    if (originals) {
      snapToOriginals();
      originals = null;
      targets = null;
      settling = false;
    }
  }

  return { enter, leave, dispose };
}
