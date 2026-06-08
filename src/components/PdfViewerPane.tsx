import React, { useCallback, useEffect } from "react";
import { usePaneStore, findLeaf } from "../stores/panes";
import { useWorkspaceStore } from "../stores/workspace";
import { usePanePdfLinkStore } from "../stores/panePdfLink";
import { registerPdfGoToPage, unregisterPdfGoToPage } from "../lib/pdfPaneRef";
import { getPaneView } from "../lib/editorViewRef";
import { parsePageMarkers } from "../lib/pageMarkers";
import { dispatchReverseSync } from "../lib/reverseSync";
import { PdfViewer } from "./PdfViewer";

interface PdfViewerPaneProps {
  paneId: string;
}

function PdfViewerPaneInner({ paneId }: PdfViewerPaneProps) {
  const pagePath = usePaneStore((s) => findLeaf(s.root, paneId)?.pagePath ?? null);
  const isFocused = usePaneStore((s) => s.focusedPaneId === paneId);
  const workspacePath = useWorkspaceStore((s) => s.workspacePath);

  const handleFocus = useCallback(() => {
    usePaneStore.getState().focusPane(paneId);
  }, [paneId]);

  const handleRegisterGoToPage = useCallback(
    (fn: (pageIndex: number) => void) => registerPdfGoToPage(paneId, fn),
    [paneId],
  );

  // Reverse sync (PDF -> md): when this PDF pane changes page, scroll the LINKED
  // editor to the matching page marker. Symmetric to EditorPane forward sync,
  // which reads its OWN view+markers; here we read the linked editor's view and
  // re-parse its markers per page change (cheap; avoids a stale-doc ref, matching
  // the Phase 3 decision to skip marker caching). reverseSync records
  // lastSyncedPage, which suppresses the forward-sync echo so this does not loop.
  const handlePageChange = useCallback(
    (pageIndex: number) => {
      // Best-effort: record the live page for the status-bar linked indicator.
      usePanePdfLinkStore.getState().setCurrentPage(paneId, pageIndex);
      const linked = usePanePdfLinkStore.getState().getLinkedPane(paneId);
      if (!linked) return;
      const view = getPaneView(linked);
      if (!view) return;
      const markers = parsePageMarkers(view.state.doc.toString());
      dispatchReverseSync(pageIndex, linked, markers);
    },
    [paneId],
  );

  // Drop the registry entry when this pane unmounts so forward sync from a
  // linked editor pane never drives a stale/closed PDF viewer.
  useEffect(() => {
    return () => unregisterPdfGoToPage(paneId);
  }, [paneId]);

  const borderClass = isFocused ? "border-interactive-accent" : "border-transparent";

  if (!pagePath || !workspacePath) {
    return (
      <div
        data-testid="pdf-viewer-pane"
        className={`flex min-h-0 flex-1 items-center justify-center border-t-2 ${borderClass}`}
        onMouseDownCapture={handleFocus}
        onFocus={handleFocus}
        tabIndex={-1}
      >
        <div data-testid="pane-empty-state">No page selected</div>
      </div>
    );
  }

  const absolutePath = `${workspacePath}/${pagePath}`;

  return (
    <div
      data-testid="pdf-viewer-pane"
      className={`flex min-h-0 flex-1 flex-col border-t-2 ${borderClass}`}
      onMouseDownCapture={handleFocus}
      onFocus={handleFocus}
      tabIndex={-1}
    >
      <PdfViewer
        filePath={absolutePath}
        paneId={paneId}
        registerGoToPage={handleRegisterGoToPage}
        onPageChange={handlePageChange}
      />
    </div>
  );
}

export const PdfViewerPane = React.memo(PdfViewerPaneInner);
