import { describe, it, expect, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { GFM } from "@lezer/markdown";
import { WikiLink } from "../markdown/wikilink";
import { getWikilinkTargetAtPos, createWikilinkClickHandler } from "./wikilinkHandler";

function makeState(doc: string): EditorState {
  return EditorState.create({
    doc,
    extensions: [markdown({ extensions: [GFM, WikiLink] })],
  });
}

describe("getWikilinkTargetAtPos", () => {
  it("returns target when pos is inside WikiLink content", () => {
    const state = makeState("see [[MyPage]] here");
    const result = getWikilinkTargetAtPos(state, 7);
    expect(result).toEqual({ target: "MyPage", section: null, from: 4 });
  });

  it("returns null when pos is outside WikiLink", () => {
    const state = makeState("plain text [[link]] more");
    expect(getWikilinkTargetAtPos(state, 2)).toBeNull();
  });

  it("returns null when pos is on [[ marks", () => {
    const state = makeState("[[Page]]");
    expect(getWikilinkTargetAtPos(state, 0)).toBeNull();
    expect(getWikilinkTargetAtPos(state, 1)).toBeNull();
  });

  it("parses section from [[Page#Section]]", () => {
    const state = makeState("go to [[Page#Section]]");
    const result = getWikilinkTargetAtPos(state, 10);
    expect(result).toEqual({ target: "Page", section: "Section", from: 6 });
  });

  it("parses alias — uses target not display text", () => {
    const state = makeState("see [[Target|Display]]");
    const result = getWikilinkTargetAtPos(state, 8);
    expect(result).toEqual({ target: "Target", section: null, from: 4 });
  });

  it("parses target with section and alias [[Page#Section|Display]]", () => {
    const state = makeState("see [[Page#Section|Display]]");
    const result = getWikilinkTargetAtPos(state, 8);
    expect(result).toEqual({ target: "Page", section: "Section", from: 4 });
  });

  it("returns target with folder path [[folder/Page]]", () => {
    const state = makeState("see [[folder/Page]]");
    const result = getWikilinkTargetAtPos(state, 8);
    expect(result).toEqual({ target: "folder/Page", section: null, from: 4 });
  });

  it("handles same-page section [[#Section]] — target is empty string", () => {
    const state = makeState("see [[#Section]]");
    const result = getWikilinkTargetAtPos(state, 8);
    expect(result).toEqual({ target: "", section: "Section", from: 4 });
  });
});

describe("createWikilinkClickHandler", () => {
  it("produces a valid Extension", () => {
    const handler = createWikilinkClickHandler(vi.fn());
    expect(() =>
      EditorState.create({ extensions: [handler] }),
    ).not.toThrow();
  });

  function createView(doc: string, navigateToPage: ReturnType<typeof vi.fn>) {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const state = EditorState.create({
      doc,
      extensions: [
        markdown({ extensions: [GFM, WikiLink] }),
        createWikilinkClickHandler(navigateToPage),
      ],
    });
    const view = new EditorView({ state, parent: container });
    vi.spyOn(view, "posAtCoords").mockReturnValue(7);
    return view;
  }

  // Live-preview hides [[ and ]] via Decoration.replace when the cursor is
  // outside the wikilink.  CM6 processes mousedown before click — if the
  // handler listened on "click", the mousedown would move the cursor into
  // the wikilink, remove decorations, shift the DOM, and cause posAtCoords
  // in the subsequent click to land on [[ instead of the page name.
  // Using "mousedown" resolves coordinates before any decoration update.

  it("navigates on Cmd+mousedown (left button)", () => {
    const navigateToPage = vi.fn();
    const view = createView("see [[MyPage]] here", navigateToPage);
    view.contentDOM.dispatchEvent(
      new MouseEvent("mousedown", { button: 0, metaKey: true, bubbles: true }),
    );
    expect(navigateToPage).toHaveBeenCalledWith("MyPage", undefined, 4);
    view.destroy();
  });

  it("navigates on Ctrl+mousedown (left button)", () => {
    const navigateToPage = vi.fn();
    const view = createView("see [[MyPage]] here", navigateToPage);
    view.contentDOM.dispatchEvent(
      new MouseEvent("mousedown", { button: 0, ctrlKey: true, bubbles: true }),
    );
    expect(navigateToPage).toHaveBeenCalledWith("MyPage", undefined, 4);
    view.destroy();
  });

  it("does NOT navigate on Cmd+click (must use mousedown to avoid decoration DOM shift)", () => {
    const navigateToPage = vi.fn();
    const view = createView("see [[MyPage]] here", navigateToPage);
    view.contentDOM.dispatchEvent(
      new MouseEvent("click", { button: 0, metaKey: true, bubbles: true }),
    );
    expect(navigateToPage).not.toHaveBeenCalled();
    view.destroy();
  });

  it("ignores mousedown without modifier key", () => {
    const navigateToPage = vi.fn();
    const view = createView("see [[MyPage]] here", navigateToPage);
    view.contentDOM.dispatchEvent(
      new MouseEvent("mousedown", { button: 0, bubbles: true }),
    );
    expect(navigateToPage).not.toHaveBeenCalled();
    view.destroy();
  });

  it("ignores right-button mousedown even with Cmd", () => {
    const navigateToPage = vi.fn();
    const view = createView("see [[MyPage]] here", navigateToPage);
    view.contentDOM.dispatchEvent(
      new MouseEvent("mousedown", { button: 2, metaKey: true, bubbles: true }),
    );
    expect(navigateToPage).not.toHaveBeenCalled();
    view.destroy();
  });
});
