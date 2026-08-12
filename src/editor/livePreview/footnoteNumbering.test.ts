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
  it("records single ref position and no numbering field", () => {
    const state = makeState("See [^1] here.");
    const map = buildFootnoteMap(state);
    expect(map.refPositions.get("1")).toEqual([4]);
    expect("labelToNumber" in map).toBe(false);
  });

  it("records a position per ref in document order", () => {
    const state = makeState("See [^a] and [^b] and [^c].");
    const map = buildFootnoteMap(state);
    expect(map.refPositions.get("a")).toEqual([4]);
    expect(map.refPositions.get("b")).toEqual([13]);
    expect(map.refPositions.get("c")).toEqual([22]);
    expect("labelToNumber" in map).toBe(false);
  });

  it("duplicate ref: one label key, two positions", () => {
    const state = makeState("See [^x] and again [^x].");
    const map = buildFootnoteMap(state);
    expect(map.refPositions.get("x")).toEqual([4, 19]);
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

  it("orphan def appears in defPositions without requiring a ref", () => {
    const state = makeState("See [^a].\n\n[^a]: A\n[^b]: B");
    const map = buildFootnoteMap(state);
    expect(map.refPositions.get("a")).toEqual([4]);
    expect(map.refPositions.get("b")).toBeUndefined();
    expect(map.defPositions.get("b")).toBeDefined();
    expect("labelToNumber" in map).toBe(false);
  });

  it("handles only definitions (no refs)", () => {
    const state = makeState("[^x]: Only a def");
    const map = buildFootnoteMap(state);
    expect(map.refPositions.size).toBe(0);
    expect(map.defPositions.get("x")).toBeDefined();
    expect("labelToNumber" in map).toBe(false);
  });

  it("handles only refs (no definitions)", () => {
    const state = makeState("See [^a] here.");
    const map = buildFootnoteMap(state);
    expect(map.defPositions.size).toBe(0);
    expect(map.refPositions.get("a")).toEqual([4]);
  });

  it("out-of-order numeric labels: positions keyed by source label, no derived numbers", () => {
    const state = makeState(
      "Claim A[^1], claim B[^3], claim C[^2].\n\n[^1]: First\n[^2]: Second\n[^3]: Third",
    );
    const map = buildFootnoteMap(state);
    expect(map.refPositions.get("1")).toEqual([7]);
    expect(map.refPositions.get("3")).toEqual([20]);
    expect(map.refPositions.get("2")).toEqual([33]);
    expect(map.defPositions.get("1")).toBeDefined();
    expect(map.defPositions.get("2")).toBeDefined();
    expect(map.defPositions.get("3")).toBeDefined();
    expect("labelToNumber" in map).toBe(false);
  });
});
