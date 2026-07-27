import { bench, describe } from "vitest";
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
  firingAnnotationsField,
  llmLockedField,
  toggleAnnotationFoldEffect,
} from "./annotationWidgets";
import { Annotation as AnnotationGrammar } from "../markdown/annotation";
import { Comment as CommentGrammar } from "../markdown/comment";
import type { Annotation } from "../../lib/ipc";
import { generateBlockAnnotationStress } from "../../test/fixtures/generate";

const stressDoc = generateBlockAnnotationStress();

const grammars = [CommentGrammar, AnnotationGrammar];

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

function blockAnnotationsFromTree(state: EditorState): Annotation[] {
  const tree = ensureSyntaxTree(state, state.doc.length, 10_000);
  if (!tree) throw new Error("parse incomplete");
  const annotations: Annotation[] = [];
  tree.iterate({
    enter: (node) => {
      if (node.name !== "BlockAnnotation") return;
      annotations.push(
        makeAnnotation({
          form: "block",
          char_start: node.from,
          char_end: node.to,
          original: state.doc.sliceString(node.from, node.to),
        }),
      );
    },
  });
  return annotations;
}

const blockOnlyExtensions = [
  markdown({ extensions: grammars }),
  annotationDataField,
  displayModeField,
  annotationFoldField,
  firingAnnotationsField,
  llmLockedField,
  annotationBlockDecorationField,
];

const fullExtensions = [
  ...blockOnlyExtensions,
  annotationDecorationPlugin,
];

function makeBlockOnlyView(): EditorView {
  const state = EditorState.create({
    doc: stressDoc,
    selection: { anchor: 0 },
    extensions: blockOnlyExtensions,
  });
  const view = new EditorView({ state, parent: document.createElement("div") });
  ensureSyntaxTree(view.state, view.state.doc.length, 10_000);
  const annotations = blockAnnotationsFromTree(view.state);
  view.dispatch({ effects: setAnnotationData.of(annotations) });
  return view;
}

function makeFullView(): EditorView {
  const state = EditorState.create({
    doc: stressDoc,
    selection: { anchor: 0 },
    extensions: fullExtensions,
  });
  const view = new EditorView({ state, parent: document.createElement("div") });
  ensureSyntaxTree(view.state, view.state.doc.length, 10_000);
  const annotations = blockAnnotationsFromTree(view.state);
  view.dispatch({ effects: setAnnotationData.of(annotations) });
  return view;
}

// H1a: raw tree.iterate cost over 1.3MB doc
describe("H1a: raw tree iterate (1.3MB stress doc)", () => {
  const state = EditorState.create({
    doc: stressDoc,
    extensions: [markdown({ extensions: grammars })],
  });
  const tree = ensureSyntaxTree(state, state.doc.length, 10_000)!;

  bench("count BlockAnnotation nodes", () => {
    let count = 0;
    tree.iterate({
      enter: (n) => {
        if (n.name === "BlockAnnotation") count++;
      },
    });
    if (count < 1) throw new Error("sanity");
  });
});

// H1b: toggleAnnotationFoldEffect dispatch (block field only, no inline plugin)
describe("H1b: fold toggle dispatch (block field only)", () => {
  const view = makeBlockOnlyView();
  const firstBlockPos = view.state.field(annotationDataField)[0]?.char_start ?? 0;

  bench("single fold toggle", () => {
    view.dispatch({ effects: toggleAnnotationFoldEffect.of({ pos: firstBlockPos }) });
  });
});

// H3: fold toggle dispatch with inline plugin installed
describe("H3: fold toggle dispatch (full extension stack)", () => {
  const view = makeFullView();
  const firstBlockPos = view.state.field(annotationDataField)[0]?.char_start ?? 0;

  bench("single fold toggle", () => {
    view.dispatch({ effects: toggleAnnotationFoldEffect.of({ pos: firstBlockPos }) });
  });
});

// Typing: single-char insert at document midpoint
describe("typing: midpoint single-char insert (full stack)", () => {
  const view = makeFullView();

  bench("insert 'x' at midpoint", () => {
    const mid = Math.floor(view.state.doc.length / 2);
    view.dispatch({ changes: { from: mid, insert: "x" } });
  });
});

// H4: doc.toString cost
describe("H4: doc.toString (1.3MB stress doc)", () => {
  const state = EditorState.create({
    doc: stressDoc,
    extensions: [markdown({ extensions: grammars })],
  });

  bench("doc.toString()", () => {
    state.doc.toString();
  });
});
