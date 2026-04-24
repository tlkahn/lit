import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { useMindmapZoom } from "./useMindmapZoom";

describe("useMindmapZoom", () => {
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
});
