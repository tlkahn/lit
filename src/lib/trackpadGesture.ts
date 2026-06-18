export const OVERSCROLL_THRESHOLD = 80;
export const COOLDOWN_MS = 400;
export const GESTURE_TIMEOUT_MS = 200;
export const BOUNDARY_TOLERANCE = 1;
export const BOUNDARY_GRACE_EVENTS = 3;

export type NavDirection = "next" | "prev" | null;

export interface ScrollBoundary {
  atTop: boolean;
  atBottom: boolean;
  hasVerticalOverflow: boolean;
}

export interface GestureState {
  accumulatedDelta: number;
  lastWheelTimestamp: number;
  lastNavTimestamp: number;
  boundaryLeaveCount: number;
}

export function createGestureState(): GestureState {
  return {
    accumulatedDelta: 0,
    lastWheelTimestamp: 0,
    lastNavTimestamp: -Infinity,
    boundaryLeaveCount: 0,
  };
}

export function processWheelEvent(
  state: GestureState,
  deltaY: number,
  timestamp: number,
  boundary: ScrollBoundary,
): NavDirection {
  if (timestamp - state.lastNavTimestamp < COOLDOWN_MS) {
    state.lastWheelTimestamp = timestamp;
    return null;
  }

  if (timestamp - state.lastWheelTimestamp > GESTURE_TIMEOUT_MS) {
    state.accumulatedDelta = 0;
  }

  state.lastWheelTimestamp = timestamp;
  state.accumulatedDelta += deltaY;

  if (boundary.hasVerticalOverflow) {
    if (!boundary.atTop && !boundary.atBottom) {
      state.boundaryLeaveCount++;
      if (state.boundaryLeaveCount > BOUNDARY_GRACE_EVENTS) {
        state.accumulatedDelta = 0;
      }
      return null;
    }
    state.boundaryLeaveCount = 0;
    if (boundary.atBottom && deltaY > 0 && state.accumulatedDelta > OVERSCROLL_THRESHOLD) {
      state.accumulatedDelta = 0;
      state.lastNavTimestamp = timestamp;
      return "next";
    }
    if (boundary.atTop && deltaY < 0 && state.accumulatedDelta < -OVERSCROLL_THRESHOLD) {
      state.accumulatedDelta = 0;
      state.lastNavTimestamp = timestamp;
      return "prev";
    }
    return null;
  }

  if (state.accumulatedDelta > OVERSCROLL_THRESHOLD) {
    state.accumulatedDelta = 0;
    state.lastNavTimestamp = timestamp;
    return "next";
  }
  if (state.accumulatedDelta < -OVERSCROLL_THRESHOLD) {
    state.accumulatedDelta = 0;
    state.lastNavTimestamp = timestamp;
    return "prev";
  }

  return null;
}
