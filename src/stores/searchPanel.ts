import { create } from "zustand";
import { searchContentFiltered, type SearchFilter, type GraphSearchResult } from "../lib/ipc";

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let requestId = 0;

export interface SearchPanelState {
  query: string;
  filter: SearchFilter;
  results: GraphSearchResult[];
  selectedIndex: number;
  isLoading: boolean;
  totalCount: number;
  navigatedResultId: string | null;

  setQuery: (q: string) => void;
  setFilter: (f: Partial<SearchFilter>) => void;
  clearFilter: () => void;
  executeSearch: () => Promise<void>;
  selectIndex: (i: number) => void;
  selectNext: () => void;
  selectPrev: () => void;
  setNavigatedResultId: (id: string | null) => void;
}

export const useSearchPanelStore = create<SearchPanelState>((set, get) => ({
  query: "",
  filter: {},
  results: [],
  selectedIndex: 0,
  isLoading: false,
  totalCount: 0,
  navigatedResultId: null,

  setQuery: (q: string) => {
    set({ query: q, selectedIndex: 0, navigatedResultId: null });
    if (debounceTimer) clearTimeout(debounceTimer);
    if (!q.trim()) {
      set({ results: [], totalCount: 0, isLoading: false });
      return;
    }
    set({ isLoading: true });
    debounceTimer = setTimeout(() => {
      get().executeSearch();
    }, 150);
  },

  setFilter: (f: Partial<SearchFilter>) => {
    const current = get().filter;
    const merged: SearchFilter = { ...current, ...f };
    for (const key of Object.keys(merged) as (keyof SearchFilter)[]) {
      if (merged[key] === undefined) delete merged[key];
    }
    set({ filter: merged });
    if (debounceTimer) clearTimeout(debounceTimer);
    get().executeSearch();
  },

  clearFilter: () => {
    set({ filter: {} });
    if (debounceTimer) clearTimeout(debounceTimer);
    get().executeSearch();
  },

  executeSearch: async () => {
    const { query, filter } = get();
    if (!query.trim()) {
      set({ results: [], totalCount: 0, isLoading: false });
      return;
    }
    const id = ++requestId;
    set({ isLoading: true });
    try {
      const results = await searchContentFiltered(query, filter, 100);
      if (id !== requestId) return;
      set({ results, totalCount: results.length, isLoading: false, selectedIndex: 0, navigatedResultId: null });
    } catch {
      if (id !== requestId) return;
      set({ results: [], totalCount: 0, isLoading: false });
    }
  },

  selectIndex: (i: number) => {
    set({ selectedIndex: i });
  },

  selectNext: () => {
    const { selectedIndex, results } = get();
    if (results.length === 0) return;
    set({ selectedIndex: Math.min(selectedIndex + 1, results.length - 1) });
  },

  selectPrev: () => {
    const { selectedIndex } = get();
    set({ selectedIndex: Math.max(selectedIndex - 1, 0) });
  },

  setNavigatedResultId: (id: string | null) => {
    set({ navigatedResultId: id });
  },
}));
