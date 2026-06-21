import { create } from "zustand";
import { usePaneStore, findLeaf, collectLeaves, type PaneNode } from "./panes";
import { useWorkspaceStore } from "./workspace";

const MAX_ENTRIES = 50;

export interface PaneHistoryStack {
  entries: string[];
  index: number;
}

export interface PaneHistoryStore {
  stacks: Map<string, PaneHistoryStack>;
  pushPage(paneId: string, pagePath: string): void;
  goBack(paneId: string): string | null;
  goForward(paneId: string): string | null;
  canGoBack(paneId: string): boolean;
  canGoForward(paneId: string): boolean;
  removePaneHistory(paneId: string): void;
  clearPath(pagePath: string): void;
  renamePath(oldPath: string, newPath: string): void;
}

let _isHistoryNavigation = false;

/**
 * Check whether a page still exists in the workspace.
 * When pages is empty (not yet loaded), assume all entries are valid
 * to avoid breaking navigation before the workspace finishes loading.
 */
function pageExists(path: string): boolean {
  const pages = useWorkspaceStore.getState().pages;
  if (pages.length === 0) return true;
  return pages.some((p) => p.relative_path === path);
}

function navigate(
  get: () => PaneHistoryStore,
  set: (s: Partial<PaneHistoryStore>) => void,
  paneId: string,
  delta: -1 | 1,
): string | null {
  const stack = get().stacks.get(paneId);
  if (!stack) return null;

  const entries = [...stack.entries];
  const deadIndices: number[] = [];
  let scanIdx = stack.index + delta;
  let targetIdx = -1;

  // Scan in the requested direction, collecting dead entries, stopping at first live one.
  while (scanIdx >= 0 && scanIdx < entries.length) {
    if (pageExists(entries[scanIdx]!)) {
      targetIdx = scanIdx;
      break;
    }
    deadIndices.push(scanIdx);
    scanIdx += delta;
  }

  // Nothing to prune and no valid target -- boundary reached (same as old behavior).
  if (deadIndices.length === 0 && targetIdx === -1) return null;

  // Prune dead entries if any were found.
  if (deadIndices.length > 0) {
    // Sort descending so splice indices remain valid during removal.
    for (const i of deadIndices.sort((a, b) => b - a)) {
      entries.splice(i, 1);
    }
    // Recompute the current index: subtract the count of removed entries
    // that were at positions <= the original index.
    const removedBeforeCurrent = deadIndices.filter((i) => i <= stack.index).length;
    const adjustedCurrentIndex = stack.index - removedBeforeCurrent;

    if (targetIdx === -1) {
      // No valid target in this direction -- commit the prune and no-op.
      const newIndex = Math.max(0, Math.min(adjustedCurrentIndex, entries.length - 1));
      const stacks = new Map(get().stacks);
      if (entries.length === 0) {
        stacks.delete(paneId);
      } else {
        stacks.set(paneId, { entries, index: newIndex });
      }
      set({ stacks });
      return null;
    }

    // Recompute targetIdx in the pruned array: subtract the count of removed
    // entries that were at positions before the original target index.
    const removedBeforeTarget = deadIndices.filter((i) => i < targetIdx).length;
    targetIdx -= removedBeforeTarget;
  }

  const target = entries[targetIdx]!;

  // Existing pane-leaf guard (unchanged behavior).
  const paneState = usePaneStore.getState();
  const leaf = findLeaf(paneState.root, paneId);
  if (!leaf || leaf.pagePath === target) {
    // Still commit pruning even if we cannot navigate.
    if (deadIndices.length > 0) {
      const removedBeforeCurrent = deadIndices.filter((i) => i <= stack.index).length;
      const adjustedCurrentIndex = stack.index - removedBeforeCurrent;
      const newIndex = Math.max(0, Math.min(adjustedCurrentIndex, entries.length - 1));
      const stacks = new Map(get().stacks);
      stacks.set(paneId, { entries, index: newIndex });
      set({ stacks });
    }
    return null;
  }

  const stacks = new Map(get().stacks);
  stacks.set(paneId, { entries, index: targetIdx });
  set({ stacks });
  try {
    _isHistoryNavigation = true;
    paneState.setPanePage(paneId, target);
  } finally {
    _isHistoryNavigation = false;
  }
  return target;
}

export const usePaneHistoryStore = create<PaneHistoryStore>((set, get) => ({
  stacks: new Map(),

  pushPage: (paneId, pagePath) => {
    const currentStacks = get().stacks;
    const stack = currentStacks.get(paneId) ?? { entries: [], index: -1 };

    if (stack.entries[stack.index] === pagePath) return;

    const stacks = new Map(currentStacks);
    const entries = stack.entries.slice(0, stack.index + 1);
    entries.push(pagePath);
    if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);
    stacks.set(paneId, { entries, index: entries.length - 1 });
    set({ stacks });
  },

  goBack: (paneId) => navigate(get, set, paneId, -1),

  goForward: (paneId) => navigate(get, set, paneId, 1),

  canGoBack: (paneId) => {
    const stack = get().stacks.get(paneId);
    return !!stack && stack.index > 0;
  },

  canGoForward: (paneId) => {
    const stack = get().stacks.get(paneId);
    return !!stack && stack.index < stack.entries.length - 1;
  },

  removePaneHistory: (paneId) => {
    const stacks = new Map(get().stacks);
    stacks.delete(paneId);
    set({ stacks });
  },

  clearPath: (pagePath) => {
    const stacks = new Map(get().stacks);
    let changed = false;
    for (const [paneId, stack] of stacks) {
      const currentEntry = stack.entries[stack.index];
      const filtered = stack.entries.filter((e) => e !== pagePath);
      if (filtered.length === stack.entries.length) continue;
      changed = true;
      if (filtered.length === 0) {
        stacks.delete(paneId);
        continue;
      }
      let newIndex: number;
      if (currentEntry && currentEntry !== pagePath) {
        let removedBefore = 0;
        for (let i = 0; i <= stack.index; i++) {
          if (stack.entries[i] === pagePath) removedBefore++;
        }
        newIndex = Math.min(stack.index - removedBefore, filtered.length - 1);
      } else {
        newIndex = Math.max(0, Math.min(stack.index - 1, filtered.length - 1));
      }
      stacks.set(paneId, { entries: filtered, index: newIndex });
    }
    if (changed) set({ stacks });
  },

  renamePath: (oldPath, newPath) => {
    const stacks = new Map(get().stacks);
    let changed = false;
    for (const [paneId, stack] of stacks) {
      const entries = stack.entries.map((e) => (e === oldPath ? newPath : e));
      if (entries.some((e, i) => e !== stack.entries[i])) {
        changed = true;
        stacks.set(paneId, { ...stack, entries });
      }
    }
    if (changed) set({ stacks });
  },
}));

// ---------------------------------------------------------------------------
// Serialization helpers for persistence (see paneLayout.ts / workspace.ts).
// The store holds a Map<string, PaneHistoryStack>; persistence needs a plain
// JSON-safe object.
// ---------------------------------------------------------------------------

/** Convert the in-memory Map to a plain object for JSON serialization. */
export function serializeHistory(
  stacks: Map<string, PaneHistoryStack>,
): Record<string, PaneHistoryStack> {
  return Object.fromEntries(stacks);
}

/** Build the in-memory Map from a plain object read from JSON. */
export function deserializeHistory(
  data: Record<string, PaneHistoryStack>,
): Map<string, PaneHistoryStack> {
  return new Map(Object.entries(data));
}

// ---------------------------------------------------------------------------
// Auto-tracking: subscribe to pane store, push page on navigation
// ---------------------------------------------------------------------------

let trackingUnsub: (() => void) | null = null;
let prevLeaves: Map<string, string | null> | null = null;
let prevRoot: PaneNode | null = null;

function collectLeafMap(root: PaneNode): Map<string, string | null> {
  const map = new Map<string, string | null>();
  for (const leaf of collectLeaves(root)) {
    map.set(leaf.id, leaf.pagePath);
  }
  return map;
}

export function initPaneHistoryTracking(): void {
  if (trackingUnsub) return;
  prevRoot = usePaneStore.getState().root;
  prevLeaves = collectLeafMap(prevRoot);

  // Seed the currently-open document of each pane as its first history entry.
  // This covers the doc restored from the previous session's layout (and any doc
  // already open before tracking starts), which the subscription below would
  // otherwise never record because it only fires on subsequent changes. pushPage
  // dedups when a restored stack's current entry already equals the live
  // pagePath, so restored stacks are preserved untouched.
  for (const [id, pagePath] of prevLeaves) {
    if (pagePath !== null) {
      usePaneHistoryStore.getState().pushPage(id, pagePath);
    }
  }

  trackingUnsub = usePaneStore.subscribe((state) => {
    if (state.root === prevRoot) return;
    prevRoot = state.root;
    const currentLeaves = collectLeafMap(state.root);

    if (!_isHistoryNavigation) {
      const prev = prevLeaves!;
      for (const [id, pagePath] of currentLeaves) {
        if (pagePath !== null && pagePath !== prev.get(id)) {
          usePaneHistoryStore.getState().pushPage(id, pagePath);
        }
      }
    }

    // Clean up stacks for removed panes
    const { stacks } = usePaneHistoryStore.getState();
    for (const paneId of stacks.keys()) {
      if (!currentLeaves.has(paneId)) {
        usePaneHistoryStore.getState().removePaneHistory(paneId);
      }
    }

    prevLeaves = currentLeaves;
  });
}

export function stopPaneHistoryTracking(): void {
  trackingUnsub?.();
  trackingUnsub = null;
  prevLeaves = null;
  prevRoot = null;
}
