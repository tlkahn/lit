import { describe, it, expect } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { focusModeExtension, focusModeFacet } from "./extension";
import { trackView } from "../../test/cmView";

function makeView(doc: string, active: boolean): EditorView {
  const state = EditorState.create({
    doc,
    extensions: [focusModeExtension(active)],
  });
  const container = document.createElement("div");
  return trackView(new EditorView({ state, parent: container }));
}

describe("focusModeExtension", () => {
  it("produces no decorations when inactive", () => {
    const view = makeView("Hello world. Goodbye world.", false);
    const decos = view.dom.querySelectorAll(".cm-unfocused");
    expect(decos.length).toBe(0);
    view.destroy();
  });

  it("produces cm-unfocused marks when active", () => {
    const view = makeView("First sentence. Second sentence.", true);
    view.dispatch({ selection: { anchor: 3 } });
    view.update([]);
    const decos = view.dom.querySelectorAll(".cm-unfocused");
    expect(decos.length).toBeGreaterThan(0);
    view.destroy();
  });

  it("adds cm-focus-mode class to editor when active", () => {
    const view = makeView("Hello.", true);
    expect(view.dom.classList.contains("cm-focus-mode")).toBe(true);
    view.destroy();
  });

  it("does not add cm-focus-mode class when inactive", () => {
    const view = makeView("Hello.", false);
    expect(view.dom.classList.contains("cm-focus-mode")).toBe(false);
    view.destroy();
  });

  it("facet combines via OR", () => {
    const state = EditorState.create({
      doc: "test",
      extensions: [focusModeFacet.of(false), focusModeFacet.of(true)],
    });
    expect(state.facet(focusModeFacet)).toBe(true);
  });
});
