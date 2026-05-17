import { describe, it, expect, beforeEach } from "vitest";
import type { EditorView } from "@codemirror/view";
import {
  registerPaneView,
  unregisterPaneView,
  getPaneView,
  setFocusedPane,
  setCurrentEditorView,
  getCurrentEditorView,
  _resetForTesting,
} from "./editorViewRef";

function fakeView(label: string): EditorView {
  return { __label: label } as unknown as EditorView;
}

describe("editorViewRef", () => {
  beforeEach(() => {
    _resetForTesting();
  });

  it("registerPaneView stores and getPaneView retrieves", () => {
    const view = fakeView("p1");
    registerPaneView("p1", view);
    expect(getPaneView("p1")).toBe(view);
    expect(getPaneView("unknown")).toBeNull();
  });

  it("unregisterPaneView removes the entry", () => {
    const view = fakeView("p1");
    registerPaneView("p1", view);
    unregisterPaneView("p1");
    expect(getPaneView("p1")).toBeNull();
  });

  it("getCurrentEditorView returns focused pane's view", () => {
    const view1 = fakeView("p1");
    const view2 = fakeView("p2");
    registerPaneView("p1", view1);
    registerPaneView("p2", view2);

    setFocusedPane("p1");
    expect(getCurrentEditorView()).toBe(view1);

    setFocusedPane("p2");
    expect(getCurrentEditorView()).toBe(view2);
  });

  it("getCurrentEditorView returns null when registry empty", () => {
    expect(getCurrentEditorView()).toBeNull();
  });

  it("getCurrentEditorView returns null for unregistered focused pane", () => {
    setFocusedPane("nonexistent");
    expect(getCurrentEditorView()).toBeNull();
  });

  it("legacy setCurrentEditorView backward compat", () => {
    const view = fakeView("legacy");
    setCurrentEditorView(view);
    expect(getCurrentEditorView()).toBe(view);
  });
});
