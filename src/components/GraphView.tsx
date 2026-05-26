import { useEffect, useRef, useState, useCallback } from "react";
import { getFullSubgraph, getGraphSubgraph, getGraphPositions } from "../lib/ipc";
import type { SubgraphResult, PageContent, MergePlan, SplitPlan } from "../lib/ipc";
import { listen } from "@tauri-apps/api/event";
import { buildGraph, resolveThemeColors, applyPositions } from "../lib/graphLayout";
import { getQualitySettings, getTierSettings, type TierSettings } from "../lib/qualityTiers";
import { createNudgeController, type NudgeController } from "../lib/graphNudge";
import { useGraphSelectionStore } from "../stores/graphSelection";
import { usePreferencesStore } from "../stores/preferences";
import { computeDiff, applyDiff, isDiffEmpty } from "../lib/graphDiff";
import { isPerfEnabled, perfTable, type PerfEntry } from "../lib/perf";
import { defaultNodeReduce } from "../lib/graphReducers";
import { GraphToolbar } from "./GraphToolbar";
import { GraphSearch } from "./GraphSearch";
import { MergePreviewDialog } from "./MergePreviewDialog";
import { SplitPreviewDialog } from "./SplitPreviewDialog";
import { useGraphLasso } from "../hooks/useGraphLasso";
import { GraphDeleteDialog } from "./GraphDeleteDialog";
import { GraphContextMenu } from "./GraphContextMenu";
import { useGraphTheme } from "../hooks/useGraphTheme";
import { useGraphSearch } from "../hooks/useGraphSearch";
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
  const dimColorRef = useRef("#d1d9e0");
  const selectedSetRef = useRef<Set<string>>(new Set());
  const defaultNodeReducer = useCallback((_n: string, attrs: Record<string, unknown>) => {
    return defaultNodeReduce(_n, attrs, { selectedSet: selectedSetRef.current, dimColor: dimColorRef.current });
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
  const [graphStats, setGraphStats] = useState<{ nodes: number; edges: number } | null>(null);
  const [contextMenu, setContextMenu] = useState<{ nodeId: string; x: number; y: number } | null>(null);
  const contextMenuOpenRef = useRef(false);
  useEffect(() => { contextMenuOpenRef.current = contextMenu !== null; }, [contextMenu]);
  const selectionCount = useGraphSelectionStore((s) => s.selectedNodes.length);
  const llmEnabled = usePreferencesStore((s) => s.llmOpenaiApiKeySet || s.llmAnthropicApiKeySet);
  const unsubSelectionRef = useRef<(() => void) | null>(null);
  const [mergeDialogOpen, setMergeDialogOpen] = useState(false);
  const [mergeDialogDocs, setMergeDialogDocs] = useState<PageContent[]>([]);
  const [splitDialogOpen, setSplitDialogOpen] = useState(false);
  const [splitDialogPlan, setSplitDialogPlan] = useState<SplitPlan | null>(null);
  const [splitDialogPath, setSplitDialogPath] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState<{ nodeIds: string[]; labels: string[] } | null>(null);
  const { lassoState, handleLassoMouseDown, handleLassoMouseMove, handleLassoMouseUp } = useGraphLasso(containerRef, sigmaRef as React.RefObject<{ setSetting: (k: string, v: unknown) => void; getNodeDisplayData: (n: string) => { x: number; y: number } | undefined } | null>, graphRef as React.RefObject<{ nodes: () => string[] } | null>, hoveredNodeRef);
  useGraphTheme(graphRef as React.RefObject<{ forEachNode: (cb: (node: string, attrs: Record<string, unknown>) => void) => void; setNodeAttribute: (node: string, attr: string, value: unknown) => void } | null>, sigmaRef as React.RefObject<{ refresh: () => void; setSetting: (key: string, value: unknown) => void } | null>, dimColorRef);
  const { searchOpen, setSearchOpen, searchOpenRef, searchQuery, searchMatches, handleSearchQueryChange, handleSearchClose, handleSearchNavigate } = useGraphSearch(graphRef as React.RefObject<{ forEachNode: (cb: (node: string, attrs: Record<string, unknown>) => void) => void; source: (edge: string) => string; target: (edge: string) => string } | null>, sigmaRef as React.RefObject<{ setSetting: (key: string, value: unknown) => void; getCamera: () => { animate: (state: Record<string, number>) => void }; getNodeDisplayData: (node: string) => { x: number; y: number } | undefined } | null>, tierSettingsRef, defaultNodeReducer, onNavigateRef, selectedSetRef, dimColorRef);

  const handleResetZoom = useCallback(() => {
    const sigma = sigmaRef.current as { getCamera: () => { animatedReset: () => void } } | null;
    sigma?.getCamera().animatedReset();
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

        const { accentColor, dimColor } = resolveThemeColors();
        dimColorRef.current = dimColor;
        t0 = perf ? performance.now() : 0;
        const graph = buildGraph({
          subgraph,
          accentColor,
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
          borders: [
            { size: { value: 0.08, mode: "relative" }, color: { transparent: true } },
            { size: { fill: true }, color: { attribute: "color" } },
          ],
        });
        const seedProgram = createNodeBorderProgram({
          borders: [
            { size: { value: 0.12, mode: "relative" }, color: { transparent: true } },
            { size: { fill: true }, color: { attribute: "color" } },
          ],
        });

        const sigmaT0 = perf ? performance.now() : 0;
        const sigma = new Sigma(graph, containerRef.current, {
          nodeProgramClasses: { filled: filledProgram, seed: seedProgram },
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

        sigma.on("enterNode", ({ node }) => {
          hoveredNodeRef.current = node;
          nudgeRef.current?.enter(node);

          sigma.setSetting("nodeReducer", (_n: string, attrs: Record<string, unknown>) => {
            if (_n === node) return { ...attrs, forceLabel: true };
            return defaultNodeReduce(_n, attrs, { selectedSet: selectedSetRef.current, dimColor: dimColorRef.current });
          });

          if (containerRef.current) {
            containerRef.current.style.cursor = "pointer";
          }
        });

        sigma.on("leaveNode", () => {
          hoveredNodeRef.current = null;
          nudgeRef.current?.leave();
          restoreDefaultReducers();
          if (containerRef.current) {
            containerRef.current.style.cursor = "grab";
          }
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
        const diff = computeDiff(graph, subgraph);

        if (isDiffEmpty(diff)) return;

        if (diff.isMajorChange) {
          setReinitTrigger((c) => c + 1);
          return;
        }

        const { accentColor } = resolveThemeColors();
        applyDiff(graph, diff, accentColor);
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
      <GraphContextMenu
        contextMenu={contextMenu}
        onClose={() => setContextMenu(null)}
        selectionCount={selectionCount}
        llmEnabled={llmEnabled}
        graphRef={graphRef as React.RefObject<{ getNodeAttribute: (node: string, attr: string) => unknown } | null>}
        onDeleteRequest={(nodeIds, labels) => setDeleteConfirm({ nodeIds, labels })}
        onMergeRequest={(docs) => {
          if (onMergeConfirm) {
            setMergeDialogDocs(docs);
            setMergeDialogOpen(true);
          } else {
            window.dispatchEvent(new CustomEvent("lit:open-merge-preview", { detail: { docs } }));
          }
        }}
        onSplitRequest={(plan, path) => {
          if (onSplitConfirm) {
            setSplitDialogPlan(plan);
            setSplitDialogPath(path);
            setSplitDialogOpen(true);
          } else {
            window.dispatchEvent(new CustomEvent("lit:open-split-preview", { detail: { plan, originalPath: path } }));
          }
        }}
        onExportNetwork={onExportNetwork ? (nodeId) => { onExportNetworkRef.current?.(nodeId); } : undefined}
      />
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
      <GraphDeleteDialog deleteConfirm={deleteConfirm} onClose={() => setDeleteConfirm(null)} />
    </div>
  );
}
