import { create } from "zustand";

export interface FocusModeState {
  active: boolean;
  toggleFocusMode: () => void;
}

export const useFocusModeStore = create<FocusModeState>((set) => ({
  active: false,
  toggleFocusMode: () => set((s) => ({ active: !s.active })),
}));
