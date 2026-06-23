import React, { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { usePaneStore, findLeaf } from "../stores/panes";
import { useWorkspaceStore } from "../stores/workspace";
import { usePanePdfLinkStore } from "../stores/panePdfLink";
import { registerPdfGoToPage, unregisterPdfGoToPage, registerPdfCurrentPage, unregisterPdfCurrentPage, consumeForwardSync, markForwardSync } from "../lib/pdfPaneRef";
import { getPaneView, setFocusedPane } from "../lib/editorViewRef";
import { getCachedPageMarkers } from "../lib/pageMarkers";
import { dispatchReverseSync } from "../lib/reverseSync";
import { PdfViewer } from "./PdfViewer";
import { useEmptyPaneFocus } from "../hooks/useEmptyPaneFocus";

interface PdfViewerPaneProps {
  paneId: string;
}

function PdfViewerPaneInner({ paneId }: PdfViewerPaneProps) {
  const pagePath = usePaneStore((s) => findLeaf(s.root, paneId)?.pagePath ?? null);
  const isFocused = usePaneStore((s) => s.focusedPaneId === paneId);
  const workspacePath = useWorkspaceStore((s) => s.workspacePath);

  const handleFocus = useCallback(() => {
    usePaneStore.getState().focusPane(paneId);
    setFocusedPane(paneId);
  }, [paneId]);

  // Non-destructive peek during render: safe to repeat across discarded renders
  // in concurrent mode. The value is available synchronously for the first paint
  // so PdfViewer receives the correct initialPage without a page-0 flash.
  const initialPageRef = useRef<number | undefined>(undefined);
  const consumedRef = useRef(false);

  // Reset one-shot guards when a different PDF is opened in the same pane
  // (component stays mounted because paneId is stable; only pagePath changes).
  const prevPagePathRef = useRef(pagePath);
  if (prevPagePathRef.current !== pagePath) {
    prevPagePathRef.current = pagePath;
    initialPageRef.current = undefined;
    consumedRef.current = false;
  }

  if (initialPageRef.current === undefined) {
    const pending = usePanePdfLinkStore.getState().pendingPdfSync.get(paneId);
    initialPageRef.current = pending ?? 0;
  }

  // Destructive consume in commit phase (useLayoutEffect): runs exactly once per
  // committed render, before any regular useEffects. This ensures markForwardSync
  // is set before PdfViewer's document-load useEffect fires onPageChange, keeping
  // reverse-sync echo suppression correct.
  useLayoutEffect(() => {
    if (consumedRef.current) return;
    consumedRef.current = true;
    const pending = usePanePdfLinkStore.getState().consumePendingPdfSync(paneId);
    if (pending !== null && pending !== 0) {
      markForwardSync(paneId);
    }
  }, [paneId, pagePath]);

  const handleRegisterGoToPage = useCallback(
    (fn: (pageIndex: number) => void) => {
      registerPdfGoToPage(paneId, fn);
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
      // Compensate for OCR first-page trimming: the original PDF's page maps onto
      // the editor's 0-indexed page markers by subtracting the stored offset.
      const offset = usePanePdfLinkStore.getState().getPageOffset(linked);
      dispatchReverseSync(pageIndex - offset, linked, markers);
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
      consumeForwardSync(paneId);
    };
  }, [paneId]);

  // Keep the module-level focusedPaneId in sync when this pane becomes focused
  // programmatically (e.g., closing a sibling pane causes fallback focus via the
  // store). Mirrors the same effect in CodeEditorPane and EditorPane.
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isFocused) {
      setFocusedPane(paneId);
      containerRef.current?.focus();
    }
  }, [isFocused, paneId]);

  const emptyContainerRef = useEmptyPaneFocus(isFocused, pagePath);

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

  // pagePath can be an absolute path outside the workspace root (e.g. when
  // a companion PDF is found via an absolute search path in preferences, or
  // when restoring a saved layout that recorded such a path). PdfViewer.tsx
  // handles extending the Tauri asset protocol scope before loading so that
  // the asset:// URL works regardless of where the file lives on disk.
  const absolutePath = pagePath.startsWith("/") ? pagePath : `${workspacePath}/${pagePath}`;

  return (
    <div
      ref={containerRef}
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
        initialPage={initialPageRef.current}
        registerGoToPage={handleRegisterGoToPage}
        registerGetCurrentPage={handleRegisterGetCurrentPage}
        onPageChange={handlePageChange}
        onPageCount={handlePageCount}
      />
    </div>
  );
}

export const PdfViewerPane = React.memo(PdfViewerPaneInner);
