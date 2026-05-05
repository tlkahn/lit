import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useMindmapZoom } from "./useMindmapZoom";

const mockTransformCall = vi.fn();
const mockTransitionCall = vi.fn();

vi.mock("d3-selection", () => {
  const sel = {
    call: (...args: unknown[]) => {
      mockTransformCall(...args);
      return sel;
    },
    on: () => sel,
    transition: () => ({
      duration: () => ({
        call: (...args: unknown[]) => {
          mockTransitionCall(...args);
          return sel;
        },
      }),
    }),
  };
  return { select: () => sel };
});

vi.mock("d3-zoom", () => {
  const transformFn = vi.fn();
  const zoomBehavior = Object.assign(
    () => zoomBehavior,
    {
      scaleExtent: () => zoomBehavior,
      filter: () => zoomBehavior,
      on: () => zoomBehavior,
      transform: transformFn,
      scaleBy: vi.fn(),
    },
  );
  return {
    zoom: () => zoomBehavior,
    zoomIdentity: { translate: (_x: number, _y: number) => ({ scale: () => ({ k: 1, x: 0, y: 0 }) }) },
  };
});

function createMockSvg() {
  const el = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  el.getBoundingClientRect = () => ({
    x: 0, y: 0, width: 1000, height: 800,
    top: 0, left: 0, bottom: 800, right: 1000, toJSON: () => "",
  });
  return el;
}

describe("useMindmapZoom", () => {
  beforeEach(() => {
    mockTransformCall.mockClear();
    mockTransitionCall.mockClear();
  });

  it("returns initial identity transform", () => {
    const { result } = renderHook(() => useMindmapZoom(null, false));
    expect(result.current.transformRef.current).toEqual({ k: 1, x: 0, y: 0 });
  });

  it("returns expected API shape", () => {
    const { result } = renderHook(() => useMindmapZoom(null, false));
    expect(result.current.svgRef).toBeDefined();
    expect(result.current.gRef).toBeDefined();
    expect(result.current.transformRef).toBeDefined();
    expect(typeof result.current.fitContent).toBe("function");
    expect(typeof result.current.zoomIn).toBe("function");
    expect(typeof result.current.zoomOut).toBe("function");
  });

  it("fitContent does not throw without SVG mounted", () => {
    const { result } = renderHook(() =>
      useMindmapZoom({ x: 0, y: 0, width: 800, height: 600 }, true),
    );
    expect(() => result.current.fitContent()).not.toThrow();
  });

  it("zoomIn and zoomOut do not throw without SVG mounted", () => {
    const { result } = renderHook(() => useMindmapZoom(null, false));
    expect(() => result.current.zoomIn()).not.toThrow();
    expect(() => result.current.zoomOut()).not.toThrow();
  });

  it("does NOT auto-fit viewport when contentBounds change after initial fit", () => {
    const svg = createMockSvg();
    const initialBounds = { x: 0, y: 0, width: 400, height: 300 };

    // Start disabled so we can assign the SVG ref before effects fire
    const { result, rerender } = renderHook(
      ({ bounds, enabled }) => useMindmapZoom(bounds, enabled),
      { initialProps: { bounds: initialBounds, enabled: false } },
    );

    // Assign the mock SVG to the ref
    (result.current.svgRef as React.MutableRefObject<SVGSVGElement | null>).current = svg;

    // Enable zoom — triggers zoom setup + initial fit effects
    rerender({ bounds: initialBounds, enabled: true });

    // Initial fit should have been called (immediate, not via transition)
    const initialCalls = mockTransformCall.mock.calls.length;
    expect(initialCalls).toBeGreaterThan(0);

    // Clear mocks to isolate subsequent behavior
    mockTransformCall.mockClear();
    mockTransitionCall.mockClear();

    // Simulate node insertion by changing bounds
    const newBounds = { x: 0, y: 0, width: 600, height: 400 };
    rerender({ bounds: newBounds, enabled: true });

    // After bounds change, NO additional transform should be applied
    expect(mockTransformCall).not.toHaveBeenCalled();
    expect(mockTransitionCall).not.toHaveBeenCalled();
  });

  it("fitContent() still works after initial fit even with bounds changes", () => {
    const svg = createMockSvg();
    const initialBounds = { x: 0, y: 0, width: 400, height: 300 };

    const { result, rerender } = renderHook(
      ({ bounds, enabled }) => useMindmapZoom(bounds, enabled),
      { initialProps: { bounds: initialBounds, enabled: false } },
    );

    (result.current.svgRef as React.MutableRefObject<SVGSVGElement | null>).current = svg;
    rerender({ bounds: initialBounds, enabled: true });
    mockTransformCall.mockClear();
    mockTransitionCall.mockClear();

    // Change bounds (simulating node insertion)
    const newBounds = { x: 0, y: 0, width: 600, height: 400 };
    rerender({ bounds: newBounds, enabled: true });

    // Explicit fitContent should still work
    act(() => {
      result.current.fitContent();
    });

    expect(mockTransitionCall).toHaveBeenCalled();
  });
});
