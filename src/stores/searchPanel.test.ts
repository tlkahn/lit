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

  // --- scroll target after selectNext / selectPrev (handleKeyDown contract) ---
  // After selectNext()/selectPrev(), the caller should scroll to getState().selectedIndex
  // directly -- no additional +1 or -1 arithmetic.

  it("scroll target after selectNext equals selectedIndex (no +1 needed)", () => {
    const results = [makeResult("a.md", "A"), makeResult("b.md", "B"), makeResult("c.md", "C")];
    useSearchPanelStore.setState({ results, selectedIndex: 0 });

    useSearchPanelStore.getState().selectNext();
    const scrollTarget = useSearchPanelStore.getState().selectedIndex;

    // After pressing ArrowDown from index 0, we selected index 1.
    // The scroll target should be 1 (the newly selected item), NOT 2.
    expect(scrollTarget).toBe(1);
  });

  it("scroll target after selectPrev equals selectedIndex (no -1 needed)", () => {
    const results = [makeResult("a.md", "A"), makeResult("b.md", "B"), makeResult("c.md", "C")];
    useSearchPanelStore.setState({ results, selectedIndex: 2 });

    useSearchPanelStore.getState().selectPrev();
    const scrollTarget = useSearchPanelStore.getState().selectedIndex;

    // After pressing ArrowUp from index 2, we selected index 1.
    // The scroll target should be 1 (the newly selected item), NOT 0.
    expect(scrollTarget).toBe(1);
  });

  it("scroll target after selectNext at last item stays at last index", () => {
    const results = [makeResult("a.md", "A"), makeResult("b.md", "B")];
    useSearchPanelStore.setState({ results, selectedIndex: 1 });

    useSearchPanelStore.getState().selectNext();
    const scrollTarget = useSearchPanelStore.getState().selectedIndex;

    // Already at the end (index 1), selectNext clamps. Scroll target = 1.
    expect(scrollTarget).toBe(1);
  });

  it("scroll target after selectPrev at first item stays at 0", () => {
    const results = [makeResult("a.md", "A"), makeResult("b.md", "B")];
    useSearchPanelStore.setState({ results, selectedIndex: 0 });

    useSearchPanelStore.getState().selectPrev();
    const scrollTarget = useSearchPanelStore.getState().selectedIndex;

    // Already at the start (index 0), selectPrev clamps. Scroll target = 0.
    expect(scrollTarget).toBe(0);
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

  // --- mtime filter values must be epoch milliseconds ---

  it("date filter values are epoch milliseconds (matching Rust mtime)", async () => {
    let receivedArgs: Record<string, unknown> | undefined;
    mockInvoke((cmd, args) => {
      if (cmd === "search_content_filtered") {
        receivedArgs = args;
        return [];
      }
      return null;
    });

    // Simulate "last 7 days" filter: mtime_after should be ~7 days ago in milliseconds
    const now = Date.now(); // milliseconds
    const sevenDaysMs = 7 * 86_400_000;
    const mtimeAfter = now - sevenDaysMs;

    useSearchPanelStore.setState({ query: "test" });
    useSearchPanelStore.getState().setFilter({ mtime_after: mtimeAfter });
    await vi.runAllTimersAsync();

    expect(receivedArgs).toBeDefined();
    const filterSent = receivedArgs!.filter as { mtime_after?: number };
    expect(filterSent.mtime_after).toBeDefined();

    // The value must be in milliseconds (> 1_000_000_000_000).
    // If it were in seconds it would be ~1_700_000_000 (< 1 trillion).
    expect(filterSent.mtime_after!).toBeGreaterThan(1_000_000_000_000);
  });

  // --- refreshOnGraphUpdate ---

  it("executeSearch re-runs when called with an active query (simulating graph-updated)", async () => {
    let callCount = 0;
    mockInvoke((cmd) => {
      if (cmd === "search_content_filtered") {
        callCount++;
        if (callCount === 1) return [makeResult("v1.md", "Version 1")];
        return [makeResult("v1.md", "Version 1"), makeResult("v2.md", "Version 2")];
      }
      return null;
    });

    // Set up an active search
    useSearchPanelStore.getState().setQuery("test");
    vi.advanceTimersByTime(200);
    await vi.runAllTimersAsync();
    expect(useSearchPanelStore.getState().results).toHaveLength(1);
    expect(useSearchPanelStore.getState().results[0]!.id).toBe("v1.md");
    expect(callCount).toBe(1);

    // Directly call executeSearch (what the graph-updated listener should do)
    await useSearchPanelStore.getState().executeSearch();

    expect(callCount).toBe(2);
    expect(useSearchPanelStore.getState().results).toHaveLength(2);
    expect(useSearchPanelStore.getState().results[1]!.id).toBe("v2.md");
  });
});
