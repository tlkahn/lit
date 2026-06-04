import { describe, it, expect, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { history, undo } from "@codemirror/commands";
import type { Annotation } from "./ipc";
import { buildCompanionDsl, insertCompanionAnnotation, insertCompanionAtCursor } from "./companionInsert";

vi.mock("./ipc", () => ({
  parseAnnotations: vi.fn(async () => []),
}));

function makeAnnotation(overrides: Partial<Annotation> = {}): Annotation {
  return {
    form: "compact",
    annotation_type: "question",
    certainty: "neutral",
    scope: { kind: "sentence", value: 1 },
    body: "why?",
    date: null,
    is_structured: true,
    char_start: 6,
    char_end: 25,
    original: "<!--- q | why? --->",
    ...overrides,
  };
}

describe("buildCompanionDsl", () => {
  it("returns a note annotation DSL wrapping the response", () => {
    const dsl = buildCompanionDsl("The answer is 42.");
    expect(dsl).toContain("n");
    expect(dsl).toContain("The answer is 42.");
    expect(dsl).toMatch(/^<!---/);
    expect(dsl).toMatch(/--->$/);
  });

  it("uses block form for multiline response", () => {
    const dsl = buildCompanionDsl("line1\nline2\nline3");
    expect(dsl).toContain("\n---\n");
    expect(dsl).toContain("line1\nline2\nline3");
  });
});

describe("insertCompanionAnnotation", () => {
  it("inserts companion DSL after source annotation char_end", () => {
    const doc = "hello <!--- q | why? ---> world";
    const view = new EditorView({
      state: EditorState.create({ doc }),
      parent: document.createElement("div"),
    });
    const ann = makeAnnotation({ char_start: 6, char_end: 25 });

    insertCompanionAnnotation(view, ann, "The answer.");

    const result = view.state.doc.toString();
    expect(result.slice(0, 25)).toBe("hello <!--- q | why? --->");
    expect(result.slice(25, 27)).toBe("\n\n");
    expect(result.slice(27)).toContain("<!---");
    expect(result.slice(27)).toContain("The answer.");
    expect(result).toMatch(/--->\n/);  // trailing newline after closing tag

    view.destroy();
  });

  it("source annotation text is unchanged after insertion", () => {
    const doc = "hello <!--- q | why? ---> world";
    const view = new EditorView({
      state: EditorState.create({ doc }),
      parent: document.createElement("div"),
    });
    const ann = makeAnnotation({ char_start: 6, char_end: 25 });

    insertCompanionAnnotation(view, ann, "answer");

    const result = view.state.doc.toString();
    expect(result.slice(6, 25)).toBe("<!--- q | why? --->");

    view.destroy();
  });

  it("removeSource: true deletes source and inserts companion", () => {
    const doc = "before <!--- q | why? ---> after";
    const view = new EditorView({
      state: EditorState.create({ doc }),
      parent: document.createElement("div"),
    });
    const ann = makeAnnotation({ char_start: 7, char_end: 26 });

    insertCompanionAnnotation(view, ann, "The answer.", { removeSource: true });

    const result = view.state.doc.toString();
    expect(result).not.toContain("<!--- q | why? --->");
    expect(result).toContain("The answer.");
    expect(result).toMatch(/^before /);
    expect(result).toContain(" after");
  });

  it("removeSource: true produces a single undo step", () => {
    const doc = "before <!--- q | why? ---> after";
    const view = new EditorView({
      state: EditorState.create({ doc, extensions: [history()] }),
      parent: document.createElement("div"),
    });
    const ann = makeAnnotation({ char_start: 7, char_end: 26 });

    insertCompanionAnnotation(view, ann, "The answer.", { removeSource: true });

    expect(view.state.doc.toString()).not.toBe(doc);

    undo(view);

    expect(view.state.doc.toString()).toBe(doc);
    view.destroy();
  });

  it("default (no options) preserves source annotation", () => {
    const doc = "before <!--- q | why? ---> after";
    const view = new EditorView({
      state: EditorState.create({ doc }),
      parent: document.createElement("div"),
    });
    const ann = makeAnnotation({ char_start: 7, char_end: 26 });

    insertCompanionAnnotation(view, ann, "The answer.");

    const result = view.state.doc.toString();
    expect(result).toContain("<!--- q | why? --->");
    expect(result).toContain("The answer.");
    view.destroy();
  });
});

describe("insertCompanionAtCursor", () => {
  it("inserts companion DSL at the current cursor position", () => {
    const doc = "hello world";
    const view = new EditorView({
      state: EditorState.create({ doc }),
      parent: document.createElement("div"),
    });
    view.dispatch({ selection: { anchor: 5 } });

    insertCompanionAtCursor(view, "The answer.");

    const result = view.state.doc.toString();
    expect(result.slice(0, 5)).toBe("hello");
    expect(result.slice(5, 7)).toBe("\n\n");
    expect(result.slice(7)).toContain("<!---");
    expect(result.slice(7)).toContain("The answer.");
    expect(result).toMatch(/--->\n/);  // trailing newline after closing tag

    view.destroy();
  });

  it("does not prepend \\n\\n when cursor is at position 0", () => {
    const doc = "hello world";
    const view = new EditorView({
      state: EditorState.create({ doc }),
      parent: document.createElement("div"),
    });

    insertCompanionAtCursor(view, "response");

    const result = view.state.doc.toString();
    expect(result.startsWith("\n\n")).toBe(false);
    expect(result).toMatch(/^<!---/);
    expect(result).toContain("response");

    view.destroy();
  });

  it("inserts after selection end for backward (right-to-left) selection", () => {
    const doc = "hello world";
    const view = new EditorView({
      state: EditorState.create({ doc }),
      parent: document.createElement("div"),
    });
    view.dispatch({ selection: { anchor: 10, head: 5 } });

    insertCompanionAtCursor(view, "response");

    const result = view.state.doc.toString();
    expect(result.slice(0, 10)).toBe("hello worl");
    expect(result.slice(10, 12)).toBe("\n\n");
    expect(result.slice(12)).toContain("response");

    view.destroy();
  });

  it("calls view.focus() after insertion", () => {
    const doc = "hello world";
    const view = new EditorView({
      state: EditorState.create({ doc }),
      parent: document.createElement("div"),
    });
    const focusSpy = vi.spyOn(view, "focus");

    insertCompanionAtCursor(view, "response");

    expect(focusSpy).toHaveBeenCalledTimes(1);

    view.destroy();
  });
});
