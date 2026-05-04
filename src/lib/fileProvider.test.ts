import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockInvoke } from "../test/tauri-mock";
import type { GraphSearchResult } from "./ipc";

const { mockSelectPage, mockRecordJump, mockWorkspaceState } = vi.hoisted(() => {
  const mockSelectPage = vi.fn();
  const mockRecordJump = vi.fn();
  const mockWorkspaceState = {
    currentPagePath: "other-page.md" as string | null,
    selectPage: mockSelectPage,
  };
  return { mockSelectPage, mockRecordJump, mockWorkspaceState };
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

import { fileProvider, _fileIcon } from "./fileProvider";

const mockResults: GraphSearchResult[] = [
  {
    id: "silk-road.md",
    title: "Silk Road",
    score: 1.0,
    excerpt: "Ancient trade route connecting East and West",
  },
  {
    id: "trade-history.md",
    title: "Trade History",
    score: 0.8,
    excerpt: "",
  },
  {
    id: "report.pdf",
    title: "Trade Report",
    score: 0.5,
    excerpt: "PDF document about trade",
  },
];

describe("fileProvider", () => {
  beforeEach(() => {
    mockSelectPage.mockClear();
    mockRecordJump.mockClear();
    mockWorkspaceState.currentPagePath = "other-page.md";
  });

  it('has id "files", prefix "$", label "Files", priority 10', () => {
    expect(fileProvider.id).toBe("files");
    expect(fileProvider.prefix).toBe("$");
    expect(fileProvider.label).toBe("Files");
    expect(fileProvider.priority).toBe(10);
  });

  it('search("") returns []', async () => {
    const results = await fileProvider.search("");
    expect(results).toEqual([]);
  });

  it("search(query) calls searchPagesByTitle IPC and returns PaletteResult[]", async () => {
    mockInvoke((cmd) => {
      if (cmd === "search_pages_by_title") return mockResults;
      return [];
    });
    const results = await fileProvider.search("silk");
    expect(results).toHaveLength(3);
    expect(results[0]!.title).toBe("Silk Road");
    expect(results[0]!.section).toBe("Files");
  });

  it("maps GraphSearchResult fields to PaletteResult correctly", async () => {
    mockInvoke((cmd) => {
      if (cmd === "search_pages_by_title") return mockResults;
      return [];
    });
    const results = await fileProvider.search("silk");
    expect(results[0]).toEqual({
      id: "silk-road.md",
      title: "Silk Road",
      subtitle: "Ancient trade route connecting East and West",
      icon: "",
      section: "Files",
      data: { path: "silk-road.md" },
    });
  });

  it(".md file gets file_text_o icon, .pdf gets file_o icon", () => {
    expect(_fileIcon("notes.md")).toBe("");
    expect(_fileIcon("report.pdf")).toBe("");
  });

  it("unknown extension gets default icon", () => {
    expect(_fileIcon("data.csv")).toBe("");
    expect(_fileIcon("noext")).toBe("");
  });

  it("empty excerpt omits subtitle (undefined)", async () => {
    mockInvoke((cmd) => {
      if (cmd === "search_pages_by_title") return mockResults;
      return [];
    });
    const results = await fileProvider.search("silk");
    expect(results[1]!.subtitle).toBeUndefined();
  });

  it("onSelect navigates to a different page", () => {
    mockWorkspaceState.currentPagePath = "other.md";
    fileProvider.onSelect({
      id: "silk-road.md",
      title: "Silk Road",
      section: "Files",
      data: { path: "silk-road.md" },
    });
    expect(mockSelectPage).toHaveBeenCalledWith("silk-road.md");
    expect(mockRecordJump).toHaveBeenCalledWith(
      { notePath: "other.md", line: 1, col: 0 },
      { notePath: "silk-road.md", line: 1, col: 0 },
    );
  });

  it("onSelect is no-op for current page", () => {
    mockWorkspaceState.currentPagePath = "silk-road.md";
    fileProvider.onSelect({
      id: "silk-road.md",
      title: "Silk Road",
      section: "Files",
      data: { path: "silk-road.md" },
    });
    expect(mockSelectPage).not.toHaveBeenCalled();
    expect(mockRecordJump).not.toHaveBeenCalled();
  });

  it("onSelect handles null currentPagePath", () => {
    mockWorkspaceState.currentPagePath = null;
    fileProvider.onSelect({
      id: "silk-road.md",
      title: "Silk Road",
      section: "Files",
      data: { path: "silk-road.md" },
    });
    expect(mockSelectPage).toHaveBeenCalledWith("silk-road.md");
    expect(mockRecordJump).toHaveBeenCalledWith(
      { notePath: "", line: 1, col: 0 },
      { notePath: "silk-road.md", line: 1, col: 0 },
    );
  });
});
