import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useCodeMirror } from "./useCodeMirror";

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
