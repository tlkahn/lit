import { describe, it, expect, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import type { Annotation } from "./ipc";
import { buildCompanionDsl, insertCompanionAnnotation } from "./companionInsert";

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
    char_end: 20,
    original: "%%!q | why? %%",
    ...overrides,
  };
}

describe("buildCompanionDsl", () => {
  it("returns a note annotation DSL wrapping the response", () => {
    const dsl = buildCompanionDsl("The answer is 42.");
    expect(dsl).toContain("n");
    expect(dsl).toContain("The answer is 42.");
    expect(dsl).toMatch(/^%%!/);
    expect(dsl).toMatch(/%%$/);
  });

  it("uses block form for multiline response", () => {
    const dsl = buildCompanionDsl("line1\nline2\nline3");
    expect(dsl).toContain("\n---\n");
    expect(dsl).toContain("line1\nline2\nline3");
  });
});

describe("insertCompanionAnnotation", () => {
  it("inserts companion DSL after source annotation char_end", () => {
    const doc = "hello %%!q | why? %% world";
    const view = new EditorView({
      state: EditorState.create({ doc }),
      parent: document.createElement("div"),
    });
    const ann = makeAnnotation({ char_start: 6, char_end: 20 });

    insertCompanionAnnotation(view, ann, "The answer.");

    const result = view.state.doc.toString();
    expect(result.slice(0, 20)).toBe("hello %%!q | why? %%");
    expect(result.slice(20, 22)).toBe("\n\n");
    expect(result.slice(22)).toContain("%%!");
    expect(result.slice(22)).toContain("The answer.");

    view.destroy();
  });

  it("source annotation text is unchanged after insertion", () => {
    const doc = "hello %%!q | why? %% world";
    const view = new EditorView({
      state: EditorState.create({ doc }),
      parent: document.createElement("div"),
    });
    const ann = makeAnnotation({ char_start: 6, char_end: 20 });

    insertCompanionAnnotation(view, ann, "answer");

    const result = view.state.doc.toString();
    expect(result.slice(6, 20)).toBe("%%!q | why? %%");

    view.destroy();
  });
});
