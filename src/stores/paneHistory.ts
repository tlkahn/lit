import { create } from "zustand";
import { usePaneStore, collectLeaves, type PaneNode } from "./panes";

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
}

let _isHistoryNavigation = false;

export const usePaneHistoryStore = create<PaneHistoryStore>((set, get) => ({
  stacks: new Map(),

  pushPage: (paneId, pagePath) => {
    const stacks = new Map(get().stacks);
    const stack = stacks.get(paneId) ?? { entries: [], index: -1 };

    if (stack.entries[stack.index] === pagePath) return;

    const entries = stack.entries.slice(0, stack.index + 1);
    entries.push(pagePath);
    if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);
    stacks.set(paneId, { entries, index: entries.length - 1 });
    set({ stacks });
  },

  goBack: (paneId) => {
    const stack = get().stacks.get(paneId);
    if (!stack || stack.index <= 0) return null;
    const newIndex = stack.index - 1;
    const target = stack.entries[newIndex]!;
    const stacks = new Map(get().stacks);
    stacks.set(paneId, { ...stack, index: newIndex });
    set({ stacks });
    _isHistoryNavigation = true;
    usePaneStore.getState().setPanePage(paneId, target);
    _isHistoryNavigation = false;
    return target;
  },

  goForward: (paneId) => {
    const stack = get().stacks.get(paneId);
    if (!stack || stack.index >= stack.entries.length - 1) return null;
    const newIndex = stack.index + 1;
    const target = stack.entries[newIndex]!;
    const stacks = new Map(get().stacks);
    stacks.set(paneId, { ...stack, index: newIndex });
    set({ stacks });
    _isHistoryNavigation = true;
    usePaneStore.getState().setPanePage(paneId, target);
    _isHistoryNavigation = false;
    return target;
  },

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
        newIndex = filtered.indexOf(currentEntry);
      } else {
        newIndex = Math.min(stack.index, filtered.length - 1);
      }
      stacks.set(paneId, { entries: filtered, index: newIndex });
    }
    if (changed) set({ stacks });
  },
}));

// ---------------------------------------------------------------------------
// Auto-tracking: subscribe to pane store, push page on navigation
// ---------------------------------------------------------------------------

let trackingUnsub: (() => void) | null = null;
let prevLeaves: Map<string, string | null> | null = null;

function collectLeafMap(root: PaneNode): Map<string, string | null> {
  const map = new Map<string, string | null>();
  for (const leaf of collectLeaves(root)) {
    map.set(leaf.id, leaf.pagePath);
  }
  return map;
}

export function initPaneHistoryTracking(): void {
  if (trackingUnsub) return;
  prevLeaves = collectLeafMap(usePaneStore.getState().root);
  trackingUnsub = usePaneStore.subscribe((state) => {
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
}
