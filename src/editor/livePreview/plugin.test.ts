import { describe, it, expect } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { GFM } from "@lezer/markdown";
import { livePreviewPlugin } from "./plugin";

function makeView(doc: string, cursor = 0): EditorView {
  const state = EditorState.create({
    doc,
    selection: { anchor: cursor },
    extensions: [markdown({ extensions: GFM }), livePreviewPlugin],
  });
  return new EditorView({ state, parent: document.createElement("div") });
}

describe("livePreviewPlugin", () => {
  it("instantiates with EditorView", () => {
    const view = makeView("## Hello\n\nbody", 12);
    expect(view.plugin(livePreviewPlugin)).toBeDefined();
    view.destroy();
  });

  it("updates decorations on doc change", () => {
    const view = makeView("some text", 0);
    const pluginBefore = view.plugin(livePreviewPlugin)!;
    const decosBefore = pluginBefore.decorations;

    view.dispatch({ changes: { from: 0, to: 9, insert: "## Heading\n\nbody" } });
    view.dispatch({ selection: { anchor: 15 } });

    const pluginAfter = view.plugin(livePreviewPlugin)!;
    const decosAfter = pluginAfter.decorations;
    expect(decosAfter).not.toBe(decosBefore);
    view.destroy();
  });

  it("updates decorations on selection change", () => {
    const doc = "## Heading\n\nbody";
    const view = makeView(doc, doc.length - 1);
    const pluginBefore = view.plugin(livePreviewPlugin)!;
    const decosBefore = pluginBefore.decorations;

    view.dispatch({ selection: { anchor: 5 } });

    const pluginAfter = view.plugin(livePreviewPlugin)!;
    const decosAfter = pluginAfter.decorations;
    expect(decosAfter).not.toBe(decosBefore);
    view.destroy();
  });
});
