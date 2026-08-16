import { describe, it, expect, vi, beforeEach } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import {
  handleAnnotationHover,
  handleAnnotationLeave,
} from "./annotationHover";
import { scopeHighlightField, setScopeHighlight } from "./scopeHighlight";
import { annotationDataField, setAnnotationData } from "./annotationState";
import { frontmatterFacet } from "./crossref";
import { Decoration } from "@codemirror/view";
import type { Annotation } from "../../lib/ipc";
import { usePreferencesStore } from "../../stores/preferences";

vi.mock("../../lib/ipc", () => ({
  parseAnnotations: vi.fn(async () => []),
  resolveAnnotationScope: vi.fn(),
  resolveAnnotationScopeWithMode: vi.fn(),
}));

import { resolveAnnotationScope, resolveAnnotationScopeWithMode } from "../../lib/ipc";
const mockResolve = resolveAnnotationScope as ReturnType<typeof vi.fn>;
const mockResolveWithMode = resolveAnnotationScopeWithMode as ReturnType<typeof vi.fn>;

function makeView(
  doc = "hello world",
  frontmatter?: Record<string, unknown>,
): EditorView {
  const state = EditorState.create({
    doc,
    extensions: [
      scopeHighlightField,
      ...(frontmatter ? [frontmatterFacet.of(frontmatter)] : []),
    ],
  });
  return new EditorView({ state, parent: document.createElement("div") });
}

function makeHoverView(
  doc = "hello world",
  annotations: Annotation[] = [],
  frontmatter?: Record<string, unknown>,
): EditorView {
  const state = EditorState.create({
    doc,
    extensions: [
      scopeHighlightField,
      annotationDataField,
      ...(frontmatter ? [frontmatterFacet.of(frontmatter)] : []),
    ],
  });
  const view = new EditorView({ state, parent: document.createElement("div") });
  if (annotations.length > 0) {
    view.dispatch({ effects: setAnnotationData.of(annotations) });
  }
  return view;
}

function fieldRanges(view: EditorView): Array<{ from: number; to: number }> {
  const ranges: Array<{ from: number; to: number }> = [];
  view.state
    .field(scopeHighlightField)
    .between(0, view.state.doc.length, (from, to) => {
      ranges.push({ from, to });
    });
  return ranges;
}

function makeAnnotation(overrides: Partial<Annotation> = {}): Annotation {
  return {
    form: "compact",
    annotation_type: "note",
    certainty: "neutral",
    scope: { kind: "words", value: 2 },
    body: "test",
    date: null,
    is_structured: true,
    char_start: 6,
    char_end: 11,
    original: "<!--- n --->",
    ...overrides,
  };
}

describe("annotationHover", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    usePreferencesStore.setState({ annotationScopeHighlight: true });
  });

  it("handleAnnotationHover calls IPC with lang from preferences and dispatches highlight", async () => {
    usePreferencesStore.setState({ annotationDefaultLang: "zh" });
    const view = makeView();
    mockResolve.mockResolvedValue({ start: 0, end: 5 });

    await handleAnnotationHover(view, makeAnnotation());

    expect(mockResolve).toHaveBeenCalledWith(
      "hello world",
      6,
      { kind: "words", value: 2 },
      "zh",
    );
    const decos = view.state.field(scopeHighlightField);
    const iter = decos.iter();
    expect(iter.from).toBe(0);
    expect(iter.to).toBe(5);
    view.destroy();
  });

  it("stale IPC response is discarded when generation advances", async () => {
    usePreferencesStore.setState({ annotationDefaultLang: "en" });
    const view = makeView();
    let resolvePromise: (v: { start: number; end: number } | null) => void;
    mockResolve.mockReturnValue(
      new Promise((res) => {
        resolvePromise = res;
      }),
    );

    const promise = handleAnnotationHover(view, makeAnnotation());
    handleAnnotationLeave(view);
    resolvePromise!({ start: 0, end: 5 });
    await promise;

    expect(view.state.field(scopeHighlightField)).toBe(Decoration.none);
    view.destroy();
  });

  it("handleAnnotationLeave clears highlight", () => {
    const view = makeView();
    view.dispatch({ effects: setScopeHighlight.of([{ from: 0, to: 5 }]) });
    handleAnnotationLeave(view);
    expect(view.state.field(scopeHighlightField)).toBe(Decoration.none);
    view.destroy();
  });

  it("IPC returning null does not dispatch", async () => {
    usePreferencesStore.setState({ annotationDefaultLang: "en" });
    const view = makeView();
    mockResolve.mockResolvedValue(null);

    await handleAnnotationHover(view, makeAnnotation());

    expect(view.state.field(scopeHighlightField)).toBe(Decoration.none);
    view.destroy();
  });

  it("IPC rejection does not throw and leaves highlight unchanged", async () => {
    usePreferencesStore.setState({ annotationDefaultLang: "en" });
    const view = makeView();
    mockResolve.mockRejectedValue(new Error("IPC channel closed"));

    await handleAnnotationHover(view, makeAnnotation());

    expect(view.state.field(scopeHighlightField)).toBe(Decoration.none);
    view.destroy();
  });

  it("annotationScopeHighlight=false skips IPC and highlight dispatch", async () => {
    usePreferencesStore.setState({ annotationDefaultLang: "en", annotationScopeHighlight: false });
    const view = makeView();
    mockResolve.mockResolvedValue({ start: 0, end: 5 });

    await handleAnnotationHover(view, makeAnnotation());

    expect(mockResolve).not.toHaveBeenCalled();
    expect(view.state.field(scopeHighlightField)).toBe(Decoration.none);
    view.destroy();
  });

  it("alt+hover calls resolveAnnotationScopeWithMode with bidirectional", async () => {
    usePreferencesStore.setState({ annotationDefaultLang: "en" });
    const view = makeView();
    mockResolveWithMode.mockResolvedValue({ start: 0, end: 11 });

    await handleAnnotationHover(view, makeAnnotation(), { altKey: true });

    expect(mockResolveWithMode).toHaveBeenCalledWith(
      "hello world",
      6,
      { kind: "words", value: 2 },
      "en",
      "bidirectional",
    );
    expect(mockResolve).not.toHaveBeenCalled();
    const decos = view.state.field(scopeHighlightField);
    const iter = decos.iter();
    expect(iter.from).toBe(0);
    expect(iter.to).toBe(11);
    view.destroy();
  });

  it("hover without altKey calls resolveAnnotationScope (backward)", async () => {
    usePreferencesStore.setState({ annotationDefaultLang: "en" });
    const view = makeView();
    mockResolve.mockResolvedValue({ start: 0, end: 5 });

    await handleAnnotationHover(view, makeAnnotation(), { altKey: false });

    expect(mockResolve).toHaveBeenCalled();
    expect(mockResolveWithMode).not.toHaveBeenCalled();
    view.destroy();
  });

  // --- Cycle 3: hover clips resolved range against annotation spans (#1028) ---

  it("fully-contained resolved range clips to no highlight", async () => {
    const view = makeHoverView("some doc text", [
      makeAnnotation({ char_start: 10, char_end: 40 }),
    ]);
    mockResolve.mockResolvedValue({ start: 12, end: 30 });

    await handleAnnotationHover(view, makeAnnotation({ char_start: 10, char_end: 40 }));

    expect(view.state.field(scopeHighlightField)).toBe(Decoration.none);
    view.destroy();
  });

  it("straddling resolved range clips into visible segments around the span", async () => {
    // "prefix " (7) + block (30) + " suffix" (7) = 44 chars
    const doc = "prefix " + "x".repeat(30) + " suffix";
    const view = makeHoverView(doc, [
      makeAnnotation({ char_start: 7, char_end: 37 }),
    ]);
    mockResolve.mockResolvedValue({ start: 0, end: 44 });

    await handleAnnotationHover(view, makeAnnotation({ char_start: 7, char_end: 37 }));

    expect(fieldRanges(view)).toEqual([
      { from: 0, to: 7 },
      { from: 37, to: 44 },
    ]);
    view.destroy();
  });

  it("hover with an annotation field but no spans keeps the single full range", async () => {
    const view = makeHoverView("hello world", []);
    mockResolve.mockResolvedValue({ start: 0, end: 5 });

    await handleAnnotationHover(view, makeAnnotation());

    expect(fieldRanges(view)).toEqual([{ from: 0, to: 5 }]);
    view.destroy();
  });

  it("hover without an annotation field keeps the single full range", async () => {
    const view = makeView();
    mockResolve.mockResolvedValue({ start: 0, end: 5 });

    await handleAnnotationHover(view, makeAnnotation());

    expect(fieldRanges(view)).toEqual([{ from: 0, to: 5 }]);
    view.destroy();
  });

  it("hovered annotation's own span is subtracted too", async () => {
    // "prefix " (7) + block1 (30) + " middle " (8) + block2 (20) + " suffix" (7)
    const doc = "prefix " + "x".repeat(30) + " middle " + "y".repeat(20) + " suffix";
    const view = makeHoverView(doc, [
      makeAnnotation({ char_start: 7, char_end: 37 }),
      makeAnnotation({ char_start: 45, char_end: 65 }),
    ]);
    mockResolve.mockResolvedValue({ start: 0, end: 72 });

    await handleAnnotationHover(view, makeAnnotation({ char_start: 7, char_end: 37 }));

    expect(fieldRanges(view)).toEqual([
      { from: 0, to: 7 },
      { from: 37, to: 45 },
      { from: 65, to: 72 },
    ]);
    view.destroy();
  });

  it("hover with no opts calls resolveAnnotationScope (backward)", async () => {
    usePreferencesStore.setState({ annotationDefaultLang: "en" });
    const view = makeView();
    mockResolve.mockResolvedValue({ start: 0, end: 5 });

    await handleAnnotationHover(view, makeAnnotation());

    expect(mockResolve).toHaveBeenCalled();
    expect(mockResolveWithMode).not.toHaveBeenCalled();
    view.destroy();
  });

  it("zero-width scope from IPC does not dispatch highlight", async () => {
    usePreferencesStore.setState({ annotationDefaultLang: "en" });
    const view = makeView();
    mockResolve.mockResolvedValue({ start: 5, end: 5 });

    await handleAnnotationHover(view, makeAnnotation());

    expect(view.state.field(scopeHighlightField)).toBe(Decoration.none);
    view.destroy();
  });

  it("inverted scope from IPC does not dispatch highlight", async () => {
    usePreferencesStore.setState({ annotationDefaultLang: "en" });
    const view = makeView();
    mockResolve.mockResolvedValue({ start: 8, end: 3 });

    await handleAnnotationHover(view, makeAnnotation());

    expect(view.state.field(scopeHighlightField)).toBe(Decoration.none);
    view.destroy();
  });

  it("hover in view A does not invalidate pending IPC for view B", async () => {
    usePreferencesStore.setState({ annotationDefaultLang: "en" });
    const viewA = makeView("aaaa bbbb");
    const viewB = makeView("cccc dddd");

    let resolveB: (v: { start: number; end: number } | null) => void;
    mockResolve
      .mockReturnValueOnce(
        new Promise((res) => {
          resolveB = res;
        }),
      )
      .mockResolvedValueOnce({ start: 0, end: 4 });

    const promiseB = handleAnnotationHover(viewB, makeAnnotation());
    await handleAnnotationHover(viewA, makeAnnotation());

    resolveB!({ start: 0, end: 4 });
    await promiseB;

    const decosA = viewA.state.field(scopeHighlightField);
    expect(decosA.iter().from).toBe(0);
    expect(decosA.iter().to).toBe(4);

    const decosB = viewB.state.field(scopeHighlightField);
    expect(decosB.iter().from).toBe(0);
    expect(decosB.iter().to).toBe(4);

    viewA.destroy();
    viewB.destroy();
  });

  // --- three-scope segmentation language (#854) ---

  it("an annotation's own lang beats the document and the preference", async () => {
    usePreferencesStore.setState({ annotationDefaultLang: "zh" });
    const view = makeView("hello world", { "annotation-lang": "ja" });
    mockResolve.mockResolvedValue({ start: 0, end: 5 });

    await handleAnnotationHover(view, makeAnnotation({ lang: "fr" }));

    expect(mockResolve).toHaveBeenCalledWith(
      "hello world",
      6,
      { kind: "words", value: 2 },
      "fr",
    );
    view.destroy();
  });

  it("document frontmatter beats the preference", async () => {
    usePreferencesStore.setState({ annotationDefaultLang: "zh" });
    const view = makeView("hello world", { lang: "fr-CA" });
    mockResolve.mockResolvedValue({ start: 0, end: 5 });

    await handleAnnotationHover(view, makeAnnotation());

    expect(mockResolve).toHaveBeenCalledWith(
      "hello world",
      6,
      { kind: "words", value: 2 },
      "fr",
    );
    view.destroy();
  });

  it("the alt-key bidirectional path resolves the same language", async () => {
    usePreferencesStore.setState({ annotationDefaultLang: "zh" });
    const view = makeView("hello world", { "annotation-lang": "fr" });
    mockResolveWithMode.mockResolvedValue({ start: 0, end: 5 });

    await handleAnnotationHover(view, makeAnnotation(), { altKey: true });

    expect(mockResolveWithMode).toHaveBeenCalledWith(
      "hello world",
      6,
      { kind: "words", value: 2 },
      "fr",
      "bidirectional",
    );
    view.destroy();
  });
});
