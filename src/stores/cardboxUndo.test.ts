import { describe, it, expect, beforeEach, vi } from "vitest";
import { useCardboxUndoStore } from "./cardboxUndo";
import type { UndoEntry } from "./cardboxUndo";

describe("cardboxUndo store", () => {
  beforeEach(() => {
    useCardboxUndoStore.setState({
      undoStack: [],
      redoStack: [],
      replayDepth: 0,
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

  it("replayDepth > 0 during undo execution, 0 after", async () => {
    let depthDuringUndo = 0;
    const entry = makeEntry("A", {
      undo: async () => {
        depthDuringUndo = useCardboxUndoStore.getState().replayDepth;
      },
    });
    useCardboxUndoStore.getState().pushUndo(entry);
    await useCardboxUndoStore.getState().undo();
    expect(depthDuringUndo).toBeGreaterThan(0);
    expect(useCardboxUndoStore.getState().replayDepth).toBe(0);
  });

  it("replayDepth > 0 during redo execution, 0 after", async () => {
    let depthDuringRedo = 0;
    const entry = makeEntry("A", {
      redo: async () => {
        depthDuringRedo = useCardboxUndoStore.getState().replayDepth;
      },
    });
    useCardboxUndoStore.getState().pushUndo(entry);
    await useCardboxUndoStore.getState().undo();
    await useCardboxUndoStore.getState().redo();
    expect(depthDuringRedo).toBeGreaterThan(0);
    expect(useCardboxUndoStore.getState().replayDepth).toBe(0);
  });

  it("replayDepth resets to 0 even if undo throws", async () => {
    const entry = makeEntry("A", {
      undo: async () => {
        throw new Error("boom");
      },
    });
    useCardboxUndoStore.getState().pushUndo(entry);
    await useCardboxUndoStore.getState().undo();
    expect(useCardboxUndoStore.getState().replayDepth).toBe(0);
  });

  it("replayDepth resets to 0 even if redo throws", async () => {
    const entry = makeEntry("A", {
      redo: async () => {
        throw new Error("boom");
      },
    });
    useCardboxUndoStore.getState().pushUndo(entry);
    await useCardboxUndoStore.getState().undo();
    await useCardboxUndoStore.getState().redo();
    expect(useCardboxUndoStore.getState().replayDepth).toBe(0);
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

  it("concurrent undo calls keep replayDepth > 0 until both complete", async () => {
    let resolveFirst!: () => void;
    let resolveSecond!: () => void;
    const firstPromise = new Promise<void>((r) => { resolveFirst = r; });
    const secondPromise = new Promise<void>((r) => { resolveSecond = r; });

    const entryA = makeEntry("A", { undo: () => firstPromise });
    const entryB = makeEntry("B", { undo: () => secondPromise });

    useCardboxUndoStore.getState().pushUndo(entryA);
    useCardboxUndoStore.getState().pushUndo(entryB);
    expect(useCardboxUndoStore.getState().undoStack).toHaveLength(2);

    // Fire two undos concurrently (without awaiting)
    const p1 = useCardboxUndoStore.getState().undo(); // pops B
    const p2 = useCardboxUndoStore.getState().undo(); // pops A

    // Both are in-flight: replayDepth should be 2
    expect(useCardboxUndoStore.getState().replayDepth).toBe(2);

    // Resolve first undo -- replayDepth drops to 1, still > 0
    resolveFirst();
    await p2; // p2 used entryA whose undo is firstPromise
    expect(useCardboxUndoStore.getState().replayDepth).toBe(1);

    // Resolve second undo -- replayDepth drops to 0
    resolveSecond();
    await p1; // p1 used entryB whose undo is secondPromise
    expect(useCardboxUndoStore.getState().replayDepth).toBe(0);
  });
});
