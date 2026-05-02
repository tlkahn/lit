import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { CommandPalette } from "./CommandPalette";
import { mockInvoke } from "../test/tauri-mock";
import type { AnnotationSearchResult } from "../lib/ipc";

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

const { mockSelectPageAtLine, mockRecordJump, mockWorkspaceState } = vi.hoisted(() => {
  const mockSelectPageAtLine = vi.fn();
  const mockRecordJump = vi.fn();
  const mockWorkspaceState = {
    currentPagePath: "other-page.md" as string | null,
    selectPageAtLine: mockSelectPageAtLine,
  };
  return { mockSelectPageAtLine, mockRecordJump, mockWorkspaceState };
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
    mockRecordJump.mockClear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // Step 1: Modal shell — open/close/keyboard

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

  // Step 2: Prefix routing infrastructure

  describe("prefix routing", () => {
    it('typing "@silk" sets mode to annotations and strips prefix from query', () => {
      render(<CommandPalette open={true} onClose={onClose} />);
      fireEvent.change(screen.getByTestId("command-palette-input"), {
        target: { value: "@silk" },
      });
      expect(screen.getByTestId("command-palette-mode-badge")).toHaveTextContent("@");
    });

    it('typing "meeting" with no prefix sets mode to titles', () => {
      render(<CommandPalette open={true} onClose={onClose} />);
      fireEvent.change(screen.getByTestId("command-palette-input"), {
        target: { value: "meeting" },
      });
      expect(screen.queryByTestId("command-palette-mode-badge")).not.toBeInTheDocument();
    });

    it('typing "#tag" sets mode to tags', () => {
      render(<CommandPalette open={true} onClose={onClose} />);
      fireEvent.change(screen.getByTestId("command-palette-input"), {
        target: { value: "#tag" },
      });
      expect(screen.getByTestId("command-palette-mode-badge")).toHaveTextContent("#");
    });

    it('typing "/pattern" sets mode to content', () => {
      render(<CommandPalette open={true} onClose={onClose} />);
      fireEvent.change(screen.getByTestId("command-palette-input"), {
        target: { value: "/pattern" },
      });
      expect(screen.getByTestId("command-palette-mode-badge")).toHaveTextContent("/");
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

  // Step 3: Annotation search results (@ mode)

  describe("annotation search results", () => {
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

    it("shows type badge, page title, body snippet, and date for each result", async () => {
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
      expect(results[0]).toHaveTextContent("2024-03-15");
    });

    it("shows certainty mark for tentative/firm results", async () => {
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
      expect(results[0]).toHaveTextContent("!");
      expect(results[1]).toHaveTextContent("?");
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

  // Step 4: Keyboard navigation in results

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

  // Step 5: Click/select → navigate to annotation

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

  // Step 6: Type filter in annotation mode

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
  });

  // Step 7: Stub modes

  describe("stub modes", () => {
    it('no-prefix mode shows "Title search coming soon" placeholder', () => {
      render(<CommandPalette open={true} onClose={onClose} />);
      fireEvent.change(screen.getByTestId("command-palette-input"), {
        target: { value: "meeting" },
      });
      expect(screen.getByText("Title search coming soon")).toBeInTheDocument();
    });

    it('# mode shows "Tag search coming soon" placeholder', () => {
      render(<CommandPalette open={true} onClose={onClose} />);
      fireEvent.change(screen.getByTestId("command-palette-input"), {
        target: { value: "#tag" },
      });
      expect(screen.getByText("Tag search coming soon")).toBeInTheDocument();
    });

    it('/ mode shows "Content search coming soon" placeholder', () => {
      render(<CommandPalette open={true} onClose={onClose} />);
      fireEvent.change(screen.getByTestId("command-palette-input"), {
        target: { value: "/pattern" },
      });
      expect(screen.getByText("Content search coming soon")).toBeInTheDocument();
    });
  });
});
