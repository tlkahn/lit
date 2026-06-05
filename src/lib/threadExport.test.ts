import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import type { Annotation } from "./ipc";
import { useStatusMessageStore } from "../stores/statusMessage";
import { firingAnnotationsField, threadTurnField } from "../editor/livePreview/annotationWidgets";
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
  it("emits one '## Q: <question>' heading + blank line + response per turn, turns separated by a blank line", () => {
    const md = exportThreadToMarkdown(makeThreadAnnotation());
    expect(md).toBe("## Q: A\n\nrespA\n\n## Q: B\n\nrespB");
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
  it("returns only the requested turn formatted with a heading", () => {
    const md = exportTurnToMarkdown(makeThreadAnnotation(), 1);
    expect(md).toBe("## Q: B\n\nrespB");
  });

  it("returns the first turn for index 0", () => {
    const md = exportTurnToMarkdown(makeThreadAnnotation(), 0);
    expect(md).toBe("## Q: A\n\nrespA");
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
    expect(writeText).toHaveBeenCalledWith("## Q: A\n\nrespA\n\n## Q: B\n\nrespB");
    expect(useStatusMessageStore.getState().variant).toBe("success");
    expect(useStatusMessageStore.getState().message).toBeTruthy();
  });

  it("turn === 0 copies only that turn's markdown", async () => {
    await copyThreadExport(makeThreadAnnotation(), 0);
    await flush();
    expect(writeText).toHaveBeenCalledWith("## Q: A\n\nrespA");
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
});
