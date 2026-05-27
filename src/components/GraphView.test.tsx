import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { mockInvoke, mockListen, emitMockEvent, resetListenMock } from "../test/tauri-mock";
import * as graphLayout from "../lib/graphLayout";
import * as qualityTiers from "../lib/qualityTiers";
import { useGraphSelectionStore } from "../stores/graphSelection";
import { useGraphViewState } from "../stores/graphViewState";

const mockSigmaKill = vi.fn();
const mockSigmaOn = vi.fn();
const mockSigmaOff = vi.fn();
const mockSigmaSetSetting = vi.fn();
const mockCameraAnimatedReset = vi.fn();
const mockCameraAnimate = vi.fn();
const mockGetNodeDisplayData = vi.fn().mockReturnValue({ x: 0, y: 0 });
const mockSigmaRefresh = vi.fn();
const dimColorRef = () =>
  getComputedStyle(document.documentElement).getPropertyValue("--background-modifier-border").trim() || "#d1d9e0";
let lastSigmaOptions: Record<string, unknown> = {};

vi.mock("sigma", () => ({
  default: class MockSigma {
    kill = mockSigmaKill;
    on = mockSigmaOn;
    off = mockSigmaOff;
    setSetting = mockSigmaSetSetting;
    getCamera = () => ({ animatedReset: mockCameraAnimatedReset, animate: mockCameraAnimate });
    getNodeDisplayData = mockGetNodeDisplayData;
    refresh = mockSigmaRefresh;
    constructor(_graph: unknown, _container: unknown, options?: Record<string, unknown>) {
      lastSigmaOptions = options ?? {};
    }
  },
}));

vi.mock("@sigma/node-border", () => ({
  createNodeBorderProgram: () => class MockProgram {},
}));

describe("GraphView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lastSigmaOptions = {};
    useGraphSelectionStore.setState({ selectedNodes: [], selectionMode: "none" });
    useGraphViewState.setState({ mode: "full", depth: 2 });
    mockInvoke((cmd) => {
      switch (cmd) {
        case "get_graph_subgraph":
          return {
            nodes: [
              { id: "a.md", title: "A" },
              { id: "b.md", title: "B" },
            ],
            edges: [["a.md", "b.md"]],
            pagerank: { "a.md": 0.4, "b.md": 0.6 },
            positions: {},
          };
        case "get_graph_positions":
          return {};
        default:
          throw new Error(`Unknown command: ${cmd}`);
      }
    });
  });

  it("renders graph-view container", async () => {
    const GraphView = (await import("./GraphView")).default;
    render(<GraphView />);
    expect(screen.getByTestId("graph-view")).toBeTruthy();
  });

  it("full mode (default) calls getFullSubgraph (single IPC call)", async () => {
    const GraphView = (await import("./GraphView")).default;
    render(<GraphView />);
    const { invoke } = await import("@tauri-apps/api/core");
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("get_graph_subgraph", { seeds: [], depth: 0, directed: null });
    });
    expect(invoke).not.toHaveBeenCalledWith("get_pagerank", expect.anything());
  });

  it("shows loading state while fetching", async () => {
    const GraphView = (await import("./GraphView")).default;
    render(<GraphView />);
    expect(screen.getByTestId("graph-loading")).toBeTruthy();
  });

  it("calls sigma.kill on unmount", async () => {
    const GraphView = (await import("./GraphView")).default;
    const { unmount } = render(<GraphView />);
    await waitFor(() => {
      expect(mockSigmaKill).not.toHaveBeenCalled();
    });
    unmount();
    expect(mockSigmaKill).toHaveBeenCalled();
  });

  it("shows error state when IPC fails", async () => {
    mockInvoke(() => {
      throw new Error("IPC failure");
    });
    const GraphView = (await import("./GraphView")).default;
    render(<GraphView />);
    await waitFor(() => {
      expect(screen.getByTestId("graph-error")).toBeTruthy();
    });
    expect(screen.getByTestId("graph-error").textContent).toBe("IPC failure");
  });

  it("canvas container fills parent via absolute positioning", async () => {
    const GraphView = (await import("./GraphView")).default;
    render(<GraphView />);
    const canvas = screen.getByTestId("graph-canvas");
    expect(canvas.style.position).toBe("absolute");
    expect(canvas.style.inset).toBe("0");
  });

  it("loading overlay and canvas container coexist as siblings", async () => {
    const GraphView = (await import("./GraphView")).default;
    render(<GraphView />);
    const graphView = screen.getByTestId("graph-view");
    const loading = screen.getByTestId("graph-loading");
    const canvas = screen.getByTestId("graph-canvas");
    expect(loading.parentElement).toBe(graphView);
    expect(canvas.parentElement).toBe(graphView);
  });

  it("error overlay is inside graph-view container (not replacing it)", async () => {
    mockInvoke(() => { throw new Error("IPC failure"); });
    const GraphView = (await import("./GraphView")).default;
    render(<GraphView />);
    await waitFor(() => {
      expect(screen.getByTestId("graph-error")).toBeTruthy();
    });
    expect(screen.getByTestId("graph-view")).toBeTruthy();
    expect(screen.getByTestId("graph-error").closest("[data-testid='graph-view']")).toBeTruthy();
  });

  it("does not re-initialize sigma when onNavigate reference changes", async () => {
    const GraphView = (await import("./GraphView")).default;
    const onNav1 = vi.fn();
    const { rerender } = render(<GraphView onNavigate={onNav1} />);
    await waitFor(() => {
      expect(mockSigmaOn).toHaveBeenCalled();
    });
    mockSigmaKill.mockClear();
    mockSigmaOn.mockClear();

    const onNav2 = vi.fn();
    await act(async () => {
      rerender(<GraphView onNavigate={onNav2} />);
    });

    expect(mockSigmaKill).not.toHaveBeenCalled();
  });

  it("calls the latest onNavigate after rerender", async () => {
    const GraphView = (await import("./GraphView")).default;
    const onNav1 = vi.fn();
    const { rerender } = render(<GraphView onNavigate={onNav1} />);
    await waitFor(() => {
      expect(mockSigmaOn).toHaveBeenCalled();
    });

    const onNav2 = vi.fn();
    await act(async () => {
      rerender(<GraphView onNavigate={onNav2} />);
    });

    const clickNodeHandler = mockSigmaOn.mock.calls.find(
      (call) => call[0] === "clickNode",
    )?.[1];
    expect(clickNodeHandler).toBeDefined();
    clickNodeHandler!({ node: "a.md", event: { original: { metaKey: true } } });

    expect(onNav2).toHaveBeenCalledWith("a.md");
    expect(onNav1).not.toHaveBeenCalled();
  });

  it("uses theme CSS variables for graph node colors", async () => {
    document.documentElement.style.setProperty("--interactive-accent", "#ff0000");

    const populateGraphSpy = vi.spyOn(graphLayout, "populateGraph");

    const GraphView = (await import("./GraphView")).default;
    render(<GraphView />);

    await waitFor(() => {
      expect(populateGraphSpy).toHaveBeenCalled();
    });

    expect(populateGraphSpy.mock.calls[0]![2]).toBe("#ff0000");

    populateGraphSpy.mockRestore();
    document.documentElement.style.removeProperty("--interactive-accent");
  });

  it("no FA2 worker is started during init", async () => {
    const GraphView = (await import("./GraphView")).default;
    render(<GraphView />);
    await waitFor(() => {
      expect(mockSigmaOn).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(screen.queryByTestId("graph-loading")).not.toBeInTheDocument();
    });
    // No FA2 worker — positions come from bundled subgraph response
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).not.toHaveBeenCalledWith("get_graph_positions");
  });

  it("positions come from Rust IPC, not localStorage", async () => {
    localStorage.setItem("lit-graph-pos:/test/ws:full", JSON.stringify({
      positions: { "a.md": { x: 999, y: 999 }, "b.md": { x: 999, y: 999 } },
      timestamp: Date.now(),
    }));

    mockInvoke((cmd) => {
      switch (cmd) {
        case "get_graph_subgraph":
          return {
            nodes: [
              { id: "a.md", title: "A" },
              { id: "b.md", title: "B" },
            ],
            edges: [["a.md", "b.md"]],
            pagerank: { "a.md": 0.4, "b.md": 0.6 },
            positions: { "a.md": { x: 42, y: 42 }, "b.md": { x: 42, y: 42 } },
          };
        default:
          throw new Error(`Unknown command: ${cmd}`);
      }
    });

    const populateGraphSpy = vi.spyOn(graphLayout, "populateGraph");
    const GraphView = (await import("./GraphView")).default;
    render(<GraphView />);

    await waitFor(() => { expect(mockSigmaOn).toHaveBeenCalled(); });

    const graph = populateGraphSpy.mock.calls[0]![0] as import("graphology").default;
    expect(graph.getNodeAttribute("a.md", "x")).toBe(42);
    expect(graph.getNodeAttribute("a.md", "y")).toBe(42);

    populateGraphSpy.mockRestore();
    localStorage.removeItem("lit-graph-pos:/test/ws:full");
  });

  it("lit:layout-ready re-fetches Rust positions and refreshes sigma", async () => {
    mockListen();
    let posCallCount = 0;
    mockInvoke((cmd) => {
      switch (cmd) {
        case "get_graph_subgraph":
          return {
            nodes: [
              { id: "a.md", title: "A" },
              { id: "b.md", title: "B" },
            ],
            edges: [["a.md", "b.md"]],
            pagerank: { "a.md": 0.4, "b.md": 0.6 },
            positions: {},
          };
        case "get_graph_positions":
          posCallCount++;
          return { "a.md": { x: 100, y: 200 }, "b.md": { x: 300, y: 400 } };
        default:
          throw new Error(`Unknown command: ${cmd}`);
      }
    });

    const GraphView = (await import("./GraphView")).default;
    render(<GraphView />);
    await waitFor(() => { expect(mockSigmaOn).toHaveBeenCalled(); });

    mockSigmaRefresh.mockClear();
    mockCameraAnimatedReset.mockClear();

    await act(async () => {
      emitMockEvent("lit:layout-ready", {});
    });

    await waitFor(() => {
      expect(mockSigmaRefresh).toHaveBeenCalled();
    });
    expect(mockCameraAnimatedReset).toHaveBeenCalled();
    expect(posCallCount).toBe(1);

    resetListenMock();
  });

  // --- Toolbar & Mode tests ---

  it("renders GraphToolbar", async () => {
    const GraphView = (await import("./GraphView")).default;
    render(<GraphView />);
    expect(screen.getByRole("button", { name: "Full" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Local" })).toBeTruthy();
  });

  it("defaults to mode=full, depth=2", async () => {
    const GraphView = (await import("./GraphView")).default;
    render(<GraphView />);
    expect(screen.getByRole("button", { name: "Full" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.queryByRole("button", { name: "2" })).toBeNull();
  });

  it("switching to local mode shows depth controls and fetches subgraph", async () => {
    const GraphView = (await import("./GraphView")).default;
    render(<GraphView activePageId="a.md" />);
    await waitFor(() => {
      expect(mockSigmaOn).toHaveBeenCalled();
    });

    const { invoke } = await import("@tauri-apps/api/core");
    (invoke as unknown as ReturnType<typeof vi.fn>).mockClear();
    mockSigmaKill.mockClear();

    await act(async () => {
      await userEvent.click(screen.getByRole("button", { name: "Local" }));
    });

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("get_graph_subgraph", { seeds: ["a.md"], depth: 2, directed: null });
    });

    expect(screen.getByRole("button", { name: "2" })).toBeTruthy();
  });

  it("changing depth re-fetches with new depth", async () => {
    const GraphView = (await import("./GraphView")).default;
    render(<GraphView activePageId="a.md" />);
    await waitFor(() => { expect(mockSigmaOn).toHaveBeenCalled(); });

    await act(async () => {
      await userEvent.click(screen.getByRole("button", { name: "Local" }));
    });
    await waitFor(() => { expect(screen.getByRole("button", { name: "2" })).toBeTruthy(); });

    const { invoke } = await import("@tauri-apps/api/core");
    (invoke as unknown as ReturnType<typeof vi.fn>).mockClear();

    await act(async () => {
      await userEvent.click(screen.getByRole("button", { name: "3" }));
    });

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("get_graph_subgraph", { seeds: ["a.md"], depth: 3, directed: null });
    });
  });

  it("in local mode, populateGraph is called with seedId=activePageId", async () => {
    const populateGraphSpy = vi.spyOn(graphLayout, "populateGraph");
    const GraphView = (await import("./GraphView")).default;
    render(<GraphView activePageId="a.md" />);
    await waitFor(() => { expect(mockSigmaOn).toHaveBeenCalled(); });

    populateGraphSpy.mockClear();

    await act(async () => {
      await userEvent.click(screen.getByRole("button", { name: "Local" }));
    });

    await waitFor(() => {
      expect(populateGraphSpy).toHaveBeenCalled();
    });
    expect(populateGraphSpy.mock.calls[0]![3]).toBe("a.md");
    populateGraphSpy.mockRestore();
  });

  it("in full mode without activePageId, populateGraph is called without seedId", async () => {
    const populateGraphSpy = vi.spyOn(graphLayout, "populateGraph");
    const GraphView = (await import("./GraphView")).default;
    render(<GraphView />);

    await waitFor(() => {
      expect(populateGraphSpy).toHaveBeenCalled();
    });
    expect(populateGraphSpy.mock.calls[0]![3]).toBeUndefined();
    populateGraphSpy.mockRestore();
  });

  it("in full mode with activePageId, populateGraph is called with seedId", async () => {
    const populateGraphSpy = vi.spyOn(graphLayout, "populateGraph");
    const GraphView = (await import("./GraphView")).default;
    render(<GraphView activePageId="a.md" />);

    await waitFor(() => {
      expect(populateGraphSpy).toHaveBeenCalled();
    });
    expect(populateGraphSpy.mock.calls[0]![3]).toBe("a.md");
    populateGraphSpy.mockRestore();
  });

  it("enterNode sets nodeReducer on sigma", async () => {
    const GraphView = (await import("./GraphView")).default;
    render(<GraphView />);
    await waitFor(() => { expect(mockSigmaOn).toHaveBeenCalled(); });

    const enterNodeHandler = mockSigmaOn.mock.calls.find(
      (call) => call[0] === "enterNode",
    )?.[1];
    expect(enterNodeHandler).toBeDefined();
    mockSigmaSetSetting.mockClear();
    act(() => { enterNodeHandler!({ node: "a.md", event: { x: 100, y: 200 } }); });

    expect(mockSigmaSetSetting).toHaveBeenCalledWith("nodeReducer", expect.any(Function));
    const edgeReducerCall = mockSigmaSetSetting.mock.calls.find(
      (call) => call[0] === "edgeReducer",
    );
    expect(edgeReducerCall).toBeUndefined();
  });

  it("leaveNode clears reducers", async () => {
    const GraphView = (await import("./GraphView")).default;
    render(<GraphView />);
    await waitFor(() => { expect(mockSigmaOn).toHaveBeenCalled(); });

    const leaveNodeHandler = mockSigmaOn.mock.calls.find(
      (call) => call[0] === "leaveNode",
    )?.[1];
    expect(leaveNodeHandler).toBeDefined();
    act(() => { leaveNodeHandler!(); });

    const nodeReducerCall = mockSigmaSetSetting.mock.calls.find(
      (call) => call[0] === "nodeReducer" && typeof call[1] === "function",
    );
    expect(nodeReducerCall).toBeDefined();
    const reducer = nodeReducerCall![1] as (n: string, attrs: Record<string, unknown>) => Record<string, unknown>;
    const result = reducer("any", { color: "#fff", label: "Test" });
    expect(result.forceLabel).toBe(false);
    expect(mockSigmaSetSetting).toHaveBeenCalledWith("edgeReducer", null);
  });

  it("clickStage clears reducers", async () => {
    const GraphView = (await import("./GraphView")).default;
    render(<GraphView />);
    await waitFor(() => { expect(mockSigmaOn).toHaveBeenCalled(); });

    const clickStageHandler = mockSigmaOn.mock.calls.find(
      (call) => call[0] === "clickStage",
    )?.[1];
    expect(clickStageHandler).toBeDefined();
    mockSigmaSetSetting.mockClear();
    act(() => { clickStageHandler!(); });

    const nodeReducerCall = mockSigmaSetSetting.mock.calls.find(
      (call) => call[0] === "nodeReducer" && typeof call[1] === "function",
    );
    expect(nodeReducerCall).toBeDefined();
    const reducer = nodeReducerCall![1] as (n: string, attrs: Record<string, unknown>) => Record<string, unknown>;
    const result = reducer("any", { color: "#fff", label: "Test" });
    expect(result.forceLabel).toBe(false);
    expect(mockSigmaSetSetting).toHaveBeenCalledWith("edgeReducer", null);
  });

  it("reset zoom button triggers camera animatedReset", async () => {
    const GraphView = (await import("./GraphView")).default;
    render(<GraphView />);
    await waitFor(() => { expect(mockSigmaOn).toHaveBeenCalled(); });

    await userEvent.click(screen.getByRole("button", { name: "Reset zoom" }));
    expect(mockCameraAnimatedReset).toHaveBeenCalled();
  });

  it("no DOM tooltip is rendered on hover", async () => {
    const GraphView = (await import("./GraphView")).default;
    render(<GraphView />);
    await waitFor(() => { expect(mockSigmaOn).toHaveBeenCalled(); });

    const enterNodeHandler = mockSigmaOn.mock.calls.find(
      (call) => call[0] === "enterNode",
    )?.[1];
    act(() => { enterNodeHandler!({ node: "a.md", event: { x: 100, y: 200 } }); });

    expect(document.querySelector(".graph-tooltip")).toBeNull();
  });

  it("Local button is disabled when no activePageId", async () => {
    const GraphView = (await import("./GraphView")).default;
    render(<GraphView />);
    const localBtn = screen.getByRole("button", { name: "Local" });
    expect(localBtn).toBeDisabled();
  });

  it("Local button is enabled when activePageId is provided", async () => {
    const GraphView = (await import("./GraphView")).default;
    render(<GraphView activePageId="a.md" />);
    const localBtn = screen.getByRole("button", { name: "Local" });
    expect(localBtn).not.toBeDisabled();
  });


  it("enterNode sets cursor to pointer, leaveNode resets to grab", async () => {
    const GraphView = (await import("./GraphView")).default;
    render(<GraphView />);
    await waitFor(() => { expect(mockSigmaOn).toHaveBeenCalled(); });

    const canvas = screen.getByTestId("graph-canvas");
    expect(canvas.style.cursor).toBe("grab");

    const enterNodeHandler = mockSigmaOn.mock.calls.find(
      (call) => call[0] === "enterNode",
    )?.[1];
    act(() => { enterNodeHandler!({ node: "a.md", event: { x: 0, y: 0 } }); });
    expect(canvas.style.cursor).toBe("pointer");

    const leaveNodeHandler = mockSigmaOn.mock.calls.find(
      (call) => call[0] === "leaveNode",
    )?.[1];
    act(() => { leaveNodeHandler!(); });
    expect(canvas.style.cursor).toBe("grab");
  });

  // --- Search integration ---

  it("Cmd+F on graph container opens search overlay", async () => {
    const GraphView = (await import("./GraphView")).default;
    render(<GraphView />);
    await waitFor(() => { expect(mockSigmaOn).toHaveBeenCalled(); });

    const container = screen.getByTestId("graph-view");
    await act(async () => {
      container.dispatchEvent(new KeyboardEvent("keydown", { key: "f", metaKey: true, bubbles: true }));
    });

    expect(screen.getByTestId("graph-search")).toBeTruthy();
  });

  it("clicking toolbar search button opens search", async () => {
    const GraphView = (await import("./GraphView")).default;
    render(<GraphView />);
    await waitFor(() => { expect(mockSigmaOn).toHaveBeenCalled(); });

    await userEvent.click(screen.getByRole("button", { name: "Search graph" }));
    expect(screen.getByTestId("graph-search")).toBeTruthy();
  });

  it("search highlighting sets nodeReducer to dim non-matches", async () => {
    const GraphView = (await import("./GraphView")).default;
    render(<GraphView />);
    await waitFor(() => { expect(mockSigmaOn).toHaveBeenCalled(); });

    await userEvent.click(screen.getByRole("button", { name: "Search graph" }));
    mockSigmaSetSetting.mockClear();

    const input = screen.getByTestId("graph-search-input");
    await userEvent.type(input, "A");

    expect(mockSigmaSetSetting).toHaveBeenCalledWith("nodeReducer", expect.any(Function));
    expect(mockSigmaSetSetting).toHaveBeenCalledWith("edgeReducer", expect.any(Function));
  });

  it("closing search restores full visibility (clears reducers)", async () => {
    const GraphView = (await import("./GraphView")).default;
    render(<GraphView />);
    await waitFor(() => { expect(mockSigmaOn).toHaveBeenCalled(); });

    await userEvent.click(screen.getByRole("button", { name: "Search graph" }));
    const input = screen.getByTestId("graph-search-input");
    await userEvent.type(input, "A");

    mockSigmaSetSetting.mockClear();
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    // First Escape clears query
    mockSigmaSetSetting.mockClear();
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    // Second Escape closes search

    const nodeReducerCall = mockSigmaSetSetting.mock.calls.find(
      (call) => call[0] === "nodeReducer" && typeof call[1] === "function",
    );
    expect(nodeReducerCall).toBeDefined();
    const reducer = nodeReducerCall![1] as (n: string, attrs: Record<string, unknown>) => Record<string, unknown>;
    const result = reducer("any", { color: "#fff", label: "Test" });
    expect(result.forceLabel).toBe(false);
    expect(mockSigmaSetSetting).toHaveBeenCalledWith("edgeReducer", null);
  });

  // --- Escape to exit ---

  it("Escape on graph container (search closed) calls onExit", async () => {
    const onExit = vi.fn();
    const GraphView = (await import("./GraphView")).default;
    render(<GraphView onExit={onExit} />);
    await waitFor(() => { expect(mockSigmaOn).toHaveBeenCalled(); });

    const container = screen.getByTestId("graph-view");
    await act(async () => {
      container.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });

    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it("Escape when search is open does NOT call onExit", async () => {
    const onExit = vi.fn();
    const GraphView = (await import("./GraphView")).default;
    render(<GraphView onExit={onExit} />);
    await waitFor(() => { expect(mockSigmaOn).toHaveBeenCalled(); });

    await userEvent.click(screen.getByRole("button", { name: "Search graph" }));
    expect(screen.getByTestId("graph-search")).toBeTruthy();

    const input = screen.getByTestId("graph-search-input");
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });

    expect(onExit).not.toHaveBeenCalled();
  });

  it("Escape dispatched directly on container while search is open does NOT call onExit", async () => {
    const onExit = vi.fn();
    const GraphView = (await import("./GraphView")).default;
    render(<GraphView onExit={onExit} />);
    await waitFor(() => { expect(mockSigmaOn).toHaveBeenCalled(); });

    await userEvent.click(screen.getByRole("button", { name: "Search graph" }));
    expect(screen.getByTestId("graph-search")).toBeTruthy();

    const container = screen.getByTestId("graph-view");
    await act(async () => {
      container.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });

    expect(onExit).not.toHaveBeenCalled();
  });

  // --- Theme reactivity ---

  it("when activeThemeId changes, sigma.refresh is called to update colors", async () => {
    const { useThemeStore } = await import("../stores/theme");
    const GraphView = (await import("./GraphView")).default;
    render(<GraphView />);
    await waitFor(() => { expect(mockSigmaOn).toHaveBeenCalled(); });
    mockSigmaRefresh.mockClear();

    await act(async () => {
      useThemeStore.setState({ activeThemeId: "new-theme" });
    });

    expect(mockSigmaRefresh).toHaveBeenCalled();
  });

  it("theme change during loading state is a no-op (no crash)", async () => {
    const { useThemeStore } = await import("../stores/theme");
    const GraphView = (await import("./GraphView")).default;
    render(<GraphView />);

    await act(async () => {
      useThemeStore.setState({ activeThemeId: "test-theme" });
    });

    expect(screen.getByTestId("graph-view")).toBeTruthy();
  });

  // --- Accessibility aria-label ---

  it("after loading, container has aria-label with node and edge counts", async () => {
    const GraphView = (await import("./GraphView")).default;
    render(<GraphView />);
    await waitFor(() => { expect(mockSigmaOn).toHaveBeenCalled(); });

    await waitFor(() => {
      expect(screen.queryByTestId("graph-loading")).not.toBeInTheDocument();
    });

    const container = screen.getByTestId("graph-view");
    expect(container.getAttribute("aria-label")).toBe(
      "Knowledge graph with 2 nodes and 1 edge. Use mouse to explore, click a node to open it."
    );
  });

  it("during loading, aria-label says 'Knowledge graph loading'", async () => {
    const GraphView = (await import("./GraphView")).default;
    render(<GraphView />);

    const container = screen.getByTestId("graph-view");
    expect(container.getAttribute("aria-label")).toBe("Knowledge graph loading");
  });

  // --- Theme-aware dim color ---

  it("enterNode nodeReducer forces label on hovered node without dimming others", async () => {
    const GraphView = (await import("./GraphView")).default;
    render(<GraphView />);
    await waitFor(() => { expect(mockSigmaOn).toHaveBeenCalled(); });

    const enterNodeHandler = mockSigmaOn.mock.calls.find(
      (call) => call[0] === "enterNode",
    )?.[1];
    mockSigmaSetSetting.mockClear();
    act(() => { enterNodeHandler!({ node: "a.md", event: { x: 0, y: 0 } }); });

    const nodeReducerCall = mockSigmaSetSetting.mock.calls.find(
      (call) => call[0] === "nodeReducer",
    );
    const reducer = nodeReducerCall![1] as (node: string, attrs: Record<string, unknown>) => Record<string, unknown>;
    const hovered = reducer("a.md", { color: "#000", label: "A" });
    expect(hovered.forceLabel).toBe(true);
    const other = reducer("nonexistent-node", { color: "#000", label: "X" });
    expect(other.color).toBe("#000");
  });

  it("search nodeReducer uses theme dim color for non-matches", async () => {
    document.documentElement.style.setProperty("--background-modifier-border", "#3d444d");
    const GraphView = (await import("./GraphView")).default;
    render(<GraphView />);
    await waitFor(() => { expect(mockSigmaOn).toHaveBeenCalled(); });

    await userEvent.click(screen.getByRole("button", { name: "Search graph" }));
    mockSigmaSetSetting.mockClear();

    const input = screen.getByTestId("graph-search-input");
    await userEvent.type(input, "A");

    const nodeReducerCall = mockSigmaSetSetting.mock.calls.find(
      (call) => call[0] === "nodeReducer",
    );
    const reducer = nodeReducerCall![1] as (node: string, attrs: Record<string, unknown>) => Record<string, unknown>;
    const dimmed = reducer("nonexistent-node", { color: "#000", label: "X" });
    expect(dimmed.color).toBe("#3d444d");

    document.documentElement.style.removeProperty("--background-modifier-border");
  });

  // --- Full theme reactivity (edge + label colors) ---

  it("theme change updates sigma defaultEdgeColor and labelColor settings", async () => {
    document.documentElement.style.setProperty("--text-faint", "#656c76");
    document.documentElement.style.setProperty("--text-normal", "#f0f6fc");

    const { useThemeStore } = await import("../stores/theme");
    const GraphView = (await import("./GraphView")).default;
    render(<GraphView />);
    await waitFor(() => { expect(mockSigmaOn).toHaveBeenCalled(); });
    mockSigmaSetSetting.mockClear();

    await act(async () => {
      useThemeStore.setState({ activeThemeId: "dark-theme" });
    });

    expect(mockSigmaSetSetting).toHaveBeenCalledWith("defaultEdgeColor", "#656c76");
    expect(mockSigmaSetSetting).toHaveBeenCalledWith("labelColor", { color: "#f0f6fc" });

    document.documentElement.style.removeProperty("--text-faint");
    document.documentElement.style.removeProperty("--text-normal");
  });

  // --- Adaptive Quality Tiers ---

  it("after init, tier matches getQualitySettings for graph size", async () => {
    const spy = vi.spyOn(qualityTiers, "getQualitySettings");

    const GraphView = (await import("./GraphView")).default;
    render(<GraphView />);
    await waitFor(() => { expect(mockSigmaOn).toHaveBeenCalled(); });

    expect(spy).toHaveBeenCalledWith(2);
    spy.mockRestore();
  });

  it("small graph: Sigma gets enableEdgeEvents=true and labelRenderedSizeThreshold=0", async () => {
    const GraphView = (await import("./GraphView")).default;
    render(<GraphView />);
    await waitFor(() => { expect(mockSigmaOn).toHaveBeenCalled(); });

    expect(lastSigmaOptions.enableEdgeEvents).toBe(true);
    expect(lastSigmaOptions.labelRenderedSizeThreshold).toBe(Infinity);
    expect(lastSigmaOptions.hideEdgesOnMove).toBe(false);
    expect(lastSigmaOptions.hideLabelsOnMove).toBe(false);
  });

  it("huge graph: default edgeReducer hides all edges", async () => {
    const spy = vi.spyOn(graphLayout, "populateGraph").mockImplementation((graph) => {
      for (let i = 0; i < 25000; i++) graph.addNode(`n${i}`, { label: `N${i}`, size: 5, x: 0, y: 0, color: "#ccc", type: "filled" });
    });

    const GraphView = (await import("./GraphView")).default;
    render(<GraphView />);
    await waitFor(() => { expect(mockSigmaOn).toHaveBeenCalled(); });

    const edgeReducerCalls = mockSigmaSetSetting.mock.calls.filter(
      (call) => call[0] === "edgeReducer" && typeof call[1] === "function",
    );
    expect(edgeReducerCalls.length).toBeGreaterThanOrEqual(1);
    const reducer = edgeReducerCalls[0]![1] as (e: string, attrs: Record<string, unknown>) => Record<string, unknown>;
    expect(reducer("some-edge", { color: "#000" })).toEqual({ color: "#000", hidden: true });

    expect(lastSigmaOptions.hideEdgesOnMove).toBe(true);
    expect(lastSigmaOptions.hideLabelsOnMove).toBe(true);

    spy.mockRestore();
  });

  it("huge graph: leaveNode restores hide-all-edges reducer", async () => {
    const spy = vi.spyOn(graphLayout, "populateGraph").mockImplementation((graph) => {
      for (let i = 0; i < 25000; i++) graph.addNode(`n${i}`, { label: `N${i}`, size: 5, x: 0, y: 0, color: "#ccc", type: "filled" });
    });

    const GraphView = (await import("./GraphView")).default;
    render(<GraphView />);
    await waitFor(() => { expect(mockSigmaOn).toHaveBeenCalled(); });

    const enterNodeHandler = mockSigmaOn.mock.calls.find(
      (call) => call[0] === "enterNode",
    )?.[1];
    act(() => { enterNodeHandler!({ node: "a.md", event: { x: 0, y: 0 } }); });

    mockSigmaSetSetting.mockClear();
    const leaveNodeHandler = mockSigmaOn.mock.calls.find(
      (call) => call[0] === "leaveNode",
    )?.[1];
    act(() => { leaveNodeHandler!(); });

    const edgeReducerCall = mockSigmaSetSetting.mock.calls.find(
      (call) => call[0] === "edgeReducer",
    );
    expect(edgeReducerCall).toBeDefined();
    expect(typeof edgeReducerCall![1]).toBe("function");
    const reducer = edgeReducerCall![1] as (e: string, attrs: Record<string, unknown>) => Record<string, unknown>;
    expect(reducer("e1", { color: "#000" })).toEqual({ color: "#000", hidden: true });

    spy.mockRestore();
  });

  it("huge graph: clickStage restores hide-all-edges reducer", async () => {
    const spy = vi.spyOn(graphLayout, "populateGraph").mockImplementation((graph) => {
      for (let i = 0; i < 25000; i++) graph.addNode(`n${i}`, { label: `N${i}`, size: 5, x: 0, y: 0, color: "#ccc", type: "filled" });
    });

    const GraphView = (await import("./GraphView")).default;
    render(<GraphView />);
    await waitFor(() => { expect(mockSigmaOn).toHaveBeenCalled(); });

    mockSigmaSetSetting.mockClear();
    const clickStageHandler = mockSigmaOn.mock.calls.find(
      (call) => call[0] === "clickStage",
    )?.[1];
    act(() => { clickStageHandler!(); });

    const edgeReducerCall = mockSigmaSetSetting.mock.calls.find(
      (call) => call[0] === "edgeReducer",
    );
    expect(edgeReducerCall).toBeDefined();
    expect(typeof edgeReducerCall![1]).toBe("function");
    const reducer = edgeReducerCall![1] as (e: string, attrs: Record<string, unknown>) => Record<string, unknown>;
    expect(reducer("e1", {})).toEqual({ hidden: true });

    spy.mockRestore();
  });

  it("huge graph: search close restores hide-all-edges reducer", async () => {
    const spy = vi.spyOn(graphLayout, "populateGraph").mockImplementation((graph) => {
      for (let i = 0; i < 25000; i++) graph.addNode(`n${i}`, { label: `N${i}`, size: 5, x: 0, y: 0, color: "#ccc", type: "filled" });
    });

    const GraphView = (await import("./GraphView")).default;
    render(<GraphView />);
    await waitFor(() => { expect(mockSigmaOn).toHaveBeenCalled(); });

    await userEvent.click(screen.getByRole("button", { name: "Search graph" }));
    const input = screen.getByTestId("graph-search-input");
    await userEvent.type(input, "A");

    mockSigmaSetSetting.mockClear();
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    mockSigmaSetSetting.mockClear();
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });

    const edgeReducerCall = mockSigmaSetSetting.mock.calls.find(
      (call) => call[0] === "edgeReducer",
    );
    expect(edgeReducerCall).toBeDefined();
    expect(typeof edgeReducerCall![1]).toBe("function");
    const reducer = edgeReducerCall![1] as (e: string, attrs: Record<string, unknown>) => Record<string, unknown>;
    expect(reducer("e1", {})).toEqual({ hidden: true });

    spy.mockRestore();
  });

  it("medium graph: Sigma gets labelRenderedSizeThreshold=Infinity and no edge events", async () => {
    const spy = vi.spyOn(graphLayout, "populateGraph").mockImplementation((graph) => {
      for (let i = 0; i < 3000; i++) graph.addNode(`n${i}`, { label: `N${i}`, size: 5, x: 0, y: 0, color: "#ccc", type: "filled" });
    });

    const GraphView = (await import("./GraphView")).default;
    render(<GraphView />);
    await waitFor(() => { expect(mockSigmaOn).toHaveBeenCalled(); });

    expect(lastSigmaOptions.enableEdgeEvents).toBe(false);
    expect(lastSigmaOptions.labelRenderedSizeThreshold).toBe(Infinity);
    expect(lastSigmaOptions.hideEdgesOnMove).toBe(false);
    expect(lastSigmaOptions.hideLabelsOnMove).toBe(false);

    spy.mockRestore();
  });

  it("large graph: Sigma gets hideEdgesOnMove and hideLabelsOnMove", async () => {
    const spy = vi.spyOn(graphLayout, "populateGraph").mockImplementation((graph) => {
      for (let i = 0; i < 10000; i++) graph.addNode(`n${i}`, { label: `N${i}`, size: 5, x: 0, y: 0, color: "#ccc", type: "filled" });
    });

    const GraphView = (await import("./GraphView")).default;
    render(<GraphView />);
    await waitFor(() => { expect(mockSigmaOn).toHaveBeenCalled(); });

    expect(lastSigmaOptions.enableEdgeEvents).toBe(false);
    expect(lastSigmaOptions.labelRenderedSizeThreshold).toBe(Infinity);
    expect(lastSigmaOptions.hideEdgesOnMove).toBe(true);
    expect(lastSigmaOptions.hideLabelsOnMove).toBe(true);

    spy.mockRestore();
  });

  it("full mode does NOT re-init when activePageId changes", async () => {
    const GraphView = (await import("./GraphView")).default;
    const { rerender } = render(<GraphView activePageId="a.md" />);
    await waitFor(() => { expect(mockSigmaOn).toHaveBeenCalled(); });

    const { invoke } = await import("@tauri-apps/api/core");
    (invoke as unknown as ReturnType<typeof vi.fn>).mockClear();
    mockSigmaKill.mockClear();

    await act(async () => {
      rerender(<GraphView activePageId="b.md" />);
    });

    expect(mockSigmaKill).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalledWith("get_graph_subgraph", expect.anything());
  });

  it("full mode + activePageId change recolors seed, no IPC refetch, no sigma kill", async () => {
    const populateGraphSpy = vi.spyOn(graphLayout, "populateGraph");
    const GraphView = (await import("./GraphView")).default;
    const { rerender } = render(<GraphView activePageId="a.md" />);

    await waitFor(() => { expect(mockSigmaOn).toHaveBeenCalled(); });
    await waitFor(() => { expect(screen.queryByTestId("graph-loading")).not.toBeInTheDocument(); });

    const graph = populateGraphSpy.mock.calls[0]![0] as import("graphology").default;
    expect(graph.getNodeAttribute("a.md", "type")).toBe("seed");
    expect(graph.getNodeAttribute("b.md", "type")).toBe("filled");

    const { invoke } = await import("@tauri-apps/api/core");
    (invoke as unknown as ReturnType<typeof vi.fn>).mockClear();
    mockSigmaKill.mockClear();
    mockSigmaRefresh.mockClear();

    await act(async () => {
      rerender(<GraphView activePageId="b.md" />);
    });

    expect(graph.getNodeAttribute("a.md", "type")).toBe("filled");
    expect(graph.getNodeAttribute("b.md", "type")).toBe("seed");
    expect(mockSigmaKill).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalledWith("get_graph_subgraph", expect.anything());

    populateGraphSpy.mockRestore();
  });

  it("huge graph: clearing search query restores hide-all-edges reducer", async () => {
    const spy = vi.spyOn(graphLayout, "populateGraph").mockImplementation((graph) => {
      for (let i = 0; i < 25000; i++) graph.addNode(`n${i}`, { label: `N${i}`, size: 5, x: 0, y: 0, color: "#ccc", type: "filled" });
    });

    const GraphView = (await import("./GraphView")).default;
    render(<GraphView />);
    await waitFor(() => { expect(mockSigmaOn).toHaveBeenCalled(); });

    await userEvent.click(screen.getByRole("button", { name: "Search graph" }));
    const input = screen.getByTestId("graph-search-input");
    await userEvent.type(input, "A");

    mockSigmaSetSetting.mockClear();
    await userEvent.clear(input);

    const edgeReducerCall = mockSigmaSetSetting.mock.calls.find(
      (call) => call[0] === "edgeReducer",
    );
    expect(edgeReducerCall).toBeDefined();
    expect(typeof edgeReducerCall![1]).toBe("function");
    const reducer = edgeReducerCall![1] as (e: string, attrs: Record<string, unknown>) => Record<string, unknown>;
    expect(reducer("e1", {})).toEqual({ hidden: true });

    spy.mockRestore();
  });

  // --- lit:graph-updated full rebuild ---

  it("lit:graph-updated re-fetches subgraph from backend", async () => {
    mockListen();
    let callCount = 0;
    mockInvoke((cmd) => {
      switch (cmd) {
        case "get_graph_subgraph":
          callCount++;
          if (callCount <= 2) {
            return {
              nodes: [
                { id: "a.md", title: "A" },
                { id: "b.md", title: "B" },
              ],
              edges: [["a.md", "b.md"]],
              pagerank: { "a.md": 0.4, "b.md": 0.6 },
              positions: {},
            };
          }
          return {
            nodes: [
              { id: "a.md", title: "A" },
              { id: "b.md", title: "B" },
              { id: "c.md", title: "C" },
            ],
            edges: [["a.md", "b.md"], ["a.md", "c.md"]],
            pagerank: { "a.md": 0.4, "b.md": 0.3, "c.md": 0.3 },
            positions: {},
          };
        default:
          throw new Error(`Unknown command: ${cmd}`);
      }
    });

    const GraphView = (await import("./GraphView")).default;
    render(<GraphView />);
    await waitFor(() => { expect(mockSigmaOn).toHaveBeenCalled(); });

    const { invoke } = await import("@tauri-apps/api/core");
    (invoke as unknown as ReturnType<typeof vi.fn>).mockClear();

    await act(async () => {
      emitMockEvent("lit:graph-updated", {});
    });

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("get_graph_subgraph", { seeds: [], depth: 0, directed: null });
    });

    resetListenMock();
  });


  it("lit:graph-updated triggers full rebuild (not incremental diff)", async () => {
    mockListen();
    let callCount = 0;
    mockInvoke((cmd) => {
      switch (cmd) {
        case "get_graph_subgraph":
          callCount++;
          if (callCount <= 1) {
            return {
              nodes: [
                { id: "a.md", title: "A" },
                { id: "b.md", title: "B" },
              ],
              edges: [["a.md", "b.md"]],
              pagerank: { "a.md": 0.4, "b.md": 0.6 },
              positions: {},
            };
          }
          return {
            nodes: [
              { id: "a.md", title: "A" },
              { id: "b.md", title: "B" },
              { id: "c.md", title: "C" },
            ],
            edges: [["a.md", "b.md"], ["a.md", "c.md"]],
            pagerank: { "a.md": 0.4, "b.md": 0.3, "c.md": 0.3 },
            positions: {},
          };
        default:
          throw new Error(`Unknown command: ${cmd}`);
      }
    });

    const populateGraphSpy = vi.spyOn(graphLayout, "populateGraph");
    const GraphView = (await import("./GraphView")).default;
    render(<GraphView />);
    await waitFor(() => { expect(mockSigmaOn).toHaveBeenCalled(); });

    const callsBefore = populateGraphSpy.mock.calls.length;
    mockSigmaRefresh.mockClear();

    await act(async () => {
      emitMockEvent("lit:graph-updated", {});
    });

    await waitFor(() => {
      expect(populateGraphSpy.mock.calls.length).toBeGreaterThan(callsBefore);
    });
    expect(mockSigmaRefresh).toHaveBeenCalled();

    populateGraphSpy.mockRestore();
    resetListenMock();
  });

  // --- Neighbor fallback for uncached nodes ---

  it("uncached node positioned near its neighbor after init", async () => {
    mockInvoke((cmd) => {
      switch (cmd) {
        case "get_graph_subgraph":
          return {
            nodes: [
              { id: "a.md", title: "A" },
              { id: "b.md", title: "B" },
            ],
            edges: [["a.md", "b.md"]],
            pagerank: { "a.md": 0.4, "b.md": 0.6 },
            positions: { "a.md": { x: 500, y: 500 } },
          };
        default:
          throw new Error(`Unknown command: ${cmd}`);
      }
    });

    const populateGraphSpy = vi.spyOn(graphLayout, "populateGraph");
    const GraphView = (await import("./GraphView")).default;
    render(<GraphView />);
    await waitFor(() => { expect(mockSigmaOn).toHaveBeenCalled(); });

    const graph = populateGraphSpy.mock.calls[0]![0] as import("graphology").default;
    expect(graph.getNodeAttribute("a.md", "x")).toBe(500);
    expect(graph.getNodeAttribute("a.md", "y")).toBe(500);
    const bx = graph.getNodeAttribute("b.md", "x") as number;
    const by = graph.getNodeAttribute("b.md", "y") as number;
    expect(bx).toBeGreaterThanOrEqual(485);
    expect(bx).toBeLessThanOrEqual(515);
    expect(by).toBeGreaterThanOrEqual(485);
    expect(by).toBeLessThanOrEqual(515);

    populateGraphSpy.mockRestore();
  });

  it("lit:layout-ready applies positions with neighbor fallback for uncached nodes", async () => {
    mockListen();
    mockInvoke((cmd) => {
      switch (cmd) {
        case "get_graph_subgraph":
          return {
            nodes: [
              { id: "a.md", title: "A" },
              { id: "b.md", title: "B" },
            ],
            edges: [["a.md", "b.md"]],
            pagerank: { "a.md": 0.4, "b.md": 0.6 },
            positions: {},
          };
        case "get_graph_positions":
          return { "a.md": { x: 300, y: 300 } };
        default:
          throw new Error(`Unknown command: ${cmd}`);
      }
    });

    const populateGraphSpy = vi.spyOn(graphLayout, "populateGraph");
    const GraphView = (await import("./GraphView")).default;
    render(<GraphView />);
    await waitFor(() => { expect(mockSigmaOn).toHaveBeenCalled(); });

    await act(async () => {
      emitMockEvent("lit:layout-ready", {});
    });

    await waitFor(() => {
      expect(mockSigmaRefresh).toHaveBeenCalled();
    });

    const graph = populateGraphSpy.mock.calls[0]![0] as import("graphology").default;
    expect(graph.getNodeAttribute("a.md", "x")).toBe(300);
    expect(graph.getNodeAttribute("a.md", "y")).toBe(300);
    const bx = graph.getNodeAttribute("b.md", "x") as number;
    const by = graph.getNodeAttribute("b.md", "y") as number;
    expect(bx).toBeGreaterThanOrEqual(285);
    expect(bx).toBeLessThanOrEqual(315);
    expect(by).toBeGreaterThanOrEqual(285);
    expect(by).toBeLessThanOrEqual(315);

    populateGraphSpy.mockRestore();
    resetListenMock();
  });


  it("right-click node shows context menu with 'Export Local Network…'", async () => {
    const GraphView = (await import("./GraphView")).default;
    const { container } = render(<GraphView onExportNetwork={vi.fn()} />);
    await waitFor(() => { expect(mockSigmaOn).toHaveBeenCalled(); });

    const rightClickHandler = mockSigmaOn.mock.calls.find(
      (call) => call[0] === "rightClickNode",
    )?.[1];
    expect(rightClickHandler).toBeDefined();

    act(() => {
      rightClickHandler!({ node: "a.md", event: { original: { preventDefault: vi.fn() }, x: 100, y: 200 } });
    });

    const menu = container.querySelector("[data-graph-context-menu]");
    expect(menu).toBeTruthy();
    expect(menu!.textContent).toContain("Export Local Network…");
  });

  it("clicking 'Export Local Network…' calls onExportNetwork with node ID", async () => {
    const onExportNetwork = vi.fn();
    const GraphView = (await import("./GraphView")).default;
    const { container } = render(<GraphView onExportNetwork={onExportNetwork} />);
    await waitFor(() => { expect(mockSigmaOn).toHaveBeenCalled(); });

    const rightClickHandler = mockSigmaOn.mock.calls.find(
      (call) => call[0] === "rightClickNode",
    )?.[1];
    act(() => {
      rightClickHandler!({ node: "a.md", event: { original: { preventDefault: vi.fn() }, x: 100, y: 200 } });
    });

    const exportBtn = container.querySelector("[data-testid='ctx-export-btn']")!;
    fireEvent.click(exportBtn);
    expect(onExportNetwork).toHaveBeenCalledWith("a.md");
  });

  it("clicking 'Export Local Network…' dismisses context menu", async () => {
    const GraphView = (await import("./GraphView")).default;
    const { container } = render(<GraphView onExportNetwork={vi.fn()} />);
    await waitFor(() => { expect(mockSigmaOn).toHaveBeenCalled(); });

    const rightClickHandler = mockSigmaOn.mock.calls.find(
      (call) => call[0] === "rightClickNode",
    )?.[1];
    act(() => {
      rightClickHandler!({ node: "a.md", event: { original: { preventDefault: vi.fn() }, x: 100, y: 200 } });
    });

    fireEvent.click(container.querySelector("[data-testid='ctx-export-btn']")!);
    expect(container.querySelector("[data-graph-context-menu]")).toBeNull();
  });

  it("clicking outside context menu dismisses it", async () => {
    const GraphView = (await import("./GraphView")).default;
    const { container } = render(<GraphView onExportNetwork={vi.fn()} />);
    await waitFor(() => { expect(mockSigmaOn).toHaveBeenCalled(); });

    const rightClickHandler = mockSigmaOn.mock.calls.find(
      (call) => call[0] === "rightClickNode",
    )?.[1];
    act(() => {
      rightClickHandler!({ node: "a.md", event: { original: { preventDefault: vi.fn() }, x: 100, y: 200 } });
    });
    expect(container.querySelector("[data-graph-context-menu]")).toBeTruthy();

    fireEvent.pointerDown(document);
    expect(container.querySelector("[data-graph-context-menu]")).toBeNull();
  });

  it("Escape dismisses context menu", async () => {
    const GraphView = (await import("./GraphView")).default;
    const { container } = render(<GraphView onExportNetwork={vi.fn()} />);
    await waitFor(() => { expect(mockSigmaOn).toHaveBeenCalled(); });

    const rightClickHandler = mockSigmaOn.mock.calls.find(
      (call) => call[0] === "rightClickNode",
    )?.[1];
    act(() => {
      rightClickHandler!({ node: "a.md", event: { original: { preventDefault: vi.fn() }, x: 100, y: 200 } });
    });
    expect(container.querySelector("[data-graph-context-menu]")).toBeTruthy();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(container.querySelector("[data-graph-context-menu]")).toBeNull();
  });

  it("no context menu without right-click", async () => {
    const GraphView = (await import("./GraphView")).default;
    const { container } = render(<GraphView onExportNetwork={vi.fn()} />);
    await waitFor(() => { expect(mockSigmaOn).toHaveBeenCalled(); });
    expect(container.querySelector("[data-graph-context-menu]")).toBeNull();
  });

  it("context menu without onExportNetwork omits export button", async () => {
    const GraphView = (await import("./GraphView")).default;
    const { container } = render(<GraphView />);
    await waitFor(() => { expect(mockSigmaOn).toHaveBeenCalled(); });

    const rightClickHandler = mockSigmaOn.mock.calls.find(
      (call) => call[0] === "rightClickNode",
    )?.[1];
    act(() => {
      rightClickHandler!({ node: "a.md", event: { original: { preventDefault: vi.fn() }, x: 100, y: 200 } });
    });

    expect(container.querySelector("[data-graph-context-menu]")).toBeTruthy();
    expect(container.querySelector("[data-testid='ctx-export-btn']")).toBeNull();
  });

  it("Escape when context menu is open does NOT call onExit", async () => {
    const onExit = vi.fn();
    const GraphView = (await import("./GraphView")).default;
    const { container } = render(<GraphView onExit={onExit} onExportNetwork={vi.fn()} />);
    await waitFor(() => { expect(mockSigmaOn).toHaveBeenCalled(); });

    const rightClickHandler = mockSigmaOn.mock.calls.find(
      (call) => call[0] === "rightClickNode",
    )?.[1];
    act(() => {
      rightClickHandler!({ node: "a.md", event: { original: { preventDefault: vi.fn() }, x: 100, y: 200 } });
    });
    expect(container.querySelector("[data-graph-context-menu]")).toBeTruthy();

    const graphContainer = screen.getByTestId("graph-view");
    await act(async () => {
      graphContainer.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });

    expect(onExit).not.toHaveBeenCalled();
  });

  it("Escape dismisses context menu without calling onExit", async () => {
    const onExit = vi.fn();
    const GraphView = (await import("./GraphView")).default;
    const { container } = render(<GraphView onExit={onExit} onExportNetwork={vi.fn()} />);
    await waitFor(() => { expect(mockSigmaOn).toHaveBeenCalled(); });

    const rightClickHandler = mockSigmaOn.mock.calls.find(
      (call) => call[0] === "rightClickNode",
    )?.[1];
    act(() => {
      rightClickHandler!({ node: "a.md", event: { original: { preventDefault: vi.fn() }, x: 100, y: 200 } });
    });

    fireEvent.keyDown(document, { key: "Escape" });
    expect(container.querySelector("[data-graph-context-menu]")).toBeNull();
    expect(onExit).not.toHaveBeenCalled();
  });

  // --- Theme reactivity (immediate, no deferred path) ---

  it("theme change while mounted applies immediately", async () => {
    const { useThemeStore } = await import("../stores/theme");
    const GraphView = (await import("./GraphView")).default;
    render(<GraphView />);
    await waitFor(() => { expect(mockSigmaOn).toHaveBeenCalled(); });

    mockSigmaRefresh.mockClear();

    await act(async () => {
      useThemeStore.setState({ activeThemeId: "hidden-theme" });
    });

    expect(mockSigmaRefresh).toHaveBeenCalled();
  });

  it("theme change applies edge and label colors immediately", async () => {
    document.documentElement.style.setProperty("--text-faint", "#aabbcc");
    document.documentElement.style.setProperty("--text-normal", "#ddeeff");

    const { useThemeStore } = await import("../stores/theme");
    const GraphView = (await import("./GraphView")).default;
    render(<GraphView />);
    await waitFor(() => { expect(mockSigmaOn).toHaveBeenCalled(); });

    mockSigmaRefresh.mockClear();
    mockSigmaSetSetting.mockClear();

    await act(async () => {
      useThemeStore.setState({ activeThemeId: "immediate-theme" });
    });

    expect(mockSigmaSetSetting).toHaveBeenCalledWith("defaultEdgeColor", "#aabbcc");
    expect(mockSigmaSetSetting).toHaveBeenCalledWith("labelColor", { color: "#ddeeff" });
    expect(mockSigmaRefresh).toHaveBeenCalled();

    document.documentElement.style.removeProperty("--text-faint");
    document.documentElement.style.removeProperty("--text-normal");
  });

  it("each theme change while mounted produces its own update", async () => {
    const { useThemeStore } = await import("../stores/theme");
    const GraphView = (await import("./GraphView")).default;
    render(<GraphView />);
    await waitFor(() => { expect(mockSigmaOn).toHaveBeenCalled(); });

    mockSigmaRefresh.mockClear();

    await act(async () => {
      useThemeStore.setState({ activeThemeId: "theme-a" });
    });
    await act(async () => {
      useThemeStore.setState({ activeThemeId: "theme-b" });
    });

    expect(mockSigmaRefresh.mock.calls.length).toBe(2);
  });

  it("Escape after context menu dismissed calls onExit", async () => {
    const onExit = vi.fn();
    const GraphView = (await import("./GraphView")).default;
    const { container } = render(<GraphView onExit={onExit} onExportNetwork={vi.fn()} />);
    await waitFor(() => { expect(mockSigmaOn).toHaveBeenCalled(); });

    const rightClickHandler = mockSigmaOn.mock.calls.find(
      (call) => call[0] === "rightClickNode",
    )?.[1];
    act(() => {
      rightClickHandler!({ node: "a.md", event: { original: { preventDefault: vi.fn() }, x: 100, y: 200 } });
    });

    fireEvent.keyDown(document, { key: "Escape" });
    expect(container.querySelector("[data-graph-context-menu]")).toBeNull();

    onExit.mockClear();
    const graphContainer = screen.getByTestId("graph-view");
    await act(async () => {
      graphContainer.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });

    expect(onExit).toHaveBeenCalledTimes(1);
  });

  // --- Phase 2B: Click Selection (plain=toggle, Cmd/Ctrl=navigate) ---

  it("plain click toggles selection, does NOT navigate", async () => {
    const onNavigate = vi.fn();
    const GraphView = (await import("./GraphView")).default;
    render(<GraphView onNavigate={onNavigate} />);
    await waitFor(() => { expect(mockSigmaOn).toHaveBeenCalled(); });

    const clickNodeHandler = mockSigmaOn.mock.calls.find(
      (call) => call[0] === "clickNode",
    )?.[1];
    act(() => {
      clickNodeHandler!({ node: "a.md", event: { original: { shiftKey: false, metaKey: false, ctrlKey: false } } });
    });

    expect(onNavigate).not.toHaveBeenCalled();
    expect(useGraphSelectionStore.getState().selectedNodes).toContain("a.md");
  });

  it("Shift+click toggles selection, does NOT navigate", async () => {
    const onNavigate = vi.fn();
    const GraphView = (await import("./GraphView")).default;
    render(<GraphView onNavigate={onNavigate} />);
    await waitFor(() => { expect(mockSigmaOn).toHaveBeenCalled(); });

    const clickNodeHandler = mockSigmaOn.mock.calls.find(
      (call) => call[0] === "clickNode",
    )?.[1];
    act(() => {
      clickNodeHandler!({ node: "a.md", event: { original: { shiftKey: true, metaKey: false, ctrlKey: false } } });
    });

    expect(onNavigate).not.toHaveBeenCalled();
    expect(useGraphSelectionStore.getState().selectedNodes).toContain("a.md");
  });

  it("Cmd+click clears selection and navigates", async () => {
    useGraphSelectionStore.getState().toggleNode("b.md");
    const onNavigate = vi.fn();
    const GraphView = (await import("./GraphView")).default;
    render(<GraphView onNavigate={onNavigate} />);
    await waitFor(() => { expect(mockSigmaOn).toHaveBeenCalled(); });

    const clickNodeHandler = mockSigmaOn.mock.calls.find(
      (call) => call[0] === "clickNode",
    )?.[1];
    act(() => {
      clickNodeHandler!({ node: "a.md", event: { original: { shiftKey: false, metaKey: true, ctrlKey: false } } });
    });

    expect(useGraphSelectionStore.getState().selectedNodes).toEqual([]);
    expect(onNavigate).toHaveBeenCalledWith("a.md");
  });

  it("Ctrl+click clears selection and navigates", async () => {
    useGraphSelectionStore.getState().toggleNode("b.md");
    const onNavigate = vi.fn();
    const GraphView = (await import("./GraphView")).default;
    render(<GraphView onNavigate={onNavigate} />);
    await waitFor(() => { expect(mockSigmaOn).toHaveBeenCalled(); });

    const clickNodeHandler = mockSigmaOn.mock.calls.find(
      (call) => call[0] === "clickNode",
    )?.[1];
    act(() => {
      clickNodeHandler!({ node: "a.md", event: { original: { shiftKey: false, metaKey: false, ctrlKey: true } } });
    });

    expect(useGraphSelectionStore.getState().selectedNodes).toEqual([]);
    expect(onNavigate).toHaveBeenCalledWith("a.md");
  });

  it("plain click with existing selection does NOT clear, toggles instead", async () => {
    useGraphSelectionStore.getState().toggleNode("b.md");
    const onNavigate = vi.fn();
    const GraphView = (await import("./GraphView")).default;
    render(<GraphView onNavigate={onNavigate} />);
    await waitFor(() => { expect(mockSigmaOn).toHaveBeenCalled(); });

    const clickNodeHandler = mockSigmaOn.mock.calls.find(
      (call) => call[0] === "clickNode",
    )?.[1];
    act(() => {
      clickNodeHandler!({ node: "a.md", event: { original: { shiftKey: false, metaKey: false, ctrlKey: false } } });
    });

    expect(useGraphSelectionStore.getState().selectedNodes).toContain("a.md");
    expect(useGraphSelectionStore.getState().selectedNodes).toContain("b.md");
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it("Shift+Cmd+click navigates (Cmd takes priority)", async () => {
    useGraphSelectionStore.getState().toggleNode("b.md");
    const onNavigate = vi.fn();
    const GraphView = (await import("./GraphView")).default;
    render(<GraphView onNavigate={onNavigate} />);
    await waitFor(() => { expect(mockSigmaOn).toHaveBeenCalled(); });

    const clickNodeHandler = mockSigmaOn.mock.calls.find(
      (call) => call[0] === "clickNode",
    )?.[1];
    act(() => {
      clickNodeHandler!({ node: "a.md", event: { original: { shiftKey: true, metaKey: true, ctrlKey: false } } });
    });

    expect(useGraphSelectionStore.getState().selectedNodes).toEqual([]);
    expect(onNavigate).toHaveBeenCalledWith("a.md");
  });

  it("clickStage clears selection", async () => {
    useGraphSelectionStore.getState().toggleNode("a.md");
    const GraphView = (await import("./GraphView")).default;
    render(<GraphView />);
    await waitFor(() => { expect(mockSigmaOn).toHaveBeenCalled(); });

    const clickStageHandler = mockSigmaOn.mock.calls.find(
      (call) => call[0] === "clickStage",
    )?.[1];
    act(() => { clickStageHandler!(); });

    expect(useGraphSelectionStore.getState().selectedNodes).toEqual([]);
  });

  it("nodeReducer returns highlighted: true for selected nodes", async () => {
    document.documentElement.style.setProperty("--interactive-accent", "#7c3aed");
    useGraphSelectionStore.getState().toggleNode("a.md");

    const GraphView = (await import("./GraphView")).default;
    render(<GraphView />);
    await waitFor(() => { expect(mockSigmaOn).toHaveBeenCalled(); });

    // Trigger a refresh to apply reducers — sigma.refresh triggers nodeReducer
    // The default nodeReducer is set; we need to find it and test it
    const nodeReducerCalls = mockSigmaSetSetting.mock.calls.filter(
      (call) => call[0] === "nodeReducer",
    );
    const lastReducer = nodeReducerCalls[nodeReducerCalls.length - 1]![1] as (
      n: string, attrs: Record<string, unknown>
    ) => Record<string, unknown>;

    const selectedResult = lastReducer("a.md", { color: "#000", label: "A" });
    expect(selectedResult.highlighted).toBe(true);
    expect(selectedResult.forceLabel).toBe(true);

    const unselectedResult = lastReducer("b.md", { color: "#000", label: "B" });
    expect(unselectedResult.highlighted).toBeUndefined();
    expect(unselectedResult.forceLabel).toBe(false);

    document.documentElement.style.removeProperty("--interactive-accent");
  });

  it("selection change triggers sigma.refresh()", async () => {
    const GraphView = (await import("./GraphView")).default;
    render(<GraphView />);
    await waitFor(() => { expect(mockSigmaOn).toHaveBeenCalled(); });

    mockSigmaRefresh.mockClear();

    act(() => {
      useGraphSelectionStore.getState().toggleNode("a.md");
    });

    expect(mockSigmaRefresh).toHaveBeenCalled();
  });

  it("hover still shows neighbors while selected nodes retain highlight", async () => {
    useGraphSelectionStore.getState().toggleNode("a.md");
    const GraphView = (await import("./GraphView")).default;
    render(<GraphView />);
    await waitFor(() => { expect(mockSigmaOn).toHaveBeenCalled(); });

    const enterNodeHandler = mockSigmaOn.mock.calls.find(
      (call) => call[0] === "enterNode",
    )?.[1];
    mockSigmaSetSetting.mockClear();
    act(() => { enterNodeHandler!({ node: "b.md", event: { x: 100, y: 200 } }); });

    const nodeReducerCall = mockSigmaSetSetting.mock.calls.find(
      (call) => call[0] === "nodeReducer",
    );
    expect(nodeReducerCall).toBeDefined();
    const reducer = nodeReducerCall![1] as (n: string, attrs: Record<string, unknown>) => Record<string, unknown>;

    // a.md is selected but not the hovered node or neighbor — should still show highlight
    const selectedResult = reducer("a.md", { color: "#000", label: "A" });
    expect(selectedResult.highlighted).toBe(true);
    expect(selectedResult.forceLabel).toBe(true);
  });

  it("Escape with active selection clears selection, does NOT call onExit", async () => {
    const onExit = vi.fn();
    const GraphView = (await import("./GraphView")).default;
    render(<GraphView onExit={onExit} />);
    await waitFor(() => { expect(mockSigmaOn).toHaveBeenCalled(); });

    act(() => {
      useGraphSelectionStore.getState().toggleNode("a.md");
    });

    const container = screen.getByTestId("graph-view");
    await act(async () => {
      container.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });

    expect(useGraphSelectionStore.getState().selectedNodes).toEqual([]);
    expect(onExit).not.toHaveBeenCalled();
  });

  it("second Escape after clearing selection calls onExit", async () => {
    const onExit = vi.fn();
    const GraphView = (await import("./GraphView")).default;
    render(<GraphView onExit={onExit} />);
    await waitFor(() => { expect(mockSigmaOn).toHaveBeenCalled(); });

    act(() => {
      useGraphSelectionStore.getState().toggleNode("a.md");
    });

    const container = screen.getByTestId("graph-view");
    await act(async () => {
      container.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(onExit).not.toHaveBeenCalled();

    await act(async () => {
      container.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  // --- Phase 2B: GraphToolbar selection badge ---
  // (badge tests are in GraphToolbar.test.tsx; integration wiring tested here)

  it("GraphView passes selectedNodes.length to toolbar as selectionCount", async () => {
    act(() => {
      useGraphSelectionStore.getState().toggleNode("a.md");
      useGraphSelectionStore.getState().toggleNode("b.md");
    });

    const GraphView = (await import("./GraphView")).default;
    render(<GraphView />);
    await waitFor(() => { expect(mockSigmaOn).toHaveBeenCalled(); });

    await waitFor(() => {
      expect(screen.queryByTestId("graph-loading")).not.toBeInTheDocument();
    });

    const badge = screen.getByTestId("selection-badge");
    expect(badge.textContent).toBe("2");
  });

  // --- Phase 2C: Lasso/Marquee Selection ---

  it("Shift+mousedown on container (no hovered node) starts lasso mode", async () => {
    const GraphView = (await import("./GraphView")).default;
    render(<GraphView />);
    await waitFor(() => { expect(mockSigmaOn).toHaveBeenCalled(); });

    const canvas = screen.getByTestId("graph-canvas");
    fireEvent.mouseDown(canvas, { shiftKey: true, clientX: 100, clientY: 100 });

    expect(useGraphSelectionStore.getState().selectionMode).toBe("lasso");
  });

  it("during lasso, mousemove shows lasso-rect div", async () => {
    const GraphView = (await import("./GraphView")).default;
    render(<GraphView />);
    await waitFor(() => { expect(mockSigmaOn).toHaveBeenCalled(); });

    const canvas = screen.getByTestId("graph-canvas");
    fireEvent.mouseDown(canvas, { shiftKey: true, clientX: 100, clientY: 100 });
    fireEvent.mouseMove(canvas, { clientX: 200, clientY: 200 });

    expect(screen.getByTestId("lasso-rect")).toBeTruthy();
  });

  it("drag up-left computes rect with min/abs correctly", async () => {
    const GraphView = (await import("./GraphView")).default;
    render(<GraphView />);
    await waitFor(() => { expect(mockSigmaOn).toHaveBeenCalled(); });

    const canvas = screen.getByTestId("graph-canvas");
    fireEvent.mouseDown(canvas, { shiftKey: true, clientX: 200, clientY: 200 });
    fireEvent.mouseMove(canvas, { clientX: 100, clientY: 100 });

    const rect = screen.getByTestId("lasso-rect");
    expect(rect.style.left).toBe("100px");
    expect(rect.style.top).toBe("100px");
    expect(rect.style.width).toBe("100px");
    expect(rect.style.height).toBe("100px");
  });

  it("lasso div has class graph-lasso-rect", async () => {
    const GraphView = (await import("./GraphView")).default;
    render(<GraphView />);
    await waitFor(() => { expect(mockSigmaOn).toHaveBeenCalled(); });

    const canvas = screen.getByTestId("graph-canvas");
    fireEvent.mouseDown(canvas, { shiftKey: true, clientX: 100, clientY: 100 });
    fireEvent.mouseMove(canvas, { clientX: 200, clientY: 200 });

    expect(screen.getByTestId("lasso-rect").className).toContain("graph-lasso-rect");
  });

  it("mouseup ends lasso, rect disappears", async () => {
    const GraphView = (await import("./GraphView")).default;
    render(<GraphView />);
    await waitFor(() => { expect(mockSigmaOn).toHaveBeenCalled(); });

    const canvas = screen.getByTestId("graph-canvas");
    fireEvent.mouseDown(canvas, { shiftKey: true, clientX: 100, clientY: 100 });
    fireEvent.mouseMove(canvas, { clientX: 200, clientY: 200 });
    fireEvent.mouseUp(canvas);

    expect(screen.queryByTestId("lasso-rect")).toBeNull();
    expect(useGraphSelectionStore.getState().selectionMode).not.toBe("lasso");
  });

  it("nodes inside lasso rect are selected on mouseup", async () => {
    mockGetNodeDisplayData.mockImplementation((nodeId: string) => {
      if (nodeId === "a.md") return { x: 150, y: 150 };
      if (nodeId === "b.md") return { x: 500, y: 500 };
      return { x: 0, y: 0 };
    });

    const GraphView = (await import("./GraphView")).default;
    render(<GraphView />);
    await waitFor(() => { expect(mockSigmaOn).toHaveBeenCalled(); });

    const canvas = screen.getByTestId("graph-canvas");
    fireEvent.mouseDown(canvas, { shiftKey: true, clientX: 100, clientY: 100 });
    fireEvent.mouseMove(canvas, { clientX: 200, clientY: 200 });
    fireEvent.mouseUp(canvas);

    expect(useGraphSelectionStore.getState().selectedNodes).toContain("a.md");
    expect(useGraphSelectionStore.getState().selectedNodes).not.toContain("b.md");
  });

  it("lasso adds to existing selection (does not replace)", async () => {
    useGraphSelectionStore.getState().toggleNode("b.md");

    mockGetNodeDisplayData.mockImplementation((nodeId: string) => {
      if (nodeId === "a.md") return { x: 150, y: 150 };
      if (nodeId === "b.md") return { x: 500, y: 500 };
      return { x: 0, y: 0 };
    });

    const GraphView = (await import("./GraphView")).default;
    render(<GraphView />);
    await waitFor(() => { expect(mockSigmaOn).toHaveBeenCalled(); });

    const canvas = screen.getByTestId("graph-canvas");
    fireEvent.mouseDown(canvas, { shiftKey: true, clientX: 100, clientY: 100 });
    fireEvent.mouseMove(canvas, { clientX: 200, clientY: 200 });
    fireEvent.mouseUp(canvas);

    expect(useGraphSelectionStore.getState().selectedNodes).toContain("a.md");
    expect(useGraphSelectionStore.getState().selectedNodes).toContain("b.md");
  });

  it("lasso with zero nodes inside preserves existing selection", async () => {
    useGraphSelectionStore.getState().toggleNode("a.md");

    mockGetNodeDisplayData.mockReturnValue({ x: 500, y: 500 });

    const GraphView = (await import("./GraphView")).default;
    render(<GraphView />);
    await waitFor(() => { expect(mockSigmaOn).toHaveBeenCalled(); });

    const canvas = screen.getByTestId("graph-canvas");
    fireEvent.mouseDown(canvas, { shiftKey: true, clientX: 100, clientY: 100 });
    fireEvent.mouseMove(canvas, { clientX: 200, clientY: 200 });
    fireEvent.mouseUp(canvas);

    expect(useGraphSelectionStore.getState().selectedNodes).toEqual(["a.md"]);
  });

  it("after lasso ends, mousemove does not show lasso rect", async () => {
    const GraphView = (await import("./GraphView")).default;
    render(<GraphView />);
    await waitFor(() => { expect(mockSigmaOn).toHaveBeenCalled(); });

    const canvas = screen.getByTestId("graph-canvas");
    fireEvent.mouseDown(canvas, { shiftKey: true, clientX: 100, clientY: 100 });
    fireEvent.mouseMove(canvas, { clientX: 200, clientY: 200 });
    fireEvent.mouseUp(canvas);

    fireEvent.mouseMove(canvas, { clientX: 300, clientY: 300 });
    expect(screen.queryByTestId("lasso-rect")).toBeNull();
  });

  it("mousedown WITHOUT shift does not start lasso", async () => {
    const GraphView = (await import("./GraphView")).default;
    render(<GraphView />);
    await waitFor(() => { expect(mockSigmaOn).toHaveBeenCalled(); });

    const canvas = screen.getByTestId("graph-canvas");
    fireEvent.mouseDown(canvas, { shiftKey: false, clientX: 100, clientY: 100 });
    fireEvent.mouseMove(canvas, { clientX: 200, clientY: 200 });

    expect(screen.queryByTestId("lasso-rect")).toBeNull();
  });

  it("lasso mouseup uses latest mouse position, not stale intermediate", async () => {
    mockGetNodeDisplayData.mockImplementation((nodeId: string) => {
      if (nodeId === "a.md") return { x: 150, y: 150 };
      if (nodeId === "b.md") return { x: 350, y: 350 };
      return { x: 0, y: 0 };
    });

    const GraphView = (await import("./GraphView")).default;
    render(<GraphView />);
    await waitFor(() => { expect(mockSigmaOn).toHaveBeenCalled(); });

    const canvas = screen.getByTestId("graph-canvas");
    fireEvent.mouseDown(canvas, { shiftKey: true, clientX: 100, clientY: 100 });
    fireEvent.mouseMove(canvas, { clientX: 200, clientY: 200 });
    fireEvent.mouseMove(canvas, { clientX: 400, clientY: 400 });
    fireEvent.mouseUp(canvas);

    expect(useGraphSelectionStore.getState().selectedNodes).toContain("a.md");
    expect(useGraphSelectionStore.getState().selectedNodes).toContain("b.md");
  });

  it("Shift+mousedown while hovering a node does NOT start lasso", async () => {
    const GraphView = (await import("./GraphView")).default;
    render(<GraphView />);
    await waitFor(() => { expect(mockSigmaOn).toHaveBeenCalled(); });

    // Simulate hovering a node first
    const enterNodeHandler = mockSigmaOn.mock.calls.find(
      (call) => call[0] === "enterNode",
    )?.[1];
    act(() => { enterNodeHandler!({ node: "a.md", event: { x: 100, y: 100 } }); });

    const canvas = screen.getByTestId("graph-canvas");
    fireEvent.mouseDown(canvas, { shiftKey: true, clientX: 100, clientY: 100 });
    fireEvent.mouseMove(canvas, { clientX: 200, clientY: 200 });

    expect(screen.queryByTestId("lasso-rect")).toBeNull();
  });

  it("cursor changes to crosshair during lasso, resets on mouseup", async () => {
    const GraphView = (await import("./GraphView")).default;
    render(<GraphView />);
    await waitFor(() => { expect(mockSigmaOn).toHaveBeenCalled(); });

    const canvas = screen.getByTestId("graph-canvas");
    fireEvent.mouseDown(canvas, { shiftKey: true, clientX: 100, clientY: 100 });

    expect(canvas.style.cursor).toBe("crosshair");

    fireEvent.mouseUp(canvas);
    expect(canvas.style.cursor).toBe("grab");
  });

  // --- Phase 2D: Perf, batching, camera panning fixes ---

  it("lasso selects all matching nodes in a single store update", async () => {
    mockGetNodeDisplayData.mockImplementation((nodeId: string) => {
      if (nodeId === "a.md") return { x: 150, y: 150 };
      if (nodeId === "b.md") return { x: 160, y: 160 };
      return { x: 0, y: 0 };
    });

    const GraphView = (await import("./GraphView")).default;
    render(<GraphView />);
    await waitFor(() => { expect(mockSigmaOn).toHaveBeenCalled(); });

    mockSigmaRefresh.mockClear();

    const canvas = screen.getByTestId("graph-canvas");
    fireEvent.mouseDown(canvas, { shiftKey: true, clientX: 100, clientY: 100 });
    fireEvent.mouseMove(canvas, { clientX: 200, clientY: 200 });
    fireEvent.mouseUp(canvas);

    const { selectedNodes } = useGraphSelectionStore.getState();
    expect(selectedNodes).toContain("a.md");
    expect(selectedNodes).toContain("b.md");
    expect(mockSigmaRefresh).toHaveBeenCalledTimes(1);
  });

  it("subscription uses selector — selectionMode-only change does not trigger sigma.refresh()", async () => {
    const GraphView = (await import("./GraphView")).default;
    render(<GraphView />);
    await waitFor(() => { expect(mockSigmaOn).toHaveBeenCalled(); });

    mockSigmaRefresh.mockClear();

    act(() => {
      useGraphSelectionStore.getState().setSelectionMode("lasso");
    });

    expect(mockSigmaRefresh).not.toHaveBeenCalled();
  });

  it("lasso disables camera panning on mousedown, re-enables on mouseup", async () => {
    const GraphView = (await import("./GraphView")).default;
    render(<GraphView />);
    await waitFor(() => { expect(mockSigmaOn).toHaveBeenCalled(); });

    mockSigmaSetSetting.mockClear();

    const canvas = screen.getByTestId("graph-canvas");
    fireEvent.mouseDown(canvas, { shiftKey: true, clientX: 100, clientY: 100 });

    expect(mockSigmaSetSetting).toHaveBeenCalledWith("enableCameraPanning", false);

    fireEvent.mouseUp(canvas);

    expect(mockSigmaSetSetting).toHaveBeenCalledWith("enableCameraPanning", true);
  });

  // --- Issue #6: Search + Selection reducer composition ---

  it("selected node retains highlight when dimmed by search (non-match)", async () => {
    useGraphSelectionStore.getState().toggleNode("b.md");

    const GraphView = (await import("./GraphView")).default;
    render(<GraphView />);
    await waitFor(() => { expect(mockSigmaOn).toHaveBeenCalled(); });

    await userEvent.click(screen.getByRole("button", { name: "Search graph" }));
    mockSigmaSetSetting.mockClear();

    const input = screen.getByTestId("graph-search-input");
    await userEvent.type(input, "A");

    const nodeReducerCall = mockSigmaSetSetting.mock.calls.find(
      (call) => call[0] === "nodeReducer",
    );
    const reducer = nodeReducerCall![1] as (n: string, attrs: Record<string, unknown>) => Record<string, unknown>;
    const result = reducer("b.md", { color: "#000", label: "B" });
    expect(result.highlighted).toBe(true);
    expect(result.color).toBe(dimColorRef());
  });

  it("selected node that matches search query keeps highlighted: true", async () => {
    useGraphSelectionStore.getState().toggleNode("a.md");

    const GraphView = (await import("./GraphView")).default;
    render(<GraphView />);
    await waitFor(() => { expect(mockSigmaOn).toHaveBeenCalled(); });

    await userEvent.click(screen.getByRole("button", { name: "Search graph" }));
    mockSigmaSetSetting.mockClear();

    const input = screen.getByTestId("graph-search-input");
    await userEvent.type(input, "A");

    const nodeReducerCall = mockSigmaSetSetting.mock.calls.find(
      (call) => call[0] === "nodeReducer",
    );
    const reducer = nodeReducerCall![1] as (n: string, attrs: Record<string, unknown>) => Record<string, unknown>;
    const result = reducer("a.md", { color: "#000", label: "A" });
    expect(result.highlighted).toBe(true);
  });

  it("unselected non-match node is dimmed without highlight during search", async () => {
    const GraphView = (await import("./GraphView")).default;
    render(<GraphView />);
    await waitFor(() => { expect(mockSigmaOn).toHaveBeenCalled(); });

    await userEvent.click(screen.getByRole("button", { name: "Search graph" }));
    mockSigmaSetSetting.mockClear();

    const input = screen.getByTestId("graph-search-input");
    await userEvent.type(input, "A");

    const nodeReducerCall = mockSigmaSetSetting.mock.calls.find(
      (call) => call[0] === "nodeReducer",
    );
    const reducer = nodeReducerCall![1] as (n: string, attrs: Record<string, unknown>) => Record<string, unknown>;
    const result = reducer("b.md", { color: "#000", label: "B" });
    expect(result.color).toBe(dimColorRef());
    expect(result.forceLabel).toBe(false);
    expect(result.highlighted).toBeUndefined();
  });

  // --- Issue #171: Lasso rect offset when container is not at viewport origin ---

  it("lasso rect uses container-relative coordinates, not raw viewport clientX/Y", async () => {
    const GraphView = (await import("./GraphView")).default;
    render(<GraphView />);
    await waitFor(() => { expect(mockSigmaOn).toHaveBeenCalled(); });

    const canvas = screen.getByTestId("graph-canvas");
    vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({
      left: 200, top: 50, right: 1000, bottom: 800,
      width: 800, height: 750, x: 200, y: 50, toJSON: () => ({}),
    });

    fireEvent.mouseDown(canvas, { shiftKey: true, clientX: 300, clientY: 150 });
    fireEvent.mouseMove(canvas, { clientX: 500, clientY: 250 });

    const rect = screen.getByTestId("lasso-rect");
    expect(rect.style.left).toBe("100px");
    expect(rect.style.top).toBe("100px");
    expect(rect.style.width).toBe("200px");
    expect(rect.style.height).toBe("100px");
  });

  it("lasso node hit-testing uses container-relative coords matching sigma display data", async () => {
    mockGetNodeDisplayData.mockImplementation((nodeId: string) => {
      if (nodeId === "a.md") return { x: 150, y: 150 };
      if (nodeId === "b.md") return { x: 50, y: 50 };
      return { x: 0, y: 0 };
    });

    const GraphView = (await import("./GraphView")).default;
    render(<GraphView />);
    await waitFor(() => { expect(mockSigmaOn).toHaveBeenCalled(); });

    const canvas = screen.getByTestId("graph-canvas");
    vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({
      left: 200, top: 50, right: 1000, bottom: 800,
      width: 800, height: 750, x: 200, y: 50, toJSON: () => ({}),
    });

    // Container-relative: (100,100) to (300,250)
    fireEvent.mouseDown(canvas, { shiftKey: true, clientX: 300, clientY: 150 });
    fireEvent.mouseMove(canvas, { clientX: 500, clientY: 300 });
    fireEvent.mouseUp(canvas);

    // a.md at (150,150) is inside [100,100]->[300,250]
    expect(useGraphSelectionStore.getState().selectedNodes).toContain("a.md");
    // b.md at (50,50) is outside
    expect(useGraphSelectionStore.getState().selectedNodes).not.toContain("b.md");
  });

  it("camera panning re-enabled after empty lasso", async () => {
    mockGetNodeDisplayData.mockReturnValue({ x: 500, y: 500 });

    const GraphView = (await import("./GraphView")).default;
    render(<GraphView />);
    await waitFor(() => { expect(mockSigmaOn).toHaveBeenCalled(); });

    mockSigmaSetSetting.mockClear();

    const canvas = screen.getByTestId("graph-canvas");
    fireEvent.mouseDown(canvas, { shiftKey: true, clientX: 100, clientY: 100 });
    fireEvent.mouseMove(canvas, { clientX: 200, clientY: 200 });
    fireEvent.mouseUp(canvas);

    expect(mockSigmaSetSetting).toHaveBeenCalledWith("enableCameraPanning", true);
  });

  // --- Phase 3B: Context Menu Extensions (Merge & Split) ---

  it("merge item visible with 2+ selected nodes", async () => {
    useGraphSelectionStore.setState({ selectedNodes: ["a.md", "b.md"], selectionMode: "click" });

    const GraphView = (await import("./GraphView")).default;
    const { container } = render(<GraphView onExportNetwork={vi.fn()} onMergeConfirm={vi.fn()} onSplitConfirm={vi.fn()} />);
    await waitFor(() => { expect(mockSigmaOn).toHaveBeenCalled(); });

    const rightClickHandler = mockSigmaOn.mock.calls.find(
      (call) => call[0] === "rightClickNode",
    )?.[1];
    act(() => {
      rightClickHandler!({ node: "a.md", event: { original: { preventDefault: vi.fn() }, x: 100, y: 200 } });
    });

    const mergeBtn = container.querySelector("[data-testid='ctx-merge-btn']");
    expect(mergeBtn).toBeTruthy();
    expect(mergeBtn!.textContent).toBe("Merge 2 documents");
  });

  it("merge item hidden with <2 selected nodes", async () => {
    useGraphSelectionStore.setState({ selectedNodes: [], selectionMode: "none" });

    const GraphView = (await import("./GraphView")).default;
    const { container } = render(<GraphView onExportNetwork={vi.fn()} onMergeConfirm={vi.fn()} onSplitConfirm={vi.fn()} />);
    await waitFor(() => { expect(mockSigmaOn).toHaveBeenCalled(); });

    const rightClickHandler = mockSigmaOn.mock.calls.find(
      (call) => call[0] === "rightClickNode",
    )?.[1];
    act(() => {
      rightClickHandler!({ node: "a.md", event: { original: { preventDefault: vi.fn() }, x: 100, y: 200 } });
    });

    expect(container.querySelector("[data-testid='ctx-merge-btn']")).toBeNull();

    // Also test with 1 selected
    useGraphSelectionStore.setState({ selectedNodes: ["a.md"], selectionMode: "click" });
    act(() => {
      rightClickHandler!({ node: "a.md", event: { original: { preventDefault: vi.fn() }, x: 100, y: 200 } });
    });
    expect(container.querySelector("[data-testid='ctx-merge-btn']")).toBeNull();
  });

  it("dynamic merge count with 3 selected nodes", async () => {
    mockInvoke((cmd) => {
      switch (cmd) {
        case "get_graph_subgraph":
          return {
            nodes: [
              { id: "a.md", title: "A" },
              { id: "b.md", title: "B" },
              { id: "c.md", title: "C" },
            ],
            edges: [["a.md", "b.md"], ["b.md", "c.md"]],
            pagerank: { "a.md": 0.3, "b.md": 0.4, "c.md": 0.3 },
            positions: {},
          };
        case "read_page":
          return { meta: { title: "X", relative_path: "x.md", frontmatter: {}, created_at: null, modified_at: null, file_type: "markdown" }, body: "text", raw_yaml: "" };
        default:
          throw new Error(`Unknown command: ${cmd}`);
      }
    });
    useGraphSelectionStore.setState({ selectedNodes: ["a.md", "b.md", "c.md"], selectionMode: "click" });

    const GraphView = (await import("./GraphView")).default;
    const { container } = render(<GraphView onExportNetwork={vi.fn()} onMergeConfirm={vi.fn()} onSplitConfirm={vi.fn()} />);
    await waitFor(() => { expect(mockSigmaOn).toHaveBeenCalled(); });

    const rightClickHandler = mockSigmaOn.mock.calls.find(
      (call) => call[0] === "rightClickNode",
    )?.[1];
    act(() => {
      rightClickHandler!({ node: "a.md", event: { original: { preventDefault: vi.fn() }, x: 100, y: 200 } });
    });

    const mergeBtn = container.querySelector("[data-testid='ctx-merge-btn']");
    expect(mergeBtn!.textContent).toBe("Merge 3 documents");
  });

  it("split item hidden with 2+ selected nodes", async () => {
    useGraphSelectionStore.setState({ selectedNodes: ["a.md", "b.md"], selectionMode: "click" });

    const GraphView = (await import("./GraphView")).default;
    const { container } = render(<GraphView onExportNetwork={vi.fn()} onMergeConfirm={vi.fn()} onSplitConfirm={vi.fn()} />);
    await waitFor(() => { expect(mockSigmaOn).toHaveBeenCalled(); });

    const rightClickHandler = mockSigmaOn.mock.calls.find(
      (call) => call[0] === "rightClickNode",
    )?.[1];
    act(() => {
      rightClickHandler!({ node: "a.md", event: { original: { preventDefault: vi.fn() }, x: 100, y: 200 } });
    });

    expect(container.querySelector("[data-testid='ctx-split-btn']")).toBeNull();
  });

  it("split item visible with single node selection", async () => {
    const GraphView = (await import("./GraphView")).default;
    const { container } = render(<GraphView onExportNetwork={vi.fn()} onMergeConfirm={vi.fn()} onSplitConfirm={vi.fn()} />);
    await waitFor(() => { expect(mockSigmaOn).toHaveBeenCalled(); });

    const rightClickHandler = mockSigmaOn.mock.calls.find(
      (call) => call[0] === "rightClickNode",
    )?.[1];
    act(() => {
      rightClickHandler!({ node: "a.md", event: { original: { preventDefault: vi.fn() }, x: 100, y: 200 } });
    });

    const splitBtn = container.querySelector("[data-testid='ctx-split-btn']");
    expect(splitBtn).toBeTruthy();
    expect(splitBtn!.textContent).toBe("Split document");
  });

  it("export network present alongside merge for multi-selection (split hidden)", async () => {
    useGraphSelectionStore.setState({ selectedNodes: ["a.md", "b.md"], selectionMode: "click" });

    const GraphView = (await import("./GraphView")).default;
    const { container } = render(<GraphView onExportNetwork={vi.fn()} onMergeConfirm={vi.fn()} onSplitConfirm={vi.fn()} />);
    await waitFor(() => { expect(mockSigmaOn).toHaveBeenCalled(); });

    const rightClickHandler = mockSigmaOn.mock.calls.find(
      (call) => call[0] === "rightClickNode",
    )?.[1];
    act(() => {
      rightClickHandler!({ node: "a.md", event: { original: { preventDefault: vi.fn() }, x: 100, y: 200 } });
    });

    expect(container.querySelector("[data-testid='ctx-merge-btn']")).toBeTruthy();
    expect(container.querySelector("[data-testid='ctx-split-btn']")).toBeNull();
    expect(container.querySelector("[data-testid='ctx-export-btn']")).toBeTruthy();
  });

  it("split disabled while checking headings", async () => {
    let resolveReadPage: ((v: unknown) => void) | null = null;
    mockInvoke((cmd) => {
      switch (cmd) {
        case "get_graph_subgraph":
          return {
            nodes: [
              { id: "a.md", title: "A" },
              { id: "b.md", title: "B" },
            ],
            edges: [["a.md", "b.md"]],
            pagerank: { "a.md": 0.4, "b.md": 0.6 },
            positions: {},
          };
        case "read_page":
          return new Promise((resolve) => { resolveReadPage = resolve; });
        default:
          throw new Error(`Unknown command: ${cmd}`);
      }
    });

    const GraphView = (await import("./GraphView")).default;
    const { container } = render(<GraphView onExportNetwork={vi.fn()} onMergeConfirm={vi.fn()} onSplitConfirm={vi.fn()} />);
    await waitFor(() => { expect(mockSigmaOn).toHaveBeenCalled(); });

    const rightClickHandler = mockSigmaOn.mock.calls.find(
      (call) => call[0] === "rightClickNode",
    )?.[1];
    act(() => {
      rightClickHandler!({ node: "a.md", event: { original: { preventDefault: vi.fn() }, x: 100, y: 200 } });
    });

    const splitBtn = container.querySelector("[data-testid='ctx-split-btn']") as HTMLButtonElement;
    expect(splitBtn.disabled).toBe(true);

    // Resolve to avoid dangling promise
    await act(async () => {
      resolveReadPage?.({ meta: { title: "A", relative_path: "a.md", frontmatter: {}, created_at: null, modified_at: null, file_type: "markdown" }, body: "## Heading\ncontent", raw_yaml: "" });
    });
  });

  it("split enabled when doc has headings", async () => {
    mockInvoke((cmd) => {
      switch (cmd) {
        case "get_graph_subgraph":
          return {
            nodes: [
              { id: "a.md", title: "A" },
              { id: "b.md", title: "B" },
            ],
            edges: [["a.md", "b.md"]],
            pagerank: { "a.md": 0.4, "b.md": 0.6 },
            positions: {},
          };
        case "read_page":
          return { meta: { title: "A", relative_path: "a.md", frontmatter: {}, created_at: null, modified_at: null, file_type: "markdown" }, body: "## Heading\ncontent", raw_yaml: "" };
        default:
          throw new Error(`Unknown command: ${cmd}`);
      }
    });

    const GraphView = (await import("./GraphView")).default;
    const { container } = render(<GraphView onExportNetwork={vi.fn()} onMergeConfirm={vi.fn()} onSplitConfirm={vi.fn()} />);
    await waitFor(() => { expect(mockSigmaOn).toHaveBeenCalled(); });

    const rightClickHandler = mockSigmaOn.mock.calls.find(
      (call) => call[0] === "rightClickNode",
    )?.[1];
    act(() => {
      rightClickHandler!({ node: "a.md", event: { original: { preventDefault: vi.fn() }, x: 100, y: 200 } });
    });

    await waitFor(() => {
      const splitBtn = container.querySelector("[data-testid='ctx-split-btn']") as HTMLButtonElement;
      expect(splitBtn.disabled).toBe(false);
    });
  });

  it("split greyed out with tooltip when no headings", async () => {
    mockInvoke((cmd) => {
      switch (cmd) {
        case "get_graph_subgraph":
          return {
            nodes: [
              { id: "a.md", title: "A" },
              { id: "b.md", title: "B" },
            ],
            edges: [["a.md", "b.md"]],
            pagerank: { "a.md": 0.4, "b.md": 0.6 },
            positions: {},
          };
        case "read_page":
          return { meta: { title: "A", relative_path: "a.md", frontmatter: {}, created_at: null, modified_at: null, file_type: "markdown" }, body: "just text, no headings", raw_yaml: "" };
        default:
          throw new Error(`Unknown command: ${cmd}`);
      }
    });

    const GraphView = (await import("./GraphView")).default;
    const { container } = render(<GraphView onExportNetwork={vi.fn()} onMergeConfirm={vi.fn()} onSplitConfirm={vi.fn()} />);
    await waitFor(() => { expect(mockSigmaOn).toHaveBeenCalled(); });

    const rightClickHandler = mockSigmaOn.mock.calls.find(
      (call) => call[0] === "rightClickNode",
    )?.[1];
    act(() => {
      rightClickHandler!({ node: "a.md", event: { original: { preventDefault: vi.fn() }, x: 100, y: 200 } });
    });

    await waitFor(() => {
      const splitBtn = container.querySelector("[data-testid='ctx-split-btn']") as HTMLButtonElement;
      expect(splitBtn.disabled).toBe(true);
      expect(splitBtn.getAttribute("title")).toContain("no headings");
    });
  });

  it("click merge → readPage for each selected node → open MergePreviewDialog", async () => {
    const readPageCalls: string[] = [];
    mockInvoke((cmd, args) => {
      switch (cmd) {
        case "get_graph_subgraph":
          return {
            nodes: [
              { id: "a.md", title: "A" },
              { id: "b.md", title: "B" },
            ],
            edges: [["a.md", "b.md"]],
            pagerank: { "a.md": 0.4, "b.md": 0.6 },
            positions: {},
          };
        case "read_page": {
          const path = (args as { relativePath: string }).relativePath;
          readPageCalls.push(path);
          return { meta: { title: path === "a.md" ? "A" : "B", relative_path: path, frontmatter: {}, created_at: null, modified_at: null, file_type: "markdown" }, body: "content", raw_yaml: "" };
        }
        case "preview_merge":
          return { title: "Merged", body: "merged body", frontmatter: {}, source_titles: ["A", "B"] };
        case "cancel_title_suggestion":
          return undefined;
        default:
          throw new Error(`Unknown command: ${cmd}`);
      }
    });
    useGraphSelectionStore.setState({ selectedNodes: ["a.md", "b.md"], selectionMode: "click" });

    const GraphView = (await import("./GraphView")).default;
    const { container } = render(<GraphView onExportNetwork={vi.fn()} onMergeConfirm={vi.fn()} onSplitConfirm={vi.fn()} />);
    await waitFor(() => { expect(mockSigmaOn).toHaveBeenCalled(); });

    const rightClickHandler = mockSigmaOn.mock.calls.find(
      (call) => call[0] === "rightClickNode",
    )?.[1];
    act(() => {
      rightClickHandler!({ node: "a.md", event: { original: { preventDefault: vi.fn() }, x: 100, y: 200 } });
    });

    const mergeBtn = container.querySelector("[data-testid='ctx-merge-btn']") as HTMLButtonElement;
    await act(async () => {
      fireEvent.click(mergeBtn);
    });

    expect(readPageCalls).toContain("a.md");
    expect(readPageCalls).toContain("b.md");

    await waitFor(() => {
      expect(screen.getByTestId("merge-preview-dialog")).toBeTruthy();
    });
  });

  it("click split → previewSplit → open SplitPreviewDialog", async () => {
    mockInvoke((cmd) => {
      switch (cmd) {
        case "get_graph_subgraph":
          return {
            nodes: [
              { id: "a.md", title: "A" },
              { id: "b.md", title: "B" },
            ],
            edges: [["a.md", "b.md"]],
            pagerank: { "a.md": 0.4, "b.md": 0.6 },
            positions: {},
          };
        case "read_page":
          return { meta: { title: "A", relative_path: "a.md", frontmatter: {}, created_at: null, modified_at: null, file_type: "markdown" }, body: "## Heading\ncontent", raw_yaml: "" };
        case "preview_split":
          return { preamble: null, sections: [{ title: "Heading", body: "content", frontmatter: {} }] };
        default:
          throw new Error(`Unknown command: ${cmd}`);
      }
    });

    const GraphView = (await import("./GraphView")).default;
    const { container } = render(<GraphView onExportNetwork={vi.fn()} onMergeConfirm={vi.fn()} onSplitConfirm={vi.fn()} />);
    await waitFor(() => { expect(mockSigmaOn).toHaveBeenCalled(); });

    const rightClickHandler = mockSigmaOn.mock.calls.find(
      (call) => call[0] === "rightClickNode",
    )?.[1];
    act(() => {
      rightClickHandler!({ node: "a.md", event: { original: { preventDefault: vi.fn() }, x: 100, y: 200 } });
    });

    await waitFor(() => {
      const splitBtn = container.querySelector("[data-testid='ctx-split-btn']") as HTMLButtonElement;
      expect(splitBtn.disabled).toBe(false);
    });

    const splitBtn = container.querySelector("[data-testid='ctx-split-btn']") as HTMLButtonElement;
    await act(async () => {
      fireEvent.click(splitBtn);
    });

    await waitFor(() => {
      expect(screen.getByTestId("split-preview-dialog")).toBeTruthy();
    });
  });

  it("context menu dismisses when merge action clicked", async () => {
    mockInvoke((cmd, args) => {
      switch (cmd) {
        case "get_graph_subgraph":
          return {
            nodes: [
              { id: "a.md", title: "A" },
              { id: "b.md", title: "B" },
            ],
            edges: [["a.md", "b.md"]],
            pagerank: { "a.md": 0.4, "b.md": 0.6 },
            positions: {},
          };
        case "read_page": {
          const path = (args as { relativePath: string }).relativePath;
          return { meta: { title: path === "a.md" ? "A" : "B", relative_path: path, frontmatter: {}, created_at: null, modified_at: null, file_type: "markdown" }, body: "content", raw_yaml: "" };
        }
        case "preview_merge":
          return { title: "Merged", body: "merged body", frontmatter: {}, source_titles: ["A", "B"] };
        case "cancel_title_suggestion":
          return undefined;
        default:
          throw new Error(`Unknown command: ${cmd}`);
      }
    });
    useGraphSelectionStore.setState({ selectedNodes: ["a.md", "b.md"], selectionMode: "click" });

    const GraphView = (await import("./GraphView")).default;
    const { container } = render(<GraphView onExportNetwork={vi.fn()} onMergeConfirm={vi.fn()} onSplitConfirm={vi.fn()} />);
    await waitFor(() => { expect(mockSigmaOn).toHaveBeenCalled(); });

    const rightClickHandler = mockSigmaOn.mock.calls.find(
      (call) => call[0] === "rightClickNode",
    )?.[1];
    act(() => {
      rightClickHandler!({ node: "a.md", event: { original: { preventDefault: vi.fn() }, x: 100, y: 200 } });
    });

    expect(container.querySelector("[data-graph-context-menu]")).toBeTruthy();

    const mergeBtn = container.querySelector("[data-testid='ctx-merge-btn']") as HTMLButtonElement;
    await act(async () => {
      fireEvent.click(mergeBtn);
    });

    expect(container.querySelector("[data-graph-context-menu]")).toBeNull();
  });

  it("merge dialog confirm fires onMergeConfirm callback prop", async () => {
    mockInvoke((cmd, args) => {
      switch (cmd) {
        case "get_graph_subgraph":
          return {
            nodes: [
              { id: "a.md", title: "A" },
              { id: "b.md", title: "B" },
            ],
            edges: [["a.md", "b.md"]],
            pagerank: { "a.md": 0.4, "b.md": 0.6 },
            positions: {},
          };
        case "read_page": {
          const path = (args as { relativePath: string }).relativePath;
          return { meta: { title: path === "a.md" ? "A" : "B", relative_path: path, frontmatter: {}, created_at: null, modified_at: null, file_type: "markdown" }, body: "content", raw_yaml: "" };
        }
        case "preview_merge":
          return { title: "Merged", body: "merged body", frontmatter: {}, source_titles: ["A", "B"] };
        case "cancel_title_suggestion":
          return undefined;
        default:
          throw new Error(`Unknown command: ${cmd}`);
      }
    });
    useGraphSelectionStore.setState({ selectedNodes: ["a.md", "b.md"], selectionMode: "click" });

    const onMergeConfirm = vi.fn();
    const GraphView = (await import("./GraphView")).default;
    const { container } = render(<GraphView onExportNetwork={vi.fn()} onMergeConfirm={onMergeConfirm} onSplitConfirm={vi.fn()} />);
    await waitFor(() => { expect(mockSigmaOn).toHaveBeenCalled(); });

    const rightClickHandler = mockSigmaOn.mock.calls.find(
      (call) => call[0] === "rightClickNode",
    )?.[1];
    act(() => {
      rightClickHandler!({ node: "a.md", event: { original: { preventDefault: vi.fn() }, x: 100, y: 200 } });
    });

    const mergeBtn = container.querySelector("[data-testid='ctx-merge-btn']") as HTMLButtonElement;
    await act(async () => {
      fireEvent.click(mergeBtn);
    });

    await waitFor(() => {
      expect(screen.getByTestId("merge-preview-dialog")).toBeTruthy();
    });

    const confirmBtn = screen.getByTestId("merge-confirm-btn");
    await act(async () => {
      fireEvent.click(confirmBtn);
    });

    expect(onMergeConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ body: "merged body" }),
      expect.any(Array),
      expect.any(Array),
    );
  });

  it("split dialog confirm fires onSplitConfirm callback prop", async () => {
    mockInvoke((cmd) => {
      switch (cmd) {
        case "get_graph_subgraph":
          return {
            nodes: [
              { id: "a.md", title: "A" },
              { id: "b.md", title: "B" },
            ],
            edges: [["a.md", "b.md"]],
            pagerank: { "a.md": 0.4, "b.md": 0.6 },
            positions: {},
          };
        case "read_page":
          return { meta: { title: "A", relative_path: "a.md", frontmatter: {}, created_at: null, modified_at: null, file_type: "markdown" }, body: "## Heading\ncontent", raw_yaml: "" };
        case "preview_split":
          return { preamble: null, sections: [{ title: "Heading", body: "content", frontmatter: {} }] };
        default:
          throw new Error(`Unknown command: ${cmd}`);
      }
    });

    const onSplitConfirm = vi.fn();
    const GraphView = (await import("./GraphView")).default;
    const { container } = render(<GraphView onExportNetwork={vi.fn()} onMergeConfirm={vi.fn()} onSplitConfirm={onSplitConfirm} />);
    await waitFor(() => { expect(mockSigmaOn).toHaveBeenCalled(); });

    const rightClickHandler = mockSigmaOn.mock.calls.find(
      (call) => call[0] === "rightClickNode",
    )?.[1];
    act(() => {
      rightClickHandler!({ node: "a.md", event: { original: { preventDefault: vi.fn() }, x: 100, y: 200 } });
    });

    await waitFor(() => {
      const splitBtn = container.querySelector("[data-testid='ctx-split-btn']") as HTMLButtonElement;
      expect(splitBtn.disabled).toBe(false);
    });

    const splitBtn = container.querySelector("[data-testid='ctx-split-btn']") as HTMLButtonElement;
    await act(async () => {
      fireEvent.click(splitBtn);
    });

    await waitFor(() => {
      expect(screen.getByTestId("split-preview-dialog")).toBeTruthy();
    });

    const confirmBtn = screen.getByTestId("split-confirm-btn");
    await act(async () => {
      fireEvent.click(confirmBtn);
    });

    expect(onSplitConfirm).toHaveBeenCalledWith("a.md", expect.objectContaining({ sections: expect.any(Array) }));
  });

  it("cancel merge dialog resets state", async () => {
    mockInvoke((cmd, args) => {
      switch (cmd) {
        case "get_graph_subgraph":
          return {
            nodes: [
              { id: "a.md", title: "A" },
              { id: "b.md", title: "B" },
            ],
            edges: [["a.md", "b.md"]],
            pagerank: { "a.md": 0.4, "b.md": 0.6 },
            positions: {},
          };
        case "read_page": {
          const path = (args as { relativePath: string }).relativePath;
          return { meta: { title: path === "a.md" ? "A" : "B", relative_path: path, frontmatter: {}, created_at: null, modified_at: null, file_type: "markdown" }, body: "content", raw_yaml: "" };
        }
        case "preview_merge":
          return { title: "Merged", body: "merged body", frontmatter: {}, source_titles: ["A", "B"] };
        case "cancel_title_suggestion":
          return undefined;
        default:
          throw new Error(`Unknown command: ${cmd}`);
      }
    });
    useGraphSelectionStore.setState({ selectedNodes: ["a.md", "b.md"], selectionMode: "click" });

    const GraphView = (await import("./GraphView")).default;
    const { container } = render(<GraphView onExportNetwork={vi.fn()} onMergeConfirm={vi.fn()} onSplitConfirm={vi.fn()} />);
    await waitFor(() => { expect(mockSigmaOn).toHaveBeenCalled(); });

    const rightClickHandler = mockSigmaOn.mock.calls.find(
      (call) => call[0] === "rightClickNode",
    )?.[1];
    act(() => {
      rightClickHandler!({ node: "a.md", event: { original: { preventDefault: vi.fn() }, x: 100, y: 200 } });
    });

    const mergeBtn = container.querySelector("[data-testid='ctx-merge-btn']") as HTMLButtonElement;
    await act(async () => {
      fireEvent.click(mergeBtn);
    });

    await waitFor(() => {
      expect(screen.getByTestId("merge-preview-dialog")).toBeTruthy();
    });

    const cancelBtn = screen.getByTestId("merge-cancel-btn");
    await act(async () => {
      fireEvent.click(cancelBtn);
    });

    expect(screen.queryByTestId("merge-preview-dialog")).toBeNull();
  });

  it("cancel split dialog resets state", async () => {
    mockInvoke((cmd) => {
      switch (cmd) {
        case "get_graph_subgraph":
          return {
            nodes: [
              { id: "a.md", title: "A" },
              { id: "b.md", title: "B" },
            ],
            edges: [["a.md", "b.md"]],
            pagerank: { "a.md": 0.4, "b.md": 0.6 },
            positions: {},
          };
        case "read_page":
          return { meta: { title: "A", relative_path: "a.md", frontmatter: {}, created_at: null, modified_at: null, file_type: "markdown" }, body: "## Heading\ncontent", raw_yaml: "" };
        case "preview_split":
          return { preamble: null, sections: [{ title: "Heading", body: "content", frontmatter: {} }] };
        default:
          throw new Error(`Unknown command: ${cmd}`);
      }
    });

    const GraphView = (await import("./GraphView")).default;
    const { container } = render(<GraphView onExportNetwork={vi.fn()} onMergeConfirm={vi.fn()} onSplitConfirm={vi.fn()} />);
    await waitFor(() => { expect(mockSigmaOn).toHaveBeenCalled(); });

    const rightClickHandler = mockSigmaOn.mock.calls.find(
      (call) => call[0] === "rightClickNode",
    )?.[1];
    act(() => {
      rightClickHandler!({ node: "a.md", event: { original: { preventDefault: vi.fn() }, x: 100, y: 200 } });
    });

    await waitFor(() => {
      const splitBtn = container.querySelector("[data-testid='ctx-split-btn']") as HTMLButtonElement;
      expect(splitBtn.disabled).toBe(false);
    });

    const splitBtn = container.querySelector("[data-testid='ctx-split-btn']") as HTMLButtonElement;
    await act(async () => {
      fireEvent.click(splitBtn);
    });

    await waitFor(() => {
      expect(screen.getByTestId("split-preview-dialog")).toBeTruthy();
    });

    const cancelBtn = screen.getByTestId("split-cancel-btn");
    await act(async () => {
      fireEvent.click(cancelBtn);
    });

    expect(screen.queryByTestId("split-preview-dialog")).toBeNull();
  });

  it("visual separator exists between operation items and export", async () => {
    useGraphSelectionStore.setState({ selectedNodes: ["a.md", "b.md"], selectionMode: "click" });

    const GraphView = (await import("./GraphView")).default;
    const { container } = render(<GraphView onExportNetwork={vi.fn()} onMergeConfirm={vi.fn()} onSplitConfirm={vi.fn()} />);
    await waitFor(() => { expect(mockSigmaOn).toHaveBeenCalled(); });

    const rightClickHandler = mockSigmaOn.mock.calls.find(
      (call) => call[0] === "rightClickNode",
    )?.[1];
    act(() => {
      rightClickHandler!({ node: "a.md", event: { original: { preventDefault: vi.fn() }, x: 100, y: 200 } });
    });

    expect(container.querySelector("[data-testid='ctx-divider']")).toBeTruthy();
  });

  it("delete button shows in context menu and opens confirmation dialog", async () => {
    const GraphView = (await import("./GraphView")).default;
    render(<GraphView />);
    await waitFor(() => { expect(mockSigmaOn).toHaveBeenCalled(); });

    const rightClickHandler = mockSigmaOn.mock.calls.find(
      (call) => call[0] === "rightClickNode",
    )?.[1];
    act(() => {
      rightClickHandler!({ node: "a.md", event: { original: { preventDefault: vi.fn() }, x: 100, y: 200 } });
    });

    const deleteBtn = screen.getByTestId("ctx-delete-btn");
    expect(deleteBtn.textContent).toBe("Delete document");

    await act(async () => { fireEvent.click(deleteBtn); });

    expect(screen.getByTestId("confirm-delete-dialog")).toBeTruthy();
    expect(screen.getByTestId("confirm-delete-dialog").textContent).toContain("trash");
  });

  it("delete button shows count when multiple nodes selected", async () => {
    useGraphSelectionStore.setState({ selectedNodes: ["a.md", "b.md"], selectionMode: "click" });

    const GraphView = (await import("./GraphView")).default;
    render(<GraphView />);
    await waitFor(() => { expect(mockSigmaOn).toHaveBeenCalled(); });

    const rightClickHandler = mockSigmaOn.mock.calls.find(
      (call) => call[0] === "rightClickNode",
    )?.[1];
    act(() => {
      rightClickHandler!({ node: "a.md", event: { original: { preventDefault: vi.fn() }, x: 100, y: 200 } });
    });

    const deleteBtn = screen.getByTestId("ctx-delete-btn");
    expect(deleteBtn.textContent).toBe("Delete 2 documents");
  });

  it("cancel button in delete dialog dismisses without deleting", async () => {
    const GraphView = (await import("./GraphView")).default;
    render(<GraphView />);
    await waitFor(() => { expect(mockSigmaOn).toHaveBeenCalled(); });

    const rightClickHandler = mockSigmaOn.mock.calls.find(
      (call) => call[0] === "rightClickNode",
    )?.[1];
    act(() => {
      rightClickHandler!({ node: "a.md", event: { original: { preventDefault: vi.fn() }, x: 100, y: 200 } });
    });

    await act(async () => { fireEvent.click(screen.getByTestId("ctx-delete-btn")); });
    expect(screen.getByTestId("confirm-delete-dialog")).toBeTruthy();

    await act(async () => { fireEvent.click(screen.getByTestId("confirm-delete-cancel")); });
    expect(screen.queryByTestId("confirm-delete-dialog")).toBeNull();
  });
});
