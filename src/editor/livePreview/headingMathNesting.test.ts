import { describe, it, expect, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import { GFM } from "@lezer/markdown";
import { livePreviewPlugin, blockReplacementField } from "./plugin";
import { livePreviewBaseTheme } from "./theme";
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

function makeView(doc: string, cursor = 0): EditorView {
  const state = EditorState.create({
    doc,
    selection: { anchor: cursor },
    extensions: [
      markdown({ extensions: [GFM, WikiLink, MathExt, CommentExt] }),
      calloutFoldField,
      livePreviewPlugin,
      blockReplacementField,
      livePreviewBaseTheme,
    ],
  });
  const view = new EditorView({ state, parent: document.createElement("div") });
  document.body.appendChild(view.dom);
  ensureSyntaxTree(view.state, view.state.doc.length);
  return view;
}

describe("emphasis inline math DOM nesting", () => {
  it("nests start-aligned inline math inside the bold mark DOM", () => {
    const doc = "**$d_1$ is standardized, drift-adjusted log-moneyness.**\n\nbody";
    const view = makeView(doc, doc.length - 1);
    const line = [...view.dom.querySelectorAll(".cm-line")].find((l) =>
      l.querySelector(".cm-preview-bold"),
    )!;
    const math = line.querySelector(".cm-preview-math-inline");
    expect(math).not.toBeNull();
    expect(math!.closest(".cm-preview-bold")).not.toBeNull();
    view.dom.remove();
    view.destroy();
  });

  it("nests start-aligned inline math inside the italic mark DOM", () => {
    const doc = "*$x$ after*\n\nbody";
    const view = makeView(doc, doc.length - 1);
    const line = [...view.dom.querySelectorAll(".cm-line")].find((l) =>
      l.querySelector(".cm-preview-italic"),
    )!;
    const math = line.querySelector(".cm-preview-math-inline");
    expect(math).not.toBeNull();
    expect(math!.closest(".cm-preview-italic")).not.toBeNull();
    view.dom.remove();
    view.destroy();
  });

  it("nests end-aligned inline math inside the bold mark DOM", () => {
    const doc = "**text ends with $d_1$**\n\nbody";
    const view = makeView(doc, doc.length - 1);
    const line = [...view.dom.querySelectorAll(".cm-line")].find((l) =>
      l.querySelector(".cm-preview-bold"),
    )!;
    const math = line.querySelector(".cm-preview-math-inline");
    expect(math).not.toBeNull();
    expect(math!.closest(".cm-preview-bold")).not.toBeNull();
    view.dom.remove();
    view.destroy();
  });

  it("nests a sole inline math that spans the whole bold content", () => {
    const doc = "**$d_1$**\n\nbody";
    const view = makeView(doc, doc.length - 1);
    const line = [...view.dom.querySelectorAll(".cm-line")].find((l) =>
      l.querySelector(".cm-preview-math-inline"),
    )!;
    const math = line.querySelector(".cm-preview-math-inline")!;
    expect(math.closest(".cm-preview-bold")).not.toBeNull();
    view.dom.remove();
    view.destroy();
  });

  it("keeps interior inline maths nested inside the bold mark", () => {
    const doc = "**before $d_1$ after**\n\nbody";
    const view = makeView(doc, doc.length - 1);
    const line = [...view.dom.querySelectorAll(".cm-line")].find((l) =>
      l.querySelector(".cm-preview-bold"),
    )!;
    const math = line.querySelector(".cm-preview-math-inline");
    expect(math).not.toBeNull();
    expect(math!.closest(".cm-preview-bold")).not.toBeNull();
    view.dom.remove();
    view.destroy();
  });
});

describe("strikethrough inline math DOM nesting", () => {
  it("nests inline math inside the strikethrough mark DOM", () => {
    const doc = "~~before $x$ after~~\n\nbody";
    const view = makeView(doc, doc.length - 1);
    const line = [...view.dom.querySelectorAll(".cm-line")].find((l) =>
      l.querySelector(".cm-preview-strikethrough"),
    )!;
    const math = line.querySelector(".cm-preview-math-inline");
    expect(math).not.toBeNull();
    expect(math!.closest(".cm-preview-strikethrough")).not.toBeNull();
    view.dom.remove();
    view.destroy();
  });

  it("nests a sole inline math that spans the whole strikethrough content", () => {
    const doc = "~~$x$~~\n\nbody";
    const view = makeView(doc, doc.length - 1);
    const line = [...view.dom.querySelectorAll(".cm-line")].find((l) =>
      l.querySelector(".cm-preview-math-inline"),
    )!;
    const math = line.querySelector(".cm-preview-math-inline")!;
    expect(math.closest(".cm-preview-strikethrough")).not.toBeNull();
    view.dom.remove();
    view.destroy();
  });
});

describe("heading inline math DOM nesting", () => {
  it("nests trailing inline math widget inside the heading mark DOM", () => {
    const doc = "# The intuitive meaning of $d_1$\n\nbody";
    const view = makeView(doc, doc.length - 1); // cursor on body
    const line = view.dom.querySelector(".cm-line")!;
    const math = line.querySelector(".cm-preview-math-inline");
    expect(math).not.toBeNull();
    expect(math!.closest(".cm-preview-h1")).not.toBeNull();
    view.dom.remove();
    view.destroy();
  });

  it("nests every inline math on a heading line inside the same heading mark", () => {
    const doc = "## Concrete example: $S=120$, $K=100$\n\nbody";
    const view = makeView(doc, doc.length - 1);
    const line = [...view.dom.querySelectorAll(".cm-line")].find((l) =>
      l.querySelector(".cm-preview-h2"),
    )!;
    const maths = [...line.querySelectorAll(".cm-preview-math-inline")];
    expect(maths).toHaveLength(2);
    const marks = new Set(maths.map((m) => m.closest(".cm-preview-h2")));
    expect(marks.size).toBe(1);
    expect([...marks][0]).not.toBeNull();
    view.dom.remove();
    view.destroy();
  });

  it("keeps interior inline maths nested inside the heading mark", () => {
    const doc = "## before $A$ middle $B$ after\n\nbody";
    const view = makeView(doc, doc.length - 1);
    const line = [...view.dom.querySelectorAll(".cm-line")].find((l) =>
      l.querySelector(".cm-preview-h2"),
    )!;
    const maths = [...line.querySelectorAll(".cm-preview-math-inline")];
    expect(maths).toHaveLength(2);
    for (const m of maths) {
      expect(m.closest(".cm-preview-h2")).not.toBeNull();
    }
    view.dom.remove();
    view.destroy();
  });

  it("does not place body inline math inside a heading mark", () => {
    const doc = "# Title $t$\n\nbody $x$ more";
    const view = makeView(doc, doc.indexOf("more"));
    const bodyLine = [...view.dom.querySelectorAll(".cm-line")].find((l) =>
      l.textContent?.includes("body"),
    )!;
    const math = bodyLine.querySelector(".cm-preview-math-inline");
    expect(math).not.toBeNull();
    expect(math!.closest("[class*='cm-preview-h']")).toBeNull();
    view.dom.remove();
    view.destroy();
  });

  it("nests start-aligned inline math inside the heading mark DOM", () => {
    const doc = "## $d_1$ and $d_2$: the twin z-scores\n\nbody";
    const view = makeView(doc, doc.length - 1);
    const line = [...view.dom.querySelectorAll(".cm-line")].find((l) =>
      l.querySelector(".cm-preview-h2"),
    )!;
    const maths = [...line.querySelectorAll(".cm-preview-math-inline")];
    expect(maths).toHaveLength(2);
    for (const m of maths) {
      expect(m.closest(".cm-preview-h2")).not.toBeNull();
    }
    view.dom.remove();
    view.destroy();
  });

  it("nests a sole inline math that spans the whole heading content", () => {
    const doc = "## $E=mc^2$\n\nbody";
    const view = makeView(doc, doc.length - 1);
    const line = [...view.dom.querySelectorAll(".cm-line")].find((l) =>
      l.querySelector(".cm-preview-math-inline"),
    )!;
    const math = line.querySelector(".cm-preview-math-inline")!;
    expect(math.closest(".cm-preview-h2")).not.toBeNull();
    view.dom.remove();
    view.destroy();
  });

  it("nests a start-aligned image widget inside the heading mark", () => {
    const doc = "# ![img](x.png) title\n\nbody";
    const view = makeView(doc, doc.length - 1);
    const line = [...view.dom.querySelectorAll(".cm-line")].find((l) =>
      l.querySelector(".cm-preview-h1"),
    )!;
    const img = line.querySelector(".cm-preview-image, .cm-preview-image-thumbnail");
    expect(img).not.toBeNull();
    expect(img!.closest(".cm-preview-h1")).not.toBeNull();
    view.dom.remove();
    view.destroy();
  });

  it("nests a trailing image widget inside the heading mark", () => {
    const doc = "# title ![img](x.png)\n\nbody";
    const view = makeView(doc, doc.length - 1);
    const line = [...view.dom.querySelectorAll(".cm-line")].find((l) =>
      l.querySelector(".cm-preview-h1"),
    )!;
    const img = line.querySelector(".cm-preview-image, .cm-preview-image-thumbnail");
    expect(img).not.toBeNull();
    expect(img!.closest(".cm-preview-h1")).not.toBeNull();
    view.dom.remove();
    view.destroy();
  });
});

describe("link inline math DOM nesting", () => {
  it("nests a sole inline math that spans the whole link label", () => {
    const doc = "[$d_1$](http://example.com)\n\nbody";
    const view = makeView(doc, doc.length - 1);
    const line = [...view.dom.querySelectorAll(".cm-line")].find((l) =>
      l.querySelector(".cm-preview-math-inline"),
    )!;
    const math = line.querySelector(".cm-preview-math-inline")!;
    expect(math.closest(".cm-preview-link")).not.toBeNull();
    view.dom.remove();
    view.destroy();
  });

  it("nests start-aligned inline math inside the link mark DOM", () => {
    const doc = "[$d_1$ and more](http://example.com)\n\nbody";
    const view = makeView(doc, doc.length - 1);
    const line = [...view.dom.querySelectorAll(".cm-line")].find((l) =>
      l.querySelector(".cm-preview-link"),
    )!;
    const math = line.querySelector(".cm-preview-math-inline");
    expect(math).not.toBeNull();
    expect(math!.closest(".cm-preview-link")).not.toBeNull();
    view.dom.remove();
    view.destroy();
  });

  it("nests end-aligned inline math inside the link mark DOM", () => {
    const doc = "[text $d_1$](http://example.com)\n\nbody";
    const view = makeView(doc, doc.length - 1);
    const line = [...view.dom.querySelectorAll(".cm-line")].find((l) =>
      l.querySelector(".cm-preview-link"),
    )!;
    const math = line.querySelector(".cm-preview-math-inline");
    expect(math).not.toBeNull();
    expect(math!.closest(".cm-preview-link")).not.toBeNull();
    view.dom.remove();
    view.destroy();
  });
});
