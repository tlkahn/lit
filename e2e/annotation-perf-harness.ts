import { EditorState, Compartment } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { forceParsing, syntaxTree } from "@codemirror/language";
import { createExtensions } from "../src/editor/extensions";
import { generateBlockAnnotationStress } from "../src/test/fixtures/generate";
import {
  annotationDataField,
  setAnnotationData,
} from "../src/editor/livePreview/annotationState";
import { toggleAnnotationFoldEffect } from "../src/editor/livePreview/annotationWidgets";
import type { Annotation } from "../src/lib/ipc";
import "../src/index.css";

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

function blockAnnotationsFromTree(view: EditorView): Annotation[] {
  const { state } = view;
  const annotations: Annotation[] = [];
  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.name !== "BlockAnnotation") return;
      const original = state.doc.sliceString(node.from, node.to);
      const headMatch = original.match(/^<!---\r?\n(th|n)\b/);
      const annotation_type = headMatch?.[1] === "th" ? "thread" : "note";
      annotations.push(
        makeAnnotation({
          form: "block",
          annotation_type,
          char_start: node.from,
          char_end: node.to,
          original,
          body:
            annotation_type === "thread"
              ? "Q: first?\nA: reply one."
              : `body at ${node.from}`,
        }),
      );
    },
  });
  return annotations;
}

export interface TimingResult {
  /** dispatch + forced reflow (no frame wait) */
  syncMs: number;
  /** dispatch + forced reflow + double-rAF paint wait */
  paintMs: number;
}

async function measureDispatchToPaint(fn: () => void): Promise<TimingResult> {
  const start = performance.now();
  fn();
  // Force synchronous layout
  document.body.offsetHeight;
  const syncMs = performance.now() - start;
  // Wait for paint completion (double-rAF)
  await new Promise<void>((r) =>
    requestAnimationFrame(() => requestAnimationFrame(() => r())),
  );
  return { syncMs, paintMs: performance.now() - start };
}

function foldAllEffects(view: EditorView) {
  return view.state
    .field(annotationDataField)
    .map((a) => toggleAnnotationFoldEffect.of({ pos: a.char_start }));
}

const doc = generateBlockAnnotationStress();

const view = new EditorView({
  state: EditorState.create({
    doc,
    selection: { anchor: 0 },
    extensions: createExtensions({
      theme: "light",
      themeCompartment: new Compartment(),
      keymapCompartment: new Compartment(),
      foldCompartment: new Compartment(),
      crossrefCompartment: new Compartment(),
      noteDirCompartment: new Compartment(),
      notePathCompartment: new Compartment(),
      imageResolverCompartment: new Compartment(),
      mediaThumbnailsCompartment: new Compartment(),
      annotationCompartment: new Compartment(),
      annotationEnabled: true,
      focusModeCompartment: new Compartment(),
      editableCompartment: new Compartment(),
      openUrl: () => {},
    }),
  }),
  parent: document.getElementById("harness-root")!,
});

// Commit full syntax tree into Language state (ensureSyntaxTree alone is not enough).
forceParsing(view, view.state.doc.length, 30_000);
const annotations = blockAnnotationsFromTree(view);

// Park cursor after the first block so callouts are not cursor-suppressed.
const cursorPos = Math.min((annotations[0]?.char_end ?? 0) + 1, doc.length);
view.dispatch({
  effects: setAnnotationData.of(annotations),
  selection: { anchor: cursorPos },
});

export interface AnnotationPerfApi {
  ready: boolean;
  annotationCount: number;
  foldAll(): Promise<TimingResult>;
  expandAll(): Promise<TimingResult>;
  foldSingle(): Promise<TimingResult>;
  typeBurst(): Promise<TimingResult>;
}

declare global {
  interface Window {
    __VIEW__: EditorView;
    __PERF__: AnnotationPerfApi;
  }
}

window.__VIEW__ = view;

let folded = false;

window.__PERF__ = {
  ready: true,
  annotationCount: annotations.length,
  async foldAll() {
    // Always fold from the expanded state for stable timing.
    if (folded) {
      await measureDispatchToPaint(() => {
        view.dispatch({ effects: foldAllEffects(view) });
      });
      folded = false;
    }
    const timing = await measureDispatchToPaint(() => {
      view.dispatch({ effects: foldAllEffects(view) });
    });
    folded = true;
    return timing;
  },
  async expandAll() {
    // Ensure we start folded so this is an expand.
    if (!folded) {
      await measureDispatchToPaint(() => {
        view.dispatch({ effects: foldAllEffects(view) });
      });
      folded = true;
    }
    const timing = await measureDispatchToPaint(() => {
      view.dispatch({ effects: foldAllEffects(view) });
    });
    folded = false;
    return timing;
  },
  async foldSingle() {
    const target =
      view.state.field(annotationDataField)[1] ?? view.state.field(annotationDataField)[0];
    if (!target) return { syncMs: -1, paintMs: -1 };
    return measureDispatchToPaint(() => {
      view.dispatch({
        effects: toggleAnnotationFoldEffect.of({ pos: target.char_start }),
      });
    });
  },
  async typeBurst() {
    const mid = Math.floor(view.state.doc.length / 2);
    return measureDispatchToPaint(() => {
      view.dispatch({ changes: { from: mid, insert: "test" } });
    });
  },
};
