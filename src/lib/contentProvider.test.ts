import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockInvoke } from "../test/tauri-mock";
import type { GraphSearchResult } from "./ipc";

const { mockSelectPageAtLine, mockRecordJump, mockWorkspaceState } = vi.hoisted(() => {
  const mockSelectPageAtLine = vi.fn();
  const mockRecordJump = vi.fn();
  const mockWorkspaceState = {
    currentPagePath: "other-page.md" as string | null,
    graphReady: true,
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
    score: 4.2,
    excerpt: "<mark>ownership</mark> and borrowing",
  },
  {
    id: "journal/2024.md",
    title: "Journal 2024",
    score: 1.8,
    excerpt: "new year <mark>reflections</mark>",
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

  it('has omniMode "include"', () => {
    expect(contentProvider.omniMode).toBe("include");
  });

  it('search("") returns []', async () => {
    expect(await contentProvider.search("")).toEqual([]);
  });

  it("search(query) calls searchContent IPC and maps to PaletteResult[]", async () => {
    mockInvoke((cmd) => {
      if (cmd === "search_content") return mockResults;
      return [];
    });
    const results = await contentProvider.search("rust");
    expect(results).toHaveLength(2);
    expect(results[0]!.title).toBe("Rust Notes");
    expect(results[0]!.section).toBe("Content");
  });

  it('subtitle strips <mark> tags and uses "path — excerpt" format', async () => {
    mockInvoke((cmd) => {
      if (cmd === "search_content") return mockResults;
      return [];
    });
    const results = await contentProvider.search("rust");
    expect(results[0]!.subtitle).toBe("notes/rust.md — ownership and borrowing");
  });

  it('subtitle strips <mark> from second result too', async () => {
    mockInvoke((cmd) => {
      if (cmd === "search_content") return mockResults;
      return [];
    });
    const results = await contentProvider.search("rust");
    expect(results[1]!.subtitle).toBe("journal/2024.md — new year reflections");
  });

  it("result.data includes path (no line from FTS5)", async () => {
    mockInvoke((cmd) => {
      if (cmd === "search_content") return mockResults;
      return [];
    });
    const results = await contentProvider.search("rust");
    expect(results[0]!.data).toEqual({ path: "notes/rust.md", line: undefined });
    expect(results[1]!.data).toEqual({ path: "journal/2024.md", line: undefined });
    // Verify the `line` key is explicitly present (passed through from backend)
    expect(Object.keys(results[0]!.data as object)).toContain("line");
    expect(Object.keys(results[1]!.data as object)).toContain("line");
  });

  it("onSelect navigates to provided line when present", () => {
    mockWorkspaceState.currentPagePath = "other-page.md";
    contentProvider.onSelect({
      id: "content-notes/rust.md",
      title: "Rust Notes",
      section: "Content",
      data: { path: "notes/rust.md", line: 42 },
    });
    expect(mockSelectPageAtLine).toHaveBeenCalledWith("notes/rust.md", 42);
    expect(mockRecordJump).toHaveBeenCalledWith(
      { notePath: "other-page.md", line: 1, col: 0 },
      { notePath: "notes/rust.md", line: 42, col: 0 },
    );
  });

  it("onSelect navigates to line 1 for different page", () => {
    mockWorkspaceState.currentPagePath = "other-page.md";
    contentProvider.onSelect({
      id: "content-notes/rust.md",
      title: "Rust Notes",
      section: "Content",
      data: { path: "notes/rust.md" },
    });
    expect(mockSelectPageAtLine).toHaveBeenCalledWith("notes/rust.md", 1);
    expect(mockRecordJump).toHaveBeenCalledWith(
      { notePath: "other-page.md", line: 1, col: 0 },
      { notePath: "notes/rust.md", line: 1, col: 0 },
    );
  });

  it("onSelect dispatches lit:scroll-to-line for same page", () => {
    mockWorkspaceState.currentPagePath = "notes/rust.md";
    const dispatchSpy = vi.spyOn(window, "dispatchEvent");
    contentProvider.onSelect({
      id: "content-notes/rust.md",
      title: "Rust Notes",
      section: "Content",
      data: { path: "notes/rust.md" },
    });
    const scrollEvent = dispatchSpy.mock.calls.find(
      (call) => (call[0] as CustomEvent).type === "lit:scroll-to-line",
    );
    expect(scrollEvent).toBeDefined();
    expect((scrollEvent![0] as CustomEvent).detail).toEqual({ line: 1, cursor: true });
    expect(mockSelectPageAtLine).not.toHaveBeenCalled();
    dispatchSpy.mockRestore();
  });
});
