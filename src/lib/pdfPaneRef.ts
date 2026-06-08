// Imperative registry of per-pane PDF page-navigation callbacks, mirroring
// editorViewRef. Forward sync (md -> PDF) looks up the linked PDF pane's
// goToPage here to drive it, avoiding controlled `page` state plumbing through
// the pane store (which risks the onPageChange/page feedback loop in PdfViewer).

type GoToPage = (pageIndex: number) => void;

const goToPageFns = new Map<string, GoToPage>();

export function registerPdfGoToPage(paneId: string, fn: GoToPage): void {
  goToPageFns.set(paneId, fn);
}

export function unregisterPdfGoToPage(paneId: string): void {
  goToPageFns.delete(paneId);
}

export function getPdfGoToPage(paneId: string): GoToPage | null {
  return goToPageFns.get(paneId) ?? null;
}

export function _resetForTesting(): void {
  goToPageFns.clear();
}
