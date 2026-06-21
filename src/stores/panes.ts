import { create } from "zustand";
import type { ViewState } from "../types";
import { saveLayout } from "../lib/paneLayout";
import { usePanePdfLinkStore, serializeLinks } from "./panePdfLink";
import { usePaneHistoryStore, serializeHistory } from "./paneHistory";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PaneLeaf = { type: "leaf"; id: string; pagePath: string | null };
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
  splitPane(paneId: string, direction: "horizontal" | "vertical"): string | null;
  closePane(paneId: string): void;
  focusPane(paneId: string): void;
  focusNext(): void;
  focusPrev(): void;
  setPanePage(paneId: string, pagePath: string | null): void;
  resize(splitPath: number[], sizes: number[]): void;
  clearPageFromPanes(pagePath: string): void;
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

export function clearPagePath(root: PaneNode, pagePath: string): PaneNode {
  if (root.type === "leaf") return root.pagePath === pagePath ? { ...root, pagePath: null } : root;
  let changed = false;
  const newChildren = root.children.map((child) => {
    const result = clearPagePath(child, pagePath);
    if (result !== child) changed = true;
    return result;
  });
  return changed ? { ...root, children: newChildren } : root;
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

  focusPane: (paneId) => {
    const { root } = get();
    if (findLeaf(root, paneId)) set({ focusedPaneId: paneId });
  },

  setPanePage: (paneId, pagePath) => {
    const { root } = get();
    const leaf = findLeaf(root, paneId);
    if (!leaf || leaf.pagePath === pagePath) return;
    const newRoot = replaceLeaf(root, paneId, { type: "leaf", id: paneId, pagePath });
    set({ root: newRoot });
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
    const newRoot = clearPagePath(root, pagePath);
    if (newRoot !== root) set({ root: newRoot });
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
      set({ root: { ...leaf, pagePath: null } });
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
    const idx = leaves.findIndex((l) => l.id === focusedPaneId);
    if (idx === -1) { set({ focusedPaneId: leaves[0]!.id }); return; }
    set({ focusedPaneId: leaves[(idx + 1) % leaves.length]!.id });
  },

  focusPrev: () => {
    const { root, focusedPaneId } = get();
    const leaves = collectLeaves(root);
    if (leaves.length <= 1) return;
    const idx = leaves.findIndex((l) => l.id === focusedPaneId);
    if (idx === -1) { set({ focusedPaneId: leaves[leaves.length - 1]!.id }); return; }
    set({ focusedPaneId: leaves[(idx - 1 + leaves.length) % leaves.length]!.id });
  },
}));

// ---------------------------------------------------------------------------
// Section D: Layout Sync (auto-persist to localStorage)
// ---------------------------------------------------------------------------

let unsub: (() => void) | null = null;
let pdfLinkUnsub: (() => void) | null = null;
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
    saveLayout(workspacePath, root, focusedPaneId, getPaneViewStates(), pdfLinks, paneHistory);
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

export function stopLayoutSync(): void {
  unsub?.();
  unsub = null;
  pdfLinkUnsub?.();
  pdfLinkUnsub = null;
  historyUnsub?.();
  historyUnsub = null;
  if (beforeUnloadHandler) {
    window.removeEventListener("beforeunload", beforeUnloadHandler);
    beforeUnloadHandler = null;
  }
}
