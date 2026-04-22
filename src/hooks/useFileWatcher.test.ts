import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useFileWatcher } from "./useFileWatcher";
import { mockListen, emitMockEvent } from "../test/tauri-mock";
import { useWorkspaceStore } from "../stores/workspace";

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
});
