import { describe, it, expect, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { ensureSyntaxTree, forceParsing, syntaxTree } from "@codemirror/language";
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
  CalloutWidget,
  ThreadWidget,
} from "./annotationWidgets";
import { Annotation as AnnotationGrammar } from "../markdown/annotation";
import { Comment as CommentGrammar } from "../markdown/comment";
import { generateAnnotationHeavy, generateBlockAnnotationStress } from "../../test/fixtures/generate";
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
  forceParsing(view, view.state.doc.length, 10_000);
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

/**
 * Build a document of many multiline BlockAnnotation callouts plus trailing
 * plain lines. generateAnnotationHeavy emits only InlineAnnotations, so this
 * inline fixture is needed to exercise annotationBlockDecorationField's
 * full-tree walk specifically.
 */
function generateBlockAnnotationHeavy(blockCount: number): string {
  const blocks: string[] = [];
  for (let i = 0; i < blockCount; i++) {
    blocks.push(`<!---\nbody ${i}\n--->`);
  }
  return blocks.join("\n\n") + "\n\nplain tail line";
}

function blockAnnotationsFromTree(view: EditorView): Annotation[] {
  const { state } = view;
  const annotations: Annotation[] = [];
  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.name !== "BlockAnnotation") return;
      const original = state.doc.sliceString(node.from, node.to);
      // Stress fixture heads: "n" (note) or "th" (thread). Detect from source so
      // CalloutWidget vs ThreadWidget mix matches generateBlockAnnotationStress.
      const headMatch = original.match(/^<!---\r?\n(th|n)\b/);
      const annotation_type = headMatch?.[1] === "th" ? "thread" : "note";
      annotations.push(
        makeAnnotation({
          form: "block",
          annotation_type,
          char_start: node.from,
          char_end: node.to,
          original,
          body: annotation_type === "thread" ? "Q: first?\nA: reply one." : `body at ${node.from}`,
        }),
      );
    },
  });
  return annotations;
}

describe("annotationBlockDecorationField — block-heavy doc", () => {
  const BLOCK_COUNT = 200;

  function makeBlockPerfView(doc: string): EditorView {
    const state = EditorState.create({
      doc,
      selection: { anchor: doc.length - 2 },
      extensions: [
        markdown({ extensions: [CommentGrammar, AnnotationGrammar] }),
        annotationDataField,
        displayModeField,
        annotationFoldField,
        threadTurnField,
        firingAnnotationsField,
        llmLockedField,
        annotationDecorationPlugin,
        annotationBlockDecorationField,
      ],
    });
    const view = new EditorView({ state, parent: document.createElement("div") });
    forceParsing(view, view.state.doc.length, 10_000);
    view.dispatch({ effects: setAnnotationData.of(blockAnnotationsFromTree(view)) });
    return view;
  }

  it(`plain-line cursor move skips field rebuild fast (${BLOCK_COUNT} block annotations)`, () => {
    const doc = generateBlockAnnotationHeavy(BLOCK_COUNT);
    const view = makeBlockPerfView(doc);
    expect(view.state.field(annotationDataField)).toHaveLength(BLOCK_COUNT);

    // The field must NOT rebuild on a plain-line cursor move: same value ref.
    const before = view.state.field(annotationBlockDecorationField);
    const tailPos = doc.length - 1;

    const start = performance.now();
    view.dispatch({ selection: { anchor: tailPos } });
    const elapsed = performance.now() - start;

    expect(view.state.field(annotationBlockDecorationField)).toBe(before);
    if (elapsed > ADVISORY_MS) {
      console.warn(
        `[perf] block-annotation plain-line cursor move: ${elapsed.toFixed(1)}ms (>${ADVISORY_MS}ms target)`,
      );
    }
    expect(elapsed).toBeLessThan(HARD_LIMIT_MS);
    view.destroy();
  });

  it(`single toggleAnnotationFoldEffect (${BLOCK_COUNT} block annotations)`, () => {
    const doc = generateBlockAnnotationHeavy(BLOCK_COUNT);
    const view = makeBlockPerfView(doc);
    const firstBlockPos = view.state.field(annotationDataField)[0]?.char_start ?? 0;

    const start = performance.now();
    view.dispatch({ effects: toggleAnnotationFoldEffect.of({ pos: firstBlockPos }) });
    const elapsed = performance.now() - start;

    if (elapsed > ADVISORY_MS) {
      console.warn(
        `[perf] block-annotation fold toggle: ${elapsed.toFixed(1)}ms (>${ADVISORY_MS}ms target)`,
      );
    }
    expect(elapsed).toBeLessThan(HARD_LIMIT_MS);
    view.destroy();
  });

  it(`setAnnotationData re-dispatch (${BLOCK_COUNT} block annotations)`, () => {
    const doc = generateBlockAnnotationHeavy(BLOCK_COUNT);
    const view = makeBlockPerfView(doc);
    const sameAnnotations = blockAnnotationsFromTree(view);

    const start = performance.now();
    view.dispatch({ effects: setAnnotationData.of(sameAnnotations) });
    const elapsed = performance.now() - start;

    if (elapsed > ADVISORY_MS) {
      console.warn(
        `[perf] block-annotation setAnnotationData re-dispatch: ${elapsed.toFixed(1)}ms (>${ADVISORY_MS}ms target)`,
      );
    }
    expect(elapsed).toBeLessThan(HARD_LIMIT_MS);
    view.destroy();
  });
});

const STRESS_SMOKE_CAP_MS = 5000;

function makeStressBlockView(): EditorView {
  const doc = generateBlockAnnotationStress();
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
  // ensureSyntaxTree alone returns a complete tree but does NOT commit it into
  // the Language state field; syntaxTree(view.state) stays partial. forceParsing
  // advances the parser and updates editor state so block widgets can build.
  forceParsing(view, view.state.doc.length, 10_000);
  const annotations = blockAnnotationsFromTree(view);
  view.dispatch({ effects: setAnnotationData.of(annotations) });
  return view;
}

describe("annotationBlockDecorationField - 1.3MB stress fixture", () => {
  it("plain-line cursor move preserves field identity", { timeout: 30_000 }, () => {
    const view = makeStressBlockView();
    const doc = view.state.doc.toString();
    const tailPos = doc.length - 1;

    view.dispatch({ selection: { anchor: tailPos } });
    const before = view.state.field(annotationBlockDecorationField);

    view.dispatch({ selection: { anchor: tailPos - 1 } });
    expect(view.state.field(annotationBlockDecorationField)).toBe(before);
    view.destroy();
  });

  it("single fold toggle dispatch", { timeout: 30_000 }, () => {
    const view = makeStressBlockView();
    const firstBlockPos = view.state.field(annotationDataField)[0]?.char_start ?? 0;

    const start = performance.now();
    view.dispatch({ effects: toggleAnnotationFoldEffect.of({ pos: firstBlockPos }) });
    const elapsed = performance.now() - start;

    if (elapsed > ADVISORY_MS) {
      console.warn(
        `[perf] stress fold toggle: ${elapsed.toFixed(1)}ms (>${ADVISORY_MS}ms target)`,
      );
    }
    expect(elapsed).toBeLessThan(STRESS_SMOKE_CAP_MS);
    view.destroy();
  });

  it("setAnnotationData re-dispatch", { timeout: 30_000 }, () => {
    const view = makeStressBlockView();
    const annotations = blockAnnotationsFromTree(view);

    const start = performance.now();
    view.dispatch({ effects: setAnnotationData.of(annotations) });
    const elapsed = performance.now() - start;

    if (elapsed > ADVISORY_MS) {
      console.warn(
        `[perf] stress setAnnotationData re-dispatch: ${elapsed.toFixed(1)}ms (>${ADVISORY_MS}ms target)`,
      );
    }
    expect(elapsed).toBeLessThan(STRESS_SMOKE_CAP_MS);
    view.destroy();
  });

  it("midpoint single-char insert", { timeout: 30_000 }, () => {
    const view = makeStressBlockView();
    const mid = Math.floor(view.state.doc.length / 2);

    const start = performance.now();
    view.dispatch({ changes: { from: mid, insert: "x" } });
    const elapsed = performance.now() - start;

    if (elapsed > ADVISORY_MS) {
      console.warn(
        `[perf] stress midpoint insert: ${elapsed.toFixed(1)}ms (>${ADVISORY_MS}ms target)`,
      );
    }
    expect(elapsed).toBeLessThan(STRESS_SMOKE_CAP_MS);
    view.destroy();
  });

  /**
   * H2 proxy: count how many widgets CM6 must rebuild when fold state flips.
   *
   * Two measurements:
   * 1. DecorationSet pairwise eq() - the true blast radius (every widget whose
   *    isCollapsed flipped fails eq). Independent of viewport / tile cache.
   * 2. toDOM() spy during dispatch - how many widgets CM6 actually redraws in
   *    the drawn range. We shrink estimatedHeight so the whole annotation
   *    cluster fits in CM6's ~1000px default viewport margin.
   */
  function makeStressBlockViewFullViewport(): { view: EditorView; restoreHeights: () => void } {
    const calloutDesc = Object.getOwnPropertyDescriptor(CalloutWidget.prototype, "estimatedHeight")!;
    const threadDesc = Object.getOwnPropertyDescriptor(ThreadWidget.prototype, "estimatedHeight")!;
    Object.defineProperty(CalloutWidget.prototype, "estimatedHeight", {
      configurable: true,
      get() {
        return 1;
      },
    });
    Object.defineProperty(ThreadWidget.prototype, "estimatedHeight", {
      configurable: true,
      get() {
        return 1;
      },
    });

    const restoreHeights = () => {
      Object.defineProperty(CalloutWidget.prototype, "estimatedHeight", calloutDesc);
      Object.defineProperty(ThreadWidget.prototype, "estimatedHeight", threadDesc);
    };

    try {
      const doc = generateBlockAnnotationStress();
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
      const parent = document.createElement("div");
      const view = new EditorView({ state, parent });
      forceParsing(view, view.state.doc.length, 10_000);
      const annotations = blockAnnotationsFromTree(view);
      // Park the cursor on the blank line after the first block so the first
      // annotation is not cursor-suppressed, while the viewport stays at top
      // where the whole (height-shrunk) annotation cluster is drawn.
      const firstEnd = annotations[0]?.char_end ?? 0;
      const cursorPos = Math.min(firstEnd + 1, doc.length);
      view.dispatch({
        effects: setAnnotationData.of(annotations),
        selection: { anchor: cursorPos },
      });
      return { view, restoreHeights };
    } catch (err) {
      restoreHeights();
      throw err;
    }
  }

  type WidgetMap = Map<number, CalloutWidget | ThreadWidget>;

  function collectBlockWidgets(view: EditorView): WidgetMap {
    const map: WidgetMap = new Map();
    const deco = view.state.field(annotationBlockDecorationField).decorations;
    const iter = deco.iter();
    while (iter.value) {
      const widget = iter.value.spec.widget;
      if (widget instanceof CalloutWidget || widget instanceof ThreadWidget) {
        map.set(iter.from, widget);
      }
      iter.next();
    }
    return map;
  }

  /** Pairwise eq across old/new DecorationSets - one comparison per position. */
  function measureEqBlastRadius(
    before: WidgetMap,
    after: WidgetMap,
  ): { calloutEqFalse: number; threadEqFalse: number; calloutEqCalls: number; threadEqCalls: number } {
    let calloutEqFalse = 0;
    let threadEqFalse = 0;
    let calloutEqCalls = 0;
    let threadEqCalls = 0;

    for (const [from, oldWidget] of before) {
      const newWidget = after.get(from);
      if (!newWidget) continue;
      if (oldWidget instanceof CalloutWidget && newWidget instanceof CalloutWidget) {
        calloutEqCalls++;
        if (!oldWidget.eq(newWidget)) calloutEqFalse++;
      } else if (oldWidget instanceof ThreadWidget && newWidget instanceof ThreadWidget) {
        threadEqCalls++;
        if (!oldWidget.eq(newWidget)) threadEqFalse++;
      }
    }
    return { calloutEqFalse, threadEqFalse, calloutEqCalls, threadEqCalls };
  }

  function installToDOMSpies(): {
    calloutToDOM: number;
    threadToDOM: number;
    restore: () => void;
  } {
    const stats = { calloutToDOM: 0, threadToDOM: 0 };
    const origCalloutToDOM = CalloutWidget.prototype.toDOM;
    const origThreadToDOM = ThreadWidget.prototype.toDOM;

    const calloutSpy = vi
      .spyOn(CalloutWidget.prototype, "toDOM")
      .mockImplementation(function (this: CalloutWidget, view: EditorView) {
        stats.calloutToDOM++;
        return origCalloutToDOM.call(this, view);
      });
    const threadSpy = vi
      .spyOn(ThreadWidget.prototype, "toDOM")
      .mockImplementation(function (this: ThreadWidget, view: EditorView) {
        stats.threadToDOM++;
        return origThreadToDOM.call(this, view);
      });

    return {
      get calloutToDOM() {
        return stats.calloutToDOM;
      },
      get threadToDOM() {
        return stats.threadToDOM;
      },
      restore: () => {
        calloutSpy.mockRestore();
        threadSpy.mockRestore();
      },
    };
  }

  function foldAllEffects(view: EditorView) {
    const annotations = view.state.field(annotationDataField);
    return annotations.map((a) => toggleAnnotationFoldEffect.of({ pos: a.char_start }));
  }

  function countAnnotationMix(view: EditorView): { notes: number; threads: number } {
    const annotations = view.state.field(annotationDataField);
    let notes = 0;
    let threads = 0;
    for (const a of annotations) {
      if (a.annotation_type === "thread") threads++;
      else notes++;
    }
    return { notes, threads };
  }

  it("fold-all blast radius: eq() and toDOM() call counts", { timeout: 60_000 }, () => {
    const { view, restoreHeights } = makeStressBlockViewFullViewport();
    try {
      const { notes, threads } = countAnnotationMix(view);
      expect(notes + threads).toBe(150);
      expect(notes).toBe(100);
      expect(threads).toBe(50);

      const before = collectBlockWidgets(view);
      expect(before.size).toBe(150);

      const spies = installToDOMSpies();
      try {
        view.dispatch({ effects: foldAllEffects(view) });
        const after = collectBlockWidgets(view);
        const blast = measureEqBlastRadius(before, after);

        // Primary H2 multiplier: every folded widget fails eq (isCollapsed flipped).
        expect(blast.calloutEqCalls).toBe(notes);
        expect(blast.threadEqCalls).toBe(threads);
        expect(blast.calloutEqFalse).toBe(notes);
        expect(blast.threadEqFalse).toBe(threads);
        // toDOM only runs for widgets CM6 has drawn (viewport-scoped). Fold-all
        // must redraw more than a single toggle; exact N is not reachable in
        // jsdom because the height-map viewport still covers only a handful of
        // the 150 replace-widgets even with estimatedHeight forced to 1.
        const totalToDOM = spies.calloutToDOM + spies.threadToDOM;
        expect(totalToDOM).toBeGreaterThan(1);
        expect(spies.calloutToDOM).toBeGreaterThan(0);
        expect(spies.threadToDOM).toBeGreaterThan(0);

        console.warn(
          `[perf] H2 blast-radius fold-all: callout eqFalse=${blast.calloutEqFalse}/${notes} toDOM=${spies.calloutToDOM}; ` +
            `thread eqFalse=${blast.threadEqFalse}/${threads} toDOM=${spies.threadToDOM} (viewport-scoped toDOM)`,
        );
      } finally {
        spies.restore();
      }
    } finally {
      restoreHeights();
      view.destroy();
    }
  });

  it("expand-all blast radius matches fold-all", { timeout: 60_000 }, () => {
    const { view, restoreHeights } = makeStressBlockViewFullViewport();
    try {
      const { notes, threads } = countAnnotationMix(view);

      // First fold-all (no spies) so the second toggle expands.
      view.dispatch({ effects: foldAllEffects(view) });
      const before = collectBlockWidgets(view);
      expect(before.size).toBe(150);

      const spies = installToDOMSpies();
      try {
        view.dispatch({ effects: foldAllEffects(view) });
        const after = collectBlockWidgets(view);
        const blast = measureEqBlastRadius(before, after);

        // Expand direction has the same eq blast radius as fold.
        expect(blast.calloutEqFalse).toBe(notes);
        expect(blast.threadEqFalse).toBe(threads);
        const totalToDOM = spies.calloutToDOM + spies.threadToDOM;
        expect(totalToDOM).toBeGreaterThan(1);

        console.warn(
          `[perf] H2 blast-radius expand-all: callout eqFalse=${blast.calloutEqFalse}/${notes} toDOM=${spies.calloutToDOM}; ` +
            `thread eqFalse=${blast.threadEqFalse}/${threads} toDOM=${spies.threadToDOM} (viewport-scoped toDOM)`,
        );
      } finally {
        spies.restore();
      }
    } finally {
      restoreHeights();
      view.destroy();
    }
  });

  it("single fold toggle: blast radius is 1", { timeout: 60_000 }, () => {
    const { view, restoreHeights } = makeStressBlockViewFullViewport();
    try {
      // Fold the second annotation - the first may sit next to the parked cursor.
      const target = view.state.field(annotationDataField)[1];
      expect(target).toBeDefined();

      const before = collectBlockWidgets(view);
      expect(before.size).toBe(150);

      const spies = installToDOMSpies();
      try {
        view.dispatch({ effects: toggleAnnotationFoldEffect.of({ pos: target!.char_start }) });
        const after = collectBlockWidgets(view);
        const blast = measureEqBlastRadius(before, after);

        const totalEqFalse = blast.calloutEqFalse + blast.threadEqFalse;
        const totalToDOM = spies.calloutToDOM + spies.threadToDOM;
        expect(totalEqFalse).toBe(1);
        expect(totalToDOM).toBe(1);

        console.warn(
          `[perf] H2 blast-radius single fold: eqFalse=${totalEqFalse} toDOM=${totalToDOM}`,
        );
      } finally {
        spies.restore();
      }
    } finally {
      restoreHeights();
      view.destroy();
    }
  });
});
