import { describe, it, expect } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import {
  annotationDataField,
  setAnnotationData,
  annotationDecorationPlugin,
  annotationBlockDecorationField,
  displayModeField,
} from "./annotationState";
import {
  annotationFoldField,
  firingAnnotationsField,
  llmLockedField,
} from "./annotationWidgets";
import { Annotation as AnnotationGrammar } from "../markdown/annotation";
import { Comment as CommentGrammar } from "../markdown/comment";
import { generateAnnotationHeavy } from "../../test/fixtures/generate";
import type { Annotation } from "../../lib/ipc";

const HARD_LIMIT_MS = 100;
const ADVISORY_MS = 16;
const ANNOTATION_LINES = 250;

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
    original: "<!---note--->",
    ...overrides,
  };
}

/**
 * Derive an Annotation[] from the actual parsed InlineAnnotation node ranges so
 * that `findAnnotationForRange` (which requires char_start===from &&
 * char_end===to) matches every annotation node in the document.
 */
function annotationsFromTree(view: EditorView): Annotation[] {
  const { state } = view;
  const annotations: Annotation[] = [];
  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.name !== "InlineAnnotation") return;
      annotations.push(
        makeAnnotation({
          char_start: node.from,
          char_end: node.to,
          original: state.doc.sliceString(node.from, node.to),
        }),
      );
    },
  });
  return annotations;
}

function makeAnnotationPerfView(doc: string): EditorView {
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
  ensureSyntaxTree(view.state, view.state.doc.length);
  const annotations = annotationsFromTree(view);
  view.dispatch({ effects: setAnnotationData.of(annotations) });
  return view;
}

function countNodes(doc: string, nodeName: string): number {
  const state = EditorState.create({
    doc,
    extensions: [markdown({ extensions: [CommentGrammar, AnnotationGrammar] })],
  });
  ensureSyntaxTree(state, state.doc.length);
  let count = 0;
  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.name === nodeName) count++;
    },
  });
  return count;
}

function measureDispatch(
  view: EditorView,
  change: { from: number; to?: number; insert?: string },
): number {
  const start = performance.now();
  view.dispatch({ changes: change });
  return performance.now() - start;
}

function measureEffectDispatch(view: EditorView, effects: ReturnType<typeof setAnnotationData.of>): number {
  const start = performance.now();
  view.dispatch({ effects });
  return performance.now() - start;
}

describe("generateAnnotationHeavy", () => {
  it("emits one InlineAnnotation per line (>= 200)", () => {
    const doc = generateAnnotationHeavy(ANNOTATION_LINES);
    const count = countNodes(doc, "InlineAnnotation");
    expect(count).toBeGreaterThanOrEqual(200);
    expect(count).toBe(ANNOTATION_LINES);
  });

  it("emits no BlockAnnotation nodes", () => {
    const doc = generateAnnotationHeavy(ANNOTATION_LINES);
    expect(countNodes(doc, "BlockAnnotation")).toBe(0);
  });
});

describe("annotation dispatch latency — 200+ annotations", () => {
  it(`midpoint single-char insert (${ANNOTATION_LINES} annotations)`, () => {
    const doc = generateAnnotationHeavy(ANNOTATION_LINES);
    const view = makeAnnotationPerfView(doc);
    const mid = Math.floor(doc.length / 2);
    const elapsed = measureDispatch(view, { from: mid, insert: "x" });

    if (elapsed > ADVISORY_MS) {
      console.warn(
        `[perf] annotation midpoint insert: ${elapsed.toFixed(1)}ms (>${ADVISORY_MS}ms target)`,
      );
    }
    expect(elapsed).toBeLessThan(HARD_LIMIT_MS);
    view.destroy();
  });

  it(`document-start single-char insert (${ANNOTATION_LINES} annotations)`, () => {
    const doc = generateAnnotationHeavy(ANNOTATION_LINES);
    const view = makeAnnotationPerfView(doc);
    const elapsed = measureDispatch(view, { from: 0, insert: "x" });

    if (elapsed > ADVISORY_MS) {
      console.warn(
        `[perf] annotation start insert: ${elapsed.toFixed(1)}ms (>${ADVISORY_MS}ms target)`,
      );
    }
    expect(elapsed).toBeLessThan(HARD_LIMIT_MS);
    view.destroy();
  });

  it(`backspace deletion (${ANNOTATION_LINES} annotations)`, () => {
    const doc = generateAnnotationHeavy(ANNOTATION_LINES);
    const view = makeAnnotationPerfView(doc);
    const mid = Math.floor(doc.length / 2);
    const elapsed = measureDispatch(view, { from: mid, to: mid + 1 });

    if (elapsed > ADVISORY_MS) {
      console.warn(
        `[perf] annotation backspace: ${elapsed.toFixed(1)}ms (>${ADVISORY_MS}ms target)`,
      );
    }
    expect(elapsed).toBeLessThan(HARD_LIMIT_MS);
    view.destroy();
  });

  it(`setAnnotationData effect re-dispatch (${ANNOTATION_LINES} annotations)`, () => {
    const doc = generateAnnotationHeavy(ANNOTATION_LINES);
    const view = makeAnnotationPerfView(doc);
    const sameAnnotations = annotationsFromTree(view);
    const elapsed = measureEffectDispatch(view, setAnnotationData.of(sameAnnotations));

    if (elapsed > ADVISORY_MS) {
      console.warn(
        `[perf] annotation setAnnotationData re-dispatch: ${elapsed.toFixed(1)}ms (>${ADVISORY_MS}ms target)`,
      );
    }
    expect(elapsed).toBeLessThan(HARD_LIMIT_MS);
    view.destroy();
  });

  it(`plain-line cursor move skips rebuild fast (${ANNOTATION_LINES} annotations)`, () => {
    // Append a few plain trailing lines (no annotations) so we can move the
    // cursor onto a line the plugin's cursorSensitiveLines does NOT contain.
    const doc = generateAnnotationHeavy(ANNOTATION_LINES) + "\n\nplain tail line";
    const view = makeAnnotationPerfView(doc);
    const tailPos = doc.length - 2;

    const start = performance.now();
    view.dispatch({ selection: { anchor: tailPos } });
    const elapsed = performance.now() - start;

    if (elapsed > ADVISORY_MS) {
      console.warn(
        `[perf] annotation plain-line cursor move: ${elapsed.toFixed(1)}ms (>${ADVISORY_MS}ms target)`,
      );
    }
    expect(elapsed).toBeLessThan(HARD_LIMIT_MS);
    view.destroy();
  });
});
