import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { EditorView } from "@codemirror/view";
import { useCodeMirrorCode } from "./useCodeMirrorCode";
import { useModalLockStore } from "../stores/modalLock";
import { bibtex } from "./bibtex";

function makeContainer() {
  const div = document.createElement("div");
  document.body.appendChild(div);
  return {
    ref: { current: div },
    cleanup: () => div.remove(),
  };
}

describe("useCodeMirrorCode", () => {
  let container: ReturnType<typeof makeContainer>;

  beforeEach(() => {
    container = makeContainer();
    useModalLockStore.setState({ openCount: 0, locked: false, llmLocked: false });
  });

  afterEach(() => {
    container.cleanup();
    document.documentElement.classList.remove("dark");
  });

  it("mounts and returns a non-null view", () => {
    const { result } = renderHook(() =>
      useCodeMirrorCode({ containerRef: container.ref, doc: "x = 1", language: null }),
    );
    expect(result.current.view).not.toBeNull();
    expect(container.ref.current.querySelector(".cm-editor")).not.toBeNull();
  });

  it("replaces the doc prop without firing onChange", () => {
    const onChange = vi.fn();
    const { rerender } = renderHook(
      ({ doc }) =>
        useCodeMirrorCode({ containerRef: container.ref, doc, language: null, onChange }),
      { initialProps: { doc: "first" } },
    );
    onChange.mockClear();
    rerender({ doc: "second" });
    const text = container.ref.current.querySelector(".cm-content")?.textContent;
    expect(text).toContain("second");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("reconfigures language without throwing and clears it on null", () => {
    const { result, rerender } = renderHook(
      ({ language }) =>
        useCodeMirrorCode({ containerRef: container.ref, doc: "@a{k,", language }),
      { initialProps: { language: bibtex() as ReturnType<typeof bibtex> | null } },
    );
    expect(result.current.view).not.toBeNull();
    expect(() => rerender({ language: null })).not.toThrow();
    expect(result.current.view).not.toBeNull();
  });

  it("survives a dark-class toggle on the document element", () => {
    const { result } = renderHook(() =>
      useCodeMirrorCode({ containerRef: container.ref, doc: "x", language: null }),
    );
    act(() => {
      document.documentElement.classList.add("dark");
    });
    expect(result.current.view).not.toBeNull();
    act(() => {
      document.documentElement.classList.remove("dark");
    });
    expect(result.current.view).not.toBeNull();
  });

  it("becomes non-editable when modal lock is set", () => {
    const { result } = renderHook(() =>
      useCodeMirrorCode({ containerRef: container.ref, doc: "x", language: null }),
    );
    const view = result.current.view!;
    expect(view.state.facet(EditorView.editable)).toBe(true);
    act(() => {
      useModalLockStore.getState().increment();
    });
    expect(view.state.facet(EditorView.editable)).toBe(false);
  });
});
