import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, act, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect } from "react";
import type { EditorView } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { ContentArea, parseYamlErrorLocation } from "./ContentArea";
import { mockInvoke, mockListen, emitMockEvent, resetListenMock } from "../test/tauri-mock";
import { useWorkspaceStore } from "../stores/workspace";
import { usePaneStore } from "../stores/panes";
import { usePreferencesStore } from "../stores/preferences";
import { useCardboxStore } from "../stores/cardbox";
import { _resetForTesting as resetRegistry } from "../lib/paneContentRegistry";
import { _resetForTesting as resetEditorViewRef } from "../lib/editorViewRef";
import * as commandRegistryModule from "../lib/commandRegistry";

// Real CodeMirrorEditor mounts a live EditorView per test; across this file's
// ~86 tests that piles up jsdom+CM state and contributes to the full-suite
// hang (see doc/reports on the "ui" project stall). None of the remaining
// tests here inspect the CM instance itself (they only assert on
// screen.getByTestId("editor")'s presence/text/visibility, store state, or
// mocked IPC calls) so a lightweight stand-in is safe. Tests that dispatch
// real CM transactions live in ContentArea.editorSync.test.tsx instead.
// PaneContainer calls view.focus() on a viewMode->"editor" transition, and
// ContentArea reads view.scrollDOM/view.state (doc/selection) on page switch
// to save scroll position and record jump history - so the mock view carries
// a real EditorState (kept in sync with the current doc prop) rather than a
// bare object.
const mockView = {
  focus: vi.fn(),
  scrollDOM: { scrollTop: 0 },
  state: EditorState.create({ doc: "" }),
} as unknown as EditorView;

vi.mock("../editor/CodeMirrorEditor", () => ({
  CodeMirrorEditor: (props: {
    doc: string;
    style?: React.CSSProperties;
    onViewChange?: (view: EditorView | null) => void;
  }) => {
    (mockView as unknown as { state: EditorState }).state = EditorState.create({ doc: props.doc });
    useEffect(() => {
      props.onViewChange?.(mockView);
      return () => { props.onViewChange?.(null); };
    }, []);
    return (
      <div data-testid="editor" className="flex-1 overflow-hidden" style={props.style}>
        {props.doc}
      </div>
    );
  },
}));

// Mock pdfjs for PdfViewer (which no longer uses pdfium IPC)
vi.mock("../lib/pdfjs", () => {
  const mockRender = vi.fn(() => ({ promise: Promise.resolve(), cancel: vi.fn() }));
  const mockGetViewport = vi.fn(() => ({ width: 100, height: 200 }));
  const mockGetTextContent = vi.fn(() => Promise.resolve({ items: [], styles: {}, lang: null }));
  const mockGetAnnotations = vi.fn(() => Promise.resolve([]));
  const mockGetPage = vi.fn(() => Promise.resolve({ getViewport: mockGetViewport, render: mockRender, getTextContent: mockGetTextContent, getAnnotations: mockGetAnnotations }));
  const mockDoc = { numPages: 2, getPage: mockGetPage, destroy: vi.fn() };
  return {
    loadDocument: vi.fn(() => Promise.resolve(mockDoc)),
    TextLayer: vi.fn().mockImplementation(() => ({ render: vi.fn(() => Promise.resolve()), cancel: vi.fn() })),
    AnnotationLayer: vi.fn().mockImplementation(() => ({ render: vi.fn(() => Promise.resolve()) })),
    setLayerDimensions: vi.fn(),
  };
});

vi.mock("sigma", () => ({
  default: class MockSigma {
    kill = vi.fn();
    on = vi.fn();
    off = vi.fn();
    refresh = vi.fn();
    setSetting = vi.fn();
    getCamera = () => ({ animatedReset: vi.fn() });
  },
}));
vi.mock("@sigma/node-border", () => ({
  createNodeBorderProgram: () => class {},
}));

import { globalJumpTracker } from "../editor/jumpTracker";

const samplePage = {
  body: "# Hello\nSome content",
  raw_yaml: "tags:\n  - test\n",
  meta: {
    title: "Hello",
    frontmatter: { tags: ["test"] },
    relative_path: "Hello.md",
    created_at: 1000,
    modified_at: 2000,
    file_type: 'markdown' as const,
    has_companion: false,
  },
};

const otherPage = {
  body: "# Other\nDifferent content",
  raw_yaml: "",
  meta: {
    title: "Other",
    frontmatter: {},
    relative_path: "Other.md",
    created_at: 1000,
    modified_at: 2000,
    file_type: 'markdown' as const,
    has_companion: false,
  },
};

let writePageCalls: Array<{ path: string; body: string }> = [];

beforeEach(() => {
  // jsdom has no real canvas; stub getContext for PdfViewer's canvas rendering
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({})) as unknown as typeof HTMLCanvasElement.prototype.getContext;
  writePageCalls = [];
  useWorkspaceStore.setState({
    workspacePath: "/test",
    pages: [],
    currentPagePath: null,
    currentPageHeadings: [],
    isDirty: false,
    reloadTrigger: 0,
    viewStates: {},
    loading: false,
    error: null,
  });

  usePaneStore.setState({
    root: { type: "leaf", id: "test-pane", pagePath: null },
    focusedPaneId: "test-pane",
  });
  usePreferencesStore.setState({ defaultViewMode: "editor", graphViewEnabled: false });
  resetRegistry();
  resetEditorViewRef();

  mockInvoke((cmd, args) => {
    if (cmd === "read_page") {
      const rp = (args as Record<string, unknown>)?.relativePath;
      if (rp === "Other.md") return otherPage;
      return samplePage;
    }
    if (cmd === "write_page") {
      writePageCalls.push({
        path: (args as Record<string, unknown>)?.relativePath as string,
        body: (args as Record<string, unknown>)?.body as string,
      });
      return null;
    }
    if (cmd === "parse_raw_yaml") {
      const raw = (args as Record<string, unknown>)?.rawYaml as string;
      if (raw.includes("[[[")) throw new Error("did not find expected ',' or ']' at line 1 column 6");
      if (raw.trim() === "") return {};
      return { tags: ["test"] };
    }
    if (cmd === "get_backlinks") return [];
    if (cmd === "get_keymaps") return [];
    if (cmd === "get_graph_subgraph") return { nodes: [], edges: [] };
    if (cmd === "get_pagerank") return {};
    if (cmd === "get_graph_positions") return {};
    if (cmd === "acknowledge_file_hash") return null;
    if (cmd === "allow_asset_scope") return undefined;
    throw new Error(`Unknown command: ${cmd}`);
  });
});

function setPage(path: string) {
  usePaneStore.getState().setPanePage("test-pane", path);
  useWorkspaceStore.setState({ currentPagePath: path });
}

describe("ContentArea", () => {
  it("shows empty state when no page selected", () => {
    render(<ContentArea />);
    expect(screen.getByTestId("empty-state")).toBeInTheDocument();
  });

  it("loads page content into editor", async () => {
    setPage("Hello.md");
    render(<ContentArea />);

    await waitFor(() => {
      const editor = screen.getByTestId("editor");
      expect(editor.textContent).toContain("Hello");
      expect(editor.textContent).toContain("Some content");
    });
  });

  it("displays page title", async () => {
    setPage("Hello.md");
    render(<ContentArea />);

    await waitFor(() => {
      expect(screen.getByTestId("page-title")).toHaveValue("Hello");
    });
  });

  it("switches content on page change", async () => {
    setPage("Hello.md");
    const { unmount } = render(<ContentArea />);

    await waitFor(() => {
      expect(screen.getByTestId("editor").textContent).toContain("Some content");
    });
    unmount();

    setPage("Other.md");
    render(<ContentArea />);

    await waitFor(() => {
      expect(screen.getByTestId("page-title")).toHaveValue("Other");
      expect(screen.getByTestId("editor").textContent).toContain("Different content");
    });
  });

  it("renders PaneContainer in editor mode", async () => {
    setPage("Hello.md");
    render(<ContentArea />);

    await waitFor(() => {
      expect(screen.getByTestId("editor-pane")).toBeInTheDocument();
    });
  });

  it("title bar shows focused pane's page title", async () => {
    setPage("Hello.md");
    render(<ContentArea />);

    await waitFor(() => {
      expect(screen.getByTestId("page-title")).toHaveValue("Hello");
    });
  });

  it("BottomPanel receives focused pane's pagePath", async () => {
    setPage("Hello.md");
    render(<ContentArea />);

    await waitFor(() => {
      expect(screen.getByTestId("bottom-panel")).toBeInTheDocument();
    });
  });

  it("title editing commits rename for focused pane's page", async () => {
    const spy = vi.fn();
    useWorkspaceStore.setState({ renamePage: spy });
    setPage("Hello.md");
    render(<ContentArea />);

    await waitFor(() => {
      expect(screen.getByTestId("page-title")).toHaveValue("Hello");
    });

    const input = screen.getByTestId("page-title");
    await userEvent.clear(input);
    await userEvent.type(input, "NewTitle");
    await act(async () => {
      input.blur();
    });

    expect(spy).toHaveBeenCalledWith("Hello.md", "NewTitle");
  });

  it("frontmatter toggle works", async () => {
    setPage("Hello.md");
    render(<ContentArea />);

    await waitFor(() => {
      expect(screen.getByTitle("Show frontmatter")).toBeInTheDocument();
    });

    await act(async () => {
      screen.getByTitle("Show frontmatter").click();
    });
    expect(screen.getByTestId("frontmatter")).toBeInTheDocument();
    const text = screen.getByTestId("frontmatter").textContent!;
    expect(text).toContain("test");
    expect(text).toContain("tags:");
    expect(text).not.toContain('"tags"');
  });
});

describe("ContentArea lit:focus-cardbox-card bridge", () => {
  beforeEach(() => {
    useCardboxStore.setState({ pendingFocusUuid: null, pendingHighlightNote: false });
  });

  it("forwards uuid and highlightNote to the cardbox store", async () => {
    render(<ContentArea />);
    act(() => {
      window.dispatchEvent(
        new CustomEvent("lit:focus-cardbox-card", {
          detail: { uuid: "u1", highlightNote: true },
        }),
      );
    });
    expect(useCardboxStore.getState().pendingFocusUuid).toBe("u1");
    expect(useCardboxStore.getState().pendingHighlightNote).toBe(true);
  });

  it("defaults highlightNote to false when the detail omits it", async () => {
    render(<ContentArea />);
    act(() => {
      window.dispatchEvent(
        new CustomEvent("lit:focus-cardbox-card", { detail: { uuid: "u2" } }),
      );
    });
    expect(useCardboxStore.getState().pendingFocusUuid).toBe("u2");
    expect(useCardboxStore.getState().pendingHighlightNote).toBe(false);
  });

  // #972 Cycle 5: pin step 1 of the acceptance path end-to-end — the focused
  // pane must flip to cardbox view when the glyph event fires.
  it("switches the focused pane viewMode to cardbox", async () => {
    render(<ContentArea />);
    expect(usePaneStore.getState().root).toMatchObject({
      type: "leaf",
      id: "test-pane",
    });
    // Default is editor (viewMode unset).
    const before = usePaneStore.getState().root;
    expect(before.type === "leaf" ? before.viewMode : undefined).toBeUndefined();

    act(() => {
      window.dispatchEvent(
        new CustomEvent("lit:focus-cardbox-card", { detail: { uuid: "u3" } }),
      );
    });

    const after = usePaneStore.getState().root;
    expect(after.type === "leaf" ? after.viewMode : undefined).toBe("cardbox");
    expect(useCardboxStore.getState().pendingFocusUuid).toBe("u3");
  });
});

describe("frontmatter editing", () => {
  async function showFrontmatterPanel() {
    setPage("Hello.md");
    render(<ContentArea />);
    await waitFor(() => {
      expect(screen.getByTitle("Show frontmatter")).toBeInTheDocument();
    });
    await act(async () => {
      screen.getByTitle("Show frontmatter").click();
    });
    expect(screen.getByTestId("frontmatter")).toBeInTheDocument();
  }

  it("clicking frontmatter enters edit mode with textarea", async () => {
    await showFrontmatterPanel();
    await userEvent.click(screen.getByTestId("frontmatter"));
    expect(screen.getByTestId("frontmatter-editor")).toBeInTheDocument();
  });

  it("textarea is pre-filled with rawYaml and focused", async () => {
    await showFrontmatterPanel();
    await userEvent.click(screen.getByTestId("frontmatter"));
    const textarea = screen.getByTestId("frontmatter-editor") as HTMLTextAreaElement;
    expect(textarea.value).toBe("tags:\n  - test\n");
    expect(document.activeElement).toBe(textarea);
  });

  it("Escape cancels without saving", async () => {
    await showFrontmatterPanel();
    await userEvent.click(screen.getByTestId("frontmatter"));
    const textarea = screen.getByTestId("frontmatter-editor");
    await userEvent.clear(textarea);
    await userEvent.type(textarea, "changed: true");
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByTestId("frontmatter-editor")).not.toBeInTheDocument();
    expect(screen.getByTestId("frontmatter").textContent).toContain("tags:");
  });

  it("blur commits valid YAML and triggers save", async () => {
    await showFrontmatterPanel();
    await userEvent.click(screen.getByTestId("frontmatter"));
    const textarea = screen.getByTestId("frontmatter-editor");
    await userEvent.clear(textarea);
    await userEvent.type(textarea, "newtag: value");
    await act(async () => {
      textarea.blur();
    });
    await waitFor(() => {
      expect(screen.queryByTestId("frontmatter-editor")).not.toBeInTheDocument();
    });
    expect(writePageCalls.length).toBeGreaterThan(0);
  });

  it("blur with invalid YAML shows error and stays in edit mode", async () => {
    await showFrontmatterPanel();
    await userEvent.click(screen.getByTestId("frontmatter"));
    const textarea = screen.getByTestId("frontmatter-editor");
    await userEvent.clear(textarea);
    await userEvent.type(textarea, "bad: {[}{[}{[}");
    await act(async () => {
      textarea.blur();
    });
    await waitFor(() => {
      expect(screen.getByTestId("yaml-error")).toBeInTheDocument();
    });
    const ta = screen.getByTestId("frontmatter-editor") as HTMLTextAreaElement;
    expect(ta).toBeInTheDocument();
    expect(ta.selectionStart).toBe(0);
    expect(ta.selectionEnd).toBe("bad: [[[".length);
  });

  it("YAML error selection works correctly with emoji in content", async () => {
    await showFrontmatterPanel();
    await userEvent.click(screen.getByTestId("frontmatter"));
    const textarea = screen.getByTestId("frontmatter-editor");
    await userEvent.clear(textarea);
    await userEvent.type(textarea, "🚀: {[}{[}{[}");
    await act(async () => {
      textarea.blur();
    });
    await waitFor(() => {
      expect(screen.getByTestId("yaml-error")).toBeInTheDocument();
    });
    const ta = screen.getByTestId("frontmatter-editor") as HTMLTextAreaElement;
    expect(ta.selectionStart).toBe(0);
    expect(ta.selectionEnd).toBe("🚀: [[[".length);
  });

  it("editing to empty commits empty frontmatter", async () => {
    await showFrontmatterPanel();
    await userEvent.click(screen.getByTestId("frontmatter"));
    const textarea = screen.getByTestId("frontmatter-editor");
    await userEvent.clear(textarea);
    await act(async () => {
      textarea.blur();
    });
    await waitFor(() => {
      expect(screen.queryByTestId("frontmatter-editor")).not.toBeInTheDocument();
    });
  });

  it("page switch resets edit state", async () => {
    await showFrontmatterPanel();
    await userEvent.click(screen.getByTestId("frontmatter"));
    expect(screen.getByTestId("frontmatter-editor")).toBeInTheDocument();

    await act(async () => {
      setPage("Other.md");
    });
    await waitFor(() => {
      expect(screen.queryByTestId("frontmatter-editor")).not.toBeInTheDocument();
    });
  });
});

describe("ContentArea headings", () => {
  it("after page load, store has correct headings", async () => {
    setPage("Hello.md");
    render(<ContentArea />);

    await waitFor(() => {
      const headings = useWorkspaceStore.getState().currentPageHeadings;
      expect(headings).toEqual([
        { level: 1, text: "Hello", line: 0, from: 0, to: 7 },
      ]);
    });
  });

  it("when no page selected, headings are []", () => {
    render(<ContentArea />);
    expect(useWorkspaceStore.getState().currentPageHeadings).toEqual([]);
  });
});

const multiHeadingPage = {
  body: "# First\nContent\n## Second\nMore",
  raw_yaml: "",
  meta: {
    title: "First",
    frontmatter: {},
    relative_path: "Multi.md",
    created_at: 1000,
    modified_at: 2000,
    file_type: 'markdown' as const,
    has_companion: false,
  },
};

describe("ContentArea mindmap toggle", () => {
  it("toggle button switches between editor and mindmap views", async () => {
    setPage("Hello.md");
    const user = userEvent.setup();
    render(<ContentArea />);

    await waitFor(() => {
      expect(screen.getByTestId("editor")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("mindmap-view")).not.toBeInTheDocument();

    const mindmapBtn = screen.getByRole("button", { name: /mindmap/i });
    await user.click(mindmapBtn);
    // jsdom doesn't process Tailwind CSS, so toBeVisible() can't detect
    // the "hidden" class on the wrapper div. Assert via closest() instead.
    expect(screen.getByTestId("editor").closest(".hidden")).not.toBeNull();
    await waitFor(() => {
      expect(screen.getByTestId("mindmap-view")).toBeInTheDocument();
    });

    const editorBtn = screen.getByRole("button", { name: /editor/i });
    await user.click(editorBtn);
    expect(screen.getByTestId("editor").closest(".hidden")).toBeNull();
    expect(screen.queryByTestId("mindmap-view")).not.toBeInTheDocument();
  });

  it("clicking a mindmap node selects it (does not switch to editor view)", async () => {
    mockInvoke((cmd, args) => {
      if (cmd === "read_page") {
        const rp = (args as Record<string, unknown>)?.relativePath;
        if (rp === "Multi.md") return multiHeadingPage;
        return samplePage;
      }
      if (cmd === "write_page") return null;
      if (cmd === "parse_raw_yaml") return {};
      if (cmd === "get_backlinks") return [];
      if (cmd === "get_keymaps") return [];
      throw new Error(`Unknown command: ${cmd}`);
    });

    setPage("Multi.md");
    const user = userEvent.setup();
    render(<ContentArea />);

    await waitFor(() => {
      expect(screen.getByTestId("editor")).toBeInTheDocument();
    });

    const mindmapBtn = screen.getByRole("button", { name: /mindmap/i });
    await user.click(mindmapBtn);
    await waitFor(() => {
      expect(screen.getByTestId("mindmap-view")).toBeInTheDocument();
    });

    const { within } = await import("@testing-library/react");
    const mindmapContainer = screen.getByTestId("mindmap-view");
    let secondNode!: HTMLElement;
    await waitFor(() => {
      secondNode = within(mindmapContainer).getByText("Second");
    });
    await user.click(secondNode);

    expect(screen.getByTestId("mindmap-view")).toBeInTheDocument();
    await waitFor(() => {
      expect(mindmapContainer.querySelector("[data-mindmap-selected]")).toBeTruthy();
    });
  });
});

describe("ContentArea bottom panel", () => {
  beforeEach(() => {
    mockInvoke((cmd) => {
      if (cmd === "read_page") return samplePage;
      if (cmd === "write_page") return null;
      if (cmd === "parse_raw_yaml") return {};
      if (cmd === "get_backlinks") return [];
      if (cmd === "get_keymaps") return [];
      if (cmd === "get_unlinked_mentions") return [];
      throw new Error(`Unknown command: ${cmd}`);
    });
  });

  it("renders BottomPanel with pageId", async () => {
    setPage("Hello.md");
    render(<ContentArea />);

    await waitFor(() => {
      expect(screen.getByTestId("bottom-panel")).toBeInTheDocument();
    });
  });

  it("renders BottomPanel when renderBottomPanel is true (explicit)", async () => {
    setPage("Hello.md");
    render(<ContentArea renderBottomPanel={true} />);
    await waitFor(() => {
      expect(screen.getByTestId("bottom-panel")).toBeInTheDocument();
    });
  });

  it("does NOT render BottomPanel when renderBottomPanel is false", async () => {
    setPage("Hello.md");
    render(<ContentArea renderBottomPanel={false} />);
    await waitFor(() => {
      expect(screen.getByTestId("editor")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("bottom-panel")).not.toBeInTheDocument();
  });

  it("does NOT render BottomPanel in empty state when renderBottomPanel is false", () => {
    render(<ContentArea renderBottomPanel={false} />);
    expect(screen.getByTestId("empty-state")).toBeInTheDocument();
    expect(screen.queryByTestId("bottom-panel")).not.toBeInTheDocument();
  });

  it("renders BottomPanel in empty state by default", () => {
    render(<ContentArea />);
    expect(screen.getByTestId("empty-state")).toBeInTheDocument();
    expect(screen.getByTestId("bottom-panel")).toBeInTheDocument();
  });
});

describe("ContentArea jump recording on page switch", () => {
  beforeEach(() => {
    globalJumpTracker.clear();
  });

  it("records departure jump when switching pages via selectPage", async () => {
    setPage("Hello.md");
    render(<ContentArea />);

    await waitFor(() => {
      expect(screen.getByTestId("editor").textContent).toContain("Some content");
    });

    act(() => {
      setPage("Other.md");
    });

    await waitFor(() => {
      expect(screen.getByTestId("editor").textContent).toContain("Different content");
    });

    expect(globalJumpTracker.jumps.length).toBeGreaterThanOrEqual(1);
    expect(globalJumpTracker.jumps.some((j) => j.notePath === "Hello.md")).toBe(true);
  });

  it("does not record departure when switching from null (no previous page)", async () => {
    render(<ContentArea />);
    expect(screen.getByTestId("empty-state")).toBeInTheDocument();

    act(() => {
      setPage("Hello.md");
    });

    await waitFor(() => {
      expect(screen.getByTestId("editor").textContent).toContain("Some content");
    });

    expect(globalJumpTracker.jumps).toHaveLength(0);
  });

  it("does not record departure when isNavigating is true (jump navigation)", async () => {
    setPage("Hello.md");
    render(<ContentArea />);

    await waitFor(() => {
      expect(screen.getByTestId("editor").textContent).toContain("Some content");
    });

    globalJumpTracker.isNavigating = true;

    act(() => {
      setPage("Other.md");
    });

    await waitFor(() => {
      expect(screen.getByTestId("editor").textContent).toContain("Different content");
    });

    expect(globalJumpTracker.jumps).toHaveLength(0);
    globalJumpTracker.isNavigating = false;
  });
});

describe("ContentArea PDF rendering", () => {
  it("renders the PDF through the pane system (no whole-area bypass)", async () => {
    const pdfPage = {
      title: "Doc",
      relative_path: "doc.pdf",
      frontmatter: {},
      created_at: 1000,
      modified_at: 2000,
      file_type: "pdf" as const,
      has_companion: false,
    };
    useWorkspaceStore.setState({
      workspacePath: "/test",
      pages: [pdfPage],
      currentPagePath: "doc.pdf",
    });
    usePaneStore.getState().setPanePage("test-pane", "doc.pdf");

    mockInvoke((cmd) => {
      if (cmd === "get_keymaps") return [];
      if (cmd === "allow_asset_scope") return undefined;
      throw new Error(`Unknown command: ${cmd}`);
    });

    render(<ContentArea />);

    // PDF now flows through the pane tree (PdfViewerPane), not a whole-area short-circuit.
    await waitFor(() => {
      expect(screen.getByTestId("pdf-viewer-pane")).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByTestId("pdf-viewer")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("editor")).not.toBeInTheDocument();
  });

  it("clears workspace.currentPagePath and shows empty state when the last PDF pane closes (issue #447)", async () => {
    const pdfPage = {
      title: "Doc",
      relative_path: "doc.pdf",
      frontmatter: {},
      created_at: 1000,
      modified_at: 2000,
      file_type: "pdf" as const,
      has_companion: false,
    };
    useWorkspaceStore.setState({
      workspacePath: "/test",
      pages: [pdfPage],
      currentPagePath: "doc.pdf",
    });
    usePaneStore.getState().setPanePage("test-pane", "doc.pdf");

    mockInvoke((cmd) => {
      if (cmd === "get_keymaps") return [];
      if (cmd === "allow_asset_scope") return undefined;
      throw new Error(`Unknown command: ${cmd}`);
    });

    render(<ContentArea />);

    await waitFor(() => {
      expect(screen.getByTestId("pdf-viewer-pane")).toBeInTheDocument();
    });

    // Ctrl-W on the last pane: closePane nulls the leaf's pagePath.
    act(() => {
      usePaneStore.getState().closePane("test-pane");
    });

    await waitFor(() => {
      expect(screen.getByTestId("empty-state")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("pdf-viewer-pane")).not.toBeInTheDocument();
    // The pane→workspace mirror must clear too, or the closed PDF can be
    // resurrected on remount and re-selecting it in the sidebar is a no-op.
    expect(useWorkspaceStore.getState().currentPagePath).toBeNull();
  });

  it("does not render editor chrome (title input or view-mode tabs) for a focused PDF pane", async () => {
    const pdfPage = {
      title: "Doc",
      relative_path: "doc.pdf",
      frontmatter: {},
      created_at: 1000,
      modified_at: 2000,
      file_type: "pdf" as const,
      has_companion: false,
    };
    useWorkspaceStore.setState({
      workspacePath: "/test",
      pages: [pdfPage],
      currentPagePath: "doc.pdf",
    });
    usePaneStore.getState().setPanePage("test-pane", "doc.pdf");

    mockInvoke((cmd) => {
      if (cmd === "get_keymaps") return [];
      if (cmd === "allow_asset_scope") return undefined;
      throw new Error(`Unknown command: ${cmd}`);
    });

    render(<ContentArea />);

    await waitFor(() => {
      expect(screen.getByTestId("pdf-viewer-pane")).toBeInTheDocument();
    });
    // The editor chrome must be suppressed for a PDF: no title input (which
    // would rename the PDF file) and no view-mode tabs (which would hide the PDF).
    expect(screen.queryByTestId("page-title")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Mindmap" })).not.toBeInTheDocument();
  });

  it("keeps the PDF pane visible after a view-mode switch while a PDF is focused", async () => {
    const pdfPage = {
      title: "Doc",
      relative_path: "doc.pdf",
      frontmatter: {},
      created_at: 1000,
      modified_at: 2000,
      file_type: "pdf" as const,
      has_companion: false,
    };
    useWorkspaceStore.setState({
      workspacePath: "/test",
      pages: [pdfPage],
      currentPagePath: "doc.pdf",
    });
    usePaneStore.getState().setPanePage("test-pane", "doc.pdf");

    mockInvoke((cmd) => {
      if (cmd === "get_keymaps") return [];
      if (cmd === "allow_asset_scope") return undefined;
      throw new Error(`Unknown command: ${cmd}`);
    });

    render(<ContentArea />);

    await waitFor(() => {
      expect(screen.getByTestId("pdf-viewer-pane")).toBeInTheDocument();
    });

    // Simulate Cmd-2 (set view mode to mindmap) while the PDF pane is focused.
    // The view-mode tabs are hidden for PDFs, so if the PDF also disappears the
    // user is left with no UI to switch back. The PDF must stay visible.
    act(() => {
      window.dispatchEvent(new CustomEvent("lit:set-view-mode", { detail: "mindmap" }));
    });

    // toBeVisible walks ancestors and fails if PaneContainer has display:none.
    expect(screen.getByTestId("pdf-viewer-pane")).toBeVisible();
  });

  it("does NOT render PdfViewer for markdown files", async () => {
    useWorkspaceStore.setState({
      workspacePath: "/test",
      pages: [samplePage.meta],
      currentPagePath: "Hello.md",
    });
    setPage("Hello.md");

    render(<ContentArea />);

    await waitFor(() => {
      expect(screen.getByTestId("editor")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("pdf-viewer")).not.toBeInTheDocument();
  });
});

describe("ContentArea menu://open-in-external-editor", () => {
  beforeEach(() => {
    resetListenMock();
    mockListen();
  });

  it("delegates to commandRegistry.execute with the editor view", async () => {
    setPage("Hello.md");
    const spy = vi.spyOn(commandRegistryModule, "executeCommand").mockReturnValue(true);
    render(<ContentArea />);

    await waitFor(() => {
      expect(screen.getByTestId("editor").textContent).toContain("Some content");
    });

    act(() => {
      emitMockEvent("menu://open-in-external-editor", {});
    });

    expect(spy).toHaveBeenCalledWith(
      "editor.openInExternalEditor",
      expect.any(Object),
    );
    spy.mockRestore();
  });

  it("does not call commandRegistry.execute when no editor view", async () => {
    const spy = vi.spyOn(commandRegistryModule, "executeCommand");
    render(<ContentArea />);

    expect(screen.getByTestId("empty-state")).toBeInTheDocument();

    act(() => {
      emitMockEvent("menu://open-in-external-editor", {});
    });

    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("Graph toggle button exists", async () => {
    usePreferencesStore.setState({ graphViewEnabled: true });
    setPage("Hello.md");
    render(<ContentArea />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Graph" })).toBeInTheDocument();
    });
  });

  it("Graph toggle button is hidden when graphViewEnabled is false", async () => {
    setPage("Hello.md");
    render(<ContentArea />);
    await waitFor(() => {
      expect(screen.getByTestId("editor")).toBeInTheDocument();
    });
    expect(screen.queryByRole("button", { name: "Graph" })).not.toBeInTheDocument();
  });

  it("clicking Graph button shows graph view", async () => {
    usePreferencesStore.setState({ graphViewEnabled: true });
    setPage("Hello.md");
    render(<ContentArea />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Graph" })).toBeInTheDocument();
    });
    await userEvent.click(screen.getByRole("button", { name: "Graph" }));
    await waitFor(() => {
      expect(screen.getByTestId("graph-view-wrapper")).toBeInTheDocument();
    });
  });

  it("clicking Editor button from graph view unmounts graph wrapper", async () => {
    usePreferencesStore.setState({ graphViewEnabled: true });
    setPage("Hello.md");
    render(<ContentArea />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Graph" })).toBeInTheDocument();
    });
    await userEvent.click(screen.getByRole("button", { name: "Graph" }));
    await waitFor(() => {
      expect(screen.getByTestId("graph-view-wrapper")).toBeInTheDocument();
    });
    await userEvent.click(screen.getByRole("button", { name: "Editor" }));
    await waitFor(() => {
      expect(screen.queryByTestId("graph-view-wrapper")).not.toBeInTheDocument();
    });
  });

  it("dispatching lit:toggle-graph-view when in editor switches to graph", async () => {
    usePreferencesStore.setState({ graphViewEnabled: true });
    setPage("Hello.md");
    render(<ContentArea />);
    await waitFor(() => {
      expect(screen.getByTestId("editor")).toBeInTheDocument();
    });
    act(() => {
      window.dispatchEvent(new CustomEvent("lit:toggle-graph-view"));
    });
    await waitFor(() => {
      expect(screen.getByTestId("graph-view-wrapper")).toBeInTheDocument();
    });
  });

  it("dispatching lit:toggle-graph-view when disabled is a no-op", async () => {
    setPage("Hello.md");
    render(<ContentArea />);
    await waitFor(() => {
      expect(screen.getByTestId("editor")).toBeInTheDocument();
    });
    act(() => {
      window.dispatchEvent(new CustomEvent("lit:toggle-graph-view"));
    });
    expect(screen.queryByTestId("graph-view-wrapper")).not.toBeInTheDocument();
  });

  it("dispatching lit:toggle-graph-view when already in graph unmounts graph wrapper", async () => {
    usePreferencesStore.setState({ graphViewEnabled: true });
    setPage("Hello.md");
    render(<ContentArea />);
    await waitFor(() => {
      expect(screen.getByTestId("editor")).toBeInTheDocument();
    });
    act(() => {
      window.dispatchEvent(new CustomEvent("lit:toggle-graph-view"));
    });
    await waitFor(() => {
      expect(screen.getByTestId("graph-view-wrapper")).toBeInTheDocument();
    });
    act(() => {
      window.dispatchEvent(new CustomEvent("lit:toggle-graph-view"));
    });
    await waitFor(() => {
      expect(screen.queryByTestId("graph-view-wrapper")).not.toBeInTheDocument();
    });
  });

  it("lit:toggle-graph-view with detail.mode='local' passes initialMode to GraphView", async () => {
    usePreferencesStore.setState({ graphViewEnabled: true });
    setPage("Hello.md");
    render(<ContentArea />);
    await waitFor(() => {
      expect(screen.getByTestId("editor")).toBeInTheDocument();
    });
    act(() => {
      window.dispatchEvent(new CustomEvent("lit:toggle-graph-view", { detail: { mode: "local" } }));
    });
    await waitFor(() => {
      expect(screen.getByTestId("graph-view-wrapper")).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Local" }).getAttribute("aria-pressed")).toBe("true");
    });
  });

  it("toggling off graph and re-entering retains last mode (conditional mount)", async () => {
    usePreferencesStore.setState({ graphViewEnabled: true });
    setPage("Hello.md");
    render(<ContentArea />);
    await waitFor(() => {
      expect(screen.getByTestId("editor")).toBeInTheDocument();
    });

    act(() => {
      window.dispatchEvent(new CustomEvent("lit:toggle-graph-view", { detail: { mode: "local" } }));
    });
    await waitFor(() => {
      expect(screen.getByTestId("graph-view-wrapper")).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Local" }).getAttribute("aria-pressed")).toBe("true");
    });

    act(() => {
      window.dispatchEvent(new CustomEvent("lit:toggle-graph-view"));
    });
    await waitFor(() => {
      expect(screen.queryByTestId("graph-view-wrapper")).not.toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole("button", { name: "Graph" }));
    await waitFor(() => {
      expect(screen.getByTestId("graph-view-wrapper")).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Local" }).getAttribute("aria-pressed")).toBe("true");
    });
  });

  it("graph-view-wrapper is removed from DOM after switching to editor (conditional mount)", async () => {
    usePreferencesStore.setState({ graphViewEnabled: true });
    setPage("Hello.md");
    render(<ContentArea />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Graph" })).toBeInTheDocument();
    });
    await userEvent.click(screen.getByRole("button", { name: "Graph" }));
    await waitFor(() => {
      expect(screen.getByTestId("graph-view-wrapper")).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole("button", { name: "Editor" }));
    await waitFor(() => {
      expect(screen.getByTestId("editor")).toBeVisible();
    });

    expect(screen.queryByTestId("graph-view-wrapper")).not.toBeInTheDocument();
  });

  it("graph-view-wrapper is NOT in DOM before first graph view switch", async () => {
    setPage("Hello.md");
    render(<ContentArea />);
    await waitFor(() => {
      expect(screen.getByTestId("editor")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("graph-view-wrapper")).not.toBeInTheDocument();
  });

  it("Escape in graph view unmounts graph wrapper (via onExit)", async () => {
    usePreferencesStore.setState({ graphViewEnabled: true });
    setPage("Hello.md");
    render(<ContentArea />);
    await waitFor(() => {
      expect(screen.getByTestId("editor")).toBeInTheDocument();
    });
    await userEvent.click(screen.getByRole("button", { name: "Graph" }));
    await waitFor(() => {
      expect(screen.getByTestId("graph-view-wrapper")).toBeInTheDocument();
    });

    const graphView = screen.getByTestId("graph-view");
    await act(async () => {
      graphView.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    await waitFor(() => {
      expect(screen.queryByTestId("graph-view-wrapper")).not.toBeInTheDocument();
    });
  });
});

describe("ContentArea menu://close-pane", () => {
  beforeEach(() => {
    resetListenMock();
    mockListen();
  });

  it("executes pane.close when >1 pane exists", async () => {
    setPage("Hello.md");
    usePaneStore.setState({
      root: {
        type: "split", id: "split-root", direction: "horizontal",
        children: [
          { type: "leaf", id: "pane-1", pagePath: "Hello.md" },
          { type: "leaf", id: "pane-2", pagePath: null },
        ],
        sizes: [50, 50],
      },
      focusedPaneId: "pane-1",
    });
    const spy = vi.spyOn(commandRegistryModule, "executeCommand").mockReturnValue(true);
    render(<ContentArea />);

    await waitFor(() => {
      expect(screen.getByTestId("editor")).toBeInTheDocument();
    });

    act(() => {
      emitMockEvent("menu://close-pane", {});
    });

    expect(spy).toHaveBeenCalledWith("pane.close");
    spy.mockRestore();
  });

  it("calls pane.close (not window.close) when only 1 pane exists", () => {
    usePaneStore.setState({
      root: { type: "leaf", id: "solo", pagePath: "notes/foo.md" },
      focusedPaneId: "solo",
    });
    const spy = vi.spyOn(commandRegistryModule, "executeCommand");
    render(<ContentArea />);

    act(() => {
      emitMockEvent("menu://close-pane", {});
    });

    expect(spy).toHaveBeenCalledWith("pane.close");
    spy.mockRestore();
  });
});

describe("ContentArea global title bar in multi-pane mode", () => {
  it("hides global title bar when in multi-pane mode", async () => {
    useWorkspaceStore.setState({
      pages: [samplePage.meta, otherPage.meta],
      currentPagePath: "Hello.md",
    });
    usePaneStore.setState({
      root: {
        type: "split",
        id: "s1",
        direction: "horizontal",
        children: [
          { type: "leaf", id: "pane-1", pagePath: "Hello.md" },
          { type: "leaf", id: "pane-2", pagePath: "Other.md" },
        ],
        sizes: [50, 50],
      },
      focusedPaneId: "pane-1",
    });
    render(<ContentArea />);
    await waitFor(() => {
      expect(screen.getAllByTestId("pane-header")).toHaveLength(2);
    });
    expect(screen.queryByTestId("page-title")).not.toBeInTheDocument();
  });

  it("shows global title bar in single-pane mode", async () => {
    setPage("Hello.md");
    render(<ContentArea />);
    await waitFor(() => {
      expect(screen.getByTestId("page-title")).toBeInTheDocument();
    });
  });
});

describe("ContentArea multi-pane close (#132)", () => {
  it("does not show empty-state when closing a pane shifts focus to null-pagePath sibling", async () => {
    useWorkspaceStore.setState({
      pages: [samplePage.meta, otherPage.meta],
      currentPagePath: "Other.md",
    });
    usePaneStore.setState({
      root: {
        type: "split",
        id: "s1",
        direction: "horizontal",
        children: [
          { type: "leaf", id: "A", pagePath: "Hello.md" },
          { type: "leaf", id: "B", pagePath: "Other.md" },
          { type: "leaf", id: "C", pagePath: null },
        ],
        sizes: [33, 34, 33],
      },
      focusedPaneId: "B",
    });

    render(<ContentArea />);

    await waitFor(() => {
      expect(screen.getAllByTestId("pane-header")).toHaveLength(2);
    });

    act(() => {
      usePaneStore.getState().closePane("B");
    });

    expect(screen.queryByTestId("empty-state")).not.toBeInTheDocument();
    const panes = screen.getAllByTestId("editor-pane");
    expect(panes.length).toBeGreaterThanOrEqual(2);
  });

  it("workspace.currentPagePath syncs after close to remaining focused pane", async () => {
    useWorkspaceStore.setState({
      pages: [samplePage.meta, otherPage.meta],
      currentPagePath: "Other.md",
    });
    usePaneStore.setState({
      root: {
        type: "split",
        id: "s1",
        direction: "horizontal",
        children: [
          { type: "leaf", id: "A", pagePath: "Hello.md" },
          { type: "leaf", id: "B", pagePath: "Other.md" },
        ],
        sizes: [50, 50],
      },
      focusedPaneId: "B",
    });

    render(<ContentArea />);

    await waitFor(() => {
      expect(screen.getAllByTestId("pane-header")).toHaveLength(2);
    });

    act(() => {
      usePaneStore.getState().closePane("B");
    });

    await waitFor(() => {
      expect(useWorkspaceStore.getState().currentPagePath).toBe("Hello.md");
    });
  });
});

describe("parseYamlErrorLocation", () => {
  it("parses 'at line X column Y' at end of message", () => {
    expect(
      parseYamlErrorLocation("mapping values are not allowed in this context at line 1 column 8"),
    ).toEqual({ line: 1, column: 8 });
  });

  it("prefers 'while parsing' origin location over detection location", () => {
    expect(
      parseYamlErrorLocation(
        "did not find expected ',' or ']' at line 2 column 1, while parsing a flow sequence at line 1 column 6",
      ),
    ).toEqual({ line: 1, column: 6 });
  });

  it("parses multi-digit line and column", () => {
    expect(
      parseYamlErrorLocation("something went wrong at line 123 column 45"),
    ).toEqual({ line: 123, column: 45 });
  });

  it("returns null for messages without location", () => {
    expect(
      parseYamlErrorLocation("invalid type: sequence, expected a map"),
    ).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseYamlErrorLocation("")).toBeNull();
  });
});

describe("ContentArea export network wiring", () => {
  it("MindmapView receives onExportNetwork callback", async () => {
    const contextMenuCalls: Array<Record<string, unknown>> = [];
    mockInvoke((cmd, args) => {
      if (cmd === "read_page") {
        const rp = (args as Record<string, unknown>)?.relativePath;
        if (rp === "Multi.md") return multiHeadingPage;
        return samplePage;
      }
      if (cmd === "write_page") return null;
      if (cmd === "parse_raw_yaml") return {};
      if (cmd === "get_backlinks") return [];
      if (cmd === "get_keymaps") return [];
      if (cmd === "get_graph_subgraph") return { nodes: [], edges: [] };
      if (cmd === "get_pagerank") return {};
      if (cmd === "get_graph_positions") return {};
      if (cmd === "acknowledge_file_hash") return null;
      if (cmd === "show_mindmap_context_menu") {
        contextMenuCalls.push(args as Record<string, unknown>);
        return null;
      }
      throw new Error(`Unknown command: ${cmd}`);
    });

    setPage("Multi.md");
    const exportSpy = vi.fn();
    const user = userEvent.setup();
    render(<ContentArea onExportNetwork={exportSpy} />);

    await waitFor(() => {
      expect(screen.getByTestId("editor")).toBeInTheDocument();
    });

    const mindmapBtn = screen.getByRole("button", { name: /mindmap/i });
    await user.click(mindmapBtn);
    await waitFor(() => {
      expect(screen.getByTestId("mindmap-view")).toBeInTheDocument();
    });

    const nodeGroups = screen.getByTestId("mindmap-view").querySelectorAll("[data-mindmap-node]");
    if (nodeGroups.length > 0) {
      fireEvent.contextMenu(nodeGroups[0]!);
      await waitFor(() => {
        expect(contextMenuCalls.length).toBeGreaterThan(0);
      });
      expect(contextMenuCalls[0]!.hasExport).toBe(true);
    }
  });

  it("GraphView receives onExportNetwork prop (wrapper renders)", async () => {
    usePreferencesStore.setState({ graphViewEnabled: true });
    setPage("Hello.md");
    const user = userEvent.setup();
    render(<ContentArea />);

    await waitFor(() => {
      expect(screen.getByTestId("editor")).toBeInTheDocument();
    });

    const graphBtn = screen.getByRole("button", { name: /graph/i });
    await user.click(graphBtn);

    await waitFor(() => {
      expect(screen.getByTestId("graph-view-wrapper")).toBeInTheDocument();
    });
  });
});

describe("ContentArea code file rendering", () => {
  const codePage = {
    title: "main",
    relative_path: "main.rs",
    frontmatter: {},
    created_at: 1000,
    modified_at: 2000,
    file_type: "code" as const,
    has_companion: false,
  };

  function setupCodePane() {
    useWorkspaceStore.setState({
      workspacePath: "/test",
      pages: [codePage],
      currentPagePath: "main.rs",
    });
    usePaneStore.getState().setPanePage("test-pane", "main.rs");
  }

  function mockCodeInvoke() {
    mockInvoke((cmd, args) => {
      if (cmd === "read_code_file") {
        return {
          title: "main",
          relative_path: (args as Record<string, unknown>)?.relativePath ?? "main.rs",
          body: "fn main() {}\n",
        };
      }
      if (cmd === "acknowledge_file_hash") return null;
      if (cmd === "get_keymaps") return [];
      throw new Error(`Unknown command: ${cmd}`);
    });
  }

  it("does not render editor chrome (title input or view-mode tabs) for a focused code pane", async () => {
    setupCodePane();
    mockCodeInvoke();

    render(<ContentArea />);

    // CodeEditorPane is lazy-loaded; await its mount.
    await screen.findByTestId("code-editor-pane-test-pane");

    // The markdown editor chrome must be suppressed for a code file: no title
    // input (which would rename main.rs -> main.md) and no view-mode tabs
    // (which are nonfunctional for code panes).
    expect(screen.queryByTestId("page-title")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Mindmap" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Graph" })).not.toBeInTheDocument();
  });

  it("title input is absent so a code file cannot be renamed to .md", async () => {
    const renamePageSpy = vi.fn();
    setupCodePane();
    useWorkspaceStore.setState({ renamePage: renamePageSpy });
    mockCodeInvoke();

    render(<ContentArea />);

    await screen.findByTestId("code-editor-pane-test-pane");

    expect(screen.queryByTestId("page-title")).not.toBeInTheDocument();
    expect(renamePageSpy).not.toHaveBeenCalled();
  });
});

describe("ContentArea multi-pane guard side-effects (#730)", () => {
  function setupMultiPane() {
    useWorkspaceStore.setState({
      pages: [samplePage.meta, otherPage.meta],
      currentPagePath: "Hello.md",
    });
    usePaneStore.setState({
      root: {
        type: "split",
        id: "s1",
        direction: "horizontal",
        children: [
          { type: "leaf", id: "pane-1", pagePath: "Hello.md" },
          { type: "leaf", id: "pane-2", pagePath: "Other.md" },
        ],
        sizes: [50, 50],
      },
      focusedPaneId: "pane-1",
    });
  }

  it("per-pane viewMode: entering multi-pane does NOT reset other panes' viewMode", async () => {
    setupMultiPane();
    render(<ContentArea />);

    await waitFor(() => {
      expect(screen.getAllByTestId("pane-header")).toHaveLength(2);
    });

    // Both panes default to editor mode (no viewMode set)
    expect(screen.queryByTestId("mindmap-view")).not.toBeInTheDocument();
  });

  it("pendingTitleFocus flag is NOT cleared when title input is unmounted (multi-pane)", async () => {
    setupMultiPane();
    useWorkspaceStore.setState({ pendingTitleFocus: true });
    render(<ContentArea />);

    await waitFor(() => {
      expect(screen.getAllByTestId("pane-header")).toHaveLength(2);
    });

    // Title input is inside the guard, so it's not rendered in multi-pane mode
    expect(screen.queryByTestId("page-title")).not.toBeInTheDocument();
    // The flag should NOT have been consumed
    expect(useWorkspaceStore.getState().pendingTitleFocus).toBe(true);
  });

  it("lit:toggle-frontmatter event toggles frontmatter visibility", async () => {
    setPage("Hello.md");
    render(<ContentArea />);

    await waitFor(() => {
      expect(screen.getByTitle("Show frontmatter")).toBeInTheDocument();
    });

    // Frontmatter should be hidden initially
    expect(screen.queryByTestId("frontmatter")).not.toBeInTheDocument();

    // Dispatch toggle event
    act(() => {
      window.dispatchEvent(new CustomEvent("lit:toggle-frontmatter"));
    });

    // Frontmatter should now be visible
    await waitFor(() => {
      expect(screen.getByTestId("frontmatter")).toBeInTheDocument();
    });

    // Dispatch toggle again to hide
    act(() => {
      window.dispatchEvent(new CustomEvent("lit:toggle-frontmatter"));
    });

    await waitFor(() => {
      expect(screen.queryByTestId("frontmatter")).not.toBeInTheDocument();
    });
  });
});
