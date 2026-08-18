import { describe, it, expect, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { GFM } from "@lezer/markdown";
import { buildDecorations, buildBlockReplacements, filterContainedDecorations, collectHtmlInlineTags } from "./decorations";
import { WikiLink } from "../markdown/wikilink";
import { Math as MathExt } from "../markdown/math";
import { Comment as CommentExt } from "../markdown/comment";
import { Footnote } from "../markdown/footnote";
import { calloutFoldField } from "./callout";
import { mediaThumbnailsFacet } from "./mediaThumbnails";
import { Decoration } from "@codemirror/view";
import { ImageWidget, MermaidWidget, HorizontalRuleWidget, DisplayMathWidget, EscapedDollarWidget, HtmlBreakWidget } from "./widgets";
import { FootnoteRefWidget, FootnoteDefMarkWidget, FootnoteDefBodyWidget } from "./footnoteWidgets";

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
  widgetVariant?: "short" | "full";
  widgetKind?: "escaped-dollar" | "footnote-def-mark" | "footnote-ref" | "footnote-def-body" | "html-break";
  footnoteDisplayLabel?: string; // raw source label for ref sup and def mark
  footnoteBodyText?: string;
  footnoteTargetRefPos?: number | null;
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
    if (spec.widget) {
      info.widget = true;
      if (spec.widget instanceof HorizontalRuleWidget) info.widgetVariant = spec.widget.variant;
      if (spec.widget instanceof EscapedDollarWidget) info.widgetKind = "escaped-dollar";
      if (spec.widget instanceof FootnoteRefWidget) {
        info.widgetKind = "footnote-ref";
        info.footnoteDisplayLabel = spec.widget.label;
      }
      if (spec.widget instanceof FootnoteDefMarkWidget) {
        info.widgetKind = "footnote-def-mark";
        info.footnoteDisplayLabel = spec.widget.label;
        info.footnoteTargetRefPos = spec.widget.targetRefPos;
      }
      if (spec.widget instanceof FootnoteDefBodyWidget) {
        info.widgetKind = "footnote-def-body";
        info.footnoteBodyText = spec.widget.bodyText;
        info.footnoteTargetRefPos = spec.widget.targetRefPos;
      }
      if (spec.widget instanceof HtmlBreakWidget) info.widgetKind = "html-break";
    }
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

  it("heading content mark sets inclusive so start-/end-aligned widgets nest", () => {
    const view = makeView("## Title $x$\n\nbody", 15); // cursor on body
    const { decorations } = buildDecorations(view);
    let found = false;
    const iter = decorations.iter();
    while (iter.value) {
      const spec = iter.value.spec as Record<string, unknown>;
      if (spec.class === "cm-preview-h2") {
        expect(spec.inclusive === true).toBe(true);
        found = true;
      }
      iter.next();
    }
    expect(found).toBe(true);
    view.destroy();
  });

  it("bold content mark sets inclusive so start-/end-aligned widgets nest", () => {
    const doc = "**$d_1$ is standardized**\n\nbody";
    const view = makeView(doc, doc.length - 1); // cursor on body
    const { decorations } = buildDecorations(view);
    let found = false;
    const iter = decorations.iter();
    while (iter.value) {
      const spec = iter.value.spec as Record<string, unknown>;
      if (spec.class === "cm-preview-bold") {
        expect(spec.inclusive === true).toBe(true);
        found = true;
      }
      iter.next();
    }
    expect(found).toBe(true);
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

describe("buildDecorations — plain brackets (cm-plain-brackets)", () => {
  it("applies cm-plain-brackets to bare [sic] with cursor elsewhere", () => {
    const doc = "This [sic] was surprising.\n\nother";
    const view = makeView(doc, doc.length - 1);
    const decos = collectDecos(view);
    const pb = decos.find((d) => d.class === "cm-plain-brackets");
    expect(pb).toBeDefined();
    expect(pb!.from).toBe(5);
    expect(pb!.to).toBe(10);
    view.destroy();
  });

  it("applies cm-plain-brackets even when cursor is inside the bracket range", () => {
    const view = makeView("This [sic] was surprising.", 7);
    const decos = collectDecos(view);
    const pb = decos.find((d) => d.class === "cm-plain-brackets");
    expect(pb).toBeDefined();
    view.destroy();
  });

  it("applies cm-plain-brackets to bare link nested in **bold [sic] text**", () => {
    const doc = "**bold [sic] text**\n\nother";
    const view = makeView(doc, doc.length - 1);
    const decos = collectDecos(view);
    const pb = decos.find((d) => d.class === "cm-plain-brackets");
    expect(pb).toBeDefined();
    expect(pb!.from).toBe(7);
    expect(pb!.to).toBe(12);
    view.destroy();
  });

  it("applies cm-plain-brackets to bare link in # Head [sic] with cursor on heading", () => {
    const doc = "# Head [sic]\n\nother";
    const view = makeView(doc, doc.length - 1);
    const decos = collectDecos(view);
    const pb = decos.find((d) => d.class === "cm-plain-brackets");
    expect(pb).toBeDefined();
    expect(pb!.from).toBe(7);
    expect(pb!.to).toBe(12);
    view.destroy();
  });

  it("does NOT apply cm-plain-brackets to real links", () => {
    const doc = "[Click me](https://example.com)\n\nother";
    const view = makeView(doc, doc.length - 1);
    const decos = collectDecos(view);
    expect(decos.some((d) => d.class === "cm-plain-brackets")).toBe(false);
    view.destroy();
  });

  it("does NOT apply cm-plain-brackets to wikilinks", () => {
    const doc = "[[WikiLink]]\n\nother";
    const view = makeView(doc, doc.length - 1);
    const decos = collectDecos(view);
    expect(decos.some((d) => d.class === "cm-plain-brackets")).toBe(false);
    view.destroy();
  });

  it("does NOT apply cm-plain-brackets to footnote refs", () => {
    const doc = "Text [^1] here\n\n[^1]: footnote def";
    const view = makeView(doc, 0);
    const decos = collectDecos(view);
    expect(decos.some((d) => d.class === "cm-plain-brackets")).toBe(false);
    view.destroy();
  });

  it("does NOT apply cm-plain-brackets to escaped \\[foo\\]", () => {
    const doc = "\\[foo\\]\n\nother";
    const view = makeView(doc, doc.length - 1);
    const decos = collectDecos(view);
    expect(decos.some((d) => d.class === "cm-plain-brackets")).toBe(false);
    view.destroy();
  });

  it("does NOT apply cm-plain-brackets to citation [@key]", () => {
    const doc = "See [@key2024foo] here\n\nother";
    const view = makeView(doc, doc.length - 1);
    const decos = collectDecos(view);
    expect(decos.some((d) => d.class === "cm-plain-brackets")).toBe(false);
    view.destroy();
  });

  it("does NOT apply cm-plain-brackets to shortcut ref with matching def", () => {
    const doc = "[bar]: https://example.com\n\nSee [bar] here";
    const view = makeView(doc, doc.length - 1);
    const decos = collectDecos(view);
    expect(decos.some((d) => d.class === "cm-plain-brackets")).toBe(false);
    view.destroy();
  });

  it("does NOT apply cm-plain-brackets to ![foo] with matching def", () => {
    const doc = "[foo]: https://example.com\n\nSee ![foo] here";
    const view = makeView(doc, doc.length - 1);
    const decos = collectDecos(view);
    expect(decos.some((d) => d.class === "cm-plain-brackets")).toBe(false);
    view.destroy();
  });

  it("does NOT apply cm-plain-brackets to ![foo][] with matching def", () => {
    const doc = "[foo]: https://example.com\n\nSee ![foo][] here";
    const view = makeView(doc, doc.length - 1);
    const decos = collectDecos(view);
    expect(decos.some((d) => d.class === "cm-plain-brackets")).toBe(false);
    view.destroy();
  });

  it("does NOT apply cm-plain-brackets to ![alt][foo] with matching def", () => {
    const doc = "[foo]: https://example.com\n\nSee ![alt][foo] here";
    const view = makeView(doc, doc.length - 1);
    const decos = collectDecos(view);
    expect(decos.some((d) => d.class === "cm-plain-brackets")).toBe(false);
    view.destroy();
  });

  it("does NOT apply cm-plain-brackets to GFM task - [x] done", () => {
    const doc = "- [x] done\n\nother";
    const view = makeView(doc, doc.length - 1);
    const decos = collectDecos(view);
    expect(decos.some((d) => d.class === "cm-plain-brackets")).toBe(false);
    view.destroy();
  });

  it("does NOT apply cm-plain-brackets to GFM task - [ ] todo", () => {
    const doc = "- [ ] todo\n\nother";
    const view = makeView(doc, doc.length - 1);
    const decos = collectDecos(view);
    expect(decos.some((d) => d.class === "cm-plain-brackets")).toBe(false);
    view.destroy();
  });

  it("applies cm-plain-brackets to bare [3]", () => {
    const doc = "See item [3] below.\n\nother";
    const view = makeView(doc, doc.length - 1);
    const decos = collectDecos(view);
    const pb = decos.find((d) => d.class === "cm-plain-brackets");
    expect(pb).toBeDefined();
    expect(pb!.from).toBe(9);
    expect(pb!.to).toBe(12);
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

  it("does not crash on empty wikilink [[]]", () => {
    const doc = "[[]]\n\nother";
    const view = makeView(doc, doc.length - 1);
    expect(() => collectDecos(view)).not.toThrow();
    const decos = collectDecos(view);
    expect(decos.filter((d) => d.class === "cm-preview-wikilink")).toHaveLength(0);
    view.destroy();
  });

  it("does not crash on wikilink with empty display [[Target|]]", () => {
    const doc = "[[Target|]]\n\nother";
    const view = makeView(doc, doc.length - 1);
    expect(() => collectDecos(view)).not.toThrow();
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

  it("marks header line as first and final body line as last", () => {
    const doc = "> [!note]\n> One\n> Two\n\nother";
    const view = makeView(doc, doc.length - 1);
    const decos = collectDecos(view);
    const first = decos.find((d) => d.class?.includes("cm-callout-first"));
    expect(first?.from).toBe(0);
    const lastLine = view.state.doc.line(3);
    const last = decos.find((d) => d.class?.includes("cm-callout-last"));
    expect(last?.from).toBe(lastLine.from);
    view.destroy();
  });

  it("marks the header line as both first and last for a body-less callout", () => {
    const doc = "> [!note]\n\nother";
    const view = makeView(doc, doc.length - 1);
    const decos = collectDecos(view);
    const header = decos.find((d) => d.class?.includes("cm-callout-first"));
    expect(header?.class).toContain("cm-callout-last");
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

describe("buildDecorations — escaped dollar", () => {
  it("replaces \\$ with EscapedDollarWidget when caret is away", () => {
    const doc = "The price is \\$5.";
    const view = makeView(doc, doc.length); // cursor at end, away from the escape
    const decos = collectDecos(view);
    const escape = view.state.doc.line(1).text.indexOf("\\$");
    const widget = decos.find((d) => d.widgetKind === "escaped-dollar");
    expect(widget).toBeDefined();
    expect(widget!.from).toBe(escape);
    expect(widget!.to).toBe(escape + 2);
    view.destroy();
  });

  it("reveals raw \\$ when caret is inside the escape", () => {
    const doc = "The price is \\$5.";
    const escape = doc.indexOf("\\$");
    const view = makeView(doc, escape + 1); // caret inside the two-char escape
    const decos = collectDecos(view);
    expect(decos.some((d) => d.widgetKind === "escaped-dollar")).toBe(false);
    view.destroy();
  });

  it("keeps inline math as math (no escaped-dollar widget)", () => {
    const doc = "$E=mc^2$ and \\$5";
    const view = makeView(doc, doc.length);
    const decos = collectDecos(view);
    const math = decos.find((d) => d.widget && d.from === 0 && d.to === 8);
    expect(math).toBeDefined();
    const escaped = decos.find((d) => d.widgetKind === "escaped-dollar");
    expect(escaped).toBeDefined(); // the \\$ still gets the widget
    expect(escaped!.from).toBe(13);
    view.destroy();
  });

  it("does not substitute for \\\\$ (escaped backslash + bare dollar)", () => {
    const doc = "\\\\$";
    const view = makeView(doc, doc.length); // caret away
    const decos = collectDecos(view);
    expect(decos.some((d) => d.widgetKind === "escaped-dollar")).toBe(false);
    view.destroy();
  });

  it("does not substitute for non-dollar escapes like \\*", () => {
    const doc = "\\* star\n\nother";
    const view = makeView(doc, doc.length); // caret away
    const decos = collectDecos(view);
    expect(decos.some((d) => d.widgetKind === "escaped-dollar")).toBe(false);
    view.destroy();
  });

  it("does not substitute inside inline code", () => {
    const doc = "`\\$` text";
    const view = makeView(doc, doc.length);
    const decos = collectDecos(view);
    expect(decos.some((d) => d.widgetKind === "escaped-dollar")).toBe(false);
    view.destroy();
  });

  it("does not substitute inside fenced code", () => {
    const doc = "```\n\\$5\n```\n\nother";
    const view = makeView(doc, doc.length);
    const decos = collectDecos(view);
    expect(decos.some((d) => d.widgetKind === "escaped-dollar")).toBe(false);
    view.destroy();
  });

  it("nested: replaces \\$ inside bold", () => {
    const doc = "**cost \\$5**\n\nother";
    const view = makeView(doc, doc.length);
    const decos = collectDecos(view);
    const widget = decos.find((d) => d.widgetKind === "escaped-dollar");
    expect(widget).toBeDefined();
    expect(widget!.from).toBe(7);
    expect(widget!.to).toBe(9);
    // bold mark is present on the content
    expect(decos.find((d) => d.class === "cm-preview-bold")).toBeDefined();
    view.destroy();
  });

  it("nested: replaces \\$ inside link labels when caret is away", () => {
    const doc = "[costs \\$5](http://x.com)\n\nother";
    const view = makeView(doc, doc.length); // caret on "other"
    const decos = collectDecos(view);
    const escape = view.state.doc.line(1).text.indexOf("\\$");
    const widget = decos.find((d) => d.widgetKind === "escaped-dollar");
    expect(widget).toBeDefined();
    expect(widget!.from).toBe(escape);
    expect(widget!.to).toBe(escape + 2);
    // link mark still applied to the label
    expect(decos.find((d) => d.class === "cm-preview-link")).toBeDefined();
    view.destroy();
  });

  it("reveals raw \\$ inside link labels when caret is inside the link", () => {
    const doc = "[costs \\$5](http://x.com)\n\nother";
    const escape = doc.indexOf("\\$");
    const view = makeView(doc, escape + 1); // caret inside the escape
    const decos = collectDecos(view);
    expect(decos.some((d) => d.widgetKind === "escaped-dollar")).toBe(false);
    view.destroy();
  });

  it("nested: replaces \\$ inside bold link label when caret is away", () => {
    const doc = "[*costs \\$5*](http://x.com)\n\nother";
    const view = makeView(doc, doc.length);
    const decos = collectDecos(view);
    const widget = decos.find((d) => d.widgetKind === "escaped-dollar");
    expect(widget).toBeDefined();
    expect(decos.find((d) => d.class === "cm-preview-italic")).toBeDefined();
    expect(decos.find((d) => d.class === "cm-preview-link")).toBeDefined();
    view.destroy();
  });

  it("nested: replaces \\$ inside reference link labels when caret is away", () => {
    const doc = "[costs \\$5][ref]\n\n[ref]: http://x.com\n\nother";
    const view = makeView(doc, doc.length);
    const decos = collectDecos(view);
    const widget = decos.find((d) => d.widgetKind === "escaped-dollar");
    expect(widget).toBeDefined();
    view.destroy();
  });

  it("nested: replaces \\$ inside a heading", () => {
    const doc = "## cost \\$5\n\nother";
    const view = makeView(doc, doc.length);
    const decos = collectDecos(view);
    const widget = decos.find((d) => d.widgetKind === "escaped-dollar");
    expect(widget).toBeDefined();
    expect(decos.find((d) => d.class === "cm-preview-h2")).toBeDefined();
    view.destroy();
  });

  it("adds only \\$ escape lines to cursorSensitiveLines", () => {
    const doc = "plain\nThe price is \\$5.\nmore\n\\*other escape\\* not sensitive";
    const view = makeView(doc, 0);
    const { cursorSensitiveLines } = buildDecorations(view);
    expect(cursorSensitiveLines.has(2)).toBe(true); // \\$ line
    expect(cursorSensitiveLines.has(1)).toBe(false); // plain line
    expect(cursorSensitiveLines.has(3)).toBe(false); // plain line
    expect(cursorSensitiveLines.has(4)).toBe(false); // \\* escapes are not \\$
    view.destroy();
  });

  it("does not emit EscapedDollarWidget or cursor sensitivity for \\$ inside table cells", () => {
    const doc = "| a |\n|---|\n| \\$5 |\n\nother";
    const view = makeView(doc, doc.length); // caret on "other"
    const decos = collectDecos(view);
    expect(decos.some((d) => d.widgetKind === "escaped-dollar")).toBe(false);
    // table body line (3) is not sensitivity-polluted solely by the \\$
    const { cursorSensitiveLines } = buildDecorations(view);
    expect(cursorSensitiveLines.has(3)).toBe(false);
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

describe("buildDecorations — display math with \\[...\\] delimiters", () => {
  function findDisplayMathWidget(view: EditorView): DisplayMathWidget | undefined {
    const { decorations: decoSet } = buildDecorations(view);
    const iter = decoSet.iter();
    while (iter.value) {
      if (iter.value.spec.widget instanceof DisplayMathWidget) {
        return iter.value.spec.widget;
      }
      iter.next();
    }
    return undefined;
  }

  function findBlockDisplayMathWidget(view: EditorView): DisplayMathWidget | undefined {
    const blockState = buildBlockReplacements(view.state);
    const iter = blockState.decos.iter();
    while (iter.value) {
      if (iter.value.spec.widget instanceof DisplayMathWidget) {
        return iter.value.spec.widget;
      }
      iter.next();
    }
    return undefined;
  }

  it("single-line \\[x^2\\] renders widget with latex x^2", () => {
    const doc = "\\[x^2\\]\n\nother";
    const view = makeView(doc, doc.length - 1);
    const widget = findDisplayMathWidget(view);
    expect(widget).toBeDefined();
    expect(widget!.latex).toBe("x^2");
    view.destroy();
  });

  it("content-line close \\[\\nx^2 \\] renders widget with latex x^2", () => {
    const doc = "\\[\nx^2 \\]\n\nother";
    const view = makeView(doc, doc.length - 1);
    const widget = findBlockDisplayMathWidget(view);
    expect(widget).toBeDefined();
    expect(widget!.latex).toBe("x^2");
    view.destroy();
  });

  it("multi-line \\[...\\] with own-line close renders widget with latex x^2", () => {
    const doc = "\\[\nx^2\n\\]\n\nother";
    const view = makeView(doc, doc.length - 1);
    const widget = findBlockDisplayMathWidget(view);
    expect(widget).toBeDefined();
    expect(widget!.latex).toBe("x^2");
    view.destroy();
  });

  it("shows raw multi-line \\[...\\] when cursor is on any line of block", () => {
    const view = makeView("\\[\nx^2\n\\]", 4); // cursor on content line
    const widget = findBlockDisplayMathWidget(view);
    expect(widget).toBeUndefined();
    view.destroy();
  });

  it("unclosed $$ block whose last line ends with \\] does not strip \\] as closer", () => {
    const doc = "hello\n\n$$\nx^2 \\]";
    const view = makeView(doc, 0);
    const widget = findBlockDisplayMathWidget(view);
    expect(widget).toBeDefined();
    expect(widget!.latex).toBe("x^2 \\]");
    view.destroy();
  });

  it("unclosed \\[ block whose last line ends with $$ does not strip $$ as closer", () => {
    const doc = "hello\n\n\\[\nx^2 $$";
    const view = makeView(doc, 0);
    const widget = findBlockDisplayMathWidget(view);
    expect(widget).toBeDefined();
    expect(widget!.latex).toBe("x^2 $$");
    view.destroy();
  });

  it("properly closed multi-line $$...$$ still extracts latex correctly", () => {
    const doc = "$$\nx^2\n$$\n\nother";
    const view = makeView(doc, doc.length - 1);
    const widget = findBlockDisplayMathWidget(view);
    expect(widget).toBeDefined();
    expect(widget!.latex).toBe("x^2");
    view.destroy();
  });

  it("properly closed multi-line \\[...\\] still extracts latex correctly", () => {
    const doc = "\\[\nx^2\n\\]\n\nother";
    const view = makeView(doc, doc.length - 1);
    const widget = findBlockDisplayMathWidget(view);
    expect(widget).toBeDefined();
    expect(widget!.latex).toBe("x^2");
    view.destroy();
  });

  it("single-line $$x^2$$ still extracts latex correctly", () => {
    const doc = "$$x^2$$\n\nother";
    const view = makeView(doc, doc.length - 1);
    const widget = findDisplayMathWidget(view);
    expect(widget).toBeDefined();
    expect(widget!.latex).toBe("x^2");
    view.destroy();
  });

  it("single-line \\[x^2\\] still extracts latex correctly", () => {
    const doc = "\\[x^2\\]\n\nother";
    const view = makeView(doc, doc.length - 1);
    const widget = findDisplayMathWidget(view);
    expect(widget).toBeDefined();
    expect(widget!.latex).toBe("x^2");
    view.destroy();
  });
});

describe("buildDecorations — inline math with \\(...\\) delimiters", () => {
  it("replaces \\(E=mc^2\\) with InlineMathWidget when cursor elsewhere", () => {
    const doc = "\\(E=mc^2\\)\n\nother";
    const view = makeView(doc, doc.length - 1);
    const decos = collectDecos(view);
    const mathWidget = decos.find((d) => d.widget && d.from === 0 && d.to === 10);
    expect(mathWidget).toBeDefined();
    view.destroy();
  });

  it("shows raw \\(E=mc^2\\) when cursor is inside math", () => {
    const view = makeView("\\(E=mc^2\\)", 4);
    const decos = collectDecos(view);
    expect(decos).toHaveLength(0);
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
    if (spec.widget) {
      info.widget = true;
      if (spec.widget instanceof HorizontalRuleWidget) info.widgetVariant = spec.widget.variant;
      if (spec.widget instanceof EscapedDollarWidget) info.widgetKind = "escaped-dollar";
      if (spec.widget instanceof FootnoteDefMarkWidget) {
        info.widgetKind = "footnote-def-mark";
        info.footnoteDisplayLabel = spec.widget.label;
        info.footnoteTargetRefPos = spec.widget.targetRefPos;
      }
      if (spec.widget instanceof FootnoteDefBodyWidget) {
        info.widgetKind = "footnote-def-body";
        info.footnoteBodyText = spec.widget.bodyText;
        info.footnoteTargetRefPos = spec.widget.targetRefPos;
      }
    }
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

  it("replaces table inside a blockquote with widget", () => {
    const doc = "> | a | b |\n> | --- | --- |\n> | 1 | 2 |\n\nother";
    const view = makeView(doc, doc.length - 1);
    const decos = collectBlockDecos(view);
    const tableWidget = decos.find((d) => d.widget);
    expect(tableWidget).toBeDefined();
    // Table node starts at the first "|", after the "> " prefix
    expect(tableWidget!.from).toBe(2);
    view.destroy();
  });

  it("replaces table inside a callout with widget", () => {
    const doc = "> [!note]\n>\n> | a | b |\n> | --- | --- |\n> | 1 | 2 |\n\nother";
    const view = makeView(doc, doc.length - 1);
    const decos = collectBlockDecos(view);
    const tableWidget = decos.find((d) => d.widget && d.from === 14);
    expect(tableWidget).toBeDefined();
    view.destroy();
  });

  it("degrades a malformed quoted table to visible source (no widget)", () => {
    const doc = "> | a |\n> | -x- |\n> | 1 |\n\nother";
    const view = makeView(doc, doc.length - 1);
    const decos = collectBlockDecos(view);
    expect(decos.find((d) => d.widget)).toBeUndefined();
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
  it("replaces --- with short variant widget when cursor is elsewhere", () => {
    const doc = "text\n\n---\n\nother";
    const view = makeView(doc, doc.length - 1);
    const decos = collectDecos(view);
    const hr = decos.find((d) => d.widget && d.from === 6 && d.to === 9);
    expect(hr).toBeDefined();
    expect(hr!.widgetVariant).toBe("short");
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

  it("replaces ---- with full variant widget", () => {
    const doc = "text\n\n----\n\nother";
    const view = makeView(doc, doc.length - 1);
    const decos = collectDecos(view);
    const hr = decos.find((d) => d.widget && d.from === 6 && d.to === 10);
    expect(hr).toBeDefined();
    expect(hr!.widgetVariant).toBe("full");
    view.destroy();
  });

  it("replaces - - - (spaced three dashes) with short variant", () => {
    const doc = "text\n\n- - -\n\nother";
    const view = makeView(doc, doc.length - 1);
    const decos = collectDecos(view);
    const hr = decos.find((d) => d.widget && d.from === 6);
    expect(hr).toBeDefined();
    expect(hr!.widgetVariant).toBe("short");
    view.destroy();
  });

  it("replaces *** with full variant widget", () => {
    const doc = "text\n\n***\n\nother";
    const view = makeView(doc, doc.length - 1);
    const decos = collectDecos(view);
    const hr = decos.find((d) => d.widget && d.from === 6 && d.to === 9);
    expect(hr).toBeDefined();
    expect(hr!.widgetVariant).toBe("full");
    view.destroy();
  });

  it("replaces ___ with full variant widget", () => {
    const doc = "text\n\n___\n\nother";
    const view = makeView(doc, doc.length - 1);
    const decos = collectDecos(view);
    const hr = decos.find((d) => d.widget && d.from === 6 && d.to === 9);
    expect(hr).toBeDefined();
    expect(hr!.widgetVariant).toBe("full");
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

describe("buildDecorations — page break comments", () => {
  it("replaces <!-- Page 2 --> with widget when cursor is elsewhere", () => {
    const doc = "text\n\n<!-- Page 2 -->\n\nother";
    const view = makeView(doc, doc.length - 1);
    const decos = collectDecos(view);
    const pb = decos.find((d) => d.widget && d.from === 6 && d.to === 21);
    expect(pb).toBeDefined();
    view.destroy();
  });

  it("shows raw comment when cursor is on line", () => {
    const doc = "text\n\n<!-- Page 2 -->\n\nother";
    const view = makeView(doc, 10);
    const decos = collectDecos(view);
    const pb = decos.find((d) => d.widget && d.from === 6 && d.to === 21);
    expect(pb).toBeUndefined();
    view.destroy();
  });

  it("handles metadata variant <!-- Page 3 - 2 images -->", () => {
    const doc = "text\n\n<!-- Page 3 - 2 images -->\n\nother";
    const view = makeView(doc, doc.length - 1);
    const decos = collectDecos(view);
    const pb = decos.find((d) => d.widget && d.from === 6);
    expect(pb).toBeDefined();
    view.destroy();
  });

  it("does NOT decorate non-page-break HTML comments", () => {
    const doc = "text\n\n<!-- just a comment -->\n\nother";
    const view = makeView(doc, doc.length - 1);
    const decos = collectDecos(view);
    const pb = decos.find((d) => d.widget && d.from === 6);
    expect(pb).toBeUndefined();
    view.destroy();
  });

  it("decorates multiple page breaks", () => {
    const doc = "text\n\n<!-- Page 1 -->\n\nmiddle\n\n<!-- Page 2 -->\n\nother";
    const view = makeView(doc, doc.length - 1);
    const decos = collectDecos(view);
    const pbs = decos.filter((d) => d.widget);
    expect(pbs).toHaveLength(2);
    view.destroy();
  });

  it("adds CommentBlock lines to cursorSensitiveLines", () => {
    const doc = "text\n\n<!-- Page 2 -->\n\nother";
    const view = makeView(doc, doc.length - 1);
    const { cursorSensitiveLines } = buildDecorations(view);
    const commentLine = view.state.doc.lineAt(6).number;
    expect(cursorSensitiveLines.has(commentLine)).toBe(true);
    view.destroy();
  });

  it("does NOT add non-page-break HTML comments to cursorSensitiveLines", () => {
    const doc = "text\n\n<!-- just a comment -->\n\nother";
    const view = makeView(doc, doc.length - 1);
    const { cursorSensitiveLines } = buildDecorations(view);
    const commentLine = view.state.doc.lineAt(6).number;
    expect(cursorSensitiveLines.has(commentLine)).toBe(false);
    view.destroy();
  });

  it("only page-break CommentBlocks are cursor-sensitive, not ordinary HTML comments", () => {
    const doc = "<!-- Page 2 -->\n\n<!-- TODO: fix -->\n\nother";
    const view = makeView(doc, doc.length - 1);
    const { cursorSensitiveLines } = buildDecorations(view);
    const pageBreakLine = view.state.doc.lineAt(0).number;
    expect(cursorSensitiveLines.has(pageBreakLine)).toBe(true);
    const todoLine = view.state.doc.lineAt(17).number;
    expect(cursorSensitiveLines.has(todoLine)).toBe(false);
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

describe("buildDecorations — inline HTML sup/sub", () => {
  it("hides <sup>/</sup> and marks content when cursor elsewhere", () => {
    const doc = "Hello<sup>world</sup>\n\nother";
    const view = makeView(doc, doc.length - 1); // caret on "other"
    const decos = collectDecos(view);
    expect(decos.some((d) => d.type === "replace" && d.from === 5 && d.to === 10)).toBe(true);
    expect(decos.some((d) => d.type === "replace" && d.from === 15 && d.to === 21)).toBe(true);
    const sup = decos.find((d) => d.class === "cm-preview-sup");
    expect(sup).toBeDefined();
    expect(sup!.from).toBe(10);
    expect(sup!.to).toBe(15);
    view.destroy();
  });

  it("hides <sub>/</sub> and marks content when cursor elsewhere", () => {
    const doc = "a<sub>i</sub>\n\nother";
    const view = makeView(doc, doc.length - 1);
    const decos = collectDecos(view);
    expect(decos.some((d) => d.type === "replace" && d.from === 1 && d.to === 6)).toBe(true);
    expect(decos.some((d) => d.type === "replace" && d.from === 7 && d.to === 13)).toBe(true);
    const sub = decos.find((d) => d.class === "cm-preview-sub");
    expect(sub).toBeDefined();
    expect(sub!.from).toBe(6);
    expect(sub!.to).toBe(7);
    view.destroy();
  });

  it("reveals raw tags + source when caret is inside the span", () => {
    const doc = "Hello<sup>world</sup>\n\nother";
    const view = makeView(doc, 12); // caret inside "world"
    const decos = collectDecos(view);
    expect(decos.some((d) => d.class === "cm-preview-sup")).toBe(false);
    expect(decos.filter((d) => d.type === "replace" && d.from >= 5 && d.to <= 21)).toHaveLength(0);
    view.destroy();
  });

  it("reveals raw tags when caret sits on the open tag itself", () => {
    const doc = "Hello<sup>world</sup>\n\nother";
    const view = makeView(doc, 5); // caret on "<" of <sup>
    const decos = collectDecos(view);
    expect(decos.some((d) => d.class === "cm-preview-sup")).toBe(false);
    view.destroy();
  });

  it("keeps a sibling span decorated when caret is inside another", () => {
    const doc = "Hello<sup>world</sup> and <sup>there</sup>\n\nother";
    const view = makeView(doc, 7); // caret inside first span's content
    const decos = collectDecos(view);
    const sups = decos.filter((d) => d.class === "cm-preview-sup");
    expect(sups).toHaveLength(1);
    expect(sups[0]!.from).toBe(31);
    expect(sups[0]!.to).toBe(36);
    view.destroy();
  });

  it("sup over a link keeps both the sup mark and the link decorations", () => {
    const doc = "See<sup>[1](#chap01.html_b_1)</sup>\n\nx";
    const view = makeView(doc, doc.length - 1); // caret on x
    const decos = collectDecos(view);
    const sup = decos.find((d) => d.class === "cm-preview-sup");
    expect(sup).toBeDefined();
    expect(sup!.from).toBe(8);
    expect(sup!.to).toBe(29);
    const link = decos.find((d) => d.class === "cm-preview-link");
    expect(link).toBeDefined();
    expect(link!.url).toBe("#chap01.html_b_1");
    expect(decos.some((d) => d.type === "replace" && d.from === 8 && d.to === 9)).toBe(true);
    expect(decos.some((d) => d.type === "replace" && d.from === 10 && d.to === 29)).toBe(true);
    view.destroy();
  });

  it("sup over bold keeps both the sup mark and the bold mark", () => {
    const doc = "a<sup>**b**</sup>\n\nother";
    const view = makeView(doc, doc.length - 1);
    const decos = collectDecos(view);
    const sup = decos.find((d) => d.class === "cm-preview-sup");
    expect(sup).toBeDefined();
    expect(sup!.from).toBe(6);
    expect(sup!.to).toBe(11);
    expect(decos.find((d) => d.class === "cm-preview-bold")).toBeDefined();
    view.destroy();
  });

  it("unclosed <sup> stays raw (no hide, no mark)", () => {
    const doc = "Unclosed<sup>stays\n\nother";
    const view = makeView(doc, doc.length - 1);
    const decos = collectDecos(view);
    expect(decos.some((d) => d.class === "cm-preview-sup")).toBe(false);
    expect(decos.filter((d) => d.type === "replace")).toHaveLength(0);
    view.destroy();
  });

  it("unknown <span>...</span> stays raw", () => {
    const doc = "a<span>b</span>\n\nother";
    const view = makeView(doc, doc.length - 1);
    const decos = collectDecos(view);
    expect(decos.some((d) => d.class === "cm-preview-sup")).toBe(false);
    expect(decos.filter((d) => d.type === "replace")).toHaveLength(0);
    view.destroy();
  });

  it("attributed <sup id=\"x\"> stays raw (bare-only v1)", () => {
    const doc = 'a<sup id="x">b</sup>\n\nother';
    const view = makeView(doc, doc.length - 1);
    const decos = collectDecos(view);
    expect(decos.some((d) => d.class === "cm-preview-sup")).toBe(false);
    expect(decos.filter((d) => d.type === "replace")).toHaveLength(0);
    view.destroy();
  });

  it("renders sup inside a heading (separate HTMLTag pass)", () => {
    const doc = "## title<sup>1</sup>\n\nother";
    const view = makeView(doc, doc.length - 1);
    const decos = collectDecos(view);
    expect(decos.find((d) => d.class === "cm-preview-h2")).toBeDefined();
    const sup = decos.find((d) => d.class === "cm-preview-sup");
    expect(sup).toBeDefined();
    expect(sup!.from).toBe(13);
    expect(sup!.to).toBe(14);
    view.destroy();
  });

  it("renders sup inside emphasis (separate HTMLTag pass)", () => {
    const doc = "*a<sup>1</sup>*\n\nother";
    const view = makeView(doc, doc.length - 1);
    const decos = collectDecos(view);
    expect(decos.find((d) => d.class === "cm-preview-italic")).toBeDefined();
    const sup = decos.find((d) => d.class === "cm-preview-sup");
    expect(sup).toBeDefined();
    expect(sup!.from).toBe(7);
    expect(sup!.to).toBe(8);
    view.destroy();
  });

  it("adds span lines to cursorSensitiveLines even when caret is inside", () => {
    const doc = "plain\nHello<sup>world</sup>\nmore";
    const view = makeView(doc, 0); // caret on "plain"
    const { cursorSensitiveLines } = buildDecorations(view);
    expect(cursorSensitiveLines.has(2)).toBe(true);
    expect(cursorSensitiveLines.has(1)).toBe(false);
    view.destroy();
  });

  it("hides <mark>/</mark> and marks content when cursor elsewhere", () => {
    const doc = "hi <mark>there</mark>\n\nother";
    const view = makeView(doc, doc.length - 1);
    const decos = collectDecos(view);
    expect(decos.some((d) => d.type === "replace" && d.from === 3 && d.to === 9)).toBe(true);
    expect(decos.some((d) => d.type === "replace" && d.from === 14 && d.to === 21)).toBe(true);
    const mark = decos.find((d) => d.class === "cm-preview-mark");
    expect(mark).toBeDefined();
    expect(mark!.from).toBe(9);
    expect(mark!.to).toBe(14);
    view.destroy();
  });

  it("reveals raw <mark> tags when caret is inside the span", () => {
    const doc = "hi <mark>there</mark>\n\nother";
    const view = makeView(doc, 11); // caret inside "there"
    const decos = collectDecos(view);
    expect(decos.some((d) => d.class === "cm-preview-mark")).toBe(false);
    view.destroy();
  });

  it("no tags in doc: no html sup/sub decos (smoke)", () => {
    const doc = "plain text\n\nother";
    const view = makeView(doc, doc.length - 1);
    const decos = collectDecos(view);
    expect(decos.some((d) => d.class === "cm-preview-sup" || d.class === "cm-preview-sub")).toBe(false);
    view.destroy();
  });

  it("hides <br>/<br/> with a break widget when cursor elsewhere", () => {
    const doc = "a<br>b\n\nother";
    const view = makeView(doc, doc.length - 1);
    const decos = collectDecos(view);
    const br = decos.find((d) => d.widgetKind === "html-break");
    expect(br).toBeDefined();
    expect(br!.from).toBe(1);
    expect(br!.to).toBe(5);
    view.destroy();
  });

  it("hides <br/> self-closing form", () => {
    const doc = "a<br/>b\n\nother";
    const view = makeView(doc, doc.length - 1);
    const decos = collectDecos(view);
    const br = decos.find((d) => d.widgetKind === "html-break");
    expect(br).toBeDefined();
    expect(br!.from).toBe(1);
    expect(br!.to).toBe(6);
    view.destroy();
  });

  it("reveals raw <br> when caret is on the tag", () => {
    const doc = "a<br>b\n\nother";
    const view = makeView(doc, 2); // caret inside "<br>"
    const decos = collectDecos(view);
    expect(decos.some((d) => d.widgetKind === "html-break")).toBe(false);
    view.destroy();
  });

  it("renders multiple brs and keeps the line cursor-sensitive", () => {
    const doc = "a<br>b and c<br/>d";
    const view = makeView(doc, doc.length);
    const decos = collectDecos(view);
    const brs = decos.filter((d) => d.widgetKind === "html-break");
    expect(brs).toHaveLength(2);
    expect(brs[0]!.from).toBe(1);
    expect(brs[1]!.from).toBe(12);
    const { cursorSensitiveLines } = buildDecorations(view);
    expect(cursorSensitiveLines.has(1)).toBe(true);
    view.destroy();
  });

  it("cross-paragraph <sup> does not decorate", () => {
    const doc = "a<sup>b\n\nc</sup>d\n\nOTHER";
    const view = makeView(doc, doc.length - 1); // caret on OTHER
    const decos = collectDecos(view);
    expect(decos.some((d) => d.class === "cm-preview-sup")).toBe(false);
    expect(decos.some((d) => d.type === "replace" && d.from === 1 && d.to === 6)).toBe(false);
    expect(decos.some((d) => d.type === "replace" && d.from === 10 && d.to === 16)).toBe(false);
    view.destroy();
  });

  it("cross-heading <sup> does not decorate", () => {
    const doc = "a<sup>b\n# H\nc</sup>\n\nOTHER";
    const view = makeView(doc, doc.length - 1);
    const decos = collectDecos(view);
    expect(decos.some((d) => d.class === "cm-preview-sup")).toBe(false);
    expect(decos.some((d) => d.type === "replace" && d.from === 1 && d.to === 6)).toBe(false);
    expect(decos.some((d) => d.type === "replace" && d.from === 13 && d.to === 19)).toBe(false);
    view.destroy();
  });

  it("cross-list-item <sup> does not decorate", () => {
    const doc = "- x<sup>a\n- y</sup>\n\nOTHER";
    const view = makeView(doc, doc.length - 1);
    const decos = collectDecos(view);
    expect(decos.some((d) => d.class === "cm-preview-sup")).toBe(false);
    expect(decos.some((d) => d.type === "replace" && d.from === 3 && d.to === 8)).toBe(false);
    expect(decos.some((d) => d.type === "replace" && d.from === 13 && d.to === 19)).toBe(false);
    view.destroy();
  });

  it("same-paragraph soft-break <sup> still decorates", () => {
    const doc = "a<sup>b\nc</sup>d\n\nOTHER";
    const view = makeView(doc, doc.length - 1);
    const decos = collectDecos(view);
    expect(decos.some((d) => d.type === "replace" && d.from === 1 && d.to === 6)).toBe(true);
    expect(decos.some((d) => d.type === "replace" && d.from === 9 && d.to === 15)).toBe(true);
    const sup = decos.find((d) => d.class === "cm-preview-sup");
    expect(sup).toBeDefined();
    expect(sup!.from).toBe(6);
    expect(sup!.to).toBe(9);
    view.destroy();
  });

  it("blockquote-continued paragraph <sup> still decorates", () => {
    const doc = "> a<sup>b\n> c</sup>\n\nOTHER";
    const view = makeView(doc, doc.length - 1);
    const decos = collectDecos(view);
    expect(decos.some((d) => d.type === "replace" && d.from === 3 && d.to === 8)).toBe(true);
    expect(decos.some((d) => d.type === "replace" && d.from === 13 && d.to === 19)).toBe(true);
    const sup = decos.find((d) => d.class === "cm-preview-sup");
    expect(sup).toBeDefined();
    expect(sup!.from).toBe(8);
    expect(sup!.to).toBe(13);
    view.destroy();
  });

  it("nested sub stays raw when caret is in outer sup content only", () => {
    const doc = "<sup>a<sub>x</sub>b</sup>\n\nOTHER";
    const view = makeView(doc, 5); // caret on "a" (outer content, outside inner sub)
    const decos = collectDecos(view);
    expect(decos.some((d) => d.class === "cm-preview-sup")).toBe(false);
    expect(decos.some((d) => d.class === "cm-preview-sub")).toBe(false);
    expect(decos.filter((d) => d.type === "replace")).toHaveLength(0);
    view.destroy();
  });

  it("nested sub and outer both raw when caret is on inner content", () => {
    const doc = "<sup>a<sub>x</sub>b</sup>\n\nOTHER";
    const view = makeView(doc, 11); // caret on "x" (inner sub content)
    const decos = collectDecos(view);
    expect(decos.some((d) => d.class === "cm-preview-sup")).toBe(false);
    expect(decos.some((d) => d.class === "cm-preview-sub")).toBe(false);
    expect(decos.filter((d) => d.type === "replace")).toHaveLength(0);
    view.destroy();
  });

  it("nested sub and outer both decorate when caret is away", () => {
    const doc = "<sup>a<sub>x</sub>b</sup>\n\nOTHER";
    const view = makeView(doc, doc.length - 1); // caret on OTHER
    const decos = collectDecos(view);
    const sups = decos.filter((d) => d.class === "cm-preview-sup");
    expect(sups).toHaveLength(1);
    expect(sups[0]!.from).toBe(5);
    expect(sups[0]!.to).toBe(19);
    const subs = decos.filter((d) => d.class === "cm-preview-sub");
    expect(subs).toHaveLength(1);
    expect(subs[0]!.from).toBe(11);
    expect(subs[0]!.to).toBe(12);
    expect(decos.some((d) => d.type === "replace" && d.from === 0 && d.to === 5)).toBe(true);
    expect(decos.some((d) => d.type === "replace" && d.from === 19 && d.to === 25)).toBe(true);
    expect(decos.some((d) => d.type === "replace" && d.from === 6 && d.to === 11)).toBe(true);
    expect(decos.some((d) => d.type === "replace" && d.from === 12 && d.to === 18)).toBe(true);
    view.destroy();
  });

  it("br inside a caret-revealed sup stays raw", () => {
    const doc = "<sup>a<br>b</sup>\n\nOTHER";
    const view = makeView(doc, 5); // caret on "a" inside sup
    const decos = collectDecos(view);
    expect(decos.some((d) => d.widgetKind === "html-break")).toBe(false);
    expect(decos.some((d) => d.class === "cm-preview-sup")).toBe(false);
    expect(decos.filter((d) => d.type === "replace")).toHaveLength(0);
    view.destroy();
  });

  it("br inside sup still widgets when caret is away", () => {
    const doc = "<sup>a<br>b</sup>\n\nOTHER";
    const view = makeView(doc, doc.length - 1);
    const decos = collectDecos(view);
    const br = decos.find((d) => d.widgetKind === "html-break");
    expect(br).toBeDefined();
    expect(br!.from).toBe(6);
    expect(br!.to).toBe(10);
    expect(decos.some((d) => d.class === "cm-preview-sup")).toBe(true);
    view.destroy();
  });

  it("does not decorate HTMLTag inside table cells (block-replaced by table widget)", () => {
    const doc = "| a<br>b |\n| --- |\n| 1 |\n\nother";
    const view = makeView(doc, doc.length - 1);
    const { decorations } = buildDecorations(view);
    const iter = decorations.iter();
    let htmlBreakWidget = false;
    while (iter.value) {
      if (iter.value.spec.widget instanceof HtmlBreakWidget) htmlBreakWidget = true;
      iter.next();
    }
    expect(htmlBreakWidget).toBe(false);
    // Table lines must not be polluted by html-tag cursor sensitivity.
    const { cursorSensitiveLines } = buildDecorations(view);
    expect(cursorSensitiveLines.has(1)).toBe(false);
    expect(cursorSensitiveLines.has(2)).toBe(false);
    view.destroy();
  });
});

describe("collectHtmlInlineTags", () => {
  function makeState(doc: string): EditorState {
    return EditorState.create({
      doc,
      extensions: [markdown({ extensions: [GFM, WikiLink, MathExt, CommentExt, Footnote] })],
    });
  }

  it("returns both tags for a multi-line same-paragraph pair", () => {
    const state = makeState("a<sup>b\nc</sup>d");
    const tags = collectHtmlInlineTags(state);
    expect(tags).toHaveLength(2);
    expect(tags[0]!.raw).toBe("<sup>");
    expect(tags[0]!.from).toBe(1);
    expect(tags[1]!.raw).toBe("</sup>");
    expect(tags[1]!.from).toBe(9);
    expect(tags[0]!.parentFrom).toBe(tags[1]!.parentFrom);
    expect(tags[0]!.parentFrom).toBeGreaterThanOrEqual(0);
  });

  it("skips HTMLTag inside Table", () => {
    const state = makeState("| a<br>b |\n| --- |\n| 1 |\n\nother");
    const tags = collectHtmlInlineTags(state);
    expect(tags).toHaveLength(0);
  });

  it("is not limited to a half-document slice", () => {
    // Tags near the start and near the end must both be collected in one
    // call: pins the full-document walk (a viewport-clipped collect would
    // drop one end of a multi-line pair at the edge).
    const state = makeState("a<sup>b</sup>\n\n\n\n\n\n\n\n\n\nz<sub>w</sub>end");
    const tags = collectHtmlInlineTags(state);
    expect(tags).toHaveLength(4);
    expect(tags.some((t) => t.raw === "<sup>")).toBe(true);
    expect(tags.some((t) => t.raw === "</sup>")).toBe(true);
    expect(tags.some((t) => t.raw === "<sub>")).toBe(true);
    expect(tags.some((t) => t.raw === "</sub>")).toBe(true);
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

  it("bare [sic] line is NOT cursor-sensitive", () => {
    const doc = "This [sic] is text\nother";
    const view = makeView(doc, doc.length - 1);
    const { cursorSensitiveLines } = buildDecorations(view);
    expect(cursorSensitiveLines.has(1)).toBe(false);
    view.destroy();
  });

  it("[bar] with def elsewhere is NOT cursor-sensitive", () => {
    const doc = "[bar]: https://example.com\n\nSee [bar] here";
    const view = makeView(doc, doc.length - 1);
    const { cursorSensitiveLines } = buildDecorations(view);
    expect(cursorSensitiveLines.has(3)).toBe(false);
    view.destroy();
  });

  it("[@key] citation line is NOT cursor-sensitive", () => {
    const doc = "See [@key2024foo] here\nother";
    const view = makeView(doc, doc.length - 1);
    const { cursorSensitiveLines } = buildDecorations(view);
    expect(cursorSensitiveLines.has(1)).toBe(false);
    view.destroy();
  });

  it("[x](url) inline link line IS cursor-sensitive", () => {
    const doc = "Click [x](https://example.com) here\nother";
    const view = makeView(doc, doc.length - 1);
    const { cursorSensitiveLines } = buildDecorations(view);
    expect(cursorSensitiveLines.has(1)).toBe(true);
    view.destroy();
  });

  it("![alt](src) image line IS cursor-sensitive", () => {
    const doc = "See ![alt](img.png) here\nother";
    const view = makeView(doc, doc.length - 1);
    const { cursorSensitiveLines } = buildDecorations(view);
    expect(cursorSensitiveLines.has(1)).toBe(true);
    view.destroy();
  });

  it("**bold [sic]** line is still cursor-sensitive (from Emphasis)", () => {
    const doc = "**bold [sic]**\nother";
    const view = makeView(doc, doc.length - 1);
    const { cursorSensitiveLines } = buildDecorations(view);
    expect(cursorSensitiveLines.has(1)).toBe(true);
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

  it("keeps non-widget span with exact same bounds as widget", () => {
    // A mark that spans exactly the widget range is the wrapper for a sole
    // child (`## $E=mc^2$`, `**$d_1$**`): keep it so `inclusive` nests the
    // widget inside for style inheritance.
    const decos = [markDeco(0, 10), widgetDeco(0, 10)];
    decos.sort((a, b) => a.from - b.from || a.to - b.to);
    const result = filterContainedDecorations(decos);
    expect(result).toHaveLength(2);
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
    // bold mark [2,10] equals the widget range: kept as wrapper for the sole
    // child, so the math inherits bold weight
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
    expect(result).toHaveLength(4);
    expect(result.some((d) => d.from === 0 && d.to === 2)).toBe(true);
    expect(result.some((d) => d.deco.spec.widget && d.from === 2 && d.to === 10)).toBe(true);
    expect(
      result.some((d) => d.from === 2 && d.to === 10 && d.deco.spec.class === "test-mark"),
    ).toBe(true);
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

  it("integration: **![alt](img.png)** keeps bold mark wrapping the image widget", () => {
    const doc = "**![alt](img.png)**\n\nother";
    const view = makeView(doc, doc.length - 1);
    const decos = collectDecos(view);
    const imgWidget = decos.find((d) => d.widget && d.from === 2 && d.to === 17);
    expect(imgWidget).toBeDefined();
    const boldMark = decos.find((d) => d.class === "cm-preview-bold");
    expect(boldMark).toBeDefined();
    expect(boldMark!.from).toBe(2);
    expect(boldMark!.to).toBe(17);
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

  it("computes indent from defaultCharacterWidth", () => {
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

  it("does not call coordsAtPos during buildDecorations (would crash CM6 update cycle)", () => {
    const doc = "- Item\n\nother";
    const view = makeView(doc, doc.length - 1);
    const spy = vi.spyOn(view, "coordsAtPos");
    collectDecos(view);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
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

  it("ref widgets show source labels in document order (out-of-order numbers)", () => {
    const doc = "Claim A[^1], claim B[^3], claim C[^2].\n\n[^1]: First\n[^2]: Second\n[^3]: Third";
    const view = makeView(doc, doc.length - 1);
    const decos = collectDecos(view);
    const refs = decos
      .filter((d) => d.widgetKind === "footnote-ref")
      .sort((a, b) => a.from - b.from);
    expect(refs.map((r) => r.footnoteDisplayLabel)).toEqual(["1", "3", "2"]);
    view.destroy();
  });

  it("ref widgets show source labels, not first-reference order ([^b] then [^a])", () => {
    const doc = "See [^b] and [^a].\n\n[^a]: A\n[^b]: B";
    const view = makeView(doc, doc.length - 1);
    const decos = collectDecos(view);
    const refs = decos
      .filter((d) => d.widgetKind === "footnote-ref")
      .sort((a, b) => a.from - b.from);
    expect(refs).toHaveLength(2);
    expect(refs.map((r) => r.footnoteDisplayLabel)).toEqual(["b", "a"]);
    view.destroy();
  });

  it("named label displays as the label string", () => {
    const doc = "See [^note].\n\n[^note]: Note body";
    const view = makeView(doc, doc.length - 1);
    const decos = collectDecos(view);
    const refs = decos.filter((d) => d.widgetKind === "footnote-ref");
    expect(refs).toHaveLength(1);
    expect(refs[0]!.footnoteDisplayLabel).toBe("note");
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

  it("duplicate refs to one label both display the same label", () => {
    const doc = "See [^x] and [^x].\n\n[^x]: X def";
    const view = makeView(doc, doc.length - 1);
    const decos = collectDecos(view);
    const refs = decos
      .filter((d) => d.widgetKind === "footnote-ref")
      .sort((a, b) => a.from - b.from);
    expect(refs).toHaveLength(2);
    expect(refs.map((r) => r.footnoteDisplayLabel)).toEqual(["x", "x"]);
    view.destroy();
  });
});

describe("buildDecorations — footnote definitions", () => {
  it("replaces only the FootnoteDefMark with a label widget when caret is elsewhere", () => {
    const doc = "Text\n\n[^1]: Def text";
    const view = makeView(doc, 2); // caret on "Text", away from the def
    const decos = collectDecos(view);
    const mark = decos.find((d) => d.widgetKind === "footnote-def-mark");
    expect(mark).toBeDefined();
    // Mark + one trailing separator (6..12) is replaced, never the body.
    expect(mark!.from).toBe(6);
    expect(mark!.to).toBe(12);
    // No empty replace covering the body: nothing blanking mark.end..def.end.
    const blankBody = decos.find(
      (d) => d.type === "replace" && !d.widget && d.from >= 12,
    );
    expect(blankBody).toBeUndefined();
    // Line class on the def line while caret is outside.
    const lineDeco = decos.find((d) => d.class === "cm-footnote-def");
    expect(lineDeco).toBeDefined();
    expect(lineDeco!.from).toBe(6);
    expect(lineDeco!.to).toBe(6); // line decoration: from === to
    view.destroy();
  });

  it("extends mark replace through one trailing space after the colon (never the body)", () => {
    const doc = "Text\n\n[^1]: Def text";
    const view = makeView(doc, 2); // caret on "Text", away from the def
    const decos = collectDecos(view);
    const mark = decos.find((d) => d.widgetKind === "footnote-def-mark");
    expect(mark).toBeDefined();
    // GFM source is "[^1]:<space>body"; the separator is chrome, like the
    // heading/blockquote trailing space. Replace [6..12) = "[^1]: " only.
    expect(mark!.from).toBe(6);
    expect(mark!.to).toBe(12);
    // Body still untouched: nothing blanking from the body start onward.
    const blankBody = decos.find(
      (d) => d.type === "replace" && !d.widget && d.from >= 12,
    );
    expect(blankBody).toBeUndefined();
    view.destroy();
  });

  it("no separator: [^1]:body keeps the body abutting the colon", () => {
    const doc = "Text\n\n[^1]:body";
    const view = makeView(doc, 2);
    const decos = collectDecos(view);
    const mark = decos.find((d) => d.widgetKind === "footnote-def-mark");
    expect(mark).toBeDefined();
    // "b" at 11 is body text: replace must end at the mark end, not eat it.
    expect(mark!.from).toBe(6);
    expect(mark!.to).toBe(11);
    view.destroy();
  });

  it("empty body at EOL: replace ends at mark end, does not swallow the newline", () => {
    const doc = "Text\n\n[^1]:";
    const view = makeView(doc, 2);
    const decos = collectDecos(view);
    const mark = decos.find((d) => d.widgetKind === "footnote-def-mark");
    expect(mark).toBeDefined();
    expect(mark!.from).toBe(6);
    expect(mark!.to).toBe(11);
    view.destroy();
  });

  it("tab separator: consumes exactly one tab after the colon", () => {
    const doc = "Text\n\n[^1]:\tTabbed";
    const view = makeView(doc, 2);
    const decos = collectDecos(view);
    const mark = decos.find((d) => d.widgetKind === "footnote-def-mark");
    expect(mark).toBeDefined();
    expect(mark!.from).toBe(6);
    expect(mark!.to).toBe(12); // "[^1]:" + one tab; "Tabbed" stays body
    view.destroy();
  });

  it("shows raw marker and no line class when caret is on the def line", () => {
    const doc = "Text\n\n[^1]: Def text";
    const view = makeView(doc, 10); // caret on the def line
    const decos = collectDecos(view);
    expect(decos.some((d) => d.widgetKind === "footnote-def-mark")).toBe(false);
    expect(decos.some((d) => d.class === "cm-footnote-def")).toBe(false);
    view.destroy();
  });

  it("multi-line def: mark-only replace on first line, line class on each def line", () => {
    const doc = "Text\n\n[^1]: First line\n    Continuation";
    const view = makeView(doc, 2);
    const decos = collectDecos(view);
    const mark = decos.find((d) => d.widgetKind === "footnote-def-mark");
    expect(mark).toBeDefined();
    expect(mark!.from).toBe(6);
    expect(mark!.to).toBe(12);
    // Body and continuation are not blanked.
    const blankBody = decos.find(
      (d) => d.type === "replace" && !d.widget && d.from >= 12,
    );
    expect(blankBody).toBeUndefined();
    // One line class per def line (line 3 and line 4).
    const lineDecos = decos.filter((d) => d.class === "cm-footnote-def");
    expect(lineDecos).toHaveLength(2);
    expect(lineDecos[0]!.from).toBe(6);
    expect(lineDecos[1]!.from).toBe(23);
    view.destroy();
  });

  it("raw marker revealed when caret is on a continuation line of a multi-line def", () => {
    const doc = "Text\n\n[^1]: First line\n    Continuation";
    const view = makeView(doc, 30); // caret on the continuation line
    const decos = collectDecos(view);
    expect(decos.some((d) => d.widgetKind === "footnote-def-mark")).toBe(false);
    expect(decos.some((d) => d.class === "cm-footnote-def")).toBe(false);
    view.destroy();
  });

  it("multiple consecutive defs each get their own mark widget", () => {
    const doc = "Text\n\n[^1]: First\n[^2]: Second";
    const view = makeView(doc, 2);
    const decos = collectDecos(view);
    const marks = decos.filter((d) => d.widgetKind === "footnote-def-mark");
    expect(marks).toHaveLength(2);
    expect(marks[0]!.from).toBe(6);
    expect(marks[0]!.to).toBe(12);
    expect(marks[1]!.from).toBe(18);
    expect(marks[1]!.to).toBe(24);
    view.destroy();
  });

  it("def markers show source labels, not appearance order (same labels as refs)", () => {
    const doc = "See [^b] and [^a].\n\n[^a]: A\n[^b]: B";
    const view = makeView(doc, 0);
    const decos = collectDecos(view);
    const marks = decos.filter((d) => d.widgetKind === "footnote-def-mark");
    expect(marks).toHaveLength(2);
    const aMark = marks.find((d) => d.from === 20); // "[^a]:" at 20..25
    const bMark = marks.find((d) => d.from === 28); // "[^b]:" at 28..33
    expect(aMark!.footnoteDisplayLabel).toBe("a");
    expect(bMark!.footnoteDisplayLabel).toBe("b");
    view.destroy();
  });

  it("def marker for named label displays the label", () => {
    const doc = "See [^note].\n\n[^note]: Note body";
    const view = makeView(doc, 0);
    const decos = collectDecos(view);
    const marks = decos.filter((d) => d.widgetKind === "footnote-def-mark");
    expect(marks).toHaveLength(1);
    expect(marks[0]!.footnoteDisplayLabel).toBe("note");
    view.destroy();
  });

  it("orphan def (no ref) shows its source label, not a map-tail number", () => {
    const doc = "See [^a].\n\n[^a]: A\n[^b]: B";
    const view = makeView(doc, 0);
    const decos = collectDecos(view);
    const marks = decos.filter((d) => d.widgetKind === "footnote-def-mark");
    expect(marks).toHaveLength(2);
    const bMark = marks.find((d) => d.from === 19); // "[^b]:" at 19..24
    expect(bMark!.footnoteDisplayLabel).toBe("b");
    view.destroy();
  });

  it("buildBlockReplacements emits a body widget over the body span when caret is outside", () => {
    const doc = "Text\n\n[^1]: Def text";
    const view = makeView(doc, 2);
    const blockDecos = collectBlockDecos(view);
    const bodies = blockDecos.filter((d) => d.widgetKind === "footnote-def-body");
    expect(bodies).toHaveLength(1);
    // Widget covers only the body span (12..22), never the mark/separator.
    expect(bodies[0]!.from).toBe(12);
    expect(bodies[0]!.to).toBe(doc.length);
    expect(bodies[0]!.footnoteBodyText).toBe("Def text");
    // No empty full-def blank: no replace whose range equals the whole def
    // (6..22) and no widget-less replace blanking the body.
    expect(
      blockDecos.some(
        (d) => d.type === "replace" && !d.widget && d.from === 6 && d.to === doc.length,
      ),
    ).toBe(false);
    expect(blockDecos.some((d) => d.type === "replace" && !d.widget && d.from >= 12)).toBe(false);
    view.destroy();
  });

  it("buildBlockReplacements emits no body widget when caret is on the def line", () => {
    const doc = "Text\n\n[^1]: Def text";
    const view = makeView(doc, 10); // caret on the def line
    const blockDecos = collectBlockDecos(view);
    expect(blockDecos.some((d) => d.widgetKind === "footnote-def-body")).toBe(false);
    view.destroy();
  });

  it("buildBlockReplacements emits nothing for an empty def body", () => {
    const doc = "Text\n\n[^1]:";
    const view = makeView(doc, 2);
    const blockDecos = collectBlockDecos(view);
    expect(blockDecos).toHaveLength(0);
    view.destroy();
  });

  it("buildBlockReplacements emits no body widget for whitespace-only body", () => {
    const doc = "Text\n\n[^1]:   ";
    const view = makeView(doc, 2);
    const blockDecos = collectBlockDecos(view);
    expect(blockDecos.some((d) => d.widgetKind === "footnote-def-body")).toBe(false);
    view.destroy();
  });

  it("multi-line def: one body widget spanning both lines, raw indent kept in range", () => {
    const doc = "Text\n\n[^1]: First line\n    Continuation";
    const view = makeView(doc, 2);
    const blockDecos = collectBlockDecos(view);
    const bodies = blockDecos.filter((d) => d.widgetKind === "footnote-def-body");
    expect(bodies).toHaveLength(1);
    expect(bodies[0]!.from).toBe(12); // after "[^1]: "
    expect(bodies[0]!.to).toBe(doc.length); // through the continuation line
    expect(bodies[0]!.footnoteBodyText).toBe("First line\nContinuation");
    view.destroy();
  });

  it("multi-line def: no body widget when caret is on a continuation line", () => {
    const doc = "Text\n\n[^1]: First line\n    Continuation";
    const view = makeView(doc, 30); // caret on the continuation line
    const blockDecos = collectBlockDecos(view);
    expect(blockDecos.some((d) => d.widgetKind === "footnote-def-body")).toBe(false);
    view.destroy();
  });

  it("blank-separated continuation is covered by one body widget when caret outside", () => {
    const doc = "Text\n\n[^1]: Title\n\n    Body with **x**";
    const view = makeView(doc, 2);
    const bodies = collectBlockDecos(view).filter((d) => d.widgetKind === "footnote-def-body");
    expect(bodies).toHaveLength(1);
    expect(bodies[0]!.to).toBe(doc.length);
    expect(bodies[0]!.footnoteBodyText).toContain("Body with **x**");
    expect(bodies[0]!.footnoteBodyText).toContain("\n\n");
    view.destroy();
  });

  it("caret on post-blank continuation reveals raw (no body widget)", () => {
    const doc = "Text\n\n[^1]: Title\n\n    Body";
    const bodyPos = doc.indexOf("Body");
    const view = makeView(doc, bodyPos);
    expect(collectBlockDecos(view).some((d) => d.widgetKind === "footnote-def-body")).toBe(false);
    view.destroy();
  });

  it("two consecutive defs each get their own body widget", () => {
    const doc = "Text\n\n[^1]: First\n[^2]: Second";
    const view = makeView(doc, 2);
    const blockDecos = collectBlockDecos(view);
    const bodies = blockDecos.filter((d) => d.widgetKind === "footnote-def-body");
    expect(bodies).toHaveLength(2);
    expect(bodies[0]!.footnoteBodyText).toBe("First");
    expect(bodies[1]!.footnoteBodyText).toBe("Second");
    expect(bodies[0]!.from).toBe(12);
    expect(bodies[1]!.from).toBe(24);
    view.destroy();
  });

  it("block body widget coexists with the ViewPlugin mark widget and line class", () => {
    const doc = "Text\n\n[^1]: Def text";
    const view = makeView(doc, 2);
    const decos = collectDecos(view);
    const mark = decos.find((d) => d.widgetKind === "footnote-def-mark");
    expect(mark).toBeDefined();
    expect(mark!.from).toBe(6);
    expect(mark!.to).toBe(12);
    expect(decos.some((d) => d.class === "cm-footnote-def")).toBe(true);
    const blockDecos = collectBlockDecos(view);
    expect(blockDecos.some((d) => d.widgetKind === "footnote-def-body")).toBe(true);
    view.destroy();
  });

  it("caret enter/leave rebuilds: cursorSensitiveRanges cover the full def span", () => {
    const doc = "Text\n\n[^1]: First line\n    Continuation";
    const view = makeView(doc, 2);
    const blockState = buildBlockReplacements(view.state);
    const ranges = blockState.cursorSensitiveRanges;
    expect(
      ranges.some((r) => r.fromLine === 3 && r.toLine === 4),
    ).toBe(true);
    view.destroy();
  });

  it("single-line def body is still emitted from the block field (StateField path)", () => {
    const doc = "Text\n\n[^1]: **x** and $y$";
    const view = makeView(doc, 2);
    const blockDecos = collectBlockDecos(view);
    const bodies = blockDecos.filter((d) => d.widgetKind === "footnote-def-body");
    expect(bodies).toHaveLength(1);
    expect(bodies[0]!.footnoteBodyText).toBe("**x** and $y$");
    view.destroy();
  });

  it("keeps ref widget and tooltip-relevant body intact (smoke)", () => {
    const doc = "See [^1] here.\n\n[^1]: Def text";
    const view = makeView(doc, 0); // caret on first line, away from def
    const decos = collectDecos(view);
    const ref = decos.find((d) => d.widget && d.from === 4 && d.to === 8);
    expect(ref).toBeDefined();
    const defMark = decos.find((d) => d.widgetKind === "footnote-def-mark");
    expect(defMark).toBeDefined();
    expect(defMark!.from).toBe(16);
    expect(defMark!.to).toBe(22);
    view.destroy();
  });

  it("body widget receives targetRefPos = the matching ref start", () => {
    const doc = "See [^1].\n\n[^1]: Hello";
    const view = makeView(doc, 0); // caret on "See"
    const bodies = collectBlockDecos(view).filter((d) => d.widgetKind === "footnote-def-body");
    expect(bodies).toHaveLength(1);
    expect(bodies[0]!.footnoteTargetRefPos).toBe(doc.indexOf("[^1]"));
    view.destroy();
  });

  it("body widget targetRefPos is null when there is no ref", () => {
    const doc = "Text\n\n[^1]: Orphan def";
    const view = makeView(doc, 2);
    const bodies = collectBlockDecos(view).filter((d) => d.widgetKind === "footnote-def-body");
    expect(bodies).toHaveLength(1);
    expect(bodies[0]!.footnoteTargetRefPos).toBeNull();
    view.destroy();
  });

  it("body widget targets the FIRST ref when the label repeats", () => {
    const doc = "See [^x] and again [^x].\n\n[^x]: X def";
    const view = makeView(doc, 0);
    const bodies = collectBlockDecos(view).filter((d) => d.widgetKind === "footnote-def-body");
    expect(bodies).toHaveLength(1);
    expect(bodies[0]!.footnoteTargetRefPos).toBe(doc.indexOf("[^x]"));
    view.destroy();
  });

  it("multi-line body still gets one body widget with targetRefPos", () => {
    const doc = "See [^1].\n\n[^1]: First line\n    Continuation";
    const view = makeView(doc, 0);
    const bodies = collectBlockDecos(view).filter((d) => d.widgetKind === "footnote-def-body");
    expect(bodies).toHaveLength(1);
    expect(bodies[0]!.footnoteTargetRefPos).toBe(doc.indexOf("[^1]"));
    view.destroy();
  });

  it("non-empty body + ref: mark widget carries no backref (body owns it)", () => {
    const doc = "See [^1].\n\n[^1]: Hello";
    const view = makeView(doc, 0);
    const marks = collectDecos(view).filter((d) => d.widgetKind === "footnote-def-mark");
    expect(marks).toHaveLength(1);
    expect(marks[0]!.footnoteTargetRefPos).toBeNull();
    view.destroy();
  });

  it("empty body with a ref: mark widget gets the backref (target = ref from)", () => {
    const doc = "See [^1].\n\n[^1]:";
    const view = makeView(doc, 0);
    const marks = collectDecos(view).filter((d) => d.widgetKind === "footnote-def-mark");
    expect(marks).toHaveLength(1);
    expect(marks[0]!.footnoteTargetRefPos).toBe(doc.indexOf("[^1]"));
    view.destroy();
  });

  it("whitespace-only body with a ref: mark widget gets the backref", () => {
    const doc = "See [^1].\n\n[^1]:   ";
    const view = makeView(doc, 0);
    const marks = collectDecos(view).filter((d) => d.widgetKind === "footnote-def-mark");
    expect(marks).toHaveLength(1);
    expect(marks[0]!.footnoteTargetRefPos).toBe(doc.indexOf("[^1]"));
    view.destroy();
  });

  it("empty body with no ref: mark widget carries no backref", () => {
    const doc = "Text\n\n[^1]:";
    const view = makeView(doc, 0);
    const marks = collectDecos(view).filter((d) => d.widgetKind === "footnote-def-mark");
    expect(marks).toHaveLength(1);
    expect(marks[0]!.footnoteTargetRefPos).toBeNull();
    view.destroy();
  });
});
