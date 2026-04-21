import { describe, it, expect, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import {
  ImageWidget,
  CalloutHeaderWidget,
  InlineMathWidget,
  DisplayMathWidget,
} from "./widgets";
import { calloutFoldField } from "./callout";

vi.mock("katex", () => ({
  default: {
    render: vi.fn((tex: string, el: HTMLElement) => {
      el.textContent = tex;
    }),
  },
}));

vi.mock("katex/dist/katex.min.css", () => ({}));

describe("ImageWidget", () => {
  it("toDOM returns an img element with correct src and alt", () => {
    const widget = new ImageWidget("photo.png", "A photo");
    const el = widget.toDOM();
    expect(el.tagName).toBe("IMG");
    expect(el.getAttribute("src")).toBe("photo.png");
    expect(el.getAttribute("alt")).toBe("A photo");
  });

  it("applies correct styles", () => {
    const widget = new ImageWidget("img.jpg", "");
    const el = widget.toDOM();
    expect(el.style.maxWidth).toBe("100%");
    expect(el.style.maxHeight).toBe("300px");
    expect(el.style.display).toBe("block");
  });

  it("eq returns true for same src and alt", () => {
    const a = new ImageWidget("a.png", "alt");
    const b = new ImageWidget("a.png", "alt");
    expect(a.eq(b)).toBe(true);
  });

  it("eq returns false for different src", () => {
    const a = new ImageWidget("a.png", "alt");
    const b = new ImageWidget("b.png", "alt");
    expect(a.eq(b)).toBe(false);
  });

  it("eq returns false for different alt", () => {
    const a = new ImageWidget("a.png", "one");
    const b = new ImageWidget("a.png", "two");
    expect(a.eq(b)).toBe(false);
  });

  it("ignoreEvent returns true", () => {
    const widget = new ImageWidget("x.png", "x");
    expect(widget.ignoreEvent()).toBe(true);
  });
});

describe("CalloutHeaderWidget", () => {
  function makeView(): EditorView {
    const state = EditorState.create({
      doc: "test",
      extensions: [calloutFoldField],
    });
    return new EditorView({ state, parent: document.createElement("div") });
  }

  it("renders header with fold arrow, icon, and title", () => {
    const view = makeView();
    const widget = new CalloutHeaderWidget("note", "Note Title", false, 0);
    const el = widget.toDOM(view);
    expect(el.className).toBe("cm-callout-header");
    expect(el.querySelector(".cm-callout-fold-icon")!.textContent).toBe("▾");
    expect(el.querySelector(".cm-callout-icon")).toBeDefined();
    expect(el.querySelector(".cm-callout-title")!.textContent).toBe("Note Title");
    view.destroy();
  });

  it("shows collapsed arrow when isCollapsed", () => {
    const view = makeView();
    const widget = new CalloutHeaderWidget("tip", "Tip", true, 0);
    const el = widget.toDOM(view);
    expect(el.querySelector(".cm-callout-fold-icon")!.textContent).toBe("▸");
    view.destroy();
  });

  it("dispatches toggleCalloutEffect on arrow click", () => {
    const view = makeView();
    const widget = new CalloutHeaderWidget("note", "Note", false, 42);
    const el = widget.toDOM(view);
    const arrow = el.querySelector(".cm-callout-fold-icon")!;
    arrow.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    const foldState = view.state.field(calloutFoldField);
    expect(foldState.get(42)).toBe(true);
    view.destroy();
  });

  it("eq returns true for same props", () => {
    const a = new CalloutHeaderWidget("note", "Title", false, 0);
    const b = new CalloutHeaderWidget("note", "Title", false, 0);
    expect(a.eq(b)).toBe(true);
  });

  it("eq returns false for different type", () => {
    const a = new CalloutHeaderWidget("note", "Title", false, 0);
    const b = new CalloutHeaderWidget("warning", "Title", false, 0);
    expect(a.eq(b)).toBe(false);
  });

  it("eq returns false for different collapse state", () => {
    const a = new CalloutHeaderWidget("note", "Title", false, 0);
    const b = new CalloutHeaderWidget("note", "Title", true, 0);
    expect(a.eq(b)).toBe(false);
  });
});

describe("InlineMathWidget", () => {
  it("toDOM renders a span with latex content", () => {
    const widget = new InlineMathWidget("E=mc^2");
    const el = widget.toDOM();
    expect(el.tagName).toBe("SPAN");
    expect(el.className).toContain("cm-preview-math-inline");
    expect(el.textContent).toBe("E=mc^2");
  });

  it("eq returns true for same latex", () => {
    const a = new InlineMathWidget("x^2");
    const b = new InlineMathWidget("x^2");
    expect(a.eq(b)).toBe(true);
  });

  it("eq returns false for different latex", () => {
    const a = new InlineMathWidget("x^2");
    const b = new InlineMathWidget("y^3");
    expect(a.eq(b)).toBe(false);
  });

  it("ignoreEvent returns true", () => {
    expect(new InlineMathWidget("x").ignoreEvent()).toBe(true);
  });
});

describe("DisplayMathWidget", () => {
  it("toDOM renders a div with latex content", () => {
    const widget = new DisplayMathWidget("\\sum x");
    const el = widget.toDOM();
    expect(el.tagName).toBe("DIV");
    expect(el.className).toContain("cm-preview-math-display");
    expect(el.textContent).toBe("\\sum x");
  });

  it("eq returns true for same latex", () => {
    const a = new DisplayMathWidget("\\int f");
    const b = new DisplayMathWidget("\\int f");
    expect(a.eq(b)).toBe(true);
  });

  it("eq returns false for different latex", () => {
    const a = new DisplayMathWidget("\\int f");
    const b = new DisplayMathWidget("\\sum g");
    expect(a.eq(b)).toBe(false);
  });

  it("ignoreEvent returns true", () => {
    expect(new DisplayMathWidget("x").ignoreEvent()).toBe(true);
  });
});
