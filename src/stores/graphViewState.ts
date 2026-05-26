import { create } from "zustand";

export interface GraphViewState {
  mode: "full" | "local";
  depth: number;
  setMode: (mode: "full" | "local") => void;
  setDepth: (depth: number) => void;
}

export const useGraphViewState = create<GraphViewState>((set) => ({
  mode: "full",
  depth: 2,
  setMode: (mode) => set({ mode }),
  setDepth: (depth) => set({ depth }),
}));
