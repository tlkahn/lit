import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { FpsCounter } from "./fpsCounter";

describe("FpsCounter", () => {
  let counter: FpsCounter;
  let rafCallbacks: Array<(time: number) => void>;
  let rafId: number;

  beforeEach(() => {
    rafCallbacks = [];
    rafId = 0;
    vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((cb) => {
      rafCallbacks.push(cb);
      return ++rafId;
    });
    vi.spyOn(globalThis, "cancelAnimationFrame").mockImplementation(() => {});
    counter = new FpsCounter();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function flushFrames(times: number[]) {
    for (const t of times) {
      const cb = rafCallbacks.pop();
      cb?.(t);
    }
  }

  it("reports not running before start", () => {
    expect(counter.isRunning()).toBe(false);
  });

  it("reports running after start", () => {
    counter.start();
    expect(counter.isRunning()).toBe(true);
  });

  it("reports not running after stop", () => {
    counter.start();
    counter.stop();
    expect(counter.isRunning()).toBe(false);
  });

  it("returns zero stats when stopped immediately", () => {
    counter.start();
    const stats = counter.stop();
    expect(stats.samples).toBe(0);
    expect(stats.avg).toBe(0);
  });

  it("computes FPS from frame deltas", () => {
    counter.start();
    // Simulate 60fps frames (16.67ms apart)
    flushFrames([0]);
    flushFrames([16.67]);
    flushFrames([33.33]);
    flushFrames([50.0]);
    const stats = counter.stop();
    expect(stats.samples).toBe(3);
    expect(stats.avg).toBeCloseTo(60, 0);
    expect(stats.min).toBeCloseTo(60, 0);
    expect(stats.max).toBeCloseTo(60, 0);
  });

  it("handles variable frame rates", () => {
    counter.start();
    flushFrames([0]);
    flushFrames([16.67]); // ~60fps
    flushFrames([50.0]); // ~30fps (33.33ms delta)
    const stats = counter.stop();
    expect(stats.samples).toBe(2);
    expect(stats.min).toBeLessThan(stats.max);
  });

  it("ignores double start", () => {
    counter.start();
    counter.start();
    expect(counter.isRunning()).toBe(true);
    counter.stop();
    expect(counter.isRunning()).toBe(false);
  });
});
