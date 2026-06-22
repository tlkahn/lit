import { useMemo } from "react";
import { usePaneStore, findLeaf } from "../stores/panes";
import { usePaneHistoryStore } from "../stores/paneHistory";
import { usePaneField, type PaneContentEntry } from "../lib/paneContentRegistry";
import { useLeafFileType } from "../hooks/useLeafFileType";

const titleSel = (e: PaneContentEntry | null) => e?.title ?? "";

function basename(path: string): string {
  const i = path.lastIndexOf("/");
  return i >= 0 ? path.slice(i + 1) : path;
}

export function PaneHeader({ paneId }: { paneId: string }) {
  const pagePath = usePaneStore((s) => findLeaf(s.root, paneId)?.pagePath ?? null);
  const fileType = useLeafFileType(paneId);
  const canGoBack = usePaneHistoryStore((s) => s.canGoBack(paneId));
  const canGoForward = usePaneHistoryStore((s) => s.canGoForward(paneId));
  const mdTitle = usePaneField(paneId, titleSel);

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
    >
      {([
        { dir: "back", can: canGoBack, onClick: () => usePaneHistoryStore.getState().goBack(paneId), label: "Go back", glyph: "‹" },
        { dir: "forward", can: canGoForward, onClick: () => usePaneHistoryStore.getState().goForward(paneId), label: "Go forward", glyph: "›" },
      ] as const).map((btn) => (
        <button
          key={btn.dir}
          disabled={!btn.can}
          onClick={btn.onClick}
          className="text-text-faint hover:text-text-normal disabled:opacity-30 disabled:cursor-not-allowed px-0.5"
          aria-label={btn.label}
          data-testid={`pane-history-${btn.dir}`}
        >
          {btn.glyph}
        </button>
      ))}
      <span className="truncate text-text-muted" data-testid="pane-header-title">
        {displayName}
      </span>
    </div>
  );
}
