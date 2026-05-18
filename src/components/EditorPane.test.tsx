import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect } from "react";
import { usePaneStore } from "../stores/panes";
import { useWorkspaceStore } from "../stores/workspace";
import { useCursorInfoStore } from "../stores/cursorInfo";
import { mockInvoke } from "../test/tauri-mock";
import * as editorViewRef from "../lib/editorViewRef";
import type { EditorView } from "@codemirror/view";

const mockView = {} as EditorView;

let capturedProps: Record<string, unknown> = {};

vi.mock("../editor/CodeMirrorEditor", () => ({
  CodeMirrorEditor: (props: {
    doc: string;
    frontmatter?: Record<string, unknown>;
    onViewChange?: (view: EditorView | null) => void;
    onSelectionChange?: (line: number, col: number) => void;
    keymapBindings?: unknown[];
    noteDir?: string;
    resolveImageSrc?: (src: string) => string;
    openFilePath?: (path: string) => void;
    navigateToPage?: (target: string, section?: string, departurePos?: number) => void;
    onDocReplaced?: () => void;
  }) => {
    capturedProps = { ...props };
    useEffect(() => {
      props.onViewChange?.(mockView);
      return () => { props.onViewChange?.(null); };
    }, []);
    return (
      <div
        data-testid="mock-editor"
        data-doc={props.doc}
        data-frontmatter={props.frontmatter ? JSON.stringify(props.frontmatter) : undefined}
        data-has-keymap-bindings={props.keymapBindings ? "true" : undefined}
        data-note-dir={props.noteDir || undefined}
        data-has-navigate-to-page={props.navigateToPage ? "true" : undefined}
        data-has-on-doc-replaced={props.onDocReplaced ? "true" : undefined}
      />
    );
  },
}));

vi.mock("../hooks/useKeymaps", () => ({
  useKeymaps: () => ({ editorBindings: [{ key: "Mod-b", run: () => true }], loading: false }),
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
  capturedProps = {};
  usePaneStore.setState({
    root: { type: "leaf", id: "pane-1", pagePath: null },
    focusedPaneId: "pane-1",
  });
  useWorkspaceStore.setState({
    workspacePath: "/ws",
    pages: [],
    currentPagePath: null,
  });
  editorViewRef._resetForTesting();
  useCursorInfoStore.setState({ line: 0, col: 0 });

  mockInvoke((cmd) => {
    if (cmd === "read_page") return samplePage;
    if (cmd === "write_page") return null;
    if (cmd === "resolve_wikilink") return { node_id: "target.md" };
    if (cmd === "create_page") return { title: "New", relative_path: "new.md", frontmatter: {}, created_at: 0, modified_at: 0, file_type: "markdown" };
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

  // --- Layer B: new prop tests ---

  describe("keymapBindings", () => {
    it("passes keymapBindings to editor", async () => {
      usePaneStore.setState({
        root: { type: "leaf", id: "pane-1", pagePath: "hello.md" },
        focusedPaneId: "pane-1",
      });
      render(<EditorPane paneId="pane-1" />);
      await waitFor(() => {
        expect(screen.getByTestId("mock-editor")).toHaveAttribute("data-has-keymap-bindings", "true");
      });
    });
  });

  describe("noteDir", () => {
    it("computes noteDir for nested page", async () => {
      usePaneStore.setState({
        root: { type: "leaf", id: "pane-1", pagePath: "sub/hello.md" },
        focusedPaneId: "pane-1",
      });
      useWorkspaceStore.setState({ workspacePath: "/ws" });
      render(<EditorPane paneId="pane-1" />);
      await waitFor(() => {
        expect(screen.getByTestId("mock-editor")).toHaveAttribute("data-note-dir", "/ws/sub");
      });
    });

    it("computes noteDir for root-level page", async () => {
      usePaneStore.setState({
        root: { type: "leaf", id: "pane-1", pagePath: "hello.md" },
        focusedPaneId: "pane-1",
      });
      useWorkspaceStore.setState({ workspacePath: "/ws" });
      render(<EditorPane paneId="pane-1" />);
      await waitFor(() => {
        expect(screen.getByTestId("mock-editor")).toHaveAttribute("data-note-dir", "/ws");
      });
    });

    it("returns empty string when workspacePath is null", async () => {
      usePaneStore.setState({
        root: { type: "leaf", id: "pane-1", pagePath: "hello.md" },
        focusedPaneId: "pane-1",
      });
      useWorkspaceStore.setState({ workspacePath: null });
      render(<EditorPane paneId="pane-1" />);
      await waitFor(() => {
        expect(screen.getByTestId("mock-editor")).not.toHaveAttribute("data-note-dir");
      });
    });
  });

  describe("resolveImageSrc", () => {
    it("resolves relative path via convertFileSrc", async () => {
      usePaneStore.setState({
        root: { type: "leaf", id: "pane-1", pagePath: "sub/hello.md" },
        focusedPaneId: "pane-1",
      });
      useWorkspaceStore.setState({ workspacePath: "/ws" });
      render(<EditorPane paneId="pane-1" />);
      await waitFor(() => {
        expect(capturedProps.resolveImageSrc).toBeDefined();
      });
      const resolve = capturedProps.resolveImageSrc as (src: string) => string;
      expect(resolve("img.png")).toBe("asset://localhost//ws/sub/img.png");
    });

    it("passes through absolute URLs", async () => {
      usePaneStore.setState({
        root: { type: "leaf", id: "pane-1", pagePath: "hello.md" },
        focusedPaneId: "pane-1",
      });
      useWorkspaceStore.setState({ workspacePath: "/ws" });
      render(<EditorPane paneId="pane-1" />);
      await waitFor(() => {
        expect(capturedProps.resolveImageSrc).toBeDefined();
      });
      const resolve = capturedProps.resolveImageSrc as (src: string) => string;
      expect(resolve("https://example.com/img.png")).toBe("https://example.com/img.png");
      expect(resolve("data:image/png;base64,abc")).toBe("data:image/png;base64,abc");
    });
  });

  describe("openFilePath", () => {
    it("calls openPath directly for absolute paths", async () => {
      const { openPath } = await import("@tauri-apps/plugin-opener");
      usePaneStore.setState({
        root: { type: "leaf", id: "pane-1", pagePath: "hello.md" },
        focusedPaneId: "pane-1",
      });
      useWorkspaceStore.setState({ workspacePath: "/ws" });
      render(<EditorPane paneId="pane-1" />);
      await waitFor(() => {
        expect(capturedProps.openFilePath).toBeDefined();
      });
      const open = capturedProps.openFilePath as (path: string) => void;
      open("/absolute/path.pdf");
      expect(openPath).toHaveBeenCalledWith("/absolute/path.pdf");
    });

    it("resolves relative paths via workspace", async () => {
      const { openPath } = await import("@tauri-apps/plugin-opener");
      usePaneStore.setState({
        root: { type: "leaf", id: "pane-1", pagePath: "sub/hello.md" },
        focusedPaneId: "pane-1",
      });
      useWorkspaceStore.setState({ workspacePath: "/ws" });
      render(<EditorPane paneId="pane-1" />);
      await waitFor(() => {
        expect(capturedProps.openFilePath).toBeDefined();
      });
      const open = capturedProps.openFilePath as (path: string) => void;
      open("file.pdf");
      expect(openPath).toHaveBeenCalledWith("/ws/sub/file.pdf");
    });
  });

  describe("navigateToPage", () => {
    it("passes navigateToPage callback", async () => {
      usePaneStore.setState({
        root: { type: "leaf", id: "pane-1", pagePath: "hello.md" },
        focusedPaneId: "pane-1",
      });
      render(<EditorPane paneId="pane-1" />);
      await waitFor(() => {
        expect(screen.getByTestId("mock-editor")).toHaveAttribute("data-has-navigate-to-page", "true");
      });
    });
  });

  describe("onDocReplaced", () => {
    it("passes onDocReplaced callback", async () => {
      usePaneStore.setState({
        root: { type: "leaf", id: "pane-1", pagePath: "hello.md" },
        focusedPaneId: "pane-1",
      });
      render(<EditorPane paneId="pane-1" />);
      await waitFor(() => {
        expect(screen.getByTestId("mock-editor")).toHaveAttribute("data-has-on-doc-replaced", "true");
      });
    });
  });

  describe("onSelectionChange", () => {
    it("updates cursorInfo store on selection change", async () => {
      usePaneStore.setState({
        root: { type: "leaf", id: "pane-1", pagePath: "hello.md" },
        focusedPaneId: "pane-1",
      });
      render(<EditorPane paneId="pane-1" />);
      await waitFor(() => {
        expect(capturedProps.onSelectionChange).toBeDefined();
      });
      const onSelectionChange = capturedProps.onSelectionChange as (line: number, col: number) => void;
      onSelectionChange(5, 10);
      const { line, col } = useCursorInfoStore.getState();
      expect(line).toBe(5);
      expect(col).toBe(10);
    });
  });
});
