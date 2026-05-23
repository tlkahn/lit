import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { mockInvoke, mockListen, emitMockEvent, resetListenMock } from "../test/tauri-mock";
import * as graphLayout from "../lib/graphLayout";
import * as qualityTiers from "../lib/qualityTiers";
import { setPerfEnabled } from "../lib/perf";

const mockSigmaKill = vi.fn();
const mockSigmaOn = vi.fn();
const mockSigmaOff = vi.fn();
const mockSigmaSetSetting = vi.fn();
const mockCameraAnimatedReset = vi.fn();
const mockCameraAnimate = vi.fn();
const mockGetNodeDisplayData = vi.fn().mockReturnValue({ x: 0, y: 0 });
const mockSigmaRefresh = vi.fn();
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

vi.mock("@react-three/fiber", () => ({
  Canvas: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="r3f-canvas">{children}</div>
  ),
  useThree: () => ({
    camera: { position: { set: vi.fn(), x: 0, y: 0, z: 0 }, lookAt: vi.fn(), fov: 75 },
    gl: {
      domElement: {
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      },
    },
    pointer: { x: 0, y: 0 },
    size: { width: 800, height: 600 },
  }),
  useFrame: vi.fn(),
}));
vi.mock("@react-three/drei", () => ({
  OrbitControls: vi.fn(() => null),
}));

let rafQueue: Map<number, FrameRequestCallback> = new Map();
let nextRafId = 1;
const flushRAF = () => {
  const cbs = [...rafQueue.values()];
  rafQueue.clear();
  cbs.forEach((cb) => cb(performance.now()));
};

describe("GraphView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lastSigmaOptions = {};
    rafQueue = new Map();
    nextRafId = 1;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb: FrameRequestCallback) => {
      const id = nextRafId++;
      rafQueue.set(id, cb);
      return id;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id: number) => { rafQueue.delete(id); });
    setPerfEnabled(false);
    mockInvoke((cmd) => {
      switch (cmd) {
        case "get_graph_subgraph":
          return {
            nodes: [
              { id: "a.md", title: "A", is_stub: false },
              { id: "b.md", title: "B", is_stub: false },
            ],
            edges: [["a.md", "b.md"]],
            pagerank: { "a.md": 0.4, "b.md": 0.6 },
            positions_2d: {},
            positions_3d: {},
          };
        case "get_graph_positions":
          return {};
        case "compute_layout_3d":
          return undefined;
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
    clickNodeHandler!({ node: "a.md" });

    expect(onNav2).toHaveBeenCalledWith("a.md");
    expect(onNav1).not.toHaveBeenCalled();
  });

  it("uses theme CSS variables for graph node colors", async () => {
    document.documentElement.style.setProperty("--interactive-accent", "#ff0000");
    document.documentElement.style.setProperty("--text-faint", "#00ff00");

    const buildGraphSpy = vi.spyOn(graphLayout, "buildGraph");

    const GraphView = (await import("./GraphView")).default;
    render(<GraphView />);

    await waitFor(() => {
      expect(buildGraphSpy).toHaveBeenCalled();
    });

    const callArgs = buildGraphSpy.mock.calls[0]![0];
    expect(callArgs.accentColor).toBe("#ff0000");
    expect(callArgs.stubColor).toBe("#00ff00");

    buildGraphSpy.mockRestore();
    document.documentElement.style.removeProperty("--interactive-accent");
    document.documentElement.style.removeProperty("--text-faint");
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
      positions_2d: { "a.md": { x: 999, y: 999 }, "b.md": { x: 999, y: 999 } },
      timestamp: Date.now(),
    }));

    mockInvoke((cmd) => {
      switch (cmd) {
        case "get_graph_subgraph":
          return {
            nodes: [
              { id: "a.md", title: "A", is_stub: false },
              { id: "b.md", title: "B", is_stub: false },
            ],
            edges: [["a.md", "b.md"]],
            pagerank: { "a.md": 0.4, "b.md": 0.6 },
            positions_2d: { "a.md": { x: 42, y: 42 }, "b.md": { x: 42, y: 42 } },
          };
        default:
          throw new Error(`Unknown command: ${cmd}`);
      }
    });

    const buildGraphSpy = vi.spyOn(graphLayout, "buildGraph");
    const GraphView = (await import("./GraphView")).default;
    render(<GraphView />);

    await waitFor(() => { expect(mockSigmaOn).toHaveBeenCalled(); });

    const graph = buildGraphSpy.mock.results[0]!.value as import("graphology").default;
    expect(graph.getNodeAttribute("a.md", "x")).toBe(42);
    expect(graph.getNodeAttribute("a.md", "y")).toBe(42);

    buildGraphSpy.mockRestore();
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
              { id: "a.md", title: "A", is_stub: false },
              { id: "b.md", title: "B", is_stub: false },
            ],
            edges: [["a.md", "b.md"]],
            pagerank: { "a.md": 0.4, "b.md": 0.6 },
            positions_2d: {},
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

  it("in local mode, buildGraph is called with seedId=activePageId", async () => {
    const buildGraphSpy = vi.spyOn(graphLayout, "buildGraph");
    const GraphView = (await import("./GraphView")).default;
    render(<GraphView activePageId="a.md" />);
    await waitFor(() => { expect(mockSigmaOn).toHaveBeenCalled(); });

    buildGraphSpy.mockClear();

    await act(async () => {
      await userEvent.click(screen.getByRole("button", { name: "Local" }));
    });

    await waitFor(() => {
      expect(buildGraphSpy).toHaveBeenCalled();
    });
    expect(buildGraphSpy.mock.calls[0]![0].seedId).toBe("a.md");
    buildGraphSpy.mockRestore();
  });

  it("in full mode, buildGraph is called without seedId", async () => {
    const buildGraphSpy = vi.spyOn(graphLayout, "buildGraph");
    const GraphView = (await import("./GraphView")).default;
    render(<GraphView />);

    await waitFor(() => {
      expect(buildGraphSpy).toHaveBeenCalled();
    });
    expect(buildGraphSpy.mock.calls[0]![0].seedId).toBeUndefined();
    buildGraphSpy.mockRestore();
  });

  it("enterNode sets nodeReducer and edgeReducer on sigma", async () => {
    const GraphView = (await import("./GraphView")).default;
    render(<GraphView />);
    await waitFor(() => { expect(mockSigmaOn).toHaveBeenCalled(); });

    const enterNodeHandler = mockSigmaOn.mock.calls.find(
      (call) => call[0] === "enterNode",
    )?.[1];
    expect(enterNodeHandler).toBeDefined();
    act(() => { enterNodeHandler!({ node: "a.md", event: { x: 100, y: 200 } }); });

    expect(mockSigmaSetSetting).toHaveBeenCalledWith("nodeReducer", expect.any(Function));
    expect(mockSigmaSetSetting).toHaveBeenCalledWith("edgeReducer", expect.any(Function));
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

    expect(mockSigmaSetSetting).toHaveBeenCalledWith("nodeReducer", null);
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
    act(() => { clickStageHandler!(); });

    expect(mockSigmaSetSetting).toHaveBeenCalledWith("nodeReducer", null);
    expect(mockSigmaSetSetting).toHaveBeenCalledWith("edgeReducer", null);
  });

  it("reset zoom button triggers camera animatedReset", async () => {
    const GraphView = (await import("./GraphView")).default;
    render(<GraphView />);
    await waitFor(() => { expect(mockSigmaOn).toHaveBeenCalled(); });

    await userEvent.click(screen.getByRole("button", { name: "Reset zoom" }));
    expect(mockCameraAnimatedReset).toHaveBeenCalled();
  });

  it("moveBody updates tooltip position while node is hovered", async () => {
    const GraphView = (await import("./GraphView")).default;
    render(<GraphView />);
    await waitFor(() => { expect(mockSigmaOn).toHaveBeenCalled(); });

    const enterNodeHandler = mockSigmaOn.mock.calls.find(
      (call) => call[0] === "enterNode",
    )?.[1];
    act(() => { enterNodeHandler!({ node: "a.md", event: { x: 100, y: 200 } }); });

    const moveBodyHandler = mockSigmaOn.mock.calls.find(
      (call) => call[0] === "moveBody",
    )?.[1];
    expect(moveBodyHandler).toBeDefined();
    act(() => {
      moveBodyHandler!({ event: { x: 300, y: 400 } });
      flushRAF();
    });

    const tooltip = document.querySelector(".graph-tooltip") as HTMLElement;
    expect(tooltip).toBeTruthy();
    expect(tooltip.style.left).toBe("310px");
    expect(tooltip.style.top).toBe("410px");
  });

  it("moveBody is ignored when no node is hovered", async () => {
    const GraphView = (await import("./GraphView")).default;
    render(<GraphView />);
    await waitFor(() => { expect(mockSigmaOn).toHaveBeenCalled(); });

    const moveBodyHandler = mockSigmaOn.mock.calls.find(
      (call) => call[0] === "moveBody",
    )?.[1];
    expect(moveBodyHandler).toBeDefined();
    act(() => { moveBodyHandler!({ event: { x: 300, y: 400 } }); });

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

  it("moveBody batches multiple events into one rAF update", async () => {
    const GraphView = (await import("./GraphView")).default;
    render(<GraphView />);
    await waitFor(() => { expect(mockSigmaOn).toHaveBeenCalled(); });

    const enterNodeHandler = mockSigmaOn.mock.calls.find(
      (call) => call[0] === "enterNode",
    )?.[1];
    act(() => { enterNodeHandler!({ node: "a.md", event: { x: 0, y: 0 } }); });

    const moveBodyHandler = mockSigmaOn.mock.calls.find(
      (call) => call[0] === "moveBody",
    )?.[1];
    act(() => {
      moveBodyHandler!({ event: { x: 100, y: 100 } });
      moveBodyHandler!({ event: { x: 200, y: 200 } });
      moveBodyHandler!({ event: { x: 300, y: 400 } });
      flushRAF();
    });

    const tooltip = document.querySelector(".graph-tooltip") as HTMLElement;
    expect(tooltip).toBeTruthy();
    expect(tooltip.style.left).toBe("310px");
    expect(tooltip.style.top).toBe("410px");
  });

  it("rAF is cancelled on leaveNode", async () => {
    const GraphView = (await import("./GraphView")).default;
    render(<GraphView />);
    await waitFor(() => { expect(mockSigmaOn).toHaveBeenCalled(); });

    const enterNodeHandler = mockSigmaOn.mock.calls.find(
      (call) => call[0] === "enterNode",
    )?.[1];
    act(() => { enterNodeHandler!({ node: "a.md", event: { x: 0, y: 0 } }); });

    const moveBodyHandler = mockSigmaOn.mock.calls.find(
      (call) => call[0] === "moveBody",
    )?.[1];
    act(() => { moveBodyHandler!({ event: { x: 500, y: 500 } }); });

    const leaveNodeHandler = mockSigmaOn.mock.calls.find(
      (call) => call[0] === "leaveNode",
    )?.[1];
    act(() => { leaveNodeHandler!(); });

    act(() => { flushRAF(); });

    const tooltip = document.querySelector(".graph-tooltip") as HTMLElement;
    expect(tooltip).toBeNull();
  });

  it("moveBody after leaveNode does not update tooltip", async () => {
    const GraphView = (await import("./GraphView")).default;
    render(<GraphView />);
    await waitFor(() => { expect(mockSigmaOn).toHaveBeenCalled(); });

    const enterNodeHandler = mockSigmaOn.mock.calls.find(
      (call) => call[0] === "enterNode",
    )?.[1];
    const leaveNodeHandler = mockSigmaOn.mock.calls.find(
      (call) => call[0] === "leaveNode",
    )?.[1];
    const moveBodyHandler = mockSigmaOn.mock.calls.find(
      (call) => call[0] === "moveBody",
    )?.[1];

    act(() => { enterNodeHandler!({ node: "a.md", event: { x: 100, y: 200 } }); });
    act(() => { leaveNodeHandler!(); });
    act(() => {
      moveBodyHandler!({ event: { x: 999, y: 999 } });
      flushRAF();
    });

    expect(document.querySelector(".graph-tooltip")).toBeNull();
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

    expect(mockSigmaSetSetting).toHaveBeenCalledWith("nodeReducer", null);
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

  it("enterNode nodeReducer uses theme dim color for non-neighbors", async () => {
    document.documentElement.style.setProperty("--background-modifier-border", "#3d444d");
    const GraphView = (await import("./GraphView")).default;
    render(<GraphView />);
    await waitFor(() => { expect(mockSigmaOn).toHaveBeenCalled(); });

    const enterNodeHandler = mockSigmaOn.mock.calls.find(
      (call) => call[0] === "enterNode",
    )?.[1];
    act(() => { enterNodeHandler!({ node: "a.md", event: { x: 0, y: 0 } }); });

    const nodeReducerCall = mockSigmaSetSetting.mock.calls.find(
      (call) => call[0] === "nodeReducer",
    );
    const reducer = nodeReducerCall![1] as (node: string, attrs: Record<string, unknown>) => Record<string, unknown>;
    const dimmed = reducer("nonexistent-node", { color: "#000", label: "X" });
    expect(dimmed.color).toBe("#3d444d");

    document.documentElement.style.removeProperty("--background-modifier-border");
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

  it("tierSettingsRef default is derived from getTierSettings('medium'), not hardcoded", async () => {
    const spy = vi.spyOn(qualityTiers, "getTierSettings");

    const GraphView = (await import("./GraphView")).default;
    render(<GraphView />);

    expect(spy).toHaveBeenCalledWith("medium");
    spy.mockRestore();
  });

  it("small graph: Sigma gets enableEdgeEvents=true and labelRenderedSizeThreshold=0", async () => {
    const GraphView = (await import("./GraphView")).default;
    render(<GraphView />);
    await waitFor(() => { expect(mockSigmaOn).toHaveBeenCalled(); });

    expect(lastSigmaOptions.enableEdgeEvents).toBe(true);
    expect(lastSigmaOptions.labelRenderedSizeThreshold).toBe(0);
    expect(lastSigmaOptions.hideEdgesOnMove).toBe(false);
    expect(lastSigmaOptions.hideLabelsOnMove).toBe(false);
  });

  it("huge graph: default edgeReducer hides all edges", async () => {
    const mockGraph = {
      order: 25000, size: 30000,
      neighbors: vi.fn().mockReturnValue([]),
      source: vi.fn().mockReturnValue("a"),
      target: vi.fn().mockReturnValue("b"),
      getNodeAttribute: vi.fn().mockReturnValue("Node"),
      degree: vi.fn().mockReturnValue(0),
      forEachNode: vi.fn(),
    };
    const spy = vi.spyOn(graphLayout, "buildGraph").mockReturnValue(mockGraph as never);

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
    const mockGraph = {
      order: 25000, size: 30000,
      neighbors: vi.fn().mockReturnValue([]),
      source: vi.fn().mockReturnValue("a"),
      target: vi.fn().mockReturnValue("b"),
      getNodeAttribute: vi.fn().mockReturnValue("Node"),
      degree: vi.fn().mockReturnValue(0),
      forEachNode: vi.fn(),
    };
    const spy = vi.spyOn(graphLayout, "buildGraph").mockReturnValue(mockGraph as never);

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
    const mockGraph = {
      order: 25000, size: 30000,
      neighbors: vi.fn().mockReturnValue([]),
      source: vi.fn().mockReturnValue("a"),
      target: vi.fn().mockReturnValue("b"),
      getNodeAttribute: vi.fn().mockReturnValue("Node"),
      degree: vi.fn().mockReturnValue(0),
      forEachNode: vi.fn(),
    };
    const spy = vi.spyOn(graphLayout, "buildGraph").mockReturnValue(mockGraph as never);

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
    const mockGraph = {
      order: 25000, size: 30000,
      neighbors: vi.fn().mockReturnValue([]),
      source: vi.fn().mockReturnValue("a"),
      target: vi.fn().mockReturnValue("b"),
      getNodeAttribute: vi.fn().mockReturnValue("Node"),
      degree: vi.fn().mockReturnValue(0),
      forEachNode: vi.fn(),
    };
    const spy = vi.spyOn(graphLayout, "buildGraph").mockReturnValue(mockGraph as never);

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

  it("medium graph: Sigma gets labelRenderedSizeThreshold=6 and no edge events", async () => {
    const mockGraph = {
      order: 3000, size: 4000,
      neighbors: vi.fn().mockReturnValue([]),
      source: vi.fn().mockReturnValue("a"),
      target: vi.fn().mockReturnValue("b"),
      getNodeAttribute: vi.fn().mockReturnValue("Node"),
      degree: vi.fn().mockReturnValue(0),
      forEachNode: vi.fn(),
    };
    const spy = vi.spyOn(graphLayout, "buildGraph").mockReturnValue(mockGraph as never);

    const GraphView = (await import("./GraphView")).default;
    render(<GraphView />);
    await waitFor(() => { expect(mockSigmaOn).toHaveBeenCalled(); });

    expect(lastSigmaOptions.enableEdgeEvents).toBe(false);
    expect(lastSigmaOptions.labelRenderedSizeThreshold).toBe(6);
    expect(lastSigmaOptions.hideEdgesOnMove).toBe(false);
    expect(lastSigmaOptions.hideLabelsOnMove).toBe(false);

    spy.mockRestore();
  });

  it("large graph: Sigma gets hideEdgesOnMove and hideLabelsOnMove", async () => {
    const mockGraph = {
      order: 10000, size: 15000,
      neighbors: vi.fn().mockReturnValue([]),
      source: vi.fn().mockReturnValue("a"),
      target: vi.fn().mockReturnValue("b"),
      getNodeAttribute: vi.fn().mockReturnValue("Node"),
      degree: vi.fn().mockReturnValue(0),
      forEachNode: vi.fn(),
    };
    const spy = vi.spyOn(graphLayout, "buildGraph").mockReturnValue(mockGraph as never);

    const GraphView = (await import("./GraphView")).default;
    render(<GraphView />);
    await waitFor(() => { expect(mockSigmaOn).toHaveBeenCalled(); });

    expect(lastSigmaOptions.enableEdgeEvents).toBe(false);
    expect(lastSigmaOptions.labelRenderedSizeThreshold).toBe(12);
    expect(lastSigmaOptions.hideEdgesOnMove).toBe(true);
    expect(lastSigmaOptions.hideLabelsOnMove).toBe(true);

    spy.mockRestore();
  });

  // --- Keep Sigma/Graphology Alive ---

  it("visible=false keeps sigma alive", async () => {
    const GraphView = (await import("./GraphView")).default;
    const { rerender } = render(<GraphView visible={true} />);
    await waitFor(() => { expect(mockSigmaOn).toHaveBeenCalled(); });

    await act(async () => {
      rerender(<GraphView visible={false} />);
    });

    expect(mockSigmaKill).not.toHaveBeenCalled();
  });

  it("visible=true after hidden calls sigma.refresh()", async () => {
    const GraphView = (await import("./GraphView")).default;
    const { rerender } = render(<GraphView visible={true} />);
    await waitFor(() => { expect(mockSigmaOn).toHaveBeenCalled(); });

    await act(async () => { rerender(<GraphView visible={false} />); });
    mockSigmaRefresh.mockClear();
    await act(async () => { rerender(<GraphView visible={true} />); });

    expect(mockSigmaRefresh).toHaveBeenCalled();
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

  it("local mode re-inits when seed changes while hidden, on becoming visible", async () => {
    const GraphView = (await import("./GraphView")).default;
    const { rerender } = render(<GraphView visible={true} activePageId="a.md" initialMode="local" />);
    await waitFor(() => { expect(mockSigmaOn).toHaveBeenCalled(); });

    const { invoke } = await import("@tauri-apps/api/core");
    (invoke as unknown as ReturnType<typeof vi.fn>).mockClear();
    mockSigmaKill.mockClear();

    // Hide and change seed
    await act(async () => {
      rerender(<GraphView visible={false} activePageId="b.md" initialMode="local" />);
    });
    // No re-init while hidden
    expect(invoke).not.toHaveBeenCalledWith("get_graph_subgraph", expect.anything());

    // Show again — should detect stale seed and re-init
    await act(async () => {
      rerender(<GraphView visible={true} activePageId="b.md" initialMode="local" />);
    });
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("get_graph_subgraph", { seeds: ["b.md"], depth: 2, directed: null });
    });
  });

  it("huge graph: clearing search query restores hide-all-edges reducer", async () => {
    const mockGraph = {
      order: 25000, size: 30000,
      neighbors: vi.fn().mockReturnValue([]),
      source: vi.fn().mockReturnValue("a"),
      target: vi.fn().mockReturnValue("b"),
      getNodeAttribute: vi.fn().mockReturnValue("Node"),
      degree: vi.fn().mockReturnValue(0),
      forEachNode: vi.fn(),
    };
    const spy = vi.spyOn(graphLayout, "buildGraph").mockReturnValue(mockGraph as never);

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

  // --- Incremental Graph Diff ---

  it("listens to lit:graph-updated and applies incremental diff (new node appears)", async () => {
    mockListen();
    let callCount = 0;
    mockInvoke((cmd) => {
      switch (cmd) {
        case "get_graph_subgraph":
          callCount++;
          if (callCount <= 2) {
            return {
              nodes: [
                { id: "a.md", title: "A", is_stub: false },
                { id: "b.md", title: "B", is_stub: false },
              ],
              edges: [["a.md", "b.md"]],
              pagerank: { "a.md": 0.4, "b.md": 0.6 },
              positions_2d: {},
            };
          }
          return {
            nodes: [
              { id: "a.md", title: "A", is_stub: false },
              { id: "b.md", title: "B", is_stub: false },
              { id: "c.md", title: "C", is_stub: false },
            ],
            edges: [["a.md", "b.md"], ["a.md", "c.md"]],
            pagerank: { "a.md": 0.4, "b.md": 0.3, "c.md": 0.3 },
            positions_2d: {},
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

  it("empty diff triggers no sigma refresh", async () => {
    mockListen();
    mockInvoke((cmd) => {
      switch (cmd) {
        case "get_graph_subgraph":
          return {
            nodes: [
              { id: "a.md", title: "A", is_stub: false },
              { id: "b.md", title: "B", is_stub: false },
            ],
            edges: [["a.md", "b.md"]],
            pagerank: { "a.md": 0.4, "b.md": 0.6 },
            positions_2d: {},
          };
        default:
          throw new Error(`Unknown command: ${cmd}`);
      }
    });

    const GraphView = (await import("./GraphView")).default;
    render(<GraphView />);
    await waitFor(() => { expect(mockSigmaOn).toHaveBeenCalled(); });

    mockSigmaRefresh.mockClear();

    await act(async () => {
      emitMockEvent("lit:graph-updated", {});
    });

    await act(async () => {});

    expect(mockSigmaRefresh).not.toHaveBeenCalled();

    resetListenMock();
  });

  it("diff applied while hidden defers sigma.refresh() until visible", async () => {
    mockListen();
    let callCount = 0;
    mockInvoke((cmd) => {
      switch (cmd) {
        case "get_graph_subgraph":
          callCount++;
          if (callCount <= 2) {
            return {
              nodes: [
                { id: "a.md", title: "A", is_stub: false },
                { id: "b.md", title: "B", is_stub: false },
              ],
              edges: [["a.md", "b.md"]],
              pagerank: { "a.md": 0.4, "b.md": 0.6 },
              positions_2d: {},
            };
          }
          return {
            nodes: [
              { id: "a.md", title: "A", is_stub: false },
              { id: "b.md", title: "B", is_stub: false },
              { id: "d.md", title: "D", is_stub: false },
            ],
            edges: [["a.md", "b.md"], ["b.md", "d.md"]],
            pagerank: { "a.md": 0.4, "b.md": 0.3, "d.md": 0.3 },
            positions_2d: {},
          };
        default:
          throw new Error(`Unknown command: ${cmd}`);
      }
    });

    const GraphView = (await import("./GraphView")).default;
    const { rerender } = render(<GraphView visible={true} />);
    await waitFor(() => { expect(mockSigmaOn).toHaveBeenCalled(); });

    // Hide the graph
    await act(async () => { rerender(<GraphView visible={false} />); });
    mockSigmaRefresh.mockClear();

    // Emit event while hidden
    await act(async () => {
      emitMockEvent("lit:graph-updated", {});
    });

    await act(async () => {});

    // sigma.refresh should NOT be called while hidden
    expect(mockSigmaRefresh).not.toHaveBeenCalled();

    // Show again — pending refresh should fire
    await act(async () => { rerender(<GraphView visible={true} />); });
    expect(mockSigmaRefresh).toHaveBeenCalled();

    resetListenMock();
  });

  // --- Neighbor fallback for uncached nodes ---

  it("uncached node positioned near its neighbor after init", async () => {
    mockInvoke((cmd) => {
      switch (cmd) {
        case "get_graph_subgraph":
          return {
            nodes: [
              { id: "a.md", title: "A", is_stub: false },
              { id: "b.md", title: "B", is_stub: false },
            ],
            edges: [["a.md", "b.md"]],
            pagerank: { "a.md": 0.4, "b.md": 0.6 },
            positions_2d: { "a.md": { x: 500, y: 500 } },
          };
        default:
          throw new Error(`Unknown command: ${cmd}`);
      }
    });

    const buildGraphSpy = vi.spyOn(graphLayout, "buildGraph");
    const GraphView = (await import("./GraphView")).default;
    render(<GraphView />);
    await waitFor(() => { expect(mockSigmaOn).toHaveBeenCalled(); });

    const graph = buildGraphSpy.mock.results[0]!.value as import("graphology").default;
    expect(graph.getNodeAttribute("a.md", "x")).toBe(500);
    expect(graph.getNodeAttribute("a.md", "y")).toBe(500);
    const bx = graph.getNodeAttribute("b.md", "x") as number;
    const by = graph.getNodeAttribute("b.md", "y") as number;
    expect(bx).toBeGreaterThanOrEqual(485);
    expect(bx).toBeLessThanOrEqual(515);
    expect(by).toBeGreaterThanOrEqual(485);
    expect(by).toBeLessThanOrEqual(515);

    buildGraphSpy.mockRestore();
  });

  it("lit:layout-ready applies positions with neighbor fallback for uncached nodes", async () => {
    mockListen();
    mockInvoke((cmd) => {
      switch (cmd) {
        case "get_graph_subgraph":
          return {
            nodes: [
              { id: "a.md", title: "A", is_stub: false },
              { id: "b.md", title: "B", is_stub: false },
            ],
            edges: [["a.md", "b.md"]],
            pagerank: { "a.md": 0.4, "b.md": 0.6 },
            positions_2d: {},
          };
        case "get_graph_positions":
          return { "a.md": { x: 300, y: 300 } };
        default:
          throw new Error(`Unknown command: ${cmd}`);
      }
    });

    const buildGraphSpy = vi.spyOn(graphLayout, "buildGraph");
    const GraphView = (await import("./GraphView")).default;
    render(<GraphView />);
    await waitFor(() => { expect(mockSigmaOn).toHaveBeenCalled(); });

    await act(async () => {
      emitMockEvent("lit:layout-ready", {});
    });

    await waitFor(() => {
      expect(mockSigmaRefresh).toHaveBeenCalled();
    });

    const graph = buildGraphSpy.mock.results[0]!.value as import("graphology").default;
    expect(graph.getNodeAttribute("a.md", "x")).toBe(300);
    expect(graph.getNodeAttribute("a.md", "y")).toBe(300);
    const bx = graph.getNodeAttribute("b.md", "x") as number;
    const by = graph.getNodeAttribute("b.md", "y") as number;
    expect(bx).toBeGreaterThanOrEqual(285);
    expect(bx).toBeLessThanOrEqual(315);
    expect(by).toBeGreaterThanOrEqual(285);
    expect(by).toBeLessThanOrEqual(315);

    buildGraphSpy.mockRestore();
    resetListenMock();
  });

  it("concurrent events: second event skipped while first is in-flight", async () => {
    mockListen();
    const resolveIpcHolder: { fn: ((v: unknown) => void) | null } = { fn: null };
    let ipcCallCount = 0;
    mockInvoke((cmd) => {
      switch (cmd) {
        case "get_graph_subgraph":
          ipcCallCount++;
          if (ipcCallCount <= 2) {
            return {
              nodes: [
                { id: "a.md", title: "A", is_stub: false },
                { id: "b.md", title: "B", is_stub: false },
              ],
              edges: [["a.md", "b.md"]],
              pagerank: { "a.md": 0.4, "b.md": 0.6 },
              positions_2d: {},
            };
          }
          return new Promise((resolve) => { resolveIpcHolder.fn = resolve; });
        default:
          throw new Error(`Unknown command: ${cmd}`);
      }
    });

    const GraphView = (await import("./GraphView")).default;
    render(<GraphView />);
    await waitFor(() => { expect(mockSigmaOn).toHaveBeenCalled(); });

    const { invoke } = await import("@tauri-apps/api/core");
    (invoke as unknown as ReturnType<typeof vi.fn>).mockClear();
    ipcCallCount = 2;

    // First event — starts IPC fetch
    await act(async () => {
      emitMockEvent("lit:graph-updated", {});
    });

    // Second event — should be skipped (first still in-flight)
    await act(async () => {
      emitMockEvent("lit:graph-updated", {});
    });

    // Only one IPC call should have been made
    const subgraphCalls = (invoke as unknown as ReturnType<typeof vi.fn>).mock.calls.filter(
      (c: unknown[]) => c[0] === "get_graph_subgraph",
    );
    expect(subgraphCalls.length).toBe(1);

    // Resolve to avoid dangling promise
    resolveIpcHolder.fn?.({
      nodes: [
        { id: "a.md", title: "A", is_stub: false },
        { id: "b.md", title: "B", is_stub: false },
      ],
      edges: [["a.md", "b.md"]],
      pagerank: { "a.md": 0.4, "b.md": 0.6 },
      positions_2d: {},
    });

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

    const exportBtn = container.querySelector("[data-graph-context-menu] button")!;
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

    fireEvent.click(container.querySelector("[data-graph-context-menu] button")!);
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

  it("context menu hidden when onExportNetwork is not provided", async () => {
    const GraphView = (await import("./GraphView")).default;
    const { container } = render(<GraphView />);
    await waitFor(() => { expect(mockSigmaOn).toHaveBeenCalled(); });

    const rightClickHandler = mockSigmaOn.mock.calls.find(
      (call) => call[0] === "rightClickNode",
    )?.[1];
    act(() => {
      rightClickHandler!({ node: "a.md", event: { original: { preventDefault: vi.fn() }, x: 100, y: 200 } });
    });

    expect(container.querySelector("[data-graph-context-menu]")).toBeNull();
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

  // --- Dimension toggle (2D/3D) ---

  it("defaults to 2D — Sigma canvas visible, no graph-view-3d in DOM", async () => {
    const GraphView = (await import("./GraphView")).default;
    render(<GraphView />);
    await waitFor(() => { expect(mockSigmaOn).toHaveBeenCalled(); });

    const canvas = screen.getByTestId("graph-canvas");
    expect(canvas.style.display).not.toBe("none");
    expect(screen.queryByTestId("graph-view-3d")).toBeNull();
  });

  it("toolbar renders 2D/3D toggle buttons", async () => {
    const GraphView = (await import("./GraphView")).default;
    render(<GraphView />);
    expect(screen.getByRole("button", { name: "2D" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "3D" })).toBeTruthy();
  });

  it("switching to 3D hides Sigma, shows GraphView3D", async () => {
    const GraphView = (await import("./GraphView")).default;
    render(<GraphView />);
    await waitFor(() => { expect(mockSigmaOn).toHaveBeenCalled(); });

    await userEvent.click(screen.getByRole("button", { name: "3D" }));

    const canvas = screen.getByTestId("graph-canvas");
    expect(canvas.style.display).toBe("none");
    await waitFor(() => { expect(screen.getByTestId("graph-view-3d")).toBeTruthy(); });
  });

  it("switching back to 2D shows Sigma, unmounts GraphView3D", async () => {
    const GraphView = (await import("./GraphView")).default;
    render(<GraphView />);
    await waitFor(() => { expect(mockSigmaOn).toHaveBeenCalled(); });

    await userEvent.click(screen.getByRole("button", { name: "3D" }));
    await waitFor(() => { expect(screen.getByTestId("graph-view-3d")).toBeTruthy(); });

    await userEvent.click(screen.getByRole("button", { name: "2D" }));
    const canvas = screen.getByTestId("graph-canvas");
    expect(canvas.style.display).not.toBe("none");
    expect(screen.queryByTestId("graph-view-3d")).toBeNull();
  });

  it("kills Sigma when switching from 2D to 3D", async () => {
    const GraphView = (await import("./GraphView")).default;
    render(<GraphView />);
    await waitFor(() => { expect(mockSigmaOn).toHaveBeenCalled(); });
    mockSigmaKill.mockClear();
    await userEvent.click(screen.getByRole("button", { name: "3D" }));
    expect(mockSigmaKill).toHaveBeenCalledTimes(1);
  });

  it("reinits Sigma after round-trip 3D → 2D (Sigma killed on 3D switch)", async () => {
    const GraphView = (await import("./GraphView")).default;
    render(<GraphView />);
    await waitFor(() => { expect(mockSigmaOn).toHaveBeenCalled(); });
    await userEvent.click(screen.getByRole("button", { name: "3D" }));
    expect(mockSigmaKill).toHaveBeenCalled();
    mockSigmaOn.mockClear();
    await userEvent.click(screen.getByRole("button", { name: "2D" }));
    await waitFor(() => { expect(mockSigmaOn).toHaveBeenCalled(); });
  });

  it("does not double-kill Sigma on 3D switch then unmount", async () => {
    const GraphView = (await import("./GraphView")).default;
    const { unmount } = render(<GraphView />);
    await waitFor(() => { expect(mockSigmaOn).toHaveBeenCalled(); });
    mockSigmaKill.mockClear();
    await userEvent.click(screen.getByRole("button", { name: "3D" }));
    expect(mockSigmaKill).toHaveBeenCalledTimes(1);
    mockSigmaKill.mockClear();
    unmount();
    expect(mockSigmaKill).not.toHaveBeenCalled();
  });

  it("reset zoom in 2D mode calls sigma camera reset", async () => {
    const GraphView = (await import("./GraphView")).default;
    render(<GraphView />);
    await waitFor(() => { expect(mockSigmaOn).toHaveBeenCalled(); });

    mockCameraAnimatedReset.mockClear();
    await userEvent.click(screen.getByRole("button", { name: "Reset zoom" }));
    expect(mockCameraAnimatedReset).toHaveBeenCalled();
  });

  it("reset zoom in 3D mode does not call sigma reset", async () => {
    const GraphView = (await import("./GraphView")).default;
    render(<GraphView />);
    await waitFor(() => { expect(mockSigmaOn).toHaveBeenCalled(); });

    await userEvent.click(screen.getByRole("button", { name: "3D" }));
    mockCameraAnimatedReset.mockClear();
    await userEvent.click(screen.getByRole("button", { name: "Reset zoom" }));
    expect(mockCameraAnimatedReset).not.toHaveBeenCalled();
  });

  it("switching to 3D passes real data to GraphView3D", async () => {
    const GraphView = (await import("./GraphView")).default;
    render(<GraphView />);
    await waitFor(() => { expect(mockSigmaOn).toHaveBeenCalled(); });

    await userEvent.click(screen.getByRole("button", { name: "3D" }));
    await waitFor(() => { expect(screen.getByTestId("graph-view-3d")).toBeTruthy(); });
  });

  // --- Bug 1: Sigma crash on hidden container in 3D mode ---

  it("does not create Sigma when dimension is 3d (no crash on hidden container)", async () => {
    const GraphView = (await import("./GraphView")).default;
    const { rerender } = render(<GraphView visible={true} activePageId="a.md" initialMode="local" />);
    await waitFor(() => { expect(mockSigmaOn).toHaveBeenCalled(); });

    // Switch to 3D
    await userEvent.click(screen.getByRole("button", { name: "3D" }));
    await waitFor(() => { expect(screen.getByTestId("graph-view-3d")).toBeTruthy(); });

    // Simulate navigate-away-and-back: hide, change activePageId, show
    mockSigmaKill.mockClear();
    mockSigmaOn.mockClear();
    await act(async () => {
      rerender(<GraphView visible={false} activePageId="b.md" initialMode="local" />);
    });
    await act(async () => {
      rerender(<GraphView visible={true} activePageId="b.md" initialMode="local" />);
    });

    // Wait for reinit to complete
    await waitFor(() => {
      expect(screen.queryByTestId("graph-loading")).not.toBeInTheDocument();
    });

    // Sigma should NOT have been created (we're in 3D mode)
    expect(mockSigmaOn).not.toHaveBeenCalled();

    // aria-label should show node/edge counts
    const container = screen.getByTestId("graph-view");
    expect(container.getAttribute("aria-label")).toContain("2 nodes");
    expect(container.getAttribute("aria-label")).toContain("1 edge");
  });

  it("switching from 3D to 2D triggers reinit when Sigma was skipped", async () => {
    const GraphView = (await import("./GraphView")).default;
    const { rerender } = render(<GraphView visible={true} activePageId="a.md" initialMode="local" />);
    await waitFor(() => { expect(mockSigmaOn).toHaveBeenCalled(); });

    // Switch to 3D
    await userEvent.click(screen.getByRole("button", { name: "3D" }));
    await waitFor(() => { expect(screen.getByTestId("graph-view-3d")).toBeTruthy(); });

    // Simulate navigate-away-and-back in 3D mode (sigma gets skipped on reinit)
    mockSigmaKill.mockClear();
    mockSigmaOn.mockClear();
    await act(async () => {
      rerender(<GraphView visible={false} activePageId="b.md" initialMode="local" />);
    });
    await act(async () => {
      rerender(<GraphView visible={true} activePageId="b.md" initialMode="local" />);
    });
    await waitFor(() => {
      expect(screen.queryByTestId("graph-loading")).not.toBeInTheDocument();
    });
    expect(mockSigmaOn).not.toHaveBeenCalled();

    // Switch back to 2D — should create Sigma
    mockSigmaOn.mockClear();
    await userEvent.click(screen.getByRole("button", { name: "2D" }));
    await waitFor(() => { expect(mockSigmaOn).toHaveBeenCalled(); });
  });

  it("init() creates Sigma normally when dimension is 2d", async () => {
    const GraphView = (await import("./GraphView")).default;
    render(<GraphView />);
    await waitFor(() => { expect(mockSigmaOn).toHaveBeenCalled(); });

    // Sigma should be created in the default 2D mode
    expect(mockSigmaOn).toHaveBeenCalledWith("clickNode", expect.any(Function));
  });

  // --- Bug 2: Empty 3D positions ---

  it("switching to 3D calls computeLayout3d when positions_3d is empty", async () => {
    const GraphView = (await import("./GraphView")).default;
    render(<GraphView />);
    await waitFor(() => { expect(mockSigmaOn).toHaveBeenCalled(); });

    const { invoke } = await import("@tauri-apps/api/core");
    (invoke as unknown as ReturnType<typeof vi.fn>).mockClear();

    await userEvent.click(screen.getByRole("button", { name: "3D" }));
    await waitFor(() => { expect(screen.getByTestId("graph-view-3d")).toBeTruthy(); });

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("compute_layout_3d", { settings: null });
    });
  });

  it("switching to 3D skips computeLayout3d when positions_3d is populated", async () => {
    mockInvoke((cmd) => {
      switch (cmd) {
        case "get_graph_subgraph":
          return {
            nodes: [
              { id: "a.md", title: "A", is_stub: false },
              { id: "b.md", title: "B", is_stub: false },
            ],
            edges: [["a.md", "b.md"]],
            pagerank: { "a.md": 0.4, "b.md": 0.6 },
            positions_2d: {},
            positions_3d: { "a.md": { x: 1, y: 2, z: 3 }, "b.md": { x: 4, y: 5, z: 6 } },
          };
        case "get_graph_positions":
          return {};
        case "compute_layout_3d":
          return undefined;
        default:
          throw new Error(`Unknown command: ${cmd}`);
      }
    });

    const GraphView = (await import("./GraphView")).default;
    render(<GraphView />);
    await waitFor(() => { expect(mockSigmaOn).toHaveBeenCalled(); });

    const { invoke } = await import("@tauri-apps/api/core");
    (invoke as unknown as ReturnType<typeof vi.fn>).mockClear();

    await userEvent.click(screen.getByRole("button", { name: "3D" }));
    await waitFor(() => { expect(screen.getByTestId("graph-view-3d")).toBeTruthy(); });

    // Give a tick for effects to fire
    await act(async () => {});

    expect(invoke).not.toHaveBeenCalledWith("compute_layout_3d", expect.anything());
  });

  it("lit:layout-3d-ready fetches 3D positions and updates GraphView3D", async () => {
    mockListen();
    mockInvoke((cmd, args) => {
      switch (cmd) {
        case "get_graph_subgraph":
          return {
            nodes: [
              { id: "a.md", title: "A", is_stub: false },
              { id: "b.md", title: "B", is_stub: false },
            ],
            edges: [["a.md", "b.md"]],
            pagerank: { "a.md": 0.4, "b.md": 0.6 },
            positions_2d: {},
            positions_3d: {},
          };
        case "get_graph_positions": {
          const a = args as Record<string, unknown> | undefined;
          if (a?.layoutType === "3d") {
            return { "a.md": { x: 10, y: 20, z: 30 }, "b.md": { x: 40, y: 50, z: 60 } };
          }
          return {};
        }
        case "compute_layout_3d":
          return undefined;
        default:
          throw new Error(`Unknown command: ${cmd}`);
      }
    });

    const GraphView = (await import("./GraphView")).default;
    render(<GraphView />);
    await waitFor(() => { expect(mockSigmaOn).toHaveBeenCalled(); });

    await userEvent.click(screen.getByRole("button", { name: "3D" }));
    await waitFor(() => { expect(screen.getByTestId("graph-view-3d")).toBeTruthy(); });

    const { invoke } = await import("@tauri-apps/api/core");
    (invoke as unknown as ReturnType<typeof vi.fn>).mockClear();

    await act(async () => {
      emitMockEvent("lit:layout-3d-ready", {});
    });

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("get_graph_positions", { layoutType: "3d" });
    });

    // 3D view should still be rendered
    expect(screen.getByTestId("graph-view-3d")).toBeTruthy();

    resetListenMock();
  });

  it("3D view receives pre-populated positions_3d from subgraph on init", async () => {
    mockInvoke((cmd) => {
      switch (cmd) {
        case "get_graph_subgraph":
          return {
            nodes: [
              { id: "a.md", title: "A", is_stub: false },
              { id: "b.md", title: "B", is_stub: false },
            ],
            edges: [["a.md", "b.md"]],
            pagerank: { "a.md": 0.4, "b.md": 0.6 },
            positions_2d: {},
            positions_3d: { "a.md": { x: 1, y: 2, z: 3 }, "b.md": { x: 4, y: 5, z: 6 } },
          };
        case "get_graph_positions":
          return {};
        case "compute_layout_3d":
          return undefined;
        default:
          throw new Error(`Unknown command: ${cmd}`);
      }
    });

    const GraphView = (await import("./GraphView")).default;
    render(<GraphView />);
    await waitFor(() => { expect(mockSigmaOn).toHaveBeenCalled(); });

    await userEvent.click(screen.getByRole("button", { name: "3D" }));
    await waitFor(() => { expect(screen.getByTestId("graph-view-3d")).toBeTruthy(); });

    const { invoke } = await import("@tauri-apps/api/core");
    // compute_layout_3d should not have been called since positions exist
    const computeCalls = (invoke as unknown as ReturnType<typeof vi.fn>).mock.calls.filter(
      (c: unknown[]) => c[0] === "compute_layout_3d",
    );
    expect(computeCalls.length).toBe(0);
  });
});
