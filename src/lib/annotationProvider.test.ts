import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockInvoke } from "../test/tauri-mock";
import type { AnnotationSearchResult } from "./ipc";

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

import { annotationProvider } from "./annotationProvider";

const mockResults: AnnotationSearchResult[] = [
  {
    annotation_id: 1,
    node_id: "silk-road.md",
    node_title: "Silk Road",
    annotation_type: "note",
    certainty: "firm",
    body: "Ancient trade route connecting East and West",
    date: "2024-03-15",
    source_line: 10,
    char_start: 100,
    char_end: 150,
    uuid: "test-uuid-1",
  },
  {
    annotation_id: 2,
    node_id: "trade-history.md",
    node_title: "Trade History",
    annotation_type: "question",
    certainty: "tentative",
    body: null,
    date: null,
    source_line: 25,
    char_start: 200,
    char_end: 260,
    uuid: "test-uuid-2",
  },
];

describe("annotationProvider", () => {
  beforeEach(() => {
    mockSelectPageAtLine.mockClear();
    mockRecordJump.mockClear();
    mockWorkspaceState.currentPagePath = "other-page.md";
    mockWorkspaceState.graphReady = true;
  });

  it('has id "annotations", prefix "@", label "Annotations", priority 20', () => {
    expect(annotationProvider.id).toBe("annotations");
    expect(annotationProvider.prefix).toBe("@");
    expect(annotationProvider.label).toBe("Annotations");
    expect(annotationProvider.priority).toBe(20);
  });

  it("search(query) calls searchAnnotations IPC and returns PaletteResult[]", async () => {
    mockInvoke((cmd) => {
      if (cmd === "search_annotations") return mockResults;
      return [];
    });
    const results = await annotationProvider.search("silk");
    expect(results).toHaveLength(2);
    expect(results[0]!.title).toBe("Silk Road");
    expect(results[0]!.section).toBe("Annotations");
  });

  it("maps AnnotationSearchResult fields to PaletteResult correctly", async () => {
    mockInvoke((cmd) => {
      if (cmd === "search_annotations") return mockResults;
      return [];
    });
    const results = await annotationProvider.search("silk");
    expect(results[0]!.id).toBe("annotation-1");
    expect(results[0]!.title).toBe("Silk Road");
    expect(results[0]!.subtitle).toBe("Ancient trade route connecting East and West");
    expect(results[0]!.icon).toBe("N");
    expect(results[0]!.data).toEqual({
      node_id: "silk-road.md",
      source_line: 10,
      annotation_id: 1,
      certainty: "firm",
      date: "2024-03-15",
    });
  });

  it('search("") returns []', async () => {
    const results = await annotationProvider.search("");
    expect(results).toEqual([]);
  });

  it("search(query, filter) passes filter as annotationType to IPC", async () => {
    let capturedType: unknown;
    mockInvoke((_cmd, args) => {
      if (_cmd === "search_annotations") {
        capturedType = (args as Record<string, unknown>).annotationType;
        return mockResults;
      }
      return [];
    });
    await annotationProvider.search("silk", "note");
    expect(capturedType).toBe("note");
  });

  it('search(query, "all") passes undefined annotationType (no filter)', async () => {
    let capturedType: unknown;
    mockInvoke((_cmd, args) => {
      if (_cmd === "search_annotations") {
        capturedType = (args as Record<string, unknown>).annotationType;
        return mockResults;
      }
      return [];
    });
    await annotationProvider.search("silk", "all");
    expect(capturedType).toBeNull();
  });

  it("search does not check graphReady (centralized in CommandPalette)", async () => {
    mockWorkspaceState.graphReady = false;
    mockInvoke((cmd) => {
      if (cmd === "search_annotations") return mockResults;
      return [];
    });
    const results = await annotationProvider.search("silk");
    expect(results).toHaveLength(2);
    mockWorkspaceState.graphReady = true;
  });

  it("filterOptions returns expected list", () => {
    const ids = annotationProvider.filterOptions!.map((o) => o.id);
    expect(ids).toEqual(["all", "note", "question", "todo", "crossref", "apparatus", "translation"]);
  });

  it("onSelect records jump via globalJumpTracker.recordJump", () => {
    annotationProvider.onSelect({
      id: "annotation-1",
      title: "Silk Road",
      section: "Annotations",
      data: { node_id: "silk-road.md", source_line: 10 },
    });
    expect(mockRecordJump).toHaveBeenCalledWith(
      { notePath: "other-page.md", line: 1, col: 0 },
      { notePath: "silk-road.md", line: 10, col: 0 },
    );
  });

  it("onSelect calls selectPageAtLine for different page", () => {
    mockWorkspaceState.currentPagePath = "other-page.md";
    annotationProvider.onSelect({
      id: "annotation-1",
      title: "Silk Road",
      section: "Annotations",
      data: { node_id: "silk-road.md", source_line: 10 },
    });
    expect(mockSelectPageAtLine).toHaveBeenCalledWith("silk-road.md", 10);
  });

  it("onSelect dispatches lit:scroll-to-line event for current page", () => {
    mockWorkspaceState.currentPagePath = "silk-road.md";
    const dispatchSpy = vi.spyOn(window, "dispatchEvent");
    annotationProvider.onSelect({
      id: "annotation-1",
      title: "Silk Road",
      section: "Annotations",
      data: { node_id: "silk-road.md", source_line: 10 },
    });
    const scrollEvent = dispatchSpy.mock.calls.find(
      (call) => (call[0] as CustomEvent).type === "lit:scroll-to-line",
    );
    expect(scrollEvent).toBeDefined();
    expect((scrollEvent![0] as CustomEvent).detail).toEqual({ line: 10, cursor: true });
    dispatchSpy.mockRestore();
  });
});
