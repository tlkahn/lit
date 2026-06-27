import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  usePanePdfLinkStore,
  initPanePdfLinkCleanup,
  stopPanePdfLinkCleanup,
  serializeLinks,
  deserializeLinks,
} from "./panePdfLink";
import { usePaneStore, type PaneLeaf, type PaneSplit } from "./panes";

describe("usePanePdfLinkStore", () => {
  beforeEach(() => {
    usePanePdfLinkStore.setState({
      links: new Map(),
      lastSyncedPage: null,
      syncEnabled: true,
      currentPage: new Map(),
      pendingPdfSync: new Map(),
      pendingEditorSync: new Map(),
      pageOffset: new Map(),
    });
  });

  it("setCurrentPage records a per-pane 0-based page index", () => {
    usePanePdfLinkStore.getState().setCurrentPage("pdf1", 3);
    expect(usePanePdfLinkStore.getState().currentPage.get("pdf1")).toBe(3);
  });

  it("syncEnabled defaults to true and toggleSync flips it", () => {
    expect(usePanePdfLinkStore.getState().syncEnabled).toBe(true);
    usePanePdfLinkStore.getState().toggleSync();
    expect(usePanePdfLinkStore.getState().syncEnabled).toBe(false);
    usePanePdfLinkStore.getState().toggleSync();
    expect(usePanePdfLinkStore.getState().syncEnabled).toBe(true);
  });

  it("lastSyncedPage starts null and setLastSyncedPage records {page, at}", () => {
    expect(usePanePdfLinkStore.getState().lastSyncedPage).toBeNull();
    usePanePdfLinkStore.getState().setLastSyncedPage(2, 12345);
    expect(usePanePdfLinkStore.getState().lastSyncedPage).toEqual({ page: 2, at: 12345 });
  });

  it("setLastSyncedPage defaults `at` to Date.now()", () => {
    const before = Date.now();
    usePanePdfLinkStore.getState().setLastSyncedPage(1);
    const rec = usePanePdfLinkStore.getState().lastSyncedPage!;
    expect(rec.page).toBe(1);
    expect(rec.at).toBeGreaterThanOrEqual(before);
  });

  it("linkPanes records a bidirectional link", () => {
    usePanePdfLinkStore.getState().linkPanes("a", "b");
    expect(usePanePdfLinkStore.getState().getLinkedPane("a")).toBe("b");
    expect(usePanePdfLinkStore.getState().getLinkedPane("b")).toBe("a");
  });

  it("unlinkPane removes both directions", () => {
    usePanePdfLinkStore.getState().linkPanes("a", "b");
    usePanePdfLinkStore.getState().unlinkPane("a");
    expect(usePanePdfLinkStore.getState().getLinkedPane("a")).toBeUndefined();
    expect(usePanePdfLinkStore.getState().getLinkedPane("b")).toBeUndefined();
  });

  it("re-linking a pane clears its stale partner", () => {
    usePanePdfLinkStore.getState().linkPanes("a", "b");
    usePanePdfLinkStore.getState().linkPanes("a", "c");
    expect(usePanePdfLinkStore.getState().getLinkedPane("a")).toBe("c");
    expect(usePanePdfLinkStore.getState().getLinkedPane("c")).toBe("a");
    expect(usePanePdfLinkStore.getState().getLinkedPane("b")).toBeUndefined();
  });

  describe("serializeLinks / deserializeLinks", () => {
    it("serializeLinks emits each undirected pair once", () => {
      const map = new Map([
        ["a", "b"],
        ["b", "a"],
      ]);
      const pairs = serializeLinks(map);
      expect(pairs).toHaveLength(1);
      const [pair] = pairs;
      expect(new Set(pair!)).toEqual(new Set(["a", "b"]));
    });

    it("serializeLinks handles multiple independent pairs", () => {
      const map = new Map([
        ["a", "b"],
        ["b", "a"],
        ["c", "d"],
        ["d", "c"],
      ]);
      const pairs = serializeLinks(map);
      expect(pairs).toHaveLength(2);
    });

    it("serializeLinks returns [] for an empty map", () => {
      expect(serializeLinks(new Map())).toEqual([]);
    });

    it("deserializeLinks builds a bidirectional map from pairs", () => {
      const map = deserializeLinks([["a", "b"]]);
      expect(map.get("a")).toBe("b");
      expect(map.get("b")).toBe("a");
    });

    it("serializeLinks and deserializeLinks round-trip", () => {
      const original = new Map([
        ["a", "b"],
        ["b", "a"],
      ]);
      const restored = deserializeLinks(serializeLinks(original));
      expect(restored.get("a")).toBe("b");
      expect(restored.get("b")).toBe("a");
    });
  });

  describe("auto-cleanup on pane close", () => {
    afterEach(() => {
      stopPanePdfLinkCleanup();
    });

    it("unlinks a pane when its partner leaves the pane tree", () => {
      const a: PaneLeaf = { type: "leaf", id: "a", pagePath: "paper.md" };
      const b: PaneLeaf = { type: "leaf", id: "b", pagePath: "paper.pdf" };
      const split: PaneSplit = {
        type: "split",
        id: "split-1",
        direction: "horizontal",
        children: [a, b],
        sizes: [50, 50],
      };
      usePaneStore.setState({ root: split, focusedPaneId: "a" });
      usePanePdfLinkStore.getState().linkPanes("a", "b");

      initPanePdfLinkCleanup();

      // Close pane b: only leaf "a" remains.
      usePaneStore.setState({ root: a, focusedPaneId: "a" });

      expect(usePanePdfLinkStore.getState().getLinkedPane("a")).toBeUndefined();
      expect(usePanePdfLinkStore.getState().getLinkedPane("b")).toBeUndefined();
    });

    it("skips cleanup work on focus-only changes (root identity unchanged)", () => {
      const a: PaneLeaf = { type: "leaf", id: "a", pagePath: "paper.md" };
      const b: PaneLeaf = { type: "leaf", id: "b", pagePath: "paper.pdf" };
      const split: PaneSplit = {
        type: "split",
        id: "split-1",
        direction: "horizontal",
        children: [a, b],
        sizes: [50, 50],
      };
      usePaneStore.setState({ root: split, focusedPaneId: "a" });
      usePanePdfLinkStore.getState().linkPanes("a", "b");
      // Seed a stale current-page entry for a pane that no longer exists in the tree.
      usePanePdfLinkStore.setState({ currentPage: new Map([["ghost", 7]]) });

      initPanePdfLinkCleanup();

      // Focus-only change: root reference stays identical.
      usePaneStore.setState({ focusedPaneId: "b" });

      // The link is intact, and — proving the cleanup body did not run — the stale
      // entry survives because a focus-only change must not trigger the tree walk.
      expect(usePanePdfLinkStore.getState().getLinkedPane("a")).toBe("b");
      expect(usePanePdfLinkStore.getState().currentPage.get("ghost")).toBe(7);

      // A real structural change (dropping b) now runs cleanup: the link is dropped
      // and the stale current-page entry is pruned.
      usePaneStore.setState({ root: a, focusedPaneId: "a" });
      expect(usePanePdfLinkStore.getState().getLinkedPane("a")).toBeUndefined();
      expect(usePanePdfLinkStore.getState().currentPage.has("ghost")).toBe(false);
    });
  });

  describe("link invalidation on navigate", () => {
    it("setPanePage on a linked pane breaks the link", () => {
      const a: PaneLeaf = { type: "leaf", id: "a", pagePath: "paper.md" };
      const b: PaneLeaf = { type: "leaf", id: "b", pagePath: "paper.pdf" };
      const split: PaneSplit = {
        type: "split",
        id: "split-1",
        direction: "horizontal",
        children: [a, b],
        sizes: [50, 50],
      };
      usePaneStore.setState({ root: split, focusedPaneId: "a" });
      usePanePdfLinkStore.getState().linkPanes("a", "b");

      usePaneStore.getState().setPanePage("a", "unrelated.md");

      expect(usePanePdfLinkStore.getState().getLinkedPane("a")).toBeUndefined();
      expect(usePanePdfLinkStore.getState().getLinkedPane("b")).toBeUndefined();
    });

    it("navigating the PDF pane away also breaks the link", () => {
      const a: PaneLeaf = { type: "leaf", id: "a", pagePath: "paper.md" };
      const b: PaneLeaf = { type: "leaf", id: "b", pagePath: "paper.pdf" };
      const split: PaneSplit = {
        type: "split",
        id: "split-1",
        direction: "horizontal",
        children: [a, b],
        sizes: [50, 50],
      };
      usePaneStore.setState({ root: split, focusedPaneId: "b" });
      usePanePdfLinkStore.getState().linkPanes("a", "b");

      usePaneStore.getState().setPanePage("b", "other.pdf");

      expect(usePanePdfLinkStore.getState().getLinkedPane("a")).toBeUndefined();
      expect(usePanePdfLinkStore.getState().getLinkedPane("b")).toBeUndefined();
    });

    it("navigating to null breaks the link", () => {
      const a: PaneLeaf = { type: "leaf", id: "a", pagePath: "paper.md" };
      const b: PaneLeaf = { type: "leaf", id: "b", pagePath: "paper.pdf" };
      const split: PaneSplit = {
        type: "split",
        id: "split-1",
        direction: "horizontal",
        children: [a, b],
        sizes: [50, 50],
      };
      usePaneStore.setState({ root: split, focusedPaneId: "a" });
      usePanePdfLinkStore.getState().linkPanes("a", "b");

      usePaneStore.getState().setPanePage("a", null);

      expect(usePanePdfLinkStore.getState().getLinkedPane("a")).toBeUndefined();
      expect(usePanePdfLinkStore.getState().getLinkedPane("b")).toBeUndefined();
    });

    it("navigating an unlinked pane does not disturb an independent link pair", () => {
      const a: PaneLeaf = { type: "leaf", id: "a", pagePath: "paper.md" };
      const b: PaneLeaf = { type: "leaf", id: "b", pagePath: "paper.pdf" };
      const c: PaneLeaf = { type: "leaf", id: "c", pagePath: "notes.md" };
      const split: PaneSplit = {
        type: "split",
        id: "split-1",
        direction: "horizontal",
        children: [a, b, c],
        sizes: [33, 34, 33],
      };
      usePaneStore.setState({ root: split, focusedPaneId: "c" });
      usePanePdfLinkStore.getState().linkPanes("a", "b");

      usePaneStore.getState().setPanePage("c", "other.md");

      expect(usePanePdfLinkStore.getState().getLinkedPane("a")).toBe("b");
      expect(usePanePdfLinkStore.getState().getLinkedPane("b")).toBe("a");
    });

    it("same-page setPanePage (no-op) does not break the link", () => {
      const a: PaneLeaf = { type: "leaf", id: "a", pagePath: "paper.md" };
      const b: PaneLeaf = { type: "leaf", id: "b", pagePath: "paper.pdf" };
      const split: PaneSplit = {
        type: "split",
        id: "split-1",
        direction: "horizontal",
        children: [a, b],
        sizes: [50, 50],
      };
      usePaneStore.setState({ root: split, focusedPaneId: "a" });
      usePanePdfLinkStore.getState().linkPanes("a", "b");

      usePaneStore.getState().setPanePage("a", "paper.md");

      expect(usePanePdfLinkStore.getState().getLinkedPane("a")).toBe("b");
      expect(usePanePdfLinkStore.getState().getLinkedPane("b")).toBe("a");
    });

    it("only the navigated pair breaks when two independent pairs exist", () => {
      const a: PaneLeaf = { type: "leaf", id: "a", pagePath: "paper.md" };
      const b: PaneLeaf = { type: "leaf", id: "b", pagePath: "paper.pdf" };
      const c: PaneLeaf = { type: "leaf", id: "c", pagePath: "thesis.md" };
      const d: PaneLeaf = { type: "leaf", id: "d", pagePath: "thesis.pdf" };
      const split: PaneSplit = {
        type: "split",
        id: "split-1",
        direction: "horizontal",
        children: [a, b, c, d],
        sizes: [25, 25, 25, 25],
      };
      usePaneStore.setState({ root: split, focusedPaneId: "a" });
      usePanePdfLinkStore.getState().linkPanes("a", "b");
      usePanePdfLinkStore.getState().linkPanes("c", "d");

      usePaneStore.getState().setPanePage("a", "unrelated.md");

      expect(usePanePdfLinkStore.getState().getLinkedPane("a")).toBeUndefined();
      expect(usePanePdfLinkStore.getState().getLinkedPane("b")).toBeUndefined();
      expect(usePanePdfLinkStore.getState().getLinkedPane("c")).toBe("d");
      expect(usePanePdfLinkStore.getState().getLinkedPane("d")).toBe("c");
    });
  });

  describe("pendingPdfSync", () => {
    it("starts empty", () => {
      expect(usePanePdfLinkStore.getState().pendingPdfSync.size).toBe(0);
    });

    it("setPendingPdfSync stores paneId and pageIndex", () => {
      usePanePdfLinkStore.getState().setPendingPdfSync("pdf1", 5);
      expect(usePanePdfLinkStore.getState().pendingPdfSync.get("pdf1")).toBe(5);
    });

    it("consumePendingPdfSync returns pageIndex and clears it", () => {
      usePanePdfLinkStore.getState().setPendingPdfSync("pdf1", 3);
      const result = usePanePdfLinkStore.getState().consumePendingPdfSync("pdf1");
      expect(result).toBe(3);
      expect(usePanePdfLinkStore.getState().pendingPdfSync.has("pdf1")).toBe(false);
    });

    it("consumePendingPdfSync returns null for wrong paneId", () => {
      usePanePdfLinkStore.getState().setPendingPdfSync("pdf1", 3);
      const result = usePanePdfLinkStore.getState().consumePendingPdfSync("other");
      expect(result).toBeNull();
      // Original entry is NOT consumed
      expect(usePanePdfLinkStore.getState().pendingPdfSync.get("pdf1")).toBe(3);
    });

    it("consumePendingPdfSync returns null when nothing pending", () => {
      expect(usePanePdfLinkStore.getState().consumePendingPdfSync("pdf1")).toBeNull();
    });

    it("retains independent pending entries for multiple panes (no overwrite)", () => {
      usePanePdfLinkStore.getState().setPendingPdfSync("p1", 3);
      usePanePdfLinkStore.getState().setPendingPdfSync("p2", 7);
      expect(usePanePdfLinkStore.getState().consumePendingPdfSync("p1")).toBe(3);
      expect(usePanePdfLinkStore.getState().consumePendingPdfSync("p2")).toBe(7);
    });
  });

  describe("pendingEditorSync", () => {
    it("starts empty", () => {
      expect(usePanePdfLinkStore.getState().pendingEditorSync.size).toBe(0);
    });

    it("setPendingEditorSync stores paneId and pageIndex", () => {
      usePanePdfLinkStore.getState().setPendingEditorSync("ed1", 7);
      expect(usePanePdfLinkStore.getState().pendingEditorSync.get("ed1")).toBe(7);
    });

    it("consumePendingEditorSync returns pageIndex and clears it", () => {
      usePanePdfLinkStore.getState().setPendingEditorSync("ed1", 4);
      const result = usePanePdfLinkStore.getState().consumePendingEditorSync("ed1");
      expect(result).toBe(4);
      expect(usePanePdfLinkStore.getState().pendingEditorSync.has("ed1")).toBe(false);
    });

    it("consumePendingEditorSync returns null for wrong paneId", () => {
      usePanePdfLinkStore.getState().setPendingEditorSync("ed1", 4);
      const result = usePanePdfLinkStore.getState().consumePendingEditorSync("other");
      expect(result).toBeNull();
      expect(usePanePdfLinkStore.getState().pendingEditorSync.get("ed1")).toBe(4);
    });

    it("consumePendingEditorSync returns null when nothing pending", () => {
      expect(usePanePdfLinkStore.getState().consumePendingEditorSync("ed1")).toBeNull();
    });

    it("retains independent pending entries for multiple panes (no overwrite)", () => {
      usePanePdfLinkStore.getState().setPendingEditorSync("ed1", 4);
      usePanePdfLinkStore.getState().setPendingEditorSync("ed2", 8);
      expect(usePanePdfLinkStore.getState().consumePendingEditorSync("ed1")).toBe(4);
      expect(usePanePdfLinkStore.getState().consumePendingEditorSync("ed2")).toBe(8);
    });
  });

  describe("auto-cleanup clears orphaned pending entries", () => {
    afterEach(() => {
      stopPanePdfLinkCleanup();
    });

    it("clears pendingPdfSync when its target pane leaves the tree", () => {
      const a: PaneLeaf = { type: "leaf", id: "a", pagePath: "paper.md" };
      const b: PaneLeaf = { type: "leaf", id: "b", pagePath: "paper.pdf" };
      const split: PaneSplit = {
        type: "split",
        id: "split-1",
        direction: "horizontal",
        children: [a, b],
        sizes: [50, 50],
      };
      usePaneStore.setState({ root: split, focusedPaneId: "a" });
      usePanePdfLinkStore.getState().setPendingPdfSync("b", 5);
      // Seed a second pending entry for a pane that remains in the tree.
      usePanePdfLinkStore.getState().setPendingPdfSync("a", 2);

      initPanePdfLinkCleanup();

      // Remove pane b from the tree
      usePaneStore.setState({ root: a, focusedPaneId: "a" });

      // Orphaned entry for b is pruned; the entry for the surviving pane a remains.
      expect(usePanePdfLinkStore.getState().pendingPdfSync.has("b")).toBe(false);
      expect(usePanePdfLinkStore.getState().pendingPdfSync.get("a")).toBe(2);
    });

    it("clears pendingEditorSync when its target pane leaves the tree", () => {
      const a: PaneLeaf = { type: "leaf", id: "a", pagePath: "paper.pdf" };
      const b: PaneLeaf = { type: "leaf", id: "b", pagePath: "paper.md" };
      const split: PaneSplit = {
        type: "split",
        id: "split-1",
        direction: "horizontal",
        children: [a, b],
        sizes: [50, 50],
      };
      usePaneStore.setState({ root: split, focusedPaneId: "a" });
      usePanePdfLinkStore.getState().setPendingEditorSync("b", 3);

      initPanePdfLinkCleanup();

      // Remove pane b from the tree
      usePaneStore.setState({ root: a, focusedPaneId: "a" });

      expect(usePanePdfLinkStore.getState().pendingEditorSync.has("b")).toBe(false);
    });

    it("clears pageOffset when its pane leaves the tree", () => {
      const a: PaneLeaf = { type: "leaf", id: "a", pagePath: "paper.md" };
      const b: PaneLeaf = { type: "leaf", id: "b", pagePath: "paper.pdf" };
      const split: PaneSplit = {
        type: "split",
        id: "split-1",
        direction: "horizontal",
        children: [a, b],
        sizes: [50, 50],
      };
      usePaneStore.setState({ root: split, focusedPaneId: "a" });
      usePanePdfLinkStore.getState().setPageOffset("b", 2);
      usePanePdfLinkStore.getState().setPageOffset("a", 1);

      initPanePdfLinkCleanup();

      // Remove pane b from the tree
      usePaneStore.setState({ root: a, focusedPaneId: "a" });

      expect(usePanePdfLinkStore.getState().pageOffset.has("b")).toBe(false);
      expect(usePanePdfLinkStore.getState().getPageOffset("a")).toBe(1);
    });
  });

  describe("pageOffset", () => {
    it("starts empty and getPageOffset defaults to 0", () => {
      expect(usePanePdfLinkStore.getState().pageOffset.size).toBe(0);
      expect(usePanePdfLinkStore.getState().getPageOffset("nope")).toBe(0);
    });

    it("setPageOffset stores and getPageOffset returns the value", () => {
      usePanePdfLinkStore.getState().setPageOffset("pane-1", 3);
      expect(usePanePdfLinkStore.getState().getPageOffset("pane-1")).toBe(3);
    });

    it("retains independent offsets for multiple panes", () => {
      usePanePdfLinkStore.getState().setPageOffset("p1", 2);
      usePanePdfLinkStore.getState().setPageOffset("p2", 5);
      expect(usePanePdfLinkStore.getState().getPageOffset("p1")).toBe(2);
      expect(usePanePdfLinkStore.getState().getPageOffset("p2")).toBe(5);
    });
  });
});
