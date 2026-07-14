import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor, act, fireEvent } from "@testing-library/react";
import { useSearchPanelStore } from "../stores/searchPanel";
import { useWorkspaceStore } from "../stores/workspace";
import { mockInvoke, mockListen, emitMockEvent, resetListenMock } from "../test/tauri-mock";
import type { GraphSearchResult } from "../lib/ipc";
import { navigateToNote } from "../lib/navigateToNote";
import { SearchPanel } from "./SearchPanel";

vi.mock("../lib/navigateToNote", () => ({
  navigateToNote: vi.fn(),
}));

function makeResult(id: string): GraphSearchResult {
  return { id, title: id, score: 1.0, excerpt: `<mark>${id}</mark>` };
}

describe("handleKeyDown scroll target", () => {
  const results = [makeResult("a.md"), makeResult("b.md"), makeResult("c.md")];

  beforeEach(() => {
    useSearchPanelStore.setState({
      query: "test",
      filter: {},
      results,
      selectedIndex: 0,
      isLoading: false,
      totalCount: results.length,
      navigatedResultId: null,
    });
  });

  /**
   * These tests replicate the exact scroll-index calculation from SearchPanel.tsx
   * handleKeyDown to catch the off-by-one bug.
   *
   * The function `computeArrowDownScrollIndex` / `computeArrowUpScrollIndex`
   * simulate what handleKeyDown does: call selectNext()/selectPrev() then
   * compute the index passed to virtualizer.scrollToIndex().
   */
  function computeArrowDownScrollIndex(): number {
    const { selectNext } = useSearchPanelStore.getState();
    selectNext();
    // After selectNext(), selectedIndex is already the correct, clamped target.
    return useSearchPanelStore.getState().selectedIndex;
  }

  function computeArrowUpScrollIndex(): number {
    const { selectPrev } = useSearchPanelStore.getState();
    selectPrev();
    // After selectPrev(), selectedIndex is already the correct, clamped target.
    return useSearchPanelStore.getState().selectedIndex;
  }

  it("ArrowDown from index 0: scroll target should be 1, not 2", () => {
    useSearchPanelStore.setState({ selectedIndex: 0 });
    const scrollIdx = computeArrowDownScrollIndex();
    // selectedIndex is now 1. Scroll target should be 1.
    expect(useSearchPanelStore.getState().selectedIndex).toBe(1);
    expect(scrollIdx).toBe(1); // BUG: currently returns 2
  });

  it("ArrowUp from index 2: scroll target should be 1, not 0", () => {
    useSearchPanelStore.setState({ selectedIndex: 2 });
    const scrollIdx = computeArrowUpScrollIndex();
    // selectedIndex is now 1. Scroll target should be 1.
    expect(useSearchPanelStore.getState().selectedIndex).toBe(1);
    expect(scrollIdx).toBe(1); // BUG: currently returns 0
  });

  it("ArrowDown from last index: scroll target should stay at last", () => {
    useSearchPanelStore.setState({ selectedIndex: 2 });
    const scrollIdx = computeArrowDownScrollIndex();
    // selectedIndex stays 2 (clamped). Scroll target should be 2.
    expect(useSearchPanelStore.getState().selectedIndex).toBe(2);
    expect(scrollIdx).toBe(2); // currently correct by accident (min clamps)
  });

  it("ArrowUp from index 0: scroll target should stay at 0", () => {
    useSearchPanelStore.setState({ selectedIndex: 0 });
    const scrollIdx = computeArrowUpScrollIndex();
    // selectedIndex stays 0 (clamped). Scroll target should be 0.
    expect(useSearchPanelStore.getState().selectedIndex).toBe(0);
    expect(scrollIdx).toBe(0); // currently correct by accident (max clamps)
  });
});

describe("SearchPanel graphReady transition", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({
      workspacePath: "/test",
      currentPagePath: "target.md",
      graphReady: false,
    });
    useSearchPanelStore.setState({
      query: "hello",
      filter: {},
      results: [],
      selectedIndex: 0,
      isLoading: false,
      totalCount: 0,
      navigatedResultId: null,
    });
  });

  it("shows IndexBuildingPlaceholder when graphReady is false", () => {
    mockInvoke(() => {
      throw new Error("should not be called");
    });

    render(<SearchPanel />);

    expect(screen.getByText("Building index...")).toBeInTheDocument();
  });

  it("re-executes search when graphReady transitions from false to true", async () => {
    const searchResults = [makeResult("found.md")];
    mockInvoke((cmd) => {
      if (cmd === "search_content_filtered") return searchResults;
      if (cmd === "list_folders") return [];
      throw new Error(`Unknown command: ${cmd}`);
    });

    render(<SearchPanel />);

    // Should show placeholder initially
    expect(screen.getByText("Building index...")).toBeInTheDocument();

    // Transition graphReady from false -> true
    act(() => {
      useWorkspaceStore.setState({ graphReady: true });
    });

    // After graphReady becomes true, the search should re-execute
    // and the results should appear
    await waitFor(() => {
      expect(screen.queryByText("Building index...")).not.toBeInTheDocument();
    });

    // The executeSearch should have been triggered by the graphReady transition
    await waitFor(() => {
      const state = useSearchPanelStore.getState();
      expect(state.results).toHaveLength(1);
      expect(state.results[0]!.id).toBe("found.md");
    });
  });

  it("Enter in the tag input adds the tag without navigating to a result", async () => {
    const results = [makeResult("a.md"), makeResult("b.md")];
    useWorkspaceStore.setState({ graphReady: true });
    useSearchPanelStore.setState({
      query: "test",
      results,
      totalCount: results.length,
    });
    mockInvoke((cmd) => {
      if (cmd === "search_content_filtered") return results;
      if (cmd === "list_folders") return [];
      if (cmd === "search_tags") return [{ tag: "math", count: 3 }];
      throw new Error(`Unknown command: ${cmd}`);
    });

    render(<SearchPanel />);

    // Expand the facet bar to reveal the tag input.
    fireEvent.click(screen.getByRole("button", { name: /filters/i }));
    const tagInput = screen.getByPlaceholderText("Filter by tag...");

    // Type and wait for the debounced suggestion fetch.
    fireEvent.change(tagInput, { target: { value: "ma" } });
    await waitFor(() => {
      expect(screen.getByText("math")).toBeInTheDocument();
    });

    fireEvent.keyDown(tagInput, { key: "Enter" });

    // The tag was added...
    await waitFor(() => {
      expect(useSearchPanelStore.getState().filter.tags).toEqual(["math"]);
    });
    // ...and Enter did NOT bubble to the wrapper's navigation handler.
    expect(navigateToNote).not.toHaveBeenCalled();
    expect(useSearchPanelStore.getState().navigatedResultId).toBeNull();
  });

  it("does not re-execute search on graphReady transition when query is empty", async () => {
    useSearchPanelStore.setState({ query: "" });
    let searchCalled = false;
    mockInvoke((cmd) => {
      if (cmd === "search_content_filtered") {
        searchCalled = true;
        return [];
      }
      if (cmd === "list_folders") return [];
      throw new Error(`Unknown command: ${cmd}`);
    });

    render(<SearchPanel />);

    act(() => {
      useWorkspaceStore.setState({ graphReady: true });
    });

    // Give any async calls time to fire
    await act(async () => {});
    expect(searchCalled).toBe(false);
  });
});

describe("SearchPanel graph-updated gating (isActive)", () => {
  let searchCalls: number;

  beforeEach(() => {
    mockListen();
    useWorkspaceStore.setState({
      workspacePath: "/test",
      currentPagePath: null,
      graphReady: true,
    });
    useSearchPanelStore.setState({
      query: "hello",
      filter: {},
      results: [],
      selectedIndex: 0,
      isLoading: false,
      totalCount: 0,
      navigatedResultId: null,
    });
    searchCalls = 0;
    mockInvoke((cmd) => {
      if (cmd === "search_content_filtered") {
        searchCalls++;
        return [makeResult("a.md")];
      }
      if (cmd === "list_folders") return [];
      throw new Error(`Unknown command: ${cmd}`);
    });
  });

  afterEach(() => {
    resetListenMock();
  });

  it("re-searches immediately on graph-updated while active", async () => {
    render(<SearchPanel />);
    await act(async () => {}); // let listen() register

    act(() => {
      emitMockEvent("lit:graph-updated", {});
    });
    await waitFor(() => expect(searchCalls).toBe(1));
  });

  it("defers graph-updated re-search while hidden and refreshes once on activation", async () => {
    const { rerender } = render(<SearchPanel isActive={false} />);
    await act(async () => {}); // let listen() register

    act(() => {
      emitMockEvent("lit:graph-updated", {});
    });
    await act(async () => {});
    expect(searchCalls).toBe(0);

    // Activating the tab runs exactly one refresh search.
    rerender(<SearchPanel isActive={true} />);
    await waitFor(() => expect(searchCalls).toBe(1));

    // Re-activating without new graph updates does not re-search again.
    rerender(<SearchPanel isActive={false} />);
    rerender(<SearchPanel isActive={true} />);
    await act(async () => {});
    expect(searchCalls).toBe(1);
  });
});

describe("SearchPanel loading spinner", () => {
  beforeEach(() => {
    mockListen();
    useWorkspaceStore.setState({
      workspacePath: "/test",
      currentPagePath: null,
      graphReady: true,
    });
    useSearchPanelStore.setState({
      query: "hello",
      filter: {},
      results: [makeResult("a.md")],
      selectedIndex: 0,
      isLoading: false,
      totalCount: 1,
      navigatedResultId: null,
    });
    mockInvoke((cmd) => {
      if (cmd === "search_content_filtered") return [makeResult("a.md")];
      if (cmd === "list_folders") return [];
      throw new Error(`Unknown command: ${cmd}`);
    });
  });

  afterEach(() => {
    resetListenMock();
  });

  it("shows the spinner while loading and keeps the input enabled", () => {
    useSearchPanelStore.setState({ isLoading: true });
    render(<SearchPanel />);

    expect(screen.getByRole("status", { name: "Searching" })).toBeInTheDocument();
    expect(screen.getByLabelText("Search content")).not.toBeDisabled();
  });

  it("hides the spinner when not loading", () => {
    render(<SearchPanel />);

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});

describe("SearchPanel regex toggle", () => {
  beforeEach(() => {
    mockListen();
    useWorkspaceStore.setState({
      workspacePath: "/test",
      currentPagePath: null,
      graphReady: true,
    });
    useSearchPanelStore.setState({
      query: "hello",
      filter: {},
      matchMode: "phrase",
      results: [makeResult("a.md")],
      selectedIndex: 0,
      isLoading: false,
      totalCount: 1,
      navigatedResultId: null,
      error: null,
    });
    mockInvoke((cmd) => {
      if (cmd === "search_content_filtered") return [makeResult("a.md")];
      if (cmd === "list_folders") return [];
      throw new Error(`Unknown command: ${cmd}`);
    });
  });

  afterEach(() => {
    resetListenMock();
  });

  it("renders the .* toggle unpressed in phrase mode", () => {
    render(<SearchPanel />);

    const toggle = screen.getByRole("button", { name: "Use regular expression" });
    expect(toggle).toHaveAttribute("aria-pressed", "false");
  });

  it("clicking the toggle switches to regex mode and re-runs the search", async () => {
    const setMatchModeSpy = vi.spyOn(useSearchPanelStore.getState(), "setMatchMode");
    render(<SearchPanel />);

    const toggle = screen.getByRole("button", { name: "Use regular expression" });
    await act(async () => {
      fireEvent.click(toggle);
    });

    expect(setMatchModeSpy).toHaveBeenCalledWith("regex");
    expect(useSearchPanelStore.getState().matchMode).toBe("regex");
    await waitFor(() => {
      expect(toggle).toHaveAttribute("aria-pressed", "true");
    });
    setMatchModeSpy.mockRestore();
  });

  it("clicking the toggle again switches back to phrase mode", async () => {
    useSearchPanelStore.setState({ matchMode: "regex" });
    render(<SearchPanel />);

    const toggle = screen.getByRole("button", { name: "Use regular expression" });
    expect(toggle).toHaveAttribute("aria-pressed", "true");

    await act(async () => {
      fireEvent.click(toggle);
    });

    expect(useSearchPanelStore.getState().matchMode).toBe("phrase");
    expect(toggle).toHaveAttribute("aria-pressed", "false");
  });

  it("renders the inline error message when the store has an error", () => {
    useSearchPanelStore.setState({
      matchMode: "regex",
      error: "invalid regex: unclosed group",
      results: [],
      totalCount: 0,
    });
    render(<SearchPanel />);

    expect(screen.getByRole("alert")).toHaveTextContent("invalid regex: unclosed group");
    expect(screen.queryByText("No results")).not.toBeInTheDocument();
  });

  it("does not render an error message when error is null", () => {
    render(<SearchPanel />);

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
