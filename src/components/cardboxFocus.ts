// Pure decision logic for the cardbox "pending focus" effect, extracted so the
// branch logic can be unit-tested without rendering the heavy CM6/virtualized
// CardboxView. The effect in CardboxView.tsx calls resolvePendingFocus and
// dispatches the returned action.

/**
 * Structural membership view over a UUID collection. Both
 * `ReadonlyMap<string, unknown>` and `ReadonlySet<string>` satisfy this, so the
 * component can pass its existing memoized `annotationMap` / `filteredUuidSet`
 * without allocating anything new.
 */
export interface UuidCollection {
  has(uuid: string): boolean;
  readonly size: number;
}

/**
 * Action the effect should take.
 * - `wait`: do nothing, leave pendingFocusUuid intact (fetch may still be in flight).
 * - `clear`: drop the pending uuid without focusing (F3: annotations settled
 *   empty after load — fetch failed or genuinely empty — so the stale request
 *   must not survive to fire against a later page).
 * - `focus`: consume the pending uuid and scroll/highlight; `clearFilters` is
 *   true when the card is present in annotations but hidden by an active
 *   search/type/color filter, so the effect must reset filters first (F2).
 */
export type PendingFocusAction =
  | { kind: "wait" }
  | { kind: "clear" }
  | { kind: "focus"; uuid: string; clearFilters: boolean };

export function resolvePendingFocus(input: {
  loading: boolean;
  layoutReady: boolean; // store's layoutLoaded: loadLayout has settled
  pendingFocusUuid: string | null;
  annotationUuids: UuidCollection; // pass the component's annotationMap
  filteredUuids: UuidCollection; // pass the component's filteredUuidSet (F2)
}): PendingFocusAction {
  const { loading, layoutReady, pendingFocusUuid, annotationUuids, filteredUuids } = input;

  // 1. Nothing to do until annotations AND the layout have loaded and a focus
  //    is requested. The layout gate (#958): the NOTE section only renders once
  //    loadLayout writes notes into the store, and the saved order must be
  //    applied before scroll positions are computed; consuming earlier skips
  //    the NOTE pulse on a cold cardbox mount. It precedes the F3 clear below
  //    so a slow layout read never triggers a spurious clear.
  if (loading || !layoutReady || !pendingFocusUuid) return { kind: "wait" };

  // 2. F3: annotations have settled empty after load — either the fetch failed
  //    (IPC error) or the page genuinely has none. The in-flight case is already
  //    handled by the loading guard above, so size===0 here is a final state.
  //    Drop the stale pending uuid without focusing; otherwise it would survive
  //    in the global store and fire against a later page's annotations.
  if (annotationUuids.size === 0) return { kind: "clear" };

  // 3. F1 GUARD: the target uuid may have been created on a different cardbox
  //    page while stale annotations from the prior page are still in memory and
  //    the new fetch is in flight. Don't consume pendingFocusUuid yet — wait for
  //    fresh annotations (the effect re-fires when annotationMap identity changes).
  if (!annotationUuids.has(pendingFocusUuid)) return { kind: "wait" };

  // 4. F2: the card exists but an active search/type/color filter hides it from
  //    the rendered grid (filteredUuidSet). Focus it, but signal the effect to
  //    reset filters first so the card is actually in the DOM to scroll to.
  if (!filteredUuids.has(pendingFocusUuid)) {
    return { kind: "focus", uuid: pendingFocusUuid, clearFilters: true };
  }

  // 5. The card is present and visible — focus it.
  return { kind: "focus", uuid: pendingFocusUuid, clearFilters: false };
}

// Remove -> force reflow -> re-add so the CSS animation restarts even when the
// element still carries the class from an earlier focus; the class is dropped
// again once the animation finishes. animationend bubbles and the note pulses
// inside the card, so only react to this element's own animation; `once` alone
// would let a descendant's event consume the listener.
function restartAnimation(el: Element, cls: string): void {
  el.classList.remove(cls);
  void (el as HTMLElement).offsetWidth;
  el.classList.add(cls);
  const onEnd = (e: Event) => {
    if (e.target !== el) return;
    el.classList.remove(cls);
    el.removeEventListener("animationend", onEnd);
  };
  el.addEventListener("animationend", onEnd);
}

/**
 * One-shot focus feedback on a cardbox card: pulses the card's focus ring, and
 * — when navigating from an anchored slip-note — also pulses the card's NOTE
 * section (`[data-testid="card-note-display"]`, absent when the card has no note).
 */
export function applyFocusHighlight(cardEl: HTMLElement, opts: { highlightNote: boolean }): void {
  restartAnimation(cardEl, "card-focus-highlight");
  if (opts.highlightNote) {
    const note = cardEl.querySelector('[data-testid="card-note-display"]');
    if (note) restartAnimation(note, "note-focus-highlight");
  }
}

// Distance to scroll the cardbox grid container so the target card is vertically
// centered *within that container only* — never touching ancestor scrollers
// (which would carry the pane header out of view). Result is clamped to the
// container's scroll range.
export function computeCenteredScrollTop(input: {
  scrollTop: number; // container.scrollTop
  clientHeight: number; // container.clientHeight
  scrollHeight: number; // container.scrollHeight
  cardOffsetTop: number; // cardRect.top - containerRect.top  (card top relative to viewport-aligned container top)
  cardHeight: number; // cardRect.height
}): number {
  const { scrollTop, clientHeight, scrollHeight, cardOffsetTop, cardHeight } = input;
  const desired = scrollTop + cardOffsetTop - (clientHeight - cardHeight) / 2;
  const max = Math.max(0, scrollHeight - clientHeight);
  return Math.min(Math.max(desired, 0), max);
}
