import { describe, it, expect, vi, beforeEach } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import {
  handleAnnotationHover,
  handleAnnotationLeave,
} from "./annotationHover";
import { scopeHighlightField, setScopeHighlight } from "./scopeHighlight";
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

function makeView(doc = "hello world"): EditorView {
  const state = EditorState.create({
    doc,
    extensions: [scopeHighlightField],
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
});
