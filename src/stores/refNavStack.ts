import { create } from "zustand";

export type NavDirection = "push" | "pop" | "none";

export interface RefNavEntry {
  key: string;
  title: string;
}

export interface RefNavStackStore {
  stacks: Map<string, RefNavEntry[]>;
  directions: Map<string, NavDirection>;
  push(paneId: string, key: string, title: string): void;
  pop(paneId: string): RefNavEntry | null;
  reset(paneId: string): void;
  current(paneId: string): RefNavEntry | null;
  depth(paneId: string): number;
  direction(paneId: string): NavDirection;
  clearDirection(paneId: string): void;
  isOnStack(paneId: string, key: string): boolean;
  removePaneStack(paneId: string): void;
}

export const useRefNavStackStore = create<RefNavStackStore>((set, get) => ({
  stacks: new Map(),
  directions: new Map(),

  push: (paneId, key, title) => {
    const { stacks, directions } = get();
    const arr = stacks.get(paneId) ?? [];
    const idx = arr.findIndex((e) => e.key === key);
    if (idx !== -1) {
      if (arr[idx]!.title === title) return;
      const updated = arr.slice();
      updated[idx] = { key, title };
      const nextStacks = new Map(stacks);
      nextStacks.set(paneId, updated);
      set({ stacks: nextStacks });
      return;
    }
    const nextStacks = new Map(stacks);
    nextStacks.set(paneId, [...arr, { key, title }]);
    const nextDirs = new Map(directions);
    nextDirs.set(paneId, "push");
    set({ stacks: nextStacks, directions: nextDirs });
  },

  pop: (paneId) => {
    const { stacks, directions } = get();
    const arr = stacks.get(paneId);
    if (!arr || arr.length === 0) return null;
    const top = arr[arr.length - 1]!;
    const nextStacks = new Map(stacks);
    nextStacks.set(paneId, arr.slice(0, -1));
    const nextDirs = new Map(directions);
    nextDirs.set(paneId, "pop");
    set({ stacks: nextStacks, directions: nextDirs });
    return top;
  },

  reset: (paneId) => {
    const { stacks, directions } = get();
    if (!stacks.has(paneId)) return;
    const nextStacks = new Map(stacks);
    nextStacks.delete(paneId);
    const nextDirs = new Map(directions);
    nextDirs.set(paneId, "none");
    set({ stacks: nextStacks, directions: nextDirs });
  },

  current: (paneId) => {
    const arr = get().stacks.get(paneId);
    return arr && arr.length > 0 ? arr[arr.length - 1]! : null;
  },

  depth: (paneId) => {
    return get().stacks.get(paneId)?.length ?? 0;
  },

  direction: (paneId) => {
    return get().directions.get(paneId) ?? "none";
  },

  clearDirection: (paneId) => {
    const { directions } = get();
    if (!directions.has(paneId) || directions.get(paneId) === "none") return;
    const nextDirs = new Map(directions);
    nextDirs.set(paneId, "none");
    set({ directions: nextDirs });
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
