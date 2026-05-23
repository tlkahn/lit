import { useEffect, useRef, useState, useCallback } from "react";
import { getFullSubgraph, getGraphSubgraph, getGraphPositions } from "../lib/ipc";
import type { SubgraphResult } from "../lib/ipc";
import { listen } from "@tauri-apps/api/event";
import { buildGraph, resolveThemeColors, applyPositions } from "../lib/graphLayout";
import { getQualitySettings, getTierSettings, type TierSettings } from "../lib/qualityTiers";
import { useThemeStore } from "../stores/theme";
import { computeDiff, applyDiff, isDiffEmpty } from "../lib/graphDiff";
import { isPerfEnabled, perfTable, type PerfEntry } from "../lib/perf";
import { GraphToolbar } from "./GraphToolbar";
import { GraphTooltip } from "./GraphTooltip";
import { GraphSearch, getMatchingNodes } from "./GraphSearch";
import "./GraphSearch.css";
import "./GraphView.css";

export interface GraphViewProps {
  activePageId?: string | null;
  initialMode?: "full" | "local";
  visible?: boolean;
  onNavigate?: (pageId: string) => void;
  onExit?: () => void;
  onExportNetwork?: (nodeId: string) => void;
}

export default function GraphView({ activePageId, initialMode, visible = true, onNavigate, onExit, onExportNetwork }: GraphViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sigmaRef = useRef<unknown>(null);
  const graphRef = useRef<unknown>(null);
  const hoveredNodeRef = useRef<string | null>(null);
  const rafIdRef = useRef<number>(0);
  const pendingPosRef = useRef<{ x: number; y: number } | null>(null);
  const dimColorRef = useRef("#d1d9e0");
  const defaultNodeReducer = useCallback((_n: string, attrs: Record<string, unknown>) => ({ ...attrs, label: null }), []);
  const tierSettingsRef = useRef<TierSettings>(getTierSettings("medium"));
  const onNavigateRef = useRef(onNavigate);
  onNavigateRef.current = onNavigate;
  const onExitRef = useRef(onExit);
  onExitRef.current = onExit;
  const onExportNetworkRef = useRef(onExportNetwork);
  onExportNetworkRef.current = onExportNetwork;
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  const lastRenderedSeedRef = useRef<string | null>(null);
  const pendingRefreshRef = useRef(false);
  const pendingThemeUpdateRef = useRef(false);
  const diffInProgressRef = useRef(false);
  const modeRef = useRef(initialMode ?? "full");
  const depthRef = useRef(2);
  const activePageIdRef = useRef(activePageId);
  activePageIdRef.current = activePageId;
  const [reinitTrigger, setReinitTrigger] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"full" | "local">(initialMode ?? "full");
  modeRef.current = mode;
  const [depth, setDepth] = useState(2);
  depthRef.current = depth;
  const [tooltip, setTooltip] = useState({ visible: false, x: 0, y: 0, title: "", connections: 0 });
  const [searchOpen, setSearchOpen] = useState(false);
  const searchOpenRef = useRef(false);
  useEffect(() => { searchOpenRef.current = searchOpen; }, [searchOpen]);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchMatches, setSearchMatches] = useState<string[]>([]);
  const [graphStats, setGraphStats] = useState<{ nodes: number; edges: number } | null>(null);
  const [contextMenu, setContextMenu] = useState<{ nodeId: string; x: number; y: number } | null>(null);
  const contextMenuOpenRef = useRef(false);
  useEffect(() => { contextMenuOpenRef.current = contextMenu !== null; }, [contextMenu]);

  useEffect(() => {
    if (!contextMenu) return;
    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest?.("[data-graph-context-menu]")) return;
      setContextMenu(null);
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setContextMenu(null);
    };
    document.addEventListener("pointerdown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("pointerdown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [contextMenu]);

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
      sigma.setSetting("nodeReducer", defaultNodeReducer);
      sigma.setSetting("edgeReducer",
        tierSettingsRef.current.defaultEdgesHidden
          ? (_e: string, attrs: Record<string, unknown>) => ({ ...attrs, hidden: true })
          : null
      );
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
      sigma.setSetting("nodeReducer", defaultNodeReducer);
      sigma.setSetting("edgeReducer",
        tierSettingsRef.current.defaultEdgesHidden
          ? (_e: string, attrs: Record<string, unknown>) => ({ ...attrs, hidden: true })
          : null
      );
    }
  }, [defaultNodeReducer]);

  const handleSearchNavigate = useCallback((nodeId: string) => {
    onNavigateRef.current?.(nodeId);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function init() {
      if (!visibleRef.current) return;
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
        if (perf) {
          const ipcMs = performance.now() - t0;
          const payloadSize = JSON.stringify(subgraph).length;
          perfEntries.push({ label: "IPC fetch", value: ipcMs, detail: `${(payloadSize / 1024).toFixed(1)} kB` });
        }

        if (cancelled) return;

        const { accentColor, stubColor, dimColor } = resolveThemeColors();
        dimColorRef.current = dimColor;
        t0 = perf ? performance.now() : 0;
        const graph = buildGraph({
          subgraph,
          accentColor,
          stubColor,
          seedId: mode === "local" ? (activePageId ?? undefined) : undefined,
        });
        if (perf) {
          perfEntries.push({ label: "Graphology build", value: performance.now() - t0, detail: `${graph.order} nodes, ${graph.size} edges` });
        }

        const tierSettings = getQualitySettings(graph.order);
        tierSettingsRef.current = tierSettings;
        if (perf) {
          perfEntries.push({ label: "Quality tier", value: graph.order, detail: tierSettings.tier });
        }

        if (!containerRef.current || cancelled) return;

        const { default: Sigma } = await import("sigma");
        const { createNodeBorderProgram } = await import("@sigma/node-border");

        if (cancelled || !containerRef.current) return;

        const rustPositions = subgraph.positions ?? null;

        if (rustPositions && Object.keys(rustPositions).length > 0) {
          applyPositions(graph, rustPositions);
        }

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
          hideEdgesOnMove: tierSettings.hideEdgesOnMove,
          hideLabelsOnMove: tierSettings.hideLabelsOnMove,
          labelRenderedSizeThreshold: tierSettings.labelRenderedSizeThreshold,
          enableEdgeEvents: tierSettings.enableEdgeEvents,
        });
        sigmaRef.current = sigma;
        graphRef.current = graph;

        if (tierSettingsRef.current.defaultEdgesHidden) {
          sigma.setSetting("edgeReducer", (_e: string, attrs: Record<string, unknown>) => ({ ...attrs, hidden: true }));
        }

        sigma.setSetting("nodeReducer", defaultNodeReducer);

        const restoreDefaultReducers = () => {
          sigma.setSetting("nodeReducer", defaultNodeReducer);
          sigma.setSetting("edgeReducer",
            tierSettingsRef.current.defaultEdgesHidden
              ? (_e: string, attrs: Record<string, unknown>) => ({ ...attrs, hidden: true })
              : null
          );
        };

        if (perf) {
          sigma.on("afterRender", function onFirstRender() {
            perfEntries.push({ label: "Sigma first paint", value: performance.now() - sigmaT0 });
            sigma.off("afterRender", onFirstRender);
          });
        }

        sigma.on("clickNode", ({ node }) => {
          onNavigateRef.current?.(node);
        });

        sigma.on("rightClickNode", ({ node, event }) => {
          const mouseEvent = event as { original?: MouseEvent; x?: number; y?: number } | undefined;
          if (mouseEvent?.original) mouseEvent.original.preventDefault();
          setContextMenu({ nodeId: node, x: mouseEvent?.x ?? 0, y: mouseEvent?.y ?? 0 });
        });

        sigma.on("enterNode", ({ node, event }) => {
          hoveredNodeRef.current = node;
          const neighbors = new Set(graph.neighbors(node));
          neighbors.add(node);

          sigma.setSetting("nodeReducer", (_n: string, attrs: Record<string, unknown>) => {
            if (_n === node) return attrs;
            if (neighbors.has(_n)) return { ...attrs, label: null };
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
          restoreDefaultReducers();
          if (containerRef.current) {
            containerRef.current.style.cursor = "grab";
          }
          setTooltip((t) => ({ ...t, visible: false }));
        });

        sigma.on("clickStage", () => {
          restoreDefaultReducers();
        });

        if (perf) {
          perfTable("graph-init", perfEntries);
        }

        setGraphStats({ nodes: graph.order, edges: graph.size });
        lastRenderedSeedRef.current = mode === "local" ? (activePageId ?? null) : null;
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
      if (sigmaRef.current) {
        (sigmaRef.current as { kill: () => void }).kill();
        sigmaRef.current = null;
      }
      graphRef.current = null;
    };
  }, [mode, depth, mode === "local" ? activePageId : null, reinitTrigger]);

  useEffect(() => {
    if (!visible) {
      // no-op when hidden; sigma stays alive
    } else {
      if (mode === "local" && activePageId !== lastRenderedSeedRef.current) {
        setReinitTrigger((c) => c + 1);
      } else if (pendingThemeUpdateRef.current) {
        applyTheme();
        pendingThemeUpdateRef.current = false;
      } else {
        (sigmaRef.current as { refresh: () => void } | null)?.refresh();
      }
      if (pendingRefreshRef.current) {
        (sigmaRef.current as { refresh: () => void } | null)?.refresh();
        pendingRefreshRef.current = false;
      }
    }
  }, [visible, mode, activePageId]);

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    listen("lit:graph-updated", async () => {
      const graph = graphRef.current as import("graphology").default | null;
      const sigma = sigmaRef.current as { refresh: () => void } | null;
      if (!graph || !sigma) return;
      if (diffInProgressRef.current) return;
      diffInProgressRef.current = true;

      try {
        let subgraph: SubgraphResult;
        if (modeRef.current === "local" && activePageIdRef.current) {
          subgraph = await getGraphSubgraph([activePageIdRef.current], depthRef.current);
        } else {
          subgraph = await getFullSubgraph();
        }
        const pagerank = subgraph.pagerank ?? {};
        const diff = computeDiff(graph, subgraph);

        if (isDiffEmpty(diff)) return;

        if (diff.isMajorChange) {
          setReinitTrigger((c) => c + 1);
          return;
        }

        const { accentColor, stubColor } = resolveThemeColors();
        applyDiff(graph, diff, pagerank, accentColor, stubColor);
        setGraphStats({ nodes: graph.order, edges: graph.size });

        if (visibleRef.current) {
          sigma.refresh();
        } else {
          pendingRefreshRef.current = true;
        }
      } finally {
        diffInProgressRef.current = false;
      }
    }).then((fn) => {
      if (cancelled) { fn(); } else { unlisten = fn; }
    });
    return () => { cancelled = true; unlisten?.(); };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    listen("lit:layout-ready", async () => {
      const graph = graphRef.current as import("graphology").default | null;
      const sigma = sigmaRef.current as { refresh: () => void; getCamera: () => { animatedReset: () => void } } | null;
      if (!graph || !sigma) return;
      try {
        const positions = await getGraphPositions();
        if (positions && Object.keys(positions).length > 0) {
          applyPositions(graph, positions);
          sigma.refresh();
          sigma.getCamera().animatedReset();
        }
      } catch {
        // Rust positions not available
      }
    }).then((fn) => {
      if (cancelled) { fn(); } else { unlisten = fn; }
    });
    return () => { cancelled = true; unlisten?.(); };
  }, []);

  const activeThemeId = useThemeStore((s) => s.activeThemeId);

  const applyTheme = () => {
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
  };

  useEffect(() => {
    if (!graphRef.current || !sigmaRef.current) return;
    if (!visible) {
      pendingThemeUpdateRef.current = true;
      return;
    }
    applyTheme();
  }, [activeThemeId]);

  const handleContainerKeyDown = useCallback((e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "f") {
      e.preventDefault();
      setSearchOpen(true);
    } else if (e.key === "Escape") {
      if (!searchOpenRef.current && !contextMenuOpenRef.current) {
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
      <div
        ref={containerRef}
        data-testid="graph-canvas"
        style={{ position: "absolute", inset: 0, cursor: "grab" }}
        onContextMenu={(e) => e.preventDefault()}
      />
      {contextMenu && onExportNetwork && (
        <div
          data-graph-context-menu
          className="fixed z-50 min-w-[160px] select-none rounded-lg border border-border/40 bg-bg-primary/80 p-1 shadow-xl shadow-black/20 backdrop-blur-xl backdrop-saturate-150 dark:border-border/10 dark:bg-bg-primary/70"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            className="block w-full rounded-md px-3 py-1 text-start text-[13px] text-text-normal hover:bg-interactive-accent hover:text-text-on-accent"
            onClick={() => {
              onExportNetworkRef.current?.(contextMenu.nodeId);
              setContextMenu(null);
            }}
          >
            Export Local Network…
          </button>
        </div>
      )}
    </div>
  );
}
