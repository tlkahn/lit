import { create } from "zustand";

export interface CursorInfo {
  line: number;
  col: number;
}

export const useCursorInfoStore = create<
  CursorInfo & { setCursorInfo: (line: number, col: number) => void }
>((set) => ({
  line: 0,
  col: 0,
  setCursorInfo: (line, col) => set({ line, col }),
}));
