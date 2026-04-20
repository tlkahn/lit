import { describe, it, expect } from "vitest";
import { EditorState } from "@codemirror/state";
import { livePreviewBaseTheme } from "./theme";

describe("livePreviewBaseTheme", () => {
  it("is a valid Extension that can be added to EditorState", () => {
    expect(() =>
      EditorState.create({ extensions: [livePreviewBaseTheme] }),
    ).not.toThrow();
  });
});
