import { createContext, useContext, useEffect, useRef, useCallback, lazy, Suspense } from "react";
import type React from "react";
import { usePaneStore, findLeaf } from "../stores/panes";
import type { PaneNode } from "../stores/panes";
import { usePaneLoadingStore } from "../stores/paneLoading";
import { useWorkspaceStore } from "../stores/workspace";
import { useResponsiveLayoutStore } from "../stores/responsiveLayout";
import { EditorPane } from "./EditorPane";
import { PdfViewerPane } from "./PdfViewerPane";
import { PaneDivider } from "./PaneDivider";
import { MIN_PANE_PX, DIVIDER_PX } from "../lib/paneConstants";
import { getFileType } from "../hooks/useLeafFileType";
import { PaneHeader } from "./PaneHeader";
import { MindmapPaneView } from "./MindmapPaneView";
import { GraphPaneView } from "./GraphPaneView";
import { CardboxPaneView } from "./CardboxPaneView";
import { SpinnerSvg } from "./SpinnerSvg";
import { getPaneView } from "../lib/editorViewRef";
import { usePaneFocus } from "../hooks/usePaneFocus";

const CodeEditorPane = lazy(() => import("./CodeEditorPane"));

function subtreeContainsLeaf(node: PaneNode, leafId: string): boolean {
  if (node.type === "leaf") return node.id === leafId;
  return node.children.some((child) => subtreeContainsLeaf(child, leafId));
}

const ExportNetworkContext = createContext<((nodeId: string) => void) | undefined>(undefined);

function PaneLeafRenderer({ paneId }: { paneId: string }) {
  const isMultiPane = usePaneStore((s) => s.root.type === "split");
  const onExportNetwork = useContext(ExportNetworkContext);

  const pagePath = usePaneStore(
    (s) => findLeaf(s.root, paneId)?.pagePath ?? null,
  );
  const viewMode = usePaneStore(
    (s) => findLeaf(s.root, paneId)?.viewMode ?? "editor",
  );
  const focusedPaneId = usePaneStore((s) => s.focusedPaneId);
  const pages = useWorkspaceStore((s) => s.pages);
  const fileType = getFileType(pagePath, pages);

  const isLoading = usePaneLoadingStore((s) => s.loadingPaneIds.has(paneId));

  const handleFocus = usePaneFocus(paneId);

  /** Suppress browser focus-steal on header clicks and route DOM focus to the
   *  correct content element (CM editor if available, wrapper div otherwise). */
  const handleHeaderMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      e.preventDefault();
      const view = getPaneView(paneId);
      if (view) {
        view.focus();
      } else {
        (document.querySelector(`[data-pane-id="${paneId}"]`) as HTMLElement | null)?.focus();
      }
    },
    [paneId],
  );

  const prevViewModeRef = useRef(viewMode);
  useEffect(() => {
    const prev = prevViewModeRef.current;
    prevViewModeRef.current = viewMode;
    if (prev === viewMode) return;
    if (focusedPaneId !== paneId) return;
    if (viewMode === "editor") {
      requestAnimationFrame(() => {
        getPaneView(paneId)?.focus();
      });
    }
  }, [viewMode, paneId, focusedPaneId]);

  const borderClass = isMultiPane
    ? focusedPaneId === paneId ? "border-t-2 border-interactive-accent" : "border-t-2 border-transparent"
    : "";

  let content: React.ReactNode;
  if (fileType === "pdf") {
    content = <PdfViewerPane paneId={paneId} />;
  } else if (fileType === "code") {
    content = (
      <Suspense fallback={null}>
        <CodeEditorPane paneId={paneId} />
      </Suspense>
    );
  } else if (fileType === "markdown" && pagePath) {
    const isEditor = viewMode === "editor";
    content = (
      <>
        <div className={isEditor ? "flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden" : "hidden"}>
          <EditorPane paneId={paneId} />
        </div>
        {viewMode === "mindmap" && <MindmapPaneView paneId={paneId} pagePath={pagePath} onExportNetwork={onExportNetwork} />}
        {viewMode === "graph" && <GraphPaneView paneId={paneId} pagePath={pagePath} onExportNetwork={onExportNetwork} />}
        {viewMode === "cardbox" && <CardboxPaneView pagePath={pagePath} />}
      </>
    );
  } else {
    content = <EditorPane paneId={paneId} />;
  }

  const loadingOverlay = isLoading ? (
    <div data-testid="pane-loading-overlay"
         className="absolute inset-0 z-10 flex items-center justify-center bg-bg-primary-alt/50">
      <div className="flex flex-col items-center gap-2 rounded-xl bg-bg-primary-alt/80 px-5 py-4 shadow">
        <SpinnerSvg className="h-6 w-6 text-text-faint" />
        <span className="text-sm text-text-muted">Generating title…</span>
      </div>
    </div>
  ) : null;

  if (!isMultiPane) {
    return (
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {content}
        {loadingOverlay}
      </div>
    );
  }

  return (
    <div
      onMouseDownCapture={handleFocus}
      data-pane-id={paneId}
      tabIndex={-1}
      className={`relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden ${borderClass}`}
    >
      <PaneHeader paneId={paneId} pagePath={pagePath} fileType={fileType} onMouseDown={handleHeaderMouseDown} />
      {content}
      {loadingOverlay}
    </div>
  );
}

function PaneNodeRenderer({ node, path }: { node: PaneNode; path: number[] }) {
  const panesCollapsed = useResponsiveLayoutStore((s) => s.panesCollapsed);
  const focusedPaneId = usePaneStore((s) => s.focusedPaneId);

  if (node.type === "leaf") {
    return <PaneLeafRenderer paneId={node.id} />;
  }

  if (panesCollapsed && node.children.length > 1) {
    const focusedIdx = node.children.findIndex((child) =>
      subtreeContainsLeaf(child, focusedPaneId),
    );
    const activeIdx = focusedIdx >= 0 ? focusedIdx : 0;

    return (
      <div data-testid="pane-split" className="flex flex-col min-h-0 min-w-0 flex-1">
        {node.children.map((child, i) => (
          <div
            key={child.id}
            style={{ display: i === activeIdx ? "flex" : "none" }}
            className="min-h-0 min-w-0 flex-1 flex flex-col overflow-hidden"
          >
            <PaneNodeRenderer node={child} path={[...path, i]} />
          </div>
        ))}
      </div>
    );
  }

  const directionClass =
    node.direction === "horizontal" ? "flex-row" : "flex-col";

  const dividerTotalPx = (node.children.length - 1) * DIVIDER_PX;

  const items: React.ReactNode[] = [];
  node.children.forEach((child, i) => {
    if (i > 0) {
      items.push(
        <PaneDivider
          key={`divider-${i}`}
          splitPath={path}
          direction={node.direction}
          index={i - 1}
        />,
      );
    }
    const size = node.sizes[i]!;
    const dividerShare = dividerTotalPx * size / 100;
    items.push(
      <div
        key={child.id}
        style={{
          flexBasis: `calc(${size}% - ${dividerShare}px)`,
          ...(node.direction === "horizontal"
            ? { minWidth: MIN_PANE_PX }
            : { minHeight: MIN_PANE_PX }),
        }}
        className="min-h-0 min-w-0 grow-0 shrink-0 flex flex-col overflow-hidden"
      >
        <PaneNodeRenderer node={child} path={[...path, i]} />
      </div>,
    );
  });

  return (
    <div
      data-testid="pane-split"
      className={`flex ${directionClass} min-h-0 min-w-0 flex-1`}
    >
      {items}
    </div>
  );
}

export function PaneContainer({ style, onExportNetwork }: { style?: React.CSSProperties; onExportNetwork?: (nodeId: string) => void }) {
  const root = usePaneStore((s) => s.root);
  return (
    <ExportNetworkContext.Provider value={onExportNetwork}>
      <div style={style} className="flex flex-1 min-h-0">
        <PaneNodeRenderer node={root} path={[]} />
      </div>
    </ExportNetworkContext.Provider>
  );
}
