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
  it("exposes defPositions and firstRefPositions (no labelToNumber)", () => {
    const map = buildFootnoteMap(makeState("See [^a].\n\n[^a]: A"));
    expect(map).toEqual({
      defPositions: expect.any(Map),
      firstRefPositions: expect.any(Map),
    });
    expect(map).not.toHaveProperty("refPositions");
    expect(map).not.toHaveProperty("labelToNumber");
  });

  it("records the single ref's start offset in firstRefPositions", () => {
    const map = buildFootnoteMap(makeState("See [^a].\n\n[^a]: A"));
    expect(map.firstRefPositions.get("a")).toBe(4); // "[" of [^a]
  });

  it("multiple refs to one label: first occurrence wins (earlier offset)", () => {
    const doc = "See [^x] and [^x] again.\n\n[^x]: X def";
    expect(buildFootnoteMap(makeState(doc)).firstRefPositions.get("x")).toBe(doc.indexOf("[^x]"));
  });

  it("ref without a def is still recorded in firstRefPositions", () => {
    const map = buildFootnoteMap(makeState("See [^a] here."));
    expect(map.firstRefPositions.get("a")).toBe(4);
    expect(map.defPositions.size).toBe(0);
  });

  it("orphan def (no ref) is absent from firstRefPositions", () => {
    const state = makeState("[^b]: Only a def");
    const map = buildFootnoteMap(state);
    expect(map.defPositions.get("b")).toBeDefined();
    expect(map.firstRefPositions.has("b")).toBe(false);
  });

  it("named and numeric labels both resolve in firstRefPositions", () => {
    const doc = "See [^note] and [^1].\n\n[^note]: N\n[^1]: One";
    const map = buildFootnoteMap(makeState(doc));
    expect(map.firstRefPositions.get("note")).toBe(doc.indexOf("[^note]"));
    expect(map.firstRefPositions.get("1")).toBe(doc.indexOf("[^1]"));
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

  it("orphan def appears in defPositions without requiring a ref", () => {
    const state = makeState("See [^a].\n\n[^a]: A\n[^b]: B");
    const map = buildFootnoteMap(state);
    expect(map.defPositions.get("a")).toBeDefined();
    expect(map.defPositions.get("b")).toBeDefined();
  });

  it("handles only definitions (no refs)", () => {
    const state = makeState("[^x]: Only a def");
    const map = buildFootnoteMap(state);
    expect(map.defPositions.get("x")).toBeDefined();
  });

  it("handles only refs (no definitions): empty def map", () => {
    const state = makeState("See [^a] here.");
    const map = buildFootnoteMap(state);
    expect(map.defPositions.size).toBe(0);
  });

  it("out-of-order numeric labels: defs keyed by source label", () => {
    const state = makeState(
      "Claim A[^1], claim B[^3], claim C[^2].\n\n[^1]: First\n[^2]: Second\n[^3]: Third",
    );
    const map = buildFootnoteMap(state);
    expect(map.defPositions.get("1")).toBeDefined();
    expect(map.defPositions.get("2")).toBeDefined();
    expect(map.defPositions.get("3")).toBeDefined();
  });
});
