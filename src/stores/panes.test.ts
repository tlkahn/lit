import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  generatePaneId,
  findLeaf,
  collectLeaves,
  cycleLeafId,
  replaceLeaf,
  removeLeaf,
  findSplitByPath,
  replaceSplitSizes,
  clearPagePath,
  rotateChildren,
  getPanePosition,
  createInitialState,
  usePaneStore,
  startLayoutSync,
  stopLayoutSync,
  MAX_PANES,
} from "./panes";
import type { PaneLeaf, PaneSplit, PaneNode } from "./panes";
import { loadLayout, validateLayout } from "../lib/paneLayout";
import { useWorkspaceStore } from "./workspace";
import { usePanePdfLinkStore, initPanePdfLinkCleanup, stopPanePdfLinkCleanup } from "./panePdfLink";

// ---------------------------------------------------------------------------
// Section A: Pure Tree Helpers (no store dependency)
// ---------------------------------------------------------------------------

describe("generatePaneId", () => {
  it("returns a non-empty string", () => {
    const id = generatePaneId();
    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(0);
  });

  it("two calls produce distinct values", () => {
    const a = generatePaneId();
    const b = generatePaneId();
    expect(a).not.toBe(b);
  });
});

describe("findLeaf", () => {
  it("finds leaf when root is a leaf", () => {
    const leaf: PaneLeaf = { type: "leaf", id: "a", pagePath: null };
    expect(findLeaf(leaf, "a")).toBe(leaf);
  });

  it("finds correct leaf in a split", () => {
    const target: PaneLeaf = { type: "leaf", id: "b", pagePath: "page.md" };
    const root: PaneSplit = {
      type: "split",
      id: "s1",
      direction: "horizontal",
      children: [
        { type: "leaf", id: "a", pagePath: null },
        target,
      ],
      sizes: [50, 50],
    };
    expect(findLeaf(root, "b")).toBe(target);
  });

  it("returns null for missing ID", () => {
    const leaf: PaneLeaf = { type: "leaf", id: "a", pagePath: null };
    expect(findLeaf(leaf, "missing")).toBeNull();
  });
});

describe("collectLeaves", () => {
  it("single leaf returns [leaf]", () => {
    const leaf: PaneLeaf = { type: "leaf", id: "a", pagePath: null };
    expect(collectLeaves(leaf)).toEqual([leaf]);
  });

  it("nested tree returns leaves in left-to-right order", () => {
    const l1: PaneLeaf = { type: "leaf", id: "1", pagePath: null };
    const l2: PaneLeaf = { type: "leaf", id: "2", pagePath: null };
    const l3: PaneLeaf = { type: "leaf", id: "3", pagePath: null };
    const root: PaneSplit = {
      type: "split",
      id: "s1",
      direction: "horizontal",
      children: [l1, { type: "split", id: "s2", direction: "vertical", children: [l2, l3], sizes: [50, 50] }],
      sizes: [50, 50],
    };
    expect(collectLeaves(root).map((l) => l.id)).toEqual(["1", "2", "3"]);
  });

  it("deep 4-leaf tree returns correct order", () => {
    const a: PaneLeaf = { type: "leaf", id: "a", pagePath: null };
    const b: PaneLeaf = { type: "leaf", id: "b", pagePath: null };
    const c: PaneLeaf = { type: "leaf", id: "c", pagePath: null };
    const d: PaneLeaf = { type: "leaf", id: "d", pagePath: null };
    const root: PaneSplit = {
      type: "split",
      id: "s1",
      direction: "horizontal",
      children: [
        { type: "split", id: "s2", direction: "vertical", children: [a, b], sizes: [50, 50] },
        { type: "split", id: "s3", direction: "vertical", children: [c, d], sizes: [50, 50] },
      ],
      sizes: [50, 50],
    };
    expect(collectLeaves(root).map((l) => l.id)).toEqual(["a", "b", "c", "d"]);
  });
});

describe("cycleLeafId", () => {
  const leaves: PaneLeaf[] = [
    { type: "leaf", id: "a", pagePath: null },
    { type: "leaf", id: "b", pagePath: null },
    { type: "leaf", id: "c", pagePath: null },
  ];

  it("returns next leaf id with delta +1", () => {
    expect(cycleLeafId(leaves, "a", 1)).toBe("b");
  });

  it("wraps forward from last to first", () => {
    expect(cycleLeafId(leaves, "c", 1)).toBe("a");
  });

  it("returns previous leaf id with delta -1", () => {
    expect(cycleLeafId(leaves, "c", -1)).toBe("b");
  });

  it("wraps backward from first to last", () => {
    expect(cycleLeafId(leaves, "a", -1)).toBe("c");
  });

  it("returns null when fromId is not in the list", () => {
    expect(cycleLeafId(leaves, "missing", 1)).toBeNull();
  });

  it("returns same id for single-element list", () => {
    const single: PaneLeaf[] = [{ type: "leaf", id: "only", pagePath: null }];
    expect(cycleLeafId(single, "only", 1)).toBe("only");
    expect(cycleLeafId(single, "only", -1)).toBe("only");
  });
});

describe("replaceLeaf", () => {
  it("replaces root leaf", () => {
    const root: PaneLeaf = { type: "leaf", id: "a", pagePath: null };
    const replacement: PaneSplit = {
      type: "split",
      id: "s1",
      direction: "horizontal",
      children: [
        { type: "leaf", id: "a", pagePath: null },
        { type: "leaf", id: "b", pagePath: null },
      ],
      sizes: [50, 50],
    };
    expect(replaceLeaf(root, "a", replacement)).toBe(replacement);
  });

  it("replaces leaf inside a split (sibling unchanged by reference)", () => {
    const sibling: PaneLeaf = { type: "leaf", id: "a", pagePath: null };
    const target: PaneLeaf = { type: "leaf", id: "b", pagePath: null };
    const root: PaneSplit = {
      type: "split",
      id: "s1",
      direction: "horizontal",
      children: [sibling, target],
      sizes: [50, 50],
    };
    const replacement: PaneLeaf = { type: "leaf", id: "b", pagePath: "new.md" };
    const result = replaceLeaf(root, "b", replacement) as PaneSplit;
    expect(result.children[1]).toBe(replacement);
    expect(result.children[0]).toBe(sibling);
  });

  it("returns tree unchanged (same ref) when ID not found", () => {
    const root: PaneSplit = {
      type: "split",
      id: "s1",
      direction: "horizontal",
      children: [
        { type: "leaf", id: "a", pagePath: null },
        { type: "leaf", id: "b", pagePath: null },
      ],
      sizes: [50, 50],
    };
    expect(replaceLeaf(root, "missing", { type: "leaf", id: "x", pagePath: null })).toBe(root);
  });
});

describe("removeLeaf", () => {
  it("single leaf → returns null (can't remove last)", () => {
    const root: PaneLeaf = { type: "leaf", id: "a", pagePath: null };
    expect(removeLeaf(root, "a")).toBeNull();
  });

  it("2-child split, remove one → promotes sibling", () => {
    const sibling: PaneLeaf = { type: "leaf", id: "a", pagePath: "a.md" };
    const root: PaneSplit = {
      type: "split",
      id: "s1",
      direction: "horizontal",
      children: [sibling, { type: "leaf", id: "b", pagePath: null }],
      sizes: [50, 50],
    };
    expect(removeLeaf(root, "b")).toBe(sibling);
  });

  it("3-child split, remove middle → 2-child split with normalized sizes", () => {
    const root: PaneSplit = {
      type: "split",
      id: "s1",
      direction: "horizontal",
      children: [
        { type: "leaf", id: "a", pagePath: null },
        { type: "leaf", id: "b", pagePath: null },
        { type: "leaf", id: "c", pagePath: null },
      ],
      sizes: [30, 40, 30],
    };
    const result = removeLeaf(root, "b") as PaneSplit;
    expect(result.type).toBe("split");
    expect(result.children).toHaveLength(2);
    expect((result.children[0] as PaneLeaf).id).toBe("a");
    expect((result.children[1] as PaneLeaf).id).toBe("c");
    // Sizes should be normalized to sum to 100
    expect(result.sizes[0]! + result.sizes[1]!).toBeCloseTo(100);
    expect(result.sizes[0]).toBeCloseTo(50);
    expect(result.sizes[1]).toBeCloseTo(50);
  });

  it("nested tree, remove inner leaf → inner split collapses, outer absorbs", () => {
    const innerSibling: PaneLeaf = { type: "leaf", id: "inner-a", pagePath: null };
    const root: PaneSplit = {
      type: "split",
      id: "s1",
      direction: "horizontal",
      children: [
        { type: "leaf", id: "outer-a", pagePath: null },
        {
          type: "split",
          id: "s2",
          direction: "vertical",
          children: [innerSibling, { type: "leaf", id: "inner-b", pagePath: null }],
          sizes: [50, 50],
        },
      ],
      sizes: [50, 50],
    };
    const result = removeLeaf(root, "inner-b") as PaneSplit;
    expect(result.type).toBe("split");
    expect(result.children).toHaveLength(2);
    expect(result.children[1]).toBe(innerSibling);
  });

  it("missing ID → returns tree unchanged (same ref)", () => {
    const root: PaneSplit = {
      type: "split",
      id: "s1",
      direction: "horizontal",
      children: [
        { type: "leaf", id: "a", pagePath: null },
        { type: "leaf", id: "b", pagePath: null },
      ],
      sizes: [50, 50],
    };
    expect(removeLeaf(root, "missing")).toBe(root);
  });
});

describe("findSplitByPath", () => {
  it("empty path on split returns root", () => {
    const root: PaneSplit = {
      type: "split",
      id: "s1",
      direction: "horizontal",
      children: [
        { type: "leaf", id: "a", pagePath: null },
        { type: "leaf", id: "b", pagePath: null },
      ],
      sizes: [50, 50],
    };
    expect(findSplitByPath(root, [])).toBe(root);
  });

  it("empty path on leaf returns null", () => {
    const root: PaneLeaf = { type: "leaf", id: "a", pagePath: null };
    expect(findSplitByPath(root, [])).toBeNull();
  });

  it("path [1] navigates to nested split", () => {
    const nested: PaneSplit = {
      type: "split",
      id: "s2",
      direction: "vertical",
      children: [
        { type: "leaf", id: "b", pagePath: null },
        { type: "leaf", id: "c", pagePath: null },
      ],
      sizes: [50, 50],
    };
    const root: PaneSplit = {
      type: "split",
      id: "s1",
      direction: "horizontal",
      children: [{ type: "leaf", id: "a", pagePath: null }, nested],
      sizes: [50, 50],
    };
    expect(findSplitByPath(root, [1])).toBe(nested);
  });

  it("path to a leaf child returns null", () => {
    const root: PaneSplit = {
      type: "split",
      id: "s1",
      direction: "horizontal",
      children: [
        { type: "leaf", id: "a", pagePath: null },
        { type: "leaf", id: "b", pagePath: null },
      ],
      sizes: [50, 50],
    };
    expect(findSplitByPath(root, [0])).toBeNull();
  });

  it("invalid path returns null", () => {
    const root: PaneSplit = {
      type: "split",
      id: "s1",
      direction: "horizontal",
      children: [
        { type: "leaf", id: "a", pagePath: null },
        { type: "leaf", id: "b", pagePath: null },
      ],
      sizes: [50, 50],
    };
    expect(findSplitByPath(root, [5])).toBeNull();
  });
});

describe("replaceSplitSizes", () => {
  it("replaces sizes at root (empty path)", () => {
    const root: PaneSplit = {
      type: "split",
      id: "s1",
      direction: "horizontal",
      children: [
        { type: "leaf", id: "a", pagePath: null },
        { type: "leaf", id: "b", pagePath: null },
      ],
      sizes: [50, 50],
    };
    const result = replaceSplitSizes(root, [], [30, 70]) as PaneSplit;
    expect(result.sizes).toEqual([30, 70]);
    expect(result.children).toBe(root.children);
    expect(result).not.toBe(root);
  });

  it("replaces sizes at nested path", () => {
    const nested: PaneSplit = {
      type: "split",
      id: "s2",
      direction: "vertical",
      children: [
        { type: "leaf", id: "b", pagePath: null },
        { type: "leaf", id: "c", pagePath: null },
      ],
      sizes: [50, 50],
    };
    const outerLeaf: PaneLeaf = { type: "leaf", id: "a", pagePath: null };
    const root: PaneSplit = {
      type: "split",
      id: "s1",
      direction: "horizontal",
      children: [outerLeaf, nested],
      sizes: [40, 60],
    };
    const result = replaceSplitSizes(root, [1], [25, 75]) as PaneSplit;
    expect(result.sizes).toEqual([40, 60]);
    expect((result.children[1] as PaneSplit).sizes).toEqual([25, 75]);
    expect(result.children[0]).toBe(outerLeaf);
  });

  it("returns same ref when path is invalid", () => {
    const root: PaneSplit = {
      type: "split",
      id: "s1",
      direction: "horizontal",
      children: [
        { type: "leaf", id: "a", pagePath: null },
        { type: "leaf", id: "b", pagePath: null },
      ],
      sizes: [50, 50],
    };
    expect(replaceSplitSizes(root, [5], [30, 70])).toBe(root);
  });

  it("returns same ref when target is a leaf", () => {
    const root: PaneLeaf = { type: "leaf", id: "a", pagePath: null };
    expect(replaceSplitSizes(root, [], [50, 50])).toBe(root);
  });
});

describe("clearPagePath", () => {
  it("sets matching leaf pagePaths to null", () => {
    const keep: PaneLeaf = { type: "leaf", id: "a", pagePath: "keep.md" };
    const deleted: PaneLeaf = { type: "leaf", id: "b", pagePath: "deleted.md" };
    const root: PaneSplit = {
      type: "split",
      id: "s1",
      direction: "horizontal",
      children: [deleted, keep],
      sizes: [50, 50],
    };
    const result = clearPagePath(root, "deleted.md") as PaneSplit;
    expect((result.children[0] as PaneLeaf).pagePath).toBeNull();
    expect(result.children[1]).toBe(keep);
  });

  it("handles multiple matching panes", () => {
    const a: PaneLeaf = { type: "leaf", id: "a", pagePath: "deleted.md" };
    const b: PaneLeaf = { type: "leaf", id: "b", pagePath: "keep.md" };
    const c: PaneLeaf = { type: "leaf", id: "c", pagePath: "deleted.md" };
    const root: PaneSplit = {
      type: "split",
      id: "s1",
      direction: "horizontal",
      children: [a, b, c],
      sizes: [33, 34, 33],
    };
    const result = clearPagePath(root, "deleted.md") as PaneSplit;
    expect((result.children[0] as PaneLeaf).pagePath).toBeNull();
    expect((result.children[1] as PaneLeaf).pagePath).toBe("keep.md");
    expect((result.children[2] as PaneLeaf).pagePath).toBeNull();
  });

  it("returns same reference when no match", () => {
    const root: PaneSplit = {
      type: "split",
      id: "s1",
      direction: "horizontal",
      children: [
        { type: "leaf", id: "a", pagePath: "other.md" },
        { type: "leaf", id: "b", pagePath: "another.md" },
      ],
      sizes: [50, 50],
    };
    expect(clearPagePath(root, "deleted.md")).toBe(root);
  });

  it("works on single-leaf root", () => {
    const leaf: PaneLeaf = { type: "leaf", id: "a", pagePath: "deleted.md" };
    const result = clearPagePath(leaf, "deleted.md") as PaneLeaf;
    expect(result.pagePath).toBeNull();

    const other: PaneLeaf = { type: "leaf", id: "b", pagePath: "other.md" };
    expect(clearPagePath(other, "deleted.md")).toBe(other);
  });
});

describe("rotateChildren", () => {
  it("returns leaf unchanged", () => {
    const leaf: PaneLeaf = { type: "leaf", id: "a", pagePath: null };
    expect(rotateChildren(leaf)).toBe(leaf);
  });

  it("swaps 2-child split ([A,B] → [B,A])", () => {
    const a: PaneLeaf = { type: "leaf", id: "a", pagePath: "a.md" };
    const b: PaneLeaf = { type: "leaf", id: "b", pagePath: "b.md" };
    const root: PaneSplit = {
      type: "split", id: "s1", direction: "horizontal",
      children: [a, b], sizes: [30, 70],
    };
    const result = rotateChildren(root) as PaneSplit;
    expect(result.children).toEqual([b, a]);
    expect(result.sizes).toEqual([70, 30]);
  });

  it("rotates 3-child split ([A,B,C] → [B,C,A])", () => {
    const a: PaneLeaf = { type: "leaf", id: "a", pagePath: null };
    const b: PaneLeaf = { type: "leaf", id: "b", pagePath: null };
    const c: PaneLeaf = { type: "leaf", id: "c", pagePath: null };
    const root: PaneSplit = {
      type: "split", id: "s1", direction: "horizontal",
      children: [a, b, c], sizes: [20, 30, 50],
    };
    const result = rotateChildren(root) as PaneSplit;
    expect(result.children).toEqual([b, c, a]);
    expect(result.sizes).toEqual([30, 50, 20]);
  });

  it("does not recurse into nested sub-splits", () => {
    const inner: PaneSplit = {
      type: "split", id: "s2", direction: "vertical",
      children: [
        { type: "leaf", id: "b", pagePath: null },
        { type: "leaf", id: "c", pagePath: null },
      ],
      sizes: [40, 60],
    };
    const a: PaneLeaf = { type: "leaf", id: "a", pagePath: null };
    const root: PaneSplit = {
      type: "split", id: "s1", direction: "horizontal",
      children: [a, inner], sizes: [50, 50],
    };
    const result = rotateChildren(root) as PaneSplit;
    expect(result.children[0]).toBe(inner);
    expect(result.children[1]).toBe(a);
    expect((result.children[0] as PaneSplit).children.map((c) => (c as PaneLeaf).id)).toEqual(["b", "c"]);
  });

  it("N rotations on N children restores original", () => {
    const a: PaneLeaf = { type: "leaf", id: "a", pagePath: null };
    const b: PaneLeaf = { type: "leaf", id: "b", pagePath: null };
    const c: PaneLeaf = { type: "leaf", id: "c", pagePath: null };
    const root: PaneSplit = {
      type: "split", id: "s1", direction: "horizontal",
      children: [a, b, c], sizes: [20, 30, 50],
    };
    let current: PaneNode = root;
    for (let i = 0; i < 3; i++) current = rotateChildren(current);
    const result = current as PaneSplit;
    expect(result.children.map((c) => (c as PaneLeaf).id)).toEqual(["a", "b", "c"]);
    expect(result.sizes).toEqual([20, 30, 50]);
  });
});

describe("getPanePosition", () => {
  it("returns null for a single leaf root", () => {
    const leaf: PaneLeaf = { type: "leaf", id: "a", pagePath: null };
    expect(getPanePosition(leaf, "a")).toBeNull();
  });

  it("returns null when pane not found", () => {
    const root: PaneSplit = {
      type: "split",
      id: "s1",
      direction: "horizontal",
      children: [
        { type: "leaf", id: "a", pagePath: null },
        { type: "leaf", id: "b", pagePath: null },
      ],
      sizes: [50, 50],
    };
    expect(getPanePosition(root, "missing")).toBeNull();
  });

  it("2-child horizontal → left / right", () => {
    const root: PaneSplit = {
      type: "split",
      id: "s1",
      direction: "horizontal",
      children: [
        { type: "leaf", id: "a", pagePath: null },
        { type: "leaf", id: "b", pagePath: null },
      ],
      sizes: [50, 50],
    };
    expect(getPanePosition(root, "a")).toBe("left");
    expect(getPanePosition(root, "b")).toBe("right");
  });

  it("2-child vertical → top / bottom", () => {
    const root: PaneSplit = {
      type: "split",
      id: "s1",
      direction: "vertical",
      children: [
        { type: "leaf", id: "a", pagePath: null },
        { type: "leaf", id: "b", pagePath: null },
      ],
      sizes: [50, 50],
    };
    expect(getPanePosition(root, "a")).toBe("top");
    expect(getPanePosition(root, "b")).toBe("bottom");
  });

  it("3-child horizontal → left / center / right", () => {
    const root: PaneSplit = {
      type: "split",
      id: "s1",
      direction: "horizontal",
      children: [
        { type: "leaf", id: "a", pagePath: null },
        { type: "leaf", id: "b", pagePath: null },
        { type: "leaf", id: "c", pagePath: null },
      ],
      sizes: [33, 34, 33],
    };
    expect(getPanePosition(root, "a")).toBe("left");
    expect(getPanePosition(root, "b")).toBe("center");
    expect(getPanePosition(root, "c")).toBe("right");
  });

  it("3-child vertical → top / center / bottom", () => {
    const root: PaneSplit = {
      type: "split",
      id: "s1",
      direction: "vertical",
      children: [
        { type: "leaf", id: "a", pagePath: null },
        { type: "leaf", id: "b", pagePath: null },
        { type: "leaf", id: "c", pagePath: null },
      ],
      sizes: [33, 34, 33],
    };
    expect(getPanePosition(root, "a")).toBe("top");
    expect(getPanePosition(root, "b")).toBe("center");
    expect(getPanePosition(root, "c")).toBe("bottom");
  });

  it("4-child horizontal → col-1 / col-2 / col-3 / col-4", () => {
    const root: PaneSplit = {
      type: "split",
      id: "s1",
      direction: "horizontal",
      children: [
        { type: "leaf", id: "a", pagePath: null },
        { type: "leaf", id: "b", pagePath: null },
        { type: "leaf", id: "c", pagePath: null },
        { type: "leaf", id: "d", pagePath: null },
      ],
      sizes: [25, 25, 25, 25],
    };
    expect(getPanePosition(root, "a")).toBe("col-1");
    expect(getPanePosition(root, "d")).toBe("col-4");
  });

  it("4-child vertical → row-1 / row-2 / row-3 / row-4", () => {
    const root: PaneSplit = {
      type: "split",
      id: "s1",
      direction: "vertical",
      children: [
        { type: "leaf", id: "a", pagePath: null },
        { type: "leaf", id: "b", pagePath: null },
        { type: "leaf", id: "c", pagePath: null },
        { type: "leaf", id: "d", pagePath: null },
      ],
      sizes: [25, 25, 25, 25],
    };
    expect(getPanePosition(root, "a")).toBe("row-1");
    expect(getPanePosition(root, "d")).toBe("row-4");
  });

  it("nested: horizontal root + vertical sub-split → composed labels", () => {
    const root: PaneSplit = {
      type: "split",
      id: "s1",
      direction: "horizontal",
      children: [
        { type: "leaf", id: "a", pagePath: null },
        {
          type: "split",
          id: "s2",
          direction: "vertical",
          children: [
            { type: "leaf", id: "b", pagePath: null },
            { type: "leaf", id: "c", pagePath: null },
          ],
          sizes: [50, 50],
        },
      ],
      sizes: [50, 50],
    };
    expect(getPanePosition(root, "a")).toBe("left");
    expect(getPanePosition(root, "b")).toBe("top-right");
    expect(getPanePosition(root, "c")).toBe("bottom-right");
  });

  it("nested: vertical sub-split on left side", () => {
    const root: PaneSplit = {
      type: "split",
      id: "s1",
      direction: "horizontal",
      children: [
        {
          type: "split",
          id: "s2",
          direction: "vertical",
          children: [
            { type: "leaf", id: "a", pagePath: null },
            { type: "leaf", id: "b", pagePath: null },
          ],
          sizes: [50, 50],
        },
        { type: "leaf", id: "c", pagePath: null },
      ],
      sizes: [50, 50],
    };
    expect(getPanePosition(root, "a")).toBe("top-left");
    expect(getPanePosition(root, "b")).toBe("bottom-left");
    expect(getPanePosition(root, "c")).toBe("right");
  });

  it("3-level nesting → 3-segment labels", () => {
    const root: PaneSplit = {
      type: "split",
      id: "s1",
      direction: "horizontal",
      children: [
        {
          type: "split",
          id: "s2",
          direction: "vertical",
          children: [
            { type: "leaf", id: "a", pagePath: null },
            {
              type: "split",
              id: "s3",
              direction: "horizontal",
              children: [
                { type: "leaf", id: "b", pagePath: null },
                { type: "leaf", id: "c", pagePath: null },
              ],
              sizes: [50, 50],
            },
          ],
          sizes: [50, 50],
        },
        { type: "leaf", id: "d", pagePath: null },
      ],
      sizes: [50, 50],
    };
    expect(getPanePosition(root, "a")).toBe("top-left");
    expect(getPanePosition(root, "b")).toBe("left-bottom-left");
    expect(getPanePosition(root, "c")).toBe("right-bottom-left");
    expect(getPanePosition(root, "d")).toBe("right");
  });
});

// ---------------------------------------------------------------------------
// Section B: Zustand Store
// ---------------------------------------------------------------------------

describe("Section B: Store", () => {
  describe("initial state", () => {
    it("createInitialState root is a leaf with pagePath: null", () => {
      const state = createInitialState();
      expect(state.root.type).toBe("leaf");
      expect((state.root as PaneLeaf).pagePath).toBeNull();
    });

    it("createInitialState focusedPaneId matches root leaf id", () => {
      const state = createInitialState();
      expect(state.focusedPaneId).toBe((state.root as PaneLeaf).id);
    });

    it("createInitialState root leaf has a non-empty id", () => {
      const state = createInitialState();
      expect((state.root as PaneLeaf).id.length).toBeGreaterThan(0);
    });

    it("store default state has a leaf root", () => {
      usePaneStore.setState(createInitialState());
      const { root } = usePaneStore.getState();
      expect(root.type).toBe("leaf");
    });
  });

  describe("focusPane", () => {
    beforeEach(() => {
      const left: PaneLeaf = { type: "leaf", id: "left", pagePath: null };
      const right: PaneLeaf = { type: "leaf", id: "right", pagePath: null };
      const root: PaneSplit = {
        type: "split",
        id: "s1",
        direction: "horizontal",
        children: [left, right],
        sizes: [50, 50],
      };
      usePaneStore.setState({ root, focusedPaneId: "left" });
    });

    it("sets focusedPaneId to an existing leaf", () => {
      usePaneStore.getState().focusPane("right");
      expect(usePaneStore.getState().focusedPaneId).toBe("right");
    });

    it("no-op for nonexistent pane id", () => {
      usePaneStore.getState().focusPane("nonexistent");
      expect(usePaneStore.getState().focusedPaneId).toBe("left");
    });
  });

  describe("setPanePage", () => {
    beforeEach(() => {
      usePaneStore.setState({
        root: { type: "leaf", id: "test-root", pagePath: null },
        focusedPaneId: "test-root",
      });
    });

    it("sets pagePath on target leaf", () => {
      usePaneStore.getState().setPanePage("test-root", "hello.md");
      const leaf = findLeaf(usePaneStore.getState().root, "test-root");
      expect(leaf!.pagePath).toBe("hello.md");
    });

    it("passing null clears pagePath", () => {
      usePaneStore.getState().setPanePage("test-root", "hello.md");
      usePaneStore.getState().setPanePage("test-root", null);
      const leaf = findLeaf(usePaneStore.getState().root, "test-root");
      expect(leaf!.pagePath).toBeNull();
    });

    it("no-op for missing pane: root is same reference", () => {
      const before = usePaneStore.getState().root;
      usePaneStore.getState().setPanePage("missing", "hello.md");
      expect(usePaneStore.getState().root).toBe(before);
    });

    it("no-op when pagePath is already the target value (root same ref)", () => {
      usePaneStore.getState().setPanePage("test-root", "same.md");
      const before = usePaneStore.getState().root;
      usePaneStore.getState().setPanePage("test-root", "same.md");
      expect(usePaneStore.getState().root).toBe(before);
    });
  });

  describe("resize", () => {
    const makeNestedTree = () => {
      const inner: PaneSplit = {
        type: "split",
        id: "s2",
        direction: "vertical",
        children: [
          { type: "leaf", id: "b", pagePath: null },
          { type: "leaf", id: "c", pagePath: null },
        ],
        sizes: [50, 50],
      };
      const root: PaneSplit = {
        type: "split",
        id: "s1",
        direction: "horizontal",
        children: [{ type: "leaf", id: "a", pagePath: null }, inner],
        sizes: [40, 60],
      };
      return root;
    };

    beforeEach(() => {
      usePaneStore.setState({
        root: makeNestedTree(),
        focusedPaneId: "a",
      });
    });

    it("updates root split sizes (empty path)", () => {
      usePaneStore.getState().resize([], [30, 70]);
      const root = usePaneStore.getState().root as PaneSplit;
      expect(root.sizes).toEqual([30, 70]);
    });

    it("updates nested split sizes; outer sizes unchanged", () => {
      usePaneStore.getState().resize([1], [25, 75]);
      const root = usePaneStore.getState().root as PaneSplit;
      expect(root.sizes).toEqual([40, 60]);
      expect((root.children[1] as PaneSplit).sizes).toEqual([25, 75]);
    });

    it("no-op when sizes.length mismatches children count", () => {
      const before = usePaneStore.getState().root;
      usePaneStore.getState().resize([], [30, 40, 30]);
      expect(usePaneStore.getState().root).toBe(before);
    });

    it("no-op for invalid path (root same ref)", () => {
      const before = usePaneStore.getState().root;
      usePaneStore.getState().resize([5], [50, 50]);
      expect(usePaneStore.getState().root).toBe(before);
    });
  });

  describe("clearPageFromPanes", () => {
    it("updates pane store root", () => {
      const left: PaneLeaf = { type: "leaf", id: "left", pagePath: "deleted.md" };
      const right: PaneLeaf = { type: "leaf", id: "right", pagePath: "keep.md" };
      const root: PaneSplit = {
        type: "split",
        id: "s1",
        direction: "horizontal",
        children: [left, right],
        sizes: [50, 50],
      };
      usePaneStore.setState({ root, focusedPaneId: "left" });
      usePaneStore.getState().clearPageFromPanes("deleted.md");
      const newRoot = usePaneStore.getState().root as PaneSplit;
      expect((newRoot.children[0] as PaneLeaf).pagePath).toBeNull();
      expect((newRoot.children[1] as PaneLeaf).pagePath).toBe("keep.md");
    });
  });

  describe("swapLayout", () => {
    it("no-op for single pane", () => {
      const root: PaneLeaf = { type: "leaf", id: "solo", pagePath: null };
      usePaneStore.setState({ root, focusedPaneId: "solo" });
      usePaneStore.getState().swapLayout();
      expect(usePaneStore.getState().root).toBe(root);
    });

    it("swaps 2-pane layout", () => {
      const left: PaneLeaf = { type: "leaf", id: "left", pagePath: "a.md" };
      const right: PaneLeaf = { type: "leaf", id: "right", pagePath: "b.md" };
      const root: PaneSplit = {
        type: "split", id: "s1", direction: "horizontal",
        children: [left, right], sizes: [30, 70],
      };
      usePaneStore.setState({ root, focusedPaneId: "left" });
      usePaneStore.getState().swapLayout();
      const newRoot = usePaneStore.getState().root as PaneSplit;
      expect((newRoot.children[0] as PaneLeaf).id).toBe("right");
      expect((newRoot.children[1] as PaneLeaf).id).toBe("left");
      expect(newRoot.sizes).toEqual([70, 30]);
    });

    it("preserves focusedPaneId", () => {
      const left: PaneLeaf = { type: "leaf", id: "left", pagePath: null };
      const right: PaneLeaf = { type: "leaf", id: "right", pagePath: null };
      const root: PaneSplit = {
        type: "split", id: "s1", direction: "horizontal",
        children: [left, right], sizes: [50, 50],
      };
      usePaneStore.setState({ root, focusedPaneId: "left" });
      usePaneStore.getState().swapLayout();
      expect(usePaneStore.getState().focusedPaneId).toBe("left");
    });

    it("double-swap restores original order", () => {
      const left: PaneLeaf = { type: "leaf", id: "left", pagePath: "a.md" };
      const right: PaneLeaf = { type: "leaf", id: "right", pagePath: "b.md" };
      const root: PaneSplit = {
        type: "split", id: "s1", direction: "horizontal",
        children: [left, right], sizes: [30, 70],
      };
      usePaneStore.setState({ root, focusedPaneId: "left" });
      usePaneStore.getState().swapLayout();
      usePaneStore.getState().swapLayout();
      const newRoot = usePaneStore.getState().root as PaneSplit;
      expect((newRoot.children[0] as PaneLeaf).id).toBe("left");
      expect((newRoot.children[1] as PaneLeaf).id).toBe("right");
      expect(newRoot.sizes).toEqual([30, 70]);
    });
  });
});

// ---------------------------------------------------------------------------
// Section C: Tree-Mutation Actions
// ---------------------------------------------------------------------------

describe("Section C: Tree-Mutation Actions", () => {
  describe("splitPane", () => {
    describe("basic — split the only leaf", () => {
      beforeEach(() => {
        usePaneStore.setState({
          root: { type: "leaf", id: "solo", pagePath: "note.md" },
          focusedPaneId: "solo",
        });
        usePaneStore.getState().splitPane("solo", "horizontal");
      });

      it("root becomes split with direction matching arg, 2 children, sizes [50, 50]", () => {
        const root = usePaneStore.getState().root as PaneSplit;
        expect(root.type).toBe("split");
        expect(root.direction).toBe("horizontal");
        expect(root.children).toHaveLength(2);
        expect(root.sizes).toEqual([50, 50]);
      });

      it("original leaf preserved as first child (same ID, same pagePath)", () => {
        const root = usePaneStore.getState().root as PaneSplit;
        const first = root.children[0] as PaneLeaf;
        expect(first.type).toBe("leaf");
        expect(first.id).toBe("solo");
        expect(first.pagePath).toBe("note.md");
      });

      it("new leaf as second child with pagePath: null and different ID", () => {
        const root = usePaneStore.getState().root as PaneSplit;
        const second = root.children[1] as PaneLeaf;
        expect(second.type).toBe("leaf");
        expect(second.pagePath).toBeNull();
        expect(second.id).not.toBe("solo");
        expect(second.id.length).toBeGreaterThan(0);
      });

      it("focus transfers to the new pane", () => {
        const root = usePaneStore.getState().root as PaneSplit;
        const second = root.children[1] as PaneLeaf;
        expect(usePaneStore.getState().focusedPaneId).toBe(second.id);
      });

      it("assigns a unique string id to the created split node", () => {
        const root = usePaneStore.getState().root as PaneSplit;
        expect(typeof root.id).toBe("string");
        expect(root.id.length).toBeGreaterThan(0);
        const first = root.children[0] as PaneLeaf;
        const second = root.children[1] as PaneLeaf;
        expect(root.id).not.toBe(first.id);
        expect(root.id).not.toBe(second.id);
      });

      it("returns the new leaf id on success", () => {
        usePaneStore.setState({
          root: { type: "leaf", id: "solo", pagePath: "note.md" },
          focusedPaneId: "solo",
        });
        const newId = usePaneStore.getState().splitPane("solo", "horizontal");
        expect(newId).not.toBeNull();
        expect(typeof newId).toBe("string");
        const root = usePaneStore.getState().root as PaneSplit;
        expect((root.children[1] as PaneLeaf).id).toBe(newId);
      });

      it("nested splits get distinct ids", () => {
        const root = usePaneStore.getState().root as PaneSplit;
        const newLeaf = root.children[1] as PaneLeaf;
        usePaneStore.getState().splitPane(newLeaf.id, "vertical");

        const outerSplit = usePaneStore.getState().root as PaneSplit;
        const innerSplit = outerSplit.children[1] as PaneSplit;
        expect(typeof outerSplit.id).toBe("string");
        expect(outerSplit.id.length).toBeGreaterThan(0);
        expect(typeof innerSplit.id).toBe("string");
        expect(innerSplit.id.length).toBeGreaterThan(0);
        expect(outerSplit.id).not.toBe(innerSplit.id);
        const allLeaves = collectLeaves(usePaneStore.getState().root);
        for (const leaf of allLeaves) {
          expect(outerSplit.id).not.toBe(leaf.id);
          expect(innerSplit.id).not.toBe(leaf.id);
        }
      });
    });

    describe("nested — split inside existing split", () => {
      it("splitting a leaf inside a split creates nested splits", () => {
        const left: PaneLeaf = { type: "leaf", id: "left", pagePath: null };
        const right: PaneLeaf = { type: "leaf", id: "right", pagePath: null };
        const root: PaneSplit = {
          type: "split",
          id: "s1",
          direction: "horizontal",
          children: [left, right],
          sizes: [50, 50],
        };
        usePaneStore.setState({ root, focusedPaneId: "left" });
        usePaneStore.getState().splitPane("right", "vertical");

        const newRoot = usePaneStore.getState().root as PaneSplit;
        expect(newRoot.type).toBe("split");
        expect(newRoot.direction).toBe("horizontal");
        const nested = newRoot.children[1] as PaneSplit;
        expect(nested.type).toBe("split");
        expect(nested.direction).toBe("vertical");
        expect(nested.children).toHaveLength(2);
      });

      it("original sibling unchanged by reference", () => {
        const left: PaneLeaf = { type: "leaf", id: "left", pagePath: null };
        const right: PaneLeaf = { type: "leaf", id: "right", pagePath: null };
        const root: PaneSplit = {
          type: "split",
          id: "s1",
          direction: "horizontal",
          children: [left, right],
          sizes: [50, 50],
        };
        usePaneStore.setState({ root, focusedPaneId: "left" });
        usePaneStore.getState().splitPane("right", "vertical");

        const newRoot = usePaneStore.getState().root as PaneSplit;
        expect(newRoot.children[0]).toBe(left);
      });

      it("no-op for non-existent pane", () => {
        const root: PaneLeaf = { type: "leaf", id: "solo", pagePath: null };
        usePaneStore.setState({ root, focusedPaneId: "solo" });
        usePaneStore.getState().splitPane("nonexistent", "horizontal");
        expect(usePaneStore.getState().root).toBe(root);
      });

      it("returns null for non-existent pane", () => {
        const root: PaneLeaf = { type: "leaf", id: "solo", pagePath: null };
        usePaneStore.setState({ root, focusedPaneId: "solo" });
        const result = usePaneStore.getState().splitPane("nonexistent", "horizontal");
        expect(result).toBeNull();
      });
    });

    describe("max-pane cap", () => {
      it("MAX_PANES is exported and equals 6", () => {
        expect(MAX_PANES).toBe(6);
      });

      it("returns null when already at MAX_PANES", () => {
        const leaves = Array.from({ length: 6 }, (_, i): PaneLeaf => ({ type: "leaf", id: `l${i}`, pagePath: null }));
        const root: PaneSplit = {
          type: "split", id: "s1", direction: "horizontal",
          children: leaves, sizes: leaves.map(() => 100 / 6),
        };
        usePaneStore.setState({ root, focusedPaneId: "l0" });
        const result = usePaneStore.getState().splitPane("l0", "horizontal");
        expect(result).toBeNull();
      });

      it("splitPane is a no-op when already at MAX_PANES leaves", () => {
        const leaves = Array.from({ length: 6 }, (_, i): PaneLeaf => ({ type: "leaf", id: `l${i}`, pagePath: null }));
        const root: PaneSplit = {
          type: "split", id: "s1", direction: "horizontal",
          children: leaves, sizes: leaves.map(() => 100 / 6),
        };
        usePaneStore.setState({ root, focusedPaneId: "l0" });
        usePaneStore.getState().splitPane("l0", "horizontal");
        expect(usePaneStore.getState().root).toBe(root);
      });

      it("splitPane works when at MAX_PANES - 1 leaves", () => {
        const leaves = Array.from({ length: 5 }, (_, i): PaneLeaf => ({ type: "leaf", id: `l${i}`, pagePath: null }));
        const root: PaneSplit = {
          type: "split", id: "s1", direction: "horizontal",
          children: leaves, sizes: leaves.map(() => 100 / 5),
        };
        usePaneStore.setState({ root, focusedPaneId: "l0" });
        usePaneStore.getState().splitPane("l0", "horizontal");
        expect(collectLeaves(usePaneStore.getState().root)).toHaveLength(6);
      });

      it("splitPane is a no-op at MAX_PANES even for nested trees", () => {
        const leftLeaves = Array.from({ length: 3 }, (_, i): PaneLeaf => ({ type: "leaf", id: `left${i}`, pagePath: null }));
        const rightLeaves = Array.from({ length: 3 }, (_, i): PaneLeaf => ({ type: "leaf", id: `right${i}`, pagePath: null }));
        const root: PaneSplit = {
          type: "split", id: "s1", direction: "horizontal",
          children: [
            { type: "split", id: "s2", direction: "vertical", children: leftLeaves, sizes: [33, 34, 33] },
            { type: "split", id: "s3", direction: "vertical", children: rightLeaves, sizes: [33, 34, 33] },
          ],
          sizes: [50, 50],
        };
        usePaneStore.setState({ root, focusedPaneId: "left0" });
        usePaneStore.getState().splitPane("left0", "horizontal");
        expect(usePaneStore.getState().root).toBe(root);
      });
    });
  });

  describe("closePane", () => {
    describe("basic", () => {
      it("close one of two → root collapses to remaining leaf", () => {
        const left: PaneLeaf = { type: "leaf", id: "left", pagePath: "a.md" };
        const right: PaneLeaf = { type: "leaf", id: "right", pagePath: null };
        const root: PaneSplit = {
          type: "split",
          id: "s1",
          direction: "horizontal",
          children: [left, right],
          sizes: [50, 50],
        };
        usePaneStore.setState({ root, focusedPaneId: "right" });
        usePaneStore.getState().closePane("right");

        expect(usePaneStore.getState().root).toBe(left);
      });

      it("closing the focused pane → focus moves to remaining leaf", () => {
        const left: PaneLeaf = { type: "leaf", id: "left", pagePath: null };
        const right: PaneLeaf = { type: "leaf", id: "right", pagePath: null };
        const root: PaneSplit = {
          type: "split",
          id: "s1",
          direction: "horizontal",
          children: [left, right],
          sizes: [50, 50],
        };
        usePaneStore.setState({ root, focusedPaneId: "right" });
        usePaneStore.getState().closePane("right");

        expect(usePaneStore.getState().focusedPaneId).toBe("left");
      });

      it("close last pane with content → clears pagePath", () => {
        const root: PaneLeaf = { type: "leaf", id: "solo", pagePath: "notes/foo.md" };
        usePaneStore.setState({ root, focusedPaneId: "solo" });
        usePaneStore.getState().closePane("solo");

        const state = usePaneStore.getState();
        expect(state.root).toEqual({ type: "leaf", id: "solo", pagePath: null });
        expect(state.focusedPaneId).toBe("solo");
      });

      it("close last pane already empty → no-op", () => {
        const root: PaneLeaf = { type: "leaf", id: "solo", pagePath: null };
        usePaneStore.setState({ root, focusedPaneId: "solo" });
        usePaneStore.getState().closePane("solo");

        expect(usePaneStore.getState().root).toBe(root);
        expect(usePaneStore.getState().focusedPaneId).toBe("solo");
      });

      it("close non-existent pane → no-op", () => {
        const left: PaneLeaf = { type: "leaf", id: "left", pagePath: null };
        const right: PaneLeaf = { type: "leaf", id: "right", pagePath: null };
        const root: PaneSplit = {
          type: "split",
          id: "s1",
          direction: "horizontal",
          children: [left, right],
          sizes: [50, 50],
        };
        usePaneStore.setState({ root, focusedPaneId: "left" });
        usePaneStore.getState().closePane("nonexistent");

        expect(usePaneStore.getState().root).toBe(root);
        expect(usePaneStore.getState().focusedPaneId).toBe("left");
      });
    });

    describe("companion close sequence (issue #447)", () => {
      afterEach(() => {
        stopPanePdfLinkCleanup();
        usePanePdfLinkStore.setState({ links: new Map() });
      });

      it("closing md then pdf pane yields an empty leaf and a cleaned link map", () => {
        const md: PaneLeaf = { type: "leaf", id: "md", pagePath: "Notes.md" };
        const pdf: PaneLeaf = { type: "leaf", id: "pdf", pagePath: "doc.pdf" };
        const root: PaneSplit = {
          type: "split",
          id: "s1",
          direction: "horizontal",
          children: [md, pdf],
          sizes: [50, 50],
        };
        usePaneStore.setState({ root, focusedPaneId: "md" });
        usePanePdfLinkStore.getState().linkPanes("md", "pdf");
        initPanePdfLinkCleanup();

        usePaneStore.getState().closePane("md");
        expect(usePaneStore.getState().root).toBe(pdf);
        expect(usePaneStore.getState().focusedPaneId).toBe("pdf");
        expect(usePanePdfLinkStore.getState().links.size).toBe(0);

        usePaneStore.getState().closePane("pdf");
        expect(usePaneStore.getState().root).toEqual({ type: "leaf", id: "pdf", pagePath: null });
        expect(usePaneStore.getState().focusedPaneId).toBe("pdf");
      });
    });

    describe("deep tree + focus heuristics", () => {
      it("deep tree: close inner leaf → sibling promoted, outer structure correct", () => {
        const innerA: PaneLeaf = { type: "leaf", id: "inner-a", pagePath: null };
        const innerB: PaneLeaf = { type: "leaf", id: "inner-b", pagePath: null };
        const outerA: PaneLeaf = { type: "leaf", id: "outer-a", pagePath: null };
        const root: PaneSplit = {
          type: "split",
          id: "s1",
          direction: "horizontal",
          children: [
            outerA,
            { type: "split", id: "s2", direction: "vertical", children: [innerA, innerB], sizes: [50, 50] },
          ],
          sizes: [50, 50],
        };
        usePaneStore.setState({ root, focusedPaneId: "inner-b" });
        usePaneStore.getState().closePane("inner-b");

        const newRoot = usePaneStore.getState().root as PaneSplit;
        expect(newRoot.type).toBe("split");
        expect(newRoot.children).toHaveLength(2);
        expect(newRoot.children[0]).toBe(outerA);
        expect(newRoot.children[1]).toBe(innerA);
      });

      it("3-pane: close middle → focus moves to next leaf in order", () => {
        const a: PaneLeaf = { type: "leaf", id: "a", pagePath: null };
        const b: PaneLeaf = { type: "leaf", id: "b", pagePath: null };
        const c: PaneLeaf = { type: "leaf", id: "c", pagePath: null };
        const root: PaneSplit = {
          type: "split",
          id: "s1",
          direction: "horizontal",
          children: [a, b, c],
          sizes: [33, 34, 33],
        };
        usePaneStore.setState({ root, focusedPaneId: "b" });
        usePaneStore.getState().closePane("b");

        expect(usePaneStore.getState().focusedPaneId).toBe("c");
      });

      it("2-pane: close last in order → focus moves to previous", () => {
        const a: PaneLeaf = { type: "leaf", id: "a", pagePath: null };
        const b: PaneLeaf = { type: "leaf", id: "b", pagePath: null };
        const root: PaneSplit = {
          type: "split",
          id: "s1",
          direction: "horizontal",
          children: [a, b],
          sizes: [50, 50],
        };
        usePaneStore.setState({ root, focusedPaneId: "b" });
        usePaneStore.getState().closePane("b");

        expect(usePaneStore.getState().focusedPaneId).toBe("a");
      });

      it("close non-focused pane → focus preserved", () => {
        const a: PaneLeaf = { type: "leaf", id: "a", pagePath: null };
        const b: PaneLeaf = { type: "leaf", id: "b", pagePath: null };
        const c: PaneLeaf = { type: "leaf", id: "c", pagePath: null };
        const root: PaneSplit = {
          type: "split",
          id: "s1",
          direction: "horizontal",
          children: [a, b, c],
          sizes: [33, 34, 33],
        };
        usePaneStore.setState({ root, focusedPaneId: "a" });
        usePaneStore.getState().closePane("c");

        expect(usePaneStore.getState().focusedPaneId).toBe("a");
      });

      it("stale focusedPaneId: still removes pane and falls back to first leaf", () => {
        const a: PaneLeaf = { type: "leaf", id: "a", pagePath: null };
        const b: PaneLeaf = { type: "leaf", id: "b", pagePath: null };
        const root: PaneSplit = {
          type: "split",
          id: "s1",
          direction: "horizontal",
          children: [a, b],
          sizes: [50, 50],
        };
        usePaneStore.setState({ root, focusedPaneId: "stale-ghost" });
        usePaneStore.getState().closePane("b");

        expect(usePaneStore.getState().root).toBe(a);
        expect(usePaneStore.getState().focusedPaneId).toBe("a");
      });
    });
  });

  describe("focusNext / focusPrev", () => {
    it("focusNext advances to next leaf in left-to-right order", () => {
      const a: PaneLeaf = { type: "leaf", id: "a", pagePath: null };
      const b: PaneLeaf = { type: "leaf", id: "b", pagePath: null };
      const c: PaneLeaf = { type: "leaf", id: "c", pagePath: null };
      const root: PaneSplit = {
        type: "split",
        id: "s1",
        direction: "horizontal",
        children: [a, b, c],
        sizes: [33, 34, 33],
      };
      usePaneStore.setState({ root, focusedPaneId: "a" });
      usePaneStore.getState().focusNext();
      expect(usePaneStore.getState().focusedPaneId).toBe("b");
    });

    it("focusNext wraps from last to first", () => {
      const a: PaneLeaf = { type: "leaf", id: "a", pagePath: null };
      const b: PaneLeaf = { type: "leaf", id: "b", pagePath: null };
      const root: PaneSplit = {
        type: "split",
        id: "s1",
        direction: "horizontal",
        children: [a, b],
        sizes: [50, 50],
      };
      usePaneStore.setState({ root, focusedPaneId: "b" });
      usePaneStore.getState().focusNext();
      expect(usePaneStore.getState().focusedPaneId).toBe("a");
    });

    it("focusNext is no-op with single pane", () => {
      const root: PaneLeaf = { type: "leaf", id: "solo", pagePath: null };
      usePaneStore.setState({ root, focusedPaneId: "solo" });
      usePaneStore.getState().focusNext();
      expect(usePaneStore.getState().focusedPaneId).toBe("solo");
    });

    it("focusPrev goes to previous leaf", () => {
      const a: PaneLeaf = { type: "leaf", id: "a", pagePath: null };
      const b: PaneLeaf = { type: "leaf", id: "b", pagePath: null };
      const c: PaneLeaf = { type: "leaf", id: "c", pagePath: null };
      const root: PaneSplit = {
        type: "split",
        id: "s1",
        direction: "horizontal",
        children: [a, b, c],
        sizes: [33, 34, 33],
      };
      usePaneStore.setState({ root, focusedPaneId: "c" });
      usePaneStore.getState().focusPrev();
      expect(usePaneStore.getState().focusedPaneId).toBe("b");
    });

    it("focusPrev wraps from first to last", () => {
      const a: PaneLeaf = { type: "leaf", id: "a", pagePath: null };
      const b: PaneLeaf = { type: "leaf", id: "b", pagePath: null };
      const root: PaneSplit = {
        type: "split",
        id: "s1",
        direction: "horizontal",
        children: [a, b],
        sizes: [50, 50],
      };
      usePaneStore.setState({ root, focusedPaneId: "a" });
      usePaneStore.getState().focusPrev();
      expect(usePaneStore.getState().focusedPaneId).toBe("b");
    });

    it("focusNext with stale focusedPaneId: resets to first leaf", () => {
      const a: PaneLeaf = { type: "leaf", id: "a", pagePath: null };
      const b: PaneLeaf = { type: "leaf", id: "b", pagePath: null };
      const root: PaneSplit = {
        type: "split",
        id: "s1",
        direction: "horizontal",
        children: [a, b],
        sizes: [50, 50],
      };
      usePaneStore.setState({ root, focusedPaneId: "stale-ghost" });
      usePaneStore.getState().focusNext();
      expect(usePaneStore.getState().focusedPaneId).toBe("a");
    });

    it("focusPrev with stale focusedPaneId: resets to last leaf", () => {
      const a: PaneLeaf = { type: "leaf", id: "a", pagePath: null };
      const b: PaneLeaf = { type: "leaf", id: "b", pagePath: null };
      const root: PaneSplit = {
        type: "split",
        id: "s1",
        direction: "horizontal",
        children: [a, b],
        sizes: [50, 50],
      };
      usePaneStore.setState({ root, focusedPaneId: "stale-ghost" });
      usePaneStore.getState().focusPrev();
      expect(usePaneStore.getState().focusedPaneId).toBe("b");
    });
  });
});

// ---------------------------------------------------------------------------
// Section E: Integration & Edge Cases
// ---------------------------------------------------------------------------

describe("Section E: Integration & Edge Cases", () => {
  describe("Cycle 18: Complex multi-step scenarios", () => {
    beforeEach(() => {
      usePaneStore.setState({
        root: { type: "leaf", id: "A", pagePath: null },
        focusedPaneId: "A",
      });
    });

    it("split → split → close inner → correct tree structure", () => {
      usePaneStore.getState().splitPane("A", "horizontal");
      const afterFirst = usePaneStore.getState().root as PaneSplit;
      const B = (afterFirst.children[1] as PaneLeaf).id;

      usePaneStore.getState().splitPane(B, "vertical");
      const afterSecond = usePaneStore.getState().root as PaneSplit;
      const innerSplit = afterSecond.children[1] as PaneSplit;
      const C = (innerSplit.children[1] as PaneLeaf).id;

      usePaneStore.getState().closePane(C);

      const root = usePaneStore.getState().root as PaneSplit;
      expect(root.type).toBe("split");
      expect(root.direction).toBe("horizontal");
      expect(root.children).toHaveLength(2);
      expect((root.children[0] as PaneLeaf).id).toBe("A");
      expect((root.children[1] as PaneLeaf).id).toBe(B);
      expect(root.sizes).toEqual([50, 50]);
    });

    it("split → split → close outer → inner split promoted to root", () => {
      usePaneStore.getState().splitPane("A", "horizontal");
      const afterFirst = usePaneStore.getState().root as PaneSplit;
      const second = (afterFirst.children[1] as PaneLeaf).id;

      usePaneStore.getState().splitPane(second, "vertical");
      const afterSecond = usePaneStore.getState().root as PaneSplit;
      const innerSplit = afterSecond.children[1] as PaneSplit;
      const third = (innerSplit.children[1] as PaneLeaf).id;

      usePaneStore.getState().closePane("A");

      const root = usePaneStore.getState().root as PaneSplit;
      expect(root.type).toBe("split");
      expect(root.direction).toBe("vertical");
      expect(root.children).toHaveLength(2);
      expect((root.children[0] as PaneLeaf).id).toBe(second);
      expect((root.children[1] as PaneLeaf).id).toBe(third);
      expect(root.sizes).toEqual([50, 50]);
    });

    it("focus cycling correct after splits and closes", () => {
      usePaneStore.getState().splitPane("A", "horizontal");
      const afterFirst = usePaneStore.getState().root as PaneSplit;
      const secondId = (afterFirst.children[1] as PaneLeaf).id;

      usePaneStore.getState().splitPane(secondId, "vertical");
      const afterSecond = usePaneStore.getState().root as PaneSplit;
      const innerSplit = afterSecond.children[1] as PaneSplit;
      const middleId = (innerSplit.children[0] as PaneLeaf).id;

      usePaneStore.getState().closePane(middleId);

      const leaves = collectLeaves(usePaneStore.getState().root);
      expect(leaves).toHaveLength(2);

      usePaneStore.getState().focusPane(leaves[0]!.id);
      usePaneStore.getState().focusNext();
      expect(usePaneStore.getState().focusedPaneId).toBe(leaves[1]!.id);
      usePaneStore.getState().focusNext();
      expect(usePaneStore.getState().focusedPaneId).toBe(leaves[0]!.id);
    });
  });

  describe("Cycle 19: setPanePage interaction with mutations", () => {
    it("split preserves original pagePath", () => {
      usePaneStore.setState({
        root: { type: "leaf", id: "root", pagePath: null },
        focusedPaneId: "root",
      });
      usePaneStore.getState().setPanePage("root", "notes.md");
      usePaneStore.getState().splitPane("root", "horizontal");

      const split = usePaneStore.getState().root as PaneSplit;
      const original = split.children[0] as PaneLeaf;
      const newLeaf = split.children[1] as PaneLeaf;
      expect(original.pagePath).toBe("notes.md");
      expect(newLeaf.pagePath).toBeNull();
    });

    it("close doesn't affect other panes' pagePaths", () => {
      usePaneStore.setState({
        root: { type: "leaf", id: "root", pagePath: null },
        focusedPaneId: "root",
      });
      usePaneStore.getState().setPanePage("root", "keep.md");
      usePaneStore.getState().splitPane("root", "horizontal");

      const split = usePaneStore.getState().root as PaneSplit;
      const newLeafId = (split.children[1] as PaneLeaf).id;
      usePaneStore.getState().setPanePage(newLeafId, "discard.md");

      usePaneStore.getState().closePane(newLeafId);

      const remaining = usePaneStore.getState().root as PaneLeaf;
      expect(remaining.id).toBe("root");
      expect(remaining.pagePath).toBe("keep.md");
    });
  });

  describe("Cycle 21: store preserves tree after close (regression for #132)", () => {
    it("3-pane split+setPanePage → close middle → 2-child split with correct pagePaths", () => {
      usePaneStore.setState({
        root: { type: "leaf", id: "A", pagePath: null },
        focusedPaneId: "A",
      });
      usePaneStore.getState().setPanePage("A", "a.md");
      usePaneStore.getState().splitPane("A", "horizontal");
      const afterFirst = usePaneStore.getState().root as PaneSplit;
      const B = (afterFirst.children[1] as PaneLeaf).id;
      usePaneStore.getState().setPanePage(B, "b.md");

      usePaneStore.getState().splitPane(B, "vertical");
      const afterSecond = usePaneStore.getState().root as PaneSplit;
      const innerSplit = afterSecond.children[1] as PaneSplit;
      const C = (innerSplit.children[1] as PaneLeaf).id;
      usePaneStore.getState().setPanePage(C, "c.md");

      usePaneStore.getState().closePane(B);

      const root = usePaneStore.getState().root as PaneSplit;
      expect(root.type).toBe("split");
      expect(root.children).toHaveLength(2);
      expect((root.children[0] as PaneLeaf).pagePath).toBe("a.md");
      expect((root.children[1] as PaneLeaf).pagePath).toBe("c.md");
      const focusedId = usePaneStore.getState().focusedPaneId;
      expect(findLeaf(root, focusedId)).not.toBeNull();
    });
  });

  describe("Cycle 22: focus lands on null-pagePath pane after close", () => {
    it("close focused pane → focus lands on null-pagePath sibling, tree correct", () => {
      const A: PaneLeaf = { type: "leaf", id: "A", pagePath: "a.md" };
      const B: PaneLeaf = { type: "leaf", id: "B", pagePath: "b.md" };
      const C: PaneLeaf = { type: "leaf", id: "C", pagePath: null };
      const root: PaneSplit = {
        type: "split",
        id: "s1",
        direction: "horizontal",
        children: [A, B, C],
        sizes: [33, 34, 33],
      };
      usePaneStore.setState({ root, focusedPaneId: "B" });

      usePaneStore.getState().closePane("B");

      const newRoot = usePaneStore.getState().root as PaneSplit;
      expect(newRoot.type).toBe("split");
      expect(newRoot.children).toHaveLength(2);
      expect((newRoot.children[0] as PaneLeaf).id).toBe("A");
      expect((newRoot.children[0] as PaneLeaf).pagePath).toBe("a.md");
      expect((newRoot.children[1] as PaneLeaf).id).toBe("C");
      expect((newRoot.children[1] as PaneLeaf).pagePath).toBeNull();
      expect(usePaneStore.getState().focusedPaneId).toBe("C");
    });
  });

  describe("Cycle 20: Type exports validation", () => {
    it("PaneLeaf, PaneSplit, and PaneNode types are properly exported and usable", () => {
      const leaf: PaneLeaf = { type: "leaf", id: "t1", pagePath: null };
      expect(leaf.type).toBe("leaf");

      const split: PaneSplit = {
        type: "split",
        id: "s1",
        direction: "horizontal",
        children: [leaf],
        sizes: [100],
      };
      expect(split.type).toBe("split");

      const node: PaneNode = leaf;
      expect(node.type).toBe("leaf");

      const nodeAsSplit: PaneNode = split;
      expect(nodeAsSplit.type).toBe("split");
    });
  });
});

// ---------------------------------------------------------------------------
// Section F: Layout Persistence
// ---------------------------------------------------------------------------

describe("Section F: Layout Persistence", () => {
  const WS = "/test/workspace";
  const key = `lit-pane-layout-${WS}`;

  beforeEach(() => {
    stopLayoutSync();
    usePaneStore.setState({
      root: { type: "leaf", id: "solo", pagePath: null },
      focusedPaneId: "solo",
    });
    useWorkspaceStore.setState({ paneViewStates: {} });
  });

  afterEach(() => {
    stopLayoutSync();
  });

  describe("startLayoutSync", () => {
    it("splitPane writes layout to localStorage", () => {
      startLayoutSync(WS, () => useWorkspaceStore.getState().paneViewStates);
      usePaneStore.getState().splitPane("solo", "horizontal");
      const raw = localStorage.getItem(key);
      expect(raw).not.toBeNull();
      const stored = JSON.parse(raw!);
      expect(stored.root.type).toBe("split");
    });

    it("closePane writes layout to localStorage", () => {
      usePaneStore.getState().splitPane("solo", "horizontal");
      const root = usePaneStore.getState().root as PaneSplit;
      const secondId = (root.children[1] as PaneLeaf).id;
      startLayoutSync(WS, () => useWorkspaceStore.getState().paneViewStates);
      usePaneStore.getState().closePane(secondId);
      const stored = JSON.parse(localStorage.getItem(key)!);
      expect(stored.root.type).toBe("leaf");
    });

    it("setPanePage writes layout to localStorage", () => {
      startLayoutSync(WS, () => useWorkspaceStore.getState().paneViewStates);
      usePaneStore.getState().setPanePage("solo", "note.md");
      const stored = JSON.parse(localStorage.getItem(key)!);
      expect(stored.root.pagePath).toBe("note.md");
    });

    it("resize writes layout to localStorage", () => {
      const left: PaneLeaf = { type: "leaf", id: "left", pagePath: null };
      const right: PaneLeaf = { type: "leaf", id: "right", pagePath: null };
      const root: PaneSplit = {
        type: "split",
        id: "s1",
        direction: "horizontal",
        children: [left, right],
        sizes: [50, 50],
      };
      usePaneStore.setState({ root, focusedPaneId: "left" });
      startLayoutSync(WS, () => useWorkspaceStore.getState().paneViewStates);
      usePaneStore.getState().resize([], [30, 70]);
      const stored = JSON.parse(localStorage.getItem(key)!);
      expect(stored.root.sizes).toEqual([30, 70]);
    });
  });

  describe("persists pdfLinks", () => {
    afterEach(() => {
      usePanePdfLinkStore.setState({ links: new Map() });
    });

    it("flush writes the link store's current links as undirected pairs", () => {
      usePaneStore.getState().splitPane("solo", "horizontal");
      const root = usePaneStore.getState().root as PaneSplit;
      const a = (root.children[0] as PaneLeaf).id;
      const b = (root.children[1] as PaneLeaf).id;
      usePanePdfLinkStore.getState().linkPanes(a, b);

      startLayoutSync(WS, () => useWorkspaceStore.getState().paneViewStates);
      usePaneStore.getState().setPanePage(a, "note.md");

      const stored = JSON.parse(localStorage.getItem(key)!);
      expect(stored.pdfLinks).toHaveLength(1);
      expect(new Set(stored.pdfLinks[0])).toEqual(new Set([a, b]));
    });

    it("persists link-store changes without a pane-tree mutation", () => {
      usePaneStore.getState().splitPane("solo", "horizontal");
      const root = usePaneStore.getState().root as PaneSplit;
      const a = (root.children[0] as PaneLeaf).id;
      const b = (root.children[1] as PaneLeaf).id;
      usePanePdfLinkStore.getState().linkPanes(a, b);

      startLayoutSync(WS, () => useWorkspaceStore.getState().paneViewStates);
      usePaneStore.getState().setPanePage(a, "note.md");
      localStorage.removeItem(key);

      // Unlink with no accompanying pane-tree mutation.
      usePanePdfLinkStore.getState().unlinkPane(a);

      const stored = JSON.parse(localStorage.getItem(key)!);
      expect(stored.pdfLinks).toHaveLength(0);
    });

    it("does not write on non-link link-store mutations (currentPage churn)", () => {
      startLayoutSync(WS, () => useWorkspaceStore.getState().paneViewStates);
      usePaneStore.getState().setPanePage("solo", "note.md");
      localStorage.removeItem(key);

      // setCurrentPage fires on every PDF scroll tick; it must not flush.
      usePanePdfLinkStore.getState().setCurrentPage("solo", 3);
      expect(localStorage.getItem(key)).toBeNull();
    });
  });

  describe("stopLayoutSync", () => {
    it("stops persisting changes", () => {
      startLayoutSync(WS, () => useWorkspaceStore.getState().paneViewStates);
      usePaneStore.getState().setPanePage("solo", "first.md");
      expect(localStorage.getItem(key)).not.toBeNull();
      localStorage.removeItem(key);

      stopLayoutSync();
      usePaneStore.getState().setPanePage("solo", "second.md");
      expect(localStorage.getItem(key)).toBeNull();
    });
  });

  describe("startLayoutSync idempotent", () => {
    it("calling twice replaces previous subscription", () => {
      startLayoutSync(WS, () => useWorkspaceStore.getState().paneViewStates);
      startLayoutSync(WS, () => useWorkspaceStore.getState().paneViewStates);
      usePaneStore.getState().setPanePage("solo", "note.md");
      // If both subscriptions were active, localStorage would be written twice.
      // We just verify no error and data is there.
      expect(localStorage.getItem(key)).not.toBeNull();

      // Verify stop works (only one unsub needed)
      stopLayoutSync();
      localStorage.removeItem(key);
      usePaneStore.getState().setPanePage("solo", "another.md");
      expect(localStorage.getItem(key)).toBeNull();
    });
  });

  describe("beforeunload flushes paneViewStates", () => {
    it("saves layout including latest paneViewStates", () => {
      startLayoutSync(WS, () => useWorkspaceStore.getState().paneViewStates);
      usePaneStore.getState().setPanePage("solo", "note.md");
      useWorkspaceStore.getState().savePaneViewState("solo", 300, 77);
      localStorage.removeItem(key);
      window.dispatchEvent(new Event("beforeunload"));
      const stored = JSON.parse(localStorage.getItem(key)!);
      expect(stored.paneViewStates["solo"]).toEqual({ scrollTop: 300, cursor: 77 });
    });

    it("stopLayoutSync removes the beforeunload listener", () => {
      startLayoutSync(WS, () => useWorkspaceStore.getState().paneViewStates);
      usePaneStore.getState().setPanePage("solo", "note.md");
      stopLayoutSync();
      localStorage.removeItem(key);
      window.dispatchEvent(new Event("beforeunload"));
      expect(localStorage.getItem(key)).toBeNull();
    });

    it("calling startLayoutSync twice does not leak beforeunload handlers", () => {
      const addSpy = vi.spyOn(window, "addEventListener");
      const removeSpy = vi.spyOn(window, "removeEventListener");
      startLayoutSync(WS, () => useWorkspaceStore.getState().paneViewStates);
      startLayoutSync(WS, () => useWorkspaceStore.getState().paneViewStates);
      const addCalls = addSpy.mock.calls.filter(([e]) => e === "beforeunload");
      const removeCalls = removeSpy.mock.calls.filter(([e]) => e === "beforeunload");
      expect(addCalls).toHaveLength(2);
      expect(removeCalls).toHaveLength(1);
      addSpy.mockRestore();
      removeSpy.mockRestore();
    });
  });

  describe("round-trip", () => {
    it("split + setPanePage + close → restore → layout correct", () => {
      startLayoutSync(WS, () => useWorkspaceStore.getState().paneViewStates);
      usePaneStore.getState().splitPane("solo", "horizontal");
      const afterSplit = usePaneStore.getState().root as PaneSplit;
      const newId = (afterSplit.children[1] as PaneLeaf).id;
      usePaneStore.getState().setPanePage("solo", "keep.md");
      usePaneStore.getState().setPanePage(newId, "other.md");
      stopLayoutSync();

      const stored = loadLayout(WS)!;
      expect(stored.root.type).toBe("split");
      const leaves = collectLeaves(stored.root);
      expect(leaves).toHaveLength(2);
      expect(leaves[0]!.pagePath).toBe("keep.md");
      expect(leaves[1]!.pagePath).toBe("other.md");
    });

    it("resize → restore → sizes preserved", () => {
      const left: PaneLeaf = { type: "leaf", id: "left", pagePath: null };
      const right: PaneLeaf = { type: "leaf", id: "right", pagePath: null };
      const root: PaneSplit = {
        type: "split",
        id: "s1",
        direction: "horizontal",
        children: [left, right],
        sizes: [50, 50],
      };
      usePaneStore.setState({ root, focusedPaneId: "left" });
      startLayoutSync(WS, () => useWorkspaceStore.getState().paneViewStates);
      usePaneStore.getState().resize([], [25, 75]);
      stopLayoutSync();

      const stored = loadLayout(WS)!;
      expect((stored.root as PaneSplit).sizes).toEqual([25, 75]);
    });

    it("layout with deleted file → restore → pane has null pagePath", () => {
      startLayoutSync(WS, () => useWorkspaceStore.getState().paneViewStates);
      usePaneStore.getState().setPanePage("solo", "will-be-deleted.md");
      stopLayoutSync();

      const stored = loadLayout(WS)!;
      const existingPages = new Set(["other.md"]);
      const validated = validateLayout(stored.root, existingPages);
      expect((validated as PaneLeaf).pagePath).toBeNull();
    });
  });
});
