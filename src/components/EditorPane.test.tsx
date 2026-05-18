import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect } from "react";
import { usePaneStore } from "../stores/panes";
import { mockInvoke } from "../test/tauri-mock";
import * as editorViewRef from "../lib/editorViewRef";
import type { EditorView } from "@codemirror/view";

const mockView = {} as EditorView;

vi.mock("../editor/CodeMirrorEditor", () => ({
  CodeMirrorEditor: (props: {
    doc: string;
    frontmatter?: Record<string, unknown>;
    onViewChange?: (view: EditorView | null) => void;
  }) => {
    useEffect(() => {
      props.onViewChange?.(mockView);
      return () => { props.onViewChange?.(null); };
    }, []);
    return (
      <div
        data-testid="mock-editor"
        data-doc={props.doc}
        data-frontmatter={props.frontmatter ? JSON.stringify(props.frontmatter) : undefined}
      />
    );
  },
}));

const samplePage = {
  body: "# Hello\nContent here",
  raw_yaml: "",
  meta: {
    title: "Hello",
    frontmatter: {},
    relative_path: "hello.md",
    created_at: 1000,
    modified_at: 2000,
    file_type: "markdown" as const,
  },
};

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  usePaneStore.setState({
    root: { type: "leaf", id: "pane-1", pagePath: null },
    focusedPaneId: "pane-1",
  });
  editorViewRef._resetForTesting();

  mockInvoke((cmd) => {
    if (cmd === "read_page") return samplePage;
    if (cmd === "write_page") return null;
    throw new Error(`Unknown command: ${cmd}`);
  });

  return () => {
    vi.useRealTimers();
    cleanup();
  };
});

import { EditorPane } from "./EditorPane";

describe("EditorPane", () => {
  it("renders empty state when pagePath is null", () => {
    render(<EditorPane paneId="pane-1" />);
    expect(screen.getByTestId("pane-empty-state")).toBeInTheDocument();
    expect(screen.queryByTestId("mock-editor")).toBeNull();
  });

  it("renders breadcrumb with page title", async () => {
    usePaneStore.setState({
      root: { type: "leaf", id: "pane-1", pagePath: "hello.md" },
      focusedPaneId: "pane-1",
    });
    render(<EditorPane paneId="pane-1" />);
    await waitFor(() => {
      expect(screen.getByTestId("pane-breadcrumb")).toHaveTextContent("Hello");
    });
  });

  it("passes loaded body to CodeMirrorEditor", async () => {
    usePaneStore.setState({
      root: { type: "leaf", id: "pane-1", pagePath: "hello.md" },
      focusedPaneId: "pane-1",
    });
    render(<EditorPane paneId="pane-1" />);
    await waitFor(() => {
      expect(screen.getByTestId("mock-editor")).toHaveAttribute("data-doc", "# Hello\nContent here");
    });
  });

  it("shows focused border when pane is focusedPaneId", () => {
    usePaneStore.setState({
      root: { type: "leaf", id: "pane-1", pagePath: null },
      focusedPaneId: "pane-1",
    });
    render(<EditorPane paneId="pane-1" />);
    expect(screen.getByTestId("editor-pane")).toHaveClass("border-interactive-accent");
  });

  it("no focused border for unfocused pane", () => {
    usePaneStore.setState({
      root: { type: "leaf", id: "pane-1", pagePath: null },
      focusedPaneId: "other",
    });
    render(<EditorPane paneId="pane-1" />);
    expect(screen.getByTestId("editor-pane")).not.toHaveClass("border-interactive-accent");
  });

  it("clicking pane calls focusPane", async () => {
    usePaneStore.setState({
      root: {
        type: "split",
        id: "s1",
        direction: "horizontal",
        children: [
          { type: "leaf", id: "pane-1", pagePath: null },
          { type: "leaf", id: "other", pagePath: null },
        ],
        sizes: [50, 50],
      },
      focusedPaneId: "other",
    });
    render(<EditorPane paneId="pane-1" />);
    await userEvent.click(screen.getByTestId("editor-pane"));
    expect(usePaneStore.getState().focusedPaneId).toBe("pane-1");
  });

  it("calls registerPaneView on mount, unregisterPaneView on unmount", async () => {
    const registerSpy = vi.spyOn(editorViewRef, "registerPaneView");
    const unregisterSpy = vi.spyOn(editorViewRef, "unregisterPaneView");

    usePaneStore.setState({
      root: { type: "leaf", id: "pane-1", pagePath: "hello.md" },
      focusedPaneId: "pane-1",
    });
    const { unmount } = render(<EditorPane paneId="pane-1" />);

    await waitFor(() => {
      expect(registerSpy).toHaveBeenCalledWith("pane-1", mockView);
    });

    unmount();
    expect(unregisterSpy).toHaveBeenCalledWith("pane-1");
  });

  it("calls setFocusedPane on click", async () => {
    const spy = vi.spyOn(editorViewRef, "setFocusedPane");
    render(<EditorPane paneId="pane-1" />);
    await userEvent.click(screen.getByTestId("editor-pane"));
    expect(spy).toHaveBeenCalledWith("pane-1");
  });

  it("passes frontmatter from usePageContent to CodeMirrorEditor", async () => {
    const pageWithFm = {
      ...samplePage,
      meta: { ...samplePage.meta, frontmatter: { tags: ["note"], draft: true } },
    };
    mockInvoke((cmd) => {
      if (cmd === "read_page") return pageWithFm;
      if (cmd === "write_page") return null;
      throw new Error(`Unknown command: ${cmd}`);
    });
    usePaneStore.setState({
      root: { type: "leaf", id: "pane-1", pagePath: "hello.md" },
      focusedPaneId: "pane-1",
    });
    render(<EditorPane paneId="pane-1" />);
    await waitFor(() => {
      const fm = screen.getByTestId("mock-editor").getAttribute("data-frontmatter");
      expect(fm).not.toBeNull();
      expect(JSON.parse(fm!)).toEqual({ tags: ["note"], draft: true });
    });
  });

  it("focuses pane on mousedown even when click propagation is blocked", () => {
    usePaneStore.setState({
      root: {
        type: "split",
        id: "s1",
        direction: "horizontal",
        children: [
          { type: "leaf", id: "pane-1", pagePath: null },
          { type: "leaf", id: "other", pagePath: null },
        ],
        sizes: [50, 50],
      },
      focusedPaneId: "other",
    });
    render(<EditorPane paneId="pane-1" />);
    const child = screen.getByTestId("pane-empty-state");

    child.addEventListener("click", (e) => e.stopPropagation());
    child.addEventListener("mousedown", (e) => e.stopPropagation());

    fireEvent.mouseDown(child);

    expect(usePaneStore.getState().focusedPaneId).toBe("pane-1");
  });
});
