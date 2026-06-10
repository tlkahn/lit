import { create } from "zustand";

export interface GraphViewState {
  mode: "full" | "local";
  depth: number;
  showCitations: boolean;
  setMode: (mode: "full" | "local") => void;
  setDepth: (depth: number) => void;
  setShowCitations: (show: boolean) => void;
}

export const useGraphViewState = create<GraphViewState>((set) => ({
  mode: "full",
  depth: 2,
  showCitations: false,
  setMode: (mode) => set({ mode }),
  setDepth: (depth) => set({ depth }),
  setShowCitations: (show) => set({ showCitations: show }),
}));
