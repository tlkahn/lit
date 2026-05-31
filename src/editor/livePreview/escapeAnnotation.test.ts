import { describe, it, expect, vi } from "vitest";
import { EditorState, EditorSelection } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { escapeAnnotationKeymap } from "./escapeAnnotation";
import { annotationDataField, setAnnotationData } from "./annotationState";
import { scopeHighlightField, setScopeHighlight } from "./scopeHighlight";
import { Decoration } from "@codemirror/view";
import type { Annotation } from "../../lib/ipc";

vi.mock("../../lib/ipc", () => ({
  parseAnnotations: vi.fn(async () => []),
}));

const runEsc = escapeAnnotationKeymap[0]!.run!;

function makeAnnotation(overrides: Partial<Annotation> = {}): Annotation {
  return {
    form: "compact",
    annotation_type: "note",
    certainty: "neutral",
    scope: { kind: "words", value: 0 },
    body: "test",
    date: null,
    is_structured: true,
    char_start: 5,
    char_end: 18,
    original: "%%!n | test%%",
    uuid: null,
    ...overrides,
  };
}

function makeView(doc: string, cursorPos: number, annotations: Annotation[] = []) {
  const state = EditorState.create({
    doc,
    selection: EditorSelection.cursor(cursorPos),
    extensions: [
      annotationDataField,
      scopeHighlightField,
      keymap.of(escapeAnnotationKeymap),
    ],
  });
  const view = new EditorView({ state, parent: document.createElement("div") });
  if (annotations.length > 0) {
    view.dispatch({ effects: setAnnotationData.of(annotations) });
  }
  return view;
}

describe("escapeAnnotationKeymap", () => {
  it("ESC inside annotation moves cursor to char_end + 2 and clears scope highlight", () => {
    const doc = "hello %%!n | test%% more text";
    const ann = makeAnnotation({ char_start: 6, char_end: 19 });
    const view = makeView(doc, 10, [ann]);
    view.dispatch({ effects: setScopeHighlight.of({ from: 0, to: 5 }) });

    const handled = runEsc(view);
    expect(handled).toBe(true);
    expect(view.state.selection.main.head).toBe(21);
    expect(view.state.field(scopeHighlightField)).toBe(Decoration.none);
    view.destroy();
  });

  it("ESC outside annotation returns false", () => {
    const doc = "hello %%!n | test%% more text";
    const ann = makeAnnotation({ char_start: 6, char_end: 19 });
    const view = makeView(doc, 2, [ann]);

    const handled = runEsc(view);
    expect(handled).toBe(false);
    view.destroy();
  });

  it("ESC with non-collapsed selection returns false", () => {
    const doc = "hello %%!n | test%% more text";
    const ann = makeAnnotation({ char_start: 6, char_end: 19 });
    const state = EditorState.create({
      doc,
      selection: EditorSelection.range(8, 14),
      extensions: [
        annotationDataField,
        scopeHighlightField,
        keymap.of(escapeAnnotationKeymap),
      ],
    });
    const view = new EditorView({ state, parent: document.createElement("div") });
    view.dispatch({ effects: setAnnotationData.of([ann]) });

    const handled = runEsc(view);
    expect(handled).toBe(false);
    view.destroy();
  });

  it("ESC clamps to doc length", () => {
    const doc = "hi%%!n%%";
    const ann = makeAnnotation({ char_start: 2, char_end: 8 });
    const view = makeView(doc, 5, [ann]);

    const handled = runEsc(view);
    expect(handled).toBe(true);
    expect(view.state.selection.main.head).toBe(doc.length);
    view.destroy();
  });
});
