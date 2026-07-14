import { describe, it, expect } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { Math } from "../markdown/math";
import { findMathRange, createMathClickHandler } from "./mathClickHandler";
import { trackView } from "../../test/cmView";

function makeState(doc: string): EditorState {
  return EditorState.create({
    doc,
    extensions: [markdown({ extensions: [Math] })],
  });
}

describe("findMathRange", () => {
  it("returns range for inline math", () => {
    const state = makeState("$E=mc^2$");
    expect(findMathRange(state, 3)).toEqual({ from: 0, to: 8 });
  });

  it("returns range for display math", () => {
    const state = makeState("$$x^2$$");
    expect(findMathRange(state, 3)).toEqual({ from: 0, to: 7 });
  });

  it("returns null outside math", () => {
    const state = makeState("hello world");
    expect(findMathRange(state, 3)).toBeNull();
  });

  it("returns null outside math when math exists elsewhere", () => {
    const state = makeState("text $x$ more");
    expect(findMathRange(state, 0)).toBeNull();
  });
});

describe("createMathClickHandler", () => {
  it("is a valid Extension", () => {
    const handler = createMathClickHandler();
    expect(() => EditorState.create({ extensions: [handler] })).not.toThrow();
  });

  it("works alongside markdown+math extensions", () => {
    const handler = createMathClickHandler();
    const state = EditorState.create({
      doc: "$x^2$",
      extensions: [markdown({ extensions: [Math] }), handler],
    });
    const view = trackView(new EditorView({ state, parent: document.createElement("div") }));
    expect(view).toBeDefined();
    view.destroy();
  });
});
