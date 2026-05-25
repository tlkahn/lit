import { useEffect, useRef, useState, useCallback } from "react";
import { getFullSubgraph, getGraphSubgraph, getGraphPositions, readPage, previewSplit } from "../lib/ipc";
import type { SubgraphResult, PageContent, MergePlan, SplitPlan } from "../lib/ipc";
import { listen } from "@tauri-apps/api/event";
import { buildGraph, resolveThemeColors, applyPositions } from "../lib/graphLayout";
import { getQualitySettings, getTierSettings, type TierSettings } from "../lib/qualityTiers";
import { createNudgeController, type NudgeController } from "../lib/graphNudge";
import { useThemeStore } from "../stores/theme";
import { useGraphSelectionStore } from "../stores/graphSelection";
import { usePreferencesStore } from "../stores/preferences";
import { computeDiff, applyDiff, isDiffEmpty } from "../lib/graphDiff";
import { isPerfEnabled, perfTable, type PerfEntry } from "../lib/perf";
import { GraphToolbar } from "./GraphToolbar";
import { GraphTooltip } from "./GraphTooltip";
import { GraphSearch, getMatchingNodes } from "./GraphSearch";
import { MergePreviewDialog } from "./MergePreviewDialog";
import { SplitPreviewDialog } from "./SplitPreviewDialog";
import "./GraphSearch.css";
import "./GraphView.css";

export interface GraphViewProps {
  activePageId?: string | null;
  initialMode?: "full" | "local";
  visible?: boolean;
  onNavigate?: (pageId: string) => void;
  onExit?: () => void;
  onExportNetwork?: (nodeId: string) => void;
  onMergeConfirm?: (plan: MergePlan, ordering: number[], docs: PageContent[]) => void;
  onSplitConfirm?: (originalPath: string, plan: SplitPlan) => void;
}

export default function GraphView({ activePageId, initialMode, visible = true, onNavigate, onExit, onExportNetwork, onMergeConfirm, onSplitConfirm }: GraphViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sigmaRef = useRef<unknown>(null);
  const graphRef = useRef<unknown>(null);
  const hoveredNodeRef = useRef<string | null>(null);
  const nudgeRef = useRef<NudgeController | null>(null);
  const rafIdRef = useRef<number>(0);
  const pendingPosRef = useRef<{ x: number; y: number } | null>(null);
  const dimColorRef = useRef("#d1d9e0");
  const selectedSetRef = useRef<Set<string>>(new Set());
  const defaultNodeReducer = useCallback((_n: string, attrs: Record<string, unknown>) => {
    if (selectedSetRef.current.size > 0 && selectedSetRef.current.has(_n)) {
      return { ...attrs, label: null, highlighted: true };
    }
    return { ...attrs, label: null };
  }, []);
  const tierSettingsRef = useRef<TierSettings>(getTierSettings("medium"));
  const onNavigateRef = useRef(onNavigate);
  onNavigateRef.current = onNavigate;
  const onExitRef = useRef(onExit);
  onExitRef.current = onExit;
  const onExportNetworkRef = useRef(onExportNetwork);
  onExportNetworkRef.current = onExportNetwork;
  const onMergeConfirmRef = useRef(onMergeConfirm);
  onMergeConfirmRef.current = onMergeConfirm;
  const onSplitConfirmRef = useRef(onSplitConfirm);
  onSplitConfirmRef.current = onSplitConfirm;
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
  const selectionCount = useGraphSelectionStore((s) => s.selectedNodes.length);
  const llmEnabled = usePreferencesStore((s) => s.llmOpenaiApiKeySet || s.llmAnthropicApiKeySet);
  const unsubSelectionRef = useRef<(() => void) | null>(null);
  const [splitCheck, setSplitCheck] = useState<{ loading: boolean; hasHeadings: boolean; content: PageContent | null }>({ loading: false, hasHeadings: false, content: null });
  const [mergeDialogOpen, setMergeDialogOpen] = useState(false);
  const [mergeDialogDocs, setMergeDialogDocs] = useState<PageContent[]>([]);
  const [splitDialogOpen, setSplitDialogOpen] = useState(false);
  const [splitDialogPlan, setSplitDialogPlan] = useState<SplitPlan | null>(null);
  const [splitDialogPath, setSplitDialogPath] = useState("");
  const [lassoState, setLassoState] = useState<{ startX: number; startY: number; currentX: number; currentY: number } | null>(null);
  const lassoRef = useRef<{ startX: number; startY: number; currentX: number; currentY: number } | null>(null);

  useEffect(() => {
    if (!contextMenu) return;
    setSplitCheck({ loading: true, hasHeadings: false, content: null });
    let cancelled = false;
    readPage(contextMenu.nodeId).then((page) => {
      if (cancelled) return;
      const hasHeadings = /^#{2,}\s/m.test(page.body);
      setSplitCheck({ loading: false, hasHeadings, content: page });
    }).catch(() => {
      if (!cancelled) setSplitCheck({ loading: false, hasHeadings: false, content: null });
    });
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
      cancelled = true;
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
      const isSelected = selectedSetRef.current.size > 0 && selectedSetRef.current.has(_n);
      return isSelected
        ? { ...attrs, color: dimColorRef.current, label: null, highlighted: true }
        : { ...attrs, color: dimColorRef.current, label: null };
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

        if (tierSettings.tier === "small" || tierSettings.tier === "medium") {
          nudgeRef.current = createNudgeController(graph, () => sigma.refresh());
        }

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

        sigma.on("clickNode", ({ node, event }) => {
          const mouseEvent = event as { original?: { shiftKey?: boolean; metaKey?: boolean; ctrlKey?: boolean } } | undefined;
          const orig = mouseEvent?.original;
          if (orig?.metaKey || orig?.ctrlKey) {
            useGraphSelectionStore.getState().clearSelection();
            onNavigateRef.current?.(node);
            return;
          }
          useGraphSelectionStore.getState().toggleNode(node);
        });

        sigma.on("rightClickNode", ({ node, event }) => {
          const mouseEvent = event as { original?: MouseEvent; x?: number; y?: number } | undefined;
          if (mouseEvent?.original) mouseEvent.original.preventDefault();
          const orig = mouseEvent?.original;
          setContextMenu({ nodeId: node, x: orig?.clientX ?? mouseEvent?.x ?? 0, y: orig?.clientY ?? mouseEvent?.y ?? 0 });
        });

        sigma.on("enterNode", ({ node, event }) => {
          hoveredNodeRef.current = node;
          nudgeRef.current?.enter(node);
          const neighbors = new Set(graph.neighbors(node));
          neighbors.add(node);

          sigma.setSetting("nodeReducer", (_n: string, attrs: Record<string, unknown>) => {
            const isSelected = selectedSetRef.current.size > 0 && selectedSetRef.current.has(_n);
            if (_n === node) return isSelected ? { ...attrs, highlighted: true } : attrs;
            if (neighbors.has(_n)) return isSelected ? { ...attrs, label: null, highlighted: true } : { ...attrs, label: null };
            return isSelected
              ? { ...attrs, color: dimColorRef.current, label: null, highlighted: true }
              : { ...attrs, color: dimColorRef.current, label: null };
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
          nudgeRef.current?.leave();
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
          useGraphSelectionStore.getState().clearSelection();
          restoreDefaultReducers();
        });

        selectedSetRef.current = new Set(useGraphSelectionStore.getState().selectedNodes);
        unsubSelectionRef.current = useGraphSelectionStore.subscribe((state, prev) => {
          if (state.selectedNodes !== prev.selectedNodes) {
            selectedSetRef.current = new Set(state.selectedNodes);
            sigma.refresh();
          }
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
      nudgeRef.current?.dispose();
      nudgeRef.current = null;
      unsubSelectionRef.current?.();
      unsubSelectionRef.current = null;
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

  const handleLassoMouseDown = useCallback((e: React.MouseEvent) => {
    if (!e.shiftKey || hoveredNodeRef.current) return;
    const rect = containerRef.current?.getBoundingClientRect();
    const x = e.clientX - (rect?.left ?? 0);
    const y = e.clientY - (rect?.top ?? 0);
    const coords = { startX: x, startY: y, currentX: x, currentY: y };
    lassoRef.current = coords;
    useGraphSelectionStore.getState().setSelectionMode("lasso");
    setLassoState(coords);
    (sigmaRef.current as { setSetting: (key: string, value: unknown) => void } | null)?.setSetting("enableCameraPanning", false);
    if (containerRef.current) {
      containerRef.current.style.cursor = "crosshair";
    }
  }, []);

  const handleLassoMouseMove = useCallback((e: React.MouseEvent) => {
    if (!lassoRef.current) return;
    const rect = containerRef.current?.getBoundingClientRect();
    const x = e.clientX - (rect?.left ?? 0);
    const y = e.clientY - (rect?.top ?? 0);
    lassoRef.current.currentX = x;
    lassoRef.current.currentY = y;
    setLassoState((prev) => prev ? { ...prev, currentX: x, currentY: y } : null);
  }, []);

  const handleLassoMouseUp = useCallback(() => {
    if (!lassoRef.current) return;

    const prev = lassoRef.current;
    if (prev) {
      const sigma = sigmaRef.current as { getNodeDisplayData: (node: string) => { x: number; y: number } | undefined } | null;
      const graph = graphRef.current as { nodes: () => string[] } | null;
      if (sigma && graph) {
        const left = Math.min(prev.startX, prev.currentX);
        const top = Math.min(prev.startY, prev.currentY);
        const right = Math.max(prev.startX, prev.currentX);
        const bottom = Math.max(prev.startY, prev.currentY);
        const toAdd: string[] = [];
        for (const nodeId of graph.nodes()) {
          const pos = sigma.getNodeDisplayData(nodeId);
          if (pos && pos.x >= left && pos.x <= right && pos.y >= top && pos.y <= bottom) {
            toAdd.push(nodeId);
          }
        }
        if (toAdd.length > 0) {
          useGraphSelectionStore.getState().addNodes(toAdd);
        }
      }
    }

    lassoRef.current = null;
    setLassoState(null);
    (sigmaRef.current as { setSetting: (key: string, value: unknown) => void } | null)?.setSetting("enableCameraPanning", true);
    useGraphSelectionStore.getState().setSelectionMode(useGraphSelectionStore.getState().selectedNodes.length > 0 ? "click" : "none");
    if (containerRef.current) {
      containerRef.current.style.cursor = "grab";
    }
  }, []);

  const handleContainerKeyDown = useCallback((e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "f") {
      e.preventDefault();
      setSearchOpen(true);
    } else if (e.key === "Escape") {
      if (searchOpenRef.current || contextMenuOpenRef.current) return;
      const { selectedNodes, clearSelection } = useGraphSelectionStore.getState();
      if (selectedNodes.length > 0) {
        clearSelection();
        return;
      }
      onExitRef.current?.();
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
        selectionCount={selectionCount}
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
        onMouseDown={handleLassoMouseDown}
        onMouseMove={handleLassoMouseMove}
        onMouseUp={handleLassoMouseUp}
        onContextMenu={(e) => e.preventDefault()}
      />
      {lassoState && (
        <div
          data-testid="lasso-rect"
          className="graph-lasso-rect"
          style={{
            position: "absolute",
            left: Math.min(lassoState.startX, lassoState.currentX),
            top: Math.min(lassoState.startY, lassoState.currentY),
            width: Math.abs(lassoState.currentX - lassoState.startX),
            height: Math.abs(lassoState.currentY - lassoState.startY),
            pointerEvents: "none",
          }}
        />
      )}
      {contextMenu && (
        <div
          data-graph-context-menu
          className="fixed z-50 min-w-[160px] select-none rounded-lg border border-border/40 bg-bg-primary/80 p-1 shadow-xl shadow-black/20 backdrop-blur-xl backdrop-saturate-150 dark:border-border/10 dark:bg-bg-primary/70"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          {selectionCount >= 2 && (
            <button
              data-testid="ctx-merge-btn"
              className="block w-full rounded-md px-3 py-1 text-start text-[13px] text-text-normal hover:bg-interactive-accent hover:text-text-on-accent"
              onClick={() => {
                const selectedNodes = useGraphSelectionStore.getState().selectedNodes;
                setContextMenu(null);
                if (onMergeConfirm) {
                  Promise.all(selectedNodes.map((id) => readPage(id))).then((docs) => {
                    setMergeDialogDocs(docs);
                    setMergeDialogOpen(true);
                  });
                } else {
                  Promise.all(selectedNodes.map((id) => readPage(id))).then((docs) => {
                    window.dispatchEvent(
                      new CustomEvent("lit:open-merge-preview", { detail: { docs } }),
                    );
                  });
                }
              }}
            >
              {`Merge ${selectionCount} documents`}
            </button>
          )}
          {selectionCount <= 1 && (
            <button
              data-testid="ctx-split-btn"
              className="block w-full rounded-md px-3 py-1 text-start text-[13px] text-text-normal hover:bg-interactive-accent hover:text-text-on-accent disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-text-normal"
              disabled={splitCheck.loading || !splitCheck.hasHeadings}
              title={!splitCheck.loading && !splitCheck.hasHeadings ? "Document has no headings — cannot split" : undefined}
              onClick={() => {
                if (!splitCheck.content) return;
                const nodeId = contextMenu.nodeId;
                setContextMenu(null);
                if (onSplitConfirm) {
                  previewSplit(splitCheck.content.body, splitCheck.content.meta.title, splitCheck.content.meta.frontmatter).then((plan) => {
                    setSplitDialogPlan(plan);
                    setSplitDialogPath(nodeId);
                    setSplitDialogOpen(true);
                  });
                } else {
                  previewSplit(splitCheck.content.body, splitCheck.content.meta.title, splitCheck.content.meta.frontmatter).then((plan) => {
                    window.dispatchEvent(
                      new CustomEvent("lit:open-split-preview", { detail: { plan, originalPath: nodeId } }),
                    );
                  });
                }
              }}
            >
              Split document
            </button>
          )}
          {onExportNetwork && (
            <div data-testid="ctx-divider" className="my-1 border-t border-border/40" />
          )}
          {onExportNetwork && (
            <button
              data-testid="ctx-export-btn"
              className="block w-full rounded-md px-3 py-1 text-start text-[13px] text-text-normal hover:bg-interactive-accent hover:text-text-on-accent"
              onClick={() => {
                onExportNetworkRef.current?.(contextMenu.nodeId);
                setContextMenu(null);
              }}
            >
              Export Local Network…
            </button>
          )}
        </div>
      )}
      {mergeDialogOpen && (
        <MergePreviewDialog
          open={mergeDialogOpen}
          docs={mergeDialogDocs}
          llmEnabled={llmEnabled}
          onConfirm={(plan, ordering) => {
            onMergeConfirmRef.current?.(plan, ordering, mergeDialogDocs);
            setMergeDialogOpen(false);
          }}
          onCancel={() => setMergeDialogOpen(false)}
        />
      )}
      {splitDialogOpen && splitDialogPlan && (
        <SplitPreviewDialog
          open={splitDialogOpen}
          plan={splitDialogPlan}
          originalPath={splitDialogPath}
          onConfirm={() => {
            onSplitConfirmRef.current?.(splitDialogPath, splitDialogPlan);
            setSplitDialogOpen(false);
          }}
          onCancel={() => setSplitDialogOpen(false)}
        />
      )}
    </div>
  );
}
