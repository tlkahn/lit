import { useMemo } from "react";
import { usePaneField, type PaneContentEntry } from "../lib/paneContentRegistry";
import { usePaneStore, findLeaf, collectLeaves } from "../stores/panes";
import { useResponsiveLayoutStore } from "../stores/responsiveLayout";
import type { LeafFileType } from "../hooks/useLeafFileType";
import { basename } from "../lib/pathUtils";
import { HistoryNavButtons } from "./HistoryNavButtons";
import { ViewModeToggle } from "./ViewModeToggle";

interface PaneHeaderProps {
  paneId: string;
  pagePath: string | null;
  fileType: LeafFileType | null;
}

const titleSel = (e: PaneContentEntry | null) => e?.title ?? "";

export function PaneHeader({ paneId, pagePath, fileType }: PaneHeaderProps) {
  const mdTitle = usePaneField(paneId, titleSel);
  const isFocused = usePaneStore((s) => s.focusedPaneId === paneId);
  const viewMode = usePaneStore((s) => findLeaf(s.root, paneId)?.viewMode ?? "editor");
  const panesCollapsed = useResponsiveLayoutStore((s) => s.panesCollapsed);
  const root = usePaneStore((s) => s.root);
  const allLeaves = useMemo(() => collectLeaves(root), [root]);
  const focusedPaneId = usePaneStore((s) => s.focusedPaneId);

  const displayName = useMemo(() => {
    if (!pagePath) return "";
    if (fileType === "markdown") return mdTitle || basename(pagePath);
    return basename(pagePath);
  }, [pagePath, fileType, mdTitle]);

  if (!pagePath) return null;

  const showDots = panesCollapsed && allLeaves.length > 1;

  return (
    <div
      data-testid="pane-header"
      className="flex items-center gap-1.5 px-3 py-1.5 text-sm"
    >
      <HistoryNavButtons paneId={paneId} testIdPrefix="pane-history-" />
      <span className="truncate text-text-muted" data-testid="pane-header-title">
        {displayName}
      </span>
      {showDots && (
        <div className="flex items-center gap-1" data-testid="pane-dots">
          {allLeaves.map((leaf, i) => (
            <button
              key={leaf.id}
              data-testid={`pane-dot-${leaf.id}`}
              aria-label={`Switch to pane ${i + 1}`}
              aria-current={leaf.id === focusedPaneId ? "true" : undefined}
              onClick={() => usePaneStore.getState().focusPane(leaf.id)}
              style={{
                minWidth: 24,
                minHeight: 24,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: "none",
                border: "none",
                padding: 0,
                cursor: "pointer",
              }}
            >
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  border: "1.5px solid var(--text-muted)",
                  backgroundColor: leaf.id === focusedPaneId ? "var(--text-muted)" : "transparent",
                }}
              />
            </button>
          ))}
        </div>
      )}
      {isFocused && fileType === "markdown" && (
        <div className="ms-auto">
          <ViewModeToggle paneId={paneId} currentMode={viewMode} />
        </div>
      )}
    </div>
  );
}
