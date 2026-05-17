import { describe, it, expect } from "vitest";
import {
  generatePaneId,
  findLeaf,
  collectLeaves,
  replaceNode,
  removeLeaf,
  findSplitByPath,
  replaceSplitSizes,
} from "./panes";
import type { PaneLeaf, PaneSplit } from "./panes";

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
      direction: "horizontal",
      children: [l1, { type: "split", direction: "vertical", children: [l2, l3], sizes: [50, 50] }],
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
      direction: "horizontal",
      children: [
        { type: "split", direction: "vertical", children: [a, b], sizes: [50, 50] },
        { type: "split", direction: "vertical", children: [c, d], sizes: [50, 50] },
      ],
      sizes: [50, 50],
    };
    expect(collectLeaves(root).map((l) => l.id)).toEqual(["a", "b", "c", "d"]);
  });
});

describe("replaceNode", () => {
  it("replaces root leaf", () => {
    const root: PaneLeaf = { type: "leaf", id: "a", pagePath: null };
    const replacement: PaneSplit = {
      type: "split",
      direction: "horizontal",
      children: [
        { type: "leaf", id: "a", pagePath: null },
        { type: "leaf", id: "b", pagePath: null },
      ],
      sizes: [50, 50],
    };
    expect(replaceNode(root, "a", replacement)).toBe(replacement);
  });

  it("replaces leaf inside a split (sibling unchanged by reference)", () => {
    const sibling: PaneLeaf = { type: "leaf", id: "a", pagePath: null };
    const target: PaneLeaf = { type: "leaf", id: "b", pagePath: null };
    const root: PaneSplit = {
      type: "split",
      direction: "horizontal",
      children: [sibling, target],
      sizes: [50, 50],
    };
    const replacement: PaneLeaf = { type: "leaf", id: "b", pagePath: "new.md" };
    const result = replaceNode(root, "b", replacement) as PaneSplit;
    expect(result.children[1]).toBe(replacement);
    expect(result.children[0]).toBe(sibling);
  });

  it("returns tree unchanged (same ref) when ID not found", () => {
    const root: PaneSplit = {
      type: "split",
      direction: "horizontal",
      children: [
        { type: "leaf", id: "a", pagePath: null },
        { type: "leaf", id: "b", pagePath: null },
      ],
      sizes: [50, 50],
    };
    expect(replaceNode(root, "missing", { type: "leaf", id: "x", pagePath: null })).toBe(root);
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
      direction: "horizontal",
      children: [sibling, { type: "leaf", id: "b", pagePath: null }],
      sizes: [50, 50],
    };
    expect(removeLeaf(root, "b")).toBe(sibling);
  });

  it("3-child split, remove middle → 2-child split with normalized sizes", () => {
    const root: PaneSplit = {
      type: "split",
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
      direction: "horizontal",
      children: [
        { type: "leaf", id: "outer-a", pagePath: null },
        {
          type: "split",
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
      direction: "vertical",
      children: [
        { type: "leaf", id: "b", pagePath: null },
        { type: "leaf", id: "c", pagePath: null },
      ],
      sizes: [50, 50],
    };
    const root: PaneSplit = {
      type: "split",
      direction: "horizontal",
      children: [{ type: "leaf", id: "a", pagePath: null }, nested],
      sizes: [50, 50],
    };
    expect(findSplitByPath(root, [1])).toBe(nested);
  });

  it("invalid path returns null", () => {
    const root: PaneSplit = {
      type: "split",
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
