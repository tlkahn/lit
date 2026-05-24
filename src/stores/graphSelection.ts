import { create } from "zustand";

export type SelectionMode = "none" | "click" | "lasso";

export interface GraphSelectionState {
  selectedNodes: string[];
  selectionMode: SelectionMode;
  toggleNode: (id: string) => void;
  addNode: (id: string) => void;
  addNodes: (ids: string[]) => void;
  removeNode: (id: string) => void;
  setNodes: (ids: string[]) => void;
  setSelectionMode: (mode: SelectionMode) => void;
  clearSelection: () => void;
  isSelected: (id: string) => boolean;
}

export const useGraphSelectionStore = create<GraphSelectionState>((set, get) => ({
  selectedNodes: [],
  selectionMode: "none",
  toggleNode: (id) =>
    set((s) => {
      const idx = s.selectedNodes.indexOf(id);
      if (idx >= 0) {
        const next = s.selectedNodes.filter((n) => n !== id);
        return { selectedNodes: next, selectionMode: next.length > 0 ? "click" : "none" };
      }
      return { selectedNodes: [...s.selectedNodes, id], selectionMode: "click" };
    }),
  addNode: (id) =>
    set((s) => {
      if (s.selectedNodes.includes(id)) return s;
      return { selectedNodes: [...s.selectedNodes, id] };
    }),
  addNodes: (ids) =>
    set((s) => {
      if (ids.length === 0) return s;
      const existing = new Set(s.selectedNodes);
      const newIds = ids.filter((id) => !existing.has(id));
      if (newIds.length === 0) return s;
      return { selectedNodes: [...s.selectedNodes, ...newIds] };
    }),
  removeNode: (id) =>
    set((s) => {
      if (!s.selectedNodes.includes(id)) return s;
      return { selectedNodes: s.selectedNodes.filter((n) => n !== id) };
    }),
  setNodes: (ids) => set({ selectedNodes: ids }),
  setSelectionMode: (mode) => set({ selectionMode: mode }),
  clearSelection: () => set({ selectedNodes: [], selectionMode: "none" }),
  isSelected: (id) => get().selectedNodes.includes(id),
}));

useGraphSelectionStore.subscribe((state, prev) => {
  if (state.selectedNodes !== prev.selectedNodes) {
    console.debug(
      "[graphSelection] %s | selected: %o",
      state.selectionMode,
      state.selectedNodes,
    );
  }
});
