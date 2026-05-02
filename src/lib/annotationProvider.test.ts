import { describe, it, expect, vi, beforeEach } from "vitest";
import { annotationProvider } from "./annotationProvider";
import { mockInvoke } from "../test/tauri-mock";
import type { AnnotationSearchResult } from "./ipc";

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
  },
  {
    annotation_id: 2,
    node_id: "trade-history.md",
    node_title: "Trade History",
    annotation_type: "question",
    certainty: "tentative",
    body: "How did the Silk Road influence cultural exchange?",
    date: null,
    source_line: 25,
    char_start: 200,
    char_end: 260,
  },
];

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

describe("annotationProvider", () => {
  beforeEach(() => {
    mockSelectPageAtLine.mockClear();
    mockRecordJump.mockClear();
    mockWorkspaceState.currentPagePath = "other-page.md";
  });

  it('has id "annotations", prefix "@", label "Annotations"', () => {
    expect(annotationProvider.id).toBe("annotations");
    expect(annotationProvider.prefix).toBe("@");
    expect(annotationProvider.label).toBe("Annotations");
  });

  it("search calls searchAnnotations IPC, returns PaletteResult[]", async () => {
    mockInvoke((cmd) => {
      if (cmd === "search_annotations") return mockResults;
      return [];
    });
    const results = await annotationProvider.search("silk");
    expect(results).toHaveLength(2);
    expect(results[0]!.title).toBe("Silk Road");
    expect(results[0]!.section).toBe("Annotations");
  });

  it("maps AnnotationSearchResult fields to PaletteResult", async () => {
    mockInvoke((cmd) => {
      if (cmd === "search_annotations") return mockResults;
      return [];
    });
    const results = await annotationProvider.search("silk");
    const r = results[0]!;
    expect(r.title).toBe("Silk Road");
    expect(r.subtitle).toBe("Ancient trade route connecting East and West");
    expect(r.icon).toBe("N");
    expect(r.section).toBe("Annotations");
    const data = r.data as Record<string, unknown>;
    expect(data.node_id).toBe("silk-road.md");
    expect(data.source_line).toBe(10);
  });

  it('search("") returns []', async () => {
    const results = await annotationProvider.search("");
    expect(results).toEqual([]);
  });

  it("search(query, filter) passes filter to searchAnnotations", async () => {
    let capturedType: string | null = null;
    mockInvoke((_cmd, args) => {
      if (_cmd === "search_annotations") {
        capturedType = (args as Record<string, unknown>).annotationType as string | null;
        return mockResults;
      }
      return [];
    });
    await annotationProvider.search("silk", "note");
    expect(capturedType).toBe("note");
  });

  it('search with filter "all" passes undefined annotationType', async () => {
    let capturedType: unknown = "sentinel";
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

  it("filterOptions returns annotation type list", () => {
    expect(annotationProvider.filterOptions).toBeDefined();
    const ids = annotationProvider.filterOptions!.map((o) => o.id);
    expect(ids).toEqual(["all", "note", "question", "todo", "crossref", "apparatus", "translation"]);
  });

  it("onSelect records jump via globalJumpTracker", () => {
    annotationProvider.onSelect({
      id: "annotation-1",
      title: "Silk Road",
      section: "Annotations",
      data: { node_id: "silk-road.md", source_line: 10 },
    });
    expect(mockRecordJump).toHaveBeenCalled();
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

  it("onSelect dispatches scroll event for current page", () => {
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
    dispatchSpy.mockRestore();
  });
});
