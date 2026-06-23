import { create } from "zustand";

export interface RefNavEntry {
  key: string;
  title: string;
}

export interface RefNavStackStore {
  stack: RefNavEntry[];
  push(key: string, title: string): void;
  pop(): RefNavEntry | null;
  reset(): void;
  current(): RefNavEntry | null;
  depth(): number;
  isOnStack(key: string): boolean;
}

const EMPTY: RefNavEntry[] = [];

export const useRefNavStackStore = create<RefNavStackStore>((set, get) => ({
  stack: EMPTY,

  push: (key, title) => {
    const { stack } = get();
    if (stack.some((e) => e.key === key)) return;
    set({ stack: [...stack, { key, title }] });
  },

  pop: () => {
    const { stack } = get();
    if (stack.length === 0) return null;
    const top = stack[stack.length - 1]!;
    set({ stack: stack.slice(0, -1) });
    return top;
  },

  reset: () => {
    const { stack } = get();
    if (stack.length === 0) return;
    set({ stack: EMPTY });
  },

  current: () => {
    const { stack } = get();
    return stack.length > 0 ? stack[stack.length - 1]! : null;
  },

  depth: () => get().stack.length,

  isOnStack: (key) => get().stack.some((e) => e.key === key),
}));
