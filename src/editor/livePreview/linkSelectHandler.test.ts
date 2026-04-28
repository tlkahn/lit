import { describe, it, expect } from "vitest";
import { EditorState } from "@codemirror/state";
import { createLinkSelectHandler } from "./linkSelectHandler";

describe("createLinkSelectHandler", () => {
  it("produces a valid Extension", () => {
    const handler = createLinkSelectHandler();
    expect(() =>
      EditorState.create({ extensions: [handler] }),
    ).not.toThrow();
  });
});
