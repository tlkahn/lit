import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { SlideTransition } from "./SlideTransition";

let matchMediaMatches = false;

beforeEach(() => {
  matchMediaMatches = false;
  vi.spyOn(window, "matchMedia").mockImplementation((query: string) => {
    const mql = {
      matches: matchMediaMatches,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    } as unknown as MediaQueryList;
    return mql;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("SlideTransition", () => {
  it("renders children normally when no transition is active", () => {
    render(
      <SlideTransition viewKey="root" direction="none">
        <div data-testid="content">Hello</div>
      </SlideTransition>,
    );
    expect(screen.getByTestId("content")).toBeInTheDocument();
    expect(screen.queryByTestId("slide-panel-entering")).not.toBeInTheDocument();
    expect(screen.queryByTestId("slide-panel-exiting")).not.toBeInTheDocument();
  });

  it("renders both panels during a push transition", () => {
    const { rerender } = render(
      <SlideTransition viewKey="root" direction="none">
        <div data-testid="root-content">Root</div>
      </SlideTransition>,
    );

    rerender(
      <SlideTransition viewKey="child-a" direction="push">
        <div data-testid="child-content">Child A</div>
      </SlideTransition>,
    );

    expect(screen.getByTestId("slide-panel-exiting")).toBeInTheDocument();
    expect(screen.getByTestId("slide-panel-entering")).toBeInTheDocument();
    expect(screen.getByTestId("root-content")).toBeInTheDocument();
    expect(screen.getByTestId("child-content")).toBeInTheDocument();
  });

  it("renders both panels during a pop transition", () => {
    const { rerender } = render(
      <SlideTransition viewKey="child-a" direction="none">
        <div data-testid="child-content">Child A</div>
      </SlideTransition>,
    );

    rerender(
      <SlideTransition viewKey="root" direction="pop">
        <div data-testid="root-content">Root</div>
      </SlideTransition>,
    );

    expect(screen.getByTestId("slide-panel-exiting")).toBeInTheDocument();
    expect(screen.getByTestId("slide-panel-entering")).toBeInTheDocument();
  });

  it("applies correct initial transform for push direction", () => {
    const { rerender } = render(
      <SlideTransition viewKey="root" direction="none">
        <div>Root</div>
      </SlideTransition>,
    );

    rerender(
      <SlideTransition viewKey="child" direction="push">
        <div>Child</div>
      </SlideTransition>,
    );

    const exiting = screen.getByTestId("slide-panel-exiting");
    const entering = screen.getByTestId("slide-panel-entering");
    expect(exiting.style.transform).toBe("translateX(0%)");
    expect(entering.style.transform).toBe("translateX(30%)");
  });

  it("applies correct initial transform for pop direction", () => {
    const { rerender } = render(
      <SlideTransition viewKey="child" direction="none">
        <div>Child</div>
      </SlideTransition>,
    );

    rerender(
      <SlideTransition viewKey="root" direction="pop">
        <div>Root</div>
      </SlideTransition>,
    );

    const exiting = screen.getByTestId("slide-panel-exiting");
    const entering = screen.getByTestId("slide-panel-entering");
    expect(exiting.style.transform).toBe("translateX(0%)");
    expect(entering.style.transform).toBe("translateX(-30%)");
  });

  it("calls onTransitionEnd after transition completes via transitionend event", async () => {
    const onEnd = vi.fn();
    const { rerender } = render(
      <SlideTransition viewKey="root" direction="none" onTransitionEnd={onEnd}>
        <div>Root</div>
      </SlideTransition>,
    );

    rerender(
      <SlideTransition viewKey="child" direction="push" onTransitionEnd={onEnd}>
        <div>Child</div>
      </SlideTransition>,
    );

    // Advance through rAF to move to "end" phase
    await act(async () => {
      await new Promise((r) => requestAnimationFrame(r));
    });

    const entering = screen.getByTestId("slide-panel-entering");
    act(() => {
      const event = new Event("transitionend", { bubbles: true });
      (event as unknown as Record<string, unknown>).propertyName = "transform";
      entering.dispatchEvent(event);
    });

    expect(onEnd).toHaveBeenCalled();
    expect(screen.queryByTestId("slide-panel-exiting")).not.toBeInTheDocument();
  });

  it("completes via safety timeout when transitionend does not fire", async () => {
    vi.useFakeTimers();
    const onEnd = vi.fn();
    const { rerender } = render(
      <SlideTransition viewKey="root" direction="none" onTransitionEnd={onEnd}>
        <div>Root</div>
      </SlideTransition>,
    );

    rerender(
      <SlideTransition viewKey="child" direction="push" onTransitionEnd={onEnd}>
        <div>Child</div>
      </SlideTransition>,
    );

    // Move to end phase
    await act(async () => {
      await vi.advanceTimersByTimeAsync(16);
    });

    expect(screen.getByTestId("slide-panel-entering")).toBeInTheDocument();

    // Safety timeout
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    expect(onEnd).toHaveBeenCalled();
    expect(screen.queryByTestId("slide-panel-exiting")).not.toBeInTheDocument();

    vi.useRealTimers();
  });

  it("skips animation when direction is 'none'", () => {
    const onEnd = vi.fn();
    const { rerender } = render(
      <SlideTransition viewKey="root" direction="none" onTransitionEnd={onEnd}>
        <div data-testid="root-content">Root</div>
      </SlideTransition>,
    );

    rerender(
      <SlideTransition viewKey="child" direction="none" onTransitionEnd={onEnd}>
        <div data-testid="child-content">Child</div>
      </SlideTransition>,
    );

    expect(screen.queryByTestId("slide-panel-exiting")).not.toBeInTheDocument();
    expect(screen.getByTestId("child-content")).toBeInTheDocument();
    expect(onEnd).toHaveBeenCalled();
  });

  it("skips animation when reduced motion is preferred", () => {
    matchMediaMatches = true;
    const onEnd = vi.fn();
    const { rerender } = render(
      <SlideTransition viewKey="root" direction="none" onTransitionEnd={onEnd}>
        <div data-testid="root-content">Root</div>
      </SlideTransition>,
    );

    rerender(
      <SlideTransition viewKey="child" direction="push" onTransitionEnd={onEnd}>
        <div data-testid="child-content">Child</div>
      </SlideTransition>,
    );

    expect(screen.queryByTestId("slide-panel-exiting")).not.toBeInTheDocument();
    expect(screen.getByTestId("child-content")).toBeInTheDocument();
    expect(onEnd).toHaveBeenCalled();
  });

  it("handles rapid navigation by completing previous transition", async () => {
    const onEnd = vi.fn();
    const { rerender } = render(
      <SlideTransition viewKey="root" direction="none" onTransitionEnd={onEnd}>
        <div data-testid="root">Root</div>
      </SlideTransition>,
    );

    // First push
    rerender(
      <SlideTransition viewKey="child-a" direction="push" onTransitionEnd={onEnd}>
        <div data-testid="child-a">Child A</div>
      </SlideTransition>,
    );

    expect(screen.getByTestId("slide-panel-entering")).toBeInTheDocument();

    // Second push before first completes
    rerender(
      <SlideTransition viewKey="child-b" direction="push" onTransitionEnd={onEnd}>
        <div data-testid="child-b">Child B</div>
      </SlideTransition>,
    );

    // Previous transition should have been completed (onEnd called)
    expect(onEnd).toHaveBeenCalled();
    // New transition should be active
    expect(screen.getByTestId("child-b")).toBeInTheDocument();
  });

  it("does not transition when viewKey stays the same", () => {
    const { rerender } = render(
      <SlideTransition viewKey="root" direction="none">
        <div data-testid="content-v1">V1</div>
      </SlideTransition>,
    );

    rerender(
      <SlideTransition viewKey="root" direction="push">
        <div data-testid="content-v2">V2</div>
      </SlideTransition>,
    );

    expect(screen.queryByTestId("slide-panel-exiting")).not.toBeInTheDocument();
    expect(screen.getByTestId("content-v2")).toBeInTheDocument();
  });
});
