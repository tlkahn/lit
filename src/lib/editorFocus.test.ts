import { describe, it, expect } from "vitest";
import { shouldEditorClaimFocus } from "./editorFocus";

describe("shouldEditorClaimFocus", () => {
  it("returns false when an input holds focus", () => {
    const input = document.createElement("input");
    expect(shouldEditorClaimFocus(input)).toBe(false);
  });

  it("returns false when a textarea holds focus", () => {
    const textarea = document.createElement("textarea");
    expect(shouldEditorClaimFocus(textarea)).toBe(false);
  });

  it("returns false when an element inside the file tree holds focus", () => {
    const tree = document.createElement("div");
    tree.setAttribute("role", "tree");
    const child = document.createElement("button");
    tree.appendChild(child);
    expect(shouldEditorClaimFocus(child)).toBe(false);
    expect(shouldEditorClaimFocus(tree)).toBe(false);
  });

  it("returns true for a plain div", () => {
    const div = document.createElement("div");
    expect(shouldEditorClaimFocus(div)).toBe(true);
  });

  it("returns true for null", () => {
    expect(shouldEditorClaimFocus(null)).toBe(true);
  });
});
