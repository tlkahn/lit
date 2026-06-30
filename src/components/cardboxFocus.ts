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
  pendingFocusUuid: string | null;
  annotationUuids: UuidCollection; // pass the component's annotationMap
  filteredUuids: UuidCollection; // pass the component's filteredUuidSet (F2)
}): PendingFocusAction {
  const { loading, pendingFocusUuid, annotationUuids, filteredUuids } = input;

  // 1. Nothing to do until annotations have loaded and a focus is requested.
  if (loading || !pendingFocusUuid) return { kind: "wait" };

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
