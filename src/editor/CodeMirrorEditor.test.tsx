import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { useRef } from "react";
import { CodeMirrorEditor } from "./CodeMirrorEditor";
import { EditorView } from "@codemirror/view";

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

  it("onViewChange is not called with null before being called with a view", () => {
    const spy = vi.fn();
    render(<CodeMirrorEditor doc="test" onViewChange={spy} />);
    expect(spy).toHaveBeenCalled();
    const firstCall = spy.mock.calls[0]!;
    expect(firstCall[0]).not.toBeNull();
    expect(firstCall[0]).toBeInstanceOf(EditorView);
  });

  it("onViewChange(null) is called on unmount after view was established", () => {
    const spy = vi.fn();
    const { unmount } = render(<CodeMirrorEditor doc="test" onViewChange={spy} />);
    expect(spy).toHaveBeenCalledWith(expect.any(Object));
    spy.mockClear();
    unmount();
    expect(spy).toHaveBeenCalledWith(null);
  });

});
