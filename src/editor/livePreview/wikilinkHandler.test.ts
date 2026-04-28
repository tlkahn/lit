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
    expect(result).toMatchObject({ target: "MyPage", section: null });
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
    expect(result).toMatchObject({ target: "Page", section: "Section" });
  });

  it("parses alias — uses target not display text", () => {
    const state = makeState("see [[Target|Display]]");
    const result = getWikilinkTargetAtPos(state, 8);
    expect(result).toMatchObject({ target: "Target", section: null });
  });

  it("parses target with section and alias [[Page#Section|Display]]", () => {
    const state = makeState("see [[Page#Section|Display]]");
    const result = getWikilinkTargetAtPos(state, 8);
    expect(result).toMatchObject({ target: "Page", section: "Section" });
  });

  it("returns target with folder path [[folder/Page]]", () => {
    const state = makeState("see [[folder/Page]]");
    const result = getWikilinkTargetAtPos(state, 8);
    expect(result).toMatchObject({ target: "folder/Page", section: null });
  });

  it("handles same-page section [[#Section]] — target is empty string", () => {
    const state = makeState("see [[#Section]]");
    const result = getWikilinkTargetAtPos(state, 8);
    expect(result).toMatchObject({ target: "", section: "Section" });
  });

  it("returns target for WikiLink inside italic *[[page]]*", () => {
    const state = makeState("*[[page]]*");
    const result = getWikilinkTargetAtPos(state, 4);
    expect(result).not.toBeNull();
    expect(result!.target).toBe("page");
    expect(result!.section).toBeNull();
  });

  it("returns target for WikiLink inside bold **[[page]]**", () => {
    const state = makeState("**[[page]]**");
    const result = getWikilinkTargetAtPos(state, 5);
    expect(result).not.toBeNull();
    expect(result!.target).toBe("page");
  });

  it("returns target for WikiLink inside bold+italic ***[[page]]***", () => {
    const state = makeState("***[[page]]***");
    const result = getWikilinkTargetAtPos(state, 6);
    expect(result).not.toBeNull();
    expect(result!.target).toBe("page");
  });

  it("returns null on emphasis marks outside WikiLink", () => {
    const state = makeState("*[[page]]*");
    expect(getWikilinkTargetAtPos(state, 0)).toBeNull();
  });

  it("parses section from WikiLink inside italic", () => {
    const state = makeState("*[[Page#Heading]]*");
    const result = getWikilinkTargetAtPos(state, 5);
    expect(result).not.toBeNull();
    expect(result!.target).toBe("Page");
    expect(result!.section).toBe("Heading");
  });

  it("parses alias in WikiLink inside bold", () => {
    const state = makeState("**[[Target|Display]]**");
    const result = getWikilinkTargetAtPos(state, 6);
    expect(result).not.toBeNull();
    expect(result!.target).toBe("Target");
  });

  it("returns from/to range of WikiLink node", () => {
    const state = makeState("see [[MyPage]] here");
    const result = getWikilinkTargetAtPos(state, 7);
    expect(result).not.toBeNull();
    expect(result!.from).toBe(4);
    expect(result!.to).toBe(14);
  });
});

describe("createWikilinkClickHandler", () => {
  it("produces a valid Extension", () => {
    const handler = createWikilinkClickHandler(vi.fn());
    expect(() =>
      EditorState.create({ extensions: [handler] }),
    ).not.toThrow();
  });

  function createView(
    doc: string,
    navigateToPage: ReturnType<typeof vi.fn>,
    mockPos = 7,
  ) {
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
    vi.spyOn(view, "posAtCoords").mockReturnValue(mockPos);
    return view;
  }

  // Live-preview hides [[ and ]] via Decoration.replace when the cursor is
  // outside the wikilink.  CM6 processes mousedown before click — if the
  // handler listened on "click", the mousedown would move the cursor into
  // the wikilink, remove decorations, shift the DOM, and cause posAtCoords
  // in the subsequent click to land on [[ instead of the page name.
  // Using "mousedown" resolves coordinates before any decoration update.

  it("navigates on plain mousedown (left button)", () => {
    const navigateToPage = vi.fn();
    const view = createView("see [[MyPage]] here", navigateToPage);
    view.contentDOM.dispatchEvent(
      new MouseEvent("mousedown", { button: 0, bubbles: true }),
    );
    expect(navigateToPage).toHaveBeenCalledWith("MyPage", undefined, 7);
    view.destroy();
  });

  it("does NOT navigate on Cmd+mousedown", () => {
    const navigateToPage = vi.fn();
    const view = createView("see [[MyPage]] here", navigateToPage);
    view.contentDOM.dispatchEvent(
      new MouseEvent("mousedown", { button: 0, metaKey: true, bubbles: true }),
    );
    expect(navigateToPage).not.toHaveBeenCalled();
    view.destroy();
  });

  it("does NOT navigate on Ctrl+mousedown", () => {
    const navigateToPage = vi.fn();
    const view = createView("see [[MyPage]] here", navigateToPage);
    view.contentDOM.dispatchEvent(
      new MouseEvent("mousedown", { button: 0, ctrlKey: true, bubbles: true }),
    );
    expect(navigateToPage).not.toHaveBeenCalled();
    view.destroy();
  });

  it("does NOT navigate on click (must use mousedown to avoid decoration DOM shift)", () => {
    const navigateToPage = vi.fn();
    const view = createView("see [[MyPage]] here", navigateToPage);
    view.contentDOM.dispatchEvent(
      new MouseEvent("click", { button: 0, bubbles: true }),
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

  it("navigates on plain mousedown for italic-wrapped wikilink with correct from", () => {
    const navigateToPage = vi.fn();
    const view = createView("*[[MyPage]]*", navigateToPage, 5);
    view.contentDOM.dispatchEvent(
      new MouseEvent("mousedown", { button: 0, bubbles: true }),
    );
    expect(navigateToPage).toHaveBeenCalledWith("MyPage", undefined, 5);
    view.destroy();
  });

  it("navigates on plain mousedown for bold-wrapped wikilink", () => {
    const navigateToPage = vi.fn();
    const view = createView("**[[MyPage]]**", navigateToPage, 6);
    view.contentDOM.dispatchEvent(
      new MouseEvent("mousedown", { button: 0, bubbles: true }),
    );
    expect(navigateToPage).toHaveBeenCalled();
    view.destroy();
  });

  it("does NOT navigate when cursor is already inside the same wikilink", () => {
    const navigateToPage = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const state = EditorState.create({
      doc: "see [[MyPage]] here",
      selection: { anchor: 7 },
      extensions: [
        markdown({ extensions: [GFM, WikiLink] }),
        createWikilinkClickHandler(navigateToPage),
      ],
    });
    const view = new EditorView({ state, parent: container });
    vi.spyOn(view, "posAtCoords").mockReturnValue(7);
    view.contentDOM.dispatchEvent(
      new MouseEvent("mousedown", { button: 0, bubbles: true }),
    );
    expect(navigateToPage).not.toHaveBeenCalled();
    view.destroy();
  });

  it("navigates when cursor is inside a different wikilink", () => {
    const navigateToPage = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const doc = "[[A]] and [[B]]";
    const state = EditorState.create({
      doc,
      selection: { anchor: 3 },
      extensions: [
        markdown({ extensions: [GFM, WikiLink] }),
        createWikilinkClickHandler(navigateToPage),
      ],
    });
    const view = new EditorView({ state, parent: container });
    vi.spyOn(view, "posAtCoords").mockReturnValue(12);
    view.contentDOM.dispatchEvent(
      new MouseEvent("mousedown", { button: 0, bubbles: true }),
    );
    expect(navigateToPage).toHaveBeenCalledWith("B", undefined, 12);
    view.destroy();
  });
});
