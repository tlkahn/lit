import { create } from "zustand";

export interface CacheProgressEntry {
  current: number;
  total: number;
  done: boolean;
}

export interface PdfCacheProgressStore {
  /** slot key -> latest precache progress for that slot. */
  progress: Map<string, CacheProgressEntry>;
  /** Record the latest progress for `slot`. */
  update(slot: string, current: number, total: number, done: boolean): void;
  /** Drop the progress entry for `slot` (no-op if absent). */
  clear(slot: string): void;
}

export const usePdfCacheProgressStore = create<PdfCacheProgressStore>((set, get) => ({
  progress: new Map(),
  update: (slot, current, total, done) => {
    const progress = new Map(get().progress);
    progress.set(slot, { current, total, done });
    set({ progress });
  },
  clear: (slot) => {
    if (!get().progress.has(slot)) return; // avoid needless re-render/new Map
    const progress = new Map(get().progress);
    progress.delete(slot);
    set({ progress });
  },
}));
