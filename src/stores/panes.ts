import { create } from "zustand";
import type { ViewState } from "../types";
import type { ViewMode } from "../lib/ipc";
import { saveLayout } from "../lib/paneLayout";
import { usePanePdfLinkStore, serializeLinks } from "./panePdfLink";
import { usePaneHistoryStore, serializeHistory } from "./paneHistory";
import { usePreferencesStore } from "./preferences";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PaneLeaf = { type: "leaf"; id: string; pagePath: string | null; viewMode?: ViewMode };
export type PaneSplit = {
  type: "split";
  id: string;
  direction: "horizontal" | "vertical";
  children: PaneNode[];
  sizes: number[];
};
export type PaneNode = PaneLeaf | PaneSplit;

export const MAX_PANES = 6;

export interface PaneStore {
  root: PaneNode;
  focusedPaneId: string;
  pendingJumpLines: Record<string, number>;
  splitPane(paneId: string, direction: "horizontal" | "vertical"): string | null;
  closePane(paneId: string): void;
  focusPane(paneId: string): void;
  focusNext(): void;
  focusPrev(): void;
  setPanePage(paneId: string, pagePath: string | null): void;
  setPaneViewMode(paneId: string, mode: ViewMode): void;
  renamePagePath(oldPath: string, newPath: string): void;
  resize(splitPath: number[], sizes: number[]): void;
  clearPageFromPanes(pagePath: string): void;
  swapLayout(): void;
  setPendingJumpLine(paneId: string, line: number): void;
  consumePendingJumpLine(paneId: string): number | null;
}

// ---------------------------------------------------------------------------
// Section A: Pure Tree Helpers
// ---------------------------------------------------------------------------

export function generatePaneId(): string {
  return crypto.randomUUID();
}

export function findLeaf(root: PaneNode, id: string): PaneLeaf | null {
  if (root.type === "leaf") return root.id === id ? root : null;
  for (const child of root.children) {
    const found = findLeaf(child, id);
    if (found) return found;
  }
  return null;
}

export function collectLeaves(root: PaneNode): PaneLeaf[] {
  if (root.type === "leaf") return [root];
  return root.children.flatMap(collectLeaves);
}

export function cycleLeafId(leaves: PaneLeaf[], fromId: string, delta: 1 | -1): string | null {
  const idx = leaves.findIndex((l) => l.id === fromId);
  if (idx === -1) return null;
  return leaves[(idx + delta + leaves.length) % leaves.length]!.id;
}

export function replaceLeaf(
  root: PaneNode,
  leafId: string,
  replacement: PaneNode,
): PaneNode {
  if (root.type === "leaf") return root.id === leafId ? replacement : root;
  let changed = false;
  const newChildren = root.children.map((child) => {
    const result = replaceLeaf(child, leafId, replacement);
    if (result !== child) changed = true;
    return result;
  });
  if (!changed) return root;
  return { ...root, children: newChildren };
}

function normalizeSizes(sizes: number[]): number[] {
  const total = sizes.reduce((s, v) => s + v, 0);
  if (total === 0) return sizes.map(() => 100 / sizes.length);
  return sizes.map((v) => (v / total) * 100);
}

export function removeLeaf(root: PaneNode, leafId: string): PaneNode | null {
  if (root.type === "leaf") return root.id === leafId ? null : root;

  let changed = false;
  const newChildren: PaneNode[] = [];
  const newSizes: number[] = [];

  for (let i = 0; i < root.children.length; i++) {
    const child = root.children[i]!;
    if (child.type === "leaf") {
      if (child.id === leafId) {
        changed = true;
        continue;
      }
      newChildren.push(child);
      newSizes.push(root.sizes[i]!);
      continue;
    }
    const result = removeLeaf(child, leafId);
    if (result === null) {
      changed = true;
      continue;
    }
    if (result !== child) changed = true;
    newChildren.push(result);
    newSizes.push(root.sizes[i]!);
  }

  if (!changed) return root;
  if (newChildren.length === 0) return null;
  if (newChildren.length === 1) return newChildren[0]!;
  return { ...root, children: newChildren, sizes: normalizeSizes(newSizes) };
}

export function findSplitByPath(
  root: PaneNode,
  path: number[],
): PaneSplit | null {
  if (path.length === 0) return root.type === "split" ? root : null;
  if (root.type === "leaf") return null;
  const child = root.children[path[0]!];
  if (!child) return null;
  return findSplitByPath(child, path.slice(1));
}

export function replaceSplitSizes(
  root: PaneNode,
  path: number[],
  sizes: number[],
): PaneNode {
  if (root.type === "leaf") return root;
  if (path.length === 0) return { ...root, sizes };

  const idx = path[0]!;
  const child = root.children[idx];
  if (!child) return root;

  const newChild = replaceSplitSizes(child, path.slice(1), sizes);
  if (newChild === child) return root;

  const newChildren = root.children.slice();
  newChildren[idx] = newChild;
  return { ...root, children: newChildren };
}

export function rotateChildren(node: PaneNode): PaneNode {
  if (node.type === "leaf") return node;
  if (node.children.length <= 1) return node;
  const children = [...node.children.slice(1), node.children[0]!];
  const sizes = [...node.sizes.slice(1), node.sizes[0]!];
  return { ...node, children, sizes };
}

export function clearPagePath(root: PaneNode, pagePath: string): PaneNode {
  if (root.type === "leaf") return root.pagePath === pagePath ? { ...root, pagePath: null, viewMode: undefined } : root;
  let changed = false;
  const newChildren = root.children.map((child) => {
    const result = clearPagePath(child, pagePath);
    if (result !== child) changed = true;
    return result;
  });
  return changed ? { ...root, children: newChildren } : root;
}

export function mapPagePath(root: PaneNode, oldPath: string, newPath: string): PaneNode {
  if (root.type === "leaf") {
    return root.pagePath === oldPath ? { ...root, pagePath: newPath } : root;
  }
  let changed = false;
  const children = root.children.map((c) => {
    const n = mapPagePath(c, oldPath, newPath);
    if (n !== c) changed = true;
    return n;
  });
  return changed ? { ...root, children } : root;
}

function segmentLabel(
  direction: "horizontal" | "vertical",
  index: number,
  count: number,
): string {
  if (count === 2) {
    return direction === "horizontal"
      ? index === 0 ? "left" : "right"
      : index === 0 ? "top" : "bottom";
  }
  if (count === 3) {
    const labels =
      direction === "horizontal"
        ? ["left", "center", "right"]
        : ["top", "center", "bottom"];
    return labels[index]!;
  }
  const prefix = direction === "horizontal" ? "col" : "row";
  return `${prefix}-${index + 1}`;
}

export function getPanePosition(root: PaneNode, paneId: string): string | null {
  if (root.type === "leaf") return null;

  function walk(node: PaneNode): string[] | null {
    if (node.type === "leaf") return node.id === paneId ? [] : null;
    for (let i = 0; i < node.children.length; i++) {
      const result = walk(node.children[i]!);
      if (result !== null) {
        result.push(segmentLabel(node.direction, i, node.children.length));
        return result;
      }
    }
    return null;
  }

  const segments = walk(root);
  if (segments === null) return null;
  return segments.join("-");
}

// ---------------------------------------------------------------------------
// Section B: Zustand Store
// ---------------------------------------------------------------------------

export function createInitialState() {
  const root: PaneLeaf = { type: "leaf", id: generatePaneId(), pagePath: null };
  return { root, focusedPaneId: root.id };
}

export const usePaneStore = create<PaneStore>((set, get) => ({
  ...createInitialState(),
  pendingJumpLines: {},

  setPendingJumpLine: (paneId, line) => {
    set({ pendingJumpLines: { ...get().pendingJumpLines, [paneId]: line } });
  },

  consumePendingJumpLine: (paneId) => {
    const { pendingJumpLines } = get();
    const line = pendingJumpLines[paneId];
    if (line == null) return null;
    const next = { ...pendingJumpLines };
    delete next[paneId];
    set({ pendingJumpLines: next });
    return line;
  },

  focusPane: (paneId) => {
    const { root } = get();
    if (findLeaf(root, paneId)) set({ focusedPaneId: paneId });
  },

  setPanePage: (paneId, pagePath) => {
    const { root } = get();
    const leaf = findLeaf(root, paneId);
    if (!leaf || leaf.pagePath === pagePath) return;
    const linkStore = usePanePdfLinkStore.getState();
    if (linkStore.links.has(paneId)) {
      linkStore.unlinkPane(paneId);
    }
    const newLeaf: PaneLeaf = leaf.viewMode
      ? { type: "leaf", id: paneId, pagePath, viewMode: leaf.viewMode }
      : { type: "leaf", id: paneId, pagePath };
    const newRoot = replaceLeaf(root, paneId, newLeaf);
    set({ root: newRoot });
  },

  setPaneViewMode: (paneId, mode) => {
    const { root } = get();
    const leaf = findLeaf(root, paneId);
    if (!leaf) return;
    const current = leaf.viewMode ?? "editor";
    if (current === mode) return;
    const updated: PaneLeaf = mode === "editor"
      ? { type: "leaf", id: paneId, pagePath: leaf.pagePath }
      : { type: "leaf", id: paneId, pagePath: leaf.pagePath, viewMode: mode };
    const newRoot = replaceLeaf(root, paneId, updated);
    set({ root: newRoot });
  },

  renamePagePath: (oldPath, newPath) => {
    const { root } = get();
    const next = mapPagePath(root, oldPath, newPath);
    if (next !== root) set({ root: next });
  },

  resize: (splitPath, sizes) => {
    const { root } = get();
    const split = findSplitByPath(root, splitPath);
    if (!split || split.children.length !== sizes.length) return;
    const newRoot = replaceSplitSizes(root, splitPath, sizes);
    set({ root: newRoot });
  },

  clearPageFromPanes: (pagePath) => {
    const { root } = get();
    const linkStore = usePanePdfLinkStore.getState();
    for (const leaf of collectLeaves(root)) {
      if (leaf.pagePath === pagePath && linkStore.links.has(leaf.id)) {
        linkStore.unlinkPane(leaf.id);
      }
    }
    const newRoot = clearPagePath(root, pagePath);
    if (newRoot !== root) set({ root: newRoot });
  },

  swapLayout: () => {
    const { root } = get();
    if (root.type === "leaf") return;
    set({ root: rotateChildren(root) });
  },

  splitPane: (paneId, direction) => {
    const { root } = get();
    const leaf = findLeaf(root, paneId);
    if (!leaf) return null;
    if (collectLeaves(root).length >= MAX_PANES) return null;
    const newLeaf: PaneLeaf = { type: "leaf", id: generatePaneId(), pagePath: null };
    const split: PaneSplit = {
      type: "split",
      id: generatePaneId(),
      direction,
      children: [leaf, newLeaf],
      sizes: [50, 50],
    };
    const newRoot = replaceLeaf(root, paneId, split);
    set({ root: newRoot, focusedPaneId: newLeaf.id });
    return newLeaf.id;
  },

  closePane: (paneId) => {
    const { root, focusedPaneId } = get();
    const leaves = collectLeaves(root);
    if (leaves.length === 1) {
      const leaf = leaves[0]!;
      if (leaf.id !== paneId || leaf.pagePath === null) return;
      set({ root: { ...leaf, pagePath: null, viewMode: undefined } });
      return;
    }
    const newRoot = removeLeaf(root, paneId);
    if (!newRoot) return;
    if (newRoot === root) return;
    if (focusedPaneId !== paneId && findLeaf(newRoot, focusedPaneId)) {
      set({ root: newRoot });
      return;
    }
    const oldLeaves = collectLeaves(root);
    const idx = oldLeaves.findIndex((l) => l.id === paneId);
    const newLeaves = collectLeaves(newRoot);
    const clampedIdx = Math.max(0, Math.min(idx, newLeaves.length - 1));
    const newFocus = newLeaves[clampedIdx]!.id;
    set({ root: newRoot, focusedPaneId: newFocus });
  },

  focusNext: () => {
    const { root, focusedPaneId } = get();
    const leaves = collectLeaves(root);
    if (leaves.length <= 1) return;
    const nextId = cycleLeafId(leaves, focusedPaneId, 1);
    if (nextId == null) { set({ focusedPaneId: leaves[0]!.id }); return; }
    set({ focusedPaneId: nextId });
  },

  focusPrev: () => {
    const { root, focusedPaneId } = get();
    const leaves = collectLeaves(root);
    if (leaves.length <= 1) return;
    const prevId = cycleLeafId(leaves, focusedPaneId, -1);
    if (prevId == null) { set({ focusedPaneId: leaves[leaves.length - 1]!.id }); return; }
    set({ focusedPaneId: prevId });
  },
}));

// ---------------------------------------------------------------------------
// Section D: Layout Sync (auto-persist to localStorage)
// ---------------------------------------------------------------------------

let unsub: (() => void) | null = null;
let pdfLinkUnsub: (() => void) | null = null;
let pageOffsetUnsub: (() => void) | null = null;
let historyUnsub: (() => void) | null = null;
let beforeUnloadHandler: (() => void) | null = null;

export function startLayoutSync(
  workspacePath: string,
  getPaneViewStates: () => Record<string, ViewState>,
): void {
  stopLayoutSync();
  const flush = () => {
    const { root, focusedPaneId } = usePaneStore.getState();
    const pdfLinks = serializeLinks(usePanePdfLinkStore.getState().links);
    const paneHistory = serializeHistory(usePaneHistoryStore.getState().stacks);
    const pageOffsets = Object.fromEntries(usePanePdfLinkStore.getState().pageOffset);
    saveLayout(workspacePath, root, focusedPaneId, getPaneViewStates(), pdfLinks, paneHistory, pageOffsets);
  };
  unsub = usePaneStore.subscribe(flush);
  // Also persist link changes that don't touch the pane tree (e.g. a standalone
  // unlink from the command palette). Guard on the `links` reference so the
  // high-frequency currentPage/lastSyncedPage/syncEnabled updates that share this
  // store don't spam localStorage on every PDF scroll tick — `links` is replaced
  // by a new Map only on linkPanes/unlinkPane.
  let prevLinks = usePanePdfLinkStore.getState().links;
  pdfLinkUnsub = usePanePdfLinkStore.subscribe((state) => {
    if (state.links !== prevLinks) {
      prevLinks = state.links;
      flush();
    }
  });
  // Persist when pageOffset changes (e.g. companion opened with a trimmed-OCR
  // offset, or re-OCR with lead=0). Guard on the `pageOffset` reference so
  // unrelated store updates don't spam localStorage — `pageOffset` is replaced
  // by a new Map only on setPageOffset.
  let prevPageOffset = usePanePdfLinkStore.getState().pageOffset;
  pageOffsetUnsub = usePanePdfLinkStore.subscribe((state) => {
    if (state.pageOffset !== prevPageOffset) {
      prevPageOffset = state.pageOffset;
      flush();
    }
  });
  // Persist when pane history stacks change (e.g. navigation pushes a new
  // page). Guard on the `stacks` reference identity so we only flush when the
  // Map is actually replaced — same pattern as the pdfLinks subscription.
  let prevStacks = usePaneHistoryStore.getState().stacks;
  historyUnsub = usePaneHistoryStore.subscribe((state) => {
    if (state.stacks !== prevStacks) {
      prevStacks = state.stacks;
      flush();
    }
  });
  beforeUnloadHandler = flush;
  window.addEventListener("beforeunload", beforeUnloadHandler);
}

// ---------------------------------------------------------------------------
// Section E: Cross-store subscription — reset graph views when disabled
// ---------------------------------------------------------------------------

let graphViewUnsub: (() => void) | null = null;
let graphViewDeferredUnsub: (() => void) | null = null;

export function startGraphViewGuard(): void {
  stopGraphViewGuard();
  let prev = usePreferencesStore.getState().graphViewEnabled;
  graphViewUnsub = usePreferencesStore.subscribe((state) => {
    const cur = state.graphViewEnabled;
    if (prev && !cur) {
      const { root } = usePaneStore.getState();
      for (const leaf of collectLeaves(root)) {
        if (leaf.viewMode === "graph") {
          usePaneStore.getState().setPaneViewMode(leaf.id, "editor");
        }
      }
    }
    prev = cur;
  });

  // Initial-state check: if graphViewEnabled is already false at startup,
  // reset any stale graph panes restored from a saved layout.
  // However, graphViewEnabled defaults to false before preferences load,
  // so we must only act on the REAL (loaded) value to avoid clobbering
  // legitimately-restored graph panes during the startup race.
  function resetStaleGraphPanes(): void {
    if (!usePreferencesStore.getState().graphViewEnabled) {
      for (const leaf of collectLeaves(usePaneStore.getState().root)) {
        if (leaf.viewMode === "graph") {
          usePaneStore.getState().setPaneViewMode(leaf.id, "editor");
        }
      }
    }
  }

  if (usePreferencesStore.getState().loaded) {
    // Preferences already loaded — safe to check the real value now.
    resetStaleGraphPanes();
  } else {
    // Preferences not yet loaded — defer until they are.
    graphViewDeferredUnsub = usePreferencesStore.subscribe((state) => {
      if (state.loaded) {
        resetStaleGraphPanes();
        // One-shot: unsubscribe immediately after firing.
        graphViewDeferredUnsub?.();
        graphViewDeferredUnsub = null;
      }
    });
  }
}

export function stopGraphViewGuard(): void {
  graphViewUnsub?.();
  graphViewUnsub = null;
  graphViewDeferredUnsub?.();
  graphViewDeferredUnsub = null;
}

export function stopLayoutSync(): void {
  unsub?.();
  unsub = null;
  pdfLinkUnsub?.();
  pdfLinkUnsub = null;
  pageOffsetUnsub?.();
  pageOffsetUnsub = null;
  historyUnsub?.();
  historyUnsub = null;
  if (beforeUnloadHandler) {
    window.removeEventListener("beforeunload", beforeUnloadHandler);
    beforeUnloadHandler = null;
  }
}
