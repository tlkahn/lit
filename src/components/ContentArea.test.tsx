import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, act, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ContentArea, parseYamlErrorLocation } from "./ContentArea";
import { mockInvoke, mockListen, emitMockEvent, resetListenMock } from "../test/tauri-mock";
import { useWorkspaceStore } from "../stores/workspace";
import { usePaneStore } from "../stores/panes";
import { usePreferencesStore } from "../stores/preferences";
import { _resetForTesting as resetRegistry } from "../lib/paneContentRegistry";
import { _resetForTesting as resetEditorViewRef } from "../lib/editorViewRef";
import * as commandRegistryModule from "../lib/commandRegistry";

vi.mock("sigma", () => ({
  default: class MockSigma {
    kill = vi.fn();
    on = vi.fn();
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
  },
};

let writePageCalls: Array<{ path: string; body: string }> = [];

beforeEach(() => {
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
  usePreferencesStore.setState({ defaultViewMode: "editor" });
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
    expect(screen.getByTestId("editor")).not.toBeVisible();
    await waitFor(() => {
      expect(screen.getByTestId("mindmap-view")).toBeInTheDocument();
    });

    const editorBtn = screen.getByRole("button", { name: /editor/i });
    await user.click(editorBtn);
    expect(screen.getByTestId("editor")).toBeVisible();
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

describe("ContentArea mindmap selection persistence", () => {
  function setupMultiHeadingMock() {
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
  }

  it("selection persists when body changes and selected node still exists", async () => {
    setupMultiHeadingMock();
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

    await waitFor(() => {
      expect(mindmapContainer.querySelector("[data-mindmap-selected]")).toBeTruthy();
    });

    const cmEditor = screen.getByTestId("editor").querySelector(".cm-editor");
    const { EditorView } = await import("@codemirror/view");
    const view = EditorView.findFromDOM(cmEditor as HTMLElement)!;

    act(() => {
      view.dispatch({
        changes: { from: view.state.doc.length, insert: "\n## Third\nNew content" },
      });
    });

    await waitFor(() => {
      expect(mindmapContainer.querySelector("[data-mindmap-selected]")).toBeTruthy();
    });
  });

  it("selection clears when selected node is removed from body", async () => {
    setupMultiHeadingMock();
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

    await waitFor(() => {
      expect(mindmapContainer.querySelector("[data-mindmap-selected]")).toBeTruthy();
    });

    const cmEditor = screen.getByTestId("editor").querySelector(".cm-editor");
    const { EditorView } = await import("@codemirror/view");
    const view = EditorView.findFromDOM(cmEditor as HTMLElement)!;

    const secondStart = view.state.doc.toString().indexOf("## Second");
    act(() => {
      view.dispatch({
        changes: { from: secondStart, to: view.state.doc.length },
      });
    });

    await waitFor(() => {
      expect(mindmapContainer.querySelector("[data-mindmap-selected]")).toBeFalsy();
    });
  });
});

describe("ContentArea outline-to-mindmap selection", () => {
  function setupMultiHeadingMock() {
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
  }

  it("dispatching lit:scroll-to-line selects corresponding mindmap node", async () => {
    setupMultiHeadingMock();
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

    act(() => {
      window.dispatchEvent(
        new CustomEvent("lit:scroll-to-line", { detail: { line: 2 } }),
      );
    });

    const mindmapContainer = screen.getByTestId("mindmap-view");
    await waitFor(() => {
      expect(mindmapContainer.querySelector('[data-mindmap-node="h-2"][data-mindmap-selected]')).toBeTruthy();
    });
  });

  it("dispatching lit:scroll-to-line with nonexistent line does not select any node", async () => {
    setupMultiHeadingMock();
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

    act(() => {
      window.dispatchEvent(
        new CustomEvent("lit:scroll-to-line", { detail: { line: 999 } }),
      );
    });

    const mindmapContainer = screen.getByTestId("mindmap-view");
    expect(mindmapContainer.querySelector("[data-mindmap-selected]")).toBeFalsy();
  });

  it("dispatching lit:scroll-to-line in editor mode does NOT affect mindmap", async () => {
    setupMultiHeadingMock();
    setPage("Multi.md");
    render(<ContentArea />);

    await waitFor(() => {
      expect(screen.getByTestId("editor")).toBeInTheDocument();
    });

    act(() => {
      window.dispatchEvent(
        new CustomEvent("lit:scroll-to-line", { detail: { line: 2 } }),
      );
    });

    expect(screen.queryByTestId("mindmap-view")).not.toBeInTheDocument();
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
    };
    useWorkspaceStore.setState({
      workspacePath: "/test",
      pages: [pdfPage],
      currentPagePath: "doc.pdf",
    });
    usePaneStore.getState().setPanePage("test-pane", "doc.pdf");

    mockInvoke((cmd, args) => {
      if (cmd === "pdf_open") return { page_count: 2, path: (args as Record<string, unknown>)?.path ?? "" };
      if (cmd === "pdf_render_page") {
        const idx = (args as Record<string, unknown>)?.pageIndex ?? 0;
        return { page_index: idx, png_path: `/tmp/lit-pdf/page_${idx}.png`, width: 100, height: 200 };
      }
      if (cmd === "pdf_prefetch") return null;
      if (cmd === "pdf_close") return null;
      if (cmd === "get_keymaps") return [];
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

  it("does not render editor chrome (title input or view-mode tabs) for a focused PDF pane", async () => {
    const pdfPage = {
      title: "Doc",
      relative_path: "doc.pdf",
      frontmatter: {},
      created_at: 1000,
      modified_at: 2000,
      file_type: "pdf" as const,
    };
    useWorkspaceStore.setState({
      workspacePath: "/test",
      pages: [pdfPage],
      currentPagePath: "doc.pdf",
    });
    usePaneStore.getState().setPanePage("test-pane", "doc.pdf");

    mockInvoke((cmd, args) => {
      if (cmd === "pdf_open") return { page_count: 2, path: (args as Record<string, unknown>)?.path ?? "" };
      if (cmd === "pdf_render_page") {
        const idx = (args as Record<string, unknown>)?.pageIndex ?? 0;
        return { page_index: idx, png_path: `/tmp/lit-pdf/page_${idx}.png`, width: 100, height: 200 };
      }
      if (cmd === "pdf_prefetch") return null;
      if (cmd === "pdf_close") return null;
      if (cmd === "get_keymaps") return [];
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
    };
    useWorkspaceStore.setState({
      workspacePath: "/test",
      pages: [pdfPage],
      currentPagePath: "doc.pdf",
    });
    usePaneStore.getState().setPanePage("test-pane", "doc.pdf");

    mockInvoke((cmd, args) => {
      if (cmd === "pdf_open") return { page_count: 2, path: (args as Record<string, unknown>)?.path ?? "" };
      if (cmd === "pdf_render_page") {
        const idx = (args as Record<string, unknown>)?.pageIndex ?? 0;
        return { page_index: idx, png_path: `/tmp/lit-pdf/page_${idx}.png`, width: 100, height: 200 };
      }
      if (cmd === "pdf_prefetch") return null;
      if (cmd === "pdf_close") return null;
      if (cmd === "get_keymaps") return [];
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
    setPage("Hello.md");
    render(<ContentArea />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Graph" })).toBeInTheDocument();
    });
  });

  it("clicking Graph button shows graph view", async () => {
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

  it("dispatching lit:toggle-graph-view when already in graph unmounts graph wrapper", async () => {
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
      expect(screen.getByTestId("page-title")).toBeInTheDocument();
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
      expect(screen.getByTestId("page-title")).toBeInTheDocument();
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

    const { container } = render(<ContentArea />);
    await user.click(screen.getAllByRole("button", { name: /mindmap/i })[0]!);
    await waitFor(() => {
      expect(screen.getAllByTestId("mindmap-view").length).toBeGreaterThan(0);
    });

    const nodeGroups = container.querySelectorAll("[data-mindmap-node]");
    if (nodeGroups.length > 0) {
      fireEvent.contextMenu(nodeGroups[0]!);
      const exportBtn = container.querySelector("[data-mindmap-context-export]");
      expect(exportBtn).toBeTruthy();
    }
  });

  it("GraphView receives onExportNetwork prop (wrapper renders)", async () => {
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
