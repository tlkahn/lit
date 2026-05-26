import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useGraphSelectionStore } from "../stores/graphSelection";

describe("useGraphLasso", () => {
  let containerRef: { current: HTMLDivElement | null };
  let sigmaRef: { current: { setSetting: ReturnType<typeof vi.fn>; getNodeDisplayData: ReturnType<typeof vi.fn> } | null };
  let graphRef: { current: { nodes: () => string[] } | null };
  let hoveredNodeRef: { current: string | null };

  beforeEach(() => {
    vi.clearAllMocks();
    useGraphSelectionStore.setState({ selectedNodes: [], selectionMode: "none" });

    const div = document.createElement("div");
    vi.spyOn(div, "getBoundingClientRect").mockReturnValue({
      left: 0, top: 0, right: 800, bottom: 600,
      width: 800, height: 600, x: 0, y: 0, toJSON: () => ({}),
    });
    containerRef = { current: div };
    sigmaRef = { current: { setSetting: vi.fn(), getNodeDisplayData: vi.fn() } };
    graphRef = { current: { nodes: () => ["a.md", "b.md"] } };
    hoveredNodeRef = { current: null };
  });

  it("initial lassoState is null", async () => {
    const { useGraphLasso } = await import("./useGraphLasso");
    const { result } = renderHook(() =>
      useGraphLasso(containerRef, sigmaRef, graphRef, hoveredNodeRef),
    );
    expect(result.current.lassoState).toBeNull();
  });

  it("handleLassoMouseDown with shiftKey sets lassoState and lasso mode", async () => {
    const { useGraphLasso } = await import("./useGraphLasso");
    const { result } = renderHook(() =>
      useGraphLasso(containerRef, sigmaRef, graphRef, hoveredNodeRef),
    );

    act(() => {
      result.current.handleLassoMouseDown({
        shiftKey: true, clientX: 100, clientY: 100,
      } as React.MouseEvent);
    });

    expect(result.current.lassoState).not.toBeNull();
    expect(result.current.lassoState!.startX).toBe(100);
    expect(result.current.lassoState!.startY).toBe(100);
    expect(useGraphSelectionStore.getState().selectionMode).toBe("lasso");
    expect(sigmaRef.current!.setSetting).toHaveBeenCalledWith("enableCameraPanning", false);
    expect(containerRef.current!.style.cursor).toBe("crosshair");
  });

  it("handleLassoMouseDown without shiftKey does nothing", async () => {
    const { useGraphLasso } = await import("./useGraphLasso");
    const { result } = renderHook(() =>
      useGraphLasso(containerRef, sigmaRef, graphRef, hoveredNodeRef),
    );

    act(() => {
      result.current.handleLassoMouseDown({
        shiftKey: false, clientX: 100, clientY: 100,
      } as React.MouseEvent);
    });

    expect(result.current.lassoState).toBeNull();
  });

  it("handleLassoMouseDown when hoveredNode is set does nothing", async () => {
    hoveredNodeRef.current = "a.md";
    const { useGraphLasso } = await import("./useGraphLasso");
    const { result } = renderHook(() =>
      useGraphLasso(containerRef, sigmaRef, graphRef, hoveredNodeRef),
    );

    act(() => {
      result.current.handleLassoMouseDown({
        shiftKey: true, clientX: 100, clientY: 100,
      } as React.MouseEvent);
    });

    expect(result.current.lassoState).toBeNull();
  });

  it("handleLassoMouseMove updates currentX/currentY", async () => {
    const { useGraphLasso } = await import("./useGraphLasso");
    const { result } = renderHook(() =>
      useGraphLasso(containerRef, sigmaRef, graphRef, hoveredNodeRef),
    );

    act(() => {
      result.current.handleLassoMouseDown({
        shiftKey: true, clientX: 100, clientY: 100,
      } as React.MouseEvent);
    });

    act(() => {
      result.current.handleLassoMouseMove({
        clientX: 200, clientY: 250,
      } as React.MouseEvent);
    });

    expect(result.current.lassoState!.currentX).toBe(200);
    expect(result.current.lassoState!.currentY).toBe(250);
  });

  it("handleLassoMouseUp selects nodes in rect, clears lassoState, re-enables camera", async () => {
    sigmaRef.current!.getNodeDisplayData.mockImplementation((nodeId: string) => {
      if (nodeId === "a.md") return { x: 150, y: 150 };
      if (nodeId === "b.md") return { x: 500, y: 500 };
      return null;
    });

    const { useGraphLasso } = await import("./useGraphLasso");
    const { result } = renderHook(() =>
      useGraphLasso(containerRef, sigmaRef, graphRef, hoveredNodeRef),
    );

    act(() => {
      result.current.handleLassoMouseDown({
        shiftKey: true, clientX: 100, clientY: 100,
      } as React.MouseEvent);
    });
    act(() => {
      result.current.handleLassoMouseMove({
        clientX: 200, clientY: 200,
      } as React.MouseEvent);
    });
    act(() => {
      result.current.handleLassoMouseUp();
    });

    expect(result.current.lassoState).toBeNull();
    expect(useGraphSelectionStore.getState().selectedNodes).toContain("a.md");
    expect(useGraphSelectionStore.getState().selectedNodes).not.toContain("b.md");
    expect(sigmaRef.current!.setSetting).toHaveBeenCalledWith("enableCameraPanning", true);
    expect(containerRef.current!.style.cursor).toBe("grab");
  });

  it("empty lasso (no nodes in rect) does not call addNodes", async () => {
    sigmaRef.current!.getNodeDisplayData.mockReturnValue({ x: 500, y: 500 });

    const { useGraphLasso } = await import("./useGraphLasso");
    const { result } = renderHook(() =>
      useGraphLasso(containerRef, sigmaRef, graphRef, hoveredNodeRef),
    );

    act(() => {
      result.current.handleLassoMouseDown({
        shiftKey: true, clientX: 100, clientY: 100,
      } as React.MouseEvent);
    });
    act(() => {
      result.current.handleLassoMouseMove({
        clientX: 200, clientY: 200,
      } as React.MouseEvent);
    });
    act(() => {
      result.current.handleLassoMouseUp();
    });

    expect(result.current.lassoState).toBeNull();
    expect(useGraphSelectionStore.getState().selectedNodes).toEqual([]);
    expect(containerRef.current!.style.cursor).toBe("grab");
  });

  it("mouseUp re-enables camera panning even with empty selection", async () => {
    sigmaRef.current!.getNodeDisplayData.mockReturnValue({ x: 500, y: 500 });

    const { useGraphLasso } = await import("./useGraphLasso");
    const { result } = renderHook(() =>
      useGraphLasso(containerRef, sigmaRef, graphRef, hoveredNodeRef),
    );

    act(() => {
      result.current.handleLassoMouseDown({
        shiftKey: true, clientX: 100, clientY: 100,
      } as React.MouseEvent);
    });
    act(() => {
      result.current.handleLassoMouseMove({
        clientX: 200, clientY: 200,
      } as React.MouseEvent);
    });
    act(() => {
      result.current.handleLassoMouseUp();
    });

    expect(sigmaRef.current!.setSetting).toHaveBeenCalledWith("enableCameraPanning", true);
    expect(useGraphSelectionStore.getState().selectionMode).toBe("none");
  });

  it("coordinates are container-relative", async () => {
    vi.spyOn(containerRef.current!, "getBoundingClientRect").mockReturnValue({
      left: 200, top: 50, right: 1000, bottom: 800,
      width: 800, height: 750, x: 200, y: 50, toJSON: () => ({}),
    });

    const { useGraphLasso } = await import("./useGraphLasso");
    const { result } = renderHook(() =>
      useGraphLasso(containerRef, sigmaRef, graphRef, hoveredNodeRef),
    );

    act(() => {
      result.current.handleLassoMouseDown({
        shiftKey: true, clientX: 300, clientY: 150,
      } as React.MouseEvent);
    });

    expect(result.current.lassoState!.startX).toBe(100);
    expect(result.current.lassoState!.startY).toBe(100);
  });
});
