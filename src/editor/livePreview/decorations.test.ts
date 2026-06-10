import { describe, it, expect, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { GFM } from "@lezer/markdown";
import { buildDecorations, buildBlockReplacements, filterContainedDecorations } from "./decorations";
import { WikiLink } from "../markdown/wikilink";
import { Math as MathExt } from "../markdown/math";
import { Comment as CommentExt } from "../markdown/comment";
import { Footnote } from "../markdown/footnote";
import { calloutFoldField } from "./callout";
import { mediaThumbnailsFacet } from "./mediaThumbnails";
import { Decoration } from "@codemirror/view";
import { ImageWidget, MermaidWidget } from "./widgets";

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
      markdown({ extensions: [GFM, WikiLink, MathExt, CommentExt, Footnote] }),
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
  style?: string;
};

function collectDecos(view: EditorView): DecoInfo[] {
  const { decorations: decoSet } = buildDecorations(view);
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
    if (spec.attributes?.style) info.style = spec.attributes.style;
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

describe("buildDecorations — inline elements inside headings", () => {
  it("renders link inside heading", () => {
    const doc = "## [Click](https://example.com)\n\nother";
    const view = makeView(doc, doc.length - 1);
    const decos = collectDecos(view);
    expect(decos.find((d) => d.class === "cm-preview-h2")).toBeDefined();
    expect(decos.find((d) => d.class === "cm-preview-link")).toBeDefined();
    expect(decos.some((d) => d.type === "replace" && d.from === 0 && d.to === 3)).toBe(true);
    view.destroy();
  });

  it("renders wikilink inside heading", () => {
    const doc = "## [[Page Name]]\n\nother";
    const view = makeView(doc, doc.length - 1);
    const decos = collectDecos(view);
    expect(decos.find((d) => d.class === "cm-preview-h2")).toBeDefined();
    const wl = decos.find((d) => d.class === "cm-preview-wikilink");
    expect(wl).toBeDefined();
    expect(decos.some((d) => d.type === "replace" && d.from === 3 && d.to === 5)).toBe(true);
    expect(decos.some((d) => d.type === "replace" && d.from === 14 && d.to === 16)).toBe(true);
    view.destroy();
  });

  it("renders aliased wikilink inside heading", () => {
    const doc = "## [[Page|Display]]\n\nother";
    const view = makeView(doc, doc.length - 1);
    const decos = collectDecos(view);
    expect(decos.find((d) => d.class === "cm-preview-h2")).toBeDefined();
    const wl = decos.find((d) => d.class === "cm-preview-wikilink");
    expect(wl).toBeDefined();
    expect(wl!.from).toBe(10);
    expect(wl!.to).toBe(17);
    view.destroy();
  });

  it("renders italic inside heading", () => {
    const doc = "## *italic text*\n\nother";
    const view = makeView(doc, doc.length - 1);
    const decos = collectDecos(view);
    expect(decos.find((d) => d.class === "cm-preview-h2")).toBeDefined();
    expect(decos.find((d) => d.class === "cm-preview-italic")).toBeDefined();
    expect(decos.some((d) => d.type === "replace" && d.from === 3 && d.to === 4)).toBe(true);
    expect(decos.some((d) => d.type === "replace" && d.from === 15 && d.to === 16)).toBe(true);
    view.destroy();
  });

  it("renders bold inside heading", () => {
    const doc = "## **bold text**\n\nother";
    const view = makeView(doc, doc.length - 1);
    const decos = collectDecos(view);
    expect(decos.find((d) => d.class === "cm-preview-h2")).toBeDefined();
    expect(decos.find((d) => d.class === "cm-preview-bold")).toBeDefined();
    view.destroy();
  });

  it("renders inline code inside heading", () => {
    const doc = "## `code`\n\nother";
    const view = makeView(doc, doc.length - 1);
    const decos = collectDecos(view);
    expect(decos.find((d) => d.class === "cm-preview-h2")).toBeDefined();
    expect(decos.find((d) => d.class === "cm-preview-code-inline")).toBeDefined();
    view.destroy();
  });

  it("renders inline math inside heading as widget", () => {
    const doc = "## $E=mc^2$\n\nother";
    const view = makeView(doc, doc.length - 1);
    const decos = collectDecos(view);
    expect(decos.some((d) => d.type === "replace" && d.from === 0 && d.to === 3)).toBe(true);
    const math = decos.find((d) => d.widget && d.from === 3);
    expect(math).toBeDefined();
    view.destroy();
  });

  it("renders image inside heading as widget", () => {
    const doc = "## ![alt](img.png)\n\nother";
    const view = makeView(doc, doc.length - 1);
    const decos = collectDecos(view);
    expect(decos.some((d) => d.type === "replace" && d.from === 0 && d.to === 3)).toBe(true);
    const img = decos.find((d) => d.widget && d.from === 3);
    expect(img).toBeDefined();
    view.destroy();
  });

  it("renders inline comment inside heading", () => {
    const doc = "## Title %%hidden%%\n\nother";
    const view = makeView(doc, doc.length - 1);
    const decos = collectDecos(view);
    expect(decos.find((d) => d.class === "cm-preview-h2")).toBeDefined();
    expect(decos.find((d) => d.class === "cm-preview-comment")).toBeDefined();
    view.destroy();
  });

  it("shows raw syntax when cursor is on heading line with inline elements", () => {
    const doc = "## [Click](https://example.com)\n\nother";
    const view = makeView(doc, 5);
    const decos = collectDecos(view);
    const headingOrInline = decos.filter(
      (d) => d.class?.startsWith("cm-preview-") || (d.type === "replace" && d.to <= 31),
    );
    expect(headingOrInline).toHaveLength(0);
    view.destroy();
  });

  it("renders multiple inline elements inside heading", () => {
    const doc = "## **bold** and `code` here\n\nother";
    const view = makeView(doc, doc.length - 1);
    const decos = collectDecos(view);
    expect(decos.find((d) => d.class === "cm-preview-h2")).toBeDefined();
    expect(decos.find((d) => d.class === "cm-preview-bold")).toBeDefined();
    expect(decos.find((d) => d.class === "cm-preview-code-inline")).toBeDefined();
    view.destroy();
  });

  it("renders nested link inside italic inside heading", () => {
    const doc = "## *[text](url)*\n\nother";
    const view = makeView(doc, doc.length - 1);
    const decos = collectDecos(view);
    expect(decos.find((d) => d.class === "cm-preview-h2")).toBeDefined();
    expect(decos.find((d) => d.class === "cm-preview-italic")).toBeDefined();
    expect(decos.find((d) => d.class === "cm-preview-link")).toBeDefined();
    view.destroy();
  });

  it("renders inline elements across all heading levels", () => {
    const doc = "# [[Page]]\n\n### `code`\n\n###### *italic*\n\nother";
    const view = makeView(doc, doc.length - 1);
    const decos = collectDecos(view);
    expect(decos.find((d) => d.class === "cm-preview-h1")).toBeDefined();
    expect(decos.find((d) => d.class === "cm-preview-wikilink")).toBeDefined();
    expect(decos.find((d) => d.class === "cm-preview-h3")).toBeDefined();
    expect(decos.find((d) => d.class === "cm-preview-code-inline")).toBeDefined();
    expect(decos.find((d) => d.class === "cm-preview-h6")).toBeDefined();
    expect(decos.find((d) => d.class === "cm-preview-italic")).toBeDefined();
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

  it("decorates wikilink inside italic", () => {
    // *[[Page]]* → italic class + wikilink brackets hidden + wikilink class
    const doc = "*[[Page]]*\n\nother";
    const view = makeView(doc, doc.length - 1);
    const decos = collectDecos(view);
    // * markers hidden at 0-1 and 9-10
    expect(decos.some((d) => d.type === "replace" && d.from === 0 && d.to === 1)).toBe(true);
    expect(decos.some((d) => d.type === "replace" && d.from === 9 && d.to === 10)).toBe(true);
    // italic class on content
    expect(decos.find((d) => d.class === "cm-preview-italic")).toBeDefined();
    // [[ hidden at 1-3, ]] hidden at 7-9
    expect(decos.some((d) => d.type === "replace" && d.from === 1 && d.to === 3)).toBe(true);
    expect(decos.some((d) => d.type === "replace" && d.from === 7 && d.to === 9)).toBe(true);
    // wikilink class on "Page"
    const wl = decos.find((d) => d.class === "cm-preview-wikilink");
    expect(wl).toBeDefined();
    expect(wl!.from).toBe(3);
    expect(wl!.to).toBe(7);
    view.destroy();
  });

  it("decorates wikilink inside bold", () => {
    const doc = "**[[Page]]**\n\nother";
    const view = makeView(doc, doc.length - 1);
    const decos = collectDecos(view);
    // ** markers hidden
    expect(decos.some((d) => d.type === "replace" && d.from === 0 && d.to === 2)).toBe(true);
    expect(decos.some((d) => d.type === "replace" && d.from === 10 && d.to === 12)).toBe(true);
    expect(decos.find((d) => d.class === "cm-preview-bold")).toBeDefined();
    // [[ hidden at 2-4, ]] hidden at 8-10
    expect(decos.some((d) => d.type === "replace" && d.from === 2 && d.to === 4)).toBe(true);
    expect(decos.some((d) => d.type === "replace" && d.from === 8 && d.to === 10)).toBe(true);
    const wl = decos.find((d) => d.class === "cm-preview-wikilink");
    expect(wl).toBeDefined();
    expect(wl!.from).toBe(4);
    expect(wl!.to).toBe(8);
    view.destroy();
  });

  it("decorates aliased wikilink inside italic", () => {
    // *[[Page|Alias]]* → hides *,[[Page|,]] and styles "Alias"
    const doc = "*[[Page|Alias]]*\n\nother";
    const view = makeView(doc, doc.length - 1);
    const decos = collectDecos(view);
    // * markers hidden
    expect(decos.some((d) => d.type === "replace" && d.from === 0 && d.to === 1)).toBe(true);
    expect(decos.some((d) => d.type === "replace" && d.from === 15 && d.to === 16)).toBe(true);
    expect(decos.find((d) => d.class === "cm-preview-italic")).toBeDefined();
    // [[Page| hidden (1 to 8)
    expect(decos.some((d) => d.type === "replace" && d.from === 1 && d.to === 8)).toBe(true);
    // ]] hidden (13 to 15)
    expect(decos.some((d) => d.type === "replace" && d.from === 13 && d.to === 15)).toBe(true);
    const wl = decos.find((d) => d.class === "cm-preview-wikilink");
    expect(wl).toBeDefined();
    expect(wl!.from).toBe(8);
    expect(wl!.to).toBe(13);
    view.destroy();
  });

  it("decorates link inside italic", () => {
    // *[text](url)* → italic + link decos
    const doc = "*[text](url)*\n\nother";
    const view = makeView(doc, doc.length - 1);
    const decos = collectDecos(view);
    // * markers hidden
    expect(decos.some((d) => d.type === "replace" && d.from === 0 && d.to === 1)).toBe(true);
    expect(decos.some((d) => d.type === "replace" && d.from === 12 && d.to === 13)).toBe(true);
    expect(decos.find((d) => d.class === "cm-preview-italic")).toBeDefined();
    const link = decos.find((d) => d.class === "cm-preview-link");
    expect(link).toBeDefined();
    view.destroy();
  });

  it("decorates link inside bold", () => {
    const doc = "**[text](url)**\n\nother";
    const view = makeView(doc, doc.length - 1);
    const decos = collectDecos(view);
    expect(decos.find((d) => d.class === "cm-preview-bold")).toBeDefined();
    expect(decos.find((d) => d.class === "cm-preview-link")).toBeDefined();
    view.destroy();
  });

  it("decorates inline code inside italic", () => {
    const doc = "*`code`*\n\nother";
    const view = makeView(doc, doc.length - 1);
    const decos = collectDecos(view);
    // * markers hidden
    expect(decos.some((d) => d.type === "replace" && d.from === 0 && d.to === 1)).toBe(true);
    expect(decos.some((d) => d.type === "replace" && d.from === 7 && d.to === 8)).toBe(true);
    expect(decos.find((d) => d.class === "cm-preview-italic")).toBeDefined();
    expect(decos.find((d) => d.class === "cm-preview-code-inline")).toBeDefined();
    view.destroy();
  });

  it("decorates inline code inside bold", () => {
    const doc = "**`code`**\n\nother";
    const view = makeView(doc, doc.length - 1);
    const decos = collectDecos(view);
    expect(decos.find((d) => d.class === "cm-preview-bold")).toBeDefined();
    expect(decos.find((d) => d.class === "cm-preview-code-inline")).toBeDefined();
    view.destroy();
  });

  it("decorates inline math inside italic", () => {
    // *$E=mc^2$* → emphasis marks hidden, math widget replaces $...$
    const doc = "*$E=mc^2$*\n\nother";
    const view = makeView(doc, doc.length - 1);
    const decos = collectDecos(view);
    // * markers hidden
    expect(decos.some((d) => d.type === "replace" && d.from === 0 && d.to === 1)).toBe(true);
    expect(decos.some((d) => d.type === "replace" && d.from === 9 && d.to === 10)).toBe(true);
    // math widget replaces $E=mc^2$
    const math = decos.find((d) => d.widget && d.from === 1 && d.to === 9);
    expect(math).toBeDefined();
    view.destroy();
  });

  it("decorates inline math inside bold", () => {
    const doc = "**$E=mc^2$**\n\nother";
    const view = makeView(doc, doc.length - 1);
    const decos = collectDecos(view);
    expect(decos.some((d) => d.type === "replace" && d.from === 0 && d.to === 2)).toBe(true);
    expect(decos.some((d) => d.type === "replace" && d.from === 10 && d.to === 12)).toBe(true);
    const math = decos.find((d) => d.widget && d.from === 2 && d.to === 10);
    expect(math).toBeDefined();
    view.destroy();
  });

  it("shows raw syntax when cursor is inside emphasis containing wikilink", () => {
    const view = makeView("*[[Page]]*", 5);
    const decos = collectDecos(view);
    expect(decos).toHaveLength(0);
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

  it("keeps line classes but shows fences when cursor is inside code block", () => {
    const view = makeView("```js\ncode\n```", 7); // cursor on "code"
    const decos = collectDecos(view);
    const replaces = decos.filter((d) => d.type === "replace");
    expect(replaces).toHaveLength(0);
    expect(decos.some((d) => d.class === "cm-code-fence-top")).toBe(true);
    expect(decos.some((d) => d.class === "cm-code-fence-bottom")).toBe(true);
    expect(decos.some((d) => d.class === "cm-preview-code-block")).toBe(true);
    view.destroy();
  });

  it("keeps line classes but shows fences when cursor is on fence line", () => {
    const view = makeView("```js\ncode\n```", 1); // cursor on opening fence
    const decos = collectDecos(view);
    const replaces = decos.filter((d) => d.type === "replace");
    expect(replaces).toHaveLength(0);
    expect(decos.some((d) => d.class === "cm-code-fence-top")).toBe(true);
    expect(decos.some((d) => d.class === "cm-code-fence-bottom")).toBe(true);
    expect(decos.some((d) => d.class === "cm-preview-code-block")).toBe(true);
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

  it("keeps code mark but shows backticks when cursor is inside inline code", () => {
    const view = makeView("`code` text", 3);
    const decos = collectDecos(view);
    const replaces = decos.filter((d) => d.type === "replace" && d.from <= 6);
    expect(replaces).toHaveLength(0);
    const code = decos.find((d) => d.class === "cm-preview-code-inline");
    expect(code).toBeDefined();
    expect(code!.from).toBe(1);
    expect(code!.to).toBe(5);
    view.destroy();
  });

  it("keeps other inline code decorated when cursor is inside one", () => {
    const doc = "`alpha` and `beta`";
    const view = makeView(doc, 3); // cursor inside `alpha`
    const decos = collectDecos(view);
    const codeDecos = decos.filter((d) => d.class === "cm-preview-code-inline");
    expect(codeDecos).toHaveLength(2);
    expect(codeDecos[0]!.from).toBe(1);
    expect(codeDecos[0]!.to).toBe(6);
    expect(codeDecos[1]!.from).toBe(13);
    expect(codeDecos[1]!.to).toBe(17);
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
    const blockState = buildBlockReplacements(view.state);
    const result: DecoInfo[] = [];
    const iter = blockState.decos.iter();
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
    const blockState = buildBlockReplacements(view.state);
    const result: DecoInfo[] = [];
    const iter = blockState.decos.iter();
    while (iter.value) {
      result.push({ from: iter.from, to: iter.to, type: "replace" });
      iter.next();
    }
    expect(result).toHaveLength(0);
    view.destroy();
  });

  it("replaces same-line $$...$$ {#eq:label} with widget, leaving label outside", () => {
    const doc = "$$E=mc^2$$ {#eq:einstein}\n\nother";
    const view = makeView(doc, doc.length - 1);
    const decos = collectDecos(view);
    const mathWidget = decos.find((d) => d.widget && d.from === 0);
    expect(mathWidget).toBeDefined();
    // Widget should only cover $$E=mc^2$$ (positions 0-10), not the label
    expect(mathWidget!.to).toBe(10);
    view.destroy();
  });

  it("shows raw same-line $$...$$ {#eq:label} when cursor is on that line", () => {
    const doc = "$$E=mc^2$$ {#eq:einstein}\n\nother";
    const view = makeView(doc, 5); // cursor inside the math
    const decos = collectDecos(view);
    const mathWidget = decos.find((d) => d.widget && d.from === 0);
    expect(mathWidget).toBeUndefined();
    view.destroy();
  });

  it("replaces multi-line $$...$$ {#eq:label} on closing line with widget", () => {
    const doc = "$$\nx^2\n$$ {#eq:test}\n\nother";
    const view = makeView(doc, doc.length - 1);
    const blockState = buildBlockReplacements(view.state);
    const result: DecoInfo[] = [];
    const iter = blockState.decos.iter();
    while (iter.value) {
      const spec = iter.value.spec;
      result.push({ from: iter.from, to: iter.to, type: "replace", widget: !!spec.widget });
      iter.next();
    }
    const mathWidget = result.find((d) => d.widget && d.from === 0);
    expect(mathWidget).toBeDefined();
    // Widget covers from opening $$ to closing $$ only (pos 0 to 7+2=9)
    expect(mathWidget!.to).toBe(9);
    view.destroy();
  });
});

function collectBlockDecos(view: EditorView): DecoInfo[] {
  const blockState = buildBlockReplacements(view.state);
  const result: DecoInfo[] = [];
  const iter = blockState.decos.iter();
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

describe("buildDecorations — horizontal rules", () => {
  it("replaces --- with HorizontalRuleWidget when cursor is elsewhere", () => {
    const doc = "text\n\n---\n\nother";
    const view = makeView(doc, doc.length - 1);
    const decos = collectDecos(view);
    const hr = decos.find((d) => d.widget && d.from === 6 && d.to === 9);
    expect(hr).toBeDefined();
    view.destroy();
  });

  it("shows raw --- when cursor is on the line", () => {
    const doc = "text\n\n---\n\nother";
    const view = makeView(doc, 7);
    const decos = collectDecos(view);
    const hr = decos.find((d) => d.widget && d.from === 6);
    expect(hr).toBeUndefined();
    view.destroy();
  });

  it("replaces *** variant with widget", () => {
    const doc = "text\n\n***\n\nother";
    const view = makeView(doc, doc.length - 1);
    const decos = collectDecos(view);
    const hr = decos.find((d) => d.widget && d.from === 6 && d.to === 9);
    expect(hr).toBeDefined();
    view.destroy();
  });

  it("replaces ___ variant with widget", () => {
    const doc = "text\n\n___\n\nother";
    const view = makeView(doc, doc.length - 1);
    const decos = collectDecos(view);
    const hr = decos.find((d) => d.widget && d.from === 6 && d.to === 9);
    expect(hr).toBeDefined();
    view.destroy();
  });

  it("decorates multiple HRs in one document", () => {
    const doc = "text\n\n---\n\nmiddle\n\n***\n\nother";
    const view = makeView(doc, doc.length - 1);
    const decos = collectDecos(view);
    const hrs = decos.filter((d) => d.widget);
    expect(hrs).toHaveLength(2);
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

function makeViewWithFacet(doc: string, cursor: number, thumbnail: boolean): EditorView {
  const state = EditorState.create({
    doc,
    selection: { anchor: cursor },
    extensions: [
      markdown({ extensions: [GFM, WikiLink, MathExt, CommentExt] }),
      calloutFoldField,
      mediaThumbnailsFacet.of(thumbnail),
    ],
  });
  return new EditorView({ state, parent: document.createElement("div") });
}

describe("buildDecorations — image thumbnail facet", () => {
  it("creates ImageWidget with thumbnail=true when facet is true", () => {
    const doc = "![alt](img.png)\n\nother";
    const view = makeViewWithFacet(doc, doc.length - 1, true);
    const { decorations: decoSet } = buildDecorations(view);
    const iter = decoSet.iter();
    let found = false;
    while (iter.value) {
      if (iter.value.spec.widget instanceof ImageWidget) {
        expect(iter.value.spec.widget.thumbnail).toBe(true);
        found = true;
      }
      iter.next();
    }
    expect(found).toBe(true);
    view.destroy();
  });

  it("creates ImageWidget with thumbnail=false when facet is false", () => {
    const doc = "![alt](img.png)\n\nother";
    const view = makeViewWithFacet(doc, doc.length - 1, false);
    const { decorations: decoSet } = buildDecorations(view);
    const iter = decoSet.iter();
    let found = false;
    while (iter.value) {
      if (iter.value.spec.widget instanceof ImageWidget) {
        expect(iter.value.spec.widget.thumbnail).toBe(false);
        found = true;
      }
      iter.next();
    }
    expect(found).toBe(true);
    view.destroy();
  });
});

describe("buildBlockReplacements — mermaid thumbnail facet", () => {
  it("creates MermaidWidget with thumbnail=true when facet is true", () => {
    const doc = "```mermaid\ngraph LR; A-->B\n```\n\nother";
    const view = makeViewWithFacet(doc, doc.length - 1, true);
    const blockState = buildBlockReplacements(view.state);
    const iter = blockState.decos.iter();
    let found = false;
    while (iter.value) {
      if (iter.value.spec.widget instanceof MermaidWidget) {
        expect(iter.value.spec.widget.thumbnail).toBe(true);
        found = true;
      }
      iter.next();
    }
    expect(found).toBe(true);
    view.destroy();
  });

  it("creates MermaidWidget with thumbnail=false when facet is false", () => {
    const doc = "```mermaid\ngraph LR; A-->B\n```\n\nother";
    const view = makeViewWithFacet(doc, doc.length - 1, false);
    const blockState = buildBlockReplacements(view.state);
    const iter = blockState.decos.iter();
    let found = false;
    while (iter.value) {
      if (iter.value.spec.widget instanceof MermaidWidget) {
        expect(iter.value.spec.widget.thumbnail).toBe(false);
        found = true;
      }
      iter.next();
    }
    expect(found).toBe(true);
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

describe("buildDecorations — strikethrough", () => {
  it("hides ~~ markers and applies strikethrough class", () => {
    const doc = "~~deleted~~ text\n\nother";
    const view = makeView(doc, doc.length - 1);
    const decos = collectDecos(view);
    const replaces = decos.filter((d) => d.type === "replace");
    expect(replaces.some((d) => d.from === 0 && d.to === 2)).toBe(true);
    expect(replaces.some((d) => d.from === 9 && d.to === 11)).toBe(true);
    const strike = decos.find((d) => d.class === "cm-preview-strikethrough");
    expect(strike).toBeDefined();
    expect(strike!.from).toBe(2);
    expect(strike!.to).toBe(9);
    view.destroy();
  });

  it("does not decorate when cursor is inside strikethrough", () => {
    const view = makeView("~~deleted~~ text", 5);
    const decos = collectDecos(view);
    const strikeDecos = decos.filter(
      (d) => d.class === "cm-preview-strikethrough" || (d.type === "replace" && d.from <= 11),
    );
    expect(strikeDecos).toHaveLength(0);
    view.destroy();
  });

  it("keeps decorations on other strikethrough when cursor is in one", () => {
    const doc = "~~alpha~~ and ~~beta~~";
    const view = makeView(doc, 3); // cursor inside ~~alpha~~
    const decos = collectDecos(view);
    const strikes = decos.filter((d) => d.class === "cm-preview-strikethrough");
    expect(strikes).toHaveLength(1);
    expect(strikes[0]!.from).toBe(16);
    expect(strikes[0]!.to).toBe(20);
    view.destroy();
  });

  it("coexists with bold on same line", () => {
    const doc = "**bold** and ~~deleted~~\n\nother";
    const view = makeView(doc, doc.length - 1);
    const decos = collectDecos(view);
    expect(decos.find((d) => d.class === "cm-preview-bold")).toBeDefined();
    expect(decos.find((d) => d.class === "cm-preview-strikethrough")).toBeDefined();
    view.destroy();
  });

  it("renders inside headings", () => {
    const doc = "## ~~deleted~~ title\n\nother";
    const view = makeView(doc, doc.length - 1);
    const decos = collectDecos(view);
    expect(decos.find((d) => d.class === "cm-preview-h2")).toBeDefined();
    expect(decos.find((d) => d.class === "cm-preview-strikethrough")).toBeDefined();
    view.destroy();
  });

  it("renders inside emphasis", () => {
    const doc = "*~~deleted~~*\n\nother";
    const view = makeView(doc, doc.length - 1);
    const decos = collectDecos(view);
    expect(decos.find((d) => d.class === "cm-preview-italic")).toBeDefined();
    expect(decos.find((d) => d.class === "cm-preview-strikethrough")).toBeDefined();
    view.destroy();
  });

  it("marks line as cursor-sensitive", () => {
    const doc = "plain\n~~deleted~~\nmore";
    const view = makeView(doc, 0);
    const { cursorSensitiveLines } = buildDecorations(view);
    expect(cursorSensitiveLines.has(2)).toBe(true);
    view.destroy();
  });
});

describe("buildDecorations — blockquotes", () => {
  it("applies line class and hides quote mark on regular blockquote", () => {
    const doc = "> Quoted text\n\nother";
    const view = makeView(doc, doc.length - 1);
    const decos = collectDecos(view);
    const lineDeco = decos.find((d) => d.class === "cm-blockquote");
    expect(lineDeco).toBeDefined();
    const quoteReplace = decos.find((d) => d.type === "replace" && d.from === 0 && d.to === 2);
    expect(quoteReplace).toBeDefined();
    view.destroy();
  });

  it("does not decorate when cursor is on blockquote line", () => {
    const doc = "> Quoted text\n\nother";
    const view = makeView(doc, 5);
    const decos = collectDecos(view);
    const bqDecos = decos.filter((d) => d.class === "cm-blockquote");
    expect(bqDecos).toHaveLength(0);
    view.destroy();
  });

  it("decorates all lines in multi-line blockquote", () => {
    const doc = "> Line one\n> Line two\n> Line three\n\nother";
    const view = makeView(doc, doc.length - 1);
    const decos = collectDecos(view);
    const lineDecos = decos.filter((d) => d.class === "cm-blockquote");
    expect(lineDecos).toHaveLength(3);
    const replaces = decos.filter((d) => d.type === "replace" && !d.widget);
    expect(replaces).toHaveLength(3);
    view.destroy();
  });

  it("suppresses all decorations when cursor is on any line of multi-line blockquote", () => {
    const doc = "> Line one\n> Line two\n> Line three\n\nother";
    const view = makeView(doc, 15); // cursor on line 2
    const decos = collectDecos(view);
    const bqDecos = decos.filter((d) => d.class === "cm-blockquote");
    expect(bqDecos).toHaveLength(0);
    view.destroy();
  });

  it("allows inline elements inside blockquote", () => {
    const doc = "> Some **bold** and *italic* text\n\nother";
    const view = makeView(doc, doc.length - 1);
    const decos = collectDecos(view);
    expect(decos.find((d) => d.class === "cm-blockquote")).toBeDefined();
    expect(decos.find((d) => d.class === "cm-preview-bold")).toBeDefined();
    expect(decos.find((d) => d.class === "cm-preview-italic")).toBeDefined();
    view.destroy();
  });

  it("does not apply callout classes to regular blockquotes (regression)", () => {
    const doc = "> Normal quote\n\nother";
    const view = makeView(doc, doc.length - 1);
    const decos = collectDecos(view);
    const calloutDecos = decos.filter((d) => d.class?.includes("cm-callout"));
    expect(calloutDecos).toHaveLength(0);
    view.destroy();
  });

  it("handles blockquote with empty continuation line", () => {
    const doc = "> First\n> \n> Third\n\nother";
    const view = makeView(doc, doc.length - 1);
    const decos = collectDecos(view);
    const lineDecos = decos.filter((d) => d.class === "cm-blockquote");
    expect(lineDecos).toHaveLength(3);
    view.destroy();
  });
});

describe("buildDecorations — strikethrough inside blockquote/callout", () => {
  it("renders strikethrough inside blockquote", () => {
    const doc = "> Some ~~deleted~~ text\n\nother";
    const view = makeView(doc, doc.length - 1);
    const decos = collectDecos(view);
    expect(decos.find((d) => d.class === "cm-blockquote")).toBeDefined();
    expect(decos.find((d) => d.class === "cm-preview-strikethrough")).toBeDefined();
    view.destroy();
  });

  it("renders strikethrough inside callout", () => {
    const doc = "> [!note]\n> Some ~~deleted~~ text\n\nother";
    const view = makeView(doc, doc.length - 1);
    const decos = collectDecos(view);
    expect(decos.find((d) => d.class?.includes("cm-callout"))).toBeDefined();
    expect(decos.find((d) => d.class === "cm-preview-strikethrough")).toBeDefined();
    view.destroy();
  });

  it("handles nested blockquotes", () => {
    const doc = "> Outer\n>> Inner\n\nother";
    const view = makeView(doc, doc.length - 1);
    const decos = collectDecos(view);
    const bqDecos = decos.filter((d) => d.class === "cm-blockquote");
    expect(bqDecos.length).toBeGreaterThanOrEqual(2);
    view.destroy();
  });
});

describe("buildDecorations — cursorSensitiveLines", () => {
  it("includes heading lines", () => {
    const doc = "plain\n## Heading\nmore";
    const view = makeView(doc, 0);
    const { cursorSensitiveLines } = buildDecorations(view);
    expect(cursorSensitiveLines.has(2)).toBe(true);
    view.destroy();
  });

  it("includes inline formatting lines", () => {
    const doc = "plain\n**bold**\nmore";
    const view = makeView(doc, 0);
    const { cursorSensitiveLines } = buildDecorations(view);
    expect(cursorSensitiveLines.has(2)).toBe(true);
    view.destroy();
  });

  it("excludes plain text lines", () => {
    const doc = "plain text\n## Heading";
    const view = makeView(doc, 0);
    const { cursorSensitiveLines } = buildDecorations(view);
    expect(cursorSensitiveLines.has(1)).toBe(false);
    expect(cursorSensitiveLines.has(2)).toBe(true);
    view.destroy();
  });
});

function widgetDeco(from: number, to: number): { from: number; to: number; deco: Decoration } {
  return { from, to, deco: Decoration.replace({ widget: new ImageWidget("", "", false) }) };
}

function markDeco(from: number, to: number): { from: number; to: number; deco: Decoration } {
  return { from, to, deco: Decoration.mark({ class: "test-mark" }) };
}

function replaceDeco(from: number, to: number): { from: number; to: number; deco: Decoration } {
  return { from, to, deco: Decoration.replace({}) };
}

function pointDeco(pos: number): { from: number; to: number; deco: Decoration } {
  return { from: pos, to: pos, deco: Decoration.replace({}) };
}

describe("filterContainedDecorations", () => {
  it("returns empty array for empty input", () => {
    expect(filterContainedDecorations([])).toEqual([]);
  });

  it("keeps all decos when no widget replacements exist", () => {
    const decos = [markDeco(0, 5), markDeco(10, 15), replaceDeco(20, 25)];
    expect(filterContainedDecorations(decos)).toEqual(decos);
  });

  it("keeps all decos when only widget replacements exist", () => {
    const decos = [widgetDeco(0, 10), widgetDeco(20, 30)];
    expect(filterContainedDecorations(decos)).toEqual(decos);
  });

  it("removes non-widget span fully inside widget range", () => {
    const decos = [markDeco(2, 8), widgetDeco(0, 10)];
    decos.sort((a, b) => a.from - b.from || a.to - b.to);
    const result = filterContainedDecorations(decos);
    expect(result).toHaveLength(1);
    expect(result[0]!.deco.spec.widget).toBeTruthy();
  });

  it("keeps non-widget span partially overlapping widget", () => {
    const decos = [markDeco(5, 15), widgetDeco(0, 10)];
    decos.sort((a, b) => a.from - b.from || a.to - b.to);
    const result = filterContainedDecorations(decos);
    expect(result).toHaveLength(2);
  });

  it("removes non-widget span with exact same bounds as widget", () => {
    const decos = [markDeco(0, 10), widgetDeco(0, 10)];
    decos.sort((a, b) => a.from - b.from || a.to - b.to);
    const result = filterContainedDecorations(decos);
    expect(result).toHaveLength(1);
    expect(result[0]!.deco.spec.widget).toBeTruthy();
  });

  it("keeps point deco inside widget range", () => {
    const decos = [widgetDeco(0, 10), pointDeco(5)];
    decos.sort((a, b) => a.from - b.from || a.to - b.to);
    const result = filterContainedDecorations(decos);
    expect(result).toHaveLength(2);
  });

  it("handles multiple widgets with contained and non-contained decos", () => {
    const decos = [
      widgetDeco(0, 5),
      markDeco(1, 4),
      markDeco(6, 8),
      widgetDeco(10, 20),
      markDeco(12, 18),
    ];
    decos.sort((a, b) => a.from - b.from || a.to - b.to);
    const result = filterContainedDecorations(decos);
    expect(result).toHaveLength(3);
    expect(result.map((d) => [d.from, d.to])).toEqual([[0, 5], [6, 8], [10, 20]]);
  });

  it("keeps span starting at wr.from but ending past wr.to", () => {
    const decos = [widgetDeco(0, 10), markDeco(0, 15)];
    decos.sort((a, b) => a.from - b.from || a.to - b.to);
    const result = filterContainedDecorations(decos);
    expect(result).toHaveLength(2);
  });

  it("keeps span starting before wr.from but ending at wr.to", () => {
    const decos = [markDeco(0, 10), widgetDeco(5, 10)];
    decos.sort((a, b) => a.from - b.from || a.to - b.to);
    const result = filterContainedDecorations(decos);
    expect(result).toHaveLength(2);
  });

  it("keeps deco spanning boundary of adjacent widgets", () => {
    const decos = [widgetDeco(0, 5), markDeco(4, 6), widgetDeco(5, 10)];
    decos.sort((a, b) => a.from - b.from || a.to - b.to);
    const result = filterContainedDecorations(decos);
    expect(result).toHaveLength(3);
  });

  it("handles **$E=mc^2$** pattern correctly", () => {
    // bold mark [2,10] should be removed (inside widget [2,10])
    // ** hides [0,2] and [10,12] should be kept (outside widget)
    // widget [2,10] should be kept
    const decos = [
      replaceDeco(0, 2),
      widgetDeco(2, 10),
      markDeco(2, 10),
      replaceDeco(10, 12),
    ];
    decos.sort((a, b) => a.from - b.from || a.to - b.to);
    const result = filterContainedDecorations(decos);
    expect(result).toHaveLength(3);
    expect(result.some((d) => d.from === 0 && d.to === 2)).toBe(true);
    expect(result.some((d) => d.deco.spec.widget && d.from === 2 && d.to === 10)).toBe(true);
    expect(result.some((d) => d.from === 10 && d.to === 12)).toBe(true);
  });

  it("handles large-range widget with contained deco in the middle", () => {
    const decos = [widgetDeco(10, 100), markDeco(50, 60)];
    decos.sort((a, b) => a.from - b.from || a.to - b.to);
    const result = filterContainedDecorations(decos);
    expect(result).toHaveLength(1);
    expect(result[0]!.deco.spec.widget).toBeTruthy();
  });

  it("preserves order in output", () => {
    const decos = [
      replaceDeco(0, 2),
      markDeco(3, 7),
      widgetDeco(10, 20),
      markDeco(25, 30),
    ];
    const result = filterContainedDecorations(decos);
    for (let i = 1; i < result.length; i++) {
      expect(result[i]!.from).toBeGreaterThanOrEqual(result[i - 1]!.from);
    }
  });

  it("integration: **![alt](img.png)** filters bold mark but keeps marker hides and widget", () => {
    const doc = "**![alt](img.png)**\n\nother";
    const view = makeView(doc, doc.length - 1);
    const decos = collectDecos(view);
    const imgWidget = decos.find((d) => d.widget && d.from === 2 && d.to === 17);
    expect(imgWidget).toBeDefined();
    const boldMark = decos.find((d) => d.class === "cm-preview-bold");
    expect(boldMark).toBeUndefined();
    const starHide1 = decos.find((d) => d.type === "replace" && !d.widget && d.from === 0 && d.to === 2);
    expect(starHide1).toBeDefined();
    const starHide2 = decos.find((d) => d.type === "replace" && !d.widget && d.from === 17 && d.to === 19);
    expect(starHide2).toBeDefined();
    view.destroy();
  });
});

describe("buildDecorations — list items", () => {
  it("applies cm-list-item to a single-line bullet list item", () => {
    const doc = "- Item\n\nother";
    const view = makeView(doc, doc.length - 1);
    const decos = collectDecos(view);
    const li = decos.find((d) => d.class === "cm-list-item");
    expect(li).toBeDefined();
    expect(li!.from).toBe(0);
    expect(li!.to).toBe(0); // line decoration: from === to
    expect(li!.style).toContain("--li-indent");
    view.destroy();
  });

  it("applies cm-list-item-continuation to continuation lines of a bullet list item", () => {
    const doc = "- First line\n  continuation\n\nother";
    const view = makeView(doc, doc.length - 1);
    const decos = collectDecos(view);
    const firstLine = decos.find((d) => d.class === "cm-list-item");
    expect(firstLine).toBeDefined();
    expect(firstLine!.from).toBe(0);
    expect(firstLine!.style).toContain("--li-indent");
    const contLine = decos.find((d) => d.class === "cm-list-item-continuation");
    expect(contLine).toBeDefined();
    // continuation is on line 2 (starts at position 13)
    expect(contLine!.from).toBe(13);
    expect(contLine!.to).toBe(13); // line decoration
    expect(contLine!.style).toContain("--li-indent");
    view.destroy();
  });

  it("handles ordered list with continuation lines", () => {
    const doc = "1. Item\n   continuation\n\nother";
    const view = makeView(doc, doc.length - 1);
    const decos = collectDecos(view);
    const firstLine = decos.find((d) => d.class === "cm-list-item");
    expect(firstLine).toBeDefined();
    expect(firstLine!.style).toContain("--li-indent");
    const contLine = decos.find((d) => d.class === "cm-list-item-continuation");
    expect(contLine).toBeDefined();
    expect(contLine!.style).toContain("--li-indent");
    view.destroy();
  });

  it("blockquote list item indent matches standalone list item", () => {
    // Standalone: "- Item\n\nother" — marker is "- " → 2 prefix chars
    const standaloneDoc = "- Item\n\nother";
    const standaloneView = makeView(standaloneDoc, standaloneDoc.length - 1);
    const standaloneDecos = collectDecos(standaloneView);
    const standaloneLi = standaloneDecos.find((d) => d.class === "cm-list-item");
    expect(standaloneLi).toBeDefined();
    const standaloneIndent = standaloneLi!.style;

    // Blockquote: "> - Item\n\nother" — marker is still "- " → should be same indent
    const bqDoc = "> - Item\n\nother";
    const bqView = makeView(bqDoc, bqDoc.length - 1); // cursor on "other", away from blockquote
    const bqDecos = collectDecos(bqView);
    const bqLi = bqDecos.find((d) => d.class === "cm-list-item");
    expect(bqLi).toBeDefined();
    const bqIndent = bqLi!.style;

    // Both use "- " as the marker, so --li-indent must be identical
    expect(bqIndent).toBe(standaloneIndent);

    standaloneView.destroy();
    bqView.destroy();
  });

  it("uses coordsAtPos when available for indent calculation", () => {
    const doc = "- Item\n\nother";
    const view = makeView(doc, doc.length - 1);

    // Spy on coordsAtPos to return mock pixel coordinates.
    // listMark.from = 0, markerEnd = 1 (ListMark "-" ends at 1), markerEnd + 1 = 2
    // So coordsAtPos will be called with positions 0 and 2.
    const origCoordsAtPos = view.coordsAtPos.bind(view);
    vi.spyOn(view, "coordsAtPos").mockImplementation((pos: number) => {
      if (pos === 0) return { top: 0, bottom: 20, left: 100, right: 100 };
      if (pos === 2) return { top: 0, bottom: 20, left: 116, right: 116 };
      return origCoordsAtPos(pos);
    });

    const decos = collectDecos(view);
    const li = decos.find((d) => d.class === "cm-list-item");
    expect(li).toBeDefined();
    // Indent should be 116 - 100 = 16px (not defaultCharacterWidth-based)
    expect(li!.style).toBe("--li-indent: 16px");

    view.destroy();
  });

  it("falls back to defaultCharacterWidth when coordsAtPos returns null", () => {
    const doc = "- Item\n\nother";
    const view = makeView(doc, doc.length - 1);

    // In jsdom, coordsAtPos already returns null, so no mocking needed.
    // "- " is 2 chars (markerEnd + 1 - listMark.from = 1 + 1 - 0 = 2)
    const expectedIndent = Math.round(2 * view.defaultCharacterWidth);
    const decos = collectDecos(view);
    const li = decos.find((d) => d.class === "cm-list-item");
    expect(li).toBeDefined();
    expect(li!.style).toBe(`--li-indent: ${expectedIndent}px`);

    view.destroy();
  });

  it("suppresses list item decoration when cursor is on a blockquote list item", () => {
    const doc = "> - Item\n\nother";
    // Cursor on position 4 ("I" in "Item"), which is on line 1 (the blockquote list item line)
    const view = makeView(doc, 4);
    const decos = collectDecos(view);
    const listDecos = decos.filter(
      (d) => d.class === "cm-list-item" || d.class === "cm-list-item-continuation",
    );
    expect(listDecos).toHaveLength(0);
    view.destroy();
  });

  it("keeps list item decoration when cursor is on a standalone list item", () => {
    const doc = "- Item\n\nother";
    // Cursor on position 2 ("I" in "Item"), which is on the list item line
    const view = makeView(doc, 2);
    const decos = collectDecos(view);
    const li = decos.find((d) => d.class === "cm-list-item");
    expect(li).toBeDefined();
    view.destroy();
  });

  it("keeps list item decoration when cursor is on a callout list item", () => {
    const doc = "> [!note]\n> - Item\n\nother";
    // Cursor on position 14 ("I" in "Item" on line 2), which is on the callout list item line
    const view = makeView(doc, 14);
    const decos = collectDecos(view);
    const li = decos.find((d) => d.class === "cm-list-item");
    expect(li).toBeDefined();
    view.destroy();
  });
});

describe("buildDecorations — footnote references", () => {
  it("[^1] replaced with widget when cursor is elsewhere", () => {
    const doc = "See [^1] here.\n\n[^1]: Def";
    const view = makeView(doc, doc.length - 1);
    const decos = collectDecos(view);
    const widget = decos.find((d) => d.widget && d.from === 4 && d.to === 8);
    expect(widget).toBeDefined();
    view.destroy();
  });

  it("raw [^1] shown when cursor is inside the ref", () => {
    const doc = "See [^1] here.\n\n[^1]: Def";
    const view = makeView(doc, 6);
    const decos = collectDecos(view);
    const widget = decos.find((d) => d.widget && d.from === 4 && d.to === 8);
    expect(widget).toBeUndefined();
    view.destroy();
  });

  it("correct number from first-reference order", () => {
    const doc = "See [^b] and [^a].\n\n[^a]: A\n[^b]: B";
    const view = makeView(doc, doc.length - 1);
    const decos = collectDecos(view);
    const widgets = decos.filter((d) => d.widget && d.from < 20);
    expect(widgets).toHaveLength(2);
    view.destroy();
  });

  it("works inside emphasis (processInlineChildren)", () => {
    const doc = "*text[^1]*\n\n[^1]: Def";
    const view = makeView(doc, doc.length - 1);
    const decos = collectDecos(view);
    const widget = decos.find((d) => d.widget && d.from === 5 && d.to === 9);
    expect(widget).toBeDefined();
    view.destroy();
  });

  it("multiple refs to same label show same number", () => {
    const doc = "See [^x] and [^x].\n\n[^x]: X def";
    const view = makeView(doc, doc.length - 1);
    const decos = collectDecos(view);
    const widgets = decos.filter((d) => d.widget && d.from < 20);
    expect(widgets).toHaveLength(2);
    view.destroy();
  });
});

describe("buildBlockReplacements — footnote definitions", () => {
  it("FootnoteDef block is hidden when cursor is elsewhere", () => {
    const doc = "Text\n\n[^1]: Def text";
    const state = EditorState.create({
      doc,
      selection: { anchor: 2 },
      extensions: [
        markdown({ extensions: [GFM, WikiLink, MathExt, CommentExt, Footnote] }),
        calloutFoldField,
      ],
    });
    const { decos } = buildBlockReplacements(state);
    const iter = decos.iter();
    const found: { from: number; to: number }[] = [];
    while (iter.value) {
      found.push({ from: iter.from, to: iter.to });
      iter.next();
    }
    const defReplace = found.find((d) => d.from === 6 && d.to === doc.length);
    expect(defReplace).toBeDefined();
  });

  it("FootnoteDef block shown raw when cursor is on that line", () => {
    const doc = "Text\n\n[^1]: Def text";
    const state = EditorState.create({
      doc,
      selection: { anchor: 10 },
      extensions: [
        markdown({ extensions: [GFM, WikiLink, MathExt, CommentExt, Footnote] }),
        calloutFoldField,
      ],
    });
    const { decos } = buildBlockReplacements(state);
    const iter = decos.iter();
    const found: { from: number; to: number }[] = [];
    while (iter.value) {
      found.push({ from: iter.from, to: iter.to });
      iter.next();
    }
    const defReplace = found.find((d) => d.from === 6);
    expect(defReplace).toBeUndefined();
  });

  it("multi-line definition hidden as single block", () => {
    const doc = "Text\n\n[^1]: First line\n    Continuation";
    const state = EditorState.create({
      doc,
      selection: { anchor: 2 },
      extensions: [
        markdown({ extensions: [GFM, WikiLink, MathExt, CommentExt, Footnote] }),
        calloutFoldField,
      ],
    });
    const { decos } = buildBlockReplacements(state);
    const iter = decos.iter();
    const found: { from: number; to: number }[] = [];
    while (iter.value) {
      found.push({ from: iter.from, to: iter.to });
      iter.next();
    }
    const defReplace = found.find((d) => d.from === 6 && d.to === doc.length);
    expect(defReplace).toBeDefined();
  });

  it("multiple consecutive defs each hidden independently", () => {
    const doc = "Text\n\n[^1]: First\n[^2]: Second";
    const state = EditorState.create({
      doc,
      selection: { anchor: 2 },
      extensions: [
        markdown({ extensions: [GFM, WikiLink, MathExt, CommentExt, Footnote] }),
        calloutFoldField,
      ],
    });
    const { decos } = buildBlockReplacements(state);
    const iter = decos.iter();
    const found: { from: number; to: number }[] = [];
    while (iter.value) {
      found.push({ from: iter.from, to: iter.to });
      iter.next();
    }
    const defReplaces = found.filter((d) => d.from >= 6);
    expect(defReplaces.length).toBeGreaterThanOrEqual(2);
  });
});
