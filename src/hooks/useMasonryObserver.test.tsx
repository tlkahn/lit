import { describe, it, expect, vi } from "vitest";
import { render, act } from "@testing-library/react";
import { MasonryObserverProvider, useMasonryRef } from "./useMasonryObserver";

function TestCard({ testId = "card" }: { testId?: string }) {
  const masonryRef = useMasonryRef();
  return (
    <div data-testid={`${testId}-wrapper`} style={{ gridRowEnd: "span 1" }}>
      <div ref={masonryRef} data-masonry-content="" data-testid={testId} />
    </div>
  );
}

describe("useMasonryObserver", () => {
  it("sets gridRowEnd on the parent element after observing", async () => {
    vi.useFakeTimers();
    const { getByTestId } = render(
      <MasonryObserverProvider>
        <TestCard />
      </MasonryObserverProvider>,
    );
    // Mock ResizeObserver fires synchronously on observe(); DOM write is batched in rAF.
    await act(() => { vi.advanceTimersByTime(16); });
    const wrapper = getByTestId("card-wrapper");
    // Default _clientHeight = 5000, computeSpan(5000, 8, 16) = ceil(5016/8) = 627
    expect(wrapper.style.gridRowEnd).toBe("span 627");
    vi.useRealTimers();
  });

  it("multiple cards share a single observer", () => {
    const constructorSpy = vi.fn();
    const OriginalRO = globalThis.ResizeObserver;
    globalThis.ResizeObserver = class extends OriginalRO {
      constructor(cb: ResizeObserverCallback) {
        constructorSpy();
        super(cb);
      }
    } as unknown as typeof ResizeObserver;

    render(
      <MasonryObserverProvider>
        <TestCard testId="a" />
        <TestCard testId="b" />
        <TestCard testId="c" />
      </MasonryObserverProvider>,
    );

    expect(constructorSpy).toHaveBeenCalledTimes(1);
    globalThis.ResizeObserver = OriginalRO;
  });

  it("disconnects observer on unmount", () => {
    const disconnectSpy = vi.fn();
    const OriginalRO = globalThis.ResizeObserver;
    globalThis.ResizeObserver = class extends OriginalRO {
      disconnect() {
        disconnectSpy();
        super.disconnect();
      }
    } as unknown as typeof ResizeObserver;

    const { unmount } = render(
      <MasonryObserverProvider>
        <TestCard />
      </MasonryObserverProvider>,
    );
    unmount();
    expect(disconnectSpy).toHaveBeenCalled();

    globalThis.ResizeObserver = OriginalRO;
  });
});
