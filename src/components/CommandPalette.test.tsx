import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { CommandPalette, _resetRegistration } from "./CommandPalette";
import { mockInvoke } from "../test/tauri-mock";
import * as registry from "../lib/paletteRegistry";
import type { PaletteResult } from "../lib/paletteRegistry";
import type { AnnotationSearchResult, GraphSearchResult } from "../lib/ipc";

const mockResults: AnnotationSearchResult[] = [
  {
    annotation_id: 1,
    node_id: "silk-road.md",
    node_title: "Silk Road",
    annotation_type: "note",
    certainty: "firm",
    body: "Ancient trade route connecting East and West",
    date: "2024-03-15",
    source_line: 10,
    char_start: 100,
    char_end: 150,
  },
  {
    annotation_id: 2,
    node_id: "trade-history.md",
    node_title: "Trade History",
    annotation_type: "question",
    certainty: "tentative",
    body: "How did the Silk Road influence cultural exchange?",
    date: null,
    source_line: 25,
    char_start: 200,
    char_end: 260,
  },
  {
    annotation_id: 3,
    node_id: "silk-road.md",
    node_title: "Silk Road",
    annotation_type: "todo",
    certainty: "neutral",
    body: null,
    date: "2024-04-01",
    source_line: 42,
    char_start: 400,
    char_end: 420,
  },
];

const { mockSelectPageAtLine, mockSelectPage, mockRecordJump, mockWorkspaceState } = vi.hoisted(() => {
  const mockSelectPageAtLine = vi.fn();
  const mockSelectPage = vi.fn();
  const mockRecordJump = vi.fn();
  const mockWorkspaceState = {
    currentPagePath: "other-page.md" as string | null,
    selectPageAtLine: mockSelectPageAtLine,
    selectPage: mockSelectPage,
  };
  return { mockSelectPageAtLine, mockSelectPage, mockRecordJump, mockWorkspaceState };
});

vi.mock("../stores/workspace", () => ({
  useWorkspaceStore: Object.assign(
    (selector: (s: Record<string, unknown>) => unknown) =>
      selector(mockWorkspaceState),
    {
      getState: () => mockWorkspaceState,
    },
  ),
}));

vi.mock("../editor/jumpTracker", () => ({
  globalJumpTracker: {
    recordJump: mockRecordJump,
  },
}));

vi.mock("../lib/editorViewRef", () => ({
  getCurrentEditorView: vi.fn(() => null),
}));

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function advanceDebounce() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(300);
  });
}

describe("CommandPalette", () => {
  let onClose: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    onClose = vi.fn();
    mockWorkspaceState.currentPagePath = "other-page.md";
    mockSelectPageAtLine.mockClear();
    mockSelectPage.mockClear();
    mockRecordJump.mockClear();
    _resetRegistration();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("modal shell", () => {
    it("renders nothing when open=false", () => {
      const { container } = render(
        <CommandPalette open={false} onClose={onClose} />,
      );
      expect(container.innerHTML).toBe("");
    });

    it("renders backdrop + panel when open=true", () => {
      render(<CommandPalette open={true} onClose={onClose} />);
      expect(screen.getByTestId("command-palette-backdrop")).toBeInTheDocument();
      expect(screen.getByTestId("command-palette-panel")).toBeInTheDocument();
    });

    it("Escape key calls onClose", () => {
      render(<CommandPalette open={true} onClose={onClose} />);
      fireEvent.keyDown(screen.getByTestId("command-palette-input"), {
        key: "Escape",
      });
      expect(onClose).toHaveBeenCalled();
    });

    it("clicking backdrop calls onClose", () => {
      render(<CommandPalette open={true} onClose={onClose} />);
      fireEvent.click(screen.getByTestId("command-palette-backdrop"));
      expect(onClose).toHaveBeenCalled();
    });

    it("input is focused on open", () => {
      render(<CommandPalette open={true} onClose={onClose} />);
      expect(screen.getByTestId("command-palette-input")).toHaveFocus();
    });
  });

  describe("prefix routing", () => {
    it('typing "@silk" sets mode to annotations and shows prefix badge', () => {
      render(<CommandPalette open={true} onClose={onClose} />);
      fireEvent.change(screen.getByTestId("command-palette-input"), {
        target: { value: "@silk" },
      });
      expect(screen.getByTestId("command-palette-mode-badge")).toHaveTextContent("@");
    });

    it('typing "meeting" with no prefix shows omni mode (no badge)', () => {
      render(<CommandPalette open={true} onClose={onClose} />);
      fireEvent.change(screen.getByTestId("command-palette-input"), {
        target: { value: "meeting" },
      });
      expect(screen.queryByTestId("command-palette-mode-badge")).not.toBeInTheDocument();
    });

    it('typing "#tag" shows # prefix badge', () => {
      render(<CommandPalette open={true} onClose={onClose} />);
      fireEvent.change(screen.getByTestId("command-palette-input"), {
        target: { value: "#tag" },
      });
      expect(screen.getByTestId("command-palette-mode-badge")).toHaveTextContent("#");
    });

    it('typing "/pattern" shows / prefix badge', () => {
      render(<CommandPalette open={true} onClose={onClose} />);
      fireEvent.change(screen.getByTestId("command-palette-input"), {
        target: { value: "/pattern" },
      });
      expect(screen.getByTestId("command-palette-mode-badge")).toHaveTextContent("/");
    });

    it('typing "!cmd" shows ! prefix badge', () => {
      render(<CommandPalette open={true} onClose={onClose} />);
      fireEvent.change(screen.getByTestId("command-palette-input"), {
        target: { value: "!cmd" },
      });
      expect(screen.getByTestId("command-palette-mode-badge")).toHaveTextContent("!");
    });

    it("shows mode indicator badge next to input when prefix is active", () => {
      render(<CommandPalette open={true} onClose={onClose} />);
      expect(screen.queryByTestId("command-palette-mode-badge")).not.toBeInTheDocument();
      fireEvent.change(screen.getByTestId("command-palette-input"), {
        target: { value: "@test" },
      });
      expect(screen.getByTestId("command-palette-mode-badge")).toBeInTheDocument();
    });
  });

  describe("annotation search results (@ provider)", () => {
    it("calls searchAnnotations with stripped query after debounce", async () => {
      mockInvoke((cmd) => {
        if (cmd === "search_annotations") return mockResults;
        return [];
      });
      render(<CommandPalette open={true} onClose={onClose} />);
      fireEvent.change(screen.getByTestId("command-palette-input"), {
        target: { value: "@silk road" },
      });
      await advanceDebounce();
      expect(screen.getAllByTestId("command-palette-result")).toHaveLength(3);
    });

    it("shows type badge, page title, body snippet for each result", async () => {
      mockInvoke((cmd) => {
        if (cmd === "search_annotations") return mockResults;
        return [];
      });
      render(<CommandPalette open={true} onClose={onClose} />);
      fireEvent.change(screen.getByTestId("command-palette-input"), {
        target: { value: "@silk" },
      });
      await advanceDebounce();
      const results = screen.getAllByTestId("command-palette-result");
      expect(results[0]).toHaveTextContent("N");
      expect(results[0]).toHaveTextContent("Silk Road");
      expect(results[0]).toHaveTextContent("Ancient trade route");
    });

    it('shows "No results" when search returns empty', async () => {
      mockInvoke((cmd) => {
        if (cmd === "search_annotations") return [];
        return [];
      });
      render(<CommandPalette open={true} onClose={onClose} />);
      fireEvent.change(screen.getByTestId("command-palette-input"), {
        target: { value: "@nonexistent" },
      });
      await advanceDebounce();
      expect(screen.getByText("No results")).toBeInTheDocument();
    });

    it("shows placeholder hint when query is empty in @ mode", () => {
      render(<CommandPalette open={true} onClose={onClose} />);
      fireEvent.change(screen.getByTestId("command-palette-input"), {
        target: { value: "@" },
      });
      expect(screen.getByText("Type to search annotations…")).toBeInTheDocument();
    });

    it("debounces — rapid typing calls IPC only once after settling", async () => {
      let callCount = 0;
      mockInvoke((cmd) => {
        if (cmd === "search_annotations") {
          callCount++;
          return mockResults;
        }
        return [];
      });
      render(<CommandPalette open={true} onClose={onClose} />);
      const input = screen.getByTestId("command-palette-input");
      fireEvent.change(input, { target: { value: "@s" } });
      await act(async () => { await vi.advanceTimersByTimeAsync(100); });
      fireEvent.change(input, { target: { value: "@si" } });
      await act(async () => { await vi.advanceTimersByTimeAsync(100); });
      fireEvent.change(input, { target: { value: "@silk" } });
      await advanceDebounce();
      expect(callCount).toBe(1);
    });

    it("clears results when input is emptied", async () => {
      mockInvoke((cmd) => {
        if (cmd === "search_annotations") return mockResults;
        return [];
      });
      render(<CommandPalette open={true} onClose={onClose} />);
      const input = screen.getByTestId("command-palette-input");
      fireEvent.change(input, { target: { value: "@silk" } });
      await advanceDebounce();
      expect(screen.getAllByTestId("command-palette-result")).toHaveLength(3);
      fireEvent.change(input, { target: { value: "" } });
      expect(screen.queryAllByTestId("command-palette-result")).toHaveLength(0);
    });
  });

  describe("keyboard navigation", () => {
    async function renderWithResults() {
      mockInvoke((cmd) => {
        if (cmd === "search_annotations") return mockResults;
        return [];
      });
      render(<CommandPalette open={true} onClose={onClose} />);
      fireEvent.change(screen.getByTestId("command-palette-input"), {
        target: { value: "@silk" },
      });
      await advanceDebounce();
      expect(screen.getAllByTestId("command-palette-result")).toHaveLength(3);
    }

    it("ArrowDown moves active index forward", async () => {
      await renderWithResults();
      fireEvent.keyDown(screen.getByTestId("command-palette-input"), { key: "ArrowDown" });
      const results = screen.getAllByTestId("command-palette-result");
      expect(results[0]!.getAttribute("data-active")).toBe("false");
      expect(results[1]!.getAttribute("data-active")).toBe("true");
    });

    it("ArrowUp moves active index backward", async () => {
      await renderWithResults();
      fireEvent.keyDown(screen.getByTestId("command-palette-input"), { key: "ArrowDown" });
      fireEvent.keyDown(screen.getByTestId("command-palette-input"), { key: "ArrowUp" });
      const results = screen.getAllByTestId("command-palette-result");
      expect(results[0]!.getAttribute("data-active")).toBe("true");
    });

    it("active index wraps around", async () => {
      await renderWithResults();
      fireEvent.keyDown(screen.getByTestId("command-palette-input"), { key: "ArrowUp" });
      const results = screen.getAllByTestId("command-palette-result");
      expect(results[2]!.getAttribute("data-active")).toBe("true");
    });

    it("Enter on active item triggers selection", async () => {
      await renderWithResults();
      fireEvent.keyDown(screen.getByTestId("command-palette-input"), { key: "Enter" });
      expect(onClose).toHaveBeenCalled();
    });

    it("active item has highlighted styling", async () => {
      await renderWithResults();
      const results = screen.getAllByTestId("command-palette-result");
      expect(results[0]!.className).toContain("bg-bg-hover");
      expect(results[1]!.className).not.toContain("bg-bg-hover");
    });
  });

  describe("selection navigation", () => {
    async function renderWithResults() {
      mockInvoke((cmd) => {
        if (cmd === "search_annotations") return mockResults;
        return [];
      });
      render(<CommandPalette open={true} onClose={onClose} />);
      fireEvent.change(screen.getByTestId("command-palette-input"), {
        target: { value: "@silk" },
      });
      await advanceDebounce();
      expect(screen.getAllByTestId("command-palette-result")).toHaveLength(3);
    }

    it("selecting a result for a different page calls selectPageAtLine", async () => {
      mockWorkspaceState.currentPagePath = "other-page.md";
      await renderWithResults();
      const results = screen.getAllByTestId("command-palette-result");
      fireEvent.click(results[0]!);
      expect(mockSelectPageAtLine).toHaveBeenCalledWith("silk-road.md", 10);
      expect(onClose).toHaveBeenCalled();
    });

    it("selecting a result records jump in globalJumpTracker before navigating", async () => {
      await renderWithResults();
      const results = screen.getAllByTestId("command-palette-result");
      fireEvent.click(results[0]!);
      expect(mockRecordJump).toHaveBeenCalled();
    });

    it("selecting a result for the current page dispatches scroll event", async () => {
      mockWorkspaceState.currentPagePath = "silk-road.md";
      const dispatchSpy = vi.spyOn(window, "dispatchEvent");
      await renderWithResults();
      const results = screen.getAllByTestId("command-palette-result");
      fireEvent.click(results[0]!);
      const scrollEvent = dispatchSpy.mock.calls.find(
        (call) => (call[0] as CustomEvent).type === "lit:scroll-to-line",
      );
      expect(scrollEvent).toBeDefined();
      expect(onClose).toHaveBeenCalled();
      dispatchSpy.mockRestore();
    });

    it("selecting a result closes the palette", async () => {
      await renderWithResults();
      const results = screen.getAllByTestId("command-palette-result");
      fireEvent.click(results[0]!);
      expect(onClose).toHaveBeenCalled();
    });
  });

  describe("type filter", () => {
    it("@mode shows a type filter row", () => {
      render(<CommandPalette open={true} onClose={onClose} />);
      fireEvent.change(screen.getByTestId("command-palette-input"), {
        target: { value: "@" },
      });
      expect(screen.getByTestId("command-palette-type-filter")).toBeInTheDocument();
      expect(screen.getByText("All")).toBeInTheDocument();
    });

    it("clicking a type filter refines results by passing annotationType to searchAnnotations", async () => {
      let capturedType: string | null = null;
      mockInvoke((_cmd, args) => {
        if (_cmd === "search_annotations") {
          capturedType = (args as Record<string, unknown>).annotationType as string | null;
          return mockResults;
        }
        return [];
      });
      render(<CommandPalette open={true} onClose={onClose} />);
      fireEvent.change(screen.getByTestId("command-palette-input"), {
        target: { value: "@silk" },
      });
      await advanceDebounce();
      expect(screen.getAllByTestId("command-palette-result")).toHaveLength(3);
      fireEvent.click(screen.getByTestId("type-filter-note"));
      await advanceDebounce();
      expect(capturedType).toBe("note");
    });

    it('"All" filter passes null as annotationType', async () => {
      let capturedType: string | null | undefined = undefined;
      mockInvoke((_cmd, args) => {
        if (_cmd === "search_annotations") {
          capturedType = (args as Record<string, unknown>).annotationType as string | null;
          return mockResults;
        }
        return [];
      });
      render(<CommandPalette open={true} onClose={onClose} />);
      fireEvent.change(screen.getByTestId("command-palette-input"), {
        target: { value: "@silk" },
      });
      await advanceDebounce();
      fireEvent.click(screen.getByTestId("type-filter-note"));
      await advanceDebounce();
      fireEvent.click(screen.getByTestId("type-filter-all"));
      await advanceDebounce();
      expect(capturedType).toBeNull();
    });

    it('filter resets to "All" when mode changes', () => {
      render(<CommandPalette open={true} onClose={onClose} />);
      fireEvent.change(screen.getByTestId("command-palette-input"), {
        target: { value: "@silk" },
      });
      fireEvent.click(screen.getByTestId("type-filter-note"));
      fireEvent.change(screen.getByTestId("command-palette-input"), {
        target: { value: "meeting" },
      });
      fireEvent.change(screen.getByTestId("command-palette-input"), {
        target: { value: "@other" },
      });
      const allButton = screen.getByTestId("type-filter-all");
      expect(allButton.getAttribute("data-active")).toBe("true");
    });

    it("filter row does not appear for providers without filterOptions", () => {
      render(<CommandPalette open={true} onClose={onClose} />);
      fireEvent.change(screen.getByTestId("command-palette-input"), {
        target: { value: "$test" },
      });
      expect(screen.queryByTestId("command-palette-type-filter")).not.toBeInTheDocument();
    });
  });

  describe("file provider ($ prefix)", () => {
    it("searches files via searchPagesByTitle and shows results", async () => {
      const fileResults: GraphSearchResult[] = [
        { id: "silk-road.md", title: "Silk Road", score: 1.0, excerpt: "Ancient trade route" },
        { id: "report.pdf", title: "Trade Report", score: 0.5, excerpt: "" },
      ];
      mockInvoke((cmd) => {
        if (cmd === "search_pages_by_title") return fileResults;
        return [];
      });
      render(<CommandPalette open={true} onClose={onClose} />);
      fireEvent.change(screen.getByTestId("command-palette-input"), {
        target: { value: "$silk" },
      });
      await advanceDebounce();
      const results = screen.getAllByTestId("command-palette-result");
      expect(results).toHaveLength(2);
      expect(results[0]).toHaveTextContent("Silk Road");
    });

    it("selecting a file result calls selectPage and closes palette", async () => {
      const fileResults: GraphSearchResult[] = [
        { id: "silk-road.md", title: "Silk Road", score: 1.0, excerpt: "" },
      ];
      mockInvoke((cmd) => {
        if (cmd === "search_pages_by_title") return fileResults;
        return [];
      });
      render(<CommandPalette open={true} onClose={onClose} />);
      fireEvent.change(screen.getByTestId("command-palette-input"), {
        target: { value: "$silk" },
      });
      await advanceDebounce();
      const results = screen.getAllByTestId("command-palette-result");
      fireEvent.click(results[0]!);
      expect(mockSelectPage).toHaveBeenCalledWith("silk-road.md");
      expect(onClose).toHaveBeenCalled();
    });

  });

  describe("stub providers (# tags, / content)", () => {
    it('# prefix shows "No results" after debounce', async () => {
      render(<CommandPalette open={true} onClose={onClose} />);
      fireEvent.change(screen.getByTestId("command-palette-input"), {
        target: { value: "#tag" },
      });
      await advanceDebounce();
      expect(screen.getByText("No results")).toBeInTheDocument();
    });

    it('/ prefix shows "No results" after debounce', async () => {
      render(<CommandPalette open={true} onClose={onClose} />);
      fireEvent.change(screen.getByTestId("command-palette-input"), {
        target: { value: "/pattern" },
      });
      await advanceDebounce();
      expect(screen.getByText("No results")).toBeInTheDocument();
    });
  });

  describe("command provider (! prefix)", () => {
    it('"!insert" shows "Insert Annotation" command', async () => {
      render(<CommandPalette open={true} onClose={onClose} />);
      fireEvent.change(screen.getByTestId("command-palette-input"), {
        target: { value: "!insert" },
      });
      await advanceDebounce();
      const results = screen.getAllByTestId("command-palette-result");
      expect(results).toHaveLength(1);
      expect(results[0]).toHaveTextContent("Insert Annotation");
    });

    it('"!" with no query shows all commands (browse mode)', async () => {
      render(<CommandPalette open={true} onClose={onClose} />);
      fireEvent.change(screen.getByTestId("command-palette-input"), {
        target: { value: "!" },
      });
      expect(screen.getByText("Type to search commands…")).toBeInTheDocument();
    });

    it('selecting "Insert Annotation" command dispatches event and closes', async () => {
      const dispatchSpy = vi.spyOn(window, "dispatchEvent");
      render(<CommandPalette open={true} onClose={onClose} />);
      fireEvent.change(screen.getByTestId("command-palette-input"), {
        target: { value: "!insert" },
      });
      await advanceDebounce();
      const results = screen.getAllByTestId("command-palette-result");
      fireEvent.click(results[0]!);

      const builderEvent = dispatchSpy.mock.calls.find(
        (call) => (call[0] as CustomEvent).type === "lit:open-annotation-builder",
      );
      expect(builderEvent).toBeDefined();
      expect(onClose).toHaveBeenCalled();
      dispatchSpy.mockRestore();
    });
  });

  describe("omni-search (no prefix)", () => {
    it("no-prefix queries all providers, results grouped by section header", async () => {
      mockInvoke((cmd) => {
        if (cmd === "search_annotations") return mockResults;
        return [];
      });
      render(<CommandPalette open={true} onClose={onClose} />);
      fireEvent.change(screen.getByTestId("command-palette-input"), {
        target: { value: "insert" },
      });
      await advanceDebounce();
      expect(screen.getAllByTestId("palette-section-header").length).toBeGreaterThan(0);
    });

    it("section headers have data-testid palette-section-header", async () => {
      mockInvoke((cmd) => {
        if (cmd === "search_annotations") return mockResults;
        return [];
      });
      render(<CommandPalette open={true} onClose={onClose} />);
      fireEvent.change(screen.getByTestId("command-palette-input"), {
        target: { value: "silk" },
      });
      await advanceDebounce();
      const headers = screen.getAllByTestId("palette-section-header");
      expect(headers[0]).toHaveTextContent("Annotations");
    });

    it("file results appear in omni-search with Files section before Annotations (priority 10 < 20)", async () => {
      const fileResults: GraphSearchResult[] = [
        { id: "silk-road.md", title: "Silk Road", score: 1.0, excerpt: "Ancient trade route" },
      ];
      mockInvoke((cmd) => {
        if (cmd === "search_pages_by_title") return fileResults;
        if (cmd === "search_annotations") return mockResults;
        return [];
      });
      render(<CommandPalette open={true} onClose={onClose} />);
      fireEvent.change(screen.getByTestId("command-palette-input"), {
        target: { value: "silk" },
      });
      await advanceDebounce();
      const headers = screen.getAllByTestId("palette-section-header");
      expect(headers.length).toBeGreaterThanOrEqual(2);
      expect(headers[0]).toHaveTextContent("Files");
      expect(headers[1]).toHaveTextContent("Annotations");
      const results = screen.getAllByTestId("command-palette-result");
      expect(results[0]).toHaveTextContent("Silk Road");
    });

    it("omni caps at 5 results per section", async () => {
      const manyResults: AnnotationSearchResult[] = Array.from({ length: 10 }, (_, i) => ({
        annotation_id: i + 1,
        node_id: `page-${i}.md`,
        node_title: `Page ${i}`,
        annotation_type: "note" as const,
        certainty: "neutral" as const,
        body: `Body ${i}`,
        date: null,
        source_line: i + 1,
        char_start: 0,
        char_end: 10,
      }));
      mockInvoke((cmd) => {
        if (cmd === "search_annotations") return manyResults;
        return [];
      });
      render(<CommandPalette open={true} onClose={onClose} />);
      fireEvent.change(screen.getByTestId("command-palette-input"), {
        target: { value: "page" },
      });
      await advanceDebounce();
      const results = screen.getAllByTestId("command-palette-result");
      expect(results.length).toBeLessThanOrEqual(5);
    });

    it("selecting omni result calls correct provider's onSelect and records frecency", async () => {
      mockInvoke((cmd) => {
        if (cmd === "search_annotations") return [mockResults[0]!];
        return [];
      });
      render(<CommandPalette open={true} onClose={onClose} />);
      fireEvent.change(screen.getByTestId("command-palette-input"), {
        target: { value: "silk" },
      });
      await advanceDebounce();
      const results = screen.getAllByTestId("command-palette-result");
      fireEvent.click(results[0]!);
      expect(mockRecordJump).toHaveBeenCalled();
      expect(onClose).toHaveBeenCalled();
      const frecencyData = JSON.parse(localStorage.getItem("lit-palette-frecency")!);
      expect(frecencyData["annotation-1"]).toBeDefined();
    });

    it("prefix hint row rendered in omni mode with no input", () => {
      render(<CommandPalette open={true} onClose={onClose} />);
      expect(screen.getByTestId("prefix-hints")).toBeInTheDocument();
      expect(screen.getByTestId("prefix-hints")).toHaveTextContent("@ annotations");
    });

    it("prefix hints hidden when prefix is active", () => {
      render(<CommandPalette open={true} onClose={onClose} />);
      fireEvent.change(screen.getByTestId("command-palette-input"), {
        target: { value: "@test" },
      });
      expect(screen.queryByTestId("prefix-hints")).not.toBeInTheDocument();
    });

    it("re-registering provider with new object reference does not re-trigger search", async () => {
      let callCount = 0;
      mockInvoke((cmd) => {
        if (cmd === "search_annotations") {
          callCount++;
          return mockResults;
        }
        return [];
      });
      const { rerender } = render(<CommandPalette open={true} onClose={onClose} />);
      fireEvent.change(screen.getByTestId("command-palette-input"), {
        target: { value: "@silk" },
      });
      await advanceDebounce();
      expect(callCount).toBe(1);

      // Re-register annotation provider with a NEW object reference (same id/prefix)
      registry.register({
        id: "annotations",
        prefix: "@",
        label: "Annotations",
        priority: 20,
        filterOptions: [],
        async search(query: string) {
          const { searchAnnotations } = await import("../lib/ipc");
          const results = await searchAnnotations(query);
          return results.map((r) => ({
            id: `annotation-${r.annotation_id}`,
            title: r.node_title,
            section: "Annotations",
          }));
        },
        onSelect() {},
      });

      // Re-render — the effect should NOT re-fire since prefix+query+filter are unchanged
      rerender(<CommandPalette open={true} onClose={onClose} />);
      await advanceDebounce();
      expect(callCount).toBe(1);
    });

    it("arrow keys navigate correctly across multiple sections", async () => {
      mockInvoke((cmd) => {
        if (cmd === "search_annotations") return [mockResults[0]!, mockResults[1]!];
        return [];
      });
      render(<CommandPalette open={true} onClose={onClose} />);
      fireEvent.change(screen.getByTestId("command-palette-input"), {
        target: { value: "insert" },
      });
      await advanceDebounce();
      // Should have annotations section + commands section
      const results = screen.getAllByTestId("command-palette-result");
      expect(results.length).toBe(3); // 2 annotations + 1 command

      // First item active
      expect(results[0]!.getAttribute("data-active")).toBe("true");
      expect(results[1]!.getAttribute("data-active")).toBe("false");
      expect(results[2]!.getAttribute("data-active")).toBe("false");

      // ArrowDown → second item (still in first section)
      fireEvent.keyDown(screen.getByTestId("command-palette-input"), { key: "ArrowDown" });
      expect(results[0]!.getAttribute("data-active")).toBe("false");
      expect(results[1]!.getAttribute("data-active")).toBe("true");
      expect(results[2]!.getAttribute("data-active")).toBe("false");

      // ArrowDown → third item (crosses into second section)
      fireEvent.keyDown(screen.getByTestId("command-palette-input"), { key: "ArrowDown" });
      expect(results[0]!.getAttribute("data-active")).toBe("false");
      expect(results[1]!.getAttribute("data-active")).toBe("false");
      expect(results[2]!.getAttribute("data-active")).toBe("true");

      // ArrowDown → wraps back to first
      fireEvent.keyDown(screen.getByTestId("command-palette-input"), { key: "ArrowDown" });
      expect(results[0]!.getAttribute("data-active")).toBe("true");

      // ArrowUp from first → wraps to last (third item, second section)
      fireEvent.keyDown(screen.getByTestId("command-palette-input"), { key: "ArrowUp" });
      expect(results[2]!.getAttribute("data-active")).toBe("true");
    });
  });

  describe("search error handling", () => {
    it("prefix mode: shows 'Search failed' when provider rejects", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      mockInvoke((cmd) => {
        if (cmd === "search_annotations") throw new Error("IPC timeout");
        return [];
      });
      render(<CommandPalette open={true} onClose={onClose} />);
      fireEvent.change(screen.getByTestId("command-palette-input"), {
        target: { value: "@silk" },
      });
      await advanceDebounce();
      expect(screen.getByTestId("search-error-message")).toHaveTextContent("Search failed");
      expect(screen.queryByText("No results")).not.toBeInTheDocument();
      expect(screen.queryAllByTestId("command-palette-result")).toHaveLength(0);
      expect(warnSpy).toHaveBeenCalledWith(
        "[CommandPalette] search failed:",
        expect.any(Error),
      );
      warnSpy.mockRestore();
    });

    it("prefix mode: error clears on subsequent success", async () => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      let shouldFail = true;
      mockInvoke((cmd) => {
        if (cmd === "search_annotations") {
          if (shouldFail) throw new Error("IPC timeout");
          return mockResults;
        }
        return [];
      });
      render(<CommandPalette open={true} onClose={onClose} />);
      fireEvent.change(screen.getByTestId("command-palette-input"), {
        target: { value: "@silk" },
      });
      await advanceDebounce();
      expect(screen.getByTestId("search-error-message")).toBeInTheDocument();

      shouldFail = false;
      fireEvent.change(screen.getByTestId("command-palette-input"), {
        target: { value: "@silk road" },
      });
      await advanceDebounce();
      expect(screen.queryByTestId("search-error-message")).not.toBeInTheDocument();
      expect(screen.getAllByTestId("command-palette-result")).toHaveLength(3);
      vi.mocked(console.warn).mockRestore();
    });

    it("omni mode: one failing provider still shows other results", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      mockInvoke((cmd) => {
        if (cmd === "search_annotations") throw new Error("IPC timeout");
        return [];
      });
      render(<CommandPalette open={true} onClose={onClose} />);
      fireEvent.change(screen.getByTestId("command-palette-input"), {
        target: { value: "insert" },
      });
      await advanceDebounce();
      const results = screen.getAllByTestId("command-palette-result");
      expect(results.length).toBeGreaterThan(0);
      expect(screen.queryByTestId("search-error-message")).not.toBeInTheDocument();
      expect(warnSpy).toHaveBeenCalledWith(
        "[CommandPalette] provider failed:",
        "annotations",
        expect.any(Error),
      );
      warnSpy.mockRestore();
    });

    it("omni mode: all failing shows 'Search failed'", async () => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      mockInvoke(() => {
        throw new Error("IPC timeout");
      });
      render(<CommandPalette open={true} onClose={onClose} />);
      fireEvent.change(screen.getByTestId("command-palette-input"), {
        target: { value: "silk" },
      });
      await advanceDebounce();
      expect(screen.getByTestId("search-error-message")).toHaveTextContent("Search failed");
      expect(screen.queryByText("No results")).not.toBeInTheDocument();
      vi.mocked(console.warn).mockRestore();
    });

    it("error clears when input is emptied", async () => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      mockInvoke((cmd) => {
        if (cmd === "search_annotations") throw new Error("IPC timeout");
        return [];
      });
      render(<CommandPalette open={true} onClose={onClose} />);
      fireEvent.change(screen.getByTestId("command-palette-input"), {
        target: { value: "@silk" },
      });
      await advanceDebounce();
      expect(screen.getByTestId("search-error-message")).toBeInTheDocument();

      fireEvent.change(screen.getByTestId("command-palette-input"), {
        target: { value: "" },
      });
      expect(screen.queryByTestId("search-error-message")).not.toBeInTheDocument();
      vi.mocked(console.warn).mockRestore();
    });

    it("omni mode: error clears on subsequent success", async () => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      let shouldFail = true;
      mockInvoke((cmd) => {
        if (cmd === "search_annotations") {
          if (shouldFail) throw new Error("IPC timeout");
          return mockResults;
        }
        return [];
      });
      render(<CommandPalette open={true} onClose={onClose} />);
      fireEvent.change(screen.getByTestId("command-palette-input"), {
        target: { value: "zzz-nomatch" },
      });
      await advanceDebounce();
      expect(screen.getByTestId("search-error-message")).toHaveTextContent("Search failed");

      shouldFail = false;
      fireEvent.change(screen.getByTestId("command-palette-input"), {
        target: { value: "silk" },
      });
      await advanceDebounce();
      expect(screen.queryByTestId("search-error-message")).not.toBeInTheDocument();
      expect(screen.getAllByTestId("command-palette-result").length).toBeGreaterThan(0);
      vi.mocked(console.warn).mockRestore();
    });

    it("error clears when palette reopens", async () => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      mockInvoke((cmd) => {
        if (cmd === "search_annotations") throw new Error("IPC timeout");
        return [];
      });
      const { rerender } = render(<CommandPalette open={true} onClose={onClose} />);
      fireEvent.change(screen.getByTestId("command-palette-input"), {
        target: { value: "@silk" },
      });
      await advanceDebounce();
      expect(screen.getByTestId("search-error-message")).toBeInTheDocument();

      rerender(<CommandPalette open={false} onClose={onClose} />);
      rerender(<CommandPalette open={true} onClose={onClose} />);
      expect(screen.queryByTestId("search-error-message")).not.toBeInTheDocument();
      vi.mocked(console.warn).mockRestore();
    });

    it("'Search failed' and 'No results' don't appear simultaneously", async () => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      mockInvoke((cmd) => {
        if (cmd === "search_annotations") throw new Error("IPC timeout");
        return [];
      });
      render(<CommandPalette open={true} onClose={onClose} />);
      fireEvent.change(screen.getByTestId("command-palette-input"), {
        target: { value: "@silk" },
      });
      await advanceDebounce();
      expect(screen.getByTestId("search-error-message")).toBeInTheDocument();
      expect(screen.queryByText("No results")).not.toBeInTheDocument();
      vi.mocked(console.warn).mockRestore();
    });
  });

  describe("stale search race condition", () => {
    it("prefix mode: stale result doesn't overwrite newer result", async () => {
      const deferreds: ReturnType<typeof createDeferred<PaletteResult[]>>[] = [];
      render(<CommandPalette open={true} onClose={onClose} />);
      registry.register({
        id: "annotations",
        prefix: "@",
        label: "Test",
        priority: 20,
        search() {
          const d = createDeferred<PaletteResult[]>();
          deferreds.push(d);
          return d.promise;
        },
        onSelect() {},
      });

      const input = screen.getByTestId("command-palette-input");
      fireEvent.change(input, { target: { value: "@silk" } });
      await advanceDebounce();
      fireEvent.change(input, { target: { value: "@silver" } });
      await advanceDebounce();

      expect(deferreds).toHaveLength(2);

      await act(async () => {
        deferreds[1]!.resolve([{ id: "r-silver", title: "Silver Result", section: "Test" }]);
      });
      expect(screen.getByText("Silver Result")).toBeInTheDocument();

      await act(async () => {
        deferreds[0]!.resolve([{ id: "r-silk", title: "Silk Result", section: "Test" }]);
      });
      expect(screen.getByText("Silver Result")).toBeInTheDocument();
      expect(screen.queryByText("Silk Result")).not.toBeInTheDocument();
    });

    it("omni mode: stale result doesn't overwrite newer result", async () => {
      const deferreds: ReturnType<typeof createDeferred<AnnotationSearchResult[]>>[] = [];
      mockInvoke((cmd) => {
        if (cmd === "search_annotations") {
          const d = createDeferred<AnnotationSearchResult[]>();
          deferreds.push(d);
          return d.promise;
        }
        return [];
      });
      render(<CommandPalette open={true} onClose={onClose} />);
      const input = screen.getByTestId("command-palette-input");

      fireEvent.change(input, { target: { value: "silk" } });
      await advanceDebounce();
      fireEvent.change(input, { target: { value: "silver" } });
      await advanceDebounce();

      expect(deferreds).toHaveLength(2);

      const silverResult: AnnotationSearchResult = {
        annotation_id: 10,
        node_id: "silver-mine.md",
        node_title: "Silver Mine",
        annotation_type: "note",
        certainty: "firm",
        body: "Silver mining operations",
        date: null,
        source_line: 1,
        char_start: 0,
        char_end: 10,
      };
      const silkResult: AnnotationSearchResult = {
        annotation_id: 11,
        node_id: "silk-road.md",
        node_title: "Silk Road",
        annotation_type: "note",
        certainty: "firm",
        body: "Ancient trade route",
        date: null,
        source_line: 1,
        char_start: 0,
        char_end: 10,
      };

      await act(async () => {
        deferreds[1]!.resolve([silverResult]);
      });
      expect(screen.getByText("Silver Mine")).toBeInTheDocument();

      await act(async () => {
        deferreds[0]!.resolve([silkResult]);
      });
      expect(screen.getByText("Silver Mine")).toBeInTheDocument();
      expect(screen.queryByText("Silk Road")).not.toBeInTheDocument();
    });

    it("prefix mode: stale error doesn't overwrite newer success", async () => {
      const deferreds: ReturnType<typeof createDeferred<PaletteResult[]>>[] = [];
      render(<CommandPalette open={true} onClose={onClose} />);
      registry.register({
        id: "annotations",
        prefix: "@",
        label: "Test",
        priority: 20,
        search() {
          const d = createDeferred<PaletteResult[]>();
          deferreds.push(d);
          return d.promise;
        },
        onSelect() {},
      });

      const input = screen.getByTestId("command-palette-input");
      fireEvent.change(input, { target: { value: "@silk" } });
      await advanceDebounce();
      fireEvent.change(input, { target: { value: "@silver" } });
      await advanceDebounce();

      expect(deferreds).toHaveLength(2);

      await act(async () => {
        deferreds[1]!.resolve([{ id: "r-silver", title: "Silver Result", section: "Test" }]);
      });
      expect(screen.getByText("Silver Result")).toBeInTheDocument();

      await act(async () => {
        deferreds[0]!.reject(new Error("IPC timeout"));
      });
      expect(screen.queryByTestId("search-error-message")).not.toBeInTheDocument();
      expect(screen.getByText("Silver Result")).toBeInTheDocument();
    });

    it("prefix mode: filter change discards stale result", async () => {
      const deferreds: ReturnType<typeof createDeferred<PaletteResult[]>>[] = [];
      render(<CommandPalette open={true} onClose={onClose} />);
      registry.register({
        id: "annotations",
        prefix: "@",
        label: "Test",
        priority: 20,
        filterOptions: [
          { id: "all", label: "All" },
          { id: "note", label: "Notes" },
        ],
        search() {
          const d = createDeferred<PaletteResult[]>();
          deferreds.push(d);
          return d.promise;
        },
        onSelect() {},
      });

      const input = screen.getByTestId("command-palette-input");
      fireEvent.change(input, { target: { value: "@silk" } });
      await advanceDebounce();

      fireEvent.click(screen.getByTestId("type-filter-note"));
      await advanceDebounce();

      expect(deferreds).toHaveLength(2);

      await act(async () => {
        deferreds[1]!.resolve([{ id: "r-filtered", title: "Filtered Result", section: "Test" }]);
      });
      expect(screen.getByText("Filtered Result")).toBeInTheDocument();

      await act(async () => {
        deferreds[0]!.resolve([{ id: "r-unfiltered", title: "Unfiltered Result", section: "Test" }]);
      });
      expect(screen.getByText("Filtered Result")).toBeInTheDocument();
      expect(screen.queryByText("Unfiltered Result")).not.toBeInTheDocument();
    });
  });
});
