import { describe, it, expect, vi } from "vitest";
import { render, renderHook } from "@testing-library/react";
import { useMasonrySpan } from "./useMasonrySpan";

describe("useMasonrySpan", () => {
  it("returns span 1 before content ref is attached", () => {
    const { result } = renderHook(() => useMasonrySpan());
    expect(result.current.span).toBe(1);
  });

  it("computes span from observed content height", () => {
    function TestComponent() {
      const { contentRef, span } = useMasonrySpan();
      return (
        <div ref={contentRef} data-masonry-content="" data-testid="content">
          <span data-testid="span">{span}</span>
        </div>
      );
    }

    const { getByTestId } = render(<TestComponent />);
    // Mock ResizeObserver fires synchronously on observe().
    // Default _clientHeight from setup.ts is 5000, so borderBoxSize blockSize = 5000.
    // computeSpan(5000, 8, 16) = ceil(5016/8) = 627
    expect(getByTestId("span").textContent).toBe("627");
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

    function TestComponent() {
      const { contentRef } = useMasonrySpan();
      return <div ref={contentRef} data-masonry-content="" />;
    }

    const { unmount } = render(<TestComponent />);
    unmount();
    expect(disconnectSpy).toHaveBeenCalled();

    globalThis.ResizeObserver = OriginalRO;
  });
});
