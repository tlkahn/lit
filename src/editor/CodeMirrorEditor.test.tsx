import { describe, it, expect, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { useRef } from "react";
import { CodeMirrorEditor } from "./CodeMirrorEditor";
import { EditorView } from "@codemirror/view";
import { useWorkspaceStore } from "../stores/workspace";

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

  it("lit:scroll-to-line with cursor=true moves cursor to line start", () => {
    let capturedRef: React.RefObject<EditorView | null> = { current: null };
    function Wrapper() {
      const ref = useRef<EditorView | null>(null);
      capturedRef = ref;
      return <CodeMirrorEditor doc="line one\nline two\nline three" viewRef={ref} />;
    }
    render(<Wrapper />);
    const view = capturedRef.current!;
    expect(view).not.toBeNull();

    act(() => {
      view.dispatch({ selection: { anchor: 5 } });
    });
    expect(view.state.selection.main.head).toBe(5);

    act(() => {
      window.dispatchEvent(
        new CustomEvent("lit:scroll-to-line", { detail: { line: 0, cursor: true } }),
      );
    });

    const targetLine = Math.min(0 + 1, view.state.doc.lines);
    const expectedPos = view.state.doc.line(targetLine).from;
    expect(view.state.selection.main.head).toBe(expectedPos);
  });

  it("lit:scroll-to-line without cursor does not move cursor", () => {
    let capturedRef: React.RefObject<EditorView | null> = { current: null };
    function Wrapper() {
      const ref = useRef<EditorView | null>(null);
      capturedRef = ref;
      return <CodeMirrorEditor doc="line one\nline two\nline three" viewRef={ref} />;
    }
    render(<Wrapper />);
    const view = capturedRef.current!;

    act(() => {
      view.dispatch({ selection: { anchor: 5 } });
    });
    expect(view.state.selection.main.head).toBe(5);

    act(() => {
      window.dispatchEvent(
        new CustomEvent("lit:scroll-to-line", { detail: { line: 0 } }),
      );
    });

    expect(view.state.selection.main.head).toBe(5);
  });

  it("calls onDocReplaced when doc prop changes", () => {
    const fn = vi.fn();
    const { rerender } = render(<CodeMirrorEditor doc="first" onDocReplaced={fn} />);
    fn.mockClear();
    rerender(<CodeMirrorEditor doc="second" onDocReplaced={fn} />);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("lit:request-editor-focus gives the editor focus", () => {
    let capturedRef: React.RefObject<EditorView | null> = { current: null };
    function Wrapper() {
      const ref = useRef<EditorView | null>(null);
      capturedRef = ref;
      return <CodeMirrorEditor doc="test" viewRef={ref} />;
    }
    render(<Wrapper />);
    const view = capturedRef.current!;
    expect(view).not.toBeNull();

    act(() => {
      window.dispatchEvent(new CustomEvent("lit:request-editor-focus"));
    });

    expect(view.hasFocus).toBe(true);
  });

  it("cleans up request-editor-focus listener on unmount", () => {
    const { unmount } = render(<CodeMirrorEditor doc="hello" />);
    unmount();
    expect(() => {
      window.dispatchEvent(new CustomEvent("lit:request-editor-focus"));
    }).not.toThrow();
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

  // --- Concern 3.3: lit:llm-insert-raw listener ---

  it("inserts raw text at cursor on lit:llm-insert-raw", () => {
    let capturedRef: React.RefObject<EditorView | null> = { current: null };
    function Wrapper() {
      const ref = useRef<EditorView | null>(null);
      capturedRef = ref;
      return <CodeMirrorEditor doc="hello" viewRef={ref} />;
    }
    render(<Wrapper />);
    const view = capturedRef.current!;

    act(() => {
      view.dispatch({ selection: { anchor: 5 } });
    });

    act(() => {
      window.dispatchEvent(
        new CustomEvent("lit:llm-insert-raw", { detail: { text: " world" } }),
      );
    });

    expect(view.state.doc.toString()).toBe("hello world");
  });

  it("cleans up lit:llm-insert-raw listener on unmount", () => {
    const { unmount } = render(<CodeMirrorEditor doc="hello" />);
    unmount();
    expect(() => {
      window.dispatchEvent(
        new CustomEvent("lit:llm-insert-raw", { detail: { text: " world" } }),
      );
    }).not.toThrow();
  });

  // --- Concern 2.1: lit:llm-request-context listener ---

  it("responds to lit:llm-request-context with selection info", () => {
    let capturedRef: React.RefObject<EditorView | null> = { current: null };
    function Wrapper() {
      const ref = useRef<EditorView | null>(null);
      capturedRef = ref;
      return <CodeMirrorEditor doc="hello world" viewRef={ref} />;
    }
    render(<Wrapper />);
    const view = capturedRef.current!;

    act(() => {
      view.dispatch({ selection: { anchor: 6, head: 11 } });
    });

    const spy = vi.fn();
    act(() => {
      window.dispatchEvent(
        new CustomEvent("lit:llm-request-context", { detail: { callback: spy } }),
      );
    });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        selectionText: "world",
        selectionFrom: 6,
        selectionTo: 11,
      }),
    );
  });

  // --- Concern 2.2: filePath from workspace store ---

  it("includes filePath in context callback", () => {
    useWorkspaceStore.setState({ currentPagePath: "notes/test.md" });
    render(<CodeMirrorEditor doc="hello" />);

    const spy = vi.fn();
    act(() => {
      window.dispatchEvent(
        new CustomEvent("lit:llm-request-context", { detail: { callback: spy } }),
      );
    });

    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ filePath: "notes/test.md" }),
    );

    useWorkspaceStore.setState({ currentPagePath: null });
  });

  it("cleans up lit:llm-request-context listener on unmount", () => {
    const { unmount } = render(<CodeMirrorEditor doc="hello" />);
    unmount();
    const spy = vi.fn();
    window.dispatchEvent(
      new CustomEvent("lit:llm-request-context", { detail: { callback: spy } }),
    );
    expect(spy).not.toHaveBeenCalled();
  });
});
