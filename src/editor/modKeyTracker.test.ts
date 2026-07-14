import { describe, it, expect } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { modKeyTracker, modHeldLinkStyle } from "./modKeyTracker";
import { trackView } from "../test/cmView";

function makeView(doc: string): EditorView {
  const state = EditorState.create({ doc, extensions: [modKeyTracker] });
  const container = document.createElement("div");
  document.body.appendChild(container);
  return trackView(new EditorView({ state, parent: container }));
}

describe("modKeyTracker", () => {
  it("cm-mod-held class toggles on keydown/keyup Meta", () => {
    const view = makeView("test");

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Meta" }));
    expect(view.dom.classList.contains("cm-mod-held")).toBe(true);

    document.dispatchEvent(new KeyboardEvent("keyup", { key: "Meta" }));
    expect(view.dom.classList.contains("cm-mod-held")).toBe(false);

    view.dom.remove();
    view.destroy();
  });

  it("cm-mod-held removed on window blur", () => {
    const view = makeView("test");

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Meta" }));
    expect(view.dom.classList.contains("cm-mod-held")).toBe(true);

    window.dispatchEvent(new Event("blur"));
    expect(view.dom.classList.contains("cm-mod-held")).toBe(false);

    view.dom.remove();
    view.destroy();
  });

  it("cm-mod-held class toggles on Control key", () => {
    const view = makeView("test");

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Control" }));
    expect(view.dom.classList.contains("cm-mod-held")).toBe(true);

    document.dispatchEvent(new KeyboardEvent("keyup", { key: "Control" }));
    expect(view.dom.classList.contains("cm-mod-held")).toBe(false);

    view.dom.remove();
    view.destroy();
  });

  it("cm-mod-held removed on destroy", () => {
    const view = makeView("test");

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Meta" }));
    expect(view.dom.classList.contains("cm-mod-held")).toBe(true);

    view.destroy();
    expect(view.dom.classList.contains("cm-mod-held")).toBe(false);
  });
});

describe("modHeldLinkStyle", () => {
  it("produces a valid extension with the given class name", () => {
    const ext = modHeldLinkStyle("cm-test-link");
    const state = EditorState.create({ doc: "test", extensions: [ext] });
    expect(state).toBeDefined();
  });

  it("accepts different class names without error", () => {
    const ext1 = modHeldLinkStyle("cm-bib-file-link");
    const ext2 = modHeldLinkStyle("cm-citation-raw-link");
    const state = EditorState.create({
      doc: "test",
      extensions: [ext1, ext2],
    });
    expect(state).toBeDefined();
  });
});
