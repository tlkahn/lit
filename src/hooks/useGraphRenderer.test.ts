import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import Graph from "graphology";
import { getTierSettings } from "../lib/qualityTiers";
import { useGraphSelectionStore } from "../stores/graphSelection";
import type { RefObject, MutableRefObject } from "react";
import type { UseGraphRendererOptions } from "./useGraphRenderer";

const mockSigmaKill = vi.fn();
const mockSigmaOn = vi.fn();
const mockSigmaSetSetting = vi.fn();
const mockCameraAnimatedReset = vi.fn();
const mockSigmaRefresh = vi.fn();
let sigmaConstructorCount = 0;
let lastSigmaOptions: Record<string, unknown> = {};

vi.mock("sigma", () => ({
  default: class MockSigma {
    kill = mockSigmaKill;
    on = mockSigmaOn;
    setSetting = mockSigmaSetSetting;
    getCamera = () => ({ animatedReset: mockCameraAnimatedReset });
    refresh = mockSigmaRefresh;
    constructor(_graph: unknown, _container: unknown, options?: Record<string, unknown>) {
      sigmaConstructorCount++;
      lastSigmaOptions = options ?? {};
    }
  },
}));

vi.mock("@sigma/node-border", () => ({
  createNodeBorderProgram: () => class MockProgram {},
}));

const mockCreateNudgeController = vi.fn();
vi.mock("../lib/graphNudge", () => ({
  createNudgeController: (...args: unknown[]) => mockCreateNudgeController(...args),
}));

function makeGraph(): Graph {
  const g = new Graph();
  g.addNode("a.md", { label: "A", color: "#000", size: 5, x: 0, y: 0 });
  g.addNode("b.md", { label: "B", color: "#111", size: 3, x: 10, y: 10 });
  g.addEdge("a.md", "b.md");
  return g;
}

function makeOptions(overrides: Partial<UseGraphRendererOptions> = {}): UseGraphRendererOptions {
  const graph = overrides.graphRef?.current ? null : makeGraph();
  const container = document.createElement("div");

  return {
    containerRef: { current: container } as RefObject<HTMLDivElement | null>,
    graphRef: { current: graph ?? overrides.graphRef!.current } as RefObject<Graph | null>,
    tierSettings: getTierSettings("small"),
    dimColorRef: { current: "#d1d9e0" } as MutableRefObject<string>,
    dataVersion: 1,
    ...overrides,
  };
}

describe("useGraphRenderer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sigmaConstructorCount = 0;
    lastSigmaOptions = {};
    useGraphSelectionStore.setState({ selectedNodes: [], selectionMode: "none" });
    mockCreateNudgeController.mockReturnValue({
      enter: vi.fn(),
      leave: vi.fn(),
      dispose: vi.fn(),
    });
  });

  async function importHook() {
    const mod = await import("./useGraphRenderer");
    return mod.useGraphRenderer;
  }

  // --- Cycle 1: Return type shape ---

  it("returns correct shape before async init completes", async () => {
    const useGraphRenderer = await importHook();
    const opts = makeOptions();

    const { result } = renderHook(() => useGraphRenderer(opts));

    expect(result.current.sigmaRef.current).toBeNull();
    expect(result.current.hoveredNodeRef.current).toBeNull();
    expect(result.current.selectedSetRef.current).toBeInstanceOf(Set);
    expect(result.current.selectedSetRef.current.size).toBe(0);
    expect(typeof result.current.defaultNodeReducer).toBe("function");
    expect(result.current.tierSettingsRef.current).toEqual(opts.tierSettings);
    expect(typeof result.current.resetZoom).toBe("function");
    expect(typeof result.current.refresh).toBe("function");
  });

  it("defaultNodeReducer delegates to graphReducers.defaultNodeReduce", async () => {
    const useGraphRenderer = await importHook();
    const opts = makeOptions();
    const { result } = renderHook(() => useGraphRenderer(opts));

    const attrs = { color: "#000", label: "Test" };
    const out = result.current.defaultNodeReducer("a.md", attrs);
    expect(out.forceLabel).toBe(false);
    expect(out.color).toBe("#000");
  });

  // --- Cycle 2: Creates Sigma on mount ---

  it("creates Sigma instance on mount", async () => {
    const useGraphRenderer = await importHook();
    const opts = makeOptions();

    renderHook(() => useGraphRenderer(opts));

    await waitFor(() => {
      expect(sigmaConstructorCount).toBe(1);
    });
  });

  it("passes tier settings to Sigma constructor", async () => {
    const useGraphRenderer = await importHook();
    const opts = makeOptions();

    renderHook(() => useGraphRenderer(opts));

    await waitFor(() => {
      expect(sigmaConstructorCount).toBe(1);
    });
    expect(lastSigmaOptions.enableEdgeEvents).toBe(true);
    expect(lastSigmaOptions.hideEdgesOnMove).toBe(false);
    expect(lastSigmaOptions.hideLabelsOnMove).toBe(false);
    expect(lastSigmaOptions.labelRenderedSizeThreshold).toBe(Infinity);
  });

  it("stores sigma in sigmaRef after init", async () => {
    const useGraphRenderer = await importHook();
    const opts = makeOptions();
    const { result } = renderHook(() => useGraphRenderer(opts));

    await waitFor(() => {
      expect(result.current.sigmaRef.current).not.toBeNull();
    });
  });

  // --- Cycle 3: Huge tier options forwarded ---

  it("huge tier: Sigma gets hideEdgesOnMove=true, enableEdgeEvents=false", async () => {
    const useGraphRenderer = await importHook();
    const opts = makeOptions({ tierSettings: getTierSettings("huge") });

    renderHook(() => useGraphRenderer(opts));

    await waitFor(() => {
      expect(sigmaConstructorCount).toBe(1);
    });
    expect(lastSigmaOptions.hideEdgesOnMove).toBe(true);
    expect(lastSigmaOptions.hideLabelsOnMove).toBe(true);
    expect(lastSigmaOptions.enableEdgeEvents).toBe(false);
  });

  // --- Cycle 4: Sets default reducers on init ---

  it("sets default nodeReducer on init", async () => {
    const useGraphRenderer = await importHook();
    const opts = makeOptions();

    renderHook(() => useGraphRenderer(opts));

    await waitFor(() => {
      expect(mockSigmaSetSetting).toHaveBeenCalledWith("nodeReducer", expect.any(Function));
    });

    const nodeReducerCall = mockSigmaSetSetting.mock.calls.find(
      (call) => call[0] === "nodeReducer",
    );
    const reducer = nodeReducerCall![1] as (n: string, attrs: Record<string, unknown>) => Record<string, unknown>;
    const out = reducer("a.md", { color: "#000" });
    expect(out.forceLabel).toBe(false);
  });

  it("huge tier: sets edge-hiding edgeReducer on init", async () => {
    const useGraphRenderer = await importHook();
    const opts = makeOptions({ tierSettings: getTierSettings("huge") });

    renderHook(() => useGraphRenderer(opts));

    await waitFor(() => {
      expect(sigmaConstructorCount).toBe(1);
    });

    const edgeReducerCalls = mockSigmaSetSetting.mock.calls.filter(
      (call) => call[0] === "edgeReducer" && typeof call[1] === "function",
    );
    expect(edgeReducerCalls.length).toBeGreaterThanOrEqual(1);
    const reducer = edgeReducerCalls[0]![1] as (e: string, attrs: Record<string, unknown>) => Record<string, unknown>;
    expect(reducer("e1", { color: "#000" })).toEqual({ color: "#000", hidden: true });
  });

  // --- Cycle 5: Nudge controller ---

  it("small tier: creates nudge controller", async () => {
    const useGraphRenderer = await importHook();
    const opts = makeOptions({ tierSettings: getTierSettings("small") });

    renderHook(() => useGraphRenderer(opts));

    await waitFor(() => {
      expect(mockCreateNudgeController).toHaveBeenCalled();
    });
  });

  it("medium tier: creates nudge controller", async () => {
    const useGraphRenderer = await importHook();
    const opts = makeOptions({ tierSettings: getTierSettings("medium") });

    renderHook(() => useGraphRenderer(opts));

    await waitFor(() => {
      expect(mockCreateNudgeController).toHaveBeenCalled();
    });
  });

  it("large tier: does NOT create nudge controller", async () => {
    const useGraphRenderer = await importHook();
    const opts = makeOptions({ tierSettings: getTierSettings("large") });

    renderHook(() => useGraphRenderer(opts));

    await waitFor(() => {
      expect(sigmaConstructorCount).toBe(1);
    });
    expect(mockCreateNudgeController).not.toHaveBeenCalled();
  });

  // --- Cycle 6: Registers all 5 Sigma event handlers ---

  it("registers clickNode, rightClickNode, enterNode, leaveNode, clickStage", async () => {
    const useGraphRenderer = await importHook();
    const opts = makeOptions();

    renderHook(() => useGraphRenderer(opts));

    await waitFor(() => {
      expect(mockSigmaOn).toHaveBeenCalled();
    });

    const events = mockSigmaOn.mock.calls.map((call) => call[0]);
    expect(events).toContain("clickNode");
    expect(events).toContain("rightClickNode");
    expect(events).toContain("enterNode");
    expect(events).toContain("leaveNode");
    expect(events).toContain("clickStage");
  });

  // --- Cycle 7: clickNode — plain click toggles selection ---

  it("plain click toggles selection, does NOT navigate", async () => {
    const onNavigate = vi.fn();
    const useGraphRenderer = await importHook();
    const opts = makeOptions({ onNavigate });

    renderHook(() => useGraphRenderer(opts));

    await waitFor(() => { expect(mockSigmaOn).toHaveBeenCalled(); });

    const handler = mockSigmaOn.mock.calls.find((c) => c[0] === "clickNode")![1];
    act(() => {
      handler({ node: "a.md", event: { original: {} } });
    });

    expect(useGraphSelectionStore.getState().selectedNodes).toContain("a.md");
    expect(onNavigate).not.toHaveBeenCalled();
  });

  // --- Cycle 8: clickNode — Cmd+click navigates ---

  it("Cmd+click clears selection and navigates", async () => {
    useGraphSelectionStore.getState().toggleNode("b.md");
    const onNavigate = vi.fn();
    const useGraphRenderer = await importHook();
    const opts = makeOptions({ onNavigate });

    renderHook(() => useGraphRenderer(opts));

    await waitFor(() => { expect(mockSigmaOn).toHaveBeenCalled(); });

    const handler = mockSigmaOn.mock.calls.find((c) => c[0] === "clickNode")![1];
    act(() => {
      handler({ node: "a.md", event: { original: { metaKey: true } } });
    });

    expect(useGraphSelectionStore.getState().selectedNodes).toEqual([]);
    expect(onNavigate).toHaveBeenCalledWith("a.md");
  });

  it("Ctrl+click clears selection and navigates", async () => {
    const onNavigate = vi.fn();
    const useGraphRenderer = await importHook();
    const opts = makeOptions({ onNavigate });

    renderHook(() => useGraphRenderer(opts));

    await waitFor(() => { expect(mockSigmaOn).toHaveBeenCalled(); });

    const handler = mockSigmaOn.mock.calls.find((c) => c[0] === "clickNode")![1];
    act(() => {
      handler({ node: "a.md", event: { original: { ctrlKey: true } } });
    });

    expect(onNavigate).toHaveBeenCalledWith("a.md");
  });

  // --- Cycle 9: enterNode + leaveNode — hover lifecycle ---

  it("enterNode sets hoveredNodeRef, cursor to pointer, and hover nodeReducer", async () => {
    const useGraphRenderer = await importHook();
    const opts = makeOptions();
    const { result } = renderHook(() => useGraphRenderer(opts));

    await waitFor(() => { expect(mockSigmaOn).toHaveBeenCalled(); });

    const handler = mockSigmaOn.mock.calls.find((c) => c[0] === "enterNode")![1];
    mockSigmaSetSetting.mockClear();
    act(() => {
      handler({ node: "a.md" });
    });

    expect(result.current.hoveredNodeRef.current).toBe("a.md");
    expect(opts.containerRef.current!.style.cursor).toBe("pointer");

    const nodeReducerCall = mockSigmaSetSetting.mock.calls.find(
      (c) => c[0] === "nodeReducer",
    );
    expect(nodeReducerCall).toBeDefined();
    const reducer = nodeReducerCall![1] as (n: string, attrs: Record<string, unknown>) => Record<string, unknown>;
    expect(reducer("a.md", { color: "#000" }).forceLabel).toBe(true);
    expect(reducer("b.md", { color: "#000" }).forceLabel).toBe(false);
  });

  it("leaveNode clears hoveredNodeRef, resets cursor, restores default reducers", async () => {
    const useGraphRenderer = await importHook();
    const opts = makeOptions();
    const { result } = renderHook(() => useGraphRenderer(opts));

    await waitFor(() => { expect(mockSigmaOn).toHaveBeenCalled(); });

    const enterHandler = mockSigmaOn.mock.calls.find((c) => c[0] === "enterNode")![1];
    act(() => { enterHandler({ node: "a.md" }); });

    mockSigmaSetSetting.mockClear();
    const leaveHandler = mockSigmaOn.mock.calls.find((c) => c[0] === "leaveNode")![1];
    act(() => { leaveHandler(); });

    expect(result.current.hoveredNodeRef.current).toBeNull();
    expect(opts.containerRef.current!.style.cursor).toBe("grab");

    const nodeReducerCall = mockSigmaSetSetting.mock.calls.find(
      (c) => c[0] === "nodeReducer",
    );
    expect(nodeReducerCall).toBeDefined();
    expect(mockSigmaSetSetting).toHaveBeenCalledWith("edgeReducer", null);
  });

  // --- Cycle 10: leaveNode restores edge reducer for huge graphs ---

  it("huge tier: leaveNode restores edge-hiding reducer", async () => {
    const useGraphRenderer = await importHook();
    const opts = makeOptions({ tierSettings: getTierSettings("huge") });

    renderHook(() => useGraphRenderer(opts));

    await waitFor(() => { expect(mockSigmaOn).toHaveBeenCalled(); });

    const enterHandler = mockSigmaOn.mock.calls.find((c) => c[0] === "enterNode")![1];
    act(() => { enterHandler({ node: "a.md" }); });

    mockSigmaSetSetting.mockClear();
    const leaveHandler = mockSigmaOn.mock.calls.find((c) => c[0] === "leaveNode")![1];
    act(() => { leaveHandler(); });

    const edgeReducerCall = mockSigmaSetSetting.mock.calls.find(
      (c) => c[0] === "edgeReducer",
    );
    expect(edgeReducerCall).toBeDefined();
    expect(typeof edgeReducerCall![1]).toBe("function");
    const reducer = edgeReducerCall![1] as (e: string, attrs: Record<string, unknown>) => Record<string, unknown>;
    expect(reducer("e1", { color: "#000" })).toEqual({ color: "#000", hidden: true });
  });

  // --- Cycle 11: rightClickNode calls onContextMenu ---

  it("rightClickNode calls onContextMenu with nodeId, x, y", async () => {
    const onContextMenu = vi.fn();
    const useGraphRenderer = await importHook();
    const opts = makeOptions({ onContextMenu });

    renderHook(() => useGraphRenderer(opts));

    await waitFor(() => { expect(mockSigmaOn).toHaveBeenCalled(); });

    const handler = mockSigmaOn.mock.calls.find((c) => c[0] === "rightClickNode")![1];
    const preventDefault = vi.fn();
    act(() => {
      handler({ node: "a.md", event: { original: { preventDefault, clientX: 100, clientY: 200 } } });
    });

    expect(preventDefault).toHaveBeenCalled();
    expect(onContextMenu).toHaveBeenCalledWith({ nodeId: "a.md", x: 100, y: 200 });
  });

  // --- Cycle 12: clickStage clears selection + restores reducers ---

  it("clickStage clears selection and restores default reducers", async () => {
    useGraphSelectionStore.getState().toggleNode("a.md");
    const useGraphRenderer = await importHook();
    const opts = makeOptions();

    renderHook(() => useGraphRenderer(opts));

    await waitFor(() => { expect(mockSigmaOn).toHaveBeenCalled(); });

    mockSigmaSetSetting.mockClear();
    const handler = mockSigmaOn.mock.calls.find((c) => c[0] === "clickStage")![1];
    act(() => { handler(); });

    expect(useGraphSelectionStore.getState().selectedNodes).toEqual([]);

    const nodeReducerCall = mockSigmaSetSetting.mock.calls.find(
      (c) => c[0] === "nodeReducer",
    );
    expect(nodeReducerCall).toBeDefined();
  });

  // --- Cycle 13: Selection store subscription ---

  it("external selection change triggers sigma.refresh and updates selectedSetRef", async () => {
    const useGraphRenderer = await importHook();
    const opts = makeOptions();
    const { result } = renderHook(() => useGraphRenderer(opts));

    await waitFor(() => { expect(sigmaConstructorCount).toBe(1); });
    mockSigmaRefresh.mockClear();

    act(() => {
      useGraphSelectionStore.getState().toggleNode("a.md");
    });

    expect(mockSigmaRefresh).toHaveBeenCalled();
    expect(result.current.selectedSetRef.current.has("a.md")).toBe(true);
  });

  it("selectionMode-only change does NOT trigger sigma.refresh", async () => {
    const useGraphRenderer = await importHook();
    const opts = makeOptions();

    renderHook(() => useGraphRenderer(opts));

    await waitFor(() => { expect(sigmaConstructorCount).toBe(1); });
    mockSigmaRefresh.mockClear();

    act(() => {
      useGraphSelectionStore.getState().setSelectionMode("lasso");
    });

    expect(mockSigmaRefresh).not.toHaveBeenCalled();
  });

  // --- Cycle 14: dataVersion change triggers refresh + camera reset ---

  it("dataVersion change triggers sigma.refresh and camera.animatedReset", async () => {
    const useGraphRenderer = await importHook();
    const opts = makeOptions({ dataVersion: 1 });

    const { rerender } = renderHook(
      (props: UseGraphRendererOptions) => useGraphRenderer(props),
      { initialProps: opts },
    );

    await waitFor(() => { expect(sigmaConstructorCount).toBe(1); });
    mockSigmaRefresh.mockClear();
    mockCameraAnimatedReset.mockClear();

    rerender({ ...opts, dataVersion: 2 });

    await waitFor(() => {
      expect(mockSigmaRefresh).toHaveBeenCalled();
    });
    expect(mockCameraAnimatedReset).toHaveBeenCalled();
  });

  // --- Cycle 15: Tier change kills + recreates Sigma ---

  it("tier change kills old Sigma and creates new one", async () => {
    const useGraphRenderer = await importHook();
    const smallOpts = makeOptions({ tierSettings: getTierSettings("small") });

    const { rerender } = renderHook(
      (props: UseGraphRendererOptions) => useGraphRenderer(props),
      { initialProps: smallOpts },
    );

    await waitFor(() => { expect(sigmaConstructorCount).toBe(1); });
    mockSigmaKill.mockClear();

    const largeOpts: UseGraphRendererOptions = {
      ...smallOpts,
      tierSettings: getTierSettings("large"),
    };
    rerender(largeOpts);

    await waitFor(() => {
      expect(sigmaConstructorCount).toBe(2);
    });
    expect(mockSigmaKill).toHaveBeenCalled();
    expect(lastSigmaOptions.hideEdgesOnMove).toBe(true);
  });

  // --- Cycle 16: Cleanup on unmount ---

  it("unmount kills Sigma and unsubscribes selection store", async () => {
    const useGraphRenderer = await importHook();
    const opts = makeOptions();

    const { unmount } = renderHook(() => useGraphRenderer(opts));

    await waitFor(() => { expect(sigmaConstructorCount).toBe(1); });
    mockSigmaKill.mockClear();
    mockSigmaRefresh.mockClear();

    unmount();

    expect(mockSigmaKill).toHaveBeenCalled();

    act(() => {
      useGraphSelectionStore.getState().toggleNode("a.md");
    });
    expect(mockSigmaRefresh).not.toHaveBeenCalled();
  });

  it("unmount disposes nudge controller", async () => {
    const mockDispose = vi.fn();
    mockCreateNudgeController.mockReturnValue({
      enter: vi.fn(),
      leave: vi.fn(),
      dispose: mockDispose,
    });

    const useGraphRenderer = await importHook();
    const opts = makeOptions({ tierSettings: getTierSettings("small") });

    const { unmount } = renderHook(() => useGraphRenderer(opts));

    await waitFor(() => { expect(mockCreateNudgeController).toHaveBeenCalled(); });

    unmount();

    expect(mockDispose).toHaveBeenCalled();
  });

  // --- Cycle 17: resetZoom + refresh helpers ---

  it("resetZoom delegates to camera.animatedReset", async () => {
    const useGraphRenderer = await importHook();
    const opts = makeOptions();
    const { result } = renderHook(() => useGraphRenderer(opts));

    await waitFor(() => { expect(sigmaConstructorCount).toBe(1); });
    mockCameraAnimatedReset.mockClear();

    act(() => {
      result.current.resetZoom();
    });

    expect(mockCameraAnimatedReset).toHaveBeenCalled();
  });

  it("refresh delegates to sigma.refresh", async () => {
    const useGraphRenderer = await importHook();
    const opts = makeOptions();
    const { result } = renderHook(() => useGraphRenderer(opts));

    await waitFor(() => { expect(sigmaConstructorCount).toBe(1); });
    mockSigmaRefresh.mockClear();

    act(() => {
      result.current.refresh();
    });

    expect(mockSigmaRefresh).toHaveBeenCalled();
  });

  it("resetZoom before init is a no-op (no crash)", async () => {
    const useGraphRenderer = await importHook();
    const opts = makeOptions();
    const { result } = renderHook(() => useGraphRenderer(opts));

    expect(() => {
      result.current.resetZoom();
    }).not.toThrow();
  });

  it("refresh before init is a no-op (no crash)", async () => {
    const useGraphRenderer = await importHook();
    const opts = makeOptions();
    const { result } = renderHook(() => useGraphRenderer(opts));

    expect(() => {
      result.current.refresh();
    }).not.toThrow();
  });

  // --- Cycle: seedVersion change triggers refresh WITHOUT camera reset ---

  it("seedVersion change triggers sigma.refresh WITHOUT camera.animatedReset", async () => {
    const useGraphRenderer = await importHook();
    const opts = makeOptions({ dataVersion: 1, seedVersion: 0 });

    const { rerender } = renderHook(
      (props: UseGraphRendererOptions) => useGraphRenderer(props),
      { initialProps: opts },
    );

    await waitFor(() => { expect(sigmaConstructorCount).toBe(1); });
    mockSigmaRefresh.mockClear();
    mockCameraAnimatedReset.mockClear();

    rerender({ ...opts, seedVersion: 1 });

    await waitFor(() => {
      expect(mockSigmaRefresh).toHaveBeenCalled();
    });
    expect(mockCameraAnimatedReset).not.toHaveBeenCalled();
  });
});
