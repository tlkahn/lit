import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { mockInvoke, resetInvokeMock } from "../test/tauri-mock";
import { _resetForTesting as resetSharedCodeDocs, getPaneIds } from "../lib/sharedCodeDocs";
import { useWorkspaceStore } from "../stores/workspace";
import {
  setCurrentEditorView,
  _resetForTesting as resetEditorViewRef,
} from "../lib/editorViewRef";
import type { EditorView } from "@codemirror/view";
import { useCodeFileContent } from "./useCodeFileContent";

const mockCodeFile = {
  title: "refs",
  relative_path: "refs.bib",
  body: "@article{key, title = {Hi}}",
};

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  resetSharedCodeDocs();
  resetInvokeMock();
  useWorkspaceStore.setState({ isDirty: false, reloadTrigger: 0, viewStates: {} });
  mockInvoke((cmd) => {
    if (cmd === "read_code_file") return mockCodeFile;
    if (cmd === "write_code_file") return null;
    if (cmd === "acknowledge_file_hash") return null;
    return null;
  });
});

afterEach(() => {
  vi.useRealTimers();
  resetEditorViewRef();
});

describe("useCodeFileContent", () => {
  it("returns empty state and does not call readCodeFile when pagePath is null", () => {
    const { result } = renderHook(() => useCodeFileContent("p1", null));
    expect(result.current.body).toBe("");
    expect(result.current.isDirty).toBe(false);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("reads the code file on mount and resolves body", async () => {
    const { result } = renderHook(() => useCodeFileContent("p1", "refs.bib"));
    await waitFor(() => {
      expect(result.current.body).toBe("@article{key, title = {Hi}}");
    });
    expect(invoke).toHaveBeenCalledWith("read_code_file", { relativePath: "refs.bib" });
  });

  it("handleChange updates body, sets dirty, and routes to writeCodeFile after debounce", async () => {
    const { result } = renderHook(() => useCodeFileContent("p1", "refs.bib"));
    await waitFor(() => {
      expect(result.current.body).toBe("@article{key, title = {Hi}}");
    });

    act(() => {
      result.current.handleChange("edited");
    });
    expect(result.current.body).toBe("edited");
    expect(result.current.isDirty).toBe(true);

    await act(async () => {
      vi.advanceTimersByTime(300);
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(invoke).toHaveBeenCalledWith("write_code_file", {
      relativePath: "refs.bib",
      body: "edited",
    });
  });

  it("never calls the markdown read_page/write_page commands", async () => {
    const { result } = renderHook(() => useCodeFileContent("p1", "refs.bib"));
    await waitFor(() => {
      expect(result.current.body).toBe("@article{key, title = {Hi}}");
    });
    act(() => {
      result.current.handleChange("edited");
    });
    await act(async () => {
      vi.advanceTimersByTime(300);
      await vi.advanceTimersByTimeAsync(0);
    });
    const cmds = vi.mocked(invoke).mock.calls.map((c) => c[0]);
    expect(cmds).not.toContain("read_page");
    expect(cmds).not.toContain("write_page");
  });

  it("does not write to workspace viewStates when a clean code file is reloaded", async () => {
    const { result } = renderHook(() => useCodeFileContent("p1", "refs.bib"));
    await waitFor(() => {
      expect(result.current.body).toBe("@article{key, title = {Hi}}");
    });

    useWorkspaceStore.setState({ isDirty: false, viewStates: {} });

    // Register a stub editor view so that any view-state capture during reload
    // would actually run (and populate viewStates) if the dead code existed.
    setCurrentEditorView({
      scrollDOM: { scrollTop: 42 },
      state: { selection: { main: { head: 7 } } },
    } as unknown as EditorView);

    act(() => {
      useWorkspaceStore.setState({ reloadTrigger: 1 });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(useWorkspaceStore.getState().viewStates).toEqual({});
    expect(result.current.body).toBe("@article{key, title = {Hi}}");
  });

  it("releases the shared doc on unmount", async () => {
    const { result, unmount } = renderHook(() => useCodeFileContent("p1", "refs.bib"));
    await waitFor(() => {
      expect(result.current.body).toBe("@article{key, title = {Hi}}");
    });
    expect(getPaneIds("refs.bib")).toEqual(["p1"]);
    unmount();
    expect(getPaneIds("refs.bib")).toEqual([]);
  });
});
