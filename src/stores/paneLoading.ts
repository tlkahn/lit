import { create } from "zustand";

export interface PaneLoadingState {
  loadingPaneIds: Set<string>;
  startLoading: (paneId: string) => void;
  stopLoading: (paneId: string) => void;
}

export const usePaneLoadingStore = create<PaneLoadingState>((set) => ({
  loadingPaneIds: new Set<string>(),
  startLoading: (paneId) =>
    set((s) => {
      const next = new Set(s.loadingPaneIds);
      next.add(paneId);
      return { loadingPaneIds: next };
    }),
  stopLoading: (paneId) =>
    set((s) => {
      if (!s.loadingPaneIds.has(paneId)) return s;
      const next = new Set(s.loadingPaneIds);
      next.delete(paneId);
      return { loadingPaneIds: next };
    }),
}));
