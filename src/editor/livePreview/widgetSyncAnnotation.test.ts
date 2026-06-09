import { describe, it, expect } from "vitest";
import { EditorState } from "@codemirror/state";
import { widgetSync } from "./widgetSyncAnnotation";

describe("widgetSync annotation", () => {
  it("can be attached to a transaction and read back", () => {
    const state = EditorState.create({ doc: "hello world" });
    const tr = state.update({
      annotations: widgetSync.of(true),
    });
    expect(tr.annotation(widgetSync)).toBe(true);
  });

  it("returns undefined when not attached", () => {
    const state = EditorState.create({ doc: "hello world" });
    const tr = state.update({});
    expect(tr.annotation(widgetSync)).toBeUndefined();
  });
});
