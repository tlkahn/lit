import type { HierarchyPointNode } from "d3-hierarchy";
import type { HeadingNode } from "./headingTree";

export type PointNode = HierarchyPointNode<HeadingNode>;

export interface Point {
  x: number;
  y: number;
}

export interface ViewBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface NodeRect {
  id: string;
  left: number;
  top: number;
  width: number;
  height: number;
  node: PointNode;
}

export interface GapZone {
  parentId: string;
  index: number;
  left: number;
  top: number;
  width: number;
  height: number;
}

export type DropTarget =
  | { kind: "node"; nodeId: string }
  | { kind: "gap"; parentId: string; index: number };

const DRAG_THRESHOLD = 5;
const GAP_HEIGHT = 12;

export function parseViewBox(str: string): ViewBox {
  const parts = str.split(/[\s,]+/).map(Number);
  return { x: parts[0]!, y: parts[1]!, width: parts[2]!, height: parts[3]! };
}

export function svgPointFromClient(
  clientX: number,
  clientY: number,
  svgRect: { left: number; top: number; width: number; height: number },
  viewBox: ViewBox,
): Point {
  if (svgRect.width === 0 || svgRect.height === 0) {
    return { x: clientX, y: clientY };
  }
  const scaleX = viewBox.width / svgRect.width;
  const scaleY = viewBox.height / svgRect.height;
  return {
    x: viewBox.x + (clientX - svgRect.left) * scaleX,
    y: viewBox.y + (clientY - svgRect.top) * scaleY,
  };
}

export function classifyDrag(start: Point, current: Point, threshold = DRAG_THRESHOLD): boolean {
  const dx = current.x - start.x;
  const dy = current.y - start.y;
  return Math.sqrt(dx * dx + dy * dy) >= threshold;
}

export function buildNodeRects(descendants: PointNode[], nodeWidth: number, fontSizes: number[]): NodeRect[] {
  return descendants.map((d) => {
    const fontSize = fontSizes[Math.min(d.data.level - 1, fontSizes.length - 1)]!;
    return {
      id: d.data.id,
      left: d.y - 4,
      top: d.x - fontSize / 2 - 4,
      width: nodeWidth,
      height: fontSize + 8,
      node: d,
    };
  });
}

export function buildGapZones(descendants: PointNode[]): GapZone[] {
  const zones: GapZone[] = [];
  const childrenByParent = new Map<string, PointNode[]>();

  for (const d of descendants) {
    if (!d.parent) continue;
    const parentId = d.parent.data.id;
    if (!childrenByParent.has(parentId)) childrenByParent.set(parentId, []);
    childrenByParent.get(parentId)!.push(d);
  }

  for (const [parentId, children] of childrenByParent) {
    const sorted = [...children].sort((a, b) => a.x - b.x);
    for (let i = 0; i < sorted.length - 1; i++) {
      const above = sorted[i]!;
      const below = sorted[i + 1]!;
      const midY = (above.x + below.x) / 2;
      zones.push({
        parentId,
        index: i + 1,
        left: above.y - 4,
        top: midY - GAP_HEIGHT / 2,
        width: 160,
        height: GAP_HEIGHT,
      });
    }
  }

  return zones;
}

export function hitTestNode(point: Point, nodeRects: NodeRect[]): NodeRect | null {
  for (const r of nodeRects) {
    if (point.x >= r.left && point.x <= r.left + r.width && point.y >= r.top && point.y <= r.top + r.height) {
      return r;
    }
  }
  return null;
}

export function hitTestGap(point: Point, gapZones: GapZone[]): GapZone | null {
  for (const g of gapZones) {
    if (point.x >= g.left && point.x <= g.left + g.width && point.y >= g.top && point.y <= g.top + g.height) {
      return g;
    }
  }
  return null;
}

export function resolveDropTarget(
  point: Point,
  nodeRects: NodeRect[],
  gapZones: GapZone[],
): DropTarget | null {
  const gap = hitTestGap(point, gapZones);
  if (gap) return { kind: "gap", parentId: gap.parentId, index: gap.index };
  const node = hitTestNode(point, nodeRects);
  if (node) return { kind: "node", nodeId: node.id };
  return null;
}

export function isDescendantOf(nodeId: string, ancestorId: string, tree: HeadingNode): boolean {
  if (nodeId === ancestorId) return true;
  const ancestor = findNodeInTree(tree, ancestorId);
  if (!ancestor) return false;
  return hasDescendant(ancestor, nodeId);
}

export function getDescendantIds(nodeId: string, tree: HeadingNode): Set<string> {
  const result = new Set<string>();
  const node = findNodeInTree(tree, nodeId);
  if (!node) return result;
  function collect(n: HeadingNode) {
    result.add(n.id);
    for (const c of n.children) collect(c);
  }
  collect(node);
  return result;
}

function findNodeInTree(tree: HeadingNode, id: string): HeadingNode | null {
  if (tree.id === id) return tree;
  for (const child of tree.children) {
    const found = findNodeInTree(child, id);
    if (found) return found;
  }
  return null;
}

function hasDescendant(node: HeadingNode, id: string): boolean {
  for (const child of node.children) {
    if (child.id === id) return true;
    if (hasDescendant(child, id)) return true;
  }
  return false;
}
