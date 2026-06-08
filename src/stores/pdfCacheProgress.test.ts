import { describe, it, expect, beforeEach } from "vitest";
import { usePdfCacheProgressStore } from "./pdfCacheProgress";

describe("usePdfCacheProgressStore", () => {
  beforeEach(() => {
    usePdfCacheProgressStore.setState({ progress: new Map() });
  });

  it("initial progress state is an empty Map", () => {
    const { progress } = usePdfCacheProgressStore.getState();
    expect(progress).toBeInstanceOf(Map);
    expect(progress.size).toBe(0);
  });

  it("update stores a retrievable {current,total,done} entry", () => {
    usePdfCacheProgressStore.getState().update("win:pane-1", 5, 20, false);
    expect(usePdfCacheProgressStore.getState().progress.get("win:pane-1")).toEqual({
      current: 5,
      total: 20,
      done: false,
    });
  });

  it("update overwrites an existing slot and produces a new Map reference", () => {
    usePdfCacheProgressStore.getState().update("win:pane-1", 5, 20, false);
    const before = usePdfCacheProgressStore.getState().progress;
    usePdfCacheProgressStore.getState().update("win:pane-1", 20, 20, true);
    const after = usePdfCacheProgressStore.getState().progress;
    expect(after).not.toBe(before);
    expect(after.get("win:pane-1")).toEqual({ current: 20, total: 20, done: true });
  });

  it("update is independent per slot", () => {
    usePdfCacheProgressStore.getState().update("win:pane-1", 5, 20, false);
    usePdfCacheProgressStore.getState().update("win:pane-2", 1, 8, false);
    const { progress } = usePdfCacheProgressStore.getState();
    expect(progress.get("win:pane-1")).toEqual({ current: 5, total: 20, done: false });
    expect(progress.get("win:pane-2")).toEqual({ current: 1, total: 8, done: false });
  });

  it("clear removes only that slot's entry", () => {
    usePdfCacheProgressStore.getState().update("win:pane-1", 5, 20, false);
    usePdfCacheProgressStore.getState().update("win:pane-2", 1, 8, false);
    usePdfCacheProgressStore.getState().clear("win:pane-1");
    const { progress } = usePdfCacheProgressStore.getState();
    expect(progress.has("win:pane-1")).toBe(false);
    expect(progress.get("win:pane-2")).toEqual({ current: 1, total: 8, done: false });
  });

  it("clear is a safe no-op when the slot is absent", () => {
    const before = usePdfCacheProgressStore.getState().progress;
    expect(() => usePdfCacheProgressStore.getState().clear("missing")).not.toThrow();
    // No mutation -> same Map reference (avoids spurious re-render).
    expect(usePdfCacheProgressStore.getState().progress).toBe(before);
  });
});
