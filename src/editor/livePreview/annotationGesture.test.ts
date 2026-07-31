// Gesture-path regression pins for #972 Cycle 5.
//
// These are pins expected GREEN from day one: they promote the verified
// scratch suite that refuted H1/H4 (widget mousedown reaches the cardbox
// link on inline, multiline-block, and collapsed-thread pills). The RED
// work for #972 lives in the consume-side cycles (1-4); this file locks
// the produce-side contract so a future widget/layout change cannot
// silently re-break go-to-card.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import {
  annotationDataField,
  setAnnotationData,
  annotationDecorationPlugin,
  annotationBlockDecorationField,
  displayModeField,
} from "./annotationState";
import {
  annotationFoldField,
  toggleAnnotationFoldEffect,
  threadTurnField,
  firingAnnotationsField,
  llmLockedField,
} from "./annotationWidgets";
import { Annotation as AnnotationGrammar } from "../markdown/annotation";
import { Comment as CommentGrammar } from "../markdown/comment";
import type { Annotation } from "../../lib/ipc";

vi.mock("../../lib/ipc", () => ({
  parseAnnotations: vi.fn(async () => []),
  listAnnotations: vi.fn(async () => []),
}));

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
    uuid: "ann-uuid",
    ...overrides,
  };
}

function makeView(doc: string, cursorPos: number): EditorView {
  const state = EditorState.create({
    doc,
    selection: { anchor: cursorPos },
    extensions: [
      markdown({ extensions: [CommentGrammar, AnnotationGrammar] }),
      annotationDataField,
      displayModeField,
      annotationDecorationPlugin,
      annotationBlockDecorationField,
      annotationFoldField,
      threadTurnField,
      firingAnnotationsField,
      llmLockedField,
    ],
  });
  const view = new EditorView({ state, parent: document.createElement("div") });
  ensureSyntaxTree(view.state, view.state.doc.length);
  return view;
}

/** Real bubbling mouse gesture on the glyph: mousedown + mouseup + click. */
function dispatchGlyphGesture(btn: HTMLElement): void {
  for (const type of ["mousedown", "mouseup", "click"] as const) {
    btn.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true }));
  }
}

describe("annotation cardbox-link gesture path (#972)", () => {
  let focusSpy: ReturnType<typeof vi.fn>;
  let builderSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    focusSpy = vi.fn();
    builderSpy = vi.fn();
    window.addEventListener("lit:focus-cardbox-card", focusSpy);
    window.addEventListener("lit:open-annotation-builder", builderSpy);
  });

  afterEach(() => {
    window.removeEventListener("lit:focus-cardbox-card", focusSpy);
    window.removeEventListener("lit:open-annotation-builder", builderSpy);
  });

  it("inline pill glyph fires focus event with the annotation uuid", () => {
    // "first line\n" = 11, "text " = 5 → ann at 16..33
    const doc = "first line\ntext <!---n | body---> more";
    const view = makeView(doc, 0);
    const ann = makeAnnotation({
      char_start: 16,
      char_end: 33,
      original: "<!---n | body--->",
      uuid: "inline-uuid",
    });
    view.dispatch({ effects: setAnnotationData.of([ann]) });

    const btn = view.dom.querySelector(".cm-annotation-cardbox-link") as HTMLElement | null;
    expect(btn).toBeTruthy();
    const headBefore = view.state.selection.main.head;

    dispatchGlyphGesture(btn!);

    expect(focusSpy).toHaveBeenCalledTimes(1);
    const detail = (focusSpy.mock.calls[0]![0] as CustomEvent).detail;
    expect(detail.uuid).toBe("inline-uuid");
    expect(builderSpy).not.toHaveBeenCalled();
    expect(view.state.selection.main.head).toBe(headBefore);

    view.destroy();
  });

  it("multiline block pill glyph fires focus event with the annotation uuid", () => {
    // "first line\n\n" = 12, "<!---\nbody\n--->" = 15 → ann at 12..27, "after" at 28
    const doc = "first line\n\n<!---\nbody\n--->\nafter";
    const view = makeView(doc, 28);
    const ann = makeAnnotation({
      form: "block",
      char_start: 12,
      char_end: 27,
      original: "<!---\nbody\n--->",
      uuid: "block-uuid",
    });
    view.dispatch({ effects: setAnnotationData.of([ann]) });

    const btn = view.dom.querySelector(".cm-annotation-cardbox-link") as HTMLElement | null;
    expect(btn).toBeTruthy();
    const headBefore = view.state.selection.main.head;

    dispatchGlyphGesture(btn!);

    expect(focusSpy).toHaveBeenCalledTimes(1);
    const detail = (focusSpy.mock.calls[0]![0] as CustomEvent).detail;
    expect(detail.uuid).toBe("block-uuid");
    expect(builderSpy).not.toHaveBeenCalled();
    expect(view.state.selection.main.head).toBe(headBefore);

    view.destroy();
  });

  it("collapsed thread pill glyph fires focus event with the annotation uuid", () => {
    const doc = "first line\n\n<!---\nQ: q1\nA: a1\n--->\nafter";
    // "first line\n\n" = 12, "<!---\nQ: q1\nA: a1\n--->" length:
    // <!---\n = 6, Q: q1\n = 6, A: a1\n = 6, ---> = 4 → 22; 12+22 = 34
    const view = makeView(doc, doc.indexOf("after"));
    const ann = makeAnnotation({
      form: "block",
      annotation_type: "thread",
      body: "Q: q1\nA: a1",
      char_start: 12,
      char_end: 34,
      original: "<!---\nQ: q1\nA: a1\n--->",
      uuid: "thread-uuid",
    });
    view.dispatch({ effects: setAnnotationData.of([ann]) });
    view.dispatch({ effects: toggleAnnotationFoldEffect.of({ pos: 12 }) });

    const btn = view.dom.querySelector(".cm-annotation-cardbox-link") as HTMLElement | null;
    expect(btn).toBeTruthy();
    const headBefore = view.state.selection.main.head;

    dispatchGlyphGesture(btn!);

    expect(focusSpy).toHaveBeenCalledTimes(1);
    const detail = (focusSpy.mock.calls[0]![0] as CustomEvent).detail;
    expect(detail.uuid).toBe("thread-uuid");
    expect(builderSpy).not.toHaveBeenCalled();
    expect(view.state.selection.main.head).toBe(headBefore);

    view.destroy();
  });

  it("anchored slip-note pill dispatches parent uuid with highlightNote", () => {
    const doc = "first line\ntext <!---sn | note---> more";
    const view = makeView(doc, 0);
    // "first line\ntext " = 16, "<!---sn | note--->" = 18 → 16..34
    const ann = makeAnnotation({
      annotation_type: "slipnote",
      scope: { kind: "anchor", value: "parent-card" },
      char_start: 16,
      char_end: 34,
      original: "<!---sn | note--->",
      uuid: "sn-child",
    });
    view.dispatch({ effects: setAnnotationData.of([ann]) });

    const btn = view.dom.querySelector(".cm-annotation-cardbox-link") as HTMLElement | null;
    expect(btn).toBeTruthy();

    dispatchGlyphGesture(btn!);

    expect(focusSpy).toHaveBeenCalledTimes(1);
    const detail = (focusSpy.mock.calls[0]![0] as CustomEvent).detail;
    expect(detail.uuid).toBe("parent-card");
    expect(detail.highlightNote).toBe(true);
    expect(builderSpy).not.toHaveBeenCalled();

    view.destroy();
  });
});
