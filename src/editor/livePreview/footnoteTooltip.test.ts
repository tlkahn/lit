import { describe, it, expect, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import { Footnote } from "../markdown/footnote";
import { buildFootnoteMap } from "./footnoteNumbering";
import { getFootnoteDefBody, getFootnoteDefBodyInfo, renderFootnoteBody, footnoteTooltipSource } from "./footnoteTooltip";

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
  const view = new EditorView({ state, parent: document.createElement("div") });
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

describe("getFootnoteDefBodyInfo", () => {
  function defInfo(doc: string, label = "1") {
    const state = makeState(doc);
    const map = buildFootnoteMap(state);
    const defRange = map.defPositions.get(label);
    expect(defRange).toBeDefined();
    const tree = syntaxTree(state);
    let cur: ReturnType<typeof syntaxTree>["topNode"] | null = tree.resolveInner(defRange!.from, 1);
    while (cur && cur.name !== "FootnoteDef") cur = cur.parent;
    expect(cur).not.toBeNull();
    return getFootnoteDefBodyInfo(state, cur!);
  }

  it("single-line def: bodyFrom after mark + one sep, bodyTo at doc end", () => {
    const doc = "[^1]: Definition text";
    const info = defInfo(doc);
    expect(info).not.toBeNull();
    expect(info!.bodyText).toBe("Definition text");
    expect(info!.bodyFrom).toBe(doc.indexOf("Definition"));
    expect(info!.bodyTo).toBe(doc.length);
  });

  it("no separator: bodyFrom immediately after the colon", () => {
    const doc = "[^1]:body";
    const info = defInfo(doc);
    expect(info).not.toBeNull();
    expect(info!.bodyText).toBe("body");
    expect(info!.bodyFrom).toBe(5); // "[^1]:" is 5 chars
  });

  it("empty body: bodyFrom >= bodyTo and bodyText empty", () => {
    const info = defInfo("[^1]:");
    expect(info).not.toBeNull();
    expect(info!.bodyText).toBe("");
    expect(info!.bodyFrom).toBeGreaterThanOrEqual(info!.bodyTo);
  });

  it("multi-line def: strips one leading 4-space indent from continuation, raw range includes it", () => {
    const doc = "[^1]: First\n    Second";
    const info = defInfo(doc);
    expect(info).not.toBeNull();
    expect(info!.bodyText).toBe("First\nSecond");
    expect(info!.bodyFrom).toBe(6); // "[^1]:" + one space
    expect(info!.bodyTo).toBe(doc.length);
  });

  it("multi-line def: strips one leading tab from continuation", () => {
    const info = defInfo("[^1]: First\n\tSecond");
    expect(info).not.toBeNull();
    expect(info!.bodyText).toBe("First\nSecond");
  });

  it("multi-line def with internal blank: bodyText keeps paragraph break and strips cont indent", () => {
    const doc = "[^1]: Title\n\n    Body";
    const info = defInfo(doc);
    expect(info).not.toBeNull();
    expect(info!.bodyText).toBe("Title\n\nBody");
    expect(info!.bodyTo).toBe(doc.length);
  });

  it("returns null when node has no FootnoteDefMark child", () => {
    const state = makeState("plain text");
    const top = syntaxTree(state).topNode;
    expect(getFootnoteDefBodyInfo(state, top)).toBeNull();
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
