import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { CrossrefWidget, DefinitionWidget, highlightLine } from "./crossrefWidgets";
import { globalJumpTracker } from "../jumpTracker";

vi.mock("../../stores/workspace", () => ({
  useWorkspaceStore: {
    getState: vi.fn(() => ({
      currentPagePath: "note.md",
    })),
  },
}));

function makeView(doc = "test document"): EditorView {
  const state = EditorState.create({ doc });
  return new EditorView({ state, parent: document.createElement("div") });
}

describe("CrossrefWidget", () => {
  it("eq returns true for identical props", () => {
    const a = new CrossrefWidget("[@fig:cat]", "Fig. 1", true, 0, 10, 50);
    const b = new CrossrefWidget("[@fig:cat]", "Fig. 1", true, 0, 10, 50);
    expect(a.eq(b)).toBe(true);
  });

  it("eq returns false when renderedText differs", () => {
    const a = new CrossrefWidget("[@fig:cat]", "Fig. 1", true, 0, 10, 50);
    const b = new CrossrefWidget("[@fig:cat]", "Fig. 2", true, 0, 10, 50);
    expect(a.eq(b)).toBe(false);
  });

  it("eq returns false when isValid differs", () => {
    const a = new CrossrefWidget("[@fig:cat]", "Fig. 1", true, 0, 10, 50);
    const b = new CrossrefWidget("[@fig:cat]", "Fig. 1", false, 0, 10, 50);
    expect(a.eq(b)).toBe(false);
  });

  it("eq returns false when targetCharOffset differs", () => {
    const a = new CrossrefWidget("[@fig:cat]", "Fig. 1", true, 0, 10, 50);
    const b = new CrossrefWidget("[@fig:cat]", "Fig. 1", true, 0, 10, 60);
    expect(a.eq(b)).toBe(false);
  });

  it("toDOM creates span with correct class, text, title, data attribute", () => {
    const view = makeView();
    const widget = new CrossrefWidget("[@fig:cat]", "Fig. 1", true, 0, 10, 50);
    const el = widget.toDOM(view);
    expect(el.tagName).toBe("SPAN");
    expect(el.className).toBe("cm-crossref-citation");
    expect(el.textContent).toBe("Fig. 1");
    expect(el.getAttribute("title")).toBe("[@fig:cat]");
    expect(el.dataset.original).toBe("[@fig:cat]");
    view.destroy();
  });

  it("toDOM adds invalid class when isValid is false", () => {
    const view = makeView();
    const widget = new CrossrefWidget("[@fig:nope]", "??", false, 0, 10, null);
    const el = widget.toDOM(view);
    expect(el.classList.contains("cm-crossref-citation")).toBe(true);
    expect(el.classList.contains("invalid")).toBe(true);
    view.destroy();
  });

  it("mousedown dispatches with targetCharOffset when valid", () => {
    const doc = "some text with enough length to hold offset";
    const view = makeView(doc);
    const dispatchSpy = vi.spyOn(view, "dispatch");
    const widget = new CrossrefWidget("[@fig:cat]", "Fig. 1", true, 0, 10, 20);
    const el = widget.toDOM(view);
    el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        selection: { anchor: 20 },
        scrollIntoView: true,
      }),
    );
    view.destroy();
  });

  it("mousedown places cursor at charStart when no targetCharOffset", () => {
    const view = makeView();
    const dispatchSpy = vi.spyOn(view, "dispatch");
    const widget = new CrossrefWidget("[@fig:nope]", "??", false, 5, 10, null);
    const el = widget.toDOM(view);
    el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        selection: { anchor: 5 },
      }),
    );
    view.destroy();
  });

  it("updateDOM updates text, title, data, and validity", () => {
    const view = makeView();
    const a = new CrossrefWidget("[@fig:cat]", "Fig. 1", true, 0, 10, 50);
    const dom = a.toDOM(view);
    const b = new CrossrefWidget("[@fig:dog]", "Fig. 2", false, 5, 15, null);
    expect(b.updateDOM(dom, view)).toBe(true);
    expect(dom.textContent).toBe("Fig. 2");
    expect(dom.getAttribute("title")).toBe("[@fig:dog]");
    expect(dom.dataset.original).toBe("[@fig:dog]");
    expect(dom.classList.contains("invalid")).toBe(true);
    view.destroy();
  });

  it("updateDOM removes invalid class when becoming valid", () => {
    const view = makeView();
    const a = new CrossrefWidget("[@fig:cat]", "??", false, 0, 10, null);
    const dom = a.toDOM(view);
    expect(dom.classList.contains("invalid")).toBe(true);
    const b = new CrossrefWidget("[@fig:cat]", "Fig. 1", true, 0, 10, 50);
    expect(b.updateDOM(dom, view)).toBe(true);
    expect(dom.classList.contains("invalid")).toBe(false);
    view.destroy();
  });

  it("updateDOM rebinds mousedown handler", () => {
    const doc = "some text with enough length to hold offset";
    const view = makeView(doc);
    const a = new CrossrefWidget("[@fig:cat]", "Fig. 1", true, 0, 10, 5);
    const dom = a.toDOM(view);
    const dispatchSpy = vi.spyOn(view, "dispatch");
    const b = new CrossrefWidget("[@fig:dog]", "Fig. 2", true, 0, 10, 20);
    b.updateDOM(dom, view);
    dom.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        selection: { anchor: 20 },
        scrollIntoView: true,
      }),
    );
    view.destroy();
  });

  it("mousedown records departure in jump tracker", () => {
    const doc = "some text with enough length to hold offset";
    const view = makeView(doc);
    globalJumpTracker.clear();
    const widget = new CrossrefWidget("[@fig:cat]", "Fig. 1", true, 0, 10, 20);
    const el = widget.toDOM(view);
    el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(globalJumpTracker.jumps).toHaveLength(1);
    expect(globalJumpTracker.jumps[0]).toEqual(
      expect.objectContaining({ notePath: "note.md", line: 1, col: 0 }),
    );
    view.destroy();
  });

  it("mousedown does not record departure for invalid crossref", () => {
    const view = makeView();
    globalJumpTracker.clear();
    const widget = new CrossrefWidget("[@fig:nope]", "??", false, 5, 10, null);
    const el = widget.toDOM(view);
    el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(globalJumpTracker.jumps).toHaveLength(0);
    view.destroy();
  });

  it("estimatedHeight returns a number", () => {
    const widget = new CrossrefWidget("[@fig:cat]", "Fig. 1", true, 0, 10, null);
    expect(typeof widget.estimatedHeight).toBe("number");
    expect(widget.estimatedHeight).toBeGreaterThan(0);
  });
});

describe("DefinitionWidget", () => {
  it("eq returns true for identical props", () => {
    const a = new DefinitionWidget("{#fig:cat}", "#Fig. 1", true, 0, 10);
    const b = new DefinitionWidget("{#fig:cat}", "#Fig. 1", true, 0, 10);
    expect(a.eq(b)).toBe(true);
  });

  it("eq returns false when any prop differs", () => {
    const a = new DefinitionWidget("{#fig:cat}", "#Fig. 1", true, 0, 10);
    expect(a.eq(new DefinitionWidget("{#fig:dog}", "#Fig. 1", true, 0, 10))).toBe(false);
    expect(a.eq(new DefinitionWidget("{#fig:cat}", "#Fig. 2", true, 0, 10))).toBe(false);
    expect(a.eq(new DefinitionWidget("{#fig:cat}", "#Fig. 1", false, 0, 10))).toBe(false);
    expect(a.eq(new DefinitionWidget("{#fig:cat}", "#Fig. 1", true, 1, 10))).toBe(false);
    expect(a.eq(new DefinitionWidget("{#fig:cat}", "#Fig. 1", true, 0, 11))).toBe(false);
  });

  it("toDOM creates span with correct class and text", () => {
    const view = makeView();
    const widget = new DefinitionWidget("{#fig:cat}", "#Fig. 1", true, 0, 10);
    const el = widget.toDOM(view);
    expect(el.tagName).toBe("SPAN");
    expect(el.className).toBe("cm-crossref-definition");
    expect(el.textContent).toBe("#Fig. 1");
    expect(el.dataset.original).toBe("{#fig:cat}");
    view.destroy();
  });

  it("mousedown places cursor at charStart", () => {
    const view = makeView();
    const dispatchSpy = vi.spyOn(view, "dispatch");
    const widget = new DefinitionWidget("{#fig:cat}", "#Fig. 1", true, 3, 10);
    const el = widget.toDOM(view);
    el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        selection: { anchor: 3 },
      }),
    );
    view.destroy();
  });

  it("updateDOM updates text and data attributes", () => {
    const view = makeView();
    const a = new DefinitionWidget("{#fig:cat}", "#Fig. 1", true, 0, 10);
    const dom = a.toDOM(view);
    const b = new DefinitionWidget("{#fig:dog}", "#Fig. 2", true, 5, 15);
    expect(b.updateDOM(dom, view)).toBe(true);
    expect(dom.textContent).toBe("#Fig. 2");
    expect(dom.dataset.original).toBe("{#fig:dog}");
    view.destroy();
  });

  it("updateDOM rebinds mousedown handler", () => {
    const view = makeView();
    const a = new DefinitionWidget("{#fig:cat}", "#Fig. 1", true, 0, 10);
    const dom = a.toDOM(view);
    const dispatchSpy = vi.spyOn(view, "dispatch");
    const b = new DefinitionWidget("{#fig:dog}", "#Fig. 2", true, 3, 13);
    b.updateDOM(dom, view);
    dom.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        selection: { anchor: 3 },
      }),
    );
    view.destroy();
  });

  it("estimatedHeight returns a number", () => {
    const widget = new DefinitionWidget("{#fig:cat}", "#Fig. 1", true, 0, 10);
    expect(typeof widget.estimatedHeight).toBe("number");
    expect(widget.estimatedHeight).toBeGreaterThan(0);
  });
});

describe("highlightLine", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("adds and removes cm-crossref-highlight-blink class", () => {
    const view = makeView("hello world");
    document.body.appendChild(view.dom);

    highlightLine(view, 0);

    const cmLine = view.dom.querySelector(".cm-line");
    expect(cmLine).not.toBeNull();
    expect(cmLine!.classList.contains("cm-crossref-highlight-blink")).toBe(true);

    vi.advanceTimersByTime(1500);
    expect(cmLine!.classList.contains("cm-crossref-highlight-blink")).toBe(false);

    view.dom.remove();
    view.destroy();
  });
});
