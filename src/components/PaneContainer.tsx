import { createContext, useContext, useEffect, useRef, useCallback, lazy, Suspense } from "react";
import type React from "react";
import { usePaneStore, findLeaf } from "../stores/panes";
import type { PaneNode } from "../stores/panes";
import { useWorkspaceStore } from "../stores/workspace";
import { EditorPane } from "./EditorPane";
import { PdfViewerPane } from "./PdfViewerPane";
import { PaneDivider } from "./PaneDivider";
import { MIN_PANE_PX, DIVIDER_PX } from "../lib/paneConstants";
import { getFileType } from "../hooks/useLeafFileType";
import { PaneHeader } from "./PaneHeader";
import { MindmapPaneView } from "./MindmapPaneView";
import { GraphPaneView } from "./GraphPaneView";
import { CardboxPaneView } from "./CardboxPaneView";
import { getPaneView, setFocusedPane } from "../lib/editorViewRef";

const CodeEditorPane = lazy(() => import("./CodeEditorPane"));

const ExportNetworkContext = createContext<((nodeId: string) => void) | undefined>(undefined);

function PaneLeafRenderer({ paneId }: { paneId: string }) {
  const isMultiPane = usePaneStore((s) => s.root.type === "split");
  const isFocused = usePaneStore((s) => s.focusedPaneId === paneId);
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

  const handleFocus = useCallback(() => {
    usePaneStore.getState().focusPane(paneId);
    setFocusedPane(paneId);
  }, [paneId]);

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

  const isNonEditorMarkdown = fileType === "markdown" && viewMode !== "editor";
  const needsFocusBorder = isMultiPane && isNonEditorMarkdown;
  const borderClass = needsFocusBorder
    ? isFocused ? "border-t-2 border-interactive-accent" : "border-t-2 border-transparent"
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
        <div className={isEditor ? "flex min-h-0 flex-1 flex-col" : "hidden"}>
          <EditorPane paneId={paneId} />
        </div>
        {viewMode === "mindmap" && <MindmapPaneView paneId={paneId} pagePath={pagePath} onExportNetwork={onExportNetwork} />}
        {viewMode === "graph" && <GraphPaneView paneId={paneId} pagePath={pagePath} onExportNetwork={onExportNetwork} />}
        {viewMode === "cardbox" && <CardboxPaneView />}
      </>
    );
  } else {
    content = <EditorPane paneId={paneId} />;
  }

  if (!isMultiPane) return content;

  return (
    <div
      onMouseDownCapture={handleFocus}
      data-pane-id={paneId}
      className={`flex min-h-0 flex-1 flex-col ${borderClass}`}
    >
      <PaneHeader paneId={paneId} pagePath={pagePath} fileType={fileType} />
      {content}
    </div>
  );
}

function PaneNodeRenderer({ node, path }: { node: PaneNode; path: number[] }) {
  if (node.type === "leaf") {
    return <PaneLeafRenderer paneId={node.id} />;
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
      className={`flex ${directionClass} min-h-0 flex-1`}
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
