import { describe, it, expect } from "vitest";
import {
  createGestureState,
  processWheelEvent,
  OVERSCROLL_THRESHOLD,
  COOLDOWN_MS,
  GESTURE_TIMEOUT_MS,
} from "./trackpadGesture";
import type { ScrollBoundary } from "./trackpadGesture";

const noOverflow: ScrollBoundary = { atTop: true, atBottom: true, hasVerticalOverflow: false };
const overflowMiddle: ScrollBoundary = { atTop: false, atBottom: false, hasVerticalOverflow: true };
const overflowAtBottom: ScrollBoundary = { atTop: false, atBottom: true, hasVerticalOverflow: true };
const overflowAtTop: ScrollBoundary = { atTop: true, atBottom: false, hasVerticalOverflow: true };

describe("trackpadGesture", () => {
  describe("no overflow (page fits in viewport)", () => {
    it("returns 'next' when accumulated delta exceeds threshold", () => {
      const state = createGestureState();
      let nav = processWheelEvent(state, OVERSCROLL_THRESHOLD - 1, 100, noOverflow);
      expect(nav).toBeNull();
      nav = processWheelEvent(state, 2, 110, noOverflow);
      expect(nav).toBe("next");
    });

    it("returns 'prev' when accumulated negative delta exceeds threshold", () => {
      const state = createGestureState();
      let nav = processWheelEvent(state, -(OVERSCROLL_THRESHOLD - 1), 100, noOverflow);
      expect(nav).toBeNull();
      nav = processWheelEvent(state, -2, 110, noOverflow);
      expect(nav).toBe("prev");
    });

    it("resets accumulator after navigation", () => {
      const state = createGestureState();
      processWheelEvent(state, OVERSCROLL_THRESHOLD + 1, 100, noOverflow);
      expect(state.accumulatedDelta).toBe(0);
    });
  });

  describe("vertical overflow (zoomed in)", () => {
    it("resets accumulated delta when away from boundary beyond grace period", () => {
      const state = createGestureState();
      // 4 consecutive mid-scroll events exceed BOUNDARY_GRACE_EVENTS (3)
      processWheelEvent(state, 50, 100, overflowMiddle);
      processWheelEvent(state, 50, 110, overflowMiddle);
      processWheelEvent(state, 50, 120, overflowMiddle);
      const nav = processWheelEvent(state, 50, 130, overflowMiddle);
      expect(nav).toBeNull();
      expect(state.accumulatedDelta).toBe(0);
    });

    it("returns 'next' when at bottom and scrolling down past threshold", () => {
      const state = createGestureState();
      let nav = processWheelEvent(state, OVERSCROLL_THRESHOLD - 1, 100, overflowAtBottom);
      expect(nav).toBeNull();
      nav = processWheelEvent(state, 2, 110, overflowAtBottom);
      expect(nav).toBe("next");
    });

    it("returns 'prev' when at top and scrolling up past threshold", () => {
      const state = createGestureState();
      let nav = processWheelEvent(state, -(OVERSCROLL_THRESHOLD - 1), 100, overflowAtTop);
      expect(nav).toBeNull();
      nav = processWheelEvent(state, -2, 110, overflowAtTop);
      expect(nav).toBe("prev");
    });

    it("returns null when at bottom but scrolling up", () => {
      const state = createGestureState();
      const nav = processWheelEvent(state, -200, 100, overflowAtBottom);
      expect(nav).toBeNull();
    });

    it("returns null when at top but scrolling down", () => {
      const state = createGestureState();
      const nav = processWheelEvent(state, 200, 100, overflowAtTop);
      expect(nav).toBeNull();
    });
  });

  describe("cooldown", () => {
    it("blocks navigation during cooldown window", () => {
      const state = createGestureState();
      processWheelEvent(state, OVERSCROLL_THRESHOLD + 1, 100, noOverflow);
      const nav = processWheelEvent(state, OVERSCROLL_THRESHOLD + 1, 100 + COOLDOWN_MS - 1, noOverflow);
      expect(nav).toBeNull();
    });

    it("allows navigation after cooldown expires", () => {
      const state = createGestureState();
      processWheelEvent(state, OVERSCROLL_THRESHOLD + 1, 100, noOverflow);
      const nav = processWheelEvent(state, OVERSCROLL_THRESHOLD + 1, 100 + COOLDOWN_MS + 1, noOverflow);
      expect(nav).toBe("next");
    });
  });

  describe("gesture timeout", () => {
    it("resets accumulated delta after gesture timeout", () => {
      const state = createGestureState();
      processWheelEvent(state, OVERSCROLL_THRESHOLD - 10, 100, noOverflow);
      expect(state.accumulatedDelta).toBe(OVERSCROLL_THRESHOLD - 10);

      const nav = processWheelEvent(state, 5, 100 + GESTURE_TIMEOUT_MS + 1, noOverflow);
      expect(nav).toBeNull();
      expect(state.accumulatedDelta).toBe(5);
    });

    it("keeps accumulating within gesture timeout", () => {
      const state = createGestureState();
      processWheelEvent(state, 40, 100, noOverflow);
      const nav = processWheelEvent(state, 50, 100 + GESTURE_TIMEOUT_MS - 1, noOverflow);
      expect(nav).toBe("next");
    });
  });

  describe("direction changes", () => {
    it("cancels accumulated delta when direction reverses", () => {
      const state = createGestureState();
      processWheelEvent(state, 60, 100, noOverflow);
      processWheelEvent(state, -60, 110, noOverflow);
      expect(state.accumulatedDelta).toBe(0);
      const nav = processWheelEvent(state, 30, 120, noOverflow);
      expect(nav).toBeNull();
    });
  });

  describe("boundary micro-jitter resilience", () => {
    it("preserves accumulated delta through brief boundary jitter", () => {
      const state = createGestureState();
      // User is at bottom, scrolls down with delta 60 (below threshold)
      processWheelEvent(state, 60, 100, overflowAtBottom);
      expect(state.accumulatedDelta).toBe(60);

      // 1 event reports not-at-boundary (micro-jitter)
      const jitterNav = processWheelEvent(state, 0, 110, overflowMiddle);
      expect(jitterNav).toBeNull();
      // Delta should be preserved (within grace window)
      expect(state.accumulatedDelta).toBe(60);

      // Back at bottom with delta 25 -> total 85 > 80 threshold
      const nav = processWheelEvent(state, 25, 120, overflowAtBottom);
      expect(nav).toBe("next");
    });

    it("resets delta after sustained departure from boundary", () => {
      const state = createGestureState();
      // User is at bottom, scrolls down with delta 60
      processWheelEvent(state, 60, 100, overflowAtBottom);

      // 4+ consecutive events report not-at-boundary (exceeds BOUNDARY_GRACE_EVENTS = 3)
      processWheelEvent(state, 5, 110, overflowMiddle);
      processWheelEvent(state, 5, 120, overflowMiddle);
      processWheelEvent(state, 5, 130, overflowMiddle);
      processWheelEvent(state, 5, 140, overflowMiddle);

      // Back at bottom with delta 25 -> should NOT trigger (delta was reset)
      const nav = processWheelEvent(state, 25, 150, overflowAtBottom);
      expect(nav).toBeNull();
      expect(state.accumulatedDelta).toBe(25);
    });

    it("grace counter resets when boundary is re-entered", () => {
      const state = createGestureState();
      // User is at bottom, accumulate some delta
      processWheelEvent(state, 30, 100, overflowAtBottom);

      // 2 jitter events (below grace threshold of 3)
      processWheelEvent(state, 5, 110, overflowMiddle);
      processWheelEvent(state, 5, 120, overflowMiddle);

      // Back at boundary — grace counter resets
      processWheelEvent(state, 10, 130, overflowAtBottom);

      // 2 more jitter events (below grace threshold again since counter reset)
      processWheelEvent(state, 5, 140, overflowMiddle);
      processWheelEvent(state, 5, 150, overflowMiddle);

      // Back at boundary with enough to cross threshold (30+5+5+10+5+5+20 = 80, need >80)
      const nav = processWheelEvent(state, 21, 160, overflowAtBottom);
      expect(nav).toBe("next");
    });
  });
});
