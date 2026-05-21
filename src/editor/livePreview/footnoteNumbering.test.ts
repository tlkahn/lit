import { describe, it, expect } from "vitest";
import { EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { Footnote } from "../markdown/footnote";
import { buildFootnoteMap } from "./footnoteNumbering";

function makeState(doc: string): EditorState {
  return EditorState.create({
    doc,
    extensions: [markdown({ extensions: [Footnote] })],
  });
}

describe("buildFootnoteMap", () => {
  it("assigns number 1 to single ref", () => {
    const state = makeState("See [^1] here.");
    const map = buildFootnoteMap(state);
    expect(map.labelToNumber.get("1")).toBe(1);
  });

  it("assigns sequential numbers to multiple refs in order", () => {
    const state = makeState("See [^a] and [^b] and [^c].");
    const map = buildFootnoteMap(state);
    expect(map.labelToNumber.get("a")).toBe(1);
    expect(map.labelToNumber.get("b")).toBe(2);
    expect(map.labelToNumber.get("c")).toBe(3);
  });

  it("assigns same number to duplicate ref", () => {
    const state = makeState("See [^x] and again [^x].");
    const map = buildFootnoteMap(state);
    expect(map.labelToNumber.get("x")).toBe(1);
    expect(map.refPositions.get("x")).toHaveLength(2);
  });

  it("assigns number after referenced ones for unreferenced definition", () => {
    const state = makeState("See [^a].\n\n[^a]: Def A\n[^b]: Def B");
    const map = buildFootnoteMap(state);
    expect(map.labelToNumber.get("a")).toBe(1);
    expect(map.labelToNumber.get("b")).toBe(2);
  });

  it("records correct defPositions", () => {
    const doc = "Text\n\n[^1]: Definition text";
    const state = makeState(doc);
    const map = buildFootnoteMap(state);
    const def = map.defPositions.get("1");
    expect(def).toBeDefined();
    expect(def!.from).toBe(6);
    expect(def!.to).toBe(doc.length);
  });

  it("maps refPositions to array of from positions", () => {
    const state = makeState("See [^a] and [^a] here.");
    const map = buildFootnoteMap(state);
    const positions = map.refPositions.get("a");
    expect(positions).toBeDefined();
    expect(positions).toHaveLength(2);
    expect(positions![0]).toBe(4);
    expect(positions![1]).toBe(13);
  });

  it("handles only definitions (no refs)", () => {
    const state = makeState("[^x]: Only a def");
    const map = buildFootnoteMap(state);
    expect(map.labelToNumber.get("x")).toBe(1);
    expect(map.refPositions.size).toBe(0);
  });

  it("handles only refs (no definitions)", () => {
    const state = makeState("See [^a] here.");
    const map = buildFootnoteMap(state);
    expect(map.labelToNumber.get("a")).toBe(1);
    expect(map.defPositions.size).toBe(0);
  });
});
