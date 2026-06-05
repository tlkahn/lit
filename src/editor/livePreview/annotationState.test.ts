import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView, type DecorationSet } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";
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
} from "./annotationState";
import {
  annotationFoldField,
  toggleAnnotationFoldEffect,
  PillWidget,
  CalloutWidget,
  MarkerWidget,
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

  function collectDecorations(view: EditorView) {
    const set = view.plugin(annotationDecorationPlugin)?.decorations;
    const result: { from: number; to: number; widget: unknown }[] = [];
    if (!set) return result;
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

  it("multi-line BlockAnnotation → CalloutWidget", () => {
    // Blank line needed so paragraph doesn't swallow the block annotation
    // BlockAnnotation at 12..23
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
    expect(found).toBeTruthy();
    expect(found!.widget).toBeInstanceOf(CalloutWidget);

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

  it("fold state → CalloutWidget receives isCollapsed=true", () => {
    const doc = "first line\n\n<!---\nbody\n--->\nafter";
    const view = makeAnnotationView(doc, 28);

    const ann = makeAnnotation({
      form: "block",
      char_start: 12,
      char_end: 27,
      original: "<!---\nbody\n--->",
    });

    view.dispatch({ effects: setAnnotationData.of([ann]) });
    view.dispatch({ effects: toggleAnnotationFoldEffect.of({ pos: 12 }) });

    const decos = collectDecorations(view);
    const found = decos.find((d) => d.from === 12 && d.to === 27);
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

  it("multi-line BlockAnnotation + mode 'footnote' → CalloutWidget (unchanged)", () => {
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
    const found = decos.find((d) => d.from === 12 && d.to === 27);
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
      ],
    });
    const view = new EditorView({ state, parent: document.createElement("div") });
    ensureSyntaxTree(view.state, view.state.doc.length);
    return view;
  }

  function getSet(view: EditorView): DecorationSet {
    return view.plugin(annotationDecorationPlugin)!.decorations;
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

  it("rebuilds on toggleAnnotationFoldEffect (Callout isCollapsed flips)", () => {
    const doc = "first line\n\n<!---\nbody\n--->\nafter";
    const view = makeView(doc, 28);
    const ann = makeAnnotation({ form: "block", char_start: 12, char_end: 27, original: "<!---\nbody\n--->" });
    view.dispatch({ effects: setAnnotationData.of([ann]) });

    const w1 = widgetAt(getSet(view), 12, 27);
    expect(w1).toBeInstanceOf(CalloutWidget);
    expect((w1 as CalloutWidget).isCollapsed).toBe(false);

    view.dispatch({ effects: toggleAnnotationFoldEffect.of({ pos: 12 }) });
    const w2 = widgetAt(getSet(view), 12, 27);
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

  it("multi-line BlockAnnotation → CalloutWidget", () => {
    const doc = "first line\n\n<!---\nbody\n--->\nafter";
    const view = makeView(doc, 28);
    const ann = makeAnnotation({ form: "block", char_start: 12, char_end: 27, original: "<!---\nbody\n--->" });
    view.dispatch({ effects: setAnnotationData.of([ann]) });

    const { decorations } = buildAnnotationDecorations(view);
    const found = iterateSet(decorations).find((d) => d.from === 12 && d.to === 27);
    expect(found).toBeTruthy();
    expect(found!.widget).toBeInstanceOf(CalloutWidget);
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

  it("fold state → CalloutWidget isCollapsed=true", () => {
    const doc = "first line\n\n<!---\nbody\n--->\nafter";
    const view = makeView(doc, 28);
    const ann = makeAnnotation({ form: "block", char_start: 12, char_end: 27, original: "<!---\nbody\n--->" });
    view.dispatch({ effects: setAnnotationData.of([ann]) });
    view.dispatch({ effects: toggleAnnotationFoldEffect.of({ pos: 12 }) });

    const { decorations } = buildAnnotationDecorations(view);
    const found = iterateSet(decorations).find((d) => d.from === 12 && d.to === 27);
    expect(found).toBeTruthy();
    expect(found!.widget).toBeInstanceOf(CalloutWidget);
    expect((found!.widget as CalloutWidget).isCollapsed).toBe(true);
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
  it("returns array with 13 extensions", () => {
    const ext = annotationExtension();
    expect(Array.isArray(ext)).toBe(true);
    expect((ext as unknown[]).length).toBe(13);
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
    const fieldSet = view.state.field(annotationBlockDecorationField);
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
