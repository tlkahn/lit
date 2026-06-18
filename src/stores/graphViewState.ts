import { create } from "zustand";

export interface GraphViewState {
  mode: "full" | "local";
  depth: number;
  showCitations: boolean;
  showCardboxLinks: boolean;
  setMode: (mode: "full" | "local") => void;
  setDepth: (depth: number) => void;
  setShowCitations: (show: boolean) => void;
  setShowCardboxLinks: (show: boolean) => void;
}

export const useGraphViewState = create<GraphViewState>((set) => ({
  mode: "full",
  depth: 2,
  showCitations: false,
  showCardboxLinks: false,
  setMode: (mode) => set({ mode }),
  setDepth: (depth) => set({ depth }),
  setShowCitations: (show) => set({ showCitations: show }),
  setShowCardboxLinks: (show) => set({ showCardboxLinks: show }),
}));
