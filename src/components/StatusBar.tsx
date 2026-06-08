import type { IndexPhase } from "../lib/ipc";
import { useWorkspaceStore } from "../stores/workspace";
import { useCursorInfoStore } from "../stores/cursorInfo";
import { useBottomPanelStore } from "../stores/bottomPanel";
import { usePreferencesStore } from "../stores/preferences";
import { useStatusMessageStore } from "../stores/statusMessage";
import { usePaneStore, findLeaf } from "../stores/panes";
import { usePanePdfLinkStore } from "../stores/panePdfLink";
import { useLeafFileType } from "../hooks/useLeafFileType";
import { getPdfGoToPage } from "../lib/pdfPaneRef";
import { getNextUntitledName } from "../lib/naming";
import { BufferStack } from "./BufferStack";
import type { TabId } from "../stores/bottomPanel";

const phaseLabels: Record<IndexPhase, string> = {
  scanning: "Scanning files...",
  parsing: "Parsing pages...",
  resolving: "Resolving links...",
  diffing: "Checking for changes...",
  building: "Building graph...",
};

function BottomPanelTabs() {
  const focusedLeaf = usePaneStore((s) => findLeaf(s.root, s.focusedPaneId));
  const hasPage = focusedLeaf?.pagePath != null;

  const activeTab = useBottomPanelStore((s) => s.activeTab);
  const unfolded = useBottomPanelStore((s) => s.unfolded);
  const linkedCount = useBottomPanelStore((s) => s.tabMeta.linked.count);
  const unlinkedCount = useBottomPanelStore((s) => s.tabMeta.unlinked.count);
  const outgoingCount = useBottomPanelStore((s) => s.tabMeta.outgoing.count);
  const annotationCount = useBottomPanelStore((s) => s.tabMeta.annotations.count);
  const handleTabClick = useBottomPanelStore((s) => s.handleTabClick);

  const experimentalUnlinkedReferences = usePreferencesStore(
    (s) => s.experimentalUnlinkedReferences,
  );
  const annotationEnabled = usePreferencesStore((s) => s.annotationEnabled);
  return (
    <div className="flex items-center" data-testid="bottom-panel-tabs">
      {hasPage && (
        <>
          <TabButton
            tab="linked"
            label="Linked References"
            count={linkedCount}
            active={activeTab === "linked"}
            unfolded={unfolded}
            onClick={handleTabClick}
          />
          <TabButton
            tab="outgoing"
            label="Outgoing Links"
            count={outgoingCount}
            active={activeTab === "outgoing"}
            unfolded={unfolded}
            onClick={handleTabClick}
          />
          {experimentalUnlinkedReferences && (
            <TabButton
              tab="unlinked"
              label="Unlinked References"
              count={unlinkedCount}
              active={activeTab === "unlinked"}
              unfolded={unfolded}
              onClick={handleTabClick}
            />
          )}
          {annotationEnabled && (
            <TabButton
              tab="annotations"
              label="Annotations"
              count={annotationCount}
              active={activeTab === "annotations"}
              unfolded={unfolded}
              onClick={handleTabClick}
            />
          )}
        </>
      )}
    </div>
  );
}

function PdfPageNav() {
  const focusedPaneId = usePaneStore((s) => s.focusedPaneId);
  const fileType = useLeafFileType(focusedPaneId);
  const pageIdx = usePanePdfLinkStore((s) => s.currentPage.get(focusedPaneId) ?? null);
  const totalPages = usePanePdfLinkStore((s) => s.pageCount.get(focusedPaneId) ?? null);

  if (fileType !== "pdf" || pageIdx == null || totalPages == null) return null;

  return (
    <span className="ml-3 flex items-center gap-1 text-text-muted" data-testid="pdf-page-nav">
      <button
        data-testid="pdf-prev"
        disabled={pageIdx <= 0}
        onClick={() => getPdfGoToPage(focusedPaneId)?.(pageIdx - 1)}
        className="px-0.5 disabled:opacity-30 disabled:cursor-not-allowed"
      >
        ‹
      </button>
      <span data-testid="pdf-page-indicator">
        {pageIdx + 1} / {totalPages}
      </span>
      <button
        data-testid="pdf-next"
        disabled={pageIdx >= totalPages - 1}
        onClick={() => getPdfGoToPage(focusedPaneId)?.(pageIdx + 1)}
        className="px-0.5 disabled:opacity-30 disabled:cursor-not-allowed"
      >
        ›
      </button>
    </span>
  );
}

function TabButton({
  tab,
  label,
  count,
  active,
  unfolded,
  onClick,
}: {
  tab: TabId;
  label: string;
  count: number | null;
  active: boolean;
  unfolded: boolean;
  onClick: (tab: TabId) => void;
}) {
  let highlight = "text-text-faint hover:text-text-muted";
  if (active && unfolded) {
    highlight = "text-text-normal font-medium";
  } else if (active && !unfolded) {
    highlight = "text-text-muted";
  }

  const text = count !== null && count > 0 ? `${label} (${count})` : label;

  return (
    <button
      role="tab"
      aria-selected={active && unfolded}
      data-testid={`tab-${tab}`}
      className={`px-2 text-xs ${highlight}`}
      onClick={() => onClick(tab)}
    >
      {text}
    </button>
  );
}

export function StatusBar() {
  const graphReady = useWorkspaceStore((s) => s.graphReady);
  const workspacePath = useWorkspaceStore((s) => s.workspacePath);
  const indexProgress = useWorkspaceStore((s) => s.indexProgress);
  const pages = useWorkspaceStore((s) => s.pages);
  const createPage = useWorkspaceStore((s) => s.createPage);
  const line = useCursorInfoStore((s) => s.line);
  const col = useCursorInfoStore((s) => s.col);
  const statusMessage = useStatusMessageStore((s) => s.message);
  const statusVariant = useStatusMessageStore((s) => s.variant);

  const handleNewPage = () => {
    const name = getNextUntitledName(pages);
    createPage(name);
  };

  const newPageButton = (
    <button
      onClick={handleNewPage}
      className="flex items-center px-1 text-text-muted hover:text-text-normal"
      aria-label="New page"
    >
      <span className="nerd-font" aria-hidden="true">{''}</span>
    </button>
  );

  if (!workspacePath) return null;

  if (!graphReady) {
    const label = indexProgress ? phaseLabels[indexProgress.phase] : "Initializing...";
    const ratio = indexProgress && indexProgress.total > 0 ? indexProgress.current / indexProgress.total : 0;
    const indeterminate = !indexProgress || indexProgress.total === 0;

    return (
      <div data-testid="status-bar" className="flex h-6 items-center justify-between bg-bg-primary-alt px-3 text-xs text-text-faint">
        <div className="flex items-center gap-2">
          {newPageButton}
          <span>{label}</span>
        </div>
        <div className="h-1.5 w-24 overflow-hidden rounded-full bg-bg-hover">
          <div
            data-testid="status-bar-fill"
            className={`h-full rounded-full bg-interactive-accent transition-all duration-200 ${indeterminate ? "animate-pulse" : ""}`}
            style={{ width: indeterminate ? "100%" : `${Math.round(ratio * 100)}%` }}
          />
        </div>
      </div>
    );
  }

  return (
    <div data-testid="status-bar" className="flex h-6 items-center justify-between bg-bg-primary-alt px-3 text-xs text-text-faint">
      <div className="flex items-center">
        {newPageButton}
        <BufferStack />
      </div>
      <div className="flex items-center">
        {statusMessage && (
          <span
            data-testid="status-bar-message"
            className={`mr-2 max-w-[40%] truncate ${statusVariant === "error" ? "text-text-error" : "text-text-muted"}${statusVariant === "progress" ? " animate-pulse" : ""}`}
          >
            {statusMessage}
          </span>
        )}
        <BottomPanelTabs />
        <PdfPageNav />
        {line > 0 && <span data-testid="status-bar-cursor" className="ml-3">Ln {line}, Col {col}</span>}
      </div>
    </div>
  );
}
