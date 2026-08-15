import { describe, it, expect, vi, beforeEach } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import {
  handleAnnotationHover,
  handleAnnotationLeave,
} from "./annotationHover";
import { scopeHighlightField, setScopeHighlight } from "./scopeHighlight";
import { PillWidget } from "./annotationWidgets";
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
    view.dispatch({ effects: setScopeHighlight.of({ from: 0, to: 5 }) });
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

  // --- multi-annotation hover sequencing (issue #1028) ---

  function highlightRange(view: EditorView): { from: number; to: number } | null {
    const decos = view.state.field(scopeHighlightField);
    const iter = decos.iter();
    if (!iter.value) return null;
    return { from: iter.from, to: iter.to };
  }

  it("sequential hover of ann1 then ann2 keeps ann2's highlight", async () => {
    usePreferencesStore.setState({ annotationDefaultLang: "en" });
    const view = makeView();
    mockResolve
      .mockResolvedValueOnce({ start: 0, end: 5 })
      .mockResolvedValueOnce({ start: 20, end: 24 });

    await handleAnnotationHover(view, makeAnnotation({ char_start: 6, char_end: 11 }));
    expect(highlightRange(view)).toEqual({ from: 0, to: 5 });

    handleAnnotationLeave(view);
    expect(highlightRange(view)).toBeNull();

    await handleAnnotationHover(view, makeAnnotation({ char_start: 20, char_end: 24 }));
    expect(highlightRange(view)).toEqual({ from: 20, to: 24 });
    view.destroy();
  });

  it("stale ann1 IPC cannot overwrite ann2's highlight", async () => {
    usePreferencesStore.setState({ annotationDefaultLang: "en" });
    const view = makeView();
    let resolveAnn1: (v: { start: number; end: number } | null) => void;
    mockResolve
      .mockReturnValueOnce(
        new Promise((res) => {
          resolveAnn1 = res;
        }),
      )
      .mockResolvedValueOnce({ start: 20, end: 24 });

    const promise1 = handleAnnotationHover(view, makeAnnotation({ char_start: 6, char_end: 11 }));
    await handleAnnotationHover(view, makeAnnotation({ char_start: 20, char_end: 24 }));
    resolveAnn1!({ start: 0, end: 5 });
    await promise1;

    expect(highlightRange(view)).toEqual({ from: 20, to: 24 });
    view.destroy();
  });

  it("hovering ann2 first (never hovered ann1) highlights ann2", async () => {
    usePreferencesStore.setState({ annotationDefaultLang: "en" });
    const view = makeView();
    mockResolve.mockResolvedValue({ start: 20, end: 24 });

    await handleAnnotationHover(view, makeAnnotation({ char_start: 20, char_end: 24 }));
    expect(highlightRange(view)).toEqual({ from: 20, to: 24 });
    view.destroy();
  });

  it("alt+hover on ann2 resolves via the bidirectional path", async () => {
    usePreferencesStore.setState({ annotationDefaultLang: "en" });
    const view = makeView();
    mockResolveWithMode.mockResolvedValue({ start: 20, end: 40 });

    await handleAnnotationHover(
      view,
      makeAnnotation({ char_start: 20, char_end: 24 }),
      { altKey: true },
    );
    expect(mockResolveWithMode).toHaveBeenCalledWith(
      "hello world",
      20,
      { kind: "words", value: 2 },
      "en",
      "bidirectional",
    );
    expect(highlightRange(view)).toEqual({ from: 20, to: 40 });
    view.destroy();
  });

  it("resolve IPC for ann2 receives ann2's own char_start and scope", async () => {
    usePreferencesStore.setState({ annotationDefaultLang: "en" });
    const view = makeView();
    const ann2 = makeAnnotation({
      char_start: 20,
      char_end: 24,
      scope: { kind: "anchor", value: "beta" },
    });
    mockResolve.mockResolvedValue({ start: 20, end: 24 });

    await handleAnnotationHover(view, ann2);
    expect(mockResolve).toHaveBeenCalledWith(
      "hello world",
      20,
      { kind: "anchor", value: "beta" },
      "en",
    );
    view.destroy();
  });

  // #1028 H1: browsers can fire the new widget's mouseenter before the old
  // widget's mouseleave (sibling move, or a destroy-driven leave from the
  // previous pill). The stale leave must not discard the newer hover's
  // in-flight resolve — only the leave for the annotation that is actually
  // being hovered may invalidate/clear.
  it("leave from a previous annotation does not discard the newer hover's resolve", async () => {
    usePreferencesStore.setState({ annotationDefaultLang: "en" });
    const view = makeView();
    let resolveAnn2: (v: { start: number; end: number } | null) => void;
    mockResolve.mockReturnValueOnce(
      new Promise((res) => {
        resolveAnn2 = res;
      }),
    );

    const ann1 = makeAnnotation({ char_start: 6, char_end: 11 });
    const ann2 = makeAnnotation({ char_start: 20, char_end: 24 });
    const promise2 = handleAnnotationHover(view, ann2);
    // The pointer left ann1's widget AFTER entering ann2's (enter-before-leave).
    handleAnnotationLeave(view, ann1);

    resolveAnn2!({ start: 20, end: 24 });
    await promise2;

    expect(highlightRange(view)).toEqual({ from: 20, to: 24 });
    view.destroy();
  });

  it("after leaving the active ann, leave for another ann still clears highlight", async () => {
    usePreferencesStore.setState({ annotationDefaultLang: "en" });
    const view = makeView();
    const ann1 = makeAnnotation({ char_start: 6, char_end: 11 });
    const ann2 = makeAnnotation({ char_start: 20, char_end: 24 });
    mockResolve.mockResolvedValue({ start: 0, end: 5 });

    await handleAnnotationHover(view, ann1);
    expect(highlightRange(view)).toEqual({ from: 0, to: 5 });

    handleAnnotationLeave(view, ann1);
    expect(highlightRange(view)).toBeNull();

    // Simulate a stuck decoration that did not go through hover (or a future
    // caller). Leave for a different ann must not early-return on a stale
    // activeKey still equal to ann1.
    view.dispatch({ effects: setScopeHighlight.of({ from: 0, to: 5 }) });
    expect(highlightRange(view)).toEqual({ from: 0, to: 5 });

    handleAnnotationLeave(view, ann2);
    expect(highlightRange(view)).toBeNull();
    view.destroy();
  });

  it("leave for the actively hovered annotation still clears and cancels its resolve", async () => {
    usePreferencesStore.setState({ annotationDefaultLang: "en" });
    const view = makeView();
    let resolveAnn2: (v: { start: number; end: number } | null) => void;
    mockResolve.mockReturnValueOnce(
      new Promise((res) => {
        resolveAnn2 = res;
      }),
    );

    const ann2 = makeAnnotation({ char_start: 20, char_end: 24 });
    const promise2 = handleAnnotationHover(view, ann2);
    handleAnnotationLeave(view, ann2);
    resolveAnn2!({ start: 20, end: 24 });
    await promise2;

    expect(highlightRange(view)).toBeNull();
    view.destroy();
  });

  // --- widget wiring (T4): real PillWidgets -> real hover module ---

  it("stale sibling-pill mouseleave does not clear the hovered pill's highlight", async () => {
    usePreferencesStore.setState({ annotationDefaultLang: "en" });
    const state = EditorState.create({
      doc: "hello world",
      extensions: [scopeHighlightField],
    });
    const view = new EditorView({ state, parent: document.createElement("div") });

    const ann1 = makeAnnotation({ char_start: 0, char_end: 10, body: "alpha" });
    const ann2 = makeAnnotation({ char_start: 12, char_end: 22, body: "beta" });
    const pill1 = new PillWidget(ann1).toDOM(view);
    const pill2 = new PillWidget(ann2).toDOM(view);

    mockResolve.mockResolvedValue({ start: 15, end: 19 });
    pill2.dispatchEvent(new Event("mouseenter"));
    await Promise.resolve();
    expect(highlightRange(view)).toEqual({ from: 15, to: 19 });

    // The pointer left ann1's widget after entering ann2's (enter-before-leave).
    pill1.dispatchEvent(new Event("mouseleave"));
    expect(highlightRange(view)).toEqual({ from: 15, to: 19 });

    // A real leave of the hovered pill still clears.
    pill2.dispatchEvent(new Event("mouseleave"));
    expect(highlightRange(view)).toBeNull();
    view.destroy();
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
