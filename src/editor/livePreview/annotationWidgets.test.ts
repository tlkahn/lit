import { describe, it, expect, vi, beforeEach } from "vitest";
import { EditorState } from "@codemirror/state";
import { PillWidget, CalloutWidget, toggleAnnotationFoldEffect, annotationFoldField } from "./annotationWidgets";

vi.mock("../../lib/ipc", () => ({
  parseAnnotations: vi.fn(async () => []),
}));

vi.mock("./annotationCache", () => {
  const cache = new Map<string, unknown>();
  return {
    getAnnotationCached: vi.fn((key: string) => cache.get(key)),
    parseAnnotationAsync: vi.fn(async (key: string) => {
      const result = [
        {
          form: "compact",
          annotation_type: "note",
          certainty: "tentative",
          scope: { kind: "words", value: 0 },
          body: "test body for annotation",
          date: "2026-04",
          is_structured: true,
          char_start: 0,
          char_end: 20,
          original: key,
        },
      ];
      cache.set(key, result);
      return result;
    }),
    clearAnnotationCache: vi.fn(() => cache.clear()),
    __setCache: (key: string, val: unknown) => cache.set(key, val),
  };
});

const { __setCache } = await import("./annotationCache") as unknown as { __setCache: (k: string, v: unknown) => void };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("PillWidget", () => {
  it("toDOM returns span.cm-annotation-pill", () => {
    __setCache("%%!n | body%%", [
      {
        form: "compact",
        annotation_type: "note",
        certainty: "neutral",
        scope: { kind: "words", value: 0 },
        body: "body",
        date: null,
        is_structured: true,
        char_start: 0,
        char_end: 13,
        original: "%%!n | body%%",
      },
    ]);
    const w = new PillWidget("%%!n | body%%", "%%!n | body%%", 0, 13);
    const dom = w.toDOM();
    expect(dom.tagName).toBe("SPAN");
    expect(dom.classList.contains("cm-annotation-pill")).toBe(true);
  });

  it("renders type icon, body, and date when cached", () => {
    __setCache("%%!n | hello @2026-04%%", [
      {
        form: "compact",
        annotation_type: "note",
        certainty: "firm",
        scope: { kind: "words", value: 0 },
        body: "hello",
        date: "2026-04",
        is_structured: true,
        char_start: 0,
        char_end: 22,
        original: "%%!n | hello @2026-04%%",
      },
    ]);
    const w = new PillWidget("%%!n | hello @2026-04%%", "%%!n | hello @2026-04%%", 0, 22);
    const dom = w.toDOM();
    expect(dom.querySelector(".cm-annotation-pill-icon")!.textContent).toBe("N");
    expect(dom.querySelector(".cm-annotation-pill-body")!.textContent).toBe("hello");
    expect(dom.querySelector(".cm-annotation-date")!.textContent).toBe("2026-04");
    expect(dom.classList.contains("cm-annotation-firm")).toBe(true);
  });

  it("shows placeholder on cache miss", () => {
    const w = new PillWidget("%%!n | uncached%%", "%%!n | uncached%%", 0, 17);
    const dom = w.toDOM();
    expect(dom.classList.contains("cm-annotation-loading")).toBe(true);
    expect(dom.textContent).toBe("…");
  });

  it("adds tentative class for tentative certainty", () => {
    __setCache("%%!n? | maybe%%", [
      {
        form: "compact",
        annotation_type: "note",
        certainty: "tentative",
        scope: { kind: "words", value: 0 },
        body: "maybe",
        date: null,
        is_structured: true,
        char_start: 0,
        char_end: 15,
        original: "%%!n? | maybe%%",
      },
    ]);
    const w = new PillWidget("%%!n? | maybe%%", "%%!n? | maybe%%", 0, 15);
    const dom = w.toDOM();
    expect(dom.classList.contains("cm-annotation-tentative")).toBe(true);
  });

  it("truncates body longer than 60 chars", () => {
    const longBody = "a".repeat(80);
    __setCache("%%!n | long%%", [
      {
        form: "compact",
        annotation_type: "note",
        certainty: "neutral",
        scope: { kind: "words", value: 0 },
        body: longBody,
        date: null,
        is_structured: true,
        char_start: 0,
        char_end: 13,
        original: "%%!n | long%%",
      },
    ]);
    const w = new PillWidget("%%!n | long%%", "%%!n | long%%", 0, 13);
    const dom = w.toDOM();
    const bodyText = dom.querySelector(".cm-annotation-pill-body")!.textContent!;
    expect(bodyText.length).toBe(61);
    expect(bodyText.endsWith("…")).toBe(true);
  });

  it("eq returns true when original + charStart + charEnd match", () => {
    const a = new PillWidget("x", "%%!n%%", 0, 6);
    const b = new PillWidget("y", "%%!n%%", 0, 6);
    expect(a.eq(b)).toBe(true);
  });

  it("eq returns false when different", () => {
    const a = new PillWidget("x", "%%!n%%", 0, 6);
    const b = new PillWidget("x", "%%!q%%", 0, 6);
    expect(a.eq(b)).toBe(false);
  });

  it("estimatedHeight returns a value", () => {
    const w = new PillWidget("x", "x", 0, 1);
    expect(w.estimatedHeight).toBeGreaterThan(0);
  });

  it("ignoreEvent returns false", () => {
    const w = new PillWidget("x", "x", 0, 1);
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
    __setCache("%%!\nn!\n---\nbody\n%%", [
      {
        form: "block",
        annotation_type: "note",
        certainty: "neutral",
        scope: { kind: "words", value: 0 },
        body: "body",
        date: null,
        is_structured: true,
        char_start: 0,
        char_end: 18,
        original: "%%!\nn!\n---\nbody\n%%",
      },
    ]);
    const w = new CalloutWidget("%%!\nn!\n---\nbody\n%%", "%%!\nn!\n---\nbody\n%%", 0, 18, false, 0);
    const dom = w.toDOM(null as unknown as import("@codemirror/view").EditorView);
    expect(dom.tagName).toBe("DIV");
    expect(dom.classList.contains("cm-annotation-callout")).toBe(true);
  });

  it("renders header with type label and fold toggle", () => {
    __setCache("block", [
      {
        form: "block",
        annotation_type: "question",
        certainty: "firm",
        scope: { kind: "words", value: 0 },
        body: "some question",
        date: "2026-05",
        is_structured: true,
        char_start: 0,
        char_end: 5,
        original: "block",
      },
    ]);
    const w = new CalloutWidget("block", "block", 0, 5, false, 0);
    const dom = w.toDOM(null as unknown as import("@codemirror/view").EditorView);
    const header = dom.querySelector(".cm-annotation-callout-header")!;
    expect(header.querySelector(".cm-annotation-callout-label")!.textContent).toBe("question");
    expect(header.querySelector(".cm-annotation-date")!.textContent).toBe("2026-05");
    expect(header.querySelector(".cm-annotation-fold-icon")).toBeTruthy();
  });

  it("hides body when collapsed", () => {
    __setCache("coll", [
      {
        form: "block",
        annotation_type: "note",
        certainty: "neutral",
        scope: { kind: "words", value: 0 },
        body: "hidden body",
        date: null,
        is_structured: true,
        char_start: 0,
        char_end: 4,
        original: "coll",
      },
    ]);
    const w = new CalloutWidget("coll", "coll", 0, 4, true, 0);
    const dom = w.toDOM(null as unknown as import("@codemirror/view").EditorView);
    expect(dom.querySelector(".cm-annotation-callout-body")).toBeNull();
  });

  it("estimatedHeight differs by collapse state", () => {
    const expanded = new CalloutWidget("x", "x", 0, 1, false, 0);
    const collapsed = new CalloutWidget("x", "x", 0, 1, true, 0);
    expect(expanded.estimatedHeight).toBeGreaterThan(collapsed.estimatedHeight);
  });
});
