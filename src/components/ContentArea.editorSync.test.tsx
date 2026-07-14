import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ContentArea } from "./ContentArea";
import { mockInvoke } from "../test/tauri-mock";
import { useWorkspaceStore } from "../stores/workspace";
import { usePaneStore } from "../stores/panes";
import { usePreferencesStore } from "../stores/preferences";
import { _resetForTesting as resetRegistry } from "../lib/paneContentRegistry";
import { _resetForTesting as resetEditorViewRef } from "../lib/editorViewRef";

// This file holds the only ContentArea tests that reach into a real,
// unmocked CodeMirror EditorView (via EditorView.findFromDOM) to dispatch
// live transactions and verify mindmap/editor selection sync. Everything
// else in ContentArea.test.tsx mocks CodeMirrorEditor out to keep the full
// "ui" vitest project from piling up real CM instances across ~86 tests.

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

beforeEach(() => {
  // jsdom has no real canvas; stub getContext for PdfViewer's canvas rendering
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({})) as unknown as typeof HTMLCanvasElement.prototype.getContext;
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
      if (rp === "Multi.md") return multiHeadingPage;
      return samplePage;
    }
    if (cmd === "write_page") return null;
    if (cmd === "parse_raw_yaml") return {};
    if (cmd === "get_backlinks") return [];
    if (cmd === "get_keymaps") return [];
    throw new Error(`Unknown command: ${cmd}`);
  });
});

function setPage(path: string) {
  usePaneStore.getState().setPanePage("test-pane", path);
  useWorkspaceStore.setState({ currentPagePath: path });
}

describe("ContentArea mindmap selection persistence", () => {
  it("selection persists when body changes and selected node still exists", async () => {
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
  it("dispatching lit:scroll-to-line selects corresponding mindmap node", async () => {
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
