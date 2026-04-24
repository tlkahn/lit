import { describe, it, expect, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { GFM } from "@lezer/markdown";
import { buildDecorations, buildBlockReplacements } from "./decorations";
import { WikiLink } from "../markdown/wikilink";
import { Math as MathExt } from "../markdown/math";
import { Comment as CommentExt } from "../markdown/comment";
import { calloutFoldField } from "./callout";

vi.mock("katex", () => ({
  default: {
    render: vi.fn((tex: string, el: HTMLElement) => {
      el.textContent = tex;
    }),
  },
}));

vi.mock("katex/dist/katex.min.css", () => ({}));

vi.mock("mermaid", () => ({
  default: { initialize: vi.fn(), render: vi.fn(async () => ({ svg: "<svg/>" })) },
}));

vi.mock("./mermaid", () => ({
  renderMermaid: vi.fn(async () => {}),
  getMermaidCached: vi.fn(() => undefined),
}));

function makeView(doc: string, cursor: number): EditorView {
  const state = EditorState.create({
    doc,
    selection: { anchor: cursor },
    extensions: [
      markdown({ extensions: [GFM, WikiLink, MathExt, CommentExt] }),
      calloutFoldField,
    ],
  });
  return new EditorView({ state, parent: document.createElement("div") });
}

type DecoInfo = {
  from: number;
  to: number;
  type: "mark" | "replace";
  class?: string;
  widget?: boolean;
  url?: string;
};

function collectDecos(view: EditorView): DecoInfo[] {
  const decoSet = buildDecorations(view);
  const result: DecoInfo[] = [];
  const iter = decoSet.iter();
  while (iter.value) {
    const spec = iter.value.spec;
    const info: DecoInfo = {
      from: iter.from,
      to: iter.to,
      type: spec.class ? "mark" : spec.widget ? "replace" : "replace",
    };
    if (spec.widget) info.widget = true;
    if (spec.class) info.class = spec.class;
    if (spec.attributes?.["data-url"]) info.url = spec.attributes["data-url"];
    result.push(info);
    iter.next();
  }
  return result;
}

describe("buildDecorations — headings", () => {
  it("hides HeaderMark and applies heading class when cursor is elsewhere", () => {
    const view = makeView("## Title\n\nbody", 12); // cursor on "body"
    const decos = collectDecos(view);
    // Should hide "## " (0-3)
    const replace = decos.find((d) => d.type === "replace" && d.from === 0);
    expect(replace).toBeDefined();
    expect(replace!.to).toBe(3);
    // Should mark "Title" with cm-preview-h2
    const mark = decos.find((d) => d.class === "cm-preview-h2");
    expect(mark).toBeDefined();
    expect(mark!.from).toBe(3);
    expect(mark!.to).toBe(8);
    view.destroy();
  });

  it("does not decorate when cursor is on the heading line", () => {
    const view = makeView("## Title\n\nbody", 5); // cursor on "Title"
    const decos = collectDecos(view);
    const headingDecos = decos.filter(
      (d) => d.class?.startsWith("cm-preview-h") || (d.type === "replace" && d.from === 0),
    );
    expect(headingDecos).toHaveLength(0);
    view.destroy();
  });

  it("decorates multiple headings on non-cursor lines", () => {
    const doc = "# H1\n\n## H2\n\nbody";
    const view = makeView(doc, doc.length - 1); // cursor on "body"
    const decos = collectDecos(view);
    expect(decos.find((d) => d.class === "cm-preview-h1")).toBeDefined();
    expect(decos.find((d) => d.class === "cm-preview-h2")).toBeDefined();
    view.destroy();
  });
});

describe("buildDecorations — bold and italic", () => {
  it("hides ** markers and applies bold class", () => {
    const doc = "**bold** text\n\nother";
    const view = makeView(doc, doc.length - 1); // cursor on "other"
    const decos = collectDecos(view);
    // ** at [0,2] and [6,8] should be replaced
    const replaces = decos.filter((d) => d.type === "replace");
    expect(replaces.some((d) => d.from === 0 && d.to === 2)).toBe(true);
    expect(replaces.some((d) => d.from === 6 && d.to === 8)).toBe(true);
    // bold mark on [2,6]
    const bold = decos.find((d) => d.class === "cm-preview-bold");
    expect(bold).toBeDefined();
    expect(bold!.from).toBe(2);
    expect(bold!.to).toBe(6);
    view.destroy();
  });

  it("hides * markers and applies italic class", () => {
    const doc = "*italic* text\n\nother";
    const view = makeView(doc, doc.length - 1);
    const decos = collectDecos(view);
    const replaces = decos.filter((d) => d.type === "replace");
    expect(replaces.some((d) => d.from === 0 && d.to === 1)).toBe(true);
    expect(replaces.some((d) => d.from === 7 && d.to === 8)).toBe(true);
    const italic = decos.find((d) => d.class === "cm-preview-italic");
    expect(italic).toBeDefined();
    expect(italic!.from).toBe(1);
    expect(italic!.to).toBe(7);
    view.destroy();
  });

  it("does not hide markers when cursor is inside element", () => {
    const view = makeView("**bold** text", 3); // cursor within bold
    const decos = collectDecos(view);
    expect(decos).toHaveLength(0);
    view.destroy();
  });

  it("keeps decorations on other elements when cursor is on same line", () => {
    const doc = "**bold** and *italic*";
    const view = makeView(doc, 3); // cursor inside bold, not italic
    const decos = collectDecos(view);
    // bold markers should be raw (cursor inside bold)
    const boldMark = decos.find((d) => d.class === "cm-preview-bold");
    expect(boldMark).toBeUndefined();
    // italic should still be decorated (cursor not inside italic)
    const italic = decos.find((d) => d.class === "cm-preview-italic");
    expect(italic).toBeDefined();
    view.destroy();
  });

  it("handles nested bold and italic", () => {
    const doc = "**bold *and italic***\n\nother";
    const view = makeView(doc, doc.length - 1);
    const decos = collectDecos(view);
    const bold = decos.find((d) => d.class === "cm-preview-bold");
    expect(bold).toBeDefined();
    const italic = decos.find((d) => d.class === "cm-preview-italic");
    expect(italic).toBeDefined();
    view.destroy();
  });
});

describe("buildDecorations — links", () => {
  it("hides brackets and URL, marks link text", () => {
    const doc = "[Click me](https://example.com)\n\nother";
    const view = makeView(doc, doc.length - 1);
    const decos = collectDecos(view);
    // "[" at [0,1] hidden
    expect(decos.some((d) => d.type === "replace" && d.from === 0 && d.to === 1)).toBe(true);
    // "](https://example.com)" at [9,31] hidden
    expect(decos.some((d) => d.type === "replace" && d.from === 9 && d.to === 31)).toBe(true);
    // "Click me" at [1,9] gets link mark
    const link = decos.find((d) => d.class === "cm-preview-link");
    expect(link).toBeDefined();
    expect(link!.from).toBe(1);
    expect(link!.to).toBe(9);
    expect(link!.url).toBe("https://example.com");
    view.destroy();
  });

  it("reveals full syntax when cursor is inside link", () => {
    const view = makeView("[Click me](https://example.com)", 5);
    const decos = collectDecos(view);
    expect(decos).toHaveLength(0);
    view.destroy();
  });
});

describe("buildDecorations — images", () => {
  it("replaces entire image with ImageWidget when cursor elsewhere", () => {
    const doc = "![alt text](img.png)\n\nother";
    const view = makeView(doc, doc.length - 1);
    const decos = collectDecos(view);
    const img = decos.find((d) => d.widget);
    expect(img).toBeDefined();
    expect(img!.from).toBe(0);
    expect(img!.to).toBe(20);
    view.destroy();
  });

  it("shows raw syntax when cursor is inside image", () => {
    const view = makeView("![alt text](img.png)", 5);
    const decos = collectDecos(view);
    expect(decos).toHaveLength(0);
    view.destroy();
  });
});

describe("buildDecorations — fenced code blocks", () => {
  it("hides fences and marks code content when cursor elsewhere", () => {
    const doc = "```js\ncode\n```\n\nother";
    const view = makeView(doc, doc.length - 1); // cursor on "other"
    const decos = collectDecos(view);
    // Opening fence hidden (includes "```js\n")
    const openReplace = decos.find((d) => d.type === "replace" && d.from === 0);
    expect(openReplace).toBeDefined();
    // Closing fence hidden
    const closeReplace = decos.find((d) => d.type === "replace" && d.to === 14);
    expect(closeReplace).toBeDefined();
    // Code content lines marked
    const codeMark = decos.find((d) => d.class === "cm-preview-code-block");
    expect(codeMark).toBeDefined();
    expect(codeMark!.from).toBe(6);
    expect(codeMark!.to).toBe(6);
    view.destroy();
  });

  it("shows fences when cursor is inside code block", () => {
    const view = makeView("```js\ncode\n```", 7); // cursor on "code"
    const decos = collectDecos(view);
    expect(decos).toHaveLength(0);
    view.destroy();
  });

  it("shows fences when cursor is on fence line", () => {
    const view = makeView("```js\ncode\n```", 1); // cursor on opening fence
    const decos = collectDecos(view);
    expect(decos).toHaveLength(0);
    view.destroy();
  });
});

describe("buildDecorations — wikilinks", () => {
  it("hides [[ and ]] and applies wikilink class when cursor elsewhere", () => {
    const doc = "[[Page Name]]\n\nother";
    const view = makeView(doc, doc.length - 1);
    const decos = collectDecos(view);
    // [[ hidden
    expect(decos.some((d) => d.type === "replace" && d.from === 0 && d.to === 2)).toBe(true);
    // ]] hidden
    expect(decos.some((d) => d.type === "replace" && d.from === 11 && d.to === 13)).toBe(true);
    // "Page Name" gets wikilink class
    const wl = decos.find((d) => d.class === "cm-preview-wikilink");
    expect(wl).toBeDefined();
    expect(wl!.from).toBe(2);
    expect(wl!.to).toBe(11);
    view.destroy();
  });

  it("shows only display text for [[Page|Display]]", () => {
    const doc = "[[Page|Display]]\n\nother";
    const view = makeView(doc, doc.length - 1);
    const decos = collectDecos(view);
    // Everything from [[ through | hidden
    expect(decos.some((d) => d.type === "replace" && d.from === 0 && d.to === 7)).toBe(true);
    // ]] hidden
    expect(decos.some((d) => d.type === "replace" && d.from === 14 && d.to === 16)).toBe(true);
    // "Display" gets wikilink class
    const wl = decos.find((d) => d.class === "cm-preview-wikilink");
    expect(wl).toBeDefined();
    expect(wl!.from).toBe(7);
    expect(wl!.to).toBe(14);
    view.destroy();
  });

  it("shows raw syntax when cursor is inside wikilink", () => {
    const view = makeView("[[Page Name]]", 5);
    const decos = collectDecos(view);
    const wlDecos = decos.filter(
      (d) => d.class === "cm-preview-wikilink" || (d.type === "replace" && d.from <= 13),
    );
    expect(wlDecos).toHaveLength(0);
    view.destroy();
  });

  it("keeps other wikilinks decorated when cursor is inside one", () => {
    const doc = "[[Alpha]] and [[Beta]]";
    // cursor inside [[Alpha]] (pos 3), [[Beta]] should stay decorated
    const view = makeView(doc, 3);
    const decos = collectDecos(view);
    const wlDecos = decos.filter((d) => d.class === "cm-preview-wikilink");
    expect(wlDecos).toHaveLength(1);
    expect(wlDecos[0]!.from).toBe(16);
    expect(wlDecos[0]!.to).toBe(20);
    view.destroy();
  });
});

describe("buildDecorations — callouts", () => {
  it("replaces callout header with widget when cursor elsewhere", () => {
    const doc = "> [!note]\n> Content\n\nother";
    const view = makeView(doc, doc.length - 1);
    const decos = collectDecos(view);
    const headerWidget = decos.find((d) => d.widget && d.from === 0);
    expect(headerWidget).toBeDefined();
    view.destroy();
  });

  it("applies line decoration with callout class", () => {
    const doc = "> [!note]\n> Content\n\nother";
    const view = makeView(doc, doc.length - 1);
    const decos = collectDecos(view);
    const lineDeco = decos.find((d) => d.class?.includes("cm-callout-note"));
    expect(lineDeco).toBeDefined();
    view.destroy();
  });

  it("does not decorate regular blockquotes as callouts", () => {
    const doc = "> Normal quote\n\nother";
    const view = makeView(doc, doc.length - 1);
    const decos = collectDecos(view);
    const calloutDecos = decos.filter((d) => d.class?.includes("cm-callout"));
    expect(calloutDecos).toHaveLength(0);
    view.destroy();
  });

  it("keeps callout line decorations when cursor is on header", () => {
    const view = makeView("> [!note]\n> Content", 5);
    const decos = collectDecos(view);
    const lineDecos = decos.filter((d) => d.class?.includes("cm-callout"));
    expect(lineDecos.length).toBeGreaterThanOrEqual(2);
    const headerWidget = decos.find((d) => d.widget && d.from === 0);
    expect(headerWidget).toBeUndefined();
    view.destroy();
  });

  it("shows raw header syntax only when cursor is on header line", () => {
    const doc = "> [!note]\n> Content\n\nother";
    const view = makeView(doc, doc.length - 1);
    const decos = collectDecos(view);
    const headerWidget = decos.find((d) => d.widget && d.from === 0);
    expect(headerWidget).toBeDefined();
    view.destroy();
  });

  it("always hides quote marks on body lines regardless of cursor position", () => {
    const doc = "> [!note]\n> Line one\n> Line two";
    // cursor on "> Line one" (position 12, inside "Line one")
    const view = makeView(doc, 12);
    const decos = collectDecos(view);
    // Line decorations should be present for all lines
    const lineDecos = decos.filter((d) => d.class?.includes("cm-callout"));
    expect(lineDecos.length).toBeGreaterThanOrEqual(3);
    // Header widget should be present (cursor is not on header)
    const headerWidget = decos.find((d) => d.widget && d.from === 0);
    expect(headerWidget).toBeDefined();
    // Quote marks on BOTH body lines should be replaced (no per-line toggle)
    const line2 = view.state.doc.line(2);
    const line2Replace = decos.find(
      (d) => d.type === "replace" && !d.widget && d.from === line2.from,
    );
    expect(line2Replace).toBeDefined();
    const line3 = view.state.doc.line(3);
    const line3Replace = decos.find(
      (d) => d.type === "replace" && !d.widget && d.from === line3.from,
    );
    expect(line3Replace).toBeDefined();
    view.destroy();
  });
});

describe("buildDecorations — math inside callouts", () => {
  it("renders inline math inside callout body", () => {
    const doc = "> [!tip] FFT\n> The DFT is $O(N^2)$.\n\nother";
    const view = makeView(doc, doc.length - 1);
    const decos = collectDecos(view);
    const mathWidget = decos.find((d) => d.widget && d.from > 13);
    expect(mathWidget).toBeDefined();
    view.destroy();
  });
});

describe("buildDecorations — inline code", () => {
  it("hides backtick markers and applies code class", () => {
    const doc = "`code` text\n\nother";
    const view = makeView(doc, doc.length - 1);
    const decos = collectDecos(view);
    const replaces = decos.filter((d) => d.type === "replace");
    expect(replaces.some((d) => d.from === 0 && d.to === 1)).toBe(true);
    expect(replaces.some((d) => d.from === 5 && d.to === 6)).toBe(true);
    const code = decos.find((d) => d.class === "cm-preview-code-inline");
    expect(code).toBeDefined();
    expect(code!.from).toBe(1);
    expect(code!.to).toBe(5);
    view.destroy();
  });

  it("does not hide backticks when cursor is inside inline code", () => {
    const view = makeView("`code` text", 3);
    const decos = collectDecos(view);
    const codeDecos = decos.filter(
      (d) => d.class === "cm-preview-code-inline" || (d.type === "replace" && d.from <= 6),
    );
    expect(codeDecos).toHaveLength(0);
    view.destroy();
  });

  it("keeps other inline code decorated when cursor is inside one", () => {
    const doc = "`alpha` and `beta`";
    const view = makeView(doc, 3); // cursor inside `alpha`
    const decos = collectDecos(view);
    const codeDecos = decos.filter((d) => d.class === "cm-preview-code-inline");
    expect(codeDecos).toHaveLength(1);
    expect(codeDecos[0]!.from).toBe(13);
    expect(codeDecos[0]!.to).toBe(17);
    view.destroy();
  });
});

describe("buildDecorations — inline math", () => {
  it("replaces $...$ with InlineMathWidget when cursor elsewhere", () => {
    const doc = "$E=mc^2$\n\nother";
    const view = makeView(doc, doc.length - 1);
    const decos = collectDecos(view);
    const mathWidget = decos.find((d) => d.widget && d.from === 0 && d.to === 8);
    expect(mathWidget).toBeDefined();
    view.destroy();
  });

  it("shows raw $...$ when cursor is inside math", () => {
    const view = makeView("$E=mc^2$", 3);
    const decos = collectDecos(view);
    expect(decos).toHaveLength(0);
    view.destroy();
  });
});

describe("buildDecorations — display math", () => {
  it("replaces $$...$$ with DisplayMathWidget when cursor elsewhere", () => {
    const doc = "$$\nx^2\n$$\n\nother";
    const view = makeView(doc, doc.length - 1);
    const blockDecos = buildBlockReplacements(view.state);
    const result: DecoInfo[] = [];
    const iter = blockDecos.iter();
    while (iter.value) {
      const spec = iter.value.spec;
      result.push({ from: iter.from, to: iter.to, type: "replace", widget: !!spec.widget });
      iter.next();
    }
    const mathWidget = result.find((d) => d.widget && d.from === 0);
    expect(mathWidget).toBeDefined();
    view.destroy();
  });

  it("shows raw $$...$$ when cursor is on any line of block", () => {
    const view = makeView("$$\nx^2\n$$", 4);
    const blockDecos = buildBlockReplacements(view.state);
    const result: DecoInfo[] = [];
    const iter = blockDecos.iter();
    while (iter.value) {
      result.push({ from: iter.from, to: iter.to, type: "replace" });
      iter.next();
    }
    expect(result).toHaveLength(0);
    view.destroy();
  });
});

function collectBlockDecos(view: EditorView): DecoInfo[] {
  const blockDecos = buildBlockReplacements(view.state);
  const result: DecoInfo[] = [];
  const iter = blockDecos.iter();
  while (iter.value) {
    const spec = iter.value.spec;
    const info: DecoInfo = {
      from: iter.from,
      to: iter.to,
      type: spec.class ? "mark" : "replace",
    };
    if (spec.widget) info.widget = true;
    if (spec.class) info.class = spec.class;
    result.push(info);
    iter.next();
  }
  return result;
}

describe("buildBlockReplacements — tables", () => {
  it("replaces table with widget when cursor is outside", () => {
    const doc = "| a | b |\n| --- | --- |\n| 1 | 2 |\n\nother";
    const view = makeView(doc, doc.length - 1);
    const decos = collectBlockDecos(view);
    const tableWidget = decos.find((d) => d.widget && d.from === 0);
    expect(tableWidget).toBeDefined();
    expect(tableWidget!.to).toBe(33);
    view.destroy();
  });

  it("replaces table with widget when cursor is on a table line", () => {
    const doc = "| a | b |\n| --- | --- |\n| 1 | 2 |";
    const view = makeView(doc, 3);
    const decos = collectBlockDecos(view);
    const tableWidget = decos.find((d) => d.widget);
    expect(tableWidget).toBeDefined();
    view.destroy();
  });

  it("replaces table with widget when cursor is on delimiter row", () => {
    const doc = "| a | b |\n| --- | --- |\n| 1 | 2 |";
    const view = makeView(doc, 12);
    const decos = collectBlockDecos(view);
    const tableWidget = decos.find((d) => d.widget);
    expect(tableWidget).toBeDefined();
    view.destroy();
  });

  it("replaces table with widget when cursor is on body row", () => {
    const doc = "| a | b |\n| --- | --- |\n| 1 | 2 |";
    const view = makeView(doc, 25);
    const decos = collectBlockDecos(view);
    const tableWidget = decos.find((d) => d.widget);
    expect(tableWidget).toBeDefined();
    view.destroy();
  });

  it("renders widget for table at end of document when cursor before table", () => {
    const doc = "some text\n\n| a |\n| --- |\n| 1 |";
    const view = makeView(doc, 3);
    const decos = collectBlockDecos(view);
    const tableWidget = decos.find((d) => d.widget);
    expect(tableWidget).toBeDefined();
    view.destroy();
  });

  it("renders widgets for multiple tables", () => {
    const doc = "| a |\n| --- |\n| 1 |\n\n| b |\n| --- |\n| 2 |\n\nother";
    const view = makeView(doc, doc.length - 1);
    const decos = collectBlockDecos(view);
    const tableWidgets = decos.filter((d) => d.widget);
    expect(tableWidgets).toHaveLength(2);
    view.destroy();
  });

  it("table widget coexists with display math widget", () => {
    const doc = "| a |\n| --- |\n| 1 |\n\n$$\nx^2\n$$\n\nother";
    const view = makeView(doc, doc.length - 1);
    const decos = collectBlockDecos(view);
    const widgets = decos.filter((d) => d.widget);
    expect(widgets).toHaveLength(2);
    view.destroy();
  });
});

describe("buildBlockReplacements — mermaid", () => {
  it("replaces mermaid block with widget when cursor is outside", () => {
    const doc = "```mermaid\ngraph LR; A-->B\n```\n\nother";
    const view = makeView(doc, doc.length - 1);
    const decos = collectBlockDecos(view);
    const mermaidWidget = decos.find((d) => d.widget && d.from === 0);
    expect(mermaidWidget).toBeDefined();
    expect(mermaidWidget!.to).toBe(30);
    view.destroy();
  });

  it("shows raw source when cursor is inside the mermaid block", () => {
    const doc = "```mermaid\ngraph LR; A-->B\n```";
    const view = makeView(doc, 15);
    const decos = collectBlockDecos(view);
    const mermaidWidget = decos.find((d) => d.widget);
    expect(mermaidWidget).toBeUndefined();
    view.destroy();
  });

  it("shows raw source when cursor is on opening fence line", () => {
    const doc = "```mermaid\ngraph LR; A-->B\n```";
    const view = makeView(doc, 3);
    const decos = collectBlockDecos(view);
    const mermaidWidget = decos.find((d) => d.widget);
    expect(mermaidWidget).toBeUndefined();
    view.destroy();
  });

  it("shows raw source when cursor is on closing fence line", () => {
    const doc = "```mermaid\ngraph LR; A-->B\n```";
    const view = makeView(doc, 28);
    const decos = collectBlockDecos(view);
    const mermaidWidget = decos.find((d) => d.widget);
    expect(mermaidWidget).toBeUndefined();
    view.destroy();
  });

  it("does not replace non-mermaid fenced code blocks", () => {
    const doc = "```js\nconsole.log('hi')\n```\n\nother";
    const view = makeView(doc, doc.length - 1);
    const decos = collectBlockDecos(view);
    const widget = decos.find((d) => d.widget && d.from === 0);
    expect(widget).toBeUndefined();
    view.destroy();
  });

  it("mermaid widget coexists with table and math widgets", () => {
    const doc = "```mermaid\ngraph LR; A-->B\n```\n\n| a |\n| --- |\n| 1 |\n\n$$\nx^2\n$$\n\nother";
    const view = makeView(doc, doc.length - 1);
    const decos = collectBlockDecos(view);
    const widgets = decos.filter((d) => d.widget);
    expect(widgets).toHaveLength(3);
    view.destroy();
  });

  it("does not add fence decorations for mermaid blocks when cursor is outside", () => {
    const doc = "```mermaid\ngraph LR; A-->B\n```\n\nother";
    const view = makeView(doc, doc.length - 1);
    const decos = collectDecos(view);
    const fenceDecos = decos.filter(
      (d) => d.class === "cm-preview-code-block" || d.class === "cm-code-fence-top",
    );
    expect(fenceDecos).toHaveLength(0);
    view.destroy();
  });
});

describe("buildDecorations — inline comments", () => {
  it("marks %%hidden%% as faded when cursor is elsewhere", () => {
    const doc = "text %%hidden%% more\n\nother";
    const view = makeView(doc, doc.length - 1);
    const decos = collectDecos(view);
    const mark = decos.find((d) => d.type === "mark" && d.from === 5 && d.to === 15);
    expect(mark).toBeDefined();
    expect(mark!.class).toBe("cm-preview-comment");
    view.destroy();
  });

  it("shows raw source when cursor is on line", () => {
    const view = makeView("text %%hidden%% more", 8);
    const decos = collectDecos(view);
    const commentDecos = decos.filter((d) => d.from >= 5 && d.to <= 15);
    expect(commentDecos).toHaveLength(0);
    view.destroy();
  });

  it("works mid-line alongside other text", () => {
    const doc = "before %%comment%% after\n\nother";
    const view = makeView(doc, doc.length - 1);
    const decos = collectDecos(view);
    const mark = decos.find((d) => d.type === "mark" && d.from === 7 && d.to === 18);
    expect(mark).toBeDefined();
    expect(mark!.class).toBe("cm-preview-comment");
    view.destroy();
  });
});

describe("buildBlockReplacements — block comments", () => {
  it("marks multi-line block comment as faded when cursor is elsewhere", () => {
    const doc = "%%\nblock content\n%%\n\nother";
    const view = makeView(doc, doc.length - 1);
    const decos = collectBlockDecos(view);
    const bc = decos.find((d) => d.from === 0 && d.type === "mark");
    expect(bc).toBeDefined();
    expect(bc!.class).toBe("cm-preview-comment");
    view.destroy();
  });

  it("shows raw on cursor-on-opening-line", () => {
    const doc = "%%\nblock content\n%%";
    const view = makeView(doc, 1);
    const decos = collectBlockDecos(view);
    const bc = decos.find((d) => d.from === 0);
    expect(bc).toBeUndefined();
    view.destroy();
  });

  it("shows raw on cursor-on-content-line", () => {
    const doc = "%%\nblock content\n%%";
    const view = makeView(doc, 5);
    const decos = collectBlockDecos(view);
    const bc = decos.find((d) => d.from === 0);
    expect(bc).toBeUndefined();
    view.destroy();
  });

  it("shows raw on cursor-on-closing-line", () => {
    const doc = "%%\nblock content\n%%";
    const view = makeView(doc, 18);
    const decos = collectBlockDecos(view);
    const bc = decos.find((d) => d.from === 0);
    expect(bc).toBeUndefined();
    view.destroy();
  });

  it("single-line %%content%% at line start marked as faded by buildDecorations", () => {
    const doc = "%%single line%%\n\nother";
    const view = makeView(doc, doc.length - 1);
    const decos = collectDecos(view);
    const mark = decos.find((d) => d.type === "mark" && d.from === 0 && d.to === 15);
    expect(mark).toBeDefined();
    expect(mark!.class).toBe("cm-preview-comment");
    view.destroy();
  });

  it("coexists with other block widgets (math, table)", () => {
    const doc = "%%\ncomment\n%%\n\n| a |\n| --- |\n| 1 |\n\n$$\nx^2\n$$\n\nother";
    const view = makeView(doc, doc.length - 1);
    const decos = collectBlockDecos(view);
    expect(decos.length).toBeGreaterThanOrEqual(3);
    view.destroy();
  });
});
