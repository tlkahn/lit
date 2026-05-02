import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import {
  annotationDataField,
  setAnnotationData,
  annotationDecorationProvider,
  annotationExtension,
} from "./annotationState";
import {
  annotationFoldField,
  toggleAnnotationFoldEffect,
  PillWidget,
  CalloutWidget,
} from "./annotationWidgets";
import { Annotation as AnnotationGrammar } from "../markdown/annotation";
import { Comment as CommentGrammar } from "../markdown/comment";
import type { Annotation } from "../../lib/ipc";
import { parseAnnotations } from "../../lib/ipc";

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
    char_end: 10,
    original: "%%!n | x%%",
    ...overrides,
  };
}

describe("annotationDataField", () => {
  it("initial state is empty array", () => {
    const state = EditorState.create({ extensions: [annotationDataField] });
    expect(state.field(annotationDataField)).toEqual([]);
  });

  it("setAnnotationData effect updates the field", () => {
    const state = EditorState.create({ extensions: [annotationDataField] });
    const annotations = [makeAnnotation()];
    const tr = state.update({ effects: setAnnotationData.of(annotations) });
    expect(tr.state.field(annotationDataField)).toEqual(annotations);
  });

  it("multiple dispatches: last value wins", () => {
    const state = EditorState.create({ extensions: [annotationDataField] });
    const first = [makeAnnotation({ body: "first" })];
    const second = [makeAnnotation({ body: "second" })];
    const tr1 = state.update({ effects: setAnnotationData.of(first) });
    const tr2 = tr1.state.update({ effects: setAnnotationData.of(second) });
    expect(tr2.state.field(annotationDataField)).toEqual(second);
  });

  it("field does not recompute on unrelated transactions", () => {
    const state = EditorState.create({
      doc: "hello",
      extensions: [annotationDataField],
    });
    const annotations = [makeAnnotation()];
    const tr1 = state.update({ effects: setAnnotationData.of(annotations) });
    const tr2 = tr1.state.update({ changes: { from: 5, insert: " world" } });
    expect(tr2.state.field(annotationDataField)).toBe(annotations);
  });
});

describe("annotationPlugin", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("calls parseAnnotations on creation", async () => {
    const state = EditorState.create({
      doc: "hello",
      extensions: [annotationExtension()],
    });
    const view = new EditorView({ state, parent: document.createElement("div") });

    await vi.advanceTimersByTimeAsync(0);

    expect(parseAnnotations).toHaveBeenCalledWith("hello");

    view.destroy();
  });

  it("debounces IPC on doc change", async () => {
    const testData = [makeAnnotation({ body: "result" })];
    vi.mocked(parseAnnotations).mockResolvedValue(testData);

    const state = EditorState.create({
      doc: "hello",
      extensions: [annotationExtension()],
    });
    const view = new EditorView({ state, parent: document.createElement("div") });

    await vi.advanceTimersByTimeAsync(0);

    vi.mocked(parseAnnotations).mockClear();
    vi.mocked(parseAnnotations).mockResolvedValue(testData);

    view.dispatch({ changes: { from: 5, insert: " world" } });
    await vi.advanceTimersByTimeAsync(100);

    view.dispatch({ changes: { from: 11, insert: "!" } });
    await vi.advanceTimersByTimeAsync(150);

    expect(parseAnnotations).toHaveBeenCalledTimes(1);
    expect(parseAnnotations).toHaveBeenCalledWith("hello world!");

    const data = view.state.field(annotationDataField);
    expect(data).toEqual(testData);

    view.destroy();
  });

  it("does NOT call IPC on selection-only change", async () => {
    const state = EditorState.create({
      doc: "hello world",
      extensions: [annotationExtension()],
    });
    const view = new EditorView({ state, parent: document.createElement("div") });

    await vi.advanceTimersByTimeAsync(0);

    const callCount = vi.mocked(parseAnnotations).mock.calls.length;

    view.dispatch({ selection: { anchor: 5 } });
    await vi.advanceTimersByTimeAsync(200);

    expect(vi.mocked(parseAnnotations).mock.calls.length).toBe(callCount);

    view.destroy();
  });

  it("discards stale IPC result when doc changed during flight", async () => {
    let resolveIPC: (v: Annotation[]) => void = () => {};
    vi.mocked(parseAnnotations).mockImplementation(
      () => new Promise((r) => { resolveIPC = r; }),
    );

    const state = EditorState.create({
      doc: "hello",
      extensions: [annotationExtension()],
    });
    const view = new EditorView({ state, parent: document.createElement("div") });

    await vi.advanceTimersByTimeAsync(0);

    view.dispatch({ changes: { from: 5, insert: " changed" } });

    resolveIPC([makeAnnotation({ body: "stale" })]);
    await vi.advanceTimersByTimeAsync(0);

    const data = view.state.field(annotationDataField);
    expect(data).toEqual([]);

    view.destroy();
  });

  it("dispatches setAnnotationData with IPC result", async () => {
    const testAnnotations = [
      makeAnnotation({ body: "parsed result", char_start: 0, char_end: 5 }),
    ];
    vi.mocked(parseAnnotations).mockResolvedValue(testAnnotations);

    const state = EditorState.create({
      doc: "hello",
      extensions: [annotationExtension()],
    });
    const view = new EditorView({ state, parent: document.createElement("div") });

    await vi.advanceTimersByTimeAsync(0);

    const data = view.state.field(annotationDataField);
    expect(data).toEqual(testAnnotations);

    view.destroy();
  });
});

describe("annotationDecorationProvider", () => {
  function makeAnnotationView(doc: string, cursorPos = 0) {
    const state = EditorState.create({
      doc,
      selection: { anchor: cursorPos },
      extensions: [
        markdown({ extensions: [CommentGrammar, AnnotationGrammar] }),
        annotationDataField,
        annotationDecorationProvider,
        annotationFoldField,
      ],
    });
    const view = new EditorView({ state, parent: document.createElement("div") });
    ensureSyntaxTree(view.state, view.state.doc.length);
    return view;
  }

  function collectDecorations(view: EditorView) {
    const decoSources = view.state.facet(EditorView.decorations);
    const result: { from: number; to: number; widget: unknown }[] = [];
    for (const source of decoSources) {
      if (typeof source === "function") continue;
      const iter = source.iter();
      while (iter.value) {
        result.push({
          from: iter.from,
          to: iter.to,
          widget: iter.value.spec?.widget ?? null,
        });
        iter.next();
      }
    }
    return result;
  }

  it("InlineAnnotation → PillWidget", () => {
    // "first line\n" = 11 chars, "text " = 5 chars
    // %%!n | body%% starts at 16, 13 chars → ends at 29
    const doc = "first line\ntext %%!n | body%% more";
    const view = makeAnnotationView(doc, 0);

    const ann = makeAnnotation({
      char_start: 16,
      char_end: 29,
      original: "%%!n | body%%",
    });
    view.dispatch({ effects: setAnnotationData.of([ann]) });

    const decos = collectDecorations(view);
    const found = decos.find((d) => d.from === 16 && d.to === 29);
    expect(found).toBeTruthy();
    expect(found!.widget).toBeInstanceOf(PillWidget);

    view.destroy();
  });

  it("cursor on annotation line → no decoration", () => {
    const doc = "first line\ntext %%!n | body%% more";
    const view = makeAnnotationView(doc, 16);

    const ann = makeAnnotation({
      char_start: 16,
      char_end: 29,
      original: "%%!n | body%%",
    });
    view.dispatch({ effects: setAnnotationData.of([ann]) });

    const decos = collectDecorations(view);
    const found = decos.find((d) => d.from === 16 && d.to === 29);
    expect(found).toBeUndefined();

    view.destroy();
  });

  it("multi-line BlockAnnotation → CalloutWidget", () => {
    // Blank line needed so paragraph doesn't swallow the block annotation
    // BlockAnnotation at 12..23
    const doc = "first line\n\n%%!\nbody\n%%\nafter";
    const view = makeAnnotationView(doc, 24);

    const ann = makeAnnotation({
      form: "block",
      char_start: 12,
      char_end: 23,
      original: "%%!\nbody\n%%",
    });
    view.dispatch({ effects: setAnnotationData.of([ann]) });

    const decos = collectDecorations(view);
    const found = decos.find((d) => d.from === 12 && d.to === 23);
    expect(found).toBeTruthy();
    expect(found!.widget).toBeInstanceOf(CalloutWidget);

    view.destroy();
  });

  it("single-line BlockAnnotation → PillWidget", () => {
    // "first line\n" = 11 chars
    // %%!content%% = 12 chars (11-22), end = 11+12 = 23
    // BlockAnnotation 11..23
    const doc = "first line\n%%!content%%";
    const view = makeAnnotationView(doc, 0);

    const ann = makeAnnotation({
      char_start: 11,
      char_end: 23,
      original: "%%!content%%",
    });
    view.dispatch({ effects: setAnnotationData.of([ann]) });

    const decos = collectDecorations(view);
    const found = decos.find((d) => d.from === 11 && d.to === 23);
    expect(found).toBeTruthy();
    expect(found!.widget).toBeInstanceOf(PillWidget);

    view.destroy();
  });

  it("fold state → CalloutWidget receives isCollapsed=true", () => {
    const doc = "first line\n\n%%!\nbody\n%%\nafter";
    const view = makeAnnotationView(doc, 24);

    const ann = makeAnnotation({
      form: "block",
      char_start: 12,
      char_end: 23,
      original: "%%!\nbody\n%%",
    });

    view.dispatch({ effects: setAnnotationData.of([ann]) });
    view.dispatch({ effects: toggleAnnotationFoldEffect.of({ pos: 12 }) });

    const decos = collectDecorations(view);
    const found = decos.find((d) => d.from === 12 && d.to === 23);
    expect(found).toBeTruthy();
    expect(found!.widget).toBeInstanceOf(CalloutWidget);
    expect((found!.widget as CalloutWidget).isCollapsed).toBe(true);

    view.destroy();
  });

  it("out-of-range annotation positions → no decoration", () => {
    const doc = "short text";
    const view = makeAnnotationView(doc, 0);

    const ann = makeAnnotation({ char_start: -1, char_end: 5 });
    view.dispatch({ effects: setAnnotationData.of([ann]) });

    const decos = collectDecorations(view);
    expect(decos).toHaveLength(0);

    view.destroy();
  });
});

describe("annotationExtension", () => {
  it("returns array with 6 extensions", () => {
    const ext = annotationExtension();
    expect(Array.isArray(ext)).toBe(true);
    expect((ext as unknown[]).length).toBe(6);
  });

  it("includes annotationDataField", () => {
    const ext = annotationExtension() as unknown[];
    expect(ext).toContain(annotationDataField);
  });

  it("includes annotationFoldField", () => {
    const ext = annotationExtension() as unknown[];
    expect(ext).toContain(annotationFoldField);
  });
});
