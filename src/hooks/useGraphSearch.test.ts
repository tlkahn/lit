import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

describe("useGraphSearch", () => {
  let graphRef: {
    current: {
      forEachNode: ReturnType<typeof vi.fn>;
      source: ReturnType<typeof vi.fn>;
      target: ReturnType<typeof vi.fn>;
    } | null;
  };
  let sigmaRef: {
    current: {
      setSetting: ReturnType<typeof vi.fn>;
      getCamera: ReturnType<typeof vi.fn>;
      getNodeDisplayData: ReturnType<typeof vi.fn>;
    } | null;
  };
  let tierSettingsRef: { current: { defaultEdgesHidden: boolean } };
  let defaultNodeReducer: ReturnType<typeof vi.fn>;
  let onNavigateRef: { current: ((id: string) => void) | undefined };
  let selectedSetRef: { current: Set<string> };
  let dimColorRef: { current: string };
  let mockAnimate: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockAnimate = vi.fn();

    graphRef = {
      current: {
        forEachNode: vi.fn((cb: (node: string, attrs: Record<string, unknown>) => void) => {
          cb("alpha.md", { label: "Alpha Notes" });
          cb("beta.md", { label: "Beta Research" });
          cb("gamma.md", { label: "Gamma Log" });
        }),
        source: vi.fn((e: string) => e.split("->")[0]!),
        target: vi.fn((e: string) => e.split("->")[1]!),
      },
    };

    sigmaRef = {
      current: {
        setSetting: vi.fn(),
        getCamera: vi.fn(() => ({ animate: mockAnimate })),
        getNodeDisplayData: vi.fn((node: string) => {
          if (node === "alpha.md") return { x: 100, y: 200 };
          if (node === "beta.md") return { x: 300, y: 400 };
          return undefined;
        }),
      },
    };

    tierSettingsRef = { current: { defaultEdgesHidden: false } };
    defaultNodeReducer = vi.fn((_n: string, attrs: Record<string, unknown>) => attrs);
    onNavigateRef = { current: vi.fn() };
    selectedSetRef = { current: new Set() };
    dimColorRef = { current: "#d1d9e0" };
  });

  it("initial state: searchOpen=false, searchQuery='', searchMatches=[]", async () => {
    const { useGraphSearch } = await import("./useGraphSearch");
    const { result } = renderHook(() =>
      useGraphSearch(graphRef, sigmaRef, tierSettingsRef, defaultNodeReducer, onNavigateRef, selectedSetRef, dimColorRef),
    );
    expect(result.current.searchOpen).toBe(false);
    expect(result.current.searchQuery).toBe("");
    expect(result.current.searchMatches).toEqual([]);
  });

  it("handleSearchQueryChange updates matches and sets sigma node/edge reducers", async () => {
    const { useGraphSearch } = await import("./useGraphSearch");
    const { result } = renderHook(() =>
      useGraphSearch(graphRef, sigmaRef, tierSettingsRef, defaultNodeReducer, onNavigateRef, selectedSetRef, dimColorRef),
    );

    act(() => {
      result.current.handleSearchQueryChange("alpha");
    });

    expect(result.current.searchQuery).toBe("alpha");
    expect(result.current.searchMatches).toEqual(["alpha.md"]);
    expect(sigmaRef.current!.setSetting).toHaveBeenCalledWith("nodeReducer", expect.any(Function));
    expect(sigmaRef.current!.setSetting).toHaveBeenCalledWith("edgeReducer", expect.any(Function));
  });

  it("empty query clears matches and restores defaultNodeReducer", async () => {
    const { useGraphSearch } = await import("./useGraphSearch");
    const { result } = renderHook(() =>
      useGraphSearch(graphRef, sigmaRef, tierSettingsRef, defaultNodeReducer, onNavigateRef, selectedSetRef, dimColorRef),
    );

    act(() => {
      result.current.handleSearchQueryChange("alpha");
    });
    sigmaRef.current!.setSetting.mockClear();

    act(() => {
      result.current.handleSearchQueryChange("");
    });

    expect(result.current.searchMatches).toEqual([]);
    expect(sigmaRef.current!.setSetting).toHaveBeenCalledWith("nodeReducer", defaultNodeReducer);
    expect(sigmaRef.current!.setSetting).toHaveBeenCalledWith("edgeReducer", null);
  });

  it("single match animates camera to node position", async () => {
    const { useGraphSearch } = await import("./useGraphSearch");
    const { result } = renderHook(() =>
      useGraphSearch(graphRef, sigmaRef, tierSettingsRef, defaultNodeReducer, onNavigateRef, selectedSetRef, dimColorRef),
    );

    act(() => {
      result.current.handleSearchQueryChange("beta");
    });

    expect(result.current.searchMatches).toEqual(["beta.md"]);
    expect(sigmaRef.current!.getNodeDisplayData).toHaveBeenCalledWith("beta.md");
    expect(mockAnimate).toHaveBeenCalledWith({ x: 300, y: 400, ratio: 0.5 });
  });

  it("handleSearchClose resets all state and restores default reducers", async () => {
    const { useGraphSearch } = await import("./useGraphSearch");
    const { result } = renderHook(() =>
      useGraphSearch(graphRef, sigmaRef, tierSettingsRef, defaultNodeReducer, onNavigateRef, selectedSetRef, dimColorRef),
    );

    act(() => {
      result.current.setSearchOpen(true);
    });
    act(() => {
      result.current.handleSearchQueryChange("alpha");
    });
    sigmaRef.current!.setSetting.mockClear();

    act(() => {
      result.current.handleSearchClose();
    });

    expect(result.current.searchOpen).toBe(false);
    expect(result.current.searchQuery).toBe("");
    expect(result.current.searchMatches).toEqual([]);
    expect(sigmaRef.current!.setSetting).toHaveBeenCalledWith("nodeReducer", defaultNodeReducer);
    expect(sigmaRef.current!.setSetting).toHaveBeenCalledWith("edgeReducer", null);
  });

  it("with defaultEdgesHidden=true, clearing query sets edge-hiding reducer", async () => {
    tierSettingsRef.current.defaultEdgesHidden = true;
    const { useGraphSearch } = await import("./useGraphSearch");
    const { result } = renderHook(() =>
      useGraphSearch(graphRef, sigmaRef, tierSettingsRef, defaultNodeReducer, onNavigateRef, selectedSetRef, dimColorRef),
    );

    act(() => {
      result.current.handleSearchQueryChange("alpha");
    });
    sigmaRef.current!.setSetting.mockClear();

    act(() => {
      result.current.handleSearchQueryChange("");
    });

    const edgeReducerCall = sigmaRef.current!.setSetting.mock.calls.find(
      (call: unknown[]) => call[0] === "edgeReducer",
    );
    expect(edgeReducerCall).toBeDefined();
    const edgeReducer = edgeReducerCall![1] as (e: string, attrs: Record<string, unknown>) => Record<string, unknown>;
    expect(edgeReducer("e1", { color: "red" })).toEqual({ color: "red", hidden: true });
  });

  it("handleSearchClose with defaultEdgesHidden=true sets edge-hiding reducer", async () => {
    tierSettingsRef.current.defaultEdgesHidden = true;
    const { useGraphSearch } = await import("./useGraphSearch");
    const { result } = renderHook(() =>
      useGraphSearch(graphRef, sigmaRef, tierSettingsRef, defaultNodeReducer, onNavigateRef, selectedSetRef, dimColorRef),
    );

    act(() => {
      result.current.handleSearchQueryChange("alpha");
    });
    sigmaRef.current!.setSetting.mockClear();

    act(() => {
      result.current.handleSearchClose();
    });

    const edgeReducerCall = sigmaRef.current!.setSetting.mock.calls.find(
      (call: unknown[]) => call[0] === "edgeReducer",
    );
    expect(edgeReducerCall).toBeDefined();
    const edgeReducer = edgeReducerCall![1] as (e: string, attrs: Record<string, unknown>) => Record<string, unknown>;
    expect(edgeReducer("e1", { color: "red" })).toEqual({ color: "red", hidden: true });
  });

  it("handleSearchNavigate calls onNavigateRef.current", async () => {
    const { useGraphSearch } = await import("./useGraphSearch");
    const { result } = renderHook(() =>
      useGraphSearch(graphRef, sigmaRef, tierSettingsRef, defaultNodeReducer, onNavigateRef, selectedSetRef, dimColorRef),
    );

    act(() => {
      result.current.handleSearchNavigate("alpha.md");
    });

    expect(onNavigateRef.current).toHaveBeenCalledWith("alpha.md");
  });

  it("searchOpenRef stays in sync with searchOpen", async () => {
    const { useGraphSearch } = await import("./useGraphSearch");
    const { result } = renderHook(() =>
      useGraphSearch(graphRef, sigmaRef, tierSettingsRef, defaultNodeReducer, onNavigateRef, selectedSetRef, dimColorRef),
    );

    expect(result.current.searchOpenRef.current).toBe(false);

    act(() => {
      result.current.setSearchOpen(true);
    });
    expect(result.current.searchOpenRef.current).toBe(true);

    act(() => {
      result.current.setSearchOpen(false);
    });
    expect(result.current.searchOpenRef.current).toBe(false);
  });
});
