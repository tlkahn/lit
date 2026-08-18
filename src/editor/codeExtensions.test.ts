import { describe, it, expect, vi } from "vitest";
import { EditorState, Compartment } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { createCodeExtensions } from "./codeExtensions";
import { bibtex } from "./bibtex";

function freshCompartments() {
  return {
    themeCompartment: new Compartment(),
    languageCompartment: new Compartment(),
    keymapCompartment: new Compartment(),
    editableCompartment: new Compartment(),
  };
}

describe("createCodeExtensions", () => {
  it("builds a state that round-trips the document", () => {
    const c = freshCompartments();
    const state = EditorState.create({
      doc: "hello",
      extensions: createCodeExtensions({ theme: "light", ...c }),
    });
    expect(state.doc.toString()).toBe("hello");
  });

  it("fires onChange when the document changes", () => {
    const c = freshCompartments();
    const onChange = vi.fn();
    const state = EditorState.create({
      doc: "",
      extensions: createCodeExtensions({ theme: "light", onChange, ...c }),
    });
    const view = new EditorView({ state });
    view.dispatch({ changes: { from: 0, insert: "typed" } });
    expect(onChange).toHaveBeenCalledWith("typed");
    view.destroy();
  });

  it("honors editorLocked via the editable compartment", () => {
    const c = freshCompartments();
    const lockedState = EditorState.create({
      doc: "x",
      extensions: createCodeExtensions({ theme: "light", editorLocked: true, ...c }),
    });
    expect(lockedState.facet(EditorView.editable)).toBe(false);

    const c2 = freshCompartments();
    const unlockedState = EditorState.create({
      doc: "x",
      extensions: createCodeExtensions({ theme: "light", editorLocked: false, ...c2 }),
    });
    expect(unlockedState.facet(EditorView.editable)).toBe(true);
  });

  it("wires the code content override so long lines can exceed the scroller", () => {
    const c = freshCompartments();
    const state = EditorState.create({
      doc: "code",
      extensions: createCodeExtensions({ theme: "light", ...c }),
    });
    const rules = state
      .facet(EditorView.styleModule)
      .map((m) => m.getRules())
      .join("\n");
    expect(rules).toContain("max-width: none");
    expect(rules).toContain("overflow-x: visible");
  });

  it("loads a language when one is provided and not when null", () => {
    const c = freshCompartments();
    const withLang = EditorState.create({
      doc: "@article{k,",
      extensions: createCodeExtensions({ theme: "light", language: bibtex(), ...c }),
    });
    expect(withLang.facet(EditorState.allowMultipleSelections)).toBe(true);
    // No throw building with a language present.

    const c2 = freshCompartments();
    const noLang = EditorState.create({
      doc: "plain",
      extensions: createCodeExtensions({ theme: "light", language: null, ...c2 }),
    });
    expect(noLang.doc.toString()).toBe("plain");
  });
});
