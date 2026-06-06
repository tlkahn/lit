import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import type { Annotation } from "./ipc";
import { useStatusMessageStore } from "../stores/statusMessage";
import { firingAnnotationsField, threadTurnField } from "../editor/livePreview/annotationWidgets";
import { scopeHighlightField, setScopeHighlight } from "../editor/livePreview/scopeHighlight";
import { Decoration } from "@codemirror/view";
import { Annotation as AnnotationGrammar } from "../editor/markdown/annotation";
import { Comment as CommentGrammar } from "../editor/markdown/comment";
import {
  exportThreadToMarkdown,
  exportTurnToMarkdown,
  copyThreadExport,
  deleteThread,
} from "./threadExport";

const flush = (n = 5) =>
  Array.from({ length: n }).reduce<Promise<void>>(
    (p) => p.then(() => new Promise((r) => queueMicrotask(r))),
    Promise.resolve(),
  );

function makeView(doc: string): EditorView {
  return new EditorView({
    state: EditorState.create({
      doc,
      extensions: [firingAnnotationsField, threadTurnField],
    }),
    parent: document.createElement("div"),
  });
}

/** A real markdown view whose syntaxTree resolves BlockAnnotation nodes. */
function makeMarkdownView(doc: string): EditorView {
  const view = new EditorView({
    state: EditorState.create({
      doc,
      extensions: [markdown({ extensions: [CommentGrammar, AnnotationGrammar] })],
    }),
    parent: document.createElement("div"),
  });
  ensureSyntaxTree(view.state, view.state.doc.length);
  return view;
}

/** Resolve the live span of the BlockAnnotation enclosing `pos`, or null. */
function liveRangeAt(view: EditorView, pos: number): { from: number; to: number } | null {
  let n: ReturnType<typeof syntaxTree>["topNode"] | null = syntaxTree(view.state).resolveInner(
    pos,
    1,
  );
  while (n && n.name !== "BlockAnnotation") n = n.parent;
  return n ? { from: n.from, to: n.to } : null;
}

const PREFIX = "before text\n";
const SUFFIX = "\nafter text";
const THREAD_BODY = "[q]: A\n\nrespA\n\n[q]: B\n\nrespB";
const THREAD_DSL = `<!---[abc-123]\nth\n\\p\n---\n${THREAD_BODY}\n--->`;
const DOC = PREFIX + THREAD_DSL + SUFFIX;
const THREAD_START = PREFIX.length;
const THREAD_END = PREFIX.length + THREAD_DSL.length;

function makeThreadAnnotation(overrides: Partial<Annotation> = {}): Annotation {
  return {
    form: "block",
    annotation_type: "thread",
    certainty: "neutral",
    scope: { kind: "sentence", value: 1 },
    body: THREAD_BODY,
    date: null,
    is_structured: true,
    char_start: THREAD_START,
    char_end: THREAD_END,
    original: THREAD_DSL,
    uuid: "abc-123",
    ...overrides,
  };
}

describe("exportThreadToMarkdown", () => {
  it("emits one [!question] callout + blank line + response per turn, turns separated by a blank line", () => {
    const md = exportThreadToMarkdown(makeThreadAnnotation());
    expect(md).toBe("> [!question] A\n\nrespA\n\n> [!question] B\n\nrespB");
  });

  it("emits the response with NO heading for a no-question turn", () => {
    const md = exportThreadToMarkdown(makeThreadAnnotation({ body: "just a response" }));
    expect(md).toBe("just a response");
  });

  it("returns '' for an empty body", () => {
    expect(exportThreadToMarkdown(makeThreadAnnotation({ body: "" }))).toBe("");
  });

  it("returns '' for a whitespace-only body", () => {
    expect(exportThreadToMarkdown(makeThreadAnnotation({ body: "   \n  " }))).toBe("");
  });

  it("returns '' for a null body", () => {
    expect(exportThreadToMarkdown(makeThreadAnnotation({ body: null }))).toBe("");
  });
});

describe("exportTurnToMarkdown", () => {
  it("returns only the requested turn formatted with a callout", () => {
    const md = exportTurnToMarkdown(makeThreadAnnotation(), 1);
    expect(md).toBe("> [!question] B\n\nrespB");
  });

  it("returns the first turn for index 0", () => {
    const md = exportTurnToMarkdown(makeThreadAnnotation(), 0);
    expect(md).toBe("> [!question] A\n\nrespA");
  });

  it("returns '' and does not throw for a negative index", () => {
    expect(() => exportTurnToMarkdown(makeThreadAnnotation(), -5)).not.toThrow();
    expect(exportTurnToMarkdown(makeThreadAnnotation(), -5)).toBe("");
  });

  it("returns '' for an out-of-range index", () => {
    expect(exportTurnToMarkdown(makeThreadAnnotation(), 99)).toBe("");
  });

  it("formats a no-question single turn without a heading", () => {
    const md = exportTurnToMarkdown(makeThreadAnnotation({ body: "lone response" }), 0);
    expect(md).toBe("lone response");
  });
});

describe("copyThreadExport", () => {
  let writeText: ReturnType<typeof vi.fn>;
  let original: typeof navigator.clipboard;

  beforeEach(() => {
    useStatusMessageStore.setState({ message: null, variant: "success" });
    writeText = vi.fn().mockResolvedValue(undefined);
    original = navigator.clipboard;
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    Object.defineProperty(navigator, "clipboard", {
      value: original,
      writable: true,
      configurable: true,
    });
  });

  it("turn === -1 copies the full thread markdown and shows a success toast", async () => {
    await copyThreadExport(makeThreadAnnotation(), -1);
    await flush();
    expect(writeText).toHaveBeenCalledWith("> [!question] A\n\nrespA\n\n> [!question] B\n\nrespB");
    expect(useStatusMessageStore.getState().variant).toBe("success");
    expect(useStatusMessageStore.getState().message).toBeTruthy();
  });

  it("turn === 0 copies only that turn's markdown", async () => {
    await copyThreadExport(makeThreadAnnotation(), 0);
    await flush();
    expect(writeText).toHaveBeenCalledWith("> [!question] A\n\nrespA");
  });

  it("shows an error toast when writeText rejects", async () => {
    writeText.mockRejectedValueOnce(new Error("denied"));
    await copyThreadExport(makeThreadAnnotation(), -1);
    await flush();
    expect(useStatusMessageStore.getState().variant).toBe("error");
  });

  it("shows an error toast and does NOT write an empty string for an empty thread", async () => {
    await copyThreadExport(makeThreadAnnotation({ body: "" }), -1);
    await flush();
    expect(writeText).not.toHaveBeenCalled();
    expect(useStatusMessageStore.getState().variant).toBe("error");
  });
});

describe("deleteThread", () => {
  it("removes exactly char_start..char_end, leaving prefix + suffix", () => {
    const view = makeView(DOC);
    deleteThread(view, makeThreadAnnotation());
    const result = view.state.doc.toString();
    expect(result).toBe(PREFIX + SUFFIX);
    expect(result).not.toContain(THREAD_DSL);
    view.destroy();
  });

  it("does not throw when the view is already destroyed", () => {
    const view = makeView(DOC);
    view.destroy();
    expect(() => deleteThread(view, makeThreadAnnotation())).not.toThrow();
  });

  it("deletes the LIVE thread span after an edit shifts it, not the stale char_start/char_end", () => {
    const view = makeMarkdownView(DOC);
    // Shift the whole thread right by 4 while the annotation's captured
    // char_start/char_end stay at their pre-edit (now stale) values.
    view.dispatch({ changes: { from: 0, insert: "XXXX" } });
    ensureSyntaxTree(view.state, view.state.doc.length);

    // Re-resolve the live range at the thread's now-shifted position, the way
    // the production widget does via view.posAtDOM(container).
    const live = liveRangeAt(view, THREAD_START + 4 + 5);
    expect(live).not.toBeNull();

    deleteThread(view, makeThreadAnnotation(), live ?? undefined);

    const result = view.state.doc.toString();
    expect(result).toBe("XXXX" + PREFIX + SUFFIX);
    expect(result).not.toContain(THREAD_DSL);
    view.destroy();
  });

  it("is a no-op (no throw, doc unchanged) when the thread node no longer exists", () => {
    const view = makeView(PREFIX + SUFFIX);
    const before = view.state.doc.toString();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    // Captured offsets point past the end of this (thread-less) document.
    expect(() =>
      deleteThread(view, makeThreadAnnotation({ char_start: 9999, char_end: 99999 })),
    ).not.toThrow();
    expect(view.state.doc.toString()).toBe(before);
    warnSpy.mockRestore();
    view.destroy();
  });

  it("logs a console.warn with range values when bounds-check fails", () => {
    const view = makeView(PREFIX + SUFFIX);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    deleteThread(view, makeThreadAnnotation({ char_start: 9999, char_end: 99999 }));
    expect(warnSpy).toHaveBeenCalledOnce();
    const msg = warnSpy.mock.calls[0]![0] as string;
    expect(msg).toContain("9999");
    expect(msg).toContain("99999");
    warnSpy.mockRestore();
    view.destroy();
  });

  it("logs a console.warn when from >= to (inverted range)", () => {
    const view = makeView(DOC);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    deleteThread(view, makeThreadAnnotation({ char_start: 10, char_end: 5 }));
    expect(warnSpy).toHaveBeenCalledOnce();
    warnSpy.mockRestore();
    view.destroy();
  });

  it("does NOT log console.warn on a successful delete", () => {
    const view = makeView(DOC);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    deleteThread(view, makeThreadAnnotation());
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
    view.destroy();
  });

  it("clears the scope highlight when deleting a thread", () => {
    const view = new EditorView({
      state: EditorState.create({
        doc: DOC,
        extensions: [scopeHighlightField],
      }),
      parent: document.createElement("div"),
    });
    view.dispatch({ effects: setScopeHighlight.of({ from: 0, to: 5 }) });
    expect(view.state.field(scopeHighlightField)).not.toBe(Decoration.none);

    deleteThread(view, makeThreadAnnotation());
    expect(view.state.field(scopeHighlightField)).toBe(Decoration.none);
    view.destroy();
  });
});
