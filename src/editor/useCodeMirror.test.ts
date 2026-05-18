import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { EditorView } from "@codemirror/view";
import { openSearchPanel, closeSearchPanel } from "@codemirror/search";
import { useCodeMirror } from "./useCodeMirror";
import { usePreferencesStore } from "../stores/preferences";
import { useModalLockStore } from "../stores/modalLock";
import { mediaThumbnailsFacet } from "./livePreview";

function makeContainer() {
  const div = document.createElement("div");
  document.body.appendChild(div);
  return {
    ref: { current: div },
    cleanup: () => div.remove(),
  };
}

describe("useCodeMirror", () => {
  let container: ReturnType<typeof makeContainer>;

  beforeEach(() => {
    container = makeContainer();
  });

  afterEach(() => {
    container.cleanup();
  });

  it("creates EditorView on mount", () => {
    const { result } = renderHook(() =>
      useCodeMirror({
        containerRef: container.ref,
        doc: "hello",
      }),
    );
    const cmEditor = container.ref.current.querySelector(".cm-editor");
    expect(cmEditor).not.toBeNull();
    expect(result.current.view).toBeDefined();
  });

  it("destroys EditorView on unmount", () => {
    const { unmount } = renderHook(() =>
      useCodeMirror({
        containerRef: container.ref,
        doc: "hello",
      }),
    );
    const cmEditor = container.ref.current.querySelector(".cm-editor");
    expect(cmEditor).not.toBeNull();
    unmount();
    expect(container.ref.current.querySelector(".cm-editor")).toBeNull();
  });

  it("sets initial document content", () => {
    renderHook(() =>
      useCodeMirror({
        containerRef: container.ref,
        doc: "initial content",
      }),
    );
    const text = container.ref.current.querySelector(".cm-content")?.textContent;
    expect(text).toContain("initial content");
  });

  it("replaces document when doc prop changes externally", () => {
    const { rerender } = renderHook(
      ({ doc }) =>
        useCodeMirror({
          containerRef: container.ref,
          doc,
        }),
      { initialProps: { doc: "first" } },
    );

    rerender({ doc: "second" });
    const text = container.ref.current.querySelector(".cm-content")?.textContent;
    expect(text).toContain("second");
  });

  it("does NOT replace when content already matches", () => {
    const { result, rerender } = renderHook(
      ({ doc }) =>
        useCodeMirror({
          containerRef: container.ref,
          doc,
        }),
      { initialProps: { doc: "same" } },
    );

    const view = result.current.view!;
    const dispatchSpy = vi.spyOn(view, "dispatch");

    rerender({ doc: "same" });
    expect(dispatchSpy).not.toHaveBeenCalled();
  });

  it("calls onChange on user edit", () => {
    const onChange = vi.fn();
    const { result } = renderHook(() =>
      useCodeMirror({
        containerRef: container.ref,
        doc: "",
        onChange,
      }),
    );

    act(() => {
      result.current.view!.dispatch({
        changes: { from: 0, insert: "typed" },
      });
    });
    expect(onChange).toHaveBeenCalledWith("typed");
  });

  it("does NOT call onChange for external doc replacement", () => {
    const onChange = vi.fn();
    const { rerender } = renderHook(
      ({ doc }) =>
        useCodeMirror({
          containerRef: container.ref,
          doc,
          onChange,
        }),
      { initialProps: { doc: "first" } },
    );

    onChange.mockClear();
    rerender({ doc: "external update" });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("calls onDocReplaced after external doc replacement", () => {
    const onDocReplaced = vi.fn();
    const { rerender } = renderHook(
      ({ doc }) =>
        useCodeMirror({
          containerRef: container.ref,
          doc,
          onDocReplaced,
        }),
      { initialProps: { doc: "first" } },
    );

    onDocReplaced.mockClear();
    rerender({ doc: "second" });
    expect(onDocReplaced).toHaveBeenCalledTimes(1);
  });

  it("does NOT call onDocReplaced when content already matches", () => {
    const onDocReplaced = vi.fn();
    const { rerender } = renderHook(
      ({ doc }) =>
        useCodeMirror({
          containerRef: container.ref,
          doc,
          onDocReplaced,
        }),
      { initialProps: { doc: "same" } },
    );

    onDocReplaced.mockClear();
    rerender({ doc: "same" });
    expect(onDocReplaced).not.toHaveBeenCalled();
  });

  it("works without onDocReplaced (no regression)", () => {
    const { rerender } = renderHook(
      ({ doc }) =>
        useCodeMirror({
          containerRef: container.ref,
          doc,
        }),
      { initialProps: { doc: "first" } },
    );

    expect(() => rerender({ doc: "second" })).not.toThrow();
  });

  it("search panel opens and closes via useCodeMirror", () => {
    const { result } = renderHook(() =>
      useCodeMirror({
        containerRef: container.ref,
        doc: "hello world",
      }),
    );
    const view = result.current.view!;

    act(() => { openSearchPanel(view); });
    expect(container.ref.current.querySelector(".cm-search")).not.toBeNull();

    act(() => { closeSearchPanel(view); });
    expect(container.ref.current.querySelector(".cm-search")).toBeNull();
  });

  it("reconfigures mediaThumbnails compartment when preference changes", () => {
    const { result } = renderHook(() =>
      useCodeMirror({
        containerRef: container.ref,
        doc: "hello",
      }),
    );
    const view = result.current.view!;
    expect(view.state.facet(mediaThumbnailsFacet)).toBe(true);

    act(() => {
      usePreferencesStore.setState({ mediaThumbnails: false });
    });

    expect(view.state.facet(mediaThumbnailsFacet)).toBe(false);
  });

  it("editor becomes non-editable when modalLock store is locked", () => {
    useModalLockStore.setState({ openCount: 0, locked: false });
    const { result } = renderHook(() =>
      useCodeMirror({
        containerRef: container.ref,
        doc: "hello",
      }),
    );
    const view = result.current.view!;
    expect(view.state.facet(EditorView.editable)).toBe(true);

    act(() => {
      useModalLockStore.getState().increment();
    });
    expect(view.state.facet(EditorView.editable)).toBe(false);
  });

  it("editor becomes editable again when modalLock store unlocks", () => {
    useModalLockStore.setState({ openCount: 1, locked: true });
    const { result } = renderHook(() =>
      useCodeMirror({
        containerRef: container.ref,
        doc: "hello",
      }),
    );
    const view = result.current.view!;
    expect(view.state.facet(EditorView.editable)).toBe(false);

    act(() => {
      useModalLockStore.getState().decrement();
    });
    expect(view.state.facet(EditorView.editable)).toBe(true);
  });

  describe("cursor preservation on doc prop change", () => {
    it("preserves cursor position when doc prop changes", () => {
      const { result, rerender } = renderHook(
        ({ doc }) =>
          useCodeMirror({
            containerRef: container.ref,
            doc,
          }),
        { initialProps: { doc: "hello world" } },
      );

      const view = result.current.view!;
      act(() => {
        view.dispatch({ selection: { anchor: 5, head: 5 } });
      });
      expect(view.state.selection.main.head).toBe(5);

      rerender({ doc: "hello brave world" });
      expect(view.state.selection.main.head).toBe(5);
    });

    it("clamps cursor to new doc length when doc shrinks", () => {
      const { result, rerender } = renderHook(
        ({ doc }) =>
          useCodeMirror({
            containerRef: container.ref,
            doc,
          }),
        { initialProps: { doc: "hello world" } },
      );

      const view = result.current.view!;
      act(() => {
        view.dispatch({ selection: { anchor: 10, head: 10 } });
      });
      expect(view.state.selection.main.head).toBe(10);

      rerender({ doc: "short" });
      expect(view.state.selection.main.head).toBe(5);
    });

    it("preserves cursor at position 0", () => {
      const { result, rerender } = renderHook(
        ({ doc }) =>
          useCodeMirror({
            containerRef: container.ref,
            doc,
          }),
        { initialProps: { doc: "hello world" } },
      );

      const view = result.current.view!;
      expect(view.state.selection.main.head).toBe(0);

      rerender({ doc: "different content" });
      expect(view.state.selection.main.head).toBe(0);
    });
  });

  it("reconfigures theme when dark class changes on document element", () => {
    renderHook(() =>
      useCodeMirror({
        containerRef: container.ref,
        doc: "hello",
      }),
    );

    const cmEditor = container.ref.current.querySelector(".cm-editor")!;
    expect(cmEditor).not.toBeNull();

    act(() => {
      document.documentElement.classList.add("dark");
    });
    expect(cmEditor).toBeInTheDocument();

    act(() => {
      document.documentElement.classList.remove("dark");
    });
    expect(cmEditor).toBeInTheDocument();
  });
});
