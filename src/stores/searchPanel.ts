import { create } from "zustand";
import { searchContentFiltered, type SearchFilter, type SearchMatchMode, type GraphSearchResult } from "../lib/ipc";

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let requestId = 0;

export interface SearchPanelState {
  query: string;
  filter: SearchFilter;
  matchMode: SearchMatchMode;
  results: GraphSearchResult[];
  selectedIndex: number;
  isLoading: boolean;
  totalCount: number;
  navigatedResultId: string | null;
  error: string | null;

  setQuery: (q: string) => void;
  setFilter: (f: Partial<SearchFilter>) => void;
  clearFilter: () => void;
  setMatchMode: (m: SearchMatchMode) => void;
  executeSearch: () => Promise<void>;
  selectIndex: (i: number) => void;
  selectNext: () => void;
  selectPrev: () => void;
  setNavigatedResultId: (id: string | null) => void;
}

export const useSearchPanelStore = create<SearchPanelState>((set, get) => ({
  query: "",
  filter: {},
  matchMode: "phrase",
  results: [],
  selectedIndex: 0,
  isLoading: false,
  totalCount: 0,
  navigatedResultId: null,
  error: null,

  setQuery: (q: string) => {
    set({ query: q, selectedIndex: 0, navigatedResultId: null });
    if (debounceTimer) clearTimeout(debounceTimer);
    if (!q.trim()) {
      // Invalidate any in-flight search so its response can't resurrect results.
      requestId++;
      set({ results: [], totalCount: 0, isLoading: false, error: null });
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

  setMatchMode: (m: SearchMatchMode) => {
    set({ matchMode: m });
    if (debounceTimer) clearTimeout(debounceTimer);
    get().executeSearch();
  },

  executeSearch: async () => {
    const { query, filter, matchMode } = get();
    if (!query.trim()) {
      set({ results: [], totalCount: 0, isLoading: false, error: null });
      return;
    }
    const id = ++requestId;
    set({ isLoading: true });
    try {
      const results = await searchContentFiltered(query, filter, 100, matchMode);
      if (id !== requestId) return;
      set({ results, totalCount: results.length, isLoading: false, selectedIndex: 0, navigatedResultId: null, error: null });
    } catch (e) {
      if (id !== requestId) return;
      // The backend is the single regex validator (fancy-regex flavor);
      // surface its message inline instead of pre-validating in JS.
      const error = get().matchMode === "regex" ? String(e) : null;
      set({ results: [], totalCount: 0, isLoading: false, error });
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
