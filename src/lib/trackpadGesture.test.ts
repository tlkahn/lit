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
    it("returns null when not at a boundary", () => {
      const state = createGestureState();
      const nav = processWheelEvent(state, 200, 100, overflowMiddle);
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
});
