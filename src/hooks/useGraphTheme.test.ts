import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import * as graphLayout from "../lib/graphLayout";

describe("useGraphTheme", () => {
  let graphRef: { current: { forEachNode: ReturnType<typeof vi.fn>; setNodeAttribute: ReturnType<typeof vi.fn> } | null };
  let sigmaRef: { current: { refresh: ReturnType<typeof vi.fn>; setSetting: ReturnType<typeof vi.fn> } | null };
  let dimColorRef: { current: string };

  beforeEach(() => {
    vi.clearAllMocks();
    graphRef = {
      current: {
        forEachNode: vi.fn((cb: (node: string, attrs: Record<string, unknown>) => void) => {
          cb("a.md", { type: "filled", color: "#old" });
          cb("seed.md", { type: "seed", color: "#seedcolor" });
        }),
        setNodeAttribute: vi.fn(),
      },
    };
    sigmaRef = { current: { refresh: vi.fn(), setSetting: vi.fn() } };
    dimColorRef = { current: "#d1d9e0" };
  });

  it("applyTheme updates non-seed node colors, sigma settings, and dimColorRef", async () => {
    vi.spyOn(graphLayout, "resolveThemeColors").mockReturnValue({
      accentColor: "#ff0000",
      dimColor: "#333",
      edgeColor: "#aaa",
      labelColor: "#fff",
    });

    const { useGraphTheme } = await import("./useGraphTheme");
    const { result } = renderHook(() =>
      useGraphTheme(graphRef, sigmaRef, dimColorRef),
    );

    act(() => {
      result.current.applyTheme();
    });

    expect(graphRef.current!.setNodeAttribute).toHaveBeenCalledWith("a.md", "color", "#ff0000");
    expect(graphRef.current!.setNodeAttribute).not.toHaveBeenCalledWith("seed.md", "color", expect.anything());
    expect(sigmaRef.current!.setSetting).toHaveBeenCalledWith("defaultEdgeColor", "#aaa");
    expect(sigmaRef.current!.setSetting).toHaveBeenCalledWith("labelColor", { color: "#fff" });
    expect(sigmaRef.current!.refresh).toHaveBeenCalled();
    expect(dimColorRef.current).toBe("#333");
  });

  it("no-op when graphRef or sigmaRef is null", async () => {
    const { useGraphTheme } = await import("./useGraphTheme");
    graphRef.current = null;
    const { result } = renderHook(() =>
      useGraphTheme(graphRef, sigmaRef, dimColorRef),
    );

    act(() => {
      result.current.applyTheme();
    });

    expect(sigmaRef.current!.refresh).not.toHaveBeenCalled();
  });
});
