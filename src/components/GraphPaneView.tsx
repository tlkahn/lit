import { lazy, Suspense, useCallback } from "react";
import { usePaneStore } from "../stores/panes";
import { useWorkspaceStore } from "../stores/workspace";

const LazyGraphView = lazy(() => import("./GraphView"));

export function GraphPaneView({ paneId, pagePath, onExportNetwork }: { paneId: string; pagePath: string | null; onExportNetwork?: (nodeId: string) => void }) {
  const selectPage = useWorkspaceStore((s) => s.selectPage);
  const setPaneViewMode = usePaneStore((s) => s.setPaneViewMode);

  const onNavigate = useCallback((pageId: string) => {
    selectPage(pageId);
    setPaneViewMode(paneId, "editor");
  }, [paneId, selectPage, setPaneViewMode]);

  const onExit = useCallback(() => {
    setPaneViewMode(paneId, "editor");
  }, [paneId, setPaneViewMode]);

  return (
    <div data-testid="graph-view-wrapper" className="flex-1 min-h-0">
      <Suspense fallback={<div className="flex items-center justify-center h-full text-text-faint">Loading…</div>}>
        <LazyGraphView
          activePageId={pagePath}
          onNavigate={onNavigate}
          onExit={onExit}
          onExportNetwork={onExportNetwork}
        />
      </Suspense>
    </div>
  );
}
