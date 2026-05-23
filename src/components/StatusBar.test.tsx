import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { mockInvoke } from "../test/tauri-mock";
import { StatusBar } from "./StatusBar";
import { useWorkspaceStore } from "../stores/workspace";
import { usePaneStore } from "../stores/panes";
import { useCursorInfoStore } from "../stores/cursorInfo";
import { useBottomPanelStore } from "../stores/bottomPanel";
import { usePreferencesStore } from "../stores/preferences";
import { useLlmResponseStore } from "../stores/llmResponse";

beforeEach(() => {
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
    linkedCount: null,
    unlinkedCount: null,
    annotationCount: 0,
    hasOpenedUnlinked: false,
    hasOpenedAnnotations: false,
  });
  usePreferencesStore.setState({
    experimentalUnlinkedReferences: true,
    annotationEnabled: true,
  });
  useLlmResponseStore.getState().reset();
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

    it("tab buttons hidden when no page is open", () => {
      useWorkspaceStore.setState({ workspacePath: "/test", graphReady: true });
      usePaneStore.setState({
        root: { type: "leaf", id: "p1", pagePath: null },
        focusedPaneId: "p1",
      });
      render(<StatusBar />);
      expect(screen.queryByTestId("bottom-panel-tabs")).toBeNull();
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
      useBottomPanelStore.setState({ linkedCount: 3 });
      render(<StatusBar />);
      expect(screen.getByTestId("tab-linked")).toHaveTextContent("Linked References (3)");
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
      useBottomPanelStore.setState({ annotationCount: 5 });
      usePreferencesStore.setState({ annotationEnabled: false });
      render(<StatusBar />);
      expect(screen.queryByTestId("tab-annotations")).toBeNull();
    });

    it("hides annotations tab when annotationCount is 0", () => {
      useWorkspaceStore.setState({ workspacePath: "/test", graphReady: true });
      usePaneStore.setState({
        root: { type: "leaf", id: "p1", pagePath: "notes/hello.md" },
        focusedPaneId: "p1",
      });
      usePreferencesStore.setState({ annotationEnabled: true });
      useBottomPanelStore.setState({ annotationCount: 0 });
      render(<StatusBar />);
      expect(screen.queryByTestId("tab-annotations")).toBeNull();
    });

    it("shows annotations tab when enabled and count > 0", () => {
      useWorkspaceStore.setState({ workspacePath: "/test", graphReady: true });
      usePaneStore.setState({
        root: { type: "leaf", id: "p1", pagePath: "notes/hello.md" },
        focusedPaneId: "p1",
      });
      usePreferencesStore.setState({ annotationEnabled: true });
      useBottomPanelStore.setState({ annotationCount: 2 });
      render(<StatusBar />);
      expect(screen.getByTestId("tab-annotations")).toHaveTextContent("Annotations (2)");
    });

    it("layout order: BufferStack then tabs then cursor position", () => {
      useWorkspaceStore.setState({ workspacePath: "/test", graphReady: true });
      usePaneStore.setState({
        root: { type: "leaf", id: "p1", pagePath: "notes/hello.md" },
        focusedPaneId: "p1",
      });
      useCursorInfoStore.setState({ line: 5, col: 10 });
      useBottomPanelStore.setState({ linkedCount: 1 });
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

    it("shows LLM tab when llmResponseStore status is not idle", () => {
      useWorkspaceStore.setState({ workspacePath: "/test", graphReady: true });
      usePaneStore.setState({
        root: { type: "leaf", id: "p1", pagePath: "notes/hello.md" },
        focusedPaneId: "p1",
      });
      useLlmResponseStore.getState().startStream({ question: "q" });
      render(<StatusBar />);
      expect(screen.getByTestId("tab-llm-response")).toBeInTheDocument();
      expect(screen.getByTestId("tab-llm-response")).toHaveTextContent("LLM");
    });

    it("hides LLM tab when llmResponseStore status is idle and hasOpenedLlm is false", () => {
      useWorkspaceStore.setState({ workspacePath: "/test", graphReady: true });
      usePaneStore.setState({
        root: { type: "leaf", id: "p1", pagePath: "notes/hello.md" },
        focusedPaneId: "p1",
      });
      useBottomPanelStore.setState({ hasOpenedLlm: false });
      render(<StatusBar />);
      expect(screen.queryByTestId("tab-llm-response")).toBeNull();
    });

    it("shows LLM tab when hasOpenedLlm is true even if status is idle", () => {
      useWorkspaceStore.setState({ workspacePath: "/test", graphReady: true });
      usePaneStore.setState({
        root: { type: "leaf", id: "p1", pagePath: "notes/hello.md" },
        focusedPaneId: "p1",
      });
      useBottomPanelStore.setState({ hasOpenedLlm: true });
      render(<StatusBar />);
      expect(screen.getByTestId("tab-llm-response")).toBeInTheDocument();
    });

    it("clicking LLM tab activates llm-response tab", async () => {
      useWorkspaceStore.setState({ workspacePath: "/test", graphReady: true });
      usePaneStore.setState({
        root: { type: "leaf", id: "p1", pagePath: "notes/hello.md" },
        focusedPaneId: "p1",
      });
      useLlmResponseStore.getState().startStream({ question: "q" });
      render(<StatusBar />);
      await userEvent.click(screen.getByTestId("tab-llm-response"));
      const state = useBottomPanelStore.getState();
      expect(state.activeTab).toBe("llm-response");
      expect(state.unfolded).toBe(true);
      expect(state.hasOpenedLlm).toBe(true);
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

  describe("LLM error display", () => {
    it("shows error message when llmResponse store has an error", () => {
      useWorkspaceStore.setState({ workspacePath: "/test", graphReady: true });
      usePaneStore.setState({
        root: { type: "leaf", id: "p1", pagePath: "notes/hello.md" },
        focusedPaneId: "p1",
      });
      useLlmResponseStore.getState().setError("Invalid API key");
      render(<StatusBar />);
      const errorEl = screen.getByTestId("status-bar-llm-error");
      expect(errorEl).toBeInTheDocument();
      expect(errorEl).toHaveTextContent("Invalid API key");
    });

    it("does NOT show error when errorMessage is empty", () => {
      useWorkspaceStore.setState({ workspacePath: "/test", graphReady: true });
      usePaneStore.setState({
        root: { type: "leaf", id: "p1", pagePath: "notes/hello.md" },
        focusedPaneId: "p1",
      });
      render(<StatusBar />);
      expect(screen.queryByTestId("status-bar-llm-error")).toBeNull();
    });

    it("error clears when next LLM action starts", () => {
      useWorkspaceStore.setState({ workspacePath: "/test", graphReady: true });
      usePaneStore.setState({
        root: { type: "leaf", id: "p1", pagePath: "notes/hello.md" },
        focusedPaneId: "p1",
      });
      useLlmResponseStore.getState().setError("Network failure");
      const { rerender } = render(<StatusBar />);
      expect(screen.getByTestId("status-bar-llm-error")).toBeInTheDocument();

      useLlmResponseStore.getState().startStream({ question: "retry" });
      rerender(<StatusBar />);
      expect(screen.queryByTestId("status-bar-llm-error")).toBeNull();
    });
  });
});
