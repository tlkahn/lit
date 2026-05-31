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
  displayModeField,
  setDisplayMode,
  findAnnotationAtCursor,
  deriveThreadKeys,
} from "./annotationState";
import {
  annotationFoldField,
  toggleAnnotationFoldEffect,
  PillWidget,
  CalloutWidget,
  MarkerWidget,
  llmLockedField,
  annotationThreadKeysField,
  setAnnotationThreadKeys,
} from "./annotationWidgets";
import { Annotation as AnnotationGrammar } from "../markdown/annotation";
import { Comment as CommentGrammar } from "../markdown/comment";
import type { Annotation, ConversationRow } from "../../lib/ipc";
import { parseAnnotations, annotationFindUuid, listAnnotations } from "../../lib/ipc";
import { type AnnotationDisplayMode } from "../../stores/preferences";
import { useModalLockStore } from "../../stores/modalLock";
import { useWorkspaceStore } from "../../stores/workspace";
import { useConversationStore } from "../../stores/conversation";
import { useBottomPanelStore } from "../../stores/bottomPanel";

vi.mock("../../lib/ipc", () => ({
  parseAnnotations: vi.fn(async () => []),
  annotationFindUuid: vi.fn(async () => null),
  listAnnotations: vi.fn(async () => []),
}));

const mockFindUuid = annotationFindUuid as ReturnType<typeof vi.fn>;
const mockListAnnotations = listAnnotations as ReturnType<typeof vi.fn>;

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

describe("displayModeField", () => {
  it("initial state is 'pill'", () => {
    const state = EditorState.create({ extensions: [displayModeField] });
    expect(state.field(displayModeField)).toBe("pill");
  });

  it("setDisplayMode.of('footnote') updates field", () => {
    const state = EditorState.create({ extensions: [displayModeField] });
    const tr = state.update({ effects: setDisplayMode.of("footnote") });
    expect(tr.state.field(displayModeField)).toBe("footnote");
  });

  it("round-trip back to 'pill'", () => {
    const state = EditorState.create({ extensions: [displayModeField] });
    const tr1 = state.update({ effects: setDisplayMode.of("footnote") });
    const tr2 = tr1.state.update({ effects: setDisplayMode.of("pill") });
    expect(tr2.state.field(displayModeField)).toBe("pill");
  });

  it("displayModeField uses AnnotationDisplayMode from preferences", () => {
    const state = EditorState.create({ extensions: [displayModeField] });
    const mode: AnnotationDisplayMode = state.field(displayModeField);
    expect(mode).toBe("pill");
  });

  it("unrelated transactions leave field unchanged", () => {
    const state = EditorState.create({ doc: "hello", extensions: [displayModeField] });
    const tr1 = state.update({ effects: setDisplayMode.of("footnote") });
    const tr2 = tr1.state.update({ changes: { from: 5, insert: " world" } });
    expect(tr2.state.field(displayModeField)).toBe("footnote");
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

  it("dispatches lit:annotations-changed window event after successful parse", async () => {
    const testAnnotations = [
      makeAnnotation({ body: "test", char_start: 0, char_end: 5 }),
    ];
    vi.mocked(parseAnnotations).mockResolvedValue(testAnnotations);

    const spy = vi.fn();
    window.addEventListener("lit:annotations-changed", spy);

    const state = EditorState.create({
      doc: "hello",
      extensions: [annotationExtension()],
    });
    const view = new EditorView({ state, parent: document.createElement("div") });

    await vi.advanceTimersByTimeAsync(0);

    expect(spy).toHaveBeenCalled();

    window.removeEventListener("lit:annotations-changed", spy);
    view.destroy();
  });

  it("does NOT fire lit:annotations-changed when both prev and new annotations are empty", async () => {
    vi.mocked(parseAnnotations).mockResolvedValue([]);

    const state = EditorState.create({
      doc: "hello",
      extensions: [annotationExtension()],
    });
    const view = new EditorView({ state, parent: document.createElement("div") });

    await vi.advanceTimersByTimeAsync(0);

    const spy = vi.fn();
    window.addEventListener("lit:annotations-changed", spy);

    view.dispatch({ changes: { from: 5, insert: " world" } });
    await vi.advanceTimersByTimeAsync(150);
    await vi.advanceTimersByTimeAsync(0);

    expect(spy).not.toHaveBeenCalled();

    window.removeEventListener("lit:annotations-changed", spy);
    view.destroy();
  });

  it("fires lit:annotations-changed when annotations appear (empty → non-empty)", async () => {
    vi.mocked(parseAnnotations).mockResolvedValue([]);

    const state = EditorState.create({
      doc: "hello",
      extensions: [annotationExtension()],
    });
    const view = new EditorView({ state, parent: document.createElement("div") });

    await vi.advanceTimersByTimeAsync(0);

    const spy = vi.fn();
    window.addEventListener("lit:annotations-changed", spy);

    vi.mocked(parseAnnotations).mockResolvedValue([makeAnnotation()]);

    view.dispatch({ changes: { from: 5, insert: " world" } });
    await vi.advanceTimersByTimeAsync(150);
    await vi.advanceTimersByTimeAsync(0);

    expect(spy).toHaveBeenCalledTimes(1);

    window.removeEventListener("lit:annotations-changed", spy);
    view.destroy();
  });

  it("fires lit:annotations-changed when annotations disappear (non-empty → empty)", async () => {
    vi.mocked(parseAnnotations).mockResolvedValue([makeAnnotation()]);

    const state = EditorState.create({
      doc: "hello",
      extensions: [annotationExtension()],
    });
    const view = new EditorView({ state, parent: document.createElement("div") });

    await vi.advanceTimersByTimeAsync(0);

    expect(view.state.field(annotationDataField)).toHaveLength(1);

    const spy = vi.fn();
    window.addEventListener("lit:annotations-changed", spy);

    vi.mocked(parseAnnotations).mockResolvedValue([]);

    view.dispatch({ changes: { from: 5, insert: " world" } });
    await vi.advanceTimersByTimeAsync(150);
    await vi.advanceTimersByTimeAsync(0);

    expect(spy).toHaveBeenCalledTimes(1);

    window.removeEventListener("lit:annotations-changed", spy);
    view.destroy();
  });

  it("does NOT dispatch setAnnotationData effect for empty → empty", async () => {
    vi.mocked(parseAnnotations).mockResolvedValue([]);

    const state = EditorState.create({
      doc: "hello",
      extensions: [annotationExtension()],
    });
    const view = new EditorView({ state, parent: document.createElement("div") });

    await vi.advanceTimersByTimeAsync(0);

    const fieldBefore = view.state.field(annotationDataField);

    view.dispatch({ changes: { from: 5, insert: " world" } });
    await vi.advanceTimersByTimeAsync(150);
    await vi.advanceTimersByTimeAsync(0);

    expect(view.state.field(annotationDataField)).toBe(fieldBefore);

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

  it("enriches parsed annotations with UUIDs from listAnnotations", async () => {
    const parsedAnn = makeAnnotation({ annotation_type: "note", char_start: 5, char_end: 15 });
    vi.mocked(parseAnnotations).mockResolvedValue([parsedAnn]);
    useWorkspaceStore.setState({ currentPagePath: "notes/test.md" });
    mockListAnnotations.mockResolvedValue([
      { annotation_id: 1, node_id: "notes/test.md", node_title: "test", annotation_type: "note", certainty: "neutral", body: null, date: null, source_line: 1, char_start: 5, char_end: 15, uuid: "enriched-uuid-1" },
    ]);

    const state = EditorState.create({
      doc: "hello world!!!",
      extensions: [annotationExtension()],
    });
    const view = new EditorView({ state, parent: document.createElement("div") });

    await vi.advanceTimersByTimeAsync(0);

    const data = view.state.field(annotationDataField);
    view.destroy();

    expect(data).toHaveLength(1);
    expect(data[0]!.uuid).toBe("enriched-uuid-1");
  });

  it("does not call listAnnotations when currentPagePath is null", async () => {
    const parsedAnn = makeAnnotation({ annotation_type: "note", char_start: 0, char_end: 10 });
    vi.mocked(parseAnnotations).mockResolvedValue([parsedAnn]);
    useWorkspaceStore.setState({ currentPagePath: null });

    const state = EditorState.create({
      doc: "hello world",
      extensions: [annotationExtension()],
    });
    const view = new EditorView({ state, parent: document.createElement("div") });

    await vi.advanceTimersByTimeAsync(0);

    expect(mockListAnnotations).not.toHaveBeenCalled();
    const data = view.state.field(annotationDataField);
    expect(data).toHaveLength(1);
    expect(data[0]!.uuid).toBeUndefined();

    view.destroy();
  });

  it("dispatches annotations without uuid when listAnnotations rejects", async () => {
    const parsedAnn = makeAnnotation({ annotation_type: "note", char_start: 0, char_end: 10 });
    vi.mocked(parseAnnotations).mockResolvedValue([parsedAnn]);
    useWorkspaceStore.setState({ currentPagePath: "notes/test.md" });
    mockListAnnotations.mockRejectedValue(new Error("db error"));

    const state = EditorState.create({
      doc: "hello world",
      extensions: [annotationExtension()],
    });
    const view = new EditorView({ state, parent: document.createElement("div") });

    await vi.advanceTimersByTimeAsync(0);

    const data = view.state.field(annotationDataField);
    expect(data).toHaveLength(1);
    expect(data[0]!.uuid).toBeUndefined();

    view.destroy();
  });

  it("discards stale enrichment when doc changes during listAnnotations", async () => {
    const parsedAnn = makeAnnotation({ annotation_type: "note", char_start: 0, char_end: 5 });
    vi.mocked(parseAnnotations).mockResolvedValue([parsedAnn]);
    useWorkspaceStore.setState({ currentPagePath: "notes/test.md" });

    let resolveList!: (v: unknown[]) => void;
    mockListAnnotations.mockImplementation(
      () => new Promise((r) => { resolveList = r; }),
    );

    const state = EditorState.create({
      doc: "hello",
      extensions: [annotationExtension()],
    });
    const view = new EditorView({ state, parent: document.createElement("div") });

    await vi.advanceTimersByTimeAsync(0);

    view.dispatch({ changes: { from: 5, insert: " changed" } });

    resolveList([
      { annotation_id: 1, node_id: "notes/test.md", node_title: "test", annotation_type: "note", certainty: "neutral", body: null, date: null, source_line: 1, char_start: 0, char_end: 5, uuid: "stale-uuid" },
    ]);
    await vi.advanceTimersByTimeAsync(0);

    const data = view.state.field(annotationDataField);
    const hasStaleUuid = data.some((a) => a.uuid === "stale-uuid");
    expect(hasStaleUuid).toBe(false);

    view.destroy();
  });

  it("integration: enriched uuid enables thread indicator on PillWidget", async () => {
    const doc = "first line\ntext %%!n | body%% more";
    const parsedAnn = makeAnnotation({
      annotation_type: "note",
      body: "body",
      char_start: 16,
      char_end: 29,
      original: "%%!n | body%%",
    });
    vi.mocked(parseAnnotations).mockResolvedValue([parsedAnn]);
    useWorkspaceStore.setState({ currentPagePath: "notes/test.md" });
    mockListAnnotations.mockResolvedValue([
      { annotation_id: 1, node_id: "notes/test.md", node_title: "test", annotation_type: "note", certainty: "neutral", body: "body", date: null, source_line: 2, char_start: 16, char_end: 29, uuid: "enriched-thread-uuid" },
    ]);
    useConversationStore.setState({
      conversations: [
        makeConversationRow({ anchor_type: "annotation", anchor_key: "enriched-thread-uuid" }),
      ],
    });

    const state = EditorState.create({
      doc,
      selection: { anchor: 0 },
      extensions: [
        markdown({ extensions: [CommentGrammar, AnnotationGrammar] }),
        annotationExtension(),
      ],
    });
    const view = new EditorView({ state, parent: document.createElement("div") });
    ensureSyntaxTree(view.state, view.state.doc.length);

    await vi.advanceTimersByTimeAsync(0);

    const decoSources = view.state.facet(EditorView.decorations);
    const widgets: { from: number; to: number; widget: unknown }[] = [];
    for (const source of decoSources) {
      if (typeof source === "function") continue;
      const iter = source.iter();
      while (iter.value) {
        widgets.push({ from: iter.from, to: iter.to, widget: iter.value.spec?.widget ?? null });
        iter.next();
      }
    }

    const pill = widgets.find((w) => w.from === 16 && w.to === 29);
    expect(pill).toBeTruthy();
    expect(pill!.widget).toBeInstanceOf(PillWidget);
    expect((pill!.widget as PillWidget).hasThread).toBe(true);

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
        displayModeField,
        annotationDecorationProvider,
        annotationFoldField,
        annotationThreadKeysField,
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

  it("InlineAnnotation + mode 'footnote' → MarkerWidget", () => {
    const doc = "first line\ntext %%!n | body%% more";
    const state = EditorState.create({
      doc,
      selection: { anchor: 0 },
      extensions: [
        markdown({ extensions: [CommentGrammar, AnnotationGrammar] }),
        annotationDataField,
        displayModeField,
        annotationDecorationProvider,
        annotationFoldField,
      ],
    });
    const view = new EditorView({ state, parent: document.createElement("div") });
    ensureSyntaxTree(view.state, view.state.doc.length);

    view.dispatch({ effects: setDisplayMode.of("footnote") });

    const ann = makeAnnotation({ char_start: 16, char_end: 29, original: "%%!n | body%%" });
    view.dispatch({ effects: setAnnotationData.of([ann]) });

    const decos = collectDecorations(view);
    const found = decos.find((d) => d.from === 16 && d.to === 29);
    expect(found).toBeTruthy();
    expect(found!.widget).toBeInstanceOf(MarkerWidget);

    view.destroy();
  });

  it("InlineAnnotation + mode 'pill' → PillWidget", () => {
    const doc = "first line\ntext %%!n | body%% more";
    const state = EditorState.create({
      doc,
      selection: { anchor: 0 },
      extensions: [
        markdown({ extensions: [CommentGrammar, AnnotationGrammar] }),
        annotationDataField,
        displayModeField,
        annotationDecorationProvider,
        annotationFoldField,
      ],
    });
    const view = new EditorView({ state, parent: document.createElement("div") });
    ensureSyntaxTree(view.state, view.state.doc.length);

    view.dispatch({ effects: setDisplayMode.of("pill") });

    const ann = makeAnnotation({ char_start: 16, char_end: 29, original: "%%!n | body%%" });
    view.dispatch({ effects: setAnnotationData.of([ann]) });

    const decos = collectDecorations(view);
    const found = decos.find((d) => d.from === 16 && d.to === 29);
    expect(found).toBeTruthy();
    expect(found!.widget).toBeInstanceOf(PillWidget);

    view.destroy();
  });

  it("multi-line BlockAnnotation + mode 'footnote' → CalloutWidget (unchanged)", () => {
    const doc = "first line\n\n%%!\nbody\n%%\nafter";
    const state = EditorState.create({
      doc,
      selection: { anchor: 24 },
      extensions: [
        markdown({ extensions: [CommentGrammar, AnnotationGrammar] }),
        annotationDataField,
        displayModeField,
        annotationDecorationProvider,
        annotationFoldField,
      ],
    });
    const view = new EditorView({ state, parent: document.createElement("div") });
    ensureSyntaxTree(view.state, view.state.doc.length);

    view.dispatch({ effects: setDisplayMode.of("footnote") });

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

  it("out-of-range annotation positions → no decoration", () => {
    const doc = "short text";
    const view = makeAnnotationView(doc, 0);

    const ann = makeAnnotation({ char_start: -1, char_end: 5 });
    view.dispatch({ effects: setAnnotationData.of([ann]) });

    const decos = collectDecorations(view);
    expect(decos).toHaveLength(0);

    view.destroy();
  });

  it("passes hasThread=true to PillWidget when annotation uuid matches thread key", () => {
    const doc = "first line\ntext %%!n | body%% more";
    const view = makeAnnotationView(doc, 0);

    const ann = makeAnnotation({ char_start: 16, char_end: 29, original: "%%!n | body%%", uuid: "uuid-1" });
    view.dispatch({ effects: setAnnotationData.of([ann]) });
    view.dispatch({ effects: setAnnotationThreadKeys.of(new Set(["uuid-1"])) });

    const decos = collectDecorations(view);
    const found = decos.find((d) => d.from === 16 && d.to === 29);
    expect(found).toBeTruthy();
    expect((found!.widget as PillWidget).hasThread).toBe(true);

    view.destroy();
  });

  it("passes hasThread=false when annotation uuid not in thread keys", () => {
    const doc = "first line\ntext %%!n | body%% more";
    const view = makeAnnotationView(doc, 0);

    const ann = makeAnnotation({ char_start: 16, char_end: 29, original: "%%!n | body%%", uuid: "uuid-other" });
    view.dispatch({ effects: setAnnotationData.of([ann]) });
    view.dispatch({ effects: setAnnotationThreadKeys.of(new Set(["uuid-1"])) });

    const decos = collectDecorations(view);
    const found = decos.find((d) => d.from === 16 && d.to === 29);
    expect(found).toBeTruthy();
    expect((found!.widget as PillWidget).hasThread).toBe(false);

    view.destroy();
  });

  it("passes hasThread=false when annotation uuid is null", () => {
    const doc = "first line\ntext %%!n | body%% more";
    const view = makeAnnotationView(doc, 0);

    const ann = makeAnnotation({ char_start: 16, char_end: 29, original: "%%!n | body%%", uuid: null });
    view.dispatch({ effects: setAnnotationData.of([ann]) });
    view.dispatch({ effects: setAnnotationThreadKeys.of(new Set(["uuid-1"])) });

    const decos = collectDecorations(view);
    const found = decos.find((d) => d.from === 16 && d.to === 29);
    expect(found).toBeTruthy();
    expect((found!.widget as PillWidget).hasThread).toBe(false);

    view.destroy();
  });

  it("passes hasThread=true to MarkerWidget in footnote mode", () => {
    const doc = "first line\ntext %%!n | body%% more";
    const state = EditorState.create({
      doc,
      selection: { anchor: 0 },
      extensions: [
        markdown({ extensions: [CommentGrammar, AnnotationGrammar] }),
        annotationDataField,
        displayModeField,
        annotationDecorationProvider,
        annotationFoldField,
        annotationThreadKeysField,
      ],
    });
    const view = new EditorView({ state, parent: document.createElement("div") });
    ensureSyntaxTree(view.state, view.state.doc.length);

    view.dispatch({ effects: setDisplayMode.of("footnote") });
    const ann = makeAnnotation({ char_start: 16, char_end: 29, original: "%%!n | body%%", uuid: "uuid-fn" });
    view.dispatch({ effects: setAnnotationData.of([ann]) });
    view.dispatch({ effects: setAnnotationThreadKeys.of(new Set(["uuid-fn"])) });

    const decos = collectDecorations(view);
    const found = decos.find((d) => d.from === 16 && d.to === 29);
    expect(found).toBeTruthy();
    expect(found!.widget).toBeInstanceOf(MarkerWidget);
    expect((found!.widget as MarkerWidget).hasThread).toBe(true);

    view.destroy();
  });

  it("passes hasThread=true to CalloutWidget for block annotation", () => {
    const doc = "first line\n\n%%!\nbody\n%%\nafter";
    const state = EditorState.create({
      doc,
      selection: { anchor: 24 },
      extensions: [
        markdown({ extensions: [CommentGrammar, AnnotationGrammar] }),
        annotationDataField,
        displayModeField,
        annotationDecorationProvider,
        annotationFoldField,
        annotationThreadKeysField,
      ],
    });
    const view = new EditorView({ state, parent: document.createElement("div") });
    ensureSyntaxTree(view.state, view.state.doc.length);

    const ann = makeAnnotation({ form: "block", char_start: 12, char_end: 23, original: "%%!\nbody\n%%", uuid: "uuid-block" });
    view.dispatch({ effects: setAnnotationData.of([ann]) });
    view.dispatch({ effects: setAnnotationThreadKeys.of(new Set(["uuid-block"])) });

    const decos = collectDecorations(view);
    const found = decos.find((d) => d.from === 12 && d.to === 23);
    expect(found).toBeTruthy();
    expect(found!.widget).toBeInstanceOf(CalloutWidget);
    expect((found!.widget as CalloutWidget).hasThread).toBe(true);

    view.destroy();
  });
});

describe("findAnnotationAtCursor", () => {
  it("returns the annotation containing pos", () => {
    const ann = makeAnnotation({ char_start: 5, char_end: 15 });
    expect(findAnnotationAtCursor([ann], 10)).toBe(ann);
  });

  it("returns annotation when pos === char_start", () => {
    const ann = makeAnnotation({ char_start: 5, char_end: 15 });
    expect(findAnnotationAtCursor([ann], 5)).toBe(ann);
  });

  it("returns undefined when pos === char_end (exclusive boundary)", () => {
    const ann = makeAnnotation({ char_start: 5, char_end: 15 });
    expect(findAnnotationAtCursor([ann], 15)).toBeUndefined();
  });

  it("returns annotation when pos === char_end - 1 (last inclusive position)", () => {
    const ann = makeAnnotation({ char_start: 5, char_end: 15 });
    expect(findAnnotationAtCursor([ann], 14)).toBe(ann);
  });

  it("returns undefined when pos is outside all annotations", () => {
    const ann = makeAnnotation({ char_start: 5, char_end: 15 });
    expect(findAnnotationAtCursor([ann], 3)).toBeUndefined();
    expect(findAnnotationAtCursor([ann], 15)).toBeUndefined();
  });

  it("returns undefined for empty annotations array", () => {
    expect(findAnnotationAtCursor([], 5)).toBeUndefined();
  });

  it("returns the first matching annotation when multiple overlap", () => {
    const a = makeAnnotation({ char_start: 0, char_end: 20 });
    const b = makeAnnotation({ char_start: 5, char_end: 15 });
    expect(findAnnotationAtCursor([a, b], 10)).toBe(a);
  });
});

describe("annotationExtension", () => {
  it("returns array with 15 extensions", () => {
    const ext = annotationExtension();
    expect(Array.isArray(ext)).toBe(true);
    expect((ext as unknown[]).length).toBe(15);
  });

  it("includes annotationDataField", () => {
    const ext = annotationExtension() as unknown[];
    expect(ext).toContain(annotationDataField);
  });

  it("includes annotationFoldField", () => {
    const ext = annotationExtension() as unknown[];
    expect(ext).toContain(annotationFoldField);
  });

  it("includes llmLockedField", () => {
    const ext = annotationExtension() as unknown[];
    expect(ext).toContain(llmLockedField);
  });

  it("includes annotationThreadKeysField", () => {
    const ext = annotationExtension() as unknown[];
    expect(ext).toContain(annotationThreadKeysField);
  });
});

describe("llmLockBridgePlugin", () => {
  beforeEach(() => {
    useModalLockStore.setState({ llmLocked: false });
  });

  it("does not dispatch synchronously in constructor when store is already locked", () => {
    useModalLockStore.setState({ llmLocked: true });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const view = new EditorView({
      state: EditorState.create({ doc: "x", extensions: [annotationExtension()] }),
      parent: document.createElement("div"),
    });
    expect(view.state.field(llmLockedField)).toBe(false);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
    view.destroy();
  });

  it("deferred dispatch sets llmLockedField after microtask when store is already locked", async () => {
    useModalLockStore.setState({ llmLocked: true });
    const view = new EditorView({
      state: EditorState.create({ doc: "x", extensions: [annotationExtension()] }),
      parent: document.createElement("div"),
    });
    expect(view.state.field(llmLockedField)).toBe(false);
    await new Promise<void>((r) => queueMicrotask(r));
    expect(view.state.field(llmLockedField)).toBe(true);
    view.destroy();
  });

  it("sets llmLockedField when store.llmLocked changes to true", () => {
    const view = new EditorView({
      state: EditorState.create({ doc: "x", extensions: [annotationExtension()] }),
      parent: document.createElement("div"),
    });
    useModalLockStore.getState().setLlmLocked(true);
    expect(view.state.field(llmLockedField)).toBe(true);
    view.destroy();
  });

  it("sets llmLockedField=false when store.llmLocked goes false", () => {
    const view = new EditorView({
      state: EditorState.create({ doc: "x", extensions: [annotationExtension()] }),
      parent: document.createElement("div"),
    });
    useModalLockStore.getState().setLlmLocked(true);
    expect(view.state.field(llmLockedField)).toBe(true);
    useModalLockStore.getState().setLlmLocked(false);
    expect(view.state.field(llmLockedField)).toBe(false);
    view.destroy();
  });

  it("unsubscribes on destroy (no throw)", () => {
    const view = new EditorView({
      state: EditorState.create({ doc: "x", extensions: [annotationExtension()] }),
      parent: document.createElement("div"),
    });
    view.destroy();
    expect(() => useModalLockStore.getState().setLlmLocked(true)).not.toThrow();
  });
});

describe("openAnnotationThreadPlugin", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({ currentPagePath: "notes/page.md" });
    mockFindUuid.mockResolvedValue("uuid-123");
    useConversationStore.setState({
      findOrCreateAnnotationThread: vi.fn(async () => "thread-id"),
    });
    useBottomPanelStore.setState({ activeTab: "linked", unfolded: false });
  });

  it("calls findOrCreateAnnotationThread on lit:open-annotation-thread", async () => {
    vi.useFakeTimers();
    const view = new EditorView({
      state: EditorState.create({ doc: "x", extensions: [annotationExtension()] }),
      parent: document.createElement("div"),
    });

    const ann = makeAnnotation({ annotation_type: "note", body: "test body", uuid: null });
    window.dispatchEvent(new CustomEvent("lit:open-annotation-thread", { detail: { annotation: ann } }));

    await vi.advanceTimersByTimeAsync(0);

    const findOrCreate = useConversationStore.getState().findOrCreateAnnotationThread;
    expect(findOrCreate).toHaveBeenCalledWith("notes/page.md", "uuid-123", "note: test body");

    view.destroy();
    vi.useRealTimers();
  });

  it("uses annotation.uuid directly when available", async () => {
    vi.useFakeTimers();
    const view = new EditorView({
      state: EditorState.create({ doc: "x", extensions: [annotationExtension()] }),
      parent: document.createElement("div"),
    });

    const ann = makeAnnotation({ annotation_type: "note", body: "test body", uuid: "uuid-direct" });
    window.dispatchEvent(new CustomEvent("lit:open-annotation-thread", { detail: { annotation: ann } }));

    await vi.advanceTimersByTimeAsync(0);

    expect(mockFindUuid).not.toHaveBeenCalled();
    const findOrCreate = useConversationStore.getState().findOrCreateAnnotationThread;
    expect(findOrCreate).toHaveBeenCalledWith("notes/page.md", "uuid-direct", "note: test body");

    view.destroy();
    vi.useRealTimers();
  });

  it("falls back to annotationFindUuid when uuid is null", async () => {
    vi.useFakeTimers();
    const view = new EditorView({
      state: EditorState.create({ doc: "x", extensions: [annotationExtension()] }),
      parent: document.createElement("div"),
    });

    const ann = makeAnnotation({ uuid: null });
    window.dispatchEvent(new CustomEvent("lit:open-annotation-thread", { detail: { annotation: ann } }));

    await vi.advanceTimersByTimeAsync(0);

    expect(mockFindUuid).toHaveBeenCalled();

    view.destroy();
    vi.useRealTimers();
  });

  it("opens bottom panel to llm-response", async () => {
    vi.useFakeTimers();
    const view = new EditorView({
      state: EditorState.create({ doc: "x", extensions: [annotationExtension()] }),
      parent: document.createElement("div"),
    });

    const ann = makeAnnotation({ uuid: "uuid-panel" });
    window.dispatchEvent(new CustomEvent("lit:open-annotation-thread", { detail: { annotation: ann } }));

    await vi.advanceTimersByTimeAsync(0);

    expect(useBottomPanelStore.getState().activeTab).toBe("llm-response");
    expect(useBottomPanelStore.getState().unfolded).toBe(true);

    view.destroy();
    vi.useRealTimers();
  });

  it("does nothing when currentPagePath is null", async () => {
    vi.useFakeTimers();
    useWorkspaceStore.setState({ currentPagePath: null });
    const view = new EditorView({
      state: EditorState.create({ doc: "x", extensions: [annotationExtension()] }),
      parent: document.createElement("div"),
    });

    const ann = makeAnnotation({ uuid: "uuid-noop" });
    window.dispatchEvent(new CustomEvent("lit:open-annotation-thread", { detail: { annotation: ann } }));

    await vi.advanceTimersByTimeAsync(0);

    expect(mockFindUuid).not.toHaveBeenCalled();
    const findOrCreate = useConversationStore.getState().findOrCreateAnnotationThread;
    expect(findOrCreate).not.toHaveBeenCalled();

    view.destroy();
    vi.useRealTimers();
  });

  it("does nothing when UUID not found", async () => {
    vi.useFakeTimers();
    mockFindUuid.mockResolvedValue(null);
    const view = new EditorView({
      state: EditorState.create({ doc: "x", extensions: [annotationExtension()] }),
      parent: document.createElement("div"),
    });

    const ann = makeAnnotation({ uuid: null });
    window.dispatchEvent(new CustomEvent("lit:open-annotation-thread", { detail: { annotation: ann } }));

    await vi.advanceTimersByTimeAsync(0);

    const findOrCreate = useConversationStore.getState().findOrCreateAnnotationThread;
    expect(findOrCreate).not.toHaveBeenCalled();

    view.destroy();
    vi.useRealTimers();
  });

  it("unsubscribes on destroy", async () => {
    vi.useFakeTimers();
    const view = new EditorView({
      state: EditorState.create({ doc: "x", extensions: [annotationExtension()] }),
      parent: document.createElement("div"),
    });
    view.destroy();

    const ann = makeAnnotation({ uuid: "uuid-dead" });
    window.dispatchEvent(new CustomEvent("lit:open-annotation-thread", { detail: { annotation: ann } }));

    await vi.advanceTimersByTimeAsync(0);

    const findOrCreate = useConversationStore.getState().findOrCreateAnnotationThread;
    expect(findOrCreate).not.toHaveBeenCalled();

    vi.useRealTimers();
  });

  it("derives title from annotation type and body", async () => {
    vi.useFakeTimers();
    const view = new EditorView({
      state: EditorState.create({ doc: "x", extensions: [annotationExtension()] }),
      parent: document.createElement("div"),
    });

    const ann = makeAnnotation({ annotation_type: "question", body: "What is X?", uuid: "uuid-title" });
    window.dispatchEvent(new CustomEvent("lit:open-annotation-thread", { detail: { annotation: ann } }));

    await vi.advanceTimersByTimeAsync(0);

    const findOrCreate = useConversationStore.getState().findOrCreateAnnotationThread;
    expect(findOrCreate).toHaveBeenCalledWith("notes/page.md", "uuid-title", "question: What is X?");

    view.destroy();
    vi.useRealTimers();
  });
});

// --- Conversation Thread Bridge Plugin ---

function makeConversationRow(overrides: Partial<ConversationRow> = {}): ConversationRow {
  return {
    id: "conv-" + Math.random().toString(36).slice(2, 8),
    node_id: "node-1",
    anchor_type: null,
    anchor_id: null,
    anchor_key: null,
    title: null,
    created_at: "2025-01-01T00:00:00Z",
    updated_at: "2025-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("conversationThreadBridgePlugin", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useConversationStore.setState({ conversations: [] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("hydrates thread keys from pre-loaded conversations on creation", async () => {
    useConversationStore.setState({
      conversations: [
        makeConversationRow({ anchor_type: "annotation", anchor_key: "uuid-a" }),
        makeConversationRow({ anchor_type: "annotation", anchor_key: "uuid-b" }),
      ],
    });

    const view = new EditorView({
      state: EditorState.create({ doc: "x", extensions: [annotationExtension()] }),
      parent: document.createElement("div"),
    });

    await vi.advanceTimersByTimeAsync(0);

    const keys = view.state.field(annotationThreadKeysField);
    expect(keys.has("uuid-a")).toBe(true);
    expect(keys.has("uuid-b")).toBe(true);
    expect(keys.size).toBe(2);

    view.destroy();
  });

  it("updates thread keys when store conversations change", async () => {
    const view = new EditorView({
      state: EditorState.create({ doc: "x", extensions: [annotationExtension()] }),
      parent: document.createElement("div"),
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(view.state.field(annotationThreadKeysField).size).toBe(0);

    useConversationStore.setState({
      conversations: [
        makeConversationRow({ anchor_type: "annotation", anchor_key: "uuid-new" }),
      ],
    });

    const keys = view.state.field(annotationThreadKeysField);
    expect(keys.has("uuid-new")).toBe(true);

    view.destroy();
  });

  it("does not dispatch when derived set is unchanged", async () => {
    useConversationStore.setState({
      conversations: [
        makeConversationRow({ anchor_type: "annotation", anchor_key: "uuid-stable" }),
      ],
    });

    const view = new EditorView({
      state: EditorState.create({ doc: "x", extensions: [annotationExtension()] }),
      parent: document.createElement("div"),
    });

    await vi.advanceTimersByTimeAsync(0);
    const keysBefore = view.state.field(annotationThreadKeysField);

    useConversationStore.setState({
      conversations: [
        makeConversationRow({ anchor_type: "annotation", anchor_key: "uuid-stable" }),
        makeConversationRow({ anchor_type: "general", anchor_key: null }),
      ],
    });

    const keysAfter = view.state.field(annotationThreadKeysField);
    expect(keysAfter).toBe(keysBefore);

    view.destroy();
  });

  it("removes keys when conversations shrink", async () => {
    useConversationStore.setState({
      conversations: [
        makeConversationRow({ anchor_type: "annotation", anchor_key: "uuid-gone" }),
      ],
    });

    const view = new EditorView({
      state: EditorState.create({ doc: "x", extensions: [annotationExtension()] }),
      parent: document.createElement("div"),
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(view.state.field(annotationThreadKeysField).has("uuid-gone")).toBe(true);

    useConversationStore.setState({ conversations: [] });

    expect(view.state.field(annotationThreadKeysField).size).toBe(0);

    view.destroy();
  });

  it("does not throw after destroy when store mutates", async () => {
    const view = new EditorView({
      state: EditorState.create({ doc: "x", extensions: [annotationExtension()] }),
      parent: document.createElement("div"),
    });

    await vi.advanceTimersByTimeAsync(0);
    view.destroy();

    expect(() => {
      useConversationStore.setState({
        conversations: [
          makeConversationRow({ anchor_type: "annotation", anchor_key: "uuid-after-destroy" }),
        ],
      });
    }).not.toThrow();
  });

  it("does NOT dispatch synchronously in constructor", () => {
    useConversationStore.setState({
      conversations: [
        makeConversationRow({ anchor_type: "annotation", anchor_key: "uuid-sync" }),
      ],
    });

    const view = new EditorView({
      state: EditorState.create({ doc: "x", extensions: [annotationExtension()] }),
      parent: document.createElement("div"),
    });

    expect(view.state.field(annotationThreadKeysField).size).toBe(0);

    view.destroy();
  });
});

describe("deriveThreadKeys", () => {
  it("extracts keys from annotation conversations", () => {
    const rows = [
      makeConversationRow({ anchor_type: "annotation", anchor_key: "uuid-1" }),
      makeConversationRow({ anchor_type: "annotation", anchor_key: "uuid-2" }),
    ];
    const keys = deriveThreadKeys(rows);
    expect(keys).toEqual(new Set(["uuid-1", "uuid-2"]));
  });

  it("excludes non-annotation conversations", () => {
    const rows = [
      makeConversationRow({ anchor_type: "general", anchor_key: "key-1" }),
      makeConversationRow({ anchor_type: "annotation", anchor_key: "uuid-only" }),
      makeConversationRow({ anchor_type: null, anchor_key: null }),
    ];
    const keys = deriveThreadKeys(rows);
    expect(keys).toEqual(new Set(["uuid-only"]));
  });

  it("excludes annotation conversations with null anchor_key", () => {
    const rows = [
      makeConversationRow({ anchor_type: "annotation", anchor_key: null }),
    ];
    const keys = deriveThreadKeys(rows);
    expect(keys.size).toBe(0);
  });

  it("returns empty set for empty array", () => {
    expect(deriveThreadKeys([]).size).toBe(0);
  });
});
