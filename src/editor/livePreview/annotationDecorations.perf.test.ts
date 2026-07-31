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
  buildAnnotationBlockDecorations,
  buildAnnotationRangeMap,
  displayModeField,
} from "./annotationState";
import { isCursorOnLine } from "./proximity";
import {
  annotationFoldField,
  toggleAnnotationFoldEffect,
  setAllAnnotationFoldsEffect,
  threadTurnField,
  setThreadTurnEffect,
  firingAnnotationsField,
  llmLockedField,
  PillWidget,
  ThreadWidget,
} from "./annotationWidgets";
import { Annotation as AnnotationGrammar } from "../markdown/annotation";
import { Comment as CommentGrammar } from "../markdown/comment";
import { generateAnnotationHeavy, generateBlockAnnotationStress } from "../../test/fixtures/generate";
import { toggleAllBlockAnnotationFolds } from "./annotationFoldAll";
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

function blockAnnotationsFromTree(view: EditorView, opts: { asThread?: boolean } = {}): Annotation[] {
  const { state } = view;
  const annotations: Annotation[] = [];
  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.name !== "BlockAnnotation") return;
      const original = state.doc.sliceString(node.from, node.to);
      // Stress fixture heads: "n" (note) or "th" (thread). Detect from source so
      // the pill vs ThreadWidget mix matches generateBlockAnnotationStress.
      // `asThread` overrides: fold-behavior suites need all-thread fixtures
      // since folding is thread-only.
      const headMatch = original.match(/^<!---\r?\n(th|n)\b/);
      const annotation_type = opts.asThread ? "thread" : headMatch?.[1] === "th" ? "thread" : "note";
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

  function makeBlockPerfView(doc: string, opts: { asThread?: boolean } = {}): EditorView {
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
    view.dispatch({ effects: setAnnotationData.of(blockAnnotationsFromTree(view, opts)) });
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
    const view = makeBlockPerfView(doc, { asThread: true });
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

describe("targeted iteration (step 1)", () => {
  const BLOCK_COUNT = 200;

  function makeBlockViewNoPlugin(doc: string): EditorView {
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
        annotationBlockDecorationField,
      ],
    });
    const view = new EditorView({ state, parent: document.createElement("div") });
    forceParsing(view, view.state.doc.length, 10_000);
    return view;
  }

  it("block builder iterate calls are bounded with to - from === 1", () => {
    const doc = generateBlockAnnotationHeavy(BLOCK_COUNT);
    const view = makeBlockViewNoPlugin(doc);
    const annotations = blockAnnotationsFromTree(view);
    view.dispatch({ effects: setAnnotationData.of(annotations) });

    const iterateCalls: Array<{ from?: number; to?: number }> = [];
    const tree = syntaxTree(view.state);
    const origIterate = tree.iterate.bind(tree);
    vi.spyOn(tree, "iterate").mockImplementation((spec: Parameters<typeof tree.iterate>[0]) => {
      iterateCalls.push({ from: spec.from, to: spec.to });
      return origIterate(spec);
    });

    buildAnnotationBlockDecorations(view.state);

    expect(iterateCalls.length).toBeGreaterThan(0);
    expect(iterateCalls.length).toBeLessThanOrEqual(annotations.length);
    for (const call of iterateCalls) {
      expect(call.from).toBeDefined();
      expect(call.to).toBeDefined();
      expect(call.to! - call.from!).toBe(1);
    }
    vi.restoreAllMocks();
    view.destroy();
  });

  it("produces same full-tuple decorations as reference full-tree walk", () => {
    const doc = generateBlockAnnotationStress();
    const view = makeBlockViewNoPlugin(doc);
    const annotations = blockAnnotationsFromTree(view);

    // Adversarial candidates: duplicate exact span, same-start-different-end,
    // and a non-witnessed multiline span over plain text.
    const first = annotations[0]!;
    const adversarial = [
      ...annotations,
      makeAnnotation({ form: "block", char_start: first.char_start, char_end: first.char_end, body: "duplicate exact span", original: first.original }),
      makeAnnotation({ form: "block", char_start: first.char_start, char_end: first.char_end - 1, body: "same-start shorter", original: "shorter" }),
      makeAnnotation({ form: "block", char_start: doc.length - 20, char_end: doc.length - 5, body: "non-witnessed multiline", original: "no tree node here" }),
    ];

    const foldTarget = annotations[2]!.char_start;
    view.dispatch({
      effects: [
        setAnnotationData.of(adversarial),
        toggleAnnotationFoldEffect.of({ pos: foldTarget }),
      ],
    });

    type Tuple = { from: number; to: number; kind: string; isCollapsed: boolean };

    const fieldResult: Tuple[] = [];
    const iter = view.state.field(annotationBlockDecorationField).decorations.iter();
    while (iter.value) {
      const w = iter.value.spec.widget;
      fieldResult.push({
        from: iter.from,
        to: iter.to,
        kind: w instanceof ThreadWidget ? "thread" : "pill",
        isCollapsed: w instanceof ThreadWidget ? w.isCollapsed : false,
      });
      iter.next();
    }

    // Pre-refactor reference: full syntaxTree(state).iterate over BlockAnnotation
    // nodes with multiline check, isCursorOnLine guard, and exact rangeMap lookup.
    // Fold state only reaches thread widgets; pills are fold-ignorant.
    const refResult: Tuple[] = [];
    const state = view.state;
    const foldState = state.field(annotationFoldField, false);
    const rangeMap = buildAnnotationRangeMap(adversarial);
    syntaxTree(state).iterate({
      enter: (node) => {
        if (node.name !== "BlockAnnotation") return;
        const from = node.from;
        const to = node.to;
        if (from < 0 || to > state.doc.length || from >= to) return;
        const startLine = state.doc.lineAt(from).number;
        const endLine = state.doc.lineAt(to).number;
        if (startLine === endLine) return;
        if (isCursorOnLine(state, from, to)) return;
        const ann = rangeMap.get(`${from}:${to}`);
        if (!ann) return;
        const isThread = ann.annotation_type === "thread";
        refResult.push({
          from,
          to,
          kind: isThread ? "thread" : "pill",
          isCollapsed: isThread ? (foldState?.get(from) ?? false) : false,
        });
      },
    });
    refResult.sort((a, b) => a.from - b.from || a.to - b.to);

    expect(fieldResult.length).toBe(refResult.length);
    expect(fieldResult.length).toBeGreaterThan(0);
    for (let i = 0; i < fieldResult.length; i++) {
      expect(fieldResult[i]).toEqual(refResult[i]);
    }
    view.destroy();
  });

  it("surgical-parity: fold-only dispatch matches fresh full build", () => {
    const doc = generateBlockAnnotationStress();
    const view = makeBlockViewNoPlugin(doc);
    const annotations = blockAnnotationsFromTree(view);
    view.dispatch({ effects: setAnnotationData.of(annotations) });

    const foldTarget = annotations[1]!.char_start;
    const unaffectedPos = annotations[3]!.char_start;

    // Capture widget identity at an unaffected position before fold.
    type Tuple = { from: number; to: number; kind: string; isCollapsed: boolean };
    function extractTuples(view: EditorView): Tuple[] {
      const result: Tuple[] = [];
      const iter = view.state.field(annotationBlockDecorationField).decorations.iter();
      while (iter.value) {
        const w = iter.value.spec.widget;
        result.push({
          from: iter.from,
          to: iter.to,
          kind: w instanceof ThreadWidget ? "thread" : "pill",
          isCollapsed: w instanceof ThreadWidget ? w.isCollapsed : false,
        });
        iter.next();
      }
      return result;
    }

    const beforeWidgets = new Map<number, unknown>();
    {
      const iter = view.state.field(annotationBlockDecorationField).decorations.iter();
      while (iter.value) {
        beforeWidgets.set(iter.from, iter.value.spec.widget);
        iter.next();
      }
    }

    // Fold-only dispatch (no shared effects) to exercise the surgical branch.
    view.dispatch({ effects: toggleAnnotationFoldEffect.of({ pos: foldTarget }) });

    // Verify surgical path ran (widget identity preserved at unaffected position).
    {
      const iter = view.state.field(annotationBlockDecorationField).decorations.iter();
      while (iter.value) {
        if (iter.from === unaffectedPos) {
          expect(iter.value.spec.widget).toBe(beforeWidgets.get(unaffectedPos));
        }
        iter.next();
      }
    }

    // Compare against a fresh full build on the post-fold state.
    const surgicalTuples = extractTuples(view);
    const freshBuild = buildAnnotationBlockDecorations(view.state);
    const freshTuples: Tuple[] = [];
    {
      const iter = freshBuild.decorations.iter();
      while (iter.value) {
        const w = iter.value.spec.widget;
        freshTuples.push({
          from: iter.from,
          to: iter.to,
          kind: w instanceof ThreadWidget ? "thread" : "pill",
          isCollapsed: w instanceof ThreadWidget ? w.isCollapsed : false,
        });
        iter.next();
      }
    }

    expect(surgicalTuples.length).toBe(freshTuples.length);
    for (let i = 0; i < surgicalTuples.length; i++) {
      expect(surgicalTuples[i]).toEqual(freshTuples[i]);
    }

    const surgicalLines = [...view.state.field(annotationBlockDecorationField).blockSensitiveLines].sort((a, b) => a - b);
    const freshLines = [...freshBuild.blockSensitiveLines].sort((a, b) => a - b);
    expect(surgicalLines).toEqual(freshLines);

    view.destroy();
  });
});

describe("surgical DecorationSet update (step 2)", () => {
  const BLOCK_COUNT = 10;

  function makeBlockView(doc: string, opts: { asThread?: boolean } = {}): EditorView {
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
    const annotations = blockAnnotationsFromTree(view, opts);
    view.dispatch({ effects: setAnnotationData.of(annotations) });
    return view;
  }

  type DecoEntry = { from: number; to: number; widget: PillWidget | ThreadWidget };

  function collectDecos(view: EditorView): DecoEntry[] {
    const entries: DecoEntry[] = [];
    const iter = view.state.field(annotationBlockDecorationField).decorations.iter();
    while (iter.value) {
      const w = iter.value.spec.widget;
      if (w instanceof PillWidget || w instanceof ThreadWidget) {
        entries.push({ from: iter.from, to: iter.to, widget: w });
      }
      iter.next();
    }
    return entries;
  }

  it("fold-only dispatch preserves Decoration identity for unaffected positions", () => {
    const doc = generateBlockAnnotationHeavy(BLOCK_COUNT);
    const view = makeBlockView(doc, { asThread: true });
    const annotations = view.state.field(annotationDataField);
    expect(annotations.length).toBe(BLOCK_COUNT);

    const beforeDecos = collectDecos(view);
    expect(beforeDecos.length).toBe(BLOCK_COUNT);

    const targetPos = annotations[1]!.char_start;
    view.dispatch({ effects: toggleAnnotationFoldEffect.of({ pos: targetPos }) });

    const afterDecos = collectDecos(view);
    expect(afterDecos.length).toBe(BLOCK_COUNT);

    // Decorations at non-toggled positions must be === identical objects
    for (const before of beforeDecos) {
      if (before.from === targetPos) continue;
      const after = afterDecos.find((d) => d.from === before.from);
      expect(after).toBeDefined();
      expect(after!.widget).toBe(before.widget);
    }
    view.destroy();
  });

  it("surgical fold produces correct fold state", () => {
    const doc = generateBlockAnnotationHeavy(BLOCK_COUNT);
    const view = makeBlockView(doc, { asThread: true });
    const annotations = view.state.field(annotationDataField);
    const targetPos = annotations[2]!.char_start;

    view.dispatch({ effects: toggleAnnotationFoldEffect.of({ pos: targetPos }) });

    const afterDecos = collectDecos(view);
    const toggled = afterDecos.find((d) => d.from === targetPos);
    expect(toggled).toBeDefined();
    expect((toggled!.widget as ThreadWidget).isCollapsed).toBe(true);

    // Others remain expanded
    for (const d of afterDecos) {
      if (d.from === targetPos) continue;
      expect((d.widget as ThreadWidget).isCollapsed).toBe(false);
    }
    view.destroy();
  });

  it("surgical update respects cursor-sensitivity", () => {
    const doc = generateBlockAnnotationHeavy(BLOCK_COUNT);
    const view = makeBlockView(doc, { asThread: true });
    const annotations = view.state.field(annotationDataField);
    const target = annotations[0]!;

    // Move cursor onto the first annotation's lines
    const cursorPos = target.char_start + 1;
    view.dispatch({ selection: { anchor: cursorPos } });

    // Fold that annotation
    view.dispatch({ effects: toggleAnnotationFoldEffect.of({ pos: target.char_start }) });

    // No decoration should exist at the cursor-suppressed position
    const afterDecos = collectDecos(view);
    const suppressed = afterDecos.find((d) => d.from === target.char_start);
    expect(suppressed).toBeUndefined();
    view.destroy();
  });

  it("shared effects bypass surgical path", () => {
    const doc = generateBlockAnnotationHeavy(BLOCK_COUNT);
    const view = makeBlockView(doc);
    const annotations = view.state.field(annotationDataField);

    const beforeDecos = collectDecos(view);
    const targetPos = annotations[1]!.char_start;

    // Dispatch fold + setAnnotationData together (shared effect forces full rebuild)
    view.dispatch({
      effects: [
        toggleAnnotationFoldEffect.of({ pos: targetPos }),
        setAnnotationData.of(annotations),
      ],
    });

    const afterDecos = collectDecos(view);

    // Full rebuild: decoration identity NOT preserved for any position
    let identityPreserved = 0;
    for (const before of beforeDecos) {
      const after = afterDecos.find((d) => d.from === before.from);
      if (after && after.widget === before.widget) identityPreserved++;
    }
    expect(identityPreserved).toBe(0);
    view.destroy();
  });

  it("surgical setThreadTurnEffect preserves unaffected widget identity", () => {
    const doc = generateBlockAnnotationStress();
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
    const annotations = blockAnnotationsFromTree(view);
    view.dispatch({ effects: setAnnotationData.of(annotations) });

    const threads = annotations.filter((a) => a.annotation_type === "thread");
    expect(threads.length).toBeGreaterThan(0);
    const targetPos = threads[0]!.char_start;

    const beforeDecos = collectDecos(view);
    view.dispatch({ effects: setThreadTurnEffect.of({ pos: targetPos, turn: 1 }) });
    const afterDecos = collectDecos(view);

    const targetAfter = afterDecos.find((d) => d.from === targetPos);
    expect(targetAfter).toBeDefined();
    expect((targetAfter!.widget as ThreadWidget).turn).toBe(1);

    for (const before of beforeDecos) {
      if (before.from === targetPos) continue;
      const after = afterDecos.find((d) => d.from === before.from);
      expect(after).toBeDefined();
      expect(after!.widget).toBe(before.widget);
    }
    view.destroy();
  });
});

const STRESS_HARD_LIMIT_MS = HARD_LIMIT_MS;

function makeStressBlockView(opts: { asThread?: boolean } = {}): EditorView {
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
  const annotations = blockAnnotationsFromTree(view, opts);
  view.dispatch({ effects: setAnnotationData.of(annotations) });
  return view;
}

describe("annotationBlockDecorationField - 1.3MB stress fixture", () => {
  it("plain-line cursor move preserves field identity", () => {
    const view = makeStressBlockView();
    const doc = view.state.doc.toString();
    const tailPos = doc.length - 1;

    view.dispatch({ selection: { anchor: tailPos } });
    const before = view.state.field(annotationBlockDecorationField);

    const start = performance.now();
    view.dispatch({ selection: { anchor: tailPos - 1 } });
    const elapsed = performance.now() - start;

    expect(view.state.field(annotationBlockDecorationField)).toBe(before);
    if (elapsed > ADVISORY_MS) {
      console.warn(
        `[perf] stress plain-line cursor move: ${elapsed.toFixed(1)}ms (>${ADVISORY_MS}ms target)`,
      );
    }
    expect(elapsed).toBeLessThan(STRESS_HARD_LIMIT_MS);
    view.destroy();
  });

  it("single fold toggle dispatch", () => {
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
    expect(elapsed).toBeLessThan(STRESS_HARD_LIMIT_MS);
    view.destroy();
  });

  it("setAnnotationData re-dispatch", () => {
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
    expect(elapsed).toBeLessThan(STRESS_HARD_LIMIT_MS);
    view.destroy();
  });

  it("midpoint single-char insert", () => {
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
    expect(elapsed).toBeLessThan(STRESS_HARD_LIMIT_MS);
    view.destroy();
  });

  it("fold-all surgical path total time", () => {
    const view = makeStressBlockView({ asThread: true });
    const annotations = view.state.field(annotationDataField);
    const positions = annotations.map((a) => a.char_start);
    const foldMap = view.state.field(annotationFoldField, false);
    const allCollapsed = positions.every((pos) => foldMap?.get(pos) ?? false);

    const start = performance.now();
    view.dispatch({ effects: setAllAnnotationFoldsEffect.of({ positions, collapsed: !allCollapsed }) });
    const elapsed = performance.now() - start;

    if (elapsed > ADVISORY_MS) {
      console.warn(
        `[perf] stress fold-all surgical: ${elapsed.toFixed(1)}ms (>${ADVISORY_MS}ms target)`,
      );
    }
    expect(elapsed).toBeLessThan(STRESS_HARD_LIMIT_MS);
    view.destroy();
  });

  it("fold-all via toggleAllBlockAnnotationFolds helper", () => {
    const view = makeStressBlockView({ asThread: true });

    const start = performance.now();
    const result = toggleAllBlockAnnotationFolds(view);
    const elapsed = performance.now() - start;

    expect(result).toBe(true);
    if (elapsed > ADVISORY_MS) {
      console.warn(
        `[perf] stress fold-all helper: ${elapsed.toFixed(1)}ms (>${ADVISORY_MS}ms target)`,
      );
    }
    expect(elapsed).toBeLessThan(STRESS_HARD_LIMIT_MS);
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
    const pillDesc = Object.getOwnPropertyDescriptor(PillWidget.prototype, "estimatedHeight")!;
    const threadDesc = Object.getOwnPropertyDescriptor(ThreadWidget.prototype, "estimatedHeight")!;
    Object.defineProperty(PillWidget.prototype, "estimatedHeight", {
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
      Object.defineProperty(PillWidget.prototype, "estimatedHeight", pillDesc);
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

  type WidgetMap = Map<number, PillWidget | ThreadWidget>;

  function collectBlockWidgets(view: EditorView): WidgetMap {
    const map: WidgetMap = new Map();
    const deco = view.state.field(annotationBlockDecorationField).decorations;
    const iter = deco.iter();
    while (iter.value) {
      const widget = iter.value.spec.widget;
      if (widget instanceof PillWidget || widget instanceof ThreadWidget) {
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
  ): { pillEqFalse: number; threadEqFalse: number; pillEqCalls: number; threadEqCalls: number } {
    let pillEqFalse = 0;
    let threadEqFalse = 0;
    let pillEqCalls = 0;
    let threadEqCalls = 0;

    for (const [from, oldWidget] of before) {
      const newWidget = after.get(from);
      if (!newWidget) continue;
      if (oldWidget instanceof PillWidget && newWidget instanceof PillWidget) {
        pillEqCalls++;
        if (!oldWidget.eq(newWidget)) pillEqFalse++;
      } else if (oldWidget instanceof ThreadWidget && newWidget instanceof ThreadWidget) {
        threadEqCalls++;
        if (!oldWidget.eq(newWidget)) threadEqFalse++;
      }
    }
    return { pillEqFalse, threadEqFalse, pillEqCalls, threadEqCalls };
  }

  function installDOMSpies(): {
    pillToDOM: number;
    threadToDOM: number;
    restore: () => void;
  } {
    const stats = { pillToDOM: 0, threadToDOM: 0 };
    const origPillToDOM = PillWidget.prototype.toDOM;
    const origThreadToDOM = ThreadWidget.prototype.toDOM;

    const pillSpy = vi
      .spyOn(PillWidget.prototype, "toDOM")
      .mockImplementation(function (this: PillWidget, view: EditorView) {
        stats.pillToDOM++;
        return origPillToDOM.call(this, view);
      });
    const threadSpy = vi
      .spyOn(ThreadWidget.prototype, "toDOM")
      .mockImplementation(function (this: ThreadWidget, view: EditorView) {
        stats.threadToDOM++;
        return origThreadToDOM.call(this, view);
      });

    return {
      get pillToDOM() { return stats.pillToDOM; },
      get threadToDOM() { return stats.threadToDOM; },
      restore: () => {
        pillSpy.mockRestore();
        threadSpy.mockRestore();
      },
    };
  }

  // Folding is thread-only, so fold-all targets exactly the thread positions
  // (mirrors toggleAllBlockAnnotationFolds' isFoldAllTarget filter on this
  // pure-multiline, line-start stress fixture).
  function foldAllEffects(view: EditorView) {
    const annotations = view.state.field(annotationDataField);
    const positions = annotations
      .filter((a) => a.annotation_type === "thread")
      .map((a) => a.char_start);
    const foldMap = view.state.field(annotationFoldField, false);
    const allCollapsed = positions.every((pos) => foldMap?.get(pos) ?? false);
    return [setAllAnnotationFoldsEffect.of({ positions, collapsed: !allCollapsed })];
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

  it("fold-all blast radius: bounded by thread count, pill identity preserved", { timeout: 60_000 }, () => {
    const { view, restoreHeights } = makeStressBlockViewFullViewport();
    try {
      const { notes, threads } = countAnnotationMix(view);
      expect(notes + threads).toBe(150);
      expect(notes).toBe(100);
      expect(threads).toBe(50);

      const before = collectBlockWidgets(view);
      expect(before.size).toBe(150);

      const spies = installDOMSpies();
      try {
        view.dispatch({ effects: foldAllEffects(view) });
        const after = collectBlockWidgets(view);
        const blast = measureEqBlastRadius(before, after);

        // Fold-all only targets threads: every thread flips, no pill changes.
        expect(blast.threadEqCalls).toBe(threads);
        expect(blast.threadEqFalse).toBe(threads);
        expect(blast.pillEqFalse).toBe(0);
        // Pill decorations at note positions keep object identity (surgical
        // path never touches non-target positions).
        for (const [from, w] of before) {
          if (w instanceof PillWidget) expect(after.get(from)).toBe(w);
        }
        // Fold flips go through toDOM (no updateDOM); redraw cost is bounded
        // by the drawn threads, and untouched pills are never redrawn.
        expect(spies.threadToDOM).toBeGreaterThanOrEqual(1);
        expect(spies.threadToDOM).toBeLessThanOrEqual(threads);
        expect(spies.pillToDOM).toBe(0);

        console.warn(
          `[perf] H2 blast-radius fold-all: pill eqFalse=${blast.pillEqFalse}/${notes} toDOM=${spies.pillToDOM}; ` +
            `thread eqFalse=${blast.threadEqFalse}/${threads} toDOM=${spies.threadToDOM}`,
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

      view.dispatch({ effects: foldAllEffects(view) });
      const before = collectBlockWidgets(view);
      expect(before.size).toBe(150);

      const spies = installDOMSpies();
      try {
        view.dispatch({ effects: foldAllEffects(view) });
        const after = collectBlockWidgets(view);
        const blast = measureEqBlastRadius(before, after);

        expect(blast.pillEqFalse).toBe(0);
        expect(blast.threadEqFalse).toBe(threads);
        // Fold flips go through toDOM (no updateDOM); redraw cost is bounded
        // by the drawn threads, and untouched pills are never redrawn.
        expect(spies.threadToDOM).toBeGreaterThanOrEqual(1);
        expect(spies.threadToDOM).toBeLessThanOrEqual(threads);
        expect(spies.pillToDOM).toBe(0);

        console.warn(
          `[perf] H2 blast-radius expand-all: pill eqFalse=${blast.pillEqFalse}/${notes} toDOM=${spies.pillToDOM}; ` +
            `thread eqFalse=${blast.threadEqFalse}/${threads} toDOM=${spies.threadToDOM}`,
        );
      } finally {
        spies.restore();
      }
    } finally {
      restoreHeights();
      view.destroy();
    }
  });

  it("single fold toggle on a thread: blast radius is 1", { timeout: 60_000 }, () => {
    const { view, restoreHeights } = makeStressBlockViewFullViewport();
    try {
      const target = view.state
        .field(annotationDataField)
        .find((a) => a.annotation_type === "thread");
      expect(target).toBeDefined();

      const before = collectBlockWidgets(view);
      expect(before.size).toBe(150);

      const spies = installDOMSpies();
      try {
        view.dispatch({ effects: toggleAnnotationFoldEffect.of({ pos: target!.char_start }) });
        const after = collectBlockWidgets(view);
        const blast = measureEqBlastRadius(before, after);

        const totalEqFalse = blast.pillEqFalse + blast.threadEqFalse;
        expect(totalEqFalse).toBe(1);
        // Single fold: at most the one flipped thread is redrawn via toDOM.
        expect(spies.threadToDOM).toBeLessThanOrEqual(1);
        expect(spies.pillToDOM).toBe(0);

        console.warn(
          `[perf] H2 blast-radius single fold: eqFalse=${totalEqFalse} toDOM=${spies.threadToDOM}`,
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
