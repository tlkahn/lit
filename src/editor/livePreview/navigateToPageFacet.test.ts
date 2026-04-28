import { describe, it, expect, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import { navigateToPageFacet } from "./navigateToPageFacet";

describe("navigateToPageFacet", () => {
  it("returns null when no value provided", () => {
    const state = EditorState.create({ doc: "" });
    expect(state.facet(navigateToPageFacet)).toBe(null);
  });

  it("returns the provided function", () => {
    const fn = vi.fn();
    const state = EditorState.create({
      doc: "",
      extensions: [navigateToPageFacet.of(fn)],
    });
    expect(state.facet(navigateToPageFacet)).toBe(fn);
  });

  it("returns first non-null when multiple providers exist", () => {
    const fn1 = vi.fn();
    const fn2 = vi.fn();
    const state = EditorState.create({
      doc: "",
      extensions: [navigateToPageFacet.of(null), navigateToPageFacet.of(fn1), navigateToPageFacet.of(fn2)],
    });
    expect(state.facet(navigateToPageFacet)).toBe(fn1);
  });
});
