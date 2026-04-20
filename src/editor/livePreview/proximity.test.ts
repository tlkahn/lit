import { describe, it, expect } from "vitest";
import { EditorState } from "@codemirror/state";
import { isCursorOnLine } from "./proximity";

function stateWith(doc: string, cursor: number): EditorState {
  return EditorState.create({ doc, selection: { anchor: cursor } });
}

describe("isCursorOnLine", () => {
  it("returns true when cursor is on the same line as node", () => {
    const state = stateWith("hello world", 5);
    expect(isCursorOnLine(state, 0, 11)).toBe(true);
  });

  it("returns false when cursor is on a different line", () => {
    const state = stateWith("line one\nline two", 12); // cursor on "line two"
    expect(isCursorOnLine(state, 0, 8)).toBe(false); // node spans "line one"
  });

  it("returns true when cursor is on any line of a multi-line node", () => {
    // node spans lines 1-3, cursor on line 2
    const doc = "aaa\nbbb\nccc\nddd";
    const state = stateWith(doc, 5); // cursor on "bbb"
    expect(isCursorOnLine(state, 0, 11)).toBe(true); // node spans "aaa\nbbb\nccc"
  });

  it("returns true at line start", () => {
    const state = stateWith("hello\nworld", 6); // cursor at start of "world"
    expect(isCursorOnLine(state, 6, 11)).toBe(true);
  });

  it("returns true at line end", () => {
    const state = stateWith("hello\nworld", 5); // cursor at end of "hello"
    expect(isCursorOnLine(state, 0, 5)).toBe(true);
  });

  it("handles empty lines", () => {
    const doc = "first\n\nthird";
    const state = stateWith(doc, 6); // cursor on the empty line
    expect(isCursorOnLine(state, 6, 6)).toBe(true);
    expect(isCursorOnLine(state, 0, 5)).toBe(false);
  });
});
