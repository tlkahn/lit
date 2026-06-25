import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { usePaneStore } from "../stores/panes";
import * as editorViewRef from "../lib/editorViewRef";

import { usePaneFocus } from "./usePaneFocus";

beforeEach(() => {
  editorViewRef._resetForTesting();
  usePaneStore.setState({
    root: { type: "leaf", id: "test-pane", pagePath: null },
    focusedPaneId: "test-pane",
  });
});

describe("usePaneFocus", () => {
  it("calls focusPane and setFocusedPane with the given paneId", () => {
    // Ensure the pane under test is NOT already focused so the guard doesn't skip
    usePaneStore.setState({ focusedPaneId: "other" });

    const spy = vi.spyOn(editorViewRef, "setFocusedPane");
    const focusPaneSpy = vi.spyOn(usePaneStore.getState(), "focusPane");

    const { result } = renderHook(() => usePaneFocus("test-pane"));
    result.current();

    expect(spy).toHaveBeenCalledWith("test-pane");
    expect(focusPaneSpy).toHaveBeenCalledWith("test-pane");

    spy.mockRestore();
    focusPaneSpy.mockRestore();
  });

  it("does NOT call focusPane or setFocusedPane when pane is already focused", () => {
    // beforeEach sets focusedPaneId to "test-pane", so calling with "test-pane" should be a no-op
    const spy = vi.spyOn(editorViewRef, "setFocusedPane");
    const focusPaneSpy = vi.spyOn(usePaneStore.getState(), "focusPane");

    const { result } = renderHook(() => usePaneFocus("test-pane"));
    result.current();

    expect(focusPaneSpy).not.toHaveBeenCalled();
    expect(spy).not.toHaveBeenCalled();

    spy.mockRestore();
    focusPaneSpy.mockRestore();
  });

  it("calls focusPane and setFocusedPane when pane is NOT the focused pane", () => {
    usePaneStore.setState({
      root: {
        type: "split",
        id: "s1",
        direction: "horizontal",
        children: [
          { type: "leaf", id: "pane-x", pagePath: null },
          { type: "leaf", id: "pane-y", pagePath: null },
        ],
        sizes: [50, 50],
      },
      focusedPaneId: "pane-x",
    });

    const spy = vi.spyOn(editorViewRef, "setFocusedPane");
    const focusPaneSpy = vi.spyOn(usePaneStore.getState(), "focusPane");

    const { result } = renderHook(() => usePaneFocus("pane-y"));
    result.current();

    expect(focusPaneSpy).toHaveBeenCalledWith("pane-y");
    expect(spy).toHaveBeenCalledWith("pane-y");

    spy.mockRestore();
    focusPaneSpy.mockRestore();
  });

  it("returned handler is referentially stable across rerenders with same paneId", () => {
    const { result, rerender } = renderHook(
      ({ paneId }) => usePaneFocus(paneId),
      { initialProps: { paneId: "test-pane" } },
    );
    const first = result.current;
    rerender({ paneId: "test-pane" });
    expect(result.current).toBe(first);
  });

  it("returns a new handler when paneId changes", () => {
    // Set up store so both pane ids are valid leaves
    usePaneStore.setState({
      root: {
        type: "split",
        id: "s1",
        direction: "horizontal",
        children: [
          { type: "leaf", id: "pane-a", pagePath: null },
          { type: "leaf", id: "pane-b", pagePath: null },
        ],
        sizes: [50, 50],
      },
      focusedPaneId: "pane-a",
    });

    const spy = vi.spyOn(editorViewRef, "setFocusedPane");
    const { result, rerender } = renderHook(
      ({ paneId }) => usePaneFocus(paneId),
      { initialProps: { paneId: "pane-a" } },
    );
    const first = result.current;
    rerender({ paneId: "pane-b" });
    expect(result.current).not.toBe(first);

    // Invoke the new handler and verify it uses the new paneId
    result.current();
    expect(spy).toHaveBeenCalledWith("pane-b");
    expect(usePaneStore.getState().focusedPaneId).toBe("pane-b");

    spy.mockRestore();
  });
});
