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

  function createView(doc: string, openUrl: ReturnType<typeof vi.fn>) {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const state = EditorState.create({
      doc,
      extensions: [
        markdown({ extensions: GFM }),
        createLinkClickHandler(openUrl),
      ],
    });
    const view = new EditorView({ state, parent: container });
    // Position inside the link text "Click" (pos 3 is between [ and ])
    vi.spyOn(view, "posAtCoords").mockReturnValue(3);
    return view;
  }

  // Same rationale as wikilinkHandler: live-preview hides link syntax via
  // Decoration.replace.  mousedown fires before CM6 updates decorations,
  // so posAtCoords resolves against the pre-shift DOM.

  it("opens URL on Cmd+mousedown (left button)", () => {
    const openUrl = vi.fn();
    const view = createView("[Click](https://example.com)", openUrl);
    view.contentDOM.dispatchEvent(
      new MouseEvent("mousedown", { button: 0, metaKey: true, bubbles: true }),
    );
    expect(openUrl).toHaveBeenCalledWith("https://example.com");
    view.destroy();
  });

  it("opens URL on Ctrl+mousedown (left button)", () => {
    const openUrl = vi.fn();
    const view = createView("[Click](https://example.com)", openUrl);
    view.contentDOM.dispatchEvent(
      new MouseEvent("mousedown", { button: 0, ctrlKey: true, bubbles: true }),
    );
    expect(openUrl).toHaveBeenCalledWith("https://example.com");
    view.destroy();
  });

  it("does NOT open URL on Cmd+click (must use mousedown to avoid decoration DOM shift)", () => {
    const openUrl = vi.fn();
    const view = createView("[Click](https://example.com)", openUrl);
    view.contentDOM.dispatchEvent(
      new MouseEvent("click", { button: 0, metaKey: true, bubbles: true }),
    );
    expect(openUrl).not.toHaveBeenCalled();
    view.destroy();
  });

  it("ignores mousedown without modifier key", () => {
    const openUrl = vi.fn();
    const view = createView("[Click](https://example.com)", openUrl);
    view.contentDOM.dispatchEvent(
      new MouseEvent("mousedown", { button: 0, bubbles: true }),
    );
    expect(openUrl).not.toHaveBeenCalled();
    view.destroy();
  });

  it("ignores right-button mousedown even with Cmd", () => {
    const openUrl = vi.fn();
    const view = createView("[Click](https://example.com)", openUrl);
    view.contentDOM.dispatchEvent(
      new MouseEvent("mousedown", { button: 2, metaKey: true, bubbles: true }),
    );
    expect(openUrl).not.toHaveBeenCalled();
    view.destroy();
  });
});
