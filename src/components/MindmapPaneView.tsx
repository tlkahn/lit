import { useState, useMemo, useCallback, useEffect, lazy, Suspense } from "react";
import { usePaneStore } from "../stores/panes";
import { useWorkspaceStore } from "../stores/workspace";
import { usePaneField, type PaneContentEntry } from "../lib/paneContentRegistry";
import { getPaneView } from "../lib/editorViewRef";
import { extractHeadings } from "../lib/headings";
import { buildHeadingTree, applyRename, applyMove, insertChild, insertSibling, insertDangling, resolveDeleteFallback, findNode } from "../lib/headingTree";

const LazyMindmapView = lazy(() => import("./MindmapView"));

const bodySel = (e: PaneContentEntry | null) => e?.body ?? "";

export function MindmapPaneView({ paneId, pagePath, onExportNetwork }: { paneId: string; pagePath: string; onExportNetwork?: (nodeId: string) => void }) {
  const body = usePaneField(paneId, bodySel);
  const saveMindmapFoldState = useWorkspaceStore((s) => s.saveMindmapFoldState);
  const setPaneViewMode = usePaneStore((s) => s.setPaneViewMode);

  const [mindmapSelectedId, setMindmapSelectedId] = useState<string | null>(null);

  const headingTree = useMemo(
    () => buildHeadingTree(extractHeadings(body)),
    [body],
  );

  useEffect(() => {
    if (mindmapSelectedId && !findNode(headingTree, mindmapSelectedId)) {
      setMindmapSelectedId(null);
    }
  }, [headingTree, mindmapSelectedId]);

  const mindmapInitialFoldedIds = useMemo(() => {
    const vs = useWorkspaceStore.getState().viewStates[pagePath];
    return vs?.mindmapFoldedIds ? new Set(vs.mindmapFoldedIds) : undefined;
  }, [pagePath]);

  const handleFoldChange = useCallback((ids: Set<string>) => {
    saveMindmapFoldState(pagePath, Array.from(ids));
  }, [pagePath, saveMindmapFoldState]);

  useEffect(() => {
    const handler = (e: Event) => {
      if (usePaneStore.getState().focusedPaneId !== paneId) return;
      const { line } = (e as CustomEvent<{ line: number }>).detail;
      const nodeId = `h-${line}`;
      if (findNode(headingTree, nodeId)) {
        setMindmapSelectedId(nodeId);
      }
    };
    window.addEventListener("lit:scroll-to-line", handler);
    return () => window.removeEventListener("lit:scroll-to-line", handler);
  }, [headingTree, paneId]);

  return (
    <div data-testid="mindmap-view" className="flex-1 min-h-0 min-w-0 overflow-hidden">
      <Suspense fallback={<div className="flex items-center justify-center h-full text-text-faint">Loading…</div>}>
        <LazyMindmapView
          key={pagePath}
          tree={headingTree}
          selectedId={mindmapSelectedId}
          initialFoldedIds={mindmapInitialFoldedIds}
          onFoldChange={handleFoldChange}
          onNodeClick={(node) => {
            setMindmapSelectedId(node.id);
          }}
          onNodeRename={(node, newText) => {
            const view = getPaneView(paneId);
            if (!view) return;
            const currentBody = view.state.doc.toString();
            const newBody = applyRename(currentBody, node, newText);
            view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: newBody } });
          }}
          onNodeMove={(sourceId, targetParentId, targetIndex) => {
            const view = getPaneView(paneId);
            if (!view) return;
            const currentBody = view.state.doc.toString();
            const newBody = applyMove(currentBody, headingTree, sourceId, targetParentId, targetIndex);
            view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: newBody } });
          }}
          onInsertChild={(parentId, text) => {
            const view = getPaneView(paneId);
            if (!view) return null;
            const currentBody = view.state.doc.toString();
            const result = insertChild(currentBody, headingTree, parentId, text);
            if (!result) return null;
            view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: result.body } });
            setMindmapSelectedId(result.nodeId);
            return result.nodeId;
          }}
          onInsertSibling={(siblingId, text) => {
            const view = getPaneView(paneId);
            if (!view) return null;
            const currentBody = view.state.doc.toString();
            const result = insertSibling(currentBody, headingTree, siblingId, text);
            if (!result) return null;
            view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: result.body } });
            setMindmapSelectedId(result.nodeId);
            return result.nodeId;
          }}
          onInsertDangling={(text) => {
            const view = getPaneView(paneId);
            if (!view) return null;
            const currentBody = view.state.doc.toString();
            const result = insertDangling(currentBody, 2, text);
            view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: result.body } });
            setMindmapSelectedId(result.nodeId);
            return result.nodeId;
          }}
          onNodeJump={(node) => {
            usePaneStore.getState().setPendingJumpLine(paneId, node.line + 1);
            setPaneViewMode(paneId, "editor");
          }}
          onDeleteNode={(nodeId) => {
            const view = getPaneView(paneId);
            if (!view) return;
            const currentBody = view.state.doc.toString();
            const { newBody, fallbackId } = resolveDeleteFallback(currentBody, headingTree, nodeId);
            view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: newBody } });
            setMindmapSelectedId(fallbackId);
          }}
          onExportNetwork={() => {
            onExportNetwork?.(pagePath);
          }}
        />
      </Suspense>
    </div>
  );
}
