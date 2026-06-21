import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useRevealFlash } from "./useRevealFlash";

describe("useRevealFlash", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("triggerReveal sets revealedKey and clears it after 1500ms", () => {
    const scrollToIndex = vi.fn();
    const virtualizerRef = { current: { scrollToIndex } };
    const { result } = renderHook(() => useRevealFlash(virtualizerRef));

    act(() => {
      result.current.triggerReveal("foo", 3);
    });

    // Flush the deferred setTimeout(0) that sets the key
    act(() => {
      vi.advanceTimersByTime(1);
    });

    expect(result.current.revealedKey).toBe("foo");

    act(() => {
      vi.advanceTimersByTime(1500);
    });

    expect(result.current.revealedKey).toBeNull();
  });

  it("rapid consecutive reveals reset the timer so first key does not linger", () => {
    const scrollToIndex = vi.fn();
    const virtualizerRef = { current: { scrollToIndex } };
    const { result } = renderHook(() => useRevealFlash(virtualizerRef));

    act(() => {
      result.current.triggerReveal("a", 0);
    });

    act(() => {
      result.current.triggerReveal("b", 1);
    });

    // Flush the deferred setTimeout(0) that sets the key
    act(() => {
      vi.advanceTimersByTime(1);
    });

    expect(result.current.revealedKey).toBe("b");

    act(() => {
      vi.advanceTimersByTime(1500);
    });

    expect(result.current.revealedKey).toBeNull();
  });

  it("scrollToIndex is deferred through two nested requestAnimationFrame calls (double-rAF)", () => {
    const scrollToIndex = vi.fn();
    const virtualizerRef = { current: { scrollToIndex } };

    // Mock requestAnimationFrame with a queue
    const rafQueue: FrameRequestCallback[] = [];
    const rafSpy = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((cb) => {
        rafQueue.push(cb);
        return rafQueue.length;
      });

    try {
      const { result } = renderHook(() => useRevealFlash(virtualizerRef));

      // Drain any rAFs from the initial render
      while (rafQueue.length > 0) {
        rafQueue.shift()!(performance.now());
      }
      scrollToIndex.mockClear();

      act(() => {
        result.current.triggerReveal("x", 5);
      });

      // The outer rAF should have been queued
      expect(rafQueue.length).toBeGreaterThanOrEqual(1);

      // Flush the outer rAF callback
      const outerCb = rafQueue.shift()!;
      outerCb(performance.now());

      // scrollToIndex should NOT have been called yet (inner rAF is now queued)
      expect(scrollToIndex).not.toHaveBeenCalled();
      expect(rafQueue.length).toBeGreaterThanOrEqual(1);

      // Flush the inner rAF callback
      const innerCb = rafQueue.shift()!;
      innerCb(performance.now());

      // Now scrollToIndex should have been called with index 5 and { align: "center" }
      expect(scrollToIndex).toHaveBeenCalledWith(5, { align: "center" });
    } finally {
      rafSpy.mockRestore();
    }
  });

  it("triggerReveal with negative index skips scrolling", () => {
    const scrollToIndex = vi.fn();
    const virtualizerRef = { current: { scrollToIndex } };

    const rafSpy = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((cb) => {
        cb(performance.now());
        return 0;
      });

    try {
      const { result } = renderHook(() => useRevealFlash(virtualizerRef));

      // Clear any rAF calls from render
      rafSpy.mockClear();

      act(() => {
        result.current.triggerReveal("missing", -1);
      });

      // Flush the deferred setTimeout(0) that sets the key
      act(() => {
        vi.advanceTimersByTime(1);
      });

      // revealedKey should be set
      expect(result.current.revealedKey).toBe("missing");

      // requestAnimationFrame should NOT have been called for scrolling
      expect(rafSpy).not.toHaveBeenCalled();
    } finally {
      rafSpy.mockRestore();
    }
  });

  it("re-triggering the same key within 1500ms replays the flash (clears then re-sets revealedKey)", () => {
    const scrollToIndex = vi.fn();
    const virtualizerRef = { current: { scrollToIndex } };
    const { result } = renderHook(() => useRevealFlash(virtualizerRef));

    // 1. Initial reveal
    act(() => {
      result.current.triggerReveal("foo", 3);
    });
    // Flush the deferred set (setTimeout 0)
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current.revealedKey).toBe("foo");

    // 2. Advance 500ms (still within the 1500ms window)
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(result.current.revealedKey).toBe("foo");

    // 3. Re-trigger with the SAME key
    act(() => {
      result.current.triggerReveal("foo", 3);
    });

    // 4. Immediately after the second call, revealedKey should be null
    //    (the synchronous clear that forces the CSS animation to restart)
    expect(result.current.revealedKey).toBeNull();

    // 5. Flush the deferred setTimeout(0) that re-sets the key
    act(() => {
      vi.advanceTimersByTime(1);
    });

    // 6. revealedKey should be "foo" again (re-set by deferred setTimeout)
    expect(result.current.revealedKey).toBe("foo");

    // 7. Advance by 1500ms -- auto-clear timer fires
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(result.current.revealedKey).toBeNull();
  });

  it("timer is cleaned up on unmount", () => {
    const scrollToIndex = vi.fn();
    const virtualizerRef = { current: { scrollToIndex } };
    const { result, unmount } = renderHook(() => useRevealFlash(virtualizerRef));

    act(() => {
      result.current.triggerReveal("cleanup-test", 0);
    });

    // Flush the deferred setTimeout(0) that sets the key
    act(() => {
      vi.advanceTimersByTime(1);
    });

    expect(result.current.revealedKey).toBe("cleanup-test");

    unmount();

    // Advancing timers past 1500ms should not cause errors
    act(() => {
      vi.advanceTimersByTime(2000);
    });
  });
});
