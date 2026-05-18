import { describe, it, expect, beforeEach } from "vitest";
import { useCursorInfoStore } from "./cursorInfo";

beforeEach(() => {
  useCursorInfoStore.setState({ line: 0, col: 0 });
});

describe("useCursorInfoStore", () => {
  it("initial state has line 0, col 0", () => {
    const { line, col } = useCursorInfoStore.getState();
    expect(line).toBe(0);
    expect(col).toBe(0);
  });

  it("setCursorInfo updates line and col", () => {
    useCursorInfoStore.getState().setCursorInfo(5, 10);
    const { line, col } = useCursorInfoStore.getState();
    expect(line).toBe(5);
    expect(col).toBe(10);
  });
});
