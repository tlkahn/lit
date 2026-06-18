import { create } from "zustand";

export interface UndoEntry {
  description: string;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
  /** @internal Used by coalescing logic in pushUndo helper */
  __coalesceKey?: string;
}

const MAX_UNDO_STACK = 50;

interface CardboxUndoStore {
  undoStack: UndoEntry[];
  redoStack: UndoEntry[];
  replayDepth: number;
  pushUndo: (entry: UndoEntry) => void;
  replaceTop: (entry: UndoEntry) => void;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
  clear: () => void;
}

export const useCardboxUndoStore = create<CardboxUndoStore>((set, get) => ({
  undoStack: [],
  redoStack: [],
  replayDepth: 0,

  pushUndo: (entry) => {
    set((s) => {
      const stack = [...s.undoStack, entry];
      if (stack.length > MAX_UNDO_STACK) {
        stack.shift();
      }
      return { undoStack: stack, redoStack: [] };
    });
  },

  replaceTop: (entry) => {
    set((s) => {
      if (s.undoStack.length === 0) return s;
      const stack = [...s.undoStack];
      stack[stack.length - 1] = entry;
      return { undoStack: stack };
    });
  },

  undo: async () => {
    const { undoStack } = get();
    if (undoStack.length === 0) return;
    const entry = undoStack[undoStack.length - 1]!;
    set((s) => ({
      undoStack: s.undoStack.slice(0, -1),
      replayDepth: s.replayDepth + 1,
    }));
    try {
      await entry.undo();
    } catch {
      // Silently ignore -- consistent with IPC error handling in cardbox store
    } finally {
      set((s) => ({
        replayDepth: s.replayDepth - 1,
        redoStack: [...s.redoStack, entry],
      }));
    }
  },

  redo: async () => {
    const { redoStack } = get();
    if (redoStack.length === 0) return;
    const entry = redoStack[redoStack.length - 1]!;
    set((s) => ({
      redoStack: s.redoStack.slice(0, -1),
      replayDepth: s.replayDepth + 1,
    }));
    try {
      await entry.redo();
    } catch {
      // Silently ignore
    } finally {
      set((s) => ({
        replayDepth: s.replayDepth - 1,
        undoStack: [...s.undoStack, entry],
      }));
    }
  },

  clear: () => {
    set({ undoStack: [], redoStack: [] });
  },
}));
