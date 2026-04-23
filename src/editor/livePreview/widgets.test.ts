import { describe, it, expect, vi, beforeEach } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import {
  ImageWidget,
  CalloutHeaderWidget,
  InlineMathWidget,
  DisplayMathWidget,
  EditableTableWidget,
  MermaidWidget,
} from "./widgets";
import { calloutFoldField } from "./callout";
import { renderMermaid, getMermaidCached } from "./mermaid";

vi.mock("katex", () => ({
  default: {
    render: vi.fn((tex: string, el: HTMLElement) => {
      el.textContent = tex;
    }),
    renderToString: vi.fn((tex: string) => `<span class="katex">${tex}</span>`),
  },
}));

vi.mock("katex/dist/katex.min.css", () => ({}));

vi.mock("./mermaid", () => ({
  renderMermaid: vi.fn(async () => {}),
  getMermaidCached: vi.fn(() => undefined),
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

  it("ignoreEvent returns false to allow click-to-edit", () => {
    expect(new InlineMathWidget("x").ignoreEvent()).toBe(false);
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

  it("ignoreEvent returns false to allow click-to-edit", () => {
    expect(new DisplayMathWidget("x").ignoreEvent()).toBe(false);
  });
});

describe("EditableTableWidget", () => {
  const basicTable = "| a | b |\n| --- | --- |\n| 1 | 2 |";

  function makeTableView(doc?: string): EditorView {
    const state = EditorState.create({ doc: doc ?? basicTable });
    return new EditorView({ state, parent: document.createElement("div") });
  }

  it("toDOM returns a container div with correct class", () => {
    const view = makeTableView();
    const widget = new EditableTableWidget(basicTable, 0);
    const el = widget.toDOM(view);
    expect(el.tagName).toBe("DIV");
    expect(el.className).toBe("cm-preview-table-container");
    view.destroy();
  });

  it("container holds a table with correct class", () => {
    const view = makeTableView();
    const widget = new EditableTableWidget(basicTable, 0);
    const el = widget.toDOM(view);
    const table = el.querySelector("table");
    expect(table).not.toBeNull();
    expect(table!.className).toBe("cm-preview-table");
    view.destroy();
  });

  it("has correct thead/tbody structure with correct number of rows/cells", () => {
    const view = makeTableView();
    const widget = new EditableTableWidget(basicTable, 0);
    const el = widget.toDOM(view);
    expect(el.querySelectorAll("thead th")).toHaveLength(2);
    expect(el.querySelectorAll("tbody td")).toHaveLength(2);
    view.destroy();
  });

  it("header cells render renderInlineMarkdown() HTML", () => {
    const rich = "| **bold** |\n| --- |\n| text |";
    const view = makeTableView(rich);
    const widget = new EditableTableWidget(rich, 0);
    const el = widget.toDOM(view);
    const th = el.querySelector("thead th");
    expect(th!.innerHTML).toContain("<strong>");
    view.destroy();
  });

  it("body cells render renderInlineMarkdown() HTML", () => {
    const rich = "| h |\n| --- |\n| *italic* |";
    const view = makeTableView(rich);
    const widget = new EditableTableWidget(rich, 0);
    const el = widget.toDOM(view);
    const td = el.querySelector("tbody td");
    expect(td!.innerHTML).toContain("<em>");
    view.destroy();
  });

  it("cells have contenteditable attribute", () => {
    const view = makeTableView();
    const widget = new EditableTableWidget(basicTable, 0);
    const el = widget.toDOM(view);
    const th = el.querySelector("thead th")!;
    const td = el.querySelector("tbody td")!;
    expect(th.getAttribute("contenteditable")).toBe("true");
    expect(td.getAttribute("contenteditable")).toBe("true");
    view.destroy();
  });

  it("cells have data-row and data-col attributes", () => {
    const view = makeTableView();
    const widget = new EditableTableWidget(basicTable, 0);
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
    const widget = new EditableTableWidget(multiRow, 0);
    const el = widget.toDOM(view);
    const tds = el.querySelectorAll("tbody td");
    expect(tds[1]!.getAttribute("data-row")).toBe("2");
    view.destroy();
  });

  it("applies text-align based on alignment", () => {
    const aligned = "| L | R | C |\n| :--- | ---: | :---: |\n| a | b | c |";
    const view = makeTableView(aligned);
    const widget = new EditableTableWidget(aligned, 0);
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
    const widget = new EditableTableWidget(headerOnly, 0);
    const el = widget.toDOM(view);
    expect(el.querySelector("thead")).not.toBeNull();
    expect(el.querySelector("tbody")).toBeNull();
    view.destroy();
  });

  it("clicking a cell with inline formatting selects all content on focus", () => {
    const rich = "| text $E=mc^2$ more |\n| --- |\n| val |";
    const view = makeTableView(rich);
    const widget = new EditableTableWidget(rich, 0);
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
    const widget = new EditableTableWidget(basicTable, 0);
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
    const widget = new EditableTableWidget(basicTable, 0);
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
    const widget = new EditableTableWidget(basicTable, 0);
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
    const widget = new EditableTableWidget(basicTable, 0);
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
    const a = new EditableTableWidget(basicTable, 0);
    const b = new EditableTableWidget(basicTable, 0);
    expect(a.eq(b)).toBe(true);
  });

  it("eq returns false for different tableText", () => {
    const a = new EditableTableWidget(basicTable, 0);
    const b = new EditableTableWidget("| x |\n| --- |\n| y |", 0);
    expect(a.eq(b)).toBe(false);
  });

  it("eq returns false when from differs", () => {
    expect(new EditableTableWidget(basicTable, 0).eq(new EditableTableWidget(basicTable, 10))).toBe(false);
  });

  it("ignoreEvent returns true for all events", () => {
    const widget = new EditableTableWidget(basicTable, 0);
    expect(widget.ignoreEvent()).toBe(true);
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

  it("ignoreEvent returns true", () => {
    const widget = new MermaidWidget("graph LR; A-->B", "default");
    expect(widget.ignoreEvent()).toBe(true);
  });
});
