// Imperative registry of per-pane PDF page-navigation callbacks, mirroring
// editorViewRef. Forward sync (md -> PDF) looks up the linked PDF pane's
// goToPage here to drive it, avoiding controlled `page` state plumbing through
// the pane store (which risks the onPageChange/page feedback loop in PdfViewer).

type GoToPage = (pageIndex: number) => void;

const goToPageFns = new Map<string, GoToPage>();

// Tracks which PDF panes are currently in a forward-sync-initiated page change.
// Maps paneId -> a monotonic per-navigation token. Set before calling goToPage,
// consumed inside handlePageChange to suppress the reverse-sync echo that would
// yank the editor cursor. The token lets a stale safety-net cleanup distinguish
// the navigation it belongs to from a newer (or still-pending) one.
const forwardSyncInFlight = new Map<string, number>();
let nextToken = 1;

export function registerPdfGoToPage(paneId: string, fn: GoToPage): void {
  goToPageFns.set(paneId, fn);
}

export function unregisterPdfGoToPage(paneId: string): void {
  goToPageFns.delete(paneId);
}

export function getPdfGoToPage(paneId: string): GoToPage | null {
  return goToPageFns.get(paneId) ?? null;
}

/** Marks a forward-sync navigation in flight; returns its token. */
export function markForwardSync(paneId: string): number {
  const token = nextToken++;
  forwardSyncInFlight.set(paneId, token);
  return token;
}

/** Returns true if a forward-sync flag was present (and consumes it). */
export function consumeForwardSync(paneId: string): boolean {
  return forwardSyncInFlight.delete(paneId);
}

/**
 * Silently removes a stale forward-sync flag (safety cleanup), but only if the
 * stored token still matches. A slow real navigation's onPageChange will have
 * already consumed (or replaced) the flag, so a late same-page-guard timeout
 * becomes a no-op instead of clobbering an in-flight flag.
 */
export function clearForwardSync(paneId: string, token: number): void {
  if (forwardSyncInFlight.get(paneId) === token) {
    forwardSyncInFlight.delete(paneId);
  }
}

export function _resetForTesting(): void {
  goToPageFns.clear();
  forwardSyncInFlight.clear();
  nextToken = 1;
}
