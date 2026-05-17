import { describe, it, expect, beforeEach } from "vitest";
import {
  generatePaneId,
  findLeaf,
  collectLeaves,
  replaceLeaf,
  removeLeaf,
  findSplitByPath,
  replaceSplitSizes,
  createInitialState,
  usePaneStore,
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

describe("replaceLeaf", () => {
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
    expect(replaceLeaf(root, "a", replacement)).toBe(replacement);
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
    const result = replaceLeaf(root, "b", replacement) as PaneSplit;
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

  it("path to a leaf child returns null", () => {
    const root: PaneSplit = {
      type: "split",
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
    });

    describe("nested — split inside existing split", () => {
      it("splitting a leaf inside a split creates nested splits", () => {
        const left: PaneLeaf = { type: "leaf", id: "left", pagePath: null };
        const right: PaneLeaf = { type: "leaf", id: "right", pagePath: null };
        const root: PaneSplit = {
          type: "split",
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
    });
  });

  describe("closePane", () => {
    describe("basic", () => {
      it("close one of two → root collapses to remaining leaf", () => {
        const left: PaneLeaf = { type: "leaf", id: "left", pagePath: "a.md" };
        const right: PaneLeaf = { type: "leaf", id: "right", pagePath: null };
        const root: PaneSplit = {
          type: "split",
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
          direction: "horizontal",
          children: [left, right],
          sizes: [50, 50],
        };
        usePaneStore.setState({ root, focusedPaneId: "right" });
        usePaneStore.getState().closePane("right");

        expect(usePaneStore.getState().focusedPaneId).toBe("left");
      });

      it("close last pane → no-op", () => {
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

    describe("deep tree + focus heuristics", () => {
      it("deep tree: close inner leaf → sibling promoted, outer structure correct", () => {
        const innerA: PaneLeaf = { type: "leaf", id: "inner-a", pagePath: null };
        const innerB: PaneLeaf = { type: "leaf", id: "inner-b", pagePath: null };
        const outerA: PaneLeaf = { type: "leaf", id: "outer-a", pagePath: null };
        const root: PaneSplit = {
          type: "split",
          direction: "horizontal",
          children: [
            outerA,
            { type: "split", direction: "vertical", children: [innerA, innerB], sizes: [50, 50] },
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
