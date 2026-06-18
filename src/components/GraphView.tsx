import { useRef, useState, useCallback } from "react";
import type { PageContent, MergePlan, SplitPlan, BibEntry } from "../lib/ipc";
import { readPage, enrichBibEntry, applyEnrichmentCandidate } from "../lib/ipc";
import { bibKeyFromNodeId } from "../lib/bibKey";
import { useWorkspaceStore } from "../stores/workspace";
import { useStatusMessageStore } from "../stores/statusMessage";
import { showGraphContextMenu, useGraphContextMenu } from "../lib/contextMenuIpc";
import { useGraphSelectionStore } from "../stores/graphSelection";
import { useGraphViewState } from "../stores/graphViewState";
import { usePreferencesStore } from "../stores/preferences";
import { providerNeedsApiKey } from "../lib/providerRegistry";
import { GraphToolbar } from "./GraphToolbar";
import { GraphSearch } from "./GraphSearch";
import { MergePreviewDialog } from "./MergePreviewDialog";
import { SplitPreviewDialog } from "./SplitPreviewDialog";
import { useGraphLasso } from "../hooks/useGraphLasso";
import { GraphDeleteDialog } from "./GraphDeleteDialog";
import { useGraphTheme } from "../hooks/useGraphTheme";
import { useGraphSearch } from "../hooks/useGraphSearch";
import { useGraphData } from "../hooks/useGraphData";
import { useRecordDeparture } from "../hooks/useRecordDeparture";
import { useGraphRenderer } from "../hooks/useGraphRenderer";
import { useMaterializeCitation } from "../hooks/useMaterializeCitation";
import type { GraphLike } from "../hooks/graphTypes";
import { EnrichCandidatePicker } from "./EnrichCandidatePicker";
import { classifyEnrichResult, type EnrichCandidateState } from "../lib/enrichResult";
import "./GraphSearch.css";
import "./GraphView.css";

export interface GraphViewProps {
  activePageId?: string | null;
  onNavigate?: (pageId: string) => void;
  onExit?: () => void;
  onExportNetwork?: (nodeId: string) => void;
  onMergeConfirm?: (plan: MergePlan, ordering: number[], docs: PageContent[]) => void;
  onSplitConfirm?: (originalPath: string, plan: SplitPlan) => void;
}

export default function GraphView({ activePageId, onNavigate, onExit, onExportNetwork, onMergeConfirm, onSplitConfirm }: GraphViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
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

  const mode = useGraphViewState((s) => s.mode);
  const setMode = useGraphViewState((s) => s.setMode);
  const depth = useGraphViewState((s) => s.depth);
  const setDepth = useGraphViewState((s) => s.setDepth);
  const showCitations = useGraphViewState((s) => s.showCitations);
  const setShowCitations = useGraphViewState((s) => s.setShowCitations);
  const selectionCount = useGraphSelectionStore((s) => s.selectedNodes.length);
  const workspacePath = useWorkspaceStore((s) => s.workspacePath);
  const selectPage = useWorkspaceStore((s) => s.selectPage);
  const currentPagePath = useWorkspaceStore((s) => s.currentPagePath);
  const show = useStatusMessageStore((s) => s.show);
  const llmEnabled = usePreferencesStore((s) =>
    s.llmProvider.apiKeySet ||
    !providerNeedsApiKey(s.llmProvider.providerId, s.llmCustomProviders)
  );

  const currentPageRef = useRef(currentPagePath ?? "");
  currentPageRef.current = currentPagePath ?? "";
  const recordDeparture = useRecordDeparture(currentPageRef);

  const [mergeDialogOpen, setMergeDialogOpen] = useState(false);
  const [mergeDialogDocs, setMergeDialogDocs] = useState<PageContent[]>([]);
  const [splitDialogOpen, setSplitDialogOpen] = useState(false);
  const [splitDialogPlan, setSplitDialogPlan] = useState<SplitPlan | null>(null);
  const [splitDialogPath, setSplitDialogPath] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState<{ nodeIds: string[]; labels: string[] } | null>(null);
  const [enrichCandidates, setEnrichCandidates] = useState<EnrichCandidateState | null>(null);

  const { graphRef, loading, error, graphStats, tierSettings, dimColorRef, dataVersion, rebuild } = useGraphData({
    mode, depth, activePageId: activePageId ?? null, showCitations,
  });

  const materialize = useMaterializeCitation({
    recordDeparture,
    navigate: onNavigate ?? selectPage,
    onError: (msg) => show(msg, "error"),
    onMaterialized: rebuild,
  });

  const { sigmaRef, hoveredNodeRef, selectedSetRef, defaultNodeReducer, tierSettingsRef, resetZoom } = useGraphRenderer({
    containerRef, graphRef, tierSettings, dimColorRef, dataVersion,
    onNavigate, onContextMenu: async (menu) => {
      const isShadow = bibKeyFromNodeId(menu.nodeId) !== null;
      let hasHeadings = false;
      if (!isShadow) {
        const page = await readPage(menu.nodeId);
        hasHeadings = /^#{2,}\s/m.test(page.body);
      }
      const { selectedNodes } = useGraphSelectionStore.getState();
      const nodeIds = selectedNodes.length >= 1 ? [...selectedNodes] : [menu.nodeId];
      await showGraphContextMenu({
        nodeId: menu.nodeId,
        nodeIds,
        selectionCount: selectedNodes.length,
        hasHeadings,
        hasExport: !!onExportNetworkRef.current,
        isShadow,
      });
    },
  });

  const graphLikeRef = graphRef as React.RefObject<GraphLike | null>;
  const { lassoState, handleLassoMouseDown, handleLassoMouseMove, handleLassoMouseUp } =
    useGraphLasso(containerRef, sigmaRef, graphLikeRef, hoveredNodeRef);
  useGraphTheme(graphLikeRef, sigmaRef, dimColorRef);
  const {
    searchOpen, setSearchOpen, searchOpenRef,
    searchQuery, searchMatches,
    handleSearchQueryChange, handleSearchClose, handleSearchNavigate,
  } = useGraphSearch(
    graphLikeRef, sigmaRef,
    tierSettingsRef, defaultNodeReducer, onNavigateRef, selectedSetRef, dimColorRef,
  );

  useGraphContextMenu({
    onMergeRequest: (docs) => {
      if (onMergeConfirmRef.current) {
        setMergeDialogDocs(docs);
        setMergeDialogOpen(true);
      } else {
        window.dispatchEvent(new CustomEvent("lit:open-merge-preview", { detail: { docs } }));
      }
    },
    onSplitRequest: (plan, nodeId) => {
      if (onSplitConfirmRef.current) {
        setSplitDialogPlan(plan);
        setSplitDialogPath(nodeId);
        setSplitDialogOpen(true);
      } else {
        window.dispatchEvent(new CustomEvent("lit:open-split-preview", { detail: { plan, originalPath: nodeId } }));
      }
    },
    onDeleteRequest: (nodeIds, labels) => {
      setDeleteConfirm({ nodeIds, labels });
    },
    onExportNetwork: (nodeId) => {
      onExportNetworkRef.current?.(nodeId);
    },
    onFetchDetails: async (nodeId) => {
      if (!workspacePath) return;
      const bibKey = bibKeyFromNodeId(nodeId);
      if (!bibKey) return;
      try {
        const result = await enrichBibEntry(bibKey, workspacePath);
        const title = result.entry.title;
        const classified = classifyEnrichResult(result, bibKey, title);
        switch (classified.kind) {
          case "candidates":
            setEnrichCandidates(classified);
            return;
          case "miss":
            show(classified.message, "error");
            return;
          case "success":
            show(classified.message);
            return;
        }
      } catch (err) {
        show(
          err instanceof Error ? err.message : String(err),
          "error",
        );
      }
    },
    onCreateNote: async (nodeId) => {
      const bibKey = bibKeyFromNodeId(nodeId);
      if (!bibKey) return;
      await materialize(bibKey);
    },
    getNodeLabel: (nodeId) => {
      try {
        return (graphRef.current?.getNodeAttribute(nodeId, "label") as string) || nodeId;
      } catch { return nodeId; }
    },
  });

  const handleApplyCandidate = useCallback(
    async (candidate: BibEntry) => {
      if (!workspacePath || !enrichCandidates) return;
      const { bibKey, title } = enrichCandidates;
      setEnrichCandidates(null); // close picker immediately
      try {
        const result = await applyEnrichmentCandidate(bibKey, candidate, workspacePath);
        const classified = classifyEnrichResult(result, bibKey, title);
        switch (classified.kind) {
          case "candidates":
            setEnrichCandidates(classified);
            return;
          case "miss":
            show(classified.message, "error");
            return;
          case "success":
            show(classified.message);
            return;
        }
      } catch (err) {
        show(err instanceof Error ? err.message : String(err), "error");
      }
    },
    [workspacePath, enrichCandidates, show],
  );

  const handleContainerKeyDown = useCallback((e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "f") {
      e.preventDefault();
      setSearchOpen(true);
    } else if (e.key === "Escape") {
      if (searchOpenRef.current) return;
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
        showCitations={showCitations}
        onModeChange={setMode}
        onDepthChange={setDepth}
        onResetZoom={resetZoom}
        onSearch={() => setSearchOpen(true)}
        onShowCitationsChange={setShowCitations}
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
      <EnrichCandidatePicker
        open={enrichCandidates !== null}
        bibKey={enrichCandidates?.bibKey ?? ""}
        candidates={enrichCandidates?.candidates ?? []}
        providersSearched={enrichCandidates?.providersSearched ?? []}
        providersFailed={enrichCandidates?.providersFailed ?? []}
        onApply={handleApplyCandidate}
        onClose={() => setEnrichCandidates(null)}
      />
    </div>
  );
}
