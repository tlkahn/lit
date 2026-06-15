import { create } from "zustand";
import type { CardboxAnnotation } from "../lib/ipc";
import { listAllAnnotations } from "../lib/ipc";

export interface CardboxStore {
  annotations: CardboxAnnotation[];
  expandedUuid: string | null;
  loading: boolean;
  fetchAnnotations: () => Promise<void>;
  toggleExpand: (uuid: string) => void;
  collapseAll: () => void;
}

export const useCardboxStore = create<CardboxStore>((set) => ({
  annotations: [],
  expandedUuid: null,
  loading: false,
  fetchAnnotations: async () => {
    set({ loading: true });
    try {
      const annotations = await listAllAnnotations();
      set({ annotations, loading: false });
    } catch {
      set({ loading: false });
    }
  },
  toggleExpand: (uuid) =>
    set((s) => ({
      expandedUuid: s.expandedUuid === uuid ? null : uuid,
    })),
  collapseAll: () => set({ expandedUuid: null }),
}));
