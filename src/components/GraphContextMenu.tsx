import { useEffect, useRef, useState, type RefObject } from "react";
import { readPage, previewSplit } from "../lib/ipc";
import type { PageContent, SplitPlan } from "../lib/ipc";
import { useGraphSelectionStore } from "../stores/graphSelection";

interface GraphContextMenuProps {
  contextMenu: { nodeId: string; x: number; y: number } | null;
  onClose: () => void;
  selectionCount: number;
  llmEnabled: boolean;
  graphRef: RefObject<{ getNodeAttribute: (node: string, attr: string) => unknown } | null>;
  onDeleteRequest: (nodeIds: string[], labels: string[]) => void;
  onMergeRequest: (docs: PageContent[]) => void;
  onSplitRequest: (plan: SplitPlan, path: string) => void;
  onExportNetwork?: (nodeId: string) => void;
}

export function GraphContextMenu({
  contextMenu,
  onClose,
  selectionCount,
  graphRef,
  onDeleteRequest,
  onMergeRequest,
  onSplitRequest,
  onExportNetwork,
}: GraphContextMenuProps) {
  const [splitCheck, setSplitCheck] = useState<{ loading: boolean; hasHeadings: boolean; content: PageContent | null }>({ loading: false, hasHeadings: false, content: null });
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

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
      onCloseRef.current();
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseRef.current();
    };
    document.addEventListener("pointerdown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      cancelled = true;
      document.removeEventListener("pointerdown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [contextMenu]);

  if (!contextMenu) return null;

  return (
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
            const nodes = useGraphSelectionStore.getState().selectedNodes;
            onClose();
            Promise.all(nodes.map((id) => readPage(id))).then((docs) => {
              onMergeRequest(docs);
            });
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
            onClose();
            previewSplit(splitCheck.content.body, splitCheck.content.meta.title, splitCheck.content.meta.frontmatter).then((plan) => {
              onSplitRequest(plan, nodeId);
            });
          }}
        >
          Split document
        </button>
      )}
      <div className="my-1 border-t border-border/40" />
      <button
        data-testid="ctx-delete-btn"
        className="block w-full rounded-md px-3 py-1 text-start text-[13px] text-red-500 hover:bg-red-600 hover:text-white"
        onClick={() => {
          const storeNodes = useGraphSelectionStore.getState().selectedNodes;
          const nodeIds = storeNodes.length >= 1 ? [...storeNodes] : [contextMenu.nodeId];
          const labels = nodeIds.map((id) => {
            try { return (graphRef.current?.getNodeAttribute(id, "label") as string) || id; } catch { return id; }
          });
          onClose();
          onDeleteRequest(nodeIds, labels);
        }}
      >
        {selectionCount >= 2 ? `Delete ${selectionCount} documents` : "Delete document"}
      </button>
      {onExportNetwork && (
        <div data-testid="ctx-divider" className="my-1 border-t border-border/40" />
      )}
      {onExportNetwork && (
        <button
          data-testid="ctx-export-btn"
          className="block w-full rounded-md px-3 py-1 text-start text-[13px] text-text-normal hover:bg-interactive-accent hover:text-text-on-accent"
          onClick={() => {
            onExportNetwork(contextMenu.nodeId);
            onClose();
          }}
        >
          Export Local Network…
        </button>
      )}
    </div>
  );
}
