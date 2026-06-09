import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect } from "react";
import { usePaneStore } from "../stores/panes";
import { useWorkspaceStore } from "../stores/workspace";
import { useCursorInfoStore } from "../stores/cursorInfo";
import { mockInvoke } from "../test/tauri-mock";
import * as editorViewRef from "../lib/editorViewRef";
import * as pdfPaneRef from "../lib/pdfPaneRef";
import { usePanePdfLinkStore } from "../stores/panePdfLink";
import { _resetForTesting as resetForwardSync } from "../lib/forwardSync";
import { _resetMarkerCacheForTesting as resetMarkerCache } from "../lib/pageMarkers";
import { Text } from "@codemirror/state";
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
  pdfPaneRef._resetForTesting();
  resetForwardSync();
  resetMarkerCache();
  usePanePdfLinkStore.setState({ links: new Map(), lastSyncedPage: null, pendingPdfSync: new Map(), pendingEditorSync: new Map() });
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

    it("computes noteDir for absolute pagePath", async () => {
      usePaneStore.setState({
        root: { type: "leaf", id: "pane-1", pagePath: "/external/dir/hello.md" },
        focusedPaneId: "pane-1",
      });
      useWorkspaceStore.setState({ workspacePath: "/ws" });
      render(<EditorPane paneId="pane-1" />);
      await waitFor(() => {
        expect(screen.getByTestId("mock-editor")).toHaveAttribute("data-note-dir", "/external/dir");
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

    it("resolves relative path for absolute pagePath", async () => {
      usePaneStore.setState({
        root: { type: "leaf", id: "pane-1", pagePath: "/external/dir/hello.md" },
        focusedPaneId: "pane-1",
      });
      useWorkspaceStore.setState({ workspacePath: "/ws" });
      render(<EditorPane paneId="pane-1" />);
      await waitFor(() => {
        expect(capturedProps.resolveImageSrc).toBeDefined();
      });
      const resolve = capturedProps.resolveImageSrc as (src: string) => string;
      expect(resolve("img.png")).toBe("asset://localhost//external/dir/img.png");
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

    it("resets cursorInfo to 0,0 when pagePath changes while focused", async () => {
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
      expect(useCursorInfoStore.getState().line).toBe(5);

      usePaneStore.setState({
        root: { type: "leaf", id: "pane-1", pagePath: "other.md" },
      });

      await waitFor(() => {
        expect(useCursorInfoStore.getState().line).toBe(0);
        expect(useCursorInfoStore.getState().col).toBe(0);
      });
    });
  });

  describe("pending initial editor sync", () => {
    const bodyWithMarkers = "<!-- Page 1 -->\nintro\n<!-- Page 2 -->\nbody\n<!-- Page 3 -->\nend";
    const page2MarkerOffset = bodyWithMarkers.indexOf("<!-- Page 2 -->");

    function fakeViewWithDoc(doc: string): EditorView {
      return {
        state: {
          doc: Text.of(doc.split("\n")),
          selection: { main: { head: 0 } },
        },
        dispatch: vi.fn(),
        scrollDOM: { scrollTop: 0 },
        focus: vi.fn(),
      } as unknown as EditorView;
    }

    it("scrolls to the page marker when pendingEditorSync is set", async () => {
      usePaneStore.setState({
        root: { type: "leaf", id: "pane-1", pagePath: "hello.md" },
        focusedPaneId: "pane-1",
      });
      usePanePdfLinkStore.getState().setPendingEditorSync("pane-1", 1);

      const view = fakeViewWithDoc(bodyWithMarkers);
      vi.spyOn(editorViewRef, "getPaneView").mockReturnValue(view);

      render(<EditorPane paneId="pane-1" />);
      await waitFor(() => {
        expect(capturedProps.onDocReplaced).toBeDefined();
      });
      const onDocReplaced = capturedProps.onDocReplaced as () => void;
      onDocReplaced();
      await vi.advanceTimersByTimeAsync(100);

      expect(view.dispatch).toHaveBeenCalledTimes(1);
      const tx = (view.dispatch as ReturnType<typeof vi.fn>).mock.calls[0]![0];
      expect(tx.selection.head).toBe(page2MarkerOffset);
    });

    it("consumes the pending entry so it does not fire again", async () => {
      usePaneStore.setState({
        root: { type: "leaf", id: "pane-1", pagePath: "hello.md" },
        focusedPaneId: "pane-1",
      });
      usePanePdfLinkStore.getState().setPendingEditorSync("pane-1", 1);

      const view = fakeViewWithDoc(bodyWithMarkers);
      vi.spyOn(editorViewRef, "getPaneView").mockReturnValue(view);

      render(<EditorPane paneId="pane-1" />);
      await waitFor(() => {
        expect(capturedProps.onDocReplaced).toBeDefined();
      });
      (capturedProps.onDocReplaced as () => void)();
      vi.advanceTimersByTime(16);

      expect(usePanePdfLinkStore.getState().pendingEditorSync.has("pane-1")).toBe(false);
    });

    it("sets lastSyncedPage to suppress forward-sync echo", async () => {
      usePaneStore.setState({
        root: { type: "leaf", id: "pane-1", pagePath: "hello.md" },
        focusedPaneId: "pane-1",
      });
      usePanePdfLinkStore.getState().setPendingEditorSync("pane-1", 1);

      const view = fakeViewWithDoc(bodyWithMarkers);
      vi.spyOn(editorViewRef, "getPaneView").mockReturnValue(view);

      render(<EditorPane paneId="pane-1" />);
      await waitFor(() => {
        expect(capturedProps.onDocReplaced).toBeDefined();
      });
      (capturedProps.onDocReplaced as () => void)();
      vi.advanceTimersByTime(16);

      expect(usePanePdfLinkStore.getState().lastSyncedPage).not.toBeNull();
      expect(usePanePdfLinkStore.getState().lastSyncedPage!.page).toBe(1);
    });

    it("clamps to the last marker when pendingEditorSync exceeds marker count", async () => {
      // bodyWithMarkers has 3 markers (indices 0..2). A pending index of 5 is
      // out of bounds: it must clamp to the LAST marker rather than no-op at 0.
      const page3MarkerOffset = bodyWithMarkers.indexOf("<!-- Page 3 -->");
      usePaneStore.setState({
        root: { type: "leaf", id: "pane-1", pagePath: "hello.md" },
        focusedPaneId: "pane-1",
      });
      usePanePdfLinkStore.getState().setPendingEditorSync("pane-1", 5);

      const view = fakeViewWithDoc(bodyWithMarkers);
      vi.spyOn(editorViewRef, "getPaneView").mockReturnValue(view);

      render(<EditorPane paneId="pane-1" />);
      await waitFor(() => {
        expect(capturedProps.onDocReplaced).toBeDefined();
      });
      (capturedProps.onDocReplaced as () => void)();
      await vi.advanceTimersByTimeAsync(100);

      expect(view.dispatch).toHaveBeenCalledTimes(1);
      const tx = (view.dispatch as ReturnType<typeof vi.fn>).mock.calls[0]![0];
      expect(tx.selection.head).toBe(page3MarkerOffset);
      expect(usePanePdfLinkStore.getState().lastSyncedPage).not.toBeNull();
    });

    it("does not throw and does not dispatch a sync when body has no markers", async () => {
      usePaneStore.setState({
        root: { type: "leaf", id: "pane-1", pagePath: "hello.md" },
        focusedPaneId: "pane-1",
      });
      usePanePdfLinkStore.getState().setPendingEditorSync("pane-1", 2);

      const view = fakeViewWithDoc("no markers here\njust text");
      vi.spyOn(editorViewRef, "getPaneView").mockReturnValue(view);

      render(<EditorPane paneId="pane-1" />);
      await waitFor(() => {
        expect(capturedProps.onDocReplaced).toBeDefined();
      });
      expect(() => {
        (capturedProps.onDocReplaced as () => void)();
        vi.advanceTimersByTime(16);
      }).not.toThrow();

      // Empty markers -> the sync path is a no-op. The pending entry was already
      // consumed, so no fallback fires either: no dispatch from the sync path.
      expect(view.dispatch).not.toHaveBeenCalled();
      expect(usePanePdfLinkStore.getState().lastSyncedPage).toBeNull();
    });

    it("fires the initial sync even when the editor has focus (skipGuards)", async () => {
      usePaneStore.setState({
        root: { type: "leaf", id: "pane-1", pagePath: "hello.md" },
        focusedPaneId: "pane-1",
      });
      usePanePdfLinkStore.getState().setPendingEditorSync("pane-1", 1);

      const view = fakeViewWithDoc(bodyWithMarkers);
      (view as unknown as { hasFocus: boolean }).hasFocus = true;
      vi.spyOn(editorViewRef, "getPaneView").mockReturnValue(view);

      render(<EditorPane paneId="pane-1" />);
      await waitFor(() => {
        expect(capturedProps.onDocReplaced).toBeDefined();
      });
      (capturedProps.onDocReplaced as () => void)();
      await vi.advanceTimersByTimeAsync(100);

      expect(view.dispatch).toHaveBeenCalledTimes(1);
      const tx = (view.dispatch as ReturnType<typeof vi.fn>).mock.calls[0]![0];
      expect(tx.selection.head).toBe(page2MarkerOffset);
    });

    it("falls through to pendingCursorLine when no pendingEditorSync", async () => {
      usePaneStore.setState({
        root: { type: "leaf", id: "pane-1", pagePath: "hello.md" },
        focusedPaneId: "pane-1",
      });
      useWorkspaceStore.setState({ pendingCursorLine: 2 });

      const view = fakeViewWithDoc(bodyWithMarkers);
      vi.spyOn(editorViewRef, "getPaneView").mockReturnValue(view);

      render(<EditorPane paneId="pane-1" />);
      await waitFor(() => {
        expect(capturedProps.onDocReplaced).toBeDefined();
      });
      (capturedProps.onDocReplaced as () => void)();
      vi.advanceTimersByTime(16);

      expect(view.dispatch).toHaveBeenCalledTimes(1);
      const tx = (view.dispatch as ReturnType<typeof vi.fn>).mock.calls[0]![0];
      // Line 2 in the body = "intro\n" -> line 2 starts at offset 16
      const expectedPos = Text.of(bodyWithMarkers.split("\n")).line(2).from;
      expect(tx.selection.head).toBe(expectedPos);
    });
  });

  describe("forward sync (md -> PDF)", () => {
    // Body with two page markers. Marker for "Page 2" starts at index 19.
    const bodyWithMarkers = "<!-- Page 1 -->\nfoo\n<!-- Page 2 -->\nbar";
    const page2Offset = bodyWithMarkers.indexOf("<!-- Page 2 -->");

    function fakeViewAt(offset: number, doc: string): EditorView {
      return {
        state: {
          selection: { main: { head: offset } },
          doc: Text.of(doc.split("\n")),
        },
      } as unknown as EditorView;
    }

    it("drives the linked PDF pane's goToPage with the page for the cursor offset", async () => {
      usePaneStore.setState({
        root: { type: "leaf", id: "pane-1", pagePath: "hello.md" },
        focusedPaneId: "pane-1",
      });
      // Link editor pane-1 <-> pdf pane-pdf
      usePanePdfLinkStore.getState().linkPanes("pane-1", "pane-pdf");
      const goToPageSpy = vi.fn();
      pdfPaneRef.registerPdfGoToPage("pane-pdf", goToPageSpy);
      // Cursor is at/after the "Page 2" marker -> page index 1.
      vi.spyOn(editorViewRef, "getPaneView").mockReturnValue(
        fakeViewAt(page2Offset, bodyWithMarkers),
      );

      render(<EditorPane paneId="pane-1" />);
      await waitFor(() => {
        expect(capturedProps.onSelectionChange).toBeDefined();
      });
      const onSelectionChange = capturedProps.onSelectionChange as (l: number, c: number) => void;
      onSelectionChange(3, 0);

      expect(goToPageSpy).not.toHaveBeenCalled();
      vi.advanceTimersByTime(150);
      expect(goToPageSpy).toHaveBeenCalledTimes(1);
      expect(goToPageSpy).toHaveBeenCalledWith(1);
    });

    it("does nothing when the editor pane is not linked", async () => {
      usePaneStore.setState({
        root: { type: "leaf", id: "pane-1", pagePath: "hello.md" },
        focusedPaneId: "pane-1",
      });
      const goToPageSpy = vi.fn();
      pdfPaneRef.registerPdfGoToPage("pane-pdf", goToPageSpy);
      vi.spyOn(editorViewRef, "getPaneView").mockReturnValue(
        fakeViewAt(page2Offset, bodyWithMarkers),
      );

      render(<EditorPane paneId="pane-1" />);
      await waitFor(() => {
        expect(capturedProps.onSelectionChange).toBeDefined();
      });
      const onSelectionChange = capturedProps.onSelectionChange as (l: number, c: number) => void;
      onSelectionChange(3, 0);
      vi.advanceTimersByTime(150);
      expect(goToPageSpy).not.toHaveBeenCalled();
    });

    it("marks forward sync on the linked PDF pane before calling goToPage", async () => {
      usePaneStore.setState({
        root: { type: "leaf", id: "pane-1", pagePath: "hello.md" },
        focusedPaneId: "pane-1",
      });
      usePanePdfLinkStore.getState().linkPanes("pane-1", "pane-pdf");
      const goToPageSpy = vi.fn();
      pdfPaneRef.registerPdfGoToPage("pane-pdf", goToPageSpy);
      vi.spyOn(editorViewRef, "getPaneView").mockReturnValue(
        fakeViewAt(page2Offset, bodyWithMarkers),
      );
      const markSpy = vi.spyOn(pdfPaneRef, "markForwardSync");

      render(<EditorPane paneId="pane-1" />);
      await waitFor(() => {
        expect(capturedProps.onSelectionChange).toBeDefined();
      });
      const onSelectionChange = capturedProps.onSelectionChange as (l: number, c: number) => void;
      onSelectionChange(3, 0);
      vi.advanceTimersByTime(150);

      expect(markSpy).toHaveBeenCalledWith("pane-pdf");
      // markForwardSync must be called BEFORE goToPage
      const markOrder = markSpy.mock.invocationCallOrder[0];
      const goOrder = goToPageSpy.mock.invocationCallOrder[0];
      expect(markOrder).toBeLessThan(goOrder!);
    });

    it("an earlier navigation's stale safety-net timeout does not clear a newer navigation's flag", async () => {
      usePaneStore.setState({
        root: { type: "leaf", id: "pane-1", pagePath: "hello.md" },
        focusedPaneId: "pane-1",
      });
      usePanePdfLinkStore.getState().linkPanes("pane-1", "pane-pdf");
      // Slow IPC: goToPage does NOT synchronously fire onPageChange, so the flag
      // stays in flight until the (late) handlePageChange consumes it.
      pdfPaneRef.registerPdfGoToPage("pane-pdf", vi.fn());
      const viewSpy = vi.spyOn(editorViewRef, "getPaneView");

      render(<EditorPane paneId="pane-1" />);
      await waitFor(() => {
        expect(capturedProps.onSelectionChange).toBeDefined();
      });
      const onSelectionChange = capturedProps.onSelectionChange as (l: number, c: number) => void;

      // First navigation -> page 1 (cursor at the "Page 2" marker).
      viewSpy.mockReturnValue(fakeViewAt(page2Offset, bodyWithMarkers));
      onSelectionChange(3, 0);
      // t=150: token1 flag set, token1 safety net scheduled for t=650.
      vi.advanceTimersByTime(150);

      // Newer navigation -> page 0 (cursor before the "Page 2" marker), still
      // before token1's safety-net timeout fires.
      vi.advanceTimersByTime(200); // t=350
      viewSpy.mockReturnValue(fakeViewAt(0, bodyWithMarkers));
      onSelectionChange(1, 0);
      // t=500: token2 flag replaces token1, token2 safety net scheduled for t=1000.
      vi.advanceTimersByTime(150);

      // Advance past token1's t=650 safety-net timeout but BEFORE token2's
      // t=1000 one. With a fixed/unscoped clear, token1's late timeout would
      // clobber token2's in-flight flag; token-scoped, it is a no-op.
      vi.advanceTimersByTime(200); // t=700

      // token2's flag must survive so the (late) onPageChange suppresses the
      // reverse-sync echo and the cursor does not bounce.
      expect(pdfPaneRef.consumeForwardSync("pane-pdf")).toBe(true);
    });

    it("does not navigate the PDF pane if it is unlinked during the debounce window", async () => {
      usePaneStore.setState({
        root: { type: "leaf", id: "pane-1", pagePath: "hello.md" },
        focusedPaneId: "pane-1",
      });
      usePanePdfLinkStore.getState().linkPanes("pane-1", "pane-pdf");
      const goToPageSpy = vi.fn();
      pdfPaneRef.registerPdfGoToPage("pane-pdf", goToPageSpy);
      vi.spyOn(editorViewRef, "getPaneView").mockReturnValue(
        fakeViewAt(page2Offset, bodyWithMarkers),
      );
      const markSpy = vi.spyOn(pdfPaneRef, "markForwardSync");

      render(<EditorPane paneId="pane-1" />);
      await waitFor(() => {
        expect(capturedProps.onSelectionChange).toBeDefined();
      });
      const onSelectionChange = capturedProps.onSelectionChange as (l: number, c: number) => void;
      // Schedule the sync while linked...
      onSelectionChange(3, 0);
      // ...but unlink before the trailing-edge fires.
      usePanePdfLinkStore.getState().unlinkPane("pane-1");
      vi.advanceTimersByTime(150);

      // The link is re-validated at fire time, so the unlink is honored and
      // forward sync is a no-op: no navigation, no flag minted.
      expect(goToPageSpy).not.toHaveBeenCalled();
      expect(markSpy).not.toHaveBeenCalledWith("pane-pdf");
      expect(pdfPaneRef.consumeForwardSync("pane-pdf")).toBe(false);
    });

    it("still updates cursorInfo even when linked", async () => {
      usePaneStore.setState({
        root: { type: "leaf", id: "pane-1", pagePath: "hello.md" },
        focusedPaneId: "pane-1",
      });
      usePanePdfLinkStore.getState().linkPanes("pane-1", "pane-pdf");
      pdfPaneRef.registerPdfGoToPage("pane-pdf", vi.fn());
      vi.spyOn(editorViewRef, "getPaneView").mockReturnValue(
        fakeViewAt(page2Offset, bodyWithMarkers),
      );

      render(<EditorPane paneId="pane-1" />);
      await waitFor(() => {
        expect(capturedProps.onSelectionChange).toBeDefined();
      });
      const onSelectionChange = capturedProps.onSelectionChange as (l: number, c: number) => void;
      onSelectionChange(7, 2);
      expect(useCursorInfoStore.getState().line).toBe(7);
      expect(useCursorInfoStore.getState().col).toBe(2);
    });
  });
});
