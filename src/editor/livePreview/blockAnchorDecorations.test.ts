import { describe, it, expect } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { blockAnchorDecorationsExtension } from "./blockAnchorDecorations";

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
});
