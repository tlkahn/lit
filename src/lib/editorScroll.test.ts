import { describe, it, expect, vi } from "vitest";
import { Text } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { adjustLineForFrontmatter, resolveLineColPos, applyJumpLine, applyPendingCursorLine } from "./editorScroll";

describe("adjustLineForFrontmatter", () => {
  it("returns line unchanged when fileAbsolute is false", () => {
    expect(adjustLineForFrontmatter(5, false, "title: Hello")).toBe(5);
  });

  it("returns line unchanged when rawYaml is null", () => {
    expect(adjustLineForFrontmatter(5, true, null)).toBe(5);
  });

  it("subtracts frontmatter lines when fileAbsolute and rawYaml present", () => {
    // "title: Hello" → 1 content line + 2 delimiters = 3 lines
    expect(adjustLineForFrontmatter(5, true, "title: Hello")).toBe(2);
  });

  it("clamps to 1 when adjustment would go below", () => {
    expect(adjustLineForFrontmatter(1, true, "title: Hello\ntags: [a, b]")).toBe(1);
  });

  it("handles multi-line frontmatter", () => {
    const yaml = "title: Hello\ntags:\n  - a\n  - b";
    // 4 content lines + 2 delimiters = 6
    expect(adjustLineForFrontmatter(8, true, yaml)).toBe(2);
  });
});

describe("resolveLineColPos", () => {
  const doc = Text.of(["line one", "line two", "line three"]);

  it("resolves position at start of a line", () => {
    const pos = resolveLineColPos(doc, 2, 0);
    expect(pos).toBe(doc.line(2).from);
  });

  it("resolves position at a column within a line", () => {
    const pos = resolveLineColPos(doc, 1, 3);
    expect(pos).toBe(doc.line(1).from + 3);
  });

  it("clamps col to line length", () => {
    const pos = resolveLineColPos(doc, 1, 100);
    expect(pos).toBe(doc.line(1).from + doc.line(1).length);
  });

  it("clamps line to doc.lines when line exceeds document", () => {
    const pos = resolveLineColPos(doc, 99, 0);
    expect(pos).toBe(doc.line(3).from);
  });

  it("handles line 1, col 0", () => {
    expect(resolveLineColPos(doc, 1, 0)).toBe(0);
  });
});

function fakeView(docContent: string) {
  const doc = Text.of(docContent.split("\n"));
  const dispatch = vi.fn();
  const view = {
    state: { doc },
    dispatch,
  } as unknown as EditorView;
  return { view, dispatch };
}

describe("applyJumpLine", () => {
  it("dispatches cursor at start of requested line with y:'start'", () => {
    const { view, dispatch } = fakeView("line one\nline two\nline three");
    applyJumpLine(view, 2);
    expect(dispatch).toHaveBeenCalledTimes(1);
    const tx = dispatch.mock.calls[0]![0];
    expect(tx.selection.head).toBe(view.state.doc.line(2).from);
    expect(tx.effects.value.range.head).toBe(view.state.doc.line(2).from);
  });

  it("clamps to last line when line exceeds document", () => {
    const { view, dispatch } = fakeView("only one line");
    applyJumpLine(view, 99);
    expect(dispatch).toHaveBeenCalledTimes(1);
    const tx = dispatch.mock.calls[0]![0];
    expect(tx.selection.head).toBe(0);
  });
});

describe("applyPendingCursorLine", () => {
  it("dispatches cursor at line+col with y:'center'", () => {
    const { view, dispatch } = fakeView("line one\nline two\nline three");
    applyPendingCursorLine(view, 2, 4, false, null);
    expect(dispatch).toHaveBeenCalledTimes(1);
    const tx = dispatch.mock.calls[0]![0];
    const expected = view.state.doc.line(2).from + 4;
    expect(tx.selection.head).toBe(expected);
  });

  it("treats null col as 0", () => {
    const { view, dispatch } = fakeView("line one\nline two");
    applyPendingCursorLine(view, 2, null, false, null);
    const tx = dispatch.mock.calls[0]![0];
    expect(tx.selection.head).toBe(view.state.doc.line(2).from);
  });

  it("adjusts line for frontmatter when fileAbsolute", () => {
    const { view, dispatch } = fakeView("body line 1\nbody line 2\nbody line 3");
    // rawYaml "title: X" → 3 frontmatter lines (1 content + 2 delimiters)
    // pendingCursorLine=5 (absolute) → adjusted to 5-3=2 (body line 2)
    applyPendingCursorLine(view, 5, 0, true, "title: X");
    const tx = dispatch.mock.calls[0]![0];
    expect(tx.selection.head).toBe(view.state.doc.line(2).from);
  });

  it("clamps col to line length", () => {
    const { view, dispatch } = fakeView("short\nab");
    applyPendingCursorLine(view, 2, 100, false, null);
    const tx = dispatch.mock.calls[0]![0];
    expect(tx.selection.head).toBe(view.state.doc.line(2).from + 2);
  });
});
