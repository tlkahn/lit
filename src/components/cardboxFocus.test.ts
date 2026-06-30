import { describe, it, expect } from "vitest";
import { resolvePendingFocus, computeCenteredScrollTop } from "./cardboxFocus";

// Lightweight fixtures: plain Set/Map satisfy the UuidCollection structural
// type, so the resolver can be tested without rendering the heavy CardboxView.
const empty = new Set<string>();

describe("resolvePendingFocus", () => {
  it("waits while loading even if the uuid is present", () => {
    expect(
      resolvePendingFocus({
        loading: true,
        pendingFocusUuid: "x",
        annotationUuids: new Set(["x"]),
        filteredUuids: new Set(["x"]),
      }),
    ).toEqual({ kind: "wait" });
  });

  it("waits when there is no pending uuid", () => {
    expect(
      resolvePendingFocus({
        loading: false,
        pendingFocusUuid: null,
        annotationUuids: new Set(["a", "b"]),
        filteredUuids: new Set(["a", "b"]),
      }),
    ).toEqual({ kind: "wait" });
  });

  // F1 CORE: target uuid created on a different page is absent from the stale
  // annotations still in memory while the new fetch is in flight. The resolver
  // must wait (preserving pendingFocusUuid) instead of consuming it.
  it("waits when the target uuid is absent from current annotations (stale page)", () => {
    expect(
      resolvePendingFocus({
        loading: false,
        pendingFocusUuid: "x",
        annotationUuids: new Set(["a", "b"]),
        filteredUuids: empty,
      }),
    ).toEqual({ kind: "wait" });
  });

  // F2 CORE: target uuid is present in current annotations but hidden by an
  // active search/type/color filter (absent from filteredUuids). The resolver
  // must focus AND request a filter reset so the card is in the DOM.
  it("focuses with clearFilters when the uuid is filtered out but present", () => {
    expect(
      resolvePendingFocus({
        loading: false,
        pendingFocusUuid: "x",
        annotationUuids: new Set(["x", "b"]),
        filteredUuids: new Set(["b"]),
      }),
    ).toEqual({ kind: "focus", uuid: "x", clearFilters: true });
  });

  // F2 variant: all annotations filtered out (empty filteredUuids) but the
  // target is present in annotations. Distinct from the F1 stale-page case
  // (which omits the uuid from annotationUuids and expects "wait").
  it("focuses with clearFilters when everything is filtered out but the uuid is present", () => {
    expect(
      resolvePendingFocus({
        loading: false,
        pendingFocusUuid: "x",
        annotationUuids: new Set(["x", "b"]),
        filteredUuids: empty,
      }),
    ).toEqual({ kind: "focus", uuid: "x", clearFilters: true });
  });

  // F3 CORE: a fetch failed (IPC error) or genuinely returned nothing, so after
  // load annotations are empty. The stale pending uuid must be dropped (clear)
  // rather than left to fire against a later, unrelated page's annotations.
  it("clears the stale pending uuid when annotations are empty after load", () => {
    expect(
      resolvePendingFocus({
        loading: false,
        pendingFocusUuid: "x",
        annotationUuids: new Set(),
        filteredUuids: new Set(),
      }),
    ).toEqual({ kind: "clear" });
  });

  // F3 ordering guard: the size===0 clear branch must sit AFTER the loading
  // guard, so an in-flight fetch (loading true, annotations not yet arrived)
  // still waits and preserves the pending uuid.
  it("still waits while loading even with empty annotations", () => {
    expect(
      resolvePendingFocus({
        loading: true,
        pendingFocusUuid: "x",
        annotationUuids: new Set(),
        filteredUuids: new Set(),
      }),
    ).toEqual({ kind: "wait" });
  });

  // F3 boundary: no pending uuid + empty annotations is still a wait (nothing to
  // clear), since the no-pending guard precedes the size===0 check.
  it("waits when annotations are empty and there is no pending uuid", () => {
    expect(
      resolvePendingFocus({
        loading: false,
        pendingFocusUuid: null,
        annotationUuids: new Set(),
        filteredUuids: new Set(),
      }),
    ).toEqual({ kind: "wait" });
  });

  it("focuses when the uuid is present in current annotations", () => {
    expect(
      resolvePendingFocus({
        loading: false,
        pendingFocusUuid: "x",
        annotationUuids: new Set(["x", "b"]),
        filteredUuids: new Set(["x"]),
      }),
    ).toEqual({ kind: "focus", uuid: "x", clearFilters: false });
  });

  it("accepts a ReadonlyMap as annotationUuids (component passes annotationMap directly)", () => {
    const annotationMap = new Map<string, { uuid: string }>([["x", { uuid: "x" }]]);
    expect(
      resolvePendingFocus({
        loading: false,
        pendingFocusUuid: "x",
        annotationUuids: annotationMap,
        filteredUuids: new Set(["x"]),
      }),
    ).toEqual({ kind: "focus", uuid: "x", clearFilters: false });
  });
});

describe("computeCenteredScrollTop", () => {
  // C1: a mid-list card centers within the container — no clamping in play.
  it("centers a mid-list card", () => {
    expect(
      computeCenteredScrollTop({
        scrollTop: 0,
        clientHeight: 600,
        scrollHeight: 2000,
        cardOffsetTop: 400,
        cardHeight: 100,
      }),
    ).toBe(150); // 0 + 400 - (600 - 100) / 2
  });

  // C2: a near-bottom card whose centered target exceeds the scroll range is
  // clamped to scrollHeight - clientHeight. This is the regression case that
  // used to make an ancestor scroll instead (carrying the pane header away).
  it("clamps at the bottom to scrollHeight - clientHeight", () => {
    expect(
      computeCenteredScrollTop({
        scrollTop: 1400,
        clientHeight: 600,
        scrollHeight: 2000,
        cardOffsetTop: 500,
        cardHeight: 100,
      }),
    ).toBe(1400); // desired 1850 clamped to 2000 - 600
  });

  // C3: a near-top card whose centered target is negative clamps to 0.
  it("clamps at the top and never returns a negative value", () => {
    expect(
      computeCenteredScrollTop({
        scrollTop: 0,
        clientHeight: 600,
        scrollHeight: 2000,
        cardOffsetTop: 0,
        cardHeight: 100,
      }),
    ).toBe(0); // desired -250 clamped to 0
  });

  // C4: a card already centered yields a value equal to the current scrollTop.
  it("is a no-op for an already-centered card", () => {
    expect(
      computeCenteredScrollTop({
        scrollTop: 300,
        clientHeight: 600,
        scrollHeight: 2000,
        cardOffsetTop: 250,
        cardHeight: 100,
      }),
    ).toBe(300); // 300 + 250 - (600 - 100) / 2
  });
});
