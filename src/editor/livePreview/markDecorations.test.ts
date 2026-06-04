import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EditorState } from "@codemirror/state";
import { Decoration, EditorView } from "@codemirror/view";
import type { Annotation } from "../../lib/ipc";
import { usePreferencesStore } from "../../stores/preferences";

vi.mock("../../lib/ipc", () => ({
  parseAnnotations: vi.fn(async () => []),
  resolveMarkScopes: vi.fn(),
  listAnnotations: vi.fn(async () => []),
}));

import { resolveMarkScopes } from "../../lib/ipc";
import {
  setMarkDecorations,
  markDecorationField,
  markDecorationExtension,
} from "./markDecorations";
import { setAnnotationData, annotationDataField } from "./annotationState";

const mockResolve = resolveMarkScopes as ReturnType<typeof vi.fn>;

function makeAnnotation(overrides: Partial<Annotation> = {}): Annotation {
  return {
    form: "compact",
    annotation_type: "mark",
    certainty: "neutral",
    scope: { kind: "words", value: 1 },
    body: null,
    date: null,
    is_structured: true,
    char_start: 4,
    char_end: 4,
    original: "<!--- nb _ --->",
    mark: "nb",
    ...overrides,
  };
}

/** Mount a real EditorView wired with the field + plugin and the data field it reads. */
function mountView(doc = "hello world"): { view: EditorView; parent: HTMLElement } {
  const parent = document.createElement("div");
  const view = new EditorView({
    state: EditorState.create({
      doc,
      extensions: [annotationDataField, markDecorationExtension()],
    }),
    parent,
  });
  return { view, parent };
}

/** Collect [from, to] pairs from a DecorationSet. */
function ranges(set: ReturnType<EditorState["field"]>): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  // @ts-expect-error DecorationSet at runtime
  const iter = set.iter();
  while (iter.value) {
    out.push([iter.from, iter.to]);
    iter.next();
  }
  return out;
}

describe("markDecorationField", () => {
  it("initial state is Decoration.none", () => {
    const state = EditorState.create({
      doc: "hello world",
      extensions: [markDecorationField],
    });
    expect(state.field(markDecorationField)).toBe(Decoration.none);
  });

  it("dispatching setMarkDecorations produces one mark range at the given position", () => {
    const state = EditorState.create({
      doc: "hello world",
      extensions: [markDecorationField],
    });
    const tr = state.update({
      effects: setMarkDecorations.of([{ from: 0, to: 5, code: "nb" }]),
    });
    const decos = tr.state.field(markDecorationField);
    expect(ranges(decos)).toEqual([[0, 5]]);
  });

  it("renders the cm-mark-{code} class in the DOM", () => {
    const parent = document.createElement("div");
    const view = new EditorView({
      state: EditorState.create({
        doc: "hello world",
        extensions: [markDecorationExtension()],
      }),
      parent,
    });
    view.dispatch({ effects: setMarkDecorations.of([{ from: 0, to: 5, code: "nb" }]) });
    expect(parent.querySelector(".cm-mark-nb")).not.toBeNull();
    view.destroy();
  });

  it("renders the shared cm-mark base class alongside the code class on the same element", () => {
    const parent = document.createElement("div");
    const view = new EditorView({
      state: EditorState.create({
        doc: "hello world",
        extensions: [markDecorationExtension()],
      }),
      parent,
    });
    view.dispatch({ effects: setMarkDecorations.of([{ from: 0, to: 5, code: "nb" }]) });
    expect(parent.querySelector(".cm-mark")).not.toBeNull();
    expect(parent.querySelector(".cm-mark.cm-mark-nb")).not.toBeNull();
    view.destroy();
  });

  it("gives custom/unknown codes the shared cm-mark base class too", () => {
    const parent = document.createElement("div");
    const view = new EditorView({
      state: EditorState.create({
        doc: "hello world",
        extensions: [markDecorationExtension()],
      }),
      parent,
    });
    view.dispatch({ effects: setMarkDecorations.of([{ from: 0, to: 5, code: "zzz" }]) });
    expect(parent.querySelector(".cm-mark.cm-mark-zzz")).not.toBeNull();
    view.destroy();
  });

  it("multiple ranges with different codes produce distinct decorations sorted by from", () => {
    const parent = document.createElement("div");
    const view = new EditorView({
      state: EditorState.create({
        doc: "hello world foo bar",
        extensions: [markDecorationExtension()],
      }),
      parent,
    });
    view.dispatch({
      effects: setMarkDecorations.of([
        { from: 12, to: 15, code: "sic" },
        { from: 0, to: 5, code: "nb" },
      ]),
    });
    const decos = view.state.field(markDecorationField);
    expect(ranges(decos)).toEqual([[0, 5], [12, 15]]);
    expect(parent.querySelector(".cm-mark-nb")).not.toBeNull();
    expect(parent.querySelector(".cm-mark-sic")).not.toBeNull();
    view.destroy();
  });

  it("setMarkDecorations.of([]) clears back to Decoration.none", () => {
    const state = EditorState.create({
      doc: "hello world",
      extensions: [markDecorationField],
    });
    const tr1 = state.update({
      effects: setMarkDecorations.of([{ from: 0, to: 5, code: "nb" }]),
    });
    const tr2 = tr1.state.update({ effects: setMarkDecorations.of([]) });
    expect(tr2.state.field(markDecorationField)).toBe(Decoration.none);
  });

  it("decoration positions remap on doc change", () => {
    const state = EditorState.create({
      doc: "hello world",
      extensions: [markDecorationField],
    });
    const tr1 = state.update({
      effects: setMarkDecorations.of([{ from: 6, to: 11, code: "nb" }]),
    });
    const tr2 = tr1.state.update({ changes: { from: 0, insert: "xx" } });
    expect(ranges(tr2.state.field(markDecorationField))).toEqual([[8, 13]]);
  });

  it("zero-length ranges are skipped", () => {
    const state = EditorState.create({
      doc: "hello world",
      extensions: [markDecorationField],
    });
    const tr = state.update({
      effects: setMarkDecorations.of([
        { from: 3, to: 3, code: "nb" },
        { from: 0, to: 5, code: "it" },
      ]),
    });
    expect(ranges(tr.state.field(markDecorationField))).toEqual([[0, 5]]);
  });

  it("emits cm-mark-{code} even for an unrecognized code (class derived from mark)", () => {
    const parent = document.createElement("div");
    const view = new EditorView({
      state: EditorState.create({
        doc: "hello world",
        extensions: [markDecorationExtension()],
      }),
      parent,
    });
    view.dispatch({ effects: setMarkDecorations.of([{ from: 0, to: 5, code: "zzz" }]) });
    expect(parent.querySelector(".cm-mark-zzz")).not.toBeNull();
    view.destroy();
  });
});

describe("markScopePlugin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    usePreferencesStore.setState({ annotationDefaultLang: "en" });
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves a mark annotation into a cm-mark decoration and calls IPC with lang", async () => {
    usePreferencesStore.setState({ annotationDefaultLang: "zh" });
    mockResolve.mockResolvedValue([{ start: 0, end: 4 }]);
    const { view } = mountView("word rest");

    view.dispatch({ effects: setAnnotationData.of([makeAnnotation({ char_start: 4 })]) });
    await vi.runAllTimersAsync();

    expect(mockResolve).toHaveBeenCalledWith(
      "word rest",
      [{ charStart: 4, scope: { kind: "words", value: 1 } }],
      "zh",
    );
    expect(ranges(view.state.field(markDecorationField))).toEqual([[0, 4]]);
    view.destroy();
  });

  it("ignores non-mark annotations", async () => {
    mockResolve.mockResolvedValue([{ start: 0, end: 4 }]);
    const { view } = mountView("word rest");

    view.dispatch({
      effects: setAnnotationData.of([
        makeAnnotation({ annotation_type: "note", mark: null }),
      ]),
    });
    await vi.runAllTimersAsync();

    expect(mockResolve).not.toHaveBeenCalled();
    expect(view.state.field(markDecorationField)).toBe(Decoration.none);
    view.destroy();
  });

  it("skips annotations whose scope resolves to null", async () => {
    mockResolve.mockResolvedValue([null]);
    const { view } = mountView("word rest");

    view.dispatch({ effects: setAnnotationData.of([makeAnnotation()]) });
    await vi.runAllTimersAsync();

    expect(view.state.field(markDecorationField)).toBe(Decoration.none);
    view.destroy();
  });

  it("discards stale async results when annotation data changes again", async () => {
    let resolveFirst: (v: Array<{ start: number; end: number } | null>) => void;
    mockResolve
      .mockReturnValueOnce(
        new Promise((res) => {
          resolveFirst = res;
        }),
      )
      .mockResolvedValueOnce([{ start: 0, end: 4 }]);

    const { view } = mountView("word rest");

    // First data set kicks off a pending (unresolved) IPC.
    view.dispatch({ effects: setAnnotationData.of([makeAnnotation({ mark: "sic" })]) });
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(200);

    // Second data set supersedes it (newer generation), resolves immediately.
    view.dispatch({ effects: setAnnotationData.of([makeAnnotation({ mark: "nb" })]) });
    await vi.runAllTimersAsync();

    // Now let the stale first promise settle late.
    resolveFirst!([{ start: 5, end: 9 }]);
    await Promise.resolve();
    await Promise.resolve();

    // The newer (nb) decoration must remain; the stale (sic) result is discarded.
    const parent = (view.dom.parentElement as HTMLElement);
    expect(parent.querySelector(".cm-mark-nb")).not.toBeNull();
    expect(parent.querySelector(".cm-mark-sic")).toBeNull();
    view.destroy();
  });

  it("IPC rejection is non-fatal and leaves the field unchanged", async () => {
    mockResolve.mockRejectedValue(new Error("IPC channel closed"));
    const { view } = mountView("word rest");

    view.dispatch({ effects: setAnnotationData.of([makeAnnotation()]) });
    await vi.runAllTimersAsync();

    expect(view.state.field(markDecorationField)).toBe(Decoration.none);
    view.destroy();
  });

  it("markDecorationExtension renders .cm-mark-nb in the DOM after resolution", async () => {
    mockResolve.mockResolvedValue([{ start: 0, end: 4 }]);
    const { view, parent } = mountView("word rest");

    view.dispatch({ effects: setAnnotationData.of([makeAnnotation()]) });
    await vi.runAllTimersAsync();

    expect(parent.querySelector(".cm-mark-nb")).not.toBeNull();
    view.destroy();
  });
});
