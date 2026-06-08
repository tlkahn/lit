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
  });
});
