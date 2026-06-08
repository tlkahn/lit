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
  /** Absolute char offset of the cursor in the (frontmatter-stripped) body. */
  offset: number;
  /** Page markers parsed from the same body. */
  markers: PageMarker[];
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
export function dispatchForwardSync({ offset, markers, goToPage }: ForwardSyncArgs): void {
  if (timer !== null) clearTimeout(timer);
  // Capture this call's args in the closure so the trailing-edge fire uses the
  // most recent values (no stale-closure bug across rapid calls).
  timer = setTimeout(() => {
    timer = null;
    // Sync toggle is checked at FIRE time (not schedule time) so a toggle during
    // the debounce window is honored.
    if (!usePanePdfLinkStore.getState().syncEnabled) return;
    const resolved = pageForOffset(markers, offset);
    // Echo guard: suppress the forward sync that reverse sync just triggered.
    const last = usePanePdfLinkStore.getState().lastSyncedPage;
    if (last !== null && last.page === resolved && Date.now() - last.at < ECHO_GUARD_MS) {
      return;
    }
    goToPage(resolved);
  }, DEBOUNCE_MS);
}

export function _resetForTesting(): void {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
}
