import { describe, it, expect } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { blockAnchorDecorationsExtension, blockAnchorDimPlugin, computeDimRanges } from "./blockAnchorDecorations";

function makeView(doc: string, anchor = 0) {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const view = new EditorView({
    state: EditorState.create({
      doc,
      selection: { anchor },
      extensions: [blockAnchorDecorationsExtension()],
    }),
    parent,
  });
  return { view, parent };
}

function dimmedTexts(parent: HTMLElement): string[] {
  return Array.from(parent.querySelectorAll(".cm-block-anchor-dim")).map(
    (el) => el.textContent,
  );
}

describe("blockAnchorDecorations", () => {
  it("dims a trailing anchor when the cursor is on another line", () => {
    const doc = "text ^abc\nsecond line";
    const { view, parent } = makeView(doc, doc.length);
    expect(dimmedTexts(parent)).toEqual(["^abc"]);
    view.destroy();
  });

  it("does not dim when the cursor is on the anchor line", () => {
    const { view, parent } = makeView("text ^abc\nsecond line", 0);
    expect(dimmedTexts(parent)).toEqual([]);
    view.destroy();
  });

  it("does not dim anchors inside fenced code", () => {
    const doc = "```\ncode ^abc\n```\nplain";
    const { view, parent } = makeView(doc, doc.length);
    expect(dimmedTexts(parent)).toEqual([]);
    view.destroy();
  });

  it("dims multiple anchors on different lines", () => {
    const doc = "one ^first\ntwo ^second\ncursor here";
    const { view, parent } = makeView(doc, doc.length);
    expect(dimmedTexts(parent)).toEqual(["^first", "^second"]);
    view.destroy();
  });

  it("does not dim inside a fence whose opener is above the computed range (finding 4)", () => {
    // Simulates a viewport that starts inside a code fence: the visible range
    // begins at the `code ^abc` line, below the ``` opener. Fence state must
    // come from the full document, not from the sliced range.
    const doc = "```\ncode ^abc\n```\nplain ^def\ncursor";
    const state = EditorState.create({ doc, selection: { anchor: doc.length } });
    const ranges = [{ from: doc.indexOf("code ^abc"), to: doc.length }];
    const dims = computeDimRanges(state, ranges);
    expect(dims).toHaveLength(1);
    expect(doc.slice(dims[0]!.from, dims[0]!.to)).toBe("^def");
  });

  it("removes the dim when the selection moves onto the anchor line and restores it on leave", () => {
    const doc = "text ^abc\nsecond line";
    const { view, parent } = makeView(doc, doc.length);
    expect(dimmedTexts(parent)).toEqual(["^abc"]);

    view.dispatch({ selection: { anchor: 0 } });
    expect(dimmedTexts(parent)).toEqual([]);

    view.dispatch({ selection: { anchor: doc.length } });
    expect(dimmedTexts(parent)).toEqual(["^abc"]);
    view.destroy();
  });

  it("skips the rebuild for selection moves between non-anchor lines (finding 6)", () => {
    const doc = "one ^first\nplain a\nplain b\ncursor line";
    const { view } = makeView(doc, doc.length);
    const plugin = view.plugin(blockAnchorDimPlugin)!;
    const before = plugin.decorations;

    // Non-anchor line -> non-anchor line: no rebuild, same set reference.
    view.dispatch({ selection: { anchor: doc.indexOf("plain b") } });
    expect(plugin.decorations).toBe(before);

    // Non-anchor line -> anchor line: rebuild (the dim must lift).
    view.dispatch({ selection: { anchor: 0 } });
    expect(plugin.decorations).not.toBe(before);
    view.destroy();
  });
});
