import { describe, it, expect } from "vitest";
import { EditorState } from "@codemirror/state";
import { Decoration, EditorView } from "@codemirror/view";
import {
  flashHighlightField,
  setFlashHighlight,
  flashHighlightExtension,
} from "./flashHighlight";

describe("flashHighlightField", () => {
  it("initial state is Decoration.none", () => {
    const state = EditorState.create({
      doc: "hello world",
      extensions: [flashHighlightField],
    });
    expect(state.field(flashHighlightField)).toBe(Decoration.none);
  });

  it("setFlashHighlight.of({from, to}) creates one cm-block-flash mark", () => {
    const state = EditorState.create({
      doc: "hello world",
      extensions: [flashHighlightField],
    });
    const tr = state.update({ effects: setFlashHighlight.of({ from: 0, to: 5 }) });
    const decos = tr.state.field(flashHighlightField);
    const iter = decos.iter();
    expect(iter.value).not.toBeNull();
    expect(iter.from).toBe(0);
    expect(iter.to).toBe(5);
    expect(iter.value!.spec.class).toBe("cm-block-flash");
    iter.next();
    expect(iter.value).toBeNull();
  });

  it("zero-width range produces Decoration.none", () => {
    const state = EditorState.create({
      doc: "hello world",
      extensions: [flashHighlightField],
    });
    const tr = state.update({ effects: setFlashHighlight.of({ from: 5, to: 5 }) });
    expect(tr.state.field(flashHighlightField)).toBe(Decoration.none);
  });

  it("inverted range produces Decoration.none", () => {
    const state = EditorState.create({
      doc: "hello world",
      extensions: [flashHighlightField],
    });
    const tr = state.update({ effects: setFlashHighlight.of({ from: 9, to: 2 }) });
    expect(tr.state.field(flashHighlightField)).toBe(Decoration.none);
  });

  it("setFlashHighlight.of(null) clears the mark", () => {
    const state = EditorState.create({
      doc: "hello world",
      extensions: [flashHighlightField],
    });
    const tr1 = state.update({ effects: setFlashHighlight.of({ from: 0, to: 5 }) });
    const tr2 = tr1.state.update({ effects: setFlashHighlight.of(null) });
    expect(tr2.state.field(flashHighlightField)).toBe(Decoration.none);
  });

  it("flashHighlightExtension renders .cm-block-flash in DOM", () => {
    const parent = document.createElement("div");
    const view = new EditorView({
      state: EditorState.create({
        doc: "hello world",
        extensions: [flashHighlightExtension()],
      }),
      parent,
    });
    view.dispatch({ effects: setFlashHighlight.of({ from: 0, to: 5 }) });
    expect(parent.querySelector(".cm-block-flash")).not.toBeNull();
    view.destroy();
  });
});
