import { describe, it, expect } from "vitest";
import { singlePaneFocusBorderClass } from "./paneFocusBorder";

describe("singlePaneFocusBorderClass", () => {
  it("returns accent border for single-pane focused", () => {
    expect(singlePaneFocusBorderClass(false, true)).toBe(
      "border-t-2 border-interactive-accent",
    );
  });

  it("returns transparent border for single-pane unfocused", () => {
    expect(singlePaneFocusBorderClass(false, false)).toBe(
      "border-t-2 border-transparent",
    );
  });

  it("returns empty string for multi-pane focused", () => {
    expect(singlePaneFocusBorderClass(true, true)).toBe("");
  });

  it("returns empty string for multi-pane unfocused", () => {
    expect(singlePaneFocusBorderClass(true, false)).toBe("");
  });
});
