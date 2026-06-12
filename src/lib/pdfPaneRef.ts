// Imperative registry of per-pane PDF page-navigation callbacks, mirroring
// editorViewRef. Forward sync (md -> PDF) looks up the linked PDF pane's
// goToPage here to drive it, avoiding controlled `page` state plumbing through
// the pane store (which risks the onPageChange/page feedback loop in PdfViewer).

import { usePaneStore, findLeaf } from "../stores/panes";
import { useWorkspaceStore } from "../stores/workspace";
import { usePanePdfLinkStore } from "../stores/panePdfLink";
import { getFileType } from "../hooks/useLeafFileType";

type GoToPage = (pageIndex: number) => void;

const goToPageFns = new Map<string, GoToPage>();

// Parallel registry exposing each PDF pane's SYNCHRONOUS current page (the
// viewer's currentPageRef). The pane store's currentPage only updates after the
// async render resolves, so a rapid second StatusBar click would read a stale
// value and recompute the same target (dropped by goToPage's same-page guard).
// Reading this live getter mirrors the keyboard handler's proven approach.
type GetCurrentPage = () => number;

const currentPageFns = new Map<string, GetCurrentPage>();

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

export function registerPdfCurrentPage(paneId: string, fn: GetCurrentPage): void {
  currentPageFns.set(paneId, fn);
}

export function unregisterPdfCurrentPage(paneId: string): void {
  currentPageFns.delete(paneId);
}

export function getPdfCurrentPage(paneId: string): number | null {
  const fn = currentPageFns.get(paneId);
  return fn ? fn() : null;
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

// --- Zoom handler registry ---

export interface PdfZoomHandlers {
  zoomIn: () => void;
  zoomOut: () => void;
  zoomReset: () => void;
}

const zoomHandlerFns = new Map<string, PdfZoomHandlers>();

export function registerPdfZoomHandlers(paneId: string, handlers: PdfZoomHandlers): void {
  zoomHandlerFns.set(paneId, handlers);
}

export function unregisterPdfZoomHandlers(paneId: string): void {
  zoomHandlerFns.delete(paneId);
}

export function getPdfZoomHandlers(paneId: string): PdfZoomHandlers | null {
  return zoomHandlerFns.get(paneId) ?? null;
}

/**
 * Resolve the focused PDF pane: returns the focused pane ID only if it is
 * itself a PDF. Returns null when focus is in an editor or any non-PDF pane.
 * Used by zoom keyboard shortcuts to avoid colliding with editor bindings
 * that share the same chord (e.g. Ctrl-- for editor.navigateBack on Linux).
 */
export function getFocusedPdfPaneId(): string | null {
  const { focusedPaneId, root } = usePaneStore.getState();
  const pages = useWorkspaceStore.getState().pages;
  const leaf = findLeaf(root, focusedPaneId);
  if (leaf && getFileType(leaf.pagePath, pages) === "pdf") return focusedPaneId;
  return null;
}

/**
 * Resolve the active PDF pane: the focused pane if it's a PDF, otherwise the
 * linked pane (via panePdfLink) if it's a PDF. Returns null when no PDF pane
 * is reachable. Used by global commands (pdf.zoomIn etc.) to find their target.
 */
export function getActivePdfPaneId(): string | null {
  const { focusedPaneId, root } = usePaneStore.getState();
  const pages = useWorkspaceStore.getState().pages;
  const leaf = findLeaf(root, focusedPaneId);
  if (leaf && getFileType(leaf.pagePath, pages) === "pdf") return focusedPaneId;
  const linked = usePanePdfLinkStore.getState().getLinkedPane(focusedPaneId);
  if (!linked) return null;
  const linkedLeaf = findLeaf(root, linked);
  if (linkedLeaf && getFileType(linkedLeaf.pagePath, pages) === "pdf") return linked;
  return null;
}

export function _resetForTesting(): void {
  goToPageFns.clear();
  currentPageFns.clear();
  zoomHandlerFns.clear();
  forwardSyncInFlight.clear();
  nextToken = 1;
}
