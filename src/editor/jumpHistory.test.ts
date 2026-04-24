import { describe, it, expect, beforeEach, vi } from "vitest";
import { EditorState, EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import {
  jumpHistoryExtension,
  navigateBack,
  navigateForward,
  docReplaced,
  isJumpNavigation,
} from "./jumpHistory";
import { globalJumpTracker } from "./jumpTracker";

vi.mock("../stores/workspace", () => ({
  useWorkspaceStore: {
    getState: vi.fn(() => ({
      currentPagePath: "note-a.md",
      selectPageAtLine: vi.fn(),
    })),
  },
}));

import { useWorkspaceStore } from "../stores/workspace";

function createView(doc: string): EditorView {
  const state = EditorState.create({
    doc,
    extensions: [jumpHistoryExtension()],
  });
  return new EditorView({ state, parent: document.createElement("div") });
}

function lines(n: number): string {
  return Array.from({ length: n }, (_, i) => `line ${i + 1}`).join("\n");
}

describe("jumpHistoryExtension", () => {
  beforeEach(() => {
    globalJumpTracker.clear();
    vi.mocked(useWorkspaceStore.getState).mockReturnValue({
      currentPagePath: "note-a.md",
      selectPageAtLine: vi.fn(),
    } as never);
  });

  it("cursor move >= 5 lines records a jump", () => {
    const view = createView(lines(20));
    const line6 = view.state.doc.line(6).from;
    view.dispatch({ selection: EditorSelection.cursor(line6) });
    expect(globalJumpTracker.jumps).toHaveLength(1);
    view.destroy();
  });

  it("cursor move < 5 lines does not record", () => {
    const view = createView(lines(20));
    const line3 = view.state.doc.line(3).from;
    view.dispatch({ selection: EditorSelection.cursor(line3) });
    expect(globalJumpTracker.jumps).toHaveLength(0);
    view.destroy();
  });

  it("doc change (typing) does not record", () => {
    const view = createView(lines(20));
    view.dispatch({ changes: { from: 0, insert: "extra\n\n\n\n\n\n" } });
    expect(globalJumpTracker.jumps).toHaveLength(0);
    view.destroy();
  });

  it("docReplaced annotation prevents recording and resets tracking", () => {
    const view = createView(lines(20));
    const line10 = view.state.doc.line(10).from;
    view.dispatch({ selection: EditorSelection.cursor(line10) });
    expect(globalJumpTracker.jumps).toHaveLength(1);

    globalJumpTracker.clear();

    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: lines(10) },
      annotations: docReplaced.of(true),
    });

    const line6 = view.state.doc.line(6).from;
    view.dispatch({ selection: EditorSelection.cursor(line6) });
    expect(globalJumpTracker.jumps).toHaveLength(0);
    view.destroy();
  });

  it("post-doc-replacement cursor restore does not record", () => {
    const view = createView(lines(20));
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: lines(15) },
      annotations: docReplaced.of(true),
    });

    const line8 = view.state.doc.line(8).from;
    view.dispatch({ selection: EditorSelection.cursor(line8) });

    expect(globalJumpTracker.jumps).toHaveLength(0);
    view.destroy();
  });

  it("isJumpNavigation annotation prevents recording", () => {
    const view = createView(lines(20));
    const line10 = view.state.doc.line(10).from;
    view.dispatch({
      selection: EditorSelection.cursor(line10),
      annotations: isJumpNavigation.of(true),
    });
    expect(globalJumpTracker.jumps).toHaveLength(0);
    view.destroy();
  });

  it("tracker.isNavigating flag prevents recording", () => {
    const view = createView(lines(20));
    globalJumpTracker.isNavigating = true;
    const line10 = view.state.doc.line(10).from;
    view.dispatch({ selection: EditorSelection.cursor(line10) });
    expect(globalJumpTracker.jumps).toHaveLength(0);
    globalJumpTracker.isNavigating = false;
    view.destroy();
  });

  it("navigateBack dispatches cursor + scrollIntoView for same-note", () => {
    const view = createView(lines(20));
    const line10 = view.state.doc.line(10).from;
    view.dispatch({ selection: EditorSelection.cursor(line10) });

    const result = navigateBack(view);
    expect(result).toBe(true);
    expect(view.state.doc.lineAt(view.state.selection.main.head).number).toBe(1);
    view.destroy();
  });

  it("navigateForward dispatches cursor for same-note", () => {
    const view = createView(lines(20));
    const line10 = view.state.doc.line(10).from;
    view.dispatch({ selection: EditorSelection.cursor(line10) });

    navigateBack(view);
    const result = navigateForward(view);
    expect(result).toBe(true);
    expect(view.state.doc.lineAt(view.state.selection.main.head).number).toBe(10);
    view.destroy();
  });

  it("cross-note navigation calls store's selectPageAtLine", () => {
    const mockSelectPageAtLine = vi.fn();
    vi.mocked(useWorkspaceStore.getState).mockReturnValue({
      currentPagePath: "note-a.md",
      selectPageAtLine: mockSelectPageAtLine,
    } as never);

    const view = createView(lines(20));
    globalJumpTracker.recordJump(
      { notePath: "note-b.md", line: 5, col: 0 },
      { notePath: "note-a.md", line: 1, col: 0 },
    );

    navigateBack(view);

    expect(mockSelectPageAtLine).toHaveBeenCalledWith("note-b.md", 5);
    expect(globalJumpTracker.isNavigating).toBe(true);
    globalJumpTracker.isNavigating = false;
    view.destroy();
  });
});
