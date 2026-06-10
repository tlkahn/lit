import React, { useCallback, useEffect, useRef } from "react";
import { usePaneStore, findLeaf } from "../stores/panes";
import { useWorkspaceStore } from "../stores/workspace";
import { usePanePdfLinkStore } from "../stores/panePdfLink";
import { registerPdfGoToPage, unregisterPdfGoToPage, registerPdfCurrentPage, unregisterPdfCurrentPage, consumeForwardSync, markForwardSync, clearForwardSync } from "../lib/pdfPaneRef";
import { getPaneView } from "../lib/editorViewRef";
import { getCachedPageMarkers } from "../lib/pageMarkers";
import { dispatchReverseSync } from "../lib/reverseSync";
import { FORWARD_SYNC_GUARD_MS } from "../lib/forwardSync";
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
    (fn: (pageIndex: number) => void, ready: boolean) => {
      registerPdfGoToPage(paneId, fn);
      // Only consume the pending sync once the PDF is ready (pdfInfo set).
      if (!ready) return;
      const pending = usePanePdfLinkStore.getState().consumePendingPdfSync(paneId);
      // Skip page 0: PDF viewers start there by default, so navigating is a
      // no-op. The editor side has no such guard because its cursor may not be
      // at the first marker.
      if (pending !== null && pending !== 0) {
        const token = markForwardSync(paneId);
        fn(pending);
        setTimeout(() => clearForwardSync(paneId, token), FORWARD_SYNC_GUARD_MS);
      }
    },
    [paneId],
  );

  const handleRegisterGetCurrentPage = useCallback(
    (fn: () => number) => registerPdfCurrentPage(paneId, fn),
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
      usePanePdfLinkStore.getState().setCurrentPage(paneId, pageIndex);
      if (consumeForwardSync(paneId)) return;
      const linked = usePanePdfLinkStore.getState().getLinkedPane(paneId);
      if (!linked) return;
      const view = getPaneView(linked);
      if (!view) return;
      const markers = getCachedPageMarkers(view.state.doc);
      dispatchReverseSync(pageIndex, linked, markers);
    },
    [paneId],
  );

  const handlePageCount = useCallback(
    (count: number) => {
      usePanePdfLinkStore.getState().setPageCount(paneId, count);
    },
    [paneId],
  );

  // Drop the registry entry when this pane unmounts so forward sync from a
  // linked editor pane never drives a stale/closed PDF viewer.
  useEffect(() => {
    return () => {
      unregisterPdfGoToPage(paneId);
      unregisterPdfCurrentPage(paneId);
    };
  }, [paneId]);

  const emptyContainerRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (isFocused && !pagePath) {
      emptyContainerRef.current?.focus();
    }
  }, [isFocused, pagePath]);

  const borderClass = isFocused ? "border-interactive-accent" : "border-transparent";

  if (!pagePath || !workspacePath) {
    return (
      <div
        ref={emptyContainerRef}
        data-testid="pdf-viewer-pane"
        data-pane-id={paneId}
        className={`flex min-h-0 flex-1 items-center justify-center border-t-2 ${borderClass}`}
        onMouseDownCapture={handleFocus}
        onFocus={handleFocus}
        tabIndex={-1}
      >
        <div data-testid="pane-empty-state">No page selected</div>
      </div>
    );
  }

  const absolutePath = pagePath.startsWith("/") ? pagePath : `${workspacePath}/${pagePath}`;

  return (
    <div
      data-testid="pdf-viewer-pane"
      data-pane-id={paneId}
      className={`flex min-h-0 flex-1 flex-col border-t-2 ${borderClass}`}
      onMouseDownCapture={handleFocus}
      onFocus={handleFocus}
      tabIndex={-1}
    >
      <PdfViewer
        filePath={absolutePath}
        paneId={paneId}
        registerGoToPage={handleRegisterGoToPage}
        registerGetCurrentPage={handleRegisterGetCurrentPage}
        onPageChange={handlePageChange}
        onPageCount={handlePageCount}
      />
    </div>
  );
}

export const PdfViewerPane = React.memo(PdfViewerPaneInner);
