import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockInvoke } from "../test/tauri-mock";
import type { GraphSearchResult } from "./ipc";

const { mockSelectPageAtLine, mockRecordJump, mockWorkspaceState } = vi.hoisted(() => {
  const mockSelectPageAtLine = vi.fn();
  const mockRecordJump = vi.fn();
  const mockWorkspaceState = {
    currentPagePath: "other-page.md" as string | null,
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

import { contentProvider } from "./contentProvider";

const mockResults: GraphSearchResult[] = [
  {
    id: "notes/rust.md",
    title: "Rust Notes",
    score: -3.0,
    excerpt: "ownership and borrowing",
    first_match_line: 12,
  },
  {
    id: "journal/2024.md",
    title: "Journal 2024",
    score: -1.0,
    excerpt: "new year reflections",
  },
];

describe("contentProvider", () => {
  beforeEach(() => {
    mockSelectPageAtLine.mockClear();
    mockRecordJump.mockClear();
    mockWorkspaceState.currentPagePath = "other-page.md";
  });

  it('has id "content", prefix "/", label "Content", priority 40', () => {
    expect(contentProvider.id).toBe("content");
    expect(contentProvider.prefix).toBe("/");
    expect(contentProvider.label).toBe("Content");
    expect(contentProvider.priority).toBe(40);
  });

  it('has omniMode "exclude"', () => {
    expect(contentProvider.omniMode).toBe("exclude");
  });

  it('search("") returns []', async () => {
    expect(await contentProvider.search("")).toEqual([]);
  });

  it("search(query) calls searchPages IPC and maps to PaletteResult[]", async () => {
    mockInvoke((cmd) => {
      if (cmd === "search_pages") return mockResults;
      return [];
    });
    const results = await contentProvider.search("rust");
    expect(results).toHaveLength(2);
    expect(results[0]!.title).toBe("Rust Notes");
    expect(results[0]!.section).toBe("Content");
  });

  it('subtitle format: "path:line — excerpt" when line present', async () => {
    mockInvoke((cmd) => {
      if (cmd === "search_pages") return mockResults;
      return [];
    });
    const results = await contentProvider.search("rust");
    expect(results[0]!.subtitle).toBe("notes/rust.md:12 — ownership and borrowing");
  });

  it('subtitle format: "path — excerpt" when line absent', async () => {
    mockInvoke((cmd) => {
      if (cmd === "search_pages") return mockResults;
      return [];
    });
    const results = await contentProvider.search("rust");
    expect(results[1]!.subtitle).toBe("journal/2024.md — new year reflections");
  });

  it("result.data includes path and line", async () => {
    mockInvoke((cmd) => {
      if (cmd === "search_pages") return mockResults;
      return [];
    });
    const results = await contentProvider.search("rust");
    expect(results[0]!.data).toEqual({ path: "notes/rust.md", line: 12 });
    expect(results[1]!.data).toEqual({ path: "journal/2024.md", line: undefined });
  });

  it("onSelect navigates to page+line for different page", () => {
    mockWorkspaceState.currentPagePath = "other-page.md";
    contentProvider.onSelect({
      id: "content-notes/rust.md",
      title: "Rust Notes",
      section: "Content",
      data: { path: "notes/rust.md", line: 12 },
    });
    expect(mockSelectPageAtLine).toHaveBeenCalledWith("notes/rust.md", 12);
    expect(mockRecordJump).toHaveBeenCalledWith(
      { notePath: "other-page.md", line: 1, col: 0 },
      { notePath: "notes/rust.md", line: 12, col: 0 },
    );
  });

  it("onSelect dispatches lit:scroll-to-line for same page", () => {
    mockWorkspaceState.currentPagePath = "notes/rust.md";
    const dispatchSpy = vi.spyOn(window, "dispatchEvent");
    contentProvider.onSelect({
      id: "content-notes/rust.md",
      title: "Rust Notes",
      section: "Content",
      data: { path: "notes/rust.md", line: 12 },
    });
    const scrollEvent = dispatchSpy.mock.calls.find(
      (call) => (call[0] as CustomEvent).type === "lit:scroll-to-line",
    );
    expect(scrollEvent).toBeDefined();
    expect((scrollEvent![0] as CustomEvent).detail).toEqual({ line: 12, cursor: true });
    expect(mockSelectPageAtLine).not.toHaveBeenCalled();
    dispatchSpy.mockRestore();
  });

  it("onSelect falls back to line 1 when line is undefined", () => {
    mockWorkspaceState.currentPagePath = "other-page.md";
    contentProvider.onSelect({
      id: "content-journal/2024.md",
      title: "Journal 2024",
      section: "Content",
      data: { path: "journal/2024.md" },
    });
    expect(mockSelectPageAtLine).toHaveBeenCalledWith("journal/2024.md", 1);
    expect(mockRecordJump).toHaveBeenCalledWith(
      { notePath: "other-page.md", line: 1, col: 0 },
      { notePath: "journal/2024.md", line: 1, col: 0 },
    );
  });
});
