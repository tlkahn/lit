import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { mockInvoke } from "../test/tauri-mock";
import * as graphLayout from "../lib/graphLayout";

const mockSigmaKill = vi.fn();
const mockLayoutStart = vi.fn();
const mockLayoutStop = vi.fn();
const mockLayoutKill = vi.fn();
const mockSigmaOn = vi.fn();
const mockSigmaSetSetting = vi.fn();
const mockCameraAnimatedReset = vi.fn();

vi.mock("sigma", () => ({
  default: class MockSigma {
    kill = mockSigmaKill;
    on = mockSigmaOn;
    setSetting = mockSigmaSetSetting;
    getCamera = () => ({ animatedReset: mockCameraAnimatedReset });
    constructor() {}
  },
}));

vi.mock("@sigma/node-border", () => ({
  createNodeBorderProgram: () => class MockProgram {},
}));

vi.mock("graphology-layout-forceatlas2/worker", () => ({
  default: class MockFA2 {
    start = mockLayoutStart;
    stop = mockLayoutStop;
    kill = mockLayoutKill;
  },
}));

vi.mock("graphology-layout-forceatlas2", () => ({
  default: { assign: vi.fn() },
  inferSettings: () => ({}),
}));

vi.mock("graphology-layout", () => ({
  random: { assign: vi.fn() },
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
    rafQueue = new Map();
    nextRafId = 1;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb: FrameRequestCallback) => {
      const id = nextRafId++;
      rafQueue.set(id, cb);
      return id;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id: number) => { rafQueue.delete(id); });
    mockInvoke((cmd) => {
      switch (cmd) {
        case "get_graph_subgraph":
          return {
            nodes: [
              { id: "a.md", title: "A", is_stub: false },
              { id: "b.md", title: "B", is_stub: false },
            ],
            edges: [["a.md", "b.md"]],
          };
        case "get_pagerank":
          return { "a.md": 0.4, "b.md": 0.6 };
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

  it("full mode (default) calls getFullSubgraph and getPagerank", async () => {
    const GraphView = (await import("./GraphView")).default;
    render(<GraphView />);
    const { invoke } = await import("@tauri-apps/api/core");
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("get_graph_subgraph", { seeds: [], depth: 0, directed: null });
      expect(invoke).toHaveBeenCalledWith("get_pagerank", { n: null });
    });
  });

  it("shows loading state while fetching", async () => {
    const GraphView = (await import("./GraphView")).default;
    render(<GraphView />);
    expect(screen.getByTestId("graph-loading")).toBeTruthy();
  });

  it("calls sigma.kill and layout.kill on unmount", async () => {
    const GraphView = (await import("./GraphView")).default;
    const { unmount } = render(<GraphView />);
    await waitFor(() => {
      expect(mockSigmaKill).not.toHaveBeenCalled();
    });
    unmount();
    expect(mockSigmaKill).toHaveBeenCalled();
    expect(mockLayoutKill).toHaveBeenCalled();
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

  it("stops ForceAtlas2 layout after timeout", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const GraphView = (await import("./GraphView")).default;
    render(<GraphView />);

    await waitFor(() => {
      expect(mockLayoutStart).toHaveBeenCalled();
    });

    expect(mockLayoutStop).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(5000); });
    expect(mockLayoutStop).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("does not call layout.stop() after unmount", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const GraphView = (await import("./GraphView")).default;
    const { unmount } = render(<GraphView />);

    await waitFor(() => {
      expect(mockLayoutStart).toHaveBeenCalled();
    });

    unmount();
    act(() => { vi.advanceTimersByTime(5000); });
    expect(mockLayoutStop).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  // --- Phase 2 tests ---

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

  it("camera resets after layout stops", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const GraphView = (await import("./GraphView")).default;
    render(<GraphView />);

    await waitFor(() => { expect(mockLayoutStart).toHaveBeenCalled(); });

    act(() => { vi.advanceTimersByTime(5000); });
    expect(mockLayoutStop).toHaveBeenCalledTimes(1);
    expect(mockCameraAnimatedReset).toHaveBeenCalled();
    vi.useRealTimers();
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

  it("FA2 layout stops when convergence detected (before 5s timeout)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const GraphView = (await import("./GraphView")).default;
    render(<GraphView />);

    await waitFor(() => {
      expect(mockLayoutStart).toHaveBeenCalled();
    });

    // Mock FA2 doesn't move nodes, so positions are stable frame-to-frame.
    // With default requiredSamples=5 and 200ms polling, convergence at ~1000ms.
    expect(mockLayoutStop).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(1200); });
    expect(mockLayoutStop).toHaveBeenCalledTimes(1);

    // The 5s timeout should NOT fire again (already stopped)
    mockLayoutStop.mockClear();
    act(() => { vi.advanceTimersByTime(4000); });
    expect(mockLayoutStop).not.toHaveBeenCalled();

    vi.useRealTimers();
  });

  it("convergence polling interval is cleaned up on unmount", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const GraphView = (await import("./GraphView")).default;
    const { unmount } = render(<GraphView />);

    await waitFor(() => {
      expect(mockLayoutStart).toHaveBeenCalled();
    });

    unmount();
    // Advance past convergence time — no errors or calls after unmount
    act(() => { vi.advanceTimersByTime(2000); });
    expect(mockLayoutStop).not.toHaveBeenCalled();

    vi.useRealTimers();
  });

  it("5s timeout still fires if convergence never reached", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });

    // Override checkConvergence to never converge
    const convergenceMod = await import("../lib/graphConvergence");
    const spy = vi.spyOn(convergenceMod, "checkConvergence").mockReturnValue({
      converged: false,
      displacement: 10,
      state: { consecutiveLow: 0 },
    });

    const GraphView = (await import("./GraphView")).default;
    render(<GraphView />);

    await waitFor(() => {
      expect(mockLayoutStart).toHaveBeenCalled();
    });

    expect(mockLayoutStop).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(5000); });
    expect(mockLayoutStop).toHaveBeenCalledTimes(1);

    spy.mockRestore();
    vi.useRealTimers();
  });

  it("when reduced motion is preferred, FA2 worker is NOT started; synchronous layout used", async () => {
    const graphLayoutMod = await import("../lib/graphLayout");
    const spy = vi.spyOn(graphLayoutMod, "prefersReducedMotion").mockReturnValue(true);

    const GraphView = (await import("./GraphView")).default;
    render(<GraphView />);

    await waitFor(() => {
      expect(screen.queryByTestId("graph-loading")).not.toBeInTheDocument();
    });

    expect(mockLayoutStart).not.toHaveBeenCalled();

    spy.mockRestore();
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
});
