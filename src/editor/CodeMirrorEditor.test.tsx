import { describe, it, expect, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { useRef } from "react";
import { CodeMirrorEditor } from "./CodeMirrorEditor";
import type { EditorView } from "@codemirror/view";

describe("CodeMirrorEditor", () => {
  it("renders container with data-testid='editor'", () => {
    render(<CodeMirrorEditor doc="" />);
    expect(screen.getByTestId("editor")).toBeInTheDocument();
  });

  it("has .cm-editor element inside", () => {
    render(<CodeMirrorEditor doc="" />);
    const container = screen.getByTestId("editor");
    expect(container.querySelector(".cm-editor")).not.toBeNull();
  });

  it("displays document content", () => {
    render(<CodeMirrorEditor doc="hello world" />);
    const container = screen.getByTestId("editor");
    expect(container.textContent).toContain("hello world");
  });

  it("has flex-1 layout class", () => {
    render(<CodeMirrorEditor doc="" />);
    const container = screen.getByTestId("editor");
    expect(container.className).toContain("flex-1");
  });

  it("dispatching lit:scroll-to-line does not throw", () => {
    render(<CodeMirrorEditor doc="line one\nline two\nline three" />);
    expect(() => {
      act(() => {
        window.dispatchEvent(
          new CustomEvent("lit:scroll-to-line", { detail: { line: 1 } }),
        );
      });
    }).not.toThrow();
  });

  it("cleans up scroll-to-line listener on unmount", () => {
    const { unmount } = render(<CodeMirrorEditor doc="hello" />);
    unmount();
    expect(() => {
      window.dispatchEvent(
        new CustomEvent("lit:scroll-to-line", { detail: { line: 0 } }),
      );
    }).not.toThrow();
  });

  it("viewRef is populated with EditorView", () => {
    let capturedRef: React.RefObject<EditorView | null> = { current: null };
    function Wrapper() {
      const ref = useRef<EditorView | null>(null);
      capturedRef = ref;
      return <CodeMirrorEditor doc="test" viewRef={ref} />;
    }
    render(<Wrapper />);
    expect(capturedRef.current).not.toBeNull();
    expect(capturedRef.current!.scrollDOM).toBeDefined();
  });

  it("works without viewRef (no regression)", () => {
    render(<CodeMirrorEditor doc="test" />);
    expect(screen.getByTestId("editor")).toBeInTheDocument();
  });

  it("calls onDocReplaced when doc prop changes", () => {
    const fn = vi.fn();
    const { rerender } = render(<CodeMirrorEditor doc="first" onDocReplaced={fn} />);
    fn.mockClear();
    rerender(<CodeMirrorEditor doc="second" onDocReplaced={fn} />);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
