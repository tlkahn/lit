import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { usePdfZoom } from "./usePdfZoom";

function noopArgs() {
  return {
    ready: false,
    scrollContainerRef: { current: null } as React.RefObject<HTMLDivElement | null>,
    renderSharp: vi.fn(),
  };
}

/** A scroll container whose dims/scroll are mutable (jsdom reports them as 0/read-only). */
function mockContainer(init: { scrollTop: number; scrollLeft: number; clientWidth: number; clientHeight: number }) {
  const el = document.createElement("div");
  let scrollTop = init.scrollTop;
  let scrollLeft = init.scrollLeft;
  Object.defineProperty(el, "clientWidth", { configurable: true, get: () => init.clientWidth });
  Object.defineProperty(el, "clientHeight", { configurable: true, get: () => init.clientHeight });
  Object.defineProperty(el, "scrollTop", {
    configurable: true,
    get: () => scrollTop,
    set: (v: number) => {
      scrollTop = v;
    },
  });
  Object.defineProperty(el, "scrollLeft", {
    configurable: true,
    get: () => scrollLeft,
    set: (v: number) => {
      scrollLeft = v;
    },
  });
  return el;
}

describe("usePdfZoom", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("defaults zoomLevel to 1", () => {
    const { result } = renderHook(() => usePdfZoom(noopArgs()));
    expect(result.current.zoomLevel).toBe(1);
    expect(result.current.zoomLevelRef.current).toBe(1);
  });

  it("applyZoom clamps to MAX_ZOOM (4)", () => {
    const { result } = renderHook(() => usePdfZoom(noopArgs()));
    act(() => {
      result.current.applyZoom(() => 100);
    });
    expect(result.current.zoomLevel).toBe(4);
    expect(result.current.zoomLevelRef.current).toBe(4);
  });

  it("applyZoom clamps to MIN_ZOOM (0.25)", () => {
    const { result } = renderHook(() => usePdfZoom(noopArgs()));
    act(() => {
      result.current.applyZoom(() => 0);
    });
    expect(result.current.zoomLevel).toBe(0.25);
  });

  it("applyZoom no-ops when next === old and leaves scroll unchanged", () => {
    const el = mockContainer({ scrollTop: 100, scrollLeft: 50, clientWidth: 800, clientHeight: 600 });
    const { result } = renderHook(() =>
      usePdfZoom({ ready: false, scrollContainerRef: { current: el }, renderSharp: vi.fn() }),
    );
    act(() => {
      result.current.applyZoom((z) => z);
    });
    expect(result.current.zoomLevel).toBe(1);
    expect(el.scrollTop).toBe(100);
    expect(el.scrollLeft).toBe(50);
  });

  it("applyZoom preserves viewport center", () => {
    const el = mockContainer({ scrollTop: 100, scrollLeft: 50, clientWidth: 800, clientHeight: 600 });
    const { result } = renderHook(() =>
      usePdfZoom({ ready: false, scrollContainerRef: { current: el }, renderSharp: vi.fn() }),
    );
    act(() => {
      result.current.applyZoom((z) => z * 1.25);
    });
    // top:  (100 + 300) * 1.25 - 300 = 200
    // left: (50  + 400) * 1.25 - 400 = 162.5
    expect(el.scrollTop).toBeCloseTo(200, 1);
    expect(el.scrollLeft).toBeCloseTo(162.5, 1);
  });

  it("handleZoomKey handles ctrl+= : returns true, prevents default, zooms by 1.25", () => {
    const { result } = renderHook(() => usePdfZoom(noopArgs()));
    const preventDefault = vi.fn();
    let handled = false;
    act(() => {
      handled = result.current.handleZoomKey({
        ctrlKey: true,
        key: "=",
        preventDefault,
      } as unknown as React.KeyboardEvent);
    });
    expect(handled).toBe(true);
    expect(preventDefault).toHaveBeenCalled();
    expect(result.current.zoomLevel).toBe(1.25);
  });

  it("handleZoomKey handles ctrl+- and ctrl+0", () => {
    const { result } = renderHook(() => usePdfZoom(noopArgs()));
    act(() => {
      result.current.handleZoomKey({ ctrlKey: true, key: "-", preventDefault: vi.fn() } as unknown as React.KeyboardEvent);
    });
    expect(result.current.zoomLevel).toBeCloseTo(0.8, 5);
    // zoom up, then reset to 1 with ctrl+0
    act(() => {
      result.current.handleZoomKey({ ctrlKey: true, key: "=", preventDefault: vi.fn() } as unknown as React.KeyboardEvent);
    });
    act(() => {
      result.current.handleZoomKey({ ctrlKey: true, key: "0", preventDefault: vi.fn() } as unknown as React.KeyboardEvent);
    });
    expect(result.current.zoomLevel).toBe(1);
  });

  it("handleZoomKey returns false for non-zoom keys", () => {
    const { result } = renderHook(() => usePdfZoom(noopArgs()));
    const preventDefault = vi.fn();
    let handled = true;
    act(() => {
      handled = result.current.handleZoomKey({ key: "j", preventDefault } as unknown as React.KeyboardEvent);
    });
    expect(handled).toBe(false);
    expect(preventDefault).not.toHaveBeenCalled();
    expect(result.current.zoomLevel).toBe(1);
  });

  it("debounce calls renderSharp with final zoom after DEBOUNCE_MS", () => {
    vi.useFakeTimers();
    const renderSharp = vi.fn();
    const { result } = renderHook(() =>
      usePdfZoom({ ready: false, scrollContainerRef: { current: null }, renderSharp }),
    );
    // Fires on mount with renderSharp(1).
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(renderSharp).toHaveBeenCalledWith(1);
    renderSharp.mockClear();

    act(() => {
      result.current.applyZoom((z) => z * 2);
    });
    expect(renderSharp).not.toHaveBeenCalledWith(2);
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(renderSharp).toHaveBeenCalledWith(2);
  });

  it("debounce resets on rapid zoom; renders only final value", () => {
    vi.useFakeTimers();
    const renderSharp = vi.fn();
    const { result } = renderHook(() =>
      usePdfZoom({ ready: false, scrollContainerRef: { current: null }, renderSharp }),
    );
    act(() => {
      vi.advanceTimersByTime(300); // drain mount renderSharp(1)
    });
    renderSharp.mockClear();

    act(() => {
      result.current.applyZoom(() => 1.5);
    });
    act(() => {
      vi.advanceTimersByTime(200);
    });
    act(() => {
      result.current.applyZoom(() => 2);
    });
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(renderSharp).not.toHaveBeenCalledWith(1.5);
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(renderSharp).toHaveBeenCalledWith(2);
    expect(renderSharp).not.toHaveBeenCalledWith(1.5);
  });

  it("wheel listener attaches on ready container and zooms on ctrlKey", () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    const { result } = renderHook(() =>
      usePdfZoom({ ready: true, scrollContainerRef: { current: el }, renderSharp: vi.fn() }),
    );

    const evt = new WheelEvent("wheel", { ctrlKey: true, deltaY: -100, cancelable: true });
    act(() => {
      el.dispatchEvent(evt);
    });
    expect(result.current.zoomLevel).toBeGreaterThan(1);
    expect(evt.defaultPrevented).toBe(true);

    const before = result.current.zoomLevel;
    const evt2 = new WheelEvent("wheel", { ctrlKey: false, deltaY: -100, cancelable: true });
    act(() => {
      el.dispatchEvent(evt2);
    });
    expect(result.current.zoomLevel).toBe(before);

    document.body.removeChild(el);
  });
});
