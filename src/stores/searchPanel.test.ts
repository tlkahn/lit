import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { mockInvoke } from "../test/tauri-mock";
import type { GraphSearchResult } from "../lib/ipc";

// Must import the store after mock setup (setup.ts mocks @tauri-apps/api/core)
import { useSearchPanelStore } from "./searchPanel";

function makeResult(id: string, title: string, score = 1.0): GraphSearchResult {
  return { id, title, score, excerpt: `<mark>${title}</mark> match` };
}

describe("searchPanel store", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useSearchPanelStore.setState({
      query: "",
      filter: {},
      results: [],
      selectedIndex: 0,
      isLoading: false,
      totalCount: 0,
      navigatedResultId: null,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // --- Initial state ---

  it("has correct initial state", () => {
    const state = useSearchPanelStore.getState();
    expect(state.query).toBe("");
    expect(state.filter).toEqual({});
    expect(state.results).toEqual([]);
    expect(state.selectedIndex).toBe(0);
    expect(state.isLoading).toBe(false);
    expect(state.totalCount).toBe(0);
    expect(state.navigatedResultId).toBeNull();
  });

  // --- setQuery ---

  it("setQuery updates query and resets selectedIndex", () => {
    useSearchPanelStore.setState({ selectedIndex: 5 });
    useSearchPanelStore.getState().setQuery("hello");
    expect(useSearchPanelStore.getState().query).toBe("hello");
    expect(useSearchPanelStore.getState().selectedIndex).toBe(0);
  });

  it("setQuery with empty string clears results immediately", () => {
    useSearchPanelStore.setState({
      results: [makeResult("a.md", "A")],
      totalCount: 1,
      isLoading: true,
    });
    useSearchPanelStore.getState().setQuery("");
    const state = useSearchPanelStore.getState();
    expect(state.results).toEqual([]);
    expect(state.totalCount).toBe(0);
    expect(state.isLoading).toBe(false);
  });

  it("setQuery debounces IPC call", async () => {
    const results = [makeResult("a.md", "Alpha")];
    mockInvoke((cmd) => {
      if (cmd === "search_content_filtered") return results;
      return null;
    });

    useSearchPanelStore.getState().setQuery("alpha");
    // Should not have called IPC yet
    expect(useSearchPanelStore.getState().results).toEqual([]);
    expect(useSearchPanelStore.getState().isLoading).toBe(true);

    // Advance past debounce
    vi.advanceTimersByTime(200);
    await vi.runAllTimersAsync();

    // Results should now be populated
    expect(useSearchPanelStore.getState().results).toEqual(results);
    expect(useSearchPanelStore.getState().totalCount).toBe(1);
    expect(useSearchPanelStore.getState().isLoading).toBe(false);
  });

  // --- setFilter ---

  it("setFilter merges partial filter", () => {
    useSearchPanelStore.getState().setFilter({ folder_prefix: "notes/" });
    expect(useSearchPanelStore.getState().filter).toEqual({ folder_prefix: "notes/" });

    useSearchPanelStore.getState().setFilter({ tags: ["math"] });
    expect(useSearchPanelStore.getState().filter).toEqual({
      folder_prefix: "notes/",
      tags: ["math"],
    });
  });

  it("setFilter removes undefined keys", () => {
    useSearchPanelStore.setState({ filter: { folder_prefix: "notes/", tags: ["math"] } });
    useSearchPanelStore.getState().setFilter({ folder_prefix: undefined });
    expect(useSearchPanelStore.getState().filter).toEqual({ tags: ["math"] });
  });

  it("setFilter triggers immediate search (no debounce)", async () => {
    const results = [makeResult("a.md", "Alpha")];
    mockInvoke((cmd) => {
      if (cmd === "search_content_filtered") return results;
      return null;
    });

    // Set a query first so executeSearch does work
    useSearchPanelStore.setState({ query: "alpha" });
    useSearchPanelStore.getState().setFilter({ folder_prefix: "notes/" });

    // Should trigger immediately (after microtask for the async IPC)
    await vi.runAllTimersAsync();

    expect(useSearchPanelStore.getState().results).toEqual(results);
  });

  // --- clearFilter ---

  it("clearFilter resets filter to empty", () => {
    useSearchPanelStore.setState({
      filter: { folder_prefix: "notes/", tags: ["math"], mtime_after: 100 },
    });
    useSearchPanelStore.getState().clearFilter();
    expect(useSearchPanelStore.getState().filter).toEqual({});
  });

  // --- selectIndex ---

  it("selectIndex sets selectedIndex", () => {
    useSearchPanelStore.getState().selectIndex(3);
    expect(useSearchPanelStore.getState().selectedIndex).toBe(3);
  });

  // --- selectNext / selectPrev ---

  it("selectNext increments index within bounds", () => {
    useSearchPanelStore.setState({
      results: [makeResult("a.md", "A"), makeResult("b.md", "B"), makeResult("c.md", "C")],
      selectedIndex: 0,
    });
    useSearchPanelStore.getState().selectNext();
    expect(useSearchPanelStore.getState().selectedIndex).toBe(1);
  });

  it("selectNext clamps at last index", () => {
    useSearchPanelStore.setState({
      results: [makeResult("a.md", "A"), makeResult("b.md", "B")],
      selectedIndex: 1,
    });
    useSearchPanelStore.getState().selectNext();
    expect(useSearchPanelStore.getState().selectedIndex).toBe(1);
  });

  it("selectPrev decrements index within bounds", () => {
    useSearchPanelStore.setState({
      results: [makeResult("a.md", "A"), makeResult("b.md", "B")],
      selectedIndex: 1,
    });
    useSearchPanelStore.getState().selectPrev();
    expect(useSearchPanelStore.getState().selectedIndex).toBe(0);
  });

  it("selectPrev clamps at 0", () => {
    useSearchPanelStore.setState({
      results: [makeResult("a.md", "A"), makeResult("b.md", "B")],
      selectedIndex: 0,
    });
    useSearchPanelStore.getState().selectPrev();
    expect(useSearchPanelStore.getState().selectedIndex).toBe(0);
  });

  it("selectNext does nothing with empty results", () => {
    useSearchPanelStore.setState({ results: [], selectedIndex: 0 });
    useSearchPanelStore.getState().selectNext();
    expect(useSearchPanelStore.getState().selectedIndex).toBe(0);
  });

  // --- executeSearch stale-request handling ---

  it("drops stale search responses", async () => {
    // Simulate a slow first response that arrives after a second search is dispatched.
    // We use requestId tracking: if a newer executeSearch increments requestId,
    // the stale response should be discarded.
    let resolveFirst: ((v: GraphSearchResult[]) => void) | null = null;
    let callCount = 0;
    mockInvoke((cmd) => {
      if (cmd === "search_content_filtered") {
        callCount++;
        if (callCount === 1) {
          // First call: return a promise that we resolve later (simulates slow response)
          return new Promise<GraphSearchResult[]>((resolve) => {
            resolveFirst = resolve;
          });
        }
        return [makeResult("fresh.md", "Fresh")];
      }
      return null;
    });

    // Fire first search
    useSearchPanelStore.getState().setQuery("first");
    vi.advanceTimersByTime(200); // debounce fires, IPC call #1 dispatched (pending)

    // Fire second search while first is still pending
    useSearchPanelStore.getState().setQuery("second");
    vi.advanceTimersByTime(200); // debounce fires, IPC call #2 dispatched
    await vi.runAllTimersAsync();

    // Second call resolved immediately with "fresh" -- should be in store
    expect(useSearchPanelStore.getState().results[0]!.id).toBe("fresh.md");

    // Now resolve the stale first response
    resolveFirst!([makeResult("stale.md", "Stale")]);
    await vi.runAllTimersAsync();

    // Store should still show the fresh result, not the stale one
    const results = useSearchPanelStore.getState().results;
    expect(results).toHaveLength(1);
    expect(results[0]!.id).toBe("fresh.md");
  });

  // --- navigatedResultId ---

  it("setNavigatedResultId sets the navigated result", () => {
    useSearchPanelStore.getState().setNavigatedResultId("note.md");
    expect(useSearchPanelStore.getState().navigatedResultId).toBe("note.md");
  });

  it("setNavigatedResultId can be cleared with null", () => {
    useSearchPanelStore.getState().setNavigatedResultId("note.md");
    useSearchPanelStore.getState().setNavigatedResultId(null);
    expect(useSearchPanelStore.getState().navigatedResultId).toBeNull();
  });

  it("setQuery resets navigatedResultId", () => {
    useSearchPanelStore.getState().setNavigatedResultId("note.md");
    useSearchPanelStore.getState().setQuery("new query");
    expect(useSearchPanelStore.getState().navigatedResultId).toBeNull();
  });

  it("executeSearch resets navigatedResultId", async () => {
    mockInvoke((cmd) => {
      if (cmd === "search_content_filtered") return [makeResult("a.md", "A")];
      return null;
    });

    useSearchPanelStore.setState({ query: "test" });
    useSearchPanelStore.getState().setNavigatedResultId("old.md");
    useSearchPanelStore.getState().executeSearch();
    await vi.runAllTimersAsync();

    expect(useSearchPanelStore.getState().navigatedResultId).toBeNull();
  });

  // --- executeSearch passes filter to IPC ---

  it("passes filter to IPC call", async () => {
    let receivedArgs: Record<string, unknown> | undefined;
    mockInvoke((cmd, args) => {
      if (cmd === "search_content_filtered") {
        receivedArgs = args;
        return [];
      }
      return null;
    });

    useSearchPanelStore.setState({ filter: { folder_prefix: "notes/", tags: ["math"] } });
    useSearchPanelStore.getState().setQuery("calc");
    vi.advanceTimersByTime(200);
    await vi.runAllTimersAsync();

    expect(receivedArgs).toBeDefined();
    expect(receivedArgs!.filter).toEqual({ folder_prefix: "notes/", tags: ["math"] });
  });
});
