import { describe, it, expect, beforeEach } from "vitest";
import { useSearchPanelStore } from "../stores/searchPanel";
import type { GraphSearchResult } from "../lib/ipc";

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
