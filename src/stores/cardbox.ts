import { create } from "zustand";
import type { CardboxAnnotation } from "../lib/ipc";
import { listAllAnnotations, readCardboxLayout, writeCardboxLayout } from "../lib/ipc";

export interface CardboxStore {
  annotations: CardboxAnnotation[];
  expandedUuid: string | null;
  loading: boolean;
  searchQuery: string;
  activeTypes: Set<string> | null;
  order: string[];
  fetchAnnotations: () => Promise<void>;
  toggleExpand: (uuid: string) => void;
  collapseAll: () => void;
  setSearchQuery: (query: string) => void;
  toggleType: (type: string) => void;
  resetFilters: () => void;
  setOrder: (order: string[]) => void;
  loadLayout: () => Promise<void>;
  saveLayout: () => Promise<void>;
}

export const useCardboxStore = create<CardboxStore>((set, get) => ({
  annotations: [],
  expandedUuid: null,
  loading: false,
  searchQuery: "",
  activeTypes: null,
  order: [],
  fetchAnnotations: async () => {
    if (get().loading) return;
    set({ loading: true });
    try {
      const annotations = await listAllAnnotations();
      const types = new Set(annotations.map((a) => a.annotation_type));
      set((s) => ({
        annotations,
        loading: false,
        activeTypes: s.activeTypes === null ? types : s.activeTypes,
        // Initialize order from annotation UUIDs on first load, preserve on refreshes
        order: s.order.length === 0 ? annotations.map((a) => a.uuid) : s.order,
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
  setOrder: (order) => set({ order }),
  loadLayout: async () => {
    try {
      const layout = await readCardboxLayout();
      if (layout.order.length > 0) {
        set({ order: layout.order });
      }
    } catch {
      // Ignore — use default order from annotations
    }
  },
  saveLayout: async () => {
    const { order } = get();
    try {
      await writeCardboxLayout({ version: 1, order });
    } catch {
      // Ignore write failures silently
    }
  },
}));
