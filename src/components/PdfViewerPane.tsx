import React, { useCallback, useEffect } from "react";
import { usePaneStore, findLeaf } from "../stores/panes";
import { useWorkspaceStore } from "../stores/workspace";
import { usePanePdfLinkStore } from "../stores/panePdfLink";
import { registerPdfGoToPage, unregisterPdfGoToPage, consumeForwardSync } from "../lib/pdfPaneRef";
import { getPaneView } from "../lib/editorViewRef";
import { getCachedPageMarkers } from "../lib/pageMarkers";
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
  // use getCachedPageMarkers (shared single-entry cache keyed by Text identity).
  // reverseSync records lastSyncedPage, which suppresses the forward-sync echo
  // so this does not loop.
  const handlePageChange = useCallback(
    (pageIndex: number) => {
      console.log("[sync:rev:pdf] onPageChange page=%d pane=%s", pageIndex, paneId);
      usePanePdfLinkStore.getState().setCurrentPage(paneId, pageIndex);
      if (consumeForwardSync(paneId)) {
        console.log("[sync:rev:pdf] SKIP — forward-sync initiated this page change");
        return;
      }
      const linked = usePanePdfLinkStore.getState().getLinkedPane(paneId);
      if (!linked) {
        console.log("[sync:rev:pdf] no linked editor pane for %s", paneId);
        return;
      }
      const view = getPaneView(linked);
      if (!view) {
        console.log("[sync:rev:pdf] no EditorView for linked pane %s", linked);
        return;
      }
      const markers = getCachedPageMarkers(view.state.doc);
      console.log("[sync:rev:pdf] dispatching reverse sync: page=%d, markers=%d, editor=%s", pageIndex, markers.length, linked);
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
