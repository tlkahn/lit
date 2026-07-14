import { describe, it, expect, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import { Footnote } from "../markdown/footnote";
import { buildFootnoteMap } from "./footnoteNumbering";
import { getFootnoteDefBody, renderFootnoteBody, footnoteTooltipSource } from "./footnoteTooltip";
import { trackView } from "../../test/cmView";

vi.mock("katex", () => ({
  default: { render: vi.fn() },
}));
vi.mock("katex/dist/katex.min.css", () => ({}));

function makeState(doc: string): EditorState {
  return EditorState.create({
    doc,
    extensions: [markdown({ extensions: [Footnote] })],
  });
}

function makeView(doc: string, cursor = 0): EditorView {
  const state = EditorState.create({
    doc,
    selection: { anchor: cursor },
    extensions: [markdown({ extensions: [Footnote] })],
  });
  const view = trackView(new EditorView({ state, parent: document.createElement("div") }));
  ensureSyntaxTree(view.state, view.state.doc.length);
  return view;
}

describe("getFootnoteDefBody", () => {
  it("single-line def returns body text after mark", () => {
    const state = makeState("[^1]: Definition text");
    const map = buildFootnoteMap(state);
    const body = getFootnoteDefBody(state, "1", map);
    expect(body).toBe("Definition text");
  });

  it("multi-line def returns continuation lines with indent stripped", () => {
    const state = makeState("[^1]: First line\n    Second line");
    const map = buildFootnoteMap(state);
    const body = getFootnoteDefBody(state, "1", map);
    expect(body).toBe("First line\nSecond line");
  });

  it("empty def returns empty string", () => {
    const state = makeState("[^1]:");
    const map = buildFootnoteMap(state);
    const body = getFootnoteDefBody(state, "1", map);
    expect(body).toBe("");
  });

  it("no matching def returns null", () => {
    const state = makeState("See [^1] here.");
    const map = buildFootnoteMap(state);
    const body = getFootnoteDefBody(state, "1", map);
    expect(body).toBeNull();
  });
});

describe("renderFootnoteBody", () => {
  it("delegates to renderMarkdown", async () => {
    const mod = await import("../../lib/renderMarkdown");
    const spy = vi.spyOn(mod, "renderMarkdown");
    renderFootnoteBody("**test**");
    expect(spy).toHaveBeenCalledWith("**test**");
    spy.mockRestore();
  });

  it("plain text returns paragraph HTML", () => {
    const html = renderFootnoteBody("hello world");
    expect(html).toContain("<p>");
    expect(html).toContain("hello world");
  });

  it("bold/italic markdown renders to HTML", () => {
    const html = renderFootnoteBody("**bold** and *italic*");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<em>italic</em>");
  });

  it("script tag is sanitized out", () => {
    const html = renderFootnoteBody("<script>alert('xss')</script>");
    expect(html).not.toContain("<script>");
  });
});

describe("footnoteTooltipSource", () => {
  it("returns null when position is not in FootnoteRef", () => {
    const view = makeView("Just plain text.");
    const result = footnoteTooltipSource(view, 5, 1);
    expect(result).toBeNull();
    view.destroy();
  });

  it("returns null when FootnoteRef has no matching def", () => {
    const view = makeView("See [^1] here.");
    const result = footnoteTooltipSource(view, 6, 1);
    expect(result).toBeNull();
    view.destroy();
  });

  it("returns Tooltip with pos at ref start and above: true", () => {
    const doc = "See [^1] here.\n\n[^1]: Definition";
    const view = makeView(doc);
    const result = footnoteTooltipSource(view, 6, 1);
    expect(result).not.toBeNull();
    expect(result!.pos).toBe(4);
    expect(result!.above).toBe(true);
    view.destroy();
  });

  it("tooltip create() returns DOM with class and rendered content", () => {
    const doc = "See [^1] here.\n\n[^1]: Some **bold** text";
    const view = makeView(doc);
    const result = footnoteTooltipSource(view, 6, 1);
    expect(result).not.toBeNull();
    const { dom } = result!.create!(view);
    expect(dom.className).toBe("cm-footnote-tooltip");
    expect(dom.innerHTML).toContain("<strong>bold</strong>");
    view.destroy();
  });
});
