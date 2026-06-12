import { describe, it, expect, vi, beforeEach } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { widgetSync } from "./widgetSyncAnnotation";
import {
  ImageWidget,
  CalloutHeaderWidget,
  InlineMathWidget,
  DisplayMathWidget,
  EditableTableWidget,
  MermaidWidget,
  HorizontalRuleWidget,
  PageBreakWidget,
  clearFailedImageCache,
} from "./widgets";
import { calloutFoldField } from "./callout";
import { stripQuotePrefixes } from "./table";
import { renderMermaid, getMermaidCached } from "./mermaid";
import { navigateToPageFacet } from "./navigateToPageFacet";
import { getKatexSync } from "./katexLoader";

const mockKatex = {
  render: vi.fn((tex: string, el: HTMLElement) => {
    el.textContent = tex;
  }),
  renderToString: vi.fn((tex: string) => `<span class="katex">${tex}</span>`),
};

vi.mock("./katexLoader", () => ({
  getKatexSync: vi.fn(() => mockKatex),
  loadKatex: vi.fn(async () => mockKatex),
  resetKatexLoader: vi.fn(),
}));

vi.mock("katex/dist/katex.min.css", () => ({}));

vi.mock("./mermaid", () => ({
  renderMermaid: vi.fn(async () => {}),
  getMermaidCached: vi.fn(() => undefined),
}));

vi.mock("./lightbox", () => ({
  showMediaLightbox: vi.fn(),
}));

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

  it("updateDOM updates src and alt on existing element", () => {
    const a = new ImageWidget("old.png", "old alt");
    const dom = a.toDOM();
    const b = new ImageWidget("new.png", "new alt");
    expect(b.updateDOM(dom)).toBe(true);
    expect(dom.getAttribute("src")).toBe("new.png");
    expect(dom.getAttribute("alt")).toBe("new alt");
  });

  it("updateDOM preserves element identity", () => {
    const a = new ImageWidget("a.png", "a");
    const dom = a.toDOM();
    const ref = dom;
    const b = new ImageWidget("b.png", "b");
    b.updateDOM(dom);
    expect(dom).toBe(ref);
  });

  it("ignoreEvent returns false to allow click-to-edit", () => {
    const widget = new ImageWidget("x.png", "x");
    expect(widget.ignoreEvent(new MouseEvent("mousedown"))).toBe(false);
  });

  describe("thumbnail mode", () => {
    it("toDOM returns container div with cm-preview-image-thumbnail class", () => {
      const widget = new ImageWidget("photo.png", "A photo", true);
      const el = widget.toDOM();
      expect(el.tagName).toBe("DIV");
      expect(el.className).toBe("cm-preview-image-thumbnail");
    });

    it("img inside has correct src and alt", () => {
      const widget = new ImageWidget("photo.png", "A photo", true);
      const el = widget.toDOM();
      const img = el.querySelector("img")!;
      expect(img).not.toBeNull();
      expect(img.src).toContain("photo.png");
      expect(img.alt).toBe("A photo");
    });

    it("estimatedHeight returns 128 (120px maxHeight + 8px padding)", () => {
      const widget = new ImageWidget("x.png", "x", true);
      expect(widget.estimatedHeight).toBe(128);
    });

    it("ignoreEvent returns true for mousedown", () => {
      const widget = new ImageWidget("x.png", "x", true);
      expect(widget.ignoreEvent(new MouseEvent("mousedown"))).toBe(true);
    });

    it("ignoreEvent returns false for other events", () => {
      const widget = new ImageWidget("x.png", "x", true);
      expect(widget.ignoreEvent(new MouseEvent("click"))).toBe(false);
    });

    it("eq returns false when thumbnail flag differs", () => {
      const a = new ImageWidget("a.png", "alt", true);
      const b = new ImageWidget("a.png", "alt", false);
      expect(a.eq(b)).toBe(false);
    });

    it("updateDOM updates img src within container", () => {
      const a = new ImageWidget("old.png", "old", true);
      const dom = a.toDOM();
      const b = new ImageWidget("new.png", "new", true);
      expect(b.updateDOM(dom)).toBe(true);
      const img = dom.querySelector("img")!;
      expect(img.src).toContain("new.png");
      expect(img.alt).toBe("new");
    });
  });

  it("non-thumbnail: backward compatible (no third arg)", () => {
    const widget = new ImageWidget("img.jpg", "alt");
    expect(widget.thumbnail).toBe(false);
    const el = widget.toDOM();
    expect(el.tagName).toBe("IMG");
    expect(widget.estimatedHeight).toBe(200);
  });
});

describe("ImageWidget — failed image caching", () => {
  beforeEach(() => {
    clearFailedImageCache();
  });

  it("toDOM does not set src for a cached-failed URL", () => {
    const w1 = new ImageWidget("broken.png", "alt");
    const el1 = w1.toDOM();
    el1.dispatchEvent(new Event("error"));

    const w2 = new ImageWidget("broken.png", "alt");
    const el2 = w2.toDOM();
    expect(el2.getAttribute("src")).toBeNull();
    expect(el2.classList.contains("cm-preview-image-error")).toBe(true);
  });

  it("updateDOM does not re-set src for cached-failed URL", () => {
    const w1 = new ImageWidget("broken.png", "alt");
    const dom = w1.toDOM();
    dom.dispatchEvent(new Event("error"));

    const w2 = new ImageWidget("broken.png", "alt");
    w2.updateDOM(dom);
    expect(dom.getAttribute("src")).toBeNull();
    expect(dom.classList.contains("cm-preview-image-error")).toBe(true);
  });

  it("new URL is not blocked by cache of old URL", () => {
    const w1 = new ImageWidget("broken.png", "alt");
    const el1 = w1.toDOM();
    el1.dispatchEvent(new Event("error"));

    const w2 = new ImageWidget("fixed.png", "alt");
    const el2 = w2.toDOM();
    expect(el2.getAttribute("src")).toBe("fixed.png");
    expect(el2.classList.contains("cm-preview-image-error")).toBe(false);
  });

  it("clearFailedImageCache allows re-fetch of previously failed URL", () => {
    const w1 = new ImageWidget("broken.png", "alt");
    const el1 = w1.toDOM();
    el1.dispatchEvent(new Event("error"));

    clearFailedImageCache();

    const w2 = new ImageWidget("broken.png", "alt");
    const el2 = w2.toDOM();
    expect(el2.getAttribute("src")).toBe("broken.png");
  });

  it("successful load prevents URL from being cached as failed", () => {
    const w1 = new ImageWidget("ok.png", "alt");
    const el1 = w1.toDOM();
    expect(el1.getAttribute("src")).toBe("ok.png");
    el1.dispatchEvent(new Event("load"));

    const w2 = new ImageWidget("ok.png", "alt");
    const el2 = w2.toDOM();
    expect(el2.getAttribute("src")).toBe("ok.png");
  });

  describe("thumbnail mode", () => {
    it("toDOM does not set src for a cached-failed URL", () => {
      const w1 = new ImageWidget("broken.png", "alt", true);
      const el1 = w1.toDOM();
      const img1 = el1.querySelector("img")!;
      img1.dispatchEvent(new Event("error"));

      const w2 = new ImageWidget("broken.png", "alt", true);
      const el2 = w2.toDOM();
      const img2 = el2.querySelector("img")!;
      expect(img2.getAttribute("src")).toBeNull();
      expect(img2.classList.contains("cm-preview-image-error")).toBe(true);
    });

    it("updateDOM does not re-set src for cached-failed URL", () => {
      const w1 = new ImageWidget("broken.png", "alt", true);
      const dom = w1.toDOM();
      const img1 = dom.querySelector("img")!;
      img1.dispatchEvent(new Event("error"));

      const w2 = new ImageWidget("broken.png", "alt", true);
      w2.updateDOM(dom);
      const img2 = dom.querySelector("img")!;
      expect(img2.getAttribute("src")).toBeNull();
      expect(img2.classList.contains("cm-preview-image-error")).toBe(true);
    });
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
    const widget = new CalloutHeaderWidget("note", "Note Title", false, true, 0);
    const el = widget.toDOM(view);
    expect(el.className).toBe("cm-callout-header");
    const foldIcon = el.querySelector(".cm-callout-fold-icon")!;
    expect(foldIcon.querySelector("svg.svg-icon")).not.toBeNull();
    expect(foldIcon.classList.contains("is-collapsed")).toBe(false);
    expect(el.querySelector(".cm-callout-icon")).toBeDefined();
    expect(el.querySelector(".cm-callout-title")!.textContent).toBe("Note Title");
    view.destroy();
  });

  it("shows collapsed state when isCollapsed", () => {
    const view = makeView();
    const widget = new CalloutHeaderWidget("tip", "Tip", true, true, 0);
    const el = widget.toDOM(view);
    const foldIcon = el.querySelector(".cm-callout-fold-icon")!;
    expect(foldIcon.classList.contains("is-collapsed")).toBe(true);
    view.destroy();
  });

  it("places fold icon after title (at line end)", () => {
    const view = makeView();
    const widget = new CalloutHeaderWidget("note", "Note", false, true, 0);
    const el = widget.toDOM(view);
    const children = Array.from(el.children);
    const foldIdx = children.findIndex((c) => c.classList.contains("cm-callout-fold-icon"));
    const titleIdx = children.findIndex((c) => c.classList.contains("cm-callout-title"));
    expect(foldIdx).toBeGreaterThan(titleIdx);
    view.destroy();
  });

  it("omits fold arrow when not foldable", () => {
    const view = makeView();
    const widget = new CalloutHeaderWidget("note", "Note", false, false, 0);
    const el = widget.toDOM(view);
    expect(el.querySelector(".cm-callout-fold-icon")).toBeNull();
    expect(el.querySelector(".cm-callout-icon")).toBeDefined();
    expect(el.querySelector(".cm-callout-title")!.textContent).toBe("Note");
    view.destroy();
  });

  it("dispatches toggleCalloutEffect on arrow click", () => {
    const view = makeView();
    const widget = new CalloutHeaderWidget("note", "Note", false, true, 42);
    const el = widget.toDOM(view);
    const arrow = el.querySelector(".cm-callout-fold-icon")!;
    arrow.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    const foldState = view.state.field(calloutFoldField);
    expect(foldState.get(42)).toBe(true);
    view.destroy();
  });

  it("eq returns true for same props", () => {
    const a = new CalloutHeaderWidget("note", "Title", false, true, 0);
    const b = new CalloutHeaderWidget("note", "Title", false, true, 0);
    expect(a.eq(b)).toBe(true);
  });

  it("eq returns false for different type", () => {
    const a = new CalloutHeaderWidget("note", "Title", false, true, 0);
    const b = new CalloutHeaderWidget("warning", "Title", false, true, 0);
    expect(a.eq(b)).toBe(false);
  });

  it("eq returns false for different collapse state", () => {
    const a = new CalloutHeaderWidget("note", "Title", false, true, 0);
    const b = new CalloutHeaderWidget("note", "Title", true, true, 0);
    expect(a.eq(b)).toBe(false);
  });

  it("updateDOM updates icon, title, and collapse state", () => {
    const view = makeView();
    const a = new CalloutHeaderWidget("note", "Old Title", false, true, 0);
    const dom = a.toDOM(view);
    const b = new CalloutHeaderWidget("warning", "New Title", true, true, 0);
    expect(b.updateDOM(dom, view)).toBe(true);
    expect(dom.querySelector(".cm-callout-title")!.textContent).toBe("New Title");
    expect(dom.querySelector(".cm-callout-fold-icon")!.classList.contains("is-collapsed")).toBe(true);
    view.destroy();
  });

  it("updateDOM adds fold arrow when foldable changes to true", () => {
    const view = makeView();
    const a = new CalloutHeaderWidget("note", "Title", false, false, 0);
    const dom = a.toDOM(view);
    expect(dom.querySelector(".cm-callout-fold-icon")).toBeNull();
    const b = new CalloutHeaderWidget("note", "Title", false, true, 0);
    expect(b.updateDOM(dom, view)).toBe(true);
    expect(dom.querySelector(".cm-callout-fold-icon")).not.toBeNull();
    expect(dom.querySelector(".cm-callout-fold-icon svg.svg-icon")).not.toBeNull();
    view.destroy();
  });

  it("updateDOM removes fold arrow when foldable changes to false", () => {
    const view = makeView();
    const a = new CalloutHeaderWidget("note", "Title", false, true, 0);
    const dom = a.toDOM(view);
    expect(dom.querySelector(".cm-callout-fold-icon")).not.toBeNull();
    const b = new CalloutHeaderWidget("note", "Title", false, false, 0);
    expect(b.updateDOM(dom, view)).toBe(true);
    expect(dom.querySelector(".cm-callout-fold-icon")).toBeNull();
    view.destroy();
  });

  it("updateDOM rebinds fold arrow click handler", () => {
    const view = makeView();
    const a = new CalloutHeaderWidget("note", "Title", false, true, 42);
    const dom = a.toDOM(view);
    const b = new CalloutHeaderWidget("note", "Title", false, true, 42);
    b.updateDOM(dom, view);
    const arrow = dom.querySelector(".cm-callout-fold-icon")!;
    arrow.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    const foldState = view.state.field(calloutFoldField);
    expect(foldState.get(42)).toBe(true);
    view.destroy();
  });

  it("has estimatedHeight of 30", () => {
    const widget = new CalloutHeaderWidget("note", "Title", false, true, 0);
    expect(widget.estimatedHeight).toBe(30);
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

  it("updateDOM re-renders latex in existing element", () => {
    const a = new InlineMathWidget("x^2");
    const dom = a.toDOM();
    const b = new InlineMathWidget("y^3");
    expect(b.updateDOM(dom)).toBe(true);
    expect(dom.textContent).toBe("y^3");
    expect(dom.classList.contains("cm-preview-math-error")).toBe(false);
  });

  it("ignoreEvent returns false to allow click-to-edit", () => {
    expect(new InlineMathWidget("x").ignoreEvent()).toBe(false);
  });

  it("toDOM shows placeholder when katex not loaded, renders after load", async () => {
    vi.mocked(getKatexSync).mockReturnValueOnce(null);
    const widget = new InlineMathWidget("E=mc^2");
    const el = widget.toDOM();
    document.body.appendChild(el);
    expect(el.textContent).toBe("E=mc^2");
    expect(el.classList.contains("cm-preview-math-placeholder")).toBe(true);
    await vi.waitFor(() => {
      expect(el.classList.contains("cm-preview-math-placeholder")).toBe(false);
    });
    expect(el.textContent).toBe("E=mc^2");
    el.remove();
  });

  it("updateDOM shows placeholder when katex not loaded", async () => {
    const a = new InlineMathWidget("x^2");
    const dom = a.toDOM();
    document.body.appendChild(dom);
    vi.mocked(getKatexSync).mockReturnValueOnce(null);
    const b = new InlineMathWidget("y^3");
    expect(b.updateDOM(dom)).toBe(true);
    expect(dom.textContent).toBe("y^3");
    expect(dom.classList.contains("cm-preview-math-placeholder")).toBe(true);
    await vi.waitFor(() => {
      expect(dom.classList.contains("cm-preview-math-placeholder")).toBe(false);
    });
    dom.remove();
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

  it("updateDOM re-renders latex in existing element", () => {
    const a = new DisplayMathWidget("\\sum x");
    const dom = a.toDOM();
    const b = new DisplayMathWidget("\\int y");
    expect(b.updateDOM(dom)).toBe(true);
    expect(dom.textContent).toBe("\\int y");
    expect(dom.classList.contains("cm-preview-math-error")).toBe(false);
  });

  it("ignoreEvent returns false to allow click-to-edit", () => {
    expect(new DisplayMathWidget("x").ignoreEvent()).toBe(false);
  });

  it("toDOM shows placeholder when katex not loaded, renders after load", async () => {
    vi.mocked(getKatexSync).mockReturnValueOnce(null);
    const widget = new DisplayMathWidget("\\sum x");
    const el = widget.toDOM();
    document.body.appendChild(el);
    expect(el.textContent).toBe("\\sum x");
    expect(el.classList.contains("cm-preview-math-placeholder")).toBe(true);
    await vi.waitFor(() => {
      expect(el.classList.contains("cm-preview-math-placeholder")).toBe(false);
    });
    el.remove();
  });

  it("updateDOM shows placeholder when katex not loaded", async () => {
    const a = new DisplayMathWidget("\\sum x");
    const dom = a.toDOM();
    document.body.appendChild(dom);
    vi.mocked(getKatexSync).mockReturnValueOnce(null);
    const b = new DisplayMathWidget("\\int y");
    expect(b.updateDOM(dom)).toBe(true);
    expect(dom.textContent).toBe("\\int y");
    expect(dom.classList.contains("cm-preview-math-placeholder")).toBe(true);
    await vi.waitFor(() => {
      expect(dom.classList.contains("cm-preview-math-placeholder")).toBe(false);
    });
    dom.remove();
  });
});

describe("EditableTableWidget", () => {
  const basicTable = "| a | b |\n| --- | --- |\n| 1 | 2 |";

  function makeWidget(
    text: string,
    from = 0,
    rawLength = text.length,
    prefixes = text.split("\n").map(() => ""),
  ): EditableTableWidget {
    return new EditableTableWidget(text, from, rawLength, prefixes);
  }

  function makeTableView(doc?: string): EditorView {
    const state = EditorState.create({ doc: doc ?? basicTable });
    return new EditorView({ state, parent: document.createElement("div") });
  }

  it("toDOM returns a container div with correct class", () => {
    const view = makeTableView();
    const widget = makeWidget(basicTable, 0);
    const el = widget.toDOM(view);
    expect(el.tagName).toBe("DIV");
    expect(el.className).toBe("cm-preview-table-container");
    view.destroy();
  });

  it("container holds a table with correct class", () => {
    const view = makeTableView();
    const widget = makeWidget(basicTable, 0);
    const el = widget.toDOM(view);
    const table = el.querySelector("table");
    expect(table).not.toBeNull();
    expect(table!.className).toBe("cm-preview-table");
    view.destroy();
  });

  it("has correct thead/tbody structure with correct number of rows/cells", () => {
    const view = makeTableView();
    const widget = makeWidget(basicTable, 0);
    const el = widget.toDOM(view);
    expect(el.querySelectorAll("thead th")).toHaveLength(2);
    expect(el.querySelectorAll("tbody td")).toHaveLength(2);
    view.destroy();
  });

  it("header cells render renderInlineMarkdown() HTML", () => {
    const rich = "| **bold** |\n| --- |\n| text |";
    const view = makeTableView(rich);
    const widget = makeWidget(rich, 0);
    const el = widget.toDOM(view);
    const th = el.querySelector("thead th");
    expect(th!.innerHTML).toContain("<strong>");
    view.destroy();
  });

  it("body cells render renderInlineMarkdown() HTML", () => {
    const rich = "| h |\n| --- |\n| *italic* |";
    const view = makeTableView(rich);
    const widget = makeWidget(rich, 0);
    const el = widget.toDOM(view);
    const td = el.querySelector("tbody td");
    expect(td!.innerHTML).toContain("<em>");
    view.destroy();
  });

  it("cells have contenteditable attribute", () => {
    const view = makeTableView();
    const widget = makeWidget(basicTable, 0);
    const el = widget.toDOM(view);
    const th = el.querySelector("thead th")!;
    const td = el.querySelector("tbody td")!;
    expect(th.getAttribute("contenteditable")).toBe("true");
    expect(td.getAttribute("contenteditable")).toBe("true");
    view.destroy();
  });

  it("cells have data-row and data-col attributes", () => {
    const view = makeTableView();
    const widget = makeWidget(basicTable, 0);
    const el = widget.toDOM(view);
    const ths = el.querySelectorAll("thead th");
    expect(ths[0]!.getAttribute("data-row")).toBe("0");
    expect(ths[0]!.getAttribute("data-col")).toBe("0");
    expect(ths[1]!.getAttribute("data-row")).toBe("0");
    expect(ths[1]!.getAttribute("data-col")).toBe("1");
    const tds = el.querySelectorAll("tbody td");
    expect(tds[0]!.getAttribute("data-row")).toBe("1");
    expect(tds[0]!.getAttribute("data-col")).toBe("0");
    view.destroy();
  });

  it("assigns correct data-row for multiple body rows", () => {
    const multiRow = "| h |\n| --- |\n| r1 |\n| r2 |";
    const view = makeTableView(multiRow);
    const widget = makeWidget(multiRow, 0);
    const el = widget.toDOM(view);
    const tds = el.querySelectorAll("tbody td");
    expect(tds[1]!.getAttribute("data-row")).toBe("2");
    view.destroy();
  });

  it("applies text-align based on alignment", () => {
    const aligned = "| L | R | C |\n| :--- | ---: | :---: |\n| a | b | c |";
    const view = makeTableView(aligned);
    const widget = makeWidget(aligned, 0);
    const el = widget.toDOM(view);
    const ths = el.querySelectorAll<HTMLElement>("thead th");
    expect(ths[0]!.style.textAlign).toBe("left");
    expect(ths[1]!.style.textAlign).toBe("right");
    expect(ths[2]!.style.textAlign).toBe("center");
    const tds = el.querySelectorAll<HTMLElement>("tbody td");
    expect(tds[0]!.style.textAlign).toBe("left");
    expect(tds[1]!.style.textAlign).toBe("right");
    expect(tds[2]!.style.textAlign).toBe("center");
    view.destroy();
  });

  it("renders header-only table without tbody", () => {
    const headerOnly = "| H |\n| --- |";
    const view = makeTableView(headerOnly);
    const widget = makeWidget(headerOnly, 0);
    const el = widget.toDOM(view);
    expect(el.querySelector("thead")).not.toBeNull();
    expect(el.querySelector("tbody")).toBeNull();
    view.destroy();
  });

  it("clicking a cell with inline formatting selects all content on focus", () => {
    const rich = "| text $E=mc^2$ more |\n| --- |\n| val |";
    const view = makeTableView(rich);
    const widget = makeWidget(rich, 0);
    const el = widget.toDOM(view);
    document.body.appendChild(el);
    const th = el.querySelector("thead th") as HTMLElement;
    expect(th.childElementCount).toBeGreaterThan(0);
    th.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    th.dispatchEvent(new FocusEvent("focus"));
    expect(th.textContent).toBe("text $E=mc^2$ more");
    const sel = window.getSelection();
    expect(sel).not.toBeNull();
    expect(sel!.rangeCount).toBeGreaterThan(0);
    const range = sel!.getRangeAt(0);
    expect(range.collapsed).toBe(false);
    expect(range.toString()).toBe("text $E=mc^2$ more");
    el.remove();
    view.destroy();
  });

  it("clicking a plain text cell places cursor at end without selecting", () => {
    const view = makeTableView();
    const widget = makeWidget(basicTable, 0);
    const el = widget.toDOM(view);
    document.body.appendChild(el);
    const th = el.querySelector("thead th") as HTMLElement;
    expect(th.childElementCount).toBe(0);
    th.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    th.dispatchEvent(new FocusEvent("focus"));
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      expect(sel.getRangeAt(0).collapsed).toBe(true);
    }
    el.remove();
    view.destroy();
  });

  it("blurring a cell with changed content dispatches view.dispatch", () => {
    const view = makeTableView();
    const dispatchSpy = vi.spyOn(view, "dispatch");
    const widget = makeWidget(basicTable, 0);
    const el = widget.toDOM(view);
    const td = el.querySelector('td[data-row="1"][data-col="0"]') as HTMLElement;
    td.dispatchEvent(new FocusEvent("focus"));
    td.textContent = "changed";
    td.dispatchEvent(new FocusEvent("blur"));
    expect(dispatchSpy).toHaveBeenCalled();
    const call = dispatchSpy.mock.calls[0]![0] as { changes: { from: number; to: number; insert: string } };
    expect(call.changes.insert).toContain("changed");
    view.destroy();
  });

  it("blurring with unchanged content does not dispatch", () => {
    const view = makeTableView();
    const dispatchSpy = vi.spyOn(view, "dispatch");
    const widget = makeWidget(basicTable, 0);
    const el = widget.toDOM(view);
    const td = el.querySelector('td[data-row="1"][data-col="0"]') as HTMLElement;
    td.dispatchEvent(new FocusEvent("focus"));
    td.dispatchEvent(new FocusEvent("blur"));
    expect(dispatchSpy).not.toHaveBeenCalled();
    view.destroy();
  });

  it("pressing Enter commits and blurs", () => {
    const view = makeTableView();
    const dispatchSpy = vi.spyOn(view, "dispatch");
    const widget = makeWidget(basicTable, 0);
    const el = widget.toDOM(view);
    const td = el.querySelector('td[data-row="1"][data-col="0"]') as HTMLElement;
    td.dispatchEvent(new FocusEvent("focus"));
    td.textContent = "new";
    const enterEvent = new KeyboardEvent("keydown", { key: "Enter", cancelable: true });
    td.dispatchEvent(enterEvent);
    expect(enterEvent.defaultPrevented).toBe(true);
    expect(dispatchSpy).toHaveBeenCalled();
    view.destroy();
  });

  it("eq returns true for same tableText and from", () => {
    const a = makeWidget(basicTable, 0);
    const b = makeWidget(basicTable, 0);
    expect(a.eq(b)).toBe(true);
  });

  it("eq returns false for different tableText", () => {
    const a = makeWidget(basicTable, 0);
    const b = makeWidget("| x |\n| --- |\n| y |", 0);
    expect(a.eq(b)).toBe(false);
  });

  it("eq returns false when from differs", () => {
    expect(makeWidget(basicTable, 0).eq(makeWidget(basicTable, 10))).toBe(false);
  });

  it("eq returns false when prefixes differ", () => {
    const a = makeWidget(basicTable, 0, basicTable.length, ["", "", ""]);
    const b = makeWidget(basicTable, 0, basicTable.length, ["", "> ", "> "]);
    expect(a.eq(b)).toBe(false);
  });

  describe("table inside blockquote", () => {
    const quotedRaw = "| a | b |\n> | --- | --- |\n> | 1 | 2 |";

    it("renders a non-empty table from stripped text", () => {
      const { text, prefixes } = stripQuotePrefixes(quotedRaw);
      const view = makeTableView(quotedRaw);
      const widget = makeWidget(text, 0, quotedRaw.length, prefixes);
      const el = widget.toDOM(view);
      expect(el.querySelector("table")).not.toBeNull();
      expect(el.querySelectorAll("thead th")).toHaveLength(2);
      expect(el.querySelectorAll("tbody td")).toHaveLength(2);
      view.destroy();
    });

    it("write-back re-applies quote prefixes and replaces the raw range", () => {
      const { text, prefixes } = stripQuotePrefixes(quotedRaw);
      const view = makeTableView(quotedRaw);
      const dispatchSpy = vi.spyOn(view, "dispatch");
      const widget = makeWidget(text, 0, quotedRaw.length, prefixes);
      const el = widget.toDOM(view);
      const td = el.querySelector('td[data-row="1"][data-col="0"]') as HTMLElement;
      td.dispatchEvent(new FocusEvent("focus"));
      td.textContent = "changed";
      td.dispatchEvent(new FocusEvent("blur"));
      expect(dispatchSpy).toHaveBeenCalled();
      const call = dispatchSpy.mock.calls[0]![0] as { changes: { from: number; to: number; insert: string } };
      expect(call.changes.to).toBe(quotedRaw.length);
      const lines = call.changes.insert.split("\n");
      expect(lines[0]!.startsWith(">")).toBe(false);
      expect(lines[1]!.startsWith("> ")).toBe(true);
      expect(lines[2]!.startsWith("> ")).toBe(true);
      expect(call.changes.insert).toContain("changed");
      view.destroy();
    });
  });

  it("updateDOM rebuilds table in existing container", () => {
    const view = makeTableView();
    const a = makeWidget(basicTable, 0);
    const dom = a.toDOM(view);
    const newTable = "| x |\n| --- |\n| 1 |";
    const b = makeWidget(newTable, 0);
    expect(b.updateDOM(dom, view)).toBe(true);
    expect(dom.querySelector("table")).not.toBeNull();
    const ths = dom.querySelectorAll<HTMLElement>("thead th");
    expect(ths).toHaveLength(1);
    expect(ths[0]!.dataset.raw).toBe("x");
    const tds = dom.querySelectorAll<HTMLElement>("tbody td");
    expect(tds).toHaveLength(1);
    expect(tds[0]!.dataset.raw).toBe("1");
    view.destroy();
  });

  it("updateDOM returns false when parse fails", () => {
    const view = makeTableView();
    const a = makeWidget(basicTable, 0);
    const dom = a.toDOM(view);
    const b = makeWidget("not a table", 0);
    expect(b.updateDOM(dom, view)).toBe(false);
    view.destroy();
  });

  it("updateDOM preserves container element identity", () => {
    const view = makeTableView();
    const a = makeWidget(basicTable, 0);
    const dom = a.toDOM(view);
    const ref = dom;
    const b = makeWidget("| y |\n| --- |\n| 2 |", 0);
    b.updateDOM(dom, view);
    expect(dom).toBe(ref);
    expect(dom.className).toBe("cm-preview-table-container");
    view.destroy();
  });

  it("ignoreEvent returns true for all events", () => {
    const widget = makeWidget(basicTable, 0);
    expect(widget.ignoreEvent()).toBe(true);
  });

  describe("wikilink plain-click navigation", () => {
    const wikiTable = "| link |\n| --- |\n| [[Target]] |";

    function makeTableViewWithFacet(navigateToPage: ReturnType<typeof vi.fn>): EditorView {
      const state = EditorState.create({
        doc: wikiTable,
        extensions: [navigateToPageFacet.of(navigateToPage)],
      });
      return new EditorView({ state, parent: document.createElement("div") });
    }

    function clickOn(span: Element): MouseEvent {
      const event = new MouseEvent("mousedown", {
        button: 0,
        bubbles: true,
        cancelable: true,
      });
      span.dispatchEvent(event);
      return event;
    }

    it("plain click on wikilink in cell calls navigateToPage with departurePos", () => {
      const nav = vi.fn();
      const view = makeTableViewWithFacet(nav);
      const widget = makeWidget(wikiTable, 0);
      const el = widget.toDOM(view);
      document.body.appendChild(el);
      const span = el.querySelector(".cm-preview-wikilink")!;
      clickOn(span);
      expect(nav).toHaveBeenCalledWith("Target", undefined, 0);
      el.remove();
      view.destroy();
    });

    it("plain click with section passes section arg", () => {
      const sectionTable = "| link |\n| --- |\n| [[Page#Heading]] |";
      const nav = vi.fn();
      const state = EditorState.create({
        doc: sectionTable,
        extensions: [navigateToPageFacet.of(nav)],
      });
      const view = new EditorView({ state, parent: document.createElement("div") });
      const widget = makeWidget(sectionTable, 0);
      const el = widget.toDOM(view);
      document.body.appendChild(el);
      const span = el.querySelector(".cm-preview-wikilink")!;
      clickOn(span);
      expect(nav).toHaveBeenCalledWith("Page", "Heading", 0);
      el.remove();
      view.destroy();
    });

    it("plain click on wikilink with section+hash uses target not display text", () => {
      const hashTable = "| link |\n| --- |\n| [[OtherPage#Details]] |";
      const nav = vi.fn();
      const state = EditorState.create({
        doc: hashTable,
        extensions: [navigateToPageFacet.of(nav)],
      });
      const view = new EditorView({ state, parent: document.createElement("div") });
      const widget = makeWidget(hashTable, 0);
      const el = widget.toDOM(view);
      document.body.appendChild(el);
      const span = el.querySelector(".cm-preview-wikilink")!;
      expect(span.textContent).toBe("OtherPage#Details");
      expect(span.getAttribute("data-wikilink-target")).toBe("OtherPage");
      clickOn(span);
      expect(nav).toHaveBeenCalledWith("OtherPage", "Details", 0);
      el.remove();
      view.destroy();
    });

    it("uses posAtCoords when available instead of this.from", () => {
      const nav = vi.fn();
      const view = makeTableViewWithFacet(nav);
      vi.spyOn(view, "posAtCoords").mockReturnValue(15);
      const widget = makeWidget(wikiTable, 5);
      const el = widget.toDOM(view);
      document.body.appendChild(el);
      const span = el.querySelector(".cm-preview-wikilink")!;
      clickOn(span);
      expect(nav).toHaveBeenCalledWith("Target", undefined, 15);
      el.remove();
      view.destroy();
    });

    it("falls back to posAtDOM when posAtCoords returns null", () => {
      const nav = vi.fn();
      const view = makeTableViewWithFacet(nav);
      vi.spyOn(view, "posAtCoords").mockReturnValue(null);
      vi.spyOn(view, "posAtDOM").mockReturnValue(7);
      const widget = makeWidget(wikiTable, 42);
      const el = widget.toDOM(view);
      document.body.appendChild(el);
      const span = el.querySelector(".cm-preview-wikilink")!;
      clickOn(span);
      expect(nav).toHaveBeenCalledWith("Target", undefined, 7);
      el.remove();
      view.destroy();
    });

    it("cmd+click does NOT navigate", () => {
      const nav = vi.fn();
      const view = makeTableViewWithFacet(nav);
      const widget = makeWidget(wikiTable, 0);
      const el = widget.toDOM(view);
      document.body.appendChild(el);
      const span = el.querySelector(".cm-preview-wikilink")!;
      span.dispatchEvent(new MouseEvent("mousedown", {
        button: 0,
        metaKey: true,
        bubbles: true,
        cancelable: true,
      }));
      expect(nav).not.toHaveBeenCalled();
      el.remove();
      view.destroy();
    });

    it("plain click on non-wikilink cell does NOT navigate", () => {
      const nav = vi.fn();
      const view = makeTableViewWithFacet(nav);
      const widget = makeWidget(wikiTable, 0);
      const el = widget.toDOM(view);
      document.body.appendChild(el);
      const th = el.querySelector("thead th")!;
      th.dispatchEvent(new MouseEvent("mousedown", {
        button: 0,
        bubbles: true,
        cancelable: true,
      }));
      expect(nav).not.toHaveBeenCalled();
      el.remove();
      view.destroy();
    });

    it("plain click prevents cell focus via stopPropagation", () => {
      const nav = vi.fn();
      const view = makeTableViewWithFacet(nav);
      const widget = makeWidget(wikiTable, 0);
      const el = widget.toDOM(view);
      document.body.appendChild(el);
      const span = el.querySelector(".cm-preview-wikilink")!;
      const event = clickOn(span);
      expect(event.defaultPrevented).toBe(true);
      el.remove();
      view.destroy();
    });

    it("no error when facet not provided", () => {
      const view = makeTableView();
      const widget = makeWidget(wikiTable, 0);
      const el = widget.toDOM(view);
      document.body.appendChild(el);
      const span = el.querySelector(".cm-preview-wikilink")!;
      expect(() => {
        span.dispatchEvent(new MouseEvent("mousedown", {
          button: 0,
          bubbles: true,
          cancelable: true,
        }));
      }).not.toThrow();
      el.remove();
      view.destroy();
    });
  });

  describe("non-wikilink mousedown dispatches widgetSync selection", () => {
    it("dispatches selection at posAtDOM position with widgetSync annotation", () => {
      const doc = "prefix\n| a | b |\n| --- | --- |\n| 1 | 2 |";
      const state = EditorState.create({ doc });
      const view = new EditorView({ state, parent: document.createElement("div") });
      vi.spyOn(view, "posAtDOM").mockReturnValue(10);
      const dispatchSpy = vi.spyOn(view, "dispatch");
      const widget = makeWidget(basicTable, 10);
      const el = widget.toDOM(view);
      document.body.appendChild(el);

      const th = el.querySelector("thead th")!;
      th.dispatchEvent(new MouseEvent("mousedown", {
        button: 0,
        bubbles: true,
        cancelable: true,
      }));

      expect(view.state.selection.main.head).toBe(10);
      const syncCall = dispatchSpy.mock.calls.find((args) => {
        const spec = args[0] as Record<string, unknown>;
        const ann = spec?.annotations as { type?: unknown } | undefined;
        return ann?.type === widgetSync;
      });
      expect(syncCall).toBeDefined();
      el.remove();
      view.destroy();
    });

    it("uses posAtDOM at event time, not stale constructor from", () => {
      const doc = "some prefix text\n| a | b |\n| --- | --- |\n| 1 | 2 |";
      const state = EditorState.create({ doc });
      const view = new EditorView({ state, parent: document.createElement("div") });
      const posAtDOMSpy = vi.spyOn(view, "posAtDOM");

      posAtDOMSpy.mockReturnValue(10);
      const oldWidget = makeWidget(basicTable, 10);
      const dom = oldWidget.toDOM(view);
      document.body.appendChild(dom);

      posAtDOMSpy.mockReturnValue(20);
      const newWidget = makeWidget(basicTable, 20);
      newWidget.updateDOM(dom, view);

      const th = dom.querySelector("thead th")!;
      th.dispatchEvent(new MouseEvent("mousedown", {
        button: 0,
        bubbles: true,
        cancelable: true,
      }));

      expect(view.state.selection.main.head).toBe(20);
      dom.remove();
      view.destroy();
    });

    it("wikilink click does NOT dispatch widgetSync selection", () => {
      const wikiTable = "| link |\n| --- |\n| [[Target]] |";
      const nav = vi.fn();
      const state = EditorState.create({
        doc: wikiTable,
        extensions: [navigateToPageFacet.of(nav)],
      });
      const view = new EditorView({ state, parent: document.createElement("div") });
      const dispatchSpy = vi.spyOn(view, "dispatch");
      const widget = makeWidget(wikiTable, 0);
      const el = widget.toDOM(view);
      document.body.appendChild(el);

      const span = el.querySelector(".cm-preview-wikilink")!;
      span.dispatchEvent(new MouseEvent("mousedown", {
        button: 0,
        bubbles: true,
        cancelable: true,
      }));

      const hasWidgetSync = dispatchSpy.mock.calls.some((args) => {
        const spec = args[0] as Record<string, unknown>;
        const ann = spec?.annotations as { type?: unknown } | undefined;
        return ann?.type === widgetSync;
      });
      expect(hasWidgetSync).toBe(false);
      el.remove();
      view.destroy();
    });
  });
});

describe("HorizontalRuleWidget", () => {
  it("toDOM returns an <hr> with class cm-preview-hr", () => {
    const widget = new HorizontalRuleWidget();
    const el = widget.toDOM();
    expect(el.tagName).toBe("HR");
    expect(el.className).toBe("cm-preview-hr");
  });

  it("sets margin to 0 to avoid CM6 height-map corruption", () => {
    const widget = new HorizontalRuleWidget();
    const el = widget.toDOM();
    expect(el.style.margin).toBe("0px");
  });

  it("eq returns true (all HRs are identical)", () => {
    const a = new HorizontalRuleWidget();
    const b = new HorizontalRuleWidget();
    expect(a.eq(b)).toBe(true);
  });

  it("ignoreEvent returns false", () => {
    expect(new HorizontalRuleWidget().ignoreEvent()).toBe(false);
  });

  it("estimatedHeight returns 20", () => {
    expect(new HorizontalRuleWidget().estimatedHeight).toBe(20);
  });
});

describe("PageBreakWidget", () => {
  it("toDOM returns a div with correct structure", () => {
    const widget = new PageBreakWidget(5);
    const el = widget.toDOM();
    expect(el.tagName).toBe("DIV");
    expect(el.className).toBe("cm-preview-page-break");
    expect(el.children).toHaveLength(3);
    expect(el.children[0]!.className).toBe("cm-preview-page-break-rule");
    expect(el.children[1]!.className).toBe("cm-preview-page-break-label");
    expect(el.children[1]!.textContent).toBe("Page 5");
    expect(el.children[2]!.className).toBe("cm-preview-page-break-rule");
  });

  it("toDOM sets role=separator on container", () => {
    const widget = new PageBreakWidget(5);
    const el = widget.toDOM();
    expect(el.getAttribute("role")).toBe("separator");
  });

  it("toDOM sets aria-label with page number", () => {
    const widget = new PageBreakWidget(5);
    const el = widget.toDOM();
    expect(el.getAttribute("aria-label")).toBe("Page 5");
  });

  it("updateDOM updates aria-label when page number changes", () => {
    const a = new PageBreakWidget(1);
    const dom = a.toDOM();
    expect(dom.getAttribute("aria-label")).toBe("Page 1");
    const b = new PageBreakWidget(7);
    expect(b.updateDOM(dom)).toBe(true);
    expect(dom.getAttribute("aria-label")).toBe("Page 7");
  });

  it("eq returns true for same page number", () => {
    const a = new PageBreakWidget(3);
    const b = new PageBreakWidget(3);
    expect(a.eq(b)).toBe(true);
  });

  it("eq returns false for different page numbers", () => {
    const a = new PageBreakWidget(1);
    const b = new PageBreakWidget(2);
    expect(a.eq(b)).toBe(false);
  });

  it("ignoreEvent returns false", () => {
    expect(new PageBreakWidget(1).ignoreEvent()).toBe(false);
  });

  it("estimatedHeight returns 20", () => {
    expect(new PageBreakWidget(1).estimatedHeight).toBe(20);
  });

  it("updateDOM patches label text and returns true", () => {
    const a = new PageBreakWidget(1);
    const dom = a.toDOM();
    const b = new PageBreakWidget(7);
    expect(b.updateDOM(dom)).toBe(true);
    expect(dom.querySelector(".cm-preview-page-break-label")!.textContent).toBe(
      "Page 7",
    );
  });

  it("updateDOM preserves element identity", () => {
    const a = new PageBreakWidget(1);
    const dom = a.toDOM();
    const ref = dom;
    const b = new PageBreakWidget(2);
    b.updateDOM(dom);
    expect(dom).toBe(ref);
    expect(dom.children).toHaveLength(3);
    expect(dom.children[0]!.className).toBe("cm-preview-page-break-rule");
    expect(dom.children[1]!.className).toBe("cm-preview-page-break-label");
    expect(dom.children[2]!.className).toBe("cm-preview-page-break-rule");
  });

  it("updateDOM returns false when label element is missing", () => {
    const widget = new PageBreakWidget(1);
    const div = document.createElement("div");
    expect(widget.updateDOM(div)).toBe(false);
  });
});

describe("MermaidWidget", () => {
  beforeEach(() => {
    vi.mocked(getMermaidCached).mockReturnValue(undefined);
    vi.mocked(renderMermaid).mockResolvedValue("<svg>ok</svg>");
  });

  it("toDOM returns a div with class cm-preview-mermaid", () => {
    const widget = new MermaidWidget("graph LR; A-->B", "default");
    const el = widget.toDOM();
    expect(el.tagName).toBe("DIV");
    expect(el.className).toBe("cm-preview-mermaid");
  });

  it("toDOM shows spinner when cache is empty", () => {
    const widget = new MermaidWidget("graph LR; A-->B", "default");
    const el = widget.toDOM();
    const loading = el.querySelector(".cm-preview-mermaid-loading");
    expect(loading).not.toBeNull();
    expect(loading!.querySelector("svg")).not.toBeNull();
  });

  it("toDOM shows cached SVG immediately when cache has a value", () => {
    vi.mocked(getMermaidCached).mockReturnValue("<svg>cached</svg>");
    const widget = new MermaidWidget("graph LR; A-->B", "default");
    const el = widget.toDOM();
    expect(el.innerHTML).toBe("<svg>cached</svg>");
    expect(el.querySelector(".cm-preview-mermaid-loading")).toBeNull();
  });

  it("toDOM calls renderMermaid to populate cache asynchronously", () => {
    const widget = new MermaidWidget("graph LR; A-->B", "dark");
    widget.toDOM();
    expect(renderMermaid).toHaveBeenCalledWith("graph LR; A-->B", "dark");
  });

  it("toDOM shows error container on render failure", async () => {
    vi.mocked(renderMermaid).mockRejectedValue(new Error("bad diagram"));
    const widget = new MermaidWidget("bad", "default");
    const el = widget.toDOM();
    document.body.appendChild(el);
    await vi.waitFor(() => {
      const error = el.querySelector(".cm-preview-mermaid-error");
      expect(error).not.toBeNull();
      expect(error!.textContent).toBe("bad diagram");
    });
    el.remove();
  });

  it("eq returns true for same source and theme", () => {
    const a = new MermaidWidget("graph LR; A-->B", "default");
    const b = new MermaidWidget("graph LR; A-->B", "default");
    expect(a.eq(b)).toBe(true);
  });

  it("eq returns false for different source", () => {
    const a = new MermaidWidget("graph LR; A-->B", "default");
    const b = new MermaidWidget("graph LR; C-->D", "default");
    expect(a.eq(b)).toBe(false);
  });

  it("eq returns false for different theme", () => {
    const a = new MermaidWidget("graph LR; A-->B", "default");
    const b = new MermaidWidget("graph LR; A-->B", "dark");
    expect(a.eq(b)).toBe(false);
  });

  it("updateDOM uses cached SVG when available", () => {
    const a = new MermaidWidget("graph LR; A-->B", "default");
    vi.mocked(getMermaidCached).mockReturnValue("<svg>first</svg>");
    const dom = a.toDOM();
    vi.mocked(getMermaidCached).mockReturnValue("<svg>updated</svg>");
    const b = new MermaidWidget("graph LR; C-->D", "default");
    expect(b.updateDOM(dom)).toBe(true);
    expect(dom.innerHTML).toBe("<svg>updated</svg>");
  });

  it("updateDOM shows spinner and calls renderMermaid when cache is empty", () => {
    vi.mocked(getMermaidCached).mockReturnValue("<svg>initial</svg>");
    const a = new MermaidWidget("graph LR; A-->B", "default");
    const dom = a.toDOM();
    vi.mocked(getMermaidCached).mockReturnValue(undefined);
    vi.mocked(renderMermaid).mockClear();
    const b = new MermaidWidget("graph LR; C-->D", "dark");
    expect(b.updateDOM(dom)).toBe(true);
    expect(dom.querySelector(".cm-preview-mermaid-loading")).not.toBeNull();
    expect(renderMermaid).toHaveBeenCalledWith("graph LR; C-->D", "dark");
  });

  it("ignoreEvent returns true", () => {
    const widget = new MermaidWidget("graph LR; A-->B", "default");
    expect(widget.ignoreEvent()).toBe(true);
  });

  describe("thumbnail mode", () => {
    it("toDOM adds cm-preview-mermaid--thumbnail class", () => {
      vi.mocked(getMermaidCached).mockReturnValue("<svg>ok</svg>");
      const widget = new MermaidWidget("graph LR; A-->B", "default", true);
      const el = widget.toDOM();
      expect(el.classList.contains("cm-preview-mermaid--thumbnail")).toBe(true);
      expect(el.classList.contains("cm-preview-mermaid")).toBe(true);
    });

    it("estimatedHeight returns 136 (120px maxHeight + 16px padding)", () => {
      const widget = new MermaidWidget("graph LR; A-->B", "default", true);
      expect(widget.estimatedHeight).toBe(136);
    });

    it("eq returns false when thumbnail flag differs", () => {
      const a = new MermaidWidget("graph LR; A-->B", "default", true);
      const b = new MermaidWidget("graph LR; A-->B", "default", false);
      expect(a.eq(b)).toBe(false);
    });

    it("non-thumbnail: backward compatible (no third arg)", () => {
      const widget = new MermaidWidget("graph LR; A-->B", "default");
      expect(widget.thumbnail).toBe(false);
      expect(widget.estimatedHeight).toBe(200);
      const el = widget.toDOM();
      expect(el.classList.contains("cm-preview-mermaid--thumbnail")).toBe(false);
    });
  });
});
