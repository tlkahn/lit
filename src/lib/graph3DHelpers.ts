import { Color, Vector3 } from "three";
import { computeNodeSize, MIN_SIZE, SEED_COLOR } from "./graphLayout";
import type { GraphNode } from "./ipc";

export const SIZE_SCALE_3D = 0.02;

export interface BoundingSphere {
  center: { x: number; y: number; z: number };
  radius: number;
}

export function computeBoundingSphere(
  positions: Record<string, { x: number; y: number; z: number }>,
): BoundingSphere {
  const keys = Object.keys(positions);
  if (keys.length === 0) {
    return { center: { x: 0, y: 0, z: 0 }, radius: 0 };
  }

  let cx = 0, cy = 0, cz = 0;
  for (const k of keys) {
    const p = positions[k]!;
    cx += p.x;
    cy += p.y;
    cz += p.z;
  }
  const n = keys.length;
  cx /= n;
  cy /= n;
  cz /= n;

  let maxDist = 0;
  for (const k of keys) {
    const p = positions[k]!;
    const dx = p.x - cx;
    const dy = p.y - cy;
    const dz = p.z - cz;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (dist > maxDist) maxDist = dist;
  }

  return { center: { x: cx, y: cy, z: cz }, radius: maxDist };
}

const DEG2RAD = Math.PI / 180;
const MIN_CAMERA_DISTANCE = 5;

export function computeCameraDistance(radius: number, fovDeg: number): number {
  if (radius <= 0) return MIN_CAMERA_DISTANCE;
  const dist = (radius / Math.tan((fovDeg / 2) * DEG2RAD)) * 1.2;
  return Math.max(dist, MIN_CAMERA_DISTANCE);
}

export function buildInstanceMatrices(
  nodes: GraphNode[],
  positions: Record<string, { x: number; y: number; z: number }>,
  pagerank: Record<string, number>,
): Float32Array {
  const prValues = Object.values(pagerank);
  const maxPr = prValues.length > 0 ? Math.max(0, ...prValues) : 0;
  const arr = new Float32Array(nodes.length * 16);

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]!;
    const pos = positions[node.id];
    const pr = pagerank[node.id] ?? 0;
    const size = (maxPr <= 0 ? MIN_SIZE : computeNodeSize(pr, maxPr)) * SIZE_SCALE_3D;
    const x = pos?.x ?? 0;
    const y = pos?.y ?? 0;
    const z = pos?.z ?? 0;

    const off = i * 16;
    // Column-major 4×4: scale on diagonal, translation in column 3
    arr[off + 0] = size;
    arr[off + 1] = 0;
    arr[off + 2] = 0;
    arr[off + 3] = 0;
    arr[off + 4] = 0;
    arr[off + 5] = size;
    arr[off + 6] = 0;
    arr[off + 7] = 0;
    arr[off + 8] = 0;
    arr[off + 9] = 0;
    arr[off + 10] = size;
    arr[off + 11] = 0;
    arr[off + 12] = x;
    arr[off + 13] = y;
    arr[off + 14] = z;
    arr[off + 15] = 1;
  }

  return arr;
}

// Single-threaded scratch instance — not safe for concurrent/worker use.
const tmpColor = new Color();

export function buildInstanceColors(
  nodes: GraphNode[],
  accentColor: string,
  stubColor: string,
  seedId?: string,
): Float32Array {
  const arr = new Float32Array(nodes.length * 3);

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]!;
    const isSeed = seedId != null && node.id === seedId;
    const hex = isSeed ? SEED_COLOR : node.is_stub ? stubColor : accentColor;
    tmpColor.set(hex);
    const off = i * 3;
    arr[off] = tmpColor.r;
    arr[off + 1] = tmpColor.g;
    arr[off + 2] = tmpColor.b;
  }

  return arr;
}

export function buildNeighborSet(
  edges: [string, string][],
  nodeId: string,
): Set<string> {
  const neighbors = new Set<string>();
  for (const [src, tgt] of edges) {
    if (src === nodeId && tgt !== nodeId) neighbors.add(tgt);
    if (tgt === nodeId && src !== nodeId) neighbors.add(src);
  }
  return neighbors;
}

export function buildHighlightColors(
  nodes: GraphNode[],
  hoveredId: string,
  neighbors: Set<string>,
  accentColor: string,
  hoverColor: string,
  dimColor: string,
  seedId?: string,
): Float32Array {
  const arr = new Float32Array(nodes.length * 3);
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]!;
    let hex: string;
    if (node.id === hoveredId) {
      hex = seedId != null && node.id === seedId ? SEED_COLOR : hoverColor;
    } else if (neighbors.has(node.id)) {
      hex = accentColor;
    } else {
      hex = dimColor;
    }
    tmpColor.set(hex);
    const off = i * 3;
    arr[off] = tmpColor.r;
    arr[off + 1] = tmpColor.g;
    arr[off + 2] = tmpColor.b;
  }
  return arr;
}

const tmpVec = new Vector3();

export function projectToScreen(
  pos3d: { x: number; y: number; z: number },
  camera: Parameters<Vector3["project"]>[0],
  canvasSize: { width: number; height: number },
): { x: number; y: number } {
  tmpVec.set(pos3d.x, pos3d.y, pos3d.z);
  tmpVec.project(camera);
  return {
    x: (tmpVec.x + 1) * 0.5 * canvasSize.width,
    y: (-tmpVec.y + 1) * 0.5 * canvasSize.height,
  };
}

export function buildEdgePositions(
  edges: [string, string][],
  positions: Record<string, { x: number; y: number; z: number }>,
): Float32Array {
  const valid: { sx: number; sy: number; sz: number; tx: number; ty: number; tz: number }[] = [];

  for (const [src, tgt] of edges) {
    const sp = positions[src];
    const tp = positions[tgt];
    if (!sp || !tp) continue;
    valid.push({ sx: sp.x, sy: sp.y, sz: sp.z, tx: tp.x, ty: tp.y, tz: tp.z });
  }

  const arr = new Float32Array(valid.length * 6);
  for (let i = 0; i < valid.length; i++) {
    const e = valid[i]!;
    const off = i * 6;
    arr[off] = e.sx;
    arr[off + 1] = e.sy;
    arr[off + 2] = e.sz;
    arr[off + 3] = e.tx;
    arr[off + 4] = e.ty;
    arr[off + 5] = e.tz;
  }

  return arr;
}
