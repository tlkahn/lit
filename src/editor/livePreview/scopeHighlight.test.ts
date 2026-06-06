import { describe, it, expect } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import {
  scopeHighlightField,
  setScopeHighlight,
  dispatchScopeHighlight,
  clearScopeHighlight,
  scopeHighlightExtension,
} from "./scopeHighlight";
import { Decoration } from "@codemirror/view";

describe("scopeHighlightField", () => {
  it("initial state is Decoration.none", () => {
    const state = EditorState.create({
      doc: "hello world",
      extensions: [scopeHighlightField],
    });
    expect(state.field(scopeHighlightField)).toBe(Decoration.none);
  });

  it("setScopeHighlight.of({from, to}) creates a Decoration.mark at the range", () => {
    const state = EditorState.create({
      doc: "hello world",
      extensions: [scopeHighlightField],
    });
    const tr = state.update({ effects: setScopeHighlight.of({ from: 0, to: 5 }) });
    const decos = tr.state.field(scopeHighlightField);
    const iter = decos.iter();
    expect(iter.value).not.toBeNull();
    expect(iter.from).toBe(0);
    expect(iter.to).toBe(5);
  });

  it("setScopeHighlight.of(null) clears to Decoration.none", () => {
    const state = EditorState.create({
      doc: "hello world",
      extensions: [scopeHighlightField],
    });
    const tr1 = state.update({ effects: setScopeHighlight.of({ from: 0, to: 5 }) });
    const tr2 = tr1.state.update({ effects: setScopeHighlight.of(null) });
    expect(tr2.state.field(scopeHighlightField)).toBe(Decoration.none);
  });

  it("doc change clears highlight instead of remapping", () => {
    const state = EditorState.create({
      doc: "hello world",
      extensions: [scopeHighlightField],
    });
    const tr1 = state.update({ effects: setScopeHighlight.of({ from: 6, to: 11 }) });
    const tr2 = tr1.state.update({ changes: { from: 0, insert: "xx" } });
    expect(tr2.state.field(scopeHighlightField)).toBe(Decoration.none);
  });

  it("highlight clears when annotation text is edited", () => {
    const state = EditorState.create({
      doc: "before [!note] annotation content after",
      extensions: [scopeHighlightField],
    });
    const tr1 = state.update({ effects: setScopeHighlight.of({ from: 7, to: 33 }) });
    const decos1 = tr1.state.field(scopeHighlightField);
    expect(decos1.iter().value).not.toBeNull();
    const tr2 = tr1.state.update({
      changes: { from: 7, to: 15, insert: "" },
    });
    expect(tr2.state.field(scopeHighlightField)).toBe(Decoration.none);
  });

  it("dispatchScopeHighlight dispatches the effect", () => {
    const state = EditorState.create({
      doc: "hello world",
      extensions: [scopeHighlightField],
    });
    const view = new EditorView({ state, parent: document.createElement("div") });
    dispatchScopeHighlight(view, 0, 5);
    const decos = view.state.field(scopeHighlightField);
    const iter = decos.iter();
    expect(iter.from).toBe(0);
    expect(iter.to).toBe(5);
    view.destroy();
  });

  it("clearScopeHighlight clears the highlight", () => {
    const state = EditorState.create({
      doc: "hello world",
      extensions: [scopeHighlightField],
    });
    const view = new EditorView({ state, parent: document.createElement("div") });
    dispatchScopeHighlight(view, 0, 5);
    clearScopeHighlight(view);
    expect(view.state.field(scopeHighlightField)).toBe(Decoration.none);
    view.destroy();
  });

  it("scopeHighlightExtension renders .scope-highlight in DOM", () => {
    const parent = document.createElement("div");
    const view = new EditorView({
      state: EditorState.create({
        doc: "hello world",
        extensions: [scopeHighlightExtension()],
      }),
      parent,
    });
    dispatchScopeHighlight(view, 0, 5);
    const highlight = parent.querySelector(".scope-highlight");
    expect(highlight).not.toBeNull();
    view.destroy();
  });
});
