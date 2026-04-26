import { describe, it, expect, beforeEach } from "vitest";
import { JumpTracker, type Jump } from "./jumpTracker";

function jump(notePath: string, line: number, col = 0): Jump {
  return { notePath, line, col };
}

describe("JumpTracker", () => {
  let tracker: JumpTracker;

  beforeEach(() => {
    tracker = new JumpTracker();
  });

  it("records same-note jump to different line", () => {
    tracker.recordJump(jump("a.md", 1), jump("a.md", 2));
    expect(tracker.jumps).toHaveLength(1);
  });

  it("skips same-line move with col distance <= 1", () => {
    tracker.recordJump(jump("a.md", 5, 3), jump("a.md", 5, 4));
    expect(tracker.jumps).toHaveLength(0);
  });

  it("skips same-line move with col distance 0 (same position)", () => {
    tracker.recordJump(jump("a.md", 5, 3), jump("a.md", 5, 3));
    expect(tracker.jumps).toHaveLength(0);
  });

  it("records same-line jump when col distance > 1", () => {
    tracker.recordJump(jump("a.md", 5, 0), jump("a.md", 5, 10));
    expect(tracker.jumps).toHaveLength(1);
  });

  it("always records cross-note jumps regardless of distance", () => {
    tracker.recordJump(jump("a.md", 1), jump("b.md", 2));
    expect(tracker.jumps).toHaveLength(1);
  });

  it("deduplicates same-line entries (keeps latest)", () => {
    tracker.recordJump(jump("a.md", 1), jump("a.md", 10));
    tracker.recordJump(jump("a.md", 1, 5), jump("a.md", 15));
    const jumps = tracker.jumps;
    expect(jumps).toHaveLength(1);
    expect(jumps[0]!.line).toBe(1);
    expect(jumps[0]!.col).toBe(5);
  });

  it("caps at MAX_JUMPS=100 and removes oldest", () => {
    for (let i = 0; i < 105; i++) {
      tracker.recordJump(jump("a.md", i * 10), jump("a.md", i * 10 + 5));
    }
    expect(tracker.jumps).toHaveLength(100);
    expect(tracker.jumps[0]!.line).toBe(50);
  });

  it("navigateBack from end: pushes current, returns previous", () => {
    tracker.recordJump(jump("a.md", 1), jump("a.md", 10));
    const result = tracker.navigateBack(jump("a.md", 10));
    expect(result).toEqual(jump("a.md", 1));
  });

  it("navigateBack while navigating: decrements index", () => {
    tracker.recordJump(jump("a.md", 1), jump("a.md", 10));
    tracker.recordJump(jump("a.md", 10), jump("a.md", 20));
    tracker.navigateBack(jump("a.md", 20));
    const result = tracker.navigateBack(jump("a.md", 10));
    expect(result).toEqual(jump("a.md", 1));
  });

  it("navigateBack at index 0: returns null", () => {
    tracker.recordJump(jump("a.md", 1), jump("a.md", 10));
    tracker.navigateBack(jump("a.md", 10));
    const result = tracker.navigateBack(jump("a.md", 1));
    expect(result).toBeNull();
  });

  it("navigateForward: increments and returns correct jump", () => {
    tracker.recordJump(jump("a.md", 1), jump("a.md", 10));
    tracker.recordJump(jump("a.md", 10), jump("a.md", 20));
    tracker.navigateBack(jump("a.md", 20));
    tracker.navigateBack(jump("a.md", 10));
    const result = tracker.navigateForward();
    expect(result).toEqual(jump("a.md", 10));
  });

  it("navigateForward at end: returns null", () => {
    tracker.recordJump(jump("a.md", 1), jump("a.md", 10));
    tracker.navigateBack(jump("a.md", 10));
    tracker.navigateForward();
    const result = tracker.navigateForward();
    expect(result).toBeNull();
  });

  it("back then forward round-trips correctly", () => {
    tracker.recordJump(jump("a.md", 1), jump("a.md", 10));
    const back = tracker.navigateBack(jump("a.md", 10));
    expect(back).toEqual(jump("a.md", 1));
    const forward = tracker.navigateForward();
    expect(forward).toEqual(jump("a.md", 10));
  });

  it("recording after navigateBack truncates forward history", () => {
    tracker.recordJump(jump("a.md", 1), jump("a.md", 10));
    tracker.recordJump(jump("a.md", 10), jump("a.md", 20));
    tracker.navigateBack(jump("a.md", 20));
    tracker.recordJump(jump("a.md", 10), jump("a.md", 30));
    expect(tracker.jumps).toHaveLength(2);
    expect(tracker.jumps[1]!.line).toBe(10);
    const fwd = tracker.navigateForward();
    expect(fwd).toBeNull();
  });

  it("clear() resets everything", () => {
    tracker.recordJump(jump("a.md", 1), jump("a.md", 10));
    tracker.navigateBack(jump("a.md", 10));
    tracker.clear();
    expect(tracker.jumps).toHaveLength(0);
    expect(tracker.navigateBack(jump("a.md", 5))).toBeNull();
    expect(tracker.navigateForward()).toBeNull();
  });
});
