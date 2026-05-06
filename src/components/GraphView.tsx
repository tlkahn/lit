import { useEffect, useRef, useState, useCallback } from "react";
import { getFullSubgraph, getGraphSubgraph, getPagerank } from "../lib/ipc";
import type { SubgraphResult } from "../lib/ipc";
import { buildGraph, resolveThemeColors, prefersReducedMotion } from "../lib/graphLayout";
import { useThemeStore } from "../stores/theme";
import { checkConvergence, type PositionMap, type ConvergenceState } from "../lib/graphConvergence";
import { isPerfEnabled, perfTable, type PerfEntry } from "../lib/perf";
import { FpsCounter } from "../lib/fpsCounter";
import { GraphToolbar } from "./GraphToolbar";
import { GraphTooltip } from "./GraphTooltip";
import { GraphSearch, getMatchingNodes } from "./GraphSearch";
import "./GraphSearch.css";
import "./GraphView.css";

export interface GraphViewProps {
  activePageId?: string | null;
  initialMode?: "full" | "local";
  onNavigate?: (pageId: string) => void;
  onExit?: () => void;
}

export default function GraphView({ activePageId, initialMode, onNavigate, onExit }: GraphViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sigmaRef = useRef<unknown>(null);
  const graphRef = useRef<unknown>(null);
  const layoutRef = useRef<{ start: () => void; stop: () => void; kill: () => void } | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const convergenceIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const perfFpsRef = useRef<FpsCounter | null>(null);
  const perfTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hoveredNodeRef = useRef<string | null>(null);
  const rafIdRef = useRef<number>(0);
  const pendingPosRef = useRef<{ x: number; y: number } | null>(null);
  const dimColorRef = useRef("#d1d9e0");
  const onNavigateRef = useRef(onNavigate);
  onNavigateRef.current = onNavigate;
  const onExitRef = useRef(onExit);
  onExitRef.current = onExit;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"full" | "local">(initialMode ?? "full");
  const [depth, setDepth] = useState(2);
  const [tooltip, setTooltip] = useState({ visible: false, x: 0, y: 0, title: "", connections: 0 });
  const [searchOpen, setSearchOpen] = useState(false);
  const searchOpenRef = useRef(false);
  useEffect(() => { searchOpenRef.current = searchOpen; }, [searchOpen]);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchMatches, setSearchMatches] = useState<string[]>([]);
  const [graphStats, setGraphStats] = useState<{ nodes: number; edges: number } | null>(null);

  const handleResetZoom = useCallback(() => {
    const sigma = sigmaRef.current as { getCamera: () => { animatedReset: () => void } } | null;
    sigma?.getCamera().animatedReset();
  }, []);

  const handleSearchQueryChange = useCallback((query: string) => {
    setSearchQuery(query);
    const graph = graphRef.current as import("graphology").default | null;
    const sigma = sigmaRef.current as { setSetting: (key: string, value: unknown) => void; getCamera: () => { animate: (state: Record<string, number>) => void }; getNodeDisplayData: (node: string) => { x: number; y: number } | undefined } | null;
    if (!graph || !sigma) return;
    if (!query) {
      setSearchMatches([]);
      sigma.setSetting("nodeReducer", null);
      sigma.setSetting("edgeReducer", null);
      return;
    }
    const matches = getMatchingNodes(graph, query);
    setSearchMatches(matches);
    const matchSet = new Set(matches);
    sigma.setSetting("nodeReducer", (_n: string, attrs: Record<string, unknown>) => {
      if (matchSet.has(_n)) return { ...attrs, highlighted: true };
      return { ...attrs, color: dimColorRef.current, label: null };
    });
    sigma.setSetting("edgeReducer", (_e: string, attrs: Record<string, unknown>) => {
      const src = graph.source(_e);
      const tgt = graph.target(_e);
      if (matchSet.has(src) || matchSet.has(tgt)) return attrs;
      return { ...attrs, hidden: true };
    });
    if (matches.length === 1) {
      const pos = sigma.getNodeDisplayData(matches[0]!);
      if (pos) sigma.getCamera().animate({ x: pos.x, y: pos.y, ratio: 0.5 });
    }
  }, []);

  const handleSearchClose = useCallback(() => {
    setSearchOpen(false);
    setSearchQuery("");
    setSearchMatches([]);
    const sigma = sigmaRef.current as { setSetting: (key: string, value: unknown) => void } | null;
    if (sigma) {
      sigma.setSetting("nodeReducer", null);
      sigma.setSetting("edgeReducer", null);
    }
  }, []);

  const handleSearchNavigate = useCallback((nodeId: string) => {
    onNavigateRef.current?.(nodeId);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function init() {
      try {
        setLoading(true);
        setError(null);
        const perf = isPerfEnabled();
        const perfEntries: PerfEntry[] = [];

        let t0 = perf ? performance.now() : 0;
        let subgraph: SubgraphResult;
        if (mode === "local" && activePageId) {
          subgraph = await getGraphSubgraph([activePageId], depth);
        } else {
          subgraph = await getFullSubgraph();
        }
        const pagerank = await getPagerank();
        if (perf) {
          const ipcMs = performance.now() - t0;
          const payloadSize = JSON.stringify(subgraph).length + JSON.stringify(pagerank).length;
          perfEntries.push({ label: "IPC fetch", value: ipcMs, detail: `${(payloadSize / 1024).toFixed(1)} kB` });
        }

        if (cancelled) return;

        const { accentColor, stubColor, dimColor } = resolveThemeColors();
        dimColorRef.current = dimColor;
        t0 = perf ? performance.now() : 0;
        const graph = buildGraph({
          subgraph,
          pagerank,
          accentColor,
          stubColor,
          seedId: mode === "local" ? (activePageId ?? undefined) : undefined,
        });
        if (perf) {
          perfEntries.push({ label: "Graphology build", value: performance.now() - t0, detail: `${graph.order} nodes, ${graph.size} edges` });
        }

        if (!containerRef.current || cancelled) return;

        const { default: Sigma } = await import("sigma");
        const { createNodeBorderProgram } = await import("@sigma/node-border");
        const FA2Layout = (await import("graphology-layout-forceatlas2/worker")).default;
        const { inferSettings } = await import("graphology-layout-forceatlas2");
        const { random } = await import("graphology-layout");

        if (cancelled || !containerRef.current) return;

        random.assign(graph);

        const filledProgram = createNodeBorderProgram({
          borders: [{ size: { value: 0.15, mode: "relative" }, color: { attribute: "color" } }],
        });
        const hollowProgram = createNodeBorderProgram({
          borders: [
            { size: { value: 0.15, mode: "relative" }, color: { attribute: "color" } },
            { size: { fill: true }, color: { transparent: true } },
          ],
        });
        const seedProgram = createNodeBorderProgram({
          borders: [{ size: { value: 0.3, mode: "relative" }, color: { attribute: "color" } }],
        });

        const sigmaT0 = perf ? performance.now() : 0;
        const sigma = new Sigma(graph, containerRef.current, {
          nodeProgramClasses: { filled: filledProgram, hollow: hollowProgram, seed: seedProgram },
          hideEdgesOnMove: true,
          labelRenderedSizeThreshold: 6,
          enableEdgeEvents: false,
        });
        sigmaRef.current = sigma;
        graphRef.current = graph;

        if (perf) {
          sigma.on("afterRender", function onFirstRender() {
            perfEntries.push({ label: "Sigma first paint", value: performance.now() - sigmaT0 });
            sigma.off("afterRender", onFirstRender);
          });
        }

        sigma.on("clickNode", ({ node }) => {
          onNavigateRef.current?.(node);
        });

        sigma.on("enterNode", ({ node, event }) => {
          hoveredNodeRef.current = node;
          const neighbors = new Set(graph.neighbors(node));
          neighbors.add(node);

          sigma.setSetting("nodeReducer", (_n: string, attrs: Record<string, unknown>) => {
            if (neighbors.has(_n)) return attrs;
            return { ...attrs, color: dimColorRef.current, label: null };
          });
          sigma.setSetting("edgeReducer", (_e: string, attrs: Record<string, unknown>) => {
            const src = graph.source(_e);
            const tgt = graph.target(_e);
            if (neighbors.has(src) && neighbors.has(tgt)) return attrs;
            return { ...attrs, hidden: true };
          });

          if (containerRef.current) {
            containerRef.current.style.cursor = "pointer";
          }

          const mouseEvent = event as { x?: number; y?: number } | undefined;
          setTooltip({
            visible: true,
            x: (mouseEvent?.x ?? 0) + 10,
            y: (mouseEvent?.y ?? 0) + 10,
            title: (graph.getNodeAttribute(node, "label") as string) || node,
            connections: graph.degree(node),
          });
        });

        sigma.on("moveBody", ({ event }) => {
          if (hoveredNodeRef.current) {
            const mouseEvent = event as { x?: number; y?: number } | undefined;
            pendingPosRef.current = { x: (mouseEvent?.x ?? 0) + 10, y: (mouseEvent?.y ?? 0) + 10 };
            if (!rafIdRef.current) {
              rafIdRef.current = requestAnimationFrame(() => {
                rafIdRef.current = 0;
                const pos = pendingPosRef.current;
                pendingPosRef.current = null;
                if (pos) {
                  setTooltip((t) => ({ ...t, ...pos }));
                }
              });
            }
          }
        });

        sigma.on("leaveNode", () => {
          hoveredNodeRef.current = null;
          cancelAnimationFrame(rafIdRef.current);
          rafIdRef.current = 0;
          pendingPosRef.current = null;
          sigma.setSetting("nodeReducer", null);
          sigma.setSetting("edgeReducer", null);
          if (containerRef.current) {
            containerRef.current.style.cursor = "grab";
          }
          setTooltip((t) => ({ ...t, visible: false }));
        });

        sigma.on("clickStage", () => {
          sigma.setSetting("nodeReducer", null);
          sigma.setSetting("edgeReducer", null);
        });

        if (prefersReducedMotion()) {
          const forceAtlas2 = await import("graphology-layout-forceatlas2");
          t0 = perf ? performance.now() : 0;
          forceAtlas2.default.assign(graph, { iterations: 100, settings: inferSettings(graph) });
          if (perf) {
            perfEntries.push({ label: "FA2 (sync)", value: performance.now() - t0 });
            perfEntries.push({ label: "Steady-state FPS", value: 0, unit: "fps", detail: "N/A (reduced motion)" });
            perfEntries.push({ label: "JS heap", value: 0, detail: "Use Safari Web Inspector > Timelines > JS Allocations" });
            perfTable("graph-init", perfEntries);
          }
        } else {
          const layout = new FA2Layout(graph, { settings: inferSettings(graph) });
          const fa2T0 = perf ? performance.now() : 0;
          layout.start();
          layoutRef.current = layout;

          let convergenceState: ConvergenceState = { consecutiveLow: 0 };
          let prevPositions: PositionMap = {};

          const stopLayout = () => {
            layout.stop();
            if (perf) {
              perfEntries.push({ label: "FA2 convergence", value: performance.now() - fa2T0 });
              const fpsCounter = new FpsCounter();
              perfFpsRef.current = fpsCounter;
              fpsCounter.start();
              perfTimerRef.current = setTimeout(() => {
                perfFpsRef.current = null;
                perfTimerRef.current = null;
                const stats = fpsCounter.stop();
                perfEntries.push({ label: "Steady-state FPS", value: stats.avg, unit: "fps", detail: `min=${stats.min.toFixed(0)} max=${stats.max.toFixed(0)} samples=${stats.samples}` });
                perfEntries.push({ label: "JS heap", value: 0, detail: "Use Safari Web Inspector > Timelines > JS Allocations" });
                perfTable("graph-init", perfEntries);
              }, 3000);
            }
            sigma.getCamera().animatedReset();
            if (convergenceIntervalRef.current) {
              clearInterval(convergenceIntervalRef.current);
              convergenceIntervalRef.current = null;
            }
            if (timerRef.current) {
              clearTimeout(timerRef.current);
              timerRef.current = null;
            }
          };

          convergenceIntervalRef.current = setInterval(() => {
            const currentPositions: PositionMap = {};
            graph.forEachNode((node: string, attrs: Record<string, unknown>) => {
              currentPositions[node] = { x: attrs.x as number, y: attrs.y as number };
            });
            const result = checkConvergence(prevPositions, currentPositions, convergenceState);
            convergenceState = result.state;
            prevPositions = currentPositions;
            if (result.converged) {
              stopLayout();
            }
          }, 200);

          timerRef.current = setTimeout(() => {
            stopLayout();
          }, 5000);
        }

        setGraphStats({ nodes: graph.order, edges: graph.size });
        setLoading(false);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load graph");
          setLoading(false);
        }
      }
    }

    init();

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = 0;
      pendingPosRef.current = null;
      if (convergenceIntervalRef.current) {
        clearInterval(convergenceIntervalRef.current);
        convergenceIntervalRef.current = null;
      }
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      if (perfTimerRef.current) {
        clearTimeout(perfTimerRef.current);
        perfTimerRef.current = null;
      }
      if (perfFpsRef.current) {
        perfFpsRef.current.stop();
        perfFpsRef.current = null;
      }
      if (layoutRef.current) {
        layoutRef.current.kill();
        layoutRef.current = null;
      }
      if (sigmaRef.current) {
        (sigmaRef.current as { kill: () => void }).kill();
        sigmaRef.current = null;
      }
      graphRef.current = null;
    };
  }, [mode, depth, activePageId]);

  const activeThemeId = useThemeStore((s) => s.activeThemeId);

  useEffect(() => {
    const graph = graphRef.current as import("graphology").default | null;
    const sigma = sigmaRef.current as { refresh: () => void; setSetting: (key: string, value: unknown) => void } | null;
    if (!graph || !sigma) return;
    const { accentColor, stubColor, dimColor, edgeColor, labelColor } = resolveThemeColors();
    dimColorRef.current = dimColor;
    graph.forEachNode((node: string, attrs: Record<string, unknown>) => {
      if (attrs.type === "seed") return;
      graph.setNodeAttribute(node, "color", attrs.type === "hollow" ? stubColor : accentColor);
    });
    sigma.setSetting("defaultEdgeColor", edgeColor);
    sigma.setSetting("labelColor", { color: labelColor });
    sigma.refresh();
  }, [activeThemeId]);

  const handleContainerKeyDown = useCallback((e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "f") {
      e.preventDefault();
      setSearchOpen(true);
    } else if (e.key === "Escape") {
      if (!searchOpenRef.current) {
        onExitRef.current?.();
      }
    }
  }, []);

  return (
    <div
      data-testid="graph-view"
      className="graph-view-container"
      onKeyDown={handleContainerKeyDown}
      tabIndex={-1}
      aria-label={
        graphStats
          ? `Knowledge graph with ${graphStats.nodes} node${graphStats.nodes === 1 ? '' : 's'} and ${graphStats.edges} edge${graphStats.edges === 1 ? '' : 's'}. Use mouse to explore, click a node to open it.`
          : "Knowledge graph loading"
      }
    >
      {loading && (
        <div data-testid="graph-loading" className="graph-loading">
          Loading graph…
        </div>
      )}
      {error && (
        <div data-testid="graph-error" className="graph-error">
          {error}
        </div>
      )}
      <GraphToolbar
        mode={mode}
        depth={depth}
        localDisabled={!activePageId}
        onModeChange={setMode}
        onDepthChange={setDepth}
        onResetZoom={handleResetZoom}
        onSearch={() => setSearchOpen(true)}
      />
      <GraphSearch
        visible={searchOpen}
        query={searchQuery}
        matchCount={searchMatches.length}
        firstMatchId={searchMatches[0]}
        onQueryChange={handleSearchQueryChange}
        onNavigate={handleSearchNavigate}
        onClose={handleSearchClose}
      />
      <GraphTooltip {...tooltip} />
      <div ref={containerRef} data-testid="graph-canvas" style={{ position: "absolute", inset: 0, cursor: "grab" }} />
    </div>
  );
}
