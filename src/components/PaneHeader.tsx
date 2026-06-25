import { useMemo } from "react";
import { usePaneField, type PaneContentEntry } from "../lib/paneContentRegistry";
import { usePaneStore, findLeaf } from "../stores/panes";
import type { LeafFileType } from "../hooks/useLeafFileType";
import { basename } from "../lib/pathUtils";
import { HistoryNavButtons } from "./HistoryNavButtons";
import { ViewModeToggle } from "./ViewModeToggle";

interface PaneHeaderProps {
  paneId: string;
  pagePath: string | null;
  fileType: LeafFileType | null;
  onMouseDown?: React.MouseEventHandler<HTMLDivElement>;
}

const titleSel = (e: PaneContentEntry | null) => e?.title ?? "";

export function PaneHeader({ paneId, pagePath, fileType, onMouseDown }: PaneHeaderProps) {
  const mdTitle = usePaneField(paneId, titleSel);
  const isFocused = usePaneStore((s) => s.focusedPaneId === paneId);
  const viewMode = usePaneStore((s) => findLeaf(s.root, paneId)?.viewMode ?? "editor");

  const displayName = useMemo(() => {
    if (!pagePath) return "";
    if (fileType === "markdown") return mdTitle || basename(pagePath);
    return basename(pagePath);
  }, [pagePath, fileType, mdTitle]);

  if (!pagePath) return null;

  return (
    <div
      data-testid="pane-header"
      className="flex items-center gap-1.5 px-3 py-1.5 text-sm"
      onMouseDown={onMouseDown}
    >
      <HistoryNavButtons paneId={paneId} testIdPrefix="pane-history-" />
      <span className="truncate text-text-muted" data-testid="pane-header-title">
        {displayName}
      </span>
      {isFocused && fileType === "markdown" && (
        <div className="ms-auto">
          <ViewModeToggle paneId={paneId} currentMode={viewMode} />
        </div>
      )}
    </div>
  );
}
