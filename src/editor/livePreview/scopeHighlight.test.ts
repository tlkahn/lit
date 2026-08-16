import { describe, it, expect } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import {
  scopeHighlightField,
  setScopeHighlight,
  dispatchScopeHighlight,
  dispatchScopeHighlightRanges,
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

  it("setScopeHighlight.of([{from,to}]) creates a Decoration.mark at the range", () => {
    const state = EditorState.create({
      doc: "hello world",
      extensions: [scopeHighlightField],
    });
    const tr = state.update({ effects: setScopeHighlight.of([{ from: 0, to: 5 }]) });
    const decos = tr.state.field(scopeHighlightField);
    const iter = decos.iter();
    expect(iter.value).not.toBeNull();
    expect(iter.from).toBe(0);
    expect(iter.to).toBe(5);
  });

  it("setScopeHighlight.of with two ranges yields two mark ranges", () => {
    const state = EditorState.create({
      doc: "hello world foo bar",
      extensions: [scopeHighlightField],
    });
    const tr = state.update({
      effects: setScopeHighlight.of([{ from: 0, to: 5 }, { from: 12, to: 15 }]),
    });
    const decos = tr.state.field(scopeHighlightField);
    const ranges: Array<{ from: number; to: number }> = [];
    decos.between(0, state.doc.length, (from, to) => {
      ranges.push({ from, to });
    });
    expect(ranges).toEqual([{ from: 0, to: 5 }, { from: 12, to: 15 }]);
  });

  it("setScopeHighlight.of([]) clears to Decoration.none", () => {
    const state = EditorState.create({
      doc: "hello world",
      extensions: [scopeHighlightField],
    });
    const tr1 = state.update({ effects: setScopeHighlight.of([{ from: 0, to: 5 }]) });
    const tr2 = tr1.state.update({ effects: setScopeHighlight.of([]) });
    expect(tr2.state.field(scopeHighlightField)).toBe(Decoration.none);
  });

  it("doc change clears highlight instead of remapping", () => {
    const state = EditorState.create({
      doc: "hello world",
      extensions: [scopeHighlightField],
    });
    const tr1 = state.update({ effects: setScopeHighlight.of([{ from: 6, to: 11 }]) });
    const tr2 = tr1.state.update({ changes: { from: 0, insert: "xx" } });
    expect(tr2.state.field(scopeHighlightField)).toBe(Decoration.none);
  });

  it("highlight clears when annotation text is edited", () => {
    const state = EditorState.create({
      doc: "before [!note] annotation content after",
      extensions: [scopeHighlightField],
    });
    const tr1 = state.update({ effects: setScopeHighlight.of([{ from: 7, to: 33 }]) });
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

  it("zero-width setScopeHighlight produces Decoration.none", () => {
    const state = EditorState.create({
      doc: "hello world",
      extensions: [scopeHighlightField],
    });
    const tr = state.update({ effects: setScopeHighlight.of([{ from: 5, to: 5 }]) });
    expect(tr.state.field(scopeHighlightField)).toBe(Decoration.none);
  });

  it("inverted setScopeHighlight produces Decoration.none", () => {
    const state = EditorState.create({
      doc: "hello world",
      extensions: [scopeHighlightField],
    });
    const tr = state.update({ effects: setScopeHighlight.of([{ from: 10, to: 3 }]) });
    expect(tr.state.field(scopeHighlightField)).toBe(Decoration.none);
  });

  it("setScopeHighlight.of(null) clears to Decoration.none", () => {
    const state = EditorState.create({
      doc: "hello world",
      extensions: [scopeHighlightField],
    });
    const tr1 = state.update({ effects: setScopeHighlight.of([{ from: 0, to: 5 }]) });
    const tr2 = tr1.state.update({ effects: setScopeHighlight.of(null) });
    expect(tr2.state.field(scopeHighlightField)).toBe(Decoration.none);
  });

  it("setScopeHighlight.of with an inverted range inside a list yields only valid segments", () => {
    const state = EditorState.create({
      doc: "hello world",
      extensions: [scopeHighlightField],
    });
    const tr = state.update({
      effects: setScopeHighlight.of([{ from: 0, to: 5 }, { from: 9, to: 3 }]),
    });
    const decos = tr.state.field(scopeHighlightField);
    const ranges: Array<{ from: number; to: number }> = [];
    decos.between(0, state.doc.length, (from, to) => {
      ranges.push({ from, to });
    });
    expect(ranges).toEqual([{ from: 0, to: 5 }]);
  });

  it("dispatchScopeHighlight with zero-width range is a no-op", () => {
    const state = EditorState.create({
      doc: "hello world",
      extensions: [scopeHighlightField],
    });
    const view = new EditorView({ state, parent: document.createElement("div") });
    dispatchScopeHighlight(view, 5, 5);
    expect(view.state.field(scopeHighlightField)).toBe(Decoration.none);
    view.destroy();
  });

  it("dispatchScopeHighlight with inverted range is a no-op", () => {
    const state = EditorState.create({
      doc: "hello world",
      extensions: [scopeHighlightField],
    });
    const view = new EditorView({ state, parent: document.createElement("div") });
    dispatchScopeHighlight(view, 10, 3);
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

  it("dispatchScopeHighlightRanges dispatches multiple mark ranges", () => {
    const state = EditorState.create({
      doc: "hello world foo bar",
      extensions: [scopeHighlightField],
    });
    const view = new EditorView({ state, parent: document.createElement("div") });
    dispatchScopeHighlightRanges(view, [{ from: 0, to: 5 }, { from: 12, to: 15 }]);
    const ranges: Array<{ from: number; to: number }> = [];
    view.state
      .field(scopeHighlightField)
      .between(0, view.state.doc.length, (from, to) => {
        ranges.push({ from, to });
      });
    expect(ranges).toEqual([{ from: 0, to: 5 }, { from: 12, to: 15 }]);
    view.destroy();
  });

  it("dispatchScopeHighlightRanges renders two .scope-highlight nodes in DOM", () => {
    const parent = document.createElement("div");
    const view = new EditorView({
      state: EditorState.create({
        doc: "hello world foo bar",
        extensions: [scopeHighlightExtension()],
      }),
      parent,
    });
    dispatchScopeHighlightRanges(view, [{ from: 0, to: 5 }, { from: 12, to: 15 }]);
    const highlights = parent.querySelectorAll(".scope-highlight");
    expect(highlights.length).toBe(2);
    view.destroy();
  });

  it("dispatchScopeHighlightRanges with empty list clears the highlight", () => {
    const state = EditorState.create({
      doc: "hello world",
      extensions: [scopeHighlightField],
    });
    const view = new EditorView({ state, parent: document.createElement("div") });
    dispatchScopeHighlight(view, 0, 5);
    dispatchScopeHighlightRanges(view, []);
    expect(view.state.field(scopeHighlightField)).toBe(Decoration.none);
    view.destroy();
  });
});
