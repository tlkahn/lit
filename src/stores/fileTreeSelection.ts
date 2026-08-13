import { create } from "zustand";

export interface FileTreeSelectionStore {
  selectedPaths: Set<string>;
  lastSelectedPath: string | null;
  toggle: (path: string) => void;
  rangeSelect: (path: string, orderedVisiblePagePaths: string[]) => void;
  setOnly: (path: string) => void;
  selectAll: (paths: string[]) => void;
  clear: () => void;
  pruneTo: (existingPaths: Iterable<string>) => void;
}

export const useFileTreeSelectionStore = create<FileTreeSelectionStore>((set, get) => ({
  selectedPaths: new Set<string>(),
  lastSelectedPath: null,

  toggle: (path) => {
    set((s) => {
      const next = new Set(s.selectedPaths);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return { selectedPaths: next, lastSelectedPath: path };
    });
  },

  rangeSelect: (path, orderedVisiblePagePaths) => {
    const { lastSelectedPath, selectedPaths } = get();
    if (!lastSelectedPath) {
      set({ selectedPaths: new Set([path]), lastSelectedPath: path });
      return;
    }
    const startIdx = orderedVisiblePagePaths.indexOf(lastSelectedPath);
    const endIdx = orderedVisiblePagePaths.indexOf(path);
    if (startIdx === -1 || endIdx === -1) {
      set({ selectedPaths: new Set([path]), lastSelectedPath: path });
      return;
    }
    const lo = Math.min(startIdx, endIdx);
    const hi = Math.max(startIdx, endIdx);
    const range = orderedVisiblePagePaths.slice(lo, hi + 1);
    const next = new Set(selectedPaths);
    for (const p of range) next.add(p);
    // Anchor stays so consecutive Shift+clicks extend from the same anchor.
    set({ selectedPaths: next });
  },

  setOnly: (path) => {
    set({ selectedPaths: new Set([path]), lastSelectedPath: path });
  },

  selectAll: (paths) => {
    set({
      selectedPaths: new Set(paths),
      lastSelectedPath: paths.length > 0 ? paths[paths.length - 1] : null,
    });
  },

  clear: () => {
    set({ selectedPaths: new Set(), lastSelectedPath: null });
  },

  pruneTo: (existingPaths) => {
    const existing = new Set(existingPaths);
    set((s) => {
      const next = new Set<string>();
      for (const p of s.selectedPaths) {
        if (existing.has(p)) next.add(p);
      }
      const last = s.lastSelectedPath && existing.has(s.lastSelectedPath)
        ? s.lastSelectedPath
        : null;
      return { selectedPaths: next, lastSelectedPath: last };
    });
  },
}));
