import { describe, it, expect } from "vitest";
import { hierarchy, tree as d3tree } from "d3-hierarchy";
import type { HeadingNode } from "./headingTree";
import { buildHeadingTree } from "./headingTree";
import {
  classifyDrag,
  parseViewBox,
  svgPointFromClient,
  svgPointFromClientWithZoom,
  buildNodeRects,
  buildGapZones,
  hitTestNode,
  hitTestGap,
  resolveDropTarget,
  isDescendantOf,
  getDescendantIds,
  type PointNode,
} from "./mindmapDnd";

const FONT_SIZES = [16, 15, 14, 13, 12, 11];
const NODE_WIDTH = 160;

function layoutTree(body: string) {
  const tree = buildHeadingTree(body);
  const root = hierarchy(tree, (d) => (d.children.length > 0 ? d.children : undefined));
  const treeLayout = d3tree<HeadingNode>().nodeSize([44, 200]);
  treeLayout(root);
  const descendants = (root.descendants() as PointNode[]).filter((d) => d.data.level > 0);
  return { tree, descendants };
}

describe("classifyDrag", () => {
  it("returns false below threshold", () => {
    expect(classifyDrag({ x: 0, y: 0 }, { x: 3, y: 3 })).toBe(false);
  });

  it("returns true above threshold", () => {
    expect(classifyDrag({ x: 0, y: 0 }, { x: 4, y: 4 })).toBe(true);
  });
});

describe("parseViewBox", () => {
  it("parses SVG viewBox string", () => {
    expect(parseViewBox("-100 -50 800 600")).toEqual({ x: -100, y: -50, width: 800, height: 600 });
  });
});

describe("svgPointFromClient", () => {
  it("maps client coordinates to SVG space", () => {
    const rect = { left: 0, top: 0, width: 800, height: 600 };
    const viewBox = { x: -100, y: -50, width: 800, height: 600 };
    const pt = svgPointFromClient(400, 300, rect, viewBox);
    expect(pt.x).toBe(300);
    expect(pt.y).toBe(250);
  });

  it("falls back to identity when SVG rect has zero size", () => {
    const rect = { left: 0, top: 0, width: 0, height: 0 };
    const viewBox = { x: 0, y: 0, width: 800, height: 600 };
    const pt = svgPointFromClient(150, 200, rect, viewBox);
    expect(pt.x).toBe(150);
    expect(pt.y).toBe(200);
  });
});

describe("svgPointFromClientWithZoom", () => {
  const rect = { left: 100, top: 50, width: 800, height: 600 };

  it("identity transform → subtracts SVG offset", () => {
    const pt = svgPointFromClientWithZoom(300, 250, rect, { k: 1, x: 0, y: 0 });
    expect(pt.x).toBeCloseTo(200);
    expect(pt.y).toBeCloseTo(200);
  });

  it("zoomed in (k=2) → inverts scale", () => {
    const pt = svgPointFromClientWithZoom(300, 250, rect, { k: 2, x: 0, y: 0 });
    expect(pt.x).toBeCloseTo(100);
    expect(pt.y).toBeCloseTo(100);
  });

  it("zoomed out (k=0.5) → inverts scale", () => {
    const pt = svgPointFromClientWithZoom(300, 250, rect, { k: 0.5, x: 0, y: 0 });
    expect(pt.x).toBeCloseTo(400);
    expect(pt.y).toBeCloseTo(400);
  });
});

describe("buildNodeRects", () => {
  it("creates rects from D3 descendants", () => {
    const { descendants } = layoutTree("# A\n## B");
    const rects = buildNodeRects(descendants, NODE_WIDTH, FONT_SIZES);
    expect(rects).toHaveLength(2);
    expect(rects[0]!.id).toBe(descendants[0]!.data.id);
    expect(rects[0]!.width).toBe(NODE_WIDTH);
  });
});

describe("hitTestNode", () => {
  it("returns hit rect when point is inside", () => {
    const { descendants } = layoutTree("# A\n## B");
    const rects = buildNodeRects(descendants, NODE_WIDTH, FONT_SIZES);
    const r = rects[0]!;
    const point = { x: r.left + 10, y: r.top + 5 };
    expect(hitTestNode(point, rects)).toBe(r);
  });

  it("returns null when point is outside all rects", () => {
    const { descendants } = layoutTree("# A\n## B");
    const rects = buildNodeRects(descendants, NODE_WIDTH, FONT_SIZES);
    expect(hitTestNode({ x: -9999, y: -9999 }, rects)).toBeNull();
  });
});

describe("buildGapZones", () => {
  it("creates gap zones between siblings", () => {
    const { descendants } = layoutTree("# A\n## B\n## C\n## D");
    const gaps = buildGapZones(descendants);
    const parentId = descendants.find((d) => d.data.text === "A")!.data.id;
    const siblingGaps = gaps.filter((g) => g.parentId === parentId);
    expect(siblingGaps).toHaveLength(2);
    expect(siblingGaps[0]!.index).toBe(1);
    expect(siblingGaps[1]!.index).toBe(2);
  });

  it("creates no gap zones for a single child", () => {
    const { descendants } = layoutTree("# A\n## B");
    const gaps = buildGapZones(descendants);
    const parentId = descendants.find((d) => d.data.text === "A")!.data.id;
    expect(gaps.filter((g) => g.parentId === parentId)).toHaveLength(0);
  });
});

describe("hitTestGap", () => {
  it("returns gap zone when point is inside", () => {
    const { descendants } = layoutTree("# A\n## B\n## C");
    const gaps = buildGapZones(descendants);
    expect(gaps.length).toBeGreaterThan(0);
    const g = gaps[0]!;
    const point = { x: g.left + 10, y: g.top + 3 };
    expect(hitTestGap(point, gaps)).toBe(g);
  });
});

describe("resolveDropTarget", () => {
  it("returns node target when point hits a node", () => {
    const { descendants } = layoutTree("# A\n## B");
    const rects = buildNodeRects(descendants, NODE_WIDTH, FONT_SIZES);
    const gaps = buildGapZones(descendants);
    const r = rects[0]!;
    const result = resolveDropTarget({ x: r.left + 10, y: r.top + 5 }, rects, gaps);
    expect(result).toEqual({ kind: "node", nodeId: r.id });
  });

  it("returns gap target when point hits a gap zone", () => {
    const { descendants } = layoutTree("# A\n## B\n## C");
    const rects = buildNodeRects(descendants, NODE_WIDTH, FONT_SIZES);
    const gaps = buildGapZones(descendants);
    const g = gaps[0]!;
    const result = resolveDropTarget({ x: g.left + 10, y: g.top + 3 }, rects, gaps);
    expect(result).toEqual({ kind: "gap", parentId: g.parentId, index: g.index });
  });

  it("returns null when point misses everything", () => {
    const { descendants } = layoutTree("# A\n## B");
    const rects = buildNodeRects(descendants, NODE_WIDTH, FONT_SIZES);
    const gaps = buildGapZones(descendants);
    expect(resolveDropTarget({ x: -9999, y: -9999 }, rects, gaps)).toBeNull();
  });

  it("gap zone takes priority over node zone in overlap region", () => {
    const { descendants } = layoutTree("# A\n## B\n## C");
    const rects = buildNodeRects(descendants, NODE_WIDTH, FONT_SIZES);
    const gaps = buildGapZones(descendants);
    const g = gaps[0]!;
    const point = { x: g.left + 10, y: g.top + 3 };
    const nodeHit = hitTestNode(point, rects);
    if (nodeHit) {
      const result = resolveDropTarget(point, rects, gaps);
      expect(result!.kind).toBe("gap");
    }
  });
});

describe("isDescendantOf", () => {
  it("returns true for a child", () => {
    const tree = buildHeadingTree("# A\n## B");
    const parentId = tree.children[0]!.id;
    const childId = tree.children[0]!.children[0]!.id;
    expect(isDescendantOf(childId, parentId, tree)).toBe(true);
  });

  it("returns false for non-descendant", () => {
    const tree = buildHeadingTree("# A\n## B\n# C");
    const idA = tree.children[0]!.id;
    const idC = tree.children[1]!.id;
    expect(isDescendantOf(idC, idA, tree)).toBe(false);
  });

  it("returns true for self", () => {
    const tree = buildHeadingTree("# A");
    const id = tree.children[0]!.id;
    expect(isDescendantOf(id, id, tree)).toBe(true);
  });
});

describe("getDescendantIds", () => {
  it("returns all descendant IDs including self", () => {
    const tree = buildHeadingTree("# A\n## B\n### C");
    const idA = tree.children[0]!.id;
    const idB = tree.children[0]!.children[0]!.id;
    const idC = tree.children[0]!.children[0]!.children[0]!.id;
    const ids = getDescendantIds(idA, tree);
    expect(ids).toEqual(new Set([idA, idB, idC]));
  });
});
