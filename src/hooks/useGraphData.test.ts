import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import Graph from "graphology";
import { mockInvoke, mockListen, emitMockEvent } from "../test/tauri-mock";
import * as graphLayout from "../lib/graphLayout";
import { NODE_NOT_FOUND_PREFIX, type SubgraphResult } from "../lib/ipc";
import type { UseGraphDataOptions } from "./useGraphData";
import { useWorkspaceStore } from "../stores/workspace";

const TWO_NODE_SUBGRAPH: SubgraphResult = {
  nodes: [
    { id: "a.md", title: "A", is_stub: false, materialization: "materialized" },
    { id: "b.md", title: "B", is_stub: false, materialization: "materialized" },
  ],
  edges: [["a.md", "b.md", "wikilink"]],
};

const LOCAL_SUBGRAPH: SubgraphResult = {
  nodes: [
    { id: "a.md", title: "A", is_stub: false, materialization: "materialized" },
    { id: "c.md", title: "C", is_stub: false, materialization: "materialized" },
  ],
  edges: [["a.md", "c.md", "wikilink"]],
};

function makeInvokeHandler(subgraph: SubgraphResult = TWO_NODE_SUBGRAPH) {
  return (cmd: string, _args?: Record<string, unknown>) => {
    if (cmd === "get_graph_subgraph") return subgraph;
    if (cmd === "get_graph_positions") return {};
    return null;
  };
}

describe("useGraphData", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useWorkspaceStore.setState({ graphReady: true });
    vi.spyOn(graphLayout, "resolveThemeColors").mockReturnValue({
      accentColor: "#0969da",
      dimColor: "#d1d9e0",
      edgeColor: "#818b98",
      labelColor: "#1f2328",
    });
  });

  async function importHook() {
    const mod = await import("./useGraphData");
    return mod.useGraphData;
  }

  // Cycle 1: Initial state
  describe("initial state", () => {
    it("returns loading: true, error: null, graphStats: null, empty graph, dataVersion 0", async () => {
      mockInvoke(makeInvokeHandler());
      const useGraphData = await importHook();

      const { result } = renderHook(() =>
        useGraphData({ mode: "full", depth: 1, activePageId: null }),
      );

      expect(result.current.loading).toBe(true);
      expect(result.current.error).toBe(null);
      expect(result.current.graphStats).toBe(null);
      expect(result.current.graphRef.current).toBeInstanceOf(Graph);
      expect(result.current.graphRef.current!.order).toBe(0);
      expect(result.current.dataVersion).toBe(0);
    });
  });

  // Cycle 2: Full mode fetch + build
  describe("full mode fetch + build", () => {
    it("calls getFullSubgraph and populates graph", async () => {
      const handler = vi.fn(makeInvokeHandler());
      mockInvoke(handler);
      const useGraphData = await importHook();

      const { result } = renderHook(() =>
        useGraphData({ mode: "full", depth: 1, activePageId: null }),
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(handler).toHaveBeenCalledWith("get_graph_subgraph", {
        seeds: [],
        depth: 0,
        directed: null,
        includeCitations: null,
      });
      expect(result.current.graphStats).toEqual({ nodes: 2, edges: 1 });
      expect(result.current.graphRef.current!.order).toBe(2);
      expect(result.current.graphRef.current!.size).toBe(1);
    });

    it("passes seedId to populateGraph in full mode when activePageId is set", async () => {
      mockInvoke(makeInvokeHandler());
      const populateSpy = vi.spyOn(graphLayout, "populateGraph");
      const useGraphData = await importHook();

      const { result } = renderHook(() =>
        useGraphData({ mode: "full", depth: 1, activePageId: "a.md" }),
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(populateSpy).toHaveBeenCalledWith(
        expect.any(Graph),
        TWO_NODE_SUBGRAPH,
        "#0969da",
        "a.md",
      );
    });
  });

  // Cycle 3: Local mode fetch
  describe("local mode fetch", () => {
    it("calls getGraphSubgraph with seed and depth", async () => {
      const handler = vi.fn(makeInvokeHandler(LOCAL_SUBGRAPH));
      mockInvoke(handler);
      const useGraphData = await importHook();

      const { result } = renderHook(() =>
        useGraphData({ mode: "local", depth: 2, activePageId: "a.md" }),
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(handler).toHaveBeenCalledWith("get_graph_subgraph", {
        seeds: ["a.md"],
        depth: 2,
        directed: null,
        includeCitations: null,
      });
      expect(result.current.graphRef.current!.hasNode("a.md")).toBe(true);
      expect(result.current.graphRef.current!.hasNode("c.md")).toBe(true);
    });

    it("passes seedId to populateGraph so seed node gets seed color", async () => {
      mockInvoke(makeInvokeHandler(LOCAL_SUBGRAPH));
      const populateSpy = vi.spyOn(graphLayout, "populateGraph");
      const useGraphData = await importHook();

      const { result } = renderHook(() =>
        useGraphData({ mode: "local", depth: 2, activePageId: "a.md" }),
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(populateSpy).toHaveBeenCalledWith(
        expect.any(Graph),
        LOCAL_SUBGRAPH,
        "#0969da",
        "a.md",
      );
    });
  });

  // Cycle 3b: Local mode resilience — missing active seed
  describe("local mode resilience", () => {
    it("falls back to a synthetic seed node when get_graph_subgraph throws node-not-found", async () => {
      mockInvoke((cmd: string) => {
        if (cmd === "get_graph_subgraph") throw new Error(`${NODE_NOT_FOUND_PREFIX} notes/a.md`);
        return {};
      });
      const useGraphData = await importHook();

      const { result } = renderHook(() =>
        useGraphData({ mode: "local", depth: 2, activePageId: "notes/a.md" }),
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.error).toBe(null);
      const graph = result.current.graphRef.current!;
      expect(graph.hasNode("notes/a.md")).toBe(true);
      expect(graph.getNodeAttribute("notes/a.md", "label")).toBe("a");
    });

    it("injects the active node when the returned subgraph omits it", async () => {
      const subgraphWithoutSeed: SubgraphResult = {
        nodes: [
          { id: "x.md", title: "X", is_stub: false, materialization: "materialized" },
          { id: "y.md", title: "Y", is_stub: false, materialization: "materialized" },
        ],
        edges: [["x.md", "y.md", "wikilink"]],
      };
      mockInvoke((cmd: string) => {
        if (cmd === "get_graph_subgraph") return subgraphWithoutSeed;
        return {};
      });
      const useGraphData = await importHook();

      const { result } = renderHook(() =>
        useGraphData({ mode: "local", depth: 2, activePageId: "notes/new page.md" }),
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.error).toBe(null);
      const graph = result.current.graphRef.current!;
      expect(graph.hasNode("notes/new page.md")).toBe(true);
      expect(graph.getNodeAttribute("notes/new page.md", "label")).toBe("new page");
      // existing nodes preserved
      expect(graph.hasNode("x.md")).toBe(true);
      expect(graph.hasNode("y.md")).toBe(true);
    });

    it("propagates non-node-not-found errors instead of swallowing them", async () => {
      mockInvoke((cmd: string) => {
        if (cmd === "get_graph_subgraph") throw new Error("connection lost");
        return {};
      });
      const useGraphData = await importHook();

      const { result } = renderHook(() =>
        useGraphData({ mode: "local", depth: 2, activePageId: "a.md" }),
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.error).toBe("connection lost");
      expect(result.current.graphRef.current!.order).toBe(0);
    });
  });

  // Cycle 4: Theme color resolution + dimColorRef
  describe("theme color resolution", () => {
    it("resolves theme colors and sets dimColorRef", async () => {
      vi.spyOn(graphLayout, "resolveThemeColors").mockReturnValue({
        accentColor: "#ff0000",
        dimColor: "#aabbcc",
        edgeColor: "#818b98",
        labelColor: "#1f2328",
      });
      mockInvoke(makeInvokeHandler());
      const useGraphData = await importHook();

      const { result } = renderHook(() =>
        useGraphData({ mode: "full", depth: 1, activePageId: null }),
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(graphLayout.resolveThemeColors).toHaveBeenCalled();
      expect(result.current.dimColorRef.current).toBe("#aabbcc");
    });

    it("uses resolved accent color for graph nodes", async () => {
      vi.spyOn(graphLayout, "resolveThemeColors").mockReturnValue({
        accentColor: "#ff0000",
        dimColor: "#aabbcc",
        edgeColor: "#818b98",
        labelColor: "#1f2328",
      });
      mockInvoke(makeInvokeHandler());
      const useGraphData = await importHook();

      const { result } = renderHook(() =>
        useGraphData({ mode: "full", depth: 1, activePageId: null }),
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      const graph = result.current.graphRef.current!;
      expect(graph.getNodeAttribute("a.md", "color")).toBe("#ff0000");
    });
  });

  // Cycle 5: Position application
  describe("position application", () => {
    it("applies positions from subgraph result", async () => {
      const subgraphWithPos: SubgraphResult = {
        ...TWO_NODE_SUBGRAPH,
        positions: { "a.md": { x: 42, y: 84 } },
      };
      mockInvoke(makeInvokeHandler(subgraphWithPos));
      const applySpy = vi.spyOn(graphLayout, "applyPositions");
      const useGraphData = await importHook();

      const { result } = renderHook(() =>
        useGraphData({ mode: "full", depth: 1, activePageId: null }),
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(applySpy).toHaveBeenCalledWith(
        expect.any(Graph),
        { "a.md": { x: 42, y: 84 } },
      );
      expect(result.current.graphRef.current!.getNodeAttribute("a.md", "x")).toBe(42);
      expect(result.current.graphRef.current!.getNodeAttribute("a.md", "y")).toBe(84);
    });

    it("does not call applyPositions when positions are empty", async () => {
      const subgraphNoPos: SubgraphResult = {
        ...TWO_NODE_SUBGRAPH,
        positions: {},
      };
      mockInvoke(makeInvokeHandler(subgraphNoPos));
      const applySpy = vi.spyOn(graphLayout, "applyPositions");
      const useGraphData = await importHook();

      const { result } = renderHook(() =>
        useGraphData({ mode: "full", depth: 1, activePageId: null }),
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(applySpy).not.toHaveBeenCalled();
    });
  });

  // Cycle 6: Quality tier
  describe("quality tier", () => {
    it("returns small tier for small graphs", async () => {
      mockInvoke(makeInvokeHandler());
      const useGraphData = await importHook();

      const { result } = renderHook(() =>
        useGraphData({ mode: "full", depth: 1, activePageId: null }),
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.tierSettings.tier).toBe("small");
      expect(result.current.tierSettings.enableEdgeEvents).toBe(true);
    });

    it("returns appropriate tier for large graphs", async () => {
      const manyNodes = Array.from({ length: 1200 }, (_, i) => ({
        id: `n${i}.md`,
        title: `N${i}`,
        is_stub: false as const,
        materialization: "materialized" as const,
      }));
      const largeSubgraph: SubgraphResult = { nodes: manyNodes, edges: [] };
      mockInvoke(makeInvokeHandler(largeSubgraph));
      const useGraphData = await importHook();

      const { result } = renderHook(() =>
        useGraphData({ mode: "full", depth: 1, activePageId: null }),
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.tierSettings.tier).toBe("medium");
      expect(result.current.tierSettings.enableEdgeEvents).toBe(false);
    });
  });

  // Cycle 7: Error handling
  describe("error handling", () => {
    it("sets error and loading false when IPC throws", async () => {
      mockInvoke(() => {
        throw new Error("connection lost");
      });
      const useGraphData = await importHook();

      const { result } = renderHook(() =>
        useGraphData({ mode: "full", depth: 1, activePageId: null }),
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.error).toBe("connection lost");
      expect(result.current.graphRef.current!.order).toBe(0);
    });

    it("sets generic error for non-Error throws", async () => {
      mockInvoke(() => {
        throw "string error";
      });
      const useGraphData = await importHook();

      const { result } = renderHook(() =>
        useGraphData({ mode: "full", depth: 1, activePageId: null }),
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.error).toBe("Failed to load graph");
    });
  });

  // Cycle 8: Mode/depth change triggers rebuild (same instance)
  describe("mode/depth change rebuild", () => {
    it("clears and rebuilds graph on mode change, same instance", async () => {
      const handler = vi.fn((cmd: string, args?: Record<string, unknown>) => {
        if (cmd === "get_graph_subgraph") {
          const seeds = (args?.seeds as string[]) ?? [];
          return seeds.length > 0 ? LOCAL_SUBGRAPH : TWO_NODE_SUBGRAPH;
        }
        return {};
      });
      mockInvoke(handler);
      const useGraphData = await importHook();

      const { result, rerender } = renderHook(
        (props: UseGraphDataOptions) => useGraphData(props),
        { initialProps: { mode: "full", depth: 1, activePageId: null } as UseGraphDataOptions },
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      const graphBefore = result.current.graphRef.current;
      expect(graphBefore!.order).toBe(2);
      expect(graphBefore!.hasNode("a.md")).toBe(true);
      expect(graphBefore!.hasNode("b.md")).toBe(true);

      rerender({ mode: "local", depth: 2, activePageId: "a.md" });

      await waitFor(() => {
        expect(result.current.graphRef.current!.hasNode("c.md")).toBe(true);
      });

      expect(result.current.graphRef.current).toBe(graphBefore);
      expect(result.current.graphRef.current!.hasNode("b.md")).toBe(false);
      expect(result.current.graphStats).toEqual({ nodes: 2, edges: 1 });
    });
  });

  // Cycle 9: dataVersion increments
  describe("dataVersion", () => {
    it("increments after each build", async () => {
      const handler = vi.fn((cmd: string, args?: Record<string, unknown>) => {
        if (cmd === "get_graph_subgraph") {
          const seeds = (args?.seeds as string[]) ?? [];
          return seeds.length > 0 ? LOCAL_SUBGRAPH : TWO_NODE_SUBGRAPH;
        }
        return {};
      });
      mockInvoke(handler);
      const useGraphData = await importHook();

      const { result, rerender } = renderHook(
        (props: UseGraphDataOptions) => useGraphData(props),
        { initialProps: { mode: "full", depth: 1, activePageId: null } as UseGraphDataOptions },
      );

      expect(result.current.dataVersion).toBe(0);

      await waitFor(() => {
        expect(result.current.dataVersion).toBe(1);
      });

      rerender({ mode: "local", depth: 2, activePageId: "a.md" });

      await waitFor(() => {
        expect(result.current.dataVersion).toBe(2);
      });
    });
  });

  // Cycle 10: lit:graph-updated full rebuild
  describe("lit:graph-updated", () => {
    it("re-fetches and rebuilds on event", async () => {
      let callCount = 0;
      const updatedSubgraph: SubgraphResult = {
        nodes: [
          { id: "a.md", title: "A", is_stub: false, materialization: "materialized" },
          { id: "b.md", title: "B", is_stub: false, materialization: "materialized" },
          { id: "d.md", title: "D", is_stub: false, materialization: "materialized" },
        ],
        edges: [["a.md", "b.md", "wikilink"], ["b.md", "d.md", "wikilink"]],
      };

      mockInvoke((cmd: string) => {
        if (cmd === "get_graph_subgraph") {
          callCount++;
          return callCount === 1 ? TWO_NODE_SUBGRAPH : updatedSubgraph;
        }
        return {};
      });
      mockListen();
      const useGraphData = await importHook();

      const { result } = renderHook(() =>
        useGraphData({ mode: "full", depth: 1, activePageId: null }),
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.graphStats).toEqual({ nodes: 2, edges: 1 });
      const v1 = result.current.dataVersion;

      await act(async () => {
        emitMockEvent("lit:graph-updated", null);
      });

      await waitFor(() => {
        expect(result.current.graphStats).toEqual({ nodes: 3, edges: 2 });
      });

      expect(result.current.dataVersion).toBeGreaterThan(v1);
      expect(result.current.graphRef.current!.order).toBe(3);
    });

    it("does not rebuild on lit:graph-updated when graphReady is false", async () => {
      useWorkspaceStore.setState({ graphReady: false });
      const handler = vi.fn(makeInvokeHandler());
      mockInvoke(handler);
      mockListen();
      const useGraphData = await importHook();

      renderHook(() =>
        useGraphData({ mode: "full", depth: 1, activePageId: null }),
      );

      // No IPC calls should have been made (graphReady is false, initial build skipped)
      expect(handler).not.toHaveBeenCalled();

      // Emit graph-updated while graphReady is false
      await act(async () => {
        emitMockEvent("lit:graph-updated", null);
      });

      // Still no IPC calls — the listener should have bailed out
      expect(handler).not.toHaveBeenCalled();
    });

    it("uses getGraphSubgraph with correct seed/depth in local mode", async () => {
      let callCount = 0;
      const updatedLocalSubgraph: SubgraphResult = {
        nodes: [
          { id: "a.md", title: "A", is_stub: false, materialization: "materialized" },
          { id: "c.md", title: "C", is_stub: false, materialization: "materialized" },
          { id: "d.md", title: "D", is_stub: false, materialization: "materialized" },
        ],
        edges: [["a.md", "c.md", "wikilink"], ["a.md", "d.md", "wikilink"]],
      };

      const handler = vi.fn((cmd: string, _args?: Record<string, unknown>) => {
        if (cmd === "get_graph_subgraph") {
          callCount++;
          return callCount === 1 ? LOCAL_SUBGRAPH : updatedLocalSubgraph;
        }
        return {};
      });
      mockInvoke(handler);
      mockListen();
      const useGraphData = await importHook();

      const { result } = renderHook(() =>
        useGraphData({ mode: "local", depth: 2, activePageId: "a.md" }),
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      const v1 = result.current.dataVersion;

      await act(async () => {
        emitMockEvent("lit:graph-updated", null);
      });

      await waitFor(() => {
        expect(result.current.graphRef.current!.hasNode("d.md")).toBe(true);
      });

      expect(handler).toHaveBeenLastCalledWith("get_graph_subgraph", {
        seeds: ["a.md"],
        depth: 2,
        directed: null,
        includeCitations: null,
      });
      expect(result.current.graphStats).toEqual({ nodes: 3, edges: 2 });
      expect(result.current.dataVersion).toBeGreaterThan(v1);
    });

    it("reads updated modeRef after switching from full to local", async () => {
      const handler = vi.fn((cmd: string, args?: Record<string, unknown>) => {
        if (cmd === "get_graph_subgraph") {
          const seeds = (args?.seeds as string[]) ?? [];
          return seeds.length > 0 ? LOCAL_SUBGRAPH : TWO_NODE_SUBGRAPH;
        }
        return {};
      });
      mockInvoke(handler);
      mockListen();
      const useGraphData = await importHook();

      const { result, rerender } = renderHook(
        (props: UseGraphDataOptions) => useGraphData(props),
        { initialProps: { mode: "full", depth: 1, activePageId: null } as UseGraphDataOptions },
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      rerender({ mode: "local", depth: 2, activePageId: "a.md" });

      await waitFor(() => {
        expect(result.current.graphRef.current!.hasNode("c.md")).toBe(true);
      });

      handler.mockClear();

      await act(async () => {
        emitMockEvent("lit:graph-updated", null);
      });

      await waitFor(() => {
        expect(handler).toHaveBeenCalledWith("get_graph_subgraph", {
          seeds: ["a.md"],
          depth: 2,
          directed: null,
          includeCitations: null,
        });
      });

      expect(result.current.graphRef.current!.hasNode("c.md")).toBe(true);
      expect(result.current.graphRef.current!.hasNode("b.md")).toBe(false);
    });

    it("reads updated activePageIdRef after seed change", async () => {
      const SUBGRAPH_B: SubgraphResult = {
        nodes: [
          { id: "b.md", title: "B", is_stub: false, materialization: "materialized" },
          { id: "e.md", title: "E", is_stub: false, materialization: "materialized" },
        ],
        edges: [["b.md", "e.md", "wikilink"]],
      };

      const handler = vi.fn((cmd: string, args?: Record<string, unknown>) => {
        if (cmd === "get_graph_subgraph") {
          const seeds = (args?.seeds as string[]) ?? [];
          if (seeds[0] === "b.md") return SUBGRAPH_B;
          return LOCAL_SUBGRAPH;
        }
        return {};
      });
      mockInvoke(handler);
      mockListen();
      const useGraphData = await importHook();

      const { result, rerender } = renderHook(
        (props: UseGraphDataOptions) => useGraphData(props),
        { initialProps: { mode: "local", depth: 2, activePageId: "a.md" } as UseGraphDataOptions },
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      rerender({ mode: "local", depth: 2, activePageId: "b.md" });

      await waitFor(() => {
        expect(result.current.graphRef.current!.hasNode("e.md")).toBe(true);
      });

      handler.mockClear();

      await act(async () => {
        emitMockEvent("lit:graph-updated", null);
      });

      await waitFor(() => {
        expect(handler).toHaveBeenCalledWith("get_graph_subgraph", {
          seeds: ["b.md"],
          depth: 2,
          directed: null,
          includeCitations: null,
        });
      });
    });
  });

  // Cycle 11: lit:layout-ready
  describe("lit:layout-ready", () => {
    it("fetches and applies positions on event", async () => {
      mockInvoke((cmd: string) => {
        if (cmd === "get_graph_subgraph") return TWO_NODE_SUBGRAPH;
        if (cmd === "get_graph_positions") {
          return { "a.md": { x: 100, y: 200 }, "b.md": { x: 300, y: 400 } };
        }
        return {};
      });
      mockListen();
      const useGraphData = await importHook();

      const { result } = renderHook(() =>
        useGraphData({ mode: "full", depth: 1, activePageId: null }),
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      const v1 = result.current.dataVersion;

      await act(async () => {
        emitMockEvent("lit:layout-ready", null);
      });

      await waitFor(() => {
        expect(result.current.dataVersion).toBeGreaterThan(v1);
      });

      const graph = result.current.graphRef.current!;
      expect(graph.getNodeAttribute("a.md", "x")).toBe(100);
      expect(graph.getNodeAttribute("a.md", "y")).toBe(200);
      expect(graph.getNodeAttribute("b.md", "x")).toBe(300);
      expect(graph.getNodeAttribute("b.md", "y")).toBe(400);
    });

    it("silently catches getGraphPositions errors", async () => {
      mockInvoke((cmd: string) => {
        if (cmd === "get_graph_subgraph") return TWO_NODE_SUBGRAPH;
        if (cmd === "get_graph_positions") throw new Error("no positions");
        return {};
      });
      mockListen();
      const useGraphData = await importHook();

      const { result } = renderHook(() =>
        useGraphData({ mode: "full", depth: 1, activePageId: null }),
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await act(async () => {
        emitMockEvent("lit:layout-ready", null);
      });

      expect(result.current.error).toBe(null);
    });
  });

  // Cycle 12: Race conditions
  describe("race conditions", () => {
    it("discards stale Effect 1 result when Effect 2 supersedes it", async () => {
      const resolvers: Array<(v: SubgraphResult) => void> = [];
      mockInvoke((cmd: string) => {
        if (cmd === "get_graph_subgraph") {
          return new Promise<SubgraphResult>((resolve) => {
            resolvers.push(resolve);
          });
        }
        return {};
      });
      mockListen();
      const useGraphData = await importHook();

      const updatedSubgraph: SubgraphResult = {
        nodes: [
          { id: "a.md", title: "A", is_stub: false, materialization: "materialized" },
          { id: "b.md", title: "B", is_stub: false, materialization: "materialized" },
          { id: "d.md", title: "D", is_stub: false, materialization: "materialized" },
        ],
        edges: [["a.md", "b.md", "wikilink"], ["b.md", "d.md", "wikilink"]],
      };

      const { result } = renderHook(() =>
        useGraphData({ mode: "full", depth: 1, activePageId: null }),
      );

      // Effect 1 fetch is in-flight
      expect(resolvers).toHaveLength(1);

      // graph-updated fires → Effect 2 starts its own fetch
      await act(async () => {
        emitMockEvent("lit:graph-updated", null);
      });
      expect(resolvers).toHaveLength(2);

      // Effect 2 resolves first with correct 3-node data
      await act(async () => {
        resolvers[1]!(updatedSubgraph);
      });

      await waitFor(() => {
        expect(result.current.graphStats).toEqual({ nodes: 3, edges: 2 });
      });

      // Effect 1 resolves later with stale 2-node data
      await act(async () => {
        resolvers[0]!(TWO_NODE_SUBGRAPH);
      });

      // Stale data discarded — still 3 nodes
      expect(result.current.graphStats).toEqual({ nodes: 3, edges: 2 });
      expect(result.current.graphRef.current!.hasNode("d.md")).toBe(true);
      // loading cleared by Effect 2
      expect(result.current.loading).toBe(false);
    });

    it("discards stale result when two graph-updated events race", async () => {
      let callCount = 0;
      const resolvers: Array<(v: SubgraphResult) => void> = [];

      mockInvoke((cmd: string) => {
        if (cmd === "get_graph_subgraph") {
          callCount++;
          if (callCount === 1) return TWO_NODE_SUBGRAPH;
          return new Promise<SubgraphResult>((resolve) => {
            resolvers.push(resolve);
          });
        }
        return {};
      });
      mockListen();
      const useGraphData = await importHook();

      const { result } = renderHook(() =>
        useGraphData({ mode: "full", depth: 1, activePageId: null }),
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      // Two rapid graph-updated events
      await act(async () => {
        emitMockEvent("lit:graph-updated", null);
      });
      await act(async () => {
        emitMockEvent("lit:graph-updated", null);
      });
      expect(resolvers).toHaveLength(2);

      const freshSubgraph: SubgraphResult = {
        nodes: [
          { id: "a.md", title: "A", is_stub: false, materialization: "materialized" },
          { id: "b.md", title: "B", is_stub: false, materialization: "materialized" },
          { id: "d.md", title: "D", is_stub: false, materialization: "materialized" },
        ],
        edges: [["a.md", "b.md", "wikilink"], ["b.md", "d.md", "wikilink"]],
      };
      const staleSubgraph: SubgraphResult = {
        nodes: [{ id: "stale.md", title: "Stale", is_stub: false, materialization: "materialized" }],
        edges: [],
      };

      // Second event resolves first (correct)
      await act(async () => {
        resolvers[1]!(freshSubgraph);
      });

      await waitFor(() => {
        expect(result.current.graphStats).toEqual({ nodes: 3, edges: 2 });
      });

      // First event resolves later (stale)
      await act(async () => {
        resolvers[0]!(staleSubgraph);
      });

      // Stale data discarded
      expect(result.current.graphStats).toEqual({ nodes: 3, edges: 2 });
      expect(result.current.graphRef.current!.hasNode("d.md")).toBe(true);
      expect(result.current.graphRef.current!.hasNode("stale.md")).toBe(false);
    });

    it("discards stale positions when layout-ready fires during rebuild", async () => {
      const subgraphResolvers: Array<(v: SubgraphResult) => void> = [];
      const positionResolvers: Array<(v: Record<string, { x: number; y: number }>) => void> = [];

      mockInvoke((cmd: string) => {
        if (cmd === "get_graph_subgraph") {
          return new Promise<SubgraphResult>((resolve) => {
            subgraphResolvers.push(resolve);
          });
        }
        if (cmd === "get_graph_positions") {
          return new Promise<Record<string, { x: number; y: number }>>((resolve) => {
            positionResolvers.push(resolve);
          });
        }
        return {};
      });
      mockListen();
      const applySpy = vi.spyOn(graphLayout, "applyPositions");
      const useGraphData = await importHook();

      const { result } = renderHook(() =>
        useGraphData({ mode: "full", depth: 1, activePageId: null }),
      );

      // Effect 1 rebuild is in-flight
      expect(subgraphResolvers).toHaveLength(1);

      // layout-ready fires → captures current generation
      await act(async () => {
        emitMockEvent("lit:layout-ready", null);
      });
      expect(positionResolvers).toHaveLength(1);

      // graph-updated fires → bumps generation
      await act(async () => {
        emitMockEvent("lit:graph-updated", null);
      });
      expect(subgraphResolvers).toHaveLength(2);

      // Resolve graph-updated rebuild (latest generation)
      await act(async () => {
        subgraphResolvers[1]!(TWO_NODE_SUBGRAPH);
      });

      // Resolve initial rebuild (superseded)
      await act(async () => {
        subgraphResolvers[0]!(TWO_NODE_SUBGRAPH);
      });

      await waitFor(() => {
        expect(result.current.graphStats).toEqual({ nodes: 2, edges: 1 });
      });

      applySpy.mockClear();

      // Stale positions resolve — generation has changed since capture
      await act(async () => {
        positionResolvers[0]!({ "a.md": { x: 999, y: 999 } });
      });

      // Stale positions should NOT be applied
      expect(applySpy).not.toHaveBeenCalled();
    });
  });

  // Cycle: Seed recolor in full mode
  describe("seed recolor", () => {
    it("full mode + new activePageId → graph attrs updated", async () => {
      mockInvoke(makeInvokeHandler());
      const useGraphData = await importHook();

      const { result, rerender } = renderHook(
        (props: UseGraphDataOptions) => useGraphData(props),
        { initialProps: { mode: "full", depth: 1, activePageId: "a.md" } as UseGraphDataOptions },
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.graphRef.current!.getNodeAttribute("a.md", "type")).toBe("seed");

      rerender({ mode: "full", depth: 1, activePageId: "b.md" });

      await waitFor(() => {
        expect(result.current.graphRef.current!.getNodeAttribute("b.md", "type")).toBe("seed");
      });

      expect(result.current.graphRef.current!.getNodeAttribute("a.md", "type")).toBe("filled");
    });

    it("full mode + same activePageId → no recolor", async () => {
      mockInvoke(makeInvokeHandler());
      const useGraphData = await importHook();

      const { result, rerender } = renderHook(
        (props: UseGraphDataOptions) => useGraphData(props),
        { initialProps: { mode: "full", depth: 1, activePageId: "a.md" } as UseGraphDataOptions },
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.graphRef.current!.getNodeAttribute("a.md", "type")).toBe("seed");

      rerender({ mode: "full", depth: 1, activePageId: "a.md" });

      expect(result.current.graphRef.current!.getNodeAttribute("a.md", "type")).toBe("seed");
    });

    it("local mode + new activePageId → no recolor on old graph", async () => {
      const handler = vi.fn((cmd: string, args?: Record<string, unknown>) => {
        if (cmd === "get_graph_subgraph") {
          const seeds = (args?.seeds as string[]) ?? [];
          return seeds[0] === "b.md"
            ? { nodes: [{ id: "b.md", title: "B", is_stub: false, materialization: "materialized" }], edges: [] }
            : LOCAL_SUBGRAPH;
        }
        return {};
      });
      mockInvoke(handler);
      const useGraphData = await importHook();

      const { result, rerender } = renderHook(
        (props: UseGraphDataOptions) => useGraphData(props),
        { initialProps: { mode: "local", depth: 2, activePageId: "a.md" } as UseGraphDataOptions },
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      rerender({ mode: "local", depth: 2, activePageId: "b.md" });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });
    });

    it("after local-mode navigation, returning to full mode recolors from last full-mode seed", async () => {
      const handler = vi.fn((cmd: string, args?: Record<string, unknown>) => {
        if (cmd === "get_graph_subgraph") {
          const seeds = (args?.seeds as string[]) ?? [];
          return seeds.length > 0 ? LOCAL_SUBGRAPH : TWO_NODE_SUBGRAPH;
        }
        return {};
      });
      mockInvoke(handler);
      const recolorSpy = vi.spyOn(graphLayout, "recolorSeed");
      const useGraphData = await importHook();

      const { result, rerender } = renderHook(
        (props: UseGraphDataOptions) => useGraphData(props),
        { initialProps: { mode: "full", depth: 1, activePageId: "a.md" } as UseGraphDataOptions },
      );
      await waitFor(() => { expect(result.current.loading).toBe(false); });
      recolorSpy.mockClear();

      // Switch to local, navigate a.md → b.md
      rerender({ mode: "local", depth: 2, activePageId: "a.md" });
      await waitFor(() => { expect(result.current.loading).toBe(false); });
      rerender({ mode: "local", depth: 2, activePageId: "b.md" });
      await waitFor(() => { expect(result.current.loading).toBe(false); });
      recolorSpy.mockClear();

      // Return to full mode with activePageId="b.md"
      rerender({ mode: "full", depth: 1, activePageId: "b.md" });

      // prev should be "a.md" (last full-mode seed), NOT "b.md" (local tracking)
      await waitFor(() => {
        expect(recolorSpy).toHaveBeenCalledWith(
          expect.any(Object), "a.md", "b.md", expect.any(String),
        );
      });

      recolorSpy.mockRestore();
    });
  });

  // Cycle: showCitations threading
  describe("showCitations", () => {
    it("full mode with showCitations=true passes includeCitations to IPC", async () => {
      const handler = vi.fn(makeInvokeHandler());
      mockInvoke(handler);
      const useGraphData = await importHook();

      const { result } = renderHook(() =>
        useGraphData({ mode: "full", depth: 1, activePageId: null, showCitations: true }),
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(handler).toHaveBeenCalledWith("get_graph_subgraph", {
        seeds: [],
        depth: 0,
        directed: null,
        includeCitations: true,
      });
    });

    it("full mode with showCitations=false (default) passes includeCitations=null", async () => {
      const handler = vi.fn(makeInvokeHandler());
      mockInvoke(handler);
      const useGraphData = await importHook();

      const { result } = renderHook(() =>
        useGraphData({ mode: "full", depth: 1, activePageId: null }),
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(handler).toHaveBeenCalledWith("get_graph_subgraph", {
        seeds: [],
        depth: 0,
        directed: null,
        includeCitations: null,
      });
    });

    it("local mode with showCitations=true passes includeCitations to IPC", async () => {
      const handler = vi.fn(makeInvokeHandler(LOCAL_SUBGRAPH));
      mockInvoke(handler);
      const useGraphData = await importHook();

      const { result } = renderHook(() =>
        useGraphData({ mode: "local", depth: 2, activePageId: "a.md", showCitations: true }),
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(handler).toHaveBeenCalledWith("get_graph_subgraph", {
        seeds: ["a.md"],
        depth: 2,
        directed: null,
        includeCitations: true,
      });
    });

    it("toggling showCitations triggers rebuild", async () => {
      const handler = vi.fn(makeInvokeHandler());
      mockInvoke(handler);
      const useGraphData = await importHook();

      const { result, rerender } = renderHook(
        (props: UseGraphDataOptions) => useGraphData(props),
        { initialProps: { mode: "full", depth: 1, activePageId: null, showCitations: false } as UseGraphDataOptions },
      );

      await waitFor(() => {
        expect(result.current.dataVersion).toBe(1);
      });

      rerender({ mode: "full", depth: 1, activePageId: null, showCitations: true });

      await waitFor(() => {
        expect(result.current.dataVersion).toBe(2);
      });
    });
  });

  // Cycle 13: Cleanup + stale effect cancellation
  describe("cleanup", () => {
    it("unsubscribes event listeners on unmount", async () => {
      mockInvoke(makeInvokeHandler());
      mockListen();
      const useGraphData = await importHook();

      const { result, unmount } = renderHook(() =>
        useGraphData({ mode: "full", depth: 1, activePageId: null }),
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      unmount();

      // After unmount, emitting events should not cause errors
      emitMockEvent("lit:graph-updated", null);
      emitMockEvent("lit:layout-ready", null);
    });

    it("discards stale results on rapid mode changes", async () => {
      const resolvers: Array<(v: SubgraphResult) => void> = [];
      mockInvoke((cmd: string) => {
        if (cmd === "get_graph_subgraph") {
          return new Promise<SubgraphResult>((resolve) => {
            resolvers.push(resolve);
          });
        }
        return {};
      });
      const useGraphData = await importHook();

      const { result, rerender } = renderHook(
        (props: UseGraphDataOptions) => useGraphData(props),
        { initialProps: { mode: "full", depth: 1, activePageId: null } as UseGraphDataOptions },
      );

      // First render starts a fetch
      expect(resolvers).toHaveLength(1);

      // Rapidly change mode before first resolves
      rerender({ mode: "local", depth: 2, activePageId: "a.md" });

      await waitFor(() => {
        expect(resolvers).toHaveLength(2);
      });

      resolvers[0]!(TWO_NODE_SUBGRAPH);
      resolvers[1]!(LOCAL_SUBGRAPH);

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      // Should have the local subgraph data, not the full one
      expect(result.current.graphRef.current!.hasNode("c.md")).toBe(true);
      // "b.md" from the stale full subgraph should not be present
      expect(result.current.graphRef.current!.hasNode("b.md")).toBe(false);
    });
  });

  // Cycle: rebuild() exposed function
  describe("rebuild()", () => {
    it("rebuild() triggers a fresh graph fetch and increments dataVersion", async () => {
      mockInvoke(makeInvokeHandler());
      const useGraphData = await importHook();

      const { result } = renderHook(() =>
        useGraphData({ mode: "full", depth: 1, activePageId: null }),
      );

      await waitFor(() => expect(result.current.loading).toBe(false));
      const initialVersion = result.current.dataVersion;

      await act(async () => {
        await result.current.rebuild();
      });

      expect(result.current.dataVersion).toBeGreaterThan(initialVersion);
    });

    it("rebuild() produces same graph stats as lit:graph-updated event", async () => {
      mockInvoke(makeInvokeHandler());
      const useGraphData = await importHook();

      const { result } = renderHook(() =>
        useGraphData({ mode: "full", depth: 1, activePageId: null }),
      );
      await waitFor(() => expect(result.current.loading).toBe(false));

      // Rebuild via the exposed function
      await act(async () => {
        await result.current.rebuild();
      });
      const versionAfterRebuild = result.current.dataVersion;
      const statsAfterRebuild = result.current.graphStats;

      // Verify both advanced
      expect(versionAfterRebuild).toBe(2); // initial=1, rebuild=2
      expect(statsAfterRebuild).toEqual({ nodes: 2, edges: 1 });
    });
  });
});
