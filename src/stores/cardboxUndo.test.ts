import { describe, it, expect, beforeEach, vi } from "vitest";
import { useCardboxUndoStore } from "./cardboxUndo";
import type { UndoEntry } from "./cardboxUndo";

describe("cardboxUndo store", () => {
  beforeEach(() => {
    useCardboxUndoStore.setState({
      undoStack: [],
      redoStack: [],
      isReplaying: false,
    });
  });

  function makeEntry(label: string, opts?: Partial<UndoEntry>): UndoEntry {
    return {
      description: label,
      undo: opts?.undo ?? vi.fn(async () => {}),
      redo: opts?.redo ?? vi.fn(async () => {}),
    };
  }

  it("pushUndo adds to undoStack and clears redoStack", () => {
    const store = useCardboxUndoStore.getState();
    store.pushUndo(makeEntry("A"));
    expect(useCardboxUndoStore.getState().undoStack).toHaveLength(1);
    expect(useCardboxUndoStore.getState().undoStack[0]!.description).toBe("A");

    // Manually put something in redo to verify it gets cleared
    useCardboxUndoStore.setState({ redoStack: [makeEntry("B")] });
    store.pushUndo(makeEntry("C"));
    expect(useCardboxUndoStore.getState().undoStack).toHaveLength(2);
    expect(useCardboxUndoStore.getState().redoStack).toEqual([]);
  });

  it("undo pops from undoStack, calls entry.undo(), pushes to redoStack", async () => {
    const undoFn = vi.fn(async () => {});
    const entry = makeEntry("A", { undo: undoFn });
    useCardboxUndoStore.getState().pushUndo(entry);

    await useCardboxUndoStore.getState().undo();

    expect(undoFn).toHaveBeenCalledOnce();
    expect(useCardboxUndoStore.getState().undoStack).toHaveLength(0);
    expect(useCardboxUndoStore.getState().redoStack).toHaveLength(1);
    expect(useCardboxUndoStore.getState().redoStack[0]!.description).toBe("A");
  });

  it("redo pops from redoStack, calls entry.redo(), pushes to undoStack", async () => {
    const redoFn = vi.fn(async () => {});
    const entry = makeEntry("A", { redo: redoFn });
    useCardboxUndoStore.getState().pushUndo(entry);
    await useCardboxUndoStore.getState().undo();

    await useCardboxUndoStore.getState().redo();

    expect(redoFn).toHaveBeenCalledOnce();
    expect(useCardboxUndoStore.getState().redoStack).toHaveLength(0);
    expect(useCardboxUndoStore.getState().undoStack).toHaveLength(1);
    expect(useCardboxUndoStore.getState().undoStack[0]!.description).toBe("A");
  });

  it("undo on empty stack is no-op", async () => {
    await useCardboxUndoStore.getState().undo();
    const s = useCardboxUndoStore.getState();
    expect(s.undoStack).toHaveLength(0);
    expect(s.redoStack).toHaveLength(0);
  });

  it("redo on empty stack is no-op", async () => {
    await useCardboxUndoStore.getState().redo();
    const s = useCardboxUndoStore.getState();
    expect(s.undoStack).toHaveLength(0);
    expect(s.redoStack).toHaveLength(0);
  });

  it("stack is capped at 50 entries (oldest dropped)", () => {
    const store = useCardboxUndoStore.getState();
    for (let i = 0; i < 51; i++) {
      store.pushUndo(makeEntry(`entry-${i}`));
    }
    const s = useCardboxUndoStore.getState();
    expect(s.undoStack).toHaveLength(50);
    // oldest (entry-0) should be gone, entry-1 should be first
    expect(s.undoStack[0]!.description).toBe("entry-1");
    expect(s.undoStack[49]!.description).toBe("entry-50");
  });

  it("isReplaying is true during undo execution, false after", async () => {
    let replayingDuringUndo = false;
    const entry = makeEntry("A", {
      undo: async () => {
        replayingDuringUndo = useCardboxUndoStore.getState().isReplaying;
      },
    });
    useCardboxUndoStore.getState().pushUndo(entry);
    await useCardboxUndoStore.getState().undo();
    expect(replayingDuringUndo).toBe(true);
    expect(useCardboxUndoStore.getState().isReplaying).toBe(false);
  });

  it("isReplaying is true during redo execution, false after", async () => {
    let replayingDuringRedo = false;
    const entry = makeEntry("A", {
      redo: async () => {
        replayingDuringRedo = useCardboxUndoStore.getState().isReplaying;
      },
    });
    useCardboxUndoStore.getState().pushUndo(entry);
    await useCardboxUndoStore.getState().undo();
    await useCardboxUndoStore.getState().redo();
    expect(replayingDuringRedo).toBe(true);
    expect(useCardboxUndoStore.getState().isReplaying).toBe(false);
  });

  it("isReplaying resets to false even if undo throws", async () => {
    const entry = makeEntry("A", {
      undo: async () => {
        throw new Error("boom");
      },
    });
    useCardboxUndoStore.getState().pushUndo(entry);
    await useCardboxUndoStore.getState().undo();
    expect(useCardboxUndoStore.getState().isReplaying).toBe(false);
  });

  it("isReplaying resets to false even if redo throws", async () => {
    const entry = makeEntry("A", {
      redo: async () => {
        throw new Error("boom");
      },
    });
    useCardboxUndoStore.getState().pushUndo(entry);
    await useCardboxUndoStore.getState().undo();
    await useCardboxUndoStore.getState().redo();
    expect(useCardboxUndoStore.getState().isReplaying).toBe(false);
  });

  it("clear() empties both stacks", () => {
    useCardboxUndoStore.getState().pushUndo(makeEntry("A"));
    useCardboxUndoStore.getState().pushUndo(makeEntry("B"));
    useCardboxUndoStore.setState({ redoStack: [makeEntry("C")] });
    useCardboxUndoStore.getState().clear();
    const s = useCardboxUndoStore.getState();
    expect(s.undoStack).toEqual([]);
    expect(s.redoStack).toEqual([]);
  });

  it("redo cleared on new push after undo", async () => {
    useCardboxUndoStore.getState().pushUndo(makeEntry("A"));
    await useCardboxUndoStore.getState().undo();
    expect(useCardboxUndoStore.getState().redoStack).toHaveLength(1);
    useCardboxUndoStore.getState().pushUndo(makeEntry("B"));
    expect(useCardboxUndoStore.getState().redoStack).toEqual([]);
    expect(useCardboxUndoStore.getState().undoStack).toHaveLength(1);
    expect(useCardboxUndoStore.getState().undoStack[0]!.description).toBe("B");
  });

  it("replaceTop replaces the last entry on undoStack without clearing redoStack", () => {
    useCardboxUndoStore.getState().pushUndo(makeEntry("A"));
    useCardboxUndoStore.getState().pushUndo(makeEntry("B"));
    useCardboxUndoStore.setState({ redoStack: [makeEntry("C")] });
    const replacement = makeEntry("B-updated");
    useCardboxUndoStore.getState().replaceTop(replacement);
    const s = useCardboxUndoStore.getState();
    expect(s.undoStack).toHaveLength(2);
    expect(s.undoStack[1]!.description).toBe("B-updated");
    // redo preserved
    expect(s.redoStack).toHaveLength(1);
  });

  it("replaceTop no-ops on empty undoStack", () => {
    useCardboxUndoStore.getState().replaceTop(makeEntry("X"));
    expect(useCardboxUndoStore.getState().undoStack).toHaveLength(0);
  });
});
