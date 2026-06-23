import { create } from "zustand";

export interface RefNavEntry {
  key: string;
  title: string;
}

export interface RefNavStackStore {
  stacks: Map<string, RefNavEntry[]>;
  push(paneId: string, key: string, title: string): void;
  pop(paneId: string): RefNavEntry | null;
  reset(paneId: string): void;
  current(paneId: string): RefNavEntry | null;
  depth(paneId: string): number;
  isOnStack(paneId: string, key: string): boolean;
  removePaneStack(paneId: string): void;
}

export const useRefNavStackStore = create<RefNavStackStore>((set, get) => ({
  stacks: new Map(),

  push: (paneId, key, title) => {
    const { stacks } = get();
    const arr = stacks.get(paneId) ?? [];
    const idx = arr.findIndex((e) => e.key === key);
    if (idx !== -1) {
      if (arr[idx]!.title === title) return;
      const updated = arr.slice();
      updated[idx] = { key, title };
      const next = new Map(stacks);
      next.set(paneId, updated);
      set({ stacks: next });
      return;
    }
    const next = new Map(stacks);
    next.set(paneId, [...arr, { key, title }]);
    set({ stacks: next });
  },

  pop: (paneId) => {
    const { stacks } = get();
    const arr = stacks.get(paneId);
    if (!arr || arr.length === 0) return null;
    const top = arr[arr.length - 1]!;
    const next = new Map(stacks);
    next.set(paneId, arr.slice(0, -1));
    set({ stacks: next });
    return top;
  },

  reset: (paneId) => {
    const { stacks } = get();
    if (!stacks.has(paneId)) return;
    const next = new Map(stacks);
    next.delete(paneId);
    set({ stacks: next });
  },

  current: (paneId) => {
    const arr = get().stacks.get(paneId);
    return arr && arr.length > 0 ? arr[arr.length - 1]! : null;
  },

  depth: (paneId) => {
    return get().stacks.get(paneId)?.length ?? 0;
  },

  isOnStack: (paneId, key) => {
    return get().stacks.get(paneId)?.some((e) => e.key === key) ?? false;
  },

  removePaneStack: (paneId) => {
    const { stacks } = get();
    if (!stacks.has(paneId)) return;
    const next = new Map(stacks);
    next.delete(paneId);
    set({ stacks: next });
  },
}));
