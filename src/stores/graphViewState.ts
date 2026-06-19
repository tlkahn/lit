import { create } from "zustand";

export interface EdgeFilters {
  citations: boolean;
  cardbox: boolean;
}

export const DEFAULT_EDGE_FILTERS: EdgeFilters = { citations: false, cardbox: false };

export interface GraphViewState {
  mode: "full" | "local";
  depth: number;
  edgeFilters: EdgeFilters;
  setMode: (mode: "full" | "local") => void;
  setDepth: (depth: number) => void;
  setEdgeFilter: (kind: keyof EdgeFilters, visible: boolean) => void;
}

export const useGraphViewState = create<GraphViewState>((set) => ({
  mode: "full",
  depth: 2,
  edgeFilters: DEFAULT_EDGE_FILTERS,
  setMode: (mode) => set({ mode }),
  setDepth: (depth) => set({ depth }),
  setEdgeFilter: (kind, visible) => set((s) => ({ edgeFilters: { ...s.edgeFilters, [kind]: visible } })),
}));
