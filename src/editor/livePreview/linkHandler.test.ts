import { describe, it, expect, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { GFM } from "@lezer/markdown";
import { getLinkUrlAtPos, createLinkClickHandler } from "./linkHandler";

function makeState(doc: string): EditorState {
  return EditorState.create({
    doc,
    extensions: [markdown({ extensions: GFM })],
  });
}

describe("getLinkUrlAtPos", () => {
  it("returns URL when pos is inside link text", () => {
    const state = makeState("[Click me](https://example.com)");
    expect(getLinkUrlAtPos(state, 3)).toBe("https://example.com");
  });

  it("returns null when pos is outside link", () => {
    const state = makeState("plain text [link](url) more");
    expect(getLinkUrlAtPos(state, 2)).toBeNull();
  });

  it("returns null when pos is on the URL portion", () => {
    const state = makeState("[link](https://example.com)");
    expect(getLinkUrlAtPos(state, 15)).toBeNull();
  });

  it("returns URL at link text boundaries", () => {
    const state = makeState("[ab](url)");
    expect(getLinkUrlAtPos(state, 1)).toBe("url");
    expect(getLinkUrlAtPos(state, 3)).toBe("url");
  });
});

describe("createLinkClickHandler", () => {
  it("is a valid Extension", () => {
    const handler = createLinkClickHandler(vi.fn());
    expect(() =>
      EditorState.create({ extensions: [handler] }),
    ).not.toThrow();
  });

  it("can be used alongside markdown extensions", () => {
    const handler = createLinkClickHandler(vi.fn());
    const state = EditorState.create({
      doc: "[test](url)",
      extensions: [markdown({ extensions: GFM }), handler],
    });
    const view = new EditorView({ state, parent: document.createElement("div") });
    expect(view).toBeDefined();
    view.destroy();
  });
});
