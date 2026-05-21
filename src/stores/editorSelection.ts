import { create } from "zustand";

interface EditorSelectionState {
  from: number;
  to: number;
  setSelection: (from: number, to: number) => void;
}

export const useEditorSelectionStore = create<EditorSelectionState>((set) => ({
  from: 0,
  to: 0,
  setSelection: (from, to) => set({ from, to }),
}));
