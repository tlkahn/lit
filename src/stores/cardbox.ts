import { create } from "zustand";
import type { CardboxAnnotation } from "../lib/ipc";
import { listAllAnnotations } from "../lib/ipc";

export interface CardboxStore {
  annotations: CardboxAnnotation[];
  expandedUuid: string | null;
  loading: boolean;
  searchQuery: string;
  activeTypes: Set<string>;
  fetchAnnotations: () => Promise<void>;
  toggleExpand: (uuid: string) => void;
  collapseAll: () => void;
  setSearchQuery: (query: string) => void;
  toggleType: (type: string) => void;
  resetFilters: () => void;
}

export const useCardboxStore = create<CardboxStore>((set, get) => ({
  annotations: [],
  expandedUuid: null,
  loading: false,
  searchQuery: "",
  activeTypes: new Set<string>(),
  fetchAnnotations: async () => {
    if (get().loading) return;
    set({ loading: true });
    try {
      const annotations = await listAllAnnotations();
      const types = new Set(annotations.map((a) => a.annotation_type));
      set((s) => ({
        annotations,
        loading: false,
        // Initialize activeTypes to all types on first load, preserve user's selection on refreshes
        activeTypes: s.activeTypes.size === 0 ? types : s.activeTypes,
      }));
    } catch {
      set({ loading: false });
    }
  },
  toggleExpand: (uuid) =>
    set((s) => ({
      expandedUuid: s.expandedUuid === uuid ? null : uuid,
    })),
  collapseAll: () => set({ expandedUuid: null }),
  setSearchQuery: (query) => set({ searchQuery: query }),
  toggleType: (type) =>
    set((s) => {
      const next = new Set(s.activeTypes);
      if (next.has(type)) {
        next.delete(type);
      } else {
        next.add(type);
      }
      return { activeTypes: next };
    }),
  resetFilters: () =>
    set((s) => ({
      searchQuery: "",
      activeTypes: new Set(s.annotations.map((a) => a.annotation_type)),
    })),
}));
