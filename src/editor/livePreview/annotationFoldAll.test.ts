import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView, type DecorationSet } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import {
  annotationDataField,
  setAnnotationData,
  displayModeField,
  annotationBlockDecorationField,
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
import { toggleAllBlockAnnotationFolds } from "./annotationFoldAll";
import { Annotation as AnnotationGrammar } from "../markdown/annotation";
import { Comment as CommentGrammar } from "../markdown/comment";
import type { Annotation } from "../../lib/ipc";

vi.mock("../../lib/ipc", () => ({
  parseAnnotations: vi.fn(async () => []),
  listAnnotations: vi.fn(async () => []),
}));

// Spy on ensureSyntaxTree (delegating to the real implementation) so the
// frontier suite can both simulate parse-budget exhaustion and assert the
// toggle never re-enters the parser.
vi.mock("@codemirror/language", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@codemirror/language")>();
  return { ...actual, ensureSyntaxTree: vi.fn(actual.ensureSyntaxTree) };
});

beforeEach(() => {
  vi.clearAllMocks();
});

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
    ...overrides,
  };
}

function makeView(doc: string, cursorPos = 0) {
  const state = EditorState.create({
    doc,
    selection: { anchor: cursorPos },
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
  ensureSyntaxTree(view.state, view.state.doc.length);
  return view;
}

function iterateSet(set: DecorationSet) {
  const out: { from: number; to: number; widget: unknown }[] = [];
  const iter = set.iter();
  while (iter.value) {
    out.push({ from: iter.from, to: iter.to, widget: iter.value.spec?.widget });
    iter.next();
  }
  return out;
}

const THREAD_BODY = "[q]: First?\n\nFirst answer.\n\n[q]: Second?\n\nSecond answer.";

/**
 * Doc with two multiline block annotations: a note callout then a thread.
 * Returns the view plus each block's [from, to) range.
 */
function makeTwoBlockView(cursorPos?: number) {
  const doc = "text\n\n<!---\nn\n---\ncallout body\n--->\n\n<!---\nth\n---\nthread body\n--->\nafter";
  const from1 = doc.indexOf("<!---");
  const to1 = doc.indexOf("--->") + 4;
  const from2 = doc.indexOf("<!---", to1);
  const to2 = doc.indexOf("--->", from2) + 4;
  const view = makeView(doc, cursorPos ?? doc.length - 1);
  const anns = [
    makeAnnotation({
      form: "block",
      annotation_type: "note",
      char_start: from1,
      char_end: to1,
      original: doc.slice(from1, to1),
    }),
    makeAnnotation({
      form: "block",
      annotation_type: "thread",
      body: THREAD_BODY,
      char_start: from2,
      char_end: to2,
      original: doc.slice(from2, to2),
    }),
  ];
  view.dispatch({ effects: setAnnotationData.of(anns) });
  return { view, from1, to1, from2, to2 };
}

describe("toggleAllBlockAnnotationFolds", () => {
  it("collapses all expanded multiline block annotations (callout + thread)", () => {
    const { view, from1, from2 } = makeTwoBlockView();

    expect(toggleAllBlockAnnotationFolds(view)).toBe(true);
    const fold = view.state.field(annotationFoldField);
    expect(fold.get(from1)).toBe(true);
    expect(fold.get(from2)).toBe(true);

    view.destroy();
  });

  it("expands all when every block annotation is collapsed", () => {
    const { view, from1, from2 } = makeTwoBlockView();

    expect(toggleAllBlockAnnotationFolds(view)).toBe(true);
    expect(toggleAllBlockAnnotationFolds(view)).toBe(true);
    const fold = view.state.field(annotationFoldField);
    expect(fold.get(from1)).toBe(false);
    expect(fold.get(from2)).toBe(false);

    view.destroy();
  });

  it("mixed fold state → collapses all", () => {
    const { view, from1, from2 } = makeTwoBlockView();
    view.dispatch({ effects: toggleAnnotationFoldEffect.of({ pos: from1 }) });

    expect(toggleAllBlockAnnotationFolds(view)).toBe(true);
    const fold = view.state.field(annotationFoldField);
    expect(fold.get(from1)).toBe(true);
    expect(fold.get(from2)).toBe(true);

    view.destroy();
  });

  it("collapse-all propagates to the block-field widgets (isCollapsed=true)", () => {
    const { view, from1, to1, from2, to2 } = makeTwoBlockView();

    toggleAllBlockAnnotationFolds(view);
    const decos = iterateSet(view.state.field(annotationBlockDecorationField).decorations);
    const callout = decos.find((d) => d.from === from1 && d.to === to1);
    const thread = decos.find((d) => d.from === from2 && d.to === to2);
    expect(callout!.widget).toBeInstanceOf(CalloutWidget);
    expect((callout!.widget as CalloutWidget).isCollapsed).toBe(true);
    expect(thread!.widget).toBeInstanceOf(ThreadWidget);
    expect((thread!.widget as ThreadWidget).isCollapsed).toBe(true);

    view.destroy();
  });

  it("records fold state for a block annotation the cursor sits inside", () => {
    // Cursor inside the first block suppresses its widget, but the fold state
    // must still be recorded so the callout renders collapsed once the cursor
    // leaves.
    const { view, from1, from2 } = makeTwoBlockView(8);

    expect(toggleAllBlockAnnotationFolds(view)).toBe(true);
    const fold = view.state.field(annotationFoldField);
    expect(fold.get(from1)).toBe(true);
    expect(fold.get(from2)).toBe(true);

    view.destroy();
  });

  it("returns false without dispatching when there are no annotations", () => {
    const view = makeView("plain text\nno annotations here");
    const dispatchSpy = vi.spyOn(view, "dispatch");

    expect(toggleAllBlockAnnotationFolds(view)).toBe(false);
    expect(dispatchSpy).not.toHaveBeenCalled();

    view.destroy();
  });

  it("returns false when only single-line annotations exist", () => {
    // A single-line BlockAnnotation renders as a pill, not a callout — it has
    // no fold state and must not be targeted.
    const doc = "first line\n<!---content--->";
    const view = makeView(doc, 0);
    view.dispatch({
      effects: setAnnotationData.of([
        makeAnnotation({ char_start: 11, char_end: 27, original: "<!---content--->" }),
      ]),
    });
    const dispatchSpy = vi.spyOn(view, "dispatch");

    expect(toggleAllBlockAnnotationFolds(view)).toBe(false);
    expect(dispatchSpy).not.toHaveBeenCalled();
    expect(view.state.field(annotationFoldField).size).toBe(0);

    view.destroy();
  });

  it("ignores single-line annotation data even when a multiline block node exists", () => {
    // The only annotation on record (0..4, "text") spans a single line, so it
    // is excluded by the line-span filter; the multiline block node in the doc
    // has no matching data and must not be targeted.
    const doc = "text\n\n<!---\nn\n---\nbody\n--->\nafter";
    const view = makeView(doc, doc.length - 1);
    view.dispatch({
      effects: setAnnotationData.of([
        makeAnnotation({ form: "block", char_start: 0, char_end: 4, original: "text" }),
      ]),
    });
    const dispatchSpy = vi.spyOn(view, "dispatch");

    expect(toggleAllBlockAnnotationFolds(view)).toBe(false);
    expect(dispatchSpy).not.toHaveBeenCalled();

    view.destroy();
  });
});

describe("toggleAllBlockAnnotationFolds — parse frontier", () => {
  // Reproduces the large-doc scenario: the initial parse frontier sits far
  // before a late block annotation, and the bounded ensureSyntaxTree push
  // exhausts its budget without finishing (returns null). The annotation data
  // (Rust-parsed over the full document text) still covers everything, so the
  // toggle must target the late annotation without touching the parser.
  const FILLER_LINE = "this is a line of plain filler text to pad the document out\n";
  const PREFIX = FILLER_LINE.repeat(2000);
  const BLOCK = "<!---\nn\n---\nlate body\n--->";
  const DOC = PREFIX + "\n" + BLOCK + "\ntrailer\n";
  const BLOCK_FROM = PREFIX.length + 1; // after the blank separator line
  const BLOCK_TO = BLOCK_FROM + BLOCK.length;

  /** makeView minus the full-doc ensureSyntaxTree call — keeps the initial
   *  parse frontier where EditorView creation left it (well before BLOCK). */
  function makeFrontierView() {
    const state = EditorState.create({
      doc: DOC,
      selection: { anchor: 0 },
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
    view.dispatch({
      effects: setAnnotationData.of([
        makeAnnotation({
          form: "block",
          char_start: BLOCK_FROM,
          char_end: BLOCK_TO,
          original: BLOCK,
        }),
      ]),
    });
    return view;
  }

  afterEach(() => {
    // mockReset (vitest 3) restores the original implementation passed to
    // vi.fn — drops any mockReturnValue(null) set by a frontier test.
    vi.mocked(ensureSyntaxTree).mockReset();
  });

  it("targets annotations beyond the parse frontier even when the parse budget is exhausted", () => {
    const view = makeFrontierView();
    // Precondition: the initial parse genuinely stopped before the block.
    expect(syntaxTree(view.state).length).toBeLessThan(BLOCK_FROM);
    // Simulate budget exhaustion on a huge doc: the bounded push gives up.
    vi.mocked(ensureSyntaxTree).mockReturnValue(null);

    expect(toggleAllBlockAnnotationFolds(view)).toBe(true);
    expect(view.state.field(annotationFoldField).get(BLOCK_FROM)).toBe(true);

    view.destroy();
  });

  it("never re-enters the parser (ensureSyntaxTree not called)", () => {
    const view = makeFrontierView();
    vi.mocked(ensureSyntaxTree).mockClear();

    toggleAllBlockAnnotationFolds(view);
    expect(ensureSyntaxTree).not.toHaveBeenCalled();

    view.destroy();
  });

  it("skips mid-line multiline annotations that render no callout", () => {
    // The Rust scanner emits a multiline <!---...---> found mid-line, but the
    // Lezer block parser requires the opener at line start (/^<!---/) and the
    // inline parser rejects newlines — no node exists and no callout renders.
    // The line-start parity guard must keep it out of the fold map.
    const doc = "text <!---\nn | x\n---> more\n\n<!---\nn\n---\nreal body\n--->\nafter";
    const phantomFrom = doc.indexOf("<!---");
    const phantomTo = doc.indexOf("--->") + 4;
    const realFrom = doc.indexOf("<!---", phantomTo);
    const realTo = doc.indexOf("--->", realFrom) + 4;
    const view = makeView(doc, 0);
    view.dispatch({
      effects: setAnnotationData.of([
        makeAnnotation({
          char_start: phantomFrom,
          char_end: phantomTo,
          original: doc.slice(phantomFrom, phantomTo),
        }),
        makeAnnotation({
          form: "block",
          char_start: realFrom,
          char_end: realTo,
          original: doc.slice(realFrom, realTo),
        }),
      ]),
    });

    expect(toggleAllBlockAnnotationFolds(view)).toBe(true);
    const fold = view.state.field(annotationFoldField);
    expect(fold.get(realFrom)).toBe(true);
    expect(fold.has(phantomFrom)).toBe(false);

    view.destroy();
  });
});
