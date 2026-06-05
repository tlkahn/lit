import { describe, it, expect, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { history, undo } from "@codemirror/commands";
import type { Annotation } from "./ipc";
import { buildCompanionDsl, insertCompanionAnnotation, insertCompanionAtCursor, buildThreadDsl } from "./companionInsert";

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

  it("inherits paragraph scope when provided", () => {
    const dsl = buildCompanionDsl("answer", { kind: "paragraph", value: 1 });
    expect(dsl).toContain("\\p");
  });

  it("inherits document scope when provided", () => {
    const dsl = buildCompanionDsl("answer", { kind: "document", value: 0 });
    expect(dsl).toContain("\\d");
  });

  it("inherits section scope when provided", () => {
    const dsl = buildCompanionDsl("answer", { kind: "section", value: 0 });
    expect(dsl).toContain("\\h");
  });

  it("defaults to no scope when omitted", () => {
    const dsl = buildCompanionDsl("answer");
    expect(dsl).not.toMatch(/\\[spdh]/);
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
    expect(result).not.toMatch(/^before \n\n\n/);
    expect(result).toContain(" after");
  });

  it("removeSource: true at char_start === 0 does not produce leading blank lines", () => {
    const doc = "<!--- q | why? ---> after";
    const view = new EditorView({
      state: EditorState.create({ doc }),
      parent: document.createElement("div"),
    });
    const ann = makeAnnotation({ char_start: 0, char_end: 19 });

    insertCompanionAnnotation(view, ann, "The answer.", { removeSource: true });

    const result = view.state.doc.toString();
    expect(result).not.toContain("<!--- q | why? --->");
    expect(result.startsWith("\n")).toBe(false);
    expect(result).toMatch(/^<!---/);
    expect(result).toContain("The answer.");
    expect(result).toContain(" after");

    view.destroy();
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

  it("inherits paragraph scope from source annotation", () => {
    const doc = "hello <!--- q \\p | why? ---> world";
    const view = new EditorView({
      state: EditorState.create({ doc }),
      parent: document.createElement("div"),
    });
    const ann = makeAnnotation({
      char_start: 6,
      char_end: 28,
      scope: { kind: "paragraph", value: 1 },
      original: "<!--- q \\p | why? --->",
    });

    insertCompanionAnnotation(view, ann, "The answer.");

    const result = view.state.doc.toString();
    expect(result).toContain("\\p");
    view.destroy();
  });

  it("inherits document scope from source annotation", () => {
    const doc = "hello <!--- q \\d | why? ---> world";
    const view = new EditorView({
      state: EditorState.create({ doc }),
      parent: document.createElement("div"),
    });
    const ann = makeAnnotation({
      char_start: 6,
      char_end: 28,
      scope: { kind: "document", value: 0 },
      original: "<!--- q \\d | why? --->",
    });

    insertCompanionAnnotation(view, ann, "The answer.");

    const result = view.state.doc.toString();
    expect(result).toContain("\\d");
    view.destroy();
  });

  it("does not emit scope for implicit sentence scope", () => {
    const doc = "hello <!--- q | why? ---> world";
    const view = new EditorView({
      state: EditorState.create({ doc }),
      parent: document.createElement("div"),
    });
    const ann = makeAnnotation({
      char_start: 6,
      char_end: 25,
      scope: { kind: "sentence", value: 1 },
      original: "<!--- q | why? --->",
    });

    insertCompanionAnnotation(view, ann, "The answer.");

    const result = view.state.doc.toString();
    const companionPart = result.slice(result.indexOf("\n\n") + 2);
    expect(companionPart).not.toMatch(/\\[spdh]/);
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

describe("buildThreadDsl", () => {
  it("emits a thread (th) type code in block form", () => {
    const ann = makeAnnotation({ annotation_type: "llm", body: "explain this", original: "<!--- llm | explain this --->" });
    const dsl = buildThreadDsl(ann, "Here is the explanation.");
    expect(dsl).toMatch(/^<!---\[[0-9a-f-]+\]/);
    // block form: type code on its own line
    expect(dsl).toContain("\nth\n");
    expect(dsl).toContain("\n---\n");
  });

  it("embeds the source body as the first [q]: turn and the response after it", () => {
    const ann = makeAnnotation({ annotation_type: "llm", body: "explain this", original: "<!--- llm | explain this --->" });
    const dsl = buildThreadDsl(ann, "Here is the explanation.");
    expect(dsl).toContain("[q]: explain this");
    expect(dsl).toContain("Here is the explanation.");
  });

  it("uses 'Translate' as the first-turn question for translation type", () => {
    const ann = makeAnnotation({ annotation_type: "translation", body: "some hint", original: "<!--- tr | some hint --->" });
    const dsl = buildThreadDsl(ann, "翻译结果");
    expect(dsl).toContain("[q]: Translate");
    expect(dsl).toContain("翻译结果");
  });

  it("falls back to a non-empty question for llm with empty/whitespace body", () => {
    const ann = makeAnnotation({ annotation_type: "llm", body: "   ", original: "<!--- llm --->" });
    const dsl = buildThreadDsl(ann, "A summary.");
    // must not emit a bare empty "[q]: " line
    expect(dsl).not.toMatch(/\[q\]: *\n/);
    expect(dsl).not.toMatch(/\[q\]: *$/m);
    expect(dsl).toContain("A summary.");
  });

  it("falls back to a non-empty question for llm with null body", () => {
    const ann = makeAnnotation({ annotation_type: "llm", body: null, original: "<!--- llm --->" });
    const dsl = buildThreadDsl(ann, "A summary.");
    expect(dsl).not.toMatch(/\[q\]: *\n/);
    expect(dsl).not.toMatch(/\[q\]: *$/m);
  });

  it("falls back to a non-empty question for question type with empty body", () => {
    const ann = makeAnnotation({ annotation_type: "question", body: "   ", original: "<!--- q --->" });
    const dsl = buildThreadDsl(ann, "The answer.");
    expect(dsl).toContain("[q]: Answer");
    expect(dsl).not.toMatch(/\[q\]: *\n/);
    expect(dsl).not.toMatch(/\[q\]: *$/m);
    expect(dsl).toContain("The answer.");
  });

  it("falls back to a non-empty question for question type with null body", () => {
    const ann = makeAnnotation({ annotation_type: "question", body: null, original: "<!--- q --->" });
    const dsl = buildThreadDsl(ann, "The answer.");
    expect(dsl).toContain("[q]: Answer");
    expect(dsl).not.toMatch(/\[q\]: *$/m);
  });

  it("uses the source body verbatim for question type with a non-empty body", () => {
    const ann = makeAnnotation({ annotation_type: "question", body: "why?", original: "<!--- q | why? --->" });
    const dsl = buildThreadDsl(ann, "Because.");
    expect(dsl).toContain("[q]: why?");
    expect(dsl).not.toContain("[q]: Answer");
  });

  it("uses 'Respond' as the generic fallback for an unknown fireable type with empty body", () => {
    const ann = makeAnnotation({ annotation_type: "llm" as Annotation["annotation_type"], body: null, original: "<!--- x --->" });
    // Force a non-branched type: override annotation_type to something not llm/translation/question
    (ann as { annotation_type: string }).annotation_type = "summary";
    const dsl = buildThreadDsl(ann, "The summary.");
    expect(dsl).toContain("[q]: Respond");
    expect(dsl).not.toContain("[q]: Answer");
    expect(dsl).toContain("The summary.");
  });

  it("uses source body for an unknown fireable type with a non-empty body", () => {
    const ann = makeAnnotation({ annotation_type: "llm" as Annotation["annotation_type"], body: "custom prompt", original: "<!--- x --->" });
    (ann as { annotation_type: string }).annotation_type = "summary";
    const dsl = buildThreadDsl(ann, "result");
    expect(dsl).toContain("[q]: custom prompt");
    expect(dsl).not.toContain("[q]: Respond");
  });

  it("generates a distinct UUID id on each call", () => {
    const ann = makeAnnotation({ annotation_type: "llm", body: "explain this", original: "<!--- llm | explain this --->" });
    const a = buildThreadDsl(ann, "x");
    const b = buildThreadDsl(ann, "x");
    const idA = a.match(/^<!---\[([0-9a-f-]+)\]/)?.[1];
    const idB = b.match(/^<!---\[([0-9a-f-]+)\]/)?.[1];
    expect(idA).toBeTruthy();
    expect(idB).toBeTruthy();
    expect(idA).not.toBe(idB);
  });

  it("inherits paragraph scope from source", () => {
    const ann = makeAnnotation({
      annotation_type: "llm",
      body: "explain this",
      scope: { kind: "paragraph", value: 1 },
      original: "<!--- llm \\p | explain this --->",
    });
    const dsl = buildThreadDsl(ann, "x");
    expect(dsl).toContain("\\p");
  });

  it("inherits document scope from source", () => {
    const ann = makeAnnotation({
      annotation_type: "llm",
      body: "explain this",
      scope: { kind: "document", value: 0 },
      original: "<!--- llm \\d | explain this --->",
    });
    const dsl = buildThreadDsl(ann, "x");
    expect(dsl).toContain("\\d");
  });

  it("omits scope for implicit sentence/1 scope", () => {
    const ann = makeAnnotation({
      annotation_type: "llm",
      body: "explain this",
      scope: { kind: "sentence", value: 1 },
      original: "<!--- llm | explain this --->",
    });
    const dsl = buildThreadDsl(ann, "x");
    expect(dsl).not.toMatch(/\\[spdfh]/);
  });

  it("is block form because the [q]: body contains newlines", () => {
    const ann = makeAnnotation({ annotation_type: "llm", body: "explain this", original: "<!--- llm | explain this --->" });
    const dsl = buildThreadDsl(ann, "response");
    expect(dsl).toContain("\n---\n");
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
