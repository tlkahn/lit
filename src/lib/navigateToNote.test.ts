import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockSelectPageAtLine, mockRecordJump, mockWorkspaceState } = vi.hoisted(() => {
  const mockSelectPageAtLine = vi.fn();
  const mockRecordJump = vi.fn();
  const mockWorkspaceState = {
    currentPagePath: "current-page.md" as string | null,
    selectPageAtLine: mockSelectPageAtLine,
  };
  return { mockSelectPageAtLine, mockRecordJump, mockWorkspaceState };
});

vi.mock("../stores/workspace", () => ({
  useWorkspaceStore: Object.assign(
    (selector: (s: Record<string, unknown>) => unknown) =>
      selector(mockWorkspaceState),
    {
      getState: () => mockWorkspaceState,
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
      line: 15,
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
      line: 20,
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

  it("uses empty string for from notePath when currentPagePath is null", () => {
    mockWorkspaceState.currentPagePath = null;
    navigateToNote("target.md", 7);
    expect(mockRecordJump).toHaveBeenCalledWith(
      { notePath: "", line: 1, col: 0 },
      { notePath: "target.md", line: 7, col: 0 },
    );
  });
});
