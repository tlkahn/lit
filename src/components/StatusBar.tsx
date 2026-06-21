import type { IndexPhase } from "../lib/ipc";
import { useWorkspaceStore } from "../stores/workspace";
import { useCursorInfoStore } from "../stores/cursorInfo";
import { useBottomPanelStore } from "../stores/bottomPanel";
import { usePreferencesStore } from "../stores/preferences";
import { useStatusMessageStore } from "../stores/statusMessage";
import { usePaneStore, findLeaf } from "../stores/panes";
import { usePanePdfLinkStore } from "../stores/panePdfLink";
import { useLeafFileType } from "../hooks/useLeafFileType";
import { resolveLanguage } from "../editor/codeLanguages";
import { getPdfGoToPage, getPdfCurrentPage } from "../lib/pdfPaneRef";
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
  const focusedPaneId = usePaneStore((s) => s.focusedPaneId);
  const fileType = useLeafFileType(focusedPaneId);

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

  // Linked refs / outgoing links / unlinked mentions / annotations are
  // markdown-only concepts; hide the entire group for code files.
  if (fileType === "code") return null;

  return (
    <div className="flex items-center" data-testid="bottom-panel-tabs">
      {hasPage && (
        <>
          <TabButton
            tab="linked"
            label="Backlinks"
            glyph="󱞫"
            count={linkedCount}
            active={activeTab === "linked"}
            unfolded={unfolded}
            onClick={handleTabClick}
          />
          <TabButton
            tab="outgoing"
            label="Outgoing Links"
            glyph="󰌷"
            count={outgoingCount}
            active={activeTab === "outgoing"}
            unfolded={unfolded}
            onClick={handleTabClick}
          />
          {experimentalUnlinkedReferences && (
            <TabButton
              tab="unlinked"
              label="Unlinked References"
              glyph="󰌸"
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
              glyph="󰆈"
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
  // When the focused pane is not itself a PDF (the common companion workflow:
  // markdown editor focused, linked PDF visible in a split), resolve the linked
  // PDF pane so the status bar still drives page navigation. The selector returns
  // a primitive string|null, so it stays render-stable.
  const linkedPaneId = usePanePdfLinkStore((s) => s.getLinkedPane(focusedPaneId) ?? null);
  const pdfPaneId = fileType === "pdf" ? focusedPaneId : linkedPaneId;
  // Confirm the resolved partner is actually a PDF (links are editor<->PDF, but
  // guard defensively against a stray non-PDF link).
  const linkedFileType = useLeafFileType(pdfPaneId);
  const currentPage = usePanePdfLinkStore((s) => (pdfPaneId ? s.currentPage.get(pdfPaneId) ?? null : null));
  const pageCount = usePanePdfLinkStore((s) => (pdfPaneId ? s.pageCount.get(pdfPaneId) ?? null : null));

  if (
    (fileType !== "pdf" && linkedFileType !== "pdf") ||
    pdfPaneId == null ||
    currentPage == null ||
    pageCount == null
  )
    return null;

  const handlePrev = () => {
    // Prefer the viewer's synchronous current page (currentPageRef). On a rapid
    // second click during an in-flight cache-miss render, the pane store is
    // still stale; the live getter reflects the page the prior click already
    // advanced to. Fall back to the store when no viewer is registered.
    const live = getPdfCurrentPage(pdfPaneId)
      ?? (usePanePdfLinkStore.getState().currentPage.get(pdfPaneId) ?? 0);
    if (live <= 0) return;
    getPdfGoToPage(pdfPaneId)?.(live - 1);
  };

  const handleNext = () => {
    const live = getPdfCurrentPage(pdfPaneId)
      ?? (usePanePdfLinkStore.getState().currentPage.get(pdfPaneId) ?? 0);
    const total = usePanePdfLinkStore.getState().pageCount.get(pdfPaneId) ?? 0;
    if (live >= total - 1) return;
    getPdfGoToPage(pdfPaneId)?.(live + 1);
  };

  return (
    <span data-testid="status-bar-pdf-nav" className="ml-3 flex items-center gap-1 text-text-muted">
      <button
        data-testid="status-bar-pdf-prev"
        disabled={currentPage <= 0}
        onClick={handlePrev}
        className="select-none px-0.5 hover:text-text-normal disabled:opacity-30 disabled:cursor-not-allowed"
      >
        ‹
      </button>
      <span data-testid="status-bar-pdf-page">{currentPage + 1}/{pageCount}</span>
      <button
        data-testid="status-bar-pdf-next"
        disabled={currentPage >= pageCount - 1}
        onClick={handleNext}
        className="select-none px-0.5 hover:text-text-normal disabled:opacity-30 disabled:cursor-not-allowed"
      >
        ›
      </button>
    </span>
  );
}

function TabButton({
  tab,
  label,
  glyph,
  count,
  active,
  unfolded,
  onClick,
}: {
  tab: TabId;
  label: string;
  glyph: string;
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

  return (
    <button
      role="tab"
      title={label}
      aria-label={label}
      aria-selected={active && unfolded}
      data-testid={`tab-${tab}`}
      className={`px-2 text-xs ${highlight}`}
      onClick={() => onClick(tab)}
    >
      <span className="nerd-font" aria-hidden="true">{glyph}</span>
      {count !== null && count > 0 && <span className="text-[10px] ml-0.5">{count}</span>}
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
  const focusedPaneId = usePaneStore((s) => s.focusedPaneId);
  const focusedFileType = useLeafFileType(focusedPaneId);
  const focusedPagePath = usePaneStore(
    (s) => findLeaf(s.root, s.focusedPaneId)?.pagePath ?? null,
  );
  const langName =
    focusedFileType === "code" && focusedPagePath
      ? resolveLanguage(focusedPagePath)?.name ?? null
      : null;

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
        {langName && <span data-testid="status-bar-language" className="ml-3 text-text-muted">{langName}</span>}
        {line > 0 && <span data-testid="status-bar-cursor" className="ml-3">Ln {line}, Col {col}</span>}
      </div>
    </div>
  );
}
