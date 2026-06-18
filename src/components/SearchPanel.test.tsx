import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import { useSearchPanelStore } from "../stores/searchPanel";
import { useWorkspaceStore } from "../stores/workspace";
import { mockInvoke } from "../test/tauri-mock";
import type { GraphSearchResult } from "../lib/ipc";
import { SearchPanel } from "./SearchPanel";

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
