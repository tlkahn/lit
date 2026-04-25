import { describe, it, expect, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { GFM } from "@lezer/markdown";
import { WikiLink } from "../markdown/wikilink";
import { getWikilinkTargetAtPos, createWikilinkClickHandler } from "./wikilinkHandler";

function makeState(doc: string): EditorState {
  return EditorState.create({
    doc,
    extensions: [markdown({ extensions: [GFM, WikiLink] })],
  });
}

describe("getWikilinkTargetAtPos", () => {
  it("returns target when pos is inside WikiLink content", () => {
    const state = makeState("see [[MyPage]] here");
    const result = getWikilinkTargetAtPos(state, 7);
    expect(result).toEqual({ target: "MyPage", section: null });
  });

  it("returns null when pos is outside WikiLink", () => {
    const state = makeState("plain text [[link]] more");
    expect(getWikilinkTargetAtPos(state, 2)).toBeNull();
  });

  it("returns null when pos is on [[ marks", () => {
    const state = makeState("[[Page]]");
    expect(getWikilinkTargetAtPos(state, 0)).toBeNull();
    expect(getWikilinkTargetAtPos(state, 1)).toBeNull();
  });

  it("parses section from [[Page#Section]]", () => {
    const state = makeState("go to [[Page#Section]]");
    const result = getWikilinkTargetAtPos(state, 10);
    expect(result).toEqual({ target: "Page", section: "Section" });
  });

  it("parses alias — uses target not display text", () => {
    const state = makeState("see [[Target|Display]]");
    const result = getWikilinkTargetAtPos(state, 8);
    expect(result).toEqual({ target: "Target", section: null });
  });

  it("parses target with section and alias [[Page#Section|Display]]", () => {
    const state = makeState("see [[Page#Section|Display]]");
    const result = getWikilinkTargetAtPos(state, 8);
    expect(result).toEqual({ target: "Page", section: "Section" });
  });

  it("returns target with folder path [[folder/Page]]", () => {
    const state = makeState("see [[folder/Page]]");
    const result = getWikilinkTargetAtPos(state, 8);
    expect(result).toEqual({ target: "folder/Page", section: null });
  });

  it("handles same-page section [[#Section]] — target is empty string", () => {
    const state = makeState("see [[#Section]]");
    const result = getWikilinkTargetAtPos(state, 8);
    expect(result).toEqual({ target: "", section: "Section" });
  });
});

describe("createWikilinkClickHandler", () => {
  it("produces a valid Extension", () => {
    const handler = createWikilinkClickHandler(vi.fn());
    expect(() =>
      EditorState.create({ extensions: [handler] }),
    ).not.toThrow();
  });
});
