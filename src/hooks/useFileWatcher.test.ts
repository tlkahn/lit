import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useFileWatcher } from "./useFileWatcher";
import { mockListen, emitMockEvent } from "../test/tauri-mock";
import { useWorkspaceStore } from "../stores/workspace";
import { useModalLockStore } from "../stores/modalLock";

beforeEach(() => {
  useWorkspaceStore.setState({
    workspacePath: null,
    pages: [],
    currentPagePath: null,
    currentPageHeadings: [],
    isDirty: false,
    reloadTrigger: 0,
    loading: false,
    error: null,
  });
  useModalLockStore.setState({ openCount: 0, locked: false });
});

describe("useFileWatcher", () => {
  it("calls callback when file-modified matches current page", async () => {
    mockListen();
    useWorkspaceStore.setState({
      workspacePath: "/test",
      currentPagePath: "note.md",
    });

    const callback = vi.fn();
    renderHook(() => useFileWatcher(callback));

    emitMockEvent("workspace://file-modified", { path: "note.md" });

    expect(callback).toHaveBeenCalledOnce();
  });

  it("ignores file-modified for different page", async () => {
    mockListen();
    useWorkspaceStore.setState({
      workspacePath: "/test",
      currentPagePath: "note.md",
    });

    const callback = vi.fn();
    renderHook(() => useFileWatcher(callback));

    emitMockEvent("workspace://file-modified", { path: "other.md" });

    expect(callback).not.toHaveBeenCalled();
  });

  it("ignores events when no workspace open", async () => {
    mockListen();

    const callback = vi.fn();
    renderHook(() => useFileWatcher(callback));

    emitMockEvent("workspace://file-modified", { path: "note.md" });

    expect(callback).not.toHaveBeenCalled();
  });

  it("defers file-modified callback when modalLock is locked", () => {
    mockListen();
    useWorkspaceStore.setState({
      workspacePath: "/test",
      currentPagePath: "note.md",
    });
    useModalLockStore.setState({ openCount: 1, locked: true });

    const callback = vi.fn();
    renderHook(() => useFileWatcher(callback));

    emitMockEvent("workspace://file-modified", { path: "note.md" });

    expect(callback).not.toHaveBeenCalled();
  });

  it("replays deferred callback when modalLock unlocks", () => {
    mockListen();
    useWorkspaceStore.setState({
      workspacePath: "/test",
      currentPagePath: "note.md",
    });
    useModalLockStore.setState({ openCount: 1, locked: true });

    const callback = vi.fn();
    renderHook(() => useFileWatcher(callback));

    emitMockEvent("workspace://file-modified", { path: "note.md" });
    expect(callback).not.toHaveBeenCalled();

    act(() => {
      useModalLockStore.getState().decrement();
    });

    expect(callback).toHaveBeenCalledOnce();
  });

  it("does not defer when unlocked (existing behavior)", () => {
    mockListen();
    useWorkspaceStore.setState({
      workspacePath: "/test",
      currentPagePath: "note.md",
    });
    useModalLockStore.setState({ openCount: 0, locked: false });

    const callback = vi.fn();
    renderHook(() => useFileWatcher(callback));

    emitMockEvent("workspace://file-modified", { path: "note.md" });

    expect(callback).toHaveBeenCalledOnce();
  });

  it("file-deleted for current page deselects it", async () => {
    mockListen();
    useWorkspaceStore.setState({
      workspacePath: "/test",
      currentPagePath: "note.md",
    });

    renderHook(() => useFileWatcher());
    await act(async () => {});

    emitMockEvent("workspace://file-deleted", { path: "note.md" });

    expect(useWorkspaceStore.getState().currentPagePath).toBeNull();
  });

  it("file-deleted for different page does not deselect current page", async () => {
    mockListen();
    useWorkspaceStore.setState({
      workspacePath: "/test",
      currentPagePath: "Merged.md",
    });

    renderHook(() => useFileWatcher());
    await act(async () => {});

    emitMockEvent("workspace://file-deleted", { path: "A.md" });

    expect(useWorkspaceStore.getState().currentPagePath).toBe("Merged.md");
  });

  it("file-deleted calls refreshPages", async () => {
    mockListen();
    const refreshPages = vi.fn();
    useWorkspaceStore.setState({
      workspacePath: "/test",
      currentPagePath: null,
      refreshPages,
    });

    renderHook(() => useFileWatcher());
    await act(async () => {});

    emitMockEvent("workspace://file-deleted", { path: "A.md" });

    expect(refreshPages).toHaveBeenCalled();
  });

  it("file-modified does not fire callback when store was updated between renders", () => {
    mockListen();
    useWorkspaceStore.setState({
      workspacePath: "/test",
      currentPagePath: "A.md",
    });

    const callback = vi.fn();
    renderHook(() => useFileWatcher(callback));

    // Simulate: selectPage("Merged.md") ran but React hasn't re-rendered yet,
    // so the ref still holds "A.md" while the store already has "Merged.md".
    useWorkspaceStore.setState({ currentPagePath: "Merged.md" });

    emitMockEvent("workspace://file-modified", { path: "A.md" });

    expect(callback).not.toHaveBeenCalled();
  });

  it("file-deleted does not deselect when store was updated between renders", async () => {
    mockListen();
    useWorkspaceStore.setState({
      workspacePath: "/test",
      currentPagePath: "A.md",
    });

    renderHook(() => useFileWatcher());
    await act(async () => {});

    // Simulate: selectPage("Merged.md") ran but React hasn't re-rendered yet,
    // so the ref still holds "A.md" while the store already has "Merged.md".
    useWorkspaceStore.setState({ currentPagePath: "Merged.md" });

    emitMockEvent("workspace://file-deleted", { path: "A.md" });

    expect(useWorkspaceStore.getState().currentPagePath).toBe("Merged.md");
  });
});
