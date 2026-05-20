import { create } from "zustand";

export interface ModalLockState {
  openCount: number;
  locked: boolean;
  llmLocked: boolean;
  increment: () => void;
  decrement: () => void;
  setLlmLocked: (v: boolean) => void;
}

export const useModalLockStore = create<ModalLockState>((set) => ({
  openCount: 0,
  locked: false,
  llmLocked: false,
  increment: () =>
    set((s) => {
      const openCount = s.openCount + 1;
      return { openCount, locked: openCount > 0 };
    }),
  decrement: () =>
    set((s) => {
      const openCount = Math.max(0, s.openCount - 1);
      return { openCount, locked: openCount > 0 };
    }),
  setLlmLocked: (v) => set({ llmLocked: v }),
}));
