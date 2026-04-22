import { describe, it, expect } from "vitest";
import { EditorState, EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { toggleBold, toggleItalic, insertLink, toggleComment } from "./editorCommands";

function makeView(doc: string, from: number, to: number): EditorView {
  const state = EditorState.create({
    doc,
    selection: EditorSelection.single(from, to),
  });
  return new EditorView({ state, parent: document.createElement("div") });
}

function getText(view: EditorView): string {
  return view.state.doc.toString();
}

function getSelection(view: EditorView): { from: number; to: number } {
  const sel = view.state.selection.main;
  return { from: sel.from, to: sel.to };
}

describe("toggleBold", () => {
  it("wraps selection with **", () => {
    const view = makeView("hello world", 6, 11);
    toggleBold(view);
    expect(getText(view)).toBe("hello **world**");
    const sel = getSelection(view);
    expect(view.state.sliceDoc(sel.from, sel.to)).toBe("world");
    view.destroy();
  });

  it("unwraps **selected** back to selected", () => {
    const view = makeView("hello **world**", 6, 15);
    toggleBold(view);
    expect(getText(view)).toBe("hello world");
    view.destroy();
  });

  it("unwraps when cursor is inside bold markers", () => {
    const view = makeView("hello **world**", 8, 13);
    toggleBold(view);
    expect(getText(view)).toBe("hello world");
    view.destroy();
  });

  it("wraps empty selection (inserts markers)", () => {
    const view = makeView("hello", 5, 5);
    toggleBold(view);
    expect(getText(view)).toBe("hello****");
    view.destroy();
  });
});

describe("toggleItalic", () => {
  it("wraps selection with *", () => {
    const view = makeView("hello world", 6, 11);
    toggleItalic(view);
    expect(getText(view)).toBe("hello *world*");
    const sel = getSelection(view);
    expect(view.state.sliceDoc(sel.from, sel.to)).toBe("world");
    view.destroy();
  });

  it("unwraps *selected* back to selected", () => {
    const view = makeView("hello *world*", 6, 13);
    toggleItalic(view);
    expect(getText(view)).toBe("hello world");
    view.destroy();
  });
});

describe("insertLink", () => {
  it("wraps selection as [selection](url)", () => {
    const view = makeView("click here", 6, 10);
    insertLink(view);
    expect(getText(view)).toBe("click [here](url)");
    const sel = getSelection(view);
    expect(view.state.sliceDoc(sel.from, sel.to)).toBe("url");
    view.destroy();
  });

  it("with empty selection inserts [](url) template", () => {
    const view = makeView("text", 4, 4);
    insertLink(view);
    expect(getText(view)).toBe("text[](url)");
    const sel = getSelection(view);
    expect(sel.from).toBe(5);
    view.destroy();
  });
});

describe("toggleComment", () => {
  it("wraps selection with %%", () => {
    const view = makeView("hello world", 6, 11);
    toggleComment(view);
    expect(getText(view)).toBe("hello %%world%%");
    const sel = getSelection(view);
    expect(view.state.sliceDoc(sel.from, sel.to)).toBe("world");
    view.destroy();
  });

  it("unwraps %%selected%% back to selected", () => {
    const view = makeView("hello %%world%%", 6, 15);
    toggleComment(view);
    expect(getText(view)).toBe("hello world");
    view.destroy();
  });

  it("unwraps when cursor is inside comment markers", () => {
    const view = makeView("hello %%world%%", 8, 13);
    toggleComment(view);
    expect(getText(view)).toBe("hello world");
    view.destroy();
  });
});
