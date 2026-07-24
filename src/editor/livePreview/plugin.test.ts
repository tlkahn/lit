import { describe, it, expect, vi } from "vitest";
import { Compartment, EditorState, StateEffect } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { ensureSyntaxTree, syntaxTree, forceParsing } from "@codemirror/language";
import { GFM } from "@lezer/markdown";
import { livePreviewPlugin, blockReplacementField } from "./plugin";
import { WikiLink } from "../markdown/wikilink";
import { Math as MathExt } from "../markdown/math";
import { Comment as CommentExt } from "../markdown/comment";
import { calloutFoldField, toggleCalloutEffect } from "./callout";
import { imageResolverFacet } from "./imageResolver";
import { mediaThumbnailsFacet } from "./mediaThumbnails";
import type { BlockReplacementState } from "./decorations";

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

const flushTree = StateEffect.define<null>();

function makeView(doc: string, cursor = 0): EditorView {
  const state = EditorState.create({
    doc,
    selection: { anchor: cursor },
    extensions: [
      markdown({ extensions: [GFM, WikiLink, MathExt, CommentExt] }),
      calloutFoldField,
      livePreviewPlugin,
      blockReplacementField,
    ],
  });
  const view = new EditorView({ state, parent: document.createElement("div") });
  // Force full tree parse and rebuild state fields so block ranges are populated
  ensureSyntaxTree(view.state, view.state.doc.length);
  view.dispatch({ effects: flushTree.of(null) });
  return view;
}

function getBlockState(view: EditorView): BlockReplacementState {
  return view.state.field(blockReplacementField);
}

describe("livePreviewPlugin", () => {
  it("instantiates with EditorView", () => {
    const view = makeView("## Hello\n\nbody", 12);
    expect(view.plugin(livePreviewPlugin)).toBeDefined();
    view.destroy();
  });

  it("updates decorations on doc change", () => {
    const view = makeView("some text", 0);
    const pluginBefore = view.plugin(livePreviewPlugin)!;
    const decosBefore = pluginBefore.decorations;

    view.dispatch({ changes: { from: 0, to: 9, insert: "## Heading\n\nbody" } });
    view.dispatch({ selection: { anchor: 15 } });

    const pluginAfter = view.plugin(livePreviewPlugin)!;
    const decosAfter = pluginAfter.decorations;
    expect(decosAfter).not.toBe(decosBefore);
    view.destroy();
  });

  it("updates decorations on selection change", () => {
    const doc = "## Heading\n\nbody";
    const view = makeView(doc, doc.length - 1);
    const pluginBefore = view.plugin(livePreviewPlugin)!;
    const decosBefore = pluginBefore.decorations;

    view.dispatch({ selection: { anchor: 5 } });

    const pluginAfter = view.plugin(livePreviewPlugin)!;
    const decosAfter = pluginAfter.decorations;
    expect(decosAfter).not.toBe(decosBefore);
    view.destroy();
  });
});

describe("blockReplacementField — skip logic", () => {
  it("skips rebuild when cursor moves between non-block lines (object identity)", () => {
    const doc = "line one\nline two\nline three";
    const view = makeView(doc, 0);
    const before = getBlockState(view);

    view.dispatch({ selection: { anchor: 14 } });
    const after = getBlockState(view);

    expect(after).toBe(before);
    view.destroy();
  });

  it("skips rebuild when cursor moves within same block element", () => {
    const doc = "$$\nx^2 + y^2\nz^3\n$$\n\nother";
    const view = makeView(doc, 3);
    const before = getBlockState(view);

    view.dispatch({ selection: { anchor: 13 } });
    const after = getBlockState(view);

    expect(after).toBe(before);
    view.destroy();
  });

  it("rebuilds when cursor moves from non-block to block line", () => {
    const doc = "plain\n\n$$\nx^2\n$$\n\nother";
    const view = makeView(doc, doc.length - 1);
    const before = getBlockState(view);

    view.dispatch({ selection: { anchor: 9 } });
    const after = getBlockState(view);

    expect(after).not.toBe(before);
    view.destroy();
  });

  it("rebuilds when cursor moves from block to non-block line", () => {
    const doc = "plain\n\n$$\nx^2\n$$\n\nother";
    const view = makeView(doc, 9);
    const before = getBlockState(view);

    view.dispatch({ selection: { anchor: doc.length - 1 } });
    const after = getBlockState(view);

    expect(after).not.toBe(before);
    view.destroy();
  });

  it("rebuilds when cursor moves between different blocks", () => {
    const doc = "$$\na\n$$\n\n%%\nb\n%%\n\nother";
    const view = makeView(doc, 3);
    const before = getBlockState(view);

    view.dispatch({ selection: { anchor: 12 } });
    const after = getBlockState(view);

    expect(after).not.toBe(before);
    view.destroy();
  });

  it("always rebuilds on docChanged", () => {
    const doc = "line one\nline two";
    const view = makeView(doc, 0);
    const before = getBlockState(view);

    view.dispatch({ changes: { from: doc.length, insert: "\nx" } });
    const after = getBlockState(view);

    expect(after).not.toBe(before);
    view.destroy();
  });

  it("always rebuilds on effects", () => {
    const doc = "line one\nline two";
    const view = makeView(doc, 0);
    const before = getBlockState(view);

    const dummyEffect = StateEffect.define<null>();
    view.dispatch({ effects: [dummyEffect.of(null)] });
    const after = getBlockState(view);

    expect(after).not.toBe(before);
    view.destroy();
  });

  it("skips rebuild on same-line cursor movement", () => {
    const doc = "hello world\nline two";
    const view = makeView(doc, 0);
    const before = getBlockState(view);

    view.dispatch({ selection: { anchor: 5 } });
    const after = getBlockState(view);

    expect(after).toBe(before);
    view.destroy();
  });

  it("cursorSensitiveRanges includes callouts, math, comments, mermaid but not tables or plain blockquotes", () => {
    const doc = [
      "> [!note]",
      "> callout body",
      "",
      "> plain quote",
      "",
      "$$",
      "x^2",
      "$$",
      "",
      "%%",
      "block comment",
      "%%",
      "",
      "```mermaid",
      "graph LR; A-->B",
      "```",
      "",
      "| a | b |",
      "| --- | --- |",
      "| 1 | 2 |",
      "",
      "plain text",
    ].join("\n");

    const view = makeView(doc, doc.length - 1);
    const state = getBlockState(view);
    const ranges = state.cursorSensitiveRanges;

    const calloutLine = 1;
    const mathLine = 6;
    const commentLine = 10;
    const mermaidLine = 14;

    expect(ranges.some(r => r.fromLine <= calloutLine && r.toLine >= calloutLine)).toBe(true);
    expect(ranges.some(r => r.fromLine <= mathLine && r.toLine >= mathLine)).toBe(true);
    expect(ranges.some(r => r.fromLine <= commentLine && r.toLine >= commentLine)).toBe(true);
    expect(ranges.some(r => r.fromLine <= mermaidLine && r.toLine >= mermaidLine)).toBe(true);

    const tableLine = 18;
    expect(ranges.some(r => r.fromLine <= tableLine && r.toLine >= tableLine)).toBe(false);

    const plainQuoteLine = 4;
    expect(ranges.some(r => r.fromLine === plainQuoteLine && r.toLine === plainQuoteLine)).toBe(false);

    view.destroy();
  });
});

describe("livePreviewPlugin — effect filtering", () => {
  it("skips rebuild on unrelated effect", () => {
    const view = makeView("## Heading\n\nbody", 14);
    const decosBefore = view.plugin(livePreviewPlugin)!.decorations;

    const unrelated = StateEffect.define<null>();
    view.dispatch({ effects: [unrelated.of(null)] });
    const decosAfter = view.plugin(livePreviewPlugin)!.decorations;

    expect(decosAfter).toBe(decosBefore);
    view.destroy();
  });

  it("rebuilds on toggleCalloutEffect", () => {
    const doc = "> [!note]\n> Content\n\nother";
    const view = makeView(doc, doc.length - 1);
    const decosBefore = view.plugin(livePreviewPlugin)!.decorations;

    view.dispatch({ effects: [toggleCalloutEffect.of({ pos: 0 })] });
    const decosAfter = view.plugin(livePreviewPlugin)!.decorations;

    expect(decosAfter).not.toBe(decosBefore);
    view.destroy();
  });

  it("rebuilds on imageResolverFacet change", () => {
    const compartment = new Compartment();
    const state = EditorState.create({
      doc: "![alt](img.png)\n\nother",
      selection: { anchor: 19 },
      extensions: [
        markdown({ extensions: [GFM, WikiLink, MathExt, CommentExt] }),
        calloutFoldField,
        compartment.of(imageResolverFacet.of((src) => [src])),
        livePreviewPlugin,
        blockReplacementField,
      ],
    });
    const view = new EditorView({ state, parent: document.createElement("div") });
    const decosBefore = view.plugin(livePreviewPlugin)!.decorations;

    view.dispatch({ effects: compartment.reconfigure(imageResolverFacet.of((src) => [`/resolved/${src}`])) });
    const decosAfter = view.plugin(livePreviewPlugin)!.decorations;

    expect(decosAfter).not.toBe(decosBefore);
    view.destroy();
  });

  it("rebuilds on mediaThumbnailsFacet change", () => {
    const compartment = new Compartment();
    const state = EditorState.create({
      doc: "![alt](img.png)\n\nother",
      selection: { anchor: 19 },
      extensions: [
        markdown({ extensions: [GFM, WikiLink, MathExt, CommentExt] }),
        calloutFoldField,
        compartment.of(mediaThumbnailsFacet.of(true)),
        livePreviewPlugin,
        blockReplacementField,
      ],
    });
    const view = new EditorView({ state, parent: document.createElement("div") });
    const decosBefore = view.plugin(livePreviewPlugin)!.decorations;

    view.dispatch({ effects: compartment.reconfigure(mediaThumbnailsFacet.of(false)) });
    const decosAfter = view.plugin(livePreviewPlugin)!.decorations;

    expect(decosAfter).not.toBe(decosBefore);
    view.destroy();
  });

  it("rebuilds when relevant + irrelevant effects in same transaction", () => {
    const doc = "> [!note]\n> Content\n\nother";
    const view = makeView(doc, doc.length - 1);
    const decosBefore = view.plugin(livePreviewPlugin)!.decorations;

    const unrelated = StateEffect.define<null>();
    view.dispatch({ effects: [unrelated.of(null), toggleCalloutEffect.of({ pos: 0 })] });
    const decosAfter = view.plugin(livePreviewPlugin)!.decorations;

    expect(decosAfter).not.toBe(decosBefore);
    view.destroy();
  });

  it("skips rebuild on multiple unrelated effects", () => {
    const view = makeView("## Heading\n\nbody", 14);
    const decosBefore = view.plugin(livePreviewPlugin)!.decorations;

    const unrelated1 = StateEffect.define<null>();
    const unrelated2 = StateEffect.define<string>();
    view.dispatch({ effects: [unrelated1.of(null), unrelated2.of("x")] });
    const decosAfter = view.plugin(livePreviewPlugin)!.decorations;

    expect(decosAfter).toBe(decosBefore);
    view.destroy();
  });
});

describe("livePreviewPlugin - treeChanged rebuild", () => {
  it("rebuilds decorations when syntax tree advances via forceParsing", () => {
    const filler = Array.from({ length: 500 }, (_, i) => `filler line ${i}`).join("\n");
    const doc = `[sic] at top\n\n${filler}\n\ntrailing text`;
    const state = EditorState.create({
      doc,
      selection: { anchor: 0 },
      extensions: [
        markdown({ extensions: [GFM, WikiLink, MathExt, CommentExt] }),
        calloutFoldField,
        livePreviewPlugin,
        blockReplacementField,
      ],
    });
    const view = new EditorView({ state, parent: document.createElement("div") });

    const treeBefore = syntaxTree(view.state);
    const decosBefore = view.plugin(livePreviewPlugin)!.decorations;

    forceParsing(view, view.state.doc.length, 60000);
    const treeAfter = syntaxTree(view.state);

    if (treeBefore !== treeAfter) {
      const decosAfter = view.plugin(livePreviewPlugin)!.decorations;
      expect(decosAfter).not.toBe(decosBefore);
    }
    view.destroy();
  });
});

describe("livePreviewPlugin — selection smart-skip", () => {
  it("skips rebuild between two plain-text lines", () => {
    const view = makeView("line one\nline two\nline three", 0);
    const decosBefore = view.plugin(livePreviewPlugin)!.decorations;

    view.dispatch({ selection: { anchor: 14 } });
    const decosAfter = view.plugin(livePreviewPlugin)!.decorations;

    expect(decosAfter).toBe(decosBefore);
    view.destroy();
  });

  it("rebuilds when cursor moves to heading line", () => {
    const doc = "body text\n## Heading";
    const view = makeView(doc, 0);
    const decosBefore = view.plugin(livePreviewPlugin)!.decorations;

    view.dispatch({ selection: { anchor: 15 } });
    const decosAfter = view.plugin(livePreviewPlugin)!.decorations;

    expect(decosAfter).not.toBe(decosBefore);
    view.destroy();
  });

  it("rebuilds when cursor leaves heading line", () => {
    const doc = "## Heading\nbody text";
    const view = makeView(doc, 5);
    const decosBefore = view.plugin(livePreviewPlugin)!.decorations;

    view.dispatch({ selection: { anchor: 15 } });
    const decosAfter = view.plugin(livePreviewPlugin)!.decorations;

    expect(decosAfter).not.toBe(decosBefore);
    view.destroy();
  });

  it("skips same-line move on plain text", () => {
    const view = makeView("hello world\nother", 0);
    const decosBefore = view.plugin(livePreviewPlugin)!.decorations;

    view.dispatch({ selection: { anchor: 5 } });
    const decosAfter = view.plugin(livePreviewPlugin)!.decorations;

    expect(decosAfter).toBe(decosBefore);
    view.destroy();
  });

  it("rebuilds same-line move on line with formatting", () => {
    const doc = "**bold** text\nother";
    const view = makeView(doc, 10);
    const decosBefore = view.plugin(livePreviewPlugin)!.decorations;

    view.dispatch({ selection: { anchor: 3 } });
    const decosAfter = view.plugin(livePreviewPlugin)!.decorations;

    expect(decosAfter).not.toBe(decosBefore);
    view.destroy();
  });

  it("rebuilds between two different sensitive lines", () => {
    const doc = "## Heading One\n## Heading Two";
    const view = makeView(doc, 5);
    const decosBefore = view.plugin(livePreviewPlugin)!.decorations;

    view.dispatch({ selection: { anchor: 20 } });
    const decosAfter = view.plugin(livePreviewPlugin)!.decorations;

    expect(decosAfter).not.toBe(decosBefore);
    view.destroy();
  });

  it("docChanged always rebuilds", () => {
    const doc = "## Heading\n\nbody";
    const view = makeView(doc, doc.length);
    const decosBefore = view.plugin(livePreviewPlugin)!.decorations;

    view.dispatch({ changes: { from: doc.length, insert: "x" } });
    const decosAfter = view.plugin(livePreviewPlugin)!.decorations;

    expect(decosAfter).not.toBe(decosBefore);
    view.destroy();
  });
});
