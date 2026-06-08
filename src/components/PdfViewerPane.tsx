import React, { useCallback, useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { usePaneStore, findLeaf } from "../stores/panes";
import { useWorkspaceStore } from "../stores/workspace";
import { usePanePdfLinkStore } from "../stores/panePdfLink";
import { usePdfCacheProgressStore } from "../stores/pdfCacheProgress";
import type { PdfCacheProgress } from "../lib/ipc";
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

  // Subscribe to the backend's window-scoped precache progress events and route
  // only this pane's events into the progress store. The slot is the composite
  // "<window_label>:<paneId>"; paneIds are colon-free UUIDs, so the segment after
  // the LAST ':' is unambiguously this pane's id. `done` events clear the entry so
  // the status-bar indicator disappears; other events update it.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let active = true;
    listen<PdfCacheProgress>("lit:pdf-cache-progress", (e) => {
      const p = e.payload;
      const slotPane = p.slot.slice(p.slot.lastIndexOf(":") + 1);
      if (slotPane !== paneId) return;
      const store = usePdfCacheProgressStore.getState();
      if (p.done) store.clear(p.slot);
      else store.update(p.slot, p.current, p.total, p.done);
    }).then((un) => {
      if (active) unlisten = un;
      else un();
    });
    return () => {
      active = false;
      unlisten?.();
      // Drop any lingering progress entry for this pane so a closed PDF never
      // leaves a stale "Caching PDF…" indicator behind.
      const store = usePdfCacheProgressStore.getState();
      for (const slot of [...store.progress.keys()]) {
        if (slot.slice(slot.lastIndexOf(":") + 1) === paneId) store.clear(slot);
      }
    };
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

  const absolutePath = pagePath.startsWith("/") ? pagePath : `${workspacePath}/${pagePath}`;

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
