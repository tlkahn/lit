import { describe, it, expect, vi } from "vitest";
import { EditorState, StateEffect } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { GFM } from "@lezer/markdown";
import { livePreviewPlugin, blockReplacementField } from "./plugin";
import { WikiLink } from "../markdown/wikilink";
import { Math as MathExt } from "../markdown/math";
import { Comment as CommentExt } from "../markdown/comment";
import { calloutFoldField } from "./callout";
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
  return new EditorView({ state, parent: document.createElement("div") });
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
