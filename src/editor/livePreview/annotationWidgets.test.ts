import { describe, it, expect, vi, beforeEach } from "vitest";
import { EditorState } from "@codemirror/state";
import { PillWidget, CalloutWidget, toggleAnnotationFoldEffect, annotationFoldField } from "./annotationWidgets";
import type { Annotation } from "../../lib/ipc";

vi.mock("../../lib/ipc", () => ({
  parseAnnotations: vi.fn(async () => []),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

function makeAnnotation(overrides: Partial<Annotation> = {}): Annotation {
  return {
    form: "compact",
    annotation_type: "note",
    certainty: "neutral",
    scope: { kind: "words", value: 0 },
    body: "test body",
    date: null,
    is_structured: true,
    char_start: 0,
    char_end: 13,
    original: "%%!n | body%%",
    ...overrides,
  };
}

describe("PillWidget", () => {
  it("toDOM returns span.cm-annotation-pill", () => {
    const w = new PillWidget(makeAnnotation({ body: "body" }));
    const dom = w.toDOM();
    expect(dom.tagName).toBe("SPAN");
    expect(dom.classList.contains("cm-annotation-pill")).toBe(true);
  });

  it("renders type icon, body, and date", () => {
    const ann = makeAnnotation({
      annotation_type: "note",
      certainty: "firm",
      body: "hello",
      date: "2026-04",
      char_start: 0,
      char_end: 22,
      original: "%%!n | hello @2026-04%%",
    });
    const w = new PillWidget(ann);
    const dom = w.toDOM();
    expect(dom.querySelector(".cm-annotation-pill-icon")!.textContent).toBe("N");
    expect(dom.querySelector(".cm-annotation-pill-body")!.textContent).toBe("hello");
    expect(dom.querySelector(".cm-annotation-date")!.textContent).toBe("2026-04");
    expect(dom.classList.contains("cm-annotation-firm")).toBe(true);
  });

  it("adds tentative class for tentative certainty", () => {
    const w = new PillWidget(makeAnnotation({ certainty: "tentative", body: "maybe" }));
    const dom = w.toDOM();
    expect(dom.classList.contains("cm-annotation-tentative")).toBe(true);
  });

  it("truncates body longer than 60 chars", () => {
    const longBody = "a".repeat(80);
    const w = new PillWidget(makeAnnotation({ body: longBody }));
    const dom = w.toDOM();
    const bodyText = dom.querySelector(".cm-annotation-pill-body")!.textContent!;
    expect(bodyText.length).toBe(61);
    expect(bodyText.endsWith("…")).toBe(true);
  });

  it("eq returns true when original + charStart + charEnd match", () => {
    const a = new PillWidget(makeAnnotation({ original: "%%!n%%", char_start: 0, char_end: 6 }));
    const b = new PillWidget(makeAnnotation({ original: "%%!n%%", char_start: 0, char_end: 6, body: "different" }));
    expect(a.eq(b)).toBe(true);
  });

  it("eq returns false when different", () => {
    const a = new PillWidget(makeAnnotation({ original: "%%!n%%", char_start: 0, char_end: 6 }));
    const b = new PillWidget(makeAnnotation({ original: "%%!q%%", char_start: 0, char_end: 6 }));
    expect(a.eq(b)).toBe(false);
  });

  it("estimatedHeight returns a value", () => {
    const w = new PillWidget(makeAnnotation());
    expect(w.estimatedHeight).toBeGreaterThan(0);
  });

  it("ignoreEvent returns false", () => {
    const w = new PillWidget(makeAnnotation());
    expect(w.ignoreEvent()).toBe(false);
  });
});

describe("annotationFoldField", () => {
  it("initial state is an empty Map", () => {
    const state = EditorState.create({ extensions: [annotationFoldField] });
    const fold = state.field(annotationFoldField);
    expect(fold.size).toBe(0);
  });

  it("toggleAnnotationFoldEffect toggles fold state", () => {
    const state = EditorState.create({ doc: "hello", extensions: [annotationFoldField] });
    const tr1 = state.update({ effects: toggleAnnotationFoldEffect.of({ pos: 0 }) });
    const fold1 = tr1.state.field(annotationFoldField);
    expect(fold1.get(0)).toBe(true);

    const tr2 = tr1.state.update({ effects: toggleAnnotationFoldEffect.of({ pos: 0 }) });
    const fold2 = tr2.state.field(annotationFoldField);
    expect(fold2.get(0)).toBe(false);
  });
});

describe("CalloutWidget", () => {
  it("toDOM returns div.cm-annotation-callout", () => {
    const ann = makeAnnotation({
      form: "block",
      body: "body",
      char_start: 0,
      char_end: 18,
      original: "%%!\nn!\n---\nbody\n%%",
    });
    const w = new CalloutWidget(ann, false, 0);
    const dom = w.toDOM(null as unknown as import("@codemirror/view").EditorView);
    expect(dom.tagName).toBe("DIV");
    expect(dom.classList.contains("cm-annotation-callout")).toBe(true);
  });

  it("renders header with type label and fold toggle", () => {
    const ann = makeAnnotation({
      form: "block",
      annotation_type: "question",
      certainty: "firm",
      body: "some question",
      date: "2026-05",
      char_start: 0,
      char_end: 5,
      original: "block",
    });
    const w = new CalloutWidget(ann, false, 0);
    const dom = w.toDOM(null as unknown as import("@codemirror/view").EditorView);
    const header = dom.querySelector(".cm-annotation-callout-header")!;
    expect(header.querySelector(".cm-annotation-callout-label")!.textContent).toBe("question");
    expect(header.querySelector(".cm-annotation-date")!.textContent).toBe("2026-05");
    expect(header.querySelector(".cm-annotation-fold-icon")).toBeTruthy();
  });

  it("hides body when collapsed", () => {
    const ann = makeAnnotation({
      form: "block",
      body: "hidden body",
      char_start: 0,
      char_end: 4,
      original: "coll",
    });
    const w = new CalloutWidget(ann, true, 0);
    const dom = w.toDOM(null as unknown as import("@codemirror/view").EditorView);
    expect(dom.querySelector(".cm-annotation-callout-body")).toBeNull();
  });

  it("estimatedHeight differs by collapse state", () => {
    const ann = makeAnnotation();
    const expanded = new CalloutWidget(ann, false, 0);
    const collapsed = new CalloutWidget(ann, true, 0);
    expect(expanded.estimatedHeight).toBeGreaterThan(collapsed.estimatedHeight);
  });
});
