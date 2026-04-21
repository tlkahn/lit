import { describe, it, expect, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { GFM } from "@lezer/markdown";
import { buildDecorations } from "./decorations";
import { WikiLink } from "../markdown/wikilink";
import { Math as MathExt } from "../markdown/math";
import { calloutFoldField } from "./callout";

vi.mock("katex", () => ({
  default: {
    render: vi.fn((tex: string, el: HTMLElement) => {
      el.textContent = tex;
    }),
  },
}));

vi.mock("katex/dist/katex.min.css", () => ({}));

function makeView(doc: string, cursor: number): EditorView {
  const state = EditorState.create({
    doc,
    selection: { anchor: cursor },
    extensions: [
      markdown({ extensions: [GFM, WikiLink, MathExt] }),
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

  it("does not hide markers when cursor is on same line", () => {
    const view = makeView("**bold** text", 3); // cursor within bold
    const decos = collectDecos(view);
    expect(decos).toHaveLength(0);
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

  it("reveals full syntax when cursor is on same line", () => {
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

  it("shows raw syntax when cursor is on image line", () => {
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
    // Code content marked
    const codeMark = decos.find((d) => d.class === "cm-preview-code-block");
    expect(codeMark).toBeDefined();
    expect(codeMark!.from).toBe(6);
    expect(codeMark!.to).toBe(10);
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

  it("shows raw syntax when cursor is on wikilink line", () => {
    const view = makeView("[[Page Name]]", 5);
    const decos = collectDecos(view);
    const wlDecos = decos.filter(
      (d) => d.class === "cm-preview-wikilink" || (d.type === "replace" && d.from <= 13),
    );
    expect(wlDecos).toHaveLength(0);
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

  it("shows raw syntax when cursor is on callout", () => {
    const view = makeView("> [!note]\n> Content", 5);
    const decos = collectDecos(view);
    const calloutDecos = decos.filter(
      (d) => d.class?.includes("cm-callout") || (d.widget && d.from === 0),
    );
    expect(calloutDecos).toHaveLength(0);
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

  it("shows raw $...$ when cursor is on line", () => {
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
    const decos = collectDecos(view);
    const mathWidget = decos.find((d) => d.widget && d.from === 0);
    expect(mathWidget).toBeDefined();
    view.destroy();
  });

  it("shows raw $$...$$ when cursor is on any line of block", () => {
    const view = makeView("$$\nx^2\n$$", 4);
    const decos = collectDecos(view);
    expect(decos).toHaveLength(0);
    view.destroy();
  });
});
