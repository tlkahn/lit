import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useTrackpadPageNav } from "./useTrackpadPageNav";
import { OVERSCROLL_THRESHOLD } from "../lib/trackpadGesture";

let container: HTMLDivElement;
let goToPage: ReturnType<typeof vi.fn>;

function makeContainer(opts: { scrollHeight?: number; clientHeight?: number; scrollTop?: number } = {}) {
  container = document.createElement("div");
  document.body.appendChild(container);
  Object.defineProperties(container, {
    scrollHeight: { get: () => opts.scrollHeight ?? 600, configurable: true },
    clientHeight: { get: () => opts.clientHeight ?? 600, configurable: true },
    scrollTop: { get: () => opts.scrollTop ?? 0, configurable: true, set: () => {} },
  });
}

function fireWheel(deltaY: number, opts: { ctrlKey?: boolean; timeStamp?: number } = {}) {
  const event = new WheelEvent("wheel", {
    deltaY,
    bubbles: true,
    cancelable: true,
    ctrlKey: opts.ctrlKey,
  });
  if (opts.timeStamp !== undefined) {
    Object.defineProperty(event, "timeStamp", { value: opts.timeStamp });
  }
  container.dispatchEvent(event);
  return event;
}

beforeEach(() => {
  document.body.innerHTML = "";
  goToPage = vi.fn();
});

function renderNav(overrides: Partial<Parameters<typeof useTrackpadPageNav>[0]> = {}) {
  return renderHook(() =>
    useTrackpadPageNav({
      scrollContainerRef: { current: container },
      currentPageRef: { current: overrides.currentPageRef?.current ?? 2 },
      spaceHeldRef: { current: false },
      pageCount: 10,
      goToPage,
      enabled: true,
      ...overrides,
    }),
  );
}

describe("useTrackpadPageNav", () => {
  it("navigates to next page on scroll down (no overflow)", () => {
    makeContainer();
    renderNav();
    fireWheel(OVERSCROLL_THRESHOLD + 1, { timeStamp: 1000 });
    expect(goToPage).toHaveBeenCalledWith(3);
  });

  it("navigates to previous page on scroll up (no overflow)", () => {
    makeContainer();
    renderNav();
    fireWheel(-(OVERSCROLL_THRESHOLD + 1), { timeStamp: 1000 });
    expect(goToPage).toHaveBeenCalledWith(1);
  });

  it("does not navigate past first page", () => {
    makeContainer();
    renderNav({ currentPageRef: { current: 0 } });
    fireWheel(-(OVERSCROLL_THRESHOLD + 1), { timeStamp: 1000 });
    expect(goToPage).not.toHaveBeenCalled();
  });

  it("does not navigate past last page", () => {
    makeContainer();
    renderNav({ currentPageRef: { current: 9 }, pageCount: 10 });
    fireWheel(OVERSCROLL_THRESHOLD + 1, { timeStamp: 1000 });
    expect(goToPage).not.toHaveBeenCalled();
  });

  it("ignores wheel events when space is held (pan mode)", () => {
    makeContainer();
    renderNav({ spaceHeldRef: { current: true } });
    fireWheel(OVERSCROLL_THRESHOLD + 1, { timeStamp: 1000 });
    expect(goToPage).not.toHaveBeenCalled();
  });

  it("ignores ctrl+wheel (pinch-to-zoom)", () => {
    makeContainer();
    renderNav();
    fireWheel(OVERSCROLL_THRESHOLD + 1, { ctrlKey: true, timeStamp: 1000 });
    expect(goToPage).not.toHaveBeenCalled();
  });

  it("does not navigate when disabled", () => {
    makeContainer();
    renderNav({ enabled: false });
    fireWheel(OVERSCROLL_THRESHOLD + 1, { timeStamp: 1000 });
    expect(goToPage).not.toHaveBeenCalled();
  });

  describe("preventDefault behavior", () => {
    it("does NOT preventDefault when no navigation fires (no overflow, accumulation not met)", () => {
      makeContainer(); // scrollHeight === clientHeight => no overflow
      renderNav();
      // Small delta below threshold — no navigation
      const event = fireWheel(10, { timeStamp: 1000 });
      expect(event.defaultPrevented).toBe(false);
      expect(goToPage).not.toHaveBeenCalled();
    });

    it("does NOT preventDefault when on first page and scrolling up (clamped at bounds)", () => {
      makeContainer(); // no overflow
      renderNav({ currentPageRef: { current: 0 } });
      // Large negative delta — would trigger "prev" but clamped at page 0
      const event = fireWheel(-(OVERSCROLL_THRESHOLD + 10), { timeStamp: 1000 });
      expect(event.defaultPrevented).toBe(false);
      expect(goToPage).not.toHaveBeenCalled();
    });

    it("does NOT preventDefault when on last page and scrolling down (clamped at bounds)", () => {
      makeContainer(); // no overflow
      renderNav({ currentPageRef: { current: 9 }, pageCount: 10 });
      // Large positive delta — would trigger "next" but clamped at last page
      const event = fireWheel(OVERSCROLL_THRESHOLD + 10, { timeStamp: 1000 });
      expect(event.defaultPrevented).toBe(false);
      expect(goToPage).not.toHaveBeenCalled();
    });

    it("DOES preventDefault when navigation actually fires", () => {
      makeContainer(); // no overflow
      renderNav({ currentPageRef: { current: 2 } });
      const event = fireWheel(OVERSCROLL_THRESHOLD + 10, { timeStamp: 1000 });
      expect(event.defaultPrevented).toBe(true);
      expect(goToPage).toHaveBeenCalledWith(3);
    });

    it("does NOT preventDefault during cooldown period", () => {
      makeContainer(); // no overflow
      renderNav({ currentPageRef: { current: 2 } });
      // First scroll navigates
      fireWheel(OVERSCROLL_THRESHOLD + 10, { timeStamp: 1000 });
      expect(goToPage).toHaveBeenCalledTimes(1);
      // Second scroll during cooldown — should NOT preventDefault
      const event2 = fireWheel(OVERSCROLL_THRESHOLD + 10, { timeStamp: 1100 }); // within 400ms cooldown
      expect(event2.defaultPrevented).toBe(false);
    });
  });
});
