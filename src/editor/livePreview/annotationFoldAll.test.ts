import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import {
  annotationDataField,
  setAnnotationData,
  annotationBlockDecorationField,
  displayModeField,
} from "./annotationState";
import {
  annotationFoldField,
  toggleAnnotationFoldEffect,
  ThreadWidget,
  threadTurnField,
  firingAnnotationsField,
  llmLockedField,
} from "./annotationWidgets";
import { isFoldAllTarget, toggleAllBlockAnnotationFolds } from "./annotationFoldAll";
import { Annotation as AnnotationGrammar } from "../markdown/annotation";
import { Comment as CommentGrammar } from "../markdown/comment";
import type { Annotation } from "../../lib/ipc";

vi.mock("../../lib/ipc", () => ({
  parseAnnotations: vi.fn(async () => []),
  listAnnotations: vi.fn(async () => []),
}));

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

const TWO_BLOCK_DOC = "first line\n\n<!---\nbody A\n--->\nmiddle\n\n<!---\nbody B\n--->\ntail";

function makeViewWithBlocks(anchor = 0) {
  const state = EditorState.create({
    doc: TWO_BLOCK_DOC,
    selection: { anchor },
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
  const blocks: Array<{ from: number; to: number }> = [];
  syntaxTree(view.state).iterate({
    enter: (node) => {
      if (node.name === "BlockAnnotation") blocks.push({ from: node.from, to: node.to });
    },
  });
  expect(blocks.length).toBe(2);
  const annotations = blocks.map((b) =>
    makeAnnotation({
      form: "block",
      annotation_type: "thread",
      char_start: b.from,
      char_end: b.to,
      original: TWO_BLOCK_DOC.slice(b.from, b.to),
    }),
  );
  view.dispatch({ effects: setAnnotationData.of(annotations) });
  return { view, A: blocks[0]!, B: blocks[1]! };
}

function isCollapsedAt(view: EditorView, from: number): boolean | undefined {
  const iter = view.state.field(annotationBlockDecorationField).decorations.iter();
  while (iter.value) {
    if (iter.from === from) {
      const w = iter.value.spec?.widget;
      if (w instanceof ThreadWidget) return w.isCollapsed;
    }
    iter.next();
  }
  return undefined;
}

describe("toggleAllBlockAnnotationFolds", () => {
  it("D1: collapses all expanded multiline thread annotations", () => {
    const { view, A, B } = makeViewWithBlocks();
    try {
      expect(isCollapsedAt(view, A.from)).toBe(false);
      expect(isCollapsedAt(view, B.from)).toBe(false);

      const result = toggleAllBlockAnnotationFolds(view);
      expect(result).toBe(true);

      expect(isCollapsedAt(view, A.from)).toBe(true);
      expect(isCollapsedAt(view, B.from)).toBe(true);
    } finally {
      view.destroy();
    }
  });

  it("D2: expands all when every thread annotation is collapsed", () => {
    const { view, A, B } = makeViewWithBlocks();
    try {
      toggleAllBlockAnnotationFolds(view);
      expect(isCollapsedAt(view, A.from)).toBe(true);
      expect(isCollapsedAt(view, B.from)).toBe(true);

      const result = toggleAllBlockAnnotationFolds(view);
      expect(result).toBe(true);
      expect(isCollapsedAt(view, A.from)).toBe(false);
      expect(isCollapsedAt(view, B.from)).toBe(false);
    } finally {
      view.destroy();
    }
  });

  it("D3: mixed fold state -> collapses all", () => {
    const { view, A, B } = makeViewWithBlocks();
    try {
      view.dispatch({ effects: toggleAnnotationFoldEffect.of({ pos: A.from }) });
      expect(isCollapsedAt(view, A.from)).toBe(true);
      expect(isCollapsedAt(view, B.from)).toBe(false);

      toggleAllBlockAnnotationFolds(view);
      expect(isCollapsedAt(view, A.from)).toBe(true);
      expect(isCollapsedAt(view, B.from)).toBe(true);
    } finally {
      view.destroy();
    }
  });

  it("D4: collapse-all propagates to the block-field widgets (isCollapsed=true)", () => {
    const { view } = makeViewWithBlocks();
    try {
      toggleAllBlockAnnotationFolds(view);

      const iter = view.state.field(annotationBlockDecorationField).decorations.iter();
      const widgets: Array<{ from: number; collapsed: boolean }> = [];
      while (iter.value) {
        const w = iter.value.spec?.widget;
        if (w instanceof ThreadWidget) {
          widgets.push({ from: iter.from, collapsed: w.isCollapsed });
        }
        iter.next();
      }
      expect(widgets.length).toBe(2);
      expect(widgets.every((w) => w.collapsed)).toBe(true);
    } finally {
      view.destroy();
    }
  });

  it("D5: records fold state for a thread the cursor sits inside", () => {
    const { view, A, B } = makeViewWithBlocks();
    try {
      view.dispatch({ selection: { anchor: A.from + 2 } });

      toggleAllBlockAnnotationFolds(view);

      const foldMap = view.state.field(annotationFoldField);
      expect(foldMap.get(A.from)).toBe(true);
      expect(foldMap.get(B.from)).toBe(true);
    } finally {
      view.destroy();
    }
  });

  it("D5b: cursor-suppressed thread reveals collapsed widget after cursor exits", () => {
    const { view, A, B } = makeViewWithBlocks();
    try {
      view.dispatch({ selection: { anchor: A.from + 2 } });

      toggleAllBlockAnnotationFolds(view);

      expect(isCollapsedAt(view, A.from)).toBeUndefined();
      expect(view.state.field(annotationFoldField).get(A.from)).toBe(true);

      view.dispatch({ selection: { anchor: 0 } });

      expect(isCollapsedAt(view, A.from)).toBe(true);
      expect(isCollapsedAt(view, B.from)).toBe(true);
    } finally {
      view.destroy();
    }
  });

  it("D6: returns false without dispatching when there are no annotations", () => {
    const state = EditorState.create({
      doc: "plain text\nno annotations",
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
    const dispatchSpy = vi.spyOn(view, "dispatch");
    try {
      const result = toggleAllBlockAnnotationFolds(view);
      expect(result).toBe(false);
      expect(dispatchSpy).not.toHaveBeenCalled();
    } finally {
      dispatchSpy.mockRestore();
      view.destroy();
    }
  });

  it("D7: returns false when only single-line annotations exist", () => {
    const doc = "first line\n<!---single-line--->\ntail";
    const state = EditorState.create({
      doc,
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
    const ann = makeAnnotation({
      annotation_type: "thread",
      char_start: 11,
      char_end: 31,
      original: "<!---single-line--->",
    });
    view.dispatch({ effects: setAnnotationData.of([ann]) });
    const dispatchSpy = vi.spyOn(view, "dispatch");
    try {
      const result = toggleAllBlockAnnotationFolds(view);
      expect(result).toBe(false);
      expect(dispatchSpy).not.toHaveBeenCalled();
    } finally {
      dispatchSpy.mockRestore();
      view.destroy();
    }
  });

  it("D8: ignores single-line annotation data even when a multiline block node exists", () => {
    const doc = "first line\n\n<!---\nmultiline body\n--->\ntail";
    const state = EditorState.create({
      doc,
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
    // char_start:12 char_end:17 are both on line 3 ("<!---"), so this is single-line
    const ann = makeAnnotation({
      annotation_type: "thread",
      char_start: 12,
      char_end: 17,
      original: "<!---single--->",
    });
    view.dispatch({ effects: setAnnotationData.of([ann]) });
    const dispatchSpy = vi.spyOn(view, "dispatch");
    try {
      const result = toggleAllBlockAnnotationFolds(view);
      expect(result).toBe(false);
      expect(dispatchSpy).not.toHaveBeenCalled();
    } finally {
      dispatchSpy.mockRestore();
      view.destroy();
    }
  });

  it("D9: skips mid-line multiline annotations that render no callout", () => {
    const doc = "first line\n\ntext <!---\nmultiline\n---> more\n\n<!---\nreal block\n--->\ntail";
    const state = EditorState.create({
      doc,
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
    const blocks: Array<{ from: number; to: number }> = [];
    syntaxTree(view.state).iterate({
      enter: (node) => {
        if (node.name === "BlockAnnotation") blocks.push({ from: node.from, to: node.to });
      },
    });
    const realBlock = blocks.find((b) => view.state.doc.lineAt(b.from).from === b.from);
    expect(realBlock).toBeDefined();
    const annotations = [
      makeAnnotation({
        form: "block",
        annotation_type: "thread",
        char_start: 17,
        char_end: 40,
        original: doc.slice(17, 40),
      }),
      makeAnnotation({
        form: "block",
        annotation_type: "thread",
        char_start: realBlock!.from,
        char_end: realBlock!.to,
        original: doc.slice(realBlock!.from, realBlock!.to),
      }),
    ];
    view.dispatch({ effects: setAnnotationData.of(annotations) });
    try {
      toggleAllBlockAnnotationFolds(view);

      const foldMap = view.state.field(annotationFoldField);
      expect(foldMap.has(17)).toBe(false);
      expect(foldMap.get(realBlock!.from)).toBe(true);
    } finally {
      view.destroy();
    }
  });

  it("D10: bounds guard - stale annotation with char_end > doc.length is skipped", () => {
    const doc = "short";
    const state = EditorState.create({
      doc,
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
    const ann = makeAnnotation({
      form: "block",
      annotation_type: "thread",
      char_start: 0,
      char_end: 999,
      original: "<!---\nstale\n--->",
    });
    view.dispatch({ effects: setAnnotationData.of([ann]) });
    const dispatchSpy = vi.spyOn(view, "dispatch");
    try {
      expect(() => toggleAllBlockAnnotationFolds(view)).not.toThrow();
      const result = toggleAllBlockAnnotationFolds(view);
      expect(result).toBe(false);
      expect(dispatchSpy).not.toHaveBeenCalled();
    } finally {
      dispatchSpy.mockRestore();
      view.destroy();
    }
  });

  it("D11a: targets annotations derived from annotation data, not the syntax tree", () => {
    const { view } = makeViewWithBlocks();
    try {
      const result = toggleAllBlockAnnotationFolds(view);
      expect(result).toBe(true);
      const foldMap = view.state.field(annotationFoldField);
      expect(foldMap.size).toBe(2);
      for (const v of foldMap.values()) expect(v).toBe(true);
    } finally {
      view.destroy();
    }
  });

  it("D12: returns false without throwing when annotationExtension is absent", () => {
    const view = new EditorView({ state: EditorState.create({ doc: "hello" }) });
    let result: boolean | undefined;
    expect(() => { result = toggleAllBlockAnnotationFolds(view); }).not.toThrow();
    expect(result).toBe(false);
    view.destroy();
  });

  it("D13: a non-thread multiline block annotation is not a fold-all target", () => {
    // Same geometry as a valid target (line-start, multiline, in bounds), but
    // folding is thread-only — the annotation type disqualifies it.
    const doc = EditorState.create({ doc: "first line\n\n<!---\nbody\n--->\ntail" }).doc;
    const note = makeAnnotation({
      form: "block",
      annotation_type: "note",
      char_start: 12,
      char_end: 27,
      original: "<!---\nbody\n--->",
    });
    expect(isFoldAllTarget(doc, note)).toBe(false);

    const thread = { ...note, annotation_type: "thread" as const };
    expect(isFoldAllTarget(doc, thread)).toBe(true);
  });

  it("D14: returns false without dispatching when only non-thread multiline blocks exist", () => {
    const state = EditorState.create({
      doc: TWO_BLOCK_DOC,
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
    const blocks: Array<{ from: number; to: number }> = [];
    syntaxTree(view.state).iterate({
      enter: (node) => {
        if (node.name === "BlockAnnotation") blocks.push({ from: node.from, to: node.to });
      },
    });
    expect(blocks.length).toBe(2);
    view.dispatch({
      effects: setAnnotationData.of(
        blocks.map((b) =>
          makeAnnotation({
            form: "block",
            annotation_type: "note",
            char_start: b.from,
            char_end: b.to,
            original: TWO_BLOCK_DOC.slice(b.from, b.to),
          }),
        ),
      ),
    });
    const dispatchSpy = vi.spyOn(view, "dispatch");
    try {
      const result = toggleAllBlockAnnotationFolds(view);
      expect(result).toBe(false);
      expect(dispatchSpy).not.toHaveBeenCalled();
    } finally {
      dispatchSpy.mockRestore();
      view.destroy();
    }
  });

  it("D15: mixed doc — fold-all records only thread positions in annotationFoldField", () => {
    const state = EditorState.create({
      doc: TWO_BLOCK_DOC,
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
    const blocks: Array<{ from: number; to: number }> = [];
    syntaxTree(view.state).iterate({
      enter: (node) => {
        if (node.name === "BlockAnnotation") blocks.push({ from: node.from, to: node.to });
      },
    });
    expect(blocks.length).toBe(2);
    view.dispatch({
      effects: setAnnotationData.of([
        makeAnnotation({
          form: "block",
          annotation_type: "note",
          char_start: blocks[0]!.from,
          char_end: blocks[0]!.to,
          original: TWO_BLOCK_DOC.slice(blocks[0]!.from, blocks[0]!.to),
        }),
        makeAnnotation({
          form: "block",
          annotation_type: "thread",
          char_start: blocks[1]!.from,
          char_end: blocks[1]!.to,
          original: TWO_BLOCK_DOC.slice(blocks[1]!.from, blocks[1]!.to),
        }),
      ]),
    });
    try {
      const result = toggleAllBlockAnnotationFolds(view);
      expect(result).toBe(true);

      const foldMap = view.state.field(annotationFoldField);
      expect(foldMap.has(blocks[0]!.from)).toBe(false);
      expect(foldMap.get(blocks[1]!.from)).toBe(true);
    } finally {
      view.destroy();
    }
  });

  it("D11b: implementation never imports syntaxTree or @codemirror/language", async () => {
    const src = await import("./annotationFoldAll?raw");
    const raw = typeof src === "string" ? src : (src as { default: string }).default;
    expect(raw).not.toContain("syntaxTree");
    expect(raw).not.toContain("@codemirror/language");
  });
});

describe("toggleAllBlockAnnotationFolds - parse frontier", () => {
  const FILLER_LINE = "this is a line of plain filler text to pad the document out\n";
  const PREFIX = FILLER_LINE.repeat(2000);
  const BLOCK = "<!---\nn\n---\nlate body\n--->";
  const DOC = PREFIX + "\n" + BLOCK + "\ntrailer\n";
  const BLOCK_FROM = PREFIX.length + 1;
  const BLOCK_TO = BLOCK_FROM + BLOCK.length;

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
          annotation_type: "thread",
          char_start: BLOCK_FROM,
          char_end: BLOCK_TO,
          original: BLOCK,
        }),
      ]),
    });
    return view;
  }

  afterEach(() => {
    vi.mocked(ensureSyntaxTree).mockReset();
  });

  it("targets annotations beyond the parse frontier even when the parse budget is exhausted", () => {
    const view = makeFrontierView();
    try {
      expect(syntaxTree(view.state).length).toBeLessThan(BLOCK_FROM);
      vi.mocked(ensureSyntaxTree).mockReturnValue(null);

      expect(toggleAllBlockAnnotationFolds(view)).toBe(true);
      expect(view.state.field(annotationFoldField).get(BLOCK_FROM)).toBe(true);
    } finally {
      view.destroy();
    }
  });

  it("never re-enters the parser (ensureSyntaxTree not called)", () => {
    const view = makeFrontierView();
    try {
      vi.mocked(ensureSyntaxTree).mockClear();

      toggleAllBlockAnnotationFolds(view);
      expect(ensureSyntaxTree).not.toHaveBeenCalled();
    } finally {
      view.destroy();
    }
  });
});
