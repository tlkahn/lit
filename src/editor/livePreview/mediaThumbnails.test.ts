import { describe, it, expect } from "vitest";
import { EditorState } from "@codemirror/state";
import { mediaThumbnailsFacet } from "./mediaThumbnails";

describe("mediaThumbnailsFacet", () => {
  it("defaults to true when no provider installed", () => {
    const state = EditorState.create({ doc: "" });
    expect(state.facet(mediaThumbnailsFacet)).toBe(true);
  });

  it("returns false when provided with false", () => {
    const state = EditorState.create({
      doc: "",
      extensions: [mediaThumbnailsFacet.of(false)],
    });
    expect(state.facet(mediaThumbnailsFacet)).toBe(false);
  });

  it("last provider wins", () => {
    const state = EditorState.create({
      doc: "",
      extensions: [
        mediaThumbnailsFacet.of(true),
        mediaThumbnailsFacet.of(false),
      ],
    });
    expect(state.facet(mediaThumbnailsFacet)).toBe(false);
  });
});
