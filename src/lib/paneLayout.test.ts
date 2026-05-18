import { describe, it, expect } from "vitest";
import type { PaneLeaf, PaneSplit } from "../stores/panes";
import type { ViewState } from "../types";
import {
  STALE_THRESHOLD_MS,
  layoutStorageKey,
  serializeLayout,
  deserializeLayout,
  validateLayout,
  validateFocusedPaneId,
  pruneViewStates,
  saveLayout,
  loadLayout,
  cleanupStaleLayouts,
} from "./paneLayout";

// ---------------------------------------------------------------------------
// Cycle 1: Storage key generation
// ---------------------------------------------------------------------------

describe("layoutStorageKey", () => {
  it("returns lit-pane-layout-${path} for a given path", () => {
    expect(layoutStorageKey("/my/workspace")).toBe("lit-pane-layout-/my/workspace");
  });

  it("handles paths with spaces and special characters", () => {
    expect(layoutStorageKey("/my path/work space (2)")).toBe(
      "lit-pane-layout-/my path/work space (2)",
    );
  });
});

// ---------------------------------------------------------------------------
// Cycle 2: Serialize layout
// ---------------------------------------------------------------------------

describe("serializeLayout", () => {
  it("serializes single-leaf root with focusedPaneId and paneViewStates", () => {
    const root: PaneLeaf = { type: "leaf", id: "a", pagePath: "note.md" };
    const pvs: Record<string, ViewState> = { a: { scrollTop: 100, cursor: 42 } };
    const json = serializeLayout(root, "a", pvs);
    const parsed = JSON.parse(json);
    expect(parsed.root).toEqual(root);
    expect(parsed.focusedPaneId).toBe("a");
    expect(parsed.paneViewStates).toEqual(pvs);
    expect(typeof parsed.savedAt).toBe("number");
  });

  it("serializes nested split tree", () => {
    const root: PaneSplit = {
      type: "split",
      id: "s1",
      direction: "horizontal",
      children: [
        { type: "leaf", id: "a", pagePath: "a.md" },
        {
          type: "split",
          id: "s2",
          direction: "vertical",
          children: [
            { type: "leaf", id: "b", pagePath: "b.md" },
            { type: "leaf", id: "c", pagePath: null },
          ],
          sizes: [60, 40],
        },
      ],
      sizes: [50, 50],
    };
    const json = serializeLayout(root, "b", {});
    const parsed = JSON.parse(json);
    expect(parsed.root.type).toBe("split");
    expect(parsed.root.children).toHaveLength(2);
    expect(parsed.root.children[1].children).toHaveLength(2);
  });

  it("resulting JSON is parseable and matches original structure", () => {
    const root: PaneLeaf = { type: "leaf", id: "x", pagePath: null };
    const json = serializeLayout(root, "x", {});
    const parsed = JSON.parse(json);
    expect(parsed.root).toEqual(root);
    expect(parsed.focusedPaneId).toBe("x");
    expect(parsed.paneViewStates).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// Cycle 3: Deserialize layout
// ---------------------------------------------------------------------------

describe("deserializeLayout", () => {
  it("parses valid JSON into StoredLayout", () => {
    const stored = {
      root: { type: "leaf", id: "a", pagePath: null },
      focusedPaneId: "a",
      paneViewStates: { a: { scrollTop: 0, cursor: 0 } },
      savedAt: 12345,
    };
    const result = deserializeLayout(JSON.stringify(stored));
    expect(result).toEqual(stored);
  });

  it("returns null for null input", () => {
    expect(deserializeLayout(null)).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(deserializeLayout("")).toBeNull();
  });

  it("returns null for malformed JSON", () => {
    expect(deserializeLayout("{not valid json")).toBeNull();
  });

  it("returns null for JSON missing root field", () => {
    expect(deserializeLayout(JSON.stringify({ focusedPaneId: "a" }))).toBeNull();
  });

  it("returns null for JSON with root missing type field", () => {
    const data = { root: { id: "a" }, focusedPaneId: "a" };
    expect(deserializeLayout(JSON.stringify(data))).toBeNull();
  });

  it("returns null for JSON missing focusedPaneId", () => {
    const data = { root: { type: "leaf", id: "a", pagePath: null } };
    expect(deserializeLayout(JSON.stringify(data))).toBeNull();
  });

  it("defaults paneViewStates to {} if missing from stored data", () => {
    const data = {
      root: { type: "leaf", id: "a", pagePath: null },
      focusedPaneId: "a",
      savedAt: 100,
    };
    const result = deserializeLayout(JSON.stringify(data));
    expect(result!.paneViewStates).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// Cycle 4: Validate layout tree against existing pages
// ---------------------------------------------------------------------------

describe("validateLayout", () => {
  const existing = new Set(["a.md", "b.md", "c.md"]);

  it("returns tree unchanged when all pagePaths exist", () => {
    const root: PaneLeaf = { type: "leaf", id: "1", pagePath: "a.md" };
    expect(validateLayout(root, existing)).toBe(root);
  });

  it("sets pagePath to null for leaf referencing non-existent file", () => {
    const root: PaneLeaf = { type: "leaf", id: "1", pagePath: "gone.md" };
    const result = validateLayout(root, existing) as PaneLeaf;
    expect(result.pagePath).toBeNull();
    expect(result.id).toBe("1");
  });

  it("leaves pagePath: null leaves untouched", () => {
    const root: PaneLeaf = { type: "leaf", id: "1", pagePath: null };
    expect(validateLayout(root, existing)).toBe(root);
  });

  it("handles nested split with mix of valid and invalid paths", () => {
    const root: PaneSplit = {
      type: "split",
      id: "s1",
      direction: "horizontal",
      children: [
        { type: "leaf", id: "1", pagePath: "a.md" },
        { type: "leaf", id: "2", pagePath: "deleted.md" },
      ],
      sizes: [50, 50],
    };
    const result = validateLayout(root, existing) as PaneSplit;
    expect((result.children[0] as PaneLeaf).pagePath).toBe("a.md");
    expect((result.children[1] as PaneLeaf).pagePath).toBeNull();
    // structural sharing: unchanged child keeps ref
    expect(result.children[0]).toBe(root.children[0]);
  });

  it("returns entirely nulled-out tree when no files exist", () => {
    const empty = new Set<string>();
    const root: PaneSplit = {
      type: "split",
      id: "s1",
      direction: "horizontal",
      children: [
        { type: "leaf", id: "1", pagePath: "a.md" },
        { type: "leaf", id: "2", pagePath: "b.md" },
      ],
      sizes: [50, 50],
    };
    const result = validateLayout(root, empty) as PaneSplit;
    expect((result.children[0] as PaneLeaf).pagePath).toBeNull();
    expect((result.children[1] as PaneLeaf).pagePath).toBeNull();
  });

  it("deeply nested 3-level tree", () => {
    const root: PaneSplit = {
      type: "split",
      id: "s1",
      direction: "horizontal",
      children: [
        { type: "leaf", id: "1", pagePath: "a.md" },
        {
          type: "split",
          id: "s2",
          direction: "vertical",
          children: [
            { type: "leaf", id: "2", pagePath: "gone.md" },
            {
              type: "split",
              id: "s3",
              direction: "horizontal",
              children: [
                { type: "leaf", id: "3", pagePath: "b.md" },
                { type: "leaf", id: "4", pagePath: "also-gone.md" },
              ],
              sizes: [50, 50],
            },
          ],
          sizes: [50, 50],
        },
      ],
      sizes: [50, 50],
    };
    const result = validateLayout(root, existing) as PaneSplit;
    expect((result.children[0] as PaneLeaf).pagePath).toBe("a.md");
    const s2 = result.children[1] as PaneSplit;
    expect((s2.children[0] as PaneLeaf).pagePath).toBeNull();
    const s3 = s2.children[1] as PaneSplit;
    expect((s3.children[0] as PaneLeaf).pagePath).toBe("b.md");
    expect((s3.children[1] as PaneLeaf).pagePath).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Cycle 5: Validate focusedPaneId
// ---------------------------------------------------------------------------

describe("validateFocusedPaneId", () => {
  it("returns id unchanged when it exists in tree", () => {
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
    expect(validateFocusedPaneId(root, "b")).toBe("b");
  });

  it("returns first leaf id when stored id not found", () => {
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
    expect(validateFocusedPaneId(root, "gone")).toBe("a");
  });

  it("works with deeply nested tree", () => {
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
            { type: "leaf", id: "deep-a", pagePath: null },
            { type: "leaf", id: "deep-b", pagePath: null },
          ],
          sizes: [50, 50],
        },
        { type: "leaf", id: "c", pagePath: null },
      ],
      sizes: [50, 50],
    };
    expect(validateFocusedPaneId(root, "deep-b")).toBe("deep-b");
    expect(validateFocusedPaneId(root, "missing")).toBe("deep-a");
  });
});

// ---------------------------------------------------------------------------
// Cycle 6: Prune stale paneViewStates
// ---------------------------------------------------------------------------

describe("pruneViewStates", () => {
  it("keeps entries for pane IDs present in tree", () => {
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
    const pvs = {
      a: { scrollTop: 10, cursor: 1 },
      b: { scrollTop: 20, cursor: 2 },
    };
    expect(pruneViewStates(pvs, root)).toEqual(pvs);
  });

  it("removes entries for pane IDs not in tree", () => {
    const root: PaneLeaf = { type: "leaf", id: "a", pagePath: null };
    const pvs = {
      a: { scrollTop: 10, cursor: 1 },
      gone: { scrollTop: 20, cursor: 2 },
    };
    expect(pruneViewStates(pvs, root)).toEqual({ a: { scrollTop: 10, cursor: 1 } });
  });

  it("returns empty object for empty input", () => {
    const root: PaneLeaf = { type: "leaf", id: "a", pagePath: null };
    expect(pruneViewStates({}, root)).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// Cycle 7: Save layout to localStorage
// ---------------------------------------------------------------------------

describe("saveLayout", () => {
  it("writes serialized layout to localStorage under correct key", () => {
    const root: PaneLeaf = { type: "leaf", id: "a", pagePath: null };
    saveLayout("/ws", root, "a", {});
    const raw = localStorage.getItem("lit-pane-layout-/ws");
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    expect(parsed.root).toEqual(root);
    expect(parsed.focusedPaneId).toBe("a");
  });

  it("overwrites existing stored layout", () => {
    const root1: PaneLeaf = { type: "leaf", id: "a", pagePath: null };
    const root2: PaneLeaf = { type: "leaf", id: "b", pagePath: "x.md" };
    saveLayout("/ws", root1, "a", {});
    saveLayout("/ws", root2, "b", {});
    const parsed = JSON.parse(localStorage.getItem("lit-pane-layout-/ws")!);
    expect(parsed.root.id).toBe("b");
  });

  it("stored value contains savedAt timestamp", () => {
    const root: PaneLeaf = { type: "leaf", id: "a", pagePath: null };
    const before = Date.now();
    saveLayout("/ws", root, "a", {});
    const after = Date.now();
    const parsed = JSON.parse(localStorage.getItem("lit-pane-layout-/ws")!);
    expect(parsed.savedAt).toBeGreaterThanOrEqual(before);
    expect(parsed.savedAt).toBeLessThanOrEqual(after);
  });
});

// ---------------------------------------------------------------------------
// Cycle 8: Load layout from localStorage
// ---------------------------------------------------------------------------

describe("loadLayout", () => {
  it("returns StoredLayout when valid data exists", () => {
    const root: PaneLeaf = { type: "leaf", id: "a", pagePath: null };
    saveLayout("/ws", root, "a", { a: { scrollTop: 5, cursor: 3 } });
    const result = loadLayout("/ws");
    expect(result).not.toBeNull();
    expect(result!.root).toEqual(root);
    expect(result!.focusedPaneId).toBe("a");
    expect(result!.paneViewStates).toEqual({ a: { scrollTop: 5, cursor: 3 } });
  });

  it("returns null when no data stored", () => {
    expect(loadLayout("/no-such")).toBeNull();
  });

  it("returns null when stored data is corrupted", () => {
    localStorage.setItem("lit-pane-layout-/ws", "{{bad json");
    expect(loadLayout("/ws")).toBeNull();
  });

  it("returns null when root is missing", () => {
    localStorage.setItem(
      "lit-pane-layout-/ws",
      JSON.stringify({ focusedPaneId: "a" }),
    );
    expect(loadLayout("/ws")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Cycle 9: Stale layout cleanup
// ---------------------------------------------------------------------------

describe("cleanupStaleLayouts", () => {
  const freshTime = 1_000_000_000_000;
  const staleTime = freshTime - STALE_THRESHOLD_MS - 1;

  it("removes entries older than 30 days", () => {
    localStorage.setItem(
      "lit-pane-layout-/old",
      JSON.stringify({
        root: { type: "leaf", id: "a", pagePath: null },
        focusedPaneId: "a",
        paneViewStates: {},
        savedAt: staleTime,
      }),
    );
    cleanupStaleLayouts(freshTime);
    expect(localStorage.getItem("lit-pane-layout-/old")).toBeNull();
  });

  it("keeps entries newer than 30 days", () => {
    localStorage.setItem(
      "lit-pane-layout-/new",
      JSON.stringify({
        root: { type: "leaf", id: "a", pagePath: null },
        focusedPaneId: "a",
        paneViewStates: {},
        savedAt: freshTime - 1000,
      }),
    );
    cleanupStaleLayouts(freshTime);
    expect(localStorage.getItem("lit-pane-layout-/new")).not.toBeNull();
  });

  it("handles mixed stale and fresh entries", () => {
    localStorage.setItem(
      "lit-pane-layout-/old",
      JSON.stringify({
        root: { type: "leaf", id: "a", pagePath: null },
        focusedPaneId: "a",
        paneViewStates: {},
        savedAt: staleTime,
      }),
    );
    localStorage.setItem(
      "lit-pane-layout-/new",
      JSON.stringify({
        root: { type: "leaf", id: "b", pagePath: null },
        focusedPaneId: "b",
        paneViewStates: {},
        savedAt: freshTime - 1000,
      }),
    );
    cleanupStaleLayouts(freshTime);
    expect(localStorage.getItem("lit-pane-layout-/old")).toBeNull();
    expect(localStorage.getItem("lit-pane-layout-/new")).not.toBeNull();
  });

  it("does not remove non-layout localStorage keys", () => {
    localStorage.setItem("lit-sidebar-sort:/ws", "name");
    localStorage.setItem(
      "lit-pane-layout-/stale",
      JSON.stringify({
        root: { type: "leaf", id: "a", pagePath: null },
        focusedPaneId: "a",
        paneViewStates: {},
        savedAt: staleTime,
      }),
    );
    cleanupStaleLayouts(freshTime);
    expect(localStorage.getItem("lit-sidebar-sort:/ws")).toBe("name");
  });

  it("removes corrupted layout entries", () => {
    localStorage.setItem("lit-pane-layout-/corrupt", "{{bad");
    cleanupStaleLayouts(freshTime);
    expect(localStorage.getItem("lit-pane-layout-/corrupt")).toBeNull();
  });

  it("uses provided now parameter for testability", () => {
    const savedAt = 500;
    localStorage.setItem(
      "lit-pane-layout-/ws",
      JSON.stringify({
        root: { type: "leaf", id: "a", pagePath: null },
        focusedPaneId: "a",
        paneViewStates: {},
        savedAt,
      }),
    );
    // With "now" just after savedAt, within threshold — should keep
    cleanupStaleLayouts(savedAt + STALE_THRESHOLD_MS);
    expect(localStorage.getItem("lit-pane-layout-/ws")).not.toBeNull();

    // Now past threshold — should remove
    cleanupStaleLayouts(savedAt + STALE_THRESHOLD_MS + 1);
    expect(localStorage.getItem("lit-pane-layout-/ws")).toBeNull();
  });
});
