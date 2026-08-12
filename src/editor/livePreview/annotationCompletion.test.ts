import { describe, it, expect } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { CompletionContext } from "@codemirror/autocomplete";
import { annotationCompletionSource } from "./annotationCompletion";

function getCompletions(doc: string, pos: number) {
  const state = EditorState.create({ doc });
  const ctx = new CompletionContext(state, pos, false);
  return annotationCompletionSource(ctx);
}

function getExplicitCompletions(doc: string, pos: number) {
  const state = EditorState.create({ doc });
  const ctx = new CompletionContext(state, pos, true);
  return annotationCompletionSource(ctx);
}

describe("annotationCompletionSource", () => {
    it("/llm no longer offers a completion (#1010)", () => {
    const result = getCompletions("/llm", 4);
    expect(result).toBeNull();
  });

  it("/todo triggers completion", () => {
    const result = getCompletions("/todo", 5);
    expect(result).not.toBeNull();
    expect(result!.options.some((o: { label: string }) => o.label === "/todo")).toBe(true);
  });

  it("/q triggers completion", () => {
    const result = getCompletions("/q", 2);
    expect(result).not.toBeNull();
    expect(result!.options.some((o: { label: string }) => o.label === "/q")).toBe(true);
  });

  it("/n triggers completion", () => {
    const result = getCompletions("/n", 2);
    expect(result).not.toBeNull();
    expect(result!.options.some((o: { label: string }) => o.label === "/n")).toBe(true);
  });

  it("/tr triggers completion", () => {
    const result = getCompletions("/tr", 3);
    expect(result).not.toBeNull();
    expect(result!.options.some((o: { label: string }) => o.label === "/tr")).toBe(true);
  });

  it("/cf triggers completion", () => {
    const result = getCompletions("/cf", 3);
    expect(result).not.toBeNull();
    expect(result!.options.some((o: { label: string }) => o.label === "/cf")).toBe(true);
  });

  it("/app triggers completion", () => {
    const result = getCompletions("/app", 4);
    expect(result).not.toBeNull();
    expect(result!.options.some((o: { label: string }) => o.label === "/app")).toBe(true);
  });

  it("/random does NOT trigger annotation completion", () => {
    const result = getCompletions("/random", 7);
    expect(result).toBeNull();
  });

  it("text without slash does not trigger", () => {
    const result = getCompletions("hello", 5);
    expect(result).toBeNull();
  });

  it("bare / triggers all completions explicitly", () => {
    const result = getExplicitCompletions("/", 1);
    expect(result).not.toBeNull();
    expect(result!.options.length).toBe(6);
  });

  it("cursor position is between | and ---> after apply", () => {
    const result = getCompletions("/q", 2);
    expect(result).not.toBeNull();

    const view = new EditorView({
      state: EditorState.create({ doc: "/q" }),
      parent: document.createElement("div"),
    });

    const qOption = result!.options.find((o: { label: string }) => o.label === "/q")!;
    const apply = qOption.apply as (view: EditorView, completion: unknown, from: number, to: number) => void;
    apply(view, null, 0, 2);

    expect(view.state.doc.toString()).toBe("<!--- q |  --->");
    const cursor = view.state.selection.main.head;
    const docText = view.state.doc.toString();
    expect(docText[cursor - 1]).toBe(" ");
    expect(docText.slice(cursor)).toBe(" --->");
    view.destroy();
  });
});
