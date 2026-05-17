import { create } from "zustand";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PaneLeaf = { type: "leaf"; id: string; pagePath: string | null };
export type PaneSplit = {
  type: "split";
  direction: "horizontal" | "vertical";
  children: PaneNode[];
  sizes: number[];
};
export type PaneNode = PaneLeaf | PaneSplit;

export interface PaneStore {
  root: PaneNode;
  focusedPaneId: string;
  splitPane(paneId: string, direction: "horizontal" | "vertical"): void;
  closePane(paneId: string): void;
  focusPane(paneId: string): void;
  focusNext(): void;
  focusPrev(): void;
  setPanePage(paneId: string, pagePath: string | null): void;
  resize(splitPath: number[], sizes: number[]): void;
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

  splitPane: (paneId, direction) => {
    const { root } = get();
    const leaf = findLeaf(root, paneId);
    if (!leaf) return;
    const newLeaf: PaneLeaf = { type: "leaf", id: generatePaneId(), pagePath: null };
    const split: PaneSplit = {
      type: "split",
      direction,
      children: [leaf, newLeaf],
      sizes: [50, 50],
    };
    const newRoot = replaceLeaf(root, paneId, split);
    set({ root: newRoot, focusedPaneId: newLeaf.id });
  },

  closePane: (paneId) => {
    const { root, focusedPaneId } = get();
    const newRoot = removeLeaf(root, paneId);
    if (!newRoot) return;
    if (newRoot === root) return;
    if (focusedPaneId !== paneId) {
      set({ root: newRoot });
      return;
    }
    const oldLeaves = collectLeaves(root);
    const idx = oldLeaves.findIndex((l) => l.id === paneId);
    const newLeaves = collectLeaves(newRoot);
    const newFocus = newLeaves[Math.min(idx, newLeaves.length - 1)]!.id;
    set({ root: newRoot, focusedPaneId: newFocus });
  },

  focusNext: () => {
    const { root, focusedPaneId } = get();
    const leaves = collectLeaves(root);
    if (leaves.length <= 1) return;
    const idx = leaves.findIndex((l) => l.id === focusedPaneId);
    set({ focusedPaneId: leaves[(idx + 1) % leaves.length]!.id });
  },

  focusPrev: () => {
    const { root, focusedPaneId } = get();
    const leaves = collectLeaves(root);
    if (leaves.length <= 1) return;
    const idx = leaves.findIndex((l) => l.id === focusedPaneId);
    set({ focusedPaneId: leaves[(idx - 1 + leaves.length) % leaves.length]!.id });
  },
}));
