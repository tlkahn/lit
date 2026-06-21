import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, act, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { mockInvoke } from "../test/tauri-mock";
import { StatusBar } from "./StatusBar";
import { PdfViewer } from "./PdfViewer";
import { useWorkspaceStore } from "../stores/workspace";
import { usePaneStore } from "../stores/panes";
import { useCursorInfoStore } from "../stores/cursorInfo";
import { useBottomPanelStore, defaultTabMeta } from "../stores/bottomPanel";
import { usePreferencesStore } from "../stores/preferences";
import { useStatusMessageStore } from "../stores/statusMessage";
import { usePanePdfLinkStore } from "../stores/panePdfLink";
import * as pdfPaneRef from "../lib/pdfPaneRef";

// ---------------------------------------------------------------------------
// Mock pdfjs for the real PdfViewer integration test
// ---------------------------------------------------------------------------
const mockPdjsRender = vi.fn(() => ({ promise: Promise.resolve(), cancel: vi.fn() }));
const mockPdjsGetViewport = vi.fn(() => ({ width: 1224, height: 1584 }));
const mockPdjsGetTextContent = vi.fn(() => Promise.resolve({ items: [], styles: {}, lang: null }));
const mockPdjsGetAnnotations = vi.fn(() => Promise.resolve([] as object[]));
const mockPdjsGetPage = vi.fn(() =>
  Promise.resolve({ getViewport: mockPdjsGetViewport, render: mockPdjsRender, getTextContent: mockPdjsGetTextContent, getAnnotations: mockPdjsGetAnnotations }),
);
const mockPdjsDestroy = vi.fn();
const mockPdjsDoc = { numPages: 3, getPage: mockPdjsGetPage, destroy: mockPdjsDestroy };
const mockLoadDocument = vi.fn(() => Promise.resolve(mockPdjsDoc));

vi.mock("../lib/pdfjs", () => ({
  loadDocument: (...args: unknown[]) => (mockLoadDocument as (...a: unknown[]) => unknown)(...args),
  TextLayer: class { render() { return Promise.resolve(); } cancel() {} },
  AnnotationLayer: class { render() { return Promise.resolve(); } },
  setLayerDimensions: () => {},
}));

beforeEach(() => {
  // jsdom has no real canvas; stub getContext for PdfViewer's canvas rendering
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({})) as unknown as typeof HTMLCanvasElement.prototype.getContext;
  mockLoadDocument.mockReset();
  mockLoadDocument.mockImplementation(() => Promise.resolve(mockPdjsDoc));
  mockPdjsGetPage.mockReset();
  mockPdjsGetTextContent.mockReset();
  mockPdjsGetTextContent.mockReturnValue(Promise.resolve({ items: [], styles: {}, lang: null }));
  mockPdjsGetAnnotations.mockReset();
  mockPdjsGetAnnotations.mockReturnValue(Promise.resolve([] as object[]));
  mockPdjsGetPage.mockImplementation(() =>
    Promise.resolve({ getViewport: mockPdjsGetViewport, render: mockPdjsRender, getTextContent: mockPdjsGetTextContent, getAnnotations: mockPdjsGetAnnotations }),
  );
  mockPdjsRender.mockReset();
  mockPdjsRender.mockReturnValue({ promise: Promise.resolve(), cancel: vi.fn() });
  mockPdjsDestroy.mockReset();
  useWorkspaceStore.setState({
    workspacePath: null,
    graphReady: false,
    indexProgress: null,
  });
  usePaneStore.setState({
    root: { type: "leaf", id: "p1", pagePath: null },
    focusedPaneId: "p1",
  });
  useCursorInfoStore.setState({ line: 0, col: 0 });
  useBottomPanelStore.setState({
    activeTab: "linked",
    unfolded: false,
    panelHeight: 200,
    tabMeta: defaultTabMeta(),
  });
  usePreferencesStore.setState({
    experimentalUnlinkedReferences: true,
    annotationEnabled: true,
  });
  useStatusMessageStore.setState({ message: null, variant: "success" });
  usePanePdfLinkStore.setState({ links: new Map(), currentPage: new Map(), pageCount: new Map() });
  pdfPaneRef._resetForTesting();
});

describe("StatusBar", () => {
  it("renders status bar with no buffer label when graphReady but no pagePath", () => {
    useWorkspaceStore.setState({ workspacePath: "/test", graphReady: true });
    usePaneStore.setState({
      root: { type: "leaf", id: "p1", pagePath: null },
      focusedPaneId: "p1",
    });
    render(<StatusBar />);
    expect(screen.getByTestId("status-bar")).toBeInTheDocument();
    expect(screen.queryByTestId("buffer-stack-label")).toBeNull();
  });

  it("renders nothing when workspacePath is null", () => {
    useWorkspaceStore.setState({ workspacePath: null, graphReady: false });
    const { container } = render(<StatusBar />);
    expect(container.innerHTML).toBe("");
  });

  it("shows status bar when graphReady is false and workspacePath is set", () => {
    useWorkspaceStore.setState({ workspacePath: "/test", graphReady: false });
    render(<StatusBar />);
    expect(screen.getByTestId("status-bar")).toBeInTheDocument();
  });

  it("shows phase label from indexProgress", () => {
    useWorkspaceStore.setState({
      workspacePath: "/test",
      graphReady: false,
      indexProgress: { phase: "parsing", current: 3, total: 10 },
    });
    render(<StatusBar />);
    expect(screen.getByTestId("status-bar")).toHaveTextContent("Parsing pages...");
  });

  it("shows Initializing when indexProgress is null", () => {
    useWorkspaceStore.setState({
      workspacePath: "/test",
      graphReady: false,
      indexProgress: null,
    });
    render(<StatusBar />);
    expect(screen.getByTestId("status-bar")).toHaveTextContent("Initializing...");
  });

  it("shows Resolving links phase label", () => {
    useWorkspaceStore.setState({
      workspacePath: "/test",
      graphReady: false,
      indexProgress: { phase: "resolving", current: 5, total: 10 },
    });
    render(<StatusBar />);
    expect(screen.getByTestId("status-bar")).toHaveTextContent("Resolving links...");
  });

  it("shows Checking for changes phase label", () => {
    useWorkspaceStore.setState({
      workspacePath: "/test",
      graphReady: false,
      indexProgress: { phase: "diffing", current: 2, total: 8 },
    });
    render(<StatusBar />);
    expect(screen.getByTestId("status-bar")).toHaveTextContent("Checking for changes...");
  });

  it("shows progress bar with correct width", () => {
    useWorkspaceStore.setState({
      workspacePath: "/test",
      graphReady: false,
      indexProgress: { phase: "parsing", current: 3, total: 10 },
    });
    render(<StatusBar />);
    const fill = screen.getByTestId("status-bar-fill");
    expect(fill.style.width).toBe("30%");
  });

  it("shows animate-pulse when total is 0", () => {
    useWorkspaceStore.setState({
      workspacePath: "/test",
      graphReady: false,
      indexProgress: { phase: "building", current: 0, total: 0 },
    });
    render(<StatusBar />);
    const fill = screen.getByTestId("status-bar-fill");
    expect(fill.className).toContain("animate-pulse");
  });

  it("shows file path via BufferStack when graphReady and pane has pagePath", () => {
    useWorkspaceStore.setState({ workspacePath: "/test", graphReady: true });
    usePaneStore.setState({
      root: { type: "leaf", id: "p1", pagePath: "notes/hello.md" },
      focusedPaneId: "p1",
    });
    render(<StatusBar />);
    expect(screen.getByTestId("buffer-stack-label")).toHaveTextContent("notes/hello.md");
  });

  it("shows cursor position Ln X, Col Y", () => {
    useWorkspaceStore.setState({ workspacePath: "/test", graphReady: true });
    usePaneStore.setState({
      root: { type: "leaf", id: "p1", pagePath: "notes/hello.md" },
      focusedPaneId: "p1",
    });
    useCursorInfoStore.setState({ line: 5, col: 10 });
    render(<StatusBar />);
    expect(screen.getByTestId("status-bar-cursor")).toHaveTextContent("Ln 5, Col 10");
  });

  it("hides cursor position when line is 0", () => {
    useWorkspaceStore.setState({ workspacePath: "/test", graphReady: true });
    usePaneStore.setState({
      root: { type: "leaf", id: "p1", pagePath: "notes/hello.md" },
      focusedPaneId: "p1",
    });
    useCursorInfoStore.setState({ line: 0, col: 0 });
    render(<StatusBar />);
    expect(screen.getByTestId("buffer-stack-label")).toBeInTheDocument();
    expect(screen.queryByTestId("status-bar-cursor")).toBeNull();
  });

  it("still shows indexing progress when graphReady is false", () => {
    useWorkspaceStore.setState({
      workspacePath: "/test",
      graphReady: false,
      indexProgress: { phase: "scanning", current: 1, total: 5 },
    });
    render(<StatusBar />);
    expect(screen.getByTestId("status-bar")).toHaveTextContent("Scanning files...");
  });

  it("shows buffer chip with count for multiple open panes", () => {
    useWorkspaceStore.setState({ workspacePath: "/test", graphReady: true });
    usePaneStore.setState({
      root: {
        type: "split",
        id: "s1",
        direction: "horizontal",
        children: [
          { type: "leaf", id: "p1", pagePath: "notes/foo.md" },
          { type: "leaf", id: "p2", pagePath: "notes/bar.md" },
        ],
        sizes: [50, 50],
      },
      focusedPaneId: "p1",
    });
    render(<StatusBar />);
    expect(screen.getByTestId("buffer-stack-chip")).toBeInTheDocument();
    expect(screen.getByTestId("buffer-stack-count")).toHaveTextContent("(+1)");
  });

  it("hides BufferStack during indexing even when pagePath is set", () => {
    useWorkspaceStore.setState({
      workspacePath: "/test",
      graphReady: false,
      indexProgress: { phase: "parsing", current: 3, total: 10 },
    });
    usePaneStore.setState({
      root: { type: "leaf", id: "p1", pagePath: "notes/hello.md" },
      focusedPaneId: "p1",
    });
    render(<StatusBar />);
    expect(screen.queryByTestId("buffer-stack-label")).toBeNull();
    expect(screen.queryByTestId("buffer-stack-chip")).toBeNull();
  });

  describe("BottomPanelTabs", () => {
    it("tab buttons appear when graphReady and page is open", () => {
      useWorkspaceStore.setState({ workspacePath: "/test", graphReady: true });
      usePaneStore.setState({
        root: { type: "leaf", id: "p1", pagePath: "notes/hello.md" },
        focusedPaneId: "p1",
      });
      render(<StatusBar />);
      expect(screen.getByTestId("bottom-panel-tabs")).toBeInTheDocument();
      expect(screen.getByTestId("tab-linked")).toBeInTheDocument();
    });

    it("renders no tabs when no page is open", () => {
      useWorkspaceStore.setState({ workspacePath: "/test", graphReady: true });
      usePaneStore.setState({
        root: { type: "leaf", id: "p1", pagePath: null },
        focusedPaneId: "p1",
      });
      render(<StatusBar />);
      expect(screen.getByTestId("bottom-panel-tabs")).toBeInTheDocument();
      expect(screen.queryByTestId("tab-linked")).toBeNull();
      expect(screen.queryByTestId("tab-outgoing")).toBeNull();
      expect(screen.queryByTestId("tab-unlinked")).toBeNull();
      expect(screen.queryByTestId("tab-annotations")).toBeNull();
      expect(screen.queryByTestId("tab-llm-response")).toBeNull();
    });

    it("tab buttons hidden during indexing", () => {
      useWorkspaceStore.setState({
        workspacePath: "/test",
        graphReady: false,
        indexProgress: { phase: "parsing", current: 3, total: 10 },
      });
      usePaneStore.setState({
        root: { type: "leaf", id: "p1", pagePath: "notes/hello.md" },
        focusedPaneId: "p1",
      });
      render(<StatusBar />);
      expect(screen.queryByTestId("bottom-panel-tabs")).toBeNull();
    });

    it("clicking a tab unfolds the panel", async () => {
      useWorkspaceStore.setState({ workspacePath: "/test", graphReady: true });
      usePaneStore.setState({
        root: { type: "leaf", id: "p1", pagePath: "notes/hello.md" },
        focusedPaneId: "p1",
      });
      render(<StatusBar />);
      const tab = screen.getByTestId("tab-linked");
      await userEvent.click(tab);
      const state = useBottomPanelStore.getState();
      expect(state.unfolded).toBe(true);
      expect(state.activeTab).toBe("linked");
    });

    it("shows count in button text when linkedCount is set", () => {
      useWorkspaceStore.setState({ workspacePath: "/test", graphReady: true });
      usePaneStore.setState({
        root: { type: "leaf", id: "p1", pagePath: "notes/hello.md" },
        focusedPaneId: "p1",
      });
      useBottomPanelStore.setState({ tabMeta: { ...defaultTabMeta(), linked: { count: 3, hasOpened: true } } });
      render(<StatusBar />);
      expect(screen.getByTestId("tab-linked").querySelector(".nerd-font")).toBeTruthy();
      expect(screen.getByTestId("tab-linked")).toHaveTextContent("3");
    });

    it("hides unlinked tab when experimentalUnlinkedReferences is false", () => {
      useWorkspaceStore.setState({ workspacePath: "/test", graphReady: true });
      usePaneStore.setState({
        root: { type: "leaf", id: "p1", pagePath: "notes/hello.md" },
        focusedPaneId: "p1",
      });
      usePreferencesStore.setState({ experimentalUnlinkedReferences: false });
      render(<StatusBar />);
      expect(screen.getByTestId("tab-linked")).toBeInTheDocument();
      expect(screen.queryByTestId("tab-unlinked")).toBeNull();
    });

    it("hides annotations tab when annotationEnabled is false", () => {
      useWorkspaceStore.setState({ workspacePath: "/test", graphReady: true });
      usePaneStore.setState({
        root: { type: "leaf", id: "p1", pagePath: "notes/hello.md" },
        focusedPaneId: "p1",
      });
      useBottomPanelStore.setState({ tabMeta: { ...defaultTabMeta(), annotations: { count: 5, hasOpened: false } } });
      usePreferencesStore.setState({ annotationEnabled: false });
      render(<StatusBar />);
      expect(screen.queryByTestId("tab-annotations")).toBeNull();
    });

    it("shows annotations tab even when annotationCount is 0", () => {
      useWorkspaceStore.setState({ workspacePath: "/test", graphReady: true });
      usePaneStore.setState({
        root: { type: "leaf", id: "p1", pagePath: "notes/hello.md" },
        focusedPaneId: "p1",
      });
      usePreferencesStore.setState({ annotationEnabled: true });
      useBottomPanelStore.setState({ tabMeta: { ...defaultTabMeta(), annotations: { count: 0, hasOpened: false } } });
      render(<StatusBar />);
      expect(screen.getByTestId("tab-annotations")).toBeInTheDocument();
      expect(screen.getByTestId("tab-annotations")).toHaveAttribute("aria-label", "Annotations");
    });

    it("shows annotations tab when enabled and count > 0", () => {
      useWorkspaceStore.setState({ workspacePath: "/test", graphReady: true });
      usePaneStore.setState({
        root: { type: "leaf", id: "p1", pagePath: "notes/hello.md" },
        focusedPaneId: "p1",
      });
      usePreferencesStore.setState({ annotationEnabled: true });
      useBottomPanelStore.setState({ tabMeta: { ...defaultTabMeta(), annotations: { count: 2, hasOpened: false } } });
      render(<StatusBar />);
      expect(screen.getByTestId("tab-annotations")).toHaveTextContent("2");
    });

    it("layout order: BufferStack then tabs then cursor position", () => {
      useWorkspaceStore.setState({ workspacePath: "/test", graphReady: true });
      usePaneStore.setState({
        root: { type: "leaf", id: "p1", pagePath: "notes/hello.md" },
        focusedPaneId: "p1",
      });
      useCursorInfoStore.setState({ line: 5, col: 10 });
      useBottomPanelStore.setState({ tabMeta: { ...defaultTabMeta(), linked: { count: 1, hasOpened: true } } });
      render(<StatusBar />);

      const statusBar = screen.getByTestId("status-bar");

      // BufferStack comes before tabs in DOM order
      const allElements = statusBar.querySelectorAll("[data-testid]");
      const testIds = Array.from(allElements).map((el) => el.getAttribute("data-testid"));
      const bufferIdx = testIds.indexOf("buffer-stack-label");
      const tabsIdx = testIds.indexOf("bottom-panel-tabs");
      const cursorIdx = testIds.indexOf("status-bar-cursor");

      expect(bufferIdx).toBeLessThan(tabsIdx);
      expect(tabsIdx).toBeLessThan(cursorIdx);
    });

    it("tab has aria-selected true only when active and unfolded", () => {
      useWorkspaceStore.setState({ workspacePath: "/test", graphReady: true });
      usePaneStore.setState({
        root: { type: "leaf", id: "p1", pagePath: "notes/hello.md" },
        focusedPaneId: "p1",
      });
      useBottomPanelStore.setState({ activeTab: "linked", unfolded: true });
      render(<StatusBar />);
      expect(screen.getByTestId("tab-linked")).toHaveAttribute("aria-selected", "true");
    });

    it("tab has aria-selected false when active but folded", () => {
      useWorkspaceStore.setState({ workspacePath: "/test", graphReady: true });
      usePaneStore.setState({
        root: { type: "leaf", id: "p1", pagePath: "notes/hello.md" },
        focusedPaneId: "p1",
      });
      useBottomPanelStore.setState({ activeTab: "linked", unfolded: false });
      render(<StatusBar />);
      expect(screen.getByTestId("tab-linked")).toHaveAttribute("aria-selected", "false");
    });

    it("shows outgoing links tab when page is open", () => {
      useWorkspaceStore.setState({ workspacePath: "/test", graphReady: true });
      usePaneStore.setState({
        root: { type: "leaf", id: "p1", pagePath: "notes/hello.md" },
        focusedPaneId: "p1",
      });
      render(<StatusBar />);
      expect(screen.getByTestId("tab-outgoing")).toBeInTheDocument();
      expect(screen.getByTestId("tab-outgoing")).toHaveAttribute("aria-label", "Outgoing Links");
    });

    it("shows count in outgoing links button text when outgoingCount is set", () => {
      useWorkspaceStore.setState({ workspacePath: "/test", graphReady: true });
      usePaneStore.setState({
        root: { type: "leaf", id: "p1", pagePath: "notes/hello.md" },
        focusedPaneId: "p1",
      });
      useBottomPanelStore.setState({ tabMeta: { ...defaultTabMeta(), outgoing: { count: 7, hasOpened: false } } });
      render(<StatusBar />);
      expect(screen.getByTestId("tab-outgoing")).toHaveTextContent("7");
    });

    it("clicking outgoing links tab activates it", async () => {
      useWorkspaceStore.setState({ workspacePath: "/test", graphReady: true });
      usePaneStore.setState({
        root: { type: "leaf", id: "p1", pagePath: "notes/hello.md" },
        focusedPaneId: "p1",
      });
      render(<StatusBar />);
      await userEvent.click(screen.getByTestId("tab-outgoing"));
      const state = useBottomPanelStore.getState();
      expect(state.activeTab).toBe("outgoing");
      expect(state.unfolded).toBe(true);
      expect(state.tabMeta.outgoing.hasOpened).toBe(true);
    });

    it("outgoing links tab appears between linked and unlinked tabs", () => {
      useWorkspaceStore.setState({ workspacePath: "/test", graphReady: true });
      usePaneStore.setState({
        root: { type: "leaf", id: "p1", pagePath: "notes/hello.md" },
        focusedPaneId: "p1",
      });
      usePreferencesStore.setState({ experimentalUnlinkedReferences: true });
      render(<StatusBar />);
      const tabs = screen.getByTestId("bottom-panel-tabs");
      const buttons = Array.from(tabs.querySelectorAll("[data-testid]")).map(
        (el) => el.getAttribute("data-testid"),
      );
      const linkedIdx = buttons.indexOf("tab-linked");
      const outgoingIdx = buttons.indexOf("tab-outgoing");
      const unlinkedIdx = buttons.indexOf("tab-unlinked");
      expect(linkedIdx).toBeLessThan(outgoingIdx);
      expect(outgoingIdx).toBeLessThan(unlinkedIdx);
    });
  });

  describe("BottomPanelTabs hidden for code files", () => {
    it("hides bottom panel tabs when focused pane is a code file", () => {
      useWorkspaceStore.setState({
        workspacePath: "/test",
        graphReady: true,
        pages: [
          { title: "refs", relative_path: "lib/refs.bib", frontmatter: {}, created_at: 0, modified_at: 0, file_type: "code" as const },
        ],
      });
      usePaneStore.setState({
        root: { type: "leaf", id: "c1", pagePath: "lib/refs.bib" },
        focusedPaneId: "c1",
      });
      render(<StatusBar />);
      expect(screen.queryByTestId("bottom-panel-tabs")).toBeNull();
      expect(screen.queryByTestId("tab-linked")).toBeNull();
    });

    it("still shows bottom panel tabs for markdown files", () => {
      useWorkspaceStore.setState({
        workspacePath: "/test",
        graphReady: true,
        pages: [
          { title: "hello", relative_path: "notes/hello.md", frontmatter: {}, created_at: 0, modified_at: 0, file_type: "markdown" as const },
        ],
      });
      usePaneStore.setState({
        root: { type: "leaf", id: "p1", pagePath: "notes/hello.md" },
        focusedPaneId: "p1",
      });
      render(<StatusBar />);
      expect(screen.getByTestId("bottom-panel-tabs")).toBeInTheDocument();
      expect(screen.getByTestId("tab-linked")).toBeInTheDocument();
    });

    it("shows language name for code files", () => {
      useWorkspaceStore.setState({
        workspacePath: "/test",
        graphReady: true,
        pages: [
          { title: "refs", relative_path: "lib/refs.bib", frontmatter: {}, created_at: 0, modified_at: 0, file_type: "code" as const },
        ],
      });
      usePaneStore.setState({
        root: { type: "leaf", id: "c1", pagePath: "lib/refs.bib" },
        focusedPaneId: "c1",
      });
      render(<StatusBar />);
      expect(screen.getByTestId("status-bar-language")).toHaveTextContent("BibTeX");
    });

    it("does not show language name for markdown files", () => {
      useWorkspaceStore.setState({
        workspacePath: "/test",
        graphReady: true,
        pages: [
          { title: "hello", relative_path: "notes/hello.md", frontmatter: {}, created_at: 0, modified_at: 0, file_type: "markdown" as const },
        ],
      });
      usePaneStore.setState({
        root: { type: "leaf", id: "p1", pagePath: "notes/hello.md" },
        focusedPaneId: "p1",
      });
      render(<StatusBar />);
      expect(screen.queryByTestId("status-bar-language")).toBeNull();
    });

    it("shows cursor position for a focused code pane", () => {
      useWorkspaceStore.setState({
        workspacePath: "/test",
        graphReady: true,
        pages: [
          { title: "refs", relative_path: "lib/refs.bib", frontmatter: {}, created_at: 0, modified_at: 0, file_type: "code" as const },
        ],
      });
      usePaneStore.setState({
        root: { type: "leaf", id: "c1", pagePath: "lib/refs.bib" },
        focusedPaneId: "c1",
      });
      useCursorInfoStore.setState({ line: 3, col: 7 });
      render(<StatusBar />);
      expect(screen.getByTestId("status-bar-cursor")).toHaveTextContent("Ln 3, Col 7");
    });
  });

  describe("StatusBar new page button", () => {
    beforeEach(() => {
      mockInvoke((cmd, args) => {
        if (cmd === "create_page") {
          const name = (args as Record<string, unknown>)?.name as string;
          return {
            title: name,
            relative_path: `${name}.md`,
            frontmatter: {},
            created_at: 1000,
            modified_at: 1000,
            file_type: "markdown" as const,
          };
        }
        throw new Error(`Unknown command: ${cmd}`);
      });
    });

    it("renders a 'New page' button when graphReady is true", () => {
      useWorkspaceStore.setState({ workspacePath: "/test", graphReady: true });
      render(<StatusBar />);
      expect(screen.getByRole("button", { name: "New page" })).toBeInTheDocument();
    });

    it("renders a 'New page' button when graphReady is false (indexing)", () => {
      useWorkspaceStore.setState({
        workspacePath: "/test",
        graphReady: false,
        indexProgress: { phase: "parsing", current: 3, total: 10 },
      });
      render(<StatusBar />);
      expect(screen.getByRole("button", { name: "New page" })).toBeInTheDocument();
    });

    it("clicking the button creates a new page named 'Untitled'", async () => {
      useWorkspaceStore.setState({ workspacePath: "/test", graphReady: true, pages: [] });
      render(<StatusBar />);
      await userEvent.click(screen.getByRole("button", { name: "New page" }));
      const state = useWorkspaceStore.getState();
      expect(state.pages).toHaveLength(1);
      expect(state.pages[0]!.title).toBe("Untitled");
    });

    it("uses 'Untitled 1' when 'Untitled' already exists", async () => {
      useWorkspaceStore.setState({
        workspacePath: "/test",
        graphReady: true,
        pages: [
          {
            title: "Untitled",
            relative_path: "Untitled.md",
            frontmatter: {},
            created_at: 1000,
            modified_at: 1000,
            file_type: "markdown" as const,
          },
        ],
      });
      render(<StatusBar />);
      await userEvent.click(screen.getByRole("button", { name: "New page" }));
      const state = useWorkspaceStore.getState();
      const newPage = state.pages.find((p) => p.title === "Untitled 1");
      expect(newPage).toBeTruthy();
    });

    it("auto-selects the new page after creation", async () => {
      useWorkspaceStore.setState({ workspacePath: "/test", graphReady: true, pages: [] });
      render(<StatusBar />);
      await userEvent.click(screen.getByRole("button", { name: "New page" }));
      expect(useWorkspaceStore.getState().currentPagePath).toBe("Untitled.md");
    });

    it("does not call window.prompt", async () => {
      const promptSpy = vi.spyOn(window, "prompt");
      useWorkspaceStore.setState({ workspacePath: "/test", graphReady: true, pages: [] });
      render(<StatusBar />);
      await userEvent.click(screen.getByRole("button", { name: "New page" }));
      expect(promptSpy).not.toHaveBeenCalled();
      promptSpy.mockRestore();
    });

    it("button displays nerd font glyph U+F0FE with .nerd-font class", () => {
      useWorkspaceStore.setState({ workspacePath: "/test", graphReady: true });
      render(<StatusBar />);
      const btn = screen.getByRole("button", { name: "New page" });
      const glyph = btn.querySelector(".nerd-font");
      expect(glyph).toBeTruthy();
      expect(glyph!.textContent).toBe("");
    });
  });

  describe("PDF page nav", () => {
    it("renders ‹ N/M › when a PDF pane is focused and has currentPage + pageCount", () => {
      useWorkspaceStore.setState({ workspacePath: "/test", graphReady: true, pages: [
        { title: "doc", relative_path: "notes/hello.pdf", frontmatter: {}, created_at: 0, modified_at: 0, file_type: "pdf" as const },
      ] });
      usePaneStore.setState({
        root: { type: "leaf", id: "pdf", pagePath: "notes/hello.pdf" },
        focusedPaneId: "pdf",
      });
      usePanePdfLinkStore.setState({
        currentPage: new Map([["pdf", 4]]),
        pageCount: new Map([["pdf", 10]]),
      });
      render(<StatusBar />);
      expect(screen.getByTestId("status-bar-pdf-nav")).toBeInTheDocument();
      expect(screen.getByTestId("status-bar-pdf-page")).toHaveTextContent("5/10");
    });

    it("returns null when focused pane is not a PDF", () => {
      useWorkspaceStore.setState({ workspacePath: "/test", graphReady: true, pages: [
        { title: "hello", relative_path: "notes/hello.md", frontmatter: {}, created_at: 0, modified_at: 0, file_type: "markdown" as const },
      ] });
      usePaneStore.setState({
        root: { type: "leaf", id: "md", pagePath: "notes/hello.md" },
        focusedPaneId: "md",
      });
      render(<StatusBar />);
      expect(screen.queryByTestId("status-bar-pdf-nav")).toBeNull();
    });

    it("prev disabled on page 0, next disabled on last page", () => {
      useWorkspaceStore.setState({ workspacePath: "/test", graphReady: true, pages: [
        { title: "doc", relative_path: "notes/hello.pdf", frontmatter: {}, created_at: 0, modified_at: 0, file_type: "pdf" as const },
      ] });
      usePaneStore.setState({
        root: { type: "leaf", id: "pdf", pagePath: "notes/hello.pdf" },
        focusedPaneId: "pdf",
      });
      usePanePdfLinkStore.setState({
        currentPage: new Map([["pdf", 0]]),
        pageCount: new Map([["pdf", 5]]),
      });
      render(<StatusBar />);
      expect(screen.getByTestId("status-bar-pdf-prev")).toBeDisabled();
      expect(screen.getByTestId("status-bar-pdf-next")).not.toBeDisabled();

      act(() => {
        usePanePdfLinkStore.getState().setCurrentPage("pdf", 4);
      });
      expect(screen.getByTestId("status-bar-pdf-prev")).not.toBeDisabled();
      expect(screen.getByTestId("status-bar-pdf-next")).toBeDisabled();
    });

    it("prev/next buttons call getPdfGoToPage with correct page index", async () => {
      const goToPage = vi.fn();
      pdfPaneRef.registerPdfGoToPage("pdf", goToPage);
      useWorkspaceStore.setState({ workspacePath: "/test", graphReady: true, pages: [
        { title: "doc", relative_path: "notes/hello.pdf", frontmatter: {}, created_at: 0, modified_at: 0, file_type: "pdf" as const },
      ] });
      usePaneStore.setState({
        root: { type: "leaf", id: "pdf", pagePath: "notes/hello.pdf" },
        focusedPaneId: "pdf",
      });
      usePanePdfLinkStore.setState({
        currentPage: new Map([["pdf", 3]]),
        pageCount: new Map([["pdf", 10]]),
      });
      render(<StatusBar />);

      await userEvent.click(screen.getByTestId("status-bar-pdf-next"));
      expect(goToPage).toHaveBeenCalledWith(4);

      await userEvent.click(screen.getByTestId("status-bar-pdf-prev"));
      expect(goToPage).toHaveBeenCalledWith(2);
    });

    it("rapid double-click advances two pages", async () => {
      const goToPage = vi.fn();
      pdfPaneRef.registerPdfGoToPage("pdf", goToPage);
      useWorkspaceStore.setState({ workspacePath: "/test", graphReady: true, pages: [
        { title: "doc", relative_path: "notes/hello.pdf", frontmatter: {}, created_at: 0, modified_at: 0, file_type: "pdf" as const },
      ] });
      usePaneStore.setState({
        root: { type: "leaf", id: "pdf", pagePath: "notes/hello.pdf" },
        focusedPaneId: "pdf",
      });
      usePanePdfLinkStore.setState({
        currentPage: new Map([["pdf", 2]]),
        pageCount: new Map([["pdf", 10]]),
      });
      render(<StatusBar />);

      // First click: reads live state (page 2) → goToPage(3)
      await userEvent.click(screen.getByTestId("status-bar-pdf-next"));
      expect(goToPage).toHaveBeenCalledWith(3);
      // Simulate the store update that would happen from PdfViewer's onPageChange
      act(() => { usePanePdfLinkStore.getState().setCurrentPage("pdf", 3); });

      // Second click: reads live state (page 3) → goToPage(4)
      await userEvent.click(screen.getByTestId("status-bar-pdf-next"));
      expect(goToPage).toHaveBeenCalledWith(4);
    });

    it("rapid double-click on cache miss advances two pages even though the store lags", async () => {
      let livePage = 2; // synchronous ref source of truth (like currentPageRef)
      const goToPage = vi.fn((p: number) => { livePage = p; }); // ref advances synchronously
      pdfPaneRef.registerPdfGoToPage("pdf", goToPage);
      pdfPaneRef.registerPdfCurrentPage("pdf", () => livePage);
      useWorkspaceStore.setState({ workspacePath: "/test", graphReady: true, pages: [
        { title: "doc", relative_path: "notes/hello.pdf", frontmatter: {}, created_at: 0, modified_at: 0, file_type: "pdf" as const },
      ] });
      usePaneStore.setState({
        root: { type: "leaf", id: "pdf", pagePath: "notes/hello.pdf" },
        focusedPaneId: "pdf",
      });
      // Store STAYS at 2 (never updated, simulating an in-flight cache-miss render).
      usePanePdfLinkStore.setState({
        currentPage: new Map([["pdf", 2]]),
        pageCount: new Map([["pdf", 10]]),
      });
      render(<StatusBar />);

      await userEvent.click(screen.getByTestId("status-bar-pdf-next"));
      await userEvent.click(screen.getByTestId("status-bar-pdf-next")); // NO setCurrentPage in between
      expect(goToPage).toHaveBeenNthCalledWith(1, 3);
      expect(goToPage).toHaveBeenNthCalledWith(2, 4);
    });

    it("rapid double-click prev on cache miss retreats two pages even though the store lags", async () => {
      let livePage = 8; // synchronous ref source of truth
      const goToPage = vi.fn((p: number) => { livePage = p; });
      pdfPaneRef.registerPdfGoToPage("pdf", goToPage);
      pdfPaneRef.registerPdfCurrentPage("pdf", () => livePage);
      useWorkspaceStore.setState({ workspacePath: "/test", graphReady: true, pages: [
        { title: "doc", relative_path: "notes/hello.pdf", frontmatter: {}, created_at: 0, modified_at: 0, file_type: "pdf" as const },
      ] });
      usePaneStore.setState({
        root: { type: "leaf", id: "pdf", pagePath: "notes/hello.pdf" },
        focusedPaneId: "pdf",
      });
      usePanePdfLinkStore.setState({
        currentPage: new Map([["pdf", 8]]),
        pageCount: new Map([["pdf", 10]]),
      });
      render(<StatusBar />);

      await userEvent.click(screen.getByTestId("status-bar-pdf-prev"));
      await userEvent.click(screen.getByTestId("status-bar-pdf-prev"));
      expect(goToPage).toHaveBeenNthCalledWith(1, 7);
      expect(goToPage).toHaveBeenNthCalledWith(2, 6);
    });

    it("rapid double-click on next drives a REAL PdfViewer two pages during an in-flight cache-miss render", async () => {
      // Integration regression guard: unlike the mock-ref cache-miss tests
      // above, this wires the actual PdfViewer goToPage / getCurrentPage into
      // the same pdfPaneRef registries the StatusBar reads from. It regresses
      // if PdfViewer's synchronous currentPageRef advance (goToPage) or its
      // registerGetCurrentPage publication breaks.

      // page-1 render never resolves, so the pane store currentPage stays at 0
      // (an in-flight cache-miss render) across both clicks.
      const deferred = new Promise<never>(() => {});
      (mockPdjsGetPage as ReturnType<typeof vi.fn>).mockImplementation((pageNum: number) => {
        const page = {
          getViewport: mockPdjsGetViewport,
          getTextContent: mockPdjsGetTextContent,
          getAnnotations: mockPdjsGetAnnotations,
          render: () => {
            if (pageNum === 2) {
              // page 2 (0-based index 1) render never resolves
              return { promise: deferred, cancel: vi.fn() };
            }
            return { promise: Promise.resolve(), cancel: vi.fn() };
          },
        };
        return Promise.resolve(page);
      });

      useWorkspaceStore.setState({ workspacePath: "/test", graphReady: true, pages: [
        { title: "doc", relative_path: "notes/hello.pdf", frontmatter: {}, created_at: 0, modified_at: 0, file_type: "pdf" as const },
      ] });
      usePaneStore.setState({
        root: { type: "leaf", id: "pdf", pagePath: "notes/hello.pdf" },
        focusedPaneId: "pdf",
      });
      // Seed currentPage 0 / pageCount 3 so PdfPageNav renders with next enabled.
      // The viewer is left to populate the imperative registries, but the store
      // is seeded manually and never mutated during the test.
      usePanePdfLinkStore.setState({
        currentPage: new Map([["pdf", 0]]),
        pageCount: new Map([["pdf", 3]]),
      });

      const { unmount } = render(
        <>
          <PdfViewer
            filePath="/test/hello.pdf"
            paneId="pdf"
            registerGoToPage={(fn) => pdfPaneRef.registerPdfGoToPage("pdf", fn)}
            registerGetCurrentPage={(fn) => pdfPaneRef.registerPdfCurrentPage("pdf", fn)}
          />
          <StatusBar />
        </>,
      );

      // Wait for the canvas viewer to be ready so the viewer has registered
      // goToPage and the current-page getter before we click.
      await waitFor(() => {
        expect(screen.getByTestId("pdf-viewer")).toBeInTheDocument();
      });

      // Two rapid clicks with NO store flush between them. The page-1 render is
      // deferred, so the store stays at 0; only the viewer's synchronous
      // currentPageRef advances. The second click must derive page 2.
      await userEvent.click(screen.getByTestId("status-bar-pdf-next"));
      await userEvent.click(screen.getByTestId("status-bar-pdf-next"));

      // getPage uses 1-based page numbers: page index 1 = getPage(2), page index 2 = getPage(3)
      expect(mockPdjsGetPage).toHaveBeenCalledWith(2);
      expect(mockPdjsGetPage).toHaveBeenCalledWith(3);

      unmount();
    });

    it("renders page nav when a markdown pane is focused but linked to a PDF pane", () => {
      useWorkspaceStore.setState({ workspacePath: "/test", graphReady: true, pages: [
        { title: "hello", relative_path: "notes/hello.md", frontmatter: {}, created_at: 0, modified_at: 0, file_type: "markdown" as const },
        { title: "doc", relative_path: "notes/hello.pdf", frontmatter: {}, created_at: 0, modified_at: 0, file_type: "pdf" as const },
      ] });
      usePaneStore.setState({
        root: {
          type: "split",
          id: "s1",
          direction: "horizontal",
          children: [
            { type: "leaf", id: "md", pagePath: "notes/hello.md" },
            { type: "leaf", id: "pdf", pagePath: "notes/hello.pdf" },
          ],
          sizes: [0.5, 0.5],
        },
        focusedPaneId: "md",
      });
      usePanePdfLinkStore.setState({
        links: new Map([["md", "pdf"], ["pdf", "md"]]),
        currentPage: new Map([["pdf", 4]]),
        pageCount: new Map([["pdf", 10]]),
      });
      render(<StatusBar />);
      expect(screen.getByTestId("status-bar-pdf-nav")).toBeInTheDocument();
      expect(screen.getByTestId("status-bar-pdf-page")).toHaveTextContent("5/10");
    });

    it("prev/next operate on the linked PDF pane while the editor is focused", async () => {
      const goToPage = vi.fn();
      pdfPaneRef.registerPdfGoToPage("pdf", goToPage);
      useWorkspaceStore.setState({ workspacePath: "/test", graphReady: true, pages: [
        { title: "hello", relative_path: "notes/hello.md", frontmatter: {}, created_at: 0, modified_at: 0, file_type: "markdown" as const },
        { title: "doc", relative_path: "notes/hello.pdf", frontmatter: {}, created_at: 0, modified_at: 0, file_type: "pdf" as const },
      ] });
      usePaneStore.setState({
        root: {
          type: "split",
          id: "s1",
          direction: "horizontal",
          children: [
            { type: "leaf", id: "md", pagePath: "notes/hello.md" },
            { type: "leaf", id: "pdf", pagePath: "notes/hello.pdf" },
          ],
          sizes: [0.5, 0.5],
        },
        focusedPaneId: "md",
      });
      usePanePdfLinkStore.setState({
        links: new Map([["md", "pdf"], ["pdf", "md"]]),
        currentPage: new Map([["pdf", 3]]),
        pageCount: new Map([["pdf", 10]]),
      });
      render(<StatusBar />);

      await userEvent.click(screen.getByTestId("status-bar-pdf-next"));
      expect(goToPage).toHaveBeenCalledWith(4);

      await userEvent.click(screen.getByTestId("status-bar-pdf-prev"));
      expect(goToPage).toHaveBeenCalledWith(2);
    });

    it("returns null when a markdown pane is focused with no linked PDF", () => {
      useWorkspaceStore.setState({ workspacePath: "/test", graphReady: true, pages: [
        { title: "hello", relative_path: "notes/hello.md", frontmatter: {}, created_at: 0, modified_at: 0, file_type: "markdown" as const },
      ] });
      usePaneStore.setState({
        root: { type: "leaf", id: "md", pagePath: "notes/hello.md" },
        focusedPaneId: "md",
      });
      usePanePdfLinkStore.setState({ links: new Map() });
      render(<StatusBar />);
      expect(screen.queryByTestId("status-bar-pdf-nav")).toBeNull();
    });
  });

  describe("Status message display", () => {
    it("shows status message when store has a message", () => {
      useWorkspaceStore.setState({ workspacePath: "/test", graphReady: true });
      useStatusMessageStore.setState({ message: "Undid: Merge A+B", variant: "success" });
      render(<StatusBar />);
      const el = screen.getByTestId("status-bar-message");
      expect(el).toBeInTheDocument();
      expect(el).toHaveTextContent("Undid: Merge A+B");
    });

    it("does not show status message when message is null", () => {
      useWorkspaceStore.setState({ workspacePath: "/test", graphReady: true });
      useStatusMessageStore.setState({ message: null, variant: "success" });
      render(<StatusBar />);
      expect(screen.queryByTestId("status-bar-message")).toBeNull();
    });

    it("shows error variant with error styling", () => {
      useWorkspaceStore.setState({ workspacePath: "/test", graphReady: true });
      useStatusMessageStore.setState({ message: "Nothing to undo", variant: "error" });
      render(<StatusBar />);
      const el = screen.getByTestId("status-bar-message");
      expect(el.className).toContain("text-text-error");
    });

    it("shows success variant with muted styling", () => {
      useWorkspaceStore.setState({ workspacePath: "/test", graphReady: true });
      useStatusMessageStore.setState({ message: "Done", variant: "success" });
      render(<StatusBar />);
      const el = screen.getByTestId("status-bar-message");
      expect(el.className).toContain("text-text-muted");
    });

    it("shows progress variant with animate-pulse", () => {
      useWorkspaceStore.setState({ workspacePath: "/test", graphReady: true });
      useStatusMessageStore.setState({ message: "Exporting 3/10…", variant: "progress" });
      render(<StatusBar />);
      const el = screen.getByTestId("status-bar-message");
      expect(el.className).toContain("animate-pulse");
      expect(el.className).toContain("text-text-muted");
    });

    it("does not show animate-pulse for success variant", () => {
      useWorkspaceStore.setState({ workspacePath: "/test", graphReady: true });
      useStatusMessageStore.setState({ message: "Done", variant: "success" });
      render(<StatusBar />);
      const el = screen.getByTestId("status-bar-message");
      expect(el.className).not.toContain("animate-pulse");
    });
  });
});
