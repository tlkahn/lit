import { useEffect, useRef, useState, useCallback, lazy, Suspense } from "react";
import { getFullSubgraph, getGraphSubgraph, getGraphPositions, computeLayout3d } from "../lib/ipc";
import type { SubgraphResult } from "../lib/ipc";
import type { CameraControllerHandle } from "./CameraController";
import { listen } from "@tauri-apps/api/event";
import { isPerfEnabled, perfTable, type PerfEntry } from "../lib/perf";
import { GraphToolbar } from "./GraphToolbar";
import { GraphTooltip } from "./GraphTooltip";
import { GraphSearch, getMatchingNodes } from "./GraphSearch";
const LazyGraphView3D = lazy(() =>
  import("./GraphView3D").then(m => ({ default: m.GraphView3D }))
);
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
  const onNavigateRef = useRef(onNavigate);
  onNavigateRef.current = onNavigate;
  const onExitRef = useRef(onExit);
  onExitRef.current = onExit;
  const onExportNetworkRef = useRef(onExportNetwork);
  onExportNetworkRef.current = onExportNetwork;
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  const lastRenderedSeedRef = useRef<string | null>(null);
  const modeRef = useRef(initialMode ?? "full");
  const depthRef = useRef(2);
  const activePageIdRef = useRef(activePageId);
  activePageIdRef.current = activePageId;
  const resetZoom3DRef = useRef<CameraControllerHandle | null>(null);

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
  const subgraphRef = useRef<SubgraphResult | null>(null);
  const pagerankRef = useRef<Record<string, number>>({});
  const [positions, setPositions] = useState<Record<string, { x: number; y: number; z: number }>>({});
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
    resetZoom3DRef.current?.resetCamera();
  }, []);

  const handleSearchQueryChange = useCallback((query: string) => {
    setSearchQuery(query);
    const nodes = subgraphRef.current?.nodes;
    if (!nodes) return;
    if (!query) {
      setSearchMatches([]);
      return;
    }
    const matches = getMatchingNodes(nodes, query);
    setSearchMatches(matches);
  }, []);

  const handleSearchClose = useCallback(() => {
    setSearchOpen(false);
    setSearchQuery("");
    setSearchMatches([]);
  }, []);

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

        const t0 = perf ? performance.now() : 0;
        let subgraph: SubgraphResult;
        if (mode === "local" && activePageId) {
          subgraph = await getGraphSubgraph([activePageId], depth);
        } else {
          subgraph = await getFullSubgraph();
        }
        const pagerank = subgraph.pagerank ?? {};
        subgraphRef.current = subgraph;
        pagerankRef.current = pagerank;
        setPositions(subgraph.positions ?? {});
        if (perf) {
          const ipcMs = performance.now() - t0;
          const payloadSize = JSON.stringify(subgraph).length;
          perfEntries.push({ label: "IPC fetch", value: ipcMs, detail: `${(payloadSize / 1024).toFixed(1)} kB` });
        }

        if (cancelled) return;

        if (Object.keys(subgraph.positions ?? {}).length === 0) {
          computeLayout3d();
        }

        if (perf) {
          perfTable("graph-init", perfEntries);
        }

        setGraphStats({ nodes: subgraph.nodes.length, edges: subgraph.edges.length });
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
    };
  }, [mode, depth, mode === "local" ? activePageId : null, reinitTrigger]);

  useEffect(() => {
    if (visible && mode === "local" && activePageId !== lastRenderedSeedRef.current) {
      setReinitTrigger((c) => c + 1);
    }
  }, [visible, mode, activePageId]);

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    listen("lit:layout-ready", async () => {
      try {
        const pos = await getGraphPositions();
        if (pos && Object.keys(pos).length > 0) {
          setPositions(pos);
          if (subgraphRef.current) {
            subgraphRef.current.positions = pos;
          }
        }
      } catch {
        // positions not available
      }
    }).then((fn) => {
      if (cancelled) { fn(); } else { unlisten = fn; }
    });
    return () => { cancelled = true; unlisten?.(); };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    listen("lit:graph-updated", async () => {
      try {
        let subgraph: SubgraphResult;
        if (modeRef.current === "local" && activePageIdRef.current) {
          subgraph = await getGraphSubgraph([activePageIdRef.current], depthRef.current);
        } else {
          subgraph = await getFullSubgraph();
        }
        subgraphRef.current = subgraph;
        pagerankRef.current = subgraph.pagerank ?? {};
        setPositions(subgraph.positions ?? {});
        setGraphStats({ nodes: subgraph.nodes.length, edges: subgraph.edges.length });
      } catch {
        // update failed silently
      }
    }).then((fn) => {
      if (cancelled) { fn(); } else { unlisten = fn; }
    });
    return () => { cancelled = true; unlisten?.(); };
  }, []);

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
      <Suspense fallback={null}>
        <LazyGraphView3D
          nodes={subgraphRef.current?.nodes ?? []}
          edges={subgraphRef.current?.edges ?? []}
          positions={positions}
          pagerank={pagerankRef.current}
          seedId={mode === "local" ? (activePageId ?? undefined) : undefined}
          onNavigate={onNavigate}
          onHover={(info) => setTooltip(info)}
          onContextMenu={(info) => setContextMenu(info)}
          onResetZoom={resetZoom3DRef}
        />
      </Suspense>
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
