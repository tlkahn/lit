import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Compartment, EditorState } from "@codemirror/state";
import { EditorView, type DecorationSet } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { ensureSyntaxTree, syntaxTree, forceParsing } from "@codemirror/language";
import {
  annotationDataField,
  setAnnotationData,
  annotationDecorationPlugin,
  annotationBlockDecorationField,
  annotationExtension,
  displayModeField,
  setDisplayMode,
  findAnnotationAtCursor,
  buildAnnotationDecorations,
  hasAnnotationEffect,
  hasInlineAnnotationEffect,
  hasBlockAnnotationEffect,
  shouldRebuildBlocksOnTreeChange,
  buildAnnotationRangeMap,
  findAnnotationForRange,
} from "./annotationState";
import {
  annotationFoldField,
  toggleAnnotationFoldEffect,
  setAllAnnotationFoldsEffect,
  PillWidget,
  CalloutWidget,
  MarkerWidget,
  ThreadWidget,
  threadTurnField,
  setThreadTurnEffect,
  llmLockedField,
  firingAnnotationsField,
  setFiringAnnotation,
  clearFiringAnnotation,
  setLlmLockedEffect,
} from "./annotationWidgets";
import { Annotation as AnnotationGrammar } from "../markdown/annotation";
import { Comment as CommentGrammar } from "../markdown/comment";
import type { Annotation } from "../../lib/ipc";
import { parseAnnotations, listAnnotations } from "../../lib/ipc";
import { type AnnotationDisplayMode } from "../../stores/preferences";
import { useModalLockStore } from "../../stores/modalLock";
import { useWorkspaceStore } from "../../stores/workspace";

vi.mock("../../lib/ipc", () => ({
  parseAnnotations: vi.fn(async () => []),
  listAnnotations: vi.fn(async () => []),
}));

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
    original: "<!---n | x--->",
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

  it("enriches parsed annotations with UUIDs from listAnnotations using fuzzy matching", async () => {
    const parsedAnn = makeAnnotation({ annotation_type: "note", body: "hello", char_start: 5, char_end: 15 });
    vi.mocked(parseAnnotations).mockResolvedValue([parsedAnn]);
    useWorkspaceStore.setState({ currentPagePath: "notes/test.md" });
    mockListAnnotations.mockResolvedValue([
      { annotation_id: 1, node_id: "notes/test.md", node_title: "test", annotation_type: "note", certainty: "neutral", body: "hello", date: null, source_line: 1, char_start: 5, char_end: 15, uuid: "enriched-uuid-1" },
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

  it("enriches correct UUIDs when two annotations share type but differ in body", async () => {
    const parsedAnn1 = makeAnnotation({ annotation_type: "note", body: "first", char_start: 5, char_end: 15 });
    const parsedAnn2 = makeAnnotation({ annotation_type: "note", body: "second", char_start: 5, char_end: 25 });
    vi.mocked(parseAnnotations).mockResolvedValue([parsedAnn1, parsedAnn2]);
    useWorkspaceStore.setState({ currentPagePath: "notes/test.md" });
    mockListAnnotations.mockResolvedValue([
      { annotation_id: 1, node_id: "notes/test.md", node_title: "test", annotation_type: "note", certainty: "neutral", body: "first", date: null, source_line: 1, char_start: 5, char_end: 15, uuid: "uuid-first" },
      { annotation_id: 2, node_id: "notes/test.md", node_title: "test", annotation_type: "note", certainty: "neutral", body: "second", date: null, source_line: 1, char_start: 5, char_end: 25, uuid: "uuid-second" },
    ]);

    const state = EditorState.create({
      doc: "hello world!!! more text here",
      extensions: [annotationExtension()],
    });
    const view = new EditorView({ state, parent: document.createElement("div") });

    await vi.advanceTimersByTimeAsync(0);

    const data = view.state.field(annotationDataField);
    view.destroy();

    expect(data).toHaveLength(2);
    const first = data.find((a) => a.body === "first");
    const second = data.find((a) => a.body === "second");
    expect(first!.uuid).toBe("uuid-first");
    expect(second!.uuid).toBe("uuid-second");
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
      { annotation_id: 1, node_id: "notes/test.md", node_title: "test", annotation_type: "note", certainty: "neutral", body: "test body", date: null, source_line: 1, char_start: 0, char_end: 5, uuid: "stale-uuid" },
    ]);
    await vi.advanceTimersByTimeAsync(0);

    const data = view.state.field(annotationDataField);
    const hasStaleUuid = data.some((a) => a.uuid === "stale-uuid");
    expect(hasStaleUuid).toBe(false);

    view.destroy();
  });

  it("enriches annotations after positions shift from document edits (fuzzy matching)", async () => {
    // Simulate: parsed annotations have shifted positions compared to DB
    // (e.g. user typed text before the annotation, shifting it right by 10 chars)
    const parsedAnn = makeAnnotation({ annotation_type: "note", body: "important", char_start: 15, char_end: 30 });
    vi.mocked(parseAnnotations).mockResolvedValue([parsedAnn]);
    useWorkspaceStore.setState({ currentPagePath: "notes/test.md" });
    // DB still has the old positions (before the edit shifted things)
    mockListAnnotations.mockResolvedValue([
      { annotation_id: 1, node_id: "notes/test.md", node_title: "test", annotation_type: "note", certainty: "neutral", body: "important", date: null, source_line: 1, char_start: 5, char_end: 20, uuid: "uuid-shifted" },
    ]);

    const state = EditorState.create({
      doc: "some padded text with annotation here",
      extensions: [annotationExtension()],
    });
    const view = new EditorView({ state, parent: document.createElement("div") });

    await vi.advanceTimersByTimeAsync(0);

    const data = view.state.field(annotationDataField);
    view.destroy();

    expect(data).toHaveLength(1);
    // Fuzzy matching by type+body should still find the UUID despite position mismatch
    expect(data[0]!.uuid).toBe("uuid-shifted");
  });

  it("fuzzy matching picks closest candidate by proximity when type+body matches multiple", async () => {
    // Two annotations with same type and body but at different positions
    const parsedAnn1 = makeAnnotation({ annotation_type: "note", body: "dup", char_start: 10, char_end: 20 });
    const parsedAnn2 = makeAnnotation({ annotation_type: "note", body: "dup", char_start: 50, char_end: 60 });
    vi.mocked(parseAnnotations).mockResolvedValue([parsedAnn1, parsedAnn2]);
    useWorkspaceStore.setState({ currentPagePath: "notes/test.md" });
    mockListAnnotations.mockResolvedValue([
      { annotation_id: 1, node_id: "notes/test.md", node_title: "test", annotation_type: "note", certainty: "neutral", body: "dup", date: null, source_line: 1, char_start: 12, char_end: 22, uuid: "uuid-near-10" },
      { annotation_id: 2, node_id: "notes/test.md", node_title: "test", annotation_type: "note", certainty: "neutral", body: "dup", date: null, source_line: 3, char_start: 48, char_end: 58, uuid: "uuid-near-50" },
    ]);

    const state = EditorState.create({
      doc: "x".repeat(70),
      extensions: [annotationExtension()],
    });
    const view = new EditorView({ state, parent: document.createElement("div") });

    await vi.advanceTimersByTimeAsync(0);

    const data = view.state.field(annotationDataField);
    view.destroy();

    expect(data).toHaveLength(2);
    // Each parsed annotation should match the indexed one closest to it
    expect(data[0]!.uuid).toBe("uuid-near-10");
    expect(data[1]!.uuid).toBe("uuid-near-50");
  });

  it("does NOT call listAnnotations when annotation fingerprint is unchanged", async () => {
    const ann = makeAnnotation({ annotation_type: "note", body: "stable", char_start: 0, char_end: 10 });
    vi.mocked(parseAnnotations).mockResolvedValue([ann]);
    useWorkspaceStore.setState({ currentPagePath: "notes/test.md" });
    mockListAnnotations.mockResolvedValue([
      { annotation_id: 1, node_id: "notes/test.md", node_title: "test", annotation_type: "note", certainty: "neutral", body: "stable", date: null, source_line: 1, char_start: 0, char_end: 10, uuid: "uuid-cached" },
    ]);

    const state = EditorState.create({
      doc: "hello text",
      extensions: [annotationExtension()],
    });
    const view = new EditorView({ state, parent: document.createElement("div") });

    // Initial fireIPC
    await vi.advanceTimersByTimeAsync(0);
    expect(mockListAnnotations).toHaveBeenCalledTimes(1);

    // Trigger another doc change — parseAnnotations returns same type+body, just shifted positions
    const shiftedAnn = makeAnnotation({ annotation_type: "note", body: "stable", char_start: 6, char_end: 16 });
    vi.mocked(parseAnnotations).mockResolvedValue([shiftedAnn]);
    mockListAnnotations.mockClear();

    view.dispatch({ changes: { from: 0, insert: "added " } });
    await vi.advanceTimersByTimeAsync(150);
    await vi.advanceTimersByTimeAsync(0);

    // listAnnotations should NOT be called since fingerprint (type:body) didn't change
    expect(mockListAnnotations).not.toHaveBeenCalled();

    // But enrichment should still work from cached data
    const data = view.state.field(annotationDataField);
    expect(data[0]!.uuid).toBe("uuid-cached");

    view.destroy();
  });

  it("calls listAnnotations when annotations change (fingerprint differs)", async () => {
    const ann1 = makeAnnotation({ annotation_type: "note", body: "original", char_start: 0, char_end: 10 });
    vi.mocked(parseAnnotations).mockResolvedValue([ann1]);
    useWorkspaceStore.setState({ currentPagePath: "notes/test.md" });
    mockListAnnotations.mockResolvedValue([
      { annotation_id: 1, node_id: "notes/test.md", node_title: "test", annotation_type: "note", certainty: "neutral", body: "original", date: null, source_line: 1, char_start: 0, char_end: 10, uuid: "uuid-orig" },
    ]);

    const state = EditorState.create({
      doc: "hello text",
      extensions: [annotationExtension()],
    });
    const view = new EditorView({ state, parent: document.createElement("div") });

    await vi.advanceTimersByTimeAsync(0);
    expect(mockListAnnotations).toHaveBeenCalledTimes(1);

    // Now annotations change — different body
    const ann2 = makeAnnotation({ annotation_type: "note", body: "edited", char_start: 0, char_end: 10 });
    vi.mocked(parseAnnotations).mockResolvedValue([ann2]);
    mockListAnnotations.mockClear();
    mockListAnnotations.mockResolvedValue([
      { annotation_id: 1, node_id: "notes/test.md", node_title: "test", annotation_type: "note", certainty: "neutral", body: "edited", date: null, source_line: 1, char_start: 0, char_end: 10, uuid: "uuid-edited" },
    ]);

    view.dispatch({ changes: { from: 5, insert: "!" } });
    await vi.advanceTimersByTimeAsync(150);
    await vi.advanceTimersByTimeAsync(0);

    // listAnnotations SHOULD be called since fingerprint changed
    expect(mockListAnnotations).toHaveBeenCalledTimes(1);
    const data = view.state.field(annotationDataField);
    expect(data[0]!.uuid).toBe("uuid-edited");

    view.destroy();
  });

  it("invalidates cache on page change (nodeId differs)", async () => {
    const ann = makeAnnotation({ annotation_type: "note", body: "stable", char_start: 0, char_end: 10 });
    vi.mocked(parseAnnotations).mockResolvedValue([ann]);
    useWorkspaceStore.setState({ currentPagePath: "notes/page1.md" });
    mockListAnnotations.mockResolvedValue([
      { annotation_id: 1, node_id: "notes/page1.md", node_title: "page1", annotation_type: "note", certainty: "neutral", body: "stable", date: null, source_line: 1, char_start: 0, char_end: 10, uuid: "uuid-page1" },
    ]);

    const state = EditorState.create({
      doc: "hello text",
      extensions: [annotationExtension()],
    });
    const view = new EditorView({ state, parent: document.createElement("div") });

    await vi.advanceTimersByTimeAsync(0);
    expect(mockListAnnotations).toHaveBeenCalledTimes(1);
    expect(view.state.field(annotationDataField)[0]!.uuid).toBe("uuid-page1");

    // Simulate page change — same annotations but different nodeId
    useWorkspaceStore.setState({ currentPagePath: "notes/page2.md" });
    mockListAnnotations.mockClear();
    mockListAnnotations.mockResolvedValue([
      { annotation_id: 2, node_id: "notes/page2.md", node_title: "page2", annotation_type: "note", certainty: "neutral", body: "stable", date: null, source_line: 1, char_start: 0, char_end: 10, uuid: "uuid-page2" },
    ]);

    view.dispatch({ changes: { from: 5, insert: "!" } });
    await vi.advanceTimersByTimeAsync(150);
    await vi.advanceTimersByTimeAsync(0);

    // listAnnotations SHOULD be called because nodeId changed
    expect(mockListAnnotations).toHaveBeenCalledTimes(1);
    const data = view.state.field(annotationDataField);
    expect(data[0]!.uuid).toBe("uuid-page2");

    view.destroy();
  });
});

describe("annotationDecorationPlugin", () => {
  function makeAnnotationView(doc: string, cursorPos = 0) {
    const state = EditorState.create({
      doc,
      selection: { anchor: cursorPos },
      extensions: [
        markdown({ extensions: [CommentGrammar, AnnotationGrammar] }),
        annotationDataField,
        displayModeField,
        annotationDecorationPlugin,
        annotationFoldField,
      ],
    });
    const view = new EditorView({ state, parent: document.createElement("div") });
    ensureSyntaxTree(view.state, view.state.doc.length);
    return view;
  }

  function collectFromSet(set: DecorationSet) {
    const result: { from: number; to: number; widget: unknown }[] = [];
    const iter = set.iter();
    while (iter.value) {
      result.push({
        from: iter.from,
        to: iter.to,
        widget: iter.value.spec?.widget ?? null,
      });
      iter.next();
    }
    return result;
  }

  function collectDecorations(view: EditorView) {
    const set = view.plugin(annotationDecorationPlugin)?.allDecorations;
    if (!set) return [] as { from: number; to: number; widget: unknown }[];
    return collectFromSet(set);
  }

  // Reads the line-safe subset the plugin actually renders (wired via
  // `{ decorations: (v) => v.inlineDecorations }`), NOT the full unsplit set.
  function collectInlineDecorations(view: EditorView) {
    const set = view.plugin(annotationDecorationPlugin)?.inlineDecorations;
    if (!set) return [] as { from: number; to: number; widget: unknown }[];
    return collectFromSet(set);
  }

  it("InlineAnnotation → PillWidget", () => {
    // "first line\n" = 11 chars, "text " = 5 chars
    // <!---n | body---> starts at 16, 17 chars → ends at 33
    const doc = "first line\ntext <!---n | body---> more";
    const view = makeAnnotationView(doc, 0);

    const ann = makeAnnotation({
      char_start: 16,
      char_end: 33,
      original: "<!---n | body--->",
    });
    view.dispatch({ effects: setAnnotationData.of([ann]) });

    const decos = collectDecorations(view);
    const found = decos.find((d) => d.from === 16 && d.to === 33);
    expect(found).toBeTruthy();
    expect(found!.widget).toBeInstanceOf(PillWidget);

    view.destroy();
  });

  it("InlineAnnotation IS present in inlineDecorations (rendered subset)", () => {
    // Regression lock for the positive split path: a genuine inline annotation
    // must land in `inlineDecorations` (the set CM6 renders). A split that
    // misclassified all decorations as `block` would leave this empty yet still
    // pass every `collectDecorations`-based test.
    const doc = "first line\ntext <!---n | body---> more";
    const view = makeAnnotationView(doc, 0);

    const ann = makeAnnotation({
      char_start: 16,
      char_end: 33,
      original: "<!---n | body--->",
    });
    view.dispatch({ effects: setAnnotationData.of([ann]) });

    const inline = collectInlineDecorations(view);
    expect(inline.length).toBeGreaterThan(0);
    const found = inline.find((d) => d.from === 16 && d.to === 33);
    expect(found).toBeTruthy();
    expect(found!.widget).toBeInstanceOf(PillWidget);

    view.destroy();
  });

  it("exposes the full set as allDecorations, not the CM6-reserved decorations property", () => {
    // The unsafe inline+block superset must NOT live under `decorations`, the
    // name CM6 reads by convention — it includes line-break-spanning block
    // replacements that would throw if a future maintainer dropped the explicit
    // `{ decorations: (v) => v.inlineDecorations }` accessor. It lives under
    // `allDecorations`; `inlineDecorations` remains the line-safe rendered set.
    const doc = "first line\ntext <!---n | body---> more";
    const view = makeAnnotationView(doc, 0);

    const ann = makeAnnotation({
      char_start: 16,
      char_end: 33,
      original: "<!---n | body--->",
    });
    view.dispatch({ effects: setAnnotationData.of([ann]) });

    const pv = view.plugin(annotationDecorationPlugin)!;
    expect(pv.allDecorations).toBeDefined();
    expect((pv as unknown as { decorations?: unknown }).decorations).toBeUndefined();
    expect(pv.inlineDecorations).toBeDefined();

    view.destroy();
  });

  it("cursor on annotation line → no decoration", () => {
    const doc = "first line\ntext <!---n | body---> more";
    const view = makeAnnotationView(doc, 16);

    const ann = makeAnnotation({
      char_start: 16,
      char_end: 33,
      original: "<!---n | body--->",
    });
    view.dispatch({ effects: setAnnotationData.of([ann]) });

    const decos = collectDecorations(view);
    const found = decos.find((d) => d.from === 16 && d.to === 33);
    expect(found).toBeUndefined();

    view.destroy();
  });

  it("multi-line BlockAnnotation → NOT in plugin set (delivered by block field)", () => {
    // Blank line needed so paragraph doesn't swallow the block annotation.
    // The line-break-spanning callout is forbidden from a ViewPlugin source, so
    // the plugin must not build it; annotationBlockDecorationField owns it (see
    // the multiline block rendering regression + selection-guard suites).
    const doc = "first line\n\n<!---\nbody\n--->\nafter";
    const view = makeAnnotationView(doc, 28);

    const ann = makeAnnotation({
      form: "block",
      char_start: 12,
      char_end: 27,
      original: "<!---\nbody\n--->",
    });
    view.dispatch({ effects: setAnnotationData.of([ann]) });

    const decos = collectDecorations(view);
    const found = decos.find((d) => d.from === 12 && d.to === 27);
    expect(found).toBeUndefined();

    view.destroy();
  });

  it("single-line BlockAnnotation → PillWidget", () => {
    // "first line\n" = 11 chars
    // <!---content---> = 16 chars (11-26), end = 11+16 = 27
    // BlockAnnotation 11..27
    const doc = "first line\n<!---content--->";
    const view = makeAnnotationView(doc, 0);

    const ann = makeAnnotation({
      char_start: 11,
      char_end: 27,
      original: "<!---content--->",
    });
    view.dispatch({ effects: setAnnotationData.of([ann]) });

    const decos = collectDecorations(view);
    const found = decos.find((d) => d.from === 11 && d.to === 27);
    expect(found).toBeTruthy();
    expect(found!.widget).toBeInstanceOf(PillWidget);

    view.destroy();
  });

  it("single-line BlockAnnotation produces no block-field callout (lineAt multiline guard)", () => {
    const doc = "first line\n<!---content--->";
    const state = EditorState.create({
      doc,
      selection: { anchor: 0 },
      extensions: [
        markdown({ extensions: [CommentGrammar, AnnotationGrammar] }),
        annotationDataField,
        displayModeField,
        annotationFoldField,
        firingAnnotationsField,
        llmLockedField,
        annotationBlockDecorationField,
      ],
    });
    const view = new EditorView({ state, parent: document.createElement("div") });
    ensureSyntaxTree(view.state, view.state.doc.length);

    const ann = makeAnnotation({
      form: "block",
      char_start: 11,
      char_end: 27,
      original: "<!---content--->",
    });
    view.dispatch({ effects: setAnnotationData.of([ann]) });

    const blockDecos = collectFromSet(view.state.field(annotationBlockDecorationField).decorations);
    expect(blockDecos.filter(d => d.from === 11 && d.to === 27)).toHaveLength(0);

    view.destroy();
  });

  it("fold state → block-field CalloutWidget receives isCollapsed=true", () => {
    // The fold/isCollapsed state now lives on the block field's callout, since
    // the plugin no longer builds the multiline callout.
    const doc = "first line\n\n<!---\nbody\n--->\nafter";
    const state = EditorState.create({
      doc,
      selection: { anchor: 28 },
      extensions: [
        markdown({ extensions: [CommentGrammar, AnnotationGrammar] }),
        annotationDataField,
        displayModeField,
        annotationFoldField,
        annotationBlockDecorationField,
      ],
    });
    const view = new EditorView({ state, parent: document.createElement("div") });
    ensureSyntaxTree(view.state, view.state.doc.length);

    const ann = makeAnnotation({
      form: "block",
      char_start: 12,
      char_end: 27,
      original: "<!---\nbody\n--->",
    });

    view.dispatch({ effects: setAnnotationData.of([ann]) });
    view.dispatch({ effects: toggleAnnotationFoldEffect.of({ pos: 12 }) });

    const found = collectFromSet(view.state.field(annotationBlockDecorationField).decorations).find(
      (d) => d.from === 12 && d.to === 27,
    );
    expect(found).toBeTruthy();
    expect(found!.widget).toBeInstanceOf(CalloutWidget);
    expect((found!.widget as CalloutWidget).isCollapsed).toBe(true);

    view.destroy();
  });

  it("InlineAnnotation + mode 'footnote' → MarkerWidget", () => {
    const doc = "first line\ntext <!---n | body---> more";
    const state = EditorState.create({
      doc,
      selection: { anchor: 0 },
      extensions: [
        markdown({ extensions: [CommentGrammar, AnnotationGrammar] }),
        annotationDataField,
        displayModeField,
        annotationDecorationPlugin,
        annotationFoldField,
      ],
    });
    const view = new EditorView({ state, parent: document.createElement("div") });
    ensureSyntaxTree(view.state, view.state.doc.length);

    view.dispatch({ effects: setDisplayMode.of("footnote") });

    const ann = makeAnnotation({ char_start: 16, char_end: 33, original: "<!---n | body--->" });
    view.dispatch({ effects: setAnnotationData.of([ann]) });

    const decos = collectDecorations(view);
    const found = decos.find((d) => d.from === 16 && d.to === 33);
    expect(found).toBeTruthy();
    expect(found!.widget).toBeInstanceOf(MarkerWidget);

    view.destroy();
  });

  it("InlineAnnotation + mode 'pill' → PillWidget", () => {
    const doc = "first line\ntext <!---n | body---> more";
    const state = EditorState.create({
      doc,
      selection: { anchor: 0 },
      extensions: [
        markdown({ extensions: [CommentGrammar, AnnotationGrammar] }),
        annotationDataField,
        displayModeField,
        annotationDecorationPlugin,
        annotationFoldField,
      ],
    });
    const view = new EditorView({ state, parent: document.createElement("div") });
    ensureSyntaxTree(view.state, view.state.doc.length);

    view.dispatch({ effects: setDisplayMode.of("pill") });

    const ann = makeAnnotation({ char_start: 16, char_end: 33, original: "<!---n | body--->" });
    view.dispatch({ effects: setAnnotationData.of([ann]) });

    const decos = collectDecorations(view);
    const found = decos.find((d) => d.from === 16 && d.to === 33);
    expect(found).toBeTruthy();
    expect(found!.widget).toBeInstanceOf(PillWidget);

    view.destroy();
  });

  it("multi-line BlockAnnotation + mode 'footnote' → still NOT in plugin set (block field owns it)", () => {
    // Footnote mode only affects inline widgets; the multiline callout is never
    // built by the plugin regardless of mode and is delivered by the block field.
    const doc = "first line\n\n<!---\nbody\n--->\nafter";
    const state = EditorState.create({
      doc,
      selection: { anchor: 28 },
      extensions: [
        markdown({ extensions: [CommentGrammar, AnnotationGrammar] }),
        annotationDataField,
        displayModeField,
        annotationDecorationPlugin,
        annotationFoldField,
        annotationBlockDecorationField,
      ],
    });
    const view = new EditorView({ state, parent: document.createElement("div") });
    ensureSyntaxTree(view.state, view.state.doc.length);

    view.dispatch({ effects: setDisplayMode.of("footnote") });

    const ann = makeAnnotation({
      form: "block",
      char_start: 12,
      char_end: 27,
      original: "<!---\nbody\n--->",
    });
    view.dispatch({ effects: setAnnotationData.of([ann]) });

    const decos = collectDecorations(view);
    expect(decos.find((d) => d.from === 12 && d.to === 27)).toBeUndefined();

    // The callout still renders via the block field, unaffected by footnote mode.
    const fieldFound = collectFromSet(view.state.field(annotationBlockDecorationField).decorations).find(
      (d) => d.from === 12 && d.to === 27,
    );
    expect(fieldFound!.widget).toBeInstanceOf(CalloutWidget);

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

describe("annotationDecorationPlugin rebuild triggers", () => {
  function makeView(doc: string, cursorPos = 0) {
    const state = EditorState.create({
      doc,
      selection: { anchor: cursorPos },
      extensions: [
        markdown({ extensions: [CommentGrammar, AnnotationGrammar] }),
        annotationDataField,
        displayModeField,
        annotationFoldField,
        firingAnnotationsField,
        llmLockedField,
        annotationDecorationPlugin,
        annotationBlockDecorationField,
      ],
    });
    const view = new EditorView({ state, parent: document.createElement("div") });
    ensureSyntaxTree(view.state, view.state.doc.length);
    return view;
  }

  function getSet(view: EditorView): DecorationSet {
    return view.plugin(annotationDecorationPlugin)!.allDecorations;
  }

  function getBlockFieldSet(view: EditorView): DecorationSet {
    return view.state.field(annotationBlockDecorationField).decorations;
  }

  function widgetAt(set: DecorationSet, from: number, to: number): unknown {
    const iter = set.iter();
    while (iter.value) {
      if (iter.from === from && iter.to === to) return iter.value.spec?.widget ?? null;
      iter.next();
    }
    return undefined;
  }

  it("rebuilds on setDisplayMode effect (pill → footnote swaps widget type)", () => {
    const doc = "first line\ntext <!---n | body---> more";
    const view = makeView(doc, 0);
    const ann = makeAnnotation({ char_start: 16, char_end: 33, original: "<!---n | body--->" });
    view.dispatch({ effects: setAnnotationData.of([ann]) });

    expect(widgetAt(getSet(view), 16, 33)).toBeInstanceOf(PillWidget);

    view.dispatch({ effects: setDisplayMode.of("footnote") });
    expect(widgetAt(getSet(view), 16, 33)).toBeInstanceOf(MarkerWidget);

    view.destroy();
  });

  it("rebuilds on toggleAnnotationFoldEffect (block-field Callout isCollapsed flips)", () => {
    // The multiline callout is delivered by annotationBlockDecorationField; the
    // plugin no longer builds it. The fold toggle flips isCollapsed on the
    // field's callout.
    const doc = "first line\n\n<!---\nbody\n--->\nafter";
    const view = makeView(doc, 28);
    const ann = makeAnnotation({ form: "block", char_start: 12, char_end: 27, original: "<!---\nbody\n--->" });
    view.dispatch({ effects: setAnnotationData.of([ann]) });

    // Plugin set must not contain the line-spanning callout.
    expect(widgetAt(getSet(view), 12, 27)).toBeUndefined();

    const w1 = widgetAt(getBlockFieldSet(view), 12, 27);
    expect(w1).toBeInstanceOf(CalloutWidget);
    expect((w1 as CalloutWidget).isCollapsed).toBe(false);

    view.dispatch({ effects: toggleAnnotationFoldEffect.of({ pos: 12 }) });
    const w2 = widgetAt(getBlockFieldSet(view), 12, 27);
    expect((w2 as CalloutWidget).isCollapsed).toBe(true);

    view.destroy();
  });

  it("rebuilds on setFiringAnnotation / clearFiringAnnotation effects", () => {
    const doc = "first line\ntext <!---n | body---> more";
    const view = makeView(doc, 0);
    const ann = makeAnnotation({ char_start: 16, char_end: 33, original: "<!---n | body--->" });
    view.dispatch({ effects: setAnnotationData.of([ann]) });

    expect((widgetAt(getSet(view), 16, 33) as PillWidget).isFiring).toBe(false);

    view.dispatch({ effects: setFiringAnnotation.of(16) });
    expect((widgetAt(getSet(view), 16, 33) as PillWidget).isFiring).toBe(true);

    view.dispatch({ effects: clearFiringAnnotation.of(16) });
    expect((widgetAt(getSet(view), 16, 33) as PillWidget).isFiring).toBe(false);

    view.destroy();
  });

  it("rebuilds on setLlmLockedEffect", () => {
    const doc = "first line\ntext <!---n | body---> more";
    const view = makeView(doc, 0);
    const ann = makeAnnotation({ char_start: 16, char_end: 33, original: "<!---n | body--->" });
    view.dispatch({ effects: setAnnotationData.of([ann]) });

    expect((widgetAt(getSet(view), 16, 33) as PillWidget).llmLocked).toBe(false);

    view.dispatch({ effects: setLlmLockedEffect.of(true) });
    expect((widgetAt(getSet(view), 16, 33) as PillWidget).llmLocked).toBe(true);

    view.destroy();
  });

  it("hasAnnotationEffect recognizes every block-field rebuild-triggering effect", () => {
    // Block-field superset gate: every annotation-relevant effect must be
    // recognized, and an unrelated/empty transaction must not.
    const cases = [
      setAnnotationData.of([]),
      setDisplayMode.of("footnote"),
      toggleAnnotationFoldEffect.of({ pos: 0 }),
      setAllAnnotationFoldsEffect.of({ positions: [0], collapsed: true }),
      setFiringAnnotation.of(0),
      clearFiringAnnotation.of(0),
      setLlmLockedEffect.of(true),
      setThreadTurnEffect.of({ pos: 0, turn: 1 }),
    ];
    for (const effect of cases) {
      const tr = EditorState.create({ doc: "x" }).update({ effects: effect });
      expect(hasAnnotationEffect(tr)).toBe(true);
    }

    const empty = EditorState.create({ doc: "x" }).update({ selection: { anchor: 1 } });
    expect(hasAnnotationEffect(empty)).toBe(false);
  });

  it("hasInlineAnnotationEffect recognizes ONLY the inline-relevant effects", () => {
    const trueCases = [
      setAnnotationData.of([]),
      setDisplayMode.of("footnote"),
      setFiringAnnotation.of(0),
      clearFiringAnnotation.of(0),
      setLlmLockedEffect.of(true),
    ];
    for (const effect of trueCases) {
      const tr = EditorState.create({ doc: "x" }).update({ effects: effect });
      expect(hasInlineAnnotationEffect(tr)).toBe(true);
    }

    const falseCases = [
      toggleAnnotationFoldEffect.of({ pos: 0 }),
      setAllAnnotationFoldsEffect.of({ positions: [0], collapsed: true }),
      setThreadTurnEffect.of({ pos: 0, turn: 1 }),
    ];
    for (const effect of falseCases) {
      const tr = EditorState.create({ doc: "x" }).update({ effects: effect });
      expect(hasInlineAnnotationEffect(tr)).toBe(false);
    }

    const empty = EditorState.create({ doc: "x" }).update({ selection: { anchor: 1 } });
    expect(hasInlineAnnotationEffect(empty)).toBe(false);
  });

  it("hasBlockAnnotationEffect returns true for block-relevant effects", () => {
    const trueCases = [
      setAnnotationData.of([]),
      setFiringAnnotation.of(0),
      clearFiringAnnotation.of(0),
      setLlmLockedEffect.of(true),
      toggleAnnotationFoldEffect.of({ pos: 0 }),
      setAllAnnotationFoldsEffect.of({ positions: [0], collapsed: true }),
      setThreadTurnEffect.of({ pos: 0, turn: 1 }),
    ];
    for (const effect of trueCases) {
      const tr = EditorState.create({ doc: "x" }).update({ effects: effect });
      expect(hasBlockAnnotationEffect(tr)).toBe(true);
    }

    const empty = EditorState.create({ doc: "x" }).update({ selection: { anchor: 1 } });
    expect(hasBlockAnnotationEffect(empty)).toBe(false);
  });

  it("hasBlockAnnotationEffect returns false for setDisplayMode", () => {
    const tr = EditorState.create({ doc: "x" }).update({ effects: setDisplayMode.of("footnote") });
    expect(hasBlockAnnotationEffect(tr)).toBe(false);
  });

  it("hasAnnotationEffect is the composition of inline and block gates", () => {
    const allEffects = [
      setAnnotationData.of([]),
      setDisplayMode.of("footnote"),
      toggleAnnotationFoldEffect.of({ pos: 0 }),
      setAllAnnotationFoldsEffect.of({ positions: [0], collapsed: true }),
      setFiringAnnotation.of(0),
      clearFiringAnnotation.of(0),
      setLlmLockedEffect.of(true),
      setThreadTurnEffect.of({ pos: 0, turn: 1 }),
    ];
    for (const effect of allEffects) {
      const tr = EditorState.create({ doc: "x" }).update({ effects: effect });
      expect(hasAnnotationEffect(tr)).toBe(hasInlineAnnotationEffect(tr) || hasBlockAnnotationEffect(tr));
    }
  });

  it("does NOT rebuild the block field on setDisplayMode effect", () => {
    const doc = "first line\n\n<!---\nbody\n--->\nafter";
    const view = makeView(doc, 28);
    const ann = makeAnnotation({ form: "block", char_start: 12, char_end: 27, original: "<!---\nbody\n--->" });
    view.dispatch({ effects: setAnnotationData.of([ann]) });

    const fieldBefore = view.state.field(annotationBlockDecorationField);
    view.dispatch({ effects: setDisplayMode.of("footnote") });
    expect(view.state.field(annotationBlockDecorationField)).toBe(fieldBefore);

    view.destroy();
  });

  it("does NOT rebuild the inline plugin on toggleAnnotationFoldEffect", () => {
    const doc = "first line\ntext <!---n | body---> more";
    const view = makeView(doc, 0);
    const ann = makeAnnotation({ char_start: 16, char_end: 33, original: "<!---n | body--->" });
    view.dispatch({ effects: setAnnotationData.of([ann]) });

    const setBefore = getSet(view);
    view.dispatch({ effects: toggleAnnotationFoldEffect.of({ pos: 16 }) });
    expect(getSet(view)).toBe(setBefore);

    view.destroy();
  });

  it("does NOT rebuild the inline plugin on setThreadTurnEffect", () => {
    const doc = "first line\ntext <!---n | body---> more";
    const view = makeView(doc, 0);
    const ann = makeAnnotation({ char_start: 16, char_end: 33, original: "<!---n | body--->" });
    view.dispatch({ effects: setAnnotationData.of([ann]) });

    const setBefore = getSet(view);
    view.dispatch({ effects: setThreadTurnEffect.of({ pos: 16, turn: 1 }) });
    expect(getSet(view)).toBe(setBefore);

    view.destroy();
  });

  it("does NOT rebuild when cursor moves between two non-annotation (plain) lines", () => {
    // doc5: ann InlineAnnotation 11..25 on line 2; plainA line 4 (34..40), plainB line 5 (41..47)
    const doc = "line1\ntext <!---n | x---> y\nline3\nplainA\nplainB";
    const view = makeView(doc, 35); // cursor on plainA (line 4)
    const ann = makeAnnotation({ char_start: 11, char_end: 25, original: "<!---n | x--->" });
    view.dispatch({ effects: setAnnotationData.of([ann]) });

    // Decoration produced because cursor sits on a plain line, not the annotation line.
    expect(widgetAt(getSet(view), 11, 25)).toBeInstanceOf(PillWidget);

    const setBefore = getSet(view);
    view.dispatch({ selection: { anchor: 43 } }); // move to plainB (line 5), also plain
    expect(getSet(view)).toBe(setBefore); // same reference → no rebuild

    view.destroy();
  });

  it("DOES rebuild when cursor moves onto an annotation line (sensitive)", () => {
    const doc = "line1\ntext <!---n | x---> y\nline3\nplainA\nplainB";
    const view = makeView(doc, 35); // cursor on plainA
    const ann = makeAnnotation({ char_start: 11, char_end: 25, original: "<!---n | x--->" });
    view.dispatch({ effects: setAnnotationData.of([ann]) });

    const setBefore = getSet(view);
    view.dispatch({ selection: { anchor: 13 } }); // move onto annotation line (line 2)
    expect(getSet(view)).not.toBe(setBefore); // rebuilt
    // cursor on annotation line suppresses the decoration
    expect(widgetAt(getSet(view), 11, 25)).toBeUndefined();

    view.destroy();
  });

  it("rebuilds on docChanged", () => {
    const doc = "line1\ntext <!---n | x---> y\nline3\nplainA\nplainB";
    const view = makeView(doc, 35);
    const ann = makeAnnotation({ char_start: 11, char_end: 25, original: "<!---n | x--->" });
    view.dispatch({ effects: setAnnotationData.of([ann]) });

    const setBefore = getSet(view);
    view.dispatch({ changes: { from: doc.length, insert: " tail" } }); // edit far from annotation
    expect(getSet(view)).not.toBe(setBefore);

    view.destroy();
  });
});

describe("syntax-tree progression triggers rebuild", () => {
  // When CM6's background parseWorker finishes a chunk, it dispatches a
  // transaction carrying Language.setState (the tree object swaps) that sets
  // NONE of docChanged, viewportChanged, an annotation effect, or selectionSet.
  // Pre-fix, both the plugin's update() and the block field's update() fell
  // through and never rebuilt, so annotations past the initial parse frontier
  // stayed invisible on large docs opened without interaction. The fix adds a
  // syntax-tree-identity comparison (syntaxTree(startState) !== syntaxTree(state))
  // as an additional rebuild trigger.
  //
  // jsdom parses synchronously, so we cannot reproduce a genuinely-incomplete
  // frontier; instead we drive the exact signal the fix keys on: `forceParsing`
  // swaps the cached tree object identity WITHOUT any doc/effect/selection
  // change, and a subsequent empty `view.dispatch({})` delivers that swap as a
  // ViewUpdate. Pre-fix these update() paths fall through (no rebuild); post-fix
  // the tree-identity change drives a rebuild. The no-churn test guards the
  // inverse: a stable tree must NOT trigger a rebuild.

  const FILLER_LINE = "this is a line of plain filler text to pad the document out\n";
  const PREFIX = FILLER_LINE.repeat(2000);
  const INLINE = "text <!---n | inline body---> tail\n";
  const BLOCK = "\n<!---\nblock body\n--->\n";
  const DOC = PREFIX + INLINE + BLOCK + "trailer\n";

  const INLINE_FROM = PREFIX.length + 5; // after "text "
  const BLOCK_FROM = PREFIX.length + INLINE.length + 1; // after the leading "\n"
  const BLOCK_TO = BLOCK_FROM + "<!---\nblock body\n--->".length;

  function makeView() {
    const state = EditorState.create({
      doc: DOC,
      selection: { anchor: 0 }, // cursor at top, far from the late annotations
      extensions: [
        markdown({ extensions: [CommentGrammar, AnnotationGrammar] }),
        annotationDataField,
        displayModeField,
        annotationFoldField,
        firingAnnotationsField,
        llmLockedField,
        annotationDecorationPlugin,
        annotationBlockDecorationField,
      ],
    });
    return new EditorView({ state, parent: document.createElement("div") });
  }

  function pluginSet(view: EditorView): DecorationSet {
    return view.plugin(annotationDecorationPlugin)!.allDecorations;
  }

  function fieldValue(view: EditorView) {
    return view.state.field(annotationBlockDecorationField);
  }

  /**
   * Dispatch an empty transaction whose start/end states differ ONLY in the
   * cached syntax-tree object identity (the parser-progress signal), then return
   * whether the tree identity actually changed across it. We swap the tree by
   * forcing a parse pass and confirm the resulting transaction carries no
   * docChange/effect/selection.
   */
  function dispatchParserProgress(view: EditorView): boolean {
    const treeBefore = syntaxTree(view.state);
    forceParsing(view, view.state.doc.length, 100000);
    const swapped = syntaxTree(view.state) !== treeBefore;
    view.dispatch({}); // empty: only the tree swap reaches update()
    return swapped;
  }

  it("plugin update() rebuilds on a parser-progress (tree-identity) transaction", () => {
    const view = makeView();
    try {
      // visibleRanges in jsdom is a tiny fixed window; widen it so the plugin's
      // viewport cull doesn't conflate with the trigger under test.
      Object.defineProperty(view, "visibleRanges", {
        value: [{ from: 0, to: view.state.doc.length }],
        configurable: true,
      });
      const inlineAnn = makeAnnotation({ char_start: INLINE_FROM, char_end: INLINE_FROM + 24, original: "<!---n | inline body--->" });
      view.dispatch({ effects: setAnnotationData.of([inlineAnn]) });

      const before = pluginSet(view);
      const swapped = dispatchParserProgress(view);
      expect(swapped).toBe(true); // precondition: tree identity genuinely changed
      // Pre-fix the empty dispatch falls through and `before` is reused; post-fix
      // the tree-identity change drives a rebuild → fresh set reference.
      expect(pluginSet(view)).not.toBe(before);
    } finally {
      view.destroy();
    }
  });

  it("block field update() rebuilds on a parser-progress (tree-identity) transaction", () => {
    const view = makeView();
    try {
      const blockAnn = makeAnnotation({ form: "block", char_start: BLOCK_FROM, char_end: BLOCK_TO, original: "<!---\nblock body\n--->" });
      view.dispatch({ effects: setAnnotationData.of([blockAnn]) });

      const before = fieldValue(view);
      const swapped = dispatchParserProgress(view);
      expect(swapped).toBe(true);
      // Pre-fix the field's update() falls through and returns the old value;
      // post-fix the tree-identity change rebuilds → fresh value reference.
      expect(fieldValue(view)).not.toBe(before);
    } finally {
      view.destroy();
    }
  });

  it("does NOT rebuild on an empty dispatch once the tree is already complete (no churn)", () => {
    const view = makeView();
    try {
      const inlineAnn = makeAnnotation({ char_start: INLINE_FROM, char_end: INLINE_FROM + 24, original: "<!---n | inline body--->" });
      const blockAnn = makeAnnotation({ form: "block", char_start: BLOCK_FROM, char_end: BLOCK_TO, original: "<!---\nblock body\n--->" });
      view.dispatch({ effects: setAnnotationData.of([inlineAnn, blockAnn]) });

      // Settle the tree (parse + deliver the swap) so a subsequent empty dispatch
      // sees a STABLE tree identity.
      dispatchParserProgress(view);

      const pluginBefore = pluginSet(view);
      const fieldBefore = fieldValue(view);
      // Second empty dispatch: tree identity stable across it → no rebuild.
      expect(syntaxTree(view.state)).toBe(syntaxTree(view.state));
      view.dispatch({});
      expect(pluginSet(view)).toBe(pluginBefore);
      expect(fieldValue(view)).toBe(fieldBefore);
    } finally {
      view.destroy();
    }
  });
});

describe("shouldRebuildBlocksOnTreeChange", () => {
  it("returns false when annotations array is empty", () => {
    const state = EditorState.create({
      doc: "hello world",
      extensions: [
        markdown({ extensions: [CommentGrammar, AnnotationGrammar] }),
        annotationDataField,
      ],
    });
    expect(shouldRebuildBlocksOnTreeChange(state, [])).toBe(false);
  });

  it("returns false when all annotations end within parsed territory", () => {
    const doc = "text <!---n | body---> more content here";
    const state = EditorState.create({
      doc,
      extensions: [
        markdown({ extensions: [CommentGrammar, AnnotationGrammar] }),
        annotationDataField,
      ],
    });
    ensureSyntaxTree(state, state.doc.length);
    const annotations = [makeAnnotation({ char_start: 5, char_end: 22 })];
    expect(shouldRebuildBlocksOnTreeChange(state, annotations)).toBe(false);
  });

  it("returns true when an annotation ends beyond the tree's coverage", () => {
    // Annotation char_end beyond tree length simulates a partially-parsed
    // large doc where annotations sit past the parse frontier. In real usage
    // tree.length < doc.length during incremental parsing while annotation
    // positions reference the full document.
    const doc = "hello world";
    const state = EditorState.create({
      doc,
      extensions: [
        markdown({ extensions: [CommentGrammar, AnnotationGrammar] }),
        annotationDataField,
      ],
    });
    const annotations = [makeAnnotation({ char_start: 5, char_end: 1000 })];
    expect(shouldRebuildBlocksOnTreeChange(state, annotations)).toBe(true);
  });

  it("block field skips rebuild when annotations are early in a large doc and tree extends past them", () => {
    const INLINE = "text <!---n | body---> tail\n";
    const FILLER = "this is a line of plain filler text to pad the document\n".repeat(2000);
    const doc = INLINE + FILLER;
    const state = EditorState.create({
      doc,
      selection: { anchor: 0 },
      extensions: [
        markdown({ extensions: [CommentGrammar, AnnotationGrammar] }),
        annotationDataField,
        displayModeField,
        annotationFoldField,
        firingAnnotationsField,
        llmLockedField,
        annotationDecorationPlugin,
        annotationBlockDecorationField,
      ],
    });
    const view = new EditorView({ state, parent: document.createElement("div") });

    // Parse enough to cover the annotation but not the entire doc.
    ensureSyntaxTree(view.state, INLINE.length + 100);

    const ann = makeAnnotation({ char_start: 5, char_end: 22, original: "<!---n | body--->" });
    view.dispatch({ effects: setAnnotationData.of([ann]) });

    // Force the parser to extend further into the filler (simulates parser
    // progress past the annotation positions).
    const treeBefore = syntaxTree(view.state);
    forceParsing(view, view.state.doc.length, 100000);
    const swapped = syntaxTree(view.state) !== treeBefore;
    expect(swapped).toBe(true);

    const fieldBefore = view.state.field(annotationBlockDecorationField);
    view.dispatch({});
    const fieldAfter = view.state.field(annotationBlockDecorationField);

    // The guard should prevent a rebuild because all annotations end within
    // the already-parsed territory of the OLD tree.
    expect(fieldAfter).toBe(fieldBefore);

    view.destroy();
  });
});

describe("buildAnnotationDecorations", () => {
  function makeView(doc: string, cursorPos = 0) {
    const state = EditorState.create({
      doc,
      selection: { anchor: cursorPos },
      extensions: [
        markdown({ extensions: [CommentGrammar, AnnotationGrammar] }),
        annotationDataField,
        displayModeField,
        annotationFoldField,
        firingAnnotationsField,
        llmLockedField,
        annotationBlockDecorationField,
      ],
    });
    const view = new EditorView({ state, parent: document.createElement("div") });
    ensureSyntaxTree(view.state, view.state.doc.length);
    return view;
  }

  function iterateSet(set: DecorationSet) {
    const out: { from: number; to: number; widget: unknown }[] = [];
    const iter = set.iter();
    while (iter.value) {
      out.push({ from: iter.from, to: iter.to, widget: iter.value.spec?.widget ?? null });
      iter.next();
    }
    return out;
  }

  it("returns empty DecorationSet when no annotations", () => {
    const view = makeView("first line\nplain text", 0);
    const { decorations, cursorSensitiveLines } = buildAnnotationDecorations(view);
    expect(decorations.size).toBe(0);
    expect(cursorSensitiveLines.size).toBe(0);
    view.destroy();
  });

  it("InlineAnnotation → PillWidget decoration", () => {
    const doc = "first line\ntext <!---n | body---> more";
    const view = makeView(doc, 0);
    const ann = makeAnnotation({ char_start: 16, char_end: 33, original: "<!---n | body--->" });
    view.dispatch({ effects: setAnnotationData.of([ann]) });

    const { decorations } = buildAnnotationDecorations(view);
    const found = iterateSet(decorations).find((d) => d.from === 16 && d.to === 33);
    expect(found).toBeTruthy();
    expect(found!.widget).toBeInstanceOf(PillWidget);
    view.destroy();
  });

  it("cursor on annotation line → no decoration", () => {
    const doc = "first line\ntext <!---n | body---> more";
    const view = makeView(doc, 16);
    const ann = makeAnnotation({ char_start: 16, char_end: 33, original: "<!---n | body--->" });
    view.dispatch({ effects: setAnnotationData.of([ann]) });

    const { decorations } = buildAnnotationDecorations(view);
    const found = iterateSet(decorations).find((d) => d.from === 16 && d.to === 33);
    expect(found).toBeUndefined();
    view.destroy();
  });

  it("multi-line BlockAnnotation → CalloutWidget delivered by block field, not buildAnnotationDecorations", () => {
    const doc = "first line\n\n<!---\nbody\n--->\nafter";
    const view = makeView(doc, 28);
    const ann = makeAnnotation({ form: "block", char_start: 12, char_end: 27, original: "<!---\nbody\n--->" });
    view.dispatch({ effects: setAnnotationData.of([ann]) });

    // buildAnnotationDecorations no longer builds the line-spanning callout
    // (splitAnnotationDecorations would discard it); the block field owns it.
    const { decorations } = buildAnnotationDecorations(view);
    expect(iterateSet(decorations).find((d) => d.from === 12 && d.to === 27)).toBeUndefined();

    const fieldFound = iterateSet(view.state.field(annotationBlockDecorationField).decorations).find(
      (d) => d.from === 12 && d.to === 27,
    );
    expect(fieldFound!.widget).toBeInstanceOf(CalloutWidget);
    view.destroy();
  });

  it("footnote mode → MarkerWidget", () => {
    const doc = "first line\ntext <!---n | body---> more";
    const view = makeView(doc, 0);
    view.dispatch({ effects: setDisplayMode.of("footnote") });
    const ann = makeAnnotation({ char_start: 16, char_end: 33, original: "<!---n | body--->" });
    view.dispatch({ effects: setAnnotationData.of([ann]) });

    const { decorations } = buildAnnotationDecorations(view);
    const found = iterateSet(decorations).find((d) => d.from === 16 && d.to === 33);
    expect(found).toBeTruthy();
    expect(found!.widget).toBeInstanceOf(MarkerWidget);
    view.destroy();
  });

  it("fold state → block-field CalloutWidget isCollapsed=true", () => {
    const doc = "first line\n\n<!---\nbody\n--->\nafter";
    const view = makeView(doc, 28);
    const ann = makeAnnotation({ form: "block", char_start: 12, char_end: 27, original: "<!---\nbody\n--->" });
    view.dispatch({ effects: setAnnotationData.of([ann]) });
    view.dispatch({ effects: toggleAnnotationFoldEffect.of({ pos: 12 }) });

    // Fold/isCollapsed now lives on the block field's callout.
    const { decorations } = buildAnnotationDecorations(view);
    expect(iterateSet(decorations).find((d) => d.from === 12 && d.to === 27)).toBeUndefined();

    const found = iterateSet(view.state.field(annotationBlockDecorationField).decorations).find(
      (d) => d.from === 12 && d.to === 27,
    );
    expect(found).toBeTruthy();
    expect(found!.widget).toBeInstanceOf(CalloutWidget);
    expect((found!.widget as CalloutWidget).isCollapsed).toBe(true);
    view.destroy();
  });

  it("multiline BlockAnnotation is NOT built (field owns it), but its lines stay cursor-sensitive", () => {
    // splitAnnotationDecorations would route a multiline-spanning replace to the
    // discarded "block" subset; annotationBlockDecorationField is the sole
    // producer of the callout. So buildAnnotationDecorations must not build it,
    // while still recording its lines as cursor-sensitive.
    const doc = "first line\n\n<!---\nbody\n--->\nafter";
    const view = makeView(doc, 28);
    const ann = makeAnnotation({ form: "block", char_start: 12, char_end: 27, original: "<!---\nbody\n--->" });
    view.dispatch({ effects: setAnnotationData.of([ann]) });

    const { decorations, cursorSensitiveLines } = buildAnnotationDecorations(view);
    const found = iterateSet(decorations).find((d) => d.from === 12 && d.to === 27);
    expect(found).toBeUndefined();
    expect(decorations.size).toBe(0);

    const startLine = view.state.doc.lineAt(12).number;
    const endLine = view.state.doc.lineAt(27).number;
    for (let l = startLine; l <= endLine; l++) {
      expect(cursorSensitiveLines.has(l)).toBe(true);
    }
    view.destroy();
  });

  it("tracks cursor-sensitive lines spanned by annotation", () => {
    const doc = "first line\n\n<!---\nbody\n--->\nafter";
    const view = makeView(doc, 28);
    const ann = makeAnnotation({ form: "block", char_start: 12, char_end: 27, original: "<!---\nbody\n--->" });
    view.dispatch({ effects: setAnnotationData.of([ann]) });

    const { cursorSensitiveLines } = buildAnnotationDecorations(view);
    const startLine = view.state.doc.lineAt(ann.char_start).number;
    const endLine = view.state.doc.lineAt(ann.char_end).number;
    for (let l = startLine; l <= endLine; l++) {
      expect(cursorSensitiveLines.has(l)).toBe(true);
    }
    expect(cursorSensitiveLines.has(1)).toBe(false);
    view.destroy();
  });

  it("out-of-range annotation positions → no decoration and no sensitive lines", () => {
    const view = makeView("short text", 0);
    const ann = makeAnnotation({ char_start: -1, char_end: 5 });
    view.dispatch({ effects: setAnnotationData.of([ann]) });

    const { decorations, cursorSensitiveLines } = buildAnnotationDecorations(view);
    expect(decorations.size).toBe(0);
    expect(cursorSensitiveLines.size).toBe(0);
    view.destroy();
  });

  it("firing annotation → widget still produced (field read path intact)", () => {
    const doc = "first line\ntext <!---n | body---> more";
    const view = makeView(doc, 0);
    const ann = makeAnnotation({ char_start: 16, char_end: 33, original: "<!---n | body--->" });
    view.dispatch({ effects: setAnnotationData.of([ann]) });
    view.dispatch({ effects: setFiringAnnotation.of(16) });

    const { decorations } = buildAnnotationDecorations(view);
    const found = iterateSet(decorations).find((d) => d.from === 16 && d.to === 33);
    expect(found).toBeTruthy();
    expect(found!.widget).toBeInstanceOf(PillWidget);
    view.destroy();
  });

  it("overlapping buffered visible ranges → annotation node decorated exactly once", () => {
    const doc = "first line\ntext <!---n | body---> more";
    const view = makeView(doc, 0);
    const ann = makeAnnotation({ char_start: 16, char_end: 33, original: "<!---n | body--->" });
    view.dispatch({ effects: setAnnotationData.of([ann]) });

    // Two adjacent visible ranges whose [from - 5000, to + 5000] buffers both
    // cover the annotation at 16..33. Pre-fix the tree.iterate walk visits the
    // node once per range and pushes a duplicate Decoration.replace.
    Object.defineProperty(view, "visibleRanges", {
      value: [
        { from: 0, to: 5 },
        { from: 6, to: view.state.doc.length },
      ],
      configurable: true,
    });

    const { decorations, cursorSensitiveLines } = buildAnnotationDecorations(view);
    const spanMatches = iterateSet(decorations).filter((d) => d.from === 16 && d.to === 33);
    expect(spanMatches).toHaveLength(1);
    expect(decorations.size).toBe(1);
    // Dedup must not skip line tracking.
    const line = view.state.doc.lineAt(16).number;
    expect(cursorSensitiveLines.has(line)).toBe(true);
    view.destroy();
  });
});

describe("buildAnnotationRangeMap", () => {
  it("keys annotations by char_start:char_end for O(1) lookup", () => {
    const a1 = makeAnnotation({ char_start: 5, char_end: 15 });
    const a2 = makeAnnotation({ char_start: 20, char_end: 30 });
    const map = buildAnnotationRangeMap([a1, a2]);
    expect(map.get("5:15")).toBe(a1);
    expect(map.get("20:30")).toBe(a2);
    expect(map.get("0:10")).toBeUndefined();
  });

  it("preserves findAnnotationForRange's first-match-wins for duplicate spans", () => {
    const a1 = makeAnnotation({ char_start: 5, char_end: 15, body: "first" });
    const a2 = makeAnnotation({ char_start: 5, char_end: 15, body: "second" });
    const map = buildAnnotationRangeMap([a1, a2]);
    expect(map.get("5:15")).toBe(a1);
    expect(findAnnotationForRange([a1, a2], 5, 15)).toBe(a1);
  });

  it("returns an empty map for no annotations", () => {
    expect(buildAnnotationRangeMap([]).size).toBe(0);
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
  it("returns array with 16 extensions", () => {
    const ext = annotationExtension();
    expect(Array.isArray(ext)).toBe(true);
    expect((ext as unknown[]).length).toBe(16);
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

  it("wires annotationDecorationPlugin into the extension array", () => {
    const ext = annotationExtension() as unknown[];
    expect(ext).toContain(annotationDecorationPlugin);
  });

  it("instantiates a resolvable annotationDecorationPlugin in an EditorView", () => {
    const view = new EditorView({
      state: EditorState.create({
        doc: "hello",
        extensions: [annotationExtension()],
      }),
    });
    try {
      expect(view.plugin(annotationDecorationPlugin)).not.toBeNull();
    } finally {
      view.destroy();
    }
  });
});

describe("annotationExtension multiline block rendering (regression)", () => {
  // CodeMirror forbids line-break-spanning replacements from ViewPlugin sources.
  // Multiline callouts must therefore be delivered via annotationBlockDecorationField.
  // This guards the full production wiring against the "Decorations that replace
  // line breaks may not be specified via plugins" RangeError.
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(parseAnnotations).mockResolvedValue([]);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders a multiline BlockAnnotation through the full extension without throwing", async () => {
    const doc = "first line\n\n<!---\nbody\n--->\nafter";
    const state = EditorState.create({
      doc,
      selection: { anchor: 28 },
      extensions: [
        markdown({ extensions: [CommentGrammar, AnnotationGrammar] }),
        annotationExtension(),
      ],
    });
    const view = new EditorView({ state, parent: document.createElement("div") });
    await vi.advanceTimersByTimeAsync(0);
    ensureSyntaxTree(view.state, view.state.doc.length);

    const ann = makeAnnotation({ form: "block", char_start: 12, char_end: 27, original: "<!---\nbody\n--->" });
    expect(() => {
      view.dispatch({ effects: setAnnotationData.of([ann]) });
    }).not.toThrow();

    // The callout is delivered by the block field, not the plugin's rendered set.
    const fieldSet = view.state.field(annotationBlockDecorationField).decorations;
    let foundInField = false;
    const it1 = fieldSet.iter();
    while (it1.value) {
      if (it1.from === 12 && it1.to === 27) foundInField = it1.value.spec?.widget instanceof CalloutWidget;
      it1.next();
    }
    expect(foundInField).toBe(true);

    // The plugin's rendered (inline) set excludes the line-spanning callout.
    const pluginSet = view.plugin(annotationDecorationPlugin)!.inlineDecorations;
    let foundInPlugin = false;
    const it2 = pluginSet.iter();
    while (it2.value) {
      if (it2.from === 12 && it2.to === 27) foundInPlugin = true;
      it2.next();
    }
    expect(foundInPlugin).toBe(false);

    view.destroy();
  });
});

describe("annotationBlockDecorationField selection guard", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(parseAnnotations).mockResolvedValue([]);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  // doc layout (char offsets):
  //   line1: "first line"        0..10
  //   line2: ""                  11
  //   line3: "<!---"             12..17
  //   line4: "body"              18..22
  //   line5: "--->"              23..27
  //   line6: "after"             28..33
  //   line7: "plain tail one"    34..48
  //   line8: "plain tail two"    49..63
  // Block annotation spans char 12..27 (lines 3-5).
  const DOC = "first line\n\n<!---\nbody\n--->\nafter\nplain tail one\nplain tail two";
  const BLOCK_START = 12;
  const BLOCK_END = 27;

  async function makeView(anchor: number) {
    const state = EditorState.create({
      doc: DOC,
      selection: { anchor },
      extensions: [
        markdown({ extensions: [CommentGrammar, AnnotationGrammar] }),
        annotationExtension(),
      ],
    });
    const view = new EditorView({ state, parent: document.createElement("div") });
    await vi.advanceTimersByTimeAsync(0);
    ensureSyntaxTree(view.state, view.state.doc.length);
    const ann = makeAnnotation({ form: "block", char_start: BLOCK_START, char_end: BLOCK_END, original: "<!---\nbody\n--->" });
    view.dispatch({ effects: setAnnotationData.of([ann]) });
    return view;
  }

  function hasCallout(set: DecorationSet): boolean {
    let found = false;
    const it = set.iter();
    while (it.value) {
      if (it.from === BLOCK_START && it.to === BLOCK_END && it.value.spec?.widget instanceof CalloutWidget) {
        found = true;
      }
      it.next();
    }
    return found;
  }

  it("plain-line cursor move does NOT rebuild (same field value reference)", async () => {
    // Start on a plain tail line (line 7, char 40), far from the block annotation.
    const view = await makeView(40);
    try {
      const before = view.state.field(annotationBlockDecorationField);
      // Move to another plain line (line 8, char 55) — neither old nor new line
      // touches the block annotation, so the field must skip the rebuild.
      view.dispatch({ selection: { anchor: 55 } });
      const after = view.state.field(annotationBlockDecorationField);
      expect(after).toBe(before);
    } finally {
      view.destroy();
    }
  });

  it("moving the cursor ONTO a block-annotation line rebuilds and suppresses the callout", async () => {
    const view = await makeView(40); // plain line 7
    try {
      expect(hasCallout(view.state.field(annotationBlockDecorationField).decorations)).toBe(true);
      // Move onto line 4 (char 20), inside the block annotation.
      view.dispatch({ selection: { anchor: 20 } });
      expect(hasCallout(view.state.field(annotationBlockDecorationField).decorations)).toBe(false);
    } finally {
      view.destroy();
    }
  });

  it("moving the cursor OFF a block-annotation line rebuilds and restores the callout", async () => {
    const view = await makeView(20); // inside block (line 4)
    try {
      expect(hasCallout(view.state.field(annotationBlockDecorationField).decorations)).toBe(false);
      // Move to a plain tail line (line 7, char 40).
      view.dispatch({ selection: { anchor: 40 } });
      expect(hasCallout(view.state.field(annotationBlockDecorationField).decorations)).toBe(true);
    } finally {
      view.destroy();
    }
  });

  it("blockSensitiveLines tracks all annotation lines even when cursor suppresses the decoration", async () => {
    // Cursor ON the block annotation (line 4, char 20) — isCursorOnLine
    // suppresses the callout decoration. blockSensitiveLines must still
    // contain all lines spanned by the annotation. If someone reorders the
    // line-tracking code to run AFTER the isCursorOnLine early-return, this
    // test breaks.
    const view = await makeView(20); // inside block (line 4)
    try {
      const { blockSensitiveLines, decorations } = view.state.field(annotationBlockDecorationField);
      // Decoration is suppressed (cursor on annotation line).
      expect(hasCallout(decorations)).toBe(false);
      // But all lines spanned by the block annotation (lines 3-5) are tracked.
      const startLine = view.state.doc.lineAt(BLOCK_START).number;
      const endLine = view.state.doc.lineAt(BLOCK_END).number;
      for (let l = startLine; l <= endLine; l++) {
        expect(blockSensitiveLines.has(l)).toBe(true);
      }
    } finally {
      view.destroy();
    }
  });
});

describe("surgical path eligibility guards", () => {
  function makeView(doc: string, anchor: number) {
    const state = EditorState.create({
      doc,
      selection: { anchor },
      extensions: [
        markdown({ extensions: [CommentGrammar, AnnotationGrammar] }),
        annotationDataField,
        displayModeField,
        annotationFoldField,
        threadTurnField,
        firingAnnotationsField,
        llmLockedField,
        annotationBlockDecorationField,
      ],
    });
    const view = new EditorView({ state, parent: document.createElement("div") });
    ensureSyntaxTree(view.state, view.state.doc.length);
    return view;
  }

  function decoCount(view: EditorView): number {
    let count = 0;
    const iter = view.state.field(annotationBlockDecorationField).decorations.iter();
    while (iter.value) { count++; iter.next(); }
    return count;
  }

  function hasDecoAt(view: EditorView, from: number): boolean {
    const iter = view.state.field(annotationBlockDecorationField).decorations.iter();
    while (iter.value) {
      if (iter.from === from) return true;
      iter.next();
    }
    return false;
  }

  it("fold on a single-line annotation does not create a block deco", () => {
    const doc = "first line\n<!---single-line--->\ntail";
    const view = makeView(doc, 0);
    const ann = makeAnnotation({
      char_start: 11,
      char_end: 31,
      original: "<!---single-line--->",
    });
    view.dispatch({ effects: setAnnotationData.of([ann]) });
    expect(decoCount(view)).toBe(0);

    view.dispatch({ effects: toggleAnnotationFoldEffect.of({ pos: 11 }) });
    expect(decoCount(view)).toBe(0);

    view.destroy();
  });

  it("fold on a cursor-suppressed position does not invent a deco", () => {
    const doc = "first line\n\n<!---\nbody\n--->\ntail";
    const view = makeView(doc, 0);
    const blocks: Array<{ from: number; to: number }> = [];
    syntaxTree(view.state).iterate({
      enter: (node) => {
        if (node.name === "BlockAnnotation") blocks.push({ from: node.from, to: node.to });
      },
    });
    expect(blocks.length).toBe(1);
    const b = blocks[0]!;
    const ann = makeAnnotation({ form: "block", char_start: b.from, char_end: b.to, original: doc.slice(b.from, b.to) });
    view.dispatch({ effects: setAnnotationData.of([ann]) });

    view.dispatch({ selection: { anchor: b.from + 2 } });
    expect(hasDecoAt(view, b.from)).toBe(false);

    view.dispatch({ effects: toggleAnnotationFoldEffect.of({ pos: b.from }) });
    expect(hasDecoAt(view, b.from)).toBe(false);

    view.dispatch({ selection: { anchor: doc.length - 1 } });
    expect(hasDecoAt(view, b.from)).toBe(true);
    const iter = view.state.field(annotationBlockDecorationField).decorations.iter();
    while (iter.value) {
      if (iter.from === b.from) {
        expect((iter.value.spec?.widget as CalloutWidget).isCollapsed).toBe(true);
      }
      iter.next();
    }

    view.destroy();
  });
});

describe("fold/turn + selection in one transaction", () => {
  const DOC = "first line\n\n<!---\nbody A\n--->\nmiddle\n\n<!---\nbody B\n--->\ntail";

  function makeViewWithBlocks(anchor: number) {
    const state = EditorState.create({
      doc: DOC,
      selection: { anchor },
      extensions: [
        markdown({ extensions: [CommentGrammar, AnnotationGrammar] }),
        annotationDataField,
        displayModeField,
        annotationFoldField,
        threadTurnField,
        firingAnnotationsField,
        llmLockedField,
        annotationBlockDecorationField,
      ],
    });
    const view = new EditorView({ state, parent: document.createElement("div") });
    ensureSyntaxTree(view.state, view.state.doc.length);
    const blocks: Array<{ from: number; to: number }> = [];
    syntaxTree(view.state).iterate({
      enter: (node) => {
        if (node.name === "BlockAnnotation") blocks.push({ from: node.from, to: node.to });
      },
    });
    expect(blocks.length).toBe(2);
    const annotations = blocks.map((b) =>
      makeAnnotation({
        form: "block",
        char_start: b.from,
        char_end: b.to,
        original: DOC.slice(b.from, b.to),
      }),
    );
    view.dispatch({ effects: setAnnotationData.of(annotations) });
    return { view, A: blocks[0]!, B: blocks[1]! };
  }

  function hasDecoAt(view: EditorView, from: number): boolean {
    const iter = view.state.field(annotationBlockDecorationField).decorations.iter();
    while (iter.value) {
      if (iter.from === from) return true;
      iter.next();
    }
    return false;
  }

  function isCollapsedAt(view: EditorView, from: number): boolean {
    const iter = view.state.field(annotationBlockDecorationField).decorations.iter();
    while (iter.value) {
      if (iter.from === from) {
        const w = iter.value.spec?.widget;
        return w instanceof CalloutWidget && w.isCollapsed;
      }
      iter.next();
    }
    return false;
  }

  it("fold A + selection into B: A collapsed, B suppressed", () => {
    const { view, A, B } = makeViewWithBlocks(0);
    try {
      expect(hasDecoAt(view, A.from)).toBe(true);
      expect(hasDecoAt(view, B.from)).toBe(true);

      view.dispatch({
        effects: toggleAnnotationFoldEffect.of({ pos: A.from }),
        selection: { anchor: B.from + 2 },
      });

      expect(isCollapsedAt(view, A.from)).toBe(true);
      expect(hasDecoAt(view, B.from)).toBe(false);
    } finally {
      view.destroy();
    }
  });

  it("cursor inside B, fold A + selection to plain: B restored, A collapsed", () => {
    const { view, A, B } = makeViewWithBlocks(DOC.length - 1);
    try {
      view.dispatch({ selection: { anchor: B.from + 2 } });
      expect(hasDecoAt(view, B.from)).toBe(false);

      view.dispatch({
        effects: toggleAnnotationFoldEffect.of({ pos: A.from }),
        selection: { anchor: 0 },
      });

      expect(hasDecoAt(view, B.from)).toBe(true);
      expect(isCollapsedAt(view, A.from)).toBe(true);
    } finally {
      view.destroy();
    }
  });

  it("cursor plain->plain with fold: fold still applied", () => {
    const { view, A, B } = makeViewWithBlocks(0);
    try {
      view.dispatch({
        effects: toggleAnnotationFoldEffect.of({ pos: A.from }),
        selection: { anchor: DOC.length - 1 },
      });

      expect(isCollapsedAt(view, A.from)).toBe(true);
      expect(hasDecoAt(view, B.from)).toBe(true);
    } finally {
      view.destroy();
    }
  });
});

describe("setAllAnnotationFoldsEffect surgical path", () => {
  const DOC = "first line\n\n<!---\nbody A\n--->\nmiddle\n\n<!---\nbody B\n--->\ntail";

  function makeViewWithBlocks(anchor: number) {
    const state = EditorState.create({
      doc: DOC,
      selection: { anchor },
      extensions: [
        markdown({ extensions: [CommentGrammar, AnnotationGrammar] }),
        annotationDataField,
        displayModeField,
        annotationFoldField,
        threadTurnField,
        firingAnnotationsField,
        llmLockedField,
        annotationBlockDecorationField,
      ],
    });
    const view = new EditorView({ state, parent: document.createElement("div") });
    ensureSyntaxTree(view.state, view.state.doc.length);
    const blocks: Array<{ from: number; to: number }> = [];
    syntaxTree(view.state).iterate({
      enter: (node) => {
        if (node.name === "BlockAnnotation") blocks.push({ from: node.from, to: node.to });
      },
    });
    expect(blocks.length).toBe(2);
    const annotations = blocks.map((b) =>
      makeAnnotation({
        form: "block",
        char_start: b.from,
        char_end: b.to,
        original: DOC.slice(b.from, b.to),
      }),
    );
    view.dispatch({ effects: setAnnotationData.of(annotations) });
    return { view, A: blocks[0]!, B: blocks[1]! };
  }

  function isCollapsedAt(view: EditorView, from: number): boolean | undefined {
    const iter = view.state.field(annotationBlockDecorationField).decorations.iter();
    while (iter.value) {
      if (iter.from === from) {
        const w = iter.value.spec?.widget;
        if (w instanceof CalloutWidget) return w.isCollapsed;
      }
      iter.next();
    }
    return undefined;
  }

  function hasDecoAt(view: EditorView, from: number): boolean {
    const iter = view.state.field(annotationBlockDecorationField).decorations.iter();
    while (iter.value) {
      if (iter.from === from) return true;
      iter.next();
    }
    return false;
  }

  it("C1: fold-all flips isCollapsed on both block widgets via the surgical path", () => {
    const { view, A, B } = makeViewWithBlocks(0);
    try {
      expect(isCollapsedAt(view, A.from)).toBe(false);
      expect(isCollapsedAt(view, B.from)).toBe(false);

      view.dispatch({
        effects: setAllAnnotationFoldsEffect.of({
          positions: [A.from, B.from],
          collapsed: true,
        }),
      });

      expect(isCollapsedAt(view, A.from)).toBe(true);
      expect(isCollapsedAt(view, B.from)).toBe(true);
    } finally {
      view.destroy();
    }
  });

  it("C2: fold-all with cursor on one block: that block suppressed, other flips", () => {
    const { view, A, B } = makeViewWithBlocks(0);
    try {
      view.dispatch({ selection: { anchor: A.from + 2 } });
      expect(hasDecoAt(view, A.from)).toBe(false);

      view.dispatch({
        effects: setAllAnnotationFoldsEffect.of({
          positions: [A.from, B.from],
          collapsed: true,
        }),
      });

      expect(hasDecoAt(view, A.from)).toBe(false);
      expect(isCollapsedAt(view, B.from)).toBe(true);

      const foldMap = view.state.field(annotationFoldField);
      expect(foldMap.get(A.from)).toBe(true);
      expect(foldMap.get(B.from)).toBe(true);
    } finally {
      view.destroy();
    }
  });

  it("C3: fold-all + selection change in same transaction takes full-rebuild path", () => {
    const { view, A, B } = makeViewWithBlocks(0);
    try {
      view.dispatch({
        effects: setAllAnnotationFoldsEffect.of({
          positions: [A.from, B.from],
          collapsed: true,
        }),
        selection: { anchor: DOC.length - 1 },
      });

      expect(isCollapsedAt(view, A.from)).toBe(true);
      expect(isCollapsedAt(view, B.from)).toBe(true);
    } finally {
      view.destroy();
    }
  });

  it("C4: empty setAll positions preserves block decoration identity", () => {
    const { view } = makeViewWithBlocks(0);
    try {
      const before = view.state.field(annotationBlockDecorationField);

      view.dispatch({
        effects: setAllAnnotationFoldsEffect.of({
          positions: [],
          collapsed: true,
        }),
      });

      expect(view.state.field(annotationBlockDecorationField)).toBe(before);
    } finally {
      view.destroy();
    }
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

  it("does not dispatch on destroyed view when microtask fires after destroy", async () => {
    useModalLockStore.setState({ llmLocked: true });
    const view = new EditorView({
      state: EditorState.create({ doc: "x", extensions: [annotationExtension()] }),
      parent: document.createElement("div"),
    });
    view.destroy();
    await new Promise<void>((r) => queueMicrotask(r));
    // If the destroyed guard is missing, dispatching on a destroyed view would crash.
    // The test passes without throwing.
  });
});

describe("buildAnnotationBlockDecorations thread routing", () => {
  function makeView(doc: string, cursorPos = 0) {
    const state = EditorState.create({
      doc,
      selection: { anchor: cursorPos },
      extensions: [
        markdown({ extensions: [CommentGrammar, AnnotationGrammar] }),
        annotationDataField,
        displayModeField,
        annotationFoldField,
        threadTurnField,
        firingAnnotationsField,
        llmLockedField,
        annotationBlockDecorationField,
      ],
    });
    const view = new EditorView({ state, parent: document.createElement("div") });
    ensureSyntaxTree(view.state, view.state.doc.length);
    return view;
  }

  function iterateSet(set: DecorationSet) {
    const out: { from: number; to: number; widget: unknown }[] = [];
    const iter = set.iter();
    while (iter.value) {
      out.push({ from: iter.from, to: iter.to, widget: iter.value.spec?.widget });
      iter.next();
    }
    return out;
  }

  const THREAD_BODY = "[q]: First?\n\nFirst answer.\n\n[q]: Second?\n\nSecond answer.";

  it("routes a multiline thread annotation to a ThreadWidget", () => {
    const doc = "text\n\n<!---\nth\n---\nbody line\n--->\nafter";
    const from = 6;
    const to = doc.indexOf("--->") + 4;
    const view = makeView(doc, doc.length - 1);
    const ann = makeAnnotation({
      form: "block",
      annotation_type: "thread",
      body: THREAD_BODY,
      char_start: from,
      char_end: to,
      original: doc.slice(from, to),
    });
    view.dispatch({ effects: setAnnotationData.of([ann]) });

    const found = iterateSet(view.state.field(annotationBlockDecorationField).decorations).find(
      (d) => d.from === from && d.to === to,
    );
    expect(found).toBeTruthy();
    expect(found!.widget).toBeInstanceOf(ThreadWidget);
    view.destroy();
  });

  it("routes a non-thread multiline annotation to a CalloutWidget", () => {
    const doc = "text\n\n<!---\nn\n---\nbody line\n--->\nafter";
    const from = 6;
    const to = doc.indexOf("--->") + 4;
    const view = makeView(doc, doc.length - 1);
    const ann = makeAnnotation({
      form: "block",
      annotation_type: "note",
      char_start: from,
      char_end: to,
      original: doc.slice(from, to),
    });
    view.dispatch({ effects: setAnnotationData.of([ann]) });

    const found = iterateSet(view.state.field(annotationBlockDecorationField).decorations).find(
      (d) => d.from === from && d.to === to,
    );
    expect(found).toBeTruthy();
    expect(found!.widget).toBeInstanceOf(CalloutWidget);
    expect(found!.widget).not.toBeInstanceOf(ThreadWidget);
    view.destroy();
  });

  it("ThreadWidget receives the current turn index from threadTurnField", () => {
    const doc = "text\n\n<!---\nth\n---\nbody line\n--->\nafter";
    const from = 6;
    const to = doc.indexOf("--->") + 4;
    const view = makeView(doc, doc.length - 1);
    const ann = makeAnnotation({
      form: "block",
      annotation_type: "thread",
      body: THREAD_BODY,
      char_start: from,
      char_end: to,
      original: doc.slice(from, to),
    });
    view.dispatch({ effects: setAnnotationData.of([ann]) });
    view.dispatch({ effects: setThreadTurnEffect.of({ pos: from, turn: 1 }) });

    const found = iterateSet(view.state.field(annotationBlockDecorationField).decorations).find(
      (d) => d.from === from && d.to === to,
    );
    expect((found!.widget as ThreadWidget).turn).toBe(1);
    view.destroy();
  });
});

describe("surgical gate hardening (Phase 3)", () => {
  it("fold bundled with a tree-changing reconfigure does not keep a stale block deco", () => {
    const langCompartment = new Compartment();
    const doc = "first line\n\n<!---\nbody\n--->\nafter";
    const state = EditorState.create({
      doc,
      selection: { anchor: doc.length - 1 },
      extensions: [
        langCompartment.of(markdown({ extensions: [CommentGrammar, AnnotationGrammar] })),
        annotationDataField,
        displayModeField,
        annotationFoldField,
        threadTurnField,
        firingAnnotationsField,
        llmLockedField,
        annotationBlockDecorationField,
      ],
    });
    const view = new EditorView({ state, parent: document.createElement("div") });
    ensureSyntaxTree(view.state, view.state.doc.length);

    const blocks: Array<{ from: number; to: number }> = [];
    syntaxTree(view.state).iterate({
      enter: (node) => {
        if (node.name === "BlockAnnotation") blocks.push({ from: node.from, to: node.to });
      },
    });
    expect(blocks.length).toBe(1);
    const b = blocks[0]!;
    const ann = makeAnnotation({ form: "block", char_start: b.from, char_end: b.to, original: doc.slice(b.from, b.to) });
    view.dispatch({ effects: setAnnotationData.of(ann ? [ann] : []) });

    expect(view.state.field(annotationBlockDecorationField).decorations.size).toBe(1);

    view.dispatch({
      effects: [
        toggleAnnotationFoldEffect.of({ pos: b.from }),
        langCompartment.reconfigure(markdown()),
      ],
    });

    expect(view.state.field(annotationBlockDecorationField).decorations.size).toBe(0);

    view.destroy();
  });
});

describe("blockSensitiveLines parity (Phase 2)", () => {
  it("stale unwitnessed span does not mark lines cursor-sensitive", () => {
    const doc = "first line\nsecond line\nthird line\nfourth line";
    const state = EditorState.create({
      doc,
      selection: { anchor: 0 },
      extensions: [
        markdown({ extensions: [CommentGrammar, AnnotationGrammar] }),
        annotationDataField,
        displayModeField,
        annotationFoldField,
        threadTurnField,
        firingAnnotationsField,
        llmLockedField,
        annotationBlockDecorationField,
      ],
    });
    const view = new EditorView({ state, parent: document.createElement("div") });
    ensureSyntaxTree(view.state, view.state.doc.length);

    const ann = makeAnnotation({
      form: "block",
      char_start: 0,
      char_end: 22,
      body: "stale data",
      original: "no real annotation here",
    });
    view.dispatch({ effects: setAnnotationData.of([ann]) });

    const fieldBefore = view.state.field(annotationBlockDecorationField);

    view.dispatch({ selection: { anchor: 15 } });

    expect(view.state.field(annotationBlockDecorationField)).toBe(fieldBefore);

    view.destroy();
  });
});

describe("exact-span correctness (Phase 1)", () => {
  function makeView(doc: string, cursorPos = 0) {
    const state = EditorState.create({
      doc,
      selection: { anchor: cursorPos },
      extensions: [
        markdown({ extensions: [CommentGrammar, AnnotationGrammar] }),
        annotationDataField,
        displayModeField,
        annotationFoldField,
        threadTurnField,
        firingAnnotationsField,
        llmLockedField,
        annotationBlockDecorationField,
      ],
    });
    const view = new EditorView({ state, parent: document.createElement("div") });
    ensureSyntaxTree(view.state, view.state.doc.length);
    return view;
  }

  it("full build emits one decoration for duplicate exact spans, first-match-wins", () => {
    const doc = "first line\n\n<!---\nbody first\n--->\nafter";
    const view = makeView(doc, doc.length - 1);
    const blocks: Array<{ from: number; to: number }> = [];
    syntaxTree(view.state).iterate({
      enter: (node) => {
        if (node.name === "BlockAnnotation") blocks.push({ from: node.from, to: node.to });
      },
    });
    expect(blocks.length).toBe(1);
    const b = blocks[0]!;

    const annA = makeAnnotation({ form: "block", char_start: b.from, char_end: b.to, body: "first", original: doc.slice(b.from, b.to) });
    const annB = makeAnnotation({ form: "block", char_start: b.from, char_end: b.to, body: "second", original: doc.slice(b.from, b.to) });
    view.dispatch({ effects: setAnnotationData.of([annA, annB]) });

    const decos = view.state.field(annotationBlockDecorationField).decorations;
    expect(decos.size).toBe(1);
    const iter = decos.iter();
    expect(iter.value).toBeTruthy();
    const widget = iter.value!.spec.widget as CalloutWidget;
    expect(widget.annotation.body).toBe("first");

    view.destroy();
  });

  it("surgical fold retains the exact existing span when a same-start different-end annotation shadows it", () => {
    const doc = "first line\n\n<!---\nbody content here\n--->\nafter";
    const view = makeView(doc, doc.length - 1);
    const blocks: Array<{ from: number; to: number }> = [];
    syntaxTree(view.state).iterate({
      enter: (node) => {
        if (node.name === "BlockAnnotation") blocks.push({ from: node.from, to: node.to });
      },
    });
    expect(blocks.length).toBe(1);
    const b = blocks[0]!;

    const annA = makeAnnotation({ form: "block", char_start: b.from, char_end: b.to, body: "correct", original: doc.slice(b.from, b.to) });
    const annB = makeAnnotation({ form: "block", char_start: b.from, char_end: b.to - 1, body: "wrong", original: "shorter" });
    view.dispatch({ effects: setAnnotationData.of([annA, annB]) });

    const decoBefore = view.state.field(annotationBlockDecorationField).decorations;
    expect(decoBefore.size).toBe(1);
    const iterBefore = decoBefore.iter();
    expect(iterBefore.from).toBe(b.from);
    expect(iterBefore.to).toBe(b.to);

    view.dispatch({ effects: toggleAnnotationFoldEffect.of({ pos: b.from }) });

    const decoAfter = view.state.field(annotationBlockDecorationField).decorations;
    expect(decoAfter.size).toBe(1);
    const iterAfter = decoAfter.iter();
    expect(iterAfter.from).toBe(b.from);
    expect(iterAfter.to).toBe(b.to);
    const widget = iterAfter.value!.spec.widget as CalloutWidget;
    expect(widget.isCollapsed).toBe(true);
    expect(widget.annotation.body).toBe("correct");

    view.destroy();
  });
});
