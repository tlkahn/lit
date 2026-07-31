import { describe, it, expect } from "vitest";
import {
  resolvePendingFocus,
  computeCenteredScrollTop,
  computeCollapseScrollTop,
  applyFocusHighlight,
} from "./cardboxFocus";

// Lightweight fixtures: plain Set/Map satisfy the UuidCollection structural
// type, so the resolver can be tested without rendering the heavy CardboxView.
const empty = new Set<string>();

describe("resolvePendingFocus", () => {
  it("waits while loading even if the uuid is present", () => {
    expect(
      resolvePendingFocus({
        layoutReady: true,
        loading: true,
        pendingFocusUuid: "x",
        annotationUuids: new Set(["x"]),
        filteredUuids: new Set(["x"]),
      }),
    ).toEqual({ kind: "wait" });
  });

  // Layout gate (#958 finding 1): the NOTE section only renders once loadLayout
  // has written notes into the store, and the saved order must be applied
  // before scroll positions are computed. Consuming the pending focus earlier
  // silently skips the NOTE pulse on a cold cardbox mount.
  it("waits while the layout has not loaded even if the uuid is present and visible", () => {
    expect(
      resolvePendingFocus({
        layoutReady: false,
        loading: false,
        pendingFocusUuid: "x",
        annotationUuids: new Set(["x"]),
        filteredUuids: new Set(["x"]),
      }),
    ).toEqual({ kind: "wait" });
  });

  // Ordering guard: the layout gate must precede the F3 empty-annotations
  // clear, so a slow layout read never triggers a spurious clear.
  it("still waits (not clear) with empty annotations while the layout is loading", () => {
    expect(
      resolvePendingFocus({
        layoutReady: false,
        loading: false,
        pendingFocusUuid: "x",
        annotationUuids: new Set(),
        filteredUuids: new Set(),
      }),
    ).toEqual({ kind: "wait" });
  });

  it("waits when there is no pending uuid", () => {
    expect(
      resolvePendingFocus({
        layoutReady: true,
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
        layoutReady: true,
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
        layoutReady: true,
        loading: false,
        pendingFocusUuid: "x",
        annotationUuids: new Set(["x", "b"]),
        filteredUuids: new Set(["b"]),
      }),
    ).toEqual({ kind: "focus", uuid: "x", clearFilters: true, expandGroupId: null });
  });

  // F2 variant: all annotations filtered out (empty filteredUuids) but the
  // target is present in annotations. Distinct from the F1 stale-page case
  // (which omits the uuid from annotationUuids and expects "wait").
  it("focuses with clearFilters when everything is filtered out but the uuid is present", () => {
    expect(
      resolvePendingFocus({
        layoutReady: true,
        loading: false,
        pendingFocusUuid: "x",
        annotationUuids: new Set(["x", "b"]),
        filteredUuids: empty,
      }),
    ).toEqual({ kind: "focus", uuid: "x", clearFilters: true, expandGroupId: null });
  });

  // F3 CORE: a fetch failed (IPC error) or genuinely returned nothing, so after
  // load annotations are empty. The stale pending uuid must be dropped (clear)
  // rather than left to fire against a later, unrelated page's annotations.
  it("clears the stale pending uuid when annotations are empty after load", () => {
    expect(
      resolvePendingFocus({
        layoutReady: true,
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
        layoutReady: true,
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
        layoutReady: true,
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
        layoutReady: true,
        loading: false,
        pendingFocusUuid: "x",
        annotationUuids: new Set(["x", "b"]),
        filteredUuids: new Set(["x"]),
      }),
    ).toEqual({ kind: "focus", uuid: "x", clearFilters: false, expandGroupId: null });
  });

  it("accepts a ReadonlyMap as annotationUuids (component passes annotationMap directly)", () => {
    const annotationMap = new Map<string, { uuid: string }>([["x", { uuid: "x" }]]);
    expect(
      resolvePendingFocus({
        layoutReady: true,
        loading: false,
        pendingFocusUuid: "x",
        annotationUuids: annotationMap,
        filteredUuids: new Set(["x"]),
      }),
    ).toEqual({ kind: "focus", uuid: "x", clearFilters: false, expandGroupId: null });
  });

  // F4 (#972): target lives inside a collapsed group — expand the group so the
  // card is in the DOM for scroll/highlight.
  it("focuses with expandGroupId when the uuid is in a collapsed group", () => {
    expect(
      resolvePendingFocus({
        layoutReady: true,
        loading: false,
        pendingFocusUuid: "x",
        annotationUuids: new Set(["x", "b"]),
        filteredUuids: new Set(["x", "b"]),
        groups: {
          g1: { order: ["x"], collapsed: true },
          g2: { order: ["b"], collapsed: false },
        },
      }),
    ).toEqual({ kind: "focus", uuid: "x", clearFilters: false, expandGroupId: "g1" });
  });

  it("focuses with expandGroupId null when the uuid is in an expanded group", () => {
    expect(
      resolvePendingFocus({
        layoutReady: true,
        loading: false,
        pendingFocusUuid: "x",
        annotationUuids: new Set(["x"]),
        filteredUuids: new Set(["x"]),
        groups: { g1: { order: ["x"], collapsed: false } },
      }),
    ).toEqual({ kind: "focus", uuid: "x", clearFilters: false, expandGroupId: null });
  });

  it("focuses with expandGroupId null when the uuid is ungrouped or groups omitted", () => {
    expect(
      resolvePendingFocus({
        layoutReady: true,
        loading: false,
        pendingFocusUuid: "x",
        annotationUuids: new Set(["x"]),
        filteredUuids: new Set(["x"]),
        groups: { g1: { order: ["other"], collapsed: true } },
      }),
    ).toEqual({ kind: "focus", uuid: "x", clearFilters: false, expandGroupId: null });

    expect(
      resolvePendingFocus({
        layoutReady: true,
        loading: false,
        pendingFocusUuid: "x",
        annotationUuids: new Set(["x"]),
        filteredUuids: new Set(["x"]),
      }),
    ).toEqual({ kind: "focus", uuid: "x", clearFilters: false, expandGroupId: null });
  });

  // F4 + F2: collapsed group AND filter-hidden still carries both signals.
  it("combines clearFilters with expandGroupId when both apply", () => {
    expect(
      resolvePendingFocus({
        layoutReady: true,
        loading: false,
        pendingFocusUuid: "x",
        annotationUuids: new Set(["x", "b"]),
        filteredUuids: new Set(["b"]),
        groups: { g1: { order: ["x"], collapsed: true } },
      }),
    ).toEqual({ kind: "focus", uuid: "x", clearFilters: true, expandGroupId: "g1" });
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

describe("computeCollapseScrollTop", () => {
  // V1: the collapsed card is still fully inside the container viewport — no
  // correction, so the reader's scroll position is left alone (#939).
  it("returns null when the card is fully visible", () => {
    expect(
      computeCollapseScrollTop({
        scrollTop: 500,
        clientHeight: 600,
        scrollHeight: 2000,
        cardOffsetTop: 100,
        cardHeight: 100,
      }),
    ).toBeNull();
  });

  // V2: boundary — card exactly fills the viewport edge-to-edge; still visible.
  it("returns null when the card exactly spans the viewport edges", () => {
    expect(
      computeCollapseScrollTop({
        scrollTop: 500,
        clientHeight: 600,
        scrollHeight: 2000,
        cardOffsetTop: 0,
        cardHeight: 600,
      }),
    ).toBeNull();
  });

  // V3: the big-collapse case from #939 — the reader scrolled deep into a long
  // expanded card; after collapse the card sits entirely above the viewport.
  it("centers the card when it is entirely above the viewport", () => {
    expect(
      computeCollapseScrollTop({
        scrollTop: 1000,
        clientHeight: 600,
        scrollHeight: 2000,
        cardOffsetTop: -300,
        cardHeight: 100,
      }),
    ).toBe(450); // 1000 + (-300) - (600 - 100) / 2
  });

  // V4: top edge clipped (partially above the viewport).
  it("centers the card when its top is clipped above the viewport", () => {
    expect(
      computeCollapseScrollTop({
        scrollTop: 300,
        clientHeight: 600,
        scrollHeight: 2000,
        cardOffsetTop: -50,
        cardHeight: 100,
      }),
    ).toBe(0); // desired 300 - 50 - 250 = 0
  });

  // V5: card extends below the viewport (bottom clipped or fully below).
  it("centers the card when it extends below the viewport", () => {
    expect(
      computeCollapseScrollTop({
        scrollTop: 0,
        clientHeight: 600,
        scrollHeight: 2000,
        cardOffsetTop: 550,
        cardHeight: 100,
      }),
    ).toBe(300); // 0 + 550 - 250
  });

  // V6: clamp at the top of the scroll range — never negative.
  it("clamps the correction at 0", () => {
    expect(
      computeCollapseScrollTop({
        scrollTop: 100,
        clientHeight: 600,
        scrollHeight: 2000,
        cardOffsetTop: -100,
        cardHeight: 100,
      }),
    ).toBe(0); // desired 100 - 100 - 250 = -250, clamped to 0
  });

  // V7: clamp at the bottom of the scroll range — same regression class as the
  // computeCenteredScrollTop C2 case (an overshoot would scroll an ancestor).
  it("clamps the correction at scrollHeight - clientHeight", () => {
    expect(
      computeCollapseScrollTop({
        scrollTop: 1300,
        clientHeight: 600,
        scrollHeight: 2000,
        cardOffsetTop: 650,
        cardHeight: 100,
      }),
    ).toBe(1400); // desired 1700 clamped to 2000 - 600
  });
});

describe("applyFocusHighlight", () => {
  function makeCard(withNote = false): HTMLElement {
    const card = document.createElement("div");
    if (withNote) {
      const note = document.createElement("div");
      note.dataset.testid = "card-note-display";
      card.appendChild(note);
    }
    return card;
  }

  it("adds card-focus-highlight to the card element", () => {
    const card = makeCard();
    applyFocusHighlight(card, { highlightNote: false });
    expect(card.classList.contains("card-focus-highlight")).toBe(true);
  });

  it("restarts the animation when the class is already present", () => {
    const card = makeCard();
    card.classList.add("card-focus-highlight");
    applyFocusHighlight(card, { highlightNote: false });
    expect(card.classList.contains("card-focus-highlight")).toBe(true);
  });

  it("removes card-focus-highlight on animationend", () => {
    const card = makeCard();
    applyFocusHighlight(card, { highlightNote: false });
    card.dispatchEvent(new Event("animationend"));
    expect(card.classList.contains("card-focus-highlight")).toBe(false);
  });

  it("highlightNote adds note-focus-highlight to the note display, removed on animationend", () => {
    const card = makeCard(true);
    applyFocusHighlight(card, { highlightNote: true });
    const note = card.querySelector('[data-testid="card-note-display"]')!;
    expect(note.classList.contains("note-focus-highlight")).toBe(true);
    note.dispatchEvent(new Event("animationend"));
    expect(note.classList.contains("note-focus-highlight")).toBe(false);
  });

  it("does not touch the note display when highlightNote is false", () => {
    const card = makeCard(true);
    applyFocusHighlight(card, { highlightNote: false });
    const note = card.querySelector('[data-testid="card-note-display"]')!;
    expect(note.classList.contains("note-focus-highlight")).toBe(false);
  });

  it("highlightNote without a note display does not throw and still highlights the card", () => {
    const card = makeCard(false);
    expect(() => applyFocusHighlight(card, { highlightNote: true })).not.toThrow();
    expect(card.classList.contains("card-focus-highlight")).toBe(true);
  });

  // Real AnimationEvents bubble, and the note is a descendant of the card. The
  // note's animationend must not consume the card's listener (#958 finding 2);
  // each listener only reacts to its own element's animation.
  it("a bubbling animationend from the note does not consume the card's listener", () => {
    const card = makeCard(true);
    applyFocusHighlight(card, { highlightNote: true });
    const note = card.querySelector('[data-testid="card-note-display"]')!;

    note.dispatchEvent(new Event("animationend", { bubbles: true }));
    expect(note.classList.contains("note-focus-highlight")).toBe(false);
    expect(card.classList.contains("card-focus-highlight")).toBe(true);

    card.dispatchEvent(new Event("animationend", { bubbles: true }));
    expect(card.classList.contains("card-focus-highlight")).toBe(false);
  });
});
