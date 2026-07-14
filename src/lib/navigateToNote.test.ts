import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockSelectPageAtLine,
  mockRecordJump,
  mockWorkspaceState,
  mockSubscribeCalls,
  emitWorkspaceState,
} = vi.hoisted(() => {
  const mockSelectPageAtLine = vi.fn();
  const mockRecordJump = vi.fn();
  const mockWorkspaceState = {
    currentPagePath: "current-page.md" as string | null,
    selectPageAtLine: mockSelectPageAtLine,
  };
  type Listener = (s: typeof mockWorkspaceState) => void;
  const mockSubscribeCalls: { listener: Listener; unsubscribed: boolean }[] = [];
  const emitWorkspaceState = (partial: Partial<typeof mockWorkspaceState>) => {
    Object.assign(mockWorkspaceState, partial);
    for (const call of mockSubscribeCalls) {
      if (!call.unsubscribed) call.listener(mockWorkspaceState);
    }
  };
  return {
    mockSelectPageAtLine,
    mockRecordJump,
    mockWorkspaceState,
    mockSubscribeCalls,
    emitWorkspaceState,
  };
});

vi.mock("../stores/workspace", () => ({
  useWorkspaceStore: Object.assign(
    (selector: (s: Record<string, unknown>) => unknown) =>
      selector(mockWorkspaceState),
    {
      getState: () => mockWorkspaceState,
      subscribe: (listener: (s: typeof mockWorkspaceState) => void) => {
        const record = { listener, unsubscribed: false };
        mockSubscribeCalls.push(record);
        return () => {
          record.unsubscribed = true;
        };
      },
    },
  ),
}));

vi.mock("../editor/jumpTracker", () => ({
  globalJumpTracker: {
    recordJump: mockRecordJump,
  },
}));

import { navigateToNote } from "./navigateToNote";

describe("navigateToNote", () => {
  beforeEach(() => {
    mockSelectPageAtLine.mockClear();
    mockRecordJump.mockClear();
    mockWorkspaceState.currentPagePath = "current-page.md";
    mockSubscribeCalls.length = 0;
  });

  it("records a jump with correct from/to positions", () => {
    navigateToNote("target.md", 42);
    expect(mockRecordJump).toHaveBeenCalledWith(
      { notePath: "current-page.md", line: 1, col: 0 },
      { notePath: "target.md", line: 42, col: 0 },
    );
  });

  it("calls selectPageAtLine when target differs from current page", () => {
    navigateToNote("target.md", 10);
    expect(mockSelectPageAtLine).toHaveBeenCalledWith("target.md", 10);
  });

  it("does NOT dispatch scroll event when target differs from current page", () => {
    const dispatchSpy = vi.spyOn(window, "dispatchEvent");
    navigateToNote("target.md", 10);
    const scrollEvent = dispatchSpy.mock.calls.find(
      (call) => (call[0] as CustomEvent).type === "lit:scroll-to-line",
    );
    expect(scrollEvent).toBeUndefined();
    dispatchSpy.mockRestore();
  });

  it("dispatches lit:scroll-to-line when target is current page", () => {
    mockWorkspaceState.currentPagePath = "same-page.md";
    const dispatchSpy = vi.spyOn(window, "dispatchEvent");
    navigateToNote("same-page.md", 15);
    const scrollEvent = dispatchSpy.mock.calls.find(
      (call) => (call[0] as CustomEvent).type === "lit:scroll-to-line",
    );
    expect(scrollEvent).toBeDefined();
    expect((scrollEvent![0] as CustomEvent).detail).toEqual({
      line: 14,
      cursor: true,
    });
    expect(mockSelectPageAtLine).not.toHaveBeenCalled();
    dispatchSpy.mockRestore();
  });

  it("includes flash: true in scroll event when opts.flash is true", () => {
    mockWorkspaceState.currentPagePath = "same-page.md";
    const dispatchSpy = vi.spyOn(window, "dispatchEvent");
    navigateToNote("same-page.md", 20, { flash: true });
    const scrollEvent = dispatchSpy.mock.calls.find(
      (call) => (call[0] as CustomEvent).type === "lit:scroll-to-line",
    );
    expect(scrollEvent).toBeDefined();
    expect((scrollEvent![0] as CustomEvent).detail).toEqual({
      line: 19,
      cursor: true,
      flash: true,
    });
    dispatchSpy.mockRestore();
  });

  it("does NOT include flash in scroll event when opts.flash is omitted", () => {
    mockWorkspaceState.currentPagePath = "same-page.md";
    const dispatchSpy = vi.spyOn(window, "dispatchEvent");
    navigateToNote("same-page.md", 5);
    const scrollEvent = dispatchSpy.mock.calls.find(
      (call) => (call[0] as CustomEvent).type === "lit:scroll-to-line",
    );
    expect(scrollEvent).toBeDefined();
    expect((scrollEvent![0] as CustomEvent).detail).not.toHaveProperty("flash");
    dispatchSpy.mockRestore();
  });

  it("defaults targetLine to 1 when omitted", () => {
    navigateToNote("target.md");
    expect(mockRecordJump).toHaveBeenCalledWith(
      { notePath: "current-page.md", line: 1, col: 0 },
      { notePath: "target.md", line: 1, col: 0 },
    );
    expect(mockSelectPageAtLine).toHaveBeenCalledWith("target.md", 1);
  });

  it("unsubscribes a pending flash subscription when superseded by a new navigation", () => {
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });
    const dispatchSpy = vi.spyOn(window, "dispatchEvent");

    navigateToNote("a.md", 5, { flash: true });
    navigateToNote("b.md", 7, { flash: true });

    expect(mockSubscribeCalls).toHaveLength(2);
    expect(mockSubscribeCalls[0]!.unsubscribed).toBe(true);

    // A later incidental state change lands on a.md: the superseded
    // navigation must not fire a stale scroll+flash.
    emitWorkspaceState({ currentPagePath: "a.md" });
    const staleScroll = dispatchSpy.mock.calls.find(
      (call) =>
        (call[0] as CustomEvent).type === "lit:scroll-to-line" &&
        (call[0] as CustomEvent).detail.line === 4,
    );
    expect(staleScroll).toBeUndefined();

    dispatchSpy.mockRestore();
    vi.unstubAllGlobals();
  });

  it("still fires the flash scroll for the latest navigation", () => {
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });
    const dispatchSpy = vi.spyOn(window, "dispatchEvent");

    navigateToNote("a.md", 5, { flash: true });
    navigateToNote("b.md", 7, { flash: true });
    emitWorkspaceState({ currentPagePath: "b.md" });

    const scroll = dispatchSpy.mock.calls.find(
      (call) => (call[0] as CustomEvent).type === "lit:scroll-to-line",
    );
    expect(scroll).toBeDefined();
    expect((scroll![0] as CustomEvent).detail).toEqual({
      line: 6,
      cursor: false,
      flash: true,
    });

    dispatchSpy.mockRestore();
    vi.unstubAllGlobals();
  });

  it("uses empty string for from notePath when currentPagePath is null", () => {
    mockWorkspaceState.currentPagePath = null;
    navigateToNote("target.md", 7);
    expect(mockRecordJump).toHaveBeenCalledWith(
      { notePath: "", line: 1, col: 0 },
      { notePath: "target.md", line: 7, col: 0 },
    );
  });
});
