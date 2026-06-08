// Imperative registry of per-pane PDF page-navigation callbacks, mirroring
// editorViewRef. Forward sync (md -> PDF) looks up the linked PDF pane's
// goToPage here to drive it, avoiding controlled `page` state plumbing through
// the pane store (which risks the onPageChange/page feedback loop in PdfViewer).

type GoToPage = (pageIndex: number) => void;

const goToPageFns = new Map<string, GoToPage>();

// Tracks which PDF panes are currently in a forward-sync-initiated page change.
// Set before calling goToPage, consumed inside handlePageChange to suppress
// the reverse-sync echo that would yank the editor cursor.
const forwardSyncInFlight = new Set<string>();

export function registerPdfGoToPage(paneId: string, fn: GoToPage): void {
  goToPageFns.set(paneId, fn);
}

export function unregisterPdfGoToPage(paneId: string): void {
  goToPageFns.delete(paneId);
}

export function getPdfGoToPage(paneId: string): GoToPage | null {
  return goToPageFns.get(paneId) ?? null;
}

export function markForwardSync(paneId: string): void {
  forwardSyncInFlight.add(paneId);
}

/** Returns true if a forward-sync flag was present (and consumes it). */
export function consumeForwardSync(paneId: string): boolean {
  return forwardSyncInFlight.delete(paneId);
}

/** Silently removes a stale forward-sync flag (safety cleanup). */
export function clearForwardSync(paneId: string): void {
  forwardSyncInFlight.delete(paneId);
}

export function _resetForTesting(): void {
  goToPageFns.clear();
  forwardSyncInFlight.clear();
}
