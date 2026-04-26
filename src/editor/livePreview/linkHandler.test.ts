import { describe, it, expect, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { GFM } from "@lezer/markdown";
import { getLinkUrlAtPos, createLinkClickHandler, classifyLinkTarget } from "./linkHandler";

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

describe("classifyLinkTarget", () => {
  it("classifies https as url", () => {
    expect(classifyLinkTarget("https://example.com")).toBe("url");
  });

  it("classifies http as url", () => {
    expect(classifyLinkTarget("http://x.com")).toBe("url");
  });

  it("classifies mailto as url", () => {
    expect(classifyLinkTarget("mailto:a@b.com")).toBe("url");
  });

  it("classifies tel as url", () => {
    expect(classifyLinkTarget("tel:+123")).toBe("url");
  });

  it("classifies anchor-only as anchor", () => {
    expect(classifyLinkTarget("#heading")).toBe("anchor");
  });

  it("classifies bare filename as path", () => {
    expect(classifyLinkTarget("file.md")).toBe("path");
  });

  it("classifies relative path as path", () => {
    expect(classifyLinkTarget("./folder/file.pdf")).toBe("path");
  });

  it("classifies parent-relative path as path", () => {
    expect(classifyLinkTarget("../other/doc.txt")).toBe("path");
  });

  it("classifies absolute path as path", () => {
    expect(classifyLinkTarget("/absolute/path.pdf")).toBe("path");
  });
});

describe("createLinkClickHandler", () => {
  it("is a valid Extension", () => {
    const handler = createLinkClickHandler({ openUrl: vi.fn() });
    expect(() =>
      EditorState.create({ extensions: [handler] }),
    ).not.toThrow();
  });

  it("can be used alongside markdown extensions", () => {
    const handler = createLinkClickHandler({ openUrl: vi.fn() });
    const state = EditorState.create({
      doc: "[test](url)",
      extensions: [markdown({ extensions: GFM }), handler],
    });
    const view = new EditorView({ state, parent: document.createElement("div") });
    expect(view).toBeDefined();
    view.destroy();
  });

  function createView(doc: string, handlers: { openUrl: ReturnType<typeof vi.fn>; openFilePath?: ReturnType<typeof vi.fn> }) {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const state = EditorState.create({
      doc,
      extensions: [
        markdown({ extensions: GFM }),
        createLinkClickHandler(handlers),
      ],
    });
    const view = new EditorView({ state, parent: container });
    vi.spyOn(view, "posAtCoords").mockReturnValue(3);
    return view;
  }

  it("opens URL on Cmd+mousedown (left button)", () => {
    const openUrl = vi.fn();
    const view = createView("[Click](https://example.com)", { openUrl });
    view.contentDOM.dispatchEvent(
      new MouseEvent("mousedown", { button: 0, metaKey: true, bubbles: true }),
    );
    expect(openUrl).toHaveBeenCalledWith("https://example.com");
    view.destroy();
  });

  it("opens URL on Ctrl+mousedown (left button)", () => {
    const openUrl = vi.fn();
    const view = createView("[Click](https://example.com)", { openUrl });
    view.contentDOM.dispatchEvent(
      new MouseEvent("mousedown", { button: 0, ctrlKey: true, bubbles: true }),
    );
    expect(openUrl).toHaveBeenCalledWith("https://example.com");
    view.destroy();
  });

  it("does NOT open URL on Cmd+click (must use mousedown to avoid decoration DOM shift)", () => {
    const openUrl = vi.fn();
    const view = createView("[Click](https://example.com)", { openUrl });
    view.contentDOM.dispatchEvent(
      new MouseEvent("click", { button: 0, metaKey: true, bubbles: true }),
    );
    expect(openUrl).not.toHaveBeenCalled();
    view.destroy();
  });

  it("ignores mousedown without modifier key", () => {
    const openUrl = vi.fn();
    const view = createView("[Click](https://example.com)", { openUrl });
    view.contentDOM.dispatchEvent(
      new MouseEvent("mousedown", { button: 0, bubbles: true }),
    );
    expect(openUrl).not.toHaveBeenCalled();
    view.destroy();
  });

  it("ignores right-button mousedown even with Cmd", () => {
    const openUrl = vi.fn();
    const view = createView("[Click](https://example.com)", { openUrl });
    view.contentDOM.dispatchEvent(
      new MouseEvent("mousedown", { button: 2, metaKey: true, bubbles: true }),
    );
    expect(openUrl).not.toHaveBeenCalled();
    view.destroy();
  });

  it("calls openFilePath for file path targets", () => {
    const openUrl = vi.fn();
    const openFilePath = vi.fn();
    const view = createView("[Click](file.pdf)", { openUrl, openFilePath });
    view.contentDOM.dispatchEvent(
      new MouseEvent("mousedown", { button: 0, metaKey: true, bubbles: true }),
    );
    expect(openFilePath).toHaveBeenCalledWith("file.pdf");
    expect(openUrl).not.toHaveBeenCalled();
    view.destroy();
  });

  it("does not call either handler for anchor targets", () => {
    const openUrl = vi.fn();
    const openFilePath = vi.fn();
    const view = createView("[Click](#heading)", { openUrl, openFilePath });
    view.contentDOM.dispatchEvent(
      new MouseEvent("mousedown", { button: 0, metaKey: true, bubbles: true }),
    );
    expect(openUrl).not.toHaveBeenCalled();
    expect(openFilePath).not.toHaveBeenCalled();
    view.destroy();
  });

  it("does not call openUrl for file path when openFilePath is not provided", () => {
    const openUrl = vi.fn();
    const view = createView("[Click](file.pdf)", { openUrl });
    view.contentDOM.dispatchEvent(
      new MouseEvent("mousedown", { button: 0, metaKey: true, bubbles: true }),
    );
    expect(openUrl).not.toHaveBeenCalled();
    view.destroy();
  });
});
