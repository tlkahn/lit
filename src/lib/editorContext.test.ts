import { describe, it, expect, vi, afterEach } from "vitest";
import { requestEditorContext, enrichWithEditorContext } from "./editorContext";
import { DEFAULT_EDITOR_CONTEXT } from "../types";

vi.mock("./editorViewRef", () => ({
  getCurrentEditorView: vi.fn(() => null),
}));

vi.mock("../stores/workspace", () => ({
  useWorkspaceStore: { getState: () => ({ currentPagePath: null }) },
}));

import type { EditorView } from "@codemirror/view";
import { getCurrentEditorView } from "./editorViewRef";
import { useWorkspaceStore } from "../stores/workspace";

const mockedGetView = vi.mocked(getCurrentEditorView);
const mockableStore = useWorkspaceStore as unknown as {
  getState: () => { currentPagePath: string | null };
};

afterEach(() => {
  vi.restoreAllMocks();
  mockedGetView.mockReturnValue(null);
});

describe("requestEditorContext", () => {
  it("returns DEFAULT_EDITOR_CONTEXT when no editor view is available", () => {
    mockedGetView.mockReturnValue(null);
    const ctx = requestEditorContext();
    expect(ctx).toEqual(DEFAULT_EDITOR_CONTEXT);
  });

  it("returns selection text and positions from the focused editor view", () => {
    const fakeView = {
      state: {
        selection: { main: { from: 6, to: 11 } },
        sliceDoc: (from: number, to: number) => "hello world".slice(from, to),
      },
    };
    mockedGetView.mockReturnValue(fakeView as unknown as EditorView);
    mockableStore.getState = () => ({ currentPagePath: "notes/test.md" });

    const ctx = requestEditorContext();
    expect(ctx.selectionText).toBe("world");
    expect(ctx.selectionFrom).toBe(6);
    expect(ctx.selectionTo).toBe(11);
    expect(ctx.filePath).toBe("notes/test.md");
  });

  it("returns empty selectionText when selection is collapsed", () => {
    const fakeView = {
      state: {
        selection: { main: { from: 5, to: 5 } },
        sliceDoc: () => "",
      },
    };
    mockedGetView.mockReturnValue(fakeView as unknown as EditorView);
    mockableStore.getState = () => ({ currentPagePath: "test.md" });

    const ctx = requestEditorContext();
    expect(ctx.selectionText).toBe("");
    expect(ctx.selectionFrom).toBe(5);
    expect(ctx.selectionTo).toBe(5);
  });

  it("returns empty filePath when currentPagePath is null", () => {
    const fakeView = {
      state: {
        selection: { main: { from: 0, to: 0 } },
        sliceDoc: () => "",
      },
    };
    mockedGetView.mockReturnValue(fakeView as unknown as EditorView);
    mockableStore.getState = () => ({ currentPagePath: null });

    const ctx = requestEditorContext();
    expect(ctx.filePath).toBe("");
  });
});

describe("enrichWithEditorContext", () => {
  it("returns undefined when no editor view is available", () => {
    mockedGetView.mockReturnValue(null);
    expect(enrichWithEditorContext("explain this")).toBeUndefined();
  });

  it("returns enriched text when editor has a selection", () => {
    const fakeView = {
      state: {
        selection: { main: { from: 6, to: 11 } },
        sliceDoc: (from: number, to: number) => "hello world".slice(from, to),
      },
    };
    mockedGetView.mockReturnValue(fakeView as unknown as EditorView);
    mockableStore.getState = () => ({ currentPagePath: "notes/test.md" });

    expect(enrichWithEditorContext("explain this")).toBe(
      "File: notes/test.md\n\nContext:\nworld\n\nexplain this",
    );
  });

  it("returns enriched text with only filePath when selection is collapsed", () => {
    const fakeView = {
      state: {
        selection: { main: { from: 5, to: 5 } },
        sliceDoc: () => "",
      },
    };
    mockedGetView.mockReturnValue(fakeView as unknown as EditorView);
    mockableStore.getState = () => ({ currentPagePath: "notes/test.md" });

    expect(enrichWithEditorContext("explain this")).toBe(
      "File: notes/test.md\n\nexplain this",
    );
  });

  it("returns undefined when selection is collapsed and no filePath", () => {
    const fakeView = {
      state: {
        selection: { main: { from: 5, to: 5 } },
        sliceDoc: () => "",
      },
    };
    mockedGetView.mockReturnValue(fakeView as unknown as EditorView);
    mockableStore.getState = () => ({ currentPagePath: null });

    expect(enrichWithEditorContext("explain this")).toBeUndefined();
  });
});
