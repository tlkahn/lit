import { pageForOffset } from "./pageMarkers";
import type { PageMarker } from "./pageMarkers";
import { usePanePdfLinkStore } from "../stores/panePdfLink";

/** Debounce window for cursor-driven md -> PDF page navigation. */
export const DEBOUNCE_MS = 150;

/**
 * Echo-guard window. Reverse sync (PDF -> md) records the target page in the
 * store right before it scrolls the editor; that scroll fires an editor
 * selection change, which schedules a forward sync DEBOUNCE_MS later. When that
 * forward sync fires and resolves to the SAME page within this window, it is the
 * echo of the reverse sync and is suppressed — otherwise the PDF would bounce
 * back to the page it just left.
 *
 * Must comfortably exceed DEBOUNCE_MS so the echo's trailing-edge fire is still
 * inside the window. A genuine later cursor move to the same page (after the
 * window) is NOT suppressed and re-syncs normally.
 */
export const ECHO_GUARD_MS = 300;

export interface ForwardSyncArgs {
  /**
   * Reads the cursor offset and page markers at FIRE time (inside the
   * trailing-edge timer), not at schedule time. Reading here — rather than
   * capturing plain values in the closure — closes the window where a document
   * edit during the debounce window (one that mutates the doc/cursor WITHOUT
   * firing a new selection change, e.g. a programmatic edit or external sync)
   * would otherwise leave the captured markers/offset stale. Returns null if
   * the source view has disappeared between schedule and fire.
   */
  read: () => { offset: number; markers: PageMarker[] } | null;
  /** Drives the linked PDF pane to a 0-based page index. */
  goToPage: (pageIndex: number) => void;
}

// Module-level singleton timer (trailing-edge debounce). NOTE: a single shared
// timer means two editor panes syncing simultaneously would cancel each other;
// the current product only links one editor<->PDF pair at a time, so this is an
// accepted limitation. Key by source paneId if multi-pane sync is ever needed.
let timer: ReturnType<typeof setTimeout> | null = null;

/**
 * Schedule a forward sync. Cancels any pending sync and schedules a fresh one so
 * only the most recent cursor position drives the PDF after the user pauses.
 *
 * The page is resolved (and the echo guard consulted) at FIRE time inside the
 * trailing-edge timer, not at call time — the resolved page index is what the
 * guard compares against the store's lastSyncedPage (see ECHO_GUARD_MS).
 */
export function dispatchForwardSync({ read, goToPage }: ForwardSyncArgs): void {
  if (timer !== null) clearTimeout(timer);
  console.log("[sync:fwd] scheduled (debounce %dms)", DEBOUNCE_MS);
  timer = setTimeout(() => {
    timer = null;
    if (!usePanePdfLinkStore.getState().syncEnabled) {
      console.log("[sync:fwd] BAIL — syncEnabled=false");
      return;
    }
    const data = read();
    if (!data) {
      console.log("[sync:fwd] BAIL — read() returned null (view gone?)");
      return;
    }
    console.log("[sync:fwd] fire: offset=%d, markers=%d", data.offset, data.markers.length);
    const resolved = pageForOffset(data.markers, data.offset);
    const last = usePanePdfLinkStore.getState().lastSyncedPage;
    if (last !== null && last.page === resolved && Date.now() - last.at < ECHO_GUARD_MS) {
      console.log("[sync:fwd] SUPPRESSED by echo guard (page=%d, age=%dms)", resolved, Date.now() - last.at);
      return;
    }
    console.log("[sync:fwd] → goToPage(%d)", resolved);
    goToPage(resolved);
  }, DEBOUNCE_MS);
}

export function _resetForTesting(): void {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
}
